// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { fileExists, unlinkFile } from './files.js';

/**
 * `unlinkFile` versus `removeTree` — the blast radius, asserted.
 *
 * They would be one function if `rm` were the only consideration; they are two
 * because a call site that says *tree* while meaning *file* is one refactor away
 * from meaning what it says. A connection is one file
 * ([P2B §2.3](../../../../docs/design/workplan/14-p2b-provider-configuration.md)); a library
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
