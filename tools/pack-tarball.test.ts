// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { execFileSync } from 'node:child_process';
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createGunzip } from 'node:zlib';
import { createReadStream } from 'node:fs';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { EXECUTABLE, filesUnder, pack } from './pack-tarball.mjs';

/**
 * ***The half of "reproducible builds" a machine with no Docker can still
 * check*** — [work plan §8](../docs/design/workplan/01-work-plan.md),
 * [P11.9](../docs/design/workplan/28-p11-implementation.md).
 *
 * The stage's proof obligation is ***"`git tag` twice on one commit produces
 * identical artifacts — the reproducibility claim in the only form that
 * distinguishes it from *the build works*"***. For the image that needs a
 * daemon and two runs, and is a gate row. For the **tarball** it needs neither:
 * the packer is the only thing between a tree and the bytes, so packing one
 * tree twice is the same claim with the build removed from it.
 *
 * *That is a smaller claim than the obligation makes and it is the load-bearing
 * part of it.* A build that is not reproducible is almost never non-reproducible
 * in its **compiler**; it is non-reproducible in a timestamp, a directory order,
 * or a `umask` — all three of which live here and all three of which this file
 * asserts away.
 */

let tree: string;
let extras: string;
let out: string;

beforeEach(async () => {
  tree = await mkdtemp(join(tmpdir(), 'se-tree-'));
  extras = await mkdtemp(join(tmpdir(), 'se-extras-'));
  out = await mkdtemp(join(tmpdir(), 'se-pack-'));
});

afterEach(async () => {
  for (const path of [tree, extras, out]) await rm(path, { recursive: true, force: true });
});

/** A tree with the shapes the real one has: nested dirs, a script, a dotfile. */
async function populate(): Promise<void> {
  await mkdir(join(tree, 'dist'), { recursive: true });
  await writeFile(join(tree, 'dist', 'main.js'), 'console.log("hello");\n');
  await mkdir(join(tree, 'node_modules', '@storyengine', 'shared'), { recursive: true });
  await writeFile(
    join(tree, 'node_modules', '@storyengine', 'shared', 'package.json'),
    '{"name":"@storyengine/shared"}',
  );
  await mkdir(join(tree, 'client'), { recursive: true });
  await writeFile(join(tree, 'client', 'index.html'), '<!doctype html>');
  await writeFile(join(tree, 'build-info.json'), '{"version":"1.0.0"}');

  await writeFile(join(extras, 'storyengine.service'), '[Unit]\n');
  // No `chmod` here, and that is the point rather than an omission: the packer
  // decides the mode by name, so the fixture's mode must not be what makes a
  // test pass. The mode test below sets it adversarially instead.
  await writeFile(join(extras, 'install.sh'), '#!/bin/sh\n');
}

/** Member names and modes, read back out of the archive. */
async function membersOf(archive: string): Promise<{ name: string; mode: string }[]> {
  const chunks: Buffer[] = [];
  for await (const chunk of createReadStream(archive).pipe(createGunzip())) {
    chunks.push(chunk as Buffer);
  }
  const tar = Buffer.concat(chunks);

  const found: { name: string; mode: string }[] = [];
  let at = 0;
  while (at + 512 <= tar.length) {
    const header = tar.subarray(at, at + 512);
    if (header.every((byte) => byte === 0)) break;
    const name = header.subarray(0, 100).toString('utf8').replace(/\0.*$/, '');
    const mode = header.subarray(100, 108).toString('ascii').replace(/\0.*$/, '').trim();
    const size = Number.parseInt(
      header.subarray(124, 136).toString('ascii').replace(/\0.*$/, '').trim(),
      8,
    );
    found.push({ name, mode });
    at += 512 + size + ((512 - (size % 512)) % 512);
  }
  return found;
}

