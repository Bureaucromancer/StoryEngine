# 26 — P9 implementation plan

**Status: ~~skeleton~~ ~~a plan, audited 2026-09-15 at `2fb75e5`~~ ~~built out
against the tree, re-audited 2026-09-16 at `bf88153` — and deliberately not
opened~~ ~~built, 2026-09-16, on branch `p9`~~ merged into `main` 2026-09-16 at
`f51ad46`, and open.** All six stages landed (`fae4de7`, `bf27efa`, `18b5b8f`,
`5819843`, `49f43c2`, `041882e`), each with a *Done* block in §2 naming its
commit, and §3.2 records thirteen of the gate's fifteen rows discharged by test.

**The merge is not the close** —
[manual testing §7](05-manual-testing.md) says a phase closes when its critical
list is **walked**, and P9's was never walked at all. C1 and C2 both need an
endpoint that serves the `image` role, which is
[R10](05-manual-testing.md) and is not to hand — so they are carried as
**sitting O** and this phase stays open behind them. *A block is an errand, not
a judgement*, and the errand is one endpoint.

*`main` as it stood immediately before the merge is `c9336b0`*, which is the
merge commit's own first parent ~~and is also where the `p8` branch points~~
(***corrected 2026-10-01***: merged branches are closed rather than kept) — so
the tree without any of this is one checkout away and needed no marker of its
own.

Drafted 2026-08-29 alongside [P7](23-p7-implementation.md),
[P8](25-p8-implementation.md), [P10](27-p10-implementation.md) and
[P11](28-p11-implementation.md). [P7 §0](23-p7-implementation.md) says what a
skeleton this far out is for. §0.1 is the readiness audit that turns this one
into a plan, §0.2 separates what blocks the phase from what merely has not
happened, **§0.3 is the build-out** — §0.1's audit re-run after
[P8](25-p8-implementation.md) landed a phase on this tree — §2's stages gain
dependencies and proof obligations, and §3 is split under
[manual testing §0](05-manual-testing.md)'s two-tier gate.

***What the build-out found, in one line: nothing this phase depends on has
moved, four things it was going to build now exist, and one of its own proof
obligations would fail a rule P8 wrote.*** All ten of §0.1's findings still hold
at the paths they were checked at. What P8 added is a length-prefixed content
digest, a lazy derive-what-is-missing chain with a call counter on it, a
`resolveStepRole` that answers *which model* **before** the call, and a fourth
worked example of the engine applying an effect a step may not propose — which
are §1.7's reuse key, P9.3's dispatch assertion, P9.1's replayed moment and
§1.7's `engine-computed` route, in that order. What it also wrote is *"a path
helper that survives the phase without a caller is the same defect twice"*, and
P9.0's exit condition as drafted adds one.

***The audit's headline: this phase is startable, and it is not waiting on
[P8](25-p8-implementation.md).*** §0 names P6, P7 and P10 as the phases it
depends on and names P8 nowhere; the one place the two touch is the step payload,
and §0.1's finding 10 is that the shape P9 wants is already in the contract and
already narrow. **The second headline is that more of this phase is built than it
knows**: the ranked-fragment capper §1.7 and P9.1 both lean on is written,
tested, and called by nothing.

**What is *not* settled and is written as unsettled**: §1.2's provider question,
which wants one real image endpoint in hand rather than another paragraph — see
§0.2. Format follows [P1](07-p1-implementation.md); citation convention as
[P4](16-p4-implementation.md)'s.

**P9 delivers**, from [work plan P9](01-work-plan.md): per-turn and on-demand
illustration ([06 §10](../06-modes-and-turn-pipeline.md)), built against the
general **rendition** shape so that video and speech are later *kinds* rather
than later subsystems — **and the backdrop a scene is staged against**, which is
the same shape under a second *purpose*
([06 §10.1a](../06-modes-and-turn-pipeline.md), §1.7).

**The demo that defines done:** *a turn completes on text and an image arrives
seconds later, rendering in place; illustrate a turn from forty turns back and
get a second rendition beside the first, not instead of it; delete the pixels of
both and re-create either from its recipe; walk into a new place and the backdrop
follows, walk back and the first one returns without being paid for twice, and
rewind past the doorway and it is behind you again.*

**The shortest phase in the plan, and the one with the most surprising first
stage.** Two things it does not have to build are already settled and already
paid for: renditions never block the turn, so a failed image is a placeholder
with a retry button rather than a failed turn
([06 §10.2](../06-modes-and-turn-pipeline.md)); and a rendition is **not** a
channel effect, so it does not participate in state
reconstruction — a branch inherits a turn's renditions by inheriting the turn
([07 §2](../07-branching.md)). What it does have to build first is a contract that
does not exist (§1.1).

**CI this phase establishes:** golden-file coverage of prompt assembly under the
provider's declared cap — the ranked-fragment path from
[20 §5.3](../20-tech-stack.md) getting its second consumer and its first one with
a hard external limit — plus the recipe-survives-eviction property: *for any
rendition, dropping `asset` and re-running from `prompt` and `provenance`
produces a request byte-identical to the original's.* The backdrop's reuse key
is the same property read from the other side (§1.7), so it is one assertion
rather than a second harness: *equal recipes hash equal, and a place already
rendered dispatches no job.*

**That property is now load-bearing in a way it was not when it was written**,
because one fragment of the prompt is written by a model
([06 §10.3](../06-modes-and-turn-pipeline.md)). Byte-identical re-runs and equal
digests both survive only if the moment is stored and **replayed** rather than
asked for a second time, so the assertion has to be run against an implementation
that makes no text call on re-creation. Written the natural way it regenerates,
the golden files pass anyway on the day, and the digest quietly stops matching
itself a month later. P9.1 says it again where the code is.

***And the harness for it exists, on another subject*** (2026-09-16, §0.3's item
3). `packages/server/src/sessions/summary-chain-property.test.ts` is
[P8](25-p8-implementation.md)'s version of the same assertion: generated shapes
under fast-check, plus one on-disk tree where deleting the derived files and
re-deriving is asserted to produce **byte-identical** output rather than
equivalent output. *Drop `asset` and re-run from `prompt` and `provenance`* is
that test with a different noun, so what this phase writes is a second instance
of a pattern rather than a first.

---

## 0. What this document is, six phases out

[P7 §0](23-p7-implementation.md) states the shared answer. Two things are
specific to this one, and both are about a phase whose subject does not exist
yet in any form.

**§1.1's claim was re-checked on 2026-08-31 and still holds:** `Rendition` is
specified in [06 §10](../06-modes-and-turn-pipeline.md) and appears in **no
schema** — the name is absent from `packages/shared/src` entirely. So this
phase is not extending a type, it is introducing one, and §1.1 is the decision
that matters most in the document. Everything after it is a consumer.

**It is the phase most dependent on other phases having gone well**, which is
unusual for something this late and worth naming:

- **P6 owes it reconstruction-at-a-node.** §1.3 — old turns rendered against
  *recorded* state rather than present state — is only answerable because P6
  makes *that turn's state* a thing you can ask for.
  [P6 §0](18-p6-implementation.md) now records the dependency from its end.
- **P10 owes it a router.** §1.5 is explicit that `artifact.ready` has a
  producer here and a consumer two phases later, which means this phase ships a
  signal nobody listens to and has to say so rather than quietly not emitting
  it.
- **P7 owes it a step that can be added without a back door.** A rendition step
  is the mode contract's fourth witness, after Scene, Freeform and the
  assistant, and the first one added by a phase that is not about modes.
- **P7 also owes it a channel value it can write.** §1.7 — the backdrop
  channel P7 declares must hold a media reference able to name a rendition's
  asset, not only an uploaded file. Free there, a migration here.
  [P7.9](23-p7-implementation.md) records it from its end. ***Paid in full, and
  then some*** — §0.1's finding 7.

---

### 0.1 Readiness — audited 2026-09-15 at `2fb75e5`

*[P7 §0.1a](23-p7-implementation.md) and [P8 §0.1](25-p8-implementation.md)'s
shape: checked against files rather than against prose, with a path on each so
the next reader can see whether it has moved. It found the same two classes those
did — **a thing this phase assumed it would build that is already built**, and
**a sentence that is true of the design and false of the code**.*

#### What still holds

1. **`Rendition` is in no schema.** The name appears nowhere in
   `packages/shared/src`, which is §1.1's whole premise and the reason P9.0 is a
   contract rather than a feature. *It does now appear in
   `packages/sdk/src/media.ts` as `renditionId` — a **published** type referring
   to a type that does not exist, which sharpens §1.1 rather than softening it.*
2. **The provider layer speaks chat, exactly as §1.2 describes it.**
   `providers/types.ts`'s `Provider` is `{ kind, capabilities, generate, stream? }`
   and `stream` is documented as streaming *text*. Nothing has moved.
3. **`GeneratedFieldProvenance` cannot carry the recipe**, verbatim as §1.1
   found it: `schema/common.ts` documents `seed` as *"The input the generation
   ran from"*, types it `string | null`, and **has no field for workflow
   parameters at all**. §1.1's warning — that an implementation would satisfy
   the type, pass review, and ship an unreproducible rendition — is intact.
4. **The role vocabulary is ready and both roles this phase needs are in it.**
   `MODEL_ROLES` carries `image` **and** `fast`, so the moment call (P9.1) and
   the renderer bind through the same machinery as everything else.
5. **Nothing routes a notification, and nothing pretends to.** There is no
   notification class, inbox or `{ key, params }` summary anywhere;
   `state/events.ts`'s `ProgressEvent` is the *progress* union and its docstring
   says in as many words that progress events *"need no `{key, params}` summary
   the way a **notification** does"*. §1.5 stands untouched: a producer here, a
   router at [P10](27-p10-implementation.md).

#### What audits differently — five findings

