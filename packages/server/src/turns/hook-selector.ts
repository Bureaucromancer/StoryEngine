// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import type { Candidate, StepDefinition, StepImplementation, StepInput } from '@storyengine/sdk';
import type { HookPacing, HookSelection, PlotHook, Turn } from '@storyengine/shared';

import {
  filterHooks,
  gate,
  HOOK_PATIENCE,
  SE_HOOK,
  SE_HOOK_PACING,
  type FilterContext,
  type HookState,
  type HookVerdict,
} from '../sessions/hooks.js';
import { channelKey } from '../sessions/channels.js';
import { storyDepth } from '../sessions/depth.js';
import type { PooledHook } from '../sessions/types.js';

/**
 * [06 §6.1](../../../../docs/design/06-modes-and-turn-pipeline.md)'s **stage
 * two** — one cheap call over the survivors of stage one, built at
 * [P7.5](../../../../docs/design/workplan/23-p7-implementation.md).
 *
 * *"Is now a good moment, and which of these fits what just happened? Weighted,
 * and permitted to answer 'none'."* Stage one is `sessions/hooks.ts`; the dial
 * and the gate that decides whether this runs at all are there too.
 *
 * **A step, and an engine-owned one — the first in the build.** Every other step
 * is a mode's, zipped from `mode.run` by `planFor`. This one cannot be: it reads
 * the session's hook pool, and a pool is assembled from a treatment, its
 * lorebooks and the session's own hooks ([03 §4.1]), none of which is a mode.
 * The same argument that registers `se.hook` and `se.hook.pacing` in
 * `mode-loader` rather than in Scene's declaration — `storyengine.hooks` is a
 * **package** — applies one level up to the step that reads them.
 *
 * *It is a step rather than a phase of the runner because being one is what buys
 * the record.* A `StepOutcome` says it ran, `step.started` / `step.finished`
 * reach a watching client, a failure is classified and `failure: 'warn'` keeps a
 * broken pool from costing somebody their turn, and the call it makes lands in
 * `request.calls` with its own blocks and budget verdict like every other. A
 * phase run beside the loop would have had to reimplement all five.
 */

/**
 * The step id, which is also what a session's `stepRoles` override names.
 *
 * `se.hooks.select` rather than `se.hook.select`: the channel is about **one**
 * hook and is scoped by its id, and this reads the pool.
 */
export const SE_HOOKS_SELECT = 'se.hooks.select';

export const HOOK_SELECTOR_STEP: StepDefinition = {
  id: SE_HOOKS_SELECT,
  /**
   * **`pre`, which is what puts the fired hook's words where the preset asked
   * for them.** The text goes back to the runner and into the guidance slot
   * ([06 §5.1]) rather than out as a candidate of this step's own: step
   * candidates are appended *after* the preset's, so a hook returned as a
   * candidate would arrive at the end of the prompt instead of where the author
   * positioned guidance. That is [26 C13(c)], and running first is what lets the
   * runner fill the slot properly instead.
   */
  stage: 'pre',
  /**
   * The dial and every hook's state. **Scoped channels are named unscoped
   * here** — `reads` is a list of channel *ids* and the payload filter passes
   * every key under one, which is how `se.presence` reaches a step that asked
   * for presence without naming an actor.
   */
  reads: [SE_HOOK, SE_HOOK_PACING, 'history', 'output'],
  writes: [SE_HOOK],
  // No `contributes`, and its absence is the design rather than an omission.
  // What this produces is guidance, and guidance is the one thing a step may not
  // hand back ([06 §5.2], and `StepInput`'s own docstring): the assembler's
  // refusal keys on `Candidate.advisory` and not on where the words came from,
  // so a step able to emit advisory text could walk it into an effects call. The
  // runner takes the words and fills the slot, exactly as it does for `attempt`.
  callKind: 'hook-select',
  when: { when: 'cadence', everyNTurns: 1 },
  /**
   * **`warn`, never `abort`.** [00 §3.3]: a broken piece of authored content
   * must not cost somebody their turn. A pool that cannot be judged is a turn
   * with no hook in it, which is what most turns are anyway.
   */
  failure: 'warn',
  /**
   * ***`prose`, and `fast` was the obvious wrong answer*** — [P7.5], measured.
   *
   * [06 §6.1] says *cheap*, and `fast` is the role that word names. But
   * **`resolveRole` has no cross-role fallback**: its four layers are all
   * bindings *for the role asked for*, so a role nobody bound resolves `unbound`
   * and the step fails. Nothing in the build binds anything but `prose` — no
   * install default, no wizard, no route that would suggest it — so declaring
   * `fast` here meant that on a stock install **every turn of every session with
   * a hook pool logged a failed step and no hook ever fired**. That is the
   * silent-default failure [00 §3.3] refuses, arrived at by asking for the right
   * thing.
   *
   * *The cheapness §6.1 asks for is a property of the **call**, and stage one is
   * what delivers it*: a handful of premises and a question with a closed
   * answer, rather than the scene. An install that wants a smaller model for it
   * says so through the session's `stepRoles` — [20 §5.1]'s fourth layer, and
   * exactly the case `docs/api.md` describes as *"a cheap model for one noisy
   * step is an operator's decision about their own providers"*.
   *
   * **The finding is bigger than this step and is recorded at [P7.5]**: seven of
   * `MODEL_ROLES`' eight arms are unreachable in the same way, so the roles
   * vocabulary is aspirational until either bindings ship defaults for more of
   * them or `resolveRole` gains a fallback. This step is not the place to fix
   * that, and would be the wrong place to hide it.
   */
  role: 'prose',
};

