// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { relative as relativePath, sep } from 'node:path';

import {
  ACTOR_SCHEMA,
  LIBRARY_DIRECTORIES,
  LOREBOOK_SCHEMA,
  PACKAGE_SCHEMA,
  type PortableSchemaId,
  PRESET_SCHEMA,
  TREATMENT_SCHEMA,
  SETUP_SCHEMA,
  slugify,
} from '@storyengine/shared';

import { listDirectoryNames, listEntryNames } from './files.js';
import {
  PathEscapeError,
  assertRealContained,
  assertSafeSegment,
  isContained,
  realRoot,
  resolveWithin,
} from './paths.js';

/**
 * The data directory, from [03 §5.1](../../../../docs/design/03-data-model.md).
 *
 * ```
 * /data
 *   config.json
 *   accounts.json          authoritative, never derived — [P1 §1.3]
 *   system/library/        shipped, read-only, loaded for everyone
 *   users/<handle>/library/…
 *   index/index.sqlite     derived. Deleting it must be a non-event.
 *   state/state.sqlite     operational. Deleting it is *not* a non-event — [21 §5.1]
 * ```
 *
 * **The path is the owner.** No stored object carries an owner field and there
 * is no shared user area
 * ([09 §4.3](../../../../docs/design/09-server-multiuser-deployment.md)), which is why every
 * route resolves its root from the session rather than from a parameter — and
 * why `userRoot` treats its handle as hostile input. `LibraryOwner` below is
 * the *argument* that selects a tree, never a property of what is in it.
 *
 * `system/library/` has the same shape as a user's, so the merge is a query
 * rather than a special case ([03 §5.1](../../../../docs/design/03-data-model.md)). That is
 * the entire reason `LibraryOwner` exists instead of two sets of functions.
 */

export type LibraryOwner = { kind: 'user'; handle: string } | { kind: 'system' };

export const SYSTEM_OWNER: LibraryOwner = { kind: 'system' };

export function userOwner(handle: string): LibraryOwner {
  return { kind: 'user', handle };
}

/**
 * The file that *is* the object, inside its folder.
 *
 * Actors are the odd one out and deliberately so: `card.png` is canonical, not a
 * mirror of a JSON file, because two sources of truth is the failure mode being
 * avoided ([03 §5.2](../../../../docs/design/03-data-model.md)).
 */
export const OBJECT_FILENAMES = {
  [ACTOR_SCHEMA]: 'card.png',
  [LOREBOOK_SCHEMA]: 'lorebook.json',
  [TREATMENT_SCHEMA]: 'treatment.json',
  [SETUP_SCHEMA]: 'setup.json',
  [PRESET_SCHEMA]: 'preset.json',
  // [03 §5.1](../../../../docs/design/03-data-model.md) gives packages a folder and defers
  // its contents to §7, which describes the *format* rather than the on-disk
  // shape. A stored package also holds embedded copies of its contents, so this
  // filename is the manifest rather than the whole object — and the arrangement
  // is settled with `.sepack` import and export, which [P4 §4] puts out of
  // scope and places around P11. This comment said "settled at P4" until P4.0
  // read it: P4 imports other people's formats and deliberately not our own.
  [PACKAGE_SCHEMA]: 'package.json',
} as const satisfies Record<PortableSchemaId, string>;

/**
 * A handle is a directory name under `users/`, so it is checked before it is
 * ever concatenated with anything.
 *
 * Stricter than `slugify` produces, on purpose: this is the one user-supplied
 * string that becomes a path component at first-run
 * ([P1 §1.3](../../../../docs/design/workplan/07-p1-implementation.md)), and the cost of a mistake is
 * one account reaching another's directory.
 */
const HANDLE_PATTERN = /^[a-z0-9][a-z0-9-]{0,62}$/;

