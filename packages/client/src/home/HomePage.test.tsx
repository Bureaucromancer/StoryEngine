// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Home, as a prototype — [P7B.9], revised.
 *
 * **The assertion that matters is still that the changelog is the *build's*.**
 * The import is resolved at bundle time from the repository's own
 * `CHANGELOG.md` ([P7B §1.3]), so a running build shows what that build
 * contains rather than whatever a server happens to be holding. A test that
 * stubbed the text would assert nothing about that; this one reads the real
 * file through the same import the page uses, which is the only way the claim
 * is checkable at all.
 *
 * What the revision adds to assert: the file is *rendered* rather than dumped,
 * the page shows **one** release, and the address chooses which — including the
 * address that names a release this build has never carried.
 *
 * The page acquired providers along with the *All releases…* control, which
 * patches a preference. `LibraryPage.test.tsx`'s harness: the dock's open state
 * is a store rather than a spy, because the claim is a round trip through it.
 */

let prefsStore: Record<string, unknown> = {};
const patchPrefs = vi.fn();

vi.mock('../api.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api.js')>()),
  api: {
    authState: () => Promise.resolve({ account: { handle: 'ned', locale: null }, build: null }),
    readPrefs: () => Promise.resolve({ prefs: { ...prefsStore } }),
    patchPrefs: (patch: Record<string, unknown>) => {
      patchPrefs(patch);
      prefsStore = Object.fromEntries(
        Object.entries({ ...prefsStore, ...patch }).filter(([, value]) => value !== null),
      );
      return Promise.resolve({ prefs: { ...prefsStore } });
    },
  },
}));

const { HomePage } = await import('./HomePage.js');
const { CHANGELOG, NEWEST } = await import('./log.js');

function renderHome(release?: string): void {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <HomePage {...(release === undefined ? {} : { release })} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  prefsStore = {};
});

describe('the arrival page', () => {
  it('is a page rather than a redirect, and says what it is not yet', () => {
    renderHome();

    expect(screen.getByRole('heading', { level: 1, name: 'StoryEngine' })).toBeTruthy();
    expect(screen.getByText(/not built yet/)).toBeTruthy();
  });

  it("shows this build's changelog, read from the real file", () => {
    renderHome();

    // The version heading comes from the parsed file, so it is the build's.
    expect(NEWEST?.version).toMatch(/^1\.0\.0-alpha/);
    expect(screen.getByRole('heading', { level: 2 }).textContent).toContain(NEWEST?.name);
  });

  /**
   * ***The claim the revision is about.*** The file's `###` sections used to
   * reach the screen as four literal characters inside a `<pre>`; the assertion
   * is both halves — real headings, and no leftover syntax.
   */
  it('renders the release as a document rather than as its source', () => {
    const { container } = render(
      <QueryClientProvider client={new QueryClient()}>
        <HomePage />
      </QueryClientProvider>,
    );

    expect(container.querySelector('pre')).toBeNull();
    const sections = screen.getAllByRole('heading', { level: 3 }).map((node) => node.textContent);
    expect(sections).toContain('Added');
    expect(sections).toContain('Fixed');
    expect(container.textContent).not.toContain('### Added');
    expect(container.querySelectorAll('li').length).toBeGreaterThan(3);
  });

  it('shows one release, not the whole file', () => {
    renderHome();

    const older = CHANGELOG.releases[2];

    expect(screen.getAllByRole('heading', { level: 2 })).toHaveLength(1);
    expect(screen.queryByText(new RegExp(older?.name ?? 'nothing'))).toBeNull();
  });

  it('does not render the preamble, which addresses a reader of the repository', () => {
    renderHome();

    expect(screen.queryByText(/Every release tag has an entry here/)).toBeNull();
  });
});

