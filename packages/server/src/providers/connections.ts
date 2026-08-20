// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import type { Layout } from '../storage/layout.js';
import { uuidv7 } from '@storyengine/shared';

import { writeJsonAtomic } from '../storage/atomic.js';
import { listEntryNames, readFileBytes, unlinkFile } from '../storage/files.js';
import { resolveWithin } from '../storage/paths.js';
import { canBuild } from './factory.js';
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

/**
 * The install's own connections, without reference to any account.
 *
 * `resolveConnections` answers *what may this person use*, which is the question
 * a turn asks and needs a handle for. The admin surface asks a different one —
 * *what has the install got* — and routing that through a handle would mean
 * inventing one, or asking about an administrator's personal connections while
 * pretending to ask about the system's.
 */
export async function readSystemConnections(layout: Layout): Promise<Connection[]> {
  return readConnectionsIn(layout, layout.systemConnectionsRoot, 'system');
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

/**
 * A connection as an **admin** editing one may see it — [P2B §2.2](../../../../docs/design/workplan/14-p2b-provider-configuration.md).
 *
 * `presentConnection` stays the only shape a non-admin ever sees, and it has
 * nowhere to put a `baseUrl`. That is exactly right for a user and useless for
 * the person setting one up: type a URL, save, reopen, and the field is empty —
 * a write-only form. So there are two shapes, and **the boundary between them is
 * the key alone**.
 *
 * Built by picking rather than by spreading-and-deleting, for the reason
 * `toPublic()` gives: a field added to `Connection` must not appear in a
 * response by being forgotten about. `Omit<Connection, 'apiKey'>` would put
 * every future field on the wire by default and only a reviewer between it and
 * a leak.
 *
 * **`hasKey` rather than the key**, because *a key is set* and *no key, this is
 * a local endpoint* are different states an admin has to tell apart — and an
 * empty password box cannot distinguish them, so the form would either mangle
 * the stored key or make the admin retype it on every edit.
 *
 * **`baseUrl` is admin-visible and user-invisible**, which is [04 §4.5]'s *"an
 * admin may opt to show it"* read as narrowly as it goes: the bullet permits
 * showing a user the URL, and the admin who set it is the only person who needs
 * it.
 */
export interface AdminConnection {
  id: string;
  label: string;
  provider: string;
  scope: Connection['scope'];
  models: string[];
  baseUrl?: string;
  capabilities?: Partial<ProviderCapabilities>;
  /** Whether a key is stored. Never the key. */
  hasKey: boolean;
}

export function presentForAdmin(connection: Connection): AdminConnection {
  return {
    id: connection.id,
    label: connection.label,
    provider: connection.provider,
    scope: connection.scope,
    models: connection.models,
    ...(connection.baseUrl === undefined ? {} : { baseUrl: connection.baseUrl }),
    ...(connection.capabilities === undefined ? {} : { capabilities: connection.capabilities }),
    hasKey: typeof connection.apiKey === 'string' && connection.apiKey.length > 0,
  };
}

export class ConnectionError extends Error {
  readonly code: 'not-found' | 'invalid' | 'unbuildable';

  constructor(code: ConnectionError['code'], message: string) {
    super(message);
    this.name = 'ConnectionError';
    this.code = code;
  }
}

/**
 * Where a connection's file goes — `<scope root>/<id>.json`.
 *
 * **Derived, never read.** `readConnectionsIn` keeps taking the id from the
 * file's *contents*, so a hand-renamed file goes on working — the same position
 * [P1 §1.1](../../../../docs/design/workplan/03-p1-implementation.md) takes on library slugs and
 * for the same reason: the path is a convenience, the id is identity.
 *
 * Which means a delete cannot be a path join alone. Every connection fixture
 * this repository has ever written by hand is named for its provider —
 * `fake.json`, `house.json` — so a delete that only tried the obvious path
 * would pass its own tests and fail against every file anybody actually has.
 */
export function connectionFile(root: string, id: string): string {
  return resolveWithin(root, `${id}.json`);
}

/**
 * Writes a connection into a scope's directory, minting the id if it is new.
 *
 * **Ids are minted server-side as uuidv7, never accepted from the body**, which
 * closes the shadowing hole [P2B §1.5] found — a personal file reusing a system
 * connection's id silently shadows it — for anything created through the UI,
 * without outlawing the hand-written file that already works.
 *
 * **Buildability is checked here rather than at the next turn.** `KNOWN_PROVIDERS`
 * carries capability defaults for five names and this build constructs exactly
 * one of them, so a connection naming `anthropic` would save cleanly and fail at
 * call time — the worst place to find out. The form offers only what can be
 * built and this refuses the rest anyway, because a route that trusts its own
 * form is a route that has not met one.
 */
export async function writeConnection(
  layout: Layout,
  root: string,
  input: {
    id?: string;
    label: string;
    provider: string;
    apiKey?: string | undefined;
    baseUrl?: string | undefined;
    models: string[];
    capabilities?: Partial<ProviderCapabilities> | undefined;
  },
): Promise<Connection> {
  if (!canBuild(input.provider)) {
    throw new ConnectionError(
      'unbuildable',
      `This build cannot talk to a ${input.provider} endpoint. Only openai-compatible connections work.`,
    );
  }
  if (input.label.trim().length === 0) {
    throw new ConnectionError('invalid', 'A connection needs a label.');
  }

  const id = input.id ?? uuidv7();
  const path = connectionFile(root, id);

  /**
   * **The key is preserved when the caller does not send one.**
   *
   * `hasKey` exists because an empty password box cannot distinguish *no key*
   * from *unchanged*, so the form leaves the field blank to keep what is
   * stored — and the write has to honour that or every edit of a label would
   * silently delete the credential.
   */
  const existing = input.id === undefined ? null : await readConnectionAt(path, root, layout);
  const apiKey = input.apiKey ?? existing?.apiKey;

  const file = {
    id,
    label: input.label,
    provider: input.provider,
    models: input.models,
    ...(apiKey === undefined ? {} : { apiKey }),
    ...(input.baseUrl === undefined || input.baseUrl.length === 0
      ? {}
      : { baseUrl: input.baseUrl }),
    ...(input.capabilities === undefined ? {} : { capabilities: input.capabilities }),
  };

  await layout.assertReal(root);
  await writeJsonAtomic(path, file);

  return { ...file, scope: root === layout.systemConnectionsRoot ? 'system' : 'user' };
}

/**
 * Removes a connection, by id rather than by path.
 *
 * **Tries the derived path, then scans** — because the derived name is this
 * phase's convention and not a guarantee about what is on disk. Every fixture in
 * this repository predates the convention, and [P2B §2.3] promises a
 * hand-written file keeps working; a delete that could only find its own writes
 * would break that promise silently, leaving a connection an admin has just been
 * told is gone.
 */
export async function deleteConnection(layout: Layout, root: string, id: string): Promise<void> {
  const path = await findConnectionFile(layout, root, id);
  if (path === null) {
    throw new ConnectionError('not-found', `No connection with the id ${id}.`);
  }
  await layout.assertReal(path);
  await unlinkFile(path);
}

/** The file holding this id, derived name first and then a scan. */
export async function findConnectionFile(
  layout: Layout,
  root: string,
  id: string,
): Promise<string | null> {
  const derived = connectionFile(root, id);
  if ((await readConnectionAt(derived, root, layout))?.id === id) return derived;

  for (const name of await listEntryNames(root)) {
    if (!name.endsWith('.json')) continue;
    const candidate = resolveWithin(root, name);
    if ((await readConnectionAt(candidate, root, layout))?.id === id) return candidate;
  }
  return null;
}

async function readConnectionAt(
  path: string,
  root: string,
  layout: Layout,
): Promise<Connection | null> {
  const bytes = await readFileBytes(path);
  if (bytes === null) return null;
  return parseConnection(bytes, root === layout.systemConnectionsRoot ? 'system' : 'user');
}
