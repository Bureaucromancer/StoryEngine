// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { lstat, open, stat, writeFile, type FileHandle } from 'node:fs/promises';
import { extname, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Worker } from 'node:worker_threads';

import type { ImportNote } from '@storyengine/shared';

import { freeBytes } from './files.js';
import { openImportScratch, type ScratchSpace } from './import-scratch.js';
import type { Layout } from './layout.js';
import type { SnapshotTask, SnapshotTaskOutcome } from './sqlite-snapshot-worker.js';

export type { SnapshotTask, SnapshotTaskOutcome } from './sqlite-snapshot-worker.js';

/**
 * ***A private, consistent copy of somebody else's SQLite database*** —
 * [P13 §1.2](../../../../docs/design/workplan/30-p13-aventuras-import.md).
 *
 * **The reader never opens the source database for anything but a copy.**
 * Aventuras keeps a person's whole install in one SQLite file, and it is
 * usually open while we read it: the app runs in WAL mode, so recent commits
 * live in `aventura.db-wal` until a checkpoint moves them, and a reader that
 * took the main file alone would miss them — quietly, since the file it read
 * is a perfectly good older database. So the reader gets a path to a copy that
 * is ours, in our scratch (`import-scratch.ts`), which it may open with
 * `node:sqlite` however it likes and which nothing else is writing.
 *
 * ***Four ways in, two ways to make the copy.***
 *
 * | Input | Route | What it costs |
 * |---|---|---|
 * | a real path — a server-path sweep — beside which a read-only open makes no file | **vacuum**: open read-only, `VACUUM INTO` a scratch file | nothing; no note |
 * | a real path otherwise, or when that open fails | **copy**: the file and its `-wal`, then replay and `quick_check` | a `warn` note when a log was copied |
 * | bytes — an upload, a zip entry | **bytes**: written to scratch, then replay and `quick_check` | the same |
 * | a file already in scratch — [P13.8]'s landing | **owned**: replay and `quick_check` where it lies | the same |
 *
 * `VACUUM INTO` is Aventuras' own backup method and the one route that is
 * consistent while the app is writing: SQLite's locking gives the copy a single
 * point in time, committed frames still in the log are in it, and no byte
 * passes through our heap. Everything else is a copy of files that may have
 * been changing while they were copied, and the doc's answer to that is the
 * pair of checks below — to which the copy route adds a third of its own
 * ({@link copyWithLog}).
 *
 * ***What a read-only open does beside the source, which is not nothing*** —
 * found at review, 2026-09-29, and why the vacuum route is not always taken.
 * A connection to a WAL database, a read-only one included, reads through the
 * `-wal` and the `-shm`, and SQLite **creates both when they are missing**: in
 * the owner's directory, made by our process, and left there when the
 * read-only connection closes, since only a writer removes them. A cleanly
 * closed Aventuras leaves neither, so the ordinary case — close the app, then
 * import — left two files in somebody's config directory; and where the server
 * runs as a different user from Aventuras, in a directory both may write, a
 * `-wal` Aventuras cannot write is a database it cannot open for writing.
 * (Running as root, SQLite hands what it creates to the database's owner, and
 * the harm is only the clutter.) So the vacuum route is taken **only when it
 * creates nothing**: a rollback-journal database, which a read-only open reads
 * without side files, or a WAL database whose `-wal` and `-shm` are both there
 * already — a running app's, which every reader of a live WAL database shares,
 * or a crash's, whose `-shm` SQLite rebuilds. Anything else is copied, and
 * nothing is made beside it. The database itself is never written either way:
 * a read-only connection cannot checkpoint, and the `-shm` it may rewrite is
 * the index of the log, not data.
 *
 * ***Why a `-wal` is never a refusal***, and what is. Marinara refuses a live
 * install because it marks one — `.writer-lease` — and reading around a lease
 * produces a torn library. Aventuras marks nothing: every crash and every open
 * app leaves a `-wal`, so refusing on one would refuse most real config
 * directories. The rule is the snapshot's instead. A `VACUUM INTO` that
 * succeeded needs no note. A copy that replayed a log and passed `quick_check`
 * carries `import.aventuras.walCopied` at `warn`: Aventuras may have been open,
 * and the person can close it and import again. A copy that fails the check,
 * or whose source changed while it was copied, refuses as `live-install`, whose
 * sentence already says the right thing. A file that is not SQLite at all
 * refuses as `unreadable-root`.
 *
 * ***Room first*** — `backup/archive.ts`'s `assertRoom` rule of 2026-09-27,
 * and for its reason: a full disk is what stops the server saving turns. A
 * copy is the size of somebody's whole install and a server-path sweep has no
 * ceiling at all ([§1.11]), so the room is found before a byte is written, and
 * {@link SnapshotSpaceError} carries the numbers for a `507`.
 *
 * ***The SQLite work runs on a worker thread*** (§1.2's paragraph of
 * 2026-09-28); see `sqlite-snapshot-worker.ts` for why, and for why that file
 * imports nothing of ours. The file copies stay here, on the main thread,
 * because they are asynchronous already and block nothing.
 *
 * ***Nothing leaks.*** Every file a snapshot makes is inside one scratch
 * directory of its own, and every way out of this module either hands that
 * directory to the caller inside a result with a `dispose()`, or removes it
 * first — a refusal, a failed check and a throw alike.
 */

