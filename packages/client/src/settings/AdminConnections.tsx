// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { useState, type JSX } from 'react';

import type { AdminConnection, ConnectionCapabilities, RoleRow } from '../api.js';
import { Field, SelectField } from '../ui/Field.js';
import { SecretField } from '../ui/SecretField.js';
import {
  useBindings,
  useConnectionBindings,
  useConnections,
  useDeleteConnection,
  useFetchModels,
  useRoles,
  useSaveConnection,
  useWriteDefaultBindings,
} from '../queries.js';
import { Alert } from '../ui/Alert.js';
import { Button } from '../ui/Button.js';
import { Dialog } from '../ui/Dialog.js';

/**
 * System connections and the install's role bindings —
 * [05 §15.3](../../../../docs/design/05-ui-surfaces.md),
 * [P2B §3](../../../../docs/design/workplan/14-p2b-provider-configuration.md) stages P2B.3
 * and P2B.4.
 *
 * **This is the section that makes the phase's demo possible:** *fresh install →
 * admin → one key → a turn*, with no text editor at any point. Every gate step
 * that could not be walked before this file existed is walked through it.
 *
 * ## The scope line, once
 *
 * **The system scope and only the system scope** ([P2B §2.7]). A user's own
 * `connections/` and `bindings.json` are read by the resolver, counted by the
 * delete warning, hand-written by anyone who wants one, and reachable from
 * nothing here. [05 §15.1]'s *your connections* bullet waits for the phase that
 * builds the user half — the role table below is the same component with its
 * personal column not yet populated, which is
 * [01 §2.2](../../../../docs/design/workplan/01-work-plan.md)'s minimal demonstration rather
 * than a placeholder.
 *
 * ## What it inherits rather than builds
 *
 * `Field` and `SelectField`; `useFocusTrap`, extracted at P2A.6 precisely so a
 * third dialog would not respell it; and `SecretField`, which was
 * `UserSettings`' file-private `PasswordInput` until this section needed a
 * masked box that could also say *leave this blank to keep the stored key*.
 *
 * **And the rule to write under rather than rediscover:** every user-facing
 * sentence is one string with its values substituted in. The lint rule against
 * sentences assembled from fragments fires on exactly the shapes this file is
 * made of — a count with a noun after it, a label with a parenthetical — and it
 * caught five of them in P2A.6 and was right every time.
 */

/**
 * Only what this build can actually construct — [P2B §2.5].
 *
 * `KNOWN_PROVIDERS` carries capability defaults for five names and one adapter
 * ships, so a picker listing all five would offer four choices that save
 * cleanly and fail at the next turn. The server refuses them too: a form its
 * route trusts is a form that route has not met.
 */
const PROVIDERS = [['openai-compatible', 'OpenAI-compatible']] as const;

