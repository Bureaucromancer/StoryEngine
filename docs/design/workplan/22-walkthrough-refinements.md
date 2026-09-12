# 22 — The walkthrough refinements: what the eleven notes actually are

**Status: grounded 2026-09-08 against `v1.0.0-alpha.3`; ~~unscheduled~~
**decided and sequenced 2026-09-11 — §7.**
Eleven notes written by the author while walking sittings A through mid-D of
[manual testing](05-manual-testing.md). Each was read against the code and the design corpus
before being written down here, and **eight of the eleven are not what the note
says they are.**

**This document does not schedule anything.** It says, for each note, what the
request actually is, whether the thing already exists, which document owns it,
and what has to be decided before it can be built. Scheduling is a separate
decision and [manual testing §0](05-manual-testing.md)'s rule applies to it: a
thing is owned, deferred with an owner and a reason, or handed over with the
sitting named.

**Findings that are observations rather than requests go to
[playable log](21-playable-log.md)**, in that file's record format, under the walkthrough's
own session heading. This file is the plan; that file is the evidence.

---

## 0. What grounding them changed

A refinement list is worth exactly as much as its diagnoses, and these diagnoses
moved a lot:

| # | The note asked for | What it actually is |
|---|---|---|
| **R1** | An outline on the selected turn, and selecting earlier turns for the workbench | **A 1.0 commitment with no owner.** [10 §3](../10-ui-surfaces.md) says the panel shows any turn *"current or historical"*; it is hard-wired to the head. The reader it needs already exists and has one caller. |
| **R2** | Duplicate + reorder connections; separate provider from model | **The data model already separates them.** The form fuses them. And the thing actually blocking *use a second model* is a role-binding editor nobody built — [P7 §1.9](23-p7-implementation.md). |
| **R3** | Roll up settings sections, add a search bar, use the workbench as a table of contents | **The only item where the design argues back.** [10 §1.1](../10-ui-surfaces.md) rejects disclosure-as-reflex *for this surface by name*. The complaint is real; the remedy is refused. |
| **R4** | Autoscroll so the prompt sits at the top when results stream | **The largest genuine blank in the corpus.** Nothing anywhere specifies where the reader's view sits. Also: the prompt is not in the DOM during streaming, and the page does not scroll — the transcript does. |
| **R5** | Make the workbench resizable | **It has been resizable since P3.** The drag handle has been *zero pixels tall* the whole time. Fixed already, on an unmerged branch. **Nothing to build.** |
| **R6** | Make *continue from here* predictable | **The answer to a question P6 deliberately left open** and named PLAYABLE as the place to answer — [P6 §1.8](18-p6-implementation.md). It is a triage input, not a new item. |
| **R7** | An in-flight indicator when the workbench is closed | **Specified nearly verbatim** at [10 §9](../10-ui-surfaces.md): *"a collapsed line while things go well"*. P3.5 built it only inside the panel. |
| **R8** | Delete a turn, warning about downstream turns | **Post-1.0 and already on the roadmap** — [24 §1.4](../24-roadmap.md)'s *R4 — Curate*, *"prune a subtree"*. Its warning is specified and is **stronger** than the one requested. |
| **R9** | Session delete, duplicate, rename, import, export, in the library | **Five verbs, five different truths, ~60% already built.** Rename is done but unpushed; delete and archive have routes and no UI; import/export is P11 and blocked. *"In library"* is a placement the object set refuses. |
| **R10** | Visual feedback on Send; a UI pass on all buttons | **A recorded, deliberately-accepted condition** — [P2C brief §3.4](13-p2c-brief.md) says it almost word for word. One file, because [10 §1.2](../10-ui-surfaces.md) consolidated the look into `ui/`. |
| **R11** | Suggested actions, pre-1.0, per-session toggle, keep the unselected | **The author's self-diagnosis is exactly right and checkable.** The phrase appears **once** in the whole corpus, in the sentence defining Freeform — a 1.0 mode. Every downstream document dropped it. |

**Three of the eleven survive as written**: R3's search bar, R8's gesture, and
R11's shape. Everything else changed on contact with the code.

---

## 1. The finding underneath five of them

**R1, R4, R6, R7 and R10 are one absence, not five.**

The client has a complete, deliberately-built vocabulary for **failure** and
almost none for **progress**. [P6B.0](20-p6b-playable.md) built the failure half
on purpose and finished it: the most recent error across every mutation, ranked
by `submittedAt` so a stale failure cannot outrank a fresh one, and a fatal
stream close that names its class. That work is done and it is good.

