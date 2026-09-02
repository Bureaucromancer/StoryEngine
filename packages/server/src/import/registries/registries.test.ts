// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { describe, expect, it } from 'vitest';

import { IMPORT_DISPOSITIONS } from '@storyengine/shared';

import { NOT_CONVERTIBLE } from '../upload.js';

import { MARINARA_DISPOSITIONS, MARINARA_TABLES } from './marinara.js';
import { SILLYTAVERN_DIRECTORIES, SILLYTAVERN_DISPOSITIONS } from './sillytavern.js';

/**
 * **This is what makes *nothing is silently dropped* checkable**
 * ([P4 §1.8](../../../../../docs/design/workplan/06-p4-implementation.md)).
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

describe('the file and the folder say the same thing', () => {
  /**
   * **One kind, two ways in, and they must not disagree.**
   *
   * `instruct/`, `context/` and `reasoning/` get their disposition from the
   * registry when a sweep walks the tree, and from `NOT_CONVERTIBLE` when
   * somebody uploads one of those files on its own. Two tables answering the
   * same question is how they start drifting — and the answer here has drifted
   * once already, between the registry's `skipped` for reasoning and
   * [10 §8.4.2]'s claim that reasoning presets go to `compat`.
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
