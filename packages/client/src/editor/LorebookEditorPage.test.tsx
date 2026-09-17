// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from '@tanstack/react-router';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { newLoreEntry, newLorebook, type LoreEntry, type Lorebook } from '@storyengine/shared';

import { api, ApiError, type Account, type LibraryObject } from '../api.js';

/**
 * **Exit-gate step 5** —
 * [P5 §3](../../../../docs/design/workplan/17-p5-implementation.md): *"An entry
 * is created, edited and deleted through the real write path, and a collapsed
 * section in the editor names its non-default values."*
 *
 * Both halves are here and they are different kinds of claim. The first is
 * about the **write path**: the fake behind the mock enforces the content hash
 * the way `library.ts` does, so *saved* means the client presented the hash it
 * had been given and the book on the far side changed — against a fake that
 * accepted anything, an editor that never read the envelope would pass. The
 * second is about the **closed-section invariant**, which is the thing
 * [10 §11.2d] says makes progressive disclosure compatible with *no hidden
 * fields*, and it is asserted on the `summary` text because that is where the
 * promise is kept.
 *
 * The query client is **real** and the API module is mocked, the division
 * `ActorEditorPage.test.tsx` makes and for the same reason: what is under test
 * includes what survives a navigation, and a mocked `useQuery` deletes exactly
 * that.
 */

/**
 * Fixed ids, not the factories' fresh uuidv7 per test. The router is a module
 * singleton, so the URL one test leaves behind is where the next one mounts —
 * with stable ids that is harmless, where per-test ids would have the second
 * test open on a book the fake has never heard of.
 */
const BOOK_ID = '01a008de-7e08-70d0-899c-f6869d6b9aeb';
const HARBOUR = '01a008de-7e08-70d0-899c-000000000001';
const BRIDGE = '01a008de-7e08-70d0-899c-000000000002';

function entry(id: string, name: string, over: Partial<LoreEntry> = {}): LoreEntry {
  return { ...newLoreEntry(name), id, ...over };
}

/**
 * A book with one folder, one entry in it and one outside — enough for the
 * gate, the filing and the list, and small enough that a failure prints.
 */
function makeBook(): Lorebook {
  return {
    ...newLorebook('Ardent'),
    id: BOOK_ID,
    folders: [{ id: 'places', name: 'Places', parentFolderId: null, enabled: true, order: 0 }],
    entries: [
      entry(HARBOUR, 'Harbour', { folderId: 'places', keys: ['harbour'], sticky: 4 }),
      entry(BRIDGE, 'Bridge'),
    ],
  };
}

const ACCOUNT: Account = {
  handle: 'ned',
  displayName: 'Ned',
  role: 'owner',
  enabled: true,
  locale: null,
  capabilities: { privateConnections: true, fileAccess: 'full', enableExtensions: false },
  createdAt: 0,
};

/**
 * The in-memory library the mocked `api` speaks to, **enforcing the hash**
 * (`library.ts` — *'The object has changed since it was read.'* → 412 with the
 * current object). A readable counter rather than a digest, so a failure prints
 * `sha256:revision-1` and not sixty-four hex characters.
 */
function makeLibrary() {
  let stored: Record<string, unknown> = structuredClone(makeBook());
  let revision = 0;
  const creates: { kind: unknown; object: Record<string, unknown> }[] = [];

  const hash = (): string => `sha256:revision-${String(revision)}`;
  const envelope = (): LibraryObject => ({
    id: BOOK_ID,
    schema: stored['schema'] as string,
    name: stored['name'] as string,
    slug: 'ardent',
    source: 'user',
    contentHash: hash(),
    shadowed: false,
    object: structuredClone(stored),
  });

  return {
    envelope,
    stored: (): Lorebook => structuredClone(stored) as unknown as Lorebook,
    /** A write that did not come through this client — the other tab, or a text editor. */
    handEdit(next: Lorebook): void {
      stored = structuredClone(next);
      revision += 1;
    },
    readObject: (): Promise<LibraryObject> => Promise.resolve(envelope()),
    /**
     * Enough of a create for *save my version as a copy* to succeed. It does
     * not keep the copy — nothing here reads it back, and the claim the test
     * using this makes is about the navigation that follows, which is the one
     * navigation out of this editor that must not be stopped by the
     * unsaved-changes guard.
     */
    /** What the fake was asked to file — a copy, or a book that is new. */
    creates,
    createObject: (
      kind: unknown,
      object: Record<string, unknown>,
    ): Promise<{ id: string; slug: string; contentHash: string }> => {
      creates.push({ kind, object: structuredClone(object) });
      return Promise.resolve({
        id: object['id'] as string,
        slug: 'ardent-copy',
        contentHash: hash(),
      });
    },
    /** What the last save said it was an import of — [10 §11.2c]'s history line. */
    importedFrom: undefined as string | undefined,
    updateObject(
      _kind: unknown,
      _id: unknown,
      object: Record<string, unknown>,
      contentHash: string,
      importedFrom?: string,
    ): Promise<{ contentHash: string; object: Record<string, unknown> }> {
      this.importedFrom = importedFrom;
      if (contentHash !== hash()) {
        return Promise.reject(
          new ApiError(
            412,
            'stale',
            'The object has changed since it was read.',
            structuredClone(envelope()),
          ),
        );
      }
      stored = structuredClone(object);
      revision += 1;
      return Promise.resolve({ contentHash: hash(), object: structuredClone(stored) });
    },
  };
}

let server = makeLibrary();

/**
 * `importOriginal`, so **`ApiError` stays the real class**: the editor decides
 * whether to open the conflict dialog with an `instanceof`, and a look-alike
 * would fail it silently while the test reported *no dialog* for a client that
 * never looked.
 */
vi.mock('../api.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../api.js')>();
  return {
    ...actual,
    api: {
      ...actual.api,
      authState: () => Promise.resolve({ setupRequired: false, account: ACCOUNT }),
      listLibrary: () => Promise.resolve({ objects: [server.envelope()] }),
      readPrefs: () => Promise.resolve({ prefs: {} }),
      patchPrefs: (patch: Record<string, unknown>) => Promise.resolve({ prefs: patch }),
      readObject: () => server.readObject(),
      createObject: (kind: unknown, object: Record<string, unknown>) =>
        server.createObject(kind, object),
      updateObject: (
        kind: unknown,
        id: unknown,
        object: Record<string, unknown>,
        contentHash: string,
        importedFrom?: string,
      ) => server.updateObject(kind, id, object, contentHash, importedFrom),
    },
  };
});

const { router } = await import('../router.js');

beforeEach(() => {
  server = makeLibrary();
});

function renderApp(): QueryClient {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return client;
}

/** Drives the singleton router, which is where the previous test left it. */
async function openEditor(entryId?: string): Promise<void> {
  await act(async () => {
    await router.navigate({
      to: '/library/lorebooks/$id/edit',
      params: { id: BOOK_ID },
      search: entryId === undefined ? {} : { entry: entryId },
    });
  });
  await screen.findByRole('heading', { name: 'Ardent', level: 1 });
}

