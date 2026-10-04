// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import type { Preset } from '@storyengine/shared';

import type { AssembledBlock } from '../assembly/types.js';
import type { Rng } from '../rng/rng.js';
import { channelKey, keyBelongsTo, scopeKeyOf, SE_LORE_TIMING } from '../sessions/channels.js';
import { storyDepth } from '../sessions/depth.js';
import type { ChannelState, Turn, TurnAttachment } from '../sessions/types.js';
import { scanText } from '../assembly/pictures.js';
import type { EffectProposal } from '../turns/effects.js';
import type { CastMember } from '../turns/cast.js';
import type { ResolvedLore } from '../turns/lore.js';
import { activate, type ScanResult } from './activate.js';
import { loreBlocks, refusalsFor, type LoreBlock, type Unplaced } from './blocks.js';
import type { EntryTiming } from './timing.js';
import { timingOf } from './timing.js';
import { shelve, type ShelfResult } from './shelf.js';

/**
 * The retrieval step, end to end — [P5 §1.3], [P5.6].
 *
 * Scan, then the inner budget, then blocks, then the timing effects. **One
 * entry point, because there are two callers and they must not disagree**: the
 * runner and `previewAssembly`, which is `gather.ts`'s argument applied one
 * layer up. A preview that scanned differently from the turn would show
 * somebody a prompt they are not about to send, and the difference would be
 * invisible in both.
 *
 * ## What is a step's, and what is not
 *
 * [P5 §1.3] puts recursion inside the step and the two-tier budget partly
 * outside it: per-book verdicts here, the chat-wide cut left to the budgeter.
 * The same split governs the counters. This function *computes* them and
 * writes nothing, because only a step may propose an effect and only
 * `applyEffects` may commit one. That is also what makes the whole thing safe
 * to run for a preview — a preview that moved everybody's cooldown would be a
 * preview that changed the turn it previewed.
 *
 * ***And it does not propose them either*** (2026-09-27): {@link settleTiming}
 * does, once the call is assembled. The counters were proposed here, before
 * the shelf, the outlets or the chat-wide budget had had their say, so an
 * entry whose text never reached the prompt was recorded as having fired: an
 * `ephemeral: 1` entry trimmed for budget was spent without being read once,
 * a cooldown started on a turn the entry sat out, and a sticky window closed
 * unseen. Which text reached the prompt is only known after the assembler has
 * cut, so that is where the counters are settled.
 */

export interface RetrieveContext {
  lore: ResolvedLore;
  preset: Preset;
  /** Oldest first, as the assembler holds it. */
  history: readonly Turn[];
  /** The pending message, which is the newest thing to scan and is not in history yet. */
  input?: { text: string; attachments?: readonly TurnAttachment[] };
  /**
   * ***This turn's earlier speakers' replies***, oldest first — newer than the
   * pending input, and in no history yet because the turn holding them has not
   * been committed. [P14.2] review, 2026-09-29.
   *
   * **A later speaker's lore sees what the earlier ones said**, as it does in
   * SillyTavern: `generateGroupWrapper` runs each member's `Generate` in turn
   * (`group-chats.js:1051`), and each builds `chatForWI` from the chat the
   * previous reply was just saved into (`script.js:4565`). The collector has
   * been handed the round since P14.2 and put it in the prompt; a scan that did
   * not read it would activate lore for a conversation one reply behind the
   * one the model is shown. Absent or empty on every call that is not a later
   * speaker's.
   */
  round?: readonly string[];
  channels: Readonly<Record<string, ChannelState>>;
  persona: { actor: CastMember['actor'] } | null;
  actors: readonly { actor: CastMember['actor'] }[];
  /** The call kind, which `generationTriggerFilter` names. */
  callKind: string;
  rng: Rng;
}

export interface Retrieved {
  /** What the collector positions. */
  blocks: LoreBlock[];
  scan: ScanResult;
  shelf: ShelfResult;
  /** Activated, budgeted, and then addressed to an outlet nobody positions. */
  unplaced: Unplaced[];
  /**
   * What the inner budget and the outlets refused, in the arbiter's vocabulary
   * — [P5 §1.3]'s *every skip lands in the `BudgetVerdict` with the rule that
   * made it*, which is only true if these travel that far.
   */
  refused: { blockId: string; tokens: number; rule: string }[];
}

