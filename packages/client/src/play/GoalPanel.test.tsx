// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The goal panel — [06 §7.3.3], [06 §7.3.4], [10 §12], [P7.6].
 *
 * **The claim worth holding is that the three offers are *offered*.**
 * [06 §7.3.4]: *"`thenDefault` seeds the offer; it does not decide it. A player
 * who did not know at setup whether they wanted an ending is the normal case,
 * and the moment of completion is when they finally have the information."* A
 * panel that applied the default would have thrown that away.
 */

const readSession = vi.fn();
const writeSessionChannel = vi.fn();
const addSessionGoal = vi.fn();

vi.mock('../api.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../api.js')>();
  return {
    ...actual,
    readSession: (...a: unknown[]) => readSession(...a) as unknown,
    writeSessionChannel: (...a: unknown[]) => writeSessionChannel(...a) as unknown,
    addSessionGoal: (...a: unknown[]) => addSessionGoal(...a) as unknown,
  };
});

const { GoalPanel } = await import('./GoalPanel.js');

const SESSION_ID = '01a008de-7e08-70d0-899c-f6869d6b9aeb';

const LEDGER = {
  goalId: 'g-ledger',
  statement: 'Get the ledger out of the Foundry.',
  visibility: 'player' as const,
  completion: 'narrative' as const,
  current: true,
  achieved: false,
  next: null as string | null,
  thenDefault: 'advance' as const,
};

