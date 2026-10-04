// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import type { Binding } from '../providers/types.js';
import { moveText } from '../assembly/pictures.js';
import { digest } from './digest.js';

/**
 * The rolling summary, keyed — [07 §5.1](../../../../docs/design/07-branching.md),
 * [26 E1](../../../../docs/design/26-open-questions.md), [P8.0].
 *
 * **"Rolling" describes the chain, not mutation.** [07 §5.1] is explicit that
 * the forbidden design is the one-record-updated-in-place version, *"and it is
 * forbidden for a reason worth restating: it is the obvious implementation, it
 * looks identical from the UI, and the damage only shows up the first time
 * someone branches a long session."* Nothing in the product surface will ever
 * reveal which of the two was built, which is why
 * [P8](../../../../docs/design/workplan/25-p8-implementation.md)'s header makes
 * it a review item rather than a detail.
 *
 * **This module is the keying and nothing else.** It does no I/O, makes no model
 * call and reads no configuration, so every property the phase turns on can be
 * asserted over plain values. `summaries.ts` beside it is the store, and the one
 * function that composes the two lives there.
 *
 * ---
 *
 * ***Two levels, and the summariser's identity in the key*** — [P8 §1.9], which
 * is [P6 §0.2](../../../../docs/design/workplan/18-p6-implementation.md)
 * re-reading 07 §5.1 against P8 and finding the handoff is three-party rather
 * than two: [13](../../../../docs/design/13-write-mode.md)'s node summaries ride
 * this same machinery. The flat formula in P8's header is the shape of the
 * result, not the shape of the keys:
 *
 * ```
 * unit(t)  = f_unit( content(t) )                     two: keyed by content, not by id
 * link(n)  = f_link( key(link(n-1)), [key(unit_a) … key(unit_b)] )
 * key(x)   = H( SUMMARISER + x's declared inputs )
 * ```
 *
 * - **A unit is keyed by its content, never by its turn id.** In Play a rewrite
 *   makes a *sibling node* with a new id, so ids happen to work and the
 *   difference is invisible — *which is exactly why building it wrong here is
 *   cheap and discovering it in Write is not.* In Write a node is edited in
 *   place and keeps its id, so an id-keyed unit is a stale cache that never
 *   misses.
 * - **A link is keyed by the sequence of unit keys, never by prose.** This is
 *   the whole reason for two levels. In Play a fork invalidates one link; in
 *   Write dragging a chapter invalidates every link after it — recomputed from
 *   unit keys that is a cheap re-summarise over summaries, and recomputed from
 *   prose it is the full pass again.
 * - **`SUMMARISER` is the *resolved* binding, not the declared role.** [07 §5]
 *   says *"plus the summariser prompt, model and parameters"* and §5.1 drops it
 *   when it restates the formula, which is how both documents came to miss it. A
 *   session's `stepRoles` send the same declared role to different models, so
 *   the declared role identifies nothing.
 *
 * ***`f_unit` is the identity here, and the two-level keying is still the
 * point.*** In Play a unit is one turn and its condensation is its own words, so
 * a second derived store would be machinery nothing reads. What must exist now
 * is the *key* shape: a link that names unit keys rather than prose is a link
 * Write can re-derive by swapping `f_unit` for a real node summariser without
 * touching anything below. Building the one-level version and widening it later
 * is the migration this comment exists to avoid.
 */

export const SUMMARY_SCHEMA = 'storyengine.summary/1';

/**
 * How the path is cut into links.
 *
 * `window` is the mode's `historyWindow` — the turns `turns/gather.ts` hands the
 * collector verbatim. Nothing inside it is ever summarised, because a turn in
 * both the window and a link is two producers of the same words competing for
 * the same budget, which is what [P8.1]'s *deliberately not built* refuses.
 *
 * ***`span` is the open sizing, and this is the honest place to say so.***
 * [P8 §1.3] narrows cadence *"to a procedure rather than a decision"*: the
 * measurement that settles it is the ratio of extraction calls to narration
 * calls at the cadence the summariser already needs, and
 * [manual testing](../../../../docs/design/workplan/05-manual-testing.md)'s
 * sitting G supplies the denominator. Twenty is a default chosen to match the
 * window, so a link freezes exactly as the turns it covers leave it — not a
 * measured answer, and not to be read as one.
 */
export interface SummaryPolicy {
  /** Turns per link. At least one. */
  span: number;
  /** The mode's `historyWindow`. Turns inside it are never summarised. */
  window: number;
}