/**
 * What the selector hands the runner — and it is **everything** the selector
 * produces, because `StepResult` can carry none of it.
 *
 * Three things, each refused by the step contract for its own reason: the record
 * line, because a turn field is the engine's to write and widening `StepResult`
 * with one would let any mode write it; the guidance text ([06 §5.2] — a step
 * may not hand back advisory words); and the firing, below. So the step returns
 * an empty result and the runner reads this cell after the loop.
 *
 * *The callback is engine code handed to engine code: it is not reachable from a
 * mode, and `planFor` still cannot produce one. That is what makes this a
 * narrower door than a `StepResult` field rather than the same door with a
 * different handle.*
 */
export interface HookSelectorReport {
  selection: HookSelection;
  /** The words the guidance slot should carry, when a hook fired. */
  guidance?: string;
  /**
   * The firing, for the **runner** to apply — not an `EffectProposal` this step
   * hands back, and that is a third thing the cell carries for a third reason.
   *
   * `se.hook` is `engine-computed`, which refuses a `model` and a `step`
   * proposal alike, and the reason it is declared that way is the one that
   * applies here: *a firing is the selector's decision, and a model proposing one
   * would be a hook firing itself*. A step allowed to write it would reopen that
   * to every step of every mode. So the engine computes it, exactly as the clock
   * is *"after the loop and **not** as a step"* — that comment's *"route an
   * engine computation through the step path, where it would be proposed rather
   * than computed"* is this, one channel over.
   *
   * *Measured rather than reasoned to: the step proposed it first, and
   * `acceptEffect` recorded `applied: false`, `rejectedReason: 'engine-computed'`
   * — the refusal working exactly as designed on the first thing that tried it.*
   */
  fired?: { hookId: string; state: HookState };
  /**
   * Commitments that ran out of patience, for the runner to clear — [06 §6.1],
   * [P7.5]. Same route as {@link fired} and for the same reason: `se.hook` is
   * `engine-computed`, so a step cannot write it.
   *
   * *Cleared to null rather than deleted*, which on this channel is the same
   * claim: `se.hook` declares `init: { kind: 'literal', value: null }`, so **null
   * is what *in the pool* resolves to**. `store.ts`'s `inverseOf` draws the two
   * apart for a timing counter whose init is an object; here there is nothing to
   * draw apart — and `acceptEffect` admits only a whole-value set, deliberately.
   */
  lapses?: readonly string[];
}

