// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { mkdir, mkdtemp, realpath, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { NearMiss } from '@storyengine/shared';
import { describe, expect, it } from 'vitest';

import { openLocalSource, openParentSource, suggestedRoot } from '../storage/local-source.js';
import { classifyRoot } from './detect.js';
import type { FileSource } from './source.js';
import { MemoryFileSource } from './memory-source.js';
import { nearMiss, NEAR_MISS_PROBE_PATHS } from './near-miss.js';

/**
 * **The folder somebody picked, when it is not the one to point at.**
 *
 * Every case here is a real layout read out of the two applications' own source
 * rather than a shape invented to exercise a branch — which is the only way this
 * table can be checked at all, since the thing it models is other people's
 * directory conventions. Where a case exists because a *mutation* would
 * otherwise survive, the test says which one.
 *
 * Two structural facts drive the shape of this file:
 *
 * **`MemoryFileSource` cannot express an empty directory.** Its `exists` is a
 * `has()` plus a prefix scan over file keys, so a directory shows up only if a
 * file is under it. `DirectorySource.exists` is a bare `stat`, for which an
 * empty directory is `true`. Every SillyTavern rule probes two directories, so
 * the in-memory cases are structurally blind to the production-common state —
 * SillyTavern creates every template directory on every startup, so an empty
 * `characters/` is ordinary rather than pathological. Hence the real-tree tests
 * at the end, which are required rather than belt-and-braces.
 *
 * **The round trip is the property that matters.** A suggestion marked
 * `verified` claims the classifier would agree; the last block re-roots each
 * fixture at what was suggested and makes `classifyRoot` say so. That is the one
 * test that catches a prefix added to the table without its marks.
 */

function stLibrary(prefix: string, extra: Record<string, string> = {}): Record<string, string> {
  const at = (name: string): string => (prefix === '' ? name : `${prefix}/${name}`);
  return {
    [at('settings.json')]: '{}',
    [at('characters/vera.png')]: 'not really a png',
    [at('worlds/rain-city.json')]: '{}',
    ...extra,
  };
}

function marinaraStore(prefix: string, extra: Record<string, string> = {}): Record<string, string> {
  const at = (name: string): string => (prefix === '' ? name : `${prefix}/${name}`);
  return {
    [at('storage/manifest.json')]: JSON.stringify({ version: 4, backend: 'file-native' }),
    [at('storage/tables/characters.json')]: '[]',
    ...extra,
  };
}

/** The picked folder alone, which is what a caller with no readable parent has. */
function at(files: Record<string, string>): Promise<readonly NearMiss[]> {
  return nearMiss({ files: new MemoryFileSource(files) });
}

/** The picked folder and the one above it, which is what the route supplies. */
function within(
  files: Record<string, string>,
  parent: Record<string, string>,
): Promise<readonly NearMiss[]> {
  return nearMiss({ files: new MemoryFileSource(files), parent: new MemoryFileSource(parent) });
}

function situations(found: readonly NearMiss[]): string[] {
  return found.map((miss) => miss.situation);
}