export const DEFAULT_SUMMARY_POLICY: SummaryPolicy = { span: 20, window: 20 };

/**
 * What the chain needs of a turn: a node to point at, and what was said.
 *
 * ***Narrower than `Turn`, and that is a refusal rather than a convenience.***
 * [P8 §1.3] grants the summariser the record — the two want different payloads,
 * which is why one step cannot be both summariser and extractor — and **this
 * declines the grant.** A turn's `request.calls[].blocks[].text` is *the prompt
 * that produced the turn*, and summarising the prompt rather than the story
 * would carry a hook's premise into every later prompt through the back door.
 * So the summariser step declares `reads: ['transcript']` and not `history`,
 * which also gives that pseudo-source a reader on the day it lands — [11 §4]'s
 * test for a new field, applied to a new source.
 *
 * `Turn` satisfies this structurally, so the store and the property test can
 * pass real records while the step passes the projection.
 */
export interface SummarisableTurn {
  id: string;
  /**
   * The move's words, and since 2026-09-27 its pictures' captions ([26 E15]) —
   * so a move that was a picture is summarised as one rather than as nothing.
   */
  input?: { text: string; attachments?: readonly { caption?: string }[] };
  output?: { text: string };
}

/**
 * One turn, as the chain addresses it.
 *
 * ***What is hashed and what is shown are separate fields, deliberately.***
 * {@link unitTextOf} is a canonical, unambiguous encoding built for a digest;
 * `said` and `replied` are the words a summariser is handed. A first draft had
 * one field doing both, and the step had to `JSON.parse` a key input to build a
 * prompt — which is the coupling worth avoiding by name, because **a prompt
 * rewrite must never be able to invalidate a chain.**
 */
export interface SummaryUnit {
  key: string;
  /** Display and navigation. **Never** part of any key — see the header. */
  turnId: string;
  /** What the player did. Empty when the turn carried no input. */
  said: string;
  /** What came back. Empty on a turn that failed or was suspended. */
  replied: string;
}

/**
 * A link the path calls for, before anything has been derived or read.
 *
 * `from` and `to` are inclusive indices **into the path, counted from the
 * root** — which is what makes the shared-prefix property true by construction
 * rather than by care. See {@link planChain}.
 */
export interface PlannedLink {
  key: string;
  previousKey: string | null;
  units: readonly SummaryUnit[];
  from: number;
  to: number;
  /** A full `span` of turns. A partial link is the one a fork invalidates. */
  complete: boolean;
}

/**
 * One link on disk. Content-addressed: the file's name is {@link SummaryLink.key}.
 *
 * ***No `createdAt`, and the absence is the interesting part of this shape.***
 * `sessions/snapshots.ts` carries one and should: a snapshot is named by the
 * node it is the state at, so two writes of the same node are two legitimate
 * files and knowing which is newer is worth a field. A summary is named by the
 * hash of its inputs, and a timestamp inside it would mean *the same key can
 * hold two different byte sequences* — which is precisely the equality
 * [P8 §3.1](../../../../docs/design/workplan/25-p8-implementation.md)'s row 3
 * promises: **content addressing makes regeneration byte-identical rather than
 * merely equivalent, so it is an equality and not a judgement.** A field that
 * changes on every write would have quietly turned that row back into a
 * judgement. The filesystem's mtime answers *when* for anyone who needs it.
 */
export interface SummaryLink {
  schema: typeof SUMMARY_SCHEMA;
  key: string;
  /** The resolved summariser's key, so a file says what produced it. */
  summariser: string;
  previousKey: string | null;
  unitKeys: readonly string[];
  /** Which turns this covered, for the block table. Display, never identity. */
  turnIds: readonly string[];
  from: number;
  to: number;
  text: string;
}

/**
 * ***Moved to `sessions/digest.ts` at [P9.1], and re-exported here.***
 *
 * It was private to this module while the summary chain was the only thing in
 * the build that keyed on content. [P9 §1.7]'s backdrop reuse key is the second
 * subject, and a helper two subsystems need is not this one's to keep — the
 * alternative P9 would have had is a second hand-rolled encoding beside it,
 * which is how two answers to *what is this keyed on* come to exist.
 *
 * Re-exported rather than relocated-and-rewired so that this module's callers
 * and `summary-chain-property.test.ts` do not move: the chain's keying is
 * unchanged, and the move is about where the bytes are counted rather than about
 * what they are counted over.
 */
export { digest };

