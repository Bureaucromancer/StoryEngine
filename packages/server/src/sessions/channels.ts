// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import type { ChannelDefinition } from '@storyengine/sdk';
import { uuidv7 } from '@storyengine/shared';

import { NO_TIMING } from '../retrieval/timing.js';
import { schemaFailure } from './channel-schema.js';
import type { ChannelEffect, ChannelState, Turn } from './types.js';

/**
 * `se.clock`, and the rule that a hand edit is an intent rather than corruption
 * — [P2 §2.7](../../../../docs/design/workplan/08-p2-implementation.md),
 * [03 §8.1](../../../../docs/design/03-data-model.md).
 *
 * **Why the clock and not the party.** [P2 §2.7] closed the skeleton's open
 * question here: in a fixed-participant P2 mode nothing ever writes a party
 * effect, so `se.party` would be a placeholder-shaped channel that exercises
 * nothing. The clock advances every turn, engine-computed, which puts real
 * traffic through effect application, replay-from-zero and the head snapshot.
 * `se.party` lands at P7 beside `ParticipantPolicy`, which is what gives it
 * semantics.
 */

/**
 * `ChannelDefinition` moved to `@storyengine/sdk` at [P7.0], and the move is
 * what dissolves the cycle the rest of this file keeps apologising for.
 *
 * The clock's definition sits here rather than in the mode because
 * `retrieval/timing.ts` needs the *type* and a mode importing the *value* while
 * this module imported the mode would be a `const` cycle — a TDZ
 * `ReferenceError` at load. With the type in a third package neither side
 * imports, that constraint is gone: a mode can declare its own channels and the
 * engine can read them. `CLOCK_CHANNEL` travels with Scene when Scene becomes a
 * package; the arguments below are kept because they are the record of why it
 * could not before.
 */
export type { ChannelDefinition } from '@storyengine/sdk';

/** The story clock's value. Normalised, so `hour` is 0–23 and `minute` 0–59. */
export interface ClockValue {
  day: number;
  hour: number;
  minute: number;
}

export const SE_CLOCK = 'se.clock';

/**
 * ~~The clock's definition~~ — **moved to `packages/modes/scene/src/mode.ts` at
 * [P7.0]**, because Scene is its `owner` and a mode that cannot own the channel
 * it declares is a mode whose declaration is decoration. The id stays here: the
 * engine advances the clock after the step loop and needs to name it, and an id
 * is content rather than code.
 */

export const SE_LORE_TIMING = 'se.lore.timing';

/**
 * Where a lore entry's `sticky`, `cooldown` and `ephemeral` counters live —
 * [P5 §1.1](../../../../docs/design/workplan/17-p5-implementation.md)'s *one
 * real design question in the phase*, answered.
 *
 * Those counters change as a result of turns, which is the definition of a
 * channel ([06 §4]) — so anywhere else and they do not reconstruct at a node,
 * and a branch inherits the wrong stickiness. The same argument that moved
 * party membership into channels, unchanged.
 *
 * ~~**Defined here rather than beside its logic, and the reason is the warning
 * `owner` already carries a few lines up.** `retrieval/timing.ts` holds the
 * transitions and needs `ChannelDefinition` from this module; if this module
 * imported the definition back, the two would be a `const` cycle and a TDZ
 * `ReferenceError` at load.~~
 *
 * *That reason expired at [P7.0], when `ChannelDefinition` moved to
 * `@storyengine/sdk`: the type now comes from a third package neither side
 * imports, so nothing has to be declared in the wrong place to avoid a loop.
 * This one stays here on its own merits — it is owned by `storyengine.lore`, a
 * **package** rather than a mode, so there is no mode for it to travel with.
 * `CLOCK_CHANNEL` is the one that leaves, and what holds it is `CHANNELS` being
 * a frozen record rather than anything about cycles.*
 *
 * **The first channel to use `scope: 'entry'` at all**, which is what made the
 * arm mean something: `applyEffects` keyed on the channel id alone until P5.5,
 * so two entries' timing would have overwritten each other. See `channelKey`.
 */