export function AdminConnections(): JSX.Element {
  const connections = useConnections();
  const bindings = useBindings();
  const [editing, setEditing] = useState<AdminConnection | 'new' | null>(null);
  const [confirming, setConfirming] = useState<AdminConnection | null>(null);

  if (connections.isPending) return <p className="text-sm text-ink-faint">Loading…</p>;
  if (connections.isError) return <p role="alert">The connections could not be read.</p>;

  const rows = connections.data.connections;
  /**
   * **Nothing bound yet** is the state P2B.4's offer exists for, and it is a
   * property of the bindings file rather than of the connection just saved —
   * so a second connection on an install that already has defaults does not
   * re-ask, and a first connection on an install whose `bindings.json` was
   * hand-written does not either.
   */
  const unbound = bindings.data !== undefined && Object.keys(bindings.data.bindings).length === 0;

  return (
    <section className="flex flex-col gap-6" aria-labelledby="connections">
      <div>
        <h3 id="connections" className="text-subsection text-ink">
          Connections
        </h3>
        <p className="mt-1 text-xs text-ink-faint">
          Shared by everybody on this install. Keys stay on the server and are never sent back to a
          browser.
        </p>
      </div>

      {rows.length === 0 ? (
        <p className="text-sm text-ink-subtle">
          There are no connections yet, so nobody can send a message.
        </p>
      ) : (
        <ul className="flex flex-col gap-3">
          {rows.map((row) => (
            <li
              key={`${row.id}-${String(row.shadowed)}`}
              className="rounded-md border border-line p-4"
            >
              <div className="flex items-baseline justify-between gap-4">
                <div>
                  <p className="font-medium">{row.label}</p>
                  <p className="text-xs text-ink-faint">{row.provider}</p>
                </div>
                <div className="flex gap-2">
                  <Button
                    type="button"
                    size="compact"
                    onClick={() => {
                      setEditing(row);
                    }}
                  >
                    Edit
                  </Button>
                  <Button
                    type="button"
                    variant="dangerOutline"
                    size="compact"
                    onClick={() => {
                      setConfirming(row);
                    }}
                  >
                    {removeLabel(row.label)}
                  </Button>
                </div>
              </div>
              <p className="mt-2 text-xs text-ink-faint">{keyState(row)}</p>
              {row.shadowed ? (
                /**
                 * **Both are listed and nothing is blocked** — [P1 §1.2]'s
                 * posture — but the one that loses says so. Two files claiming
                 * one id is what a hand-edited directory does, and an admin
                 * editing the copy nothing resolves to would otherwise watch
                 * their change do nothing at all.
                 */
                <p className="mt-2 text-sm text-warn-ink">
                  Another connection file on disk already uses this id, so nothing will ever resolve
                  to this one. Remove one of them.
                </p>
              ) : null}
            </li>
          ))}
        </ul>
      )}

      <div>
        <Button
          type="button"
          variant="primary"
          size="compact"
          onClick={() => {
            setEditing('new');
          }}
        >
          Add a connection
        </Button>
      </div>

      {editing === null ? null : (
        <ConnectionForm
          connection={editing === 'new' ? null : editing}
          offerDefaults={unbound}
          onDone={() => {
            setEditing(null);
          }}
        />
      )}

      {confirming === null ? null : (
        <RemoveConnectionDialog
          connection={confirming}
          onDone={() => {
            setConfirming(null);
          }}
        />
      )}

      <RoleTable />
    </section>
  );
}

/**
 * Adding or editing one — and the two are one form, because they are one thing.
 *
 * **`contentHash` travels on an edit and not on a create**, which is what the
 * server requires and why: an edit can be stale and a create cannot. The check
 * defends against a text editor rather than a second admin ([P2B §6]) —
 * `connections/` is hand-editable by design, and without it renaming a
 * connection here would silently revert whatever somebody changed in the file
 * since this page loaded.
 */
