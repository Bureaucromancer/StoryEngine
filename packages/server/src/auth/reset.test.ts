// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { Layout } from '../storage/layout.js';
import { AccountError, Accounts } from './accounts.js';
import { readNewPassword, ResetAborted } from './reset.js';

/**
 * The break-glass password reset — `--reset-password` on the server binary.
 *
 * The claim under test is not "the password changes" so much as the shape of
 * the repair: the account comes back *usable* (enabled, new password, old one
 * dead), and a server already running beside the reset sees the change rather
 * than authenticating against a cache of the password that was just replaced.
 */

let dataDir: string;
let layout: Layout;

beforeEach(async () => {
  dataDir = await mkdtemp(join(tmpdir(), 'se-reset-'));
  layout = new Layout(dataDir);
});

afterEach(async () => {
  await rm(dataDir, { recursive: true, force: true });
});

describe('Accounts.resetPassword', () => {
  it('replaces the password: the new one works and the old one is dead', async () => {
    const accounts = new Accounts(layout);
    await accounts.createFirstAdmin({ handle: 'ned', password: 'the old password' });

    await accounts.resetPassword('ned', 'the new password');

    expect(await accounts.authenticate('ned', 'the new password')).not.toBeNull();
    expect(await accounts.authenticate('ned', 'the old password')).toBeNull();
  });

  it('re-enables a disabled account — resetting a password you cannot use is a half-repair', async () => {
    const accounts = new Accounts(layout);
    await accounts.createFirstAdmin({ handle: 'ned', password: 'the old password' });

    // Disable by hand, the way an admin eventually will through the UI. The
    // store has no disable API yet, so this writes the file the way a hand
    // edit would — which also exercises the stat-checked cache noticing it.
    const file = JSON.parse(await readFile(layout.accountsFile, 'utf8'));
    file.accounts[0].enabled = false;
    await writeFile(layout.accountsFile, JSON.stringify(file, null, 2));

    expect(await accounts.authenticate('ned', 'the old password')).toBeNull();

    const account = await accounts.resetPassword('ned', 'the new password');
    expect(account.enabled).toBe(true);
    expect(await accounts.authenticate('ned', 'the new password')).not.toBeNull();
  });

  it('refuses an unknown handle', async () => {
    const accounts = new Accounts(layout);
    await accounts.createFirstAdmin({ handle: 'ned', password: 'the old password' });

    await expect(accounts.resetPassword('nobody', 'whatever password')).rejects.toThrow(
      AccountError,
    );
  });

  it('is seen by a second Accounts instance already holding a cache', async () => {
    // The live-server case: the reset runs in its own process while the server
    // is up. Two instances stand in for the two processes; the second has read
    // (and cached) the file before the first rewrites it.
    const resetProcess = new Accounts(layout);
    const runningServer = new Accounts(layout);

    await resetProcess.createFirstAdmin({ handle: 'ned', password: 'the old password' });
    expect(await runningServer.authenticate('ned', 'the old password')).not.toBeNull();

    await resetProcess.resetPassword('ned', 'the new password');

    expect(await runningServer.authenticate('ned', 'the new password')).not.toBeNull();
    expect(await runningServer.authenticate('ned', 'the old password')).toBeNull();
  });
});

describe('readNewPassword', () => {
  it('reads one line from a pipe', async () => {
    const input = new PassThrough();
    const output = { write: () => undefined };
    const pending = readNewPassword(input, output, 'ned');
    input.end('piped password\n');
    expect(await pending).toBe('piped password');
  });

  it('accepts a pipe with no trailing newline', async () => {
    const input = new PassThrough();
    const pending = readNewPassword(input, { write: () => undefined }, 'ned');
    input.end('piped password');
    expect(await pending).toBe('piped password');
  });

  it('rejects a short password', async () => {
    const input = new PassThrough();
    const pending = readNewPassword(input, { write: () => undefined }, 'ned');
    input.end('short\n');
    await expect(pending).rejects.toThrow(ResetAborted);
  });

  it('asks twice at a terminal, masks, and honours backspace', async () => {
    const input = new PassThrough() as PassThrough & {
      isTTY: boolean;
      setRawMode: (mode: boolean) => void;
    };
    input.isTTY = true;
    input.setRawMode = () => undefined;

    const written: string[] = [];
    const pending = readNewPassword(input, { write: (text: string) => written.push(text) }, 'ned');

    // 'the new pasX' + DEL + 'sword' — a typo erased in flight. Built with
    // fromCharCode so no literal control byte sits in the source.
    const BACKSPACE = String.fromCharCode(127);
    input.write(`the new pasX${BACKSPACE}sword\r`);
    input.write('the new password\r');

    expect(await pending).toBe('the new password');
    // Nothing typed is ever echoed — the output is the two prompts and the
    // newlines that end them, and nothing else.
    expect(written.join('')).toBe('New password for ned: \nRepeat it: \n');
  });

  it('rejects when the two entries differ', async () => {
    const input = new PassThrough() as PassThrough & {
      isTTY: boolean;
      setRawMode: (mode: boolean) => void;
    };
    input.isTTY = true;
    input.setRawMode = () => undefined;

    const pending = readNewPassword(input, { write: () => undefined }, 'ned');
    input.write('one long password\r');
    input.write('another long password\r');

    await expect(pending).rejects.toThrow('did not match');
  });

  it('rejects on Ctrl-C without leaving anything changed', async () => {
    const input = new PassThrough() as PassThrough & {
      isTTY: boolean;
      setRawMode: (mode: boolean) => void;
    };
    input.isTTY = true;
    input.setRawMode = () => undefined;

    const pending = readNewPassword(input, { write: () => undefined }, 'ned');
    const CTRL_C = String.fromCharCode(3);
    input.write(`half a pass${CTRL_C}`);

    await expect(pending).rejects.toThrow('Cancelled');
  });
});
