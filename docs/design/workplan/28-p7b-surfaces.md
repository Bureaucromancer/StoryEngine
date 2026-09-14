# 28 — P7B implementation plan: the surfaces the server already has

**Status: plan**, written 2026-09-14, the day the phase was created and before
it opens. Unusual in this corpus only in that its contents were not designed —
they were *found*, by the documentation sweep recorded at
[P11 §0.1](27-p11-implementation.md), which is [P11.0](27-p11-implementation.md)'s
audit run four phases early. Every stage below is a client surface over a server
capability that already ships and is already tested.

***There is no P7A.*** [P6A](19-p6a-alpha-1.md) and [P6B](20-p6b-playable.md)
are the precedent for a letter phase, and the letter means the same thing here:
*follows P7 without re-cutting the number.* Said once so nobody goes looking for
a phase that does not exist.

---

## 0. Why this phase exists at all

**[P7](23-p7-implementation.md) asked for it, in as many words.** Its §0.1a
audit found that the client routes editors for `actors` and `lorebooks` and
nothing else, that `SlotSource.outlet` is therefore settable only by
hand-writing preset JSON, and that `stagingNotes`, every Treatment field and
every Setup field are in the same position. It then said what to do about it:

> *"One surface, four waiting consumers, no owner: that is the shape that should
> be sized rather than absorbed."*

Sizing it is this phase. **Absorbing it would have meant
[P11.2](27-p11-implementation.md)**, which is a sweep over editors that *exist* —
assist, provenance, history, the collapsed not-at-default fold — and which
creates none. Routing four missing editors to a stage that improves existing ones
is a routing that reads like an owner and is not one, which is exactly the
failure [manual testing §10.1](05-manual-testing.md) spent a section on.

### 0.1 The shape, which is one failure repeated six times

The other five stages are not a grab bag. They are the same defect:

> **The server half shipped early, and no phase since had a reason to open the
> client file.**

[P7 §0.1a](23-p7-implementation.md) named that mechanism while diagnosing two
instances of it. The sweep found six, and the sharpest is not even a missing
call: **the client already sends `PATCH /api/sessions/:id`** — `renameSession`
at [api.ts:937](../../../packages/client/src/api.ts) — and the same route has
accepted `{ archived }` since P2.3
([sessions.ts:1294](../../../packages/server/src/routes/sessions.ts)). Nothing
has ever sent it. The capability is one field away from a function the client
calls every time somebody renames a session, and it has been that way for six
phases.

