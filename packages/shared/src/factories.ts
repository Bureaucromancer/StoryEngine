// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { uuidv7 } from './ids.js';
import { type Actor, ACTOR_SCHEMA, CONVENTIONAL_SECTION_IDS } from './schema/actor.js';
import type { Openings, Provenance } from './schema/common.js';
import { type Lorebook, LOREBOOK_SCHEMA } from './schema/lorebook.js';
import { type Preset, PRESET_SCHEMA } from './schema/preset.js';
import { type Setting, SETTING_SCHEMA } from './schema/setting.js';
import { type Setup, SETUP_SCHEMA } from './schema/setup.js';

/**
 * Minimal valid instances of each library kind.
 *
 * Not test scaffolding — this is what "create an actor" calls at P1.5, and what
 * the editor renders a form over at P1.7. It lives here because the defaults are
 * a property of the schema rather than of the route: a lorebook's `scanDepth` of
 * 2 is the same number whether it arrives through the API, an import or a
 * fixture.
 *
 * `newActor` is where [13 §4](docs/design/13-schemas.md)'s *"the editor creates
 * all four on a new actor"* actually happens. Conventional sections are enforced
 * at three layers and none of them is the schema, so this is the first of the
 * three.
 */

function now(): string {
  return new Date().toISOString();
}

export function blankProvenance(source: Provenance['source'] = 'manual'): Provenance {
  const at = now();
  return {
    source,
    creator: null,
    version: null,
    license: null,
    originalFilename: null,
    createdAt: at,
    updatedAt: at,
  };
}

export function blankOpenings(): Openings {
  return { written: [], seeds: [], primaryWrittenId: null, primarySeedId: null };
}

export function newActor(name: string): Actor {
  return {
    schema: ACTOR_SCHEMA,
    id: uuidv7(),
    name,
    aliases: [],
    pronouns: null,
    roles: [],
    tags: [],
    profile: {
      visual: null,
      traits: [],
      // All four conventional sections, created empty. A preset addressing
      // `se.background` on an actor nobody wrote one for gets an empty string
      // rather than a missing block, which is the behaviour §4 asks for.
      sections: [
        { id: CONVENTIONAL_SECTION_IDS.summary, title: 'Summary', body: '', disposition: 'always' },
        {
          id: CONVENTIONAL_SECTION_IDS.appearance,
          title: 'Appearance',
          body: '',
          disposition: 'always',
        },
        { id: CONVENTIONAL_SECTION_IDS.voice, title: 'Voice', body: '', disposition: 'always' },
        {
          id: CONVENTIONAL_SECTION_IDS.background,
          title: 'Background',
          body: '',
          disposition: 'on-demand',
        },
      ],
    },
    openings: blankOpenings(),
    lore: [],
    media: [],
    assets: [],
    portraitCrop: null,
    modelHint: null,
    modeData: {},
    provenance: blankProvenance(),
    generated: null,
    compat: null,
  };
}

export function newLorebook(name: string): Lorebook {
  return {
    schema: LOREBOOK_SCHEMA,
    id: uuidv7(),
    name,
    description: '',
    category: 'uncategorized',
    scope: { kind: 'global' },
    enabled: true,
    scanDepth: 2,
    tokenBudget: 2048,
    entryLimit: 100,
    recursiveScanning: false,
    maxRecursionDepth: 3,
    folders: [],
    entries: [],
    tags: [],
    media: [],
    provenance: blankProvenance(),
    generated: null,
    metadata: {},
  };
}

export function newSetting(name: string): Setting {
  return {
    schema: SETTING_SCHEMA,
    id: uuidv7(),
    name,
    blurb: '',
    framing: '',
    tone: {
      genres: [],
      moods: [],
      pov: 'second',
      tense: 'present',
      // null, not "sfw". Unspecified means *ask*, and the difference is
      // deliberate ([13 §2](docs/design/13-schemas.md)).
      contentRating: null,
      styleNotes: '',
    },
    lore: [],
    cast: [],
    openings: blankOpenings(),
    hooks: [],
    modeHints: {},
    tags: [],
    media: [],
    provenance: blankProvenance(),
    generated: null,
    metadata: {},
  };
}

export function newSetup(name: string): Setup {
  return {
    schema: SETUP_SCHEMA,
    id: uuidv7(),
    name,
    blurb: '',
    mode: { id: '', config: null },
    setting: null,
    preset: null,
    cast: { personaOptions: [], partyDefault: [], narrator: null },
    lore: [],
    openings: blankOpenings(),
    hooks: [],
    // Empty is the deliberate opt-out, not an unfinished state: a Setup with no
    // goals is open-ended play.
    goals: [],
    tags: [],
    media: [],
    provenance: blankProvenance(),
    generated: null,
    metadata: {},
  };
}

export function newPreset(name: string): Preset {
  return {
    schema: PRESET_SCHEMA,
    id: uuidv7(),
    name,
    blurb: '',
    modes: [],
    blocks: [],
    budget: {
      contextShare: 0.75,
      // null rather than a number, so a preset authored today does not carry a
      // 2026-shaped window into whatever comes next (§8.3).
      maxContextTokens: null,
      reserveOutputTokens: 1024,
      sources: [],
    },
    params: {},
    modelHint: null,
    variables: [],
    tags: [],
    provenance: blankProvenance(),
    generated: null,
    compat: null,
    metadata: {},
  };
}