The other half was never built. Between pressing Send and the first token there
is ~~**no signal at all** — the button does not change~~, no live region fires, and
the only thing that knows a turn is running is a panel that is closed by
default. R7 is that gap seen from the transcript, R10 from the button, R4 from
the scroll position, and R1 and R6 from *which turn are we even talking about*.

***CORRECTION, 2026-09-11: "the button does not change" is false, and has been
since 2026-08-18.*** Once the `POST` resolves, the reducer sets `running` in the
same render that clears the draft: the input disables and Send becomes Stop
(`PlayPage.tsx:433,440-453`), and it did so in alpha 3 as well. **The true gap is
narrower and sharper in two directions.** *Before* acceptance nothing changes at
all, because Send never reads its own `isPending` — and the form's only guard is
a non-empty draft, so a second press fires a request the server refuses with
`409 busy` and nothing on screen says so. *After* acceptance the swap happens and
**is never announced**, so a screen-reader user gets the same silence the note
describes. The sentence propagated into [F-02](21-playable-log.md) and
[polish §11](06-polish.md) unchecked; the remedy those describe is still right,
and its justification has to be this one.

**Costed as five UI requests this is five surfaces. Costed as one it is a single
layer** — a pending variant on `Button`, a `running` arm on the status line, and
one notion of a current turn — that R7 and R10 consume directly and R1, R4 and
R6 build on.

**And sitting C is the evidence that makes this a statement rather than a
theory.** Eleven deliberate breakages, eleven PASS, and **not one refinement
note came out of it**. The app is demonstrably well built for the case where
something goes wrong and demonstrably thin for the case where nothing does.
That comes from a walk rather than from a reading, which is what makes it worth
more than any single item on the list.

---

## 2. Free, or nearly

**Do these before deciding anything else, because they cost almost nothing and
two of them change what the remaining walk sees.**

### 2.1 R5 — merge, do not build

The workbench splitter is complete on `main`: `role="separator"`, a pointer half
with `setPointerCapture` and RTL-aware deltas, a keyboard half stepping 16px
with Escape abandoning and blur committing, and the width persisted.
[10 §3](../10-ui-surfaces.md) specifies it and P3.1a built it on 2026-08-27.

`Workbench.tsx:221` carries `inset-block-0`, **which is not a Tailwind
utility.** Tailwind emits nothing for a name it does not recognise, and an
absolutely-positioned element with no block inset has no height. The drag
affordance has not existed since the day it was written; only the keyboard half
has ever worked.

~~`71ff7f1` on `feat/tagging_and_search`~~ **`71ff7f1`, on `main` since
`a6a0344`,** changes it to `inset-y-0` and adds
`tailwind-utilities.test.ts`, which reads the built stylesheet and holds every
class the client names to one Tailwind actually emitted. **The test matters more
than the fix**, because this is a bug class with no other gate — the commit says
so itself: *not a lint error, not a type error, not a test failure, and
invisible in jsdom.*

***This section went stale five hours after it was written**, which is worth more
than the embarrassment.* `f449608` committed it at 18:21 on 2026-09-08;
`a6a0344` merged the branch at 23:41 the same evening, and the branch is now
deleted. Every *"unmerged"* and *"not on origin"* sentence in §0, §2.1 and §2.2
was overtaken before anybody read them. **A row that names a branch dates
itself; a row that names a date does not** — which is why §7's table carries
dates instead.

> **Three things this should change, beyond the merge.**
>
> **`dock.test.tsx` has five splitter tests that pass over a control with no
> height**, because jsdom computes no layout. ~~and they drive the separator by
> role~~ **Three of the five drive the separator by role** (`:448`, `:489`,
> `:499`); the other two seed a stored width and read the aside's custom
> property. They are not wrong; they are blind, and worth a docstring saying which
> half they cover. **Still owed, 2026-09-11** — and the docstring it has already
> names two jsdom blind spots, so what is missing is the specific one: that the
> handle's *visibility* is vouched for here by nothing, and lives in
> `tailwind-utilities.test.ts` and a walk.
>
> **[P3.1a](15-p3-implementation.md)'s stage record claims a browser walk that
> cannot have happened** — *"open, drag to 484, reload, still open at 484"*. ~~It
> is uncorrected on both branches.~~ **Corrected 2026-09-09** at
> [P3.1a](15-p3-implementation.md). That is a `CORRECTION` in
> [manual testing](05-manual-testing.md)'s sense and the most valuable thing this note
> produced.
>
> **[manual testing](05-manual-testing.md)'s D2 tests that a size persists, never that it can
> be set by pointer.** ~~The next refinement to add a pointer affordance is R2's
> connection reorder~~ — **D2a was written for it on 2026-09-09 and has never been
> walked.** The premise about R2 was wrong twice: pointer drag-reorder had
> already shipped in the lorebook editor and the tag manager, and R2's reorder is
> not being built at all (§3, decision 3). The obligation survives its example and
> should attach to the next reorder anybody *does* build — and note that
> [10 §11](../10-ui-surfaces.md) requires every reorder to offer buttons as well as
> a drag, which is exactly what lets a keyboard-only walk pass without the pointer
> ever being tried. **No step in [manual testing](05-manual-testing.md) exercises
> a pointer reorder today; the word does not occur in the file.**