export function isValidHandle(handle: string): boolean {
  if (!HANDLE_PATTERN.test(handle)) return false;
  if (handle.endsWith('-')) return false;
  try {
    assertSafeSegment(handle);
    return true;
  } catch {
    return false;
  }
}

export function assertValidHandle(handle: string): void {
  if (!isValidHandle(handle)) {
    throw new PathEscapeError(
      'illegal-character',
      handle,
      'a handle is lowercase letters, digits and hyphens, 1–63 characters, not ending in a hyphen',
    );
  }
}

/**
 * The name of the lock a running server holds on its data directory, at the
 * data directory's root — see {@link Layout.instanceLockFile}. Exported for the
 * two places that must never touch the file: the archive walk and the restore
 * swap.
 */
export const INSTANCE_LOCK_NAME = 'instance.lock';

/**
 * Every path in the data directory, derived from one root.
 *
 * A class rather than loose functions taking `dataRoot` everywhere, because the
 * root comes from config ([21 §4](../../../../docs/design/21-internal-contracts.md)) and
 * threading it through every call site is how one caller ends up using a
 * default and writing somewhere nobody expects.
 */
export class Layout {
  readonly dataRoot: string;

  constructor(dataRoot: string) {
    /**
     * **Normalised here, not at `watch()`** — F26.
     *
     * chokidar builds every path it reports by concatenating onto the string it
     * was handed, so the root's spelling is the spelling of everything that
     * comes back out: the index's primary keys
     * ([03 §5.1](../../../../docs/design/03-data-model.md)), the self-write registry's keys,
     * and what {@link parseObjectPath} has to recognise. Normalising at the
     * watcher alone leaves all three disagreeing with a layout that still holds
     * the alias — the watcher stops aborting and starts silently ignoring every
     * event, which is worse than the crash because nothing says so.
     *
     * Lexical gate first, then the filesystem, as everywhere else here.
     */
    this.dataRoot = realRoot(resolveWithin(dataRoot, '.'));
  }

  /**
   * The check the lexical rules cannot make — F1.
   *
   * Every path this class builds passes {@link resolveWithin}, which is a
   * string test: it refuses `..`, absolute paths, device names and the rest,
   * and it cannot refuse `library/actors/vera` when `actors` turns out to be a
   * link to somewhere else. Only the filesystem knows that, and only after the
   * path is built — which is why this is a separate call rather than part of
   * the builders, and why it is async while they are not.
   *
   * Call it where a path becomes I/O: before a write, before reading bytes at a
   * path that came out of the index, and when ingest is handed one by the
   * watcher. Those are the three doors — a path that never opens a file cannot
   * escape anything.
   */
  async assertReal(path: string): Promise<void> {
    await assertRealContained(this.dataRoot, path);
  }

  /** `data/config.json` — commented example shipped alongside ([03 §5.4]). */
  get configFile(): string {
    return resolveWithin(this.dataRoot, 'config.json');
  }

  /**
   * `data/accounts.json`. Authoritative state, so a file and never an index row
   * ([P1 §1.3](../../../../docs/design/workplan/07-p1-implementation.md)) — and deliberately outside
   * every user directory, so the file browser can never serve a password hash
   * whatever `fileAccess` a user is granted.
   */
  get accountsFile(): string {
    return resolveWithin(this.dataRoot, 'accounts.json');
  }

  /** The index's directory — what the watcher must never watch. */
  get indexRoot(): string {
    return resolveWithin(this.dataRoot, 'index');
  }

  /** Derived and disposable. Deleting it must be a non-event ([21 §5]). */
  get indexFile(): string {
    return resolveWithin(this.indexRoot, 'index.sqlite');
  }

  /**
   * Operational state: jobs, idempotency keys, the notification inbox. **Not**
   * derived, not rebuildable, and therefore not in the index
   * ([21 §5.1](../../../../docs/design/21-internal-contracts.md)).
   */
  get stateRoot(): string {
    return resolveWithin(this.dataRoot, 'state');
  }

