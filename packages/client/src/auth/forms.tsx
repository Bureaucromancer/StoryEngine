// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { useId, useState, type JSX, type ReactNode } from 'react';

import { ApiError } from '../api.js';
import { useLogin, useSetup } from '../queries.js';
import { Alert } from '../ui/Alert.js';
import { Button } from '../ui/Button.js';

/**
 * Login and first-run setup ([P1 §1.3](../../../../docs/design/workplan/03-p1-implementation.md)).
 *
 * Which one renders is the server's call, via `GET /api/auth/state` — no
 * accounts on disk routes every request to create-the-first-admin. Neither form
 * needs anything the field-assist contract provides, which is why these are
 * plain inputs rather than the P1.7 `Field` primitive.
 */

/**
 * The same control as `ui/Field`'s, minus the label machinery these forms do
 * not want (see the header comment). It gained `text-sm` when the appearance
 * layer landed — the two had drifted, and the field primitive was the one with
 * the deliberate size.
 */
const INPUT_CLASS =
  'w-full rounded-control border border-line-strong bg-surface px-3 py-2 text-sm text-ink placeholder:text-ink-faint focus-visible:outline-2 focus-visible:outline-focus';

const LABEL_CLASS = 'mb-1 block text-sm font-medium text-ink-muted';

/**
 * The handle becomes a directory name, so the server validates it hard
 * (docs/api.md). Mirroring the rule here turns a rejection into inline
 * guidance; the server remains the authority.
 */
const HANDLE_PATTERN = '[a-z0-9\\-]{0,62}[a-z0-9]';

/**
 * The password rule as one whole sentence per case — [01 §2].
 *
 * The number comes from the server (`GET /api/auth/state`) because it is this
 * *install's* setting rather than this build's. That is the one way this rule
 * differs from `HANDLE_PATTERN` above, which can be mirrored because it is the
 * same on every install; a literal here would be wrong wherever it was changed.
 *
 * Zero gets its own sentence rather than "At least 0 characters", which reads as
 * a bug in the software instead of a decision the operator made — and one gets
 * its own because "1 characters" is simply wrong.
 */
function passwordRule(minimum: number): string {
  if (minimum === 0) return 'This install sets no minimum length. You may leave this blank.';
  if (minimum === 1) return 'At least 1 character.';
  return `At least ${String(minimum)} characters.`;
}

function Panel(props: { title: string; children: ReactNode }): JSX.Element {
  return (
    <main className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center p-6">
      <h1 className="mb-6 text-center text-title text-ink">{props.title}</h1>
      {props.children}
    </main>
  );
}

function ErrorNotice(props: { message: string | null }): JSX.Element | null {
  if (props.message === null) return null;
  return (
    <Alert tone="error" role="alert">
      {props.message}
    </Alert>
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
          <label htmlFor={handleId} className={LABEL_CLASS}>
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
          <label htmlFor={passwordId} className={LABEL_CLASS}>
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
            /**
             * **`required` on the handle above and not here**, and the
             * asymmetry is deliberate. A handle can never be empty. A password
             * can: at `auth.minPasswordLength: 0`, and on any install where
             * somebody's password was set from the console, which honours no
             * minimum at all. The one person a `required` here would stop is
             * the one the console repair exists for, and it would stop them
             * with no message. A blank submission is answered 401 like any
             * other wrong password, which is the honest failure.
             */
          />
        </div>
        <Button type="submit" variant="primary" className="w-full" disabled={login.isPending}>
          Sign in
        </Button>
      </form>
    </Panel>
  );
}

export function SetupForm(props: { minPasswordLength: number }): JSX.Element {
  const setup = useSetup();
  const handleId = useId();
  const passwordId = useId();
  const displayNameId = useId();
  const [handle, setHandle] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');

  return (
    <Panel title="Welcome to StoryEngine">
      <p className="mb-6 text-center text-sm text-ink-subtle">
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
          <label htmlFor={handleId} className={LABEL_CLASS}>
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
          <p className="mt-1 text-xs text-ink-faint">
            Lowercase letters, digits and hyphens. This also names your folder on disk, and it
            cannot be changed later.
          </p>
        </div>
        <div>
          <label htmlFor={displayNameId} className={LABEL_CLASS}>
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
          <label htmlFor={passwordId} className={LABEL_CLASS}>
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
            // `minLength={0}` is a no-op in the DOM, so the zero case is
            // carried entirely by dropping `required`.
            minLength={props.minPasswordLength}
            required={props.minPasswordLength > 0}
          />
          <p className="mt-1 text-xs text-ink-faint">{passwordRule(props.minPasswordLength)}</p>
        </div>
        <Button type="submit" variant="primary" className="w-full" disabled={setup.isPending}>
          Create account
        </Button>
      </form>
    </Panel>
  );
}
