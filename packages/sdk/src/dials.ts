// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import type { ChannelDefinition } from './channels.js';

/**
 * The two dials a mode with a difficulty declares —
 * [06 §7.3.1](../../../docs/design/06-modes-and-turn-pipeline.md), [06 §7.3.2],
 * built at [P7.8](../../../docs/design/workplan/23-p7-implementation.md).
 *
 * ***In the contract rather than in the engine, and that is the decision this
 * file is.*** These could have been two `ChannelDefinition` literals inside each
 * mode that wants them, and that is what a mode author would write without this
 * — three policy choices (`user-only`, `player`-visible, an enum-free schema)
 * restated per mode, each of them arguable, none of them local. The second
 * restatement is where they stop agreeing, and a dial that is `user-only` in one
 * mode and `model-proposed` in another is [06 §7.3.1]'s sycophancy dial wired to
 * the sycophant in half the build.
 *
 * **The ids are shared on purpose**, which is the half that needs stating
 * because it looks like engine knowledge leaking into modes. It is the
 * opposite: a **surface** — one HUD row, one route, one workbench line — can
 * only exist for a channel two modes declare independently if they declare it
 * under one id. [06 §4] already scopes ids to the registry rather than to a
 * mode, so nothing here is new except the spelling being handed out instead of
 * guessed.
 *
 * *And a mode with no difficulty declares neither*, which is the discrimination
 * [04 §7](../../../docs/design/04-schemas.md) says Setup could not express:
 * *"Modelling it on Setup would imply Messages and Scene have a difficulty,
 * which they do not."* Scene has none because it calls neither of these, which
 * is a fact about Scene's declaration rather than a blank field on a record.
 */

/**
 * Where a dial's live value lives — ***the answer to
 * [04 §7](../../../docs/design/04-schemas.md)'s standing `[OPEN]`***, which
 * predicted this stage by name.
 *
 * That paragraph: *"Where difficulty's **live** value lives is a question this
 * paragraph does not answer, and did not used to have to. `mode.config` is
 * opaque to the host by design, while [06 §7.3.1] requires difficulty to be
 * 'changeable mid-session, recorded as an effect like anything else' — and an
 * effect path cannot carry something the host has no schema for."* It then names
 * its own trigger: *"it stays open for the first one that does not [follow hook
 * pacing's precedent] — which will be a dial belonging to a single mode, since
 * that is what puts a value in `mode.config` and out of the host's reach."*
 *
 * **Difficulty is that dial, and the answer is a channel the *mode* declares.**
 * Which is not the escape it looks like. The question was posed when a channel
 * could only be engine-owned, and it framed the choice as *`mode.config` (opaque,
 * cannot take an effect)* against *Setup (would imply Messages and Scene have a
 * difficulty, which they do not)*. P7 added a third option that did not exist
 * when the paragraph was written: a mode declares its own channels, the registry
 * enforces them, and the engine special-cases nothing. So:
 *
 * - **`mode.config` keeps the setup answer**, which is what a wizard collected
 *   and what [04 §7]'s *"opaque to the host"* was protecting. It is read here as
 *   a rung and never written.
 * - **The channel carries the live value**, so changing it mid-session is an
 *   ordinary effect with an ordinary record — 7.3.1's *"predictable failure is
 *   picking Hard, discovering every scene is a slog by turn 30, and having no
 *   recourse but to start over"*.
 * - **A mode with no difficulty declares neither channel**, which is exactly the
 *   discrimination Setup could not express. Scene and Messages have no
 *   difficulty because they declare none — not because a field was left blank.
 *
 * *The ids are fixed and the declarations are the mode's*, which is the one part
 * that looks inconsistent and is not: a shared id is what lets a **surface**
 * exist — one panel, one route, one workbench row — for a channel two modes
 * declare independently. [06 §4] already requires an id to be unique per
 * registry rather than per mode, and {@link dialChannel} is exported so
 * the second mode to want one spells it the same way rather than nearly.
 */
export const SE_DIFFICULTY = 'se.difficulty';
export const SE_DIRECTEDNESS = 'se.directedness';

export type DialAxis = 'difficulty' | 'directedness';

export const DIAL_CHANNELS: Record<DialAxis, string> = {
  difficulty: SE_DIFFICULTY,
  directedness: SE_DIRECTEDNESS,
};

/**
 * The declaration a mode with a difficulty makes.
 *
 * ***`user-only`, and it is the build's second*** — after hook pacing, which
 * [P7.5] made the first. The policy is not a guess: 7.3.1 wants this changeable
 * *"mid-session, recorded as an effect like anything else"*, and the actor that
 * changes it is a person deciding the game is too easy. **A `model-proposed`
 * difficulty would be a narrator voting on how hard it should be on you**, which
 * is the sycophancy 7.3.1 calls the dial's whole subject, wired directly to the
 * dial. `engine-computed` would be worse in a quieter way — a dynamic-difficulty
 * system nobody asked for, and [00 §3.2]'s *no production settings* has the same
 * shape of objection to it.
 *
 * ***No enum in the schema, which is the deliberate half of this declaration.***
 * The levels are the pack's, so a build cannot know them: a preset that ships
 * five levels is as valid as one that ships three, and
 * [04 §8.2](../../../docs/design/04-schemas.md)'s *"unions that must stay
 * open"* is the same argument one layer down. What checks a value is
 * `resolveLevel` (engine-side), at the point of use, against the preset actually in
 * play — and a value this preset does not know **reads as unset rather than as
 * itself**, which is `readPacing`'s posture and the only one that survives an
 * author swapping packs mid-session.
 *
 * *`visibility: 'player'`, because the dial is the player's own setting and the
 * HUD is where a setting belongs. The fragments it selects are hidden content;
 * the level's **name** is not, and a player who cannot see that they are on Hard
 * has a setting with no surface — which [work plan §2.3] says no phase may
 * exit with.*
 *
 * `init` is `{ kind: 'authored', field }` for the reason hook pacing's is: the
 * arm names the field and `readDial` (engine-side) finds it, because `initialValue`
 * returns the fallback without consulting anything an author wrote and a channel
 * module *"has no business reading"* a session's config.
 */
export function dialChannel(axis: DialAxis, owner: string): ChannelDefinition {
  return {
    id: DIAL_CHANNELS[axis],
    owner,
    version: 1,
    scope: 'session',
    update: 'user-only',
    visibility: 'player',
    // `null` is in the schema, and it is the invariant `mode-loader.test.ts`
    // holds every channel to since [P7.5]: a channel that cannot be written its
    // own `init` cannot be put back, and *unset* is a state this one has to be
    // able to return to when a session moves to a pack with different levels.
    schema: { type: ['string', 'null'] },
    init: { kind: 'authored', field: axis, fallback: null },
    budget: null,
  };
}

/*
 * ***No `DIFFICULTY_CHANNEL` constant here, and its absence is the point.***
 * A ready-made pair would need an `owner`, and the only owner available to this
 * file is a generic one — at which point two modes share an owner string that
 * describes neither, and the channel is engine-owned in everything but name.
 * [06 §4] makes `owner` the thing a person reads to find out *who is
 * responsible for this value*, so the builder takes it and every mode answers.
 */
