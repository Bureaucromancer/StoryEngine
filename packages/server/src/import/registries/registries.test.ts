// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { describe, expect, it } from 'vitest';

import { IMPORT_DISPOSITIONS } from '@storyengine/shared';

import { CONVERTED_TABLES, STORY_COUNTS } from '../aventuras/reader.js';
import { AVENTURAS_REQUIRED } from '../aventuras/schema.js';
import { NOT_CONVERTIBLE } from '../upload.js';

import { AVENTURAS_DISPOSITIONS, AVENTURAS_STORY_TABLES, AVENTURAS_TABLES } from './aventuras.js';
import { MARINARA_DISPOSITIONS, MARINARA_TABLES } from './marinara.js';
import { SILLYTAVERN_DIRECTORIES, SILLYTAVERN_DISPOSITIONS } from './sillytavern.js';

/**
 * **This is what makes *nothing is silently dropped* checkable**
 * ([P4 §1.8](../../../../../docs/design/workplan/16-p4-implementation.md)).
 *
 * A review that says everything was accounted for is a promise; a build that
 * fails when a name has no disposition is a mechanism. Both registries are
 * vendored snapshots with their provenance in the file, on the same argument
 * §1.1 makes for the credential list — derived from the source rather than
 * enumerated by hand, without a build-time dependency on that source being
 * checked out.
 *
 * The failure this prevents is specific and has already happened once: P4's own
 * plan named about eighteen of SillyTavern's thirty directories, and the dozen
 * it did not name had no disposition and therefore no row in any review.
 */

const SOURCES = [
  {
    name: 'SillyTavern',
    /** `root` is the tree itself and is not a thing the sweep disposes of. */
    names: SILLYTAVERN_DIRECTORIES.filter((entry) => entry !== ''),
    dispositions: SILLYTAVERN_DISPOSITIONS,
    expected: 30,
  },
  {
    name: 'Marinara',
    names: [...MARINARA_TABLES],
    dispositions: MARINARA_DISPOSITIONS,
    expected: 81,
  },
  {
    name: 'Aventuras',
    /** Twenty-seven of the app's own at migration 039, and the runner's bookkeeping table. */
    names: [...AVENTURAS_TABLES],
    dispositions: AVENTURAS_DISPOSITIONS,
    expected: 28,
  },
] as const;

describe.each(SOURCES)('$name: every name in the registry has a disposition', (source) => {
  it('covers the whole snapshot', () => {
    const missing = source.names.filter((name) => source.dispositions[name] === undefined);

    expect(missing, `no disposition for: ${missing.join(', ')}`).toEqual([]);
  });

  it('disposes of nothing the registry does not contain', () => {
    // The other direction, and it is not symmetry for its own sake: a stale
    // entry left behind after the source renamed something reads as coverage
    // while covering nothing. `slurp_*` beside `noodle_*` in Marinara's own
    // registry is what a rename in progress looks like from outside.
    const known = new Set<string>(source.names);
    const extra = Object.keys(source.dispositions).filter((name) => !known.has(name));

    expect(extra, `disposition for a name the registry does not have: ${extra.join(', ')}`).toEqual(
      [],
    );
  });

  it('uses only dispositions the shared vocabulary defines', () => {
    const vocabulary = new Set<string>(IMPORT_DISPOSITIONS);
    for (const [name, disposition] of Object.entries(source.dispositions)) {
      expect(vocabulary.has(disposition), `${name} has an unknown disposition`).toBe(true);
    }
  });

  it('is the size the snapshot was taken at, so a silent truncation is visible', () => {
    // A snapshot that loses entries in an edit is worse than no snapshot: it
    // still passes coverage, because what it dropped is no longer asked about.
    expect(source.names).toHaveLength(source.expected);
  });
});

describe('the registries are honest about what they do not convert', () => {
  it('never marks a source as unrecognised, because that class is for what a registry lacks', () => {
    // `unrecognised` is what the sweep says about a name in *neither* the
    // snapshot nor the map — Marinara's `scenarios` table is the worked
    // example. A registry entry claiming it would be a contradiction.
    for (const source of SOURCES) {
      const wrong = Object.entries(source.dispositions).filter(
        ([, disposition]) => disposition === 'unrecognised',
      );
      expect(wrong, `${source.name} marks a known name unrecognised`).toEqual([]);
    }
  });

  it('converts less than it records, which is the honest shape of a first import', () => {
    // Not a style rule: if this ever inverts, either import grew a great deal
    // or a disposition was set to `converted` because it was easier than
    // arguing for `recorded`, and that is worth a failing test rather than a
    // shrug.
    const counted = Object.values(MARINARA_DISPOSITIONS);
    const converted = counted.filter((disposition) => disposition === 'converted').length;
    const recorded = counted.filter((disposition) => disposition === 'recorded').length;

    expect(converted).toBeLessThan(recorded);
  });
});

/**
 * ***The Aventuras registry, one converted table per stage*** —
 * [P13.2](../../../../../docs/design/workplan/30-p13-aventuras-import.md)
 * converted nothing; P13.3 converts `character_vault`.
 *
 * Claims the generic checks above cannot make, because they are about what
 * each stage promised rather than about coverage.
 */
