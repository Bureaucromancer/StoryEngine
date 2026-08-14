# 20 — P2 implementation plan

**Status: skeleton.** Drafted during P1, before the storage spine was finished.
To be revisited and expanded before the phase starts — stages here will pick up
dependencies on how P1 actually landed, and several decisions below are leans
rather than commitments. Format follows [19](19-p1-implementation.md).

**P2 delivers**, from [15 P2](15-work-plan.md): the provider layer with model
roles, assembler → budgeter → render, the complete turn record, the turn as a
resumable server-side job with an SSE event stream, the RNG service, and the
smallest real Scene mode.

**The demo that defines done:** *type a message, get a streamed reply, close the
tab mid-turn, and reattach to the finished result. Read the whole turn record as
JSON.* The reattach half is the architectural claim
([04 §2](04-server-multiuser-deployment.md)) — a turn is a server-side job, not
a promise in a browser tab — and the JSON half is the record claim
([02 §8](02-data-model.md)): complete from the first turn, because everything
after P2 reads it.

**P2 is where [18](18-internal-contracts.md) stops being a document.**
`BlockSource`, `ChannelEffect`, `ChannelState`, `ModelCall`, `BudgetVerdict`,
`RenderedMessage` and `ProviderCapabilities` all become code here, and the
discipline is that they become code *as written* — deviations go back into doc 18
first, because five later phases are specified against it.

**CI this phase establishes:** golden-file assembly tests
([16 §3.1](16-testing.md)) — fixture library + fixture session → assemble →
snapshot the turn record as a rendered table. The highest-value test surface in
the project, and it exists the moment the record does.

---

## 1. Decisions this plan has to make

Provisional. Each needs confirming (or overturning) when this document is
revisited.

### 1.1 The Scene mode lives in `server` until P7, and that is a move, not a rewrite

[15 P2](15-work-plan.md) requires the smallest *real* Scene mode — a short list
of real steps, not a hardcoded stand-in — while the `modes/*` packages and the
SDK boundary are P7's. Both are satisfiable at once: the mode is written as data
and steps against the internal `ModeDefinition` shape
([03 §2](03-modes-and-turn-pipeline.md)), lives inside `server` for now, and
**relocates** behind the SDK at P7 without changing shape.

The [15 §2.2](15-work-plan.md) test applies: this is the real thing scoped
small, not a placeholder. What keeps it honest is that the step contract is
**async and serialisable from the first step** ([15 §3](15-work-plan.md), A1) —
if the P2 steps only work because they share memory with the engine, the P7 move
becomes the rewrite this rule exists to prevent.

What the P2 Scene mode contains: `voice`/`dispatch` fixed to
`narrator`/`merged`, one `generate` step, history, persona, one actor, a
default preset. No channels beyond what §1.4 forces, no hooks, no participant
policy beyond "the user and one actor", no setup wizard.

### 1.2 Turn storage lands here, tree-shaped from the first turn

Sessions and turns are P2 storage even though branching is P6. Two things are
**not deferrable**, per the day-one checklist ([15 §2](15-work-plan.md)):

- **`parentTurnId` from the first turn.** The turn store is a tree that P2
  happens to use linearly. Retrofitting the edge at P6 is a migration;
  writing it now is a field.
- **Append-only JSONL segments in creation order** ([02 §5.5](02-data-model.md)),
  rolling on count or byte size, with id → `(segment, offset)` in the index, and
  **tolerance for removal** (tombstone + compaction) designed in even though
  nothing at 1.0 deletes turns.

Turn text goes into FTS **on write**, as part of the same ingest pass
([07 §7.1](07-tech-stack.md)) — the scaffold from P1.4 becomes real here.

### 1.3 The operational store opens here

`/data/state/state.sqlite` ([18 §5.1](18-internal-contracts.md)) — jobs,
idempotency keys, and later the notification inbox. P2 is the first phase with
state that is *not* derived (a turn in flight), so the index/operational split
has to be made now rather than discovered when someone deletes `index.sqlite`
mid-turn. Auth stays on stateless cookies and does not move here.

**Job durability across restart** is [04 §2](04-server-multiuser-deployment.md)'s
open question, and the lean is its stated simple answer: turns are not resumed
across a restart; the partial turn is recorded as failed with its blocks intact,
re-runnable rather than lost.

### 1.4 How much channel machinery a nearly-channel-less mode forces

The Scene mode wants approximately zero channels — but `ChannelEffect` is the
most load-bearing type in [18 §1.2](18-internal-contracts.md), and the replay
invariant ([16 §3.3](16-testing.md)) cannot be tested against a session that
never writes an effect. Lean: build the effect application path and
`session.json`'s head snapshot ([02 §8.1](02-data-model.md)) in full, ship one
trivial real channel to exercise them (candidate: `se.clock`, or the party
channel from [03 §8](03-modes-and-turn-pipeline.md) since a party always
exists), and leave reducers, widgets and `InitPolicy` richness to P7.
Reconstruction is replay-from-zero only; the snapshot *cache* is P6's
([10 §4](10-branching.md)), and nothing at P2 depth needs it.

**To resolve on revisit:** whether `se.party` as a channel is P2 (the invariant
"party always exists" suggests yes) or P7 (where `ParticipantPolicy` lives).

### 1.5 The fake provider is a P2 deliverable, not a test detail

[16 §4.1](16-testing.md): a scripted implementation of the provider interface,
recording every request. It is the golden-file harness, the E2E backend, and the
only way to test reattach, mid-stream disconnection, malformed structured
output and the failing-step path deterministically. Building it beside the real
adapter — not after — is what keeps CI model-free from the first pipeline test.

