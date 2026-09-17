// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import type { JSX } from 'react';

import type { NotFilledSlot } from '@storyengine/shared';

import { Fine } from '../../ui/Text.js';
import { labels } from '../../i18n/catalogue.js';

/**
 * The slots that collected nothing — the record's answer to *why is there no
 * lore in this prompt* ([P3.0]'s §7.5 decision), rendered as the class-to-
 * sentence mapping the reason vocabulary was designed for. Nothing when the
 * list is empty: an absent section is the right rendering of nothing to say.
 */

const REASON_LABELS: Record<string, string> = labels('workbench.not-filled', {
  disabled: 'switched off in the preset',
  'not-applicable': 'not for this kind of call',
  'no-producer': 'nothing produces this yet',
  'empty-source': 'its source had nothing to give',
  'unknown-slot': 'a slot kind this build does not know',
});

export function NotFilledList({ notFilled }: { notFilled: NotFilledSlot[] }): JSX.Element | null {
  if (notFilled.length === 0) return null;

  return (
    <div className="flex flex-col gap-1">
      <Fine>Collected nothing</Fine>
      <ul className="flex flex-col gap-0.5 text-sm text-ink-muted">
        {notFilled.map((slot) => (
          <li key={slot.blockId} className="flex items-baseline gap-2">
            <code className="text-xs">{slot.blockId}</code>
            <span>{REASON_LABELS[slot.reason] ?? slot.reason}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
