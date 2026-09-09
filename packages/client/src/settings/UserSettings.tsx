// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { useState, type JSX } from 'react';

import { ApiError } from '../api.js';
import { useAuthState, useChangePassword, useMe, useUpdateMe } from '../queries.js';
import { Field, SelectField } from '../ui/Field.js';
import { Button } from '../ui/Button.js';
import { page } from '../ui/classes.js';
import { SecretField } from '../ui/SecretField.js';

/**
 * What a person may change about themselves — [10 §15.1](../../../../docs/design/10-ui-surfaces.md).
 *
 * Deliberately short: a display name, a locale, a password. Everything else on
 * this screen belongs to somebody administering the install, and the difference
 * is expressed by the admin half not being rendered rather than by anything
 * here being disabled ([P2A §2.4]).
 */

/**
 * The locales this build offers, which is **not** a claim about translation.
 *
 * Every entry is English, because nothing here is translated. The day somebody
 * writes a translation is the day another language belongs in this list, and not
 * before — an untranslated `de-DE` would promise German and deliver English. What
 * the value does today is set date and number formatting ([19 §12.6] — `Intl`
 * from the first component), plus the language the server will use for
 * notifications it composes with the app closed.
 *
 * **Regions, not formats.** Several of these render identically: CLDR gives
 * Australia, New Zealand, Singapore and Jamaica the same patterns as `en-001`,
 * and Ireland, Kenya and Nigeria the same as `en-GB`. Collapsing them to one
 * entry per *distinct* output was tried on paper and is worse — sixteen entries
 * that offer the Maldives and Belize while leaving an Australian to work out that
 * they are "English (World)". Choosing your own region and getting somebody
 * else's identical formatting is the better failure, and if CLDR ever diverges
 * them the accounts that chose them are already right.
 *
 * `en-001` is CLDR's World English: the honest catch-all for the hundred-odd
 * regions not named here, rather than a hundred more lines that mostly repeat.
 *
 * A malformed value no longer takes the page down with it — see `formatterFor`
 * in `format.ts` — but an open text field for a BCP 47 tag would still be a field
 * where most entries are wrong.
 */
const LOCALES = [
  ['', 'Use my browser’s'],
  ['en-001', 'English (World)'],
  ['en-AU', 'English (Australia)'],
  ['en-BW', 'English (Botswana)'],
  ['en-CA', 'English (Canada)'],
  ['en-FJ', 'English (Fiji)'],
  ['en-GH', 'English (Ghana)'],
  ['en-HK', 'English (Hong Kong)'],
  ['en-IN', 'English (India)'],
  ['en-IE', 'English (Ireland)'],
  ['en-JM', 'English (Jamaica)'],
  ['en-KE', 'English (Kenya)'],
  ['en-MY', 'English (Malaysia)'],
  ['en-MT', 'English (Malta)'],
  ['en-NZ', 'English (New Zealand)'],
  ['en-NG', 'English (Nigeria)'],
  ['en-PK', 'English (Pakistan)'],
  ['en-PG', 'English (Papua New Guinea)'],
  ['en-PH', 'English (Philippines)'],
  ['en-SG', 'English (Singapore)'],
  ['en-ZA', 'English (South Africa)'],
  ['en-TZ', 'English (Tanzania)'],
  ['en-TT', 'English (Trinidad & Tobago)'],
  ['en-UG', 'English (Uganda)'],
  ['en-GB', 'English (United Kingdom)'],
  ['en-US', 'English (United States)'],
  ['en-ZM', 'English (Zambia)'],
  ['en-ZW', 'English (Zimbabwe)'],
] as const;

