// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { useState, type JSX } from 'react';

import { ApiError } from '../api.js';
import { CheckboxField, Field, NumberField, SelectField } from '../editor/Field.js';
import { useAdminConfig, useWriteConfig } from '../queries.js';

/**
 * The install's settings — [05 §15.3](../../../../docs/design/05-ui-surfaces.md).
 *
 * **Every control is generated from the config the server sent**, including its
 * tier badge, because the tier table travels as data ([13 §4]) and a hand-written
 * list of fields here would be a second copy of the schema — wrong the first
 * time somebody adds a key.
 *
 * What the form does *not* offer is [P2A §2.6]'s list, each refused by name:
 * system connections (P2B), the system library panel (there is no action for an
 * admin to take, and [05 §15.4] says a panel without one does not belong),
 * extensions (install does not exist), *Restart now* (see the banner), and
 * connectivity state (its producer is P11's update check).
 */

/** Leaf paths, in the order the server sent them. */
function leaves(value: unknown, prefix = ''): string[] {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return prefix ? [prefix] : [];
  }
  return Object.entries(value).flatMap(([key, child]) =>
    leaves(child, prefix ? `${prefix}.${key}` : key),
  );
}

function valueAt(source: unknown, path: string): unknown {
  return path
    .split('.')
    .reduce<unknown>(
      (node, part) =>
        typeof node === 'object' && node !== null
          ? (node as Record<string, unknown>)[part]
          : undefined,
      source,
    );
}

function setAt(target: Record<string, unknown>, path: string, value: unknown): void {
  const parts = path.split('.');
  const last = parts.pop();
  if (last === undefined) return;
  let node = target;
  for (const part of parts) node = node[part] as Record<string, unknown>;
  node[last] = value;
}

/**
 * **`dataDir` is read-only**, and the reason is written into the field rather
 * than left to be discovered.
 *
 * It decides where `config.json` itself lives, so a form that edited it and then
 * wrote to the old location would be a one-click way to appear to lose
 * everything ([P2A §2.6]).
 */
const READ_ONLY = new Set(['dataDir']);

export function AdminInstall(): JSX.Element {
  const view = useAdminConfig();
  const write = useWriteConfig();
  const [draft, setDraft] = useState<Record<string, unknown> | null>(null);
  const [conflict, setConflict] = useState<Record<string, unknown> | null>(null);

  if (view.isPending) return <p className="text-sm text-slate-500">Loading…</p>;
  if (view.isError) return <p role="alert">The configuration could not be read.</p>;

  const config = draft ?? view.data.config;
  const paths = leaves(view.data.config);
  const unread = paths.filter(
    (path) => view.data.tiers[path] === 'live' && view.data.appliers[path] === 'unread',
  );

  function change(path: string, value: unknown): void {
    const next = structuredClone(config);
    setAt(next, path, value);
    setDraft(next);
  }

  return (
    <section className="flex flex-col gap-6" aria-labelledby="install">
      <h3 id="install" className="text-base font-medium">
        This install
      </h3>
      <p className="text-xs text-slate-500">
        Read from <code>{view.data.path}</code>. You can edit that file directly instead; this form
        will notice if you do.
      </p>

      <form
        className="flex max-w-md flex-col gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          setConflict(null);
          write.mutate(config, {
            onSuccess: () => {
              setDraft(null);
            },
            onError: (error) => {
              /**
               * 412 carries the config on disk, so the refusal can offer *load
               * what is on disk* rather than only saying no ([P2A §3]).
               *
               * **`error.current` is already that config.** `request()` lifts
               * the response body's `current` field onto the error, so reading
               * `.current` off it again — which this did — is always
               * `undefined`, and the whole conflict block below was
               * unreachable. Nothing caught it because no test exercised the
               * 412 path from the client side; the server's own test asserts
               * `response.body.current.history.keepPerObject` and stops there.
               */
              if (error instanceof ApiError && error.status === 412 && error.current) {
                setConflict(error.current as unknown as Record<string, unknown>);
              }
            },
          });
        }}
      >
        {paths.map((path) => (
          <ConfigControl
            key={path}
            path={path}
            value={valueAt(config, path)}
            tier={view.data.tiers[path] ?? 'restart'}
            readOnly={READ_ONLY.has(path)}
            onChange={(next) => {
              change(path, next);
            }}
          />
        ))}

        {unread.length > 0 ? (
          /**
           * **The group that stops a control ever doing nothing silently.**
           *
           * A tier says what a key is *for*; `appliers` says whether anything
           * reads it yet, and the two are allowed to disagree ([P2A §2.5]).
           * Without this the form would tell somebody a change had taken when
           * it had only been stored.
           */
          <p className="text-xs text-slate-500">{unreadNotice(unread)}</p>
        ) : null}

        <div className="flex items-center gap-3">
          <button type="submit" className="rounded-md bg-slate-900 px-3 py-2 text-sm text-white">
            Save
          </button>
          {write.isSuccess && draft === null ? (
            <p role="status" className="text-sm text-slate-600">
              Saved.
            </p>
          ) : null}
        </div>

        {conflict === null ? null : (
          <div role="alert" className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm">
            <p>
              The file changed on disk since this page loaded. Saving now would overwrite that edit.
            </p>
            <button
              type="button"
              className="mt-2 rounded-md border border-slate-300 px-3 py-1.5"
              onClick={() => {
                setDraft(conflict);
                setConflict(null);
              }}
            >
              Load what is on disk
            </button>
          </div>
        )}
      </form>
    </section>
  );
}

