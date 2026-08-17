// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import type { DatabaseSync } from 'node:sqlite';
import { deflateSync } from 'node:zlib';

import encodeChunks from 'png-chunks-encode';

import {
  ACTOR_SCHEMA,
  isKnownSchema,
  type PortableSchemaId,
  schemaIdOf,
  uuidv7,
  validate,
  type ValidationIssue,
} from '@storyengine/shared';

import {
  contentHashOf,
  type FileErrorReason,
  ingestFile,
  listFileErrors,
  removeFile,
} from './index-db/ingest.js';
import { findById, findByIdAt, type IndexedObject, listObjects } from './index-db/query.js';
import { writeAtomic } from './storage/atomic.js';
import { envelope, pngCardCodec } from './storage/card/index.js';
import { moveTree, readFileBytes } from './storage/files.js';
import { KeyedQueue } from './storage/keyed-queue.js';
import {
  listVersions,
  patchVersion,
  readVersionPayload,
  snapshotReplaced,
  type VersionRecord,
  type VersionSource,
} from './storage/history.js';
import {
  type Layout,
  type LibraryScope,
  resolveFreeSlug,
  SYSTEM_SCOPE,
  userScope,
} from './storage/layout.js';

/**
 * Library CRUD, one handler set rather than six.
 *
 * **The registry is what makes this kind-agnostic**
 * ([10 §9](../../../docs/design/10-schemas.md)): every portable object self-describes, so
 * nothing here enumerates kinds. Adding Campaign at 2.0 should not touch this
 * file.
 *
 * Three rules are enforced here rather than in the routes, because they are
 * properties of the *write path* and a route is only one caller of it:
 *
 * - **The server indexes its own writes synchronously**, so a `GET` after a
 *   `POST` reflects it ([02 §5.1.1](../../../docs/design/02-data-model.md)). The watcher
 *   is for foreign writes and has no such guarantee, nor needs one.
 * - **Every read carries a content hash and every write must present one**
 *   ([04 §4.4](../../../docs/design/04-server-multiuser-deployment.md)). A stale hash is
 *   rejected with the current object, so the caller can offer a choice rather
 *   than guess. It is also the only defence the hot-reload thesis has against
 *   silently eating a hand edit.
 * - **A rename is an ordinary write.** Changing `name` changes the field inside
 *   the file; the folder keeps the slug it was born with
 *   ([P1 §1.1](../../../docs/design/workplan/03-p1-implementation.md)). There is no rename route
 *   and there is nothing here that moves a directory.
 */

export class LibraryError extends Error {
  readonly code: 'not-found' | 'stale' | 'invalid' | 'read-only' | 'conflict' | 'refused-path';
  readonly current?: IndexedObject;
  /**
   * Per-field validation failures, when there are any.
   *
   * Structured as well as written into the message, because the route layer's
   * schema rejections answer with an `issues` array (F2) and a caller should
   * not have to parse prose to find out which of the two validators refused it.
   */
  readonly issues?: ValidationIssue[];

  constructor(
    code: LibraryError['code'],
    message: string,
    current?: IndexedObject,
    issues?: ValidationIssue[],
  ) {
    super(message);
    this.name = 'LibraryError';
    this.code = code;
    if (current) this.current = current;
    if (issues) this.issues = issues;
  }
}

export interface LibraryContext {
  db: DatabaseSync;
  layout: Layout;
  /** Retention cap for version history, from `history.keepPerObject` ([02 §11.3]). */
  keepHistoryPerObject: number;
  /** Test seam: a failing writer proves the write→snapshot ordering. */
  write?: typeof writeAtomic;
}

/**
 * Serialises the check-then-write sequences. The stale-hash comparison, the
 * no-op decision, slug allocation and the snapshot all read state that the
 * write then changes; without a critical section, two writers racing through
 * the same `await` points both pass the check and the loser is silently
 * overwritten — the exact failure the hash exists to refuse. Keyed by object
 * id (updates, deletes) or kind directory (creates), so unrelated objects
 * never wait on each other. Deliberately separate from the watcher's event
 * chain — see `keyed-queue.ts` for why sharing it would be wrong.
 */
