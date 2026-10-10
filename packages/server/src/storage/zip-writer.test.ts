// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { spawnSync } from 'node:child_process';
import { link, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { crc32 } from 'node:zlib';

import fc from 'fast-check';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { firstLocalEntry } from '@storyengine/shared';

import { readZipDirectory, readZipEntry } from './zip.js';
import { MAX_CENTRAL_BYTES, ZipFile } from './zip-file.js';
import {
  DEFAULT_ZIP_WRITE_LIMITS,
  storedZipBytes,
  storedZipRefusal,
  writeStoredZip,
  ZipWriteError,
  type ZipMember,
} from './zip-writer.js';

/**
 * ***The writer, held to the readers it was written for*** —
 * [16 §5.2](../../../../docs/design/16-publish.md),
 * [03 §5.2.3](../../../../docs/design/03-data-model.md), [P16.3c].
 *
 * **The oracle is never the writer.** `test-zip.ts` names the hazard of a
 * writer and reader written as a pair: *"a bug in both would be invisible."*
 * So every claim here is checked by something that did not write the bytes —
 * this repository's two readers, which every import already trusts; a CRC
 * taken by `node:zlib` over the input rather than read from the output; the
 * shared head parser the client will slice the manifest with; and, where the
 * machine has them, three tools nobody here wrote — Info-ZIP's `unzip -t` and
 * `zipinfo -v`, and Python's `zipfile -t` — which is the stage's end clause:
 * *"a planned file is accepted by both repository readers and by `unzip -t`"*.
 */

let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'se-zip-writer-'));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

const MTIME = new Date('2026-10-10T12:34:56Z');
const encoder = new TextEncoder();

function member(name: string, body: string | Uint8Array): ZipMember {
  return { name, bytes: typeof body === 'string' ? encoder.encode(body) : body };
}

const MEMBERS: ZipMember[] = [
  member('storyengine-world.json', '{"schema":"storyengine.world-file/1"}\n'),
  member('library/actors/vera/card.png', new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 1, 2, 3])),
  member('library/lorebooks/harbour/lorebook.json', '{"name":"Harbour"}\n'),
  member('library/lorebooks/harbour/assets/empty.png', new Uint8Array(0)),
];

async function exists(path: string): Promise<boolean> {
  return stat(path).then(
    () => true,
    () => false,
  );
}

/** Nothing at the destination and nothing at its `.part` — what every failure must leave. */
async function expectNothingAt(to: string): Promise<void> {
  expect(await exists(to)).toBe(false);
  expect(await exists(`${to}.part`)).toBe(false);
}

