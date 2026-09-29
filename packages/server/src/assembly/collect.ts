// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import type {
  Actor,
  ActorScope,
  DifficultyLevel,
  Lorebook,
  OutputMessage,
  Preset,
  PresetBlock,
  Treatment,
  WritingSample,
} from '@storyengine/shared';

import { estimateTokens } from './assemble.js';
import { channelDefinition, initialValue } from '../sessions/channels.js';
import { levelFragments } from '../sessions/dials.js';
import type { SummaryLink } from '../sessions/summary-chain.js';
import type { ChannelState, Turn, TurnAttachment } from '../sessions/types.js';
import { pictureTexts } from './pictures.js';
import { renderChannelValue, renderTemplate, type RenderContext } from './template.js';
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
  /**
   * What kind of thing the player did — `do`, `say`, `think`, `story` —
   * [06 §1], [13 §8.3], [P7.9].
   *
   * ***A second thing `appliesTo` matches, and [13 §8.3] says this is the whole
   * implementation.*** *"A mode declares its own input kinds, and a preset block
   * filters on call kind — which [04 §8] deliberately left **open**… each is
   * both an input kind and a call kind; and a preset carries a different
   * instruction block per kind with no new machinery, which is the `appliesTo`
   * filter doing the job it was built for."* That paragraph was written for
   * Write at [P8] and predicted its own vindication; what it needed was for the
   * turn's kind to reach this function, which it did not until here.
   *
   * **Matched alongside `callKind` rather than replacing it**, because they are
   * genuinely two questions on one turn: *what is the engine asking the model to
   * do* and *what did the player just do*. A block that applies to `narrate`
   * applies to every narrating turn whatever the player typed, and one that
   * applies to `say` applies when they spoke. A mode whose input kinds **are**
   * its call kinds — Write's four — sees the two collapse, which is [13 §8.3]'s
   * case and costs nothing here.
   *
   * *Absent for a call with no submission behind it* — a setup part, a judge, a
   * selector — where a block filtered on an input kind should not apply, and
   * does not.
   */
  inputKind?: string;
  /** Oldest first, already windowed by the mode's `historyWindow`. */
  history: readonly Turn[];
  /**
   * The story above the window — [07 §5.1], [P8.1].
   *
   * **Handed in, never derived here**, which is this context's standing rule and
   * has the sharpest reason of any field that follows it: deriving a link is a
   * model call, and a collector that made one would make it again for every
   * preview of every prompt. `sessions/summaries.ts` does the deriving, once,
   * behind a content address; this is its result.
   *
   * *Absent means no chain was computed* — a preview built before the summariser
   * ran, or a mode with no summary step — which is a different statement from
   * *the session is not long enough to have one*, and {@link emptyReason} draws
   * the same line for it that it draws for lore.
   */
  summary?: readonly SummaryLink[];
  /** With the hash of the bytes that were read, so the source can say which ([P3.0]). */
  persona: { actor: Actor; contentHash: string } | null;
  actors: readonly { actor: Actor; contentHash: string }[];
  channels: Readonly<Record<string, ChannelState>>;
  /**
   * What the player just did — the words, and since 2026-09-27 the pictures on
   * the move ([25 E15]), each of which becomes a candidate of its own.
   */
  input?: { text: string; attachments?: readonly TurnAttachment[] };
  guidance?: string;
  /**
   * A fired plot hook's words, for the same slot — [06 §5.1]'s second producer,
   * [06 §6.1], [P7.5].
   *
   * **Handed in by the runner for the reason `attempt` is**, spelled out at the
   * `guidance` case below. Absent means the selector did not fire; it never
   * means it fired with nothing to say.
   */
  hookGuidance?: string;
  /**
   * The goal this session is on — [06 §7.3.3], [P7.6].
   *
   * **Resolved by the caller**, which is the rule this context follows for the
   * cast and the lore and for the same reason: the cursor is channel state and
   * the chain is a session field, and a collector that read either would be
   * doing the gather's job somewhere a preview and a turn could disagree about
   * it.
   *
   * *Absent is a session with no goal* — either one whose Setup carried none,
   * which [04 §7.1] calls the deliberate opt-out, or one that answered
   * *continue open* at a completion.
   */
  goal?: { id: string; statement: string };
  /**
   * Which level each dial is on — [06 §7.3.1], [06 §7.3.2], [P7.8].
   *
   * **Resolved by the caller**, which is this context's standing rule and has a
   * sharper reason here than for the cast: a dial's rungs run through
   * `mode.config`, which [04 §7] keeps *"opaque to the host"* and which lives on
   * the session record rather than in channel state. A collector that reached
   * for it would be doing the gather's job in a place a preview and a turn could
   * answer differently.
   *
   * *An axis is absent when the pack ships no levels for it or the mode declares
   * no such dial* — the two cases [04 §7] says are the same case, and both
   * report `empty-source`.
   */
  dials?: Partial<Record<'difficulty' | 'directedness', { level: DifficultyLevel }>>;
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
  /**
   * ***The member this call speaks as*** — an actor id, [P13 §1.4](../../../../docs/design/workplan/30-p13-scene-and-session-import.md)
   * point 1, [P13.2]. `StepCallRequest.speaker`, handed through by the runner.
   *
   * **What it changes is who the prompt is *for*, never who is *in* it.**
   * `{{char}}` becomes the speaker, and the three group names are counted from
   * them ({@link namesAbout}); the speaker's card comes first in every actor
   * block, and a block's `scope` narrows to them or away from them
   * ({@link castFor}). Every other present card stays — [00 §2.10]'s *"the
   * assembler is multi-actor from the start"*, which is exactly what
   * SillyTavern's card-swapping is the opposite of.
   *
   * *An id the cast does not hold is a call that speaks for nobody.* The
   * runner refuses one before it gets here; this reads it the same way the rest
   * of this file reads a missing thing — as absent, not as a throw.
   */
  speaker?: string;
  /**
   * ***What this turn has already said*** — the messages earlier speaking calls
   * wrote, in order, [P13 §1.4] point 2, [P13.2].
   *
   * **Handed in by the runner, which owns them while they stream**, for the
   * reason `attempt` is: a step handed the text could re-emit it as anything.
   * Placed by {@link collectCandidates} immediately after the input slot as
   * the model's own lines, so the second speaker answers the first — the pack
   * does not position it and cannot forget it.
   *
   * *Absent or empty is a call that is first, or alone*, and changes nothing.
   */
  round?: readonly OutputMessage[];
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
  /**
   * ***The round so far, placed once*** — see {@link roundCandidates}. Placed
   * at the first input slot the pack declares, whatever became of that slot:
   * a turn with no input ([P13 §1.3]'s *let them talk*) emits nothing there,
   * and the round still belongs where the input would have been.
   */
  const round = roundCandidates(context);
  let roundPlaced = round.length === 0;

  const skipped = (block: PresetBlock, reason: NotFilledReason): void => {
    notFilled.push({ blockId: block.id, source: sourceKindOf(block), reason });
  };

  for (const [order, block] of context.preset.blocks.entries()) {
    // After the input slot's own candidates, which the previous iteration
    // pushed — or would have, had there been an input.
    const afterInput = !roundPlaced && isInputSlot(context.preset.blocks[order - 1]);
    if (afterInput) {
      sequence.push(...round);
      roundPlaced = true;
    }
    if (!block.enabled) {
      skipped(block, 'disabled');
      continue;
    }
    // Empty means all — which is what dissolves the eight special-cased
    // template fields [04 §8.4.3] describes.
    /**
     * **Either kind matches** — [13 §8.3], [P7.9]. See
     * {@link CollectContext.inputKind}: an input kind is also a call kind, and a
     * block naming one applies when the turn carries it.
     */
    const applicable =
      block.appliesTo.length === 0 ||
      block.appliesTo.includes(context.callKind) ||
      (context.inputKind !== undefined && block.appliesTo.includes(context.inputKind));
    if (!applicable) {
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
  /**
   * *The input slot was the pack's last block — Scene's and Freeform's both
   * end on it — or the pack has none*, and the round goes at the end: after
   * the input where there is one, and in any case after everything the pack
   * said, which is the only place a reply-in-progress can go in a prompt that
   * did not say where the player speaks.
   */
  if (!roundPlaced) sequence.push(...round);

  return { candidates: splice(sequence, injected, historyStart, historyCount), notFilled };
}

/** Whether a declared block is the slot the player's move goes in. */
function isInputSlot(block: PresetBlock | undefined): boolean {
  return block?.kind === 'slot' && block.source.of === 'input';
}

/**
 * ***The round so far, as the model's own lines*** — [P13 §1.4](../../../../docs/design/workplan/30-p13-scene-and-session-import.md)
 * point 2, [P13.2].
 *
 * **The second speaker answers the first**, as both sources run a group round:
 * SillyTavern's `generateGroupWrapper` awaits each member's `Generate` in turn
 * and every one of them reassembles from the chat the previous member was just
 * saved into (`group-chats.js:1051-1076`); Marinara's per-responder loop
 * appends each reply to the next responder's messages before calling it
 * (`generate.routes.ts:7370-7386`). Here the replies are not in the chat yet —
 * the turn holding them has not been committed — so they arrive as their own
 * source, in order, after the input they answer.
 *
 * ***A pseudo-source rather than a slot, and that is the point of it.*** Every
 * pack written before this stage — every imported one — positions no such
 * thing, and a round that a pack had to opt into would be a round in which
 * each member answered the player alone, three people talking past each other
 * in one turn. So the engine places it, the way it places a step's
 * contribution, and the record says so with its own `BlockSource` arm.
 *
 * **`assistant`, each its own entry**, because each is a reply the model gave.
 * The renderer may still merge two adjacent ones for an endpoint that asks it
 * to; the block table keeps them apart either way. *Unnamed for now*:
 * [P13.3]'s names-in-history (`speakers.namesInHistory`, ST's `openai.js:586`)
 * prefixes `Name: ` on attributed lines once two or more speakers are in the
 * window, and it will prefix these exactly as it prefixes a past turn's — which
 * is why they are handed in as `OutputMessage`s, speaker and all, rather than as
 * bare text.
 *
 * **Priced as the history is**, oldest cheapest: the input slot's priority plus
 * the message's position, so a budget that has to lose part of the round loses
 * its beginning before its end — the same trade the history arm makes, and for
 * its reason. Never `required`: a round longer than the window is a round the
 * budgeter must be allowed to shorten.
 */
function roundCandidates(context: CollectContext): Candidate[] {
  const round = context.round ?? [];
  if (round.length === 0) return [];
  const input = context.preset.blocks.find(isInputSlot);
  const base = input?.priority ?? ROUND_PRIORITY;
  return round.flatMap((message, index) =>
    message.text.length === 0
      ? []
      : [
          {
            id: `se.round.${String(index)}`,
            source: { kind: 'round', message: index, actorId: message.speaker?.id ?? null },
            reason: ROUND_REASON,
            role: 'assistant',
            text: message.text,
            priority: base + index,
          },
        ],
  );
}

/** What the round is worth when the pack has no input slot to price it by: the most any block is. */
const ROUND_PRIORITY = 100;

/**
 * The workbench's words for a round block. Author-facing English, as every
 * other `reason` here is ([P2.5]); a key and params is the P11 sweep's debt.
 */
const ROUND_REASON = 'earlier in this round';

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

    /**
     * ***Lore's line, for lore's reason, and the distinction matters more
     * here.*** A caller that computed no chain — a preview taken before the
     * summariser ran, a mode with no summary step — really is *waiting on the
     * engine*, and that is `no-producer`. A chain that was computed and is empty
     * says something an author can act on: **this session is not yet longer than
     * its window**, so there is nothing above it to summarise. Collapsing the two
     * would send somebody looking for a missing phase when what they need is
     * twenty more turns.
     */
    case 'summary':
      return context.summary === undefined ? 'no-producer' : 'empty-source';

    /**
     * ***`treatment` left this list at last*** (2026-09-27). The framing had a
     * producer from [P5.6], which gave a session its treatment, and the arm
     * went on returning nothing, so every treatment's framing — *the short "how
     * this world is used here" piece, injected every turn* — reached no prompt,
     * and this said *no producer*. An empty framing slot now says **this
     * session has no treatment, or one with no framing**, unless the caller
     * gathered none. *Tone* still has no producer: it is a set of fields with
     * no sentence designed for them, and inventing one here would be writing
     * somebody's prompt for them.
     */
    case 'treatment':
      if (block.source.part === 'tone') return 'no-producer';
      return context.carriers === undefined ? 'no-producer' : 'empty-source';

    case 'channel':
      // No producer at this phase.
      return 'no-producer';

    /**
     * ***`goal` left that list at [P7.6]***, and the change of meaning is the
     * same one [P5.9] made for lore and samples: the arm had no producer at all,
     * and now it has one. An empty goal slot no longer says *waiting on the
     * engine*; it says **this session has no goal**, which is either a Setup
     * that carried none — [04 §7.1]'s *"the deliberate opt-out rather than the
     * default"* — or a completion answered with *continue open*. Both are states
     * an author acts on, and `no-producer` would have sent them looking for a
     * missing phase.
     */
    case 'goal':
      return 'empty-source';

    /**
     * **`empty-source` from the first line, and never `no-producer`.** The
     * producer arrives in the same stage the arm does, so the reason this slot
     * is empty is never *waiting on the engine* — it is that **this pack ships
     * no levels for this axis**, or the mode declares no such dial. [04 §7] calls
     * the second of those the explicit case rather than a misconfiguration:
     * *"Modelling it on Setup would imply Messages and Scene have a difficulty,
     * which they do not."* An author who positioned the slot anyway is told the
     * source is empty, which is the sentence with the repair in it — add levels
     * to the pack, or take the slot out.
     */
    case 'difficulty':
    case 'directedness':
      return 'empty-source';

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
    /**
     * ***A scope that left nobody is the block saying *not this call****
     * ([P13.2]) — `speaker` on a call that speaks for nobody, `others` in a cast
     * of one. That is `not-applicable`'s sentence rather than `empty-source`'s:
     * the cast has cards, and this block was not for any of them this time.
     * Checked only where a scope was written, so an unscoped block over an
     * empty cast still says what it always said.
     */
    case 'actor':
      if (block.source.scope !== undefined && outOfScope(block.source.scope, context)) {
        return 'not-applicable';
      }
      return 'empty-source';
    case 'samples':
      if (
        block.source.from === 'actor' &&
        block.source.scope !== undefined &&
        outOfScope(block.source.scope, context)
      ) {
        return 'not-applicable';
      }
      return 'empty-source';
    case 'persona':
    case 'history':
    case 'guidance':
    case 'attempt':
    case 'input':
      return 'empty-source';
    default:
      return 'unknown-slot';
  }
}

