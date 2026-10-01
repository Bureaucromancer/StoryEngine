// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, open, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';

/**
 * **The teardown removes everything or nothing** — F31.
 *
 * `rm -rf` on a live data directory half-succeeds, and the half that survives is
 * the wrong half: both SQLite stores stay — including `state/`, which
 * [21 §5.1](../../docs/design/21-internal-contracts.md) calls authoritative and not
 * disposable — while `state/session.key`, a plain file beside it, goes. The
 * store outlives the key that validates the sessions in it, `config.json`
 * vanishes so the next start silently reverts to defaults, and a tester who
 * believes they started from nothing did not.
 *
 * These drive the real script as a subprocess, because *what it does to a
 * directory* is the whole of it and a unit test over a helper would assert the
 * shape of the mock.
 */

const run = promisify(execFile);
const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), '..', 'reset-data.mjs');

let held: Awaited<ReturnType<typeof open>> | null = null;
let made: string[] = [];

afterEach(async () => {
  /**
   * **The handle first, then the directories** — including the one the
   * held-file test deliberately makes unremovable. This teardown used to close
   * the handle and stop, so the suite that exists to prove teardowns complete
   * leaked one `mkdtemp` directory per run, forever. The order matters: while
   * the handle is open, the `rm` here would half-succeed in exactly the way
   * `reset-data.mjs` was written to make impossible.
   */
  await held?.close();
  held = null;
  for (const at of made) await rm(at, { recursive: true, force: true });
  made = [];
});

async function dataDir(): Promise<string> {
  const at = await mkdtemp(join(tmpdir(), 'se-reset-'));
  made.push(at);
  await mkdir(join(at, 'state'), { recursive: true });
  await mkdir(join(at, 'index'), { recursive: true });
  await writeFile(join(at, 'config.json'), '{}');
  await writeFile(join(at, 'state', 'session.key'), 'not-a-real-key');
  await writeFile(join(at, 'state', 'state.sqlite'), 'not-a-real-database');
  return at;
}

async function reset(
  at: string,
  options: { cwd?: string; extra?: string[] } = {},
): Promise<{ code: number; out: string }> {
  try {
    const { stdout } = await run(
      process.execPath,
      [SCRIPT, '--data', at, ...(options.extra ?? [])],
      {
        ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
      },
    );
    return { code: 0, out: stdout };
  } catch (error) {
    const failure = error as { code?: number; stdout?: string; stderr?: string };
    return { code: failure.code ?? 1, out: `${failure.stdout ?? ''}${failure.stderr ?? ''}` };
  }
}

describe('resetting a data directory', () => {
  it('removes it completely when nothing holds it', async () => {
    const at = await dataDir();

    const { code } = await reset(at);

    expect(code).toBe(0);
    await expect(readdir(at)).rejects.toThrow();
  });

  /**
   * The case the whole design is for. Holding one file open is what a running
   * server does to its SQLite stores — and the assertion that matters is not
   * the exit code but that **`session.key` is still there**, because that is the
   * file `rm -rf` takes while leaving the database behind.
   *
   * **Asserted per platform, because the mechanism is per platform** — the
   * script's own docstring says so and this test asserted the Windows half on
   * both, which held for exactly as long as nothing ran it on ubuntu: the
   * branch's first ubuntu leg failed here. On Windows an open handle refuses
   * the rename and nothing is removed. On POSIX an open handle blocks nothing
   * — the rename succeeds, the delete proceeds against an unlinked directory,
   * and the held file lives on invisibly under the open descriptor. Both are
   * all-or-nothing, which is the property; *which* all differs.
   */
  it('removes nothing at all when a file is held open', async () => {
    const at = await dataDir();
    held = await open(join(at, 'state', 'state.sqlite'), 'r+');

    const { code, out } = await reset(at);

    if (process.platform === 'win32') {
      expect(code).toBe(1);
      expect(out).toContain('nothing was removed');
      // Not "some files remain" — these specific ones, which are the ones a
      // half-teardown destroys while keeping the database.
      expect(await readdir(join(at, 'state'))).toContain('session.key');
      expect(await readdir(at)).toContain('config.json');
    } else {
      // The whole directory went, held file and all — nothing survives to be
      // the wrong half.
      expect(code).toBe(0);
      await expect(readdir(at)).rejects.toThrow();
    }
  });

  it('says so and stops when there is nothing there', async () => {
    const { code, out } = await reset(join(tmpdir(), 'se-reset-does-not-exist'));

    expect(code).toBe(0);
    expect(out).toContain('Nothing to remove');
  });
});

/**
 * ***It removes a data directory and nothing else*** — 2026-10-01.
 *
 * The guard it had (`RESERVED = ['/', '.', '..']`) was tested against the
 * resolved path, where `.` is never `.`, so `--data .` removed whatever directory
 * it was run from — at the repository root, the checkout. And the default
 * removed any `./data` without asking whether it was one.
 *
 * ***Every case here runs somewhere disposable.*** The working directory is a
 * fresh temporary one whenever the case is about the working directory, and
 * each directory that would go if the guard broke is a throwaway with a marker
 * in it — so a regression costs a temp directory, never this checkout. The
 * repository half of the guard is the same function and is not driven here for
 * that reason.
 */
describe('what it will remove', () => {
  /** A disposable directory, optionally shaped like an install. */
  async function scratch(shaped: boolean): Promise<string> {
    const at = await mkdtemp(join(tmpdir(), 'se-reset-guard-'));
    made.push(at);
    await writeFile(join(at, 'notes.txt'), 'somebody else’s');
    if (shaped) await mkdir(join(at, 'state'), { recursive: true });
    return at;
  }

  it('refuses a directory that does not look like a data directory, and keeps it', async () => {
    const at = await scratch(false);

    const { code, out } = await reset(at);

    expect(code).toBe(1);
    expect(out).toContain('does not look like a StoryEngine data directory');
    expect(await readdir(at)).toContain('notes.txt');
  });

  it('removes that directory when told it is one', async () => {
    const at = await scratch(false);

    const { code } = await reset(at, { extra: ['--force'] });

    expect(code).toBe(0);
    await expect(readdir(at)).rejects.toThrow();
  });

  it('removes an empty directory, which is what a server makes before its first start', async () => {
    const at = await mkdtemp(join(tmpdir(), 'se-reset-empty-'));
    made.push(at);

    expect((await reset(at)).code).toBe(0);
    await expect(readdir(at)).rejects.toThrow();
  });

  /**
   * ***The case the old guard was written for and never caught.*** The
   * directory is shaped like an install, so only the working-directory rule can
   * stop it — and it has to.
   */
  it('refuses the directory it is run from, given as `.`', async () => {
    const at = await scratch(true);

    const { code, out } = await reset('.', { cwd: at });

    expect(code).toBe(1);
    expect(out).toContain('Refusing to remove');
    expect(await readdir(at)).toContain('notes.txt');
  });

  it('refuses a directory above the one it is run from', async () => {
    const at = await scratch(true);
    const below = join(at, 'somewhere', 'deeper');
    await mkdir(below, { recursive: true });

    const { code } = await reset('../..', { cwd: below });

    expect(code).toBe(1);
    expect(await readdir(at)).toContain('notes.txt');
  });

  it('refuses an empty value, which would resolve to the working directory', async () => {
    const at = await scratch(true);

    const { code, out } = await reset('', { cwd: at });

    expect(code).toBe(1);
    expect(out).toContain('--data needs a value');
    expect(await readdir(at)).toContain('notes.txt');
  });
});
