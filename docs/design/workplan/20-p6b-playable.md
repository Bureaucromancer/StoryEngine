# 20 — P6B implementation plan: the close-out, and the first real play

**Status: ~~plan~~ open, and it is the last phase open.** Opened 2026-09-07 at
`7b6a0d9`, main's tip after Alpha 2 was cut. **P6B.0 and P6B.1 are landed**
(`bf14ce6`, shipped as 1.0-alpha 3); **P6B.3's triage ran 2026-09-09** and
routed all twenty findings seen so far. **What holds the phase open is
P6B.2 — the play itself — and it is a person's.**

**This phase does not close on its buildable work**, which is the one place
[manual testing §0](05-manual-testing.md)'s two-tier gate does not buy a close:
P6B.2 *is* PLAYABLE, the checkpoint [work plan §7](01-work-plan.md) calls
skipping *"the single most expensive economy available in this plan."* Its
critical list is [sitting K](05-manual-testing.md) — two sittings and an hour of
desk work — and §3.1 records which gate steps it answers and which it hands on.
**The instrument is repaired and the checkpoint has begun. PLAYABLE has not
run.** Written the day it opens, like [P6A](19-p6a-alpha-1.md) and for the same
reason: every precondition is checkable today rather than on the day, because
two audits have already checked them.

**P6B delivers one thing, and the rest is what that thing needs:** *PLAYABLE,
actually run.* [work plan §4.1](01-work-plan.md) scheduled it at the end of P4 and
called it the milestone that matters most. P5, P6 and P6A have landed since. It
has still not happened, and this document exists because the reason it has not
is now known, small, and written down twice.

**The demo that defines done:** *a person sits down with an imported library,
plays for several sittings, and the four hypotheses in
[work plan §4.1](01-work-plan.md) come back answered — with every finding in
[playable log](21-playable-log.md) and every finding given a home.*

**Citations follow the corpus convention**; code paths are relative to
`packages/<pkg>/src`.

---

## 0. What this phase is, and the correction it opens with

