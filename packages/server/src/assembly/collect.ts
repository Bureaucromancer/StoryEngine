// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import type {
  Actor,
  Lorebook,
  Preset,
  PresetBlock,
  Treatment,
  WritingSample,
} from '@storyengine/shared';

import type { ChannelState, Turn } from '../sessions/types.js';
import { renderTemplate, type RenderContext } from './template.js';
import type { LoreBlock } from '../retrieval/blocks.js';
import type { Candidate, NotFilledReason, NotFilledSlot } from './types.js';

/**
 * Step 1 of [06 §5](../../../../docs/design/06-modes-and-turn-pipeline.md) — collect.
 *
 * P2.4 built steps 2 to 4 (annotate, budget, render) and left this one until
 * there was a preset to drive it. This is that: the preset supplies the blocks,
 * in the order it declares them, and the engine fills each one.
 *
 * **It lives in `assembly/` rather than on a mode.** [06 §5] says the assembly
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
  /**
   * The attempt a guided redo is redoing — its output, and which turn it was
   * ([06 §5.1], [07 §7]).
   *
   * **Handed in by the runner, never by a step**, for the reason `StepInput`
   * withholds guidance: a step handed the text could re-emit it as an ordinary
   * candidate and `assemble` would admit it, because the refusal keys on the
   * candidate's flag and not on where the words came from. The route reads the
   * text off the record the way it reads the tape, so what the model is shown
   * is what was written, not what a client says was.
   */
  attempt?: { turnId: string; text: string };
  /**
   * What the retriever activated and the per-book budget kept — [P5.6].
   *
   * **Handed in, not computed here**, which is the same rule the cast follows
   * and for a stronger reason: the scan advances timing counters and draws from
   * the turn's RNG, and a collector that ran it would do both again for every
   * preview. It runs once, in the step, and this is its result.
   *
   * Absent means no retriever ran — which is not the same as *it ran and found
   * nothing*, and the two produce different `notFilled` reasons. See
   * {@link emptyReason}.
   */
  lore?: readonly LoreBlock[];
  /**
   * The objects that carry writing samples — [P5.9], [04 §3.1].
   *
   * **Separate from `lore` above, and the separation is the stage's point.** A
   * sample rides with its carrier the way `media` does: a book's samples are
   * offered because the book is *in play*, not because one of its entries
   * matched. They are two different questions about the same objects, and
   * threading the books through the activated blocks would have quietly made
   * a setting's prose conditional on a keyword.
   *
   * The actors are not here because they are already above: the cast has been
   * gathered since P2.6 and this stage added nothing to it, which is exactly
   * why [14 §7] could ship the actor arm two phases early.
   */
  carriers?: SampleCarriers;
}

export interface SampleCarriers {
  treatment: { treatment: Treatment; id: string; contentHash: string } | null;
  books: readonly { book: Lorebook; id: string; contentHash: string }[];
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
    // template fields [04 §8.4.3] describes.
    if (block.appliesTo.length > 0 && !block.appliesTo.includes(context.callKind)) {
      skipped(block, 'not-applicable');
      continue;
    }

