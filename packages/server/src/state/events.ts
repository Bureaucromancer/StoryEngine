// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import type { FailureRemedy } from '@storyengine/shared';

import type { StepFailureReason, StepSkipReason, StepStage } from '../sessions/types.js';
import type { ModelRole } from '../providers/types.js';

/**
 * The progress vocabulary — [09 §3.3](../../../../docs/design/09-server-multiuser-deployment.md).
 *
 * That section prints eleven event names, and this is them as a closed union
 * with a constructor each. `ProgressEvent.key` in the store is a bare `string`
 * (it is a text column), so a misspelled `call.streamed` would be written, read,
 * sequenced and delivered — and rendered by nothing. A union is what makes the
 * typo a compile error instead of a frame the client silently drops.
 *
 * **Progress events are structural, and carry no prose.** §3.3 is explicit that
 * they need no `{key, params}` summary the way a *notification* does — the
 * client renders them — but the shared rule still binds: the server does not
 * know the reader's language ([work plan §2](../../../../docs/design/workplan/01-work-plan.md)), so a
 * failure travels as a **class** and never as `ProviderError.message` (English)
 * or `.detail` (the provider's own words). Those go to the log, which
 * [19 §12.7](../../../../docs/design/19-tech-stack.md) keeps deliberately untranslated.
 *
 * It lives here rather than under `turns/` so that `jobs.ts` and `commit.ts`
 * can name an event without importing the runner.
 */

export type ProgressKey =
  | 'turn.started'
  | 'step.started'
  | 'call.started'
  | 'call.streaming'
  | 'call.finished'
  | 'step.finished'
  | 'step.failed'
  | 'step.skipped'
  | 'effect.applied'
  | 'turn.finished'
  | 'job.progress';

const KEYS: ReadonlySet<string> = new Set<ProgressKey>([
  'turn.started',
  'step.started',
  'call.started',
  'call.streaming',
  'call.finished',
  'step.finished',
  'step.failed',
  'step.skipped',
  'effect.applied',
  'turn.finished',
  'job.progress',
]);

/** Whether a key read back from the store is one this build knows. */
export function isProgressKey(key: string): key is ProgressKey {
  return KEYS.has(key);
}

/** An event before it has a sequence number — the store allocates that. */
export interface EventDraft {
  key: ProgressKey;
  params?: Record<string, unknown>;
}

export const turnStarted = (turnId: string): EventDraft => ({
  key: 'turn.started',
  params: { turnId },
});

export const stepStarted = (stepId: string, stage: StepStage): EventDraft => ({
  key: 'step.started',
  params: { stepId, stage },
});

export const stepSkipped = (stepId: string, reason: StepSkipReason): EventDraft => ({
  key: 'step.skipped',
  params: { stepId, reason },
});

export const stepFinished = (
  stepId: string,
  contributed: { blocks: number; effects: number },
  ms: number,
): EventDraft => ({ key: 'step.finished', params: { stepId, contributed, ms } });

/**
 * ***`remedy` is what a person could do; `error` is what the engine did*** —
 * [P11.6](../../../../docs/design/workplan/28-p11-implementation.md).
 *
 * Both travel, because they answer different questions and a reader needs both:
 * a bug report wants the class, and the person in front of the screen wants the
 * sentence. **The engine's own word was doing both jobs and doing one of them
 * badly** — the play surface rendered *The turn failed (transient)*, and
 * *transient* describes our retry ladder rather than anything they can act on.
 *
 * *Optional, so the many call sites that are about something else stay as they
 * are.* A draft without one says nothing about remedies rather than claiming
 * `engine`.
 */
export const stepFailed = (
  stepId: string,
  error: StepFailureReason,
  willRetry: boolean,
  remedy?: FailureRemedy,
): EventDraft => ({
  key: 'step.failed',
  params: { stepId, error, willRetry, ...(remedy === undefined ? {} : { remedy }) },
});

/**
 * ***`message` is which of the turn's messages a speaking call is writing*** —
 * [P13 §1.4](../../../../docs/design/workplan/30-p13-scene-and-session-import.md)
 * point 4, added at [P13.2]: *"Progress events gain `message: n`."*
 *
 * The index into the turn's `output.messages`, the same number the draft's
 * messages and the `delta` frames carry, so a surface painting a round knows
 * which bubble a call is filling from the durable events alone. **Absent on a
 * call that speaks for nobody**, which is every call before P13.2 and every
 * narrator's still: a consumer that never heard of it reads these events
 * exactly as it did.
 */
export const callStarted = (
  stepId: string,
  role: ModelRole,
  model: string,
  message?: number,
): EventDraft => ({
  key: 'call.started',
  params: { stepId, role, model, ...(message === undefined ? {} : { message }) },
});

/** `message` as on {@link callStarted}. `tokens` counts that message's text alone. */
export const callStreaming = (stepId: string, tokens: number, message?: number): EventDraft => ({
  key: 'call.streaming',
  params: { stepId, tokens, ...(message === undefined ? {} : { message }) },
});

export const callFinished = (
  stepId: string,
  usage: { promptTokens: number; completionTokens: number } | null,
  ms: number,
): EventDraft => ({
  key: 'call.finished',
  params: {
    stepId,
    // Null rather than zero when the provider does not report. A zero here
    // would be a measurement nobody made ([21 §1.4]).
    promptTokens: usage?.promptTokens ?? null,
    completionTokens: usage?.completionTokens ?? null,
    ms,
  },
});

/**
 * A channel change, and — when it was refused — **which policy refused it**.
 *
 * The reason is here because [P3.5] built the live view: without it a live
 * reader says *refused* where the record says *refused because the engine
 * computes this channel*, and the stage's own precondition names that
 * disagreement as the thing to prevent. It is the same class the record
 * carries (`ChannelEffect.rejectedReason`, [P3.0]) rather than a second
 * vocabulary — `'engine-computed'`, `'user-only'`, `'unknown-channel'`, open
 * for an extension's own — so the two views cannot drift apart by
 * construction. `null` when the effect applied: absent-versus-empty, on the
 * wire as in the record.
 */
export const effectApplied = (
  channelId: string,
  accepted: boolean,
  reason: string | null,
): EventDraft => ({
  key: 'effect.applied',
  params: { channelId, accepted, reason },
});

export const turnFinished = (state: 'complete' | 'failed' | 'suspended'): EventDraft => ({
  key: 'turn.finished',
  params: { state },
});