### 2.2 R9's rename — ~~push, then merge~~ **done, 2026-09-08**

Session rename is built end to end ~~on `feat/tagging_and_search`~~ at `dc6f777`,
`0afbac8` and `fff349b` — ~~**and those three commits are not on origin.** The
branch's tip there is `989a3cb`; locally it is `fff349b`. Nothing is lost, but
the work is one machine away from being the only copy.~~ **All three are
ancestors of `origin/main` through `a6a0344`, and shipped in alpha 4.** The
sentence was true when written and false the same evening.

**One thing the rename did not close:** [P6B §5](20-p6b-playable.md) still lists
*no rename in the UI* among its known absences. That is a stale line in a
document nobody has had a reason to reopen, which is this file's own subject.

### 2.3 R10 — one file, not forty-four buttons

*"Time for a UI pass on all buttons"* is one edit to `ui/Button.tsx` plus call
sites, because [10 §1.2](../10-ui-surfaces.md) consolidated the look into `ui/`
for exactly this. Two constraints come with it and both are written down
already: **`className` is for position, not appearance**, so a pending look
cannot be passed in at a call site; and **`disabled:opacity-*` is forbidden as
the disabled mechanism**, because it dims text and border together and can push
either below the contrast floor.

---

## 3. Four decisions only a person can make

These are not sizing questions. Each is a case where the request and a written
position disagree, and building without deciding would quietly reverse
something.

**1. What does clicking a turn mean?** R1 says *select it for the workbench*;
R6 says *continue from it*. Neither notices the other. The plausible resolution
— click selects, an explicit control on the selected turn continues — is what
neither request says. They have to be sequenced together or two people will
build two answers.

