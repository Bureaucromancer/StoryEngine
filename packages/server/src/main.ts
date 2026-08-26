// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { resolve } from 'node:path';

import { buildApp, buildServices, disposeServices } from './app.js';
import { AccountError, Accounts } from './auth/accounts.js';
import { readNewPassword, ResetAborted } from './auth/reset.js';
import { loadConfig, type Config } from './config.js';
import { Layout } from './storage/layout.js';

/**
 * The entry point.
 *
 * Everything interesting is elsewhere; this exists to read the config, start
 * the listener, and say the two things a first-time operator needs to hear —
 * where the server is, and whether it is exposed.
 *
 * **Server output goes through the logger** ([13 §4.1]), which is why the
 * startup lines come after `buildApp` rather than before it: one mechanism, one
 * format, one level to turn down. The exception is `--reset-password`, which
 * talks to a person at a terminal and returns before any of this exists —
 * a prompt and its answer are a conversation, not a log.
 *
 * Log output is developer-facing and deliberately untranslated
 * ([07 §12.7](../../../docs/design/07-tech-stack.md)).
 */

async function main(): Promise<void> {
  // The config path is derived from the data directory, and the data directory
  // can only come from the config — so the bootstrap reads from the default
  // location unless told otherwise. `--data` covers the container case without
  // needing a config file at all.
  const dataDirArgument = argumentValue('--data');
  const configPath = resolve(
    argumentValue('--config') ?? new Layout(dataDirArgument ?? './data').configFile,
  );

  const { config, fileFound, unknownKeys, document } = await loadConfig(configPath);
  if (dataDirArgument) config.dataDir = dataDirArgument;

  /**
   * Record every provider exchange into this directory — [P2C §2.2]. A flag
   * and deliberately not a config key: a dev-only recording toggle in every
   * operator's settings form is noise, and the phase's standing line — P2C
   * adds exactly one key — stays true. `argumentValue` already refuses a
   * duplicate or valueless flag (F24), so nothing new to guard here.
   */
  const captureDir = argumentValue('--capture');

  // The break-glass path: reset a password from the console and exit, without
  // starting the server. Host access is the authority — see
  // Accounts.resetPassword for the argument, and the README for when to reach
  // for this rather than asking an admin (P10's norm).
  const resetHandle = argumentValue('--reset-password');
  if (resetHandle !== undefined) {
    await resetPassword(resetHandle, new Layout(config.dataDir));
    return;
  }

  // The path travels with the config, so the settings route writes back to the
  // file this process actually read ([P2A §2.5]).
  const services = await buildServices({
    config,
    configPath,
    configDocument: document,
    ...(captureDir === undefined ? {} : { captureDir: resolve(captureDir) }),
  });
  const app = await buildApp(services);

  // Said after the logger exists rather than before, so that everything this
  // process reports goes through one mechanism ([13 §4.1]) — including the
  // config path, which is the first thing anyone asks when a setting does not
  // seem to be taking effect.
  //
  // **A missing file is `warn`, not `info`** — finding 9 in [16]. It is an
  // ordinary state on a first boot and an alarming one on every boot after: a
  // teardown that took `config.json` reverts the port and the data root to
  // their defaults, and the smoke run watched that revert announce itself in
  // the same voice as "everything is fine". A person who chose no config file
  // reads one `warn` per start; a person who lost theirs reads the one line
  // that says why the server is not where they left it.
  if (fileFound) {
    app.log.info({ configPath, fileFound }, 'Config loaded');
  } else {
    app.log.warn({ configPath, fileFound }, 'No config file; running on defaults');
  }
  if (unknownKeys.length > 0) {
    // Kept, not rejected — but said out loud, because a typo'd key is silently
    // doing nothing and that is worth one line.
    app.log.warn({ unknownKeys }, 'Config: ignoring unrecognised keys');
  }
  if (captureDir !== undefined) {
    // `warn`, because it is a privacy-relevant mode: a cassette carries the
    // whole rendered prompt, which is the user's prose. The brief's advice is
    // to record against the seeded fixtures, and this line is where somebody
    // discovers a mode they forgot was on.
    app.log.warn(
      { captureDir: resolve(captureDir) },
      'Capturing provider exchanges — cassettes contain the full rendered prompt',
    );
  }

  await app.listen({ host: config.server.host, port: config.server.port });

  const loopback = config.server.host === '127.0.0.1' || config.server.host === 'localhost';
  /**
   * **The API's address, said as the API's address.**
   *
   * This called it `url` and the line below told an operator to *open the
   * address above*, which is wrong in development: the server serves no static
   * files, so opening it gets a 404 and the client is on Vite's port. It is the
   * first instruction a new install gives and it sent people to a blank page.
   *
   * Named `api` rather than `url` because that is what it is — and the setup
   * line below now names the client's address instead of pointing upward.
   */
  app.log.info(
    {
      api: `http://${config.server.host}:${String(config.server.port)}`,
      dataRoot: services.layout.dataRoot,
    },
    'StoryEngine listening',
  );

  // Only when it did something. A restart that interrupted nothing should not
  // print a line about turns — but one that finalised a turn the last process
  // was in the middle of should say so, because the user will see a failed turn
  // in their session and deserves to know why ([P2 §2.10]).
  const { finalised, abandoned } = services.reconciliation;
  if (finalised.length > 0 || abandoned.length > 0) {
    app.log.info(
      { finalised: finalised.length, abandoned: abandoned.length },
      'Recovered turns interrupted by the last shutdown',
    );
  }

  if (await services.accounts.needsSetup()) {
    if (loopback) {
      /**
       * **The client's address, not this one.** In development they are two
       * processes on two ports and the API serves no UI; in a packaged build
       * they are the same origin and this is still right.
       */
      app.log.info(
        { open: clientAddress(config) },
        'No accounts yet. Open this address to create the first admin.',
      );
    } else {
      // **The claim window.** Bound beyond loopback with no admin, anyone who
      // can reach the port can claim the install
      // ([04 §5.1](../../../docs/design/04-server-multiuser-deployment.md)).
      //
      // The token that is supposed to close it is **not printed here** (F10).
      // It used to be — freshly generated on every boot, stored nowhere, and
      // checked by nothing, which is the worst version: an operator who reads
      // "setup token" in a console reasonably concludes something is enforcing
      // it. The warning is true; the token was not. It lands with the container
      // image that needs it, at P10.
      app.log.warn(
        { host: config.server.host },
        'Bound beyond loopback with no admin account yet — anyone who can reach this port can claim this install',
      );
    }
  }

  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.once(signal, () => {
      void shutdown();
    });
  }

  async function shutdown(): Promise<void> {
    app.log.info('Shutting down.');
    await app.close();
    await disposeServices(services);
    process.exit(0);
  }
}

