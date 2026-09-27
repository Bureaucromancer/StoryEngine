// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { existsSync } from 'node:fs';
import { copyFile, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { CLOSE_BACKSTOP_MS } from './app.js';
import { Accounts } from './auth/accounts.js';
import { findBackup, takeBackup } from './backup/archive.js';
import { prepareRestore } from './backup/restore.js';
import { Layout } from './storage/layout.js';
import { tempRoot } from './test-server.js';

/**
 * The command line, as a person types it — F21 and F24.
 *
 * `--reset-password` is the only entry point in the codebase that changes a
 * credential, and it was tested at the `Accounts` layer and nowhere else: argv
 * parsing, the missing-handle path and the exit codes had no coverage at all.
 * The half a person actually types was the untested half — which is how F24
 * survived: `--reset-password` as the *final* argument read as `undefined`,
 * the guard treated it as absent, and the server booted normally having reset
 * nothing.
 *
 * Driven as a real child process rather than by calling `main()`. The whole
 * subject is argv, stdin, exit codes and the choice between starting a server
 * and not, and none of those are the same thing in-process.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const ENTRY = join(HERE, 'main.ts');

interface RunResult {
  code: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

/**
 * Runs the entry point with `tsx`, feeding it stdin and killing it if it starts
 * listening — because "did it start a server" is one of the things under test.
 */
async function run(argv: string[], stdin = ''): Promise<RunResult> {
  const child = spawn(process.execPath, ['--import', 'tsx', ENTRY, ...argv], {
    stdio: 'pipe',
    cwd: HERE,
  });

  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (chunk: Buffer) => (stdout += chunk.toString()));
  child.stderr.on('data', (chunk: Buffer) => (stderr += chunk.toString()));

  child.stdin.write(stdin);
  child.stdin.end();

  return await new Promise<RunResult>((resolve) => {
    let settled = false;
    const timer = setTimeout(() => {
      settled = true;
      child.kill();
      resolve({ code: null, stdout, stderr, timedOut: true });
    }, 20_000);

    child.on('exit', (code) => {
      if (settled) return;
      clearTimeout(timer);
      resolve({ code, stdout, stderr, timedOut: false });
    });
  });
}

let dataDir: string;

beforeEach(async () => {
  // F26: the CLI resolves what it is given, so the two sides have to start
  // from the same string — see `tempRoot`.
  dataDir = await tempRoot('se-cli-');
});

afterEach(async () => {
  await rm(dataDir, { recursive: true, force: true });
});

/** An account to reset, made the way setup makes one. */
async function anAccount(handle = 'ned'): Promise<void> {
  const accounts = new Accounts(new Layout(dataDir));
  await accounts.create({ handle, password: 'correct horse battery', role: 'admin' });
}