*And R1's obvious implementation is the wrong one.* A `selectedTurnId` in React
state breaks the workbench's stateless-reader rule, stated twice in
[10](../10-ui-surfaces.md) (*"has no state of its own"*, *"its subject is
whatever is in the main view"*). A `?turn=<id>` search param gives the same
outline and the same subject, keeps the rule, and makes a selection
bookmarkable — which [P3 §7.2](15-p3-implementation.md) already argued is what
forced Compare into a full view. The outline must also carry `aria-current`;
*"subtle but visible"* is exactly the case [P5](17-p5-implementation.md) already
ruled on when it marked an addressed lore entry.

> **DECIDED, 2026-09-11 — click selects; an explicit control on the selected turn
> continues.** The address is `?turn=<id>` and not React state, for the reason
> above and for one more the decision did not know: the shell resets scroll on a
> *pathname* change and deliberately keeps its place on a search-param change
> ([P3.−1](15-p3-implementation.md)), so a selection made this way does not
> scroll the transcript out from under the reader. The outline carries
> `aria-current`.
>
> **The precedent is already built, and no planning document points at it.**
> `LorebookEditorPage.tsx:911-919` scrolls the addressed entry into view with
> `scrollIntoView({ block: 'nearest' })` keyed on the selection, over an
> `[aria-current="true"]` marker, under the rule
> [P5](17-p5-implementation.md) wrote: *marked as well as scrolled to, and not
> only as a colour*. That is R1's outline and R4's scroll behaviour in one place.
>
> **And the address now has three consumers, not one.** R1's panel,
> [P11.1](27-p11-implementation.md)'s reading view over *any node, not just the
> head*, and [10 §14.1](../10-ui-surfaces.md)'s search results, which commit to
> *"jumping to that point in the transcript"*. Two of the three already have
> owners, which makes the address a shared decision rather than R1's alone.

**2. Does the settings surface get progressive disclosure?** R3's complaint is
real and is the *forcing evidence* [25 E10](../25-open-questions.md) was written
to wait for. But [10 §1.1](../10-ui-surfaces.md) rejects disclosure-as-reflex
naming administration specifically, [10 §15.4](../10-ui-surfaces.md) refuses
R3's exact remedy, and *"a closed section must name what is inside it that is
not at its default"* makes roll-up expensive rather than cheap. Separately,
*"use the workbench as a table of contents"* collides with **D3, which this same
walk passed the day before** — nothing switches the workbench on, and it is a
panel and not a place. **R3's search bar is clean and can proceed;** the roll-up
and the ToC need the argument written or the sections corrected.

> **DECIDED, 2026-09-11 — search only. The roll-up and the ToC stay refused**,
> which makes [polish §12](06-polish.md)'s flat *"are refused by 10 §1.1"* the
> corpus's position rather than a disagreement with this section.
>
> **Two corrections come with it, because the case as argued above overstates
> itself.** [10 §15.4](../10-ui-surfaces.md) does not refuse *"R3's exact
> remedy"* — it refuses a per-account drill-down, after a general sentence that
> this surface is dense because it is tooling. And §1.1 sets a **test** —
> disclosure *"has to be earned by the thing being genuinely rare or genuinely
> dangerous"* — rather than a flat prohibition. The settings page already passes
> one disclosure through that test: the *What this endpoint can do* block, whose
> two capability overrides only their operator can know. So the position is *not
> as a reflex, and this one is earned*, which is a rule a later section can be
> held to.
>
> **What this owes, and it is one paragraph nobody has written.**
> [25 E10](../25-open-questions.md) is cited as the home of the roll-up and the ToC
> by two documents and **has never been edited to accept either**. E10's own
> forcing evidence is *people lost at first run*, not an author finding an admin
> page long — so R3 is not the evidence E10 was waiting for, and saying so is
> what closes the loop. Recorded there 2026-09-11.

**3. Is connection order a stored field?** ~~R2's drag-reorder is a data-model
change wearing a gesture. Order is currently whatever the filesystem returns,
and it is *semantic* — `resolveRole` takes the first match, so reordering the
rendered list without reordering resolution would make the `shadowed` badge lie.~~
A persisted order field is a schema addition, which by [polish](06-polish.md)'s own
house rule puts it out of polish. Likewise **duplicate cannot be a client-side
prefill** — the same reason the author struck their own key-population clause —
so it needs a server route that copies a credential without exposing it.

> ***CORRECTION, 2026-09-11 — the premise was false when it was written**, and
> this section is where the document's own standard applies to itself: §6 claims
> every statement about code here was checked by opening the file. This one was
> not.*
>
> **The list is sorted by label**, and has been since 2026-08-16 — three weeks
> before this was written (`providers/connections.ts:217`). **Resolution is by
> id**, not by position: `resolveRole` does
> `usable.find(c => c.id === binding.connectionId)`. So order is semantic in
> exactly two places, neither of them the rendered admin list: between two files
> claiming **one id** within a scope, where the label sort picks the winner and
> the loser gets the `shadowed` badge; and personal-before-system, which is a
> scope rule the admin list never shows because that list is system-only. A
> display reorder **cannot** make the badge lie — the badge is computed
> server-side per row, over the same array the resolver reads, and says a fact
> about that row.
>
> **DECIDED, 2026-09-11 — no stored order, and no reorder.** Not because it is
> expensive but because the question it was asked in service of has a better
> answer: what R2 wanted was *a second model on the same provider*, and that is
> a binding, not a position in a list. Ordering a list of two things nobody
> resolves by position is motion.
>
> **Duplicate is decided the same way and for the same reason.** The clause above
> is correct that it would need a server route — a create never reads a stored
> key, so the client cannot prefill one — but **the split dissolves the need**:
> a second model on one endpoint no longer wants a second connection. Duplicate
> stays unbuilt and unowned, deliberately, and if it returns it returns for a
> *different* case (one endpoint, two keys), which is the one that would justify
> the route. *One unverifiable citation is left standing rather than repaired:
> "the author struck their own key-population clause" names no text that exists
> in the corpus today.*

**4. Where do unselected suggestions live?** R11's *"save unselected
suggestions"* is a **persisted-shape** requirement, and that puts it on the
critical path to P11's export freeze rather than in the discretionary pile.
Turn segments are append-only and never rewritten, so suggestions generated
*after* a turn commits cannot be added to its record — which forces a fork the
note does not mention: generate them inside the turn as a `post` step, or store
them on the mutable half beside `lastSelectedChild`. Deciding the shape is cheap
now and a migration later.

> **DECIDED, 2026-09-11 — generated inside the turn as a `post` step, and
> written into the turn's own record.** The turn stays self-contained, export
> carries them with no special case, and the append-only rule is honoured rather
> than worked around. The cost is a step on every turn whether or not a
> suggestion is taken, and that is the right trade against a second store the
> export freeze would have to learn about.
>
> **P11's side does not know this exists, and that is the risk worth naming.**
> [P11 §1.8](27-p11-implementation.md) lists four things that must be right before
> the turn record freezes — optional fields, a foreign id, siblings rather than
> the path, provenance — and suggestions are not among them; the word does not
> occur in the document. The dependency is asserted only from this end. **If
> [P7.9](23-p7-implementation.md) cuts suggestions, this question leaves with
> them and nothing on P11's side catches it.**

---

## 4. Where each one goes

| # | Home | Size | Blocked on |
|---|---|---|---|
| **R5** | ~~Merge `feat/tagging_and_search`; correct P3's stage record~~ **Done 2026-09-08 (`a6a0344`); both corrections written 2026-09-09.** The residue is a walk — [D2a](05-manual-testing.md) — and a docstring | **zero** | nothing |
| **R9** rename | ~~Push the branch~~ **Done 2026-09-08**, shipped in alpha 4 | **zero** | nothing |
| **R10** | ~~[polish](06-polish.md); the finding is [P6B.3](20-p6b-playable.md)'s to route~~ **Written, 2026-09-09: [polish §11](06-polish.md)**, and [F-02](21-playable-log.md) is routed there | small | nothing |
| **R7** | Whoever owns [10 §9](../10-ui-surfaces.md) — unowned today. **Named at [manual testing §10](05-manual-testing.md), 2026-09-09** with [F-03](21-playable-log.md): a named absence, not a false owner | small | §1's shared layer |
| **R9** delete + archive | ~~A small client stage over routes that exist~~ **[P7B](28-p7b-presets-and-prompts.md)'s session-settings panel, placed 2026-09-11** — the surface `RenameSession`'s own docstring says such controls would otherwise start to become | small | ~~decision 4's placement question~~ **nothing — a mis-citation since `f449608`** (decision 4 is R11's), and P7B.2 has since answered the placement it meant. **But see §7: archive has no view and no unarchive** |
| **R3** search | ~~[polish](06-polish.md), reusing the branch's search idiom~~ **Written, 2026-09-09: [polish §12](06-polish.md)** | small | nothing |
| **R1** | Unowned; a 1.0 commitment [P11.0](27-p11-implementation.md)'s audit exists to find. **Named at [manual testing §10](05-manual-testing.md), 2026-09-09** with [F-05](21-playable-log.md). **Still unowned 2026-09-11**, and the 2026-09-11 sweep that placed eleven other surfaces passed over it without saying why | medium | ~~decision 1~~ **taken 2026-09-11 (§3); buildable now** |
| **R6** | ~~[P6B.3](20-p6b-playable.md) triage~~ **Closed 2026-09-09**: [F-06](21-playable-log.md) answers [P6 §5](18-p6-implementation.md), and P6 closed collecting it. **The question closed; the observation did not** — *nothing marks a turn that already has a continuation* has no home, and the server's own `abandoned` count is already computed and read by nothing | medium | ~~decision 1~~ **taken; the residue needs a home** |
| **R4** | Needs a paragraph in [10](../10-ui-surfaces.md) first — no owner, no text. **Named at [manual testing §10](05-manual-testing.md), 2026-09-09**, and see §6's correction: the refutation that downgraded it does not hold | medium | a written spec |
| **R3** roll-up + ToC | ~~[25 E10](../25-open-questions.md)~~ **Refused 2026-09-11, and recorded at [25 E10](../25-open-questions.md)** — which until then had never been told it was their home | medium | ~~decision 2~~ **taken (§3)** |
| **R2** | ~~[P7 §1.9](23-p7-implementation.md) for the real blocker~~ **§1.9 never carried it, on any branch.** [P7.3](23-p7-implementation.md) takes the *user* half on branch `p7`; the **admin half was owned by nobody and is built here, 2026-09-11** — see §7 | large | ~~decision 3~~ **taken: no reorder, no duplicate (§3)** |
| **R11** | [P7.9](23-p7-implementation.md) — Freeform, and its specification first. **Routed by name on branch `p7` only**, and not in that stage's exit criterion, so it can be cut without the gate noticing | large | ~~decision 4~~ **taken (§3)** |
| **R8** | [24 §1.4](../24-roadmap.md) *R4 — Curate*, post-1.0 | medium | — **but see §7: [24 §1.6](../24-roadmap.md) puts part of its cost in 1.0, and this table missed it** |
| **R9** import/export | ~~[P11](27-p11-implementation.md), blocked on a 2.0 design document~~ **Export is P11's and has no stage**; **import is not a commitment at all** and this row conflated them | large | export: settling [13 §4](../13-write-mode.md) |

