// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { createServer, type Server } from 'node:net';

import { afterEach, expect, it } from 'vitest';

import { MACHINE } from './startable.js';

/**
 * ***The real trial listen*** (2026-09-27) — the one seam every route test
 * replaces, because a real one binds a real port. Here it binds one, on
 * purpose: held by this test, then free.
 */
let holder: Server | null = null;

afterEach(async () => {
  await new Promise<void>((done) => {
    if (holder === null) done();
    else
      holder.close(() => {
        done();
      });
  });
  holder = null;
});

async function hold(): Promise<number> {
  holder = createServer();
  const listening = holder;
  await new Promise<void>((done) => listening.listen({ host: '127.0.0.1', port: 0 }, done));
  const address = listening.address();
  if (address === null || typeof address === 'string') throw new Error('no port');
  return address.port;
}

it('refuses a port something else holds, with the error a start would meet', async () => {
  const port = await hold();

  await expect(MACHINE.trialListen('127.0.0.1', port)).rejects.toMatchObject({
    code: 'EADDRINUSE',
  });
});

it('takes a port nothing holds, and lets it go', async () => {
  const port = await hold();
  await new Promise<void>((done) => {
    holder?.close(() => {
      done();
    });
  });
  holder = null;

  await MACHINE.trialListen('127.0.0.1', port);
  // Let go: the port can be held again straight after.
  await expect(MACHINE.trialListen('127.0.0.1', port)).resolves.toBeUndefined();
});

it('lists this machine’s loopback among its addresses', () => {
  expect(MACHINE.localAddresses()).toContain('127.0.0.1');
});