describe('--reset-password', () => {
  it('replaces the password and says where', async () => {
    await anAccount();

    const result = await run(
      ['--data', dataDir, '--reset-password', 'ned'],
      'a whole new password\n',
    );

    expect(result.code).toBe(0);
    expect(result.stdout).toContain('Password reset for ned');
    // It exits instead of starting a server: no listening line, and the process
    // ended on its own rather than being killed by the timeout.
    expect(result.timedOut).toBe(false);
    expect(result.stdout).not.toContain('listening');

    const accounts = new Accounts(new Layout(dataDir));
    expect(await accounts.authenticate('ned', 'a whole new password')).not.toBeNull();
    expect(await accounts.authenticate('ned', 'correct horse battery')).toBeNull();
  });

  it('fails with a message and a non-zero code on an unknown handle', async () => {
    await anAccount();

    const result = await run(['--data', dataDir, '--reset-password', 'nobody'], 'whatever it is\n');

    expect(result.code).toBe(1);
    expect(result.stderr).toContain('nobody');
  });

  it('honours no minimum, because the console is the authority', async () => {
    // `auth.minPasswordLength` is what the API refuses on. This path is the
    // break-glass ([09 §5.1]) and takes what it is given — five characters, or
    // one, on an install configured to demand twelve.
    await anAccount();

    const result = await run(['--data', dataDir, '--reset-password', 'ned'], 'short\n');

    expect(result.code).toBe(0);
    expect(result.stdout).toContain('Password reset for ned');
    const accounts = new Accounts(new Layout(dataDir));
    expect(await accounts.authenticate('ned', 'short')).not.toBeNull();
  });

  it('changes nothing when stdin closes without an answer', async () => {
    // The case the old length check happened to catch. `run` with no input
    // closes stdin having delivered no line, which is not the same as a blank
    // line and must not be read as an empty password.
    await anAccount();

    const result = await run(['--data', dataDir, '--reset-password', 'ned'], '');

    expect(result.code).toBe(1);
    const accounts = new Accounts(new Layout(dataDir));
    expect(await accounts.authenticate('ned', 'correct horse battery')).not.toBeNull();
  });

  it('does not start the server when the flag has no value', async () => {
    // F24. This used to boot the server: the handle read as `undefined`, the
    // guard read that as "flag not passed", and the operator watched a server
    // start up in response to a password-reset command.
    await anAccount();

    const result = await run(['--data', dataDir, '--reset-password']);

    expect(result.code).toBe(1);
    expect(result.timedOut).toBe(false);
    expect(result.stderr).toContain('--reset-password');
    expect(result.stdout).not.toContain('listening');
  });

  it('does not swallow the next flag as a handle', async () => {
    await anAccount();

    const result = await run(['--reset-password', '--data', dataDir]);

    expect(result.code).toBe(1);
    expect(result.stderr).toContain('--reset-password');
  });

  /**
   * **A flag given twice is refused**, because `pnpm dev:server` already passes
   * `--data ../../data` and pnpm *appends* rather than replaces. So
   * `pnpm dev:server --data ./scratch` used to run against the real data
   * directory in silence, and somebody testing on a scratch install was not.
   *
   * The assertion is on *which* directory, not only on the exit code: a guard
   * that refused for some other reason would satisfy a code-only test while
   * leaving the failure it exists to prevent exactly as it was.
   */
  it('refuses a flag given twice rather than picking one', async () => {
    const second = await mkdtemp(join(tmpdir(), 'se-main-second-'));

    const result = await run(['--data', dataDir, '--data', second, '--reset-password', 'ned']);

    expect(result.code).toBe(1);
    expect(result.stderr).toContain('--data');
    expect(result.stdout).not.toContain('listening');
    // Neither directory was touched — no accounts file was created in either.
    expect(existsSync(join(second, 'accounts.json'))).toBe(false);
    await rm(second, { recursive: true, force: true });
  });
});

/**
 * **A missing config file announces itself in the voice of a problem** —
 * finding 9 in [P2C log](../../../docs/design/workplan/14-p2c-log.md).
 *
 * It is an ordinary state on a first boot and an alarming one on every boot
 * after: a teardown that takes `config.json` reverts the port and the data
 * root to their defaults, and the smoke run watched that revert announce
 * itself at `info` — the same voice as "everything is fine".
 *
 * The line is written before `listen`, which is what makes this testable
 * without a port: the child is killed the moment the line appears, so two
 * copies of this suite cannot collide on an address nothing ever binds.
 */