/** Whether a scope excludes a cast that has somebody in it. */
function outOfScope(scope: ActorScope, context: CollectContext): boolean {
  return context.actors.length > 0 && castFor(scope, context).length === 0;
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
  /**
   * **Deepest first, and every insertion after the first moved along by what
   * went in before it** (2026-09-27). ~~Deepest first, so a shallower insertion
   * is not shifted by an earlier one~~ — it is: a deeper run goes in at an
   * earlier index and pushes everything after it right, so the shallower
   * run's index, counted against the history as it was, landed that many
   * messages too deep. A block at depth 4 and one at depth 1 came out at 4 and
   * 2, and two depths past the start of a short history came out reversed.
   * Deepest first still, because with no history to splice into the runs are
   * appended and the deepest has to come first there too.
   */
  let inserted = 0;
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
    out.splice(historyStart + historyCount - Math.min(depth, historyCount) + inserted, 0, ...run);
    inserted += run.length;
  }
  return out;
}

/**
 * The closed namespace a template may see ([P4 §1.6]).
 *
 * `char` is ~~the first cast actor, which is what SillyTavern's `{{char}}` means
 * in a one-character chat and the only reading available until party arrives at
 * P7~~ ***the speaker, on a call that speaks for somebody*** ([P13.2]), and the
 * first cast actor otherwise — which is what SillyTavern's `{{char}}` means in a
 * one-character chat, and what a narrator's merged call has always read. `user`
 * falls back to a neutral word rather than to an empty string, because a
 * template reading *"You are talking to ."* is worse than one reading *"You are
 * talking to the player."*
 */
