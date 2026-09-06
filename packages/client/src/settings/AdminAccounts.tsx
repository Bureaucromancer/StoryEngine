// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { useState, type JSX } from 'react';

import type { AccountPatch, AdminAccount } from '../api.js';

import { CheckboxField, Field, SelectField } from '../ui/Field.js';
import {
  useAdminAccounts,
  useAuthState,
  useCreateAccount,
  useRemoveAccount,
  useUpdateAccount,
} from '../queries.js';
import { Button } from '../ui/Button.js';
import { panel } from '../ui/classes.js';
import { Dialog } from '../ui/Dialog.js';

/**
 * Accounts — [05 §15.2](../../../../docs/design/05-ui-surfaces.md).
 *
 * **The dead-end warning is the reason this screen exists this phase.**
 * [04 §4.5](../../../../docs/design/04-server-multiuser-deployment.md) commissioned the
 * sentence and named this screen as where it appears: an account with no usable
 * connection cannot send a message, and without the warning that arrives as a
 * bug report from the person who cannot play rather than as a line an
 * administrator can read.
 */

export function AdminAccounts(): JSX.Element {
  const accounts = useAdminAccounts();
  const [confirming, setConfirming] = useState<string | null>(null);

  if (accounts.isPending) return <p className="text-sm text-ink-faint">Loading…</p>;
  if (accounts.isError) return <p role="alert">The account list could not be read.</p>;

  const rows = accounts.data.accounts;
  const stuck = accounts.data.withoutUsableConnection;

  return (
    <section className="flex flex-col gap-6" aria-labelledby="accounts">
      <div>
        <h3 id="accounts" className="text-subsection text-ink">
          Accounts
        </h3>
        {stuck > 0 ? (
          /**
           * The count in the heading, and the fix beside it. A number with
           * nothing to point at leaves an administrator counting rows
           * themselves ([05 §15.4]), so each row says so too — and when there is
           * no system connection at all, this is one fix rather than n.
           */
          <p role="status" className="mt-1 text-sm text-warn-ink">
            {deadEndWarning(stuck, accounts.data.systemConnectionCount)}
          </p>
        ) : null}
      </div>

      <ul className="flex flex-col gap-4">
        {rows.map((row) => (
          <AccountRow
            key={row.handle}
            row={row}
            onRemove={() => {
              setConfirming(row.handle);
            }}
          />
        ))}
      </ul>

      <NewAccount />

      {confirming === null ? null : (
        <RemoveDialog
          handle={confirming}
          onDone={() => {
            setConfirming(null);
          }}
        />
      )}
    </section>
  );
}

/**
 * One account, with its capabilities grouped by whether they do anything yet.
 */