  get stateFile(): string {
    return resolveWithin(this.stateRoot, 'state.sqlite');
  }

  /**
   * The session signing key.
   *
   * Operational rather than derived, by the same test: losing it would surprise
   * a user — everyone is logged out. Not in `config.json`, which has nowhere to
   * put a credential ([21 §4]), and not in the index, which is deletable
   * without consequence.
   */
  get sessionKeyFile(): string {
    return resolveWithin(this.stateRoot, 'session.key');
  }

  /**
   * The first-run setup token ([09 §5.1], F10).
   *
   * Beside the session key and operational for the same reason, with one of its
   * own: it is written when the bind is exposed and no admin exists, and a
   * restart must not invalidate a token somebody has already copied out of a
   * container's log. Regenerating per boot is what P1 did, and is why nothing
   * could check it.
   */
  get setupTokenFile(): string {
    return resolveWithin(this.stateRoot, 'setup.token');
  }

  /**
   * Which build last opened this data directory ([P6A §1.7]).
   *
   * Operational by the same test as the two above: it is not derived from
   * anything, and losing it would not surprise a user so much as remove a guard
   * they never knew was there. In `state/` rather than at the data root because
   * it is about the process that opened the directory, not about its contents.
   */
  get buildStampFile(): string {
    return resolveWithin(this.stateRoot, 'build.json');
  }

  /**
   * ***A restore that has been asked for and not yet performed*** —
   * [P12.11](../../../../docs/design/workplan/29-p12-implementation.md).
   *
   * In `state/` because it is operational by the same test as the three above:
   * not derived from anything, and about the process rather than the contents.
   *
   * ***It is never carried in an archive, and that is the property the whole
   * swap hangs on.*** The marker lives inside the directory that a successful
   * restore moves aside, and no archive holds one — so a restore that worked
   * cannot leave a marker behind to be acted on twice, and one that failed
   * keeps exactly the state describing itself. Nothing has to delete it, which
   * is the deletion that would otherwise have to happen after the process had
   * already replaced the directory it was deleting from.
   */
  get restorePendingFile(): string {
    return resolveWithin(this.stateRoot, 'restore.pending');
  }

  /**
   * `.restore/` — where a restore unpacks, and where the install it replaced
   * is kept — [P12.12](../../../../docs/design/workplan/29-p12-implementation.md),
   * as corrected 2026-09-27.
   *
   * ***Inside the data directory, because the data directory is the one place a
   * shipped install can write.*** The swap used to stage beside it, in
   * `<dataRoot>.restoring-*`, and rename the whole root aside. But `/data` in a
   * container is a mount point in a root-owned parent, and the systemd unit
   * makes everything but the data directory read-only, so that failed with
   * `EACCES`, `EROFS` or `EBUSY` everywhere except a bare-metal checkout. Here
   * the swap moves the root's entries one at a time, on one filesystem the
   * process owns.
   *
   * ***Never in an archive*** (`alwaysSkipped`), or the next backup would carry
   * the whole of the install a restore replaced.
   */
  get restoreRoot(): string {
    return resolveWithin(this.dataRoot, '.restore');
  }

  /**
   * `.restore/swap.json` — a swap that has been staged and not yet finished.
   *
   * ***At the root of `.restore/` rather than in `state/`***, because `state/`
   * is one of the entries the swap moves: a journal inside it would move
   * aside with the install it describes, and a boot interrupted half way would
   * find no journal and a half-swapped directory.
   */
  get restoreJournalFile(): string {
    return resolveWithin(this.restoreRoot, 'swap.json');
  }