export interface HookSelectorContext {
  pool: readonly PooledHook[];
  /** Everything stage one needs, resolved by the caller. */
  filter: Omit<FilterContext, 'channels' | 'path'>;
  pacing: HookPacing;
  /**
   * ***What this setting should mean to the model, in the pack's words*** —
   * [06 §6.1], [P11.5]. Null when the pack ships no prose for it, which is what
   * every pack did before that stage.
   *
   * **Resolved by the caller rather than read here**, which is this file's
   * standing arrangement for everything it needs out of a session: `pool`,
   * `filter` and `pacing` all arrive resolved, because the selector is a step
   * and a step does not go shopping. It also keeps the pack-reading in one
   * place — the runner already holds the preset, and a second reader would be a
   * second opinion about which level is in play.
   */
  pacingProse: string | null;
  report: (report: HookSelectorReport) => void;
}

/**
 * Builds the engine's own `{ definition, run }` pair for a turn.
 *
 * A function rather than a constant because the pool and the dial are facts
 * about **this session at this node**, and the plan is rebuilt every turn
 * anyway. It closes over them the way the runner's `call` closes over the
 * turn's assembly inputs.
 */
export function hookSelector(context: HookSelectorContext): {
  definition: StepDefinition;
  run: StepImplementation;
} {
  return {
    definition: HOOK_SELECTOR_STEP,
    run: async (input, host) => {
      const path = input.history ?? [];
      const at = (channels: StepInput['channels']): FilterContext => ({
        ...context.filter,
        channels,
        path,
      });

      /**
       * **The filter runs before the lapses and again after them, when there are
       * any.** A commitment that has run out of patience is *back in the pool* on
       * this very turn, which means the filter has something to say about it that
       * the commitment was suppressing — and the honest way to get that answer is
       * to ask the filter against the state the lapse leaves behind, rather than
       * to reconstruct it.
       *
       * *The second pass costs nothing on the overwhelming majority of turns,
       * because `lapses` is empty on all of them.*
       */
      const lapses = lapsed(filterHooks(context.pool, at(input.channels)), path);
      const verdicts =
        lapses.length === 0
          ? filterHooks(context.pool, at(input.channels))
          : filterHooks(context.pool, at(without(input.channels, lapses)));

      const considered = verdicts.map((verdict) => ({
        hookId: verdict.hook.id,
        refusal: verdict.refusal,
        ...(verdict.committed === undefined ? {} : { committed: verdict.committed }),
        ...(verdict.forced === undefined ? {} : { forced: verdict.forced }),
      }));
      const eligible = verdicts.filter((verdict) => verdict.refusal === null);
      const committed = eligible.filter((verdict) => verdict.committed !== undefined);
      // Never written empty: *absent* is the ordinary turn.
      const lapse = lapses.length === 0 ? {} : { lapses };
      const said = lapses.length === 0 ? {} : { lapsed: lapses };

      /**
       * ***Force-fire: no gate and no call*** — [06 §6.1], [P7.5]. *"The hook is
       * delivered on the next turn with no judgement call at all."*
       *
       * **Before the gate rather than through it**, which is what makes the
       * record honest: a `fired` verdict reached this way carries `forced` on the
       * hook it names, and a reader can see that nobody was asked. Routing it
       * through the gate as a stronger `committed` would have produced the same
       * verdict with a call that did not happen implied behind it.
       *
       * *This is the whole of the difference between the two hand controls.*
       * Commit opens the gate and still asks **where**; force answers **now**.
       * [06 §6.1] keeps them in different surfaces for that reason — *"splitting
       * them keeps a control that skips the engine's judgement out of the surface
       * people play on"*.
       */
      const forced = eligible.find((verdict) => verdict.forced !== undefined);
      if (forced !== undefined) {
        const entrance = await pickEntrance(forced.hook, host);
        context.report({
          selection: {
            verdict: 'fired',
            pacing: context.pacing,
            hookId: forced.hook.id,
            considered,
            ...said,
          },
          guidance: guidanceFor(forced.hook, entrance),
          fired: { hookId: forced.hook.id, state: stateFor(forced.hook) },
          ...lapse,
        });
        return {};
      }

      /**
       * ***Counted in story turns*** (`depth.ts`, 2026-09-27). The path's length
       * counted the dial change that asked for more hooks as a turn of the
       * story, so turning the dial up moved the cadence it was turning up, and
       * every HUD edit or backdrop choice after a firing spent a turn of its
       * cooldown. The firing is found where it sits and measured by the story
       * turns before it, which is the scale `depth` is on.
       */
      const firedIndex = lastFiredAt(path);
      const decision = gate({
        pacing: context.pacing,
        depth: storyDepth(path),
        firedAt: firedIndex === null ? null : storyDepth(path.slice(0, firedIndex)),
        eligible: eligible.length,
        committed: committed.length > 0,
      });

      if (decision !== 'judged') {
        context.report({
          selection: { verdict: decision, pacing: context.pacing, considered, ...said },
          ...lapse,
        });
        return {};
      }

      /**
       * **A commitment changes the question from *whether* to *where***, which
       * [06 §6.1] calls *"the difference between committing a hook and forcing
       * one"*. So the candidates narrow to the committed ones and the call still
       * runs — a person has said *this*, and the selector is still choosing
       * *now*.
       */
      const offered = (committed.length > 0 ? committed : eligible).map((v) => v.hook);
      const chosen = await judge(
        offered,
        input.output?.text ?? lastOutput(path),
        committed.length > 0,
        context.pacingProse,
        host,
      );
      if (chosen === null) {
        context.report({
          selection: { verdict: 'judged-none', pacing: context.pacing, considered, ...said },
          ...lapse,
        });
        return {};
      }

      const entrance = await pickEntrance(chosen, host);
      context.report({
        selection: {
          verdict: 'fired',
          pacing: context.pacing,
          hookId: chosen.id,
          considered,
          ...said,
        },
        guidance: guidanceFor(chosen, entrance),
        fired: { hookId: chosen.id, state: stateFor(chosen) },
        ...lapse,
      });
      return {};
    },
  };
}