/**
 * Why a snapshot will not be taken. **A subset of the importer's
 * `SourceRefusal`**, member for member, so the reader passes it through
 * without translating — and declared here rather than imported, because
 * `storage/` sits under `import/` and not beside it. `sqlite-snapshot.test.ts`
 * holds the two together at the type level.
 */
export type SnapshotRefusal =
  /** Not there, not readable, or not a SQLite database by its first sixteen bytes. */
  | 'unreadable-root'
  /**
   * A copy that failed `quick_check`, or a file that changed while it was
   * being copied: taken while it was being written, or damaged.
   */
  | 'live-install';

/** Which way the copy was made — the table above, one word each. */
export type SnapshotRoute = 'vacuum' | 'copy' | 'bytes' | 'owned';

/** What the caller has to hand over. */
export type SnapshotInput =
  /**
   * **A real, absolute path to a database somebody else owns** — a server-path
   * sweep's `aventura.db`, through `LocalSource.realPath`. Read, and never
   * written: opened read-only when that makes no file beside it, and otherwise
   * copied with its `-wal`.
   */
  | { kind: 'path'; path: string }
  /**
   * **Bytes, and the log that came with them if one did.** An uploaded
   * `aventura.db`, or a zip's entry. A backup zip made by Aventuras is a
   * `VACUUM INTO` of its own and carries no log; a folder somebody copied out
   * of a running install may.
   */
  | { kind: 'bytes'; database: Uint8Array; wal?: Uint8Array | null }
  /**
   * ***A file the server already holds, in a scratch space the caller
   * opened*** — [P13.8]'s streamed landing. Checked where it lies, and **the
   * space is the snapshot's from this call on**: kept and returned inside the
   * result, or removed with a refusal or a throw. A caller must not dispose it
   * after handing it over. `name` is the file's name inside the space; a
   * `<name>-wal` beside it is replayed as the copy routes' is.
   */
  | { kind: 'owned'; space: ScratchSpace; name: string };

/** A snapshot, or why there is none. */
export type SnapshotResult =
  | {
      ok: true;
      /**
       * The copy, which is ours alone to open. One file, any log folded in —
       * except a copy whose header lets SQLite read it and not write it, which
       * keeps its log beside it (`sqlite-snapshot-worker.ts`'s `check`). The
       * reader opens it read-only either way.
       */
      path: string;
      route: SnapshotRoute;
      /** `import.aventuras.walCopied` at `warn` when a log was replayed; else none. */
      notes: readonly ImportNote[];
      /**
       * Removes the copy and everything beside it. The reader's `close()`
       * calls this, after closing its own database handle — on Windows an
       * open handle is a file that cannot be removed.
       */
      dispose(): Promise<void>;
    }
  | { ok: false; refusal: SnapshotRefusal };

/**
 * What became of copying one file out of somebody else's directory:
 * `'gone'` when it was not there to open, `'unreadable'` when it was and could
 * not be read. A failure on **our** side — no room, our disk — is thrown
 * instead; see {@link copySourceFile}.
 */
export type FileCopyOutcome = 'copied' | 'gone' | 'unreadable';

