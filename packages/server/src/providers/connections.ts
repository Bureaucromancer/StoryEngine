// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import type { Layout } from '../storage/layout.js';
import { uuidv7 } from '@storyengine/shared';

import { contentHashOf } from '../index-db/ingest.js';
import { writeJsonAtomic } from '../storage/atomic.js';
import { listEntryNames, readFileBytes, unlinkFile } from '../storage/files.js';
import { resolveWithin } from '../storage/paths.js';
import { canBuild } from './factory.js';
import type { ProviderCapabilities } from './types.js';

/**
 * Connections — [09 §4.5](../../../../docs/design/09-server-multiuser-deployment.md).
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
 *   private host. An admin may opt to show it — [09 §4.5]'s one permission
 *   here, and {@link AdminConnection} takes it as narrowly as it goes: the
 *   admin who set the URL is the only person shown it, and
 *   {@link PublicConnection} still has nowhere to put one. *(This said P10 was
 *   the phase that would decide it. It was decided at
 *   [P2B §2.2](../../../../docs/design/workplan/10-p2b-provider-configuration.md), because a
 *   form that cannot show a URL back is a write-only form.)*
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
   * endpoint* ([19 §5.3](../../../../docs/design/19-tech-stack.md)).
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
   * wondering why a model call started failing ([09 §4.5]).
   */
  disabled: Connection[];
}

/**
 * Every connection an account may use.
 *
 * **The capability is enforced here, not at creation**, and that is the
 * load-bearing detail. A user with write file access can drop a connection file
 * straight into their own directory ([10 §4](../../../../docs/design/10-ui-surfaces.md)),
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
  return (await readEntriesIn(layout, layout.systemConnectionsRoot, 'system')).map(
    (entry) => entry.connection,
  );
}

/**
 * A connection with the two facts that belong to its **file** rather than to it.
 *
 * Kept beside the parsed object rather than folded into it, because
 * {@link Connection} is what a turn resolves against and a turn has no business
 * knowing where the bytes came from. The admin surface does: it needs a hash to
 * present back on a save, and a path to write to.
 */
export interface ConnectionEntry {
  connection: Connection;
  contentHash: string;
  path: string;
}

/** The system scope, files and all — what the admin list is built from. */
export async function readSystemConnectionEntries(layout: Layout): Promise<ConnectionEntry[]> {
  return readEntriesIn(layout, layout.systemConnectionsRoot, 'system');
}

/**
 * One person's own scope, files and all — [10 §15.1], [P10.3].
 *
 * ***The sibling above, and the asymmetry between them is the whole story of
 * why this arrived eight phases later.*** `resolveConnections` has read this
 * directory since P2A; what did not exist was a **writer**, deliberately, and
 * `routes/connections.ts` states the line in its own docstring: *"this writes
 * the system scope and only the system scope… a user's own `connections/` stays
 * read by the resolver, hand-written by anyone who wants one, and reachable
 * from nothing here."*
 *
 * **What changed is that the capability became real.** [09 §4.5] calls a
 * UI-level check *"a trivial bypass"* and puts the enforcement in the loader,
 * which is where `privateConnections` has been enforced since P3 — so a personal
 * surface built before that would have been the bypass wearing a UI, and one
 * built after is a form over a directory the resolver already respects.
 */
export async function readUserConnectionEntries(
  layout: Layout,
  handle: string,
): Promise<ConnectionEntry[]> {
  return readEntriesIn(layout, layout.userConnectionsRoot(handle), 'user');
}

async function readConnectionsIn(
  layout: Layout,
  root: string,
  scope: Connection['scope'],
): Promise<Connection[]> {
  return (await readEntriesIn(layout, root, scope)).map((entry) => entry.connection);
}