describe('a SillyTavern install, pointed at wrongly', () => {
  it('sends somebody who picked the install root down to data/default-user', async () => {
    // A *complete* install root, `default/config.yaml` included — which is what
    // makes the program-folder rule eligible here and so pins its suppression.
    // Without that third file the suppression could be deleted with the suite
    // green, and a real install would get two contradictory sentences: the
    // library is in data/default-user, and where the library lives is set by
    // dataRoot.
    const found = await at({
      ...stLibrary('data/default-user'),
      'server.js': 'x',
      'package.json': '{}',
      'public/script.js': 'x',
      'default/config.yaml': 'dataRoot: ./data\n',
    });

    expect(found).toEqual([
      {
        situation: 'sillytavern-install-root',
        suggest: 'data/default-user',
        leadsTo: 'sillytavern',
        confidence: 'verified',
        note: {
          key: 'import.root.sillytavernBelow',
          params: { path: 'data/default-user' },
          level: 'warn',
        },
      },
    ]);
  });

  it('answers the same for a Docker host folder, which has no install markers', async () => {
    // The mutation this kills is gating the descent on `server.js` or
    // `package.json` — which reads as prudence and silently drops every Docker
    // user, whose host directory holds `config/`, `data/`, `plugins/` and
    // `extensions/` and nothing else. The descent needs no such gate: the
    // suggestion carries SillyTavern's full mark set, so it justifies itself.
    const found = await at({
      ...stLibrary('data/default-user'),
      'config/config.yaml': '',
      'plugins/.gitkeep': '',
      'extensions/.gitkeep': '',
    });

    expect(situations(found)).toEqual(['sillytavern-install-root']);
  });

  it('sends somebody with a pre-1.12 install to public, and says why it is different', async () => {
    const found = await at({
      ...stLibrary('public'),
      'server.js': 'x',
      'secrets.json': '{}',
    });

    expect(situations(found)).toEqual(['sillytavern-old-layout']);
    expect(found[0]?.note.key).toBe('import.root.sillytavernOldLayout');
  });

  it('sends somebody who picked the data folder into default-user', async () => {
    const found = await at({
      ...stLibrary('default-user'),
      '_storage/1234': '{}',
      'cookie-secret.txt': 'x',
    });

    // The path was found, so the sentence that has no path must stay quiet.
    expect(situations(found)).toEqual(['sillytavern-data-root']);
  });

  it('names the data folder without guessing a handle when default-user is absent', async () => {
    // A multi-user install, or one whose default user was renamed. There is no
    // name to derive — SillyTavern keeps handles in node-persist rather than as
    // directory names — so this pins that we say so instead of inventing one.
    const found = await at({
      ...stLibrary('alice'),
      '_storage/1234': '{}',
      'cookie-secret.txt': 'x',
      '_uploads/.gitkeep': '',
    });

    expect(situations(found)).toEqual(['sillytavern-user-folders']);
    expect(found[0]?.suggest).toBeNull();
  });

  it('needs more than a lone _storage before calling a folder SillyTavern’s data', async () => {
    // "Two of the three marks are required so a stray `_storage` cannot carry
    // the verdict alone" was a comment nothing checked. `_storage` is
    // node-persist's directory name, not SillyTavern's, so any Node project
    // using it would otherwise be diagnosed as somebody's ST data folder.
    expect(await at({ '_storage/1234': '{}', 'index.js': 'x' })).toEqual([]);
  });

  it('admits it cannot say where the library went when dataRoot was moved', async () => {
    const found = await at({
      'server.js': 'x',
      'default/config.yaml': 'dataRoot: /srv/st\n',
      'public/script.js': 'x',
      'public/index.html': 'x',
    });

    expect(situations(found)).toEqual(['sillytavern-program-folder']);
    // Inventing `data/default-user` here would send somebody to a folder that
    // does not exist, which is worse than the honest shrug.
    expect(found[0]?.suggest).toBeNull();
  });

  it('does not call any folder with a server.js SillyTavern’s', async () => {
    // The rule needs three files together. With only the first it would diagnose
    // every Node project on the machine as SillyTavern's program folder, and
    // tell somebody their library location is set by a config.yaml the folder
    // does not have.
    expect(await at({ 'server.js': 'x', 'package.json': '{}', 'index.js': 'x' })).toEqual([]);
    expect(await at({ 'server.js': 'x', 'public/script.js': 'x' })).toEqual([]);
  });

  it('points back up from a folder inside the library', async () => {
    // The picked folder's own name is a temp string in production and could not
    // carry this verdict; only the parent's marks can. An implementation that
    // matched on the basename would pass every other test and fail here.
    const found = await within({ 'vera.png': 'x', 'ayla.png': 'x' }, stLibrary(''));

    expect(found).toEqual([
      {
        situation: 'sillytavern-above',
        suggest: '..',
        leadsTo: 'sillytavern',
        confidence: 'verified',
        note: { key: 'import.root.sillytavernAbove', params: {}, level: 'warn' },
      },
    ]);
  });
});

