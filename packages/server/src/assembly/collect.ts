// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import type { Actor, Preset, PresetBlock } from '@storyengine/shared';

import type { ChannelState, Turn } from '../sessions/types.js';
import type { Candidate } from './types.js';

/**
 * Step 1 of [03 §5](../../../../docs/design/03-modes-and-turn-pipeline.md) — collect.
 *
 * P2.4 built steps 2 to 4 (annotate, budget, render) and left this one until
 * there was a preset to drive it. This is that: the preset supplies the blocks,
 * in the order it declares them, and the engine fills each one.
 *
 * **It lives in `assembly/` rather than on a mode.** [03 §5] says the assembly
 * plan *does not build strings*, and this builds strings — so a `collect()`
 * hanging off a mode would be the back door §2 rules out, and would also make
 * the collector P4 needs for imported presets a second implementation. One
 * collector, driven by data, is what lets an imported preset work the day it
 * lands.
 */

export interface CollectContext {
  preset: Preset;
  /** What kind of call this is; a block's `appliesTo` filters on it. */
  callKind: string;
  /** Oldest first, already windowed by the mode's `historyWindow`. */
  history: readonly Turn[];
  persona: Actor | null;
  actors: readonly Actor[];
  channels: Readonly<Record<string, ChannelState>>;
  input?: { text: string };
  guidance?: string;
}

export function collectCandidates(context: CollectContext): Candidate[] {
  const sequence: Candidate[] = [];
  /** In-history blocks, held back until the history run is known. */
  const injected: { fromEnd: number; tiebreak: number; order: number; candidates: Candidate[] }[] =
    [];
  let historyStart: number | null = null;
  let historyCount = 0;

  for (const [order, block] of context.preset.blocks.entries()) {
    if (!block.enabled) continue;
    // Empty means all — which is what dissolves the eight special-cased
    // template fields [10 §8.4.3] describes.
    if (block.appliesTo.length > 0 && !block.appliesTo.includes(context.callKind)) continue;

    const filled = fill(block, context);
    if (filled.length === 0) continue;

    if (block.placement.at === 'in-history') {
      injected.push({
        fromEnd: block.placement.fromEnd,
        tiebreak: block.placement.tiebreak ?? 0,
        order,
        candidates: filled,
      });
      continue;
    }

    if (block.kind === 'slot' && block.source.of === 'history') {
      historyStart = sequence.length;
      historyCount = filled.length;
    }
    sequence.push(...filled);
  }

  return splice(sequence, injected, historyStart, historyCount);
}

/**
 * Puts in-history blocks where the preset asked for them — [10 §8.2].
 *
 * **The one placement that is not just list order.** `fromEnd: 0` goes after
 * the newest turn, `fromEnd: k` before the k-th from the end. P2.4 promised
 * history would be splittable *from the start* precisely so this could work, and
 * P4 imports presets that use it — SillyTavern's depth injection is exactly this
 * and its files carry the depths. Until now `placement` was read by nothing, so
 * an imported preset's depths were silently flattened into declaration order:
 * not a refusal anybody could see, just a different prompt.
 *
 * With no history run to splice into, they land at the end of the sequence —
 * which is where a depth-addressed block goes when there is nothing to be at a
 * depth *in*.
 */