### 1.6 Guidance: the slot is P2, the polish is not

`advisory: true` refused by effect-producing calls is a day-one item
([15 §2](15-work-plan.md)) and is enforced in the assembler, so the guidance
*block* and its exclusion rule ([03 §5.2](03-modes-and-turn-pipeline.md)) land
here — plus the golden test that no advisory block ever reaches an
effect-producing call. The input-bar box itself ([05 §10](05-ui-surfaces.md))
can be a plain collapsed textarea; one-shot semantics (recorded in the turn
record, not entering history) are part of the record shape and are not
deferrable.

---

## 2. Stages

Ordered so the record types and their tests exist before anything produces
records.

### P2.0 — Provider layer

`packages/server/src/providers/`: the AI SDK behind the thin internal interface
([07 §5](07-tech-stack.md)), `ProviderCapabilities` per
[18 §3](18-internal-contracts.md) with known-provider defaults, model **roles**
with the hi/lo binding default ([07 §5.1](07-tech-stack.md)), connections in
`connections/` per [04 §4.5](04-server-multiuser-deployment.md) — account-scoped
plus system scope, never in a portable object. Prompt caps as ranked-fragment
budgets ([07 §5.3](07-tech-stack.md)). The fake provider (§1.5) ships here.

*Chat-completion only* ([07 §5.5](07-tech-stack.md)) — no completion adapter,
no instruct templates, stated in the docs rather than discovered.

### P2.1 — RNG service

`int/float/bool/chance/pick/weightedPick/shuffle/dice`, `node:crypto` uniform
draws, injectable generator, every draw recorded keyed **by site**
([07 §14](07-tech-stack.md)). The tape and replay mode are built now even though
nothing rerolls until P6 — the tape is part of the turn record, and a record
without it cannot support rewrite later. The P1.0 lint rule stops banning
randomness everywhere and starts pointing here.

### P2.2 — Session and turn storage

Session CRUD under `users/<handle>/sessions/`, `session.json` with head
snapshot, JSONL segments per §1.2, ingest into the index, FTS on turn text.
Effect application and head-snapshot maintenance per §1.4, including
hand-edit-divergence-becomes-an-effect ([02 §8.1](02-data-model.md)) —
cheap now, and it is the sessions half of the storage thesis P1 proved for
library objects.

### P2.3 — Assembler, budgeter, render

The four steps of [03 §5](03-modes-and-turn-pipeline.md). Collect from the
sources that exist (persona, actors, history, preset blocks, the guidance
block); annotate with `BlockSource` + reason; budget with a full
`BudgetVerdict` including `nextToDrop`; render to `RenderedMessage[]` with
`fromBlocks` intact and same-role merging as a provider capability
([18 §2](18-internal-contracts.md)). **History is a splittable source** from the
start — in-history placement is how real presets work and P4 imports them.
Lore retrieval is not here (P5); the lore *slot* exists and resolves empty.

Golden-file suite starts with this stage.

### P2.4 — The turn job and the event stream

Turn as a job with an id in the operational store; SSE per
[07 §8](07-tech-stack.md); the progress-event vocabulary of
[04 §3.3](04-server-multiuser-deployment.md) (`turn.started` … `turn.finished`),
snapshot-plus-cursor reattach. Step failure per
[03 §6](03-modes-and-turn-pipeline.md): `failure: "warn"` does not lose the
turn. Events carry `{key, params}`, never prose
([15 §2](15-work-plan.md)). Notification *classes* and the router are P10; the
event schema they need is complete from the first producer.

### P2.5 — The Scene mode and the play surface

The mode of §1.1 wired to routes, and a deliberately thin chat view: message
list, input, streaming render, reattach on reload, and a raw "view turn record"
JSON affordance that P3 replaces. Impersonation and the second axis controls are
not here — [03 §3](03-modes-and-turn-pipeline.md) ships in Scene at P7/P11
scope, not P2.

*Ends at:* the demo.

---

## 3. Verification — the P2 exit gate

Sketch; to be expanded to numbered steps on revisit.

1. Send a message → streamed reply → close the tab mid-generation → reopen →
   the finished turn is there. The job survived the client.
2. Kill the *server* mid-turn → restart → the partial turn is recorded failed
   with blocks intact and can be re-run (§1.3).
3. Read the turn record: every block with source and reason, the budget verdict
   with `nextToDrop`, `ModelCall.resolved` naming what actually ran, cost
   captured. No nulls where doc 18 says data.
4. Two clients on one session both see the stream.
5. Delete `index.sqlite` → sessions and turns all still read; delete
   `state.sqlite` → an in-flight turn is lost and *that is expected*; nothing
   else is (§1.3).
6. Replay-from-zero reproduces head channel state; hand-edit `session.json`'s
   clock on disk → the divergence lands as a user-attributed effect (§1.4).
7. The golden-file suite runs against the fake provider and snapshots the
   rendered block table.

---

## 4. Out of scope, deliberately

The workbench (P3 — the JSON affordance in P2.5 is the placeholder-shaped
exception, and it is one `<pre>` tag, not a system); import (P4); lore
activation (P5 — the slot renders empty); branching UI, snapshots-as-cache,
rewrite/reroll surfaces (P6 — but the tape and `parentTurnId` are written now);
channels beyond §1.4, hooks, the mode registry, the SDK boundary, setup wizards
(P7); summarisation (P8); renditions (P9); notification routing and delivery
(P10).

**The line most likely to erode is the mode's.** A second step, a channel with a
widget, a participant policy — each is small and each belongs to P7, where the
contract is tested by two real modes rather than grown one convenience at a
time. The P2 mode is allowed to be embarrassingly small; that is what it is for.
