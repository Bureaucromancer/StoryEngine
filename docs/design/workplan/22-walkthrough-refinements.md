# 22 — The walkthrough refinements: what the eleven notes actually are

**Status: grounded 2026-09-08 against `v1.0.0-alpha.3`, and unscheduled.**
Eleven notes written by the author while walking sittings A through mid-D of
[manual testing](docs/design/workplan/05-manual-testing.md). Each was read against the code and the design corpus
before being written down here, and **eight of the eleven are not what the note
says they are.**

**This document does not schedule anything.** It says, for each note, what the
request actually is, whether the thing already exists, which document owns it,
and what has to be decided before it can be built. Scheduling is a separate
decision and [manual testing §7](docs/design/workplan/05-manual-testing.md)'s rule applies to it: a thing is
owned, or it is deferred with an owner and a reason.

**Findings that are observations rather than requests go to
[playable log](docs/design/workplan/21-playable-log.md)**, in that file's record format, under the walkthrough's
own session heading. This file is the plan; that file is the evidence.

---

## 0. What grounding them changed

A refinement list is worth exactly as much as its diagnoses, and these diagnoses
moved a lot:

| # | The note asked for | What it actually is |
|---|---|---|
| **R1** | An outline on the selected turn, and selecting earlier turns for the workbench | **A 1.0 commitment with no owner.** [10 §444](../10-ui-surfaces.md) says the panel shows any turn *"current or historical"*; it is hard-wired to the head. The reader it needs already exists and has one caller. |
| **R2** | Duplicate + reorder connections; separate provider from model | **The data model already separates them.** The form fuses them. And the thing actually blocking *use a second model* is a role-binding editor nobody built — [P7 §1.9](docs/design/workplan/23-p7-implementation.md). |
| **R3** | Roll up settings sections, add a search bar, use the workbench as a table of contents | **The only item where the design argues back.** [10 §1.1](../10-ui-surfaces.md) rejects disclosure-as-reflex *for this surface by name*. The complaint is real; the remedy is refused. |
| **R4** | Autoscroll so the prompt sits at the top when results stream | **The largest genuine blank in the corpus.** Nothing anywhere specifies where the reader's view sits. Also: the prompt is not in the DOM during streaming, and the page does not scroll — the transcript does. |
| **R5** | Make the workbench resizable | **It has been resizable since P3.** The drag handle has been *zero pixels tall* the whole time. Fixed already, on an unmerged branch. **Nothing to build.** |
| **R6** | Make *continue from here* predictable | **The answer to a question P6 deliberately left open** and named PLAYABLE as the place to answer — [P6 §1.8](docs/design/workplan/18-p6-implementation.md). It is a triage input, not a new item. |
| **R7** | An in-flight indicator when the workbench is closed | **Specified nearly verbatim** at [10 §9](../10-ui-surfaces.md): *"a collapsed line while things go well"*. P3.5 built it only inside the panel. |
| **R8** | Delete a turn, warning about downstream turns | **Post-1.0 and already on the roadmap** — [24 §1.4](../24-roadmap.md)'s *R4 — Curate*, *"prune a subtree"*. Its warning is specified and is **stronger** than the one requested. |
| **R9** | Session delete, duplicate, rename, import, export, in the library | **Five verbs, five different truths, ~60% already built.** Rename is done but unpushed; delete and archive have routes and no UI; import/export is P11 and blocked. *"In library"* is a placement the object set refuses. |
| **R10** | Visual feedback on Send; a UI pass on all buttons | **A recorded, deliberately-accepted condition** — [P2C brief §](docs/design/workplan/13-p2c-brief.md) says it almost word for word. One file, because [10 §1.2](../10-ui-surfaces.md) consolidated the look into `ui/`. |
| **R11** | Suggested actions, pre-1.0, per-session toggle, keep the unselected | **The author's self-diagnosis is exactly right and checkable.** The phrase appears **once** in the whole corpus, in the sentence defining Freeform — a 1.0 mode. Every downstream document dropped it. |

