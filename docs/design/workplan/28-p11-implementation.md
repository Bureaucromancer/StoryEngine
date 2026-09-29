# 28 — P11 implementation plan

**Status: ~~skeleton~~ ~~a register, re-audited 2026-09-16 at `2f3f5d9`~~
~~a register with a costed stage list, fleshed out 2026-09-16 at `7c5e0bd`~~
~~built on branch `p10`, 2026-09-17~~ — **merged into `main` 2026-09-17 at
`b572c4c`, and open. Thirteen stages, and the critical list is unwalked.** Drafted 2026-08-29 alongside
[P7](23-p7-implementation.md) through [P10](27-p10-implementation.md); revisited
before the phase started, which is the one thing the old status line asked for
and got.

***The record is [§3.2](#32-what-was-answered--recorded-2026-09-17) and the list
is [sitting R](05-manual-testing.md)***, ~~five~~ **six** rows of which two are
desk work and one — R4, the 1.0 corpus read capability by capability — **is the
beta claim rather than a check on it**. *The sixth, R6, arrived 2026-09-22 with
[P11.2](#and-2026-09-22-a-hook-gets-somewhere-to-be-written-and-a-way-out)'s
hook addendum, which argues its three clauses.* *The thirteen gate rows above §3.2 are not edited*,
which is [manual testing §0](05-manual-testing.md)'s first honesty condition and
the whole reason there are two tables.

***Four things a 1.0 commitment asks for are not built, and they are named rather
than absorbed***: [10 §11.2b](../10-ui-surfaces.md)'s image slots,
[10 §11.2c](../10-ui-surfaces.md)'s entry travel, the assistant's docs lorebook,
and ~~**row 8's Playwright suite, which this gate assumed and no stage was asked
to build**~~. Three are features with an argument; the fourth was infrastructure,
and it was the one to argue about.

***~~Four~~ Three, since 2026-09-17: row 8 was built.*** Writing this record is
what found it, and what the record then said about it — *"the question this
document most wants them to arrive at deliberately"* — was answered by building
the thing rather than by arguing about whether beta could be declared without it.
The suite is `e2e/`, CI runs it as the `journeys` job, and
[§3.2](#32-what-was-answered--recorded-2026-09-17)'s row 8 carries what walking
the seven journeys turned up. **The other three stood**, and they are features
with arguments beside them, which is the shape this paragraph could not claim
while a fourth thing sat in it with no argument at all.

***None, by the end of the same day: [10 §11.2c]'s entry travel,
[10 §11.2b]'s image slots and the docs lorebook are all built.*** The first two
are [P11.2]'s Done block below and the third is [P11.3]'s. **The list this
paragraph existed to keep is empty**, which is what a list of named absences is
for — and none of the four closed by being argued about.

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

#### Done — 2026-09-17

**`route-callers.test.ts` lost its `GET /api/search` row**, which is the
mechanical half of this stage and the one that says the surface is *reachable*
rather than merely written. ***Nine phases outstanding, the longest a debt in
that map has ever stood*** — and it stood for a reason the map is the wrong
instrument to see: the route worked, its tests passed, and what was missing was
somebody to ask it.

***The fence is a directory scan, and it caught something before it was
finished.*** [§1.4](#14-the-reading-view-is-cheap-which-is-why-it-is-at-risk)
asked for *no cost, no token count, no model id, no block table anywhere in the
reading route's subtree*, and [`fence.test.ts`](../../../packages/client/src/reading/fence.test.ts)
is that as seven patterns over `packages/client/src/reading/`. **Its first run
failed on the reading view's own model**, which was called `ReadingBlock` — a
name that reads naturally and collides head-on with the workbench's *blocks*,
the assembled prompt fragments [10 §12.1](../10-ui-surfaces.md) forbids this view
from showing. The type is `Passage` now. *A word that means two things across the
boundary a design rests on is how the boundary gets crossed by accident*, and the
test refused the name before a person did.

***Two things the plan did not know it was asking for.***

- **Turn hits had no snippet.** [10 §14.1](../10-ui-surfaces.md) asks for
  *"results as a list of turns with a snippet"* and `searchTurns` returned a turn
  id. At six hundred turns that difference **is** the feature: a list of nine
  dates is a list of nine things to open, which is the scrolling §14 exists to
  prevent wearing a different shape. §14.5 makes the identical complaint about
  lore entries in so many words — *"close to useless at book scale"* — and that
  half was paid at [P5.2](17-p5-implementation.md) while this one was not, by
  nobody's decision.
- **The transcript route walked from the head and only the head.** §12.1's
  *"any node, not just the head"* is the bullet that makes this more than a print
  button, and it is one argument to `walkPath`. It is `?from=` on the route that
  already exists rather than a second route: *what differs between the two
  surfaces is what they render*, and a second fetch path would be a second place
  for the walk, the limit and the sibling map to drift. **A node the session does
  not have is a 404** — `walkPath` answers `[]` for an unknown id, which is
  indistinguishable from an empty session and would render as a blank page with
  nothing wrong.

***The print stylesheet is in `index.css` rather than on the route***, which is
the decision worth recording. §12.2 makes the browser's own print-to-PDF the
whole of the PDF story — *"shipping a PDF renderer would be real weight… for an
outcome the platform already gives away"* — so it has to be good rather than
present, and the chrome that would otherwise print is the **Shell's**: the
header, the navigation and the build footer are mounted around every page. A
reading view that hid its own controls would have solved the smaller half.
Landmarks rather than class names, so nothing has to be remembered when one of
them is restyled.

***And one coupling cost, paid rather than hidden.*** The way into the reading
view is a `<Link>` on the session panel, because §12.1 wants it *"openable at any
time on any session"* and so it renders unconditionally. Two component suites
mount that panel **without a router** — forty-two tests and eight — and `<Link>`
throws where `useNavigate` merely warns. *`MemoryPanel` has carried one since
P8.4 and never tripped it*, because its fixtures have no memory books; this is
the same latent coupling with a fixture that reaches it. Both files now replace
`Link` with an anchor, which is all either asserts about a link anyway. **The
alternative was driving the real router to `/play/$sessionId` in both and
rewriting every assertion around it**, which is a large change to prove something
no test there is about.

**The lorebook half is its own serialiser and that is deliberate.**
[10 §5.3](../10-ui-surfaces.md) is §12's argument on a second subject and shares
its *formats*, not its model: a session is a path through a tree and a book is a
collection with folders, and one serialiser over both would have a branch in
every function. [11 §3](../11-lorebooks-as-a-format.md)'s rule — *"raw is a claim
about the words, not about the layout; the reading view may re-arrange, and it
may not re-word"* — is asserted in both directions, and the *may not re-word*
half is the one a Markdown serialiser's instinct violates: **escaping somebody's
corpus is re-wording it under another name.** §5.3's *"no JavaScript in the
output"* fence is held structurally rather than by discipline — a function that
returns a string has nowhere to put a handler.

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

#### Done — 2026-09-17: the contract, and what is not the contract

***The assist slot has been empty since P1 and this is the stage that fills
it.*** `ui/Field.tsx`'s own docstring has said so the whole time — *"What P1
commits to is this component boundary, not the assist mechanism"* — and the
boundary is what makes this one edit rather than thirty.

***A context, not a prop, and that is [10 §11](../10-ui-surfaces.md)'s sentence
read literally.*** The section's requirement is that assist be *"a primitive the
editors are built from, so that 'does this field have AI assist?' is never a
question anyone asks"*, and **a prop is exactly that question** — asked once per
call site, answered by whoever was typing. So `EditorFrame` provides the slot
once and every `Field` inside any of the six has it. A field gains assist by
being in an editor and loses it by not being, which is also the right answer for
a login form, a settings control and a secret.

*What a field has to say for itself is its `path`* — the dotted key [10 §11.2]
keys the provenance map by — and a field without one gets nothing. That is a
fact about the field rather than a decision about the feature, which is the
difference between this and a `hasAssist` boolean.

***Two operations reach the server and two deliberately do not.*** §11.1 lists
four: generate, refine, revert, accept as-is. **Accept is the absence of a
control**, and that is the strongest available reading of *"nothing may require a
model call to proceed, ever"* — a button labelled *accept* would imply the value
is pending until blessed, which is the requirement rebuilt as an interface.
Aventuras has one because its assist is a step in a wizard; here the field is
just a field. **Revert is two buttons because §11.1 asks for two**: *before* is
the value the field held when the assist ran and lives in a ref, *generated* is
what the model wrote and lives in the file — one is about the last thirty
seconds and the other is about the object's history, and a button offering to
restore a value from a previous session would be offering to lose work.

***Provenance is Marinara's shape, adopted as §11.2 says to adopt it***, with
`unreviewed` cleared by the one event that means somebody looked: **an edit**.
Not a form-wide diff — a diff cannot tell a hand edit from a restore, a reapply
or a revert, and all three change the value without anybody having read it. So
the flag rides on the same context the slot does.

*The map is held by `useObjectEditor` rather than by six form shapes*, and
assigned over `apply`'s output in one place. `generated` is keyed by dotted path
and is a fact about the **object**; six forms carrying it would be six chances to
get the merge-on-save subtly different.

***The paths are ids, never indices***, in the three places a list is involved —
an actor's sections and samples, a preset's blocks, a book's entries. All three
are reordered by design ([10 §11.2c] makes reordering entries an ordinary
action), and an index-keyed record would attribute one entry's generated prose to
whichever entry took its place. **That is worse than no provenance, because it
reads as an answer.**

***The obligation is a loop and it found nothing***, which is worth saying
plainly: `editor/contract.test.tsx` runs over `LIBRARY_KINDS` and asks each of
the six for assist, disclosure and history — and every one answered on the first
run, because the frame is the thing that changed. *The value is in what it
refuses next*: a seventh kind with an editor and no affordance, or a `Field` that
lost its `path`, which typechecks, lints and silently removes the control. One
round trip is driven end to end beside it, because *the control is there* and
*the feature works* are different claims and the loop only makes the first.

---

***What this stage's opening paragraph names and this does not build***, stated
here rather than discovered by a reader of the gate:

- ~~**[10 §11.2b]'s image slots.**~~ ***Built 2026-09-17.*** §11 lists *"every
  image slot can be generated, uploaded, cropped and replaced"* as the second of
  its two capabilities, and §11.2b is the lorebook half of it — a gallery on the
  book, a strip on each entry. Its own text removes the *generated* arm from this
  phase — *"**No assist.** Generating a location image is a rendition… so it
  arrives with them and not before"*, which [P9](26-p9-implementation.md) has now
  shipped — and leaves upload, crop and replace.

  ***It was unreachable rather than unbuilt***, which is what building it found.
  `EmbeddedMedia` is a reference to bytes *the container* carries, and this build
  had **one** container that carries them: a PNG's blob chunk. A lorebook is
  `lorebook.json` in a folder, so `readMedia`'s `codecFor` returned null for one
  and every read ended at *"that object is not in a container that carries
  media"* — while `assetsRoot` had sat in `layout.ts` since P1 with nothing ever
  writing to it. `library/assets.ts` is that container, and
  [04 §5](../04-schemas.md) had already said where it goes: *"bulk, in the folder
  rather than the manifest … a layout that already listed
  `lorebooks/<slug>/lorebook.json + assets/`"*.

  ***Two decisions are worth reading before the code.*** Assets are
  **content-addressed**, so the same picture twice is one file and an orphan is
  detectable — a file whose digest no manifest row carries — which is what makes
  the sweep on save possible at all. And the upload route **stores bytes without
  touching the object**: the gallery and each entry's strip are different arrays,
  only the form knows which one a row belongs to, and a route that decided would
  write the object behind the editor's draft.
- ~~**[10 §11.2c]'s entry travel.**~~ ***Built 2026-09-17***, after the record
  named it: selection on the entry list, *Export selected*, *Import entries…*,
  and the review that goes with a merge. `editor/entry-travel.ts` is the model
  and `EntryTravel.tsx` the surface. **Three decisions are worth reading before
  the code**: an entry export **is a lorebook**, so there is no fragment schema
  and nothing new to version, and the way in is the way in for any book anybody
  downloaded; the folders above a selection travel and the rest do not, because
  *"a dozen entries arriving flat at the root have lost"* a shape the author
  gave; and a merge **adds and never overwrites** — an id that collides takes a
  fresh one and the collision is *reported*, because *"two books hold entries
  under the same id precisely because one was copied from the other, which makes
  id equality a sign of shared ancestry rather than permission to overwrite an
  edit."*

  ***And it gave `VersionSource`'s `import` arm its first writer.*** §11.2c says
  the book's own history is the record of the import, *"so the merge goes
  through the same write path as every other edit"* — which turned out to need
  exactly one optional field on the library PUT, `importedFrom`, and nothing
  else. `history.ts` has carried `{ kind: 'import'; from: string }` since P1
  under the note that *"`assist`, `extension` and `import` have no writers until
  their phases, but the type is the contract"*; this is that phase for the third
  of them, and the contract held.

  ***What is deliberately still absent is §11.2c's media clause***, and it is
  absent because [§11.2b] is: *"entry media, in whichever container the book
  itself would use"* has nothing to carry until entry media exists, so
  `selectionAsLorebook` clears the **book's** gallery rather than pretending to
  select from it, and says why.

  *Corrected 2026-09-27:* ~~has nothing to carry until entry media exists~~ —
  it existed from `80bc80c`, the same day, and an export then carried entry
  picture rows without their bytes. The rows now stay behind and the export and
  the import review both say so ([10 §11.2c](../10-ui-surfaces.md)); the clause
  waits on the zip container.

**Neither is in *Ends at***, which reads *"every editor offers assist,
provenance and history, and a collapsed section names what inside it is not at
its default"* — and all four of those are true. The fourth was already true:
`summaryOf` and `groupSummary` have carried [P5 §2](17-p5-implementation.md)'s
refused cut since P5 and P7B, and `entry-defaults.test.ts` asserts it. *Recording
the two gaps against the gate rather than against this stage is the honest
filing*: they are section commitments this stage did not reach, and
[§3](#3-verification--the-p11-exit-gate)'s row 12 is where a phase claiming
feature completeness has to answer for them.

#### And 2026-09-22: a hook gets somewhere to be written, and a way out

***The deferral this stage was named in [P7 §1.5](23-p7-implementation.md)
outlived the Done block above by five days.*** That document recorded *"a hook
has nowhere to be authored"*, listed what it would take — *"either P7.5 inherits
an editor… or the whole stage is exercised through hand-edited JSON"* — and
deferred it to the editor sweep, which is this stage. The sweep ran on
2026-09-17 and the deferral did not come with it, and **the reason is worth more
than the fix**: *editors are not dumb forms* was read as a claim about what every
editor **offers** — assist, provenance, history, a loop over `LIBRARY_KINDS` —
and a hook is not an affordance a form offers, it is a **field that had no
control at all**. The loop found nothing and was right to: what it looks for is a
`Field` that lost its `path`, and `hooks` had no `Field` to lose one. So this is
[§3.2](#32-what-was-answered--recorded-2026-09-17)'s general claim arriving a
second time — a thing carried because nobody had written down that it was
missing, found by writing the record rather than by running the check.

***The observation that started it is not the one that was acted on.*** What was
noticed is that plot hooks read as a **session-level feature**, and the answer to
*what object should they attach to* turned out to be the one
[03 §4.1](../03-data-model.md) had written down from the beginning: four sources,
three of them portable carriers, Treatment the default. **Nothing about the
attachment was changed.** What was built is the two things that would have made
that true and never existed — a way to write a hook onto a carrier, and a way for
a hook to leave the session it was realised in.

**One editor, mounted three times.** `editor/hook-form.ts` is the model — pure
functions over a `Draft`, returning new objects, the shape `book-form.ts` set —
`HookFields.tsx` renders one hook from the schema's own shape the way
`EntryFields.tsx` does, with everything the switch does not own rendered
**read-only rather than invisible**, and `HookList.tsx` owns the list, the
create, the delete, the reorder and the actor options it fetches itself. A caller
mounts it with two props. The three carriers take it in [03 §4.1]'s own order of
preference, and the lorebook's is kept **visibly secondary in the layout**:
*allowed, secondary, and for hooks genuinely inseparable from a piece of lore* is
a sentence that erodes first in a layout giving it equal billing to the entry
list.

- ~~`readOnly.hooks` on `TREATMENTS`~~ — *"Hooks are authored in the session's
  hook panel. Shown here as stored."* — is deleted. It was the most honest line
  in the editor for as long as it was true.
- **Absent is not empty**, and it is the one thing that is not generic over the
  three: `Treatment.hooks` and `Setup.hooks` are required, `Lorebook.hooks` is
  optional, so `withHooks` leaves an absent key absent when the list it is given
  is empty and keeps a present one as `[]`, while `withOptionalHooks` beside it
  takes the key back off a **lorebook** whose last hook is removed. Both live in
  `hook-form.ts`, which is the repair of a first draft that had the deleting half
  written into the lorebook page: two callers needed it — the fold and the 412
  merge — and a rule stated in two places is a rule that gets two answers. That
  is `setSessionHooks`'s rule for the session's pool, arriving at the carriers.
- ***And the same distinction inside a hook***, which the first draft got wrong
  in the other direction. `newHook` leaves `blockedBy`, `notBefore` and
  `introduces` **unset** and argues why — *a hook that has never been given an
  eligibility filter says nothing about one* — and the controls that set them
  have to be able to get back there, or clearing a turn floor leaves
  `notBefore: {}` in the portable file, every export of it and every diff,
  forever. `patchHook` takes `undefined` as *remove the key*, so all three clear
  to absence through one mechanism rather than one of them through a bespoke
  function and the other two not at all.
- ***A hand-edited `hooks` refuses the editor rather than the application.***
  The page's guard checked `name` alone and said why: everything else went
  through `SchemaFields`, which draws a value of any shape. `HookList` does not —
  it walks a keyed list, keys each card on `hook.id` and names every control from
  `hook.title` — and with no error boundary anywhere in `packages/client` a throw
  in there is the **whole application**, which is the one answer
  `lorebookShape`'s own docstring forbids a surface to give a hand-edited file.
  Both guards now check the field, through one shared `hookShape`, and a bad file
  falls to the *unopenable* panel that names the problem and points at it.
- **The 412 merge acquired the keyed list its own comment said it lacked.**
  `descriptorFor`'s `reapply` merges a conflict field by field, and the comment
  beside it explains why the entry and block editors merge differently:
  *"because those two have a keyed list where which one did I edit is
  answerable. These do not."* ***After this stage they do***, so `hooks` merges
  hook by hook. Left alone, the first conflict on a treatment with hooks would
  have taken one side's whole list, silently, which is the failure that comment
  was written to prevent one editor over. ***And the lorebook's merge got the
  same treatment***, which the first draft left out: `reapplyBookEdits` stripped
  only `entries` and `folders`, so the third carrier — the one this change had
  just made writable — kept the coarse rule and would have dropped a promoted
  hook on the first conflict, inside the dialog whose entire offer is *reapply my
  edits*. The keyed three-way walk is one `mergeKeyed` in `book-form.ts` with a
  per-item resolver, because it had been written once for entries and copied for
  hooks, comment included, and a fix to the
  `pristine`-distinguishes-delete-from-addition rule would have had two homes and
  one of them forgotten.
- **`plotHookSchema()` and `choicesOf()` in `library/fields.ts`**, the first
  beside `loreEntrySchema()` for its stated reason — one walk from a carrier's
  schema to a hook's, rather than one per surface. ***The second is a finding
  rather than a helper.*** A TypeBox union of literals emits as `anyOf` of
  `const`s **with no top-level `type` keyword**, so `SchemaFields`' `controlFor`
  falls through to choosing by value and a closed three-way union renders as a
  free-text box. **`Treatment.hookPacing` is that box today** — the authored
  default [04 §6.1b](../04-schemas.md) writes, over the four levels
  [25 C7e](../25-open-questions.md) spent a paragraph settling — and it is now
  one call away from not being. *`positionOptions` in `EntryFields.tsx` was
  rewritten onto it in the same change*, because a helper introduced on a
  no-duplication argument that leaves the duplicate it names standing is the
  argument made rather than taken.

**The promote route, and it is a route because it cannot be anything else.**
`POST /api/sessions/:sessionId/hooks/:hookId/promote` ([api.md](../../api.md))
copies a pooled hook onto the treatment, the Setup or one of the session's
lorebooks. The panel could not have done it as a read-modify-write: `hookRows` is
a **redaction** — `premise` only once a hook is spent, `entrances` by label and
never by text, and `involves`, `weight`, `delivery`, `once`, `notBefore` and
`blockedBy` never sent — so a client-side copy would have required handing the
panel an unfired premise, which [08 §6](../08-cross-session-memory.md) and
[10 §10.1](../10-ui-surfaces.md) forbid by name. **The redaction was built
against rather than undone**, which is the interesting half: a rule that the next
feature has to spend was never a rule.

- **The id survives and a collision is a `409`**, never a second copy and never a
  re-mint — [15 §5.1](../15-world.md) is the only reason this is not a
  preference, and pressing the control twice is an ordinary thing to do because
  the first press leaves the panel row looking exactly as it did.
- **The session is not touched.** The pool entry keeps `source: { kind:
  'session' }`: re-attributing it would claim the target owns the running copy,
  and for a lorebook target it would silently add *eligible only while that book
  is active* to a hook that never had that clause.
- **The target's history is the record of the promotion**, through the existing
  `manual` attribution with a reason naming the session rather than an eighth
  `VersionSource` arm. The **conclusion** is
  [10 §11.2c](../10-ui-surfaces.md)'s, read one kind over — *the book's history
  is the record of the import* — and the arm this one would have sat beside,
  `memory`, was named separately because *who changed my character* has
  different answers for *an extension did* and *a session did*. A person
  pressing a button is neither. ***What is not taken is §11.2c's mechanism***,
  and that is stated rather than stepped around: the section's rule is
  concretely `source: "import"` *naming what came in and from where*, and that
  arm exists and got its first writer one stage over. It is declined because
  `import` here means content arriving from **outside** the library, which a
  promoted hook is not; the cost — `manual` plus prose is not queryable — is
  named in `sessions/promote.ts` and in [api.md](../../api.md), with an eighth
  arm as the honest repair if the query ever arrives.
- **On the panel, not in the workbench.** [10 §10.1] splits the two controls it
  already had by *a move in the story* versus *a test of the material*, and
  promotion is neither; it is an act on the library performed while playing, and
  it belongs where the hook somebody wants to keep actually is.
- ***The targets are the three carriers the session names, and all three are
  offered whether or not they already carry a hook.*** The control joins
  `session.treatment`, `session.setup` and `session.lore` with the sources the
  pool's own rows report, because neither half alone is enough: a Setup or a
  lorebook with no hooks seeds no row while being a perfectly good place to put
  one — and a Setup with no hooks is what a Setup looks like before anybody has
  written one, so leaving it to the rows would have made *can I save a hook here*
  depend on whether a hook was already here. `SessionSummary` gained `setup` for
  it, on the terms that interface already sets: the route has been sending the
  whole session file all along, and only the field a client has a use for is
  claimed.
- ***And the request names the row rather than the hook id***, because `poolFor`
  refuses to de-duplicate by id — *the same hook reaching a session through two
  sources is a real authoring situation* — so two rows can share an id, carry
  different content, and each draw their own control. The row's `source` travels
  with the request; without it the handler copies the first match, and the 409
  above then refuses every later attempt, so the hook somebody meant could never
  reach that object at all.
- ***`412 stale` does not pass through to this caller.*** Every other library
  refusal goes through the shared mapping, which is right for each of them; that
  one attaches `current`, the whole target object, so an editor can offer
  reload-and-reapply — and here that object is every **unfired** premise and
  entrance text on a treatment, sent to the play client through the error path of
  the route whose entire reason for being server-side is that redaction. It
  answers `409 target-moved` with no envelope, and nothing is lost: the client
  never held the hook, so it has no edits to reapply.

**The reference edges hooks had never had.** `index-db/links.ts` read no hook
field on any carrier and returned `[]` outright for `LOREBOOK_SCHEMA`, so an
actor named only by a hook read as **used by nothing** — through
[03 §10.1](../03-data-model.md)'s count-before-you-delete and the object page's
*Used by*. Harmless while hooks could not be authored; not harmless afterwards.
Both hook fields are read on all three carriers now, and ***the lorebook arm's
old argument was kept rather than replaced***: *a lorebook's entries and a
preset's blocks are inside the object* is true, and it never covered
`introduces.actor`, which points outward. The preset's arm still returns `[]`
with the half of the reasoning that survives intact.

***And `INDEX_SCHEMA_VERSION` went to 9 with it***, which is the half that would
have made the rest inert. What changed is not the index's shape but what is
**derived** into `object_link`, and `migrate` returns `rebuildRequired: false`
whenever the stored version already matches while the watcher starts with
`ignoreInitial: true` — so nothing re-ingests a file that has not changed, and an
upgraded install would have gone on answering *Used by* with **zero** for an
actor a hook names until somebody happened to save the object for an unrelated
reason. Version 4 is the precedent the constant's own docstring records, and it
was bumped for exactly this: *not a change of shape but of what `path` contains*.
The index is derived and disposable, so one rescan is the whole cost.

***What was not built, named here rather than left to a reader of the gate.***
[04 §9.1](../04-schemas.md)'s export-closure walker still does not exist —
`packaging/export.ts` resolves one level, a package's declared `contents[]` — so
what this change owed it is the **table row**, which is precisely what
[P7 §1.5] said P7 *"can, and must"* do and P7 did not: *"a walker built later
against the table as it stands is precisely the 'only follows `cast`' walker the
row exists to fail."* The three hook rows are written, and the Lorebook row is
the first outbound reference that table has ever recorded for a book.

**Two stale comments found on the way, and one of them ships.**
`shared/src/schema/hook.ts` said the removed `requires` and `onFire` vocabulary
*"is 2.0"*; [25 C7](../25-open-questions.md) re-scoped it to the **6.0 authoring
tier** ([work plan §0.6](01-work-plan.md)) and the string is a TypeBox
`description`, so it was emitted into three portable schemas and shipped in the
build. `play/HookPanel.tsx` said *"there is no treatment editor and no setup
editor"* — [P7B](24-p7b-presets-and-prompts.md) built both, and this stage gave
the sentence its own refutation. **The two-field add form is unchanged**:
[P7.5]'s argument survives the editors existing, because the panel is *the
sentence the feature exists for* and not an editor. What changed is that it can
now say where the other six fields live.

***And the documents, which is where the change started.***
[03 §4.1](../03-data-model.md)'s **[OPEN]** on hook packs is closed — against
[25 C7b](../25-open-questions.md), which had already declined them flatly, so two
documents had been disagreeing about the same decline — and the decline is
recorded where the question is asked, with the positive half it never had: the
three carriers, promotion out of a session, and a **Treatment carrying only
hooks** as the shareable artifact, on exactly [10 §11.2c]'s *an entry export is a
lorebook* argument. The one place hooks are **not** like entries is named there
too, because it is what an implementer would get wrong by analogy: an entry id is
book-local and re-mints on collision, a hook id may never be.

***And §4.1 was carrying its own version of the stale comment above.*** Both of
its opening lines still listed `requires` and `onFire` among what a hook carries,
and one of them described [04 §6.1](../04-schemas.md) as defining them *"typed
against the unstable rule vocabulary"* — which §6.1 stopped doing when it removed
them. **The same drift twice in one change** — `hook.ts`'s description above and
these two lines — is the argument for reading the section rather than the
paragraph: the schema and the data model had each gone on describing a field set
that stopped existing when the vocabulary went to 6.0, and neither was going to
be corrected by anything but somebody working nearby.

***The walk is owed, and it is not recorded in
[§3.2](#32-what-was-answered--recorded-2026-09-17).*** This is
[manual testing §0](05-manual-testing.md) critical-list material, and the
criterion is *all three* clauses rather than the first one, so all three are
stated. **(i)** it can falsify this stage's own claim — a hook that cannot be
written on a carrier, or cannot be saved back out of a session, is P11.2's
editor sweep not having happened for the field it was deferred over. **(ii)**
what this gate compounds into is the **beta declaration** rather than a later
phase, which is [§3.1](#31-the-critical-list-and-what-a-test-answers)'s P11-specific
re-reading of that clause. **(iii)** it is walkable with what is to hand — one
`pnpm dev` sitting, no live endpoint and nothing on the standing-prerequisites
list.

***And it is a row rather than a paragraph.*** It is
[sitting R](05-manual-testing.md)'s **R6**, written into the standing document
where the pile is meant to be visible — because a deferral that lives only
inside a phase document is [manual testing §10.1](05-manual-testing.md)'s own
failure mode, *"a deferral nobody collects is not merely lost; it stops being
read"*,
and the person who sits down to close P11 reads R. *Recording the **result** in
§3.2 before it is walked would spend that table's whole reason for existing on
the first occasion it was inconvenient*, and the thirteen rows in §3 are
untouched either way.

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

#### Done — 2026-09-17

***"It is a session, in a mode, with an actor card. That is the whole design."***
[06 §7.4](../06-modes-and-turn-pipeline.md) says it in one sentence and the
interesting thing about this stage is how much of it turned out to be literally
true: `packages/modes/assistant` is a mode package with one dependency, and
`AssistantPanel.tsx` renders **`PlayPage`**. Everything in §7.4's table of what
*applies unchanged* — streaming, reconnection, the turn record and the workbench,
rewrite and reroll, the guidance box, branching, notifications, per-user
ownership — is there because it is the same component, not because it was
re-implemented carefully.

***The proof obligation is that sentence inverted, and it is mechanical.*** §7.4:
*"If building the assistant requires a parallel chat implementation, something in
the mode contract is wrong."* `tools/repo-shape.test.ts` holds it from both
sides: the panel **imports and renders** the play surface, and its directory
contains no `<textarea`, no `submitTurn`, no stream and no `EventSource`. *That
is a claim about code shape rather than behaviour, which is why the obligation
named this file rather than a component test* — a passing assistant built the
wrong way would satisfy every behavioural test and fail this one.

***Ambient context is a channel with a budget, and that is the whole
implementation of "disclosed".*** §7.4 asks for two things in two sentences:
*"That context is a block the client contributes, and it must be visible in the
turn record like any other block."* A `user-only` channel with a non-null budget
**is** a block the client contributes: the pack positions it, the assembler
renders it, the workbench lists it in the block table beside everything else.
**`budget: null` would have been the unsettling version** — an assistant that
knew what was on your screen and never said so — and it would have looked like a
smaller declaration rather than a different feature. [10 §7](../10-ui-surfaces.md)
asks for the other half, *"on screen, not just in the turn record"*, and that is
the line at the top of the panel.

*The context is derived from the **address** rather than pushed by each page*,
because the address is already the app's statement of where you are and is
maintained whether or not anybody is thinking about the assistant. The cost is
written down: what it can say is what the URL says.

***Propose, then apply, through the ordinary channel path.*** §7.4: *"Every
mutation is a reviewable diff, not a silent write… an assistant quietly
rewriting your own work is the fastest way to stop trusting it."* A `post` step
writes `se.assistant.proposal` as a `model-proposed` effect — so a proposal is on
the turn, in the workbench, reversible by branching — and the panel reads it back
off the transcript it was already reading. **Nothing in the mode package can
reach a file**, which its single dependency makes structural. Applying is an
ordinary library write the **person** makes, carrying `GeneratedFieldProvenance`
exactly as [P11.2]'s field assist does, which is what §7.4 asks for by name:
*"so 'the assistant wrote this bit' stays answerable later."*

**Two refusals inside that are worth naming.** The proposal is applied against
*the object as it stands now*, not against what the model was shown, because
minutes may have passed and the honest question is whether you want this change
to the file you have. And **a dotted path the object does not have is not
created** — inventing structure because a model named it would be the silent
write arriving through the one door that stayed open.

***The card ships from the server and names no mode***, which is the test of
whether §7.4's *capabilities belong to the mode, personality to the card* split
is real. `assistant-card.ts` is an ordinary actor in the system library, beside
the packs and under the same four rules; pointing a story session at it produces
a strange but working character, which is §7.4's own *"point it at a roleplay
character for fun and it still works"* read in the other direction.

*It cost eight test edits, and they were improvements.* The shipped card made
`actors` non-empty for the first time, so assertions reading *the library is
empty* and *`objects[0]` is the one I imported* stopped holding — and both were
always saying something slightly wrong. `ownObjects` already existed for exactly
this and now says what those tests meant: **the user's** library.

***Starter prompts are a `PlayPage` prop, not an assistant component.*** §7.4
calls them *"the main thing standing between a blank assistant box and people
actually using it"*, and the same reasoning that makes the assistant a session
makes this an affordance of **sessions**: a story mode that wanted openers on an
empty session would pass the prop and get the same control. They fill the box
rather than taking a turn, which is `Suggestions`' rule beside them.

---

***What §7.4 asks for and this did not have: the docs lorebook.*** *"Docs
retrieval needs no new machinery. Ship the documentation as a built-in lorebook
and attach it to the assistant. Keyword activation plus the budgeter already do
the work."* ~~**The machinery is here and the corpus is not**: the pack positions
a `lore` slot, the retriever runs, and no book is attached.~~ That was a corpus
problem — turning a design corpus into keyed entries somebody would want
retrieved — rather than a mechanism one, and shipping an empty book to close the
row would have been the placeholder shape this phase has refused at every stage.
*It was the one thing between this assistant and the one §7.4 describes.*

***Written 2026-09-17***, and *"needs no new machinery"* turned out to be exactly
true: `docs-lorebook.ts` ships twenty-five keyed entries in eleven folders,
`system-library.ts` materialises it beside the assistant card under the same four
rules, and the attaching is **one line** — `lore: [DOCS_LOREBOOK_ID]` on the
session the panel creates. No route, no retriever, no slot.

***What the entries are is the part that took the time.*** The design corpus is
reasoning about decisions; an entry here is an answer to a question somebody
types at three in the morning — *why does my lorebook entry never fire*, *which
model answers*, *what does scan depth count* — and the keys are the words they
would use **including the wrong ones**, because a key that only matches the
correct term only helps somebody who did not need help.

***Three settings on the book are the whole of "the budgeter already does the
work".*** `scanDepth: 4`, because a follow-up question names none of the original
words; `entryLimit: 4` and a token budget, so documentation cannot eat the
conversation it is helping with; and `recursiveScanning: false`, because these
entries cross-reference each other constantly and one question would otherwise
pull in half the book.

***And a corpus needs an instrument, because a type cannot check one.***
`docs-lorebook.test.ts` refuses an entry with no keys, an entry filed in a folder
that does not exist, a folder holding nothing, a book whose own gates are shut,
and **two entries claiming the same key** — which is the defect that is invisible
and expensive, because both fire on the same question and the budgeter then drops
one by a priority nobody set. It found one on its first run: *restore* meant both
the trash and a backup. `repo-shape.test.ts` holds the other seam, the id written
out in two packages that cannot import each other.

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

#### Done — 2026-09-17

**The whole feature, because [§0.2](#02-re-audited-2026-09-16-at-2f3f5d9-after-p7b-p8-and-p9)
established there was no half to inherit** — P7 took none of it and the word
appeared in no package.

***§3.1's three details are not all satisfiable by one implementation, and the
tension is the decision this stage makes.*** It says both of these:

- *"It is a draft, not a commitment. The output lands in the input box,
  editable, and is not sent until the user sends it. **Anything else takes
  authorship away rather than assisting it.**"*
- *"It is a `generate` step like any other, so it is **recorded in the turn
  record** and rewrite/reroll apply."*

**A draft that commits a turn is not a draft.** The first is the one §3.1 argues
for rather than merely states — *takes authorship away* is the sentence the
feature is measured against — so nothing is committed, and the second's two
promises are kept the two ways that remain. *Recorded* is the job log, which
carries this call the way it carries every other. *Re-rollable without ceremony*
is pressing the button again, which is the literal reading and what a person
dissatisfied with a draft actually does.

*The alternative is written into the code so it can be re-argued rather than
rediscovered*: a turn committed off the path, which would put the draft in the
workbench with its prompt and its block table. That is a real gain at a permanent
cost — **every impersonation would leave a sibling in the tree**, visible to
`readTranscript`'s sibling map as a line the player might have taken and did not.
A feature for when you are stuck should not make the tree noisier the more you
use it.

***Built on `preview.ts`'s gather rather than on the runner***, which is
[P3 §1.6](15-p3-implementation.md)'s seam used for the second time: that file
exists because *assemble-without-dispatch* is worth having, and this is the same
seam with a dispatch on the end. The runner commits, advances a head, writes
segments and announces — every one of which is what a draft must not do. **The
retriever's effects are discarded**, and it matters more here than in a preview:
a draft that advanced a lorebook's cooldowns would change the turn the person
then sends, which is the turn they wanted the draft *for*.

***The proof obligation is the block, not the prose.*** §3's row asks that *"the
persona's card is present as the thing being written **as**"*, which is a claim
about the assembled prompt — and it is the half a behavioural test cannot see: a
call that lost the instruction still returns prose, and the prose is the
narrator's. So the instruction is a **required** candidate, appended the way
`schemaInstruction` is appended and for its reasons, and a test holds it to
naming the character, forbidding narration of anybody else, and explaining itself
to whoever reads the block table.

*(2026-09-27)* **Built on the gather, and assembled as a narration all the
same.** The draft was collected and retrieved under the prose step's own call
kind, `narrate`, so the shipped narrator instruction — *never write the player's
own dialogue, thoughts or decisions* — was in every draft's prompt beside the
instruction asking for exactly that, and a pack's own impersonation block
([04 §8.4.3]'s `impersonation_prompt`, scoped to `impersonate`) was in none. And
the draft resolved its model without the session's own overrides, so a session
pointed at its own endpoint drafted on the account default's. A draft is now
collected and retrieved as `impersonate`; Scene's and Freeform's narrator
instruction applies to `narrate` only in the packs they ship, and because a
session keeps the pack it was created with, the impersonation instruction says
outright that a narrator's brief above it does not apply. The preview and the
draft take the model's layers and the collector's gather-side input from the
same two functions the runner does (`roleLayersOf`, `collectFor`).

**The party line is enforced at the door.** [06 §8] calls the difference between
a companion and a second player *"the 'we are not building a D&D engine' line"*,
and `readParty` is reused rather than re-derived — it already knows a session's
persona is `player` without a channel write, which is the case every ordinary
session is in. *Naming another member is allowed*, because §8's *"more than one
member may be `control: 'player'`"* is the same sentence read forwards: a draft
affordance that could only speak for one of a pair would refuse half its own
reason to exist.

*One thing the route does differently from its neighbours*: **it is not refused
while a turn is in flight.** A submission is refused because two turns on one
session is what [P2 §2.10](08-p2-implementation.md) exists to prevent; a draft
commits nothing, and the moment somebody most wants one is while they are reading
what just arrived.

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

#### Half done — 2026-09-17: the part that was never tuning

***The third row of the table above was not a tuning item and this stage said
so***: *"A pack block that does not exist cannot be worded better by playing; it
has to be written first, and writing it is a small build inside a stage that says
it is not a build stage. Naming it here is the point — otherwise the stage
arrives, discovers a missing block, and either grows silently or drops the half
of §1.7 that is about **wording**."* It arrived, the block was missing, and this
is it written rather than either of those two outcomes.

**What was actually broken is worth stating plainly, because it had been true
since [P7.5](23-p7-implementation.md).** [06 §6.1](../06-modes-and-turn-pipeline.md)
splits the dial in two — *"Level → cadence, cooldown and patience is engine code;
the level's prose is the prompt pack's"* — and only the engine half existed. So
**`sparse` and `aggressive` put the identical question to the model** and
differed only in a cadence the model could not see. Four levels producing
recognisably different sessions, which is this stage's *Ends at*, was not
something play could have discovered: there was nothing to discover.

***`Preset.pacingLevels`, and it is not a third dial.*** The shape is the one
[06 §7.3.1](../06-modes-and-turn-pipeline.md) gave difficulty and
[P7.8](23-p7-implementation.md) gave directedness — a named level with ranked
fragments, selected by a dial, replaceable by whoever ships the pack — because
that argument transfers whole and a third literal shape for one idea is a third
thing for an author to learn. **What does not transfer is the axis.**
[23 §5.4](../23-randomizers.md) is explicit that a frequency dial stays a
*separate channel* from difficulty, *"because folding* how often *into* how
hard *rebuilds exactly the conflation [06 §7.3.2] exists to prevent"* — so
`DialAxis` did not grow an arm, `dials.ts` still reads two, and
`dials.test.ts`'s *three dials and not two* still passes unchanged. **One sort
crosses the line and nothing else**: `levelFragments`, which is a fact about the
data shape rather than about either control.

*`hook-selector.ts`'s own guess is corrected in place rather than quietly
replaced*, because it was wrong in an instructive direction: it said the prose
*"arrives as an ordinary block when the pack grows one"*, and an ordinary
`PresetBlock` cannot vary by level — one template, one `appliesTo` — so a pack
would have shipped four blocks with nothing to choose among them. The half that
held is the record: it reaches the call as `se.hooks.select.pacing`, an ordinary
block in `request.calls`, visible in the workbench like any other.

***No floor, where a difficulty dial has one***, and this is the decision most
likely to be re-litigated. `resolveLevel` falls back to the pack's gentlest
entry because a session runs at **a** difficulty whether or not anybody chose
one. Pacing is not like that: `manual-only` is a real setting meaning *no
judgement at all*, and a pack that ships three levels and not the fourth has said
something about the fourth. Putting `sparse`'s words on an `aggressive` session
would leave the prose arguing with the cadence, which is worse than silence.

**Both built-in packs ship all four, and `mode.test.ts` in each refuses a pack
that does not** — a missing level is the failure that looks like nothing: the
resolver returns null, the block is omitted, and the setting silently goes back
to meaning only a cadence. *The same test watches the top of the dial for
compliance language*, which is §6.1's own warning — *"`aggressive` must not reach
railroading… none of them makes the narrator comply"* — and is a crude check
kept because the top of the dial is exactly where a later edit will be tempted.

***What is still owed is the stage's actual subject, and it has not moved.***
Four numbers, one constant, and the wording of what is now four levels of real
prose, all of which want a live endpoint and hours of play. That is
[sitting G](05-manual-testing.md), walked with PLAYABLE's fourth hypothesis, and
this stage's *"honest answer to §1.1's rule"* stands: no proof obligation, a
written result instead. **What changed is that the sitting is now possible.**

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

#### Done — 2026-09-17

**The error messages alone, as [§0.3](#03-re-audited-2026-09-17-at-f0b19ba-after-p10)
established.** P10 took the check, the badge and the conditionality; the two
`'unread'` keys left the tier with it, so the *Ends at* clause about them was
already discharged before this stage opened. What was left is what
[P10.3](27-p10-implementation.md) named and did not build.

***The defect was worse than the plan's wording implies, and finding that out is
most of what this stage did.*** §1.6 anticipated *a raw DNS or TLS error*
reaching a person. What actually reached them was **our own vocabulary**: the
play surface rendered `The turn failed (transient)`, and the notification body
was `{sessionName} — {error}` over the same union. *`transient` is a word about
our retry ladder.* The comment beside that notification template defended it as
*"the class, not a sentence: `rate-limit` and `no-binding` are words the reader
can act on"* — **and named a vocabulary that does not exist**;
{@link StepFailureReason} has never had either word in it. A sentence that
defends a decision by describing something else is the same failure
[P11.0](#p110--the-audit-that-makes-the-list) spent its day on, arriving from
inside the code this time.

And the transcript, which is where a person actually looks, said
`This turn did not finish.` — a fact with no remedy attached, which is
[09 §6.5](../09-server-multiuser-deployment.md)'s complaint verbatim.

***`FailureRemedy` is a second axis rather than a replacement.*** The class says
what the engine did and belongs on the record; the remedy says what a person
could do and is **derived, never recorded** — two of its three inputs are facts
about *now*, and a turn record storing last Tuesday's connectivity would be
claiming it as part of what happened. So a remedy travels on the live event and
the notification, and [P11.10](#p1110--session-export-and-the-format-it-freezes)'s
format never sees one.

***It lives in `shared` because it has two callers on opposite sides of the
wire***, and that is the decision worth recording. The runner derives a remedy
while the failure is fresh and holds every input; **the transcript derives one
for a turn that failed last week and holds only the class.** One function
answering both is what stops the two surfaces describing one failure
differently — which is the defect this stage set out to fix. The optional
inputs are how the same function serves a caller that knows less, and every
absent one degrades towards *saying less* rather than towards guessing:
`endpoint-silent` exists precisely so a reader cannot round *nothing has looked*
up to *your internet is down*.

***The order of the questions is the whole of the conditionality.*** A dead
container on `localhost:11434` and a severed uplink produce the identical
`ECONNREFUSED`, so locality is asked **before** connectivity — reading them the
other way round lets one stopped model server report the internet as broken,
which is not merely wrong but wrong in the direction that sends somebody to look
at their router. `remedy.test.ts` asserts the local arms **against every value of
`online`, `false` included**: an install whose endpoints are all on the LAN is
told nothing about the internet *while this server knows perfectly well that it
has none*. That is [09 §6.5]'s *"a fully local setup is a legitimate,
fully-functional deployment and its operator chose it deliberately"* as a test
rather than as a hope, and it is the assertion a happy path could never make.

**Three surfaces, one vocabulary.** The transcript's failed-turn note, the
notification body, and — the first-run case §1.6 names — `/connections/models`,
which grew a third error code beside `unauthorized` and `unreachable` on
[P2C log](14-p2c-log.md)'s finding 5's own argument: *the two remedies point in
opposite directions*, and a third that points somewhere else again earns its own
word. A stored notification written by an older build still gets a sentence,
derived from its class.

*One thing this stage deliberately did not do*: put `endpoint` and `stalled` on
the turn record. They are facts about the call rather than about the network, so
the argument for recording them is real, and it is
[P11.10](#p1110--session-export-and-the-format-it-freezes)'s to make — that stage
owns what the record carries when it freezes, and a field added here to improve a
sentence would be a schema decision taken for a cosmetic reason.

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

#### Done — 2026-09-17

**Two features under one heading, and the stage's own record keeps them apart.**

---

***Retention: when something was deleted is in its own folder name, and that is
the find the whole sweep turns on.*** `trashDestination` has suffixed every
entry with a `uuidv7` since [P4.4](16-p4-implementation.md), and a `uuidv7`'s
first forty-eight bits are the Unix millisecond it was minted — so **the trash
has been recording the exact moment of every delete, per entry, for seven
phases, and nothing read it.**

*The alternative was the filesystem's mtime*, and it is worse in a way that only
shows up when it matters: a restore from backup, a `cp -r` to a new disk or a
container migration resets every mtime, and a sweep reading them would either
delete nothing for thirty more days or — depending which way the tool sets them
— empty a month of trash overnight. **The name travels with the bytes.** The
falsifying mutation is switching to `stat`, which passes every test that makes a
file and immediately sweeps.

*And the parser was wrong on its first run, in the way this kind of parser
always is.* It split the folder name on the **last** hyphen, which put twelve
valid hex digits from the *end* of the uuid into the timestamp reader, produced
a deletion date some nine thousand years hence, and swept nothing ever. A uuid
is full of hyphens; the only unambiguous reading is the shape of the whole
suffix, matched as one.

***Zero means keep forever***, and the reading is load-bearing in the one
direction that cannot be undone: the schema's minimum is zero, and a sweep that
read it as *expire on sight* would empty the trash of every install that tried
to turn the feature off.

**Restore refuses rather than overwrites.** Delete-recreate-restore is a real
sequence — somebody deletes an actor, makes a new one with the same name, then
changes their mind — and overwriting would destroy the newer object to
resurrect the older.

---

***The link table: [P4 §6.6](16-p4-implementation.md) said these were one debt
and it was right.*** *"Whichever phase builds that panel pays both"* — the
delete confirmation's *referenced by 12 sessions* and the object page's
*Used by* are the same question at two moments, and the reason they had to be
one build is that separate answers disagree about **what a reference is**.

The rule this stage settles: ***a reference is a link somebody authored, not a
mention.*** A setup naming a treatment, a session's chosen cast, a treatment's
lorebooks, a package's contents — each is a field whose whole purpose is to
point. A lore entry mentioning *Vera* is not a reference to the actor, and
counting it would make the delete confirmation's number grow with the prose
rather than with the links. **That is [10 §14.5](../10-ui-surfaces.md)'s *a
fragment is indexable when it has an address*, read from the other end.**

*The tidy alternative is rejected for the same reason §14.5 rejects its own*: a
generic walk collecting every `{ id, name }`-shaped value would scoop up the
object's own id, every lore entry's, every tag's and every folder's — producing
a table where a book references its own three hundred entries.

***And the route test found a bug the unit test agreed with.*** A setup's cast is
`{ personaOptions, partyDefault, narrator }`; the reader was written against
`{ persona, actors }`, which is a **session**'s shape, and it found nothing at
all — silently, because an absent field and an empty list are indistinguishable
there. The unit test passed because it was written from the same wrong picture.
*What caught it was making each producer through its own route and counting.*
**That is the concrete argument for having both kinds of test**, and it is worth
more than the general one.

**A count is information and never a gate**, which is [03 §10.2](../03-data-model.md)'s
posture: delete is a move until the retention window closes, so a person
removing an actor twelve sessions use is **told** and then allowed.

---

*The accessibility pass has no proof obligation and does not pretend to one* —
[P2 §2.11](08-p2-implementation.md) calls it an audit over surfaces built to
the habit, and an audit's output is findings. **It is not walked here**: the
surfaces this stage added carry the habit (landmarks, `role="status"` on every
asynchronous answer, whole sentences rather than assembled fragments), and a
sweep over the whole client is a sitting rather than a commit.

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

---

#### Done — 2026-09-17

***`labels(namespace, english)` and a Proxy, so no call site changed.*** A table
declares its English, registers it, and gets back a view that follows the active
locale — which means `note-labels.ts` keeps its words beside the docstring
explaining why each note says what it says, and `address.ts` and `prose.ts` keep
reading tables rather than calling a lookup. The alternative, a `t(ns, key)`
function, is a mechanical edit in twenty-odd files that also moves every sentence
away from the code it is about. **The cost is one trap per label read** on tables
of a dozen entries, which is not a number anybody will measure.

***`i18next` is not here, and the deferral has a measurement behind it rather
than a preference.*** [19 §12.3](../19-tech-stack.md) recommends it and its own
deciding factor is that *"i18next runs on the server too"* — push bodies rendered
with the app closed. **That need is not real in this build**: [P10.2](27-p10-implementation.md)
renders every notification on the client, from these tables. What it would cost
was measured one stage ago — [§1.3](#13-the-i18n-sweep-is-extraction-and-only-the-discipline-made-it-mechanical)'s
280 kB gzip entry and its recommended ceiling — and `react-i18next` with an ICU
plugin is a fifth of that again, on the common entry, for a feature no shipped
locale uses. *That is [20 §7](../20-client-loading.md)'s trigger, knowingly.*
What §12.3 actually buys is ICU plurals, which is real and is not what a
class-to-word table needs. **So the deferral is a loader, not a format**: §12.2's
explicit keys are what makes it cheap, because adopting a library later changes
who reads the JSON and nothing about what is in it.

***The count was thirty-one across twenty-one files and came out at
thirty-eight across twenty-seven***, and the difference is the finding rather
than an accounting error. §1.3 counted **open-keyed** maps — `Record<string,
string>` — and a good half of the tables a person reads are closed:
`Record<StepOutcome['state'], string>`, `Record<BlockChange, string>`,
`Record<FailureRemedy, string>`. *A translator cannot tell the two apart and
neither should the rule*, so the check below is written on what a table **is**
rather than on how it is typed.

***The instrument found three maps the sweep had already walked past***, which
is [§10.1](05-manual-testing.md)'s lesson arriving on schedule:
`REMEDY_SENTENCES` (P11.6's own, written this phase), `KIND_LABELS` and
`OUTCOME_LABELS` were all missed by a hand-written pass and caught by the first
run of the check. **That is the whole argument for the proof obligation being a
scan rather than a list.** It also found `OFF_LABELS` written out twice,
character for character, in the lorebook view and the lorebook editor — hoisted
into `library/gate-labels.ts`, because two declarations of one namespace mean one
translator entry and two English sources, so an English copy-edit in one file
would leave the other disagreeing with the catalogue *only in English*.

***What the rule deliberately does not reach is written into the check, not left
to be discovered.*** Three things: prose written inline in JSX, `[value, label]`
option lists, and a table read at module scope into another `const` — which
would freeze English before any catalogue loaded, and is the one way to use
`labels()` wrongly and quietly. The first two are the `<Trans>`-shaped job §12.3
buys and this stage declined; the third is a hazard with no instance yet, so it
is a paragraph rather than a check. *The boundary is §1.3's own*: the sweep is
**moving label maps into a catalogue**, because the discipline that made it cheap
— the server emits `{ key, params }` and the client holds the words — is a
discipline about **classes**.

***The test French is `fr-x-machine`, and the private-use subtag is the honest
part.*** [19 §12.4](../19-tech-stack.md) makes machine translation *the primary
mechanism rather than a fallback*, so what has to be right on day one is the
machinery: per-key fallback, layout under longer strings, and a locale a person
can actually switch to. Offering it as plain `fr` would promise French and
deliver a machine's — the same refusal `UserSettings.tsx` already makes for an
untranslated `de-DE`, one step along. **It is deliberately partial and
deliberately long**: whole namespaces are absent, `play.input-kind`'s hints are
absent while its labels are present — so a button reads *Parler* and its tooltip
reads *Speak aloud*, which is §12.1's *per key* on screen rather than only in a
test — and several entries are padded past what a careful translator would write,
because a layout that only holds English breaks on the first real locale.
*Provenance is the whole file rather than the entry*: every string in it is
machine-made and unreviewed, which one flag says better than four hundred, and
§12.4's per-entry marker belongs with the **script** that fills gaps against a
real locale — there is nothing yet for a human to have reviewed.

***`useLocale` is `useTheme`'s shape one indirection deeper***, mounted once in
the shell for the reason the theme is: a choice made on the settings page reaches
every surface, and signing in applies it before anybody goes looking for where to
set it. The catalogue is a dynamic `import()` so a language nobody chose costs
nothing on the common entry. **No `localStorage` mirror**, unlike the theme — a
locale arriving one round-trip late shows English for a moment, which is the
bilingual steady state §12.1 already asks people to live with; a theme arriving
late shows white to somebody who asked for dark.

*The layout half of Ends at is a person's and is recorded as one*: the app
rendering in the machine French without breakage is
[sitting Q](05-manual-testing.md), where the tag manager's three long folder
labels are the first place to look. `useLocale.test.tsx` carries what a test can
— an account's locale reaching a chunk, the chunk reaching a module-level table
imported before any catalogue existed, and a component that knows nothing about
either re-rendering in French.

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

---

#### Half done — 2026-09-17: everything that does not need a daemon

***[work plan §8](01-work-plan.md) is rewritten rather than extended***, which
§1.1 named as this stage's and which the stage's own text asked for in the right
words: it *"should say what the rehearsal actually taught rather than restating
the list"*. What it taught is one sentence and is now the section's rule —
**all three of P6A's on-tag failures were string mistakes in a file that runs
once, on a tag, and nowhere else**, so *a release step that cannot be exercised
on an ordinary run should be asserted about on one*. The seven bullets are now a
table of where each stands, and five of them are done.

***The proof obligation's count is corrected rather than met.*** It asks for
`tools/release.test.ts` *"extended from one artifact to five"*, and both
[releases §0](04-repo-and-releases.md) and [work plan §8](01-work-plan.md) say
**two** for beta — *"the canonical build must deliver the OCI image and the
tarball… for beta to count"*, with the other four a 1.0 requirement and the
reason written beside it: *"standing up four more build chains is exactly the
kind of work that reads as progress while delaying the thing being packaged."*
So this is the extension from one to two, and the three that are not owed here
are named as not owed rather than quietly skipped.

***The tarball exists, which is the actual work.***
[09 §5.4](../09-server-multiuser-deployment.md) decides its packaging list on one
question — *"does it start on boot and come back after a reboot?"* — and calls
Tier 2 *"the single highest-value non-container artifact, and the one most easily
skipped"*. `deploy/tarball/` is a systemd unit and an install script;
`tools/pack-tarball.mjs` archives the deployed tree with them beside it; a second
job on the same tag builds it. **It builds from source rather than extracting the
image**, which is the tempting shortcut: `docker cp` would tie the tarball to a
base image's layout and make two artifacts into one artifact with two wrappers,
which is the coupling §5.4's tier list exists to avoid.

***One deliberate difference between the artifacts, written into both.*** The
unit binds `127.0.0.1` where the image binds `0.0.0.0`.
[P10 §1.2](27-p10-implementation.md) forbids a **hidden** difference — *"a hidden
difference between artifacts is a support burden shaped like a security
feature"* — and this one is not hidden: a container's network namespace makes
`0.0.0.0` a statement about the container and the operator's `-p` is the explicit
act, while a systemd service has no such boundary and would otherwise put a fresh
install on the LAN before anybody read the setup token. `release.test.ts` asserts
both values and asserts the unit explains itself.

***The reproducibility claim is met for the tarball and is a gate row for the
image.*** The obligation is sharp — *"`git tag` twice on one commit produces
identical artifacts — the reproducibility claim in the only form that
distinguishes it from* the build works" — and for a tarball the packer is the
only thing between a tree and the bytes, so **packing one tree twice is that
claim with the build removed from it**. That is asserted twice: over a fixture in
`tools/pack-tarball.test.ts`, and over the real artifact in the workflow, which
packs it again and `cmp`s. *The three places it would have failed are named in
the packer*: directory order, mtime and ownership, and gzip's own timestamp —
the last being the one that survives every check of the contents. The image's
half needs a daemon and two runs and stays row 9.

***And P11.0's recommendation is collected.*** That audit asked for *"one line in
`tools/release.test.ts`'s neighbourhood: a recorded ceiling on the entry
bundle, so the next phase that doubles it is found by failing rather than by
somebody rebuilding and remembering these three rows"*. `tools/entry-budget.test.ts`
is it: **310 kB gzip, recorded at 276.77** — and the number moved by **6.30 kB
gzip across the whole of P11's client work**, which is a fifth of what P10 cost
and the best argument available that the ceiling is not going to be a nuisance.
*It also names the one regression a byte total would catch too late*: a static
import of a locale catalogue, which typechecks, lints, works, and folds every
translation into the common entry. `fr-x-machine` is its own 2.42 kB chunk and
the test says so.

*Two rows of [work plan §8](01-work-plan.md) are left and neither is code*: the
container's reproducibility and the upgrade test, which want a machine with a
daemon and a previous release on it — the same sitting twice. **`Ends at: the
demo` is untouched by any of this**, which is correct: a demo is what a person
does with a built thing.

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

#### Done — 2026-09-17

***The event that ends two records' freedom to move, and it happened without a
migration.*** `turn.ts` has said since P3.0 that *"session export is the event
that ends this freedom: the day a stored turn becomes a portable artefact, these
graduate to `schema/` and the registry"*, and
[P9 §1.1](26-p9-implementation.md) attached `Rendition` to the same event.
**The event arrived; the graduation did not, and that is a decision.**

The old sentence assumed *portable* and *validated on import* were one thing.
[18 §3](../18-session-import.md) is the argument that they are not: **a registry
entry would validate a foreign record against our shape**, and consequences 1 and
2 are both about tolerating shapes we did not write — so the registry would
enforce exactly what the format exists not to enforce. *The freeze is a promise
not to tighten, which a schema cannot express and a test can.* Both docstrings
now carry the correction rather than the prediction.

***The obligation's first clause is the one a serialiser violates without
deciding to***, and it is where the round-trip test starts: every read surface in
this build calls `walkPath(head)`, so reaching for the obvious function produces
an export that is **correct against every linear session and lossy against every
real one** — and every fixture in this repository is linear. §1.8 predicted
exactly that (*"no fixture this build produces would catch it unless the fixture
branches — so the fixture branches"*), and the fixture branches.

**All three of [18 §3]'s checkable consequences are asserted**: siblings by a
count over a branched fixture, a turn with five absent fields surviving
unchanged, and a foreign identifier from a source this build has never heard of
carried through. *The last is what makes this a format rather than a dialect.*

***The fourth consequence is the one that costs more by waiting, and it is
paid.*** `Session.origin` has been specified in [03 §8](../03-data-model.md)
since it was written and never implemented; `Turn.foreign` is [18 §3]'s place for
a foreign message id. **Both are optional**, because every session this build has
ever written has neither — a record that made them mandatory would refuse to
load every session on every existing install, which is what a *free to move*
tier is supposed to make impossible and what freezing it makes permanent.

---

***And `.sepack` is here, which is [§1.9](#19-sepack-is-p1110p1110--session-export-and-the-format-it-freezess-and-the-reason-is-that-it-is-not-a-second-format)'s
decision built.*** [P7B.6](24-p7b-presets-and-prompts.md) shipped the package
editor with the honest limit written beside it — *"the editor lands able to make
and describe a bundle and not to send one"* — and this is the send.

**The contents are resolved rather than carried by reference**, which is the
whole of what makes it a bundle rather than a bookmark: a `.sepack` naming twelve
ids is useless on the install it was sent to. *And an id that no longer resolves
is **reported**, not dropped*: a package outlives an object it names, and both
obvious answers are worse — dropping exports a package that quietly is not the
one somebody made, refusing makes a stale reference unfixable except by
hand-editing a file.

*Neither export carries pixels.* An asset is content-addressed bytes and inlining
them would be a hundred megabytes of base64 for a feature whose value is the
story — which is [P9 §1.1]'s *"the recipe travels and the pixels do not"*,
arriving unchanged at the stage it was written for.

***And the reader arrived with the record, 2026-09-17.*** This stage shipped a
format and a download, and [§3](#3-verification--the-p11-exit-gate)'s row 10 is
*"a session exported from this install **loads on another one**"* — which nothing
could do, because there was no importer and no stage owned one. **A format with no
reader makes that row unwalkable rather than merely unwalked**, and [25 E4]'s
whole argument for writing the format *with import in mind* was that the two are
different documents; `sessions/import.ts` is what makes that claim checkable.

*Three decisions in it are worth having here rather than only in the file.* It
always makes a **new** session, because merging two trees means deciding what a
turn with an unknown parent is and every answer loses something. It **keeps the
turn ids and re-mints the session's**: the turn ids are the tree's own structure
and re-minting them is a graph rewrite over the one structure this project spends
the most care on, while a session id is an address on *this* install and two
sessions sharing one is an immediate confusion. And a turn that already carries
`foreign` **keeps it**, because the first install it came from is the one that
matters — a session that had travelled twice and claimed it came from the middle
would be a provenance record that gets less true the more it is used.

***Corrected 2026-09-27: keeping the turn ids has a price on the same install,
and the importer now refuses to pay it.*** `sessions/import.ts` priced a
collision only between two installs importing each other's copies. The common
case is one install: an export loaded back where its session still is, and
every backup import of an account's own sessions ([P12.9]). The index holds one
row per turn id, so the copy took the original's rows at every append. The importer refuses a session
whose turns the install already holds (`409 already-here`), and three defects
found beside it are fixed with it: each turn now names the session it landed
in, where it kept the exporter's id; the session row is indexed, where there was
none; and the renditions' records are written (a `pending` one as `interrupted`,
pixels only when the source carries them), where they were counted and dropped.
The tests behind row 10 now use a second test server, where they used the same
one.

*Reproduced independently the next day by [P13 §0.4](30-p13-aventuras-import.md)*,
which fixed it by re-minting the turn ids instead; that fix was set aside for
this one when the two branches met, 2026-09-29. P13 §0.4 keeps its account of
the mechanism — including the Illustrate that re-rendered the original's
picture — because it was found from a different door.

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

#### Done — 2026-09-17

***[25 E6](../25-open-questions.md)'s whole instruction is "do not build a
subsystem"***, and §1.8 calls this *"the smallest"*. It is: a script, two
commands, and one test.

**Two things it does that `rsync` does not**, which is the entire justification
for it existing beside E6's own *"`rsync` is a legitimate backup strategy and
should be documented as one"*:

- ***It leaves the index out, and that is the design rather than a tidiness.***
  [03 §5.1](../03-data-model.md) makes `index.sqlite` **derived** — a cache of
  what the files say, dropped and rebuilt whenever its schema version moves. An
  archive carrying it would restore correctly today and, the first time somebody
  restored **across a version**, restore a stale belief about a newer tree —
  *silently, because a stale index answers queries*. All three files go
  (`-wal` and `-shm` too): taking the database without them, or with them from a
  running server, restores a file that is neither current nor empty.
- ***It quiesces by saying it cannot.*** There is no write-lock to take from
  outside the process, and inventing one would be the subsystem E6 forbids. So
  the usage text says *stop the server first* and explains why —
  `POST /api/admin/restart` with its drain is how an operator gets there
  ([09 §6.4](../09-server-multiuser-deployment.md), [P10.3](27-p10-implementation.md)).

**A tar written by hand, and no dependency.** The format is forty years old and
the subset an archive of a directory tree needs is a header struct and padding.
*A dependency here would be a supply-chain surface on the one tool somebody
reaches for when things have already gone wrong.* Ownership is written as zero
deliberately — a restore into a container runs as whoever the container runs as,
and carrying uids from the machine the backup was taken on is how a restore
produces files its own server cannot read.

***And the restore refuses a path outside the destination***, which is the one
security clause in a file about recovery. `../../etc/passwd` in a tar header is
the oldest attack there is, and **the fact that this project writes its own
archives is exactly the assumption a restore must not make**: the thing a person
restores is the file that survived, from a disk that may have had a bad week.

*The obligation's own clause is asserted directly*: **the index is rebuilt, not
carried**, so the test checks the archive's contents and the restored tree for
its absence rather than only the outcome — *"an archive that quietly included the
index would pass every other check."* The live half — restore into a running
install and watch a search answer — is [testing](03-testing.md)'s, and stays
this phase's one case of the check living outside the document that owes it.

***Two claims above were not true when they were written, and the record is
kept as it was.*** [P12 §0.5](29-p12-implementation.md) found them by reading
`layout.ts` beside `backup.mjs`, five days later. **The index was in every
archive this script wrote**: the exclusion tested file names at the data root,
and [03 §5.1](../03-data-model.md) puts the index at `index/index.sqlite`, one
level down — and the test *"checks the archive's contents … for its absence"*
over a fixture that wrote `index.sqlite` at the root, so it agreed with the
mistake rather than with the layout. **And *"a header struct and padding"* cut
every member name past a hundred bytes**, which loses all but one of a
lorebook's version payloads to the same truncated name. Both were repaired at
[P12.0](29-p12-implementation.md) (`aaf7345`), fixture included, before P12
built anything on top; the script this stage shipped is now one of P12's two
tar writers, held to the server's by `tools/tar-seam.test.ts`.

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

#### Done — 2026-09-17

**Row 20's decision, built.** [§0.4](#04-the-audit-run--2026-09-17-at-45c613c)
took it rather than carrying it a third time, and the ground was never the
feature: two of [P8](25-p8-implementation.md)'s three criticals are **vacuous**
while nothing extracts, so leaving it unowned did not defer a feature — it left
a closed phase's gate permanently unfinishable.

***§2.1 asks for "a step at session end, and periodically during long sessions",
and this build has no session end.*** A session is never closed; it is **left**,
and left sessions are exactly the ones a person comes back to. So *at session
end* has no event to hang on, and a step waiting for one would never run. **The
periodic half is the whole of it**, which is the honest reading rather than a
reduction: what §2.1 is asking for is that a long session deposit memories as it
goes, and a cadence does that at every length. *Eight turns, written down as the
judgement it is* — short enough that forty turns leave five memories rather than
one, long enough that the extra call is a twelfth of the turns.

*(2026-09-27)* **Each run reads the eight turns since the last one, and it read
the whole session.** The step rendered the entire transcript every eighth turn,
so the fortieth turn's extraction re-read the first thirty-nine: the cost of
remembering grew with the square of the session, every old exchange was offered
for extraction again (and `alreadyKnown` sees a paraphrase of a known fact as a
new one), and a long session outgrew the window with a block that is required
and cannot be trimmed. The cadence runs on the eighth story turn and the
transcript stops before the turn running it, so its last eight turns are exactly
the ones since the last run.

***`post` where the summariser is `pre`***, and the difference is the whole
relationship between the two features: a summary goes into **this turn's**
prompt, and a memory is a reading of what just happened that goes into a
**book**. The precedent is `suggest.ts`, `post` for the same reason.

***The locked rule turned out to be an absence, and that is the finding.***
[P8.3](25-p8-implementation.md) wrote `LoreEntry.locked` onto every hand-written
memory and said its reader was owed — *"the extractor never rewrites a locked
entry."* **The shape that honours it is appending and never updating**: a
hand-written memory cannot be eaten because no code in this module edits an
entry at all. *The cheapest way not to eat corrections is to have no code that
could*, and the assertion is therefore in
[`tools/repo-shape.test.ts`](../../../tools/repo-shape.test.ts) rather than
behavioural — a behavioural test can only say *it did not this time*, where
[P8 §3.1](25-p8-implementation.md)'s C2 claims *it cannot*. That is also the
check a helpful refinement two phases later would otherwise break silently: an
extractor improving its own earlier entries looks like an improvement right up
to the first correction it swallows.

***And extracted entries are deliberately not locked***, which is the other half
of the same decision. The field means *locked against automatic modification*,
and an entry this step wrote is exactly the kind a later refinement should be
free to improve; a person who corrects one is editing it in the editor, which is
a different act with a different field.

**What [08 §6](../08-cross-session-memory.md) forbids is unreachable rather than
filtered.** The step reads `transcript` and nothing else — [P8.1]'s payload,
which carries *what was said* with nothing about how it was produced — so a
hook's premise, a hidden channel and GM-only state cannot reach it. *That is the
structural half §6 asks for, inherited rather than rebuilt.*

***The dedupe is coarse and errs towards not writing***, which is the right
direction and is stated so nobody mistakes it for cleverness. [25 E2] puts
semantic retrieval post-1.0, so what is left is the text and the keys,
normalised for case and punctuation — a model asked twice about the same evening
produces the same sentence with different commas far more often than a different
sentence. **A memory missed is still in the transcript; a book with four copies
of one fact spends its retrieval budget four times on it.**

*The judgement half is not here and should not pretend to be*: whether the facts
it picks are the ones a reader would have picked is
[sitting G](05-manual-testing.md)'s, arriving through play rather than through a
check — which is exactly what the two P8 criticals this stage unblocks are for.

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

### 3.1 The critical list, and what a test answers

*Planned to [§0](05-manual-testing.md)'s criterion rather than sketched — the
seventh phase to do so, and the first where clause (ii) has to be re-read
because there is no phase after this one.*

***Clause (ii) reads differently here, and the re-reading is the criterion's own
instruction.*** *"Re-read it when each phase opens. If P7 reshapes the mode
contract far enough, some of what is excluded today as equally cheap later
becomes more expensive instead."* Clause (ii) privileges what **compounds**, and
compounding is a claim about later phases — of which there are none. **But this
gate is also the beta gate**, so the thing it compounds into is not a phase, it
is a **declaration**: a wrong answer found after somebody has been told this is
feature complete costs more than the same answer found now, and costs it in the
currency [releases §0](04-repo-and-releases.md) says beta spends — other people's
trust, once.

***~~Five~~ Six criticals, and two of them are desk work.*** That is unusual and it is a
property of a phase whose gate is mostly *did the thing get built*: row 1 and row
13 are answered by reading rather than by playing, and they are on the list
because **they are what closes the phase** rather than because they are hard.

***The sixth arrived 2026-09-22 and is not in the table below***, which is the
derivation as it was run on 2026-09-17 and stays that way. It is
[sitting R](05-manual-testing.md)'s **R6** — a hook written on a carrier, and one
saved back out of a session — and its three clauses are argued at
[P11.2](#and-2026-09-22-a-hook-gets-somewhere-to-be-written-and-a-way-out)'s
hook addendum, where the stage that owes it is.

| Row | Why it is critical | Blocked on |
|---|---|---|
| **C1** [§0.1]'s list is empty, item by item, with each named check green — gate row 1 | Clause (i): it is the phase's own claim about its own list, and nothing else in this gate can falsify it. Clause (ii): it is what row 12's reader is entitled to assume. **The `'unread'` tier reaching zero is part of it** | Nothing — a desk and the test output |
| **C2** A real session reads end to end as prose, prints to a clean PDF, and copies as Markdown that pastes — gate row 2, minus the two hundred turns | Clause (i): [P11.1]'s claim, and the three outputs are three different renderers. Clause (ii): a reading view that loses a swipe or a speaker is a thing people would find after being told the phase shipped. *Two hundred turns is [sitting G](05-manual-testing.md)'s* — a length, which §0 says is not criticality | Nothing — any session with a few branches, a browser |
| **C3** The assistant answers a question about the user's own library — gate row 4, the half a grep cannot reach | Clause (i): [P11.3]'s claim, and the grep answers *not a second chat* rather than *it works*. Clause (ii): it is the feature whose absent half — ~~the docs lorebook~~ — was most likely to be discovered by somebody else first, ***and that half was written on 2026-09-17***, so what C3 now walks is whether the answers are any good rather than whether there are any | **R2**, a live endpoint |
| **C4** Read the 1.0 design documents and say, capability by capability, whether it exists and works — gate row 12 | Clause (i) in its strongest form: it **is** the beta claim rather than a check on one. Clause (ii): everything | An afternoon, and the corpus |
| **C5** Row 13's question is answered in writing — gate row 13 | Clause (i): the gate says *what must not happen is row 12 being walked by somebody who does not know the question was open*. **It is answered**: [P11.12] took the extractor, so C5 is recording that rather than deciding it, and [sitting N](05-manual-testing.md) stops being one row | Nothing — and C4 must not run before it |

***What the criterion excludes, and it is most of the gate.*** Rows 5, 6 and 7
are **breadth, duration and a clock** — §0's *"breadth, duration, platform and
corpus are not criticality"* — and they go to sittings G, Q and the standing
list. Rows 3, 8, 10 and 11 are **asserted by name** below. Row 9's container half
is blocked on a daemon, which clause (iii) makes a deferral rather than a check.

***And one row the criterion cannot rescue.*** Row 8 — *the Playwright journeys
pass against the fake provider, on CI, on every merge* — ~~**has no suite to
run.** There are no journeys, there is no harness, and no stage of this phase was
asked to build one.~~ That is not a walk anybody can do and not a test anybody can
name; it is a gap, it is
[§3.2](#32-what-was-answered--recorded-2026-09-17)'s honest entry, and it is
recorded here so that C4's reader meets it as a known absence rather than as a
discovery.

***Built the same day this was written*** (2026-09-17), which makes the paragraph
above a record of where the work came from rather than a standing absence. **The
criterion never had to rescue it**: a row asking for journeys *on CI, on every
merge* is not a person's walk at all, and the reason it sat in this section is
that a check nobody can run is not a check — which is a different failure from
the one §0's three clauses sort for. Row 8 leaves the critical list because it is
now green, not because the criterion was re-read.

### 3.2 What was answered — recorded 2026-09-17

*The results table [manual testing §0](05-manual-testing.md) asks for, in
[P10 §3.2](27-p10-implementation.md)'s shape. **The thirteen rows above are not
edited**; this is the second table, which is that model's first honesty condition
and the whole reason there are two.*

| Row | Discharged by | Result |
|---|---|---|
| **1** [§0.1]'s list, item by item | every stage's own obligation | **C1. Desk work, not yet done.** Each stage's Done block names its check and each check is green; what nobody has done is the item-by-item read across them, which is the row |
| **2** A two-hundred-turn session reads, prints, copies | `reading/prose.test.ts`, `reading/fence.test.ts`, `ReadingPage.test.tsx`, `library/book-document.ts` | ✅ **in part** — the passage model, the attribution, the Markdown and the print stylesheet, plus the fence that refuses workbench machinery in the reading directory. **C2** is a person's eyes on a real one; two hundred turns is G's |
| **3** Every editor offers assist, provenance and history | `editor/contract.test.tsx`, `library/entry-defaults.test.ts` | ✅ — over `LIBRARY_KINDS` rather than over the editors somebody remembered, which is the obligation's own wording, plus one round trip driven end to end. The closed-section invariant is `groupSummary`'s and predates this phase |
| **4** The assistant answers, proposes a diff, and is not a second chat | `tools/repo-shape.test.ts`, `modes/assistant/mode.test.ts`, `assistant/assistant.test.ts` | ✅ **in part** — *not a second chat* is asserted from both sides, the proposal reader and the ambient context are asserted, and ~~**the docs lorebook does not exist**~~ — **written 2026-09-17**, twenty-five keyed entries shipped beside the card and attached by the session's own `lore` links, with `docs-lorebook.test.ts` holding the corpus and `repo-shape.test.ts` the two-package seam. **C3** is the half a grep cannot reach |
| **5** Four pacing levels produce different sessions | `sessions/hooks.test.ts`, both modes' `mode.test.ts` | ✅ **in part** — that each level *has prose*, that the pack ships four, and that the top of the dial carries no compliance language. Whether they **read** differently is [sitting G](05-manual-testing.md)'s, and until [P11.5] there was nothing to read |
| **6** The app in the test French | `i18n/catalogue.test.ts`, `i18n/useLocale.test.tsx` | ✅ **in part** — the per-key fallback, the orphan check, and an account's locale reaching a module-level table through a lazily-loaded chunk. **Layout is [sitting Q](05-manual-testing.md)'s**, because no test can see a clipped label |
| **7** Restorable within the window, gone after it | `storage/trash.test.ts`, `settings/Trash.tsx`'s route tests | ✅ **in part** — the suffix reader, the sweep and the restore. *Gone after the window* is a clock, which the standing list holds |
| **8** Playwright journeys on CI | `e2e/journeys.spec.ts`, `ci.yml`'s `journeys` job | ✅ — **built after this table first said ❌**, which is the one row here whose entry changed by the work being done rather than by the wording being fixed. One test, the seven journeys in [testing §3.5](03-testing.md)'s order, against a built server serving a built client and an OpenAI-compatible double over HTTP. **Three of the seven were read wrong until walked** — §3.5 records which and why |
| **9** `git tag` produces both artifacts reproducibly | `tools/pack-tarball.test.ts`, `tools/release.test.ts` | ✅ **in part** — the tarball is packed twice and compared, in a test and again in the workflow against the real artifact. **The container's half wants a daemon**, which this machine has never had |
| **10** A session loads on another install, siblings and all | `sessions/export.test.ts`, `sessions/import.test.ts` | ✅ **in part** — the round trip through a reader that shares no state with the writer: every turn, a new session id, the old ids kept, each turn marked foreign, and `origin` recorded. *Another **build** reading them* is the half a second install would prove |
| **11** A restore serves the sessions it was taken from | `tools/restore.test.ts` | ✅ **in part** — the archive carries the files and **not** the index, and the restored tree has none either. *A search answering afterwards* is [testing](03-testing.md)'s, and this phase's one case of a check living outside the document that owes it. ***True since `aaf7345`, and not when this row was written*** — [P12 §0.5](29-p12-implementation.md): the exclusion never fired and the fixture agreed with it; see [P11.11](#p1111--backup-and-restore)'s note |
| **12** A person reads the 1.0 corpus | — | **C4. The gate.** Not startable until C5 is recorded |
| **13** The extractor is owned, or 1.0 ships manual capture deliberately | [P11.12](#p1112--the-automatic-extractor) | ✅ — **taken.** [§0.4](#04-the-audit-run--2026-09-17-at-45c613c) took it rather than carrying it a third time, and `repo-shape.test.ts` holds the clause that makes [P8](25-p8-implementation.md)'s C2 answerable |

***Three things this table says that the row list cannot.***

**The phase built more than its stage list named.** [P11.2]'s obligation was a
loop and the loop found nothing, because the frame was what changed;
[P11.9]'s asked for five artifacts where the bar is two; and row 10 needed an
**importer** that no stage owned — the format was written at [P11.10] and
nothing could read it back, which made *loads on another one* a sentence about a
capability rather than about this build. All three are corrections rather than
additions, and all three came from writing the record.

**Two 1.0 commitments are named as unbuilt rather than absorbed.**
[10 §11.2b]'s image slots and [10 §11.2c]'s entry travel are [P11.2]'s recorded
gaps, and the docs lorebook is [P11.3]'s. *A phase claiming feature completeness
has to answer for them at C4*, which is why they are here rather than only in
their stages' Done blocks.

***All three were built on 2026-09-17***, so that list is empty — entry travel,
image slots and the docs lorebook, and with row 8 they are the four things this
record named that then got made rather than argued about. Each took hours; each
was being carried because nobody had written down that it was missing, **which is
the case for writing a record at all** and is the only general claim this
document makes about its own form.

***Image slots is the one that most argues for the exercise.*** It had been
carried as *a stage of work*, and what it actually was is a **container that did
not exist**: `EmbeddedMedia` names bytes a container carries, a lorebook's
container is a folder, and nothing had ever written into one. So §11.2b was not
unbuilt, it was **unreachable** — and the difference is invisible from a plan and
obvious from an afternoon.

***The docs lorebook is the one that argues the other way.*** Its row said the
machinery was there and only a corpus was missing, and that was exactly right:
the attaching is one line. What it cost was writing twenty-five answers, which is
work a plan cannot shorten and a record was right to refuse to fake.

***Image slots is the one that most argues for the exercise.*** It had been
carried as *a stage of work*, and what it actually was is a **container that did
not exist**: `EmbeddedMedia` names bytes a container carries, a lorebook's
container is a folder, and nothing had ever written into one. So §11.2b was not
unbuilt, it was **unreachable** — and the difference is invisible from a plan and
obvious from an afternoon.

**And row 8 was the one to argue about** — ~~*"whether beta can be declared
without it is C4's reader's call and not this document's"*~~. Three of the four
unbuilt things above are features with an argument beside them; a browser test
suite was **infrastructure the gate assumed and no stage was asked for**, which
is a different kind of absence and not one a reader should have to adjudicate.

***So it was built instead*** (2026-09-17), and the argument is withdrawn rather
than won. **What it cost is the interesting number**: a day's work, against four
phases of a gate row that had been carried unbuilt. **What it found is the better
one** — three of the seven journeys said something other than what they had been
read as saying, and the sharpest of the three is that *branch* had been read as
*a second send*, which posts the same one turn and continues the line instead of
splitting it. A suite written to that reading would have been green and would
have protected the wrong claim, which is the argument for walking a list of
journeys rather than reciting it, and the argument this row was making all along
without anybody able to act on it.

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
