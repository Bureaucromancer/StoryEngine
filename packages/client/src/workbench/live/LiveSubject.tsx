// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import type { JSX } from 'react';

import type { EffectRefusal } from '@storyengine/shared';

import { formatCount, formatDuration } from '../../format.js';
import type { LiveStep, LiveTurn } from '../../play/reducer.js';
import { Badge, type BadgeTone } from '../../ui/Badge.js';
import { Fine, Note, SubsectionTitle } from '../../ui/Text.js';
import { labels } from '../../i18n/catalogue.js';

/**
 * The turn being taken, as the progress events describe it — [P3.5].
 *
 * **This is the stage's decision, on screen.** [09 §3.3] asserts the live view
 * *is* the turn record rendered while it is still being written, "one
 * component rather than a live view and a separate history view that
 * disagree". P3.5 decided that the other way, because the wire does not carry
 * it: the draft record reaches a client once, in the snapshot at open, and
 * everything after that is the structural event feed. A component fed from the
 * draft would show a block table frozen at the moment of attach while the turn
 * moved on beneath it — which is a disagreement of its own, and a quieter one.
 *
 * So this is a *second* component, and it renders strictly less: what the
 * events said, in the shape they said it. What it does not do is the point —
 * it never reconstructs a block table, a verdict or a call record out of event
 * params, because that is client-side recomputation of what the server already
 * computed ([P3 §5]: *the panel never recomputes what a dry run would
 * produce*), and it would drift from the record by construction. **The record
 * arrives whole when the turn commits**, in `TurnSubject`, and the two views
 * are never on screen at once.
 *
 * What the events buy, which [09 §3.3] names and the record cannot show until
 * afterwards: failure attached to a *step* rather than to the turn, a skipped
 * step visible rather than silent, and timing per step while it is happening.
 */

const STATE_LABELS: Record<LiveStep['state'], string> = labels('workbench.live.state', {
  running: 'Running',
  ok: 'Ran',
  skipped: 'Skipped',
  failed: 'Failed',
});

const STATE_TONES: Record<LiveStep['state'], BadgeTone> = {
  running: 'provenance',
  ok: 'neutral',
  skipped: 'neutral',
  failed: 'danger',
};

/** The same classes the record's own step list spells out, kept in step with it. */
const SKIP_LABELS: Record<string, string> = labels('workbench.live.skip', {
  cadence: 'not its turn yet',
  stage: 'its stage did not run',
  'not-armed': 'its flag is not armed',
});

/**
 * The refusal classes, worded as the record's `EffectList` words them — one
 * vocabulary, so a person reading the live view and then the record is not
 * told the same fact twice in two different sentences.
 */
const REFUSAL_LABELS: Readonly<Record<EffectRefusal, string>> = labels('workbench.live.refusal', {
  'engine-computed': 'refused — the engine computes this channel',
  'user-only': 'refused — only a person may change it',
  'unknown-channel': 'refused — no channel by this name',
  'needs-confirmation': 'refused — a person has to confirm this',
  schema: 'refused — the value does not fit the channel',
  'undeclared-write': 'refused — the step never declared it writes this channel',
  'not-its-proposer': 'refused — the step named a proposer it is not',
});

/**
 * A refusal in words — the table read open, because an extension's own class,
 * or a newer build's, is shown as written rather than not at all. *Typed closed
 * over the engine's classes* (2026-09-30, `EffectRefusal`): typed open, two of
 * the five shipped with no words and showed as their raw class
 * (`needs-confirmation`, `schema`), and a new class would have too.
 */
function refusalWords(reason: string): string {
  const words: Readonly<Partial<Record<string, string>>> = REFUSAL_LABELS;
  return words[reason] ?? reason;
}

export function LiveSubject({
  live,
  locale,
}: {
  live: LiveTurn;
  locale: string | undefined;
}): JSX.Element {
  return (
    <div className="flex flex-col gap-4">
      <Note role="status">
        {live.state === 'running'
          ? 'This turn is being taken. What follows is what the server has reported so far.'
          : 'This turn has finished. Its record arrives with the transcript.'}
      </Note>

      <section aria-label="Progress" className="flex flex-col gap-2">
        <SubsectionTitle as="h4">Progress</SubsectionTitle>
        {live.steps.length === 0 ? (
          <Fine>Nothing has been reported yet.</Fine>
        ) : (
          <ul className="flex flex-col gap-2 text-sm">
            {live.steps.map((step) => (
              <li key={step.stepId} className="flex flex-col gap-0.5">
                <span className="flex flex-wrap items-center gap-2">
                  <code className="text-xs">{step.stepId}</code>
                  <Badge tone={STATE_TONES[step.state]}>{STATE_LABELS[step.state]}</Badge>
                  <span className="text-ink-faint">{step.stage}</span>
                </span>

                {step.call === null ? null : (
                  <Fine>
                    {step.call.promptTokens === null
                      ? // Still in flight: the model that was asked, and the
                        // output estimated so far. Deliberately not called a
                        // measurement — nothing has reported one yet.
                        `Asked ${step.call.model}${
                          step.call.tokens === null
                            ? ''
                            : ` — about ${formatCount(step.call.tokens, locale)} tokens back so far`
                        }`
                      : `${step.call.model} answered: ${formatCount(step.call.promptTokens, locale)} prompt, ${formatCount(step.call.completionTokens ?? 0, locale)} completion${
                          step.call.ms === null ? '' : ` in ${formatDuration(step.call.ms, locale)}`
                        }`}
                  </Fine>
                )}

                {step.state === 'ok' && step.contributed !== null && step.ms !== null ? (
                  <Fine>
                    {`Contributed ${formatCount(step.contributed.blocks, locale)} blocks and ${formatCount(step.contributed.effects, locale)} effects in ${formatDuration(step.ms, locale)}.`}
                  </Fine>
                ) : null}
                {step.state === 'skipped' && step.skipReason !== null ? (
                  <Fine>{SKIP_LABELS[step.skipReason] ?? step.skipReason}</Fine>
                ) : null}
                {/* The class, never a message: the provider's own words stay
                    in the log, which is what the event contract promises. */}
                {step.state === 'failed' && step.error !== null ? <Fine>{step.error}</Fine> : null}
              </li>
            ))}
          </ul>
        )}
      </section>

      {live.effects.length === 0 ? null : (
        <section aria-label="Effects so far" className="flex flex-col gap-2">
          <SubsectionTitle as="h4">Effects so far</SubsectionTitle>
          <ul className="flex flex-col gap-2 text-sm">
            {live.effects.map((effect, at) => (
              <li key={`${effect.channelId}:${String(at)}`} className="flex flex-col gap-0.5">
                <span className="flex flex-wrap items-center gap-2">
                  <code className="text-xs">{effect.channelId}</code>
                  <Badge tone={effect.accepted ? 'neutral' : 'danger'}>
                    {effect.accepted ? 'Applied' : 'Rejected'}
                  </Badge>
                </span>
                {/* [P3.5]'s precondition, rendered: the live view says *which*
                    policy refused, in the record's own words, so reading one
                    after the other tells one story. */}
                {effect.reason === null ? null : <Fine>{refusalWords(effect.reason)}</Fine>}
              </li>
            ))}
          </ul>
        </section>
      )}

      <Fine>
        The block table, the budget and the rendered prompt are on the record, which is written when
        the turn finishes.
      </Fine>
    </div>
  );
}