const writes = new KeyedQueue();

export interface StoredObject {
  object: unknown;
  contentHash: string;
  path: string;
  slug: string;
  scope: LibraryScope;
  /** True when another file holds this id at an earlier path ([P1 §1.2]). */
  shadowed: boolean;
}

/**
 * The scopes a request may read: the caller's own library and the system one.
 *
 * **`system/library/` is loaded and merged from P1**, shipped empty
 * ([P1 §1.3](../../../docs/design/workplan/03-p1-implementation.md)). The merge is a query rather
 * than a special case, and retrofitting it into every list endpoint later is the
 * annoying version — so it lands now, with nothing in it.
 */
export function readableScopes(handle: string): LibraryScope[] {
  return [userScope(handle), SYSTEM_SCOPE];
}

export function list(
  context: LibraryContext,
  handle: string,
  schemaId?: PortableSchemaId,
): IndexedObject[] {
  return listObjects(context.db, {
    scopes: readableScopes(handle),
    ...(schemaId ? { schemaId } : {}),
  });
}

/**
 * A file that is in an object's place and cannot be read as one — F20.
 *
 * The reason this is a *read* rather than a log line: the failure belongs to the
 * person who made the edit, and they are looking at the app, not at the server's
 * stdout. [02 §5.1](../../../docs/design/02-data-model.md) promises that hand-editing is
 * supported; a promise like that is only kept if a typo says so out loud.
 *
 * `path` is portable — relative to the data root — for the same reason every
 * other error message is (F22). The client needs to know *which file*, which the
 * relative path answers; it does not need to know where the server keeps its
 * disk.
 */
export interface LibraryFileError {
  path: string;
  source: 'user' | 'system';
  kind: string;
  slug: string;
  reason: FileErrorReason;
  detail: string | null;
  seenAt: number;
}

export function fileErrors(context: LibraryContext, handle: string): LibraryFileError[] {
  const scopes = readableScopes(handle).map(scopeKeyOf);
  return listFileErrors(context.db, scopes).map((row) => ({
    // A row whose path escaped the root is not addressable by a client, and
    // silently rewriting it to something that looks relative would be worse
    // than admitting the path is unknown.
    path: context.layout.portablePath(row.path) ?? '(outside the data directory)',
    source: row.scope === 'system' ? ('system' as const) : ('user' as const),
    kind: row.schemaId,
    slug: row.slug,
    reason: row.reason,
    detail: row.detail,
    seenAt: row.seenAt,
  }));
}

/**
 * Which copy of a duplicated id to read — a specific one, by where it lives.
 *
 * **Reads only.** Every write and every reference between objects stays
 * id-only and resolves to the winner ([P1 §1.1]): a duplicate is a mistake to
 * be shown, not a second address to build on. Making it writable would turn a
 * warning into a fork.
 */
export interface ObjectAddress {
  source: 'user' | 'system';
  slug: string;
}

/**
 * The one door every by-id operation goes through.
 *
 * `inKind` is the kind the *caller's URL* claimed, and checking it here rather
 * than in each route is the point: `/library/actors/<lorebook-id>` used to
 * return the lorebook, because the `:kind` segment was read, resolved, and then
 * never compared to anything (F2). One funnel means a new route cannot forget
 * the check — which matters because P2.3 adds several.
 *
 * A mismatch is **not-found rather than a mismatch error**: from the caller's
 * side that collection genuinely does not contain that id, and saying "wrong
 * kind" would confirm the object exists somewhere, which is the same leak the
 * scope check below exists to avoid.
 *
 * `at` narrows to one copy of a duplicated id (F19); without it, the winner.
 */
