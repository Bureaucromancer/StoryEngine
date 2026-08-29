// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import type { JSX } from 'react';

import type { BudgetVerdict } from '@storyengine/shared';

import { formatCount } from '../../format.js';
import { MetadataRow } from '../../ui/MetadataRow.js';
import { Note } from '../../ui/Text.js';
import { headroom } from '../headroom.js';

/**
 * The budget verdict — the window with its honest origin ([13 §1.5]'s
 * reshaped limit: ceiling, source, share), what was reserved and spent, and
 * the headroom-aware answer to *what falls out next*. The phrasing judgement
 * is `headroom`'s (gate step 5); every number the sentence uses is already
 * in the verdict — this is the viewer's honesty, not recomputation.
 */

const LIMIT_SOURCE_LABELS: Record<BudgetVerdict['limit']['source'], string> = {
  provider: 'the endpoint’s declared window',
  preset: 'the preset’s cap',
  user: 'your context limit',
};

export function BudgetVerdictView({
  verdict,
  locale,
}: {
  verdict: BudgetVerdict;
  locale: string | undefined;
}): JSX.Element {
  const room = headroom(verdict);
  const nextNames = room.next.join(', ');

  return (
    <div className="flex flex-col gap-2">
      <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-1 text-sm">
        <MetadataRow label="Window">
          {`${formatCount(verdict.limit.tokens, locale)} tokens`}
        </MetadataRow>
        <MetadataRow label="Ceiling">
          {`${formatCount(verdict.limit.ceiling, locale)} — ${LIMIT_SOURCE_LABELS[verdict.limit.source]}`}
        </MetadataRow>
        {verdict.limit.share === undefined ? null : (
          <MetadataRow label="Share">{`× ${String(verdict.limit.share)}`}</MetadataRow>
        )}
        <MetadataRow label="Reserved">
          {`${formatCount(verdict.reserved, locale)} for the answer`}
        </MetadataRow>
        <MetadataRow label="Spent">{formatCount(room.spent, locale)}</MetadataRow>
      </dl>
      {room.next.length === 0 ? (
        <Note>Nothing can fall out of this prompt: every block is required.</Note>
      ) : room.imminent ? (
        <Note role="status">{`About to fall out: ${nextNames}.`}</Note>
      ) : (
        <Note>
          {`Nothing is close to falling out — ${formatCount(room.spent, locale)} of ${formatCount(room.available, locale)} tokens spent. Under pressure, the first to go would be ${nextNames}.`}
        </Note>
      )}
    </div>
  );
}
