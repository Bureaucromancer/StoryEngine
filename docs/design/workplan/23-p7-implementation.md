# 23 — P7 implementation plan

**Status: ~~skeleton~~ ~~skeleton, audited 2026-09-07 at `5602ded`~~ startable in
part, re-audited 2026-09-10 at `46bec98` — and this is now the phase in front of
us.** Drafted 2026-08-29, with P3 landed and
[P4](16-p4-implementation.md) planned but not started, so it was written four
phases ahead of its phase and §0 says what that kind of document is honestly
for. ~~Four have landed since — P4, P5, P6 and P6A, the last of them cutting
Alpha 1~~ **Five have landed or opened since — P4, P5, P6, P6A and P6B** — so
§0.1 is the readiness audit that started turning this into a plan and **§0.1a is
the one that finishes the job**, because §0.1 went stale the day after it was
written. The distance §0 apologises for is down to **one checkpoint**: PLAYABLE,
which still has not run — but it is no longer a distant checkpoint. It is
[P6B.2](20-p6b-playable.md), a named stage in the phase immediately before this
one, held on [sitting K](05-manual-testing.md). Format follows
[P1](07-p1-implementation.md); citations follow the corpus convention.

**§0.1 was audited against the tree at `5602ded` and written at `0683779`, its
child — and it went stale at `bf14ce6` the next day**, when P6B.0 and P6B.1
landed. Read **§0.1a first**: it discharges one of §0.1's findings outright,
narrows three, and adds what reading the files turned up. §0.1 is kept for its
arguments rather than its findings, which is what
[P6 §0](18-p6-implementation.md) does with its own superseded audits. The
known-good baseline is now **alpha 4** (`a7145cc`), not Alpha 1, and **§3
predates [manual testing §0](05-manual-testing.md)'s two-tier gate** (adopted
2026-09-09 at `c5b8ac9`) — §3.1 is what brings it up to it.

**P7 delivers**, from [work plan P7](01-work-plan.md): the mode contract as a real
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
is revealed as wrong** ([work plan P7](01-work-plan.md)). The standing instruction from
[06 §2](../06-modes-and-turn-pipeline.md) is the phase's operating rule rather
than a slogan: *if a built-in mode needs a back door, stop and fix the contract.*

**CI this phase establishes:** the four hook property rows already written into
[testing §1](03-testing.md) against this phase's arrival — ~~firing state that
survives a rewind~~ **firing state that does *not* survive a rewind past the
firing turn**, an entrance that is not drawn off the RNG tape, a closure
walk that reaches an actor named only by `introduces`
([04 §9.1](../04-schemas.md)), and *delivered* not being
treated as *fired*. Each states a property the obvious implementation gets
wrong, which is why they were written before the code. Plus the extension test
kit ([testing §7](03-testing.md)), published with the SDK, and the boundary
itself as a **build error** rather than a convention (§1.1).

*The first paraphrase was inverted and is corrected 2026-09-10.* The row reads
*"a hook committed or fired on a turn **is uncommitted and unfired** after a
rewind past it"* — firing state surviving a rewind is the failure it exists to
catch, and it is what a session field does. §3's step 5 always had it right; the
header did not, and the header is the part somebody reads when scoping the
stage.

---

## 0. What a skeleton four phases out is for

Not a plan. Three things, and naming them keeps the document from pretending to
be the fourth:

1. **It collects the deferrals already made to this phase**, from documents that
   will not be re-read on the day. More than a dozen separate places across the
   design and the work plan have sent something here; a deferral nobody collects
   is a deferral that gets lost, and [work plan §2.3](01-work-plan.md) exists because
   that already happened once.
2. **It names the decisions the revisit has to make**, so the revisit is a
   morning's work rather than a re-derivation.
3. **It holds the exit gate's shape**, which is the part most worth writing
   early — a gate written after the code is a gate written to pass.

The revisit is not optional here. P7 follows PLAYABLE
([work plan §4.1](01-work-plan.md)) by three phases, and PLAYABLE exists to find out
whether the record and the budgeter are right; whatever it finds lands in the
contract this phase makes public.

### 0.1 Readiness — audited 2026-09-07 at `5602ded`, with P6B.3's routings added 2026-09-09

*The heading carried one date and two dates' worth of content until 2026-09-10:
the audit below was run on 2026-09-07 against the tree at `5602ded` and written
at `0683779`, and the P6B.3 material at the end was added on 2026-09-09 without
the heading moving. **Superseded by §0.1a and kept for its arguments rather than
its findings**, which is what [P6 §0](18-p6-implementation.md) does with its own.*

