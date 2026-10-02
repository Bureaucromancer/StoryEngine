// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import type { JSX } from 'react';

import type { TurnCost } from '@storyengine/shared';

import { formatCount, formatDuration, formatMoney } from '../../format.js';
import { MetadataRow } from '../../ui/MetadataRow.js';
import { SubsectionTitle } from '../../ui/Text.js';

/**
 * This turn's spend — per-turn only; aggregate tracking is post-1.0 by
 * design. **Null renders as *not counted*, never as zero** — the `TurnCost`
 * doctrine: a cancelled turn's `{promptTokens: 0}` was the bug, because
 * *counted, and it was nothing* and *nobody counted* are different claims
 * and only one of them is free.
 */
export function CostSummary({
  cost,
  locale,
}: {
  cost: TurnCost;
  locale: string | undefined;
}): JSX.Element {
  return (
    <section aria-label="Cost" className="flex flex-col gap-2">
      <SubsectionTitle as="h4">Cost</SubsectionTitle>
      <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-1 text-sm">
        <MetadataRow label="Prompt tokens">
          {cost.promptTokens === null ? 'Not counted' : formatCount(cost.promptTokens, locale)}
        </MetadataRow>
        <MetadataRow label="Completion tokens">
          {cost.completionTokens === null
            ? 'Not counted'
            : formatCount(cost.completionTokens, locale)}
        </MetadataRow>
        {/* *Not priced* rather than *not counted*, and absent reads the same as
            null: a turn from before the field existed was never priced either.
            Null is what every turn says today — no adapter prices a call yet
            ([25 E16]) — and it must never read as free. */}
        <MetadataRow label="Money">
          {cost.money === undefined || cost.money === null
            ? 'Not priced'
            : formatMoney(cost.money.amount, cost.money.currency, locale)}
        </MetadataRow>
        <MetadataRow label="Wall time">{formatDuration(cost.wallMs, locale)}</MetadataRow>
        {/* An empty string is P2's spelling of the same fact: it wrote `""`
            where the contract now writes `null`, and reading it literally put
            a labelled row on screen with nothing beside it. Blank is not a
            model id, so treating it as *nothing answered* reads the older
            record rather than inventing anything. */}
        <MetadataRow label="Model">
          {cost.model === null || cost.model.trim() === '' ? (
            'Nothing answered'
          ) : (
            <code className="break-all text-xs">{cost.model}</code>
          )}
        </MetadataRow>
      </dl>
    </section>
  );
}
