// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  appendLine,
  describeUnusableDataDirectory,
  ensureWritableDirectory,
  fileExists,
  unlinkFile,
} from './files.js';
import { listVersions, snapshotReplaced } from './history.js';

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

/**
 * ***A torn last line costs itself and nothing more*** (2026-09-27). A crash
 * or a full disk mid-append leaves a line with no newline, and the next append
 * used to land on the end of it: two records in one line that parses as
 * neither. `appendLine` now closes such a line off first.
 */
describe('appendLine', () => {
  it('starts a new line after one a crash left unterminated', async () => {
    const path = join(dir, 'segment.jsonl');
    await writeFile(path, '{"id":"a"}\n{"id":"b","out');

    await appendLine(path, '{"id":"c"}\n');

    expect(await readFile(path, 'utf8')).toBe('{"id":"a"}\n{"id":"b","out\n{"id":"c"}\n');
  });

  it('adds nothing to a file that ends as it should, or is empty, or is not there', async () => {
    const whole = join(dir, 'whole.jsonl');
    await writeFile(whole, '{"id":"a"}\n');
    await appendLine(whole, '{"id":"b"}\n');
    expect(await readFile(whole, 'utf8')).toBe('{"id":"a"}\n{"id":"b"}\n');

    const empty = join(dir, 'empty.jsonl');
    await writeFile(empty, '');
    await appendLine(empty, '{"id":"a"}\n');
    expect(await readFile(empty, 'utf8')).toBe('{"id":"a"}\n');

    const absent = join(dir, 'nested', 'absent.jsonl');
    await appendLine(absent, '{"id":"a"}\n');
    expect(await readFile(absent, 'utf8')).toBe('{"id":"a"}\n');
  });

  /**
   * History's index is the other append-only file, and it appended with
   * `appendFile` directly: the version recorded after a torn line vanished
   * from the list with the one it was cut short by.
   */
  it('keeps the version recorded after a torn history line', async () => {
    const objectRoot = join(dir, 'actors', 'vera');
    await snapshotReplaced({
      objectRoot,
      payload: { schema: 'storyengine.actor/1', state: 'one' },
      source: { kind: 'manual' },
      reason: 'one',
      keepPerObject: 10,
    });
    const index = join(objectRoot, 'history', 'index.jsonl');
    await writeFile(index, `${await readFile(index, 'utf8')}{"id":"torn","dig`);

    await snapshotReplaced({
      objectRoot,
      payload: { schema: 'storyengine.actor/1', state: 'two' },
      source: { kind: 'manual' },
      reason: 'two',
      keepPerObject: 10,
    });

    expect((await listVersions(objectRoot)).map((version) => version.reason)).toEqual([
      'one',
      'two',
    ]);
  });
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
