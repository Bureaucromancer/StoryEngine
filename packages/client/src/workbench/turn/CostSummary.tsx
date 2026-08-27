// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import type { JSX } from 'react';

import type { TurnCost } from '@storyengine/shared';

import { formatCount, formatDuration } from '../../format.js';
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
        <MetadataRow label="Wall time">{formatDuration(cost.wallMs, locale)}</MetadataRow>
        <MetadataRow label="Model">
          {cost.model === null ? (
            'Nothing answered'
          ) : (
            <code className="break-all text-xs">{cost.model}</code>
          )}
        </MetadataRow>
      </dl>
    </section>
  );
}