function answerWith(rows: unknown[], concluded = false): void {
  readSession.mockResolvedValue({
    session: { id: SESSION_ID, name: 'A wet week' },
    activeJob: null,
    health: [],
    hud: [],
    cast: [],
    hooks: { pacing: 'normal', rows: [] },
    goals: { rows, concluded },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  writeSessionChannel.mockResolvedValue({
    session: { id: SESSION_ID },
    effect: { applied: true, rejectedReason: null },
    health: [],
  });
  addSessionGoal.mockResolvedValue({
    session: { id: SESSION_ID, goals: [{ id: 'g-new', statement: 'Find the fixer.' }] },
  });
});

/**
 * Rendered open: a disclosure's contents are what every test here is about, and
 * clicking it open in each one would be ten lines of the same click.
 *
 * *Opened off the container rather than off a text match*, because the panel's
 * own prose repeats words the summary uses — "ended" is in both the closed line
 * and the alert under it — and a query that matched two elements would fail for
 * a reason that has nothing to do with the test.
 */
async function renderPanel(): Promise<void> {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const { container } = render(
    <QueryClientProvider client={client}>
      <GoalPanel sessionId={SESSION_ID} />
    </QueryClientProvider>,
  );
  await waitFor(() => {
    expect(container.querySelector('details')).not.toBeNull();
  });
  container.querySelector('details')?.setAttribute('open', '');
}

describe('the goal panel', () => {
  it('says what the session is working toward without being opened', async () => {
    answerWith([LEDGER]);
    await renderPanel();

    expect(screen.getByText('Working toward: Get the ledger out of the Foundry.')).toBeTruthy();
  });

  /**
   * *A goal is one thing at a time*, so unlike the hook panel there is a single
   * fact worth showing — and a session playing on after a completion is a real
   * state with its own sentence, not an absence.
   */
  it('distinguishes never having one from playing on after one', async () => {
    answerWith([]);
    await renderPanel();
    expect(screen.getByText('No objective')).toBeTruthy();

    answerWith([{ ...LEDGER, current: false, achieved: true }]);
    await renderPanel();
    expect(screen.getByText('Playing on, with no objective')).toBeTruthy();
  });

  /**
   * ***The three offers, offered.*** The authored default is **marked** rather
   * than applied — a pre-pressed button would have decided what [06 §7.3.4] says
   * is the player's to decide at the moment they finally have the information.
   */
  it('raises three offers on a completion and marks the authored default', async () => {
    answerWith([
      { ...LEDGER, achieved: true, next: 'g-fixer' },
      {
        ...LEDGER,
        goalId: 'g-fixer',
        statement: 'Find the fixer.',
        current: false,
        achieved: false,
      },
    ]);
    await renderPanel();

    expect(screen.getByText('Done. What now?')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Carry on' })).toBeTruthy();
    // `thenDefault: 'advance'` — marked, not pressed.
    expect(screen.getByRole('button', { name: 'Next: Find the fixer. (suggested)' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'End the story' })).toBeTruthy();
    expect(writeSessionChannel).not.toHaveBeenCalled();
  });

  it('carries on by clearing the cursor and keeping the achievement', async () => {
    // `continue-open` here, so the marking is exercised on a second arm and the
    // label under test is the one the seed actually produces.
    answerWith([{ ...LEDGER, achieved: true, thenDefault: 'continue-open' }]);
    await renderPanel();

    await userEvent.click(screen.getByRole('button', { name: 'Carry on (suggested)' }));

    await waitFor(() => {
      expect(writeSessionChannel).toHaveBeenCalledWith(SESSION_ID, 'se.goal.current', null);
    });
  });

  it('advances onto the authored successor', async () => {
    answerWith([
      { ...LEDGER, achieved: true, next: 'g-fixer' },
      { ...LEDGER, goalId: 'g-fixer', statement: 'Find the fixer.', current: false },
    ]);
    await renderPanel();

    await userEvent.click(
      screen.getByRole('button', { name: 'Next: Find the fixer. (suggested)' }),
    );

    await waitFor(() => {
      expect(writeSessionChannel).toHaveBeenCalledWith(SESSION_ID, 'se.goal.current', 'g-fixer');
    });
  });

  /**
   * *"Concluded is a state, not a deletion: the session stays readable and
   * branchable"* — so End writes a channel and the panel keeps rendering.
   */
  it('ends the story as a state, and says so afterwards', async () => {
    answerWith([{ ...LEDGER, achieved: true }]);
    await renderPanel();

    await userEvent.click(screen.getByRole('button', { name: 'End the story' }));
    await waitFor(() => {
      expect(writeSessionChannel).toHaveBeenCalledWith(SESSION_ID, 'se.concluded', true);
    });

    answerWith([{ ...LEDGER, achieved: true }], true);
    await renderPanel();
    expect(screen.getByText(/stays readable, and rewinding puts you back/)).toBeTruthy();
  });

  /**
   * ***Manual completion, always available*** — [06 §7.3.3]'s other half, and
   * what makes the judge's bias toward *not met* affordable rather than a trap.
   */
  it('lets a person mark a narrative goal done themselves', async () => {
    answerWith([LEDGER]);
    await renderPanel();

    await userEvent.click(screen.getByRole('button', { name: 'Mark it done' }));

    await waitFor(() => {
      expect(writeSessionChannel).toHaveBeenCalledWith(SESSION_ID, 'se.goal#g-ledger', 'achieved');
    });
  });

  /**
   * *Hidden is the GM's arc* — [04 §7.1]. The smallest honest reveal affordance
   * is telling the player there **is** one without telling them what it is.
   */
  it('says a hidden goal exists without saying what it is', async () => {
    answerWith([{ ...LEDGER, visibility: 'hidden' }]);
    await renderPanel();

    expect(screen.getByText('the narrator’s arc')).toBeTruthy();
  });

  /**
   * ***Advance's second arm*** — *"either the authored `next` or one written
   * now"*. Two writes, because they are two acts: adding the goal is authoring
   * and moving play onto it is a move in the story.
   */
  it('sets a goal written now, then points play at it', async () => {
    answerWith([]);
    await renderPanel();

    await userEvent.type(
      screen.getByRole('textbox', { name: 'Set an objective' }),
      'Find the fixer.',
    );
    await userEvent.click(screen.getByRole('button', { name: 'Set' }));

    await waitFor(() => {
      expect(addSessionGoal).toHaveBeenCalledWith(
        SESSION_ID,
        expect.objectContaining({ statement: 'Find the fixer.' }),
      );
    });
    // The id the **server** minted, read back off the response rather than
    // guessed here.
    await waitFor(() => {
      expect(writeSessionChannel).toHaveBeenCalledWith(SESSION_ID, 'se.goal.current', 'g-new');
    });
  });

  it('offers no way to set one on a story that has ended', async () => {
    answerWith([{ ...LEDGER, achieved: true }], true);
    await renderPanel();

    expect(screen.queryByRole('textbox', { name: 'Set an objective' })).toBeNull();
  });
});
