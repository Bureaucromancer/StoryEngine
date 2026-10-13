// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * ***The administration half on its way, and failing to arrive, through the
 * real factory*** — 2026-10-13,
 * [21 §7.5](../../../../docs/design/21-client-loading.md).
 *
 * `SettingsPage.test.tsx` renders the page through the real chunk, so it
 * proves the half *arrives*, and it holds the boundary's two sentences apart by
 * throwing at the boundary directly. This file holds what only the split
 * added: the sentence while the chunk is on its way, and the one line that
 * makes a `AdministrationChunkError` — the `lazy()` factory's rejection
 * handler — run against a load that fails as a browser reports it: **an
 * upgrade under an open tab** ([21 §5]), the chunk an old tab knows by name
 * gone from the server. That has to cost the page its administration half and
 * nothing else.
 *
 * *Its own file* for the reason `home/HomePage.load.test.tsx` gives: a
 * `vi.mock` holds for every test in a file, and the page's other tests need the
 * half to load. The mock waits on a gate before it throws, so the waiting
 * state can be looked at first.
 *
 * *What this cannot prove is that the half is off the entry*: a mocked module
 * is a module however it is imported ([21 §6]). `tools/entry-budget.test.ts`
 * asks that of the build.
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

vi.mock('./Administration.js', async () => {
  await gate.opened;
  // What a browser says when the chunk an old tab knows by name is gone.
  throw new TypeError('Failed to fetch dynamically imported module: /assets/Administration-old.js');
});

/**
 * ***Every read but the account's never answers***, so each section of the
 * user half stays at its own *Loading…* and draws no alert of its own — the
 * one alert on the page is then the boundary's, and nothing here depends on
 * what any of them would have shown.
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

vi.mock('@tanstack/react-router', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tanstack/react-router')>()),
  useLocation: (options?: { select?: (location: { hash: string }) => unknown }) =>
    options?.select === undefined ? { hash: '' } : options.select({ hash: '' }),
}));

const { SettingsPage } = await import('./SettingsPage.js');

afterEach(() => {
  vi.restoreAllMocks();
});

describe('loading the administration half', () => {
  it('says it is loading, and a chunk that never arrives leaves the rest of the page standing', async () => {
    // React reports an error a boundary caught; expected here.
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    render(
      <QueryClientProvider client={new QueryClient()}>
        <SettingsPage />
      </QueryClientProvider>,
    );

    // On its way: the half's heading is the page's, drawn with the role, and
    // the sentence under it says what is coming.
    expect(await screen.findByRole('heading', { name: 'Administration' })).toBeTruthy();
    expect((await screen.findByRole('status')).textContent).toBe(
      'Loading the administration settings…',
    );

    gate.open();

    // Never arrived: said under the half's heading, with the advice that
    // answers it, and the user half — its anchors and its sections — untouched.
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toMatch(/could not be loaded.*reload the page/);
    expect(alert.textContent).not.toContain('stopped with an error');
    expect(screen.getByRole('heading', { name: 'Administration' })).toBeTruthy();
    expect(screen.getByRole('heading', { level: 1, name: 'Settings' })).toBeTruthy();
    expect(document.getElementById('you-section')).not.toBeNull();
    expect(document.getElementById('backups-section')).not.toBeNull();
    expect(document.getElementById('accounts-section')).toBeNull();
    expect(screen.queryByText('Loading the administration settings…')).toBeNull();
  });
});
