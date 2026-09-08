// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { TagEntry } from '@storyengine/shared';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { TagManagerDialog } from './TagManagerDialog.js';

/**
 * The tag manager — [25 §5](../../../../docs/design/25-tagging.md).
 *
 * The claim worth the most here is the one that is easy to build wrong: **a tag
 * with no registry entry is a row, not an absence.** That is invariant 1 made
 * visible, and a manager that only listed what it had opinions about would read
 * as a vocabulary — which is the thing 25 spends its length refusing.
 *
 * The rest is ordering, whose keyboard half exists because a list reorderable
 * only by dragging is one a keyboard cannot reorder at all, and jsdom computes
 * no layout so the drag itself is a browser check rather than a test.
 */

const readTags = vi.fn();
const createTag = vi.fn();
const patchTag = vi.fn();
const deleteTag = vi.fn();
const orderTags = vi.fn();
const renameTag = vi.fn();
const adoptTags = vi.fn();

vi.mock('../api.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../api.js')>();
  return {
    ...actual,
    api: {
      ...actual.api,
      readTags: () => readTags() as unknown,
      createTag: (...args: unknown[]) => createTag(...args) as unknown,
      patchTag: (...args: unknown[]) => patchTag(...args) as unknown,
      deleteTag: (...args: unknown[]) => deleteTag(...args) as unknown,
      orderTags: (...args: unknown[]) => orderTags(...args) as unknown,
      renameTag: (...args: unknown[]) => renameTag(...args) as unknown,
      adoptTags: (...args: unknown[]) => adoptTags(...args) as unknown,
    },
  };
});

function entry(over: Partial<TagEntry> = {}): TagEntry {
  return {
    id: 'tag-1',
    name: 'noir',
    swatch: null,
    sortOrder: 0,
    folder: 'none',
    hidden: false,
    createdAt: '2026-09-08T00:00:00Z',
    ...over,
  };
}

function open(tags: TagEntry[], counts: [string, number][] = []): void {
  readTags.mockResolvedValue({ tags });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <TagManagerDialog counts={new Map(counts)} onDismiss={vi.fn()} />
    </QueryClientProvider>,
  );
}

async function rowFor(name: string): Promise<HTMLElement> {
  // Waits for the *table*, not for the text. Before the registry loads there
  // are no rows and every tag in use is an unregistered one, so a bare
  // `getByText` finds the chip in that list and reads the wrong state.
  const table = await screen.findByRole('table');
  const cell = within(table).getByText(name);
  const row = cell.closest('tr');
  if (row === null) throw new Error(`no row for ${name}`);
  return row;
}

beforeEach(() => {
  vi.clearAllMocks();
  createTag.mockResolvedValue({ tags: [] });
  patchTag.mockResolvedValue({ tags: [] });
  deleteTag.mockResolvedValue({ tags: [] });
  orderTags.mockResolvedValue({ tags: [] });
  renameTag.mockResolvedValue({ tags: [], gatesFound: [] });
  adoptTags.mockResolvedValue({ tags: [], adopted: [], minted: [], skipped: [], unchanged: 0 });
});

describe('the list', () => {
  it('shows a registered tag with what it is used by', async () => {
    open([entry({ name: 'noir' })], [['noir', 3]]);

    const row = await rowFor('noir');
    expect(within(row).getByText('3')).toBeTruthy();
  });

  /**
   * **Invariant 1, made visible.** A tag the registry has never heard of works
   * exactly as a listed one does, so the manager shows it — and offers to give
   * it somewhere to keep a colour rather than treating it as a problem.
   */
  it('lists a tag in use that the registry has never heard of', async () => {
    open(
      [entry({ name: 'noir' })],
      [
        ['noir', 1],
        ['napoleonic', 2],
      ],
    );

    expect(await screen.findByText('In use, not listed')).toBeTruthy();
    expect(screen.getByText('napoleonic')).toBeTruthy();
  });

  it('adopts one when asked, without touching the objects carrying it', async () => {
    open([], [['napoleonic', 2]]);

    await userEvent.click(await screen.findByRole('button', { name: 'Add napoleonic' }));

    expect(createTag).toHaveBeenCalledWith({ name: 'napoleonic' });
  });

  it('stops calling a tag unlisted once it is listed', async () => {
    open([entry({ name: 'noir' })], [['noir', 1]]);
    await rowFor('noir');

    expect(screen.queryByText('In use, not listed')).toBeNull();
  });
});

