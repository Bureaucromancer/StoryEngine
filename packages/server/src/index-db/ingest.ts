// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { createHash } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';

import { ACTOR_SCHEMA, schemaIdOf, validate } from '@storyengine/shared';

import { requireCodecFor } from '../storage/card/index.js';
import { fileExists, readFileBytes, statFile } from '../storage/files.js';
import type { Layout, LibraryScope, ParsedObjectPath } from '../storage/layout.js';

/**
 * File → rows.
 *
 * Two things live here that look small and are the whole of P1.4's risk.
 *
 * **Tombstone-and-match** ([P1 §1.1](../../../../docs/design/workplan/03-p1-implementation.md)). The
 * engine never renames a user's folders, so the only way a path under a stable
 * id changes is a *foreign* rename — and a foreign rename reaches us as an
 * unlink followed by an add, in that order, with nothing connecting them. So an
 * unlink marks the row rather than removing it, and an add carrying the same
 * uuid before the mark matures moves the surviving row to the new path. One
 * mechanism, one caller: there is no rename special case anywhere else in the
 * system, and a rename through the API is an ordinary write.
 *
 * **Duplicate ids** ([P1 §1.2](../../../../docs/design/workplan/03-p1-implementation.md)). Folders
 * are copy-pasteable, which is a feature, so two files may claim one uuid. The
 * lexicographically first path wins, the other is flagged, and nothing blocks.
 * Path order rather than mtime because mtime is unstable in exactly the ways
 * this design invites — `cp -p`, a backup restore and a git checkout all rewrite
 * or equalise it — and because path order makes *rebuild equals incremental*
 * trivially true rather than something to hope holds.
 */

/**
 * How long a tombstone survives before it is a real deletion.
 *
 * Long enough to span an unlink/add pair from a file manager or a `git
 * checkout`, short enough that a genuine delete does not linger. Erring long is
 * the safe direction: a stale tombstone costs a row nobody can see, whereas
 * maturing too early turns a rename into a delete followed by a create — which
 * is precisely the flicker [P1 §1.1](../../../../docs/design/workplan/03-p1-implementation.md) exists
 * to prevent.
 */
export const TOMBSTONE_TTL_MS = 5000;

export interface ObjectRow {
  path: string;
  id: string;
  scope: string;
  schemaId: string;
  slug: string;
  name: string;
  contentHash: string;
  mtimeMs: number;
  size: number;
  body: string;
  shadowed: boolean;
}

export type IngestOutcome =
  | { kind: 'indexed'; row: ObjectRow; moved: boolean }
  | { kind: 'skipped'; reason: 'not-an-object' | 'unreadable' | 'invalid'; path: string };

export function scopeKey(scope: LibraryScope): string {
  return scope.kind === 'system' ? 'system' : `user:${scope.handle}`;
}

/** `sha256:<hex>` over the bytes on disk, which is what a client's write must present. */
export function contentHashOf(bytes: Uint8Array): string {
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
}

/**
 * Reads whatever the kind keeps on disk and hands back the portable object.
 *
 * The actor is the only kind that is not plain JSON — `card.png` is canonical
 * rather than a mirror ([02 §5.2](../../../../docs/design/02-data-model.md)) — so this is
 * where the card codec attaches. Everything else is a file read and a parse.
 */
function decodeObject(parsed: ParsedObjectPath, bytes: Uint8Array): unknown {
  if (parsed.schemaId !== ACTOR_SCHEMA) {
    return JSON.parse(new TextDecoder().decode(bytes)) as unknown;
  }
  const contents = requireCodecFor(bytes).read(bytes);
  // A card with no envelope of ours is not an error — it may be a V2 card
  // waiting for import — but it is not something this index can hold either.
  return contents.envelope?.payload ?? null;
}

/**
 * Indexes one file.
 *
 * Called synchronously by the application's own write path, so that a `GET`
 * after a `POST` reflects it ([02 §5.1.1](../../../../docs/design/02-data-model.md)), and
 * asynchronously by the watcher for foreign writes. Same function both times —
 * the two writers share the loader, the schema and the index, which is what
 * makes hand-editing safe rather than merely tolerated.
 */
