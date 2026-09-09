// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { JSX } from 'react';

/**
 * The two forms that exist before a session does — [10 §15](../../../../docs/design/10-ui-surfaces.md).
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
    renderForm(<SetupForm minPasswordLength={12} tokenRequired={false} />);

    expect(screen.getByText('At least 12 characters.')).toBeTruthy();
    expect(screen.getByLabelText('Password').getAttribute('minlength')).toBe('12');
  });

  it('says a blank box is allowed when there is no minimum', () => {
    // Not "At least 0 characters", which reads as a bug rather than as a
    // setting somebody chose.
    renderForm(<SetupForm minPasswordLength={0} tokenRequired={false} />);

    expect(
      screen.getByText('This install sets no minimum length. You may leave this blank.'),
    ).toBeTruthy();
    // `required` is what actually carries the zero case: `minLength={0}` is a
    // no-op in the DOM.
    expect(screen.getByLabelText('Password').hasAttribute('required')).toBe(false);
  });

  it('keeps the box required wherever a password must exist', () => {
    renderForm(<SetupForm minPasswordLength={8} tokenRequired={false} />);

    expect(screen.getByLabelText('Password').hasAttribute('required')).toBe(true);
  });
});

/**
 * The setup token's client half — F10,
 * [09 §5.1](../../../../docs/design/09-server-multiuser-deployment.md),
 * [P6A §1.4](../../../../docs/design/workplan/19-p6a-alpha-1.md).
 *
 * **The field appears because the server said to.** A client cannot work out
 * whether the install it is talking to is exposed — it may be reaching a
 * loopback server directly or an exposed one through a proxy, and those are
 * indistinguishable from here. So the two failures a guess would produce are
 * both real: a token box on a laptop, which is baffling, or none on an exposed
 * install, which makes it look broken.
 */
describe('the setup token field', () => {
  it('is absent when this install does not want one', () => {
    renderForm(<SetupForm minPasswordLength={8} tokenRequired={false} />);

    expect(screen.queryByLabelText('Setup token')).toBeNull();
    // And so is the sentence about where the token lives: a laptop install has
    // no token file, and a note about one would be the baffling half back.
    expect(screen.queryByText(/setup\.token/)).toBeNull();
  });

  it('is present and required when it does, and says where the token is kept', () => {
    renderForm(<SetupForm minPasswordLength={8} tokenRequired />);

    const field = screen.getByLabelText('Setup token');
    expect(field.hasAttribute('required')).toBe(true);
    // Not masked: it is pasted once out of a server console, and hiding it only
    // makes the paste harder to check.
    expect(field.getAttribute('type')).not.toBe('password');
    // The file, not only the log: the first install found it there after the
    // container had been recreated ([P6A §3] step 6). Matched as one element's
    // own text, which is what keeps the sentence whole rather than split around
    // a `<code>`.
    expect(screen.getByText(/kept at state\/setup\.token in the data directory/)).toBeTruthy();
  });

  it('sends what was typed into it', async () => {
    setup.mockResolvedValue({ account: { handle: 'ned' } });
    renderForm(<SetupForm minPasswordLength={0} tokenRequired />);

    await userEvent.type(screen.getByLabelText('Handle'), 'ned');
    await userEvent.type(screen.getByLabelText('Setup token'), 'the-token');
    await userEvent.click(screen.getByRole('button', { name: 'Create account' }));

    // The whole point of the field: a form that rendered it and dropped it on
    // submit would look right and refuse every attempt.
    await waitFor(() => {
      // The first argument of the one call. React Query hands its mutation
      // function a second argument, so `toHaveBeenCalledWith` against a single
      // object fails for a reason that has nothing to do with what was sent.
      expect(setup.mock.calls[0]?.[0]).toEqual(
        expect.objectContaining({ handle: 'ned', setupToken: 'the-token' }),
      );
    });
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
