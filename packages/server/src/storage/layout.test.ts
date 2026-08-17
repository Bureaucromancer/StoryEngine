// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { ACTOR_SCHEMA, LOREBOOK_SCHEMA, PACKAGE_SCHEMA, PRESET_SCHEMA } from '@storyengine/shared';

import {
  isValidHandle,
  Layout,
  OBJECT_FILENAMES,
  resolveFreeSlug,
  SYSTEM_SCOPE,
  userScope,
} from './layout.js';
import { PathEscapeError } from './paths.js';

const DATA = resolve('/data');
const layout = new Layout(DATA);
const ned = userScope('ned');

describe('the data directory', () => {
  it('places the fixed files where 02 §5.1 says', () => {
    expect(layout.configFile).toBe(join(DATA, 'config.json'));
    expect(layout.indexFile).toBe(join(DATA, 'index', 'index.sqlite'));
    expect(layout.systemRoot).toBe(join(DATA, 'system'));
    expect(layout.usersRoot).toBe(join(DATA, 'users'));
  });

  it('keeps accounts.json outside every user directory', () => {
    // [P1 §1.3](../../../../docs/design/workplan/03-p1-implementation.md): so the file browser can
    // never serve a password hash, whatever `fileAccess` a user is granted.
    expect(layout.accountsFile).toBe(join(DATA, 'accounts.json'));
    expect(layout.accountsFile.startsWith(layout.usersRoot)).toBe(false);
  });

  it('keeps operational state out of the index', () => {
    // [13 §5.1](../../../../docs/design/13-internal-contracts.md): deleting the index must
    // cost time and nothing else. Anything for which that is false — jobs,
    // idempotency keys, the notification inbox — needs its own home.
    expect(layout.stateFile).toBe(join(DATA, 'state', 'state.sqlite'));
    expect(layout.stateFile).not.toBe(layout.indexFile);
  });
});

describe('library scopes', () => {
  it('gives system and user libraries the same shape', () => {
    // The merge is a query, not a special case
    // ([02 §5.1](../../../../docs/design/02-data-model.md)) — which is only true if both
    // sides have the same layout underneath.
    expect(layout.libraryRoot(SYSTEM_SCOPE)).toBe(join(DATA, 'system', 'library'));
    expect(layout.libraryRoot(ned)).toBe(join(DATA, 'users', 'ned', 'library'));

    const systemActors = layout.kindRoot(SYSTEM_SCOPE, ACTOR_SCHEMA);
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
    // ([02 §5.2](../../../../docs/design/02-data-model.md)).
    expect(OBJECT_FILENAMES[ACTOR_SCHEMA]).toBe('card.png');
    expect(OBJECT_FILENAMES[PRESET_SCHEMA]).toBe('preset.json');
    expect(OBJECT_FILENAMES[PACKAGE_SCHEMA]).toBe('package.json');
  });

  it('keeps assets inside the object folder', () => {
    const folder = layout.objectRoot(ned, ACTOR_SCHEMA, 'vera-solano');
    expect(layout.assetsRoot(ned, ACTOR_SCHEMA, 'vera-solano')).toBe(join(folder, 'assets'));
  });
});

describe('handles are hostile input', () => {
  // A handle becomes a directory name under `users/`, and the path is the owner
  // ([04 §4.3](../../../../docs/design/04-server-multiuser-deployment.md)). The cost of
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
    expect(() => layout.libraryRoot(userScope('..'))).toThrow(PathEscapeError);
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
    // ([P1 §1.2](../../../../docs/design/workplan/03-p1-implementation.md)).
    await mkdir(join(dir, 'vera-solano'));
    await writeFile(join(dir, 'vera-solano-2'), 'not even a directory');
    await expect(resolveFreeSlug(dir, 'Vera Solano')).resolves.toBe('vera-solano-3');
  });

  it('escapes a reserved device name before de-duplicating it', async () => {
    await expect(resolveFreeSlug(dir, 'Con')).resolves.toBe('con_');
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
      layout.systemRoot,
      layout.systemConnectionsRoot,
      layout.usersRoot,
      layout.userRoot('ned'),
      layout.userConnectionsRoot('ned'),
      layout.sessionsRoot('ned'),
      layout.sessionRoot('ned', '01234567-89ab-7cde-8f01-23456789abcd'),
      layout.memoriesRoot('ned'),
      layout.trashRoot('ned'),
      layout.libraryRoot(ned),
      layout.libraryRoot(SYSTEM_SCOPE),
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
