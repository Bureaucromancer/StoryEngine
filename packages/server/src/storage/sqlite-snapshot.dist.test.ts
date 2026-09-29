// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { execFile } from 'node:child_process';
import { mkdtemp, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

/**
 * ***The snapshot's worker, loaded the way production loads it*** — from the
 * built `dist`, by plain `node`, in a process started with a V8 flag. Found at
 * review, 2026-09-29, as two defects the source suite could not see:
 *
 * - **The worker's file is found by the extension of the module that starts
 *   it** — `.ts` under vitest, `.js` from `dist`. A name hard-coded to `.ts`
 *   passed every test in `sqlite-snapshot.test.ts` and would have failed
 *   every snapshot in production, since `dist` holds only the `.js`. Only a
 *   test that runs the built module can tell.
 * - **Node refuses a worker whose `execArgv` names a V8 flag**, and the worker
 *   was started with the server's own flags spread in: `node
 *   --max-old-space-size=… dist/main.js` — an operator raising the heap for a
 *   large import — made every snapshot throw `ERR_WORKER_INVALID_EXEC_ARGV`.
 *   So the child here is started with that flag.
 *
 * **It needs a build**, and says so rather than skipping: CI builds before it
 * tests for this reason, as `packages/client/src/tailwind-utilities.test.ts`
 * already relies on. A build older than the source tests the old code — run
 * `pnpm build` before believing a failure here that the source suite does not
 * share.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const DIST = join(HERE, '..', '..', 'dist', 'storage');

const NO_BUILD =
  'No built snapshot module under packages/server/dist/storage. Run `pnpm build` first — this test takes a snapshot through the built JavaScript, which is the only way to know the worker loads outside vitest. CI builds before it tests for exactly this reason.';

/**
 * The child's whole program: a database as a running Aventuras leaves it, one
 * snapshot of it through the built module, and a line of JSON saying what came
 * of it. Plain JavaScript, since it runs outside every transform.
 */
const PROBE = `
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const [dist, root] = process.argv.slice(2);
const { Layout } = await import(pathToFileURL(join(dist, 'layout.js')).href);
const { snapshotDatabase } = await import(pathToFileURL(join(dist, 'sqlite-snapshot.js')).href);

const layout = new Layout(join(root, 'data'));
mkdirSync(join(root, 'aventuras'), { recursive: true });
const source = join(root, 'aventuras', 'aventura.db');
const writer = new DatabaseSync(source);
writer.exec('pragma journal_mode = wal');
writer.exec('pragma wal_autocheckpoint = 0');
writer.exec('create table vault (id text primary key)');
writer.exec("insert into vault values ('saved')");
writer.exec('pragma wal_checkpoint(truncate)');
writer.exec("insert into vault values ('unsaved')");

const snapshot = await snapshotDatabase(layout, { kind: 'path', path: source });
let ids = null;
if (snapshot.ok) {
  const copy = new DatabaseSync(snapshot.path, { readOnly: true });
  ids = copy.prepare('select id from vault order by id').all().map((row) => row.id);
  copy.close();
  await snapshot.dispose();
}
writer.close();
console.log(JSON.stringify({
  execArgv: process.execArgv,
  ok: snapshot.ok,
  route: snapshot.ok ? snapshot.route : snapshot.refusal,
  ids,
  left: readdirSync(layout.importScratchRoot),
}));
`;

const run = promisify(execFile);

let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'se-snapshot-dist-'));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe('the built snapshot module', () => {
  it('takes a snapshot on its worker, in a server started with a V8 flag', async () => {
    try {
      await stat(join(DIST, 'sqlite-snapshot-worker.js'));
    } catch {
      throw new Error(NO_BUILD);
    }
    const probe = join(root, 'probe.mjs');
    await writeFile(probe, PROBE);

    const flag = '--max-old-space-size=256';
    let stdout: string;
    try {
      ({ stdout } = await run(process.execPath, [flag, probe, DIST, root]));
    } catch (error) {
      // The child's stderr is the useful half of a failure — the worker's own
      // error, or Node's refusal of its flags — so it is what is reported.
      const stderr = (error as { stderr?: unknown }).stderr;
      throw new Error(
        `The built snapshot module failed in a child process. If the source suite passes, rebuild with \`pnpm build\` first.\n${String(stderr)}`,
        { cause: error },
      );
    }

    const said: unknown = JSON.parse(stdout.trim().split('\n').at(-1) ?? 'null');
    expect(said).toEqual({
      execArgv: [flag],
      ok: true,
      route: 'vacuum',
      ids: ['saved', 'unsaved'],
      left: [],
    });
  });
});