export async function ingestFile(
  db: DatabaseSync,
  layout: Layout,
  path: string,
  now: number = Date.now(),
): Promise<IngestOutcome> {
  const parsed = layout.parseObjectPath(path);
  if (!parsed) return { kind: 'skipped', reason: 'not-an-object', path };

  // The watcher's door (F1). Every other path in the system was built by
  // `Layout`; this one arrives from chokidar, which reports what it found on
  // disk. A folder under the library that links out of the data root would
  // otherwise be indexed as an object, and the row's path is what later reads
  // open. The watcher itself no longer follows links — this is the second lock
  // on the same door, and it also covers a rebuild's scan.
  await layout.assertReal(path);

  // Gone between the event and the read is normal, not exceptional: the
  // unlink handler will deal with it, or a rebuild will.
  const bytes = await readFileBytes(path);
  const stats = bytes === null ? null : await statFile(path);
  if (bytes === null || stats === null) {
    return { kind: 'skipped', reason: 'unreadable', path };
  }

  let payload: unknown;
  try {
    payload = decodeObject(parsed, bytes);
  } catch {
    return { kind: 'skipped', reason: 'invalid', path };
  }

  const id = readId(payload);
  if (id === null || schemaIdOf(payload) !== parsed.schemaId) {
    // A file in `actors/` that does not describe an actor, or one with no id.
    // Left out of the index rather than guessed at; it is still on disk and
    // still the user's.
    return { kind: 'skipped', reason: 'invalid', path };
  }

  if (!validate(payload).valid) {
    return { kind: 'skipped', reason: 'invalid', path };
  }

  // Unlink-first ordering: the tombstone is already waiting for us.
  const movedFromTombstone = claimTombstone(db, id, path, now);

  const row: ObjectRow = {
    path,
    id,
    scope: scopeKey(parsed.scope),
    schemaId: parsed.schemaId,
    slug: parsed.slug,
    name: readName(payload) ?? parsed.slug,
    contentHash: contentHashOf(bytes),
    mtimeMs: stats.mtimeMs,
    size: stats.size,
    body: JSON.stringify(payload),
    shadowed: false,
  };

  upsert(db, row);
  // Add-first ordering: the row we are replacing is still live, and its file is
  // already gone.
  const movedFromVanished = await dropVanishedDuplicates(db, id, path);
  resolveDuplicates(db, id);

  return { kind: 'indexed', row, moved: movedFromTombstone || movedFromVanished };
}

/**
 * Removes live rows that claim this id but whose file is no longer there.
 *
 * **Renames do not arrive in the order the design assumed.** A folder rename
 * was expected to reach the watcher as unlink-then-add, and chokidar delivers
 * *add* first — verified on the development platform. Without this, the two
 * halves never meet: the add inserts a second row, the unlink tombstones the
 * first, and the object flickers through a duplicate-id warning on its way to
 * the right answer.
 *
 * So the same rename is recognised from either direction. The tombstone handles
 * unlink-first; this handles add-first, by asking the only question that
 * actually distinguishes a move from a copy — **is the other file still
 * there?** A copied folder has both, and stays a flagged duplicate
 * ([P1 §1.2](../../../../docs/design/workplan/03-p1-implementation.md)); a renamed one does not.
 *
 * It is also a quiet repair for a row whose file vanished without an event at
 * all, which is the kind of divergence a crash between write and index leaves
 * behind ([02 §5.1.1](../../../../docs/design/02-data-model.md)).
 */
async function dropVanishedDuplicates(
  db: DatabaseSync,
  id: string,
  keepPath: string,
): Promise<boolean> {
  const others = db
    .prepare('select path from object where id = ? and path != ? and tombstoned_at is null')
    .all(id, keepPath) as { path: string }[];

  // The common case is no duplicates at all, and it costs one indexed lookup.
  let removedAny = false;
  for (const { path } of others) {
    if (!(await fileExists(path))) {
      db.prepare('delete from object where path = ?').run(path);
      db.prepare('delete from object_fts where path = ?').run(path);
      removedAny = true;
    }
  }

  return removedAny;
}

/**
 * Marks a path gone.
 *
 * **Tombstone, not delete.** The row stays so that an add arriving moments
 * later with the same uuid can be recognised as the second half of a rename.
 */
export function removeFile(db: DatabaseSync, path: string, now: number = Date.now()): boolean {
  const result = db
    .prepare('update object set tombstoned_at = ? where path = ? and tombstoned_at is null')
    .run(now, path);

  if (result.changes > 0) {
    const row = db.prepare('select id from object where path = ?').get(path) as
      { id: string } | undefined;
    if (row) resolveDuplicates(db, row.id);
  }

  return result.changes > 0;
}