**Build order has one hard constraint.** R8 subtracts what R1 and R6 add: if
turns can be deleted, the abandoned-line problem stops being a navigation
problem and becomes a data-loss one. **If only one of the three ships, it must
not be R8** — curation before navigation means people delete lines because they
could not find them.

***Narrowed 2026-09-11.*** R6 closed as an answer and builds nothing, so the live
form of the constraint is **R1 before R8**, with [P6](18-p6-implementation.md)'s
sibling affordance standing in for the rest. It is worth moving somewhere
durable: the constraint exists **only in this file** — a grep for its phrasing
matches nothing else on any branch — and R8 lives in a roadmap tier that is built
from [24 §1.4](../24-roadmap.md), which says nothing about it. One sentence beside
*R4 — Curate* would outlive this document.

---

## 5. What the walk did not produce, and what that means

**Nothing about a narrow viewport**, though three of the eleven assume a wide
one. [manual testing](05-manual-testing.md)'s D16 is the unwalked step that would have caught
it. Each of R1, R3 and R5 needs a sentence about what it means at 375px, or D16
will fail against work done because of this list. ~~*That is a gap in the
requests, not in the app.*~~

> ***CORRECTION, 2026-09-11: it is a gap in both, and the app's half is the
> larger one.*** The phone layout is not merely unwritten, it is **an unbuilt
> stage that the plan already named**: [P3.8 — the phone sheet](15-p3-implementation.md)
> is one of only two P3 stages with no *Landed* line, the code says so out loud
> (`workbench/prefs.ts:45`, *"the phone sheet is P3.8's problem"*), and
> [10 §3](../10-ui-surfaces.md) commits to it — *"on a phone, the panel is a
> sheet"*. Meanwhile the client has **no phone arm at all**: one responsive
> utility in the entire non-test client, no `matchMedia`, and a workbench whose
> default width of 384px is wider than the viewport D16 tests. So D16 would fail
> today against the *app*, before any refinement touched it. The three 375px
> sentences are still unwritten, and they are the smaller half.

