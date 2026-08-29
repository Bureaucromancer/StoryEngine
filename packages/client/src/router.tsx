// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { createRootRoute, createRoute, createRouter, redirect } from '@tanstack/react-router';
import type { JSX } from 'react';

import { isLibraryKind, type LibraryKind } from './api.js';
import { ComparePage } from './compare/ComparePage.js';
import { ActorEditorPage } from './editor/ActorEditorPage.js';
import { LibraryPage } from './library/LibraryPage.js';
import { ObjectDetailPage } from './library/ObjectDetailPage.js';
import { PlayPage } from './play/PlayPage.js';
import { SettingsPage } from './settings/SettingsPage.js';
import { SessionsPage } from './play/SessionsPage.js';
import { Shell } from './Shell.js';
import { Alert } from './ui/Alert.js';

/**
 * Two surfaces and their pages: Library at `/library`, Play at `/play`, plus the
 * detail view, the actor editor and settings
 * ([05 §2](../../../docs/design/05-ui-surfaces.md)). The kind filter is a search
 * param on the list, so a filtered library is an address like any other. The
 * editor's path is actor-specific because the editor is — the other five kinds
 * stay read-only in P1
 * ([P1 §P1.7](../../../docs/design/workplan/03-p1-implementation.md)).
 *
 * Code-based rather than file-based routing — at this size the generator would
 * be more machinery than route.
 */

export interface LibrarySearch {
  kind?: LibraryKind;
}

/**
 * The two turns a comparison is over — [P3.6].
 *
 * Both optional, and dropped rather than rejected when malformed, the same
 * way `kind` and `source` are: a truncated paste still means something (this
 * session, no pair yet) and the page says what it is missing. Rejecting would
 * turn a half-copied link into an error card.
 */
export interface CompareSearch {
  before?: string;
  after?: string;
}

/** Which copy of a duplicated id the detail page is showing (F19). */
export interface ObjectSearch {
  slug?: string;
  source?: 'user' | 'system';
}

const rootRoute = createRootRoute({ component: Shell });

/**
 * The library lives at `/library`, not at `/`.
 *
 * `/` is the eventual home ([05 §2.2](../../../docs/design/05-ui-surfaces.md)) —
 * resume, start, notice, recent work — and the library is explicitly *not* the
 * answer to arrival. Moving it now, before home exists, means the address is
 * right from the start and `/` is free to become home without breaking a link
 * anyone has already saved.
 */
const libraryRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/library',
  // An unknown kind in the URL is dropped rather than rejected: the unfiltered
  // list is a sensible reading of every address.
  validateSearch: (search: Record<string, unknown>): LibrarySearch =>
    isLibraryKind(search['kind']) ? { kind: search['kind'] } : {},
  component: LibraryPage,
});

/**
 * `/` redirects until home is built. Not a component rendering the library —
 * that would leave two addresses for one page and make *which* of them is
 * canonical a thing to remember. One redirect, and every link resolves to the
 * address that will still be correct after home lands.
 */
const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  beforeLoad: () => {
    throw redirect({ to: '/library', search: {} });
  },
});

const sessionsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/play',
  component: SessionsPage,
});

/**
 * The play surface. The session id is the whole address — a reload lands here
 * and the stream's snapshot supplies everything else, which is what makes
 * reattach a request rather than a race.
 */
const playRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/play/$sessionId',
  component: function Play() {
    const { sessionId } = playRoute.useParams();
    return <PlayPage sessionId={sessionId} />;
  },
});

/**
 * One route for the whole settings surface — [P2A §3].
 *
 * Not `/settings/account` and `/settings/admin`: two halves of one page, and a
 * non-admin's half is the whole page for them. Splitting would make the
 * navigation entry a question ("which one?") that has no good answer for the
 * person who only has one.
 */
const settingsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/settings',
  component: SettingsPage,
});

const objectRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/library/$kind/$id',
  /**
   * `?source=&slug=` names *one copy* of a duplicated id (F19).
   *
   * Dropped rather than rejected when malformed, the same way the library's
   * `kind` is: without it the address still means something — the winning copy
   * — and a broken link should land somewhere real rather than on an error.
   */
  validateSearch: (search: Record<string, unknown>): ObjectSearch => ({
    ...(typeof search['slug'] === 'string' ? { slug: search['slug'] } : {}),
    ...(search['source'] === 'user' || search['source'] === 'system'
      ? { source: search['source'] }
      : {}),
  }),
  component: ObjectDetailPage,
});

/**
 * The comparison — the one full view this phase adds, and the reason it is a
 * view rather than a panel is in the address: [P3 §7.2] re-grounds [05 §3]'s
 * escalation on **addressability**, and a bookmarkable pair of turn ids is
 * exactly what a panel scoped to the main view cannot be.
 *
 * A sibling of Play rather than a child: the tree here is flat, and `PlayPage`
 * renders no outlet to nest into.
 */
const compareRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/compare/$sessionId',
  validateSearch: (search: Record<string, unknown>): CompareSearch => ({
    ...(typeof search['before'] === 'string' ? { before: search['before'] } : {}),
    ...(typeof search['after'] === 'string' ? { after: search['after'] } : {}),
  }),
  component: function Compare() {
    const { sessionId } = compareRoute.useParams();
    return <ComparePage sessionId={sessionId} pair={compareRoute.useSearch()} />;
  },
});

const actorEditorRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/library/actors/$id/edit',
  component: ActorEditorPage,
});

const routeTree = rootRoute.addChildren([
  indexRoute,
  libraryRoute,
  objectRoute,
  actorEditorRoute,
  sessionsRoute,
  playRoute,
  compareRoute,
  settingsRoute,
]);

/**
 * The last line of defence for a render throw — without it a bad object is a
 * white screen, in an app whose storage design *invites* hand-edited input.
 * The router's own boundary rather than a hand-rolled class component: it
 * renders inside the Shell's outlet (header and navigation stay usable) and it
 * resets on navigation, which a hand-rolled boundary forgets to.
 */
function RouteErrorCard(props: { error: unknown }): JSX.Element {
  const message = props.error instanceof Error ? props.error.message : String(props.error);
  return (
    <Alert tone="error" role="alert">
      <p className="mb-2 font-medium">This page could not be rendered.</p>
      <p className="mb-2">{message}</p>
      <p>
        <a href="/library" className="underline">
          Back to the library
        </a>
      </p>
    </Alert>
  );
}

export const router = createRouter({
  routeTree,
  defaultErrorComponent: RouteErrorCard,
});

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}