async function settled(client: QueryClient): Promise<void> {
  await waitFor(() => {
    expect(client.isFetching()).toBe(0);
  });
}

/** The disclosure whose summary starts with this group's name. */
function sectionFor(title: string): HTMLDetailsElement {
  const heading = screen
    .getAllByRole('heading', { level: 4 })
    .find((found) => found.textContent.startsWith(title));
  const section = heading?.closest('details');
  if (!section) throw new Error(`no disclosure rendered for ${title}`);
  return section;
}

describe('an entry created, edited and deleted through the real write path', () => {
  it('saves an edit against the hash it was given, and the book changes', async () => {
    const client = renderApp();
    await openEditor(HARBOUR);

    await userEvent.clear(screen.getByRole('textbox', { name: 'Content' }));
    await userEvent.type(screen.getByRole('textbox', { name: 'Content' }), 'Cranes.');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));

    await screen.findByText('Saved.');
    await settled(client);

    const saved = server.stored();
    expect(saved.entries.find((each) => each.id === HARBOUR)?.content).toBe('Cranes.');
    // The other entry is untouched, which is the claim a whole-object save has
    // to earn rather than assume.
    expect(saved.entries.find((each) => each.id === BRIDGE)?.name).toBe('Bridge');
  });

  it('creates one, files it where the list is standing, and saves it', async () => {
    const client = renderApp();
    await openEditor();

    await userEvent.click(screen.getByRole('button', { name: 'Places' }));
    await userEvent.click(screen.getByRole('button', { name: 'New entry' }));

    await userEvent.type(screen.getByRole('textbox', { name: 'Name' }), 'Quay');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await screen.findByText('Saved.');
    await settled(client);

    const made = server.stored().entries.find((each) => each.name === 'Quay');
    expect(made).toBeDefined();
    // Created entries can reach a folder only through the create verb, because
    // `folderId` is not a field this stage writes ([10 §11.2d]'s minimum).
    expect(made?.folderId).toBe('places');
  });

  it('removes one, and only after it is confirmed', async () => {
    const client = renderApp();
    await openEditor(BRIDGE);

    await userEvent.click(screen.getByRole('button', { name: 'Remove this entry' }));
    // Nothing has left the draft yet, let alone the file.
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeTruthy();
    expect(server.stored().entries).toHaveLength(2);

    await userEvent.click(screen.getByRole('button', { name: 'Remove' }));
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await screen.findByText('Saved.');
    await settled(client);

    expect(server.stored().entries.map((each) => each.name)).toEqual(['Harbour']);
  });

  /**
   * The draft is book-wide and one save writes all of it, so an entry edited
   * and then navigated away from is a pending change with nothing on screen to
   * say so — a hidden field one level up from the one §11.2d forbids.
   */
  it('marks an entry with unsaved edits after moving to another one', async () => {
    renderApp();
    await openEditor(HARBOUR);

    await userEvent.type(screen.getByRole('textbox', { name: 'Content' }), 'Cranes.');
    await userEvent.click(screen.getByRole('button', { name: /^Bridge/ }));

    // Anchored, as the query above it is: since the rows gained move controls
    // the name `Harbour` also matches *Move Harbour up*.
    const marked = await screen.findByRole('button', { name: /^Harbour/ });
    expect(within(marked).getByText('unsaved')).toBeTruthy();
    // And the edit survived the navigation rather than being discarded with a
    // remount — the reason the loader is keyed on the book and not on `?entry=`.
    await userEvent.click(marked);
    expect(screen.getByRole('textbox', { name: 'Content' })).toHaveProperty('value', 'Cranes.');
  });

  /**
   * **The list narrows by name**, because the folder rail does not narrow
   * enough: a real book of two hundred and forty-seven entries had a hundred
   * and eighty-two of them ungrouped, so *pick a folder* still left a wall.
   * Names only — finding an entry by what it *says* is the read page's job, and
   * the read page links back into here.
   */
  it('narrows the list by name, and says so when nothing is named that', async () => {
    renderApp();
    await openEditor();

    await userEvent.type(screen.getByRole('textbox', { name: 'Find an entry' }), 'bri');

    expect(screen.getByRole('button', { name: /^Bridge/ })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /^Harbour/ })).toBeNull();

    await userEvent.clear(screen.getByRole('textbox', { name: 'Find an entry' }));
    await userEvent.type(screen.getByRole('textbox', { name: 'Find an entry' }), 'nothing here');

    expect(await screen.findByText('No entry here is named that.')).toBeTruthy();
  });

  /**
   * The control test for the fake's hash enforcement: without it, *saved* above
   * would mean nothing.
   */
  it('refuses a save over a book that moved underneath it, and offers the merge', async () => {
    renderApp();
    await openEditor(HARBOUR);

    const elsewhere = makeBook();
    elsewhere.entries[1] = { ...elsewhere.entries[1]!, content: 'Iron.' };
    server.handEdit(elsewhere);

    await userEvent.type(screen.getByRole('textbox', { name: 'Content' }), 'Cranes.');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));

    await screen.findByRole('alertdialog');
    await userEvent.click(
      screen.getByRole('button', { name: 'Load the newer version and reapply my edits' }),
    );

    // My edit is still in the form and theirs is in the draft beside it.
    await waitFor(() => {
      expect(screen.getByRole('textbox', { name: 'Content' })).toHaveProperty('value', 'Cranes.');
    });
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await screen.findByText('Saved.');

    const saved = server.stored();
    expect(saved.entries.find((each) => each.id === HARBOUR)?.content).toBe('Cranes.');
    expect(saved.entries.find((each) => each.id === BRIDGE)?.content).toBe('Iron.');
  });
});

