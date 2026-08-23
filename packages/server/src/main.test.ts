// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { Accounts } from './auth/accounts.js';
import { Layout } from './storage/layout.js';

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
  dataDir = await mkdtemp(join(tmpdir(), 'se-cli-'));
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
    // break-glass ([04 §5.1]) and takes what it is given — five characters, or
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
});