/**
 * Which commitments have run out of patience — [06 §6.1], [P7.5].
 *
 * **Three turns, and the deadline is a lapse rather than a firing.** *"A
 * commitment that waits forever is indistinguishable from no commitment, and one
 * that fires anyway at the deadline delivers the twist at the exact moment the
 * selector has already rejected three times — the worst available moment."* So
 * the hook goes back in the pool and the turn record says so.
 *
 * ***Counted on the path, which is the clause that decides the implementation.***
 * *"Commit at ten, fire at twelve, rewind to eleven, and the commitment
 * correctly survives with one turn already spent — which only holds if the count
 * is derived from the path rather than stored."* So this walks the path for the
 * effect that wrote the commitment instead of reading a counter, exactly as
 * `lastFiredAt` does one function down, and for the same reason.
 *
 * *A commitment with no effect on this path is one made on another branch*, and
 * it is **not** lapsed: the channel value reconstructs at this node, so it is
 * live here, and the honest reading is that its clock has not started. Anything
 * else would expire a commitment a rewind had just restored.
 */
function lapsed(verdicts: readonly HookVerdict[], path: readonly Turn[]): string[] {
  return verdicts
    .filter((verdict) => verdict.committed !== undefined)
    .filter((verdict) => {
      const made = committedAt(path, verdict.hook.id);
      if (made === null) return false;
      /**
       * **`chances`, written out, because the off-by-one here is the whole
       * decision and a bare comparison hides it.**
       *
       * The commitment lands as an effect on the turn at `made`, and that turn
       * is not one of them: `PUT /channels/:key` appends a turn carrying the
       * effect and nothing else — no model call, no selector. So the first turn
       * the selector can be asked on comes after `made`, and by the turn now
       * being judged it has been asked once for every story turn since, **and
       * once for this one**.
       *
       * ~~`path.length - made`~~ (2026-09-27): that counted every turn after the
       * commitment, and a HUD edit, a second commitment or a backdrop choice is
       * a turn nobody asked the selector on. Two of them spent two of the three
       * chances, so a commitment could lapse having been weighed once.
       *
       * Patience is three of those. The lapse is therefore what happens when a
       * fourth would be due — which is [06 §6.1]'s *"the selector has already
       * rejected three times"*, and is why the deadline is a lapse rather than a
       * firing: at that point the worst available moment is the one left.
       */
      const chances = storyDepth(path.slice(made + 1)) + 1;
      return chances > HOOK_PATIENCE;
    })
    .map((verdict) => verdict.hook.id);
}

