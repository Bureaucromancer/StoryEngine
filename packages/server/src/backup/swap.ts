// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { join } from 'node:path';

import { writeJsonAtomic } from '../storage/atomic.js';
import {
  ensureDirectory,
  listEntryNames,
  pathPresent,
  readFileBytes,
  removeEmptyDirectory,
  removeTree,
  renamePath,
  unlinkFile,
} from '../storage/files.js';
import { INSTANCE_LOCK_NAME, type Layout } from '../storage/layout.js';

/**
 * ***Swapping a restored tree in for the live one, one entry at a time*** —
 * [P12.12](../../../../docs/design/workplan/29-p12-implementation.md), as
 * corrected 2026-09-27.
 *
 * **Why not two renames of the whole directory, which is what this replaced.**
 * They were atomic enough and could not run anywhere this project ships. The
 * data directory is a mount point in Docker and on unraid, in a parent the
 * process cannot write, and under the systemd unit everything but the data
 * directory is read-only. So staging beside it failed with `EACCES`, `EROFS` or
 * `EBUSY`, and the restore worked only from a bare checkout. Everything here
 * happens inside the data directory, on the one filesystem the process is
 * certain to own:
 *
 * ```
 * <data>/.restore/swap.json            the journal, while a swap is under way
 * <data>/.restore/<id>/staging/        the archive, unpacked
 * <data>/.restore/<id>/replaced/       the install it replaced: the undo
 * ```
 *
 * ***A journal, because a swap of many entries is not atomic.*** It is written
 * before the first move and names every entry that will move, so a boot that
 * finds one can tell, for each name, which side it is on, and finish the
 * swap. If finishing fails it puts everything back, and if *that* fails the
 * boot refuses to go on (`stranded`) and says where both halves are, rather
 * than serving whatever is in the directory. The old swap's second rename
 * failing booted an empty install with a setup token and logged *unchanged*.
 *
 * ***Two entries never move.*** `backups/` is where the install's archives
 * live, including the one being restored, and an undo directory full of every
 * archive was how a restore used to empty every backup list (and how
 * `deploy.md`'s *delete it when you are sure* deleted them all). `.restore/`
 * is this. A person's own archives, in `users/<handle>/backups/`, travel with
 * their directory and are carried across afterwards.
 */

/** The journal's format. */
export const SWAP_JOURNAL_SCHEMA = 'storyengine.restore-swap/1';

/**
 * The root entries a swap never moves: the install's archives, itself, and
 * the lock the running server holds (2026-09-27). A lock file moved aside
 * would leave its name free, so a second server could lock a new file there
 * while this one still held the old.
 */
export const KEPT_LIVE: ReadonlySet<string> = new Set(['backups', '.restore', INSTANCE_LOCK_NAME]);

/**
 * The root entries that are StoryEngine's, and so move aside whether or not the
 * archive brings its own. `swap.test.ts` holds this to every root entry
 * `Layout` names.
 *
 * ***Anything else at the root stays where it is.*** A data directory that is
 * itself the root of a filesystem has a `lost+found` owned by root, which the
 * server's user cannot rename, and a btrfs volume can have a `.snapshots`
 * subvolume that no rename moves. Moving every entry would fail the whole
 * restore on either one; an entry that is not ours and not in the archive is
 * none of the swap's business.
 */
export const OWN_ENTRIES: ReadonlySet<string> = new Set([
  'accounts.json',
  'backup.json',
  'config.json',
  'index',
  'removed',
  'state',
  'system',
  'users',
]);

export interface SwapJournal {
  schema: typeof SWAP_JOURNAL_SCHEMA;
  /** Names `.restore/<id>/`. */
  id: string;
  /** For the log and the notice: the archive this came from. */
  archive: string;
  requestedBy: string;
  files: number;
  /**
   * `staged` — the archive is unpacked and nothing has moved. `swapping` —
   * the entry lists are fixed and moves may have happened.
   */
  phase: 'staged' | 'swapping';
  /** The live root's entries, moved into `replaced/`. Fixed before the first move. */
  aside?: string[];
  /** The staging tree's entries, moved into the root. Fixed with `aside`. */
  incoming?: string[];
}

export type SwapOutcome =
  | {
      kind: 'swapped';
      /** Where the replaced install now sits. **Not deleted.** */
      replaced: string;
      /** Handles whose own archives stayed in `replaced/`: no such account came back. */
      backupsLeftBehind: string[];
    }
  /** Nothing moved, or everything that moved was put back. */
  | { kind: 'rolled-back'; why: string }
  /** A move failed and so did putting it back. The boot must not go on. */
  | { kind: 'stranded'; why: string; staging: string; replaced: string };

/** A rename, injectable so a test can make one fail where a disk would. */
export type Rename = (from: string, to: string) => Promise<void>;

export interface SwapOptions {
  rename?: Rename;
}

/** `.restore/<id>/staging` and `.restore/<id>/replaced`. */
export function swapPaths(layout: Layout, id: string): { staging: string; replaced: string } {
  const work = layout.restoreWork(id);
  return { staging: join(work, 'staging'), replaced: join(work, 'replaced') };
}

