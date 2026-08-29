// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import type { JSX } from 'react';

import { useAuthState } from '../queries.js';
import { page } from '../ui/classes.js';
import { AdminAccounts } from './AdminAccounts.js';
import { AdminConnections } from './AdminConnections.js';
import { AdminInstall } from './AdminInstall.js';
import { Preferences } from './Preferences.js';
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
    // A `div`, not a landmark — the shell owns the routed app's one `<main>`
    // ([P3.−1]); this page declared a second one inside it. The column is
    // `page.tooling`: the old `max-w-3xl` was the reading measure by numeric
    // coincidence, a third spelling of a width this tooling surface never
    // chose ([05 §1.2]).
    <div className={`${page.tooling} flex flex-col gap-10`}>
      <h1 className="text-title text-ink">Settings</h1>

      <UserSettings />

      <Preferences />

      {account?.role === 'admin' ? (
        <section className="flex flex-col gap-8" aria-labelledby="administration">
          <h2 id="administration" className="text-section text-ink">
            Administration
          </h2>
          <AdminAccounts />
          {/*
            A third section under Administration rather than a tab or a route of
            its own — [P2B §6]. The admin half is a single conditional, which is
            what makes *absent is absent* a mechanism: these hooks never mount
            for a non-admin, so that browser issues no request that could be
            refused. A separate route would need the guard respelled.
          */}
          <AdminConnections />
          <AdminInstall />
        </section>
      ) : null}
    </div>
  );
}
