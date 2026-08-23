// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { JSX } from 'react';

/**
 * The two forms that exist before a session does — [05 §15](../../../../docs/design/05-ui-surfaces.md).
 *
 * There was no test file here at all, which is how the setup form's hardcoded
 * `minLength={8}` survived becoming wrong. The claims worth pinning are the two
 * that only appear once `auth.minPasswordLength` can be zero: that the rule
 * shown is the server's, and that the login form will submit an empty password
 * rather than block it in the browser.
 */

const setup = vi.fn();
const login = vi.fn();

vi.mock('../api.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api.js')>()),
  api: {
    setup: (...args: unknown[]) => setup(...args) as unknown,
    login: (...args: unknown[]) => login(...args) as unknown,
  },
}));

const { LoginForm, SetupForm } = await import('./forms.js');

beforeEach(() => {
  vi.clearAllMocks();
});

function renderForm(element: JSX.Element) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={client}>{element}</QueryClientProvider>);
}

describe('the setup form states this install’s rule', () => {
  it('shows the configured minimum rather than a number from the build', () => {
    renderForm(<SetupForm minPasswordLength={12} />);

    expect(screen.getByText('At least 12 characters.')).toBeTruthy();
    expect(screen.getByLabelText('Password').getAttribute('minlength')).toBe('12');
  });

  it('says a blank box is allowed when there is no minimum', () => {
    // Not "At least 0 characters", which reads as a bug rather than as a
    // setting somebody chose.
    renderForm(<SetupForm minPasswordLength={0} />);

    expect(
      screen.getByText('This install sets no minimum length. You may leave this blank.'),
    ).toBeTruthy();
    // `required` is what actually carries the zero case: `minLength={0}` is a
    // no-op in the DOM.
    expect(screen.getByLabelText('Password').hasAttribute('required')).toBe(false);
  });

  it('keeps the box required wherever a password must exist', () => {
    renderForm(<SetupForm minPasswordLength={8} />);

    expect(screen.getByLabelText('Password').hasAttribute('required')).toBe(true);
  });
});

describe('the login form does not enforce a rule it cannot know', () => {
  it('submits an empty password rather than blocking it', async () => {
    /**
     * The client half of "0 means the empty string is a password". `required`
     * here would stop exactly the person the console reset exists for — the one
     * whose password was set from a path that honours no minimum — and would
     * stop them with no message at all.
     */
    login.mockResolvedValue({ account: null });
    renderForm(<LoginForm />);

    await userEvent.type(screen.getByLabelText('Handle'), 'ned');
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));

    await waitFor(() => {
      expect(login.mock.calls[0]?.[0]).toMatchObject({ handle: 'ned', password: '' });
    });
  });

  it('still requires a handle, which can never be empty', async () => {
    renderForm(<LoginForm />);

    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));

    expect(login).not.toHaveBeenCalled();
  });
});
