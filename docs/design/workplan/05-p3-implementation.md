# 05 — P3 implementation plan

**Status: rewritten against the panel; audited for readiness 2026-08-26, at
`ba5ff4a`, and the outstanding P2 record items adopted into P3.0 the same
day.** Drafted during P1 as a skeleton, revised once against the turn record
as built, rewritten here because [05 §3](../05-ui-surfaces.md) changed the
workbench's shape underneath it — and then audited three days later, because
the P2C.0 closeout moved the record underneath §3. The audit's findings are
§0; corrections it forced elsewhere are marked *audit correction* in place;
what §3 still listed as P2's after the audit is now P3.0's work, with §3
keeping the reasons.

**P3 delivers** the inspector panel: a non-modal dock, toggled from the keyboard,
that expands over Play or Library, remembers whether it is open and how big across
navigation, is never gated behind a debug mode, and whose subject is whatever the
main view is showing — a turn record in Play, an object's raw truth in the
Library.

**The old plan's central claim survives and is still the phase's best sentence:**
the record holds almost everything, and the workbench is a *reader*, not a second
implementation of the assembler ([05 §3](../05-ui-surfaces.md)). Every view below
renders a field the record already holds. If a view needs data the record lacks,
the fix is in the record, not in workbench-side recomputation — recomputation is
how the viewer and the truth drift apart.

**What does not survive is the shape.** The old plan treated *how much workbench
lives in Play* as an open question and leaned toward a route beside the session.
[05 §3](../05-ui-surfaces.md) now marks it **[RESOLVED]** the other way — Play
keeps one always-visible context-fill meter, and clicking it opens the panel in
place, already on the current turn: *"A full workbench beside every message is
still not the answer; a full workbench one keystroke behind every message is."*
And the old plan has no Library half at all, which is half of what the panel is
for.

**Three consequences follow, and they are what the rewrite is.**

**The panel is chrome, and the chrome is where the new risk lives.** The reader
renders fields that exist onto primitives that exist. The dock lands on five
separate absences: a client whose only `keydown` listener is a modal focus trap,
a shell that is one centred column with three nested `<main>` tags, an app where
nothing is a scroll container, zero breakpoints, and no pointer handling
anywhere. None of it is hard. Together it is more than the viewer — §5.

**Edit-and-re-run leaves for P6**, where [01 P6](01-work-plan.md) already puts
rewrite, reroll, the RNG tape and sibling navigation. §1.8.

**And the phase gains a stage it never had**, because the client has no typed turn
record: `api.ts` carries six fields plus an index signature and names the
workbench as the phase that owes the fix. §1.9.

**Why the phase is still early and still small.** Everything after P3 is debugged
through it, and the record already holds what it displays
([01 P3](01-work-plan.md)). If a *turn view* here grows large, something is being
computed that should have been recorded. That test still applies to the reader; it
does not excuse the dock, and §5 says so in the plan's own words rather than
inheriting a sentence that has stopped being true.

**CI this phase establishes:** little that is new — the record is already
golden-file tested, and P2C's cassette corpus is what lets the block table be
tested against records from real endpoints rather than from a stub this repository
wrote to agree with itself — a corpus that, as of the audit, is still empty; §0
carries the consequence. The panel's own logic is unit-tested; what jsdom can
reach is named in §4.

---

## 0. Readiness — audited 2026-08-26, at `ba5ff4a`

Three days after this rewrite, P2C.0 closed out and moved the ground under §3.
This section is what an audit of the tree found, checked claim by claim rather
than remembered. The baseline: the suite is green — 1185 tests passing, 4
skipped, 1 todo, across 91 files, with typecheck and both linters clean — and
no P3 work has started. No `<aside>`, no keyboard infrastructure beyond the
focus trap, no `ui.workbench-*` key anywhere in client or server. The plan
still describes a greenfield.

**The record is more ready than §3 says.** Two of §3(a)'s five bullets landed
at the P2C.0 closeout and are marked **Done** there: the cancelled turn's
`ModelCall` (finding 2 in [16](16-p2c-log.md), which P2C adopted exactly as
this plan asked), and all four provider-boundary items — truthful
`resolved.modelId`, recorded `finishReason`, provider-reported `usage`, and a
per-connection context window that arrived *with* a surface, a form field
behind the connection editor's *What this endpoint can do* disclosure. What
remains of §3(a) is exactly the three items no real run was ever going to
force: `advisory`, `purpose`, and the budget stamp. Every §3(b) item was
verified individually and still holds. **Both lists are now P3.0's** — adopted
rather than left addressed to a P2 that has moved on, since the panel is the
first caller that notices any of them missing; §3 keeps the reasons, P3.0
carries the work and its ordering.

**Two of §6's four P2C handoffs do not exist, and they are the two only a real
session can produce.** The honest provider boundary is real and verifiable in
code, and the gate-correction habit is demonstrably alive —
[15](15-p2c-first-real-run.md) is dense with struck-through corrected claims.
But the cassette *corpus* is empty: the recorder shipped
(`providers/capture.ts`, on by default under `pnpm dev:logged`, and
`pnpm test:live` records every live exchange), `captures/` is gitignored as
designed, and `packages/server/src/providers/fixtures/` **does not exist** —
the machine for producing cassettes exists and the bytes do not, because
P2C.1 through P2C.4 have not run. The journeys list is a P2C.4 output and
P2C.4 has not begun: the triage table in [16](16-p2c-log.md) is empty against
fourteen findings, and the only session in the log is the automated stub run,
whose own entry says it is not a person's session. The calibration that P3.2
"makes continuous" was never taken once.

**So the sequencing question is real, and it is answered here rather than
discovered.** P3.−1 through P3.1a depend on nothing P2C still owes — the
chrome can start today. What is degraded until at least one real run produces
curated cassettes: golden-testing the block table (stub-versus-stub until
then, the exact failure the CI paragraph above names), the per-block
estimate's baseline, and gate step 12's walk, which wants turns nobody
scripted. Either P2C.1 runs first, or P3 starts on the chrome and the
corpus-dependent claims wait for the corpus. What P3 must not do is promote a
stub-derived record into `fixtures/` and call the CI paragraph satisfied —
that is the double defining the truth, the confusion the capture tier exists
to end.

**One addition the record made that this plan did not order.** A stalled
endpoint now ends the turn on an idle timeout, distinct from a user's Stop.
That is a fourth failure shape the call view in P3.2 has to render as itself —
a timeout that reads as *cancelled* blames the person for the endpoint. And
adjacent to it: `TurnCost` now records null rather than a fabricated zero, so
the cost view owes *unknown* a rendering distinct from *free* — the old
"rendering zeros" bug is gone and left a display requirement in its place.