describe('a row', () => {
  it('recolours through the swatch group', async () => {
    open([entry({ id: 'tag-1', name: 'noir' })]);
    const row = await rowFor('noir');

    await userEvent.click(within(row).getByRole('radio', { name: 'Teal' }));

    expect(patchTag).toHaveBeenCalledWith('tag-1', { swatch: 'teal' });
  });

  it('clears a colour back to the neutral chip', async () => {
    open([entry({ id: 'tag-1', name: 'noir', swatch: 'rose' })]);
    const row = await rowFor('noir');

    await userEvent.click(within(row).getByRole('radio', { name: 'None' }));

    expect(patchTag).toHaveBeenCalledWith('tag-1', { swatch: null });
  });

  /**
   * The three modes cycle through one control, which is the reference's shape
   * and the only one that fits a row. `none → open → closed → none`.
   */
  it('cycles the folder mode rather than offering three controls', async () => {
    open([entry({ id: 'tag-1', name: 'noir', folder: 'open' })]);
    const row = await rowFor('noir');

    await userEvent.click(within(row).getByRole('button', { name: /Folder mode for noir/ }));

    expect(patchTag).toHaveBeenCalledWith('tag-1', { folder: 'closed' });
  });

  /**
   * **Hidden means: not drawn on an object's chip strip, and nothing else.**
   * The checkbox is phrased as *show on cards* rather than *hidden* so the
   * stronger reading — hidden from filtering, hidden from search — has nowhere
   * to take hold.
   */
  it('hides a tag from cards without hiding it from anything else', async () => {
    open([entry({ id: 'tag-1', name: 'noir' })]);
    const row = await rowFor('noir');

    await userEvent.click(within(row).getByRole('checkbox', { name: 'Show noir on cards' }));

    expect(patchTag).toHaveBeenCalledWith('tag-1', { hidden: true });
  });

  it('removes the entry, which is not the same as removing the tag', async () => {
    open([entry({ id: 'tag-1', name: 'noir' })]);
    const row = await rowFor('noir');

    await userEvent.click(within(row).getByRole('button', { name: 'Remove' }));

    expect(deleteTag).toHaveBeenCalledWith('tag-1');
  });
});

/**
 * The keyboard half of reordering. It is the real implementation and the drag
 * is a convenience over the same call — the way round the entry list settled
 * on, because jsdom computes no layout and a person with no mouse computes no
 * drag.
 */
describe('ordering', () => {
  const three = [
    entry({ id: 'a', name: 'noir', sortOrder: 0 }),
    entry({ id: 'b', name: 'city', sortOrder: 1 }),
    entry({ id: 'c', name: 'ronin', sortOrder: 2 }),
  ];

  it('sends the whole order when a tag is nudged down', async () => {
    open(three);
    await rowFor('noir');

    await userEvent.click(screen.getByRole('button', { name: 'Move noir down' }));

    expect(orderTags).toHaveBeenCalledWith(['b', 'a', 'c']);
  });

  it('sends the whole order when a tag is nudged up', async () => {
    open(three);
    await rowFor('ronin');

    await userEvent.click(screen.getByRole('button', { name: 'Move ronin up' }));

    expect(orderTags).toHaveBeenCalledWith(['a', 'c', 'b']);
  });

  it('will not nudge the ends off the list', async () => {
    open(three);
    await rowFor('noir');

    expect(screen.getByRole('button', { name: 'Move noir up' })).toHaveProperty('disabled', true);
    expect(screen.getByRole('button', { name: 'Move ronin down' })).toHaveProperty(
      'disabled',
      true,
    );
  });

  /**
   * A computed view is a *view*. Offering a drag handle over one would let
   * somebody rearrange an order that is not the stored one and write the result
   * back — so the handles are absent, with the sort control right there saying
   * why.
   */
  it('offers no reordering while a computed sort is on', async () => {
    open(three);
    await rowFor('noir');

    await userEvent.selectOptions(screen.getByLabelText('Sort by'), 'name');

    expect(screen.queryByRole('button', { name: 'Move noir down' })).toBeNull();
  });

  it('sorts by name when asked, without writing anything', async () => {
    open(three);
    await rowFor('noir');

    await userEvent.selectOptions(screen.getByLabelText('Sort by'), 'name');

    const names = [...document.querySelectorAll('tbody tr')].map(
      (row) => row.querySelectorAll('td')[1]?.textContent,
    );
    expect(names).toEqual(['city', 'noir', 'ronin']);
    expect(orderTags).not.toHaveBeenCalled();
  });

  it('sorts by count when asked', async () => {
    open(three, [
      ['noir', 1],
      ['city', 9],
      ['ronin', 4],
    ]);
    await rowFor('noir');

    await userEvent.selectOptions(screen.getByLabelText('Sort by'), 'count');

    const names = [...document.querySelectorAll('tbody tr')].map(
      (row) => row.querySelectorAll('td')[1]?.textContent,
    );
    expect(names).toEqual(['city', 'ronin', 'noir']);
  });
});

describe('making a tag', () => {
  it('adds one nothing uses yet', async () => {
    open([]);

    await userEvent.type(await screen.findByLabelText('New tag'), 'ronin');
    await userEvent.click(screen.getByRole('button', { name: 'Add' }));

    expect(createTag).toHaveBeenCalledWith({ name: 'ronin' });
  });

  it('does not send an empty one', async () => {
    open([]);

    await userEvent.click(await screen.findByRole('button', { name: 'Add' }));

    expect(createTag).not.toHaveBeenCalled();
  });
});

