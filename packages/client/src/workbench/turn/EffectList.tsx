// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import type { JSX } from 'react';

import type { ChannelEffect } from '@storyengine/shared';

import { Badge } from '../../ui/Badge.js';
import { Fine, SubsectionTitle } from '../../ui/Text.js';

/**
 * The effects, all three outcomes of [05 §3] now renderable from the
 * record's own fields ([P3.0]): applied; rejected with *which* policy
 * refused (the split vocabulary, mapped class-to-sentence with the raw word
 * as the fallback for an extension's own refusal); and superseded — the
 * engine write that carries `supersedes` says it replaced a refusal, as a
 * link the record made rather than an adjacency the view guessed.
 */

const REFUSAL_LABELS: Record<string, string> = {
  'engine-computed': 'refused — the engine computes this channel',
  'user-only': 'refused — only a person may change it',
  'unknown-channel': 'refused — no channel by this name',
};

const PROPOSER_LABELS: Record<ChannelEffect['proposedBy']['kind'], string> = {
  model: 'proposed by the model',
  step: 'proposed by a step',
  user: 'written by you',
  engine: 'computed by the engine',
};

export function EffectList({ effects }: { effects: ChannelEffect[] }): JSX.Element {
  return (
    <section aria-label="Effects" className="flex flex-col gap-2">
      <SubsectionTitle as="h4">Effects</SubsectionTitle>
      {effects.length === 0 ? (
        <Fine>This turn proposed no channel changes.</Fine>
      ) : (
        <ul className="flex flex-col gap-2 text-sm">
          {effects.map((effect) => (
            <li key={effect.id} className="flex flex-col gap-0.5">
              <span className="flex flex-wrap items-center gap-2">
                {/*
                  The scope key travels with the id, because without it a
                  per-entry channel is illegible: every sticky lore entry in a
                  turn writes `se.lore.timing`, and until [P6B.1] the list
                  showed that name four times over with nothing to tell the
                  four apart — [P5 §3] step 8. Rendered as `id[key]` rather
                  than as a second column, so an unscoped channel still reads
                  as the plain name it is.
                */}
                <code className="text-xs">
                  {effect.scopeKey === null
                    ? effect.channelId
                    : `${effect.channelId}[${effect.scopeKey}]`}
                </code>
                <Badge tone={effect.applied ? 'neutral' : 'danger'}>
                  {effect.applied ? 'Applied' : 'Rejected'}
                </Badge>
                <span className="text-ink-muted">{PROPOSER_LABELS[effect.proposedBy.kind]}</span>
              </span>
              {effect.rejectedReason === null ? null : (
                <Fine>{REFUSAL_LABELS[effect.rejectedReason] ?? effect.rejectedReason}</Fine>
              )}
              {effect.supersedes === null ? null : (
                <Fine>Replaced a refused proposal from this turn.</Fine>
              )}
              <Fine>{`${JSON.stringify(effect.before)} → ${JSON.stringify(effect.after)}`}</Fine>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
