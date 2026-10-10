// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { uuidv7 } from './ids.js';
import { type Actor, ACTOR_SCHEMA, CONVENTIONAL_SECTION_IDS } from './schema/actor.js';
import type { Openings, Provenance } from './schema/common.js';
import { type Lorebook, LOREBOOK_SCHEMA, type LoreEntry } from './schema/lorebook.js';
import { type World, WORLD_SCHEMA } from './schema/world.js';
import { type Preset, PRESET_SCHEMA } from './schema/preset.js';
import { type Treatment, TREATMENT_SCHEMA } from './schema/treatment.js';
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
 * `newActor` is where [04 §4](../../../docs/design/04-schemas.md)'s *"the editor creates
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
    writingSamples: [],
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
    /**
     * ***Linked to nobody — the narrowest value in the union*** —
     * [26 §B15](../../../docs/design/26-open-questions.md), recommended answer,
     * owner deferred (overrule it there), built at
     * [P16.2](../../../docs/design/workplan/35-p16-world.md), 2026-10-10.
     *
     * ~~The widest value in the union, and that is an open question rather
     * than a considered default~~ — this was `{ kind: 'global' }` until P16.2.
     * It was harmless while nothing read `scope`: a lorebook reaches a session by
     * being selected and by nothing else ([03 §3.4]). It was not harmless when
     * [P5.7] briefly gave the field behaviour — that default, plus the SillyTavern
     * importer's identical fallback, is what put every book a person owned into
     * every session's prompt. **A field nobody sets should not default to the
     * most permissive answer it can hold**, and P16 is the phase that gives
     * `scope` a reader again — the `world` arm, which waits on 26 §B16 — so the
     * default was decided first, as the old comment here said it had to be.
     *
     * *It admits nothing either way.* `linked` with no actors is a book that says
     * it belongs to nobody in particular, and selection is still what puts a book
     * in play.
     */
    scope: { kind: 'linked', actorIds: [] },
    enabled: true,
    scanDepth: 2,
    tokenBudget: 2048,
    entryLimit: 100,
    recursiveScanning: false,
    maxRecursionDepth: 3,
    folders: [],
    entries: [],
    writingSamples: [],
    tags: [],
    media: [],
    primaryMediaId: null,
    assets: [],
    provenance: blankProvenance(),
    generated: null,
    metadata: {},
  };
}

/**
 * A lore entry with the doc's stated defaults
 * ([04 §5](../../../docs/design/04-schemas.md)).
 *
 * Here for the same reason the others are — the defaults belong to the schema
 * rather than to whatever creates an entry — and it earns its place immediately:
 * `LoreEntry` has thirty-odd required fields, so without this every caller that
 * wants one writes them all out, including the tests that are supposed to be
 * checking the interesting three.
 *
 * `media` is empty and stays that way unless an author adds pictures. Nothing
 * reads it at 1.0, and nothing ever sends it — see the field.
 */
export function newLoreEntry(name: string): LoreEntry {
  return {
    id: uuidv7(),
    name,
    content: '',
    description: '',

    keys: [],
    secondaryKeys: [],
    selectiveLogic: 'and_any',
    selective: false,
    matchWholeWords: true,
    caseSensitive: false,
    useRegex: false,
    // null, not 2: the entry inherits the book's depth unless it says otherwise.
    scanDepth: null,

    enabled: true,
    constant: false,
    probability: null,

    sticky: null,
    cooldown: null,
    delay: null,
    ephemeral: null,

    position: 'before_char',
    outletName: null,
    depth: 0,
    order: 100,
    role: 'system',

    group: null,
    groupWeight: null,
    folderId: null,
    actorFilter: null,
    actorTagFilter: null,
    generationTriggerFilter: null,
    additionalMatchingSources: [],

    preventRecursion: false,
    excludeRecursion: false,
    delayUntilRecursion: false,

    tag: null,
    media: [],
    locked: false,
    metadata: {},
  };
}

export function newTreatment(name: string): Treatment {
  return {
    schema: TREATMENT_SCHEMA,
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
      // deliberate ([04 §2](../../../docs/design/04-schemas.md)).
      contentRating: null,
      styleNotes: '',
    },
    lore: [],
    cast: [],
    openings: blankOpenings(),
    writingSamples: [],
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
    treatment: null,
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

/**
 * An empty World — the sixth kind, which had no factory as a Package (F18).
 *
 * Empty is the honest default and not a placeholder: a World with no contents
 * is a set nobody has filled yet, and [P16.1]'s editor is where it gets filled.
 * What this proves in the round-trip fixtures is the envelope — that a World
 * survives a write and a read like every other kind — which is the thing all
 * six are checked for.
 *
 * `version` is the World's own, not a schema version: two people can ship
 * `v2` of the same set ([04 §7](../../../docs/design/04-schemas.md)).
 *
 * ***Renamed from `newPackage` at [P16.0]***, with the kind.
 */
export function newWorld(name: string): World {
  return {
    schema: WORLD_SCHEMA,
    id: uuidv7(),
    name,
    version: '1.0.0',
    description: '',
    media: [],
    contents: [],
    requires: { modes: [], extensions: [], capabilities: [] },
    provenance: blankProvenance(),
    metadata: {},
  };
}
