// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState, type JSX } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Member } from './members-form.js';

/**
 * ***A World's member list, drawn and written*** —
 * [P16.1](../../../../docs/design/workplan/35-p16-world.md),
 * [15 §3.1](../../../../docs/design/15-world.md).
 *
 * **What is being defended.** The stage's end condition says *a dangling
 * reference, visible and non-blocking, being the correct outcome* — so the
 * first claim is that a member the library no longer holds is drawn **in its
 * place**, under the name the World last knew, with a badge, and is not taken
 * out of the list by anything but a person. The second is the picker's scope:
 * your objects of every kind but a World, and your sessions, with what is
 * already held shown as held. Both are silent when wrong — an auto-removing
 * field and a picker offering the system's presets each look like they work.
 */

const listLibrary = vi.fn();
const listSessions = vi.fn();

vi.mock('../api.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../api.js')>();
  return {
    ...actual,
    listSessions: (...a: unknown[]) => listSessions(...a) as unknown,
    api: { ...actual.api, listLibrary: (...a: unknown[]) => listLibrary(...a) as unknown },
  };
});

const { MembersField } = await import('./MembersField.js');

function object(id: string, name: string, schema: string, source: 'user' | 'system' = 'user') {
  return {
    id,
    name,
    schema,
    slug: id,
    source,
    contentHash: 'sha256:x',
    shadowed: false,
    object: {},
  };
}

const LIBRARY = [
  object('book-rain', 'Rain City, revised', 'storyengine.lorebook/1'),
  object('actor-vera', 'Vera Kohl', 'storyengine.actor/1'),
  object('treat-wet', 'A wet week', 'storyengine.treatment/1'),
  object('preset-sys', 'Shipped preset', 'storyengine.preset/1', 'system'),
  object('world-other', 'Another world', 'storyengine.world/1'),
];

const SESSIONS = [
  {
    id: 's-1',
    name: 'The docks',
    createdAt: '2026-10-01T00:00:00Z',
    updatedAt: '2026-10-01T00:00:00Z',
    headTurnId: null,
  },
];

const BOOK: Member = { schema: 'storyengine.lorebook/1', id: 'book-rain', name: 'Rain City' };
const GONE: Member = { schema: 'storyengine.actor/1', id: 'actor-gone', name: 'Old Tom' };
const GONE_SESSION: Member = { schema: 'storyengine.session/1', id: 's-gone', name: 'Last week' };

/** What the field last wrote, read off the harness — the half a rendering cannot show. */
let written: Member[] = [];

function Harness(props: { initial: Member[] }): JSX.Element {
  const [members, setMembers] = useState(props.initial);
  return (
    <MembersField
      members={members}
      onChange={(update) => {
        setMembers((current) => {
          const next = update(current);
          written = next;
          return next;
        });
      }}
    />
  );
}

function renderField(initial: Member[]): void {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <Harness initial={initial} />
    </QueryClientProvider>,
  );
}

function rows(): HTMLElement[] {
  const region = screen.getByRole('region', { name: 'Members' });
  return within(region).queryAllByRole('listitem');
}

function row(at: number): HTMLElement {
  const found = rows()[at];
  if (found === undefined) throw new Error(`There is no member row ${String(at)}.`);
  return found;
}

beforeEach(() => {
  vi.clearAllMocks();
  written = [];
  listLibrary.mockResolvedValue({ objects: LIBRARY });
  listSessions.mockResolvedValue({ sessions: SESSIONS });
});

