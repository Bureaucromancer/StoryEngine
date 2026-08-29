// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import type { JSX } from 'react';

import type { ModelCall } from '@storyengine/shared';

import { formatCount, formatDuration } from '../../format.js';
import { Badge, type BadgeTone } from '../../ui/Badge.js';
import { MetadataRow } from '../../ui/MetadataRow.js';
import { Panel } from '../../ui/Panel.js';
import { Fine, SubsectionTitle } from '../../ui/Text.js';
import { BlockTable } from './BlockTable.js';
import { BudgetVerdictView } from './BudgetVerdictView.js';
import { NotFilledList } from './NotFilledList.js';
import { rulesOf } from './rules.js';

/**
 * One model call, whole — [05 §3]'s *"one per model call"*, now that the
 * record keeps it that way: the call's own block table and verdict first
 * (the primary view), then what was not filled, then the call's facts, then
 * the rendered messages mapped back through their block ids.
 *
 * Renderings this view owes specific honesty to:
 * - a **cancelled** or failed call shows the model that was *asked*, because
 *   nothing answered — gate step 4's asymmetry, said in place;
 * - the **idle timeout** renders as its own failure with the provider
 *   boundary's own message — a timeout that read as *cancelled* would blame
 *   the person for the endpoint;
 * - **estimate beside reported** (gate step 6): the sum of included blocks'
 *   estimates against the provider's `promptTokens`, in one sentence with no
 *   alarm attached — the estimator is `length/4` and the chat template costs
 *   tokens, so a nonzero delta is the expected shape, and with the corpus
 *   still empty this is the first measurement rather than a regression from
 *   a baseline.
 */

const OUTCOME_LABELS: Record<ModelCall['outcome'], string> = {
  ok: 'Answered',
  refused: 'Refused',
  truncated: 'Truncated',
  incomplete: 'Incomplete',
  error: 'Failed',
  cancelled: 'Stopped',
};

const OUTCOME_TONES: Record<ModelCall['outcome'], BadgeTone> = {
  ok: 'neutral',
  refused: 'danger',
  truncated: 'danger',
  incomplete: 'danger',
  error: 'danger',
  // A person's Stop is not a failure, and painting it as one blames them.
  cancelled: 'neutral',
};

const PURPOSE_LABELS: Record<ModelCall['purpose'], string> = {
  prose: 'Prose',
  effects: 'Effects',
  verdict: 'Verdict',
};

export function CallView({
  call,
  ordinal,
  count,
  locale,
}: {
  call: ModelCall;
  ordinal: number;
  count: number;
  locale: string | undefined;
}): JSX.Element {
  const estimated = call.blocks
    .filter((block) => block.included)
    .reduce((sum, block) => sum + block.tokens, 0);

  return (
    <section aria-label={`Call ${String(ordinal)}: ${call.stepId}`} className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <SubsectionTitle as="h4">
          {count > 1 ? `Call ${String(ordinal)} — ${call.stepId}` : call.stepId}
        </SubsectionTitle>
        <Badge tone={OUTCOME_TONES[call.outcome]}>{OUTCOME_LABELS[call.outcome]}</Badge>
        <Badge tone="neutral">{PURPOSE_LABELS[call.purpose]}</Badge>
      </div>

      <BlockTable blocks={call.blocks} rules={rulesOf(call.budget)} locale={locale} />
      <BudgetVerdictView verdict={call.budget} locale={locale} />
      <NotFilledList notFilled={call.notFilled} />

      <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-1 text-sm">
        <MetadataRow label="Model">
          <code className="break-all text-xs">{call.resolved.modelId}</code>
        </MetadataRow>
        <MetadataRow label="Params">
          <code className="break-all text-xs">{JSON.stringify(call.params)}</code>
        </MetadataRow>
        <MetadataRow label="Prompt tokens">
          {call.usage === null
            ? `${formatCount(estimated, locale)} estimated — none reported`
            : `${formatCount(estimated, locale)} estimated, ${formatCount(call.usage.promptTokens, locale)} reported`}
        </MetadataRow>
        {call.usage === null ? null : (
          <MetadataRow label="Completion tokens">
            {formatCount(call.usage.completionTokens, locale)}
          </MetadataRow>
        )}
        <MetadataRow label="Wall time">{formatDuration(call.wallMs, locale)}</MetadataRow>
        {call.retries === 0 ? null : (
          <MetadataRow label="Retries">{formatCount(call.retries, locale)}</MetadataRow>
        )}
      </dl>

      {call.outcome === 'ok' ? null : (
        <Fine>The model named above is the one that was asked — nothing answered.</Fine>
      )}
      {call.error === null ? null : (
        <p role="alert" className="text-sm text-danger-ink">
          {`${call.error.class}: ${call.error.message}`}
        </p>
      )}

      <Panel variant="inset" className="max-h-96 overflow-y-auto">
        <ol className="flex flex-col gap-3">
          {call.messages.map((message, at) => (
            <li key={`${String(at)}:${message.fromBlocks.join(',')}`}>
              <Fine>{`${message.role} — from ${message.fromBlocks.join(', ')}`}</Fine>
              <pre className="text-xs whitespace-pre-wrap">{message.content}</pre>
            </li>
          ))}
        </ol>
      </Panel>
    </section>
  );
}