describe('which release the address names', () => {
  it('shows the newest, and says that is what it is', () => {
    renderHome();

    expect(screen.getByText('The newest release in this build’s changelog.')).toBeTruthy();
  });

  it('shows an older one when the address names it', () => {
    const older = CHANGELOG.releases.at(-1);
    renderHome(older?.version);

    expect(screen.getByRole('heading', { level: 2 }).textContent).toContain(older?.name);
    expect(screen.getByText('An earlier release. This build is a later one.')).toBeTruthy();
  });

  /**
   * The router's *dropped rather than rejected* posture, carried onto the
   * surface. A changelog is pinned to the build that bundled it, so a link
   * shared from a newer install names a release this one has never heard of —
   * an expected end for a link, not an error card.
   */
  it('falls back to the newest for a release it does not have, and says so', () => {
    renderHome('9.9.9');

    expect(screen.getByRole('heading', { level: 2 }).textContent).toContain(NEWEST?.name);
    expect(
      screen.getByText(
        'The address named a release this build’s changelog does not have, so this is the newest one instead.',
      ),
    ).toBeTruthy();
  });

  it('treats the newest named explicitly as the newest, not as an older one', () => {
    renderHome(NEWEST?.version);

    expect(screen.getByText('The newest release in this build’s changelog.')).toBeTruthy();
  });
});

describe('the way to the release index', () => {
  it('reports the dock closed, and opens it on click', async () => {
    renderHome();

    const button = await screen.findByRole('button', { name: 'All releases…' });
    expect(button.getAttribute('aria-expanded')).toBe('false');
    expect(button.getAttribute('aria-controls')).toBeNull();

    fireEvent.click(button);

    // Through `waitFor` rather than a bare assertion: the click starts a
    // mutation, and the round trip through the prefs store settles a tick later.
    await waitFor(() => {
      expect(patchPrefs).toHaveBeenCalledWith({ 'ui.workbench-open': true });
    });
    await waitFor(() => {
      expect(
        screen.getByRole('button', { name: 'All releases…' }).getAttribute('aria-expanded'),
      ).toBe('true');
    });
  });

  /**
   * Deliberately still there once it has worked — `ImportButton`'s argument:
   * the button is where somebody looks for the history, and a control that
   * vanishes once it has worked is a control you cannot find twice.
   */
  it('stays present and enabled once the dock is open, pointing at it', async () => {
    prefsStore = { 'ui.workbench-open': true };
    renderHome();

    await waitFor(() => {
      const button = screen.getByRole('button', { name: 'All releases…' });
      expect(button.getAttribute('aria-expanded')).toBe('true');
      expect(button.getAttribute('aria-controls')).toBe('workbench');
      expect((button as HTMLButtonElement).disabled).toBe(false);
    });
  });

  it('is a second click that changes nothing rather than one that closes the dock', async () => {
    prefsStore = { 'ui.workbench-open': true };
    renderHome();

    await waitFor(() => {
      expect(
        screen.getByRole('button', { name: 'All releases…' }).getAttribute('aria-expanded'),
      ).toBe('true');
    });
    fireEvent.click(screen.getByRole('button', { name: 'All releases…' }));

    expect(patchPrefs).not.toHaveBeenCalled();
  });
});

describe('the reading column', () => {
  /**
   * [10 §1.2]'s Quiet family is type, measure and chrome. Home takes the first
   * two for its prose and none of the third: the page keeps the shell's width
   * because it sits beside the dock and carries a control, so the measure is at
   * the call site rather than on the page column. Asserted because the class is
   * the whole of the decision — `ui/classes.ts`'s `page` docstring carries the
   * argument and nothing else would go red if the class were dropped.
   */
  it('gives the prose the story measure without making the page a reading one', () => {
    const { container } = render(
      <QueryClientProvider client={new QueryClient()}>
        <HomePage />
      </QueryClientProvider>,
    );

    const article = container.querySelector('article');

    expect(article?.className).toContain('max-w-reading');
    expect(article?.className).toContain('text-story');
    // The page column is still the shell's, not the story column's.
    expect(container.querySelector('.max-w-4xl')).toBeTruthy();
    expect(within(article!).getAllByRole('heading', { level: 3 }).length).toBeGreaterThan(0);
  });
});