function AccountRow({ row, onRemove }: { row: AdminAccount; onRemove: () => void }): JSX.Element {
  const update = useUpdateAccount();
  const refused = update.isError ? update.error.message : null;

  function patch(next: AccountPatch): void {
    update.mutate({ handle: row.handle, patch: next });
  }

  return (
    <li className="rounded-md border border-line p-4">
      <div className="flex items-baseline justify-between gap-4">
        <div>
          <p className="font-medium">{row.displayName}</p>
          <p className="text-xs text-ink-faint">{row.handle}</p>
        </div>
        <div className="flex items-center gap-2">
          <SelectField
            label="Role"
            value={row.role}
            options={[
              ['user', 'User'],
              ['admin', 'Administrator'],
            ]}
            onChange={(value) => {
              patch({ role: value as 'admin' | 'user' });
            }}
          />
        </div>
      </div>

      {row.hasUsableConnection ? null : (
        <p className="mt-2 text-sm text-warn-ink">
          No usable connection — this account cannot send a message.
        </p>
      )}

      <div className="mt-4 flex flex-col gap-3">
        <CheckboxField
          label="Signed in"
          checked={row.enabled}
          onChange={(checked) => {
            patch({ enabled: checked });
          }}
          hint="Turning this off keeps everything they have made and stops them signing in."
        />

        <fieldset className="border-0 p-0">
          <legend className="text-xs font-medium tracking-wide text-ink-faint uppercase">
            In force now
          </legend>
          <div className="mt-2">
            <CheckboxField
              label="May use their own connections"
              checked={row.capabilities.privateConnections}
              onChange={(checked) => {
                patch({ capabilities: { privateConnections: checked } });
              }}
              hint="When off, their turns use the system connections only. Their own connection files stay on disk and work again if you turn this back on."
            />

            {/**
             * **Moved out of *Recorded for later* at the P4 audit, and relabelled
             * to name what it actually grants** ([05 §4.2.2]).
             *
             * It sat in the recorded group with the labels *No file browser* /
             * *May read their own files* / *May edit their own files* for three
             * weeks after P4.4 began gating the import sweep on it. So an
             * administrator granting `read` was told they were enabling a
             * browser over that person's own content, and was in fact granting a
             * server-side read of any directory on the host outside `/data`.
             *
             * [01 §2.2] forbids a control that does nothing. This was its
             * inverse and the more dangerous one — a control that did **more**
             * than its label admitted — and 05 §4.2.2 had already committed the
             * relabel to *ship with the sweep, not after it*.
             *
             * The hint carries that section's own statement of the bar rather
             * than a softer paraphrase. An administrator deciding this needs the
             * real comparison, and *someone you would give a shell to* is the
             * one sentence that conveys it.
             */}
            <SelectField
              label="Import from a folder on this machine"
              value={row.capabilities.fileAccess}
              options={[
                ['none', 'No — cannot read this machine'],
                ['read', 'May import from a folder'],
                ['write', 'May import from a folder, and edit their own files'],
              ]}
              onChange={(value) => {
                patch({ capabilities: { fileAccess: value } });
              }}
              hint="Anything above “No” lets them name any directory on this machine outside the data directory and have the server read it — the import review lists every file it found there, including ones it could not import. Grant it to someone you would give a shell to on this machine. The in-app file browser has not shipped; until it does, “May edit their own files” differs from “May import from a folder” only in what it will mean later."
            />
          </div>
        </fieldset>

        {/**
         * **Recorded for later**, and the group says so once rather than each
         * switch apologising for itself.
         *
         * [01 §2.2] forbids a control that does nothing, and a switch labelled
         * *may add their own provider keys* that added nothing would be exactly
         * that. What makes these honest is the sentence below: the setting is
         * kept and will apply when the feature ships.
         *
         * **`fileAccess` left this group at the P4 audit** and now sits above,
         * because it stopped being recorded-for-later the moment the import
         * sweep began reading it. A group whose legend says *these features have
         * not shipped* is a promise about every control inside it, and one live
         * control in there makes the legend a lie about all of them.
         */}
        <fieldset className="border-0 p-0">
          <legend className="text-xs font-medium tracking-wide text-ink-faint uppercase">
            Recorded for later
          </legend>
          <p className="mt-1 mb-2 text-xs text-ink-faint">
            Extensions have not shipped. What you set here is kept and will apply when they do.
          </p>
          <div className="flex flex-col gap-3">
            <CheckboxField
              label="May enable extensions"
              checked={row.capabilities.enableExtensions}
              onChange={(checked) => {
                patch({ capabilities: { enableExtensions: checked } });
              }}
              hint="Installing extensions stays an administrator's job."
            />
          </div>
        </fieldset>
      </div>

      {refused === null ? null : (
        <p role="alert" className="mt-3 text-sm text-danger-ink">
          {refused}
        </p>
      )}

      <Button
        type="button"
        variant="dangerOutline"
        size="compact"
        className="mt-4"
        onClick={onRemove}
      >
        {removeButtonLabel(row.handle)}
      </Button>
    </li>
  );
}

/** Making an account, which is the phase's demo in one form. */
function NewAccount(): JSX.Element {
  const create = useCreateAccount();
  // Cached by the gate; no request of its own. Not an admin-only read, which
  // matters — see the note on absent-rather-than-disabled in `SettingsPage`.
  const auth = useAuthState();
  const [handle, setHandle] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<'admin' | 'user'>('user');

  return (
    <form
      className="flex max-w-md flex-col gap-3 rounded-md border border-line p-4"
      aria-labelledby="new-account"
      onSubmit={(event) => {
        event.preventDefault();
        create.mutate(
          { handle, password, role },
          {
            onSuccess: () => {
              setHandle('');
              setPassword('');
            },
          },
        );
      }}
    >
      <h4 id="new-account" className="text-subsection text-ink">
        Add someone
      </h4>
      <Field
        label="Handle"
        value={handle}
        onChange={setHandle}
        hint="Lowercase, and it becomes their folder name under data/users."
      />
      <Field
        label="First password"
        value={password}
        onChange={setPassword}
        hint={firstPasswordRule(auth.data?.minPasswordLength ?? 0)}
      />
      <SelectField
        label="Role"
        value={role}
        options={[
          ['user', 'User'],
          ['admin', 'Administrator'],
        ]}
        onChange={(value) => {
          setRole(value as 'admin' | 'user');
        }}
      />
      {/*
       * Held against the bottom of the scrollport inside this card, like every
       * action row on the settings page — `panel.actions` is the editors'
       * strip with the card's padding in place of the column's ([05 §11.6]).
       * Short as this form is, a strip on one form and a plain row on the next
       * would be two things to learn for one job.
       */}
      <div className={panel.actions}>
        <Button type="submit" variant="primary" size="compact">
          Create
        </Button>
        {create.isError ? (
          <p role="alert" className="text-sm text-danger-ink">
            {create.error.message}
          </p>
        ) : null}
      </div>
    </form>
  );
}

