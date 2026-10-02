// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { SNAPSHOT_FREE_RESERVE_BYTES } from './sqlite-snapshot.js';
import {
  assertLandingRoom,
  LandingSpaceError,
  landUpload,
  nextWithin,
  takeHead,
} from './upload-landing.js';

/**
 * ***An upload written to disk as it arrives*** —
 * [P13.8](../../../../docs/design/workplan/30-p13-aventuras-import.md)'s first
 * half, below the route: the sniff that has to survive a network's chunking,
 * the count that stops a landing at its limit, the idle timeout, and the room
 * asked for first. The route's own tests (`routes/import-landing.test.ts`)
 * drive the same through multipart; these hold each part where it can be made
 * to happen exactly.
 */

let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'se-landing-'));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

/** A stream that hands over exactly these chunks, in this order. */
function chunked(...chunks: (string | Uint8Array)[]): AsyncIterator<Uint8Array> {
  const encoder = new TextEncoder();
  const queue = chunks.map((chunk) => (typeof chunk === 'string' ? encoder.encode(chunk) : chunk));
  return {
    next: () =>
      Promise.resolve(
        queue.length > 0
          ? { done: false, value: queue.shift()! }
          : { done: true, value: undefined },
      ),
  };
}

/** A stream that hands over these chunks and then never another, nor an end. */
function stalling(...chunks: string[]): AsyncIterator<Uint8Array> {
  const ready = chunked(...chunks);
  let left = chunks.length;
  return {
    next: () => {
      if (left > 0) {
        left -= 1;
        return ready.next();
      }
      return new Promise<IteratorResult<Uint8Array>>(() => undefined);
    },
  };
}

const SQLITE_HEADER = 'SQLite format 3\0';

describe('the sniff', () => {
  it('gathers sixteen bytes however finely the network cut them', async () => {
    // SQLite's header, one byte to a chunk — a first chunk this short is what
    // a connection may hand over, and sniffing it alone would call a real
    // database *not a database*.
    const taken = await takeHead(chunked(...SQLITE_HEADER.split(''), 'the rest'), 16, 1000);
    expect(taken).not.toBe('idle');
    if (taken === 'idle') return;
    expect(new TextDecoder().decode(taken.head.subarray(0, 16))).toBe(SQLITE_HEADER);
    expect(taken.ended).toBe(false);
  });

  it('keeps whole chunks, so nothing taken for the sniff is lost', async () => {
    const taken = await takeHead(chunked('SQLite ', 'format 3\0 and then some'), 16, 1000);
    if (taken === 'idle') throw new Error('expected a head');
    expect(new TextDecoder().decode(taken.head)).toBe('SQLite format 3\0 and then some');
  });

  it('says so when the file ended before sixteen bytes', async () => {
    const taken = await takeHead(chunked('PK', '\u0003\u0004'), 16, 1000);
    if (taken === 'idle') throw new Error('expected a head');
    expect(taken.head.byteLength).toBe(4);
    expect(taken.ended).toBe(true);
  });

  it('gives up on a stream that stops before it has enough', async () => {
    expect(await takeHead(stalling('SQLite'), 16, 20)).toBe('idle');
  });
});

describe('a landing', () => {
  it('writes the head and then every chunk, in order', async () => {
    const target = join(root, 'aventura.db');
    const outcome = await landUpload({
      head: new TextEncoder().encode(SQLITE_HEADER),
      ended: false,
      rest: chunked('page one,', 'page two'),
      target,
      maxBytes: 1024,
      idleMs: 1000,
    });

    expect(outcome).toEqual({ ok: true, bytes: 16 + 17 });
    expect(await readFile(target, 'utf8')).toBe(`${SQLITE_HEADER}page one,page two`);
  });

  it('stops at the first chunk that would pass the limit, without writing it', async () => {
    const target = join(root, 'aventura.db');
    const outcome = await landUpload({
      head: new TextEncoder().encode('0123456789'),
      ended: false,
      rest: chunked('abcdefghij', 'klmnopqrst', 'never asked for'),
      target,
      maxBytes: 25,
      idleMs: 1000,
    });

    expect(outcome).toEqual({ ok: false, why: 'too-large' });
    expect(await readFile(target, 'utf8')).toBe('0123456789abcdefghij');
  });

  it('refuses a head already past the limit', async () => {
    const outcome = await landUpload({
      head: new Uint8Array(32),
      ended: true,
      rest: chunked(),
      target: join(root, 'x'),
      maxBytes: 16,
      idleMs: 1000,
    });
    expect(outcome).toEqual({ ok: false, why: 'too-large' });
  });

  it('gives up on a client that stops sending, rather than holding the slot forever', async () => {
    const outcome = await landUpload({
      head: new TextEncoder().encode(SQLITE_HEADER),
      ended: false,
      rest: stalling('one chunk'),
      target: join(root, 'aventura.db'),
      maxBytes: 1024,
      idleMs: 20,
    });
    expect(outcome).toEqual({ ok: false, why: 'idle' });
  });

  it('does not leave the lost race’s rejection unheard', async () => {
    // The stream is torn down after an idle, which rejects the `next()` still
    // pending; nobody else is listening to it.
    let reject: (error: Error) => void = () => undefined;
    const iterator: AsyncIterator<Uint8Array> = {
      next: () =>
        new Promise((unused, no) => {
          reject = no;
        }),
    };
    expect(await nextWithin(iterator, 10)).toBe('idle');
    reject(new Error('the stream was destroyed'));
    // An unhandled rejection would fail the run; reaching here is the assertion.
    await new Promise((resolve) => setTimeout(resolve, 5));
  });
});

describe('room for it', () => {
  const MB = 1024 * 1024;

  it('asks for 1.1 times the upload and the reserve', async () => {
    const needed = Math.ceil(100 * MB * 1.1) + SNAPSHOT_FREE_RESERVE_BYTES;
    await expect(
      assertLandingRoom(() => Promise.resolve(needed), root, 100 * MB),
    ).resolves.toBeUndefined();

    const refused = assertLandingRoom(() => Promise.resolve(needed - 1), root, 100 * MB);
    await expect(refused).rejects.toBeInstanceOf(LandingSpaceError);
    await expect(refused).rejects.toThrow(/MB is free/);
  });

  it('does not refuse on a disk that will not say how full it is', async () => {
    await expect(
      assertLandingRoom(() => Promise.resolve(null), root, 100 * MB),
    ).resolves.toBeUndefined();
  });
});
