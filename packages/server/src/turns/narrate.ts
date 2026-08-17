// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import type { Candidate } from '../assembly/types.js';
import type { Turn } from '../sessions/types.js';
import type { StepDefinition, StepHost, StepInput, StepResult, TurnPlan } from './steps.js';

/**
 * The one step P2.5 ships, and the three candidates it has to work with.
 *
 * **This is not a collector framework.** `assemble()` has had no producer since
 * P2.4, and `SessionFile` records no mode, preset, persona, cast or lore — so
 * the sources that exist at P2.5 are the history, the guidance box, and what the
 * player just typed. Inventing the others here would pre-empt P2.6, which is
 * where a mode declares what a turn is made of.
 */

export const SE_NARRATE = 'se.narrate';

export const NARRATE: StepDefinition = {
  id: SE_NARRATE,
  stage: 'generate',
  reads: ['history'],
  // Writes nothing, and contributes to the visible message — which is precisely
  // what makes `callPurposeFor` yield `prose` and admit the guidance block. A
  // step that wrote a channel would be refused it, by derivation rather than by
  // anybody remembering ([03 §5.2]).
  writes: [],
  contributes: 'messages',
  when: { when: 'cadence', everyNTurns: 1 },
  // The turn is this call. If it fails there is nothing else to narrate, and a
  // turn that continued would commit a record with no prose in it.
  failure: 'abort',
  role: 'prose',
};

/** How many recent turns to offer the budgeter. It drops what does not fit. */
const HISTORY_WINDOW = 20;

export interface CollectOptions {
  /** Oldest first, as `walkPath` returns them. */
  history: readonly Turn[];
  input?: { text: string };
  /** The guidance box's contents, when the player wrote something in it. */
  guidance?: string;
}

/**
 * The candidates, in the order a preset would have positioned them.
 *
 * **Order is the caller's job**: `assemble()` treats the given order as the
 * preset's own and does not reorder, so this is where placement happens until
 * P2.6 supplies a preset that decides it.
 *
 * Ids are `se.`-namespaced and unique. A duplicate id would silently mark both
 * blocks dropped and give both the first one's rule, with a verdict that still
 * looks well-formed — which is the kind of wrong answer nobody thinks to check.
 */
export function collectCandidates(options: CollectOptions): Candidate[] {
  const candidates: Candidate[] = [];

  const recent = options.history.slice(-HISTORY_WINDOW);
  for (const [index, turn] of recent.entries()) {
    const text = [turn.input?.text, turn.output?.text].filter(Boolean).join('\n');
    if (text.length === 0) continue;

    candidates.push({
      id: `se.history.${String(index)}`,
      source: { kind: 'history', range: [index, index] },
      reason: 'recent turns',
      role: turn.output?.text === undefined ? 'user' : 'assistant',
      text,
      // History is what the budgeter sacrifices first, oldest first — which is
      // what makes it a splittable source rather than one block that fits or
      // does not.
      priority: 10 + index,
    });
  }

  if (options.guidance !== undefined && options.guidance.length > 0) {
    candidates.push({
      id: 'se.guidance',
      // Its own source, because [03 §5.1] says the preset positions this block —
      // and until P2.5 the only source it could have claimed was `step`, which
      // no slot may name.
      source: { kind: 'guidance', producer: 'user' },
      reason: 'typed in the guidance box',
      role: 'system',
      text: options.guidance,
      /**
       * **The flag that makes §5.2 enforceable.** `assemble` refuses an advisory
       * candidate for any purpose but prose, and the purpose is derived from the
       * step rather than chosen — so guidance can influence how a turn reads and
       * can never reach an effect.
       */
      advisory: true,
      priority: 80,
    });
  }

  if (options.input !== undefined && options.input.text.length > 0) {
    candidates.push({
      id: 'se.input',
      source: { kind: 'input' },
      reason: 'what you just did',
      role: 'user',
      text: options.input.text,
      // Required: a turn assembled without the player's action is not a shorter
      // prompt, it is the wrong one.
      required: true,
      priority: 100,
    });
  }

  return candidates;
}

/**
 * Narrate: one call, and the answer is the turn's output.
 *
 * The step does not assemble and does not choose a model. It asks the host,
 * which resolves the role from the definition and assembles with the purpose the
 * definition implies — the narrow boundary [12 §4] wants a worker to be able to
 * cross later.
 */
async function narrate(_input: StepInput, host: StepHost): Promise<StepResult> {
  const result = await host.call({ stream: true });
  return { message: { text: result.text } };
}

/** What a turn runs when nothing has supplied a plan. P2.6's modes bring theirs. */
export const DEFAULT_PLAN: TurnPlan = { steps: [{ definition: NARRATE, run: narrate }] };
