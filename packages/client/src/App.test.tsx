// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { render, screen } from '@testing-library/react';
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
      account: null,
      minPasswordLength: 8,
      build: null,
    });
    render(<App />);

    expect(await screen.findByRole('button', { name: 'Sign in' })).toBeTruthy();
    expect(screen.getByRole('contentinfo').textContent).toContain('development build');
  });
});
