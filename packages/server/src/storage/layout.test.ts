// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { ACTOR_SCHEMA, LOREBOOK_SCHEMA, PRESET_SCHEMA, WORLD_SCHEMA } from '@storyengine/shared';

import {
  isValidHandle,
  Layout,
  LEGACY_OBJECT_FILENAMES,
  OBJECT_FILENAMES,
  objectFilenames,
  resolveFreeFolder,
  resolveFreeSlug,
  SYSTEM_OWNER,
  userOwner,
} from './layout.js';
import { PathEscapeError } from './paths.js';

const DATA = resolve('/data');
const layout = new Layout(DATA);
const ned = userOwner('ned');

describe('the data directory', () => {
  it('places the fixed files where 02 §5.1 says', () => {
    expect(layout.configFile).toBe(join(DATA, 'config.json'));
    expect(layout.indexFile).toBe(join(DATA, 'index', 'index.sqlite'));
    expect(layout.systemRoot).toBe(join(DATA, 'system'));
    expect(layout.usersRoot).toBe(join(DATA, 'users'));
  });

  it('keeps accounts.json outside every user directory', () => {
    // [P1 §1.3](../../../../docs/design/workplan/07-p1-implementation.md): so the file browser can
    // never serve a password hash, whatever `fileAccess` a user is granted.
    expect(layout.accountsFile).toBe(join(DATA, 'accounts.json'));
    expect(layout.accountsFile.startsWith(layout.usersRoot)).toBe(false);
  });

  it('keeps operational state out of the index', () => {
    // [22 §5.1](../../../../docs/design/22-internal-contracts.md): deleting the index must
    // cost time and nothing else. Anything for which that is false — jobs,
    // idempotency keys, the notification inbox — needs its own home.
    expect(layout.stateFile).toBe(join(DATA, 'state', 'state.sqlite'));
    expect(layout.stateFile).not.toBe(layout.indexFile);
  });

  it('keeps import scratch in state/, and out of every place something reads', () => {
    // [P13 §1.3](../../../../docs/design/workplan/30-p13-aventuras-import.md):
    // beside P12's own snapshot, never under `users/` where the watcher and the
    // library would see a half-written copy of somebody's install.
    expect(layout.importScratchRoot).toBe(join(DATA, 'state', 'import-scratch'));
    expect(layout.importScratchRoot.startsWith(layout.usersRoot)).toBe(false);
    expect(layout.importScratchRoot.startsWith(layout.indexRoot)).toBe(false);
  });
});

describe('library owners', () => {
  it('gives system and user libraries the same shape', () => {
    // The merge is a query, not a special case
    // ([03 §5.1](../../../../docs/design/03-data-model.md)) — which is only true if both
    // sides have the same layout underneath.
    expect(layout.libraryRoot(SYSTEM_OWNER)).toBe(join(DATA, 'system', 'library'));
    expect(layout.libraryRoot(ned)).toBe(join(DATA, 'users', 'ned', 'library'));

    const systemActors = layout.kindRoot(SYSTEM_OWNER, ACTOR_SCHEMA);
    const userActors = layout.kindRoot(ned, ACTOR_SCHEMA);
    expect(systemActors.endsWith(join('library', 'actors'))).toBe(true);
    expect(userActors.endsWith(join('library', 'actors'))).toBe(true);
  });

  it('resolves an object folder and its canonical file', () => {
    expect(layout.objectFile(ned, ACTOR_SCHEMA, 'vera-solano')).toBe(
      join(DATA, 'users', 'ned', 'library', 'actors', 'vera-solano', 'card.png'),
    );
    expect(layout.objectFile(ned, LOREBOOK_SCHEMA, 'rain-city')).toBe(
      join(DATA, 'users', 'ned', 'library', 'lorebooks', 'rain-city', 'lorebook.json'),
    );
  });

  it('makes the actor a PNG and everything else JSON', () => {
    // `card.png` is canonical for an actor, not a mirror of a JSON file — two
    // sources of truth is the failure mode being avoided
    // ([03 §5.2](../../../../docs/design/03-data-model.md)).
    expect(OBJECT_FILENAMES[ACTOR_SCHEMA]).toBe('card.png');
    expect(OBJECT_FILENAMES[PRESET_SCHEMA]).toBe('preset.json');
    expect(OBJECT_FILENAMES[WORLD_SCHEMA]).toBe('world.json');
  });

  it('keeps assets inside the object folder', () => {
    const folder = layout.objectRoot(ned, ACTOR_SCHEMA, 'vera-solano');
    expect(layout.assetsRoot(ned, ACTOR_SCHEMA, 'vera-solano')).toBe(join(folder, 'assets'));
  });
});