export function read(
  context: LibraryContext,
  handle: string,
  id: string,
  inKind?: PortableSchemaId,
  at?: ObjectAddress,
): IndexedObject {
  if (at) return readAt(context, handle, id, inKind, at);
  const row = findById(context.db, id);
  if (!row || !readableScopes(handle).some((scope) => scopeKeyOf(scope) === row.scope)) {
    // Not-found rather than forbidden for another user's object: the handle is
    // the owner ([04 §4.3]), and confirming that an id exists elsewhere would
    // leak the one fact this separation exists to keep.
    throw new LibraryError('not-found', `No object with id ${id}.`);
  }
  if (inKind !== undefined && row.schemaId !== inKind) {
    throw new LibraryError('not-found', `No object with id ${id} in that kind.`);
  }
  return row;
}

function readAt(
  context: LibraryContext,
  handle: string,
  id: string,
  inKind: PortableSchemaId | undefined,
  at: ObjectAddress,
): IndexedObject {
  const scope = at.source === 'system' ? SYSTEM_SCOPE : userScope(handle);
  const row = findByIdAt(context.db, id, { scope: scopeKeyOf(scope), slug: at.slug });
  if (!row || (inKind !== undefined && row.schemaId !== inKind)) {
    // The same answer as an id that does not exist. An address that named
    // somebody else's library would resolve to this user's scope and find
    // nothing, which is the containment rule doing its job rather than a
    // separate check to remember.
    throw new LibraryError('not-found', `No object with id ${id} at that address.`);
  }
  return row;
}

function scopeKeyOf(scope: LibraryScope): string {
  return scope.kind === 'system' ? 'system' : `user:${scope.handle}`;
}

/**
 * Serialises an object the way its kind is stored, without writing anything.
 *
 * The actor is the only kind that is not plain JSON, and the card is spliced
 * into whatever pixels are already there — never re-encoded
 * ([02 §5.2](../../../docs/design/02-data-model.md)).
 *
 * Encoding is separate from writing so the caller can apply the no-op rule
 * ([02 §11.1](../../../docs/design/02-data-model.md)): a save that changes nothing must
 * produce neither a write nor a history entry, and the only honest way to know
 * is to build the exact bytes and compare.
 */
async function encodeObject(
  layout: Layout,
  scope: LibraryScope,
  schemaId: PortableSchemaId,
  slug: string,
  object: unknown,
  /**
   * The file's current bytes, when the caller has already read (and verified)
   * them. `update()` must pass these: reading the file again here would open a
   * window between its hash check and this read, which is the hole the check
   * exists to close. `null` means verified-absent; omitted means "read it".
   */
  existingBytes?: Uint8Array | null,
): Promise<{ path: string; bytes: Uint8Array; contentHash: string }> {
  const path = layout.objectFile(scope, schemaId, slug);

  // The write path's door (F1). Lexically this path is already safe; what the
  // string cannot say is whether a directory along it is a link out of the data
  // root. Checked here rather than at each caller because every write — create,
  // update, restore — is encoded through this function first.
  await layout.assertReal(path);

  let bytes: Uint8Array;
  if (schemaId === ACTOR_SCHEMA) {
    const existing = existingBytes !== undefined ? existingBytes : await readFileBytes(path);
    const canvas = existing ?? blankCardPixels();
    const contents = existing ? pngCardCodec.read(existing) : null;
    bytes = pngCardCodec.write(canvas, envelope(object), contents?.blobs);
  } else {
    bytes = new TextEncoder().encode(`${JSON.stringify(object, null, 2)}\n`);
  }

  return { path, bytes, contentHash: contentHashOf(bytes) };
}

/**
 * The pixels a brand-new card starts with: 1×1, fully transparent.
 *
 * Deliberately not a generated placeholder portrait. The card's pixels are *the
 * portrait as intended* ([02 §5.2.1](../../../docs/design/02-data-model.md)) — what any
 * tool that only knows "a card is a picture" will render — so inventing one
 * would put a face nobody chose in front of every such tool. An empty card is
 * honest; a stock avatar is a small lie that travels with the file.
 *
 * Built rather than written out as a byte array. The first attempt at this was a
 * hand-typed literal with a wrong CRC, which is the obvious way to get it wrong
 * and not obvious to notice: PNG carries a checksum per chunk, and a decoder
 * that verifies them refuses the file.
 */
