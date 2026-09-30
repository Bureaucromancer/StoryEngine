// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import type { ModelCall } from '@storyengine/shared';
import type {
  Candidate,
  StepDefinition,
  StepHost,
  StepImplementation,
  StepInput,
  TranscriptTurn,
} from '@storyengine/sdk';

import { quoted } from '../assembly/pictures.js';
import { storyDepth } from '../sessions/depth.js';
import { ensureChain, type Summariser } from '../sessions/summaries.js';
import {
  DEFAULT_SUMMARY_POLICY,
  summariserKey,
  type SummarisableTurn,
  type SummaryLink,
  type SummaryPolicy,
  type SummaryUnit,
} from '../sessions/summary-chain.js';
import type { Layout } from '../storage/layout.js';
import { resolveStepRole } from './calls.js';
import { roleLayersOf, type AssemblyInputs } from './gather.js';

/**
 * The summariser — [07 §5.1](../../../../docs/design/07-branching.md),
 * [25 E1](../../../../docs/design/25-open-questions.md), [P8.1].
 *
 * **A step, and [P8 §1.3] is why it cannot also be the extractor.** Two
 * arguments, and the second is the one that is not about cost. `callPurposeFor`
 * derives a call's purpose from the step's own declaration, so a step that
 * contributed messages *and* wrote channels is one the derivation has no honest
 * answer for. And the two want **different payloads**: a step entitled to the
 * record that then writes to the library is
 * [08 §6](../../../../docs/design/08-cross-session-memory.md)'s spoiler failure
 * with the defence architecturally removed. *What can be shared is the call and
 * not the step*, which nothing here forecloses.
 *
 * ***It declines the record it is entitled to.*** §1.3 grants the summariser the
 * record, and this declares `reads: ['transcript']` — what was said and what
 * came back, and nothing about how either was produced. Summarising the *prompt*
 * would carry a hook's premise into every later prompt through the back door,
 * and the narrower payload costs this step nothing because a summary of a
 * session is a summary of its story.
 *
 * **The fifth engine-owned step**, after the hook selector, the mention pass,
 * the goal judge and the suggester — `turns/runner.ts` appends it the way it
 * appends those, and for the same reason: the chain is engine machinery like the
 * clock, not a narrative choice a mode makes. A mode that wants no summary
 * positions no summary slot, and the runner leaves the step out of the plan
 * entirely rather than running it to do nothing.
 *
 * ---
 *
 * ***What it does not do is as much of the design as what it does.*** It derives
 * nothing that is already on disk: `ensureChain` reads by content address first,
 * so a warm chain costs zero calls and a fork costs exactly the one link it
 * invalidated. **On a long session the steady-state cost is one call per turn
 * beyond the window** — the trailing link gains a unit and re-keys — and that
 * number is [P8 §1.3]'s denominator rather than a decision this file is making.
 * `SummariseReport.derived` is how it gets measured.
 */

export const SE_SUMMARY = 'se.summary';

export const SUMMARISE_STEP: StepDefinition = {
  id: SE_SUMMARY,
  /**
   * **`pre`, because the thing it produces goes into this turn's prompt.** The
   * hook selector is `pre` for the identical reason and is the precedent: a
   * `post` step's report reaches the next turn, and a summary that arrived a
   * turn late would be a chain permanently one link behind the story.
   */
  stage: 'pre',
  reads: ['transcript'],
  /**
   * Nothing. What this produces reaches the prompt through the runner, the way a
   * hook selection and a span set do — and a `writes` entry would be a claim
   * that a summary changes session state, which [08 §5] spends a section
   * refusing for memories and which is no less true of a summary.
   */
  writes: [],
  callKind: 'summarise',
  when: { when: 'cadence', everyNTurns: 1 },
  /**
   * **`warn`, never `abort`.** A summary is derived and disposable — that is
   * [P8]'s own safety argument — so a turn thrown away because a summariser
   * timed out would trade the story for a cache. A session with no chain has a
   * shorter prompt, which is the state every session was in before this phase.
   */
  failure: 'warn',
  /**
   * `prose`, for [25 C15]'s reason and `turns/suggest.ts`' precedent: nothing in
   * this build binds any role but that one and `resolveRole` has no cross-role
   * fallback, so asking for `fast` would make every long session log a failed
   * step. **An install that wants something cheaper says so through the
   * session's `stepRoles`** — and because the resolved binding is in every
   * summary key, saying so re-derives the chain rather than silently mixing two
   * models' prose.
   */
  role: 'prose',
};

export interface SummariseReport {
  /** Oldest first. What the collector positions, if the preset has a slot. */
  links: readonly SummaryLink[];
  /** How many needed a model call. Zero on a warm chain — [P8 §1.3]. */
  derived: number;
}

export interface SummariseContext {
  layout: Layout;
  handle: string;
  sessionId: string;
  /** `span` and the mode's `historyWindow`, resolved by the caller. */
  policy: SummaryPolicy;
  /**
   * The resolved summariser's identity — `summariserKey`'s output.
   *
   * **Computed by the runner, which is the only place that can.** The key is the
   * *resolved* binding plus the prompt plus the parameters ([P8 §1.9]), and
   * resolving a role needs the account's bindings, the install defaults and the
   * session's overrides. A step has none of those and should not: `StepHost`
   * gives it `call` and deliberately nothing that would let it know which model
   * answered.
   */
  key: string;
  report: (report: SummariseReport) => void;
}