describe('what the watcher looks at', () => {
  /**
   * `leadsToObjects` is the watcher's whole scope (2026-10-06): a path it
   * refuses is never watched, and on Windows a watched folder is a directory
   * handle that stops its ancestors being renamed — which is what a delete is.
   * Both halves matter. Admit too little and a hand edit is never seen; admit
   * too much and the delete of an object with history fails with `EPERM`.
   */
  const under = (...segments: string[]): string => join(DATA, ...segments);
  const book = ['users', 'ned', 'library', 'lorebooks', 'rain-city'];

  it('admits every step on the way to an object file, and the file', () => {
    for (const path of [
      DATA,
      under('system'),
      under('system', 'library'),
      under('system', 'library', 'actors'),
      under('system', 'library', 'actors', 'vera'),
      under('system', 'library', 'actors', 'vera', 'card.png'),
      under('users'),
      under('users', 'ned'),
      under('users', 'ned', 'library'),
      under('users', 'ned', 'library', 'lorebooks'),
      under(...book),
      under(...book, 'lorebook.json'),
      // A folder this build will not resolve still has to reach the handler,
      // which is what reports it as unusable ([P6B.1]).
      under('users', 'ned', 'library', 'lorebooks', 'con', 'lorebook.json'),
    ]) {
      expect(layout.leadsToObjects(path), path).toBe(true);
    }
  });

  it('refuses everything inside an object folder but the object', () => {
    for (const path of [
      under(...book, 'history'),
      under(...book, 'history', 'v'),
      under(...book, 'history', 'index.jsonl'),
      under(...book, 'assets'),
      under(...book, 'assets', 'map.png'),
      // An atomic write's temporary, and another kind's filename.
      under(...book, 'lorebook.json.4021'),
      under(...book, 'card.png'),
    ]) {
      expect(layout.leadsToObjects(path), path).toBe(false);
    }
  });

  it('refuses everything that is not a library', () => {
    for (const path of [
      layout.indexRoot,
      layout.stateRoot,
      layout.accountsFile,
      layout.configFile,
      layout.backupsRoot,
      layout.removedRoot,
      under('system', 'connections'),
      under('users', 'ned', 'sessions'),
      under('users', 'ned', 'sessions', '01a0158c', 'turns'),
      under('users', 'ned', 'trash'),
      under('users', 'ned', 'trash', 'lorebooks', 'rain-city-01a1', 'history'),
      layout.userBackupsRoot('ned'),
      under('users', 'ned', 'tags.json'),
      under('users', 'ned', 'library', 'not-a-kind'),
      under('users', '-ned', 'library'),
      resolve('/elsewhere'),
      `${DATA}-evil`,
    ]) {
      expect(layout.leadsToObjects(path), path).toBe(false);
    }
  });
});

/**
 * ***The kind that was Package, read under both names*** — [P16 §1.1]. Each
 * assertion below fails with its alias removed: the folder from
 * `LEGACY_LIBRARY_DIRECTORIES`, the file name from `LEGACY_OBJECT_FILENAMES`.
 */