export const LORE_TIMING_CHANNEL: ChannelDefinition = {
  id: SE_LORE_TIMING,
  owner: 'storyengine.lore',
  version: 1,
  scope: 'entry',
  /**
   * Three counters, none of which can be negative — [P7.1].
   *
   * `timingOf` already refuses a non-object and falls back; what it cannot
   * refuse is an object with the right keys and impossible values, because
   * `sticky: -3` reads as a number like any other and quietly makes an entry
   * eligible forever. A schema is where that becomes a quarantine rather than a
   * silent behaviour change.
   */
  schema: {
    type: 'object',
    properties: {
      sticky: { type: 'integer', minimum: 0 },
      cooldown: { type: 'integer', minimum: 0 },
      fired: { type: 'integer', minimum: 0 },
    },
    required: ['sticky', 'cooldown', 'fired'],
  },
  /**
   * **An entry nothing has recorded anything about** — [P7.1], where a channel
   * declaring its own starting value became part of declaring the channel.
   *
   * **The import goes this way round, unlike the clock's.** `CLOCK_START`
   * *moved* into Scene's declaration and the engine reads it back through
   * {@link initialValue}; `NO_TIMING` stays in `retrieval/timing.ts` and this
   * declaration imports it, because it is also the **verdict vocabulary's
   * zero** — `activate.ts` compares against it per entry on a path that does no
   * channel lookup, and routing a hot retrieval loop through the registry would
   * make it depend on installation state. One constant, read two ways, rather
   * than two constants that agree today.
   */
  init: { kind: 'literal', value: NO_TIMING },
  // The model does not get a vote on whether an entry is still sticky. Like the
  // clock, a fact the engine computes and records — which is what makes it
  // reconstructible rather than negotiated.
  update: 'engine-computed',
  // Bookkeeping rather than story state. A player asking why an entry fired
  // gets a reason from the workbench (P5.8), not a counter.
  visibility: 'hidden',
  budget: null,
};

/**
 * Every channel this build knows — the thing `update` is enforced against.
 *
 * ~~A registry with one entry looks like ceremony, and is not… P2.6's modes
 * register their own ([06 §4]); this is the built-in set.~~
 *
 * **Modes register their own as of [P7.0], which is what that last sentence was
 * waiting for.** It was a frozen record built from static imports, and
 * Scene's `mode.ts` said the consequence plainly: listing `se.clock` in its
 * `channels` "documents what Scene uses and does not *enable* it", because
 * effect application resolved a channel from this module rather than from the
 * running mode. So the declaration was inert and the engine owned a channel a
 * mode was named the owner of.
 *
 * **The boundary is what forced the inversion rather than tidiness.** A mode
 * cannot import a value from the engine once it is a package, so either the
 * mode stops declaring its channel — losing the information — or it owns it and
 * something registers it. `registerMode` does, which gives
 * `ModeDefinition.channels` teeth for the first time.
 *
 * *What is left here is what has no mode to travel with*: `se.lore.timing` is
 * owned by `storyengine.lore`, a package, and is installed by `built-ins.ts`
 * beside the modes.
 */
const registered = new Map<string, ChannelDefinition>();

/**
 * Adds a channel to this build's registry.
 *
 * **Last registration wins**, for the reason `registerMode` gives: an install
 * with two declarations of one channel id has a configuration problem, and
 * refusing at startup would take the server down over it. A mode re-registering
 * its own declaration is idempotent, which is what lets a test install the
 * built-ins without caring whether something already did.
 */
export function registerChannel(definition: ChannelDefinition): void {
  registered.set(definition.id, definition);
}

/** Every channel registered so far, in registration order. */
export function registeredChannels(): readonly ChannelDefinition[] {
  return [...registered.values()];
}

export function channelDefinition(id: string): ChannelDefinition | null {
  return registered.get(id) ?? null;
}

/**
 * The separator between a channel's id and the thing it is scoped to.
 *
 * `#` because no channel id contains one — they are dotted reverse-domain names
 * ([06 §4.1](../../../../docs/design/06-modes-and-turn-pipeline.md)) — and no
 * scope key does either: an actor id and an entry id are both uuids or import
 * ids, and neither dialect uses it. Named rather than inlined so that the day
 * one does, there is a single line to argue with.
 */
const SCOPE_SEPARATOR = '#';

