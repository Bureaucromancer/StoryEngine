// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * ***Starting the assistant*** — the panel's first test, written with the fix
 * it covers (2026-09-27).
 *
 * A start the server refused was dropped: the mutation failed, nothing read
 * its error, and the button came back as if it had never been pressed — the
 * one outcome a person cannot act on, because nothing says there was one.
 */

const createSession = vi.fn();

vi.mock('../api.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api.js')>()),
  listSessions: () => Promise.resolve({ sessions: [] }),
  createSession: (...a: unknown[]) => createSession(...a) as unknown,
}));

vi.mock('@tanstack/react-router', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tanstack/react-router')>()),
  useRouterState: ({
    select,
  }: {
    select: (state: { location: { pathname: string } }) => unknown;
  }) => select({ location: { pathname: '/' } }),
}));

const { ApiError } = await import('../api.js');
const { AssistantPanel } = await import('./AssistantPanel.js');

beforeEach(() => {
  vi.clearAllMocks();
});

function renderPanel(): void {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <AssistantPanel onClose={() => undefined} />
    </QueryClientProvider>,
  );
}

describe('starting a conversation with the assistant', () => {
  it('says so when the server refuses to start one', async () => {
    createSession.mockRejectedValue(new ApiError(422, 'unknown-mode', 'No such mode.'));
    renderPanel();

    await userEvent.click(await screen.findByRole('button', { name: 'Start a conversation' }));

    expect((await screen.findByRole('alert')).textContent).toBe(
      'The assistant could not be started. No such mode.',
    );
    // And the button is there to try again, which clears the message.
    expect(screen.getByRole('button', { name: 'Start a conversation' })).toBeTruthy();
  });

  /**
   * ***With the card in it*** (2026-09-27): the panel asked for a cast of the
   * shipped assistant card, and `createSession` never put a cast given whole on
   * the wire. The wire half is `api.test.ts`'s; this is that the panel asks.
   */
  it('asks for a session with the assistant card as its one actor', async () => {
    createSession.mockReturnValue(new Promise(() => undefined));
    renderPanel();

    await userEvent.click(await screen.findByRole('button', { name: 'Start a conversation' }));

    expect(createSession).toHaveBeenCalledWith(
      expect.objectContaining({
        cast: { persona: null, actors: ['0199c000-0000-7000-8000-00000000a552'] },
      }),
    );
  });
});