async function readEntriesIn(
  layout: Layout,
  root: string,
  scope: Connection['scope'],
): Promise<ConnectionEntry[]> {
  const names = await listEntryNames(root);
  const entries: ConnectionEntry[] = [];

  for (const name of names) {
    if (!name.endsWith('.json')) continue;

    const path = resolveWithin(root, name);

    /**
     * **One bad entry is skipped, and "bad" now includes one that will not
     * open** — not only one that will not parse.
     *
     * `assertReal` is the same door every other read goes through (F1): a
     * connections directory is as hand-editable as a library one, and a link
     * out of it would be a way to read a file the server would not otherwise
     * open. It *throws*, and so does a read of a directory somebody named
     * `x.json` — so both used to escape a function whose comment promised that
     * a single bad file is survivable.
     *
     * That was harmless while only the connections list read this. P2B.4 put
     * it under `GET /api/admin/accounts`, at which point one person's stray
     * entry answered **500** on a page listing everybody. Found by a P2B
     * review; nothing went red, because nothing wrote one.
     */
    let bytes: Uint8Array | null;
    try {
      await layout.assertReal(path);
      bytes = await readFileBytes(path);
    } catch {
      continue;
    }
    if (bytes === null) continue;

    const parsed = parseConnection(bytes, scope);
    // A malformed connection file is skipped rather than fatal. The failure a
    // person will actually have is a typo in one file, and taking down every
    // other connection because of it is the wrong answer — P2.3's invalid-file
    // state (F20) is where this becomes visible rather than merely survivable.
    if (parsed !== null)
      entries.push({ connection: parsed, contentHash: contentHashOf(bytes), path });
  }

  return entries.sort((a, b) => a.connection.label.localeCompare(b.connection.label));
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
 * A connection as an **admin** editing one may see it — [P2B §2.2](../../../../docs/design/workplan/10-p2b-provider-configuration.md).
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
 * **`baseUrl` is admin-visible and user-invisible**, which is [09 §4.5]'s *"an
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
  /**
   * True when an earlier file in resolution order already claims this id, so
   * nothing will ever resolve to this one — [P2B §4](../../../../docs/design/workplan/10-p2b-provider-configuration.md)
   * step 10, and [P1 §1.2](../../../../docs/design/workplan/07-p1-implementation.md)'s posture: both
   * are listed and nothing is blocked, but the one that loses says so.
   *
   * **A property of the list, not of the connection**, which is why it is
   * {@link presentConnectionsForAdmin} that fills it in and why the single
   * presenter cannot. A connection read on its own has no rival to lose to.
   */
  shadowed: boolean;
  /**
   * The file's bytes, hashed — the same guard the library and the config form
   * use, and settled as *yes* in [P2B §6].
   *
   * Not against a second admin, who is rare at this scale: against **a text
   * editor**. A connections directory is as hand-editable as a library one, so
   * the edit form has to be able to notice that what it read is no longer what
   * is there.
   */
  contentHash: string;
}

export function presentForAdmin(connection: Connection, contentHash: string): AdminConnection {
  return {
    id: connection.id,
    label: connection.label,
    provider: connection.provider,
    scope: connection.scope,
    models: connection.models,
    ...(connection.baseUrl === undefined ? {} : { baseUrl: connection.baseUrl }),
    ...(connection.capabilities === undefined ? {} : { capabilities: connection.capabilities }),
    hasKey: typeof connection.apiKey === 'string' && connection.apiKey.length > 0,
    // A connection presented on its own is the one the caller asked for; there
    // is no list for it to lose a race in.
    shadowed: false,
    contentHash,
  };
}

/**
 * A whole scope, presented — and the only place `shadowed` can be computed.
 *
 * **The order is the resolver's order, not a rendering choice.**
 * `resolveRole` takes `usable.find(c => c.id === binding.connectionId)`, so
 * the first entry in the list a scope produces is the one a binding reaches and
 * every later claimant is dead weight. Computing the flag from this same array
 * is what makes it true rather than plausible: a second implementation of
 * *which one wins* would be a second thing to keep in step with `resolveRole`.
 */
