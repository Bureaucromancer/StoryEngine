# 08 — P6 implementation plan

**Status: skeleton, expanded 2026-08-31 with a readiness audit and the deferrals
collected, and re-audited 2026-09-01 at P5's close — see §0.1, which is the
current one and which corrects §0, §1.3, §1.6 and §5.** ~~Drafted during P1; to be revisited before the phase starts.~~
Drafted during P1 and expanded once P5 was planned, which is the point at which
this phase is next-but-one and its preconditions are checkable rather than
assumed. **It is still a skeleton and the revisit still owes it a plan** — see
§5 for what only PLAYABLE and P5 can settle.

Unusually for these plans, most of P6 is *already decided* — the tree model,
swipes-as-branches, snapshots-as-cache and the tape are settled in
[09](../09-branching.md) and [07 §14.5](../07-tech-stack.md) — so this document is
mostly sequencing plus the two open questions those documents left (C8, C9)
**and the four decisions other phases have since handed here** (§1.7–§1.9).
Format follows [03](03-p1-implementation.md).

**P6 delivers**, from [01 P6](01-work-plan.md): branching, rewrite/reroll, the
RNG tape in anger, and sibling navigation. **Why before modes:** it changes the
shape of the turn store's *use*, and every mode built after it inherits the
behaviour for free; built after modes, it is a migration.

**The demo that defines done:** *scroll back to any prior message, press one
button, and be on a new line of story — with channel state correct, summaries
untouched (none exist yet — the constraint is on shape, not features), and the
old line intact and reachable.* Marinara's UX on our storage:
no checkpoint precondition, no branching mode, cheap enough to be casual
([09 §1](../09-branching.md)).

**What P2 already bought.** `parentTurnId` is on every turn from the first
([04 §2.5](04-p2-implementation.md)), segments append in creation order
([02 §5.5](../02-data-model.md)), effects are complete and reversible, and the
tape is recorded keyed by site. P6 builds no storage; it builds **navigation,
reconstruction performance, and the two-gesture UI** over storage that was
tree-shaped all along. If P6 finds itself migrating the turn store, P2 broke
its contract.

**CI this phase establishes:** the replay property test —
*for a fixture session, state at every index is identical reconstructed from
zero or from the nearest snapshot* ([10 §3.3](10-testing.md),
[09 §4](../09-branching.md)). One property protecting branching, regeneration and
undo simultaneously.

---

## 0. Readiness — audited 2026-08-31

**P2's claim was that P6 builds no storage, and it holds.** Checked against the
code rather than against the promise, because *"if P6 finds itself migrating the
turn store, P2 broke its contract"* is only worth writing down if somebody
eventually looks.

**Already there, and more of it than this document assumed:**

- **`parentTurnId` is on every turn** (`shared/src/turn.ts:528`), with the
  comment naming P2's reasoning. The store is tree-shaped on disk today.
- **`Tape` is on the turn record** (`turn.ts:538`), and every draw carries a
  flag for whether it came off a tape or from the source (`turn.ts:108`). The
  rewrite/reroll distinction has somewhere to be recorded before anything
  rerolls.
- **`ChannelEffect.scope` exists** (`turn.ts:487`) — and §1.5 undersells what
  landed. It says *P6 gets a field, not a migration*; in fact `applyEffects`
  (`sessions/store.ts:429`) already **skips escaped effects when replaying**, so
  the rule is applied and not merely storable. Its neighbouring comment reasons
  explicitly about branches: a `delete` rebuilds the map without the key rather
  than mutating, *"so a channel that was removed on one branch must not
  disappear from a map another branch is still replaying against."* That is P6's
  invariant, written at P2, under test.
- **The head snapshot is derived and says so** (`sessions/channels.ts:173`),
  with the failure mode [02 §8.1](../02-data-model.md) warns about — *"a bug that
  only surfaces at P6 and is expensive by then"* — argued against in the code
  itself rather than left to this document.

**Not there, and this is the phase's actual size:**

- **No snapshot *cache*.** There is no depth-indexed cache and no eviction, and
  `sessions.snapshotEveryNTurns` reads nothing. ~~and no walk-up-replay-forward.
  P6.0 starts from nothing.~~ **Corrected at §0.1:** the walk and the fold both
  exist and compose —
  `replayChannels(walkPath(turns, id))`, in production at `store.ts:400` — so
  P6.0 starts from a tested O(depth) reconstruction and adds a cache in front of
  it. `store.ts:453` says the narrower true thing already.
- **No `BranchRef` and no `lastSelectedChildId`.** Neither name appears in the
  tree. §1.2's *back-and-forward resumes rather than guesses* is a field this
  phase adds.
- **`sessions.snapshotEveryNTurns` is declared `unread`** (`config.ts:278`),
  with the comment *"Snapshots are P6's. Nothing reads this."* So the
  provisional answer to C8 already ships as a settable number that changes
  nothing — which makes flipping it to `applied` a **named gate line** for this
  phase rather than a detail, under the standing rule from
  [01 §2.3](01-work-plan.md).

**Ground that moved under this document:**

