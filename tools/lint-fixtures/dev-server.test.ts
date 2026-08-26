// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { spawn } from 'node:child_process';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
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

afterAll(async () => {
  // Waited for, not merely signalled — the lesson `reset-data.mjs` exists to
  // enforce, and the one the tool itself implements for the same reason.
  if (child !== null) {
    const exited = new Promise((settle) => child?.once('exit', settle));
    child.kill();
    await exited;
  }
  await rm(dataDir, { recursive: true, force: true });
  await rm(logDir, { recursive: true, force: true });
}, 20_000);

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
