// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { useState, type JSX } from 'react';

import type { AccountPatch, AdminAccount } from '../api.js';

import { CheckboxField, Field, SelectField } from '../editor/Field.js';
import {
  useAdminAccounts,
  useCreateAccount,
  useRemoveAccount,
  useUpdateAccount,
} from '../queries.js';
import { useFocusTrap } from '../useFocusTrap.js';

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

  if (accounts.isPending) return <p className="text-sm text-slate-500">Loading…</p>;
  if (accounts.isError) return <p role="alert">The account list could not be read.</p>;

  const rows = accounts.data.accounts;
  const stuck = accounts.data.withoutUsableConnection;

  return (
    <section className="flex flex-col gap-6" aria-labelledby="accounts">
      <div>
        <h3 id="accounts" className="text-base font-medium">
          Accounts
        </h3>
        {stuck > 0 ? (
          /**
           * The count in the heading, and the fix beside it. A number with
           * nothing to point at leaves an administrator counting rows
           * themselves ([05 §15.4]), so each row says so too — and when there is
           * no system connection at all, this is one fix rather than n.
           */
          <p role="status" className="mt-1 text-sm text-amber-800">
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
    <li className="rounded-md border border-slate-200 p-4">
      <div className="flex items-baseline justify-between gap-4">
        <div>
          <p className="font-medium">{row.displayName}</p>
          <p className="text-xs text-slate-500">{row.handle}</p>
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
        <p className="mt-2 text-sm text-amber-800">
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
          <legend className="text-xs font-medium tracking-wide text-slate-500 uppercase">
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
         */}
        <fieldset className="border-0 p-0">
          <legend className="text-xs font-medium tracking-wide text-slate-500 uppercase">
            Recorded for later
          </legend>
          <p className="mt-1 mb-2 text-xs text-slate-500">
            These features have not shipped. What you set here is kept and will apply when they do.
          </p>
          <div className="flex flex-col gap-3">
            <SelectField
              label="Files"
              value={row.capabilities.fileAccess}
              options={[
                ['none', 'No file browser'],
                ['read', 'May read their own files'],
                ['write', 'May edit their own files'],
              ]}
              onChange={(value) => {
                patch({ capabilities: { fileAccess: value } });
              }}
            />
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
        <p role="alert" className="mt-3 text-sm text-red-900">
          {refused}
        </p>
      )}

      <button
        type="button"
        className="mt-4 rounded-md border border-red-300 px-3 py-1.5 text-sm text-red-900"
        onClick={onRemove}
      >
        {removeButtonLabel(row.handle)}
      </button>
    </li>
  );
}

/** Making an account, which is the phase's demo in one form. */
function NewAccount(): JSX.Element {
  const create = useCreateAccount();
  const [handle, setHandle] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<'admin' | 'user'>('user');

  return (
    <form
      className="flex max-w-md flex-col gap-3 rounded-md border border-slate-200 p-4"
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
      <h4 id="new-account" className="text-base font-medium">
        Add someone
      </h4>
      <Field
        label="Handle"
        value={handle}
        onChange={setHandle}
        hint="Lowercase, and it becomes their folder name under data/users."
      />
      <Field label="First password" value={password} onChange={setPassword} />
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
      <div className="flex items-center gap-3">
        <button type="submit" className="rounded-md bg-slate-900 px-3 py-2 text-sm text-white">
          Create
        </button>
        {create.isError ? (
          <p role="alert" className="text-sm text-red-900">
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
  const surface = useFocusTrap(onDone);

  return (
    <div
      ref={surface}
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="remove-title"
      className="fixed inset-0 flex items-center justify-center bg-slate-900/40 p-4"
    >
      <div className="flex max-w-lg flex-col gap-4 rounded-md bg-white p-6">
        <h4 id="remove-title" className="text-base font-medium">
          {removeTitle(handle)}
        </h4>
        {/**
         * **Whole sentences**, because word order differs between languages and
         * a sentence built by concatenation cannot be translated at all
         * ([01 §2]) — which is why the handle is substituted into each string
         * rather than sitting between two JSX fragments.
         */}
        <p className="text-sm text-slate-700">
          Their library is moved to data/removed/ on the server. StoryEngine will not delete it —
          remove that folder yourself when you are sure.
        </p>
        <p className="text-sm text-slate-700">{handleIsFreeAgain(handle)}</p>
        <Field label={confirmPrompt(handle)} value={typed} onChange={setTyped} />
        {remove.isError ? (
          <p role="alert" className="text-sm text-red-900">
            {remove.error.message}
          </p>
        ) : null}
        <div className="flex justify-end gap-2">
          <button
            type="button"
            className="rounded-md border border-slate-300 px-3 py-2 text-sm"
            onClick={onDone}
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={typed !== handle}
            className="rounded-md bg-red-700 px-3 py-2 text-sm text-white disabled:opacity-40"
            onClick={() => {
              remove.mutate(handle, { onSuccess: onDone });
            }}
          >
            Remove and move their data
          </button>
        </div>
      </div>
    </div>
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