describe('a World under the names it had as a Package (P16.0)', () => {
  const library = ['users', 'ned', 'library'];
  const at = (...segments: string[]): string => join(DATA, ...library, ...segments);

  it('writes the new names and reads the old ones', () => {
    expect(layout.kindRoot(ned, WORLD_SCHEMA)).toBe(at('worlds'));
    expect(layout.objectFile(ned, WORLD_SCHEMA, 'rain-city')).toBe(
      at('worlds', 'rain-city', 'world.json'),
    );
    expect(LEGACY_OBJECT_FILENAMES[WORLD_SCHEMA]).toEqual(['package.json']);
    expect(objectFilenames(WORLD_SCHEMA)).toEqual(['world.json', 'package.json']);
    // Every other kind has the one name, and nothing to read beside it.
    expect(objectFilenames(LOREBOOK_SCHEMA)).toEqual(['lorebook.json']);
  });

  it('walks the old folder after the new one, for the World and no other kind', () => {
    expect(layout.kindRoots(ned, WORLD_SCHEMA)).toEqual([at('worlds'), at('packages')]);
    expect(layout.kindRoots(SYSTEM_OWNER, WORLD_SCHEMA)).toEqual([
      join(DATA, 'system', 'library', 'worlds'),
      join(DATA, 'system', 'library', 'packages'),
    ]);
    expect(layout.kindRoots(ned, LOREBOOK_SCHEMA)).toEqual([at('lorebooks')]);
  });

  it('parses a Package where it was left as a World, and says it is legacy', () => {
    const path = at('packages', 'rain-city', 'package.json');
    expect(layout.parseObjectPath(path)).toEqual({
      owner: ned,
      schemaId: WORLD_SCHEMA,
      slug: 'rain-city',
      path,
      legacy: true,
    });
    const system = join(DATA, 'system', 'library', 'packages', 'rain-city', 'package.json');
    expect(layout.parseObjectPath(system)?.schemaId).toBe(WORLD_SCHEMA);
  });

  it('parses the current shape as current', () => {
    const path = at('worlds', 'rain-city', 'world.json');
    expect(layout.parseObjectPath(path)).toEqual({
      owner: ned,
      schemaId: WORLD_SCHEMA,
      slug: 'rain-city',
      path,
      legacy: false,
    });
  });

  it('reads either name in either folder, so every state the move can stop in reads', () => {
    // The move is a folder rename and then a file rename (`library.ts`,
    // `relocateLegacy`). Stopped between them, the new folder holds the old
    // name, and that has to be a World rather than a vanished one.
    for (const path of [
      at('worlds', 'rain-city', 'package.json'),
      at('packages', 'rain-city', 'world.json'),
    ]) {
      expect(layout.parseObjectPath(path), path).toMatchObject({
        schemaId: WORLD_SCHEMA,
        legacy: true,
      });
    }
  });

  it('reads no other kind under the old file name, and nothing below the object', () => {
    for (const path of [
      at('lorebooks', 'rain-city', 'package.json'),
      at('packages', 'rain-city', 'lorebook.json'),
      at('packages', 'rain-city', 'history', 'index.jsonl'),
      at('packages', 'rain-city', 'assets', 'map.png'),
    ]) {
      expect(layout.parseObjectPath(path), path).toBeNull();
    }
  });

  it('lets the watcher see the old folder, and nothing in it but the object', () => {
    for (const path of [
      at('packages'),
      at('packages', 'rain-city'),
      at('packages', 'rain-city', 'package.json'),
      at('worlds', 'rain-city', 'world.json'),
    ]) {
      expect(layout.leadsToObjects(path), path).toBe(true);
    }
    for (const path of [
      at('packages', 'rain-city', 'history'),
      at('packages', 'rain-city', 'assets'),
    ]) {
      expect(layout.leadsToObjects(path), path).toBe(false);
    }
  });

  it("finds an object's folder from its path, not from its kind and slug", () => {
    // `objectRoot(ned, WORLD, 'rain-city')` names `worlds/rain-city`, which may
    // be another World: the folder a legacy object is in is read off its path.
    const legacy = at('packages', 'rain-city', 'package.json');
    expect(layout.folderOf(legacy)).toBe(at('packages', 'rain-city'));
    expect(layout.objectRoot(ned, WORLD_SCHEMA, 'rain-city')).toBe(at('worlds', 'rain-city'));
    expect(() => layout.folderOf(at('packages', 'rain-city', 'history', 'x.json'))).toThrow(
      PathEscapeError,
    );
    expect(() => layout.folderOf(resolve('/elsewhere/world.json'))).toThrow(PathEscapeError);
  });

  it('trashes a folder into the trash folder of the folder it was in', () => {
    const suffix = '0199a1b2-0000-7000-8000-000000000000';
    expect(layout.trashDestinationFor('ned', at('packages', 'rain-city'), suffix)).toBe(
      join(DATA, 'users', 'ned', 'trash', 'packages', `rain-city-${suffix}`),
    );
    expect(layout.trashDestinationFor('ned', at('worlds', 'rain-city'), suffix)).toBe(
      join(DATA, 'users', 'ned', 'trash', 'worlds', `rain-city-${suffix}`),
    );
    expect(() => layout.trashDestinationFor('ned', at('elsewhere', 'x'), suffix)).toThrow(
      PathEscapeError,
    );
  });
});