let blankCard: Uint8Array | null = null;

function blankCardPixels(): Uint8Array {
  if (blankCard) return blankCard;

  const ihdr = new Uint8Array(13);
  const view = new DataView(ihdr.buffer);
  view.setUint32(0, 1); // width
  view.setUint32(4, 1); // height
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // colour type: truecolour with alpha
  // One scanline: a filter byte, then RGBA all zero — transparent.
  const idat = deflateSync(new Uint8Array(5));

  blankCard = Uint8Array.from(
    encodeChunks([
      { name: 'IHDR', data: ihdr },
      { name: 'IDAT', data: new Uint8Array(idat) },
      { name: 'IEND', data: new Uint8Array(0) },
    ]),
  );
  return blankCard;
}

function assertValidObject(object: unknown): PortableSchemaId {
  const schemaId = schemaIdOf(object);
  if (schemaId === null || !isKnownSchema(schemaId)) {
    throw new LibraryError('invalid', 'The object does not name a schema this build understands.');
  }
  const result = validate(object);
  if (!result.valid) {
    throw new LibraryError(
      'invalid',
      `The object is not valid: ${result.issues.map((issue) => `${issue.path} ${issue.message}`).join('; ')}`,
      undefined,
      result.issues,
    );
  }
  return schemaId;
}

export async function create(
  context: LibraryContext,
  handle: string,
  object: unknown,
  inKind?: PortableSchemaId,
): Promise<StoredObject> {
  const schemaId = assertValidObject(object);
  if (inKind !== undefined && schemaId !== inKind) {
    // `POST /library/lorebooks` with an actor body used to create an actor: the
    // URL segment picked the route and then decided nothing (F2). Here the
    // mismatch is the caller's error and worth saying plainly — unlike the read
    // side, nothing is disclosed by naming it, because the caller sent both
    // halves.
    throw new LibraryError(
      'invalid',
      `This is a ${schemaId} and the URL says ${inKind}. Post it to its own kind.`,
    );
  }
  const scope = userScope(handle);
  const kindRoot = context.layout.kindRoot(scope, schemaId);

  // The whole body runs on the kind's queue: slug resolution reads the
  // directory and the write then claims the name, so two concurrent creates
  // of "Vera" must take turns or they both resolve `vera` and one silently
  // overwrites the other. The id-conflict check sits inside for the same
  // reason — the first create's synchronous ingest is what the second one's
  // check needs to see.
  return writes.run(`kind:${kindRoot}`, async () => {
    const id = (object as { id: string }).id;

    if (findById(context.db, id)) {
      throw new LibraryError('conflict', `An object with id ${id} already exists.`);
    }

    // The slug is derived here, once, and then frozen ([P1 §1.1]). Nothing ever
    // resolves by it.
    const name =
      typeof (object as { name?: unknown }).name === 'string'
        ? (object as { name: string }).name
        : 'untitled';
    const slug = await resolveFreeSlug(kindRoot, name);

    const { path, bytes, contentHash } = await encodeObject(
      context.layout,
      scope,
      schemaId,
      slug,
      object,
    );
    await (context.write ?? writeAtomic)(path, bytes);
    await ingestFile(context.db, context.layout, path);

    return { object, contentHash, path, slug, scope, shadowed: false };
  });
}

/**
 * What made a change, threaded through to the version record. The route passes
 * `manual`; `restore` passes itself; the watcher stamps `external` on its own
 * path rather than through here.
 */