function splice(
  sequence: Candidate[],
  injected: { fromEnd: number; tiebreak: number; order: number; candidates: Candidate[] }[],
  historyStart: number | null,
  historyCount: number,
): Candidate[] {
  if (injected.length === 0) return sequence;

  /**
   * **Grouped by depth, then spliced once per depth.**
   *
   * Two blocks at one depth cannot be spliced one after the other at the same
   * index: the second insertion pushes the first rightwards, so they come out
   * in the reverse of the order asked for. Building each depth's run first and
   * inserting it whole is the only version that reads the way it is written.
   */
  const byDepth = new Map<number, typeof injected>();
  for (const entry of injected) {
    byDepth.set(entry.fromEnd, [...(byDepth.get(entry.fromEnd) ?? []), entry]);
  }

  const out = [...sequence];
  // Deepest first, so a shallower insertion is not shifted by an earlier one.
  for (const depth of [...byDepth.keys()].sort((a, b) => b - a)) {
    const group = (byDepth.get(depth) ?? []).sort(
      // The author's explicit number, then declaration order. Dropping either
      // would reorder somebody's prompt with nothing to show for it.
      (a, b) => a.tiebreak - b.tiebreak || a.order - b.order,
    );
    const run = group.flatMap((entry) => entry.candidates);

    if (historyStart === null) {
      out.push(...run);
      continue;
    }
    // Clamped: a depth past the start of the run lands at its start rather than
    // outside it, which is what a preset written for a longer history means.
    out.splice(historyStart + historyCount - Math.min(depth, historyCount), 0, ...run);
  }
  return out;
}

function fill(block: PresetBlock, context: CollectContext): Candidate[] {
  if (block.kind === 'text') {
    /**
     * **Liquid is not implemented, and the line is sharp.** A wrapper's
     * `{{content}}` is one fixed placeholder the schema defines exactly; a
     * template is a *language*, and it arrives with variable interpolation and
     * imported presets, which is P4's review surface. So a `{{char}}` reaches
     * the model as literal braces — visible in the turn record rather than
     * silently wrong.
     */
    return emit(block, block.template, { kind: 'preset', blockId: block.id }, undefined);
  }

  const source = block.source;
  switch (source.of) {
    case 'persona':
      return emit(block, personaText(context.persona), { kind: 'persona' }, undefined);

    case 'actor':
      // One candidate per actor, so the budgeter can drop one and keep another.
      return context.actors.flatMap((actor) =>
        emit(
          block,
          actorText(actor, source),
          actorSource(actor.id, source),
          `${block.id}.${actor.id}`,
        ),
      );

    case 'history': {
      /**
       * **Two candidates per turn — the player's words as `user`, the model's
       * as `assistant`** — F36. Oldest cheapest, as before.
       *
       * P2.4 promised history would be a splittable source *from the start*,
       * and this is the consumer: one block for the whole transcript would
       * make the budgeter's only move dropping all of it.
       *
       * **It was splittable by turn and not by speaker, and that was wrong on
       * the wire.** A completed turn became a single block labelled
       * `assistant` holding the input and the output joined by a newline — so
       * **every message the player had ever typed was attributed to the**
       * **model**, and what a provider saw was one long assistant monologue
       * with the user's lines quoted inside it. Invisible on screen and
       * visible only on the wire, which is why it survived a survey, four
       * phases and six audits.
       *
       * **Both halves share one priority**, so a turn stays one unit in the
       * budgeter's ordering rather than two things trimmed apart at whim. The
       * tie-break does the rest, correctly: *later-listed first within a
       * priority* means the **reply** goes before the prompt it answered,
       * leaving two consecutive user messages — coherent — rather than an
       * assistant message with nothing before it.
       *
       * *A boundary can still split one turn*, because the budgeter has no
       * concept of a group and this does not invent one. Known, and cheap to
       * live with: it costs the oldest surviving turn its reply, which is the
       * least valuable thing in the window.
       */
      const halves = [
        { of: 'input' as const, role: 'user' as const },
        { of: 'output' as const, role: 'assistant' as const },
      ];

      return context.history.flatMap((turn, index) =>
        halves.flatMap(({ of, role }) => {
          const text = of === 'input' ? turn.input?.text : turn.output?.text;
          if (text === undefined || text.length === 0) return [];
          return emit(
            { ...block, priority: block.priority + index, role },
            text,
            { kind: 'history', range: [index, index], part: of },
            `${block.id}.${String(index)}.${of}`,
          );
        }),
      );
    }

    case 'guidance':
      /**
       * **Advisory is forced here, never read from the block.**
       *
       * `assemble`'s refusal keys on the candidate's flag and not on where the
       * words came from, so a preset declaring `advisory: false` on its guidance
       * slot would walk guidance straight into an effects call. [03 §5.2] says
       * enforce it *structurally*; a flag an author can clear is not structural.
       */
      return emit(block, context.guidance ?? '', { kind: 'guidance', producer: 'user' }, undefined);

    case 'input':
      /**
       * **Required is forced too**, and `PresetBlock` has no `required` field at
       * all — which is the portable schema agreeing. A preset that could mark
       * the player's action droppable would not produce a shorter prompt; it
       * would produce the wrong one.
       */
      return emit(block, context.input?.text ?? '', { kind: 'input' }, undefined);

    /**
     * Nothing, each for its own stated reason. Lore is P5, and the slot
     * *rendering empty* is what makes that an activation change rather than a
     * preset change; a P2.6 session carries no Treatment; the Actor schema has no
     * example-dialogue field, deliberately; goals are Setup-borne; and a channel
     * value is an object with no channel-to-text renderer specified — which is
     * also why the clock's budget is null.
     */
    case 'lore':
    case 'setting':
    case 'examples':
    case 'goal':
    case 'channel':
      return [];

    default:
      /**
       * A slot kind from a newer build. **Never a throw**: the shared Ajv
       * preserves unknown fields, so a preset written against a later schema
       * validates and arrives here, and refusing it would make one unknown slot
       * cost somebody their whole session.
       */
      return [];
  }
}

