// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { basename, dirname, join } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { deflateSync } from 'node:zlib';

import encodeChunks from 'png-chunks-encode';

import {
  ACTOR_SCHEMA,
  isKnownSchema,
  LIBRARY_DIRECTORIES,
  mediaRowsIn,
  type PortableSchemaId,
  schemaIdOf,
  upgradeLegacySchema,
  uuidv7,
  validate,
  type ValidationIssue,
} from '@storyengine/shared';

import {
  acceptObject,
  contentHashOf,
  type FileErrorReason,
  ingestFile,
  listFileErrors,
  removeFile,
} from './index-db/ingest.js';
import {
  findById,
  findByIdAt,
  findByName,
  type IndexedObject,
  listObjects,
  rowsForId,
} from './index-db/query.js';
import { writeAtomic } from './storage/atomic.js';
import { codecFor, envelope, pngCardCodec } from './storage/card/index.js';
import { readAsset } from './library/assets.js';
import type { BlobStore } from './storage/card/envelope.js';
import { fileExists, moveTree, readFileBytes, renamePath } from './storage/files.js';
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
  type LibraryOwner,
  resolveFreeFolder,
  resolveFreeSlug,
  SYSTEM_OWNER,
  userOwner,
} from './storage/layout.js';

/**
 * Library CRUD, one handler set rather than six.
 *
 * **The registry is what makes this kind-agnostic**
 * ([04 §9](../../../docs/design/04-schemas.md)): every portable object self-describes, so
 * nothing here enumerates kinds. Adding Campaign at 2.0 should not touch this
 * file.
 *
 * Three rules are enforced here rather than in the routes, because they are
 * properties of the *write path* and a route is only one caller of it:
 *
 * - **The server indexes its own writes synchronously**, so a `GET` after a
 *   `POST` reflects it ([03 §5.1.1](../../../docs/design/03-data-model.md)). The watcher
 *   is for foreign writes and has no such guarantee, nor needs one.
 * - **Every read carries a content hash and every write must present one**
 *   ([09 §4.4](../../../docs/design/09-server-multiuser-deployment.md)). A stale hash is
 *   rejected with the current object, so the caller can offer a choice rather
 *   than guess. It is also the only defence the hot-reload thesis has against
 *   silently eating a hand edit.
 * - **A rename is an ordinary write.** Changing `name` changes the field inside
 *   the file; the folder keeps the slug it was born with
 *   ([P1 §1.1](../../../docs/design/workplan/07-p1-implementation.md)). There is no rename route
 *   and there is nothing here that moves a directory.
 *
 *   ***~~Nothing here moves a directory~~ — one thing does, from
 *   [P16.0](../../../docs/design/workplan/35-p16-world.md) (2026-10-10).*** The
 *   first write to a World still in the kind's old folder or under its old file
 *   name — a Package made before the rename — moves its folder to
 *   `library/worlds/`, history and assets with it, under the slug it had when
 *   that is free and a numeric suffix when a World made since holds it
 *   ({@link relocateLegacy}). It is a migration finishing rather than a rename:
 *   a name change still moves nothing, and nor does any write to an object in
 *   its kind's own folder.
 */

export class LibraryError extends Error {
  readonly code:
    | 'not-found'
    | 'stale'
    | 'invalid'
    | 'read-only'
    | 'conflict'
    | 'refused-path'
    /**
     * The file on disk no longer hashes to what the index recorded, and the
     * index has not caught up — usually because the file was hand-edited into
     * something `ingestFile` refuses, so the row will never update.
     *
     * **A separate code because `stale` was a trap here** (P2C finding 8). The
     * 412 contract is *reload and reapply*, and reloading serves the index row,
     * whose hash is the one the caller just presented — so the documented
     * recovery could not terminate, and neither could a delete. This answers
     * 409 instead: not a retry instruction, so no loop can form, and the
     * message names the repair, which is the file rather than the request.
     */
    | 'diverged';
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
  /** Retention cap for version history, from `history.keepPerObject` ([03 §11.3]). */
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
  owner: LibraryOwner;
  /** True when another file holds this id at an earlier path ([P1 §1.2]). */
  shadowed: boolean;
}

/**
 * The owners a request may read: the caller's own library and the system one.
 *
 * **`system/library/` is loaded and merged from P1**, shipped empty
 * ([P1 §1.3](../../../docs/design/workplan/07-p1-implementation.md)). The merge is a query rather
 * than a special case, and retrofitting it into every list endpoint later is the
 * annoying version — so it lands now, with nothing in it.
 */
export function readableOwners(handle: string): LibraryOwner[] {
  return [userOwner(handle), SYSTEM_OWNER];
}

export function list(
  context: LibraryContext,
  handle: string,
  schemaId?: PortableSchemaId,
): IndexedObject[] {
  return listObjects(context.db, {
    owners: readableOwners(handle),
    ...(schemaId ? { schemaId } : {}),
  });
}

