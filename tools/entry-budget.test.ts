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
/*
 * ***Not raised on 2026-10-07, at alpha 5 — and the change was not code.***
 * `CHANGELOG.md` is on the entry (`home/log.ts` imports it `?raw`, P7B.9), so
 * every release's entry is weighed here. Alpha 5's — a month of phases in about
 * nine kilobytes of prose — measured **336.08** before and **339.59** after:
 * **+3.51 kB**, and **1.41** left. Kept short to fit rather than raising, but
 * it is the first growth this file has seen that will **recur on schedule**:
 * every tag adds its notes, and the next one will meet this ceiling. The remedy
 * is the one named above in a new place — the changelog is read only on `/`, so
 * it can leave the entry with the page — and choosing it is a loading decision,
 * named here rather than taken in a release commit.
 */
/*
 * ***Lowered to 304 the same day — the changelog and its renderer off the
 * entry, at [21 §7.3](../docs/design/21-client-loading.md).*** The paragraph
 * above named it, and this is it taken. Home's release and the workbench's list
 * of releases are one `lazy()` chunk now (`home/readers.ts`), and the renderer
 * went with them: [21 §7.1]'s pre-argued contingency for `react-markdown`,
 * taken one step wider than written, because the text is what grows. HEAD
 * measured **339.58** and the change **298.46**: **−41.12 kB**, and the readers'
 * chunk is about 47 on its own, fetched on arrival at `/` and nowhere else. The
 * ceiling comes down to leave five kB of margin, as every raise above left,
 * rather than forty for the next change to spend without saying so. *What else
 * moved, and is counted here*: with a second `import()` of shared code the
 * bundler began putting the modules the entry shares with the lazy chunks into
 * files of their own that `index.html` preloads — four besides the entry — and
 * this file weighs everything `index.html` pulls, so the number above is the
 * whole first load. 21 §7.3 records the change in shape; 21 §4.4's chunking
 * question is still open.
 */
/*
 * ***Not raised on 2026-10-07, at the settings page's contents*** — saying out
 * loud what it added, as this file asks. The workbench lists the settings page's
 * sections over it, the page draws an anchor around each section and follows
 * the address's hash to one, and the three *open the dock* buttons became one
 * component. The shell also changed: `main` is now the containing block for
 * what its page positions, and a hash keeps the shell's scroll reset off. The
 * entry measured **298.46** before and **299.63** after: **+1.17 kB**, all the
 * client's own code, and **no new dependency**. It fits, and leaves **4.37**.
 */
/*
 * ***Raised to 312 on 2026-10-10, at [P16.2]*** — the World,
 * [P16](../docs/design/workplan/34-p16-world.md). Found by this file failing, as
 * it is meant to be: the stage's own checks were targeted and built no client,
 * and the isolated full run of `c511641` measured **304.77**. Measured stage by
 * stage from P16's base (alpha 6, `ad47e39`), **299.63**: **299.85** after P16.0
 * (the kind's rename — words, routes, the Worlds shelf in place of Packages);
 * **302.98** after P16.1 (+3.13 — the member picker, `MembersField.tsx`, with its
 * kind and name filters and its *Missing* badge, a session's *Add to a world…*
 * and *In these worlds*); **303.08** with P16.0's review fix to the assistant's
 * proposals; **304.77** after P16.2 (+1.69 — *Start in a world* on the session
 * form, what it fills in and takes back, and a World's page's two starts);
 * **304.81** with the `world` arm's schema, which the client bundles with the
 * rest of `shared`; and **306.79** with the arm's surface — the lorebook
 * editor's scope control (`BookScope.tsx`), the form's scope-named books, and
 * the shelf's *For worlds* filter. **+7.16 kB** in all, every byte the
 * client's own code, and **no new dependency**, which is the [21 §7] trigger.
 * Five kB of margin, as every raise above left. *The next candidate for a
 * `lazy()` is P16.3's own*: the publish review is a panel nobody sees until they
 * press Publish, the plainest case since the setup wizard's dialog, and it is
 * named here so P16.3 weighs it rather than meeting this ceiling and raising
 * again — still a loading decision, and the stage's to make, not this one's.
 */
