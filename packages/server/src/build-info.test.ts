// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { compareVersions, parseBuildInfo } from './build-info.js';
import { Layout } from './storage/layout.js';
import { DataStampError, readStamp, stampDataDirectory } from './storage/stamp.js';
import { makeTestServer, setUpAdmin } from './test-server.js';

/**
 * Build identity and the data-directory stamp — [P6A.3],
 * [P6A §1.5 and §1.7](../../../docs/design/workplan/23-p6a-alpha-1.md).
 *
 * **The comparator is the part that can be quietly wrong**, and quietly wrong
 * here means opening a directory a newer build has migrated in place. So it is
 * tested against the precedence rules rather than against the two versions this
 * project has so far — `alpha.10` beating `alpha.2` is the case a naive string
 * compare gets backwards, and it is the case that will actually arise.
 *
 * **Absence is a state, not a failure.** A build nobody identified — every
 * development run — stamps nothing and refuses nothing, because the hazard §1.7
 * describes is one released build against another released build's directory,
 * and `pnpm dev` is in neither role.
 */

const ALPHA_1 = { version: '0.1.0-alpha.1', commit: 'abc123' };
const ALPHA_2 = { version: '0.1.0-alpha.2', commit: 'def456' };

let dataDir: string;
let layout: Layout;

beforeEach(async () => {
  dataDir = await mkdtemp(join(tmpdir(), 'se-stamp-'));
  layout = new Layout(dataDir);
});

afterEach(async () => {
  await rm(dataDir, { recursive: true, force: true });
});

describe('reading a build identity', () => {
  it('takes a version and a commit', () => {
    expect(parseBuildInfo('{"version":"0.1.0-alpha.1","commit":"abc123"}')).toEqual(ALPHA_1);
  });

  it('is null for anything it cannot use', () => {
    // Every failure is the same answer, because the honest report for all of
    // them is *this build was not identified* — and a server that refused to
    // start over a cosmetic file would turn that into an outage.
    expect(parseBuildInfo('not json')).toBeNull();
    expect(parseBuildInfo('[]')).toBeNull();
    expect(parseBuildInfo('{"version":"0.1.0"}')).toBeNull();
    expect(parseBuildInfo('{"version":"","commit":"abc"}')).toBeNull();
    expect(parseBuildInfo('{"version":1,"commit":"abc"}')).toBeNull();
  });
});