export function retrieve(context: RetrieveContext): Retrieved {
  const messages = messagesToScan(context);
  const scan = activate({
    books: context.lore.books,
    input: { messages, sources: sourcesFor(context) },
    /**
     * What `delay` counts. The **history**, not the messages the scan reads:
     * `messagesToScan` is capped by the mode's window and by the pending input,
     * while *how far into this story are we* is a fact about the whole path.
     * An entry set to wait twenty messages must not fire on turn three of a
     * session whose window happens to be twenty.
     *
     * *Story turns of it* (`depth.ts`, 2026-09-27): a HUD edit or a backdrop
     * choice is a turn on the path and not a message anybody wrote, and
     * counting them let an entry out early.
     */
    messagesSoFar: storyDepth(context.history),
    timing: timingFrom(context.channels),
    filters: {
      actorIds: castIds(context),
      actorTags: castTags(context),
      generationTrigger: context.callKind,
    },
    rng: context.rng,
  });

  const latestMessage = messages[0] ?? '';
  const shelf = shelve({ activated: scan.activated, latestMessage });
  const { blocks, unplaced } = loreBlocks({
    kept: shelf.kept,
    latestMessage,
    outlets: outletsOf(context.preset),
    phases: phasesOf(context.preset),
    basePriority: lorePriorityOf(context.preset),
  });

  return {
    blocks,
    scan,
    shelf,
    unplaced,
    refused: refusalsFor(shelf.refused, unplaced),
  };
}

/**
 * ***The counters as the turn leaves them, given what reached the prompt*** —
 * [P5.6]'s counters, settled at last against the claim they make (2026-09-27).
 *
 * `scan.timing` is what the counters would be if every activation had been
 * read; an activation the shelf refused, no outlet placed or the chat-wide
 * budget cut **was not**, and for it the counters stand where they were. That
 * is the whole of the rule, and it covers each counter the right way round:
 * an entry that matched and was cut has not fired, so `fired` does not count
 * it and no cooldown starts; a sticky entry that was cut has not spent a turn
 * of its window. Everything else — a cooldown ticking down, an idle entry —
 * is time passing, and moves whether or not anything was read.
 *
 * `reached` is {@link loreReached} over the assembled call. One proposal per
 * entry whose counters actually move: a library of four hundred entries would
 * otherwise write four hundred no-op effects every turn, and the effect log is
 * what [07 §4] replays.
 */
export function settleTiming(
  lore: Pick<Retrieved, 'scan'>,
  reached: ReadonlySet<string>,
  channels: Readonly<Record<string, ChannelState>>,
): EffectProposal[] {
  const activated = new Set(lore.scan.activated.map((one) => one.entry.id));
  const proposals: EffectProposal[] = [];
  for (const [entryId, advanced] of Object.entries(lore.scan.timing)) {
    const key = channelKey(SE_LORE_TIMING, entryId);
    const before = timingOf(channels[key]?.value);
    const next = activated.has(entryId) && !reached.has(entryId) ? before : advanced;
    if (same(before, next)) continue;
    proposals.push({
      channelId: SE_LORE_TIMING,
      scopeKey: entryId,
      op: { type: 'set', path: '/' },
      after: next,
      // Engine-computed, as the channel declares. The model does not get a vote
      // on whether an entry is still sticky.
      proposedBy: { kind: 'engine' },
    });
  }
  return proposals;
}

/**
 * The lore entries whose text an assembled call carried: an included block
 * whose source is an entry. Keyed by entry id, as the timing channel is.
 */
export function loreReached(blocks: readonly AssembledBlock[] | undefined): Set<string> {
  const reached = new Set<string>();
  for (const block of blocks ?? []) {
    if (block.included && block.source.kind === 'lore') reached.add(block.source.entryId);
  }
  return reached;
}

/**
 * **Most recent first**, which is the order `scanDepth` counts in, and with the
 * pending input at the head.
 *
 * The input is included because it is the message the player just typed and the
 * one an entry is overwhelmingly most likely to be about — a scan that ignored
 * it would only ever notice a name one turn after it was said. It is also what
 * makes `latestMessage` above mean the right thing for the trim order.
 */
function messagesToScan(context: RetrieveContext): string[] {
  // A move's words with its pictures' captions — the player's own words about
  // what they showed are scanned as their other words are ([26 E15]). The
  // placeholder a picture with no caption gets is not: it is this engine's
  // words, and an entry keyed on *picture* must not fire because of it.
  const past = [...context.history]
    .reverse()
    .flatMap((turn) => [
      turn.output?.text,
      turn.input === undefined ? undefined : scanText(turn.input),
    ])
    .filter((text): text is string => typeof text === 'string' && text.length > 0);

  const pending = context.input === undefined ? undefined : scanText(context.input);
  // The round is newer than the input it answers, so it goes first, newest
  // first — which makes the previous speaker's reply the `latestMessage` the
  // shelf and the outlets read, as `chatForWI[0]` is the last saved message.
  const said = [...(context.round ?? [])].reverse().filter((text) => text.length > 0);
  return [...said, ...(pending === undefined || pending.length === 0 ? [] : [pending]), ...past];
}

/**
 * The named haystacks `additionalMatchingSources` can ask for — [04 §5].
 *
 * Deliberately a **small, documented set** rather than everything reachable. A
 * source an entry names and this does not supply is *reported* rather than
 * silently ignored ([match.ts]), so a name nobody recognises surfaces as a
 * question instead of as an entry that quietly never fires — which is the whole
 * reason the unknown-source list exists, and which only works if the supplied
 * set is knowable.
 *
 * The cast is joined rather than offered per actor, because an entry asking to
 * scan *the characters* means the scene's characters. Per-actor sources would
 * need names that depend on who is in the scene, and an entry naming
 * `description:vera` would stop working the day Vera leaves.
 */
