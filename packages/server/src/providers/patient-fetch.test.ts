// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import { Agent, fetch as undiciFetch } from 'undici';
import { afterEach, describe, expect, it } from 'vitest';

import { PATIENT_DISPATCH, patientFetch } from './patient-fetch.js';

/**
 * ***A provider call has one clock, and it is ours*** (2026-09-27).
 *
 * Node's global `fetch` gives up on headers after 300 seconds and on a quiet
 * body after 300 more, underneath `limits.providerTimeoutMs`, so a slow model
 * could not be given longer and `0` switched off only our own bound. The
 * patient dispatcher has neither limit. Five minutes cannot be waited out in a
 * test, so the claim is made twice: the dispatcher is built with no limits,
 * and a real socket shows what a limit does — the same slow endpoint that a
 * dispatcher with one gives up on, this one waits for.
 */

let server: Server | null = null;

afterEach(async () => {
  const open = server;
  server = null;
  if (open !== null) {
    await new Promise<void>((done) => {
      open.close(() => {
        done();
      });
    });
  }
});

/** An endpoint that accepts, holds its headers back for `ms`, then answers. */
async function slowToAnswer(ms: number): Promise<string> {
  server = createServer((_request, response) => {
    setTimeout(() => {
      response.writeHead(200, { 'content-type': 'text/plain' });
      response.end('here at last');
    }, ms);
  });
  await new Promise<void>((done) => server?.listen(0, '127.0.0.1', done));
  const { port } = server.address() as AddressInfo;
  return `http://127.0.0.1:${String(port)}/`;
}

/** The first error code on a cause chain, which is where fetch buries it. */
function codeOf(error: unknown): string | undefined {
  for (let at = error, depth = 0; at !== undefined && at !== null && depth < 8; depth += 1) {
    const node = at as { code?: unknown; cause?: unknown };
    if (typeof node.code === 'string') return node.code;
    at = node.cause;
  }
  return undefined;
}

describe('the dispatcher a provider call goes through', () => {
  it('keeps no limit of its own on headers or on a quiet body', () => {
    expect(PATIENT_DISPATCH).toEqual({ headersTimeout: 0, bodyTimeout: 0 });
  });

  /**
   * *Three seconds, because undici's clock is coarse*: its limits are checked
   * on a timer that ticks about once a second, so a 100 ms limit fires after
   * about one. Both requests run at once, so the test costs the endpoint's
   * delay and nothing more.
   */
  it('waits for an endpoint that a dispatcher with a limit gives up on', async () => {
    const url = await slowToAnswer(3_000);
    const impatient = new Agent({ headersTimeout: 100 });

    const [failed, answered] = await Promise.all([
      // The failure mode, shown on this socket so the other half means something.
      undiciFetch(url, { dispatcher: impatient }).then(
        () => null,
        (error: unknown) => error,
      ),
      patientFetch(url).then((response) => response.text()),
    ]);
    await impatient.close();

    expect(codeOf(failed)).toBe('UND_ERR_HEADERS_TIMEOUT');
    expect(answered).toBe('here at last');
  }, 15_000);
});