**Nothing about [10 §9](../10-ui-surfaces.md)'s notifications and sounds**,
which is specified in detail and entirely unbuilt. R7 is its weakest in-tab
shadow. The likeliest reading is *not reached* rather than *working*: A–D are
all *sit in front of it and do a thing*, and the sitting that leaves the tab is
G, which is unwalked. **Predicted explicitly, so it can be checked:** if G is
walked, ~~05 §9~~ **[10 §9](../10-ui-surfaces.md)** becomes a finding.

> ***Two corrections, 2026-09-11.*** The bare *"05 §9"* was a **renumbering
> ghost**: when this was written `05` was the UI surfaces document, and
> [the renumber](../../../tools/doc-links.test.ts) repointed the linked citation
> in the paragraph above while leaving this one bare, so it had come to name
> *this file's* §9. Rule (f) cannot see a citation that is not a path — and a
> sweep found **41 more** unlinked `NN §N` prose citations across the corpus.
>
> **And the prediction cannot currently be recorded.** Sitting G's five steps are
> about memory, handle growth, record legibility and the held-open questions of
> P5 and P6; **no step in any sitting mentions a notification, a sound or a
> backgrounded tab.** A walker of G has nowhere to write the finding down, so G
> needs a row before it can discharge this. *Also worth stating plainly, because
> three documents repeat it too broadly: the notification-and-sound half of
> 10 §9 is owned in substance by [P10.1 and P10.2](26-p10-implementation.md) through
> [09 §3](../09-server-multiuser-deployment.md). It is the **first paragraph** — the
> collapsed live-turn line, R7 — that no phase owns.*

**Nothing about the library or the editors** — because the author refined those
on `feat/tagging_and_search` in the days immediately before this walk. The
silence is not evidence that they are finished; it is evidence that their
findings were collected on a branch that is not in alpha 3 and not in this list.

> ***Updated 2026-09-11.*** That branch merged the same evening and shipped in
> alpha 4, so the work is in. **What never arrived is the evidence**: the
> remedies are recorded as [polish §9 and §10](06-polish.md) — both still written
> as things to do, although both are built — and no observation record anywhere
> says what the author saw. This is the one place the walk's own routing rule
> (*evidence to the log, requests to this file*) was not applied to the author's
> own work.

---

## 6. How this was produced

Eleven parallel groundings against the code and the design corpus, each then
handed to an independent agent prompted to **refute** it, then four
cross-cutting sweeps — the unmerged branch, the 1.0 scope, the UI spec, and a
completeness critic. Twenty-six agents, no failures.

~~**Four groundings were refuted on a load-bearing claim**~~ **Five** — *the
sentence says four and then lists six, and the R4 correction below struck one of
them without anybody updating the count. An edit that does not reach the sentence
counting it is precisely the defect this document exists to catalogue* — and the
corrections are
folded in above: R2's owner (P7 does own it), ~~R4's *"the docs say nothing"*~~
— **see the correction below** — R9's
*"on origin"* (the rename commits are unpushed), R10's *"no phase owns this"*
(P6B.3 does), R11's *"blocking 1.0"* (a feature sentence is not a per-item
commitment), and R6's *"hover-only"* (the gesture row reveals on focus too).