describe('version precedence', () => {
  it('orders the release numbers', () => {
    expect(compareVersions('0.2.0', '0.1.9')).toBeGreaterThan(0);
    expect(compareVersions('1.0.0', '0.99.99')).toBeGreaterThan(0);
    expect(compareVersions('0.1.0', '0.1.1')).toBeLessThan(0);
    expect(compareVersions('0.1.0', '0.1.0')).toBe(0);
  });

  it('ranks a release above its own prereleases', () => {
    expect(compareVersions('0.1.0', '0.1.0-alpha.1')).toBeGreaterThan(0);
    expect(compareVersions('0.1.0-alpha.1', '0.1.0')).toBeLessThan(0);
  });

  it('compares numeric identifiers as numbers', () => {
    // The case a string compare gets backwards, and the one that will arise:
    // `'0.1.0-alpha.10' < '0.1.0-alpha.2'` lexically.
    expect(compareVersions('0.1.0-alpha.10', '0.1.0-alpha.2')).toBeGreaterThan(0);
    expect(compareVersions('0.1.0-alpha.2', '0.1.0-alpha.10')).toBeLessThan(0);
  });

  it('ranks alphanumeric identifiers above numeric ones, and shorter below longer', () => {
    expect(compareVersions('0.1.0-alpha', '0.1.0-1')).toBeGreaterThan(0);
    expect(compareVersions('0.1.0-alpha', '0.1.0-alpha.1')).toBeLessThan(0);
    expect(compareVersions('0.1.0-alpha', '0.1.0-beta')).toBeLessThan(0);
  });

  it('puts a hotfix above the build it patches and below the next one', () => {
    // [releases §7.1]: a dot release is a hotfix in every series, so v1.0 beta 1.1
    // sits between beta 1 and beta 2. The stamp ([P6A §1.7]) has to read it the
    // same way, or a hotfix build would refuse the directory its own predecessor
    // wrote — and this is the specification's longer-set-outranks rule, which is
    // the one a hand-written comparator most plausibly gets backwards.
    // Both directions, because the stamp asks it both ways: the hotfix opening
    // its predecessor's directory, and the predecessor refusing the hotfix's.
    expect(compareVersions('1.0.0-beta.1.1', '1.0.0-beta.1')).toBeGreaterThan(0);
    expect(compareVersions('1.0.0-beta.1', '1.0.0-beta.1.1')).toBeLessThan(0);
    expect(compareVersions('1.0.0-beta.1.1', '1.0.0-beta.2')).toBeLessThan(0);
    expect(compareVersions('0.1.0-alpha.1.1', '0.1.0-alpha.1')).toBeGreaterThan(0);
    expect(compareVersions('1.0.0-alpha.2', '1.0.0-beta.1')).toBeLessThan(0);
  });

  it('ignores build metadata, which the specification says carries no precedence', () => {
    expect(compareVersions('0.1.0+build.5', '0.1.0')).toBe(0);
  });

  it('says null rather than guessing', () => {
    // The caller has a safe answer for *I cannot tell* — refuse — which is what
    // makes a hand-written comparator defensible instead of a dependency.
    expect(compareVersions('v0.1.0', '0.1.0')).toBeNull();
    expect(compareVersions('0.1', '0.1.0')).toBeNull();
    expect(compareVersions('nightly', '0.1.0')).toBeNull();
  });
});

describe('the data-directory stamp', () => {
  it('records the build that opened the directory', async () => {
    await stampDataDirectory(layout, ALPHA_1);

    const stamp = await readStamp(layout);
    expect(stamp?.version).toBe('0.1.0-alpha.1');
    expect(stamp?.commit).toBe('abc123');
    expect(Date.parse(stamp?.writtenAt ?? '')).not.toBeNaN();
  });

  it('lets the same build back in, and a newer one', async () => {
    await stampDataDirectory(layout, ALPHA_1);
    await stampDataDirectory(layout, ALPHA_1);
    await stampDataDirectory(layout, ALPHA_2);

    // And moves forward, so the directory records what actually last opened it.
    expect((await readStamp(layout))?.version).toBe('0.1.0-alpha.2');
  });

  /**
   * **The foot-gun this exists to close** — [P6A §1.7]. Not strangers losing
   * data: you, pointing an older build at a volume a newer one has already
   * migrated in place, with no way afterwards to tell which half is which.
   */
  it('refuses a directory a newer build wrote, and says both versions', async () => {
    await stampDataDirectory(layout, ALPHA_2);

    await expect(stampDataDirectory(layout, ALPHA_1)).rejects.toThrow(DataStampError);
    await expect(stampDataDirectory(layout, ALPHA_1)).rejects.toThrow(/0\.1\.0-alpha\.2/);
    // And leaves the newer stamp alone: a refusal that rewrote the stamp would
    // let the second attempt through.
    expect((await readStamp(layout))?.version).toBe('0.1.0-alpha.2');
  });

  it('refuses a stamp it cannot place, rather than carrying on', async () => {
    await mkdir(layout.stateRoot, { recursive: true });
    await writeFile(layout.buildStampFile, JSON.stringify({ version: 'nightly', commit: 'x' }));

    // *Carry on regardless* is the answer that loses data, so an unplaceable
    // version is a refusal — with both strings in the message, because the
    // person reading it knows which of their builds is which.
    await expect(stampDataDirectory(layout, ALPHA_1)).rejects.toThrow(/nightly/);
  });

  it('treats an unreadable stamp as no stamp', async () => {
    await mkdir(layout.stateRoot, { recursive: true });
    await writeFile(layout.buildStampFile, 'truncated {');

    // A torn write says nothing about which build made it, so refusing on it
    // would strand a directory over a fact nobody recorded.
    await stampDataDirectory(layout, ALPHA_1);
    expect((await readStamp(layout))?.version).toBe('0.1.0-alpha.1');
  });

  it('neither stamps nor refuses for a build with no identity', async () => {
    await stampDataDirectory(layout, ALPHA_2);
    const before = await readFile(layout.buildStampFile, 'utf8');

    // Development is not one of the two builds in §1.7's story, and gating it
    // would make `pnpm dev` refuse to start because of whichever image last
    // touched the directory.
    await stampDataDirectory(layout, null);

    expect(await readFile(layout.buildStampFile, 'utf8')).toBe(before);
  });

  it('writes nothing at all when there is no stamp and no identity', async () => {
    await stampDataDirectory(layout, null);
    expect(await readStamp(layout)).toBeNull();
  });
});

