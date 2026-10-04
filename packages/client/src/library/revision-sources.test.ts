// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { SOURCE_LABELS } from './RevisionList.js';

/**
 * ***Every kind of version the server records has words*** (2026-09-27),
 * checked the way `note-labels.test.ts` checks the review's and the import
 * panel's: by reading the server's own source and failing on a value the
 * client has no words for.
 *
 * The list falls back to the bare kind, deliberately — a newer server's kind
 * should appear as itself rather than as a blank — and that fallback is what
 * hid the gap. A version play wrote into a memory book said *memory* from
 * [P8.2] on, in the one list whose whole job is to say who changed a thing,
 * and at runtime a kind this build writes and never labelled cannot be told
 * from version skew. Here it can.
 *
 * **The union, not its call sites.** `VersionSource` is what `history.ts`
 * records, so an arm added to it is the moment a new value can reach this
 * list. The slice is pinned to the declaration's own first line and the
 * record type after it, and asserts it found at least the arms there are
 * today, so a declaration that moved or was renamed fails loudly here rather
 * than checking an empty list and passing.
 */

const HISTORY = join(
  import.meta.dirname,
  '..',
  '..',
  '..',
  'server',
  'src',
  'storage',
  'history.ts',
);

describe('where a version came from', () => {
  it('has words for every kind of version the server records', () => {
    const text = readFileSync(HISTORY, 'utf8');
    const start = text.indexOf('export type VersionSource =');
    const end = text.indexOf('export interface VersionRecord', start);
    expect(start, 'the declaration moved or was renamed').toBeGreaterThanOrEqual(0);
    expect(end, 'the record type after it moved').toBeGreaterThan(start);

    const kinds = [...text.slice(start, end).matchAll(/\|\s*\{\s*kind:\s*'([a-z-]+)'/g)].map(
      (match) => match[1]!,
    );

    // Seven arms at this writing; `memory` was the seventh, and the one missing.
    expect(kinds.length).toBeGreaterThanOrEqual(7);
    expect(kinds.filter((kind) => !Object.hasOwn(SOURCE_LABELS, kind))).toEqual([]);
  });
});
