// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import type { ChannelDefinition } from '@storyengine/sdk';
import type {
  DifficultyLevel,
  HookPacing,
  HookRefusal,
  PlotHook,
  Preset,
  Ref,
} from '@storyengine/shared';

import { introducedOn, isTerminal, readParty, readStatus } from './cast.js';
import { channelKey, initialValue } from './channels.js';
import { storyDepth } from './depth.js';
import { levelFragments } from './dials.js';
import { pooledSource } from './pool-shape.js';
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
 * ~~**Two arms, and `committed` is not one of them yet.**~~ ***Three, as of
 * [P7.5] stage four*** — the arm arrived with the control that writes it, which
 * is the condition the paragraph below set. *A value the filter could read and
 * nothing could produce is the placeholder shape this phase keeps refusing*, and
 * what changed is not that the rule relaxed: `PUT /sessions/:id/channels/:key`
 * writes this channel attributed to a **person**, and `engine-computed` refuses
 * a `model` and a `step` and admits a `user` — deliberately, and stated in
 * `effects.ts` in as many words. So Commit needed no route and no policy change,
 * only this enum widening to let the schema accept the value.
 *
 * `committed` is [06 §6.1]'s *"I want this to happen — not necessarily on this
 * turn"*: **must-fire, exempt from cooldown and cadence, opening the pacing gate
 * every turn until it lands**, and skipping eligibility because *"a person
 * overriding a filter is a decision, not a bug"*. What it does **not** do is
 * choose the moment — stage two still runs, with the question changed from
 * *whether* to *where*, which is the difference between committing a hook and
 * forcing one.
 *
 * `forced` is the **other** hand control, and [06 §6.1] keeps the two apart for
 * a reason that is not filing: *"Commit is a move in the story and belongs where
 * the story is played; force-fire is a test of the material and belongs in the
 * workbench."* It stays what it sounds like — *"the hook is delivered on the next
 * turn with no judgement call at all"* — so where a commitment opens the gate and
 * still asks **where**, this skips the gate and the call alike. **It is a state
 * rather than a request because the intent has to live somewhere between the
 * click and the turn**, and a channel is the only home that branches: force a
 * hook, rewind past the forcing, and it is not forced on the line you came back
 * to.
 *
 * `provisional` is [06 §6.1]'s honest reading of the slot an introduction fires
 * through: guidance is advisory and the narrator may decline it, and for an
 * introduction a decline is *"a silent permanent loss — marked fired, character
 * never arrived, and once-only"*. So it is recorded provisionally and becomes
 * fired only when the extract stage confirms the subject present. **Absent is in
 * the pool**, which is also where a lapsed provisional returns to — and where a
 * lapsed *commitment* returns to. The attempt stays on the record either way,
 * which is what the effect log is.
 */
export const HOOK_STATES = ['fired', 'provisional', 'committed', 'forced'] as const;
export type HookState = (typeof HOOK_STATES)[number];

/**
 * How many turns a commitment waits before it lapses — [06 §6.1], [P7.5].
 *
 * **Three, and a constant rather than a setting**: *"pacing is untested, and a
 * number nobody has played against is a guess, not a tunable."*
 *
 * ***And the deadline is a lapse rather than a firing***, which is the decision
 * worth keeping in front of a reader who is tempted to "fix" it. *"A commitment
 * that waits forever is indistinguishable from no commitment, and one that fires
 * anyway at the deadline delivers the twist at the exact moment the selector has
 * already rejected three times — the worst available moment."* So it returns to
 * the pool and **says so**, because a silent lapse is worse than either outcome.
 */
export const HOOK_PATIENCE = 3;

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
  /**
   * ***`null` is in the enum, and leaving it out was a real bug rather than
   * tidiness*** — found at [P7.5] stage four, when a lapsing commitment tried to
   * put a hook back in the pool and `acceptEffect` refused the write against
   * this very schema.
   *
   * **A channel whose `init` is a value its schema rejects cannot be returned to
   * its initial state.** That is what `{ type: 'string' }` said here: the
   * declaration below starts every hook at `null`, and nothing could ever write
   * `null` again. It was invisible for exactly as long as nothing tried —
   * firing only ever writes a string — and `channels.test.ts` now holds every
   * registered channel to the invariant, because the next declaration to get it
   * wrong will get it wrong the same way.
   */
  schema: { type: ['string', 'null'], enum: [...HOOK_STATES, null] },
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

