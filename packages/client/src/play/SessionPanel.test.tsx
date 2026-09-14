// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * ***What a running session is prompted with, and the two verbs it never had***
 * — [P7B.2].
 *
 * [P7B §0.2] lists three absences and says any one of them alone kept the
 * sentence unchangeable: no editor, no object for an editor to open, and no
 * session-level path around either. This is the third. Until it,
 * `PATCH /api/sessions/:id` accepted `name` and `archived`, no route touched a
 * session's pack, and [manual testing]'s C3 read *"hand-edit
 * `preset.params.maxTokens` in the session's own `session.json`"*.
 *
 * **The archive assertion is the one worth reading twice.** The route has
 * accepted `{ archived }` since P2 and `renameSession` has been calling that
 * very route with `{ name }` the whole time. Nothing was missing but a field on
 * a request the client already made.
 */

const SESSION_ID = 'session-1';

const setSessionPreset = vi.fn();
const setSessionArchived = vi.fn();
const deleteSession = vi.fn();
const navigate = vi.fn();

let session: Record<string, unknown> = {};

vi.mock('../api.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api.js')>()),
  setSessionPreset: (...a: unknown[]) => setSessionPreset(...a) as unknown,
  setSessionArchived: (...a: unknown[]) => setSessionArchived(...a) as unknown,
  deleteSession: (...a: unknown[]) => deleteSession(...a) as unknown,
  readSession: () => Promise.resolve({ session }),
  api: { listLibrary: () => Promise.resolve({ objects: [] }) },
}));

vi.mock('@tanstack/react-router', () => ({ useNavigate: () => navigate }));

const { SessionPanel } = await import('./SessionPanel.js');

function renderPanel(): void {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <SessionPanel sessionId={SESSION_ID} />
    </QueryClientProvider>,
  );
}

async function open(): Promise<ReturnType<typeof userEvent.setup>> {
  const user = userEvent.setup();
  await user.click(await screen.findByText(/Prompted with|How this session is prompted/));
  return user;
}

beforeEach(() => {
  vi.clearAllMocks();
  setSessionPreset.mockResolvedValue({ session: {} });
  setSessionArchived.mockResolvedValue({ session: {} });
  deleteSession.mockResolvedValue(undefined);
  session = {
    id: SESSION_ID,
    name: 'The Ashfall Road',
    preset: { id: 'p1', name: 'Scene', params: { temperature: 0.8 } },
  };
});

describe('what a session is prompted with', () => {
  it('names the pack in the summary, without being opened', async () => {
    renderPanel();

    expect(await screen.findByText('Prompted with Scene')).toBeTruthy();
  });

  /**
   * C3, without a text editor. The assertion is on the sent body because the
   * route takes the pack whole — the panel edits the session's own copy, which
   * [P7B §1.1] says is the same operation as switching to a pack of one.
   */
  it('sets maxTokens, which the walk sheet says to hand-edit on disk', async () => {
    renderPanel();
    const user = await open();

    // One character, deliberately. The control is fed from the session query
    // and the fixture never changes, so the value does not round-trip here the
    // way it does against a real server — typing two digits would send `1` and
    // then `0`, which is an artefact of the stub rather than of the panel.
    await user.type(screen.getByLabelText(/Maximum reply length/), '9');

    expect(setSessionPreset).toHaveBeenCalled();
    const [, body] = setSessionPreset.mock.calls.at(-1) as [
      string,
      { preset: Record<string, unknown> },
    ];
    expect((body.preset['params'] as Record<string, unknown>)['maxTokens']).toBe(9);
    // Untouched fields ride through: the route takes the whole pack, so a panel
    // that rebuilt it from its own two controls would silently drop the rest.
    expect((body.preset['params'] as Record<string, unknown>)['temperature']).toBe(0.8);
    expect(body.preset['name']).toBe('Scene');
  });

  it('archives through the field the client was already able to send', async () => {
    renderPanel();
    const user = await open();

    await user.click(screen.getByRole('button', { name: 'Archive this session' }));

    expect(setSessionArchived).toHaveBeenCalledWith(SESSION_ID, true);
  });

  it('offers to take an archived one back out', async () => {
    session = { ...session, archivedAt: '2026-09-01T00:00:00.000Z' };
    renderPanel();
    const user = await open();

    expect(screen.getByRole('button', { name: 'Take out of the archive' })).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Take out of the archive' }));
    expect(setSessionArchived).toHaveBeenCalledWith(SESSION_ID, false);
  });

  it('asks before deleting, and says where it goes rather than that it is gone', async () => {
    renderPanel();
    const user = await open();

    await user.click(screen.getByRole('button', { name: 'Delete this session' }));
    expect(deleteSession).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Move it to trash' }));
    expect(deleteSession).toHaveBeenCalledWith(SESSION_ID);
  });
});
