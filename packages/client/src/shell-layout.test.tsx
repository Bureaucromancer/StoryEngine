// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from '@tanstack/react-router';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { newActor } from '@storyengine/shared';

import type { Account, TurnRecord } from './api.js';

/**
 * One main view — [P3.−1](../../../docs/design/workplan/15-p3-implementation.md).
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
  capabilities: {
    privateConnections: true,
    fileAccess: 'none',
    enableExtensions: false,
    scheduledBackups: false,
  },
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
 * The session's mode surfaces, which only the backdrop's test sets — a
 * picture on the stage region, which is what makes Play's column ask
 * `<main>` for the veil. Read when the session is, so a test can set it
 * before it navigates and put it back after.
 */
let surfaces: unknown[] | undefined;

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
    readSession: () =>
      Promise.resolve({
        session: SESSION,
        activeJob: null,
        ...(surfaces === undefined ? {} : { surfaces }),
      }),
    readTranscript: () => Promise.resolve({ turns: [TURN] }),
    readRenditions: () => Promise.resolve({ renditions: [], selection: {} }),
  };
});

// PlayPage opens a turn stream on mount; jsdom has no EventSource, and this
// file has nothing to say about streaming.
vi.mock('./play/stream.js', () => ({
  openTurnStream: () => ({ close: () => undefined }),
}));

const { router } = await import('./router.js');
const { navLink, page } = await import('./ui/classes.js');
const { veiled } = await import('./play/Backdrop.js');
const { applyCatalogue } = await import('./i18n/catalogue.js');
const { MACHINE_FRENCH } = await import('./i18n/fr-x-machine.js');

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
  /*
   * ***The two this list did not visit*** (2026-10-01, polish 11), and both
   * had a `<main>` of their own inside the shell's — found by reading, which
   * is the failure this file exists to replace.
   */
  {
    path: '/search',
    go: () => router.navigate({ to: '/search', search: {} }),
    marker: () => screen.findByRole('heading', { name: 'Search', level: 1 }),
  },
  {
    path: '/read/$sessionId',
    go: () =>
      router.navigate({ to: '/read/$sessionId', params: { sessionId: SESSION_ID }, search: {} }),
    marker: () => screen.findByRole('button', { name: 'Copy as Markdown' }),
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

  /**
   * ***Except to an address that names a place*** (2026-10-07). The page goes
   * there in its own effect, which React runs before this shell's — so a reset
   * keyed on the path alone undid every jump that arrived with a path change.
   * jsdom draws nothing and `scrollIntoView` is a stub here, so what is held is
   * the mechanism: the shell leaves the offset alone, and the page's jump
   * happened (focus is on the section it names).
   *
   * The falsifying mutation: drop the `hash === ''` condition from the reset
   * in `Shell.tsx`, and the offset is zeroed under the jump.
   */
  it('leaves main where an address with a hash put it', async () => {
    renderApp();
    await act(async () => {
      await router.navigate({ to: '/library', search: {} });
    });
    await screen.findByRole('heading', { name: 'Library', level: 1 });

    const main = document.querySelector('main');
    if (main === null) throw new Error('the shell rendered no main');
    main.scrollTop = 500;

    await act(async () => {
      await router.navigate({ to: '/settings', hash: 'trash-section' });
    });
    await screen.findByRole('heading', { name: 'Settings', level: 1 });

    await waitFor(() => {
      expect(document.activeElement?.id).toBe('trash-section');
    });
    expect(main.scrollTop).toBe(500);
  });

  /**
   * ***`main` is the containing block of what its page positions*** — so an
   * `sr-only` label far down a long page is clipped by `main`'s scrolling
   * rather than stretching the document and making the window scroll under
   * the header. jsdom computes no layout, so the class is the whole of what
   * can be held here; the measurement that found it (2,512px of document in a
   * 455px window) is in `Shell.tsx`, beside the class.
   */
  it('makes main the box its page positions against', () => {
    renderApp();

    const main = document.querySelector('main');
    expect(main?.className.split(' ')).toContain('relative');
  });
});

/**
 * ***The backdrop's veil, painted by `main` under Play's column*** (2026-10-13,
 * [P12A](../../../docs/design/workplan/35-p12a-the-look.md) P12A.2, after
 * review). The column first wore the veil itself and scrolled itself to keep
 * it under everything: a second scroller, which slid off its own veil, made
 * `main` scroll as well, and threw the reader's place away whenever a picture
 * came or went. Now the column carries a marker and nothing else, and `main`
 * — still the one scroller — paints a strip of the column's width under it,
 * keyed on the marker being its *direct* child (`Shell.tsx`, `veil`).
 *
 * Held here, on the real router, because the join is between two files that
 * never see each other: the page sets an attribute, the shell names it inside
 * a selector. jsdom applies no stylesheet and lays nothing out, so what can be
 * held is that the two halves meet — the classes on `main`, spelled with the
 * marker the page exports and the width the column is, and the marker on the
 * child the selector reads — not that the strip is drawn, which is T1's look.
 *
 * The falsifying mutations: the strip's classes off `main`, the marker
 * renamed on one side, the marker put on an element inside the column, the
 * column given its `overflow-y-auto` back, and `page.reading` moved off the
 * width the strip is sized to.
 */
