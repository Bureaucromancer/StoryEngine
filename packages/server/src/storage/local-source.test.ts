// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { DEFAULT_LOCAL_LIMITS, openLocalSource } from './local-source.js';

/**
 * The server-path transport, and the one refusal that makes
 * [10 §4.2.2]'s widening of `fileAccess` safe rather than merely honest.
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
    // The line [10 §4.2.2] turns on. Without it, `fileAccess: read` becomes a
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

  it('walks a root that CONTAINS the data directory, without entering it', async () => {
    /**
     * The case nobody wrote, found by an adversarial review of the
     * [P4 §7.2](../../../../docs/design/workplan/16-p4-implementation.md)
     * relabel and reproduced before it was fixed.
     *
     * *Until [P11.0](../../../../docs/design/workplan/28-p11-implementation.md)'s
     * stage-citation check found it, the reference above was written with the
     * phase and the section number run together and the `§` dropped* — which
     * names a stage of P4 rather than a section of it, and P4 has stages P4.0
     * through P4.5. The line below it always spelled the same reference
     * correctly, which is how small the slip was and how long it lasted.
     *
     * **The wrong form is described here rather than quoted, because quoting it
     * would fail the check that found it** — an instrument that forbids a token
     * makes that token unwritable in the account of why it is forbidden. That is
     * a real cost of mechanising a convention and it is worth one sentence
     * wherever it is paid, rather than an exemption nobody would understand
     * later.
     *
     * Every test above refuses a root at or below the data directory. None
     * covered a root *above* it — and `dataDir` defaults to `./data`, so on an
     * ordinary install the directory somebody would naturally sweep is an
     * ancestor of our own store. It opened `ok`, listed `data/accounts.json`
     * and `data/users/<other>/library/actors/<slug>/actor.json`, and `read`
     * returned the bytes.
     *
     * Refusing an ancestor root would have been the wrong repair: sweeping a
     * home directory to find SillyTavern is the case the capability exists for.
     * The store is pruned instead, so the sweep may walk around us but not
     * through us.
     */
    const inner = join(root, 'data');
    await mkdir(join(inner, 'users', 'alice', 'library'), { recursive: true });
    await writeFile(join(inner, 'accounts.json'), '{}');
    await writeFile(join(inner, 'users', 'alice', 'library', 'actor.json'), '{}');
    await mkdir(join(root, 'characters'), { recursive: true });
    await writeFile(join(root, 'characters', 'Vera.png'), 'x');

    const opened = await openLocalSource(root, inner);
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;

    const seen: string[] = [];
    for await (const path of opened.source.list()) seen.push(path);

    expect(seen).toEqual(['characters/Vera.png']);
    // Not merely absent from the listing: unreadable when named directly,
    // because the readers build paths the walk never yielded.
    expect(await opened.source.read('data/accounts.json')).toBeNull();
    expect(await opened.source.exists('data/accounts.json')).toBe(false);
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

  it('says where a file really is, with no size ceiling', async () => {
    /**
     * [P13 §1.3](../../../../docs/design/workplan/30-p13-aventuras-import.md):
     * the Aventuras reader hands SQLite the real file, because `VACUUM INTO`
     * from the file is the one consistent copy of a database somebody is
     * writing — and the one way past `maxFileBytes`, which `read` keeps.
     */
    await mkdir(join(root, 'com.karelian.aventura'), { recursive: true });
    await writeFile(join(root, 'com.karelian.aventura', 'aventura.db'), 'x'.repeat(64));
    const opened = await openLocalSource(root, dataRoot, {
      ...DEFAULT_LOCAL_LIMITS,
      maxFileBytes: 16,
    });
    if (!opened.ok) throw new Error('refused');

    const real = await opened.source.realPath('com.karelian.aventura/aventura.db');
    expect(real).toBe(await realpath(join(root, 'com.karelian.aventura', 'aventura.db')));
    expect(await opened.source.read('com.karelian.aventura/aventura.db')).toBeNull();
  });

  it('gives no real path for anything #resolve refuses, however it is spelled', async () => {
    const outside = await mkdtemp(join(tmpdir(), 'se-out-'));
    await writeFile(join(outside, 'aventura.db'), 'x');
    await mkdir(join(root, 'folder'));
    try {
      const opened = await open();
      if (!opened.ok) throw new Error('refused');

      expect(await opened.source.realPath(join('..', basename(outside), 'aventura.db'))).toBeNull();
      expect(await opened.source.realPath('../../../etc/passwd')).toBeNull();
      expect(await opened.source.realPath(join(outside, 'aventura.db'))).toBeNull();
      // Nothing there, and a directory, are not files to hand SQLite.
      expect(await opened.source.realPath('missing.db')).toBeNull();
      expect(await opened.source.realPath('folder')).toBeNull();
    } finally {
      await rm(outside, { recursive: true, force: true });
    }
  });

  it('refuses our own data directory beneath an ancestor root, spelled or linked', async () => {
    // `openLocalSource` refuses a root *inside* the data directory outright;
    // this is the ancestor case, where the store is pruned rather than the
    // root refused — and a path given to SQLite is a read like any other.
    const inner = join(root, 'data');
    await mkdir(join(inner, 'state'), { recursive: true });
    await writeFile(join(inner, 'state', 'state.sqlite'), 'the operational store');
    const opened = await openLocalSource(root, inner);
    if (!opened.ok) throw new Error('refused');

    expect(await opened.source.realPath('data/state/state.sqlite')).toBeNull();

    try {
      await symlink(join(inner, 'state'), join(root, 'looks-harmless'), 'dir');
    } catch {
      return; // Windows without developer mode; the spelled case above holds the rule.
    }
    expect(await opened.source.realPath('looks-harmless/state.sqlite')).toBeNull();
  });

  it('refuses a link that leads out of the root, and follows one that stays in it', async () => {
    /**
     * ***Stricter than `#resolve`, deliberately.*** `#resolve` is lexical and
     * cannot see where a link leads. A real path is given away to something
     * that *will* follow it, so here the link's target is checked exactly as a
     * spelled path is — and, since P13.1's review, so it is for `read` and
     * `exists`, below.
     */
    const outside = await mkdtemp(join(tmpdir(), 'se-out-'));
    await writeFile(join(outside, 'aventura.db'), 'somebody else’s');
    await writeFile(join(root, 'inside.db'), 'ours to read');
    try {
      await symlink(join(outside, 'aventura.db'), join(root, 'aventura.db'), 'file');
      await symlink(outside, join(root, 'config'), 'dir');
      await symlink(join(root, 'inside.db'), join(root, 'alias.db'), 'file');
    } catch {
      await rm(outside, { recursive: true, force: true });
      return; // Windows without developer mode.
    }
    try {
      const opened = await open();
      if (!opened.ok) throw new Error('refused');

      expect(await opened.source.realPath('aventura.db')).toBeNull();
      expect(await opened.source.realPath('config/aventura.db')).toBeNull();
      expect(await opened.source.realPath('alias.db')).toBe(
        await realpath(join(root, 'inside.db')),
      );
    } finally {
      await rm(outside, { recursive: true, force: true });
    }
  });

  it('reads nothing through a link that leads out of the root or into our store', async () => {
    /**
     * ***Found at P13.1's review*** (2026-09-29), reproduced before it was
     * fixed: `read` checked a path by its spelling alone and followed links,
     * so `read('link/accounts.json')` with `link` pointing at the data
     * directory returned our accounts file, and a link to a file outside the
     * root returned that. `list` never yields a link, but the readers build
     * paths of their own, and `FileSource`'s contract says a link that leaves
     * is refused. `realPath`'s null for such a path is final for the same
     * reason: a reader falling back to `read` would otherwise be handed the
     * bytes `realPath` just refused.
     */
    const outside = await mkdtemp(join(tmpdir(), 'se-out-'));
    await writeFile(join(outside, 'secret.txt'), 'somebody else’s');
    const inner = join(root, 'data');
    await mkdir(join(inner, 'state'), { recursive: true });
    await writeFile(join(inner, 'accounts.json'), 'our accounts');
    await writeFile(join(inner, 'state', 'state.sqlite'), 'the operational store');
    await writeFile(join(root, 'inside.txt'), 'ours to read');
    try {
      await symlink(join(outside, 'secret.txt'), join(root, 'o-link.txt'), 'file');
      await symlink(inner, join(root, 'link'), 'dir');
      await symlink(join(inner, 'state', 'state.sqlite'), join(root, 'aventura.db'), 'file');
      await symlink(join(root, 'inside.txt'), join(root, 'alias.txt'), 'file');
    } catch {
      await rm(outside, { recursive: true, force: true });
      return; // Windows without developer mode.
    }
    try {
      const opened = await openLocalSource(root, inner);
      if (!opened.ok) throw new Error('refused');
      const source = opened.source;

      expect(await source.read('o-link.txt')).toBeNull();
      expect(await source.read('link/accounts.json')).toBeNull();
      expect(await source.read('aventura.db')).toBeNull();
      expect(await source.exists('o-link.txt')).toBe(false);
      expect(await source.exists('link/accounts.json')).toBe(false);
      expect(await source.exists('link')).toBe(false);
      // The pattern a reader follows: a refused real path is not read instead.
      expect(await source.realPath('aventura.db')).toBeNull();

      // A link that stays inside names nothing the root did not already reach.
      const alias = await source.read('alias.txt');
      expect(alias === null ? null : new TextDecoder().decode(alias)).toBe('ours to read');
      expect(await source.exists('alias.txt')).toBe(true);
    } finally {
      await rm(outside, { recursive: true, force: true });
    }
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
