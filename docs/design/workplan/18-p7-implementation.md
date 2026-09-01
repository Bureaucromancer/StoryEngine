# 18 — P7 implementation plan

**Status: skeleton.** Drafted 2026-08-29, with P3 landed and
[P4](06-p4-implementation.md) planned but not started — so this is a document
written four phases ahead of its phase, and §0 says what that kind of document
is honestly for. Format follows [03](03-p1-implementation.md); the citation
convention is [P4](06-p4-implementation.md)'s — **`10 §N`** is
[10-schemas](../10-schemas.md), **`testing §N`** is [10-testing](10-testing.md),
**`survey §N`** is [01-source-survey](../01-source-survey.md).

**P7 delivers**, from [01 P7](01-work-plan.md): the mode contract as a real
interface with built-ins as separate packages consuming the published SDK;
channels, effects and engine-computed updates; setup objects and the declarative
wizard; party as a timeline; the plot-hook selector and its three companions,
including the two hook-identity obligations World depends on (P7.5)
(the pacing dial, Commit, `introduces`); goals; presence and status channels
with the cast panel over them; mention resolution as an `extract` step;
difficulty and directedness; and two modes — Scene and Freeform.

**The demo that defines done:** *play Freeform, set up through a
wizard nobody wrote a form for, to a goal completion — with the cast panel, the
hook panel and the workbench all reading state that a mode package declared and
the engine never special-cased.* The negative half of the demo is the one that
actually tests the contract: **`packages/server/src/modes/` is empty**, and the
build fails if anything puts it back.

**Still the largest phase, and still the one where the contract either holds or
is revealed as wrong** ([01 P7](01-work-plan.md)). The standing instruction from
[03 §2](../03-modes-and-turn-pipeline.md) is the phase's operating rule rather
than a slogan: *if a built-in mode needs a back door, stop and fix the contract.*

**CI this phase establishes:** the four hook property rows already written into
[testing §1](10-testing.md) against this phase's arrival — firing state that
survives a rewind, an entrance that is not drawn off the RNG tape, a closure
walk that reaches an actor named only by `introduces`, and *delivered* not being
treated as *fired*. Each states a property the obvious implementation gets
wrong, which is why they were written before the code. Plus the extension test
kit ([testing §7](10-testing.md)), published with the SDK, and the boundary
itself as a **build error** rather than a convention (§1.1).

---

## 0. What a skeleton four phases out is for

Not a plan. Three things, and naming them keeps the document from pretending to
be the fourth:

1. **It collects the deferrals already made to this phase**, from documents that
   will not be re-read on the day. More than a dozen separate places across the
   design and the work plan have sent something here; a deferral nobody collects
   is a deferral that gets lost, and [01 §2.3](01-work-plan.md) exists because
   that already happened once.
2. **It names the decisions the revisit has to make**, so the revisit is a
   morning's work rather than a re-derivation.
3. **It holds the exit gate's shape**, which is the part most worth writing
   early — a gate written after the code is a gate written to pass.

The revisit is not optional here. P7 follows PLAYABLE
([01 §4.1](01-work-plan.md)) by three phases, and PLAYABLE exists to find out
whether the record and the budgeter are right; whatever it finds lands in the
contract this phase makes public.

---

## 1. Decisions this plan has to make

### 1.1 The move is a move, or it is a rewrite — and one file already knows

[P2 §2.4](04-p2-implementation.md) put the Scene mode in `server` and promised
it **relocates behind the SDK at P7 without changing shape**. The thing that
decides whether that is true is how many engine types the mode reached for, and
P2 answered it in advance: `packages/server/src/modes/contract.ts` enumerates
every engine type a mode is allowed to see, type-only, with a docstring saying
that is exactly what it is for. **The move is that file's import list becoming
`packages/sdk`'s export list.**

The enforcement is already written and already aspirational: `eslint.rules.js`
carries a `modes → sdk, shared` policy matching `packages/modes/*`, a package
that does not exist. This phase is where the rule acquires a subject. That is
the cheapest possible test of [03 §2](../03-modes-and-turn-pipeline.md)'s central
claim, and it costs one directory move.

