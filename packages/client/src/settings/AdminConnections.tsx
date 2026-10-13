// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { useState, type JSX } from 'react';

import type { AdminConnection, Binding } from '../api.js';
import {
  useBindings,
  useConnections,
  useMyRoles,
  useRoles,
  useWriteBindings,
  useWriteDefaultBindings,
} from '../queries.js';
import { Alert } from '../ui/Alert.js';
import { Button } from '../ui/Button.js';
import { control, panel } from '../ui/classes.js';
import { SelectField } from '../ui/Field.js';
import { Note } from '../ui/Text.js';
import { ConnectionsPanel, type AfterSave } from './Connections.js';
import { roleLabel, roleModel, roleSource } from './roleWords.js';

/**
 * ***The install's connections, its role table and the first-run question*** —
 * [10 §15.3](../../../../docs/design/10-ui-surfaces.md),
 * [P2B §3](../../../../docs/design/workplan/10-p2b-provider-configuration.md)
 * stages P2B.3 and P2B.4; a file of its own again since 2026-10-13,
 * [21 §7.5](../../../../docs/design/21-client-loading.md).
 *
 * **The name is the one [Connections.tsx](./Connections.tsx) had until P10.3**,
 * when the user half arrived and that file was renamed to say it held both.
 * It still holds both scopes' panel, form, test and remove dialog, and this
 * file holds what only the install's panel calls. The cut is a loading
 * boundary rather than a design one: the administration half of Settings is a
 * chunk of its own (`Administration.tsx`), fetched only for an administrator,
 * and `Connections.tsx` cannot go with it, because `MyConnections` is drawn
 * for anybody with `privateConnections` and so keeps that file on the entry
 * — and a module the entry reads brings its whole file with it ([21 §7.4]).
 * Everything here was moved, not rewritten, with its docstrings; what changed
 * is that the first-run question reaches the shared form through a slot
 * ({@link AfterSave}) instead of being drawn by it.
 *
 * *Imported from the administration chunk and nowhere on the entry*, which
 * `tools/entry-budget.test.ts` checks by a sentence of the role table's: a
 * static import of this file from anything the entry reaches would put it
 * back on every first load while an `Administration` chunk went on existing.
 */

/** The first-run question, in the slot the shared form leaves for it. */
const askFirstRun: AfterSave = (saved, done) => (
  <FirstRunDefaults connection={saved} onDone={done} />
);

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
  /**
   * ***Which of the install's connections this administrator's own files
   * hide*** — [polish §26], 2026-10-04.
   *
   * **Read from `/api/me/roles`, not from the admin list**, because it is a
   * fact about this person's turns rather than about the install — and the
   * admin routes answer *what has the install got* and nothing narrower
   * ([P2B §2.7]'s line, which `GET /api/admin/roles` keeps too). The query is
   * the one `MyRoles` already holds on this page, so it costs no request; it
   * needs no capability, so it cannot be refused; and the server has already
   * said which install connection is hidden (`shadowedBy`), so this decides no
   * precedence of its own — it only finds the row by the id the two share.
   * While it loads, or if it fails, no row says anything, which is the old
   * behaviour rather than a wrong one.
   */
  const mine = useMyRoles();
  const hiddenForYou = new Map(
    (mine.data?.connections ?? []).flatMap((connection) =>
      connection.scope === 'system' && connection.shadowedBy !== undefined
        ? [[connection.id, connection.shadowedBy.label] as const]
        : [],
    ),
  );

  return (
    <ConnectionsPanel
      scope="system"
      headingId="connections"
      heading="Connections"
      blurb="Shared by everybody on this install. Keys stay on the server and are never sent back to a browser."
      empty="There are no connections yet, so nobody can send a message."
      offer={unbound ? askFirstRun : undefined}
      hiddenForYou={hiddenForYou}
    >
      <RoleTable />
    </ConnectionsPanel>
  );
}

/**
 * The first run's one question — [P2B §3] stage P2B.4, and
 * [20 §5.1](../../../../docs/design/20-tech-stack.md)'s *a good one and a cheap one*.
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
 * **What every role will do, in one table** — [P2B §3]'s *the part worth
 * getting right*, and the thing that turns *"why did this turn use that
 * model"* from a support question into a glance.
 *
 * **It renders what the server resolved; it does not work anything out.**
 * [20 §5.1]'s layering lives in `resolveRole`, and a table that inspected the
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

  if (roles.isPending) return <Note>Loading…</Note>;
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

/**
 * The role table's sentences, each whole — `Connections.tsx`'s rule, above its
 * own: a sentence assembled from fragments around a value cannot be
 * translated, and a helper returning half a phrase is the same mistake with an
 * indirection.
 */
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
