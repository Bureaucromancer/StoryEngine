// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { act, render, screen, waitFor } from '@testing-library/react';
import { StrictMode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The pages before sign-in carry the build line too — [P6A §1.5], alpha.2.
 * *Every page* includes the two a person sees before they have an account,
 * which the Shell never renders, so `Gate` frames them itself.
 *
 * `App` uses the `queries.ts` singleton client, so it is cleared per test
 * rather than replaced. The unreachable branch is left alone here: its retry
 * costs a second, and its subject is not this.
 */

const authState = vi.fn();

vi.mock('./api.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./api.js')>()),
  api: {
    authState: (...a: unknown[]) => authState(...a) as unknown,
    setup: vi.fn(),
    login: vi.fn(),
  },
}));

/**
 * The signed-in app itself is not what these tests are about — only whether the
 * gate keeps it, and what the gate does to the cache — so the router is a line
 * of text. The real one mounts every page, and every page asks the API for
 * things this file does not serve.
 */
vi.mock('@tanstack/react-router', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tanstack/react-router')>()),
  RouterProvider: () => <p>The signed-in app</p>,
}));

const { App } = await import('./App.js');
const { queryClient } = await import('./queries.js');

const ALPHA = { version: '1.0.0-alpha.2', commit: '7573e8a0' };

beforeEach(() => {
  vi.clearAllMocks();
  queryClient.clear();
});

describe('the build line before sign-in', () => {
  it('is under the setup form', async () => {
    authState.mockResolvedValue({
      setupRequired: true,
      setupTokenRequired: false,
      loginScreen: 'form',
      account: null,
      minPasswordLength: 8,
      build: ALPHA,
    });
    render(<App />);

    expect(await screen.findByRole('button', { name: 'Create account' })).toBeTruthy();
    expect(screen.getByRole('contentinfo').textContent).toContain('StoryEngine 1.0-alpha 2');
  });

  it('is under the login form, and says a development build is one', async () => {
    authState.mockResolvedValue({
      setupRequired: false,
      setupTokenRequired: false,
      loginScreen: 'form',
      account: null,
      minPasswordLength: 8,
      build: null,
    });
    render(<App />);

    expect(await screen.findByRole('button', { name: 'Sign in' })).toBeTruthy();
    expect(screen.getByRole('contentinfo').textContent).toContain('development build');
  });
});

function signedIn(handle: string): Record<string, unknown> {
  return {
    setupRequired: false,
    setupTokenRequired: false,
    loginScreen: 'form',
    account: { handle, displayName: handle, role: 'user', locale: null },
    minPasswordLength: 8,
    build: ALPHA,
  };
}

/**
 * ***A signed-in app is not torn down by a failed refetch*** (2026-09-27).
 * `isError` is also true when a *background* refetch fails with the last answer
 * still held — refocusing the tab while the server restarts — and the gate used
 * to swap the whole app, every unsaved draft in it, for *could not be reached*.
 */
describe('the gate, once signed in', () => {
  it('keeps the app when a background refetch of who is signed in fails', async () => {
    authState.mockResolvedValue(signedIn('ned'));
    render(<App />);
    expect(await screen.findByText('The signed-in app')).toBeTruthy();

    authState.mockRejectedValue(new TypeError('Failed to fetch'));
    await act(async () => {
      await queryClient.refetchQueries({ queryKey: ['auth', 'state'] });
    });
    expect(queryClient.getQueryState(['auth', 'state'])?.status).toBe('error');
    // The query tells its observers on a timer rather than at once, so the gate
    // has to be given the moment to hear that the refetch failed — without it
    // this would pass for a gate that never looked.
    await act(async () => {
      await new Promise((resolve) => {
        setTimeout(resolve, 50);
      });
    });

    expect(screen.getByText('The signed-in app')).toBeTruthy();
    expect(screen.queryByText(/could not be reached/)).toBeNull();
  });

  /**
   * ***What was cached belongs to the account that cached it.*** A switch made in
   * another tab — one account straight to another — kept the first account's
   * library in the cache for the second to be shown.
   */
  it('forgets what the last account had cached when another is signed in', async () => {
    authState.mockResolvedValue(signedIn('ned'));
    render(<App />);
    await screen.findByText('The signed-in app');
    queryClient.setQueryData(['library', 'all'], { objects: [{ id: 'neds-card' }] });

    authState.mockResolvedValue(signedIn('sam'));
    await act(async () => {
      await queryClient.refetchQueries({ queryKey: ['auth', 'state'] });
    });

    await waitFor(() => {
      expect(queryClient.getQueryData(['library', 'all'])).toBeUndefined();
    });
    expect(queryClient.getQueryData(['auth', 'state'])).toMatchObject({
      account: { handle: 'sam' },
    });
  });

  /**
   * *Only a change resets.* StrictMode runs an effect twice on mount, and a gate
   * mounting on an account the cache already knows would otherwise read its own
   * second run as *somebody else signed in* and empty the cache it is about to
   * render from.
   */
  it('keeps the cache when it mounts on the account it already knows', async () => {
    authState.mockResolvedValue(signedIn('ned'));
    queryClient.setQueryData(['auth', 'state'], signedIn('ned'));
    queryClient.setQueryData(['library', 'all'], { objects: [{ id: 'neds-card' }] });

    render(
      <StrictMode>
        <App />
      </StrictMode>,
    );
    await screen.findByText('The signed-in app');
    await act(async () => {
      await new Promise((resolve) => {
        setTimeout(resolve, 50);
      });
    });

    expect(queryClient.getQueryData(['library', 'all'])).toEqual({
      objects: [{ id: 'neds-card' }],
    });
  });
});
