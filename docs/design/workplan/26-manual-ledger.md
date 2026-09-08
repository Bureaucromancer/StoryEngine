# 26 — The manual ledger: what a person still owes

**Status: ledger, opened 2026-09-07 at `bded9f7`**, from a sweep of the whole
work plan for obligations that were made and never discharged. It is a
**counting document**, not a plan: nothing here is new work, and everything here
was already owed by a phase that has closed.

**Why it exists.** [12](12-p2-manual-gate.md) does this job for P2, P2A and P2B
and stops there, deliberately — it was written when those were the only closed
phases. Five gates have accumulated behind it since, and **nothing counts them
in one place.** A gate nobody has walked and nobody is counting is
indistinguishable, from inside the repository, from a gate that passed; the
phase documents each say honestly that their own gate is unwalked, and no
document has ever said *how many*.

The answer is **five phase gates and one phase's sessions**, which is the
finding this file opens with rather than buries.

**What this is for.** [P6B](24-p6b-playable.md) is the phase that finally runs
PLAYABLE, and it clears some of this and not most of it. §2 says which. §3 is
the sequenced plan for the passes that remain **after** P6B, written now because
each one wants something arranged in advance — a machine, a household member, a
corpus with lead time — and a manual pass that discovers its own prerequisites
on the day is a pass that does not happen.

**And the sheet a person actually walks from is [27](27-pre-p6-walk.md)**, opened
2026-09-07 — every pre-P6 gate condensed into eight sittings with a result beside
each item, because this document counts and does not sequence. The two go stale
differently, which is why they are two: a ledger is true until a phase closes,
and a walk sheet is true for an afternoon.

**The rule this file exists to enforce**, and the only one it adds:

> **A gate is walked, or it is deferred with an owner and a reason. There is no
> third state.** This document makes *neither* visible.

---

## 1. Where every gate stands

*Anchored 2026-09-07 at `bded9f7`: 2669 tests, 180 files, green, plus
`test:gate` and `test:fixture-pair`. **Re-anchored the same day at `39f9ee1`
(branch `p6b`): 2687 tests, 181 files** — eighteen of them written by
[P6B.1](24-p6b-playable.md) over code that six phases of green had not
questioned, which is the number this file's opening claim is about. [12 §1](12-p2-manual-gate.md)'s own anchor
reads 1186 and is two phases stale — noted rather than edited, because that
document's anchor is a record of when it was walked and moving it would be a
claim nobody made.*

| Gate | Steps | Automated | Walked | What is left, and by whom |
|---|---|---|---|---|
| **P1** | — | the named gate test | — | Its exit is the CI step, which runs. Nothing outstanding. |
| **P2 / P2A / P2B** | 20 / 17+2 / 11 | 8 / 13 / 9 | as far as automation goes | [12 §2](12-p2-manual-gate.md) — a real provider, a real browser, both platforms. §3.5 below. |
| **P2C** | 4 stages | P2C.0 only | **P2C.1–.4 never ran** | The boundary has since been crossed by ordinary use; what was never done is *capture*. [P6B §1.6](24-p6b-playable.md) folds it into the play. |
| **P3** | 15 | most | **no record of a walk** | Step 12 — *somebody who did not build the turn explains it from the panel* — is PLAYABLE's fourth hypothesis wearing a step number. §3.3. |
| **P4** | 15 | most | **no record of a walk** | Step 1 wants a real imported library. Person-blocked with lead time. §3.4. |
| **P5** | 18 | partly | **never walked; the reasons a walk would have failed are fixed** | [P6B.1](24-p6b-playable.md) prepared it — six defects fixed, four contradictions settled, steps 6/8/11/12 amended. The walk itself is outstanding and is a person's. |
| **P6** | 14 | steps 2–14 | **unwalked** | Step 1, the wall-clock half of 14, and the demo. §3.2. |
| **P6A** | 13 | 1, 2, 13 partly | **steps 3–12 unwalked** | A Docker daemon, an unraid host, a second machine. §3.1. Partly walked 2026-09-07 by the first install. |
| **PLAYABLE** | the four hypotheses | none, by definition | **never run** | [P6B.2](24-p6b-playable.md). |

**Two things that table makes plain and no single document did.**

**Every gate from P3 onward is unwalked**, and each phase document says so
about itself while none of them says it about the sequence. Read one at a time
they are five honest local statements; read together they are one fact, which is
that the project has been closing phases on a green suite for four phases —
which is exactly what [P5 §0.5](07-p5-implementation.md) warned about in its own
case: *a green suite is not a walked gate.*

