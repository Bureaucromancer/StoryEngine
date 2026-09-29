// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { fileExists, listDirectoryNames } from '../storage/files.js';
import { Layout } from '../storage/layout.js';
import { AccountError, Accounts } from './accounts.js';

/**
 * The account store's mutating verbs — [P2A §3](../../../../docs/design/workplan/09-p2a-configuration-surface.md),
 * stage P2A.1.
 *
 * Until this stage the store could create an account and, through the
 * break-glass CLI, replace its password. **Every other account mutation was a
 * console command**, which is why `Accounts.list()` had no caller at all: after
 * first-run setup there was no way to change a display name, a locale, a role,
 * an enabled flag or a capability without editing `accounts.json` by hand.
 *
 * These are the verbs [10 §15.1](../../../../docs/design/10-ui-surfaces.md) and
 * [10 §15.2](../../../../docs/design/10-ui-surfaces.md) name, tested here before
 * any route exists — so the guard that keeps an install from locking itself out
 * lives in one place rather than in whichever handler remembered it.
 */

let dataDir: string;
let layout: Layout;
let accounts: Accounts;

beforeEach(async () => {
  dataDir = await mkdtemp(join(tmpdir(), 'se-accounts-'));
  layout = new Layout(dataDir);
  accounts = new Accounts(layout);
  await accounts.createFirstAdmin({ handle: 'ned', password: 'the first password' });
});

afterEach(async () => {
  await rm(dataDir, { recursive: true, force: true });
});

/** A second account, so the last-admin guard has something to count. */
async function alsoAdmin(handle: string): Promise<void> {
  await accounts.create({ handle, password: 'a password', role: 'admin' });
}

async function alsoUser(handle: string): Promise<void> {
  await accounts.create({ handle, password: 'a password', role: 'user' });
}

/** What is sitting in `data/removed/` — the folders a removal left behind. */
async function listRemoved(): Promise<string[]> {
  return listDirectoryNames(layout.removedRoot);
}

async function storedFile(): Promise<{ accounts: Record<string, unknown>[] }> {
  return JSON.parse(await readFile(layout.accountsFile, 'utf8')) as {
    accounts: Record<string, unknown>[];
  };
}

describe('updateSelf', () => {
  it('changes the display name and the locale', async () => {
    const updated = await accounts.updateSelf('ned', {
      displayName: 'Ned C.',
      locale: 'en-GB',
    });

    expect(updated.displayName).toBe('Ned C.');
    expect(updated.locale).toBe('en-GB');
    // Read back rather than trusted from the return value: the claim is that it
    // reached the file, and the cache would happily report otherwise.
    expect((await accounts.find('ned'))?.displayName).toBe('Ned C.');
  });

  it('leaves untouched fields alone rather than defaulting them', async () => {
    await accounts.updateSelf('ned', { displayName: 'Ned C.' });

    const after = await accounts.find('ned');
    // A patch that reset `locale` to null, or `role` to 'user', would be a
    // silent demotion — and a spread over a partial is exactly how that happens.
    expect(after?.role).toBe('admin');
    expect(after?.enabled).toBe(true);
  });

  /**
   * **The signature is the guard.** `updateSelf` cannot express a role, an
   * enabled flag or a capability, so the self-service route cannot pass one
   * through by forgetting to strip it — the guarantee lives in the type rather
   * than in a branch somebody can later get wrong.
   *
   * Asserted as a compile-time fact would be ideal and is not expressible in a
   * runtime test, so this asserts the consequence: handing it the extra field
   * anyway changes nothing.
   */
  it('cannot change a role even when handed one', async () => {
    // Called through a widened signature, which is the situation the runtime
    // pick actually defends against: TypeScript's types are erased, so a
    // JavaScript consumer or a route whose body schema grew a field reaches
    // this method with exactly this object.
    const untyped = accounts.updateSelf.bind(accounts) as (
      handle: string,
      patch: Record<string, unknown>,
    ) => Promise<unknown>;

    await untyped('ned', { displayName: 'Ned C.', role: 'user', enabled: false });

    const after = await accounts.find('ned');
    expect(after?.role).toBe('admin');
    expect(after?.enabled).toBe(true);
  });

  it('refuses an unknown handle rather than creating one', async () => {
    await expect(accounts.updateSelf('nobody', { displayName: 'x' })).rejects.toThrow(AccountError);
    expect((await storedFile()).accounts).toHaveLength(1);
  });
});

