// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { spawn } from 'node:child_process';
import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/**
 * **The seed is idempotent, and that is the property worth the cost of a real
 * server** — F35.
 *
 * The library derives a slug from the name and suffixes duplicates, so a script
 * that posted blindly would build `rain-city-2` on its second run and a slightly
 * different install every time after. *Different each run* is not a fixture, and
 * a manual phase that starts from one cannot compare two sessions.
 *
 * There is no cheaper honest version of this. The whole of the script is the
 * HTTP calls it makes, so a test with the server mocked would assert the shape
 * of the mock — and the thing that breaks is the server disagreeing with the
 * script about a required field, which is exactly what a mock would paper over.
 * That happened four times while it was being written.
 */

const run = promisify(execFile);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SEED = join(ROOT, 'tools', 'seed.mjs');
const ENTRY = join(ROOT, 'packages', 'server', 'src', 'main.ts');

/** A port nothing else in the suite uses, so a parallel run does not collide. */
const PORT = 8177;

let dataDir: string;
let server: ReturnType<typeof spawn> | null = null;

beforeAll(async () => {
  dataDir = await mkdtemp(join(tmpdir(), 'se-seed-'));
  await writeFile(join(dataDir, 'config.json'), JSON.stringify({ server: { port: PORT } }));

  server = spawn(process.execPath, ['--import', 'tsx', ENTRY, '--data', dataDir], {
    cwd: join(ROOT, 'packages', 'server'),
    stdio: 'ignore',
  });

  // Wait for it to answer rather than for a clock: a fixed sleep is either slow
  // or flaky, and on a loaded machine it is both.
  const deadline = Date.now() + 30_000;
  for (;;) {
    try {
      const probe = await fetch(`http://127.0.0.1:${String(PORT)}/api/auth/state`);
      if (probe.ok) break;
    } catch {
      // Not listening yet.
    }
    if (Date.now() > deadline) throw new Error('the server never started');
    await new Promise((tick) => setTimeout(tick, 200));
  }
}, 60_000);

afterAll(async () => {
  /**
   * **Waited for, not merely signalled** — the lesson `reset-data.mjs` exists
   * to enforce, arriving here on its own. Removing a data directory while the
   * server still holds it fails on the SQLite files and succeeds on everything
   * else, so this leaked a half-directory per run and reported `EBUSY` while
   * the test itself passed.
   */
  if (server !== null) {
    const exited = new Promise((settle) => server?.once('exit', settle));
    server.kill();
    await exited;
  }
  await rm(dataDir, { recursive: true, force: true });
}, 20_000);

async function seed(): Promise<{ code: number; out: string }> {
  try {
    const { stdout } = await run(process.execPath, [
      SEED,
      '--url',
      `http://127.0.0.1:${String(PORT)}`,
    ]);
    return { code: 0, out: stdout };
  } catch (error) {
    const failure = error as { code?: number; stdout?: string; stderr?: string };
    return { code: failure.code ?? 1, out: `${failure.stdout ?? ''}${failure.stderr ?? ''}` };
  }
}

describe('seeding an install', () => {
  it('fills an empty one and then changes nothing', async () => {
    const first = await seed();

    expect(first.code, first.out).toBe(0);
    expect(first.out).toContain('Created the first admin');
    expect(first.out).toContain('lorebooks/rain-city — created');
    expect(first.out).toContain('with Mara in the cast');

    const second = await seed();

    expect(second.code, second.out).toBe(0);
    // Every line says *already there* — not merely that it exited 0, which a
    // script quietly creating three more objects would also do.
    expect(second.out).toContain('lorebooks/rain-city — already there');
    expect(second.out).toContain('actors/mara-vance — already there');
    expect(second.out).toContain('treatments/a-wet-week — already there');
    expect(second.out).toContain('A wet week — already there');
    expect(second.out).not.toContain('created');
  }, 60_000);
});