/**
 * The resolved summariser's identity — [P8 §1.9]'s third bullet.
 *
 * **The whole binding, not the model id.** Two connections serving what they
 * both call `llama-3.1-8b` are not the same model, and the cost of being wrong
 * in that direction is a chain that silently mixes two models' prose; the cost
 * of being wrong in the other is a regeneration, which
 * [P8](../../../../docs/design/workplan/25-p8-implementation.md)'s own safety
 * argument says is what makes this phase safe — *summaries are derived and
 * disposable, so a bad summariser is a regeneration rather than lost history.*
 * An asymmetry that one-sided is not a close call.
 *
 * `params` is stringified rather than typed, because a summariser's generation
 * parameters are whatever the step passes and the key only has to change when
 * they do.
 */
export function summariserKey(binding: Binding, prompt: string, params: unknown): string {
  return digest([binding.connectionId, binding.modelId, prompt, JSON.stringify(params ?? null)]);
}

/**
 * What the chain summarises over: what was said, and what came back.
 *
 * ***Not the assembled record, and the restraint is worth stating even though
 * the summariser is entitled to it.*** [P8 §1.3] establishes that the summariser
 * *is* entitled to the record where the extractor is not — the two want
 * different payloads, which is the reason one step cannot be both. So this is
 * not a firewall. It is that a turn's `request.calls[].blocks[].text` is *the
 * prompt that produced the turn*, and summarising the prompt rather than the
 * story would carry a hook's premise into every later prompt through the back
 * door. The player's words and the narrator's reply are what happened.
 *
 * A failed or suspended turn has no output and contributes its input alone,
 * which is the honest reading: something was said and nothing came back.
 */
export function unitTextOf(turn: SummarisableTurn): string {
  const pictures = turn.input?.attachments ?? [];
  /**
   * ***The pictures' captions join the key only when there are pictures***, so
   * every chain built before they existed keeps every key it had. And it is the
   * captions that are hashed — `null` for none — never the words a prompt uses
   * to describe a picture: *"a prompt rewrite must never be able to invalidate
   * a chain"*, and rewording a placeholder is a prompt rewrite.
   */
  if (pictures.length === 0) {
    return JSON.stringify({ i: turn.input?.text ?? '', o: turn.output?.text ?? '' });
  }
  return JSON.stringify({
    i: turn.input?.text ?? '',
    a: pictures.map((picture) => picture.caption ?? null),
    o: turn.output?.text ?? '',
  });
}

/**
 * What a summariser is shown of a turn — the two display fields of a
 * {@link SummaryUnit}, and nothing that is hashed.
 *
 * ***One projection for every reader of the story's words*** (2026-10-03, at
 * the [P15.6] merge). {@link planChain} builds each unit's display fields with
 * it, and the setup draft (`turns/condense.ts`) builds the turns after the
 * chain with it — turns inside the window, which are no link's units and have
 * no key. The draft had its own copy, `{ said: input.text }`, written before a
 * move could carry pictures; it showed a model a picture move as nothing at
 * all, where the summariser shows the stand-ins `moveText` writes. Two copies
 * of *what a turn says* is how two readers of one story come to disagree.
 */
export function unitWordsOf(turn: SummarisableTurn): Pick<SummaryUnit, 'said' | 'replied'> {
  return { said: moveText(turn.input), replied: turn.output?.text ?? '' };
}

/** `H(SUMMARISER + content(t))`. **Content, never the turn id** — see the header. */
export function unitKeyOf(summariser: string, turn: SummarisableTurn): string {
  return digest(['unit', summariser, unitTextOf(turn)]);
}

/** `H(SUMMARISER + key(link(n-1)) + [key(unit)…])`. **Unit keys, never prose.** */
export function linkKeyOf(
  summariser: string,
  previousKey: string | null,
  unitKeys: readonly string[],
): string {
  return digest(['link', summariser, previousKey ?? '', ...unitKeys]);
}