describe('the closed-section invariant', () => {
  it('opens Matching and Firing, and leaves the rest shut', async () => {
    renderApp();
    await openEditor(HARBOUR);

    expect(sectionFor('Matching').open).toBe(true);
    expect(sectionFor('Firing').open).toBe(true);
    expect(sectionFor('Timing').open).toBe(false);
    expect(sectionFor('Placement').open).toBe(false);
    expect(sectionFor('Recursion').open).toBe(false);
  });

  /**
   * The whole point of the line: this entry is `sticky: 4`, and *Timing* is
   * shut. A heading that said only *Timing* would be concealing a non-default
   * value, which [10 §11.2d] calls a hidden field and [10 §2.1] forbids.
   */
  it('names what a shut section is hiding, with the value where the value is the fact', async () => {
    renderApp();
    await openEditor(HARBOUR);

    expect(sectionFor('Timing').textContent).toContain('Timing (sticky 4)');
  });

  it('says so where a shut section is hiding nothing', async () => {
    renderApp();
    await openEditor(BRIDGE);

    expect(sectionFor('Timing').textContent).toContain('Timing (all at default)');
  });

  /**
   * **The annotation follows the draft, not the file**, which is what makes it
   * safe to close a section you have just edited: the summary a reader is
   * trusting has to describe what is in the form, and a version computed from
   * the loaded base would go stale the moment anybody typed.
   */
  it('follows an edit rather than the saved book', async () => {
    renderApp();
    await openEditor(HARBOUR);

    expect(sectionFor('Matching').textContent).toContain('keys 1');

    await userEvent.clear(screen.getByRole('textbox', { name: 'Keys' }));
    await userEvent.type(screen.getByRole('textbox', { name: 'Keys' }), 'harbour\ndocks\nquay');

    await waitFor(() => {
      expect(sectionFor('Matching').textContent).toContain('keys 3');
    });
  });

  /**
   * **And so does the gate note**, which is the same claim about a different
   * reader and was found missing by a mutation that fed the *saved* entry to
   * the wrong one of the two: an author switching an entry off needs the answer
   * to *will this fire* to change with the switch, not with the next save. The
   * gate is `shared/lore.ts`'s, so this is also the third surface agreeing with
   * the other two rather than a fourth opinion.
   */
  it('says an entry is off the moment the switch moves, not at the next save', async () => {
    renderApp();
    await openEditor(HARBOUR);

    const heading = screen.getByRole('heading', { name: 'Harbour', level: 3 }).parentElement;
    expect(heading?.textContent).not.toContain('off');

    await userEvent.click(screen.getByRole('checkbox', { name: 'Enabled' }));

    await waitFor(() => {
      expect(
        screen.getByRole('heading', { name: 'Harbour', level: 3 }).parentElement?.textContent,
      ).toContain('off');
    });
  });

  /**
   * **The sections are uncontrolled and stay where they are put.** React writes
   * a DOM prop only when the prop changes, so opening a section by hand — or a
   * browser opening one by itself to show a find-in-page match — survives every
   * re-render this form does, and it does about one per keystroke. Asserted by
   * opening one the way the browser would and then typing.
   */
  it('leaves a section somebody opened open, through a form that re-renders constantly', async () => {
    renderApp();
    await openEditor(HARBOUR);

    const timing = sectionFor('Timing');
    expect(timing.open).toBe(false);
    timing.open = true;

    await userEvent.type(screen.getByRole('textbox', { name: 'Content' }), 'Cranes.');

    expect(sectionFor('Timing').open).toBe(true);
  });
});

describe('what the editor writes and what it only shows', () => {
  /**
   * [10 §11.2d]'s minimum: *the durable core plus the folder gates, with
   * everything else visible and read-only*. Visible is the load-bearing word —
   * a field rendered nowhere is the hidden field the section forbids.
   */
  it('shows a field it does not own, without offering a control for it', async () => {
    renderApp();
    await openEditor(HARBOUR);

    const placement = sectionFor('Placement');
    // Shown: the label *and* the value, because a label over nothing is the
    // hidden field this section forbids one step along.
    //
    // ***`Depth`, where this used to name `Position`*** — [P7.14] gave `Position`
    // a picker, so it is no longer an example of the thing being asserted. The
    // claim is unchanged and needs an unowned field to make it over; `depth` is
    // one, in the same group, so the section being tested is the same section.
    expect(within(placement).getByText('Depth')).toBeTruthy();
    expect(within(placement).getByText('0')).toBeTruthy();
    /*
     * **No control of any kind, asked as one question.** Naming the roles a
     * control might have — textbox, combobox — is a list somebody has to keep
     * complete, and it was already incomplete: removing the guard in front of
     * `EntryRow`'s switch rendered *Position* as a **checkbox** bound to
     * `enabled`, and neither role query saw it. `queryByLabelText` finds a form
     * control by its label whatever the control is, which is the question the
     * test was trying to ask.
     */
    expect(within(placement).queryByLabelText('Depth')).toBeNull();
  });

  /**
   * ***And the two that stopped being read-only*** — [P7.14], discharging
   * [P7 §0.1a] item 11's outlet instance. An entry could be made an outlet entry
   * only by editing the file, which is [work plan §2.3]'s test failed outright.
   */
  it('lets an entry be made an outlet, and named only once it is one', async () => {
    renderApp();
    await openEditor(HARBOUR);

    const placement = sectionFor('Placement');
    const position = within(placement).getByLabelText('Position');
    // The four come from the schema's own union, so a fifth placement added
    // there arrives here with no edit.
    expect([...(position as HTMLSelectElement).options].map((one) => one.value)).toEqual([
      'before_char',
      'after_char',
      'at_depth',
      'outlet',
    ]);

    // Noise on a `before_char` entry, so it is not offered there.
    expect(within(placement).queryByLabelText('Outlet name')).toBeNull();

    await userEvent.selectOptions(position, 'outlet');

    const name = await within(sectionFor('Placement')).findByLabelText('Outlet name');
    await userEvent.type(name, 'harbour');
    expect((name as HTMLInputElement).value).toBe('harbour');
  });

  /**
   * ***The retrieval knobs, which had a consumer on every turn and no writer at
   * all*** — [P7.14]. The book's own gate is labelled for its scope rather than
   * by `labelFor`, because the page already has an *Enabled*.
   */
  it('writes the book’s retrieval settings, which nothing could set before', async () => {
    renderApp();
    await openEditor(HARBOUR);

    const depth = screen.getByLabelText('Scan depth');
    await userEvent.clear(depth);
    await userEvent.type(depth, '7');
    expect((depth as HTMLInputElement).value).toBe('7');

    // The schema's own bounds, so the browser refuses before the save does.
    const limit = screen.getByLabelText('Entry limit');
    expect(limit.getAttribute('min')).toBe('1');
    expect(limit.getAttribute('max')).toBe('1000');

    await userEvent.click(screen.getByRole('checkbox', { name: 'Recursive scanning' }));
    // The generic rather than an assertion: `getByRole` narrows for the caller,
    // and an `as` here is the one spelling eslint and tsc disagreed about.
    expect(
      screen.getByRole<HTMLInputElement>('checkbox', { name: 'Recursive scanning' }).checked,
    ).toBe(true);
  });

  /**
   * The schema's order, verbatim — §11.2d's *without being lifted*. The five
   * writable fields stand where their read-only rows would, so `Keys` is inside
   * *Matching* rather than promoted into a core form at the top.
   */
  it('puts the writable fields where the schema puts them', async () => {
    renderApp();
    await openEditor(HARBOUR);

    expect(within(sectionFor('Matching')).getByRole('textbox', { name: 'Keys' })).toBeTruthy();
    expect(within(sectionFor('Firing')).getByRole('checkbox', { name: 'Enabled' })).toBeTruthy();
  });

  /**
   * Gate step 2's rule at the surface that can break it: the schema says a shut
   * folder leaves each entry's own `enabled` *preserved rather than mutated*.
   */
  it('throws a folder gate without touching any entry’s own switch', async () => {
    const client = renderApp();
    await openEditor(HARBOUR);

    await userEvent.click(screen.getByRole('checkbox', { name: 'Gate for Places' }));
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await screen.findByText('Saved.');
    await settled(client);

    const saved = server.stored();
    expect(saved.folders[0]?.enabled).toBe(false);
    expect(saved.entries.find((each) => each.id === HARBOUR)?.enabled).toBe(true);
  });
});

