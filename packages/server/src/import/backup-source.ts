// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { readTarGz } from '../storage/tar-archive.js';
import { DEFAULT_ZIP_LIMITS, type ZipLimits } from '../storage/zip.js';

import { scope } from './memory-source.js';
import type { FileSource } from './source.js';

/**
 * ***A backup archive, read as a source*** —
 * [P4 §1.3](../../../../docs/design/workplan/16-p4-implementation.md),
 * [P12.8](../../../../docs/design/workplan/29-p12-implementation.md).
 *
 * ***The whole of what importing a backup costs.*** [P4 §1.3] put the seam at
 * the transport so that *"an uploaded batch and a zip entry cost a class each
 * rather than a second engine"*, and this is that claim paid a third time: with
 * this class and one reader, a backup goes through the same sweep, the same
 * conflict policy, the same review vocabulary and the same job ledger as a
 * SillyTavern folder. Routing it anywhere else would be the duplication the
 * seam exists to prevent.
 *
 * ***In memory, with bounds, where `storage/tar-archive.ts` streams.*** That is
 * a deliberate split rather than an inconsistency, and the two callers want
 * opposite things. A **restore** reads an archive that may be the whole install
 * and writes it straight back out, so it streams and never holds more than one
 * member. An **import** is asked for by somebody who is waiting, reads every
 * member once in an order the reader chooses, and has to be able to answer
 * *does `backup.json` exist* before it starts — so it materialises, and is
 * **bounded before it does**, which is the trade `ZipFileSource` already makes
 * for the same reason.
 *
 * ***The bounds are `zip.ts`'s and they are checked as the archive is read***,
 * not after. An archive is somebody else's bytes, and *the fact that this
 * project writes its own is exactly the assumption a reader must not make* —
 * the thing a person imports is a file that survived, from a disk that may have
 * had a bad week.
 */

export type BackupSourceRefusal =
  /** Not a gzip, or not a tar inside it. */
  | 'unreadable'
  /** Past the entry count, a single member's size, or the total. */
  | 'too-large'
  /** A member name that would escape the root when written out. */
  | 'unsafe-path';

export type OpenedBackupSource =
  { ok: true; source: BackupFileSource } | { ok: false; refusal: BackupSourceRefusal };

/**
 * ***The bounds for a backup, which is not an upload*** (2026-09-27).
 *
 * The import used `zip.ts`'s upload limits, and counted every member of the
 * archive against them, read or not. An account of about eighty well-edited
 * objects is more than 4,096 files once each object's history is counted, and
 * an install archive is past 256 MiB as soon as it has pictures in it; both
 * were refused as *could not be read*. Now only the members the import reads
 * are counted (see `open`'s `keep`), against limits sized for one person's
 * work: many more entries, since they are small, and a total that still keeps
 * the whole of what is read in memory within reach of a small server.
 */
export const BACKUP_IMPORT_LIMITS: ZipLimits = {
  maxEntries: 65_536,
  maxEntryBytes: 64 * 1024 * 1024,
  maxTotalBytes: 512 * 1024 * 1024,
};

/**
 * What an import of `handle`'s part of an archive reads, and nothing else.
 *
 * `backup.json`, the install's `config.json` when settings were asked for,
 * and under `users/<handle>/`: each library object's file and its `assets/`,
 * the tags, the prefs, the connections, and each session's file, turns,
 * rendition records and pictures — the renditions' `assets/` and, since
 * 2026-09-27, the `attachments/` a player put on their moves ([26 E15]).
 * **Not** another account, `state/`, an object's `history/` or a session's
 * snapshots: nothing reads them, so nothing should be held or counted for them.
 */
export function importedBy(
  handle: string,
  options: { config?: boolean } = {},
): (name: string) => boolean {
  const mine = `users/${handle}/`;
  return (name) => {
    if (name === 'backup.json') return true;
    if (name === 'config.json') return options.config === true;
    if (!name.startsWith(mine)) return false;
    const rest = name.slice(mine.length).split('/');
    const [top, ...under] = rest;
    switch (top) {
      case 'tags.json':
      case 'prefs.json':
        return under.length === 0;
      case 'connections':
        return under.length === 1;
      case 'library':
        // <kind>/<slug>/<file>, or <kind>/<slug>/assets/<file>.
        return under.length === 3 || (under.length === 4 && under[2] === 'assets');
      case 'sessions': {
        const [, part, ...more] = under;
        if (part === 'session.json') return more.length === 0;
        return (
          (part === 'turns' ||
            part === 'renditions' ||
            part === 'assets' ||
            part === 'attachments') &&
          more.length === 1
        );
      }
      default:
        return false;
    }
  };
}

