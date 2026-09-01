// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ACTOR_SCHEMA, CONVENTIONAL_SECTION_IDS } from '@storyengine/shared';

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
 *
 * The second half of the file is [P4.5]'s: the page can now make an actor.
 */

const listLibrary = vi.fn();
const createObject = vi.fn();
const navigate = vi.fn();

/** Mutable so a test can put the page under a kind filter. */
let search: { kind?: string } = {};

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
    createObject: (...a: unknown[]) => createObject(...a) as unknown,
    // Added at P5.0: the table formats an *Updated* column, so it reads the
    // account's locale like every other surface that formats a timestamp. The
    // mock replaces the whole `api` object, so an absent method is not a
    // fallback — it is a query that throws and a locale that is silently
    // undefined in every test.
    authState: () => Promise.resolve({ account: { handle: 'ned', locale: null } }),
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
  getRouteApi: () => ({ useSearch: () => search }),
  useNavigate: () => navigate,
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
  search = {};
  listLibrary.mockResolvedValue({ objects: [object('Rain City')] });
  createObject.mockResolvedValue({
    // Deliberately *not* the uuidv7 `newActor` mints client-side. The page has
    // both to hand, and this is what tells the two apart.
    id: '01b11111-2222-7333-8444-555566667777',
    slug: 'vera-kohl',
    contentHash: 'sha256:new',
  });
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

async function settled(): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0);
  });
}

/**
 * `fireEvent` rather than `userEvent`, which is this file's exception to the
 * house preference and worth the note so nobody "fixes" it back: the poll under
 * test needs fake timers, and user-event's inter-keystroke delay deadlocks
 * against them — every typing test hangs to the 15s timeout. The interactions
 * here are a change and a submit, with no pointer or focus behaviour that
 * user-event would model better.
 */
async function nameItAndSubmit(name: string): Promise<void> {
  act(() => {
    fireEvent.change(screen.getByLabelText('Name for the new actor'), { target: { value: name } });
  });
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'New actor' }));
    await vi.advanceTimersByTimeAsync(0);
  });
}

