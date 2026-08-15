// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { createRootRoute, createRoute, createRouter } from '@tanstack/react-router';

import { isLibraryKind, type LibraryKind } from './api.js';
import { ActorEditorPage } from './editor/ActorEditorPage.js';
import { LibraryPage } from './library/LibraryPage.js';
import { ObjectDetailPage } from './library/ObjectDetailPage.js';
import { Shell } from './Shell.js';

/**
 * Three routes: the list, the detail view, and the actor editor. The kind
 * filter is a search param on the list, so a filtered library is an address
 * like any other. The editor's path is actor-specific because the editor is —
 * the other five kinds stay read-only in P1
 * ([19 §P1.7](docs/design/19-p1-implementation.md)).
 *
 * Code-based rather than file-based routing — at three routes the generator
 * would be more machinery than route.
 */

export interface LibrarySearch {
  kind?: LibraryKind;
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

const objectRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/library/$kind/$id',
  component: ObjectDetailPage,
});

const actorEditorRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/library/actors/$id/edit',
  component: ActorEditorPage,
});

const routeTree = rootRoute.addChildren([libraryRoute, objectRoute, actorEditorRoute]);

export const router = createRouter({ routeTree });

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}
