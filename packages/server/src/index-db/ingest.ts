// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { createHash } from 'node:crypto';
import { join } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';

import {
  ACTOR_SCHEMA,
  LOREBOOK_SCHEMA,
  schemaIdOf,
  type PortableSchemaId,
  validate,
  type LoreEntry,
} from '@storyengine/shared';

import { requireCodecFor } from '../storage/card/index.js';
import { fileExists, readFileBytes, statFile } from '../storage/files.js';
import type { Layout, LibraryOwner, ParsedObjectPath } from '../storage/layout.js';
import type { PathEscapeError } from '../storage/paths.js';
import { inTransaction } from '../storage/transaction.js';

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
  owner: string;
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

/**
 * Why a file that *is* in an object's place could not be read as one — F20.
 *
 * `unusable-name` is the odd one: it is about the *folder*, not the file. Its
 * name is one this build refuses to resolve — a reserved device name, a
 * trailing space — so no path into it can be built and the object inside it can
 * never be opened by anything. F22 skipped such a folder silently; [P6B.1] gave
 * it a row, because an object that is absent for a reason is not the same thing
 * as an object that is absent.
 */
export type FileErrorReason = 'unparsable' | 'wrong-kind' | 'schema' | 'unusable-name';

export interface FileError {
  path: string;
  owner: string;
  schemaId: string;
  slug: string;
  reason: FileErrorReason;
  detail: string | null;
  seenAt: number;
}