describe('the config-file line', () => {
  async function startupLine(
    argv: string[],
    /**
     * A substring that picks the line out of the log. Defaulted rather than
     * required so the two tests below read as they did — the parameter exists
     * for the environment tests, which wait for a different line and in one
     * case for one written *after* `listen`.
     */
    marker = 'fileFound',
    environment: Record<string, string> = {},
  ): Promise<Record<string, unknown>> {
    const child = spawn(process.execPath, ['--import', 'tsx', ENTRY, ...argv], {
      stdio: ['ignore', 'pipe', 'pipe'],
      cwd: HERE,
      env: { ...process.env, ...environment },
    });

    try {
      return await new Promise<Record<string, unknown>>((resolve, reject) => {
        let seen = '';
        const timer = setTimeout(() => {
          reject(new Error(`the server never logged a line containing ${marker}`));
        }, 15_000);
        child.stdout.on('data', (chunk: Buffer) => {
          seen += chunk.toString();
          for (const line of seen.split('\n').slice(0, -1)) {
            if (!line.includes(marker)) continue;
            clearTimeout(timer);
            resolve(JSON.parse(line) as Record<string, unknown>);
            return;
          }
        });
      });
    } finally {
      const exited = new Promise((settle) => child.once('exit', settle));
      child.kill();
      await exited;
    }
  }

  it('warns when there is no file, so a torn-down install cannot revert quietly', async () => {
    const line = await startupLine(['--data', dataDir]);

    // Pino's warn, not its info — the level is the assertion, because the words
    // already said "no config file" when nobody could hear the difference.
    expect(line['level']).toBe(40);
    expect(line['fileFound']).toBe(false);
  });

  it('stays conversational when the file is there', async () => {
    await writeFile(join(dataDir, 'config.json'), JSON.stringify({ server: { port: 8180 } }));

    const line = await startupLine(['--data', dataDir]);

    expect(line['level']).toBe(30);
    expect(line['fileFound']).toBe(true);
  });

  /**
   * **The environment layer, where it actually has to work** — [P6A.0],
   * [P6A §1.2], [P10 §1.2](../../../docs/design/workplan/27-p10-implementation.md).
   *
   * `config.test.ts` proves the resolver: what the layers are and which wins.
   * What it cannot prove is that this entry point *uses* it, and that is the
   * half the phase turns on — the environment layer was built because an image
   * with no config file was unreachable no matter how its port was mapped, and
   * a layer nothing calls leaves that exactly as it was. The falsifying
   * mutation is one line: `loadConfig(configPath)` with the document dropped.
   *
   * It is here rather than beside the resolver because the subject is a
   * process: argv, an environment, and a socket. The suite already spawns this
   * entry point for the same reason.
   */
  it('takes its bind from the environment when there is no config file', async () => {
    /**
     * **A bound port, which the two tests above deliberately avoid** — they are
     * about a line written before `listen`, and this one is about `listen`
     * itself. So it takes a port the OS has just told us is free, and binds a
     * loopback name rather than a wildcard: `localhost` is provably not the
     * `127.0.0.1` default, reaches nothing outside the machine, and does not
     * ask a Windows firewall for an opinion.
     */
    const port = await freePort();

    const line = await startupLine(['--data', dataDir], 'StoryEngine listening', {
      SE_HOST: 'localhost',
      SE_PORT: String(port),
    });

    // The whole chain in one assertion: two variables, through the document,
    // through the merge, into `app.listen`, with no config file anywhere.
    expect(line['api']).toBe(`http://localhost:${String(port)}`);
  });

  /**
   * **`SE_DATA_DIR` decides where the config file is looked for**, which is the
   * one place the environment is read *before* the file rather than under it —
   * the key that names the file's own directory cannot wait for the file to
   * say. No `--data` here, deliberately: that flag would settle the location
   * itself and the variable would prove nothing.
   *
   * `fileFound` is the assertion because it separates the two answers exactly.
   * A process that ignored the variable looks in `./data` relative to its
   * working directory, finds nothing, and says `false`.
   */
  it('looks for the config file where a variable puts the data directory', async () => {
    await writeFile(join(dataDir, 'config.json'), JSON.stringify({ server: { port: 8180 } }));

    const line = await startupLine([], 'fileFound', { SE_DATA_DIR: dataDir });

    expect(line['fileFound']).toBe(true);
    expect(String(line['configPath'])).toContain(dataDir);
  });

  it('says so when the file already speaks for a key a variable sets', async () => {
    await writeFile(
      join(dataDir, 'config.json'),
      JSON.stringify({ server: { host: 'localhost' } }),
    );

    const line = await startupLine(['--data', dataDir], 'did not apply', {
      SE_HOST: '0.0.0.0',
    });

    // A warning, not an info: the operator set something that is not taking
    // effect, and the file outranking it ([P6A §1.2]) is invisible otherwise.
    expect(line['level']).toBe(40);
    expect(line['variables']).toEqual(['SE_HOST']);
  });

  /**
   * **Where a first-run install is told to go, in each of the two
   * arrangements** — and they are two, which is what the line got wrong.
   *
   * A packaged build serves its own client ([P6A.1]), so its address is the
   * one to open; a development run does not, so Vite's is. Between P6A.1 and
   * this test the answer was Vite's either way, which sent anybody running a
   * built server on loopback to a port with nothing behind it — found by
   * running one, the day after Alpha 1 was cut. Both cases are asserted,
   * because a fix that answered the API's address unconditionally would break
   * the development half and no test would have said so.
   */
  it('sends a packaged build to its own address, since it serves the client', async () => {
    const clientRoot = join(dataDir, 'client');
    await mkdir(clientRoot, { recursive: true });
    // `buildApp` refuses a client root with no `index.html` in it, so the
    // fixture is a build rather than an empty directory.
    await writeFile(join(clientRoot, 'index.html'), '<!doctype html>\n');
    const port = await freePort();

    const line = await startupLine(['--data', dataDir], 'No accounts yet', {
      SE_HOST: 'localhost',
      SE_PORT: String(port),
      SE_CLIENT_ROOT: clientRoot,
    });

    expect(line['open']).toBe(`http://localhost:${String(port)}`);
  });

  /**
   * ***A restore brings its own config, and the process has to run on it.***
   * `main.ts` read `config.json` before the swap, from the install the swap
   * then replaced, and carried on with it: the restored install ran on the old
   * one's settings until somebody restarted it again. Here the two configs
   * disagree about the port, which is the setting a line can show.
   *
   * Catches: dropping the re-read after a restore. The server then listens
   * where the replaced install's config said.
   */
  it('boots a restored install on the config the archive brought', async () => {
    const before = await freePort();
    const after = await freePort();

    // The archive: an install whose config listens on `after`.
    const source = await tempRoot('se-cli-source-');
    try {
      const from = new Layout(source);
      await mkdir(from.stateRoot, { recursive: true });
      await writeFile(join(source, 'config.json'), JSON.stringify({ server: { port: after } }));
      const store = new DatabaseSync(from.stateFile);
      const context = { layout: from, state: store, build: null };
      const record = await takeBackup(context, {
        owner: { kind: 'install' },
        contents: 'full',
        reason: 'manual',
      });
      const found = await findBackup(context, { kind: 'install' }, record.id);
      store.close();

      // Stored in this install, which listens on `before`, and asked for.
      const here = new Layout(dataDir);
      await writeFile(join(dataDir, 'config.json'), JSON.stringify({ server: { port: before } }));
      await mkdir(here.backupsRoot, { recursive: true });
      const archive = join(here.backupsRoot, found!.name);
      await copyFile(found!.path, archive);
      expect((await prepareRestore(here, { path: archive, requestedBy: 'ned' })).ok).toBe(true);
    } finally {
      await rm(source, { recursive: true, force: true });
    }

    const line = await startupLine(['--data', dataDir], 'StoryEngine listening', {
      SE_HOST: 'localhost',
    });

    expect(line['api']).toBe(`http://localhost:${String(after)}`);
  });

  it('sends a development run to the client’s own port, which is a different process', async () => {
    const port = await freePort();

    const line = await startupLine(['--data', dataDir], 'No accounts yet', {
      SE_HOST: 'localhost',
      SE_PORT: String(port),
    });

    expect(line['open']).toBe('http://localhost:5173');
  });
});