**CORRECTION, 2026-09-09 — one of those four refutations does not survive being
looked up.** R4's grounding said *the docs say nothing about where the reader's
view sits*, and the completeness critic called that too strong, citing
`[07 §]` — **a citation with no section number, which is what should have
stopped it.** `07-branching.md` contains no sentence about scrolling, reading
back, or where a view sits; the word does not occur in the file. The nearest
real sentence in the corpus is [10 §14](../10-ui-surfaces.md)'s, and it argues
the **opposite**: session search is argued for 1.0 precisely because *"the
alternative — scrolling a six-hundred-turn transcript — is the experience it
exists to prevent."*

**So R4's original grading stands as written**: where the reader's view sits
during streaming is unspecified, and it is still the largest genuine blank
here. **And the shape is worth more than the item.** A refutation was accepted
because it arrived with a citation, and the citation had no section in it —
the one form [doc links (f)](../../../tools/doc-links.test.ts) forbids for
exactly this reason: *a checker can confirm that a document carries a number,
never that it is the one meant.* Here there was not even a number.

***CORRECTION TO THE CORRECTION, 2026-09-11 — the refutation above is itself
false, and it fails the same way it accuses.*** `07-branching.md:9` reads
*"Scroll back to any prior message, press one button, and you are on a new line
of story"*, and has since 2026-08-09 — a month before this was written. So *"the
word does not occur in the file"* was refutable by one grep, and the critic's
bare `[07 §]` almost certainly meant §1, which [P6](18-p6-implementation.md)
quotes and cites by that number. **R4's grading survives on substance** — that
sentence is about reading back in order to branch, not about where the view sits
while a turn streams — but it survives on a different argument than the one
given. *And the moral drawn from it does not survive at all: `doc links (f)`
forbids a citation that names a folder and a number with no filename, which is a
different shape from a filename with no section. The rule would not have fired.*

**This is a reading, not a walk.** Every claim here about what the code does was
checked by opening the file; every claim about what a person will *think* of it
remains to be walked. Where the two disagree, the walk wins.

*Re-read against the code on 2026-09-11, by fourteen agents over three trees —
`origin/main`, the local `main` two commits ahead of it, and the live `p7`
branch. **Three claims about code did not survive**: decision 3's premise (§3),
§1's "the button does not change", and §6's refutation of `07-branching`. Each is
corrected in place above rather than quietly fixed, because a document whose
method is "we checked" owes its reader the cases where it had not.*

---

## 7. Decided, and sequenced — 2026-09-11

**The four decisions §3 said only a person could make were made**, and are
recorded in §3 beside the arguments they answer rather than here, so that nobody
reads the answer without the reasoning. This section is the other half of what
§0 refused to do: **an order**.

### 7.1 What changed underneath this document

**Read this before trusting any row above.** Three trees disagree, and no single
one of them holds the whole picture:

- **`origin/main`** — what anybody else can clone. R5 and R9's rename are in it.
- **local `main`**, two commits ahead and **unpushed** — the 2026-09-11 sweep
  that gave eleven surfaces owners, created [P7B](28-p7b-presets-and-prompts.md),
  and placed R9's delete and archive.
- **`p7`**, twenty-nine commits ahead and mid-phase — the only tree in which R2's
  real blocker and R11 are routed anywhere at all.

**So R2 and R11 are owned on a branch that main cannot see, and R9 is owned on a
main that the branch cannot see.** The merge is the moment those meet, and it is
also when [P7B.5](28-p7b-presets-and-prompts.md) renumbers, which moves this
document's citations to `28`. Two things will be wrong at that moment and are
cheap now: [P7B](28-p7b-presets-and-prompts.md) quotes the *unamended* R9 row
from this file — the same commit that wrote the quote amended the row — and
`p7`'s §1.9 says `PATCH /sessions/:id` accepts only `name`, when it has accepted
`archived` since P6.

### 7.2 The order

**1. R2's admin half — now, in this thread.** The role-binding editor and
model provisioning; see §7.3. It is first because it is the only item here that
a person hits on their *third step* — configuring a second model — and because
it was owned by nobody.

**2. R5's residue, which is a walk and a docstring.** [D2a](05-manual-testing.md)
has never been walked; the `dock.test.tsx` docstring is still owed. Free, and
D2a is the only thing standing between *the fix landed* and *somebody watched it
work*.

