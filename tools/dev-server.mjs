// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { spawn } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Runs the server as its own process, and keeps its log — [P2C §1.3].
 *
 * **The log had no destination.** [22 §4.1](../docs/design/22-internal-contracts.md)
 * refuses a file transport and refuses a pretty one on purpose — the log is
 * JSON on stdout, and something else's job is to put it somewhere. Nothing was
 * that something else, so *every failure was findable in the log from its
 * session id* was a step [P2C §4](../docs/design/workplan/12-p2c-first-real-run.md)
 * wrote and could not perform.
 *
 * **And the documented way to run it made the log unreadable.** `pnpm dev`
 * multiplexes both packages through pnpm's recursive reporter, which prefixes
 * every line with `packages/server dev: ` — so each record is a string that
 * starts with a package name and then happens to contain JSON. Measured, not
 * assumed: `jq` reads nothing, and neither does anything else.
 *
 * So: one process, no reporter in front of it, and stdout written to a dated
 * file **as well as** to the terminal. Both halves matter. A redirect alone
 * takes the server's output away from the person running it, who needs to see
 * it; a terminal alone leaves nothing to search afterwards, and the whole point
 * of a manual phase is what you can say about it a day later.
 *
 * Not a replacement for `pnpm dev` — that runs the client too, and during
 * ordinary work the prefixes are a feature. This is for a session whose log is
 * evidence.
 */

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SERVER = join(ROOT, 'packages', 'server');

async function main() {
  const argv = process.argv.slice(2);
  if (argv.includes('--help') || argv.includes('-h')) {
    usage();
    return;
  }

  const logDir = resolve(ROOT, take(argv, '--log-dir') ?? 'logs');
  await mkdir(logDir, { recursive: true });

  /**
   * Sortable, second-resolution, and legal as a filename on Windows — which
   * rules out the colons in an ISO string, and is why this is not `toISOString`
   * with a `slice`.
   */
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').replace(/Z$/, '');
  const logFile = join(logDir, `server-${stamp}.log`);
  const sink = createWriteStream(logFile, { flags: 'a' });

  // Said on stderr, so it is not itself a line in the captured log.
  process.stderr.write(`Logging to ${logFile}\n`);

  /**
   * `--data` defaults here rather than in the package script, because the
   * package script hardcodes it and then refuses a second one — passing
   * `--data` to `pnpm dev:server` is answered with *given more than once*,
   * which makes a scratch install impossible by the documented route.
   *
   * **And a relative one is resolved here, against the directory the person
   * typed it in.** The server runs with its working directory in
   * `packages/server`, so `--data ./scratch` used to mean
   * `packages/server/scratch` — while `pnpm reset-data --data ./scratch`, run
   * from the same prompt a second earlier, means `./scratch`. Two commands, one
   * argument, two directories, and nothing says so: the person resets one
   * install and runs against another. Measured before it was fixed.
   */
  const args = ['--import', 'tsx', join(SERVER, 'src', 'main.ts')];
  const at = argv.indexOf('--data');
  if (at === -1) {
    args.push('--data', join(ROOT, 'data'));
  } else if (argv[at + 1] !== undefined) {
    argv[at + 1] = resolve(argv[at + 1]);
  }

  /**
   * **Capture is on by default here, and only here** — [P2C §2.2]. This is the
   * designated evidence-session tool, and a recorder that had to be remembered
   * is a corpus with holes in it: the exchanges the phase exists to capture
   * happen exactly once. The directory shares the log file's stamp, so a
   * session's log and its cassettes correlate by name. `--no-capture` turns it
   * off; a `--capture` of your own wins, resolved against this prompt the same
   * way `--data` is and for the same measured reason.
   */
  const noCapture = argv.indexOf('--no-capture');
  if (noCapture !== -1) argv.splice(noCapture, 1);
  const captureAt = argv.indexOf('--capture');
  if (captureAt !== -1 && argv[captureAt + 1] !== undefined) {
    argv[captureAt + 1] = resolve(argv[captureAt + 1]);
  } else if (noCapture === -1) {
    args.push('--capture', join(ROOT, 'captures', stamp));
  }
  if (noCapture === -1 || captureAt !== -1) {
    const dir = captureAt !== -1 ? argv[captureAt + 1] : join(ROOT, 'captures', stamp);
    process.stderr.write(`Capturing provider exchanges to ${dir} (--no-capture to disable)\n`);
  }

  const child = spawn(process.execPath, [...args, ...argv], {
    cwd: SERVER,
    stdio: ['inherit', 'pipe', 'pipe'],
  });

  // Tee, byte for byte. No line splitting and no re-encoding: a record this
  // process reassembled is a record it could get wrong, and the file is
  // supposed to be what the server wrote.
  child.stdout.pipe(sink, { end: false });
  child.stdout.pipe(process.stdout, { end: false });
  child.stderr.pipe(sink, { end: false });
  child.stderr.pipe(process.stderr, { end: false });

  /**
   * **Forwarded and then waited for** — the same lesson `reset-data.mjs`
   * exists to enforce. Ctrl-C reaches the whole process group on POSIX but not
   * on Windows, and a parent that exited first would leave the server holding
   * the SQLite files while the person who pressed it starts deleting things.
   */
  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.on(signal, () => {
      child.kill(signal);
    });
  }

  const code = await new Promise((settle) => {
    child.once('exit', (status) => settle(status ?? 0));
  });
  await new Promise((settle) => sink.end(settle));
  process.exitCode = code;
}

function usage() {
  console.log(
    [
      'Usage: node tools/dev-server.mjs [--log-dir <dir>] [--no-capture] [server args…]',
      '',
      'Runs the server on its own, with stdout copied to a dated file as well as',
      'to the terminal. Use this when the log is evidence: `pnpm dev` puts',
      "pnpm's recursive reporter in front of the server and prefixes every line,",
      'which leaves the JSON unparseable by anything.',
      '',
      'Everything after the flags above goes to the server, so `--data <dir>`',
      'works here. Logs land in ./logs and provider exchanges are recorded to',
      './captures/<same stamp> by default — pass --no-capture to turn that off.',
      'Neither directory is committed.',
    ].join('\n'),
  );
}

/** Reads a flag's value and removes both from the list passed on to the server. */
function take(argv, flag) {
  const index = argv.indexOf(flag);
  if (index === -1) return undefined;
  const value = argv[index + 1];
  if (value === undefined || value.startsWith('--')) {
    console.error(`${flag} needs a value.`);
    process.exit(1);
  }
  argv.splice(index, 2);
  return value;
}

await main();
