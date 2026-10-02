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
/*
 * ***Raised to 320 on 2026-09-29, at [P14.5]*** (the chat surface,
 * [P14 §1.8](../docs/design/workplan/31-p14-scene-and-session-import.md)). The
 * entry measured **306.91** before the stage and **314.69** after it: +7.78 kB
 * of the play page's own code — the transcript drawn as a chat, the chat
 * settings, the cast panel's four controls, the creation form's characters and
 * auto-mode — and **no new dependency**, which is the [20 §7] trigger this
 * ceiling exists to make loud. The play page is on the common entry, as every
 * route is, so its growth lands here; splitting one page's code into a lazy
 * chunk would be the first `React.lazy` in the client and a loading decision
 * of its own, which a feature stage should not make in passing. The new
 * number leaves about five kB, a little more than the three the stage found.
 */
/*
 * ***Raised to 325 on 2026-09-30, at [P14.5c]*** (the editor and the echo
 * chamber, [P14 §1.9.4–§1.9.5](../docs/design/workplan/31-p14-scene-and-session-import.md)).
 * P14.5a's and P14.5b's as-built notes recorded the entry closing in on 320 —
 * **318.7**, **319.65**, **319.85** — each saying the next addition would have
 * to argue for the ceiling. This is that argument. The stage measured
 * **320.43** and, with its four new import notes' sentences shortened (and the
 * old `agentsNotCarried` one with them), **320.25**: the transcript's *Edited:
 * show the original* disclosure and the continuity checklist with its *Apply*
 * (`ChatMessages.tsx`), and the notes, which are on the entry because
 * `note-labels.ts` is. **No new dependency**, which is the [20 §7] trigger.
 * Five kB is P14.5's own margin again, a little under two stages at this
 * phase's rate; what would buy room instead is the first `React.lazy`
 * (P14.5's note above), or moving the note sentences off the entry with the
 * library surface that is their only reader — a loading decision, which a
 * feature stage should not make in passing.
 */
/*
 * ***Raised to 331 on 2026-09-30, at the merge of P13 after P14*** — no stage
 * of either grew it; the two branches did, each inside its own ceiling.
 * [P13](../docs/design/workplan/30-p13-aventuras-import.md) was built against
 * 310 and never reached it, and P14 raised to 325 for itself without P13's
 * client on the entry. Merged, the entry measured **326.03**: P14's **320.25**
 * and about **5.8 kB** of P13's own code — the Aventuras review sentences in
 * `note-labels.ts` (on the entry for P14.5c's reason above), the import
 * panel's *stories* choice, the landed-upload meter and its preview, and the
 * `.avt` sniff. **No new dependency** — neither side touched a manifest —
 * which is the [20 §7] trigger. The same five kB of margin again, and the
 * same remedy named twice above and still not taken: the note sentences off
 * the entry with the library surface that is their only reader, which is a
 * loading decision and not a merge's to make.
 */
/*
 * ***Raised to 336 on 2026-10-01, for the audit and the polish pass that
 * followed it.*** The entry measured **326.03** at the P13–P14 merge above;
 * **329.00** before polish 5 (`d7ac703`), the difference being the audit's
 * client fixes — a refusal read by its class rather than by its English, a
 * draft kept through a late assist, a live frame that no longer freezes; then
 * **330.13** after polish 9, **330.42** after polish 10, and **331.24** with
 * polish 11, which crossed. About five kB in thirty-odd commits, all the
 * client's own code and **no new dependency**, which is the [20 §7] trigger;
 * most of the polish half is the words and the wiring by which a control says
 * what happened — `TwoStep`, `WriteFailed`, `copyText`, a skip link, a radio
 * group's arrows, search's status line. Every route is on the common entry, so
 * a pass over every route lands here. Five kB of margin again, and the remedy
 * named three times above is still the one and still not a polish commit's to
 * take: the first `React.lazy`, or the note sentences off the entry with the
 * library surface that is their only reader.
 */
const JS_CEILING_KB = 336;

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
