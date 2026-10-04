// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { Layout } from '../storage/layout.js';
import { PrefsError, PrefsStore } from './prefs.js';

/**
 * Client preferences — [26 B13](../../../../docs/design/26-open-questions.md), closed at
 * [P2A §2.2](../../../../docs/design/workplan/09-p2a-configuration-surface.md).
 *
 * B13's answer was a per-user file, and the three details it left open are what
 * these tests are about: that a patch **merges shallowly** so two tabs are not a
 * lost update, that an **unreadable file reads as empty** rather than refusing,
 * and that the store **does not interpret what it holds** — a key it has never
 * heard of round-trips unchanged, which is the rot-quietly position asserted
 * rather than described.
 */

let dataDir: string;
let layout: Layout;
let prefs: PrefsStore;

beforeEach(async () => {
  dataDir = await mkdtemp(join(tmpdir(), 'se-prefs-'));
  layout = new Layout(dataDir);
  prefs = new PrefsStore(layout);
  await mkdir(layout.userRoot('ned'), { recursive: true });
});

afterEach(async () => {
  await rm(dataDir, { recursive: true, force: true });
});

describe('reading', () => {
  it('is empty before anything is stored', async () => {
    expect(await prefs.read('ned')).toEqual({});
  });

  /**
   * **A broken prefs file is not a broken accounts file.**
   *
   * `accounts.json` refuses to start on a malformed document, deliberately: the
   * server cannot tell who anyone is, and continuing would mean continuing as
   * nobody. This file means somebody's pane is collapsed wrong. Treating those
   * as the same event would make a text editor able to lock a user out of the
   * app over a trailing comma.
   */
  it('reads a mangled file as empty rather than refusing', async () => {
    await writeFile(layout.prefsFile('ned'), '{ not json at all');

    expect(await prefs.read('ned')).toEqual({});
  });

  it('reads a file of the wrong shape as empty too', async () => {
    await writeFile(layout.prefsFile('ned'), JSON.stringify({ schema: 'x', prefs: 'not a map' }));

    expect(await prefs.read('ned')).toEqual({});
  });

  it('is repaired by the next write', async () => {
    await writeFile(layout.prefsFile('ned'), '{ not json at all');

    const after = await prefs.patch('ned', { 'library.density': 'compact' });

    expect(after).toEqual({ 'library.density': 'compact' });
    expect(await prefs.read('ned')).toEqual({ 'library.density': 'compact' });
  });
});

describe('patching', () => {
  it('merges rather than replacing, and answers with the whole map', async () => {
    await prefs.patch('ned', { 'library.density': 'compact', 'editor.pane': 'open' });

    const after = await prefs.patch('ned', { 'editor.pane': 'closed' });

    // The key the second patch did not mention survives — a whole-document
    // write would make two open tabs a lost update, the second save carrying
    // the first's stale view of every other key.
    expect(after).toEqual({ 'library.density': 'compact', 'editor.pane': 'closed' });
  });

  it('deletes on null, so a client can restore a default it does not know', async () => {
    await prefs.patch('ned', { 'library.density': 'compact' });

    const after = await prefs.patch('ned', { 'library.density': null });

    // Deleted rather than stored as null: the document would otherwise
    // accumulate tombstones for every preference anyone ever tried.
    // `toEqual({})` is the whole claim: a stored `null` would show up here
    // as a key, which is what distinguishes deleting from writing an empty.
    expect(after).toEqual({});
  });
});

/**
 * **The store does not interpret what it holds** — B13's position, asserted.
 *
 * The one answer B13 ruled out was a schema, and the failure mode a schema
 * prevents here is not worth what it costs: a preference the client stops using
 * should rot quietly rather than needing a migration, and a *new* client should
 * be able to store a preference an older server has never heard of.
 */
describe('what it refuses to understand', () => {
  it('stores and returns a key it has never heard of, unchanged', async () => {
    const exotic = { 'workbench.blocktable.columns': ['source', 'reason', { width: 3 }] };

    const after = await prefs.patch('ned', exotic);

    expect(after).toEqual(exotic);
    expect(await prefs.read('ned')).toEqual(exotic);
  });

  /**
   * **Bounds are not validation, and the test has to say which it is doing.**
   *
   * The key pattern exists because an unvalidated store is otherwise an
   * unbounded write surface for any signed-in account — it stops the document
   * growing arbitrary structure in its *names*. It does not mean the store
   * knows what `library.density` is, and nothing here does.
   */
  it('bounds the shape of a key without knowing what any key means', async () => {
    await expect(prefs.patch('ned', { notNamespaced: 1 })).rejects.toMatchObject({
      code: 'invalid',
    });
    await expect(prefs.patch('ned', { 'UPPER.case': 1 })).rejects.toBeInstanceOf(PrefsError);

    // And a refused patch stores nothing at all — not even the valid keys
    // beside it, which would leave the client's view half-applied.
    await expect(prefs.patch('ned', { 'library.density': 'compact', bad: 1 })).rejects.toThrow();
    expect(await prefs.read('ned')).toEqual({});
  });

  it('refuses a document that would exceed the size cap', async () => {
    const big = 'x'.repeat(70 * 1024);

    await expect(prefs.patch('ned', { 'library.note': big })).rejects.toMatchObject({
      code: 'too-large',
    });
    expect(await prefs.read('ned')).toEqual({});
  });
});

/**
 * **Writes serialise per handle.**
 *
 * A patch is a read-modify-write across an `await`, which is exactly what
 * `KeyedQueue` exists for. Without it two tabs toggling two different
 * preferences at once have the second read land before the first write, and the
 * loser's change vanishes with no error anywhere — the quietest possible bug.
 */
describe('concurrent patches', () => {
  it('does not lose one of two simultaneous writes', async () => {
    await Promise.all([
      prefs.patch('ned', { 'library.density': 'compact' }),
      prefs.patch('ned', { 'editor.pane': 'closed' }),
      prefs.patch('ned', { 'play.autoscroll': true }),
    ]);

    expect(await prefs.read('ned')).toEqual({
      'library.density': 'compact',
      'editor.pane': 'closed',
      'play.autoscroll': true,
    });
  });
});
