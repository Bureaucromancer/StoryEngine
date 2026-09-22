// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { makeTestServer, routesUnder, type TestServer } from '../test-server.js';

/**
 * **Every route the server serves is reached by something** — [P7B.5], and it
 * is the check that outlives the phase that added it.
 *
 * ***Five surfaces were missing for up to six phases and the suite was green
 * over all of them.*** `GET /api/search` shipped at P2 and
 * [P5 §3](../../../../docs/design/workplan/17-p5-implementation.md) called its
 * absence *"settled rather than deferred"*; `GET /api/library/errors` shipped at
 * P2 and [manual gate §3.5](../../../../docs/design/workplan/11-p2-manual-gate.md)
 * said *"No client code calls it"* every phase since; session delete had no
 * wrapper at all, and archive was a field on a `PATCH` the client already sent.
 * Not one of them failed a test, because a route's own tests call it and the
 * suite cannot tell a caller that is a client from a caller that is a test.
 *
 * **The instrument that found them was a person reading documentation**, which
 * is the most expensive one available and had not been pointed at this in six
 * phases. This is the cheap one, and it never gets tired.
 *
 * ---
 *
 * ***The exemptions are the interesting half.*** A route that legitimately has
 * no client caller is a normal thing — the list answers the same question, the
 * absence is argued somewhere — and the rule is that it says so **in one line,
 * here**. Writing those lines is the audit; a route arriving without one is the
 * thing this test exists to make somebody think about.
 *
 * **Routes from Fastify, client as text**, and the asymmetry is deliberate.
 * ~~An earlier draft read both sides as text~~ *and it was wrong within a
 * minute of running* (corrected 2026-09-14, before it was ever committed): it
 * rebuilt route paths by regex from this directory and assumed every module
 * mounts at `/api`, so the seventeen routes behind `{ prefix: '/admin' }`
 * arrived as orphans. [`routesUnder`](../test-server.ts) reads Fastify's own
 * tree, and its docstring is about exactly this — *"a hand-maintained array is
 * wrong the first time somebody adds one in a hurry, and it is wrong
 * silently."* The client has no such oracle: nothing enumerates a browser's
 * requests, so that half stays a read of the source, and the work is in reading
 * it well enough.
 *
 * **What it cannot do**, said rather than discovered:
 *
 * - **It is address-granular, not method-granular.** A string literal carries
 *   no method, so a client naming `/api/sessions/:id/cast` anywhere covers
 *   every verb on that address. Pairing the two would mean understanding four
 *   calling conventions (`request`, `requestForm`, `EventSource`, an `<img>`
 *   `src`), and a check that only understood one would report a route as
 *   uncalled because its caller was tidy.
 * - **It proves a file *names* an address, not that a person can reach it.** A
 *   wrapper nobody calls would satisfy it. That is weaker than the claim the
 *   sweep made by hand and it is the one a text scan can hold; the stronger
 *   version is a person, and
 *   [manual testing §9](../../../../docs/design/workplan/05-manual-testing.md)
 *   keeps that open.
 */

const root = join(dirname(fileURLToPath(import.meta.url)), '../../../..');

let server: TestServer;

beforeEach(async () => {
  server = await makeTestServer();
});

afterEach(async () => {
  await server.dispose();
});

/**
 * Client files, from git rather than from a directory walk.
 *
 * **Test files are excluded, and that is the one exclusion that matters.** The
 * whole finding above is that a route's own tests call it: a corpus that
 * counted `PlayPage.test.tsx` as a caller would answer *yes, something names
 * it* for every route in the build and never fail.
 */
function clientFiles(): string[] {
  return execFileSync('git', ['ls-files', '-z', 'packages/client/src'], {
    cwd: root,
    encoding: 'utf8',
  })
    .split('\0')
    .filter((path) => /\.tsx?$/.test(path) && !/\.test\.tsx?$/.test(path));
}

/**
 * `/sessions/:sessionId/preset` and `` `/api/sessions/${id}/preset` `` are the
 * same address, and this is what makes them compare equal: every parameter
 * becomes `:p`, whether it was declared as one or interpolated into one. A
 * query string is dropped — `?v=${hash}` is a cache-buster, not an address.
 */
