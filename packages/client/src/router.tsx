// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { createRootRoute, createRoute, createRouter } from '@tanstack/react-router';

import { isLibraryKind, type LibraryKind } from './api.js';
import { LibraryPage } from './library/LibraryPage.js';
import { ObjectDetailPage } from './library/ObjectDetailPage.js';
import { Shell } from './Shell.js';

/**
 * Two routes: the list and the detail view. The kind filter is a search param
 * on the list, so a filtered library is an address like any other.
 *
 * Code-based rather than file-based routing — at two routes the generator would
 * be more machinery than route.
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

const routeTree = rootRoute.addChildren([libraryRoute, objectRoute]);

export const router = createRouter({ routeTree });

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}
