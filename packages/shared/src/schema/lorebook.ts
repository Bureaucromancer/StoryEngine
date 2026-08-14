// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { type Static, Type } from '@sinclair/typebox';

import { EmbeddedMedia, GeneratedMap, Id, Metadata, Provenance } from './common.js';
import { PlotHook } from './hook.js';

/**
 * Lorebook — docs/design/13-schemas.md §5.
 *
 * Entry activation is taken from Marinara close to unchanged, because it is a
 * decade of empirical tuning and it is the interchange format. The changes are
 * four, all scoped: the collapsed scope union, folders, the extension
 * activation hook, and `stateSchema`.
 */

export const LOREBOOK_SCHEMA = 'storyengine.lorebook/1';

/**
 * One mechanism, three behaviours, mutual exclusion by construction. Replaces
 * `characterId` + `characterIds` + `personaId` + `personaIds` + `chatId` +
 * `isGlobal` + `scope`, and the save-time rule that kept them consistent.
 *
 * **Session scoping is deliberately not here.** Session ids are install-local,
 * so a shared lorebook carrying them exports identifiers that are meaningless
 * everywhere else — noise on import at best, and a false resolution against an
 * unrelated local session at worst. "This lorebook applies to this session" is a
 * fact about the *session*, so it lives on the session's own lore links.
 */
export const LoreScope = Type.Union(
  [
    Type.Object({ kind: Type.Literal('global') }),
    /** Personas are actors, so this is one list rather than two. */
    Type.Object({ kind: Type.Literal('linked'), actorIds: Type.Array(Type.String()) }),
  ],
  { title: 'LoreScope' },
);
export type LoreScope = Static<typeof LoreScope>;

export const LoreFolder = Type.Object(
  {
    id: Id,
    name: Type.String(),
    parentFolderId: Type.Union([Type.String(), Type.Null()]),
    /**
     * A gate: when false every entry inside is inactive regardless of its own
     * `enabled`, which is preserved rather than mutated.
     */
    enabled: Type.Boolean(),
    order: Type.Number(),
  },
  { title: 'LoreFolder' },
);
export type LoreFolder = Static<typeof LoreFolder>;

export const LoreFilter = Type.Object(
  {
    mode: Type.Union([Type.Literal('any'), Type.Literal('include'), Type.Literal('exclude')]),
    values: Type.Array(Type.String()),
  },
  { title: 'LoreFilter' },
);
export type LoreFilter = Static<typeof LoreFilter>;

const NullableFilter = Type.Union([LoreFilter, Type.Null()]);
const NullableNumber = Type.Union([Type.Number(), Type.Null()]);

