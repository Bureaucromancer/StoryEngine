# 27 — The pre-P6 walk: one list, eight sittings

**Status: open, and filled in as it is walked.** Opened 2026-09-07 at `854fe64`,
on branch `p6b`, after [P6B.1](24-p6b-playable.md) prepared P5's gate.
**Sitting A walked 2026-09-08 — nine of nine PASS**, on a `pnpm dev` install on
Windows. B onward move to a Docker install, which is why 1.0-alpha 3 exists.

**This is the working sheet [26](26-manual-ledger.md) implies and deliberately
is not.** That document counts what is owed; this one is what a person actually
does, in the order that costs least, with a place to write what happened. The
difference matters because they go stale differently: the ledger is true until
a phase closes, and this sheet is true for an afternoon.

**Scope: every gate before P6.** P1, P2, P2A, P2B, P2C, P3, P4 and P5 — three
phase gates of fifteen, fifteen and eighteen steps, P2C's four stages, and
[12 §2](12-p2-manual-gate.md)'s list, which is itself the residue of three more
gates. P6's, P6A's and P6B's own gates are **not** here; they are counted at
[26 §3.1–3.2](26-manual-ledger.md) and walked after.

---

## 0. What the condensing actually did

**Eighty-eight items across eight sittings, and they cover more than
eighty-eight gate steps.** The list is not shorter than the gates; it is
*sequenced*, and that is the useful transformation. The ledger's sharpest
finding was that the walks are not independent — P3 step 12, P4 step 1, P5
step 6 and PLAYABLE's fourth hypothesis all want *one real library and one long
session*, and one arrangement answers all four.

Three things happened to the source lists:

- **Duplicates merged.** One fresh install (A1–A8) is eight of
  [12 §2.1](12-p2-manual-gate.md)'s items, a step of P2's gate, two of P2A's and
  P2B's first — which is why those four gates were all "walked as far as
  automation goes" and all stuck at the same place. B1 and B2 then *re-run* the
  same eight against two endpoints rather than restating them.
- **Nine items already have their answer**, written into the cell rather than
  left blank: three `AUTO` with the test named, three `BLOCKED` with what they
  need and who arranges it, and three settled at [P6B.1](24-p6b-playable.md) as
  deferred or half-met with the phase that has the rest.
  [26 §7](26-manual-ledger.md)'s rule — a gate is walked, or deferred with an
  owner and a reason, and there is no third state — applies to steps as much as
  to gates. §4 lists the gate steps that never reach this sheet at all, because
  a test already does them.
- **Scattered obligations were given a sitting.** [P2C.2](15-p2c-first-real-run.md)
  added five scenarios that no other document has a home for; they are D18–D20,
  B6 and B8 rather than a list nobody opens.

**Two things this sheet does not do.** It does not restate a step's reasoning —
follow the citation, because the reasoning is why the step is worth walking. And
it does not hold findings: those go to [25](25-playable-log.md) in that file's
record format, so there is one log rather than two.

---

## 1. How to write a result

Six words, and only six, so that a filled sheet can be read at a glance:

| Result | Means |
|---|---|
| **PASS** | Walked, and it did what the step says. |
| **FAIL** | Walked, and it did not. Gets a finding in [25](25-playable-log.md), and the id goes in the cell. |
| **PART** | Walked, and it half did. The cell says which half; a finding carries the rest. |
| **BLOCKED** | Cannot be walked here. The cell says what it needs and who arranges it. |
| **DEFERRED** | Not this phase's. The cell names the phase that has it. |
| **AUTO** | A test does it. The cell names the test. No walk. |
| **CORRECTION** | The step describes behaviour the code does not have. **The step is wrong, not the code** — correct it in the phase document that owns it, and record that here. |

**`CORRECTION` is the one worth going looking for.** [P2C §3](15-p2c-first-real-run.md)'s
own account of the first P2B walk is that the three corrections it produced were
worth more than the ticks, and this sheet's citations were written from documents,
some of which are two phases old.

**Write the result the day you walk it, not afterwards.** A remembered outcome is
an opinion.

---

## 2. Arranged before the day, longest lead first

Nothing here is walkable on the day it is thought of.

