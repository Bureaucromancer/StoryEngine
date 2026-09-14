// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import type { JSX } from 'react';

import type { TurnRecord } from '../../api.js';
import { Note } from '../../ui/Text.js';
import { CallView } from './CallView.js';
import { CostSummary } from './CostSummary.js';
import { EffectList } from './EffectList.js';
import { StepList } from './StepList.js';

/**
 * The turn record, rendered — [10 §3]'s viewer, replacing the JSON echo the
 * frame shipped with. Strictly a reader over fields the record holds: every
 * section below is a projection, and a section whose data is absent renders
 * the *absence* — [03 §8]'s doctrine that *this never happened* and *this
 * happened and was empty* are different claims the workbench shows apart.
 *
 * Blocks render **per call**, because that is what the record now says: the
 * same preset block legitimately recurs across calls with different
 * verdicts, and a derived-union table would have to invent a reconciliation
 * sentence per conflict — recomputation wearing a table's clothes. The
 * ordinary Scene turn has one call, which therefore reads as *the* block
 * table with no extra chrome.
 */
export function TurnSubject({
  turn,
  locale,
  sessionId,
}: {
  turn: TurnRecord;
  locale: string | undefined;
  /** Whose pack these blocks came from — [P7B.4]. Absent where there is no session. */
  sessionId?: string;
}): JSX.Element {
  return (
    <div className="flex flex-col gap-4">
      {turn.request === undefined ? (
        // Absent, not empty: a hand-edit divergence turn, or a turn that
        // failed before assembly ever ran.
        <Note>This turn made no request — nothing was assembled and nothing was sent.</Note>
      ) : turn.request.calls.length === 0 ? (
        // Present and empty, which is a *different* claim and used to render
        // as nothing at all — the reader saw the header, then the effects,
        // with no account of the prompt in between. Assembly ran here and
        // produced no call: the commonest cause is an unbound prose role, and
        // the step list below carries the reason.
        <Note>This turn assembled no call — it ended before any model was asked.</Note>
      ) : (
        turn.request.calls.map((call, at) => (
          <CallView
            key={call.id}
            call={call}
            ordinal={at + 1}
            count={turn.request?.calls.length ?? 1}
            locale={locale}
            {...(sessionId === undefined ? {} : { sessionId })}
          />
        ))
      )}
      <EffectList effects={turn.effects} />
      {turn.steps === undefined ? null : <StepList steps={turn.steps} locale={locale} />}
      {turn.cost === undefined ? null : <CostSummary cost={turn.cost} locale={locale} />}
    </div>
  );
}
