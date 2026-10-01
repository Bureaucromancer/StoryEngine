// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { execFileSync } from 'node:child_process';
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  readlink,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { createGunzip } from 'node:zlib';
import { createReadStream, existsSync } from 'node:fs';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { membersUnder, outsideTheTree, pack } from './pack-tarball.mjs';
import { paxRecord } from './tar.mjs';

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
  /**
   * ***The packing filesystem's modes, deliberately wrong both ways.*** The
   * installer carries no executable bit — what a Windows checkout, a
   * `core.fileMode=false` clone or a source zip gives — and an ordinary file
   * carries one. The archive has to come out the same regardless, because the
   * mode is declared by name in `pack-tarball.mjs` rather than read off disk.
   */
  await writeFile(join(extras, 'install.sh'), '#!/bin/sh\n');
  await chmod(join(extras, 'install.sh'), 0o644);
  await chmod(join(tree, 'dist', 'main.js'), 0o755);
}

/** One member as the archive describes it, PAX records already applied. */
interface Member {
  name: string;
  mode: string;
  /** ustar's type flag: `0` a file, `2` a link. */
  type: string;
  /** The header's own `linkname` field, exactly as written. */
  linkname: string;
  /** A target from a PAX record before it, which outranks the header's. */
  linkpath: string | null;
}

/**
 * Members read back out of the archive.
 *
 * ***A PAX header is attached, not listed***, which is what a reader does with
 * one: its records describe the member after it, so a `linkpath` here belongs
 * to that member and the `x` block itself is not a member of anything. Kept
 * beside the header's own field rather than over it, because what that field
 * holds when a record outranks it is part of what is asserted.
 */
async function membersOf(archive: string): Promise<Member[]> {
  const chunks: Buffer[] = [];
  for await (const chunk of createReadStream(archive).pipe(createGunzip())) {
    chunks.push(chunk as Buffer);
  }
  const tar = Buffer.concat(chunks);
  const text = (from: number, length: number): string =>
    tar
      .subarray(from, from + length)
      .toString('utf8')
      .replace(/\0.*$/s, '');

  const found: Member[] = [];
  let pending: string | null = null;
  let at = 0;
  while (at + 512 <= tar.length) {
    const header = tar.subarray(at, at + 512);
    if (header.every((byte) => byte === 0)) break;
    const size = Number.parseInt(text(at + 124, 12).trim(), 8);
    const type = text(at + 156, 1);
    if (type === 'x') {
      pending = /^\d+ linkpath=(.*)\n$/s.exec(text(at + 512, size))?.[1] ?? null;
    } else {
      found.push({
        name: text(at, 100),
        mode: text(at + 100, 8).trim(),
        type,
        linkname: text(at + 157, 100),
        linkpath: pending,
      });
      pending = null;
    }
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
    const walked = await membersUnder(tree);
    expect(walked).toEqual([...walked].sort());

    const archive = join(out, 'storyengine.tar.gz');
    await pack(tree, extras, archive);
    const names = (await membersOf(archive)).map((member) => member.name);
    expect(names).toEqual([...names].sort());
  });

  /**
   * ***Executable or not, and nothing else.*** `install.sh` has to be runnable
   * or the tier's one instruction does not work; everything else has to be
   * `0644` whatever the packing machine's `umask` happened to be, because a
   * mode leaking out of a build is a difference between two artifacts that
   * should be the same.
   */
  it('keeps the install script executable and normalises everything else', async () => {
    await populate();
    const archive = join(out, 'storyengine.tar.gz');
    await pack(tree, extras, archive);

    const members = await membersOf(archive);
    const script = members.find((member) => member.name.endsWith('install.sh'));
    expect(script?.mode).toBe('0000755');
    for (const member of members.filter((one) => !one.name.endsWith('install.sh'))) {
      expect(member.mode, member.name).toBe('0000644');
    }
  });
});

/**
 * ***The links a pnpm tree is made of*** — 2026-10-01.
 *
 * `pnpm deploy` puts every package in `node_modules/.pnpm/<name>@<version>/…` and
 * makes the name a server imports a **link** into it, so the tree a release
 * packs is the store plus a layer of links, and the layer is the part anything
 * resolves through. The packer took regular files only: its archive held the
 * store, dropped all 237 links in front of it, and the unpacked server died on
 * its first `import` with `ERR_MODULE_NOT_FOUND`. None of the tests above could
 * see it, because none of their fixtures had a link in them — which is the
 * shape this block exists to give them.
 *
 * *Not on Windows*, where making a link needs a privilege the CI user need not
 * have. The archive is a Linux one and `release.yml` packs it on Linux; the
 * name-only checks at the end run everywhere.
 */
