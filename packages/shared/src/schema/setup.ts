// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { type Static, Type } from '@sinclair/typebox';

import {
  TagIdList,
  EmbeddedMedia,
  GeneratedMap,
  HookPacing,
  Id,
  LoreLink,
  Metadata,
  Openings,
  Provenance,
  Ref,
} from './common.js';
import { PlotHook } from './hook.js';

/**
 * Setup — docs/design/04-schemas.md §7.
 *
 * **Treatment is to Setup as a reading of a world is to a game played under it.**
 * One Treatment, many Setups: *Rain City, noir* is the reading; *The Fixer's
 * Debt*, Adventure mode, playing Marlow is a way to play under it.
 *
 * A Setup is useful without ever being shared, which is the strongest argument
 * for it being a plain library object rather than part of a transport artefact.
 * Sessions are created from one **by copy** — editing a Setup afterwards cannot
 * reach a running session ([00 §3.1](../../../../docs/design/00-stance.md)).
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
      'Why Goal sits on Setup rather than Treatment: a treatment frames a ' +
      'world, and a world has no win condition. Rain City does not have an ' +
      'objective; The Fixer’s Debt does. Difficulty is deliberately not ' +
      'here — it is Adventure’s, not every mode’s, so it lives in `mode.config`.',
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
       * same ([00 §3.2](../../../../docs/design/00-stance.md)).
       */
      config: Type.Unknown(),
    }),

    /** One Treatment; null = start bare. */
    treatment: Type.Union([Ref, Type.Null()]),
    preset: Type.Union([Ref, Type.Null()]),

    cast: Type.Object({
      /** Offered as the played character. */
      personaOptions: Type.Array(Ref),
      /** The party always contains the persona ([06 §8](../../../../docs/design/06-modes-and-turn-pipeline.md)). */
      partyDefault: Type.Array(Ref),
      /** null = the mode's default narrator. */
      narrator: Type.Union([Ref, Type.Null()]),
    }),

    /** Beyond whatever the treatment already links. */
    lore: Type.Array(LoreLink),
    /** Overrides the treatment's when present. */
    openings: Openings,
    /** Additional to the treatment's, not a replacement. */
    hooks: Type.Array(PlotHook),
    /**
     * Ordered: `goals[0]` is where play begins. Empty = no win condition, which
     * is the deliberate opt-out rather than the default.
     */
    goals: Type.Array(Goal),

    /**
     * **Advisory, optional, and authorial** — [04 §6.1b](../../../../docs/design/04-schemas.md),
     * added at [P7.1](../../../../docs/design/workplan/23-p7-implementation.md).
     *
     * `hookPacing` says how much authored plot should be pushed at a player;
     * `stagingNotes` asks the narrator for turns that stage well
     * ([06 §10.6](../../../../docs/design/06-modes-and-turn-pipeline.md)). Both
     * are intent about *the material* rather than settings for one playthrough,
     * both hold no endpoint and no key, and neither becomes a production setting
     * by being live ([00 §3.2](../../../../docs/design/00-stance.md)).
     *
     * **Optional on both Treatment and Setup, because a required field added to
     * a published `/1` is a `/2` change** ([04 §2](../../../../docs/design/04-schemas.md)).
     * Absent means *unspecified* — not `normal`, and not empty prose — which the
     * session resolves through the channel's `init`.
     */
    hookPacing: Type.Optional(HookPacing),
    stagingNotes: Type.Optional(Type.String()),

    /**
     * ***What had already happened*** — [04 §7.2](../../../../docs/design/04-schemas.md),
     * added at [P13.1](../../../../docs/design/workplan/30-p13-implementation.md).
     *
     * **Set when a Setup is made from a turn of a running session**, and
     * hand-writable like any other prose here. A session started from it gets
     * this as the **root of its rolling summary**: the `summary` slot emits it as
     * the oldest link from the first turn, and the first link the summariser
     * derives folds it in as `previous` — [07 §5.1]'s chain with a seeded start
     * rather than a second mechanism beside it.
     *
     * *Optional for `stagingNotes`' reason*: a required field added to a
     * published `/1` is a `/2` change. Absent is a fresh start, and so is empty
     * — nobody means *the story so far is nothing* by writing nothing.
     */
    storySoFar: Type.Optional(Type.String()),
    /**
     * ***Hooks that have already fired before play begins*** — [04 §7.2],
     * [P13.1].
     *
     * **Ids, and the ids of every source's hooks**, not only this Setup's own.
     * The hook pool is rebuilt from the treatment and the lorebooks when a
     * session starts, so a treatment's hook that fired before the point this
     * Setup was made from would otherwise be in the new pool fresh and fire a
     * second time. A session started from this marks each one `fired` on its
     * opening turn — through the ordinary effect path, so a rewind past the
     * opening un-spends them like anything else.
     *
     * *Portable because hook ids are*: [15 §5.1](../../../../docs/design/15-world.md)
     * obliges every copy of a hook to keep its source's id, so an id written
     * here names the same hook in a package's treatment on another install. An
     * id that names nothing in the pool is ignored rather than refused — a
     * Setup whose treatment was swapped should still start.
     */
    spentHooks: Type.Optional(Type.Array(Type.String())),

    tags: Type.Array(Type.String()),
    /** See {@link TagIdList} — the registry side of `tags`. */
    tagIds: Type.Optional(TagIdList),
    media: Type.Array(EmbeddedMedia),
    provenance: Provenance,
    generated: GeneratedMap,
    metadata: Metadata,
  },
  {
    $id: `https://storyengine.dev/schemas/${SETUP_SCHEMA.replace('/', '.')}.json`,
    title: 'Setup',
    description:
      'How to start playing. No connections, no credentials, no endpoint URLs, ' +
      'no per-install toggles — enforced by there being nowhere to put them.',
  },
);
export type Setup = Static<typeof Setup>;