export function UserSettings(): JSX.Element {
  const me = useMe();
  const update = useUpdateMe();
  const changePassword = useChangePassword();
  // Already cached under ['auth','state'] by the gate that rendered this page,
  // so reading it here costs no request.
  const auth = useAuthState();
  const minPasswordLength = auth.data?.minPasswordLength ?? 0;

  const account = me.data?.account;
  const [displayName, setDisplayName] = useState<string | null>(null);
  const [locale, setLocale] = useState<string | null>(null);

  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [passwordDone, setPasswordDone] = useState(false);

  if (me.isPending) return <p className="text-sm text-ink-faint">Loading…</p>;
  if (!account) return <p role="alert">Your account could not be read.</p>;

  // `null` means untouched, so the field shows what the server has until the
  // person types — and a save elsewhere is not overwritten by a stale local copy.
  const nameValue = displayName ?? account.displayName;
  const localeValue = locale ?? account.locale ?? '';

  return (
    <section className="flex flex-col gap-6" aria-labelledby="you">
      <h2 id="you" className="text-section text-ink">
        You
      </h2>

      {/*
       * **The form spans the column and its fields do not**, on every form on
       * this page. The action row is `page.actions` — the strip the editors
       * hold their Save in, now held here for the same reason
       * ([10 §11.6](../../../../docs/design/10-ui-surfaces.md)) — and its
       * recipe reaches the column's edges by cancelling the column's own
       * padding, which only works from an element as wide as the column. So
       * `max-w-md` moved from the form to a block around the fields, and the
       * form is left at the width the strip needs.
       */}
      <form
        className="flex flex-col gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          update.mutate({
            displayName: nameValue,
            locale: localeValue === '' ? null : localeValue,
          });
        }}
      >
        <div className="flex max-w-md flex-col gap-4">
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
        </div>
        <div className={page.actions}>
          <Button type="submit" variant="primary" size="compact">
            Save
          </Button>
          {update.isSuccess ? (
            <p role="status" className="text-sm text-ink-subtle">
              Saved.
            </p>
          ) : null}
          {update.isError ? (
            <p role="alert" className="text-sm text-danger-ink">
              That could not be saved.
            </p>
          ) : null}
        </div>
      </form>

      <form
        className="flex flex-col gap-4"
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
                setPasswordError(passwordChangeFailure(error, minPasswordLength));
              },
            },
          );
        }}
      >
        <div className="flex max-w-md flex-col gap-4">
          <h3 id="password" className="text-subsection text-ink">
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
          {/**
           * **Sessions elsewhere are not ended**, and saying so is the honest
           * thing rather than the tidy one.
           *
           * Sessions are signed stateless cookies with no denylist ([09 §4.1]),
           * so nothing here can revoke one — and a form that quietly implied
           * otherwise would leave somebody believing they had shut out whoever
           * they changed the password because of.
           *
           * Above the action row rather than below it, now that the row is a
           * strip held to the foot of the form: what a click does not do is
           * read before the click, and nothing sits under the strip.
           */}
          <p className="text-xs text-ink-faint">
            Changing your password does not sign out other browsers you are already signed in on.
            Those sessions last until they expire.
          </p>
        </div>
        <div className={page.actions}>
          <Button type="submit" variant="primary" size="compact">
            Change password
          </Button>
          {passwordDone ? (
            <p role="status" className="text-sm text-ink-subtle">
              Changed.
            </p>
          ) : null}
          {passwordError === null ? null : (
            <p role="alert" className="text-sm text-danger-ink">
              {passwordError}
            </p>
          )}
        </div>
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

/**
 * Why a password change failed, as one whole sentence — [01 §2].
 *
 * **Three branches where there were two**, and the middle one is the fix: the
 * else-branch used to claim a length problem for *every* non-401, so a 500 or a
 * dropped connection told somebody their password was too short. It also named
 * eight characters, which is wrong on any install that changed
 * `auth.minPasswordLength` — the number is the server's now.
 *
 * A password *longer* than the 512-character cap is also a 400 and would get the
 * length sentence. Telling the two apart means reading `issues[0].path` off the
 * body, which `ApiError` does not carry; not worth widening the error type for a
 * case nobody reaches by accident.
 */
function passwordChangeFailure(error: Error, minimum: number): string {
  if (error instanceof ApiError && error.status === 401) {
    return 'That is not your current password.';
  }
  if (error instanceof ApiError && error.status === 400) {
    return newPasswordTooShort(minimum);
  }
  return 'The password could not be changed.';
}

function newPasswordTooShort(minimum: number): string {
  return minimum === 1
    ? 'The new password must be at least 1 character.'
    : `The new password must be at least ${String(minimum)} characters.`;
}