/**
 * **A data directory the process cannot use is refused in one line** — what
 * Alpha 1's first install met as an `EACCES` stack trace out of
 * `mkdir /data/state` ([P6A §3](../../../docs/design/workplan/19-p6a-alpha-1.md)
 * step 11). Driven as a child because the subject is what a person sees when
 * the server does not start: the sentence, the exit code, and no listening line.
 *
 * A path under a file, because it cannot be made on any platform by anyone —
 * the permission case needs mode bits Windows does not have, and
 * `ensureWritableDirectory`'s own test covers it where they exist.
 */
describe('an unusable data directory', () => {
  it('is refused with the sentence, not a stack trace', async () => {
    await writeFile(join(dataDir, 'afile'), 'x');

    const result = await run(['--data', join(dataDir, 'afile', 'data')]);

    expect(result.code).toBe(1);
    expect(result.stderr).toContain('The data directory');
    expect(result.stderr).toContain('cannot be created or written');
    expect(result.stderr).toContain('ENOTDIR');
    expect(result.stderr).not.toContain('at async');
    expect(result.stdout).not.toContain('listening');
    expect(result.timedOut).toBe(false);
  });
});

/**
 * ***A restore that could neither finish nor be undone stops the boot*** —
 * [P12.12] as corrected 2026-09-27. The directory is part one install and part
 * another, and a server that went on would offer whichever half lacks
 * `accounts.json` as a fresh install with a setup token. A journal nobody can
 * read is the simplest way to be there.
 */