describe('the member list', () => {
  /** A reference sees the edit: the World holds an id, and the name is the object's now. */
  it('names a member by what it is called now, not by what it was called when added', async () => {
    renderField([BOOK]);

    expect(await screen.findByText('Rain City, revised')).toBeTruthy();
    expect(screen.queryByText('Rain City')).toBeNull();
  });

  /**
   * ***The dangling reference, in place*** — [15 §3.1]. Between two members
   * that resolve, under its stored name, badged with the sentence — and still
   * in the list, because nothing here removes it on anybody's behalf.
   */
  it('draws a missing member in its place, under its stored name, and keeps it', async () => {
    renderField([BOOK, GONE, GONE_SESSION]);
    await screen.findByText('Rain City, revised');

    expect(rows()).toHaveLength(3);
    expect(row(0).textContent).toContain('Rain City, revised');
    expect(row(1).textContent).toContain('Old Tom');
    expect(row(2).textContent).toContain('Last week');

    const badge = within(row(1)).getByText('Missing');
    expect(badge.getAttribute('title')).toBe(
      'Not in your library any more — it was deleted or never arrived. The world keeps naming it; remove it here if you no longer want it.',
    );
    expect(within(row(2)).getByText('Missing').getAttribute('title')).toContain(
      'Not among your sessions any more',
    );
    expect(within(row(0)).queryByText('Missing')).toBeNull();
    // Shown, never removed: nothing was written by drawing it.
    expect(written).toEqual([]);
  });

  /** A slow list is not a deletion. */
  it('marks nothing missing while the library has not answered', async () => {
    listLibrary.mockReturnValue(new Promise(() => undefined));
    renderField([GONE]);
    await screen.findByText('Old Tom');

    expect(screen.queryByText('Missing')).toBeNull();
  });

  it('removes the row that was pressed', async () => {
    const user = userEvent.setup();
    renderField([BOOK, GONE]);
    await screen.findByText('Old Tom');

    await user.click(screen.getByRole('button', { name: 'Remove Old Tom' }));

    expect(written).toEqual([BOOK]);
    expect(rows()).toHaveLength(1);
  });
});

describe('adding members', () => {
  async function openPicker(): Promise<ReturnType<typeof userEvent.setup>> {
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Add members' }));
    await screen.findByRole('heading', { name: 'Actors' });
    return user;
  }

  /**
   * ***Yours, every kind but a World, and your sessions*** — [15 §3.1]'s *not
   * another World*, P16.1's *objects you own*. The system's preset and the
   * other World are on the shelf the picker reads and must not be offered.
   */
  it('offers your objects and sessions, and neither the system’s nor another world', async () => {
    renderField([]);
    await openPicker();

    expect(screen.getByRole('button', { name: 'Add Vera Kohl' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Add The docks' })).toBeTruthy();
    expect(screen.queryByText('Shipped preset')).toBeNull();
    expect(screen.queryByText('Another world')).toBeNull();
  });

  it('appends the envelope, and shows it as held from then on', async () => {
    renderField([BOOK]);
    const user = await openPicker();

    await user.click(screen.getByRole('button', { name: 'Add The docks' }));

    expect(written).toEqual([
      BOOK,
      { schema: 'storyengine.session/1', id: 's-1', name: 'The docks' },
    ]);
    expect(screen.queryByRole('button', { name: 'Add The docks' })).toBeNull();
    // The book was held before the picker opened.
    expect(screen.queryByRole('button', { name: 'Add Rain City, revised' })).toBeNull();
    expect(screen.getAllByText('In this world')).toHaveLength(2);
  });

  /** AA11: a real library is hundreds of objects, so the list narrows as it is typed. */
  it('narrows by name and by kind', async () => {
    renderField([]);
    const user = await openPicker();

    await user.type(screen.getByRole('textbox', { name: 'Find by name' }), 'vera');
    expect(screen.getByRole('button', { name: 'Add Vera Kohl' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Add A wet week' })).toBeNull();

    await user.clear(screen.getByRole('textbox', { name: 'Find by name' }));
    await user.selectOptions(screen.getByRole('combobox', { name: 'Kind' }), 'session');
    expect(screen.getByRole('button', { name: 'Add The docks' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Add Vera Kohl' })).toBeNull();
  });

  it('does not offer worlds as a kind to narrow to', async () => {
    renderField([]);
    await openPicker();

    const kinds = within(screen.getByRole('combobox', { name: 'Kind' }))
      .getAllByRole('option')
      .map((option) => option.textContent);
    expect(kinds).not.toContain('Worlds');
    expect(kinds).toContain('Sessions');
  });
});

describe('the picker inside the editor’s form', () => {
  /** Enter narrows the list; the form around it is not submitted, so nothing saves. */
  it('does not submit the World when Enter is pressed in the name filter', async () => {
    const submitted = vi.fn((event: { preventDefault: () => void }) => {
      event.preventDefault();
    });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <form onSubmit={submitted}>
          <Harness initial={[]} />
        </form>
      </QueryClientProvider>,
    );
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Add members' }));
    await user.type(screen.getByLabelText('Find by name'), 'vera{Enter}');

    expect(submitted).not.toHaveBeenCalled();
  });
});