/**
 * The seams, each for a condition a test cannot make happen for real.
 *
 * `backup/archive.ts` takes `freeBytes` the same way, and for the same kind of
 * reason.
 *
 * - **`run`** — how a task reaches SQLite. The copy route exists above all for
 *   a read-only mount on which SQLite cannot open the file read-only, and a
 *   test running as root — which a container's usually is — cannot make that
 *   happen, since root reads through every permission. So a test wraps
 *   {@link runInWorker} and fails the one task it has to.
 * - **`freeBytes`** — how full the disk is; nobody fills a disk to test that
 *   the snapshot will not.
 * - **`copy`** — one file copied out of the source directory. A test wraps
 *   {@link copySourceFile} to write to the source *between* two copies, which
 *   is the race {@link copyWithLog} has to answer, or to fail one as a disk
 *   would.
 */
export interface SnapshotSeams {
  run?: (task: SnapshotTask) => Promise<SnapshotTaskOutcome>;
  freeBytes?: (path: string) => Promise<number | null>;
  copy?: (from: string, to: string) => Promise<FileCopyOutcome>;
}

/**
 * What the server keeps free for its own writes when it decides whether a
 * snapshot fits — `backup/archive.ts`'s `BACKUP_FREE_RESERVE_BYTES`, restated
 * rather than imported because `storage/` sits beneath `backup/`, and the same
 * figure for the same reason: a turn, a session, the index.
 */
export const SNAPSHOT_FREE_RESERVE_BYTES = 64 * 1024 * 1024;

/**
 * ***Not enough room to copy this database without filling the disk***, found
 * before a byte of it was written — the snapshot's `BackupSpaceError`, and for
 * the route to answer the same way: `507`, with the numbers.
 */
export class SnapshotSpaceError extends Error {
  readonly needed: number;
  readonly free: number;

  constructor(needed: number, free: number) {
    super(
      `There is not enough free space on the disk to copy this database: it could need ${megabytes(needed)} and ${megabytes(free)} is free.`,
    );
    this.name = 'SnapshotSpaceError';
    this.needed = needed;
    this.free = free;
  }
}

function megabytes(bytes: number): string {
  return `${String(Math.ceil(bytes / (1024 * 1024)))} MB`;
}

/**
 * SQLite's file header: the sixteen bytes every database begins with.
 *
 * *"SQLite format 3"* and a NUL. Checked before anything is copied, so a file
 * that merely has the right name — a zero-byte `aventura.db`, an HTML error
 * page somebody saved under it — is refused for what it is rather than copied
 * and then misreported as a torn database.
 */
const SQLITE_HEADER = new TextEncoder().encode('SQLite format 3\0');

/**
 * How much of a database's header is read: all hundred bytes of it, of which
 * this module looks at the magic and at bytes 18 and 19 — the file format's
 * write and read versions, both `2` for a database in WAL mode.
 */
const HEADER_BYTES = 100;

/**
 * Whether bytes begin like a SQLite database.
 *
 * Beside `storage/zip.ts`'s `looksLikeZip`, and for the same caller: [P13.7]'s
 * bare-`.db` upload sniffs with it before choosing a transport.
 */
export function looksLikeSqlite(bytes: Uint8Array): boolean {
  if (bytes.length < SQLITE_HEADER.length) return false;
  return SQLITE_HEADER.every((byte, at) => bytes[at] === byte);
}

/** Whether a header says WAL mode — the only mode in which a reader needs side files. */
function inWalMode(head: Uint8Array): boolean {
  return head[18] === 2 && head[19] === 2;
}

/**
 * The names a copy takes inside its space — the route, readable in a listing
 * of what a crash left. They need not differ for safety: the copy route
 * never reuses the space a failed `VACUUM INTO` wrote into ({@link tryVacuum}).
 */
const VACUUM_NAME = 'vacuum.sqlite';
const COPY_NAME = 'copy.sqlite';

/**
 * Takes the snapshot — see the file header for the routes.
 *
 * **Throws only for what is ours to fix**: no room in the data directory
 * ({@link SnapshotSpaceError}), a disk that failed under our copy, a worker
 * that could not start, a scratch directory that cannot be written. What is
 * wrong with the *source* is a refusal, returned. Either way nothing is left
 * behind in scratch.
 */