*Run against the code rather than against this document, which is the only way
a readiness note is worth anything ([work plan §2.3](01-work-plan.md)'s mechanism, and
[P6 §0.1a](18-p6-implementation.md)'s worked example). Four phases have landed
since the draft. Most of what §1 claims is still exactly true, one claim has
half-expired, and two deferrals had been made to this phase that nothing here
had collected.*

**What still holds, checked one by one.** §1.1 entirely: `packages/modes/` does
not exist, `eslint.rules.js` still says so in as many words, and
`packages/sdk/src/index.ts` still re-exports `shared` and nothing else — so the
move is still a move and the rule still has no subject. What grew is the thing
being moved: `packages/server/src/modes/` is now `contract.ts`, `types.ts`,
`registry.ts` and `scene/`, four files rather than two. §1.4: `ChannelDefinition`
in `sessions/channels.ts` is still *"deliberately short of the documented
type"* — no `schema`, no `init`, no `migrate` — and the pacing dial is still
`InitPolicy`'s only real consumer. §1.7: **no span type exists anywhere in
`packages/shared`**, so the obligation is unmet and still free, which is the
best state it could be in. §1.9 exactly: `resolveRole` declares `stepOverride`
and `sessionOverride` and the only references to either are its own — two
layers plumbed and still never passed. And the `structuredClone` assertions
§1.3 leans on are still in `turns/steps.test.ts`.

**The claim that half-expired, and it is §1.2's third divergence.** That
section says *nothing at P2 draws inside a step — so the conversion is free
now and expensive after P7 ships steps that do*. **P5.6 shipped a draw inside a
step.** `retrieve` runs in the `call` closure the runner hands each step
(`turns/runner.ts:520`) and draws synchronously in `retrieval/activate.ts:535`,
`rng.at('lore.probability', …).chance(…)`; the runner's own comment says it
plainly — *only a step may propose an effect and this is inside a step's
`call`*.

*The precision matters, because it decides whether the lean survives.* The
drawing code is the **engine's**, on the engine's side of the `call` seam, and
no *mode* step body draws: a step asks for a call and the engine retrieves. So
the conversion is still cheap, and the lean — do it in the first stage — still
stands. What has narrowed is the reason it is safe: from *nothing draws inside
a step* to *nothing that would cross the boundary draws*. **The revisit should
re-price §1.2 against §1.3 rather than against the old sentence**, because if
the hop lands then `call` is a host API and `retrieve` stays engine-side, which
is an argument in the lean's favour that the document did not have when it was
written.

**Two deferrals to this phase that §1.10 did not collect, both in
`modes/registry.ts` and both in its own docstrings.** §0's first job, found by
reading the file the move in §1.1 is about:

1. **Dynamic registration is P7's, and deliberately unbuilt.** `BUILT_IN_MODES`
   is a frozen record and a lookup, *"deliberately **not** a `registerMode`
   API… a registry that could be written to now would be a shape that phase has
   to live with, built before anything could exercise it."* That is P7.0's, with
   the boundary.
2. **A missing mode earns a visible warning on the session, here.** A session
   naming a mode this build does not know resolves to the default and logs the
   substitution ([00 §3.3](../00-stance.md)'s *still somebody's story*), and the
   registry names **P7 — where a mode can genuinely be missing rather than
   merely unknown** — as where that becomes something a person sees. Neither §1
   nor §2 mentions it; it belongs with P7.0 or P7.9.

**And a third, handed over on 2026-09-07 by
[P6B.1](20-p6b-playable.md), which is where P5's contradictions were settled.**
**Lorebook `activationConditions` and `schedule`, unified as channel
predicates** — the minimal comparison set, not 6.0's rule vocabulary.
[work plan §0.3](01-work-plan.md) had it as P5's; P5 decided in the code not to build
it and no document followed, so the roadmap read P5 for four months for a thing
P5 had declined. The decision was right and only the record was wrong: a
predicate needs a channel to be about, and this is the phase where channels stop
being a handful of engine-owned names and become a contract. The design is
written already at [P5 §1.4](17-p5-implementation.md), including the posture for
an entry naming a channel that does not exist — a **visible warning that never
fires**, which is [P5 §3](17-p5-implementation.md)'s gate step 12 and comes with
it. *Do not credit `unknownSources` against that step:* it is the identical
posture for scan *sources*, but such an entry keeps scanning its other haystacks
and can still fire, so it fails the *never fires* clause.

**And two that arrived from [P6B.3](20-p6b-playable.md)'s triage, 2026-09-09.**
Both are [P2C log](14-p2c-log.md) findings from 2026-08-23 that survived
sixteen days and four phases, and **both survived for the same reason: they are
about a surface, and no phase since had a reason to open the file.** That is
the shape [work plan §2.3](01-work-plan.md)'s standing line exists against.

1. **`capabilities` is the only lever for the context window, and it has no**
   **surface** ([P2C 6](14-p2c-log.md)). `routes/connections.ts:54` takes an
   open object with `additionalProperties: true`; a `4096` override lands and
   works end to end. **Nothing in `packages/client` or `docs/api.md` names
   `contextWindow`** — it was found by reading the route. This is *no phase
   exits with configuration that has no surface*, unpaid for connections, and
   P7 owns the settings surfaces ([P6B §4](20-p6b-playable.md) says so
   explicitly). **It needs a decision before a field:** an open bag has no
   schema to render, so either the known keys become a typed shape or the
   surface is a key/value editor, and those are different products.
2. **A running turn describes itself as `failed` on the wire**
   ([P2C 11](14-p2c-log.md)). On disk this is deliberate and argued —
   `turns/runner.ts:825` defines the draft as *the turn as it would be written
   if it ended now*, so a turn written optimistically as `complete` would be a
   completed turn that never finished. **The wire inherited the disk's answer
   without inheriting its argument:** a client reading `turn.status` on a
   running turn is told `failed`, with only `job.status: running` beside it to
   contradict. P7 is the next phase to touch the session contract, and this is
   a contract question rather than a bug — the disk shape should not change.

**And one deferral that arrived after this document was written:**
[25 C14](../25-open-questions.md), opened 2026-09-06 by the guided-redo work.
Does guidance belong on the turn record, and if so as a field on `Turn` or read
back from the block table — to be decided together with
[10 §10](../10-ui-surfaces.md)'s one-click refill, which is the same question
from the composer's side. It touches the shipped preset and the record, both of
which P7.9 grows, so it lands in this phase unless somebody moves it
deliberately.

**What P6 bought this phase, stated as a subtraction the way
[P6 §5](18-p6-implementation.md) states its own.** §1.6 argues party belongs in
a channel because channels have three properties fields cannot — they
reconstruct at a node, they appear as effects, they branch correctly. **All
three are now built and property-tested**, not argued: reconstruction is
proved equal to replay-from-zero at every node, warm and cold. And P5.5 settled
the persisted key — `SessionFile.channels` is keyed by
`channelKey(channelId, scopeKey)` — so a scoped party or presence channel
inherits the shape rather than migrating it. The move is cheaper than the
section assumed.

**What Alpha 1 changed, which is small and worth one sentence.**
[work plan P6A](01-work-plan.md)'s reason for cutting it before this phase was that P7
is the largest phase and the one that most wants a known-good baseline to
measure against; that baseline now exists as a tag, an image and a data
directory that refuses an older build ([P6A §1.7](19-p6a-alpha-1.md)) — which
is worth having in the phase that changes channel shapes under live sessions
([06 §4.2](../06-modes-and-turn-pipeline.md)).

~~**The obstacle in front of the checkpoint, which is nobody's stage and belongs
to whoever runs it.** §5's third bullet says the revisit's first job is to read
what PLAYABLE and P2C found. PLAYABLE has not run, and
[P5 §0.5](17-p5-implementation.md) named the reason it would stall on the day:
**nothing in the client and nothing in `pnpm seed` names a lorebook or a
treatment for the session it makes**, and `PUT /api/sessions/:id/lore` — still
the only route that does — has no caller in `packages/client`. Re-checked
today; still true.~~ P7's own demo needs a session somebody can play as much as
PLAYABLE does, so this is worth clearing before either, and it is a small piece
of P5's document half rather than a stage of this phase.

***Struck 2026-09-10. The obstacle is gone, and it went the day after this
paragraph was written*** — [P6B.0](20-p6b-playable.md), `bded9f7`, merged at
`bf14ce6` and shipped as alpha 3. `client/src/api.ts:725-738` sends `treatment`,
`lore` and `preset`; `client/src/play/LorePanel.tsx` is the mid-session panel and
reaches `setSessionLore` (`api.ts:767`) through `queries.ts:537`; `tools/seed.mjs`
names its treatment at `:164-181`, with a docstring citing this very finding.
**All three clauses are repaired.** §0.1a has the rest.

### 0.1a Re-audited 2026-09-10, at `46bec98` — and §0.1 had already expired

*Run against the code, and against §0.1 itself, because §0.1's own standard is
that a readiness note read against the document rather than the tree is worth
nothing — and that standard turns out to cut both ways. §0.1 was written on
2026-09-07 at `0683779` against the tree at its parent `5602ded`. **Eleven
commits later it has one finding discharged, three narrowed, and one line
reference drifted.** The phase document was last touched on 2026-09-09
(`79bef9b`), which added P6B.3 material underneath a heading still dated
2026-09-07 — so the heading stopped describing its own contents before anyone
re-read it.*

**The tree this was run against.** `p7` is `main` is `46bec98`; nothing of P7
exists yet. `pnpm typecheck`, `pnpm lint` and `pnpm format:check` are clean.
`pnpm test` is 2885 passing, 5 skipped, and **two failures that are this machine
rather than this repository**: `client/src/tailwind-utilities.test.ts` wants a
prior `pnpm build` and passes after one — CI builds before it tests, and the
test's own `NO_BUILD` message says so — and `tools/lint-fixtures/dev-server.test.ts`
fails because the captured log's first line is
`(node:PID) ExperimentalWarning: SQLite is an experimental feature`, which
**Node 22 emits and Node 26 does not**. The repository requires `>=26.4.0`. Both
were reproduced directly and neither is a finding about the code.

#### What §0.1 got right, and still holds

§1.1's negative half entirely: `packages/modes/` does not exist,
`packages/sdk/src/index.ts` is fourteen lines that re-export `shared` and
nothing else, and the four files under `packages/server/src/modes/` are still
four. §1.4's first clause exactly: `ChannelDefinition`
(`sessions/channels.ts:32-56`) is seven fields — `id`, `owner`, `version`,
`scope`, `update`, `visibility`, `budget` — with no `schema`, no `init`, no
`migrate`. The registry is still a frozen two-entry record, both
`engine-computed`, so `model-proposed` and `user-only` still have no subject and
`refuse()`'s `user-only` branch (`turns/effects.ts:110-112`) is still
**unreachable code with no test**. `structuredClone` is still asserted on
`StepInput` and `StepResult` in `turns/steps.test.ts`. And P6's purchase is real:
`sessions/reconstruct-property.test.ts` proves reconstruction equal to
replay-from-zero at every node, warm, warmer and cold, against two independent
oracles and over randomly-shaped trees.

#### One deferral §0.1 collected that was already discharged, and why it survived

**`capabilities` is *not* the only lever for the context window, and it has had a
surface for some time.** §0.1 collected [P2C 6](14-p2c-log.md) from P6B.3's
triage on 2026-09-09. Against the code:

- `client/src/settings/AdminConnections.tsx:225-236` holds a labelled control for
  it — text rather than a number input, *"because an empty box has to mean
  whatever the default is and a number input cannot say that"* — with
  `capabilitiesFrom` at `:795-815` merging rather than replacing, so a
  hand-written override for a capability the form has no control for survives a
  save. Covered at `AdminConnections.test.tsx:523-557`.
- `client/src/api.ts:1007` declares the field.
- `docs/api.md:1571` carries it in the body example, and `:1583-1592` says in as
  many words that *"it was undocumented here until P2C … and the settings form
  now offers the two an operator has a reason to set."*

**It survived because three documents searched for a name that does not exist.**
The finding, the triage row and §0.1 all say `contextWindow`. No such identifier
appears anywhere in the repository; the field is **`maxContextTokens`**
(`providers/types.ts:74`). A grep for the wrong identifier returned nothing and
was read as absence — through a triage whose whole method was *checking each
finding against the file and line it claims about*.

**What survives is smaller and different in kind.** `routes/connections.ts:54`
still types the bag as `Type.Object({}, { additionalProperties: true })` while
`ProviderCapabilities` (`providers/types.ts:59-80`) is a closed **nine**-field
interface. So §0.1's *"it needs a decision before a field: an open bag has no
schema to render, so either the known keys become a typed shape or the surface is
a key/value editor, and those are different products"* is **already answered**:
the keys are a typed shape, and the form renders the two an operator can know.
What is left is smaller and different in kind — and it is still a decision rather
than pure mechanics, because **four of the nine keys are dead**. Narrowing the
route to `ProviderCapabilities` wholesale would type four fields nothing reads,
which is the placeholder [work plan §2.2](01-work-plan.md) forbids arriving
through the door meant to prevent it. So: narrow to the live keys, or narrow to
all nine and mark the dead ones the way the config appliers mark `unread`. An
afternoon, and one sentence of intent. *(The rows in [P2C log](14-p2c-log.md) and
[manual testing §10](05-manual-testing.md) are corrected in place with the same
date.)*

**The third of the three survives, and is narrower than §0.1 frames it.**
[P2C 11](14-p2c-log.md) is real on the wire: `stream/attach.ts:136-159` puts
`turn: draft` — `status: 'failed'` from `initialDraft` — in the same snapshot as
`job: { status: 'running' }`. **But it has no victim in the client that exists**,
and that changes what the decision is about. `client/src/play/reducer.ts:184-210`
reads `job`, `cursor` and `text` from the snapshot and **explicitly drops the
draft**, with a docstring saying why: *"the snapshot's `turn` is deliberately
dropped — [P3.5] … it arrives once, at open, and then goes stale for the rest of
the turn, so a view fed from it would freeze mid-sentence."* Nor does a running
draft reach the transcript: `routes/sessions.ts:557` walks from
`session.headTurnId`, and the head moves only at `appendTurn`, after
`runner.ts:813` has flipped the status. So `PlayPage`'s *"This turn did not
finish."* cannot fire mid-generation.

*So the question is what a **third-party** reader is told, which is the right
question for a phase that publishes a contract — and the client has already
chosen the shape of the answer it wants. The decision is narrow: does
`Turn.status` gain a non-terminal member on the wire while the disk keeps
`failed` per [P2C 10](14-p2c-log.md)'s argument, or does the wire carry the job
state alongside and readers are told to consult it? The reducer has assumed the
first for three phases.*

**And a second false deferral, found the same way.**
[Manual testing §10](05-manual-testing.md) carries *"The record cannot say a
block is advisory — `assemble()` drops `Candidate.advisory`; `ModelCall` records
no purpose. **P7 makes this expressible or it stays unexpressible**"*, owner
*unassigned*. **Both halves were repaired at P3.0**: `assembly/assemble.ts:141`
carries the flag onto the assembled block with a comment naming the finding, and
`ModelCall.purpose` is `shared/src/turn.ts:364`, written at
`turns/calls.ts:301-305`, whose docstring calls it *"the committed half of
[testing §1]'s invariant, beside `advisory` on the block"*. The residue is one
line rather than a phase: nothing asserts the invariant **over a committed
record** — the checks live at `assemble()` and at the pipeline. That is a test
this phase may as well write, not a contract P7 has to make expressible.

**The pattern in both is worth more than either.** A deferral routed to a phase
is checked once, by whoever routes it, and then travels on its label. Two of the
three surface-shaped items handed to P7 were already done. **The re-audit that
catches this is cheap and has to happen when the phase opens, not when the
deferral is made** — which is what this subsection is.

#### What the choke point actually leaks, and it is the finding of this audit

§1.1's claim is that `modes/contract.ts` enumerates every engine type a mode may
see, so *"the move is that file's import list becoming `packages/sdk`'s export
list."* The file is exactly what it says: 32 lines, six type names, two source
modules, `export type` throughout, zero value imports.

**The mode does not go through it.** `modes/scene/mode.ts:4` is
`import { CLOCK_CHANNEL } from '../../sessions/channels.js'` — a **value**, from
a server internal, bypassing the choke point — used at `:83` to populate
`channels`. Two docstrings in the same directory contradict each other about it:
`contract.ts:30-31` says *"Type-only, deliberately: a mode that imported a
**value** from the engine would be a mode that cannot be serialised across a
worker hop"*, and `mode.ts:18-20` says the mode *"reaches for nothing under
`server/` that `../contract.ts` does not name."* The second is false against line
4 of its own file, and has been since `d9cac9f` — so §0.1 missed it too, which is
itself evidence for the standard §0.1 invokes.

**The underlying claim survives and the stated mechanism does not.** Exactly one
production symbol leaks, and the mode source really is nearly move-only. But the
leak is in the direction that costs most: a value cannot be type-only
re-exported, and the dependency is **inverted in a way the engine already
documents**. `channels.ts:69` gives the clock `owner: 'storyengine.scene'` — the
mode owns it — while `channels.ts:44-48` explains that the definition lives in
the engine only to dodge a `const` cycle, *"a TDZ `ReferenceError` at module
load"*. And `modes/scene/mode.test.ts:197` asserts **object identity** between
the engine's registry entry and the mode's declaration, so whichever way
ownership goes, that assertion is a rewrite rather than a move.

**Three ways out, and the third is the one to take.** Either the mode declares
its own literal and the identity assertion goes; or `shared`/`sdk` publishes the
value and the engine ships a mode's channel; or **`ChannelDefinition` moves to the
SDK as the pure data type it already is, `CLOCK_CHANNEL` moves into
`packages/modes/scene`, and `retrieval/timing.ts` imports the type from a third
package** — at which point the cycle the comment is defending against cannot
form. That is P7.1's registry inversion arriving inside P7.0, which is the honest
finding: **P7.0 and P7.1 are entangled at exactly one symbol**, and pretending
otherwise is how P7.0 discovers P7.1 on the day.

#### The boundary is not aspirational, and the move is not one directory move

**The lint rule already has a subject and is already green.** §1.1 calls the
`modes → sdk, shared` policy *"already written and already aspirational"*, and
`contract.ts:23-28` puts it harder — *"the boundary is not enforced yet."* Both
overstate: `tools/lint-fixtures/fixtures/packages/modes/scene/src/imports-server.ts`
imports `@storyengine/server` and `tools/lint-fixtures/eslint-rules.test.ts:82-86`
asserts that **both** layers fire on it, under a test named
*"blocks modes → server, before `packages/modes/` exists"*. It runs on every
`pnpm test`. What P7.0 gives the rule is a **shipped** subject, not a first one;
nobody should budget for turning on a rule that is already passing.

**What P7.0 actually costs is tooling, and two pieces of it fail silently.**
`pnpm-workspace.yaml:5` already globs `packages/modes/*` and `eslint.rules.js:416`
already matches `modes/*/**/*`, so the nested layout is the intended one and the
workspace needs no edit. Everything else does:

1. `vitest.config.ts:130`'s `packages` project includes `packages/*/src/**/*.test.ts`
   — **one level**. A test at `packages/modes/scene/src/mode.test.ts` does not
   match, and would *lint, typecheck and never run*. That is **F16 verbatim**, and
   the same config file records F16 in its own docstring. Silent.
2. `eslint.config.js:125`'s resolver glob `packages/*/tsconfig.json` misses the new
   tsconfig, and an unresolved import classifies as unknown and is **permitted**
   (`eslint.rules.js:392-398`). ~~Silent, and it disables the very rule this stage
   exists to acquire.~~ ***Overstated, measured at P7.0 on 2026-09-11:*** *the
   second clause holds and the consequence does not. Narrowing the glob back to
   one level changes nothing — no package here declares tsconfig `paths`, so the
   `project` list has nothing to contribute and `@storyengine/*` resolves through
   pnpm's symlinks either way. The edit is in as correctness ahead of need. What
   the probe did establish is listed under P7.0 and is more useful than the item:
   for a mode package the graph rule cannot see a forbidden import **by package
   name** at all, because the forbidden package is not resolvable from there, and
   the name ban is the only layer that catches it.*
3. `eslint.config.js:257-260` applies `packageTestOverride` to shared, sdk, server
   and client and not to modes, so the blanket test-file block — which *replaces*
   rather than merges — would leave mode test files with no package-name ban at
   all.
4. Root `tsconfig.json:4-25` needs two references (build and spec), or `tsc -b`
   never builds the package. This one fails loudly.
5. `packages/server/tsconfig.json` must **not** gain a reference to the mode. The
   graph forbids server → modes, and adding it is the obvious move and the wrong
   one.
6. `Dockerfile:76` runs `pnpm --filter @storyengine/server --legacy deploy --prod
   /app`, which copies the server and its dependency closure. **A mode package the
   server may not depend on does not land in the image** unless the deploy filter
   or the loader changes. This is a design decision with a deployment consequence.

**So §1.1's *"it costs one directory move"* is the sentence this audit most wants
struck.** The source move is small; the tooling around a new workspace package at
a nested path is six edits across five files, ~~two of which fail quietly~~
**one of which fails quietly** (item 2, corrected above).

**And dynamic registration is mandatory rather than optional, which §0.1 files
too gently.** §0.1 calls the missing `registerMode` API *"P7.0's, with the
boundary."* It is P7.0's **because of** the boundary: `eslint.rules.js:432` allows
server → server, sdk, shared, so the moment Scene is a package,
`registry.ts:5`'s static `import { SCENE_ID, SCENE_MODE } from './scene/mode.js'`
is a build error. There is no compiling one's way out. Related, and unpriced:
`registry.ts` and `types.ts` are the **host** half of `modes/`, consumed by
`app.ts:49`, `turns/gather.ts:5-6`, `turns/preview.ts:9`, `turns/runner.ts:42` and
`routes/sessions.ts:32`. For the directory to vanish, the types go to the SDK and
the registry is rehomed under `server/src` — the gate's step 1 reads as *the mode
moved out* and means *the mode moved out **and** the host half was rehomed*. The
mode itself has **zero** production consumers outside the registry, which is the
strongest evidence for §1.1's underlying claim and is not in the document.

**The second mode package is never named.** [19 §10](../19-tech-stack.md)'s tree
draws `modes/scene/` and `modes/adventure/` — and **Adventure no longer exists**:
[06 §1](../06-modes-and-turn-pipeline.md) dissolved the grouping into Scene,
Freeform and Campaign as peer modes, moving `freeform` from a preset id inside
`mode.config` to being the `mode.id` itself, and says that move *"is free today
and would not have been later — P7 has not built either mode."* P7.9 builds
Freeform and no stage says where it lands. One line in 19 §10, and a package name
in a stage.

#### The async conversion is sixteen signatures, not one — and it carries a determinism risk

§1.2's third divergence holds and is **stronger than the document argues**. `Rng`
(`rng/rng.ts:72`) and `SiteRng` (`:158`) are classes with `#private` fields, so no
structural interface can stand in for them and the SDK may not import `server`
(`eslint.rules.js:453`). **The conversion is forced by the package split alone**,
before any worker hop is considered — which is an argument for §1.2's lean that
the document did not have.

The failure is also silent rather than loud, which is worth knowing before
somebody prices it. Verified on this checkout: `structuredClone` of a class
instance with private fields returns a bare `{}` on `Object.prototype` — no tape,
no counters, no methods. And `steps.test.ts:212-217`'s claim that *"`call` and
`signal` cross fine"* is false on both: a function throws `DataCloneError`, and an
`AbortSignal` **degrades silently to a detached `{}` with `aborted === undefined`**.
**None of `StepHost`'s three members survives a structured clone.** What singles
out `rng` is not clonability but that `call` and `signal` have bridges invisible
to their callers — `call` already returns a Promise, a signal bridges as an abort
message — while `rng`'s bridge turns eight synchronous methods async.

**The price, counted.** Ten signatures in `rng.ts` (`draw`, `#draw`, `int`,
`float`, `bool`, `chance`, `pick`, `weightedPick`, `shuffle`, `dice`); six that
must go async by propagation (`rolled`, `pickOne`, `settleGroups`, `considerAt`
and the exported `activate` in `retrieval/activate.ts`, plus `retrieve` in
`retrieval/retrieve.ts`); the type on the seam (`StepHost.rng`); roughly sixty
call sites, nearly all in tests; and **four `fc.property` blocks converting to
`fc.asyncProperty`** — three in `retrieval/gate-correspondence.test.ts` and one at
`sessions/reconstruct-property.test.ts:590`, *the P6 property test §0.1 credits
this phase with inheriting.* Production draw sites are exactly **two**, both
engine-side: `activate.ts:572` (`lore.probability`, the line §0.1 cites as `:535`
— it has drifted 37 lines) and `activate.ts:656` (`lore.group`, which §0.1 misses
entirely, and which is the more expensive of the two because `weightedPick`
carries the `usable` replay guard).

**The cheapest discharge is not the one the stage describes.** Nothing draws
through `StepHost.rng` outside one test (`turns/runner.test.ts:1772-1773`), so the
field can be **replaced** rather than converted: give the host an async `random`
capability, leave the engine's `Rng` synchronous, and `retrieval/activate.ts` and
its ninety test call sites are untouched. That satisfies [22 §4](../22-extensions.md)'s
shape at a fraction of the cost, and it is what the revisit should price first.

**And the risk nobody has named.** `Rng.draw` (`rng.ts:126-129`) assigns a draw's
index from a per-`site:purpose` counter **in call order**. While the methods are
synchronous that order is structurally deterministic even inside an async closure,
because `retrieve` runs to completion before the first await. Make the draws async
and the guarantee is gone: two concurrent calls scanning the same entry race for
`lore.probability:<id>#0` and `#1`, and on replay the recorded values bind to
whichever drew first *that time* — *"much later as a branch that reconstructs
wrong"*, which is exactly the symptom `rng.ts:14-18` exists against. **Alpha
sessions on disk carry tapes**, and [19 §14.5](../19-tech-stack.md) makes rewrite
the default swipe gesture, so every swipe exercises the replay path. Mitigation is
cheap if chosen up front and a data-corruption bug if found later. §1.3 treats the
hop as a performance question; this is not one.

**`RandomApi` is specified nowhere**, which makes it an input the conversion
lacks rather than an output. `HostApi` exists only in [22 §4](../22-extensions.md);
`random: RandomApi` names a type no document defines; and `rng.ts:68-71` states
the invariant the API must honour — *"There is deliberately no unkeyed draw: a
draw with no site cannot be replayed, and an API that allowed one would be an API
whose invariant depends on remembering."* Converting to a bare
`random(): Promise<number>` and adding keying afterwards is the same sixteen
signatures paid twice, with a window in between where a mode's draws are
unreplayable.

#### What P7.5 is actually starting from, which is further back than the stage reads

The stage reads as though it consumes existing shapes. It does not.

- **`introduces` does not exist.** `shared/src/schema/hook.ts:20-74` stops at
  `once`. [04 §6.1a](../04-schemas.md) specifies `introduces?: Introduction`,
  `Introduction { actor, entrances, primaryEntranceId }` and
  `Entrance { id, label, text, note? }` — three optional fields on a
  **stable-tier** portable schema carried by three kinds, plus their JSON-schema
  exports, plus the `/1`-stays-`/1` argument. P7.5 is not consuming `introduces`;
  P7.5 is adding it. Every dependant — the reversed clause, entrance selection,
  the closure walk, provisional firing — is typed against a substructure that is
  not there.
- **`hookPacing` does not exist either.** `grep -rni pacing packages/` returns
  nothing. [04 §6.1b](../04-schemas.md) specifies it as optional on Treatment
  *and* Setup, with `stagingNotes` under the same argument. So §1.4's dial is not
  *a channel plus an init policy* — it is a channel, a policy, and **two fields on
  two published portable schemas** before the init has anything to read.
- **Session creation copies no hooks.** §P7.5's obligation 1 pins that a copy
  *keeps the id*; there is no copy. `NewSession` (`sessions/store.ts:117-141`)
  takes name, mode, preset, cast, treatment and lore, and only the **preset** is
  copied — treatment and lore are links, deliberately. What the stage builds is a
  session-side hook pool (a new `SessionFile` field, which is also the pool's
  missing fourth source), a copy step at creation, and *then* the id rule.
  [15 §5](../15-world.md) grades this *"Real, and unrecoverable if missed"*; the
  risk is that a stage reading it as a one-liner defers it as one.
- **There is nothing to move out of the session file.** §1.5's first correction
  says firing state *moves* out of the session file into a channel. `SessionFile`
  has no hooks and no fired-set, and **[03 §4.1](../03-data-model.md) has already
  been corrected in place** — it now reads *"Which have fired is channel state,
  not a session field"* with its own dated note. So nothing is being corrected
  there and nothing is being moved here: P7.5 declares a **new** channel.
- **The selector's record line has nowhere to land.** `StepOutcome`
  (`shared/src/turn.ts:424-434`) carries `skipReason`, typed `StepSkipReason =
  'cadence' | 'stage' | 'not-armed'` — a closed set derived from `StepCondition`'s
  three arms, with no free-form member. *Held by pacing* / *nothing eligible* /
  *judged none* / *fired X and why* is an addition to `@storyengine/shared`'s
  record types, which the workbench and every reader consume. §1.5 calls it a
  correction; the code calls it a record-shape change.
- **The guidance slot cannot position a step's block.** `collect.ts:445` fills
  `se.guidance` from `context.guidance ?? ''` — the user's box — and
  `assembly/types.ts:30-36` types `SlotSource` as
  `Exclude<BlockSource, { kind: 'preset' } | { kind: 'step' }>` because *"a slot
  positions content the engine produces, so it can never point at a step's
  contribution."* Step candidates are appended after the preset's
  (`runner.ts:622`). So a fired hook's text would arrive at the **end** of the
  prompt rather than where the preset put guidance. That is
  [25 C13(c)](../25-open-questions.md), which this document never cites.
- **A hook has nowhere to be authored.** There is no treatment editor and no setup
  editor: `client/src/library/fields.ts:142-167` types the editor kinds as
  `actors` and `lorebooks` only, and `fields.test.ts:150-155` asserts the negative
  for treatments, setups, presets and packages. [06 §6.1](../06-modes-and-turn-pipeline.md)
  calls authoring affordances *"part of the feature, not polish"*. Either P7.5
  inherits an editor — which is not P7.4's wizard, a different surface — or the
  whole stage is exercised through hand-edited JSON.

**Two ordering dependencies fall out of this and are not in §2.** *Introduced* is
defined over presence and party effects on the path
([06 §8.1](../06-modes-and-turn-pipeline.md)), and neither channel exists — so
**P7.5's obligation 2 depends on P7.2**, not on a naming choice. And an
introduction hook is recorded *provisionally fired*, becoming fired only when
**the extract stage** confirms the subject present — so the fourth property row
needs **P7.7**, which §2 schedules after P7.5. Firing also *"contributes the
subject's card for that turn and adds their aliases to the shared keyword scan"*,
which is P7.7's pass again.

**One of the four property rows belongs to nobody.** Row 3 — a closure walk
reaching an actor named only by `introduces` — is written against the
export-as-package walker at [04 §9.1](../04-schemas.md), **whose own table has no
hook row at all**, and which does not exist in code: `Package` is a schema with no
exporter. So a row the header says *"this phase establishes"* cannot become a test
this phase unless P7 also builds the walker. What P7 *can* do, and must, is write
the hook row into 04 §9.1's table when `introduces` lands — because a walker built
later against the table as it stands is precisely the *"only follows `cast`"*
walker the row exists to fail.

#### What P7.4 and P7.6 are starting from, which is also further back

- **The `setups/` kind has a writer.** §P7.4 says it *"has had a folder in the
  layout since P1 and no writer."* It has a folder (`registry.ts:104`), a
  canonical filename (`storage/layout.ts:72`), a generic index walk
  (`index-db/rebuild.ts:69`), full CRUD through the one handler set
  (`routes/library.ts`), a library shelf (`client/src/library/labels.tsx:18`), and
  a `newSetup` factory (`factories.ts:228-249`) **whose only caller is a test**.
  What it lacks is an author-facing producer and **any consumer at all**: session
  creation takes mode, preset, treatment, cast and lore as five separate
  parameters and has no `setup` field.
- **A name collision the stage walks into.** `Setup` — the portable library object,
  shipped, 149 lines, carrying `hooks: PlotHook[]` and `goals: Goal[]` — and
  `SetupSchema` — the mode's wizard declaration, `= NoSetup` at
  `modes/types.ts:135` — are different things, and §P7.4 names both in one breath.
  The stage owes both.
- **Declaration-driven *rendering* exists; declaration-driven *input* does not.**
  `client/src/library/fields.ts` reads the emitted JSON Schema at runtime and
  `ByField.tsx` renders any object of any known kind from it — genuinely good
  machinery, and read-only by design. Every editor and every settings pane is
  hand-written JSX; `editor/EntryFields.tsx:180-256` is the closest hybrid and is a
  five-case `switch` on property name whose docstring calls the switch *"the whole
  answer"*. There is no `WidgetSpec`, no schema→control dispatcher, and **no route
  that would hand a declaration to the client**. So §5's ranking of P7.4 as the
  contract's hardest single claim is right and understated: it starts from zero on
  the write side.
- **Incremental generation starts below zero.** `GenerationRequest.schema` and
  `GenerationResult.object` exist in `providers/types.ts` and
  **`providers/openai-compatible.ts` mentions neither** — only the scripted double
  honours them. The retry ladder (`turns/calls.ts:153`) is two fixed transport
  backoffs with **no validation arm**; nothing anywhere re-asks because output
  failed a schema. And no model has ever proposed an effect: `proposedBy` admits
  `{ kind: 'model' }` and every producer in the build is `engine` or `user`. So
  P7.4 builds structured output end to end before it can build anything
  incremental on top.
- **Goals are a schema and three inert references.** `Goal` is shipped and is a
  clean subset of what [06 §7.3.3](../06-modes-and-turn-pipeline.md) asks for — so
  §P7.6's *"the chain, not a field"* is **already true in schema**. There is a
  `SlotSource` arm (`preset.ts:171`), a `BlockSource` arm (`turn.ts:172`) and a
  workbench label (`workbench/address.ts:65`), and `collect.ts:579-581` returns
  `[]` for the slot and reports `no-producer`. Everything else is runtime and
  absent: no goal channel, no cursor for which goal is current, no achieved state,
  no link to the completing turn, no session-authored goal, no concluded state, no
  evaluation step. **The first `model-proposed` channel in the build is this one.**

#### Two more things nothing reads, and one live defect

**The channel-to-text renderer does not exist, and `budget` is a field with no
reader.** An author can name a channel in a preset slot today —
`shared/src/schema/preset.ts:152` carries `{ of: 'channel', channelId }` — and
`assembly/collect.ts:578-582` returns nothing for it, with the reason at `:573`:
*"a channel value is an object with **no channel-to-text renderer specified** —
which is also why the clock's budget is null."* The only readers of a
`ChannelDefinition` anywhere are `refuse()` reading `.update` and `acceptEffect`
reading `.version`. So `budget: null` is not the pacing dial declaring restraint;
it is **the only value any channel can carry**, because the path that would spend
tokens is not built. This is the injection half of the channel contract, it is
not the same thing as [10 §8](../10-ui-surfaces.md)'s HUD widget vocabulary, and
P7.1's stage text names only the second.

**06 §4.2's error surface is unbuilt and unowned.** `ChannelState.degraded`
(`shared/src/turn.ts:513-527`) has no writer and no reader, and says so —
*"The writer arrives with the first `ChannelDefinition.schema`."* §1.4 collects
the validate-coerce-migrate-quarantine ladder from [25 B7](../25-open-questions.md)
and stops at *"being real"*; the ladder's fourth rung **is** the surface, because
quarantine is only survivable if something tells the person and offers the
recovery. [06 §4.2](../06-modes-and-turn-pipeline.md) calls it *"the part worth
building properly, and the part the sources have nothing like."* No stage names it.

**And a live defect in shipped code, found on the way.** `divergenceEffects`
(`sessions/channels.ts:284-314`) iterates `Object.keys(replayed)` and
`Object.keys(onDisk)` — which for a scoped channel are **composite** keys such as
`se.lore.timing#sticky` — and passes each straight to `effect()` at `:315-334`,
which hardcodes `scopeKey: null`. `scopeKeyOf` (`:190-194`) is the exact inverse
and is never called from here. So a hand edit to an entry-scoped channel — which
[03 §8.1](../03-data-model.md) and this module's own docstring call a supported
way to get data in — records a user-attributed effect whose `channelId` does not
resolve through `channelDefinition()` and whose `scopeKey` is null. It round-trips
**by accident**, because `applyEffects` re-derives the same map key, which is why
nothing has noticed. Shipped in Alpha 1 with `se.lore.timing`, and **P7.1
multiplies scoped channels**.

***Fixed 2026-09-10, before the phase rather than inside it.*** `channelKey` now
has a declared inverse — `splitChannelKey`, beside it, splitting at the first
separator on the same assumption `channelKey` makes in reverse — and
`divergenceEffects` decomposes each map key rather than passing it through as an
id. **The map is unchanged**, which is the point: `applyEffects` rebuilt the same
string either way, so nothing on disk moves and no session needs migrating. What
changes is that the recorded effect now names a channel `channelDefinition` can
resolve and a scope key a reader can render. Four tests cover it — a scoped edit,
two scoped edits kept apart, a scoped delete, and the reversal path that carries
`channelId` and `scopeKey` through unchanged — and all four are red against the
old function, one of them reading `expected 'se.lore.timing#e-1' to be
'se.lore.timing'`, which is the defect stated exactly.

#### The deferrals this phase had not collected

*Found by the method §0.1 used and applied to the files the other stages are
about. Each is a line or two to collect and awkward to discover mid-stage.*

**From the corpus, routed here by name and never read back:**

1. **[25 C13](../25-open-questions.md) — the randomizer questions — names P7 and
   is cited nowhere in this document.** C13(a) is that a step's judgement call is
   re-run on rewrite, so a draw made over its output cannot replay; its own lean
   is *"do (a) with P7's async-draw conversion"*, i.e. §1.2's. [23 §5.1](../23-randomizers.md)
   names the plot-hook selector as having *"the same exposure in principle"* —
   and the selector's stage 2 **is** a judgement call with an entrance drawn over
   its output. C13(c) is the guidance-positioning problem above; C13's own text
   says *"the first two get expensive after P7."*
2. **[25 C5](../25-open-questions.md) — steps that suspend for player input — plus
   [P3 §1.6](15-p3-implementation.md)'s explicit *note for P7*: the obvious name
   is taken.** `Turn.status: 'suspended'` (`shared/src/turn.ts:545`) already means
   *will resume and complete*. One naming decision, made before the first
   suspending step is written, or every step written this phase is written against
   a vocabulary that later has to move.
3. **[25 C3](../25-open-questions.md) — impersonation, and the split P11 asks P7
   to make.** [P11.4](27-p11-implementation.md) says *"this stage is whatever half
   of that P7 did not take, and the revisit should start by finding out which."*
   P7's revisit did not know it was asked.
4. **[25 A1c](../25-open-questions.md) — the namespaced key/value storage host
   API.** If P7.0 publishes `HostApi`, P7.0 decides whether storage is in it.
   Extension *installation* is P10's; the API is not.
5. **P8's spoiler defence is a P7 dependency.** [P8](24-p8-implementation.md)
   requires that memory never extract from hidden content — a hook's premise, an
   unfired hook's entrances, a hidden channel, GM-only state. All four arrive in
   this phase, and the defence needs hidden content **identifiable to a later
   extractor**, not merely hidden in a panel. A flag and a discipline in P7.1 and
   P7.5.
6. **[P9](25-p9-implementation.md) asks for two things, and §P7.9 collects one.**
   The backdrop channel's media reference is collected; *"P7 owes P9 a step that
   can be added without a back door"* is not — and it is the contract's fourth
   witness, which bears directly on §1.8. Nor is the **location channel** P9's
   backdrop selector assumes P7 declares.
7. **[P10](26-p10-implementation.md)'s notification classes come from this phase's
   hooks and goals**, and its revisit is told to re-read P7's gate for *things a
   person should be told about*. The gate has to contain them.
8. **[R11](22-walkthrough-refinements.md) — suggested actions — is routed to P7.9
   by name**, together with a persisted-shape question: whether unselected
   suggestions are generated inside the turn as a `post` step or stored beside
   `lastSelectedChild`. Turn segments are append-only, so this forks the record.
9. **[R2 / F-01](21-playable-log.md) is routed to "P7 §1.9" by two documents**, and
   §1.9 does not know. The real blocker behind *use a second model* is a
   **role-binding editor** — [10 §15.1](../10-ui-surfaces.md)'s user half — which
   is a different thing from the session and step override layers §1.9 is about.
10. **[04 §8.5](../04-schemas.md)'s four genuinely-unsettled preset questions**,
    two of them mode-facing: the `SlotSource` list *"which will grow as modes
    declare channels"*, and whether `CallKind` *"is closed or extensible by
    modes"*. Both were waiting on an assembler that now exists, and P7.1 answers
    the first whether anyone notices or not.
11. **[P5 §3](17-p5-implementation.md)'s closing no-surface list**, which named
    P7's setup wizard as the owner of session `treatment`/`lore` selection —
    **partly discharged by P6B.0**, and the rest not: `SlotSource.outlet` is set by
    no shipped preset with no preset editor, and the five per-book retrieval knobs
    and the book-level `enabled` gate have real consumers and no write surface.
12. **[Triage §6.3](02-triage.md)'s acceptance test** is gate step 10 stated harder
    and with three named parts: *"if a motivated person cannot build UNO against
    the extension API without engine changes, [06 §9] has failed"* — a channel
    holding board state, a step validating moves, a declared widget.
13. **Hidden GM state as a channel** ([triage §4](02-triage.md)) — a PORT verdict
    with no phase, which *"generalises to all modes for free"* once channels are a
    contract.
14. **[20 §client-loading](../20-client-loading.md) forecasts this phase's bundle
    pressure** — mode selection, setup, party, hooks, goals and their declarative
    widgets — and P7.1's widget vocabulary is where it grows.
15. **[13 §13](../13-write-mode.md)'s P7-era falsification test**: *"if the first
    thing people do at P7 is turn the marking off, the overlay does not survive the
    scale change from turns to documents."* An observation P7.7 has to make while
    mentions are live, not a build item.

**From the source, by reading the files the stages are about:**

16. **`MINUTES_PER_TURN` is a placeholder deferred to a stage that already
    shipped.** `sessions/channels.ts:199-207`: *"the mode is what should decide
    this ([06 §4]), and there is no mode configuration to read it from until
    P2.6."* P2.6 landed; the advance is still a constant folded in by the runner
    after the step loop (`runner.ts:788-809`). It is the smallest possible instance
    of P7.1's whole question — a channel whose *reducer* is engine code with a
    mode-shaped parameter — and the cheapest test of whether `ChannelDefinition`
    needs anything reducer-shaped at all.
17. **The guidance/RNG leak the worker hop would close.** `turns/steps.ts:125-130`:
    [06 §5.2](../06-modes-and-turn-pipeline.md)'s first exclusion is *the RNG
    service and anything consuming it*, and `callPurposeFor`'s derivation *"does
    not cover that — a prose step is handed both the guidance and an `Rng`."* §1.2
    and §1.3 argue the conversion on cost and on the boundary; this is the only
    argument that is about **correctness**, and it is a third reason for the hop.
18. **`voice` and `dispatch` become optional *session* fields**
    (`modes/types.ts:36-48`) — a record-shape change, free now and a migration over
    saved games later. §P7.3 promises the two visible *controls*, which is the
    surface, not the field.
19. **The input-kind selector.** Scene declares `inputs: ['do']` and
    `ModeDefinition.inputs` documents five kinds; `say` / `think` / `story` /
    `choice` *"arrive with the input-kind selector, which is a surface this stage
    does not build."* Declared configuration with no surface, which is the standing
    line, in the phase that owns it.
20. **The preview's fifth state** — *this turn will not narrate*. `turns/preview.ts:43-46`
    refuses to evaluate a step's `when` because no shipped mode can reach it, and
    *"it arrives with the first mode that can exercise it."* The first
    cadence-gated step is this phase's: the selector runs every turn with the dial
    as a gate inside it.
21. **`pick` and `shuffle` carry an open replay hazard whose closing is deferred to
    *"the first production caller"***. Their `detail` is `n=<length>`, which
    describes a list's size and not its membership, so a replay against a
    same-length list hands back a position into different content; `draw`'s
    `usable` gate is the mechanism waiting for it. **P7.5's entrance selection is
    that first caller.**
22. **`clockEffect()` is exported production code with no production caller**, and
    four test files shadow it by name. Housekeeping, but it is in the file P7.1
    rewrites and P7.0 moves, and a dead export that survives a directory move reads
    as the contract.
23. **Lorebook `entry.extensions` has no consumer until this phase's extension
    host**, and nothing writes it.
24. **A model *tier* is derivable from bindings without a migration and the reverse
    is not** (`providers/roles.ts:29-33`) — *"if P7 finds a real use"*, and
    P7.3's `per-actor` dispatch is the first thing that could want one.

#### Two documents that disagree, in the sentence this phase relies on

**§1.3 cites [06 §9](../06-modes-and-turn-pipeline.md) and
[22](../22-extensions.md) in one breath to settle the hop, and they contradict
each other about randomness specifically.** 06 §9 still says an extension in a
worker *"cannot reach an unrecorded random source"*; 22 §4.0 retracts exactly that
phrasing — *"wrong, and wrong in the direction that matters… A Node worker thread
is not a sandbox."* If the worker does not enforce recorded randomness, the
enforcement is a lint rule plus the extension test kit's replay-determinism check,
which changes what the conversion is buying. A doc edit, before P7.0.

**And the retired sentence has four homes, of which §1.2 amended one.** *"Nothing
at P2 draws inside a step"* still stands unamended at
[22 §4](../22-extensions.md), at `turns/steps.ts:128`, at
`turns/steps.test.ts:220-221`, and inside §P7.0's own stage cell. Two of those are
in the server's source and are **the first files a P7.0 implementer opens** —
`steps.ts` *is* the contract being moved. A docstring that contradicts the plan is
how a stage re-derives a decision the phase already made. Also in the same
neighbourhood: `22 §4` cites `[19 §11]` for the RNG, and 19 §11 is *Dev mode* —
randomness is 19 §14. The renumber preserved a section number that was already
wrong, and it is the one citation a P7.0 implementer would follow to learn what
`RandomApi` owes.

### 0.2 What must be true before the phase opens — and what need not be

*The blocking box [P6 §0.3](18-p6-implementation.md) is the model for. Written
because §0.1's version of this — the struck paragraph above — is now false, and a
readiness note whose blocker has been repaired invites the opposite error of
holding a phase for nothing.*

**Genuinely blocking, and only this: PLAYABLE.** It is
[P6B.2](20-p6b-playable.md), and its critical list is
[sitting K](05-manual-testing.md) — ten items, every result cell blank. **There is
no buildable work left in P6B**: P6B.0 and P6B.1 are in the tree, P6B.3's desk
pass ran on 2026-09-09, and K0 — the build the sitting is walked against — is cut
as alpha 4 (`a7145cc`). What K wants that does not exist is a **twelve-entry
hand-authored SillyTavern world** spanning the `position` map, which is K2 and is
deliberately a person's making job; the shipped `RAIN_CITY_BOOK` fixture has
entries at positions 0 and 4 only, so [P6B §3.1](20-p6b-playable.md)'s *"the
shipped fixture will not do"* stands verbatim. **P7 opens when K1–K9 have
results.**

**Not blocking, and this is the half worth writing down.** The precedent is
[P6](18-p6-implementation.md)'s: *"neither blocks P6.0, which is the whole of the
engine and ships no UI."* It applies here more strongly, not less.

- **P7.0 is not invalidatable by PLAYABLE.** It ships no behaviour and no UI: a
  package move, a host API signature, and a build error. No finding about the
  record, the budgeter or inclusion reasons can falsify a change that alters no
  behaviour. And **`packages/sdk` is `"private": true` at version `0.0.0`** — the
  word *published* in its description is what it will be, not what it is — so
  after P7.0 the contract has exactly one consumer in the tree and getting it
  wrong costs a refactor of one small package rather than a migration. That is the
  argument for doing it **before** PLAYABLE rather than after, and it also leaves a
  decision nobody has named: whether this phase starts versioning the SDK, and what
  gate step 10's *"against the published SDK"* means while the package is private.
- **P7.1 and P7.9 are the two stages that should wait on K.** §5's sentence about
  the record landing *"in the middle of this phase's channel and effect work"* is
  about P7.1 specifically: the persisted shape is safe — P6 property-tested
  reconstruction and P5.5 settled the key — and what is exposed is what a channel
  must **declare and show**, which is exactly what a legibility finding would
  reshape. P7.9 is exposed for a different reason: it grows `SCENE_PRESET`, and
  `SCENE_PRESET` is the artefact **K4 is built to interrogate**. P6B.1 already moved
  it once, on an argument its own plan got wrong.
- **P7.7 waits on P7.1, not on PLAYABLE**, and inherits second-order risk through
  what an inclusion reason *says*.
- **P7.2, P7.3, P7.4, P7.6 and P7.8 have no direct PLAYABLE contact.** No K item and
  no hypothesis touches cast, participant policy, setup schemas, goals or
  difficulty — [P6B §4](20-p6b-playable.md) puts the cast panel out of scope
  *because* P7 owns it. They inherit risk only through P7.1's channel shape, which
  is an argument for sequencing them after P7.1 rather than for holding them behind
  the checkpoint.
- **P7.5's PLAYABLE dependency is really P11's.** No hooks exist, so PLAYABLE cannot
  see them; §4 puts the *tuning* in P11, *"which can only be done by playing"*. Its
  two World obligations are unrecoverable-if-missed and independent of anything the
  checkpoint could find.

**Ordering inside the phase, which is not a prerequisite but behaves like one.**
§1.2's conversion before any new step is written; §1.4's dial cannot precede the
policy; **P7.2 before P7.3**, because `ParticipantPolicy.select: 'fixed'` is
documented as *"the declaration that the cast cannot change as an outcome of a
turn, which is what **licenses** a plain `cast` field on the session instead of an
`se.party` channel"* — so the moment `select` gains a second arm the field's
licence expires; **P7.2 before P7.5's obligation 2**, and **P7.7's `extract` step
before P7.5 can close its fourth property row**; P7.6 before P7.8, which §P7.8
already says.

**Worth clearing cold, before the phase rather than inside it.** Each is a doc or
a test edit, none is a stage, and every one of them is something a stage would
otherwise stop to argue about:

***All ten are discharged as of 2026-09-11.*** *Four of them turned out to be
under-scoped by this list rather than merely undone, and in each case the extra
was the more interesting half: item 2 found 06 §9 wrong about credentials as well
as randomness, and settled that the worker hop **relocates** recorded randomness
rather than enforcing it — which removes both of §1.3's arguments for landing the
hop in this phase. Item 5 found that the cost of no browser-settable cast was not
a missing panel but a narrator told nothing about who it is narrating for, on
every browser-made session. Item 6's premise was wrong — `scope` removes the
reason for a partial op, so `EffectOp`'s arms stay unimplemented by decision.
Item 10 named one test in a block of three and the complaint was about all three.
Two items — 3 and 8 — were discharged earlier, in the stage that needed them.*

1. ~~**The four retired-sentence homes and the `[19 §11]` citation** — 22 §4,
   `turns/steps.ts:128`, `turns/steps.test.ts:220-221`, and §P7.0's own cell.
   **22 §4 now owes three corrections rather than one**: the retired sentence,
   `blocks` → `Candidate`, and the full effect → `EffectProposal` (§1.2), plus
   the `[19 §11]` citation, which points at *Dev mode* where it means randomness
   at 19 §14.~~ **Done 2026-09-11.** All four homes and the citation. 22 §4's
   blockquote now records the three divergences as *settled* rather than as
   deliberately unreconciled, and its `StepResult` sketch carries `Candidate` and
   `EffectProposal`. *One thing was added rather than corrected: the sketch still
   differs from the shipped contract in four further places — `StepContext` is
   two parameters, `message` is singular, `config` has no home, `suspend` and
   `diagnostics` are unbuilt — and those are now listed there with a date, so the
   next reader does not rediscover them and mistake a sketch for the contract.*
2. ~~**06 §9 against 22 §4.0** on whether a worker enforces recorded randomness.~~
   **Done 2026-09-11, and 06 §9 was wrong about more than randomness.** That
   paragraph made *two* claims structural — no credential and no unrecorded
   random source — and 22 §4.0 retracts both by the same argument: a Node worker
   can `require('node:crypto')` and `require('node:fs')`, and connection
   credentials are **files under the data directory**, not environment values. So
   neither is unreachable. What is structural is that neither is *handed over*:
   the payload carries no credential and randomness arrives as a host capability.
   The enforcement is therefore named rather than assumed — the `node:crypto`
   lint rule and the extension test kit's replay-determinism check — which
   settles what §1.3's conversion is buying: it **relocates** recorded
   randomness, it does not enforce it.
3. ~~**`RandomApi`'s shape** — at minimum whether a host draw carries `(site,
   purpose)`. It is the conversion's input, not its output.~~ **Settled and
   built 2026-09-11, at the head of P7.0.** It carries them: `rng.ts`'s *"there
   is deliberately no unkeyed draw"* is an API property rather than a
   convention, and [19 §14](../19-tech-stack.md) puts extension draws on the
   tape, so a bare `random(): Promise<number>` was never open. `at(site,
   purpose)` stays **synchronous** — it names a draw rather than making one, so
   across a hop it is a local constructor and only the draws are messages — and
   the eight methods behind it are `SiteRng`'s, asynchronous. See
   `rng/random.ts`.
4. ~~**19 §10's tree**, which still draws `modes/adventure`.~~ **Done
   2026-09-11.** It draws `modes/freeform/` — which also answers the *"P7.9
   builds Freeform and no stage says where it lands"* gap §0.1a opened — and
   records the shipped package name, the one-level-deeper nesting and its cost.
   §10's closing paragraph gained the half it did not anticipate: the rule runs
   both ways, so the server acquired a **loader** rather than merely losing an
   import, and the engine now has no compile-time knowledge of any mode at all.
5. **A cast the browser can set — the persona half done, the actors half
   deliberately not.** `PUT /api/sessions/:id/cast` and
   `POST /api/sessions`'s `cast` field both accept one and **neither has a caller
   in `packages/client`** — the identical shape of gap P6B.0 just closed for
   lore, still open beside it. It is the standing line again, and it is a
   prerequisite for this phase's own demo rather than a nicety: P7.2's gate step
   wants a character dead on one branch and alive on the other *in the panel*, and
   a session made in a browser has no cast for the panel to be about. `pnpm seed`
   sets one; a person cannot.

   ***Half done 2026-09-11, and the half is the decision rather than a scope
   cut.*** The item and the client disagreed: `SessionsPage` and `LorePanel` both
   carry a docstring saying a cast control *"would be built against a shape P7
   replaces"*. **§1.6's correction of 2026-09-10 is what tells them apart** —
   `cast` does not stop being a field. `cast.actors` becomes channel state;
   `cast.persona` stays, because [06 §8](../06-modes-and-turn-pipeline.md) and
   [03 §5.5](../03-data-model.md) both make it *"the one part that can stay a
   plain session field… chosen at setup"*. So a **persona** control is permanent
   surface and an **actors** control is not, and the blanket deferral was costing
   the first in order to defer the second.

   The persona half is built: a picker in the create form's disclosure, sent as
   `cast: { persona, actors: [] }`, asserted at the wire as well as at the
   component — the server side was already proven end to end by
   `routes/sessions.test.ts`'s *"fills the persona and actor slots that were
   unreachable before"*, so what was missing really was only a caller. Both
   docstrings now say which half they defer and why.

   *And the cost was larger than "no cast for the panel to be about", which is
   why this is worth doing before PLAYABLE is walked rather than after.* The
   shipped preset carries an `se.persona` slot with `omitWhenEmpty: true`, and
   `collect.ts` resolves `{{user}}` to `context.persona?.actor.name ?? 'the
   player'`. **Every session started in a browser had `persona: null`** — the
   slot emitted nothing and the narrator was instructed to address *the player*.
   That is not a missing panel, it is the model being told nothing about who it
   is narrating for, on every turn of every browser-made session, and sitting K
   is walked against browser-made sessions.

   *Still open, deliberately:* `cast.actors`, which is P7.2's, and a later
   persona change, which `PUT /cast` accepts and nothing offers — 06 §8 calls
   changing it mid-session *"an explicit act rather than an outcome of play"*, so
   its home is a decision rather than an omission.
