// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { Layout } from './layout.js';
import { SnapshotSpaceError } from './sqlite-snapshot.js';
import { makeZip, type ZipInput, type ZipOptions } from './test-zip.js';
import { DEFAULT_ZIP_FILE_LIMITS, landEntryWithLog, ZipFile } from './zip-file.js';

/**
 * ***The archive reader that reads from disk*** —
 * [P13.8](../../../../docs/design/workplan/30-p13-aventuras-import.md)'s second
 * half. `zip.test.ts` holds the parse's refusals, which this reader shares;
 * this file holds what is new: the tail window, the split limits, an entry
 * inflated to a file rather than into memory, and the landing of a database
 * and its log.
 *
 * Every archive is built here by `test-zip.ts` and written to a temporary
 * directory, because the thing under test is a reader of files.
 */

let root: string;
let layout: Layout;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'se-zip-file-'));
  layout = new Layout(root);
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

let written = 0;
async function onDisk(inputs: readonly ZipInput[], options?: ZipOptions): Promise<string> {
  const path = join(root, `archive-${String((written += 1))}.zip`);
  await writeFile(path, makeZip(inputs, options));
  return path;
}

async function opened(path: string, limits = DEFAULT_ZIP_FILE_LIMITS): Promise<ZipFile> {
  const result = await ZipFile.open(path, limits);
  if (!result.ok) throw new Error(`expected an archive, got ${result.refusal}`);
  return result.zip;
}

async function scratch(): Promise<string[]> {
  try {
    return await readdir(layout.importScratchRoot);
  } catch {
    return [];
  }
}

const text = (bytes: Uint8Array | null): string | null =>
  bytes === null ? null : new TextDecoder().decode(bytes);

describe('reading an archive on disk', () => {
  it('finds stored and deflated entries alike, as the in-memory reader does', async () => {
    const zip = await opened(
      await onDisk([
        { name: 'card.json', body: '{"name":"Vera"}' },
        { name: 'assets/portrait.png', body: 'PNGDATA', deflate: true },
      ]),
    );
    try {
      expect(zip.entries.map((entry) => entry.name)).toEqual(['card.json', 'assets/portrait.png']);
      expect(text(await zip.read(zip.entries[0]!))).toBe('{"name":"Vera"}');
      expect(text(await zip.read(zip.entries[1]!))).toBe('PNGDATA');
    } finally {
      await zip.close();
    }
  });

  it('finds the directory behind a comment of the greatest length the format allows', async () => {
    const zip = await opened(
      await onDisk([{ name: 'a.json', body: '{}', deflate: true }], {
        comment: new Uint8Array(0xffff).fill(0x20),
      }),
    );
    try {
      expect(text(await zip.read(zip.entries[0]!))).toBe('{}');
    } finally {
      await zip.close();
    }
  });

  it('still sees a zip64 locator behind that comment, and refuses it', async () => {
    /**
     * ***Why the window is 22 + 65535 + 20 bytes*** and not 22 + 65535. The
     * locator is the 20 bytes *before* the end record, and with a comment of
     * the full length those are just outside the smaller window — so a reader
     * that stopped there would take a zip64 archive's placeholder offsets as
     * real. The locator here is only its signature, which is all the check
     * reads.
     */
    const locator = new Uint8Array(20);
    new DataView(locator.buffer).setUint32(0, 0x07064b50, true);
    const path = await onDisk([{ name: 'a.json', body: '{}' }], {
      comment: new Uint8Array(0xffff).fill(0x20),
      beforeEnd: locator,
    });

    expect(await ZipFile.open(path)).toEqual({ ok: false, refusal: 'unsupported' });
  });

  it('reads an entry written with a data descriptor, from the central directory’s sizes', async () => {
    // A streaming writer leaves the local header's sizes zero and says them
    // after the bytes; a reader that trusted the local header would read none.
    const zip = await opened(
      await onDisk([
        { name: 'streamed.json', body: '{"streamed":true}', deflate: true, descriptor: true },
        { name: 'after.json', body: '{"after":true}', descriptor: true },
      ]),
    );
    try {
      expect(text(await zip.read(zip.entries[0]!))).toBe('{"streamed":true}');
      expect(text(await zip.read(zip.entries[1]!))).toBe('{"after":true}');
    } finally {
      await zip.close();
    }
  });

  it('calls an archive cut short malformed rather than not an archive', async () => {
    // Only a file that began like an archive is opened this way, so one with no
    // end is one that did not finish arriving.
    const whole = makeZip([{ name: 'a.json', body: 'x'.repeat(4096), deflate: false }]);
    const cut = join(root, 'cut.zip');
    await writeFile(cut, whole.subarray(0, whole.length - 40));
    expect(await ZipFile.open(cut)).toEqual({ ok: false, refusal: 'malformed' });

    // And one cut inside the directory, with an end record that still says where
    // the directory was: past where the file now ends.
    const lying = makeZip([{ name: 'a.json', body: '{}' }]);
    const view = new DataView(lying.buffer, lying.byteOffset, lying.byteLength);
    view.setUint32(lying.length - 22 + 16, lying.length, true);
    const moved = join(root, 'moved.zip');
    await writeFile(moved, lying);
    expect(await ZipFile.open(moved)).toEqual({ ok: false, refusal: 'malformed' });
  });

  it('refuses an entry that declares more than the cap at parse time, before inflating anything', async () => {
    const path = await onDisk([
      { name: 'aventura.db', body: 'x'.repeat(4096), deflate: true },
      { name: 'metadata.json', body: '{}' },
    ]);
    expect(await ZipFile.open(path, { ...DEFAULT_ZIP_FILE_LIMITS, maxEntryBytes: 1000 })).toEqual({
      ok: false,
      refusal: 'too-large',
    });
  });

  it('shares the in-memory reader’s refusals, which are one parse', async () => {
    expect(await ZipFile.open(await onDisk([{ name: '../escape.json', body: '{}' }]))).toEqual({
      ok: false,
      refusal: 'unsafe-path',
    });
  });
});