  /**
   * ***`instance.lock` — one server per data directory*** (2026-09-27).
   *
   * A second server started on a directory another one is using took it over
   * piece by piece before it had even listened. Its start-up reconciliation
   * finalised the first one's turn in flight as a failed one, and moved the
   * head over it. Its sweep of abandoned backups deleted the first one's
   * half-written archive, so that backup failed at its last step. Its rendition
   * recovery told the owner a picture still being drawn had failed. Nothing
   * said two were running. The shipped wrappers never start two, but a second
   * container, a unit and a hand-started copy, or a restart that raced its own
   * predecessor all can.
   *
   * A running server holds an operating-system lock on this file from before
   * it touches anything until it exits (`instance-lock.ts`), and a second one
   * is refused in one line. **At the root and not in `state/`**, because the
   * restore swap moves `state/` aside, and a lock file moved aside leaves its
   * old name free for a second server to lock. **Never read by this process
   * while it holds it**: on POSIX, closing any descriptor to a file drops
   * every lock the process holds on it, so an archive walk that opened it
   * would silently let the lock go. It is left out of every archive, and the
   * swap leaves it where it is.
   */
  get instanceLockFile(): string {
    return resolveWithin(this.dataRoot, INSTANCE_LOCK_NAME);
  }

  /** `.restore/<id>/` — one restore's staging tree and the install it replaced. */
  restoreWork(id: string): string {
    return resolveWithin(this.restoreRoot, id);
  }

  get systemRoot(): string {
    return resolveWithin(this.dataRoot, 'system');
  }

  /** Admin-managed. Usable by all, readable by none ([09 §4.5]). */
  get systemConnectionsRoot(): string {
    return resolveWithin(this.systemRoot, 'connections');
  }

  /**
   * `system/bindings.json` — the install defaults everyone inherits
   * ([P2B §2.1](../../../../docs/design/workplan/10-p2b-provider-configuration.md)).
   *
   * **The same shape as a user's, read by the same reader, layered under it.**
   * Three documents describe this layer and none of them had a path:
   * [09 §4.5](../../../../docs/design/09-server-multiuser-deployment.md) says a dangling binding
   * *"falls back to system bindings"*, [10 §15.3](../../../../docs/design/10-ui-surfaces.md) calls
   * system connections *"the default role bindings everyone inherits"*, and
   * [19 §5.1](../../../../docs/design/19-tech-stack.md) puts *install default* at the weak end of
   * the resolution order. What shipped was one layer, so the fallback those
   * sentences promise could not happen — which is why [P2B §1.2] calls
   * *"no new mechanism"* the sentence that hid the work.
   *
   * Beside `connections/` in `system/` rather than in a user's directory,
   * because the path is the owner ([09 §4.3]) and this belongs to the install.
   */
  get systemBindingsFile(): string {
    return resolveWithin(this.systemRoot, 'bindings.json');
  }

  get usersRoot(): string {
    return resolveWithin(this.dataRoot, 'users');
  }

  /**
   * ***Every account directory on disk, and nothing else under `users/`***
   * (2026-09-27).
   *
   * Read from the disk rather than from `accounts.json`, because a folder
   * belonging to a removed account still holds somebody's files. But not every
   * folder there is an account's: a NAS's indexer leaves `@eaDir`, and somebody
   * keeping a copy leaves `ned.old`. The rebuild and the start-up session pass
   * each listed the folder and then asked the layout for a path under it,
   * which refuses a name that is not a handle, so one such folder stopped the
   * start. The rebuild even had a `catch` for it, around a line that never
   * throws. The name rule is the handle rule, applied once, here.
   */
  async userHandlesOnDisk(): Promise<string[]> {
    return (await listDirectoryNames(this.usersRoot)).filter((name) => isValidHandle(name));
  }

  /**
   * `data/backups/` — where an install backup lands
   * ([P12.2](../../../../docs/design/workplan/29-p12-implementation.md)).
   *
   * ***Outside every user directory, and that is `accounts.json`'s argument
   * exactly.*** An install archive contains every account's library, every
   * account's connections and — when it is a `full` one — the password hashes
   * and the session signing key. A future file browser over a user's own
   * directory ([10 §4.2.1](../../../../docs/design/10-ui-surfaces.md)) must not
   * be able to reach it whatever `fileAccess` that user is granted, and the
   * cheapest way to guarantee that is for it never to be in there.
   *
   * Beside `removed/` for the same structural reason: both are the install's
   * rather than a person's, and neither is content.
   */
  get backupsRoot(): string {
    return resolveWithin(this.dataRoot, 'backups');
  }

