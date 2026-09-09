// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { useState, type JSX } from 'react';

import { ApiError } from '../api.js';
import { CheckboxField, Field, NumberField, SelectField } from '../ui/Field.js';
import { Alert } from '../ui/Alert.js';
import { Button } from '../ui/Button.js';
import { page } from '../ui/classes.js';
import { useAdminConfig, useWriteConfig } from '../queries.js';

/**
 * The install's settings — [10 §15.3](../../../../docs/design/10-ui-surfaces.md).
 *
 * **Every control is generated from the config the server sent**, including its
 * tier badge, because the tier table travels as data ([21 §4]) and a hand-written
 * list of fields here would be a second copy of the schema — wrong the first
 * time somebody adds a key.
 *
 * What the form does *not* offer is [P2A §2.6]'s list, each refused by name:
 * system connections (P2B), the system library panel (there is no action for an
 * admin to take, and [10 §15.4] says a panel without one does not belong),
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
  /**
   * What a refusal handed back: the file's content, and the acknowledgement to
   * present with whichever recovery the admin picks.
   */
  const [conflict, setConflict] = useState<{
    document: Record<string, unknown>;
    contentHash: string;
  } | null>(null);

  if (view.isPending) return <p className="text-sm text-ink-faint">Loading…</p>;
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
      <h3 id="install" className="text-subsection text-ink">
        This install
      </h3>
      <p className="text-xs text-ink-faint">
        Read from <code>{view.data.path}</code>. You can edit that file directly instead; this form
        will notice if you do.
      </p>

      {/*
       * The fields in a `max-w-md` block and the form at the column's width,
       * because the action row below is the strip the editors hold their Save
       * in ([10 §11.6]) and its recipe needs the column's edges —
       * `UserSettings` has the longer note. This is the form the strip was
       * most owed on this page: a screen and a half of keys with Save at the
       * foot of them is the editor's failure at a smaller scale.
       */}
      <form
        className="flex flex-col gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          setConflict(null);
          write.mutate(
            {
              config,
              // Present only after a refusal the admin has answered. A plain
              // Save sends none, so neither recovery can happen by accident.
              ...(conflict === null ? {} : { contentHash: conflict.contentHash }),
            },
            {
              onSuccess: () => {
                setDraft(null);
                setConflict(null);
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
                  setConflict({
                    document: error.current as unknown as Record<string, unknown>,
                    contentHash: error.contentHash ?? '',
                  });
                }
              },
            },
          );
        }}
      >
        <div className="flex max-w-md flex-col gap-4">
          {paths.map((path) => (
            <ConfigControl
              key={path}
              path={path}
              value={valueAt(config, path)}
              tier={view.data.tiers[path] ?? 'restart'}
              bound={view.data.bounds[path] ?? {}}
              choices={view.data.choices[path]}
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
            <p className="text-xs text-ink-faint">{unreadNotice(unread)}</p>
          ) : null}
        </div>

        <div className={page.actions}>
          {/**
           * **The conflict is inside the strip**, on a line of its own above
           * the buttons, and that is a consequence of holding the strip rather
           * than a flourish. Pinned, the strip covers the foot of the form,
           * which is where this block used to render — so a 412 answered from
           * a pinned Save would have arrived below the fold, out of sight of
           * the click that provoked it. That is the silent refusal [work plan §2.2]
           * forbids and this form has already been caught in once, put back
           * by layout.
           */}
          {conflict === null ? null : (
            <Alert tone="warning" role="alert" className="basis-full">
              <p>
                The file changed on disk since this page loaded. Saving now would overwrite that
                edit.
              </p>
              {/**
               * **Two offers, and the acknowledgement stays set for both.**
               *
               * Whichever the admin picks, the next save presents `contentHash` —
               * the form saying *I have seen what is on disk*. The difference
               * between them is only which values travel beside it, which is why
               * pressing Save without choosing is refused again rather than
               * silently picking one.
               */}
              <div className="mt-2 flex gap-2">
                <Button
                  type="button"
                  size="compact"
                  onClick={() => {
                    setDraft(conflict.document);
                  }}
                >
                  Load what is on disk
                </Button>
                <Button
                  type="button"
                  size="compact"
                  onClick={() => {
                    setDraft(config);
                  }}
                >
                  Overwrite with mine
                </Button>
              </div>
            </Alert>
          )}
          <Button type="submit" variant="primary" size="compact">
            Save
          </Button>
          {write.isSuccess && draft === null ? (
            <p role="status" className="text-sm text-ink-subtle">
              Saved.
            </p>
          ) : null}
          {/**
           * **A refused save used to say nothing at all.** The form rendered
           * only success and the 412 block, so a server 400 — an out-of-range
           * value, a key the build does not know — left the page looking exactly
           * as it had before, which is the failure mode [work plan §2.2] is about.
           *
           * **`conflict === null` is load-bearing rather than tidiness.** The
           * conflict block above is already `role="alert"`, and a second one
           * beside it makes `findByRole('alert')` ambiguous — the settings test
           * throws on it. It also reads correctly: a conflict already explains
           * itself and offers two recoveries, so a second paragraph would be
           * noise rather than news.
           */}
          {write.isError && conflict === null ? (
            <p role="alert" className="text-sm text-danger-ink">
              {saveFailure(write.error)}
            </p>
          ) : null}
        </div>
      </form>
    </section>
  );
}

