// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import type { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';

import {
  BACKUP_MANIFEST_MEMBER,
  BACKUP_MANIFEST_SCHEMA,
  readBackupManifest,
  type BackupContents,
  type BackupManifest,
  type BackupReason,
  type BackupScope,
  createUuidv7,
  type ImportNote,
  uuidv7Timestamp,
} from '@storyengine/shared';

import type { AppServices } from '../app.js';
import type { BuildInfo } from '../build-info.js';
import {
  freeBytes,
  listDirectoryNames,
  listEntryNames,
  listTreeFiles,
  statFile,
  unlinkFile,
  type TreeFile,
} from '../storage/files.js';
import { KeyedQueue } from '../storage/keyed-queue.js';
import { assertValidHandle, INSTANCE_LOCK_NAME, type Layout } from '../storage/layout.js';
import { TarNameError, splitName } from '../storage/tar.js';
import { readTarGz, writeTarGz, type ArchiveMember } from '../storage/tar-archive.js';

/**
 * ***What goes in an archive, and what it is called*** —
 * [25 E6](../../../../docs/design/25-open-questions.md),
 * [P12.2](../../../../docs/design/workplan/29-p12-implementation.md).
 *
 * **The policy half.** `storage/tar-archive.ts` knows how to write a gzipped tar
 * and nothing about scopes, credentials or manifests; this knows all of those
 * and nothing about streams. The split falls out of the no-direct-`fs` rule and
 * is the right one anyway.
 *
 * ***Member names are relative to the data root in both scopes***, which is the
 * decision everything else here follows from. An account archive is a strict
 * **subset** of an install one rather than a differently-shaped thing, so there
 * is one reader, one restore path, one import path, and a subset unpacks into a
 * data directory exactly where it belongs. The cost is a sharp edge —
 * `tools/backup.mjs restore` clears its destination first, so it has to refuse
 * an account archive rather than erase an install for one person's tree — and
 * that edge is worth one refusal.
 */

export interface BackupContext {
  layout: Layout;
  /** The operational store. Snapshotted with `VACUUM INTO`, never copied. */
  state: DatabaseSync;
  build: BuildInfo | null;
  /**
   * How much the disk has free, or null when it will not say — the storage
   * layer's `freeBytes` unless a test says otherwise, because no test can fill
   * a disk to find out what a backup does when it is full.
   */
  freeBytes?: (path: string) => Promise<number | null>;
}

export type BackupOwner = { kind: 'install' } | { kind: 'account'; handle: string };

/**
 * The three things an archive needs from the running server.
 *
 * **A narrowing rather than a field on `AppServices`**, because nothing here
 * outlives a call: there is no timer to stop and no handle to close, so a
 * service would be a lifetime nobody needs. The import is type-only, so this
 * module still pulls nothing of the app in at runtime.
 */
export function backupContextOf(services: AppServices): BackupContext {
  return {
    layout: services.layout,
    state: services.state.db,
    build: services.build,
    freeBytes: services.freeBytes,
  };
}

export interface BackupRequest {
  owner: BackupOwner;
  contents: BackupContents;
  reason: BackupReason;
}

/** One archive, as a listing row. Everything here is read off the filename. */
export interface BackupRecord {
  id: string;
  scope: BackupScope;
  handle: string | null;
  contents: BackupContents;
  /** When it was taken, read back out of the uuidv7 rather than from an mtime. */
  takenAt: number;
  /** The archive's own size on disk, compressed. */
  bytes: number;
}

/**
 * ***The name is the record, and there is no table.***
 *
 * A listing is `readdir` plus a parse plus a `stat`: no decompression, no
 * database, and **deleting a file by hand is a non-event** — the posture
 * [03 §5.1](../../../../docs/design/03-data-model.md) takes about the index,
 * applied to something that is not derived but is disposable in the same way.
 *
 * ***The uuidv7 is the id and it carries the time.*** Its first forty-eight bits
 * are the millisecond it was minted, so `uuidv7Timestamp` answers *when was this
 * taken* from the name alone. That is `storage/trash.ts`'s argument and it is
 * sharper here: **an mtime does not survive a `cp -r`, a restore or a container
 * migration**, and these files exist specifically to be copied elsewhere.
 *
 * Scope and contents are in the name too, so that a person looking at these
 * files in a folder somewhere else knows what they are holding without opening
 * one. The date is for that person; nothing parses it back.
 */