/** Where on the path a hook's commitment was made, or null if not on it. */
function committedAt(path: readonly Turn[], hookId: string): number | null {
  let at: number | null = null;
  path.forEach((turn, index) => {
    for (const effect of turn.effects) {
      if (!effect.applied || effect.channelId !== SE_HOOK || effect.scopeKey !== hookId) continue;
      // The *most recent* write wins, whatever it was: a commitment re-made
      // after a lapse restarts its patience, which is the only reading under
      // which committing something twice means anything.
      at = effect.after === 'committed' ? index : null;
    }
  });
  return at;
}

/**
 * The channel map as the lapse leaves it — the lapsed keys gone, not nulled.
 *
 * Rebuilt rather than deleted from, because the input is the step's own payload
 * and a reader that mutated it would be writing into the runner's `running` map
 * from inside a step.
 */
function without(
  channels: StepInput['channels'],
  hookIds: readonly string[],
): StepInput['channels'] {
  const gone = new Set(hookIds.map((id) => channelKey(SE_HOOK, id)));
  return Object.fromEntries(Object.entries(channels).filter(([key]) => !gone.has(key)));
}

/**
 * Where on the path the most recent firing sits, as an index, or null.
 *
 * *An index and not a depth*: the gate measures in story turns, and converts
 * this at its one call site rather than here, so the question *which turn* and
 * the question *how far into the story* stay two questions.
 *
 * **Derived rather than stored**, which is what makes the cooldown branch: a
 * rewind past the firing walks a path that does not contain it, and the
 * selector is free again — the property [06 §6.1] states for Commit's patience
 * and which every count in this feature shares. A stored *lastFiredAt* would
 * have outlived the turn that set it.
 *
 * *A provisional firing counts.* It is an attempt the narrator was asked to
 * make, and starting the next cooldown from the attempt rather than from its
 * confirmation is what stops a declined introduction being retried on the very
 * next turn.
 */
export function lastFiredAt(path: readonly Turn[]): number | null {
  let at: number | null = null;
  path.forEach((turn, index) => {
    for (const effect of turn.effects) {
      if (!effect.applied || effect.channelId !== SE_HOOK) continue;
      if (effect.after === 'fired' || effect.after === 'provisional') at = index;
    }
  });
  return at;
}

/**
 * The call — *"is now a good moment, and which of these fits what just
 * happened?"*
 *
 * **Its own candidates rather than the turn's**, which is what makes it cheap:
 * `StepCallRequest.candidates` omitted means everything accumulated so far, and
 * the accumulated prompt is the whole scene. What this needs is the premises and
 * one paragraph of what just happened.
 *
 * **A closed answer, enforced twice.** The schema's `enum` is the eligible ids
 * plus `null`, so a structured endpoint cannot name a hook stage one refused;
 * and the reader below checks membership anyway, because [P7.4] measured that
 * `jsonSchema()` does not validate and the degraded path is a prompt rather than
 * a contract. *A model naming an ineligible hook is the failure [06 §6.1] warns
 * about from the other direction — "a model asked to consider ineligible hooks
 * will argue for them" — and this is the same refusal one step later.*
 */
async function judge(
  eligible: readonly PlotHook[],
  recent: string,
  committed: boolean,
  pacingProse: string | null,
  host: Parameters<StepImplementation>[1],
): Promise<PlotHook | null> {
  const ids = eligible.map((hook) => hook.id);
  const result = await host.call({
    candidates: [
      block('se.hooks.select.task', 'system', committed ? COMMITTED_TASK : TASK),
      /**
       * ***The dial, in the pack's words, after the question and before the
       * pool*** — [06 §6.1], [P11.5].
       *
       * **After the task**, because the task is what makes the schema
       * answerable and the pacing prose is a disposition to bring to it; **before
       * the pool**, because a disposition read after the premises is a
       * disposition read about the premises. *Omitted entirely when the pack
       * ships none*, rather than emitted empty: `se.hooks.select.pacing` absent
       * from a turn record says the pack has nothing to say here, and a block
       * with an empty string says the pack tried and failed.
       *
       * ***And it is still not a commitment.*** §6.1: *"`aggressive` must not
       * reach railroading… The dial changes how often a hook is considered.
       * Guidance stays advisory at every setting and none of them makes the
       * narrator comply."* This block is read by the **selector**, which answers
       * with a hook id or null — it cannot make the narrator do anything,
       * because the narrator never sees it. A pack that wrote *always fire* here
       * would get a selector that says yes more often and guidance that is as
       * advisory as it ever was.
       */
      ...(pacingProse === null ? [] : [block('se.hooks.select.pacing', 'system', pacingProse)]),
      block('se.hooks.select.pool', 'system', poolText(eligible)),
      ...(recent.length === 0 ? [] : [block('se.hooks.select.recent', 'user', recent)]),
    ],
    schema: {
      type: 'object',
      properties: {
        hookId: { type: ['string', 'null'], enum: [...ids, null] },
        why: { type: 'string' },
      },
      required: ['hookId'],
      additionalProperties: false,
    },
  });

  const answer = answered(result.object ?? result.text);
  return eligible.find((hook) => hook.id === answer) ?? null;
}