export function presentConnectionsForAdmin(
  entries: readonly { connection: Connection; contentHash: string }[],
): AdminConnection[] {
  const claimed = new Set<string>();
  return entries.map(({ connection, contentHash }) => {
    const shadowed = claimed.has(connection.id);
    claimed.add(connection.id);
    return { ...presentForAdmin(connection, contentHash), shadowed };
  });
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
 * [P1 §1.1](../../../../docs/design/workplan/07-p1-implementation.md) takes on library slugs and
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
): Promise<ConnectionEntry> {
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
  /**
   * **An edit writes back to the file it came from**, and only a create gets
   * the derived name.
   *
   * This used to be `connectionFile(root, id)` unconditionally, which reads as
   * harmless and is not: [P2B §2.3] promises a hand-written `house.json` keeps
   * working, and `readConnectionsIn` takes the id from the file's *contents*.
   * So editing one through the form wrote a **second** file at `<id>.json`,
   * leaving two claiming one id — and the `existing` read below looked at the
   * derived path too, found nothing, and **dropped the stored key**. Renaming a
   * connection deleted its credential and manufactured the shadowing case
   * §4 step 10 is about, in one save.
   */
  const path =
    input.id === undefined ? connectionFile(root, id) : await editTarget(layout, root, id);

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

  /**
   * **And the capability overrides are preserved on the same terms**, which the
   * key's argument above always covered and this code did not.
   *
   * The form has no field for them — deliberately, since
   * [19 §5.3](../../../../docs/design/19-tech-stack.md) makes them the operator saying something
   * about their own endpoint rather than a setting with a sensible default — so
   * it sends none, and a write that took `input.capabilities` alone **deleted
   * whatever was on disk every time somebody renamed a connection.**
   *
   * That is worse than it sounds, because `capabilities` is where
   * `maxContextTokens` and `reportsUsage` live: the two overrides an operator
   * hand-writes precisely because their local runtime does not match the
   * conservative baseline. Losing them silently turns a working install into one
   * that truncates at 8192 and reports no usage, with a rename as the only
   * visible cause.
   */
  const capabilities = input.capabilities ?? existing?.capabilities;

  const file = {
    id,
    label: input.label,
    provider: input.provider,
    models: input.models,
    ...(apiKey === undefined ? {} : { apiKey }),
    ...(input.baseUrl === undefined || input.baseUrl.length === 0
      ? {}
      : { baseUrl: input.baseUrl }),
    ...(capabilities === undefined ? {} : { capabilities }),
  };

  await layout.assertReal(root);
  await writeJsonAtomic(path, file);

  /**
   * **Hashed from the bytes on disk, not from the object just serialised.**
   *
   * One extra read per save, and it buys the only property that matters: the
   * hash a save hands back is the hash the next read will compute. Hashing the
   * in-memory value instead would be right until the day the writer's
   * serialisation and the reader's differ by a trailing newline, and the
   * symptom would be every second save refusing itself.
   */
  const bytes = await readFileBytes(path);
  return {
    connection: { ...file, scope: root === layout.systemConnectionsRoot ? 'system' : 'user' },
    contentHash: contentHashOf(bytes ?? new Uint8Array()),
    path,
  };
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
export async function deleteConnection(layout: Layout, root: string, id: string): Promise<number> {
  const paths = await findConnectionFiles(layout, root, id);
  if (paths.length === 0) {
    throw new ConnectionError('not-found', `No connection with the id ${id}.`);
  }
  for (const path of paths) {
    await layout.assertReal(path);
    await unlinkFile(path);
  }
  return paths.length;
}

/**
 * Every file claiming this id, derived name first and then a scan.
 *
 * **Every, not the first**, and the difference is the whole of [P2B §4] step
 * 10's second half. Two files may claim one id — nothing dedupes a directory
 * anybody may write into — and a delete that unlinked only the first answered
 * `204` while the connection went on resolving from the second. §2.8 names the
 * case this is for: *an admin revoking a leaked key*. Being told **gone** while
 * it still works is the wrong answer there, and it is the one answer this
 * function must never give.
 *
 * Refusing instead would have been the other consistent choice, and it is the
 * wrong one at this scale: [P1 §1.2](../../../../docs/design/workplan/07-p1-implementation.md)'s
 * posture is that duplicate ids are surfaced and nothing is blocked, and an
 * admin who cannot revoke until they have tidied their directory by hand is
 * blocked at exactly the wrong moment.
 */
export async function findConnectionFiles(
  layout: Layout,
  root: string,
  id: string,
): Promise<string[]> {
  /**
   * **A scan and nothing else.** This tried the derived `<id>.json` first, on
   * the reasoning that it is the name this store writes — and that probe cost
   * two defects and bought nothing, because the scan below already reaches a
   * file living at that path.
   *
   * What it cost: `connectionFile` runs the id through `resolveWithin`, which
   * **throws** for an id that is not a legal path segment. `parseConnection`
   * accepts any string id, so a hand-written file claiming `a/b` could be
   * listed and edited and never deleted — `DELETE` answered 500. And the
   * `found.includes(candidate)` dedupe the probe made necessary compares paths
   * exactly, so on a case-insensitive filesystem `<ID>.json` and `<id>.json`
   * are one file counted twice: unlinked twice, and a count reported wrong.
   *
   * Both found by a P2B review. The ordering the probe gave is depended on by
   * nothing — `deleteConnection` unlinks the whole list, and `editTarget`
   * deliberately asks `readEntriesIn` instead precisely because it needs the
   * *resolver's* order rather than this one.
   */
  const found: string[] = [];
  for (const name of await listEntryNames(root)) {
    if (!name.endsWith('.json')) continue;
    const candidate = resolveWithin(root, name);
    if ((await readConnectionAt(candidate, root, layout))?.id === id) found.push(candidate);
  }
  return found;
}

/**
 * The one file an edit writes back to: the winner, or the name a create would use.
 *
 * **Found through `readEntriesIn`, not through {@link findConnectionFiles}**,
 * and the distinction is load-bearing rather than fussy. The two disagree on
 * *order*: the finder tries the derived name first because a delete only needs
 * to reach every file, while resolution goes by the label sort a scope is read
 * in. Editing the wrong one of two claimants would be a form that saved
 * successfully and changed nothing anybody could see — so this asks the same
 * question the resolver asks, in the same order, and gets the same answer.
 */
async function editTarget(layout: Layout, root: string, id: string): Promise<string> {
  const scope = root === layout.systemConnectionsRoot ? 'system' : 'user';
  const winner = (await readEntriesIn(layout, root, scope)).find(
    (entry) => entry.connection.id === id,
  );
  return winner?.path ?? connectionFile(root, id);
}

/** One file, or `null` — for anything that will not open as well as anything that will not parse. */
async function readConnectionAt(
  path: string,
  root: string,
  layout: Layout,
): Promise<Connection | null> {
  let bytes: Uint8Array | null;
  try {
    bytes = await readFileBytes(path);
  } catch {
    return null;
  }
  if (bytes === null) return null;
  return parseConnection(bytes, root === layout.systemConnectionsRoot ? 'system' : 'user');
}
