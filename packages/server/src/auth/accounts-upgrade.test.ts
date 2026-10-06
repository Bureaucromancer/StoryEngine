// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { createHash } from 'node:crypto';
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { Layout } from '../storage/layout.js';
import { Accounts } from './accounts.js';

/**
 * ***An `accounts.json` an earlier build wrote still starts the server***
 * (2026-10-06).
 *
 * **This is the one store that refuses to start on a file it cannot read**,
 * and says why at `Accounts.#read`: a server that cannot tell who anyone is
 * should not carry on as nobody. That makes every change to the record's
 * shape a question about every install already running, and nothing asked
 * it. Every test in `accounts.test.ts` builds its file with the code under
 * test, so the file and the schema always agree, and a change that bricks
 * every existing install leaves the suite green.
 *
 * ***Which is what happened.*** [P12.4](../../../../docs/design/workplan/29-p12-implementation.md)
 * (`a45c01ba`) made `capabilities.scheduledBackups` required. The validator
 * runs with `useDefaults` off, so the schema's `default: false` fills nothing,
 * and every file written before it, by every tagged release from alpha 1 to
 * alpha 4, is refused: *"is not a valid accounts file. Refusing to start
 * rather than guess."* The development install found it, with an account file
 * a month old. The comment on `hiddenFromGallery` had already said it in so
 * many words: *a required field would brick every existing install on
 * upgrade.*
 *
 * ***Not migrated, and that is a decision rather than an omission.*** There are
 * too few long-lived installs for a migration to be worth carrying; each takes
 * a one-line hand edit (`"scheduledBackups": false` in each account's
 * `capabilities`). So **the floor this file holds starts at P12.4's shape**,
 * and the point of it is that the next time the floor moves, somebody decides
 * to move it.
 *
 * **What a fixture here is.** A file this store wrote through its own verbs
 * (`createFirstAdmin`, `create`, `update`, `updateSelf`) at the commit its name
 * gives, copied out byte for byte. Never written by hand, because a
 * hand-written file holds what its author thought the store writes. The three
 * accounts are chosen to cover every way a record can differ: an admin and two
 * users, a string and a null `locale`, `hiddenFromGallery` both present and
 * absent, a disabled account, and every capability moved off its default by
 * someone.
 *
 * - **When the shape changes**, add a fixture written by the new code, and
 *   keep the old one. The old one is the install that has not upgraded yet.
 * - **Never edit a fixture to make this test pass.** That is the bug this
 *   test exists to catch, done to the test, and {@link PINNED} is there so
 *   that doing it is two edits and a message rather than one quiet one.
 * - **Remove one only to raise the floor on purpose**, and say here what an
 *   install on that shape has to do, the way the paragraph above does.
 */

/**
 * ***Each fixture, pinned by a hash of its parsed content, with the passwords
 * it was written with.***
 *
 * The hash is over `JSON.stringify(JSON.parse(text))` rather than the bytes,
 * so a formatter or a line-ending pass cannot trip it and a changed value
 * always does.
 *
 * The passwords are test values and nothing else: the fixture holds only their
 * scrypt hashes. They are here because a password is part of the file's
 * compatibility and the schema cannot see it. `verifyPassword` uses the salt's
 * hex *string* as the salt, not the bytes it spells, and asks for a key as
 * long as the stored hash. A change to either one passes every test that
 * hashes and verifies with the same code, and then locks every existing
 * account out of a server that starts perfectly well.
 */
const PINNED: Record<string, { sha256: string; passwords: Record<string, string> }> = {
  'written-by-1fc232b1.json': {
    sha256: 'aa5d1cca898eba98f5ac275c97373387d85008c9f4983f5c935880fd9a60b2a7',
    passwords: {
      ada: 'ada set this before the change',
      bea: 'bea set this before the change',
      // Disabled, so authenticate refuses it whatever the password. Kept
      // because the test checks that this answer is null too.
      cal: 'cal set this before the change',
    },
  },
};

const FIXTURES = join(import.meta.dirname, 'fixtures', 'accounts');

let dataDir: string;

beforeEach(async () => {
  dataDir = await mkdtemp(join(tmpdir(), 'se-accounts-upgrade-'));
});

afterEach(async () => {
  await rm(dataDir, { recursive: true, force: true });
});

/** A store over a data directory whose `accounts.json` is the fixture's bytes. */
async function installFrom(name: string): Promise<{ accounts: Accounts; text: string }> {
  const text = await readFile(join(FIXTURES, name), 'utf8');
  const layout = new Layout(dataDir);
  await writeFile(layout.accountsFile, text);
  return { accounts: new Accounts(layout), text };
}

describe('the fixtures', () => {
  it('are exactly the files pinned here, each unchanged since it was written', async () => {
    // A file dropped into the directory without a row here would never be
    // loaded below, because the cases come from the table, not the directory.
    const onDisk = (await readdir(FIXTURES)).sort();
    expect(onDisk).toEqual(Object.keys(PINNED).sort());

    for (const [name, { sha256 }] of Object.entries(PINNED)) {
      const text = await readFile(join(FIXTURES, name), 'utf8');
      const actual = createHash('sha256')
        .update(JSON.stringify(JSON.parse(text)))
        .digest('hex');
      expect(
        actual,
        `${name} has changed since it was written. A fixture is a file an install wrote. ` +
          'If the schema no longer reads it, that is a break for every install on that shape; ' +
          'see the comment at the top of accounts-upgrade.test.ts before touching either.',
      ).toBe(sha256);
    }
  });
});

describe.each(Object.keys(PINNED))('an accounts.json %s', (name) => {
  const { passwords } = PINNED[name]!;

  it('starts the server, reading every account it holds', async () => {
    const { accounts, text } = await installFrom(name);

    // `needsSetup` is the first thing `main.ts` asks, and where the
    // development install stopped: it reads the whole file through the
    // validator, so a record the schema no longer accepts throws here.
    expect(await accounts.needsSetup()).toBe(false);

    const written = (JSON.parse(text) as { accounts: { handle: string }[] }).accounts;
    expect((await accounts.list()).map((account) => account.handle)).toEqual(
      written.map((account) => account.handle),
    );
  });

  it('signs in everyone enabled with the password they set, and nobody with another', async () => {
    const { accounts } = await installFrom(name);

    const listed = await accounts.list();
    // Every account in the file has a password here, so none is skipped.
    expect(Object.keys(passwords).sort()).toEqual(listed.map((account) => account.handle).sort());

    for (const account of listed) {
      const password = passwords[account.handle]!;
      const signedIn = await accounts.authenticate(account.handle, password);
      expect(signedIn?.handle ?? null, account.handle).toBe(
        account.enabled ? account.handle : null,
      );
      // Without this a verifier that said yes to everything would pass.
      expect(
        await accounts.authenticate(account.handle, `${password}!`),
        account.handle,
      ).toBeNull();
    }
  });
});
