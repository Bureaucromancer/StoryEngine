// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

import { describe, expect, it } from 'vitest';

/**
 * ***A recorded ceiling on the entry bundle*** —
 * [21 §7](../docs/design/21-client-loading.md),
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
 * ***It is a tripwire, not a target.*** [21 §6](../docs/design/21-client-loading.md)
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
 * `index.html` itself references. A chunk reached by `import()` later — ~~the
 * workbench~~ *the setup wizard's dialog (`SetupWizard.tsx`,
 * [21 §7.2](../docs/design/21-client-loading.md))*, a locale catalogue — is
 * deliberately *not* here, because not being here is the whole point of
 * splitting it. *(Corrected 2026-10-04: the workbench was never one of these
 * chunks — `Shell.tsx` imports it statically, as
 * [21 §2](../docs/design/21-client-loading.md) records — and the wizard's
 * dialog, split off that day, is the one that is.)*
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
 * [21 §7](../docs/design/21-client-loading.md)'s own trigger and the thing this
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
 * auto-mode — and **no new dependency**, which is the [21 §7] trigger this
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
 * `note-labels.ts` is. **No new dependency**, which is the [21 §7] trigger.
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
 * which is the [21 §7] trigger. The same five kB of margin again, and the
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
 * client's own code and **no new dependency**, which is the [21 §7] trigger;
 * most of the polish half is the words and the wiring by which a control says
 * what happened — `TwoStep`, `WriteFailed`, `copyText`, a skip link, a radio
 * group's arrows, search's status line. Every route is on the common entry, so
 * a pass over every route lands here. Five kB of margin again, and the remedy
 * named three times above is still the one and still not a polish commit's to
 * take: the first `React.lazy`, or the note sentences off the entry with the
 * library surface that is their only reader.
 */
/*
 * ***Raised to 342 on 2026-10-03, at the merge of main into P15*** —
 * [P15](../docs/design/workplan/33-p15-setup-from-a-turn.md), *make a setup
 * from here*, built against 310 on a branch cut on 2026-09-26, before any of
 * the four raises above, and so never weighed against them. Main's side of
 * the merge (`21d8048a`) measured **333.76**; merged, the entry measured
 * **337.05**, and **337.58** once the merge's own client work was in — the
 * session form's greetings for a Setup's party and the sentence for 26 B18's
 * rule, the refusals for an opening a Setup no longer holds and for a greeting
 * beside one that gained an opening, the workbench's link from the story so
 * far to its Setup — and **337.79** after review's two sentences for a
 * summary link the draft could not keep. **+4.03 kB** in all, nearly all of
 * it P15's own code: the wizard (`SetupFromTurn.tsx`), the *Start a session*
 * button a Setup's page and the wizard share (`StartSession.tsx`), and the
 * session form's Setup picker. **No new dependency** — the branch touched no
 * manifest — which is the [21 §7] trigger. The wizard is the plainest
 * candidate yet for the first `React.lazy`: a dialog nobody sees until they
 * press a button on one turn, and every byte of it on the common entry. It is
 * still a loading decision and not a merge's, so the remedy named four times
 * above is named a fifth, with a candidate this time. About four kB of
 * margin, roughly what each raise above has left.
 */
/*
 * ***Back to 336 on 2026-10-04 — the remedy named five times above, taken.***
 * [P15 §1.11](../docs/design/workplan/33-p15-setup-from-a-turn.md) decided it,
 * on the recommended answer with the owner's decision deferred, and
 * [21 §7.2](../docs/design/21-client-loading.md) records the boundary: the
 * wizard's dialog is `SetupWizard.tsx`, reached through the client's first
 * `lazy()` from the button that stays on the play page. The entry measured
 * **337.79** with the dialog on it, **335.38** without, and **335.55** once
 * review's changes to the button's side were in — the failure note drawn
 * outside the row that fades, focus handed back on *Dismiss*, and a second
 * sentence for a dialog that fails as it draws rather than as it loads. With
 * those states on the entry and the dialog imported statically again — the
 * mutation that proved the two checks below red — it measures **338.19**, so
 * the dialog costs the entry 2.64. The chunk it became is **3.78** on its own,
 * and the gap is *not* the modules the dialog shares with the entry: those
 * stay on the entry and are in neither number. It is compression and wiring.
 * A small file gzipped alone compresses worse than the same bytes inside the
 * entry — appended to the entry, the chunk costs **3.04**, so about 0.74 is
 * context the chunk does not have — and the other 0.40 is the split's own
 * code: the chunk's import of the bindings it shares with the entry, and on
 * the entry an export list for them and the `import()` that fetches it (the
 * bundler's preload helper was already there, for the locale catalogues).
 * **This is not a raise reversed by a cleverer number**: 336 is the ceiling
 * P15 found when it merged, restored rather than re-chosen, and the margin it
 * leaves is **0.45 kB** — less than any raise above left, so the next client
 * change of any size will meet it and has to say out loud what it added,
 * which is what this file is for. *The 342 paragraph above stays* as the
 * record of what the merge measured and why it chose to raise.
 */