describe('what the writer writes', () => {
  /**
   * The stage's first claim, and the one the CRC field was parsed for: what
   * the writer accepts, both readers return — names, method, bytes — and the
   * CRC each central record states is the one `node:zlib` takes **of the
   * input**, so a writer that stamped the wrong checksum fails here even
   * though no reader in this repository checks it.
   */
  it('round-trips through readZipDirectory/readZipEntry and ZipFile, CRC included', async () => {
    const to = join(root, 'world.seworld');
    const result = await writeStoredZip(to, MEMBERS, { mtime: MTIME });
    const bytes = new Uint8Array(await readFile(to));
    expect(result).toEqual({ entries: MEMBERS.length, bytes: bytes.length });
    expect(bytes.length).toBe(
      storedZipBytes(MEMBERS.map((one) => ({ name: one.name, size: one.bytes.length }))),
    );

    const directory = readZipDirectory(bytes);
    if (!directory.ok) throw new Error(`refused: ${directory.refusal}`);
    expect(directory.entries.map((entry) => entry.name)).toEqual(MEMBERS.map((one) => one.name));
    for (const [at, entry] of directory.entries.entries()) {
      const input = MEMBERS[at]!.bytes;
      expect(entry.compression).toBe(0);
      expect(entry.crc32).toBe(crc32(input) >>> 0);
      expect(readZipEntry(bytes, entry)).toEqual(input);
    }

    const opened = await ZipFile.open(to);
    if (!opened.ok) throw new Error(`refused: ${opened.refusal}`);
    try {
      expect(opened.zip.entries.map((entry) => entry.name)).toEqual(MEMBERS.map((one) => one.name));
      for (const [at, entry] of opened.zip.entries.entries()) {
        expect(entry.crc32).toBe(crc32(MEMBERS[at]!.bytes) >>> 0);
        expect(await opened.zip.read(entry)).toEqual(MEMBERS[at]!.bytes);
      }
    } finally {
      await opened.zip.close();
    }
  });

  /**
   * ***The head is enough to find the manifest*** — the property P16.3f's
   * client slice stands on, checked with the shared parser it will use: the
   * first member is the first local header, stored, with no data descriptor,
   * and its declared size slices exactly its bytes.
   */
  it('puts the first member first, stored, with its size in the local header', async () => {
    const to = join(root, 'world.seworld');
    await writeStoredZip(to, MEMBERS, { mtime: MTIME });
    const bytes = new Uint8Array(await readFile(to));

    const head = firstLocalEntry(bytes.subarray(0, 512));
    expect(head).toMatchObject({ name: 'storyengine-world.json', method: 0 });
    expect((head!.flags & 0x0008) === 0).toBe(true);
    expect(bytes.subarray(head!.dataStart, head!.dataStart + head!.size)).toEqual(
      MEMBERS[0]!.bytes,
    );
  });

  it('writes the same bytes for the same members and mtime, and different ones for another time', async () => {
    const one = join(root, 'one.seworld');
    const two = join(root, 'two.seworld');
    const later = join(root, 'later.seworld');
    await writeStoredZip(one, MEMBERS, { mtime: MTIME });
    await writeStoredZip(two, MEMBERS, { mtime: new Date(MTIME.getTime()) });
    await writeStoredZip(later, MEMBERS, { mtime: new Date('2026-10-11T00:00:00Z') });
    expect(await readFile(two)).toEqual(await readFile(one));
    expect(await readFile(later)).not.toEqual(await readFile(one));
  });

  /**
   * Bit 11 on every header, read from the bytes rather than from a reader
   * that decodes UTF-8 whatever the flag says — and a name in two scripts
   * comes back as itself. The empty member is a real case: a folder can hold
   * an empty file, and a zero-length stored entry with CRC 0 is legal.
   */
  it('sets the UTF-8 flag, keeps a name in any script, and writes an empty member', async () => {
    const to = join(root, 'world.seworld');
    const names = ['library/actors/véra/card.png', 'library/lorebooks/灯台/lorebook.json', 'e'];
    await writeStoredZip(
      to,
      names.map((name, at) => member(name, at === 2 ? new Uint8Array(0) : name)),
      { mtime: MTIME },
    );
    const bytes = new Uint8Array(await readFile(to));
    const directory = readZipDirectory(bytes);
    if (!directory.ok) throw new Error(`refused: ${directory.refusal}`);
    expect(directory.entries.map((entry) => entry.name)).toEqual(names);

    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    for (const entry of directory.entries) {
      expect(view.getUint16(entry.offset + 6, true)).toBe(0x0800);
    }
    // The central records: bit 11 at +8, made-by Unix 2.0 at +4, 0644 at +38.
    const end = bytes.length - 22;
    let at = view.getUint32(end + 16, true);
    for (const name of names) {
      expect(view.getUint32(at, true), name).toBe(0x02014b50);
      expect(view.getUint16(at + 4, true)).toBe(0x0314);
      expect(view.getUint16(at + 8, true)).toBe(0x0800);
      expect(view.getUint32(at + 38, true) >>> 16).toBe(0o100644);
      at += 46 + view.getUint16(at + 28, true);
    }
    const empty = directory.entries[2]!;
    expect(empty.uncompressedSize).toBe(0);
    expect(empty.crc32).toBe(0);
    expect(readZipEntry(bytes, empty)).toEqual(new Uint8Array(0));
  });

  /**
   * ***Both copies of the stamp*** — the local header's at +10/+12 and the
   * central record's at +12/+14. *The central one is the one extractors use*
   * (2026-10-10, the P16.3c review): Info-ZIP's `unzip` and Python's
   * `zipfile` take an entry's time from the directory, so a writer that got
   * only the local copy right would hand every recipient files dated
   * 1980-00-00 while every determinism test here still passed.
   */
  it('stamps the time in UTC, in both headers, and clamps a time before 1980 to the format’s epoch', async () => {
    /** [local time, local date, central time, central date] of a one-member archive. */
    const stamps = (bytes: Buffer): number[] => {
      const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      const central = view.getUint32(bytes.length - 22 + 16, true);
      expect(view.getUint32(central, true)).toBe(0x02014b50);
      return [
        view.getUint16(10, true),
        view.getUint16(12, true),
        view.getUint16(central + 12, true),
        view.getUint16(central + 14, true),
      ];
    };

    const to = join(root, 'old.seworld');
    await writeStoredZip(to, [member('a', 'x')], { mtime: new Date('1970-01-01T00:00:00Z') });
    const epoch = (0 << 9) | (1 << 5) | 1; // 1980-01-01, at 00:00:00
    expect(stamps(await readFile(to))).toEqual([0, epoch, 0, epoch]);

    const now = join(root, 'now.seworld');
    await writeStoredZip(now, [member('a', 'x')], { mtime: MTIME });
    const time = (12 << 11) | (34 << 5) | 28;
    const date = (46 << 9) | (10 << 5) | 10;
    expect(stamps(await readFile(now))).toEqual([time, date, time, date]);
  });
});

