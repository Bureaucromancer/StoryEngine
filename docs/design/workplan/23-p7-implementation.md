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
   (`eslint.rules.js:392-398`). Silent, and it disables the very rule this stage
   exists to acquire.
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
a nested path is six edits across five files, two of which fail quietly.

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

1. **The four retired-sentence homes and the `[19 §11]` citation** — 22 §4,
   ~~`turns/steps.ts:128`, `turns/steps.test.ts:220-221`~~ **(both corrected at
   P7.0, in the commits that changed the thing they were wrong about)**, and
   §P7.0's own cell. **22 §4 now owes three corrections rather than one**: the
   retired sentence, `blocks` → `Candidate`, and the full effect →
   `EffectProposal` (§1.2), plus the `[19 §11]` citation, which points at *Dev
   mode* where it means randomness at 19 §14.
2. **06 §9 against 22 §4.0** on whether a worker enforces recorded randomness.
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
4. **19 §10's tree**, which still draws `modes/adventure`.
5. **A cast the browser can set.** `PUT /api/sessions/:id/cast` and
   `POST /api/sessions`'s `cast` field both accept one and **neither has a caller
   in `packages/client`** — the identical shape of gap P6B.0 just closed for
   lore, still open beside it. It is the standing line again, and it is a
   prerequisite for this phase's own demo rather than a nicety: P7.2's gate step
   wants a character dead on one branch and alive on the other *in the panel*, and
   a session made in a browser has no cast for the panel to be about. `pnpm seed`
   sets one; a person cannot.
6. **`ChannelEffect.op`'s unimplemented arms** — decided before P7.2 designs the
   party timeline's payload, per that stage.
7. **03 §8's `MentionSpan`**, which is §1.7's forbidden shape written into the
   data model (§1.7).
8. ~~**`divergenceEffects`' scoped-channel defect.**~~ **Done 2026-09-10.** By the
   bar [P6B §0.3](20-p6b-playable.md) and [P2C §1](12-p2c-first-real-run.md) set —
   an item is pre-work only if leaving it undone makes the phase's own work
   untrustworthy, not merely if it would be convenient — it **qualified**: a live
   defect in the exact function P7.1 rewrites, under a type P7.1 is
   simultaneously growing `schema`, `init` and `migrate` on, and after P7.1 every
   mode-declared scoped channel is on the same path. §0.1a records what landed.
9. **Repointing the ten server test files that use the mode's internals as generic
   fixtures.** After the move these are server → modes imports, which the graph
   forbids. Doing it inside P7.0 buries a large mechanical diff inside the stage
   whose falsification test is *"no diff outside imports"*; doing it first is pure
   preparation and reviewable on its own.
10. **The strengthening or retiring of `steps.test.ts:212-224`**, which asserts
    nothing about clonability — it compares `Object.keys` on a hand-built literal
    whose `rng` is `{}` — while stating two things that are false. §1.3 leans on
    it as evidence about the seam.

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
that a nested package does not match and that fail quietly, `Dockerfile:76`'s
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

**The `structuredClone` assertions assert less than this leans on.** The
`StepInput` case clones a fixture with `history: []` and no `output`, so neither
of those arms is exercised; the `StepResult` case pins a hand-written object
literal with **no type annotation and no `satisfies`**, so a non-clonable member
added to `StepResult` tomorrow leaves the test green. And the third test in that
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

**And the two documents this section cites in one breath disagree about
randomness.** [06 §9](../06-modes-and-turn-pipeline.md) still promises a worker
prevents reaching an unrecorded random source; [22 §4.0](../22-extensions.md)
retracts that phrasing by name. Which is right decides whether the hop *enforces*
recorded randomness or merely relocates it — i.e. what this conversion is buying.
A doc edit, in §0.2's cold list.

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
is the scene's actor list, which is presence-shaped, and which is what the cast
panel will read. **And the field's licence belongs to P7.3, not P7.2.**
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
obligation.*

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

***And the shape §1.7 forbids is already written down, in the document an
implementer follows.*** [03 §8](../03-data-model.md) specifies the turn record's
overlay as `mentions: MentionSpan[]`, and `MentionSpan` is
`{ field, start, end, ref: Ref<Actor>, method: "explicit" | "matched" |
"proposed", confidence }` — **named for mentions, with an actor reference baked
into the shape, and a method union that only mentions can use.** That is this
section's failure case, verbatim, in the data model. Implementing 03 §8 faithfully
produces exactly what §1.7 exists to prevent, and neither document notices the
other. *Three documents now give three shapes: 03 §8 has `field`, 06 §8.2 does
not, and this section says only what the type must not be.* **Reconciling them is
a morning and it has to happen before the first span is stored** — 03 §8 is the
one to correct, because it is the one somebody reads while writing the record.

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
a route that does not exist (`PATCH /sessions/:id` accepts only `name`). The
**step** override has no analogous home and never will — it is per-step, so its
surface is the mode or preset declaration, not a panel. That distinction is what
*"named as debt with an owner"* should record.

**A surface routed here that this section has never read.**
[R2 / F-01](21-playable-log.md) is routed to *"P7 §1.9"* by two documents, and the
real blocker behind *use a second model* is a **role-binding editor** —
[10 §15.1](../10-ui-surfaces.md)'s user half — which is a different surface from
the override layers this section is about. Both belong to P7.3; only one of them
is in it.

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

**Next:** the tooling and the move, then the repo-shape check. §0.2 says which of
these wait on PLAYABLE — none of them do.

`packages/modes/scene` created and populated by moving, not rewriting; `sdk`
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
The second half has no mechanism today: the eslint policy governs what
`packages/modes/*` may import and nothing at all notices the directory
reappearing, while §0 and §5 both call that the phase's deliverable. It is a
repo-shape assertion in the `tools/lint-fixtures/ci-shape.test.ts` manner, and
until it is written the negative half of the demo is unenforced.

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
And **`06 §4`'s `ChannelDefinition` sketch disagrees with 21 §1.3's** — 06 lacks
`version` and `visibility` and names an `UpdatePolicy` alias that does not exist —
so the phase that publishes the type through the SDK has to pick, and picking
after it ships means a published contract disagreeing with its own design note.

*Note that `visibility` is **already on the built type** and needs no migration;
what is unbuilt is the reveal affordance, which has a second consumer waiting —
`Goal.visibility` is documented as "the same mechanism as a hidden channel, so
the reveal affordance and the budgeting are shared rather than reinvented". Build
it channel-shaped only and P7.6 reinvents it.*

*Ends at:* a mode-declared channel with `update: "user-only"` refused correctly
when something else proposes to it, rendered from its declaration, and
reconstructing at an old node in the P6 property test's fixture.

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
`append` first. **Decide before the payload is designed**, not inside the stage.

*And `scope: 'actor'` has never had a writer: the scoped-key machinery
P5.5 built and P6 property-tested is proved by `scope: 'entry'` alone. Presence
and status are the first actor-scoped channels, so this stage is where that arm
stops being a declaration.*

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
not `fixed` running without the session's `cast` field.

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
