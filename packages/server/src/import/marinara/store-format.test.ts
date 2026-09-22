// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { createHash } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import {
  READ_TABLES,
  SHARD_OWNERS,
  TABLES,
  classifyTablePath,
  encodeShardKey,
  isReadTable,
  isShardDataFileName,
} from './store-format.js';

/**
 * **A port is only worth having if it is the same function**
 * ([P4 §7.18](../../../../../docs/design/workplan/16-p4-implementation.md)).
 *
 * The vectors below are chosen for the ways a plausible re-implementation
 * differs from Marinara's: measuring the raw key rather than the encoded one,
 * lower-casing the hex, letting an underscore through because it looks safe,
 * or upper-casing the key before the reserved-name check. Each of those passes
 * a test written from the happy path, and each picks the wrong file for a row.
 *
 * The classification table is the other half: every name Marinara or its
 * launcher can write, asserted to be the thing it is, because the reader's
 * whole behaviour — which files it reads, which it reports, which make it stop
 * — is a switch on this one answer.
 */

const sha = (raw: string): string =>
  `%h${createHash('sha256').update(raw, 'utf8').digest('hex').slice(0, 32)}`;

describe('a shard key is encoded the way Marinara encodes it', () => {
  it.each([
    // A nanoid, which is the ordinary case: underscores and capitals are not safe.
    ['char_vera', 'char%5Fvera'],
    ['Vera', '%56era'],
    ['a-b-9', 'a-b-9'],
    // Multi-byte, one `%XX` per byte rather than per character.
    ['é', '%C3%A9'],
    // The empty key and the literal share a filename, deliberately, upstream.
    ['', 'orphaned-rows'],
  ])('encodes %j as %j', (raw, expected) => {
    expect(encodeShardKey(raw)).toBe(expected);
  });

  /**
   * **The length is measured after encoding, not before.** Forty underscores
   * encode to a hundred and twenty characters, which is exactly the limit and
   * passes through; forty-one crosses it. An implementation that measured the
   * raw key would keep both, and would write a file name Windows rejects.
   */
  it('measures the encoded name, not the key', () => {
    expect(encodeShardKey('_'.repeat(40))).toBe('%5F'.repeat(40));
    expect(encodeShardKey('_'.repeat(41))).toBe(sha('_'.repeat(41)));
  });

  /**
   * **The reserved-name check is on the encoded name too.** `con` survives
   * encoding unchanged and collides with the device name, so it hashes; `Con`
   * encodes its capital first and is then nothing special. Upper-casing the raw
   * key instead would hash both.
   */
  it('hashes a reserved device name, and only the one that stays reserved', () => {
    expect(encodeShardKey('con')).toBe(sha('con'));
    expect(encodeShardKey('Con')).toBe('%43on');
    expect(encodeShardKey('lpt9')).toBe(sha('lpt9'));
  });

  it('is stable, so the same row keeps the same file', () => {
    expect(encodeShardKey('char_vera')).toBe(encodeShardKey('char_vera'));
  });
});

describe('a shard data file is the name Marinara would load', () => {
  it.each([
    ['char%5Fvera.json', true],
    ['orphaned-rows.json', true],
    // Everything a dot in front makes invisible to the store.
    ['.migrating', false],
    ['.hidden.json', false],
    // Anything that is not a `.json` at all.
    ['char%5Fvera.json.bak', false],
    ['char%5Fvera.json.tmp-4242-1758000000000', false],
    ['notes.txt', false],
  ])('%s → %s', (name, expected) => {
    expect(isShardDataFileName(name)).toBe(expected);
  });
});

