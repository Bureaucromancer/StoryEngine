// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import type { StepFailureReason, StepSkipReason, StepStage } from '../sessions/types.js';
import type { ModelRole } from '../providers/types.js';

/**
 * The progress vocabulary — [04 §3.3](../../../../docs/design/04-server-multiuser-deployment.md).
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
 * know the reader's language ([01 §2](../../../../docs/design/workplan/01-work-plan.md)), so a
 * failure travels as a **class** and never as `ProviderError.message` (English)
 * or `.detail` (the provider's own words). Those go to the log, which
 * [07 §12.7](../../../../docs/design/07-tech-stack.md) keeps deliberately untranslated.
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

export const stepFailed = (
  stepId: string,
  error: StepFailureReason,
  willRetry: boolean,
): EventDraft => ({ key: 'step.failed', params: { stepId, error, willRetry } });

export const callStarted = (stepId: string, role: ModelRole, model: string): EventDraft => ({
  key: 'call.started',
  params: { stepId, role, model },
});

export const callStreaming = (stepId: string, tokens: number): EventDraft => ({
  key: 'call.streaming',
  params: { stepId, tokens },
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
    // would be a measurement nobody made ([13 §1.4]).
    promptTokens: usage?.promptTokens ?? null,
    completionTokens: usage?.completionTokens ?? null,
    ms,
  },
});

export const effectApplied = (channelId: string, accepted: boolean): EventDraft => ({
  key: 'effect.applied',
  params: { channelId, accepted },
});

export const turnFinished = (state: 'complete' | 'failed' | 'suspended'): EventDraft => ({
  key: 'turn.finished',
  params: { state },
});
