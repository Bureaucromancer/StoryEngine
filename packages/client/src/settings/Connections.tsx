// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { useState, type JSX, type ReactNode } from 'react';

import {
  ApiError,
  type AdminConnection,
  type Binding,
  type ConnectionCapabilities,
} from '../api.js';
import { roleLabel, roleModel, roleSource } from './roleWords.js';
import { CheckboxField, Field, SelectField } from '../ui/Field.js';
import { SecretField } from '../ui/SecretField.js';
import {
  useBindings,
  useConnectionBindings,
  useConnections,
  useDeleteConnection,
  useFetchModels,
  useRoles,
  useSaveConnection,
  useWriteBindings,
  useWriteDefaultBindings,
  type ConnectionScope,
} from '../queries.js';
import { Alert } from '../ui/Alert.js';
import { Button } from '../ui/Button.js';
import { control, panel } from '../ui/classes.js';
import { Dialog } from '../ui/Dialog.js';

/**
 * System connections and the install's role bindings —
 * [10 §15.3](../../../../docs/design/10-ui-surfaces.md),
 * [P2B §3](../../../../docs/design/workplan/10-p2b-provider-configuration.md) stages P2B.3
 * and P2B.4.
 *
 * **This is the section that makes the phase's demo possible:** *fresh install →
 * admin → one key → a turn*, with no text editor at any point. Every gate step
 * that could not be walked before this file existed is walked through it.
 *
 * ## The scope line, once
 *
 * ~~**The system scope and only the system scope** ([P2B §2.7]). A user's own
 * `connections/` and `bindings.json` are read by the resolver, counted by the
 * delete warning, hand-written by anyone who wants one, and reachable from
 * nothing here. [10 §15.1]'s *your connections* bullet waits for the phase that
 * builds the user half~~ — **the user half arrived at [P10.3]**, 2026-09-16, and
 * this file was renamed from `AdminConnections.tsx` to say so. The role table
 * below is unchanged; its personal counterpart is `MyRoles`, which arrived
 * separately at [P7.3] and is a second table rather than a second column.
 *
 * ***Two panels over one form, which is the server's own arrangement***
 * (`routes/connections.ts` grew a second registrar in the same file on the same
 * day, for the same reason). What the two scopes share is a **record shape, a
 * stale check and an error vocabulary**, so the failure worth designing against
 * was never a second copy of the form — it was one surface quietly reading the
 * other's directory. {@link ConnectionsPanel} takes the scope as a parameter, so
 * it appears at every call site and in every cache key.
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
  const bindings = useBindings();
  /**
   * **Nothing bound yet** is the state P2B.4's offer exists for, and it is a
   * property of the bindings file rather than of the connection just saved —
   * so a second connection on an install that already has defaults does not
   * re-ask, and a first connection on an install whose `bindings.json` was
   * hand-written does not either.
   */
  const unbound = bindings.data !== undefined && Object.keys(bindings.data.bindings).length === 0;

  return (
    <ConnectionsPanel
      scope="system"
      headingId="connections"
      heading="Connections"
      blurb="Shared by everybody on this install. Keys stay on the server and are never sent back to a browser."
      empty="There are no connections yet, so nobody can send a message."
      offerDefaults={unbound}
    >
      <RoleTable />
    </ConnectionsPanel>
  );
}

/**
 * ***Your* connections** — [10 §15.1](../../../../docs/design/10-ui-surfaces.md),
 * [19 §5.1](../../../../docs/design/19-tech-stack.md), [P10.3].
 *
 * [19 §5.1]'s sentence is the whole of it: *"anyone who wants their own key
 * overrides a role without the admin's involvement"*. The reader for this
 * directory has existed since P2A and the writer did not, deliberately — a
 * personal surface predating the `privateConnections` check would have been
 * [09 §4.5]'s *"trivial bypass, wearing a UI"*.
 *
 * **No first-run offer and no role table.** The offer is about an install with
 * nothing bound, which is an admin's problem; the personal role table is
 * `MyRoles`, above on the same page, and duplicating it under a second heading
 * would ask somebody to reconcile two renderings of one resolution.
 */
export function MyConnections(): JSX.Element {
  return (
    <ConnectionsPanel
      scope="mine"
      headingId="my-connections"
      heading="Your connections"
      blurb="Only yours, and used ahead of the install's when a role can resolve to one. The key stays on the server and is never sent back to a browser."
      empty="You have none, so your turns use whatever the install provides."
      offerDefaults={false}
    />
  );
}