describe('every path under storage/tables is classified by name alone', () => {
  const at = (rest: string) => classifyTablePath(`${TABLES}${rest}`);

  it.each([
    // The single-file layout, which is every table below storage format 5.
    ['characters.json', 'data', 'characters', null],
    ['characters.json.bak', 'backup', 'characters', null],
    // The sharded layout, which is every table from format 5 on.
    ['characters/char%5Fvera.json', 'data', 'characters', 'char%5Fvera'],
    ['characters/char%5Fvera.json.bak', 'backup', 'characters', 'char%5Fvera'],
    ['lorebook_entries/orphaned-rows.json', 'data', 'lorebook_entries', 'orphaned-rows'],
    // What a migration leaves: the automatic backup, kept for ever.
    ['characters.json.pre-shard', 'artifact', 'characters', null],
    ['characters.json.bak.pre-shard', 'artifact', 'characters', null],
    ['characters.json.pre-shard-2026-09-01T10-00-00-000Z', 'artifact', 'characters', null],
    // What a downgrade leaves, which upstream quarantines and never merges.
    ['chats.json.post-downgrade-2026-09-01T10-00-00-000Z', 'artifact', 'chats', null],
    // What a torn write or an unreadable file leaves.
    ['characters.json.tmp-4242-1758000000000', 'artifact', 'characters', null],
    ['characters/char%5Fvera.json.tmp-4242-1758000000000', 'artifact', 'characters', null],
    [
      'characters/char%5Fvera.json.corrupt-2026-09-01T10-00-00-000Z',
      'artifact',
      'characters',
      null,
    ],
    ['characters.json.corrupt-2026-09-01T10-00-00-000Z-2', 'artifact', 'characters', null],
    // What the launcher's offline unshard leaves.
    ['characters.json.unshard-tmp', 'artifact', 'characters', null],
    ['characters.json.pre-unshard-2026-09-01T10-00-00-000Z', 'artifact', 'characters', null],
    // The sentinels, which are the two that stop a sweep or explain one.
    ['characters/.migrating', 'sentinel', 'characters', null],
    ['.unshard-in-progress', 'sentinel', null, null],
    // Litter, which is nobody's data and nobody's marker.
    ['characters/.DS_Store', 'artifact', null, null],
    ['Thumbs.db', 'artifact', null, null],
    // Shapes upstream never writes.
    ['characters.json.idx', 'unknown', 'characters', null],
    ['characters/char%5Fvera.idx', 'unknown', 'characters', null],
    ['characters/sub/char%5Fvera.json', 'unknown', 'characters', null],
    ['characters/.somethingnew', 'unknown', 'characters', null],
  ])('%s is a %s of %s', (rest, role, table, shard) => {
    expect(at(rest)).toEqual({ role, table, shard });
  });

  /**
   * **A post-unshard directory holds shard files, and none of them is data.**
   * It is the old sharded copy, set aside whole after the launcher rebuilt the
   * single file — so reading it would import every row a second time, from
   * before the unshard. Split the directory name on its first dot instead of
   * matching the suffix and each file inside becomes a shard of `characters`.
   */
  it('reads nothing out of a directory the launcher set aside', () => {
    const stamped = 'characters.post-unshard-2026-09-01T10-00-00-000Z';

    expect(at(`${stamped}/char%5Fvera.json`)).toEqual({
      table: 'characters',
      role: 'artifact',
      shard: null,
    });
    // Including its own leftover sentinel, which must not read as live.
    expect(at(`${stamped}/.migrating`).role).toBe('artifact');
  });
});

describe('the tables the reader converts', () => {
  /**
   * The owner column decides which file a row belongs in, so it has to be the
   * column upstream groups by — asserted against the whole vendored map rather
   * than against itself, because these ten entries are a copy of six of its
   * rows plus four defaults.
   */
  it('names the owner upstream shards by', () => {
    for (const [table, spec] of Object.entries(READ_TABLES)) {
      expect(spec.owner, table).toBe(SHARD_OWNERS[table] ?? 'id');
    }
  });

  it('checks a join column on every table it reads', () => {
    for (const [table, spec] of Object.entries(READ_TABLES)) {
      expect(spec.joins.length, table).toBeGreaterThan(0);
    }
  });

  /** The prototype hole `reader.ts` had, closed here rather than at each caller. */
  it('is a membership test, not an object lookup', () => {
    expect(isReadTable('characters')).toBe(true);
    expect(isReadTable('constructor')).toBe(false);
    expect(isReadTable('__proto__')).toBe(false);
    expect(isReadTable('toString')).toBe(false);
  });
});
