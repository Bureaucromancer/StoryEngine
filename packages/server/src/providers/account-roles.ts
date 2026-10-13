// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import type { ModelRole } from '@storyengine/shared';

import type { Layout } from '../storage/layout.js';
import { readSystemBindings, userBindingsState } from './bindings.js';
import { type ConnectionResolution, resolveConnections } from './connections.js';
import { type RoleBindings, type RoleRow, roleTable } from './roles.js';

/**
 * ***Every role, resolved for one account, outside any session*** — what
 * `GET /me/roles` answers ([10 §15.1], [P7.3]), and since 2026-10-13 what a
 * World's `requires.capabilities` is checked against (`requires.ts`): the
 * import's warning, its preview, and `POST /api/sessions`' refusal.
 *
 * **One assembly, because three readers would otherwise spell it three
 * times** — the account's usable connections (its capability deciding whether
 * personal ones count, [09 §4.5]), its own bindings, and the install defaults
 * under them, resolved by `roleTable` in [20 §5.1]'s order. A copy in the
 * requirement check that read the bindings and forgot the install layer would
 * call `image` unbound for an account whose administrator bound it for
 * everybody, and the pane in Settings would say the opposite of the dialog in
 * front of it. So `/me/roles` reads its table from here too.
 *
 * ***A session's own overrides are not here, and need not be***: a session
 * being started has none yet (`session.roles` and `stepRoles` are written
 * after it exists), so the account and install layers are the whole answer at
 * the moment a requirement is checked.
 *
 * `bindings` and `contentHash` travel because `/me/roles` sends the raw file
 * beside the table for its editor to write against; the requirement check
 * reads `rows` alone.
 */
export async function accountRoleTable(
  layout: Layout,
  handle: string,
  capabilities: { privateConnections: boolean },
): Promise<{
  rows: RoleRow[];
  connections: ConnectionResolution;
  bindings: RoleBindings;
  contentHash: string;
}> {
  const connections = await resolveConnections(layout, handle, capabilities);
  const state = await userBindingsState(layout, handle);
  const rows = roleTable({
    bindings: state.bindings,
    defaults: await readSystemBindings(layout),
    usable: connections.usable,
  });
  return { rows, connections, bindings: state.bindings, contentHash: state.contentHash };
}

/**
 * ***The roles that resolve for this account*** — a role bound at either layer
 * to a connection the account may use. `dangling` is not resolving: a binding
 * whose connection is gone makes no call, which is what a requirement asks
 * about.
 */
export async function rolesThatResolve(
  layout: Layout,
  handle: string,
  capabilities: { privateConnections: boolean },
): Promise<ReadonlySet<ModelRole>> {
  const { rows } = await accountRoleTable(layout, handle, capabilities);
  return new Set(rows.filter((row) => row.resolution.ok).map((row) => row.role));
}
