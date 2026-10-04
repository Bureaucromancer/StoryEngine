// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { describe, expect, it, vi } from 'vitest';

import { DEFAULT_CONFIG, type Config } from './config.js';
import type { Connection } from './providers/connections.js';
import {
  checkForUpdate,
  compare,
  isLocalEndpoint,
  needsInternet,
  RELEASES_URL,
} from './updates.js';

/**
 * The update check — [09 §6.5](../../../docs/design/09-server-multiuser-deployment.md),
 * [P10 §1.7], [P10.3].
 *
 * ***Two claims, and the second is the one that is easy to get wrong.***
 *
 * 1. **It is a check, not telemetry.** §6.5 says so firmly *"because the slide
 *    from one to the other is well-trodden"*, so the request is asserted
 *    **whole** — the URL and nothing else. A header this build invented, a query
 *    parameter, an install id: each of them fails a test that names why.
 * 2. **A failure is two things and only one is about the network.** Something
 *    answering with a 404 proves the internet works; nothing answering does not.
 *    Conflating them would tell every operator of this alpha — a *private*
 *    repository, whose feed answers 404 — that their server was offline.
 *
 * **The falsifying mutation is treating a non-OK response as `unreachable`.**
 * Every assertion about a good feed still passes.
 */

function config(over: Partial<Config['updates']> = {}): Config {
  return { ...DEFAULT_CONFIG, updates: { ...DEFAULT_CONFIG.updates, ...over } };
}

function feed(entries: unknown[]): typeof globalThis.fetch {
  return vi.fn(() => Promise.resolve(Response.json(entries)));
}

const RUNNING = { version: '1.0.0-alpha.4', commit: 'abc1234' };