function renderContextOf(context: CollectContext): RenderContext {
  return namesAbout(context, speakerOf(context) ?? context.actors[0]);
}

/**
 * ***The namespace with `char` as one member*** — [P13.2]'s three group names
 * counted from whoever `char` is, so that `{{char}}` and `{{notChar}}` can never
 * name the same person. The call's namespace is this about its speaker; the
 * actor arm renders each candidate's wrapper with this about the actor the
 * candidate is for, which is what `char` has meant in a wrapper since
 * 2026-09-27. {@link RenderContext} carries what each name means and where it
 * parts from SillyTavern's code.
 */
function namesAbout(context: CollectContext, member: { actor: Actor } | undefined): RenderContext {
  const char = member?.actor.name ?? 'the character';
  const user = context.persona?.actor.name ?? 'the player';
  const cast = context.actors.map(({ actor }) => actor.name);
  const group = cast.length === 0 ? char : cast.join(', ');
  const others = context.actors
    .filter(({ actor }) => actor.id !== member?.actor.id)
    .map(({ actor }) => actor.name);
  return {
    char,
    user,
    group,
    charIfNotGroup: cast.length === 1 ? char : group,
    notChar: [user, ...others].join(', '),
  };
}

/** The cast member this call speaks as, when it speaks as one the cast holds. */
function speakerOf(context: CollectContext): CollectContext['actors'][number] | undefined {
  const speaker = context.speaker;
  if (speaker === undefined) return undefined;
  return context.actors.find(({ actor }) => actor.id === speaker);
}

