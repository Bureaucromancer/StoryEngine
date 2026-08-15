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
  validate,
} from '@storyengine/shared';

import { contentHashOf, ingestFile, removeFile } from './index-db/ingest.js';
import { findById, type IndexedObject, listObjects } from './index-db/query.js';
import { writeAtomic } from './storage/atomic.js';
import { envelope, pngCardCodec } from './storage/card/index.js';
import { readFileBytes, removeTree } from './storage/files.js';
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
 * ([13 §9](docs/design/13-schemas.md)): every portable object self-describes, so
 * nothing here enumerates kinds. Adding Campaign at 2.0 should not touch this
 * file.
 *
 * Three rules are enforced here rather than in the routes, because they are
 * properties of the *write path* and a route is only one caller of it:
 *
 * - **The server indexes its own writes synchronously**, so a `GET` after a
 *   `POST` reflects it ([02 §5.1.1](docs/design/02-data-model.md)). The watcher
 *   is for foreign writes and has no such guarantee, nor needs one.
 * - **Every read carries a content hash and every write must present one**
 *   ([04 §4.4](docs/design/04-server-multiuser-deployment.md)). A stale hash is
 *   rejected with the current object, so the caller can offer a choice rather
 *   than guess. It is also the only defence the hot-reload thesis has against
 *   silently eating a hand edit.
 * - **A rename is an ordinary write.** Changing `name` changes the field inside
 *   the file; the folder keeps the slug it was born with
 *   ([19 §1.1](docs/design/19-p1-implementation.md)). There is no rename route
 *   and there is nothing here that moves a directory.
 */

export class LibraryError extends Error {
  readonly code: 'not-found' | 'stale' | 'invalid' | 'read-only' | 'conflict';
  readonly current?: IndexedObject;

  constructor(code: LibraryError['code'], message: string, current?: IndexedObject) {
    super(message);
    this.name = 'LibraryError';
    this.code = code;
    if (current) this.current = current;
  }
}

export interface LibraryContext {
  db: DatabaseSync;
  layout: Layout;
  /** Retention cap for version history, from `history.keepPerObject` ([02 §11.3]). */
  keepHistoryPerObject: number;
}

export interface StoredObject {
  object: unknown;
  contentHash: string;
  path: string;
  slug: string;
  scope: LibraryScope;
  /** True when another file holds this id at an earlier path ([19 §1.2]). */
  shadowed: boolean;
}

/**
 * The scopes a request may read: the caller's own library and the system one.
 *
 * **`system/library/` is loaded and merged from P1**, shipped empty
 * ([19 §1.3](docs/design/19-p1-implementation.md)). The merge is a query rather
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

export function read(context: LibraryContext, handle: string, id: string): IndexedObject {
  const row = findById(context.db, id);
  if (!row || !readableScopes(handle).some((scope) => scopeKeyOf(scope) === row.scope)) {
    // Not-found rather than forbidden for another user's object: the handle is
    // the owner ([04 §4.3]), and confirming that an id exists elsewhere would
    // leak the one fact this separation exists to keep.
    throw new LibraryError('not-found', `No object with id ${id}.`);
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
 * ([02 §5.2](docs/design/02-data-model.md)).
 *
 * Encoding is separate from writing so the caller can apply the no-op rule
 * ([02 §11.1](docs/design/02-data-model.md)): a save that changes nothing must
 * produce neither a write nor a history entry, and the only honest way to know
 * is to build the exact bytes and compare.
 */
async function encodeObject(
  layout: Layout,
  scope: LibraryScope,
  schemaId: PortableSchemaId,
  slug: string,
  object: unknown,
): Promise<{ path: string; bytes: Uint8Array; contentHash: string }> {
  const path = layout.objectFile(scope, schemaId, slug);

  let bytes: Uint8Array;
  if (schemaId === ACTOR_SCHEMA) {
    const existing = await readFileBytes(path);
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
 * portrait as intended* ([02 §5.2.1](docs/design/02-data-model.md)) — what any
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
    );
  }
  return schemaId;
}

export async function create(
  context: LibraryContext,
  handle: string,
  object: unknown,
): Promise<StoredObject> {
  const schemaId = assertValidObject(object);
  const scope = userScope(handle);
  const id = (object as { id: string }).id;

  if (findById(context.db, id)) {
    throw new LibraryError('conflict', `An object with id ${id} already exists.`);
  }

  // The slug is derived here, once, and then frozen ([19 §1.1]). Nothing ever
  // resolves by it.
  const name =
    typeof (object as { name?: unknown }).name === 'string'
      ? (object as { name: string }).name
      : 'untitled';
  const slug = await resolveFreeSlug(context.layout.kindRoot(scope, schemaId), name);

  const { path, bytes, contentHash } = await encodeObject(
    context.layout,
    scope,
    schemaId,
    slug,
    object,
  );
  await writeAtomic(path, bytes);
  await ingestFile(context.db, context.layout, path);

  return { object, contentHash, path, slug, scope, shadowed: false };
}

