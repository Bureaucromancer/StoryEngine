// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { createRootRoute, createRoute, createRouter } from '@tanstack/react-router';
import type { JSX } from 'react';

import { isLibraryKind, type LibraryKind } from './api.js';
import { ActorEditorPage } from './editor/ActorEditorPage.js';
import { LibraryPage } from './library/LibraryPage.js';
import { ObjectDetailPage } from './library/ObjectDetailPage.js';
import { PlayPage } from './play/PlayPage.js';
import { SessionsPage } from './play/SessionsPage.js';
import { Shell } from './Shell.js';

/**
 * Three routes: the list, the detail view, and the actor editor. The kind
 * filter is a search param on the list, so a filtered library is an address
 * like any other. The editor's path is actor-specific because the editor is —
 * the other five kinds stay read-only in P1
 * ([P1 §P1.7](../../../docs/design/workplan/03-p1-implementation.md)).
 *
 * Code-based rather than file-based routing — at three routes the generator
 * would be more machinery than route.
 */

export interface LibrarySearch {
  kind?: LibraryKind;
}

/** Which copy of a duplicated id the detail page is showing (F19). */
export interface ObjectSearch {
  slug?: string;
  source?: 'user' | 'system';
}

const rootRoute = createRootRoute({ component: Shell });

const libraryRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  // An unknown kind in the URL is dropped rather than rejected: the unfiltered
  // list is a sensible reading of every address.
  validateSearch: (search: Record<string, unknown>): LibrarySearch =>
    isLibraryKind(search['kind']) ? { kind: search['kind'] } : {},
  component: LibraryPage,
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

const actorEditorRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/library/actors/$id/edit',
  component: ActorEditorPage,
});

const routeTree = rootRoute.addChildren([
  libraryRoute,
  objectRoute,
  actorEditorRoute,
  sessionsRoute,
  playRoute,
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
    <div
      role="alert"
      className="rounded-md border border-red-300 bg-red-50 p-4 text-sm text-red-900"
    >
      <p className="mb-2 font-medium">This page could not be rendered.</p>
      <p className="mb-2">{message}</p>
      <p>
        <a href="/" className="underline">
          Back to the library
        </a>
      </p>
    </div>
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