export function ownerKey(owner: LibraryOwner): string {
  return owner.kind === 'system' ? 'system' : `user:${owner.handle}`;
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
export function decodeObject(parsed: ParsedObjectPath, bytes: Uint8Array): unknown {
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
  } catch (error) {
    return recordInvalid(db, parsed, 'unparsable', messageOf(error), now);
  }

  const id = readId(payload);
  if (id === null || schemaIdOf(payload) !== parsed.schemaId) {
    // A file in `actors/` that does not describe an actor, or one with no id.
    // Left out of the index rather than guessed at; it is still on disk and
    // still the user's.
    return recordInvalid(
      db,
      parsed,
      'wrong-kind',
      id === null ? 'no id' : `declares ${String(schemaIdOf(payload))}`,
      now,
    );
  }

  const result = validate(payload);
  if (!result.valid) {
    return recordInvalid(
      db,
      parsed,
      'schema',
      result.issues.map((issue) => `${issue.path} ${issue.message}`).join('; '),
      now,
    );
  }

  const row: ObjectRow = {
    path,
    id,
    owner: ownerKey(parsed.owner),
    schemaId: parsed.schemaId,
    slug: parsed.slug,
    name: readName(payload) ?? parsed.slug,
    contentHash: contentHashOf(bytes),
    mtimeMs: stats.mtimeMs,
    size: stats.size,
    body: JSON.stringify(payload),
    shadowed: false,
  };

  // **Every read of the filesystem happens before the transaction opens** (F9).
  // The mutation below used to straddle an `await` — the row was upserted, then
  // the code went off to stat some files, then it deleted and re-resolved — and
  // the watcher and an API write share one `DatabaseSync`, so a second ingest
  // could land in that gap and see an index that was halfway through somebody
  // else's update.
  const vanished = await findVanishedDuplicates(db, id, path);

  const movedFromTombstone = inTransaction(db, () => {
    /**
     * **The id this path used to hold, read before the upsert overwrites it.**
     *
     * A file's id can change — editing one in place is all it takes, and the
     * rebuild property generates exactly that. When it does, the id it *left*
     * has one fewer holder, and if that leaves a single file holding it then
     * that file is no longer shadowed by anything. `resolveDuplicates` below is
     * called with the **new** id and knows nothing about the old one, so the
     * survivor kept a `shadowed` flag it had been given when it had company.
     *
     * A rebuild starts empty and never sees the intermediate state, so it
     * disagreed — which is how this surfaced: as roughly one full-suite run in
     * five of the gate that exists to hold the two producers to one answer.
     */
    const previousId = (
      db.prepare('select id from object where path = ?').get(path) as { id: string } | undefined
    )?.id;

    // The file parses, so whatever was wrong with it before is not wrong now.
    clearFileError(db, path);
    // Unlink-first ordering: the tombstone is already waiting for us.
    const claimed = claimTombstone(db, id, path, now);
    upsert(db, row, payload);
    // Add-first ordering: the row we are replacing is still live, and its file
    // is already gone.
    dropRows(db, vanished);
    resolveDuplicates(db, layout, id);
    // Both sets, and in this order: the new id's winner is decided first, so a
    // file that moved *between* two duplicate sets cannot be briefly unshadowed
    // in one while still counted in the other.
    if (previousId !== undefined && previousId !== id) {
      resolveDuplicates(db, layout, previousId);
    }
    return claimed;
  });

  return { kind: 'indexed', row, moved: movedFromTombstone || vanished.length > 0 };
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Records a file that is in an object's place and cannot be read as one — F20.
 *
 * **The previous valid row is left alone**, deliberately. The bytes on disk are
 * not an object any more, but the last good version of it is still the most
 * useful thing to show — and the write path refuses to overwrite the file it
 * cannot read (the closeout's disk re-hash), so nothing is at risk of being
 * eaten. What changes is that the failure is now *visible* instead of being a
 * return value nobody stored.
 */
function recordInvalid(
  db: DatabaseSync,
  parsed: ParsedObjectPath,
  reason: FileErrorReason,
  detail: string,
  now: number,
): IngestOutcome {
  db.prepare(
    `insert into file_error (path, owner, schema_id, slug, reason, detail, seen_at)
       values (?, ?, ?, ?, ?, ?, ?)
       on conflict(path) do update set reason = excluded.reason,
                                       detail = excluded.detail,
                                       seen_at = excluded.seen_at`,
  ).run(
    parsed.path,
    ownerKey(parsed.owner),
    parsed.schemaId,
    parsed.slug,
    reason,
    detail.slice(0, 2000),
    now,
  );

  return { kind: 'skipped', reason: 'invalid', path: parsed.path };
}

/** Clears the error for a path — the file was fixed, or it is gone. */
export function clearFileError(db: DatabaseSync, path: string): void {
  db.prepare('delete from file_error where path = ?').run(path);
}

/**
 * Records a *folder* whose name this build will not resolve — F22, settled at
 * [P6B.1].
 *
 * **Both producers call this one function, and that is the point.** A rebuild
 * enumerates slugs with `readdir` and asks the layout to build a path; the
 * watcher is handed a path and parses it back. The two met the same folder and
 * disagreed: `rebuild` refused it and counted a silent skip, while the watcher
 * never applied the name rule at all and indexed a row whose file no other code
 * in this build can open — every read goes back through `objectFile`, which
 * throws. `rebuild.ts` recorded the divergence in a comment and assigned it to
 * `P2.7`, a stage that was never created.
 *
 * The key is the object *folder*, computed here from `(owner, kind, slug)` so
 * that a caller holding a file path and a caller holding a slug cannot key the
 * same failure two ways. The file inside is not named because it cannot be
 * reached to know whether it exists.
 */
export function recordUnusableName(
  db: DatabaseSync,
  layout: Layout,
  owner: LibraryOwner,
  schemaId: PortableSchemaId,
  slug: string,
  error: PathEscapeError,
  now: number,
): void {
  // `kindRoot` is audited and `slug` came from one `readdir` entry or one path
  // segment, so it holds no separator: a plain join cannot escape, and the
  // audited resolver is exactly what refused this name a moment ago.
  const folder = join(layout.kindRoot(owner, schemaId), slug);
  db.prepare(
    `insert into file_error (path, owner, schema_id, slug, reason, detail, seen_at)
       values (?, ?, ?, ?, ?, ?, ?)
       on conflict(path) do update set reason = excluded.reason,
                                       detail = excluded.detail,
                                       seen_at = excluded.seen_at`,
  ).run(
    folder,
    ownerKey(owner),
    schemaId,
    slug,
    'unusable-name',
    error.message.slice(0, 2000),
    now,
  );
}

/** Every file that could not be read, for the owners a caller may see. */
export function listFileErrors(db: DatabaseSync, owners: readonly string[]): FileError[] {
  if (owners.length === 0) return [];
  const placeholders = owners.map(() => '?').join(', ');
  const rows = db
    .prepare(
      `select path, owner, schema_id, slug, reason, detail, seen_at
         from file_error where owner in (${placeholders}) order by path`,
    )
    .all(...owners) as {
    path: string;
    owner: string;
    schema_id: string;
    slug: string;
    reason: FileErrorReason;
    detail: string | null;
    seen_at: number;
  }[];

  return rows.map((row) => ({
    path: row.path,
    owner: row.owner,
    schemaId: row.schema_id,
    slug: row.slug,
    reason: row.reason,
    detail: row.detail,
    seenAt: row.seen_at,
  }));
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
async function findVanishedDuplicates(
  db: DatabaseSync,
  id: string,
  keepPath: string,
): Promise<string[]> {
  const others = db
    .prepare('select path from object where id = ? and path != ? and tombstoned_at is null')
    .all(id, keepPath) as { path: string }[];

  // The common case is no duplicates at all, and it costs one indexed lookup.
  const vanished: string[] = [];
  for (const { path } of others) {
    if (!(await fileExists(path))) vanished.push(path);
  }
  return vanished;
}

/**
 * **Every derived row an object's path owns, in one place** —
 * [P5 §1.7](../../../../docs/design/workplan/07-p5-implementation.md)'s
 * mitigation, and the only reason it is worth a two-line function.
 *
 * `object_fts` was deleted by path in five separate places before this. That is
 * survivable while there is one search table and stops being survivable the
 * moment there are two: every site needs a sibling, missing one leaves a stale
 * row in a store whose entire claim is that it is derived and trustworthy, and
 * the failure is silent and survives a restart —
 * [13 §5](../../../../docs/design/13-internal-contracts.md)'s invariants exist
 * to forbid exactly that. So the knowledge of *which tables an object writes
 * into* lives here, and a table added later is one line rather than a search
 * for call sites somebody has to get complete.
 *
 * Measured rather than asserted: with `snapshot` widened to see search rows
 * ([query.ts](./query.ts)), removing the delete below turns the suite red at
 * every one of the five callers. Before that widening it turned nothing red
 * anywhere, which is the finding this function exists because of.
 */
function dropSearchRows(db: DatabaseSync, path: string): void {
  db.prepare('delete from object_fts where path = ?').run(path);
  db.prepare('delete from lore_entry where path = ?').run(path);
  db.prepare('delete from lore_entry_fts where path = ?').run(path);
}

/** The object at this path and everything derived from it. */
function dropObjectRows(db: DatabaseSync, path: string): void {
  db.prepare('delete from object where path = ?').run(path);
  dropSearchRows(db, path);
}

/**
 * The search rows an object implies, replacing whatever was there.
 *
 * Drop-then-insert rather than an upsert, because FTS5 has no unique key to
 * conflict on — and because the rows an object owns are not a fixed set: this
 * is the other half of {@link dropSearchRows}, and the place a second table
 * pair attaches when one arrives.
 */
function writeSearchRows(db: DatabaseSync, row: ObjectRow, payload: unknown): void {
  dropSearchRows(db, row.path);
  db.prepare('insert into object_fts (path, name, body) values (?, ?, ?)').run(
    row.path,
    row.name,
    row.body,
  );

  const entries = loreEntriesOf(row.schemaId, payload);
  if (entries.length === 0) return;

  // Prepared once and run per entry: a three-hundred-entry book is three
  // hundred iterations inside the one synchronous transaction the watcher and
  // every API write share, and re-preparing the same statement each time is the
  // avoidable half of that cost.
  const locator = db.prepare(
    'insert into lore_entry (path, position, entry_id, name) values (?, ?, ?, ?)',
  );
  const text = db.prepare(
    `insert into lore_entry_fts (path, position, name, keys, secondary_keys, description, content)
     values (?, ?, ?, ?, ?, ?, ?)`,
  );

  for (const { position, entry } of entries) {
    locator.run(row.path, position, entry.id, entry.name);
    text.run(
      row.path,
      position,
      entry.name,
      // Joined with a newline rather than indexed as an array, because FTS5
      // columns hold text: what matters is that each key is its own token run,
      // and a separator the tokenizer breaks on is the whole requirement. It
      // shows up in a snippet drawn from this column as a line break, which is
      // the closest a plain excerpt gets to §5.3's index-term row.
      entry.keys.join('\n'),
      entry.secondaryKeys.join('\n'),
      entry.description,
      entry.content,
    );
  }
}

/**
 * The entries this object contributes to the index, which is none unless it is
 * a lorebook.
 *
 * **The only place a schema id appears in the ingest path**, and
 * [05 §14.5](../../../../docs/design/05-ui-surfaces.md)'s rule is what both
 * justifies and bounds it: *a fragment is indexable when it has an address*. A
 * lore entry has `id`; an actor's greetings and a preset's block text do not,
 * so they get no branch here and the special case cannot spread by analogy.
 * `PlotHook` and `Openings` are the next two structures that qualify, and they
 * will qualify for the stated reason rather than because this exists.
 *
 * Read through `unknown` even though `validate` has already passed on this
 * payload. That is not distrust of the validator: `upsert` is one call away
 * from being reachable with something else, and the cost of the guard is a few
 * lines against a bad row inside a transaction that would take the whole book
 * out of the index with it.
 *
 * **The position travels with the entry, and that is the part to keep.**
 * `position` claims to be the index into the file's own `entries` array — which
 * is what [05 §5.3](../../../../docs/design/05-ui-surfaces.md) makes the read
 * view's default order, and what the locator's key rests on. Returning a
 * *filtered* array and numbering it at the call site would quietly renumber
 * every entry after a skipped one, so the pairs are built here where the
 * original index is still in hand. The guard has never fired, which is exactly
 * why the failure would have been invisible.
 */
function loreEntriesOf(
  schemaId: string,
  payload: unknown,
): { position: number; entry: LoreEntry }[] {
  if (schemaId !== LOREBOOK_SCHEMA) return [];
  if (typeof payload !== 'object' || payload === null) return [];
  const entries: unknown = (payload as { entries?: unknown }).entries;
  if (!Array.isArray(entries)) return [];

  return entries.flatMap((entry: unknown, position) =>
    isIndexableEntry(entry) ? [{ position, entry }] : [],
  );
}

/** Everything the two tables read, present and of the right shape. */
function isIndexableEntry(entry: unknown): entry is LoreEntry {
  if (typeof entry !== 'object' || entry === null) return false;
  const found = entry as LoreEntry;
  return (
    typeof found.id === 'string' &&
    typeof found.name === 'string' &&
    typeof found.description === 'string' &&
    typeof found.content === 'string' &&
    Array.isArray(found.keys) &&
    Array.isArray(found.secondaryKeys)
  );
}

function dropRows(db: DatabaseSync, paths: readonly string[]): void {
  for (const path of paths) dropObjectRows(db, path);
}

/**
 * Marks a path gone.
 *
 * **Tombstone, not delete.** The row stays so that an add arriving moments
 * later with the same uuid can be recognised as the second half of a rename.
 */
export function removeFile(
  db: DatabaseSync,
  layout: Layout,
  path: string,
  now: number = Date.now(),
): boolean {
  // Unconditionally, and before the tombstone: deleting the broken file is the
  // other way a person fixes it, and an error that outlived its file would be a
  // complaint about nothing with no way to dismiss it. Not gated on `changes`
  // either — a file that never indexed *only* has an error row.
  clearFileError(db, path);

  const result = db
    .prepare('update object set tombstoned_at = ? where path = ? and tombstoned_at is null')
    .run(now, path);

  if (result.changes > 0) {
    const row = db.prepare('select id from object where path = ?').get(path) as
      { id: string } | undefined;
    if (row) resolveDuplicates(db, layout, row.id);
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
  dropObjectRows(db, newPath);
  db.prepare('update object set path = ?, tombstoned_at = null where path = ?').run(
    newPath,
    candidate.path,
  );
  // Search rows only, and this is the one caller where that is the right
  // amount: the object row at the old path was *moved* by the statement above
  // rather than deleted, so there is nothing left there to drop — only the
  // derived rows it left behind under its old key.
  dropSearchRows(db, candidate.path);
  return true;
}

function clearTombstone(db: DatabaseSync, path: string): void {
  db.prepare('update object set tombstoned_at = null where path = ?').run(path);
}

/** Deletes tombstones old enough that no rename is coming. */
export function matureTombstones(
  db: DatabaseSync,
  layout: Layout,
  now: number = Date.now(),
): number {
  const cutoff = now - TOMBSTONE_TTL_MS;
  const doomed = db
    .prepare('select path, id from object where tombstoned_at is not null and tombstoned_at < ?')
    .all(cutoff) as { path: string; id: string }[];

  for (const { path } of doomed) dropObjectRows(db, path);
  for (const id of new Set(doomed.map((row) => row.id))) {
    resolveDuplicates(db, layout, id);
  }

  return doomed.length;
}

/**
 * Decides which of several files claiming one id is the live one.
 *
 * **Lexicographically first path wins** — by the *portable* path, not the
 * native one (F23). Deterministic, immune to editing, and identical whether
 * reached incrementally or by a full scan, which is what makes the rebuild gate
 * hold by construction rather than by luck.
 *
 * The portable form is what makes it identical across *platforms* too. Ordering
 * the stored absolute paths under SQLite's BINARY collation puts the separator
 * into the comparison — `/` is 0x2F, `\` is 0x5C — so wherever one slug is a
 * prefix of another, `vera` beats `vera2` on Linux and loses on Windows.
 * Copying `vera/` to `vera2/` is precisely the user action gate step 12
 * describes, and the two CI legs would have answered it differently.
 */
function resolveDuplicates(db: DatabaseSync, layout: Layout, id: string): void {
  const rows = (
    db.prepare('select path from object where id = ? and tombstoned_at is null').all(id) as {
      path: string;
    }[]
  )
    .map((row) => ({ ...row, order: layout.portablePath(row.path) ?? row.path }))
    .sort((a, b) => (a.order < b.order ? -1 : a.order > b.order ? 1 : 0));

  rows.forEach((row, position) => {
    db.prepare('update object set shadowed = ? where path = ?').run(
      position === 0 ? 0 : 1,
      row.path,
    );
  });
}

function upsert(db: DatabaseSync, row: ObjectRow, payload: unknown): void {
  db.prepare(
    `insert into object
       (path, id, owner, schema_id, slug, name, content_hash, mtime_ms, size, body, shadowed, tombstoned_at)
     values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, null)
     on conflict(path) do update set
       id = excluded.id,
       owner = excluded.owner,
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
    row.owner,
    row.schemaId,
    row.slug,
    row.name,
    row.contentHash,
    row.mtimeMs,
    row.size,
    row.body,
  );

  writeSearchRows(db, row, payload);
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