/**
 * The journal, `null` for none, or `'unreadable'`.
 *
 * ***An unreadable journal is not *no journal*.*** It exists because a swap
 * may be half done, and booting past it would serve a directory that is part
 * one install and part another. `writeJsonAtomic` means a crash leaves the old
 * version or the new one and never a torn one, so this is a file somebody
 * edited, and the boot says so.
 */
export async function readJournal(layout: Layout): Promise<SwapJournal | null | 'unreadable'> {
  const raw = await readFileBytes(layout.restoreJournalFile);
  if (raw === null) return null;
  let document: unknown;
  try {
    document = JSON.parse(new TextDecoder().decode(raw));
  } catch {
    return 'unreadable';
  }
  if (typeof document !== 'object' || document === null) return 'unreadable';
  const journal = document as Record<string, unknown>;
  const names = (value: unknown): boolean =>
    value === undefined ||
    (Array.isArray(value) && value.every((name) => typeof name === 'string' && safeName(name)));
  if (
    journal['schema'] !== SWAP_JOURNAL_SCHEMA ||
    typeof journal['id'] !== 'string' ||
    !safeName(journal['id']) ||
    (journal['phase'] !== 'staged' && journal['phase'] !== 'swapping') ||
    !names(journal['aside']) ||
    !names(journal['incoming'])
  ) {
    return 'unreadable';
  }
  if (
    journal['phase'] === 'swapping' &&
    (journal['aside'] === undefined || journal['incoming'] === undefined)
  ) {
    return 'unreadable';
  }
  return {
    schema: SWAP_JOURNAL_SCHEMA,
    id: journal['id'],
    archive: typeof journal['archive'] === 'string' ? journal['archive'] : '',
    requestedBy: typeof journal['requestedBy'] === 'string' ? journal['requestedBy'] : '',
    files: typeof journal['files'] === 'number' ? journal['files'] : 0,
    phase: journal['phase'],
    ...(journal['aside'] === undefined ? {} : { aside: journal['aside'] as string[] }),
    ...(journal['incoming'] === undefined ? {} : { incoming: journal['incoming'] as string[] }),
  };
}

/**
 * One entry name, as the journal may carry it: a name, not a path. A journal
 * is a file on disk, and one that said `../../etc` would have this move it.
 */
function safeName(name: string): boolean {
  return name !== '' && name !== '.' && name !== '..' && !/[/\\\0]/.test(name);
}

/**
 * Finishes a staged or interrupted swap, or puts the install back.
 *
 * **Idempotent, which is what makes it safe to call from a boot that found the
 * journal of one that died.** Every name is moved only from where it is to
 * where it belongs, and *where it is* is read from the disk each time:
 *
 * - An `aside` name already in `replaced/` has moved. Otherwise the root's copy
 *   is still the old one, because nothing comes in until everything has gone
 *   out.
 * - An `incoming` name still in `staging/` has not moved.
 */
export async function completeSwap(
  layout: Layout,
  started: SwapJournal,
  options: SwapOptions = {},
): Promise<SwapOutcome> {
  const move = options.rename ?? patientRename;
  const root = layout.dataRoot;
  const { staging, replaced } = swapPaths(layout, started.id);

  /**
   * ***Every failure from here to the last move lands in the roll-back***,
   * including a listing or a journal write that fails before anything has
   * moved: the roll-back reads the disk, finds nothing to put back, and cleans
   * up. What must never happen is an exception escaping with some entries
   * moved and nobody left to say so.
   */
  let journal = started;
  try {
    if (journal.phase === 'staged') {
      const incoming = await entries(staging);
      /**
       * ***Nothing staged is nothing to swap in***, and swapping it would move
       * the whole install aside with nothing to replace it: a journal whose
       * staging tree is gone (somebody deleted it, or a write that failed after
       * landing) must not empty the directory.
       */
      if (incoming.length === 0) {
        return await abandon(layout, started.id, 'Nothing was staged to restore.');
      }
      /**
       * ***A staged tree that would land on something kept live is refused
       * before anything moves.*** No archive this build writes carries
       * `backups/` or `.restore/`, and both the route and the command line
       * refuse one that does; this is the check at the point of no return.
       */
      const clash = incoming.find((name) => KEPT_LIVE.has(name));
      if (clash !== undefined) {
        return await abandon(
          layout,
          started.id,
          `The archive carries ${clash}/, which a restore never replaces.`,
        );
      }
      const replaces = new Set([...incoming, ...OWN_ENTRIES]);
      const aside = (await entries(root)).filter((name) => replaces.has(name));
      journal = { ...journal, phase: 'swapping', aside, incoming };
      // Before the first move: from here a boot that dies can be finished.
      await writeJsonAtomic(layout.restoreJournalFile, journal);
    }

    await ensureDirectory(replaced);
    for (const name of journal.aside ?? []) {
      if (await present(join(replaced, name))) continue;
      if (!(await present(join(root, name)))) continue;
      await move(join(root, name), join(replaced, name));
    }
    for (const name of journal.incoming ?? []) {
      if (await present(join(staging, name))) {
        await move(join(staging, name), join(root, name));
        continue;
      }
      /**
       * ***Neither staged nor in place is lost***, and a swap that went on
       * would report a restore with a hole in it where that entry should be.
       * A resume can meet this if somebody cleared out `.restore/` by hand
       * part way through, so it is a failure, and the roll-back puts the old
       * entries back.
       */
      if (!(await present(join(root, name)))) {
        throw new Error(`The staged ${name} is gone, so the restore cannot be finished.`);
      }
    }
  } catch (error) {
    return await rollBack(layout, journal, reason(error), move);
  }

  // The swap has happened. Nothing below may turn it into a failure.
  const backupsLeftBehind = await carryArchives(layout, replaced, move);
  await removeTree(staging).catch(() => undefined);
  // A journal that will not go is a finished swap the next boot finishes
  // again, which moves nothing: noisy, and not a reason to refuse this one.
  await unlinkFile(layout.restoreJournalFile).catch(() => undefined);
  return { kind: 'swapped', replaced, backupsLeftBehind };
}