export async function snapshotDatabase(
  layout: Layout,
  input: SnapshotInput,
  seams: SnapshotSeams = {},
): Promise<SnapshotResult> {
  const tools: Tools = {
    layout,
    run: seams.run ?? runInWorker,
    freeBytes: seams.freeBytes ?? freeBytes,
    copy: seams.copy ?? copySourceFile,
  };
  switch (input.kind) {
    case 'path':
      return fromPath(tools, input.path);
    case 'bytes':
      return fromBytes(tools, input.database, input.wal ?? null);
    case 'owned':
      return fromOwned(tools, input.space, input.name);
  }
}

interface Tools {
  layout: Layout;
  run: (task: SnapshotTask) => Promise<SnapshotTaskOutcome>;
  freeBytes: (path: string) => Promise<number | null>;
  copy: (from: string, to: string) => Promise<FileCopyOutcome>;
}

async function fromPath(tools: Tools, source: string): Promise<SnapshotResult> {
  // A relative path would mean whatever the worker's cwd is, which is the same
  // refusal `openLocalSource` makes and for the same reason. A caller bug, not
  // a property of the source, so it throws.
  if (!isAbsolute(source)) {
    throw new Error('A database to snapshot is named by an absolute path.');
  }
  const file = await readHead(source);
  if (file === null || !looksLikeSqlite(file.head)) return refused('unreadable-root');
  const beside = await besideOf(source);
  if (beside === 'not-a-file') return refused('unreadable-root');

  /**
   * *The file, and its log twice*: the copy route holds both, and folding the
   * log in can grow the file by up to the log's size before the log is
   * truncated. `VACUUM INTO` needs no more than that, and a fallback removes
   * what a failed one wrote before it starts.
   */
  await assertRoom(tools, file.size + 2 * (beside.wal ?? 0));

  if (!(inWalMode(file.head) && (beside.wal === null || !beside.shm))) {
    const vacuumed = await tryVacuum(tools, source);
    if (vacuumed !== null) return vacuumed;
  }
  return copyRoute(tools, source);
}

/**
 * SQLite result codes a failed `VACUUM INTO` can only mean about **our** side:
 * out of memory, and the disk full or failing under the file it was writing.
 * The source is open read-only, so nothing is ever written to it, and a write
 * or an `fsync` that failed was ours.
 *
 * *Why these throw rather than fall back* — found at review, 2026-09-29. The
 * fallback copies the whole database into the same volume, so after a
 * `SQLITE_FULL` it filled the disk a second time before `ENOSPC` stopped it;
 * and after any of these, a copy that replayed a log said *"close Aventuras
 * and import again"* for a fault that was ours — which is what `OUR_FAULT`
 * exists to prevent on the check, and was not applied here. Everything else —
 * cannot open, read-only (a read-only mount's `SQLITE_READONLY_*` codes among
 * them), busy, a damaged source — is the source's, and the copy route may be
 * able to answer it.
 */
const SQLITE_NOMEM = 7;
const SQLITE_FULL = 13;
const SQLITE_IOERR_WRITE = 778;
const SQLITE_IOERR_FSYNC = 1034;
const SQLITE_IOERR_NOMEM = 3082;

function vacuumFailedOnOurSide(errcode: number | null): boolean {
  if (errcode === null) return false;
  const primary = errcode & 0xff;
  if (primary === SQLITE_NOMEM || primary === SQLITE_FULL) return true;
  return (
    errcode === SQLITE_IOERR_WRITE ||
    errcode === SQLITE_IOERR_FSYNC ||
    errcode === SQLITE_IOERR_NOMEM
  );
}

/**
 * Route (a), or `null` when it failed in a way the copy route may answer.
 *
 * ***The fallback, and why a failure here is not a refusal.*** The usual cause
 * is a read-only mount — a container given the Aventuras directory `:ro` — on
 * which SQLite cannot take the locks or build the index a read-only connection
 * still needs; measured on this build as `SQLITE_CANTOPEN`. The files are still
 * readable, so they are copied and SQLite replays the log on a copy it is
 * allowed to write.
 *
 * **The copy starts in a fresh space.** A `VACUUM INTO` that failed part way
 * can leave most of the database behind, and a `-journal` beside it that
 * SQLite would read as hot; removing the whole space, rather than the files
 * this code knows the names of, is `import-scratch.ts`'s reason for spaces.
 */