/**
 * Reordering the entry list — [10 §5.3], [10 §11.2c].
 *
 * **What is being reordered is reading order**, which [10 §5.3] says is the
 * file's array order, and *not* `order`, which is injection order: *"Silently
 * sorting a reading list by injection order conflates two different things, and
 * it is the kind of small lie that teaches a false model of what the field
 * means."* So the assertions below are about the saved array, and one of them
 * is about `order` staying where it was.
 *
 * The gesture has two halves and both are tested, because a list that can only
 * be reordered by dragging cannot be reordered by a keyboard at all.
 */
describe('reordering entries', () => {
  /**
   * The order the list is showing, by name.
   *
   * The name span rather than the row's whole text, which also carries the
   * *off* and *unsaved* marks — a reorder marks nothing unsaved (no entry's
   * bytes change), and reading the row whole would make that a silent
   * dependency of every assertion here.
   */
  function shown(): string[] {
    return screen
      .getAllByRole('button', { name: /^(Harbour|Bridge)/ })
      .map((button) => button.querySelector('span')?.textContent ?? '');
  }

  /**
   * The rows carrying the landing line, by name and edge — read from
   * `data-drop`, which is the fact the line is drawn from. jsdom paints
   * nothing, so a two-pixel rule cannot be seen here; what can be seen is
   * which row claims which edge, and that claim is the drop's own rule, so
   * every assertion on it is also an assertion about where a drop would go.
   * The name is read from the row's first button rather than its first span,
   * because the line, when it shows, is the row's first child.
   */
  function marked(): [string, string][] {
    return screen
      .getAllByRole('listitem')
      .filter((row) => row.dataset['drop'] !== undefined)
      .map((row) => [
        within(row).getAllByRole('button')[0]?.querySelector('span')?.textContent ?? '',
        row.dataset['drop'] ?? '',
      ]);
  }

  /** The two rows in whatever order the previous test left them — never Harbour first by assumption. */
  function twoRows(): [HTMLElement, HTMLElement] {
    const [top, bottom] = screen.getAllByRole('listitem');
    if (top === undefined || bottom === undefined) throw new Error('expected two rows');
    return [top, bottom];
  }

  /** jsdom has no `DataTransfer`; the drop test below says why the stub is not a convenience. */
  const stub = () => ({ effectAllowed: '', setData: vi.fn(), getData: () => '' });

  it('moves an entry down with the keyboard, and saves the new order', async () => {
    const client = renderApp();
    await openEditor();

    expect(shown()).toEqual(['Harbour', 'Bridge']);

    await userEvent.click(screen.getByRole('button', { name: 'Move Harbour down' }));
    expect(shown()).toEqual(['Bridge', 'Harbour']);

    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await screen.findByText('Saved.');
    await settled(client);

    expect(server.stored().entries.map((each) => each.name)).toEqual(['Bridge', 'Harbour']);
  });

  it('moves one up again, and cannot move past either end', async () => {
    renderApp();
    await openEditor();

    // The book is left reordered by the test above — the router and the fake
    // are singletons — so this starts from whatever that left and asserts the
    // ends rather than a fixed pair.
    const first = shown()[0] ?? '';
    const last = shown()[1] ?? '';
    expect(screen.getByRole('button', { name: `Move ${first} up` })).toHaveProperty(
      'disabled',
      true,
    );
    expect(screen.getByRole('button', { name: `Move ${last} down` })).toHaveProperty(
      'disabled',
      true,
    );

    await userEvent.click(screen.getByRole('button', { name: `Move ${last} up` }));
    expect(shown()).toEqual([last, first]);
  });

  it('says what moved, for a reader who cannot see the row move', async () => {
    renderApp();
    await openEditor();

    const first = shown()[0] ?? '';
    await userEvent.click(screen.getByRole('button', { name: `Move ${first} down` }));

    // A live region rather than a toast: the change is a *position*, which the
    // DOM does not announce on its own.
    expect(screen.getByText(`Moved ${first} to position 2 of 2.`)).toBeTruthy();
  });

  it('drops a dragged row where the pointer left it', async () => {
    renderApp();
    await openEditor();

    const rows = screen.getAllByRole('listitem');
    const [top, bottom] = [rows[0], rows[1]];
    if (top === undefined || bottom === undefined) throw new Error('expected two rows');
    const order = shown();

    /**
     * **jsdom has no `DataTransfer`**, so the platform object the handler sets
     * `effectAllowed` on has to be supplied — without it the drag handler
     * throws on every run and this test still passes, because the state it
     * needs is set on the line before the throw. That is what a mutation pass
     * found here, and it is why the stub is not a convenience.
     */
    const dataTransfer = { effectAllowed: '', setData: vi.fn(), getData: () => '' };
    fireEvent.dragStart(top, { dataTransfer });
    fireEvent.dragOver(bottom, { dataTransfer });
    fireEvent.drop(bottom, { dataTransfer });

    // The id travels, which is what a drop between two open editors would read.
    expect(dataTransfer.setData).toHaveBeenCalledWith('text/plain', expect.any(String));

    /**
     * **Not covered here, and named rather than implied:** the `dragOver`
     * handler's `preventDefault`. jsdom implements no drag-and-drop protocol,
     * so `fireEvent.drop` fires whether or not the drop was allowed — deleting
     * that line leaves this test green and the feature dead in every browser.
     * A mutation pass says so; only a real browser could say otherwise.
     */

    expect(shown()).toEqual([order[1] ?? '', order[0] ?? '']);
  });

  /**
   * **Where the row will land is shown before it is let go** — [10 §11.2c].
   * The line and the drop are one computation (`landing`), so these tests
   * are also the drop rule's tests from the other side: flipping the
   * comparison reddens the first two, and the drop test above with them.
   *
   * The `preventDefault` in `dragOver` stays uncovered here for the reason
   * the drop test gives: jsdom implements no drag-and-drop protocol, so a
   * refused drop and an allowed one look the same to it.
   */
  it('draws the line under the row a drag from above would land behind', async () => {
    renderApp();
    await openEditor();
    const [top, bottom] = twoRows();
    const dataTransfer = stub();

    fireEvent.dragStart(top, { dataTransfer });
    // Nothing is promised until the pointer is over a row.
    expect(marked()).toEqual([]);

    fireEvent.dragOver(bottom, { dataTransfer });
    expect(marked()).toEqual([[shown()[1] ?? '', 'after']]);
  });

  it('draws it over the row a drag from below would land in front of', async () => {
    renderApp();
    await openEditor();
    const [top, bottom] = twoRows();
    const dataTransfer = stub();

    fireEvent.dragStart(bottom, { dataTransfer });
    fireEvent.dragOver(top, { dataTransfer });
    expect(marked()).toEqual([[shown()[0] ?? '', 'before']]);
  });

  /**
   * Reddened by dropping the source-row branch of `dragOver`: the neighbour's
   * line then stays up while a drop on the dragged row itself does nothing,
   * which is a promise the drop declines.
   */
  it('promises nothing over the row being dragged, and takes down what it promised elsewhere', async () => {
    renderApp();
    await openEditor();
    const [top, bottom] = twoRows();
    const dataTransfer = stub();

    fireEvent.dragStart(top, { dataTransfer });
    fireEvent.dragOver(bottom, { dataTransfer });
    fireEvent.dragOver(top, { dataTransfer });
    expect(marked()).toEqual([]);
  });

  it('takes the line down on drop', async () => {
    renderApp();
    await openEditor();
    const [top, bottom] = twoRows();
    const dataTransfer = stub();

    fireEvent.dragStart(top, { dataTransfer });
    fireEvent.dragOver(bottom, { dataTransfer });
    fireEvent.drop(bottom, { dataTransfer });
    expect(marked()).toEqual([]);
  });

  it('takes the line down when the drag ends anywhere else', async () => {
    renderApp();
    await openEditor();
    const [top, bottom] = twoRows();
    const dataTransfer = stub();

    fireEvent.dragStart(top, { dataTransfer });
    fireEvent.dragOver(bottom, { dataTransfer });
    fireEvent.dragEnd(top, { dataTransfer });
    expect(marked()).toEqual([]);
  });

  it('takes the line down when the pointer leaves the list, and not when it crosses into another row', async () => {
    renderApp();
    await openEditor();
    const [top, bottom] = twoRows();
    const list = top.closest('ul');
    if (list === null) throw new Error('expected the rows to be in a list');
    const dataTransfer = stub();

    fireEvent.dragStart(top, { dataTransfer });
    fireEvent.dragOver(bottom, { dataTransfer });

    /**
     * A `MouseEvent` rather than `fireEvent.dragLeave`, because jsdom has no
     * `DragEvent`: Testing Library falls back to a plain `Event`, whose
     * constructor drops `relatedTarget` on the floor, so the handler would see
     * `undefined` — which reads as *outside*, and would pass the clearing half
     * of this test for the wrong reason while failing the other half.
     * `MouseEvent` carries it, and the handler reads nothing a mouse event
     * lacks.
     */
    fireEvent(list, new MouseEvent('dragleave', { bubbles: true, relatedTarget: top }));
    expect(marked()).toHaveLength(1);

    fireEvent(list, new MouseEvent('dragleave', { bubbles: true, relatedTarget: document.body }));
    expect(marked()).toEqual([]);

    // Out of the window — and, in Chromium and WebKit, every leave.
    fireEvent.dragOver(bottom, { dataTransfer });
    expect(marked()).toHaveLength(1);
    fireEvent(list, new MouseEvent('dragleave', { bubbles: true, relatedTarget: null }));
    expect(marked()).toEqual([]);
  });

  it('leaves `order` alone, because dragging is not injection order', async () => {
    const client = renderApp();
    await openEditor();

    const before = server.stored().entries.map((each) => each.order);
    await userEvent.click(screen.getByRole('button', { name: `Move ${shown()[0] ?? ''} down` }));
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await screen.findByText('Saved.');
    await settled(client);

    // Same numbers, in the same set — the array moved and the field did not.
    expect([...server.stored().entries.map((each) => each.order)].sort()).toEqual(
      [...before].sort(),
    );
  });
});