**And the walks are not independent.** P3 step 12, P4 step 1, P5 step 6, P6
step 1 and PLAYABLE's four hypotheses all want the same thing: **a real
imported library and a long session played by a person.** One arrangement
answers five obligations, which is the argument for sequencing them here rather
than letting each phase's revisit rediscover its own.

---

## 2. What P6B clears, and what it does not

**Clears:**

- **P5's entire gate** — [P6B.1](24-p6b-playable.md) settles its four
  contradictions, fixes the two live defects, and walks all eighteen steps.
  Except step 6, which needs the corpus (§3.4).
- **PLAYABLE** — [P6B.2](24-p6b-playable.md), and with it the four hypotheses,
  P5's four held-open questions and P6's two.
- **P3 step 12**, in substance: it is the fourth hypothesis, and a session
  played in P6B.2 is the turn nobody scripted. §3.3 says what to record so the
  step can be marked rather than assumed.
- **The P2C findings log's empty triage** — [P6B.3](24-p6b-playable.md) is a
  triage stage and [16](16-p2c-log.md) holds fourteen findings under a table
  with no rows.

**Does not clear:**

- **P6A steps 3–12** — a container, an unraid host, a second machine. §3.1.
- **P6 step 1 and 14's wall-clock half** — they want a *long* session; P6B.2
  produces one, so they are cheap immediately after and impossible before. §3.2.
- **P4 step 1 and P5 step 6** — the corpus, person-blocked with lead time. §3.4.
- **[12 §2](12-p2-manual-gate.md)'s remainder** — the P2-era manual list, most
  of which PLAYABLE incidentally exercises without recording. §3.5.
- **Everything in §4.**

---

## 3. The passes, after P6B

Ordered by what each needs arranged in advance, longest lead first.

### 3.1 The container walk — [P6A §3](23-p6a-alpha-1.md) steps 3–12

**Needs:** a machine with a Docker daemon, an unraid host with a registry
credential, and a second machine to sign in from.

**Partly walked already, 2026-09-07**, by the first install: the template
pulled, the container started, and three findings came out of it — a root-owned
appdata directory, the icon that cannot exist while the repository is private,
and a setup token nobody could find. All three are fixed. What that walk did
*not* cover is step 7 (a turn from another machine), step 9 (restart with the
volume), step 10 (the stamp refusing an older build), and step 12 (an
unauthenticated pull failing).

**Answers:** whether the artifact this project cuts is actually installable by
somebody who is not its author.

**Unblocks:** [P10.0](21-p10-implementation.md), which is a re-verification of
this path against an artifact it inherits rather than one it built.

### 3.2 The tree walk — [P6 §3](08-p6-implementation.md) step 1, and 14's clock

**Needs:** a session two hundred turns deep, against a book of a few hundred
entries. **P6B.2 is the only thing that has ever produced one.**

Step 1 is *branch from a message 200 turns back, in one action, with state at
the fork correct*. Step 14's wall-clock half is *reconstruct at that depth in a
time a person would accept* — deliberately not a CI assertion, because a
threshold on a busy runner is a flake waiting to happen.

**Do these in the same sitting as P6B.2, not after it**, while a deep session
exists. Recreating one on purpose is an afternoon; noticing you still have one
is free.

**Answers:** whether the snapshot cache earns its complexity under real depth.

**Unblocks:** [P6 §5](08-p6-implementation.md)'s snapshot-interval question, and
[P8](19-p8-implementation.md)'s cadence sizing, which wants real turn volumes.

### 3.3 The legibility walk — [P3 §4](05-p3-implementation.md) step 12

**Needs:** a turn the walker did not script, and the discipline to answer from
the panel alone — no log, no source, no JSON pretty-printer.

**It is PLAYABLE's fourth hypothesis** ([01 §4.1](01-work-plan.md)), the one
that document calls likeliest to be wrong and cheapest to fix at the checkpoint.
P6B.2 will produce the turns; what makes it a *walk* rather than an impression
is the step's own honest counterpart: **at least one turn where the answer is
*I could not tell*, written down with what was missing.**

**Record it in [25](25-playable-log.md)**, not in 16 — the log for the phase
that produced the turn.

**Answers:** whether the turn record is legible rather than merely complete,
which is the claim [00 §1](../00-stance.md) rests on.

### 3.4 The real-library walk — the corpus

*[P4](06-p4-implementation.md) step 1 and [P5](07-p5-implementation.md) step 6,
which are one arrangement.*

**Needs:** a used SillyTavern data directory, a used Marinara install, and a
handful of explicitly-permissive real lorebooks. **None of it is in the
repository and none of it can be synthesised**, which is what *person-blocked
with lead time* means — [10 §5](10-testing.md)'s corpus policy is a plan, not a
record that it ran, and [10 §268](10-testing.md) says the private corpus does
not exist yet.