6. ***The ranked-fragment capper is already written, already tested, and called
   by nothing.*** `providers/prompt-caps.ts` is 156 lines of exactly this
   phase's work: `PromptFragment` with a `rank`, `budgetFor`, `capPrompt`, and a
   `CappedPrompt` carrying `kept`, `dropped` with a per-fragment
   `over-hard-cap | over-useful-cap` reason, `overCap` and the `budget` aimed
   at. Its docstring is about **image prompts** and CLIP's 77-token window, and
   it states the property P9.1 was going to have to argue for: *"the cap is an
   input to generation, not a guillotine at send."* `prompt-caps.test.ts` covers
   it. **The only thing missing is a caller** — `grep` finds none outside the
   test.

   *So P9.1's prompt assembly is a call site rather than a build*, and the
   header's *"work that was specified for exactly this case and has had no
   consumer until now"* understates it: the specification was implemented too.
   **It is a `memoriesRoot` in miniature** — a module written in anticipation of
   a phase with nothing calling it, which is the class
   [P7B §0.5](24-p7b-presets-and-prompts.md) is about and which
   [that phase's route-caller check](24-p7b-presets-and-prompts.md) cannot see,
   because this is not a route.
7. ***What P9 owes P7 is paid, and a policy decision was made in P9's favour
   while it was.*** §1.7's obligation was one sentence: the backdrop channel's
   value must be able to name a rendition's asset from the declaration onward.
   `packages/sdk/src/media.ts` ships `MediaSelection` with
   `{ from: 'rendition'; renditionId }` **declared and dead on arrival by
   design** — its docstring says so — and `modes/scene/src/mode.ts`'s
   `BACKDROP_CHANNEL` declares `update: 'engine-computed'` with the argument
   written out: a person may pick a backdrop, a model may not, *"and P9's
   generator writes it through the engine rather than out of its step"*.
   **P9 never asked for that third clause and it is the one that decides how
   this phase writes the channel.** §1.7's *what P9 owes P7* section is now a
   record of a discharged debt rather than an obligation.
8. ***`sessions/<id>/assets/` is in the design's tree and in none of the code.***
   §1.1 says it *"exists in the layout with nothing writing to it"*. Half right:
   [03 §5](../03-data-model.md)'s tree draws it, and `storage/layout.ts` has
   **no accessor for it** — fifteen methods, and the only `assetsRoot` is
   object-scoped, `(owner, schemaId, slug)`. ~~So P9.0 adds the accessor rather
   than starting to write to one that is waiting.~~ Small, and it is the
   difference between *a path exists* and *a path is drawn in a document*.

   ***Corrected 2026-09-16 at [P9.0](#p90--the-contract): the conclusion was
   wrong and the observation was right.*** `Layout` was never how a session
   subdirectory is added — `snapshots.ts` and `summaries.ts` both derive their
   own with `resolveWithin(layout.sessionRoot(…), '<dir>')` and add no method,
   and every one of the seventeen is account- or install-scoped. So P9 adds
   **no accessor at all**: the finding's real content is that a path drawn in a
   document is enforced by nobody, and the remedy is code that uses it, not a
   method that names it. §0.3's item 1, which is written about this conclusion,
   is right about the rule and moot about the fork.
9. ***§5's "P9.2 is smaller than it looks" is wrong, and in the expensive
   direction.*** That section says jobs *"reuse the operational store's job
   vocabulary, which has existed since P2 and by then will have carried imports
   as well as turns."* Neither half survives: `state/jobs.ts`'s `Job` is
   **turn-shaped** — `parentTurnId`, `turnId`, `commitStep` — and exists to
   enforce [P2 §2.10](08-p2-implementation.md)'s *only one turn may advance a
   session*; and imports never used it, because `import/jobs.ts` is a review-report
   store written after a synchronous sweep, not a queue.

   **The invariant that vocabulary exists to enforce is the one renditions must
   not inherit.** Several may be in flight for one session, none may block the
   turn, and none advances the head. So P9.2 is a **second job shape** beside
   the first rather than a reuse of it — which is still small, and is not what
   the document currently claims.
10. ***The step payload P9.1 wants already exists, and is already narrow.***
    `sdk/src/steps.ts` carries `output?: { text: string }`, *"present only when
    `reads` includes `output`"*, beside `history?: readonly Turn[]`. The moment
    call declares `reads: ['output']` and is handed **the finished text and
    nothing else**.

    ***This is the finding that settles where P9 sits relative to
    [P8](25-p8-implementation.md)***, and §0.2 draws the conclusion. P8 §1.5's
    whole difficulty is that `history` hands a step entire `Turn` records —
    *"a hook's premise, a chosen entrance's finished prose and a hidden
    channel's rendered value are all inside the record the extractor is handed,
    verbatim"* — and P8.1 owes a third pseudo-source to fix it. **`output` is
    already that shape**: P9's step needs none of P8's work, and is a worked
    example of the narrowing P8 is going to argue for.

### 0.2 What must be true before the phase opens — and what need not be

*[P7 §0.2](23-p7-implementation.md) and [P8 §0.2](25-p8-implementation.md)'s
shape, and the point is the same: a plan that lists every unfinished thing as a
blocker is a plan that never starts.*

***P8 is not a dependency, and the phase numbering is the only thing that
suggests it is.*** §0 above names P6, P7 and P10 and names P8 nowhere; §1.1
through §1.7 do not mention it; §4 and §5 do not. The one place the two phases
could touch is the step payload, and finding 10 is that the narrow shape P9.1
wants shipped with the contract at P7. **So P9 can open on the day P8 opens, or
before it, or instead of it** — and that is worth knowing precisely because §5's
hardest question is whether renditions are worth 1.0 at all. *An ordering that
is free should not be mistaken for an argument.*

**P9.0 is blocked by nothing**, and for the reason P8.0 is: it is a type, a path
and a record. Everything in §1.1 is decidable at a desk, §0.1's findings 3 and 8
are the two corrections it has to make, and the stage ends with a rendition that
can be written and read with no provider behind it at all.

**What genuinely blocks, and it blocks P9.1 onward rather than the phase.**
[Manual testing §3](05-manual-testing.md) has ~~nine~~ ***ten*** standing
prerequisites and **none of them was an endpoint that serves the `image` role.**
Twelve of §3's fifteen steps want pixels, §1.2's provider question is the phase's
one real question and wants one real endpoint rather than another paragraph, and
R2 — *a hosted endpoint with a real key* — is a **chat** endpoint. That is a
lead-time item in §3's own sense: *not arranged before the day.* ~~**This phase
owes that file an R-row before it owes it anything else**~~, and §3.1 below is
written against it.

***Paid the same day, and the tenth row is it*** (2026-09-16, §0.3's item 6).
**R10** — *an endpoint that serves the `image` role, with a key* — is in §3's
table, cited from §6's P9 row, and says in its own cell that **both of this
phase's criticals are blocked on it and nothing else**. So the count above is
corrected rather than struck: the file has ten prerequisites because this
document's audit added the tenth. **The errand is unchanged and is now
addressed to somebody**, which is the whole distinction this section draws — *a
deferral is a judgement and a block is an errand*, and an errand nobody has
written down is neither.

**What does *not* block, stated so it is not treated as if it did.** The count
judgement and its two dials (§4) — deferred, unowned, and deliberately not this
phase's, with the three things P9 must not foreclose already named. An eviction
*policy* (§1.4) — the hook ships, the policy does not. What a rendition costs a
person (§5) — a real gap, and one no amount of planning closes. And
[P10](27-p10-implementation.md)'s router (§1.5), which is the whole reason this
phase emits an event nothing listens to and says so.

### 0.3 Ready to build out — re-audited 2026-09-16 at `bf88153`

*§0.1 ran at `2fb75e5`, **before [P8](25-p8-implementation.md) was built**.
Fourteen commits, three merges and a whole phase have landed since, so the audit
is run again rather than assumed — [P8 §0.3](25-p8-implementation.md)'s discipline,
returned to the document it was borrowed from. §0.2's headline survives the
re-run **and acquires a proof it could not have had**: P8 opened, built and
merged without one sentence of this plan moving on its account, which is a
stronger claim than reading §0's dependency list could ever produce.*

#### What still holds — all ten of §0.1's findings, with the paths they were re-checked at

**Line by line, and not one has moved.** `Rendition` is in no schema: the name
occurs twice in `packages/shared/src` and **both are prose**
(`schema/common.ts:362`, `schema/media.test.ts:135`), which is finding 1 in a
sharper form for the second time — the shared package now *cites*
`Rendition.purpose` in a docstring as *"the other half of the same pair"* and
declares the type nowhere. `Provider` is still
`{ kind, capabilities, generate, stream? }` (`providers/types.ts:171`).
`GeneratedFieldProvenance` still types `seed` as `string | null` documented *"the
input the generation ran from"*, with no field for workflow parameters
(`schema/common.ts:136`). `MODEL_ROLES` still carries `image` **and** `fast`
(`shared/src/turn.ts:47`). Nothing routes a notification — `artifact.ready`
appears in no package, and `state/events.ts` still says progress events *"need no
`{key, params}` summary the way a **notification** does"*. `MediaSelection`'s
`{ from: 'rendition' }` arm is still dead on arrival by design and
`BACKDROP_CHANNEL` is still `update: 'engine-computed'`. `state/jobs.ts`'s `Job`
is still turn-shaped and `import/jobs.ts` is still a review-report store.
`StepInput.output` is still `{ text: string }` gated on `reads`.

***And `providers/prompt-caps.ts` has now survived a second phase with no
caller.*** 156 lines and its test; the only other occurrences anywhere in the
workspace are in `packages/server/dist/`, which is build output of itself.
Finding 6 said P9.1 is a call site rather than a build, and what the re-run adds
is that the module is no longer *newly* dangling — it is the state §0.1 called *a
`memoriesRoot` in miniature*, and P8 has since decided what to do with the
original.

#### What P8 moved — six items, and the first is a rule one of this phase's own stages would break

1. ***`memoriesRoot` was deleted with an assertion behind it, and P9.0's proof
   obligation is written on the wrong side of that rule.***

   §0.1's finding 8 concludes that P9.0 **adds the accessor** for
   `sessions/<id>/assets/`. [P8 §1.1](25-p8-implementation.md) met the other
   member of that class and went the other way: `Layout.memoriesRoot()` — a
   session-scoped root drawn in [03 §5](../03-data-model.md)'s tree and written
   to by nothing since P1 — is **deleted**, the tree line is struck with its
   date, and `tools/repo-shape.test.ts` carries an arm named *"the storage layout
   keeps no root the library owns"*. [03 §5](../03-data-model.md) states the
   reason in a sentence: ***"a path helper that survives the phase without a
   caller is the same defect twice."***

   **That sentence is about this stage.** P9.0's *Ends at* is *"a rendition
   record that can be written, read and rendered as `state: "pending"` with no
   provider behind it at all"* — and nothing in a `pending` rendition writes
   bytes, so an accessor added there is a path helper with no caller, which is
   precisely what was just removed for being one. The repair is small and it
   changes the **proof** rather than the stage: the obligation asserts a
   **caller**, not an accessor. Either P9.0 adds the accessor together with the
   first code that resolves an `asset` to a path — the reader that turns one into
   a URL, or the hook `asset: null` implies — or the accessor lands in P9.2 with
   the first writer and P9.0 ships the path *convention* in
   [22](../22-internal-contracts.md) and [03 §5](../03-data-model.md) alone.
   **What it may not do is add a dangling accessor and call it an exit
   condition**, which is the form the obligation currently takes.

   ***Resolved 2026-09-16, and neither arm of the fork was taken.*** P9.0 added
   no accessor, because there was never one to add: `renditions/store.ts`
   derives its two roots the way `summaries.ts` derives its one. The rule this
   item is built on held exactly as stated — a path helper with no caller is the
   same defect twice — and the stage satisfied it by not creating the helper.
   P9.0's repo-shape arm asserts the **tier** instead, which is the claim that
   actually needed one: a rendition is in no `PORTABLE_SCHEMAS` entry and emits
   no JSON Schema, checked by `emit-schemas` producing no diff.

   *Finding 8's count is stale too, in the direction that makes the point:*
   `storage/layout.ts` declares **seventeen** methods. It declared eighteen at
   `2fb75e5`, and P8.2 removed one — this one. The half that matters is
   unchanged: the only `assetsRoot` is object-scoped, `(owner, schemaId, slug)`.

2. ***The recipe digest has a primitive, a precedent, and — visible only beside
   the primitive — a missing field.***

   §1.7 specifies the backdrop reuse key as *"a hash over the assembled ranked
   fragments as sent, excluding the sampling seed"*.
   `sessions/summary-chain.ts` now ships `digest(parts)`: SHA-256 over an ordered
   list with **each part length-prefixed**, and the prefix argued at length,
   because a bare concatenation makes `H("ab","c")` and `H("a","bc")` equal and
   *"a collision in a **cache key** is not a crash, it is a session quietly
   reading another line's summary."* Read for backdrops, that is *a session
   quietly showing another place's backdrop* — the same defect with pixels, and
   harder to notice.

   **And `summariserKey` puts the resolved `Binding` in the key** — *"the whole
   binding, not the model id. Two connections serving what they both call
   `llama-3.1-8b` are not the same model."* §1.7's digest names the fragments and
   **says nothing about the model**, so as specified, rebinding `image` to a
   different endpoint returns the old provider's backdrop for every place already
   visited, permanently and with no way to ask for the new one. **The digest keys
   the resolved binding too.** The asymmetry is [P8 §1.9](25-p8-implementation.md)'s
   unchanged: wrong toward *derive* costs one image, wrong toward *reuse* shows a
   picture no current configuration can account for.

   *`digest` is private to `summary-chain.ts`*, so this is a lift rather than an
   import — and two hand-rolled hash encodings in one codebase is how two answers
   to *what is this keyed on* come to exist. Export it and cite it, or the second
   one will differ in the prefix and nobody will find out until the keys are on
   disk.

3. ***`ensureChain` is §1.7's reuse key, already built and already
   property-tested, on a different subject.***

   *Read what is held, derive what is not*: `sessions/summaries.ts` looks a link
   up by content address, derives only the misses, and returns `derived` — a
   count instrumented from the first stage so that *"a warm chain derives zero"*
   is a number rather than a claim. That is §1.7's *"before dispatching, the step
   looks for a ready background rendition whose recipe digest already matches"*
   and P9.3's *"asserted on the dispatch and not on the pixels"*, written once
   already.

   **What P9 should take is the instrument and not only the shape.** A dispatch
   counter on the rendition path makes gate steps 10 and 12 assertions about a
   number rather than about an absence, which is the difference between *no job
   was dispatched* and *no job was observed*. And
   `summary-chain-property.test.ts` is the harness the recipe-survives-eviction
   property wants: fast-check over generated shapes, plus one on-disk tree where
   deleting the derived files and re-deriving is asserted to produce
   **byte-identical** output — which is exactly the shape of *drop `asset` and
   re-run from `prompt` and `provenance`*.

4. ***A sixth engine-owned step, and the runner now has the gate P9.4's off
   switch needs.***

   P9.1's step is engine-owned and appended by the runner, which made the
   summariser *the fifth* at [P8.1](25-p8-implementation.md). Two things that
   stage built are P9.1's directly.

   **`resolveStepRole` is extracted from `planCall`** (`turns/calls.ts`), so a
   caller can know a step's *resolved* binding **before** the call. It was
   extracted because the summariser has to key on that binding and then usually
   not call at all — which is the same sentence as §1.7's digest and as P9.1's
   replayed moment, twice over. It did not exist at `2fb75e5`; a P9.1 written
   then would have had to do the extraction itself, and the note in its docstring
   about *"a second copy of this layering would be a second answer to which model
   is this"* is the reason it should not be done twice now.

   **And `wantsSummary`'s three gates are the pattern for *off*.** The runner
   keeps the summariser out of the plan rather than running it to do nothing —
   *"a step outcome that means this feature exists rather than anything about the
   turn is noise on every turn of every session"* — which is what gate step 12
   asks for in its expensive half: *backdrop off, and no `image` call was made*.
   Not a provider that returns null, not a step that returns early. **Absent from
   the plan**, which is also the only version of *off* that step 12's call-log
   assertion can tell from the others.

5. ***The route P9.3 writes the backdrop by has a fourth worked example, a week
   old — and gate step 11 acquires a new way to be quietly false.***

   §1.7 warns that a stage which discovers `BACKDROP_CHANNEL`'s
   `engine-computed` policy *by failing an effect proposal* will be tempted to
   widen the channel, and that widening it is the one repair that undoes the
   argument. `memory/capture.ts`'s `recordEscape` is now the nearest example of
   the path that is not that: a turn with **no model call and no tape**, carrying
   an effect the engine accepted through `acceptEffect` — *"which is
   `writeChannel`'s shape and `undoTurn`'s and `divergenceTurn`'s"*. A generator
   whose result the *engine* applies has four precedents in this tree and needs
   no new mechanism.

   ***The new hazard is `escapes`.*** `ChannelDefinition` gained
   `escapes?: boolean` at [P8.2](25-p8-implementation.md) and `ChannelEffect.scope`
   can now really be `'escaped'` — a scope `applyEffects`, `undoTurn` and
   `reconstructAlong` all **skip**, because an escaped effect is one the session
   cannot take back. A backdrop selection declared that way would look correct on
   the turn it was written and silently fail to return on rewind, which is gate
   step 11 failing in the one manner its *empty diff* assertion does not look
   for: nothing was written, and that is the bug. `BACKDROP_CHANNEL` declares no
   `escapes` and must not gain one. §1.7's *the artefact is not an effect; the
   selection is* now needs its second half said out loud — **and the selection is
   an ordinary one.**

6. ***R10 exists, so the blocker is filed rather than merely found — and it is an
   errand nothing else in that file discharges.***

   §0.2 and §3.1 both say [manual testing §3](05-manual-testing.md) *"has nine
   standing prerequisites"*. It has **ten**: **R10** — *an endpoint that serves
   the `image` role* — was added by this document's own audit, and is
   cross-referenced from §3's table and from §6's P9 row, which names both
   criticals as blocked on it and on nothing else. Both sentences are corrected
   below; the block itself is unchanged, and so is the distinction §0.2 draws
   between a deferral and an errand.

   ***What did change is the shape of the queue.***
   [P8 §0.3](25-p8-implementation.md) counted three phases holding open on an
   unwalked sitting's live endpoint; P8 then merged with **sitting N** unwalked,
   making four — **K** is [P6B](20-p6b-playable.md)'s, **L** is
   [P7](23-p7-implementation.md)'s, **M** is
   [P7B](24-p7b-presets-and-prompts.md)'s and **N** is
   [P8](25-p8-implementation.md)'s — and **every one of them wants a chat
   endpoint**, as does G. **R10 is a second errand and none of them discharges
   it.** The day that unblocks four phases leaves both of P9's criticals exactly
   where they are, which is the argument for starting this errand on its own
   rather than assuming it rides along with the others.

#### What this section deliberately does not do

**It does not answer §1.2.** That decision wants one real image endpoint in hand
and still does not have one. The evidence the audit added — that
`ProviderCapabilities` already straddles both shapes, carrying `maxPromptChars`
and `usefulPromptChars` beside `supportsTools` and `mergeSameRole` — is
unchanged, and is still evidence rather than an answer.

**It does not re-decide anything else.** §1's decisions were made against a tree
that, on every point they turn on, is the tree that exists today. Item 1 is the
only place the code moved *against* a stage, and it moves that stage's proof
rather than its content; items 2 through 5 are work this phase no longer has to
invent.

***And it does not open the phase.*** §0.2's *P9.0 is blocked by nothing* holds,
and it is now the second phase in a row for which that sentence is true — but
what [P8](25-p8-implementation.md) walked into was a gate with criticals a person
could reach on the endpoints this project already has. P9's two cannot be
reached at all until R10 is, and [manual testing §7](05-manual-testing.md) closes
a phase on its critical list. **A P9 opened before that errand starts is a phase
that can be built in full and cannot be closed** — which is a thing to decide
deliberately, the way [P8](25-p8-implementation.md) decided its cut, rather than
to discover at the gate.

---
## 1. Decisions this plan has to make

### 1.1 `Rendition` is specified in one document and appears in no schema

**The phase's first stage is a contract, not a feature**, and this is the reason.
[06 §10.1](../06-modes-and-turn-pipeline.md) gives the full interface — `kind`,
`purpose`, `scope` (both halves, §1.6), `state`, `prompt`, `asset`, `provenance`,
`error` — and it is the only place in the design that has it. It is **not** in
[04](../04-schemas.md), which owns portable objects; **not** in
[22](../22-internal-contracts.md), which owns internal ones; and **not** in
[03](../03-data-model.md), which owns what is on disk. ~~`sessions/<id>/assets/`
exists in the layout with nothing writing to it.~~ ***It exists in
[03 §5](../03-data-model.md)'s tree and in none of the code*** (§0.1's finding
8): `storage/layout.ts` has ~~fifteen~~ ***seventeen*** accessors and no
session-scoped one, so P9.0 **adds** the path rather than starting to write to a
waiting one.

***And it adds it with a caller or not at all*** — 2026-09-16, §0.3's item 1.
The count moved because [P8.2](25-p8-implementation.md) **deleted**
`memoriesRoot()`, the other session-scoped root drawn in
[03 §5](../03-data-model.md) and written to by nothing, and put a
`tools/repo-shape.test.ts` arm behind the deletion so it cannot come back. The
sentence [03 §5](../03-data-model.md) gives for it is the one this stage has to
answer to: ***"a path helper that survives the phase without a caller is the same
defect twice."*** A `pending` rendition writes no bytes, so P9.0 ending *"with no
provider behind it at all"* and adding an accessor is that defect a third time.
**Either the accessor arrives with the first code that resolves an `asset` to a
path, or it arrives in P9.2 with the first writer** and P9.0 ships the convention
in [22](../22-internal-contracts.md) and [03 §5](../03-data-model.md) alone.
P9.0's proof obligation below is amended to ask for the caller.

That is the same shape of gap as
[P2B §1](10-p2b-provider-configuration.md)'s missing fallback layer — three
documents relying on a thing no document defines — and it is named here so it is
found while planning rather than on the day. The remedy is small: one section in
[22](../22-internal-contracts.md), one paragraph in
[03 §5](../03-data-model.md) about where the bytes live, and the turn record's
link to them.

**One field of that interface names a type that does exist, and it is the wrong
one.** *Found 2026-09-01, while adding §1.7.* `Rendition.provenance` is typed as
`GeneratedFieldProvenance`, which ships today in
`packages/shared/src/schema/common.ts` — and it cannot carry what
[06 §10.7](../06-modes-and-turn-pipeline.md) requires. Its `seed` is documented
as *"the input the generation ran from"*, a string holding the prompt an assist
ran against; §10.7 means the **sampling seed**, and calls it *"the load-bearing
field here, and the one an implementation is most likely to drop as
uninteresting"*. There is also no field for workflow parameters, which the same
paragraph says are never discarded.

So the recipe promise is **not satisfiable by the type the design names**, and
the two readings of `seed` are close enough that an implementation would satisfy
the type, pass review, and quietly ship a rendition that cannot be reproduced.
That is a small correction and a large one at the same time: it sharpens *the
contract is the phase* rather than contradicting it, and it is the second
strongest argument in this document for P9.0 existing as a stage. The revisit
decides whether renditions get a provenance type of their own or
`GeneratedFieldProvenance` grows — and either way the digest §1.7 depends on has
to hash something real.

**Internal rather than portable, leaning — and the counter-argument now has a
date.** A rendition hangs off a turn, and turns are internal. The
counter-argument is that the recipe is the durable half and someone will want it
to survive an export.

When this was written, export was [26 B12](../26-open-questions.md) with no
release attached, so deciding here would have been deciding early and blind.
**Export now ships at 1.0** ([work plan §0.5](01-work-plan.md)) at P11, which is after
this phase — so the lean still holds, but it is no longer a decision that can be
left indefinitely. **P9 owes P11 an answer rather than a lean**: what a rendition
contributes to an exported session, and whether the recipe travels with it.

---

#### Decided 2026-09-16 at [P9.0](#p90--the-contract) — three answers, and one fork that dissolved

***The tier, and the answer P9 owes P11.*** `Rendition` is **internal tier**,
plain TypeScript in `packages/shared/src/rendition.ts` beside `turn.ts` — and
the answer to *when does it graduate* was already written, in `turn.ts`'s own
header: no `schema` field on the portable side, no `$id`, no entry in
`PORTABLE_SCHEMAS`, no emitted JSON Schema, and ***"session export
([26 B12](../26-open-questions.md)) is the event that ends this freedom"***. A
rendition hangs off a turn, so it graduates **when the turn record does**, at the
export freeze, and not before. That is a real answer rather than a lean, and it
costs P11 nothing to collect: the recipe travels exactly when the turn it hangs
on travels. `emit-schemas` produces no diff, which is the tier claim checked by
the build rather than asserted in prose.

***The provenance finding is resolved rather than inherited.***
`RenditionProvenance` is a **new type**, not a widening of
`GeneratedFieldProvenance` — and the reason is sharper than *the two `seed`s mean
different things*. The existing one is **portable**: it is carried by five
emitted schemas, so growing it would push a sampling seed and a workflow blob
into every exported actor card, which is a portable-shape change made to serve an
internal record. The new type's `seed` is `number | null` and means the sampling
seed only.

***And a third thing was wrong that this section did not predict.*** Two more
fields were mistyped in the specification above: `AssembledPrompt.budget` in
`number | undefined`, where an `undefined` in a persisted shape is a field JSON
round-trips away, so `null` is the only honest absence on disk; and `prompt` as
`AssembledPrompt | null`, where a rendition with no recipe is a rendition that
cannot be re-created — which is the one promise
[06 §10.7](../06-modes-and-turn-pipeline.md) makes. `prompt` is never null.

***The `Layout` fork dissolved rather than resolving.*** Neither arm of *the
accessor arrives with the first resolver, or in P9.2 with the first writer* was
taken, because **`Layout` was never how a session subdirectory is added**:
`snapshots.ts` and `summaries.ts` both derive their own with
`resolveWithin(layout.sessionRoot(…), '<dir>')` and add no `Layout` method —
*that* is the established way, and the seventeen accessors are all
**account**-scoped or install-scoped. So P9 adds **no accessor at all**, nothing
dangles, and [P8.2](25-p8-implementation.md)'s rule is honoured by not creating
the thing it forbids rather than by timing it. §0.1's finding 8 and §0.3's item 1
are corrected to say so, and P9.0's repo-shape arm asserts the **tier** instead,
which is the claim that actually needed one.

### 1.2 The provider layer speaks chat, and no image endpoint does

`image` is one of the eight model roles ([20 §5.1](../20-tech-stack.md)) and is
**unset until a matching connection exists**, because there is no sensible
text-model fallback for it. So the role vocabulary is ready. What is not ready is
the adapter: `Provider` in `packages/server/src/providers/types.ts` is
`generate(request) → GenerationResult` with an optional text `stream`, and
[20 §5.5](../20-tech-stack.md)'s compatibility surface is stated as *if it speaks
OpenAI-compatible chat, it works* — which no image-generation API does.

So the phase owns a genuine question rather than a wiring job: **does `Provider`
grow a second arm, or do renditions get their own client behind the same
connection and binding machinery?** The considerations, so the revisit does not
re-derive them:

- Connections, credentials-never-leave-the-server, role binding and the
  five-layer override order are all worth reusing whichever answer wins; the
  *capability record* and the request/response shapes are not.
- [20 §5.5](../20-tech-stack.md) already says the chat bet is reversible at a
  single seam because rendering is isolated as one step. A second *provider
  kind* is a larger claim than a second renderer and should be made
  deliberately.
- Whatever ships must not make `image` look bound when nothing can serve it.
  [P2B](10-p2b-provider-configuration.md)'s dangling posture is the precedent:
  visible, named, and never a turn that fails obscurely.
- ***The capability record already straddles both shapes, which is evidence and
  not an answer*** (2026-09-15). `ProviderCapabilities` carries `supportsTools`,
  `mergeSameRole` and `systemMessage` — chat, and meaningless to an image
  endpoint — **and** `maxPromptChars` / `usefulPromptChars`, which
  `providers/prompt-caps.ts` reads and whose docstring is about CLIP's
  77-token window. So one record is already answering two questions, which is
  either the seam [20 §5.5](../20-tech-stack.md) promised or the first sign of
  the half-lie a forced fit produces.

~~***This is the one decision this document deliberately does not make***, and
§0.2 says why: it wants **one real image endpoint in hand**, not another
paragraph.~~ The considerations above are complete; what is missing is the thing
that turns a lean into a decision, and inventing one at a desk is exactly how §5
says the answer gets made by accident.

---

#### Decided 2026-09-16 at [P9.2](#p92--jobs-that-never-block-and-the-surfaces-that-follow-from-that) — a second **verb**, not a second **kind**

***Taken under this section's own warning, and the warning is why the reversal
condition is written down rather than left to judgement.*** `Provider` grows one
optional arm:

```ts
renderImage?(request: ImageRequest): Promise<ImageResult>;
```

beside `generate` and `stream`, with `ProviderCapabilities.rendersImages` saying
whether it is there. One provider kind, one capability record, one connection,
one binding — which is precisely what [20 §5.5](../20-tech-stack.md) means when
it says the chat bet is reversible *at a single seam*: this is a second method on
the seam, not a second seam.

**What made it decidable at a desk after all** is that the question turned out to
be smaller than it reads. The pinned SDK already carries the other half:
`@ai-sdk/openai-compatible@3.0.30` exports `imageModel`, `ImageModelId` and
`ImageModelOptions`, and `ai@7.0.66` drives them through `generateImage`. So the
adapter is the **same package**, the same `baseUrl` and the same credential path
as chat, and the fork this section poses — *reuse the connection machinery or
build a second client* — has no second client on the other side of it. There was
less to decide than the paragraph above assumed.

***What would reverse it, stated so a later phase does not have to re-derive the
lean.*** **An endpoint whose request is not prompt-plus-scalars.** `ImageRequest`
is `{ modelId, prompt, seed, workflow }` and `workflow` is a flat record of
strings, numbers and booleans — which covers every OpenAI-compatible image API
and a good deal else. A ComfyUI-style endpoint takes a **graph**, and a graph is
not a scalar bag: it has nodes, edges and typed sockets, and squeezing one
through `workflow` is exactly the half-lie the last bullet above predicts a
forced fit produces. **That is the day `Provider` gets a second kind**, and the
evidence will be a `workflow` field with JSON strings in it.

*The other three bullets are honoured rather than traded away.* The connection,
credential and five-layer override machinery is reused whole (`resolveStepRole`
resolves `image` exactly as it resolves `prose`); the capability record gains one
boolean and one optional number rather than a second record; and `image`
unbound remains [P2B](10-p2b-provider-configuration.md)'s dangling posture —
gate row 8 asserts it, and the step is kept **out of the plan** rather than
failing a turn.

#### The reversal condition, tested against a corpus — 2026-09-19

***The condition above was written from reasoning. It has now been read against
eighteen real image backends, and it holds — but what the reading actually
found is more useful than a yes.*** Of `Pasta-Devs/Marinara-Engine`'s eighteen
sources at `cc783dd`, **nine are the same provider wearing different hats**:
thirty to seventy lines each whose whole content is a URL, three renamed fields
and a response path. One of the eighteen — ComfyUI, with SwarmUI and RunPod
behind it — is the graph this section predicted, and it is the only one.

So the sentence *"that is the day `Provider` gets a second kind"* is correct and
is **not** the sentence a reader should take away first. The prior finding is
that a long provider list is mostly a **table of endpoints**, and that building
it as adapters buys nothing. The decision that follows, with the families
measured and the corpus's own three internal votes on which of its names matter,
is [20 §5.6](../20-tech-stack.md).

*Two things that section settles which this one had no way to reach.* OpenRouter
is **not** OpenAI-compatible for images, so it needs a shim rather than a row.
And the corpus's Pollinations path substitutes `Math.random()` for the caller's
seed — which is this phase's own promise broken at the adapter, and is worth
knowing as the shape of the failure a table invites when a row is written
carelessly.

### 1.3 Old turns: recorded state or present state

[06 §10.6](../06-modes-and-turn-pipeline.md)'s standing `[OPEN]` — whether an
on-demand rendition of an *old* turn assembles from that turn's recorded state or
from the present. Recorded state is more correct and more surprising; the turn
record makes either possible.

**Decidable now in a way it was not when written**, because P3 shipped the record
reader and P6 shipped reconstruction at a node — so *that turn's state* is a
function call rather than a research project. **Lean: recorded**, with the
surprise mitigated by saying which it used, in the rendition's own prompt
listing, where the workbench already shows ranked fragments.

**Backgrounds are the case where recorded is not even surprising** (§1.7). A
backdrop's whole subject is *where you were standing*, so present state is
visibly the wrong answer — regenerating the tavern from a rooftop three hours
later is a bug nobody has to have explained. Worth noting because it is
evidence rather than restatement: an argument that looks finely balanced on
illustrations is one-sided on the other purpose, and the field they share should
not be decided twice.

---

#### Decided 2026-09-16 at [P9.4](#p94--controls) — recorded state, and the lean cost nothing to take

***The lean held, and building it turned out to be one argument rather than a
branch.*** `renditions/illustrate.ts` calls `gatherAssemblyInputs` with
`parentTurnId: <the turn being illustrated>`, which is the gather's own way of
saying *the state after this turn*: `walkPath` ends the path there and
`reconstructAlong` folds it. There is no second code path for *the present* and
no setting to choose between them, because the gather already had the answer and
the two would have been the same call with a different argument.

**The mitigation shipped with it**, which is what makes this a decision rather
than a preference: the assembled fragments are on the rendition's own record and
`workbench/turn/RenditionList.tsx` shows them beside the turn they were assembled
at ([P9.5](#p95--the-workbench-over-renditions)). *Why does this picture show the
tavern* is answerable from the panel. A phase that decided for the more
surprising answer and did not build the disclosure would have taken the surprise
and skipped the argument for it.

**[06 §10.6](../06-modes-and-turn-pipeline.md)'s `[OPEN]` is struck** with the
date and the three reasons, and both purposes read the same field — which is
that section's own condition: *whatever is decided, it is decided once.*

### 1.4 Eviction is a later decision, and that is only true if the hook ships

[26 E3](../26-open-questions.md) is explicit that an eviction policy can be
adopted later *because adopting one can never cost history*. That holds only if
two things are true from the first commit: `asset: null` renders as a
regenerable placeholder rather than a broken image, and the recipe — prompt,
seed, model, workflow parameters — is never discarded. **The policy is deferred;
the shape that makes it safe is not**, and a phase that ships pixels without
`asset: null` having a rendering has quietly made eviction a migration.

### 1.5 `artifact.ready` has a producer here and a router two phases later

[09 §3.5](../09-server-multiuser-deployment.md) defines the class and names
renditions as its only 1.0 producer; the notification **router** is
[P10](27-p10-implementation.md)'s. So this phase emits an event nothing routes,
and the phases are in that order for good reasons on both sides.

The obligation that follows is [09 §3.4](../09-server-multiuser-deployment.md)'s
and it is cheap here and expensive later: the event carries its class, its target
user resolved **server-side**, `actionable: false`, a renderable summary as
`{ key, params }` rather than English prose, and a dedupe key. Getting the schema
right is the retrofit risk; the delivery is additive.

**A backdrop arriving emits the same event**, and does not earn a class of its
own: [09 §3.5](../09-server-multiuser-deployment.md) named the class
`artifact.ready` rather than `rendition-ready` precisely so its second instance
would not require renaming it, and a second *purpose* is a weaker case for a new
class than a second kind would be. Whether a backdrop is worth ringing about is
a delivery-policy question and therefore P10's — the summary's `{ key, params }`
has to distinguish the two purposes so P10 *can* decide, which is the only part
that is this phase's to get right.

---

#### Not discharged, and the producer moved — recorded 2026-09-16 by [P10 §0.1](27-p10-implementation.md)

***This phase emitted no `artifact.ready` at all***, and the word appears nowhere
in `packages/`. The reason is [P9.2](#p92--jobs-that-never-block-and-the-surfaces-that-follow-from-that)'s
and it is structural rather than an oversight: the `event` table **foreign-keys
to `job(id)`** and `resolveJobs` walks forward from the cursor's anchor, so a
rendition `ProgressEvent` would need a `job` row a rendition must not have. What
shipped instead is a whole-record `rendition` SSE frame, applied by upsert, which
is what kept `attachToSession` synchronous.

**That decision stands and this section's obligation still went unmet**, which
are two different sentences and both are true. A **transport** for pixels
reaching an open page and a **class** telling a person something finished are
different things; P9.2 chose the first well and the second was never written.

***So the producer joins the router at [P10.1](27-p10-implementation.md).***
That is where it was always going to be delivered from, it is cheap there — a
`Rendition` already carries the purpose, turn, session, state and error a
`{ key, params }` summary needs — and P10 §1.4 has taken it explicitly rather
than inheriting it by silence. **The retrofit risk this section named is real and
it landed one phase later than it says.**

*One thing this section did not anticipate, and P10 §0.1 raises it:* a rendition
that **failed** is not *ready*, and `RenditionError`'s `interrupted` exists
because a server can restart mid-job. Widening the class to *settled* is P10's
call, and it is the same instinct that named it `artifact.ready` in the first
place.

### 1.6 Three fields whose absence would force a schema change later

[06 §10.5](../06-modes-and-turn-pipeline.md) records the first two. `kind` is a
union from the first commit even though only `"image"` is ever written, and
`scope.messageId` exists even though images rarely need it — speech is per
utterance, and under `per-actor` dispatch a turn holds several. Neither is
speculative machinery: they are fields whose absence would force a schema change
on a stored type.

**`scope.anchor` is the third, and it is the one with a consumer in this phase**
([06 §10.4a](../06-modes-and-turn-pipeline.md)). That makes it a different
argument from the other two rather than a longer version of the same one: they
are shapes held open for kinds nobody builds at 1.0, while the anchor is used on
the first turn P9 illustrates — the picture lands *in* the prose rather than
under it — and its miss path (P9.1) gets exercised long before the multi-moment
turns of §4's deferred judgement depend on it. Note what that does to the
section's own framing: `scope` is now a field two callers want different halves
of, which is a better warrant for its shape than the one it was introduced with.

**What is *not* being pre-built** is any provider, step or surface for the other
two kinds. The shape is general; the implementation is images.

### 1.7 Backgrounds are the second thing this phase delivers, and a second field

*Added 2026-09-01.* [06 §10.1a](../06-modes-and-turn-pipeline.md) is the design
side of this; what follows is what it costs the phase and what the phase owes
back.

**The gap it closes is older than this document.**
[06 §7.2](../06-modes-and-turn-pipeline.md) has described Scene as *"staged
scene, optional background and sprites"* since it was written, and has always
said backgrounds are steps writing to channels. **No document has ever said
where the image comes from.** [P7.9](23-p7-implementation.md) repeats the
channel and inherits the silence; [P4](16-p4-implementation.md) counts
SillyTavern's `backgrounds/` folder among the directories it *skips*, correctly,
because thirty JPEGs are not a StoryEngine object. So at the end of P7 the
engine has a channel that says which backdrop is showing and nothing at all that
can give it a value. **This is the phase that can, and the reason is that a
backdrop is a rendition.**

**`purpose` is one closed union, and it is not `kind`.** `kind` answers *how is
this produced* — provider, latency, cost, the axis on which the three kinds of
[06 §10.1](../06-modes-and-turn-pipeline.md) genuinely differ. `purpose` answers
*what is it for*. The rejected shape is putting `"background"` into `kind`,
which is smaller by one field and wrong in a way that shows up exactly once, late:
an animated backdrop is `{ kind: "video", purpose: "background" }` here and
inexpressible there. In a document with a whole section (§1.6) about the two
fields that keep video cheap, spending the union that carries video on something
else would be a particular kind of own goal.

**The other rejected shape is not doing it here at all**, leaving backdrops to
P7's channel and a folder of uploads. That is a smaller P9 and it costs the three
things renditions exist to provide: a permanent recipe, accumulation with
selection, and a workbench row. A backdrop is the rendition a user stares at
longest and the one most likely to be regenerated until it is right, which makes
it the *worst* candidate for the version with no history.

#### What it adds to this phase, honestly

- **A field**, in P9.0, alongside the rest of the contract. Free at that moment
  and a migration at any later one.
- **A second ranking of the same fragments**, in P9.1. Not a second assembly
  path — the same step under the same cap, ranking channel state and tone up and
  the turn's output text and actor descriptors out, because a backdrop is a place
  and not a moment.
- **A channel binding**, in P9.3, which is the stage that already owns selection.
- **A control and a surface**, in P9.4.

**What it does not add is a mechanism.** The pointer to the selected backdrop is
an ordinary `ChannelEffect`, so rewind and branching come from
[07 §2](../07-branching.md) with nothing written for them, and
[06 §10.2](../06-modes-and-turn-pipeline.md)'s corollary is sharpened rather than
weakened: *the artefact is not an effect; the selection is.* If this phase finds
itself writing branch-aware code for backdrops, the split was implemented
backwards.

#### The reuse key, and the money

**A backdrop generates when the place changes, not every turn**, and the second
half matters more: **before dispatching, the step looks for a ready background
rendition in this session whose recipe digest already matches** — a hash over
the assembled ranked fragments as sent, excluding the sampling seed — and selects
that one. Returning to a place you have been costs nothing, and it returns the
backdrop you *chose* for that place, because the digest resolves to the currently
selected sibling rather than the oldest.

**The digest is free, and that is not a coincidence.** It hashes the recipe
minus the seed — the assembled prompt, which is the same artefact this
document's own exit gate re-runs in the recipe-survives-eviction property. A
recipe permanent enough to re-run is a recipe stable enough to key on; if the
digest turns out to be hard to compute, the property is not being honoured, and
the digest is a cheap early warning for it. (Subject to §1.1's finding — the seed
has to be a field the recipe actually holds before excluding it means anything,
and in the type the design currently names it is not.)

***Two amendments the primitive makes obvious, both 2026-09-16*** — §0.3's item
2, and neither is visible until you read
[P8](25-p8-implementation.md)'s `sessions/summary-chain.ts` beside this
paragraph.

- **The resolved binding is in the key, not only the fragments.** As written
  above, rebinding the `image` role to a different endpoint returns the *old*
  provider's backdrop for every place already visited, with no way to ask for the
  new one — the digest cannot tell the two apart because the model is not in it.
  `summariserKey` makes the opposite call for the identical reason
  ([P8 §1.9](25-p8-implementation.md)): *"the whole binding, not the model id.
  Two connections serving what they both call `llama-3.1-8b` are not the same
  model."* The asymmetry is the same size here and points the same way — wrong
  toward *derive* costs one image, wrong toward *reuse* shows a picture nobody's
  current configuration accounts for.
- **Length-prefix the parts.** `digest()` hashes an ordered list with each part's
  length written before it, and says why: a bare concatenation makes
  `H("ab","c")` and `H("a","bc")` equal, and *"a collision in a cache key is not
  a crash, it is a session quietly reading another line's summary."* Here that is
  a session quietly showing another place's backdrop, which is the same defect
  and harder to notice. The function is private to its module, so this is a lift
  — **cite it and share it**, because the second hand-rolled encoding in a
  codebase is how two answers to *what is this keyed on* come to exist.

**This is also §5's cost question, answered for the one purpose that could
answer it.** Every other rendition is a deliberate act that spends money once.
A backdrop is the one the engine would run on its own, and per-turn it would
multiply the bill by the length of the session. Keyed, it costs roughly one image
per *place*. That does not settle what a rendition costs a person — §5 is right
that none of the budget, quota or consent vocabulary exists — but it stops
backgrounds from being the reason the question becomes urgent.

#### ~~What P9 owes P7, and it is one sentence in P7's document~~ — paid, 2026-09-15

**The background channel's value must be a media reference able to name either
an authored image or a rendition's asset, from the declaration onward.** P7 ships
that channel two phases before anything can generate for it, so the natural
declaration is the one that matches what P7 can actually produce — a file
somebody uploaded — and narrowing it that way means widening a channel's schema
under live sessions ([06 §4.2](../06-modes-and-turn-pipeline.md)) to admit the
generated case. It is free in P7 and a migration in P9, which is the same shape
of obligation [P6 §0](18-p6-implementation.md) already records from its end, and
it is recorded in [P7.9](23-p7-implementation.md) from that end.

***P7.9 paid it in full, and answered a question this section did not ask***
(§0.1's finding 7). `packages/sdk/src/media.ts` ships `MediaSelection` with
`{ from: 'rendition'; renditionId }` **declared and dead on arrival by design**,
and Scene's `BACKDROP_CHANNEL` is `update: 'engine-computed'` — which admits a
person, refuses a model, refuses a step, and does so with the reason written
out: *"P9's generator writes it through the engine rather than out of its
step."* **So the route this phase writes the channel by is already decided, and
decided against the obvious one.** A rendition step proposing a backdrop effect
is refused by the channel's own policy; what P9 builds is a generator whose
result the *engine* applies, which is the path [P7.5](23-p7-implementation.md)'s
hook firing and [P7.6](23-p7-implementation.md)'s goal achievement both take.

*Worth reading before P9.3 rather than during it*: a stage that discovers this
policy by failing an effect proposal will be tempted to widen the channel, and
widening it is the one repair that undoes the argument.

#### The line this does not cross

**Text in, images out.** A background prompt is built from channel state as
*text*. Conditioning generation on a location's `reference` **image** is
**lore-conditioned renditions**, deferred past 1.0 by [25 §3](../25-roadmap.md)
and by §4 below, for a reason that survives contact with this feature: *choosing
which images* is the hard part when six active entries and three present actors
all carry references, and attaching all of them produces mud.

Naming it here rather than only in §4 because **a backdrop of a place is the most
plausible excuse anyone will ever have to cross that line** — the location entry
is right there, it has exactly one `reference` image, and the selector problem
looks solved for this one case. It is not solved; it is absent, and the next
request after it works for one location is the one with six.

---

## 2. Stages

In dependency order: the contract, then the step that fills it, then the jobs
that carry it, then selection, then controls, then the account of itself.

***The dependencies inside that order, written down 2026-09-15 because the
sentence above asserts a sequence and no reasons*** ([P7 §2](23-p7-implementation.md)
and [P8 §2](25-p8-implementation.md) both needed the same amendment).

- **P9.0 depends on nothing**, which is §0.2's argument for opening on it and is
  true in the strong sense: it is a type, a path and a record, and it ends
  before any provider exists.
- **P9.1 must precede P9.2**, and not only because a job needs something to do:
  P9.1 is where the **recipe** takes its final shape, and P9.2's event carries a
  dedupe key over it. A P9.2 that opens first invents a key for a recipe that is
  still moving.
- **P9.3 must precede P9.4.** A control that selects among siblings needs
  siblings. *The backdrop's channel binding is P9.3's for the same reason* — the
  control in P9.4 is a switch over a mechanism, and building the switch first is
  how the mechanism ends up inside it.
- **P9.5 depends on P9.3**, because what the workbench has to explain is *why
  are these two different*, and two is what P9.3 creates.
- **Nothing here depends on [P8](25-p8-implementation.md)** (§0.2), including
  P9.1, whose payload question §0.1's finding 10 answers out of the contract P7
  already shipped. ***And P8 has since been built, which turns that from a
  prediction into a record*** (2026-09-16, §0.3): a whole phase landed on this
  tree and no stage below moved on its account. **What it did leave is four
  things these stages no longer have to invent** — a content digest (P9.1,
  §1.7), a derive-only-the-misses chain with a call counter (P9.3), a
  `resolveStepRole` that answers *which model* before the call (P9.1), and a
  fourth example of the engine applying an effect a step may not propose (P9.3).
  *A dependency that runs one way only in the direction of reuse is not a
  dependency; it is a head start.*

### P9.0 — The contract

§1.1: `Rendition` lands in [22](../22-internal-contracts.md), the bytes get a
home in [03 §5](../03-data-model.md) under `sessions/<id>/assets/`, and the turn
record links to them. §1.2's provider question answered and written down before
any adapter is chosen. **Both unions are closed here** — `kind` with one value
ever written and `purpose` with both (§1.6, §1.7) — and §1.1's `provenance`
finding is resolved rather than inherited, because the recipe is what §1.7's
digest and the exit gate's property both hash.

*Depends on:* nothing (§0.2). *Ends at:* a rendition record that can be
written, read and rendered as `state: "pending"` with no provider behind it at
all.

*Proof obligation:* `packages/shared/src/schema/rendition.test.ts` — *the recipe
is a field, not a hope*: a rendition round-trips with its sampling seed and its
workflow parameters intact, and **a rendition carrying only
`GeneratedFieldProvenance`'s fields fails to validate**. The second arm is the
one that matters, because §1.1's whole warning is that the wrong type passes
review. ~~Plus one arm in `tools/repo-shape.test.ts`'s manner: the session assets
path has an accessor, since §0.1's finding 8 is that a path drawn in a document
is enforced by nobody.~~

***Amended 2026-09-16 — the repo-shape arm asserts a **caller**, not an
accessor*** (§0.3's item 1, §1.1). An accessor with nothing calling it is what
[P8.2](25-p8-implementation.md) deleted and wrote a rule against, in that same
file, about that same directory level: *"a path helper that survives the phase
without a caller is the same defect twice."* So the arm reads the way its
neighbour reads — `sessionAssetsRoot` is named by code outside its own test, or
it is not declared yet — and the stage takes whichever half of the fork §1.1
names. ***If that leaves this stage with no storage arm at all, it has exactly
the right number***: P9.0's subject is a type and a record, and the path is P9.2's
the moment there are bytes to put under it.

#### Done — 2026-09-16, `fae4de7`

***Three of the record's fields were typed wrong in this document, and the type
system found all three at once.*** §1.1 specified `provenance.seed` as
`string | number | null` and `AssembledPrompt.budget` in
`number | undefined`; the store specified `prompt: AssembledPrompt | null`. The
seed is a **sampling** seed and nothing else — the `string` arm was inherited
from `GeneratedFieldProvenance`, whose `seed` means a prompt, which is the exact
confusion §1.1 spends a section warning about — and an `undefined` in a
persisted shape is a field that JSON round-trips away, so `null` is the only
honest absence on disk. **`prompt` is never null**: a rendition with no recipe is
a rendition that cannot be re-created, which is [06 §10.7]'s one promise.
Corrected in `06 §10.4a`'s neighbourhood with the date, because this document is
not where a record's shape is finally said.

***The `Layout` fork §1.1 poses dissolves rather than resolves.*** Neither arm
was taken because `Layout` was never how a session subdirectory is added:
`snapshots.ts` and `summaries.ts` both derive their own with
`resolveWithin(layout.sessionRoot(…), '<dir>')` and add no method — *that* is the
established way. So P9 adds **no accessor at all**, nothing dangles, and
[P8.2]'s rule against a caller-less path helper is honoured by not creating the
thing it forbids rather than by timing it. §0.3's item 1 and finding 8 are both
corrected to say so.

**A write failure throws here, unlike a snapshot's or a summary's.** Those return
`false` because losing one costs a recompute; losing a rendition record costs the
**recipe**, which §10.7 says is never discarded. One line, and it is the
difference between a derived cache and an authoritative store.

### P9.1 — The step, and the prompt

An ordinary `post`-stage step ([06 §10.3](../06-modes-and-turn-pipeline.md)),
composing from what is already there: **the moment**, present actors'
`VisualDescriptors` and their `reference` media, channel state, and the
treatment's tone. Assembled as **ranked fragments under the provider's declared
cap** ([20 §5.3](../20-tech-stack.md)) so overrun drops the lowest-ranked
fragment rather than truncating mid-sentence — work that was specified for
exactly this case and has had no consumer until now.

**The moment is the one fragment with an author**, and it is where this stage
stopped being pure assembly. A cheap `fast`-role call reads the turn's output
text and answers *what is the picture of*, because handing a whole paragraph to
an image model produces a prompt about a paragraph
([06 §10.3](../06-modes-and-turn-pipeline.md)). The call also returns the
**anchor** — a verbatim quote saying where in the message the picture belongs
([06 §10.4a](../06-modes-and-turn-pipeline.md)) — and its miss path is built
here, not deferred: an anchor that does not resolve renders the image at the end
of its message and records the miss, and it must never fail the rendition.

**One image per turn this phase.** The call asks for *the* moment, singular.
[06 §10.4](../06-modes-and-turn-pipeline.md)'s count judgement — a list, a
salience, a cap, top-*k* — is specified and deliberately not built (§4), which is
only safe if this stage does not foreclose it: the step contract emits a **list**
of rendition requests from the first commit even though the list has one element,
and the ordering field the judgement will sort on has a home on the record.

**The moment is written once and replayed, never regenerated.** This is the
constraint that keeps a model call from costing the phase its central property:
the recipe-survives-eviction assertion above and the backdrop reuse key both hash
the fragments as sent, and a second call is a second answer. Re-creating an
evicted rendition makes **no text call at all** — it replays the stored fragment.
Test it in that direction, because the natural implementation regenerates and the
golden files will still pass on the day it is written.

**And the background ranking, which is the same step with a different answer**
(§1.7): channel state and tone up, the turn's output text and the actor
descriptors out — **and no moment call**, because a backdrop is a place and a
place has no moment. Built here rather than later because two rankings of one
fragment set is the design, and a second assembly path written in P9.4 under
pressure to show a backdrop is how it stops being one. The **recipe digest**
lands with it, over the fragments as sent.

***And the capper this stage was going to build is already written***
(§0.1's finding 6): `providers/prompt-caps.ts` has `PromptFragment`, `budgetFor`,
`capPrompt` and a `CappedPrompt` that names what it dropped and why, tested and
called by nothing. **So the work here is ranking and calling, not capping** — and
the stage's first act should be to read that module's docstring, because it
already states the property this stage would otherwise have to argue for: *the
cap is an input to generation, not a guillotine at send.*

***Two more that [P8](25-p8-implementation.md) built, and the second is the
harder one*** — 2026-09-16, §0.3's item 4.

- **`resolveStepRole` already exists**, extracted from `planCall` at
  [P8.1](25-p8-implementation.md) (`turns/calls.ts`) so that a caller may know a
  step's *resolved* binding **before** the call. It was extracted for a reason
  this stage has twice: the summariser keys on the binding and then usually makes
  no call at all, which is §1.7's digest and *the moment is replayed, never
  regenerated* in one function. Its docstring is the argument against a second
  copy — *"a second copy of this layering in the runner would be a second answer
  to which model is this"* — and a P9.1 that resolves the `fast` and `image`
  roles its own way makes that second answer.
- **This step is the sixth engine-owned one**, after the hook selector, the
  mention pass, the goal judge, the suggester and the summariser, and the runner
  appends it the way it appends those. ***What to copy is `wantsSummary`'s
  gates*** — the runner keeps the summariser **out of the plan** rather than
  running it to do nothing, because *"a step outcome that means this feature
  exists rather than anything about the turn is noise on every turn of every
  session."* That is exactly what P9.4's *off* has to mean and what gate step 12
  asserts on the call log: not a provider returning null, not a step returning
  early. **Absent from the plan**, which is the only version of off that a
  call-log assertion can tell from the others.

*Depends on:* P9.0, for the recipe the digest hashes. *Ends at:* a turn produces
a rendition request whose prompt is assembled from ranked fragments inside the
provider's declared budget, with what was dropped on the record — **and a second
request for the same place produces a byte-identical digest**.

*Proof obligation:* `packages/server/src/turns/moment.test.ts` — ***the moment is
replayed, never regenerated***, asserted **on the call log**: re-creating an
evicted rendition makes no `fast` call at all. Written in that direction because
the natural implementation regenerates and a byte-comparison passes on the day it
is written and diverges a month later. Plus `prompt-caps.test.ts` gaining its
first production caller's golden files, and the anchor's miss path: an anchor
that does not resolve records the miss and leaves the rendition `ready`.

#### Done — 2026-09-16, `bf27efa`

***`prompt-caps.ts` has a caller two phases after it was written***, which is
§0.1's finding 6 collected. Reading that module's docstring first was the right
first act: it already states the property this stage would have had to argue for
— *the cap is an input to generation, not a guillotine at send* — so the work
was ranking and calling.

***The randomness rule caught a real design error rather than a style slip.***
The first build had the **worker** draw the sampling seed, on the argument that
renditions take no part in reconstruction and so owe the tape nothing. The lint
rule refused it, and the refusal was right for a reason the argument missed: a
seed drawn after the record is written is a seed the `pending` record cannot
state, so *re-creating* an evicted picture could never be a replay of the same
number. The **step** draws it through `host.random.at(SE_RENDER, 'seed')`, it
rides on the request to `provenance.seed`, and the worker reads it off the
record. [20 §14]'s tape turned out to be exactly the right place for it.

***The backdrop's ranking had to be narrowed, and the narrowing exposed a gap
worth naming.*** Including all rendered channel state made Scene's clock part of
the recipe — `Day 1, 09:15` — so the digest changed every turn and §1.7's reuse
key never matched. Narrowed to **place and tone**, with the argument written
where the code is. What the corpus does not have is any way to say *which
channels describe a place rather than a moment*; a mode-declared hint is the
obvious answer and is not this phase's.

### P9.2 — Jobs that never block, and the surfaces that follow from that

Renditions dispatched as their own jobs, arriving over the event stream and
rendering in place; placeholder while pending; retry on failure; §1.5's event
shape. This is the stage where [06 §10.2](../06-modes-and-turn-pipeline.md)'s
*not an optimisation, the only workable design* is either true in the code or
quietly false.

*Added 2026-09-27:* the placeholder while pending reached an open page only if
it happened to refetch, because the stream carried a `rendition` frame when a
picture landed or failed and none while it was pending; the client's reducer
already accepted one. `dispatchRenditions` now sends it, after the record is
written and before the job starts.

***A second job shape beside the first, not a reuse of it*** — §0.1's finding 9,
which corrects §5. `state/jobs.ts`'s `Job` is turn-shaped and exists to enforce
[P2 §2.10](08-p2-implementation.md)'s *only one turn may advance a session*;
**that is the invariant a rendition job must not inherit.** Several may be in
flight for one session, none blocks the turn, and none advances the head — so
what is reused is the store, the status vocabulary and the event stream, and what
is not is the reservation. *Imports are no precedent either: `import/jobs.ts` is
a review-report store written after a synchronous sweep.*

*Depends on:* P9.1, whose recipe the dedupe key is taken over. *Ends at:* a turn
commits with its rendition still pending, the session is fully usable, the image
arrives over the stream and renders in place — and a client that was closed when
it landed reattaches to the finished result.

*Proof obligation:* `packages/server/src/routes/p9-gate.test.ts` — *a turn
completes while a rendition is pending, and a failed rendition leaves the turn
`complete`*. The falsifying mutation is making the rendition a step of the turn
rather than a job beside it: every assertion about pixels still passes, and this
one goes red, which is the whole of §10.2's claim.

#### Done — 2026-09-16, `18b5b8f`

***The one-active-per-session index is the invariant a rendition must not
inherit***, which §0.1's finding 9 predicted and the migration confirms:
`job_one_active_per_session` would make two pictures at once a constraint
violation rather than a queue, and a picture beside a turn impossible. A sibling
table, following `STEPS[1]`'s import precedent, with no `parent_turn_id`, no
`commit_step` and no such index.

***A rendition must not be a `ProgressEvent`, and the reason is a foreign key.***
The `event` table references `job(id)` and `resolveJobs` walks forward from the
cursor's anchor, so an event for a rendition would need a `job` row it must not
have. It travels as an **ephemeral whole-record frame** instead — no `id:` line,
applied by upsert — which keeps `attachToSession` synchronous, the one thing
`stream/attach.ts` has a test to stop anybody changing.

***§1.2 is decided under this plan's own warning***: `Provider` grows a second
optional arm, `renderImage?`, rather than a second provider *kind*. What would
reverse it is written beside it — an endpoint whose request is not
prompt-plus-scalars. The pinned SDK made it concretely buildable rather than
theoretical: `@ai-sdk/openai-compatible@3.0.30` exports `imageModel` and
`ai@7.0.66` exports `generateImage`, so the adapter is the same package, the
same `baseUrl` and the same credential path as chat.

***And one thing this stage did not write, found a phase later.*** **Detached had
been allowed to mean untracked** — `dispatchRenditions` fires `runRendition` and
returns, correctly, because [06 §10.2](../06-modes-and-turn-pipeline.md) forbids
a turn waiting on a picture and `TurnRunnerOptions.dispatch`'s own note forbids
the runner owning the worker — *"a runner whose shutdown had to drain pictures,
which is exactly the coupling this phase exists to avoid."* **Both of those are still right.** What neither of them says is where
the waiting happens *instead*, and the answer was nowhere: a job dispatched by
the last turn of a process carried on writing assets and calling
`setRenditionJobStatus` through a `DatabaseSync` that `disposeServices` had
already closed. That function's own comment argues against exactly this, one line
above where the gap was — *"a detached turn touching a closed `DatabaseSync` is
the failure that surfaces on Windows as `EBUSY` on a file the caller never
named"* — and the argument transfers verbatim to a detached rendition, which
holds the same handle.

***Fixed 2026-09-17, at P11, and found from the other end.*** Not by reading
this document: a full-suite run went red in `p9-gate-selection.test.ts` with
`ENOTEMPTY` removing a session directory, because the test's `rm` had raced an
asset write. **It passed five times in isolation**, which is what a race under
load looks like, and is the reason it is worth writing down that *flake* was not
the root cause. The fix keeps the seam exactly where this stage put it: an
`inFlight` set on the worker's context, a `drainRenditions` beside
`dispatchRenditions`, and one `await` in `disposeServices` between
`runner.drain()` and the handles closing — so the runner still knows nothing
about pictures, and shutdown has a thing to await rather than a component to own.
`renditions/shutdown.test.ts` asserts it, and its falsifying mutation is removing
that one line.

***And the retry was never a second job — found 2026-09-26, by reading.*** The
index this stage wrote to stop a double dispatch was `unique (rendition_id)` with
no condition, and the comment above it said *"one live job per rendition"*. The
two agree for a rendition that is run once, which is every rendition the gate
walks by hand. The retry button is the second run. `enqueueRendition` handed a
retry the first try's **finished** row, and `runRendition` set it back to
`running` with the old `finished_at` still on it. `pendingRenditionJobs` and boot
recovery both ask `finished_at is null`, so a running retry was invisible to
both, and a process that died holding one left it `running` for good. The attempt
number never passed 1, although the migration's own column comment says *"a retry
is a **new job** with a higher number rather than a reset, so the store can say
how many times a picture has been paid for"*. **Every gate row that retries stayed
green**, because each one waits for the picture, and the picture did arrive.

**The code was brought to the notes rather than the other way round.** The other
repair — keep one row, and have the retry clear it — would have reversed a decision
the schema already wrote down. It also overwrites the first try's failure class,
and it makes *not a reset* something every future writer has to remember.
`STEPS[6]` replaces the index with the partial one the comment described
(`job_one_active_per_session`'s shape). It adds `unique (rendition_id, attempt)`
and heals the rows the defect had already written. `enqueueRendition` now assigns
the attempt number itself, inside its transaction, and says whether it created the
job. Nothing ever passed the caller-supplied *"previous plus one"*, and that shape
could not have kept its own promise. Two things the index alone would not have
fixed:

- **The dispatcher ran whatever came back**, including a job already running, so a
  double-pressed retry was two image calls on one job.
- **Skipping a live job opens a window of its own.** A record is written by
  `writeAtomic`, which awaits a `stat` after its rename, and the job is marked
  finished only after that. So a record can say `failed` while its job is still
  live. The retry therefore claims the job **before** rewriting the record:
  `retryRendition` in `renditions/worker.ts`.

*Keyed by session as well, 2026-09-27.* Both of `STEPS[6]`'s indexes named a
rendition by its id alone, and a rendition id is its turn's, which session
import keeps — so two sessions on one install can hold the same ids.
`STEPS[7]` adds `session_id` to each index and every lookup takes the pair
([22 §7](../22-internal-contracts.md)). *A data directory opened by the picture
branch before it merged* numbered its own steps 6 and 7 differently and must be
reset (`pnpm reset-data`, or `tools/reset-data.mjs`); only that branch's own
builds could have made one, and no release did.

***And the half this stage's own notes described, which nothing did.*** Boot
recovery abandoned live job rows and logged a count, and the record stayed
`pending`. `Rendition.tsx` renders `pending` as *"Making a picture of this…"* with
**no retry button**, so every picture a restart interrupted became a placeholder
nobody could press. Three comments said otherwise, and the client has had a
sentence for `interrupted` since P9.4 that nothing could reach.
`recoverRenditions` now marks each interrupted job's still-`pending` record
`failed` / `interrupted` with its recipe intact. It tells the person through
`artifact.ready` with `outcome: 'failed'`, as any failed picture does.
`renditions/retry.test.ts` stages the crash: a rendition has no `halt()`, and
`dispose` drains. It asserts the record, the job and the notification after a
second boot, and that the placeholder's button then runs attempt 3.

**One gap this does not close, recorded rather than fixed.** The runner and the
illustrate route write a `pending` record *before* its job row exists, so a
process that dies between the two leaves a record no job names, and recovery,
which reads job rows, cannot find it. The window is one file write, and it
predates all of the above. The fix is either a job row first or a scan of pending
records at boot, and either is a decision rather than a repair.

*Closed 2026-09-27, with the job row first.* A scan at boot would read every
rendition record of every session at every start to find a window one write
wide. `dispatchRenditions` now claims each job, then writes the record, then
starts the job, and the runner and the Illustrate route hand it records rather
than writing them. So every record on disk has a row recovery reads, and a job
whose record never landed has nothing to strand. A write that lands and still
throws is dispatched like any other, and one that does not land gives its
claim up.

### P9.3 — Accumulation, selection, and the permanent recipe

Many renditions per turn with the user choosing which is shown — structurally
the turn tree again, siblings under a node, and for the same reason:
regeneration must never be destructive
([26 E3](../26-open-questions.md), [06 §10.7](../06-modes-and-turn-pipeline.md)).
Variations ship; §1.4's `asset: null` rendering ships with them.

**The backdrop's channel binding belongs here**, because *which one is showing*
is the same question this stage answers for illustrations and a different
mechanism only for backdrops: a `ChannelEffect` naming the selected rendition
(§1.7). Digest reuse resolves through that selection, which is what makes
returning to a place return the backdrop you picked for it rather than the first
one generated there. Rewind and branching are then [07 §2](../07-branching.md)'s
and nothing is written for them — the check is that nothing *was*.

***The route is decided and now has a fourth worked example*** — 2026-09-16,
§0.3's item 5. `BACKDROP_CHANNEL` is `engine-computed`, so a rendition step
*proposing* the effect is refused by the channel's own policy (§1.7), and the
path that is not refused is the one `memory/capture.ts`'s `recordEscape` takes:
a turn with **no model call and no tape**, carrying an effect the engine accepted
through `acceptEffect` — *"which is `writeChannel`'s shape and `undoTurn`'s and
`divergenceTurn`'s"*. Read it before this stage rather than during it. §1.7's
warning stands: **a stage that discovers the policy by failing a proposal will
want to widen the channel, and widening it is the one repair that undoes the
argument.**

*Corrected 2026-09-27: the shape was copied with a race in it.* `recordEscape`
and `selectBackdrop` read the head and built their turn outside the session's
lock, then appended under it, so a turn committing in between left the selection
on a dead line. And a backdrop finishing while the *next* turn was being written
selected itself as that turn's sibling, which its commit abandoned: the picture
never showed on the line being played. The shape is now one helper,
`appendEngineTurn`, that reads, builds and appends under the lock. A backdrop
that lands during a turn is held and shown once that turn commits, unless the
turn asked for, or reused, a backdrop of its own.

***And the empty diff has a new way to be false.*** `ChannelDefinition` gained
`escapes?: boolean` at [P8.2](25-p8-implementation.md), and an effect whose
channel declares it is written with `scope: 'escaped'` — a scope `applyEffects`,
`undoTurn` and `reconstructAlong` all **skip**, because an escaped effect is one
a session cannot take back. A backdrop selection declared that way is correct on
the turn it is written and silently does not return on rewind, which is gate step
11 failing in the single manner an *empty diff* does not look for: nothing was
written, and that is the bug. `BACKDROP_CHANNEL` declares no `escapes` and must
not gain one, so the diff this stage asserts is empty must be empty of that too.
§1.7's *the artefact is not an effect; the selection is* needs its second half
said out loud — **and the selection is an ordinary one.**

*Depends on:* P9.2. *Ends at:* two renditions of one turn, either selectable;
`asset: null` on both rendering as regenerable placeholders; and walking back
into a place showing the backdrop **you chose** for it, with no job dispatched.

*Proof obligation:* `packages/server/src/routes/p9-gate-selection.test.ts` —
*a place already rendered dispatches no job*, asserted **on the dispatch and not
on the pixels**, because a reuse that quietly regenerates is identical on screen
and shows up only on a bill. ***Assert a number rather than an absence***
(2026-09-16, §0.3's item 3): `ensureChain`'s `ChainResult.derived` is the same
claim already instrumented — *"a warm chain derives zero"* — and it is a count
because *no job was dispatched* and *no job was observed* are different
assertions, one of which survives a harness that stopped watching. Plus the branch arm, whose assertion is a **diff**:
the code written to make rewind work on backdrops is empty. *If this stage finds
itself writing branch-aware code, §1.7 says the split was implemented
backwards — so the test is the one that notices.*

#### Done — 2026-09-16, `5819843`

***The selection is an ordinary effect, and `escapes` is the trap that was not
there when §1.7 was written.*** `ChannelDefinition.escapes` arrived at
[P8.2](25-p8-implementation.md), and an effect whose channel declares it is
written with `scope: 'escaped'` — a scope `applyEffects`, `undoTurn` and
`reconstructAlong` all **skip**. A backdrop declared that way would be correct on
the turn it was written and would silently fail to return on rewind: gate step 11
failing in the single manner an *empty diff* cannot look for, because nothing was
written and that is the bug. `BACKDROP_CHANNEL` declares no `escapes` and must
not gain one.

***The empty diff is asserted as source text over four named modules*** —
`channels.ts`, `segments.ts`, `snapshots.ts` and `turns/effects.ts` — and
`sessions/store.ts` is **excluded with its reason written**: it holds
`setRenditionSelection`, and a pointer into the mutable half is not
reconstruction. An exclusion list with no argument attached is how an empty-diff
assertion becomes decorative.

### P9.4 — Controls

Per session: off, on-demand only, or each turn that has a moment worth one
([06 §10.6](../06-modes-and-turn-pipeline.md)). The third setting reads as
conditional in the design because the count judgement may answer none — but that
judgement is §4's deferral, so **what P9 ships behind that label is one image per
turn**, and the label is written to survive the later phase rather than promise
what it does not yet do. Per-mode defaults, since Scene wants illustration far
more than a text-only Freeform does. The manual **Illustrate** action on any
message in the history — the same step invoked by hand, additive and never
replacing — and §1.3's decision, disclosed.

**Neither pacing dial is P9's** — not the cap and not the cadence
([06 §10.6](../06-modes-and-turn-pipeline.md)). They arrive with the judgement
they gate, and building either here would be a control over a decision nothing
makes yet.

***And nothing owns the judgement they arrive with*** — found 2026-09-14 by
[P11 §0.1](28-p11-implementation.md)'s sweep.
[06 §10.4](../06-modes-and-turn-pipeline.md) says the count judgement *"lands in
a later one"* and **P10 and P11 are the only later phases; neither mentions it**.
So this deferral, and the two dials with it, currently point at nobody — which
is [manual testing §10.1](05-manual-testing.md)'s exact shape, a deferral moved
off one owner and onto a phase that never took it. *The narrowing that makes it
smaller than it reads:* the **storyboard surface** downstream of the judgement is
on the feature list ([25 §3.3](../25-roadmap.md)) rather than in 1.0, so what is
actually unowned is the judgement and the two dials, not the surface they would
feed. Recorded here rather than assigned, because inventing an owner is the
thing that stops anybody looking.

**The backdrop's own control, which is off or on and has no per-turn setting**
([06 §10.6](../06-modes-and-turn-pipeline.md)): *on* means when the place
changes, and a per-turn backdrop is the failure mode rather than the thorough
option. **Set the scene** is its manual counterpart. And the surface it renders
on — [10 §2.3](../10-ui-surfaces.md), where the constraint is that the prose
wins: a backdrop is chrome behind a reading column, never a thing the story has
to compete with. **Off leaves Play exactly as it was**, which is
[06 §7.2](../06-modes-and-turn-pipeline.md)'s text-only-is-first-class applied to
the feature most likely to treat its own absence as an empty state.

*Depends on:* P9.3. *Ends at:* the five settings §3's standing line counts all
have a control, and an install with no `image` binding says so plainly rather
than failing a turn obscurely.

*Proof obligation:* `packages/client/src/play/…` component tests for the three
that are this phase's surface, and — **because P7B.5's check now exists** — any
route these controls need has a client caller or a written exemption in
[`route-callers.test.ts`](../../../packages/server/src/routes/route-callers.test.ts).
*That is new since this document was drafted and it is the cheap half of
[work plan §2.3](01-work-plan.md)'s standing line: the two role bindings go on
[P2B](10-p2b-provider-configuration.md)'s existing surface, and the other three
are what P9.4 owes.*

#### Done — 2026-09-16, `49f43c2`

***A per-mode default cannot be written into `session.channels` at creation, and
the suite said so in twenty-odd voices.*** The first build seeded it there, which
reads as the obvious place for [04 §6.1b]'s *a Treatment proposes, a Setup
overrides, and the running session owns it*. But a value in that map with no
effect behind it is exactly what [P6.0b]'s reconciliation calls a **hand edit**:
the next turn folded it into a user-attributed divergence turn, and every *writes
no turn* assertion in the build went red at once. The map is derived from the
effect log; **a default is not a change anybody made**. `readIllustration` takes
the mode's default as a fallback parameter instead — the channel still says what
unspecified means for a mode that declares nothing, and a person who turns the
feature off writes a real effect that beats both.

***"The same step invoked by hand" is made literally true, through
`turns/preview.ts`'s seam.*** A preview is a route-driven read that assembles
through `gatherAssemblyInputs` and stops at `planCall`; `renditions/illustrate.ts`
is a route-driven **act** that assembles through the same gather and goes one
step further, to `performCall`. Neither mints a job nor writes a turn, and
neither can disagree with the runner about what was in play, because all three
read one gather. §1.3's `[OPEN]` falls out of it in one argument —
`parentTurnId: turnId` **is** recorded state — and [06 §10.6]'s marker is struck
with the date.

***The one honest cost, stated rather than discovered later***: a hand-pressed
illustration's `fast` call is on no turn's tape, because there is no turn. The
provenance survives on the rendition — binding, seed, fragments as sent — and
what is absent is the token accounting. Making it a turn would put a node with no
prose in somebody's transcript, which is a worse trade for a story than a missing
line in a cost total.

~~[26 E4]'s budget is where it is properly answered.~~ ***Miscited, and corrected
2026-09-16 by [P11 §0.2](28-p11-implementation.md)'s re-audit.*** [26 E4] is
*session import from other platforms*; there is no budget question in
[26](../26-open-questions.md) at all. **Aggregate spend tracking is post-1.0**
([25 §3](../25-roadmap.md)), which [10 §3](../10-ui-surfaces.md) and
`CostSummary`'s docstring both already said — so the correct reading is that
nothing in 1.0 totals this, and the note's job is to make sure whatever does
knows the call is out there.

***And a bug the stage found in its own predecessor***: `imageBinding` on the
runner options resolved the `image` role a **second** time, in a different
method from the gate that resolved it first — and `app.ts` passed `() => null`,
so every record's `provenance.binding` was null while its digest named a model.
The binding rides on the step's report now, so the record and the reuse key
cannot name different models.

***And a cancellation that never fired — fixed 2026-09-26 in `af5811a0`,
recorded here 2026-10-03.*** The illustrate route's comment said *"the client's
disconnect cancels the moment call"* and wired it as `request.raw.on('close')`.
On a `POST` with a body that event is emitted once Fastify has read the body,
before the handler runs, and emitted once — so a listener attached after the
route's two awaited reads never ran, and every moment call ran to the end for a
page nobody had open, the picture asked for and paid for. Nothing in the suite
could see it, because `inject` cannot express a client leaving a `POST`.
`routes/disconnect.ts`'s `disconnectSignal` reads the **response** instead — a
response that closes without having finished is the client leaving — with a
`destroyed` check for a client that left during one of the route's own awaits,
and its tests go over a real socket. *Recorded here late, and on purpose*: until
this date the fix lived only in [the API reference](../../api.md)'s illustrate
section and in the helper's own comment, so this stage's record still read as
if the comment had been true. The same bug was found independently the same
day on the branch that became [P15](33-p15-setup-from-a-turn.md), whose §0.5
says why its own fix was dropped at the merge for this one. *No gate row is
edited*: this stage's proof obligation was component tests and the
route-callers check, and neither was wrong — the fault was in a claim a comment
made.

### P9.5 — The workbench over renditions

Deferred here by name from [P3 §5](15-p3-implementation.md). Renditions are
worth showing for the same reason calls are: they cost money, they can fail, and
*why did this one come out different* is answerable from two seeds. No new
viewer — the block and call tables already exist and this is a third row kind.
*And a fresh precedent for adding one*: [P8.1](25-p8-implementation.md) gave
`BlockSource` a `summary` arm and the block table rendered it, which is the same
move at a smaller size (2026-09-16).

*Depends on:* P9.3, because *why are these two different* needs two.
*Ends at:* the demo.

*Proof obligation:* `packages/client/src/workbench/…` — *a rendition row names
its seed, its model and what the capper dropped*. The row that must not be
missing is the dropped-fragment one: `CappedPrompt` already records it
(§0.1's finding 6) and a workbench that showed the prompt without it would be
showing a prompt that was never sent.

#### Done — 2026-09-16, `041882e`

***And it fixed a live defect in P8's arm, which is why this stage touches
`address.ts` at all.*** [P8.1](25-p8-implementation.md) gave `BlockSource` a
`summary` arm and nobody gave it a **label**, so a summary block rendered in the
workbench's Source column as the bare word `summary` — the exact thing
`address.test.ts`'s `expect(address.label).not.toBe(source.kind)` exists to
catch. It never saw it, because the arm was missing from that test's `EVERY_ARM`
fixture too; `schema` was missing from the fixture as well. Both labels and both
fixture rows landed here, and the comment says what the shape really argues for:
**a hand-enumerated fixture over a union the compiler cannot iterate is only as
total as the hand**, and a type-level exhaustiveness check is owed the next time
an arm lands. *This is the third instance of the pattern this document keeps
finding — a check that would have caught something, pointed at a list that did
not contain it.*

---

## 3. Verification — the P9 exit gate

~~Sketch; expand on revisit.~~ *The fifteen steps were the sketch and they
stand. §3.1, added 2026-09-15, is the split: [manual testing §0](05-manual-testing.md)'s
two-tier gate, adopted 2026-09-09 — eleven days after this document was drafted
— with cells to write in. **The fifteen are never edited**, which is that model's
first honesty condition.*

1. A turn completes on text with an image still pending, and the session is
   fully usable while it resolves.
2. The image arrives over the event stream and renders in place; close the tab
   mid-generation and reattach to the finished result.
3. A failed rendition is a placeholder with a retry, and the turn is `complete`
   rather than `failed`.
4. Illustrate a turn from forty turns back: a **second** rendition appears
   beside the first and the first is still selectable.
5. Set `asset` to null on both: the recipes remain, the placeholders render as
   regenerable, and re-running either produces the same request (the property
   test).
6. Two renditions of one turn carry different seeds, and the workbench says so —
   *why did this one come out different* is answerable without guessing.
7. A prompt that overruns the provider's cap drops its lowest-ranked fragment
   and says which, rather than truncating mid-sentence.
8. With no `image` binding, the controls say plainly that nothing can serve them
   — the dangling posture, not an obscure turn failure (§1.2).
9. Branch a turn that has renditions: the branch inherits them by inheriting the
   turn, and nothing was replayed to make that true.
10. Walk into a new place and a backdrop follows; walk back and the first one
    returns **without a second generation being dispatched** — asserted on the
    job, not on the pixels, because a reuse that quietly regenerates looks
    identical on screen and only shows up on a bill.
11. Rewind past the doorway: the earlier backdrop is showing again, and the
    diff of what P9 wrote to make that work is empty (§1.7). Branch at the same
    point and both branches are in their own room.
12. Turn the backdrop off: Play is pixel-identical to a text-only session, and
    no `image` call was made.
13. An illustration renders **at its anchor** — inside the prose, at the sentence
    the moment call quoted, not underneath the message
    ([06 §10.4a](../06-modes-and-turn-pipeline.md)).
14. Edit that message so the quote no longer occurs in it: the image renders at
    the end of the message, the unresolved anchor is recorded, and the rendition
    is still `ready`. A miss is ordinary and must never be an error — this is the
    assertion that stops the natural implementation from throwing.
15. Re-create an evicted rendition and **no text call is made**: the moment is
    replayed from `prompt`, not asked for again (§1.1, P9.1). Assert on the call
    log, because assertion 5's byte-identical request passes either way on the
    day it is written and only diverges later.

**And the standing line from [work plan §2.3](01-work-plan.md): no phase exits with
configuration that has no surface.** Five settings arrive here — the per-session
illustration mode, the per-mode default, the backdrop's own on/off, and two role
bindings, since the moment call (P9.1) needs a `fast` binding beside the `image`
one. Both bindings belong on
[P2B](10-p2b-provider-configuration.md)'s existing surface rather than a new one;
the other three do not have a surface anywhere in
[10](../10-ui-surfaces.md) yet, and P9.4 is where that debt comes due.

### 3.1 The split, and what closes this gate

*Added 2026-09-15. The criterion, applied rather than argued
([manual testing §0](05-manual-testing.md)): a check is critical **iff (i)** it
can falsify a claim **this phase** makes about itself rather than one its gate
transports, **(ii)** the claim compounds, and **(iii)** it is walkable with what
is to hand.*

***Clause (iii) decides this gate, and it decides it against almost all of it.***
**Twelve of the fifteen steps want pixels, and nothing in this project can make
one.** [Manual testing §3](05-manual-testing.md)'s ~~nine~~ ***ten*** standing
prerequisites contain no endpoint that serves the `image` role — R2 is a chat
endpoint — so §0.2's R-row is not a formality but **the thing that decides
whether this gate has a critical list at all**. Until it exists, every row below
that needs an image is *blocked* rather than *deferred*, and the difference
matters: a deferral is a judgement and a block is an errand.

***The row is now **R10** and it is why the number changed*** (2026-09-16, §0.3's
item 6). Nothing else moved: R10 is *"not to hand"*, the four sittings that hold
a phase open (K, L, M, N) all queue on a **chat** endpoint that does not answer
it, and both criticals below still wait on this one thing.

| Step | Answered by | State |
|---|---|---|
| **1** A turn completes on text with an image pending, session usable | **a test** | **AUTO** — `p9-gate.test.ts`, P9.2's obligation, against a scripted provider. The one row of the twelve that needs no real endpoint, because *pending* is a state and not a picture |
| **2** The image arrives over the stream; close the tab and reattach | **a person** | **critical — C1, and the anchor.** (i) ✓ [06 §10.2](../06-modes-and-turn-pipeline.md)'s *the only workable design* is this phase's own claim; (ii) ✓ every surface after it assumes arrival-in-place works; (iii) **blocked on the endpoint**. *The reattach half is what a test cannot reach: a browser that was closed is not a client the harness has* |
| **3** A failed rendition is a placeholder with a retry; the turn is `complete` | **a test** | **AUTO** — a provider that refuses is cheaper to script than one that succeeds, so this row is walkable **before** the endpoint exists and should be written first |
| **4** Illustrate a turn from forty back: a **second** rendition, first still selectable | **a test** | **AUTO** — P9.3's obligation. Accumulation is a list on an object; the judgement about whether the second is *better* is not this row's |
| **5** `asset: null` on both: recipes remain, placeholders regenerate, same request | **a property test** | **AUTO**, and it is the phase's central claim — the recipe-survives-eviction property. *It only closes with finding 6's arm: re-creation makes no `fast` call* (step 15) |
| **6** Two renditions carry different seeds and the workbench says so | **a test** | **AUTO** — a row rendering a field. Fails (ii): a missing seed on a row is a rendering fix at any time |
| **7** A prompt over the cap drops its lowest-ranked fragment and says which | **a test** | **AUTO**, and **cheaper than this document assumed** — `prompt-caps.test.ts` already asserts the behaviour (§0.1's finding 6); what this row adds is that the *step* passes its fragments ranked and puts the drop on the record |
| **8** With no `image` binding, the controls say so plainly | **a test** | **AUTO** — [P2B](10-p2b-provider-configuration.md)'s dangling posture, transported. Fails (i): the posture is P2B's and this is its fourth instance |
| **9** Branch a turn with renditions: inherited, and nothing replayed | **a test**, and the assertion is a **diff** | **AUTO** — [07 §2](../07-branching.md)'s claim, and P9.3's obligation says why it is a diff rather than a behaviour |
| **10** Walk back into a place: the first backdrop returns, **no job dispatched** | **a test** | **AUTO** — asserted on the dispatch, not the pixels. **The money row**, and the one §1.7's digest exists for |
| **11** Rewind past the doorway; branch and both branches in their own room | **a test** | **AUTO** — same mechanism as 9, and the same empty diff |
| **12** Backdrop off: Play is pixel-identical to a text-only session, no `image` call | **a test** | **AUTO** — and the call-log half is the one that matters, since *looks the same* and *costs nothing* are different claims |
| **13** An illustration renders **at its anchor**, inside the prose | **a person** | **critical — C2.** (i) ✓ [06 §10.4a](../06-modes-and-turn-pipeline.md)'s anchor is this phase's, and §1.6 says it is the field with a consumer here; (ii) ✓ the count judgement's whole later design sits on it; (iii) **blocked on the endpoint**. *A test can assert the offset; only a person can say the picture landed where the sentence is* |
| **14** Edit the message so the quote is gone: image at the end, miss recorded, still `ready` | **a test** | **AUTO** — P9.1's obligation, and the row that stops the natural implementation from throwing. **A miss is ordinary**, which is exactly the kind of claim a person walking happily never exercises |
| **15** Re-create an evicted rendition and **no text call is made** | **a test**, on the call log | **AUTO** — and it must be asserted in that direction, because step 5's byte-comparison passes either way on the day it is written |
| **The standing line** — no configuration without a surface | **a checklist of five**, and a test for the routes | **critical in part.** Three settings have no surface anywhere in [10](../10-ui-surfaces.md); two bindings go on P2B's. *The mechanical half is automatic since [P7B.5](24-p7b-presets-and-prompts.md): a route with no caller fails the suite* |

**The critical list, derived rather than preferred — two items, and both are
blocked on one errand.**

- **C1 — an image arrives and renders in place, and a reattached client finds
  it.** Take a turn, watch the text land, watch the picture follow. Close the tab
  while it is generating and come back to the finished result.
- **C2 — the picture lands *in* the prose, at the sentence the moment call
  quoted.** Not underneath the message. Read the paragraph and say whether the
  image is where the words are.

***Two is unusually short, and the reason is not that this phase is safe.*** It
is that thirteen of fifteen rows are about **mechanism** — a dispatch, a digest,
a diff, a call log — and mechanism is what tests are for. What is left for a
person is the two rows where the claim is about *what it looks like*, which is
the one thing no assertion reaches. **That is also why the endpoint is the
phase's real prerequisite**: both criticals are blocked on it, so a P9 that
ships without one closes with a gate that proved every mechanism and looked at
no picture.

***What this list cannot reach, said because §5 already worries about it.***
Nothing here asks whether a generated image is any *good* —
[testing §4.3](03-testing.md) forbids building a quality eval and §4 names an
image eval as the most tempting version of that mistake. So the gate answers
*does it arrive, is it reproducible, does it cost what it should* and is silent
on *is it worth having*, which is [work plan §0.4](01-work-plan.md)'s question
and §5's first bullet. **A closed P9 is not a verdict on renditions.**

### 3.2 What was answered — recorded 2026-09-16

*The results table [manual testing §0](05-manual-testing.md) asks for, in
[P8 §3.2](25-p8-implementation.md)'s shape. **The fifteen steps above are not
edited**; this is the second table, which is that model's first honesty
condition and the whole reason there are two.*

| Step | Discharged by | Result |
|---|---|---|
| **1** Turn completes on text, picture pending, session usable | `routes/p9-gate.test.ts` | ✅ — and the second turn is taken while the first picture is still being made, which is the half a `pending` assertion alone would not reach |
| **2** Arrives over the stream; close the tab and reattach | — | **C1, blocked on R10. Never walked.** The frame and the upsert are built and the reducer folds them; what is unproven is a person watching it |
| **3** A failed rendition is a placeholder with a retry; turn `complete` | `routes/p9-gate.test.ts` | ✅ — written first, per §3.1, and it is what forced the error to be a **class** rather than a provider's sentence |
| **4** Illustrate an old turn: a second rendition, first still selectable | `routes/p9-gate-controls.test.ts` | ✅ — asserted on the **names** (`<turnId>.0`, `<turnId>.1`), because additive-not-replacing is true by the id being different rather than by a check |
| **5** `asset: null` on both: recipes remain, placeholders regenerate | `routes/p9-gate-controls.test.ts`, `routes/p9-gate-selection.test.ts`, `play/Rendition.test.tsx` | ✅ — the eviction is **performed rather than simulated**: the record is written with `asset: null` and re-run, and the prompt, the digest and the seed come back identical. The client half is [P9 §1.4]'s contingency, which is what makes eviction a later decision rather than a migration |
| **6** Two renditions carry different seeds and the workbench says so | `workbench/turn/views.test.tsx` | ✅ — the fixture makes the two siblings identical in every visible way **except** the seed, or the question is not sharp |
| **7** A prompt over the cap drops its lowest-ranked fragment and says which | `renditions/assemble.test.ts`, `workbench/turn/views.test.tsx` | ✅ — and the dropped fragment is **struck rather than hidden** in the panel, which is the half that makes a capped prompt legible |
| **8** With no `image` binding, the controls say so plainly | `routes/p9-gate-controls.test.ts` | ✅ — both halves: the turn is untouched and no `fast` call is made either, because the step is kept **out of the plan** rather than idled |
| **9** Branch a turn with renditions: inherited, nothing replayed | `routes/p9-gate-selection.test.ts` | ✅ — the assertion is a **diff**, over four named reconstruction modules, with `store.ts`'s exclusion argued rather than listed |
| **10** Walk back into a place: first backdrop returns, **no job dispatched** | `routes/p9-gate-selection.test.ts` | ✅ — the money row, asserted on a **count** rather than an absence. *Underneath, 2026-09-30*: ~~✅~~ **✅ for the count, not for the step** until `75f88d0` — no job was dispatched, and nothing returned: a generated backdrop was never drawn on the stage, and nothing selected the one reused, so the room you left stayed. The test now asserts the selection beside the count |
| **11** Rewind past the doorway; branch and both in their own room | `routes/p9-gate-selection.test.ts`, `modes/scene/src/mode.test.ts` | ✅ — and the `escapes` trap that was not there when §1.7 was written is asserted on the mode side, where the declaration lives |
| **12** Backdrop off: pixel-identical to text-only, no `image` call | `routes/p9-gate-controls.test.ts` | ✅ **in part** — the call-log half is discharged. *Pixel-identical* is what a person checks and is carried by C2 |
| **13** An illustration renders **at its anchor**, inside the prose | `play/Rendition.test.tsx` **in part** | **C2, blocked on R10. Never walked.** The offset, the split and the fallback are asserted; *the picture is where the sentence is* is not a thing an assertion says |
| **14** Edit the message so the quote is gone: image at the end, still `ready` | `routes/p9-gate-controls.test.ts`, `play/Rendition.test.tsx` | ✅ — the row that stops the natural implementation from throwing, on both sides of the wire |
| **15** Re-create an evicted rendition and **no text call is made** | `routes/p9-gate-controls.test.ts` | ✅ — asserted **on the call log**, in the same test as step 5 and for §3.1's reason: step 5's byte-comparison passes either way against a scripted model. And it is **structural** — there is no assembly on that path and no role to resolve, so the claim is about a code path that does not exist rather than a flag |
| **The standing line** — no configuration without a surface | `route-callers.test.ts`, `play/SessionPanel.tsx`, `modes/scene` | ✅ — the three settings have controls, the two bindings sit on P2B's surface, and the three rendition routes left `route-callers.test.ts`'s OWED map |

***Thirteen AUTO rows discharged; two criticals blocked and never walked.*** The
distinction §3.1 draws is the one this table keeps: **a deferral is a judgement
and a block is an errand**. C1 and C2 are not deferred — nobody decided they were
not worth walking — they are waiting on
[R10](05-manual-testing.md), an endpoint that serves the `image` role, which no
other outstanding sitting produces. They are carried as
**[sitting O](05-manual-testing.md)** and this phase **does not close** until
somebody walks them.

***What that leaves true and what it leaves unproven, plainly.*** Every claim
this phase makes about *mechanism* is asserted: a turn that does not wait, a
recipe that survives its pixels, a digest that matches a place, a diff that is
empty, a call that is not made. What is unproven is every claim about *what it
looks like* — that a picture arrives in a browser, and that it lands beside the
sentence it is of. A phase whose gate proved every mechanism and looked at no
picture is exactly what §3.1 warned this would be, and it is what it is.

***Rows 5 and 6 were green over a seed that never left the process — found
2026-09-26.*** ~~Both were discharged against the `FakeProvider`, which echoes the
seed it is handed.~~ Row 5 was discharged against the `FakeProvider`, which
echoes the seed it is handed, and row 6 against a literal fixture that states one
(`workbench/turn/views.test.tsx`; corrected 2026-10-03, when this note merged to
main). The real adapter passed it to a parameter
`@ai-sdk/openai-compatible` marks unsupported and drops, so no endpoint was ever
sent one while the record and the workbench went on stating it — [manual gate
§4.1](11-p2-manual-gate.md)'s *"a stub agrees with whatever understanding wrote
it"*, in the
field [06 §10.7](../06-modes-and-turn-pipeline.md) calls load-bearing, and the
same promise §1.2 found the Pollinations path breaking on purpose. **The steps and
the results above stand as recorded.** What changed is the adapter, which now
sends the seed where a connection declares `supportsImageSeed`
([22 §3](../22-internal-contracts.md)), and the record, which says whether it
did (`seedSent`). ~~*Sitting O's endpoint needs that capability declared for row 6
to hold at the wire*; without it, the workbench now says — correctly — that the
seed was not sent.~~ *Sitting O never walks row 6*: row 6 is **AUTO**, discharged
by `workbench/turn/views.test.tsx` above, and O1–O3 clear rows 1, 2, 4, 12, 13 and
14 ([manual testing §4, sitting O](05-manual-testing.md)). Declaring the capability
on sitting O's endpoint is a courtesy, so the person walking it is not shown *Not
sent* beside every seed and file it as a finding — O0 now says so — and without
it the workbench says, correctly, that the seed was not sent (corrected
2026-10-03, when this note merged to main: it claimed a dependency the sitting
does not have).

***`supportsImageSeed` has no control, and is owed one — recorded 2026-10-03.***
It was written 2026-09-26 and merged on this date, and like `rendersImages` it is
declared per connection and set only by hand-editing the connection file or
through the admin connections route — the Connections form has no control for
either ([the guide](../../guide/connections-and-models.md#editing-connection-files-by-hand)
tells a person how, as a fact rather than a debt). Seed sending cannot be used at
all without someone setting it, which is exactly [work plan
§2.3](01-work-plan.md)'s test, so **the standing line's ✅ above does not cover
it**: the row stands as recorded for what it named, and this is a debt beside it,
carried here so it does not live only in a merge message. The natural place for
the control is beside the *Makes pictures* control the `practical-wozniak` branch
brings to the same form. ***Paid later the same day*** (2026-10-03, the
recommended answer, which the owner deferred to): that branch merged with
[polish §25](06-polish.md#25-a-connection-can-be-tried-without-taking-a-turn),
and the form now has **Sends a seed with a picture** beside *Makes pictures*,
in a group headed *Drawing pictures*, shown once the connection says it makes
pictures. Both flags are a control now and a hand edit still works; the
standing line's ✅ above covers seed sending from this date, and sitting O's O0
names the control.

---

## 4. Out of scope, deliberately

Video and speech as *implementations* (the shape is general from P9.0 and the
fields that keep them cheap ship now — §1.6); **the count judgement** — which
moments of a turn deserve a picture, and how many — now specified in full at
[06 §10.4](../06-modes-and-turn-pipeline.md) and deliberately not built here,
along with the storyboard surface downstream of it; an eviction *policy* (§1.4 —
the hook, not the policy); **lore-conditioned renditions**
([25 §3](../25-roadmap.md): committed
intent rather than a maybe, and deferred because *choosing which images* is the
hard part when six active entries and three present actors all carry references
— it wants P7's location channel for an honest selector and real sessions to
tune against — and §1.7 is explicit that a backdrop is the most plausible excuse
for crossing that line and still does not cross it); the Character Studio
([18](../18-character-studio.md)) — which is now a committed release at 3.0 and
therefore the nearest post-1.0 consumer of everything this phase builds, rather
than a member of the authoring tier at 6.0; any model-quality evaluation of
generated images
([testing §4.3](03-testing.md) — do not build quality evals, and an image eval is
the most tempting version of the mistake).

**The count judgement is the one deferral on that list that constrains this
phase**, and the constraint is worth stating because it is easy to honour now and
expensive to recover later. Deferring a design is only cheap when the phase
before it does not foreclose it, so three things are P9's even though the
judgement is not: the step contract emits a **list** of rendition requests rather
than one, from the first commit, with a list of one; the anchor field ships and
is used (§1.6); and the moment call is shaped as *the* moment of a turn, so
widening it to a list of moments with a salience is a change to one call's
schema rather than a new call. Nothing here builds the cap, the ranking or the
pacing dial ([06 §10.6](../06-modes-and-turn-pipeline.md)).

**Three more that backgrounds specifically do not drag in** (§1.7), named
because each is one step away from something this phase does build:

- **Sprites and expression selection stay P7's.** They are steps writing
  channels ([06 §7.2](../06-modes-and-turn-pipeline.md)) and a sprite is not a
  rendition at 1.0. The backdrop is here because it has no source anywhere else;
  sprites have one.
- **Video backdrops stay expressible and unbuilt.**
  `{ kind: "video", purpose: "background" }` is the shape §1.7 preserves and
  §1.6's posture applies unchanged: the union is general, the implementation is
  images.
- **SillyTavern's `backgrounds/` folder stays skipped.**
  [P4](16-p4-implementation.md) counts it among the directories it does not
  convert, correctly — thirty loose JPEGs are not a StoryEngine object — and
  giving backdrops a generator is not a reason to reopen an import decision. An
  uploaded backdrop reaches the channel the way any authored image does.

---

## 5. The honest size, and what only the revisit can settle

*Added 2026-08-31. §1.7's addition folded in 2026-09-01.*

**The contract is the phase; the pictures are the easy part.** P9.0 defines
`Rendition` — a type six phases of design have referred to and none has written
— and once it exists, generating an image is a provider call and a job. The
risk is entirely in getting the type right, because it is the one thing here
that later phases and later *releases* will be stuck with: video and speech are
named in [25](../25-roadmap.md) as things the `kind` union and
`scope.messageId` should keep cheap, and §1.6 is the three fields that do it —
the third, `scope.anchor`, being the one this phase actually uses.

**The provider layer is the second real cost, and it is structural.** §1.2 says
plainly that our provider layer speaks chat and no image endpoint does. That is
not an adapter, it is a second shape of provider — and the honest question the
revisit has to answer is whether image providers go behind the same
`Connection` vocabulary or beside it. Deciding that during P9.1, under pressure
to show a picture, is how the answer gets made by accident.

**Backgrounds did not change that, and this document should not pretend they
made the phase much larger.** §1.7 adds one field to the contract, a second
ranking of a fragment set the step already assembles, a channel write, and a
control — and it removes an absence that P7 would otherwise ship: a backdrop
channel with no possible value. The phase is still short. What it is no longer
is *only* illustration, and the header says so.

**What is smaller than it looks:** ~~jobs that never block (P9.2) reuse the
operational store's job vocabulary, which has existed since P2 and by then will
have carried imports as well as turns.~~ ***That was wrong in both halves***
(§0.1's finding 9, 2026-09-15): `state/jobs.ts`'s `Job` is turn-shaped and exists
to enforce *only one turn may advance a session* — **the one invariant a
rendition job must not inherit** — and imports never used it. P9.2 is a second
job shape beside the first; still small, and not a reuse. ***What is genuinely
smaller is P9.1***, whose ranked-fragment capper is written, tested and waiting
for a caller (finding 6). Accumulation and selection (P9.3) is a list on an
object. The backdrop's persistence across turns looks like the
exception and is the cheapest part of it — a pointer in channel state, which is
machinery [07 §2](../07-branching.md) already paid for.

**What is at risk of being cut and should not be:** the workbench over
renditions (P9.5). It is the only surface that answers *why does this picture
look like this*, and this project's whole posture is that a generated thing
explains itself. Cutting it leaves renditions as the one subsystem with no
account of itself.

**~~Three things only the revisit can settle~~ — re-graded 2026-09-15 at the
readiness audit. One of the three is now answerable at a desk and is not
answered here on purpose; the other two are unchanged:**

- **Whether renditions are worth 1.0 at all.** Not currently asked, and it
  should be. This is the phase most easily deferred to a later release without
  the core loop noticing, and [work plan §0.4](01-work-plan.md)'s further-cuts
  discipline is where that argument belongs if PLAYABLE says the loop is thin
  elsewhere. **§1.7 raises the price of that cut** without settling it: deferring
  P9 now also leaves P7 shipping a backdrop channel nothing can fill, so the cut
  has to take Scene's backgrounds with it or explain what does. Worth weighing
  rather than treating as an argument that wins — a channel with no value is a
  smaller embarrassment than a subsystem nobody wanted.

  ***And the question is posed as all-or-nothing because no smaller P9 is
  written down*** — 2026-09-16, and it is this build-out's one addition to this
  section. [P8 §5](25-p8-implementation.md) named a **fallback cut** in advance,
  and [P8](25-p8-implementation.md) then shipped it: *"the cut was taken
  deliberately rather than under pressure, which is the whole reason §5 named
  one."* **This section names none**, so the only moves available to a P9 under
  pressure are *build it* and *defer the phase*, and the second is the one that
  leaves P7's channel unfillable. That is a gap in the plan rather than in the
  phase, and closing it is a paragraph rather than a decision — but it has to be
  the revisit's paragraph, because the two candidate shapes cost opposite things
  and this document should not pick between them at a desk:

  - **Backdrops first, illustration deferred.** P9.0, §1.7's ranking, the digest
    and P9.3's channel binding; no moment call, no anchor, no per-turn
    illustration. It fills P7's channel, keeps the contract and the recipe, and
    ships the one purpose that caches perfectly — and it removes **both**
    criticals' subjects, which is the shape [P8](25-p8-implementation.md)'s cut
    took and the reason that phase merged open. *It does not remove R10*: a
    backdrop is still an image.
  - **Illustration first, backdrops deferred.** The document's own reading order,
    and it costs exactly what §1.7 says it costs — P7 ships a backdrop channel
    nothing can fill, for a second release.

  **Neither is the cut yet**, and saying which is the revisit's, next to the
  question above it. What the build-out can say is that the machinery for
  *taking* a cut honestly now exists and has been used once: a phase merges, the
  status line says what was left out, and the gate's own steps are never edited
  to match ([manual testing §0](05-manual-testing.md)).
- **Eviction** (§1.4), which the document already makes contingent on the hook
  shipping.
- **What a rendition costs a person.** Every other subsystem here is free to
  run; this one spends money per image on most providers, and none of the
  budget, quota or consent vocabulary that implies exists anywhere in the
  design. That is the gap most likely to be discovered late.

  **Backgrounds arrive with half of their own answer** (§1.7) and it is worth
  separating from the rest. They are the rendition the engine would run on its
  own, which is the version of this question that turns into a bill without
  anyone choosing it — and they are also the only one that caches perfectly, so
  the digest makes a backdrop cost roughly one image per *place* rather than one
  per turn. That removes backgrounds as the reason this becomes urgent. It does
  not answer the question, and the revisit should resist reading it as though it
  had: nothing here gives a person a budget, a quota, or a number before the
  fact.

  **The count judgement brings the other half, and it arrives after this phase**
  ([06 §10.4](../06-modes-and-turn-pipeline.md), §4). Two of its rules are cost
  rules wearing other clothes: a cap enforced in code rather than requested in a
  prompt is the only kind that bounds a bill, and a cadence dial gating the
  judgement puts a *rate* on illustration the way §1.7's digest puts one on
  backdrops. Both narrow the gap. Neither closes it — a rate is not a budget, and
  a person still cannot see a number before the fact — so the vocabulary this
  entry asks for is still missing, and is now missing from a phase later than
  this one too.
