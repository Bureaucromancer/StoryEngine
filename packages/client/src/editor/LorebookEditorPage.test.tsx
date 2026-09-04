// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from '@tanstack/react-router';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { newLoreEntry, newLorebook, type LoreEntry, type Lorebook } from '@storyengine/shared';

import { ApiError, type Account, type LibraryObject } from '../api.js';

/**
 * **Exit-gate step 5** —
 * [P5 §3](../../../../docs/design/workplan/07-p5-implementation.md): *"An entry
 * is created, edited and deleted through the real write path, and a collapsed
 * section in the editor names its non-default values."*
 *
 * Both halves are here and they are different kinds of claim. The first is
 * about the **write path**: the fake behind the mock enforces the content hash
 * the way `library.ts` does, so *saved* means the client presented the hash it
 * had been given and the book on the far side changed — against a fake that
 * accepted anything, an editor that never read the envelope would pass. The
 * second is about the **closed-section invariant**, which is the thing
 * [05 §11.2d] says makes progressive disclosure compatible with *no hidden
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
    updateObject(
      _kind: unknown,
      _id: unknown,
      object: Record<string, unknown>,
      contentHash: string,
    ): Promise<{ contentHash: string; object: Record<string, unknown> }> {
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
      updateObject: (
        kind: unknown,
        id: unknown,
        object: Record<string, unknown>,
        contentHash: string,
      ) => server.updateObject(kind, id, object, contentHash),
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
    // `folderId` is not a field this stage writes ([05 §11.2d]'s minimum).
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
   * value, which [05 §11.2d] calls a hidden field and [05 §2.1] forbids.
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
   * [05 §11.2d]'s minimum: *the durable core plus the folder gates, with
   * everything else visible and read-only*. Visible is the load-bearing word —
   * a field rendered nowhere is the hidden field the section forbids.
   */
  it('shows a field it does not own, without offering a control for it', async () => {
    renderApp();
    await openEditor(HARBOUR);

    const placement = sectionFor('Placement');
    // Shown: the label *and* the value, because a label over nothing is the
    // hidden field this section forbids one step along.
    expect(within(placement).getByText('Position')).toBeTruthy();
    expect(within(placement).getByText('before_char')).toBeTruthy();
    /*
     * **No control of any kind, asked as one question.** Naming the roles a
     * control might have — textbox, combobox — is a list somebody has to keep
     * complete, and it was already incomplete: removing the guard in front of
     * `EntryRow`'s switch rendered *Position* as a **checkbox** bound to
     * `enabled`, and neither role query saw it. `queryByLabelText` finds a form
     * control by its label whatever the control is, which is the question the
     * test was trying to ask.
     */
    expect(within(placement).queryByLabelText('Position')).toBeNull();
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
 * Reordering the entry list — [05 §5.3], [05 §11.2c].
 *
 * **What is being reordered is reading order**, which [05 §5.3] says is the
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
