// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The restart banner — [04 §6.3](../../../docs/design/04-server-multiuser-deployment.md),
 * [P2A §2.6](../../../docs/design/workplan/13-p2a-configuration-surface.md).
 *
 * It lives in the shell rather than on the settings page because [04 §6.3] wants
 * it on **every** page: the person who needs to know a restart is outstanding is
 * often not the person looking at the form.
 *
 * `pendingRestart()` shipped correct and unreachable at P2 — F8 split the notice
 * from its surface and sent the surface to P10, and the function sat there
 * asserted only by its own test. This is the surface.
 */

const authState = vi.fn();
const notices = vi.fn();

vi.mock('./api.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./api.js')>()),
  api: { authState: (...a: unknown[]) => authState(...a) as unknown, logout: vi.fn() },
  adminApi: { notices: (...a: unknown[]) => notices(...a) as unknown },
}));

vi.mock('@tanstack/react-router', () => ({
  Link: ({ children }: { children: React.ReactNode }) => <a href="#">{children}</a>,
  Outlet: () => <div />,
}));

const { Shell } = await import('./Shell.js');

function account(role: 'admin' | 'user') {
  return {
    handle: 'ned',
    displayName: 'Ned',
    role,
    enabled: true,
    locale: null,
    capabilities: { privateConnections: true, fileAccess: 'none', enableExtensions: false },
    createdAt: 1786800000000,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  notices.mockResolvedValue({ pendingRestart: [], canRestart: false });
});

function renderShell(role: 'admin' | 'user') {
  authState.mockResolvedValue({ setupRequired: false, account: account(role) });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <Shell />
    </QueryClientProvider>,
  );
}

describe('the restart banner', () => {
  it('names the specific keys, because "restart required" invites hoping', async () => {
    notices.mockResolvedValue({ pendingRestart: ['server.port'], canRestart: false });
    renderShell('admin');

    const banner = await screen.findByRole('status');
    expect(banner.textContent).toContain('server.port');
  });

  /**
   * **And says the server will not restart itself.**
   *
   * [04 §6.4] is explicit that under no supervisor a restart control leaves the
   * administrator with no server and possibly no shell, so it needs supervisor
   * detection and a drain, neither of which exists. A notice that invites *"so
   * how do I restart it?"* is a worse answer than one that says.
   */
  it('offers no restart control, and explains that instead', async () => {
    notices.mockResolvedValue({ pendingRestart: ['server.port'], canRestart: false });
    renderShell('admin');

    const banner = await screen.findByRole('status');
    expect(banner.textContent).toContain('does not restart itself');
    expect(screen.queryByRole('button', { name: /restart/i })).toBeNull();
  });

  it('is not there when nothing is pending', async () => {
    renderShell('admin');
    await screen.findByText('Ned');

    // A banner that is always present is one nobody reads.
    expect(screen.queryByRole('status')).toBeNull();
  });

  /**
   * A non-admin's browser does not ask — the same absent-rather-than-disabled
   * mechanism the settings page uses, applied to a query that would otherwise
   * poll every thirty seconds and be refused every time.
   */
  it('asks for nothing when the person is not an admin', async () => {
    notices.mockResolvedValue({ pendingRestart: ['server.port'], canRestart: false });
    renderShell('user');
    await screen.findByText('Ned');

    expect(notices).not.toHaveBeenCalled();
    expect(screen.queryByRole('status')).toBeNull();
  });
});

describe('the navigation', () => {
  it('has one settings entry once somebody is signed in', async () => {
    renderShell('user');

    await waitFor(() => {
      expect(screen.getByText('Settings')).toBeTruthy();
    });
  });
});