export class BackupFileSource implements FileSource {
  readonly #members: Map<string, Uint8Array>;

  private constructor(members: Map<string, Uint8Array>) {
    this.#members = members;
  }

  /**
   * Reads an archive, or says why it will not.
   *
   * **A refusal rather than a throw**, because every caller is a route that has
   * to turn this into a sentence — and because [P4 §1.3]'s whole posture is
   * that a root is refused *before anything is written* rather than part way
   * through.
   */
  static async open(
    path: string,
    limits: ZipLimits = DEFAULT_ZIP_LIMITS,
    /**
     * Which members to hold, checked after containment and before the bounds:
     * `importedBy` for an import. Every member is still checked for escaping,
     * because an archive that names one is not an archive to read at all.
     */
    keep: (name: string) => boolean = () => true,
  ): Promise<OpenedBackupSource> {
    const members = new Map<string, Uint8Array>();
    let total = 0;

    try {
      for await (const member of readTarGz(path)) {
        /**
         * ***The containment check, and it runs on the joined name.*** A long
         * member arrives as a `prefix` and a `name` that a reader rejoins, so
         * checking either half alone would miss `..` in the other. `\\` is
         * refused with `/` for the reason `storage/zip.ts` gives: a path means
         * something different to two readers, and a Windows separator is how
         * one of them is surprised.
         */
        const name = member.name.replaceAll('\\', '/');
        if (name === '' || name.startsWith('/') || /^[A-Za-z]:/.test(name)) {
          return { ok: false, refusal: 'unsafe-path' };
        }
        if (name.split('/').some((part) => part === '..') || name.includes('\0')) {
          return { ok: false, refusal: 'unsafe-path' };
        }
        if (!keep(name)) continue;

        if (members.size >= limits.maxEntries) return { ok: false, refusal: 'too-large' };
        if (member.bytes.length > limits.maxEntryBytes) return { ok: false, refusal: 'too-large' };
        total += member.bytes.length;
        if (total > limits.maxTotalBytes) return { ok: false, refusal: 'too-large' };

        members.set(name, member.bytes);
      }
    } catch {
      return { ok: false, refusal: 'unreadable' };
    }

    // An archive with nothing in it is not one this build can act on, and
    // saying so is better than an import that reports zero of everything.
    if (members.size === 0) return { ok: false, refusal: 'unreadable' };

    return { ok: true, source: new BackupFileSource(members) };
  }

  /**
   * ***Scoped by `under`*** (2026-10-02), which the contract has asked since
   * [P4 §7.18] and this, written beside it on another branch, never read: the
   * merge of the two found it yielding every member whatever it was asked for.
   * No reader of a backup scopes a walk today; the `scope` predicate is the one
   * the other sources use, so the day one does, the answer is the same here.
   */
  async *list(under?: string): AsyncIterable<string> {
    const within = scope(under);
    for (const name of this.#members.keys()) {
      if (within(name)) yield await Promise.resolve(name);
    }
  }

  read(path: string): Promise<Uint8Array | null> {
    return Promise.resolve(this.#members.get(path) ?? null);
  }

  /**
   * ***A directory exists when something is under it***, which is what the
   * probes ask about. A tar carries no directory entries of its own here — the
   * writer emits files and the paths imply the folders, exactly as
   * `MemoryFileSource` has it — so a probe for `users` has to be answered from
   * the names rather than from an entry.
   */
  exists(path: string): Promise<boolean> {
    if (this.#members.has(path)) return Promise.resolve(true);
    const prefix = `${path}/`;
    for (const name of this.#members.keys()) {
      if (name.startsWith(prefix)) return Promise.resolve(true);
    }
    return Promise.resolve(false);
  }
}
