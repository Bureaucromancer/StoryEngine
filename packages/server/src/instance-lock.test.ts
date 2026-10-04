// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { execFileSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { holdInstanceLock, InstanceLockHeld } from './instance-lock.js';
import { Layout } from './storage/layout.js';

/**
 * ***One server per data directory*** (2026-09-27) — `instance-lock.ts`.
 *
 * The lock is the kernel's, so what matters is what another process sees:
 * refused while a holder is alive, and free the moment it is gone, however it
 * went. `main.test.ts` holds the whole start; `archive.test.ts` holds the one
 * walk that could have let it go.
 */

let dataDir: string;
let layout: Layout;

beforeEach(async () => {
  dataDir = await mkdtemp(join(tmpdir(), 'se-instance-lock-'));
  layout = new Layout(dataDir);
});

afterEach(async () => {
  await rm(dataDir, { recursive: true, force: true });
});

/** A process that takes the lock and exits without letting it go. */
function aProcessThatHeldItAndDied(path: string): void {
  const script = [
    "const { DatabaseSync } = require('node:sqlite');",
    'const db = new DatabaseSync(process.argv[1]);',
    "db.exec('pragma locking_mode = exclusive'); db.exec('begin exclusive');",
    'process.exit(0);',
  ].join('\n');
  execFileSync(process.execPath, ['-e', script, path], { stdio: 'ignore' });
}

describe('the data directory lock', () => {
  it('refuses a second holder, and names the directory', () => {
    const first = holdInstanceLock(layout);
    try {
      let refusal: unknown;
      try {
        holdInstanceLock(layout).release();
      } catch (error) {
        refusal = error;
      }
      expect(refusal).toBeInstanceOf(InstanceLockHeld);
      // **The layout's spelling of the directory, not `mkdtemp`'s** (2026-10-01).
      // The layout resolves its root (F26), and on a Windows runner `tmpdir()`
      // is the 8.3 short name — `C:\Users\RUNNER~1\…` — which resolves to the
      // long one. The same directory, two strings: this compared the other one
      // and was red there from the day it was written.
      expect((refusal as Error).message).toContain(layout.dataRoot);
    } finally {
      first.release();
    }
  });

  it('can be taken again once it is let go', () => {
    holdInstanceLock(layout).release();
    expect(() => {
      holdInstanceLock(layout).release();
    }).not.toThrow();
  });

  it('is free once the process that held it has gone, with nothing to clean up', () => {
    // The pid-file problem this does not have: a crash leaves no stale lock.
    aProcessThatHeldItAndDied(layout.instanceLockFile);
    expect(() => {
      holdInstanceLock(layout).release();
    }).not.toThrow();
  });
});