/**
 * **Prune is a registry operation, not a library one.** An entry with a count of
 * zero is by definition carried by nothing, so removing it touches no object —
 * which is why it needs no confirmation about data, only about the entries.
 *
 * The counts come from the caller, and they have to be over the *whole* library
 * rather than a filtered shelf: pruning against a narrowed view would delete
 * entries for tags that are in use somewhere the view could not see.
 */
describe('prune', () => {
  it('removes the entries nothing carries, and only those', async () => {
    open(
      [
        entry({ id: 'a', name: 'noir' }),
        entry({ id: 'b', name: 'city' }),
        entry({ id: 'c', name: 'ronin' }),
      ],
      [['noir', 2]],
    );
    await rowFor('noir');

    await userEvent.click(screen.getByRole('button', { name: 'Prune 2 unused' }));

    expect(deleteTag.mock.calls.map((call) => call[0]).sort()).toEqual(['b', 'c']);
  });

  it('says there is nothing to do rather than offering a dead control', async () => {
    open([entry({ id: 'a', name: 'noir' })], [['noir', 1]]);
    await rowFor('noir');

    expect(screen.getByRole('button', { name: 'Nothing to prune' })).toHaveProperty(
      'disabled',
      true,
    );
  });
});

/**
 * Renaming, and the question it has to ask first — [25 §1].
 *
 * A lore entry's `actorTagFilter` holds author-written names and activation
 * compares them exactly, so a rename can stop lore firing with nothing anywhere
 * saying so. The surface reports what it found; rewriting is a second press.
 */
describe('renaming', () => {
  it('sends the new name without touching the lore gates', async () => {
    open([entry({ id: 'tag-1', name: 'noir' })]);
    const row = await rowFor('noir');

    await userEvent.click(within(row).getByRole('button', { name: 'Rename noir' }));
    const box = screen.getByRole('textbox', { name: 'New name' });
    await userEvent.clear(box);
    await userEvent.type(box, 'Noir Fiction');
    await userEvent.click(screen.getByRole('button', { name: 'Rename' }));

    expect(renameTag).toHaveBeenCalledWith('tag-1', {
      to: 'Noir Fiction',
      rewriteGates: false,
    });
  });

  it('reports the gates it found rather than acting on them', async () => {
    renameTag.mockResolvedValue({
      tags: [],
      gatesFound: [{ book: 'Ardent', entry: 'Harbour' }],
    });
    open([entry({ id: 'tag-1', name: 'noir' })]);
    const row = await rowFor('noir');

    await userEvent.click(within(row).getByRole('button', { name: 'Rename noir' }));
    await userEvent.click(screen.getByRole('button', { name: 'Rename' }));

    expect(await screen.findByText(/One lore entry gates on the old name/)).toBeTruthy();
  });

  it('rewrites them only on a second, deliberate press', async () => {
    renameTag.mockResolvedValue({
      tags: [],
      gatesFound: [{ book: 'Ardent', entry: 'Harbour' }],
    });
    open([entry({ id: 'tag-1', name: 'noir' })]);
    const row = await rowFor('noir');

    await userEvent.click(within(row).getByRole('button', { name: 'Rename noir' }));
    const box = screen.getByRole('textbox', { name: 'New name' });
    await userEvent.clear(box);
    await userEvent.type(box, 'Noir Fiction');
    await userEvent.click(screen.getByRole('button', { name: 'Rename' }));

    await userEvent.click(await screen.findByRole('button', { name: /Update them/ }));

    expect(renameTag).toHaveBeenLastCalledWith('tag-1', {
      to: 'Noir Fiction',
      rewriteGates: true,
    });
  });

  it('will not send an empty name', async () => {
    open([entry({ id: 'tag-1', name: 'noir' })]);
    const row = await rowFor('noir');

    await userEvent.click(within(row).getByRole('button', { name: 'Rename noir' }));
    await userEvent.clear(screen.getByRole('textbox', { name: 'New name' }));

    expect(screen.getByRole('button', { name: 'Rename' })).toHaveProperty('disabled', true);
  });
});

/**
 * **The one deliberate write across the library** — [25 §3]. Until it runs a
 * rename reaches nothing, because an object with no ids works from its own
 * names and has no connection to the row that changed.
 */
describe('linking tags to the library', () => {
  it('asks the server to adopt, rather than doing it on open', async () => {
    open([entry({ name: 'noir' })], [['noir', 1]]);
    await rowFor('noir');

    expect(adoptTags).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole('button', { name: 'Link tags to the library' }));

    expect(adoptTags).toHaveBeenCalledTimes(1);
  });
});