**The retention question resolved in P3's favour.** §6 said compaction lands
on P3's doorstep if the re-parse measurement came back bad. It came back good
— finding 14: session and turns reads flat at 4.8–17.7 ms from 13 to 55 turns
— so [02 §8](../02-data-model.md) stays **[OPEN]** where it is. The half P3
does inherit is payload, not parse: `GET /turns` returns the whole transcript,
about 10.8 KB a turn and 590 KB by turn 55, and the panel is the first surface
that reads all of a record. `?limit=1` exists and is cheap; P3.0's read-a-turn-
by-id is the panel's route to one turn without the transcript riding along.

---

## 1. Decisions this plan had to make

### 1.1 Where the panel mounts, and what *expands over* means

**An `<aside>` in `Shell`, sibling to a single `<main>`: insetting the main view
on desktop, overlaying it as a sheet on a phone.**

`Shell` is the only mount point whose state survives navigation, and it already
carries two cross-route concerns for exactly that reason — `useTheme()` and the
restart banner. So persistence *within a session* is free, and only a full reload
reaches storage.

**"Expands over" in [05 §3](../05-ui-surfaces.md) is a claim about navigation, not
about z-order** — the panel is not a place you go. Devtools, the shape §3 invokes,
insets; and an overlay on a centred column covers the text you opened the panel to
explain, which contradicts *"left open while you work"* in the same paragraph. On
a phone §3 asks for the overlay itself, and concedes why: *"on a phone the
workbench **is** briefly a place, because there is no room for it to be anything
else."* So the design carries both shapes and picks by viewport, which is also
what devtools does.

**The cost, stated rather than discovered:** the inset needs one `<main>` and a
height-managed shell, and the app has neither. `Shell` renders a `<main>`, and
`PlayPage`, `SessionsPage` and `SettingsPage` each render a *second* one inside
it — *audit correction:* at what turns out to be one width spelled three ways,
`max-w-reading` twice and `max-w-3xl` once, all 48rem inside the shell's 56rem,
so the mess is two widths under three spellings rather than three widths. The
library routes render no `<main>` at all, so the inconsistency is wider than
duplication — and no `jsx-a11y` plugin is installed, so nothing catches any of
it. Nothing anywhere is a scroll container: the
document scrolls, `min-h-dvh` appears three times and `h-dvh` never, and
`PlayPage`'s `h-full` resolves against a parent with no height, so its transcript
has never actually scrolled independently. That is P3.−1, and it is a
prerequisite rather than a detail.

### 1.2 What persists, where — and explicitly not the URL

**`ui.workbench-open` and `ui.workbench-size` in `prefs.json`, patched on commit,
clamped on read.**

The preference store was designed for this case and says so: its own docstring
gives the motivating example as *"whether a pane is collapsed"*, rejects
`localStorage` in the same breath because that *"loses everything on a move to
another browser, which for pane state is exactly the case somebody notices"*, and
tolerates an unreadable prefs file on the grounds that *"a broken prefs file means
somebody's pane is collapsed wrong"*. The client half exists: `usePrefs` and
`usePatchPrefs`, the latter the one optimistic mutation in the codebase and
already pinned by a test.

*Two constraints to write down rather than rediscover.* Keys must match the
store's `KEY_PATTERN`, so `ui.workbench-open` with a hyphen and never
`workbenchOpen`. And the size is patched **on pointerup**, not per pointermove,
because the store serialises a read-modify-write per handle through a
`KeyedQueue` — a PATCH per pointer event would queue behind itself.

*The objection, and why it loses.* A per-account pixel size fights between a
laptop and a large monitor, and a preference round-trip flashes where a
`localStorage` mirror would not. Clamping on read defuses the first in one line,
and the flash never happens for a navigation because the state lives in `Shell`.
[05 §1.2](../05-ui-surfaces.md)'s *"the only use of localStorage in the client"*
stays true rather than needing an amendment nobody argued for.

**And not the URL, which is actively wrong here rather than merely worse.**
*Audit correction:* the old sentence claimed every route validates and drops
unknown search params. Two of seven do; what actually discards a stray param is
that every nav link hard-codes `search={{}}`, and the index route throws a
redirect. So a global `?workbench=1` needs `validateSearch` *added* to five
routes, dies on every click of the nav, and still dies at `/` — the conclusion
gets stronger while the sentence it stood on was wrong. Beyond the mechanics: a URL-addressable panel is a place, and
back-button-closes-the-panel is the anti-pattern §3 is avoiding. Said out loud
because it is the reflex a router-shaped codebase invites.

### 1.3 The Library subject is in P3

**Yes — and it is roughly a fifth of the phase, because most of it is a move
rather than a build.**

The decisive reason is not that [05 §3](../05-ui-surfaces.md) lists it. It is that
**this phase's own gate step lands there**: every block's source clickable through
to the object it came from. And [05 §2.1](../05-ui-surfaces.md)'s claim that the
library is *"a near-raw view of the data and the files"* has, until now, had
nowhere to put the depth it promises.

Of §3's five items, only one is new. *JSON as stored* and *provenance* are already
on the detail page, though provenance is reduced to two timestamps; *folder path*
is one field on the presenter, reusing the layout's existing portable path;
*version history* is unbolting a server feature that already ships for every kind;
**the index rows** are the one genuinely new thing, and they are one read-only
route.

**Scoped to a single object's route.** The library list has no selection concept —
rows are links — and inventing one is a mechanism this phase does not need. Over
the list, the panel shows its empty state.

### 1.4 Where version history lives, now there are two candidates

**One revision-list component, two hosts, different powers: the panel gets the
list read-only, and restore, rename and pin stay in the editor.**

[05 §2.1](../05-ui-surfaces.md) draws the boundary and it decides this — *browse
and inspect are raw; editing is assisted* — and restore is an edit. §3 lists
version history under *"the raw truth of that object"*: the list, not the actions.

Two mechanical facts agree. The editor's history panel re-seeds the editor's form
when a restore lands, and there is no such completion over a read-only subject —
it degrades to a query invalidation. And only actors have an editor, so a panel
offering *restore* for a lorebook would restore into nowhere.

*The tidier alternative is rejected:* having the editor's control summon the panel
instead of mounting its own copy moves an editing action into the inspector, which
is the boundary §2.1 exists to hold.

*Work:* extract the revision list from the editor's panel, and take the kind as a
prop instead of the hardcoded actor call sites — five of them, not the four the
plan first counted: history read, version payload, restore, rename and pin.

### 1.5 The diff is a full view, and the reason is the address

**A route — two turns in one session, the block table aligned by block id, plus
the call parameters.**

[05 §3](../05-ui-surfaces.md) justifies the escalation by saying a panel *"has one
subject by construction"*. **That argument does not carry, and the plan should say
so rather than repeat it.** [05 §11.2a](../05-ui-surfaces.md) already ships a
two-payload diff *inside* a panel and cites §3 as its precedent for doing so. The
two sections contradict each other.