6. ~~**`ChannelEffect.op`'s unimplemented arms** — decided before P7.2 designs the
   party timeline's payload, per that stage.~~ ***Decided 2026-09-11: they stay
   unimplemented, and `scope` is what makes that hold.*** P7.2's cell poses it as
   a choice between carrying the whole timeline in `before`/`after` on every
   membership effect — O(party history) per effect, an unreadable log — and
   implementing `append` first. **Neither, because the cost follows from the
   scope rather than from the op.** A channel's value is already partitioned by
   `scopeKey`; P5.5 built the composite key and P6 property-tested it. An
   **actor-scoped** `se.party` makes each effect carry one actor's `PartyMember`
   records — bounded by that actor's own join and leave count, one or two — and
   `set` at `/` on a scope key stays sufficient. That also puts party on the same
   scope vocabulary as presence and status, which P7.2 already introduces as the
   first writers of `scope: 'actor'`.

   **And the argument against a partial op is correctness, not cost.**
   `applyEffects` replacing the whole value at a key is what makes
   replay-from-zero equal snapshot-plus-replay *by construction* — the P6 gate —
   and what makes an inverse a swap rather than a computation. Every partial op
   is a **reducer**: a second implementation of the value's semantics that the
   gate has to be re-proved against and that `before` has to be able to invert.
   Affordable for a channel that genuinely needs one; not affordable as a
   speculative arm, and this is the shape [P2 §2.7](08-p2-implementation.md)
   rejected under a different name.

   *What reopens it, stated so the decision is falsifiable:* a channel whose
   value is unbounded **within one scope key** and written often. Nothing at 1.0
   has one. So an arm is implemented when a channel needs it, and that channel
   first has to say why its value cannot be scoped instead — and
   `acceptEffect`'s throw already names what changes first.

   *What this does not settle, which is now a payload question rather than a
   vocabulary one:* the **narrator selection** is session-wide, so an
   actor-scoped `se.party` has nowhere to put it. Either it is a per-actor flag
   with an "exactly one" invariant the fold checks, or it is a second channel.
   P7.2 owns that, and it is a question about where a value lives rather than
   about what an effect can express — which is the whole point of deciding this
   cold.
7. ~~**03 §8's `MentionSpan`**, which is §1.7's forbidden shape written into the
   data model (§1.7).~~ **Done 2026-09-11, and the three shapes are now one.**
   03 §8 carries `TextSpan` with a **tagged** `target` — one arm, `actor`, at 1.0
   — under a turn field called `spans`; 06 §8.2 points at it instead of restating
   a fourth shape; `packages/shared/src/turn.ts`'s note about the absent field is
   corrected to match. `field` survives, because a record storing two texts needs
   it and 06 §8.2's omission was the ambiguous version. *The decision the item
   did not name: `Ref<T>`'s parameter is **phantom** — [04 §3] makes a `Ref`
   `{id, name, fingerprint?}` — so `ref: Ref<Actor>` would have erased into JSON
   as an untagged link, and a later reader could not tell an actor span from a
   beat span. The tag is what the obligation actually needed.*
8. ~~**`divergenceEffects`' scoped-channel defect.**~~ **Done 2026-09-10.** By the
   bar [P6B §0.3](20-p6b-playable.md) and [P2C §1](12-p2c-first-real-run.md) set —
   an item is pre-work only if leaving it undone makes the phase's own work
   untrustworthy, not merely if it would be convenient — it **qualified**: a live
   defect in the exact function P7.1 rewrites, under a type P7.1 is
   simultaneously growing `schema`, `init` and `migrate` on, and after P7.1 every
   mode-declared scoped channel is on the same path. §0.1a records what landed.
9. ~~**Repointing the ten server test files that use the mode's internals as generic
   fixtures.** After the move these are server → modes imports, which the graph
   forbids. Doing it inside P7.0 buries a large mechanical diff inside the stage
   whose falsification test is *"no diff outside imports"*; doing it first is pure
   preparation and reviewable on its own.~~ **Done 2026-09-11, at the head of
   P7.0 and as its own commit**, which is the "reviewable on its own" this item
   asked for. Three of the ten were not fixtures at all — they assert *the default
   mode's* preset, which the registry can answer — and the other seven moved to
   `test-mode.ts`, a fixture the engine owns, copied from Scene so that no test
   changed meaning on the day it arrived.
10. ~~**The strengthening or retiring of `steps.test.ts:212-224`**, which asserts
    nothing about clonability — it compares `Object.keys` on a hand-built literal
    whose `rng` is `{}` — while stating two things that are false. §1.3 leans on
    it as evidence about the seam.~~ **Strengthened at P7.0, and its two
    neighbours were strengthened on 2026-09-11**, which the item under-scoped:
    §1.3's second correction is about all three tests in that block, not one.
    The `StepInput` and `StepResult` fixtures are now exhaustive *by type* —
    `Record<keyof Required<T>, true>` must name every key, so adding a member to
    either stops the file compiling until somebody decides whether it crosses —
    and `history` carries a real `Turn` rather than `[]`, which is where an
    `unknown` that cannot cross would actually hide.

---

## 1. Decisions this plan has to make

### 1.1 The move is a move, or it is a rewrite — and one file already knows

[P2 §2.4](08-p2-implementation.md) put the Scene mode in `server` and promised
it **relocates behind the SDK at P7 without changing shape**. The thing that
decides whether that is true is how many engine types the mode reached for, and
P2 answered it in advance: `packages/server/src/modes/contract.ts` enumerates
every engine type a mode is allowed to see, type-only, with a docstring saying
that is exactly what it is for. **The move is that file's import list becoming
`packages/sdk`'s export list.**

The enforcement is already written and ~~already aspirational~~ **already
tested**: `eslint.rules.js` carries a `modes → sdk, shared` policy matching
`packages/modes/*`, a package that does not exist. This phase is where the rule
acquires a subject. That is the cheapest possible test of
[06 §2](../06-modes-and-turn-pipeline.md)'s central claim, and it ~~costs one
directory move~~ **costs one directory move and six tooling edits, two of which
fail silently**.

***Both strikethroughs are §0.1a's, 2026-09-10, and they cut in opposite
directions.*** The rule is not aspirational: it has a fixture subject at
`tools/lint-fixtures/fixtures/packages/modes/scene/src/imports-server.ts` and a
passing assertion at `eslint-rules.test.ts:82-86`, so what P7.0 gives it is a
*shipped* subject rather than a first one. And the move is not one directory
move: `vitest.config.ts:130` and `eslint.config.js:125` are both one-level globs
that a nested package does not match — the first fails quietly and the second
turned out to cost nothing, see the correction under §0.1a item 2 — `Dockerfile:76`'s
deploy filter copies only the server's dependency closure, and — the one that
decides the shape of the stage — **`registry.ts:5`'s static import of the mode
becomes a build error the moment Scene is a package**, because the boundary graph
allows server → server, sdk, shared. Dynamic registration is not a companion item
to this stage; it is its prerequisite. §0.1a has the bill.

**And one production symbol does not go through this file.**
`modes/scene/mode.ts:4` imports `CLOCK_CHANNEL` — a **value** — straight from
`sessions/channels.ts`, which `contract.ts`'s own docstring says a mode must never
do. The underlying claim survives (the mode source is nearly move-only, and the
mode has zero production consumers outside the registry); the stated *mechanism*
does not. §0.1a argues the three ways out and recommends moving
`ChannelDefinition` to the SDK so the `const` cycle the engine is dodging cannot
form.