  /**
   * `users/<handle>/backups/` — where a person's own backups land.
   *
   * ***Inside their directory, which is the mirror of the decision above and
   * settled by the same test the avatar was.*** An account archive holds that
   * account's work and nothing else, so it is theirs in the sense
   * [09 §4.3](../../../../docs/design/09-server-multiuser-deployment.md) means:
   * the path is the owner. **And removal clinches it** — taking an account
   * moves the whole directory to `data/removed/<handle>-<uuid>`, and their
   * backups should leave in that same gesture rather than becoming a second
   * account-adjacent orphan with its own sweep to write.
   */
  userBackupsRoot(handle: string): string {
    return resolveWithin(this.userRoot(handle), 'backups');
  }

  /**
   * `users/<handle>/backup.json` — one account's schedule
   * ([P12.4](../../../../docs/design/workplan/29-p12-implementation.md)).
   *
   * **Beside `tags.json` rather than inside `prefs.json`**, and the line is the
   * one `tagsFile` already draws: the preferences file carries a decision that
   * it is a bag the server does not validate, and the whole return on that
   * decision is that a preference the client stops using rots quietly instead
   * of needing a migration. This document has a schema, is validated on the way
   * out, and is **read by a timer that writes files to somebody's disk** — which
   * is exactly what does not belong in the bag.
   */
  backupSettingsFile(handle: string): string {
    return resolveWithin(this.userRoot(handle), 'backup.json');
  }

  /**
   * Whether a path is inside either backups directory.
   *
   * ***Two callers, and they want it for opposite reasons.*** The archive
   * walker excludes these paths because an archive of the archives makes every
   * generation carry every one before it. The watcher
   * (`index-db/watcher.ts`) excludes them because chokidar's
   * `awaitWriteFinish` would otherwise poll a half-gigabyte file for the whole
   * time it is being written — and `selfWrites` is not the answer there, being
   * a two-second TTL built for small atomic writes.
   *
   * **By portable path rather than by `isContained`**, because the per-user
   * directories are one per account rather than one root, and a predicate that
   * had to be handed a list would be a predicate that went stale the moment an
   * account was created.
   */
  isBackupPath(path: string): boolean {
    const relative = this.portablePath(path);
    if (relative === null) return false;
    return /^backups(\/|$)/.test(relative) || /^users\/[^/]+\/backups(\/|$)/.test(relative);
  }

  /**
   * Where a removed account's directory goes — `data/removed/`.
   *
   * **Deleting an account is a move**, which is the position `trashDestination`
   * already takes for objects and sessions ([03 §10.2]). What is different is
   * where it lands: the user's own trash is inside the directory being removed,
   * so a removal that used it would be moving a folder into itself.
   *
   * Deliberately **outside** every user directory and outside the maturation
   * sweep's reach. The sweep is per-user retention, and this is not a user any
   * more — nothing should quietly collect it. [P2A §2.3] makes the surface say
   * so in words: StoryEngine will not delete this, remove the folder yourself
   * when you are sure.
   */
  get removedRoot(): string {
    return resolveWithin(this.dataRoot, 'removed');
  }

  /**
   * `removed/<handle>-<suffix>`.
   *
   * Suffixed for the same reason the trash is: remove-recreate-remove must not
   * collide, and the handle is free for reuse the moment the record goes. That
   * pair — the name reusable immediately, the old data not reachable through it
   * — is the property that makes the move better than either erasing the folder
   * or leaving it in place.
   */
  removedDestination(handle: string, suffix: string): string {
    assertValidHandle(handle);
    return resolveWithin(this.removedRoot, `${handle}-${suffix}`);
  }