/**
 * ***Whose cards a block takes, and in what order*** — [P13 §1.4] point 1,
 * [P13.2].
 *
 * **The speaker first, then everyone else in cast order**, on a call that
 * speaks for somebody — [P13 §1.4]'s *"the speaker's comes first"*, so the
 * model reads the card it is about to write as before the ones it is writing
 * *to*. *That is ours rather than SillyTavern's*: §1.4 calls this ST's `APPEND`
 * without its string-joining, and `APPEND` joins every member's fields in
 * **member order**, the active one wherever it falls, leaving muted members
 * out unless the group says `APPEND_DISABLED` (`group-chats.js:549-558`). Every
 * card stays here, muted ones too, which is [00 §2.10]; only the order is new.
 * On a call that speaks for nobody, cast order, as it always was.
 *
 * `scope` narrows it, and {@link ActorScope} states the rule: the two scopes
 * partition the cast on every call — `speaker` is the speaker or nobody,
 * `others` is everyone but the speaker or everyone.
 */
function castFor(scope: ActorScope | undefined, context: CollectContext): CollectContext['actors'] {
  const speaking = speakerOf(context);
  const rest = context.actors.filter((member) => member !== speaking);
  if (scope === 'speaker') return speaking === undefined ? [] : [speaking];
  if (scope === 'others') return rest;
  return speaking === undefined ? context.actors : [speaking, ...rest];
}

