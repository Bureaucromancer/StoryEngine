// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import type { ChannelDefinition } from '@storyengine/sdk';
import type { PlotHook, Ref } from '@storyengine/shared';

import { introducedOn, isTerminal, readParty, readStatus } from './cast.js';
import { channelKey } from './channels.js';
import type { PooledHook, Turn } from './types.js';

/**
 * What has happened to the hooks in a session's pool, and which of them could
 * fire now — [06 §6.1](../../../../docs/design/06-modes-and-turn-pipeline.md),
 * [P7 §1.5], built at
 * [P7.5](../../../../docs/design/workplan/23-p7-implementation.md).
 *
 * **Separate from `hook-pool.ts`, which builds one**, and the split is a build
 * error rather than a taxonomy: building a pool reads the library, and this
 * module is imported by `mode-loader.ts` to register a channel. A type-only
 * import of the lore resolver was enough to drag the storage layer into the
 * tools project's graph, where `write-file-atomic`'s declarations are not on the
 * path — the third time this repository has hit that, after [P7.3]'s `Binding`
 * and this stage's own `PooledHook`. *Filtering a pool is a function of its
 * arguments; only building one does I/O.*
 */

/**
 * Which hooks have fired — [06 §6.1], [P7 §1.5], built at [P7.5].
 *
 * ***A channel from the first line written, and there was nothing to move.***
 * [P7 §1.5] names this as one of two pre-existing corrections this phase
 * discharges, and then corrects itself: *"there is nothing to move and nothing
 * to correct. `SessionFile` has never had a fired-set, and [03 §4.1] has already
 * been corrected in place — it now reads 'Which have fired is channel state, not
 * a session field'."* So this is a **new** channel definition rather than a
 * migration.
 *
 * **Why it cannot be a session field**: a flat set does not branch. Rewind past
 * the turn a hook fired on and it must be back in the pool, which is the
 * property every channel has for free and which a `Set<string>` on
 * `session.json` has never had.
 *
 * **The pool stays session-wide; only the per-hook state is a channel**, which
 * is §1.5's own line. A hook's *existence* in this session is configuration and
 * was copied at creation; what has happened to it is play.
 *
 * *`engine-computed`, because a firing is the selector's decision and a model
 * proposing one would be a hook firing itself. `budget: null` and no `render`:
 * the pool never enters a prompt, and a fired hook's premise least of all —
 * [08 §6] and [10 §10.1] both make an unfired entrance hidden content, and the
 * one thing worse than spoiling it in a panel is spoiling it in the prompt.*
 */
export const SE_HOOK = 'se.hook';

/**
 * What has happened to one hook.
 *
 * **Two arms, and `committed` is not one of them yet.** [06 §6.1]'s Commit is a
 * third state — must-fire, exempt from cooldown, opening the pacing gate every
 * turn until it lands — and it arrives with the control that writes it. A value
 * the filter could read and nothing could produce is the placeholder shape this
 * phase keeps refusing; the schema widens additively when Commit ships.
 *
 * `provisional` is [06 §6.1]'s honest reading of the slot an introduction fires
 * through: guidance is advisory and the narrator may decline it, and for an
 * introduction a decline is *"a silent permanent loss — marked fired, character
 * never arrived, and once-only"*. So it is recorded provisionally and becomes
 * fired only when the extract stage confirms the subject present. **Absent is in
 * the pool**, which is also where a lapsed provisional returns to — the attempt
 * stays on the record, which is what the effect log is.
 */
export const HOOK_STATES = ['fired', 'provisional'] as const;
export type HookState = (typeof HOOK_STATES)[number];

export const HOOK_CHANNEL: ChannelDefinition = {
  id: SE_HOOK,
  owner: 'storyengine.hooks',
  version: 1,
  scope: 'hook',
  update: 'engine-computed',
  /**
   * **Hidden**, which is the one visibility decision here that is not obvious.
   * A fired hook is not a secret — the panel shows it — but `visibility` governs
   * what may reach a *prompt*, and an unfired hook's premise is hidden content
   * by [08 §6]'s definition. The panel reads the session's pool and this channel
   * directly; nothing about that needs the channel to be player-visible.
   */
  visibility: 'hidden',
  schema: { type: 'string', enum: [...HOOK_STATES] },
  init: { kind: 'literal', value: null },
  budget: null,
};