/*
 * ***Not raised on 2026-10-11, at [P16.3g]*** — the publish review, the
 * selection on the shelves and the doors, with the ceiling held at 312 as the
 * stage was told. The review is a chunk of its own, as the note above asked
 * (`library/publish/PublishRoute.tsx` is the half the entry carries), and the
 * check below says so by name and by what it carries. Measured with this
 * file's compressor: **309.69** before the stage (P16.3f), **313.44** with the
 * review lazy but its `fileSet` dragged into a file the entry preloads —
 * `shared/src/publish.ts` was a module the entry already read, for
 * `SESSION_SCHEMA`, and the bundler splits by module — **311.66** once the two
 * names the entry reads moved to `shared/src/publish-constants.ts` and the
 * review stopped importing entry modules that would have been split out for it
 * (`queries.ts`, `ui/Field.tsx`, `save-file.ts`: each one a file the first load
 * then fetched). The stage's final figure is in its record. *What stays on the
 * entry*: the selection (`library/selection.ts`, `SelectionBar.tsx`), the two
 * doors on an object's page, the route and its boundary, the three `api.ts`
 * calls, and the World file's `publish.file.*` sentences, which the import
 * review reads too. The selection bar was not made lazy: it fits.
 * *(**311.84** after the stage's review fixes, the same day — the selection
 * let go of on an account switch, a book play wrote not chosen, the bar's
 * count a status that is always mounted, ids percent-encoded into the
 * review's address, and a publish's headers read before its body: **0.16 kB**
 * under, with the bar still on the entry.)*
 */
/*
 * ***Raised to 317 on 2026-10-11, at the final audit of [P16]*** — the audit's
 * fixes, the last of them a World's own page listing its members (sitting AA's
 * AA2 expects the page to say a member is gone, and it showed `contents` as
 * stored JSON). P16.3g left **311.84**; the audit's eight other fixes —
 * dropped memory text not travelling, a Setup made from a turn publishable,
 * the file's folders and `world.json` under current names, the suggested name
 * from what is carried, a legacy restore re-minting a held id — took it to
 * **312.00**, and the member list drawn on the page to **312.35**. **No new
 * dependency**, which is the [21 §7] trigger. *A split was measured and is
 * worse*: the list behind its own `lazy()` measured **314.41**, **313.93** with
 * fewer imports, and the whole member surface lazy **312.59** — the chunk
 * imports modules the entry already holds, the bundler then splits each into a
 * file of its own, and a small file compresses worse; removing the list
 * entirely still left **312.16**, since the member row it shares with the
 * editor stays either way. So the raise, with five kB of margin as every raise
 * above left. *The next remedy is measured and named*: the admin half of
 * Settings — Accounts, Connections, Install, Backups — behind one `lazy()`
 * measured **310.50** with every fix in, **−1.85 kB**; it needs a chunk-error
 * boundary and an off-the-entry check like the publish review's, which makes it
 * a loading decision of its own and not an audit fix's.
 */
/*
 * ***Lowered to 315 on 2026-10-13 — the remedy named above, taken*** before
 * the first stage of [P12A](../docs/design/workplan/35-p12a-the-look.md), whose
 * opening audit decided it rather than a raise at each of a phase of client
 * stages; [21 §7.5](../docs/design/21-client-loading.md) records the boundary.
 * The administration half of Settings is one `lazy()` chunk,
 * `settings/Administration.tsx`, fetched only for an administrator, and the
 * install's half of `Connections.tsx` moved out to `AdminConnections.tsx` with
 * it, since the user half keeps that file on the entry. Measured with this
 * file's compressor: **313.21** at P12A's base (`e460b637`: the 312.91 P16's
 * last build measured, with B20 on top), **310.30** after — **−2.91 kB**,
 * with the chunk **8.25** on its own. Imported statically again, with this
 * change's loading states kept, the half puts the entry at **313.44**; with only
 * `AdminConnections.tsx` reachable from the entry again (re-exported from
 * `Connections.tsx`), **311.67** — so splitting that file is 1.37 of the
 * drop. *(No record says what shape the 310.50 above measured.)* **No new
 * dependency.** *Why the drop is smaller than the chunk*: one more `import()`
 * of modules the entry already holds made the bundler split more of them into
 * files of their own that `index.html` preloads — sixteen JavaScript files
 * where there were ten — and a small file compresses worse; the sixteen
 * gzipped as one file would be 306.59. That is
 * [21 §4.4](../docs/design/21-client-loading.md)'s open question about common
 * chunks, recorded rather than tuned here. **The ceiling comes down** to leave
 * about five kB of margin, as every raise above left and as the changelog's
 * lowering did, rather than the 6.70 that 317 would leave for the next change
 * to spend without saying so: **315 leaves 4.70.** *And at 315 this ceiling
 * no longer catches the half imported statically* (313.44 is under it): the
 * check below, which reads the build for the chunk and for a sentence from
 * each of the half's four files, is what does.
 */
