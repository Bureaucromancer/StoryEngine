# 30 — P13 implementation plan

**Status: stages P13.0–P13.9 built on `claude/nice-davinci-xjdpf6`, 2026-09-26,
and not merged. ***The exit gate ([§3](#3--the-exit-gate)) has not been
walked***, so by [manual testing §0](05-manual-testing.md) this phase is **not
closed** — its critical list is [sitting T](05-manual-testing.md).** One feature,
filed as a phase for [P12 §1.5](29-p12-implementation.md)'s reason: a roadmap
entry ([24](../24-roadmap.md)) holds no release commitment, and this was built
now.

**P13 is *make a setup from here*.** From any turn of a session a person can
run a wizard that condenses the story up to that turn and converts the point
into a real **Setup** — a library object new sessions start from — rather than
merely branching the chat there. The primary use is a point somebody will
start from again and again, or hand to someone else, without recreating it by
hand and without shipping the whole pre-played session.

---

## 0 — Readiness: what the design says and what the code has

### 0.1 The design has promised this since the Setup split, and nothing built it

[04 §7](../04-schemas.md): *"a running session can emit a Setup, which is
Marinara's play-first-share-afterwards snapshot as a first-class object rather
than a text file."* [03 §7.1](../03-data-model.md) and
[10 §2.1](../10-ui-surfaces.md) say the same, and [triage](02-triage.md) marks
Marinara's setup snapshot **PORT, strengthened**. No phase scheduled it.

**[16 §3](../16-authoring.md) goes further and is wrong.** It counts *"a running
session can emit a Setup"* among the two thirds of the play-to-authoring loop
that *"already exist"*. What exists is [P7.4](23-p7-implementation.md)'s *Save
as a setup*, which names the **session form's** configuration before a session
exists — `setup-from-form.ts` — and never reads a running session. The design
and the code disagree, and the repair is to build the thing and correct the
sentence in the stage that makes it true (P13.7), not to reword the sentence
now.

### 0.2 An emitted Setup would be unplayable today, three ways

Read against `POST /api/sessions` (`routes/sessions.ts`) as it stands:

1. **Nothing consumes `Setup.openings`.** They reach a session only inside
   `setup: structuredClone(from)`, and no reader on either side looks at them.
   [03 §6](../03-data-model.md)'s *"at session creation the user picks one
   written opening, one seed to expand, or neither"* has no implementation.
2. **`cast.partyDefault` is read by nothing**, and the route says why: *"seeding
   it means writing effects, which needs a turn."* An opening **is** a turn —
   which is the answer this phase gives.
3. **The browser cannot start a session from a Setup.** The client's
   `NewSession` has no `setup` field and nothing sends one; the server has
   accepted one since P7.4.

So the feature is both directions. Emitting a Setup nobody can start from would
be [P7.4](23-p7-implementation.md)'s own complaint in reverse — *"a field one
writes that the other does not read is a promise the library keeps and the game
does not."*

### 0.3 One hazard, found before it was written

`retrieval/blocks.ts` marks every block from a lorebook whose
`provenance.source` is `'session'` **advisory** — the memory-book convention
([P8](25-p8-implementation.md)), and it is `isMemoryBook`'s marker too. A
companion lorebook of established facts stamped `'session'` because it *came
from* a session would therefore have its entries barred from every effect and
verdict call, silently. It is stamped `'generated'`. The Setup itself may be
`'session'`: only lorebooks are read for that marker.

### 0.4 What is not the same feature

[25 B10](../25-open-questions.md)'s *prologue package* is a partly-played
**session** travelling in a package. This is the opposite trade: the history is
condensed away and what travels is a Setup, which starts clean, reads in a
library editor, and carries no turn record. Both are worth having; neither
replaces the other.


### 0.5 Found on the way, and where each went

Three things turned up while building that §0 did not predict. Recorded here
because each is a sentence somebody would otherwise have to rediscover.

- ***The illustrate route cancels its own call.*** It aborts its model call on
  the **request's** `close`, and since Node 16 that fires once the body has been
  read — under Fastify, before the handler has done anything, which a probe on
  this build confirmed. The deterministic suite cannot see it because
  `FakeProvider` ignores the signal; against a real endpoint that honours it,
  *Illustrate*'s moment call is cancelled almost as soon as it starts. **Not
  fixed here**, because it is [P9.4](26-p9-implementation.md)'s route and not
  this feature's: [P13.6](#p136--the-draft)'s route cancels on the **response**
  closing unfinished instead, and says why, so the pattern to copy is beside it.
  A task to repair illustrate is owed and named in the handover.
- ***An undeclared step's calls are `effects` calls.*** The condensation step
  first declared no `contributes`, so `callPurposeFor` read every call as
  effects and refused a person's advisory steer on it — every *Regenerate, but
  shorter* a 500. It declares `messages` now, which is the truth: it makes words
  for a person and writes nothing.
- ***A string-valued table is a catalogue question even when it is data.***
  `i18n/catalogue.test.ts` holds every such table in client code to the
  catalogue or an exemption; the wizard's map from a part to a Setup path was
  inlined rather than exempted, because it was two lines.

---

## 1 — The decisions this phase makes

### 1.1 The story so far is a Setup field, and it becomes the summary's root

Decided 2026-09-25, over two alternatives recorded so they can be re-argued:
a companion lorebook with an always-on *story so far* entry (works with any
preset, costs a second object), and folding the recap into the opening's prose
(no schema change, and it scrolls out of the window).

`Setup.storySoFar?: string` is additive, so it needs no version bump
([04 §2](../04-schemas.md)). A session started from such a Setup gets it as the
**root of its rolling summary chain**: the `summary` slot emits it as the oldest
link from the first turn, and the first derived link folds it in as `previous`.
That is [07 §5.1](../07-branching.md)'s `summary(n) = f(summary(n-1), turns)`
with a seeded `n = 0` — no second mechanism, and the built-in Freeform and
Scene presets already position the slot as *"the story so far"*.

**What it costs**: a preset with no enabled summary slot never shows the model
the root. The wizard says so when the session it was run from has none.

### 1.2 What carries over, and what does not

Decided 2026-09-25 — all four of the offered groups.

| Group | Becomes | Honoured at creation by |
|---|---|---|
| **Party** at the turn | `cast.partyDefault` | seating them in `cast.actors` and writing `se.party` on the opening turn |
| **Goal progress** | `goals`, the current one first and the achieved ones dropped | nothing new — `goals[0]` is where play begins ([04 §7](../04-schemas.md)) |
| **Plot-hook state** | unfired setup- and session-sourced hooks in `hooks`, ids kept; every fired hook's id in `spentHooks` | writing `se.hook: fired` for each spent id on the opening turn, so a treatment's hook does not fire twice |
| **Established facts** | a companion lorebook, linked from `lore` | ordinary lore activation |

**Channel state is not copied wholesale**, and that is the rule rather than an
omission. Channel state is [04 §1](../04-schemas.md)'s *free to move* tier and a
Setup is its *stable* tier; a Setup that carried raw channel values would freeze
every engine channel's shape into a portable format. Only the four groups above
cross, each through a field the Setup already has or an additive one with a
host-owned meaning.

**Known gaps, named rather than dropped:** presence and status (a character who
died is dead in the story so far, not in `se.status`); a difficulty dial's live
value (the wizard's original answer in `mode.config` is kept); a session's own
edits to its preset copy (the Setup refers to the library preset); and a
`committed` or `forced` hook intent, which carries as an ordinary unfired hook.

### 1.3 Hidden content stays on the server

[`sessions/promote.ts`](../../../packages/server/src/sessions/promote.ts)'s
header is the precedent and applies unchanged: an unfired hook's premise and
entrances, a hidden goal, and a hidden channel are hidden content, and a
surface that spoils them to the person still playing defeats the feature. So:

- The wizard's preview of what carries over is **redacted** — names, the
  current goal's statement only if it is player-visible, and counts.
- The commit **recomputes** the carry-over on the server from the turn. Nothing
  hidden ever makes a round trip through the browser.
- The condensation reads **only what the player saw**: `transcriptOf(path)`
  and summary links built from it. It never reads `renderedChannels`, which
  includes hidden channels.

### 1.4 The established-facts lorebook is a precursor, not 16 §3

[16 §3](../16-authoring.md)'s lorebook extraction reads the story bible, which
does not exist until 4.0. This phase reuses the memory extractor
(`memory/extract.ts` — its prompt, schema and reader) over the summary chain
and the recent turns, and puts the result in front of a person to keep, edit or
drop. It is the **offered, never automatic, reviewed before it lands** half of
16 §3 with a cheaper reader under it — and when the bible lands, it is the
reader that changes.

### 1.5 An opening is a turn, written by the engine

The chosen written opening becomes the session's first turn: `output.text` is
the opening, there is no `input` and no model call, and `Turn.opening` names
the opening it came from. Its effects are the seeding writes of §1.2, proposed
by `engine` through `acceptEffect` exactly as a hand-edit reconciliation's are.
Redo, reroll and guided redo are refused on it — nothing generated it, so there
is nothing to generate again.

### 1.6 A feature in its own document, and a branch that is not `p13`

***The branch is `claude/nice-davinci-xjdpf6`, not `p13`***, by instruction
rather than by choice — [P12 §1.5](29-p12-implementation.md)'s departure, and
recorded for the same reason: so nobody hunts for a branch that was never cut.

---

## 2 — Stages

*Depends on:* nothing outstanding. [P7.4](23-p7-implementation.md) (the Setup
on creation), [P8](25-p8-implementation.md) (the summary chain and the memory
extractor) and [P7.5](23-p7-implementation.md) (the hook pool and `se.hook`)
are the prior art, and all three are on `main`.

### P13.0 — This document

The readiness audit (§0) and the decisions (§1), written before code.
**Done — `a46a1cc`.**

### P13.1 — The schema

`Setup.storySoFar` and `Setup.spentHooks`, both optional; `Turn.opening`; and a
`story-so-far` arm on the block provenance, so the workbench can say where the
root came from. [04 §7](../04-schemas.md) gains the two fields and a subsection
on emitting a Setup from a turn.
*Proof obligation:* a Setup without either field is byte-identical on a round
trip, and one with them validates.

**Done — `f8affa5`.**
### P13.2 — The summary root

`planChain` and `ensureChain` take an optional root; the runner and every other
assembler emit it as the oldest summary link.
*Proof obligation:* **with no root, every existing chain's keys are unchanged**;
a different root keys a disjoint chain; the fork properties hold with a root.

**Done — `393f04b`.**
### P13.3 — The opening turn

`POST /api/sessions` consumes a Setup's written opening, `partyDefault` and
`spentHooks` through one engine-written turn, and takes an `opening` parameter
(absent is the primary, `null` starts cold).
*Proof obligation:* turn 1 is the opening, the party channel and the spent hooks
are written by it, and a redo naming it is refused.

**Done — `d364808`.**
### P13.4 — Starting from a Setup in the browser

The session form offers the account's Setups and their written openings; a
Setup's own page offers *Start a session*; the play surface does not offer redo
on an opening turn.

**Done — `b2fc84c`.**
### P13.5 — The carry-over

A pure builder from the state at a turn to a Setup, and the redacted preview of
it.
*Proof obligation:* **a serialised preview contains no unfired premise, no
entrance text and no hidden goal's statement**, for any pool and goal chain.

**Done — `ffb126a`.**
### P13.6 — The draft

`POST /api/sessions/:sessionId/turns/:turnId/setup-draft`: the story so far, an
opening, a name and blurb, and candidate facts, each its own model call through
its own step definition so one failing discards nothing.
*Proof obligation:* the prompts carry the transcript and never hidden content;
a warm summary chain costs no summariser call.

**Done — `bb29aa5`.**
### P13.7 — The commit

`POST /api/sessions/:sessionId/turns/:turnId/setup` writes the companion
lorebook, then the Setup.
*Proof obligation:* **the round trip** — emit at a turn, start a session from
the Setup, and the new session's first prompt carries the story so far, turn 1
is the opening with the party seeded, the spent hook is fired, the goal current
at the turn is `goals[0]`, and an unfired hook is still in the pool.

**Done — `f7c789f`.**
### P13.8 — The wizard

*Make a setup from here* beside *Continue from here*, opening a dialog with the
carry-over, the story so far, the opening, the facts, and a name.

**Done — `e033435`.**
### P13.9 — Close-out

The gate lands in [manual testing](05-manual-testing.md) as a sitting, the
design corrections are checked against what shipped, and the changelog prose is
parked in §2.1 for [P12 §2.1](29-p12-implementation.md)'s reason.
**Done — this commit**, which is the one that says where the phase stands.

### What is deliberately not in this phase

- **An end-to-end journey.** `e2e/journeys.spec.ts` admits a journey by its
  being *catastrophic to break*, and the seven it holds are the list; this is a
  feature beside them. The browser walk that did happen, before
  [P13.8](#p138--the-wizard) committed, is recorded in its commit.
- **A live test of the condensation.** The prompts are new, and whether a real
  model condenses well is critical row 1 — a judgement a live test could not
  make, since those assert structure and never prose.
- **Seed openings.** A Setup made here carries one written opening; expanding a
  seed is still [P7B §1.11](24-p7b-presets-and-prompts.md)'s revisit.
- **Consuming a treatment's or an actor's openings.** Only a Setup's are read at
  creation, which is the half this feature needed.

---

## 2.1 — What the changelog will say

*Written at P13.9, here rather than in `CHANGELOG.md`, for
[P12 §2.1](29-p12-implementation.md)'s reason: that file's headings are parsed by
the About surface and an unreleased one is not a heading it takes.*

**Added**

- **Make a setup from here.** Every turn of a session offers it beside
  *Continue from here*. A dialog drafts the story so far, an opening, a name and
  a blurb, and the facts the story has established; you edit what you like,
  switch off what should not carry — the party, the goal, the plot hooks — and
  save it as a Setup in your library. A session started from it begins where
  this one was, without the turns behind it, and it travels in a package like
  any other Setup. **Nothing it would spoil is shown**: hooks that have not
  happened and goals hidden from you are carried, and counted, and not described.
- **Start a session from a Setup.** From the session form, which now offers your
  Setups and their openings, and from a Setup's own library page. Until now the
  browser had no way to start from one.
- **A Setup's opening is the session's first turn**, and its party is seated in
  it. `opening: null` starts cold.
- **A Setup can carry the story so far**, and a session started from it shows
  the model that text from its first turn, as the oldest part of its rolling
  summary.

**Changed**

- A redo or rewrite naming an opening is refused — an opening was written, not
  generated.

---

## 3 — The exit gate

Two tiers, per [manual testing §0](05-manual-testing.md). **The rows below are
not edited to match what was walked.**

### 3.1 The critical list

| # | What | Why it is critical | Check |
|---|---|---|---|
| 1 | Emit a Setup around turn thirty of a real session against a real model and start from it: the first two turns continue the story — names, situation and party intact — and the opening reads as a scene rather than a recap | The whole claim, and only a person can judge *continues the story* | By hand, with a live endpoint |
| 2 | In a session with an unfired hook and a hidden goal, the wizard shows neither, and the new session does not surface either early | Spoiling the person still playing is the one failure this feature must not have | By hand |
| 3 | Start from the same Setup twice and get two independent sessions with the same opening; edit its story so far in the library and a third session carries the edit | *Start from again and again* is the primary use, and the edit is what makes a Setup better than a saved session | By hand |

### 3.2 The remainder — extends the standing list

| # | What | Where |
|---|---|---|
| 4 | A Setup made here, exported as a package to a second account, starts there with its facts lorebook | [manual testing](05-manual-testing.md) |
| 5 | Run from a session whose preset has no summary slot, the wizard warns, and the warning is true | [manual testing](05-manual-testing.md) |
| 6 | A kept fact activates in play on its key | [manual testing](05-manual-testing.md) |