/** What this session has done with one hook, at a node. Absent is *in the pool*. */
export function readHookState(
  channels: Readonly<Record<string, { value: unknown }>>,
  hookId: string,
): HookState | null {
  const held = channels[channelKey(SE_HOOK, hookId)]?.value;
  return typeof held === 'string' && (HOOK_STATES as readonly string[]).includes(held)
    ? (held as HookState)
    : null;
}

/**
 * Why a hook is not eligible — a **class, not prose**.
 *
 * [06 §6.1] wants an author to see *"which are blocked **and by what**"*, and
 * this codebase's standing rule for a durable reason is the one progress events
 * are held to: the panel maps a class to a sentence, and nothing grows another
 * free-English field. Each arm is a different remedy, which is the test for
 * whether it earns its place:
 *
 * - `fired` / `pending` — this hook already went. Nothing to do.
 * - `book-inactive` — its lorebook is no longer in the session. Re-add the book.
 * - `blocked` — a `blockedBy` hook has fired. Nothing to do; it is by design.
 * - `too-early` — `notBefore`. Wait, or lower the bound.
 * - `cast-gone` — an `involves` member is unresolvable, dead, or never met.
 * - `subject-gone` — the subject of an introduction does not resolve. **The one
 *   arm that is an authoring error rather than a state**: [04 §6.1a] makes a
 *   dangling `introduces.actor` *"a broken hook, not a retired one… ineligible
 *   with a visible reason, and the author is told"*, where a dangling `involves`
 *   entry retires a hook quietly. Same field type, opposite treatment.
 * - `subject-met` — they are already introduced, which is the whole point of the
 *   hook being spent.
 * - `subject-unavailable` — dead, the persona, or already in the party.
 */
export type HookRefusal =
  | 'fired'
  | 'pending'
  | 'book-inactive'
  | 'blocked'
  | 'too-early'
  | 'cast-gone'
  | 'subject-gone'
  | 'subject-met'
  | 'subject-unavailable';

export interface HookVerdict {
  hook: PlotHook;
  /** `null` when it is eligible. */
  refusal: HookRefusal | null;
}

export interface FilterContext {
  /** Channel state at the node being judged. */
  channels: Readonly<Record<string, { value: unknown }>>;
  /** The path to that node — `notBefore.turn` and *introduced* are both counted on it. */
  path: readonly Turn[];
  /** Lorebook ids the session currently has in play. */
  activeBooks: ReadonlySet<string>;
  /**
   * Actor ids that resolve.
   *
   * **Passed rather than looked up**, so this stays a function of its arguments:
   * resolving a `Ref` is a library read, and a filter that did I/O could not be
   * tested against a table of cases. The caller reads once for the whole pool.
   */
  known: ReadonlySet<string>;
  persona: string | null;
}

/**
 * [06 §6.1]'s **stage one**: mechanical eligibility, no model call.
 *
 * *"This is what stops a hook firing about someone who died four sessions ago,
 * and it also cuts thirty hooks to a handful before anything expensive happens —
 * a package with a large pool must not mean thirty premises in a prompt every
 * turn."* Cheap filter before expensive judgement, and inverting it is both
 * costlier and worse, because *"a model asked to consider ineligible hooks will
 * argue for them"*.
 *
 * **Four of §6.1's five clauses, and the fifth was removed on purpose.** That
 * section lists `involves`, `requires`, `blockedBy`, `notBefore` and
 * already-fired; `requires` was deliberately dropped from the `/1` schema with
 * `onFire`, because the authored-rule vocabulary is 6.0 — *"rather than ship a
 * /1 schema with two fields typed against something unwritten"*. It returns
 * additively, so this returns to five clauses without a schema version.
 *
 * *Plus one §6.1 does not list because [03 §4.1] owns it: a hook carried by a
 * lorebook is only eligible while that book is active. That section calls it
 * "a mechanical justification for the association, rather than 'it seemed
 * handy'", and it is why a pooled hook records which book it came from.*
 *
 * **Every hook comes back, eligible or not.** The judgement pass takes the
 * eligible ones; the panel takes all of them, because *"nothing about a held
 * hook may be invisible"* and an author with thirty hooks cannot test them by
 * playing to turn 200.
 */