### 1.2 Three recorded divergences to reconcile, and only the third has teeth

***All three are settled as of P7.0, 2026-09-11, and the first two went the way
this section leaned.*** Publishing a type is deciding it, so the SDK export was
where they had to be answered: a step returns `Candidate`, an effect is an
`EffectProposal`, and **[22 §4](../22-extensions.md) is the document that gets
corrected** in both — a cold-list edit (§0.2) rather than an open question. The
third is the `random` conversion, built. The list below is kept because the
reasoning is the record of why.

[22 §4](../22-extensions.md) records what P2 built against what the boundary
needs, deliberately unreconciled because reconciling early would have been
guessing:

- A step returns `candidates: Candidate[]`, not `blocks: AssembledBlock[]`.
  Renaming toward the boundary is a rename — and arguably the *step* is right
  and [22](../22-extensions.md) is the document to correct, since a block is
  what the assembler produces.
- Effects are `EffectProposal` — no `before`, no `applied`, no id. A step
  proposes and the engine stamps ([21 §1.2](../21-internal-contracts.md)). This
  is the better shape and should survive; the boundary document should adopt it.
- **`StepHost.rng` is a live `Rng` with synchronous methods, and cannot cross a
  worker hop.** `HostApi.random` is async throughout. This one touches every
  step that draws, and ~~nothing at P2 draws inside a step~~ — so the conversion
  is free *now* and expensive after P7 ships steps that do. *Half-expired at
  P5.6: the retriever draws inside a step's `call`, engine-side of that seam
  and never from a mode's own body, so the lean survives and its reason has
  narrowed. §0.1 has the trace.*

**Lean: do the async conversion in the first stage, before any new step is
written.** ~~The cost is a signature~~; the alternative is converting steps written
this phase, in this phase.

***Re-priced 2026-09-10, and the lean survives on a better argument.*** The cost
is **sixteen signatures**, ~60 call sites and four `fc.property` blocks becoming
`fc.asyncProperty` — one of them `sessions/reconstruct-property.test.ts:590`,
the P6 property this document credits itself with inheriting. But the lean gets
two arguments it did not have. First, `Rng` and `SiteRng` are **classes with
`#private` fields**, so the conversion is forced by the *package split alone* —
the SDK cannot import `server` and no structural interface can stand in for a
private-field class — before any worker hop is considered. Second,
`turns/steps.ts:125-130` records a **correctness** hole the same change closes:
[06 §5.2](../06-modes-and-turn-pipeline.md)'s first exclusion is *the RNG service
and anything consuming it*, and today a prose step is handed both the guidance and
an `Rng`.

**And the cheapest discharge is not conversion.** Nothing draws through
`StepHost.rng` outside one test, so the field can be **replaced** — an async
`random` on the host, the engine's `Rng` left synchronous, `retrieval/activate.ts`
and its ninety test call sites untouched. Price that first. Either way,
`RandomApi`'s shape is an **input** the conversion currently lacks (§0.2),
and §1.3 carries the determinism risk the change creates.

### 1.3 Does the worker hop land here, or after?

[22](../22-extensions.md) settles worker-thread isolation **from 1.0** and
[06 §9](../06-modes-and-turn-pipeline.md) says built-ins go through the same
interface. What is genuinely open is whether the hop is *this* phase's or a
later one's, with the SDK shipping first and the isolation following.

**Lean: the hop lands here**, because §1.2's async conversion is ~~only~~ *forced*
by it. Paying an async cost without the boundary that requires it is paying the
price with none of the check — and `StepInput`/`StepResult` are already asserted
`structuredClone`-able in `turns/steps.test.ts`, which is the half of the
day-one item that can be held to account before the boundary exists. Confirm at
the revisit against how much of the phase's step work is done by then.

***Three corrections, 2026-09-10, and one of them is a risk rather than a
correction.***

**"Only" is wrong** — §1.2's conversion is forced by the package split
independently of the hop (§0.1a). That weakens this section's argument for
landing the hop here, because the conversion now happens either way.

~~**The `structuredClone` assertions assert less than this leans on.** The
`StepInput` case clones a fixture with `history: []` and no `output`, so neither
of those arms is exercised; the `StepResult` case pins a hand-written object
literal with **no type annotation and no `satisfies`**, so a non-clonable member
added to `StepResult` tomorrow leaves the test green.~~ ***Repaired 2026-09-11,
and the repair is stronger than the complaint.*** Both fixtures are now
exhaustive **by type** rather than by care: a `Record<keyof Required<T>, true>`
literal must name every key of `T`, so a member added to `StepInput` or
`StepResult` stops the file compiling until somebody decides whether it crosses.
`history` carries a real `Turn` — the deepest object on this seam, with an
effect's `unknown` values and a tape inside it — and `output` is populated.
*Proven by mutation: adding `onFinish?: () => void` to `StepResult` produces two
compile errors in that file and no test failure, which is the right way round.*
And the third test in that
block — the one whose comment names *"the one thing on `StepHost` that cannot
cross a worker hop"* and says *"`call` and `signal` cross fine"* — **never calls
`structuredClone` at all**; it compares `Object.keys` on a hand-built literal
whose `rng` is `{}`. Verified on this checkout: a function throws
`DataCloneError`, and an `AbortSignal` degrades **silently** to a detached `{}`
with `aborted === undefined`. None of `StepHost`'s three members crosses. What
singles out `rng` is not clonability but that the other two have bridges
invisible to their callers.

**The risk this section does not name.** `Rng.draw` assigns a draw's index from a
per-`site:purpose` counter **in call order**. Synchronous methods make that order
structurally deterministic even inside an async closure; async draws remove the
guarantee, and on replay the recorded values bind to whichever call drew first
*that time*. Alpha sessions on disk carry tapes and rewrite is the default swipe
gesture, so every swipe exercises the replay path. §5 files the hop as *"a
performance question with no measurements yet"* — **it is not one**, and the
mitigation is cheap chosen up front and a data-corruption bug found late.

~~**And the two documents this section cites in one breath disagree about
randomness.**~~ ***Settled 2026-09-11 in 22 §4.0's favour, and the answer weakens
this section's lean.*** 06 §9 promised a worker prevents reaching an unrecorded
random source and has been corrected: a Node worker can `require('node:crypto')`,
so it prevents nothing. **The hop relocates recorded randomness, it does not
enforce it** — enforcement is the lint rule plus the extension test kit's
replay-determinism check, neither of which needs a worker. Combined with the
first correction above, both of this section's arguments for landing the hop
*here* are gone: the conversion is forced by the package split either way, and
the hop buys no enforcement the lint rule does not already buy. What is left for
the hop is fault isolation — crash, hang and runaway-loop containment, which
[22 §2](../22-extensions.md) calls the realistic failure — and that is a real
reason, just not this section's reason. *06 §9 was also wrong about credentials,
for the same reason and in the more alarming direction; §0.2's item 2 has it.*

### 1.4 `InitPolicy` has exactly one first consumer, and it is in this phase

[21 §1.3](../21-internal-contracts.md) records that P2 ships neither
`schema`/`migrate` nor `init`, and [21 §6](../21-internal-contracts.md) is what
defers `InitPolicy` and `WidgetSpec`, with the reason: a contract designed
against one real need beats one designed against three imagined ones. **The
pacing dial is that need** — a session channel with `update: "user-only"`,
`budget: null`, and an init reading a Treatment's advisory value
([06 §6.1](../06-modes-and-turn-pipeline.md), [04 §6.1b](../04-schemas.md)). It
is a P7 *dependency*, not a free consequence: the dial cannot be built before
the policy is, and scheduling them apart makes the dial invent its own prefill
path.

***Three corrections, 2026-09-10.*** **The heading's "exactly one" is no longer
its source's word**: 21 §1.3 records that *"a second consumer has since appeared,
and it is the same shape"* — illustration pacing
([06 §10.6](../06-modes-and-turn-pipeline.md)) — added four days *before* §0.1
was written. It arrives after P7 and so does not move the dependency, which is
21's own point; but it is the check on this section's *designed against one real
need* argument coming back clean, and the section should carry it.

**`InitPolicy` is a name with a one-line comment behind it, not a type awaiting a
field.** It is defined nowhere — not in code, not in the design corpus. The whole
shape is P7.1's to design from
[06 §4](../06-modes-and-turn-pipeline.md)'s *"literal default, from treatment, or
generated at start"*, including what *generated at start* means for the RNG tape.
This section reads as though only the wiring were missing.

**And the Treatment field the init would read does not exist.** `hookPacing`
appears nowhere in `packages/`; `Treatment` and `Setup` carry neither it nor
`stagingNotes`, both of which [04 §6.1b](../04-schemas.md) specifies as optional
on both. So the dial is a channel, a policy, **and two fields on two published
stable-tier schemas** with an emitted artefact and a round trip behind them.
`update: 'user-only'` has also never been exercised —
`turns/effects.ts:110-112` is the only branch that returns it and no shipped
channel declares the policy, so the first user-only channel this stage builds is
also the first thing that proves that branch works.

`migrate` has no such consumer and should not acquire one speculatively; what it
does need is [25 B7](../25-open-questions.md)'s
validate-coerce-migrate-quarantine path being real once author-declared channels
exist ([06 §4.1–4.2](../06-modes-and-turn-pipeline.md)).

### 1.5 Two pre-existing corrections this phase discharges

Both named in [work plan P7](01-work-plan.md), both cheap here and awkward anywhere
else:

- **Hook firing state ~~moves out of the session file~~ is a channel from the
  first line written**
  ([03 §4.1](../03-data-model.md)). A flat set does not branch, and
  [testing §1](03-testing.md) already carries the property that fails if it
  stays where it is. *Restated 2026-09-10: there is nothing to move and nothing
  to correct. `SessionFile` has never had a fired-set, and 03 §4.1 has already
  been corrected in place — it now reads "Which have fired is channel state, not
  a session field" with its own dated note. So this is a **new** channel
  definition plus its effects, not a migration, and the property row is
  satisfiable the day the channel is declared, because P6 property-tested the
  fold that answers it. The pool stays session-wide; only the per-hook state is a
  channel.*
- **The selector writes its own line into the turn record.** *Held by pacing*
  and *judged: none* are different answers, and a record that merges them makes
  a correctly-quiet session indistinguishable from a broken one
  ([10 §10.1](../10-ui-surfaces.md)). *And it has nowhere to land, 2026-09-10:
  `StepOutcome.skipReason` is the closed `StepSkipReason` set — `cadence`,
  `stage`, `not-armed` — derived from `StepCondition`'s three arms, with no
  free-form member and `contributed` counting only. This is an addition to
  `@storyengine/shared`'s record types, which every reader and the workbench
  consume. Cheap, but it is an addition rather than a correction.*

### 1.6 Party, presence and status are channels, and `cast` stops being a field

[06 §8](../06-modes-and-turn-pipeline.md) moved party membership, `control` and
narrator selection into channels for the three properties fields cannot have:
they reconstruct at a node, they appear as effects in the record, and they branch
correctly. *All three stopped being arguments at P6, which built and
property-tested every one of them, and P5.5 settled the persisted key — so this
move now inherits a shape rather than proposing one (§0.1).* `se.party` is on
[P2 §5](08-p2-implementation.md)'s deferral list by name. Two constraints that
must not be lost in the move: **membership is keyed by `TurnId`, never by
ordinal** ([07 §3](../07-branching.md)), and **presence is
not party membership** — two concepts, two channels, one panel
([06 §8.1](../06-modes-and-turn-pipeline.md), with
[10 §13.2](../10-ui-surfaces.md) for the panel).

***The heading overstates the move in one direction and understates it in
another, 2026-09-10.*** **`cast` does not stop being a field**: `persona` stays,
by [03 §5.5](../03-data-model.md) and 06 §8's own argument that it is *"the one
part that can stay a plain session field"*. What moves is `cast.actors`
(`sessions/types.ts:89`) — an undocumented second half the built type grew, which
is the scene's actor list, which is ~~presence-shaped~~ **two things, only one of
which is** *(corrected 2026-09-12 at P7.3 — the paragraph below)*, and which is
what the cast panel will read. **And the field's licence belongs to P7.3, not
P7.2.**

***`cast.actors` does not move, and the reason is in what P7.2 shipped rather
than in a reading of this section — 2026-09-12, [P7.3].*** `se.presence` declares
`init: { kind: 'literal', value: false }`, and the comment on that line gives the
argument for it: *"a cast member nobody has mentioned is not in the scene, and an
init of `true` would put the whole cast in every room"*. The consequence is that
**presence cannot express a roster**: *in the cast and elsewhere* — which
[10 §13.2](../10-ui-surfaces.md) calls **the ordinary state of most of the cast
most of the time** — and *not in the cast at all* are the same value, and
`readPresence` returns `false` for both. The only thing that separates them in
the channel map is whether a key exists, and key presence is not a place to keep
a roster: `inverseOf` turns the undo of an arrival into a `delete`, which is
right for presence and would be a silent removal from the cast.

*So the split is: `cast.actors` is a **roster** — which cards this session is
configured to play with — and it is link-shaped, exactly like `treatment` and
`lore`, which `sessions/types.ts:97` already documents as retroactive across
branches on purpose (*"Links, like `cast`, and for `cast`'s reason"*). What is
presence-shaped is who is **here**, and who is **alive**, and both of those moved
at [P7.2] and branch correctly.*

**The bug this section was pointing at is real and was somewhere else.** Two
sources of truth was the right diagnosis: `castRows` unioned the roster with the
actors the channels name, `resolveCast` read the roster alone, so an actor the
story introduced got a panel row and **no character card in the prompt** — every
turn after the arrival assembled as though nobody had arrived, reachable without
a hand edit because `se.presence` is `model-proposed`. P7.3 fixed it at that
site: `resolveCast` takes the channel map and resolves the union, mutation-proven
in `turns/cast.test.ts` (four assertions that go red with the union disabled and
five contract assertions that do not). *`se.party` is untouched by this — party
membership is a subset of the roster, and 10 §13.2's "introduces no parallel
membership concept" is satisfied by marking a subset rather than listing one.*
`modes/types.ts:81-90` says `select: 'fixed'` is *"the declaration that the cast
cannot change as an outcome of a turn, which is what licenses a plain `cast`
field on the session instead of an `se.party` channel"* — so P7.2 as scheduled
removes the field whose replacement only becomes meaningful when P7.3 widens
`select`, and P7.2 declaring `se.party` against a policy that still says the cast
cannot change is exactly the placeholder-shaped channel P2 §2.7 rejected. §0.2
carries the ordering; the stages should carry it too.

*And the derived predicate is in the best state a constraint can be in: there is
no implementation to have got it wrong yet. `se.party`, `se.presence` and
`se.status` return no hits across `packages/` outside an unknown-channel test
fixture and two docstrings — so this cell is not confirmation, it is an unspent
obligation.* **Spent: presence and status at [P7.2], `se.party` at [P7.3] with
the widened `select` it was waiting on. And the unknown-channel test fixture was
one of the two costs of spending it — it used `se.party` as its stand-in for an
id nothing owns, which stopped being true.**

*Introduced* is neither, and [06 §8.1](../06-modes-and-turn-pipeline.md) defines
it over presence and party effects: *"this actor has been the subject of a
presence or party effect at some point on the path to this node"* — **derived
rather than stored**, monotone along a path, so rewinding past an arrival
un-introduces correctly for free. The hook filter and `involves` have both
spent the word since they were written; this phase is where it acquires an
implementation, and the introduction hook reverses exactly one clause of the
filter while keeping the rest.

*What an implementation must read, enumerated 2026-09-10 because both this
section and [15 §5.2](../15-world.md) say the predicate "already exists" and mean
"is defined":* the path (`sessions/segments.ts:188`'s `walkPath`, which P6 built);
presence and party **effects** on it, which is P7.2's output and nothing else's;
the actor's status channel, for the *no terminal status* clause; the session
persona, a plain field today that this section says stops being one; a resolver
for `introduces.actor` as a `Ref`, which does not exist for hook refs; and party
membership keyed by `TurnId`. Nothing implements any of it. **So P7.5's second
World obligation is not a naming choice made against an existing predicate — it
is a hard ordering dependency on P7.2.**

### 1.7 The span type must not be named for mentions

[10 §13.1](../10-ui-surfaces.md) says the span model *"should be built so that it
can"* generalise. [13 §13](../13-write-mode.md) sharpens that into the largest
single obligation P7 owes a later mode: Write needs three consumers of one span
shape — mentions, machine-written provenance, and beat positions — so
*generalises* has to mean **a tagged reference from the first span ever
written**, and the type must not carry an actor reference in its name or its
shape. Ship it with an actor baked in and the choice later is migrating every
stored turn or growing a second span type, which is how one overlay becomes two.

***And the shape is already specified — this section says only what it must not
be.*** [06 §8.2](../06-modes-and-turn-pipeline.md) gives it:
*"spans on the turn record — `{ start, end, ref, method, confidence }` — never a
rewrite of the message text."* `ref` is already generic rather than actor-typed,
so the obligation is met by keeping it a **tagged** reference and naming the type
for what it points into rather than for what points at it. Quote the shape here
rather than leaving the stage to re-derive it.

~~***And the shape §1.7 forbids is already written down, in the document an
implementer follows.*** [03 §8](../03-data-model.md) specifies the turn record's
overlay as `mentions: MentionSpan[]`… **Reconciling them is a morning and it has
to happen before the first span is stored** — 03 §8 is the one to correct,
because it is the one somebody reads while writing the record.~~

***Reconciled 2026-09-11, and it was a morning.*** 03 §8 now specifies
`spans: TextSpan[]` with `target: SpanTarget`, a tagged union carrying one arm —
`{ kind: "actor"; ref: Ref<Actor> }` — so Write's provenance and beat spans are
an arm rather than a migration. It is shaped like `BlockSource` on purpose: this
codebase already has one tagged-reference vocabulary. 06 §8.2 points at the
record instead of restating a fourth shape, and `field` survives, because the
turn stores two texts and 06's omission was the ambiguous version.

**The decision this section had not named is why a tag rather than a rename was
required.** `Ref<T>`'s type parameter is **phantom** — [04 §3](../04-schemas.md)
makes a `Ref` `{id, name, fingerprint?}` — so `ref: Ref<Actor>` erases into JSON
as an untagged link. Renaming `MentionSpan` to something neutral would have
satisfied the letter of *"must not be named for mentions"* and left a stored span
that cannot say what it points at. *Free today because nothing implements it:
`packages/shared/src/turn.ts` still records the field as absent and fenced to
this phase's `extract` step.*

***And "no span type exists anywhere in `packages/shared`" is imprecise in the
way that decides whether the obligation is free, 2026-09-10.*** No *named* type
exists — but `packages/shared/src/matching.ts` already returns an **anonymous,
untagged** `{ start: number; end: number }[]` from `literalSpans` (`:67`),
`entrySpans` (`:111`) and `mergeSpans` (`:130`). That is P5's keyword scanner:
the very code §P7.7 says the mention pass **shares**, and therefore the code the
first mention span will be built over. So the obligation is free *if the shared
scanner's return type is widened in the same change* and expensive if the tagged
type is bolted on beside an untagged one that three functions already produce.
**Related and unpriced:** `retrieval/match.ts:72-75`'s `KeyHit` is
`{ key, source }` — match-shaped, not span-shaped. The scanner knows *which* key
fired and *in which haystack*, never **where**, so P7.7's one-scan-two-consumers
claim needs the matcher widened to carry offsets through. §5 calls P7.7 *"smaller
than it looks"*; this is the part that is not.

### 1.8 Two modes is a weaker test, and the assistant is the available third

[work plan §0.3](01-work-plan.md) records the cost of cutting Messages and Campaign:
the two retained modes are **the more similar pair**, so the contract gets tested
against less variety than the design assumed. There is a third witness already
specified and currently scheduled for P11 — the assistant, which
[06 §7.4](../06-modes-and-turn-pipeline.md) states is *a session, in a mode, with
an actor card*, and which doubles as a test of the mode contract by design.

**To decide at the revisit:** whether the assistant's *mode definition* (not its
surface, not its tools) is pulled into P7 as the contract's third and least
similar consumer. It is the cheapest variety available, and finding the contract
wrong in P11 is finding it wrong after everything is built on it.

### 1.9 Session and step overrides have been plumbed and never passed

[19 §5.1](../19-tech-stack.md)'s override table names two of five layers as
**P7's, with the mode contract that would use them** — `resolveRole` implements
four of the five, ~~and the fifth has no caller~~ **and three of those four are
passed by nothing outside tests: session, step, and the actor hint**.
[P2B §5](10-p2b-provider-configuration.md) declines to build a control for a
layer with no caller, on the grounds that it would be building P7's UI against
P7's unwritten contract. This phase writes the contract; the surface follows in
the same phase or is named as debt with an owner, not left as a third comment.

***Corrected 2026-09-10, on two counts.*** The count is **two, not one** — §0.1
said so while claiming to confirm this section *"exactly"*, and
[19 §5.1](../19-tech-stack.md) marks both session and step *"plumbed into
`resolveRole` and never passed"*. And *"no caller"* wants the qualifier P2B
already uses: `providers/connections.test.ts:221-243` passes both, in a test named
for the precedence it proves, and has since before §0.1 was written. **No
*production* caller** is the claim, and the distinction is the deferral's whole
point.

**And a third layer is in the same state, which makes it three of four rather
than two — and the table this section points at says otherwise.** `ModelHint` is
a real portable type carried by `Actor` and `Preset`, written by the SillyTavern
importer, and resolvable — `resolveRole` applies it last and weakest and reports
`hintUnmet` when it cannot. **It is never passed either**:
`turns/calls.ts:277-282` builds its options with role, bindings, defaults and
usable, and nothing else. So **three of the four implemented layers have no
production caller** — and [19 §5.1](../19-tech-stack.md)'s table, whose stated job
is *"which layers have callers, so the order above is not read as a description of
what runs"*, gives the actor hint *"Built. Applied last and weakest"* while giving
session and step *"Plumbed into `resolveRole` and never passed."* All three are in
the same state for the question that table is asking. One row, in the document
§1.9 points a reader at. What would make the hint meaningful is precisely P7.3's
`dispatch: 'per-actor'`, because today one turn makes one merged call and an actor
is not in the resolution at all.

**And the surface P7 owes is a row in an existing pattern rather than a new
panel**, which is worth settling here so the stage does not re-derive it: a
session-level model override belongs beside the lore panel's disclosure and needs
a route that does not exist (`PATCH /sessions/:id` accepts only `name`). ~~The
**step** override has no analogous home and never will — it is per-step, so its
surface is the mode or preset declaration, not a panel.~~ That distinction is what
*"named as debt with an owner"* should record.

