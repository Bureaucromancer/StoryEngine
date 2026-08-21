// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { spawn, spawnSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

import { Layout } from '../storage/layout.js';

/**
 * **The crash itself, in a process that is allowed to die** — F26.
 *
 * libuv's Windows directory watcher expands the name `ReadDirectoryChangesW`
 * reports and asserts it still starts with the string it was handed
 * (`src\win\fs-event.c:72`). Hand it an 8.3 alias and the assert fires as a
 * native `abort()`: no JS frame, nothing to catch, and the process is gone.
 *
 * **So this cannot be an ordinary test.** One that triggered the abort in-process
 * would kill its own vitest worker, and the run would report *"Worker exited
 * unexpectedly"* against no named test — which is exactly what CI showed, five
 * times, on the first Windows run that ever covered this code.
 *
 * The parent asserts the child's **exit code and its word**, never the specific
 * Windows abort status: 3221226505 is an implementation detail and a test that
 * pinned it would fail for the right reason in the wrong way.
 *
 * Windows only, and there is no honest way around that — 8.3 aliases do not
 * exist elsewhere. `layout.test.ts` and `watcher.test.ts` carry the legs that
 * protect the Linux job.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const CHILD = join(HERE, 'test-alias-child.ts');

let outer: string | null = null;

afterEach(async () => {
  if (outer !== null) await rm(outer, { recursive: true, force: true });
  outer = null;
});

describe('a data root given as an 8.3 alias', () => {
  it.runIf(process.platform === 'win32')(
    'does not take the process down with it',
    async () => {
      outer = new Layout(await mkdtemp(join(tmpdir(), 'se-alias-'))).dataRoot;
      const alias = shortNameOf(outer);
      if (alias === null) return; // 8.3 generation is per-volume and can be off.
      expect(alias).toContain('~');

      const result = await run(alias);

      expect(result.code, `child said: ${result.output}`).toBe(0);
      expect(result.output).toContain('INDEXED');
    },
    30_000,
  );
});

function run(root: string): Promise<{ code: number | null; output: string }> {
  return new Promise((settle) => {
    const child = spawn(process.execPath, ['--import', 'tsx', CHILD, root], {
      stdio: ['ignore', 'pipe', 'pipe'],
      // `tsx` resolves from the package, not from wherever vitest was started —
      // the same reason `main.test.ts` sets one.
      cwd: HERE,
    });
    let output = '';
    child.stdout.on('data', (chunk: Buffer) => (output += chunk.toString()));
    child.stderr.on('data', (chunk: Buffer) => (output += chunk.toString()));
    child.on('close', (code) => {
      settle({ code, output });
    });
  });
}

/**
 * The 8.3 alias of a directory, or null when the volume does not generate them.
 *
 * `windowsVerbatimArguments` is load-bearing: without it Node re-quotes the
 * `for` expression and `cmd` echoes the long path straight back, so the probe
 * reports no alias and this test quietly skips itself.
 */
function shortNameOf(directory: string): string | null {
  const probe = spawnSync('cmd', ['/d', '/s', '/c', `for %I in ("${directory}") do @echo %~sI`], {
    encoding: 'utf8',
    windowsVerbatimArguments: true,
  });
  const out = probe.stdout.trim();

  return out.length > 0 && out !== directory ? out : null;
}