/**
 * Where a channel's value lives in the map — **the one place the composite key
 * is spelled.**
 *
 * `ChannelDefinition.scope` has said `'session' | 'actor' | 'entry'` since the
 * first channel was written, and `ChannelEffect.scopeKey` carries the docstring
 * *"Which value, when the channel is scoped per actor or per entry"* — but
 * `applyEffects` keyed on `channelId` alone, so two scoped values overwrote each
 * other and the vocabulary was a promise nothing kept.
 * [P5 §0.4](../../../../docs/design/workplan/17-p5-implementation.md) found it;
 * [P6 §1.9](../../../../docs/design/workplan/18-p6-implementation.md) asked
 * which phase pays; the phase order answers that it is this one, because P5.5
 * is the first stage that needs a per-entry value and shipping the lean without
 * this would be shipping a feature that silently clobbers itself.
 *
 * **The stored type does not change**, which is what keeps this out of P6's
 * "builds no storage" claim: `SessionFile.channels` is still
 * `Record<string, ChannelState>`. Only the *form* of a key widens, and only for
 * a channel that asked to be scoped — `se.clock` is `se.clock` exactly as
 * before, so every existing reader and every stored session are untouched.
 */
export function channelKey(channelId: string, scopeKey: string | null | undefined): string {
  return scopeKey === null || scopeKey === undefined
    ? channelId
    : `${channelId}${SCOPE_SEPARATOR}${scopeKey}`;
}

/**
 * The inverse of {@link channelKey}: a map key back into the pair that built it.
 *
 * **Distinct from {@link scopeKeyOf}, which answers a different question.** That
 * one takes a channel id you already know and asks *is this key one of yours*;
 * this one has only the key — the case anything iterating
 * `SessionFile.channels` is in, because a map's keys are all it has. Without it
 * the only way out of a composite key is string surgery at the call site, which
 * is what `retrieve.ts` already refuses to do for the other direction.
 *
 * **Splitting at the *first* separator is the whole of the contract**, and it is
 * the same assumption {@link channelKey} makes in reverse: a channel id is a
 * dotted reverse-domain name and a scope key is a uuid or an import id, so
 * neither carries a `#`. If one ever does, {@link SCOPE_SEPARATOR}'s docstring
 * is the single line to argue with and this is the second.
 *
 * An unscoped key round-trips to `scopeKey: null` rather than to an empty
 * string, because *absent* and *empty* are different claims here exactly as they
 * are on the wire ([03 §8](../../../../docs/design/03-data-model.md)).
 */
export function splitChannelKey(key: string): { channelId: string; scopeKey: string | null } {
  const at = key.indexOf(SCOPE_SEPARATOR);
  return at === -1
    ? { channelId: key, scopeKey: null }
    : { channelId: key.slice(0, at), scopeKey: key.slice(at + SCOPE_SEPARATOR.length) };
}

/**
 * Whether a key in the map belongs to this channel — its own value, or any of
 * its scoped ones.
 *
 * A step that declares `reads: ['se.lore.timing']` wants **every** entry's
 * timing, not the one value that happens to sit under the bare id; without this
 * an entry-scoped channel would read as empty at every step that asked for it.
 */
export function keyBelongsTo(key: string, channelId: string): boolean {
  return key === channelId || key.startsWith(`${channelId}${SCOPE_SEPARATOR}`);
}

/** The scope key a map key carries, or null when it carries none. */
export function scopeKeyOf(key: string, channelId: string): string | null {
  return key.startsWith(`${channelId}${SCOPE_SEPARATOR}`)
    ? key.slice(channelId.length + SCOPE_SEPARATOR.length)
    : null;
}

/**
 * ~~Where a session's clock starts. Morning, because a story usually does.~~
 *
 * **Moved into Scene's declaration at [P7.1]** as
 * `CLOCK_CHANNEL.init`, and read back through {@link initialValue}. What is
 * here is the same value arrived at the other way round: the engine asks the
 * registry where the clock starts instead of knowing.
 *
 * *Kept as an export because it is the shape of a `ClockValue` as well as a
 * value, and four test files read it as the former.* It is **derived from the
 * declaration** rather than declared here, so the two cannot drift: change
 * Scene's `init` and this follows.
 */
export function clockStart(): ClockValue {
  const value = initialValue(SE_CLOCK);
  return isClock(value) ? value : FALLBACK_CLOCK;
}

/**
 * What the clock reads when no mode has declared one.
 *
 * **Not a second opinion about when a story starts** — it is what a build with
 * no clock channel registered has to say, and the honest options were this or a
 * throw. A throw would mean a session that cannot open because a mode was
 * uninstalled, which is precisely what [00 §3.3] and [06 §4.2] refuse.
 */