| # | What | Wanted by | State |
|---|---|---|---|
| **R1** | **A real library somebody else made** — a SillyTavern data directory or a Marinara data root, permissively licensed or your own. The repository has none: `import/fixtures/` holds three synthesised files and one of them says so. | E1, E2, F1, F6 | **Not to hand.** [26 §3.4](26-manual-ledger.md). |
| **R2** | **A hosted endpoint with a real key.** | B1, C1 | **To hand** — used at A3 on 2026-09-08. |
| **R3** | **A local runtime** (Ollama, LM Studio, llama.cpp) with one model. | B2, B8, G | — |
| **R4** | **A non-author for forty-five minutes**, with the README and a URL and nothing else. | A9 | See §3.A's note — this one has partly expired and cannot be recovered by trying harder. |
| **R5** | **A second machine on the network**, to sign in from. | B6 | — |
| **R6** | **An ubuntu box or VM.** Everything this project has ever done was verified on Windows. | H1, H2 | — |
| **R7** | **A full text editor and a file manager** on the machine running the server — not `fs`, not the IDE. | D18 | Trivial, but it is the point of the step. |

---

## 3. The sittings

Ordered so that each one leaves behind what the next needs. **A–D need nothing
arranged but an endpoint; E and F want R1; G is the long one; H is the other
platform.**

Run everything under `pnpm dev:logged` from B onward, so the sittings leave a
cassette corpus behind rather than a memory — that is
[26 §5](26-manual-ledger.md)'s first should-be-a-test, and the machinery has
existed since P4 with **no cassette ever promoted**.

---

### ~~A — Fresh install, first contact~~ Walked 2026-09-08 — *nine of nine PASS*

**A clean sweep, and the first thing this project has ever walked end to end.**
It clears [12 §2.1](12-p2-manual-gate.md) entirely — the eight-item sequence
that three separate gates each ask for in their own words — and
[P2C.1](15-p2c-first-real-run.md), the first-contact stage that had never run.