***The struck sentence is wrong, and [19 §5.1](../19-tech-stack.md) is what says
so — corrected 2026-09-11 at P7.3.*** That section opens with **"Steps never name
a model… Nothing in a mode, step or extension refers to a provider or a model id
— which is what makes an install portable, an extension safe to share"**, and a
`Binding` names a `connectionId` that exists on exactly one install. A mode or a
portable preset carrying one would break the property that whole section is for.
**A cheap model for one noisy step is an operator's decision about their own
providers, not an author's about their story** — so the step layer lives on the
**session**, keyed by step id, beside the session override it layers under. Both
shipped together for that reason: they are one record-shape change and one
route.

**A surface routed here that this section has never read.**
[R2 / F-01](21-playable-log.md) is routed to *"P7 §1.9"* by two documents, and the
real blocker behind *use a second model* is a **role-binding editor** —
[10 §15.1](../10-ui-surfaces.md)'s user half — which is a different surface from
the override layers this section is about. Both belong to P7.3; ~~only one of
them is in it~~ **both are in it now, 2026-09-12** — `GET /api/me/roles`,
`PUT /api/me/bindings` and the `MyRoles` pane.

*The editor turned out to be the smaller of the two and the older debt.*
`users/<handle>/bindings.json` has had a **reader since P2.5** and has resolved
as a layer under the install defaults **since P2B**; what it never had was a
writer, which `providers/bindings.ts` records as deliberate — [P2B §2.7] drew the
line at the system scope, and [10 §15.5] gates the personal surface on the
`privateConnections` check being real rather than *"the trivial bypass [09 §4.5]
warns about, wearing a UI"*. That check has been real since P3, so the gate was
open and nobody walked through it. **And the client half was half-written
already**: `AdminConnections.tsx`'s `RoleTable` carried a *"Your own setting,
on …"* branch it could never reach, because it resolves the install's layers and
passes no personal ones. The vocabulary moved to `roleWords.ts`; the branch
finally has a caller.

**It needs no capability and that is the design.** A binding is two ids, and
`resolveRole` looks the `connectionId` up in the capability-filtered list — so
this is useful to an account with no connections of its own (re-point one job at
the cheaper model on the install's own connection, which is R2 / F-01's whole
ask) and cannot become access for one that oversteps. *Measured while testing it,
against a first draft that asserted otherwise: an unusable binding is not even
**destructive**, because [P2B §1.2] made the resolver take the first layer that
**resolves**, not the first that exists. It drops through to the install default
and the turn keeps working; `dangling` is the honest remainder when no layer
bound anything usable. Two docstrings that said "resolves as `dangling`" were
corrected.*

*And the route table's default-deny guard grew with it rather than around it.*
`connections.test.ts` refuses any route matching `connections|bindings|roles`
outside `/api/admin`; these two match and must not be admin-only. The exemption
list became a **table with a probe per entry** — a write is probed by what it
refuses, a read by what it returns — because the single probe covered only the
first kind, which was right when the only exemption was a write and would have
been a hole the moment a readable one arrived. The write probe then bit
immediately: `PUT /api/me/bindings` took the system route's open body shape and
answered **412 on the hash instead of 400 on the field**, so the schema was
tightened to `Record<String, {connectionId, modelId}>`. Stricter than the admin
route it copies, deliberately — that one is behind the prefix, and this one's
licence to be outside it *is* the claim that it carries no credential.

### 1.10 What import recorded and left here — the deferrals §0 exists to collect

**Added 2026-08-30**, and it is §0's first job discharged rather than a new
decision: this document was drafted the same day
[P4](16-p4-implementation.md)'s plan was amended, on a different branch, and
neither met the other. P4 defers a named body of material to this phase and
nothing here collected it.