export interface ChangeAttribution {
  source: VersionSource;
  reason: string;
  /**
   * Whether the server stamps `provenance.updatedAt` on a real change.
   * Defaults on: `authoredAt` correctness must not depend on the client
   * remembering to stamp ([13 §1.6]). Restore turns it off — restoring is not
   * authoring, and stamping would change the restored bytes and so break
   * "restoring the state you are on is a no-op".
   */
  stamp?: boolean;
}

const MANUAL: ChangeAttribution = { source: { kind: 'manual' }, reason: '' };

/** A copy with `provenance.updatedAt` set to now. Validation has already run. */
function stampProvenance(object: unknown): unknown {
  const clone = structuredClone(object) as Record<string, unknown>;
  const provenance = clone['provenance'];
  if (typeof provenance === 'object' && provenance !== null) {
    (provenance as Record<string, unknown>)['updatedAt'] = new Date().toISOString();
  }
  return clone;
}

/**
 * Replaces an object, checking the caller's hash first.
 *
 * `expectedHash` is what the caller last read. If the file has moved on — a
 * second tab, a hand edit, the file browser — the write is refused and the
 * *current* object comes back with the error, so the UI can offer reload-and-
 * reapply or save-as-a-copy rather than guessing
 * ([04 §4.4](../../../docs/design/04-server-multiuser-deployment.md)).
 */
export async function update(
  context: LibraryContext,
  handle: string,
  id: string,
  object: unknown,
  expectedHash: string,
  change: ChangeAttribution = MANUAL,
  inKind?: PortableSchemaId,
): Promise<StoredObject> {
  const schemaId = assertValidObject(object);

  // Everything from the hash check to the write runs on the object's queue —
  // a second writer through the same server waits its turn and then fails the
  // check honestly, instead of racing through the awaits and winning silently.
  return writes.run(`obj:${id}`, async () => {
    const current = read(context, handle, id, inKind);

    if (current.scope === 'system') {
      // App-shipped and read-only; an update would be overwritten by the next
      // release anyway ([05 §4.2]). Copy-to-my-library is the intended move.
      throw new LibraryError('read-only', 'System library objects cannot be edited.');
    }
    if (current.schemaId !== schemaId) {
      throw new LibraryError('invalid', 'An object cannot change kind.');
    }
    if ((object as { id: string }).id !== id) {
      throw new LibraryError('invalid', 'An object cannot change its id.');
    }
    if (current.contentHash !== expectedHash) {
      throw new LibraryError('stale', 'The object has changed since it was read.', current);
    }

    // The index lags a foreign edit by the watcher's settle window, so the row
    // alone cannot vouch for the file. Read the bytes once, verify they still
    // hash to what the caller saw, and thread them through the encode below —
    // a hand edit made moments ago is refused here instead of eaten.
    // The index's own door: this path came out of SQLite, so it was checked
    // when it was indexed and not since. A link planted in between is exactly
    // the case the lexical rules cannot see.
    await context.layout.assertReal(current.path);
    const existingBytes = await readFileBytes(current.path);
    if (existingBytes === null || contentHashOf(existingBytes) !== current.contentHash) {
      // Vanished-underneath lands here too: stale rather than not-found, so
      // the caller keeps the 412 recovery path instead of a dead end.
      throw new LibraryError('stale', 'The object has changed on disk since it was read.', current);
    }

    const scope = userScope(handle);
    const asSent = await encodeObject(
      context.layout,
      scope,
      schemaId,
      current.slug,
      object,
      existingBytes,
    );

    // **The no-op rule** ([02 §11.1]). A write that changes nothing produces no
    // write and no version — without this, every round-trip through an editor
    // adds an identical history entry, and a restore to the current state
    // duplicates it. Byte equality, via the hash, is the honest comparison: it
    // is exactly what the next read would see. Decided on the object *as
    // sent*, before any stamping — otherwise the stamp itself would make every
    // save a change.
    if (asSent.contentHash === current.contentHash) {
      return {
        object: current.body,
        contentHash: asSent.contentHash,
        path: asSent.path,
        slug: current.slug,
        scope,
        shadowed: current.shadowed,
      };
    }

    const stamp = change.stamp !== false;
    const stamped = stamp ? stampProvenance(object) : object;
    const { path, bytes, contentHash } = stamp
      ? await encodeObject(context.layout, scope, schemaId, current.slug, stamped, existingBytes)
      : asSent;

    // Write, then snapshot the replaced state (held in memory), then index.
    // The write first: snapshotting first left a phantom history entry when
    // the write failed. Snapshot before the index update: the replacement
    // happened at the rename, and the index is rebuildable — an ingest failure
    // must not cost the history entry for a write that is already on disk.
    await (context.write ?? writeAtomic)(path, bytes);

    await snapshotReplaced({
      objectRoot: context.layout.objectRoot(scope, schemaId, current.slug),
      payload: current.body,
      source: change.source,
      reason: change.reason,
      keepPerObject: context.keepHistoryPerObject,
    });

    await ingestFile(context.db, context.layout, path);

    return {
      object: stamped,
      contentHash,
      path,
      slug: current.slug,
      scope,
      shadowed: current.shadowed,
    };
  });
}