describe('a restore it cannot finish', () => {
  it('refuses to start, and says where both halves are', async () => {
    await mkdir(join(dataDir, '.restore'), { recursive: true });
    await writeFile(join(dataDir, '.restore', 'swap.json'), '{ half a journal');

    const result = await run(['--data', dataDir]);

    expect(result.code).toBe(1);
    expect(result.stderr).toContain('A restore could not finish and could not be undone');
    expect(result.stderr).toContain('swap.json');
    expect(result.stdout).not.toContain('listening');
    expect(result.timedOut).toBe(false);
  });
});

/**
 * ***Leaving, with somebody watching*** — [09 §6.4], and the two ways a
 * supervised process ends.
 *
 * **As a child, because the subjects are an exit status and whether there is
 * one at all.** Neither exists in-process: `services.exit` is null under the
 * harness, and `inject()` never listens, so it cannot hold a close open. Both
 * defects lived exactly there:
 *
 * - **A requested restart exited 0**, which the shipped unit's
 *   `Restart=on-failure` reads as a deliberate stop. The install stayed down.
 * - **One open tab hung every exit.** The stream closer ran in `onClose`,
 *   which Fastify runs only after the listener has waited for every open
 *   response, so it waited on itself. *Restart now*, a restore and `SIGTERM`
 *   all never returned.
 *
 * Each test opens the notification stream every signed-in tab holds, and then
 * asks the process to leave.
 */
