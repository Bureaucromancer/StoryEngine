// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { Link, Outlet } from '@tanstack/react-router';
import type { JSX } from 'react';

import { useAuthState, useLogout } from './queries.js';

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
      <main className="mx-auto max-w-4xl px-6 py-8">
        <Outlet />
      </main>
    </div>
  );
}