/**
 * The instruction, in the engine rather than in the prompt pack.
 *
 * ***Which is the one place this feature's engine/pack line sits differently
 * from where [06 §6.1] draws it.*** That section puts the *levels'* prose in the
 * pack — how `sparse` should read to a model — and the numbers in engine code.
 * This is neither: it is the question that makes the call's **schema**
 * answerable, the same class of thing as [P7.4]'s `schemaInstruction`, and a
 * pack able to edit it could make the answer not parse. The pacing prose it
 * refers to is still the pack's, and ~~arrives as an ordinary block when the
 * pack grows one~~ ***arrived 2026-09-17 at [P11.5], and not quite in that
 * shape.***
 *
 * *The correction is worth the two lines because the guess was wrong in an
 * instructive direction.* An ordinary `PresetBlock` cannot vary by level — it is
 * one template with one `appliesTo` — so a pack would have had to ship four
 * blocks with nothing to choose among them. What the prose needed was the shape
 * [06 §7.3.1] already gave difficulty and [P7.8] gave directedness: a **named
 * level with ranked fragments**, selected by the dial. So `Preset.pacingLevels`
 * is that, `sessions/hooks.ts` resolves it, and it reaches this call as
 * `se.hooks.select.pacing` below — an ordinary block in the record, which is the
 * half of the guess that held.
 */
/**
 * The question a **commitment** asks, which is not the one below it.
 *
 * [06 §6.1]: Commit *"does not choose the moment. Stage 2 still runs, with the
 * question changed from whether to where, and that is the difference between
 * committing a hook and forcing one."* So *prefer null* is gone — a person has
 * already decided that this should happen — and what is left is whether this is
 * the place. **Bounded patience is what stops that becoming *say yes eventually*
 * and is the reason this prompt can afford to be permissive**: three turns, and
 * then the commitment lapses rather than firing anyway.
 */
const COMMITTED_TASK = [
  'Someone has decided that one of the beats below should happen in this story.',
  'You are not choosing whether — only whether this is the moment for it.',
  'Answer with the id of the beat if now is a reasonable place for it, or null to wait.',
  'Do not wait for a perfect opening; a workable one is enough.',
].join('\n');

const TASK = [
  'You are choosing whether an authored plot beat should be introduced now.',
  'Answer with the id of at most one beat, or null.',
  'Prefer null. A beat that does not follow from what just happened should wait;',
  'there is no cost to waiting and a badly timed beat is worse than a late one.',
  'Weight is the author’s relative preference among beats, not a reason to fire one.',
].join('\n');

function poolText(eligible: readonly PlotHook[]): string {
  return eligible
    .map((hook) => {
      /**
       * **Entrance labels where there is no premise**, which [04 §6.1a] makes
       * legal and [06 §6.1] relies on: *"the selector's judgement pass is
       * described as reading premises, so where there is none it reads the
       * entrance labels"*. A label is also the one part of an entrance that is
       * not hidden content ([08 §6], [10 §10.1]) — but the *text* is, so an
       * unfired entrance never reaches this call whole.
       */
      const body =
        hook.premise.length > 0
          ? hook.premise
          : (hook.introduces?.entrances.map((entrance) => entrance.label).join('; ') ?? '');
      return `${hook.id} (${hook.magnitude}, weight ${String(hook.weight)}): ${hook.title}\n${body}`;
    })
    .join('\n\n');
}