describe.skipIf(process.platform === 'win32')('the links in a deployed tree', () => {
  /** pnpm's own long target, 107 bytes — past ustar's 100, as real ones are. */
  const LONG =
    '../.pnpm/@storyengine+mode-assistant@file+packages+modes+assistant/node_modules/@storyengine/mode-assistant';
  /** And a short one, which fits the header as it is. */
  const SHORT = '.pnpm/fastify@5.6.1/node_modules/fastify';

  /** A store with two packages in it, and the two links pnpm makes to them. */
  async function linked(): Promise<void> {
    await populate();
    for (const [link, target] of [
      ['node_modules/@storyengine/mode-assistant', LONG],
      ['node_modules/fastify', SHORT],
    ] as const) {
      const store = join(tree, dirname(link), target);
      await mkdir(store, { recursive: true });
      await writeFile(join(store, 'package.json'), `{"name":"${basename(link)}"}`);
      await mkdir(join(tree, dirname(link)), { recursive: true });
      await symlink(target, join(tree, link));
    }
  }

  it('packs each link as a link, and an unpacked tree resolves through it', async () => {
    await linked();
    const archive = join(out, 'storyengine.tar.gz');
    await pack(tree, extras, archive);

    // **Unpacked by the system's tar, not by this file's reader**, because the
    // claim is about the archive somebody downloads and the tar they have. A
    // reader written beside the writer can share its misunderstanding.
    const unpacked = await mkdtemp(join(tmpdir(), 'se-unpacked-'));
    try {
      execFileSync('tar', ['-xzf', archive, '-C', unpacked]);
      const root = join(unpacked, 'storyengine', 'node_modules');

      expect(await readlink(join(root, '@storyengine', 'mode-assistant'))).toBe(LONG);
      expect(await readlink(join(root, 'fastify'))).toBe(SHORT);
      const through = await readFile(
        join(root, '@storyengine', 'mode-assistant', 'package.json'),
        'utf8',
      );
      expect(JSON.parse(through)).toEqual({ name: 'mode-assistant' });
    } finally {
      await rm(unpacked, { recursive: true, force: true });
    }
  });

  /**
   * ***A target past 100 bytes travels in a PAX record***, because ustar gives a
   * link's target no prefix field — and the header's own field is left empty
   * rather than cut, so a reader that does not know PAX fails where it reads the
   * link instead of following it somewhere plausible and wrong.
   */
  it('carries a long target in a PAX record and a short one in the header', async () => {
    await linked();
    const archive = join(out, 'storyengine.tar.gz');
    await pack(tree, extras, archive);

    const links = (await membersOf(archive)).filter((member) => member.type === '2');
    expect(links).toEqual([
      {
        name: 'storyengine/node_modules/@storyengine/mode-assistant',
        mode: '0000777',
        type: '2',
        linkname: '',
        linkpath: LONG,
      },
      {
        name: 'storyengine/node_modules/fastify',
        mode: '0000777',
        type: '2',
        linkname: SHORT,
        linkpath: null,
      },
    ]);
  });

  it('is byte-identical when packed twice, links and all', async () => {
    await linked();
    const first = join(out, 'first.tar.gz');
    const second = join(out, 'second.tar.gz');
    await pack(tree, extras, first);
    await pack(tree, extras, second);

    expect(await readFile(first)).toEqual(await readFile(second));
  });

  /**
   * ***A link out of the tree is refused, and nothing is written.*** It names a
   * place on the packing machine; unpacked anywhere else it points at nothing,
   * or at something nobody shipped. The third case is the subtle one: it climbs
   * out and comes back by the tree's own name, which resolves *here* and not
   * after an unpack, where the root is `storyengine/`.
   */
  it.each([
    ['an absolute target', () => '/etc'],
    ['a target that climbs out', () => '../../elsewhere'],
    ['a target that climbs out and back by name', () => `../../${basename(tree)}/dist`],
  ])('refuses %s, and leaves no archive behind', async (_why, target) => {
    await populate();
    await mkdir(join(tree, 'node_modules'), { recursive: true });
    await symlink(target(), join(tree, 'node_modules', 'away'));
    const archive = join(out, 'storyengine.tar.gz');

    await expect(pack(tree, extras, archive)).rejects.toThrow(
      /node_modules\/away is a link to .*, which is outside the tree being packed/,
    );
    expect(existsSync(archive)).toBe(false);
  });
});

/** The two rules the links rest on, as text — which needs no link to check. */
describe('what a link may point at, and how a PAX record counts', () => {
  it.each([
    ['node_modules/fastify', '.pnpm/fastify@5/node_modules/fastify', false],
    ['node_modules/@a/b', '../.pnpm/b@1/node_modules/@a/b', false],
    ['a/b', 'c/../../d', false],
    ['x', '.', false],
    ['x', '..', true],
    ['node_modules/x', '../../x', true],
    ['node_modules/x', '../../app/dist', true],
    ['x', '/etc', true],
    ['x', 'C:\\Windows', true],
    ['x', '\\\\server\\share', true],
  ])('%s → %s leaves the tree: %s', (name, target, leaves) => {
    expect(outsideTheTree(name, target)).toBe(leaves);
  });

  /**
   * ***The length counts its own digits***, so the record that would be 100
   * bytes by a naive count is 101 — the boundary every hand-written PAX writer
   * gets wrong once. Swept across both digit boundaries rather than tried at one.
   */
  it('gives every record the length it actually has', () => {
    for (let size = 0; size <= 1100; size += 1) {
      const record = paxRecord('linkpath', 'x'.repeat(size));
      const [declared] = record.toString('utf8').split(' ', 1);
      expect(Number(declared), `a ${String(size)}-byte value`).toBe(record.length);
    }
  });
});