/** One key, rendered by what its value is rather than by a list of names. */
function ConfigControl({
  path,
  value,
  tier,
  bound,
  choices,
  readOnly,
  onChange,
}: {
  path: string;
  value: unknown;
  tier: 'live' | 'reconnect' | 'restart';
  bound: { minimum?: number; maximum?: number };
  choices: string[] | undefined;
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
        // From the server's own schema, so the browser refuses an out-of-range
        // value before the save does. The form sets no `noValidate`, so these
        // genuinely block the submit rather than only decorating the field.
        {...(bound.minimum === undefined ? {} : { min: bound.minimum })}
        {...(bound.maximum === undefined ? {} : { max: bound.maximum })}
        onChange={(next) => {
          const parsed = Number(next);
          onChange(Number.isNaN(parsed) ? value : parsed);
        }}
      />
    );
  }

  /**
   * **A closed union is a picker, and the values come from the server.**
   *
   * This was a hand-written list keyed on `log.level`, and it carried `trace` —
   * which the schema's union does not contain. Picking it answered `400` and
   * the form said nothing, so the one control an operator reaches for when they
   * want more log was the one that silently would not take. A second copy of a
   * schema is a copy that drifts, which is the argument the tier badge and the
   * numeric bounds already made; this is the same list, arriving the same way.
   *
   * It also picks up `updates.channel` for free, which had been rendering as a
   * free-text box over a three-value union.
   */
  if (choices !== undefined) {
    return (
      <SelectField
        label={label}
        value={String(value)}
        options={choices.map((choice) => [choice, labelOf(choice)])}
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

/**
 * Why a save was refused, as one whole sentence — [01 §2].
 *
 * The server's own message is surfaced rather than paraphrased, the way
 * `AdminAccounts` surfaces a refused account creation: a 400 from
 * `PUT /config` names the path and the constraint (`/auth/minPasswordLength
 * must be <= 128`), and an admin editing a config form is exactly the reader
 * that sentence was written for.
 */
function saveFailure(error: Error): string {
  return error instanceof ApiError && error.status === 400
    ? `The server refused these settings: ${error.message}`
    : 'These settings could not be saved.';
}

/**
 * A union member as a label — *Warnings*, not *warn*.
 *
 * Sentence case rather than a lookup table, because a table is the second copy
 * this control was built to delete. The values are lowercase identifiers by
 * construction ([21 §4]), so capitalising the first letter is the whole rule,
 * and a value that needs more than that needs a real name in the schema.
 */
function labelOf(choice: string): string {
  return choice.charAt(0).toUpperCase() + choice.slice(1);
}
