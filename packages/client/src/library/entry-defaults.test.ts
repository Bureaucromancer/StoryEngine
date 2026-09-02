// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { newLoreEntry, type LoreEntry } from '@storyengine/shared';
import { describe, expect, it } from 'vitest';

import { groupSummary, offDefaults } from './entry-defaults.js';
import { fieldsOf, groupsOf, loreEntrySchema, type FieldGroup } from './fields.js';

/**
 * The closed-section invariant — [05 §11.2d], and exit-gate step 5's second
 * half: *a collapsed section in the editor names its non-default values*.
 *
 * **Driven by the real schema rather than by hand-built rows.** The groups here
 * come from `groupsOf(fieldsOf(loreEntrySchema(), …))`, which is the same call
 * the editor makes, so a banner moved in `lorebook.ts` moves these assertions
 * with it — where a fixture of invented rows would keep passing while the
 * editor showed something else.
 */

function entry(over: Partial<LoreEntry> = {}): LoreEntry {
  return { ...newLoreEntry('Harbour'), ...over };
}

/** One of the schema's own groups, by the banner's words. */
function group(title: string, value: unknown): FieldGroup {
  const found = groupsOf(fieldsOf(loreEntrySchema(), value)).find(
    (candidate) => candidate.title === title,
  );
  if (found === undefined) throw new Error(`the schema declares no ${title} group`);
  return found;
}

describe('what is not at its default', () => {
  it('finds nothing in a freshly created entry, group by group', () => {
    const fresh = entry();
    for (const found of groupsOf(fieldsOf(loreEntrySchema(), fresh))) {
      // The head group is `id` and `name`, which differ from a fresh entry's by
      // construction — it is never collapsed, which is why that is harmless.
      if (found.title === null) continue;
      expect(offDefaults(found.fields, fresh)).toEqual([]);
    }
  });

  it('names the field that changed, and only it', () => {
    const found = offDefaults(group('Timing', entry()).fields, entry({ sticky: 4 }));
    expect(found).toEqual([{ key: 'sticky', label: 'Sticky', value: 4 }]);
  });

  it('reads a false where the default is true, not merely a truthy difference', () => {
    // `matchWholeWords` defaults to *true*, so this is the direction a
    // presence check would miss: the value is falsy and it is still a change.
    const found = offDefaults(group('Matching', entry()).fields, entry({ matchWholeWords: false }));
    expect(found.map((row) => row.key)).toEqual(['matchWholeWords']);
  });

  it('separates an absent optional from a present one', () => {
    const rows = group('The entry itself', entry()).fields;
    expect(offDefaults(rows, entry())).toEqual([]);
    expect(offDefaults(rows, entry({ extensionActivations: [] })).map((row) => row.key)).toEqual([
      'extensionActivations',
    ]);
  });

  it('separates null from a value at a nullable field', () => {
    const rows = group('Firing', entry()).fields;
    expect(offDefaults(rows, entry({ probability: 0 })).map((row) => row.key)).toEqual([
      'probability',
    ]);
  });

  it('answers nothing for a value that is not an object', () => {
    expect(offDefaults(group('Timing', entry()).fields, null)).toEqual([]);
    expect(offDefaults(group('Timing', entry()).fields, 'a book')).toEqual([]);
  });
});

describe('the summary a closed section carries', () => {
  it('reproduces the design’s numeric example exactly', () => {
    // [05 §11.2d]: "*Timing (sticky 4)*".
    expect(groupSummary(group('Timing', entry()), entry({ sticky: 4 }))).toBe('Timing (sticky 4)');
  });

  it('names all three where the design’s other example counted them', () => {
    // [05 §11.2d] writes "*Matching (3 set)*", and a count conceals three
    // values — which is the hidden field the invariant exists to forbid, and
    // the lossy summary [05 §2.1] forbids by name. Named instead.
    expect(
      groupSummary(
        group('Matching', entry()),
        entry({ keys: ['harbour'], matchWholeWords: false, useRegex: true }),
      ),
    ).toBe('Matching (keys 1, match whole words off, use regex)');
  });

  it('says so when nothing inside has moved, rather than falling silent', () => {
    expect(groupSummary(group('Recursion', entry()), entry())).toBe('Recursion (all at default)');
  });

  it('names a boolean that is on without repeating that it is on', () => {
    expect(groupSummary(group('Recursion', entry()), entry({ preventRecursion: true }))).toBe(
      'Recursion (prevent recursion)',
    );
  });

  it('counts a list as a value rather than as a plural', () => {
    expect(groupSummary(group('Matching', entry()), entry({ keys: ['a', 'b'] }))).toBe(
      'Matching (keys 2)',
    );
  });

  it('lowercases only the label’s first letter, so the schema’s words survive', () => {
    expect(groupSummary(group('Matching', entry()), entry({ matchWholeWords: false }))).toBe(
      'Matching (match whole words off)',
    );
  });

  it('shows a short string and withholds one long enough to swamp the line', () => {
    expect(groupSummary(group('Placement', entry()), entry({ outletName: 'aside' }))).toBe(
      'Placement (outlet name aside)',
    );
    expect(
      groupSummary(
        group('Placement', entry()),
        entry({ outletName: 'a name pasted out of somebody else’s file' }),
      ),
    ).toBe('Placement (outlet name set)');
  });

  it('has nothing to say about the head group, which is never collapsed', () => {
    const head = groupsOf(fieldsOf(loreEntrySchema(), entry())).find(
      (candidate) => candidate.title === null,
    );
    expect(head).toBeDefined();
    expect(groupSummary(head!, entry())).toBe('');
  });
});