async function tryVacuum(tools: Tools, source: string): Promise<SnapshotResult | null> {
  const space = await openImportScratch(tools.layout);
  try {
    const target = space.path(VACUUM_NAME);
    const outcome = await tools.run({ op: 'vacuum', source, target });
    if (outcome.ok) return held(space, target, 'vacuum', false);
    if (vacuumFailedOnOurSide(outcome.errcode)) {
      throw new Error(`The database could not be copied: ${outcome.message}`);
    }
  } catch (error) {
    await space.dispose().catch(() => undefined);
    throw error;
  }
  await space.dispose();
  return null;
}

async function copyRoute(tools: Tools, source: string): Promise<SnapshotResult> {
  const space = await openImportScratch(tools.layout);
  try {
    const target = space.path(COPY_NAME);
    const copied = await copyWithLog(tools, source, target);
    if (copied === 'unreadable' || copied === 'moved') {
      await space.dispose();
      return refused(copied === 'moved' ? 'live-install' : 'unreadable-root');
    }
    return await checked(tools, space, target, 'copy', copied === 'with-log');
  } catch (error) {
    await space.dispose().catch(() => undefined);
    throw error;
  }
}

async function fromBytes(
  tools: Tools,
  database: Uint8Array,
  wal: Uint8Array | null,
): Promise<SnapshotResult> {
  if (!looksLikeSqlite(database)) return refused('unreadable-root');
  const log = wal?.length ?? 0;
  await assertRoom(tools, database.length + 2 * log);

  const space = await openImportScratch(tools.layout);
  try {
    const target = space.path(COPY_NAME);
    // `wx`: the space is new, so a file already there is a bug worth hearing.
    await writeFile(target, database, { flag: 'wx' });
    // The log is written under the name SQLite looks for beside the file. Its
    // header names no database, so it replays against the renamed copy.
    if (wal !== null && log > 0) await writeFile(`${target}-wal`, wal, { flag: 'wx' });
    return await checked(tools, space, target, 'bytes', log > 0);
  } catch (error) {
    await space.dispose().catch(() => undefined);
    throw error;
  }
}

async function fromOwned(tools: Tools, space: ScratchSpace, name: string): Promise<SnapshotResult> {
  try {
    const target = space.path(name);
    const file = await readHead(target);
    if (file === null || !looksLikeSqlite(file.head)) {
      await space.dispose();
      return refused('unreadable-root');
    }
    const beside = await besideOf(target);
    if (beside === 'not-a-file') {
      await space.dispose();
      return refused('unreadable-root');
    }
    /**
     * The landing was the caller's to make room for — [P13.8] asks for 1.1×
     * the upload before it writes — so what is counted here is only what the
     * check adds: folding a log in, which can grow the file by the log's size.
     * With no log it adds nothing, and a disk the landing left under the
     * reserve is not a reason to refuse a check that writes nothing.
     */
    const log = beside.wal ?? 0;
    if (log > 0) await assertRoom(tools, log);
    return await checked(tools, space, target, 'owned', log > 0);
  } catch (error) {
    await space.dispose().catch(() => undefined);
    throw error;
  }
}

/**
 * Room for `bytes` more, and the reserve, or {@link SnapshotSpaceError}.
 *
 * **A filesystem that will not say how much is free is not a refusal**, which
 * is `freeBytes`' rule and `assertRoom`'s in `backup/archive.ts`.
 */
async function assertRoom(tools: Tools, bytes: number): Promise<void> {
  const free = await tools.freeBytes(tools.layout.dataRoot);
  if (free === null) return;
  const needed = SNAPSHOT_FREE_RESERVE_BYTES + bytes;
  if (free < needed) throw new SnapshotSpaceError(needed, free);
}

/**
 * SQLite's primary result codes for a failure that is **our** disk's or our
 * process's rather than the source's: busy, locked, out of memory, read-only,
 * I/O, full, cannot open. The copy being checked is a private file in our
 * scratch, so any of these while checking it is a fault here — and calling it
 * `live-install` would send somebody off to close an app that had nothing to
 * do with it. (A source whose own header forbids writing is not among them:
 * the worker leaves such a copy as it lies rather than fail to fold its log.)
 */
