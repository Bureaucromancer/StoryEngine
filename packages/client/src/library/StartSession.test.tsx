// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactElement } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * ***The two straight-in doors, asked before they start what this install
 * cannot fully play*** — 2026-10-13, the owner's answer to *"Build the
 * promise, or narrow the notes"*: build it.
 *
 * A Setup's page (`StartSession`) and a World's (`StartInWorld`) send their
 * one request and go straight into the session. When the route answers
 * `unmet-requirements` — the Setup's mode is not installed, the World asks for
 * a model nobody set — each now shows the list in a dialog, in plain words,
 * with what *anyway* means for each item. **Start anyway** sends the same
 * request with `degraded: true`; **Cancel** sends nothing. Any other refusal
 * is said as before.
 */

const createSession = vi.fn();

vi.mock('../api.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../api.js')>();
  return {
    ...actual,
    createSession: (...a: unknown[]) => createSession(...a) as unknown,
  };
});

const navigate = vi.fn();

vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => navigate,
  Link: ({ children }: { children: React.ReactNode }) => <a href="#">{children}</a>,
}));

const { StartInWorld, StartSession } = await import('./StartSession.js');
const { ApiError } = await import('../api.js');

function unmet(list: unknown[]): Error {
  return new ApiError(
    422,
    'unmet-requirements',
    'This needs something this install does not have.',
    undefined,
    undefined,
    undefined,
    undefined,
    list as never,
  );
}

function renderDoor(door: ReactElement): void {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={client}>{door}</QueryClientProvider>);
}

beforeEach(() => {
  vi.clearAllMocks();
  createSession.mockResolvedValue({ session: { id: 'new-1', name: '' } });
});

describe('starting in a world that wants what this install lacks', () => {
  it('lists it in a dialog, and Start anyway sends the same request with degraded', async () => {
    createSession.mockRejectedValueOnce(
      unmet([
        { kind: 'mode', id: 'storyengine.campaign', installed: null, substituted: true },
        { kind: 'capability', id: 'image', checkable: true },
        { kind: 'capability', id: 'audio', checkable: false },
        { kind: 'extension', id: 'dice', minVersion: '0.1.0' },
      ]),
    );
    renderDoor(<StartInWorld worldId="w-rain" />);

    await userEvent.click(screen.getByRole('button', { name: 'Start a session in this world' }));
    const dialog = await screen.findByRole('alertdialog');
    const items = within(dialog)
      .getAllByRole('listitem')
      .map((one) => one.textContent);
    // Each item says what is missing and what *anyway* means for it.
    expect(items[0]).toMatch(/storyengine\.campaign mode.*default mode instead/);
    expect(items[1]).toMatch(/Making images.*not set for you/);
    expect(items[2]).toMatch(/audio.*cannot check/);
    expect(items[3]).toMatch(/dice extension.*loads no extensions/);
    // The server's English is never the sentence.
    expect(screen.queryByText(/This needs something this install does not have\./)).toBeNull();

    await userEvent.click(within(dialog).getByRole('button', { name: 'Start anyway' }));

    await waitFor(() => {
      expect(navigate).toHaveBeenCalledWith({
        to: '/play/$sessionId',
        params: { sessionId: 'new-1' },
      });
    });
    expect(createSession.mock.calls).toEqual([
      [{ world: 'w-rain' }],
      [{ world: 'w-rain', degraded: true }],
    ]);
  });
});

describe('starting from a setup for a mode this install lacks', () => {
  /**
   * ***The door most likely to meet a missing mode*** (2026-10-13, the review
   * of *build the promise*): a Setup's page sends `setup` alone, and the
   * route's answer is the Setup's own mode, substituted. Without `degraded`
   * on the retry, Start anyway would send the same request, meet the same
   * refusal, and reopen the same dialog for as long as anyone kept pressing it.
   */
  it('lists it in a dialog, and Start anyway sends the same request with degraded', async () => {
    createSession.mockRejectedValueOnce(
      unmet([{ kind: 'mode', id: 'storyengine.campaign', installed: null, substituted: true }]),
    );
    renderDoor(<StartSession setupId="setup-1" />);

    await userEvent.click(screen.getByRole('button', { name: 'Start a session' }));
    const dialog = await screen.findByRole('alertdialog');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Start anyway' }));

    await waitFor(() => {
      expect(navigate).toHaveBeenCalledWith({
        to: '/play/$sessionId',
        params: { sessionId: 'new-1' },
      });
    });
    expect(createSession.mock.calls).toEqual([
      [{ setup: 'setup-1' }],
      [{ setup: 'setup-1', degraded: true }],
    ]);
  });

  it('sends nothing more when the dialog is cancelled', async () => {
    createSession.mockRejectedValueOnce(
      unmet([{ kind: 'mode', id: 'storyengine.campaign', installed: null, substituted: true }]),
    );
    renderDoor(<StartSession setupId="setup-1" />);

    await userEvent.click(screen.getByRole('button', { name: 'Start a session' }));
    const dialog = await screen.findByRole('alertdialog');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));

    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(createSession).toHaveBeenCalledTimes(1);
    expect(navigate).not.toHaveBeenCalled();
  });

  it('still says any other refusal as it did, with no dialog', async () => {
    createSession.mockRejectedValueOnce(new ApiError(422, 'unknown-setup', 'No such setup.'));
    renderDoor(<StartSession setupId="setup-1" />);

    await userEvent.click(screen.getByRole('button', { name: 'Start a session' }));

    expect((await screen.findByRole('alert')).textContent).toContain('No such setup.');
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });
});