/**
 * What made a change, threaded through to the version record. The route passes
 * `manual`; `restore` passes itself; the watcher stamps `external` on its own
 * path rather than through here.
 */
export interface ChangeAttribution {
  source: VersionSource;
  reason: string;
}

const MANUAL: ChangeAttribution = { source: { kind: 'manual' }, reason: '' };

/**
 * Replaces an object, checking the caller's hash first.
 *
 * `expectedHash` is what the caller last read. If the file has moved on — a
 * second tab, a hand edit, the file browser — the write is refused and the
 * *current* object comes back with the error, so the UI can offer reload-and-
 * reapply or save-as-a-copy rather than guessing
 * ([04 §4.4](docs/design/04-server-multiuser-deployment.md)).
 */
export async function update(
  context: LibraryContext,
  handle: string,
  id: string,
  object: unknown,
  expectedHash: string,
  change: ChangeAttribution = MANUAL,
): Promise<StoredObject> {
  const schemaId = assertValidObject(object);
  const current = read(context, handle, id);

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

  const scope = userScope(handle);
  const { path, bytes, contentHash } = await encodeObject(
    context.layout,
    scope,
    schemaId,
    current.slug,
    object,
  );

  // **The no-op rule** ([02 §11.1]). A write that changes nothing produces no
  // write and no version — without this, every round-trip through an editor
  // adds an identical history entry, and a restore to the current state
  // duplicates it. Byte equality, via the hash, is the honest comparison: it is
  // exactly what the next read would see.
  if (contentHash === current.contentHash) {
    return {
      object: current.body,
      contentHash,
      path,
      slug: current.slug,
      scope,
      shadowed: current.shadowed,
    };
  }

  // Snapshot the state being replaced, *then* write. Automatic, not requested
  // ([02 §11.1]) — the moment someone wants history is after the edit they
  // regret.
  await snapshotReplaced({
    objectRoot: context.layout.objectRoot(scope, schemaId, current.slug),
    payload: current.body,
    source: change.source,
    reason: change.reason,
    keepPerObject: context.keepHistoryPerObject,
  });

  await writeAtomic(path, bytes);
  await ingestFile(context.db, context.layout, path);

  return { object, contentHash, path, slug: current.slug, scope, shadowed: current.shadowed };
}

/**
 * Restores an earlier version — **an ordinary write, not a special one**
 * ([02 §11.1](docs/design/02-data-model.md)): it goes through `update`, so the
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
): Promise<StoredObject> {
  const current = read(context, handle, id);
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

  return update(context, handle, id, payload, expectedHash, {
    source: { kind: 'restore', fromVersionId: versionId },
    reason: 'Saved before restoring an earlier version',
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
): Promise<{ current: IndexedObject; versions: VersionRecord[] }> {
  const current = read(context, handle, id);
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
): Promise<{ record: VersionRecord; object: unknown }> {
  const { current, versions } = await versionsOf(context, handle, id);
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
): Promise<VersionRecord> {
  const current = read(context, handle, id);
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
 * does not replace ([19 §P1.7](docs/design/19-p1-implementation.md)). Only
 * actors have pixels; any other kind is not-found rather than empty.
 */
export async function readCardPixels(
  context: LibraryContext,
  handle: string,
  id: string,
): Promise<{ bytes: Uint8Array; contentHash: string }> {
  const current = read(context, handle, id);
  if (current.schemaId !== ACTOR_SCHEMA) {
    throw new LibraryError('not-found', 'Only actors have a card image.');
  }
  const bytes = await readFileBytes(current.path);
  if (bytes === null) {
    throw new LibraryError('not-found', 'The card file is missing from disk.');
  }
  return { bytes, contentHash: current.contentHash };
}

/**
 * Removes an object.
 *
 * Also hash-checked: deleting something a second tab has since edited is the
 * same mistake as overwriting it, and rather more final.
 */
export async function remove(
  context: LibraryContext,
  handle: string,
  id: string,
  expectedHash: string,
): Promise<void> {
  const current = read(context, handle, id);
  if (current.scope === 'system') {
    throw new LibraryError('read-only', 'System library objects cannot be deleted.');
  }
  if (current.contentHash !== expectedHash) {
    throw new LibraryError('stale', 'The object has changed since it was read.', current);
  }

  await removeTree(
    context.layout.objectRoot(
      userScope(handle),
      current.schemaId as PortableSchemaId,
      current.slug,
    ),
  );
  removeFile(context.db, current.path);
}
