# StoryEngine — Work plan

**What gets built, in what order, and what is left to do.** The design lives one
level up in [`../`](../) and answers *what this is and why*; these documents
answer *when*, and several of them are worked from rather than argued with.

**Cited by name, not by number**, and the number is filing order rather than a
citation key. Work-plan documents are referenced as
[`work plan §4.1`](01-work-plan.md), [`triage §6.2`](02-triage.md),
[`P1 §1.3`](07-p1-implementation.md),
[`P2A §2.5`](09-p2a-configuration-surface.md),
[`P2B §1.2`](10-p2b-provider-configuration.md), [`P6A §1.8`](19-p6a-alpha-1.md),
[`polish §4`](06-polish.md), [`testing §2`](03-testing.md) and
[`releases §2`](04-repo-and-releases.md).
Design documents keep their numbers — a bare `[testing §5]` or `[playable log §1]` is one level
up, and unambiguously so, because nothing here is cited by a number.

**That is what makes the ordering below maintainable.** Nothing points at a
work-plan number, so a document can move into its right place for nothing —
which is how these came to be in execution order at all.
[`tools/doc-links.test.ts`](../../../tools/doc-links.test.ts) enforces both
halves and refuses a work-plan file that has no name in the registry.

## The documents

| Doc | What it covers |
|---|---|
| [work plan-work-plan.md](01-work-plan.md) | Sequence to beta, and the day-one checklist of now-or-never decisions |
| [triage-triage.md](02-triage.md) | Build-versus-fork, and per-subsystem verdicts on the source projects: adopt, port, rebuild, discard, buy |
| [P1-p1-implementation.md](07-p1-implementation.md) | P1 in detail — stages, the decisions the design left open, and the exit gate |
| [P2-p2-implementation.md](08-p2-implementation.md) | P2 in detail — the P1 audit and hardening stage, the turn pipeline, and the exit gate |
| [P3-p3-implementation.md](15-p3-implementation.md) | P3 in detail — the workbench as a reader over the record |
| [P4-p4-implementation.md](16-p4-implementation.md) | P4 in detail — import from the three sources, presets first; ends at PLAYABLE |
| [P5-p5-implementation.md](17-p5-implementation.md) | P5 in detail — the lorebook as a document, then lore activation, budgets, trim order, skip reporting. Landed and merged; §0.5 is the close-out audit, and the decisions that need PLAYABLE are still marked open |
| [P6-p6-implementation.md](18-p6-implementation.md) | P6 in detail — reconstruction at every node, the head gate and the snapshot cache first, then branching UI, rewrite/reroll and sibling navigation. Audited three times before it opened; landed and merged, with §3 marking what the suite covers and what still needs a person |
| [polish-polish.md](06-polish.md) | Bounded user-facing improvements that are not roadmap items — a working todo list |
| [testing-testing.md](03-testing.md) | Testing, validation and CI — what to build, what to automate, what to skip |
| [releases-repo-and-releases.md](04-repo-and-releases.md) | Project phases, branching and release model; draft CONTRIBUTING.md |
| [manual gate-p2-manual-gate.md](11-p2-manual-gate.md) | What the machine cannot check, across P2, P2A and P2B: what needs a person, what will fail because it is not built, and what should be a test |
| [P2A-p2a-configuration-surface.md](09-p2a-configuration-surface.md) | P2A in detail — [10 §15](../10-ui-surfaces.md)'s core pulled forward, and the config subsystem repaired before a form displays it |
| [P2B-p2b-provider-configuration.md](10-p2b-provider-configuration.md) | P2B in detail — system connections and the install default bindings through the UI, and the fallback layer three documents assume and nothing implements |
| [P2C-p2c-first-real-run.md](12-p2c-first-real-run.md) | P2C in detail — the first time a person and a real model meet this software, and the twenty-two things to repair before they do |
| [P2C log-p2c-log.md](14-p2c-log.md) | P2C's findings log — appended to as things happen, emptied by its triage, kept afterwards |
| [P2C brief-p2c-brief.md](13-p2c-brief.md) | What the tester has in front of them on the day: the runbook, and the long list of what not to report |
| [P7-p7-implementation.md](23-p7-implementation.md) | P7 skeleton — the mode contract made real, channels, hooks, goals, party, mentions, two modes. Still the largest, and §5 argues P7.0 *is* the phase. §0.1 is the readiness audit: the phase in front of us, with PLAYABLE the only thing before it |
| [P7B-p7b-presets-and-prompts.md](24-p7b-presets-and-prompts.md) | P7B skeleton — presets and prompt handling into a usable state: the built-in pack as a library object, a preset editor, a treatment editor, a session-settings panel, and edit-a-block through the pack. Written 2026-09-11 while P7 runs on its branch, and **filed at 28 with its place at 24**, so nothing renumbers under P7's document until it merges. **Widened 2026-09-14** by a second sweep that found the same failure on five more surfaces — the setup and package editors, session delete and archive, the workbench on any turn, the import quarantine's listing, and home as a changelog-only prototype |
| [P8-p8-implementation.md](25-p8-implementation.md) | P8 in detail — the rolling summary as an immutable chain, and memory as an auto-maintained lorebook. ~~Waits on three phases rather than on time~~ **all three landed, and §0.1 is the revisit they were waited for**: the storage fork settled, cadence narrowed to a procedure, and three findings that move the phase — the spoiler defence is not buildable through `reads` as the step contract stands, nothing on the lore path can be advisory, and this is the first producer of an escaped effect |
| [P9-p9-implementation.md](26-p9-implementation.md) | P9 skeleton — renditions: the contract that does not exist yet, then illustration and the backdrop. The phase most dependent on other phases having gone well |
| [P10-p10-implementation.md](27-p10-implementation.md) | P10 skeleton — reachable and safe for someone who is not the developer: bind, token, notifications, the gallery. Two phases wearing one number |
| [P11-p11-implementation.md](28-p11-implementation.md) | P11 skeleton — the beta gate: the audit, the reading view, the assistant, the sweeps, release engineering. A plan for producing a plan |
| [P12-p12-implementation.md](29-p12-implementation.md) | P12 — backups a person can take, list, delete, import and restore, from the web UI, on a schedule. The one phase that reverses a decision marked *Opinionated*: [25 E6](../25-open-questions.md) said *do not build a subsystem*, and §0 is the four arguments for doing it anyway — chiefly that E6 reasoned about a process on the **outside**, and from the inside `VACUUM INTO` and the atomic write path make this strictly more consistent than the script. §0.5 records two defects in what [P11.11](28-p11-implementation.md) shipped, one of which meant the derived index was in every archive ever written |
| [P13-p13-aventuras-import.md](30-p13-aventuras-import.md) | P13 — the whole of an Aventuras install in one import: the library now (Part 1, planned to the stage), the stories after (Part 2, headed and **not scheduled**, as a producer of P11.10's session format rather than an importer of its own). Design only, 2026-09-26. §0.4 records three findings against shipped code, one of them in P11.10's `importSession` |
| [P14-p14-scene-and-session-import.md](31-p14-scene-and-session-import.md) | P14 — **Scene built out to [06 §7.2](../06-modes-and-turn-pipeline.md)'s spec**, a functional equivalent of a SillyTavern or Marinara roleplay chat (embodied voice, per-actor dispatch, ST's four activation strategies, greetings, swipes, continue, force-talk, edit, hide), **then session import from both into it**. §0.6 is why this finishes a mode rather than inventing one; §1.1 adds `Turn.output.messages`, the first field on the frozen record |
| [P6A-p6a-alpha-1.md](19-p6a-alpha-1.md) | P6A in detail — Alpha 1: the first build you can go back to. An artifact, not a distribution; and the three things standing in front of the release flow that are not release engineering. All five stages landed, the phase closed on its merge, and Alpha 1 was cut 2026-09-06 with its image built; the rest of the exit gate needs a person with Docker |
| [P6B-p6b-playable.md](20-p6b-playable.md) | P6B in detail — PLAYABLE, three phases late, plus P5's unwalked close-out. Why it never ran (nothing chooses a session's lorebooks), the repairs that make its findings trustworthy, and the bar that keeps them repairs rather than features |
| [playable log-playable-log.md](21-playable-log.md) | P6B's findings log — the receptacle [P5 §0.4](17-p5-implementation.md) noticed had never been created. Appended to as things happen, emptied by P6B.3's triage, kept afterwards |
| [manual testing-manual-testing.md](05-manual-testing.md) | **What a person still owes, and what they did about it — standing, and it does not complete.** Every gate’s state, the sittings walked and outstanding, the prerequisites with long lead times, what a test now covers, what should be a test and is not, and every deferral with a name beside it. A phase that closes lands its gate here |
| [refinements-walkthrough-refinements.md](22-walkthrough-refinements.md) | The eleven refinements from the 2026-09-08 walkthrough, graded against the code and the design corpus — eight of them are not what the note says. Where each goes, what it costs, and the four decisions a person has to make first |