const OUR_FAULT = new Set([5, 6, 7, 8, 10, 13, 14]);

/**
 * `quick_check` on a copy, and the verdict: the copy, or `live-install`.
 *
 * *`quick_check`, which is what §1.2 names, rather than `integrity_check`* —
 * and the right trade: it finds a torn page, a broken b-tree and a file cut
 * short, which is what copying a file mid-write produces, in time linear in the
 * database, and skips the index-content cross-checks that make
 * `integrity_check` far slower on a large file.
 */
async function checked(
  tools: Tools,
  space: ScratchSpace,
  target: string,
  route: SnapshotRoute,
  replayed: boolean,
): Promise<SnapshotResult> {
  const outcome = await tools.run({ op: 'check', path: target });
  if (outcome.ok) return held(space, target, route, replayed);
  // An extended result code carries its primary code in the low byte.
  if (outcome.errcode !== null && OUR_FAULT.has(outcome.errcode & 0xff)) {
    throw new Error(`The copy of the database could not be checked: ${outcome.message}`);
  }
  await space.dispose();
  return refused('live-install');
}

function held(
  space: ScratchSpace,
  path: string,
  route: SnapshotRoute,
  replayed: boolean,
): SnapshotResult {
  return {
    ok: true,
    path,
    route,
    notes: replayed ? [{ key: 'import.aventuras.walCopied', params: {}, level: 'warn' }] : [],
    dispose: () => space.dispose(),
  };
}

function refused(refusal: SnapshotRefusal): SnapshotResult {
  return { ok: false, refusal };
}

/**
 * The copy route's copy: the log, then the file, never the `-shm` — and the
 * file's own record checked on either side of it.
 *
 * **Not the `-shm`** because it is not data. It is the index of the log that
 * the processes sharing the database keep in memory, and a copy of a live
 * one describes a log that has moved on since; without it SQLite rebuilds the
 * index from the log's own frames, checking each one, and stops at the last
 * whole commit — which is the recovery a crash gets, and exactly what a copy
 * taken mid-write needs.
 *
 * ***The file's size, modification time and inode, before and after*** — added
 * at review, 2026-09-29. In WAL mode the main file is written only by a
 * checkpoint, and a checkpoint that ran while the copy was being taken is the
 * one way this route can hand back pages from two moments: some of the file
 * from before it and some from after, or a log copied before it replayed over
 * a file copied after. `quick_check` catches such a copy when the moments
 * disagree about the tree, and not when they agree about the tree and disagree
 * about the rows. So the file's record is taken before the first byte is
 * copied and again after the last, and a file that changed in between refuses
 * as `live-install` — a copy taken while it was being written, which is that
 * refusal's own sentence. It also closes the race the copy route's
 * no-`VACUUM` case opens: a database closed cleanly is copied rather than
 * opened, and an Aventuras started while it is copied is noticed here. What
 * it cannot see is a write inside one tick of the filesystem's clock that
 * changes no size, which is `quick_check`'s to find.
 *
 * ***The log first***, which the record above now covers and which still costs
 * nothing: a checkpoint moves pages *from* the log, so a log copied first holds
 * every frame a checkpoint during the file's copy could have moved.
 *
 * **A log that is there and cannot be copied refuses**, since the file without
 * it is the database as of its last checkpoint: whole, plausible and quietly
 * older, which is the loss the log is carried to prevent.
 */
async function copyWithLog(
  tools: Tools,
  source: string,
  target: string,
): Promise<'alone' | 'with-log' | 'unreadable' | 'moved'> {
  let before = await fingerprint(source);
  const beside = await besideOf(source);
  if (beside === 'not-a-file') return 'unreadable';
  let replayed = false;
  if (beside.wal !== null && beside.wal > 0) {
    const log = await tools.copy(`${source}-wal`, `${target}-wal`);
    if (log === 'unreadable') return 'unreadable';
    replayed = log === 'copied';
    // Gone between the look and the copy: the app closed, and closing
    // checkpoints the log into the file first. The file alone is whole from
    // here, so its record is taken again from here.
    if (log === 'gone') before = await fingerprint(source);
  }
  if ((await tools.copy(source, target)) !== 'copied') return 'unreadable';
  if (!unmoved(before, await fingerprint(source))) return 'moved';
  return replayed ? 'with-log' : 'alone';
}

