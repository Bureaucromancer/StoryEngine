// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { useState, type JSX } from 'react';

import { ApiError } from '../api.js';
import { useChangePassword, useMe, useUpdateMe } from '../queries.js';
import { Field, SelectField } from '../editor/Field.js';
import { SecretField } from '../editor/SecretField.js';

/**
 * What a person may change about themselves — [05 §15.1](../../../../docs/design/05-ui-surfaces.md).
 *
 * Deliberately short: a display name, a locale, a password. Everything else on
 * this screen belongs to somebody administering the install, and the difference
 * is expressed by the admin half not being rendered rather than by anything
 * here being disabled ([P2A §2.4]).
 */

/**
 * The locales this build offers, which is **not** a claim about translation.
 *
 * It sets date and number formatting ([07 §12.6] — `Intl` from the first
 * component) and the language the server uses for notifications it composes with
 * the app closed. A malformed value no longer takes the page down with it, but
 * an open text field for a BCP 47 tag would still be a field where most entries
 * are wrong.
 */
const LOCALES = [
  ['', 'Use my browser’s'],
  ['en-US', 'English (United States)'],
  ['en-GB', 'English (United Kingdom)'],
] as const;

export function UserSettings(): JSX.Element {
  const me = useMe();
  const update = useUpdateMe();
  const changePassword = useChangePassword();

  const account = me.data?.account;
  const [displayName, setDisplayName] = useState<string | null>(null);
  const [locale, setLocale] = useState<string | null>(null);

  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [passwordDone, setPasswordDone] = useState(false);

  if (me.isPending) return <p className="text-sm text-slate-500">Loading…</p>;
  if (!account) return <p role="alert">Your account could not be read.</p>;

  // `null` means untouched, so the field shows what the server has until the
  // person types — and a save elsewhere is not overwritten by a stale local copy.
  const nameValue = displayName ?? account.displayName;
  const localeValue = locale ?? account.locale ?? '';

  return (
    <section className="flex flex-col gap-6" aria-labelledby="you">
      <h2 id="you" className="text-lg font-medium">
        You
      </h2>

      <form
        className="flex max-w-md flex-col gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          update.mutate({
            displayName: nameValue,
            locale: localeValue === '' ? null : localeValue,
          });
        }}
      >
        <Field
          label="Display name"
          value={nameValue}
          onChange={setDisplayName}
          hint="What other people in this install see."
        />
        <SelectField
          label="Language and formats"
          value={localeValue}
          options={LOCALES}
          onChange={setLocale}
          hint="Sets how dates and numbers are written, and the language of notifications the server sends while the app is closed."
        />
        <div className="flex items-center gap-3">
          <button type="submit" className="rounded-md bg-slate-900 px-3 py-2 text-sm text-white">
            Save
          </button>
          {update.isSuccess ? (
            <p role="status" className="text-sm text-slate-600">
              Saved.
            </p>
          ) : null}
          {update.isError ? (
            <p role="alert" className="text-sm text-red-900">
              That could not be saved.
            </p>
          ) : null}
        </div>
      </form>

      <form
        className="flex max-w-md flex-col gap-4"
        aria-labelledby="password"
        onSubmit={(event) => {
          event.preventDefault();
          setPasswordError(null);
          setPasswordDone(false);
          changePassword.mutate(
            { currentPassword: current, newPassword: next },
            {
              onSuccess: () => {
                setCurrent('');
                setNext('');
                setPasswordDone(true);
              },
              onError: (error) => {
                // The two failures a person can act on, told apart. "That did
                // not work" for both would leave someone retyping a password
                // that was right.
                setPasswordError(
                  error instanceof ApiError && error.status === 401
                    ? 'That is not your current password.'
                    : 'The new password must be at least 8 characters.',
                );
              },
            },
          );
        }}
      >
        <h3 id="password" className="text-base font-medium">
          Password
        </h3>
        <SecretField
          label="Current password"
          value={current}
          onChange={setCurrent}
          autoComplete="current-password"
        />
        <SecretField
          label="New password"
          value={next}
          onChange={setNext}
          autoComplete="new-password"
        />
        <div className="flex items-center gap-3">
          <button type="submit" className="rounded-md bg-slate-900 px-3 py-2 text-sm text-white">
            Change password
          </button>
          {passwordDone ? (
            <p role="status" className="text-sm text-slate-600">
              Changed.
            </p>
          ) : null}
          {passwordError === null ? null : (
            <p role="alert" className="text-sm text-red-900">
              {passwordError}
            </p>
          )}
        </div>
        {/**
         * **Sessions elsewhere are not ended**, and saying so is the honest
         * thing rather than the tidy one.
         *
         * Sessions are signed stateless cookies with no denylist ([04 §4.1]),
         * so nothing here can revoke one — and a form that quietly implied
         * otherwise would leave somebody believing they had shut out whoever
         * they changed the password because of.
         */}
        <p className="text-xs text-slate-500">
          Changing your password does not sign out other browsers you are already signed in on.
          Those sessions last until they expire.
        </p>
      </form>
    </section>
  );
}

/**
 * `PasswordInput` lived here, file-private, which was right while this was the
 * only masked box in the app. P2B added a second kind — a provider key — so it
 * moved to `editor/SecretField.tsx` and grew the one thing a password never
 * needed: a note saying what an *empty* box means.
 */
