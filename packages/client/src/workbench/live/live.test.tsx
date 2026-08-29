// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import type { LiveTurn } from '../../play/reducer.js';
import { LiveSubject } from './LiveSubject.js';

/**
 * The turn being taken — [P3.5], over literal fixtures.
 *
 * What these hold is the stage's decision: this view renders **what the events
 * said**, and never more. Each test names a claim the event feed can support;
 * the last one names what it deliberately does not, because the temptation to
 * fill a block table in from event params is exactly the recomputation
 * [P3 §5] forbids and the thing that would make the live view disagree with
 * the record.
 */

function liveTurn(over: Partial<LiveTurn> = {}): LiveTurn {
  return {
    turnId: 't-12',
    state: 'running',
    steps: [],
    effects: [],
    ...over,
  };
}

const NARRATE = {
  stepId: 'se.narrate',
  stage: 'generate',
  state: 'running' as const,
  skipReason: null,
  error: null,
  ms: null,
  contributed: null,
  call: null,
};

describe('a turn being taken', () => {
  it('says it is happening, and says nothing has been reported yet', () => {
    render(<LiveSubject live={liveTurn()} locale={undefined} />);

    expect(
      screen.getByText(
        'This turn is being taken. What follows is what the server has reported so far.',
      ),
    ).toBeTruthy();
    expect(screen.getByText('Nothing has been reported yet.')).toBeTruthy();
  });

  it('shows a step as running, which is a state no committed step can be in', () => {
    render(<LiveSubject live={liveTurn({ steps: [NARRATE] })} locale={undefined} />);

    const progress = screen.getByRole('region', { name: 'Progress' });
    expect(within(progress).getByText('se.narrate')).toBeTruthy();
    expect(within(progress).getByText('Running')).toBeTruthy();
    expect(within(progress).getByText('generate')).toBeTruthy();
  });

  it('names the model it asked while the answer is still coming', () => {
    render(
      <LiveSubject
        live={liveTurn({
          steps: [
            {
              ...NARRATE,
              call: {
                role: 'prose',
                model: 'gemma-4',
                tokens: 42,
                promptTokens: null,
                completionTokens: null,
                ms: null,
              },
            },
          ],
        })}
        locale={undefined}
      />,
    );

    // Deliberately not phrased as a measurement: nothing has reported one.
    // The falsifying mutation is rendering the streamed estimate through the
    // same sentence the finished call uses.
    expect(screen.getByText('Asked gemma-4 — about 42 tokens back so far')).toBeTruthy();
  });

  it('switches to the measured figures once the call reports them', () => {
    render(
      <LiveSubject
        live={liveTurn({
          steps: [
            {
              ...NARRATE,
              state: 'ok',
              ms: 23_500,
              contributed: { blocks: 2, effects: 0 },
              call: {
                role: 'prose',
                model: 'gemma-4',
                tokens: 214,
                promptTokens: 397,
                completionTokens: 214,
                ms: 23_412,
              },
            },
          ],
        })}
        locale={undefined}
      />,
    );

    expect(screen.getByText(/gemma-4 answered: 397 prompt, 214 completion in 23\.4/)).toBeTruthy();
    expect(screen.getByText(/Contributed 2 blocks and 0 effects in 23\.5/)).toBeTruthy();
  });

  it('shows a skipped step as itself, which is why the event exists', () => {
    // [04 §3.3]: *a step whose `when` predicate was false is a common source of
    // "why didn't that happen?", and silence is the worst possible answer.*
    render(
      <LiveSubject
        live={liveTurn({
          steps: [{ ...NARRATE, stepId: 'se.recap', state: 'skipped', skipReason: 'cadence' }],
        })}
        locale={undefined}
      />,
    );

    expect(screen.getByText('Skipped')).toBeTruthy();
    expect(screen.getByText('not its turn yet')).toBeTruthy();
  });

  it('attaches a failure to the step, as a class and never a message', () => {
    render(
      <LiveSubject
        live={liveTurn({
          state: 'failed',
          steps: [{ ...NARRATE, state: 'failed', error: 'terminal' }],
        })}
        locale={undefined}
      />,
    );

    const progress = screen.getByRole('region', { name: 'Progress' });
    expect(within(progress).getByText('Failed')).toBeTruthy();
    expect(within(progress).getByText('terminal')).toBeTruthy();
    expect(
      screen.getByText('This turn has finished. Its record arrives with the transcript.'),
    ).toBeTruthy();
  });

  it('says which policy refused an effect, in the record’s own words', () => {
    // [P3.5]'s precondition on screen. The falsifying mutation is rendering
    // only `accepted` — which is all the event carried before this stage, and
    // which would make the live view say less than the record about the same
    // refusal.
    render(
      <LiveSubject
        live={liveTurn({
          effects: [
            { channelId: 'se.clock', accepted: false, reason: 'engine-computed' },
            { channelId: 'se.clock', accepted: true, reason: null },
          ],
        })}
        locale={undefined}
      />,
    );

    const effects = screen.getByRole('region', { name: 'Effects so far' });
    expect(within(effects).getByText('Rejected')).toBeTruthy();
    expect(within(effects).getByText('refused — the engine computes this channel')).toBeTruthy();
    expect(within(effects).getByText('Applied')).toBeTruthy();
  });

  it('renders no block table, and says where one will be', () => {
    // The decision, stated as an absence. Reconstructing a block table from
    // event params would be client-side recomputation of what the server has
    // already computed ([P3 §5]) and would drift from the record by
    // construction — so the view points at the record instead of guessing.
    render(
      <LiveSubject
        live={liveTurn({ steps: [{ ...NARRATE, contributed: { blocks: 7, effects: 1 } }] })}
        locale={undefined}
      />,
    );

    expect(screen.queryByRole('table')).toBeNull();
    expect(
      screen.getByText(
        'The block table, the budget and the rendered prompt are on the record, which is written when the turn finishes.',
      ),
    ).toBeTruthy();
  });
});