const UUIDV7 = '[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}';

/**
 * The tail of a backup filename: contents, day, id.
 *
 * ***The handle is not parsed out of the name, and that is deliberate.*** A
 * handle may contain hyphens, so a pattern that tried to recover one from
 * `account-my-backup-full-2026-09-22-…` would be guessing at a boundary the
 * name does not mark. It never has to: a listing reads one directory, and the
 * directory says whose it is.
 */
const TAIL = new RegExp(`^(full|redacted)-\\d{4}-\\d{2}-\\d{2}-(${UUIDV7})\\.tar\\.gz$`);

function prefixFor(owner: BackupOwner): string {
  return owner.kind === 'install' ? 'install-' : `account-${owner.handle}-`;
}

function rootFor(context: BackupContext, owner: BackupOwner): string {
  return owner.kind === 'install'
    ? context.layout.backupsRoot
    : context.layout.userBackupsRoot(owner.handle);
}

/** `<prefix><contents>-<day>-<id>.tar.gz`. */
function fileNameFor(owner: BackupOwner, contents: BackupContents, id: string): string {
  const day = new Date(uuidv7Timestamp(id) ?? Date.now()).toISOString().slice(0, 10);
  return `${prefixFor(owner)}${contents}-${day}-${id}.tar.gz`;
}

/**
 * A filename as a record, or null when it is not one of ours.
 *
 * ***Anything that does not parse is not a backup and is not listed***, which is
 * what makes a `.part` invisible while it is being written and what keeps a file
 * somebody dropped in the directory out of the UI.
 */
function recordOf(owner: BackupOwner, name: string, bytes: number): BackupRecord | null {
  const prefix = prefixFor(owner);
  if (!name.startsWith(prefix)) return null;
  const match = TAIL.exec(name.slice(prefix.length));
  if (match === null) return null;
  const [, contents, id] = match as unknown as [string, BackupContents, string];
  const takenAt = uuidv7Timestamp(id);
  if (takenAt === null) return null;
  return {
    id,
    scope: owner.kind,
    handle: owner.kind === 'account' ? owner.handle : null,
    contents,
    takenAt,
    bytes,
  };
}

const note = (key: string, params: ImportNote['params'] = {}): ImportNote => ({
  key,
  params,
  level: 'info',
});

/**
 * ***What is never in an archive, whatever the scope or the contents.***
 *
 * - **`index/`** is derived ([03 §5.1]). An archive carrying it restores
 *   correctly today and restores *a stale belief about a newer tree* the first
 *   time somebody restores across a version — silently, because a stale index
 *   answers queries. This is the clause that makes it a restore rather than a
 *   copy, and it is the one `tools/backup.mjs` wrote and never ran.
 * - **`users/<handle>/trash/`** — [03 §10.2]: *restoring a backup should not
 *   resurrect everything the user threw away before taking it.*
 * - **The backups directories**, or every generation carries every one before
 *   it.
 * - **`state/*.sqlite-wal` and `-shm`**, because the database is snapshotted
 *   rather than copied and the snapshot supersedes them. Taking the three
 *   together from a running server restores a set that is neither current nor
 *   consistent.
 * - **`backup.json`**, so the manifest is always written fresh rather than being
 *   a stale copy of an older archive's.
 */
