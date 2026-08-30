// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import type { Actor, Preset, PresetBlock } from '@storyengine/shared';

import type { ChannelState, Turn } from '../sessions/types.js';
import { renderTemplate, type RenderContext } from './template.js';
import type { Candidate, NotFilledReason, NotFilledSlot } from './types.js';

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
  /** With the hash of the bytes that were read, so the source can say which ([P3.0]). */
  persona: { actor: Actor; contentHash: string } | null;
  actors: readonly { actor: Actor; contentHash: string }[];
  channels: Readonly<Record<string, ChannelState>>;
  input?: { text: string };
  guidance?: string;
}

export interface Collected {
  candidates: Candidate[];
  /**
   * Every preset block that emitted nothing, with the reason as a class —
   * [P3.0]'s §7.5 decision. On the one real turn measured before this
   * existed, ten of twelve blocks left no row, and the panel could not answer
   * *why is there no lore in this prompt*. Now the record can.
   */
  notFilled: NotFilledSlot[];
}

export function collectCandidates(context: CollectContext): Collected {
  const sequence: Candidate[] = [];
  const notFilled: NotFilledSlot[] = [];
  /** In-history blocks, held back until the history run is known. */
  const injected: { fromEnd: number; tiebreak: number; order: number; candidates: Candidate[] }[] =
    [];
  let historyStart: number | null = null;
  let historyCount = 0;

  const skipped = (block: PresetBlock, reason: NotFilledReason): void => {
    notFilled.push({ blockId: block.id, source: sourceKindOf(block), reason });
  };

  for (const [order, block] of context.preset.blocks.entries()) {
    if (!block.enabled) {
      skipped(block, 'disabled');
      continue;
    }
    // Empty means all — which is what dissolves the eight special-cased
    // template fields [10 §8.4.3] describes.
    if (block.appliesTo.length > 0 && !block.appliesTo.includes(context.callKind)) {
      skipped(block, 'not-applicable');
      continue;
    }

    const filled = fill(block, context);
    if (filled.length === 0) {
      skipped(block, emptyReason(block));
      continue;
    }

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

  return { candidates: splice(sequence, injected, historyStart, historyCount), notFilled };
}

/** The slot's source kind for a not-filled row; `'preset'` for a text block. */
function sourceKindOf(block: PresetBlock): string {
  return block.kind === 'text' ? 'preset' : block.source.of;
}

/**
 * Why `fill()` came back empty, computed from the block rather than threaded
 * through it — the reasons are structural per source kind, and keeping
 * `fill()`'s signature simple keeps its eleven arms readable.
 */
function emptyReason(block: PresetBlock): NotFilledReason {
  if (block.kind === 'text') return 'empty-source';
  switch (block.source.of) {
    case 'lore':
    case 'treatment':
    case 'goal':
    case 'channel':
      // The same list `fill()` returns nothing for, each for its stated
      // reason — no producer at this phase.
      return 'no-producer';

    case 'samples':
      /**
       * **The one source kind whose reason depends on which carrier it names**,
       * because the carriers landed at different times. A slot naming the
       * Treatment or the Lorebook has no producer at all — a session references
       * neither — while the actor arm is live, so its emptiness means the cast
       * simply has no samples. Collapsing both to `no-producer` would tell an
       * author their preset is waiting on the engine when it is waiting on them.
       */
      return block.source.from === 'treatment' || block.source.from === 'lore'
        ? 'no-producer'
        : 'empty-source';
    case 'persona':
    case 'actor':
    case 'history':
    case 'guidance':
    case 'input':
      return 'empty-source';
    default:
      return 'unknown-slot';
  }
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

/**
 * The closed namespace a template may see ([P4 §1.6]).
 *
 * `char` is the first cast actor, which is what SillyTavern's `{{char}}` means
 * in a one-character chat and the only reading available until party arrives at
 * P7. `user` falls back to a neutral word rather than to an empty string,
 * because a template reading *"You are talking to ."* is worse than one reading
 * *"You are talking to the player."*
 */
function renderContextOf(context: CollectContext): RenderContext {
  return {
    char: context.actors[0]?.actor.name ?? 'the character',
    user: context.persona?.actor.name ?? 'the player',
  };
}

function fill(block: PresetBlock, context: CollectContext): Candidate[] {
  if (block.kind === 'text') {
    /**
     * **Liquid, rendered within the block — never across blocks** ([03 §5]).
     * Built at P4.1, because the macro table converts SillyTavern's macros
     * *into* Liquid and until then a converted preset's `{{char}}` reached the
     * model as literal braces ([P4 §1.6]).
     *
     * The line stays sharp, it has just moved: a wrapper's `{{content}}` is one
     * fixed placeholder the schema defines, and a template is a *language* over
     * a closed namespace of **names, never bodies**. Content arrives through
     * the slots below; a template that could reach one would be a second
     * assembler.
     *
     * **A template that will not compile emits its own source**, unrendered. A
     * preset is somebody else's authored file, and one bad block must not take
     * the turn down — the same posture every import parser takes ([P4 §1.2]).
     * The literal braces that result are the visible failure §8.4.2 prefers to
     * a mangled prompt that looks fine.
     */
    const rendered = renderTemplate(block.template, renderContextOf(context));
    return emit(
      block,
      rendered.ok ? rendered.text : rendered.source,
      // `presetId` so the workbench can link a block back to the preset it came
      // from ([P4 §2], P4.4). The session's pack is a copy, but a copy keeps the
      // id it was copied from — so for an imported preset this addresses the
      // library object, and for a mode default it addresses nothing and the
      // panel shows a label.
      { kind: 'preset', blockId: block.id, presetId: context.preset.id },
      undefined,
    );
  }

  const source = block.source;
  switch (source.of) {
    case 'persona':
      return emit(
        block,
        personaText(context.persona?.actor ?? null),
        {
          kind: 'persona',
          actorId: context.persona?.actor.id ?? null,
          contentHash: context.persona?.contentHash ?? null,
        },
        undefined,
      );

    case 'actor':
      // One candidate per actor, so the budgeter can drop one and keep another.
      return context.actors.flatMap(({ actor, contentHash }) =>
        emit(
          block,
          actorText(actor, source),
          actorSource(actor.id, contentHash, source),
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
            // The turn id is the identity and the block id is keyed by it
            // ([P3.0]): a window-relative id names a different turn every
            // twenty turns, which is exactly what an id must never do.
            { kind: 'history', turnId: turn.id, range: [index, index], part: of },
            `${block.id}.${turn.id}.${of}`,
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

    case 'samples': {
      /**
       * Writing samples — [10 §3.1]. Prose offered as an exemplar of tone
       * rather than a description of it.
       *
       * **Only the actor carrier can produce anything yet, and the other two
       * return nothing for the reason `lore` does.** A session references
       * neither a Treatment nor a Lorebook, so those arms have no object to
       * read; the slot *rendering empty* is what keeps that a wiring change
       * rather than a preset change when P5 gives a session both.
       *
       * **One candidate per sample, not one per carrier**, which is the same
       * choice the `actor` arm makes and for the same reason: the budgeter's
       * only move against a single block is to drop all of it, and a person who
       * pasted three samples would rather lose one. It is also what makes a
       * per-sample `priority` mean anything — the sample's own number overrides
       * the block's, exactly as the history arm rewrites `priority` per turn.
       *
       * Disabled samples are skipped here rather than filtered upstream, so a
       * disabled sample costs nothing and appears nowhere — `enabled: false` is
       * a draft the author is still deciding about, not a budget casualty.
       */
      const from = source.from;
      if (from === 'treatment' || from === 'lore') return [];

      return context.actors.flatMap(({ actor, contentHash }) =>
        (actor.writingSamples ?? [])
          .filter((sample) => sample.enabled)
          .flatMap((sample) =>
            emit(
              { ...block, priority: sample.priority ?? block.priority },
              sample.body,
              {
                kind: 'samples',
                owner: { kind: 'actor', id: actor.id, contentHash },
                sampleId: sample.id,
              },
              `${block.id}.${actor.id}.${sample.id}`,
            ),
          ),
      );
    }

    /**
     * Nothing, each for its own stated reason. Lore is P5, and the slot
     * *rendering empty* is what makes that an activation change rather than a
     * preset change; a P2.6 session carries no Treatment; goals are
     * Setup-borne; and a channel value is an object with no channel-to-text
     * renderer specified — which is also why the clock's budget is null.
     */
    case 'lore':
    case 'treatment':
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

  /**
   * **All occurrences, and a function replacement rather than a string one.**
   * Both halves are corrections, both found by the P4 readiness audit, and the
   * second is the one that bites.
   *
   * `String.replace` with a string pattern fills only the *first* `{{content}}`,
   * so a wrapper naming it twice — which a converted `scenario_format` may
   * ([10 §8.4.2]) — left the second as literal braces in the prompt.
   *
   * The sharper bug is that a *string* replacement interprets `$&`, `` $` ``,
   * `$'` and `$1` in the replacement as patterns. `text` here is the filled
   * slot: at P4 that is somebody else's card, lorebook or preset prose, and
   * `$&` occurring in it would splice the wrapper's own placeholder back into
   * the output. A function replacement is returned verbatim, so the fix is not
   * "escape the input" — it is "stop treating the input as a pattern".
   */
  const wrapped =
    block.kind === 'slot' && block.wrapper !== undefined
      ? block.wrapper.replaceAll('{{content}}', () => text)
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
  contentHash: string,
  source: { sectionId?: string; field?: string },
): Candidate['source'] {
  if (source.sectionId !== undefined)
    return { kind: 'actor', actorId, contentHash, sectionId: source.sectionId };
  return {
    kind: 'actor',
    actorId,
    contentHash,
    field: source.field === 'visual' ? 'visual' : 'traits',
  };
}
