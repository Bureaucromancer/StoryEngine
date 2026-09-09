// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * **A hand edit reaches the browser without a restart** — the client half of P1
 * gate step 7–8, and [10 §4.1](../../../../docs/design/10-ui-surfaces.md)'s blunt statement of
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
async function clickNew(noun: string): Promise<void> {
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: `New ${noun}` }));
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
   * **Nothing is created here any anymore** — [polish §10].
   *
   * The control used to collect a name and post an object. It now opens an
   * editor over a draft, and the create happens on that editor's first Save,
   * which is what keeps the folder name honest: the slug is taken from the name
   * once and frozen ([03 §5.2]), so an object created before it was named would
   * keep `untitled-2` for good.
   *
   * The claims this test used to make — that the posted object is the
   * factory's, four conventional sections and all, and that the id routed on is
   * the server's — moved with the behaviour, to
   * [ActorEditorPage.test.tsx](../editor/ActorEditorPage.test.tsx). They are
   * still made; they are made where the create is.
   */
  it('creates nothing, and opens the editor over a draft instead', async () => {
    renderPage();
    await settled();

    await clickNew('actor');

    expect(createObject).not.toHaveBeenCalled();
    expect(navigate).toHaveBeenCalledWith({ to: '/library/actors/new' });
  });

  /**
   * **No name to fill in, and no disabled button either.**
   *
   * The old control refused a name of only spaces, in two places, and the test
   * for it dispatched a submit at the form to get past a button that was
   * disabled anyway. Both are gone: there is no box, so there is nothing here
   * to refuse. The refusal did not disappear — it moved into the editor, where
   * [10 §11.1a] puts it, and is asserted there.
   */
  it('asks for nothing before it opens the editor', async () => {
    renderPage();
    await settled();

    expect(screen.queryByLabelText('Name for the new actor')).toBeNull();
    expect(screen.getByRole('button', { name: 'New actor' })).toHaveProperty('disabled', false);
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
   *
   * *Exemplar changed at P5.1*: this used to be `lorebooks`, which now has an
   * editor. Kept as a case rather than deleted, because the sentence is the
   * behaviour and four kinds still get it.
   */
  it('offers nothing on a kind that has no editor to land in', async () => {
    search = { kind: 'treatments' };
    renderPage();
    await settled();

    expect(screen.queryByRole('button', { name: 'New actor' })).toBeNull();
    expect(screen.queryByLabelText('Name for the new actor')).toBeNull();
    expect(screen.getByText(/no editor yet/)).toBeTruthy();
  });

  /**
   * **P5.1's half of the same rule, from the other side.** The stage that built
   * the lorebook editor is the stage that owes this control — [P4.5]'s
   * actors-only rule says a lorebook gets its New control *when this editor
   * exists* — so the control appearing and the address it navigates to are both
   * assertions about that, not about a form.
   *
   * The route matters more than the button: the page used to navigate by a
   * literal, and a second creatable kind against a hard-coded `/library/actors`
   * would have posted a lorebook and then opened the actor editor over it.
   */
  it('offers a lorebook now that lorebooks have an editor, and lands in its own route', async () => {
    search = { kind: 'lorebooks' };
    renderPage();
    await settled();

    expect(screen.getByRole('button', { name: 'New lorebook' })).toBeTruthy();

    await clickNew('lorebook');

    expect(createObject).not.toHaveBeenCalled();
    expect(navigate).toHaveBeenCalledWith({ to: '/library/lorebooks/new' });
  });
});

