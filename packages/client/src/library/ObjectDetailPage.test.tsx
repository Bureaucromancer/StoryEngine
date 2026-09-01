// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The detail page's first test file. P4.4 built the delete control and shipped
 * it uncovered; this is the cover, and it was written by walking the component
 * rather than the phase document — which is how both of the things it fixes
 * were found.
 *
 * **The case worth the file is the shadowed one.** Two files can hold one id;
 * `?source=&slug=` lets this page open either; and every write route resolves
 * an id to the *winner* regardless. So the Delete that P4.4 gated on `source`
 * alone would, on the losing copy, move a folder other than the one on screen —
 * F19's original bug with the stakes raised from showing the wrong object to
 * removing it. Nothing on the server can catch that, because from the server's
 * side the request is perfectly well-formed. It is caught here or not at all.
 *
 * **The second is that a refused delete used to say nothing.** The error was
 * rendered by the confirming row and the failure path collapsed that row, so a
 * 412 looked exactly like a click that had not registered.
 */

const readObject = vi.fn();
const deleteObject = vi.fn();
const authState = vi.fn();
const navigate = vi.fn();

const ACTOR_ID = '01a008de-7e08-70d0-899c-f6869d6b9aeb';

let params: { kind: string; id: string } = { kind: 'actors', id: ACTOR_ID };
let search: { slug?: string; source?: 'user' | 'system' } = {};

vi.mock('../api.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api.js')>()),
  api: {
    readObject: (...a: unknown[]) => readObject(...a) as unknown,
    deleteObject: (...a: unknown[]) => deleteObject(...a) as unknown,
    authState: (...a: unknown[]) => authState(...a) as unknown,
  },
}));

vi.mock('@tanstack/react-router', () => ({
  getRouteApi: () => ({ useParams: () => params, useSearch: () => search }),
  useNavigate: () => navigate,
  /**
   * **The stub carries the search prop**, because an entry link that dropped
   * the copy discriminator is F19 one level down — a reader of the shadowed
   * copy sent to the winner — and a stub that renders only children cannot
   * see that happen. Serialised rather than rendered as a query string so the
   * assertion reads the value the component passed rather than a formatting of
   * it.
   */
  Link: ({ children, search }: { children: React.ReactNode; search?: Record<string, unknown> }) => (
    <a href="#" data-search={JSON.stringify(search ?? {})}>
      {children}
    </a>
  ),
}));

const { ApiError } = await import('../api.js');
const { ObjectDetailPage } = await import('./ObjectDetailPage.js');

function actor(overrides: Record<string, unknown> = {}) {
  return {
    id: ACTOR_ID,
    schema: 'storyengine.actor/1',
    name: 'Vera Kohl',
    slug: 'vera-kohl',
    source: 'user' as const,
    contentHash: 'sha256:abc',
    shadowed: false,
    object: { schema: 'storyengine.actor/1', id: ACTOR_ID, name: 'Vera Kohl' },
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  params = { kind: 'actors', id: ACTOR_ID };
  search = {};
  readObject.mockResolvedValue(actor());
  deleteObject.mockResolvedValue(undefined);
  authState.mockResolvedValue({ account: { handle: 'ned', locale: null } });
});

function renderPage(): void {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <ObjectDetailPage />
    </QueryClientProvider>,
  );
}

/** The control is two-step: Delete opens the question, Delete answers it. */
async function askToDelete(): Promise<ReturnType<typeof userEvent.setup>> {
  const user = userEvent.setup();
  await user.click(await screen.findByRole('button', { name: 'Delete' }));
  return user;
}