### 1.2 Three recorded divergences to reconcile, and only the third has teeth

[12 §4](../12-extensions.md) records what P2 built against what the boundary
needs, deliberately unreconciled because reconciling early would have been
guessing:

- A step returns `candidates: Candidate[]`, not `blocks: AssembledBlock[]`.
  Renaming toward the boundary is a rename — and arguably the *step* is right
  and [12](../12-extensions.md) is the document to correct, since a block is
  what the assembler produces.
- Effects are `EffectProposal` — no `before`, no `applied`, no id. A step
  proposes and the engine stamps ([13 §1.2](../13-internal-contracts.md)). This
  is the better shape and should survive; the boundary document should adopt it.
- **`StepHost.rng` is a live `Rng` with synchronous methods, and cannot cross a
  worker hop.** `HostApi.random` is async throughout. This one touches every
  step that draws, and nothing at P2 draws inside a step — so the conversion is
  free *now* and expensive after P7 ships steps that do.

**Lean: do the async conversion in the first stage, before any new step is
written.** The cost is a signature; the alternative is converting steps written
this phase, in this phase.

### 1.3 Does the worker hop land here, or after?

[12](../12-extensions.md) settles worker-thread isolation **from 1.0** and
[03 §9](../03-modes-and-turn-pipeline.md) says built-ins go through the same
interface. What is genuinely open is whether the hop is *this* phase's or a
later one's, with the SDK shipping first and the isolation following.

**Lean: the hop lands here**, because §1.2's async conversion is only *forced*
by it. Paying an async cost without the boundary that requires it is paying the
price with none of the check — and `StepInput`/`StepResult` are already asserted
`structuredClone`-able in `turns/steps.test.ts`, which is the half of the
day-one item that can be held to account before the boundary exists. Confirm at
the revisit against how much of the phase's step work is done by then.

### 1.4 `InitPolicy` has exactly one first consumer, and it is in this phase

[13 §1.3](../13-internal-contracts.md) defers `schema`, `init` and `migrate` on
`ChannelDefinition` and says why: a contract designed against one real need
beats one designed against three imagined ones. **The pacing dial is that need**
— a session channel with `update: "user-only"`, `budget: null`, and an init
reading a Treatment's advisory value
([03 §6.1](../03-modes-and-turn-pipeline.md), [10 §6.1b](../10-schemas.md)). It
is a P7 *dependency*, not a free consequence: the dial cannot be built before
the policy is, and scheduling them apart makes the dial invent its own prefill
path.

`migrate` has no such consumer and should not acquire one speculatively; what it
does need is [06 B7](../06-open-questions.md)'s
validate-coerce-migrate-quarantine path being real once author-declared channels
exist ([03 §4.1–4.2](../03-modes-and-turn-pipeline.md)).

### 1.5 Two pre-existing corrections this phase discharges

Both named in [01 P7](01-work-plan.md), both cheap here and awkward anywhere
else:

- **Hook firing state moves out of the session file into a channel**
  ([02 §4.1](../02-data-model.md)). A flat set does not branch, and
  [testing §1](10-testing.md) already carries the property that fails if it
  stays where it is.
- **The selector writes its own line into the turn record.** *Held by pacing*
  and *judged: none* are different answers, and a record that merges them makes
  a correctly-quiet session indistinguishable from a broken one
  ([05 §10.1](../05-ui-surfaces.md)).

### 1.6 Party, presence and status are channels, and `cast` stops being a field

[03 §8](../03-modes-and-turn-pipeline.md) moved party membership, `control` and
narrator selection into channels for the three properties fields cannot have:
they reconstruct at a node, they appear as effects in the record, and they branch
correctly. `se.party` is on [P2 §5](04-p2-implementation.md)'s deferral list by
name. Two constraints that must not be lost in the move: **membership is keyed
by `TurnId`, never by ordinal** ([09 §3](../09-branching.md)), and **presence is
not party membership** — two concepts, two channels, one panel
([05 §13.2](../05-ui-surfaces.md)).

