// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The second front door, as a person meets it —
 * [12](../../../../docs/design/12-account-gallery.md), [P10.4].
 *
 * ***The claim worth testing is [12 §9]'s***: *"a tile always leads to password
 * entry… the tile changes what you see, never what authenticates you."*
 * SillyTavern lets a passwordless user click straight through, and this
 * deliberately refuses that — so *picking a face signs you in* is the failure
 * to hold this against, not a missing feature.
 *
 * **The falsifying mutation is having the tile call `login`.** Every assertion
 * about the grid rendering still passes.
 */

const gallery = vi.fn();
const login = vi.fn();

vi.mock('../api.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api.js')>()),
  api: {
    gallery: (...a: unknown[]) => gallery(...a) as unknown,
    login: (...a: unknown[]) => login(...a) as unknown,
  },
}));

const { Gallery } = await import('./Gallery.js');

function entry(over: Record<string, unknown> = {}) {
  return { handle: 'ned', displayName: 'Ned Carlson', avatar: null, ...over };
}

beforeEach(() => {
  vi.clearAllMocks();
  gallery.mockResolvedValue({
    accounts: [entry(), entry({ handle: 'mara', displayName: 'Mara' })],
  });
  login.mockResolvedValue({ account: { handle: 'ned' } });
});

function mount(): void {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <Gallery />
    </QueryClientProvider>,
  );
}

describe('the grid', () => {
  it('shows a tile per account, named by its display name', async () => {
    mount();

    expect(await screen.findByRole('button', { name: 'Ned Carlson' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Mara' })).toBeTruthy();
  });

  /**
   * ***Not self-registration, and there is no *new account* tile*** —
   * [12 §9]. A grid of accounts is a shape that invites the extra tile, which
   * is why the plan says so twice and why this asserts the absence.
   */
  it('offers no way to make an account', async () => {
    mount();
    await screen.findByRole('button', { name: 'Ned Carlson' });

    for (const name of [/new account/i, /create/i, /sign up/i, /register/i]) {
      expect(screen.queryByRole('button', { name })).toBeNull();
    }
  });

  it('says something rather than nothing when everybody opted out', async () => {
    gallery.mockResolvedValue({ accounts: [] });
    mount();

    // A blank screen with a heading reads as broken, and an empty gallery is
    // reachable on purpose — every account can opt out ([12 §4]).
    expect(await screen.findByText(/nobody on this install is shown here/i)).toBeTruthy();
  });
});

describe('picking a face', () => {
  /**
   * ***[12 §9]'s refusal, asserted as behaviour.*** A tile leads to password
   * entry; `POST /api/auth/login` is byte-for-byte the same request from either
   * door, and nothing is sent by clicking.
   */
  it('goes to the password box and signs nobody in', async () => {
    mount();
    await userEvent.click(await screen.findByRole('button', { name: 'Ned Carlson' }));

    const handle = await screen.findByLabelText('Handle');
    expect((handle as HTMLInputElement).value).toBe('ned');
    expect(screen.getByLabelText('Password')).toBeTruthy();
    expect(login).not.toHaveBeenCalled();
  });

  /**
   * *`presetHandle` fills the box; it does not lock it.* Somebody who picked
   * the wrong face types over it, which is better than a disabled field whose
   * only escape is a Back button.
   */
  it('lets you type over the handle it filled in', async () => {
    mount();
    await userEvent.click(await screen.findByRole('button', { name: 'Ned Carlson' }));

    const handle = await screen.findByLabelText('Handle');
    await userEvent.clear(handle);
    await userEvent.type(handle, 'ada');
    expect((handle as HTMLInputElement).value).toBe('ada');
  });

  it('can go back to the faces', async () => {
    mount();
    await userEvent.click(await screen.findByRole('button', { name: 'Ned Carlson' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Back to the faces' }));

    expect(await screen.findByRole('button', { name: 'Mara' })).toBeTruthy();
  });
});

describe('the way in that always works', () => {
  /**
   * **A person who cannot find their tile needs the form on the same screen**,
   * which is why the by-name switch is local state rather than a different
   * install — [12 §2].
   */
  it('offers sign in by name, and it is the plain form', async () => {
    mount();
    await userEvent.click(await screen.findByRole('button', { name: 'Sign in by name' }));

    const handle = await screen.findByLabelText('Handle');
    expect((handle as HTMLInputElement).value).toBe('');
    // No way back, because there was nothing to come back from: this is the
    // form door, reached deliberately.
    expect(screen.queryByRole('button', { name: 'Back to the faces' })).toBeNull();
  });

  /**
   * ***A failed listing falls through to the form rather than to an error.***
   * The gallery is a way in, not the only one, and a screen saying *the
   * accounts could not be read* would be telling somebody about a request they
   * did not make.
   */
  it('falls through to the form when the listing fails', async () => {
    gallery.mockRejectedValue(new Error('nope'));
    mount();

    await waitFor(() => {
      expect(screen.getByLabelText('Handle')).toBeTruthy();
    });
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