describe('the limits, split', () => {
  it('reads nothing larger than an ordinary read into memory, however the archive declares it', async () => {
    const zip = await opened(
      await onDisk([{ name: 'big.bin', body: 'x'.repeat(8192), deflate: true }]),
      {
        ...DEFAULT_ZIP_FILE_LIMITS,
        maxReadBytes: 1000,
      },
    );
    try {
      expect(await zip.read(zip.entries[0]!)).toBeNull();
    } finally {
      await zip.close();
    }
  });

  it('does not count entries nobody reads, as an old backup’s stories are', async () => {
    /**
     * An old Aventuras backup carries `stories/*.avt` beside the database, and
     * the reader lists them and never reads one. The in-memory reader sums
     * declared sizes and would refuse the archive on them; this counts what it
     * inflates.
     */
    const path = await onDisk([
      { name: 'aventura.db', body: 'd'.repeat(500), deflate: true },
      { name: 'stories/the-drowned-bell.avt', body: 's'.repeat(4000), deflate: true },
      { name: 'stories/the-long-tide.avt', body: 't'.repeat(4000), deflate: true },
      { name: 'metadata.json', body: '{"appVersion":"1"}' },
    ]);
    const zip = await opened(path, { ...DEFAULT_ZIP_FILE_LIMITS, maxReadTotalBytes: 2000 });
    try {
      const byName = new Map(zip.entries.map((entry) => [entry.name, entry]));
      expect((await zip.read(byName.get('aventura.db')!))?.byteLength).toBe(500);
      expect(text(await zip.read(byName.get('metadata.json')!))).toBe('{"appVersion":"1"}');
    } finally {
      await zip.close();
    }
  });

  it('counts every read toward the total, so one stream read many times is still bounded', async () => {
    // `zip.ts`'s 4,096-entries-over-one-bomb archive, in small: the same entry
    // read again is inflated again, and counted again.
    const zip = await opened(
      await onDisk([{ name: 'a.bin', body: 'x'.repeat(600), deflate: true }]),
      {
        ...DEFAULT_ZIP_FILE_LIMITS,
        maxReadTotalBytes: 1500,
      },
    );
    try {
      const entry = zip.entries[0]!;
      expect(await zip.read(entry)).not.toBeNull();
      expect(await zip.read(entry)).not.toBeNull();
      expect(await zip.read(entry)).toBeNull();
    } finally {
      await zip.close();
    }
  });
});