**It is not new work.** It is the checkpoint three phases of construction were
supposed to be built on, plus the smallest set of repairs that make its findings
trustworthy. Every stage below is either *the thing that was already owed* or
*evidence repair*, and
[§0.3](#03-the-bar-for-pre-work-and-the-line-it-must-not-cross) is the bar that
keeps it that way.

**The one-sentence history.** [work plan §4.1](01-work-plan.md) says *at the end of P4,
stop and play with it*, and calls skipping it
*"the single most expensive economy available in this plan"*
([work plan §7](01-work-plan.md)). Nobody stopped. P5 built the retriever, P6 built the
tree, P6A cut a release. The checkpoint is now three phases overdue and the
phase in front of it — [P7](23-p7-implementation.md) — is the one that
publishes the mode contract as an SDK.

### 0.1 Readiness — why it has not run, audited 2026-09-07 at `7b6a0d9`

**Two independent audits name the same obstacle, twelve weeks apart in document
time and five days apart in real time.** [P5 §0.5](17-p5-implementation.md)
(2026-09-02) calls it *"the single largest thing between this phase and an
honest close"*; [P7 §0.1](23-p7-implementation.md) (2026-09-07) re-checked it
and found it unchanged. It is this:

**Nothing anywhere chooses a session's lorebooks.**

- `client/src/api.ts:638-640` — `createSession` sends `{ name }` and nothing
  else, though `POST /api/sessions` has accepted `treatment` and `lore` since
  P5.6 (`routes/sessions.ts:84-112`).
- `PUT /api/sessions/:id/lore` (`routes/sessions.ts:429-442`) exists, writes
  both fields, and **has no caller in `packages/client`**. Its only callers are
  tests.
- `tools/seed.mjs:164` builds a treatment with a lorebook link twenty lines
  earlier and then creates its session naming neither.

So `pnpm seed` produces a session that resolves **zero books**, and a session
made in the browser cannot resolve any at all. `resolveLore`
(`turns/lore.ts:200-206`) reads the named treatment's links and the session's
own list; with both empty, `retrieve` returns nothing, and the workbench's lore
report renders nothing at all (`workbench/turn/LoreReportView.tsx:102`) — by a
deliberate rule that a session using no book should not be told about a
subsystem it is not using.

**Which makes the checkpoint's own subject untestable.** Two of the four
hypotheses [work plan §4.1](01-work-plan.md) lists — *one budgeter over everything is
comprehensible* and *inclusion reasons are a product feature* — are about
retrieval under pressure. There is nothing to put under pressure. The fourth is
the one 01 calls likeliest to be wrong and cheapest to fix here.

**And one defect would make a hypothesis come back wrong rather than absent**,
which is worse. See
[§1.4](#14-the-single-lore-slot-is-a-decision-about-the-preset).

### 0.2 What is *not* blocking, checked rather than assumed

Worth recording, because a readiness note that only lists faults invites
over-scoping:

- **The provider boundary is wired.** This checkout has two configured
  connections under `data/system/connections`, a `data/system/bindings.json`,
  and three sessions with recorded turns. [P4 §0](16-p4-implementation.md)'s
  *"PLAYABLE does not happen against a stub"* was written when that was not
  true; it is stale. What never happened is the *capture* half —
  [§1.6](#16-what-p2c14s-status-actually-is).
- **The admin path to a working turn is complete.** `AdminConnections.tsx` does
  provider, key, models, and the two first-run default bindings, and its claim
  of *fresh install → one key → a turn, with no text editor* holds for an
  admin.
- **P5's document half is reachable.** `LorebookView.tsx` reads, searches,
  filters and folds; `LorebookEditorPage.tsx` edits entries, reorders by drag
  and by keyboard, gates folders, and saves against a content hash. The gap is
  entirely the *selection* half: a fully editable book no session can be pointed
  at.
- **A known-good baseline exists.** Alpha 2 is tagged, built and installable,
  and the data-directory stamp refuses an older build against a newer volume
  ([P6A §1.7](19-p6a-alpha-1.md)). Playing against a build that can name itself
  is what makes a finding attributable.

### 0.3 The bar for pre-work, and the line it must not cross

Taken verbatim in spirit from [P2C §1](12-p2c-first-real-run.md), which is this
phase's precedent in every respect:

> An item is pre-work only if leaving it undone would make the phase's own
> findings wrong — by hiding a failure, by making one unfindable afterwards, or
> by producing a finding that is really about the missing thing.

And its guard, which matters more here than it did there, because this phase
sits next to the largest one in the plan:

> **Pre-work repairs the evidence; it does not build features.**

That is the whole reason the cast panel is out of scope
([§4](#4-out-of-scope-deliberately)) while the lore panel is in: one is a
feature P7 already owns and intends to reshape, the other is the instrument the
checkpoint reads.

---

## 1. Decisions this plan has to make

### 1.1 Selection lands on the create form and a mid-session panel

**Not a session-settings surface.** That is [P7.2](23-p7-implementation.md)'s
stage, and [P7 §1.6](23-p7-implementation.md) turns `cast` from a field into a
channel — so a settings page built now would be built against a shape P7
replaces, which is exactly the placeholder [work plan §2.2](01-work-plan.md) forbids.

**The create form, because the server is already there.** `POST /api/sessions`
takes `name`, `mode`, `preset`, `cast`, `treatment` and `lore`
(`routes/sessions.ts:84-112`), and the preset is `structuredClone`d at creation.
So the cheapest complete fix adds fields to a form that exists and sends what
the route already accepts. No new route, no new surface, no new address.

**And a mid-session panel, because a play session is long.** The realisation
*this book should have been attached* arrives mid-session, and starting again
costs the thread. `PUT /api/sessions/:id/lore` is already the route; the panel
is a disclosure above the transcript. Without it the create form is a
one-shot decision made before anybody knows what they want, which is the
condition that produces *findings about the missing thing* rather than findings.

**What it does not touch:** cast (P7.2's, and seed sets one), and changing a
preset after creation — there is no route for that, and adding one is a P7
question about what a session's preset *is*.

### 1.2 P5's close-out is inside this phase

[P5 §0.5](17-p5-implementation.md) is a close-out audit that concludes the phase
does not close: *"§3 has never been walked, and walking it today would fail."*
Five gate steps cannot be passed as written, one fails its own amendment, there
are two live defects and two more the audit itself missed.

**It belongs here rather than beside here**, for one reason: it is the same
subsystem. P5's gate is about whether the retriever is legible and honest;
PLAYABLE's third and fourth hypotheses are about whether the budgeter and the
inclusion reasons are. Walking one and then playing against the other is two
passes over one thing, and the second would find what the first should have.

§0.5 prices its own remedy at *"about a day's work"* apart from one
person-blocked item, and that estimate is the one this phase adopts.

### 1.3 The four contradictions, settled before anybody walks

[P5 §0.5](17-p5-implementation.md) names four document-versus-code
contradictions, *"each an argument waiting to happen mid-walk"*. A walk that has
to settle one mid-stride is a walk that edits the gate until it passes, which is
the failure the gate's own provenance note warns about.

1. **`tokenBudget: 0`.** [04 §5](../04-schemas.md) and the schema say
   *0 = unlimited*; `shelf.ts:142` is a plain ceiling with no zero arm, so such
   a book refuses every entry with *over the book's token budget of 0*. **The
   inverted reading is pinned by `shelf.test.ts:296`**, so the doc-conformant fix
   reddens a test — which is the point, and the test changes with the decision.
   The sibling field is already right: `match.ts:137` says *"zero-as-unlimited is
   the format's convention and not ours to improve"*, and the importer clamps
   `entryLimit` while leaving `tokenBudget` alone. **Settle toward the
   documents**: zero means unlimited, in both fields, spelled once.
2. **Step 12's ownership.** [§1.4 of P5](17-p5-implementation.md) and
   [work plan §0.3](01-work-plan.md) assign channel-conditioned entries to P5; the
   schema lists `activationConditions` as *deliberately absent* and the importer
   discards it. Three documents disagree about whether a feature exists. **The
   code is right and the documents are wrong** — the deferral was taken and
   neither section followed. Amend the step to say so and move the capability to
   where the rule vocabulary lives ([work plan §0.6](01-work-plan.md)'s 5.0).
3. **Step 11's ownership.** P5 says it is P3's edit-and-re-run gesture; P3
   disclaims it; [P6 §3](18-p6-implementation.md) step 3 has since absorbed the
   reproduction half. **Already resolved in P6's favour** — record it in P5's
   step rather than leaving the contradiction addressed in only one direction.
4. **Step 6's stated means.** It says the step is satisfied by *"the handful of
   explicitly-permissive real books the corpus policy already keeps in the
   repository"*, and the repository keeps none. **Person-blocked with lead time**
   — see [§1.5](#15-scandepth-the-recursion-haystack-and-what-is-person-blocked).

### 1.4 The single lore slot is a decision about the preset

**This is the defect that would make a hypothesis come back *wrong*.**

`modes/scene/preset.ts` declares exactly one `of: 'lore'` slot, at
`phase: 'before'`. `assembly/collect.ts:549-553` places a lore block into a slot
only when the placement and the phase agree — an `after` placement needs an
`after` slot. SillyTavern positions 1, 2, 3, 5 and 6 all import as `after_char`
(`retrieval/blocks.ts:66-72`).

So an imported entry at any of those positions **activates, is charged against
the book's `tokenBudget` and `entryLimit` in `shelve`, and then matches no slot
and vanishes** — and `unplaced` covers only named outlets
(`retrieval/blocks.ts:144-145`), so the lore report still counts it kept. **The
first imported SillyTavern book silently loses the majority of its entries after
they have spent the budget.**

A hand-made book is fine: `factories.ts:172` defaults to `before_char`. Which is
why no test and no hand-driven session has ever seen it, and why PLAYABLE — the
first time a *real imported library* meets the budgeter — is exactly where it
would bite.

**It is a decision, not a patch.** The preset needs a second lore slot at
`phase: 'after'`, and where that sits relative to history and the input is a
prompt-shape choice with a token-order consequence. **Lean: a second slot
immediately after the history splice**, mirroring the source engines' own
placement, with the priority argued in the preset beside the existing one. And
whatever is decided, **an entry that activates and lands nowhere must be
reported** rather than dropped silently — that is the same *no silent refusal*
line [work plan §2.2](01-work-plan.md) draws, and it is the half that protects the next
version of this bug.

### 1.5 `scanDepth`, the recursion haystack, and what is person-blocked

**`scanDepth` truncates the recursion haystack, and a placement setting decides
what feeds it.** The recursive pass replaces the messages with the activated
entries' content (`activate.ts:298-315`) and that array goes through the ordinary
window (`match.ts:145-146`). On a default book (`scanDepth: 2`) **only the first
two activated entries' content is ever scanned**. Worse, the feed inherits
`inScanOrder`, so raising an entry's `order` — a *placement* setting, under a
banner with nothing to do with recursion — silently removes its text from the
haystack, and the skip reported is `no-match`, which `activate.ts:493-499`
argues at length is the wrong thing to tell an author whose keys were fine.
`match.ts:131`'s *"`scanDepth` counts messages and nothing else"* is false in a
recursive pass.

No test sees it: every recursion test is a chain of width one.

**Decision, per §0.5's framing:** exempt the recursive haystack from `scanDepth`
— it is not a conversation window and the comment already says so — or cap it
deliberately and report the cut as its own skip reason. **Lean: exempt, and give
recursion its own depth limit**, which already exists and is honoured
(`preventRecursion`, step 9 of P5's gate, met). A width-N recursion test lands
with it.

#### What is person-blocked and stays that way

**Step 6 needs real permissively-licensed books**, and acquiring them has lead
time. §0.5 says recording it as person-blocked is fine and pretending is not.
This phase records it. It does not hold the gate open on it, because the step
asks whether a book *reads as a document*, and a synthesised book of three
hundred entries answers the layout half — which
[P5 §1.6](17-p5-implementation.md) already settled for step 1.

### 1.6 What P2C.1–.4's status actually is

[P4 §0](16-p4-implementation.md) says *"P2C.1–P2C.4 still have not run"* and
*"PLAYABLE does not happen against a stub"*. **Half of that is now stale and
half is exactly true**, and the phase should say which is which rather than
inherit an obligation it has already met or claim one it has not.

- **Stale:** the boundary has been crossed. Two connections are configured,
  three sessions carry recorded turns, and Alpha 1 and 2 were built and
  installed. Turns have been taken against a real endpoint.
- **True:** no exchange was ever captured or promoted. There is no `captures/`,
  no `packages/server/src/providers/fixtures/`, and no `.env` on this machine,
  so `pnpm test:live` has never run here and
  [P2C §2.2](12-p2c-first-real-run.md)'s *"every real call becomes a fixture,
  and that is the phase's best output"* never happened.

**Decision: capture during P6B.2 rather than staging a separate pass.** The
machinery exists — `pnpm dev:logged` records cassettes into `captures/` and
`openai-compatible.live.test.ts` is the promotion pattern. A play session
against a real endpoint *is* the corpus P2C wanted, and recording it costs a
flag. What this phase does not do is re-run P2C's scripted list; that phase's
findings log holds fourteen entries from its smoke run and its triage section is
still empty, which is [P6B.3](#p6b3--triage)'s to notice, not to redo.

### 1.7 What a sweep of the work plan found, and what this phase absorbs

*Added 2026-09-07, after §0.1's audit was widened from "why can PLAYABLE not
run" to "what else was made and never discharged".*
[manual testing](05-manual-testing.md) is the ledger it produced and the place the answer
lives; this section is only the part that lands **here**, because it is cheap
and because this phase is already in the files.

**Four things this phase absorbs**, none of them a feature:

1. **F22's leftover gets an owner.** The rebuild/watcher divergence over a
   refused path is assigned in [P2.3](08-p2-implementation.md) to **`P2.7`,
   a stage that does not exist** — P2 has P2.0 through P2.6. It was moved off a
   closed stage precisely so it would not become nobody's, and became nobody's
   by the other route. [P6B.1](#p6b1--p5s-close-out--prepared-the-walk-is-the-one-part-a-person-does) is already opening the
   index and storage code for the `orphan-fts` assertion and the migration test,
   so it takes this with them.
2. **Five phase documents still say `plan`.** 03 (P1), 04 (P2), 05 (P3), 06 (P4)
   and 14 (P2B) all landed and none of their status lines says so; 15 (P2C) has
   no status line at all and is half-run. The same defect
   [P6A](19-p6a-alpha-1.md)'s close fixed for 07 and 08, in five more places,
   and it costs a paragraph each.
3. **[P2C log](14-p2c-log.md)'s triage table is empty** under fourteen findings, and
   that phase's own rule is that it does not end while the table is shorter than
   the list. [P6B.3](#p6b3--triage) already says it takes them.
4. **[manual gate §1](11-p2-manual-gate.md)'s anchor reads 1186 tests**, two phases
   stale. Left alone deliberately — an anchor records when a gate was walked and
   moving it would claim a walk nobody made — but [manual testing §1](05-manual-testing.md)
   re-anchors beside it, which is the honest repair.

**And what it explicitly does not absorb**, so that the choice is visible rather
than silent: the permissive corpus (person-blocked, and §3 step 6 records it as
such), the four smaller P2-era defects in
[manual gate §3.6](11-p2-manual-gate.md), and the five should-be-tests in
[manual gate §4](11-p2-manual-gate.md). Each has a row and an owner in
[manual testing §10](05-manual-testing.md), which is what makes deferring them a decision.

### 1.8 The log, and the rule that keeps it honest

[P5 §0.3](17-p5-implementation.md) wrote observation prompts for the run-up to
this checkpoint and [§0.4](17-p5-implementation.md) then recorded that
*"§0.3's instruction has no receptacle"*. [playable log](21-playable-log.md) is the
receptacle, in [P2C log](14-p2c-log.md)'s shape and record format.

Two rules, both [P2C log](14-p2c-log.md)'s and both load-bearing:

- **`expected` before `observed`, written before investigating.** What a person
  thought would happen is not reconstructible once they know what did.
- **The file is not a queue.** Nothing is fixed *because* it is written there;
  [P6B.3](#p6b3--triage) decides where each finding goes, and it decides at
  triage rather than at the moment of annoyance, because afterwards every
  finding argues for its own importance.

---

## 2. Stages

Repair the instrument, close the phase that built it, then use it. The first two
are prerequisites of the third; the fourth is what makes the third count.

### ~~P6B.0 — Selection, and the failures nobody sees~~ Landed

**Three places, because a session is configured at two moments and read at a
third.** The create form (`play/SessionsPage.tsx`) sends `treatment`, `lore` and
`preset`; the play page carries a disclosure (`play/LorePanel.tsx`) that shows
what is attached and changes it through the PUT; and `tools/seed.mjs` names the
treatment it builds. **The preset is on the create form specifically** and
nowhere else, because it is the one field with no second chance — a session
copies it at creation and no route changes it after, so a session started
without one is on the built-in default forever.

**Not the cast**, per §1.1, and worth restating because it was the tempting
addition: the same form could have grown one in four lines, and
[P7 §1.6](23-p7-implementation.md) turns `cast` from a field into a channel.

**The other half was failures nobody could see**, and it is the half
[§0.3](#03-the-bar-for-pre-work-and-the-line-it-must-not-cross) most directly
asks for. Every mutation on the play page could fail and none rendered anything;
the page now shows the most recent, by `submittedAt` rather than declaration
order so a stale failure cannot outrank a fresh one. And `onFatal` has always
been handed a failure class that `PlayAction` had nowhere to put, so every fatal
stream close produced one sentence whatever had happened — the class travels
now, and the line names it.

**Eight mutations, eight red, and one of them is the finding worth keeping.**
Mutating `createSession`'s request body left *both* page tests green, because
they mock that function and assert what the page passes to it: the body itself
had no test, which is this stage's own defect one layer down — a thing built,
reachable, and unchecked at the seam. The bodies are asserted against a stubbed
`fetch` now.

**Checked against a real server rather than only in jsdom**, which is what the
*ends at* asks for and what no test can give: a scratch install, `pnpm seed`,
and the seeded session's file on disk carrying its treatment; then in a browser
the panel read that treatment back, took a tick on Rain City, and the save
landed in `session.json` beside it while the summary changed from *no
lorebooks* to *one lorebook*. **The turn itself is not covered** — this install
had no connection bound, and the context meter said so honestly — so the last
clause of the *ends at* below belongs to [P6B.2](#p6b2--play).

*The stage as it was written:*

> §1.1's create-form fields and mid-session panel; `pnpm seed` naming the
> treatment it builds; and the play page rendering a failed submission.
>
> *Ends at:* `pnpm reset-data && pnpm seed`, then a session started in the
> browser naming a treatment and a book, a turn taken, and the workbench's lore
> report showing entries that fired with their reasons. **Nobody has ever been
> able to do that.**

### P6B.1 — P5's close-out — *prepared; the walk is the one part a person does*

**Everything this stage could do without a person is done, and the stage does
not close on it.** The *ends at* below asks for eighteen steps walked against
HEAD, and that is not a thing a suite can hand over. What follows is what the
walker inherits, so that the walk is a walk and not a second investigation.

**Four defects, each of which was silent and each of which now has a test that
reddens without it** (`a6d3eb4`, `0e228ec`, `39f9ee1`):

- **`tokenBudget: 0` is unlimited**, as the schema and [04 §5](../04-schemas.md)
  always said. The inverted reading was pinned by a test, which is why §1.3
  named that test in advance: a test can pin a defect, and one that does is
  evidence about the day it was written.
- **Lore has two phases.** `SCENE_PRESET` gained `se.lore.after`, placed
  immediately after `se.lore` in source order rather than after the history
  splice — `after` is SillyTavern's `after_char`, which precedes the
  conversation, and the plan's lean read it as *after everything*. Entries that
  used to activate, spend the book's budget and vanish unreported now land; and
  an unplaced phase is *reported*, which the discriminated `Unplaced` is for.
- **A recursive pass is not a conversation window.** The feed is its own field,
  unsliced, reported as `entry` rather than `message`. §1.5's decision, taken
  the first way it offered: `scanDepth` counts messages, and recursion keeps the
  bound it always had.
- **The destructive migration has the test its own doctrine demands**, written
  at the version the step leaves *from*, asserting every column rather than a
  count.

**Plus the two the sweep put here.** The owed `orphan-fts` assertion. And
**F22's leftover, which turned out to be a live divergence rather than a
comment**: a folder whose name this build refuses was skipped silently by a
rebuild and *indexed* by the watcher, whose row pointed at a file no read in
this build can open. The gate could not have caught it in either direction,
because `snapshot` compared what got indexed and the disagreement was about
what did not. Both producers now ask the same function, the refusal is a
`file_error` row rather than a number nobody stored, and the snapshot reads that
table. Its stated owner was `P2.7`, a stage that was never created — which is
the dangling owner [manual testing §4.1](05-manual-testing.md) opened on.

**And step 8's two plumbing complaints, which were cheap and would otherwise
have failed the walk for a reason the walker could not act on.** `Activation`
carries the sticky count, `reasonFor` spends it, and the effect list prints
`scopeKey` so four entries writing one scoped channel are four rows. The third
complaint — `delay` has no trace in the turn record — is a design gap and the
step now asks it as one rather than as something to hunt for.

**The five stale status lines are rewritten**, and [P2C](12-p2c-first-real-run.md)
had none at all, which is worse than a stale one: a reader had to reconstruct
from the stage records that four fifths of P2C never ran.

**What the walker inherits, and what is already decided so nothing is argued
mid-walk.** Steps 6, 8, 11 and 12 are amended. Step 6 is **person-blocked** and
that is its outcome — the book is supplied by the walker or the step is
deferred, and it is counted with [P4 §3](16-p4-implementation.md) step 1 at
[manual testing §3.4](05-manual-testing.md), which wants the same book. Step 11's
reproduction half is **P6's** and there is no replay entry point to look for.
Step 12 is **P7's**: [work plan §0.3](01-work-plan.md)'s row moved,
[P5 §1.4](17-p5-implementation.md) is corrected, and
[P7 §0.1](23-p7-implementation.md) carries it — so a walker records it deferred
with an owner rather than failed, because a failed step is a defect and a
deferred one is a plan.

*Still to do, and only a person can:* walk all eighteen against HEAD, recording
each outcome rather than ticking it, then write [P5](17-p5-implementation.md)'s status line — which now has
a precise answer available to it either way.

*The stage as it was written:*

> §1.3's four contradictions settled; §1.4's slot decision and the
> activated-but-unplaced report; §1.5's recursion decision with a width-N test;
> the destructive migration given the test its own doctrine demands
> (`state/migrations.ts` `STEPS[3]` drops a table while
> `state/migrations.test.ts:12-14` says none may — and deleting the
> `insert into import_item_new … select` leaves the whole suite green while every
> upgrading install loses every import review); and the one owed test, the
> `orphan-fts` assertion after an in-place rebuild.
>
> **Plus the two things §1.7's sweep puts here.** **F22's leftover** — the
> rebuild/watcher divergence over a refused path, and the test that asserts it —
> because the code is the code this stage is already opening and its stated owner
> is a stage that was never created. And **the five stale status lines**, which
> are minutes each and are the difference between a corpus that records what
> happened and one that records what was planned.
>
> Then amend steps 6, 8, 11 and 12 to ask what is actually being asked, and **a
> person walks all eighteen against HEAD**.
>
> *Ends at:* P5's gate walked, with each step's outcome recorded rather than
> ticked, and [P5](17-p5-implementation.md)'s status line saying either that the phase closes or precisely
> what still holds it open.

### P6B.2 — Play

The checkpoint. Unscripted, against a real imported library, over several
sittings — [work plan §4.1](01-work-plan.md)'s *stop and play with it*, and
[P2C.3](12-p2c-first-real-run.md)'s distinction: a scripted pass answers whether
a turn works, and this answers whether forty do.

**What to watch for**, and it is written down because a session that watches for
nothing produces a memory rather than a finding:

- **The four hypotheses** ([work plan §4.1](01-work-plan.md)) — is the record legible;
  does hand-editing a card mid-session take; is one budgeter comprehensible
  under pressure; do inclusion reasons explain anything. The fourth is the one
  01 calls likeliest to be wrong.
- **P5's four held-open questions** ([P5 §1.11](17-p5-implementation.md), with
  observation prompts already written at [§0.3](17-p5-implementation.md)): the
  trim order, whether the per-book budget tier earns its keep, whether recursion
  depth needs a surface, and whether the keyword tester is the diagnostic or a
  consolation.
- **P6's two** ([P6 §5](18-p6-implementation.md)): which reply an edit changes,
  and whether the sibling affordance is enough to find a line abandoned twenty
  turns ago.

Provider exchanges are recorded (`pnpm dev:logged`) so the session leaves a
corpus behind — §1.6.

*Ends at:* six answered questions and a full log.

### P6B.3 — Triage

[P2C §2.5](12-p2c-first-real-run.md)'s five destinations, decided in advance
because afterwards every finding argues for its own importance: **stops the
phase / fixed inside it / a gate correction / polish / P7 or the roadmap.**
Nothing is allowed to have no home.

Plus one piece of inherited bookkeeping: [P2C log](14-p2c-log.md) holds fourteen
findings from P2C.0's smoke run under an empty *Triage* heading. They get homes
too, or a recorded reason why not.

**And the ledger is updated rather than left to go stale** —
[manual testing §6](05-manual-testing.md)'s gate table gains P5's and PLAYABLE's
rows in their walked state, and anything this phase defers gains a row with a
name beside it in **§10**. That is the file's own standing rule, and this is
the first phase that closes under it. *(The two section numbers in this
paragraph were §1 and §4 and were both wrong — §1 is the queue and §4 is the
sittings. A pointer nobody follows is how a ledger goes stale, which is the
thing this paragraph is against.)*

*Ends at:* an empty log, six questions answered or re-deferred with reasons,
[manual testing](05-manual-testing.md) current, and [P7 §0.1](23-p7-implementation.md) given
the follow-up it asks for.

**Run 2026-09-09, and it was desk work rather than a walk.** All twenty
findings have rows: [P2C log](14-p2c-log.md)'s fourteen and
[playable log](21-playable-log.md)'s six, each checked against the file and line
it claims about rather than against a memory of a fix.

- **Nine of P2C's fourteen were already fixed** by later phases opening the
  same files for other reasons — which is the finding of the triage rather
  than a happy accident. The log worked as a record and failed as a queue,
  exactly as its own header says it is not one.
- **Two go to [P7](23-p7-implementation.md)**: the invisible context-window
  lever, and `turn.status: failed` on the wire for a running turn. Both are
  about a surface, which is why nobody had a reason to open them.
- **Two are recorded as not-defects** with the code that argues it — a sixth
  outcome [P2C §2.5](12-p2c-first-real-run.md)'s five did not have, because
  five homes assume every entry is a defect.
- **Two of the six PLAYABLE findings stay unowned**, F-03 and F-05, and are
  named as such in [manual testing §10](05-manual-testing.md). **A false owner
  is worse than a named absence**, because it stops anybody looking.
- **[F-06](21-playable-log.md) answers [P6 §5](18-p6-implementation.md)** and
  P6 closed collecting it. **[F-04](21-playable-log.md) produced two
  `CORRECTION`s**, both now written: [P3.1a](15-p3-implementation.md)'s stage
  record claimed a browser drag over a control that had no height, and
  [manual testing](05-manual-testing.md)'s D2 reads `PASS` while testing only
  that a size persists.
- **[Refinements §4](22-walkthrough-refinements.md)'s two unwritten
  destinations are written**: [polish §11](06-polish.md) and
  [§12](06-polish.md). R1, R4 and R7 remain unowned and are named in
  [manual testing §10](05-manual-testing.md) rather than assigned.

**What is not done, and it is the half a person owns:** the log is not empty
of *new* findings, because [P6B.2](#p6b2--play) has not run. This triage
routed everything seen up to 2026-09-08. **K9 re-runs it** over whatever
[sitting K](05-manual-testing.md) produces, which is why the stage is written
to be run twice rather than once.

---

## 3. Verification — the P6B exit gate

1. **Selection round-trips.** A session created in the browser naming a
   treatment and two books resolves all of them; the workbench's lore report
   names each and says why it was scanned (`by: treatment` versus `by: session`).
2. **Selection is changeable mid-session.** Attach a book on turn ten; the next
   turn scans it, and the context meter and lore report both follow.
3. **`pnpm seed` produces a playable install.** Reset, seed, take one turn, and
   an entry fires — with no hand-editing and no API call.
4. **A refused submission is visible.** Force a `412 stale-head` (two tabs) and
   an unbound role; each says something on screen.
5. **An imported SillyTavern book keeps its entries.** Import one, play against
   it, and every entry that activates either lands in the prompt or is reported
   as unplaced. **Nothing activates, spends budget and disappears.**
6. **Recursion is not silently truncated.** A width-three recursion chain
   activates all three; raising an entry's `order` does not remove its text from
   the haystack.
7. **The migration test fails when the copy is deleted.** The mutation
   `state/migrations.ts` invites is red.
8. **P5's eighteen steps, walked against HEAD by a person**, each recorded.
9. **The four hypotheses are answered in writing**, including any answered
   *no* — 02 §5 contemplates falsification as project-altering, and a *no* here
   is the phase's most valuable possible output.
10. **The log is empty**, because everything in it has a home.

**And the standing line from [work plan §2.3](01-work-plan.md): no phase exits with
configuration that has no surface.** This phase is that line being paid off for
the retriever, three phases late.

### 3.1 What closed this gate, and what it did not

**The ten steps above are never edited.** They keep asking what they asked; this
table records what was answered and by what, which is the separation
[§1.3](#13-the-four-contradictions-settled-before-anybody-walks) demands
against *"a walk that edits the gate until it passes."* Without it the two-tier
model is a rubber stamp with extra steps.

**P6B is the first phase to close under**
**[manual testing §0](05-manual-testing.md)**, and the hardest case that model
will meet — because P6B.2 *is* PLAYABLE, which is why this phase does **not**
close on its buildable work. The critical list is
[sitting K](05-manual-testing.md), derived by §0's three-clause criterion and
not by preference.

| Step | Answered by | State |
|---|---|---|
| **1** Selection round-trips | **K3** | critical; walk pending |
| **2** Selection is changeable mid-session | **K3** | critical; walk pending |
| **3** `pnpm seed` produces a playable install | **K1** | critical; walk pending |
| **4** A refused submission is visible | **K6** | critical; walk pending — and it is the *play page's* rendering, not the settings 412 [B9](05-manual-testing.md) already passed |
| **5** An imported book keeps its entries | **K2**, then **K4** | critical; walk pending. **The shipped fixture will not do**: `RAIN_CITY_BOOK` has only positions 0 and 4, so it never exercises the `after_char` defect [P6B.1](#p6b1--p5s-close-out--prepared-the-walk-is-the-one-part-a-person-does) fixed |
| **6** Recursion is not silently truncated | **a test** — `retrieval/activate.test.ts`, the width-three chain at the default depth | **AUTO in part**, [manual testing §5](05-manual-testing.md). Its carrier is the third entry in scan order, so the *raising an `order`* clause is covered in substance and by nothing that says so |
| **7** The migration test fails when the copy is deleted | **a test** — `state/migrations.test.ts`, mutation run at [P6B.1](#p6b1--p5s-close-out--prepared-the-walk-is-the-one-part-a-person-does) | **AUTO**, [manual testing §5](05-manual-testing.md) |
| **8** P5's eighteen steps, walked by a person | **nothing here** | **Standing**, [sitting F](05-manual-testing.md). This is P5's claim living in P6B's gate — criterion **(i)** — and P5 closed 2026-09-09 with it |
| **9** The four hypotheses answered in writing | **K8**, and only partly | critical; walk pending. See below |
| **10** The log is empty | **K9**, over what K produces | **Half done, 2026-09-09.** [P6B.3](#p6b3--triage) routed all twenty findings seen up to 2026-09-08. The other half needs P6B.2 to have happened |

**What this list cannot reach, and it is not a footnote.** Every K item is one
turn long and leaves nothing behind, so a defect of *accumulation* survives it
intact. **And the sharper one is a property of the design rather than of the
code: the budgeter may look comprehensible precisely because the walker chose
the book, the budget and the turn.** A controlled experiment answering a
question about uncontrolled use is what a full walk exists to avoid, and this
list is a controlled experiment by construction. That is the price of closing
this phase this month, and it is written here rather than discovered later.

**Of the four hypotheses, K8 can honestly reach two and a half.** Hypothesis 2
in full. Hypothesis 1 thinly, on a turn the walker built. Hypothesis 3 splits —
the budgeter's *account* of itself is answerable now, its behaviour under a
real library's pressure is not, and **do not synthesise a three-hundred-entry
book to close the gap**: it would give a confident answer to the question R1
exists to ask. *Wrong* is worse than *absent*, and absent is cheap to repair.
**The rule worth keeping: synthesise for arithmetic and layout, never for
judgement.** Hypothesis 4 is not reachable here at all — see
[manual testing §4](05-manual-testing.md)'s correction: it has never been in
contact with anything, and G is where it gets one.

**And a second way this could pass and be worthless: it cannot fail the way C
did.** [Sitting C](05-manual-testing.md) ran eleven deliberate breakages,
passed eleven, and produced **no refinement note at all**, while the quiet
sittings produced five. K1–K7 are all built around something going wrong or
being made to go wrong — the shape that has so far produced nothing. **Keep
[refinements](22-walkthrough-refinements.md) open beside the log, and treat a
sitting that adds no row to it as a signal rather than a clean sweep.**

---

## 4. Out of scope, deliberately

**The cast panel and any session-settings surface.**
[P7.2](23-p7-implementation.md) owns them and [P7 §1.6](23-p7-implementation.md)
turns `cast` into a channel. Seed sets a cast; the create form does not need to.

**Changing a preset after creation.** No route exists, and adding one is a
question about what a session's preset *is* — copied at creation today
([P4 §1.9](16-p4-implementation.md)), which P7's surface revisits.

**The permissive book corpus** — person-blocked with lead time (§1.5).

**Re-running P2C's scripted list.** §1.6: capture during play instead.

**Anything PLAYABLE finds.** The checkpoint's output is a list with homes, not a
phase that fixes everything it saw. [P6B.3](#p6b3--triage) routes; the routing
is the deliverable.

---

## 5. What not to report

*The brief-substitute, and the longest section [P2C's](13-p2c-brief.md) has for
a reason: a wrong "do not report" sends somebody past a real bug, and a wrong
"this is broken" spends a sitting of a short phase.*

These are known, deliberate, and owned elsewhere. Noticing them again costs the
log its signal:

- **No treatment editor, and no way to make one in the browser.** Actors and
  lorebooks have editors; the other four kinds arrive by import or the API
  (`library/fields.ts`). Creation follows each kind's editor, and that is P7's
  and P11's.
- **No session housekeeping.** No rename, archive or delete in the UI, though
  the routes exist.
- **No way to change a session's mode or preset after creation** (§4).
- **No per-user connection surface.** A non-admin cannot configure their own
  provider; only an admin can, and that is P10's.
- **No branch tree visualiser.** Siblings are a count and two arrows, and
  whether that is *enough* is one of the questions being asked
  ([P6 §1.2](18-p6-implementation.md)) — so report the judgement, not the
  absence.
- **No About surface beyond the version block**, no AGPL §13 source link:
  P10's and P11's.
- **The workbench is a reader.** It holds no state and offers no force-fire;
  that is deliberate ([P3](15-p3-implementation.md)).

**Report anyway, always:** anything that made you consult the source instead of
the screen. That is [P2C.1](12-p2c-first-real-run.md)'s signal and it is the one
a second pass cannot produce, because a second pass is made by somebody who
already knows.

---

## 6. The honest size

**P6B.0 is one to two days**, and it is the whole reason the phase exists: a
widened type, a widened api call, form fields, one panel, three lines of seed,
and ten lines of error rendering. No new routes.

**P6B.1 is three to four days.** §0.5 prices its own list at about a day; the
two decisions (§1.4's slot, §1.5's recursion) are cheap to write and want care
to argue, the migration and `orphan-fts` tests are small, and the walk itself is
eighteen steps against a running install.

**P6B.2 is sittings, not days**, and it is the one part that cannot be
compressed by working harder. [P2C §2.4](12-p2c-first-real-run.md)'s box
applies — a manual phase with no end stops when somebody gets bored, which
correlates with nothing.

**P6B.3 is half a day** and is the stage most likely to be skipped. It is also
the one that decides whether the other three were work or entertainment.

**The largest risk is that P6B.2 finds something structural**, and that is the
entire point. [triage §5](02-triage.md) contemplates PLAYABLE falsifying the core
hypotheses as project-altering rather than as an in-flight patch — which is the
argument for running it before [P7](23-p7-implementation.md) publishes the
contract, rather than during.