**What P4 imports, records and does not convert, because this phase is where it
would have a home** ([P4 §1.8](16-p4-implementation.md)'s disposition tables):

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
runtime state, and [25 E4](../25-open-questions.md) ~~already closed~~ declines
to commit to chat and session import on the grounds that *"a half-working
importer generates more support burden than no importer at all"* — an argument
that does not weaken when the state gets more mode-specific. What would change
it is a *format* argument rather than a completeness one: if this phase's
channel and setup shapes turn out to be close enough to a source's that
conversion is a table rather than a rewrite, the case reopens for that one
shape only.

*Corrected 2026-09-01.* **E4 no longer says closed, and the sentence above was
written two days before it stopped.** It was rewritten on 2026-08-31 to
*"conditional on an interchange format… no longer a flat refusal. The condition
is the shape, not the appetite"*. The honest default is **unchanged** — every
reason this section gives for `recorded` survives the revision intact, because
E4's objection to a half-working importer is quoted here in the half that did
not move.

What does change is that **this paragraph's reopening condition has been met in
one direction and not the other.** *"A format argument rather than a completeness
one"* is precisely the argument E4 now makes, so the revisit cannot treat the
question as answered elsewhere and skip it. It still has to decide, per shape,
whether conversion is a table or a rewrite — and it now has
[18](../18-session-import.md) to decide against, whose §2.2 is the relevant
finding for the Marinara rows above: `game_*` state hangs off chats whose
branches are *copied chats* rather than tree edges, so any of it that converts
converts against a history model that is not ours.

**And one thing P4 took from this phase rather than leaving to it**, recorded
so the revisit does not find it as a contradiction: session creation grows an
optional preset id at [P4 §1.9](16-p4-implementation.md), amending
routes/sessions.ts's *"choosing a different pack is P7's surface"* in place.
P7 keeps the surface — browsing, previewing, switching mid-session. P4 took
only copy-at-creation, because PLAYABLE needs it.

---

## 2. Stages

Ordered so the boundary exists before anything is built through it — the whole
argument for a mode contract is that things built after it inherit the
discipline, and a stage order that builds features first inverts that.

**The dependencies inside that order, written down 2026-09-10 because the
preamble asserts one principle and no dependencies, and four of them are real.**
P7.2 needs P7.1 (party, presence and status *are* channels once P7.1 exists) and
must land **before P7.3**, because `ParticipantPolicy.select: 'fixed'` is what
licenses the `cast` field the stage removes (§1.6). P7.4 needs P7.1 for the
declaration vocabulary its wizard renders through. P7.5 needs P7.1 for the dial's
`init`, P7.2 for *introduced*, and **P7.7's `extract` step before it can close its
fourth property row** — an introduction hook is *provisionally* fired and becomes
fired only when extract confirms the subject present. P7.8 needs P7.6, which it
already says. §0.2 says which of these wait on PLAYABLE and which do not.

### P7.0 — The boundary made real

***In progress. Opened 2026-09-11 on `p7`.*** Ordered so that each piece is
green on its own, because the stage's parts are independent up to the move and
landing them together would make the one diff nobody can review.

**Done.** The host-`random` conversion, first because it decides the shape of
something the SDK is about to publish and converting a contract after publishing
it is the cost this phase exists to avoid. Then **the SDK exporting the
contract**: the step types, `Candidate`, `EffectProposal` and `RandomApi` now
live in `packages/sdk` and the engine re-exports them from there, so the modules
that used to own them keep their import paths. `packages/sdk/src/contract.test.ts`
is the package's first test and its imports are the assertion — a step is
declared, implemented and run using `@storyengine/sdk` and nothing else, so the
file stops compiling if the contract is not self-sufficient. That is the
automatable half of gate step 10; the half a person walks is whether the contract
*permitted* something worth building.

**And it settles two of §1.2's three divergences by deciding them, which is what
publishing a type does.** A step returns `Candidate`, not `blocks` — a block is
what the assembler produces once the budgeter has ruled, and a step cannot
produce one because it does not know what fits. A step's effect is an
`EffectProposal` with no `before`, no `applied` and no id, because only the
engine can record a refusal. Both were the engine's shapes against
[22 §4](../22-extensions.md)'s, and in both the engine was right — so **22 is the
document that gets corrected**, which is now a cold-list item rather than an open
question.

Then **the registry became something a loader writes to**, which
`modes/registry.ts` had deferred to this phase by name. The split is the useful
part: `registry.ts` holds a map, a lookup and a proof and **knows no mode**;
`modes/built-ins.ts` knows the modes and holds nothing. So when the boundary
makes `server → modes` a build error, exactly one import has to become a loader
instead of every consumer changing. `DEFAULT_MODE_ID` is a literal rather than
`SCENE_ID` for the same reason, pinned to the mode's own constant by a test.
Two things fell out that were not in the plan: `assertModesRunnable` now
**refuses a build that registered nothing** — a failure that could not happen
while registration was an import, so the split had to catch it — and two test
files that reach the pipeline without `buildServices` now ask for the built-ins
explicitly, which is the dependency becoming visible rather than ambient.

Then **the mode manifest joined the contract and `modes/contract.ts` was
deleted** — its whole job was enumerating the types a mode may see so the move
would be one import list becoming the SDK's export list, and the SDK is that list
now. Moving `ChannelDefinition` with it **dissolved the `const` cycle** the
engine had been routing around: the type comes from a third package neither side
imports, so nothing has to be declared in the wrong place to avoid a loop.

Then **the channel registry inverted, and this is the entanglement §0.1a
predicted resolving in P7.0's favour.** A mode cannot import a value from the
engine once it is a package, so `CLOCK_CHANNEL` either travelled with Scene or
the declaration lost its information. `registerMode` now installs a mode's
declared channels, which is what `modes/scene/mode.ts` said would *"give this
field teeth"* — it had been documenting what Scene used while enabling nothing.
**So P7.1's "the registry is built from declarations" is half built, at P7.0,
because the move required it.** What is left for P7.1 is the declaration half —
`schema`, `init`, the renderer, the error surface — not the registry.

*Two dispositions fell out. `clockEffect` is deleted: exported production code
with no production caller, which four test files shadowed by name, and
`CLOCK_CHANNEL` leaving forced the moment §0.1a said to take it. And five test
files now install the built-ins explicitly, which is the same visibility the mode
registry bought — a test that needs a channel says so.*

Then **the engine's tests stopped reaching into the mode**, which §0.2 listed as
pre-work and which the move makes compulsory: the graph allows `server → server,
sdk, shared`, and ten test files imported `SCENE_PRESET`, `SCENE_MODE` or
`NARRATE`. **The boundary is the occasion rather than the reason.** An engine
test that runs against a real mode tests two things and says it is testing one —
a budgeter test that breaks when Scene reorders a slot has caught nothing — so
`test-mode.ts` is a fixture the engine owns, **copied from Scene so that no test
changed meaning on the day it arrived** and free to diverge afterwards. Three of
the ten were not fixtures at all: they assert *the default mode's* preset, which
the registry can answer, so they ask it. `defaultMode()` is the helper that
makes that legible, and it has a production caller rather than being an export
only tests use — the mistake `clockEffect` had made.

*`test-mode.test.ts` exists for the reason `test-server.test.ts` does: a fixture
seven files lean on can weaken all of them without failing anything. Drop the
lore slots and `retrieve.test.ts` maps over nothing, compares a preset to itself
and passes while asserting nothing.*

Then **Scene became a package**, which is the stage's title. `mode.ts`,
`preset.ts` and `mode.test.ts` moved to `packages/modes/scene/src` as the same
files with a changed import list — the narrowed promise this cell restates below,
kept: `SE_CLOCK` became the literal `'se.clock'`, `Preset` arrives through
`@storyengine/sdk`, and four assertions left. **None of the four was lost and
none was about Scene alone.** They reached for `callPurposeFor`,
`channelDefinition`, `planFor` and `installBuiltIns`, so each was an assertion
about the *engine's* treatment of a declaration wearing Scene's name; the generic
half is in `mode-registry.test.ts` over a mode invented for the purpose, the
Scene-specific half in `mode-loader.test.ts`, which names Scene by id and imports
nothing from it.

**The loader resolves a specifier held in a variable, and that is a decision
rather than an evasion.** Written as a literal, `import('@storyengine/mode-scene')`
is reported by `boundaries/dependencies` exactly as a static import would be —
correctly, because the rule cannot tell a loader from a dependency. The two
answers were an eslint exemption naming the one file, or genuinely not depending
on the module at compile time; the second is *true*, since the engine has no type
for what comes back and has to validate the shape at run time, which is what a
host that will one day load a package off disk has to do anyway
([22 §6–§7](../22-extensions.md)). The cost is stated in the file rather than
discovered later: a specifier `tsc` cannot see is one it cannot check, so a
renamed entry export breaks at startup and not at build. `mode-loader.test.ts`
converts that class back into a red suite, and both of its cross-package pins —
the entry export, and `SE_CLOCK` against the id Scene declares — were proven by
mutating the built package.

**§0.1a's item 6 resolved toward the loader.** The root `package.json` declares
the shipped modes, because the root is the distribution; the Dockerfile deploys
each into `/app/node_modules/` beside the server, because `pnpm deploy` walks one
package's closure and the server's deliberately excludes them. A manifest edge in
`packages/server/package.json` would have worked and would have put a mode in the
server's dependencies, which is the one direction eslint cannot see.

*The host half was rehomed with it, which gate step 1 means and does not say:
`registry.ts` and `types.ts` were what five call sites actually consumed.
`types.ts` is deleted — a re-export shim whose purpose was keeping import paths
still, which the rehome moves anyway — and the other two are `mode-registry.ts`
and `mode-loader.ts` at the top of `src/`.*

Then **the directory staying gone became something that can fail** —
`tools/repo-shape.test.ts`, seventeen assertions, and the negative half of §1.1's
exit condition finally has the mechanism it was owed.

#### Two of §0.1a's six tooling edits were checked by mutation, and one of them was overstated

**Item 1 is real and is F16 verbatim.** With `vitest.config.ts`'s one-level glob
restored, `vitest run --project packages packages/modes/scene/src/mode.test.ts`
reports no tests and exits 0. A mode test would have linted, typechecked and never
run.

~~**Item 2**: *the resolver glob misses the new tsconfig, an unresolved import
classifies as unknown and is permitted, so the missing glob would switch off the
very rule this stage exists to acquire.*~~

***Overstated, measured 2026-09-11.*** Narrowing `eslint.config.js`'s resolver
glob back to one level changes **nothing**: a probe in `packages/modes/scene/src`
reports identically on a relative reach into the server, a package-name import of
it, and two permitted controls. No package in this workspace declares tsconfig
`paths`, so the `project` list has nothing to contribute — `@storyengine/*`
resolves through pnpm's symlinks and relative specifiers by path. The glob is in
anyway, as correctness ahead of need, and the comment beside it now says which of
those it is.

**Item 3 was the quiet one, and the finding under it is worth more than the
edit.** `packageTestOverride('modes')` was missing, and the blanket test-file
block *replaces* rather than merges (F25), so every mode test file would have
carried no package-name ban. That matters more than it looks, because writing the
probe established this: **for a mode package the name ban is not a backup for the
graph rule, it is the only layer that sees a forbidden import by name.**
`@storyengine/server` is not resolvable from `packages/modes/scene` at all —
nothing links it there, by design — and eslint-plugin-boundaries classifies an
unresolvable dependency as unknown, which it permits. The graph rule's own case is
the one no name ban can express: a **relative-path** reach into the server's
source, which resolves and is therefore classified. `eslint.rules.js` calls the
name ban "the second, dumber layer"; here the two layers are not a primary and a
backup but a partition, and each probe in `tools/repo-shape.test.ts` asserts one
layer against the input it can actually see.

*An earlier draft asserted both layers on one package-name probe. It passed under
vitest and failed as a standalone script over the identical file and config —
which is worth recording because the divergence is unexplained and the assertion
was in the file whose whole job is making a gate enforceable.*

**Next:** P7.0's remaining half is the gate, not the code — §3.1's critical list
C1/C2/C3 is walked by a person. §0.2 says which of the rest of the phase waits on
PLAYABLE.

~~`packages/modes/scene` created and populated by moving, not rewriting~~ **done
2026-09-11**; `sdk`
exporting the contract instead of re-exporting `shared` and nothing else;
`eslint.rules.js`'s `modes → sdk, shared` policy acquiring a ~~subject~~
**shipped subject** (§1.1 — it already has a fixture one, and it is green);
**dynamic registration, because the boundary graph makes the static import of
the mode a build error**; the host half of `modes/` rehomed, since `registry.ts`
and `types.ts` are what `app.ts`, `turns/gather.ts`, `turns/preview.ts`,
`turns/runner.ts` and `routes/sessions.ts` actually consume; the six tooling
edits §0.1a bills, including the two silent globs and the Dockerfile's deploy
filter; and §1.2's host-`random` conversion done ~~while no step draws~~ **while
no mode step draws**, which is the narrowed claim §0.1 established and this cell
went on repeating.

~~**No behaviour change** — if this stage produces a diff outside imports,
package manifests and one signature, §1.1's promise was false and that is the
finding.~~

***Restated 2026-09-10, because the tripwire as written fires on the stage's own
planned work.*** The conversion this same sentence schedules is sixteen
signatures; `CLOCK_CHANNEL`'s ownership move breaks an object-identity assertion;
ten server test files use the mode's internals as fixtures and become forbidden
imports; and the registry's static import cannot survive. A stage defined as
failing when it does what it was told to do gets negotiated on the day, which is
how a check stops meaning anything. **The honest form: no diff inside
`packages/modes/scene/src` beyond imports and one signature** — that is where
§1.1's promise actually lives — with the server-side churn priced separately and
expected.

*Ends at:* a deliberate bad import in the mode package failing the build **and
`packages/server/src/modes/` gone, with a check that fails if it comes back**.
~~The second half has no mechanism today: the eslint policy governs what
`packages/modes/*` may import and nothing at all notices the directory
reappearing, while §0 and §5 both call that the phase's deliverable. It is a
repo-shape assertion in the `tools/lint-fixtures/ci-shape.test.ts` manner, and
until it is written the negative half of the demo is unenforced.~~

***Both halves built 2026-09-11.*** `tools/repo-shape.test.ts` is the second, in
the manner this paragraph asked for and in `tools/` rather than in
`lint-fixtures/` because its subject is the arrangement of packages rather than
the lint rules. It also covers three drifts this paragraph did not name and
neither `pnpm lint` nor `pnpm typecheck` can: a mode in the server's *manifest*
(eslint reads imports, not manifests), a mode in the server's tsconfig
references, and a built-in in the loader's list that the image does not deploy.

### P7.1 — Channels as a general mechanism

Modes declare channels and the registry is built from declarations rather than
from a built-in set of ~~one~~ two ([21 §1.3](../21-internal-contracts.md)) —
P5 put `se.lore.timing` beside the clock, and both are `engine-computed`, so
the declarative path still has no `model-proposed` or `user-only` subject until
this stage builds one. `schema`,
§1.4's `init`, author-declared channels
([06 §4.1](../06-modes-and-turn-pipeline.md)), the migration posture from
[25 B7](../25-open-questions.md), hidden visibility with a reveal affordance, and
the minimum of the declarative widget vocabulary
([10 §8](../10-ui-surfaces.md)) — no extension-shipped components, now or later.

**Four things this stage owes that the sentence above does not name**
(added 2026-09-10; §0.1a has the evidence). **A channel-to-text renderer**, which
is the *injection* half of the channel contract and a different thing from 10 §8's
HUD vocabulary: an author can name a channel in a preset slot today and get
silence, and until a renderer exists `ChannelDefinition.budget` is a field with no
reader. **[06 §4.2](../06-modes-and-turn-pipeline.md)'s error surface** — the
health record, the persistent banner, recovery offered rather than automatic —
which is the quarantine ladder's fourth rung and the only thing that makes
quarantine survivable; `ChannelState.degraded` is the inert type waiting for it.
**`MINUTES_PER_TURN`**, a placeholder whose docstring defers it to a stage that
already shipped, and which is the smallest possible instance of this stage's whole
question: a channel whose reducer is engine code with a mode-shaped parameter.
~~And **`06 §4`'s `ChannelDefinition` sketch disagrees with 21 §1.3's** — 06 lacks
`version` and `visibility` and names an `UpdatePolicy` alias that does not exist —
so the phase that publishes the type through the SDK has to pick, and picking
after it ships means a published contract disagreeing with its own design note.~~

***Spent at P7.0 rather than here, 2026-09-11, on this cell's own argument.***
P7.0 is the stage that published the type, so it is the stage that had to pick —
this cell said so and filed the work one stage too late. 06 §4's sketch is
corrected against what shipped: `version` and `visibility` added, `owner` widened
to `PackageId` (which §4.1 immediately below it already required from the first
definition written), and the phantom `UpdatePolicy` alias replaced by the literal
union. It differed by **four** things rather than the *"one field"* 21 §1.3
claimed, and 21 §1.3 is corrected too. What remains between the sketch and the
package — `schema`, `init`, `migrate`, `surface` — is a schedule rather than a
disagreement, and it is P7.1's; both documents now say which is which.

*Note that `visibility` is **already on the built type** and needs no migration;
what is unbuilt is the reveal affordance, which has a second consumer waiting —
`Goal.visibility` is documented as "the same mechanism as a hidden channel, so
the reveal affordance and the budgeting are shared rather than reinvented". Build
it channel-shaped only and P7.6 reinvents it.*

*Ends at:* a mode-declared channel with `update: "user-only"` refused correctly
when something else proposes to it, rendered from its declaration, and
reconstructing at an old node in the P6 property test's fixture.

#### In progress — opened 2026-09-11

**Done.** `ChannelDefinition` grew `schema` and `init`, both required and both
06 §4's own shape. The evidence the `init` field was missing was sitting in the
tree: `CLOCK_START` and `NO_TIMING` were **engine constants beside the code that
read them**, so where a *mode's* channel began was something the *engine* knew —
`ModeDefinition.channels`' pre-P7.0 gap one level down. The clock's start is
Scene's declaration now, asserted by substitution rather than equality, because
the engine's no-mode fallback is also 08:00 and an equality test would pass
against either source.

*`InitPolicy` ships two of 06 §4's three arms and the third is refused for a
reason that is not "no consumer".* **Generated at start** means a draw before the
first turn, and the RNG tape is keyed on a *turn record* — so a value drawn at
session start has nowhere to be recorded and replay-from-zero could not reproduce
it. It is not a third arm; it is **init becoming a recorded effect** on the first
turn that needs the channel. Written into the published type rather than left to
be discovered, since a contract silently shipping two of three named arms is the
divergence P7.0 spent a commit correcting elsewhere.

Then **`schema` acquired its first reader, on the way in**: `refuse` now returns
`'schema'`, which is the `rejectedReason` cause [21 §1.2](../21-internal-contracts.md)
lists *first* — *"validation failure"* — and which nothing had ever produced,
because policy refusals were the whole vocabulary. Checked after the policy
rules, deliberately: *who may write* is the more useful sentence, since a policy
refusal was never going to land however the value was shaped. **The live
consequence is hand edits**: [03 §8.1](../03-data-model.md) makes editing
`session.json` supported and `divergenceEffects` turns an edit into a
user-attributed effect, so `{"hour": 25}` typed into a file used to become an
*applied* effect and an impossible clock in the permanent record, replayed onto
every branch from that node. It is now a recorded refusal — the posture is
unchanged and the outcome is not.

~~***The load-time ladder is not built, and the reason is a finding.***~~
***Built the same day, and the finding is what told it where to go.*** [06 §4.2]'s
ladder is *validate → coerce → migrate → quarantine*; three rungs were first
written as a pure function over a stored `ChannelState` and **not shipped,
because there is nowhere correct to call it**. `turns/gather.ts` is the pipeline's one channel
read and the runner chains each effect's `before` from that map, so a quarantined
value there becomes the next effect's `before` while the log still records the
impossible one as an `after` — replay-from-zero and snapshot-plus-replay disagree
at that node, which is [07 §4](../07-branching.md)'s CI assertion. Laddering
inside `readSession` fails the same way from the other end: `reconcileHandEdits`
compares the file against a raw replay, so a laddered file reads as a hand edit
and is written into the log as one.

**So a quarantine is a change of state rather than a way of looking at state**,
and 06 §4.2 says so without drawing the conclusion — *"initialise the channel to
its default"* is a write. It belongs where `divergenceEffects` already lives: a
recorded, attributed, reversible effect appended at load, on the same lock, in
the same turn. What it needs first is a way for `applyEffects` to know an effect
*was* a quarantine, so that `ChannelState.degraded` acquires a writer rather than
staying the inert type §0.1a found — which is a **record-shape decision**, not a
wiring job, and therefore its own commit rather than a rider on this one.

*The coerce rung and `createCoercingValidator` were written and then removed for
the same reason: an exported function with no caller is the mistake `clockEffect`
made, and this stage is not the place to repeat it.*

Then **the quarantine landed as an effect**, beside `divergenceEffects` and in the
same turn: `before` is the value that stopped fitting, `after` is the channel's
declared `init`, `proposedBy` is the engine, and a new optional
`ChannelEffect.degraded` carries the reason. `applyEffects` composes
`ChannelState.degraded` from that reason plus `before` — **which is the writer
that field's docstring has been promising since P3.0**, in as many words: *"the
writer arrives with the first `ChannelDefinition.schema`"*. The effect carries a
reason and not a raw value because `before` already is the raw value, and `before`
is load-bearing on a quarantine anyway: it is what an undo replays, so a
quarantine is reversible like anything else.

*Three rungs of four. `migrate` cannot run because `ChannelDefinition` has no
such field, and its absence is not silent — a value that would have been migrated
is quarantined with its raw value kept, which is the outcome that rung improves
on rather than prevents. **Coercion is a narrowing rather than an omission**: it
earns its place against a channel whose schema has removed a field, and neither
shipped channel has ever changed shape, so a coercer built now would be built
against no case at all.*

***And a claim from two hours earlier had to be corrected, which is the more
useful half of this commit.*** The schema check in `turns/effects.ts` was
described as what stops a hand edit from poisoning the log. **It is not on that
path**: `reconcileHandEdits` builds its effects in `divergenceEffects` and never
calls `acceptEffect`, so a value typed into `session.json` became an *applied*
effect whatever shape it was. The check is now in `divergenceEffects` too, where
a failing edit is recorded **refused** rather than applied-then-quarantined —
two effects for one mistake, with the bad value in the middle of the log, is the
alternative that was rejected. *The `update` policy is deliberately still not
consulted there: `engine-computed` refuses model and step, `user-only` refuses
everything but user, so a person editing their own file is permitted by both —
which is 03 §8.1's whole premise.*

Then **the two fields §1.4 found missing arrived on both published schemas**:
`hookPacing` and `stagingNotes`, optional on Treatment and on Setup, which is
[04 §6.1b](../04-schemas.md)'s shape exactly — *a Treatment proposes, a Setup
overrides, and the running session owns it* — and optional on both because a
required field added to a published `/1` is a `/2` change. Emitted artefacts
regenerated; the import fixture pair is green.

***Two findings, and the first changes what the dial can be.*** **A session does
not record which Setup it was created from.** `SessionFile` carries
`treatment?: string | null` and `preset`, and `POST /api/sessions` accepts
`treatment`, `preset`, `lore`, `cast` and `mode` — no setup, anywhere. So
04 §6.1b's *"a Setup overrides"* has nowhere to override **from**, and the
`authored` init arm can resolve a Treatment's value and nothing else. That is not
a gap this stage should paper over by resolving only treatments and calling the
rule satisfied: either a session records its setup, or the rule is two-thirds of
a rule. *Related and probably the same job: there is no Treatment or Setup editor
in `packages/client` — only actors and lorebooks — so both fields are settable by
import or by hand-editing the file, which is supported ([10 §4]) and is not the
same as offered.*

**And the exit gate wants a subject the dial cannot be.** This stage *ends at* *"a
**mode-declared** channel with `update: "user-only"` refused correctly"*, and the
pacing dial is owned by `storyengine.hooks` — a **package**, like `se.lore.timing`
— because hooks are not a mode's. Scene declares one channel and it is
engine-computed; the mode that would declare a user-only one is Freeform, at
P7.9. ~~So either the gate means *package-declared* and should say so, or it is
waiting on a mode that does not exist yet.~~

***Settled 2026-09-11, and the answer is neither — the two sentences are not the
same sentence.*** **§3's step 3 is the one that matters and it does not say
`user-only`**: *"A channel declared by a mode appears in the registry, is
enforced against its `update` policy, renders through the declared widget
vocabulary, and reconstructs at an old node."* Scene's clock is mode-declared,
registered, `engine-computed` — which **is** an update policy and is enforced,
with tests — reconstructing in the P6 property fixture, and as of this stage
rendering through a declared `WidgetSpec`. **All four clauses hold.** §3.1 says
the ten steps are never edited and they did not need to be; the step was always
satisfiable by the mode that exists.

What said `user-only` is this stage's own *"Ends at"* line, which is narrower
than the gate it was paraphrasing. `user-only`'s **enforcement** is proven
(`turns/effects.ts` and its tests), and what has no mode-declared subject is the
*declaration* — which is a fact about Scene having one channel, not about the
mechanism. Recording that is better than either editing a gate to match the code
or building a channel to match a sentence: the dial stays with its selector at
P7.5, where its reader is, and the first mode-declared `user-only` channel
arrives with Freeform, which is also where the second real mode makes the whole
contract worth testing.

Then **the channel-to-text renderer**, which §0.1a lists first among the four
things this stage owes and which nothing had named. `ChannelDefinition.render` is
a Liquid template over the channel's own value — the same engine a preset block
uses, with a context narrower than [06 §5]'s closed participant namespace: a
channel template sees its own value and nothing else, so the fence that section
draws is not widened, a second smaller one is drawn beside it.

**What this fixes is a legal preset slot that silently produced nothing.**
`{ of: 'channel', channelId }` has been in the published preset schema since P2
and `collect.ts` returned `[]` for it, with a comment naming both halves of the
gap: *"a channel value is an object with no channel-to-text renderer specified —
which is also why the clock's budget is null."* **Both halves expired together.**
Scene's clock now declares `render` and a `budget` of 24, so `budget` has its
first reader and the field means what 06 §4 says it means.

*Four ways the answer is still nothing, each a different statement rather than a
shrug: a channel nobody declared (an uninstalled mode's, and [00 §3.3] says show
what you cannot resolve), a channel with no template (lore timing — bookkeeping
the model has no use for), a `budget` of null (06 §4's own spelling of **never
injected**), and a template that will not compile (the author's mistake, answered
as a value rather than a thrown turn). Over budget is the fifth case and it is
**truncated rather than dropped**: the time of day wrong by truncation still says
which day, and dropping would hand the budgeter a decision the declaration has
already made.*

***And the shipped preset is deliberately untouched.*** Scene's clock can now be
injected and `SCENE_PRESET` still has no channel slot, because growing that
artefact is P7.9's and §0.2 holds P7.9 behind PLAYABLE for exactly this reason —
it is what **K4 is built to interrogate**. So the consumer this stage ships for
is *any preset that already names a channel*, which is a real one: the slot kind
is published and an author can write it today.

Then **06 §4.2's error surface**, which that section calls *"the part worth
building properly, and the part the sources have nothing like"* and which no
stage named until §0.1a. All three of its bullets: a **health record** on the
session read (which channels, which version, why, plus the raw value and what is
standing in its place), a **persistent banner** on the play surface — `warning`
rather than `error`, `role="status"` rather than `alert`, and the *"your story is
unaffected"* half kept because 4.2 says the reassurance is load-bearing — and
**recovery offered rather than applied**.

**One route serves all three of 4.2's offers**, which is why it takes a value
rather than naming an action: `PUT /sessions/:id/channels/:key`. *Retry* sends
the quarantined value back, *edit* sends whatever was typed, *accept the reset*
sends what is standing — which clears the marker, since a `degraded` state is
only ever written by an effect carrying a reason. It goes through `acceptEffect`,
so **a retry that still does not fit is refused and recorded**, which is what
makes offering the button safe: it cannot put the session back in the state it
was rescued from. A refusal answers **200 with an unapplied effect**, not a 4xx,
because a status code would throw away the record the workbench is meant to show.

***Two things the tests found, and the second was a real defect.*** The first
draft drove the whole surface with a hand-edited `session.json` and found
nothing — which was the mechanisms working. A bad value **arriving** is refused
at the divergence step and never reaches state, so there is nothing to
quarantine; the quarantine is for a value **already there** under a schema that
has since changed. The two paths are genuinely different and only one ends at the
banner, so the tests drive a schema change instead, which is the scenario 4.2 is
about.

**And doing that surfaced a stale-validator bug in code from earlier the same
day.** `channel-schema.ts` cached compiled validators by `id@version`, reasoning
that a schema change ought to carry a version bump — true, and 06 §4.2's *"record
the version, never the schema"* mechanism. But **a cache is the wrong place to
enforce an authoring rule**: a mode author who edits a schema and forgets the
bump got stale validation for the life of the process, silently. It is a
`WeakMap` on the definition object now — `registerChannel` is last-write-wins, so
a re-registration is a different object whether or not the version moved. The
docstring that got it backwards is corrected, and the test that only covered the
bumped case now covers both.

Then **the declarative widget vocabulary**, which is gate step 3's last unmet
clause. The other three were already held — a mode-declared channel in the
registry (`mode-registry.test.ts`), enforced against its `update` policy
(`turns/effects.test.ts`), reconstructing at an old node (the P6 property test).
*"Renders through the declared widget vocabulary"* had nothing.

`ChannelDefinition.surface?: WidgetSpec`, and Scene's clock declares one. **One
arm, and the count is the honest minimum rather than a placeholder**: a
vocabulary is worth the arms that have a subject, the clock is text, and a
`meter` with `min`/`max` — Aventuras' `RuntimeVariable`, exactly — arrives with
the first numeric channel rather than ahead of one, which is the rule
`InitPolicy`'s third arm is already held to. [10 §8]'s paired commitment is the
thing to keep: *deferring the iframe escape hatch is only honest if the
vocabulary keeps growing*, and what must never happen is an `html: string` field.

**`visibility` gets its reader here too.** The field has been on the type since
P2.3 with no consumer; `'hidden'` now means *not in the HUD*, and lore timing is
the shipped example — bookkeeping a player gets from the workbench rather than
from a strip above the story. *Hidden is not secret*: the value stays in
`session.channels`, in the log and in the workbench. What is still deferred is
the **reveal affordance** — a channel hidden *and meant to become visible* — and
it should stay deferred until it is built once for both consumers, since
`Goal.visibility` is documented as the same mechanism and building it
channel-shaped first is the reinvention §1.4 warns about.

*Composed server-side, down to the string, for the reason the health record is: a
client rendering this itself would need the registry, the declarations, the
template engine and `splitChannelKey`. What crosses is a label and text. The
component knows no channel and skips a `kind` it does not recognise, which is
what makes widening the vocabulary additive rather than breaking.*

**Next:** P7.1's remaining piece is the reveal affordance, and the argument above
is for leaving it to P7.6 — so what is left of this stage is the walk of gate
step 3 by a person, and the dial, which lands with its selector.

### P7.2 — Party, presence, status, and the cast panel

§1.6 built; the cast panel over it ([10 §13.2](../10-ui-surfaces.md)), editable,
with one derived badge over two axes. **The asymmetric-death treatment is part
of the stage, not polish**: a proposed status change to `dead` is surfaced
prominently and is reversible from the effect log, same bias as
[25 C12](../25-open-questions.md) — under-fire, and keep the manual path.

**And the effect vocabulary cannot express a timeline that grows, which is what
this stage's central shape is** (2026-09-10). `EffectOp` declares five arms —
`set`, `merge`, `delete`, `append`, `increment` — and **`acceptEffect` throws a
programmer error on anything but `set` at `/`**, because `applyEffects` replaces
the whole channel value and reads `op.path` for nothing but `delete`. The comment
says what has to happen: *"the day something does, `applyEffects` is what has to
change first."* Party membership is a timeline that grows
([06 §8](../06-modes-and-turn-pipeline.md)), so this stage either carries the
**whole timeline** in `before`/`after` on every membership effect — which makes
each effect O(party history) and the effect log unreadable — or it implements
`append` first. ~~**Decide before the payload is designed**, not inside the
stage.~~

***Decided 2026-09-11 and the answer is neither, which §0.2 item 6 carries in
full.*** The O(history) cost follows from making `se.party` **session**-scoped,
not from the op vocabulary: an actor-scoped party makes each effect carry one
actor's `PartyMember` records, and `set` at `/` on a scope key stays sufficient.
That puts party on the same scope vocabulary as presence and status, which this
stage already introduces as `scope: 'actor'`'s first writers — so the arm
stopping being a declaration does *three* concepts' work rather than two. **What
this stage still owes is the narrator selection**, which is session-wide and has
nowhere to sit in an actor-scoped channel: a per-actor flag with an "exactly one"
invariant, or a second channel.

*And `scope: 'actor'` has never had a writer: the scoped-key machinery
P5.5 built and P6 property-tested is proved by `scope: 'entry'` alone. Presence
and status are the first actor-scoped channels, so this stage is where that arm
stops being a declaration.*

#### In progress — opened 2026-09-11

**Done: the two axes, and `scope: 'actor'` has a writer.** `se.presence` and
`se.status` are declared in `sessions/cast.ts`, owned by `storyengine.cast` — a
**package**, like `se.lore.timing`, because every mode with a cast wants them and
none of them is Scene's in particular. *Named for the cast rather than the party,
since the party is a subset and naming the owner after the subset is the
conflation [06 §8.1] spends a paragraph refusing.*

***`se.party` is deliberately not among them, on §1.6's own argument.***
`select: 'fixed'` is *"the declaration that the cast cannot change as an outcome
of a turn, which is what licenses a plain `cast` field on the session instead of
an `se.party` channel"*, so a party channel declared while the policy still says
that is the placeholder-shaped channel [P2 §2.7](08-p2-implementation.md)
rejected by name. **Presence and status carry no such licence** — they are facts
about a scene and about a life, not claims about whether the cast can change — so
the half of this stage that §1.6 routes behind P7.3 is exactly the half that
waited.

**And *introduced* has an implementation**, which §1.6 calls *"an unspent
obligation"*: [06 §6.1]'s hook filter and [04 §6.1]'s introduction hook have both
been spending the word as a mechanical predicate since they were written, and
§8.1 defined it without anything implementing it. Derived by folding presence and
party effects along the path, so it is monotone, needs no third channel, and
un-introduces on a rewind for free. *`se.party` is named in the fold before the
channel exists, because a list that omitted it would be the definition quietly
narrowed to what happened to be built.*

**The death asymmetry is a declared policy rather than engine code naming a
channel.** `ChannelDefinition.confirm` lists the values a model may not set on
its own, and `se.status` names both terminal ones; `refuse` answers
`needs-confirmation`, before the schema check, because *this one needs a person*
is a sentence with a next step while `schema` on a value the model was never
allowed to set sends somebody looking for a typo. **Two consumers by design** —
P7.6's goal completion is documented as the same posture, and building one
status-shaped now is the reinvention this phase keeps catching.

*The two source documents are ambiguous about whether "flagged, not applied
quietly" means refused or applied-loudly, and [25 C12] is what settles it:
**under-firing plus always-available manual completion is the position
regardless**, and the harm 10 §13.2 names is in the applying. The manual path is
the channel-write route [P7.1] built for recovery, which turns out to be the same
primitive.*

Then **the cast panel** ([10 §13.2]). One badge derived from two axes, in a
tested function rather than inline, because the two combinations the split exists
for — *dead but present* and *alive, elsewhere* — are exactly what a
simplification would collapse, and collapsing them on the screen while leaving
the split in the data is the worst of both. **Editable**, which that section
calls the thing that makes it worth building: *"read-only, the panel is a
complaint the user cannot act on."*

*It offers one of §13.2's four repairs — correct presence and status directly —
and the other three are named rather than dropped: **merge** and **split** are
library operations needing a redirect so turn records pointing at an actor id do
not rot ([00 §3.3]), and no such mechanism exists; **linking an unresolved
mention** waits on P7.7's spans, since there is nothing yet to link from.*

**A refused death gets a bordered box with the actor's name in a sentence and two
buttons, not a badge** — because a badge is precisely the *quiet* treatment §8.1
rules out. Either button answers the proposal, since what clears it is an
*applied* status effect: a person having ruled, in one direction or the other.

***Party members are not marked, and the absence is the honest reading of the
sentence.*** 10 §13.2 wants party members marked **and** *"no parallel membership
concept"* — so while `se.party` waits on P7.3, marking nothing beats inventing a
second source of truth about who is in the story, which that same paragraph calls
*"exactly the class of bug this section exists to surface"*.

#### A record that claimed to carry an attempt and did not

***Found building the panel, fixed there: `acceptEffect` stamped `before` into
`after` on a refusal.*** So a rejected effect recorded that **something** had
been refused and not **what** — which contradicts the sentence
[21 §1.2](../21-internal-contracts.md) uses to justify recording refusals at all:
*"the model tried to give itself forty gold and the engine said no, and a system
that dropped the attempt would leave the workbench unable to explain why nothing
happened."* The forty gold was exactly what got dropped. `EffectList` rendered
`08:00 → 08:00` with *Rejected* beside it.

`after` is the proposed value now, and `applied` is what says whether it
happened — which every reader already honoured: `applyEffects` and `undoTurn`
both skip an unapplied effect before touching `after`. **Checked rather than
assumed**, and no replay changed. *Three tests pinned the old behaviour in place
and one of them explained why — belt and braces against a replay bug that does
not exist, bought at the cost of the record.* Without the fix this panel could
only have said *the narrator proposed something*.

**What remains of P7.2 is `se.party` and the removal of `cast.actors`,** both of
which §1.6 routes behind P7.3's `select` — so the stage is at its documented
boundary rather than at its end.

***And it is held by a check rather than by this paragraph, added 2026-09-11.***
`ParticipantPolicy.select`'s arms are now a runtime list, and
`sessions/cast.test.ts` reads it: while the list is `['fixed']` the licence holds
and `se.party` must **not** be registered; the moment a second arm lands the test
fails and names all three things that come due — the party channel, the removal
of `cast.actors`, and `CastRow.party` so the panel can mark members rather than
keep a second list. **Proven by mutation**: widening the list to `['fixed',
'list']` turns it red, restoring it turns it green.

*Written as a check because this document's own §0.1a is the evidence for why
prose is not enough — "a deferral routed to a phase is checked once, by whoever
routes it, and then travels on its label", and two of the three surface-shaped
deferrals handed to P7 turned out to be already done. This one fails from inside
P7.3 rather than after it, since widening `select` is the first thing that stage
does.*

*And the panel's asymmetric-death treatment says a proposed `dead` is **reversible
from the effect log** — for which there is no mechanism. The only reversal in the
build is `undoTurn`, whole-turn and tip-only, and the workbench's effect list is a
read-only rendering. Either the stage builds per-effect reversal or the sentence
means "undo the turn", and those are different products.*

*And **`introduced` is this stage's output**, not P7.5's* (§1.6): the predicate is
derived by folding presence and party effects along the path, so it is cheap here
and nonexistent before here. P7.5's second World obligation depends on it.

*One more thing §1.6 frames as a move that is not one: **`control` and narrator
selection were never fields.** Neither exists anywhere in the code — the only
narrator declaration is `ModeDefinition.voice`. Party is a move; those two are
new.*
*Also this stage's: **hidden content must be identifiable to a later extractor**,
not merely hidden in a panel — [P8](24-p8-implementation.md)'s spoiler defence
cannot be built before the content exists and must not be deferred past P8.*

*Ends at:* a character dead on one branch and alive on the other, in the panel,
with no branch-awareness in the panel's own code.

### P7.3 — Participant policy, and the two axes

`ParticipantPolicy` with SillyTavern's four activation strategies as the
taxonomy ([06 §7.2](../06-modes-and-turn-pipeline.md)); voice and dispatch as two
visible controls rather than a four-way enum — **and as optional *session* fields
whose absence means the mode's value**, which `modes/types.ts:36-48` defers here
by name and is a record-shape change rather than a control; `per-actor` making
`ModelHint` meaningful at last; mixed voice within a turn as a preset capability
([25 C2](../25-open-questions.md)); §1.9's session and step overrides, **and the
role-binding editor two documents routed into §1.9**, which is a different
surface. *The taxonomy has no imported material behind it: the SillyTavern
importer records `groups` and `group chats` and parses neither, so nothing named
`NATURAL`/`LIST`/`POOLED`/`MANUAL` exists anywhere in the build.*

*Ends at:* a session overriding a role for one step, and a mode whose `select` is
not `fixed` running ~~without the session's `cast` field~~ **with the roster and
the channels resolving to one cast** *(corrected 2026-09-12: the field stays —
see the record-shape decision below and §1.6)*.

#### In progress — opened 2026-09-11

**Done: [19 §5.1]'s override layers are passed.** `resolveRole` has implemented
five layers since P2B and §1.9 found **three of the four built ones had no
production caller** — session, step and the actor hint. The table in 19 §5.1
exists precisely so *"the order above is not read as a description of what
runs"*, and for two of those layers it described a function nobody called.
`SessionFile.roles` and `SessionFile.stepRoles` carry them, the runner passes
them, `PUT /sessions/:id/roles` writes them, and the layering is tested against a
**second connection** — an override pointing at the same connection as the
binding would pass whether or not it was consulted.

***And then the third was passed too, on a reading of §1.9 that section did not
draw.*** It says what would make the hint meaningful is `dispatch: 'per-actor'`,
*"because today one turn makes one merged call and an actor is not in the
resolution at all"* — and the operative clause is the second one. **Putting the
actor into the resolution does not require a mode that fans out.**
`StepCallRequest.actorId` is a step saying who it speaks for; the engine finds
the card and applies its hint. A merged call names nobody and resolves with no
hint, which is exactly what `dispatch: 'merged'` means, so the mechanism is
correct for the modes that exist and ready for the one that fans out.

*The step passes an **id**, never a hint, which is [04 §3]'s rule surviving
contact: `ModelHint` is "a preference, never a binding — an imported card may
express what it wants; it can never repoint anyone's provider", and a step handed
the preference could pass one the card does not carry. Two assertions hold the
two halves — a hint picks among the models the resolved connection already
offers, and it never changes the connection — plus the one easiest to drop: a
hint carries a `role`, so a card preferring a `reasoning` model is saying nothing
about which model narrates.*

***And the suite caught the route in a guard, which is the guard working.***
`connections.test.ts` asserts that **no route matching `connections|bindings|
roles` is registered outside `/api/admin/`** — a default-deny name match, written
*"so a fifth route on this surface is covered by existing, not by somebody
remembering"*. `PUT /sessions/:id/roles` matches it and must not be admin-only:
19 §5.1 is explicit that *"anyone who wants their own key overrides a role
without the admin's involvement"*. **Named as an exception rather than fixed by
loosening the pattern** — loosening would un-cover routes nobody has written yet,
which is the same argument `eslint.config.js` makes for naming one file per
exemption. Two tests hold the exception: one that the route still exists, so a
stale exemption cannot become a hole, and one that its body schema refuses an
`apiKey` — because the exemption rests on the route carrying ids only, and a
route that grew a credential field would still be exempt by name.

*What makes it safe is `usable`, not the name: `resolveRole` looks an override's
`connectionId` up in the capability-filtered list, so a binding naming a
connection the account may not use resolves as `dangling` rather than as access.*

**Next, and it is one change rather than three:** `select`'s widening to
[06 §7.2]'s taxonomy trips [P7.2]'s tripwire by design, and the tripwire names
what comes due with it — `se.party`, the removal of `cast.actors`, and
`CastRow.party`. *Sized before starting rather than during: the readers of
`cast.actors` are few (`turns/cast.ts`'s `resolveCast`, the create route and the
cast route), but **the session's actor list has no home that does not need a
turn**. §1.6 says `cast.actors` is "presence-shaped", and a presence effect needs
a turn to be recorded on, while a session is created before its first turn — so
either creation writes a bookkeeping turn, the way `divergenceTurn` and the
quarantine do, or the list stays somewhere a turn cannot reach. That is the
decision the stage opens on, and it is a record-shape decision rather than a
wiring job.* Then voice and dispatch as optional session fields, which want a
consumer first — and `dispatch`'s consumer is a mode that fans out, which is
[P7.9]'s.

**Done: the role-binding editor, which §1.9 routed here and this cell named**
(2026-09-12). `GET /api/me/roles`, `PUT /api/me/bindings`, and a `MyRoles` pane
in the settings surface for **every** account rather than for an admin. §1.9
carries the argument and what testing it corrected; the short form is that the
layer has resolved since P2B and the file has had a reader since P2.5, so this is
a writer for something already load-bearing rather than a new mechanism —
[R2 / F-01]'s *use a second model*, finally reachable without hand-editing JSON.

*Three things came with it that are worth naming because they are the kind that
would otherwise be quietly skipped.* `presentRoleRow` and `roleWords.ts` are one
row shape and one vocabulary for the two tables, so the install's answer and
yours cannot start describing the same resolution differently. `SelectField`
gained `hideLabel` — a real `<label>` with `sr-only`, because a control in a
table cell is named by its row and column headers and drawing the label again
prints the row header twice. And **`docs/api.md` was three routes behind**: it
says *"as built, and kept so"*, and P7.1's channel write and P7.3's two override
layers had never been added. All four are in it now, with `GET /sessions/:id`'s
response corrected to the four fields it actually returns.

**Done: the record-shape decision, and the answer is a withdrawal** (2026-09-12).
The sizing above framed it as a choice between a creation-time bookkeeping turn
and *somewhere a turn cannot reach*. Neither, because the premise was wrong:
**there is no channel for the roster to move into.** `se.presence` declares
`init: false` — deliberately, and the declaration argues for it — so *in the cast
and elsewhere* and *not in the cast* are one value, and `readPresence` returns
`false` for both. A roster read off presence would have to read **key presence**
rather than value, and `inverseOf` deletes a key when undoing an arrival, which
is correct for presence and a silent eviction for a roster. §1.6 now carries the
correction in full.

*The creation-turn option was priced before it was dropped rather than after, and
it was affordable: `divergenceTurn` takes a `null` parent, `writeChannel` already
writes a call-less, tape-less turn, and `PlayPage`'s `rerunnable` already tolerates
a turn with no input — it would have cost every session with a cast a blank first
transcript entry, because the transcript does not filter bookkeeping turns. Worth
recording, because the same shape is what [P7.4]'s Setup application will want.*

**And the bug the migration was going to fix got fixed at its actual site.** Two
sources of truth was the right diagnosis and the wrong location: the disagreement
was between `castRows`, which has unioned the roster with the actors the channels
name since P7.2, and `resolveCast`, which read the roster alone — so an arrival
got a panel row and no character card, on every turn after it, reachable without
a hand edit because `se.presence` is `model-proposed`. `resolveCast` now takes
the channel map at the node and resolves the union, with arrivals **appended**
rather than sorted in, because `assembly/collect.ts` resolves `{{char}}` to
`actors[0]` and that must not change identity part-way through a story.
Mutation-proven: four of the nine assertions in `turns/cast.test.ts` go red with
the union disabled and the five never-throws ones do not.

**What the tripwire cost, which is the point of having built it.** [P7.2]'s
deferral test named three things due with the widening; one of them was wrong,
and the tripwire is what forced the question to be asked before the arm landed
instead of after. Its `cast.actors` clause now asserts the field **stays** — in
both branches — so the withdrawn obligation cannot be acted on later from §1.6's
original sentence. The other two clauses stand: `se.party` and `CastRow.party`
are still owed when `select` widens.

**Done: `select` widened, and the two standing clauses discharged with it**
(2026-09-12). `PARTICIPANT_SELECTORS` is `fixed | natural | list | pooled |
manual`; `se.party` is declared beside presence and status; `CastRow.party`
carries the `control` and the panel marks it. One commit, because the tripwire
is what says they are one change — a party channel declared under a policy that
still said the cast cannot change is the placeholder [P2 §2.7] rejected, and the
widened policy with no party channel is the deferral travelling on its label
again.

*Lowercase arms where [06 §7.2] writes ST's constants.* A `select` value lands in
a mode definition, which is content, and every neighbouring vocabulary is
lowercase — `merged`, `per-actor`, `narrator`, `embodied`. `NATURAL` would be the
only shouted id in the build, spelled that way because a different program spells
its enum that way.

**`turns/speakers.ts` is the consumer, and it is the first real reader of
[P7.2]'s channels.** Eligibility is *present, and not written out of the story*,
so a character who left the room does not answer and a dead one does not speak —
which is also the honest reason the taxonomy could not have been built before
P7.2: a selector over a cast with no notion of presence picks from everyone the
session has ever named. Per arm: `list` rotates on the **path's depth**, which is
[07 §3]'s rule satisfied rather than dodged (a path to a node is a fact about the
node, where `(branch, index)` is not); `pooled` draws through the turn's tape
with `weightedPick`, so a replay is the same scene and a winner who has since
died is redrawn rather than replayed — `random.ts` names that hazard and this is
its first caller; `natural` is ST's name-scan over the player's input and the
last prose, and is described as the heuristic it is; `manual` takes the input's
actor and answers **nobody** when none was named, which is why `speakers` had to
be able to be empty. `fixed` makes no selection at all and reaches a step as
*absent*, so nothing about a shipped mode changed.