**This is the longest lead item in the file and the only one that cannot be
started by deciding to.** Acquiring it is worth beginning before P6B.2 rather
than after, because P4 step 1, P5 step 6 and the third PLAYABLE hypothesis all
read the same shelf — and a checkpoint run against synthesised books answers the
budgeter question about a library nobody has.

**Answers:** what real cards actually do, which is the stated reason import
lands early at all ([01 §1](01-work-plan.md)).

### 3.5 The P2-era remainder — [12 §2](12-p2-manual-gate.md)

Five sections there, and PLAYABLE exercises most of them incidentally. The point
of naming them is that *incidentally* is not *recorded*:

- **§2.1 one session end to end** — subsumed by P6B.2.
- **§2.2 a real provider** — subsumed, and [P6B §1.6](24-p6b-playable.md) adds
  the capture that P2C wanted.
- **§2.3 the browser under real conditions** — a phone, a slow network, a second
  tab. Not subsumed; nothing in P6B asks for a phone.
- **§2.4 what only a person can judge** — subsumed by the hypotheses.
- **§2.5 both platforms** — the ubiquitous one. CI runs both legs; **no person
  has ever watched the ubuntu leg's app**, which is
  [12 §4.5](12-p2-manual-gate.md) and stays open.

**The honest summary:** after P6B, what genuinely remains from the P2 era is
§2.3 and §2.5 — the browser under conditions nobody has reproduced, on the
platform nobody has watched.

---

## 4. Deferred explicitly, with an owner

*The point of this section is that everything in it has a name beside it.
Anything that loses its owner comes back to §1's rule.*

| Item | Where it was made | Owner | Why deferred |
|---|---|---|---|
| The permissive corpus | [P4 §0](06-p4-implementation.md), [P5 §1.6](07-p5-implementation.md) | whoever acquires it; blocks P4 step 1 and P5 step 6 | Person-blocked with lead time. Cannot be synthesised. §3.4 |
| **F22's leftover** — the rebuild/watcher divergence over a refused path | [P2 §782](04-p2-implementation.md) | ~~P2.7~~ **nobody: that stage does not exist** | See below. **This is the sweep's sharpest finding.** |
| P2 gate step 8 / F12 — an editor-page mount rather than a component mount | [P2 §958](04-p2-implementation.md) | unassigned; "unblocked rather than done" | The harness exists now, so it is a test somebody has to write |
| A killed *process* names no model call | [12 §3.6](12-p2-manual-gate.md) | the suite's one `it.todo`, `recovery.test.ts` | Needs a provisional call in the checkpoint |
| The record cannot say a block is advisory | [12 §3.6](12-p2-manual-gate.md) | unassigned | `assemble()` drops `Candidate.advisory`; `ModelCall` records no purpose. **[P7](18-p7-implementation.md) makes this expressible or it stays unexpressible** |
| Two clock-effect constructors disagree; `clockEffect` has no production caller | [12 §3.6](12-p2-manual-gate.md) | unassigned | Dead code with a disagreement in it |
| A turn carries no money total | [12 §3.6](12-p2-manual-gate.md) | [01 §2](01-work-plan.md)'s day-one list says record cost now, display later | `costOf()` never aggregates. The recording is done; the aggregate is not |
| `requestId` unbound on job log lines | [12 §3.6](12-p2-manual-gate.md) | deferred **with a written reason** — the model | A turn outlives its request; carrying one means a column, a migration and a meaning |
| Nightly tier, dependency-licence scan, forward-port check | [10 §6](10-testing.md), [11 §8](11-repo-and-releases.md) | [P11](22-p11-implementation.md) | Beta-gate work; `testing` landed early at alpha.2 and nightly did not |
| Restore test, upgrade test | [01 §8](01-work-plan.md), [06 E6](../06-open-questions.md) | [P11](22-p11-implementation.md) | "An untested restore is not a backup" — and it is 1.0 scope |
| Release-line support window; release-branch cut point | [11 §8](11-repo-and-releases.md) | [P11](22-p11-implementation.md) | Cheap to declare now, awkward later; no release line exists yet |
| The eight polish items | [09](09-polish.md) | unscheduled by design | The file's own house rule: user-facing, bounded, not roadmap |

### 4.1 The dangling owner, which is the finding this sweep exists to have produced

**F22's leftover is owned by `P2.7`, and P2 has stages P2.0 through P2.6.**

The sentence that assigned it says exactly why it was assigned:

> *"**Still open, and now owned by P2.7** — P2.6 opened the same code and did not
> take it, so leaving it pointed at a closed stage is how it becomes nobody's."*

It was moved off a closed stage and onto a stage that was never created, so it
became nobody's by the other route. That is [01 §0.5](01-work-plan.md)'s *a bar
nobody owns is a wish* in miniature, and it is the exact failure
[18 §0](18-p7-implementation.md) says a skeleton exists to prevent — **a
deferral nobody collects is a deferral that gets lost.**

**It needs an owner before this file is worth anything**, and the honest
candidates are two: fold it into [P6B.1](24-p6b-playable.md), which is already
opening the index and storage code for the `orphan-fts` assertion and the
migration test; or write it into [P11](22-p11-implementation.md)'s audit as a
known defect with a test to write. **The recommendation is P6B.1**, because the
work is in the same file and the alternative is a fifth year of the same
sentence.

**Taken, and closed 2026-09-07 at `0e228ec` — and it was not the small thing
the sentence made it sound.** Opening the code found a *live divergence* rather
than an unreconciled asymmetry: a rebuild refused a folder whose name this build
will not resolve and counted a silent skip, while the watcher never applied the
rule at all and **indexed a row pointing at a file no read in this build can
open** — every read goes back through the same builder, which throws. Indexing
it was worse than not indexing it.

**Neither the P1 gate nor any unit test could have caught it, and the two
reasons are why it lasted six phases.** The gate compares what got indexed, and
the disagreement was about something that did not: it lived in a table the
comparison never read. And the folder names in question cannot be created on the
machine this repository is developed on, so a test that made one would be a test
that never ran here — the seam is the layout instead, which refuses one ordinary
slug on demand.

Both producers now ask the same function, the refusal is recorded rather than
counted, a rebuild clears that table like every other stale belief it must not
preserve, and the snapshot reads it — **an absence has to be in the comparison
or it is not compared.**

*The general lesson, since this section exists to have produced one:* the
sentence was six phases old and read like bookkeeping. It was a defect. **A
deferral nobody collects is not merely lost; it stops being read, and what it
says stops being checked.**

---

## 5. Should be a test, and is not yet

[12 §4](12-p2-manual-gate.md) carried five. Their state today:

- **4.1 a recorded transcript tier for the provider adapters** — the machinery
  landed (`*.live.test.ts`, cassettes into `captures/`, promotion by hand), and
  **no cassette has ever been promoted**: there is no
  `packages/server/src/providers/fixtures/`. [P6B §1.6](24-p6b-playable.md)
  captures during play; promoting is what closes this.
- **4.2 nobody fuzzes a hand-written file, and every one of them is
  hand-written** — still open, and it is the one that found six real defects in
  one pass. The sharpest class in the file.
- **4.3 two clients on one session, at the DOM tier** — still open. P6's
  stale-head work made the server half testable and the DOM half is untested.
- **4.4 the suite is load-sensitive** — still open.
- **4.5 the ubuntu leg has never been watched** — still open, and now also
  §3.5's last item.

**What this sweep adds to that list:**

- **The seed script had no test until [P6B.0](24-p6b-playable.md)**, and the
  reason it shipped broken through two phases is that nothing looked at it. Any
  other dev script in `tools/` is in the same position.
- **A request body can be built wrong under a green suite.**
  [P6B.0](24-p6b-playable.md) found `createSession` could send `{name}` alone
  with both page tests passing, because they mock the function. Every other
  client call whose body is assembled from optional fields has the same shape
  and no equivalent test.

---

## 6. Where a finding goes

Two logs, and they are not interchangeable:

- **[16](16-p2c-log.md)** — P2C's. Closed to new entries; its fourteen still
  need triage rows ([P6B.3](24-p6b-playable.md)).
- **[25](25-playable-log.md)** — P6B's, and the one to use for anything found in
  §3's passes, including the ones that happen after P6B closes. It carries the
  record format and the two rules that matter: `expected` before `observed`, and
  the file is not a queue.

**A pass in §3 that produces no written finding produced no finding.** That is
not a slogan: [P2C](15-p2c-first-real-run.md) is the phase that proved it, and
the reason its log exists is that the first pass's observations were not
reconstructible afterwards.

---

## 7. What this file asks of every future phase

One line, and it is the reason to keep the ledger rather than to have written
the sweep once:

> **When a phase closes, its gate goes in §1 with a state, and anything it
> deferred goes in §4 with a name beside it.**

The alternative is what this sweep found: five gates unwalked, one obligation
owned by a stage that does not exist, and no single place where either fact was
visible.