function alwaysSkipped(context: BackupContext, name: string): boolean {
  if (name === 'index' || name === BACKUP_MANIFEST_MEMBER) return true;
  /**
   * ***The instance lock, and not for tidiness*** (2026-09-27). On POSIX,
   * closing any descriptor to a file drops every lock this process holds on
   * it, and the walk below opens and closes each member it archives. So an
   * install backup that carried the file would have let the lock go at the
   * first backup, silently, and a second server could have started on this
   * directory from then on. On Windows the lock is a sharing violation, and
   * the backup would have failed there instead.
   */
  if (name === INSTANCE_LOCK_NAME || name.startsWith(`${INSTANCE_LOCK_NAME}-`)) return true;
  if (/^users\/[^/]+\/trash$/.test(name)) return true;
  /**
   * ***A removed account's archives and trash, for the reasons its live ones
   * are left out*** (2026-09-27). Removing an account moves its whole directory
   * to `removed/<handle>-<uuid>`, backups and trash with it, and those were
   * still archived from there. Every install backup carried every removed
   * account's own full archives, **provider keys included**, and a `redacted`
   * one, which exists to be safe to store elsewhere, carried them too: the
   * redaction removes `connections/`, and an archive inside an archive is not
   * one.
   */
  if (/^removed\/[^/]+\/(backups|trash)$/.test(name)) return true;
  if (/^state\/.*\.sqlite(-wal|-shm)$/.test(name)) return true;
  if (/^state\/state\.snapshot-.*\.sqlite$/.test(name)) return true;
  /**
   * ***An import's scratch*** —
   * [P13 §1.3](../../../../docs/design/workplan/30-p13-aventuras-import.md).
   * A private copy of somebody's whole Aventuras install, hundreds of
   * megabytes once a gallery is in it, which exists only until the import
   * that made it closes. An archive that took it would carry a second copy of
   * a library nobody asked to back up — and, for a backup taken mid-import, a
   * copy the import was about to delete. Named through the layout rather than
   * spelled, so the two cannot come apart.
   */
  if (name === context.layout.portablePath(context.layout.importScratchRoot)) return true;
  /**
   * ***`state/restore.pending`, and it is the one exclusion that is about the
   * machine rather than about the data*** —
   * [P12.11](../../../../docs/design/workplan/29-p12-implementation.md). The
   * marker says *this install has been asked to become that archive*; carrying
   * it into an archive would make restoring that archive ask for a restore, of
   * a path that means something else here. It is also what lets a successful
   * restore need no cleanup: no archive holds one, so the new directory has
   * none.
   */
  if (name === 'state/restore.pending') return true;
  /**
   * ***`.restore/`, which holds the install a restore replaced*** — its undo,
   * kept inside the data directory since 2026-09-27 (`backup/swap.ts`). An
   * archive that carried it would carry a whole second install, and the one
   * after that would carry both.
   */
  if (name === '.restore') return true;
  return context.layout.isBackupPath(join(context.layout.dataRoot, name));
}

/**
 * ***What a `redacted` archive leaves out.***
 *
 * Everything that is a credential, and nothing that is merely private. A person
 * storing an archive off the machine should be able to do it without also
 * handing over their provider account and everybody's password hashes — and a
 * person restoring one should be told, before it happens, that nobody will be
 * able to sign in afterwards.
 *
 * **Omitted rather than blanked.** Rewriting `accounts.json` with empty hashes
 * would preserve the handles and roles, which sounds more useful and is worse:
 * it produces an install that looks restored and that nobody can enter, and it
 * puts a redaction bug one typo away from shipping a real hash.
 */
function credentialPath(name: string): boolean {
  if (name === 'accounts.json') return true;
  if (name === 'state/session.key' || name === 'state/setup.token') return true;
  if (name === 'system/connections') return true;
  if (/^users\/[^/]+\/connections$/.test(name)) return true;
  // A removed account's directory carries theirs too, and it is as much a
  // credential there as it was before they were removed.
  if (/^removed\/[^/]+\/connections$/.test(name)) return true;
  return false;
}