The property that actually forces a full view is **addressability**: a comparison
has to be bookmarkable, pasteable into a bug report, and reopenable after the head
has moved past both turns. A panel scoped to what the main view is showing can
never be any of those. That is a substitution this plan is proposing, not one the
design has made — §6.1 records the amendment owed.

*Two mechanical requirements.* The existing object differ cannot be reused for the
block table: it aligns arrays by index, so one inserted block reports everything
below it as changed. And the compare view needs a **read a turn by id**, because a
re-run sibling and a turn the head has passed are both off the current path.

*The panel supplies the entry point* — *compare this turn with…* — which answers
[§1.1](../05-ui-surfaces.md)'s *depth is charged per visit*: you do not arrive
somewhere you already were, you leave once and deliberately.

### 1.6 A dry run splits in two, and the split is what makes the meter possible

**P3 builds a *stateless assemble preview* — no job, no draft, no record, no head.
The *promoted dry run* — a parked job you can send or abandon — is the last stage
and the first thing cut.**

This is the most consequential restaging, and it comes from something neither §3
nor the old plan noticed. **§3 makes the context-fill meter persistent in Play,
and the meter's numerator does not exist at rest.** The denominator is free — the
budget policy is pure over capabilities, params, config and preset — but *spent*
requires collect-and-estimate, that policy has exactly one caller and it is inside
the call path, no route assembles without sending, and no progress event carries a
budget. Reading the previous turn's verdict is stale by exactly the thing the
meter is for: the input somebody is typing.

The stateless preview is cheap — an early exit at a seam where a cancellation is
already thrown — and it is the **shape constraint** that makes P5's keyword tester
a text box over existing machinery rather than a second pipeline: candidates in,
blocks and verdict out.

**The promoted dry run is not cheap, and the cost is in the commit protocol
rather than in the assembler.** Four things to state now:

- The unsent record's home is the **draft**, which is already a full turn, already
  durable, and already what the live view renders — not an appended segment.
- The job status needs a value that recovery **abandons** rather than finalises,
  or a restart commits somebody's dry run into their story.
- `ModelCall.outcome` needs an un-sent value, because the rendered messages exist
  nowhere else and inspecting them is the whole feature. The renderer merges by
  capabilities that are not recorded, so the client cannot reconstruct them — and
  reconstructing is the recomputation this plan's own head forbids.
- A pending dry run holds the session's one active-job slot. That is the
  *enforcement* of §3's *"visibly pending until sent"*, not an obstacle to it.

*A note for P7:* park, publish, resume-on-intent is
[06 C5](../06-open-questions.md)'s mechanism arriving early — said here so C5
attaches rather than rebuilds. But the obvious name is taken:
`Turn.status: 'suspended'` already means a turn that will resume and complete.

### 1.7 The generalised keyword test stays at P5, and not for scheduling reasons

[05 §3](../05-ui-surfaces.md) calls the keyword tester excellent and wants it over
the whole assembly against a real session's channel state. **All three of its
inputs are absent at P3.**

No lorebook key is read anywhere — the collector returns an empty list for lore,
and `secondaryKeys`, `selectiveLogic` and `scanDepth` have no non-test readers.
There is no text-conditional activation of any kind: the only per-block gates are
`enabled`, `appliesTo` and `omitWhenEmpty`. And *a real session's channel state* is
one clock whose slot renders empty.

**A tester whose answer cannot vary with the pasted text teaches a false model of
the assembler**, which is worse than not shipping it.

*The deferral carries a forward obligation*, and it belongs here rather than in
§4: P3 builds assemble-without-dispatch as a parameterised function, so P5's
tester is a text box over machinery that already exists.

### 1.8 Edit-and-re-run leaves for P6

**The surface moves; the risk it was carrying stays here as a test, and the test
is downgraded.**

[01 P3](01-work-plan.md) does not list edit-and-re-run — [01 P6](01-work-plan.md)
owns rewrite, reroll, the RNG tape and sibling navigation. The old plan attributed
it to 01 anyway.

Three mechanical facts agree. Submitting a turn refuses any parent that is not the
head, so a sibling re-run is that refusal by construction. Replay has no
production entry point — the runner constructs a fresh generator with no options
and there is no field for a tape on either the runner's options or the payload.
And there is no block-override hook nor any field in which to record that a block
*was* overridden, so a re-run's record would be indistinguishable from an ordinary
turn.

**The gate step is corrected rather than carried.** There is no production draw
site anywhere in the server and every committed tape is empty, so *"identical
draws (rewrite)"* would replay nothing against nothing. P3's gate claims the
plumbing; the reproduction claim moves to P5, whose gate already asserts it
against activations that actually draw. A gate correction in
[P2C.4](15-p2c-first-real-run.md)'s own habit, and labelled as one.

*And the inherited contradiction is resolved rather than carried:* the old §1.2
said *"the UI simply shows the newest"*, and §3 preserves Marinara's rule that
editing *"does not change the reply already on screen"*. Whichever P6 picks, P3 no
longer has to.

### 1.9 The record's shapes move into the shared package

**P3's opening stage, not a formality.** The client's turn record is six fields
plus an index signature, and the sessions API's own block comment in `api.ts`
already names the workbench as the surface that owes the shared package. A typed
block table, a typed verdict and an id-keyed comparison cannot be written over
`unknown`.

[13 §1](../13-internal-contracts.md)'s *"internal and free to migrate"* is what
makes this a decision rather than a chore: moving the shapes into `shared` is a
promise to stop churning them. So it lands *after* the record repairs P3.0 now
adopts from §3, in the same stage — and that ordering is the reason the
adoption's home is P3.0 and nowhere later.

### 1.10 What the old §1.5 becomes

