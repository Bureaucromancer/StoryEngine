// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { fileExists, listTreeFiles, writeFileBytes } from './files.js';
import { readTarGz, writeTarGz } from './tar-archive.js';

/**
 * ***Writing and reading a gzipped tar, and the three awkward cases*** —
 * [P12.2](../../../../docs/design/workplan/29-p12-implementation.md).
 *
 * `tar-seam.test.ts` proves the header bytes agree with the script's; this is
 * about the parts the script does differently — a stream that honours
 * backpressure, a member whose file changed under it, and a partial write that
 * has to leave nothing behind.
 */

let root: string;

const bytes = (text: string): Uint8Array => new TextEncoder().encode(text);
const text = (raw: Uint8Array): string => new TextDecoder().decode(raw);

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'se-targz-'));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

async function members(path: string): Promise<Map<string, string>> {
  const found = new Map<string, string>();
  for await (const member of readTarGz(path)) found.set(member.name, text(member.bytes));
  return found;
}

describe('a gzipped tar', () => {
  it('round-trips inline bytes and files together', async () => {
    const source = join(root, 'vera.png');
    await writeFileBytes(source, bytes('a card'));

    const archive = join(root, 'out', 'one.tar.gz');
    const result = await writeTarGz(
      archive,
      [
        { name: 'backup.json', bytes: bytes('{"schema":"x"}') },
        { name: 'users/ned/library/actors/vera/card.png', path: source, size: 6 },
      ],
      1_790_000_000,
    );

    expect(result).toEqual({ files: 2, bytes: 20 });
    expect(await members(archive)).toEqual(
      new Map([
        ['backup.json', '{"schema":"x"}'],
        ['users/ned/library/actors/vera/card.png', 'a card'],
      ]),
    );
  });

  /**
   * ***A name past a hundred bytes, end to end.*** The header split is the
   * seam test's; this is the reader rejoining both fields, which is the half
   * that decides where a restore actually writes the file.
   */
  it('round-trips a name that needs the ustar prefix field', async () => {
    const name = `users/${'n'.repeat(63)}/library/lorebooks/${'s'.repeat(64)}/history/v/${'c'.repeat(64)}.json`;
    expect(name.length).toBeGreaterThan(200);

    const archive = join(root, 'long.tar.gz');
    await writeTarGz(archive, [{ name, bytes: bytes('{"kept":"whole"}') }], 0);

    expect((await members(archive)).get(name)).toBe('{"kept":"whole"}');
  });

  it('writes nothing for an empty file rather than reading a byte that is not there', async () => {
    const source = join(root, 'empty.json');
    await writeFileBytes(source, new Uint8Array(0));

    const archive = join(root, 'empty.tar.gz');
    const result = await writeTarGz(archive, [{ name: 'empty.json', path: source, size: 0 }], 0);

    expect(result).toEqual({ files: 1, bytes: 0 });
    expect((await members(archive)).get('empty.json')).toBe('');
  });

  /**
   * ***A turn segment that grew between the `stat` and the read.***
   *
   * The header declared a length a moment before, and a member longer than its
   * header says is not a slightly-wrong archive but an unreadable one — every
   * later member lands at the wrong offset. Segments are append-only, so the
   * prefix is a whole number of complete turns plus possibly a partial last
   * line, and `sessions/segments.ts` already drops a line that does not parse.
   */
  it('takes exactly the declared length from a file that grew under it', async () => {
    const source = join(root, '000001.jsonl');
    const first = '{"id":"t1"}\n';
    await writeFileBytes(source, bytes(`${first}{"id":"t2","half":`));

    const archive = join(root, 'grew.tar.gz');
    await writeTarGz(
      archive,
      [
        { name: 'turns/000001.jsonl', path: source, size: first.length },
        { name: 'after.txt', bytes: bytes('still readable') },
      ],
      0,
    );

    const found = await members(archive);
    expect(found.get('turns/000001.jsonl')).toBe(first);
    // The member after it is the witness that the offsets stayed right.
    expect(found.get('after.txt')).toBe('still readable');
  });

  it('pads a file that shrank, so the archive stays readable', async () => {
    const source = join(root, 'shrank.txt');
    await writeFileBytes(source, bytes('four'));

    const archive = join(root, 'shrank.tar.gz');
    await writeTarGz(
      archive,
      [
        { name: 'shrank.txt', path: source, size: 8 },
        { name: 'after.txt', bytes: bytes('still readable') },
      ],
      0,
    );

    const found = await members(archive);
    expect(found.get('shrank.txt')).toBe('four\0\0\0\0');
    expect(found.get('after.txt')).toBe('still readable');
  });

  /**
   * ***A failure must cost no disk***, because a full disk is what stops the
   * server writing turns — and a feature meant to protect somebody's writing
   * must not be the thing that loses it. The partial is also invisible to a
   * listing while it exists, which is what keeps a half-written archive from
   * being offered to somebody to restore from.
   */
  it('leaves nothing behind when a member cannot be written', async () => {
    const archive = join(root, 'doomed.tar.gz');
    const impossible = `x/${'y'.repeat(160)}.json`;

    await expect(
      writeTarGz(archive, [{ name: impossible, bytes: bytes('never') }], 0),
    ).rejects.toThrow(/cannot be split at a directory boundary/);

    expect(await fileExists(archive)).toBe(false);
    expect(await fileExists(`${archive}.part`)).toBe(false);
    expect(await listTreeFiles(root)).toEqual([]);
  });

  /** A truncated archive ends the walk rather than inventing a member. */
  it('stops at a header it cannot read', async () => {
    const archive = join(root, 'short.tar.gz');
    await writeTarGz(archive, [{ name: 'ok.txt', bytes: bytes('fine') }], 0);

    const whole = await members(archive);
    expect(whole.get('ok.txt')).toBe('fine');
  });
});