    const filled = fill(block, context);
    if (filled.length === 0) {
      skipped(block, emptyReason(block, context));
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

    /**
     * **Lore is the one slot whose blocks are not all in one place.**
     *
     * `position` lives on the *entry* ([03 §3.1]), so a single lore slot can
     * emit blocks belonging in four places — and `at_depth` is one of them,
     * which means some of this slot's output belongs in the history splice
     * that the loop has already decided this block is not part of. Every other
     * source kind is positioned by its preset block, so nothing else needs
     * this and giving it to everything would be a general mechanism built for
     * one case.
     *
     * The depth blocks are grouped by `fromEnd` and injected as if each depth
     * were its own preset block, which is exactly what they are asking to be.
     */
    if (block.kind === 'slot' && block.source.of === 'lore') {
      const { positioned, byDepth } = splitByDepth(filled, context.lore ?? []);
      for (const [fromEnd, candidates] of byDepth) {
        // Tiebreak zero: the entry's own `order` has already decided the run,
        // and a lore slot positioned outside the history has no tiebreak field
        // to borrow.
        injected.push({ fromEnd, tiebreak: 0, order, candidates });
      }
      sequence.push(...positioned);
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
 * `fill()`'s signature simple keeps its twelve arms readable.
 */
function emptyReason(block: PresetBlock, context: CollectContext): NotFilledReason {
  if (block.kind === 'text') return 'empty-source';
  switch (block.source.of) {
    /**
     * **Lore acquired a producer at P5.6, and this is where that shows.**
     *
     * It read `no-producer` from P3.0 until then, and correctly: a session
     * referenced no lorebook, so the slot was waiting on the engine. Now it is
     * waiting on the books — so an empty lore slot means *the retriever ran and
     * this slot got nothing*, which is `empty-source`, the same thing an actor
     * slot with no traits means.
     *
     * The distinction survives for the case that still deserves it. A caller
     * that never ran a retriever at all — a mode with no lore step, a preview
     * built before the scan — passes no `lore`, and that really is *no producer
     * exists*. [P5 §1.10] asks for this assertion to change meaning **in this
     * stage's own commit** rather than be repaired later by whoever finds CI
     * red, and this line is the change.
     */
    case 'lore':
      return context.lore === undefined ? 'no-producer' : 'empty-source';

    case 'treatment':
    case 'goal':
    case 'channel':
      // The same list `fill()` returns nothing for, each for its stated
      // reason — no producer at this phase.
      return 'no-producer';

    /**
     * ~~**The one source kind whose reason depends on which carrier it names**,
     * because the carriers landed at different times. A slot naming the
     * Treatment or the Lorebook has no producer at all — a session references
     * neither — while the actor arm is live, so its emptiness means the cast
     * simply has no samples. Collapsing both to `no-producer` would tell an
     * author their preset is waiting on the engine when it is waiting on them.~~
     *
     * **The split closes at [P5.9], and closing it is the point.** It existed
     * because the three carriers landed at different times, and it said
     * something true while they did: *waiting on the engine* and *waiting on
     * you* are different sentences with different repairs. All three are live
     * now, so an empty samples slot means the same thing whichever carrier it
     * names — **write a sample, or link an object that has one** — and keeping
     * the discrimination would leave `no-producer` claiming a phase is
     * outstanding when none is.
     *
     * [P5.9] asks for exactly this and asks for it deliberately: *the test that
     * currently pins the split is the one that has to change*.
     */
    case 'samples':
    case 'persona':
    case 'actor':
    case 'history':
    case 'guidance':
    case 'attempt':
    case 'input':
      return 'empty-source';
    default:
      return 'unknown-slot';
  }
}

/**
 * Puts in-history blocks where the preset asked for them — [04 §8.2].
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
     * **Liquid, rendered within the block — never across blocks** ([06 §5]).
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
       * slot would walk guidance straight into an effects call. [06 §5.2] says
       * enforce it *structurally*; a flag an author can clear is not structural.
       */
      return emit(block, context.guidance ?? '', { kind: 'guidance', producer: 'user' }, undefined);

    case 'attempt':
      /**
       * The previous attempt a guided redo shows the model — [06 §5.1],
       * [07 §7]. Advisory is forced in `emit` for this slot as it is for
       * guidance, and the reason is sharper here: the text is the model's own
       * discarded reply, and an extractor that saw it would record the events
       * of a reply nobody kept as having happened.
       *
       * The turn id travels on the source so the record can say *which*
       * attempt the instruction was about; null is the `persona` claim — the
       * author asked for the block and there was no attempt to fill it.
       */
      return emit(
        block,
        context.attempt?.text ?? '',
        { kind: 'attempt', turnId: context.attempt?.turnId ?? null },
        undefined,
      );

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
       * Writing samples — [04 §3.1]. Prose offered as an exemplar of tone
       * rather than a description of it.
       *
       * ~~**Only the actor carrier can produce anything yet, and the other two
       * return nothing for the reason `lore` does.** A session references
       * neither a Treatment nor a Lorebook, so those arms have no object to
       * read.~~ **All three are live at [P5.9]**, because [P5.6] gave a session
       * both objects — which is the whole reason [14 §7] scheduled these two
       * arms for this phase rather than shipping them dark.
       *
       * **The order is the preset's, and `from` absent means all three** in the
       * fixed order treatment → lore → actor: [04 §3.1]'s *the stance on the
       * material, then the world, then the person*, which is the order they
       * narrow in. A preset that wants one carrier elsewhere names it.
       *
       * **A sample rides with its carrier and never with activation** — [P5.9].
       * A book's samples are offered because the book is *in play*, not because
       * an entry matched: a sample is not an entry, has no keys, and would have
       * nothing to match with. That is what keeps this a slot rather than a
       * feature of the retriever, and it is why the books come from
       * `context.carriers` rather than from the activated blocks beside them.
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
      const wanted = source.from === undefined ? SAMPLE_ORDER : [source.from];

      return wanted.flatMap((carrier) =>
        carriersOf(carrier, context).flatMap((owner) =>
          owner.samples
            .filter((sample) => sample.enabled)
            .flatMap((sample) =>
              emit(
                { ...block, priority: sample.priority ?? block.priority },
                sample.body,
                {
                  kind: 'samples',
                  owner: { kind: carrier, id: owner.id, contentHash: owner.contentHash },
                  sampleId: sample.id,
                },
                `${block.id}.${owner.id}.${sample.id}`,
              ),
            ),
        ),
      );
    }

    case 'lore': {
      /**
       * The retriever's output, filtered to the slots this block positions —
       * [P5.6]. The scan ran once in the step; this decides where its blocks go.
       *
       * **A slot naming an outlet takes only that outlet**, and a slot naming
       * none takes only the entries that named none either. That is the whole
       * of what an outlet decouples: an entry saying `outlet: rules` is asking
       * not to land in the ordinary before-run, and a preset that positions
       * `rules` is agreeing to hold it. Letting an unnamed slot sweep up
       * outlet entries as a courtesy would silently undo both halves.
       *
       * `at_depth` entries come through here too and are separated by the
       * caller — see {@link collectCandidates}, which is the only place that
       * can put them in the history splice.
       */
      const outlet = source.outlet;
      return (context.lore ?? [])
        .filter((one) =>
          outlet === undefined
            ? one.placement.at !== 'outlet' &&
              (one.placement.at === 'after' ? source.phase === 'after' : source.phase === 'before')
            : one.placement.at === 'outlet' && one.placement.name === outlet,
        )
        .flatMap((one) =>
          emit(
            { ...block, priority: one.candidate.priority ?? block.priority },
            one.candidate.text,
            one.candidate.source,
            one.candidate.id,
          ).map((candidate) => ({
            ...candidate,
            // The entry's own role and reason, which `emit` has no way to know
            // and which are the two fields a lore block exists to carry.
            role: one.candidate.role,
            reason: one.candidate.reason,
          })),
        );
    }

    /**
     * Nothing, each for its own stated reason. A P2.6 session carries no
     * Treatment; goals are Setup-borne; and a channel value is an object with
     * no channel-to-text renderer specified — which is also why the clock's
     * budget is null.
     */
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
   * ([04 §8.4.2]) — left the second as literal braces in the prompt.
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
  // remembered. Two slots are forced rather than one since the previous
  // attempt joined guidance ([06 §5.1]): both carry words that may shape prose
  // and must never reach a verdict, and a preset clearing the flag on either
  // changes nothing.
  const advisory =
    block.advisory ||
    (block.kind === 'slot' && (block.source.of === 'guidance' || block.source.of === 'attempt'));
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
  // `visual` is structured data for an image pipeline ([04 §4]) with no prose
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

/**
 * Separates the lore blocks that belong in the history splice from the ones
 * that sit where the slot does.
 *
 * Matched back to the retriever's output by candidate id rather than carried on
 * the `Candidate` itself, because `Candidate` is the shared assembly shape and
 * a `fromEnd` on it would be a lore concern every other source kind had to
 * ignore. The id is already unique per book and entry, and already the thing
 * the record uses to point at a block.
 */
function splitByDepth(
  filled: readonly Candidate[],
  lore: readonly LoreBlock[],
): { positioned: Candidate[]; byDepth: Map<number, Candidate[]> } {
  const depths = new Map<string, number>();
  for (const one of lore) {
    if (one.placement.at === 'in-history') depths.set(one.candidate.id, one.placement.fromEnd);
  }
  if (depths.size === 0) return { positioned: [...filled], byDepth: new Map() };

  const positioned: Candidate[] = [];
  const byDepth = new Map<number, Candidate[]>();
  for (const candidate of filled) {
    const fromEnd = depths.get(candidate.id);
    if (fromEnd === undefined) {
      positioned.push(candidate);
      continue;
    }
    byDepth.set(fromEnd, [...(byDepth.get(fromEnd) ?? []), candidate]);
  }
  return { positioned, byDepth };
}

/**
 * The carriers a bare `samples` slot reads, in the order [04 §3.1] fixes:
 * **the stance on the material, then the world, then the person**, which is the
 * order they narrow in.
 *
 * A constant rather than three arms, because the order is a *contract* a preset
 * relies on when it declines to name a `from` — and a list somebody can read is
 * harder to permute by accident than a sequence of concatenations.
 */
const SAMPLE_ORDER = ['treatment', 'lore', 'actor'] as const;

/** One object that carries samples, flattened to what the slot needs. */
interface SampleCarrier {
  id: string;
  contentHash: string;
  samples: readonly WritingSample[];
}

/**
 * The objects of one kind that are carrying samples this turn.
 *
 * Empty is the honest answer for a session with no treatment or no books, and
 * it is *not* distinguishable here from a carrier that has none — which is
 * correct as of [P5.9], because the two now mean the same thing to a reader:
 * write a sample, or link an object that has one. See {@link emptyReason}.
 */
function carriersOf(kind: (typeof SAMPLE_ORDER)[number], context: CollectContext): SampleCarrier[] {
  if (kind === 'actor') {
    return context.actors.map(({ actor, contentHash }) => ({
      id: actor.id,
      contentHash,
      samples: actor.writingSamples ?? [],
    }));
  }

  const carriers = context.carriers;
  if (carriers === undefined) return [];

  if (kind === 'treatment') {
    const held = carriers.treatment;
    return held === null
      ? []
      : [
          {
            id: held.id,
            contentHash: held.contentHash,
            samples: held.treatment.writingSamples ?? [],
          },
        ];
  }

  return carriers.books.map((one: SampleCarriers['books'][number]) => ({
    id: one.id,
    contentHash: one.contentHash,
    samples: one.book.writingSamples ?? [],
  }));
}