describe('the tarball a release cuts', () => {
  it('carries the server, the client and the two files that make it a service', async () => {
    await populate();
    const archive = join(out, 'storyengine.tar.gz');
    await pack(tree, extras, archive);

    const names = (await membersOf(archive)).map((member) => member.name);
    expect(names).toContain('storyengine/dist/main.js');
    expect(names).toContain('storyengine/client/index.html');
    expect(names).toContain('storyengine/node_modules/@storyengine/shared/package.json');
    expect(names).toContain('storyengine/build-info.json');
    // **The two that make it Tier 2 rather than a zip of a build.** [09 §5.4]
    // decides the packaging list on *does it start on boot*, so an archive
    // without a unit is the tier failing its own entrance exam.
    expect(names).toContain('storyengine/storyengine.service');
    expect(names).toContain('storyengine/install.sh');
  });

  /**
   * ***Everything under one prefix***, so an unpack in a home directory does not
   * scatter `dist/`, `client/` and a systemd unit across it. A tarball that
   * needs `mkdir` first is the one people extract in the wrong place once.
   */
  it('puts every member under one directory', async () => {
    await populate();
    const archive = join(out, 'storyengine.tar.gz');
    await pack(tree, extras, archive);

    for (const member of await membersOf(archive)) {
      expect(member.name.startsWith('storyengine/'), member.name).toBe(true);
    }
  });

  /**
   * ***The obligation, with the build taken out of it.*** Two packs of one tree
   * are byte-identical — which is the claim *tag twice, get the same artifact*
   * reduces to once the compiler is out of the way, and it is where the claim
   * actually fails in practice: a timestamp, a directory order, a `umask`.
   */
  it('is byte-identical when packed twice', async () => {
    await populate();
    const first = join(out, 'first.tar.gz');
    const second = join(out, 'second.tar.gz');
    await pack(tree, extras, first);
    await pack(tree, extras, second);

    expect(await readFile(first)).toEqual(await readFile(second));
  });

  /**
   * *And identical across a filesystem that answers `readdir` differently*,
   * which is the one of the three that cannot be seen by packing twice on one
   * machine: both runs would get the same wrong order. Sorting is asserted
   * directly instead.
   */
  it('orders its members rather than trusting the filesystem', async () => {
    await populate();
    const walked = await filesUnder(tree);
    expect(walked).toEqual([...walked].sort());

    const archive = join(out, 'storyengine.tar.gz');
    await pack(tree, extras, archive);
    const names = (await membersOf(archive)).map((member) => member.name);
    expect(names).toEqual([...names].sort());
  });

  /**
   * ***Executable by name, and the filesystem is not asked.*** `install.sh` has
   * to be runnable or the tier's one instruction — `sudo ./install.sh` — does
   * not work; everything else has to be `0644` whatever the packing machine
   * thought.
   *
   * *The fixture lies on purpose, in both directions*: the script is written
   * `0644` and a tree file `0755`. That is what makes this a test of the rule
   * rather than of the fixture. The version of this test that `chmod`ed the
   * script to `0755` and expected `0755` back passed on Linux for an
   * implementation that copied the bit from `stat()` — and failed on every
   * Windows run, because Windows cannot store the bit it was copying. On a
   * POSIX filesystem both lies land and both halves are live; on Windows the
   * `chmod`s are no-ops and the script half still is, which is the half that
   * was broken there.
   */
  it('keeps the install script executable and normalises everything else', async () => {
    await populate();
    await chmod(join(extras, 'install.sh'), 0o644);
    await chmod(join(tree, 'dist', 'main.js'), 0o755);
    const archive = join(out, 'storyengine.tar.gz');
    await pack(tree, extras, archive);

    const members = await membersOf(archive);
    const script = members.find((member) => member.name === 'storyengine/install.sh');
    expect(script?.mode).toBe('0000755');
    for (const member of members.filter((one) => one !== script)) {
      expect(member.mode, member.name).toBe('0000644');
    }
  });

  /**
   * ***The list is the packer's; git is still the authority.*** `EXECUTABLE`
   * exists so the archive is a function of names and bytes, but a hand-kept
   * list drifts — and the drift is silent in exactly one direction, a new
   * script under `deploy/tarball/` that ships `0644`. Git's index records
   * `100755` on every platform whatever `core.fileMode` says, so comparing the
   * two is the check that runs on Windows as well as Linux.
   *
   * `deploy/tarball` is named here because it is what `release.yml` passes as
   * the extras directory; if that argument moves, this path moves with it.
   */
  it('names exactly the files git records as executable in deploy/tarball', () => {
    const root = join(dirname(fileURLToPath(import.meta.url)), '..');
    const executableInGit = execFileSync('git', ['ls-files', '-s', '--', 'deploy/tarball'], {
      cwd: root,
      encoding: 'utf8',
    })
      .split('\n')
      .filter((line) => line.startsWith('100755 '))
      .map((line) => (line.split('\t')[1] ?? '').replace(/^deploy\/tarball\//, ''));

    expect(executableInGit.length, 'git should record install.sh as 100755').toBeGreaterThan(0);
    expect(new Set(executableInGit)).toEqual(EXECUTABLE);
  });

  /**
   * ***A rename cannot quietly undo the fix.*** A name-keyed list has one
   * silent failure — the script is renamed and the list is not — and the
   * packer refuses rather than shipping the new name `0644`.
   */
  it('refuses to pack when a listed executable is missing', async () => {
    await populate();
    await rm(join(extras, 'install.sh'));
    await writeFile(join(extras, 'setup.sh'), '#!/bin/sh\n');

    await expect(pack(tree, extras, join(out, 'storyengine.tar.gz'))).rejects.toThrow(
      /install\.sh should ship executable/,
    );
  });
});
