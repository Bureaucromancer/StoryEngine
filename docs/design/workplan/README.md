# StoryEngine — Work plan

**What gets built, in what order, and what is left to do.** The design lives one
level up in [`../`](../) and answers *what this is and why*; these documents
answer *when*, and several of them are worked from rather than argued with.

**Cited by name, not by number.** Both folders number from `01`, so a bare `02`
would mean two documents. Work-plan documents are referenced as
[`work plan §4.1`](01-work-plan.md), [`triage §6.2`](02-triage.md),
[`P1 §1.3`](03-p1-implementation.md),
[`P2A §2.5`](13-p2a-configuration-surface.md),
[`P2B §1.2`](14-p2b-provider-configuration.md), [`polish §4`](09-polish.md),
[`testing §2`](10-testing.md) and [`releases §2`](11-repo-and-releases.md).
Design documents keep their numbers — `[02 §5]`, `[13 §1]`.

## The documents

| Doc | What it covers |
|---|---|
| [01-work-plan.md](01-work-plan.md) | Sequence to beta, and the day-one checklist of now-or-never decisions |
| [02-triage.md](02-triage.md) | Build-versus-fork, and per-subsystem verdicts on the source projects: adopt, port, rebuild, discard, buy |
| [03-p1-implementation.md](03-p1-implementation.md) | P1 in detail — stages, the decisions the design left open, and the exit gate |
| [04-p2-implementation.md](04-p2-implementation.md) | P2 in detail — the P1 audit and hardening stage, the turn pipeline, and the exit gate |
| [05-p3-implementation.md](05-p3-implementation.md) | P3 skeleton — the workbench as a reader over the record |
| [06-p4-implementation.md](06-p4-implementation.md) | P4 skeleton — import from the three sources, presets first; ends at PLAYABLE |
| [07-p5-implementation.md](07-p5-implementation.md) | P5 skeleton — lore activation, budgets, trim order, skip reporting |
| [08-p6-implementation.md](08-p6-implementation.md) | P6 skeleton — branching UI, reconstruction, rewrite/reroll, sibling navigation |
| [09-polish.md](09-polish.md) | Bounded user-facing improvements that are not roadmap items — a working todo list |
| [10-testing.md](10-testing.md) | Testing, validation and CI — what to build, what to automate, what to skip |
| [11-repo-and-releases.md](11-repo-and-releases.md) | Project phases, branching and release model; draft CONTRIBUTING.md |
| [12-p2-manual-gate.md](12-p2-manual-gate.md) | What the machine cannot check, across P2, P2A and P2B: what needs a person, what will fail because it is not built, and what should be a test |
| [13-p2a-configuration-surface.md](13-p2a-configuration-surface.md) | P2A in detail — [05 §15](../05-ui-surfaces.md)'s core pulled forward, and the config subsystem repaired before a form displays it |
| [14-p2b-provider-configuration.md](14-p2b-provider-configuration.md) | P2B in detail — system connections and the install default bindings through the UI, and the fallback layer three documents assume and nothing implements |
| [15-p2c-first-real-run.md](15-p2c-first-real-run.md) | P2C in detail — the first time a person and a real model meet this software, and the twenty-two things to repair before they do |
| [16-p2c-log.md](16-p2c-log.md) | P2C's findings log — appended to as things happen, emptied by its triage, kept afterwards |
| [17-p2c-brief.md](17-p2c-brief.md) | What the tester has in front of them on the day: the runbook, and the long list of what not to report |

## How to read them

**Start with [01](01-work-plan.md).** It carries the phase list, the day-one
checklist of decisions that are cheap now and expensive later, and the
[PLAYABLE checkpoint](01-work-plan.md) — the milestone that matters more than
beta does, because it is where the design starts being tested by use.

**The phase documents are written just ahead of the phase.** 03, 04, 13, 14 and
15 are detailed because they are current or just finished; 05 was a skeleton and
has been revised now that P3 is next; 06 through 08 are still skeletons and will
be filled in as each phase approaches. A phase document is not a design document:
where one contradicts the design, the design is what to fix first — and 14 §1 is
that case, three documents describing a fallback layer no code implements.

**A revisit is worth more than a first draft, and 05 is the evidence.** Its
skeleton instructed itself to be re-read *against what the P2 turn record
actually looks like on screen*; doing that found five things the record does not
hold, two of which are one field each in P2's record rather than work for P3 —
and one of those makes a testing invariant inexpressible. None of it was
visible while the record was a design.

**14 carries a §6 the others do not**, listing what
[P2A](13-p2a-configuration-surface.md) has to settle before its remaining open
questions can close. It is written to be read at the revisit rather than
re-derived.

**Phases are undotted and stages are dotted**, and the two are not
interchangeable: `P2` is a phase, `P2.4` is a stage inside it, and `P2A` is the
phase that follows P2 without renumbering P3. The dotted form doubles as a
timestamp throughout these documents — *"added at P2.5"* names a stage, never a
release.

**[09-polish.md](09-polish.md) is the odd one out**, and deliberately here
rather than in the roadmap. Its entries are user-facing, bounded, and need no
schema change and no new contract — the difference between a surface that works
and one that is pleasant. The bar for the roadmap ([14 up one level](../14-roadmap.md))
is a deferred *feature*; anything that clears it leaves this file.

**[02-triage.md](02-triage.md) is history that still binds.** It records what
was taken from Aventuras, Marinara Engine and SillyTavern and what was
deliberately left, and the discard verdicts are the ones worth re-reading before
proposing something that looks obviously missing.

**§2A is the one part of it that is not history.** It decides the *base* rather
than the parts — standalone rather than a Marinara fork, and not the third
framing that skips the argument and contributes upstream instead — and it is
written with its measurements and its reopening conditions attached, so that the
question can be re-checked rather than re-argued.
