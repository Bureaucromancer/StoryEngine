// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import type { JSX } from 'react';

import type { ModelCall } from '@storyengine/shared';

import { formatCount, formatDuration } from '../../format.js';
import { Badge } from '../../ui/Badge.js';
import { MetadataRow } from '../../ui/MetadataRow.js';
import { Panel } from '../../ui/Panel.js';
import { Fine, Note, SubsectionTitle } from '../../ui/Text.js';
import { BlockTable } from './BlockTable.js';
import { BudgetVerdictView } from './BudgetVerdictView.js';
import { OUTCOME_LABELS, OUTCOME_TONES } from './labels.js';
import { NotFilledList } from './NotFilledList.js';
import { rulesOf } from './rules.js';

/**
 * One model call, whole — [10 §3]'s *"one per model call"*, now that the
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

const PURPOSE_LABELS: Record<NonNullable<ModelCall['purpose']>, string> = {
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
  /**
   * **A call recorded before [P3.0] carries none of this**, and the panel
   * reads what is on disk rather than what this build would write — so the
   * assembly half is a section that can be absent, exactly like `request`,
   * `steps` and `cost` are on the turn itself.
   *
   * The two travel together (one repair added both), and they are checked
   * together rather than separately because a block table with no verdict
   * would render every row unruled — which reads as *nothing was dropped*,
   * a claim about the budget rather than about the record.
   */
  const blocks = call.blocks;
  const budget = call.budget;
  const assembly = blocks === undefined || budget === undefined ? null : { blocks, budget };

  const estimated =
    assembly === null
      ? null
      : assembly.blocks
          .filter((block) => block.included)
          .reduce((sum, block) => sum + block.tokens, 0);

  return (
    <section aria-label={`Call ${String(ordinal)}: ${call.stepId}`} className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <SubsectionTitle as="h4">
          {count > 1 ? `Call ${String(ordinal)} — ${call.stepId}` : call.stepId}
        </SubsectionTitle>
        <Badge tone={OUTCOME_TONES[call.outcome]}>{OUTCOME_LABELS[call.outcome]}</Badge>
        {call.purpose === undefined ? null : (
          <Badge tone="neutral">{PURPOSE_LABELS[call.purpose]}</Badge>
        )}
      </div>

      {assembly === null ? (
        <Note>
          This call predates the block table: it was recorded before the turn kept what went into
          the prompt, so there is nothing to show here. What was asked, and what came back, are
          below.
        </Note>
      ) : (
        <>
          <BlockTable blocks={assembly.blocks} rules={rulesOf(assembly.budget)} locale={locale} />
          <BudgetVerdictView verdict={assembly.budget} locale={locale} />
          <NotFilledList notFilled={call.notFilled ?? []} />
        </>
      )}

      <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-1 text-sm">
        <MetadataRow label="Model">
          <code className="break-all text-xs">{call.resolved.modelId}</code>
        </MetadataRow>
        <MetadataRow label="Params">
          <code className="break-all text-xs">{JSON.stringify(call.params)}</code>
        </MetadataRow>
        {/* The estimate is a fold over the blocks, so a call with no blocks
            on file has only the provider's own figure to report — and saying
            "0 estimated" there would invent a measurement. */}
        <MetadataRow label="Prompt tokens">
          {estimated === null
            ? call.usage === null
              ? 'Not recorded'
              : `${formatCount(call.usage.promptTokens, locale)} reported`
            : call.usage === null
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