  /**
   * `users/<handle>/prefs.json` — client preferences ([25 B13]).
   *
   * A per-user file rather than `localStorage` or a map on `Account`: pane
   * state that does not survive a move to another browser is not state anybody
   * wanted, and `accounts.json` is authentication — a document every request
   * reads and every password change rewrites is the wrong home for whether a
   * pane is collapsed.
   *
   * **The server does not validate its contents.** A preference the client
   * stops using rots quietly here rather than needing a migration.
   */
  prefsFile(handle: string): string {
    return resolveWithin(this.userRoot(handle), 'prefs.json');
  }

  /**
   * `users/<handle>/tags.json` — the tag registry ([05 §4](../../../../docs/design/05-tagging.md)).
   *
   * Beside `prefs.json` and deliberately not inside it. The preferences file
   * carries a decision that it is a bag the server does not validate, and the
   * whole return on that decision is that a preference the client stops using
   * rots quietly instead of needing a migration. This document has a schema and
   * is validated on the way out, which is exactly what does not belong in the
   * bag — so B13 is upheld here rather than amended.
   */
  tagsFile(handle: string): string {
    return resolveWithin(this.userRoot(handle), 'tags.json');
  }

  /**
   * `users/<handle>/usage.jsonl` — what the model calls that write no turn
   * spent ([10 §11.4](../../../../docs/design/10-ui-surfaces.md), `usage/log.ts`).
   *
   * ***A file in the account's directory rather than a table in
   * `state.sqlite`***, because the second is install-level and an account
   * archive holds none of it — the file is inside that archive, comes back with
   * a restore or an in-place unpack, and goes with the account. Not with a
   * merge import, whose scope is the library, sessions and tags. Append-only
   * JSON lines, like a turn segment,
   * and for the segment's reason — a record of what happened is never
   * rewritten, and a torn append costs the newest line rather than the file.
   */
  usageLogFile(handle: string): string {
    return resolveWithin(this.userRoot(handle), 'usage.jsonl');
  }

  /**
   * `users/<handle>/avatar.<ext>` — the account's face
   * ([12 §5.1](../../../../docs/design/12-account-gallery.md), [P10.4]).
   *
   * ***Inside the user's own directory, and that is the mirror image of why
   * `accounts.json` is outside every one of them.*** That file holds password
   * hashes, so a future file browser over a user's directory must never be able
   * to serve it ([P1 §1.3]). An avatar is the opposite in every respect —
   * user-authored, not secret, and uploaded *specifically to be shown* — so it
   * belongs with the user's other authored things, where the browser's own rule
   * is that what the user authored is exactly what it may expose.
   *
   * ***The clinching argument is removal.*** Removing an account moves the
   * whole directory to `data/removed/<handle>-<uuid>` before the record goes,
   * and that promise should cover the face along with the library. Here, the
   * avatar leaves in the same gesture with zero new code; in a system-side store
   * it would be a second account-adjacent orphan needing its own sweep.
   *
   * **The extension is part of the name because the bytes are stored as
   * received** — [12 §5.2]: the server has no raster re-encoder and should not
   * grow one for this, so the sniffed type decides the suffix and the file says
   * what it is.
   */
  userAvatarFile(handle: string, extension: string): string {
    return resolveWithin(this.userRoot(handle), `avatar.${extension}`);
  }

  userRoot(handle: string): string {
    assertValidHandle(handle);
    return resolveWithin(this.usersRoot, handle);
  }

  // No `accountFile`. There is no `users/<handle>/account.json` (F10): P1 §1.3
  // moved every account into one `accounts.json` at the data root, deliberately
  // outside every user directory, so that a file browser cannot serve a
  // password hash whatever `fileAccess` a user is granted. The method survived
  // the decision that overturned it and pointed at a path nothing writes —
  // which is worse than a missing helper, because it reads as a supported
  // location.

