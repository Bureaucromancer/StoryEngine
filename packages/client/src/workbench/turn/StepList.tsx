// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import type { JSX } from 'react';

import type { StepOutcome } from '@storyengine/shared';

import { formatCount, formatDuration } from '../../format.js';
import { Badge, type BadgeTone } from '../../ui/Badge.js';
import { Fine, SubsectionTitle } from '../../ui/Text.js';

/**
 * The steps, including skipped and failed — [04 §3.3]'s durable half: a
 * history view that hid a skip or a failure would silently disagree with the
 * live one about what happened.
 */

const STATE_LABELS: Record<StepOutcome['state'], string> = {
  ok: 'Ran',
  skipped: 'Skipped',
  failed: 'Failed',
};

const STATE_TONES: Record<StepOutcome['state'], BadgeTone> = {
  ok: 'neutral',
  skipped: 'neutral',
  failed: 'danger',
};

const SKIP_LABELS: Record<string, string> = {
  cadence: 'not its turn yet',
  stage: 'its stage did not run',
  'not-armed': 'its flag is not armed',
};

export function StepList({
  steps,
  locale,
}: {
  steps: StepOutcome[];
  locale: string | undefined;
}): JSX.Element {
  return (
    <section aria-label="Steps" className="flex flex-col gap-2">
      <SubsectionTitle as="h4">Steps</SubsectionTitle>
      <ul className="flex flex-col gap-2 text-sm">
        {steps.map((step) => (
          <li key={step.stepId} className="flex flex-col gap-0.5">
            <span className="flex flex-wrap items-center gap-2">
              <code className="text-xs">{step.stepId}</code>
              <Badge tone={STATE_TONES[step.state]}>{STATE_LABELS[step.state]}</Badge>
              <span className="text-ink-faint">{step.stage}</span>
            </span>
            {step.state === 'ok' ? (
              <Fine>
                {`Contributed ${formatCount(step.contributed.blocks, locale)} blocks and ${formatCount(step.contributed.effects, locale)} effects in ${formatDuration(step.wallMs, locale)}.`}
              </Fine>
            ) : null}
            {step.state === 'skipped' && step.skipReason !== undefined ? (
              <Fine>{SKIP_LABELS[step.skipReason] ?? step.skipReason}</Fine>
            ) : null}
            {step.state === 'failed' && step.error !== undefined ? (
              <Fine>{`${step.error.reason}: ${step.error.message}`}</Fine>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  );
}