Rewritten as three lists in [§3](#3-what-the-record-still-owes), and **two of the
five original gaps were smaller and in different places than the old plan said.**
`ModelCall.cost` is plumbed — the adapter simply never prices, because no price
table ships; and `TurnCost` now records null rather than a fabricated zero, so
the cost view owes *unknown* a rendering distinct from *free*. And the
`resolved.modelId` gap closed exactly as predicted: P2C took it, the adapter now
asks `modelThatAnswered` on both paths, and its docstring names the old bug —
"a comparison of a value with itself" — verbatim. §3(a) marks it done.

---

## 2. Stages

### P3.−1 — One main view

**Landed 2026-08-27**, across two commits (`fe57f62` and the height-managed
shell commit carrying this note). What the stage's three clauses became:

- *Delete the three nested mains:* done; the three page roots are `div`s and
  `shell-layout.test.tsx` counts exactly one `main` landmark on every routed
  page, mutation-proofed by re-promoting one.
- *Settle one content width:* two `page` recipes in `ui/classes.ts` — the
  tooling column (56rem) and the reading column (48rem) — each spelled once,
  per [05 §1.2]'s measure-against-the-shell distinction; `max-w-3xl` is gone
  from the codebase, and SessionsPage moved from the reading measure it was
  borrowing to the tooling width (a visible change, reversible in one line if
  it reads badly). **Pages own their column; the shell's `<main>` is a bare
  scroll container.** The draft had the shell wrap the outlet in a
  `min-h-full` flex wrapper with Play's column on a zero flex basis — measured
  in a real browser, a `flex: 1 1 0` item contributes its full content height
  to an auto-height container, so the wrapper grew and main scrolled anyway.
  The column being main's *direct child* is what lets Play's `h-full` resolve;
  `Shell.tsx` and `ui/classes.ts` carry the reasoning in place.
- *The scroll question ("nothing configured in the router to replace it"),
  answered:* the shell resets `main.scrollTop` on a **pathname** change — a
  search-param change (the library's kind filter) keeps its place. What is
  lost, on purpose: Back no longer restores a list position; the upgrade when
  a surface earns it is the router's element scroll restoration. The router's
  own default reset targets the window and became a no-op the moment `<main>`
  scrolled.

Verified in a real browser against a six-turn session: the document no longer
scrolls anywhere, the transcript scrolls independently under a header that
does not, the input bar stays put, `/settings` scrolls in `main`, and a
navigation lands at the top. jsdom proves the landmark count and that the
reset fires; it computes no layout, so the scrolling itself stays a
browser-pass claim.

Delete the three nested `<main>` tags, settle one content width, and make the
shell height-managed so `<main>` is the scroll container. **No panel code.**

*Why it is separate:* it is the stage that stops the panel arriving entangled with
a layout rewrite. Two consequences to look at rather than assume: `PlayPage`'s
transcript scrolls independently for the first time — a real behaviour change, not
a refactor — and browser-native scroll restoration stops applying once `<main>`
scrolls, with nothing configured in the router to replace it.

*Ends at:* a test asserting exactly one `main` landmark — scoped to the routed
app, because the pre-auth gate renders three more `<main>`s before the router
mounts and they are not this stage's problem — and a transcript that scrolls
under a header that does not.

### P3.0 — The record, repaired and then typed where the client can see it

**Landed 2026-08-27**, in eight commits, in the stage's own order — every
shape change before the move, the move before the by-id read. What each
clause became:

- **`advisory` + `purpose`** landed as the pair, and the gate-guidance suite
  now asserts [testing §1]'s invariant over the record's own fields — the
  source-kind proxy its header apologised for is retired.
- **The honest budget stamp** became `BudgetLimit {tokens, ceiling, source,
  share?}`: `source` names whichever side won the min, the share narrows
  without relabelling, and the shipped 6144 now reads as the config's 8192 ×
  0.75 — the live-editable remedy visible at last.
- **Blocks and budget moved onto each `ModelCall`** (required, with
  `notFilled` beside them), `TurnRequest` shrank to `{calls}`, and the turn's
  blocks are a derived union nothing stores. The hidden dependency the move
  exposed is solved rather than inherited: the runner checkpoints a
  **provisional in-flight call** at assembly (stamped `error`/`terminal`/
  "The server stopped before this call returned." — never `cancelled`, never
  a minted un-sent value), every live exit replaces it by id, and
  recovery.test's it.todo is a passing test. *One doctrine extension, made
  deliberately:* a bare Stop between attempts restamps the provisional as
  `cancelled` rather than dropping it — finding 2's exception stays bare,
  and the record stops losing assembly it had already durably kept.
- **Pre-assembly failures write no `request`** — `initialDraft` omits it and
  `write()` assigns only once a call exists, per the record's own docstring.
- **Sources name the object as used**: history gained `turnId` as identity
  (stable candidate ids; `range` stays as display info), actor sources carry
  `contentHash` (the cast resolver stopped discarding it one line from where
  it was needed), and the persona arm gained `actorId`/`contentHash`
  nullable. Preset sources stay unhashed with the reason in the arm.
- **The effect vocabulary split**: `engine-computed` and `user-only` replace
  the merged `update-policy`, and `supersedes` links the engine's clock write
  to the same-turn refusal it overrode — [05 §3]'s third outcome as a link,
  not an inference. **The degraded state is a recorded deferral, not code**:
  `ChannelDefinition` ships without `schema`, so a writer is structurally
  impossible and a guard on a validation that cannot fail would be dead code
  impersonating a mechanism; the field's comment names the writer's arrival
  and the panel renders it whenever present.
- **Not-filled slots**: §7.5 decided and shipped — see the [DECIDED] entry in
  §3(b) and the 02 §8 write-back.
- **The move**: `packages/shared/src/turn.ts`, plain types outside
  `PORTABLE_SCHEMAS` with the internal-tier argument in its header; the
  server's type homes are re-export sites, the client's `TurnRecord` is the
  real `Turn`, and the index signature every workbench field used to arrive
  through is gone.
- **Read a turn by id**: `findTurnLocation` (the location index's first by-id
  reader), `readTurnById` (index hit verified by id-match, cold-read
  fallback per [13 §5], tombstones absent on both paths), the route with the
  file's own 404 discipline, and the client's `readTurn`/`useTurn`.

Every new test was reddened by a named falsifying mutation before its
commit; the leaf-walk's vacuous guard and NULL_IS_DATA moved with each shape
in the same commit. Golden churn stayed stub-versus-stub and said so — no
record was promoted into `providers/fixtures/`; the corpus is still P2C's to
produce.

The stage adopts everything [§3](#3-what-the-record-still-owes) still listed as
P2's at the audit — adopted 2026-08-26, because a P2 that has moved on was
never going to circle back, and the panel is the first caller that notices any
of it missing. The stage's one rule is ordering: **every shape change lands
before the move into `@storyengine/shared`**, because §1.9's promise to stop
churning the shapes is only keepable once they have stopped churning.

First the repairs, golden files and all:

- **`advisory` on `AssembledBlock` and `purpose` on `ModelCall`** — §3(a)'s
  invariant pair, which makes [testing §1](10-testing.md)'s invariant
  expressible over a committed record for the first time.
- **An honestly stamped budget `limit.source`** — §3(a).
- **Blocks and budget move onto each `ModelCall`**, and *the turn's blocks*
  becomes a derived union — §3(b), and the largest golden-file change of the
  lot.
- **A turn id on a history block's source** — §3(b); without it P3.6's compare
  is wrong from turn twenty-one onward.
- **A content hash on a block's source** — §3(b), what gate step 4 resolves
  through to the object that was *used*.
- **The effect vocabulary**: the two refusals distinguished, the degraded state
  given a writer-shaped home, the supersession link — §3(b).
- **A pre-assembly failure stops writing an empty request** — §3(b), the
  smallest, and the one the record's own docstring already demands.
- **Not-filled slots, only if §7.5 is decided by then** — the one adopted item
  gated on a design answer rather than on effort. Undecided, it stays §7.5's,
  and the plan owns the stated consequence: the panel cannot answer *why is
  there no lore in this prompt* until it lands.

Then the move: the record's shapes into `@storyengine/shared`, replacing the
client's index signature. Then **read a turn by id** over the existing per-turn
read and location index.

*Ends at:* the client compiles against real shapes and can read any turn by id,
including one the head has passed — and the golden files describe the record
the rest of the phase will spend itself reading.

### P3.1 — The panel frame, empty

**Landed 2026-08-27**, in three commits (the query lift, the chord hook, and
the frame commit carrying this note). The decisions the stage text left open,
now made and verified:

- **The chord is Ctrl+`** — VS Code's panel muscle memory, free of the two
  devtools chords the plan rules out. Matched on `event.code === 'Backquote'`
  *or* `event.key === '` + '`'`, and the second arm is measured rather than
  defensive: automation drivers and remote desktops synthesise keydown with an
  empty `code` — this repo's own browser pane sends `{ code: '', key: '`' }` —
  while dead-key layouts send a code and no character. Both arms are
  mutation-proofed in `useToggleChord.test.tsx`.
- **The dock edge is inline-end** (right in LTR), spelled logically —
  source-order after `<main>` in a flex row, `border-s` — at a fixed `w-96`
  until P3.1a's drag makes the size a preference. Open state is in-memory in
  `Shell`; the reload half of gate step 2 waits on P3.1a's keys.
- **Escape is an element-scoped `onKeyDown` on the aside, not a document
  listener** — the *only when focus is inside it* guard is structural, since
  the handler only ever sees events targeted inside. The dialog-over-dock
  interplay was walked in a real browser: a 412 conflict dialog over the open
  dock, one Escape, only the dialog closed. The accepted corner (focus
  clicked into the dock under an open modal closes both) is documented on the
  component.
- **The opener** sits in the header's account cluster as a compact `Button`
  with `aria-expanded`, `aria-controls`, `aria-keyshortcuts` and the chord in
  its `title` — as first-class as the keystroke. It is a button and not a nav
  entry, so `Shell.test.tsx`'s pinned *offers no workbench entry* stays green
  by construction; a comment at the call site warns against "fixing" that
  test into matching buttons.
- **The subject is route-derived** (`useMatch` on `/play/$sessionId`), which
  is what keeps the reader stateless: over Play, the head turn's JSON in the
  `Panel` inset variant — deliberately not a third JSON-viewer spelling;
  P3.3 consolidates — and over everything else the honest empty state, §7.3's
  interim answer shipped as behaviour while the design question stays open.

*Ends at*, delivered: `dock.test.tsx` pins Tab escaping the dock and the
absent `aria-modal` — the focus-trap tests inverted, with the trap itself
attached as the falsifying mutation and caught — plus the chord over Play,
the editable guard, inset-not-replace (both landmarks at once), Escape's two
halves, the head turn (against a two-turn transcript, keyed on input text
because the head's JSON contains its parent's id), and open-across-navigation
with the subject following. Every test was reddened by its named mutation.
The browser walk covered the chord, the guard in the real action input, both
Escape halves, the dialog interplay, navigation persistence, the empty state,
and both themes rendering the dock from tokens.

The non-modal `<aside>` in the shell; open and closed only, no resize; the
keyboard toggle with its editable-target guard; a visible opener; the subject
wired to Play showing today's JSON.

**Explicitly not `useFocusTrap`,** and the reason is sharper than *it is modal*:
that hook teleports focus back into its surface on the next Tab press — *audit
correction:* the recovery is Tab-gated rather than continuous, which makes the
argument concrete instead of weakening it: click into the transcript with the
dock open and the first Tab yanks you back — `preventDefault()`s Escape
unconditionally on a document listener, and captures its focus-return target
once at first render, which silently degrades to nothing for a panel left open
across ten navigations. Attaching it to a dock makes the main view unusable
while the dock is open, which is the exact opposite of *left open while you
work*.

So: a labelled non-modal landmark, Tab passing straight through, no `aria-modal`,
and Escape closing the dock **only when focus is inside it**, because a dialog may
be open over the same surface.

*The toggle is a genuinely new mechanism, not a hook call.* The only keyboard
handling in the client today is that focus trap. It needs a document listener, a
guard for `input` / `textarea` / `contenteditable` — text inputs are everywhere,
including the action input and the guidance box — and a decision about the chord,
which §3 does not make and which cannot be F12 or Ctrl+Shift+I.

*Ends at:* tests that Tab escapes the dock and that the panel is not `aria-modal`
— the inverse of the focus-trap tests, and the regression that catches the next
person reaching for that hook.

### P3.1a — Persistence and resize

**Landed 2026-08-27**, in two commits. `ui.workbench-open` and
`ui.workbench-size` exist through the existing hooks, in `ui/theme.ts`'s
helper-pair shape (`workbench/prefs.ts`); the prefs cache *is* the open state,
so the optimistic mutation carries the toggle and gate step 2 is now
performable in full — walked in a real browser: open, drag to 484, reload,
still open at 484. Decisions and findings:

- **Closed is the absence of the key**, as `system` is for the theme; the
  size is a plain number, clamped **on read** ([§1.2]'s one-line defusal,
  bounds 280–640, default 384) and on write, so a hand-edited
  `ui.workbench-size: 10000` renders a dock that fits.
- **The drag is the splitter's pointer half**: live width travels as the
  aside's `--workbench-size` custom property set imperatively, so a
  sixty-hertz drag re-renders one thin strip and not the JSON beside it, and
  the one PATCH lands at pointerup — the `KeyedQueue` reason, exactly as
  §1.2 wrote it down. The stage's named test exists and was mutation-proofed
  by committing per move.
- **The splitter grew its ARIA half** (an addition the stage did not order,
  kept because a pointer-only control would be the client's first
  mouse-trapped one): `role="separator"`, focusable, arrows stepping 16px
  with one write per gesture at keyup, Escape abandoning a live adjustment
  without closing the dock, blur committing.
- **Two mechanism corrections the browser walk forced, recorded in place:**
  the gesture's width lives in a ref beside the render state, because a burst
  of pointer events inside one task reaches `commit` before React re-renders
  and a state-read commit silently drops the write; and `setPointerCapture`
  is wrapped, because an inactive pointer throws and losing capture is the
  right price where losing the resize is not.

*Ends at:* a test that one drag patches once rather than per pointer event.

*Note:* CSS `resize` is not the mechanism — it cannot splitter, and its utilities
slip between both linters.

### P3.2 — The turn subject

The old P3.0, unchanged in content. Block list in order with clickable sources,
plain-language reasons, tokens, included or dropped with the responsible rule; the
budget verdict with headroom-aware *what falls out next*; the calls with resolved
model, params and rendered messages mapped back through their block ids; effects
including rejected ones; steps including skipped and failed; per-turn spend in
tokens and wall time.

**And per-block estimate beside per-call reported** — the one place a person sees
the estimator disagree with the provider, which is what
[P2C](15-p2c-first-real-run.md)'s calibration measures once and this makes
continuous. *Noting §0:* the once has not happened — no real run has — so until
P2C.1 delivers a baseline, this view is the first measurement rather than the
continuation of one.

*Ends at:* `TurnRecordDisclosure` is deleted. Its own docstring hands the job here.

### P3.3 — The library subject

The as-stored view, collapsed by default with a copy control and a bounded height
— this is [polish §2](09-polish.md)'s component, and building it here discharges
that item rather than colliding with it. The real folder path. Object-level
provenance as rows rather than two timestamps. The read-only revision list. The
index-rows projection behind one new route.

The detail page keeps its own embed per [polish §2](09-polish.md); the panel's win
is depth without the visit.

*Ends at:* opening the panel over a **shadowed** object names the winning path —
the one question that surface currently poses and cannot answer.

### P3.4 — The play-surface signal, and the stateless preview

[05 §3](../05-ui-surfaces.md)'s **[RESOLVED]** answer: the always-visible
context-fill meter on the input bar, fed by a stateless assemble that takes
candidates and returns blocks and a verdict without a job, a draft or a record.
Clicking the meter opens the panel already on the current turn.

*Ends at:* the meter reflects the pending input rather than the last committed
turn. **This is the stage the revision created**, and the old plan had it last.

### P3.5 — The live half, or its explicit refusal

Decide [04 §3.3](../04-server-multiuser-deployment.md) rather than assert it:
either the reducer keeps enough for the panel to render a turn under construction,
or the plan states the live view is deferred and the record views accept a partial
record. If it is built, a refused effect needs a reason or the live and durable
views disagree about what happened.

### P3.6 — Compare

The addressable full view: id-keyed block alignment, same-session pairs, entered
from the panel.

### P3.7 — Promote a dry run

Last, and the first thing cut. §1.6 lists what it costs.

### P3.8 — The phone sheet

Reuses the dialog and its trap, because modal *is* the correct model on a phone.
Its real cost is the shell's first-ever narrow audit — the header is a five-item
flex row inside a centred column and has never been looked at below the fold.
Budget the audit separately; the sheet is the smaller half.

---

## 3. What the record still owes

Three lists. They had three different owners when written; since the 2026-08-26
adoption they have one — everything below that is not marked **Done** is
P3.0's — but the lists keep their original framing, because *whose debt this
was* is the part worth remembering.

### (a) P2's record — was owed before P3 starts, now P3.0's

Each is one field or one enum value. *Audited 2026-08-26:* two of the five
landed at the P2C.0 closeout and are marked **Done** below; the other three
are adopted into P3.0's repair list.

- **`advisory` on `AssembledBlock`.** It carries
  [testing §1](10-testing.md)'s invariant — *no advisory block ever appears in an
  effect-producing call* — which is **not expressible over a committed record at
  all** today. The gate test settles for the block's source kind and says in its
  own header that this is *"deliberately the weaker, true thing"*. That proxy does
  not hold: the assembler takes the union with any author-declared advisory block,
  so a guidance source is neither necessary nor sufficient.
- **`purpose` on `ModelCall`** — the invariant's other half, and not derivable:
  it is computed from the step's declared contributions and writes, and
  `StepOutcome` records neither.
- ~~**A `ModelCall` for a cancelled turn.**~~ **Done, and P2C adopted it exactly
  as asked** — finding 2 in [16](16-p2c-log.md): a Stop mid-call now writes the
  interrupted call with `outcome: 'cancelled'`, the model that was *asked*
  (because nothing answered), a real `wallMs`, and `usage`, `finishReason` and
  `error` null rather than invented; a Stop between attempts stays bare, because
  there is genuinely no call to name. Two consequences for this phase: the
  outcome vocabulary is now `refused | truncated | incomplete | cancelled` and
  still has **no un-sent value**, so §1.6's dry-run requirement stands untouched;
  and *the model that answered* is a claim about `ok` calls only — see the gate's
  step 4.
- ~~**Truthful `resolved.modelId`, recorded `finishReason`, non-null `usage`, and
  a per-connection context window.**~~ **Done, all four**, at the P2C.0 closeout:
  the adapter asks `modelThatAnswered` on both paths, `finishReason` is mapped
  and recorded, usage is provider-reported and gated on a `reportsUsage`
  capability, and the context window is a per-connection override with a form
  field behind the connection editor's *What this endpoint can do* disclosure —
  so it arrived with a surface and does not trip §4's standing line. This
  phase's gate steps now compare something to something else.
- **An honestly stamped budget `limit.source`.** It reports `preset` for a number
  that is three-quarters of the config default, which hides the exact remedy
  [13 §1.5](../13-internal-contracts.md) says the field exists to suggest. *And
  sharper since the audit:* `limits.contextTokens` is now live-editable from the
  settings form, so the number a person can actually change is precisely the one
  the record mislabels.

### (b) P2's record, newly owed because of the revision — now P3.0's

These are what the panel's promises turn into. *Audited 2026-08-26: all six
still hold, verified individually — and all six are adopted into P3.0's repair
list, with one caveat: not-filled slots land only once §7.5 is decided, because
that item is gated on a design answer rather than on effort.*

- **Blocks and budget move from the turn's request onto each `ModelCall`.**
  [05 §3](../05-ui-surfaces.md) promises *"one per model call"*; the runner
  overwrites per call, so an earlier call's block ids name rows that are not in
  the table. This changes golden files, and makes *the turn's blocks* a derived
  union rather than a field.
- **A turn id on a history block's source.** Window-relative positions make any
  block-keyed comparison wrong from turn twenty-one onward.
- **A content hash of a block's source object**, so the gate's *clickable through
  to the object it came from* resolves to the object that was **used** rather than
  the object with that id today.
- ~~**Not-filled slots, represented somehow**~~ **[DECIDED] at P3.0**, per
  §7.5's resolution: a second list, never a third `included` state — each call
  carries `notFilled: { blockId, source, reason }[]` with the reason a class
  (`disabled` / `not-applicable` / `no-producer` / `empty-source` /
  `unknown-slot`), because a slot that produced no candidate has no text, no
  tokens and no budget ruling, and a row among the blocks would be a
  block-shaped hole. Written back into [02 §8] as the contract. The measured
  motivation stands: on the only real turn available, ten of twelve blocks
  left no row.
- **Effects need to distinguish their three outcomes.** An engine-computed refusal
  and a user-only refusal write the identical policy string, the degraded state
  has no writer anywhere, and the engine's replacement carries no link to the
  proposal it superseded. So of §3's three effect outcomes the panel can currently
  render one and a half.
- **A turn that failed before assembly must not write an empty request.** It does
  today, against the record's own docstring.

### (c) P3's own work from the start

The contracts into `shared`; the by-id turn read; the folder path on the
presenter; the index-rows projection route; the kind on the revision list;
headroom-aware *what falls out next* phrasing — all its inputs are already in the
verdict, so this is the viewer's honesty rather than the assembler's; and
per-block estimate beside per-call reported.

### And one debt to point at rather than ratify

**A block's `reason` is free English prose in a durable record**, which is the
opposite of the rule progress events are held to — *a failure travels as a class*.
The collector already records the key-and-params conversion as P11 sweep debt.
[05 §3](../05-ui-surfaces.md) makes `reason` the **primary view**, so P3 is where
that debt becomes visible and where somebody will be tempted to call it settled.
One line pointing at P11, so this is not the phase that quietly ratifies it.

---

## 4. Verification — the P3 exit gate

Marked for what a test can assert and what only a person can walk — P2C's framing,
that most of a gate like this is not automatable and that is the point.

**Assertable.**

1. The toggle works from the keyboard over both Play and Library; typing in the
   action input or the guidance box does not fire it; the panel **insets** rather
   than replaces the main view; Tab passes through it; it is not `aria-modal`.
2. **Open the panel, then navigate Play → Library → Play.** It is still open,
   still the same size, and its subject changed with the view. Then reload: still
   open, same size. *One step that tests the mount point, the store and the
   subject-follows-view rule at once* — and it is the claim §3 makes that nothing
   else touches.
3. **Nowhere switches it on.** No debug mode, no advanced toggle, no nav entry,
   nothing in Settings. [05 §2](../05-ui-surfaces.md) names this as the specific
   failure of both source projects, and a panel is the shape that most invites it.
   The nav half is already pinned: `Shell.test.tsx` asserts *offers no workbench
   entry, because it is a panel and not a place* — keep it passing.
4. Over a turn: every block's source is clickable through to the object it came
   from, no `unknown` sources on an ordinary turn, and the resolved model is the
   one that **answered** — on `ok` calls; a cancelled or failed call truthfully
   records the model that was asked, because nothing answered, and the check must
   respect that asymmetry rather than flag it.
5. *What is about to fall out of context* is answered from the verdict without
   generating anything — and on a turn with plenty of headroom it does not claim
   the system instruction is about to fall out.
6. Per-block estimate beside per-call reported, on a turn where they differ.
7. Over a library object: the as-stored view matches the bytes on disk — hand-edit
   the file and watch the panel follow — the folder path is one you can paste into
   a file manager, and the revision list is there **with no restore button on it**.
8. Over a **shadowed** object, the index rows name the winning path.
9. **Compare:** hand-edit the session's own copied preset on disk, drop a block's
   priority, take the same turn again — the compare view shows exactly what
   changed, and its address can be pasted into a bug report.
   *This replaces the old step 4*, which cannot be performed: there is no preset
   editor until P7 and the default preset is a code constant. A session copies its
   preset at creation and the runner re-reads the session per turn, so hand-editing
   the copy does change the next assembly — which pays the storage thesis and the
   diff in one gesture. A gate correction, labelled as one.
10. **The replay path is wired** — a committed tape can be handed to a runner and
    replays. *Not* "identical draws": every tape is empty and there is no
    production draw site, so the reproduction claim moves to P5. §1.8.
11. Dry run, if P3.7 ships: inspect then send → one record; abandon → nothing
    sent, nothing charged, and a restart does not commit it. The pending state is
    visible and the session says it is busy.

**Only a person can walk.**

12. **The legibility claim itself.** Somebody who did not build the turn opens the
    panel on a real turn they did not script and says why it came out that way —
    without the log, without the source, without a JSON pretty-printer. **And its
    honest counterpart:** at least one turn where the answer is *I could not tell*,
    written into [16](16-p2c-log.md) with what was missing, rather than waved
    through. This is [01 §4.1](01-work-plan.md)'s fourth PLAYABLE hypothesis — the
    one it calls likeliest to be wrong and cheapest to fix here.
13. **The density check** ([05 §1.1](../05-ui-surfaces.md), *depth is a cost paid
    for by the user, and it is charged per visit*): a turn with thirty blocks
    reads as a table rather than thirty disclosures; nothing that belongs on
    screen is behind a click for calm's sake; and the panel open over Play does
    not squeeze the transcript into a column nobody can read.
14. **The phone.** At 375px the same toggle produces a full-height sheet with the
    same content, the main view under it does not scroll horizontally, and the
    sheet is dismissable one-handed.
15. **A rejected effect is visible with its reason.** *Flagged honestly:* nothing
    in the shipped mode proposes an effect — Scene ships one step that writes
    nothing — so this needs a fixture, or it belongs to the phase that ships an
    effect-producing step. Do not leave it reading as performable.

**And the standing line from [01 §2.3](01-work-plan.md): no phase exits with
configuration that has no surface.** P3 introduces two stored values — the panel's
open state and its size — and their surface is the panel's own toggle and drag
handle. Written down rather than assumed, because this is the first phase with a
real caller for the qualification: **a preference set by direct manipulation has
its surface in the manipulation, and does not owe a control in Preferences.**

---

## 5. Out of scope, deliberately

**The old fences all survive:** aggregate spend tracking (post-1.0 —
[14 §3](../14-roadmap.md); per-turn tokens only), the keyword test's lore half
(P5, §1.7), sibling navigation and the branch-aware history view (P6), the
workbench over renditions (P9), editor completeness (P11), any assembly logic in
the client, and **no editing of the record itself** — the record is what happened.

Two need re-pointing. Sibling navigation now also covers *where a re-run lands*,
which leaves with edit-and-re-run to P6. And *no assembly logic in the client* now
also means **the panel never recomputes what a dry run would produce** — it asks
the server.

**What the panel shape newly invites, refused by name:**

- **Editing a library object from the panel** — the strongest new pull, and
  [05 §2.1](../05-ui-surfaces.md) has already answered it: browse and inspect are
  raw, editing is assisted, and the assisted surface is the editor. No field
  edits, no restore, no rename, no pin.
- **The by-field read view** ([polish §1](09-polish.md)). That is the *assisted*
  rendering, derived from the editor's schema-driven form; the panel's job is the
  raw truth beneath it. Already handed to polish, and this plan stays consistent
  with itself.
- **Backlinks, the *Used by* panel** ([05 §5.2](../05-ui-surfaces.md)). No link
  table exists in the index — this is schema work plus a query plus a library
  surface. *And record that §5.2 overstates what P1 built* when it says the
  derived index answers it already, so nobody plans against the overstatement.
- **A second JSON viewer.** One component, shared with the detail page and
  [polish §2](09-polish.md)'s editor pane — or two ship and disagree about
  wrapping and copy. *Audit correction: too late to prevent — two already ship
  and already disagree.* The detail page's unbounded `<pre>` and the turn
  disclosure's bounded one differ on background, radius and height, and neither
  uses the `Panel` inset variant built for exactly this. P3.3 is therefore a
  consolidation of two, not the extraction of one.
- **A log viewer.** P2C is about to make the log genuinely good, which is exactly
  when somebody proposes piping it into the panel. **The record's claim is that
  you do not need the log**, and gate step 12 *is* that claim.
- **A preset editor.** *Edit a block* edits this turn's input, never the preset
  that produced it — and at P3 the preset is a code constant. The gate's compare
  step does it by hand on disk, deliberately.
- **A running session total** anywhere in the dock. A persistent panel invites it;
  aggregate spend is post-1.0.
- **A dedicated route or a nav entry for the panel.** The shell already documents
  the absence correctly. The one addressable exception is the compare view, which
  is a comparison rather than the panel.
- **An app-wide responsive pass.** P3 owes the shell enough to hold a sheet at
  375px, not a phone-first redesign.
- **The Playwright harness.** P2C produces the journeys *list* and explicitly not
  the harness; P3 adds *open the workbench* to that list. **Correct the old plan's
  CI line as a matter of fact:** Playwright is not installed and no E2E directory
  exists, so this phase cannot say the journey joins a thin Playwright set. What
  jsdom can reach is the toggle flipping a preference key, a drag patching once,
  Tab escaping the dock, and the absence of `aria-modal`. Pixels are not.

---

## 6. The honest size

**Nearly free is no longer true, and this plan narrows the phrase in its own
words rather than inheriting it.**

The claim was always about the *reader*, and that half survives intact. Every turn
view renders a field the record already holds, onto primitives that already exist
— the panel primitive's inset variant is documented as a read-only echo of stored
bytes, the dense table classes are already tuned for a revision list, the badge
has a provenance tone, and P2C's repaint means a dense panel does not need a
design-system pass first. **The panel's contents are almost entirely existing
parts.**

**Its chrome is not.** A keyboard toggle in a client whose only `keydown` listener
is a modal focus trap. A dock in a shell that is one fixed centred column with
three nested `<main>` tags. A height-managed layout in an app where nothing is a
scroll container. The first breakpoint in a client with zero. The first pointer
handler. The first non-modal overlay. And a context-fill meter that needs a server
affordance nobody has built. None of it is hard; together it is more than the
viewer.

**What would have to move out for the old sentence to be true again: the panel.**
If P3 shipped the record viewer *in place* — replacing the existing disclosure
where it already sits, with no dock, no toggle, no persistence and no Library
subject — it would be nearly free, and it would be the plan as written before the
revision. That is not on offer, because §3 has resolved the shape and because this
phase's own gate step lands in the Library. So: **the reader is nearly free, the
panel is not, and the mutating features never were.**

**And the adoption grows P3.0, not the phase's tail.** Taking §3's outstanding
items in makes the opening stage heavier by exactly the golden-file churn the
repairs were always going to cost *somebody* — every adopted item was already
load-bearing for a stage or a gate step here, so the alternative was never less
work, only the same work discovered later, after the shapes had been promised
stable. None of it joins the cut list below: a repair the reader depends on
cannot be cut, only rediscovered.

**The order of cuts if the phase runs long**, decided here rather than under
pressure: **P3.7** first — the only item with a commit-protocol change attached,
and P3.4's stateless preview keeps the meter honest without it. Then **P3.5**,
which can be an explicit deferral rather than a build. Then **P3.6**, which is
where [14 §1.4](../14-roadmap.md) already plans a second entry point and can
arrive with it.

**Do not cut the Library subject to make room.** P4's own demo is a converted
preset whose block list is recognisably the preset that went in, P4's import
review needs provenance, and the object-level provenance fields the panel shows
are exactly what import fills in.

**Two facts that were stated here to be discovered have since resolved, one
each way.** The re-parse measurement came back good — finding 14: reads flat
from 13 to 55 turns — so [02 §8](../02-data-model.md)'s retention question
stays **[OPEN]** where it is and compaction does not land on P3's doorstep;
what P3 does inherit is the payload shape, stated in §0. And of the **four
things P2C hands P3 as inputs rather than courtesies** — the cassette corpus
(which is what lets the block table be golden-tested against records from real
endpoints instead of a stub this repository wrote to agree with itself), the
honest provider boundary (without which four gate steps compare a value to
itself), the journeys list, and the gate-correction habit, of which this
rewrite's replacement of step 9 and downgrade of step 10 are two instances —
two are in hand and two do not yet exist. The accounting, and the sequencing
consequence decided rather than left to pressure, is §0.

---

## 7. What the design still has to settle

Undecided by the *design*, not merely absent from the code. Each needs an answer
written back into [05](../05-ui-surfaces.md) or [02](../02-data-model.md) rather
than settled inside a work-plan file.

**7.1 Whether the panel may re-subject itself.** §3 says the subject follows the
main view. But a block's source click wants to land on a Library object, and that
is this phase's own gate step 4. Moving the main view honours the rule and yanks
you out of the turn you were reading — [05 §1.1](../05-ui-surfaces.md)'s per-visit
cost, charged for a click nobody meant as navigation. Re-subjecting the panel
keeps your place and breaks the rule. *Devtools breaks the rule here:* clicking a
network row does not navigate the page.

**7.2 Whether the diff's escalation argument survives.** §3 grounds it in a panel
having one subject by construction, and [05 §11.2a](../05-ui-surfaces.md) already
ships a two-payload diff inside a panel citing §3 as precedent. The two
contradict. §1.5 re-grounds the escalation on addressability, which is the
property that actually carries it — but that is a substitution this plan proposes,
not one the design has made.

**7.3 What the panel shows where the main view has no subject** — the sessions
list, settings, the auth screens, and later home. An empty panel is honest; a
panel that keeps its last subject is more useful and quietly makes the reader
*stateful*, which is the property [05 §2](../05-ui-surfaces.md) says it must not
have. §3 assumes an object or a turn is always in view.

**7.4 Whether an index projection is a contract.**
[13 §5](../13-internal-contracts.md) says the index's tables are an implementation
detail, on purpose. §3 says the panel shows the rows. Either the projection is
versioned and 13 §5 gains a carve-out, or the route is documented as best-effort
and may return less after a schema bump. *And smaller, but needed first:* what
*the index rows* means concretely — the winning row, every row for the id
including shadowed and tombstoned, or the FTS row too.

**7.5 Whether a slot that collected nothing is a row. [DECIDED] at P3.0: it
is an entry in a second list, not a row among the blocks.** `omitWhenEmpty`
stays an authoring feature about the *prompt*; the record now carries the
*explanation* as `ModelCall.notFilled` — one entry per preset block that
emitted no candidate, with the reason as a class rather than prose. `included`
stays two-valued: a slot that was never assembled has nothing for a budget to
rule on. The answer is written into [02 §8](../02-data-model.md); the panel's
*why is there no lore in this prompt* is a rendering of the record.
