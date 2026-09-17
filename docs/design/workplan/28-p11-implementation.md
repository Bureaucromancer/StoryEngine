# 28 — P11 implementation plan

**Status: ~~skeleton~~ ~~a register, re-audited 2026-09-16 at `2f3f5d9`~~ a
register with a costed stage list, fleshed out 2026-09-16 at `7c5e0bd` — and
still not a plan, for the reason §0 gives rather than for want of work.** Drafted 2026-08-29 alongside
[P7](23-p7-implementation.md) through [P10](27-p10-implementation.md); to be
revisited before the phase starts.

***What the fleshing out did, in one line: every one of the stages now
names what it depends on, what it ends at, and the check that says it is done***
— twelve of them then, and thirteen since
[§0.4](#04-the-audit-run--2026-09-17-at-45c613c) took the extractor —
§1.1's rule applied to this document's **own** accumulated list, which
[§5](#5-what-only-the-revisit-can-settle) asks for in as many words and which no
sweep of the corpus was ever going to do. **Two of §1's forks closed with it**:
the assistant's (§1.5 — by P7 shipping without answering) and P11.4's *find out
which half P7 took* (**none**). **And §5's structural question has its answer
pinned**: the seam is not where that section guessed, because nine of twelve
stages depend on nothing and only P11.8 and P11.9 depend on the phase.

***What the re-audit before it found, in one line: six of §0.1's nineteen rows are
built,
the instrument that found the sharpest of them has been joined by a second one,
and the only new unowned row is the one component a shipped phase deliberately
cut.*** [P7B](24-p7b-presets-and-prompts.md), [P8](25-p8-implementation.md) and
[P9](26-p9-implementation.md) all merged between 2026-09-15 and 2026-09-16 — so
for the first time this document has been re-read against three phases that
happened rather than three that were planned. **§0.2 is that re-run.** Its
headline is [P8](25-p8-implementation.md)'s **automatic extractor**, cut
deliberately on that phase's own named fallback and landing in a corpus where
neither later phase mentions it — row 14's shape exactly, and worse in one
respect: two of P8's three gate criticals travel with it, so an unowned
extractor is two gate rows nobody can ever walk. [P7 §0](23-p7-implementation.md) says what a
skeleton this far out is for, and this is the furthest one — so it is the most a
*register of deferrals* and the least a plan. Format follows
[P1](07-p1-implementation.md); citation convention as
[P4](16-p4-implementation.md)'s.

**P11 delivers**, from [work plan P11](01-work-plan.md): everything the 1.0 spec commits
to that the phases above did not absorb — the assistant,
editors-are-not-dumb-forms across every editor, the reading view
([10 §12](../10-ui-surfaces.md)), impersonation in Scene
([06 §3.1](../06-modes-and-turn-pipeline.md)), the plot-hook selector's *tuning*,
the in-app update check, the localisation catalogue extraction sweep
([work plan §0.4](01-work-plan.md)), trash retention and restore, the systematic
accessibility audit, and **packaging as all six artifacts**.

**Plus three things [work plan §0.5](01-work-plan.md) moved into 1.0 after this document
was first written**: session export ([25 B12](../25-open-questions.md)), backup
and restore with its CI restore test ([25 E6](../25-open-questions.md),
[testing](03-testing.md)), and the four packaging artifacts that used to sit at a
"1.0 bar" nothing owned. §1.8 covers what that does to this phase's size, which
is the honest question.

**The demo that defines done:** *a two-hundred-turn story read end to end as
prose and exported as Markdown with no machinery visible — from a fresh
container built reproducibly from a tag, running in French.* Two halves that
have nothing to do with each other, which is honest about what this phase is.

**What "beta" means, and why this phase is where it gets defined rather than
assumed.** [releases §0](04-repo-and-releases.md) defines beta as **feature
complete to the 1.0 spec** — a completeness gate, checkable against the design
documents rather than negotiable — *and* names release engineering as the other
half of the same bar. [work plan §8](01-work-plan.md) sketches that half and says
explicitly that it **awaits expansion and should be rewritten rather than
extended**. This phase does the rewriting. A hardening phase that does not know
what it is hardening toward ends when someone gets tired.

**CI this phase establishes:** the thin Playwright tier
([testing §3.5](03-testing.md)) — first-run setup, create an actor, import a
card, start a session, take a turn, branch, open the workbench — against the
fake provider, so it is deterministic and free; and the release pipeline itself
as a check, since a build chain that is not run on every merge is a build chain
that is broken on the day it matters.

---

## 0. What this document is, and why it is the odd one

[P7 §0](23-p7-implementation.md) states the shared answer for a skeleton written
far ahead of its phase. This one differs in a way worth naming, because it
changes what "fleshing it out" can even mean here:

**P11 is a plan for producing a plan.** Its first stage is an audit
(§1.2, P11.0) whose output *is* the phase's list. Every other document here can
be filled in by deciding things; this one cannot, because the largest input —
what four phases of building and one release bar actually left undone — will not
exist until the day. §1.8 says the same thing from the other end when it warns
against absorbing the growth quietly and calls a split *a finding rather than a
failure*.

So the useful work here, now, is **narrowing what the audit will have to
discover** — every item pinned in advance is one the audit does not have to
find, and one that cannot be quietly dropped for being unwritten.

*Audited 2026-08-31, and two items narrowed:*

- **The i18n sweep is measurably still mechanical** (§1.3, re-measured there).
  Both lint rules are green across P3's workbench and P4's import review, and
  the catalogue that grew is open-keyed label maps rather than assembled
  sentences. P4's `note-labels.test.ts` is a working model of what the sweep
  should leave behind.
- **The trash half of §2's P11.7 has a producer already.** P4.4 shipped delete
  from the client, and the folder moves to trash rather than being erased
  ([03 §10.2](../03-data-model.md)). So *retention and restore* is a smaller
  item than it reads: the write path exists and the retention window exists;
  what is missing is the surface that shows somebody what is in there.
- **"Editors are not dumb forms, across every editor" is currently one editor.**
  `ActorEditorPage` is the only one in the tree. Whether that clause is large or
  trivial depends entirely on how many editors P5 through P9 add, which is
  unknowable here and is precisely what P11.0's audit is for. ***Answered
  2026-09-14, and not the way the bullet expected: P5 added one, P6 through P9
  add none, and four of the six library kinds have no editor at all. **So the
  clause is large, and it is large in the way that matters least to this stage**:
  what was missing was editors to sweep, not sweeping. [P7B](24-p7b-presets-and-prompts.md)
  builds all four — two from its own 2026-09-11 finding and two from §0.1's —
  and this stage sweeps six.***

### 0.1 The audit, run early — 2026-09-14

***§1.2 says the list does not exist anywhere. It does now, and this is it.***

A sweep over the design corpus and the code, prompted by noticing that no phase
schedules editors for four of the six library kinds and asking whether that was
the only one of its shape. **It was not. There are seventeen.** The pass was run
three ways and the three overlapped enough to correct each other twice — two
items graded unowned on the first pass turned out to have owners, and both
corrections are recorded in the negative half below, because a register that
only ever grows is a register nobody trusts.

***This is the second early run, and the first one is why that matters.***
[P11.0](#p110--the-audit-that-makes-the-list)'s paragraph below records a sweep
of 2026-09-11 that read [10](../10-ui-surfaces.md) forward against every phase
document and placed eleven surfaces. **This one read the code backward against
the design notes**, and the two halves barely overlap: the first found surfaces
the design specifies and nothing builds, the second found capabilities the
server built and nothing reaches. Each found items the other passed over — and
each corrected the other, which is recorded in the rows rather than smoothed
away. *Two passes, three days apart, neither redundant* is the strongest thing
this section has to say about whether P11.0 is worth being a stage.

**Neither discharges that stage.** What they do is exactly what §0 says the
useful work here is — *narrowing what the audit will have to discover* — and
between them they narrow it a long way. What P11.0 still owes is the re-count,
§1.3's violation re-measurement, a check that both sweeps' placements held, and
whatever P8 through P10 add to the pile between now and then.

**Row format is §1.1's rule, applied as the list was built rather than after.**
Every row names its artifact and its check, or says why it cannot — and the rows
that cannot are the finding, not an omission.

| # | The commitment, and where it is committed | What is built | The artifact, and the check | Routed to |
|---|---|---|---|---|
| 1 | **Editors for presets, treatments, setups and packages** — [10 §5](../10-ui-surfaces.md), [10 §11](../10-ui-surfaces.md) | Two of six. `EDITOR_ROUTES` and `NEW_ROUTES` carry `actors` and `lorebooks`; `fields.test.ts` asserts the four negatives deliberately | Four routes over the schema-derived field description. **Check:** every kind answers `kindHasEditor`, and a preset written in the browser positions an outlet | **[P7B.1, P7B.3 and P7B.6](24-p7b-presets-and-prompts.md)** |
| 2 | **Session delete in the UI** — [03 §10.2](../03-data-model.md), [R9](22-walkthrough-refinements.md) | `DELETE /api/sessions/:id` since P2.3. **No `deleteSession` in `packages/client` at all** | The control and its wrapper. **Check:** a session deleted from the browser is in trash, not erased | **[P7B.2](24-p7b-presets-and-prompts.md)** |
| 3 | **Session archive in the UI** — [03 §10.3](../03-data-model.md), and [P2C brief](13-p2c-brief.md) already says it is not in the phase document's list | `archivedAt`, `setArchived`, `PATCH { archived }` and `?archived=true`. **And the client already sends that PATCH** — with `{ name }` | One field on a call the client makes, plus the list affordance. **Check:** archived sessions leave the default list and stay reachable | **[P7B.2](24-p7b-presets-and-prompts.md)** |
| 4 | **The workbench on a turn the head has passed** — [10 §3](../10-ui-surfaces.md)'s *current or historical*; [F-05](21-playable-log.md), graded [R1](22-walkthrough-refinements.md) | `useTurn` exists with one component calling it twice. **The reader is built and the affordance is not** | The selection. **Check:** a past turn's blocks, calls and verdicts render, and the panel says which turn it is showing | **[P7B.7](24-p7b-presets-and-prompts.md)** |
| 5 | **The import quarantine's listing** — the ladder's only surface; [P2 manual gate §3.5](11-p2-manual-gate.md): *"No client code calls it"* | `GET /api/library/errors`, zero client callers | The listing. **Check:** somebody who imported a folder can see what went to `compat` and why | **[P7B.8](24-p7b-presets-and-prompts.md)** |
| 6 | **Full-text search across your own story** — [10 §14](../10-ui-surfaces.md), *"argued for 1.0"*; `README.md` already promises it to a reader | `GET /api/search` returns objects and turns; zero client callers. [P5 §3](17-p5-implementation.md) calls the absence *"settled rather than deferred"* | The surface — §14.5's index exists. **Check:** the sentence `README.md` prints is true from the browser. *Carries P5's unfixed owner-filter defect* | **P11.1**, decided 2026-09-14 — it and the reading view are read-surfaces over the same data and share a print story, which beats *shipped route with no caller* as a grouping. *P5's unfixed owner-filter defect travels with it* |
| 7 | **Session export** — [work plan §0.5](01-work-plan.md), [25 B12](../25-open-questions.md), [13 §13](../13-write-mode.md), [18 §3](../18-session-import.md) | Nothing. §1.8 argues it here at length | The format and its writer, with §1.8's four consequences. **Check:** a session exported and loaded on another install | **P11.10 — a stage this document did not have** |
| 8 | **Backup and restore** — [work plan §0.5](01-work-plan.md), [25 E6](../25-open-questions.md) | Nothing | Quiesce, archive excluding the index, restore and rebuild. **Check:** the CI restore test, which is [testing](03-testing.md)'s | **P11.11 — likewise** |
| 9 | **Home, the arrival surface** — [10 §2.2](../10-ui-surfaces.md) | `/` is a redirect and the wordmark points at the library, both under comments describing a future | The page. **Check:** arrival is not the library's job | **Prototype at [P7B.9](24-p7b-presets-and-prompts.md)**; the full version deferred by direction — see below |
| 10 | **A visible size indicator on embedded media** — `[OPEN]` at [03 §5.2.2](../03-data-model.md), carried into [04 §11](../04-schemas.md) | Nothing. PNG embedding ships at 1.0, so the failure is reachable | An indicator in the editor. **Check:** a card approaching an unshareable size says so before share time | **Deferred by direction, with its condition named** — see below |
| 11 | **Extension installation, and therefore the panel** — [P10 §1.5](27-p10-implementation.md): *"no document owns acquiring and enabling an extension on an install"* | The boundary (P7) and the manifest and lifecycle ([22 §6–§7](../22-extensions.md)). No `packages/server/src/extensions/`. [P2A](09-p2a-configuration-surface.md): `enableExtensions` *"appear in no phase list at all"* | Acquire and enable. **Check:** an extension installed by somebody who is not the developer runs | **P10's own fork**, at its revisit — P10.3's cell is explicitly *the panel or its named deferral* |
| 12 | **Openings, and seed → expand → edit → accept → promote** — [03 §6](../03-data-model.md); **PORT** in [triage](02-triage.md); [25 B9](../25-open-questions.md) resolved it and attached no phase | The schema field only. **`fromSeedId` has shipped since P1 with no writer anywhere** | The opening picker and the expand loop. **Check:** a session begins from a written opening and from an expanded seed, and the expansion promotes back with `fromSeedId` set | **[P7B](24-p7b-presets-and-prompts.md) candidate** (§1.5 there), held on the expand loop's cost |
| 13 | **`.sepack` import and export** — [03 §7](../03-data-model.md): *"how objects travel"*; **PORT** in [triage](02-triage.md) | A folder-shape comment. [P4](16-p4-implementation.md)'s *"P11-ish"* is the corpus's only assignment, and this document contains `.sepack` zero times | The bundle format, writer and reader. **Check:** a package moves between installs | **Beside P11.10**, since both freeze a format — and it is P7B.0's fourth kind's missing half |
| 14 | **The rendition count judgement, and both pacing dials** — [06 §10.4](../06-modes-and-turn-pipeline.md), [06 §10.6](../06-modes-and-turn-pipeline.md) | P9 builds one image per turn and says it *"does not build"* the judgement; *"neither pacing dial is P9's"*. P10 and P11 are the only later phases and both are silent | The judgement and two dials. **Check:** a turn with no moment worth an image gets none, and a session at a low cadence explains its own quiet | **No phase.** *Narrowed:* the storyboard surface is on the feature list ([24 §3.3](../24-roadmap.md)), so only these are unowned 1.0 items |
| 15 | **[10 §9](../10-ui-surfaces.md)'s live turn view** — specified nearly verbatim, *"a collapsed line while things go well"* | P3.5 built it inside the workbench panel only | The line outside the panel. **Check:** somebody who never opens the workbench can see a turn is running | **Unowned; a [P7B](24-p7b-presets-and-prompts.md) candidate**, held with 16 and [polish §11](06-polish.md) because the three are one story |
| 16 | **[R4](22-walkthrough-refinements.md) — where the reader's view sits while a turn streams** — [manual testing §10](05-manual-testing.md)'s *"largest genuine blank in the corpus"* | Nothing | **A paragraph in [10](../10-ui-surfaces.md), first.** **Check:** none nameable until that paragraph exists | **Unowned, and the one row §1.1's rule cannot grade** — an item with no specification has no artifact to name |
| 17 | **The first-party system library's content** — [25 A2e](../25-open-questions.md): *"a full system library ships alongside"* | The mechanism — `SYSTEM_OWNER`, `system/library/`, read-only, loaded for everyone | Content. **Check:** a fresh install has something in it | **Not a hardening item and not code.** Here as content, or explicitly nothing — but not silently nothing |
| 18 | **A session's model override has no control** — [19 §5.1](../19-tech-stack.md): *"anyone who wants their own key overrides a role without the admin's involvement"* | Everything but the surface. [P7.3](23-p7-implementation.md) built `PUT /sessions/:id/roles`, the resolution layer and the tests, and named where the control goes — *"beside the lore panel's disclosure"* | The panel: the account's usable connections, the role vocabulary, and the step layer under it. **Check:** a session's turn resolves through an override a person set in the browser | **Unowned, and a P11 candidate.** Added 2026-09-14 by [P7B §1.12](24-p7b-presets-and-prompts.md)'s route-caller check, which is the third instrument this section has run |
| 20 | **[P8](25-p8-implementation.md)'s automatic extractor** — [08 §2](../08-cross-session-memory.md), and [P8 §5](25-p8-implementation.md)'s named fallback cut | The chain, the books, **manual capture** and the toggles. The extractor itself: nothing. `LoreEntry.locked` has a **writer** and no reader | The extraction step, and the two gate rows that travel with it. **Check:** [P8](25-p8-implementation.md)'s C2 — *a hand correction survives the next extraction* — stops being vacuous | **No phase.** Added 2026-09-16 by §0.2's re-run. P10 and P11 are the only later phases and the word appears in **neither** |
| 19 | **A named node can be created and never renamed or removed** — [07 §6](../07-branching.md): *promoting a swipe is creating a `BranchRef`*, and *deleting one later deletes a name* | Two of three verbs. `POST /sessions/:id/refs` has a control on the play page; `PATCH` and `DELETE …/refs/:refId` have none | The list the names live in — [P6 §1.2](18-p6-implementation.md)'s history strip, not the post-1.0 tree visualiser. **Check:** a name given by mistake can be corrected, and one no longer wanted removed | **Unowned, and a P11 candidate.** Same check, same day. *A create with no undo is not what the visualiser's deferral was about* |

~~**Seventeen, and the count is the point**~~ ~~***Nineteen since 2026-09-14, and
the way the last two arrived is the point***~~ ***Twenty since 2026-09-16, and
six of them are built*** — P11.0's *Ends at* asks for a
count so the phase's size is known before it starts. **Six went to
[P7B](24-p7b-presets-and-prompts.md)** (rows 1–5, and row 9's prototype) **and
all six shipped**, which §0.2 records against an instrument rather than against a
reading; **three become work here** — P11.10, P11.11 and search joining P11.1;
**two are deferred by direction** (row 9's full version, row 10); **one is P10's
fork** to settle; **one more was built in P7B's own sweep** (the admin password
reset, which is not a row here because it was found and answered on the same day,
and [P7B §1.12](24-p7b-presets-and-prompts.md) records it); and **eight are still
unowned**, of which one (row 16) cannot be owned until somebody writes a
paragraph.

***The twentieth arrived the way the fourteenth did, which is the pattern worth
naming rather than the row.*** Row 14 was a phase saying *this is not mine* into
a corpus with no later owner; row 20 is the same sentence from a phase that had
already shipped. **Both are deliberate cuts made well**, with the argument
written down at the moment of cutting — and both landed nowhere, because a
deferral names what it is *not* doing and a schedule is somebody else's edit.
[manual testing §10.1](05-manual-testing.md) is a whole section about this shape;
what §0.1 and §0.2 add is that it happens to phases that are being careful.

***Rows 18 and 19 were found by a test, which is new.*** Both earlier passes
were a person reading; this one was
[`route-callers.test.ts`](../../../packages/server/src/routes/route-callers.test.ts)
walking Fastify's route table against the client's source, written at
[P7B.5](24-p7b-presets-and-prompts.md) as that phase's gate row 17. It found
four routes with no caller in the time it takes to run a test file, two days
after a careful manual sweep over the same code found none of them. **That is
the argument for the instrument, and it is also the argument for P11.0 keeping
its budget**: the check can only find a capability that shipped as a *route*,
and rows 14 through 17 above are things no route walk will ever notice.

***And this is the second sweep, not the first.*** [P7B](24-p7b-presets-and-prompts.md)
was created on 2026-09-11 out of a pass over [10](../10-ui-surfaces.md) against
every phase document, which placed eleven surfaces and is recorded at
[P11.0](#p110--the-audit-that-makes-the-list) below. **The two passes found
partly different things and read each other's misses**, which is the strongest
argument in this section for running the audit more than once: the first swept
the design note forward into the phases, the second swept the *code* backward
into the design notes, and neither would have found the other's half.

#### What §1.1's rule did to the list

**Five of the seventeen are ejected from this phase by its own rule.** Search,
openings, `.sepack`, home and extension installation name an artifact easily
enough, but they are features rather than hardening: each is a surface that does
not exist, not a surface that is not finished. The rule says such an item *"goes
to the roadmap or to a phase"* — and **P11 is the last phase**, so that clause
had no destination. [P7B](24-p7b-presets-and-prompts.md) is where two of them go —
home's prototype and, with rows 1–5, the editors — while **search is the one
this rule ejects and P11 keeps anyway**, because P11.1 is not a hardening stage
either: the reading view is a feature too, and the two belong together. §1.8
called this outcome *"a finding rather than a failure"* before the audit ran,
which is the sentence this section is the
evidence for.

*The editors (row 1) would have been a sixth*, and are the reason the sweep was
run at all: [P7](23-p7-implementation.md) sized the gap, observed that the only
place it had ever been routed was §2's editor sweep — **which improves editors
that exist and creates none** — and asked for it to be *"sized rather than
absorbed."*

#### The two deferrals, recorded in the terms given

**Neither is translated into a schedule, because the terms are the point.**

- **Home's full version (row 9)** — *explicitly not core-alpha work; still
  nominally a 1.0 feature, expected immediately before the cut-over to
  feature-complete beta, and possible to be shoved out further.* Carried in
  [polish §5](06-polish.md), where the item has always lived. **That placement
  is itself a repair**: [manual testing §10](05-manual-testing.md) files the
  whole polish file as *"unscheduled by design"*, so until now home had a home
  that was not one.
- **The media size indicator (row 10)** — *the requirement is an indicator, not
  a cap*, which is a distinction the `[OPEN]` conflates and which both design
  notes are corrected to draw. Deferred while the audience is the developer and
  people treating this as a dev project — **a condition rather than a date, and
  therefore checkable: it expires when the audience does.**

#### The negative half, which is what makes the rest trustworthy

Checked and found **owned or correctly out**, so that nobody re-finds them: the
tag registry and its management surface (built); [06 §4.2](../06-modes-and-turn-pipeline.md)'s
channel error surface (built); the per-book retrieval knobs (P7.14); trash
retention (§2's P11.7); the update check (P11.6); the assistant (P11.3); the
reading view (P11.1); impersonation (P11.4); the four remaining packaging
artifacts (P11.9); [10 §15.3](../10-ui-surfaces.md)'s system-library bullet,
which [P10 §1.8](27-p10-implementation.md) adopts into P10.3; and
`ChannelDefinition.migrate`, deferred with an argument and with no consumer yet.
Correctly post-1.0: Messages, the branch visualiser, the file browser, the
Character Studio, World and Write.

**Two of those the first pass had graded unowned and the second corrected** —
the system-library bullet and impersonation. Recording that is not humility, it
is the reason to believe the other fifteen: *a sweep that only ever adds rows is
a sweep that is not checking itself.*

#### And the check the sweep produced, which is bigger than any row

**Nothing in the suite asserts that a shipped route has a caller.** Rows 2
through 6 are five routes whose only callers are their own tests, green in CI
the whole time, for up to six phases. That is not a judgement call — it is a
mechanical property with a mechanical check, and it is filed at
[manual testing §9](05-manual-testing.md) and again as
[P7B](24-p7b-presets-and-prompts.md)'s one gate item that is not a stage.

### 0.2 Re-audited 2026-09-16 at `2f3f5d9`, after P7B, P8 and P9

***The first re-run against phases that happened rather than phases that were
planned.*** §0.1 was built on 2026-09-14, when [P7B](24-p7b-presets-and-prompts.md)
was three days old and [P8](25-p8-implementation.md) and
[P9](26-p9-implementation.md) were documents. All three have since built and
merged — `e7d6dee`, `4a6e377`, `f51ad46` — so the register can be checked against
a tree rather than against a schedule for the first time since it was written.

**What it did not do is discharge P11.0**, and the shape of the pass says why.
Almost all of it was **mechanical** — an OWED map counted, a tier table read, a
`grep -c`, a lint run — which is what a re-run of a register should mostly be,
and which is why the six discharges below are stated as a count rather than as a
reading. *The one row it added was not.* Row 20 came from reading a shipped
phase's own fallback cut against the two phases that come after it, and **no
instrument in this repository can see it**: an extractor that was never built
exposes no route and no setting.

**So the split §0.1 named holds, with a second worked example on each side.**
Instruments find what shipped and is unreachable — and there are **two** of them
now rather than one. Reading finds what never shipped and is nobody's. P11.0 is
the second thing, done systematically.

#### What the three phases discharged — six rows, and the count is mechanical

Rows **1, 2, 3, 4, 5 and 9's prototype** are built.

- **Row 1 is the one that changes another section.** `EDITOR_ROUTES` now covers
  the whole of `LibraryKind`, and `library/fields.test.ts` stopped counting an
  absence down: *"counting down an absence is not maintenance, it is a test being
  kept alive past the thing it was about"*, so the assertion runs over the whole
  key set and says the positive — **every kind has an editor, at its own
  address**. P11.2's *across every editor becomes six rather than two* was a
  projection when it was written and is now a fact about the tree.
- **Rows 2 and 3** (session delete and archive in the UI) landed at
  [P7B.2](24-p7b-presets-and-prompts.md), **row 4** (the workbench on a turn the
  head has passed) at [P7B.7](24-p7b-presets-and-prompts.md), **row 5** (the
  import quarantine's listing) at [P7B.8](24-p7b-presets-and-prompts.md), and
  **row 9's prototype** at [P7B.9](24-p7b-presets-and-prompts.md) — `HomePage.tsx`
  and the changelog rendered as a document rather than dumped into a `<pre>`.

***And the check is a count rather than a claim.***
[`route-callers.test.ts`](../../../packages/server/src/routes/route-callers.test.ts)'s
**OWED map held seven entries and now holds four** — and the four are §0.1's rows
6, 18 and 19 *exactly*: `GET /api/search`, `PUT /api/sessions/:p/roles`, and
`PATCH` and `DELETE` on `…/refs/:refId`. Nothing had to be re-read to establish
that. **A register that can be checked by running a test file is a register that
survives the person who wrote it**, which is the argument §0.1 made for the
instrument and is the first evidence for it.

#### The one new unowned row, and it carries two gate criticals

**Row 20 — [P8](25-p8-implementation.md)'s automatic extractor.**

P8 shipped on [§5](25-p8-implementation.md)'s named fallback cut: the chain, the
books, manual capture and the toggles, **with the extractor deferred**. That cut
was made well and for a stated reason — *"the one component whose value nobody
can currently evidence and whose failure mode §1.5 calls unforgivable"* — and it
was named in advance *"so that cutting under pressure cuts the right thing"*.

**What it was not is scheduled.** `grep -c extractor` over
[P10](27-p10-implementation.md) returns **0**, and over this document it returned
**0** until this section. They are the only two later phases. So the corpus
currently says *when the extractor arrives* and names no arrival.

***This is worse than row 14 in one specific respect and it should not be read as
equivalent.*** Row 14's unowned judgement costs a feature nobody has. Row 20
costs a **gate**: [manual testing §6](05-manual-testing.md)'s P8 row records that
C2 (*a hand correction survives the next extraction*) is **vacuous** under the cut
and that C3's extraction half *"has no extractor to bleed"* — **both travel with
the stage**, in that row's own words. P8 is merged and open on
[sitting N](05-manual-testing.md). So two of its three criticals cannot be walked
by anybody, at any time, until some phase owns the thing they are about.

**Recorded rather than assigned**, which is §0.1's treatment of row 14 and the
same reasoning: §1.1's rule would eject an extractor as a feature rather than a
hardening item, and this document has no destination to eject it *to*. Inventing
one is what §5's closing paragraph says to resist. What the revisit owes is a
decision, and what this section owes is making the decision unavoidable.

#### Four corrections, and one of them is this phase's own citation

1. ***P11.9 is wrong about About — and the interesting part is that its evidence
   was right.*** It says the About surface is one *"that no UI document yet
   specifies"*, on the grounds that [10 §15.3](../10-ui-surfaces.md)
   *"enumerates the admin panels and About is not among them"*. **That clause is
   true and the conclusion does not follow**: About is specified in
   [10 §15.1](../10-ui-surfaces.md), the *user* half — *"About: what build this
   is — the name, the version string"* — so the search was run in the admin half
   and stopped there. And `packages/client/src/about/` already ships
   `AboutBuild.tsx` and a `BuildFooter`, because
   [P6A](19-p6a-alpha-1.md)'s embedded version had to surface somewhere. The
   About half of P11.9 is **specified and partly built**, and what is left there
   is the audience obligations rather than the page. *A negative established over
   one section of a document is a negative about that section*, which is the
   general form of this one.
2. ***P11.10's hard dependency is a re-read, not a design session.***
   §1.8 and §5 both say the stage **blocks** if [13 §4](../13-write-mode.md) is
   unsettled. §4 is written through §4.8, states its decision as a rule — *"A call
   is a turn. An edit is a version. Apply is an edit."* — and §4.8 says in as many
   words that ***"§4 is settled before export's format is frozen, not after"***
   and that *"everything here is still free today — nothing has shipped."* The one
   `[OPEN]` inside it is §4.5's *whether several sessions per manuscript should be
   allowed*, which carries a lean, rests on a stated non-goal, and **does not
   touch the turn record's shape**. The dependency is real and it is an afternoon.
3. ***P11.10 gained a second record to freeze, named and dated.***
   [P9 §1.1](26-p9-implementation.md) decided `Rendition` is **internal tier** and
   graduates *when the turn record does* — on `turn.ts`'s own sentence, *"session
   export ([25 B12](../25-open-questions.md)) is the event that ends this
   freedom"*. So the format this stage freezes is the turn record **and** the
   rendition record, [21 §7](../21-internal-contracts.md) is where the second one
   is written, and §1.8's four consequences apply to both.
4. ***A miscitation [P9](26-p9-implementation.md) introduced, found by reading its
   own citation.*** P9.4 wrote *"[25 E4]'s budget is where this is properly
   answered"* about the tokens a hand-pressed illustration spends outside any
   turn's tape. **[25 E4] is session import from other platforms.** There is no
   budget question in [25](../25-open-questions.md) at all; aggregate spend
   tracking is **post-1.0** per [24 §3](../24-roadmap.md), which is what
   [10 §3](../10-ui-surfaces.md) and `CostSummary`'s docstring both already say.
   Corrected in both places on the day this section was written.

#### §1.3's measurement, re-run — the discipline held and the catalogue tripled

§1.3 asks for one number as *"the cheapest possible early warning"*: if real
violations have grown from two toward twenty, the discipline eroded.

**They have not, and the reason is stronger than a count.** Both selectors are
*enforced* — `restrictedSyntax({ userFacing: true })` fails the build on a
sentence joined with `+` and on a sentence split across JSX children — so the
violation count is **zero by construction**, and `pnpm lint` is green over a tree
that has since gained P7B's four editors, P8's memory panel and P9's rendition
surfaces. The warning §1.3 wanted is now a build failure, which is better than a
measurement.

***What grew is the catalogue, exactly as §1.3 predicted, and the number is the
sweep's size.*** Roughly **ten** open-keyed label maps on 2026-08-31; **thirty-one
across twenty-one files** today. Every one is still a class-to-word lookup with
the English on the client and `{ key, params }` on the wire — the shape
extraction wants — so P11.8 is still *moving maps into a catalogue* rather than
*finding sentences in server code*.

**One number in that measurement is less comfortable.** §1.3 calls
`note-labels.test.ts` *"the model for what this sweep should leave behind"* — a
build-time check that the class set and the word set agree. **It is applied once,
in thirty-one places.** That is not a violation of anything and nothing has
regressed; it is the observation that the model exists, is cheap, and has not
propagated, and P11.8 is the stage that either propagates it or says why not.

#### And a second instrument, already in the tree

`config.ts`'s `CONFIG_TIERS` marks four keys **`'unread'`** — a tier that means
*this setting exists and nothing consumes it*:

| Key | Whose |
|---|---|
| `trash.retentionDays` | **P11.7.** `config.ts` says it outright: *"the maturation sweep does not read it; trash retention is not implemented"* |
| `updates.checkEnabled` | **P11.6** |
| `updates.channel` | **P11.6** |
| `limits.extensionStorageQuotaMb` | **P10's extension fork** (§0.1 row 11) |

***This is [§3](#3-verification--the-p11-exit-gate)'s standing line with a
mechanical reading.*** [work plan §2.3](01-work-plan.md) says no phase exits with
configuration that has no surface, and §3 escalates that to a completeness claim
because there is no later phase to defer to. `config.test.ts` already fails when
a key is missing from the tier table, so **the set of unsurfaced settings is
enumerable by reading one table** rather than by a person going looking.

**It finds a different shape from the route walk, which is why it is worth having
both.** `route-callers.test.ts` finds capabilities that shipped as **routes** and
nothing calls; this finds capabilities that shipped as **settings** and nothing
reads. Between them they cover the two forms a shipped-but-unreachable
commitment takes — and neither would have found rows 14, 16 or 20, which is the
same limit §0.1 named for the first instrument and which keeps P11.0 a stage.

#### What this section deliberately does not do

- **It does not discharge P11.0.** Two instruments and a re-read are not a
  systematic pass over the design corpus, and the rows they cannot reach are the
  ones that matter most.
- **It does not re-place a routed row.** Rows 6, 7, 8, 13 and 14 keep their
  placements; what changed under them is recorded above and nothing moved.
- **It does not assign row 20.** Naming an owner for a deferral this document
  does not own would be the failure §5 closes on — a hardening phase absorbing
  work because it was the last one standing.

---

### 0.3 Re-audited 2026-09-17 at `f0b19ba`, after P10

***The second re-run against a phase that happened, and the first one where an
instrument closed a row rather than counting one.*** §0.2 ran against three
phases that had shipped since the register was written; this runs against
[P10](27-p10-implementation.md), which is the phase this register spent more rows
routing to than any other — row 11 was **P10's own fork to settle**, and rows 6,
18 and 19 are the whole of the OWED map it inherited.

#### The instruments, and one of them is now evidence for itself

**`route-callers.test.ts`'s OWED map holds four**, and they are §0.2's four
*exactly*: `GET /api/search`, `PUT /api/sessions/:p/roles`, and `PATCH` and
`DELETE` on `…/refs/:refId` — rows 6, 18 and 19, unmoved.

***What is worth recording is that it did not hold four the whole time.*** P10
served **seven** new addresses — the three notification routes at
[P10.1](27-p10-implementation.md), and two gallery and two avatar routes at
[P10.4](27-p10-implementation.md) — and **not one of them is owed now**. The
notification three were written into OWED as they were built, with `P10.2` named
beside them, and left it one stage later when P10.2 built the channels; the
gallery and avatar four never entered it at all, because their surface shipped in
the same stage as the routes. **That is the shortest a debt has ever been
outstanding in that map, and it is the first time the map has been used the way
it was designed to be used** — as a place to write down a promise *while making
it*, rather than as a place a later sweep discovers one.

**`CONFIG_TIERS`'s `'unread'` count is two**, down from four. `updates.checkEnabled`
and `updates.channel` are `applied`; `limits.extensionStorageQuotaMb` stays
`'unread'` **deliberately**, beside a roadmap row, and `trash.retentionDays` is
[P11.7](#p117--trash-retention-and-restore-and-the-accessibility-audit)'s.
*Two of the four keys this table was counting were paid by a phase deciding to
take a stage it had leaned toward, which is exactly the use §0.2 predicted for
it*: the count is what made the lean an argument rather than a preference.

#### Row 11 is discharged, and it is the first row closed by a decision

**Extension installation** — the row this register routed to *"P10's own fork, at
its revisit"* — is closed, and **not by being built**.
[P10.3](27-p10-implementation.md) took the deferral arm on a distinction four
audits had passed over: ***1.0 needs extensions **loaded**, not **installed***.
The first-party reference extension the [work plan](01-work-plan.md) keeps at 1.0
([24 §4.4](../24-roadmap.md)) ships inside the image the way a built-in mode
does, so it needs no acquiring step at all; *acquiring one from outside* is a
subsystem — fetch, verify, unpack, register, quota — that no 1.0 goal requires.
It is now a row in [24 §3.2](../24-roadmap.md) rather than an owner-shaped hole,
and the three artefacts that presuppose it all stay, visibly inert.

***That is the first row in this register to close by somebody deciding***, and
it is worth separating from the six that closed by being built. §1.1's whole
argument is that *"a list without owners never ends"* — and a list where the only
way off is construction is a list that ends by the work being done, which is a
weaker claim than it sounds. **A row that leaves because a phase read it and said
*not at 1.0, and here is where it lives instead* is the register working at its
cheapest.**

#### One stage shrank to exactly its named remainder

**[P11.6](#p116--update-check-about-badge-and-better-failures) is now the error
messages alone**, which is the arm its own *Depends on* named: *"if P10 takes the
check, this stage is the error messages alone."* P10 took the check, the About
badge and the conditionality — including a distinction §1.6 did not have to draw
and this document should now carry: ***a failed check is two things and only one
is about the network.*** Nothing answering is a connectivity signal; **an HTTP
answer this build cannot use proves the internet works**. That is not
hypothetical — the repository is private and
[releases §4](04-repo-and-releases.md) says `latest` names nothing until a
release is cut, so the default channel's feed answers 404, and a check that
conflated the two would tell every alpha operator their server was offline.

*This is the first conditional stage in this document to resolve*, and it
resolved to the smaller arm, which is what a *Depends on* line is for.

**One correction came with the resolution.** [P10.3](27-p10-implementation.md)
names the half it did not build — *an engine that says "this server appears to
have no internet access" instead of surfacing a raw connection error*, which
belongs in `turns/calls.ts` where a provider failure becomes a
`StepFailureReason` — and owed it to **P11.3**, which is *the assistant*. The
routing was right and the number was wrong; it is struck and corrected there, and
it lands here. *Worth noting because it is the failure mode a cross-reference has
and prose does not*: the sentence describing the debt was accurate enough that
four readings of it never checked the number beside it.

#### The new row, and it arrived by being unblocked rather than by being found

| # | The commitment, and where it is committed | What is built | The artifact, and the check | Routed to |
|---|---|---|---|---|
| 21 | **The sign-in gallery's type-to-filter, folding the by-name link into it** — [12 §7](../12-account-gallery.md), [polish §7](06-polish.md) | The gallery, at [P10.4](27-p10-implementation.md): tiles, a drawn face for every account, and a separate *Sign in by name* button | One text affordance where there are now two — a filter over the listing the screen already fetched, where a typed handle matching no tile **is** the by-name case. **Check:** the screen has one text entry rather than a box beside a link | **Unowned.** [polish §7](06-polish.md) holds the design and says *"blocked on the gallery existing"*; **the gallery exists as of 2026-09-17** |

***The way it arrived is the point rather than the row.*** Rows 14 and 20 are
phases saying *this is not mine*; rows 18 and 19 were found by a test. **This one
was written down, correctly, with its blocker named — and the blocker cleared.**
Nothing in this repository notices that: there is no instrument that watches a
deferral's condition and says when it fires, and
[manual testing §10.1](05-manual-testing.md) is a whole section about the shape.
*It is a small row and it is here because the mechanism that would have found it
does not exist.*

#### Row 20 is unchanged, and carrying it a third time would be a decision by default

**[P8](25-p8-implementation.md)'s automatic extractor.** P10 has now shipped and
the word appears in its document **zero** times, which was the state §0.2
recorded as a prediction and is now a fact about a built phase. **P11 is the only
phase left.** This document mentions the extractor seventeen times and schedules
it in none of them — every mention is this register describing the hole.

***So the honest statement is that a third carry is a decision, and it should be
made rather than arrived at.*** Either P11 takes it, or **1.0 ships with memory
books that only a person fills** — which is a defensible product and is *not* what
[08 §2](../08-cross-session-memory.md) describes. §5's revisit is where that is
settled, and [§1.8](#18-this-phase-grew-by-three-and-the-growth-should-be-sized-rather-than-absorbed)
is where the size of taking it would land. **What this section refuses to do is
record it unowned a third time and move on**, which is exactly what
[manual testing §10.1](05-manual-testing.md) names as the failure this whole
register exists against.

---

### 0.4 The audit, run — 2026-09-17, at `45c613c`

***This is [P11.0](#p110--the-audit-that-makes-the-list)'s output rather than
another re-audit***, and the difference is what §1.2 insists on: §0.1 through
§0.3 read the *register* against the phases that shipped, and this reads the
**corpus and the tree** against each other and produces a list with a count.

**Twenty-seven items. Seven of them were already fixed by the running of it**,
because the instrument this stage built found them and they were a line each.

---

#### The two instruments, run and recorded — which is this stage's proof obligation

| Instrument | Reading | Against |
|---|---|---|
| `route-callers.test.ts`'s **OWED** | **4** — `GET /api/search`, `PUT …/roles`, `PATCH` and `DELETE` on `…/refs/:refId` | 4 at §0.2, 4 at §0.3. Rows 6, 18 and 19, unmoved since they were found |
| `route-callers.test.ts`'s **EXEMPT** | **3**, each with a written reason | Recorded here because an exemption is the other way a route goes unreached |
| `config.ts`'s **`'unread'` tier** | **2** — `limits.extensionStorageQuotaMb`, `trash.retentionDays` | 4 at §0.2, 2 at §0.3. Both survivors are owned: a roadmap row and [P11.7](#p117--trash-retention-and-restore-and-the-accessibility-audit) |

**Both are where §0.3 left them**, which is the answer this stage was owed and
not an interesting one. *The interesting reading is the third column*: neither
number has moved because neither instrument can see what this audit was for.
`OWED` watches routes and `'unread'` watches config keys, and the twenty-seven
items below are overwhelmingly **neither** — they are sentences.

#### The measurement [20 §7](../20-client-loading.md) asked for at this stage

[20 §7.1](../20-client-loading.md) fired a trigger on 2026-09-15, decided not to
bring the review forward, and said *"the review point stays P11.0, and the first
line of its baseline capture is now known."* Here is the rest of that line, from
one `pnpm build` on this tree:

| | Modules | JavaScript | gzip | CSS | gzip |
| --- | --- | --- | --- | --- | --- |
| [20 §1](../20-client-loading.md)'s baseline, at `a54afcc` | — | 676.82 kB | 199.15 kB | — | — |
| [20 §7.1](../20-client-loading.md), after `react-markdown` | 729 | 909.25 kB | 268.11 kB | 34.06 kB | 6.94 kB |
| **Here, after P10** | **748** | **951.64 kB** | **280.27 kB** | **34.90 kB** | **7.07 kB** |

**P10 cost nineteen modules and 12.16 kB gzip** — notifications, the gallery,
the restart banner, the update check and the licence block, for about a
twenty-third of what the entry already was. *That is the number §7.1 predicted
would matter more than its own*: one dependency at a sixth is loud and a phase
at a twenty-third is quiet, and the quiet one is the shape of every phase left.

***The recommendation is §7's step 5, the deferral arm, and it is a decision
rather than an omission.*** 280 kB gzip on one route is large and is not
*measured harm*: nothing in [PLAYABLE](21-playable-log.md) or any sitting
reports slow arrival, and [20 §6](../20-client-loading.md) is explicit that CI
can hold a byte total and cannot hold a timing. **What this audit therefore asks
of [P11.9](#p119--release-engineering-which-is-the-other-half-of-the-bar) is one
line in `tools/release.test.ts`'s neighbourhood: a recorded ceiling on the entry
bundle**, so the next phase that doubles it is found by failing rather than by
somebody rebuilding and remembering these three rows. *A budget nobody can
breach loudly is the same class of thing as a deferral nobody collects.*

---

#### What the new instrument found, all of it fixed in this stage

[`tools/citation-targets.test.ts`](../../../tools/citation-targets.test.ts) is
§10.1's lesson mechanised: **a citation that names a stage or a section names
one that exists.** §10.1 named two remedies for the dangling owner and both were
*somebody reading again*; this is the third, which is the machine reading
instead. Sixteen defects on its first run, across four thousand one hundred and
three stage citations and four thousand eight hundred and eighty-seven section
citations.

| # | What | Where | Fixed as |
|---|---|---|---|
| 1 | **A test whose title claimed a divergence its body never drove** — *is skipped by a rebuild and indexed by the watcher* — owing the reconciliation to `P2.7`, **a stage that was never created**, after [P6B.1](20-p6b-playable.md) had done the reconciling | `packages/server/src/routes/refused-path.test.ts` | Rewritten to the claim P6B.1 actually makes: one folder, **both** producers, the same answer, with the refusal read off the surface [P7B.8](24-p7b-presets-and-prompts.md) built for it |
| 2 | A phase number run into a section number with the `§` dropped, naming a stage of P4 that does not exist | `packages/server/src/storage/local-source.test.ts` | Rewritten to the section it meant, **described rather than quoted** — the check that found it would refuse its own account |
| 3–9 | **Seven phase status lines pointing into `05-manual-testing.md`'s old subsections** — §3.3, §3.4 ×5, §3.5 ×2 — after that file grew the two-tier gate and renumbered | P2, P2B, P3, P4, P5 ×3, P6B | Repointed at §1, §3 and §6, which are where those three things live now |
| 10–16 | Seven more dangling section citations: `[04 §3.4]`, `[02 §8]`, `[P2 §2.13]`, `[P11 §0.4]`, `[P4 §1.4]` pointing at the wrong document, `[P2C §0]` | [05](../05-tagging.md), [19](../19-tech-stack.md), [P6](18-p6-implementation.md), [18](../18-session-import.md), `ImportPanel.tsx`, `openai-compatible.live.test.ts` | Repointed |

***`[P11 §0.4]` is in that list, and it was pointing at this section before this
section existed.*** [18 §3](../18-session-import.md) cited P11's localisation
sweep as §0.4 when the sweep is §1.3, and the number happened to be the next one
free. *A citation can be wrong in a way that comes true, which is the least
useful kind of correct.*

**And one cost of the instrument, paid and worth naming**: an account of a
forbidden token cannot quote it. Item 2's comment describes the wrong form
instead, and any future account of a mistake this check catches will have to do
the same. That is the price of mechanising a convention, and it is smaller than
the convention rotting.

---

#### Five §10 rows whose premise had stopped being true

*Checked against the tree rather than re-read.*
[Manual testing §10](05-manual-testing.md) is the register of deferrals with
owners, and its own §10.1 says what happens to a row nobody re-checks. **Four of
its rows describe defects that were fixed and never came back to say so.**

| # | The row | What the tree says |
|---|---|---|
| 17 | *P2 gate step 8 / F12 — an editor-page mount rather than a component mount*, unassigned | **Closed.** `packages/client/src/editor/` carries five page-level mounts, built across [P7B.1](24-p7b-presets-and-prompts.md), [P7B.3](24-p7b-presets-and-prompts.md) and [P7B.6](24-p7b-presets-and-prompts.md) |
| 18 | *A killed process names no model call* — *the suite's one `it.todo`* | **Closed.** `routes/recovery.test.ts` asserts it by name, and **this repository has no `it.todo` at all**, so the row's own pointer had stopped existing |
| 19 | *Two clock-effect constructors disagree; `clockEffect` has no production caller* | **Closed.** The production export went at [P7.0](23-p7-implementation.md); three test-local helpers remain, which is ordinary duplication in tests and not the dead code with a disagreement in it that the row describes |
| 20 | *A turn carries no money total — `costOf()` never aggregates* | **Half true and worth re-stating.** `runner.ts` aggregates and the workbench renders it. What is absent is **money**: `TurnCost` is prompt tokens, completion tokens, wall time and model, and nothing in this repository holds a price for a model. The row should say *no price source* rather than *no aggregate*, because the two want completely different work |
| 21 | *The record cannot say a block is advisory* — residue after the P3.0 repair | **Stands.** `assemble()` carries the flag and refuses advisory content to a deciding call, and `ModelCall.purpose` is written; nothing asserts the invariant **over a committed record**. One test, and it is [P11.0](#p110--the-audit-that-makes-the-list)'s to hand on rather than to write |

***Four rows out of five, and every one of them closed by work that happened
inside this corpus.*** Nobody was careless. What the register lacks is the
*direction* this pass ran in: a row is written when a defect is found and is
re-read when somebody goes looking for work, and **nothing re-reads it when the
defect is fixed.** That is the same missing mechanism §0.3's row 21 arrived by —
a condition clearing with nothing watching — and it is now two findings from two
directions, which makes it a property of the register rather than an accident.

---

#### Six commitments with no owner, which is the list §1.2 says does not exist

| # | The commitment | Where it is committed | The artifact, and the check | Routed to |
|---|---|---|---|---|
| 22 | **Session and Turn carry no provenance at all**, and the window shuts when the record freezes | [18 §4.1](../18-session-import.md), [03 §8](../03-data-model.md) — `origin: Provenance` is specified and unimplemented, and `stampImported` does not typecheck against a session | A field on both records before export publishes them. **Check:** `stampImported` accepts a session; `emit-schemas` produces the field | **[P11.10](#p1110--session-export-and-the-format-it-freezes)**, and it is the one item here that costs more by waiting: an edit now, a migration of a frozen portable format afterwards |
| 23 | **Openings, and the seed → expand → edit → accept → promote loop** | [03 §6](../03-data-model.md), **PORT** in [triage](02-triage.md); `fromSeedId` has shipped since P1 with no writer anywhere | The loop, and a control beside the setup's other fields. **Check:** a seed expands, is edited, and the accepted text is what a session opens on | **Unowned.** [P7B §1.11](24-p7b-presets-and-prompts.md) held it *"with that cost named"* — the expand step is a model call and a new interaction, not a surface over a finished route |
| 24 | **[10 §9](../10-ui-surfaces.md)'s live turn view** — a collapsed in-flight line outside the workbench — with [R4](22-walkthrough-refinements.md) and [polish §11](06-polish.md) | [F-03](21-playable-log.md) from the pre-P6 walk; [P7B §1.11](24-p7b-presets-and-prompts.md) held all three together | One story or none: *"building one third of a scroll-and-progress story is how the other two thirds get built twice"* | **Unowned, and R4 still needs a paragraph in [10](../10-ui-surfaces.md) before it can have one** — which makes this the corpus's oldest genuine blank rather than an unscheduled item |
| 25 | **The sign-in gallery's type-to-filter** | [12 §7](../12-account-gallery.md), [polish §7](06-polish.md) | §0.3's row 21, restated: one text affordance where there are now two | **Unowned.** Its blocker cleared at [P10.4](27-p10-implementation.md) and nothing noticed |
| 26 | **`.sepack` import and export** | [P4](16-p4-implementation.md)'s *"P11-ish"*, the only assignment the corpus has ever given it; [P7B §1.9](24-p7b-presets-and-prompts.md) shipped the package editor without it | A bundle that travels. **Check:** a package exported from one install opens on another | **Routed *beside* [P11.10](#p1110--session-export-and-the-format-it-freezes) and never *into* it**, which is the distinction this audit exists to catch. §0.1 row 13 said the choice was cheaper to make at the revisit; **this is the revisit**, and §1.9 below is where it is made |
| 27 | **[P8](25-p8-implementation.md)'s automatic extractor** — §0.2's row 20, carried twice | [08 §2](../08-cross-session-memory.md) is the feature; [P8 §5](25-p8-implementation.md) cut it deliberately and named no arrival | See below. **This audit decides it rather than carrying it a third time** | **[P11.12](#p1112--the-automatic-extractor), new** |

---

#### Row 20 decided: the extractor is [P11.12](#p1112--the-automatic-extractor)

§0.3 said *"a third carry is a decision, and it should be made rather than
arrived at."* Made, and these are the grounds rather than a preference:

- **[08 §2](../08-cross-session-memory.md) is not what ships without it.** The
  design's sentence is *"entries are **extracted** from sessions"*, and what
  exists is a book a person fills by hand. A memory book nobody is obliged to
  maintain is a lorebook with a suggestive name.
- **It holds a phase's gate open, not a feature's.** [P8](25-p8-implementation.md)'s
  C2 (*a hand correction survives the next extraction*) is **vacuous** under the
  cut and C3's extraction half *"has no extractor to bleed"*, so
  [sitting N](05-manual-testing.md) is one row and **two of P8's three criticals
  cannot be walked by anybody**. Leaving it unowned does not defer a feature; it
  leaves a closed phase's gate permanently unfinishable.
- **The machinery is all here, which is why P8 could cut it safely.** The books,
  the (actor × persona) association, the two-tier retrieval budget, the
  workbench's injection report, the scope and intake toggles, the write path
  that appends a turn with no model call, and `LoreEntry.locked` **with a writer
  and no reader** — P8.3's record says outright that *"the extractor inherits an
  obligation with subjects already on disk."* What is missing is a step, a
  payload, a prompt and a dedupe rule.
- **And the alternative is defensible, which is why it needed deciding rather
  than assuming.** 1.0 could ship memory as a manual feature. It would be a
  smaller, honest product — and it is **not** the one four design documents
  describe, so choosing it would mean editing them. Nobody has proposed that.

*Appended as P11.12 rather than inserted*, on §2's own convention: stages are
cited by number across the corpus and renumbering to buy tidiness breaks live
citations. By argument it belongs with the large user-facing items.

---

#### What this stage did **not** find, which is worth one line

**No route without a caller, no config key without a consumer, and no `TODO`,
`FIXME` or `it.todo` anywhere in the tree.** The two shapes §0.2 named — a
shipped route with no surface, a shipped setting nothing reads — are both at
zero outside their written exemptions, and the third shape a sweep usually finds
is absent because this codebase does not use the marker. *That is the argument
for why the twenty-seven items above are the shape they are*: what is left after
six phases of instruments is **sentences that stopped being true**, and no
instrument in this repository could see one until this stage built the first.

---

## 1. Decisions this plan has to make

### 1.1 A hardening phase is a list, and a list without owners never ends

The rule this phase runs on, and the only thing in it that must survive the
revisit intact:

> **Every item names the artifact it completes and the check that says it is
> complete.** An item that cannot name both is not a hardening item; it is a
> feature, and it goes to the roadmap or to a phase.

[work plan §8](01-work-plan.md)'s bar plus [releases §0](04-repo-and-releases.md)'s gate
is what the list is checked against — not against a sense that things feel
finished.

### 1.2 The audit comes first, and it is not the same as the work

**P11.0 is a pass over the design documents producing the list**, ~~because the
list does not exist anywhere today~~ ***and a partial one now exists: §0.1,
2026-09-14.*** It is scattered across every phase document as *home P11*, and one
of those homings is already a warning:
[P2 §2.11](08-p2-implementation.md) says what P11 owns for accessibility is *the
audit — a systematic pass over surfaces built to the habit, not a rescue of
surfaces built without it*, and adds that **a phase that defers the habit has
already made P11's pass a rewrite.** That sentence generalises to nearly
everything in this phase, which is why the audit is a stage rather than a
morning.

***What §0.1 changes about this stage, and what it does not.*** It changes the
stage's job from *produce a list from nothing* to *complete and verify one*,
which is a different morning: seventeen items are already named, routed and
sized, so what P11.0 owes is the re-count, §1.3's violation re-measurement, and
whatever P8 through P10 add to the pile between now and then. **It does not
discharge the stage**, and the reason is in the audit's own closing section:
every one of its rows was found by reading, and the class it found — a route
whose only caller is its own test — is exactly the class reading is worst at.

***§0.2 does three of those four and narrows the stage again*** (2026-09-16). The
re-count is run, §1.3's re-measurement is run, and *what P8 and P9 added to the
pile* is answered — **one row**, and it is the extractor. What is left for P11.0
is the systematic pass itself and **whatever P10 adds**, which is the only phase
between here and the stage. *The instruments are two now rather than one*, and
§0.2's closing section says what neither of them can see — which is the same
limit, restated with a second example rather than dissolved.

### 1.3 The i18n sweep is extraction, and only the discipline made it mechanical

[work plan §0.4](01-work-plan.md) reduced the i18n obligation to three things that
cannot be retrofitted — never assemble a sentence from fragments, never branch on
displayed text, CSS logical properties and `Intl` — and moved **catalogue
extraction** here as a pre-beta sweep. The trade is explicit: *extraction over a
codebase that never concatenated is mechanical work; extraction over one that did
is a rewrite.*

[P2 §1.4](08-p2-implementation.md) narrowed [testing §2](03-testing.md)'s strings
rule to match, and recorded the count of real violations as **two** rather than
the ninety the wide rule flagged. **So the sweep's size is measurable before the
phase starts**, and re-running that count at the revisit is the cheapest possible
early warning: if it has grown from two to twenty, the discipline eroded and this
stage is a different size than planned.

Two things the sweep must do beyond extraction, both already latent:
[09 §3.4](../09-server-multiuser-deployment.md)'s notification summaries are
`{ key, params }` and the params must carry everything the sentence needs; and
[P3 §3](15-p3-implementation.md) records the key-and-params conversion of the
workbench's collector as P11 sweep debt — *a block's `reason` is free English
prose in a durable record* — with one line pointing here so P3 is not the phase
that quietly ratifies it.

*Re-measured 2026-08-31, which is the early warning this section asked for.*
**The discipline held.** Both lint rules are green across a codebase that has
since gained P3's workbench, P4's import review and P4's account settings — the
three largest additions of user-facing prose in the project so far — so the
count is still the narrow rule's zero rather than having crept back toward
ninety.

**What grew instead is the catalogue, and that is the good outcome.** The client
now holds roughly ten open-keyed label maps — `ImportPanel` alone carries **41
note classes and 7 dispositions** — and every one is a class-to-word lookup,
with the English on the client and `{ key, params }` on the wire. That is the
shape extraction wants: the sweep's job becomes moving ten maps into a
catalogue, not finding sentences hidden in server code.

**P4 is the worked example, and it was deliberate.**
[P4 §7.14](16-p4-implementation.md) records that the import review emits classes
rather than sentences *specifically* to keep this phase's debt from growing —
and P4 also shipped `note-labels.test.ts`, which fails the build when the server
emits a class the client has no sentence for, **and** when the client holds a
sentence for a class nothing emits. **That test is the model for what this sweep
should leave behind**, and the strongest available argument that the extraction
is mechanical: a build-time check that the class set and the word set agree is
most of what a catalogue is for.

*One correction to the debt list above:* P3's free-prose `reason` field is still
here and still owed. P4 did not add a second instance of it — the review's
`{ key, params, level }` was chosen against exactly that — so the debt is one
item rather than two.

***Re-measured 2026-09-16 (§0.2), across three more phases, and the warning this
section asked for has become a build failure.*** Both selectors are *enforced*
rather than counted — `restrictedSyntax({ userFacing: true })` fails the build on
a sentence joined with `+` and on one split across JSX children — so the real
violation count is **zero by construction** over a tree that has since gained
P7B's four editors, P8's memory panel and P9's rendition surfaces.

**The catalogue went from roughly ten maps to thirty-one across twenty-one
files**, which is this section's predicted good outcome and is also the sweep's
size stated in the only unit that matters. *And the one number that is less
comfortable*: `note-labels.test.ts`, which this section calls **the model for
what the sweep should leave behind**, is applied **once** in those thirty-one
places. Nothing regressed — it is the observation that a cheap model has not
propagated, and P11.8 either propagates it or says why not.

### 1.4 The reading view is cheap, which is why it is at risk

[10 §12](../10-ui-surfaces.md) calls it a 1.0 feature and a cheap one — every
input exists, it is a path through the turn tree rendered as prose, HTML with a
real print stylesheet plus Markdown and plain text, and no PDF library. Cheap
items in a hardening phase are the ones that get cut when the phase runs long,
so the argument for keeping it is worth carrying in the plan rather than
rediscovering: **readability and rollback are a pair.** Rollback is branching —
you can always go back. Readability is this — you can always see what you have.
Together they are what makes someone willing to commit two hundred turns; either
alone is noticeably less reassuring.

**And it must not drift toward the workbench.** They read the same records and
share nothing else. If the reading view starts showing costs, it has become the
thing it is the opposite of.

### 1.5 The assistant is the mode contract's third witness, arriving late

[06 §7.4](../06-modes-and-turn-pipeline.md): *it is a session, in a mode, with an
actor card — that is the whole design*, and **if building it requires a parallel
chat implementation, something in the mode contract is wrong.**
[P7 §1.8](23-p7-implementation.md) raises the consequence from the other end: 1.0
ships the more similar pair of modes, so the contract gets a weaker test than the
design assumed, and the assistant is the least similar consumer available.

**The two plans must agree at their revisits.** Either the assistant's mode
definition moves to P7 as the contract's third witness and P11 builds only its
surface and tools, or it all stays here and P11 accepts that it may find the
contract wrong after everything is built on it. What must not happen is both
documents leaving it to the other.

---

#### Resolved 2026-09-16 — by P7 closing, which is the arm this section feared

***P7 shipped without answering, so the answer is the default one.*** [P7
§1.8](23-p7-implementation.md) posed the same fork from its side — *"to decide at
the revisit: whether the assistant's mode definition is pulled into P7"* — and
P7's buildable work finished on 2026-09-13 across fifteen stages, merged at
`589900e`, with the question still in its §5. **So the assistant's mode
definition is P11's**, and it is P11's *by expiry* rather than by decision, which
is the sentence above coming true.

**P7 saw it coming and left the record in the right shape**, which is the part
worth keeping rather than scolding. Its §4 lists the assistant's mode definition
under *not out of scope but reads like it*, **specifically** so that *"leaving it
in P11 is a decision rather than an omission"*. A deferral that names itself as a
deferral is the thing this corpus keeps asking for; what neither document has is
a mechanism that makes a phase answer before it closes.

***And the worry the fork existed to manage got smaller on its own.*** §1.8's
real subject is that two similar modes are a weak test of the mode contract. P7
records the mitigation: [P9](26-p9-implementation.md)'s rendition step is a
**fourth witness volunteered by a phase that is not about modes**, which is the
variety §1.8 said the phase lacked — *"it does not answer §1.8's question…  it
does change the price of answering **no**."* **The price was paid and it was
lower than budgeted.** P9's step exercised the contract from outside and found no
fault in it; what it did find was that a mode could not be imported by the engine
and that `CastEntry` was missing a field, both of which P9 fixed inside the
contract rather than by widening it.

**What this stage therefore builds is all of it** — mode definition, surface and
tools — and P11.3 says so. *The residual risk is unchanged and is now this
phase's alone*: if the contract is wrong, P11 finds out after everything is built
on it. **That risk is why P11.3 is not last**, which §2's ordering now states.

### 1.6 The update check produces a signal P10 already ships a surface for

[P10 §1.7](27-p10-implementation.md) states this from the other side and leans to
moving the check into P10. Recorded here so the two plans do not both defer it:
**the check is small**, [09 §6.5](../09-server-multiuser-deployment.md) argues
the connectivity signal is free because the request is being made anyway, and its
best use is not the badge but **better error messages** — *"this server appears
to have no internet access"* instead of a raw DNS or TLS error, and the same
sentence at first run before someone configures a remote provider that will never
work.

Whichever phase builds it, the conditionality is the part not to lose: an install
whose connections are all local is a legitimate deployment, and telling its
operator their server is broken because it cannot reach a release feed would be
both wrong and irritating.

### 1.7 The hook tuning is not the hook build — a correction 01 already made

Both the P7 line and the P11 line have read as owning the plot-hook selector, and
two homes for one job is a scheduling argument waiting to be had.
[P7](23-p7-implementation.md) ships the mechanism. **What is left here is the
part that can only be done by playing**: what the four pacing levels resolve to,
how long a commitment should wait, how the judgement prompt is worded, and the
hook panel affordances that make a large pool authorable
([10 §10.1](../10-ui-surfaces.md)). [work plan §2.1](01-work-plan.md) lists *that hook
pacing works at all* among the hypotheses nothing has tested — every claim in
these documents is a hypothesis, and none is tested by being written down — and
this is the phase that tests this one.

### 1.8 This phase grew by three, and the growth should be sized rather than absorbed

[work plan §0.5](01-work-plan.md) moved three things into 1.0 and gave all three to this
phase. None was a scope increase for the *product* — each was already wanted —
but all three were previously outside any phase, which is a different thing from
being cheap.

**Packaging is now all six artifacts, not two.**
[releases §0](04-repo-and-releases.md) still requires only the OCI image and the
tarball *for beta to count*, and that is unchanged. What changed is that `.deb`,
AUR, Homebrew and the Windows service are owned here rather than by a "1.0 bar" —
a bar this phase had itself put out of scope, which left four required artifacts
with a requirement and no builder.

*Corrected at [P6A](19-p6a-alpha-1.md), which had to count them.* This paragraph
listed **five** names as those four, by including the unraid template
([09 §5.3](../09-server-multiuser-deployment.md)) — which is not one of the six.
[25 D0b](../25-open-questions.md)'s canonical enumeration is OCI image, tarball,
`.deb`, AUR, Windows service installer and Homebrew formula, and
[09 §5.4](../09-server-multiuser-deployment.md) calls the template *"a thin
wrapper over"* Tier 1 rather than an artifact beside it. The old sentence's
instinct was sound — the template *is* the one most likely to feel obligatory,
and a half-working one is worse than none — but the fix for that is scheduling
it with the thing it wraps, which is what P6A does.

**So this phase owns five, not six.** P6A builds the OCI image, its compose file
and the unraid template as a private artifact
([releases §0.1](04-repo-and-releases.md)); what lands here is the tarball, the
other four, and the step P6A explicitly did not take — **public distribution**,
with the AGPL §13 surface, the About page and the channels that come with having
an audience.

**Session export is the largest of the three and the one with a dependency.**
It drags `localActors`, channel state, branch structure and renditions
([25 B12](../25-open-questions.md)), and it **freezes the turn record** — which
is why [13 §4](../13-write-mode.md) has to be settled before the format is
fixed, not after. That is a design dependency on a document about a 2.0 feature,
and it is the sharpest scheduling consequence of the release re-cut. ~~If §2's
audit finds 17 unsettled when this stage arrives, the stage blocks on 17 rather
than guessing.~~

***Read on 2026-09-16 (§0.2), and it is an afternoon rather than a block.***
[13 §4](../13-write-mode.md) is written through §4.8 and states its decision as a
rule — *"A call is a turn. An edit is a version. Apply is an edit."* — and §4.8
answers this paragraph from the other side in as many words: ***"§4 is settled
before export's format is frozen, not after"***, with *"everything here is still
free today — nothing has shipped."* The one `[OPEN]` left inside it is §4.5's
*whether several sessions per manuscript should be allowed*, which carries a
lean, rests on a stated non-goal, and **does not touch the turn record's shape**.
So the stage's dependency is somebody re-reading one section and confirming it,
not a design session it can block on.

***And the freeze acquired a second record, named and dated.***
[P9 §1.1](26-p9-implementation.md) decided `Rendition` is **internal tier** and
graduates *when the turn record does* — on `turn.ts`'s own sentence, *"session
export ([25 B12](../25-open-questions.md)) is the event that ends this freedom"*.
So P11.10 freezes the turn record **and** the rendition record
([21 §7](../21-internal-contracts.md)), the four consequences below apply to
both, and P9 paid the cost of that answer in advance rather than leaving it to
this stage: the rendition's tier claim is checked by `emit-schemas` producing no
diff, so nothing has to be un-published first.

**And it has a second reader nobody in the room represents** — *added
2026-09-01, from [18 §3](../18-session-import.md).* [25 E4](../25-open-questions.md)
makes session *import* conditional on an interchange format and says the format
begins here: *"a format designed with import in mind and a format designed
without it are different documents, and only one of them can be written at
P11."* Four consequences, none of them scope added to this stage and all of them
free while the format is being written:

1. **Do not make the turn record's optional fields mandatory.** `input`,
   `output`, `request`, `cost` and `steps` are all optional today, which is
   exactly what lets a turn that never ran a model exist. Ours always have them,
   so a serialiser written against our own records would tighten this without
   anyone deciding to.
2. **Leave somewhere for a foreign identifier**, tolerating its absence. The
   three surveyed sources supply a message id, a message id, and nothing at all
   ([18 §2.1](../18-session-import.md)) — and the one with nothing is the most
   widely deployed.
3. **Export siblings, not the path.** Every read surface today walks
   `walkPath(head)`; serialising that drops every swipe, which
   [07 §3](../07-branching.md) makes the same thing as dropping every unnamed
   branch. The format would be lossy against our own data before import was
   involved.
4. **Session and Turn need a provenance field, and this is the last stage that
   can add one cheaply.** Neither carries `provenance`, `metadata` or `compat` —
   no field, not an empty one — and [04 §1](../04-schemas.md) puts them in the
   *free to move* tier **because nothing exports them**. This stage ends that.
   [03 §8](../03-data-model.md) already specifies `origin: Provenance` on
   Session and it was never implemented; adding it before the freeze is an edit,
   after it a migration of the record this project has the most of.

Only the fourth costs more by waiting, and it is the one that looks least like
this stage's business.

**Backup and restore is the smallest.** Quiesce, archive excluding the index,
restore and rebuild ([25 E6](../25-open-questions.md)). The part that matters is
the CI restore test, which belongs to [testing](03-testing.md) rather than here.

**What this means for the phase.** P11 was already the largest and least
well-specified phase in the plan, and this makes it larger. The response is not
to quietly absorb it: §2's audit stage should size these three alongside
everything else it finds, and if the answer is that P11 has to split, that is a
finding rather than a failure. A phase that ends when someone gets tired is the
failure mode this document exists to prevent.

***The audit ran early, and this section was two-thirds right*** — 2026-09-14,
§0.1. It was right that the growth should be sized rather than absorbed, and
right that a split would be a finding. **What it got wrong is that it read as
scheduling and was not.** Packaging went into §2 as P11.9. Session export and
backup and restore did not: they were argued here at length, the stage list ran
P11.0 to P11.9 without either, and §3's ten-row gate had no row for either. Every
other document in the corpus points here — [work plan §0.5](01-work-plan.md),
[25 B12](../25-open-questions.md), [25 E6](../25-open-questions.md),
[P4](16-p4-implementation.md), [P9](26-p9-implementation.md) and
[testing](03-testing.md) — so the obligation that was moved into this phase
*because it had a requirement and no builder* landed one level short of a
schedule and stayed there for a fortnight. **They are P11.10 and P11.11 now**,
appended rather than inserted because stages are cited by number across the
corpus.

*And the split arrived from a direction this paragraph did not consider.* It
anticipated P11 splitting under its own weight. What happened instead is that
§1.1's rule ejected five items as features rather than hardening, and four of
them went to a phase created in front of this one
([P7B](24-p7b-presets-and-prompts.md)) — so the relief is real and it came from the rule
rather than from the sizing.

---

### 1.9 `.sepack` is [P11.10](#p1110--session-export-and-the-format-it-freezes)'s, and the reason is that it is not a second format

***Decided 2026-09-17 by [§0.4](#04-the-audit-run--2026-09-17-at-45c613c)'s item
26***, which is the revisit [§0.1](#01-the-audit-run-early--2026-09-14)'s row 13
said the choice was cheaper at. Three arms were open — this stage, a stage of its
own, or [P7B](24-p7b-presets-and-prompts.md)'s package editor growing an export
button — and the argument that separates them is not about scheduling.

**The two things travel differently and serialise identically.** A session
carries branch structure and channel state; a package carries an arbitrary
bundle of library objects, every one of which is already a **portable kind** with
a schema, a `Provenance` and an id that `stampImported` can key. So the package
half needs no format decision at all: [04 §9](../04-schemas.md) describes the
bundle and [18](../18-session-import.md)'s sweep already reads exactly those
objects. *What P11.10 is actually deciding is the hard part — how a record with
siblings, absent instrumentation and foreign identifiers survives a round trip —
and none of those three questions is asked by a bag of actors.*

**So the deciding consideration is the one §1.8 makes about import:** the four
consequences are *"free while the format is being written and expensive
afterwards"*, and an envelope is one of them. **One envelope, two payloads** — a
manifest naming what is inside, a version, and the same provenance rules — is
free if it is written once and is two formats forever if it is not. A stage of
its own would write the second envelope; an export button on the package editor
would write it *and* put it somewhere nothing else can reach.

*What this does not do is grow P11.10's gate.* The round trip that has to be
proved is the session's, for the reason §1.8 gives. The package half's proof is
one line beside it — **a bundle exported from one install opens on another** —
because every object in it round-trips through machinery six phases old.

---

## 2. Stages

The audit first, because §1.2 says the list does not exist; then the two large
user-facing items; then the sweeps, which are cheapest once nothing new is
landing; then release engineering, which gates the phase rather than being part
of it.

***Three stages were appended below release engineering rather than placed in
that order*** — P11.10 and P11.11, added 2026-09-14 (§0.1, §1.8), and **P11.12,
added 2026-09-17** ([§0.4](#04-the-audit-run--2026-09-17-at-45c613c)).
**Appended, because stages are cited by number across the corpus and renumbering
nine of them to put two in their right place would break live citations to buy
tidiness** — an argument that got cheaper the second time it was used, which is
what a convention is. By argument all three belong with the large user-facing
items: export is the largest single thing this phase builds and the only one
with a design dependency outside the phase, and the extractor is the half of
[08](../08-cross-session-memory.md) that [P8](25-p8-implementation.md) cut. Read
§2 as P11.0, P11.10, P11.11, P11.12, P11.1 … P11.9, and treat the numbers as
filing order — the same convention the work-plan documents themselves run on.

***And since 2026-09-16 the reading order can be derived rather than asserted.***
Every stage now carries a *Depends on* line, so the order is a topological sort of
thirteen stages of which **ten depend on nothing** (§5). That makes two
constraints and one preference explicit:

- **P11.8 last but one, P11.9 last.** The sweep depends on everything that adds
  user-facing prose and the packaging depends on everything; these are the
  phase's only internal dependencies, and they are the seam §5 pins.
- **P11.3 early rather than late**, which is a preference with a reason: §1.5's
  residual risk is that the mode contract turns out wrong and P11 finds out
  *after everything is built on it*. **That risk does not fall by waiting.**
  Running the assistant before the sweeps is how a contract fault gets found
  while there is still phase left to absorb it.
- **Everything else in any order** — worth saying, because a list of twelve reads
  as a sequence whether or not it is one.

### P11.0 — The audit that makes the list

A systematic pass over the design documents producing every 1.0 commitment with
no owner, cross-checked against every *home P11* recorded in the phase
documents. §1.3's violation re-count runs here. §1.1's rule is applied as the
list is built, not after.

*Ends at:* a list where every item names its artifact and its check — and a
count, so the phase's size is known before it starts rather than discovered.

**The audit does not start from nothing.** A surface sweep on 2026-09-11 ran
this pass early over [10](../10-ui-surfaces.md) against every phase document,
and placed what it found: [manual testing §10](05-manual-testing.md) carries the
rows, [P7B](24-p7b-presets-and-prompts.md) took the prompt-handling surfaces,
and [P10.3](27-p10-implementation.md), [P10.4](27-p10-implementation.md), P11.1,
P11.2 and P11.7 below each gained the items placed with them, dated. What this
stage owes is the re-run rather than the repeat: the items that arrived after
that date, and a check that the placements held — a placement is a routing, and
[manual testing §10.1](05-manual-testing.md) is what a routing nobody re-reads
turns into.

***And a second one ran on 2026-09-14 — §0.1, which is the register.*** It read
the other way round: the code against the design notes, looking for capabilities
the server has and no client reaches. **Seventeen items, and its overlap with
2026-09-11's eleven is small**, which is the finding worth carrying into this
stage rather than either list. *One sweep is a direction, not a pass.* This
stage runs both directions and reconciles them, and the two existing registers
say where they disagreed — twice, in both cases because a placement had been
made and not re-read.

**One additional review input:** [20 — client loading](../20-client-loading.md)
records the early bundle-size baseline and expects growth through the intervening
phases. Its §7 proposes this audit as the point to measure arrival and navigation
costs, then decide whether route/tool splitting and serving changes need a stage
before broader distribution. It adds a review, not a pre-priced implementation
commitment; observed loading problems can bring it forward.

*Depends on:* **P10 having closed**, and nothing else. §0.2 answered *what P8 and
P9 added to the pile* — one row — so P10 is the only phase left between this
document and this stage.

*Proof obligation:* **the two instruments, run and recorded** — which is the only
mechanical part of an audit and therefore the only part worth an obligation.
`route-callers.test.ts`'s OWED map and `config.ts`'s `'unread'` tier are both
enumerable in seconds, both fail the build when they go stale, and between them
they cover the two shapes a shipped-but-unreachable commitment takes (§0.2).
**The stage's real output is the list, and a list has no check** — which is
§1.1's rule turned on this stage and answered rather than dodged: *what the rule
can hold here is that the two countable things were counted; the rest is
reading, and §0.2 is the evidence that reading finds what the instruments
cannot.*

#### Done — 2026-09-17, in [§0.4](#04-the-audit-run--2026-09-17-at-45c613c)

**Twenty-seven items, seven of them fixed by the running of it.** The list, the
count and the two instruments' readings are §0.4; what belongs here is what the
stage learned about itself.

***The stage's own proof obligation turned out to be the least informative thing
it produced***, and that is worth recording rather than hiding. Both instruments
read exactly what §0.3 left them — four owed routes, two unread keys — because
**neither can see what this audit was for.** `OWED` watches routes and
`'unread'` watches config keys; twenty-two of the twenty-seven items are
*sentences*. The obligation was honest and it was satisfied by a no-op.

***So the stage built the instrument its own findings implied.***
[`tools/citation-targets.test.ts`](../../../tools/citation-targets.test.ts) is
[manual testing §10.1](05-manual-testing.md)'s lesson mechanised — a citation
names a stage or a section that exists — and it found **sixteen defects on its
first run**, one of which was a test asserting half of what its title claimed
while owing the other half to `P2.7`, the never-created stage §10.1 is a whole
section about. *That file predicted its own repair — "when that lands, this test
changes shape, and it should be found by failing" — and the prediction did not
fire, because the body never drove the watcher.* It does now.

**§1.1's rule turned on this stage and answered rather than dodged**, which is
what its *Proof obligation* line asked for: the countable things were counted,
and the reading found what the instruments could not. The difference this time is
that *some of the reading became countable* — which is the only way an audit
stops having to be re-run by hand.

**Row 20 is decided** — [P11.12](#p1112--the-automatic-extractor) — and
§1.9 settles `.sepack`. Both were carried on the explicit promise that the
revisit would decide them, and this is the revisit.

### P11.1 — The reading view

[10 §12](../10-ui-surfaces.md): any node rather than only the head, live rather
than an export step, renditions inline where P9 produced them, HTML with a real
print stylesheet plus Markdown and plain text. §1.4's fence enforced.

**And two things placed here on 2026-09-11 because they share its formats.**
The search surface, [10 §14](../10-ui-surfaces.md) — argued for 1.0 in the
design, built server-side at P2 with the UI named as P3's, and never given a
client: nothing in `packages/client` calls `GET /api/search`, and
[P5.2](17-p5-implementation.md) said *"the surface for all three is §14.5's"*
without saying whose §14.5 is. A hit lands on the reading view's addressable
node, which is why they are one stage. And print and copy-as-Markdown for a
lorebook, [10 §5.3](../10-ui-surfaces.md), which is the same print stylesheet
and the same Markdown pass run over a different record. Both are the kind of
cheap item §1.4 warns gets cut, so they are named here rather than left to
P11.0 to rediscover.

*Depends on:* nothing. Every input exists — the turn tree, `walkPath`, the
rendition records [P9](26-p9-implementation.md) wrote, and `GET /api/search`,
which has served objects and turns since P2 and which
[`route-callers.test.ts`](../../../packages/server/src/routes/route-callers.test.ts)
still lists as **owed a caller**. *That OWED entry is this stage's, and it is
discharged by building the surface rather than by editing the map.*

*Ends at:* a two-hundred-turn session reads end to end as prose at the head **and
at an abandoned node**, prints through the browser with a real stylesheet, and
copies as Markdown that pastes usefully elsewhere — and a search hit lands on the
node it names.

*Proof obligation:* `packages/client/src/reading/…` — **the fence, asserted
rather than intended.** §1.4 says the view must not drift toward the workbench,
which is a claim about what it renders: *no cost, no token count, no model id,
no block table anywhere in the reading route's subtree.* A source-text assertion
over that directory is the cheap form and it is the form that survives somebody
adding a *helpful* line two phases later. Plus `route-callers.test.ts` losing its
`GET /api/search` row — which is the mechanical half, and the one that says the
surface is reachable rather than merely written.

### P11.2 — Editors are not dumb forms, across every editor

[10 §11](../10-ui-surfaces.md) applied where P1's prototype editor, P2A's forms,
P5's entry editor and P7's panels each stopped short: the field assist contract,
provenance ([10 §11.2](../10-ui-surfaces.md)), image slots, and
[10 §11.2c](../10-ui-surfaces.md)'s entry-level import and export. The polish
half of this is [polish §1–§2](06-polish.md)'s and lands there or here but not
twice.

**And the editors that have to exist before a contract can be applied across
them.** [P7B](24-p7b-presets-and-prompts.md) brings presets and treatments, and
**since 2026-09-14 the setup and package editors too** — so *across every
editor* becomes six rather than two, and none of that is scope added to this
stage. It is scope this stage never had: §0 recorded on 2026-08-31 that the
clause covered one editor and that its real size was unknowable, and §0.1
answered it.

***Two corrections to what this paragraph said on 2026-09-11.*** It read that
*"P7.4 writes setups through the wizard, which [10 §6](../10-ui-surfaces.md)
makes the setup's editor by design"*, and that **the package editor is this
stage's**. Neither holds.

- **P7.4 built a way to make a Setup, not a way to edit one.**
  `SessionsPage`'s *Save as a setup* writes a `setups/` object, and
  `library/fields.ts` says in its own docstring why that is not the same thing:
  *"`setups` stays out of these tables until it has an editor."* A saved Setup
  is readable on the generic shelf and nowhere editable. **The refinement worth
  keeping** is that a setup editor is a *smaller and differently shaped* item
  than the other three, because the create path already exists and is not a
  form — naming a configuration you already played rather than filling in a
  blank one.
- **The package editor is [P7B](24-p7b-presets-and-prompts.md)'s**, decided
  2026-09-14. The argument this paragraph made for keeping it was
  self-undercutting: *across every editor* cannot apply to an editor that does
  not exist, which is a reason to build it **before** the sweep rather than
  inside it. A bundle's editor is still a picker over the objects a user owns
  ([04 §9](../04-schemas.md)), and that description travels with it.

**What does stay here** is the lorebook entry's remainder: P5.1 left everything
past the five core fields read-only on purpose, and P7's 2026-09-10 re-audit, on
its branch, found that *the five per-book retrieval knobs and the book-level
`enabled` gate have real consumers and no write surface* — **since closed at
P7.14**, so what remains is the entry-level fields rather than the book-level
ones.

**The sequencing is the whole of the decision**, and it is the same sentence in
both directions: a sweep over six editors is the same work as a sweep over two,
and running it before the six exist would guarantee running it twice.

***The six exist, as of 2026-09-16*** (§0.2). `EDITOR_ROUTES` covers the whole of
`LibraryKind` and `library/fields.test.ts` asserts it over the whole key set with
six distinct addresses — it no longer counts an absence down, on its own stated
grounds that *"counting down an absence is not maintenance, it is a test being
kept alive past the thing it was about."* **So this stage's subject is a fact
about the tree rather than a projection**, the sequencing decision above was
taken correctly, and what P11.0 owes here is a read of six editors rather than a
question about how many there will be.

*Depends on:* nothing here — [P7B](24-p7b-presets-and-prompts.md) built the six
and its merge is the dependency, already discharged.

*Ends at:* every editor offers assist, provenance and history, and a collapsed
section names what inside it is not at its default.

*Proof obligation:* `packages/client/src/editor/…` — **over the key set, not over
the editors somebody remembered.** `fields.test.ts` is the model and it is in
this file already: the claim runs over `LIBRARY_KINDS` and fails when a kind is
added without the affordance, which is the difference between a test that
tracks the feature and one that tracks the day it was written. *The
not-at-its-default invariant is the row [P5 §2](17-p5-implementation.md) refused
to cut, and it is the one an assertion can hold exactly* — the others are
rendering.

### P11.3 — The assistant

§1.5's decision executed — ***and as of 2026-09-16 the decision is that all of it
is here***: P7 closed without pulling the mode definition across, so this stage
builds the definition **and** the surface ([10 §7](../10-ui-surfaces.md)) —
summonable from anywhere as a panel, starter prompts, ambient context **disclosed
as a block in the turn record**, domain tools rather than filesystem tools, and
every mutation a reviewable diff carrying `GeneratedFieldProvenance`.

**Early in the phase rather than late, and §1.5 is why.** The residual risk the
fork was managing is that the mode contract turns out wrong *after everything is
built on it*. That risk does not fall by waiting; it falls by finding out. So
this stage runs before the sweeps — ahead of P11.2's six editors and P11.8's
catalogue — because a contract fault found here is a fault found while there is
still a phase left to absorb it.

*Depends on:* nothing in this phase. [06 §7.4](../06-modes-and-turn-pipeline.md)
says the whole design is *a session, in a mode, with an actor card*, and all
three have shipped since P7.

*Ends at:* the assistant answers a question about the user's own library,
proposes a change as a diff, and the applied change carries provenance.

*Proof obligation:* **`tools/repo-shape.test.ts`, not a component test** — the
check §3's row 4 already names and puts *in the gate*: **no part of it is a
second chat implementation.** That is a grep, it is mechanical, and it is the
only assertion that holds [06 §7.4](../06-modes-and-turn-pipeline.md)'s actual
claim — *"if building it requires a parallel chat implementation, something in
the mode contract is wrong."* A passing assistant built the wrong way would
satisfy every behavioural test and fail this one. *Plus the ambient-context
block appearing in the turn record*, which is what makes the disclosure real
rather than promised.

### P11.4 — Scene's remainder, and impersonation

[06 §3.1](../06-modes-and-turn-pipeline.md)'s impersonation, which
[P2's P2.6 stage](08-p2-implementation.md) recorded as shipping in Scene *at
P7/P11 scope* — so this stage is whatever half of that P7 did not take, and
the revisit should start by finding out which.

***Found out, 2026-09-16: P7 took none of it, and P7 says so itself.*** That
document's own dependency list carries the row — *"[25 C3] — impersonation, and
the split P11 asks P7 to make… [P11.4] says 'this stage is whatever half of that
P7 did not take, and the revisit should start by finding out which.'*
***P7's revisit did not know it was asked.***"* And the tree agrees: the word
appears in no package. **So there is no split. This stage is the whole feature**,
which makes it larger than the sentence above reads and smaller than it sounds.

**Smaller than it sounds, because §3.1 already reduced it to a mechanism that
exists.** *"Impersonate — the model writes your next message as your persona —
is simply a `player`-controlled member being model-authored for one turn. Same
mechanism, flipped for a turn."* Scene has `control` on party members since P7,
so what is missing is the *flip*: one turn authored against the persona's card
with the persona as subject rather than audience, and a reroll that costs
nothing.

*Depends on:* nothing. Scene's party and `control` shipped at P7.

*Ends at:* a player stuck for words gets a draft in their own character's voice,
edits or accepts it, and rerolling it is one button.

*Proof obligation:* `packages/modes/scene/src/…` — **the card is the subject, not
the audience** ([06 §3.1](../06-modes-and-turn-pipeline.md)), which is a claim
about the assembled prompt and therefore assertable on the block list: the
persona's card is present as the thing being written *as*, and the turn is an
ordinary one on the record. *A turn that cannot be rerolled would satisfy the
first half and miss the point of the feature*, so the reroll is in the
obligation.

### P11.5 — Hook tuning, played

§1.7. Not a build stage — a stage whose output is settings, prompt wording and a
panel that survived contact with a real pool.

***And as of 2026-09-16 the subject is enumerable, which is what makes a tuning
stage schedulable at all.*** P7 shipped the mechanism, so what this stage tunes
is four numbers, one constant and one absence:

| What | Where it is now |
|---|---|
| The four levels' **cadence and cooldown** | `sessions/hooks.ts` — `sparse: 6/20`, `normal: 3/10`, `aggressive: 1/4`, `manual-only: ∞/∞` |
| **How long a commitment waits** before lapsing | `HOOK_PATIENCE = 3` |
| **How `sparse` reads to a model** | ***Nowhere.*** [06 §6.1](../06-modes-and-turn-pipeline.md) puts the levels' prose in the **pack** and the numbers in engine code; `turns/hook-selector.ts` records that the pacing prose *"arrives as an ordinary block when the pack grows one"* — and no pack has grown one |

**The third row is the one that is not tuning.** A pack block that does not exist
cannot be worded better by playing; it has to be written first, and writing it is
a small build inside a stage that says it is not a build stage. *Naming it here
is the point* — otherwise the stage arrives, discovers a missing block, and
either grows silently or drops the half of §1.7 that is about **wording**.

*Depends on:* a live endpoint and hours of play — the only stage here whose
input is a person's time rather than code. *It therefore depends on
[manual testing](05-manual-testing.md)'s R2 in the way the sittings do, and
should be walked with **sitting G** rather than beside it: one long unscripted
session answers this stage and PLAYABLE's fourth hypothesis at once.*

*Ends at:* four levels produce recognisably different sessions, and a session at
`sparse` with eligible hooks explains its own quiet.

*Proof obligation:* **none, and that is this stage's honest answer to §1.1's
rule.** [work plan §2.1](01-work-plan.md) lists *that hook pacing works at all*
among the hypotheses nothing has tested, and a hypothesis is not discharged by an
assertion — it is discharged by playing and writing down what happened. **What
this stage owes instead is a written result** in [manual testing](05-manual-testing.md),
in the form §0's two-tier gate uses. *An item that cannot name a check is
supposed to be ejected by §1.1; this one is kept because the rule's own purpose —
that nothing ends by someone getting tired — is served by a sitting with a
recorded outcome, which is the same thing a check buys.*

### P11.6 — Update check, About badge, and better failures

§1.6, if P10 did not take it; the conditional connectivity warning, admin-only;
and the error-message improvement that is the feature's actual value.

***Two settings for it already ship, unread*** — 2026-09-16, and this is the
sharpest reason to settle the ownership rather than carry it. `config.ts`'s
`CONFIG_TIERS` marks **`updates.checkEnabled` and `updates.channel`** as
`'unread'`, the tier meaning *nothing consumes this*. So the configuration
shipped ahead of the producer, which is precisely what
[P10 §1.7](27-p10-implementation.md) calls *shipping dark* — arrived at by
default rather than chosen.

**[P10 §1.7](27-p10-implementation.md) leans to taking the check, and its
re-audit strengthened the lean**, so the live reading is that **this stage is
P10's** and what remains here is the half P10 does not want: *better failures*.
That half is the feature's actual value and it is independent of the badge —
*"this server appears to have no internet access"* instead of a raw DNS or TLS
error, and the same sentence at first run before somebody configures a remote
provider that will never work.

*Depends on:* P10's answer to its §1.7, which is a reading of one paragraph
rather than a build. **If P10 takes the check, this stage is the error messages
alone**; if it does not, the check comes here with them.

*Ends at:* an install with no internet says so in a sentence somebody can act on,
**and the two `'unread'` keys either have a consumer or are gone.**

*Proof obligation:* `config.test.ts` — **the tier table, read as an assertion.**
Those two keys leaving `'unread'` is the mechanical form of this stage being
done, and it is already enforced in the direction that matters: a key missing
from the table fails the build. *The conditionality is the part a test must also
hold* — an install whose connections are all local is legitimate, so the
assertion is that a local-only install produces **no** warning, which is the
failure mode §1.6 names and the one a happy-path test would never see.

### P11.7 — Trash retention and restore, and the accessibility audit

[P2 §2.11](08-p2-implementation.md)'s F7 second half — delete already *moves* to
`users/<h>/trash/`, history and all, so what is missing is the retention sweep
and the restore UI ([03 §10.2](../03-data-model.md)). And §1.2's accessibility
pass, which is an audit over surfaces built to the habit or it is a rewrite.

**And the link table.** The reference counts [03 §10.1](../03-data-model.md)
wants on this confirmation — *referenced by 12 sessions, 3 treatments and 1
package* — need an inbound-links query the index does not have, and
[P4 §6.6](16-p4-implementation.md) recorded it as one debt with
[10 §5.2](../10-ui-surfaces.md)'s *Used by* panel: *"whichever phase builds
that panel pays both."* This stage is already opening delete, so it pays both —
the table, the counts, the panel, and *played alongside*
([10 §5.3](../10-ui-surfaces.md)), which is the same query read from a
lorebook. Placed 2026-09-11; nothing had named a phase before.

***And the retention half has a marker in the tree*** — 2026-09-16.
`trash.retentionDays` is `'unread'` in `CONFIG_TIERS`, with `config.ts` saying it
outright: *"the maturation sweep does not read it; trash retention is not
implemented."* **So the setting, the window and the folder all exist and nothing
sweeps** — which is the standing line's shape with a default of 30 days that has
never expired anything.

*Depends on:* nothing. `Layout.trashRoot` and the move-on-delete path have
shipped since P4.4.

*Ends at:* a deleted object is restorable within the window and gone after it,
with its history intact in both directions — and the confirmation names what
refers to it before anybody presses the button.

*Proof obligation:* **two, because this stage is two features wearing one
heading.** For retention, a sweep test over a **clock the test controls** — the
one shape that can assert *gone after it* without waiting thirty days, and the
reason to write it here rather than let somebody reach for a real date. For the
link table, the count itself: an object referenced by a session, a treatment and
a package reports **three**, which is the claim [03 §10.1](../03-data-model.md)
makes and the one a panel showing *Used by* would otherwise assert only by
looking right. *The accessibility pass has no proof obligation and should not
pretend to one* — [P2 §2.11](08-p2-implementation.md) calls it an audit over
surfaces built to the habit, and an audit's output is findings.

### P11.8 — The localisation sweep

§1.3: extraction into catalogues, the deliberately bad machine-generated French
for testing ([19 §12.4](../19-tech-stack.md)), and missing keys falling back to
English **silently, per key** — a 60%-translated UI should look bilingual, not
broken.

***The size is measured rather than estimated*** — §1.3's re-measurement,
2026-09-16: **thirty-one open-keyed label maps across twenty-one files**, up from
roughly ten. Every one is still a class-to-word lookup with the English on the
client and `{ key, params }` on the wire, so the sweep is **moving maps into a
catalogue** rather than hunting sentences in server code — which is the outcome
§1.3 traded for on day one and the reason this stage is a sweep at all.

**And one number says what the stage should leave behind.**
`library/note-labels.test.ts` — which §1.3 calls *the model* — fails the build
when the server emits a class the client has no sentence for **and** when the
client holds a sentence for a class nothing emits. **It is applied once, in
thirty-one places.** Nothing has regressed; the model simply has not propagated,
and propagating it is most of what a catalogue is for.

*Depends on:* everything else in the phase, and this is the one real ordering
constraint in §2. A sweep run before P11.1's reading view, P11.3's assistant and
P11.7's restore UI would be a sweep run twice — *the same argument P11.2 makes
about editors, one level up.*

*Ends at:* the app runs in the test French with no layout breakage, and an
untranslated key renders English with no placeholder and no console noise.

*Proof obligation:* **`note-labels.test.ts`'s shape, generalised to the
catalogue** — the class set and the word set agree, for every map, as one
build-time check rather than thirty-one hand-written ones. *That is also the
answer to how anybody knows the sweep is finished*: it is finished when a map
outside the catalogue fails the build, not when somebody has been through the
list.

### P11.9 — Release engineering, which is the other half of the bar

[work plan §8](01-work-plan.md) rewritten rather than extended, and then built: CI that
builds, tests and produces artifacts on every merge; reproducible builds of the
container and the tarball from a tag; the release cut automated — tag, build,
publish, changelog; channels wired and *boring*, because a nightly that is often
broken is worse than none ([releases §4](04-repo-and-releases.md)); version and
commit embedded in the build, which AGPL §13 requires anyway and which
[P10](27-p10-implementation.md) needs for its About surface.

**Written once already, at [P6A](19-p6a-alpha-1.md), and that changes what this
stage is.** Three of [work plan §8](01-work-plan.md)'s seven bullets were taken there on
one artifact: the release cut automated end to end, version and commit embedded,
and an on-tag CI tier that exists — *exists*, and at P6A's close had not run,
because the first `v*` tag is the rehearsal and it is a person's to push. So
this stage is no longer standing a release
process up from nothing — it is **widening a working one to five more artifacts
and to an audience**, which is a different and better-understood job. The
rewrite of [work plan §8](01-work-plan.md) that §1.1 owns should say what the rehearsal
actually taught rather than restating the list.

**What P6A deliberately left here is the audience half**, and it is the half with
the obligations: public distribution, the AGPL §13 source link and the About
surface ~~that no UI document yet specifies
([10 §15.3](../10-ui-surfaces.md) enumerates the admin panels and About is not
among them)~~, the channels, and the upgrade and restore tests that only matter
once somebody else's data is at stake.

***The About clause is corrected 2026-09-16 (§0.2), in the direction that makes
this stage smaller — and the sentence above was right about the wrong thing.***
[10 §15.3](../10-ui-surfaces.md) genuinely does not enumerate About; **§15.1
does**, in the *user* half — *"About: what build this is — the name, the version
string"* — so the negative was established over the admin section and read as a
negative about the document. And `packages/client/src/about/` already ships
`AboutBuild.tsx` and a `BuildFooter`, because
[P6A](19-p6a-alpha-1.md)'s embedded version had to surface somewhere. So what is
left here is the **audience** obligations attached to About — the AGPL §13 source
link and the channels — rather than the surface itself.

*Depends on:* everything this phase ships, because it packages it — **and on
nothing outside**, since [P6A](19-p6a-alpha-1.md) took the half with the
unrecoverable decisions. *This is the stage that gates the phase rather than
being part of it*, which §2's ordering already says.

*Proof obligation:* **`git tag` twice on one commit produces identical
artifacts** — the reproducibility claim in the only form that distinguishes it
from *the build works*, and the form [work plan §8](01-work-plan.md)'s rewrite has
to be able to assert. Plus `tools/release.test.ts` **extended from one artifact to
five**: it already fails when the version disagrees across `package.json`,
`CHANGELOG.md`, `compose.yaml` and the unraid template, and each new artifact adds
a place for that version to disagree. *That test is the cheapest thing this stage
inherits and the one most likely to be forgotten, because it passes today.*

*Ends at:* the demo.

### P11.10 — Session export, and the format it freezes

***Added 2026-09-14 (§0.1, §1.8).*** §1.8 argued this stage at length and §2
never contained it, which is the defect [manual testing §10.1](05-manual-testing.md)
is a whole section about: an obligation that reads as scheduled and is not.

§1.8 is the specification and none of it is restated here. What the stage owes
beyond it: the four consequences of having import as a second reader, which are
free while the format is being written and expensive afterwards, and the
dependency — **[13 §4](../13-write-mode.md) settled before the format is fixed,
not after.** If it is unsettled when the stage arrives, the stage blocks on it
rather than guessing.

**`.sepack` import and export belongs beside this stage** (§0.1 row 13) rather
than inside it. Both freeze a format and both are *how things travel*, but they
travel different things — a session with its branch structure and channel state,
and an arbitrary bundle of library objects — and the [P4](16-p4-implementation.md)
line that routed the package half here (*"P11-ish"*) is the only assignment the
corpus has ever given it. Deciding at the revisit whether it is this stage, a
twelfth, or [P7B](24-p7b-presets-and-prompts.md)'s package editor growing an export button
is cheaper than deciding now.

***The record this stage freezes is two records, since 2026-09-16*** (§0.2, §1.8).
[P9 §1.1](26-p9-implementation.md) decided `Rendition` is internal tier and
graduates *at this event*, on the sentence `turn.ts`'s own header carries —
*"session export ([25 B12](../25-open-questions.md)) is the event that ends this
freedom"*. So [21 §7](../21-internal-contracts.md)'s rendition contract comes with
the turn record, and §1.8's four consequences are asked of both. **P9 paid for
that answer rather than leaving it here**: the tier claim is checked by
`emit-schemas` producing no diff, so this stage inherits a record that has never
been published under a schema it would now have to honour.

*Proof obligation:* **the round trip, and the three things a serialiser written
against our own records would silently get wrong** (§1.8). A session exported and
re-read keeps its **siblings** — assert the count, because `walkPath(head)` drops
them and the loss is invisible against a linear session; survives a record with
`input`, `output`, `request`, `cost` and `steps` **absent**, which is what a
hand-edit divergence turn already is on disk and what a tightened serialiser
would reject; and round-trips a turn carrying a **foreign identifier** it does not
understand. *The first is the one that costs data, and no fixture this build
produces would catch it unless the fixture branches* — so the fixture branches.

*Depends on:* [13 §4](../13-write-mode.md) — **read 2026-09-16 and found written
and settled through §4.8**, so this is a confirmation rather than a block
(§1.8) — and on nothing else here.
*Ends at:* a session exported from one install loads on another, siblings
included — **not the path**, which is the consequence most likely to be lost by
a serialiser written against `walkPath(head)` — and the turn record **and the
rendition record** are declared frozen.

### P11.11 — Backup and restore

***Added 2026-09-14, same finding.*** §1.8 calls it *"the smallest"* and it is:
quiesce, archive the data directory excluding the index, restore and rebuild
([25 E6](../25-open-questions.md)).

**The part that matters is not in this stage.** The CI restore test belongs to
[testing](03-testing.md), and [work plan §8](01-work-plan.md) lists *"backup and
restore actually exercised"* among the release-engineering bullets rather than
among the features — which is the right place for it and is also how this came
to have no stage: everybody could see where the *test* went.

*Depends on:* nothing.

*Proof obligation:* **the CI restore test, which belongs to
[testing](03-testing.md) rather than to this stage** — this phase's one case of
the check living outside the document that owes it, and also how the stage came
to have no home at all (§1.8: *everybody could see where the test went*). What
the obligation adds is the clause that makes it a restore test rather than a copy
test: **the index is rebuilt, not carried.** Archive excluding `index.sqlite`,
restore, and assert the sessions are served *and* that a search answers — a
search answering is the only observable proof the rebuild ran, and an archive
that quietly included the index would pass every other check.

*Ends at:* a restored install serves the sessions the
archive was taken from, with the index rebuilt rather than carried — and the
test that says so runs without a person.

---

### P11.12 — The automatic extractor

***Added 2026-09-17 by [§0.4](#04-the-audit-run--2026-09-17-at-45c613c)***, which
decided [§0.2](#02-re-audited-2026-09-16-at-2f3f5d9-after-p7b-p8-and-p9)'s row 20
rather than carrying it a third time. [08 §2.1](../08-cross-session-memory.md) is
the specification and none of it is restated here: *a step at session end, and
periodically during long sessions, writes memory entries* — **discrete facts and
events, not summaries**, because *"five memories are five things that can be
retrieved independently, attributed separately, and deleted individually when one
turns out to be wrong."*

**Appended rather than placed**, on §2's convention. By argument it sits with the
large user-facing items.

***What P8 left, which is most of it.*** [P8](25-p8-implementation.md) cut this
on its own named fallback and built everything around it: the (actor × persona)
memory book, the retrieval path and budget the workbench already reports, manual
capture with its escaped-effect write, the scope and intake toggles, and
`LoreEntry.locked` **with a writer and no reader**. P8.3's record states the
inheritance outright — *"the extractor inherits an obligation with subjects
already on disk."* So this stage is a step, a narrowed payload, a prompt and a
dedupe rule, over machinery that is six stages old and has run.

**Two rules come with it rather than after it**, both from
[08 §6](../08-cross-session-memory.md) and both cheaper to build than to retrofit:

- **The extractor never rewrites a locked entry.** That is the reader `locked`
  has been waiting for since P8.3, and a hand-written memory is locked from the
  moment it is written — so the subjects exist before the rule does.
- **It is handed the record, narrowed.** [P8 §1.5](25-p8-implementation.md)
  settled the payload question, and its own argument is that *"what the extractor
  declared `history` to get"* is verbatim what it is given — an extractor that
  reads more than it declared is exactly what §6 rejects.

*Depends on:* nothing in this phase. Everything it needs merged with
[P8](25-p8-implementation.md).

*Ends at:* a session played to its end leaves memories in the pair's book
without anybody asking, **a hand-corrected one survives the next extraction**,
and a second session about the same events does not double the book.

*Proof obligation:* **[P8](25-p8-implementation.md)'s C2 and C3, which is the
point of taking the stage rather than a side effect of it.** Those two criticals
are *vacuous* under the cut — C2 asks whether a hand correction survives the next
extraction and C3 whether a memory bleeds a spoiler, and neither can be walked
while nothing extracts. **This stage is what makes
[sitting N](05-manual-testing.md) more than one row.** The mechanical half is the
locked rule, asserted where it can fail: a locked entry, a run that would have
rewritten it, and the entry unchanged — which is a test and not a sitting. *The
judgement half — whether the facts it picks are the ones a reader would have
picked — is [G](05-manual-testing.md)'s, and belongs with the other tuning this
phase cannot do at a desk.*

---

## 3. Verification — the P11 exit gate

~~Sketch; expand on revisit.~~ **This gate is also the beta gate**, which is the
one structural difference from every other phase document here.

***Expanded 2026-09-16, and the expansion is mostly a pointer rather than more
rows.*** Every stage in §2 now carries a **proof obligation** — §1.1's rule
applied to this document's own list, which §5 asks for in as many words — so the
twelve rows below no longer have to carry the mechanical detail as well. **Row 1
is what does the work**: *P11.0's list is empty, item by item, with each item's
named check green*, and each stage's obligation is now one of those named checks.

**What the rows below are for is the part no stage's obligation can hold**: the
claims that span stages (row 2's two-hundred-turn session, row 6's whole app in
French), and row 12, which is a person reading the design corpus.

1. P11.0's list is empty, item by item, with each item's named check green.
2. A two-hundred-turn session reads end to end as prose, at the head and at an
   abandoned node, prints to a clean PDF through the browser, and copies as
   Markdown that pastes usefully elsewhere.
3. Every editor in the app offers assist, provenance and history — and a
   collapsed section names what inside it is not at its default, the invariant
   [P5 §2](17-p5-implementation.md) refused to cut.
4. The assistant answers a question about the user's own library, proposes a
   change as a diff, and the applied change carries provenance. **And no part of
   it is a second chat implementation** (§1.5) — the check is a grep and it
   belongs in the gate.
5. Hook pacing at each of four levels produces recognisably different sessions,
   and a session at `sparse` with eligible hooks explains its own quiet.
6. The app runs in the test French with no layout breakage, and an untranslated
   key renders English with no placeholder and no console noise.
7. A deleted object is restorable within the retention window and gone after it,
   with its history intact in both directions.
8. The Playwright journeys pass against the fake provider, on CI, on every
   merge.
9. `git tag` produces the container and the tarball reproducibly, and the
   artifact reports the tag's commit.
10. **A session exported from this install loads on another one, siblings and
    all** — not the path — and the turn record is declared frozen (P11.10).
11. **A restore from a backup serves the sessions the archive was taken from**,
    index rebuilt rather than carried, and CI says so without a person (P11.11).
12. **Only a person can walk, and it is the whole gate:** read the 1.0 design
    documents and say, capability by capability, whether it exists and works.
    That is what [releases §0](04-repo-and-releases.md) means by feature
    complete, and it is deliberately checkable against documents rather than
    negotiable.

***Rows 10 and 11 added 2026-09-14 with their stages*** (§0.1, §1.8). Their
absence is worth a sentence rather than a silent fix: this gate had ten rows and
neither of the two 1.0 commitments the phase had most recently acquired was
among them, **which means row 12 was the only thing standing between a missing
export and a green beta gate** — and row 12 is the row that depends entirely on
a person reading carefully. A gate whose safety net is *somebody will notice* is
the arrangement [manual testing §0](05-manual-testing.md) was adopted to end.

***And row 13, added 2026-09-16, is the one this phase cannot assert about
itself.*** [P8](25-p8-implementation.md)'s **automatic extractor** is unowned
(§0.2's row 20) and two of P8's three gate criticals travel with it. So:

13. **Either some phase has taken the extractor, or this gate records that 1.0
    ships manual capture deliberately** — and [sitting N](05-manual-testing.md)'s
    two vacuous rows are marked as such rather than left blank. *This is not a
    build row and it is not optional*: while it is unanswered, *feature complete
    to the 1.0 spec* is a claim nobody is entitled to make, and row 12's reader
    would have to notice on their own that the question was open.

***What the split between the twelve rows and the stage obligations costs, said
plainly*** (2026-09-16): a reader now has to look in two places to know what this
gate checks. **That is the right trade and it was not free.** The alternative —
one list carrying both — is what produced a ten-row gate missing its two newest
commitments, because a list that holds everything is a list nobody re-reads
against the stages. *Row 1's wording is what joins them, and it is the sentence
to keep correct if anything here drifts.*

**And the standing line from [work plan §2.3](01-work-plan.md): no phase exits with
configuration that has no surface.** By this phase the line is not a per-phase
check but a **completeness claim** — there is no later phase to defer to, so
anything still configurable only by text editor either gets a surface here or
gets removed.

***That claim has a mechanical reading as of 2026-09-16*** (§0.2). `config.ts`'s
`CONFIG_TIERS` marks a key **`'unread'`** when nothing consumes it, and
`config.test.ts` fails when a key is missing from the table — so the set of
unsurfaced settings is **enumerable by reading one table** rather than by a
person going looking. Four today: `trash.retentionDays` (P11.7),
`updates.checkEnabled` and `updates.channel` (P11.6), and
`limits.extensionStorageQuotaMb` (P10's extension fork). **Row 1 above should be
read as including that table reaching zero**, which is the strongest form this
line has ever had.

***One thing this gate cannot assert, named rather than left to row 12.***
[P8](25-p8-implementation.md)'s C2 and C3 travel with its deferred **automatic
extractor** (§0.2's row 20), which no phase owns — so *feature complete to the
1.0 spec* is a claim this gate cannot make while memory's only writer is a person
pressing a button. **Either some phase takes the extractor before this gate is
walked, or row 12's reader records that 1.0 ships manual capture deliberately.**
What must not happen is row 12 being walked by somebody who does not know the
question was open.

---

## 4. Out of scope, deliberately

The branch tree visualiser ([24 §1](../24-roadmap.md)); the file browser
([25 D3](../25-open-questions.md)) and Tailscale
([25 D1](../25-open-questions.md)), all three on the feature list; the Character
Studio ([17](../17-character-studio.md)), which is a committed release at 3.0
rather than a feature-list entry; the prologue
packages that unblock once export lands ([25 B10](../25-open-questions.md));
chapterisation and embeddings ([24 §3](../24-roadmap.md),
[25 E2](../25-open-questions.md)); quality evals of any kind
([testing §4.3](03-testing.md)); and every committed release after 1.0 — the
Write surface, World, Campaign and the authored-rule tier — which are scheduled
rather than deferred ([work plan §5](01-work-plan.md)) and whose arrival answers
[work plan §0.2](01-work-plan.md)'s checks.

**No longer out of scope, and moved into §1.8:** session export, backup and
restore, and the four packaging artifacts. All three were listed here when they
had no release; [work plan §0.5](01-work-plan.md) gave them one, and it is this one.

**One item here is a design dependency rather than a deferral.**
[13](../13-write-mode.md) is a 2.0 document, and export cannot freeze the turn
record until its §4 is settled. That does not put Write in this phase; it puts
*settling 17* on the critical path to a stage in it.

**And the one thing a hardening phase most wants to add and must not:** polish.
[polish-polish.md](06-polish.md) is a working todo list with its own bar, and its
items are user-facing, bounded, and need no schema change and no new contract.
Items graduate *out* of it when they clear the roadmap bar; they do not graduate
into a release gate because the gate happened to be open.

---

## 5. What only the revisit can settle

*Added 2026-08-31. §1.8 already sizes the three items 1.0 moved here and that
argument is not repeated; this is the rest of what the revisit owes.*

**The one structural question, and it should be asked first rather than
discovered:** does P11 split? §1.8 says a split is a finding rather than a
failure, and §0 says the audit is what produces the list — so the honest reading
is that **P11.0's output may be two phases**, and the revisit should decide in
advance what it would split *along*. The natural seam is already visible in the
stage list: P11.1 through P11.5 are product completion, and P11.6 through P11.9
are release engineering plus sweeps. Those have different audiences, different
kinds of done, and only one of them is what [releases §0](04-repo-and-releases.md)
requires for beta to count.

---

#### The seam, pinned 2026-09-16 — and it is not quite where this paragraph put it

***What the revisit was asked to decide in advance is the seam, not the split***,
and now that every stage carries a *Depends on* the seam can be read off the
dependencies rather than guessed from the headings.

**Ten of the thirteen stages depend on nothing.** P11.1, P11.2, P11.3, P11.4,
P11.7, P11.11, P11.12 and P11.0 are independent outright; P11.5 depends on a
person's time and P11.6 on a paragraph in [P10](27-p10-implementation.md), which
that phase has since answered. **Only two have a dependency inside this phase**,
and they are the seam:

- **P11.8** depends on everything that adds user-facing prose — the sweep run
  before P11.1, P11.3 and P11.7 is a sweep run twice.
- **P11.9** depends on everything, because it packages it.

***So the split is not P11.1–P11.5 against P11.6–P11.9.*** It is **everything
else** against **P11.8 and P11.9**, which is a much better-shaped cut than the
paragraph above proposes: the second half is two stages, both of which are
*about* the first half rather than beside it, and neither is a feature. **A
first phase that ships the product completion and defers the sweep and the
packaging is coherent**; the reverse is not, and neither is a cut down the middle
of the independent nine.

**Two consequences worth stating, because they decide whether the cut is
available at all.**

1. **P11.10 and P11.11 go in the first half**, despite being appended last.
   Export freezes the turn record and backup protects it; both are product
   commitments that [work plan §0.5](01-work-plan.md) moved *into 1.0*, and a
   beta that shipped without them would be beta by a different definition.
2. ***But [releases §0](04-repo-and-releases.md) requires P11.9 for beta to
   count***, which means the cut **cannot be a release boundary**. A first phase
   ending before P11.9 is a phase, not a beta. *So the honest form of the split
   is two phases and one release*, and saying that now is what stops a split
   being proposed later as a way to ship something sooner — which it would not
   be.

*What would move the seam:* a stage acquiring a dependency on another. Nothing
here has one today, and the *Depends on* lines are where anybody would see it
arrive.

**Three things the revisit cannot settle from this document and must go and
read:**

- ~~**[13](../13-write-mode.md), before session export is specified.** §1.8 makes
  this a hard dependency — the export format freezes the turn record, and 13 is
  a 2.0 document that has to be settled first. If it is not settled when the
  stage arrives, the stage blocks. Worth checking early rather than at the
  stage, because the fix is a design session and not a day.~~

  ***Checked early, 2026-09-16, which is what this bullet asked for*** (§0.2).
  [13 §4](../13-write-mode.md) is written through §4.8, states its decision as a
  rule, and §4.8 answers this bullet directly: *"§4 is settled before export's
  format is frozen, not after"*, with *"everything here is still free today."* The
  one `[OPEN]` inside it does not touch the turn record's shape. **So the revisit
  owes a confirmation, not a design session** — and the bullet's instinct was
  right, because checking it cost an hour and would have cost a stage.
- **[P2C log](14-p2c-log.md) and whatever PLAYABLE produced.** A hardening phase's
  real list is *what people hit*, and by then there will be two sources of that
  — the P2C sessions and everything since. An audit that reads only the code
  will find the defects nobody minded and miss the ones everybody did.
- **The other ten plans' §5 sections.** Every phase document now ends by naming
  what its revisit could not settle. Those are, collectively, a substantial part
  of what a hardening phase inherits, and reading them is cheaper than
  rediscovering their consequences.

**And one thing to resist.** A hardening phase attracts work that has no other
home, which is how it becomes the phase that ends when somebody gets tired.
§1.1's rule — *a list without owners never ends* — is the defence, and the
revisit should apply it to items this document has itself accumulated, not only
to ones the audit finds.

***And the hardest instance of that rule is now on the table*** — 2026-09-16,
§0.2's row 20. [P8](25-p8-implementation.md)'s **automatic extractor** was cut
deliberately, for a stated reason, on a fallback this project named in advance;
and P10 and P11 are the only later phases and **neither mentions it**. §1.1's rule
would eject it as a feature, and §0.1 already recorded that the rule's *"goes to
the roadmap or to a phase"* clause **has no destination when P11 is the last
phase**.

**So the revisit faces the rule's own unanswered case, on an item that costs a
gate rather than a feature**: two of P8's three criticals travel with the
extractor, so while it has no owner P8 is merged, open, and holding two rows
nobody can walk. The three honest answers are *P11 takes it and admits it is not
hardening*, *the roadmap takes it and 1.0's memory is manual capture on purpose*,
or *a phase is created for it the way [P7B](24-p7b-presets-and-prompts.md) was*.
**What is not available is leaving it where it is**, because that is the state it
is in now and it reads as a schedule.