  userConnectionsRoot(handle: string): string {
    return resolveWithin(this.userRoot(handle), 'connections');
  }

  sessionsRoot(handle: string): string {
    return resolveWithin(this.userRoot(handle), 'sessions');
  }

  sessionRoot(handle: string, sessionId: string): string {
    return resolveWithin(this.sessionsRoot(handle), sessionId);
  }

  /** Deleted objects awaiting the retention window ([03 §10.2]). */
  trashRoot(handle: string): string {
    return resolveWithin(this.userRoot(handle), 'trash');
  }

  /**
   * Where a deleted object's folder lands — deletion is a move, not an
   * erasure ([03 §10.2]). The suffix keeps delete-recreate-delete from
   * colliding; retention and restore are P11's.
   */
  trashDestination(
    handle: string,
    schemaId: PortableSchemaId,
    slug: string,
    suffix: string,
  ): string {
    return resolveWithin(
      this.trashRoot(handle),
      LIBRARY_DIRECTORIES[schemaId],
      `${slug}-${suffix}`,
    );
  }

  /**
   * Where a deleted session's folder lands.
   *
   * `trash/sessions/<id>-<suffix>` — beside the library kinds rather than inside
   * one, because a session is not a library object and the trash is organised
   * the way the live tree is ([03 §10.3](../../../../docs/design/03-data-model.md)).
   */
  sessionTrashDestination(handle: string, sessionId: string, suffix: string): string {
    return resolveWithin(this.trashRoot(handle), 'sessions', `${sessionId}-${suffix}`);
  }

  libraryRoot(owner: LibraryOwner): string {
    return owner.kind === 'system'
      ? resolveWithin(this.systemRoot, 'library')
      : resolveWithin(this.userRoot(owner.handle), 'library');
  }

  /** `…/library/actors`, `…/library/lorebooks`, and so on. */
  kindRoot(owner: LibraryOwner, schemaId: PortableSchemaId): string {
    return resolveWithin(this.libraryRoot(owner), LIBRARY_DIRECTORIES[schemaId]);
  }

  objectRoot(owner: LibraryOwner, schemaId: PortableSchemaId, slug: string): string {
    return resolveWithin(this.kindRoot(owner, schemaId), slug);
  }

  objectFile(owner: LibraryOwner, schemaId: PortableSchemaId, slug: string): string {
    return resolveWithin(this.objectRoot(owner, schemaId, slug), OBJECT_FILENAMES[schemaId]);
  }

  /** Bulk assets, relative to the object folder and never escaping it ([03 §5.3]). */
  assetsRoot(owner: LibraryOwner, schemaId: PortableSchemaId, slug: string): string {
    return resolveWithin(this.objectRoot(owner, schemaId, slug), 'assets');
  }

  /**
   * The inverse of {@link objectFile}: given a path on disk, what object is it?
   *
   * The watcher needs this and so does a rebuild — both are handed a path and
   * have to decide whether it is a library object at all before doing anything
   * with it. Returning null rather than throwing is the point: a data directory
   * is full of files that are *not* objects (assets, a stray `.DS_Store`, a
   * user's notes), and being handed one is normal rather than exceptional.
   *
   * Matching is on the **canonical filename for the kind**, so
   * `actors/vera/card.png` is an actor and `actors/vera/assets/portrait.png` is
   * not. That is what keeps a gallery of forty images from producing forty
   * spurious index events.
   */
  /**
   * A path inside the data directory, in its portable form — F23.
   *
   * `users/ned/library/actors/vera/card.png`: relative to the root and always
   * `/`-separated, whatever the platform stored.
   *
   * The index keeps the **native absolute** path, because that is what opens a
   * file. Anything that *orders* or *compares* paths has to use this instead:
   * the duplicate rule is "earliest path wins", and under SQLite's BINARY
   * collation the byte that decides is the separator — `/` is 0x2F and `\` is
   * 0x5C. Where one slug is a prefix of another, `vera` beats `vera2` on Linux
   * and loses on Windows, which would make the shadowed copy platform-dependent
   * and gate step 12 answer differently on the two CI legs.
   */
  portablePath(path: string): string | null {
    return relativeWithin(this.dataRoot, path);
  }