function fill(block: PresetBlock, context: CollectContext): Candidate[] {
  // Who is who, for a text block's template and for any block's wrapper. The
  // actor arm narrows `char` to the actor each of its candidates is about.
  const names = renderContextOf(context);
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
    const rendered = renderTemplate(block.template, names);
    return emit(
      block,
      rendered.ok ? rendered.text : rendered.source,
      // `presetId` so the workbench can link a block back to the preset it came
      // from ([P4 §2], P4.4). The session's pack is a copy, but a copy keeps the
      // id it was copied from — so for an imported preset this addresses the
      // library object, and ~~for a mode default it addresses nothing and the
      // panel shows a label~~ **since [P7B.0] a mode default addresses one too**:
      // the pack is materialised into the system library at boot, under the very
      // id written here. Nothing on this line changed, which is the interesting
      // part — the link was always emitted and there was simply nothing on the
      // other end of it.
      { kind: 'preset', blockId: block.id, presetId: context.preset.id },
      undefined,
      names,
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
        names,
      );

    case 'actor':
      // One candidate per actor, so the budgeter can drop one and keep another.
      // Each named for the actor it is about, so a wrapper can say whose it is.
      // Whose, and in what order, is `castFor`'s — the speaker's first ([P13.2]).
      return castFor(source.scope, context).flatMap((member) =>
        emit(
          block,
          actorText(member.actor, source),
          actorSource(member.actor.id, member.contentHash, source),
          `${block.id}.${member.actor.id}`,
          namesAbout(context, member),
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
          const turnBlock = { ...block, priority: block.priority + index, role };
          const text =
            of === 'input' ? asItWasSaid(turn, context.preset, names) : turn.output?.text;
          const words =
            text === undefined || text.length === 0
              ? []
              : emit(
                  turnBlock,
                  text,
                  // The turn id is the identity and the block id is keyed by it
                  // ([P3.0]): a window-relative id names a different turn every
                  // twenty turns, which is exactly what an id must never do.
                  { kind: 'history', turnId: turn.id, range: [index, index], part: of },
                  `${block.id}.${turn.id}.${of}`,
                  names,
                );
          if (of === 'output') return words;
          /**
           * ***The move's pictures, after its words and before the reply*** —
           * [25 E15]. Emitted **whether or not the move had words**: a move that
           * was only a picture used to be an empty half, and an empty half is
           * dropped above — which is how a text consumer would have lost the
           * move entirely. Never `current`, so R1's window sends them as their
           * words whatever the model can see.
           */
          const pictures = (turn.input?.attachments ?? []).map((attachment) =>
            emitPicture(
              turnBlock,
              attachment,
              {
                kind: 'history',
                turnId: turn.id,
                range: [index, index],
                part: 'attachment',
                attachmentId: attachment.id,
              },
              `${block.id}.${turn.id}.attachment.${attachment.id}`,
              false,
              names,
            ),
          );
          return [...words, ...pictures];
        }),
      );
    }

    case 'guidance': {
      /**
       * **Advisory is forced here, never read from the block.**
       *
       * `assemble`'s refusal keys on the candidate's flag and not on where the
       * words came from, so a preset declaring `advisory: false` on its guidance
       * slot would walk guidance straight into an effects call. [06 §5.2] says
       * enforce it *structurally*; a flag an author can clear is not structural.
       */
      const fromUser = emit(
        block,
        context.guidance ?? '',
        { kind: 'guidance', producer: 'user' },
        undefined,
        names,
      );
      /**
       * **[06 §5.1]'s *one slot, several producers*, with the second one at
       * last** — a fired plot hook, [06 §6.1], [P7.5].
       *
       * That section names the user's box, an authored rule's `giveGuidance`
       * and a step such as a Narrative Director push; §6.1 adds the selector as
       * *"simply a fourth producer of that block, so `delivery: 'guidance'` needs
       * no new mechanism"*. `producer: 'step'` is the arm it lands under, which
       * the record already had — the selector **is** a step, and which one is
       * answerable from the turn's own `hooks` line rather than from a fifth
       * value nothing else would ever carry.
       *
       * **Handed in by the runner, never by a step**, which is the rule `attempt`
       * states beside it and the reason this is not a `Candidate` the selector
       * returns: step candidates are appended after the preset's, so a hook
       * returned that way would arrive at the end of the prompt instead of where
       * the author positioned guidance ([25 C13(c)]).
       *
       * *Absent rather than empty when nothing fired*, so it never reaches
       * `omitWhenEmpty`: a preset that emits its guidance slot over an empty box
       * should emit it **once**, not once per producer that had nothing to say.
       * The id is suffixed because two candidates at one slot cannot share one,
       * and it is the new arm that takes the suffix — the user's block has
       * carried the bare block id since P2 and it is in saved records.
       */
      if (context.hookGuidance === undefined) return fromUser;
      return [
        ...fromUser,
        ...emit(
          block,
          context.hookGuidance,
          { kind: 'guidance', producer: 'step' },
          `${block.id}.hook`,
          names,
        ),
      ];
    }

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
        names,
      );

    case 'input':
      /**
       * **Required is forced too**, and `PresetBlock` has no `required` field at
       * all — which is the portable schema agreeing. A preset that could mark
       * the player's action droppable would not produce a shorter prompt; it
       * would produce the wrong one.
       */
      return [
        ...emit(block, context.input?.text ?? '', { kind: 'input' }, undefined, names),
        /**
         * ***The move's pictures, required as its words are*** — [25 E15].
         * A picture the player is showing *now* is the part of their move a
         * budget must not take, and it is the only kind R1 may send as pixels
         * (`current`). Whether it does is decided per call, by the plan, from
         * the model that call resolved to.
         */
        ...(context.input?.attachments ?? []).map((attachment) =>
          emitPicture(
            block,
            attachment,
            { kind: 'input', part: 'attachment', attachmentId: attachment.id },
            `${block.id}.attachment.${attachment.id}`,
            true,
            names,
          ),
        ),
      ];

    case 'summary': {
      /**
       * The chain, oldest link first — [07 §5.1], [P8.1].
       *
       * **One candidate per link**, which is `history`'s and `actor`'s shape and
       * is chosen for the same reason: a single candidate holding four hundred
       * turns of story would make the budgeter's only move dropping all of it.
       * Split, the trim order gives up the *oldest* stretch and keeps the recent
       * one, which is the trade a reader would make.
       *
       * ***The candidate id carries the link key rather than an index***, so a
       * block in one turn's record and the same block in the next turn's are
       * recognisably the same stretch of story even when a fork has renumbered
       * everything after it. An index would have been stable only while nobody
       * branched, which is the failure this whole phase is built to avoid.
       *
       * **`priority + index`, which is `history`'s arithmetic and has to be.**
       * The trim order is *lowest first*, so a shared priority would make the
       * budgeter's tie-break decide which stretch of story survives — and its
       * tie-break is *later-listed first*, which would drop the **newest** link
       * and keep the oldest. Offsetting by position makes the sacrifice run the
       * only way a reader would accept it: the distant past goes before the
       * recent past.
       */
      return (context.summary ?? []).flatMap((link, index) =>
        emit(
          { ...block, priority: block.priority + index },
          link.text,
          { kind: 'summary', linkKey: link.key, range: [link.from, link.to] },
          `${block.id}.${link.key}`,
          names,
        ),
      );
    }

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
        carriersOf(carrier, context, source.scope).flatMap((owner) =>
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
                names,
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
            names,
          ).map((candidate) => ({
            ...candidate,
            // The entry's own role and reason, which `emit` has no way to know
            // and which are the two fields a lore block exists to carry.
            role: one.candidate.role,
            reason: one.candidate.reason,
            /**
             * ***And its advisory flag, which is the third arm of the union***
             * — [08 §5], [P8 §1.6], [P8.4].
             *
             * `emit` forces the marker for two *slot sources* and otherwise
             * inherits the positioning slot's, which is why nothing on the lore
             * path could be advisory: a memory entry and an authored one arrive
             * through the same `{ of: 'lore' }` slot. `retrieval/blocks.ts` sets
             * it where the book is known, and this is the line that stops it
             * being thrown away one function later. **A union, never a
             * replacement**: a preset that marks its lore slot advisory keeps
             * doing so for the authored entries too.
             */
            ...(one.candidate.advisory === true ? { advisory: true as const } : {}),
          })),
        );
    }

    /**
     * **The injection half of the channel contract, built at [P7.1].**
     *
     * ~~A channel value is an object with no channel-to-text renderer
     * specified — which is also why the clock's budget is null.~~ Both halves of
     * that sentence expired together: `ChannelDefinition.render` is a Liquid
     * template over the channel's own value, and `budget` is what caps the
     * result. Until then `{ of: 'channel', channelId }` was a **legal preset
     * slot that silently produced nothing** — an author could name a channel,
     * get no text and no error, and have nothing to read about why.
     */
    case 'channel':
      return emit(
        block,
        channelText(source.channelId, context),
        // The slot's vocabulary and the block's are one vocabulary read from
        // both ends ([21 §1.1]) — `of` names the slot, `kind` names the source —
        // so the id crosses and the discriminator is restated.
        { kind: 'channel', channelId: source.channelId },
        undefined,
        names,
      );

    /**
     * ***The goal play is on, always injected*** — [06 §7.3.3], [04 §8.2],
     * [P7.6]. That section is explicit: *"the goal statement is therefore always
     * injected, and difficulty fragments are written to reference it."* This arm
     * has returned `[]` since P2 and reported `no-producer` beside it; the
     * producer is the session's own chain and the cursor over it.
     *
     * **The statement and never the `detail`.** [04 §7.1] draws that line on the
     * schema — *"short, always injected"* against *"the author's fuller version,
     * available to steps; not injected by default, so a long one costs nothing
     * per turn"* — so a slot that sent both would spend a paragraph a turn on
     * something the design put out of the prompt on purpose.
     *
     * *A `hidden` goal is injected too, and that is not an oversight.*
     * [04 §7.1]'s `visibility` is about the **player**: hidden is *the GM's
     * arc*, which the narrator is told and the reader is not. The channel
     * `visibility` that governs prompts is a different field about a different
     * audience.
     */
    case 'goal': {
      const goal = context.goal;
      if (goal === undefined) return [];
      return emit(block, goal.statement, { kind: 'goal', goalId: goal.id }, undefined, names);
    }

    /**
     * ***The two dials' fragments*** — [06 §7.3.1], [06 §7.3.2], [P7.8].
     *
     * **One candidate per fragment, and that is the arm's whole reason for
     * existing.** [04 §8]'s `DifficultyLevel.fragments` are *ranked* precisely so
     * [19 §5.3]'s cap can *"drop the lowest-ranked rather than cutting
     * mid-sentence"*, and a slot that joined them into one string would have
     * discarded that at the point it was built. So the slot fans out, each
     * candidate carrying the block's priority and its own identity.
     *
     * ***The ids are suffixed rather than shared***, which is the same
     * arrangement [P7.5] made for the second guidance candidate: `assemble`
     * keys on candidate id, so two candidates from one slot need two ids or the
     * second silently replaces the first. `${block.id}.${index}` is the
     * fragment's position in the level, so a workbench row is stable when the
     * pack is edited between turns and the *order* changes but the entry does
     * not.
     *
     * *Which level is the caller's, resolved in `gather`*, for the reason the
     * goal and the cast are: the dial's rungs run through `mode.config`, which
     * is a record field, and a collector that read it would be doing the
     * gather's job somewhere a preview and a turn could disagree about it.
     */
    case 'difficulty':
    case 'directedness': {
      const dial = context.dials?.[source.of];
      if (dial === undefined) return [];
      return levelFragments(dial.level).flatMap((fragment) =>
        emit(
          block,
          fragment.text,
          {
            kind: 'difficulty',
            axis: source.of,
            levelId: dial.level.id,
            fragmentIndex: fragment.index,
          },
          `${block.id}.${String(fragment.index)}`,
          names,
        ),
      );
    }

    /**
     * ~~Nothing, for its own stated reason: a P2.6 session carries no
     * Treatment.~~ ***The framing, since 2026-09-27*** — [04 §3.1], [P7B §3.2]
     * row 7. The reason expired at [P5.6], which gave a session its treatment
     * and brought it here as a carrier for its samples; this arm went on
     * returning nothing, and the one piece of a treatment written to be read
     * every turn — *how this world is used here* — never reached a prompt. The
     * gate row that checks for it was recorded as passing, which says more
     * about the row than the arm.
     *
     * **Only the framing.** Tone is a set of fields with no sentence designed
     * for them, and turning them into prose here would be writing an author's
     * prompt for them; `emptyReason` keeps its `no-producer`.
     */
    case 'treatment': {
      const held = context.carriers?.treatment;
      if (source.part !== 'framing' || held === null || held === undefined) return [];
      return emit(
        block,
        held.treatment.framing,
        { kind: 'treatment', part: 'framing' },
        undefined,
        names,
      );
    }

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
 * ***A past input as the pack framed it when it was the input*** (2026-09-27)
 * — [13 §8.3], [P7.9].
 *
 * A pack says what kind of thing the player did through the input slot for
 * that kind: Freeform wraps a *think* as *the player's character thinks: …*, so
 * the narrator knows nobody heard it. The history arm dropped the kind, so the
 * same thought one turn later sat in the history as bare words — a line spoken
 * aloud, for all a model could tell. The kind is on the record, so the past
 * turn takes the wrapper the current one had: the slot for its kind if the pack
 * has one, else a slot for every kind. No wrapper, no change, which is Scene's
 * case and the assistant's.
 */
