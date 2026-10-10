// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * ***A session's Worlds, from the session's side*** —
 * [P16.1](../../../../docs/design/workplan/35-p16-world.md),
 * [P16 §1.2](../../../../docs/design/workplan/35-p16-world.md).
 *
 * **Two claims, and both are about where membership is written.** *Add to a
 * world* must post the session's envelope to the World — `{ schema:
 * 'storyengine.session/1', id, name }`, through the members route and not a
 * whole-object write this page never read — and must offer only the Worlds it
 * can usefully add to. *In these worlds* must be the reverse query over the
 * Worlds' `contents`, since a session carries no World of its own. Each is
 * wrong silently: a control offering the system's World fails only at the
 * server, and a backlink read from anywhere else agrees until it does not.
 */

const listLibrary = vi.fn();
const addWorldMembers = vi.fn();

vi.mock('../api.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../api.js')>();
  return {
    ...actual,
    api: {
      ...actual.api,
      listLibrary: (...a: unknown[]) => listLibrary(...a) as unknown,
      addWorldMembers: (...a: unknown[]) => addWorldMembers(...a) as unknown,
    },
  };
});

vi.mock('@tanstack/react-router', () => ({
  Link: (props: { params?: { kind?: string; id?: string }; children?: ReactNode }) => (
    <a href={`/library/${props.params?.kind ?? ''}/${props.params?.id ?? ''}`}>{props.children}</a>
  ),
}));

const { AddToWorld, InTheseWorlds } = await import('./SessionWorlds.js');

const SESSION_ID = 's-docks';

function world(
  id: string,
  name: string,
  contents: { schema: string; id: string; name?: string }[],
  over: { source?: 'user' | 'system'; shadowed?: boolean } = {},
) {
  return {
    id,
    name,
    schema: 'storyengine.world/1',
    slug: id,
    source: over.source ?? 'user',
    contentHash: `sha256:${id}`,
    shadowed: over.shadowed ?? false,
    object: { schema: 'storyengine.world/1', id, name, contents },
  };
}

const HOLDING = world('w-rain', 'Rain City', [
  { schema: 'storyengine.lorebook/1', id: 'book-rain' },
  { schema: 'storyengine.session/1', id: SESSION_ID, name: 'The docks' },
]);
const EMPTY = world('w-harbour', 'The harbour set', []);
const SHIPPED = world('w-shipped', 'Shipped world', [], { source: 'system' });
const SHIPPED_HOLDING = world(
  'w-shipped-2',
  'A shipped world naming it',
  [{ schema: 'storyengine.session/1', id: SESSION_ID }],
  { source: 'system' },
);

function renderWith(node: ReactNode): QueryClient {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={client}>{node}</QueryClientProvider>);
  return client;
}

beforeEach(() => {
  vi.clearAllMocks();
  listLibrary.mockResolvedValue({ objects: [HOLDING, EMPTY, SHIPPED, SHIPPED_HOLDING] });
  addWorldMembers.mockResolvedValue({ contentHash: 'sha256:after', object: {} });
});

describe('add to a world', () => {
  /**
   * The envelope, to the World chosen, through the members route — the one
   * write P16 §1.2 allows from outside a World's editor.
   */
  it('posts the session’s envelope to the world chosen', async () => {
    const user = userEvent.setup();
    renderWith(<AddToWorld sessionId={SESSION_ID} name="The docks" />);

    await user.click(screen.getByRole('button', { name: 'Add to a world: The docks' }));
    const form = await screen.findByRole('form', { name: 'Add The docks to a world' });
    await user.click(within(form).getByRole('button', { name: 'Add' }));

    await waitFor(() => {
      expect(addWorldMembers).toHaveBeenCalledWith('w-harbour', [
        { schema: 'storyengine.session/1', id: SESSION_ID, name: 'The docks' },
      ]);
    });
    expect((await screen.findByRole('status')).textContent).toBe('Added to The harbour set.');
  });

  /**
   * ***Yours, and not already holding it.*** The system's World is read-only
   * to every account, and the one that already holds the session would accept
   * the add and change nothing — a button that does not appear to work.
   */
  it('offers only your worlds that do not already hold it', async () => {
    const user = userEvent.setup();
    renderWith(<AddToWorld sessionId={SESSION_ID} name="The docks" />);

    await user.click(screen.getByRole('button', { name: 'Add to a world: The docks' }));
    const select = await screen.findByRole('combobox', { name: 'World' });
    const offered = within(select)
      .getAllByRole('option')
      .map((option) => option.textContent);

    expect(offered).toEqual(['The harbour set']);
  });

  it('says so when every world of yours already holds it', async () => {
    const user = userEvent.setup();
    listLibrary.mockResolvedValue({ objects: [HOLDING, SHIPPED] });
    renderWith(<AddToWorld sessionId={SESSION_ID} name="The docks" />);

    await user.click(screen.getByRole('button', { name: 'Add to a world: The docks' }));

    expect(
      await screen.findByText('Every world of yours already holds this session.'),
    ).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Add' })).toBeNull();
  });

  /** An unnamed session is a member with no name, not one named after the placeholder. */
  it('writes no name for a session that has none', async () => {
    const user = userEvent.setup();
    renderWith(<AddToWorld sessionId="s-unnamed" name="" />);

    await user.click(screen.getByRole('button', { name: 'Add to a world: Untitled session' }));
    await user.selectOptions(await screen.findByRole('combobox', { name: 'World' }), 'w-rain');
    await user.click(screen.getByRole('button', { name: 'Add' }));

    await waitFor(() => {
      expect(addWorldMembers).toHaveBeenCalledWith('w-rain', [
        { schema: 'storyengine.session/1', id: 's-unnamed' },
      ]);
    });
  });

  /** `RenameSession`'s polish-10 rule: the keyboard goes into the prompt and comes back. */
  it('puts the keyboard in the prompt, and gives it back on Cancel', async () => {
    const user = userEvent.setup();
    renderWith(<AddToWorld sessionId={SESSION_ID} name="The docks" />);

    await user.click(screen.getByRole('button', { name: 'Add to a world: The docks' }));
    await waitFor(() => {
      expect(document.activeElement).toBe(screen.getByRole('combobox', { name: 'World' }));
    });

    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(document.activeElement).toBe(
      screen.getByRole('button', { name: 'Add to a world: The docks' }),
    );
  });

  /** The Worlds list is what *In these worlds* reads, so the add has to refresh it. */
  it('refreshes the worlds list after an add', async () => {
    const user = userEvent.setup();
    const client = renderWith(<AddToWorld sessionId={SESSION_ID} name="The docks" />);
    const invalidate = vi.spyOn(client, 'invalidateQueries');

    await user.click(screen.getByRole('button', { name: 'Add to a world: The docks' }));
    await user.click(await screen.findByRole('button', { name: 'Add' }));

    await waitFor(() => {
      expect(invalidate).toHaveBeenCalledWith({ queryKey: ['library'] });
    });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['editor', 'worlds', 'w-harbour'] });
  });
});

describe('in these worlds', () => {
  /**
   * The reverse query — every World whose `contents` names the session,
   * whoever owns it, each linking to the World's page.
   */
  it('lists the worlds whose members name the session, each linking to it', async () => {
    renderWith(<InTheseWorlds sessionId={SESSION_ID} />);

    const region = await screen.findByRole('region', { name: 'In these worlds' });
    const links = within(region).getAllByRole('link');
    expect(links.map((one) => [one.textContent, one.getAttribute('href')])).toEqual([
      ['Rain City', '/library/worlds/w-rain'],
      ['A shipped world naming it', '/library/worlds/w-shipped-2'],
    ]);
  });

  /**
   * ***Nothing, once the list has answered*** — not merely before it has. A
   * second line for a session that *is* in a World shares the one query, so
   * its appearing is the proof the answer arrived; asserting absence straight
   * after the request went out would pass for a component that drew the line
   * for every session, since nothing is drawn while the list is pending.
   */
  it('draws nothing for a session in no world', async () => {
    renderWith(
      <>
        <InTheseWorlds sessionId={SESSION_ID} />
        <div data-testid="alone">
          <InTheseWorlds sessionId="s-alone" />
        </div>
      </>,
    );

    await screen.findByRole('region', { name: 'In these worlds' });
    expect(screen.getAllByRole('region', { name: 'In these worlds' })).toHaveLength(1);
    expect(
      within(screen.getByTestId('alone')).queryByRole('region', { name: 'In these worlds' }),
    ).toBeNull();
  });

  /**
   * ***A World whose list a hand edit broke is skipped, not thrown on.*** The
   * row is whatever the server read off disk, and this line sits on the play
   * page with no error boundary above it — a `null` member read as an
   * envelope would take the whole application down rather than one World.
   */
  it('skips a member that is not an envelope rather than throwing on it', async () => {
    listLibrary.mockResolvedValue({
      objects: [
        world('w-mangled', 'Mangled by hand', [
          null as unknown as { schema: string; id: string },
          { schema: 'storyengine.session/1', id: SESSION_ID },
        ]),
      ],
    });
    renderWith(<InTheseWorlds sessionId={SESSION_ID} />);

    const region = await screen.findByRole('region', { name: 'In these worlds' });
    expect(within(region).getByRole('link', { name: 'Mangled by hand' })).toBeTruthy();
  });
});