**3. R10 and R3's search — [polish §11 and §12](06-polish.md), unscheduled by
design.** They ship when somebody picks them up, and **§11 has one sequencing
constraint worth obeying**: build the busy state as a `pending` prop on `Button`,
not as a flag on Send. Roughly **fifteen call sites already spell
`disabled={x.isPending}` by hand**, so the shared layer §1 argues for has that
many consumers waiting, and a Send-only flag dissolves it. *And §11's own text
needs two repairs first: the play page **does** subscribe to the step events (it
has since P3.5, and renders them only in the closed-by-default panel), and the
Send→Stop swap already exists — see §1's correction.*

**4. R7 — one arm on a component that already exists.** `StreamStatus` branches
on *reconnecting* and *failed* and returns `null` for *running*, while the
reducer already carries `running` and the page already derives it. The blocker is
not code. It is that **[10 §9](../10-ui-surfaces.md)'s live-turn paragraph
contradicts the section it cites** — it describes the live view as the turn
record being written, which [P3.5](15-p3-implementation.md) reversed, writing the
correction into `09 §3.3` and `10 §3` but not into `10 §9`. Anyone building from
10 §9 as written builds the rejected design. **Correct the paragraph, then it is
an afternoon.**

**5. R1, and then R4.** Decision 1 is taken, so R1 is buildable: the reader,
the route and the server's own docstrings have all been waiting for this consumer
since P3.0 — three separate in-code comments say the panel is meant to reach a
turn the head has passed, and none of them is cited by any planning document.
R4 still needs its paragraph in [10](../10-ui-surfaces.md) before it can have an
owner, and it should be written **with** R1, since both turn on the same address
and `p7` has just put three panels above the transcript, changing the scrollport
R4 is about.

**6. R9's delete and archive — [P7B.2](28-p7b-presets-and-prompts.md).** Two
things its sizing does not carry: **archive has no view and no unarchive**, so
the first archive control to ship makes a session vanish with no route back; and
**the delete route has no route-level test**, while archive has one.

**7. R11 — [P7.9](23-p7-implementation.md), on branch `p7`.** Decision 4 is
taken, which is the half that had a deadline.

**8. R8 stays post-1.0 — but part of its cost is not.**
[24 §1.6](../24-roadmap.md), one section past the one this document cites, puts
*turn storage tolerates removal* in 1.0. **The tombstone half is built and
tested; compaction is unbuilt, unowned, and named by no stage** — and the removal
*write path* is undesigned, with the two tests that construct a tombstone doing
it two different ways. It has to land, or be deliberately narrowed to tolerance
alone, **before [P11](27-p11-implementation.md) freezes the turn record**; after
that it is the migration [24 §1.6](../24-roadmap.md) exists to prevent. This
document missed it entirely, which is the sharpest thing the re-read found.

### 7.3 What R2's admin half is, and why it is not P7's

**The diagnosis in §0 was right that the blocker is a role-binding editor and
wrong about where it lives.** `p7`'s P7.3 takes *"the role-binding editor"* and
its own §1.9 calls that [10 §15.1](../10-ui-surfaces.md)'s **user** half;
main's [P10.3](26-p10-implementation.md) claims the per-user half and points back
at P7.3 for *"the editor itself"*. **Between the two, the admin half — the
install's default bindings, [10 §15.3](../10-ui-surfaces.md) — is claimed by
nobody**, and it is the half that unblocks the complaint.

**It is also the half that needs no phase**, which is why it lands here: the
route exists (`PUT /api/admin/bindings`), the client wrapper and hook exist and
**have no caller**, and [P2B §5](10-p2b-provider-configuration.md)'s line — *no
control for a layer with no caller* — does not reach it, because the install
default layer is exactly the layer that does have one.

**Why [10 §15.5](../10-ui-surfaces.md) never noticed.** It records P2B as having
closed *"system connections and the default role bindings, admin-only"*, and
P2B.3's exit criterion is *"an admin can **see**, in one table, what every role
will do"*. A read-only criterion was read as closure, so the spec believes this
is finished. **No audit that trusts §15.5 will ever find this**, which is a
better argument for building it than the complaint was.

**The shape, from the request rather than from the data model.** A person
choosing a model should meet **one entry per endpoint-and-model pair**, as a
single thing — not a connection picker and then a model picker, which is the data
model's shape leaking into the surface. And an admin setting one up should be
able to add a provider, ask it what it offers, and **provision all of them or a
subset**, which is what turns *ask the endpoint* from an assist into the path.

*Recorded here rather than in a phase document because it belongs to no phase,
and because [manual testing §10](05-manual-testing.md)'s rule is that the
alternative to an owner is a **named** absence — not a silent one.*