describe('update, which is the admin verb', () => {
  it('grants a capability, merging rather than replacing the record', async () => {
    await alsoUser('mara');

    const updated = await accounts.update('mara', {
      capabilities: { privateConnections: false },
    });

    expect(updated.capabilities.privateConnections).toBe(false);
    // The other two survive. A form sending one switch must not clear the
    // others, and a newer build's capability must survive an older client.
    expect(updated.capabilities.fileAccess).toBe('none');
    expect(updated.capabilities.enableExtensions).toBe(false);
  });

  it('disables an account without touching its password or its data', async () => {
    await alsoUser('mara');

    await accounts.update('mara', { enabled: false });

    // The lockout is the whole effect: the credentials still exist and the
    // directory is untouched, which is what makes disable reversible and
    // distinct from the destructive verb ([P2A §2.3]).
    expect(await accounts.authenticate('mara', 'a password')).toBeNull();
    expect(await fileExists(layout.userRoot('mara'))).toBe(true);
    expect((await accounts.find('mara'))?.enabled).toBe(false);
  });
});

/**
 * **One predicate, three gestures** — [P2A §2.4], gate step 10.
 *
 * Demote, disable and remove are one failure wearing three faces, and writing
 * three checks is how the third gets written differently or not at all. This is
 * also the first thrower `AccountError`'s `last-admin` code has ever had: the
 * code was declared at P1 against a day nobody could reach.
 *
 * The load-bearing word is **usable**. An install whose only admin is disabled
 * is locked out exactly as thoroughly as one with no admin, and it is a state an
 * admin can otherwise reach in one click while the account list still shows an
 * administrator.
 */
describe('the last usable admin', () => {
  it('cannot be demoted', async () => {
    await expect(accounts.update('ned', { role: 'user' })).rejects.toMatchObject({
      code: 'last-admin',
    });
    expect((await accounts.find('ned'))?.role).toBe('admin');
  });

  it('cannot be disabled', async () => {
    await expect(accounts.update('ned', { enabled: false })).rejects.toMatchObject({
      code: 'last-admin',
    });
    expect((await accounts.find('ned'))?.enabled).toBe(true);
  });

  it('cannot be removed', async () => {
    await expect(accounts.remove('ned')).rejects.toMatchObject({ code: 'last-admin' });
    expect(await accounts.find('ned')).not.toBeNull();
    expect(await fileExists(layout.userRoot('ned'))).toBe(true);
  });

  /**
   * A *disabled* second admin does not count, which is the assertion that
   * separates "usable" from "present". Counting roles alone would let an admin
   * demote themselves into an install nobody can administer, one click after
   * disabling the only other administrator.
   */
  it('is not rescued by a disabled second admin', async () => {
    await alsoAdmin('mara');
    await accounts.update('mara', { enabled: false });

    await expect(accounts.update('ned', { role: 'user' })).rejects.toMatchObject({
      code: 'last-admin',
    });
  });

  it('steps aside once somebody else can administer', async () => {
    await alsoAdmin('mara');

    // The guard is about the install, not about seniority: with a second usable
    // admin, demoting yourself is a legitimate thing to want.
    await accounts.update('ned', { role: 'user' });

    expect((await accounts.find('ned'))?.role).toBe('user');
  });

  it('does not fire for an ordinary account', async () => {
    await alsoUser('mara');
    await accounts.update('mara', { enabled: false });
    await accounts.remove('mara');

    expect(await accounts.find('mara')).toBeNull();
  });
});