/** What a file's metadata says about whether it was written: size, modification time, inode. */
interface Fingerprint {
  size: bigint;
  mtimeNs: bigint;
  ino: bigint;
}

async function fingerprint(path: string): Promise<Fingerprint | null> {
  try {
    const facts = await stat(path, { bigint: true });
    return { size: facts.size, mtimeNs: facts.mtimeNs, ino: facts.ino };
  } catch {
    return null;
  }
}

function unmoved(before: Fingerprint | null, after: Fingerprint | null): boolean {
  return (
    before !== null &&
    after !== null &&
    before.size === after.size &&
    before.mtimeNs === after.mtimeNs &&
    before.ino === after.ino
  );
}

/** A megabyte at a time: enough to keep the copy quick, bounded however large the file. */
const COPY_CHUNK_BYTES = 1024 * 1024;

/**
 * Errors reading the **source** that describe the source: not permitted, not
 * a file, a disk that failed under somebody else's file. Anything else from
 * the source — out of file handles, out of memory — is ours, and thrown.
 */
const SOURCE_SIDE = new Set(['EACCES', 'EPERM', 'EISDIR', 'ENOTDIR', 'ELOOP', 'EIO']);

/**
 * One file out of somebody else's directory into our scratch, **each failure
 * blamed on the side it happened on** — found at review, 2026-09-29.
 *
 * This was `fs.copyFile`, which is one call for both ends, and a single set of
 * error codes read as "the source's" was applied to all of it: an `EIO` on our
 * own disk came back as `unreadable-root`, which blames the folder somebody
 * pointed at for a fault in ours. So the two ends are opened and driven here,
 * and which one failed is known rather than guessed. Opening and reading the
 * source are the source's ({@link SOURCE_SIDE}); creating and writing the
 * target are ours, and throw — `ENOSPC` among them, which a route answers as
 * the backup route does, with `507`.
 *
 * The bytes pass through one megabyte of buffer at a time, never the whole
 * file; the kernel copy `copyFile` made is the price of knowing which side
 * failed, on the route that is the fallback.
 */
export async function copySourceFile(from: string, to: string): Promise<FileCopyOutcome> {
  let source: FileHandle;
  try {
    source = await open(from, 'r');
  } catch (error) {
    if (errno(error) === 'ENOENT') return 'gone';
    return fromTheSource(error);
  }
  try {
    // `wx`: the space is new, so a file already there is a bug worth hearing.
    const target = await open(to, 'wx');
    try {
      const chunk = new Uint8Array(COPY_CHUNK_BYTES);
      let at = 0;
      for (;;) {
        let read: number;
        try {
          read = (await source.read(chunk, 0, chunk.length, at)).bytesRead;
        } catch (error) {
          return fromTheSource(error);
        }
        if (read === 0) return 'copied';
        let written = 0;
        while (written < read) {
          written += (await target.write(chunk, written, read - written, at + written))
            .bytesWritten;
        }
        at += read;
      }
    } finally {
      await target.close();
    }
  } finally {
    await source.close().catch(() => undefined);
  }
}

function fromTheSource(error: unknown): 'unreadable' {
  if (SOURCE_SIDE.has(errno(error) ?? '')) return 'unreadable';
  throw error;
}

function errno(error: unknown): string | undefined {
  return (error as NodeJS.ErrnoException | null)?.code;
}

/**
 * What is beside a database: its `-wal`'s size, `null` when there is none, and
 * whether a `-shm` is there — or `'not-a-file'` when something other than a
 * file has the log's name.
 *
 * **`lstat`, so a link is not followed.** `realPath` vouched for the database
 * and not for a `-wal` beside it; a log that is a link, or a directory, is not
 * one this copy will read, and it is not one it may silently leave out either
 * — so it refuses, for the reason {@link copyWithLog} gives. A `-shm` is only
 * asked about, never read, so anything but a file there counts as none.
 */
async function besideOf(
  database: string,
): Promise<{ wal: number | null; shm: boolean } | 'not-a-file'> {
  const wal = await sizeIfFile(`${database}-wal`);
  if (wal === 'not-a-file') return 'not-a-file';
  const shm = await sizeIfFile(`${database}-shm`);
  return { wal, shm: typeof shm === 'number' };
}