/**
 * Turns filled text into a candidate, applying the wrapper and the empty rule.
 *
 * `omitWhenEmpty` is read literally — *drop the block rather than emit a heading
 * with nothing under it*. With it false the wrapper is emitted around nothing,
 * which is an author's explicit choice and occasionally the right one.
 */
function emit(
  block: PresetBlock,
  text: string,
  source: Candidate['source'],
  id: string | undefined,
): Candidate[] {
  if (text.length === 0 && block.omitWhenEmpty) return [];

  const wrapped =
    block.kind === 'slot' && block.wrapper !== undefined
      ? block.wrapper.replace('{{content}}', text)
      : text;

  // The union, not the special case: an author- or import-declared advisory
  // block is advisory too, or the firewall only covers the one slot somebody
  // remembered.
  const advisory = block.advisory || (block.kind === 'slot' && block.source.of === 'guidance');
  const required = block.kind === 'slot' && block.source.of === 'input';

  return [
    {
      id: id ?? block.id,
      source,
      // Author-facing English, as P2.5 established for `reason`. Turning these
      // into a key and params is recorded as P11 sweep debt.
      reason: block.label,
      role: block.role,
      text: wrapped,
      priority: block.priority,
      ...(advisory ? { advisory: true } : {}),
      ...(required ? { required: true } : {}),
    },
  ];
}

function personaText(persona: Actor | null): string {
  if (persona === null) return '';
  return persona.profile.sections
    .filter((section) => section.disposition === 'always')
    .map((section) => section.body)
    .filter((body) => body.length > 0)
    .join('\n\n');
}

function actorText(actor: Actor, source: { sectionId?: string; field?: string }): string {
  if (source.sectionId !== undefined) {
    return actor.profile.sections.find((section) => section.id === source.sectionId)?.body ?? '';
  }
  // `visual` is structured data for an image pipeline ([10 §4]) with no prose
  // renderer specified, so only `traits` has a text form.
  return source.field === 'traits' ? actor.profile.traits.join(', ') : '';
}

function actorSource(
  actorId: string,
  source: { sectionId?: string; field?: string },
): Candidate['source'] {
  if (source.sectionId !== undefined)
    return { kind: 'actor', actorId, sectionId: source.sectionId };
  return { kind: 'actor', actorId, field: source.field === 'visual' ? 'visual' : 'traits' };
}