describe('what the writer refuses, and what it leaves', () => {
  /**
   * ***Refused before the offending bytes, and nothing left behind.*** The
   * second half is easy to see — no `.part`, no file. The first is not: the
   * `.part` is unlinked on the way out, so what it held when the refusal came
   * is gone too. So the source hard-links the `.part` just before it hands
   * over the offending member; the link keeps the inode after the unlink, and
   * its size is exactly what had been written when the writer said no. A
   * writer that wrote the member's header — or the member — and then checked
   * would leave that link longer than the members before it.
   */
  async function refusedAfterTwo(
    offending: ZipMember,
    limits = DEFAULT_ZIP_WRITE_LIMITS,
  ): Promise<ZipWriteError> {
    const to = join(root, 'refused.seworld');
    const watch = join(root, 'watch');
    const before = [member('first', 'one'), member('second', 'two')];
    async function* source(): AsyncGenerator<ZipMember> {
      yield* before;
      await link(`${to}.part`, watch);
      yield offending;
      yield member('never', 'reached');
    }
    const error = await writeStoredZip(to, source(), { mtime: MTIME, limits }).catch(
      (caught: unknown) => caught,
    );
    expect(error).toBeInstanceOf(ZipWriteError);
    await expectNothingAt(to);
    const localBytes = before.reduce(
      (sum, one) => sum + 30 + one.name.length + one.bytes.length,
      0,
    );
    expect((await stat(watch)).size).toBe(localBytes);
    expect((error as ZipWriteError).written).toBe(2);
    await rm(watch);
    return error as ZipWriteError;
  }

  it.each([
    ['../x', 'traversal'],
    ['/x', 'absolute'],
    ['C:x', 'a drive letter'],
    ['a\0b', 'NUL'],
    ['a\\b', 'a backslash the reader would fold to /'],
    ['dir/', 'a directory entry the reader skips'],
    ['a//b', 'an empty segment'],
    ['./a', 'a dot segment'],
    ['', 'nothing'],
    ['lone-\ud800', 'a lone surrogate, which is not UTF-8'],
  ])('refuses %j (%s) before writing it, and leaves nothing', async (name) => {
    const error = await refusedAfterTwo(member(name, 'bytes'));
    expect(error.code).toBe('unsafe-name');
  });

  it('refuses a duplicate name before writing it', async () => {
    const error = await refusedAfterTwo(member('first', 'again'));
    expect(error.code).toBe('duplicate-name');
  });

  it('refuses an entry over the limit before writing it', async () => {
    const limits = { ...DEFAULT_ZIP_WRITE_LIMITS, maxEntryBytes: 16 };
    const error = await refusedAfterTwo(member('big', new Uint8Array(17)), limits);
    expect(error.code).toBe('entry-too-large');
  });

  it('refuses the member that would take the archive past its bound, before writing it', async () => {
    // Two small members, their directory records and the end record fit; a
    // third of 64 bytes does not, though it is under every per-entry bound.
    const fits = storedZipBytes([
      { name: 'first', size: 3 },
      { name: 'second', size: 3 },
    ]);
    const limits = { ...DEFAULT_ZIP_WRITE_LIMITS, maxArchiveBytes: fits + 100 };
    const error = await refusedAfterTwo(member('third', new Uint8Array(64)), limits);
    expect(error.code).toBe('archive-too-large');
  });

  /**
   * The count's refusal under the same watch as the others (2026-10-10, the
   * P16.3c review): `written` is taken before the member, so the test below
   * alone would pass a writer that wrote the extra member and then refused.
   */
  it('refuses the member past maxEntries before writing it', async () => {
    const limits = { ...DEFAULT_ZIP_WRITE_LIMITS, maxEntries: 2 };
    const error = await refusedAfterTwo(member('third', 'x'), limits);
    expect(error.code).toBe('too-many-entries');
  });

  /**
   * ***The on-disk reader's directory bound*** (2026-10-10, the P16.3c
   * review). `zip-file.ts` reads a central directory of at most 16 MiB and
   * refuses an archive whose end record claims more — a bound none of the
   * three limits says, since it is about names, not counts or bytes: 256
   * members named near the sixteen-bit maximum pass every one of them. So
   * the writer holds it too, as `archive-too-large`, before the member that
   * would cross it — and an archive just under it is one `ZipFile.open`
   * takes.
   */
  it('refuses the member whose name would take the directory past the reader’s bound', async () => {
    const long = (at: number): ZipMember => member(`${'p'.repeat(65_000)}/${String(at)}`, '');
    const record = (at: number): number => 46 + long(at).name.length;
    let central = 0;
    let fits = 0;
    while (central + record(fits) <= MAX_CENTRAL_BYTES) central += record(fits++);

    const to = join(root, 'names.seworld');
    const many = Array.from({ length: fits + 1 }, (_, at) => long(at));
    const error = await writeStoredZip(to, many, { mtime: MTIME }).catch(
      (caught: unknown) => caught,
    );
    expect(error).toMatchObject({ code: 'archive-too-large', written: fits });
    await expectNothingAt(to);

    await writeStoredZip(to, many.slice(0, fits), { mtime: MTIME });
    const opened = await ZipFile.open(to);
    if (!opened.ok) throw new Error(`refused: ${opened.refusal}`);
    await opened.zip.close();
    expect(opened.zip.entries).toHaveLength(fits);
  });

  /** The planner's question, answered by the writer's arithmetic: the same three bounds. */
  it('says beforehand what the writer would refuse as a whole', () => {
    const small = [
      { name: 'first', size: 3 },
      { name: 'second', size: 3 },
    ];
    expect(storedZipRefusal(small)).toBeNull();
    expect(storedZipRefusal(small, { ...DEFAULT_ZIP_WRITE_LIMITS, maxEntries: 1 })).toBe(
      'too-many-entries',
    );
    const exact = storedZipBytes(small);
    expect(storedZipRefusal(small, { ...DEFAULT_ZIP_WRITE_LIMITS, maxArchiveBytes: exact })).toBe(
      null,
    );
    expect(
      storedZipRefusal(small, { ...DEFAULT_ZIP_WRITE_LIMITS, maxArchiveBytes: exact - 1 }),
    ).toBe('archive-too-large');
    const named = Array.from({ length: 300 }, (_, at) => ({
      name: `${'p'.repeat(65_000)}/${String(at)}`,
      size: 0,
    }));
    expect(storedZipRefusal(named)).toBe('archive-too-large');
  });

  it('refuses the 4097th entry under the default limits, and leaves nothing', async () => {
    const to = join(root, 'many.seworld');
    const many = Array.from({ length: 4097 }, (_, at) => member(`m/${String(at)}`, ''));
    const error = await writeStoredZip(to, many, { mtime: MTIME }).catch(
      (caught: unknown) => caught,
    );
    expect(error).toMatchObject({ code: 'too-many-entries', memberName: 'm/4096', written: 4096 });
    await expectNothingAt(to);
    // And 4096 is allowed: the bound is the readers', not one short of it.
    await writeStoredZip(to, many.slice(0, 4096), { mtime: MTIME });
    const directory = readZipDirectory(new Uint8Array(await readFile(to)));
    expect(directory.ok && directory.entries.length).toBe(4096);
  });

  it('leaves nothing when the member source throws part way', async () => {
    const to = join(root, 'thrown.seworld');
    function* source(): Generator<ZipMember> {
      yield member('first', 'one');
      throw new Error('the card changed under the writer');
    }
    await expect(writeStoredZip(to, source(), { mtime: MTIME })).rejects.toThrow(
      'the card changed under the writer',
    );
    await expectNothingAt(to);
  });

  it('does not touch a .part it did not make', async () => {
    const to = join(root, 'busy.seworld');
    // Somebody else's partial, under the name this write would use: `wx`
    // refuses to share it, and a writer that did not make it must not
    // remove it on the way out either.
    await writeFile(`${to}.part`, 'another writer');
    await expect(writeStoredZip(to, [member('a', 'y')], { mtime: MTIME })).rejects.toMatchObject({
      code: 'EEXIST',
    });
    expect(await readFile(`${to}.part`, 'utf8')).toBe('another writer');
    expect(await exists(to)).toBe(false);
  });

  it('refuses an invalid time before opening anything', async () => {
    const to = join(root, 'never.seworld');
    await expect(
      writeStoredZip(to, [member('a', 'x')], { mtime: new Date(Number.NaN) }),
    ).rejects.toThrow(RangeError);
    await expectNothingAt(to);
  });
});