describe('handles are hostile input', () => {
  // A handle becomes a directory name under `users/`, and the path is the owner
  // ([09 §4.3](../../../../docs/design/09-server-multiuser-deployment.md)). The cost of
  // getting this wrong is one account reaching another's library.
  it.each(['ned', 'ned-2', 'a', 'x'.repeat(63)])('accepts %s', (handle) => {
    expect(isValidHandle(handle)).toBe(true);
  });

  it.each([
    ['..', 'the traversal'],
    ['../other', 'traversal with a separator'],
    ['..\\other', 'traversal, Windows-flavoured'],
    ['/etc', 'absolute'],
    ['C:evil', 'drive-relative'],
    ['Ned', 'uppercase — case-folding collisions on Windows and macOS'],
    ['ned ', 'trailing space'],
    ['ned.', 'trailing dot'],
    ['con', 'a reserved device name'],
    ['ned:stream', 'an alternate data stream'],
    ['ned\0', 'a null byte'],
    ['-ned', 'leading hyphen'],
    ['ned-', 'trailing hyphen'],
    ['', 'empty'],
    ['x'.repeat(64), 'too long'],
  ])('rejects %j — %s', (handle) => {
    expect(isValidHandle(handle)).toBe(false);
  });

  it('throws rather than resolving a path for a bad handle', () => {
    expect(() => layout.userRoot('../other')).toThrow(PathEscapeError);
    expect(() => layout.libraryRoot(userOwner('..'))).toThrow(PathEscapeError);
  });

  it('cannot be talked out of the users directory', () => {
    const root = layout.userRoot('ned');
    expect(root.startsWith(layout.usersRoot + sep)).toBe(true);
  });
});

describe('slug resolution', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'se-layout-'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('uses the plain slug when the directory is empty or missing', async () => {
    await expect(resolveFreeSlug(join(dir, 'nope'), 'Vera Solano')).resolves.toBe('vera-solano');
    await expect(resolveFreeSlug(dir, 'Vera Solano')).resolves.toBe('vera-solano');
  });

  it('de-duplicates from 2, so the first of a pair keeps its plain name', async () => {
    await mkdir(join(dir, 'vera-solano'));
    await expect(resolveFreeSlug(dir, 'Vera Solano')).resolves.toBe('vera-solano-2');

    await mkdir(join(dir, 'vera-solano-2'));
    await expect(resolveFreeSlug(dir, 'Vera Solano')).resolves.toBe('vera-solano-3');
  });

  it('collides case-insensitively', async () => {
    // Windows and macOS treat `Vera` and `vera` as one directory. Colliding on
    // the case-insensitive form everywhere keeps a library authored on Linux
    // from becoming unopenable when it is copied to a laptop.
    await mkdir(join(dir, 'Vera-Solano'));
    await expect(resolveFreeSlug(dir, 'vera solano')).resolves.toBe('vera-solano-2');
  });

  it('counts a folder someone copied in by hand', async () => {
    // De-duplication reads the disk rather than the index, because the index is
    // derived and a hand-copied folder is just as real as one we wrote
    // ([P1 §1.2](../../../../docs/design/workplan/07-p1-implementation.md)).
    await mkdir(join(dir, 'vera-solano'));
    await writeFile(join(dir, 'vera-solano-2'), 'not even a directory');
    await expect(resolveFreeSlug(dir, 'Vera Solano')).resolves.toBe('vera-solano-3');
  });

  it('escapes a reserved device name before de-duplicating it', async () => {
    await expect(resolveFreeSlug(dir, 'Con')).resolves.toBe('con_');
  });

  /**
   * ***A folder that already has a name keeps it when it moves*** — the
   * legacy World's move ([P16 §1.1]), which starts from a slug rather than a
   * name and must not tidy one a person chose.
   */
  it('keeps a moving folder its name when free, and suffixes it when taken', async () => {
    await expect(resolveFreeFolder(dir, 'Rain_City notes')).resolves.toBe('Rain_City notes');
    await mkdir(join(dir, 'rain-city'));
    await expect(resolveFreeFolder(dir, 'rain-city')).resolves.toBe('rain-city-2');
    await expect(resolveFreeFolder(dir, 'Rain-City')).resolves.toBe('Rain-City-2');
  });
});