describe('the request it makes', () => {
  it('is a plain GET of a public feed and carries nothing about this install', async () => {
    const calls: { url: unknown; init: unknown }[] = [];
    const fetchImpl = vi.fn((url: unknown, init: unknown) => {
      calls.push({ url, init });
      return Promise.resolve(Response.json([]));
    }) as unknown as typeof globalThis.fetch;

    await checkForUpdate({ fetch: fetchImpl, config: config(), build: RUNNING });

    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe(RELEASES_URL);
    // A timeout and nothing else. No method (so, GET), no headers, no body.
    // §6.5: *"indistinguishable from someone loading the releases page"*.
    expect(Object.keys(calls[0]?.init as object)).toEqual(['signal']);
    // And the version it is comparing against never leaves this process.
    expect(JSON.stringify(calls[0])).not.toContain('alpha.4');
  });

  it('makes no request at all when the check is turned off', async () => {
    const fetchImpl = vi.fn() as unknown as typeof globalThis.fetch;

    const status = await checkForUpdate({
      fetch: fetchImpl,
      config: config({ checkEnabled: false }),
      build: RUNNING,
    });

    expect(status.state).toBe('disabled');
    // *Disableable in one obvious place*, and disabled means silent rather than
    // merely unsurfaced.
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe('what it makes of the answer', () => {
  it('says behind when there is a newer release on this channel', async () => {
    const status = await checkForUpdate({
      fetch: feed([{ tag_name: 'v1.0.0' }, { tag_name: 'v0.9.0' }]),
      config: config(),
      build: RUNNING,
    });

    expect(status).toMatchObject({ state: 'behind', latest: '1.0.0', online: true });
  });

  it('says current when the newest is the one running', async () => {
    const status = await checkForUpdate({
      fetch: feed([{ tag_name: 'v1.0.0-alpha.4', prerelease: true }]),
      config: config({ channel: 'testing' }),
      build: RUNNING,
    });

    expect(status.state).toBe('current');
  });

  /**
   * ***The channel is a filter and `latest` is the strict one*** —
   * [releases §4]. An operator following `testing` who was told they were
   * current because the newest thing is a prerelease would be told something
   * false; one following `latest` who was offered a prerelease would be offered
   * an alpha as an upgrade.
   */
  it('takes prereleases only on the channels that are made of them', async () => {
    const entries = [{ tag_name: 'v1.1.0-alpha.1', prerelease: true }, { tag_name: 'v1.0.0' }];

    expect(
      (await checkForUpdate({ fetch: feed(entries), config: config(), build: RUNNING })).latest,
    ).toBe('1.0.0');
    expect(
      (
        await checkForUpdate({
          fetch: feed(entries),
          config: config({ channel: 'testing' }),
          build: RUNNING,
        })
      ).latest,
    ).toBe('1.1.0-alpha.1');
  });

  it('never takes a draft, which is a release nobody can download', async () => {
    const status = await checkForUpdate({
      fetch: feed([{ tag_name: 'v2.0.0', draft: true }, { tag_name: 'v1.0.0' }]),
      config: config(),
      build: RUNNING,
    });

    expect(status.latest).toBe('1.0.0');
  });

  /**
   * ***A development run has no version*** — [P6A §1.5] reports that as an
   * absence rather than as `0.0.0` — so there is nothing to compare and telling
   * a developer their working tree is out of date is noise.
   */
  it('says unknown for a build nobody identified', async () => {
    const status = await checkForUpdate({
      fetch: feed([{ tag_name: 'v9.9.9' }]),
      config: config(),
      build: null,
    });

    expect(status.state).toBe('unknown');
    expect(status.online).toBe(true);
  });
});

describe('the connectivity signal, and what is not one', () => {
  /**
   * ***This project's own present state***: the repository is private, so the
   * feed answers 404. *(Noted 2026-10-04: it was decided public on 2026-10-03,
   * and [releases §0.1a] records the day the switch lands. Once public, with no
   * GitHub Release, the feed answers the empty list the next test feeds. A feed
   * that moves answers 404 too, so this case outlives the switch.)* [releases §4]
   * also says `latest` *"names nothing"* until a release is cut. Neither is a
   * network fault, and reporting one would tell every alpha operator something
   * false about their own install.
   */
  it('reads an HTTP refusal as the internet working', async () => {
    const fetchImpl = vi.fn(() =>
      Promise.resolve(new Response('Not Found', { status: 404 })),
    ) as unknown as typeof globalThis.fetch;

    const status = await checkForUpdate({ fetch: fetchImpl, config: config(), build: RUNNING });

    expect(status.state).toBe('unknown');
    expect(status.online).toBe(true);
  });

  it('reads an empty feed the same way', async () => {
    const status = await checkForUpdate({ fetch: feed([]), config: config(), build: RUNNING });

    expect(status).toMatchObject({ state: 'unknown', latest: null, online: true });
  });

  it('reads nothing answering as offline, which is the only thing that is', async () => {
    const fetchImpl = vi.fn(() =>
      Promise.reject(new Error('getaddrinfo ENOTFOUND')),
    ) as unknown as typeof globalThis.fetch;

    const status = await checkForUpdate({ fetch: fetchImpl, config: config(), build: RUNNING });

    expect(status.state).toBe('unreachable');
    expect(status.online).toBe(false);
  });
});

describe('who the signal is allowed to nag', () => {
  function connection(baseUrl: string | undefined): Connection {
    return {
      id: 'c1',
      label: 'One',
      provider: 'openai-compatible',
      scope: 'system',
      models: ['m'],
      ...(baseUrl === undefined ? {} : { baseUrl }),
    };
  }

  /**
   * ***"It must be conditional on configuration, or it nags exactly the wrong
   * people."*** A fully local setup is a legitimate, fully-functional
   * deployment, and its operator chose it deliberately.
   */
  it('says nothing is expected of the internet on an all-local install', () => {
    expect(
      needsInternet([
        connection('http://localhost:11434/v1'),
        connection('http://192.168.1.50:1234/v1'),
        connection('http://ollama.local:11434/v1'),
      ]),
    ).toBe(false);
  });

  it('says it is expected the moment one connection is remote', () => {
    expect(
      needsInternet([
        connection('http://localhost:11434/v1'),
        connection('https://api.openai.com/v1'),
      ]),
    ).toBe(true);
  });

  /**
   * **A connection with no `baseUrl` counts as remote**, because the adapter's
   * default is `api.openai.com` — an omitted field is the most remote endpoint
   * there is, and reading it as local would silence the warning for the one
   * install that most needs it.
   */
  it('counts an omitted base URL as remote', () => {
    expect(needsInternet([connection(undefined)])).toBe(true);
  });

  it('knows the private ranges, including the one people write as 172.*', () => {
    expect(isLocalEndpoint('http://172.16.0.4:8080/v1')).toBe(true);
    expect(isLocalEndpoint('http://172.31.255.1/v1')).toBe(true);
    // 172.32 is public, which is exactly the boundary a `^172\.` pattern gets
    // wrong.
    expect(isLocalEndpoint('http://172.32.0.1/v1')).toBe(false);
    expect(isLocalEndpoint('not a url')).toBe(false);
  });
});

describe('ordering this project’s own tags', () => {
  /**
   * ***The one rule that is not lexical***, and the one that matters here: a
   * prerelease sorts below its own release, so `1.0.0-alpha.4` is older than
   * `1.0.0` where a string compare says the opposite.
   */
  it('puts a prerelease below its release', () => {
    expect(compare('1.0.0-alpha.4', '1.0.0')).toBeLessThan(0);
    expect(compare('1.0.0', '1.0.0-alpha.4')).toBeGreaterThan(0);
  });

  it('orders prereleases by their own numbers', () => {
    expect(compare('1.0.0-alpha.2', '1.0.0-alpha.10')).toBeLessThan(0);
  });

  it('orders the cores numerically rather than as text', () => {
    expect(compare('1.9.0', '1.10.0')).toBeLessThan(0);
    expect(compare('2.0.0', '10.0.0')).toBeLessThan(0);
    expect(compare('1.0.0', '1.0.0')).toBe(0);
  });
});