/**
 * ***The chain's root: what had already happened before the first turn*** —
 * [04 §7.2](../../../../docs/design/04-schemas.md),
 * [P15.2](../../../../docs/design/workplan/33-p15-setup-from-a-turn.md).
 *
 * A session started from a Setup made from a turn of another session carries
 * `storySoFar`, and [07 §5.1]'s formula takes it as link zero:
 * `summary(1) = f(root, turns)`. **That is a seeded start and not a second
 * mechanism** — the root is handed to the first link as `previous`, exactly as
 * every later link is handed the one before it, and the collector emits it as
 * the oldest candidate in the summary slot.
 *
 * *What `previous` means changed under it* (2026-10-03, at the merge into a
 * `main` that had `e9d1a142`): a link summarises **its own stretch** and is
 * handed the one before as context only, told not to repeat it. So the root is
 * the stretch before the first turn and the first link does not retell it —
 * which is why every reader of the story so far has to read the root and the
 * links together (`turns/condense.ts`, and the collector's root arm), never the
 * newest link as though it covered everything.
 *
 * `setupId` is carried for the block table's click-through and is **never part
 * of the key**. Two Setups with the same words are the same start of a story as
 * far as a summariser can tell, and a key that differed would re-derive a chain
 * over identical inputs.
 */
export interface SummaryRoot {
  key: string;
  text: string;
  setupId: string | null;
}

/**
 * The root a session's Setup copy calls for, or `null` when there is none.
 *
 * **Keyed by its text alone**, under a tag no other digest here uses, so a root
 * can never collide with a link or a unit. *Trimmed, and empty is none*: a
 * Setup whose story so far was cleared back to whitespace is a fresh start,
 * and a root of nothing would re-key every link for the sake of an empty
 * paragraph.
 */
export function summaryRootOf(
  setup: { id?: string; storySoFar?: string } | undefined,
): SummaryRoot | null {
  const text = setup?.storySoFar?.trim() ?? '';
  if (text === '') return null;
  return {
    key: digest(['root', text]),
    text,
    setupId: typeof setup?.id === 'string' && setup.id !== '' ? setup.id : null,
  };
}

/**
 * The links a path calls for, in order. Pure, and the stage's whole claim.
 *
 * ***Boundaries are anchored to depth from the root, never to distance from the
 * head.*** Link *k* covers path indices `[k * span, (k + 1) * span)`. A fork is
 * a sibling inside the **same session directory**, so the shared prefix has
 * identical depth indices, identical turns, identical unit keys and therefore
 * identical link keys — *two lines resolve the same key to the same file, and
 * nothing has to copy anything or decide not to.* Head-relative boundaries would
 * shift every time a line grew, which is the same defect as a mutable record
 * wearing a content-addressed hat.
 *
 * **The trailing link is the one in progress, and it freezes for free.** Its
 * range is truncated at the window, so it gains a unit per turn and re-keys each
 * time — which is [07 §5]'s *"at most one summary is ever invalidated by a fork:
 * the one in progress"*, arrived at rather than arranged for. When it reaches a
 * full `span` its unit list is exactly the list it would have had as a complete
 * link, so **the key it arrives at is the key it would have been given**, and
 * freezing costs no model call at all.
 *
 * Nothing inside the window is covered, per {@link SummaryPolicy}.
 */
export function planChain(
  path: readonly SummarisableTurn[],
  summariser: string,
  policy: SummaryPolicy,
  /**
   * The root's key — {@link summaryRootOf} — or `null` for a session that
   * started fresh.
   *
   * **It enters as the first link's `previousKey` and nowhere else**, so a
   * rooted chain is keyed exactly as an unrooted one from its second link's
   * point of view: each key still names its predecessor and its units. And
   * **`null` is the value every existing chain was keyed with**, so a session
   * without a root derives byte-identical keys to the ones already on disk —
   * [P15.2]'s proof obligation, and the reason this is a trailing parameter
   * with a default rather than a change to anybody's call.
   */
  rootKey: string | null = null,
): PlannedLink[] {
  const span = Math.max(1, Math.floor(policy.span));
  const coverable = Math.max(0, path.length - Math.max(0, Math.floor(policy.window)));

  const links: PlannedLink[] = [];
  let previousKey: string | null = rootKey;

  for (let from = 0; from < coverable; from += span) {
    const to = Math.min(from + span, coverable) - 1;
    const units: SummaryUnit[] = [];
    for (let at = from; at <= to; at += 1) {
      const turn = path[at];
      // `noUncheckedIndexedAccess`, and the guard is not ceremonial: `coverable`
      // is derived from `path.length` above, so a hole here would mean the array
      // changed underneath the loop — a miss is the right answer either way.
      if (turn === undefined) continue;
      units.push({
        key: unitKeyOf(summariser, turn),
        turnId: turn.id,
        ...unitWordsOf(turn),
      });
    }

    const key = linkKeyOf(
      summariser,
      previousKey,
      units.map((unit) => unit.key),
    );
    links.push({ key, previousKey, units, from, to, complete: to - from + 1 === span });
    previousKey = key;
  }

  return links;
}
