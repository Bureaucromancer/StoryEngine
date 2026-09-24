// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { describe, expect, it } from 'vitest';

import { isLitter } from './litter.js';

/**
 * **The list is closed, and the test for that is the point**
 * ([P4 §7.18](../../../../docs/design/workplan/16-p4-implementation.md)).
 *
 * The tempting rule is *a dot-file is not data*, and it would be wrong in the
 * one direction that costs a library: both sources mark work-in-progress with
 * dot-files — Marinara's `.migrating` and `.writer-lease`, SillyTavern's
 * `.migrated` — and a reader that skips those reads a store mid-migration as if
 * it were finished. So the cases below are as much about what is *not* litter.
 */
describe('what a filesystem leaves behind', () => {
  it.each([
    'characters/.DS_Store',
    '.DS_Store',
    'worlds/._Rain City.json',
    'Thumbs.db',
    'characters/thumbs.db',
    'desktop.ini',
    '.stfolder',
    'storage/.stversions/tables/characters.json',
    '@eaDir/characters.json',
    'characters/Vera.png:Zone.Identifier',
    '.dropbox.device',
  ])('%s is litter', (path) => {
    expect(isLitter(path)).toBe(true);
  });

  it.each([
    // The markers. Skipping any of these is how a torn store reads as a whole one.
    'storage/tables/characters/.migrating',
    'storage/.writer-lease',
    'storage/.writer-lease/owner.json',
    'storage/tables/.unshard-in-progress',
    'sysprompt/.migrated',
    'data/.encryption-key',
    // Ordinary data, including one that merely starts with the same letters.
    'storage/tables/characters.json',
    'characters/Vera Solano.png',
    'thumbnails/avatar/Vera.png',
    // A directory named for a person is not a Synology index directory.
    'characters/eaDir Holdings/joy.png',
  ])('%s is not', (path) => {
    expect(isLitter(path)).toBe(false);
  });

  it('matches names case-insensitively, because Windows does', () => {
    expect(isLitter('characters/THUMBS.DB')).toBe(true);
    expect(isLitter('characters/.ds_store')).toBe(true);
  });

  it('answers for a bare directory path without mistaking it for a file', () => {
    expect(isLitter('characters/')).toBe(false);
    expect(isLitter('')).toBe(false);
  });
});