function asItWasSaid(turn: Turn, preset: Preset, names: RenderContext): string | undefined {
  const text = turn.input?.text;
  if (text === undefined || text.length === 0) return text;
  const kind = turn.input?.kind;
  const inputs = preset.blocks.filter(
    (candidate) =>
      candidate.enabled && candidate.kind === 'slot' && candidate.source.of === 'input',
  );
  const slot =
    inputs.find((one) => kind !== undefined && one.appliesTo.includes(kind)) ??
    inputs.find((one) => one.appliesTo.length === 0);
  if (slot?.kind !== 'slot' || slot.wrapper === undefined) return text;
  return wrap(slot.wrapper, text, names);
}

/** Where the content goes while the rest of a wrapper is rendered: no template can produce it. */
const CONTENT = '\u0000content\u0000';

/**
 * ***A wrapper, with the names in it rendered*** (2026-09-27) — [06 §5],
 * [P4 §1.6].
 *
 * A wrapper was one fixed placeholder and nothing else, so a pack could frame
 * a block but never say *whose* it was — and the shipped packs' persona and
 * actor blocks went to the model as bodies with no names on them. With two
 * characters in a scene, what reached the narrator was two descriptions, then
 * two appearances, then two voices, and nothing to say which was which; the
 * persona's name was in no prompt at all.
 *
 * So the wrapper is a template over the same closed namespace a text block
 * has — `char` and `user`, **names and never bodies** — while the content is
 * not. The placeholder is swapped for a mark no template can produce before
 * rendering and swapped back for the text afterwards, which keeps the fence
 * where [P4 §1.6] drew it: nothing in a card, a book or a turn is ever read
 * as Liquid, so a `{{` in somebody's prose is prose. `char` is the actor the
 * candidate is about where there is one (the actor arm narrows it), else the
 * first of the cast, as in a text block.
 *
 * *A wrapper that will not render keeps its words as written*, which is what
 * every wrapper did before this — the one outcome that changes nothing.
 */
