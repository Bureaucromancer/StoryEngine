// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * **A hand edit reaches the browser without a restart** — the client half of P1
 * gate step 7–8, and [05 §4.1](../../../../docs/design/05-ui-surfaces.md)'s blunt statement of
 * the stakes: *if editing a file on disk does not reflect, the storage design
 * has already failed on its own terms.*
 *
 * The server half has been covered since P1 closeout —
 * `routes/gate.test.ts` › *step 8 — a hand edit reaches the browser without a
 * restart* polls the API with a real watcher running. Its own comment concedes
 * what it cannot reach: *"The client half — the 2s poll — is a component concern
 * and belongs with the jsdom tier."* That tier existed from P2.0 and nothing was
 * ever put in it, so **deleting `refetchInterval` from `useLibrary` left the
 * entire suite green while the project's headline demo stopped working.**
 *
 * Found by walking the P2 gate as a checklist rather than by a failure, which is
 * the only way a gap like this surfaces: there is nothing to go red.
 */

const listLibrary = vi.fn();

/**
 * The dock's open state, as a store rather than a spy.
 *
 * The page grew an *Import…* control when the panel moved into the workbench
 * ([P4 §7.12]), and what that control does is patch a preference — so the claim
 * to test is a round trip through the store, not that a function was called.
 * Same stateful shape `dock.test.tsx` and `AsStored.test.tsx` use.
 */
let prefsStore: Record<string, unknown> = {};
const patchPrefs = vi.fn();

vi.mock('../api.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api.js')>()),
  api: {
    listLibrary: (...a: unknown[]) => listLibrary(...a) as unknown,
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

vi.mock('@tanstack/react-router', () => ({
  getRouteApi: () => ({ useSearch: () => ({}) }),
  Link: ({ children }: { children: React.ReactNode }) => <a href="#">{children}</a>,
}));

const { LibraryPage } = await import('./LibraryPage.js');

function object(name: string) {
  return {
    id: '01a008de-7e08-70d0-899c-f6869d6b9aeb',
    schema: 'storyengine.lorebook/1',
    name,
    slug: 'rain-city',
    source: 'user' as const,
    contentHash: `sha256:${name.length.toString()}`,
    shadowed: false,
    object: {},
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  prefsStore = {};
  vi.useFakeTimers();
  listLibrary.mockResolvedValue({ objects: [object('Rain City')] });
});

afterEach(() => {
  vi.useRealTimers();
});

function renderPage(): QueryClient {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <LibraryPage />
    </QueryClientProvider>,
  );
  return client;
}

describe('the library list', () => {
  it('shows what the server has', async () => {
    renderPage();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(screen.getByText('Rain City')).toBeTruthy();
  });

  /**
   * **The poll is the mechanism, so the poll is what is asserted.**
   *
   * A real `QueryClient` rather than a mocked `useQuery`: mocking the hook would
   * take `refetchInterval` out of the test entirely, and that option is the only
   * thing this file is about. Fake timers, because the interval is two seconds
   * and a test that waited them out would be two seconds slower for nothing.
   */
  it('picks up a hand edit without anything navigating or reloading', async () => {
    renderPage();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(screen.getByText('Rain City')).toBeTruthy();

    // Somebody edits the file on disk; the watcher re-indexes it; the API now
    // answers differently. Nothing has told the browser.
    listLibrary.mockResolvedValue({ objects: [object('Rain City, after the fire')] });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2500);
    });

    expect(screen.getByText('Rain City, after the fire')).toBeTruthy();
    // And it was a refetch rather than a remount — the list was never empty in
    // between, which is what makes this reflect rather than flicker.
    expect(listLibrary.mock.calls.length).toBeGreaterThan(1);
  });

  it('does not poll faster than the interval', async () => {
    renderPage();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    const initial = listLibrary.mock.calls.length;

    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });

    // Half a second is not two seconds. Without this, a `refetchInterval` of 0
    // or 1 would satisfy the test above while hammering the server — the
    // failure mode a poll has instead of not working.
    expect(listLibrary.mock.calls.length).toBe(initial);
  });
});

/**
 * The way in, after the panel moved to the dock ([P4 §7.12]).
 *
 * [05 §5] says the empty library *points at import*, and the panel is no longer
 * on this page to point at — so what has to survive the move is a control here
 * that opens the dock over this route. It patches a preference rather than
 * routing, because [P3 §1.2] keeps the dock's open state out of the URL on the
 * grounds that a URL-addressable panel is a place, and §3 spent its argument on
 * the panel not being one.
 */
describe('the import entry point', () => {
  it('opens the dock by patching the preference, not by navigating', async () => {
    renderPage();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    const opener = screen.getByRole('button', { name: /import/i });
    expect(opener.getAttribute('aria-expanded')).toBe('false');

    fireEvent.click(opener);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(patchPrefs).toHaveBeenCalledWith({ 'ui.workbench-open': true });
    expect(prefsStore['ui.workbench-open']).toBe(true);

    // `waitFor` polls on real timers and would hang against the fake ones this
    // file installs for the library poll; advancing is the same wait, told to
    // the clock that is actually running.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(screen.getByRole('button', { name: /import/i }).getAttribute('aria-expanded')).toBe(
      'true',
    );
  });

  it('does not close the dock somebody already opened', async () => {
    // The control is where a person looks for import; it is not a toggle. One
    // that closed the panel it just opened would be the second click undoing the
    // first, which is not what a button labelled *Import…* promises.
    prefsStore = { 'ui.workbench-open': true };
    renderPage();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    fireEvent.click(screen.getByRole('button', { name: /import/i }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(patchPrefs).not.toHaveBeenCalled();
    expect(prefsStore['ui.workbench-open']).toBe(true);
  });
});