/**
 * ***One backup at a time on a data directory*** (2026-09-27).
 *
 * The route's header said *the queue serialises them*, and the only queue was
 * the schedule's, keyed per scope and never reached by the route. So a person
 * pressing *Back up now* while the hourly pass was writing, or two people
 * pressing it, wrote two archives at once. Each measured the room it needed as
 * if it were the only one ([`assertRoom`]), and each snapshot of the
 * operational store is the size of the store. Keyed by the data root, so every
 * caller in this process waits its turn, and the route waits rather than
 * refusing: a person asking for a copy of their work gets one.
 */
const backups = new KeyedQueue();

/**
 * Takes one backup and answers what it wrote.
 *
 * The sequence is **metadata, then manifest, then bytes**, and the order is
 * forced: the manifest is the first member and it states the file count and the
 * uncompressed total, so both have to be known before a byte is written. That
 * costs one `stat` per file, which the walk was doing anyway.
 */
export async function takeBackup(
  context: BackupContext,
  request: BackupRequest,
): Promise<BackupRecord> {
  return backups.run(context.layout.dataRoot, () => takeBackupNow(context, request));
}

async function takeBackupNow(
  context: BackupContext,
  request: BackupRequest,
): Promise<BackupRecord> {
  const { owner, contents } = request;
  if (owner.kind === 'account') assertValidHandle(owner.handle);

  /**
   * ***Stamped with the time it was taken, whatever came before*** (2026-09-27).
   * The shared generator is monotonic: after the clock steps back it goes on
   * minting at the last millisecond it used, so every archive after a clock
   * that was once ahead carried that time. The newest archive then stood in
   * the future, the schedule measured *due* from it, and nothing was due until
   * the clock caught up, weeks or years later. A generator of its own starts
   * from the clock each time; two archives in one millisecond still differ in
   * their random bits.
   */
  const id = createUuidv7()(Date.now());
  const takenAt = uuidv7Timestamp(id) ?? Date.now();
  const omitted: ImportNote[] = [
    note('backup.omitted.index'),
    note('backup.omitted.trash'),
    note('backup.omitted.backups'),
  ];

  const within = owner.kind === 'account' ? `users/${owner.handle}` : null;
  const skip = (name: string): boolean => {
    if (alwaysSkipped(context, name)) return true;
    if (contents === 'redacted' && credentialPath(name)) return true;
    /**
     * An account archive is the install walk, narrowed. **Prefix-matched on a
     * segment boundary**, because `users/ned` must not admit `users/nedra`.
     */
    if (
      within !== null &&
      !(name === 'users' || name === within || name.startsWith(`${within}/`))
    ) {
      return true;
    }
    return false;
  };

  if (contents === 'redacted') omitted.push(note('backup.omitted.credentials'));

  const files: TreeFile[] = await listTreeFiles(context.layout.dataRoot, skip);
  await assertRoom(context, owner, files);
  const members: ArchiveMember[] = [];
  let unpackedBytes = 0;

  /**
   * ***The operational store, snapshotted rather than copied*** — [21 §5.1]
   * makes `state.sqlite` authoritative and not rebuildable, so it is the one
   * file here that a torn copy actually loses something.
   *
   * `VACUUM INTO` writes a consistent image of the database as of one moment,
   * while the server keeps writing to it. **This is [25 E6]'s quiesce argument
   * answered rather than worked around**: E6 says there is no write-lock to take
   * *from outside the process*, and that is true and is about the outside.
   *
   * Install scope only — an account archive holds no install state — and the
   * snapshot is unlinked in a `finally` so a failure does not leave a copy of
   * the operational store lying in `state/`.
   */
  let snapshot: string | null = null;
  try {
    if (owner.kind === 'install') {
      snapshot = join(context.layout.stateRoot, `state.snapshot-${id}.sqlite`);
      context.state.exec(`VACUUM INTO '${snapshot.replaceAll("'", "''")}'`);
      const facts = await statFile(snapshot);
      if (facts !== null) {
        members.push({ name: 'state/state.sqlite', path: snapshot, size: facts.size });
        unpackedBytes += facts.size;
      }
    }

    for (const file of files) {
      /**
       * ***A file the format cannot name is skipped and said out loud, rather
       * than failing the archive.***
       *
       * This project refuses rather than sanitises almost everywhere —
       * `storage/zip.ts` says so about traversal, and `tar.ts` throws rather
       * than truncating — and **a backup is the one place that trade runs the
       * other way**. All-or-nothing is the right failure for a *restore*, where
       * a partial result is a corrupt install. For a backup it means one
       * pathological name in one person's library leaves the whole install with
       * **no archive at all**, and finding that out on the day you need one is
       * the worst outcome this feature has.
       *
       * It is reachable by hand rather than by us: the library is a folder
       * somebody may open in a text editor ([10 §2.1]), and ustar's two name
       * fields hold 255 bytes between them where our own longest path is about
       * 232.
       *
       * ***So it is skipped and named in the manifest's `omitted` at `warn`.***
       * The one thing it must never be is quiet, which is why this is a note in
       * the file rather than a `catch` around the whole thing.
       */
      try {
        splitName(file.name);
      } catch (error) {
        if (!(error instanceof TarNameError)) throw error;
        omitted.push({
          key: 'backup.omitted.unarchivablePath',
          params: { path: file.name },
          level: 'warn',
        });
        continue;
      }
      members.push({
        name: file.name,
        path: join(context.layout.dataRoot, file.name),
        size: file.size,
      });
      unpackedBytes += file.size;
    }

    const manifest: BackupManifest = {
      schema: BACKUP_MANIFEST_SCHEMA,
      scope: owner.kind,
      handle: owner.kind === 'account' ? owner.handle : null,
      contents,
      takenBy: { version: context.build?.version ?? null, at: new Date(takenAt).toISOString() },
      reason: request.reason,
      files: members.length,
      unpackedBytes,
      handles: handlesIn(owner, members),
      omitted,
    };

    const body = new TextEncoder().encode(`${JSON.stringify(manifest, null, 2)}\n`);
    const to = join(rootFor(context, owner), fileNameFor(owner, contents, id));
    const written = await writeTarGz(
      to,
      [{ name: BACKUP_MANIFEST_MEMBER, bytes: body }, ...members],
      takenAt / 1000,
    );

    return {
      id,
      scope: owner.kind,
      handle: owner.kind === 'account' ? owner.handle : null,
      contents,
      takenAt,
      bytes: (await statFile(to))?.size ?? written.bytes,
    };
  } finally {
    if (snapshot !== null) await unlinkFile(snapshot).catch(() => undefined);
  }
}

