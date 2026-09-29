// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { lookup } from 'node:dns/promises';
import { createServer, isIP } from 'node:net';
import { networkInterfaces } from 'node:os';
import { join, resolve } from 'node:path';

import { type Config, isLoopbackHost } from './config.js';
import { readFileBytes } from './storage/files.js';

/**
 * ***Would the next start come up?*** — asked of a config before it is written
 * (2026-09-27).
 *
 * The settings write validated a document against the schema and called the
 * result *a file the process can start on, by construction*. The schema knows
 * a port is a number between 1 and 65535; it does not know whether this
 * machine has the address, whether something else holds the port, whether a
 * client root has a build in it, or whether the browser will send a `Secure`
 * cookie back over plain HTTP. Each of those saved cleanly and then, at the
 * next start, either stopped the server starting at all, over and over under a
 * supervisor that restarts it, or started it where nobody could reach it or
 * sign in to put it back. The only repair was a shell and a text editor.
 *
 * **Only keys whose value differs from the one this process started with**:
 * that value is known to work, because this process is running on it. And
 * only the four whose failure is a start that cannot be undone from the
 * settings page, which are the deployment half of `server`.
 */

/** What checking needs from the machine, as seams a test can hold. */
export interface StartableSeams {
  /**
   * Listens where a start would, and lets go at once. Rejects with the error
   * a start would meet (`EADDRINUSE`, `EACCES`, `EADDRNOTAVAIL`).
   */
  trialListen: (host: string, port: number) => Promise<void>;
  /** Every address this machine answers on. */
  localAddresses: () => string[];
  /** The address a start would bind for a name, as `listen` resolves it. */
  resolveHost: (name: string) => Promise<string>;
}

export const MACHINE: StartableSeams = {
  trialListen,
  localAddresses: () =>
    Object.values(networkInterfaces())
      .flat()
      .flatMap((entry) => (entry === undefined ? [] : [entry.address])),
  resolveHost: async (name) => (await lookup(name)).address,
};

/**
 * The problems a start on `next` would meet that `boot` did not, one sentence
 * each in the schema errors' own `pointer message` shape.
 *
 * `secure` is whether the request asking for this reached the server over
 * HTTPS; `forwardedSecure` is whether it says it did through a proxy, which
 * only counts when `next` trusts proxies. An import passes both false, and
 * never carries the key they are for.
 */
export async function unstartable(
  boot: Config,
  next: Config,
  context: { secure: boolean; forwardedSecure: boolean; seams: StartableSeams },
): Promise<string[]> {
  const issues: string[] = [];
  const before = boot.server;
  const after = next.server;

  if (after.clientRoot !== before.clientRoot) {
    if (after.clientRoot === '' && before.clientRoot !== '') {
      issues.push(
        '/server/clientRoot cannot be emptied while this server is serving the app: ' +
          'the next start would serve no page to change it back from',
      );
    } else if (after.clientRoot !== '' && (await clientBuildMissing(after.clientRoot))) {
      issues.push(`/server/clientRoot has no index.html in it: ${resolve(after.clientRoot)}`);
    }
  }

  let hostUsable = true;
  if (after.host !== before.host) {
    const problem = await hostProblem(after.host, context.seams);
    if (problem !== null) {
      hostUsable = false;
      issues.push(`/server/host ${problem}`);
    }
  }

  /**
   * ***Only a port that changes is tried.*** The one this process holds would
   * refuse its own trial: `0.0.0.0:8080` cannot be taken while this process
   * listens on `127.0.0.1:8080`, so a host-only change would be refused for a
   * conflict with itself.
   */
  if (after.port !== before.port && hostUsable) {
    try {
      await context.seams.trialListen(after.host, after.port);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code ?? 'an error';
      issues.push(`/server/port ${String(after.port)} cannot be listened on here (${code})`);
    }
  }

  /**
   * ***A `Secure` cookie is never sent back over plain HTTP***, so turning it on
   * from a page reached over HTTP signs everybody out for good, the person
   * doing it included, and the browser says nothing about why. Turned on in the
   * same save as `trustProxy`, the proxy's own word counts, because it is the
   * word the next start will take.
   */
  if (after.cookieSecure && !before.cookieSecure) {
    const secure = context.secure || (after.trustProxy && context.forwardedSecure);
    if (!secure) {
      issues.push(
        '/server/cookieSecure can only be turned on from a page reached over HTTPS: ' +
          'a Secure cookie is not sent back over plain HTTP, so nobody could sign in',
      );
    }
  }

  return issues;
}

/**
 * Whether a client root lacks the build it is supposed to hold — the check the
 * boot makes, shared so a save cannot write a root the boot would refuse.
 */
export async function clientBuildMissing(root: string): Promise<boolean> {
  return (await readFileBytes(join(resolve(root), 'index.html'))) === null;
}

/**
 * Why a start could not bind `host`, or null if it could. The wildcards and
 * loopback always can; an address must be one of this machine's; a name must
 * resolve, here, to an address that is.
 */
async function hostProblem(host: string, seams: StartableSeams): Promise<string | null> {
  if (isWildcard(host) || isLoopbackHost(host)) return null;

  let address = host.replace(/^\[/, '').replace(/\]$/, '');
  if (isIP(address) === 0) {
    try {
      address = await seams.resolveHost(address);
    } catch {
      return `${host} does not resolve to an address on this machine`;
    }
    if (isWildcard(address) || isLoopbackHost(address)) return null;
  }

  const local = new Set(seams.localAddresses().map((one) => one.toLowerCase()));
  return local.has(address.toLowerCase())
    ? null
    : `${host} is not an address this machine has, so the next start could not listen on it`;
}

function isWildcard(host: string): boolean {
  return host === '0.0.0.0' || host === '::' || host === '[::]' || host === '';
}

/** The real trial: listen, then close, reporting what listening met. */
function trialListen(host: string, port: number): Promise<void> {
  return new Promise((done, failed) => {
    const server = createServer();
    server.once('error', failed);
    server.listen({ host, port, exclusive: true }, () => {
      server.close(() => {
        done();
      });
    });
  });
}