/** A hook id, `null`, or nothing this build can read. */
function answered(from: unknown): string | null {
  if (typeof from === 'object' && from !== null && 'hookId' in from) {
    const { hookId } = from;
    return typeof hookId === 'string' ? hookId : null;
  }
  // The degraded path's answer is a string the endpoint was asked to shape.
  // Anything that is not JSON we can read is *none*, which is the safe answer
  // in the direction [06 §6.1] chooses everywhere: bias toward under-firing.
  if (typeof from !== 'string') return null;
  try {
    return answered(JSON.parse(from) as unknown);
  } catch {
    return null;
  }
}

/**
 * Which written arrival to use — [04 §6.1a], and [26 C13]'s first production
 * caller.
 *
 * **`weightedPick`, not `pick`, and C13 is why.** A judgement call is re-run on
 * a rewrite, so the hook this draws over may be a different hook with a
 * different entrance list; `pick` records the list's *length* and would hand
 * back a position into different content, while `weightedPick` records the
 * winner's **id** and refuses the replay — drawing fresh — when that winner is
 * no longer a candidate. C13 names this as the mechanism waiting for a caller.
 *
 * *`primaryEntranceId` is what a manual fire uses and the editor shows first; it
 * is explicitly **not** always-use-this, so the selector draws across all of
 * them.* Equal weights, because an `Entrance` carries none — the author's
 * preference among arrivals is `primaryEntranceId`, and it is not this path's.
 */
async function pickEntrance(
  hook: PlotHook,
  host: Parameters<StepImplementation>[1],
): Promise<string | null> {
  const entrances = hook.introduces?.entrances ?? [];
  if (entrances.length === 0) return null;
  const drawn = await host.random
    .at('se.hooks', 'entrance')
    .weightedPick(entrances.map((entrance) => ({ id: entrance.id, value: entrance, weight: 1 })));
  return drawn.text;
}

/**
 * The words the guidance slot carries — [06 §6.1], [06 §5.1].
 *
 * *"`delivery: 'seed'` is the same block with an instruction to expand rather
 * than weave."* So the difference between the two is one sentence in front of
 * the same content, which is why neither needs a mechanism of its own.
 *
 * ***`immediate` is not built, and reads as `seed` for now.*** [06 §6.1] makes
 * it *"the only one that writes narrative directly, and it should be the rare
 * choice"* — which is a different mechanism, not a stronger instruction: it
 * would have to produce the turn's output and then say what the narrator step is
 * for. Recorded here rather than refused, because a hook that cannot fire at all
 * is a worse answer than one that fires through the slot: the beat still
 * reaches the turn, and what an author loses is that it is woven rather than
 * printed.
 */
function guidanceFor(hook: PlotHook, entrance: string | null): string {
  const content = entrance ?? hook.premise;
  return hook.delivery === 'guidance'
    ? `Weave this into what happens next, in your own words:\n${content}`
    : `Expand this into what happens next:\n${content}`;
}

/**
 * **Provisional for an introduction** — [06 §6.1].
 *
 * Guidance is advisory and the narrator may decline it. For an event hook a
 * decline is a miss and the pool is none the worse; for an introduction it is
 * *"a silent permanent loss — marked fired, character never arrived, and
 * once-only"*. So it is recorded provisionally and becomes `fired` only when the
 * extract stage confirms the subject present — [P7.7]'s, and until it exists a
 * provisional stays provisional, which errs toward under-firing exactly as
 * §6.1 chose for goal completion and for death.
 */
function stateFor(hook: PlotHook): HookState {
  return hook.introduces === undefined ? 'fired' : 'provisional';
}

function block(id: string, role: 'system' | 'user', text: string): Candidate {
  return {
    id,
    source: { kind: 'step', stepId: SE_HOOKS_SELECT },
    // Author-facing English, as P2.5 established for `reason`.
    reason: 'plot-hook selection',
    role,
    text,
    required: true,
  };
}

/** The last prose on the path, for *what just happened*. */
function lastOutput(path: readonly Turn[]): string {
  for (let at = path.length - 1; at >= 0; at -= 1) {
    const text = path[at]?.output?.text;
    if (text !== undefined && text.length > 0) return text;
  }
  return '';
}