## How to read them

**Start with [work plan](01-work-plan.md).** It carries the phase list, the day-one
checklist of decisions that are cheap now and expensive later, and the
[PLAYABLE checkpoint](01-work-plan.md) — the milestone that matters more than
beta does, because it is where the design starts being tested by use.

**The phase documents are written just ahead of the phase, and then carry the
record.** 07 through 20 are the phases that have landed, in the order they
landed, each holding its stages struck through with what actually shipped
against what was planned; several began as skeletons and were revised as their
phases arrived. 23 through 27 are skeletons — and so is 28, filed out of order — and will be filled in as each phase
approaches. **20 is the phase in front of us** — P6B, PLAYABLE three phases
overdue, which [P7 §0.1](23-p7-implementation.md) found blocking its own demo as
much as the checkpoint's; P7 follows it.

*They are in execution order, which they were not until 2026-09-09.* Filed by
the date they were written, the lettered phases sat at the tail — P2A, P2B and
P2C after P6, and P6A and P6B after P11 — so reading by number went forward to
P6, back to P2A, forward to P11, and back again to two phases that run before
it. Two backward jumps in one sequence.

**One document is filed out of order on purpose, and says so.**
[P7B](24-p7b-presets-and-prompts.md) belongs after P7 and before P8, which is
24; taking that number renumbers P8 through P11 and repoints every citation to
them, including the ones inside the P7 document a branch is editing. So it sits
at the first free number, `PLAN_ORDER` in
[`tools/renumber-docs.mjs`](../../../tools/renumber-docs.mjs) already holds its
real position, and one scripted run after P7 merges moves it — the
twenty-minute operation that script exists to make cheap.