export const LoreEntry = Type.Object(
  {
    id: Id,
    name: Type.String(),
    content: Type.String(),
    /**
     * Read only by a knowledge-router step to judge relevance. Never injected as
     * content.
     */
    description: Type.String(),

    // ── Matching ──
    keys: Type.Array(Type.String()),
    secondaryKeys: Type.Array(Type.String()),
    selectiveLogic: Type.Union([
      Type.Literal('and_any'),
      Type.Literal('and_all'),
      Type.Literal('not_any'),
      Type.Literal('not_all'),
    ]),
    selective: Type.Boolean(),
    matchWholeWords: Type.Boolean(),
    caseSensitive: Type.Boolean(),
    /** Patterns run under a hard execution timeout ([08 §5.1](docs/design/08-triage.md)). */
    useRegex: Type.Boolean(),
    /** null = inherit from the book. */
    scanDepth: NullableNumber,

    // ── Firing ──
    enabled: Type.Boolean(),
    /** Fires whenever the book is active. */
    constant: Type.Boolean(),
    /** 0..100; null = always. */
    probability: Type.Union([Type.Number({ minimum: 0, maximum: 100 }), Type.Null()]),

    // ── Timing. Four distinct behaviours, not four takes on one. ──
    /** Stay active N messages after firing. */
    sticky: NullableNumber,
    /** Wait N messages between firings. */
    cooldown: NullableNumber,
    /** Do not fire until N messages in. */
    delay: NullableNumber,
    /** Auto-disable after N firings. */
    ephemeral: NullableNumber,

    // ── Placement ──
    position: Type.Union([
      Type.Literal('before_char'),
      Type.Literal('after_char'),
      Type.Literal('at_depth'),
      Type.Literal('outlet'),
    ]),
    /**
     * Exact, case-sensitive, for `{{outlet::name}}`. Decouples "this activated"
     * from "this gets pasted here".
     */
    outletName: Type.Union([Type.String(), Type.Null()]),
    depth: Type.Number(),
    /** Lower = earlier. */
    order: Type.Number(),
    role: Type.Union([Type.Literal('system'), Type.Literal('user'), Type.Literal('assistant')]),

    // ── Grouping and gating ──
    /** Only one of a group fires. */
    group: Type.Union([Type.String(), Type.Null()]),
    groupWeight: NullableNumber,
    folderId: Type.Union([Type.String(), Type.Null()]),
    actorFilter: NullableFilter,
    actorTagFilter: NullableFilter,
    generationTriggerFilter: NullableFilter,
    /**
     * Scan places other than recent messages — a card's description, a persona's
     * tags, and so on.
     */
    additionalMatchingSources: Type.Array(Type.String()),

    // ── Recursion. Three flags, all earning their place. ──
    /** My content triggers nothing further. */
    preventRecursion: Type.Boolean(),
    /** I cannot be triggered recursively. */
    excludeRecursion: Type.Boolean(),
    /** I fire only during recursion. */
    delayUntilRecursion: Type.Boolean(),

    // ── The one addition ──
    /**
     * Where a retriever contributed by an extension attaches. Everything built
     * in stays a flat field above.
     */
    extensionActivations: Type.Optional(
      Type.Array(Type.Object({ by: Type.String(), config: Type.Unknown() })),
    ),

    /**
     * If this entry tracks state, its shape — as JSON Schema. The *values* live
     * in a session channel keyed by entry id, never here, because an exported
     * lorebook must not carry somebody's playthrough.
     */
    stateSchema: Type.Optional(Type.Unknown()),

    /**
     * Free string with a suggested vocabulary ("location", "item", "quest"), not
     * a closed union.
     */
    tag: Type.Union([Type.String(), Type.Null()]),
    /** Locked against automatic modification by agents. */
    locked: Type.Boolean(),
    metadata: Metadata,
  },
  {
    title: 'LoreEntry',
    description:
      'Deliberately absent: `embedding` (derived — belongs in the index, and ' +
      'would otherwise put megabytes of one install’s vector arithmetic into ' +
      'every shared lorebook), `dynamicState`, quest structures, ' +
      '`relationships`, `activationConditions` and `schedule`.',
  },
);
export type LoreEntry = Static<typeof LoreEntry>;

export const Lorebook = Type.Object(
  {
    schema: Type.Literal(LOREBOOK_SCHEMA),
    id: Id,
    name: Type.String(),
    description: Type.String(),
    /** Organisational only. Explicitly does not affect activation. */
    category: Type.Union([
      Type.Literal('world'),
      Type.Literal('character'),
      Type.Literal('npc'),
      Type.Literal('spellbook'),
      Type.Literal('uncategorized'),
    ]),

    scope: LoreScope,
    enabled: Type.Boolean(),

    /** 0 = whole session. */
    scanDepth: Type.Number({ default: 2 }),
    /** 0 = unlimited. */
    tokenBudget: Type.Number({ default: 2048 }),
    entryLimit: Type.Number({ minimum: 1, maximum: 1000, default: 100 }),
    recursiveScanning: Type.Boolean({ default: false }),
    maxRecursionDepth: Type.Number({ default: 3 }),

    folders: Type.Array(LoreFolder),
    /**
     * Optional. Hooks genuinely inseparable from this lore — eligible only while
     * this lorebook is active. Settings remain the primary home.
     */
    hooks: Type.Optional(Type.Array(PlotHook)),
    entries: Type.Array(LoreEntry),

    tags: Type.Array(Type.String()),
    /** Cover art. */
    media: Type.Array(EmbeddedMedia),
    provenance: Provenance,
    generated: GeneratedMap,
    metadata: Metadata,
  },
  {
    $id: `https://storyengine.dev/schemas/${LOREBOOK_SCHEMA}.json`,
    title: 'Lorebook',
  },
);
export type Lorebook = Static<typeof Lorebook>;