**Three of the eleven survive as written**: R3's search bar, R8's gesture, and
R11's shape. Everything else changed on contact with the code.

---

## 1. The finding underneath five of them

**R1, R4, R6, R7 and R10 are one absence, not five.**

The client has a complete, deliberately-built vocabulary for **failure** and
almost none for **progress**. [P6B.0](docs/design/workplan/20-p6b-playable.md) built the failure half
on purpose and finished it: the most recent error across every mutation, ranked
by `submittedAt` so a stale failure cannot outrank a fresh one, and a fatal
stream close that names its class. That work is done and it is good.

The other half was never built. Between pressing Send and the first token there
is **no signal at all** — the button does not change, no live region fires, and
the only thing that knows a turn is running is a panel that is closed by
default. R7 is that gap seen from the transcript, R10 from the button, R4 from
the scroll position, and R1 and R6 from *which turn are we even talking about*.

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

`71ff7f1` on `feat/tagging_and_search` changes it to `inset-y-0` and adds
`tailwind-utilities.test.ts`, which reads the built stylesheet and holds every
class the client names to one Tailwind actually emitted. **The test matters more
than the fix**, because this is a bug class with no other gate — the commit says
so itself: *not a lint error, not a type error, not a test failure, and
invisible in jsdom.*

> **Three things this should change, beyond the merge.**
>
> **`dock.test.tsx` has five splitter tests that pass over a control with no
> height**, because jsdom computes no layout and they drive the separator by
> role. They are not wrong; they are blind, and worth a docstring saying which
> half they cover.
>
> **[P3 §](docs/design/workplan/15-p3-implementation.md)'s stage record claims a browser walk that
> cannot have happened** — *"open, drag to 484, reload, still open at 484"*. It
> is uncorrected on both branches. That is a `CORRECTION` in
> [manual testing](docs/design/workplan/05-manual-testing.md)'s sense and the most valuable thing this note
> produced.
>
> **[manual testing](docs/design/workplan/05-manual-testing.md)'s D2 tests that a size persists, never that it can
> be set by pointer.** The next refinement to add a pointer affordance is R2's
> connection reorder, and it will pass the same way unless the step is written
> to exercise the pointer.

### 2.2 R9's rename — push, then merge

Session rename is built end to end on `feat/tagging_and_search` at `dc6f777`,
`0afbac8` and `fff349b` — **and those three commits are not on origin.** The
branch's tip there is `989a3cb`; locally it is `fff349b`. Nothing is lost, but
the work is one machine away from being the only copy.

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
bookmarkable — which [P3 §7.2](docs/design/workplan/15-p3-implementation.md) already argued is what
forced Compare into a full view. The outline must also carry `aria-current`;
*"subtle but visible"* is exactly the case [P5](docs/design/workplan/17-p5-implementation.md) already
ruled on when it marked an addressed lore entry.

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

**3. Is connection order a stored field?** R2's drag-reorder is a data-model
change wearing a gesture. Order is currently whatever the filesystem returns,
and it is *semantic* — `resolveRole` takes the first match, so reordering the
rendered list without reordering resolution would make the `shadowed` badge lie.
A persisted order field is a schema addition, which by [polish](docs/design/workplan/06-polish.md)'s own
house rule puts it out of polish. Likewise **duplicate cannot be a client-side
prefill** — the same reason the author struck their own key-population clause —
so it needs a server route that copies a credential without exposing it.

**4. Where do unselected suggestions live?** R11's *"save unselected
suggestions"* is a **persisted-shape** requirement, and that puts it on the
critical path to P11's export freeze rather than in the discretionary pile.
Turn segments are append-only and never rewritten, so suggestions generated
*after* a turn commits cannot be added to its record — which forces a fork the
note does not mention: generate them inside the turn as a `post` step, or store
them on the mutable half beside `lastSelectedChild`. Deciding the shape is cheap
now and a migration later.

---

## 4. Where each one goes