describe('a Marinara install, pointed at wrongly', () => {
  it('sends somebody who picked the install root down to packages/server/data', async () => {
    const found = await at({
      ...marinaraStore('packages/server/data'),
      'pnpm-workspace.yaml': '',
      'storage-format.json': '{"storageFormat":4}',
    });

    // The program-folder diagnosis must stay quiet once a data folder is found.
    expect(situations(found)).toEqual(['marinara-install-root']);
  });

  it('finds the data folder beside a picked packages/server', async () => {
    const found = await at({
      ...marinaraStore('data'),
      'package.json': '{"name":"@marinara-engine/server"}',
    });

    expect(situations(found)).toEqual(['marinara-sibling-data']);
    expect(found[0]?.suggest).toBe('data');
  });

  it('finds the data folder from a picked packages', async () => {
    const found = await at({
      ...marinaraStore('server/data'),
      'client/package.json': '{}',
      'shared/package.json': '{}',
    });

    expect(situations(found)).toEqual(['marinara-packages-root']);
  });

  it('offers both data folders and refuses to choose between them', async () => {
    // Marinara's own `.env.example` tells people to check both and not to delete
    // either until they are sure. Picking one here would be inventing an answer
    // its authors declined to give.
    const found = await at({
      ...marinaraStore('packages/server/data'),
      ...marinaraStore('data'),
      'pnpm-workspace.yaml': '',
    });

    expect(situations(found)).toEqual([
      'marinara-install-root',
      'marinara-sibling-data',
      'marinara-two-data-folders',
    ]);
    expect(found[2]?.note.params).toEqual({ first: 'packages/server/data', second: 'data' });
  });

  it('recognises a launcher update backup by the manifest at its own top level', async () => {
    // The launcher's `{createdAt, dataDir}` file and the store's
    // `{version, savedAt, backend}` file are both called `manifest.json`, and
    // position is the only thing that tells them apart: a data root has nothing
    // by that name at its own root. The suggestion still stands — importing from
    // a backup is legitimate — but the person is told which they are looking at.
    const found = await at({
      ...marinaraStore('data'),
      'manifest.json': JSON.stringify({ createdAt: '2026-08-30T00:00:00Z', dataDir: 'C:/x' }),
    });

    expect(situations(found)).toEqual(['marinara-sibling-data', 'marinara-update-backup']);
  });

  it('says a never-launched install has no data folder rather than inventing one', async () => {
    // `storage-format.json` at the install root is a build-time source constant,
    // not storage data. Reading it as storage is the trap this rule turns into a
    // marker, so the test insists no rule claims a data root here.
    const found = await at({
      'pnpm-workspace.yaml': '',
      'storage-format.json': '{"storageFormat":4}',
      'packages/server/package.json': '{}',
    });

    expect(situations(found)).toEqual(['marinara-program-folder']);
    expect(found.every((miss) => miss.suggest === null)).toBe(true);
  });

  it('does not call every pnpm workspace a Marinara install', async () => {
    // `pnpm-workspace.yaml` alone matches this repository, among thousands of
    // others. The pair with `storage-format.json` is what makes it Marinara's,
    // and without this the rule could be reduced to the common half.
    expect(await at({ 'pnpm-workspace.yaml': '', 'packages/server/package.json': '{}' })).toEqual(
      [],
    );
    expect(await at({ 'storage-format.json': '{"storageFormat":4}' })).toEqual([]);
  });

  it('points up out of a picked storage folder', async () => {
    const found = await at({
      'manifest.json': '{"backend":"file-native"}',
      'tables/characters.json': '[]',
    });

    expect(situations(found)).toEqual(['marinara-storage-folder']);
    expect(found[0]).toMatchObject({ suggest: '..', confidence: 'inferred' });
  });

  it('does not read a bare tables folder as a Marinara storage folder', async () => {
    // A storage directory holds `tables/` *and* `manifest.json`. Without the
    // second conjunct, any folder with a directory called `tables` — a database
    // project, a docs tree — would be told to point one level up.
    expect(await at({ 'tables/people.json': '[]', 'README.md': 'x' })).toEqual([]);
  });

  it('points two up out of a picked tables folder', async () => {
    const found = await within(
      { 'characters.json': '[]', 'chats.json': '[]' },
      { 'manifest.json': '{}', 'tables/characters.json': '[]' },
    );

    expect(situations(found)).toEqual(['marinara-tables-folder']);
    expect(found[0]?.suggest).toBe('../..');
  });

  it('prefers the probed answer to the inferred one when both describe the same folder', async () => {
    // Somebody picked `storage/` on a real install, so BOTH rules are eligible:
    // the parent has `storage/tables` and the picked folder has `tables/` beside
    // a `manifest.json`. Both would offer `..`, and only one of them actually
    // looked. Declaration order plus the dedupe is what decides, so this fixture
    // has to make both fire — an earlier version of this test used a picked
    // folder holding one image, where the second rule could not fire at all and
    // the assertion held for the wrong reason.
    const found = await within(
      { 'manifest.json': '{"backend":"file-native"}', 'tables/characters.json': '[]' },
      marinaraStore(''),
    );

    // The whole object, not just the situation: with only the name asserted,
    // this rule could claim `leadsTo: 'sillytavern'` and carry SillyTavern's
    // sentence — telling somebody who picked `avatars/` inside a Marinara data
    // root about lorebooks, presets and personas — and still be labelled
    // `verified`. The round-trip property cannot reach it, because re-rooting a
    // fixture by string prefix has no way to express `..`.
    expect(found).toEqual([
      {
        situation: 'marinara-above',
        suggest: '..',
        leadsTo: 'marinara',
        confidence: 'verified',
        note: { key: 'import.root.marinaraAbove', params: {}, level: 'warn' },
      },
    ]);
  });

  it('offers a folder once even when two rules arrive at it', async () => {
    // The same fixture read the other way round. Without the dedupe this is two
    // findings pointing at one folder, which reads as a bug whichever order they
    // come in.
    const found = await within(
      { 'manifest.json': '{"backend":"file-native"}', 'tables/characters.json': '[]' },
      marinaraStore(''),
    );

    expect(found.filter((miss) => miss.suggest === '..')).toHaveLength(1);
  });

  it('tells somebody with a pre-1.5.7 install that the folder is right and the version is not', async () => {
    // The folder *is* the data folder. Saying "wrong folder" would send them
    // hunting for one that does not exist on that install.
    const found = await at({
      'marinara-engine.db': 'SQLite format 3',
      'marinara-engine.db-wal': '',
      'avatars/vera.png': 'x',
    });

    expect(situations(found)).toEqual(['marinara-too-old']);
    expect(found[0]?.suggest).toBeNull();
  });
});

