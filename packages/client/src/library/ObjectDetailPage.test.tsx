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
  Link: ({ children }: { children: React.ReactNode }) => <a href="#">{children}</a>,
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
