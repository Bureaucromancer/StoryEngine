// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { mkdir, mkdtemp, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { buildServices, disposeServices } from '../app.js';
import { DEFAULT_CONFIG } from '../config.js';
import { makeTestServer } from '../test-server.js';
import { openImportScratch, sweepImportScratch } from './import-scratch.js';
import { Layout } from './layout.js';
import { PathEscapeError } from './paths.js';

/**
 * ***Scratch for an import, and what happens to it after a crash*** —
 * [P13 §1.3](../../../../docs/design/workplan/30-p13-aventuras-import.md):
 * *"removed at boot for anything a crash left, and unlinked by the reader's
 * `close()`."* The second half is `sqlite-snapshot.test.ts`'s; this file holds
 * the space itself and the first half.
 */

let root: string;
let layout: Layout;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'se-scratch-'));
  layout = new Layout(root);
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

async function entries(): Promise<string[]> {
  try {
    return await readdir(layout.importScratchRoot);
  } catch {
    return [];
  }
}

/** What a killed import leaves: a space with a copy in it, and its log. */
async function leaveACrashBehind(): Promise<void> {
  const left = join(layout.importScratchRoot, '0199aaaa-0000-7000-8000-000000000000');
  await mkdir(left, { recursive: true });
  await writeFile(join(left, 'vacuum.sqlite'), 'a copy of somebody’s whole install');
  await writeFile(join(left, 'vacuum.sqlite-journal'), 'and what SQLite made beside it');
  // A name the resolver would refuse on Windows, which must not stop the sweep.
  await writeFile(join(layout.importScratchRoot, 'stray.'), 'whatever else a crash left');
}

describe('a scratch space', () => {
  it('is a directory of its own under state/import-scratch', async () => {
    const one = await openImportScratch(layout);
    const two = await openImportScratch(layout);

    expect(dirname(one.directory)).toBe(layout.importScratchRoot);
    expect(one.directory).not.toBe(two.directory);
    expect((await stat(one.directory)).isDirectory()).toBe(true);
    expect(one.path('aventura.db')).toBe(join(one.directory, 'aventura.db'));
  });

  it('will not name a path outside itself', async () => {
    const space = await openImportScratch(layout);
    expect(() => space.path('../escaped.db')).toThrow(PathEscapeError);
    expect(() => space.path('/etc/passwd')).toThrow(PathEscapeError);
  });

  it('is removed whole, whatever was made in it, and removing it twice is fine', async () => {
    const space = await openImportScratch(layout);
    await writeFile(space.path('copy.sqlite'), 'a copy');
    await writeFile(space.path('copy.sqlite-shm'), 'a name nobody here chose');

    await space.dispose();
    await space.dispose();

    expect(await entries()).toEqual([]);
  });
});

describe('the sweep at start', () => {
  it('removes everything in the scratch root, and says how much', async () => {
    await leaveACrashBehind();

    expect(await sweepImportScratch(layout)).toBe(2);
    expect(await entries()).toEqual([]);
  });

  it('is nothing to do on a data directory that has never imported', async () => {
    expect(await sweepImportScratch(layout)).toBe(0);
  });

  it('runs when the server starts', async () => {
    /**
     * The stage's own words — *removed at boot* — tested at the boot rather
     * than at the function, so a sweep that exists and is never called fails
     * here. `makeTestServer` runs `buildApp`, which is where it is called.
     */
    const dataDir = await mkdtemp(join(tmpdir(), 'se-scratch-boot-'));
    const boot = new Layout(dataDir);
    const left = join(boot.importScratchRoot, '0199aaaa-0000-7000-8000-000000000000');
    await mkdir(left, { recursive: true });
    await writeFile(join(left, 'copy.sqlite'), 'a copy a killed import never removed');

    const server = await makeTestServer({ dataDir });
    try {
      expect(await readdir(boot.importScratchRoot)).toEqual([]);
    } finally {
      await server.dispose();
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  it('does not run when only the services are built, as a CLI action builds them', async () => {
    /**
     * The other half of `app.ts`'s *here rather than in `buildServices`*, and
     * the half the boot test above cannot hold: `makeTestServer` runs both, so
     * a sweep moved into `buildServices` would pass it. A CLI action builds
     * the services beside a server that may be mid-import, and a sweep there
     * would remove that import's database from under it — so a leftover must
     * survive `buildServices`, which is what this asserts.
     */
    const dataDir = await mkdtemp(join(tmpdir(), 'se-scratch-cli-'));
    const cli = new Layout(dataDir);
    const live = join(cli.importScratchRoot, '0199bbbb-0000-7000-8000-000000000000');
    await mkdir(live, { recursive: true });
    await writeFile(join(live, 'copy.sqlite'), 'a live import’s copy');

    const services = await buildServices({ config: { ...DEFAULT_CONFIG, dataDir }, watch: false });
    try {
      expect(await readdir(cli.importScratchRoot)).toEqual([basename(live)]);
      expect(await readdir(live)).toEqual(['copy.sqlite']);
    } finally {
      await disposeServices(services);
      await rm(dataDir, { recursive: true, force: true });
    }
  });
});