/**
 * **The list scrolls itself while a drag hovers near its edge** — [10 §11.2c].
 *
 * jsdom lays nothing out and schedules no frames, so both halves are supplied:
 * the list's box is pinned to a known rectangle, and the animation frame is a
 * queue these tests drain by hand. What is then asserted is the arithmetic and
 * the loop — which way, how fast, and when it stops — against `scrollTop`,
 * which jsdom keeps as a plain number. That a browser fires `dragover` on a
 * stationary pointer, which is what keeps the loop fed, is the browser's
 * contract and not this file's.
 */
describe('scrolling the list while a drag hovers near its edge', () => {
  /** Three hundred and twenty pixels tall, from 100 to 420 — the list's `max-h-80`. */
  const BOX = {
    top: 100,
    bottom: 420,
    left: 0,
    right: 300,
    x: 0,
    y: 100,
    width: 300,
    height: 320,
    toJSON: () => ({}),
  };
  let frames: FrameRequestCallback[] = [];

  beforeEach(() => {
    frames = [];
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback): number => {
      frames.push(callback);
      return frames.length;
    });
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  /** Runs every frame queued so far, once — a frame that re-queues itself runs next time. */
  function runFrames(): void {
    for (const callback of frames.splice(0)) callback(0);
  }

  /** The editor open with the list's box pinned, and a drag of the top row in progress. */
  async function dragInProgress(): Promise<{
    list: HTMLElement;
    top: HTMLElement;
    bottom: HTMLElement;
  }> {
    renderApp();
    await openEditor();
    const [top, bottom] = screen.getAllByRole('listitem');
    if (top === undefined || bottom === undefined) throw new Error('expected two rows');
    const list = top.closest('ul');
    if (list === null) throw new Error('expected the rows to be in a list');
    list.getBoundingClientRect = () => BOX;
    fireEvent.dragStart(top, {
      dataTransfer: { effectAllowed: '', setData: vi.fn(), getData: () => '' },
    });
    return { list, top, bottom };
  }

  /**
   * A `MouseEvent` rather than `fireEvent.dragOver`, for the reason the leave
   * test above gives: jsdom has no `DragEvent`, and the plain `Event` Testing
   * Library falls back to drops `clientY` on the floor.
   */
  function hover(row: HTMLElement, clientY: number): void {
    fireEvent(row, new MouseEvent('dragover', { bubbles: true, cancelable: true, clientY }));
  }

  it('scrolls down near the bottom edge, and faster the nearer the pointer leans into it', async () => {
    const { list, bottom } = await dragInProgress();

    // Twenty pixels from the bottom, halfway into the zone: half speed, six a frame.
    hover(bottom, 400);
    runFrames();
    runFrames();
    expect(list.scrollTop).toBe(12);

    // One pixel from it: twelve a frame.
    hover(bottom, 419);
    runFrames();
    expect(list.scrollTop).toBe(24);
  });

  it('scrolls up near the top edge', async () => {
    const { list, top } = await dragInProgress();
    list.scrollTop = 200;

    // Five pixels from the top: eleven a frame, upward.
    hover(top, 105);
    runFrames();
    expect(list.scrollTop).toBe(189);
  });

  it('holds still in the middle, and runs out once the pointer comes back to it', async () => {
    const { list, bottom } = await dragInProgress();

    hover(bottom, 260);
    expect(frames).toHaveLength(0);

    hover(bottom, 400);
    runFrames();
    expect(list.scrollTop).toBe(6);

    // The frame already queued runs, finds nothing to do, and queues no other.
    hover(bottom, 260);
    runFrames();
    expect(list.scrollTop).toBe(6);
    expect(frames).toHaveLength(0);
  });

  it('stops when the drag ends', async () => {
    const { list, top, bottom } = await dragInProgress();

    hover(bottom, 400);
    runFrames();
    fireEvent.dragEnd(top);

    // The frame the browser would have cancelled is still in this queue; run,
    // it must find nothing to do.
    expect(cancelAnimationFrame).toHaveBeenCalled();
    runFrames();
    expect(list.scrollTop).toBe(6);
  });

  it('stops when the pointer leaves the list', async () => {
    const { list, bottom } = await dragInProgress();

    hover(bottom, 400);
    runFrames();
    fireEvent(list, new MouseEvent('dragleave', { bubbles: true, relatedTarget: document.body }));

    runFrames();
    expect(list.scrollTop).toBe(6);
  });

  it('does not scroll for a drag that is not one of its rows', async () => {
    renderApp();
    await openEditor();
    const [, bottom] = screen.getAllByRole('listitem');
    if (bottom === undefined) throw new Error('expected two rows');
    const list = bottom.closest('ul');
    if (list === null) throw new Error('expected the rows to be in a list');
    list.getBoundingClientRect = () => BOX;

    // No dragstart on any row: whatever is being dragged is not one of them.
    hover(bottom, 400);
    expect(frames).toHaveLength(0);
    expect(list.scrollTop).toBe(0);
  });
});