/**
 * The value after a flag, or undefined when the flag is absent.
 *
 * **A flag with no value is an error, not an absence** (F24). `--reset-password`
 * as the final argument used to read as `undefined`, which is indistinguishable
 * from not passing it — so the guard fell through and *the server booted*,
 * having reset nothing, in front of someone who had just typed a password-reset
 * command. The same shape would have made `--data` silently use `./data`.
 *
 * Another flag counts as missing rather than as a value: `--data
 * --reset-password ned` should not name a directory `--reset-password`.
 */
class UsageError extends Error {}

function argumentValue(flag: string): string | undefined {
  const index = process.argv.indexOf(flag);
  if (index === -1) return undefined;

  /**
   * **A flag given twice is an error, not a first-one-wins race.** F24's
   * sibling, and found the same way: `pnpm dev:server` already passes
   * `--data ../../data`, and pnpm *appends* extra arguments rather than
   * replacing them — so `pnpm dev:server --data ./scratch` ran against
   * `../../data` and said nothing. Somebody testing against a scratch
   * directory was testing against their real one.
   *
   * Neither silent answer is defensible. Taking the first ignores what was
   * typed most recently; taking the last ignores that the earlier one may have
   * been deliberate. Refusing is the only reading that cannot be wrong about
   * which directory somebody meant.
   */
  if (process.argv.slice(index + 1).includes(flag)) {
    throw new UsageError(`${flag} was given more than once.`);
  }

  const value = process.argv[index + 1];
  if (value === undefined || value.startsWith('--')) {
    throw new UsageError(`${flag} needs a value.`);
  }
  return value;
}

/**
 * `--reset-password <handle>` — asks for the new password on stdin (masked at
 * a terminal, a plain line from a pipe; never an argument, which would leak
 * into shell history), writes it through the same scrypt-and-atomic-write
 * machinery as setup, and exits.
 */
async function resetPassword(handle: string, layout: Layout): Promise<void> {
  const accounts = new Accounts(layout);
  try {
    const password = await readNewPassword(process.stdin, process.stdout, handle);
    const account = await accounts.resetPassword(handle, password);
    console.log(`Password reset for ${account.handle} in ${layout.dataRoot}.`);
    console.log(
      'The account is enabled. A running server picks this up on the next login; ' +
        'existing sessions for the account stay valid until they expire.',
    );
  } catch (error) {
    if (error instanceof ResetAborted || error instanceof AccountError) {
      console.error(error.message);
      process.exitCode = 1;
      return;
    }
    throw error;
  }
}

try {
  await main();
} catch (error) {
  if (!(error instanceof UsageError)) throw error;
  // Before the logger exists, and addressed to whoever typed the command.
  console.error(error.message);
  process.exit(1);
}

/**
 * Where a person should point a browser.
 *
 * In development the client is served by Vite on its own port and proxies
 * `/api` back here, so the API's address serves nothing a person wants. There is
 * no packaged build yet — when there is, this collapses to the API's address and
 * the environment variable goes.
 */
function clientAddress(config: Config): string {
  const port = process.env['SE_CLIENT_PORT'] ?? '5173';
  return `http://${config.server.host}:${port}`;
}
