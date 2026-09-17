// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { useId, useState, type JSX, type ReactNode } from 'react';

import { ApiError } from '../api.js';
import { useLogin, useSetup } from '../queries.js';
import { Alert } from '../ui/Alert.js';
import { Button } from '../ui/Button.js';
import { control, fieldLabel } from '../ui/classes.js';

/**
 * Login and first-run setup ([P1 §1.3](../../../../docs/design/workplan/07-p1-implementation.md)).
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
/**
 * ***Both of these were the shared recipes, re-typed.*** `control` and
 * `fieldLabel` in `ui/classes.ts` are the same strings — except that `control`
 * also carries the `disabled:` variants, which this copy had quietly dropped,
 * so a disabled field on the sign-in screen looked exactly like a live one.
 * That is the drift `classes.ts` was written to end, and its own docstring is
 * the argument: *"A class list copied is a class list that drifts."* The margin
 * stays here, because position is not appearance and the recipe carries none.
 */
const INPUT_CLASS = control;

const LABEL_CLASS = `${fieldLabel} mb-1`;

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
    // The height is the frame's (`App.tsx`), which holds the build line under
    // the page since alpha.2: this takes the rest of that column rather than
    // the viewport. `w-full`, because a flex item with auto inline margins is
    // content-sized where a block is not, and `max-w-sm` needs a width to cap.
    <main className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center p-6">
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

/**
 * ***Two optional props, and both arrived with [12]'s gallery at [P10.4].***
 *
 * **The form is unchanged when neither is passed**, which is the claim that
 * matters: [12 §9] is explicit that *"the tile changes what you see, never what
 * authenticates you — `POST /api/auth/login` is byte-for-byte the same contract
 * from either door"*, and the cheapest way to keep that true is for the gallery
 * to hand this component a starting handle rather than to grow a login path of
 * its own.
 *
 * *`presetHandle` fills the box; it does not lock it.* Somebody who picked the
 * wrong face types over it, which is better than a disabled field and a Back
 * button being the only way out.
 */
export interface LoginFormProps {
  presetHandle?: string;
  /** Rendered only when there is somewhere to go back to — the gallery. */
  onBack?: () => void;
}

export function LoginForm(props: LoginFormProps = {}): JSX.Element {
  const login = useLogin();
  const handleId = useId();
  const passwordId = useId();
  const [handle, setHandle] = useState(props.presetHandle ?? '');
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
            // **Focus lands on the empty box**, which is the handle from the
            // form door and the password from a tile: picking a face has
            // already answered the first question, and focusing a filled field
            // asks it again.
            autoFocus={props.presetHandle === undefined}
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
            autoFocus={props.presetHandle !== undefined}
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
        {props.onBack === undefined ? null : (
          <Button type="button" size="compact" onClick={props.onBack}>
            Back to the faces
          </Button>
        )}
      </form>
    </Panel>
  );
}

export function SetupForm(props: {
  minPasswordLength: number;
  /** Whether this install wants the console token — F10, and the server says so. */
  tokenRequired: boolean;
}): JSX.Element {
  const setup = useSetup();
  const handleId = useId();
  const passwordId = useId();
  const displayNameId = useId();
  const tokenId = useId();
  const [handle, setHandle] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [setupToken, setSetupToken] = useState('');

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
            ...(setupToken === '' ? {} : { setupToken }),
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
        {/*
         * **Rendered only when the server says so**, because it is baffling on
         * a laptop and essential on an exposed install, and the client cannot
         * tell those apart — it may be reaching either one through a proxy.
         *
         * Last, after the account it is not part of: it is a fact about *this
         * install being reachable*, not about the person being created, and
         * putting it above the handle would read as the first thing an account
         * needs.
         */}
        {props.tokenRequired ? (
          <div>
            <label htmlFor={tokenId} className={LABEL_CLASS}>
              Setup token
            </label>
            <input
              id={tokenId}
              className={INPUT_CLASS}
              value={setupToken}
              onChange={(event) => {
                setSetupToken(event.target.value);
              }}
              // Not `type="password"`: it is copied out of a server console and
              // pasted here once, and masking it only makes a paste harder to
              // check. `off`, because a browser offering to remember a one-time
              // token is offering the wrong thing.
              autoComplete="off"
              spellCheck={false}
              maxLength={512}
              required
            />
            {/*
             * The person at this screen is the one whose log may be gone —
             * unraid recreates the container on every template edit, and the
             * first install found the token by opening the file, not the log
             * ([P6A §3] step 6). The file is the copy that survives, so the
             * form names it. One text node with the path in plain text: the
             * sentence has to exist whole, and a test has to read it whole.
             */}
            <p className="mt-1 text-xs text-ink-faint">
              This install is reachable from the network, so creating the first account needs the
              setup token. It is printed in the server&rsquo;s log on every start until an account
              exists, and kept at state/setup.token in the data directory.
            </p>
          </div>
        ) : null}
        <Button type="submit" variant="primary" className="w-full" disabled={setup.isPending}>
          Create account
        </Button>
      </form>
    </Panel>
  );
}
