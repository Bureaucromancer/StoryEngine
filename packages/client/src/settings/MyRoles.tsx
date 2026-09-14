// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { useState, type JSX } from 'react';

import { ApiError, type Binding, type MyRoles as MyRolesData, type RoleRow } from '../api.js';
import { useMyRoles, useWriteMyBindings } from '../queries.js';
import { Alert } from '../ui/Alert.js';
import { SelectField } from '../ui/Field.js';
import { roleLabel, roleModel, roleSource } from './roleWords.js';

/**
 * Which model does which job, for you — [10 §15.1](../../../../docs/design/10-ui-surfaces.md)'s
 * *role bindings* bullet, built at
 * [P7.3](../../../../docs/design/workplan/23-p7-implementation.md).
 *
 * **The layer it writes has resolved since P2B and had no writer.**
 * `users/<handle>/bindings.json` has had a reader since P2.5 and `resolveRole`
 * has layered it over the install defaults since P2B — so until this pane the
 * only way to use it was to hand-write JSON.
 * [R2 / F-01](../../../../docs/design/workplan/21-playable-log.md)'s *use a
 * second model* was routed to this phase for exactly that reason.
 *
 * **For every account, not only one with connections of its own.** A binding is
 * two ids, and re-pointing *Quick background jobs* at the cheaper model on the
 * install's own connection needs no key and no capability. That is
 * [20 §5.1](../../../../docs/design/20-tech-stack.md)'s *"anyone who wants their
 * own key overrides a role without the admin's involvement"* read at its word:
 * the admin decides what exists, the person playing decides which of it they
 * use.
 *
 * **It renders what the server resolved and works nothing out**, which is
 * `RoleTable`'s rule in the admin half and the reason `GET /api/me/roles`
 * returns a resolved table rather than two binding maps. A pane that decided
 * which layer won would be a second implementation of the resolution order,
 * wrong the first time one is added and wrong silently.
 *
 * **One control per role, offering connection-and-model pairs rather than two
 * dependent selects.** A binding *is* a pair; splitting it would invent an
 * intermediate state — a connection chosen with no model — that the record has
 * no way to hold and the server would refuse.
 */
export function MyRoles(): JSX.Element {
  const roles = useMyRoles();
  const write = useWriteMyBindings();
  /**
   * The 412's payload, held until it is dismissed.
   *
   * **A refusal is the one state this pane cannot re-read its way out of**: the
   * query would fetch the file's current contents and the person would see
   * their edit silently gone. So the disagreement is shown, with what is on
   * disk, and the next save is taken against the hash the server just gave.
   */
  const [collided, setCollided] = useState(false);

  if (roles.isPending) return <p className="text-sm text-ink-faint">Loading…</p>;
  if (roles.isError) return <p role="alert">Your model settings could not be read.</p>;

  const data = roles.data;

  function choose(role: string, value: string): void {
    const picked = parseChoice(value);
    /**
     * **Rebuilt rather than deleted from**, because *use the install's default*
     * is expressed by the key being absent and `delete` on a computed key is a
     * lint error here. Filtering says the same thing without the operator, and
     * more plainly: the document is every role this person has chosen for.
     */
    const next: Record<string, Binding> = Object.fromEntries(
      Object.entries(data.bindings).filter(([each]) => each !== role),
    );
    if (picked !== null) next[role] = picked;

    setCollided(false);
    write.mutate(
      { bindings: next, contentHash: data.contentHash },
      {
        onError: (error) => {
          // 412 only. Anything else is an ordinary failure and says so below,
          // because a stale-file notice about a network error would send
          // somebody looking for an edit nobody made.
          if (error instanceof ApiError && error.status === 412) setCollided(true);
        },
      },
    );
  }

  return (
    <section className="flex flex-col gap-6" aria-labelledby="my-roles">
      <h2 id="my-roles" className="text-section text-ink">
        Which models your stories use
      </h2>

      <p className="text-sm text-ink-subtle">
        Every job falls back to what this install has set. Choose one here and it applies to your
        stories only.
      </p>

      {collided ? (
        <Alert tone="warning" role="status">
          Your settings changed somewhere else while this page was open — another tab, or the file
          on disk. Nothing was overwritten. Reload the page to see what is there now.
        </Alert>
      ) : null}

      {write.isError && !collided ? (
        <Alert tone="error" role="alert">
          That could not be saved.
        </Alert>
      ) : null}

      {data.disabled.length > 0 ? (
        /**
         * [09 §4.5] wants somebody *told* rather than left wondering why a model
         * call started failing — and until this pane there was nowhere for the
         * server's `disabled` list to be told to anyone.
         */
        <Alert tone="warning" role="status">
          You have connections of your own that this install is not letting you use, so they are not
          offered below.
        </Alert>
      ) : null}

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
                Your choice
              </th>
            </tr>
          </thead>
          <tbody>
            {data.roles.map((row) => (
              <tr key={row.role} className="border-t border-line align-top">
                <th scope="row" className="py-2 pe-4 font-normal">
                  {roleLabel(row.role)}
                </th>
                <td className="py-2 pe-4">{roleModel(row)}</td>
                <td className={row.ok ? 'py-2 pe-4 text-ink-faint' : 'py-2 pe-4 text-warn-ink'}>
                  {roleSource(row)}
                </td>
                <td className="py-2">
                  <SelectField
                    /**
                     * **The role's own words, hidden from sight.** A screen
                     * reader hears which row this control belongs to rather
                     * than eight identically-named selects; the column header
                     * and the row header are the visible naming, and drawing
                     * the label as well would print the row header twice.
                     */
                    label={roleLabel(row.role)}
                    hideLabel
                    value={choiceOf(data.bindings[row.role])}
                    options={choicesFor(data, row)}
                    onChange={(value) => {
                      choose(row.role, value);
                    }}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

/**
 * A binding as one option value, and back.
 *
 * **The separator is a newline**, which is the one character a connection id
 * and a model id cannot contain: ids are uuids and model names come from a
 * provider's own list, and a colon or a slash appears in plenty of the latter
 * (`org/model:tag`). A separator that could occur in a value would silently
 * split a binding in half.
 */
const NONE = '';

function choiceOf(binding: Binding | undefined): string {
  return binding === undefined ? NONE : `${binding.connectionId}\n${binding.modelId}`;
}

function parseChoice(value: string): Binding | null {
  const at = value.indexOf('\n');
  if (at < 0) return null;
  return { connectionId: value.slice(0, at), modelId: value.slice(at + 1) };
}

/**
 * Every pair this account may bind, plus *leave it to the install*.
 *
 * **A binding this build cannot offer is still listed if it is the one set**,
 * which is the case that would otherwise silently rewrite somebody's file: a
 * select whose value is absent from its options renders as the first option, so
 * the next change to *any other row* would save a document with this one
 * quietly cleared. It is listed as what it is — a connection that is gone —
 * rather than as a working choice, which is also the only way somebody can see
 * why the row above says the connection was removed.
 */
function choicesFor(data: MyRolesData, row: RoleRow): readonly (readonly [string, string])[] {
  const options: [string, string][] = [[NONE, 'Use this install’s default']];

  for (const connection of data.connections) {
    for (const model of connection.models) {
      options.push([`${connection.id}\n${model}`, `${model} — ${connection.label}`]);
    }
  }

  const held = data.bindings[row.role];
  if (held !== undefined && !options.some(([value]) => value === choiceOf(held))) {
    options.push([choiceOf(held), `${held.modelId} — on a connection that is gone`]);
  }

  return options;
}
