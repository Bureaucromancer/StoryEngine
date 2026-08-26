// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { createCaptureStore } from './captures.js';

/**
 * The filesystem half of the cassette recorder, and the two properties the
 * recorder's own tests cannot see through an in-memory sink: the directory
 * comes into existence on the first write rather than at construction, and a
 * name collision refuses rather than overwrites — because two writes claiming
 * one name means the sequence counter broke, and a corpus must not absorb
 * that loss quietly.
 */

let dir: string | null = null;

afterEach(async () => {
  if (dir !== null) await rm(dir, { recursive: true, force: true });
  dir = null;
});

describe('the capture store', () => {
  it('creates the directory on first write and lands the bytes verbatim', async () => {
    dir = join(await mkdtemp(join(tmpdir(), 'se-cap-')), 'captures', 'nested');
    const store = createCaptureStore(dir);

    await store.write('one.json', '{"cassette":1}\n');

    expect(await readFile(join(dir, 'one.json'), 'utf8')).toBe('{"cassette":1}\n');
  });

  it('refuses to overwrite a name that already exists', async () => {
    dir = await mkdtemp(join(tmpdir(), 'se-cap-'));
    const store = createCaptureStore(dir);
    await store.write('one.json', 'first');

    await expect(store.write('one.json', 'second')).rejects.toThrow();
    // The first recording survived the second's refusal.
    expect(await readFile(join(dir, 'one.json'), 'utf8')).toBe('first');
  });
});