/**
 * Leaving with unsaved changes — [10 §11.6](../../../../docs/design/10-ui-surfaces.md).
 *
 * The claim under test is **not** that a dialog appears. It is that the draft
 * survives the answer *stay*, and is released only on the answer *leave* — a
 * warning that lost the work anyway would be a worse version of losing it
 * quietly, because it would have told you first.
 *
 * The third test is the one that pays for the other two. This editor addresses
 * the entry it has open with `?entry=`, so picking the next entry out of the
 * list is a navigation like any other, and the guard has to let it through:
 * blocking there would put a dialog about losing work in front of the most
 * common click on the surface, over a draft that is book-wide and was never in
 * danger.
 */
describe('leaving an editor with unsaved changes', () => {
  /** Edit the open entry, so the draft differs from the book on disk. */
  async function typeSomething(): Promise<void> {
    await userEvent.clear(screen.getByRole('textbox', { name: 'Content' }));
    await userEvent.type(screen.getByRole('textbox', { name: 'Content' }), 'Cranes.');
  }

  /** The editor's own way out, which is the exit a person takes. */
  function backLink(): HTMLElement {
    return screen.getByRole('link', { name: 'Back to the lorebook' });
  }

  it('asks before discarding them, and still holds them when you stay', async () => {
    renderApp();
    await openEditor(HARBOUR);
    await typeSomething();

    await userEvent.click(backLink());
    await screen.findByRole('alertdialog');
    await userEvent.click(screen.getByRole('button', { name: 'Keep editing' }));

    await waitFor(() => {
      expect(screen.queryByRole('alertdialog')).toBeNull();
    });
    // Both halves: still in the editor, and the edit still in it.
    expect(screen.getByRole('textbox', { name: 'Content' })).toHaveProperty('value', 'Cranes.');
  });

  it('lets go when you say so', async () => {
    renderApp();
    await openEditor(HARBOUR);
    await typeSomething();

    await userEvent.click(backLink());
    await screen.findByRole('alertdialog');
    await userEvent.click(screen.getByRole('button', { name: 'Leave without saving' }));

    // The editor is gone — asserted on Save rather than on what the next page
    // renders, which is a different surface's business and a different mock's.
    await waitFor(() => {
      expect(screen.queryByRole('button', { name: 'Save' })).toBeNull();
    });
  });

  it('does not ask when there is nothing to lose', async () => {
    renderApp();
    await openEditor(HARBOUR);

    await userEvent.click(backLink());

    await waitFor(() => {
      expect(screen.queryByRole('button', { name: 'Save' })).toBeNull();
    });
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });

  /**
   * **Save as a copy is the one exit that carries the work with it**, and it
   * is the exit the guard is most likely to break: the draft still differs
   * from *this* book's base and always will — the copy was written to a
   * different id — so a guard reading only *are there changes* would raise a
   * dialog about losing work on the click that just saved it, in front of the
   * conflict dialog the user was already in the middle of.
   *
   * The falsifying mutation is dropping `ignoreBlocker` from that navigation.
   */
  it('does not ask when the copy it just wrote is where it is going', async () => {
    renderApp();
    await openEditor(HARBOUR);

    // A foreign write, so the save is refused and the two ways out are offered.
    server.handEdit(makeBook());
    await userEvent.type(screen.getByRole('textbox', { name: 'Content' }), 'Cranes.');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await screen.findByRole('alertdialog');

    const wasAt = router.state.location.pathname;
    await userEvent.click(
      screen.getByRole('button', { name: 'Save my version as a copy instead' }),
    );

    // The address moved to the copy, and nothing stood in the way of it.
    await waitFor(() => {
      expect(router.state.location.pathname).not.toBe(wasAt);
    });
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });

  it('does not ask when the address changes but the editor does not', async () => {
    renderApp();
    await openEditor(HARBOUR);
    await typeSomething();

    await userEvent.click(screen.getByRole('button', { name: /^Bridge/ }));

    // The other entry is open, with no dialog in the way and the first entry's
    // edit still in the book-wide draft where it was.
    await waitFor(() => {
      expect(screen.getByRole('textbox', { name: 'Name' })).toHaveProperty('value', 'Bridge');
    });
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });
});

/**
 * The critical-controls strip's wiring, for this editor
 * ([10 §11.6](../../../../docs/design/10-ui-surfaces.md)). The delete control is
 * one shared component and its behaviour — the trash, the hash, the guard it
 * must step past — is proved in the actor editor's test; what two editors can
 * differ on silently is whether each mounts it, and whether the way back moved
 * into the strip with it. So this asserts the wiring and nothing more.
 */
describe('the critical controls in the lorebook editor', () => {
  it('offers Delete and the way back beside Save', async () => {
    renderApp();
    await openEditor(HARBOUR);

    expect(screen.getByRole('button', { name: 'Delete' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Back to the lorebook' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Save' })).toBeTruthy();
  });

  /**
   * And what a save says is said there too ([10 §11.6]) — asserted as
   * structure, since jsdom cannot see a strip pin: the status stands inside
   * the form Save belongs to, where nothing rendered above the form can be.
   * The actor editor's test says why; this one says this editor does it.
   */
  it('says Saved. inside the strip, beside the Save that caused it', async () => {
    renderApp();
    await openEditor(HARBOUR);

    await userEvent.type(screen.getByRole('textbox', { name: 'Content' }), ' Cranes.');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));

    const status = await screen.findByText('Saved.');
    expect(status.getAttribute('role')).toBe('status');
    expect(status.closest('form')).toBe(
      screen.getByRole('button', { name: 'Save' }).closest('form'),
    );
  });
});

/**
 * The book's name is required, and until now it was not —
 * [10 §11.1a](../../../../docs/design/10-ui-surfaces.md).
 *
 * This editor had no field check of any kind: the name could be emptied and
 * saved, and the shelf would then carry a row whose link had nothing to click.
 * The actor editor next door had refused that since P1.5, and §11.1a exists
 * because a rule kept in one editor by hand is a rule the next editor does not
 * have.
 *
 * Reddened by dropping the check, by disabling Save instead of refusing (the
 * button assertion), by refusing silently (the alert), or by refusing without
 * moving the cursor.
 */