describe('the layout never produces a path outside the data root', () => {
  it('holds for every accessor', () => {
    // The property, rather than a list of examples: everything this class emits
    // is beneath the root it was constructed with.
    const paths = [
      layout.configFile,
      layout.accountsFile,
      layout.indexFile,
      layout.stateFile,
      layout.importScratchRoot,
      layout.systemRoot,
      layout.systemConnectionsRoot,
      layout.usersRoot,
      layout.userRoot('ned'),
      layout.userConnectionsRoot('ned'),
      layout.usageLogFile('ned'),
      layout.sessionsRoot('ned'),
      layout.sessionRoot('ned', '01234567-89ab-7cde-8f01-23456789abcd'),
      layout.trashRoot('ned'),
      layout.libraryRoot(ned),
      layout.libraryRoot(SYSTEM_OWNER),
      layout.kindRoot(ned, ACTOR_SCHEMA),
      layout.objectRoot(ned, ACTOR_SCHEMA, 'vera-solano'),
      layout.objectFile(ned, ACTOR_SCHEMA, 'vera-solano'),
      layout.assetsRoot(ned, ACTOR_SCHEMA, 'vera-solano'),
    ];

    for (const path of paths) {
      expect(path.startsWith(DATA), path).toBe(true);
    }
  });

  it('refuses a slug that tries to climb out', () => {
    expect(() => layout.objectRoot(ned, ACTOR_SCHEMA, '../../../etc')).toThrow(PathEscapeError);
    expect(() => layout.sessionRoot('ned', '..')).toThrow(PathEscapeError);
  });
});

/**
 * **The data root is the path the filesystem actually uses** — F26.
 *
 * Found by CI, on the first run that had ever covered this code on Windows: five
 * workers died with no failed assertion and no JS stack, because libuv's
 * directory watcher `abort()`s natively when the path it was handed is not the
 * spelling Windows reports back. `os.tmpdir()` is the 8.3 alias whenever the
 * account name runs past eight characters, and GitHub's runner is `runneradmin`.
 *
 * These three assert the *normalisation*, not the crash — a test that triggered
 * the abort would kill its own worker, which is exactly how this shipped. The
 * behaviour that depends on it lives in `watcher.test.ts`; the crash itself is
 * in `watcher-alias.test.ts`, in a subprocess, on Windows only.
 *
 * *A note on the module-scope `layout` above:* it resolves `/data`, which does
 * not exist here, so the ancestor walk hands it back unchanged. On a machine
 * where `/data` or `C:\data` does exist under a different casing, those
 * assertions would start failing for a reason that has nothing to do with this.
 */
describe('the data root, whatever alias it was configured under', () => {
  let real: string;

  beforeEach(async () => {
    real = new Layout(await mkdtemp(join(tmpdir(), 'se-root-'))).dataRoot;
  });

  afterEach(async () => {
    await rm(real, { recursive: true, force: true });
  });

  it('resolves a link to its target', async () => {
    const link = join(real, 'via-a-link');
    const target = join(real, 'target');
    await mkdir(target);
    // `junction` needs no elevation on Windows and is ignored on POSIX, where
    // Node makes an ordinary symlink. So this leg runs everywhere.
    await symlink(target, link, 'junction');

    expect(new Layout(link).dataRoot).toBe(target);
  });

  /**
   * **The one leg the link test cannot stand in for.** Plain `realpathSync`
   * resolves a link perfectly well and returns an 8.3 name exactly as it found
   * it — a short name is not a link. So swapping `realpathSync.native` for the
   * plain one leaves every other assertion here green.
   */
  it.runIf(process.platform === 'win32')('resolves an 8.3 alias to its long name', () => {
    const alias = shortNameOf(real);
    if (alias === null) return; // 8.3 generation is per-volume and can be off.
    expect(alias).toContain('~');

    expect(new Layout(alias).dataRoot).toBe(real);
  });

  /**
   * `main.ts` builds a `Layout` on `./data` before anything has created it, so a
   * normaliser that threw `ENOENT` from inside a constructor would be the worse
   * bug. The deepest ancestor that exists is what gets resolved.
   */
  it('normalises a root that does not exist yet', () => {
    const nested = join(shortNameOf(real) ?? real, 'data', 'deeper');

    expect(new Layout(nested).dataRoot).toBe(join(real, 'data', 'deeper'));
  });
});

/**
 * The 8.3 alias of a directory, or null when the volume does not generate them.
 *
 * `windowsVerbatimArguments` is load-bearing: without it Node re-quotes the
 * `for` expression and `cmd` echoes the long path straight back, quotes and all,
 * so the probe silently reports no alias and the test above skips itself.
 */
function shortNameOf(directory: string): string | null {
  if (process.platform !== 'win32') return null;
  const probe = spawnSync('cmd', ['/d', '/s', '/c', `for %I in ("${directory}") do @echo %~sI`], {
    encoding: 'utf8',
    windowsVerbatimArguments: true,
  });
  const out = probe.stdout.trim();

  return out.length > 0 && out !== directory ? out : null;
}