// ***`HookRefusal` moved to `@storyengine/shared` at [P7.5] stage three***, where
// the selector's record line carries it. It was written here beside the filter
// that produces it, and the argument for the move is the one `StepSkipReason`
// and `NotFilledReason` already answer to: **a class a client renders is a
// record vocabulary**, and a second copy of a nine-arm union is the thing that
// drifts. The nine arms and the remedy each one implies are documented there.

/** One hook and what this session's filter made of it. */
export interface HookVerdict {
  hook: PlotHook;
  /** `null` when it is eligible. */
  refusal: HookRefusal | null;
  /**
   * Present when a person's commitment is carrying this hook — [06 §6.1],
   * [P7.5].
   *
   * ***Its presence is the commitment, and `overrode` is the first of the three
   * rules that keep Commit honest.*** *"Skipping the filter must say what it
   * skipped. The failure this section names twice is a hook firing about someone
   * dead four sessions ago; a control that permits it silently reintroduces that
   * failure by hand."* So `refusal` goes to `null` — the hook **is** eligible,
   * because a person said so — and the clause it walked past travels beside it,
   * `null` when there was none.
   *
   * *One field rather than two, because the two facts are one fact*: a reader
   * needs *this is committed* and *this is what committing it cost* together, and
   * a `committed: true` beside an `overrode?:` would let a record carry the
   * second without the first.
   */
  committed?: { overrode: HookRefusal | null };
  /**
   * Present when a person has **force-fired** it — [06 §6.1], [P7.5].
   *
   * ***A field of its own rather than a `kind` on the one above, because the two
   * are different acts and a reader must not have to infer which.*** A
   * commitment says *make this happen, not necessarily now* and keeps asking
   * where until its patience runs out; a force says *deliver it on the next
   * turn with no judgement call at all*. They share a shape and nothing else,
   * and the states are exclusive on one channel, so exactly one of the two is
   * ever present.
   *
   * `overrode` carries the same obligation for the same reason: skipping the
   * filter must say what it skipped, and a control that skips **more** owes the
   * sentence more, not less.
   */
  forced?: { overrode: HookRefusal | null };
}

export interface FilterContext {
  /** Channel state at the node being judged. */
  channels: Readonly<Record<string, { value: unknown }>>;
  /**
   * The path to that node — `notBefore.turn` and *introduced* are both read
   * from it, the first in story turns (`depth.ts`).
   */
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

  return pool.map((entry) => {
    const refusal = refuse(entry, context, fired, introduced);
    /**
     * **A commitment carries a hook past the filter, and records what it carried
     * it past** — [06 §6.1], [P7.5]. *"A person overriding a filter is a
     * decision, not a bug"*, and the decision is still answerable afterwards
     * because the clause travels with it.
     *
     * *`refuse` runs in full for a committed hook rather than being skipped*,
     * which is the only way `overrode` can say anything: the state check at the
     * top of it returns early for `fired` and `provisional` and deliberately not
     * for this, so every clause below is still evaluated and the first failure is
     * what a person overrode.
     */
    const state = readHookState(context.channels, entry.hook.id);
    if (state === 'committed') {
      return { hook: entry.hook, refusal: null, committed: { overrode: refusal } };
    }
    if (state === 'forced') {
      return { hook: entry.hook, refusal: null, forced: { overrode: refusal } };
    }
    return { hook: entry.hook, refusal };
  });
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
  // `committed` and `forced` are deliberately not early returns: their caller
  // wants every clause below evaluated, so that skipping the filter can say what
  // it skipped.

  if (source.kind === 'lore' && !context.activeBooks.has(source.id)) return 'book-inactive';

