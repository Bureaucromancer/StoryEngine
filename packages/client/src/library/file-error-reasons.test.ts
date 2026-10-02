// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { REASON_WORDS } from './QuarantinePanel.js';

/**
 * ***Every reason the index refuses a file for has words*** (2026-09-28),
 * checked as `revision-sources.test.ts` checks the history's: by reading the
 * server's own union and failing on a value the client has no words for.
 *
 * The panel printed the reason as its code until now, and its test's fixture
 * used `invalid-json` — a reason the server has never sent — so neither the
 * words nor their absence could be seen. L added `unreadable` and
 * `refused-path` to the union; a table written from memory would have missed
 * them, which is why this reads the declaration.
 */

const INGEST = join(
  import.meta.dirname,
  '..',
  '..',
  '..',
  'server',
  'src',
  'index-db',
  'ingest.ts',
);

describe('why a file was refused', () => {
  it('has words for every reason the index records', () => {
    const text = readFileSync(INGEST, 'utf8');
    const start = text.indexOf('export type FileErrorReason =');
    const end = text.indexOf('export interface FileError', start);
    expect(start, 'the declaration moved or was renamed').toBeGreaterThanOrEqual(0);
    expect(end, 'the interface after it moved').toBeGreaterThan(start);

    const reasons = [...text.slice(start, end).matchAll(/'([a-z-]+)'/g)].map((match) => match[1]!);

    // Six at this writing.
    expect(reasons.length).toBeGreaterThanOrEqual(6);
    expect(reasons.filter((reason) => !Object.hasOwn(REASON_WORDS, reason))).toEqual([]);
  });
});