describe('folders it must stay quiet about', () => {
  it('says nothing about a hand-assembled folder that happens to have characters and worlds', async () => {
    // The exact false positive the marks exist to prevent. No `settings.json`,
    // so nothing fires — and note that the root's own `characters/` is never a
    // marker for any rule, only for the gate that suppresses output.
    expect(
      await at({ 'characters/vera.png': 'x', 'worlds/rain.json': '{}', 'notes.txt': 'x' }),
    ).toEqual([]);
  });

  it('says nothing about a folder that already is a SillyTavern library', async () => {
    expect(await at(stLibrary(''))).toEqual([]);
  });

  it('says nothing about a folder that already is a Marinara data root', async () => {
    expect(
      await at(marinaraStore('', { 'avatars/vera.png': 'x', 'gallery/characters/a.png': 'x' })),
    ).toEqual([]);
  });

  it('says nothing about an empty folder', async () => {
    expect(await at({})).toEqual([]);
  });

  it('stays quiet about a folder that is a source AND would match a rule', async () => {
    // The gate needs a fixture where deleting it changes the answer. Every other
    // quiet-folder case here returns `[]` because no rule fires, so they would
    // all pass with the early return removed. This one is a live Marinara data
    // root that also carries the `data/` leftover — so the rules have something
    // to say, and the gate is the only reason they do not say it. The folder
    // already imports; advising a move would be advice away from the right
    // answer.
    expect(await at({ ...marinaraStore(''), ...marinaraStore('data') })).toEqual([]);
  });
});