/**
 * **Removal is a move** — [P2A §2.3], gate step 11.
 *
 * The same position `trashDestination` already takes for objects and sessions
 * ([03 §10.2]), landing somewhere else for one reason: the user's own trash is
 * *inside* the directory being removed.
 *
 * The pair that matters is the handle being free immediately while the old data
 * is not reachable through it. That is what makes the move better than either
 * erasing the folder or leaving it where it was.
 */
describe('remove', () => {
  it('takes the record out and moves the directory to data/removed', async () => {
    await alsoUser('mara');

    await accounts.remove('mara');

    expect(await accounts.find('mara')).toBeNull();
    expect(await fileExists(layout.userRoot('mara'))).toBe(false);

    const removed = await listRemoved();
    expect(removed).toHaveLength(1);
    // Suffixed, so remove-recreate-remove does not collide.
    expect(removed[0]).toMatch(/^mara-/);
  });

  it('frees the handle immediately, and the new account does not inherit the old data', async () => {
    await alsoUser('mara');
    await accounts.remove('mara');

    await accounts.create({ handle: 'mara', password: 'a new password', role: 'user' });

    // A recreated account gets a fresh directory. This is the assertion that
    // fails if `remove` ever writes the record before moving the folder and the
    // move then fails: the handle would be free with the old library still in
    // place, which is silent data inheritance and the worst outcome available.
    expect(await fileExists(layout.userRoot('mara'))).toBe(true);
    expect(await listRemoved()).toHaveLength(1);
  });

  it('removes an account whose directory is already gone', async () => {
    await alsoUser('mara');
    await rm(layout.userRoot('mara'), { recursive: true, force: true });

    await accounts.remove('mara');

    // Refusing here would trap an admin inside the broken state they are trying
    // to leave — the same argument [P2A §3] makes about a broken config file
    // not blocking the write that fixes it.
    expect(await accounts.find('mara')).toBeNull();
  });
});

describe('changePassword, and what it deliberately does not inherit', () => {
  it('replaces the password', async () => {
    await alsoUser('mara');

    await accounts.changePassword('mara', 'the next password');

    expect(await accounts.authenticate('mara', 'the next password')).not.toBeNull();
    expect(await accounts.authenticate('mara', 'a password')).toBeNull();
  });

  /**
   * **The one thing it must not inherit from `resetPassword`.**
   *
   * Re-enabling is right for break-glass — a disabled account is the same
   * lockout wearing a different hat, and until this phase nothing else could
   * clear it. It is wrong here: an admin has disabled somebody, and a password
   * change quietly undoing that would be a privilege escalation performed by
   * the self-service form.
   */
  it('leaves a disabled account disabled', async () => {
    await alsoUser('mara');
    await accounts.update('mara', { enabled: false });

    await accounts.changePassword('mara', 'the next password');

    expect((await accounts.find('mara'))?.enabled).toBe(false);
    expect(await accounts.authenticate('mara', 'the next password')).toBeNull();
  });

  it('is what resetPassword is now built from, re-enable included', async () => {
    await alsoUser('mara');
    await accounts.update('mara', { enabled: false });

    await accounts.resetPassword('mara', 'the next password');

    expect((await accounts.find('mara'))?.enabled).toBe(true);
    expect(await accounts.authenticate('mara', 'the next password')).not.toBeNull();
  });
});

/**
 * **The order is the whole of the failure design**, and it is only observable
 * when the move fails — which is why this test goes to the trouble of making it
 * fail rather than trusting the happy path, where both orders look identical.
 *
 * Record-first would mean a failed move leaves the handle free with the old data
 * still at `users/<handle>/`, so recreating the account would silently inherit
 * somebody else's library. That is the worst outcome available and an invisible
 * one. Move-first leaves an account whose directory has gone: broken, obvious,
 * and recoverable by hand.
 *
 * The failure is induced by putting a *file* where `data/removed/` needs to be a
 * directory, which makes `moveTree`'s `mkdir` throw on every platform — rather
 * than by holding a handle on the source, which only fails on Windows.
 */
