// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import type { ClosureEdge, ClosureRule } from '@storyengine/shared';

import { labels } from '../../i18n/catalogue.js';

/**
 * ***Why each thing is in the file, one sentence per rule*** —
 * [16 §5](../../../../../docs/design/16-publish.md)'s *every level is shown*,
 * [04 §9.1](../../../../../docs/design/04-schemas.md)'s table read as prose,
 * [P16.3g](../../../../../docs/design/workplan/34-p16-world.md).
 *
 * **Typed `Record<ClosureRule, string>`, so a rule with no sentence does not
 * compile.** `shared/src/publish.ts` says this is what its union is shaped for:
 * *"The client keys its labels by this union with a `Record<ClosureRule, …>`,
 * so a rule added here with no sentence there is a compile error rather than a
 * dotted string on screen."* A rule the walker learns tomorrow — the owner's
 * answers of 2026-10-10 added three in an afternoon — breaks the client's build
 * until somebody writes what it means, which is the only moment anybody will.
 * `reasons.test.ts` holds the same thing at run time, against the union as
 * written in `shared`, so a build that skipped the typecheck still fails.
 *
 * **Per field, not per row**, because the table's rows follow fields for
 * different reasons — a hook's `involves` is who it is about, its
 * `introduces.actor` who it brings in — and the review states every reason as
 * text ([P16.3]'s plan: *no reason only in a hover title*).
 *
 * *`{from}` is the name of what names it*: every rule but the three that begin
 * at the start (`selected`, `world.member`, `world.scopedBook`) is an edge from
 * a node, and the sentence says which. The kind is in the sentence rather than
 * in the name, so a treatment and a setup that share a name still read apart.
 *
 * ***`session.cast.arrived` is worded as the walker computes it*** — *in play,
 * not in the configured cast* — and never as an arrival: the rule also holds
 * of somebody taken off the roster, or a former persona, who still holds
 * channel state, and a sentence promising *the story walked them in* would be
 * false of them (`shared/src/publish.ts`, the arm's own docstring; [P16.3b]'s
 * correction of row 13).
 */
export const REASON_LABELS: Readonly<Record<ClosureRule, string>> = labels('publish.reason', {
  selected: 'You chose it.',
  'world.member': 'A member of this world.',
  'world.scopedBook': 'A book scoped to this world: it says it belongs here.',
  'treatment.lore': 'The treatment “{from}” links it as lore.',
  'treatment.cast': 'In the cast of the treatment “{from}”.',
  'treatment.hooks.involves': 'A plot hook in the treatment “{from}” is about it.',
  'treatment.hooks.introduces': 'A plot hook in the treatment “{from}” brings it into the story.',
  'actor.lore': 'The character “{from}” links it as their own lore.',
  'setup.treatment': 'The setup “{from}” starts from it.',
  'setup.lore': 'The setup “{from}” links it as lore.',
  'setup.cast.personaOptions': 'The setup “{from}” offers it as a persona to play.',
  'setup.cast.partyDefault': 'The setup “{from}” puts it in the party.',
  'setup.cast.narrator': 'The setup “{from}” has it narrate.',
  'setup.hooks.involves': 'A plot hook in the setup “{from}” is about it.',
  'setup.hooks.introduces': 'A plot hook in the setup “{from}” brings it into the story.',
  'setup.preset': 'The setup “{from}” plays with it as its preset.',
  'lorebook.hooks.involves': 'A plot hook in the lorebook “{from}” is about it.',
  'lorebook.hooks.introduces': 'A plot hook in the lorebook “{from}” brings it into the story.',
  'session.treatment': 'The session “{from}” is played under it.',
  'session.lore': 'The session “{from}” reads it as lore.',
  'session.cast.persona': 'The session “{from}” is played as this persona.',
  'session.cast.actors': 'In the configured cast of the session “{from}”.',
  'session.cast.arrived': 'In play in the session “{from}”, though not in its configured cast.',
  'session.hooks.involves': 'A plot hook in the session “{from}” is about it.',
  'session.hooks.introduces': 'A plot hook in the session “{from}” brings it into the story.',
});

/**
 * ***One edge, said*** — its rule's sentence with the name of what names it.
 * A rule this build has no sentence for (a newer server's) is said as itself,
 * the catalogue's posture for an unknown key: visible, never blank.
 */
export function reasonFor(edge: Pick<ClosureEdge, 'rule'>, fromName: string): string {
  const template = (REASON_LABELS as Readonly<Record<string, string | undefined>>)[edge.rule];
  return template === undefined ? edge.rule : template.replace('{from}', () => fromName);
}
