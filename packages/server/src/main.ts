// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { resolve } from 'node:path';

import { buildApp, buildServices, disposeServices } from './app.js';
import { AccountError, Accounts } from './auth/accounts.js';
import { readNewPassword, ResetAborted } from './auth/reset.js';
import { loadConfig } from './config.js';
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

  const { config, fileFound, unknownKeys } = await loadConfig(configPath);
  if (dataDirArgument) config.dataDir = dataDirArgument;

  // The break-glass path: reset a password from the console and exit, without
  // starting the server. Host access is the authority — see
  // Accounts.resetPassword for the argument, and the README for when to reach
  // for this rather than asking an admin (P10's norm).
  const resetHandle = argumentValue('--reset-password');
  if (resetHandle !== undefined) {
    await resetPassword(resetHandle, new Layout(config.dataDir));
    return;
  }

  const services = await buildServices({ config });
  const app = await buildApp(services);

  // Said after the logger exists rather than before, so that everything this
  // process reports goes through one mechanism ([13 §4.1]) — including the
  // config path, which is the first thing anyone asks when a setting does not
  // seem to be taking effect.
  app.log.info({ configPath, fileFound }, fileFound ? 'Config loaded' : 'No config file; defaults');
  if (unknownKeys.length > 0) {
    // Kept, not rejected — but said out loud, because a typo'd key is silently
    // doing nothing and that is worth one line.
    app.log.warn({ unknownKeys }, 'Config: ignoring unrecognised keys');
  }

  await app.listen({ host: config.server.host, port: config.server.port });

  const loopback = config.server.host === '127.0.0.1' || config.server.host === 'localhost';
  app.log.info(
    {
      url: `http://${config.server.host}:${String(config.server.port)}`,
      dataRoot: services.layout.dataRoot,
    },
    'StoryEngine listening',
  );

  if (await services.accounts.needsSetup()) {
    if (loopback) {
      app.log.info('No accounts yet. Open the address above to create the first admin.');
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
