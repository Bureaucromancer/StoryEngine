// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { useId, useState, type JSX, type ReactNode } from 'react';

import { ApiError } from '../api.js';
import { useLogin, useSetup } from '../queries.js';

/**
 * Login and first-run setup ([P1 §1.3](../../../../docs/design/workplan/03-p1-implementation.md)).
 *
 * Which one renders is the server's call, via `GET /api/auth/state` — no
 * accounts on disk routes every request to create-the-first-admin. Neither form
 * needs anything the field-assist contract provides, which is why these are
 * plain inputs rather than the P1.7 `Field` primitive.
 */

const INPUT_CLASS =
  'w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-slate-900 ' +
  'focus-visible:outline-2 focus-visible:outline-slate-500';

const BUTTON_CLASS =
  'w-full rounded-md bg-slate-800 px-3 py-2 font-medium text-white ' +
  'hover:bg-slate-700 focus-visible:outline-2 focus-visible:outline-slate-500 ' +
  'disabled:cursor-not-allowed disabled:bg-slate-400';

/**
 * The handle becomes a directory name, so the server validates it hard
 * (docs/api.md). Mirroring the rule here turns a rejection into inline
 * guidance; the server remains the authority.
 */
const HANDLE_PATTERN = '[a-z0-9\\-]{0,62}[a-z0-9]';

function Panel(props: { title: string; children: ReactNode }): JSX.Element {
  return (
    <main className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center p-6">
      <h1 className="mb-6 text-center text-2xl font-semibold text-slate-900">{props.title}</h1>
      {props.children}
    </main>
  );
}

function ErrorNotice(props: { message: string | null }): JSX.Element | null {
  if (props.message === null) return null;
  return (
    <p role="alert" className="rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-900">
      {props.message}
    </p>
  );
}

/**
 * The 401 body carries no message — one answer for wrong password, unknown
 * handle and disabled account, deliberately (docs/api.md) — so the sentence
 * lives here. Anything else reports what the server said.
 */
function loginErrorMessage(error: Error | null): string | null {
  if (error === null) return null;
  if (error instanceof ApiError && error.code === 'invalid-credentials') {
    return 'That handle and password were not recognised.';
  }
  return error.message;
}

export function LoginForm(): JSX.Element {
  const login = useLogin();
  const handleId = useId();
  const passwordId = useId();
  const [handle, setHandle] = useState('');
  const [password, setPassword] = useState('');

  return (
    <Panel title="StoryEngine">
      <form
        className="flex flex-col gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          login.mutate({ handle, password });
        }}
      >
        <ErrorNotice message={loginErrorMessage(login.error)} />
        <div>
          <label htmlFor={handleId} className="mb-1 block text-sm font-medium text-slate-700">
            Handle
          </label>
          <input
            id={handleId}
            className={INPUT_CLASS}
            value={handle}
            onChange={(event) => {
              setHandle(event.target.value);
            }}
            autoComplete="username"
            autoFocus
            required
          />
        </div>
        <div>
          <label htmlFor={passwordId} className="mb-1 block text-sm font-medium text-slate-700">
            Password
          </label>
          <input
            id={passwordId}
            className={INPUT_CLASS}
            type="password"
            value={password}
            onChange={(event) => {
              setPassword(event.target.value);
            }}
            autoComplete="current-password"
            required
          />
        </div>
        <button type="submit" className={BUTTON_CLASS} disabled={login.isPending}>
          Sign in
        </button>
      </form>
    </Panel>
  );
}

export function SetupForm(): JSX.Element {
  const setup = useSetup();
  const handleId = useId();
  const passwordId = useId();
  const displayNameId = useId();
  const [handle, setHandle] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');

  return (
    <Panel title="Welcome to StoryEngine">
      <p className="mb-6 text-center text-sm text-slate-600">
        This install has no accounts yet. Create the first administrator account to begin.
      </p>
      <form
        className="flex flex-col gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          setup.mutate({
            handle,
            password,
            ...(displayName === '' ? {} : { displayName }),
          });
        }}
      >
        <ErrorNotice message={setup.error === null ? null : setup.error.message} />
        <div>
          <label htmlFor={handleId} className="mb-1 block text-sm font-medium text-slate-700">
            Handle
          </label>
          <input
            id={handleId}
            className={INPUT_CLASS}
            value={handle}
            onChange={(event) => {
              setHandle(event.target.value);
            }}
            autoComplete="username"
            pattern={HANDLE_PATTERN}
            title="Lowercase letters, digits and hyphens, not ending in a hyphen."
            maxLength={63}
            autoFocus
            required
          />
          <p className="mt-1 text-xs text-slate-500">
            Lowercase letters, digits and hyphens. This also names your folder on disk, and it
            cannot be changed later.
          </p>
        </div>
        <div>
          <label htmlFor={displayNameId} className="mb-1 block text-sm font-medium text-slate-700">
            Display name (optional)
          </label>
          <input
            id={displayNameId}
            className={INPUT_CLASS}
            value={displayName}
            onChange={(event) => {
              setDisplayName(event.target.value);
            }}
            autoComplete="name"
            maxLength={200}
          />
        </div>
        <div>
          <label htmlFor={passwordId} className="mb-1 block text-sm font-medium text-slate-700">
            Password
          </label>
          <input
            id={passwordId}
            className={INPUT_CLASS}
            type="password"
            value={password}
            onChange={(event) => {
              setPassword(event.target.value);
            }}
            autoComplete="new-password"
            minLength={8}
            required
          />
          <p className="mt-1 text-xs text-slate-500">At least 8 characters.</p>
        </div>
        <button type="submit" className={BUTTON_CLASS} disabled={setup.isPending}>
          Create account
        </button>
      </form>
    </Panel>
  );
}