describe('whatever the writer accepts, the reader returns identically', () => {
  /** A segment the writer must accept: printable, any script, no `/`, `\`, NUL, `.` or `..`. */
  const segment = fc
    .string({ unit: 'grapheme', minLength: 1, maxLength: 12 })
    .filter(
      (text) =>
        !/[/\\\0]/.test(text) &&
        text !== '.' &&
        text !== '..' &&
        !/^[A-Za-z]:/.test(text) &&
        new TextDecoder().decode(new TextEncoder().encode(text)) === text,
    );
  const safeName = fc
    .array(segment, { minLength: 1, maxLength: 4 })
    .map((parts) => parts.join('/'));
  const body = fc.uint8Array({ maxLength: 256 });

  /**
   * **Names a person's folders could produce**, in any script, at any depth:
   * every one is accepted, and both readers return exactly what was written,
   * in order. This is the half that keeps the other from being vacuous — a
   * writer that refused everything would pass a conditional property.
   */
  it('accepts every safe tree, and both readers return it as written', async () => {
    let run = 0;
    await fc.assert(
      fc.asyncProperty(
        fc.uniqueArray(fc.record({ name: safeName, bytes: body }), {
          selector: (one) => one.name,
          maxLength: 12,
        }),
        async (members) => {
          run += 1;
          const to = join(root, `safe-${String(run)}.zip`);
          await writeStoredZip(to, members, { mtime: MTIME });
          const bytes = new Uint8Array(await readFile(to));
          const directory = readZipDirectory(bytes);
          if (!directory.ok) throw new Error(`refused: ${directory.refusal}`);
          expect(directory.entries.map((entry) => entry.name)).toEqual(
            members.map((one) => one.name),
          );
          for (const [at, entry] of directory.entries.entries()) {
            expect(entry.crc32).toBe(crc32(members[at]!.bytes) >>> 0);
            expect(readZipEntry(bytes, entry)).toEqual(members[at]!.bytes);
          }
          const opened = await ZipFile.open(to);
          if (!opened.ok) throw new Error(`refused: ${opened.refusal}`);
          try {
            for (const [at, entry] of opened.zip.entries.entries()) {
              expect(await opened.zip.read(entry)).toEqual(members[at]!.bytes);
            }
          } finally {
            await opened.zip.close();
          }
          await rm(to);
        },
      ),
      { numRuns: 100 },
    );
  });

  /**
   * **And any string at all**: lone surrogates, NUL, backslashes, drive
   * letters, `..`, duplicates. The claim is conditional and exactly the
   * stage's — *whatever the writer accepts, the reader returns identically*;
   * whatever it refuses leaves nothing on disk.
   *
   * *Two of those need arms of their own* (2026-10-10, the P16.3c review,
   * which sampled the generator): `fc.string({ unit: 'binary' })` draws whole
   * code points and so never a lone surrogate, and names drawn from the whole
   * space almost never repeat within one archive. So a surrogate half is drawn
   * on its own, and two names come from a pool of two — the comment above was
   * a claim about inputs the property did not make until then.
   */
  it('reads back exactly what it accepted, from any names, and leaves nothing for a refusal', async () => {
    let run = 0;
    await fc.assert(
      fc.asyncProperty(
        fc.array(
          fc.record({
            name: fc.oneof(
              fc.string({ unit: 'binary', maxLength: 16 }),
              fc.constantFrom('../x', '/x', 'C:x', 'a\\b', 'd/', 'a//b', './a', 'x/..'),
              fc
                .integer({ min: 0xd800, max: 0xdfff })
                .map((unit) => `x${String.fromCharCode(unit)}`),
              fc.constantFrom('dup', 'dup/x'),
              safeName,
            ),
            bytes: body,
          }),
          { maxLength: 8 },
        ),
        async (members) => {
          run += 1;
          const to = join(root, `any-${String(run)}.zip`);
          const outcome = await writeStoredZip(to, members, { mtime: MTIME }).then(
            () => 'written' as const,
            (error: unknown) => {
              if (!(error instanceof ZipWriteError)) throw error;
              return error;
            },
          );
          if (outcome !== 'written') {
            expect(['unsafe-name', 'duplicate-name']).toContain(outcome.code);
            await expectNothingAt(to);
            return;
          }
          const bytes = new Uint8Array(await readFile(to));
          const directory = readZipDirectory(bytes);
          if (!directory.ok) throw new Error(`refused: ${directory.refusal}`);
          expect(directory.entries.map((entry) => entry.name)).toEqual(
            members.map((one) => one.name),
          );
          for (const [at, entry] of directory.entries.entries()) {
            expect(readZipEntry(bytes, entry)).toEqual(members[at]!.bytes);
          }
          await rm(to);
        },
      ),
      { numRuns: 200 },
    );
  });
});