/**
 * ***What it asks for, and the things it is told not to do.***
 *
 * ~~A link is `f(previous link, the turns since)`, so the prompt hands over both
 * and asks for their union.~~ **Each link is its own stretch** (2026-09-27).
 * The collector puts every link in the prompt, oldest first, as its own block
 * — one stretch of story each, which is what [P8] designed, what `SummaryLink`
 * records (`from` and `to`), and what lets the budgeter give up the distant
 * past before the recent — and this prompt asked for the union, so each link
 * retold everything before it. The prompt carried the story over and over:
 * twenty turns past the window it was twice, a hundred and twenty past it six
 * times. And a model that followed *one short paragraph per twenty turns* grew
 * each link until one reached the reply's length limit, some two hundred turns
 * in; a cut-off link is not kept, so from there no link was ever written again
 * and every turn paid a summariser call for nothing.
 *
 * So a link summarises **its own turns**, and the link before it comes along
 * as context only — so names, places and open threads carry across the seam —
 * with an instruction not to repeat it. *Continuity is still the job*, and it
 * is kept by what is handed over rather than by retelling. [08 §2.1]'s appeal,
 * which this used to cite, is about memories being discrete; it argued for
 * stretches all along.
 *
 * *Do not invent* is worth stating to a model asked to compress: a summariser
 * that smooths over a gap produces a prompt that asserts something that never
 * happened, and every link after it reads it as context.
 *
 * *Do not address anyone*, because this text lands in a prompt as context and
 * not as narration. A summary written in the second person reads as a turn.
 *
 * **The prompt is in the summariser's key** (`summariserKey`), so changing it
 * re-keys every chain once and each is derived again in the new shape; a held
 * link from the old prompt is never read as one of the new.
 */
export const SUMMARISE_PROMPT = [
  'Summarise what happened in the turns below, in the past tense.',
  '',
  'If a summary of the story before them comes first, it is there so that names,',
  'places and threads stay consistent: do not repeat it, restate it or summarise it again.',
  'Keep every fact, name, place and decision that a later scene might depend on.',
  'Drop description, atmosphere and anything already implied by what you keep.',
  'Do not invent anything that is not in the material, and do not address the reader.',
  'One short paragraph.',
].join('\n');

/**
 * The chain as a step — appended to the plan by `turns/runner.ts`.
 *
 * Returns `{}`: this contributes no candidates and proposes no effects. What it
 * produces reaches the collector through `context.report`, which is the shape
 * the selector, the mention pass, the judge and the suggester all use.
 */
export function summarise(context: SummariseContext): {
  definition: StepDefinition;
  run: StepImplementation;
} {
  return {
    definition: SUMMARISE_STEP,
    run: async (input: StepInput, host: StepHost) => {
      const path = summarisablePath(input.transcript ?? []);
      const summariser: Summariser = {
        key: context.key,
        // So a turn stopped while it waits on the warm's derivation of a link
        // stops waiting (`ensureChain`'s in-flight join).
        signal: host.signal,
        run: async ({ previous, units }) =>
          keptSummary(await host.call({ candidates: summaryCandidates(previous, units) })),
      };

      const chain = await ensureChain(
        context.layout,
        context.handle,
        context.sessionId,
        path,
        summariser,
        context.policy,
      );
      /**
       * ***The held links reach the prompt when the next one fails***
       * (2026-09-27). One link that could not be written took the chain with
       * it. Reported first and then raised: the step is still `failed`, with
       * its class, and the story above the window is still there. *Not when
       * nothing is held*, because an empty report would read as a chain with
       * nothing in it rather than as a summariser that has not managed one.
       */
      if (chain.failure === undefined || chain.links.length > 0) {
        context.report({ links: chain.links, derived: chain.derived });
      }
      if (chain.failure !== undefined) {
        // As it was thrown, so the runner classifies it: a `CallFailed` keeps
        // its class and remedy, a stop is still a stop.
        throw chain.failure instanceof Error
          ? chain.failure
          : new Error('The summariser failed without saying why.');
      }
      return {};
    },
  };
}

/**
 * `transcript` to the chain's own shape — [P8.1], and since [P14.11] the warm's
 * too (`turns/warm-summaries.ts`).
 *
 * ***Shared rather than restated, because the warm is only worth anything if
 * it arrives at the turn's keys.*** A link's key is a hash over its units, and
 * a unit's over what this returns; a warm that built its path a second way
 * would fill `summaries/` with links the next turn never asks for, and the
 * turn would derive the whole chain anyway — the cliff, with a bill for the
 * warm on top.
 *
 * The one field that changes name is the identity — a `TranscriptTurn` calls
 * it `turnId` because it is a reference, and a `Turn` calls it `id` because it
 * is the thing.
 */