/**
 * A file that is in an object's place and cannot be read as one — F20.
 *
 * The reason this is a *read* rather than a log line: the failure belongs to the
 * person who made the edit, and they are looking at the app, not at the server's
 * stdout. [03 §5.1](../../../docs/design/03-data-model.md) promises that hand-editing is
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
  const owners = readableOwners(handle).map(ownerKeyOf);
  return listFileErrors(context.db, owners).map((row) => ({
    // A row whose path escaped the root is not addressable by a client, and
    // silently rewriting it to something that looks relative would be worse
    // than admitting the path is unknown.
    path: context.layout.portablePath(row.path) ?? '(outside the data directory)',
    source: row.owner === 'system' ? ('system' as const) : ('user' as const),
    kind: row.schemaId,
    slug: row.slug,
    reason: row.reason,
    detail: row.detail,
    seenAt: row.seenAt,
  }));
}

/**
 * The index rows for an id, as the panel shows them — [P3.3]'s projection,
 * with [P3 §7.4](../../../docs/design/workplan/15-p3-implementation.md) decided
 * 2026-08-27: **every row the index holds for the id**, shadowed and
 * tombstoned included, and the projection is **best-effort rather than a
 * contract** — it restates the derived index, whose tables stay an
 * implementation detail ([22 §5](../../../docs/design/22-internal-contracts.md)),
 * so after an index schema bump it may return less until this surface
 * catches up.
 *
 * Paths are portable (F22): the client needs to know *which folder*, not
 * where the server keeps its disk. That is also what lets this surface
 * *name the winning path* — the winner of a duplicated id is decided by
 * ordering over exactly this string (F23), so the rows are sorted by the
 * very value the mechanism compares, winner first.
 */
export interface ProjectedIndexRow {
  path: string;
  source: 'user' | 'system';
  slug: string;
  name: string;
  schema: string;
  contentHash: string;
  shadowed: boolean;
  tombstonedAt: number | null;
}