describe('when the move fails', () => {
  it('leaves the account intact rather than freeing the handle', async () => {
    await alsoUser('mara');
    // `removed/` cannot be created, because a file is already sitting there.
    await writeFile(layout.removedRoot, 'not a directory');

    await expect(accounts.remove('mara')).rejects.toThrow();

    expect(await accounts.find('mara')).not.toBeNull();
    expect(await fileExists(layout.userRoot('mara'))).toBe(true);
  });
});

/**
 * ***One change at a time*** (2026-09-27).
 *
 * Every verb read the whole file, changed its copy and wrote the copy back,
 * with awaits in between, so two changes at once were decided on the same
 * read and the second write dropped the first — each answered as if it had
 * landed. The cases are the ones that cost something: a disable undone, a
 * removed account written back, an account never made, two first admins.
 *
 * Each asks for its changes together with `Promise.all`, which is what two
 * requests arriving at once look like to the store.
 */
describe('changes that arrive together', () => {
  it('keeps both of two changes to two accounts', async () => {
    await alsoUser('bob');
    await alsoUser('carol');

    await Promise.all([
      accounts.update('bob', { enabled: false }),
      accounts.update('carol', { capabilities: { privateConnections: false } }),
    ]);

    expect((await accounts.find('bob'))?.enabled).toBe(false);
    expect((await accounts.find('carol'))?.capabilities.privateConnections).toBe(false);
  });

  it('keeps a removal and a change to someone else made together', async () => {
    // Neither verb has a hash to spend first, so both read before either
    // writes: without one queue, one of them always loses.
    await alsoUser('bob');
    await alsoUser('carol');

    await Promise.all([
      accounts.remove('bob'),
      accounts.update('carol', { displayName: 'Carol R.' }),
    ]);

    expect(await accounts.find('bob')).toBeNull();
    expect((await accounts.find('carol'))?.displayName).toBe('Carol R.');
  });

  it('does not write back an account removed while its password was being set', async () => {
    // The password verb spends its scrypt first; the removal lands inside
    // that window, and the password write must look for the account after it.
    await alsoUser('bob');

    const [changed, removed] = await Promise.allSettled([
      accounts.changePassword('bob', 'a new password'),
      accounts.remove('bob'),
    ]);

    expect(removed.status).toBe('fulfilled');
    expect(changed.status).toBe('rejected');
    expect(await accounts.find('bob')).toBeNull();
    expect((await storedFile()).accounts.map((entry) => entry['handle'])).toEqual(['ned']);
  });

  it('makes both of two accounts asked for at once', async () => {
    await Promise.all([alsoUser('bob'), alsoUser('carol')]);

    expect((await accounts.list()).map((account) => account.handle).sort()).toEqual([
      'bob',
      'carol',
      'ned',
    ]);
  });

  it('makes one first admin of two setups at once', async () => {
    await mkdir(join(dataDir, 'fresh'));
    const fresh = new Accounts(new Layout(join(dataDir, 'fresh')));

    const outcomes = await Promise.allSettled([
      fresh.createFirstAdmin({ handle: 'first', password: 'a password' }),
      fresh.createFirstAdmin({ handle: 'second', password: 'a password' }),
    ]);

    expect(outcomes.filter((outcome) => outcome.status === 'fulfilled')).toHaveLength(1);
    const refused = outcomes.find((outcome) => outcome.status === 'rejected');
    expect(refused?.reason).toMatchObject({ code: 'exists' });
    expect(await fresh.count()).toBe(1);
  });
});

/**
 * ***A handle the rules refuse is the caller's mistake*** (2026-09-27): an
 * `AccountError` with the rule in it, which the routes answer as 400, rather
 * than the path guard's own error, which they answered as 500.
 */
describe('a handle that cannot be a folder', () => {
  it('is refused as invalid, saying what a handle is, and nothing is written', async () => {
    for (const handle of ['Sam', '-sam', 'sam-', 'aux', 'con', '']) {
      const refused = accounts.create({ handle, password: 'a password', role: 'user' });
      await expect(refused, JSON.stringify(handle)).rejects.toBeInstanceOf(AccountError);
      await expect(refused).rejects.toMatchObject({ code: 'invalid' });
    }
    expect(await accounts.count()).toBe(1);
  });
});
