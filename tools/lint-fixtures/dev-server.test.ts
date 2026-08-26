// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/**
 * **The captured log parses, which is the entire claim** — [P2C §1.3].
 *
 * `pnpm dev` puts pnpm's recursive reporter in front of the server and prefixes
 * every line with `packages/server dev: `, so each record becomes a string that
 * begins with a package name and then happens to contain JSON. That was true
 * for the whole of P2 and nobody noticed, because nothing ever tried to read
 * the log back — which is exactly the failure this test is shaped like.
 *
 * A real server, for the same reason `seed.test.ts` uses one: what is being
 * asserted is that two processes agree about a stream of bytes, and a mock
 * would assert the shape of the mock.
 */

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const TOOL = join(ROOT, 'tools', 'dev-server.mjs');

/** A port nothing else in the suite uses. */
const PORT = 8178;

let dataDir: string;
let logDir: string;
let child: ReturnType<typeof spawn> | null = null;

beforeAll(async () => {
  dataDir = await mkdtemp(join(tmpdir(), 'se-log-'));
  logDir = await mkdtemp(join(tmpdir(), 'se-logs-'));
  await writeFile(join(dataDir, 'config.json'), JSON.stringify({ server: { port: PORT } }));

  child = spawn(
    process.execPath,
    [TOOL, '--log-dir', logDir, '--data', dataDir],
    // stdout piped rather than inherited: this test is about the *file*, and a
    // child writing the server's log into the runner's own output makes vitest's
    // report unreadable for no gain.
    { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] },
  );

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

/**
 * **The tree, not the process — because on Windows `kill()` is
 * `TerminateProcess` and the tool's forwarding handler never runs.** The tool
 * forwards SIGINT/SIGTERM to the server it spawned, which is the right
 * behaviour for a person's Ctrl-C — but a test's `child.kill()` gives it no
 * chance, so the *grandchild* server briefly outlived the teardown and held
 * the SQLite WAL against the `rm`, which failed roughly one full-suite run in
 * eight as EBUSY. `taskkill /T` takes the whole tree; POSIX keeps the plain
 * kill, where the forwarding actually runs.
 */
async function killTree(target: ReturnType<typeof spawn>): Promise<void> {
  const exited = new Promise((settle) => target.once('exit', settle));
  if (process.platform === 'win32' && target.pid !== undefined) {
    const { execFile } = await import('node:child_process');
    await new Promise((settle) => {
      execFile('taskkill', ['/pid', String(target.pid), '/T', '/F'], () => settle(undefined));
    });
  } else {
    target.kill();
  }
  await exited;
}

/** EBUSY-tolerant, bounded: the WAL can outlive the kill by an instant. */
async function removeTree(at: string): Promise<void> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      await rm(at, { recursive: true, force: true });
      return;
    } catch (error) {
      if (attempt >= 10) throw error;
      await new Promise((tick) => setTimeout(tick, 200));
    }
  }
}

afterAll(async () => {
  // Waited for, not merely signalled — the lesson `reset-data.mjs` exists to
  // enforce, and the one the tool itself implements for the same reason.
  if (child !== null) await killTree(child);
  await removeTree(dataDir);
  await removeTree(logDir);
}, 30_000);

describe('capturing the server log', () => {
  it('writes a dated file whose every line is a JSON record', async () => {
    const files = await readdir(logDir);

    expect(files).toHaveLength(1);
    // Dated, because a manual phase produces several runs and *which run was
    // that* is the first question asked of them.
    expect(files[0]).toMatch(/^server-\d{4}-\d{2}-\d{2}T[\d-]+\.log$/);

    const lines = (await readFile(join(logDir, files[0] ?? ''), 'utf8'))
      .split('\n')
      .filter((line) => line.trim() !== '');

    // Not "contains JSON" — *is* JSON, every line, which is the property `jq`
    // and every other reader needs and the one the prefix destroyed.
    expect(lines.length).toBeGreaterThan(0);
    for (const line of lines) {
      expect(() => JSON.parse(line) as unknown).not.toThrow();
    }

    // And it is this server's log rather than an empty file that happens to
    // parse: pino writes a level on every record.
    const records = lines.map((line) => JSON.parse(line) as Record<string, unknown>);
    expect(records.every((record) => typeof record['level'] === 'number')).toBe(true);
    expect(records.some((record) => String(record['msg']).includes('listening'))).toBe(true);
  }, 30_000);
});

/**
 * **One `--data` means one directory, whoever is resolving it.**
 *
 * The server runs with its working directory in `packages/server`, so a
 * relative `--data ./scratch` used to land at `packages/server/scratch` — while
 * `pnpm reset-data --data ./scratch`, typed at the same prompt a second
 * earlier, means `./scratch`. Two commands, one argument, two directories, and
 * nothing said so: a person resets one install and then runs against another,
 * which during a manual phase means their evidence is about a directory they
 * did not think they were using.
 *
 * Asserted through the log rather than by looking for the directory, because
 * `dataRoot` is what the server itself believes — and what it believes is the
 * thing that was wrong.
 */
describe('where a relative data directory lands', () => {
  it('resolves it against the directory the command was typed in', async () => {
    const from = await mkdtemp(join(tmpdir(), 'se-cwd-'));
    const logs = await mkdtemp(join(tmpdir(), 'se-cwdlogs-'));

    /**
     * **Its own port, and the config has to be inside `./here`** — which is the
     * directory under test, so writing it is also the setup.
     *
     * Without this the server takes the default 8080 and collides with whatever
     * else the suite has running, which showed up as this test failing once in
     * a full run and passing alone. [12 §4.4](../../docs/design/workplan/12-p2-manual-gate.md)
     * calls a load-sensitive suite a defect in the suite; a test that only fails
     * under load is the same defect, arriving one test at a time.
     */
    await mkdir(join(from, 'here'), { recursive: true });
    await writeFile(join(from, 'here', 'config.json'), JSON.stringify({ server: { port: 8179 } }));

    const child = spawn(process.execPath, [TOOL, '--log-dir', logs, '--data', './here'], {
      cwd: from,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    try {
      const root = await new Promise<string>((settle, fail) => {
        let seen = '';
        const timer = setTimeout(() => {
          fail(new Error('the server never said where it was'));
        }, 30_000);
        child.stdout?.on('data', (chunk: Buffer) => {
          seen += chunk.toString('utf8');
          // Parsed rather than pattern-matched: the value is a Windows path
          // full of backslashes, and a regex over it is a second escaping bug
          // waiting to be written.
          //
          // **Complete lines only.** `split` leaves the unterminated tail as the
          // last element, and a chunk boundary lands inside a record often
          // enough to matter: this failed roughly one full run in four, on a
          // half-written line that already contained `dataRoot` and did not yet
          // contain its closing brace. Passing alone every time, because a
          // quiet machine delivers the record in one chunk.
          const lines = seen.split('\n');
          for (const line of lines.slice(0, -1)) {
            if (!line.includes('dataRoot')) continue;
            const record = JSON.parse(line) as { dataRoot?: string };
            if (record.dataRoot === undefined) continue;
            clearTimeout(timer);
            settle(record.dataRoot);
            return;
          }
        });
      });

      // The prompt's directory, not the server's — and not merely "contains
      // here", which `packages/server/here` would also satisfy.
      expect(root).toBe(join(from, 'here'));
    } finally {
      await killTree(child);
      await removeTree(from);
      await removeTree(logs);
    }
  }, 60_000);
});