**A8 passed with nothing written in the *what did you have to guess* column**,
which is the answer [01 §4.1](01-work-plan.md)’s fourth hypothesis wanted and
the one it calls likeliest to be wrong. Worth saying plainly rather than
ticking: the hypothesis survived its first contact with a real turn. It has not
yet met a long one, which is [G](#g--the-long-pass--hours-unscripted-and-it-is-also-p6b2)
and is where P3 step 12 expects it to get harder.

*Walked against a `pnpm dev` install on Windows.* The same nine run again on
Docker as the first half of [B](#b--the-scripted-session-against-both-endpoints--about-two-hours),
because a container is a different install and A1’s *open the address the
server prints* is exactly the line that was wrong on the first unraid install
([P6A §3](23-p6a-alpha-1.md)).

*The sitting as it was written:*

```bash
pnpm reset-data && pnpm build && pnpm dev
```

**Do A9 first, before anything else in this sheet.** It is the only item here
that is destroyed by having already looked.

| # | Do | Clears | Result |
|---|---|---|---|
| **A9** | **Write down, before opening the browser, what you expect each screen to do.** Then walk A1–A8 and treat every divergence as a finding. Where you looked first, what you expected a control to do before clicking, and every point at which you consulted the source instead of the screen — that last one is the signal. | [P2C.1](15-p2c-first-real-run.md) | PASS |
| **A1** | Open the address the server prints — the **client's**, not the API's. Create the first admin. Reload; sign out and back in. | [12 §2.1.1](12-p2-manual-gate.md), P2B 1 | PASS |
| **A2** | **Settings → Administration.** The account list should say *1 person has no usable connection and cannot send a message…*. Read it as a stranger would; it is the one piece of copy whose whole job is to be understood by somebody stuck. | [12 §2.1.2](12-p2-manual-gate.md), [12 §2.4](12-p2-manual-gate.md), P2A 1 & 7 | PASS |
| **A3** | Add a connection with a real key. The model list fetches as an assist and saves without it; a **refused key** says so in its own sentence rather than reading as an unreachable endpoint. | [12 §2.1.3](12-p2-manual-gate.md) | PASS |
| **A4** | The two-picker default-binding form appears on its own after the first connection saves. Answer it. | [12 §2.1.4](12-p2-manual-gate.md) | PASS |
| **A5** | Back to the account list: the dead-end count goes to zero **after the binding, not after the connection** — the count asks whether `prose` resolves, through the turn's own resolver. | [12 §2.1.5](12-p2-manual-gate.md) | PASS |
| **A6** | Start a session, send a message, watch the reply stream. | [12 §2.1.6](12-p2-manual-gate.md), P2 9 | PASS |
| **A7** | Send another and **reload the page while it is streaming.** The finished turn should be there. | [12 §2.1.7](12-p2-manual-gate.md), P2 9 | PASS |
| **A8** | Open *Turn record* and read it. **Could you tell from this alone why the turn came out the way it did?** Write down what you had to guess. | [12 §2.1.8](12-p2-manual-gate.md), [12 §2.4](12-p2-manual-gate.md) | PASS |

> **A9 has partly expired, and the sheet should say so rather than pretend.**
> [P2C.1](15-p2c-first-real-run.md) calls the stranger's view *perishable* and
> names the problem it cannot solve: the tester is the person who built this.
> The mitigation in order of preference is a borrowed non-author (R4), then a
> screen recording watched a week later, then written-in-advance predictions —
> which is what the row above asks for, and which is the closest an author gets
> to not knowing. **Whatever is done, record which of the three it was**, because
> a prediction-based A9 and a stranger-based A9 are not the same evidence.

---

### ~~B — The scripted session, against both endpoints~~ Walked 2026-09-08 — *six of nine; three unconfirmed*

**B1, B3, B4, B5, B7 and B9 pass.** The wire format holds against a real
endpoint: chunks arrive incrementally, `usage` comes back populated, the
resolved model is the one that answered, and cost is `null` rather than the
fabricated zero. Two admins on the settings page get both halves of the 412.

**B2, B6 and B8 are not marked**, because each needs a resource §2 records as
unconfirmed — a local runtime (R3) for B2 and B8, a second machine (R5) for B6 —
and a walk that may not have happened is the one thing this sheet must never
assert. They are blanks on purpose.

**B9 passed its stated check and produced a refinement anyway** — the 412
behaves, and the connection surface around it is thin. That is [F-02] and it is
not a half-failure of B9; the sheet keeps the two apart on purpose.

*The sitting as it was written:*

**Every automated test in this repository runs against `FakeProvider`.** The
shipped adapter's wire format is asserted only against a stub this repo wrote,
and a stub agrees with whatever it was written to agree with.

| # | Do | Clears | Result |
|---|---|---|---|
| **B1** | Run A1–A8 against a **hosted** endpoint. | [12 §2.2](12-p2-manual-gate.md) |PASS |
| **B2** | Run A1–A8 against a **local runtime**. They fail differently, which is the reason for both. | [12 §2.2](12-p2-manual-gate.md) | |
| **B3** | Chunks arrive **incrementally**, not in one lump. | [12 §2.2](12-p2-manual-gate.md) |PASS |
| **B4** | `usage` comes back populated; `ModelCall.resolved` names the model that **answered**; the turn's cost is **`null`, never `0`** — no price table ships, so a zero is a fabrication. | [12 §2.2](12-p2-manual-gate.md), P3 4 |PASS |
| **B5** | *Fetch models* against both, and against something that does not implement `/models` at all. Several local runtimes answer with one entry called `gpt-3.5-turbo` regardless of what is loaded. | [12 §2.2](12-p2-manual-gate.md), P2B 2.6 |PASS |
| **B6** | **Be a second user.** Create a non-admin, sign in from a second browser profile (R5), take a turn on the system connection, then revoke `privateConnections` and watch what the turn does. That capability is enforced in the resolver and its enforcement has never been seen from outside. | [P2C.2](15-p2c-first-real-run.md) | |
| **B7** | **Two tabs on one session.** Server fan-out is asserted; two real clients rendering the same deltas is not. | [12 §2.3](12-p2-manual-gate.md) |PASS |
| **B8** | **Two sessions at once** against the local runtime — one model slot, no queue, no concurrency cap. Whatever happens is the finding. | [P2C.2](15-p2c-first-real-run.md) | |
| **B9** | **Two admins on the settings page.** Save in one, then the other. Both offers of the 412 should work — *load what is on disk* and *overwrite with mine* — and a plain Save in between should still be refused. | [12 §2.3](12-p2-manual-gate.md) |PASS |

---

### ~~C — Break it on purpose~~ Walked 2026-09-08 — *eleven of eleven PASS*

**The half most likely to be skipped, and it held.** Every deliberate breakage
surfaced as a *classified* failure rather than a provider string: a wrong key, a
model id that does not exist, an endpoint answering HTML, the network cut
mid-stream. The ten-token ceiling came back as `outcome: 'truncated'` and not as
an error class, which is the distinction the field exists to draw and the one
thing here a test could not have told us.

**The three copy judgements passed too** — the removal dialog, the capability
groups, the restart banner. Those are opinions by construction
([25](25-playable-log.md): *a judgement is a finding*), and recording them as
passes is recording an opinion, which is what the step asks for.

*The sitting as it was written:*

**The valuable half, and the easy half to skip because nothing is going wrong
yet.** Each of C1–C5 should surface as a *classified* failure rather than a
provider string in the UI — except C3, which is not a failure at all, and telling
those apart is the point of the field.

| # | Do | Clears | Result |
|---|---|---|---|
| **C1** | Wrong key. | [12 §2.2](12-p2-manual-gate.md), P2 |PASS |
| **C2** | A model id that does not exist. | [12 §2.2](12-p2-manual-gate.md) |PASS |
| **C3** | **A completion ceiling of ten tokens.** No UI for this: hand-edit `preset.params.maxTokens` in the session's own `session.json`, a one-line edit, since a created session carries a full inline preset. Expect **`outcome: 'truncated'`** on the call, not an error class. | [12 §2.2](12-p2-manual-gate.md), [P2C.2](15-p2c-first-real-run.md) |PASS |
| **C4** | An endpoint that returns HTML. | [P2C.2](15-p2c-first-real-run.md) |PASS |
| **C5** | The machine's network off mid-stream. | [P2C.2](15-p2c-first-real-run.md) |PASS |
| **C6** | **Kill the server mid-turn** (Ctrl-C), restart, reload. The partial turn is recorded failed and the session is usable. | [12 §2.3](12-p2-manual-gate.md) |PASS |
| **C7** | **Sleep the laptop mid-turn**, wake it, watch the stream reconnect. Materially different from an aborted socket: a sleeping machine's socket dies without a close, and the resume goes through `Last-Event-ID` on a connection the browser reopened itself. | [12 §2.3](12-p2-manual-gate.md) |PASS |
| **C8** | **Close the tab mid-generation and reopen.** Automated at the socket level; a browser's actual unload is not. | [12 §2.3](12-p2-manual-gate.md) |PASS |
| **C9** | Start removing an account and **read the dialog before clicking.** It is the one piece of copy somebody would want to have read beforehand, and the only test of it is whether it reads that way. | [12 §2.4](12-p2-manual-gate.md) |PASS |
| **C10** | **The capability groups.** *In force now* against *recorded for later*: does the second read as honest, or as an excuse? | [12 §2.4](12-p2-manual-gate.md) |PASS |
| **C11** | **The restart banner.** Does *StoryEngine does not restart itself* answer the question it raises, or invite it? | [12 §2.4](12-p2-manual-gate.md) |PASS |

---

### D — The workbench, the record, and the disk — *walked to D10, 2026-09-08*

**D1–D10 pass. D11–D20 are outstanding.** The panel toggles from the keyboard
over both views, survives navigation and reload at the same size, is reachable
from nowhere else, and answers *what is about to fall out of context* without
generating anything. The live half — the running step named, a skip explained, a
failure attached to its step — works, and swaps to the record on commit.

**And the sitting produced the most valuable finding of the walk so far, which
no D item asked for.** P3 built a drag handle for the panel and
[P3 §4](05-p3-implementation.md) names it as the surface for the stored size.
It has been **zero pixels tall since P3** — `inset-block-0` is not a Tailwind
utility, Tailwind emits nothing for a name it does not know, and an
absolutely-positioned element with no block inset has no height. Only the
keyboard half of that control has ever worked. See [F-05].

*That is a gate correction as much as a finding:* D2 asks that the panel come
back **the same size**, and it does — because the size is stored and the only
thing broken is the mouse affordance for changing it. The step passes over a
control that is not there, which is exactly the shape of check this sheet's
`CORRECTION` vocabulary exists for.

*The sitting as it was written:*

P3's whole gate, plus the three storage scenarios [P2C.2](15-p2c-first-real-run.md)
added that nothing else has a home for.

| # | Do | Clears | Result |
|---|---|---|---|
| **D1** | Toggle the panel from the keyboard over **both** Play and Library. Typing in the action input or the guidance box does not fire it. It **insets** rather than replaces; Tab passes through; it is not `aria-modal`. | P3 1 |PASS |
| **D2** | Open the panel, then **Play → Library → Play**: still open, same size, subject changed with the view. Then reload: still open, same size. | P3 2 |PASS |
| **D3** | **Nothing switches it on.** No debug mode, no advanced toggle, no nav entry, nothing in Settings. | P3 3 |PASS |
| **D4** | Over a turn: every block's source is clickable through to the object; **no `unknown` sources**; the resolved model is the one that *answered* — and a cancelled or failed call truthfully records the one that was *asked*. | P3 4 |PASS |
| **D5** | *What is about to fall out of context* is answered from the verdict **without generating anything** — and on a turn with headroom it does not claim the system instruction is about to fall out. | P3 5 |PASS |
| **D6** | Per-block estimate beside per-call reported, on a turn where they differ. | P3 6 |PASS |
| **D7** | **The meter reflects the pending input.** Type into the action box: the fill changes with nothing sent. Clear it: it falls back to the head. With nothing bound to `prose` the meter is still there, saying it cannot measure and why. | P3 6a |PASS |
| **D8** | Over a library object: the as-stored view matches the bytes on disk — **hand-edit the file and watch the panel follow**; the folder path is one you can paste into a file manager; the revision list is there **with no restore button**. | P3 7 |PASS |
| **D9** | Over a **shadowed** object, the index rows name the winning path. | P3 8 |PASS |
| **D10** | **The panel says what is happening while it happens.** Take a turn with it open: the running step is named, a skipped step says why, a failure attaches to the step rather than the turn — and on commit the panel shows the record instead, with neither view lingering beside the other. | P3 8a |PASS |
| **D11** | **Compare.** Hand-edit the session's own copied preset on disk, drop a block's priority, take the same turn again: the compare view shows exactly what changed, and its address can be pasted into a bug report. | P3 9 | |
| **D12** | **The replay path is wired** — a committed tape can be handed to a runner and replays. *Not* identical draws; that moved to P5 and then to P6. | P3 10 | |
| **D13** | **Dry run**, if P3.7 shipped: inspect then send → one record; abandon → nothing sent, nothing charged, and a restart does not commit it. The pending state is visible and the session says it is busy. | P3 11 | |
| **D14** | **The legibility claim itself.** Somebody who did not build the turn opens the panel on a real turn they did not script and says why it came out that way — without the log, the source, or a JSON pretty-printer. **And its honest counterpart:** at least one turn where the answer is *I could not tell*, written down with what was missing. | P3 12, [26 §3.3](26-manual-ledger.md), PLAYABLE hyp. 4 | |
| **D15** | **Density.** A turn with thirty blocks reads as a table rather than thirty disclosures; nothing that belongs on screen is behind a click for calm's sake; the panel open over Play does not squeeze the transcript into a column nobody can read. | P3 13 | |
| **D16** | **The phone.** At 375px the same toggle produces a full-height sheet with the same content, the view under it does not scroll horizontally, and the sheet is dismissable one-handed. | P3 14 | |
| **D17** | **A rejected effect, visible with its reason.** *The step was flagged unperformable* — Scene shipped one step that writes nothing. **Re-check before walking:** P5.6 ships `se.lore.timing` effects and [P6B.1](24-p6b-playable.md) made two of them on one channel distinguishable, so the *rendering* half may now be walkable even if nothing yet proposes a **rejected** one. If it is still unperformable, that is a `DEFERRED` with the phase that ships an effect-producing step. | P3 15 | |
| **D18** | **Use a real editor, not `fs`.** Every write the watcher has ever seen came from node. Save once from a full editor, once from Notepad, and once as an Explorer copy-over, watching an open detail page. `awaitWriteFinish` has a 150 ms stability threshold and real editors write in ways `fs` does not. | [P2C.2](15-p2c-first-real-run.md) | |
| **D19** | **Hand-edit a committed turn** on disk. No route edits, deletes or re-runs one; the file is there, and what happens when somebody changes it is a storage question no test asks. | [P2C.2](15-p2c-first-real-run.md) | |
| **D20** | **The version history panel** — the app's only editing surface beyond the actor form, and on nobody's list. Edit five times, restore an old one, confirm **the restore is itself recorded**. | [P2C.2](15-p2c-first-real-run.md) | |

---

### E — Import, for real — *about an hour and a half, and it wants R1*

| # | Do | Clears | Result |
|---|---|---|---|
| **E1** | **Sweep a real SillyTavern data directory.** Populated library, review report at an address, nothing crashed, and **every file the sweep saw accounted for** — converted, recorded, skipped-by-position, or counted as unrecognised. | P4 1, P4 7 | **BLOCKED** — R1. Named outstanding by the step itself, which is why P4 could close without it. |
| **E2** | **The same for a Marinara data root.** | P4 1 | **BLOCKED** — R1. |
| **E3** | **The credential drop.** A preset with `proxy_password` → imported, credential gone from the object *and* from `compat`, review names the removed fields, and **no "import as-is" affordance exists anywhere.** | P4 3 | |
| **E4** | **Depth.** A depth-4 block sits four **messages** from the end in the block list — not at the top, not eight back. | P4 4 | |
| **E5** | **Macros, both halves.** An unrecognised macro imports verbatim and flagged; a recognised one renders through Liquid; **no literal `{{`** from the closed table's set reaches a rendered message. | P4 5 | |
| **E6** | **Re-import the same directory, of each kind.** Unchanged objects skip and are reported unchanged; a changed one offers replace or keep-both; nothing doubles silently. The Marinara arm is the sharper test — `originalFilename` for a row in a table is not a filename anyone typed. | P4 6 | Partly **BLOCKED** — the fixture arm is walkable now; the real arm wants R1. |
| **E7** | **One poisoned file never aborts a sweep.** A deliberately corrupt card is a `warn`-class row and the sweep completes around it. | P4 8 | |
| **E8** | **Rebuild equals incremental, after a bulk import** — run against the post-import library rather than a synthesised one. | P4 9 | |
| **E9** | **The config surface is honest.** `limits.maxUploadMb` reads `applied`; the `fileAccess` grant surface is somewhere an admin can reach **and says what it grants**, naming the sweep and not only the browser. | P4 10 | |
| **E10** | **The report is data.** Fetch the review over the API: reason classes, counts and parameters, **no stored English prose** — the sentences are composed client-side from the reason class. | P4 11 | |
| **E11** | **Undo is real in-app.** Delete a badly-imported object from the client; the tombstone behaviour is visible and the library reflects it. | P4 12 | |
| **E12** | **The three refusals**, each refusing **before anything is written**, each with a message a person can act on: a held `.writer-lease`, a `.migrating` marker, and a manifest declaring a format we do not know. A half-import is worse than no import. | P4 14 | |
| **E13** | **`.bak` does not double the library.** A root with a `.bak` beside every table imports the same object count, and the review reports them skipped. | P4 15 | |

---

### F — Lore under pressure — *about two hours, and F1/F6 want R1*

**Start here, because until [P6B.0](24-p6b-playable.md) nobody could:**

```bash
pnpm reset-data && pnpm seed && pnpm dev
```

then start a session **naming a treatment and a book**, take a turn, and open the
workbench. The lore report should show entries firing with their reasons. That
single walk is [P6B](24-p6b-playable.md)'s own verification and the entry point
to everything below.

| # | Do | Clears | Result |
|---|---|---|---|
| **F0** | The seeded end-to-end above: a session that resolves books, a turn, and a lore report with reasons. | [P6B §3](24-p6b-playable.md) | |
| **F1** | **A three-hundred-entry imported book opens as something readable**, and a named entry is reachable by its own address — the link survives a reload and lands on that entry. | P5 1 | |
| **F2** | **An entry that will not fire says why**, distinguishing *off*, *its folder is off*, and *the book is off* — and the folder case leaves the entry's own `enabled` **visibly unchanged**. | P5 2 | |
| **F3** | Filtering within a book by a key chip, a tag and a folder each narrows the list; the panel's own filters narrow the shelf. | P5 3 | |
| **F4** | A search phrase occurring in exactly one entry returns **that entry** with a snippet, across books. | P5 4 | |
| **F5** | An entry is created, edited and deleted through the real write path, and a collapsed section in the editor names its non-default values. | P5 5 | |
| **F6** | **Open a book you did not author** and judge whether the page reads as a document or as a form. | P5 6 | **BLOCKED** — R1, with lead time. Settled as person-blocked at [P6B.1](24-p6b-playable.md); this is its outcome, not a blank. [26 §3.4](26-manual-ledger.md). |
| **F7** | **An imported ST lorebook fires on its keywords in a real session** — entries appear as blocks with `keyword match: "…"` reasons. | P5 7 | |
| **F8** | **Timing, three cases and they are not the same case.** A sticky entry **counts down in the block list** and says when its window closes; cooldown and ephemeral are legible in the record through their effects, now that two on one channel can be told apart. **`delay` is not** — record that rather than hunting for it; its only trace is a skip reason, and skip reasons reach the preview and never the record. | P5 8 | |
| **F9** | **Recursion.** An activated entry's text activates another; `preventRecursion` et al. honoured; no runaway at the book's depth limit. **Use a chain of width more than one** — every automated recursion test is width one, which is how [P6B.1](24-p6b-playable.md)'s haystack defect survived. | P5 9 | |
| **F10** | **Budget pressure.** A book over its `tokenBudget` drops entries in the documented order, each skip named with the blocking budget, and a small entry still fits after a large one dropped. **Spot-check `tokenBudget: 0`** — it now means unlimited, which is the first contradiction settled. | P5 10 | |
| **F11** | A rewrite reproduces identical activations. | P5 11 | **PART / DEFERRED.** P5's half — the keying — is met. The reproduction half is [P6 §3](08-p6-implementation.md) step 3's; there is no production replay entry point to look for. Settled at [P6B.1](24-p6b-playable.md). |
| **F12** | An entry conditioned on a channel that does not exist → visible warning, never fires, nothing blocks. | P5 12 | **DEFERRED — P7.** No entry can be conditioned on a channel; the schema lists `activationConditions` as deliberately absent. [01 §195](01-work-plan.md)'s row moved and [P7 §0.1](18-p7-implementation.md) carries it. *Do not credit `unknownSources` here* — such an entry keeps scanning and can still fire. |
| **F13** | **The keyword tester answers *why does this entry never fire*** without playing a turn — and where the answer is a gate or a disabled book rather than a match, **it agrees with what the book page already showed.** Disagreement here is the failure P5.7 exists to prevent. | P5 13 | |
| **F14** | Timing counters reconstruct correctly at an old node. | P5 14 | **AUTO** — `sessions/reconstruct-property.test.ts`, discharged at P6.0a: four turns with a sticky, a cooldown and an ephemeral entry, replayed at every node of a forked session. |
| **F15** | **A hostile pattern from an imported book does not hang the server.** A catastrophically backtracking regex is abandoned at the timeout, the entry reports why, and the turn completes. The one gate step about somebody else's file being able to hurt you. | P5 15 | |
| **F16** | **The book page says what the import did to it** — a book whose entries lost something on the way in says so on the page, not only in the review. | P5 16 | |
| **F17** | The five delete sites are one, and the property can see them. | P5 17 | **AUTO** — `index-db/rebuild-property.test.ts` (`pnpm test:gate`), with the `orphan-fts` assertion added at [P6B.1](24-p6b-playable.md); before that, deleting one of the five left the suite green. |
| **F18** | The fixture-pair gate is green with lore as a producer. | P5 18 | **AUTO** — `import/fixture-pair.test.ts` (`pnpm test:fixture-pair`). |

---

### G — The long pass — *hours, unscripted, and it is also [P6B.2](24-p6b-playable.md)*

**Not a second scripted pass with a different list.** The point is duration and
accumulation: forty turns, a library with things in it that were made rather than
seeded, an index written to all afternoon, a watcher that has seen a hundred
events. None of the automated tests run long enough to be interesting, and none
of A–F leaves anything behind.

**Play it rather than test it.** The scripted pass answers whether a turn works;
this answers whether forty do.

| # | Watch for | Clears | Result |
|---|---|---|---|
| **G1** | Memory and handle growth; a session that gets slower as it gets longer; index and watcher disagreement after a lot of writes; SQLite lock contention; a keepalive that stops keeping alive. Look at the server's memory and the log **afterwards**, rather than not. | [P2C.3](15-p2c-first-real-run.md) | |
| **G2** | **The turn record getting harder to read as the thing it records gets longer.** This is the one that only shows up here. | [P2C.3](15-p2c-first-real-run.md), P3 12 | |
| **G3** | **The four PLAYABLE hypotheses** ([01 §4.1](01-work-plan.md)) — is the record legible; does hand-editing a card mid-session take; is one budgeter comprehensible under pressure; do inclusion reasons explain anything. The fourth is the one 01 calls likeliest to be wrong. | PLAYABLE | |
| **G4** | **P5's four held-open questions** — the trim order, whether the per-book budget tier earns its keep, whether recursion depth needs a surface, whether the keyword tester is the diagnostic or a consolation. Observation prompts are already written at [P5 §0.3](07-p5-implementation.md). | P5 `[AWAITS PLAYABLE]` | |
| **G5** | **P6's two** ([P6 §5](08-p6-implementation.md)) — which reply an edit changes, and whether the sibling affordance is enough to find a line abandoned twenty turns ago. | P6 §5 | |

---

### H — The other platform — *about half an hour*

**Everything this project has ever verified was verified on Windows.** CI runs
the suite on ubuntu and `ci-shape.test.ts` stops that matrix being deleted
quietly — but CI does not *run the application*, and path handling, file watching
and SQLite locking are the three places this codebase has already been bitten,
all three platform-shaped.

| # | Do | Clears | Result |
|---|---|---|---|
| **H1** | Start the server on ubuntu (R6) and play a turn. | [12 §2.5](12-p2-manual-gate.md) | |
| **H2** | Hand-edit a library file from a Linux editor and watch the panel follow — the watcher half, which is the one with a platform-shaped history. | [12 §2.5](12-p2-manual-gate.md), P3 7 | |

---

## 4. Already discharged, and by what

Listed so the count is honest. **Nobody walks these.**

| Step | Result | By |
|---|---|---|
| **P1's gate** | **AUTO** | The named gate test, run in CI on every push. [26 §1](26-manual-ledger.md)'s only row with nothing owed. |
| **P4 2** | **AUTO** | `import/fixture-pair.test.ts`, a named CI step: no `empty-source` rows for persona, actor, history or input, no `unknown-slot` rows at all. |
| **P4 13** | **AUTO** | `import/registries/registries.test.ts` over the two vendored snapshots — every ST directory key and Marinara table maps to a disposition, and a name in neither imports as unrecognised-and-counted. |
| **P5 14** | **AUTO** | See F14. |
| **P5 17** | **AUTO** | See F17. |
| **P5 18** | **AUTO** | See F18. |
| **P2 / P2A / P2B** | **AUTO in part** | 8 of 20, 13 of 17+2, and 9 of 11 respectively. The residue is [12 §2](12-p2-manual-gate.md), which is sittings A–D above. |
| **P3 1–11** | *Assertable, coverage unaudited* | Marked "assertable" by [P3 §4](05-p3-implementation.md), but **which of them a test actually asserts has never been checked.** They are in sitting D as browser checks because confirming one takes a minute and auditing eleven takes an afternoon — and a step believed covered is exactly what [P6B.1](24-p6b-playable.md) found four of. |

---

## 5. Where a finding goes

**[25](25-playable-log.md), in that file's format** — build, endpoint, session,
**expected before observed**, snapshot. One log, not two: these sittings and
[P6B.2](24-p6b-playable.md)'s play are the same evidence gathered on different
days, and splitting them would make the triage read two files and reconcile
them.

**Nothing is fixed because it is written there.** That is the log's own standing
rule and the reason it stays honest: a finding that has to justify a fix before
it can be recorded is a finding that does not get recorded.

**Triage by [P2C §2.5](15-p2c-first-real-run.md)'s five destinations**, decided
in advance because afterwards every finding argues for its own importance:
**stops the phase / fixed inside it / a gate correction / polish / a later phase
or the roadmap.** Nothing is allowed to have no home.

---

## 6. Closing a gate

A gate closes when **every one of its steps has a result** — not when every step
passes. `BLOCKED` and `DEFERRED` are results; a blank is not.

When one closes, three things happen and the third is the one that gets skipped:

1. The phase document's status line says so, with the date and what was left.
2. [26 §1](26-manual-ledger.md)'s row changes.
3. **Every `CORRECTION` is written back into the document that owns the step.**
   The corrections are worth more than the ticks — that is
   [P2C.4](15-p2c-first-real-run.md)'s claim, made from the one walk this project
   has actually completed.

| Gate | Steps | Sittings that cover it | Walked so far | Closed |
|---|---|---|---|---|
| **P1** | — | — (AUTO) | — | **Yes** |
| **P2 / P2A / P2B** | 20 / 17+2 / 11 | A, B, C, D18–D20, H | **A, B (less B2/B6/B8), C** — [12 §2.1](12-p2-manual-gate.md) entire, §2.2 against one endpoint, §2.3 in part and all of §2.4 | |
| **P2C** | 4 stages | A9 (.1), A–D (.2), G (.3), §5 (.4) | **P2C.1**, on 2026-09-08 | |
| **P3** | 15 | D | **steps 1–10**, 2026-09-08, plus one gate correction ([F-05]: the drag handle has never had a height) | |
| **P4** | 15 | E | | |
| **P5** | 18 | F | | |

*Sittings walked: **A** (nine of nine), **B** (six of nine; B2, B6 and B8 want a local runtime and a second machine), **C** (eleven of eleven), **D1–D10** — all 2026-09-08. D11–D20 and E–H outstanding. **Thirty-six items have a result; fifty-two do not.***