/*
 * ***Not raised on 2026-10-04, at [polish §26] — saying out loud what it
 * added, as the paragraph above asks.*** A connection that hides another says
 * so: two sentences on the Connections rows, one above the role pane's table,
 * the label of a binding to a hidden connection, and the install panel's read
 * of the caller's role answer. The entry measured **335.55** before it and
 * **335.96** after — **+0.41 kB**, all the client's own words and wiring, and
 * **no new dependency**, which is the [21 §7] trigger. It fits, and leaves
 * **0.04 kB**, which no client change will fit inside: the next one meets this
 * ceiling, and the choice it faces is this file's usual one — a raise argued
 * here, or code moved off the entry the way the wizard's was. Choosing which
 * is a loading decision and not a polish entry's, so it is named rather than
 * taken.
 */
/*
 * ***Raised to 341 on 2026-10-06, at [polish §27] — the next change, meeting
 * it as the paragraph above said it would.*** Delete from the shelf: a column
 * of `DeleteObject` on the library's rows, the control learning to name its
 * object and to stay where it was asked from, and the ownership gate lifted
 * out of the read page so both read one. HEAD measured **335.96** — the same
 * bundle, byte for byte, that §26 left — and the change **336.06**: **+0.10
 * kB**, all the client's own code, and **no new dependency**, which is the
 * [21 §7] trigger. The owner chose the raise over a split, on the recommended
 * answer: five kB of margin, as every raise above left, and the remedy named
 * six times stays named — the note sentences off the entry with the library
 * surface that is their only reader, or a second `lazy()`.
 */
const JS_CEILING_KB = 341;

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
   * [21 §7](../docs/design/21-client-loading.md).
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

  /**
   * ***The setup wizard's dialog is not on the entry, and this is the check
   * that says so*** — [P15 §1.11](../docs/design/workplan/33-p15-setup-from-a-turn.md),
   * [21 §7.2](../docs/design/21-client-loading.md), 2026-10-04.
   *
   * The locale test's argument, for the client's first `lazy()`: **the
   * regression is one line** — `SetupWizard.tsx` imported statically from
   * anywhere the entry reaches, which typechecks, lints, works, and folds the
   * dialog back into every first load. The byte ceiling above catches it
   * today, by about two kB (338.19 against 336); it would stop catching it the
   * day a raise put the ceiling past that, and this names it regardless.
   * [21 §6](../docs/design/21-client-loading.md) asks for exactly this kind of
   * guardrail first — *structural*, read off the build graph — and says why
   * the unit tests cannot be it: a rendered mock of a lazy component is a
   * module however it was imported.
   *
   * *By the chunk's name*, which the bundler takes from the module's file
   * name: renaming `SetupWizard.tsx` fails the first expectation with a message
   * saying which name it looked for, rather than passing because nothing
   * matched.
   */
  it('keeps the setup wizard off the entry', () => {
    const chunks = readdirSync(join(DIST, 'assets'));
    const wizard = chunks.filter((name) => name.startsWith('SetupWizard-'));
    expect(
      wizard,
      'no chunk named SetupWizard-* in dist/assets: the setup wizard is not a chunk of its own',
    ).not.toEqual([]);
    for (const name of entryAssets('.js')) {
      expect(name.startsWith('SetupWizard-'), name).toBe(false);
    }
  });
});
