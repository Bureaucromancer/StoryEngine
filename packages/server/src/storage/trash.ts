// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { readdir, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';

import {
  kindOfDirectory,
  LEGACY_LIBRARY_DIRECTORIES,
  LIBRARY_DIRECTORIES,
  upgradeLegacySchema,
  uuidv7,
  type PortableSchemaId,
} from '@storyengine/shared';

import type { Logger } from '../state/commit.js';
import { watchWallClock, type WallClockWatch } from '../wall-clock.js';
import { writeJsonAtomic } from './atomic.js';
import { objectFilenames, resolveFreeFolder, type Layout, userOwner } from './layout.js';
import { fileExists, moveTree, readFileBytes, renamePath } from './files.js';
import { libraryWrites } from './library-writes.js';
import { KeyedQueue } from './keyed-queue.js';

/**
 * ***The retention window, swept*** —
 * [03 §10.2](../../../../docs/design/03-data-model.md),
 * [P2 §2.11](../../../../docs/design/workplan/08-p2-implementation.md)'s F7
 * second half, [P11.7](../../../../docs/design/workplan/28-p11-implementation.md).
 *
 * **Deleting has been a move since P4.4 and nothing has ever swept.**
 * `trash.retentionDays` defaults to thirty and `config.ts` says so outright —
 * *"the maturation sweep does not read it; trash retention is not
 * implemented"* — so the setting, the window and the folder all existed and a
 * thirty-day window had never expired anything. That is the standing line's
 * shape exactly: configuration with no consumer.
 *
 * ***When something was deleted is in its own folder name, and that is the find
 * this stage turns on.*** `trashDestination` suffixes each entry with a
 * `uuidv7`, whose first forty-eight bits are the Unix millisecond it was
 * minted — so the trash already records, exactly and per entry, the moment the
 * delete happened. **The alternative was the filesystem's mtime**, and it is
 * worse in a way that only shows up when it matters: a restore from backup, a
 * `cp -r` to a new disk, or a container migration resets every mtime, and a
 * sweep reading them would either delete nothing for thirty more days or —
 * depending on which way the tool sets them — delete everything the next
 * morning. *The name travels with the bytes.*
 *
 * **A clock the caller controls**, which is the proof obligation this stage was
 * given and the only shape that can assert *gone after it* without waiting
 * thirty days. It is also the reason to write it here rather than let somebody
 * reach for a real date inside the walk.
 *
 * ***Zero means keep forever, not delete immediately.*** The schema's minimum is
 * zero and the reading a sweep takes of it is load-bearing in the direction that
 * cannot be undone: an operator setting the window to nothing is asking for no
 * expiry, and a sweep that read it as *expire on sight* would empty the trash of
 * every install that tried to turn the feature off.
 */

