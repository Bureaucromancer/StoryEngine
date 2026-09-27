// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import { Layout } from '../storage/layout.js';
import { Accounts } from './accounts.js';

/**
 * ***A sign-in for nobody costs what a sign-in for somebody does***
 * (2026-09-27).
 *
 * `POST /api/auth/login` gives one answer for no such handle, a disabled
 * account and a wrong password, and the route says that is to avoid a handle
 * oracle. The time was not one answer: a handle nobody held, or a disabled one,
 * returned before the scrypt, in about a millisecond against about fifty. So
 * anyone who could reach the port could find out which handles exist, a
 * request each, on the default install that lists none.
 *
 * Asserted as the number of key derivations each case pays for, which is the
 * cost the timing follows, rather than as a stopwatch, which would be the
 * flakiest test in the suite. A file of its own because the counter wraps the
 * module every other account test uses as it is.
 */
const derivations = vi.hoisted(() => ({ count: 0 }));

vi.mock('./secrets.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./secrets.js')>();
  return {
    ...actual,
    verifyPassword: async (...args: Parameters<typeof actual.verifyPassword>) => {
      derivations.count += 1;
      return actual.verifyPassword(...args);
    },
  };
});

let dataDir: string;
let accounts: Accounts;

beforeEach(async () => {
  dataDir = await mkdtemp(join(tmpdir(), 'se-sign-in-cost-'));
  accounts = new Accounts(new Layout(dataDir));
  await accounts.createFirstAdmin({ handle: 'ned', password: 'the first password' });
  await accounts.create({ handle: 'mara', password: 'a password', role: 'user' });
  await accounts.update('mara', { enabled: false });
  derivations.count = 0;
});

afterEach(async () => {
  await rm(dataDir, { recursive: true, force: true });
});

it('pays one key derivation for a wrong password, which is the cost to match', async () => {
  expect(await accounts.authenticate('ned', 'not the password')).toBeNull();
  expect(derivations.count).toBe(1);
});

it('pays the same for a handle nobody holds', async () => {
  expect(await accounts.authenticate('nobody', 'not the password')).toBeNull();
  expect(derivations.count).toBe(1);
});

it('pays the same for a disabled account, and still refuses its right password', async () => {
  expect(await accounts.authenticate('mara', 'a password')).toBeNull();
  expect(derivations.count).toBe(1);
});