function wrap(wrapper: string, text: string, names: RenderContext): string {
  const marked = wrapper.replaceAll('{{content}}', CONTENT);
  const rendered = renderTemplate(marked, names);
  return (rendered.ok ? rendered.text : marked).replaceAll(CONTENT, () => text);
}

/**
 * One picture as a candidate — [25 E15], R1.
 *
 * ***Its text is the picture as words***, wrapped as its slot wraps everything
 * else, because that is what goes whenever the pixels do not; `sentText` is the
 * same wrapper around what goes beside them when they do. Never empty, so the
 * empty rule never drops a picture, and never advisory — a picture a person
 * showed is part of the story, not a steer.
 */
function emitPicture(
  block: PresetBlock,
  attachment: TurnAttachment,
  source: Candidate['source'],
  id: string,
  current: boolean,
  names: RenderContext,
): Candidate {
  const texts = pictureTexts(attachment);
  const framed = (text: string): string =>
    block.kind === 'slot' && block.wrapper !== undefined ? wrap(block.wrapper, text, names) : text;
  const required = current && block.kind === 'slot' && block.source.of === 'input';
  return {
    id,
    source,
    reason: block.label,
    role: block.role,
    text: framed(texts.held),
    priority: block.priority,
    ...(required ? { required: true } : {}),
    image: {
      attachmentId: attachment.id,
      kind: attachment.kind,
      digest: attachment.digest ?? null,
      mime: attachment.mime ?? null,
      sentText: framed(texts.sent),
      current,
    },
  };
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
  names: RenderContext,
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
    block.kind === 'slot' && block.wrapper !== undefined ? wrap(block.wrapper, text, names) : text;

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

/**
 * One channel's value as prompt text — [06 §4], [P7.1].
 *
 * **Four ways to produce nothing, and each is a different statement.** A channel
 * nobody declared is an uninstalled mode's, and [00 §3.3] says show what you
 * cannot resolve rather than fail; a channel with no `render` has nothing worth
 * saying to a model, which lore timing is the shipped example of; a `budget` of
 * null is 06 §4's own spelling of *never injected*; and a template that will not
 * compile is the author's mistake, answered the way `renderTemplate`'s caller
 * answers it — a refusal is a value, not a thrown turn.
 *
 * **The value falls back to the channel's declared `init`**, which is the same
 * read-time default `readClock` uses: a session that has never touched its clock
 * still has a time of day, and a slot that rendered nothing until the first
 * effect would make the prompt disagree with the panel.
 *
 * **Truncated to the budget rather than dropped.** A channel over its allowance
 * is more useful cut short than absent — the time of day wrong by truncation
 * still says which day — and dropping would hand the budgeter a decision the
 * declaration has already made. `estimateTokens` is the same estimator the
 * assembler bills with, so the cap means the same thing here as it does there.
 */
function channelText(channelId: string, context: CollectContext): string {
  const definition = channelDefinition(channelId);
  if (definition?.render === undefined || definition.budget === null) return '';

  const state = context.channels[channelId];
  const rendered = renderChannelValue(
    definition.render,
    state === undefined ? initialValue(channelId) : state.value,
  );
  if (!rendered.ok) return '';

  const text = rendered.text.trim();
  if (estimateTokens(text) <= definition.budget) return text;

  /**
   * **Cut by characters against the estimator's own ratio**, because the
   * estimator is a ratio: `estimateTokens` divides length by a constant, so the
   * inverse is a multiplication and a second, cleverer truncation would just be
   * a worse approximation of the same number. Trimmed after cutting so the text
   * does not end mid-space.
   */
  const perToken = text.length / Math.max(estimateTokens(text), 1);
  return text.slice(0, Math.floor(definition.budget * perToken)).trimEnd();
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
function carriersOf(
  kind: (typeof SAMPLE_ORDER)[number],
  context: CollectContext,
  scope?: ActorScope,
): SampleCarrier[] {
  if (kind === 'actor') {
    // The speaker's samples first, and `scope` narrowing to them or away from
    // them — `castFor`, for the actor arm's reason ([P13.2]).
    return castFor(scope, context).map(({ actor, contentHash }) => ({
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