/**
 * What the server keeps free for its own writes when it decides whether a
 * backup fits: a turn, a session, the index. A backup that left the disk with
 * less would have the next turn fail to save.
 */
export const BACKUP_FREE_RESERVE_BYTES = 64 * 1024 * 1024;

/** A tar header and its worst-case padding, per member. */
const TAR_OVERHEAD_BYTES = 1024;

/**
 * ***Not enough room to take this backup without filling the disk***, found
 * before a byte of it was written. `routes/backups.ts` answers it `507
 * no-space`.
 */
export class BackupSpaceError extends Error {
  readonly needed: number;
  readonly free: number;

  constructor(needed: number, free: number) {
    super(
      `There is not enough free space on the disk for this backup: it could need ${megabytes(needed)} and ${megabytes(free)} is free.`,
    );
    this.name = 'BackupSpaceError';
    this.needed = needed;
    this.free = free;
  }
}

function megabytes(bytes: number): string {
  return `${String(Math.ceil(bytes / (1024 * 1024)))} MB`;
}

/**
 * ***Room first, and before the snapshot*** (2026-09-27).
 *
 * A backup used to find out it did not fit by filling the disk: the archive
 * grew as a `.part` until `ENOSPC`, and was then unlinked. A full disk is what
 * stops the server saving turns, so for that moment the feature meant to
 * protect somebody's writing was what broke it. And a scheduled backup that
 * failed was due again at the next hourly tick, so it did this every hour.
 *
 * **The bound is the uncompressed size, which no archive can exceed** (gzip
 * adds a few bytes a block at worst), plus a tar header for each member, plus
 * the `VACUUM INTO` snapshot, which sits beside the archive until it is done,
 * plus `BACKUP_FREE_RESERVE_BYTES`. That refuses some backups that would have
 * compressed into the room there was, and that is the safe way round: a
 * refused backup can be taken later, and a turn lost to a full disk cannot.
 *
 * **A filesystem that will not say how much is free is not a refusal**, which
 * is `freeBytes`' rule and `prepareRestore`'s.
 */
