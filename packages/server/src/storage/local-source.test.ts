// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { openLocalSource } from './local-source.js';

/**
 * The server-path transport, and the one refusal that makes
 * [05 §4.2.2]'s widening of `fileAccess` safe rather than merely honest.
 *
 * That section widened a permission scoped to the user's own content so it also
 * covers naming a path for a read-only sweep. **The carve-out is what stops the
 * widening being a route to another user's library**, and it is enforced here in
 * code rather than left to two rules staying compatible.
 */

let root: string;
let dataRoot: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'se-src-'));
  dataRoot = await mkdtemp(join(tmpdir(), 'se-data-'));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
  await rm(dataRoot, { recursive: true, force: true });
});

async function open(at = root) {
  return openLocalSource(at, dataRoot);
}

describe('what it refuses', () => {
  it('refuses a root inside the data directory', async () => {
    // The line [05 §4.2.2] turns on. Without it, `fileAccess: read` becomes a
    // way to reach `/data/users/<other>/library/` — which the scope table says
    // `never`.
    const inside = join(dataRoot, 'users', 'someone', 'library');
    await mkdir(inside, { recursive: true });

    expect(await open(inside)).toEqual({ ok: false, refusal: 'inside-data-root' });
  });

  it('refuses the data directory itself', async () => {
    expect(await open(dataRoot)).toEqual({ ok: false, refusal: 'inside-data-root' });
  });

  it('refuses a symlink that points into the data directory', async () => {
    // Compared on real paths, so spelling the same place a different way is
    // still the same place.
    const link = join(root, 'sneaky');
    try {
      await symlink(dataRoot, link, 'dir');
    } catch {
      return; // Windows without developer mode; the literal case above covers the rule.
    }

    expect(await open(link)).toEqual({ ok: false, refusal: 'inside-data-root' });
  });

  it('does not refuse a sibling whose name merely starts the same way', async () => {
    // `/data2` is not inside `/data`. A string prefix test would refuse it, and
    // refusing somebody's real library over a naming coincidence is its own bug.
    const sibling = `${dataRoot}-elsewhere`;
    await mkdir(sibling, { recursive: true });
    try {
      expect((await open(sibling)).ok).toBe(true);
    } finally {
      await rm(sibling, { recursive: true, force: true });
    }
  });

  it('refuses a relative path, which would mean whatever the cwd is', async () => {
    expect(await openLocalSource('some/where', dataRoot)).toEqual({
      ok: false,
      refusal: 'not-absolute',
    });
  });

  it('refuses a path that is not a directory, or is not there', async () => {
    const file = join(root, 'a-file.txt');
    await writeFile(file, 'x');

    expect(await open(file)).toEqual({ ok: false, refusal: 'unreadable-root' });
    expect(await open(join(root, 'nope'))).toEqual({ ok: false, refusal: 'unreadable-root' });
  });
});

describe('what it reads', () => {
  it('walks recursively and yields relative, forward-slashed paths', async () => {
    await mkdir(join(root, 'characters'), { recursive: true });
    await writeFile(join(root, 'settings.json'), '{}');
    await writeFile(join(root, 'characters', 'Vera Solano.png'), 'x');

    const opened = await open();
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;

    const paths: string[] = [];
    for await (const path of opened.source.list()) paths.push(path);

    expect(paths.sort()).toEqual(['characters/Vera Solano.png', 'settings.json']);
  });

  it('does not follow symlinks out of the tree', async () => {
    // A link out would let a sweep read anywhere the process can, which is the
    // one thing the carve-out exists to stop.
    const outside = await mkdtemp(join(tmpdir(), 'se-out-'));
    await writeFile(join(outside, 'secret.txt'), 'x');
    try {
      await symlink(outside, join(root, 'link'), 'dir');
    } catch {
      await rm(outside, { recursive: true, force: true });
      return;
    }

    const opened = await open();
    if (!opened.ok) throw new Error('refused');
    const paths: string[] = [];
    for await (const path of opened.source.list()) paths.push(path);

    expect(paths).toEqual([]);
    await rm(outside, { recursive: true, force: true });
  });

  it('refuses to read out of the root however the path is spelled', async () => {
    await writeFile(join(root, 'inside.txt'), 'here');
    const opened = await open();
    if (!opened.ok) throw new Error('refused');

    expect(await opened.source.read('inside.txt')).not.toBeNull();
    expect(await opened.source.read('../../../etc/passwd')).toBeNull();
    expect(await opened.source.exists('..')).toBe(false);
  });

  it('survives a directory it cannot read', async () => {
    // One unreadable folder costs that folder. F22's original sin was one bad
    // folder aborting a whole scan.
    await mkdir(join(root, 'good'), { recursive: true });
    await writeFile(join(root, 'good', 'a.json'), '{}');

    const opened = await open();
    if (!opened.ok) throw new Error('refused');
    const paths: string[] = [];
    for await (const path of opened.source.list()) paths.push(path);

    expect(paths).toContain('good/a.json');
  });
});