function shapeOf(path: string): string {
  const [bare = ''] = path.split(/[?#]/);
  return bare
    .replace(/\$\{[^}]*\}/g, ':p')
    .replace(/:[A-Za-z_][A-Za-z0-9_]*/g, ':p')
    .replace(/\/+$/, '');
}

/**
 * The client's URL helpers, by name, as the template they return.
 *
 * ***This is the answer to the risk [manual testing §9] named.*** That section
 * says the client's request layer *"may be too dynamic to walk statically, in
 * which case the fallback is a hand-maintained list — worse, and still more
 * than exists today."* It is dynamic, and the fallback is not needed: `api.ts`
 * composes six addresses out of `objectUrl` and `versionUrl`
 * (`` `${objectUrl(kind, id)}/history` ``), and one line of substitution reads
 * them. Registering the helpers **by shape rather than by name** is what keeps
 * this from being the hand-maintained list wearing a disguise — a seventh
 * helper written the same way is found without editing this file.
 */
function urlHelpers(texts: string[]): Map<string, string> {
  const helpers = new Map<string, string>();
  for (const text of texts) {
    for (const match of text.matchAll(
      /(?:function\s+(\w+)\s*\([^)]*\)[^{]*\{\s*return\s+|(\w+)\s*[:=]\s*\([^)]*\)(?:\s*:\s*[\w<>[\]| ]+)?\s*=>\s*)`([^`]*)`/g,
    )) {
      const name = match[1] ?? match[2] ?? '';
      const body = match[3] ?? '';
      // A template that is an address, or one built on another that is. The
      // second case is `versionUrl`, which is why the expansion below runs to a
      // fixpoint rather than once.
      if (name !== '' && (body.includes('/api/') || body.startsWith('${'))) {
        helpers.set(name, body);
      }
    }
  }
  return helpers;
}

/** Every `/api/...` address the client names, in any file and any shape. */
function clientAddresses(): Set<string> {
  // `mediaUrl` is one address written as two templates joined by `+`, because
  // it is longer than the line width. Joining them first is cheaper than
  // teaching the scanner about concatenation, and it is exactly as correct.
  const texts = clientFiles().map((file) =>
    readFileSync(join(root, file), 'utf8').replace(/`\s*\+\s*`/g, ''),
  );
  const helpers = urlHelpers(texts);

  const found = new Set<string>();
  for (const original of texts) {
    let text = original;
    // To a fixpoint, capped: `versionUrl` is written in terms of `objectUrl`,
    // and a cap rather than `while (true)` because a helper that referred to
    // itself would otherwise hang the suite rather than fail it.
    for (let pass = 0; pass < 4; pass += 1) {
      const before = text;
      for (const [name, body] of helpers) {
        text = text.replaceAll(new RegExp(`\\$\\{${name}\\([^}]*\\)\\}`, 'g'), body);
      }
      if (text === before) break;
    }
    // Not restricted to `request(…)` calls: an avatar is an `<img src>` and a
    // stream is an `EventSource`, and a check that only understood one calling
    // convention would report a route as uncalled because the caller was tidy.
    for (const match of text.matchAll(/['"`](\/api\/[^'"`\s]*)['"`]/g)) {
      found.add(shapeOf(match[1] ?? ''));
    }
  }
  return found;
}

function segmentsOf(path: string): string[] {
  return path.split('/').filter(Boolean);
}

/**
 * Whether this route would answer this address — **routing, not equality**.
 *
 * A route's `:p` accepts any segment, which is how `/api/library/:kind/:id/avatar`
 * is reached by `` `/api/library/actors/${id}/avatar` ``. A *client's* `:p` does
 * not accept a literal, which is the half worth stating: without it
 * `` `/api/library/${kind}` `` would be credited to `GET /api/library/errors`
 * and that route's absence of a caller would be hidden by an address that never
 * reaches it.
 */
function accepts(route: string, address: string): boolean {
  const routeSegments = segmentsOf(route);
  const addressSegments = segmentsOf(address);
  if (routeSegments.length !== addressSegments.length) return false;
  return routeSegments.every(
    (segment, index) => segment === ':p' || segment === addressSegments[index],
  );
}

/** How specific a route is — Fastify prefers a static segment to a parameter. */
function staticness(route: string): number {
  return segmentsOf(route).filter((segment) => segment !== ':p').length;
}

/** Every route the app serves under `/api`, as `METHOD /path` with `:p` params. */
function serverRoutes(): string[] {
  return [
    ...new Set(
      routesUnder(server.app, '/api').map((route) => `${route.method} ${shapeOf(route.url)}`),
    ),
  ].sort();
}

/**
 * The addresses a client naming reaches, resolved the way Fastify resolves one.
 *
 * An address is credited to the most specific route that accepts it and not to
 * the others, because that is the only one a browser would actually reach.
 */
function reachedPaths(): Set<string> {
  const paths = [...new Set(serverRoutes().map((route) => route.slice(route.indexOf(' ') + 1)))];
  const reached = new Set<string>();
  for (const address of clientAddresses()) {
    const candidates = paths.filter((path) => accepts(path, address));
    if (candidates.length === 0) continue;
    const best = Math.max(...candidates.map(staticness));
    for (const path of candidates) if (staticness(path) === best) reached.add(path);
  }
  return reached;
}

/**
 * Routes with no client caller, where that is **correct**.
 *
 * **One line per route and no wildcards.** A pattern here would silence the next
 * route that happened to match it, which is exactly the failure the whole check
 * is about.
 */
const EXEMPT = new Map<string, string>([
  [
    'GET /api/modes/:p',
    'GET /api/modes answers with the same presentMode payload for every mode, so a client holding the list never needs to ask about one. This answers a caller that has an id and not the list.',
  ],
  [
    'PUT /api/sessions/:p/cast',
    'A deliberate absence, argued in play/LorePanel.tsx: the persona is chosen at setup and changing it mid-session is an explicit act rather than an outcome of play (06 §8), and cast.actors is mid-move to channel state (P7 §1.6), so a control over this body would be built against a shape P7 replaces. The route accepts a later change; nothing offers one.',
  ],
]);