function ConnectionForm({
  connection,
  offerDefaults,
  onDone,
}: {
  connection: AdminConnection | null;
  offerDefaults: boolean;
  onDone: () => void;
}): JSX.Element {
  const save = useSaveConnection();
  const models = useFetchModels();
  const [label, setLabel] = useState(connection?.label ?? '');
  const [provider, setProvider] = useState(connection?.provider ?? 'openai-compatible');
  const [baseUrl, setBaseUrl] = useState(connection?.baseUrl ?? '');
  const [apiKey, setApiKey] = useState('');
  const [modelText, setModelText] = useState((connection?.models ?? []).join(', '));
  /**
   * The two capability overrides an operator has a reason to set, as text
   * because an empty box has to mean *whatever the default is* and a number
   * input cannot say that.
   */
  const [contextText, setContextText] = useState(
    connection?.capabilities?.maxContextTokens === undefined
      ? ''
      : String(connection.capabilities.maxContextTokens),
  );
  const [reportsUsage, setReportsUsage] = useState<boolean | null>(
    connection?.capabilities?.reportsUsage ?? null,
  );
  /** What a refusal handed back, so both ways out of a 412 are reachable. */
  const [conflict, setConflict] = useState<AdminConnection | null>(null);
  const [saved, setSaved] = useState<AdminConnection | null>(null);

  const offered = models.data?.models ?? [];

  /**
   * **The offer, after the save rather than instead of it.** A first
   * connection is useless until something is bound to it, and asking both
   * questions in one form would mean asking which model is the expensive one
   * before the admin has any list of models to choose from.
   */
  if (saved !== null && offerDefaults) {
    return (
      <FirstRunDefaults
        connection={saved}
        onDone={() => {
          setSaved(null);
          onDone();
        }}
      />
    );
  }

  return (
    <form
      className="flex max-w-md flex-col gap-4 rounded-md border border-line p-4"
      aria-labelledby="connection-form"
      onSubmit={(event) => {
        event.preventDefault();
        save.mutate(
          {
            label,
            provider,
            baseUrl,
            models: modelText
              .split(',')
              .map((model) => model.trim())
              .filter((model) => model.length > 0),
            // Blank keeps what is stored, which is the whole reason `hasKey` is
            // on the wire — an empty box cannot say *no key* and *unchanged*
            // apart, so the form says nothing and the server preserves.
            ...(apiKey.length === 0 ? {} : { apiKey }),
            /**
             * **Merged over what is stored, never replacing it.** A capability
             * this form does not know about was written by hand by somebody who
             * did know, and a save that sent only these two would delete it —
             * which is the bug the key already taught this file once.
             */
            ...capabilitiesFrom(connection, contextText, reportsUsage),
            ...(connection === null
              ? {}
              : {
                  id: connection.id,
                  contentHash: conflict?.contentHash ?? connection.contentHash,
                }),
          },
          {
            onSuccess: (result) => {
              setConflict(null);
              if (offerDefaults) setSaved(result.connection);
              else onDone();
            },
            onError: (error) => {
              const carried = staleConnection(error);
              if (carried !== null) setConflict(carried);
            },
          },
        );
      }}
    >
      <h4 id="connection-form" className="text-subsection text-ink">
        {connection === null ? 'Add a connection' : editTitle(connection.label)}
      </h4>

      <Field label="Name" value={label} onChange={setLabel} hint="Only you will see this." />
      <SelectField label="Kind" value={provider} options={PROVIDERS} onChange={setProvider} />
      <Field
        label="Address"
        value={baseUrl}
        onChange={setBaseUrl}
        placeholder="https://api.openai.com/v1"
        hint="Leave this blank for OpenAI itself. For a model running on your own machine it is usually something like http://localhost:11434/v1."
      />
      <SecretField label="Key" value={apiKey} onChange={setApiKey} keptNote={keyNote(connection)} />

      <div className="flex flex-col gap-2">
        <Field
          label="Models"
          value={modelText}
          onChange={setModelText}
          hint="Separate them with commas. You can type them yourself — the button below only saves you the typing."
        />
        <div className="flex items-center gap-3">
          <Button
            type="button"
            size="compact"
            onClick={() => {
              models.mutate({
                ...(baseUrl.length === 0 ? {} : { baseUrl }),
                ...(apiKey.length === 0 ? {} : { apiKey }),
              });
            }}
          >
            Ask the endpoint what it offers
          </Button>
          {models.isError ? (
            /**
             * **A notice, never a blocked save** — [P2B §2.6]. `/models` is
             * optional in practice, and several local runtimes answer it with
             * one entry called `gpt-3.5-turbo` regardless of what is loaded.
             */
            <p role="status" className="text-sm text-ink-subtle">
              That endpoint did not answer with a model list. Type the model name instead.
            </p>
          ) : null}
        </div>
        {offered.length === 0 ? null : (
          <ul className="flex flex-wrap gap-2">
            {offered.map((model) => (
              <li key={model}>
                <Button
                  type="button"
                  size="compact"
                  onClick={() => {
                    setModelText((text) => (text.length === 0 ? model : `${text}, ${model}`));
                  }}
                >
                  {model}
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <details className="text-sm">
        <summary className="cursor-pointer text-ink-muted hover:text-ink">
          What this endpoint can do
        </summary>
        <div className="mt-2 flex flex-col gap-4">
          {/**
           * **Behind a disclosure because the defaults are usually right**, and
           * wrong in a way only the operator can see: this build assumes a
           * conservative context window and now assumes an OpenAI-compatible
           * endpoint counts tokens. Somebody running a local model is the only
           * person who knows their real window.
           */}
          <Field
            label="Context window"
            value={contextText}
            onChange={setContextText}
            placeholder="Leave blank to use the default"
            hint="How many tokens this endpoint accepts in one request. Only set this if you know it — getting it wrong truncates the story or wastes the space."
          />
          <SelectField
            label="Reports token counts"
            value={reportsUsage === null ? 'default' : reportsUsage ? 'yes' : 'no'}
            options={USAGE_OPTIONS}
            onChange={(next) => {
              setReportsUsage(next === 'default' ? null : next === 'yes');
            }}
          />
        </div>
      </details>

      {conflict === null ? null : (
        <Alert tone="warning" role="alert">
          <p>
            The connection file changed on disk since this page loaded. Saving now would overwrite
            that edit.
          </p>
          {/**
           * Two offers, and the acknowledgement stays set for both — the shape
           * the config form arrived at after P2A's gate found that a 412 with
           * only one way out is a wedge rather than a refusal.
           */}
          <div className="mt-2 flex gap-2">
            <Button
              type="button"
              size="compact"
              onClick={() => {
                setLabel(conflict.label);
                setBaseUrl(conflict.baseUrl ?? '');
                setModelText(conflict.models.join(', '));
              }}
            >
              Load what is on disk
            </Button>
            <Button type="submit" size="compact">
              Overwrite with mine
            </Button>
          </div>
        </Alert>
      )}

      <div className="flex items-center gap-3">
        <Button type="submit" variant="primary" size="compact">
          Save
        </Button>
        <Button type="button" size="compact" onClick={onDone}>
          Cancel
        </Button>
        {save.isError && conflict === null ? (
          <p role="alert" className="text-sm text-danger-ink">
            {save.error.message}
          </p>
        ) : null}
      </div>
    </form>
  );
}

/**
 * The first run's one question — [P2B §3] stage P2B.4, and
 * [07 §5.1](../../../../docs/design/07-tech-stack.md)'s *a good one and a cheap one*.
 *
 * **Two pickers rather than eight**, because eight is more setup than anybody
 * will do and one system-wide default is not enough. Which role gets which is
 * the server's to decide — the expensive model writes, everything else uses the
 * cheap one — so this posts two bindings and `defaultBindings` spreads them.
 *
 * **One model answers both when only one exists**, which is the ordinary case
 * for somebody pointing at a model on their own machine. Being made to pick the
 * same entry twice would read as a form that had not understood the answer.
 */
function FirstRunDefaults({
  connection,
  onDone,
}: {
  connection: AdminConnection;
  onDone: () => void;
}): JSX.Element {
  const bindings = useBindings();
  const write = useWriteDefaultBindings();
  const first = connection.models[0] ?? '';
  const [hi, setHi] = useState(first);
  const [lo, setLo] = useState(connection.models[1] ?? first);

  const options = connection.models.map((model) => [model, model] as const);

  if (connection.models.length === 0) {
    return (
      <div className="flex max-w-md flex-col gap-3 rounded-md border border-line p-4">
        <p className="text-sm text-ink-muted">
          This connection lists no models yet, so there is nothing to use it for. Add at least one
          model name and nothing else has to change.
        </p>
        <div>
          <Button type="button" size="compact" onClick={onDone}>
            Close
          </Button>
        </div>
      </div>
    );
  }

  return (
    <form
      className="flex max-w-md flex-col gap-4 rounded-md border border-line p-4"
      aria-labelledby="first-run"
      onSubmit={(event) => {
        event.preventDefault();
        if (bindings.data === undefined) return;
        write.mutate(
          {
            hi: { connectionId: connection.id, modelId: hi },
            lo: { connectionId: connection.id, modelId: lo },
            contentHash: bindings.data.contentHash,
          },
          { onSuccess: onDone },
        );
      }}
    >
      <h4 id="first-run" className="text-subsection text-ink">
        Use this for everything?
      </h4>
      <p className="text-sm text-ink-muted">
        Nothing is set up to use a model yet. Pick a good one and a cheap one and the rest is
        arranged for you — the good one writes the story, the cheap one does the background work.
        You can change any of it afterwards.
      </p>
      <SelectField label="The good one" value={hi} options={options} onChange={setHi} />
      <SelectField label="The cheap one" value={lo} options={options} onChange={setLo} />
      <div className="flex items-center gap-3">
        <Button type="submit" variant="primary" size="compact">
          Use these
        </Button>
        <Button type="button" size="compact" onClick={onDone}>
          Not now
        </Button>
        {write.isError ? (
          <p role="alert" className="text-sm text-danger-ink">
            {write.error.message}
          </p>
        ) : null}
      </div>
    </form>
  );
}

/**
 * Removing a connection — [P2B §2.8]: **warns and proceeds**, never refuses.
 *
 * The case this is for is an admin revoking a leaked key, and being blocked by
 * the fact that people were using it is exactly the wrong answer at exactly the
 * wrong moment. So the count is shown *before* confirming, and the roles that
 * lose their binding fall through to the install default rather than failing —
 * which is what [P2B §2.1]'s second layer bought.
 *
 * **Counts, never contents** ([04 §4.5]). A list of who binds what to which key
 * is a different feature with a different justification and nobody has asked
 * for it.
 */
function RemoveConnectionDialog({
  connection,
  onDone,
}: {
  connection: AdminConnection;
  onDone: () => void;
}): JSX.Element {
  const count = useConnectionBindings(connection.id);
  const remove = useDeleteConnection();
  return (
    <Dialog role="alertdialog" labelledBy="remove-connection" onDismiss={onDone} size="wide">
      <h4 id="remove-connection" className="text-subsection text-ink">
        {removeTitle(connection.label)}
      </h4>
      <p className="text-sm text-ink-muted">
        {count.data === undefined ? bindingCountUnknown() : bindingCount(count.data.bindings)}
      </p>
      <p className="text-sm text-ink-muted">
        The key stops working here straight away. Nothing revokes it at the provider — do that there
        as well if it has leaked.
      </p>
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
          onClick={() => {
            remove.mutate(connection.id, { onSuccess: onDone });
          }}
        >
          Remove it
        </Button>
      </div>
    </Dialog>
  );
}

/**
 * **What every role will do, in one table** — [P2B §3]'s *the part worth
 * getting right*, and the thing that turns *"why did this turn use that
 * model"* from a support question into a glance.
 *
 * **It renders what the server resolved; it does not work anything out.**
 * [07 §5.1]'s layering lives in `resolveRole`, and a table that inspected the
 * binding maps and decided which would win would be a second implementation of
 * the resolution order — wrong the first time a layer is added, and wrong
 * silently. `GET /api/admin/roles` exists precisely so this component can be
 * dumb.
 *
 * **Three states, not two.** *Unset by design* is the one that had no name
 * before: `image` reporting `unbound` on a fresh install is policy working, and
 * `prose` reporting `unbound` is an install nobody can play on. Shown alike,
 * they would send an admin hunting a fault that is not there.
 *
 * **And one column is deliberately absent.** [05 §15.1] wants a user to see
 * which of their bindings are personal and which fall through to the install —
 * that is the user half, and it waits for the phase that may write a personal
 * binding. This is the same component with that column not yet populated
 * ([P2B §2.7]), which is a minimal demonstration rather than a placeholder:
 * nothing here is discarded when the second column arrives.
 */
function RoleTable(): JSX.Element {
  const roles = useRoles();

  if (roles.isPending) return <p className="text-sm text-ink-faint">Loading…</p>;
  if (roles.isError) return <p role="alert">The role table could not be read.</p>;

  return (
    <div className="flex flex-col gap-2">
      <h4 id="roles" className="text-subsection text-ink">
        What each job uses
      </h4>
      <div className="overflow-x-auto">
        <table className="w-full text-start text-sm">
          <thead>
            <tr className="text-xs tracking-wide text-ink-faint uppercase">
              <th scope="col" className="py-1 pe-4 font-medium">
                Job
              </th>
              <th scope="col" className="py-1 pe-4 font-medium">
                Model
              </th>
              <th scope="col" className="py-1 font-medium">
                Where it comes from
              </th>
            </tr>
          </thead>
          <tbody>
            {roles.data.roles.map((row) => (
              <tr key={row.role} className="border-t border-line align-top">
                <th scope="row" className="py-2 pe-4 font-normal">
                  {roleLabel(row.role)}
                </th>
                <td className="py-2 pe-4">{roleModel(row)}</td>
                <td className={row.ok ? 'py-2 text-ink-faint' : 'py-2 text-warn-ink'}>
                  {roleSource(row)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/**
 * The user-facing sentences of this screen, each whole.
 *
 * [01 §2](../../../../docs/design/workplan/01-work-plan.md) keeps this part of i18n discipline
 * on day one because it is the unretrofittable part: word order differs between
 * languages, so a sentence assembled from fragments around a value cannot be
 * translated at all. A helper returning half a phrase is the same mistake with
 * an indirection, so each of these returns the whole thing — including the
 * plural branches, which are a *sentence* choice rather than a suffix.
 */

/** The 412's payload, if this error is one. */
function staleConnection(error: unknown): AdminConnection | null {
  const carried = (error as { status?: number; current?: unknown }).current;
  if ((error as { status?: number }).status !== 412) return null;
  return typeof carried === 'object' && carried !== null ? (carried as AdminConnection) : null;
}

function keyState(connection: AdminConnection): string {
  return connection.hasKey
    ? 'A key is stored for this connection.'
    : 'No key is stored, so this must be an endpoint that does not need one.';
}

function keyNote(connection: AdminConnection | null): string {
  return connection?.hasKey === true
    ? 'A key is stored. Leave this blank to keep it, or type a new one to replace it.'
    : 'Leave this blank if the endpoint does not need one, which is usual for a model running on your own machine.';
}

function removeLabel(label: string): string {
  return `Remove ${label}…`;
}

function removeTitle(label: string): string {
  return `Remove ${label}?`;
}

function editTitle(label: string): string {
  return `Edit ${label}`;
}

function bindingCountUnknown(): string {
  return 'Counting what points at this connection…';
}

function bindingCount(count: number): string {
  if (count === 0) return 'Nothing points at this connection, so removing it changes nothing else.';
  return count === 1
    ? '1 role points at this connection. It will fall back to the install default, or stop working if there is none.'
    : `${String(count)} roles point at this connection. They will fall back to the install default, or stop working if there is none.`;
}

/**
 * The eight roles, in words somebody who did not write this can read.
 *
 * The vocabulary is [07 §5.1]'s and it stays the vocabulary — this only decides
 * what the *table* says, and every id it does not know falls through to itself
 * rather than to a blank cell.
 */
const ROLE_LABELS: Record<string, string> = {
  prose: 'Writing the story',
  reasoning: 'Working things out',
  fast: 'Quick background jobs',
  vision: 'Reading images',
  embedding: 'Searching your library',
  image: 'Making images',
  video: 'Making video',
  speech: 'Speech',
};

function roleLabel(role: string): string {
  return ROLE_LABELS[role] ?? role;
}

function roleModel(row: RoleRow): string {
  if (row.ok && row.modelId !== undefined) return row.modelId;
  return row.tier === 'unset' ? 'Nothing yet' : 'Nothing — this will fail';
}

function roleSource(row: RoleRow): string {
  if (row.ok) {
    const label = row.connectionLabel ?? row.connectionId ?? '';
    return row.via === 'binding'
      ? `Your own setting, on ${label}`
      : `This install's default, on ${label}`;
  }
  if (row.reason === 'dangling') {
    return 'The connection this was set to has been removed. Set it to another one.';
  }
  return row.tier === 'unset'
    ? 'Nothing can do this yet, and nothing needs to.'
    : 'Nothing is set for this, so anything that needs it will fail.';
}

/** The three states the usage override has, one of which is *do not override*. */
const USAGE_OPTIONS: [string, string][] = [
  ['default', 'Use the default for this kind'],
  ['yes', 'Yes'],
  ['no', 'No'],
];

/**
 * The capability patch a save carries, or nothing.
 *
 * **Merged over what is stored.** Sending only the two fields this form knows
 * about would delete an override somebody wrote by hand for a capability it does
 * not — the same failure the API key already caused here once, and the reason
 * the server preserves rather than replaces.
 *
 * A blank context box removes the override rather than setting zero, which is
 * what *leave blank to use the default* has to mean.
 */
function capabilitiesFrom(
  connection: AdminConnection | null,
  contextText: string,
  reportsUsage: boolean | null,
): { capabilities: ConnectionCapabilities } | Record<string, never> {
  const stored = connection?.capabilities ?? {};
  const next: ConnectionCapabilities = { ...stored };

  const context = Number(contextText.trim());
  if (contextText.trim().length === 0 || Number.isNaN(context) || context <= 0) {
    delete next.maxContextTokens;
  } else {
    next.maxContextTokens = context;
  }

  if (reportsUsage === null) delete next.reportsUsage;
  else next.reportsUsage = reportsUsage;

  return { capabilities: next };
}