/** One key, rendered by what its value is rather than by a list of names. */
function ConfigControl({
  path,
  value,
  tier,
  readOnly,
  onChange,
}: {
  path: string;
  value: unknown;
  tier: 'live' | 'reconnect' | 'restart';
  readOnly: boolean;
  onChange: (value: unknown) => void;
}): JSX.Element {
  const label = tier === 'restart' ? needsRestartLabel(path) : path;

  if (typeof value === 'boolean') {
    return (
      <CheckboxField
        label={label}
        checked={value}
        onChange={onChange}
        {...(path === 'server.trustProxy'
          ? { hint: 'Only turn this on behind a reverse proxy you run.' }
          : {})}
      />
    );
  }

  if (typeof value === 'number') {
    return (
      <NumberField
        label={label}
        value={String(value)}
        onChange={(next) => {
          const parsed = Number(next);
          onChange(Number.isNaN(parsed) ? value : parsed);
        }}
      />
    );
  }

  if (path === 'log.level') {
    return (
      <SelectField
        label={label}
        value={String(value)}
        options={[
          ['silent', 'Silent'],
          ['error', 'Errors'],
          ['warn', 'Warnings'],
          ['info', 'Info'],
          ['debug', 'Debug'],
          ['trace', 'Trace'],
        ]}
        onChange={onChange}
      />
    );
  }

  return (
    <Field
      label={label}
      value={String(value)}
      onChange={onChange}
      {...(readOnly
        ? {
            readOnlyNote:
              'Set with --data when you start the server, or by editing config.json. Changing it here would write to the old location.',
          }
        : {})}
      {...(path === 'server.host'
        ? {
            hint: 'Anything other than 127.0.0.1 makes this reachable from your network. Only do that on a network you trust — there is no HTTPS by default.',
          }
        : {})}
    />
  );
}

/**
 * Whole sentences — [01 §2]. See the note in `AdminAccounts.tsx`; the same rule
 * applies to a label with a parenthetical, which is a sentence with a value in
 * the middle of it.
 */
function needsRestartLabel(path: string): string {
  return `${path} (needs a restart)`;
}

function unreadNotice(paths: string[]): string {
  return `Stored, but nothing reads these yet: ${paths.join(', ')}. They will apply when the features that use them ship.`;
}