describe('the Aventuras registry', () => {
  it('calls converted exactly the tables the reader converts', () => {
    /**
     * *Was "converts nothing yet" at P13.2*, which is what the stages after it
     * were told to change one table at a time. Both directions now: a
     * `converted` row the reader never emits a candidate for is a review
     * describing an import that did not happen, and a table the reader
     * converts while the registry still says `recorded` would be listed twice
     * — once by its rows and once as waiting.
     */
    const converted = Object.entries(AVENTURAS_DISPOSITIONS)
      .filter(([, disposition]) => disposition === 'converted')
      .map(([table]) => table);

    expect(new Set(converted)).toEqual(new Set(CONVERTED_TABLES));
    // *Since P13.11* the three a story's tree is made of, converted into one
    // session per story when a sweep asks for stories — and each story still
    // a row of its own when it does not, so none has a table row either way.
    // *Since P13.12* the five of its world, on the same terms: the head
    // branch's cast and lorebook, named on the story's row. *Since P13.13*
    // the two of its pictures, as renditions beside the turns.
    expect(converted).toEqual([
      'character_vault',
      'lorebook_vault',
      'scenario_vault',
      'vault_tags',
      'stories',
      'story_entries',
      'branches',
      'characters',
      'locations',
      'items',
      'story_beats',
      'entries',
      'embedded_images',
      'background_images',
    ]);
  });

  it('drops the settings table as a credential, and nothing else', () => {
    // [P4 §1.1]: provider keys in plain text, dropped and never quarantined.
    const credential = Object.entries(AVENTURAS_DISPOSITIONS)
      .filter(([, disposition]) => disposition === 'credential')
      .map(([table]) => table);

    expect(credential).toEqual(['settings']);
  });

  it('knows every per-story table and every gated table as a table of the pin', () => {
    // The reader counts the one and the gate checks the other; a name in
    // either that the registry lacks would be counted or refused under a
    // name the review then called unrecognised.
    const known = new Set<string>(AVENTURAS_TABLES);
    const stray = [...AVENTURAS_STORY_TABLES, ...Object.keys(AVENTURAS_REQUIRED)].filter(
      (table) => !known.has(table),
    );

    expect(stray).toEqual([]);
  });

  it('gates on `story_id` exactly the tables the reader counts per story', () => {
    /**
     * *Found at the P13.2 review*, which found this asserting the premise
     * *"every story table is counted"* when three are counted per table only,
     * and nothing tying the reader's own list to the gate. Both directions now:
     * a table the reader groups by `story_id` is gated on it, or a database
     * without the column passes the survey and throws out of `items()`; and a
     * table gated on it is one the reader groups by, or the gate refuses a
     * database over a column nothing selects (`schema.ts`: *not one more*).
     */
    const counted = AVENTURAS_STORY_TABLES.filter((table) => STORY_COUNTS[table] !== null);
    const gated = Object.entries(AVENTURAS_REQUIRED)
      .filter(([, need]) => need.columns.includes('story_id'))
      .map(([table]) => table);

    expect(new Set(gated)).toEqual(new Set(counted));
    // And the three counted per table only are the derived ones the reader names.
    expect(AVENTURAS_STORY_TABLES.filter((table) => STORY_COUNTS[table] === null).sort()).toEqual([
      'kept_separate',
      'time_anchors',
      'world_state_snapshots',
    ]);
  });
});

describe('the file and the folder say the same thing', () => {
  /**
   * **One kind, two ways in, and they must not disagree.**
   *
   * `instruct/`, `context/` and `reasoning/` get their disposition from the
   * registry when a sweep walks the tree, and from `NOT_CONVERTIBLE` when
   * somebody uploads one of those files on its own. Two tables answering the
   * same question is how they start drifting — and the answer here has drifted
   * once already, between the registry's `skipped` for reasoning and
   * [04 §8.4.2]'s claim that reasoning presets go to `compat`.
   *
   * So the upload table names the directory it has to agree with, and this
   * checks it. A future change to either row fails here rather than producing a
   * build where the same file means two things depending on how it arrived.
   */
  it('gives an uploaded template the disposition its directory has', () => {
    const disagreements = Object.entries(NOT_CONVERTIBLE)
      .filter(([, arm]) => SILLYTAVERN_DISPOSITIONS[arm.directory] !== arm.disposition)
      .map(
        ([format, arm]) =>
          `${format} says ${arm.disposition}, ${arm.directory}/ says ${String(
            SILLYTAVERN_DISPOSITIONS[arm.directory],
          )}`,
      );

    expect(disagreements).toEqual([]);
  });

  it('names a directory the registry actually has', () => {
    // A typo here would make the check above vacuously pass, since an unknown
    // key reads as `undefined` and would simply never match.
    const known = new Set<string>(SILLYTAVERN_DIRECTORIES);
    const unknown = Object.values(NOT_CONVERTIBLE)
      .map((arm) => arm.directory)
      .filter((directory) => !known.has(directory));

    expect(unknown).toEqual([]);
  });
});
