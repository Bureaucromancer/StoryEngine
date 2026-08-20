// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { Link, Outlet } from '@tanstack/react-router';
import type { JSX } from 'react';

import { useAuthState, useLogout, useNotices } from './queries.js';

/** The signed-in frame: a header with the account and sign-out, and the page. */
export function Shell(): JSX.Element {
  const auth = useAuthState();
  const logout = useLogout();
  const account = auth.data?.account ?? null;

  return (
    <div className="min-h-dvh bg-slate-50 text-slate-900">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-4xl items-center justify-between gap-4 px-6 py-3">
          <Link to="/" search={{}} className="text-lg font-semibold">
            StoryEngine
          </Link>
          {account === null ? null : (
            <div className="flex items-center gap-3">
              {/* One entry, which is all [P2A §3] asks for. */}
              <Link to="/settings" className="text-sm text-slate-700 hover:underline">
                Settings
              </Link>
              <span className="text-sm text-slate-600">{account.displayName}</span>
              <button
                type="button"
                onClick={() => {
                  logout.mutate();
                }}
                disabled={logout.isPending}
                className="rounded-md border border-slate-300 px-3 py-1 text-sm text-slate-700 hover:bg-slate-100"
              >
                Sign out
              </button>
            </div>
          )}
        </div>
      </header>
      {/* **Above the outlet, not on the settings page**, because [04 §6.3] wants
          this on every page: the person who needs to know a restart is
          outstanding is often not the person who is looking at the form. */}
      <RestartBanner isAdmin={account?.role === 'admin'} />
      <main className="mx-auto max-w-4xl px-6 py-8">
        <Outlet />
      </main>
    </div>
  );
}

/**
 * What is waiting for a restart — [04 §6.3](../../../docs/design/04-server-multiuser-deployment.md),
 * [P2A §2.6](../../../docs/design/workplan/13-p2a-configuration-surface.md).
 *
 * **Named changes rather than "restart required"**, because a bare notice
 * invites people to restart and hope — and the list is computed per request
 * from the config this process started with, so undoing a change clears it
 * rather than leaving a banner nobody can dismiss.
 *
 * **And it says the server will not restart itself.** [04 §6.4] is explicit that
 * under no supervisor a restart control leaves the administrator with no server
 * and possibly no shell, so it needs supervisor detection and a drain, neither
 * of which exists. A notice that invites *"so how do I restart it?"* is a worse
 * answer than one that says.
 *
 * The query is disabled for a non-admin, so their browser never asks — the same
 * absent-rather-than-disabled mechanism the settings page uses.
 */
function RestartBanner({ isAdmin }: { isAdmin: boolean }): JSX.Element | null {
  const notices = useNotices(isAdmin);
  const pending = notices.data?.pendingRestart ?? [];
  if (!isAdmin || pending.length === 0) return null;

  return (
    <div role="status" className="border-b border-amber-300 bg-amber-50 px-6 py-2 text-sm">
      <p className="mx-auto max-w-4xl text-amber-900">
        Waiting for a restart: <strong>{pending.join(', ')}</strong>. StoryEngine does not restart
        itself — stop and start the server however you run it, and these will take effect.
      </p>
    </div>
  );
}