/**
 * The wiring, which is the half a unit test of `stampDataDirectory` cannot
 * reach — [P6A §1.7], [P6A §1.5].
 *
 * Two claims and both are about *where in the boot* things happen. The refusal
 * has to land **before anything opens**, or it is not a refusal but a report
 * about a directory this process has already changed; and the identity has to
 * reach the route that reports it, which is a different file from the one that
 * reads it.
 */
describe('a released build against a data directory', () => {
  const ALPHA_1 = { version: '0.1.0-alpha.1', commit: 'abc123' };
  const ALPHA_2 = { version: '0.1.0-alpha.2', commit: 'def456' };

  it('stamps it on the way in, and reports itself on the notices route', async () => {
    const dataDir = await mkdtemp(join(tmpdir(), 'se-build-'));
    const app = await makeTestServer({ dataDir, build: ALPHA_1 });
    try {
      await setUpAdmin(app, 'ned', 'correct horse battery');
      const notices = await app.request({ method: 'GET', url: '/api/admin/notices' });

      expect(notices.body).toHaveProperty('build');
      expect(notices.body.build).toEqual(ALPHA_1);
      expect((await readStamp(new Layout(dataDir)))?.version).toBe('0.1.0-alpha.1');
    } finally {
      await app.dispose().catch(() => undefined);
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  it('says nothing where there is nothing to say', async () => {
    const app = await makeTestServer();
    try {
      await setUpAdmin(app, 'ned', 'correct horse battery');
      const notices = await app.request({ method: 'GET', url: '/api/admin/notices' });

      // `null`, not `0.0.0` or `unknown` — a version string that is not a
      // version is the thing a bug report then quotes back at you.
      expect(notices.body.build).toBeNull();
    } finally {
      await app.dispose().catch(() => undefined);
    }
  });

  it('refuses a newer directory before it has opened anything', async () => {
    const dataDir = await mkdtemp(join(tmpdir(), 'se-build-'));
    try {
      const newer = await makeTestServer({ dataDir, build: ALPHA_2 });
      await newer.dispose();
      // The newer build's index exists; remove it so its absence below means
      // *this* boot created nothing rather than that nothing ever had.
      await rm(new Layout(dataDir).indexRoot, { recursive: true, force: true });

      await expect(makeTestServer({ dataDir, build: ALPHA_1 })).rejects.toThrow(DataStampError);

      // **Before anything opened**: `openIndex` creates and migrates, so a
      // guard placed one line later would refuse a directory it had already
      // changed. The falsifying mutation is moving the call below it.
      expect(existsSync(new Layout(dataDir).indexFile)).toBe(false);
      // And the newer stamp is untouched, so the refusal is repeatable.
      expect((await readStamp(new Layout(dataDir)))?.version).toBe('0.1.0-alpha.2');
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });
});