export function filterHooks(pool: readonly PooledHook[], context: FilterContext): HookVerdict[] {
  const fired = new Set<string>();
  for (const entry of pool) {
    if (readHookState(context.channels, entry.hook.id) === 'fired') fired.add(entry.hook.id);
  }
  const introduced = introducedOn(context.path);

  return pool.map((entry) => ({
    hook: entry.hook,
    refusal: refuse(entry, context, fired, introduced),
  }));
}

function refuse(
  entry: PooledHook,
  context: FilterContext,
  fired: ReadonlySet<string>,
  introduced: ReadonlySet<string>,
): HookRefusal | null {
  const { hook, source } = entry;

  const state = readHookState(context.channels, hook.id);
  if (state === 'fired') return 'fired';
  if (state === 'provisional') return 'pending';

  if (source.kind === 'lore' && !context.activeBooks.has(source.id)) return 'book-inactive';

  for (const blocker of hook.blockedBy ?? []) {
    if (fired.has(blocker)) return 'blocked';
  }

  const notBefore = hook.notBefore;
  if (notBefore !== undefined) {
    if (notBefore.turn !== undefined && context.path.length < notBefore.turn) return 'too-early';
    if (notBefore.afterHook !== undefined && !fired.has(notBefore.afterHook)) return 'too-early';
  }

  /**
   * **`involves` means *dead, gone, or never introduced*** — [04 §6.1a]'s words
   * for the disqualifiers. Not bookkeeping: [03 §4.1] says firing a hook about
   * someone who died four sessions ago *"destroys confidence in the mechanism in
   * one message"*.
   */
  for (const who of hook.involves) {
    if (!available(who, context, introduced)) return 'cast-gone';
  }

  return hook.introduces === undefined
    ? null
    : refuseIntroduction(hook.introduces.actor, context, introduced);
}

/** Resolves, has been met, and is not written out of the story. */
function available(who: Ref, context: FilterContext, introduced: ReadonlySet<string>): boolean {
  return (
    context.known.has(who.id) &&
    introduced.has(who.id) &&
    !isTerminal(readStatus(context.channels, who.id))
  );
}

/**
 * **The reversal, written out rather than described as one** — [04 §6.1a], which
 * spells the predicate because describing it as *the inverse of `involves`* gets
 * it wrong: *"a subject who is dead is no more introducible than an `involves`
 * cast member who is. Exempting the subject from the whole check would fire
 * 'Vera walks into the bar' for a Vera the session recorded dead four sessions
 * ago."*
 *
 * > Eligible when the subject **resolves**, is **not yet introduced**, carries no
 * > terminal status, is **not the persona**, and is **not already in the party**.
 *
 * *The last two are not hypothetical: a Setup's `cast.partyDefault` can name the
 * same actor a lorebook-borne hook wants to introduce.*
 */
function refuseIntroduction(
  subject: Ref,
  context: FilterContext,
  introduced: ReadonlySet<string>,
): HookRefusal | null {
  if (!context.known.has(subject.id)) return 'subject-gone';
  if (introduced.has(subject.id)) return 'subject-met';
  if (isTerminal(readStatus(context.channels, subject.id))) return 'subject-unavailable';
  if (subject.id === context.persona) return 'subject-unavailable';
  if (readParty(context.channels, subject.id, context.persona) !== null)
    return 'subject-unavailable';
  return null;
}
