// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { Component, lazy, Suspense, type JSX, type ReactNode } from 'react';

import { AboutBuild } from '../about/AboutBuild.js';
import { UpdateBadge } from '../about/UpdateBadge.js';
import { labels } from '../i18n/catalogue.js';
import { useAuthState } from '../queries.js';
import { AlertNote } from '../ui/Alert.js';
import { page } from '../ui/classes.js';
import { Note } from '../ui/Text.js';
import { OpenDockButton } from '../workbench/OpenDockButton.js';
import { Backups } from './Backups.js';
import { MyConnections } from './Connections.js';
import { SettingsAnchor, useJumpToHash } from './contents.js';
import { MyRoles } from './MyRoles.js';
import { NotificationPrefs } from './NotificationPrefs.js';
import { Trash } from './Trash.js';
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
 *
 * ***Every section stands in an anchor, and the workbench lists them***
 * (2026-10-07, [10 §3](../../../../docs/design/10-ui-surfaces.md)). Thirteen
 * sections on one route had made the page a long scroll, and the answer kept
 * §15's one route: the dock shows this page's contents and a row jumps to a
 * section, as the dock lists a changelog's releases over home. The anchors and
 * the list come from one table, [contents.tsx](./contents.tsx), and the jump
 * follows the address's hash, so `/settings#backups-section` lands in the
 * same place from the dock, from a pasted link or after a reload.
 * `SettingsPage.test.tsx` holds the anchors to the list for each kind of
 * account, so a section added here and not there fails.
 *
 * ***The administration half is a chunk of its own*** (2026-10-13,
 * [21 §7.5](../../../../docs/design/21-client-loading.md)) — `Administration.tsx`,
 * reached through the `lazy()` below from inside the one conditional, so the
 * mechanism above holds for the code too: a non-admin's browser never fetches
 * it. What stays here is the half's heading and anchor, the sentence while it
 * is on its way, and {@link AdministrationLoad}, in *the publish review's
 * shape* (`library/publish/PublishRoute.tsx`): the factory wraps the import's
 * rejection in {@link AdministrationChunkError}, and the boundary tells only
 * that failure to reload. *No retry control*, for [21 §7.2]'s reasons — React
 * caches a rejected `lazy` load, and the failure a self-hosted install is
 * likeliest to see is an upgrade under an open tab, which only a reload
 * answers. The user half above it is outside the boundary and stands either
 * way.
 */