async function assertRoom(
  context: BackupContext,
  owner: BackupOwner,
  files: readonly TreeFile[],
): Promise<void> {
  const free = await (context.freeBytes ?? freeBytes)(context.layout.dataRoot);
  if (free === null) return;
  const snapshot =
    owner.kind === 'install' ? ((await statFile(context.layout.stateFile))?.size ?? 0) : 0;
  let needed = BACKUP_FREE_RESERVE_BYTES + 2 * snapshot;
  for (const file of files) needed += file.size + TAR_OVERHEAD_BYTES;
  if (free < needed) throw new BackupSpaceError(needed, free);
}

/**
 * What a backup that died part way left behind, removed — at boot, before the
 * timer starts, when no backup can be running (2026-09-27).
 *
 * ***Two kinds, and both used to stay for good.*** `writeTarGz` unlinks its
 * `.part` in a `finally`, and `takeBackup` its `state.snapshot-*.sqlite`, but a
 * process killed during a backup runs neither. The `.part` is a partial archive
 * the listing never shows, and the snapshot a full copy of the operational
 * store: invisible, and as big as what they copied, every time it happened.
 *
 * **Only those names**, matched whole: this deletes nothing a backup did not
 * make. Answers how many it removed, for the log.
 */
export async function sweepAbandonedBackups(layout: Layout): Promise<number> {
  let removed = 0;
  const sweep = async (directory: string, abandoned: RegExp): Promise<void> => {
    for (const name of await listEntryNames(directory)) {
      if (!abandoned.test(name)) continue;
      await unlinkFile(join(directory, name));
      removed += 1;
    }
  };

  const partial = /\.tar\.gz\.part$/;
  await sweep(layout.backupsRoot, partial);
  for (const handle of await listDirectoryNames(layout.usersRoot)) {
    let theirs: string;
    try {
      theirs = layout.userBackupsRoot(handle);
    } catch {
      // Not a handle (a stray folder under `users/`), so nothing of ours.
      continue;
    }
    await sweep(theirs, partial);
  }
  await sweep(layout.stateRoot, /^state\.snapshot-[^/]+\.sqlite$/);
  return removed;
}

/** The handles an archive holds, so an install import can plan without a pass. */
function handlesIn(owner: BackupOwner, members: readonly ArchiveMember[]): string[] {
  if (owner.kind === 'account') return [owner.handle];
  const found = new Set<string>();
  for (const member of members) {
    const match = /^users\/([^/]+)\//.exec(member.name);
    if (match?.[1] !== undefined) found.add(match[1]);
  }
  return [...found].sort();
}

/** Every archive this owner has, newest first. */
export async function listBackups(
  context: BackupContext,
  owner: BackupOwner,
): Promise<BackupRecord[]> {
  const root = rootFor(context, owner);
  const found: BackupRecord[] = [];
  for (const file of await listTreeFiles(root)) {
    // One level only: a backups directory has no subdirectories, and a name
    // with a slash in it did not come from `fileNameFor`.
    if (file.name.includes('/')) continue;
    const record = recordOf(owner, file.name, file.size);
    if (record !== null) found.push(record);
  }
  return found.sort((left, right) => right.takenAt - left.takenAt);
}

/**
 * One archive, as a place on this disk and as the name it is known by.
 *
 * ***Both, because they are different strings on Windows.*** The routes used to
 * take the name back off the path with `path.split('/').pop()`, and `join`
 * separates with a backslash there — so a download's `Content-Disposition`
 * carried the server's whole absolute path, account name and all, and the
 * import ledger stored it. The name is the one thing a client or a record
 * should ever be given.
 */