*Introduced* is neither, and [03 §8.1](../03-modes-and-turn-pipeline.md) defines
it over presence and party effects. The hook filter and `involves` have both
spent the word since they were written; this phase is where it acquires an
implementation, and the introduction hook reverses exactly one clause of the
filter while keeping the rest.

### 1.7 The span type must not be named for mentions

[05 §13.1](../05-ui-surfaces.md) says the span model *"should be built so that it
can"* generalise. [17 §13](../17-write-mode.md) sharpens that into the largest
single obligation P7 owes a later mode: Write needs three consumers of one span
shape — mentions, machine-written provenance, and beat positions — so
*generalises* has to mean **a tagged reference from the first span ever
written**, and the type must not carry an actor reference in its name or its
shape. Ship it with an actor baked in and the choice later is migrating every
stored turn or growing a second span type, which is how one overlay becomes two.

### 1.8 Two modes is a weaker test, and the assistant is the available third

[01 §0.3](01-work-plan.md) records the cost of cutting Messages and Campaign:
the two retained modes are **the more similar pair**, so the contract gets tested
against less variety than the design assumed. There is a third witness already
specified and currently scheduled for P11 — the assistant, which
[03 §7.4](../03-modes-and-turn-pipeline.md) states is *a session, in a mode, with
an actor card*, and which doubles as a test of the mode contract by design.

**To decide at the revisit:** whether the assistant's *mode definition* (not its
surface, not its tools) is pulled into P7 as the contract's third and least
similar consumer. It is the cheapest variety available, and finding the contract
wrong in P11 is finding it wrong after everything is built on it.

### 1.9 Session and step overrides have been plumbed and never passed

[07 §5.1](../07-tech-stack.md)'s override table names two of five layers as
**P7's, with the mode contract that would use them** — `resolveRole` implements
four of the five and the fifth has no caller.
[P2B §6](14-p2b-provider-configuration.md) declines to build a control for a
layer with no caller, on the grounds that it would be building P7's UI against
P7's unwritten contract. This phase writes the contract; the surface follows in
the same phase or is named as debt with an owner, not left as a third comment.

### 1.10 What import recorded and left here — the deferrals §0 exists to collect

**Added 2026-08-30**, and it is §0's first job discharged rather than a new
decision: this document was drafted the same day
[P4](06-p4-implementation.md)'s plan was amended, on a different branch, and
neither met the other. P4 defers a named body of material to this phase and
nothing here collected it.