describe('leaving, with a tab open', () => {
  const HANDLE = 'ned';
  const PASSWORD = 'correct horse battery';
  // Double-submit: the server compares the cookie with the header, so a client
  // that sets both has passed it.
  const CSRF = 'test-csrf-token';

  /**
   * ***Shorter than the backstop, deliberately.*** `closeApp` ends every open
   * socket after `CLOSE_BACKSTOP_MS`, so a deadline past it would pass with the
   * stream closer broken: the backstop would end the tab, just late. A clean
   * exit here takes well under a second.
   */
  const LEAVES_WITHIN_MS = CLOSE_BACKSTOP_MS - 2_000;

  interface Running {
    child: ReturnType<typeof spawn>;
    port: number;
    /** The exit status, or `'hung'` if the process was still there at the deadline. */
    exited: (ms: number) => Promise<number | null | 'hung'>;
  }

  async function start(): Promise<Running> {
    const port = await freePort();
    const child = spawn(process.execPath, ['--import', 'tsx', ENTRY, '--data', dataDir], {
      stdio: ['ignore', 'pipe', 'pipe'],
      cwd: HERE,
      env: {
        ...process.env,
        SE_HOST: '127.0.0.1',
        SE_PORT: String(port),
        SE_SUPERVISED: '1',
        INVOCATION_ID: '',
      },
    });
    const gone = new Promise<number | null>((resolve) => {
      child.once('exit', resolve);
    });
    const exited = async (ms: number): Promise<number | null | 'hung'> => {
      let timer: NodeJS.Timeout | undefined;
      const hung = new Promise<'hung'>((resolve) => {
        timer = setTimeout(() => {
          resolve('hung');
        }, ms);
      });
      const outcome = await Promise.race([gone, hung]);
      clearTimeout(timer);
      if (outcome === 'hung') {
        child.kill('SIGKILL');
        await gone;
      }
      return outcome;
    };

    await new Promise<void>((resolve, reject) => {
      let seen = '';
      const timer = setTimeout(() => {
        reject(new Error('the server never said it was listening'));
      }, 15_000);
      child.stdout.on('data', (chunk: Buffer) => {
        seen += chunk.toString();
        if (!seen.includes('StoryEngine listening')) return;
        clearTimeout(timer);
        resolve();
      });
    });
    return { child, port, exited };
  }

  /** One request on its own connection, the way a browser would send it. */
  async function call(
    port: number,
    method: string,
    path: string,
    options: { cookie?: string; body?: unknown } = {},
  ): Promise<{ status: number; cookies: string[] }> {
    const { request } = await import('node:http');
    return await new Promise((resolve, reject) => {
      const outgoing = request(
        {
          host: '127.0.0.1',
          port,
          method,
          path,
          agent: false,
          headers: {
            // Only with a body: Fastify refuses an empty one that claims JSON.
            ...(options.body === undefined ? {} : { 'content-type': 'application/json' }),
            'x-csrf-token': CSRF,
            cookie: [`se_csrf=${CSRF}`, options.cookie].filter(Boolean).join('; '),
          },
        },
        (incoming) => {
          incoming.resume();
          incoming.on('end', () => {
            const cookies = (incoming.headers['set-cookie'] ?? []).map(
              (line) => line.split(';')[0] ?? '',
            );
            resolve({ status: incoming.statusCode ?? 0, cookies });
          });
        },
      );
      outgoing.on('error', reject);
      outgoing.end(options.body === undefined ? undefined : JSON.stringify(options.body));
    });
  }

  /** Signs the first admin in, then opens the stream a signed-in tab holds. */
  async function aTabOpen(port: number): Promise<{ cookie: string; ended: Promise<void> }> {
    const setup = await call(port, 'POST', '/api/auth/setup', {
      body: { handle: HANDLE, password: PASSWORD },
    });
    expect(setup.status).toBe(201);
    const cookie = setup.cookies.join('; ');

    const { get } = await import('node:http');
    const stream = await new Promise<import('node:http').IncomingMessage>((resolve, reject) => {
      get(
        {
          host: '127.0.0.1',
          port,
          path: '/api/me/notifications/stream',
          agent: false,
          headers: { cookie },
        },
        resolve,
      ).on('error', reject);
    });
    expect(stream.statusCode).toBe(200);
    const ended = new Promise<void>((resolve) => {
      stream.on('close', resolve);
      stream.resume();
    });
    return { cookie, ended };
  }

  /**
   * Catches: exiting 0 from `services.exit` (the unit stays down), and the
   * stream closer back in `onClose` (the process never exits, and this reads
   * `'hung'`).
   */
  it('restarts with the status a supervisor restarts on', async () => {
    const running = await start();
    const tab = await aTabOpen(running.port);

    const accepted = await call(running.port, 'POST', '/api/admin/restart', {
      cookie: tab.cookie,
    });
    expect(accepted.status).toBe(202);

    // `RESTART_EXIT_CODE`, spelled out: the unit's `RestartForceExitStatus`
    // is held to the same number by `release.test.ts`.
    expect(await running.exited(LEAVES_WITHIN_MS)).toBe(75);
    await tab.ended;
  });

  /**
   * *A stop is still a stop*: 0, so a supervisor told to stop does not read
   * the exit as a request to come back. No Windows leg, because Node there has
   * no `SIGTERM` to send: `kill()` ends the process outright, and no handler
   * runs.
   *
   * Catches: the stream closer back in `onClose`, which hangs this until the
   * deadline.
   */
  it.skipIf(process.platform === 'win32')('stops on SIGTERM, and says so with 0', async () => {
    const running = await start();
    const tab = await aTabOpen(running.port);

    running.child.kill('SIGTERM');

    expect(await running.exited(LEAVES_WITHIN_MS)).toBe(0);
    await tab.ended;
  });
});

/** A port the OS has just confirmed is free, for the one test that binds one. */
async function freePort(): Promise<number> {
  const probe = createServer();
  await new Promise<void>((ready) => probe.listen(0, '127.0.0.1', ready));
  const address = probe.address();
  const port = typeof address === 'object' && address !== null ? address.port : 0;
  await new Promise<void>((closed) => {
    probe.close(() => {
      closed();
    });
  });
  if (port === 0) throw new Error('could not find a free port');
  return port;
}