describe('an entry inflated to a file', () => {
  it('writes what the entry holds, stored or deflated, without holding it', async () => {
    const body = new Uint8Array(3 * 1024 * 1024).map((unused, at) => at % 251);
    const zip = await opened(
      await onDisk([
        { name: 'deflated.bin', body, deflate: true },
        { name: 'stored.bin', body },
      ]),
      // Past the in-memory read limit, which extraction does not answer to.
      { ...DEFAULT_ZIP_FILE_LIMITS, maxReadBytes: 1024 },
    );
    try {
      for (const entry of zip.entries) {
        const target = join(root, `out-${entry.name}`);
        expect(await zip.extract(entry, target)).toBe('extracted');
        expect(Buffer.compare(await readFile(target), Buffer.from(body))).toBe(0);
      }
    } finally {
      await zip.close();
    }
  });

  it('refuses an entry that inflates past what it declared, or short of it', async () => {
    const zip = await opened(
      await onDisk([{ name: 'a.bin', body: 'x'.repeat(8192), deflate: true }]),
    );
    try {
      const entry = zip.entries[0]!;
      expect(await zip.extract({ ...entry, uncompressedSize: 100 }, join(root, 'short'))).toBe(
        'malformed',
      );
      expect(await zip.extract({ ...entry, uncompressedSize: 9000 }, join(root, 'long'))).toBe(
        'malformed',
      );
    } finally {
      await zip.close();
    }
  });
});

describe('landing a database out of an archive', () => {
  it('lands the database and its log in a space of their own, and hands the space over', async () => {
    const zip = await opened(
      await onDisk([
        { name: 'aventura.db', body: 'the database', deflate: true },
        { name: 'aventura.db-wal', body: 'the log', deflate: true },
      ]),
    );
    try {
      const landed = await landEntryWithLog(zip, 'aventura.db', { layout });
      expect(landed).not.toBeNull();
      expect(landed?.name).toBe('aventura.db');
      expect(await readFile(landed!.space.path('aventura.db'), 'utf8')).toBe('the database');
      expect(await readFile(landed!.space.path('aventura.db-wal'), 'utf8')).toBe('the log');
      await landed!.space.dispose();
      expect(await scratch()).toEqual([]);
    } finally {
      await zip.close();
    }
  });

  it('answers null, and leaves nothing, for an entry that is not there or will not inflate', async () => {
    const bytes = makeZip([{ name: 'aventura.db', body: 'x'.repeat(4096), deflate: true }]);
    // The one entry's central record declares a size it will not inflate to.
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    view.setUint32(bytes.length - 22 - (46 + 'aventura.db'.length) + 24, 10, true);
    const path = join(root, 'lying.zip');
    await writeFile(path, bytes);

    const zip = await opened(path);
    try {
      expect(await landEntryWithLog(zip, 'nothing.db', { layout })).toBeNull();
      expect(await landEntryWithLog(zip, 'aventura.db', { layout })).toBeNull();
      expect(await scratch()).toEqual([]);
    } finally {
      await zip.close();
    }
  });

  it('refuses a log it cannot land rather than handing over the database alone', async () => {
    // The file without its log is an older database that looks whole.
    const good = makeZip([
      { name: 'aventura.db', body: 'the database' },
      { name: 'aventura.db-wal', body: 'the log' },
    ]);
    // Corrupt the log's stored bytes' declared size in the central directory,
    // so it lands short of what it says.
    const view = new DataView(good.buffer, good.byteOffset, good.byteLength);
    const secondCentral = good.length - 22 - (46 + 'aventura.db-wal'.length);
    view.setUint32(secondCentral + 24, 999, true);
    const path = join(root, 'half.zip');
    await writeFile(path, good);

    const zip = await opened(path);
    try {
      expect(await landEntryWithLog(zip, 'aventura.db', { layout })).toBeNull();
      expect(await scratch()).toEqual([]);
    } finally {
      await zip.close();
    }
  });

  it('asks for room first, and refuses with the numbers before writing anything', async () => {
    const zip = await opened(
      await onDisk([{ name: 'aventura.db', body: 'x'.repeat(4096), deflate: true }]),
    );
    try {
      await expect(
        landEntryWithLog(zip, 'aventura.db', {
          layout,
          freeBytes: () => Promise.resolve(1024),
        }),
      ).rejects.toBeInstanceOf(SnapshotSpaceError);
      expect(await scratch()).toEqual([]);
    } finally {
      await zip.close();
    }
  });
});
