// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { Type } from '@sinclair/typebox';
import { describe, expect, it } from 'vitest';

import { banner, bannerOf, bannersOf } from './banners.js';
import { LoreEntry, Lorebook } from './lorebook.js';

/**
 * The banners are load-bearing now rather than decorative, so they are checked
 * like anything else that a surface reads.
 *
 * **Two of these are the interesting ones.** That the group vocabulary is
 * pinned, because [10 §11.2d](../../../../docs/design/10-ui-surfaces.md) builds
 * the entry editor's disclosures out of it and renaming a group is a change to
 * what a reader is shown — deliberate, or not at all. And that the **emitted
 * artefact** carries them: the client reads the TypeBox objects, so a stripped
 * annotation would be invisible here and would quietly cost a stranger reading
 * `storyengine.lorebook.1.json` the author's own grouping.
 */

const SCHEMA_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'schemas');

/**
 * The groups, in field order, with the field each one opens.
 *
 * Six of them are [10 §11.2d]'s, named there and quoted from the file it was
 * written against. The seventh is P5.0's, and it replaced a banner reading
 * *the one addition* — a remark about the schema's history standing where a
 * reader needed the name of a group.
 */
const EXPECTED = [
  { title: 'Matching', from: 'keys' },
  { title: 'Firing', from: 'enabled' },
  { title: 'Timing', from: 'sticky' },
  { title: 'Placement', from: 'position' },
  { title: 'Grouping and gating', from: 'group' },
  { title: 'Recursion', from: 'preventRecursion' },
  { title: 'The entry itself', from: 'extensionActivations' },
];

describe('a banner is an annotation on the field that opens a group', () => {
  it('is read back off the field that carries one', () => {
    expect(bannerOf(Type.String(banner('Matching')))).toEqual({ title: 'Matching' });
    expect(bannerOf(Type.String(banner('Timing', 'four of them')))).toEqual({
      title: 'Timing',
      note: 'four of them',
    });
  });

  it('is absent from a field that continues the group above it', () => {
    expect(bannerOf(Type.String())).toBeNull();
    expect(bannerOf(undefined)).toBeNull();
    expect(bannerOf({ 'se:banner': { title: 7 } })).toBeNull();
  });

  it('survives Type.Optional, which is where the last group starts', () => {
    const properties = (LoreEntry as { properties: Record<string, unknown> }).properties;

    expect(bannerOf(properties['extensionActivations'])?.title).toBe('The entry itself');
  });
});

describe('LoreEntry’s groups', () => {
  it('are the ones the editor and the read-only fold are specified against', () => {
    expect(bannersOf(LoreEntry).map(({ title, from }) => ({ title, from }))).toEqual(EXPECTED);
  });

  it('carry the editorial subtitles the fields’ author wrote', () => {
    const byTitle = new Map(bannersOf(LoreEntry).map((found) => [found.title, found.note]));

    expect(byTitle.get('Timing')).toBe('Four distinct behaviours, not four takes on one.');
    expect(byTitle.get('Recursion')).toBe('Three flags, all earning their place.');
    // A group with nothing to add says nothing, rather than repeating its name.
    expect(byTitle.get('Matching')).toBeUndefined();
  });

  /**
   * A banner naming a field that is not there would group nothing and show
   * nothing, silently — the failure mode of every list-of-members scheme this
   * one was chosen to avoid, arriving through the back door.
   */
  it('each open a field the schema actually declares', () => {
    const declared = new Set(
      Object.keys((LoreEntry as { properties: Record<string, unknown> }).properties),
    );

    for (const found of bannersOf(LoreEntry)) expect(declared).toContain(found.from);
  });

  it('are the only schema carrying them, since nothing else was written in groups', () => {
    expect(bannersOf(Lorebook)).toEqual([]);
  });
});

describe('the emitted artefact', () => {
  it('carries the same banners, because that document is what a stranger reads', () => {
    const emitted = JSON.parse(
      readFileSync(join(SCHEMA_DIR, 'storyengine.lorebook.1.json'), 'utf8'),
    ) as { properties: { entries: { items: { properties: Record<string, unknown> } } } };

    const fields = emitted.properties.entries.items.properties;
    const found = Object.entries(fields).flatMap(([from, field]) => {
      const carried = bannerOf(field);
      return carried === null ? [] : [{ title: carried.title, from }];
    });

    expect(found).toEqual(EXPECTED);
  });
});