/**
 * The way in, after the panel moved to the dock ([P4 §7.12]).
 *
 * [10 §5] says the empty library *points at import*, and the panel is no longer
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
 * [polish §4](../../../../docs/design/workplan/06-polish.md)'s first of six and
 * is specified in the design rather than left to this page
 * ([10 §5.3](../../../../docs/design/10-ui-surfaces.md)), because a lorebook is
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

  /** Badge text inside the rows, which is not the same as anywhere on screen. */
  function badgesInRows(text: string): Element[] {
    return [...document.querySelectorAll('tbody span')].filter((node) => node.textContent === text);
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

    // Scoped to the rows: the Enabled *filter* offers On and Off as options,
    // so a document-wide search would count the control as a badge.
    // One badge, not two: an enabled book needs no badge, and one on every book
    // would make the one that matters harder to see rather than easier.
    expect(badgesInRows('Off')).toHaveLength(1);
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

    expect(badgesInRows('Linked')).toHaveLength(1);
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
        (row) => row.querySelector('td a')?.textContent ?? null,
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
  /**
   * §5.3's four: tags, scope, enabled, source. The first is the one [04 §5]
   * documented a consumer for and never got.
   */
  describe('the four filters', () => {
    function shelf() {
      return [
        book('Ardent', { tags: ['noir'], scope: { kind: 'linked', actorIds: ['a'] } }),
        book('Rain City', { tags: ['city'], enabled: false }, 'rain-city'),
      ];
    }

    function names(): (string | null)[] {
      // The link, not the whole cell: the name cell also carries the badges,
      // so a cell's text is 'ArdentLinked' rather than the name.
      return [...document.querySelectorAll('tbody tr')].map(
        (row) => row.querySelector('td a')?.textContent ?? null,
      );
    }

    async function shelved(): Promise<void> {
      search = { kind: 'lorebooks' };
      listLibrary.mockResolvedValue({ objects: shelf() });
      renderPage();
      await settled();
    }

    function choose(label: string, value: string): void {
      act(() => {
        fireEvent.change(screen.getByLabelText(label), { target: { value } });
      });
    }

    /**
     * **Tags moved out of this panel** — [05 §5](../../../../docs/design/05-tagging.md).
     * They are on every kind while scope, enabled and source are the lorebook's,
     * so the single-select this block used to drive is now a three-state chip
     * bar on the page. Its own tests are in `tags/TagFilterBar.test.tsx`; what
     * is left here is that this panel no longer offers a second answer to the
     * same question.
     */
    it('no longer offers a tag control of its own', async () => {
      await shelved();

      expect(screen.queryByLabelText('Tag')).toBeNull();
    });

    it('narrows by scope', async () => {
      await shelved();
      choose('Scope', 'linked');
      expect(names()).toEqual(['Ardent']);
    });

    it('narrows by whether the book is switched on', async () => {
      await shelved();
      choose('Enabled', 'off');
      expect(names()).toEqual(['Rain City']);
    });

    it('narrows by source', async () => {
      await shelved();
      choose('Source', 'system');
      expect(names()).toEqual([]);
    });

    /**
     * Deriving each filter's options from what the *others* have already left
     * would make the controls disagree: pick a tag, and the scope list loses
     * values, so unpicking becomes the only way back to a shelf you could see a
     * moment ago.
     */
    it('keeps every filter offering the whole shelf’s values', async () => {
      await shelved();
      choose('Enabled', 'off');

      const options = [...screen.getByLabelText('Scope').querySelectorAll('option')].map(
        (node) => node.textContent,
      );
      expect(options).toEqual(['Any', 'Global', 'Linked']);
    });

    /**
     * A shelf narrowed to nothing is a different state from an empty library,
     * and what a person does next is the difference: widen a filter, or go and
     * import. Saying the wrong one is the surface misreading itself.
     */
    it('says the filters are the reason, rather than telling you to import', async () => {
      await shelved();
      choose('Scope', 'linked');
      choose('Enabled', 'off');

      expect(names()).toEqual([]);
      expect(screen.getByText('Nothing on this shelf matches these filters.')).toBeTruthy();
      expect(screen.queryByText(/^No lorebooks yet/)).toBeNull();
    });

    it('is absent from a kind that has chosen none', async () => {
      search = {};
      renderPage();
      await settled();

      expect(screen.queryByLabelText('Tag')).toBeNull();
    });
  });

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

/**
 * Search and sort on every shelf — [polish §9].
 *
 * The control row used to render only for a panel that declared sorts or
 * filters, which was Lorebooks and nothing else: five shelves out of six had no
 * controls whatsoever. Search is the one control every kind can answer, so the
 * condition had nothing left to be about.
 *
 * `fireEvent` rather than `userEvent` throughout, which this file's header
 * explains: user-event's inter-keystroke delay deadlocks against the fake
 * timers the two-second poll needs, and a typing test is where that bites.
 */
describe('searching a shelf', () => {
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

  function shelf() {
    return [book('Ardent', { tags: ['noir'] }), book('Rain City', { tags: ['city'] }, 'rain-city')];
  }

  function names(): (string | null)[] {
    return [...document.querySelectorAll('tbody tr')].map(
      (row) => row.querySelector('td a')?.textContent ?? null,
    );
  }

  async function shelved(): Promise<void> {
    search = { kind: 'lorebooks' };
    listLibrary.mockResolvedValue({ objects: shelf() });
    renderPage();
    await settled();
  }

  function type(value: string): void {
    act(() => {
      fireEvent.change(screen.getByLabelText('Search this shelf'), { target: { value } });
    });
  }

  function toggle(): void {
    act(() => {
      fireEvent.click(screen.getByRole('button', { name: /search/i }));
    });
  }

  it('is behind a toggle, and the box is not there until it is asked for', async () => {
    await shelved();

    expect(screen.queryByLabelText('Search this shelf')).toBeNull();

    toggle();

    expect(screen.getByLabelText('Search this shelf')).toBeTruthy();
  });

  it('narrows the shelf as it is typed', async () => {
    await shelved();
    toggle();

    type('rain');

    expect(names()).toEqual(['Rain City']);
  });

  it('reads tags as well as names, which is what the hint promises', async () => {
    await shelved();
    toggle();

    // Nothing is called "noir"; the book carrying that tag is.
    type('noir');

    expect(names()).toEqual(['Ardent']);
  });

  /**
   * **Closing clears.** A hidden box holding a live query leaves the shelf
   * narrowed with nothing on screen to explain it — the reason SillyTavern
   * clears its own in two places. Reddened by dropping the `setQuery('')`.
   */
  it('clears the query when the box is closed', async () => {
    await shelved();
    toggle();
    type('rain');
    expect(names()).toEqual(['Rain City']);

    toggle();

    expect(names()).toEqual(['Ardent', 'Rain City']);
  });

  /**
   * A third empty state. The old sentence was filter-specific and stopped being
   * true the moment a search could empty the list too — and *widen a filter* is
   * unhelpful advice to somebody who has mistyped a name.
   */
  it('says it was the search, not the filters, that emptied the shelf', async () => {
    await shelved();
    toggle();

    type('nothing here is called this');

    expect(screen.getByText('Nothing on this shelf matches that search.')).toBeTruthy();
    expect(screen.queryByText('Nothing on this shelf matches these filters.')).toBeNull();
  });

  it('offers Sort by on a shelf that used to have no controls at all', async () => {
    search = { kind: 'actors' };
    listLibrary.mockResolvedValue({ objects: [object('Vera')] });
    renderPage();
    await settled();

    expect(screen.getByLabelText('Sort by')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Search' })).toBeTruthy();
  });
});