  parseObjectPath(path: string): ParsedObjectPath | null {
    const relative = relativeWithin(this.dataRoot, path);
    if (!relative) return null;

    const parts = relative.split('/');

    // system/library/<kind>/<slug>/<file>  |  users/<handle>/library/<kind>/<slug>/<file>
    let owner: LibraryOwner;
    let rest: string[];
    if (parts[0] === 'system') {
      owner = SYSTEM_OWNER;
      rest = parts.slice(1);
    } else if (parts[0] === 'users' && parts[1] !== undefined) {
      if (!isValidHandle(parts[1])) return null;
      owner = userOwner(parts[1]);
      rest = parts.slice(2);
    } else {
      return null;
    }

    const [library, directory, slug, filename, ...deeper] = rest;
    if (library !== 'library' || !directory || !slug || !filename) return null;
    // `assets/…` and anything else below the object folder is not the object.
    if (deeper.length > 0) return null;

    const entry = Object.entries(LIBRARY_DIRECTORIES).find(([, dir]) => dir === directory);
    if (!entry) return null;
    const schemaId = entry[0] as PortableSchemaId;

    if (filename !== OBJECT_FILENAMES[schemaId]) return null;

    return { owner, schemaId, slug, path };
  }
}

export interface ParsedObjectPath {
  owner: LibraryOwner;
  schemaId: PortableSchemaId;
  slug: string;
  path: string;
}

/**
 * The portable-path form of `path` beneath `root`, or null if it is outside.
 *
 * Forward slashes regardless of platform, because these strings are compared,
 * split and stored — a path that reads one way on Windows and another on Linux
 * would make the index's contents platform-dependent.
 */
function relativeWithin(root: string, path: string): string | null {
  if (!isContained(root, path)) return null;
  const relative = relativePath(root, path);
  return relative.length === 0 ? null : relative.split(sep).join('/');
}

/**
 * Turns a name into a folder name that is free within `directory`.
 *
 * **Derived at creation and then frozen** — renaming an object changes the name
 * *inside the file* and the folder keeps the name it was born with
 * ([P1 §1.1](../../../../docs/design/workplan/07-p1-implementation.md)). The engine never moves the
 * user's directories, so this runs exactly once per object and is the only place
 * a slug is chosen.
 *
 * De-duplication is a numeric suffix against what is actually on disk rather
 * than against the index, because the index is derived and a folder someone
 * copied in by hand is just as real as one we wrote. Reading the directory is
 * also what makes a *foreign* rename a non-event: the slug never has to agree
 * with anything.
 */
export async function resolveFreeSlug(directory: string, name: string): Promise<string> {
  const base = slugify(name);
  const taken = await existingEntries(directory);

  if (!taken.has(base.toLowerCase())) return base;

  // Start at 2, so the first collision reads `vera-solano-2` beside
  // `vera-solano` rather than introducing a `-1` nobody asked for.
  for (let suffix = 2; suffix < 10_000; suffix += 1) {
    const candidate = `${base}-${String(suffix)}`;
    if (!taken.has(candidate.toLowerCase())) return candidate;
  }

  throw new Error(`Could not find a free slug for ${JSON.stringify(name)} in ${directory}`);
}

/**
 * Lower-cased, because Windows and macOS would treat `Vera` and `vera` as one
 * directory. Colliding on the case-insensitive form everywhere keeps a library
 * authored on Linux from becoming unopenable when it is copied to a laptop.
 */
async function existingEntries(directory: string): Promise<Set<string>> {
  const entries = await listEntryNames(directory);
  return new Set(entries.map((entry) => entry.toLowerCase()));
}