function sourcesFor(context: RetrieveContext): Record<string, string> {
  const persona = context.persona?.actor;
  return {
    persona: persona === undefined ? '' : describe(persona),
    characters: context.actors.map((one) => describe(one.actor)).join('\n'),
  };
}

/**
 * An actor as one block of text to search.
 *
 * Name, aliases, tags, traits and the prose of every profile section — which is
 * everything about a card that reads as *description*, and no more. What is
 * deliberately not here is the actor's `openings` and `modeData`: an opening is
 * a line the character might say rather than a fact about them, and matching a
 * lore key against dialogue nobody has spoken yet would fire entries for a
 * scene that never happened.
 */
function describe(actor: CastMember['actor']): string {
  return [
    actor.name,
    ...actor.aliases,
    ...actor.tags,
    ...actor.profile.traits,
    ...actor.profile.sections.map((section) => `${section.title}\n${section.body}`),
  ]
    .filter((part) => part.length > 0)
    .join('\n');
}

function castIds(context: RetrieveContext): string[] {
  const persona = context.persona?.actor.id;
  const ids = context.actors.map((one) => one.actor.id);
  return persona === undefined ? ids : [persona, ...ids];
}

function castTags(context: RetrieveContext): string[] {
  const persona = context.persona?.actor.tags ?? [];
  return [...new Set([...persona, ...context.actors.flatMap((one) => one.actor.tags)])];
}

/**
 * The stored counters, read out of the entry-scoped channel.
 *
 * `scopeKeyOf` rather than string surgery, because the separator between a
 * channel id and its scope key is that module's business — [P5.5] widened
 * `applyEffects` to key on the pair, and a second place that split the key by
 * hand would be a second place to get it wrong.
 */
function timingFrom(channels: Readonly<Record<string, ChannelState>>): Record<string, EntryTiming> {
  const held: Record<string, EntryTiming> = {};
  for (const [key, state] of Object.entries(channels)) {
    if (!keyBelongsTo(key, SE_LORE_TIMING)) continue;
    const entryId = scopeKeyOf(key, SE_LORE_TIMING);
    if (entryId === null || entryId === '') continue;
    held[entryId] = timingOf(state.value);
  }
  return held;
}

function same(left: EntryTiming, right: EntryTiming): boolean {
  return (
    left.sticky === right.sticky && left.cooldown === right.cooldown && left.fired === right.fired
  );
}

/**
 * Outlet names the preset positions, and the lore slot's priority.
 *
 * Both read off the preset rather than passed in, because both are answers to
 * *what does this preset do with lore* and splitting them across two arguments
 * would let a caller supply one without the other.
 */
function outletsOf(preset: Preset): Set<string> {
  const named = new Set<string>();
  for (const block of preset.blocks) {
    if (!block.enabled || block.kind !== 'slot' || block.source.of !== 'lore') continue;
    const outlet = block.source.outlet;
    if (outlet !== undefined && outlet !== '') named.add(outlet);
  }
  return named;
}

/**
 * Which lore phases this preset has somewhere to put — [P6B.1].
 *
 * The sibling of {@link outletsOf}, and it exists for the reason that one does:
 * a placement the preset cannot take has to be **reported rather than dropped**,
 * and only the preset knows which it can take. Without it an entry positioned
 * `after_char` against a preset with no `after` slot activated, spent the
 * book's budget, and then vanished with the report still counting it kept —
 * which is most of an imported SillyTavern book ([P5 §0.5], [P6B §1.4]).
 *
 * A slot naming an outlet is **not** a slot for the ordinary entries of its
 * phase: the schema says an outlet slot takes that outlet, and one without
 * takes *the ordinary entries for its phase and no outlet at all*.
 */
function phasesOf(preset: Preset): Set<'before' | 'after'> {
  const phases = new Set<'before' | 'after'>();
  for (const block of preset.blocks) {
    if (!block.enabled || block.kind !== 'slot' || block.source.of !== 'lore') continue;
    const outlet = block.source.outlet;
    if (outlet === undefined || outlet === '') phases.add(block.source.phase);
  }
  return phases;
}

/**
 * The first enabled lore slot's priority.
 *
 * *First* rather than lowest or highest: a preset with several lore slots has
 * ranked them itself by declaring them in an order, and picking the extreme
 * would silently overrule that. Undefined when the preset gave none, which the
 * budgeter reads as the middle rather than as the most expendable.
 */
function lorePriorityOf(preset: Preset): number | undefined {
  for (const block of preset.blocks) {
    if (block.enabled && block.kind === 'slot' && block.source.of === 'lore') return block.priority;
  }
  return undefined;
}
