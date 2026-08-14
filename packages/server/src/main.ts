// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { resolve } from 'node:path';

import { buildApp, buildServices } from './app.js';
import { generateSetupToken } from './auth/secrets.js';
import { loadConfig } from './config.js';
import { Layout } from './storage/layout.js';

/**
 * The entry point.
 *
 * Everything interesting is elsewhere; this exists to read the config, start
 * the listener, and say the two things a first-time operator needs to hear —
 * where the server is, and whether it is exposed.
 *
 * Log output is developer-facing and deliberately untranslated
 * ([07 §12.7](docs/design/07-tech-stack.md)).
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

  console.log(
    fileFound ? `Config: ${configPath}` : `Config: none at ${configPath}, using defaults`,
  );
  if (unknownKeys.length > 0) {
    // Kept, not rejected — but said out loud, because a typo'd key is silently
    // doing nothing and that is worth one line.
    console.warn(`Config: ignoring unrecognised keys: ${unknownKeys.join(', ')}`);
  }

  const services = await buildServices({ config });
  const app = await buildApp(services);

  await app.listen({ host: config.server.host, port: config.server.port });

  const loopback = config.server.host === '127.0.0.1' || config.server.host === 'localhost';
  console.log(
    `StoryEngine listening on http://${config.server.host}:${String(config.server.port)}`,
  );
  console.log(`Data directory: ${services.layout.dataRoot}`);

  if (await services.accounts.needsSetup()) {
    if (loopback) {
      console.log('No accounts yet. Open the address above to create the first admin.');
    } else {
      // **The claim window.** Bound beyond loopback with no admin, anyone who
      // can reach the port can claim the install
      // ([04 §5.1](docs/design/04-server-multiuser-deployment.md)). The console
      // is the one channel only someone with host access can read — `docker
      // logs` is exactly the audience — so the token goes here.
      //
      // Printed but not yet *enforced*: wiring it into the setup route is a
      // P10 item alongside the rest of deployment. Until then this is a warning
      // rather than a gate, and saying so is better than implying otherwise.
      console.warn('');
      console.warn(`  ⚠ Bound to ${config.server.host} with no admin account yet.`);
      console.warn('    Anyone who can reach this port can claim this install.');
      console.warn(`    Setup token (not yet enforced — see 04 §5.1): ${generateSetupToken()}`);
      console.warn('');
    }
  }

  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.once(signal, () => {
      void shutdown();
    });
  }

  async function shutdown(): Promise<void> {
    console.log('\nShutting down.');
    await app.close();
    await services.watcher?.stop();
    services.index.close();
    process.exit(0);
  }
}

function argumentValue(flag: string): string | undefined {
  const index = process.argv.indexOf(flag);
  return index === -1 ? undefined : process.argv[index + 1];
}

await main();