**Two phases are manual, and both carry a log.** P2C and P6B are the phases
whose deliverable is *what a person saw*, so each has a findings log beside it —
14 and 21 — with the same record format and the same rule: appended to as things
happen, emptied by the phase's triage, and never a queue. 13 is P2C's tester's
brief, and it holds the only runbook in the corpus; P6B carries its own *what
not to report* section instead, because the same person is playing.

**05 is what a person still owes, and it does not complete.** It began as a
sweep that found what had accumulated behind the P2-era gate — **five phase
gates unwalked and one obligation owned by a stage that does not exist** — and
it carries the rule the corpus was missing: a gate is walked, deferred with an
owner and a reason, or **handed over with the sitting named** — and there is no
fourth state. That third arm is the two-tier gate, adopted 2026-09-09 and argued
at [manual testing §0](05-manual-testing.md): a phase closes on a small critical
list walked now, and its remainder extends the standing list.

It absorbed the walk sheet on 2026-09-08, because counting what is owed and
listing what to do about it is one job at two levels of detail. **11 is the
P2-era original**, historical now and still cited, because thirty of the
sittings cite it for the *reasoning* behind a step. A phase that closes lands
its gate in 05 as sittings.

**19 is the one written neither ahead of its phase nor behind it**, which is a
third case worth naming because the others are all compromises with distance.
P6A was proposed and planned the day P6 merged, so it carries no skeleton, no
half-revisit and no **[AWAITS]** marker: every precondition it depends on was
checkable while it was being written, and its status line says so. The cost is
that nothing in it has been slept on; the benefit is that its readiness audit is
not a forecast — and its §0 found that the phase was about twice the size its own
one-line scope implied, which is the kind of thing only an audit against the code
turns up. That §0 is the shape to copy when a phase starts sooner than its
document expected. It closed the way it opened, quickly: five stages in a day,
the gate annotated the day after, and the twelve container steps left to a
person, because there was no daemon on the machine that wrote it.