describe('the library list', () => {
  it('shows what the server has', async () => {
    renderPage();

    await settled();

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
    await settled();
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
    await settled();
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

describe('making an actor', () => {
  /**
   * **The assertion is the four conventional sections, not the name.**
   *
   * A name-and-schema check would pass over a page that hand-built a minimal
   * literal, and a hand-built literal is exactly the failure worth catching:
   * [10 §4](../../../../docs/design/10-schemas.md) requires *the editor creates all four on a
   * new actor*, `newActor` is the one place that happens, and an actor made in
   * the browser has to be the same object as one made with `curl`.
   */
  it('posts what the factory builds, conventional sections and all', async () => {
    renderPage();
    await settled();

    await nameItAndSubmit('Vera Kohl');

    expect(createObject).toHaveBeenCalledTimes(1);
    const call = createObject.mock.calls[0] as [string, Record<string, unknown>];
    expect(call[0]).toBe('actors');
    expect(call[1]['schema']).toBe(ACTOR_SCHEMA);
    expect(call[1]['name']).toBe('Vera Kohl');

    const profile = call[1]['profile'] as { sections: { id: string }[] };
    expect(profile.sections.map((section) => section.id).sort()).toEqual(
      Object.values(CONVENTIONAL_SECTION_IDS).toSorted(),
    );
  });

  /**
   * The id routed on is the server's, not the one minted client-side. They
   * agree in production — `create()` echoes what it was posted — so only a test
   * that hands back a *different* id can tell which one the page used.
   */
  it('lands in the editor at the id the server answered with', async () => {
    renderPage();
    await settled();

    await nameItAndSubmit('Vera Kohl');

    expect(navigate).toHaveBeenCalledWith({
      to: '/library/actors/$id/edit',
      params: { id: '01b11111-2222-7333-8444-555566667777' },
    });
  });

  /**
   * **Both guards, because the disabled button is not one of them.**
   *
   * Asserting the disabled attribute and clicking is a test that passes itself:
   * the click never reaches the handler, so deleting the handler's own
   * `!ready` check leaves it green. The submit is dispatched at the form to get
   * past the button and reach the code that actually decides.
   */
  it('trims, and will not post a name that is only spaces', async () => {
    renderPage();
    await settled();

    act(() => {
      fireEvent.change(screen.getByLabelText('Name for the new actor'), {
        target: { value: '   ' },
      });
    });

    expect(screen.getByRole('button', { name: 'New actor' })).toHaveProperty('disabled', true);

    await act(async () => {
      fireEvent.submit(screen.getByRole('button', { name: 'New actor' }).closest('form')!);
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(createObject).not.toHaveBeenCalled();
  });

  it('offers the form on the actors filter', async () => {
    search = { kind: 'actors' };
    renderPage();
    await settled();

    expect(screen.getByRole('button', { name: 'New actor' })).toBeTruthy();
  });

  /**
   * **Not a disabled button — no button.** A kind with no editor has nowhere to
   * land, so the page says so in a sentence instead of promising a control that
   * would strand the user on a read-only page over an empty object.
   */
  it('offers nothing on a kind that has no editor to land in', async () => {
    search = { kind: 'lorebooks' };
    renderPage();
    await settled();

    expect(screen.queryByRole('button', { name: 'New actor' })).toBeNull();
    expect(screen.queryByLabelText('Name for the new actor')).toBeNull();
    expect(screen.getByText(/only kind that can be made here/)).toBeTruthy();
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

/**
 * [P5.0] — the Lorebooks panel, which is
 * [polish §4](../../../../docs/design/workplan/09-polish.md)'s first of six and
 * is specified in the design rather than left to this page
 * ([05 §5.3](../../../../docs/design/05-ui-surfaces.md)), because a lorebook is
 * the only library kind whose object is a collection.
 *
 * **The assertion that matters is the badge**, and §5.3 says why: a disabled
 * book that renders identically to an enabled one is the *my lorebook never
 * fires* diagnosis arriving one surface too late. Everything else here is the
 * columns and the sort, which are the other two things a panel supplies.
 */
describe('the Lorebooks panel', () => {
  function book(name: string, over: Record<string, unknown> = {}, slug = name.toLowerCase()) {
    return {
      ...object(name),
      slug,
      contentHash: `sha256:${slug}`,
      object: {
        schema: 'storyengine.lorebook/1',
        name,
        enabled: true,
        scope: { kind: 'global' },
        tags: [],
        entries: [],
        provenance: { updatedAt: '2026-08-30T10:00:00Z' },
        ...over,
      },
    };
  }

  function headers(): string[] {
    return [...document.querySelectorAll('th')].map((node) => node.textContent);
  }

  it('carries the columns §5.3 chose, and the merged list keeps the ones it had', async () => {
    search = { kind: 'lorebooks' };
    listLibrary.mockResolvedValue({ objects: [book('Ardent')] });
    renderPage();
    await settled();

    expect(headers()).toEqual(['Name', 'Entries', 'Tags', 'Source', 'Updated']);
  });

  it('leaves a kind with no panel of its own exactly as it was', async () => {
    search = {};
    renderPage();
    await settled();

    expect(headers()).toEqual(['Name', 'Kind', 'Source']);
  });

  /**
   * The generic table cannot tell a three-entry book from a three-hundred-entry
   * one, and almost everything a person decides about a book depends on which
   * of those it is.
   */
  it('counts the entries, which is the column that cannot be got any other way', async () => {
    search = { kind: 'lorebooks' };
    listLibrary.mockResolvedValue({
      objects: [book('Ardent', { entries: [{ id: 'a' }, { id: 'b' }, { id: 'c' }] })],
    });
    renderPage();
    await settled();

    const cells = [...document.querySelectorAll('td')].map((node) => node.textContent);
    expect(cells).toContain('3');
  });

  it('says on the shelf that a book is switched off', async () => {
    search = { kind: 'lorebooks' };
    listLibrary.mockResolvedValue({
      objects: [book('Ardent', { enabled: false }), book('Rain City', {}, 'rain-city')],
    });
    renderPage();
    await settled();

    // One badge, not two: an enabled book needs no badge, and one on every book
    // would make the one that matters harder to see rather than easier.
    expect(screen.getAllByText('Off')).toHaveLength(1);
  });

  it('says when a book is scoped to the actors it links, and stays quiet when it is not', async () => {
    search = { kind: 'lorebooks' };
    listLibrary.mockResolvedValue({
      objects: [
        book('Ardent', { scope: { kind: 'linked', actorIds: ['a1'] } }),
        book('Rain City', {}, 'rain-city'),
      ],
    });
    renderPage();
    await settled();

    expect(screen.getAllByText('Linked')).toHaveLength(1);
  });

  it('reads the tags nothing has ever read', async () => {
    search = { kind: 'lorebooks' };
    listLibrary.mockResolvedValue({ objects: [book('Ardent', { tags: ['noir', 'city'] })] });
    renderPage();
    await settled();

    expect(screen.getByText('noir, city')).toBeTruthy();
  });

  it('sorts by whichever of its three sorts is chosen', async () => {
    search = { kind: 'lorebooks' };
    listLibrary.mockResolvedValue({
      objects: [
        book('Ardent', { entries: [{ id: 'a' }] }),
        book('Rain City', { entries: [{ id: 'a' }, { id: 'b' }] }, 'rain-city'),
      ],
    });
    renderPage();
    await settled();

    const names = (): (string | null)[] =>
      [...document.querySelectorAll('tbody tr')].map(
        (row) => row.querySelector('td')?.textContent ?? null,
      );

    // Name is the default, so Ardent leads.
    expect(names()).toEqual(['Ardent', 'Rain City']);

    act(() => {
      fireEvent.change(screen.getByLabelText('Sort by'), { target: { value: 'entries' } });
    });

    // By entry count, most first — which is the other order.
    expect(names()).toEqual(['Rain City', 'Ardent']);
  });

  it('points an empty shelf at import rather than at the API', async () => {
    search = { kind: 'lorebooks' };
    listLibrary.mockResolvedValue({ objects: [] });
    renderPage();
    await settled();

    const shown = screen.getByText(/^No lorebooks yet/);
    expect(shown.textContent).toContain('Import');
  });

  /**
   * **The sort copies, and nothing else was checking that.** Found by mutation:
   * changing `[...objects].sort()` to `objects.sort()` left every assertion
   * above green, because the page renders the same order either way. What it
   * would break is everything *else* reading that cache entry — the array
   * belongs to the query client, and `sort` reorders in place.
   */
  it('does not reorder the array the query cache owns', async () => {
    search = { kind: 'lorebooks' };
    listLibrary.mockResolvedValue({
      objects: [
        book('Ardent', { entries: [{ id: 'a' }] }),
        book('Rain City', { entries: [{ id: 'a' }, { id: 'b' }] }, 'rain-city'),
      ],
    });
    const client = renderPage();
    await settled();

    act(() => {
      fireEvent.change(screen.getByLabelText('Sort by'), { target: { value: 'entries' } });
    });

    const cached = client.getQueryData<{ objects: { name: string }[] }>(['library', 'lorebooks']);
    expect(cached?.objects.map((entry) => entry.name)).toEqual(['Ardent', 'Rain City']);
  });
});
