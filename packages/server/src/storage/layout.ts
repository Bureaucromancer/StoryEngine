// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { relative as relativePath, sep } from 'node:path';

import {
  ACTOR_SCHEMA,
  LIBRARY_DIRECTORIES,
  LOREBOOK_SCHEMA,
  WORLD_SCHEMA,
  type PortableSchemaId,
  PRESET_SCHEMA,
  TREATMENT_SCHEMA,
  SETUP_SCHEMA,
  slugify,
} from '@storyengine/shared';

import { listEntryNames } from './files.js';
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
 *   state/state.sqlite     operational. Deleting it is *not* a non-event — [22 §5.1]
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
  // [03 §5.1](../../../../docs/design/03-data-model.md) gives worlds a folder and defers
  // its contents to §7, which describes the *format* rather than the on-disk
  // shape. So this filename is the object's own document, and whether a stored
  // world also holds copies of its members or only names them is the question
  // [15](../../../../docs/design/15-world.md) settles — the arrangement lands
  // with `.seworld` import and export, which [P4 §4] puts out of scope and
  // places around P11. This comment said "settled at P4" until P4.0 read it:
  // P4 imports other people's formats and deliberately not our own.
  [WORLD_SCHEMA]: 'world.json',
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
 * Every path in the data directory, derived from one root.
 *
 * A class rather than loose functions taking `dataRoot` everywhere, because the
 * root comes from config ([22 §4](../../../../docs/design/22-internal-contracts.md)) and
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

  /** Derived and disposable. Deleting it must be a non-event ([22 §5]). */
  get indexFile(): string {
    return resolveWithin(this.indexRoot, 'index.sqlite');
  }

  /**
   * Operational state: jobs, idempotency keys, the notification inbox. **Not**
   * derived, not rebuildable, and therefore not in the index
   * ([22 §5.1](../../../../docs/design/22-internal-contracts.md)).
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
   * put a credential ([22 §4]), and not in the index, which is deletable
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
   * [20 §5.1](../../../../docs/design/20-tech-stack.md) puts *install default* at the weak end of
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
   * `users/<handle>/prefs.json` — client preferences ([26 B13]).
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

  memoriesRoot(handle: string): string {
    return resolveWithin(this.userRoot(handle), 'memories');
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