/**
 * ***Three tools nobody here wrote*** — the stage's end clause, where the
 * machine has them. Skipped rather than failed where it does not, because CI's
 * images are not this repository's to fill, and the two readers above are the
 * claim that always runs.
 */
describe('tools outside this repository', () => {
  const has = (tool: string, probe: string[]): boolean =>
    spawnSync(tool, probe, { stdio: 'ignore' }).status === 0;
  const hasUnzip = has('unzip', ['-v']);
  const hasZipinfo = has('zipinfo', ['-h']);
  const hasPython = has('python3', ['-I', '-c', 'import zipfile']);

  async function written(): Promise<string> {
    const to = join(root, 'world.seworld');
    await writeStoredZip(to, [...MEMBERS, member('library/actors/véra/card.png', 'pixels')], {
      mtime: MTIME,
    });
    return to;
  }

  it.skipIf(!hasUnzip)('unzip -t finds no errors', async () => {
    const run = spawnSync('unzip', ['-t', await written()], { encoding: 'utf8' });
    expect(run.status, run.stdout + run.stderr).toBe(0);
    expect(run.stdout).toContain('No errors detected');
  });

  it.skipIf(!hasZipinfo)('zipinfo -v reports every member stored, from Unix, 0644', async () => {
    const run = spawnSync('zipinfo', ['-v', await written()], { encoding: 'utf8' });
    expect(run.status, run.stderr).toBe(0);
    const count = MEMBERS.length + 1;
    expect(run.stdout.match(/compression method:\s+none \(stored\)/g)).toHaveLength(count);
    expect(run.stdout.match(/file system or operating system of origin:\s+Unix/g)).toHaveLength(
      count,
    );
    expect(run.stdout.match(/Unix file attributes \(100644 octal\)/g)).toHaveLength(count);
    // No data descriptor on any member: the sizes are in the local header.
    expect(run.stdout.match(/extended local header:\s+no/g)).toHaveLength(count);
  });

  it.skipIf(!hasPython)('python3 -I -m zipfile -t accepts it', async () => {
    const run = spawnSync('python3', ['-I', '-m', 'zipfile', '-t', await written()], {
      encoding: 'utf8',
    });
    expect(run.status, run.stdout + run.stderr).toBe(0);
    // Python exits 0 even for a bad CRC — it prints *"The following enclosed
    // file is corrupted"* and carries on — so the whole output is the claim.
    expect(run.stdout.trim()).toBe('Done testing');
    expect(run.stderr).toBe('');
  });
});