/**
 * Everything that moved, moved back.
 *
 * **In the reverse order of the swap**: the incoming entries out first, so the
 * names are free for the old ones to return to. An incoming name that is also
 * an `aside` name and never went aside is still the old entry, and it stays.
 */
async function rollBack(
  layout: Layout,
  journal: SwapJournal,
  cause: string,
  move: Rename,
): Promise<SwapOutcome> {
  const root = layout.dataRoot;
  const { staging, replaced } = swapPaths(layout, journal.id);
  const aside = journal.aside ?? [];
  try {
    for (const name of journal.incoming ?? []) {
      if (await present(join(staging, name))) continue;
      if (aside.includes(name) && !(await present(join(replaced, name)))) continue;
      if (!(await present(join(root, name)))) continue;
      await move(join(root, name), join(staging, name));
    }
    for (const name of aside) {
      if (!(await present(join(replaced, name)))) continue;
      await move(join(replaced, name), join(root, name));
    }
  } catch (error) {
    return {
      kind: 'stranded',
      why: `${cause} Putting the install back failed too: ${reason(error)}`,
      staging,
      replaced,
    };
  }
  return await abandon(layout, journal.id, cause);
}

/**
 * A swap given up with nothing left moved: the unpacked archive goes, and so
 * does the journal.
 *
 * **`replaced/` is removed only if it is empty**, with `rmdir` rather than a
 * recursive delete. After a clean roll-back it is, and if something unforeseen
 * left an entry in it, that entry may be the only copy of something.
 */
async function abandon(layout: Layout, id: string, why: string): Promise<SwapOutcome> {
  const { staging, replaced } = swapPaths(layout, id);
  await removeTree(staging).catch(() => undefined);
  await removeEmptyDirectory(replaced).catch(() => undefined);
  await removeEmptyDirectory(layout.restoreWork(id)).catch(() => undefined);
  await unlinkFile(layout.restoreJournalFile).catch(() => undefined);
  return { kind: 'rolled-back', why };
}

/**
 * Each person's own archives, from the replaced install into the restored one.
 *
 * ***After the swap has succeeded, and never able to undo it.*** A failure
 * here leaves that person's archives in `replaced/`, where nothing is lost, and
 * is reported rather than turned into a failed restore. So is an account the
 * archive did not bring back, and one whose restored directory already has a
 * `backups/` of its own.
 */
async function carryArchives(layout: Layout, replaced: string, move: Rename): Promise<string[]> {
  const left: string[] = [];
  const oldUsers = join(replaced, 'users');
  const handles = await entries(oldUsers).catch(() => []);
  for (const handle of handles) {
    try {
      const from = join(oldUsers, handle, 'backups');
      if (!(await present(from))) continue;
      const to = layout.userBackupsRoot(handle);
      if (!(await present(layout.userRoot(handle))) || (await present(to))) {
        left.push(handle);
        continue;
      }
      await move(from, to);
    } catch {
      left.push(handle);
    }
  }
  return left;
}

/** Entry names under `path`, sorted, or none if it is not there. */
async function entries(path: string): Promise<string[]> {
  return (await listEntryNames(path)).sort();
}

/** Whether anything is at `path`, a dangling link included: that is what a rename moves. */
const present = pathPresent;

function reason(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * `rename`, retried briefly on Windows.
 *
 * ***The swap runs a moment after the unpack wrote thousands of files***, and
 * on Windows that is the moment Defender and the search indexer open them. A
 * rename of a directory with a file open inside it fails there with `EPERM`
 * or `EBUSY`, and it fails for a second or so rather than for good. Elsewhere
 * those codes mean what they say, so nothing is retried.
 */
async function patientRename(from: string, to: string): Promise<void> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      await renamePath(from, to);
      return;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      const transient = code === 'EPERM' || code === 'EBUSY' || code === 'EACCES';
      if (process.platform !== 'win32' || !transient || attempt >= 6) throw error;
      await new Promise((resolve) => setTimeout(resolve, 50 * 2 ** attempt));
    }
  }
}