/*
 * ***Raised to 320 on 2026-10-13, at [P12A](../docs/design/workplan/35-p12a-the-look.md)
 * P12A.3*** — faces, found by this file failing as it is meant to be. The
 * lowering above left 4.70 for P12A.0 onward; P12A.0 to P12A.2, and the merge
 * that brought P16's two follow-ups under the phase (1.88 of it), spent 3.60,
 * and P12A.2's record named the **1.10** left as the next stage's first number
 * to read. Measured with this file's compressor: **313.90** before
 * the stage (`2a31f971`), **315.37** after — **+1.47 kB**, every byte the
 * client's own code and **no new dependency**, which is the [21 §7] trigger.
 * *Where it went*, each measured by taking it out of a build: a mention's
 * popover and the card it opens, **0.61** (314.76 without; the card alone
 * 0.15); the cast panel's *You play*, **0.14** (315.23 without); and the rest,
 * about **0.72**, is the face itself — `ui/Face` with the tile it draws, the
 * player's line's face that opens *You play*, a face on every cast row, an
 * actor's library row, page and editor header, the editor landing on its
 * aliases, and the move sent with its persona. *A split was measured and is
 * worse*: the mention's card behind its own `lazy()` measured **316.27**, since
 * everything it imports — the router's link, the library query, the face — is
 * on the entry already, the old finding of this file's notes above. So the
 * raise, to leave about five kB as every raise above left: **320 leaves
 * 4.63** for P12A.4 onward, every stage of which is client work too. The
 * remedy this file names whenever it is asked — a whole surface off the entry,
 * as the administration half went — is still the honest alternative, and the
 * note sentences with the library surface that is their only reader are still
 * the largest candidate; choosing one is a loading decision and not a face's.
 */