export interface FoundBackup {
  path: string;
  name: string;
  record: BackupRecord;
}

/**
 * The path of one archive, resolved **against the listing** rather than built
 * from the id.
 *
 * ***Both halves of the traversal defence, and either alone is the one that gets
 * edited away.*** The route's schema refuses anything that is not a uuidv7, and
 * this never concatenates the caller's string into a path at all — it finds the
 * entry whose parsed id matches and uses the name that was already on disk.
 */
async function pathOf(
  context: BackupContext,
  owner: BackupOwner,
  id: string,
): Promise<FoundBackup | null> {
  const root = rootFor(context, owner);
  for (const file of await listTreeFiles(root)) {
    if (file.name.includes('/')) continue;
    const record = recordOf(owner, file.name, file.size);
    if (record?.id === id) return { path: join(root, file.name), name: file.name, record };
  }
  return null;
}

export async function findBackup(
  context: BackupContext,
  owner: BackupOwner,
  id: string,
): Promise<FoundBackup | null> {
  return pathOf(context, owner, id);
}

/** Removes one archive. False when this owner has none with that id. */
export async function removeBackup(
  context: BackupContext,
  owner: BackupOwner,
  id: string,
): Promise<boolean> {
  const found = await pathOf(context, owner, id);
  if (found === null) return false;
  await unlinkFile(found.path);
  return true;
}

/**
 * The manifest out of an archive, without inflating the rest of it —
 * [P12.10](../../../../docs/design/workplan/29-p12-implementation.md).
 *
 * ***This is the return on writing `backup.json` first.*** `takeBackup` puts it
 * at the head of the member list deliberately, and that ordering is what lets a
 * caller learn what an archive **is** — whose accounts are in it, whether it
 * carries credentials, what it weighs unpacked — for the cost of one gzip block
 * rather than the cost of the archive. An install archive is not bounded by
 * anything, so the difference between the two is the difference between a
 * question a person can ask casually and one they cannot.
 *
 * ***Three callers, and each of them wants it before it acts.*** The import
 * picker offers the handles the archive actually holds rather than a text box;
 * the review says what it was about to take; and [P12.11]'s restore checks
 * scope, `contents` and `unpackedBytes` against the disk **while the server is
 * still running**, because a refusal after the process has exited is a refusal
 * nobody can read.
 *
 * Null covers every way this can fail — not a gzip, not a tar, no manifest
 * first, a manifest that is not ours — because the caller's answer is the same
 * sentence for all of them: *that archive could not be read*.
 */
export async function readArchiveManifest(path: string): Promise<BackupManifest | null> {
  try {
    return await firstManifest(path);
  } catch {
    /**
     * ***A file that is not a gzip throws where a file that is not ours
     * returns.*** `createGunzip` emits *incorrect header check* for the first
     * and *unexpected end of file* for a truncated one, and both arrive here as
     * a rejection from the iterator rather than as a value. Every caller's
     * answer is the same sentence — *that archive could not be read* — so they
     * become the same null, and a route is not left turning a zlib error into
     * a 500.
     */
    return null;
  }
}

async function firstManifest(path: string): Promise<BackupManifest | null> {
  for await (const member of readTarGz(path)) {
    /**
     * ***The first member or nothing, which is stricter than searching.***
     *
     * An archive whose manifest is not first is not one this build wrote, and
     * reading on to look for one would mean inflating an arbitrary file handed
     * to us to find out — which is the cost this function exists to avoid, paid
     * exactly when the archive is least trustworthy.
     */
    if (member.name !== BACKUP_MANIFEST_MEMBER) return null;
    try {
      const read = readBackupManifest(JSON.parse(new TextDecoder().decode(member.bytes)));
      return 'refusal' in read ? null : read;
    } catch {
      return null;
    }
  }
  return null;
}