describe('the work it is allowed to do', () => {
  it('never lists, never reads, and never asks the same path twice', async () => {
    const asked: string[] = [];
    const counted: FileSource = {
      list: () => {
        throw new Error('near-miss must not list a foreign directory');
      },
      read: () => {
        throw new Error('near-miss must not read a foreign file');
      },
      exists: (path) => {
        asked.push(path);
        return Promise.resolve(
          Object.keys(stLibrary('data/default-user')).some(
            (held) => held === path || held.startsWith(`${path}/`),
          ),
        );
      },
    };

    const found = await nearMiss({ files: counted });

    expect(situations(found)).toEqual(['sillytavern-install-root']);
    expect(new Set(asked).size, 'a path was probed twice').toBe(asked.length);
    expect(asked.length).toBeLessThanOrEqual(NEAR_MISS_PROBE_PATHS.length);
    const stray = asked.filter((path) => !NEAR_MISS_PROBE_PATHS.includes(path));
    expect(stray, 'probed a path the exported list does not declare').toEqual([]);
  });

  it('declares only paths both source adapters agree about', () => {
    // The two divergences this kills are real and opposite: `'storage/tables/'`
    // finds nothing in memory where a real directory answers true, and a leading
    // slash makes memory strip it and find the file while `DirectorySource`
    // resolves outside its root and returns false. A test written with either
    // would pass against the adapter it was written for.
    for (const path of NEAR_MISS_PROBE_PATHS) {
      expect(path, 'empty').not.toBe('');
      expect(path.startsWith('/'), `${path} has a leading slash`).toBe(false);
      expect(path.endsWith('/'), `${path} has a trailing slash`).toBe(false);
      expect(path.includes('\\'), `${path} has a backslash`).toBe(false);
      expect(path.split('/').includes('..'), `${path} climbs out`).toBe(false);
      expect(path.split('/').includes('.'), `${path} has a dot segment`).toBe(false);
    }
    expect(new Set(NEAR_MISS_PROBE_PATHS).size).toBe(NEAR_MISS_PROBE_PATHS.length);
  });
});

describe('a suggestion the classifier would agree with', () => {
  /**
   * The round trip. Every `verified` finding claims that following it produces a
   * root `classifyRoot` calls `leadsTo` — so this re-roots the fixture at what
   * was suggested and asks. `inferred` findings are exempt by construction,
   * which is what that field is for and why it is a field rather than a comment.
   */
  const cases: { name: string; files: Record<string, string> }[] = [
    { name: 'the SillyTavern install root', files: stLibrary('data/default-user') },
    { name: 'a pre-1.12 install', files: stLibrary('public') },
    { name: 'the SillyTavern data folder', files: stLibrary('default-user') },
    { name: 'the Marinara install root', files: marinaraStore('packages/server/data') },
    { name: 'a picked packages/server', files: marinaraStore('data') },
    { name: 'a picked packages', files: marinaraStore('server/data') },
  ];

  for (const { name, files } of cases) {
    it(`lands on a real root from ${name}`, async () => {
      const found = await at(files);
      const verified = found.filter((miss) => miss.confidence === 'verified');
      expect(verified.length).toBeGreaterThan(0);

      for (const miss of verified) {
        const prefix = `${miss.suggest!}/`;
        const rerooted = Object.fromEntries(
          Object.entries(files)
            .filter(([path]) => path.startsWith(prefix))
            .map(([path, value]) => [path.slice(prefix.length), value]),
        );
        expect(await classifyRoot(new MemoryFileSource(rerooted))).toEqual({
          ok: true,
          kind: miss.leadsTo,
        });
      }
    });
  }
});

