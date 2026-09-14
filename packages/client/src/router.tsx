// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { createRootRoute, createRoute, createRouter, redirect } from '@tanstack/react-router';
import type { JSX } from 'react';

import { isLibraryKind, type LibraryKind } from './api.js';
import { ComparePage } from './compare/ComparePage.js';
import { ActorEditorPage, NewActorPage } from './editor/ActorEditorPage.js';
import { LorebookEditorPage, NewLorebookPage } from './editor/LorebookEditorPage.js';
import { NewPresetPage, PresetEditorPage } from './editor/PresetEditorPage.js';
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
 * ([10 §2](../../../docs/design/10-ui-surfaces.md)). The kind filter is a search
 * param on the list, so a filtered library is an address like any other. The
 * editor's path is actor-specific because the editor is — the other five kinds
 * stay read-only in P1
 * ([P1 §P1.7](../../../docs/design/workplan/07-p1-implementation.md)).
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

/**
 * Which copy of a duplicated id the detail page is showing (F19), and — for a
 * lorebook — which entry inside it is in focus
 * ([10 §5.3](../../../docs/design/10-ui-surfaces.md)).
 *
 * **The bag now carries two different jobs, and §5.3 asks for this sentence
 * where it is read**: `slug` and `source` say *which copy of the object*, and
 * `entry` says *which part of that object*. They are not three
 * disambiguators — a reader who parses `entry` as a third way of choosing
 * between duplicate files will be wrong, and wrong quietly.
 */
export interface ObjectSearch {
  slug?: string;
  source?: 'user' | 'system';
  entry?: string;
}

/**
 * **Dropped rather than rejected**, which is this router's posture everywhere
 * and is a decision rather than leniency: a half-copied link still means
 * something — *this object, no particular copy, no particular entry* — and the
 * page it lands on is real. Rejecting would route a truncated paste to
 * `RouteErrorCard`, which is the wrong answer to a link somebody was trying to
 * follow.
 *
 * `entry` is validated only as *a string*. Whether the book still contains it
 * is the page's question, not the router's, and the answer there is the same
 * shrug: an entry id "is unique within one book and carries no meaning beyond
 * it" ([04 §5.2]) and an importer may renumber freely, so a saved link
 * outliving its entry is the expected end of one.
 *
 * Named and exported so it can be tested as the contract it is. Inline in the
 * route it was reachable only by driving the router, and `router.test.tsx` had
 * never asserted a search param at all.
 */
export function validateObjectSearch(search: Record<string, unknown>): ObjectSearch {
  return {
    ...(typeof search['slug'] === 'string' ? { slug: search['slug'] } : {}),
    ...(search['source'] === 'user' || search['source'] === 'system'
      ? { source: search['source'] }
      : {}),
    ...(typeof search['entry'] === 'string' ? { entry: search['entry'] } : {}),
  };
}

const rootRoute = createRootRoute({ component: Shell });

/**
 * The library lives at `/library`, not at `/`.
 *
 * `/` is the eventual home ([10 §2.2](../../../docs/design/10-ui-surfaces.md)) —
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
  validateSearch: validateObjectSearch,
  component: ObjectDetailPage,
});

/**
 * The comparison — the one full view this phase adds, and the reason it is a
 * view rather than a panel is in the address: [P3 §7.2] re-grounds [10 §3]'s
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

/**
 * A new actor, before it exists — [polish §10].
 *
 * **Three segments, the same shape as `/library/$kind/$id`**, and the reason
 * this is safe rather than lucky is that the router ranks a static segment
 * above a dynamic one: `actors` and `new` are both literal here, so this wins
 * over the read route's `$kind`/`$id` for exactly this address and nothing
 * else. It is asserted in `router.test.tsx` rather than trusted, because the
 * failure — *New actor* opening the read page for an object that does not
 * exist — would be a 404 blamed on the server.
 */
const newActorRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/library/actors/new',
  component: NewActorPage,
});

/**
 * The lorebook editor's address — [P5.1], and the second entry in
 * `EDITOR_ROUTES`.
 *
 * **`?entry=` and nothing else.** [10 §5.3] asks that the read view's edit
 * affordance be *"a link into the editor at the entry's address"*, so the write
 * surface has to be able to hold one — and the read route's `?source=` and
 * `?slug=` deliberately do **not** come with it, because every write resolves
 * an id to the winning copy (`packages/server/src/library.ts` says so twice)
 * and an edit address naming a losing one would be a URL the server ignores.
 *
 * Every field optional, which is a typing fact as well as a posture: the detail
 * page's Edit link is one `<Link to={editorRoute}>` shared by every kind and it
 * passes no `search` at all, so a required field here would stop that link
 * compiling for actors too.
 */
export interface EditorSearch {
  entry?: string;
}

/** Dropped rather than rejected, exactly as [validateObjectSearch] is. */
export function validateEditorSearch(search: Record<string, unknown>): EditorSearch {
  return { ...(typeof search['entry'] === 'string' ? { entry: search['entry'] } : {}) };
}

const lorebookEditorRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/library/lorebooks/$id/edit',
  validateSearch: validateEditorSearch,
  component: LorebookEditorPage,
});

/** A new lorebook, before it exists — `newActorRoute`'s twin. */
const newLorebookRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/library/lorebooks/new',
  component: NewLorebookPage,
});

/**
 * The preset editor's address — [P7B.1], and the third entry in
 * `EDITOR_ROUTES`.
 *
 * ***The address six phase documents pointed at and none created.*** [P2 §5]
 * onward each sent the preset editor to the next phase; `SlotSource.outlet` has
 * been settable only by hand-writing JSON since P5 because this route did not
 * exist. No search params: a preset has no sub-object with an address of its
 * own the way a lorebook entry does — a block is addressed by its position in
 * one list on one page.
 */
const presetEditorRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/library/presets/$id/edit',
  component: PresetEditorPage,
});

/** A new preset — and unlike the other two, it starts from a shipped pack ([P7B §1.3]). */
const newPresetRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/library/presets/new',
  component: NewPresetPage,
});

const routeTree = rootRoute.addChildren([
  indexRoute,
  libraryRoute,
  objectRoute,
  actorEditorRoute,
  newActorRoute,
  lorebookEditorRoute,
  newLorebookRoute,
  presetEditorRoute,
  newPresetRoute,
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