/** One thing waiting in the trash. */
export interface TrashEntry {
  /** `<kind>/<slug>-<suffix>`, which is the address a restore takes. */
  id: string;
  /** The library directory it came from, or `sessions`. */
  kind: string;
  /** The slug or session id it had, with the suffix taken off. */
  name: string;
  deletedAt: number;
  /** When the sweep will take it, or null when the window is off. */
  expiresAt: number | null;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * The millisecond a `uuidv7` was minted, or null for anything else.
 *
 * **Null rather than zero**, and the difference decides whether a hand-made
 * folder in the trash survives: zero would read as *deleted in 1970* and be
 * swept on the next pass, which is this program deleting somebody's directory
 * because it did not recognise the name.
 */
export function deletedAtFrom(suffix: string): number | null {
  const hex = suffix.replace(/-/g, '').slice(0, 12);
  if (!/^[0-9a-f]{12}$/i.test(hex)) return null;
  const at = Number.parseInt(hex, 16);
  return Number.isSafeInteger(at) && at > 0 ? at : null;
}

/**
 * A trash entry's original name and the uuid it was suffixed with.
 *
 * ***Matched as a whole uuid rather than split on the last hyphen***, and the
 * first draft did the latter — which put `afda52e19278` in `deletedAtFrom`,
 * twelve valid hex digits from the **end** of the uuid, producing a deletion
 * date some nine thousand years hence and a sweep that took nothing ever. The
 * test caught it on its first run. *A uuid is full of hyphens, so a name that
 * ends in one is not a delimiter*, and the only unambiguous reading is the
 * shape of the whole suffix.
 *
 * Null for a folder that carries no uuid, which is a hand-made one and stays.
 */
export function splitTrashEntry(entry: string): { name: string; suffix: string } | null {
  const match = /^(.*)-([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i.exec(
    entry,
  );
  // Both groups are non-optional in the pattern, so `?? ''` is a type
  // obligation rather than a real case — and `noUncheckedIndexedAccess` is on,
  // which is why it has to be written at all.
  return match === null ? null : { name: match[1] ?? '', suffix: match[2] ?? '' };
}

/**
 * The directories the trash is organised into — the live tree's, plus sessions.
 *
 * ***And the folders a kind used to have*** — [P16 §1.1]. A Package deleted
 * before P16.0 sits at `trash/packages/<slug>-<uuid>`, and the backup alias
 * never reaches it, because no archive carries the trash. With `packages` gone
 * from `LIBRARY_DIRECTORIES`, such an entry would never be listed,
 * `splitTrashId` would refuse its address, and the sweep would never expire it
 * — a folder on disk for good that nobody can see or restore, which is the
 * stranding a migration exists not to cause. So the legacy folder stays a
 * trash kind for as long as the legacy read lives: listed, restored into the
 * kind's current folder, and expired, where it lies.
 */
function trashKinds(): string[] {
  return [
    ...Object.values(LIBRARY_DIRECTORIES as Record<PortableSchemaId, string>),
    ...Object.keys(LEGACY_LIBRARY_DIRECTORIES),
    'sessions',
  ];
}

/**
 * Everything in one account's trash, newest first.
 *
 * *Entries whose name carries no timestamp are listed with `deletedAt: 0` and
 * no expiry*, so a person can see and restore something the sweep will never
 * take — which is the honest presentation of a folder this build did not put
 * there.
 */
export async function listTrash(
  layout: Layout,
  handle: string,
  retentionDays: number,
): Promise<TrashEntry[]> {
  const root = layout.trashRoot(handle);
  const found: TrashEntry[] = [];

  for (const kind of trashKinds()) {
    let entries: string[];
    try {
      entries = await readdir(join(root, kind));
    } catch {
      // No such kind in the trash, which is the ordinary case.
      continue;
    }
    for (const entry of entries) {
      const split = splitTrashEntry(entry);
      const deletedAt = split === null ? 0 : (deletedAtFrom(split.suffix) ?? 0);
      found.push({
        id: `${kind}/${entry}`,
        kind,
        name: split?.name ?? entry,
        deletedAt,
        expiresAt: retentionDays > 0 && deletedAt > 0 ? deletedAt + retentionDays * DAY_MS : null,
      });
    }
  }

  return found.sort((one, two) => two.deletedAt - one.deletedAt);
}

/**
 * Removes what the window has expired, and answers what it took.
 *
 * **Per account rather than over the whole data root**, because the trash is
 * per user and a sweep that walked the root would have to know which
 * directories are accounts — a second place for the layout's rules to live.
 */
export async function sweepTrash(
  layout: Layout,
  handle: string,
  retentionDays: number,
  now: number,
): Promise<string[]> {
  if (retentionDays <= 0) return [];

  return moves.run(handle, async () => {
    const taken: string[] = [];
    for (const entry of await listTrash(layout, handle, retentionDays)) {
      if (entry.expiresAt === null || entry.expiresAt > now) continue;
      // `resolveWithin` is what makes the id safe to join: it came from a
      // `readdir` of the trash and is put back through the audited resolver
      // rather than concatenated.
      await rm(trashEntryPath(layout, handle, entry.id), { recursive: true, force: true });
      taken.push(entry.id);
    }
    return taken;
  });
}

/**
 * ***One move of an account's trash at a time*** (2026-10-01).
 *
 * Two restores of one entry at once — two tabs, or a double press — both find
 * it and its place free, and both rename it. On POSIX the second rename finds
 * the path empty and fails, and `restoreFromTrash`'s catch turns that into the
 * refusal it is. **On Windows it does not fail.** A rename there opens the
 * source and renames the open handle, so when both had opened the folder
 * before either moved it, the second moved it from where the first had put it
 * to the same place — a success — and both callers were told *restored*. The
 * object came back once and nothing was lost; what each request was told was
 * wrong, and the test that says so went red on the first Windows run in four
 * days (run 171).
 *
 * The sweep raced a restore the same way, with more at stake: its recursive
 * delete and a restore of an entry at the very end of its window could
 * interleave, and bring back a folder missing whatever had already gone.
 *
 * So both run on one queue per account. Restores and sweeps are rare, and the
 * queue costs nothing between them.
 */
const moves = new KeyedQueue();

/**
 * Where one trash entry is, resolved through the layout.
 *
 * *Exported because restore and empty both need it*, and because an id that
 * arrived in a request must go through one audited join rather than three.
 */
export function trashEntryPath(layout: Layout, handle: string, id: string): string {
  const [kind, entry] = splitTrashId(id);
  return join(layout.trashRoot(handle), kind, entry);
}

/** What a restore did. */
export type RestoreOutcome =
  | {
      ok: true;
      path: string;
      /**
       * What came back, so the caller can index it (2026-09-27): the folder's
       * name is the session's id or the object's slug once the suffix is off.
       */
      restored:
        | { kind: 'session'; sessionId: string }
        | { kind: 'object'; schemaId: PortableSchemaId; slug: string };
      /**
       * ***Brought back under a new id, because its own was taken*** —
       * 2026-10-11, the [P16 audit] (safety finding 1). Only a legacy entry
       * ({@link restoreLegacy}) is ever re-minted; `name` is the object's
       * own, for the sentence the restore's answer carries.
       */
      reminted?: { from: string; to: string; name: string };
    }
  | { ok: false; reason: 'not-found' | 'occupied' };

/**
 * ***What a restore may ask of the index*** — the trash module holds no
 * database, so the route that does hands this over (2026-10-11, the [P16
 * audit]).
 */
export interface RestoreOptions {
  /**
   * Whether an object id is held, live, anywhere in this install — the
   * index's `findById`, which skips tombstoned rows. Absent, nothing is
   * re-minted.
   */
  idIsLive?: (id: string) => boolean;
}

/**
 * Puts one entry back where it came from.
 *
 * ***The suffix is taken off and the original name is restored***, which is the
 * half that makes this a restore rather than a copy: the folder's name is the
 * object's slug, and an object restored as `vera-0199a1b2…` would be a second
 * actor with a name nobody chose.
 *
 * **Refused when something is already there.** Delete-recreate-restore is a real
 * sequence — somebody deletes an actor, makes a new one with the same name, then
 * changes their mind — and overwriting would destroy the newer object to
 * resurrect the older. The answer is to say so and let them rename one.
 */
export async function restoreFromTrash(
  layout: Layout,
  handle: string,
  id: string,
  options: RestoreOptions = {},
): Promise<RestoreOutcome> {
  return moves.run(handle, () => restoreNow(layout, handle, id, options));
}

async function restoreNow(
  layout: Layout,
  handle: string,
  id: string,
  options: RestoreOptions,
): Promise<RestoreOutcome> {
  const [kind, entry] = splitTrashId(id);
  const from = trashEntryPath(layout, handle, id);
  if (!(await exists(from))) return { ok: false, reason: 'not-found' };

  const name = splitTrashEntry(entry)?.name ?? entry;

  /**
   * ***An entry from a folder a kind no longer has*** — [P16 §1.1]. A Package
   * trashed before P16.0 comes back as a World, in `library/worlds/`: a
   * restore is a write, and every write writes the new form. **Under its old
   * slug if that is free and a fresh one if not** — never `occupied`, because
   * slugs are frozen and renaming the World that took the name frees nothing,
   * so the refusal the current kinds give would strand it in the trash for
   * good. ***And under a fresh id when its own is held*** (2026-10-11, the
   * [P16 audit]): ~~the fresh-slug rule alone~~ turned *the name is taken by
   * the same id, landed again* into a certain duplicate, the stale copy
   * winning the id — {@link remintIfLive}.
   */
  const legacyKind = Object.hasOwn(LEGACY_LIBRARY_DIRECTORIES, kind)
    ? (LEGACY_LIBRARY_DIRECTORIES[kind] ?? null)
    : null;
  if (legacyKind !== null) {
    return restoreLegacy(layout, handle, from, legacyKind, name, options.idIsLive ?? null);
  }

  /*
   * ***The same id-held-live case, on the current kinds, is not answered
   * here*** (2026-10-11, the [P16 audit]): a trashed object whose id was
   * landed again under a *different* slug since — an import, a backup — comes
   * back beside it as a second copy of one id, and the index's tie-break
   * picks between them. That is the older, non-legacy path, and a separate
   * queued change; the legacy path below is fixed because its fresh-slug rule
   * made the duplicate certain rather than possible.
   */

  const to =
    kind === 'sessions'
      ? layout.sessionRoot(handle, name)
      : join(layout.userRoot(handle), 'library', kind, name);

  if (await exists(to)) {
    /**
     * ***A session's place taken by what was written after it left*** —
     * (2026-09-27). A live session always has its `session.json`, so a folder
     * at the address without one is not a session anybody made: it is what a
     * writer still running when the session was deleted put back, a turn or a
     * picture with no session around it. It used to refuse the restore for as
     * long as it stood, which was for good. It goes to the trash as an entry
     * of its own, and the session comes back.
     */
    const stray =
      kind === 'sessions' && !(await exists(join(to, 'session.json')))
        ? layout.sessionTrashDestination(handle, name, uuidv7())
        : null;
    if (stray === null) return { ok: false, reason: 'occupied' };
    await moveTree(to, stray);
  }

  try {
    await moveTree(from, to);
  } catch (error) {
    /**
     * ***Something moved it between the look and the rename*** (2026-09-27).
     * ~~Two restores of one entry at once~~ — those queue now (`moves`, and
     * why: on Windows the second rename did not fail). What is left is a
     * rename that found its source gone or its place taken by something
     * outside this queue — a hand edit, a file manager. That is the answer the
     * first look would have given a moment later, so it is given now, and a
     * rename that failed for any other reason is still the failure it was.
     */
    if (!(await exists(from))) return { ok: false, reason: 'not-found' };
    if (await exists(to)) return { ok: false, reason: 'occupied' };
    throw error;
  }
  if (kind === 'sessions') {
    return { ok: true, path: to, restored: { kind: 'session', sessionId: name } };
  }
  const schemaId = kindOfDirectory(kind);
  // `splitTrashId` admitted only the library's directories and `sessions`.
  if (schemaId === null) throw new Error(`No kind keeps its objects in ${kind}.`);
  return { ok: true, path: to, restored: { kind: 'object', schemaId, slug: name } };
}

/**
 * ***A legacy entry, restored into its kind's current folder*** — [P16 §1.1].
 *
 * In the order that leaves one readable object wherever it stops: the folder
 * moves into `library/worlds/` under a free name, the file it carried —
 * `package.json`, saying `storyengine.package/1` — is rewritten in place under
 * the kind's id, and then renamed `world.json`, exactly as the first write's
 * move leaves one (`library.ts`, `relocateLegacy`). The layout reads the old
 * file name in the new folder, so a restore interrupted after the move is a
 * World that reads rather than one that vanished.
 *
 * **The body is changed in its `schema` and nothing else**, and written in the
 * library's own JSON form (`writeJsonAtomic` is the same two spaces and newline
 * `encodeObject` writes), so restoring a Package is the rename and no more. A
 * file that will not parse is left as it is, under its old name: it is
 * somebody's damaged object, the library lists it as a file error where it
 * lands, and rewriting what cannot be read is how a restore would lose it.
 *
 * *Not snapshotted into history*: the change is the format's, not the person's,
 * and the version before it would be the same object under its old name.
 */
async function restoreLegacy(
  layout: Layout,
  handle: string,
  from: string,
  schemaId: PortableSchemaId,
  name: string,
  idIsLive: ((id: string) => boolean) | null,
): Promise<RestoreOutcome> {
  const owner = userOwner(handle);
  const kindRoot = layout.kindRoot(owner, schemaId);

  /**
   * ***The free name is looked for and claimed on the kind's turn*** — the
   * library's own queue (`storage/library-writes.ts`), the one a create of a
   * World and the first-write move take for the same reason (2026-10-10, after
   * review). Chosen on the trash's queue alone, a create of a World named the
   * same could resolve the same folder between the look and the rename, and a
   * POSIX rename onto the empty directory it had just made succeeds without a
   * word — so the refusal below would never be reached.
   */
  let slug: string;
  let reminted: { from: string; to: string; name: string } | null;
  try {
    ({ slug, reminted } = await libraryWrites.run(`kind:${kindRoot}`, async () => {
      // On the same turn as a create of the kind, whose own id check runs
      // there: an import landing this id cannot slip between the look and
      // the move.
      const fresh = idIsLive === null ? null : await remintIfLive(from, schemaId, idIsLive);
      const free = await resolveFreeFolder(kindRoot, name);
      await moveTree(from, layout.objectRoot(owner, schemaId, free));
      return { slug: free, reminted: fresh };
    }));
  } catch (error) {
    // Gone between the look and the rename is the refusal `restoreNow` gives;
    // anything else is the failure it was.
    if (!(await exists(from))) return { ok: false, reason: 'not-found' };
    throw error;
  }
  const to = layout.objectRoot(owner, schemaId, slug);

  /**
   * ***Rewritten in place, then renamed*** — the first write's order
   * (`library.ts`, `relocateLegacy`), so every state this can stop in is one
   * file that reads. Writing `world.json` first and then removing the old file
   * left both for a moment, holding one id, and a crash there was a duplicate
   * the next edit would never resolve (2026-10-10, after review).
   */
  const current = layout.objectFile(owner, schemaId, slug);
  if (!(await exists(current))) {
    for (const legacyName of objectFilenames(schemaId).slice(1)) {
      const carried = layout.objectFileIn(kindRoot, slug, legacyName);
      const bytes = await readFileBytes(carried);
      if (bytes === null) continue;
      let body: unknown;
      try {
        body = JSON.parse(new TextDecoder().decode(bytes));
      } catch {
        break;
      }
      await writeJsonAtomic(carried, upgradeLegacySchema(body));
      if (!(await fileExists(current))) await renamePath(carried, current);
      break;
    }
  }

  return {
    ok: true,
    path: to,
    restored: { kind: 'object', schemaId, slug },
    ...(reminted === null ? {} : { reminted }),
  };
}

/**
 * ***A legacy entry whose id is held again comes back under a new one*** —
 * 2026-10-11, the [P16 audit] (safety finding 1).
 *
 * **What happened without it.** A Package trashed under alpha 6, then the
 * `.sepack.json` exported before the delete (or a backup taken before it)
 * imported on this build: the import sees no live row for the id — the old
 * one is tombstoned, or matured away — and lands it as a World, which the
 * person then plays in. Restoring the trash entry then found a free folder
 * (the fresh-slug rule above, *never occupied*), rewrote the body under the
 * **same id**, and answered *restored*. Two Worlds, one id, and the index's
 * tie-break by path put `rain-city-2/` before `rain-city/` — so the stale copy
 * took the id over, and every by-id read, edit, start and publish went to it,
 * the World with the person's session in it shadowed. Gate row 1's walk (a
 * Package in the trash and a pre-P16.0 archive imported) is that sequence.
 *
 * **Re-minted rather than refused**, because a legacy entry must never strand:
 * refusing would leave it in the trash with no remedy — renaming frees no id —
 * which is the stranding [P16 §1.1] built the legacy restore to prevent. So
 * the trashed body is rewritten **in the trash**, before the folder moves into
 * the watched library tree, with a fresh `uuidv7` and its kind's current
 * schema, and the restore lands it as a World of its own. The restore's answer
 * says so (`trash.restore.reminted`), so the person knows the copy they
 * brought back is a second World and not the one they have been using.
 * *Whoever holds the id* (2026-10-11, the review of the audit's fixes): ids
 * are the install's, so the look is the index's whole table, and the holder
 * may be another account's import of the same file — the re-mint is right
 * either way, and the note's params and the client's sentence name nothing
 * of whose it is.
 *
 * *Only the body's own `id`.* Its history stays as it is and names the old id
 * — ~~restoring one of its earlier versions is refused (*an object cannot
 * change its id*), which is said in the report rather than repaired here~~:
 * a version restored is restored under the object's own id (`library.ts`,
 * `restoreVersion`, 2026-10-11, the review of the audit's fixes), because a
 * history is content-addressed and rewriting it here would re-address every
 * payload for nothing the restore needs. A body that
 * will not parse, or has no string `id`, is left for the rename below to land
 * as it does today.
 */
async function remintIfLive(
  from: string,
  schemaId: PortableSchemaId,
  idIsLive: (id: string) => boolean,
): Promise<{ from: string; to: string; name: string } | null> {
  for (const filename of objectFilenames(schemaId)) {
    const path = join(from, filename);
    const bytes = await readFileBytes(path);
    if (bytes === null) continue;
    let body: unknown;
    try {
      body = JSON.parse(new TextDecoder().decode(bytes));
    } catch {
      return null;
    }
    if (typeof body !== 'object' || body === null || Array.isArray(body)) return null;
    const id = (body as { id?: unknown }).id;
    if (typeof id !== 'string' || !idIsLive(id)) return null;
    const fresh = uuidv7();
    const name = (body as { name?: unknown }).name;
    await writeJsonAtomic(path, { ...upgradeLegacySchema(body), id: fresh });
    return { from: id, to: fresh, name: typeof name === 'string' ? name : '' };
  }
  return null;
}

/**
 * ***An address that is not one, told apart from everything else that can go
 * wrong in a restore*** (2026-09-27). The route caught every throw as this one
 * and answered *That is not an address in the trash*, so a rename refused by a
 * scanner holding the folder on Windows, or a full disk, told the person their
 * trash entry did not exist and wrote nothing to the log.
 */
export class TrashAddressError extends Error {
  constructor() {
    super('That is not an address in the trash.');
    this.name = 'TrashAddressError';
  }
}

/** `kind/entry`, refusing anything that is not exactly that. */
function splitTrashId(id: string): [string, string] {
  const parts = id.split('/');
  const kind = parts[0] ?? '';
  const entry = parts[1] ?? '';
  if (parts.length !== 2 || !trashKinds().includes(kind) || entry === '' || entry.includes('..')) {
    throw new TrashAddressError();
  }
  return [kind, entry];
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

/**
 * ***The sweep, on a timer*** — [P11.7].
 *
 * **Once at startup and then daily**, which is `startMaturation`'s arrangement
 * and for one of its two reasons: an entry that expired while the server was
 * down has no timer coming for it. The second reason does not apply — the trash
 * has no watcher to fall back on, which is exactly why nothing has ever swept.
 *
 * ***~~Once at startup~~ — there was no pass at startup until 2026-09-27.***
 * The only timer was the daily interval, so a server that never stayed up for
 * a day never swept: a laptop shut down at night, a NAS whose nightly backup
 * stops its containers, a host updated daily. The trash kept everything, and
 * the trash page went on listing entries as past their window. The first pass
 * now comes a minute after the start ({@link TRASH_SWEEP_START_DELAY_MS}).
 *
 * ***And a pass is skipped when the wall clock has jumped*** (2026-09-27). The
 * window is measured against `Date.now()`, so a clock that leapt forward past
 * it would empty the trash of everything still somebody's to restore;
 * `wall-clock.ts` says how a jump is told from time passing, and why only one
 * pass is skipped.
 *
 * **Daily rather than hourly**, because the window is measured in days: a sweep
 * sixteen times finer than the thing it is measuring buys nothing and costs a
 * `readdir` per account per hour on an install that may have a hundred.
 *
 * ***`unref`ed***, the rule every timer in this build follows: housekeeping over
 * somebody's deleted files must never be the reason a process asked to exit
 * stays alive.
 *
 * **The config is read per pass rather than captured**, because
 * `trash.retentionDays` is tiered `live` — a number copied in at construction
 * is what makes a live tier untrue, which is the mistake `watcher.ts` records
 * about `history.keepPerObject`.
 */
export interface TrashSweep {
  /** Runs one pass now over every account, and answers what it took. */
  runOnce(): Promise<string[]>;
  /** Where the timed passes say what they did, once a logger exists. */
  setLogger(log: Logger): void;
  stop(): void;
}

export const TRASH_SWEEP_INTERVAL_MS = 24 * 60 * 60 * 1000;

/**
 * How long after a start the first pass waits. Off the boot path, for
 * `START_BACKUP_DELAY_MS`'s reasons: a start already reads every session and
 * checks the index, and a server in a restart loop must not become a loop of
 * deletions. A minute rather than the backup's thirty seconds, so the two do
 * not land together.
 */
export const TRASH_SWEEP_START_DELAY_MS = 60_000;

export function startTrashSweep(
  layout: Layout,
  handles: () => Promise<string[]>,
  retentionDays: () => number,
  options: { intervalMs?: number; startDelayMs?: number; clock?: WallClockWatch } = {},
): TrashSweep {
  let stopped = false;
  let log: Logger | null = null;
  const clock = options.clock ?? watchWallClock();

  const runOnce = async (): Promise<string[]> => {
    const days = retentionDays();
    if (days <= 0) return [];
    const taken: string[] = [];
    for (const handle of await handles()) {
      if (stopped) break;
      taken.push(...(await sweepTrash(layout, handle, days, Date.now())));
    }
    return taken;
  };

  /** A timed pass: the clock is asked first, and what happened is said. */
  const pass = async (): Promise<void> => {
    if (clock.jumped()) {
      log?.warn(
        { event: 'trash.clockJumped' },
        'The clock moved unlike time passing, so this trash sweep was skipped',
      );
      return;
    }
    const taken = await runOnce();
    if (taken.length > 0) {
      log?.info({ event: 'trash.swept', count: taken.length }, 'Removed expired trash');
    }
  };
  const run = (): void => {
    void pass().catch((error: unknown) => {
      log?.error(
        { event: 'trash.sweepFailed', message: error instanceof Error ? error.message : '' },
        'A trash sweep failed',
      );
    });
  };

  const first = setTimeout(run, options.startDelayMs ?? TRASH_SWEEP_START_DELAY_MS);
  first.unref();
  const timer = setInterval(run, options.intervalMs ?? TRASH_SWEEP_INTERVAL_MS);
  timer.unref();

  return {
    runOnce,
    setLogger: (next) => {
      log = next;
    },
    stop: () => {
      stopped = true;
      clearTimeout(first);
      clearInterval(timer);
    },
  };
}
