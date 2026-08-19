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
| [02-triage.md](02-triage.md) | Per-subsystem verdicts on the source projects: adopt, port, rebuild, discard, buy |
| [03-p1-implementation.md](03-p1-implementation.md) | P1 in detail — stages, the decisions the design left open, and the exit gate |
| [04-p2-implementation.md](04-p2-implementation.md) | P2 in detail — the P1 audit and hardening stage, the turn pipeline, and the exit gate |
| [05-p3-implementation.md](05-p3-implementation.md) | P3 skeleton — the workbench as a reader over the record |
| [06-p4-implementation.md](06-p4-implementation.md) | P4 skeleton — import from the three sources, presets first; ends at PLAYABLE |
| [07-p5-implementation.md](07-p5-implementation.md) | P5 skeleton — lore activation, budgets, trim order, skip reporting |
| [08-p6-implementation.md](08-p6-implementation.md) | P6 skeleton — branching UI, reconstruction, rewrite/reroll, sibling navigation |
| [09-polish.md](09-polish.md) | Bounded user-facing improvements that are not roadmap items — a working todo list |
| [10-testing.md](10-testing.md) | Testing, validation and CI — what to build, what to automate, what to skip |
| [11-repo-and-releases.md](11-repo-and-releases.md) | Project phases, branching and release model; draft CONTRIBUTING.md |
| [12-p2-manual-gate.md](12-p2-manual-gate.md) | P2's exit gate: what needs a person, what will fail because it is not built, and what should be a test |
| [13-p2a-configuration-surface.md](13-p2a-configuration-surface.md) | P2A in detail — [05 §15](../05-ui-surfaces.md)'s core pulled forward, and the config subsystem repaired before a form displays it |
| [14-p2b-provider-configuration.md](14-p2b-provider-configuration.md) | P2B in detail — system connections and the install default bindings through the UI, and the fallback layer three documents assume and nothing implements |

## How to read them

**Start with [01](01-work-plan.md).** It carries the phase list, the day-one
checklist of decisions that are cheap now and expensive later, and the
[PLAYABLE checkpoint](01-work-plan.md) — the milestone that matters more than
beta does, because it is where the design starts being tested by use.

**The phase documents are written just ahead of the phase.** 03, 04, 13 and 14
are detailed because they are current; 05 through 08 are skeletons and will be
filled in as each phase approaches. A phase document is not a design document:
where one contradicts the design, the design is what to fix first — and 14 §1 is
that case, three documents describing a fallback layer no code implements.

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
