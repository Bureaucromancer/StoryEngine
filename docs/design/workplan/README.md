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
| [05-p3-implementation.md](05-p3-implementation.md) | P3 in detail — the workbench as a reader over the record |
| [06-p4-implementation.md](06-p4-implementation.md) | P4 in detail — import from the three sources, presets first; ends at PLAYABLE |
| [07-p5-implementation.md](07-p5-implementation.md) | P5 in detail — the lorebook as a document, then lore activation, budgets, trim order, skip reporting. Audited twice; §0.1 is the current readiness, and the four decisions that need PLAYABLE are marked, open, and given a window in §0.3 |
| [08-p6-implementation.md](08-p6-implementation.md) | P6 in detail — reconstruction at every node, the head gate and the snapshot cache first, then branching UI, rewrite/reroll and sibling navigation. Audited three times before it opened; §2 is a staged plan with proof obligations, and P6.0 is under way on branch `p6` |
| [09-polish.md](09-polish.md) | Bounded user-facing improvements that are not roadmap items — a working todo list |
| [10-testing.md](10-testing.md) | Testing, validation and CI — what to build, what to automate, what to skip |
| [11-repo-and-releases.md](11-repo-and-releases.md) | Project phases, branching and release model; draft CONTRIBUTING.md |
| [12-p2-manual-gate.md](12-p2-manual-gate.md) | What the machine cannot check, across P2, P2A and P2B: what needs a person, what will fail because it is not built, and what should be a test |
| [13-p2a-configuration-surface.md](13-p2a-configuration-surface.md) | P2A in detail — [05 §15](../05-ui-surfaces.md)'s core pulled forward, and the config subsystem repaired before a form displays it |
| [14-p2b-provider-configuration.md](14-p2b-provider-configuration.md) | P2B in detail — system connections and the install default bindings through the UI, and the fallback layer three documents assume and nothing implements |
| [15-p2c-first-real-run.md](15-p2c-first-real-run.md) | P2C in detail — the first time a person and a real model meet this software, and the twenty-two things to repair before they do |
| [16-p2c-log.md](16-p2c-log.md) | P2C's findings log — appended to as things happen, emptied by its triage, kept afterwards |
| [17-p2c-brief.md](17-p2c-brief.md) | What the tester has in front of them on the day: the runbook, and the long list of what not to report |
| [18-p7-implementation.md](18-p7-implementation.md) | P7 skeleton — the mode contract made real, channels, hooks, goals, party, mentions, two modes. Still the largest, and §5 argues P7.0 *is* the phase |
| [19-p8-implementation.md](19-p8-implementation.md) | P8 skeleton — the rolling summary as an immutable chain, and memory as an auto-maintained lorebook. Waits on three phases rather than on time |
| [20-p9-implementation.md](20-p9-implementation.md) | P9 skeleton — renditions: the contract that does not exist yet, then illustration and the backdrop. The phase most dependent on other phases having gone well |
| [21-p10-implementation.md](21-p10-implementation.md) | P10 skeleton — reachable and safe for someone who is not the developer: bind, token, notifications, the gallery. Two phases wearing one number |
| [22-p11-implementation.md](22-p11-implementation.md) | P11 skeleton — the beta gate: the audit, the reading view, the assistant, the sweeps, release engineering. A plan for producing a plan |

## How to read them

**Start with [01](01-work-plan.md).** It carries the phase list, the day-one
checklist of decisions that are cheap now and expensive later, and the
[PLAYABLE checkpoint](01-work-plan.md) — the milestone that matters more than
beta does, because it is where the design starts being tested by use.

**The phase documents are written just ahead of the phase.** 03, 04, 13, 14 and
15 are detailed because they are current or just finished; 05, 06, 07 and 08
were skeletons and have been revised as their phases arrived; 18 through 22
are skeletons and will be filled in as each phase approaches.

**07 is the one written *half* ahead of its phase, and says so.** P5 sits behind
PLAYABLE, which has not run — so it carries a readiness audit against the code,
the decisions that audit forces, and four marked **[AWAITS PLAYABLE]** questions
left deliberately open. That is the honest shape for a plan whose evidence is
obtainable but not yet obtained, and it is a pattern worth reusing: a revisit
that closes what it can and names what it cannot beats one that waits.
A phase document is not a design document: where one contradicts the design, the
design is what to fix first — and 14 §1 is that case, three documents describing
a fallback layer no code implements.

**Every phase through 1.0 has a document, and the far ones are deliberately
thin.** There are no phase documents past 1.0 and that is deliberate too: the
releases after it ([01 §0](01-work-plan.md)) have scopes rather than phase
breakdowns, because sequencing 2.0 against a substrate that does not exist yet
would be the guessing this folder exists to avoid. 18 through 22 were written in
one pass so that the phases after PLAYABLE have addresses rather than paragraphs
in [01](01-work-plan.md) — but a skeleton five phases out is not a plan, and
[18 §0](18-p7-implementation.md) states in one place what all five are for:
**collect the deferrals already made to the phase, name the decisions the
revisit has to make, and hold the shape of the exit gate.** The first of those
is the load-bearing one. More than a dozen documents have sent something to P7
alone, and a deferral nobody collects is a deferral that gets lost — which is
the failure [01 §2.3](01-work-plan.md) exists to prevent, read from the far end.

**08 and 18 through 22 each gained a §0 and a §5 on 2026-08-31** — a readiness
note saying what is auditable *today* rather than on the day, and an honest-size
section naming what only the revisit can settle. The deferral collections were
checked first, against a sweep of every reference to each phase across both
folders, and came back complete: the load-bearing job was already done, so the
addition is the other two.

**The readiness note is the part that goes stale, and re-running it is cheap** —
which is the pattern to keep as each revisit comes round.
[P6 §0](08-p6-implementation.md) is the worked example: it found that P2 had
bought more than P6's own text claimed, that a config key ships `unread` with
this phase's name on it, and that three other phases had quietly handed P6
decisions. None of that was visible from P6 alone.

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
rather than in the feature list. Its entries are user-facing, bounded, and need
no schema change and no new contract — the difference between a surface that
works and one that is pleasant. The bar for the feature list
([14 up one level](../14-roadmap.md)) is a deferred *feature*; anything that
clears it leaves this file and picks up a priority tier there.

**[02-triage.md](02-triage.md) is history that still binds.** It records what
was taken from Aventuras, Marinara Engine and SillyTavern and what was
deliberately left, and the discard verdicts are the ones worth re-reading before
proposing something that looks obviously missing.

**§2A is the one part of it that is not history.** It decides the *base* rather
than the parts — standalone rather than a Marinara fork, and not the third
framing that skips the argument and contributes upstream instead — and it is
written with its measurements and its reopening conditions attached, so that the
question can be re-checked rather than re-argued.