async function sizeIfFile(path: string): Promise<number | null | 'not-a-file'> {
  let facts;
  try {
    facts = await lstat(path);
  } catch (error) {
    return errno(error) === 'ENOENT' ? null : 'not-a-file';
  }
  return facts.isFile() ? facts.size : 'not-a-file';
}

/**
 * The first hundred bytes of a file, as many as it has, and its size; `null`
 * if it is unreadable or is not a regular file — asked first, because opening
 * a named pipe for reading waits for a writer that may never come.
 */
async function readHead(path: string): Promise<{ head: Uint8Array; size: number } | null> {
  let handle: FileHandle | undefined;
  try {
    const facts = await stat(path);
    if (!facts.isFile()) return null;
    handle = await open(path, 'r');
    const head = new Uint8Array(HEADER_BYTES);
    const { bytesRead } = await handle.read(head, 0, head.length, 0);
    return { head: head.subarray(0, bytesRead), size: facts.size };
  } catch {
    return null;
  } finally {
    await handle?.close();
  }
}

/**
 * The worker's file, **by the extension this module was loaded with**.
 *
 * `.js` when the server runs from `dist`, `.ts` under vitest and under `tsx`
 * in development — and Node can start either as a worker, stripping the types
 * of the second itself. Deriving the name from `import.meta.url` rather than
 * hard-coding either is what lets one line serve all three; hard-coding `.js`
 * is the version that works in production and fails every test, and
 * hard-coding `.ts` the other way round — which is why
 * `sqlite-snapshot.dist.test.ts` takes a snapshot through the built module.
 */
const WORKER_URL = new URL(
  `./sqlite-snapshot-worker${extname(fileURLToPath(import.meta.url))}`,
  import.meta.url,
);

/**
 * ***The worker's flags: this one, and none of the server's.***
 *
 * *None of the server's* — found at review, 2026-09-29. Node refuses a worker
 * whose `execArgv` names a process-wide or V8 flag — `--max-old-space-size`,
 * `--stack-size`, `--title` — with `ERR_WORKER_INVALID_EXEC_ARGV`, and this
 * used to spread `process.execArgv` in: an operator who raised the heap for a
 * large import made every snapshot fail. The worker needs none of them. It
 * imports only `node:` built-ins, so it takes no loader flag, and its work is
 * done in SQLite's own memory rather than in the heap a V8 flag sizes.
 *
 * *This one* because `node:sqlite` announces itself as experimental on the
 * Node versions this is developed and tested on below the one it targets —
 * this container's 22, where each snapshot's fresh isolate printed the warning
 * again to stderr, outside the JSON log. It is not a claim about the target:
 * where Node no longer warns, the flag silences nothing, and the worker loads
 * nothing else that could raise an `ExperimentalWarning` for it to hide.
 */
const WORKER_EXEC_ARGV = ['--disable-warning=ExperimentalWarning'];

/**
 * Runs one task on a worker thread of its own, and answers what it said.
 *
 * **Rejects only when the worker itself failed** — it could not load, it
 * crashed, it exited without answering. A SQLite error is an answer, and comes
 * back resolved as `{ ok: false }`. The distinction is the difference between
 * *this database cannot be copied that way* and *this server cannot copy
 * anything*, and only the first may be answered with a fallback.
 *
 * `script` is the worker's module, and is a parameter for the tests that load
 * a worker which fails in each of those ways; everything else takes the
 * default.
 */
export function runInWorker(
  task: SnapshotTask,
  script: URL = WORKER_URL,
): Promise<SnapshotTaskOutcome> {
  return new Promise((resolve, reject) => {
    let answered = false;
    const worker = new Worker(script, {
      workerData: { snapshotTask: task },
      execArgv: WORKER_EXEC_ARGV,
    });
    worker.once('message', (outcome: SnapshotTaskOutcome) => {
      answered = true;
      resolve(outcome);
    });
    worker.once('error', reject);
    // Node delivers everything a worker posted before it reports the exit, so
    // an exit with no answer is a worker that never gave one.
    worker.once('exit', (code) => {
      if (!answered) {
        reject(new Error(`The SQLite snapshot worker exited (${String(code)}) without answering.`));
      }
    });
  });
}