/**
 * The list, the form and the remove dialog — one component, two directories.
 *
 * ***The scope reaches the server as a different address and reaches this
 * component as a prop***, and nothing between them decides anything: the rows
 * come from whichever list the scope names, and `shadowed` is computed by the
 * server from the array it presented. A panel that worked out precedence itself
 * would be a second implementation of `resolveConnections`' order.
 */
function ConnectionsPanel({
  scope,
  headingId,
  heading,
  blurb,
  empty,
  offerDefaults,
  children,
}: {
  scope: ConnectionScope;
  headingId: string;
  heading: string;
  blurb: string;
  empty: string;
  offerDefaults: boolean;
  children?: ReactNode;
}): JSX.Element {
  const connections = useConnections(scope);
  const [editing, setEditing] = useState<AdminConnection | 'new' | null>(null);
  const [confirming, setConfirming] = useState<AdminConnection | null>(null);

  if (connections.isPending) return <p className="text-sm text-ink-faint">Loading…</p>;
  if (connections.isError) return <p role="alert">The connections could not be read.</p>;

  const rows = connections.data.connections;

  return (
    <section className="flex flex-col gap-6" aria-labelledby={headingId}>
      <div>
        <h3 id={headingId} className="text-subsection text-ink">
          {heading}
        </h3>
        <p className="mt-1 text-xs text-ink-faint">{blurb}</p>
      </div>

      {rows.length === 0 ? (
        <p className="text-sm text-ink-subtle">{empty}</p>
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
          scope={scope}
          connection={editing === 'new' ? null : editing}
          offerDefaults={offerDefaults}
          onDone={() => {
            setEditing(null);
          }}
        />
      )}

      {confirming === null ? null : (
        <RemoveConnectionDialog
          scope={scope}
          connection={confirming}
          onDone={() => {
            setConfirming(null);
          }}
        />
      )}

      {children}
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
  scope,
  connection,
  offerDefaults,
  onDone,
}: {
  scope: ConnectionScope;
  connection: AdminConnection | null;
  offerDefaults: boolean;
  onDone: () => void;
}): JSX.Element {
  const save = useSaveConnection(scope);
  const models = useFetchModels(scope);
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
  /** The field is the value; the checkboxes read from it so the two cannot drift. */
  const chosen = modelsFrom(modelText);

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
             *
             * **But a refused key gets its own sentence** — finding 5. The two
             * remedies point in opposite directions: *unreachable* sends an
             * admin to the URL and the network, and the one case where that is
             * exactly wrong is the endpoint answering perfectly well that the
             * key is bad.
             *
             * ***And a third, since [P11.6]: no internet at all.*** [09 §6.5]
             * asks for that sentence by name, and the reason it is worth a third
             * arm rather than being folded into *unreachable* is the same
             * argument finding 5 made about the first two — it sends somebody
             * somewhere else entirely. The server only says `offline` when the
             * endpoint is remote **and** a check has actually established that
             * this machine has no route out, so a deliberately local install
             * never sees it.
             */
            <p role="status" className="text-sm text-ink-subtle">
              {modelsErrorLine(models.error)}
            </p>
          ) : null}
        </div>
        {/**
         * **What the endpoint offers, as a list you provision from** — the half
         * of [R2](../../../../docs/design/workplan/22-walkthrough-refinements.md)
         * that is about setting one up rather than about using it.
         *
         * These used to be buttons that appended a name into the text field, one
         * at a time, which made *this endpoint serves nine models and I want
         * seven of them* nine decisions and a proofread. A checkbox per model
         * with an all-or-none pair beside it is the same information as a
         * question the admin can answer in one gesture.
         *
         * **The text field stays the value, and this writes into it** ([P2B §2.6]
         * keeps it free text: `/models` is optional in practice, and several
         * local runtimes answer it with one entry called `gpt-3.5-turbo`
         * regardless of what is loaded). So a model this list does not know can
         * still be typed, and unchecking one the admin typed by hand removes it
         * rather than being unable to see it.
         */}
        {offered.length === 0 ? null : (
          <div className="flex flex-col gap-2">
            <p className="text-xs text-ink-faint">{offeredCount(offered.length)}</p>
            <ul className="flex flex-col gap-1">
              {offered.map((model) => (
                <li key={model}>
                  <CheckboxField
                    label={model}
                    checked={chosen.includes(model)}
                    onChange={(on) => {
                      setModelText((text) => withModel(text, model, on));
                    }}
                  />
                </li>
              ))}
            </ul>
            <div className="flex gap-2">
              <Button
                type="button"
                size="compact"
                onClick={() => {
                  setModelText(toModelText(offered));
                }}
              >
                Use all of them
              </Button>
              <Button
                type="button"
                size="compact"
                onClick={() => {
                  setModelText('');
                }}
              >
                Use none of them
              </Button>
            </div>
          </div>
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

      {/*
       * The action row is held against the bottom of the scrollport, inside
       * this card — `panel.actions` is the editors' strip with the card's
       * padding in place of the column's ([10 §11.6]). **The conflict lives
       * inside the strip**, as a full-width line above the buttons, and that
       * is a consequence rather than a flourish: with the strip pinned, the
       * foot of the form is below the fold, and a refusal rendered there would
       * arrive out of sight of the Save that provoked it — the silent 412 this
       * file already fixed once, reintroduced by layout.
       */}
      <div className={panel.actions}>
        {conflict === null ? null : (
          <Alert tone="warning" role="alert" className="basis-full">
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
 * [19 §5.1](../../../../docs/design/19-tech-stack.md)'s *a good one and a cheap one*.
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
      <div className={panel.actions}>
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
 * **Counts, never contents** ([09 §4.5]). A list of who binds what to which key
 * is a different feature with a different justification and nobody has asked
 * for it.
 */
function RemoveConnectionDialog({
  scope,
  connection,
  onDone,
}: {
  scope: ConnectionScope;
  connection: AdminConnection;
  onDone: () => void;
}): JSX.Element {
  /**
   * ***The binding count is the system scope's alone*** — [P10.3].
   *
   * [P2B §2.8]'s warning exists because an admin deleting a shared connection
   * breaks **other people's** turns, and *counts, never contents* is how it says
   * so without listing who. Deleting your own breaks your own, and telling
   * somebody that a thing they are about to delete is used by them is not
   * information. There is no personal route for it either, which is the same
   * decision written on the server.
   */
  const count = useConnectionBindings(connection.id, scope === 'system');
  const remove = useDeleteConnection(scope);
  return (
    <Dialog role="alertdialog" labelledBy="remove-connection" onDismiss={onDone} size="wide">
      <h4 id="remove-connection" className="text-subsection text-ink">
        {removeTitle(connection.label)}
      </h4>
      {scope === 'system' ? (
        <p className="text-sm text-ink-muted">
          {count.data === undefined ? bindingCountUnknown() : bindingCount(count.data.bindings)}
        </p>
      ) : null}
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
 * [19 §5.1]'s layering lives in `resolveRole`, and a table that inspected the
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
 * ~~**And one column is deliberately absent.**~~ **The user half arrived and it
 * is a second table, not a second column** — [P7.3], 2026-09-12. [10 §15.1]
 * wants a user to see which of their bindings are personal and which fall
 * through to the install; `MyRoles` is that, keyed under `me` so it mounts for
 * a non-admin, and this component stayed exactly as it was. *The old note said
 * nothing here would be discarded when the second column arrived, and nothing
 * was — what it got wrong is that the two questions are asked by different
 * people: **what has this install got** is the admin's, and **what will my
 * stories do** is everyone's. One table answering both would have had to be
 * rendered for a non-admin and then hide half of itself.* The **vocabulary** is
 * what the two share, and it moved to `roleWords.ts` so they cannot describe
 * the same resolution differently — including the *"Your own setting"* branch
 * this table could never reach, which was written for that phase and now has a
 * caller.
 *
 * ## The table stopped being read-only, 2026-09-11
 *
 * **It told an admin to do something no control could do.** The dangling row
 * says *"Set it to another one"*, and until now the only binding writer in the
 * whole client was the first-run offer — which
 * {@link AdminConnections} hides for good the moment anything is bound. So
 * *use a second model* meant hand-editing `system/bindings.json`, and that is
 * [F-01](../../../../docs/design/workplan/21-playable-log.md) as a person actually
 * met it.
 *
 * **Nothing was missing on the server.** `PUT /api/admin/bindings` has existed
 * since P2B.2 with its hash guard, and its own docstring says it is *"for the
 * admin who is editing rather than starting"*; `useWriteBindings` has existed
 * beside it with no caller at all. [P2B §5]'s line — no control for a layer with
 * no caller — does not reach this one, because the install-default layer is
 * precisely the layer that has a caller.
 *
 * **One entry per endpoint-and-model pair, as a single thing.** Not a connection
 * picker and then a model picker: that is the data model's shape
 * ({@link Binding} is a connection *and* a model) pushed onto somebody who is
 * choosing *which model writes the story*. The pair is the unit of choice, so it
 * is the unit in the list. See
 * [refinements §7.3](../../../../docs/design/workplan/22-walkthrough-refinements.md).
 */
function RoleTable(): JSX.Element {
  const roles = useRoles();
  const connections = useConnections();
  const bindings = useBindings();
  const write = useWriteBindings();
  const [conflict, setConflict] = useState<BindingConflict | null>(null);

  if (roles.isPending) return <p className="text-sm text-ink-faint">Loading…</p>;
  if (roles.isError) return <p role="alert">The role table could not be read.</p>;

  const choices = modelChoices(connections.data?.connections ?? []);
  const current = bindings.data?.bindings ?? {};
  /** Nothing can be written until the document this edits has been read. */
  const ready = bindings.data !== undefined;

  /**
   * **The whole document, every time** — which is the server's shape and not a
   * convenience: `PUT /bindings` rewrites the file, so a write carrying one role
   * would delete the other seven. `image`, `video` and `speech` are usually
   * absent by policy and would be the silent casualties.
   */
  function send(base: Record<string, Binding>, role: string, next: Binding | null, hash: string) {
    /**
     * **Unbinding is the absence of an entry, not an empty one** — which is the
     * shape the server already reads: *a role with no entry is unbound, not
     * defaulted*. Rebuilt by filtering rather than by deleting the key, because
     * a dynamic `delete` is refused here and the filter says the same thing more
     * plainly anyway.
     */
    const document: Record<string, Binding> =
      next === null
        ? Object.fromEntries(Object.entries(base).filter(([bound]) => bound !== role))
        : { ...base, [role]: next };
    write.mutate(
      { bindings: document, contentHash: hash },
      {
        onSuccess: () => {
          setConflict(null);
        },
        onError: (error) => {
          const stale = staleBindings(error);
          if (stale !== null) setConflict({ ...stale, role, next });
        },
      },
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <h4 id="roles" className="text-subsection text-ink">
        What each job uses
      </h4>

      {conflict === null ? null : (
        <Alert tone="warning" role="alert">
          <p>The model bindings changed on disk since this page read them.</p>
          {/**
           * **Applying rather than overwriting, and the wording says so.** The
           * connection form's *overwrite with mine* is right there, because the
           * unit of edit is the whole connection. Here the unit is one role, so
           * re-sending this page's whole document would revert somebody else's
           * change to a role this admin never touched. Re-applying the one
           * change onto what is on disk is both safer and what the gesture
           * meant.
           */}
          <div className="mt-2 flex gap-2">
            <Button
              type="button"
              size="compact"
              onClick={() => {
                setConflict(null);
                void bindings.refetch();
              }}
            >
              Load what is on disk
            </Button>
            <Button
              type="button"
              size="compact"
              onClick={() => {
                send(conflict.current, conflict.role, conflict.next, conflict.contentHash);
              }}
            >
              Apply my change to what is on disk
            </Button>
          </div>
        </Alert>
      )}

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
              <th scope="col" className="py-1 pe-4 font-medium">
                Where it comes from
              </th>
              <th scope="col" className="py-1 font-medium">
                Change it
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
                <td className={row.ok ? 'py-2 pe-4 text-ink-faint' : 'py-2 pe-4 text-warn-ink'}>
                  {roleSource(row)}
                </td>
                <td className="py-2">
                  <select
                    className={control}
                    aria-label={roleChoiceLabel(row.role)}
                    disabled={!ready || write.isPending}
                    value={chosenValue(choices, current[row.role])}
                    onChange={(event) => {
                      const hash = bindings.data?.contentHash;
                      if (hash === undefined) return;
                      const picked = choices[Number(event.target.value)];
                      send(current, row.role, picked === undefined ? null : picked.binding, hash);
                    }}
                  >
                    {roleOptions(choices, current[row.role]).map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </select>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {write.isError && conflict === null ? (
        <p role="alert" className="text-sm text-danger-ink">
          {write.error.message}
        </p>
      ) : null}
    </div>
  );
}

/** A 412 on the bindings document, with the pending change that provoked it. */
interface BindingConflict {
  contentHash: string;
  current: Record<string, Binding>;
  role: string;
  next: Binding | null;
}

/** One endpoint-and-model pair, which is the unit an admin actually picks. */
interface ModelChoice {
  binding: Binding;
  label: string;
}

/**
 * Every pair on the install, in the order the connections list is already in.
 *
 * A connection offering no models contributes nothing rather than an entry that
 * cannot be bound — which is the same posture {@link FirstRunDefaults} takes
 * when it refuses to ask a question about a connection with an empty list.
 */
function modelChoices(connections: readonly AdminConnection[]): ModelChoice[] {
  return connections.flatMap((connection) =>
    connection.models.map((modelId) => ({
      binding: { connectionId: connection.id, modelId },
      label: pairLabel(connection.label, modelId),
    })),
  );
}

/**
 * The options for one role: nothing, every pair, and — only when it applies —
 * what this role is bound to today.
 *
 * **That last one is why this is not a plain map.** A binding can name a model
 * no connection offers any more: the admin removed it from the list, or the file
 * was written by hand. With no option to match it a `<select>` silently displays
 * its first entry, so the control would claim the role is bound to whatever
 * happens to sort first — the table would be lying in the one row that most
 * needs telling the truth.
 */
function roleOptions(
  choices: readonly ModelChoice[],
  binding: Binding | undefined,
): [string, string][] {
  const options: [string, string][] = [['unbound', 'Nothing']];
  choices.forEach((choice, index) => {
    options.push([String(index), choice.label]);
  });
  if (binding !== undefined && indexOfBinding(choices, binding) === -1) {
    options.push(['missing', missingPairLabel(binding.modelId)]);
  }
  return options;
}

function chosenValue(choices: readonly ModelChoice[], binding: Binding | undefined): string {
  if (binding === undefined) return 'unbound';
  const index = indexOfBinding(choices, binding);
  return index === -1 ? 'missing' : String(index);
}

function indexOfBinding(choices: readonly ModelChoice[], binding: Binding): number {
  return choices.findIndex(
    (choice) =>
      choice.binding.connectionId === binding.connectionId &&
      choice.binding.modelId === binding.modelId,
  );
}

/**
 * The user-facing sentences of this screen, each whole.
 *
 * [work plan §2](../../../../docs/design/workplan/01-work-plan.md) keeps this part of i18n discipline
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

/** The bindings 412's payload, if this error is one. */
function staleBindings(
  error: unknown,
): { contentHash: string; current: Record<string, Binding> } | null {
  if ((error as { status?: number }).status !== 412) return null;
  /**
   * **The hash is required, and its absence is not recoverable here.** Without
   * one there is nothing to present on a retry, so the only honest move is to
   * fall through to the plain error line rather than offer a button that would
   * re-send the hash that was just refused. The server carries it as of
   * 2026-09-11; this is what notices if that ever stops being true.
   */
  const hash = (error as { contentHash?: unknown }).contentHash;
  if (typeof hash !== 'string') return null;
  const carried = (error as { current?: unknown }).current;
  return {
    contentHash: hash,
    current:
      typeof carried === 'object' && carried !== null ? (carried as Record<string, Binding>) : {},
  };
}

/** The models named in the field, which is the value the checkboxes read. */
function modelsFrom(text: string): string[] {
  return text
    .split(',')
    .map((model) => model.trim())
    .filter((model) => model.length > 0);
}

function toModelText(models: readonly string[]): string {
  return models.join(', ');
}

/** Adds or removes one model, keeping the order the field is already in. */
function withModel(text: string, model: string, on: boolean): string {
  const models = modelsFrom(text);
  if (on) return models.includes(model) ? text : toModelText([...models, model]);
  return toModelText(models.filter((each) => each !== model));
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

function offeredCount(count: number): string {
  return count === 1
    ? 'This endpoint offers 1 model. Tick the ones this install should use.'
    : `This endpoint offers ${String(count)} models. Tick the ones this install should use.`;
}

/** An endpoint and a model, as the one thing a person is choosing. */
function pairLabel(connectionLabel: string, modelId: string): string {
  return `${connectionLabel} · ${modelId}`;
}

/** What a role is bound to when no connection offers it any more. */
function missingPairLabel(modelId: string): string {
  return `${modelId} — no connection offers this any more`;
}

/** The accessible name of one row's picker, since the visible label is the row. */
function roleChoiceLabel(role: string): string {
  return `Model for ${roleLabel(role)}`;
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

/**
 * What a failed `/models` probe says — [P2B §2.6], finding 5 in
 * [P2C log](../../../../docs/design/workplan/14-p2c-log.md), [P11.6].
 *
 * Three codes, three different places to go next, which is the whole reason the
 * server distinguishes them: the key, the address, and the machine's own
 * network. **A code this build does not know falls through to the address**,
 * which is the widest of the three and the one that costs least when it is
 * wrong.
 */
function modelsErrorLine(error: unknown): string {
  const code = error instanceof ApiError ? error.code : null;
  if (code === 'unauthorized') return 'That endpoint refused the key. Check it — the URL is fine.';
  if (code === 'offline') {
    return 'This server appears to have no internet access, so it could not reach that endpoint. A model running on this network would still work.';
  }
  return 'That endpoint did not answer with a model list. Type the model name instead.';
}