/**
 * Turns a tombstone into the move it was waiting to be.
 *
 * Returns true when this add completed a rename, which the caller reports so a
 * log can say *moved* rather than *created* — the difference matters to anyone
 * reading it, and it is the observable form of the guarantee that a foreign
 * rename does not flicker through a delete.
 */
function claimTombstone(db: DatabaseSync, id: string, newPath: string, now: number): boolean {
  const cutoff = now - TOMBSTONE_TTL_MS;
  const candidate = db
    .prepare(
      `select path from object
        where id = ? and tombstoned_at is not null and tombstoned_at >= ?
        order by path limit 1`,
    )
    .get(id, cutoff) as { path: string } | undefined;

  if (!candidate || candidate.path === newPath) {
    // Same path means the file came back where it was — a rewrite, not a move.
    if (candidate) clearTombstone(db, candidate.path);
    return false;
  }

  // The row survives with its id and a new path. `upsert` writes the rest.
  db.prepare('delete from object where path = ?').run(newPath);
  db.prepare('delete from object_fts where path = ?').run(newPath);
  db.prepare('update object set path = ?, tombstoned_at = null where path = ?').run(
    newPath,
    candidate.path,
  );
  db.prepare('delete from object_fts where path = ?').run(candidate.path);
  return true;
}

function clearTombstone(db: DatabaseSync, path: string): void {
  db.prepare('update object set tombstoned_at = null where path = ?').run(path);
}

/** Deletes tombstones old enough that no rename is coming. */
export function matureTombstones(db: DatabaseSync, now: number = Date.now()): number {
  const cutoff = now - TOMBSTONE_TTL_MS;
  const doomed = db
    .prepare('select path, id from object where tombstoned_at is not null and tombstoned_at < ?')
    .all(cutoff) as { path: string; id: string }[];

  for (const { path } of doomed) {
    db.prepare('delete from object where path = ?').run(path);
    db.prepare('delete from object_fts where path = ?').run(path);
  }
  for (const id of new Set(doomed.map((row) => row.id))) {
    resolveDuplicates(db, id);
  }

  return doomed.length;
}

/**
 * Decides which of several files claiming one id is the live one.
 *
 * **Lexicographically first path wins.** Deterministic, immune to editing, and
 * identical whether reached incrementally or by a full scan — which is what
 * makes this phase's CI gate hold by construction rather than by luck.
 */
function resolveDuplicates(db: DatabaseSync, id: string): void {
  const rows = db
    .prepare('select path from object where id = ? and tombstoned_at is null order by path')
    .all(id) as { path: string }[];

  rows.forEach((row, position) => {
    db.prepare('update object set shadowed = ? where path = ?').run(
      position === 0 ? 0 : 1,
      row.path,
    );
  });
}

function upsert(db: DatabaseSync, row: ObjectRow): void {
  db.prepare(
    `insert into object
       (path, id, scope, schema_id, slug, name, content_hash, mtime_ms, size, body, shadowed, tombstoned_at)
     values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, null)
     on conflict(path) do update set
       id = excluded.id,
       scope = excluded.scope,
       schema_id = excluded.schema_id,
       slug = excluded.slug,
       name = excluded.name,
       content_hash = excluded.content_hash,
       mtime_ms = excluded.mtime_ms,
       size = excluded.size,
       body = excluded.body,
       tombstoned_at = null`,
  ).run(
    row.path,
    row.id,
    row.scope,
    row.schemaId,
    row.slug,
    row.name,
    row.contentHash,
    row.mtimeMs,
    row.size,
    row.body,
  );

  db.prepare('delete from object_fts where path = ?').run(row.path);
  db.prepare('insert into object_fts (path, name, body) values (?, ?, ?)').run(
    row.path,
    row.name,
    row.body,
  );
}

function readId(payload: unknown): string | null {
  if (typeof payload !== 'object' || payload === null) return null;
  const id: unknown = (payload as { id?: unknown }).id;
  return typeof id === 'string' && id.length > 0 ? id : null;
}

function readName(payload: unknown): string | null {
  if (typeof payload !== 'object' || payload === null) return null;
  const name: unknown = (payload as { name?: unknown }).name;
  return typeof name === 'string' ? name : null;
}