describe('a save with the book name empty', () => {
  it('is refused, and says so beside the Save that caused it', async () => {
    renderApp();
    await openEditor();

    const name = screen.getByRole('textbox', { name: 'Book name' });
    expect(name.getAttribute('aria-required')).toBe('true');

    await userEvent.clear(name);

    const save = screen.getByRole('button', { name: 'Save' });
    expect(save.hasAttribute('disabled')).toBe(false);

    await userEvent.click(save);

    // The file still says what it said.
    expect(server.stored().name).toBe('Ardent');

    const refusal = await screen.findByText('Book name cannot be empty.');
    expect(refusal.getAttribute('role')).toBe('alert');
    expect(refusal.closest('form')).toBe(save.closest('form'));

    expect(document.activeElement).toBe(name);
  });

  it('lets the save through once the name is answered', async () => {
    renderApp();
    await openEditor();

    const name = screen.getByRole('textbox', { name: 'Book name' });
    await userEvent.clear(name);
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(server.stored().name).toBe('Ardent');

    await userEvent.type(name, 'Ardent Harbour');
    expect(screen.queryByText('Book name cannot be empty.')).toBeNull();

    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await screen.findByText('Saved.');
    expect(server.stored().name).toBe('Ardent Harbour');
  });
});

/**
 * A new lorebook, which does not exist until it is saved — [polish §10].
 *
 * The actor editor's twin of this carries the full argument. What is worth
 * asserting separately is the branch: this editor's \`handleSave\` sends the
 * draft to **create** rather than to update, and a book that reached the update
 * path would present a \`contentHash\` of \`''\` against a file that does not
 * exist — a 412 blaming the user for a conflict with nothing.
 */
describe('a new lorebook', () => {
  async function openNew(): Promise<void> {
    await act(async () => {
      await router.navigate({ to: '/library/lorebooks/new' });
    });
    await screen.findByRole('textbox', { name: 'Book name' });
  }

  it('writes nothing until it is saved, and offers nothing that reads a file', async () => {
    renderApp();
    await openNew();

    expect(server.creates).toEqual([]);
    expect(screen.queryByRole('button', { name: 'History' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Delete' })).toBeNull();
  });

  it('refuses a nameless book rather than filing one', async () => {
    renderApp();
    await openNew();

    const save = screen.getByRole('button', { name: 'Save' });
    expect(save.hasAttribute('disabled')).toBe(false);

    await userEvent.click(save);

    expect(server.creates).toEqual([]);
    expect(await screen.findByText('Book name cannot be empty.')).toBeDefined();
  });

  it('files the factory-built book once it has a name', async () => {
    renderApp();
    await openNew();

    await userEvent.type(screen.getByRole('textbox', { name: 'Book name' }), 'Ardent');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      expect(server.creates).toHaveLength(1);
    });

    const filed = server.creates[0];
    expect(filed?.kind).toBe('lorebooks');
    expect(filed?.object['name']).toBe('Ardent');
    // The factory's shape, not a literal: a book arrives with its entry list
    // and its scan settings, the same as one made with `curl`.
    expect(filed?.object['entries']).toEqual([]);
  });
});

/**
 * ***[10 §11.2c](../../../../docs/design/10-ui-surfaces.md) — entries travel on
 * their own***, at the surface.
 *
 * [entry-travel.test.ts](./entry-travel.test.ts) holds the two questions a
 * screen cannot answer — which folders come with a selection, and what a merge
 * does with a collision. **What is here is the three things only the page can
 * say**: that a selection is something a person can actually make, that what
 * comes out is a file, and that what goes in reaches disk through *the same
 * write path as every other edit*, carrying the history line §11.2c asks for.
 *
 * *The last of those is the one worth a test rather than a reading.* §11.2c's
 * *"the book's history is the record of the import"* is a claim about a field
 * on a save three components away from the file picker, and the failure it
 * guards against — an import that saves as `manual` — looks exactly like
 * success on screen.
 */
describe('entries travelling on their own', () => {
  /** jsdom has no object URLs and no real downloads, so both are captured. */
  function captureDownloads(): { names: string[]; blobs: Blob[] } {
    const caught: { names: string[]; blobs: Blob[] } = { names: [], blobs: [] };
    vi.spyOn(URL, 'createObjectURL').mockImplementation((blob: Blob | MediaSource) => {
      caught.blobs.push(blob as Blob);
      return 'blob:fake';
    });
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      caught.names.push(this.download);
    });
    return caught;
  }

  /**
   * The hidden input, which has no accessible name on purpose — see
   * `EntryTravel`.
   *
   * **Narrowed by `accept`**, because this page grew a second hidden file input
   * when [10 §11.2b]'s picture strips landed, and a bare
   * `input[type="file"]` then found the image picker instead.
   */
  function filePicker(): HTMLInputElement {
    const found = document.querySelector<HTMLInputElement>('input[type="file"][accept*="json"]');
    if (found === null) throw new Error('no file input rendered');
    return found;
  }

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('exports the entries a person ticked, as a lorebook', async () => {
    const caught = captureDownloads();
    renderApp();
    await openEditor();

    await userEvent.click(screen.getByRole('button', { name: 'Select several' }));
    await userEvent.click(screen.getByRole('checkbox', { name: 'Select Harbour' }));
    await userEvent.click(screen.getByRole('button', { name: 'Export selected' }));

    // The em-dash is not a path character, and what is left of it is one
    // space rather than two — see `fileNameFor`.
    expect(caught.names).toEqual(['Ardent entries.json']);
    const [blob] = caught.blobs;
    expect(blob).toBeDefined();
    const written = JSON.parse(await (blob?.text() ?? '{}')) as Lorebook;
    expect(written.schema).toBe(newLorebook('x').schema);
    expect(written.entries.map((one) => one.name)).toEqual(['Harbour']);
    // The folder above it came too — a dozen entries arriving flat at the root
    // have lost a shape the author gave the book.
    expect(written.folders.map((one) => one.id)).toEqual(['places']);
  });

  it('will not export nothing', async () => {
    renderApp();
    await openEditor();

    await userEvent.click(screen.getByRole('button', { name: 'Select several' }));
    expect(screen.getByRole('button', { name: 'Export selected' })).toHaveProperty(
      'disabled',
      true,
    );
  });

  it('merges a file into the open book, reviews it, and saves it as an import', async () => {
    const client = renderApp();
    await openEditor();

    const incoming: Lorebook = {
      ...newLorebook('A gift'),
      scanDepth: 8,
      entries: [
        entry('01a008de-7e08-70d0-899c-000000000009', 'Bridge'),
        entry('01a008de-7e08-70d0-899c-00000000000a', 'The lock keeper'),
      ],
    };
    const file = new File([JSON.stringify(incoming)], 'gift.json', { type: 'application/json' });

    await act(async () => {
      fireEvent.change(filePicker(), { target: { files: [file] } });
      // The change handler reads the file, so what `act` has to flush is the
      // promise chain rather than the event — which is a microtask away and
      // has to be awaited for `act` to see it.
      await Promise.resolve();
    });

    // ***The review, in the list rather than as a modal*** — §5's step scaled
    // down, and it reports the two things a merge decided on its own.
    const review = await screen.findByRole('region', { name: 'What arrived' });
    expect(within(review).getByText(/2 entries added/)).toBeTruthy();
    // `Bridge` was taken, so the incoming one was renamed rather than merged
    // into the entry already here.
    expect(within(review).getByText('Bridge → Bridge (2)')).toBeTruthy();
    expect(within(review).getByText(/Scan depth: 8 → 2/)).toBeTruthy();

    // Nothing is on disk yet, which is what makes the review fixable.
    expect(server.stored().entries).toHaveLength(2);

    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await screen.findByText('Saved.');
    await settled(client);

    const saved = server.stored();
    expect(saved.entries.map((one) => one.name)).toEqual([
      'Harbour',
      'Bridge',
      'Bridge (2)',
      'The lock keeper',
    ]);
    /**
     * ***The history line***, and the assertion this whole test exists for:
     * §11.2c says the merge goes through *"the same write path as every other
     * edit"* and the book takes a version *"naming what came in and from
     * where"*. An import that saved as `manual` would look identical above.
     */
    expect(server.importedFrom).toBe('gift.json');
  });

  it('says which kind of file it could not read, rather than that it could not', async () => {
    renderApp();
    await openEditor();

    const wrong = new File([JSON.stringify({ schema: 'storyengine.actor/1' })], 'vera.json', {
      type: 'application/json',
    });
    await act(async () => {
      fireEvent.change(filePicker(), { target: { files: [wrong] } });
      await Promise.resolve();
    });

    // [P11.6]'s rule: *that is the wrong file* and *that file is broken* have
    // different next steps, so they are different sentences.
    expect(
      await screen.findByText(/StoryEngine file of another kind, not a lorebook/),
    ).toBeTruthy();
  });

  it('leaves the next save alone — an import is one save, not a mode', async () => {
    const client = renderApp();
    await openEditor();

    const incoming: Lorebook = {
      ...newLorebook('A gift'),
      entries: [entry('01a008de-7e08-70d0-899c-00000000000b', 'The lock keeper')],
    };
    await act(async () => {
      fireEvent.change(filePicker(), {
        target: {
          files: [new File([JSON.stringify(incoming)], 'gift.json', { type: 'application/json' })],
        },
      });
      await Promise.resolve();
    });
    await screen.findByRole('region', { name: 'What arrived' });
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await screen.findByText('Saved.');
    await settled(client);
    expect(server.importedFrom).toBe('gift.json');

    // An ordinary edit, an hour later. A `from` left lying about would
    // attribute it to a file somebody imported once.
    await userEvent.click(screen.getByRole('button', { name: 'Harbour' }));
    await userEvent.type(screen.getByRole('textbox', { name: 'Content' }), 'Cranes.');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => {
      expect(server.importedFrom).toBeUndefined();
    });
  });
});

