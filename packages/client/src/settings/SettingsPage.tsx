// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import type { JSX } from 'react';

import { useAuthState } from '../queries.js';
import { AdminAccounts } from './AdminAccounts.js';
import { AdminInstall } from './AdminInstall.js';
import { UserSettings } from './UserSettings.js';

/**
 * One route, two halves — [05 §15](../../../../docs/design/05-ui-surfaces.md),
 * [P2A §3](../../../../docs/design/workplan/13-p2a-configuration-surface.md) stage P2A.6.
 *
 * **Absent is implemented as absent**, and that is a mechanism rather than a
 * style choice. The admin sections are not rendered for a non-admin, so their
 * hooks never mount, so that browser issues **no request** to `/api/admin/*` at
 * all — nothing to be refused, nothing in the console, nothing for somebody who
 * has done nothing wrong to read as an error.
 *
 * Disabling them instead would have every non-admin's browser fetch an account
 * list it may not have, be told 403, and render a greyed control that is a
 * promise nobody intends to keep — which is the difference [P2A §2.4] draws and
 * the reason it is directly testable.
 *
 * The guard here is **not** the security boundary. That is `adminOnly` on the
 * `/api/admin` prefix, and it stays the answer for anyone who types the URL: a
 * UI-level check is a trivial bypass, which is the same argument [04 §4.5] makes
 * about capabilities.
 */
export function SettingsPage(): JSX.Element {
  const auth = useAuthState();
  const account = auth.data?.account ?? null;

  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-10 p-6">
      <h1 className="text-xl font-medium">Settings</h1>

      <UserSettings />

      {account?.role === 'admin' ? (
        <section className="flex flex-col gap-8" aria-labelledby="administration">
          <h2 id="administration" className="text-lg font-medium">
            Administration
          </h2>
          <AdminAccounts />
          <AdminInstall />
        </section>
      ) : null}
    </main>
  );
}