describe('deleting a library object', () => {
  it('offers Delete on something the user owns', async () => {
    renderPage();

    expect(await screen.findByRole('button', { name: 'Delete' })).toBeTruthy();
  });

  it('does not offer Delete on a system object', async () => {
    readObject.mockResolvedValue(actor({ source: 'system' }));
    renderPage();

    // The heading proves the page rendered rather than the query still pending,
    // which is what would otherwise make this pass for the wrong reason.
    expect(await screen.findByRole('heading', { name: 'Vera Kohl' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Delete' })).toBeNull();
  });

  /**
   * The reason this file exists — see the header. Reddened by dropping
   * `!object.shadowed` from `mutable`, which is what P4.4 shipped.
   */
  it('does not offer Delete on a shadowed copy, whose id resolves elsewhere', async () => {
    search = { source: 'user', slug: 'vera-kohl-2' };
    readObject.mockResolvedValue(actor({ shadowed: true, slug: 'vera-kohl-2' }));
    renderPage();

    expect(await screen.findByRole('heading', { name: 'Vera Kohl' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Delete' })).toBeNull();
  });

  it('asks before it deletes, and sends the hash the page read', async () => {
    renderPage();
    const user = await askToDelete();

    expect(screen.getByText('Move to trash?')).toBeTruthy();
    expect(deleteObject).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Delete' }));

    expect(deleteObject).toHaveBeenCalledWith('actors', ACTOR_ID, 'sha256:abc');
  });

  it('sends nothing when the question is cancelled', async () => {
    renderPage();
    const user = await askToDelete();

    await user.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(screen.queryByText('Move to trash?')).toBeNull();
    expect(deleteObject).not.toHaveBeenCalled();
  });

  it('goes back to the library once it is gone', async () => {
    renderPage();
    const user = await askToDelete();

    await user.click(screen.getByRole('button', { name: 'Delete' }));

    await vi.waitFor(() => {
      expect(navigate).toHaveBeenCalledWith({ to: '/library' });
    });
  });

  /**
   * A 412 is the whole reason the hash is sent, and it used to be invisible:
   * the failure path collapses the confirming row and the message was rendered
   * only by that row. Reddened by moving the message back inside it.
   */
  it('says so when the file changed underneath, instead of looking like nothing happened', async () => {
    deleteObject.mockRejectedValue(
      new ApiError(412, 'stale', 'The object has changed since it was read.'),
    );
    renderPage();
    const user = await askToDelete();

    await user.click(screen.getByRole('button', { name: 'Delete' }));

    expect(await screen.findByRole('alert')).toHaveProperty(
      'textContent',
      'The object has changed since it was read.',
    );
    expect(navigate).not.toHaveBeenCalled();
  });
});

/**
 * [P5.−1] — [polish §1](../../../../docs/design/workplan/09-polish.md)'s stage,
 * and its *ends at* stated as a test: an actor's greeting is readable on its
 * detail page without opening the editor.
 *
 * The page's own share of that item is small — the field rendering is
 * [ByField](./ByField.tsx)'s and is covered there — so what is asserted here is
 * the wiring and the two decisions the page makes: that the fields come before
 * the storage block rather than after it, and that the Edit gate now asks one
 * question instead of naming a kind twice.
 */
describe('reading an object without opening the editor', () => {
  const GREETING = 'She looks up.\n\n"You came."';

  function withGreeting() {
    return actor({
      object: {
        schema: 'storyengine.actor/1',
        id: ACTOR_ID,
        name: 'Vera Kohl',
        openings: {
          written: [{ id: 'op-1', label: 'At the door', text: GREETING }],
          seeds: [],
          primaryWrittenId: 'op-1',
          primarySeedId: null,
        },
      },
    });
  }

  it('shows the greeting on the page, with its paragraphs', async () => {
    readObject.mockResolvedValue(withGreeting());
    renderPage();

    await screen.findByRole('heading', { name: 'Vera Kohl' });

    const shown = [...document.querySelectorAll('p')].find((node) => node.textContent === GREETING);
    expect(shown).toBeTruthy();
  });

  /**
   * Order is the item's argument, not decoration: its complaint is that this
   * page answers *where is this file* when the question was *what does it say*,
   * and seven rows of path and hash above the prose would answer in the old
   * order with a new component underneath.
   */
  it('puts the fields above the storage block, which keeps its own heading', async () => {
    readObject.mockResolvedValue(withGreeting());
    renderPage();

    const storage = await screen.findByRole('heading', { name: 'Storage', level: 2 });
    const greeting = [...document.querySelectorAll('p')].find(
      (node) => node.textContent === GREETING,
    );

    expect(greeting).toBeTruthy();
    expect(
      greeting!.compareDocumentPosition(storage) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it('offers Edit on a kind that has an editor', async () => {
    renderPage();

    expect(await screen.findByRole('link', { name: 'Edit' })).toBeTruthy();
  });

  /** Five kinds have no editor to land in, and the gate is one lookup now. */
  it('does not offer Edit on a kind that has none', async () => {
    params = { kind: 'lorebooks', id: ACTOR_ID };
    readObject.mockResolvedValue(actor({ schema: 'storyengine.lorebook/1' }));
    renderPage();

    expect(await screen.findByRole('heading', { name: 'Vera Kohl' })).toBeTruthy();
    expect(screen.queryByRole('link', { name: 'Edit' })).toBeNull();
  });
});

/**
 * [P5.0] — the detail route renders a lorebook as a book, and renders a file
 * that is not one as whatever it actually is.
 *
 * **The second is the one worth the test.** A hand-edited card is the storage
 * thesis working ([00 §3.4]), so a book page that threw on a file whose
 * `entries` is a string would be answering the invited input with a white
 * screen. Found by mutation: dropping the shape guard left every other
 * assertion green, because no test reached the page with a broken book.
 */
describe('a lorebook on the detail route', () => {
  function lorebook(over: Record<string, unknown>) {
    const { shadowed, ...body } = over;
    return actor({
      schema: 'storyengine.lorebook/1',
      name: 'Ardent',
      ...(shadowed === undefined ? {} : { shadowed }),
      object: {
        schema: 'storyengine.lorebook/1',
        id: ACTOR_ID,
        name: 'Ardent',
        description: '',
        enabled: true,
        scanDepth: 2,
        tokenBudget: 2048,
        entryLimit: 100,
        recursiveScanning: false,
        maxRecursionDepth: 3,
        tags: [],
        folders: [],
        entries: [],
        ...body,
      },
    });
  }

  it('reads as a book rather than as a field list', async () => {
    params = { kind: 'lorebooks', id: ACTOR_ID };
    readObject.mockResolvedValue(
      lorebook({
        entries: [{ id: 'e1', name: 'Harbour', content: 'Cranes.', keys: [], enabled: true }],
      }),
    );
    renderPage();

    await screen.findByRole('heading', { name: 'Ardent' });
    expect(screen.getByRole('heading', { name: 'Harbour', level: 3 })).toBeTruthy();
    expect(screen.getByText('Cranes.')).toBeTruthy();
  });

  /**
   * **F19, one level down.** Two files can hold one id, this page can be
   * addressed at either through `?source=` and `?slug=`, and an entry link that
   * dropped them would send a reader of the shadowed copy to the winner — the
   * same bug the row link was fixed for, wearing an entry id. The current
   * search is spread into every entry address for exactly this reason.
   */
  it('carries the copy discriminator into every entry address', async () => {
    params = { kind: 'lorebooks', id: ACTOR_ID };
    search = { source: 'user', slug: 'ardent-2' };
    readObject.mockResolvedValue(
      lorebook({
        shadowed: true,
        entries: [{ id: 'e-1', name: 'Harbour', content: 'Cranes.', keys: [], enabled: true }],
      }),
    );
    renderPage();

    await screen.findByRole('heading', { name: 'Ardent' });
    const entryLink = screen.getByRole('link', { name: 'Harbour' });

    expect(JSON.parse(entryLink.getAttribute('data-search') ?? '{}')).toEqual({
      source: 'user',
      slug: 'ardent-2',
      entry: 'e-1',
    });
  });

  it('falls back to the field list when the file is not a book, rather than failing', async () => {
    params = { kind: 'lorebooks', id: ACTOR_ID };
    readObject.mockResolvedValue(lorebook({ entries: 'someone hand-edited this' }));
    renderPage();

    // The page renders, and it renders what is on disk: the by-field view shows
    // the field as the string it now is, and no book page claims otherwise.
    await screen.findByRole('heading', { name: 'Ardent' });
    expect(screen.getByText('someone hand-edited this')).toBeTruthy();
    expect(screen.queryByRole('columnheader', { name: 'Gate' })).toBeNull();
  });
});