/**
 * Removing an account, which moves their data rather than erasing it.
 *
 * **The sentence is the point.** [02 §10.2](../../../../docs/design/02-data-model.md) requires
 * the trash to be honest about what it does, and this is the same obligation one
 * step further: an administrator about to remove somebody should read what
 * actually happens to their library *before* clicking, not discover it
 * afterwards while looking for it.
 *
 * Typing the handle back is the confirmation, because a destructive control
 * whose confirmation is a second button is a control people click twice.
 */
function RemoveDialog({ handle, onDone }: { handle: string; onDone: () => void }): JSX.Element {
  const remove = useRemoveAccount();
  const [typed, setTyped] = useState('');
  return (
    <Dialog role="alertdialog" labelledBy="remove-title" onDismiss={onDone} size="wide">
      <h4 id="remove-title" className="text-subsection text-ink">
        {removeTitle(handle)}
      </h4>
      {/**
       * **Whole sentences**, because word order differs between languages and
       * a sentence built by concatenation cannot be translated at all
       * ([01 §2]) — which is why the handle is substituted into each string
       * rather than sitting between two JSX fragments.
       */}
      <p className="text-sm text-ink-muted">
        Their library is moved to data/removed/ on the server. StoryEngine will not delete it —
        remove that folder yourself when you are sure.
      </p>
      <p className="text-sm text-ink-muted">{handleIsFreeAgain(handle)}</p>
      <Field label={confirmPrompt(handle)} value={typed} onChange={setTyped} />
      {remove.isError ? (
        <p role="alert" className="text-sm text-danger-ink">
          {remove.error.message}
        </p>
      ) : null}
      <div className="flex justify-end gap-2">
        <Button type="button" size="compact" onClick={onDone}>
          Cancel
        </Button>
        <Button
          type="button"
          variant="danger"
          size="compact"
          disabled={typed !== handle}
          onClick={() => {
            remove.mutate(handle, { onSuccess: onDone });
          }}
        >
          Remove and move their data
        </Button>
      </div>
    </Dialog>
  );
}

/**
 * The user-facing sentences of this screen, each whole.
 *
 * [01 §2](../../../../docs/design/workplan/01-work-plan.md) keeps this part of i18n discipline on
 * day one because it is the unretrofittable part: word order differs between
 * languages, so a sentence assembled from fragments around a value cannot be
 * translated at all. A helper returning half a phrase is the same mistake with
 * an indirection, so each of these returns the whole thing.
 */
function deadEndWarning(stuck: number, systemConnections: number): string {
  if (systemConnections === 0) {
    return stuck === 1
      ? '1 person has no usable connection and cannot send a message. No system connection is configured, so adding one fixes this for everybody.'
      : `${String(stuck)} people have no usable connection and cannot send a message. No system connection is configured, so adding one fixes this for everybody.`;
  }
  return stuck === 1
    ? '1 person has no usable connection and cannot send a message. Give them their own connection, or allow them to add one.'
    : `${String(stuck)} people have no usable connection and cannot send a message. Give them their own connection, or allow them to add one.`;
}

function removeButtonLabel(handle: string): string {
  return `Remove ${handle}…`;
}

function removeTitle(handle: string): string {
  return `Remove ${handle}?`;
}

function handleIsFreeAgain(handle: string): string {
  return `The handle ${handle} is free to use again straight away, and a new account with that name will not see any of this.`;
}

function confirmPrompt(handle: string): string {
  return `Type ${handle} to confirm`;
}

/**
 * What to type in the first-password box, as one whole sentence per case.
 *
 * The number is `auth.minPasswordLength`, read from `GET /api/auth/state`
 * rather than mirrored here, because it is this install's setting. Zero says
 * plainly what a blank box will do: it is a legal password, and an admin who
 * leaves the field empty should know they are creating an account that signs in
 * with nothing rather than one with no password set.
 */
function firstPasswordRule(minimum: number): string {
  if (minimum === 0) {
    return 'This install sets no minimum length. Leave it blank and they will sign in with an empty password.';
  }
  if (minimum === 1) return 'At least 1 character. They can change it once they sign in.';
  return `At least ${String(minimum)} characters. They can change it once they sign in.`;
}
