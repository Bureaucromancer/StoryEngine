// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import type { ModelCall } from '@storyengine/shared';

import type { BadgeTone } from '../../ui/Badge.js';

import { labels } from '../../i18n/catalogue.js';

/**
 * What a call's outcome is called, and what colour that is — extracted at
 * [P3.6] for the same reason `rules.ts` was extracted at [P3.4]: a second
 * surface now renders the fact, and two surfaces spelling one enum two ways
 * is how a reader ends up asking which of them is right.
 *
 * Keyed by value, never reverse (`library/labels.tsx`'s rule). Total over the
 * union rather than open like `SOURCE_LABELS`, because this vocabulary is the
 * record's own and a new arm is a change to this repo, not a newer build's
 * word arriving from disk.
 */

export const OUTCOME_LABELS: Record<ModelCall['outcome'], string> = labels(
  'workbench.call-outcome',
  {
    ok: 'Answered',
    refused: 'Refused',
    truncated: 'Truncated',
    incomplete: 'Incomplete',
    error: 'Failed',
    cancelled: 'Stopped',
  },
);

export const OUTCOME_TONES: Record<ModelCall['outcome'], BadgeTone> = {
  ok: 'neutral',
  refused: 'danger',
  truncated: 'danger',
  incomplete: 'danger',
  error: 'danger',
  // A person's Stop is not a failure, and painting it as one blames them.
  cancelled: 'neutral',
};