describe('the backdrop’s veil', () => {
  const STAGE = {
    region: 'stage',
    key: 'se.backdrop',
    channelId: 'se.backdrop',
    scopeKey: null,
    kind: 'image',
    label: 'Scene',
    image: { url: '/api/library/worlds/w-1/media/m-1', alt: 'Scene' },
  };

  it('is painted by main under the column, which is main’s own child and scrolls with it', async () => {
    surfaces = [STAGE];
    try {
      renderApp();
      await act(async () => {
        await router.navigate({ to: '/play/$sessionId', params: { sessionId: SESSION_ID } });
      });
      await screen.findByRole('heading', { name: 'The Ashfall Road', level: 1 });

      const main = document.querySelector('main');
      if (main === null) throw new Error('the shell rendered no main');
      const [marker] = Object.keys(veiled);
      if (marker === undefined) throw new Error('the backdrop exports no marker');

      // The column — the composer's — is the child of main that asks.
      const column = await waitFor(() => {
        const found = [...main.children].find((child) => child.hasAttribute(marker));
        if (found === undefined) throw new Error('no child of main asks for the veil');
        return found;
      });
      expect(column.contains(screen.getByPlaceholderText('What do you do?'))).toBe(true);
      // And it does not scroll itself: main is the one scroller.
      expect(column.classList.contains('overflow-y-auto')).toBe(false);

      // main paints the strip for exactly that child, at the column's width.
      //
      // Each utility is written in two halves and joined (2026-10-14, P12A's
      // final audit), because the build reads this file for class names as it
      // reads a component: whole, each was a rule of its own in the stylesheet
      // the client ships — the bare utility, without the variant `Shell.tsx`
      // spends it under, which nothing spends. The size is cut after its
      // second hyphen and not its first, or the half after the cut would be a
      // utility of its own, an arbitrary size, and emitted in turn. (Neither
      // is spelt out in this comment, which the build reads too.)
      const classes = main.className.split(/\s+/);
      for (const part of [
        'bg-' + '[linear-gradient(var(--color-veil),var(--color-veil))]',
        'bg-' + 'no-repeat',
        'bg-' + 'center',
        'bg-size-' + '[min(100%,var(--container-reading))_100%]',
      ]) {
        expect(classes).toContain(`sm:has-[>[${marker}]]:${part}`);
      }
      expect(page.reading.split(' ')).toContain('max-w-reading');
    } finally {
      surfaces = undefined;
    }
  });

  it('is asked for by nothing on a session with no backdrop', async () => {
    renderApp();
    await act(async () => {
      await router.navigate({ to: '/play/$sessionId', params: { sessionId: SESSION_ID } });
    });
    await screen.findByPlaceholderText('What do you do?');

    const [marker] = Object.keys(veiled);
    expect(document.querySelector(`[${marker ?? 'data-veiled'}]`)).toBeNull();
  });
});

/**
 * ***A change of language reaches the routed page*** (2026-09-28). The shell
 * re-renders when a catalogue lands, and the router's `Outlet` is memoised, so
 * the page under it went on reading the tables it had last rendered with: a
 * switch made on a page left that page in the language it was leaving. Held on
 * the real router, because it is the router's memo that hid it — a test that
 * mounts a page by itself, or mocks the router, cannot see this either way.
 */
describe('a change of language', () => {
  it('reaches the routed page, and comes back', async () => {
    renderApp();
    await act(async () => {
      await router.navigate({ to: '/play/$sessionId', params: { sessionId: SESSION_ID } });
    });
    await screen.findByRole('heading', { name: 'The Ashfall Road', level: 1 });
    expect(await screen.findByPlaceholderText('What do you do?')).toBeTruthy();

    try {
      act(() => {
        applyCatalogue('fr-x-machine', MACHINE_FRENCH);
      });
      expect(
        await screen.findByPlaceholderText('Que faites-vous à cet instant précis ?'),
      ).toBeTruthy();
    } finally {
      act(() => {
        applyCatalogue('en', {});
      });
    }
    expect(await screen.findByPlaceholderText('What do you do?')).toBeTruthy();
  });
});

/**
 * ***Settings says it is where you are*** (2026-10-01). The three surfaces in
 * the header are lit while you are in them; Settings was a bare link with no
 * current state, so it was the one page in the app where nothing in the header
 * said where you were. Held on the real router, because `activeProps` is the
 * router's to apply and a mocked `Link` would apply nothing either way.
 */
describe('the header', () => {
  it('lights Settings while you are in it, and only then', async () => {
    renderApp();
    await act(async () => {
      await router.navigate({ to: '/settings' });
    });
    await screen.findByRole('heading', { name: 'Settings', level: 1 });
    const here = within(screen.getByRole('banner')).getByRole('link', { name: 'Settings' });
    expect(here.getAttribute('aria-current')).toBe('page');
    expect(here.className).toContain(navLink.active);

    await act(async () => {
      await router.navigate({ to: '/library', search: {} });
    });
    await screen.findByRole('heading', { name: 'Library', level: 1 });
    const away = within(screen.getByRole('banner')).getByRole('link', { name: 'Settings' });
    expect(away.getAttribute('aria-current')).toBeNull();
    expect(away.className).not.toContain(navLink.active);
    expect(away.className).toContain(navLink.idle);
  });
});
