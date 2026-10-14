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
const listSessions = vi.fn();
/** What the panel hands the play page — the page itself is not drawn here. */
const playPage = vi.fn();

vi.mock('../api.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api.js')>()),
  listSessions: (...a: unknown[]) => listSessions(...a) as unknown,
  createSession: (...a: unknown[]) => createSession(...a) as unknown,
  // Once there is a session the panel discloses what it can see, a write.
  writeSessionChannel: () => Promise.resolve(),
}));

vi.mock('../play/PlayPage.js', () => ({
  PlayPage: (props: unknown) => {
    playPage(props);
    return null;
  },
}));

vi.mock('./Proposal.js', () => ({ Proposal: () => null }));

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
const { ASSISTANT_MODE_ID } = await import('./session.js');

beforeEach(() => {
  vi.clearAllMocks();
  listSessions.mockResolvedValue({ sessions: [] });
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

/**
 * ***Its settings are drawn in the panel*** (2026-10-14,
 * [P12A](../../../../docs/design/workplan/35-p12a-the-look.md) P12A.5, after
 * review). The workbench follows the main view, not this panel: over the
 * assistant's Play its *Session settings* would open the dock on whatever the
 * main view is — a library object, another session — and *Archive this
 * session*, the assistant's way to start afresh, would be reachable nowhere.
 * So the panel asks the play page for its settings `here`, and the page's own
 * test holds what `here` draws. The page is not drawn: this is the wiring, and
 * what it is handed is the whole of it. Mutation: `settings="here"` dropped
 * from `AssistantPanel.tsx`'s `<PlayPage …/>`, which every other test passes.
 */
describe('the assistant’s session', () => {
  it('asks the play page for its settings in place, since the dock is not about it', async () => {
    listSessions.mockResolvedValue({
      sessions: [{ id: 'assistant-1', name: 'Assistant', mode: { id: ASSISTANT_MODE_ID } }],
    });
    renderPanel();

    await vi.waitFor(() => {
      expect(playPage).toHaveBeenCalledWith(
        expect.objectContaining({ sessionId: 'assistant-1', settings: 'here' }),
      );
    });
  });
});