export function indexRows(
  context: LibraryContext,
  handle: string,
  id: string,
  inKind: PortableSchemaId,
): ProjectedIndexRow[] {
  const readable = new Set(readableOwners(handle).map(ownerKeyOf));
  const rows = rowsForId(context.db, id).filter((row) => readable.has(row.owner));
  if (rows.length === 0) {
    // The same anti-leak posture as read(): rows in somebody else's library
    // were filtered before this check, so a foreign id and an absent id are
    // one answer.
    throw new LibraryError('not-found', `No object with id ${id}.`);
  }
  const inKindRows = rows.filter((row) => row.schemaId === inKind);
  if (inKindRows.length === 0) {
    throw new LibraryError('not-found', `No object with id ${id} in that kind.`);
  }
  return inKindRows
    .map((row) => ({
      row,
      // The F22 fallback fileErrors already uses: a row outside the root has
      // no portable address, and inventing one would be worse than saying so.
      portable: context.layout.portablePath(row.path) ?? '(outside the data directory)',
    }))
    .sort((a, b) => (a.portable < b.portable ? -1 : a.portable > b.portable ? 1 : 0))
    .map(({ row, portable }) => ({
      path: portable,
      source: row.owner === 'system' ? ('system' as const) : ('user' as const),
      slug: row.slug,
      name: row.name,
      schema: row.schemaId,
      contentHash: row.contentHash,
      shadowed: row.shadowed,
      tombstonedAt: row.tombstonedAt,
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
 * owner check below exists to avoid.
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
  if (!row || !readableOwners(handle).some((owner) => ownerKeyOf(owner) === row.owner)) {
    // Not-found rather than forbidden for another user's object: the handle is
    // the owner ([09 §4.3]), and confirming that an id exists elsewhere would
    // leak the one fact this separation exists to keep.
    throw new LibraryError('not-found', `No object with id ${id}.`);
  }
  if (inKind !== undefined && row.schemaId !== inKind) {
    throw new LibraryError('not-found', `No object with id ${id} in that kind.`);
  }
  return row;
}

/**
 * A `Ref` resolved the way every document says refs resolve: **exact id, then
 * case-insensitive name, then missing — and never blocking.**
 *
 * That sentence is written in three places — `schema/common.ts`'s own
 * description of `Ref`, [03 §11.4](../../../docs/design/03-data-model.md), and
 * [04 §8](../../../docs/design/04-schemas.md) — and until [P5.6] it was
 * implemented in none, because nothing on the server had ever followed a `Ref`.
 * The session's lorebook links are the first, so the promise comes due here.
 *
 * **The fallback is not a nicety; it is the whole reason imports work.** An
 * imported treatment arrives carrying refs minted by whatever produced it, and
 * the books it names were imported as separate objects with ids of ours. Every
 * one of those ids is a miss. Without the name arm, an imported treatment
 * resolves to zero books, the prompt is quietly smaller, and nothing anywhere
 * says why — which is [00 §3.3]'s failure mode stated exactly.
 *
 * Returns null rather than throwing, because *show as missing and continue* is
 * the documented third step and a caller that wanted an exception would be
 * asking this function to break the contract it exists to keep.
 */
export function resolveRef(
  context: LibraryContext,
  handle: string,
  ref: { id?: unknown; name?: unknown },
  inKind: PortableSchemaId,
): IndexedObject | null {
  const id = typeof ref.id === 'string' ? ref.id : null;
  if (id !== null && id !== '') {
    try {
      return read(context, handle, id, inKind);
    } catch (error) {
      // A `not-found` falls through to the name arm; anything else is a real
      // failure and belongs to the caller, not to a swallow.
      if (!(error instanceof LibraryError) || error.code !== 'not-found') throw error;
    }
  }

  const name = typeof ref.name === 'string' ? ref.name : null;
  if (name === null || name === '') return null;
  return findByName(context.db, name, {
    owners: readableOwners(handle).map((owner) => ownerKeyOf(owner)),
    schemaId: inKind,
  });
}

function readAt(
  context: LibraryContext,
  handle: string,
  id: string,
  inKind: PortableSchemaId | undefined,
  at: ObjectAddress,
): IndexedObject {
  const owner = at.source === 'system' ? SYSTEM_OWNER : userOwner(handle);
  const row = findByIdAt(context.db, id, { owner: ownerKeyOf(owner), slug: at.slug });
  if (!row || (inKind !== undefined && row.schemaId !== inKind)) {
    // The same answer as an id that does not exist. An address that named
    // somebody else's library would resolve under this user's owner and find
    // nothing, which is the containment rule doing its job rather than a
    // separate check to remember.
    throw new LibraryError('not-found', `No object with id ${id} at that address.`);
  }
  return row;
}

function ownerKeyOf(owner: LibraryOwner): string {
  return owner.kind === 'system' ? 'system' : `user:${owner.handle}`;
}

/**
 * Serialises an object the way its kind is stored, without writing anything.
 *
 * The actor is the only kind that is not plain JSON, and the card is spliced
 * into whatever pixels are already there — never re-encoded
 * ([03 §5.2](../../../docs/design/03-data-model.md)).
 *
 * Encoding is separate from writing so the caller can apply the no-op rule
 * ([03 §11.1](../../../docs/design/03-data-model.md)): a save that changes nothing must
 * produce neither a write nor a history entry, and the only honest way to know
 * is to build the exact bytes and compare.
 *
 * ***Exported at [P7B.0], for the one caller outside this module.***
 * [system-library.ts](./system-library.ts) writes each loaded mode's default
 * pack into the system scope at boot, and it has to produce **byte-identical
 * output to the request path** or every restart would look like an edit to the
 * watcher, the index and the history. Spelling the encoding a second time is
 * exactly how the two would drift, and the drift would be silent — a JSON file
 * that differs by a trailing newline is a file that rewrites itself forever.
 * Nothing else about the create path is reusable there: `create` resolves a
 * free slug, claims an id and refuses a duplicate, and a materialiser does the
 * opposite of all three on purpose.
 */
export async function encodeObject(
  layout: Layout,
  owner: LibraryOwner,
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
  /**
   * Pixels to build a *new* card on, when the caller has some — the imported
   * card's own image ([P4 §1.3]). Distinct from `existingBytes`, which is about
   * a file that is already there: at create time there is no file, and this is
   * a canvas the caller supplied rather than one that was read.
   */
  canvasBytes?: Uint8Array,
  /**
   * Blobs the caller brought, merged over the source card's own — [P7.10].
   * Media that arrived beside a card rather than inside it: an imported
   * expression set is the shipped case.
   */
  extraBlobs?: BlobStore,
): Promise<{ path: string; bytes: Uint8Array; contentHash: string }> {
  const path = layout.objectFile(owner, schemaId, slug);

  // The write path's door (F1). Lexically this path is already safe; what the
  // string cannot say is whether a directory along it is a link out of the data
  // root. Checked here rather than at each caller because every write — create,
  // update, restore — is encoded through this function first.
  await layout.assertReal(path);

  let bytes: Uint8Array;
  if (schemaId === ACTOR_SCHEMA) {
    const existing = existingBytes !== undefined ? existingBytes : await readFileBytes(path);
    // Whichever real image we have: the file's own, or a canvas the caller
    // brought. Only when there is neither does an actor get the 1×1 blank.
    const source = existing ?? canvasBytes ?? null;
    const canvas = source ?? blankCardPixels();
    const contents = source ? pngCardCodec.read(source) : null;
    // The card's own blobs first, then the caller's over them — so a re-import
    // that brings the same expression twice writes it once, and a card that
    // already embedded a set keeps everything the new one does not name.
    const carried =
      extraBlobs === undefined
        ? contents?.blobs
        : new Map([...(contents?.blobs ?? []), ...extraBlobs]);
    bytes = pngCardCodec.write(canvas, envelope(object), carried);
  } else {
    bytes = new TextEncoder().encode(`${JSON.stringify(object, null, 2)}\n`);
  }

  return { path, bytes, contentHash: contentHashOf(bytes) };
}

/**
 * The pixels a brand-new card starts with: 1×1, fully transparent.
 *
 * Deliberately not a generated placeholder portrait. The card's pixels are *the
 * portrait as intended* ([03 §5.2.1](../../../docs/design/03-data-model.md)) — what any
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

export function blankCardPixels(): Uint8Array {
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

/**
 * Pixels for a new actor's card, from an import.
 *
 * **A parameter on `create()`, deliberately, rather than a second write path**
 * ([P4 §1.3]). Import needs an actor whose card carries the image it came with,
 * and `create()` had no way to say so — a new actor got the 1×1 transparent
 * blank and nothing accepted a canvas. The alternative was an importer that
 * wrote the file itself, which would have bypassed the kind queue, the
 * id-conflict check, `writeAtomic` and the synchronous ingest that makes
 * read-after-write hold ([22 §5]). Those four are not incidental to `create()`;
 * they are what it is.
 *
 * The codec splices our envelope into the pixels and never re-encodes them, so
 * an imported card keeps its image exactly — and keeps its foreign chunks,
 * including the legacy `chara`/`ccv3` payload. That last part is a decision
 * rather than an accident: stripping it would destroy the file's validity as a
 * SillyTavern card, which is somebody else's data. The cost — other tools keep
 * reading a payload that no longer moves when ours does — is accepted and named
 * per object in the review ([P4 §1.3]).
 */
export interface CreateFrom {
  cardPixels: Uint8Array;
  /**
   * Extra media bytes to carry into the card, keyed by the `ref` an
   * `EmbeddedMedia` entry on the object names — [03 §5.2.2], [P7.10].
   *
   * **The caller builds the manifest; this carries the bytes.** `EmbeddedMedia`
   * is *"a reference to bytes carried by the container"*, so the two halves are
   * written by different people: the importer decides what an expression is
   * called and what role it has, and the container is what a `ref` resolves in.
   * Merged over whatever `cardPixels` already carried, so re-importing a card
   * that has its own embedded set adds to it rather than replacing it.
   */
  media?: BlobStore;
}

/**
 * The hash an object *would* have if it were stored, without storing it.
 *
 * Exposed for import's re-import identity rule ([P4 §1.3]), which has to answer
 * *is this byte-identical to what is already here* before deciding whether to
 * write at all. `encodeObject` is the only honest way to know, because it is
 * what the write path itself would produce — a structural comparison would
 * answer about the objects rather than about the files.
 */
export async function encodeForCompare(
  context: LibraryContext,
  owner: LibraryOwner,
  schemaId: PortableSchemaId,
  slug: string,
  object: unknown,
): Promise<string> {
  const { contentHash } = await encodeObject(context.layout, owner, schemaId, slug, object);
  return contentHash;
}

export async function create(
  context: LibraryContext,
  handle: string,
  object: unknown,
  inKind?: PortableSchemaId,
  from?: CreateFrom,
): Promise<StoredObject> {
  // A body in a kind's old name is written as the kind ([P16 §1.1]): every
  // write writes the new form, whoever sent the old one.
  object = upgradeLegacySchema(object);
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
  const owner = userOwner(handle);
  const kindRoot = context.layout.kindRoot(owner, schemaId);

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

    if (from !== undefined) {
      if (schemaId !== ACTOR_SCHEMA) {
        throw new LibraryError('invalid', 'Only an actor is stored as a card.');
      }
      if (codecFor(from.cardPixels) === null) {
        // Sniffed by magic number, so a JPEG named `.png` lands here rather
        // than inside the codec ([storage/card]). The importer should have
        // sniffed already; this is the door refusing rather than the parser
        // throwing.
        throw new LibraryError('invalid', 'The card image is not a format this build can write.');
      }
    }

    const { path, bytes, contentHash } = await encodeObject(
      context.layout,
      owner,
      schemaId,
      slug,
      object,
      undefined,
      from?.cardPixels,
      from?.media,
    );
    await (context.write ?? writeAtomic)(path, bytes);
    await ingestFile(context.db, context.layout, path);

    return { object, contentHash, path, slug, owner, shadowed: false };
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
   * remembering to stamp ([22 §1.6]). Restore turns it off — restoring is not
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
 * ([09 §4.4](../../../docs/design/09-server-multiuser-deployment.md)).
 */
export async function update(
  context: LibraryContext,
  handle: string,
  id: string,
  object: unknown,
  expectedHash: string,
  change: ChangeAttribution = MANUAL,
  inKind?: PortableSchemaId,
  /**
   * ***Pictures a replacing import brings*** (2026-09-27), merged over the
   * card's own as `create`'s `media` is.
   *
   * **The canvas stays the one on disk.** An actor's history keeps its JSON
   * and not its pixels, so a replace that swapped the portrait would destroy
   * the one somebody had with nothing to restore it from. Adding blobs
   * destroys nothing, and it is what makes an incoming `media` row resolve:
   * before this, a replace wrote rows naming pictures this card had never
   * held, and each answered *the bytes are missing*.
   */
  extraBlobs?: BlobStore,
): Promise<StoredObject> {
  // The same door as `create`'s ([P16 §1.1]), and here it matters more: a
  // version restored from a history written before the rename holds the old
  // id, and this is the path a restore writes through.
  object = upgradeLegacySchema(object);
  const schemaId = assertValidObject(object);

  // Everything from the hash check to the write runs on the object's queue —
  // a second writer through the same server waits its turn and then fails the
  // check honestly, instead of racing through the awaits and winning silently.
  return writes.run(`obj:${id}`, async () => {
    const current = read(context, handle, id, inKind);

    if (current.owner === 'system') {
      // App-shipped and read-only; an update would be overwritten by the next
      // release anyway ([10 §4.2]). Copy-to-my-library is the intended move.
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
    if (existingBytes === null) {
      // Vanished underneath: stale rather than not-found, so the caller keeps
      // the 412 recovery path instead of a dead end. This one terminates — the
      // watcher drops the row and the next read is an honest 404.
      throw new LibraryError('stale', 'The object has changed on disk since it was read.', current);
    }
    const onDiskHash = contentHashOf(existingBytes);
    if (onDiskHash !== current.contentHash) {
      /**
       * **P2C finding 8, and the two cases it used to answer identically.**
       *
       * Both are "the file is not what the index thinks", and both used to be
       * `stale` carrying the index row — whose hash is the one the caller just
       * presented. So reload-and-reapply could not terminate, and neither could
       * a delete: three successive 412s with a byte-identical hash, and a text
       * editor as the only exit.
       *
       * They are not the same situation and now do not get the same answer:
       *
       * - **A readable edit the index has not caught up with** — somebody
       *   saved valid JSON in a text editor moments ago. Transient; the watcher
       *   will settle. Still `stale`, because reload-and-reapply is exactly the
       *   right move — but the envelope now describes **the file** rather than
       *   the stale row, so the caller can act on it immediately instead of
       *   waiting out the settle window. That the hash differs from the one
       *   presented is what makes the 412 answerable at all.
       * - **Bytes the loader refuses** — the hand edit that broke the file.
       *   No retry fixes it, so it is not dressed as one: `409 diverged`, with
       *   no envelope, because handing back the stale row is what invited the
       *   loop. It is already listed by `GET /library/errors`, which is where
       *   the repair starts.
       */
      const onDiskBody = decodeOnDisk(context, current.path, existingBytes);

      if (onDiskBody === null) {
        throw new LibraryError(
          'diverged',
          'The file on disk does not match the library index and could not be read. It was changed outside the app — repair or delete the file.',
        );
      }

      throw new LibraryError('stale', 'The object has changed on disk since it was read.', {
        ...current,
        contentHash: onDiskHash,
        body: onDiskBody,
      });
    }

    const owner = userOwner(handle);
    const asSent = await encodeObject(
      context.layout,
      owner,
      schemaId,
      current.slug,
      object,
      existingBytes,
      undefined,
      extraBlobs,
    );

    // **The no-op rule** ([03 §11.1]). A write that changes nothing produces no
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
        // Where the object is, which a World still under its old name is not
        // where `encodeObject` would put it ([P16 §1.1]). A no-op moves nothing.
        path: current.path,
        slug: current.slug,
        owner,
        shadowed: current.shadowed,
      };
    }

    const stamp = change.stamp !== false;
    const stamped = stamp ? stampProvenance(object) : object;
    const { path, bytes, contentHash } = stamp
      ? await encodeObject(
          context.layout,
          owner,
          schemaId,
          current.slug,
          stamped,
          existingBytes,
          undefined,
          extraBlobs,
        )
      : asSent;

    /**
     * ***A World still under its old folder or file name*** — [P16 §1.1].
     * `encodeObject` named the path the kind's *current* layout gives this slug,
     * `worlds/<slug>/world.json`, and for an object that lives in `packages/`
     * that is not where it is: it may be nothing, or it may be **another World**
     * made after the upgrade under the same name, whose file this write would
     * have replaced. So the bytes go where the object is, and the move follows.
     */
    const legacy = context.layout.parseObjectPath(current.path)?.legacy === true;
    const writtenAt = legacy ? current.path : path;

    // Write, then snapshot the replaced state (held in memory), then index.
    // The write first: snapshotting first left a phantom history entry when
    // the write failed. Snapshot before the index update: the replacement
    // happened at the rename, and the index is rebuildable — an ingest failure
    // must not cost the history entry for a write that is already on disk.
    await (context.write ?? writeAtomic)(writtenAt, bytes);

    // The folder the object is in, which is not always the one its kind and
    // slug would name ([P16 §1.1]); a legacy object's history is snapshotted
    // where it is and travels with the folder below.
    await snapshotReplaced({
      objectRoot: context.layout.folderOf(current.path),
      payload: current.body,
      source: change.source,
      reason: change.reason,
      keepPerObject: context.keepHistoryPerObject,
    });

    const landed = legacy
      ? await relocateLegacy(context, owner, schemaId, current.path)
      : { path, slug: current.slug };

    await ingestFile(context.db, context.layout, landed.path);

    return {
      object: stamped,
      contentHash,
      path: landed.path,
      slug: landed.slug,
      owner,
      shadowed: current.shadowed,
    };
  });
}

/**
 * ***The first write's move*** — [P16 §1.1](../../../docs/design/workplan/35-p16-world.md),
 * and the one place this engine moves a user's directory.
 *
 * Called with the new bytes already written over the legacy file in place and
 * the replaced state already in that folder's history, so **every state this
 * can stop in is a World that reads**, which is the whole design of the order:
 *
 * 1. *(done by the caller)* `packages/<slug>/package.json` holds the new body.
 * 2. The folder moves to `worlds/<free>` — one rename, history and assets with
 *    it. The layout reads `package.json` in `worlds/` as well as in `packages/`
 *    precisely so that stopping here is not a vanished World.
 * 3. The file is renamed `world.json` — one rename.
 *
 * **The slug is kept when it is free in `worlds/` and suffixed when it is not**
 * ({@link resolveFreeFolder}): slugs are allocated per kind folder, so a World
 * made after the upgrade may already be `worlds/rain-city` while this one waits
 * in `packages/rain-city`, and the move must neither fail nor land on it. The id
 * goes unchanged, and the id is what everything addresses. The free name is
 * found and claimed on **the kind's create queue**, inside the object's own —
 * a create of a World named the same, racing this move, would otherwise resolve
 * the same free name, and a POSIX rename onto an empty directory succeeds
 * without a word. *Nesting is safe because nothing takes an object's queue from
 * inside a kind's.*
 *
 * **A folder already in `worlds/` holding the old file name** — a move that
 * stopped after step 2, a restore, a hand copy — skips the folder move and only
 * renames the file. **And a `world.json` already beside it** is left alone: the
 * index is showing the two as one id twice, and renaming over one would destroy
 * the other to tidy a name. The World stays readable under the old name, and the
 * duplicate is the person's to resolve where the library already shows it.
 */
async function relocateLegacy(
  context: LibraryContext,
  owner: LibraryOwner,
  schemaId: PortableSchemaId,
  legacyPath: string,
): Promise<{ path: string; slug: string }> {
  const kindRoot = context.layout.kindRoot(owner, schemaId);
  const legacyFolder = context.layout.folderOf(legacyPath);

  // The layout already accepted this path, so its parent's name is a kind
  // folder, current or legacy, and that name is the whole question.
  const inKindFolder = basename(dirname(legacyFolder)) === LIBRARY_DIRECTORIES[schemaId];
  const folder = inKindFolder
    ? legacyFolder
    : await writes.run(`kind:${kindRoot}`, async () => {
        const slug = await resolveFreeFolder(kindRoot, basename(legacyFolder));
        const destination = context.layout.objectRoot(owner, schemaId, slug);
        await moveTree(legacyFolder, destination);
        return destination;
      });

  const slug = basename(folder);
  const target = context.layout.objectFile(owner, schemaId, slug);
  const carried = join(folder, basename(legacyPath));
  if (basename(legacyPath) === basename(target)) return { path: target, slug };
  if (await fileExists(target)) return { path: carried, slug };
  await renamePath(carried, target);
  return { path: target, slug };
}

/**
 * Restores an earlier version — **an ordinary write, not a special one**
 * ([03 §11.1](../../../docs/design/03-data-model.md)): it goes through `update`, so the
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
  if (current.owner === 'system') {
    throw new LibraryError('read-only', 'System library objects cannot be edited.');
  }

  // The folder the object is in — its history is there ([P16 §1.1]).
  const objectRoot = context.layout.folderOf(current.path);
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
 * computed for display, never stored ([03 §11.5]).
 */
export async function versionsOf(
  context: LibraryContext,
  handle: string,
  id: string,
  inKind?: PortableSchemaId,
): Promise<{ current: IndexedObject; versions: VersionRecord[] }> {
  const current = read(context, handle, id, inKind);
  // Where the object is rather than where its kind and slug would put it: a
  // World still in `packages/` has its history there, and `worlds/<slug>` may
  // be another World's ([P16 §1.1]).
  return { current, versions: await listVersions(context.layout.folderOf(current.path)) };
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
  const object = await readVersionPayload(context.layout.folderOf(current.path), record.digest);
  if (object === null) {
    throw new LibraryError('not-found', `The payload for version ${versionId} is missing.`);
  }
  // A version taken before the rename holds the old id, and stays in the
  // history for good after the move: read as the kind it is ([P16 §1.1]), so a
  // viewer and a diff only ever see the World.
  return { record, object: upgradeLegacySchema(object) };
}

/**
 * Renames (sets `reason`) or pins a version record ([10 §11.2a]).
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
  if (current.owner === 'system') {
    throw new LibraryError('read-only', 'System library objects cannot be edited.');
  }
  // Not a write of the object, so it moves nothing; it reaches the history
  // where the object is ([P16 §1.1]).
  const updated = await patchVersion(context.layout.folderOf(current.path), versionId, patch);
  if (!updated) {
    throw new LibraryError('not-found', `No version with id ${versionId}.`);
  }
  return updated;
}

/**
 * The raw stored bytes of an actor's card — the avatar the editor shows and
 * does not replace ([P1 §P1.7](../../../docs/design/workplan/07-p1-implementation.md)). Only
 * actors have pixels; any other kind is not-found rather than empty.
 */
export async function readCardPixels(
  context: LibraryContext,
  handle: string,
  id: string,
  inKind?: PortableSchemaId,
  /**
   * ***Which copy*** (2026-09-28), as `read` takes it: a download of a shadowed
   * copy's card hands over that copy's file, not the winner's.
   */
  address?: ObjectAddress,
): Promise<{ bytes: Uint8Array; contentHash: string }> {
  const current = read(context, handle, id, inKind, address);
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
 * One embedded media entry's bytes — [03 §5.2.2], built at
 * [P7.10](../../../docs/design/workplan/23-p7-implementation.md).
 *
 * ***The route that had to exist before anything could show a picture.***
 * {@link readCardPixels} above serves the card's *own* pixels, which is the one
 * image path this build has had since P1 — and an actor's expression set, a
 * treatment's cover and an authored backdrop are all `EmbeddedMedia`, which
 * nothing could serve at all. [06 §7.2]'s sprites and [06 §10.1a]'s authored
 * backdrop both stopped here.
 *
 * **A manifest entry plus a container lookup, which is what `EmbeddedMedia`
 * says it is.** [04 §3] makes it *"a **reference** to bytes carried by the
 * container, never the bytes themselves"*, so this reads the card, asks the
 * codec for the blob store, and resolves the entry's `ref` in it. A `ref` with
 * no blob is not-found rather than empty: the manifest and the container
 * disagreeing is a broken file, and [03 §5.2.2] names the way that happens —
 * *"ancillary chunks are droppable by spec-compliant tools that do not
 * understand them"*.
 *
 * ***`digest` is the cache key and `contentHash` is not***, which is the one
 * decision here that is not obvious. A card's content hash changes when any
 * field of the object changes; the bytes of one expression do not. Keying the
 * etag on the object would re-fetch every sprite whenever somebody edited a
 * line of the character's description — which on a VN-shaped session is every
 * turn's worth of pictures, thrown away for a text edit.
 *
 * *Any kind, unlike the avatar above.* An actor is the first carrier and not
 * the only one: [04 §3] puts `media` on treatments, lorebooks and Worlds too,
 * and a route that named actors would have to grow a second arm for the first
 * one of those to get a picture. Which is [P9]'s, and is the same lookup.
 */
export async function readMedia(
  context: LibraryContext,
  handle: string,
  id: string,
  mediaId: string,
  inKind?: PortableSchemaId,
): Promise<{ bytes: Uint8Array; mime: string; digest: string }> {
  const current = read(context, handle, id, inKind);

  /**
   * ***Every row in the object, not only the top-level array*** — [10 §11.2b]
   * gives a lorebook a gallery **and** every one of its entries a strip, so a
   * lookup that read `body.media` alone could serve the book's maps and none of
   * the pictures beside the entries. `mediaRowsIn` is the same walk the asset
   * sweep uses, which is what keeps *served* and *kept* from drifting apart.
   */
  const entry = mediaRowsIn(current.body).find((one) => one.id === mediaId);
  if (entry === undefined) {
    throw new LibraryError('not-found', 'No such media on that object.');
  }

  await context.layout.assertReal(current.path);
  const bytes = await readFileBytes(current.path);
  if (bytes === null) {
    throw new LibraryError('not-found', 'The card file is missing from disk.');
  }

  const codec = codecFor(bytes);
  if (codec === null) {
    /**
     * ***The folder container*** — [03 §5.2.3], [10 §11.2b], built at P11.
     *
     * A lorebook is `lorebook.json` in a folder, so `codecFor` finds no magic
     * number and this arm used to end at *"that object is not in a container
     * that carries media"* — which made §11.2b's *"the book gets a gallery"*
     * **unreachable** rather than merely unbuilt, a distinction that only shows
     * up when somebody tries. [04 §5]'s own note had already said where the
     * bytes go: *"bulk, in the folder rather than the manifest … a layout that
     * already listed `lorebooks/<slug>/lorebook.json + assets/`"*.
     *
     * `library/assets.ts` is that container's whole implementation, and the
     * `ref` resolves the same way a blob id does: literally, within the object's
     * own folder and never out of it.
     */
    const beside = await readAsset(context, handle, id, entry.ref, inKind);
    if (beside === null) {
      throw new LibraryError('not-found', 'The media is named but its bytes are missing.');
    }
    return { bytes: beside, mime: entry.mime, digest: entry.digest };
  }

  const blob = codec.read(bytes).blobs.get(entry.ref);
  if (blob === undefined) {
    // The manifest names a blob the container does not hold. A broken file
    // rather than an empty one, and [03 §5.2.2] names how it gets that way.
    throw new LibraryError('not-found', 'The media is named but its bytes are missing.');
  }

  return { bytes: blob, mime: entry.mime, digest: entry.digest };
}

/**
 * The object a file currently holds, or `null` when the loader will not have it.
 *
 * The distinction the write paths need after P2C finding 8: *the file changed*
 * and *the file broke* are different situations, and answering both the same
 * way is what left a broken object neither writable nor deletable. Anything
 * that throws, decodes to nothing, or sits at a path the layout does not
 * recognise is the second case.
 *
 * ***And anything the index would refuse*** (2026-09-28). ~~Anything that
 * throws, decodes to nothing~~ was the line, and the index draws it further
 * in: a file that parses and is not a valid object of its kind is quarantined
 * with the last good row kept. Here it read as an edit, so the write refused
 * as `stale` with the refused file as the reload, and the loop was back.
 * `acceptObject` is the index's own test, so the two cannot disagree again.
 */
function decodeOnDisk(context: LibraryContext, path: string, bytes: Uint8Array): unknown {
  const parsed = context.layout.parseObjectPath(path);
  if (parsed === null) return null;
  const accepted = acceptObject(parsed, bytes);
  return accepted.ok ? accepted.payload : null;
}

/**
 * Removes an object — by moving its folder, history and all, to the user's
 * trash. Deletion is a move, not an erasure ([03 §10.2]): the retention sweep
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
    if (current.owner === 'system') {
      throw new LibraryError('read-only', 'System library objects cannot be deleted.');
    }
    if (current.contentHash !== expectedHash) {
      throw new LibraryError('stale', 'The object has changed since it was read.', current);
    }

    // The symlink door stays — a delete moves a tree, and moving one somebody
    // planted a link into is the case the lexical rules cannot see.
    await context.layout.assertReal(current.path);

    /**
     * **The disk check, but only where it protects something — P2C finding 8.**
     *
     * Deleting an object a hand edit has since changed is the same mistake as
     * overwriting it and rather more final, so a *readable* edit underneath
     * still refuses. What used to happen as well was that a file edited into
     * something the loader cannot parse became permanently **undeletable**: the
     * one file a person most needs to remove was the one file this refused to
     * remove, which is what "the only exit is a text editor" meant.
     *
     * So the refusal now depends on whether there is anything to protect. Bytes
     * that decode are somebody's edit and are worth a 412. Bytes that do not
     * decode are damage, and the delete is the documented repair — the If-Match
     * check above still carries the meaning that matters, *you are deleting the
     * object you were shown*, and the move is reversible through trash and
     * version history ([03 §10.2]).
     */
    const onDisk = await readFileBytes(current.path);
    if (onDisk !== null && contentHashOf(onDisk) !== current.contentHash) {
      const body = decodeOnDisk(context, current.path, onDisk);
      if (body !== null) {
        throw new LibraryError('stale', 'The object has changed on disk since it was read.', {
          ...current,
          contentHash: contentHashOf(onDisk),
          body,
        });
      }
    }

    /**
     * ***The folder the object is in, to the trash folder of the folder it was
     * in*** — [P16 §1.1]. Built from the kind and the slug until P16.0, which
     * was the same answer while every kind had one folder; for a World still in
     * `packages/` it named `worlds/<slug>`, which may be **another World** made
     * since under the same name — and this would have trashed that one and left
     * the Package on disk with its row tombstoned. A legacy folder goes to
     * `trash/packages/`, where a restore knows to move it on.
     */
    const folder = context.layout.folderOf(current.path);
    await moveTree(folder, context.layout.trashDestinationFor(handle, folder, uuidv7()));
    removeFile(context.db, context.layout, current.path);
  });
}
