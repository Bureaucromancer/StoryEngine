// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

import { describe, expect, it } from 'vitest';

/**
 * ***A recorded ceiling on the entry bundle*** —
 * [20 §7](../docs/design/20-client-loading.md),
 * [P11.0](../docs/design/workplan/28-p11-implementation.md),
 * [P11.9](../docs/design/workplan/28-p11-implementation.md).
 *
 * P11.0's measurement ended in a recommendation, in these words: ***"what this
 * audit therefore asks of P11.9 is one line in `tools/release.test.ts`'s
 * neighbourhood: a recorded ceiling on the entry bundle, so the next phase that
 * doubles it is found by failing rather than by somebody rebuilding and
 * remembering these three rows. A budget nobody can breach loudly is the same
 * class of thing as a deferral nobody collects."*** This is that line, in that
 * neighbourhood — which is why it is in `tools/` and not beside the client, even
 * though what it reads is `packages/client/dist`.
 *
 * ***It is a tripwire, not a target.*** [20 §6](../docs/design/20-client-loading.md)
 * is explicit that CI can hold a byte total and cannot hold a timing, and
 * P11.0's own conclusion was that 280 kB gzip on one route is **large and not
 * measured harm** — nothing in any sitting reports slow arrival. So the number
 * below is not a goal anybody is working toward; it is the point past which
 * somebody has to say out loud what they added.
 *
 * ***Two compressors, two numbers, and the difference is not the bundle.*** Vite
 * prints `gzip: 286.57 kB` for this file and the measurement here says
 * **276.77 kB**, because `zlib.gzipSync({ level: 9 })` is not the setting Vite
 * reports with. The ceiling is in *this* file's units, and comparing it to a
 * build log's is comparing two compressors.
 *
 * **What is measured is what a first load pays**: the scripts and stylesheets
 * `index.html` itself references. A chunk reached by `import()` later — the
 * workbench, a locale catalogue — is deliberately *not* here, because not being
 * here is the whole point of splitting it.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const DIST = join(HERE, '..', 'packages', 'client', 'dist');

/**
 * ***310 kB gzip, recorded 2026-09-17 at 276.77.***
 *
 * About twelve per cent of headroom, which is roughly three phases at P10's
 * measured rate (nineteen modules, 12.16 kB gzip) — deliberately enough that
 * ordinary work does not trip it and nowhere near enough to absorb a
 * substantial new dependency on the common entry, which is
 * [20 §7](../docs/design/20-client-loading.md)'s own trigger and the thing this
 * is here to make loud.
 *
 * **Raising it is a decision, and it should be made by editing this number with
 * a reason beside it** rather than by deciding the failure is noise. That is
 * the difference between a budget and a warning.
 */
const JS_CEILING_KB = 310;

/** The stylesheet, at 6.99 kB and growing with the design system rather than the app. */
const CSS_CEILING_KB = 12;

const NO_BUILD =
  'No built client under packages/client/dist. Run `pnpm build` first — this test weighs the entry bundle, and without a build there is nothing to weigh, so a doubling would pass silently. CI builds before it tests for exactly this reason.';

function html(): string {
  try {
    return readFileSync(join(DIST, 'index.html'), 'utf8');
  } catch {
    throw new Error(NO_BUILD);
  }
}

/** The assets `index.html` itself pulls, which is what a first load pays for. */
function entryAssets(suffix: string): string[] {
  const found = [...html().matchAll(/(?:src|href)="\/assets\/([^"]+)"/g)].map(
    (match) => match[1] ?? '',
  );
  return found.filter((name) => name.endsWith(suffix));
}

function gzippedKb(names: string[]): number {
  const total = names.reduce(
    (sum, name) => sum + gzipSync(readFileSync(join(DIST, 'assets', name)), { level: 9 }).length,
    0,
  );
  return total / 1024;
}

describe('what a first load pays for', () => {
  it('has a build to weigh, so an unbuilt checkout cannot pass quietly', () => {
    expect(entryAssets('.js').length, NO_BUILD).toBeGreaterThan(0);
  });

  it('is under the recorded ceiling', () => {
    const kb = gzippedKb(entryAssets('.js'));
    // The number in the failure, because the next person needs to know whether
    // they added two kilobytes or a hundred.
    expect(kb, `entry JavaScript is ${kb.toFixed(2)} kB gzip`).toBeLessThan(JS_CEILING_KB);
  });

  it('has a stylesheet that is still a stylesheet', () => {
    const kb = gzippedKb(entryAssets('.css'));
    expect(kb, `entry CSS is ${kb.toFixed(2)} kB gzip`).toBeLessThan(CSS_CEILING_KB);
  });

  /**
   * ***The locale catalogues are not on the entry, and this is the check that
   * says so*** — [P11.8](../docs/design/workplan/28-p11-implementation.md),
   * [20 §7](../docs/design/20-client-loading.md).
   *
   * `i18n/locales.ts` loads each catalogue through a dynamic `import()`
   * precisely so a language nobody in this install has chosen costs nothing at
   * all. **The regression is one character**: a static import at the top of that
   * file, which typechecks, lints, works, and quietly folds every catalogue into
   * the common entry. A byte ceiling would eventually catch it; this names it.
   */
  it('keeps every locale catalogue off the entry', () => {
    const chunks = readdirSync(join(DIST, 'assets'));
    const locale = chunks.filter((name) => name.startsWith('fr-x-machine'));
    expect(locale, 'the test French is not a chunk of its own').not.toEqual([]);
    for (const name of entryAssets('.js')) {
      expect(name.startsWith('fr-x-machine'), name).toBe(false);
    }
  });
});
