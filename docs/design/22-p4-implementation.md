# 22 — P4 implementation plan

**Status: skeleton.** Drafted during P1; to be revisited before the phase
starts. The conversion tables this phase implements are already designed in
detail ([13 §8.4](13-schemas.md), [02 §2.7](02-data-model.md)); what this
document will need on revisit is mostly sequencing against the real state of
the Marinara and Aventuras formats. Format follows
[19](19-p1-implementation.md).

**P4 delivers**, from [15 P4](15-work-plan.md): import of cards, lorebooks and
presets from SillyTavern, Marinara and Aventuras — the largest PORT in the
triage ([08 §4](08-triage.md)) — turning an empty install into a realistic
library.

**The demo that defines done:** *point it at a real SillyTavern data directory
and get a populated library, with a review step showing what resolved, what
went to `compat`, and what dangled — and a converted preset whose block list,
read in the workbench, is recognisably the preset that went in.*

**And then stop: PLAYABLE falls here** ([15 §4.1](15-work-plan.md)). P4 is
sequenced before retrieval precisely because synthetic fixtures will not
surface what real cards do, and the four PLAYABLE hypotheses are only testable
against a real library. The checkpoint is a small amount of wiring beyond P4 by
definition — if it is growing, it has been misunderstood.

**The posture, in one line** ([13 §8.4.5](13-schemas.md)): *authored prose
survives intact, order is preserved, depth-injected blocks stay at their depth,
and everything that could not be carried is named in the review rather than
discovered later.* Round-tripping is not a goal and is not promised.

**CI this phase establishes:** the fixture-pair assertion — import a real ST
directory containing both cards and a preset, assemble one turn, and **no slot
resolves empty** ([16 §5.1](16-testing.md)); plus the wild corpus, which must
import without crashing ([16 §3.4](16-testing.md)).

---

## 1. Decisions this plan has to make

### 1.1 Presets are sequenced first

[15 P4](15-work-plan.md) already decides this and it holds: presets are what
make an imported library *playable* rather than merely present, and the
conversion is designed against ST's actual format. Three obligations from the
first version, restated because each is a silent-failure class:

- **Connection fields drop unconditionally and are reported**
  ([13 §8.4.4](13-schemas.md)) — the list derived from ST's own
  `sensitiveFields` category, never enumerated by hand. Not a prompt, not a
  choice.
- **Depth-injected blocks keep their depth** — `in-history` placement, which
  the P2 assembler must already support ([03 §5](03-modes-and-turn-pipeline.md));
  flattening them to the top is the conversion that runs but behaves
  differently.
- **Every lossy conversion is named in the review** — the text-completion
  preset that was "mostly sampler settings; 6 of 41 fields carried over" says
  so.

### 1.2 The wild corpus licensing question is settled before code

[16 §5](16-testing.md): cards are other people's authored content. The answer
recorded there is the plan — synthesised cards for structural edge cases in the
repo, a handful of explicitly-permissive real ones, and a larger private local
corpus for manual verification that never enters the repository. This is a
prerequisite task, not a during-P4 discovery.

### 1.3 Where import runs, and what a unit of import is

To decide on revisit. Lean: a server-side import module with routes and UI
(imports must create objects through the same write path as everything else —
watcher suppression, version history with `source: {kind: "import"}`
([18 §1.6](18-internal-contracts.md)), read-after-write), accepting both
individual files (a card PNG, a lorebook JSON, a preset JSON) and a
whole-directory sweep of an ST data directory. The directory sweep is what the
demo names; the single-file path is what people use forever after.

**Provenance on every imported object** records what it came from
(`Provenance`, [13 §3](13-schemas.md)) — which is also what the review step
reads back.

### 1.4 The review step is a feature, not a log

What resolved, what went to `compat`, what dangled, what was dropped and why —
rendered per object with the dangling-reference posture of
[00 §3.3](00-stance.md): survivable, visible, non-blocking. An import never
fails because a reference dangles; it fails only on unreadable input. Unrecognised
macros are preserved verbatim and flagged ([13 §8.4.2](13-schemas.md)) — a
mangled prompt that looks fine is worse than one that visibly needs a look.