/**
 * Routes with no client caller, where that is a **gap** — with who owes it.
 *
 * ***A second map rather than a second reason string, because the two say
 * different things and only one of them should ever grow.*** An exemption is an
 * argument that no surface is needed; this is a promise that one is, and a
 * reader can count these. Every entry names the stage, so a row here is a claim
 * some document also makes rather than a note only this file remembers.
 */
const OWED = new Map<string, string>([
  /**
   * ***The two backup-import rows stood here for one stage and are gone.***
   *
   * [P12.9] built the routes and [P12.10] built `settings/ImportBackup.tsx`,
   * which names both addresses — so the scan reaches them and a line saying *a
   * surface is owed* stopped being true. **Discharged by building the surface
   * rather than by editing the map**, which is the only way out this map is
   * meant to have, and the shortest a debt in it has ever stood.
   */
  /**
   * ***`GET /api/search` was owed here from P2 to [P11.1] and is paid.***
   *
   * Nine phases, which is the longest a debt in this map has ever stood — and
   * it stood for a reason this map is the wrong instrument to see: the route
   * worked, its tests passed, and the only thing missing was somebody to ask
   * it. **It is gone rather than annotated**, which is the shape of a debt
   * being discharged: `api.ts` names the address now, so the scan reaches it
   * and a line saying *a surface is owed* would have stopped being true.
   *
   * *Discharged by building the surface rather than by editing the map*, which
   * is the only way out this map is meant to have.
   */
  /**
   * ***The restore control, owed to [P12.13].*** [P12.11] built the route and
   * every precondition it refuses on; the control is deliberately a stage
   * later, because it is **absent** rather than disabled where nothing would
   * restart the process, and a control whose existence is a condition is worth
   * building against a route that already refuses.
   */
  [
    'POST /api/admin/restore',
    'P12.11 built it; P12.13 builds the type-the-words confirmation, visually apart from the list, and the sentence that gives the shell command where the control is absent.',
  ],
  [
    'PUT /api/sessions/:p/roles',
    "P7.3 built the route, the layering and the tests, and no control. Its own docstring says where the surface goes: 'beside the lore panel's disclosure'. Found by this check rather than by the sweep — P7B §1.12.",
  ],
  [
    'PATCH /api/sessions/:p/refs/:p',
    'A named node can be created from the play page and never renamed. P7B §1.12.',
  ],
  [
    'DELETE /api/sessions/:p/refs/:p',
    'The same, for removing one: 07 §6 says promoting a swipe is creating a ref and that deleting one later deletes a name, and nothing can. P7B §1.12.',
  ],
  /**
   * ***The three notification routes were owed here for one stage and were paid
   * at [P10.2].***
   *
   * [P10.1] built the router, the store and the producers and stopped at the
   * server edge; [P10.2] built the two delivery channels — `api.ts` now names
   * all three addresses, so the scan reaches them. **One stage, which is the
   * shortest a debt in this map has ever been outstanding**, and it is worth
   * saying because it is what the map is for: a line written with a stage's name
   * on it is a promise somebody can check, and the check is this test going
   * green without it.
   */
  /**
   * ***The three rendition routes were owed here and were paid at [P9.4].***
   *
   * They are gone from this map rather than annotated, which is the shape of the
   * debt being discharged: `api.ts` now names all three — `readRenditions`,
   * `selectRendition` and `renditionAssetUrl` — so the scan reaches them and a
   * line saying *a surface is owed* would be a claim that had stopped being
   * true. The fourth, `POST …/turns/:p/illustrate`, arrived with its caller and
   * was never owed.
   */
]);

describe('every route the server serves has a caller', () => {
  it('finds both corpora, so a pattern that stopped matching cannot pass', () => {
    // The floor `release.test.ts` and `doc-links.test.ts` both carry, and for
    // the reason they state: a scan that stops finding anything makes every
    // assertion below vacuously true.
    expect(serverRoutes().length).toBeGreaterThan(40);
    expect(clientAddresses().size).toBeGreaterThan(25);
  });

  it('is named by client code, or is exempt or owed with a written reason', () => {
    const reached = reachedPaths();
    const orphans = serverRoutes().filter(
      (route) =>
        !EXEMPT.has(route) && !OWED.has(route) && !reached.has(route.slice(route.indexOf(' ') + 1)),
    );

    expect(
      orphans,
      `${String(orphans.length)} route(s) no client code names. Build the surface, or add a line to EXEMPT (no surface is needed, and why) or to OWED (one is, and which stage).`,
    ).toEqual([]);
  });

  it('has no exemption or debt for a route that does not exist', () => {
    const routes = new Set(serverRoutes());
    const stale = [...EXEMPT.keys(), ...OWED.keys()].filter((route) => !routes.has(route));

    // A line outliving its route is a line nobody re-reads, which is manual
    // testing §10.1's whole subject.
    expect(stale, 'exemption(s) or debt(s) for routes that are gone').toEqual([]);
  });
});
