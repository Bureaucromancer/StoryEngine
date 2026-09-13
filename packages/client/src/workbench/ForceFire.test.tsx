// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Force-fire — [06 §6.1], [10 §10.1], [P7.5].
 *
 * **Here and not on the hook panel**, which 10 §10.1 decides rather than files:
 * *"splitting them keeps a control that skips the engine's judgement out of the
 * surface people play on"*. `HookPanel.test.tsx` asserts the other half of that
 * — that this button is not over there.
 */

const readSession = vi.fn();
const writeSessionChannel = vi.fn();

vi.mock('../api.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../api.js')>();
  return {
    ...actual,
    readSession: (...a: unknown[]) => readSession(...a) as unknown,
    writeSessionChannel: (...a: unknown[]) => writeSessionChannel(...a) as unknown,
  };
});

const { ForceFire } = await import('./ForceFire.js');

const SESSION_ID = '01a008de-7e08-70d0-899c-f6869d6b9aeb';

const WAR = {
  hookId: 'hook-war',
  title: 'War with the Flower Kingdom',
  source: { kind: 'treatment' as const, id: 't1' },
  state: null as string | null,
  refusal: null as string | null,
  entrances: [] as { id: string; label: string }[],
};

function answerWith(rows: unknown[]): void {
  readSession.mockResolvedValue({
    session: { id: SESSION_ID, name: 'A wet week' },
    activeJob: null,
    health: [],
    hud: [],
    cast: [],
    hooks: { pacing: 'normal', rows },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  writeSessionChannel.mockResolvedValue({
    session: { id: SESSION_ID },
    effect: { applied: true, rejectedReason: null },
    health: [],
  });
});

function renderControl() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <ForceFire sessionId={SESSION_ID} />
    </QueryClientProvider>,
  );
}

describe('auditioning a hook', () => {
  it('shows nothing when there is nothing left to audition', async () => {
    answerWith([]);
    renderControl();

    await waitFor(() => {
      expect(readSession).toHaveBeenCalled();
    });
    expect(screen.queryByText('Audition a hook')).toBeNull();
  });

  it('fires a hook on the next turn through the channel Commit uses', async () => {
    answerWith([WAR]);
    renderControl();

    await userEvent.click(await screen.findByRole('button', { name: 'Fire next turn' }));

    await waitFor(() => {
      expect(writeSessionChannel).toHaveBeenCalledWith(SESSION_ID, 'se.hook#hook-war', 'forced');
    });
  });

  /**
   * **The clause is said before it is skipped**, not after — the same obligation
   * Commit's confirmation carries ([06 §6.1]'s first rule), and a control that
   * skips *more* owes the sentence more rather than less.
   */
  it('says what a forced hook would be skipping', async () => {
    answerWith([{ ...WAR, refusal: 'cast-gone' }]);
    renderControl();

    expect(await screen.findByText('Someone it is about is not here')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Fire next turn' })).toBeTruthy();
  });

  it('says so and stops offering once a hook is already forced', async () => {
    answerWith([{ ...WAR, state: 'forced', forced: { overrode: null } }]);
    renderControl();

    const button = await screen.findByRole<HTMLButtonElement>('button', {
      name: 'Firing next turn',
    });
    expect(button.disabled).toBe(true);
  });

  /**
   * **Only the hooks that have not gone.** A fired one has nothing left to
   * audition, and offering it would be offering to *un-fire* it as a side effect
   * of the states being exclusive — a real act, and not one to reach by pressing
   * a button labelled *Fire next turn*.
   */
  it('does not offer to re-fire a hook that has gone', async () => {
    answerWith([{ ...WAR, state: 'fired', refusal: 'fired' }]);
    renderControl();

    await waitFor(() => {
      expect(readSession).toHaveBeenCalled();
    });
    expect(screen.queryByText('Audition a hook')).toBeNull();
  });

  /**
   * *A session answered by a build without this field must not crash the panel.*
   * The optional chain stops at `data`, so `data?.hooks.rows` would throw on the
   * property access rather than read as *no hooks* — which is what it did, until
   * twenty-two dock tests said so.
   */
  it('survives a session response that carries no hooks at all', async () => {
    readSession.mockResolvedValue({
      session: { id: SESSION_ID, name: 'A wet week' },
      activeJob: null,
      health: [],
      hud: [],
      cast: [],
    });
    renderControl();

    await waitFor(() => {
      expect(readSession).toHaveBeenCalled();
    });
    expect(screen.queryByText('Audition a hook')).toBeNull();
  });
});
