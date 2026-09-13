// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import type { Candidate, StepDefinition, StepImplementation } from '@storyengine/sdk';
import type { HookPacing, HookSelection, PlotHook, Turn } from '@storyengine/shared';

import {
  filterHooks,
  gate,
  SE_HOOK,
  SE_HOOK_PACING,
  type FilterContext,
  type HookState,
} from '../sessions/hooks.js';
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
   * positioned guidance. That is [25 C13(c)], and running first is what lets the
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
   * says so through the session's `stepRoles` — [19 §5.1]'s fourth layer, and
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
}

export interface HookSelectorContext {
  pool: readonly PooledHook[];
  /** Everything stage one needs, resolved by the caller. */
  filter: Omit<FilterContext, 'channels' | 'path'>;
  pacing: HookPacing;
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
      const filter: FilterContext = { ...context.filter, channels: input.channels, path };
      const verdicts = filterHooks(context.pool, filter);
      const considered = verdicts.map((verdict) => ({
        hookId: verdict.hook.id,
        refusal: verdict.refusal,
      }));
      const eligible = verdicts.filter((verdict) => verdict.refusal === null).map((v) => v.hook);

      const decision = gate({
        pacing: context.pacing,
        depth: path.length,
        firedAt: lastFiredAt(path),
        eligible: eligible.length,
      });

      if (decision !== 'judged') {
        context.report({ selection: { verdict: decision, pacing: context.pacing, considered } });
        return {};
      }

      const chosen = await judge(eligible, input.output?.text ?? lastOutput(path), host);
      if (chosen === null) {
        context.report({
          selection: { verdict: 'judged-none', pacing: context.pacing, considered },
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
        },
        guidance: guidanceFor(chosen, entrance),
        fired: { hookId: chosen.id, state: stateFor(chosen) },
      });
      return {};
    },
  };
}

/**
 * How deep on the path the most recent firing sits, or null.
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
  path.forEach((turn, depth) => {
    for (const effect of turn.effects) {
      if (!effect.applied || effect.channelId !== SE_HOOK) continue;
      if (effect.after === 'fired' || effect.after === 'provisional') at = depth;
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
  host: Parameters<StepImplementation>[1],
): Promise<PlotHook | null> {
  const ids = eligible.map((hook) => hook.id);
  const result = await host.call({
    candidates: [
      block('se.hooks.select.task', 'system', TASK),
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
 * refers to is still the pack's, and arrives as an ordinary block when the pack
 * grows one.
 */
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
 * Which written arrival to use — [04 §6.1a], and [25 C13]'s first production
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