const FALLBACK_CLOCK: ClockValue = { day: 1, hour: 8, minute: 0 };

/**
 * The value a channel starts at, from whoever declared it — [P7.1].
 *
 * **A read-time default rather than a stored one, which is what keeps replay
 * honest.** Nothing writes an initial value into `session.channels`: a channel
 * with no effects against it has no entry, and this is what the readers fall
 * back to. So replay-from-zero and the head snapshot agree about an untouched
 * channel *by having nothing to disagree about*, which is the cheapest possible
 * way to satisfy the assertion [07 §4] makes a CI step of.
 *
 * **The `authored` arm is not resolved here**, and deliberately: it needs the
 * session's treatment and setup, which this module has no business reading.
 * `null` until [P7.1]'s dial wires it, with the fallback as the answer — the
 * arm's own `fallback` is what an unauthored session gets, and an unresolved
 * one is unauthored as far as anything can tell from here.
 */
export function initialValue(channelId: string): unknown {
  const init = channelDefinition(channelId)?.init;
  if (init === undefined) return null;
  return init.kind === 'literal' ? init.value : init.fallback;
}

/**
 * How far the clock moves per turn.
 *
 * A placeholder with a name rather than a literal in the middle of a function:
 * the mode is what should decide this ([06 §4](../../../../docs/design/06-modes-and-turn-pipeline.md)),
 * and there is no mode configuration to read it from until P2.6. Named so the
 * day it becomes configurable is a change of source rather than a search.
 */
export const MINUTES_PER_TURN = 5;

export function readClock(channels: Record<string, ChannelState>): ClockValue {
  const state = channels[SE_CLOCK];
  return isClock(state?.value) ? state.value : clockStart();
}

function isClock(value: unknown): value is ClockValue {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Partial<ClockValue>;
  return (
    typeof candidate.day === 'number' &&
    typeof candidate.hour === 'number' &&
    typeof candidate.minute === 'number'
  );
}

/** Adds minutes, carrying into hours and days. */
export function advance(clock: ClockValue, minutes: number): ClockValue {
  const total = clock.hour * 60 + clock.minute + minutes;
  const dayShift = Math.floor(total / (24 * 60));
  const inDay = ((total % (24 * 60)) + 24 * 60) % (24 * 60);
  return {
    day: clock.day + dayShift,
    hour: Math.floor(inDay / 60),
    minute: inDay % 60,
  };
}

/**
 * ~~The clock effect a turn carries.~~ **Deleted at [P7.0].**
 *
 * It was exported production code with **no production caller** — the runner
 * builds its clock effect inline through `acceptEffect`, "after the loop and not
 * as a step" — while four test files shadowed the name with local helpers of
 * their own. `CLOCK_CHANNEL` leaving for the mode forced the disposition: a dead
 * export that survives a directory move is a dead export that starts reading as
 * the contract.
 */

/**
 * The effects that reconcile a hand-edited `session.json` with the effect log —
 * [03 §8.1](../../../../docs/design/03-data-model.md).
 *
 * **A user who edits `channels` in the file has expressed an intent, not
 * corrupted a cache.** The snapshot is derived, so the naive responses are both
 * wrong: overwriting the edit throws away what somebody meant, and trusting it
 * makes the snapshot authoritative — which turns it into a mutable state blob
 * that switching branches has to rewrite, the exact failure [07 §5.1] rules out
 * for rolling summaries.
 *
 * So the divergence becomes **user-authored effects**, and the effect log stays
 * the single source of truth. It is also self-healing in the case nobody
 * intended: if the divergence came from a bug rather than a person, it lands as
 * a visible effect someone can inspect instead of silently persisting.
 *
 * `before` is the replayed value, because that is what the log says was true —
 * which is what makes the effect reversible into a state the log agrees with.
 */