describe('against a real directory tree', () => {
  /**
   * `MemoryFileSource` cannot hold an empty directory, and SillyTavern creates
   * every template directory on every startup — so a library whose `characters/`
   * and `worlds/` are empty is the ordinary state, and every in-memory case
   * above is blind to it. These run on the filesystem for that reason.
   */
  async function tree(files: string[], directories: string[] = []): Promise<string> {
    const root = await mkdtemp(join(tmpdir(), 'se-near-'));
    for (const directory of directories) {
      await mkdir(join(root, directory), { recursive: true });
    }
    for (const file of files) {
      await mkdir(join(root, file, '..'), { recursive: true });
      await writeFile(join(root, file), '{}');
    }
    return root;
  }

  /** Somewhere our data directory certainly is not, so the carve-out stays out of the way. */
  const elsewhere = join(tmpdir(), 'se-nowhere');

  it('reads a library whose card and lore directories are empty', async () => {
    const root = await tree(
      ['data/default-user/settings.json'],
      ['data/default-user/characters', 'data/default-user/worlds'],
    );
    const opened = await openLocalSource(root, elsewhere);
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;

    expect(situations(await nearMiss({ files: opened.source }))).toEqual([
      'sillytavern-install-root',
    ]);
  });

  it('says nothing about the same tree without its settings file', async () => {
    // The mutation that matters: an implementation probing only the two
    // directories would fire on any folder that happens to contain a
    // `data/default-user/`. The settings file is what makes it SillyTavern's.
    const root = await tree([], ['data/default-user/characters', 'data/default-user/worlds']);
    const opened = await openLocalSource(root, elsewhere);
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;

    expect(await nearMiss({ files: opened.source })).toEqual([]);
  });

  it('needs the second source to see the folder above, and cannot climb without it', async () => {
    const root = await tree(
      ['settings.json', 'characters/vera.png', 'worlds/rain.json'],
      ['characters', 'worlds'],
    );
    const child = await openLocalSource(join(root, 'characters'), elsewhere);
    expect(child.ok).toBe(true);
    if (!child.ok) return;

    // Why the parent has to be opened separately, pinned rather than asserted in
    // a comment: the contract says a source refuses paths that leave its root.
    expect(await child.source.exists('..')).toBe(false);
    expect(await child.source.exists('../settings.json')).toBe(false);

    const parent = await openParentSource(join(root, 'characters'), elsewhere);
    expect(parent).not.toBeNull();

    const found = await nearMiss({ files: child.source, parent: parent ?? undefined });
    expect(situations(found)).toEqual(['sillytavern-above']);
    expect(await suggestedRoot(join(root, 'characters'), '..')).toBe(await realpath(root));
  });

  it('anchors a suggestion on the folder it probed, not on the name it was given', async () => {
    // Found by an adversarial review, and it made `verified` a lie. Both sources
    // are rooted at the *real* path, so the marks behind an ascending finding
    // are read in the link's target directory — while the path handed back was
    // resolved against the unresolved string, landing in whatever folder happens
    // to hold the link. Following it swept an unrelated directory.
    const real = await tree(
      ['SillyTavern/data/default-user/settings.json'],
      ['SillyTavern/data/default-user/characters', 'SillyTavern/data/default-user/worlds'],
    );
    const library = join(real, 'SillyTavern', 'data', 'default-user');
    const decoy = await tree(['private-notes.txt']);

    try {
      await symlink(join(library, 'characters'), join(decoy, 'st-characters'), 'junction');
    } catch {
      // Some environments will not let a test create a link. Nothing to prove.
      return;
    }

    const named = join(decoy, 'st-characters');
    const child = await openLocalSource(named, elsewhere);
    expect(child.ok).toBe(true);
    if (!child.ok) return;

    const parent = await openParentSource(named, elsewhere);
    const found = await nearMiss({ files: child.source, parent: parent ?? undefined });
    expect(situations(found)).toEqual(['sillytavern-above']);
    expect(found[0]?.confidence).toBe('verified');

    // The library it probed, never the folder the link happens to sit in.
    const offered = await suggestedRoot(named, '..');
    expect(offered).toBe(await realpath(library));
    expect(offered).not.toBe(await realpath(decoy));

    // And `verified` means what it says: the classifier agrees about that path.
    const retry = await openLocalSource(offered, elsewhere);
    expect(retry.ok).toBe(true);
    if (!retry.ok) return;
    expect(await classifyRoot(retry.source)).toEqual({ ok: true, kind: 'sillytavern' });
  });

  it('refuses to open a parent inside our own data directory', async () => {
    // Defence in depth, and unreachable through the route today: a parent inside
    // `/data` implies a child inside it, and the child was already refused. It
    // costs one comparison and it is the kind of reasoning that stops being true
    // when somebody changes the caller.
    const data = await mkdtemp(join(tmpdir(), 'se-data-'));
    await mkdir(join(data, 'users'), { recursive: true });

    expect(await openParentSource(join(data, 'users'), data)).toBeNull();
  });
});