- **P3 resolved an inherited contradiction by handing it here** (§1.8). The old
  P3 §1.2 said *"the UI simply shows the newest"* and P3 §3 preserved Marinara's
  *"editing does not change the reply already on screen"*. P3 §1.8 explicitly
  stops deciding: *"Whichever P6 picks, P3 no longer has to."*
- **P5's timing-state lean is contingent on this phase** in a way that runs both
  directions (§1.9), and P5's own §6 says so.
- **P5's gate step 14 changes meaning when P6 lands** — timing counters
  reconstructing at an old node is a replay-from-zero test before P6 and a
  branch test after. Like the fixture-pair gate at P5.6, it wants editing in the
  stage that changes it, not repairing when it goes red.
- **P9 depends on reconstruction-at-a-node** ([P9 §1](20-p9-implementation.md)
  reasons from *"P6 shipped reconstruction at a node — so that turn's state is a
  thing that can be asked for"*). P6 is not the last phase to care about this
  machinery, which is an argument for the property test being the real
  deliverable.

### 0.1 Re-audit at P5's close — 2026-09-01, at `1aca082`

§5 ends by naming three things that would make this a plan: *P5 landed, so the
tape is non-empty and §1.3 is testable; PLAYABLE run; and a re-read of
[09 §5.1](../09-branching.md) against P8's chain.* Two of those are checkable
today and one of them turned out to be the wrong shape. This is that check, run
on branch `p5` after P5's document half landed.

**§0's citations all still hold, and the reason is worth stating first**: P5
landed nowhere near this phase. `git diff --stat 12a28d9..HEAD -- packages/server/src/sessions packages/server/src/turns`
is empty, so every code fact §0 records is still true at the line it names.
There is one drift — the per-draw flag is `turn.ts:109`; `108` is its docstring.

What follows is what §0 got wrong about the *size*, the precondition that did
not happen, and five things missing from its own list.

#### §0 is wrong that P6.0 starts from nothing

> *"No snapshot machinery of any kind … there is no depth-indexed cache, no
> eviction, and no walk-up-replay-forward. P6.0 starts from nothing."*

The first half is right and the last two clauses are not. **Walk-up-replay-forward
exists, in production, today**: `walkPath` (`sessions/segments.ts:188`) climbs
`parentTurnId` with a cycle guard and reverses so the path reads root-first, and
`replayChannels` (`sessions/store.ts:459`) folds `applyEffects` along it. Composed
— `replayChannels(walkPath(turns, id))` — they answer *state at a node*, and
`reconcileHandEdits` calls exactly that composition at `store.ts:400`.

The function §0 is describing already contains the correct, narrower sentence:
*"P2 has no snapshot **cache** — that is P6's, and it is an optimisation rather
than a mechanism"* (`store.ts:453`). So the code says the true thing and this
document said a bigger one.

**What P6.0 actually starts from is a tested O(depth) reconstruction, and what it
adds is a cache in front of it plus the generalisation of the property from
*head* to *every index*.** That is a real reduction in the stage §5 calls the one
most likely to be under-priced — and it is not licence to relax, because §5's
other claim survives intact: the property test is still the deliverable, and the
next section is why.

#### The precondition §5 names has not happened

> *"What would make this a plan rather than a skeleton: P5 landed, so the tape is
> non-empty and §1.3 is testable."*

**P5's *document half* landed. The retriever half did not**, and the retriever
half is the one that was going to draw. There is still no production draw site:
the runner constructs an `Rng` (`turns/runner.ts:302`) and copies its tape onto
the draft at every checkpoint, but nothing calls `rng.at()` anywhere outside
`rng/rng.test.ts` — the only other mention in the tree is a comment in
`turns/calls.ts:141` explaining why backoff deliberately does *not* draw. Every
committed tape is `[]`, and the P2 gate asserts it.

So §1.3's rewrite/reroll split is **still untestable when this phase opens**, and
gate step 3 has nothing to assert against. Worse than untestable, in one respect
that §1.3 has to face rather than inherit: [07 §14.6](../07-tech-stack.md) says
the reroll affordance must not appear when a turn consumed no draws — and with an
always-empty tape, that is *every* turn. Shipping §1.3 as written would build a
second affordance that is correct, unexercised, and never visible.

**Three ways out, and this document should pick one rather than discover which
happened.** P6 declares a hard dependency on P5.4–P5.6 landing first, which the
phase order already implies but the plan does not say. Or P6 takes the first
production draw site itself, which is scope it has not costed. Or P6 ships the
split behind a condition that is never true and says so in the gate, which is the
honest version of doing nothing. §1.3 is amended to state the dependency; it is
the reading that costs least and lies least.

#### Five things that are not there, which §0's own list does not name

§0's *"Not there, and this is the phase's actual size"* has four bullets. These
five belong beside them, and three are the difference between *branching is
storage-ready* and *branching works*.

- **The head-equality gate is the single line that makes branching impossible
  today.** `submitTurn` refuses any parent that is not the current head
  (`state/jobs.ts:162`, returning `stale`), and the route answers `412` with the
  head a client should rebase onto (`routes/sessions.ts:462`). The wire already
  carries `headTurnId` as an explicit field, so this is a rule to relax rather
  than a schema to migrate — but it is a rule, it is deliberate, and §1.7's
  stale-head bullet is about *this line*. It should be P6's first and cheapest
  change, named as a step.
- **`advanceHead` is child-of-head-only.** It computes the new channel map as
  `applyEffects(session.channels, turn.effects)` (`sessions/store.ts:367`) —
  incrementally, from whatever the head's map happened to be. That is correct for
  the only case P2 produces and wrong for every gesture this phase adds: select a
  sibling, promote a ref, resume back-and-forward, and the state is the *abandoned*
  branch's plus the new turn's effects. This is precisely the bug
  [02 §8.1](../02-data-model.md) says *"only surfaces at P6 and is expensive by
  then"*, sitting in the open, held back by the head gate above it.
- **And `gatherAssemblyInputs` has the same shape.** It walks `history` to
  `request.parentTurnId` (`turns/gather.ts:73`) and then takes channels from
  `session.channels` — the *head* snapshot — whenever the file exists
  (`gather.ts:77`). Assembling at a non-head node would pair one branch's history
  with another's channel state. Also unreachable today, also only because of the
  head gate, and also live the moment it is relaxed. **Two independent places key
  on the head snapshot; relaxing the gate without fixing both is the phase's
  sharpest foot-gun**, and it is an argument for the property test being written
  before the gesture rather than after.
- **Nothing inverts an effect.** §1.4 presents undo as applying `before` at the
  tip, and `before` is indeed required on every `ChannelEffect` (`turn.ts:459`)
  and set by all three constructors — but there is no invert or undo function in
  the codebase, and the `(channelId, scopeKey, path)` index §1.4 names has no
  table behind it. §1.4 is the most under-priced line in this document.
- **`scope: 'escaped'` has no producer.** `effects.ts`, `channels.ts:164` and
  `channels.ts:242` all hard-code `'session'`; the only `'escaped'` in the tree is
  a test. §1.5's *"P6 gets a field, not a migration"* is still true and now needs
  its second clause: the field exists, its only writer is a test, so the work is a
  producer plus the abandonment banner.

#### What P5 left under §1.9, and why it touches the headline

P5's own re-audit ([P5 §0.4](07-p5-implementation.md)) found two mechanical
blockers to its §1.1 lean and labelled them P6-adjacent. Both verified here.

`applyEffects` keys the channel map by `channelId` alone and **never reads
`scopeKey`** (`sessions/store.ts:435`, `:441`), so two entries' timing states
would overwrite each other. And `acceptEffect` throws on anything but a
whole-value set at `/` (`turns/effects.ts:49`) — with a comment that names the
ordering itself: *"the day something does, `applyEffects` is what has to change
first."* Meanwhile `ChannelEffect.scopeKey` is declared at `turn.ts:455` with the
docstring *"Which value, when the channel is scoped per actor **or per entry**"*.
The type anticipated P5's lore timing exactly, and nothing implements it.

**This is the one finding that reaches this document's headline.** §0 opens with
*"P2's claim was that P6 builds no storage, and it holds"*, and that stays true
for the *turn* store. But the map being rekeyed is `SessionFile.channels`
(`sessions/types.ts:61`) — a file on disk — so if §1.9 is to be met **by
construction** rather than by repair, somebody widens the effect log's key space.
Whether that is P5 or P6 is exactly what §1.9 is about; that it is *work*, and
work on a persisted shape, is new information for §5's size.

*And §1.9's own premise improved.* It assumes *"if P5 ships first — which the
phase order says it will — then P6 inherits a decision it did not make."* That
has not happened: the lean did not ship, there is no `se.lore.timing`, and P5 §1.1
and §6.1 are word-for-word what they were. **The window §1.9 calls free is still
open**, and its "cheap thing to do now" is now both cheaper and more urgent,
because the two blockers give the check a concrete address rather than a worry.

#### Two names in the code that encode models the design discarded

Both are the shape [P4 §7.4](06-p4-implementation.md) had before it was closed —
a schema written for a plan, and then nothing wrote it.

- **`turn.branch_id`** exists in the index (`index-db/migrations.ts:146`), is
  plumbed end to end as a defaulted fourth parameter (`index-db/sessions.ts:90`)
  and comes back on every search row (`:41`) — and **both call sites omit it**
  (`sessions/store.ts:341`, `index-db/rebuild.ts:131`), so every row's
  `branch_id` is NULL. It is also named for the model
  [09 §3](../09-branching.md) *explicitly discarded*: there is no `Branch` entity
  owning turns. §1.6 wants a **materialised path**, which is a different column
  that does not exist. So §1.6 inherits a decision — populate the column that is
  there, or add the one the design asked for and drop this one — rather than a
  field it can start using.
- **`SessionFile`'s docstring advertises branch refs the interface does not
  have** (`sessions/types.ts:41`: *"metadata, cast, branch refs, and the head
  channel snapshot"*), against [02](../02-data-model.md)'s `branchRefs:
  BranchRef[]`. §0's *"No `BranchRef`"* is right about the code and understates
  it: a reader of that file will believe the field is there.

*One more naming trap, since a reader who hits it will draw the wrong
conclusion:* there are **two different fields called `scope`** —
`ChannelDefinition.scope: 'session' | 'actor' | 'entry'` (`sessions/channels.ts:51`)
and `ChannelEffect.scope: 'session' | 'escaped'` (`turn.ts:487`). §0 celebrates
the second. Conflating them reads as *entry scoping already works*, which is the
opposite of the section above.

#### Gate step 9 asks for a test that does not exist

Step 9 reads *"`sessions.snapshotEveryNTurns` reads `applied`, **and its test
passes**"*. There is no test for that key. `LIVE_APPLIERS` is a real
machine-readable registry (`config.ts:264`, `as const satisfies Record<string,
LiveApplier>`) and `config.test.ts` polices it for *coverage* in both
directions — a `live` key with no row fails, a row for a non-`live` key fails —
but the only value assertions name `trash.retentionDays`, `log.level` and
`limits.maxUploadMb`. **Editing `config.ts:278` to `'applied'` today would break
nothing and prove nothing.**

So the step owes a test rather than inheriting one, and the repo has the two
shapes to choose between: the value pin, and the behavioural test in
`routes/live-config.test.ts` — whose header exists precisely because four rows
said `applied` and were lying, since every test asserted against
`services.config` rather than against the component that reads the key. For a
snapshot interval the behavioural one is the only honest choice: save a new N
over `PUT /config` on a running server and show the *cadence* change. Four other
keys are in the same unread state (`limits.extensionStorageQuotaMb`,
`trash.retentionDays`, `updates.checkEnabled`, `updates.channel`), which is what
step 9's closing *"it is not the whole of it"* was gesturing at; `retentionDays`
is the suite's designated exemplar and stays put.

#### And two things §0's "Already there" list should gain

- **Siblings are not merely storable; they are stored and tested.**
  `sessions/store.test.ts:224` writes a second child of one node and asserts both
  branches read back correctly. §0's headline can rest on a passing test rather
  than on a design note.
- **`reconcileSession` already builds the children map P6.1 needs**
  (`state/commit.ts:346`) — a parent→children index that refuses to guess when it
  finds a node with two children. The recovery path met branching before the
  navigation did.

### 0.2 The design re-read §5 defers, done — and it returns edits rather than a tick

§5 lists *"a re-read of [09 §5.1](../09-branching.md) against P8's chain"* as the
third of three things that would make this a plan. It is the one nobody is
blocked on, so it was done here. The two documents **agree** — P8 names the
chain explicitly and reproduces its formula — and the re-read still turns up four
things, which is the argument for doing a deferred read early rather than at the
revisit.

- **C8 is already resolved, and this document is still asking it.** §1.1 is
  headed *"closing C8"* and §5 lists *"N, finally"* as unsettled, but
  [06 C8](../06-open-questions.md) reads **"RESOLVED: tuneable, and generous
  during alpha — snapshot often and keep many … tighten once there is evidence,
  not before."** That is not merely an answer, it leans against the shipped
  default: *generous* argues for snapshotting more often than every ten turns
  while access patterns are unknown. §1.1's eviction half already agrees with it.
  [09 §9](../09-branching.md) carries the same stale framing and wants the same
  correction.
- **The handoff is three-party, not two.** §4 names P8 as the consumer of
  [09 §5.1]'s chain. [17](../17-write-mode.md) is a second, and says so in as
  many words — Write's node summaries ride the same machinery and need
  **two-level** keying, node summaries keyed by content and chain links keyed by
  the sequence of those keys, which neither 09 §5.1 nor P8 states. What this
  phase hands forward is therefore *content-addressed, two-level, and with the
  summariser's identity in the key* — not simply "a chain".
- **P8's memory extraction is §1.5's first concrete escaped effect**, and neither
  document knows it. P8 makes memory books ordinary library lorebooks, so every
  extraction is exactly the *"lorebook entry promoted to the shared library"*
  that [09 §7](../09-branching.md) classifies as escaped — and a memory extracted
  on a line somebody then abandons is the case the abandonment banner exists for.
  Neither P8 nor [11](../11-cross-session-memory.md) contains the word.
- **P6.0 does not choose where snapshots live.** [02 §5.1](../02-data-model.md)'s
  layout already fixes `sessions/<id>/snapshots/`, *"derived channel state, keyed
  by TurnId"*. §0.1 says P6.0 starts from a reconstruction rather than from
  nothing; this is the other half of the same correction, on the storage side.

*And one thing §2 should fix while it is here:* P6.2 says the two gestures appear
*"on every message"*, but [09 §7](../09-branching.md) resolves branching within a
multi-message turn to the **turn's node** — C11, and the design calls it
turn-granular *"now obviously so rather than by convention"*. Under `per-actor`
dispatch one turn is several messages, so *every message* is the wrong unit and
is the exact confusion C11 was closed to prevent.

### 0.3 What has to be true before this phase opens

*Asked directly, and answered from §0.1 and §0.2 rather than from the phase
order. The short version: **one upstream dependency, and it is partial**; two
questions that need play; and an ordering inside the phase that is worth fixing
now because getting it wrong is the expensive kind.*

#### Genuinely blocking, and only these

- **P5.4–P5.6, for §1.3's rewrite/reroll split and gate step 3 — and for
  nothing else.** This is the whole of P6's upstream dependency and it is
  narrower than it reads. The *two gestures* — redo, continue differently — need
  no draws and can ship. What needs a non-empty tape is the **split inside
  redo**, and with no production draw site the reroll affordance would by
  [07 §14.6](../07-tech-stack.md)'s own rule never appear. So P6.0, P6.1 and
  most of P6.2 are unblocked today; one sub-feature and one gate step are not.
- **PLAYABLE, for §1.8 and §1.2.** *Which reply an edit changes* is a use
  question with a lean and no evidence, and *whether a count and two arrows are
  enough to find a line abandoned twenty turns ago* is the question the deferred
  visualiser exists for. Both are named in §5 and neither has moved.

**§1.1 is no longer on this list**, which is the one thing that got smaller:
[06 C8](../06-open-questions.md) reads **RESOLVED** (§0.2), so N is a tuning
decision with a stated direction — *generous during alpha* — rather than a
question waiting on session sizes.

#### Not prerequisites, though three of them look like it

- **P5.1–P5.3.** The entry editor, the per-entry index rows and Mentions. P6
  depends on none of them; the retriever half is the only part of P5 this phase
  needs, and it is a different set of stages.
- **The snapshot machinery.** That is P6.0's own work, not an input to it — and
  per §0.1 it is a cache in front of a reconstruction that already exists.
- **A real corpus.** Nothing in this phase reads a lorebook. It is P5's
  person-blocked prerequisite and not this one's.

#### Ordering inside the phase, which is not a prerequisite but behaves like one

**The head-gate triple comes before any gesture**, and §0.1 is why: relaxing
`submitTurn`'s head-equality refusal (`state/jobs.ts:162`) makes two latent bugs
live in the same moment — `advanceHead` computing channels incrementally from
the head's map (`sessions/store.ts:367`), and `gatherAssemblyInputs` pairing a
walked history with `session.channels` (`turns/gather.ts:77`). Both are correct
today *only* because the gate makes them unreachable. Relax it first and fix
them after, and the phase spends its first week debugging state that belongs to
a branch nobody is on — which is [02 §8.1](../02-data-model.md)'s *"expensive by
then"*, arriving on schedule.

Two smaller orderings, each cheap to get right and annoying to retrofit:

- **The effect log's key space, if §1.9 is to hold by construction.**
  `applyEffects` ignores `scopeKey` and `acceptEffect` refuses anything but a
  whole-value set; widening them is the precondition for an entry-scoped timing
  channel. Whether P5 or P6 pays is §1.9's question — but it is *work on a
  persisted shape*, so it wants deciding before either phase writes the first
  effect that needs it.
- **§1.6's column, before the index work rather than during it.** Populate the
  `branch_id` that ships NULL, or add the materialised path the design asked for
  and drop it. Either is fine; discovering the choice halfway through is not.

#### Worth clearing before the phase rather than inside it

None of these blocks anything; all four are small, and each is the kind of thing
that costs more attention when met mid-stage than when cleared cold.

1. **`SessionFile`'s docstring advertises branch refs the interface does not
   have** (`sessions/types.ts:41`). A reader will believe the field exists.
2. **Gate step 9 owes a test that does not exist** (§0.1). Writing it is
   independent of the snapshot work and pins what "applied" has to mean.
3. **C8's stale framing** in §1.1 here and in [09 §9](../09-branching.md) — both
   still ask a question [06](../06-open-questions.md) answered.
4. **§4's handoff names one consumer where there are two** (§0.2), and the
   constraint P6 hands forward is two-level keying rather than "a chain".

---

## 1. Decisions this plan has to make

### 1.1 Snapshot interval and eviction — ~~closing C8~~ applying it

> **C8 is already resolved and this heading was still asking it** (§0.2).
> [06 C8](../06-open-questions.md) reads *"RESOLVED: tuneable, and generous
> during alpha — snapshot often and keep many … tighten once there is evidence,
> not before."* So N is a tuning decision with a stated direction rather than a
> question waiting on PLAYABLE, and *generous* leans against the ten that ships.
> The eviction half below already agrees with it.

[06 C8](../06-open-questions.md): snapshots every N turns of depth, plus at any
node that acquires a second child (the node about to be materialised once per
sibling). Needs a default N; `sessions.snapshotEveryNTurns` already exists in
config at `10` ([13 §4](../13-internal-contracts.md)), which is the provisional
answer. Eviction: none at 1.0 — snapshots are small (channel state is numbers
and flags), derived, and deleting them all must already cost only time, which
the property test enforces. ~~Decide N finally on revisit with real session
sizes from PLAYABLE.~~ *Superseded by the box above: pick a number in the
direction 06 already chose, and tighten on evidence rather than before it.*

### 1.2 Sibling presentation — closing C9 far enough to ship

[06 C9](../06-open-questions.md): everything is kept; the question is
presentation. The 1.0 answer per [09 §6](../09-branching.md): history shows the
selected path only; a node with siblings gets an inline affordance (count +
prev/next + promote-to-named-ref); the full tree visualiser stays post-1.0
([14 §1](../14-roadmap.md)). `lastSelectedChildId` per node so back-and-forward
resumes rather than guesses ([09 §3](../09-branching.md)).

### 1.3 The two gestures are two buttons

> **Depends on P5.4–P5.6, and §0.1 makes that a stated dependency rather than an
> assumption.** The rewrite/reroll half needs a non-empty tape, and there is
> still no production draw site — so on today's code the reroll affordance
> would be correct, unexercised, and by [07 §14.6]'s own rule never visible,
> since it must not appear for a turn that consumed no draws. The two *buttons*
> do not depend on it; the *split* does.

*Redo* (sibling of this node) and *continue differently* (child of this node)
are both offered explicitly from any message — guessing is wrong half the time
([09 §7](../09-branching.md)). Redo further splits rewrite/reroll where draws
exist, rewrite default, reroll the explicit second action, no second affordance
when the turn consumed no draws ([07 §14.5–14.6](../07-tech-stack.md)).

### 1.4 Undo is tip-only, and the refusal is a feature

Undo applies `before` at the tip; anything deeper is refused and the branch
path offered instead — the check is the index knowing the latest effect per
`(channelId, scopeKey, path)` ([13 §1.2.1](../13-internal-contracts.md)). This
lands at P6 rather than P2 because the refusal's *alternative* (branch here) is
what makes it acceptable UI, and that alternative is this phase.

### 1.5 Escaped effects, and the honesty banner

Effects carry `scope: "session" | "escaped"` per [09 §7](../09-branching.md);
escaped ones (library writes, generated assets) are never replayed or
reverted, and abandoning a line says plainly that N library writes from it
still exist. Small, and it pre-empts a confusing class of bug reports.
**Closed at the P2 revisit, the way it leaned:** `scope` was added to
`ChannelEffect` in [13 §1.2](../13-internal-contracts.md) and P2 writes only
`"session"` ([04 §2.7](04-p2-implementation.md)) — P6 gets a field, not a
migration. *And a second clause, from §0.1:* the field has **no producer** —
`escaped` appears nowhere outside a test — so the work is a writer plus the
abandonment banner, not a reader over data that is already there.

### 1.6 Branch hygiene in the index and search

> **What this inherits is not what it wants** (§0.1). The index carries a
> `turn.branch_id` column, plumbed end to end and written NULL by both call
> sites — and named for the model [09 §3](../09-branching.md) explicitly
> discarded, since there is no `Branch` entity owning turns. The *materialised
> path* this section asks for is a different column and does not exist. So the
> decision here is: populate what is there, or add the path and drop it. Not a
> field to start using.

Session-scoped index rows carry their turn id and a materialised path;
turn-search hits off the current path stay indexed and are **labelled** with
their branch, never hidden and never passed off as current
([07 §7.1](../07-tech-stack.md), [05 §14.2](../05-ui-surfaces.md)). Path
materialisation for the head is one more derived thing the index holds.

### 1.7 The deferrals other phases have sent here

Collected 2026-08-31, because a deferral nobody collects is one that gets lost
and this document had four sitting outside it. Each is a decision or a piece of
work, not a mention.

- **The stale-head sibling** ([P2 §2.10](04-p2-implementation.md)). Submitting a
  turn refuses any parent that is not the head, and idempotency retains a key so
  a retry cannot charge twice. P2's note reads: *"P6 may turn the stale-head
  case into an explicit sibling; P2 must not manufacture one by race."* That is
  a decision with a real UI consequence — two people, or one person in two tabs,
  submitting against the same head — and it is where branching stops being a
  gesture and becomes a concurrency answer. **Decide it, or say it stays a
  refusal.**
- **The tape's first real use** ([P2 §2.13](04-p2-implementation.md)). The tape
  is recorded from P2 *"though nothing rerolls until P6"*, and P3 §1.8 records
  the consequence: every committed tape is empty because there is no production
  draw site. P5 introduces the first — activation draws — so the tape is
  non-empty for the first time one phase before this one. §1.3's rewrite/reroll
  split is untestable until then and fully testable after. ***Overtaken
  2026-09-01 (§0.1): P5's document half landed and its retriever half did not,
  so the tape is still empty and the split is still untestable at this phase's
  start.*** The dependency is on P5.4–P5.6 rather than on "P5", and §1.3 says so.
- **Branching has no route** ([P2C §5](15-p2c-first-real-run.md)): *"branching
  is a storage affordance with no route."* Named in the first-real-run brief as
  something a tester will not find, so it is not a bug report to expect. P6 is
  where it acquires one.
- **Reconstruction-at-a-node is P9's input too**
  ([P9 §1](20-p9-implementation.md)). Worth knowing while building it: the
  consumer is not only this phase's UI.

### 1.8 Which reply an edit changes — the contradiction P3 handed here

**P3 §1.8 stopped deciding this and said so.** Two rules were inherited from
different places and disagree:

- *"The UI simply shows the newest"* — the old P3 §1.2.
- *"Editing does not change the reply already on screen"* — Marinara's rule,
  preserved in P3 §3.

They are the same question asked of the same gesture: you edit a message that
already has a reply, and re-run. Does the existing reply stay on screen with the
new one beside it as a sibling, or does the view move to the new one?

**This is §1.3's two gestures seen from the other end**, which is the argument
for deciding it here rather than anywhere else: *redo* and *continue
differently* are already two explicit buttons because guessing is wrong half the
time, and *which reply am I now looking at* is the same guess. A plan that
offers both gestures and then silently moves the view has un-decided §1.3.

*The lean, for the revisit to confirm or overturn:* **the view follows the new
sibling and the old one stays reachable through §1.2's inline affordance.**
Marinara's rule protects against losing work you were reading; the sibling
affordance is that protection, made visible, which Marinara did not have. But
this is a use question and PLAYABLE is where the answer is.

### 1.9 P5's timing state, and which phase pays for it

[P5 §1.1](07-p5-implementation.md) leans toward timing state living in channels
rather than on entries, and its §6 flags the lean as contingent on this phase in
a way worth restating precisely, because the dependency runs **both ways**:

> *Does a branch inherit stickiness correctly if timing lives anywhere else? If
> P6's design work lands before this phase, the answer is free; if not, the lean
> ships and P6 [inherits it].*

So: **if P6's reconstruction design is done first, P5 gets its answer for
nothing.** If P5 ships first — which the phase order says it will — then P6
inherits a decision it did not make, and this phase's job is to verify rather
than choose. Either way the check is the same and belongs in this gate: a sticky
entry activated on one line must not be sticky on a sibling line that never
activated it.

**The cheap thing to do about it now**, and the reason this section exists
before either phase runs: P5's revisit should read §1.1 of this document, and
this document's revisit should read P5 §6. Both are one paragraph, and the
alternative is discovering the disagreement from a failing test.

---

## 2. Stages

### P6.0 — Reconstruction and snapshots

*Resized at §0.1: the walk-up-replay-forward exists, so this stage is the cache,
the generalisation of the property from head to every index, and the two
head-snapshot readers below — not the mechanism.*

**And it opens with the head gate and its two consequences**, because they are
what stands between storage that tolerates branching and a session that can
branch: relax `submitTurn`'s head-equality refusal (`state/jobs.ts:162`), and
fix the two places that key on the head snapshot rather than on the node —
`advanceHead` (`sessions/store.ts:367`), which applies effects incrementally to
the current head's map, and `gatherAssemblyInputs` (`turns/gather.ts:77`), which
pairs a walked history with `session.channels`. Both are correct today only
because the gate makes them unreachable, and both are wrong the moment it moves.

State-at-node as walk-up-replay-forward over §1.1's snapshot cache;
`session.json`'s head snapshot rewritten on head move (staying derived —
[02 §8.1](../02-data-model.md)); the replay property test green. This stage is
pure engine and ships no UI.

### P6.1 — Navigation and the head

Move head to any node; history renders the path to it; `BranchRef` create /
rename / delete (a ref is ~50 bytes and moves no data); reattach and the event
stream correct when the head moves mid-view.

### P6.2 — The gestures

§1.3's two buttons on every ~~message~~ **turn** — [09 §7](../09-branching.md)
resolves branching inside a multi-message turn to that turn's *node*, which is
C11, and under `per-actor` dispatch one turn is several messages, so *message*
is the unit C11 was closed to stop people using (§0.2); rewrite/reroll over the
tape with
replayed-vs-fresh draws marked in the record; P3's edit-and-re-run reconciled
onto the same sibling mechanism (it was already writing siblings —
[05 §1.2](05-p3-implementation.md)).

### P6.3 — Siblings, undo, and hygiene

§1.2's inline sibling affordance; §1.4's tip-only undo with the branch offer;
§1.5's escaped-effect labelling; §1.6's branch-labelled search. Tombstone
skipping in the turn reader verified (compaction itself stays unbuilt —
tolerated, not shipped, per [02 §5.5](../02-data-model.md)).

*Ends at:* the demo.

---

## 3. Verification — the P6 exit gate

~~Sketch; expand on revisit.~~ *Steps 1–8 were the sketch and stand. Steps 9–13
were added 2026-08-31 from §0 and §1.7–§1.9, which is the part of a gate worth
writing early: a gate written after the code is a gate written to pass.*

1. Branch from a message 200 turns back → new line in one action, no
   precondition, state at the fork correct per the property test.
2. Swipe a reply → a sibling; swipe again → a third; navigate among them; the
   discarded ones still exist an hour later. Promote one to a named ref —
   nothing copies.
3. Rewrite a turn that rolled dice → same outcome, different prose; reroll →
   new outcome; the record marks replayed vs fresh draws. At temperature 0 a
   rewrite returns ~the same text, and that is correct
   ([07 §14.6](../07-tech-stack.md)).
4. Undo the newest turn → channel state reverts locally; attempt to invert a
   deeper effect → refused, branch offered (§1.4).
5. A character dead on one line is alive on the other; timing counters
   ([07 §1.1](07-p5-implementation.md)) diverge per line correctly.
6. Delete every snapshot → everything still works, slower; the property test
   asserts equality at every index.
7. Search finds text on an abandoned branch, labelled as such (§1.6).
8. Kill the server, delete `index.sqlite`, restart → the tree, refs and head
   all survive; only derived things were lost.

9. **`sessions.snapshotEveryNTurns` reads `applied`**, and this phase ~~its test
   passes~~ **writes the test, because there is not one** (§0.1) — editing the
   row today would break nothing and prove nothing. The behavioural shape is the
   one to copy (`routes/live-config.test.ts`, which exists because four rows said
   `applied` and were lying): save a new N over `PUT /config` on a running server
   and show the *cadence* change, not the number. It
   ships today as a settable number that changes nothing, declared `unread` with
   the comment *"Snapshots are P6's"* — so this phase is the one that either
   makes it true or removes it. This is the standing line below, with a name
   already attached to it.
10. **A sticky lore entry does not leak across a branch** (§1.9): activate one on
    a line, branch from a node before the activation, and the sibling line does
    not have it. Whether that holds by construction or by repair depends on
    which phase shipped first, and the gate does not care which.
11. **Edit-and-re-run does what §1.8 decided**, and the decision is written down
    somewhere a person can find — not left as whatever the implementation does.
12. **The stale-head case behaves as §1.7 decided**: two submissions against one
    head either produce an explicit sibling or a refusal that offers one, and
    never a race that manufactures a branch nobody asked for.
13. **P5's gate step 14 is re-read and edited in this phase's own commit.**
    Timing counters reconstructing at an old node is a replay-from-zero test
    before P6 and a branch test after; it changes meaning here, and the
    fixture-pair precedent from P5.6 is that such a step is edited deliberately
    rather than repaired when it reddens.

**And the standing line from [01 §2.3](01-work-plan.md): no phase exits
with configuration that has no surface.** If this phase built something that
needs a value set, name where someone sets it before calling the phase done.
Step 9 is that line with one key already named; it is not the whole of it.

---

## 4. Out of scope, deliberately

The branch tree visualiser (post-1.0, [14 §1](../14-roadmap.md)); branch/subtree
pruning UI (post-1.0 — the storage tolerates it, which was P2's obligation);
cross-branch merge ([06 C10](../06-open-questions.md) — out of scope and
deliberately not precluded); summarisation (P8 — but P8's rolling summary
**must** arrive as the content-addressed chain of
[09 §5.1](../09-branching.md), ~~and this phase's revisit should re-read that
section as the handoff~~ *— re-read at §0.2, and it found two things this clause
gets wrong: the consumer is not only P8, since [17](../17-write-mode.md) puts
Write's node summaries on the same machinery and needs **two-level** keying; and
the constraint handed forward is content-addressed, two-level, and with the
summariser's identity in the key, rather than "a chain"*); retention/compaction policy (keep everything,
[02 §5.5](../02-data-model.md)); multiplayer arbitration over shared heads
([04 §8](../04-server-multiuser-deployment.md)).

---

## 5. The honest size, and what only the revisit can settle

*Added 2026-08-31, with §0's audit behind it.*

**The engine half is bigger than the UI half, and the reverse reads as true.**
The gestures are two buttons and the sibling affordance is a count with arrows;
what sits under them is a snapshot cache with an eviction story, a
walk-up-replay-forward that has to be correct at every index, and a property
test that is the real deliverable because P9 will lean on the same machinery.
P6.0 ships no UI at all, deliberately, and that is the stage most likely to be
under-priced.

*Re-priced at §0.1, and it moves both ways.* **Down:** the walk and the fold
exist and are tested, so P6.0 adds a cache rather than a mechanism. **Up:**
§1.4's undo has no invert function and no index behind the key it names; §1.5's
escaped scope has no producer; §1.6 inherits a NULL column named for a discarded
model rather than the path it asked for; and §1.9's check, met by construction,
means widening the effect log's key space — which is a persisted shape, and the
one place this phase's *"P6 builds no storage"* headline is conditional rather
than settled.

**What P2 bought is real and worth restating as a subtraction:** the tree edge,
the tape, the effect scope and the escaped-effect skip are all in the code
already (§0), so this phase genuinely builds navigation and reconstruction
rather than storage. The estimate should reflect that; the risk is spending the
saving on the visualiser, which §4 puts out of scope.

**Three things this document cannot settle before its revisit**, and they are
the reason it is still called a skeleton:

- **N, finally** (§1.1). Ten is a guess that ships today as an unread key.
  Real session sizes come from PLAYABLE, and the honest answer may be that the
  interval should be depth-and-cost aware rather than a count.
- **Which reply an edit changes** (§1.8). Leaned, not decided, and it is a use
  question.
- **Whether the sibling affordance is enough** (§1.2). [09 §6](../09-branching.md)
  says history shows the selected path only; whether a person can find a line
  they abandoned twenty turns ago through a count and two arrows is exactly what
  the visualiser exists for, and exactly what §4 defers. If PLAYABLE says they
  cannot, that deferral is the one to revisit first.

**What would make this a plan rather than a skeleton:** ~~P5 landed, so the tape
is non-empty and §1.3 is testable~~ **P5.4–P5.6 landed** — §0.1 checked, and it
is the *retriever* half that draws, so P5's document half landing changed
nothing here; PLAYABLE run, so §1.1 and §1.8 have evidence; and a re-read of
[09 §5.1](../09-branching.md) against P8's chain, which §4 already names as the
handoff to check and which is the one of the three nobody is blocked on.