/**
 * Restores an earlier version — **an ordinary write, not a special one**
 * ([02 §11.1](../../../docs/design/02-data-model.md)): it goes through `update`, so the
 * current state is snapshotted first and going back never destroys what you
 * were on. Restoring the state you are already on falls into the no-op rule
 * and records nothing.
 */
export async function restoreVersion(
  context: LibraryContext,
  handle: string,
  id: string,
  versionId: string,
  expectedHash: string,
  inKind?: PortableSchemaId,
): Promise<StoredObject> {
  const current = read(context, handle, id, inKind);
  if (current.scope === 'system') {
    throw new LibraryError('read-only', 'System library objects cannot be edited.');
  }

  const objectRoot = context.layout.objectRoot(
    userScope(handle),
    current.schemaId as PortableSchemaId,
    current.slug,
  );
  const record = (await listVersions(objectRoot)).find((version) => version.id === versionId);
  if (!record) {
    throw new LibraryError('not-found', `No version with id ${versionId}.`);
  }
  const payload = await readVersionPayload(objectRoot, record.digest);
  if (payload === null) {
    throw new LibraryError('not-found', `The payload for version ${versionId} is missing.`);
  }

  // No queue key taken here: `update` takes `obj:<id>` itself, and acquiring
  // it twice on one call path is a self-deadlock. The reads above are safe
  // unlocked (torn-tail-tolerant list, content-addressed payload); the hash
  // check inside `update` is what carries correctness. `stamp: false` because
  // restoring is not authoring — and because a stamp would change the restored
  // bytes, so restoring the state you are on would stop being a no-op.
  return update(context, handle, id, payload, expectedHash, {
    source: { kind: 'restore', fromVersionId: versionId },
    reason: 'Saved before restoring an earlier version',
    stamp: false,
  });
}

/**
 * The versions of an object, oldest first. Position is the revision number —
 * computed for display, never stored ([02 §11.5]).
 */
export async function versionsOf(
  context: LibraryContext,
  handle: string,
  id: string,
  inKind?: PortableSchemaId,
): Promise<{ current: IndexedObject; versions: VersionRecord[] }> {
  const current = read(context, handle, id, inKind);
  const scope = current.scope === 'system' ? SYSTEM_SCOPE : userScope(handle);
  const objectRoot = context.layout.objectRoot(
    scope,
    current.schemaId as PortableSchemaId,
    current.slug,
  );
  return { current, versions: await listVersions(objectRoot) };
}