| # | Home | Size | Blocked on |
|---|---|---|---|
| **R5** | Merge `feat/tagging_and_search`; correct P3's stage record | **zero** | nothing |
| **R9** rename | Push the branch | **zero** | nothing |
| **R10** | [polish](docs/design/workplan/06-polish.md); the finding is [P6B.3](docs/design/workplan/20-p6b-playable.md)'s to route | small | nothing |
| **R7** | Whoever owns [10 §9](../10-ui-surfaces.md) — unowned today | small | §1's shared layer |
| **R9** delete + archive | A small client stage over routes that exist | small | decision 4's placement question |
| **R3** search | [polish](docs/design/workplan/06-polish.md), reusing the branch's search idiom | small | nothing |
| **R1** | Unowned; a 1.0 commitment [P11.0](docs/design/workplan/27-p11-implementation.md)'s audit exists to find | medium | decision 1 |
| **R6** | [P6B.3](docs/design/workplan/20-p6b-playable.md) triage, against [P6 §1.8](docs/design/workplan/18-p6-implementation.md) | medium | decision 1 |
| **R4** | Needs a paragraph in [10](../10-ui-surfaces.md) first — no owner, no text | medium | a written spec |
| **R3** roll-up + ToC | [25 E10](../25-open-questions.md) | medium | decision 2 |
| **R2** | [P7 §1.9](docs/design/workplan/23-p7-implementation.md) for the real blocker | large | decision 3 |
| **R11** | [P7.9](docs/design/workplan/23-p7-implementation.md) — Freeform, and its specification first | large | decision 4 |
| **R8** | [24 §1.4](../24-roadmap.md) *R4 — Curate*, post-1.0 | medium | — |
| **R9** import/export | [P11](docs/design/workplan/27-p11-implementation.md), blocked on a 2.0 design document | large | — |

**Build order has one hard constraint.** R8 subtracts what R1 and R6 add: if
turns can be deleted, the abandoned-line problem stops being a navigation
problem and becomes a data-loss one. **If only one of the three ships, it must
not be R8** — curation before navigation means people delete lines because they
could not find them.

---

## 5. What the walk did not produce, and what that means

**Nothing about a narrow viewport**, though three of the eleven assume a wide
one. [manual testing](docs/design/workplan/05-manual-testing.md)'s D16 is the unwalked step that would have caught
it. Each of R1, R3 and R5 needs a sentence about what it means at 375px, or D16
will fail against work done because of this list. *That is a gap in the
requests, not in the app.*

**Nothing about [10 §9](../10-ui-surfaces.md)'s notifications and sounds**,
which is specified in detail and entirely unbuilt. R7 is its weakest in-tab
shadow. The likeliest reading is *not reached* rather than *working*: A–D are
all *sit in front of it and do a thing*, and the sitting that leaves the tab is
G, which is unwalked. **Predicted explicitly, so it can be checked:** if G is
walked, 05 §9 becomes a finding.

**Nothing about the library or the editors** — because the author refined those
on `feat/tagging_and_search` in the days immediately before this walk. The
silence is not evidence that they are finished; it is evidence that their
findings were collected on a branch that is not in alpha 3 and not in this list.

---

## 6. How this was produced

Eleven parallel groundings against the code and the design corpus, each then
handed to an independent agent prompted to **refute** it, then four
cross-cutting sweeps — the unmerged branch, the 1.0 scope, the UI spec, and a
completeness critic. Twenty-six agents, no failures.

**Four groundings were refuted on a load-bearing claim** and the corrections are
folded in above: R2's owner (P7 does own it), R4's *"the docs say nothing"* (too
strong — [07 §](../07-branching.md) makes scrolling back a 1.0 workflow), R9's
*"on origin"* (the rename commits are unpushed), R10's *"no phase owns this"*
(P6B.3 does), R11's *"blocking 1.0"* (a feature sentence is not a per-item
commitment), and R6's *"hover-only"* (the gesture row reveals on focus too).

**This is a reading, not a walk.** Every claim here about what the code does was
checked by opening the file; every claim about what a person will *think* of it
remains to be walked. Where the two disagree, the walk wins.