**What P4 imports, records and does not convert, because this phase is where it
would have a home** ([P4 §1.8](06-p4-implementation.md)'s disposition tables):

- **Party-shaped** — SillyTavern's `groups` and `group chats`, Marinara's
  `character_groups` and `persona_groups`. P4's note is the one that matters
  here: *member references would resolve-or-dangle if they ever convert*, which
  is a statement about §1.6's party-as-a-channel model rather than about
  import.
- **Channel- and mode-shaped** — Marinara's six `game_*` tables and
  `spatial_context_snapshots`, and Aventuras' typed per-entry state. P4 calls
  these "channel-shaped P7 material" in as many words.
- **Setup-shaped** — Marinara's `GameSetupConfig`, ~70 fields mixing narrative
  and production. Recorded, not converted, with
  [00 §3.2](../00-stance.md) stripping the production half if it ever converts.
  §P7.4 builds setup objects and the wizard, so this is the stage that inherits
  the question.
- **Extension- and agent-shaped** — Marinara's `agent_configs`, `agent_runs`,
  `agent_memory` and `capability_documents`, waiting on the extension host this
  phase makes real.

**The decision the revisit owes, and it is one decision rather than four:**
*does P7 convert any of it, or does "recorded" turn out to be where it stays?*
The honest default is the second. Every item above is a foreign engine's
runtime state, and [06 E4](../06-open-questions.md) already closed chat and
session import on the grounds that *"a half-working importer generates more
support burden than no importer at all"* — an argument that does not weaken
when the state gets more mode-specific. What would change it is a *format*
argument rather than a completeness one: if this phase's channel and setup
shapes turn out to be close enough to a source's that conversion is a table
rather than a rewrite, the case reopens for that one shape only.

**And one thing P4 took from this phase rather than leaving to it**, recorded
so the revisit does not find it as a contradiction: session creation grows an
optional preset id at [P4 §1.9](06-p4-implementation.md), amending
routes/sessions.ts's *"choosing a different pack is P7's surface"* in place.
P7 keeps the surface — browsing, previewing, switching mid-session. P4 took
only copy-at-creation, because PLAYABLE needs it.

---

## 2. Stages

Ordered so the boundary exists before anything is built through it — the whole
argument for a mode contract is that things built after it inherit the
discipline, and a stage order that builds features first inverts that.

### P7.0 — The boundary made real

`packages/modes/scene` created and populated by moving, not rewriting; `sdk`
exporting the contract instead of re-exporting `shared` and nothing else;
`eslint.rules.js`'s `modes → sdk, shared` policy acquiring a subject; §1.2's
async `random` conversion done while no step draws. **No behaviour change** —
if this stage produces a diff outside imports, package manifests and one
signature, §1.1's promise was false and that is the finding.

*Ends at:* a deliberate bad import in the mode package failing the build.

### P7.1 — Channels as a general mechanism

Modes declare channels and the registry is built from declarations rather than
from a built-in set of one ([13 §1.3](../13-internal-contracts.md)). `schema`,
§1.4's `init`, author-declared channels
([03 §4.1](../03-modes-and-turn-pipeline.md)), the migration posture from
[06 B7](../06-open-questions.md), hidden visibility with a reveal affordance, and
the minimum of the declarative widget vocabulary
([05 §8](../05-ui-surfaces.md)) — no extension-shipped components, now or later.

### P7.2 — Party, presence, status, and the cast panel

§1.6 built; the cast panel over it ([05 §13.2](../05-ui-surfaces.md)), editable,
with one derived badge over two axes. **The asymmetric-death treatment is part
of the stage, not polish**: a proposed status change to `dead` is surfaced
prominently and is reversible from the effect log, same bias as
[06 C12](../06-open-questions.md) — under-fire, and keep the manual path.

### P7.3 — Participant policy, and the two axes

`ParticipantPolicy` with SillyTavern's four activation strategies as the
taxonomy ([03 §7.2](../03-modes-and-turn-pipeline.md)); voice and dispatch as two
visible controls rather than a four-way enum; `per-actor` making `ModelHint`
meaningful at last; mixed voice within a turn as a preset capability
([06 C2](../06-open-questions.md)); §1.9's session and step overrides.

### P7.4 — Setup objects and the declarative wizard

`SetupSchema` as declared rather than coded; the `setups/` library kind that has
had a folder in the layout since P1 and no writer. **Incremental generation is
the reliability requirement**, not a nicety
([00 §2.3](../00-stance.md), [03 §7.3](../03-modes-and-turn-pipeline.md)): each
part separately validated, individually retryable, applied as it succeeds.

### P7.5 — Hooks: the pool, the selector, and the three companions

The pool and its four sources; the mechanical filter; the judgement pass firing
through the guidance slot; §1.5's two corrections; the pacing dial as §1.4's
channel; Commit with its bounded three-turn patience counted **on the path**;
`introduces` and the reversed clause; session-local hooks addable to a running
session, and treatment changes **pulled, never pushed**
([00 §3.1](../00-stance.md)). The hook panel ([05 §10.1](../05-ui-surfaces.md))
with Commit on it and force-fire deliberately in the workbench instead.

**Two one-line obligations that World depends on, and that cannot be added
later** ([19 §5](../19-world.md)). World is a committed release now rather than a
roadmap entry, so these are requirements of this stage rather than options worth
keeping open:

1. **A copied hook keeps the source hook's `id`.** Session creation copies hooks
   from all sources ([02 §4.1](../02-data-model.md)). Within a continuity, a hook
   that fired in session one must not fire again in session two, and
   cross-session de-duplication is only possible if the copy preserved the id.
   `PlotHook.id` exists and `blockedBy` / `notBefore.afterHook` already reference
   ids, so nothing is being added — what is being pinned is that copying does not
   mint a fresh one. **A corpus of sessions whose hooks have unrelated ids cannot
   be retro-fitted into a continuity**, because the linking information was never
   written.
2. **`introduces` suppression keys on the subject, not the hook.** The failure it
   avoids is *this person arriving for the first time, twice*, and id-matching
   misses the commoner case where a different hook — or the narrator, unprompted
   — introduced them already. The `introduced` predicate already exists
   per-session ([03 §8.1](../03-modes-and-turn-pipeline.md)); only its scope
   widens later, and only if the key is right now.

Both are free at this stage and unrecoverable after it, which is the whole
reason they are named here rather than in [19](../19-world.md) alone.

*Entrances are shown by label, never by text.* An unfired entrance is hidden
content, and a panel that spoils the arrival defeats the feature.

### P7.6 — Goals

The chain, not a field; the progress channel with `model-proposed` in Freeform;
narrative completion biased toward under-firing with manual completion always
available; the three offers at conclusion, chosen **at completion rather than at
setup**; completed goals retained with the turn that completed them, which is
what gives the reading view (P11) a real spine and the selector a proximity
signal. [06 C12](../06-open-questions.md) — confirmation before completion fires
— is decided here or explicitly left open with its reason.

### P7.7 — Mention resolution

An `extract` step producing §1.7's spans, sharing P5's keyword scanner so
highlighting and inclusion reasons cannot disagree about who *the fixer* is.
`explicit` and `matched` at 1.0; **`proposed` may follow, but the span overlay
and the never-auto-create rule land now** — both structural, and
auto-materialising on first mention is precisely the failure the feature exists
to make visible.

### P7.8 — Difficulty and directedness

Two settings, levels supplied by the prompt pack rather than engine code
([03 §7.3.1–7.3.2](../03-modes-and-turn-pipeline.md)). Coherent only because
P7.6 shipped goals — difficulty without a goal can only say *introduce friction*,
which reads as arbitrary within a few turns.

### P7.9 — Freeform, and Scene grown up

The second mode, built entirely through the contract; Scene grown from P2's
deliberately embarrassing minimum to its 1.0 shape — sprites, backgrounds and
expression selection as steps writing channels, with **text-only remaining a
first-class configuration**, as it is in both sources.

*Ends at:* the demo.

---

## 3. Verification — the P7 exit gate

Sketch; expand on revisit.

1. `packages/server/src/modes/` does not exist, and an import from a mode
   package to `server` fails the build rather than a review.
2. Freeform is played end to end and the engine contains no
   `switch (mode)` — the survey is a grep and it belongs in the gate.
3. A channel declared by a mode appears in the registry, is enforced against its
   `update` policy, renders through the declared widget vocabulary, and
   reconstructs at an old node.
4. A hook fires; the record says *why*; a held turn says *held by pacing* and a
   judged-none turn says so differently (§1.5).
5. Commit a hook, rewind past the commitment, and it is uncommitted — the
   [testing §1](10-testing.md) property, as a test rather than a sentence.
6. A goal completes, the three offers appear, *Advance* sets the next, and the
   session stays readable and branchable after *End*.
7. A character dies on one branch and is alive on the other, in the panel, with
   no special case in the panel's code.
8. Mentions highlight what the lorebook scanner matched, and an unresolved name
   offers rather than creates.
9. The setup wizard for a mode the engine has no knowledge of renders from its
   declaration alone, and a failed part of an incremental generation is retried
   without discarding the parts that succeeded.
10. **Only a person can walk:** author a small mode against the published SDK
    with no access to `server`, and see whether the contract permitted it. This
    is the phase's actual claim and no assertion covers it.

**And the standing line from [01 §2.3](01-work-plan.md): no phase exits with
configuration that has no surface.** This phase generates more of it than any
other — every declared channel, every mode preset, every setup schema — so the
line is a checklist item here rather than a formality.

---

## 4. Out of scope, deliberately

The authored-rule vocabulary and its evaluator (5.0, the authoring tier — [01 §0.6](01-work-plan.md)
— and the tempting move once steps exist is to let `StepCondition` take rule
predicates, which [03 §6](../03-modes-and-turn-pipeline.md) warns against by
name); Campaign and Messages ([01 §5](01-work-plan.md) — committed, not
speculative); engine-computed combat; mechanical goal completion, which needs
the vocabulary; extension *installation* and its panel (P10 — the manifest and
lifecycle are specified at [12 §6–§7](../12-extensions.md) and nothing installs);
custom extension rendering ([05 §8.1](../05-ui-surfaces.md), deferred as far as
it will go); cross-branch merge ([06 C10](../06-open-questions.md)); the hook
selector's **tuning** — what four pacing levels resolve to, how a judgement
prompt is worded — which [01 P11](01-work-plan.md) owns and which can only be
done by playing.

**And one thing that is not out of scope but reads like it:** the assistant's
mode definition, §1.8. It is listed here so that leaving it in P11 is a decision
rather than an omission.

---

## 5. The honest size, and what only the revisit can settle

*Added 2026-08-31. §0 says this document is not a plan; this section says what a
plan would have to price, so the revisit starts from an estimate rather than
from a blank page.*

**P7.0 is the phase, and the other nine stages are its consumers.** That reads
backwards — nine stages of features against one of plumbing — and it is the
single most useful thing to hold onto here. The boundary either holds or is
revealed as wrong ([01 P7](01-work-plan.md)), and every stage after P7.0 is a
test of it disguised as a feature. Pricing this phase as *ten stages* invites
building the features and discovering the contract at the end, which is the
failure [03 §2](../03-modes-and-turn-pipeline.md)'s standing rule — *if a
built-in mode needs a back door, stop and fix the contract* — exists to catch.

**The negative half of the demo is the deliverable.** `packages/server/src/modes/`
being empty, with the build failing if anything puts it back, is worth more than
any of the panels: it is the only check that cannot be satisfied by a mode that
works. A plan that cuts under pressure should cut a panel and never that.

**What is genuinely large, in order:**

1. **Hooks** (P7.5) — the pool, the selector, and three companions, plus the two
   identity obligations [19 §5](../19-world.md) makes unrecoverable if missed.
   Four property rows are already written against it in
   [testing §1](10-testing.md), which is the strongest signal in this document
   that somebody thought the obvious implementation would be wrong.
2. **Setup objects and the declarative wizard** (P7.4) — a form nobody wrote,
   generated from a declaration, is the contract's hardest single claim.
3. **Channels as a general mechanism** (P7.1) — the narrowest, because P2 and P5
   already use them and `readClock` is a worked example.

**What is smaller than it looks:** party, presence and status (P7.2) are
channels once P7.1 exists, and §1.6 has already done the design work of turning
`cast` from a field into one. Mention resolution (P7.7) is an `extract` step
whose span type is already named against the trap in §1.7.

**Three things only the revisit can settle**, and they are why §0 calls this a
skeleton:

- **Whether the worker hop lands here** (§1.3). A performance question with no
  measurements yet, and PLAYABLE plus P5's retriever are what produce them.
- **Whether two modes is enough of a test** (§1.8). The document already
  suspects not and names the assistant as the available third — but the
  assistant is P11's, so the honest options are *accept a weaker test at P7* or
  *move something*. Deciding that late is how a contract ships untested.
- **What PLAYABLE and P2C did to the record.** P7 follows PLAYABLE by three
  phases, and whatever the record turns out to have got wrong lands in the
  middle of this phase's channel and effect work. The revisit's first job is to
  re-read [16](16-p2c-log.md) rather than this document.
