// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { type Static, Type } from '@sinclair/typebox';

import {
  EmbeddedMedia,
  GeneratedMap,
  Id,
  LoreLink,
  Metadata,
  Openings,
  Provenance,
  Ref,
} from './common.js';
import { PlotHook } from './hook.js';

/**
 * Setup — docs/design/13-schemas.md §7.
 *
 * **Setting is to Setup as a world is to a game played in it.** One Setting,
 * many Setups: *Rain City* is the world; *The Fixer's Debt*, Adventure mode,
 * playing Marlow is a way to play in it.
 *
 * A Setup is useful without ever being shared, which is the strongest argument
 * for it being a plain library object rather than part of a transport artefact.
 * Sessions are created from one **by copy** — editing a Setup afterwards cannot
 * reach a running session ([00 §3.1](docs/design/00-stance.md)).
 */

export const SETUP_SCHEMA = 'storyengine.setup/1';

export const Goal = Type.Object(
  {
    id: Id,
    /**
     * Short, always injected. "Get the ledger out of the Foundry." Difficulty
     * prompt fragments reference it by name, which is why it is present in
     * context rather than consulted on demand.
     */
    statement: Type.String(),
    /**
     * The author's fuller version. Available to steps; not injected by default,
     * so a long one costs nothing per turn.
     */
    detail: Type.Union([Type.String(), Type.Null()]),
    /**
     * "hidden" is the GM's arc — the same mechanism as a hidden channel, so the
     * reveal affordance and the budgeting are shared rather than reinvented.
     */
    visibility: Type.Union([Type.Literal('player'), Type.Literal('hidden')]),

    /**
     * "mechanical" — completion computed from channel state — waits on the
     * authored-rule vocabulary and arrives as a third variant at 2.0. Adding a
     * variant is additive.
     */
    completion: Type.Union(
      [
        /** An evaluation step judges it. */
        Type.Object({ kind: Type.Literal('narrative') }),
        /** The player says when. */
        Type.Object({ kind: Type.Literal('manual') }),
      ],
      { title: 'GoalCompletion' },
    ),

    /** Seeds the offer made at completion; never applied without asking. */
    thenDefault: Type.Union([
      Type.Literal('continue-open'),
      Type.Literal('advance'),
      Type.Literal('end'),
    ]),
    /** Authored successor, for a designed chain. null = ask. */
    next: Type.Union([Type.String(), Type.Null()]),
  },
  {
    title: 'Goal',
    description:
      'Why Goal sits on Setup rather than Setting: a Setting is a world and a ' +
      'world has no win condition. Rain City does not have an objective; The ' +
      'Fixer’s Debt does. Difficulty is deliberately not here — it is ' +
      'Adventure’s, not every mode’s, so it lives in `mode.config`.',
  },
);
export type Goal = Static<typeof Goal>;

export const Setup = Type.Object(
  {
    schema: Type.Literal(SETUP_SCHEMA),
    id: Id,
    name: Type.String(),
    /** Library-card text. Never injected. */
    blurb: Type.String(),

    mode: Type.Object({
      id: Type.String(),
      /**
       * Whatever the mode's own setup collected. Stored verbatim, never
       * interpreted by the host, so a game can always recover the options it was
       * created with — and subject to the no-production-settings rule all the
       * same ([00 §3.2](docs/design/00-stance.md)).
       */
      config: Type.Unknown(),
    }),

    /** One Setting; null = start bare. */
    setting: Type.Union([Ref, Type.Null()]),
    preset: Type.Union([Ref, Type.Null()]),

    cast: Type.Object({
      /** Offered as the played character. */
      personaOptions: Type.Array(Ref),
      /** The party always contains the persona ([03 §8](docs/design/03-modes-and-turn-pipeline.md)). */
      partyDefault: Type.Array(Ref),
      /** null = the mode's default narrator. */
      narrator: Type.Union([Ref, Type.Null()]),
    }),

    /** Beyond whatever the setting already links. */
    lore: Type.Array(LoreLink),
    /** Overrides the setting's when present. */
    openings: Openings,
    /** Additional to the setting's, not a replacement. */
    hooks: Type.Array(PlotHook),
    /**
     * Ordered: `goals[0]` is where play begins. Empty = no win condition, which
     * is the deliberate opt-out rather than the default.
     */
    goals: Type.Array(Goal),

    tags: Type.Array(Type.String()),
    media: Type.Array(EmbeddedMedia),
    provenance: Provenance,
    generated: GeneratedMap,
    metadata: Metadata,
  },
  {
    $id: `https://storyengine.dev/schemas/${SETUP_SCHEMA}.json`,
    title: 'Setup',
    description:
      'How to start playing. No connections, no credentials, no endpoint URLs, ' +
      'no per-install toggles — enforced by there being nowhere to put them.',
  },
);
export type Setup = Static<typeof Setup>;
