// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The detail page's first test file, added with the Delete affordance it exists
 * to cover ([P4.−1]).
 *
 * **The case worth the file is the shadowed one.** Two files can hold one id;
 * `?source=&slug=` lets this page open either; and every write route resolves
 * an id to the *winner* regardless. So an offered Delete on the losing copy
 * would move a folder other than the one on screen — F19's original bug with
 * the stakes raised from showing the wrong object to removing it. Nothing on
 * the server can catch that, because from the server's side the request is
 * perfectly well-formed. It is caught here or not at all.
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

async function openTheDialog(): Promise<ReturnType<typeof userEvent.setup>> {
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
   * `!object.shadowed` from `mutable`.
   */
  it('does not offer Delete on a shadowed copy, whose id resolves elsewhere', async () => {
    search = { source: 'user', slug: 'vera-kohl-2' };
    readObject.mockResolvedValue(actor({ shadowed: true, slug: 'vera-kohl-2' }));
    renderPage();

    expect(await screen.findByRole('heading', { name: 'Vera Kohl' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Delete' })).toBeNull();
  });

  it('sends the hash the page read, and says what it did not check', async () => {
    renderPage();
    const user = await openTheDialog();

    const dialog = screen.getByRole('dialog');
    // The dialog is honest about the reference counts [02 §10.1] specifies and
    // this build cannot compute. Losing that sentence is a silent regression:
    // the dialog would still work and would start implying a check it never ran.
    expect(within(dialog).getByText(/Nothing checks what refers to this/)).toBeTruthy();

    await user.click(within(dialog).getByRole('button', { name: 'Delete it' }));

    expect(deleteObject).toHaveBeenCalledWith('actors', ACTOR_ID, 'sha256:abc');
  });

  it('sends nothing when the dialog is dismissed', async () => {
    renderPage();
    const user = await openTheDialog();

    await user.click(screen.getByRole('button', { name: 'Keep it' }));

    expect(screen.queryByRole('dialog')).toBeNull();
    expect(deleteObject).not.toHaveBeenCalled();
  });

  it('goes back to the library once it is gone', async () => {
    renderPage();
    const user = await openTheDialog();

    await user.click(screen.getByRole('button', { name: 'Delete it' }));

    await vi.waitFor(() => {
      expect(navigate).toHaveBeenCalledWith({ to: '/library', search: {} });
    });
  });

  /**
   * A 412 is the whole reason the hash is sent. The object stays where it is
   * and the page says *why* rather than showing the server's own wording, which
   * describes a read the user never saw.
   */
  it('keeps the object and explains itself when the file changed underneath', async () => {
    deleteObject.mockRejectedValue(
      new ApiError(412, 'stale', 'The object has changed since it was read.'),
    );
    renderPage();
    const user = await openTheDialog();

    await user.click(screen.getByRole('button', { name: 'Delete it' }));

    expect(await screen.findByRole('alert')).toHaveProperty(
      'textContent',
      expect.stringContaining('changed on disk'),
    );
    expect(navigate).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog')).toBeTruthy();
  });
});