**What makes the class invisible is that nothing goes wrong.** Every route has
tests; every test is green; the suite cannot tell the difference between a route
whose caller is a client and a route whose only caller is its own test. That is
a checkable gap rather than a philosophical one, and this phase adds the check
([§3](#3-verification--the-p7b-exit-gate)).

### 0.2 Why it is a phase and not a list of P11 items

[P11 §1.1](27-p11-implementation.md)'s rule decides it:

> *"Every item names the artifact it completes and the check that says it is
> complete. An item that cannot name both is not a hardening item; it is a
> feature, and it goes to the roadmap or to a phase."*

Four editors, a search surface and an arrival page are features by that test.
They are not polish either — [polish](06-polish.md)'s own house rule is that an
item belongs there if it *"changes what a user sees or does, is bounded, and
needs no schema change and no new contract"*, and while these need no schema
change, four new editor routes and a search page are not bounded in the sense
that file means. **P11 is the last phase**, so *"or to a phase"* had no
destination until this one. That is the finding
[P11 §1.8](27-p11-implementation.md) anticipated when it said *"if the answer is
that P11 has to split, that is a finding rather than a failure."*

### 0.3 Where it sits, and what it does not block

**P7B is not on [P8](24-p8-implementation.md)'s critical path.** Nothing in
Memory reads a surface built here, and nothing here reads anything Memory
builds. The phase can move without moving anything else — which is both its
virtue and the reason five of its six items survived this long. **A phase that
can always be deferred is a phase that always is**, and the only defence is
that it is now written down with a number.

---

## 1. Decisions this plan has to make

### 1.1 The editors are one surface, not four

[fields.ts](../../../packages/client/src/library/fields.ts)'s two tables are
already typed so that *"a kind cannot acquire an editor without acquiring a way
in"*, and [polish §1](06-polish.md)'s by-field view derives a kind's fields from
the schema at runtime rather than from a hand-written list — the arrangement
[10 §11.2d](../10-ui-surfaces.md) requires, so that *a field added to the schema
lands in the editor without a second edit*.

**So the work is to widen a mechanism, not to write four forms.** If this stage
produces four bespoke editors it has built the second description that
[polish §1](06-polish.md) exists to prevent, and the check for that is in §3.

*What each of the four actually needs beyond the generic form* is the part to
find out before building, not during:

- **Presets** — the slot list, and `SlotSource.outlet` in particular
  ([P5 §3](17-p5-implementation.md) records that an ST import routinely creates
  entries addressed to an outlet no shipped preset positions, and that the only
  repair today is hand-writing JSON).
- **Treatments** — `stagingNotes` among them, which
  [P7.12](23-p7-implementation.md) left with no way in.
- **Setups** — the declarative wizard's own declarations, which P7 built a
  renderer for and no author.
- **Packages** — the smallest, and the one whose editor is least useful without
  §4's deliberate omission below.

### 1.2 Home arrives as a prototype, and the full version is deferred by name

**Directed, and recorded in the terms given rather than translated.** The full
[10 §2.2](../10-ui-surfaces.md) home — resume, start, notice, recent work, in
that order — is **explicitly not core-alpha work**. It stays nominally a 1.0
feature, expected to land *immediately before the cut-over to feature-complete
beta*, and it may move further out. [polish §5](06-polish.md) carries that
wording, because polish is where the item has always lived and
[manual testing §10](05-manual-testing.md) files the whole polish file as
*"unscheduled by design"* — so until now it had a home that was not one.

**What lands here is the smallest thing that makes the address real**: `/`
stops being a redirect, the wordmark points at it, and the page shows the
changelog. Nothing else.

The value is not the changelog. It is that
[router.tsx](../../../packages/client/src/router.tsx)'s index route currently
throws a redirect to `/library` under a docstring reading *"`/` redirects until
home is built… every link resolves to the address that will still be correct
after home lands"*, and
[Shell.tsx](../../../packages/client/src/Shell.tsx)'s wordmark links to
`/library` under a comment reading *"It becomes home once home exists
([10 §2.2]) — the wordmark is the arrival affordance, and arrival is not the
library's job."* **Two comments describing a future.** This stage makes them
describe the present, at which point the full home is a page that gains
sections rather than a route that has to be introduced.

*And it removes a dependency the polish file records*: item 5 is urgent because
item 4 takes away the mixed table that answers *what was I doing?* today. A
prototype at `/` does not answer that question either — but it means item 4 no
longer has to wait for the answer.

### 1.3 Where the changelog comes from — build-time, not a route

`CHANGELOG.md` sits at the repository root and **nothing serves it**: no route,
no bundle, no copy in the image beyond the source tree.

**The decision is a build-time import into the client**, for three reasons
rather than convenience:

1. **A changelog shown by a running build should be that build's changelog**,
   not the repository's head. That is the same category of fact as the version
   string, which [AboutBuild](../../../packages/client/src/about/AboutBuild.tsx)
   already renders from the auth payload's `build` — so the precedent for
   *facts about this build* is set and this follows it.
2. **A route invites a question nobody needs to answer**: who may read the
   changelog, and does it exist before sign-in. A bundled string has no
   permission model because it is not a resource.
3. `tools/release.test.ts` already pins `CHANGELOG.md`'s version against
   `package.json`, `compose.yaml` and the unraid template, so a fourth consumer
   costs nothing and gains the same guarantee.

*The cost, stated:* the client bundle grows by the changelog, which
[20 — client loading](../20-client-loading.md) cares about and which
[P11.0](27-p11-implementation.md) is the stage that measures. Sixteen kilobytes
today. If that is the thing that moves the arrival budget, the measurement will
say so, and swapping a bundled string for a route later is a contained change.

### 1.4 Search is the phase's largest item, and the scope is a fork

[10 §14](../10-ui-surfaces.md) specifies a whole surface: two scopes — within
this session and across every session — over objects, turns and lore entries,
with hits off the current path *"returned, visually distinguished, and
labelled"*, and filters by speaker, kind and date. **That is larger than every
other stage in this phase combined**, and `README.md` already promises a reader
*"search the lines you abandoned — every one of them is still there."*

**The fork, stated rather than decided:**

- **The full §14** — one surface, both scopes, the branch labelling that is the
  differentiator §14 argues 1.0 on.
- **Within-session first**, with the cross-session scope held. Cheaper, and it
  is the scope a reader in a session actually reaches for — but it drops the
  branch-labelling argument, which is the part nothing else does.

*Decide at the phase's opening, not here.* What is not a fork: the surface
exists, because the route does and a promise in `README.md` does.

***And one defect travels with whoever builds it.***
[P5 §3](17-p5-implementation.md) recorded it and deliberately did not fix it:
SQL applies `limit` before the route filters by owner, so on a household server
one account's matches can consume the whole budget before another account's are
considered. It was *"`search`'s, not this stage's"* then. This is `search`'s
stage.

### 1.5 What this phase deliberately does not collect

The sweep found seventeen items and this phase takes six. **The rule applied is
the one in §0.1** — a client surface over a server capability that already
ships — and three near-misses are worth naming so the revisit does not
re-litigate them:

- **Openings, and the seed → expand → edit → accept → promote loop**
  ([03 §6](../03-data-model.md), **PORT** in [triage](02-triage.md)). By subject
  it belongs here: it is the setup wizard, which P7 built, and
  [setup-from-form.ts](../../../packages/client/src/play/setup-from-form.ts)
  lists `openings` among what has no control while naming owners for its
  neighbours. **What keeps it out is the expand loop**, which is a model call
  and a new interaction rather than a surface over a finished route. A
  candidate for the revisit, with that cost named.
- **[10 §9](../10-ui-surfaces.md)'s live turn view** — the collapsed in-flight
  line outside the workbench panel. Small, and genuinely this phase's shape.
  What holds it back is that it overlaps [polish §11](06-polish.md)
  (*"Something happens between Send and the first token"*) and
  **[R4](22-walkthrough-refinements.md)**, which has no specification at all
  yet. Building one third of a scroll-and-progress story is how the other two
  thirds get built twice.
- **`.sepack` import and export.** A package editor without it is a form over a
  bundle nobody can move, which is a fair objection to P7B.0's fourth kind. It
  is routed beside [P11](27-p11-implementation.md)'s session export because both
  are *how things travel* and both freeze a format — and that reasoning is why
  it is not here, where nothing else touches a format.

---

## 2. Stages

Ordered by argument, not by size. **P7B.0 first because it is why the phase
exists**; the three small ones next, because they are the ones most likely to be
skipped and doing them early is what stops that; then home, then search.

### P7B.0 — Editors for the four kinds that have none

Presets, treatments, setups, packages. §1.1 is the decision; the surface is a
widening of [fields.ts](../../../packages/client/src/library/fields.ts)'s
`EDITOR_ROUTES` and `NEW_ROUTES` and the schema-derived field description behind
them.

*Depends on:* nothing. *Ends at:* every library kind answers `kindHasEditor`
with `true`, `fields.test.ts`'s *"answers for the four that do not"* is deleted
rather than edited — **it is an assertion of absence and the absence is the
thing being removed** — and a preset written in the browser positions an
outlet.

### P7B.1 — Session housekeeping: delete and archive

`DELETE /api/sessions/:id`
([sessions.ts:1327](../../../packages/server/src/routes/sessions.ts)) has no
client wrapper at all. The archive half is one field on a `PATCH` the client
already makes (§0.1), with `?archived=true` on the list route and `archivedAt`
already carried on `SessionSummary`.

[P6B](20-p6b-playable.md) recorded the absence — *"No session housekeeping. No
rename, archive or delete in the UI, though the routes exist"* — and
[R9](22-walkthrough-refinements.md) graded it *"a small client stage"*, which is
a description rather than an owner. It has one now.

***And one third of that sentence has since come true, which is the sharpest
version of §0.1's finding.*** **Rename shipped.** `SessionsPage` calls
`renameSession`, which `PATCH`es the session — the same route, the same request,
**the same handler that has accepted `{ archived }` the whole time.** Somebody
opened this file, added a control, and the capability sitting one field away went
unbuilt because nothing in the repository was in a position to mention it.

*Depends on:* nothing. *Ends at:* a session can be archived, un-archived and
deleted from the browser; the archived ones are reachable and are not in the
default list; and deleting one goes through trash rather than around it
([03 §10.2](../03-data-model.md)).

### P7B.2 — The workbench, pointed at any turn

[10 §3](../10-ui-surfaces.md) says the panel shows any turn, *current or
historical*. It is wired to the head.
`useTurn` ([queries.ts](../../../packages/client/src/queries.ts)) is the reader
it needs and it exists, with one component calling it twice —
`ComparePage`. **The reader is built and the affordance is not**, which is the
whole finding: [F-05](21-playable-log.md), graded
[R1](22-walkthrough-refinements.md), filed in
[manual testing §10](05-manual-testing.md) as *"unowned; a 1.0 commitment"*.

*Depends on:* nothing. *Ends at:* selecting a turn the head has passed shows
that turn's blocks, calls, effects and budget verdicts, and the panel says which
turn it is showing — the ambiguity a panel that can show two things acquires the
moment it can.

### P7B.3 — Home, as a prototype that shows the changelog

§1.2 and §1.3. `/` becomes a page rather than a redirect, the wordmark points at
it, the page renders the changelog, and **nothing else goes on it in this
phase** — that fence is the stage, because a home page attracts every idea
anybody has ever had about a dashboard and [polish §5](06-polish.md) already
says so at length.

*Depends on:* nothing. *Ends at:* the two comments in
[router.tsx](../../../packages/client/src/router.tsx) and
[Shell.tsx](../../../packages/client/src/Shell.tsx) that describe home as a
future are rewritten to describe the present, and `/` is not a redirect.

### P7B.4 — The quarantine ladder's surface

`GET /api/library/errors`
([library.ts:193](../../../packages/server/src/routes/library.ts)) is the only
way to see what the import quarantine holds, and
[P2 manual gate §3.5](11-p2-manual-gate.md) says plainly *"No client code calls
it"* — and has since P2. The smallest stage here, and the one whose absence is worst: a quarantine
nobody can look into is a deletion with extra steps.

*Depends on:* nothing. *Ends at:* a person who imported a folder can see what
went to `compat` and why, from the browser.

### P7B.5 — Search

§1.4's fork, decided at the phase's opening. `GET /api/search`
([search.ts:108](../../../packages/server/src/routes/search.ts)) returns objects
and turns today and no client calls it.
[P5 §3](17-p5-implementation.md) called the absence *"settled rather than
deferred"* and pointed at §14.5; this is where that settlement is spent.

*Depends on:* the fork. *Ends at:* the sentence `README.md` already prints is
true from the browser, and the owner-filter defect §1.4 names is fixed or
recorded against a name.

---

## 3. Verification — the P7B exit gate

Under [manual testing §0](05-manual-testing.md)'s two-tier model: a small
critical list a person walks before the phase closes, and a remainder that
extends the standing list.

**The one check this phase owes beyond its own stages**, because the phase
exists on account of a class rather than six items:

1. **Nothing in the suite asserts that a shipped route has a caller.** Four of
   this phase's six stages are routes whose only callers are their own tests,
   and the suite is green over all four. A test that walks the server's route
   table and the client's request calls, and fails on a route with neither a
   caller nor a written exemption, is what stops the seventh instance. **It goes
   in whether or not the stages do**, and it is filed at
   [manual testing §9](05-manual-testing.md) as well, because it is a
   should-be-a-test the sweep produced rather than a stage's proof obligation.

The remaining gate steps are per-stage and are the *Ends at* clauses above,
walked rather than asserted where a person is the only instrument — an editor
that produces a usable preset, a quarantine listing somebody can act on, a
search result a reader can follow back into a session.

### 3.1 The critical list — derived, not chosen

[manual testing §0](05-manual-testing.md)'s three-clause criterion: **(i)** it
falsifies this phase's own claim, **(ii)** it compounds if wrong, **(iii)** it
is walkable with what is to hand.

| # | Do | Clears | Result |
|---|---|---|---|
| C1 | Author a preset in the browser that positions an outlet, and import an ST preset that addresses one. Both resolve | P7B.0, and [P5 §3](17-p5-implementation.md)'s diagnosis whose only repair was hand-written JSON | |
| C2 | Archive a session, confirm it leaves the default list and is reachable; delete one and find it in trash | P7B.1 | |
| C3 | Open the workbench on a turn the head has passed and read its blocks | P7B.2 | |

**Three, and the reasoning for what is not here.** P7B.3 is a redirect becoming
a page — clause (i) has nothing to falsify, and a person will see it the first
time they click the wordmark. P7B.4 is one list. P7B.5's walk is real but its
scope is a fork, so a critical row written now would be a row written against a
stage that does not have a shape yet; it joins the standing list when the fork
is decided.

***What this list cannot reach.*** Every row is a check against something the
walker just built, which means **the class this phase exists to fix is invisible
to it** — the gate cannot tell whether a *seventh* surface is missing, only
whether these six arrived. That is what §3's route-caller test is for, and it is
the reason that check is listed before the stages rather than under them.

---

## 4. Out of scope, deliberately

- **The full [10 §2.2](../10-ui-surfaces.md) home** — §1.2, deferred by
  direction, with its destination and its escape hatch written into
  [polish §5](06-polish.md).
- **`.sepack` import and export** — §1.5, routed beside session export at
  [P11](27-p11-implementation.md).
- **Openings and the seed-expansion loop** — §1.5, a candidate with a named
  cost.
- **[10 §9](../10-ui-surfaces.md)'s live turn view, [R4](22-walkthrough-refinements.md),
  and [polish §11](06-polish.md)** — §1.5, held together because they are one
  story about what the reader sees while a turn runs, and R4 has no
  specification yet.
- **The editor sweep itself** — assist, provenance, history, and the collapsed
  not-at-default fold. That is [P11.2](27-p11-implementation.md)'s and stays
  there: this phase makes four editors *exist*, and P11.2 is what makes every
  editor *good*. **The sequencing is the point** — a sweep over six editors is
  the same work as a sweep over two, and doing it before the four arrive would
  guarantee doing it twice.

---

## 5. What only the revisit can settle

- **Search's scope** (§1.4). The one fork this document refuses, and the only
  decision that changes the phase's size by more than a day.
- **Whether the package editor ships without `.sepack`** (§1.5). A defensible
  no, and if the answer is no then P7B.0 covers three kinds and the fourth moves
  to P11 with export.
- **Whether the route-caller check (§3) can be written at all**, or whether the
  client's request layer is too dynamic to walk statically. If it cannot, the
  honest fallback is a hand-maintained exemption list — worse, but still a list
  somebody has to look at, which is more than exists now.