/**
 * ***[10 §11.2b](../../../../docs/design/10-ui-surfaces.md) — image slots***, at
 * the surface.
 *
 * `library/assets.test.ts` holds the container: bytes in, bytes out, an entry's
 * row served as readily as the book's, and the sweep that collects what nothing
 * names. **What is here is the two things §11.2b is actually about** — that the
 * pictures are in *two* places, a gallery on the book and a strip inline with
 * each entry, and that the row a person edits reaches the book through the
 * ordinary save.
 *
 * *And one claim that is a sentence rather than a mechanism.* §11.2b: *"nothing
 * here suggests the images are used. They are not sent, and an editor implying
 * otherwise would be making a promise the engine does not keep — which matters
 * more than usual here, because it is exactly the assumption the schema warns
 * against."* A test is a poor guard against an implication, and a good one
 * against the sentence being deleted.
 */
describe('image slots on a book and its entries', () => {
  function uploads(): { sent: Blob[] } {
    const sent: Blob[] = [];
    vi.spyOn(api, 'uploadAsset').mockImplementation((_kind, _id, blob) => {
      sent.push(blob);
      return Promise.resolve({
        asset: {
          ref: `assets/${String(sent.length)}.png`,
          digest: `sha256:${String(sent.length)}`,
          bytes: 4,
          mime: 'image/png',
        },
      });
    });
    return { sent };
  }

  function pickerIn(container: HTMLElement): HTMLInputElement {
    const found = container.querySelector<HTMLInputElement>('input[type="file"][accept^="image"]');
    if (found === null) throw new Error('no image picker rendered');
    return found;
  }

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('adds a picture to the book and makes it the cover, through the ordinary save', async () => {
    uploads();
    const client = renderApp();
    await openEditor();

    const gallery = screen.getByRole('heading', { name: 'Pictures' }).parentElement;
    if (gallery === null) throw new Error('no gallery section');

    await act(async () => {
      fireEvent.change(pickerIn(gallery), {
        target: { files: [new File(['fake'], 'map.png', { type: 'image/png' })] },
      });
      await Promise.resolve();
    });

    await userEvent.click(await within(gallery).findByRole('button', { name: 'Use as the cover' }));
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await screen.findByText('Saved.');
    await settled(client);

    const saved = server.stored();
    expect(saved.media).toHaveLength(1);
    expect(saved.media[0]?.ref).toBe('assets/1.png');
    expect(saved.primaryMediaId).toBe(saved.media[0]?.id);
  });

  it('puts a strip on the entry rather than on the book', async () => {
    uploads();
    const client = renderApp();
    await openEditor(HARBOUR);

    // The entry's own strip is the one below the entry heading, not the
    // gallery above — §11.2b's *inline with the entry*.
    const strip = screen.getByRole('heading', { name: 'Harbour', level: 3 }).parentElement
      ?.parentElement;
    if (strip === undefined || strip === null) throw new Error('no entry section');

    await act(async () => {
      fireEvent.change(pickerIn(strip), {
        target: { files: [new File(['fake'], 'quay.png', { type: 'image/png' })] },
      });
      await Promise.resolve();
    });

    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await screen.findByText('Saved.');
    await settled(client);

    const saved = server.stored();
    // On the entry, and **not** on the book: the bytes are stored beside the
    // book either way, and which array the row lands in is the whole difference.
    expect(saved.media).toEqual([]);
    expect(saved.entries.find((one) => one.id === HARBOUR)?.media).toHaveLength(1);
  });

  it('offers role as a pick-list and tags as free text', async () => {
    uploads();
    renderApp();
    await openEditor();

    const gallery = screen.getByRole('heading', { name: 'Pictures' }).parentElement;
    if (gallery === null) throw new Error('no gallery section');
    await act(async () => {
      fireEvent.change(pickerIn(gallery), {
        target: { files: [new File(['fake'], 'map.png', { type: 'image/png' })] },
      });
      await Promise.resolve();
    });

    // §11.2b: *"role is a short pick-list the software understands, tags are
    // free text the author organises by. Getting this wrong in the UI produces
    // tag soup in the role field."*
    expect(await within(gallery).findByRole('combobox', { name: 'Role' })).toBeTruthy();
    expect(within(gallery).getByRole('textbox', { name: 'Tags' })).toBeTruthy();
  });

  it('says the pictures are never sent', async () => {
    renderApp();
    await openEditor();

    // The one claim §11.2b makes that a mechanism cannot keep — so what is
    // guarded is the sentence.
    expect(screen.getAllByText(/never sent to a model/).length).toBeGreaterThan(0);
  });
});