export function divergenceEffects(
  turnId: string,
  replayed: Record<string, ChannelState>,
  onDisk: Record<string, ChannelState>,
): ChannelEffect[] {
  const effects: ChannelEffect[] = [];
  /**
   * **These are map keys, not channel ids**, and for a scoped channel the two
   * are different strings — `se.lore.timing#<entryId>` against `se.lore.timing`.
   * Iterating them as ids is what produced an effect whose `channelId` resolved
   * through {@link channelDefinition} to nothing and whose `scopeKey` was null
   * however deeply scoped the value was. It round-tripped, because
   * `applyEffects` rebuilds the key with {@link channelKey} and
   * `channelKey('se.lore.timing#e-1', null)` is the same string — so the map
   * came out right and the *record* was malformed, which is the failure this
   * mechanism exists to make visible rather than the one it exists to survive.
   */
  const keys = new Set([...Object.keys(replayed), ...Object.keys(onDisk)]);

  for (const key of [...keys].sort()) {
    const was = replayed[key];
    const now = onDisk[key];
    const { channelId, scopeKey } = splitChannelKey(key);

    if (now === undefined) {
      // Removed from the file. A deletion is as much an intent as an edit, and
      // it is the one divergence that a re-derive-and-overwrite would treat as
      // "nothing changed".
      effects.push(
        effect(
          turnId,
          channelId,
          scopeKey,
          { type: 'delete', path: '/' },
          was?.value ?? null,
          null,
          was,
        ),
      );
      continue;
    }

    if (was !== undefined && same(was.value, now.value)) continue;

    effects.push(
      effect(
        turnId,
        channelId,
        scopeKey,
        { type: 'set', path: '/' },
        was?.value ?? null,
        now.value,
        now,
      ),
    );
  }

  return effects;
}

function effect(
  turnId: string,
  channelId: string,
  scopeKey: string | null,
  op: ChannelEffect['op'],
  before: unknown,
  after: unknown,
  state: ChannelState | undefined,
): ChannelEffect {
  const definition = channelDefinition(channelId);
  /**
   * **The schema, checked here because this path never meets `acceptEffect`** —
   * [P7.1].
   *
   * `reconcileHandEdits` builds its effects straight from this function and
   * appends them; `turns/effects.ts`'s `refuse` is only ever reached by a step,
   * a model or the engine. So a value typed into `session.json` used to become
   * an **applied** effect whatever shape it was, and an impossible clock entered
   * the permanent record and replayed onto every branch from that node. The
   * schema check in `refuse` did nothing about it, and a docstring there briefly
   * claimed otherwise.
   *
   * **Refused rather than applied-then-quarantined**, which is the choice worth
   * stating. Both are available: a quarantine would write the bad value and then
   * write a reset, two effects for one mistake, with the raw value in the middle
   * of the log. A refusal records the attempt, keeps the state where the log
   * says it is, and says why — and the difference in kind is real, because this
   * is a value *arriving*, not a value *already there under a schema that
   * changed*. The second case is the quarantine's, below.
   *
   * *Only the schema is consulted, and the `update` policy deliberately is not.*
   * `engine-computed` refuses `model` and `step`; `user-only` refuses everything
   * but `user`. A person editing their own file is permitted by both, which is
   * [03 §8.1]'s whole premise — so there is nothing here for policy to say.
   */
  const failure = op.type === 'delete' ? null : schemaFailure(definition, after);

  return {
    id: uuidv7(),
    turnId,
    channelId,
    scopeKey,
    op,
    before,
    // A refused effect leaves the state where it was, which for this path means
    // the value the log already says is true.
    after: failure === null ? after : before,
    // The whole point of the mechanism: attributed to the person who opened the
    // file, not to the engine that noticed.
    proposedBy: { kind: 'user' },
    applied: failure === null,
    rejectedReason: failure === null ? null : 'schema',
    supersedes: null,
    channelVersion: definition?.version ?? state?.version ?? 1,
    scope: 'session',
  };
}

/**
 * Structural comparison over JSON values.
 *
 * `JSON.stringify` rather than a deep-equal helper, and it is not laziness: a
 * channel value has *already* been through a file, so it is JSON by
 * construction — no undefined, no functions, no cycles. Key order is the one
 * hazard, and it is stable here because both sides are parsed from JSON text
 * written by this code or read from one.
 */