**Selected once, before the step loop.** Two steps must not be able to disagree
about who is speaking, and a `pooled` draw computed per step would put a
different number of draws on the tape depending on how many steps the plan
happened to run — a replay diverging for a reason nobody could see.

*The stage's* Ends at *is a test rather than a claim*: `ENSEMBLE_MODE` in
`test-mode.ts` declares `select: 'list'`, and `runner.test.ts` runs two turns
through it and asserts the rotation by name — over a cast of two, an assertion
satisfiable by either actor is satisfied by a selector that ignores its policy.
A third case pins that the rotation is over who is *eligible* rather than over
`cast.actors`.

*Two small things the change turned up.* `effects.test.ts` used `se.party` as its
stand-in for an unknown channel, so declaring it moved that refusal from
`unknown-channel` to `schema`; the fixture is now an id from somebody else's
namespace, because a planned-but-unbuilt id is exactly the wrong fixture for
*unknown*. And `steps.test.ts`' `Record<keyof Required<StepInput>, true>` stopped
compiling the moment `speakers` was added, which is [P7 §1.3]'s seam guard doing
the job it was written for.

### P7.4 — Setup objects and the declarative wizard

`SetupSchema` as declared rather than coded — **note that this is not `Setup`**,
which is a shipped portable schema carrying `hooks` and `goals`; two different
objects one word apart, and the stage owes both. ~~the `setups/` library kind that
has had a folder in the layout since P1 and no writer~~ **The `setups/` kind has
a folder, a canonical filename, a generic index walk, full CRUD through the one
handler set, a library shelf and a `newSetup` factory whose only caller is a
test** — what it has no surface for is *making* one, and what it has no consumer
for is *anything*: session creation takes mode, preset, treatment, cast and lore
as five separate parameters and has no `setup` field at all.
**Incremental generation is the reliability requirement**, not a nicety
([00 §2.3](../00-stance.md), [06 §7.3](../06-modes-and-turn-pipeline.md)): each
part separately validated, individually retryable, applied as it succeeds.

**And the floor is lower than the stage reads, on both halves** (2026-09-10).
Declaration-driven *rendering* exists and is good — `library/fields.ts` reads the
emitted JSON Schema at runtime and `ByField.tsx` renders any known kind from it —
but it is **read-only by design**, every editor and settings pane is hand-written
JSX, there is no `WidgetSpec`, no schema-to-control dispatcher, and **no route
that would hand a declaration to the client**. And incremental generation starts
below zero: `GenerationRequest.schema` and `GenerationResult.object` exist and
**the openai-compatible adapter mentions neither**, the retry ladder has no
validation arm, and no model has ever proposed an effect. So this stage builds
structured output end to end before it can build anything incremental on it, and
it is the largest single piece of new UI in the phase.

*Ends at:* a wizard for a mode the engine has no knowledge of, rendered from its
declaration alone, whose failed part is retried without discarding the parts that
succeeded.

#### In progress — opened 2026-09-12

**Done: the adapter speaks structured output, and three measurements changed the
shape of what comes next.** `GenerationRequest.schema` and
`GenerationResult.object` had been in the contract since P2.5 with the adapter
mentioning neither, so every question about how the pair behaves was open. Each
was answered against the SDK through the stub transport `openai-compatible.test.ts`
already had, and each is now pinned there rather than described in a comment —
a minor SDK bump that changed one would otherwise change what the engine believes
about its own prompts.

1. **The schema reaches the wire only when the capability says so.** The client
   is constructed with `supportsStructuredOutputs:
   capabilities.supportsStructuredOutput`; with it on the request carries
   `response_format: {type: "json_schema", …}`, with it off the SDK **drops the
   schema**, warns, and sends bare `{type: "json_object"}`. Since
   `openai-compatible` declares the capability `false` by default — the endpoint
   behind it could be anything — **out of the box the model is asked for JSON and
   told nothing about its shape.** That makes the prompted-JSON degrade the
   contract already promises a requirement rather than a precaution, and it is
   the next thing this stage owes.
2. **A reply that will not parse throws rather than returning**, and the error
   carries the text, the usage, the finish reason and the response metadata. So
   nothing is lost: the adapter reassembles the ordinary result with `object`
   undefined, because *the model said something that was not the shape* is a
   **result** and whether it is worth asking again is the caller's policy. A
   fenced reply — the commonest local-model failure there is — therefore reaches
   the record with everything it actually said.
3. ***The SDK does not validate.*** `{"nom":"Vera"}` comes back as a successful
   object against a schema requiring `name` with `additionalProperties: false`.
   `jsonSchema()` is a **carrier**, not a validator. So `GenerationResult.object`
   means *the endpoint returned parseable JSON*, never *the JSON fits* — and the
   engine validating is not belt-and-braces, it is the only validation there is.
   Both `GenerationRequest.schema` and `GenerationResult.object` now say so where
   somebody would otherwise assume the SDK had done it.

*`object` is present-and-undefined on a miss and absent when nobody asked, so
those two are distinguishable — which is what will let a schema miss be retried
without retrying every prose call that returned nothing.* The live project gained
both capability arms, because they send different bytes and a local runtime can
honour one and not the other; the permissive arm reports a miss rather than
failing on it, since an endpoint asked for bare JSON and told nothing about the
shape is entitled to write prose.

**Done: the caller's half, so structured output works end to end** (2026-09-12).
Three pieces, and the first is the one a self-hosted install actually uses.

**The degrade, decided in `planCall` with the capabilities in hand**, which is
where `GenerationRequest.schema` says it belongs. An endpoint that cannot be
handed a schema is asked in words — appended as a **candidate**, not spliced into
the messages, so it is estimated, budgeted and recorded like everything else and
`RenderedMessage.fromBlocks` stays non-empty. `BlockSource` gained
`{ kind: 'schema' }`: the one arm that is not content, and the same class of
thing as `systemMessage: 'fold-into-first-user'` — the caller rewriting a request
to suit what an endpoint can take. It is `required`, so the budgeter cannot drop
it: a call that must answer in a shape is meaningless without the sentence saying
which shape.

**`turns/structured.ts` validates, because nothing else does.** Ajv, keyed by the
schema object in a `WeakMap` — `channel-schema.ts`'s conclusion after getting the
key wrong once, and sharper here because a request schema has no version to bump.
A schema that will not compile **passes**, the same call that module makes: a
broken declaration is a mode author's mistake and failing every call over it
takes the mode out of service for something nobody playing can fix. Two miss
kinds, because the remedies differ: `unparseable` is *the model did not answer
with JSON*, `invalid` carries Ajv's issues, and the issues are the only thing
separating *nearly right* from *nothing like it*.

**And the ladder got its validation arm.** A miss is retried — **with no
backoff**, since `RETRY_BACKOFF_MS` paces an endpoint that is busy and nothing
about this one is. The miss outranks the finish reason: a model that stopped
cleanly and answered in the wrong shape has `finishReason: 'stop'`, so without
this the record would say `ok`. It records as `outcome: 'error'` with
`class: 'retryable'`, which is the honest one of the three — asking again is the
remedy, and `terminal` would tell a UI to stop offering it. **A value that failed
the check does not reach the step**: the step asked for a shape, and handing it
one that is not that shape invites a step that forgot to check `undefined` to
write effects from garbage. The text survives on the record, where a person can
still see what was said.

*Written down rather than sneaked in: **the retry sends the same messages**, so
at temperature 0 against a deterministic endpoint it will produce the same miss.
Telling the model what was wrong would be a real repair and needs a record that
can express "attempt 2 sent different messages" — `ModelCall` carries one
`messages` per call, checkpointed before anything is dispatched ([P3.0]). That is
a record-shape change, and it is the next thing to weigh if misses turn out to be
common in practice.*

**Done: `SetupSchema` is a declaration, and a route carries it** (2026-09-12).

