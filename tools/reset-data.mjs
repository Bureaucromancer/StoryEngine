// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { rename, rm, stat } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';

/**
 * Removes a data directory, or removes nothing — F31.
 *
 * **`rm -rf` on a live data directory half-succeeds, and the half that survives
 * is the wrong half.** Measured: everything unlocked goes, and both SQLite
 * stores stay — including `state/`, which
 * [22 §5.1](../docs/design/22-internal-contracts.md) says is the authoritative one and
 * explicitly *not* disposable. Its own signing key, a plain file beside it, is
 * deleted. So the store survives without the key that validates the sessions
 * inside it, `config.json` goes and the next start silently reverts to the
 * default port and data root, and a tester who believes they started from
 * nothing did not.
 *
 * That is the failure this exists to make impossible, and it is worth more than
 * a documented procedure: a procedure has to be remembered at the exact moment
 * somebody is annoyed and in a hurry.
 *
 * **Rename first, delete second.** A rename of the root is one operation the
 * filesystem either performs or refuses. If a server holds a file open, Windows
 * refuses it and nothing has been touched — so the failure mode is *nothing
 * happened, here is why* rather than *some of it happened, good luck*. On POSIX
 * the rename succeeds and the deletion proceeds, which is also correct: a
 * process holding a descriptor there is holding an unlinked file, not a live
 * directory, and the next start builds a clean one.
 *
 * Not a test helper. Tests use their own temporary directories and never this.
 */

const RESERVED = new Set(['/', '.', '..']);

async function main() {
  const argv = process.argv.slice(2);
  if (argv.includes('--help') || argv.includes('-h')) {
    usage();
    return;
  }

  const at = resolve(valueOf(argv, '--data') ?? './data');

  if (RESERVED.has(at) || dirname(at) === at) {
    fail(`Refusing to remove ${at}. That is not a data directory.`);
  }

  const there = await stat(at).catch(() => null);
  if (there === null) {
    console.log(`Nothing at ${at}. Nothing to remove.`);
    return;
  }
  if (!there.isDirectory()) {
    fail(`${at} is not a directory.`);
  }

  // Named so a leftover is recognisable rather than mysterious, and beside the
  // original so the rename stays on one volume — a cross-device rename is a
  // copy, which is exactly the non-atomic thing this avoids.
  const parked = join(dirname(at), `${basename(at)}.removing`);
  await rm(parked, { recursive: true, force: true });

  try {
    await rename(at, parked);
  } catch (error) {
    const code = (error && typeof error === 'object' && 'code' in error && error.code) || '';
    if (code === 'EBUSY' || code === 'EPERM' || code === 'EACCES') {
      fail(
        `${at} is in use, so nothing was removed.\n` +
          `Stop the server first — a half-removed data directory keeps its SQLite\n` +
          `stores and loses everything else, which is worse than not removing it.`,
      );
    }
    throw error;
  }

  await rm(parked, { recursive: true, force: true });
  console.log(`Removed ${at}.`);
}

/**
 * The inverse procedure, printed rather than implemented.
 *
 * Copying a live directory is not the mirror of this problem — it produces a
 * copy that *works*, which is why nobody notices they took one mid-write. The
 * `-wal` and `-shm` files carry committed transactions the main file does not
 * have yet, so a copy without them is a copy of an older database.
 */
function usage() {
  console.log(
    [
      'Usage: node tools/reset-data.mjs [--data <dir>]',
      '',
      'Removes a data directory completely, or refuses and removes nothing.',
      'Stop the server first.',
      '',
      'To keep one instead of removing it — for a finding worth reproducing:',
      '  1. stop the server',
      '  2. copy the whole directory, including the -wal and -shm files',
      '',
      'index/ is derived and rebuilds on the next start. state/, accounts.json',
      'and users/ are not, and state/session.key is what validates the sessions',
      'inside state.sqlite — a copy missing it logs everybody out.',
    ].join('\n'),
  );
}

function valueOf(argv, flag) {
  const index = argv.indexOf(flag);
  if (index === -1) return undefined;
  const value = argv[index + 1];
  if (value === undefined || value.startsWith('--')) {
    fail(`${flag} needs a value.`);
  }
  return value;
}

function fail(message) {
  console.error(message);
  process.exit(1);
}

await main();
