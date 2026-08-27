// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
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
const readPrefs = vi.fn();
const patchPrefs = vi.fn();

vi.mock('./api.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./api.js')>()),
  api: {
    authState: (...a: unknown[]) => authState(...a) as unknown,
    logout: vi.fn(),
    readPrefs: (...a: unknown[]) => readPrefs(...a) as unknown,
    // Only the payload reaches the spy: v5 hands `mutationFn` a second
    // context argument, and the tests assert on what would go over the wire.
    patchPrefs: (patch: Record<string, unknown>) => patchPrefs(patch) as unknown,
  },
  adminApi: { notices: (...a: unknown[]) => notices(...a) as unknown },
}));

// The stub keeps `to` as `href` so a navigation test can assert *where* an
// entry goes, not merely that its label is on screen — the whole point of the
// surface nav is the destination. This mock is wholesale, so every router hook
// the Shell grows must be added here or the whole file dies at import —
// `useRouterState` feeds the scroll reset a fixed pathname, and `useMatch`
// answers "not over Play" so an opened dock renders its empty state; the
// subject-follows-route behaviour itself is `workbench/dock.test.tsx`'s, over
// the real router.
vi.mock('@tanstack/react-router', () => ({
  Link: ({ children, to }: { children: React.ReactNode; to?: string }) => (
    <a href={to ?? '#'}>{children}</a>
  ),
  Outlet: () => <div />,
  useRouterState: ({
    select,
  }: {
    select: (state: { location: { pathname: string } }) => unknown;
  }) => select({ location: { pathname: '/library' } }),
  useMatch: () => undefined,
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

/**
 * A tiny stateful prefs store per test, because the workbench's open state
 * now lives there: `readPrefs` answers what was patched, and `patchPrefs`
 * merges with `null` deleting — the same contract the server keeps, without
 * which the optimistic mutation's `onSuccess` would overwrite the cache with
 * something the real server would never have said.
 */
let prefsStore: Record<string, unknown> = {};

beforeEach(() => {
  vi.clearAllMocks();
  notices.mockResolvedValue({ pendingRestart: [], canRestart: false });
  prefsStore = {};
  readPrefs.mockImplementation(() => Promise.resolve({ prefs: { ...prefsStore } }));
  patchPrefs.mockImplementation((patch: Record<string, unknown>) => {
    prefsStore = Object.fromEntries(
      Object.entries({ ...prefsStore, ...patch }).filter(([, value]) => value !== null),
    );
    return Promise.resolve({ prefs: { ...prefsStore } });
  });
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

  /**
   * The two surfaces — [05 §2](../../../docs/design/05-ui-surfaces.md).
   *
   * Asserted by destination rather than by label, because the label is the part
   * that is safe to change and the address is the part that is not.
   */
  it('offers Play and Library, addressed to their surfaces', async () => {
    renderShell('user');

    const play = await screen.findByRole('link', { name: 'Play' });
    const library = await screen.findByRole('link', { name: 'Library' });
    expect(play.getAttribute('href')).toBe('/play');
    expect(library.getAttribute('href')).toBe('/library');
  });

  /**
   * **No workbench entry, and this is the assertion that keeps it that way.**
   * [05 §3] makes the workbench a panel that expands over whichever surface you
   * are in. A nav entry would reintroduce exactly the layout claim §2 dropped,
   * and it is the sort of thing that gets added back by someone who reads the
   * header and not the design.
   */
  it('offers no workbench entry, because it is a panel and not a place', async () => {
    renderShell('user');
    await screen.findByRole('link', { name: 'Library' });

    expect(screen.queryByRole('link', { name: /workbench/i })).toBeNull();
  });

  /**
   * The wordmark is the arrival affordance and becomes home once home exists
   * ([05 §2.2]). Until then it goes to the library — but it is deliberately
   * *not* pointed at `/`, because `/` is the address home will take.
   */
  it('points the wordmark at the library, not at the root', async () => {
    renderShell('user');

    const wordmark = await screen.findByRole('link', { name: 'StoryEngine' });
    expect(wordmark.getAttribute('href')).toBe('/library');
  });

  it('shows no surfaces to somebody who is not signed in', async () => {
    authState.mockResolvedValue({ setupRequired: false, account: null });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <Shell />
      </QueryClientProvider>,
    );

    await screen.findByRole('link', { name: 'StoryEngine' });
    expect(screen.queryByRole('link', { name: 'Play' })).toBeNull();
    expect(screen.queryByRole('link', { name: 'Library' })).toBeNull();
  });
});

/**
 * The visible opener — [P3.1](../../docs/design/workplan/05-p3-implementation.md).
 * The user's requirement is that the onscreen control be as first-class as
 * the chord, so it lives in the header on every page; and it is a *button*,
 * which is what keeps "offers no workbench entry" above green by
 * construction — the panel gains a control without gaining an address.
 */
describe('the workbench opener', () => {
  it('offers the workbench as a control, never as a place', async () => {
    renderShell('user');

    expect(await screen.findByRole('button', { name: 'Workbench' })).toBeTruthy();
    expect(screen.queryByRole('link', { name: /workbench/i })).toBeNull();
  });

  it('announces its state, and the landmark follows it', async () => {
    renderShell('user');

    const opener = await screen.findByRole('button', { name: 'Workbench' });
    expect(opener.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByRole('complementary')).toBeNull();

    await userEvent.click(opener);
    expect(opener.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByRole('complementary')).toBeTruthy();

    await userEvent.click(opener);
    expect(opener.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByRole('complementary')).toBeNull();
  });

  /**
   * The stored shape, pinned the way the theme's is
   * (`SettingsPage.test.tsx`): open is `true`, closed is `null` — a deletion,
   * because closed is the default and the absence *is* the default state
   * ([P3.1a], `workbench/prefs.ts`). A mutation that stored `false` instead
   * would leave a key that means nothing accumulating in everyone's file.
   */
  it('records open as the preference and closed as its absence', async () => {
    renderShell('user');
    const opener = await screen.findByRole('button', { name: 'Workbench' });

    await userEvent.click(opener);
    expect(patchPrefs).toHaveBeenCalledWith({ 'ui.workbench-open': true });

    await userEvent.click(opener);
    expect(patchPrefs).toHaveBeenCalledWith({ 'ui.workbench-open': null });
  });
});
