// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import type { IndexRow, LibraryObject, ObjectVersion } from '../api.js';

/**
 * Library envelopes for the workbench's tests — **test-only, and never
 * promoted**, the same standing as `turn-fixtures.ts` beside it. Hand-written
 * against the client's own API types, shaped like the duplicates the server
 * suite makes for real (`duplicates.test.ts`'s copied folder), and given the
 * properties the stage's ends-at needs in one place: a winner, a shadowed
 * copy whose contents diverged, and a tombstoned row inside its settling
 * window. The provenance is an import's, deliberately — [P3 §6]: *"the
 * object-level provenance fields the panel shows are exactly what import
 * fills in"* — so every row the panel owes has something to say.
 */

export const OBJECT_ID = '01a05100-0000-7000-8000-00000000000b';

const BODY: Record<string, unknown> = {
  schema: 'storyengine.lorebook/1',
  id: OBJECT_ID,
  name: 'Rain City',
  entries: [],
  provenance: {
    source: 'import',
    creator: 'Marlowe',
    version: '0.3',
    license: 'CC-BY-4.0',
    originalFilename: 'rain-city.json',
    createdAt: '2026-08-20T09:00:00.000Z',
    updatedAt: '2026-08-27T18:30:00.000Z',
  },
};

export function winningObject(): LibraryObject {
  return {
    id: OBJECT_ID,
    schema: 'storyengine.lorebook/1',
    name: 'Rain City',
    slug: 'rain-city',
    source: 'user',
    contentHash: 'sha256:aaa',
    shadowed: false,
    object: structuredClone(BODY),
  };
}

/** The copy that does not load — same id, later path, diverged contents. */
export function shadowedObject(): LibraryObject {
  return {
    ...winningObject(),
    name: 'Rain City (hand edited)',
    slug: 'zz-copy-of-rain-city',
    contentHash: 'sha256:bbb',
    shadowed: true,
    object: { ...structuredClone(BODY), name: 'Rain City (hand edited)' },
  };
}

export function objectRows(): IndexRow[] {
  return [
    {
      path: 'users/ned/library/lorebooks/rain-city/lorebook.json',
      source: 'user',
      slug: 'rain-city',
      name: 'Rain City',
      schema: 'storyengine.lorebook/1',
      contentHash: 'sha256:aaa',
      shadowed: false,
      tombstonedAt: null,
    },
    {
      path: 'users/ned/library/lorebooks/zz-copy-of-rain-city/lorebook.json',
      source: 'user',
      slug: 'zz-copy-of-rain-city',
      name: 'Rain City (hand edited)',
      schema: 'storyengine.lorebook/1',
      contentHash: 'sha256:bbb',
      shadowed: true,
      tombstonedAt: null,
    },
    {
      path: 'users/ned/library/lorebooks/zz-older-copy/lorebook.json',
      source: 'user',
      slug: 'zz-older-copy',
      name: 'Rain City',
      schema: 'storyengine.lorebook/1',
      contentHash: 'sha256:aaa',
      shadowed: true,
      tombstonedAt: 1_787_800_000_000,
    },
  ];
}

export function objectVersions(): ObjectVersion[] {
  return [
    {
      id: 'v2',
      digest: 'sha256:bbb',
      revision: 2,
      authoredAt: '2026-08-26T12:00:00.000Z',
      recordedAt: '2026-08-26T12:00:00.000Z',
      source: { kind: 'external' },
      reason: 'Hand-tuned the entries',
      authorVersion: null,
      pinned: false,
    },
    {
      id: 'v1',
      digest: 'sha256:aaa',
      revision: 1,
      authoredAt: '2026-08-20T09:00:00.000Z',
      recordedAt: '2026-08-20T09:00:00.000Z',
      source: { kind: 'import' },
      reason: '',
      authorVersion: '0.3',
      pinned: false,
    },
  ];
}