/** One version's snapshotted object, by record id. */
export async function versionPayload(
  context: LibraryContext,
  handle: string,
  id: string,
  versionId: string,
  inKind?: PortableSchemaId,
): Promise<{ record: VersionRecord; object: unknown }> {
  const { current, versions } = await versionsOf(context, handle, id, inKind);
  const record = versions.find((version) => version.id === versionId);
  if (!record) {
    throw new LibraryError('not-found', `No version with id ${versionId}.`);
  }
  const scope = current.scope === 'system' ? SYSTEM_SCOPE : userScope(handle);
  const objectRoot = context.layout.objectRoot(
    scope,
    current.schemaId as PortableSchemaId,
    current.slug,
  );
  const object = await readVersionPayload(objectRoot, record.digest);
  if (object === null) {
    throw new LibraryError('not-found', `The payload for version ${versionId} is missing.`);
  }
  return { record, object };
}

/**
 * Renames (sets `reason`) or pins a version record ([05 §11.2a]).
 */
export async function amendVersion(
  context: LibraryContext,
  handle: string,
  id: string,
  versionId: string,
  patch: { reason?: string; pinned?: boolean },
  inKind?: PortableSchemaId,
): Promise<VersionRecord> {
  const current = read(context, handle, id, inKind);
  if (current.scope === 'system') {
    throw new LibraryError('read-only', 'System library objects cannot be edited.');
  }
  const objectRoot = context.layout.objectRoot(
    userScope(handle),
    current.schemaId as PortableSchemaId,
    current.slug,
  );
  const updated = await patchVersion(objectRoot, versionId, patch);
  if (!updated) {
    throw new LibraryError('not-found', `No version with id ${versionId}.`);
  }
  return updated;
}

/**
 * The raw stored bytes of an actor's card — the avatar the editor shows and
 * does not replace ([P1 §P1.7](../../../docs/design/workplan/03-p1-implementation.md)). Only
 * actors have pixels; any other kind is not-found rather than empty.
 */
export async function readCardPixels(
  context: LibraryContext,
  handle: string,
  id: string,
  inKind?: PortableSchemaId,
): Promise<{ bytes: Uint8Array; contentHash: string }> {
  const current = read(context, handle, id, inKind);
  if (current.schemaId !== ACTOR_SCHEMA) {
    throw new LibraryError('not-found', 'Only actors have a card image.');
  }
  await context.layout.assertReal(current.path);
  const bytes = await readFileBytes(current.path);
  if (bytes === null) {
    throw new LibraryError('not-found', 'The card file is missing from disk.');
  }
  return { bytes, contentHash: current.contentHash };
}

/**
 * Removes an object — by moving its folder, history and all, to the user's
 * trash. Deletion is a move, not an erasure ([02 §10.2]): the retention sweep
 * and a restore surface are P11's, but nothing should be unrecoverable in the
 * meantime, least of all the history whose whole purpose is recovering from a
 * regretted action.
 *
 * Also hash-checked: deleting something a second tab has since edited is the
 * same mistake as overwriting it, and rather more final.
 */
export async function remove(
  context: LibraryContext,
  handle: string,
  id: string,
  expectedHash: string,
  inKind?: PortableSchemaId,
): Promise<void> {
  return writes.run(`obj:${id}`, async () => {
    const current = read(context, handle, id, inKind);
    if (current.scope === 'system') {
      throw new LibraryError('read-only', 'System library objects cannot be deleted.');
    }
    if (current.contentHash !== expectedHash) {
      throw new LibraryError('stale', 'The object has changed since it was read.', current);
    }

    // Same disk verification as `update`: the index cannot vouch for a file a
    // hand edit touched moments ago, and a delete is the last place to guess.
    await context.layout.assertReal(current.path);
    const onDisk = await readFileBytes(current.path);
    if (onDisk === null || contentHashOf(onDisk) !== current.contentHash) {
      throw new LibraryError('stale', 'The object has changed on disk since it was read.', current);
    }

    const schemaId = current.schemaId as PortableSchemaId;
    await moveTree(
      context.layout.objectRoot(userScope(handle), schemaId, current.slug),
      context.layout.trashDestination(handle, schemaId, current.slug, uuidv7()),
    );
    removeFile(context.db, context.layout, current.path);
  });
}
