// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import type { TagEntry } from '@storyengine/shared';
import { describe, expect, it } from 'vitest';

import { folderRows, insideClosedFolder } from './folders.js';
import type { TagFilters, TagFilterState } from './TagFilterBar.js';

/**
 * Tags used as folders — [05 §5](../../../../docs/design/05-tagging.md).
 *
 * **The two modes differ in exactly one way and it is easy to get backwards.**
 * `closed` hides its members from the ungrouped list until it is entered;
 * `open` is a way *in* and hides nothing. A build that had them the other way
 * round would look plausible and would make objects disappear.
 */

function tag(over: Partial<TagEntry> = {}): TagEntry {
  return {
    id: 'tag-1',
    name: 'noir',
    swatch: null,
    sortOrder: 0,
    folder: 'none',
    hidden: false,
    createdAt: '2026-09-08T00:00:00Z',
    ...over,
  };
}

function filters(...pairs: [string, TagFilterState][]): TagFilters {
  return new Map(pairs);
}

describe('which folders a shelf shows', () => {
  it('shows only tags that are folders', () => {
    const rows = folderRows(
      [tag({ id: 'a', name: 'noir', folder: 'closed' }), tag({ id: 'b', name: 'city' })],
      [['noir'], ['city']],
      new Map(),
    );

    expect(rows.map((row) => row.tag.name)).toEqual(['noir']);
  });

  /**
   * A folder nothing is in is still a folder, and the manager still says so. A
   * row promising a way into an empty shelf is furniture.
   */
  it('hides a folder nothing on this shelf is in', () => {
    const rows = folderRows([tag({ name: 'noir', folder: 'open' })], [['city']], new Map());

    expect(rows).toEqual([]);
  });

  it('counts the objects carrying it, once each', () => {
    const rows = folderRows(
      [tag({ name: 'noir', folder: 'open' })],
      [['noir'], ['noir', 'noir'], ['city']],
      new Map(),
    );

    expect(rows[0]?.count).toBe(2);
  });

  it('knows when the shelf is standing inside one', () => {
    const shelf = [['noir']];
    const closed = folderRows([tag({ name: 'noir', folder: 'open' })], shelf, new Map());
    const open = folderRows(
      [tag({ name: 'noir', folder: 'open' })],
      shelf,
      filters(['noir', 'selected']),
    );

    expect(closed[0]?.open).toBe(false);
    expect(open[0]?.open).toBe(true);
  });

  it('keeps them in the order the registry gives them', () => {
    const rows = folderRows(
      [
        tag({ id: 'a', name: 'zeta', folder: 'open', sortOrder: 1 }),
        tag({ id: 'b', name: 'alpha', folder: 'open', sortOrder: 0 }),
      ],
      [['zeta'], ['alpha']],
      new Map(),
    );

    expect(rows.map((row) => row.tag.name)).toEqual(['alpha', 'zeta']);
  });
});

describe('what a closed folder hides', () => {
  const closed = [tag({ name: 'noir', folder: 'closed' })];

  it('keeps its members out of the ungrouped list', () => {
    expect(insideClosedFolder(['noir'], closed, new Map())).toBe(true);
  });

  it('lets them through once the folder is entered', () => {
    expect(insideClosedFolder(['noir'], closed, filters(['noir', 'selected']))).toBe(false);
  });

  it('leaves everything else alone', () => {
    expect(insideClosedFolder(['city'], closed, new Map())).toBe(false);
    expect(insideClosedFolder([], closed, new Map())).toBe(false);
  });

  /**
   * The half that is easy to reverse. An open folder is a way in, not a way of
   * hiding: its members stay exactly where they were.
   */
  it('is not something an open folder does', () => {
    const open = [tag({ name: 'noir', folder: 'open' })];

    expect(insideClosedFolder(['noir'], open, new Map())).toBe(false);
  });

  it('is not something an ordinary tag does', () => {
    expect(insideClosedFolder(['noir'], [tag({ name: 'noir' })], new Map())).toBe(false);
  });

  /**
   * Excluding a tag says *not these*. Answering that by showing exactly those
   * would be the surface arguing with the person using it.
   */
  it('does not treat an excluded folder as entered', () => {
    expect(insideClosedFolder(['noir'], closed, filters(['noir', 'excluded']))).toBe(true);
  });

  it('hides an object caught by any one of several closed folders', () => {
    const two = [
      tag({ id: 'a', name: 'noir', folder: 'closed' }),
      tag({ id: 'b', name: 'wip', folder: 'closed' }),
    ];

    expect(insideClosedFolder(['wip'], two, filters(['noir', 'selected']))).toBe(true);
  });
});
