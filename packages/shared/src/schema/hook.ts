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
  },
  {
    title: 'PlotHook',
    description:
      'Fully stable, because the rule-typed fields are gone. An earlier draft ' +
      'carried `requires?: Predicate[]` and `onFire?: Effect[]`; that ' +
      'vocabulary is 2.0, and rather than ship a /1 schema with two fields ' +
      'typed against something unwritten they are removed. They return ' +
      'additively, so the schema stays /1 when the vocabulary arrives.',
  },
);
export type PlotHook = Static<typeof PlotHook>;