export function SettingsPage(): JSX.Element {
  const auth = useAuthState();
  const account = auth.data?.account ?? null;
  useJumpToHash(account?.role);

  return (
    // A `div`, not a landmark — the shell owns the routed app's one `<main>`
    // ([P3.−1]); this page declared a second one inside it. The column is
    // `page.tooling`: the old `max-w-3xl` was the reading measure by numeric
    // coincidence, a third spelling of a width this tooling surface never
    // chose ([10 §1.2]).
    <div className={`${page.tooling} flex flex-col gap-10`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-title text-ink">Settings</h1>
        {/* The page's contents are in the dock, and this points at them —
            `OpenDockButton` says why a page keeps a way to what the dock
            shows over it. */}
        <OpenDockButton>Contents…</OpenDockButton>
      </div>

      {/* First, because prominence was the ask; for everyone, because the data
          is `auth/state`'s rather than the admin route's — so *absent is
          absent* below is untouched by a version on the page. */}
      <SettingsAnchor of="build">
        <AboutBuild build={auth.data?.build} />
        {/*
          Beneath the build it is about, and **admin-only** — [09 §6.5]: a regular
          user cannot fix the server's networking, and a warning they can only be
          alarmed by is noise. It reads `admin/notices`, so it sits outside the
          `AboutBuild` block above, which is deliberately everyone's. Inside the
          build's anchor, because a jump to the build should land on both.
        */}
        <UpdateBadge isAdmin={account?.role === 'admin'} />
      </SettingsAnchor>

      <SettingsAnchor of="you">
        <UserSettings />
      </SettingsAnchor>

      {/*
        Before Preferences and for every account — [10 §15.1] lists it in the
        user half, and [20 §5.1] is explicit that *"anyone who wants their own
        key overrides a role without the admin's involvement"*. So it is not
        inside the admin conditional, and its query is keyed under `me` rather
        than `admin` so it stays mountable for the people it was written for.
      */}
      <SettingsAnchor of="roles">
        <MyRoles />
      </SettingsAnchor>

      <SettingsAnchor of="preferences">
        <Preferences />
      </SettingsAnchor>

      {/*
        After Preferences and still in the user half — [10 §15.1] and [09 §3.5],
        whose *"one row per class in settings"* is what this section is. A fact
        about one person's ears, so it sits with the theme rather than with the
        install.
      */}
      <SettingsAnchor of="notifications">
        <NotificationPrefs />
      </SettingsAnchor>

      {/*
        ***Absent when the capability is off***, which is this page's own
        mechanism rather than a new one — [10 §15.1], [P10.3]. A person whose
        `privateConnections` was withdrawn does not get a greyed form whose
        writes the resolver would ignore, and their browser issues no request to
        be refused. The route refuses too, for [09 §4.5]'s reason: a UI-level
        check is a trivial bypass and is never the boundary.
      */}
      {account?.capabilities.privateConnections === true ? (
        <SettingsAnchor of="myConnections">
          <MyConnections />
        </SettingsAnchor>
      ) : null}

      {/*
        ***The drawer delete has been filling since P4.4*** —
        [03 §10.2](../../../../docs/design/03-data-model.md), [P11.7]. In the
        user half and for every account, because a person's trash is their own:
        it holds their sessions and their objects, and an admin reading it would
        be reading somebody's deleted stories.
      */}
      <SettingsAnchor of="trash">
        <Trash locale={account?.locale ?? undefined} />
      </SettingsAnchor>

      {/**
        ***Beside the trash, and for the trash's reason*** — [26 E6], [P12.6].
        It holds sessions as well as library objects, so a drawer inside the
        library would be a library surface answering about something that is not
        a library object; and nobody comes here to browse.

        **For every account**, because taking a backup of your own work is never
        gated — `scheduledBackups` governs the *server* writing them on a timer,
        which is a different question and is asked inside this panel.
      */}
      <SettingsAnchor of="backups">
        <Backups
          capable={account?.capabilities.scheduledBackups === true}
          locale={account?.locale ?? undefined}
        />
      </SettingsAnchor>

      {account?.role === 'admin' ? (
        <SettingsAnchor of="administration">
          <section className="flex flex-col gap-8" aria-labelledby="administration">
            <h2 id="administration" className="text-section text-ink">
              Administration
            </h2>
            {/*
              The four sections and their anchors arrive with the chunk, as
              children of this column, so the gap between them is the one it
              always was — neither the boundary nor `Suspense` draws an
              element. The comments that sat beside them moved with them, to
              `Administration.tsx`.
            */}
            <AdministrationLoad>
              <Suspense fallback={<Note role="status">{WORDS.loading}</Note>}>
                <LazyAdministration locale={account.locale ?? undefined} />
              </Suspense>
            </AdministrationLoad>
          </section>
        </SettingsAnchor>
      ) : null}
    </div>
  );
}

/** The administration half's code did not arrive — the one failure a reload answers. */
export class AdministrationChunkError extends Error {
  constructor(cause: unknown) {
    super('The administration settings’ code could not be loaded.', { cause });
    this.name = 'AdministrationChunkError';
  }
}

const LazyAdministration = lazy(() =>
  import('./Administration.js').then(
    (module) => ({ default: module.Administration }),
    (cause: unknown) => {
      throw new AdministrationChunkError(cause);
    },
  ),
);

const WORDS = labels('settings.administration', {
  loading: 'Loading the administration settings…',
  chunk:
    'The administration settings could not be loaded. If StoryEngine was updated since this page was opened, reload the page.',
  render:
    'The administration settings stopped with an error, so they cannot be changed from here. Your own settings above are unaffected.',
});

/**
 * ***If the half never arrives, or fails once it has*** — local, under the
 * half's heading, so everything above it stands: [21 §5]'s *a failed inspector
 * should leave the page beside it usable*. Without it the nearest boundary is
 * the router's, which would replace the whole of Settings — a person's own
 * profile and password included — over sections only an administrator has.
 * Exported for its test, which is what holds the two sentences apart.
 */
export class AdministrationLoad extends Component<
  { children: ReactNode },
  { failed: 'chunk' | 'render' | null }
> {
  override state: { failed: 'chunk' | 'render' | null } = { failed: null };

  static getDerivedStateFromError(error: unknown): { failed: 'chunk' | 'render' } {
    return { failed: error instanceof AdministrationChunkError ? 'chunk' : 'render' };
  }

  override render(): ReactNode {
    if (this.state.failed === null) return this.props.children;
    return (
      <AlertNote role="alert">
        {this.state.failed === 'chunk' ? WORDS.chunk : WORDS.render}
      </AlertNote>
    );
  }
}