  for (const blocker of hook.blockedBy ?? []) {
    if (fired.has(blocker)) return 'blocked';
  }

  const notBefore = hook.notBefore;
  if (notBefore !== undefined) {
    // Story turns, not the path's length: a HUD edit or a backdrop choice is a
    // turn on the path and not a turn of the story (`depth.ts`, 2026-09-27).
    if (notBefore.turn !== undefined && storyDepth(context.path) < notBefore.turn) {
      return 'too-early';
    }
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

/**
 * How much authored plot to push at a player — [06 §6.1], [04 §6.1b], [P7.5].
 *
 * ***The dial is a channel***, and 06 §6.1 lists the properties that makes free:
 * session scope, `user-only`, `budget: null` so it never enters a prompt, and
 * `init` from the authored value. *"Every property it needs is already there —
 * it is changeable mid-session, the change is an effect on the record, and it
 * branches correctly — so it costs no new concept."*
 *
 * **`user-only` is [P7 §1.4]'s first exercise of a branch nothing had reached.**
 * That section records `update: 'user-only'` as *"never exercised —
 * `turns/effects.ts:110-112` is the only branch that returns it and no shipped
 * channel declares the policy"*. This is the first channel that does, so the
 * first thing that proves the refusal works: a model proposing a pacing change
 * is a model turning its own volume up.
 *
 * ***And it refuses the engine too, which is what makes this policy a different
 * one rather than a stricter spelling of `engine-computed`.*** 06 §6.1 calls the
 * dial *author-facing*, and every other clause of that section is about keeping
 * the selector from deciding how often it gets to decide — *"`aggressive` must
 * not reach railroading"* is the same worry one level up. An engine that could
 * adjust this is a selector able to widen its own gate, so the refusal is
 * everything but a person, and `effects.test.ts` proves all three proposers.
 *
 * **`visibility: 'player'`, where `se.hook` beside it is hidden**, and the two
 * are consistent: [08 §6] makes an *unfired hook's premise* hidden content, and
 * this holds no premise. It is a setting somebody chose about their own session,
 * which a HUD may show and which `budget: null` keeps out of a prompt regardless
 * — visibility governs what may reach one, and there is nothing here to send.
 *
 * **`init: authored`**, which is the arm [P7.1] declared and nothing read — the
 * `field` is a name on a Treatment and on a Setup, and 04 §6.1b's layering is
 * *"a Treatment proposes, a Setup overrides, and the running session owns it"*.
 * `readPacing` is where those three rungs are resolved; the `fallback` is what an
 * unauthored session gets, and 04 §6.1b is explicit that *unspecified* does not
 * mean the middle of the range — the channel says what it resolves to, and
 * `normal` is that answer.
 */
export const SE_HOOK_PACING = 'se.hook.pacing';

export const PACING_LEVELS = ['sparse', 'normal', 'aggressive', 'manual-only'] as const;

export const HOOK_PACING_CHANNEL: ChannelDefinition = {
  id: SE_HOOK_PACING,
  owner: 'storyengine.hooks',
  version: 1,
  scope: 'session',
  update: 'user-only',
  visibility: 'player',
  schema: { type: 'string', enum: [...PACING_LEVELS] },
  init: { kind: 'authored', field: 'hookPacing', fallback: 'normal' },
  budget: null,
};

/**
 * The dial at a node — [04 §6.1b]'s three rungs, resolved in order, over the
 * declaration's own answer for a session that authored none.
 *
 * **The session owns it, a Setup overrides, a Treatment proposes.** The channel
 * value is the session's own and wins outright; below it the Setup the session
 * was created from, which [P7.4] made reachable by recording it; below that the
 * treatment, which is a **link** and so is passed in resolved rather than read
 * here.
 *
 * ***Why this resolves the rungs rather than `init` doing it.*** The
 * `authored` arm was built at [P7.1] with no reader, and `initialValue` returns
 * its `fallback` without consulting anything an author wrote — deliberately, per
 * its own test: the channel module *"has no business reading"* a session's
 * treatment and setup, which are a library link and a record field it would have
 * to resolve. So the arm names the field and the reader finds it, which is also
 * the only arrangement under which a Setup can outrank a Treatment: `init` is
 * one value, and [04 §6.1b] is an ordering over two.
 *
 * *A value this build does not know reads as unset rather than as itself*, which
 * is the posture every other reader here takes: the channel's schema refuses one
 * on the way in, and a hand-edited file is the path that gets past it.
 *
 * **Authored values are read untyped and validated here** rather than taken as
 * `HookPacing` from the portable schema, because the caller reads them off a
 * `Treatment` and a `Setup` that were parsed somewhere else and may be a build
 * ahead of this one — [04 §2]'s additive door is exactly how a `/1` acquires a
 * level this engine has never heard of.
 */
export function readPacing(
  channels: Readonly<Record<string, { value: unknown }>>,
  authored: {
    setup?: { hookPacing?: unknown } | undefined;
    treatment?: { hookPacing?: unknown } | undefined;
  } = {},
): HookPacing {
  return (
    asPacing(channels[SE_HOOK_PACING]?.value) ??
    asPacing(authored.setup?.hookPacing) ??
    asPacing(authored.treatment?.hookPacing) ??
    asPacing(initialValue(SE_HOOK_PACING)) ??
    FALLBACK_PACING
  );
}

/**
 * What the dial reads in a build where nothing registered it.
 *
 * **Not a second opinion about how much plot a session should be pushed** — it
 * is what a reader with no pacing channel in the registry has to say, and the
 * honest options were this or a throw. `clockStart` faced the identical choice
 * and answered it the same way: a throw would mean a session that cannot take a
 * turn because a channel is missing, which [00 §3.3] and [06 §4.2] refuse.
 *
 * *The fourth rung above is the declaration read back rather than restated* —
 * the same round trip `clockStart` makes through {@link initialValue}. Writing
 * `?? 'normal'` there would have been a second statement of
 * `HOOK_PACING_CHANNEL.init.fallback`, and [04 §6.1b] is explicit that the
 * channel is what says what unspecified resolves to. Change the declaration and
 * this follows; the constant below is only reachable when there is no
 * declaration to follow.
 */
const FALLBACK_PACING: HookPacing = 'normal';

function asPacing(value: unknown): HookPacing | null {
  return typeof value === 'string' && (PACING_LEVELS as readonly string[]).includes(value)
    ? (value as HookPacing)
    : null;
}

/**
 * What each level costs the selector, in turns.
 *
 * ***Engine code, and the level's prose is the prompt pack's*** — [06 §6.1]
 * draws that line and gives the reason: [06 §7.3.1] puts difficulty's levels in
 * the pack, and *"the half of that argument which transfers is the half about
 * **prose**"*. The numbers do not transfer, because *"their effect is that a
 * step does not run, which is invisible in the turn record by construction, and
 * letting a portable preset set internal scheduling inverts the dependency the
 * step contract exists to keep one-way"*.
 *
 * `cadence` is how often the **judgement** runs; `cooldown` is how long after a
 * firing before it may run again. *A cooldown longer than the cadence is the
 * point of having both: `sparse` considers rarely and, having fired, waits
 * longer still.*
 *
 * **`manual-only` has no cadence at all, and is a coherent state rather than a
 * dead step**: 06 §6.1 says the filter still runs and still reports, and only
 * the judgement is off. An author with thirty hooks can still see which are
 * eligible.
 */
const PACING: Record<HookPacing, { cadence: number; cooldown: number }> = {
  sparse: { cadence: 6, cooldown: 20 },
  normal: { cadence: 3, cooldown: 10 },
  aggressive: { cadence: 1, cooldown: 4 },
  // Never judged. The cooldown is irrelevant and is written as the cadence so a
  // reader is not invited to wonder whether the two disagree.
  'manual-only': { cadence: Number.POSITIVE_INFINITY, cooldown: Number.POSITIVE_INFINITY },
};

/**
 * Why the judgement pass did or did not run — a class, not prose.
 *
 * *"A selector that returns early because of pacing is indistinguishable, from
 * the outside, from one that ran and judged none"* ([06 §6.1]) — so these are
 * the answers that have to be told apart, and `nothing-eligible` is separate
 * from `held` for exactly that reason. `judged` means the call happened; what it
 * answered is the selector's line, not the gate's.
 */
export type GateVerdict = 'held' | 'cooling' | 'nothing-eligible' | 'judged';

/**
 * [06 §6.1]'s gate, inside the step rather than on it.
 *
 * ***Not a `StepCondition`, and the reason is invisible from the design document
 * — which is why that section records it.*** A committed hook needs the selector
 * consulted every turn and a `sparse` dial needs it consulted rarely; one step
 * cannot declare both. And a condition cannot see channel state at all, so it
 * can know neither how long since the last firing nor that a hook is committed.
 * **So the step runs every turn and this gates the judgement** — which costs
 * nothing, because stage one is deliberately model-free.
 *
 * *Two things follow that are worth having anyway, and 06 §6.1 names them:
 * eligibility can be shown live on every turn, and `manual-only` is a coherent
 * state rather than a dead step.*
 *
 * **Counted on the path**, like every cadence here: `firedAt` is where on the
 * path the last firing sits, so a rewind past it correctly restores the
 * selector's freedom rather than leaving a cooldown that outlived the turn that
 * started it.
 */
export function gate(options: {
  pacing: HookPacing;
  /** Story turns on the path to the node being judged (`depth.ts`). */
  depth: number;
  /**
   * How many story turns came before the most recent firing, on the same
   * scale, or null for none.
   */
  firedAt: number | null;
  /** Whether stage one left anything to judge. */
  eligible: number;
  /**
   * Whether a person has committed one of the eligible hooks — [06 §6.1],
   * [P7.5].
   *
   * **This is what makes *immediately* an honest word under `sparse`.** A
   * commitment *"is exempt from cooldown and cadence, and it opens the pacing
   * gate every turn until it lands"*, which is the whole of its effect here —
   * and `manual-only` is no exception, because a dial that could veto a person's
   * own decision is not the dial [06 §6.1] describes.
   *
   * *It does not open the gate over an empty pool*: `nothing-eligible` still
   * wins, and it has to, because a committed hook is by construction an eligible
   * one — so a commitment with nothing eligible means the commitment is not in
   * this pool at all.
   */
  committed?: boolean;
}): GateVerdict {
  const { cadence, cooldown } = PACING[options.pacing];

  /**
   * **Nothing eligible is reported before the dial**, because it is the more
   * specific answer and the one an author acts on: *held* invites a person to
   * turn the dial up, and turning it up changes nothing when the pool is empty.
   */
  if (options.eligible === 0) return 'nothing-eligible';
  if (options.committed === true) return 'judged';
  if (options.firedAt !== null && options.depth - options.firedAt < cooldown) return 'cooling';
  if (!Number.isFinite(cadence) || options.depth % cadence !== 0) return 'held';
  return 'judged';
}

/**
 * One hook as the panel shows it — [10 §10.1], [06 §6.1], built at [P7.5].
 *
 * *"Which hooks have fired and when, which are eligible right now, and which are
 * blocked **with the clause that blocked them**."* That list is the panel's whole
 * specification, and every field here answers one clause of it.
 *
 * ***What is deliberately not here is the content.*** [08 §6] makes an unfired
 * hook's premise hidden content and [10 §10.1] says it twice — *"entrances are
 * shown by label, never by text… a panel that spoils the arrival to the person
 * about to read it defeats the feature"*. So `title` is what a row is named by:
 * [04 §6.1]'s own words for it are *"for the author's list. Never injected."*
 *
 * **`premise` appears only once the hook has gone**, and that is not a
 * relaxation of the rule — it is the rule running out. A fired hook's words have
 * already been read; withholding them then would hide from an author the one
 * thing they most need to see, which is what the hook actually did. *Entrance
 * text never appears at all, because the workbench's block list already shows a
 * fired hook's exact words with their source — [10 §10.1]'s "half of this is
 * already free".*
 */
export interface HookRow {
  hookId: string;
  title: string;
  /** Which object owns it, so editing can navigate there — [03 §4.1]. */
  source: PooledHook['source'];
  /** `null` is *in the pool*. */
  state: HookState | null;
  /** `null` when it is eligible right now. */
  refusal: HookRefusal | null;
  /** Present when a person's Commit is carrying it, with the clause it skipped. */
  committed?: { overrode: HookRefusal | null };
  /** Present when a person has force-fired it — the workbench's control, not the panel's. */
  forced?: { overrode: HookRefusal | null };
  /** The turn it fired on — [10 §10.1]'s *and when*. */
  firedOn?: string;
  /** Only once it has gone. See above. */
  premise?: string;
  /** **Labels, never text.** Empty for a hook that is an event rather than an arrival. */
  entrances: readonly { id: string; label: string }[];
}

/**
 * The hook panel's rows, at a node — the same shape `castRows` has and for the
 * same reason: *eligibility is live rather than computed on demand, because the
 * selector's mechanical filter already runs every turn* ([10 §10.1]).
 *
 * **The same `filterHooks` the selector calls**, not a second reading of the
 * rules. A panel that disagreed with the selector about why a hook is blocked
 * would be worse than no panel: the whole point of the surface is to answer
 * *which are blocked and by what*, and a second implementation is a second
 * answer waiting to drift.
 */
export function hookRows(pool: readonly PooledHook[], context: FilterContext): HookRow[] {
  const fired = firedOn(context.path);
  // Once, not once per hook: `filterHooks` is a fold over the whole pool, and a
  // panel with thirty hooks is the case [06 §6.1] sizes the filter for.
  const verdicts = filterHooks(pool, context);

  return pool.map((entry, at) => {
    const verdict = verdicts[at];
    const state = readHookState(context.channels, entry.hook.id);
    const spent = state === 'fired' || state === 'provisional';
    const when = fired.get(entry.hook.id);

    return {
      hookId: entry.hook.id,
      title: entry.hook.title,
      source: entry.source,
      state,
      refusal: verdict?.refusal ?? null,
      ...(verdict?.committed === undefined ? {} : { committed: verdict.committed }),
      ...(verdict?.forced === undefined ? {} : { forced: verdict.forced }),
      ...(when === undefined ? {} : { firedOn: when }),
      ...(spent ? { premise: entry.hook.premise } : {}),
      entrances: (entry.hook.introduces?.entrances ?? []).map((entrance) => ({
        id: entrance.id,
        label: entrance.label,
      })),
    };
  });
}

/**
 * ***A pool entry the engine cannot read, as a row that says so*** (2026-09-27).
 *
 * [10 §10.1] says *nothing about a held hook may be invisible*, and a hook the
 * schema refuses is held by the engine absolutely: it is never filtered, never
 * weighed and never carried by a commitment. The row names it by whatever it
 * does carry, its id and title if it has them, with `malformed` as the reason
 * and nothing that would need the parts it lacks. A person who wrote it can
 * find it and take it out.
 */
export function malformedRows(entries: readonly Record<string, unknown>[]): HookRow[] {
  return entries.map((entry) => {
    const hook =
      typeof entry['hook'] === 'object' && entry['hook'] !== null
        ? (entry['hook'] as Record<string, unknown>)
        : {};
    return {
      hookId: typeof hook['id'] === 'string' ? hook['id'] : '',
      title: typeof hook['title'] === 'string' ? hook['title'] : '',
      source: pooledSource(entry),
      state: null,
      refusal: 'malformed',
      entrances: [],
    };
  });
}

/**
 * Which turn each hook last fired on — [10 §10.1]'s *and when*.
 *
 * **Derived from the path rather than stored**, like every other *when* in this
 * feature: the answer has to change under a rewind, and a stored turn id would
 * point at a node this branch does not contain. *A provisional firing counts* —
 * the attempt is what happened, and an author looking at a hook that never
 * arrived needs the turn it was tried on.
 */
function firedOn(path: readonly Turn[]): Map<string, string> {
  const when = new Map<string, string>();
  for (const turn of path) {
    for (const effect of turn.effects) {
      if (!effect.applied || effect.channelId !== SE_HOOK) continue;
      // An unscoped write to a hook-scoped channel is a hand edit; it names no
      // hook, so there is nothing for a row to say about it.
      if (effect.scopeKey === null) continue;
      if (effect.after === 'fired' || effect.after === 'provisional') {
        when.set(effect.scopeKey, turn.id);
      } else {
        // A commitment or a lapse is not a firing, and it supersedes an earlier
        // one: a hook re-committed after it fired has not fired *on this path*
        // in any sense a panel should claim.
        when.delete(effect.scopeKey);
      }
    }
  }
  return when;
}

/**
 * ***The level's prose, from the pack*** — [06 §6.1], [P11.5].
 *
 * §6.1 in as many words: ***"Level → cadence, cooldown and patience is engine
 * code; the level's prose is the prompt pack's."*** Everything above this
 * function is the first half; this is the seam to the second. Until
 * [P11.5](../../../../docs/design/workplan/28-p11-implementation.md) there was
 * no second half at all — the dial changed *how often* the selector asked and
 * never *what it asked*, so `sparse` and `aggressive` put the identical question
 * to the model and differed only in a cadence the model could not see.
 *
 * ***Why this lives beside `readPacing` and not in `dials.ts`.*** That module
 * opens by saying what it is not: *"a third dial that is deliberately not
 * here… nothing here reads it, nothing here writes it, and `dials.test.ts`
 * asserts the three are three."* [23 §5.4] is the reason — folding *how often*
 * into *how hard* rebuilds the conflation [06 §7.3.2] exists to prevent. **What
 * crosses the line is one sort and nothing else**: {@link levelFragments} orders
 * a level's fragments by priority, which is a fact about `DifficultyLevel` the
 * shape rather than about either dial, and a second copy of it here would be a
 * second opinion about what *"lower is dropped first"* means.
 *
 * *One string rather than a list*, because the selector's call takes candidate
 * blocks and one block is what an author positioned: the ranking still decides
 * the order, and [19 §5.3]'s cap cuts from the end of the prompt rather than
 * from inside this. A pack that wants two blocks can write two levels' worth of
 * fragments and will get them in rank order.
 *
 * *`Pick<Preset, 'pacingLevels'>` rather than `Preset`*, because that is all
 * either function reads and a narrower parameter is a narrower claim: it also
 * means a test can hand these four levels rather than a whole pack, which is the
 * difference between testing the resolution and testing Scene.
 */
export function pacingProse(
  preset: Pick<Preset, 'pacingLevels'>,
  pacing: HookPacing,
): string | null {
  const level = pacingLevel(preset, pacing);
  if (level === null) return null;
  const text = levelFragments(level)
    .map((fragment) => fragment.text)
    .join('\n')
    .trim();
  return text === '' ? null : text;
}

/**
 * The level a pack ships for this setting, or null.
 *
 * ***No floor, where `resolveLevel` has one***, and the difference is the
 * difference between the two controls. A difficulty dial with no level selected
 * falls to the pack's gentlest entry because *some* difficulty is always in
 * play — the session is running at **a** difficulty whether or not anybody
 * chose. Pacing is not like that: `manual-only` is a real setting that means
 * *no judgement at all*, and a pack that ships prose for three levels and not
 * the fourth has said something about the fourth. Falling back to the gentlest
 * would put `sparse`'s words on an `aggressive` session, which is worse than
 * putting none.
 */
export function pacingLevel(
  preset: Pick<Preset, 'pacingLevels'>,
  pacing: HookPacing,
): DifficultyLevel | null {
  return preset.pacingLevels?.find((level) => level.id === pacing) ?? null;
}
