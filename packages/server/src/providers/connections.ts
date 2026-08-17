// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import type { Layout } from '../storage/layout.js';
import { listEntryNames, readFileBytes } from '../storage/files.js';
import { resolveWithin } from '../storage/paths.js';
import type { ProviderCapabilities } from './types.js';

/**
 * Connections — [04 §4.5](../../../../docs/design/04-server-multiuser-deployment.md).
 *
 * **They follow exactly the library model**, with one deliberate asymmetry.
 * They live in two scopes and resolve as one merged list, the same shape the
 * library uses; and unlike a library object they are **usable but opaque**.
 *
 * ```
 * /data/system/connections/           admin-managed. Usable by everyone.
 * /data/users/<handle>/connections/   the user's own.
 * ```
 *
 * The asymmetry is the whole point of this file. A system actor can be opened,
 * read and forked; a system connection cannot, because everything interesting
 * about it is a credential. So:
 *
 * - **The key never leaves the server.** {@link presentConnection} is the only
 *   shape that goes to a client, and it has nowhere to put one.
 * - **Nor does the endpoint URL**, which can itself carry a token or reveal a
 *   private host. An admin may opt to show it; that is a decision at P10's
 *   admin surface, and the default is not to.
 * - **There is no fork.** Copy-to-my-library has no analogue here, because
 *   copying would mean copying the credential.
 */

/** What a connection file holds. Private production config, never portable. */
export interface Connection {
  id: string;
  /** What the user calls it. The half that is safe to show. */
  label: string;
  /** The adapter kind — `openai-compatible`, `anthropic`, `fake`. */
  provider: string;
  /** Whose it is. Not stored in the file: derived from where the file lives. */
  scope: 'system' | 'user';
  /** Never sent anywhere. Absent for a local endpoint that needs none. */
  apiKey?: string;
  /** Never sent anywhere either — it can carry a token or name a private host. */
  baseUrl?: string;
  /** Which models this endpoint offers. Safe to show: it is what a binding picks. */
  models: string[];
  /**
   * Per-connection capability overrides, because a limit is a property of *this
   * endpoint* ([07 §5.3](../../../../docs/design/07-tech-stack.md)).
   */
  capabilities?: Partial<ProviderCapabilities>;
}

/**
 * A connection as anyone outside the server may see it: a label, a provider
 * type, and which models it offers.
 *
 * The type is a `Pick` on purpose rather than a hand-written interface — a
 * field added to `Connection` cannot appear here by being forgotten about.
 */
export type PublicConnection = Pick<Connection, 'id' | 'label' | 'provider' | 'scope' | 'models'>;

export function presentConnection(connection: Connection): PublicConnection {
  return {
    id: connection.id,
    label: connection.label,
    provider: connection.provider,
    scope: connection.scope,
    models: connection.models,
  };
}

export interface ConnectionResolution {
  /** Everything this account may use, personal first, then system. */
  usable: Connection[];
  /**
   * Personal connections that exist on disk and were ignored, because the
   * account does not have `privateConnections`.
   *
   * Returned rather than silently dropped: the user is *told* rather than left
   * wondering why a model call started failing ([04 §4.5]).
   */
  disabled: Connection[];
}

/**
 * Every connection an account may use.
 *
 * **The capability is enforced here, not at creation**, and that is the
 * load-bearing detail. A user with write file access can drop a connection file
 * straight into their own directory ([05 §4](../../../../docs/design/05-ui-surfaces.md)),
 * so a check in a route or a UI is a trivial bypass — the loader has to be the
 * thing that refuses. It also means extensions are covered for free, since they
 * request calls by role and the host resolves.
 *
 * **Revoking disables, never deletes.** A revoked account's files stay on disk
 * and stop resolving, which is why they come back as `disabled` rather than
 * being skipped.
 */
export async function resolveConnections(
  layout: Layout,
  handle: string,
  capabilities: { privateConnections: boolean },
): Promise<ConnectionResolution> {
  const personal = await readConnectionsIn(layout, layout.userConnectionsRoot(handle), 'user');
  const system = await readConnectionsIn(layout, layout.systemConnectionsRoot, 'system');

  if (!capabilities.privateConnections) {
    return { usable: system, disabled: personal };
  }
  // Personal first: a personal binding wins over a system default, visibly and
  // switchably.
  return { usable: [...personal, ...system], disabled: [] };
}

async function readConnectionsIn(
  layout: Layout,
  root: string,
  scope: Connection['scope'],
): Promise<Connection[]> {
  const names = await listEntryNames(root);
  const connections: Connection[] = [];

  for (const name of names) {
    if (!name.endsWith('.json')) continue;

    const path = resolveWithin(root, name);
    // The same door every other read goes through (F1): a connections
    // directory is as hand-editable as a library one, and a link out of it
    // would be a way to read a file the server would not otherwise open.
    await layout.assertReal(path);

    const bytes = await readFileBytes(path);
    if (bytes === null) continue;

    const parsed = parseConnection(bytes, scope);
    // A malformed connection file is skipped rather than fatal. The failure a
    // person will actually have is a typo in one file, and taking down every
    // other connection because of it is the wrong answer — P2.3's invalid-file
    // state (F20) is where this becomes visible rather than merely survivable.
    if (parsed !== null) connections.push(parsed);
  }

  return connections.sort((a, b) => a.label.localeCompare(b.label));
}

function parseConnection(bytes: Uint8Array, scope: Connection['scope']): Connection | null {
  let value: unknown;
  try {
    value = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return null;
  }
  if (typeof value !== 'object' || value === null) return null;

  const record = value as Record<string, unknown>;
  const id = record['id'];
  const provider = record['provider'];
  if (typeof id !== 'string' || typeof provider !== 'string') return null;

  const models = Array.isArray(record['models'])
    ? record['models'].filter((model): model is string => typeof model === 'string')
    : [];

  return {
    id,
    label: typeof record['label'] === 'string' ? record['label'] : id,
    provider,
    scope,
    models,
    ...(typeof record['apiKey'] === 'string' ? { apiKey: record['apiKey'] } : {}),
    ...(typeof record['baseUrl'] === 'string' ? { baseUrl: record['baseUrl'] } : {}),
    // Taken as written rather than validated field by field. A capability
    // override is the operator saying something about their own endpoint, and
    // the shape is checked where it is used — `capabilitiesFor` spreads it over
    // a complete baseline, so an unknown key is inert rather than dangerous.
    ...(typeof record['capabilities'] === 'object' && record['capabilities'] !== null
      ? { capabilities: record['capabilities'] }
      : {}),
  };
}
