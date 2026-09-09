// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from '@tanstack/react-router';
import { act, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { newActor } from '@storyengine/shared';

import type { Account, TurnRecord } from './api.js';

/**
 * One main view — [P3.−1](../../../docs/design/workplan/05-p3-implementation.md).
 *
 * The audit found four `<main>` elements in the routed app: the shell's, and a
 * second one nested inside it on Play, Sessions and Settings — with no
 * `jsx-a11y` plugin installed, so nothing but this file notices a page growing
 * its own landmark back. The claim is scoped to the routed app on purpose: the
 * pre-auth gate renders three more `<main>`s before the router mounts
 * (`App.tsx`, `auth/forms.tsx`), they are not nested in anything, and they are
 * not this claim's problem.
 *
 * The **real** router is mounted, because the claim quantifies over routes and
 * a stubbed `Outlet` would test one hand-picked page. That brings the
 * singleton-router caveat with it (`ActorEditorPage.test.tsx` documents it):
 * the URL a test leaves behind is the URL the next one mounts, so every test
 * navigates explicitly before asserting.
 *
 * What jsdom cannot see, stated rather than implied: it computes no layout, so
 * these tests prove landmark structure and that mechanisms fire — not that the
 * transcript actually scrolls under a fixed header. That proof is the manual
 * browser pass in the stage's checklist.
 *
 * The falsifying mutation: re-promote any page's root `<div>` to `<main>` and
 * that route's step counts two.
 */

const ACCOUNT: Account = {
  handle: 'ned',
  displayName: 'Ned',
  role: 'user',
  enabled: true,
  locale: null,
  capabilities: { privateConnections: true, fileAccess: 'none', enableExtensions: false },
  createdAt: 0,
};

/**
 * Fixed ids, not fresh ones per test — the singleton router means the previous
 * test's URL is the next test's first render, and a stable id resolves where a
 * fresh one would 404 before the navigation corrects it.
 */
const ACTOR_ID = '01a008de-7e08-70d0-899c-f6869d6b9aeb';
const SESSION_ID = '01a008de-7e08-70d0-899c-f6869d6b9aec';

const ACTOR: Record<string, unknown> = {
  ...(newActor('Vera Solano') as unknown as Record<string, unknown>),
  id: ACTOR_ID,
};

const ENVELOPE = {
  id: ACTOR_ID,
  schema: ACTOR['schema'] as string,
  name: 'Vera Solano',
  slug: 'vera-solano',
  source: 'user' as const,
  contentHash: 'sha256:revision-1',
  shadowed: false,
  object: ACTOR,
};

const SESSION = {
  id: SESSION_ID,
  name: 'The Ashfall Road',
  createdAt: '2026-08-18T10:00:00.000Z',
  updatedAt: '2026-08-18T10:00:00.000Z',
  headTurnId: 'turn-1',
};

// Typed as the real record since [P3.0], so the fixture cannot drift.
const TURN: TurnRecord = {
  id: 'turn-1',
  sessionId: SESSION_ID,
  parentTurnId: null,
  createdAt: '2026-08-18T10:00:00.000Z',
  status: 'complete',
  input: { actorId: null, text: 'I knock twice.', kind: 'action', raw: 'I knock twice.' },
  output: { text: 'The door opens a handspan.' },
  effects: [],
  tape: [],
};

/**
 * `importOriginal` spread rather than a bare factory, so everything no route
 * here touches keeps its real implementation — the same reasoning as
 * `ActorEditorPage.test.tsx`. Static resolved values, no `vi.fn()`s: nothing
 * in this file asserts on calls, only on what the pages render into.
 */
vi.mock('./api.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./api.js')>();
  return {
    ...actual,
    api: {
      ...actual.api,
      authState: () => Promise.resolve({ setupRequired: false, account: ACCOUNT }),
      listLibrary: () => Promise.resolve({ objects: [ENVELOPE] }),
      readObject: () => Promise.resolve(ENVELOPE),
      readMe: () => Promise.resolve({ account: ACCOUNT }),
      readPrefs: () => Promise.resolve({ prefs: {} }),
    },
    listSessions: () => Promise.resolve({ sessions: [SESSION] }),
    readSession: () => Promise.resolve({ session: SESSION, activeJob: null }),
    readTranscript: () => Promise.resolve({ turns: [TURN] }),
  };
});

// PlayPage opens a turn stream on mount; jsdom has no EventSource, and this
// file has nothing to say about streaming.
vi.mock('./play/stream.js', () => ({
  openTurnStream: () => ({ close: () => undefined }),
}));

const { router } = await import('./router.js');

function renderApp(): void {
  // A fresh client per test, never the `queries.ts` singleton — a shared cache
  // would make these assertions depend on file order.
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
}

interface RoutedPage {
  path: string;
  go: () => Promise<unknown>;
  /** Something only this page renders, so the count is taken after the page is really there. */
  marker: () => Promise<unknown>;
}

const PAGES: RoutedPage[] = [
  {
    path: '/library',
    go: () => router.navigate({ to: '/library', search: {} }),
    marker: () => screen.findByRole('heading', { name: 'Library', level: 1 }),
  },
  {
    path: '/library/$kind/$id',
    go: () =>
      router.navigate({
        to: '/library/$kind/$id',
        params: { kind: 'actors', id: ACTOR_ID },
        search: {},
      }),
    marker: () => screen.findByRole('heading', { name: 'Vera Solano', level: 1 }),
  },
  {
    path: '/play',
    go: () => router.navigate({ to: '/play' }),
    marker: () => screen.findByRole('heading', { name: 'Sessions', level: 1 }),
  },
  {
    path: '/play/$sessionId',
    go: () => router.navigate({ to: '/play/$sessionId', params: { sessionId: SESSION_ID } }),
    marker: () => screen.findByRole('heading', { name: 'The Ashfall Road', level: 1 }),
  },
  {
    path: '/settings',
    go: () => router.navigate({ to: '/settings' }),
    marker: () => screen.findByRole('heading', { name: 'Settings', level: 1 }),
  },
];

describe('one main view', () => {
  it('keeps exactly one main landmark on every routed page', async () => {
    renderApp();

    for (const page of PAGES) {
      await act(async () => {
        await page.go();
      });
      await page.marker();
      // The count travels with the path so a failure names the page that grew
      // a landmark, not just "expected 1".
      expect({ path: page.path, mains: document.querySelectorAll('main').length }).toEqual({
        path: page.path,
        mains: 1,
      });
    }
  });

  /**
   * The scroll reset — the replacement for the two native mechanisms that
   * stopped applying when `<main>` became the scroller: the browser restored
   * the *document*'s position, and the router's default reset targets the
   * window (Shell.tsx carries the whole reasoning). jsdom computes no layout,
   * so this proves the mechanism fires on a path change — not that anything
   * visually scrolls, which is the manual pass's job.
   *
   * The falsifying mutation: delete the pathname effect in `Shell.tsx` and the
   * hand-set offset survives the navigation.
   */
  it('returns main to the top when the path changes', async () => {
    renderApp();
    await act(async () => {
      await router.navigate({ to: '/library', search: {} });
    });
    await screen.findByRole('heading', { name: 'Library', level: 1 });

    const main = document.querySelector('main');
    if (main === null) throw new Error('the shell rendered no main');
    main.scrollTop = 500;

    await act(async () => {
      await router.navigate({ to: '/settings' });
    });
    await screen.findByRole('heading', { name: 'Settings', level: 1 });

    expect(main.scrollTop).toBe(0);
  });
});
