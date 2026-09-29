// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { defineConfig, devices } from '@playwright/test';

/**
 * ***The end-to-end tier*** —
 * [testing §3.5](../docs/design/workplan/03-testing.md),
 * [P11 §3](../docs/design/workplan/28-p11-implementation.md)'s row 8.
 *
 * §3.5: *"Playwright, kept deliberately thin — a handful of journeys that would
 * be catastrophic to break: first-run setup, create an actor, import a card,
 * start a session, take a turn, branch, open the workbench."*
 *
 * ***Thin is the instruction and the hardest part of it to keep.*** A browser
 * suite grows by one journey at a time, each of them reasonable, until it takes
 * ten minutes and fails for reasons nobody investigates — which is the condition
 * [testing §1](../docs/design/workplan/03-testing.md) calls a suite nobody
 * trusts. **The rule this file keeps is that a journey earns its place by being
 * catastrophic to break**, and the seven §3.5 names are the list rather than a
 * starting point.
 *
 * ***It runs against the built server and the built client***, which is what
 * makes it end to end rather than a slower component test: `webServer` below
 * starts `dist/main.js` with `SE_CLIENT_ROOT` pointed at the client's `dist`, so
 * what the browser loads is the artifact, served the way the image serves it.
 *
 * ***And against a fake endpoint over HTTP***, for the reason
 * [`fake-endpoint.mjs`](./fake-endpoint.mjs) gives at length: a shipped build
 * that could be told to fake its own provider is a footgun in every install,
 * bought so a test could avoid writing forty lines of HTTP.
 *
 * *One browser.* §3.5 says a handful of journeys, not a matrix, and the platform
 * question — *does it work in Safari* — is
 * [manual testing](../docs/design/workplan/05-manual-testing.md) sitting H's,
 * where it has been since P2.
 */

const PORT = 4598;
const FAKE_PORT = 4599;

export default defineConfig({
  testDir: '.',
  testMatch: '**/*.spec.ts',
  /**
   * **Serial, and it is not a performance oversight.** The journeys share one
   * install — one account, one library, one session tree — because *first-run
   * setup* is a journey and a parallel run would have several browsers racing
   * to be first. §3.5's list is a sequence a person would follow, and running it
   * as one is the honest shape.
   */
  workers: 1,
  fullyParallel: false,
  forbidOnly: true,
  retries: 0,
  reporter: process.env['CI'] === undefined ? 'list' : [['list'], ['github']],
  timeout: 30_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL: `http://127.0.0.1:${String(PORT)}`,
    /**
     * ***A browser this machine already has, when it says so.***
     *
     * Playwright resolves its browser by a revision pinned to the library
     * version, which is right on a machine that downloads one and wrong on a
     * machine that shipped with one — a container with Chromium already in it
     * fails with *"executable doesn't exist"* naming a revision it has no
     * reason to want. `SE_E2E_CHROMIUM` is the escape: **absent, nothing
     * changes and CI resolves normally**; present, this run uses the binary the
     * environment provides.
     *
     * *An environment variable rather than a path in this file*, because a
     * container path committed here would be a claim about one machine made in
     * a file every machine reads.
     */
    ...(process.env['SE_E2E_CHROMIUM'] === undefined
      ? {}
      : { launchOptions: { executablePath: process.env['SE_E2E_CHROMIUM'] } }),
    // On the first retry there are none, so this is the trace of a failure in
    // CI and nothing else — the artifact somebody actually wants when a journey
    // goes red on a machine they cannot see.
    trace: 'retain-on-failure',
    ...devices['Desktop Chrome'],
  },
  webServer: [
    {
      command: `node e2e/fake-endpoint.mjs`,
      url: `http://127.0.0.1:${String(FAKE_PORT)}/v1/models`,
      reuseExistingServer: false,
      env: { FAKE_PORT: String(FAKE_PORT) },
      cwd: '..',
    },
    {
      /**
       * ***A fresh data directory per run***, which is what makes *first-run
       * setup* a journey rather than a thing that worked once. `mktemp -d` is
       * the whole of it: the server creates everything it needs under an empty
       * directory, which is the claim [P6A](../docs/design/workplan/19-p6a-alpha-1.md)'s
       * image makes and this is the cheapest place it is checked.
       *
       * **Loopback, so no setup token is needed** — [09 §5.1]'s own rule: the
       * token exists for an install reachable from elsewhere, and a run on
       * `127.0.0.1` is not one.
       */
      command:
        'SE_DATA_DIR="$(mktemp -d)" SE_HOST=127.0.0.1 ' +
        `SE_PORT=${String(PORT)} SE_CLIENT_ROOT=packages/client/dist ` +
        'node packages/server/dist/main.js',
      url: `http://127.0.0.1:${String(PORT)}/api/auth/state`,
      reuseExistingServer: false,
      /**
       * ***Not supervised, whatever the machine running this is.*** The GitHub
       * runner is a systemd service, so its `INVOCATION_ID` reaches every
       * process it starts, and this server would believe something restarts it
       * and offer *Restart now* to a browser that nothing would bring back.
       * Empty is unset — [21 §4]'s rule, which `supervisionOf` follows.
       */
      env: { INVOCATION_ID: '', SE_SUPERVISED: '' },
      cwd: '..',
      stdout: 'pipe',
      stderr: 'pipe',
    },
  ],
});