function same(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * The effects that quarantine a channel whose stored value no longer fits its
 * schema — [06 §4.2](../../../../docs/design/06-modes-and-turn-pipeline.md),
 * [25 B7](../../../../docs/design/25-open-questions.md), built at [P7.1].
 *
 * **The sibling of {@link divergenceEffects}, and the difference between them is
 * the whole design.** A divergence is a value *arriving* — somebody edited the
 * file — and one that does not fit is refused, because the state the log
 * describes is still good. A quarantine is a value **already there** under a
 * schema that has since changed: nobody is proposing anything, the value was
 * legal when it was written, and the mode moved underneath it. Refusing that
 * would be refusing the past.
 *
 * **So it is a write, and that is the conclusion 06 §4.2 stops one step short
 * of.** *"Initialise the channel to its default"* cannot be a way of looking at
 * state: the runner chains each effect's `before` from the channel map, so a
 * reset that existed only at read time would become the next effect's `before`
 * while the log still recorded the old value as an `after` — and
 * replay-from-zero would stop equalling snapshot-plus-replay, which is
 * [07 §4](../../../../docs/design/07-branching.md)'s CI assertion. Recorded,
 * attributed to the engine, reversible like anything else.
 *
 * **Three rungs of four, and the missing one is `migrate`.** 06 §4.2 puts a
 * migration between coercion and quarantine, *"if the definition ships a
 * `migrate(fromVersion, state)`"* — and none can, because the field is
 * deliberately absent from `ChannelDefinition` ([21 §1.3] makes it optional,
 * 06 §4.2 wants it only for *"the genuine minority"*). Its absence is not
 * silent: a value that would have been migrated is quarantined instead, with its
 * raw value kept, which is the outcome that rung improves on rather than
 * prevents — and the raw value is exactly what a later migration would run
 * against.
 *
 * ***Coercion is not here either, and that is a narrowing rather than an
 * omission.*** That rung is *"drop unknown fields, fill declared defaults,
 * re-validate"* — Ajv's `removeAdditional` and `useDefaults`, which
 * `AJV_OPTIONS` switches off and explains at length for portable objects. It
 * earns its place against a channel whose schema has *removed* a field, and
 * neither shipped channel has ever changed shape, so a coercer built now would
 * be built against no case at all. Until then a droppable field is quarantined,
 * which is visible and recoverable rather than wrong.
 */
export function quarantineEffects(
  turnId: string,
  channels: Record<string, ChannelState>,
): ChannelEffect[] {
  const effects: ChannelEffect[] = [];

  for (const key of Object.keys(channels).sort()) {
    const state = channels[key];
    if (state === undefined) continue;

    const { channelId, scopeKey } = splitChannelKey(key);
    const definition = channelDefinition(channelId);
    const failure = schemaFailure(definition, state.value);
    if (failure === null) continue;

    const reset = initialValue(channelId);
    /**
     * **A default that does not fit its own schema is an author's mistake**, and
     * quarantining to it would write an effect on every load forever. Left alone
     * and visible instead, on the same reasoning `channel-schema.ts` gives for a
     * schema that will not compile: the person playing cannot fix it and should
     * not pay for it with a log that grows every time they open the session.
     */
    if (schemaFailure(definition, reset) !== null) continue;

    effects.push({
      id: uuidv7(),
      turnId,
      channelId,
      scopeKey,
      op: { type: 'set', path: '/' },
      before: state.value,
      after: reset,
      // The engine noticed; nobody proposed. 06 §4.2's calibration is what makes
      // this safe to do without asking — channel state is tracked numbers and
      // flags, not the story, and the worst honest outcome is a reset inventory.
      proposedBy: { kind: 'engine' },
      applied: true,
      rejectedReason: null,
      supersedes: null,
      channelVersion: definition?.version ?? state.version,
      scope: 'session',
      degraded: { reason: failure.issues.join('; ') },
    });
  }

  return effects;
}

/**
 * The turn that carries a hand edit into the log.
 *
 * **A turn, rather than effects appended to the head turn.** [03 §8.1] says the
 * effect is "appended at the head", and a segment is append-only — rewriting the
 * head turn's line to add effects to it is precisely what the format forbids.
 * So the edit becomes its own turn: no model calls, no tape, `complete`, and its
 * effects attributed to the user. That is also the reading that keeps the
 * promise the section actually makes — *visible in the turn record* — because a
 * turn is the thing the workbench shows.
 */
export function divergenceTurn(
  sessionId: string,
  headTurnId: string | null,
  effects: ChannelEffect[],
  createdAt: string = new Date().toISOString(),
): Turn {
  const id = uuidv7();
  return {
    id,
    sessionId,
    parentTurnId: headTurnId,
    createdAt,
    status: 'complete',
    effects: effects.map((each) => ({ ...each, turnId: id })),
    tape: [],
  };
}