**To resolve on revisit:** whether review is blocking (inspect then commit) or
post-hoc (import then report). Lean: import into the library immediately,
report loudly — the trash and version history already make it reversible, and a
staging area is a second library to maintain.

### 1.5 How much Marinara and Aventuras import is 1.0-shaped

ST is the well-specified target. The other two need a survey pass on revisit:
which of their objects map to portable kinds now (cards, lorebooks, presets)
versus which want machinery from later phases (Marinara scenarios → Setup;
anything channel-shaped → P7). Lean: P4 imports the three named kinds from all
three sources and *records but does not convert* what needs later machinery —
named in the review as "not yet importable", which is honest and keeps P4 from
swallowing P7.

**Expect this phase to underestimate itself** ([15 §7](15-work-plan.md)):
import fidelity across three sources with years of edge cases keeps producing
bug reports after P4. The exit gate is the demo, not the absence of edge cases.

---

## 2. Stages

### P4.0 — Corpus and harness

§1.2's fixtures; the import module skeleton with the review-report shape;
the fixture-pair CI assertion wired (failing, then green as importers land).

### P4.1 — SillyTavern presets

The full [13 §8.4](13-schemas.md) conversion: marker table, macro → Liquid
mapping, the eight special-cased fields to `wrapper`/`appliesTo`, credential
drop, per-character order warning, sysprompt and text-completion handling.

### P4.2 — SillyTavern cards and lorebooks

V2/V3 cards per [02 §2.7](02-data-model.md) — `personality` → `traits` +
`summary`, `scenario` → setting framing, embedded lorebooks extracted — checked
**against** P4.1's slot targets, which is the whole point of
[16 §5.1](16-testing.md). Lorebooks per [02 §3](02-data-model.md): activation
fields carried as-is into the [13 §5](13-schemas.md) shape (P5 makes them
fire; P4 only stores them), scoping collapsed to the `LoreScope` union, state
fields (`dynamicState`, quests, embeddings) left behind and named in the
review.

### P4.3 — Marinara, then Aventuras

Scoped by §1.5's survey. Sequenced after ST because ST is the largest corpus
and the format the other two orbit.

### P4.4 — The review surface, and the directory sweep

§1.4 rendered; the point-at-a-directory flow; the demo.

### Then: PLAYABLE

Not a stage of P4 and listed so it is not forgotten: wire the crude Scene mode
to the imported library, sit down, and play ([15 §4.1](15-work-plan.md)). The
four hypotheses get their answers here, and the answers feed the revisit of
[23](23-p5-implementation.md) before P5 starts.

---

## 3. Verification — the P4 exit gate

Sketch; expand on revisit.

1. Import a real ST data directory → populated library, review report, nothing
   crashed, nothing silently dropped.
2. The fixture-pair assertion: assemble one turn from imported card + preset →
   no slot resolves empty.
3. A preset with `proxy_password` in it → imported, credential gone,
   review names it. No "import as-is" affordance exists.
4. A depth-injected block sits at its depth in the workbench block list, not at
   the top.
5. A card with an unrecognised macro → imported, macro verbatim, flagged.
6. Re-import the same directory → duplicates handled visibly (link or
   duplicate, per [02 §7.2](02-data-model.md)'s package posture), not doubled
   silently.
7. The wild corpus imports without a crash, in CI.

---

## 4. Out of scope, deliberately

Export in any source's format (we import ST; we do not write it); instruct and
context templates ([00 §2.2](00-stance.md) — not converted, by position);
chat/session history import (**to confirm on revisit** — the sources' chat logs
are a different shape from their libraries, and PLAYABLE does not need them);
package (`.sepack`) import/export (P11-ish; it is our own format, not a port);
embeddings (left behind with the rest of the derived data); any conversion that
needs channels, modes or the rule vocabulary (§1.5 — recorded, not converted).
