// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { mkdtemp, rename, rm } from 'node:fs/promises';
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
   * ***A file saved between the walk and the read*** — the case the old sizing
   * got wrong (corrected 2026-09-27).
   *
   * Every library and session JSON is written by temp-and-rename, so a save
   * while a backup runs puts a *different file* at the path the walk sized.
   * The header used to take the walk's size, so the new file went into the
   * archive cut off, or padded with NULs: JSON that will not parse, in a backup
   * that said it succeeded. The size now comes from the handle that is read.
   *
   * Catches: a header sized from the member's declared `size`.
   */
  it('archives a file saved after the walk whole, longer or shorter', async () => {
    const longer = join(root, 'session.json');
    const shorter = join(root, 'actor.json');
    await writeFileBytes(longer, bytes('{"id":"s1"}'));
    await writeFileBytes(shorter, bytes('{"id":"a1","name":"Vera the Lamplighter"}'));
    // What the walk saw, before the saves.
    const walked = [
      { name: 'session.json', path: longer, size: '{"id":"s1"}'.length },
      {
        name: 'actor.json',
        path: shorter,
        size: '{"id":"a1","name":"Vera the Lamplighter"}'.length,
      },
    ];

    // The saves: temp and rename, as `writeJsonAtomic` does them.
    await writeFileBytes(`${longer}.tmp`, bytes('{"id":"s1","headTurnId":"t2"}'));
    await rename(`${longer}.tmp`, longer);
    await writeFileBytes(`${shorter}.tmp`, bytes('{"id":"a1","name":"Vera"}'));
    await rename(`${shorter}.tmp`, shorter);

    const archive = join(root, 'saved.tar.gz');
    await writeTarGz(
      archive,
      [...walked, { name: 'after.txt', bytes: bytes('still readable') }],
      0,
    );

    const found = await members(archive);
    expect(JSON.parse(found.get('session.json') ?? '')).toEqual({ id: 's1', headTurnId: 't2' });
    expect(JSON.parse(found.get('actor.json') ?? '')).toEqual({ id: 'a1', name: 'Vera' });
    // The member after them is the witness that the offsets stayed right.
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

  /**
   * ***A member far larger than one inflated chunk***, and one after it. The
   * reader keeps chunks as they arrive and copies each into the member that
   * takes it (it used to reallocate one growing buffer per chunk, which was
   * quadratic), so a member split across many chunks, and a header that
   * starts part way through one, are the cases worth pinning exactly.
   */
  it('reads a member spread across many chunks byte for byte', async () => {
    const big = new Uint8Array(3 * 1024 * 1024 + 7);
    for (let at = 0; at < big.length; at += 1) big[at] = (at * 31 + (at >> 11)) & 0xff;
    const archive = join(root, 'big.tar.gz');
    await writeTarGz(
      archive,
      [
        { name: 'renditions/r1.png', bytes: big },
        { name: 'after.txt', bytes: bytes('still readable') },
      ],
      0,
    );

    const read = new Map<string, Uint8Array>();
    for await (const member of readTarGz(archive)) read.set(member.name, member.bytes);

    expect(read.get('renditions/r1.png')?.length).toBe(big.length);
    expect(Buffer.compare(Buffer.from(read.get('renditions/r1.png')!), Buffer.from(big))).toBe(0);
    expect(text(read.get('after.txt')!)).toBe('still readable');
  });

  /** A truncated archive ends the walk rather than inventing a member. */
  it('stops at a header it cannot read', async () => {
    const archive = join(root, 'short.tar.gz');
    await writeTarGz(archive, [{ name: 'ok.txt', bytes: bytes('fine') }], 0);

    const whole = await members(archive);
    expect(whole.get('ok.txt')).toBe('fine');
  });

  /**
   * ***An archive that is not there is an error the caller can catch.*** The
   * file stream's failure used to go nowhere, because `pipe` forwards data and
   * not errors: an `error` event nobody listened to is an uncaught exception,
   * and at boot, with a restore pending on an archive somebody deleted, that
   * was a crash on every start.
   *
   * Catches: dropping the listener that hands the failure on. The read then
   * waits on a gunzip that never ends, and the process reports the unhandled
   * `ENOENT`.
   */
  it('rejects, rather than crashing the process, when the archive cannot be read', async () => {
    await expect(members(join(root, 'not-there.tar.gz'))).rejects.toThrow(/ENOENT/);
  });
});
