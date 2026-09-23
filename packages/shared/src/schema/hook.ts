// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { type Static, Type } from '@sinclair/typebox';

import { Id, Ref } from './common.js';

/**
 * PlotHook — docs/design/04-schemas.md §6.1.
 *
 * A pool of authored, discrete plot turns, held out of context until a selector
 * judges the moment right. The inverse of a rule: a rule is condition-first, a
 * hook is a Y looking for its moment.
 *
 * Its own module rather than living in `setting.ts`, because a Lorebook may
 * carry hooks too (§5) and one of the two would otherwise have to import the
 * other.
 */

/**
 * One written way for a character to arrive — [04 §6.1a].
 *
 * **`text` is content and `note` is not.** The text is what a narrator weaves;
 * the note says *when this entrance fits* and is guidance to the **selector**,
 * which 04 §6.1a is careful to distinguish from `Opening.note`'s meaning —
 * *this steers the expansion* — because that has nothing to say about a written
 * alternate.
 *
 * *`label` is what a panel shows.* [08 §6] and [10 §10.1] both require that an
 * unfired entrance is shown **by label, never by text**: an unfired entrance is
 * hidden content, and a panel that spoils the arrival defeats the feature. The
 * label exists so there is something to show that is not the spoiler.
 */
export const Entrance = Type.Object(
  {
    id: Id,
    label: Type.String(),
    text: Type.String(),
    /**
     * When this entrance fits — guidance to the *selector*, not to the narrator.
     */
    note: Type.Optional(Type.String()),
  },
  { title: 'Entrance' },
);
export type Entrance = Static<typeof Entrance>;

/**
 * A character as a hook — [04 §6.1a].
 *
 * **`premise` is the instruction; `entrances` are the content**, which is the
 * division `Openings` makes in [04 §3] and which settles `delivery` without a
 * new arm: with entrances present, `guidance` weaves the chosen one; with none,
 * `seed` expands the premise into an arrival. *The borrowing stops there —
 * there is no expand-then-promote path and no `fromPremiseId`, because nothing
 * here plays the part `Openings.seeds` plays.*
 *
 * **A dangling `actor` is a broken hook, not a retired one**, and 04 §6.1a calls
 * this the one place `Ref`'s never-block rule needs a second answer. A dangling
 * `involves` entry retires a hook quietly, which is mercy for a cast that is
 * gone; a dangling subject can never succeed at all — there is no actor to
 * introduce — so it is ineligible **with a visible reason** and the author is
 * told. Same field type, opposite treatment.
 */
export const Introduction = Type.Object(
  {
    actor: Ref,
    /**
     * Written alternates. **Empty is legal**: then `premise` steers an
     * improvised arrival, and an empty `premise` is legal when these are
     * present — the entrances are the content, and the selector's judgement pass
     * reads the labels where there is no premise to read.
     */
    entrances: Type.Array(Entrance),
    /**
     * The one a manual fire uses, and the one the editor shows first.
     *
     * **Not *always use this***, which 04 §6.1a says in as many words: the
     * selector otherwise draws across all of them. `null` is the ordinary state
     * of a hook whose author did not pick a favourite.
     */
    primaryEntranceId: Type.Union([Type.String(), Type.Null()]),
  },
  { title: 'Introduction' },
);
export type Introduction = Static<typeof Introduction>;

export const PlotHook = Type.Object(
  {
    id: Id,
    /** For the author's list. Never injected. */
    title: Type.String(),
    /** The content, handwritten. */
    premise: Type.String(),
    /**
     * Blast radius, not location — how big a turn this is. Named `magnitude`
     * rather than `scope` because a Lorebook's `scope` answers a different
     * question (where a book applies), and one word for two axes in two
     * portable schemas is a trap. §6.1.
     */
    magnitude: Type.Union([
      Type.Literal('sweeping'),
      Type.Literal('local'),
      Type.Literal('personal'),
    ]),

    // ── Eligibility. Checked mechanically, before any model call. ──
    /**
     * Moot if these are dead, gone, or never introduced. Not bookkeeping:
     * firing a hook about someone who died four sessions ago destroys
     * confidence in the mechanism in one message.
     */
    involves: Type.Array(Ref),
    /** Hook ids that make this nonsensical. */
    blockedBy: Type.Optional(Type.Array(Type.String())),
    notBefore: Type.Optional(
      Type.Object({
        turn: Type.Optional(Type.Number()),
        afterHook: Type.Optional(Type.String()),
      }),
    ),

    // ── Selection and firing ──
    /** Relative likelihood among eligible hooks. */
    weight: Type.Number(),
    delivery: Type.Union([
      Type.Literal('guidance'),
      Type.Literal('seed'),
      Type.Literal('immediate'),
    ]),
    once: Type.Boolean(),

    /**
     * Present when the hook **is** a character's arrival rather than an event —
     * [04 §6.1a](../../../../docs/design/04-schemas.md), added at
     * [P7.5](../../../../docs/design/workplan/23-p7-implementation.md).
     *
     * **Optional, so the schema stays `/1`.** [04 §2] makes a *required* field on
     * a published schema a `/2` change and an optional one additive — the same
     * argument `hookPacing` and `stagingNotes` were added under at [P7.1].
     * Nothing that reads a hook today has to change, and nothing that wrote one
     * yesterday becomes invalid.
     *
     * **It earns a field rather than being an ordinary hook with a name in its
     * premise** because it needs the **opposite** eligibility test, and there is
     * nowhere else to say so: `involves` means *dead, gone, or never
     * introduced*, and an introduction hook is eligible only while its subject
     * is **not** introduced. One field cannot mean *must be here* and *must not
     * be here* at once, which is why the subject is declared here and `involves`
     * stays available for the other characters an entrance depends on — *only if
     * her brother is still alive*.
     *
     * *`once` is moot when this is present, and 04 §6.1a calls that better than
     * a constraint: introduction is monotone along a path and the predicate
     * already excludes an introduced subject, so the hook is self-limiting
     * whatever the flag says. Refusing `once: false` would be the stable tier's
     * first validation refusal and would buy nothing.*
     */
    introduces: Type.Optional(Introduction),
  },
  {
    title: 'PlotHook',
    description:
      'Fully stable, because the rule-typed fields are gone. An earlier draft ' +
      'carried `requires?: Predicate[]` and `onFire?: Effect[]`; that ' +
      'vocabulary is 6.0, the authoring tier, and rather than ship a /1 ' +
      'schema with two fields typed against something unwritten they are ' +
      'removed. They return additively, so the schema stays /1 when the ' +
      'vocabulary arrives — which is the same door `introduces` came through ' +
      'at P7.5.',
  },
);
export type PlotHook = Static<typeof PlotHook>;
