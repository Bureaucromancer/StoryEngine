// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

/**
 * ***A link into the administration half, followed before the half is there***
 * — 2026-10-13, [21 §7.5](../../../../docs/design/21-client-loading.md).
 *
 * The half's four sections and their anchors are drawn by its chunk, which
 * arrives after the page has already run its jump to the address's hash for
 * the account's role and found nothing to land on. Nothing would run that jump
 * again — the hash has not changed and neither has the role — so the half asks
 * for it as it is drawn (`useJumpOnArrival`, in `contents.tsx`). Here the chunk
 * is made to arrive late on purpose, behind a gate, so the moment in between
 * can be looked at: the address names a section that does not exist yet, and
 * nothing has been focused. Then the chunk arrives, and the jump lands.
 *
 * *Its own file* for the reason `SettingsPage.load.test.tsx` gives: the gate is
 * a `vi.mock`, which holds for every test in a file. `SettingsPage.test.tsx`
 * holds the hook's rule — its own sections only — with a late part drawn by
 * hand.
 */

const gate = vi.hoisted(() => {
  let open: () => void = () => undefined;
  const opened = new Promise<void>((resolve) => {
    open = resolve;
  });
  return {
    opened,
    open: () => {
      open();
    },
  };
});

vi.mock('./Administration.js', async (importOriginal) => {
  await gate.opened;
  return importOriginal<typeof import('./Administration.js')>();
});

/**
 * ***Every read but the account's never answers***, so every section, the
 * administration half's included, stays at its own *Loading…*: what is
 * looked at here is the anchors, which are the page's and exist before the
 * sections they stand around have anything to show.
 */
vi.mock('../api.js', async (importOriginal) => {
  const waiting = (): Promise<never> => new Promise(() => undefined);
  const silent = new Proxy({}, { get: () => waiting });
  return {
    ...(await importOriginal<typeof import('../api.js')>()),
    readTrash: waiting,
    api: new Proxy(
      {},
      {
        get: (_target, name) =>
          name === 'authState'
            ? () =>
                Promise.resolve({
                  setupRequired: false,
                  minPasswordLength: 8,
                  build: null,
                  account: {
                    handle: 'ned',
                    displayName: 'Ned',
                    role: 'admin',
                    enabled: true,
                    locale: null,
                    capabilities: {
                      privateConnections: true,
                      fileAccess: 'none',
                      enableExtensions: false,
                    },
                    createdAt: 1786800000000,
                  },
                })
            : waiting,
      },
    ),
    adminApi: silent,
    backupApi: silent,
  };
});

/** The address names the install's connections, as a pasted link would. */
vi.mock('@tanstack/react-router', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tanstack/react-router')>()),
  useLocation: (options?: { select?: (location: { hash: string }) => unknown }) => {
    const location = { hash: 'connections-section' };
    return options?.select === undefined ? location : options.select(location);
  },
}));

const { SettingsPage } = await import('./SettingsPage.js');

describe('a link into the administration half', () => {
  it('lands on the section it names once the half has arrived, and not before', async () => {
    render(
      <QueryClientProvider client={new QueryClient()}>
        <SettingsPage />
      </QueryClientProvider>,
    );

    // On its way: the half's heading and the sentence under it, and nothing to
    // land on yet — so nothing has the focus a jump would have handed it.
    expect(await screen.findByRole('heading', { name: 'Administration' })).toBeTruthy();
    expect((await screen.findByRole('status')).textContent).toBe(
      'Loading the administration settings…',
    );
    expect(document.getElementById('connections-section')).toBeNull();
    expect(document.activeElement).toBe(document.body);

    gate.open();

    // Arrived: the section the address named has the focus a jump hands it.
    await waitFor(() => {
      expect(document.activeElement?.id).toBe('connections-section');
    });
    expect(screen.queryByText('Loading the administration settings…')).toBeNull();
  });
});
