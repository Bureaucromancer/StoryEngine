// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  describeUnusableDataDirectory,
  ensureWritableDirectory,
  fileExists,
  unlinkFile,
} from './files.js';

/**
 * `unlinkFile` versus `removeTree` — the blast radius, asserted.
 *
 * They would be one function if `rm` were the only consideration; they are two
 * because a call site that says *tree* while meaning *file* is one refactor away
 * from meaning what it says. A connection is one file
 * ([P2B §2.3](../../../../docs/design/workplan/10-p2b-provider-configuration.md)); a library
 * object is a folder, and the two deletions must not be spelled the same.
 */

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'se-files-'));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('unlinkFile', () => {
  it('removes a file', async () => {
    const path = join(dir, 'connection.json');
    await writeFile(path, '{}');

    await unlinkFile(path);

    expect(await fileExists(path)).toBe(false);
  });

  it('is not an error for a file that is already gone', async () => {
    // A delete whose file has been removed by hand has achieved what it was
    // asked to, and an admin should not see a failure for getting there first.
    await expect(unlinkFile(join(dir, 'never-existed.json'))).resolves.toBeUndefined();
  });

  it('will not take a directory with it', async () => {
    const nested = join(dir, 'connections');
    await mkdir(nested, { recursive: true });
    await writeFile(join(nested, 'one.json'), '{}');

    // The whole reason this is not `removeTree` under a narrower name: pointed
    // at a directory it refuses, rather than quietly deleting everything under
    // it. `rm` with `recursive` would have taken the lot — and a connection
    // root full of other people's keys is exactly the directory a mistyped
    // delete would reach.
    await expect(unlinkFile(nested)).rejects.toThrow();
    expect(await fileExists(join(nested, 'one.json'))).toBe(true);
  });
});

/**
 * The probe Alpha 1's first install was missing —
 * [P6A §3](../../../../docs/design/workplan/19-p6a-alpha-1.md) step 11 — and
 * the sentence that replaced its stack trace.
 */
describe('ensureWritableDirectory', () => {
  it('creates a directory that is not there, and accepts one it can write', async () => {
    const path = join(dir, 'made', 'here');
    await ensureWritableDirectory(path);
    await expect(ensureWritableDirectory(path)).resolves.toBeUndefined();
    expect(await fileExists(path)).toBe(true);
  });

  it('refuses a path that cannot be made, with the code the filesystem gave', async () => {
    await writeFile(join(dir, 'afile'), 'x');
    // ENOTDIR on every platform this suite runs on, which is what makes it the
    // case the entry point's test can use without pretending to be root.
    await expect(ensureWritableDirectory(join(dir, 'afile', 'data'))).rejects.toMatchObject({
      code: 'ENOTDIR',
    });
  });

  // Windows has no mode bits to take away, and root has nothing taken away from
  // it; CI's ubuntu leg is where this runs.
  it.skipIf(process.platform === 'win32' || process.getuid?.() === 0)(
    'refuses a directory that exists and cannot be written',
    async () => {
      const readOnly = join(dir, 'read-only');
      await mkdir(readOnly);
      await chmod(readOnly, 0o500);
      try {
        // `mkdir -p` alone says nothing here — the directory exists — which is
        // the whole reason the probe asks a second question.
        await expect(ensureWritableDirectory(readOnly)).rejects.toMatchObject({ code: 'EACCES' });
      } finally {
        await chmod(readOnly, 0o700);
      }
    },
  );
});

describe('describeUnusableDataDirectory', () => {
  it('names the user and the chown for a permission error', () => {
    const eacces = Object.assign(new Error('EACCES: permission denied'), {
      code: 'EACCES',
      syscall: 'mkdir',
      path: '/data/state',
    });

    const text = describeUnusableDataDirectory(eacces, '/data', { uid: 1000, gid: 1000 });

    expect(text).toContain('not writable by uid 1000');
    expect(text).toContain('EACCES on mkdir /data/state');
    expect(text).toContain('chown -R 1000:1000');
  });

  it('gives the same advice for EPERM, with a placeholder where it cannot name the user', () => {
    const eperm = Object.assign(new Error('EPERM'), {
      code: 'EPERM',
      syscall: 'access',
      path: '/data',
    });

    const text = describeUnusableDataDirectory(eperm, '/data', { uid: undefined, gid: undefined });

    expect(text).toContain('not writable by this process');
    expect(text).toContain('chown -R <uid>:<gid>');
  });

  it('says a path cannot be created for anything else, and does not mention chown', () => {
    const enotdir = Object.assign(new Error('ENOTDIR'), {
      code: 'ENOTDIR',
      syscall: 'mkdir',
      path: '/x/afile',
    });

    const text = describeUnusableDataDirectory(enotdir, '/x/afile/data', { uid: 1000, gid: 1000 });

    expect(text).toContain('cannot be created or written: ENOTDIR on mkdir /x/afile');
    expect(text).not.toContain('chown');
  });
});
