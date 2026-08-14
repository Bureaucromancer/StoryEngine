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
  SETTING_SCHEMA,
  SETUP_SCHEMA,
  slugify,
} from '@storyengine/shared';

import { listEntryNames } from './files.js';
import { assertSafeSegment, isContained, PathEscapeError, resolveWithin } from './paths.js';

/**
 * The data directory, from [02 §5.1](docs/design/02-data-model.md).
 *
 * ```
 * /data
 *   config.json
 *   accounts.json          authoritative, never derived — [19 §1.3]
 *   system/library/        shipped, read-only, loaded for everyone
 *   users/<handle>/library/…
 *   index/index.sqlite     derived. Deleting it must be a non-event.
 *   state/state.sqlite     operational. Deleting it is *not* a non-event — [18 §5.1]
 * ```
 *
 * **The path is the owner.** There is no `owner` field and no shared user area
 * ([04 §4.3](docs/design/04-server-multiuser-deployment.md)), which is why every
 * route resolves its root from the session rather than from a parameter — and
 * why `userRoot` treats its handle as hostile input.
 *
 * `system/library/` has the same shape as a user's, so the merge is a query
 * rather than a special case ([02 §5.1](docs/design/02-data-model.md)). That is
 * the entire reason `LibraryScope` exists instead of two sets of functions.
 */

export type LibraryScope = { kind: 'user'; handle: string } | { kind: 'system' };

export const SYSTEM_SCOPE: LibraryScope = { kind: 'system' };

export function userScope(handle: string): LibraryScope {
  return { kind: 'user', handle };
}

/**
 * The file that *is* the object, inside its folder.
 *
 * Actors are the odd one out and deliberately so: `card.png` is canonical, not a
 * mirror of a JSON file, because two sources of truth is the failure mode being
 * avoided ([02 §5.2](docs/design/02-data-model.md)).
 */
export const OBJECT_FILENAMES = {
  [ACTOR_SCHEMA]: 'card.png',
  [LOREBOOK_SCHEMA]: 'lorebook.json',
  [SETTING_SCHEMA]: 'setting.json',
  [SETUP_SCHEMA]: 'setup.json',
  [PRESET_SCHEMA]: 'preset.json',
  // [02 §5.1](docs/design/02-data-model.md) gives packages a folder and defers
  // its contents to §7, which describes the *format* rather than the on-disk
  // shape. A stored package also holds embedded copies of its contents, so this
  // filename is the manifest rather than the whole object — and the arrangement
  // is settled at P4 with import, not guessed at here.
  [PACKAGE_SCHEMA]: 'package.json',
} as const satisfies Record<PortableSchemaId, string>;

/**
 * A handle is a directory name under `users/`, so it is checked before it is
 * ever concatenated with anything.
 *
 * Stricter than `slugify` produces, on purpose: this is the one user-supplied
 * string that becomes a path component at first-run
 * ([19 §1.3](docs/design/19-p1-implementation.md)), and the cost of a mistake is
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
 * root comes from config ([18 §4](docs/design/18-internal-contracts.md)) and
 * threading it through every call site is how one caller ends up using a
 * default and writing somewhere nobody expects.
 */
export class Layout {
  readonly dataRoot: string;

  constructor(dataRoot: string) {
    this.dataRoot = resolveWithin(dataRoot, '.');
  }

  /** `data/config.json` — commented example shipped alongside ([02 §5.4]). */
  get configFile(): string {
    return resolveWithin(this.dataRoot, 'config.json');
  }

  /**
   * `data/accounts.json`. Authoritative state, so a file and never an index row
   * ([19 §1.3](docs/design/19-p1-implementation.md)) — and deliberately outside
   * every user directory, so the file browser can never serve a password hash
   * whatever `fileAccess` a user is granted.
   */
  get accountsFile(): string {
    return resolveWithin(this.dataRoot, 'accounts.json');
  }

  /** Derived and disposable. Deleting it must be a non-event ([18 §5]). */
  get indexFile(): string {
    return resolveWithin(this.dataRoot, 'index', 'index.sqlite');
  }

  /**
   * Operational state: jobs, idempotency keys, the notification inbox. **Not**
   * derived, not rebuildable, and therefore not in the index
   * ([18 §5.1](docs/design/18-internal-contracts.md)).
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
   * put a credential ([18 §4]), and not in the index, which is deletable
   * without consequence.
   */
  get sessionKeyFile(): string {
    return resolveWithin(this.stateRoot, 'session.key');
  }

  get systemRoot(): string {
    return resolveWithin(this.dataRoot, 'system');
  }

  /** Admin-managed. Usable by all, readable by none ([04 §4.5]). */
  get systemConnectionsRoot(): string {
    return resolveWithin(this.systemRoot, 'connections');
  }

  get usersRoot(): string {
    return resolveWithin(this.dataRoot, 'users');
  }

  userRoot(handle: string): string {
    assertValidHandle(handle);
    return resolveWithin(this.usersRoot, handle);
  }

  /** Holds the password hash and `role`, so it is never content ([05 §4.2.1]). */
  accountFile(handle: string): string {
    return resolveWithin(this.userRoot(handle), 'account.json');
  }

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

  /** Deleted objects awaiting the retention window ([02 §10.2]). */
  trashRoot(handle: string): string {
    return resolveWithin(this.userRoot(handle), 'trash');
  }

  libraryRoot(scope: LibraryScope): string {
    return scope.kind === 'system'
      ? resolveWithin(this.systemRoot, 'library')
      : resolveWithin(this.userRoot(scope.handle), 'library');
  }

  /** `…/library/actors`, `…/library/lorebooks`, and so on. */
  kindRoot(scope: LibraryScope, schemaId: PortableSchemaId): string {
    return resolveWithin(this.libraryRoot(scope), LIBRARY_DIRECTORIES[schemaId]);
  }

  objectRoot(scope: LibraryScope, schemaId: PortableSchemaId, slug: string): string {
    return resolveWithin(this.kindRoot(scope, schemaId), slug);
  }

  objectFile(scope: LibraryScope, schemaId: PortableSchemaId, slug: string): string {
    return resolveWithin(this.objectRoot(scope, schemaId, slug), OBJECT_FILENAMES[schemaId]);
  }

  /** Bulk assets, relative to the object folder and never escaping it ([02 §5.3]). */
  assetsRoot(scope: LibraryScope, schemaId: PortableSchemaId, slug: string): string {
    return resolveWithin(this.objectRoot(scope, schemaId, slug), 'assets');
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
  parseObjectPath(path: string): ParsedObjectPath | null {
    const relative = relativeWithin(this.dataRoot, path);
    if (!relative) return null;

    const parts = relative.split('/');

    // system/library/<kind>/<slug>/<file>  |  users/<handle>/library/<kind>/<slug>/<file>
    let scope: LibraryScope;
    let rest: string[];
    if (parts[0] === 'system') {
      scope = SYSTEM_SCOPE;
      rest = parts.slice(1);
    } else if (parts[0] === 'users' && parts[1] !== undefined) {
      if (!isValidHandle(parts[1])) return null;
      scope = userScope(parts[1]);
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

    return { scope, schemaId, slug, path };
  }
}

export interface ParsedObjectPath {
  scope: LibraryScope;
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
 * ([19 §1.1](docs/design/19-p1-implementation.md)). The engine never moves the
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