const JS_CEILING_KB = 320;

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

  /**
   * ***The changelog and its renderer are not on the entry, and this is the
   * check that says so*** — [21 §7.3](../docs/design/21-client-loading.md),
   * 2026-10-07.
   *
   * The wizard's argument a third time, with one difference: **the regression
   * is not only a static import of the chunk's module.** `home/readers.ts` is
   * the boundary, but `home/log.ts` or `ChangelogDocument.tsx` imported
   * statically from anywhere the entry reaches would put the text or the
   * renderer back while `readers-*` went on existing beside it. So this reads
   * the built files for what they carry rather than for what they are called:
   * the changelog's own preamble, and `allowedElements` — the renderer's
   * option `ChangelogDocument` passes, a property name minification keeps.
   * Each is asserted present somewhere first, so a marker that stopped
   * appearing fails here by name rather than passing because nothing matched.
   */
  it('keeps the changelog and its renderer off the entry', () => {
    const changelog = 'Every release tag has an entry here';
    expect(
      readFileSync(join(HERE, '..', 'CHANGELOG.md'), 'utf8'),
      'the marker is no longer in CHANGELOG.md: choose another line of its preamble',
    ).toContain(changelog);

    const chunks = readdirSync(join(DIST, 'assets')).filter((name) => name.endsWith('.js'));
    const carrying = (marker: string): string[] =>
      chunks.filter((name) => readFileSync(join(DIST, 'assets', name), 'utf8').includes(marker));
    const text = carrying(changelog);
    const renderer = carrying('allowedElements');
    expect(text, 'no chunk carries the changelog: it is not in the build at all').not.toEqual([]);
    expect(renderer, 'no chunk carries the renderer: the marker no longer finds it').not.toEqual(
      [],
    );
    expect(
      chunks.filter((name) => name.startsWith('readers-')),
      'no chunk named readers-* in dist/assets: the changelog readers are not a chunk of their own',
    ).not.toEqual([]);

    for (const name of entryAssets('.js')) {
      expect(text.includes(name), `${name} carries the changelog`).toBe(false);
      expect(renderer.includes(name), `${name} carries the renderer`).toBe(false);
      expect(name.startsWith('readers-'), name).toBe(false);
    }
  });

  /**
   * ***The publish review is not on the entry, and this is the check that says
   * so*** — [P16.3g](../docs/design/workplan/34-p16-world.md),
   * [21 §7](../docs/design/21-client-loading.md), 2026-10-11.
   *
   * The changelog's argument, a fourth time, and for its reason: **the
   * regression is not only a static import of the chunk's module.** The
   * review's weight is its own components *and* the rule it draws with —
   * `fileSet`, from `shared` — and P16.3g measured the second arriving on the
   * entry by another road while a `PublishPage-*` chunk went on existing: a
   * module the entry already read (`SESSION_SCHEMA`, in `shared/src/publish.ts`)
   * took the whole module onto a file the entry preloads. So this reads the
   * build for two markers as well as for the chunk's name: one of `fileSet`'s
   * note keys, which minification keeps because it is a string, and the
   * review's own sentence for a World file of nothing (AA13). Each is asserted
   * present somewhere first, so a marker that stopped appearing fails here by
   * name rather than passing because nothing matched.
   */
  it('keeps the publish review and its rule off the entry', () => {
    const chunks = readdirSync(join(DIST, 'assets')).filter((name) => name.endsWith('.js'));
    const carrying = (marker: string): string[] =>
      chunks.filter((name) => readFileSync(join(DIST, 'assets', name), 'utf8').includes(marker));
    const rule = carrying('publish.closure.orphan');
    const review = carrying('This file would hold the world’s name and nothing else.');
    expect(rule, 'no chunk carries fileSet: the marker no longer finds it').not.toEqual([]);
    expect(review, 'no chunk carries the review: the marker no longer finds it').not.toEqual([]);
    expect(
      chunks.filter((name) => name.startsWith('PublishPage-')),
      'no chunk named PublishPage-* in dist/assets: the publish review is not a chunk of its own',
    ).not.toEqual([]);

    for (const name of entryAssets('.js')) {
      expect(rule.includes(name), `${name} carries fileSet`).toBe(false);
      expect(review.includes(name), `${name} carries the publish review`).toBe(false);
      expect(name.startsWith('PublishPage-'), name).toBe(false);
    }
  });

  /**
   * ***The administration half of Settings is not on the entry, and this is the
   * check that says so*** — [21 §7.5](../docs/design/21-client-loading.md),
   * [P12A](../docs/design/workplan/35-p12a-the-look.md), 2026-10-13.
   *
   * The publish review's argument, a fifth time, and for the same reason: **the
   * regression is not only a static import of the chunk's module.** The half is
   * four files, and any one of them imported statically from anything the
   * entry reaches would put that section back on every first load while an
   * `Administration-*` chunk went on existing — the likeliest being
   * `AdminConnections.tsx`, which was part of `Connections.tsx` until this
   * split and is one re-export away from being part of it again. So this reads
   * the build for one sentence from each of the four, each a plain string the
   * minifier keeps: the accounts list's dead-end warning, the role table's way
   * out of a refused write, the install form's note on the data directory, and
   * the install's restore confirmation. Each is asserted present somewhere
   * first, so a sentence reworded in its file fails here by name rather than
   * passing because nothing matched.
   */
  it('keeps the administration half of Settings off the entry', () => {
    const chunks = readdirSync(join(DIST, 'assets')).filter((name) => name.endsWith('.js'));
    const carrying = (marker: string): string[] =>
      chunks.filter((name) => readFileSync(join(DIST, 'assets', name), 'utf8').includes(marker));
    const sections = {
      'AdminAccounts.tsx': carrying('has no usable connection and cannot send a message'),
      'AdminConnections.tsx': carrying('Apply my change to what is on disk'),
      'AdminInstall.tsx': carrying('Changing it here would write to the old location.'),
      'AdminBackups.tsx': carrying('Replace everything with this archive?'),
    };
    for (const [file, found] of Object.entries(sections)) {
      expect(found, `no chunk carries ${file}: its marker no longer finds it`).not.toEqual([]);
    }
    expect(
      chunks.filter((name) => name.startsWith('Administration-')),
      'no chunk named Administration-* in dist/assets: the administration half is not a chunk of its own',
    ).not.toEqual([]);

    for (const name of entryAssets('.js')) {
      for (const [file, found] of Object.entries(sections)) {
        expect(found.includes(name), `${name} carries ${file}`).toBe(false);
      }
      expect(name.startsWith('Administration-'), name).toBe(false);
    }
  });
});