**17 is the one written *half* ahead of its phase, and says so.** P5 sits behind
PLAYABLE, which has not run — so it carries a readiness audit against the code,
the decisions that audit forces, and four marked **[AWAITS PLAYABLE]** questions
left deliberately open. That is the honest shape for a plan whose evidence is
obtainable but not yet obtained, and it is a pattern worth reusing: a revisit
that closes what it can and names what it cannot beats one that waits.
A phase document is not a design document: where one contradicts the design, the
design is what to fix first — and 10 §1 is that case, three documents describing
a fallback layer no code implements.

**Every phase through 1.0 has a document, and the far ones are deliberately
thin.** There are no phase documents past 1.0 and that is deliberate too: the
releases after it ([work plan §0](01-work-plan.md)) have scopes rather than phase
breakdowns, because sequencing 2.0 against a substrate that does not exist yet
would be the guessing this folder exists to avoid. 23 through 27 were written in
one pass so that the phases after PLAYABLE have addresses rather than paragraphs
in [work plan](01-work-plan.md) — but a skeleton five phases out is not a plan, and
[P7 §0](23-p7-implementation.md) states in one place what all five are for:
**collect the deferrals already made to the phase, name the decisions the
revisit has to make, and hold the shape of the exit gate.** The first of those
is the load-bearing one. More than a dozen documents have sent something to P7
alone, and a deferral nobody collects is a deferral that gets lost — which is
the failure [work plan §2.3](01-work-plan.md) exists to prevent, read from the far end.

**18 and 23 through 27 each gained a §0 and a §5 on 2026-08-31** — a readiness
note saying what is auditable *today* rather than on the day, and an honest-size
section naming what only the revisit can settle. The deferral collections were
checked first, against a sweep of every reference to each phase across both
folders, and came back complete: the load-bearing job was already done, so the
addition is the other two.

**The readiness note is the part that goes stale, and re-running it is cheap** —
which is the pattern to keep as each revisit comes round.
[P6 §0](18-p6-implementation.md) is the worked example: it found that P2 had
bought more than P6's own text claimed, that a config key ships `unread` with
this phase's name on it, and that three other phases had quietly handed P6
decisions. None of that was visible from P6 alone.

**A revisit is worth more than a first draft, and 15 is the evidence.** Its
skeleton instructed itself to be re-read *against what the P2 turn record
actually looks like on screen*; doing that found five things the record does not
hold, two of which are one field each in P2's record rather than work for P3 —
and one of those makes a testing invariant inexpressible. None of it was
visible while the record was a design.

**10 carries a §6 the others do not**, listing what
[P2A](09-p2a-configuration-surface.md) has to settle before its remaining open
questions can close. It is written to be read at the revisit rather than
re-derived.

**Phases are undotted and stages are dotted**, and the two are not
interchangeable: `P2` is a phase, `P2.4` is a stage inside it, and `P2A` is the
phase that follows P2 without renumbering P3. The dotted form doubles as a
timestamp throughout these documents — *"added at P2.5"* names a stage, never a
release.

**[polish-polish.md](06-polish.md) is the odd one out**, and deliberately here
rather than in the feature list. Its entries are user-facing, bounded, and need
no schema change and no new contract — the difference between a surface that
works and one that is pleasant. The bar for the feature list
([24 up one level](../24-roadmap.md)) is a deferred *feature*; anything that
clears it leaves this file and picks up a priority tier there.

**[triage-triage.md](02-triage.md) is history that still binds.** It records what
was taken from Aventuras, Marinara Engine and SillyTavern and what was
deliberately left, and the discard verdicts are the ones worth re-reading before
proposing something that looks obviously missing.

**§2A is the one part of it that is not history.** It decides the *base* rather
than the parts — standalone rather than a Marinara fork, and not the third
framing that skips the argument and contributes upstream instead — and it is
written with its measurements and its reopening conditions attached, so that the
question can be re-checked rather than re-argued.