**The route's absence was wider than the wizard.** `registeredModes()` had **no
production reader at all** — only tests — so nothing could tell a browser which
modes exist; the session form offered *the mode's own preset* and had nothing to
say about modes. `GET /api/modes` and `GET /api/modes/:modeId` now carry a
`PublicMode`, and the omissions are the design: no `assembly` (a session copies
its preset at creation, so the pack is not the client's to see or change), no
`steps`, no `channels` — a channel reaches a client as a rendered `hud` entry on
the session, which is 10 §8's whole arrangement.

**`DeclaredSetup` is the arm the one-arm note predicted.** `SetupSchema` was
written as a union with one member *"because P7's real wizard adds arms rather
than fields"*, and this is the arm. A field carries an `id`, an optional
`required`, and a `widget` — **and no schema of its own**. That is the load-bearing
choice: a toggle is a boolean, a choice is one of its options' values, a text
field is a string, so a schema beside the widget would be a *second description
of the same field*, which `library/fields.ts` spends its header refusing with a
receipt. `setupAnswerSchema` derives it, in the SDK, so the server's check and a
client's pre-check are the same derivation.

**`FieldWidget` is separate from `WidgetSpec`, and the split is not
bureaucracy.** That one renders a value the engine already holds; this one asks
for a value nobody holds yet, and sharing the `kind` vocabulary would make `text`
mean *show a string* in one place and *ask for a string* in another. What they
share is 10 §8's terms in full: declared and never shipped, the vocabulary keeps
growing rather than acquiring an escape hatch, and **never an `html: string`
field**. *Three arms, each with a named subject in [06 §7.3]* — a difficulty
chosen from a ranked list, a world overview in prose, and *"dice, HP or inventory
channels available as **toggles** rather than as a different mode"*. A `number`
arm has no subject in the corpus and is not here; a `ref` arm is absent for a
different reason, that session creation already takes `treatment`, `cast` and
`lore` as its own parameters.

**And the declaration is held to, which is what stops it being decoration.**
`POST /api/sessions` takes `setup` and refuses `422 setup-invalid` carrying the
field names — a required field missing, a choice the mode does not offer, a field
of the wrong type, or a key the mode never declared. *A mode with no wizard
accepts exactly `{}`*, so answers sent to Scene are refused rather than quietly
ignored, and a session for such a mode carries **no `setup` key at all**: `{}`
would be a claim that a wizard ran and collected nothing, and every session
written before this stage is in that state.

*The exit line's witness is `SETUP_MODE` in `test-mode.ts` — a mode nothing in
`packages/server` names, registered by its tests and by nothing else. If its
declaration reaches a client intact then so does one an extension shipped, which
is the only honest way to test "a mode the engine has no knowledge of".*

**Next:** the client half — the schema-to-control dispatcher rendering that
declaration, which is what the cell means by the largest single piece of new UI
in the phase. Then the generated **parts**: [06 §7.3]'s *"world overview, map,
cast, sheets and widgets as separate validated generations, each individually
retryable, applied as they succeed"*. Incremental generation now has something to
be incremental *over* — a part is a schema, a validation and a retry, and all
three exist since the commit before this one.

### P7.5 — Hooks: the pool, the selector, and the three companions

The pool and its four sources; the mechanical filter; the judgement pass firing
through the guidance slot; §1.5's two corrections; the pacing dial as §1.4's
channel; Commit with its bounded three-turn patience counted **on the path**;
`introduces` and the reversed clause; session-local hooks addable to a running
session, and treatment changes **pulled, never pushed**
([06 §6.1](../06-modes-and-turn-pipeline.md), over
[00 §3.1](../00-stance.md)). The hook panel ([10 §10.1](../10-ui-surfaces.md))
with Commit on it and force-fire deliberately in the workbench instead.

**What this stage is actually starting from, which is further back than the
sentence above reads** (2026-09-10; §0.1a has the citations). **Nothing reads a
hook anywhere** — not the retriever, not the assembler, not the indexer, not the
client — so this is zero readers rather than a partial implementation. And five
of the pieces it names do not exist as shapes:

- **`introduces`, `Introduction` and `Entrance` are not in the schema.** Three
  optional fields on a stable-tier portable kind carried by three carriers, plus
  their JSON-schema exports, plus [04 §6.1a](../04-schemas.md)'s
  *"schema stays `/1`"* argument. This stage **adds** `introduces`; it does not
  consume it.
- **`hookPacing` is not on `Treatment` or `Setup`**, so §1.4's dial has no
  advisory value to init from. Two more fields on two published schemas.
- **The pool's fourth source has no home.** `SessionFile` has no `hooks` field and
  `NewSession` no way to pass one, though session-local hooks are called *the
  primary path*.
- **Session creation copies nothing but the preset**, so obligation 1's *"what is
  being pinned is that copying does not mint a fresh one"* is pinning a copy that
  is not there.
- **The selector's record line has no field to land in** (§1.5).

*Two clauses of the mechanical filter are not this phase's, and the stage should
say so rather than leave a reader to reconcile it with §4:*
[06 §6.1](../06-modes-and-turn-pipeline.md) lists *"`involves`, `requires`,
`blockedBy`, `notBefore`, and already-fired"*, and `requires` was **deliberately
removed** from the `/1` schema with `onFire` because the rule vocabulary is 6.0.
Four of five, additively recoverable.

*And [25 C13](../25-open-questions.md) is this stage's, uncited: a judgement call
is re-run on rewrite, so a draw made over its output cannot replay — which is
precisely stage 2 followed by an entrance drawn across `introduces.entrances`.
`pick`'s `usable` gate is the mechanism waiting for a first production caller, and
this is it.*

**Two one-line obligations that World depends on, and that cannot be added
later** ([15 §5](../15-world.md)). World is a committed release now rather than a
roadmap entry, so these are requirements of this stage rather than options worth
keeping open:

1. **A copied hook keeps the source hook's `id`.** Session creation copies hooks
   from all sources ([03 §4.1](../03-data-model.md)). Within a continuity, a hook
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
   — introduced them already. The `introduced` predicate ~~already exists
   per-session~~ **is defined per-session and implemented nowhere**
   ([06 §8.1](../06-modes-and-turn-pipeline.md)); only its scope
   widens later, and only if the key is right now.

Both are free at this stage and unrecoverable after it, which is the whole
reason they are named here rather than in [15](../15-world.md) alone.

***Obligation 2 is not free in the sense the paragraph above implies, 2026-09-10.***
*Keying on the subject is free — it is a choice, and the right one. But the
predicate it keys through is P7.2's output: `se.presence`, `se.party` and
`se.status` do not exist, so "already exists" is true of the definition and false
of the code, in this document and in [15 §5.2](../15-world.md) alike. §1.6
enumerates the six things an implementation must read.*

*Entrances are shown by label, never by text* ([08 §6](../08-cross-session-memory.md),
[10 §10.1](../10-ui-surfaces.md)). An unfired entrance is hidden
content, and a panel that spoils the arrival defeats the feature. *Which is also
[P8](24-p8-implementation.md)'s constraint arriving early: hidden content has to
be identifiable to a later extractor, not merely unrendered.*

*Ends at:* a hook firing with the record saying why, a committed hook uncommitted
by a rewind past the commitment, and an introduction hook the narrator ignored
back in the pool with the attempt on the record.

### P7.6 — Goals

The chain, not a field — *and it is already the chain in schema*: `Goal` ships
with `next`, `thenDefault`, `completion: narrative | manual` and `visibility`, and
`Setup.goals` is ordered with `goals[0]` where play begins
([06 §7.3.3](../06-modes-and-turn-pipeline.md) is what it answers to). The
progress channel with `model-proposed` in Freeform — **the first `model-proposed`
channel in the build, and the first time anything parses model output into
validated state**; narrative completion biased toward under-firing with manual
completion always available; the three offers at conclusion, chosen **at
completion rather than at setup**; completed goals retained with the turn that
completed them, which is
what gives the reading view (P11) a real spine and the selector a proximity
signal. [25 C12](../25-open-questions.md) — confirmation before completion fires
— is decided here or explicitly left open with its reason. *C12 leaves only the
confirmation gate open: the bias and the always-available manual escape are
settled, and this phase commits to the same bias twice, at P7.2 for death.*

**The whole gap is runtime, which is the stage's actual size** (2026-09-10).
`Goal` is a clean subset of what 06 §7.3.3 asks for; what does not exist is
everything the design puts *outside* the schema — achieved state, a cursor for
which goal is current, the link to the completing turn, a goal *written now* at
Advance, a place to record the answer `thenDefault` only seeds, and *concluded* as
a session state. Beside them sit three inert references — a `SlotSource` arm, a
`BlockSource` arm and a workbench label — with the collector returning `[]` and
reporting `no-producer`. **A goal cannot be rendered into a prompt until P7.1's
channel-to-text renderer exists.**

*Ends at:* a goal completing, the three offers appearing, *Advance* setting the
next, and the session still readable and branchable after *End*.

### P7.7 — Mention resolution

An `extract` step producing §1.7's spans, sharing P5's keyword scanner so
highlighting and inclusion reasons cannot disagree about who *the fixer* is.
`explicit` and `matched` at 1.0; **`proposed` may follow, but the span overlay
and the never-auto-create rule land now** — both structural, and
auto-materialising on first mention is precisely the failure the feature exists
to make visible.

*Two things §5 does not price when it calls this stage smaller than it looks*
(2026-09-10): the scanner's `KeyHit` is `{ key, source }` and carries **no
offsets**, so *sharing* it means widening the matcher to record where; and
`packages/shared/src/matching.ts` already returns an untagged `{ start, end }`
from three functions, so §1.7's tagged type has to land **in the same change** or
it lands beside an untagged one. *And this stage's `extract` step is what turns a
provisionally-fired introduction hook into a fired one, which is P7.5's fourth
property row — so the two stages close together whatever order they are built in.*

*Ends at:* a highlight set equal to the scanner's match set over one turn's text,
and an unresolved name offering rather than creating.

### P7.8 — Difficulty and directedness

Two settings, levels supplied by the prompt pack rather than engine code
([06 §7.3.1–7.3.2](../06-modes-and-turn-pipeline.md)). Coherent only because
P7.6 shipped goals — difficulty without a goal can only say *introduce friction*,
which reads as arbitrary within a few turns. *And
[23 §5.4](../23-randomizers.md) adds a constraint this stage must not lose: a
frequency dial stays a **separate** channel from difficulty, because folding
* how often* into *how hard* rebuilds exactly the conflation
[06 §7.3.2](../06-modes-and-turn-pipeline.md) exists to prevent.*

*Ends at:* two levels of difficulty producing visibly different friction against
the same goal, with the level's prose coming from the pack and the scheduling from
engine code.

### P7.9 — Freeform, and Scene grown up

The second mode — **`packages/modes/freeform`, and it is the second package, not
only the second mode**; [19 §10](../19-tech-stack.md)'s tree still draws
`modes/adventure`, a mode [06 §1](../06-modes-and-turn-pipeline.md) dissolved —
built entirely through the contract; Scene grown from P2's
deliberately embarrassing minimum to its 1.0 shape — sprites, backgrounds and
expression selection as steps writing channels, with **text-only remaining a
first-class configuration**, as it is in both sources.

**The minimum it grows from, stated once so the stage is measurable**
(2026-09-10): one `generate` step, `se.narrate`, `reads: ['history']`,
`writes: []` — load-bearing, because an empty `writes` with
`contributes: 'messages'` is what yields the `prose` purpose and admits the
guidance block, and one entry would abort every guidance-carrying turn —
`callKind: 'narrate'`, cadence 1, `failure: 'abort'`, `role: 'prose'`, whose
implementation is two lines. Plus `maxActors: 1`, `inputs: ['do']`,
`surfaces: []`, `presets: []`, `setup: { kind: 'none' }`, one declared channel the
engine writes for it after the step loop, and a thirteen-block preset that is a
code constant nobody can open.

*So this stage also owns three things the sentence above does not name:* **the
input-kind selector** (`say` / `think` / `story` / `choice`, declared in
`ModeDefinition.inputs` and reachable from nowhere — the standing line, in the
phase that owns it); **the preview's fifth state**, *this turn will not narrate*,
which `turns/preview.ts` refuses to evaluate because no shipped mode can reach a
cadence-gated step and this phase's selector is the first that can; and
**[R11](22-walkthrough-refinements.md)'s suggested actions**, routed here by name,
with the persisted-shape question that comes with them — generated inside the turn
as a `post` step, or stored beside `lastSelectedChild` — which forks the record
and so is not deferrable past the export freeze.

**One obligation to P9, and it costs a type rather than a feature.** The
background channel declared here holds *which backdrop is showing*; two phases
later P9 generates backdrops and writes that channel
([06 §10.1a](../06-modes-and-turn-pipeline.md),
[P9 §1.7](25-p9-implementation.md)). So **its value must be a media reference
able to name either an authored image or a rendition's asset, from this
declaration onward.** The narrower shape is the tempting one, because a filename
is all P7 can actually produce — and choosing it means changing a channel's
schema under live sessions ([06 §4.2](../06-modes-and-turn-pipeline.md)) to admit
the generated case. Free here, a migration there. Nothing else about backdrops
is this phase's: P7 says which one, P9 says where it comes from.

*And no existing type can carry it, checked 2026-09-10.* The three candidates are
all references **into an object's own container** and a rendition's asset is not
in one: `EmbeddedMedia` is a manifest entry whose `ref` the container resolves, so
a channel value holding one would be a copy of a row that goes stale;
`AssetRef` is a bare relative path with no owner; `GeneratedMap` is per-field
provenance and not a media reference at all. Widening any of them is worse, since
all three are portable types carried by five published schemas. **The minimal
shape is a two-arm tagged union** — `{ from: 'authored', objectId, mediaId }` and
`{ from: 'rendition', renditionId }` — internal rather than portable, addressed by
id rather than by path so packaging cannot break it, and carrying no `mime`,
`digest` or `bytes`, because those are the manifest's fields and this resolves
rather than describes. The second arm is dead on arrival, which is the
obligation's whole content. *Two smaller notes: `MediaRole` is a closed
seven-arm union with **no `background` arm**, so an authored backdrop has no role
that names it; and the channel is session-scoped and written as an ordinary
effect, so its `update` policy is the open question — a backdrop a **user** picks
is the build's first plausible `user-only` subject, which is the gap P7.1 needs
filled anyway.*

**And a second obligation to P9 that §P7.9 does not collect.**
[P9](25-p9-implementation.md) also says *"P7 owes P9 a step that can be added
without a back door"* — a rendition step is the contract's **fourth witness**, and
the first added by a phase that is not about modes. That bears directly on §1.8,
which weighs only the assistant. *And P9's backdrop selector assumes a **location
channel** this phase declares; §P7.9 declares a backdrop channel and no location
one.*

*Ends at:* the demo — *play Freeform, set up through a wizard nobody wrote a form
for, to a goal completion, with the cast panel, the hook panel and the workbench
all reading state a mode package declared and the engine never special-cased* —
and `packages/server/src/modes/` gone, with a check that fails if it returns.

---

## 3. Verification — the P7 exit gate

~~Sketch; expand on revisit.~~ *The ten steps were the sketch and they stand.
§3.1, added 2026-09-10, is the revisit: it splits them under
[manual testing §0](05-manual-testing.md)'s two-tier gate — adopted 2026-09-09,
two days after this document was last audited — and gives them cells to write in.
The gate is written before the code on purpose: a gate written after it is a gate
written to pass.*

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
   [testing §1](03-testing.md) property, as a test rather than a sentence.
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

**And the standing line from [work plan §2.3](01-work-plan.md): no phase exits with
configuration that has no surface.** This phase generates more of it than any
other — every declared channel, every mode preset, every setup schema — so the
line is a checklist item here rather than a formality.

### 3.1 The split, and what closes this gate

*Added 2026-09-10. **The ten steps above are never edited** — they keep asking
what they asked, and this table records what was answered and by what, which is
the separation [manual testing §0](05-manual-testing.md)'s third honesty
condition demands against "a walk that edits the gate until it passes." Without
it the two-tier model is a rubber stamp with extra steps.*

**The criterion, applied rather than argued** ([manual testing §0](05-manual-testing.md)):
a check is critical if and only if **(i)** it can falsify a claim *this phase*
makes about itself rather than one its gate transports, **(ii)** the claim
compounds, and **(iii)** it is walkable with what is to hand. §0's own caveat
applies here with unusual force: *"clause (ii) privileges compounding, and
compounding is a prediction about the plan… If P7 reshapes the mode contract far
enough, some of what is excluded today as equally cheap later becomes more
expensive instead."* Re-read it when the phase opens.

**Six of the ten split into a machine half and a person half**, which is most of
the work of this section.

| Step | Answered by | State |
|---|---|---|
| **1** `modes/` gone; a mode→server import fails the build | **a lint fixture**, and **a repo-shape test that does not exist** | **AUTO**, [manual testing §5](05-manual-testing.md) — for the second clause, which is the existing `modes → sdk, shared` policy plus one fixture. **The first clause has no mechanism at all**: nothing notices `packages/server/src/modes/` returning, and §0 and §5 both call that the phase's deliverable. Write it, in the `ci-shape.test.ts` manner, or the negative demo is unenforced |
| **2a** Freeform played end to end through the contract | **a person** | **critical — C2.** (i) ✓ P7.9's own claim; (ii) ✓ the contract is what P8–P11 build through; (iii) ✓ and it *became* walkable at P6B.0 |
| **2b** The engine contains no `switch (mode)` | **a lint rule with fixtures**, plus a tracked-file survey | **AUTO** — and note it **passes today**, before the phase starts, so as written it cannot falsify anything. It is a *regression guard*, and too narrow: [06 §2](../06-modes-and-turn-pipeline.md) says the host never has one, which also fails as an `if`, a mode-keyed lookup, or a mode id spelled in engine code. The last of those is the shape that matters, and there is **one violation in the tree today** — `sessions/channels.ts:69`'s `owner: 'storyengine.scene'`, a literal deliberately, to dodge the `const` cycle §0.1a wants dissolved. A correct rule fires on it, which is the right answer |
| **3** A mode's channel: in the registry, enforced, rendered, reconstructing | **tests**, with the fourth clause folded into the P6 property fixture | **AUTO** — registry membership and `update` enforcement are unit tests; reconstruction-at-a-node is already carried by `sessions/reconstruct-property.test.ts` and needs a mode-declared channel added to its fixture. The *renders* clause is the weak form of step 9 and should be merged there rather than walked twice |
| **4** A hook fires, the record says why, held ≠ judged-none | **a test** for the four states; **a person** for whether the line explains anything | **AUTO** for the record half — drive the selector into pacing-held, nothing-eligible, judged-none and fired, assert four distinguishable lines. **Standing** for the reading half: [work plan P11](01-work-plan.md) owns selector legibility as tuning, so clause (ii) has nothing to say |
| **5** Commit, rewind past it, uncommitted | **a property test** — the [testing §1](03-testing.md) row, which the step already says | **AUTO**, and it should not reach a walk sheet. Cheapest of the four hook rows: P6 property-tested the fold that answers it, so it is satisfiable the day the channel is declared |
| **6** A goal completes, three offers, *Advance*, readable after *End* | **a test** for the mechanics; **a person** for the moment | **AUTO** for the mechanics — completed goal retained with its turn, *Advance* writing the next, branchable after *End*. **Standing** for the rest: [25 C12](../25-open-questions.md) says the confirmation question *"wants real sessions to judge"*, and a judgement at the most dramatically loaded moment is as answerable in November |
| **7** Dead on one branch, alive on the other, in the panel | **nothing here** | **Standing** — and it fails clause **(i)** outright. [P6 §3](18-p6-implementation.md)'s step 5 is the same check, *covered at P6.3*, through the replay and through the head. What is new is only *"with no special case in the panel's code"*, which is a component test and a code read |
| **8** Mentions highlight what the scanner matched; unresolved offers | **tests** | **AUTO** — both clauses are assertions: highlight set equals match set over one text, and an unresolved name produces an offer and writes no actor. **But the clause that actually compounds is not in the gate**: §1.7's *the type must not carry an actor reference in its name or its shape*, which [13 §13](../13-write-mode.md) prices at migrating every stored turn or growing a second span type. That is a code-shape check and wants its own step |
| **9a** A wizard for a mode the engine has no knowledge of | **a person** | **critical — C3.** (i) ✓ §5 calls it the contract's hardest single claim; (ii) ✓ `SetupSchema` ships with the SDK and every extension author afterwards discovers it wrong; (iii) ✓ a throwaway declaration and a browser |
| **9b** A failed part retried without discarding the parts that succeeded | **a test against the fake provider** | **AUTO** — this is [00 §2.3](../00-stance.md)'s *8 of 10 valid sections applies 8 and re-asks for 2*, and it is what a scripted provider is for |
| **10** Author a small mode against the SDK with no access to `server` | **a person** | **critical — C1, and the anchor.** *"This is the phase's actual claim and no assertion covers it."* [Manual testing §0](05-manual-testing.md) names this document's copy of the phrase as what the mechanical intake greps for |
| **The standing line** — no configuration without a surface | **a checklist**, and it needs rows | **critical in part.** §0.1a discharges one instance (`maxContextTokens`) and finds four live ones: the input-kind selector, `SlotSource.outlet`, the five per-book knobs, and every channel this phase declares |

**The critical list, derived rather than preferred — three items, a sitting or
two.** C1: author a small mode against the SDK with no access to `server`. C2:
Freeform played end to end through the contract. C3: a setup wizard for a mode
the engine has no knowledge of, rendered from its declaration alone. Everything
else is automatable or standing, and each automatable row owes
[manual testing §5](05-manual-testing.md) a named test when it lands.

**What this list cannot reach, and it is not a footnote.** All three criticals are
*one-sitting* checks against things the walker builds — a mode they wrote, a
wizard they declared, a Freeform session they set up. **The contract's hardest
failure mode is not visible to an author who knows what the contract permits**,
because they will not try what they know is unavailable. [Triage §6.3](02-triage.md)
already states the sharper version of C1 and this gate does not use it: *"if a
motivated person cannot build UNO against the extension API without engine
changes, [06 §9] has failed"* — a channel holding board state, a step validating
moves, a declared widget. That is three named parts and an adversarial subject,
and it is what C1 should be. **And nothing on this list is a second person**, so
*would a stranger's mode work* stays unanswered by construction — which is the
price of closing this phase in a month, written here rather than discovered later.

---

## 4. Out of scope, deliberately

The authored-rule vocabulary and its evaluator (6.0, the authoring tier — [work plan §0.6](01-work-plan.md)
— and the tempting move once steps exist is to let `StepCondition` take rule
predicates, which [06 §6](../06-modes-and-turn-pipeline.md) warns against by
name); Campaign and Messages ([work plan §5](01-work-plan.md) — committed, not
speculative); engine-computed combat; mechanical goal completion, which needs
the vocabulary; extension *installation* and its panel (P10 — the manifest and
lifecycle are specified at [22 §6–§7](../22-extensions.md) and nothing installs);
custom extension rendering ([10 §8.1](../10-ui-surfaces.md), deferred as far as
it will go); cross-branch merge ([25 C10](../25-open-questions.md)); the hook
selector's **tuning** — what four pacing levels resolve to, how a judgement
prompt is worded — which [work plan P11](01-work-plan.md) owns and which can only be
done by playing.

***And two things [work plan P11](01-work-plan.md) puts in that list that are in
this phase, recorded 2026-09-10 rather than left for a reader to trip over.*** Its
tuning list also names *"how long a commitment should wait"* and *"the hook panel
([10 §10.1](../10-ui-surfaces.md)) that makes a large pool authorable"* —
and **P7.5 builds both**: Commit's patience is *"three turns… a constant rather
than a setting"* by [06 §6.1](../06-modes-and-turn-pipeline.md), which is a
decision rather than a dial, and the panel is in P7.5's stage text by name. Two
documents own one panel and neither said so. 06 §6.1 and this document agree; work
plan P11 is the outlier, and the disagreement belongs on the record rather than in
whoever finds it.

**And one thing that is not out of scope but reads like it:** the assistant's
mode definition, §1.8. It is listed here so that leaving it in P11 is a decision
rather than an omission. *Since it was written, [P9](25-p9-implementation.md) has
volunteered a **fourth** witness of its own — a rendition step, added by a phase
that is not about modes, which is the variety §1.8 says the phase lacks and gets
for free two phases later rather than never. It does not answer §1.8's question,
because finding the contract wrong in P9 is still finding it wrong after this
phase built on it; it does change the price of answering **no**.*

---

## 5. The honest size, and what only the revisit can settle

*Added 2026-08-31. §0 says this document is not a plan; this section says what a
plan would have to price, so the revisit starts from an estimate rather than
from a blank page.*

**P7.0 is the phase, and the other nine stages are its consumers.** That reads
backwards — nine stages of features against one of plumbing — and it is the
single most useful thing to hold onto here. The boundary either holds or is
revealed as wrong ([work plan P7](01-work-plan.md)), and every stage after P7.0 is a
test of it disguised as a feature. Pricing this phase as *ten stages* invites
building the features and discovering the contract at the end, which is the
failure [06 §2](../06-modes-and-turn-pipeline.md)'s standing rule — *if a
built-in mode needs a back door, stop and fix the contract* — exists to catch.

**The negative half of the demo is the deliverable.** `packages/server/src/modes/`
being empty, with the build failing if anything puts it back, is worth more than
any of the panels: it is the only check that cannot be satisfied by a mode that
works. A plan that cuts under pressure should cut a panel and never that.

**What is genuinely large, in order:**

1. **Hooks** (P7.5) — the pool, the selector, and three companions, plus the two
   identity obligations [15 §5](../15-world.md) makes unrecoverable if missed.
   Four property rows are already written against it in
   [testing §1](03-testing.md), which is the strongest signal in this document
   that somebody thought the obvious implementation would be wrong.
2. **Setup objects and the declarative wizard** (P7.4) — a form nobody wrote,
   generated from a declaration, is the contract's hardest single claim.
   *Re-priced upward 2026-09-10: it starts from zero. The client renders schemas
   read-only and writes them with hand-written JSX everywhere, no route hands a
   declaration to the client, and the incremental half needs structured output
   built end to end first. Largest single piece of new UI in the phase.*
3. **Channels as a general mechanism** (P7.1) — ~~the narrowest, because P2 and P5
   already use them and `readClock` is a worked example~~. *Re-priced 2026-09-10,
   and the citation carried the wrong weight. What P2 and P5 built is the effect
   **plumbing** — apply, replay, key, refuse — and that half is genuinely solid
   and property-tested; `readClock` is a worked example of the half already done.
   What P7.1 owes is the **declaration** half, and none of it exists: not the
   type's four missing fields, not `InitPolicy`, not a validator, not a
   channel-to-text renderer, not 06 §4.2's error surface. Still narrower than
   P7.5 and P7.4; not narrow.*

**What is smaller than it looks:** party, presence and status (P7.2) are
channels once P7.1 exists, and §1.6 has already done the design work of turning
~~`cast` from a field into one~~ *`cast.actors` from a field into one — the
persona stays a field, and the licence for the rest belongs to P7.3.* ~~Mention
resolution (P7.7) is an `extract` step whose span type is already named against
the trap in §1.7.~~ *P7.7 is **not** smaller than it looks: the scanner it shares
carries no offsets, and three functions in `packages/shared` already return an
untagged span the tagged type has to absorb rather than sit beside (§1.7).*

**Three things only the revisit can settle**, and they are why §0 calls this a
skeleton. *All three are settled or reduced as of §0.1a, 2026-09-10:*

- **Whether the worker hop lands here** (§1.3). ~~A performance question with no
  measurements yet, and PLAYABLE plus P5's retriever are what produce them.~~
  *P5's retriever exists now and draws inside a step, which §0.1 argues is an
  argument for the hop rather than against it — the measurements still wait on
  PLAYABLE.* ***Re-framed 2026-09-10: it is not a performance question, and §1.3
  never argued it as one — §5 mis-described §1.3 when this bullet was written.
  What is actually open is (a) whether `RandomApi` keys its draws, which is the
  conversion's input, and (b) whether async draws break the tape's call-order
  index under replay. Both are answerable at a desk, today, without PLAYABLE.
  The conversion happens either way, because the package split forces it.***
- **Whether two modes is enough of a test** (§1.8). The document already
  suspects not and names the assistant as the available third — but the
  assistant is P11's, so the honest options are *accept a weaker test at P7* or
  *move something*. Deciding that late is how a contract ships untested.
  *Reduced 2026-09-10: P9's rendition step is a fourth witness volunteered by a
  phase that is not about modes (§4), and [triage §6.3](02-triage.md)'s UNO test
  is a sharper version of gate step 10 than the gate uses (§3.1). Neither answers
  the question; both make **no** cheaper than it was.*
- **What PLAYABLE and P2C did to the record.** ~~P7 follows PLAYABLE by three
  phases~~ *P7 follows PLAYABLE by **one stage**, in the phase immediately before
  it*, and whatever the record turns out to have got wrong lands in the
  middle of this phase's channel and effect work — *specifically P7.1's, and
  P7.9's for a different reason: `SCENE_PRESET` is what
  [sitting K](05-manual-testing.md)'s K4 exists to interrogate, and P6B.1 already
  moved it once.* The revisit's first job is to
  re-read [P2C log](14-p2c-log.md) rather than this document — *and §0.1a did,
  which is how it found that two of the three items P2C routed here were already
  done.* ~~*Still the wait, and now the only one: three of the four phases between
  the draft and here have landed, and PLAYABLE has not run. §0.1 names the one
  small thing standing in its way — no surface, anywhere, chooses a session's
  lorebooks.*~~ ***Struck 2026-09-10: the obstacle was repaired at P6B.0 and
  PLAYABLE now waits on nothing but a person. §0.2 says which stages wait with it
  and which do not — and P7.0 does not.***

**What would make this a plan rather than a skeleton**, struck as it lands:

- ~~A readiness audit run against the code~~ — §0.1, and §0.1a when it expired.
- ~~A blocking box saying what must be true before the phase opens, and what need
  not be~~ — §0.2.
- ~~An exit gate under the two-tier model, with cells to write in~~ — §3.1.
- ~~Per-stage end conditions and the ordering dependencies between stages~~ — §2.
- **The deferrals in §0.1a's list placed into stages rather than listed.** Twenty-four
  of them are collected and not yet scheduled; collection is §0's first job and
  placement is §1's and §2's, and §0.1 diagnosed that failure while reproducing it.
- **A proof obligation named per stage** — which test closes it, in the
  `routes/pN-gate*.test.ts` convention every earlier phase used. §3.1 names the
  automatable rows; the stages do not yet name their tests.
- **The pre-work in §0.2's cold list actually done**, which is a morning and
  removes six things a stage would otherwise stop to argue about.