export function summarisablePath(transcript: readonly TranscriptTurn[]): SummarisableTurn[] {
  return transcript.map((turn) => ({
    id: turn.turnId,
    ...(turn.input === undefined
      ? {}
      : {
          input: {
            text: turn.input.text,
            ...(turn.input.attachments === undefined
              ? {}
              : { attachments: turn.input.attachments }),
          },
        }),
    ...(turn.output === undefined ? {} : { output: { text: turn.output.text } }),
  }));
}

/**
 * What one link's call is handed: the task, the link before as context, and
 * the turns. Shared with the warm for {@link summarisablePath}'s reason — the
 * prompt is in the summariser's key, and a warm that asked in other words
 * would be writing prose the key does not describe.
 */
export function summaryCandidates(
  previous: string | null,
  units: readonly SummaryUnit[],
): Candidate[] {
  return [
    block('se.summary.task', 'system', SUMMARISE_PROMPT),
    ...(previous === null ? [] : [block('se.summary.previous', 'user', previous)]),
    block('se.summary.turns', 'user', renderUnits(units)),
  ];
}

/**
 * ***Only a finished summary is kept*** (2026-09-27).
 *
 * A link is written under a content key, served from then on without being
 * asked for again, and handed to the next link as `previous`. So a reply that
 * ran into its length limit mid-sentence was the story above the window for
 * the rest of the session, and every link after it summarised the cut. A long
 * session reaches that limit by design, since each link covers everything
 * before it. A filtered reply came back empty and quietly removed the summary.
 *
 * Thrown rather than kept, so nothing is written for this link and the next
 * turn asks again: the step is `warn`, and a turn without a summary is the
 * state [P8]'s safety argument already prices. *`incomplete` is kept when it
 * has words*, because some local endpoints never report why they stopped, and
 * refusing those would refuse every summary they write.
 *
 * *A function since [P14.11]*, so the warm keeps what the step keeps: a warm
 * that wrote a cut-off link would hand every turn after it the cut.
 */
export function keptSummary(result: { text: string; outcome?: ModelCall['outcome'] }): string {
  const text = result.text.trim();
  if (result.outcome === 'truncated') {
    throw new Error('The summary was cut off at its length limit, so it was not kept.');
  }
  if (result.outcome === 'refused') {
    throw new Error('The provider refused to write the summary, so none was kept.');
  }
  if (text === '') throw new Error('The summary came back empty, so it was not kept.');
  return text;
}

/**
 * The turns a link covers, as one block.
 *
 * **Reads `said` and `replied` rather than the unit's key input**, which is the
 * separation `SummaryUnit` exists to keep: the digest's encoding is canonical
 * and unambiguous, and the model's is readable. A prompt rewrite must never be
 * able to invalidate a chain, and it cannot when the two do not share a field.
 *
 * The player's line is quoted and the reply is not, so a model can tell an
 * instruction from narration without being told which is which — **every line
 * of it** ({@link quoted}), or a picture's stand-in reads as the reply.
 */
function renderUnits(units: readonly SummaryUnit[]): string {
  return units
    .map((unit) => [quoted(unit.said), unit.replied].filter((line) => line !== '').join('\n'))
    .filter((turn) => turn !== '')
    .join('\n\n');
}

/**
 * *A local helper, like the judge's, the selector's and the suggester's.* The
 * fourth, and the repetition is still deliberate: what would be shared is a
 * `reason` string, which is author-facing English about **this** step and is the
 * one part that must not be.
 */
function block(id: string, role: 'system' | 'user', text: string): Candidate {
  return {
    id,
    source: { kind: 'step', stepId: SE_SUMMARY },
    reason: 'the story so far',
    role,
    text,
    required: true,
  };
}

/**
 * ***Whether this turn has a chain, and whose*** — the three questions the
 * runner asked inline, shared with the preview (2026-09-27).
 *
 * The pack positions a summary slot; the story is longer than the window, in
 * story turns as the window counts them; and the summariser's role resolves,
 * with the session's own overrides, because its *resolved* binding is in every
 * key ([P8 §1.9]). Null is *no chain*: a preview then carries no summary and a
 * turn runs no summariser. A preview that asked these differently from the
 * turn would read a chain the turn does not use, or miss the one it does.
 */
export function summaryPlanFor(
  inputs: AssemblyInputs,
): { key: string; policy: SummaryPolicy } | null {
  const window = inputs.mode.definition.assembly.historyWindow;
  const slotted = inputs.preset.blocks.some(
    (block) => block.enabled && block.kind === 'slot' && block.source.of === 'summary',
  );
  if (!slotted || storyDepth(inputs.history) <= window) return null;

  const role = resolveStepRole(
    roleLayersOf(inputs),
    SUMMARISE_STEP,
    SUMMARISE_STEP.role ?? 'prose',
    undefined,
  );
  if (!role.ok) return null;
  return {
    key: summariserKey(
      { connectionId: role.connection.id, modelId: role.modelId },
      SUMMARISE_PROMPT,
      inputs.preset.params,
    ),
    policy: { ...DEFAULT_SUMMARY_POLICY, window },
  };
}
