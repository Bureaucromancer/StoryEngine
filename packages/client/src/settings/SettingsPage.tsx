// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import type { JSX } from 'react';

import { AboutBuild } from '../about/AboutBuild.js';
import { UpdateBadge } from '../about/UpdateBadge.js';
import { useAuthState } from '../queries.js';
import { page } from '../ui/classes.js';
import { AdminAccounts } from './AdminAccounts.js';
import { AdminConnections, MyConnections } from './Connections.js';
import { AdminInstall } from './AdminInstall.js';
import { MyRoles } from './MyRoles.js';
import { NotificationPrefs } from './NotificationPrefs.js';
import { Preferences } from './Preferences.js';
import { UserSettings } from './UserSettings.js';

/**
 * One route, two halves — [10 §15](../../../../docs/design/10-ui-surfaces.md),
 * [P2A §3](../../../../docs/design/workplan/09-p2a-configuration-surface.md) stage P2A.6.
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
 * UI-level check is a trivial bypass, which is the same argument [09 §4.5] makes
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
    // chose ([10 §1.2]).
    <div className={`${page.tooling} flex flex-col gap-10`}>
      <h1 className="text-title text-ink">Settings</h1>

      {/* First, because prominence was the ask; for everyone, because the data
          is `auth/state`'s rather than the admin route's — so *absent is
          absent* below is untouched by a version on the page. */}
      <AboutBuild build={auth.data?.build} />
      {/*
        Beneath the build it is about, and **admin-only** — [09 §6.5]: a regular
        user cannot fix the server's networking, and a warning they can only be
        alarmed by is noise. It reads `admin/notices`, so it sits outside the
        `AboutBuild` block above, which is deliberately everyone's.
      */}
      <UpdateBadge isAdmin={account?.role === 'admin'} />

      <UserSettings />

      {/*
        Before Preferences and for every account — [10 §15.1] lists it in the
        user half, and [19 §5.1] is explicit that *"anyone who wants their own
        key overrides a role without the admin's involvement"*. So it is not
        inside the admin conditional, and its query is keyed under `me` rather
        than `admin` so it stays mountable for the people it was written for.
      */}
      <MyRoles />

      <Preferences />

      {/*
        After Preferences and still in the user half — [10 §15.1] and [09 §3.5],
        whose *"one row per class in settings"* is what this section is. A fact
        about one person's ears, so it sits with the theme rather than with the
        install.
      */}
      <NotificationPrefs />

      {/*
        ***Absent when the capability is off***, which is this page's own
        mechanism rather than a new one — [10 §15.1], [P10.3]. A person whose
        `privateConnections` was withdrawn does not get a greyed form whose
        writes the resolver would ignore, and their browser issues no request to
        be refused. The route refuses too, for [09 §4.5]'s reason: a UI-level
        check is a trivial bypass and is never the boundary.
      */}
      {account?.capabilities.privateConnections === true ? <MyConnections /> : null}

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
