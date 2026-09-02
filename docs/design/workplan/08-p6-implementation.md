# 08 — P6 implementation plan

**Status: ~~skeleton~~ ~~startable~~ in progress.** Opened 2026-09-02 on branch
`p6` at `cb19ab5`, main's tip after the P5 merge, with §0.1a as the opening
audit: nothing it cites has moved — the engine diff since `347815e` is one
comment in `turns/preview.ts` — so a fourth audit would have re-read a day-old
one. P6.0a first, per §2's ordering. Expanded 2026-08-31 with a readiness audit
and the deferrals collected; re-audited 2026-09-01 at P5's document half (§0.1);
re-audited 2026-09-02 once all eleven P5 stages had landed (§0.1a); and **§2
expanded the same day from a four-line sketch into a staged plan with orderings
and proof obligations**, on the back of P5's close-out audit
([07 §0.5](07-p5-implementation.md)). ~~Drafted during P1; to be revisited before the phase starts.~~

**Read §0.1a, §0.3 and §2, in that order, and you can start.** §0 and §0.1 are
superseded audits kept for their arguments rather than their findings; §1 is the
decisions, and each stage in §2 names the ones it has to honour.

The upstream half of §5's list is spent: P5 landed, the tape can be non-empty,
and §1.3 is testable. **What remains before this phase opens is PLAYABLE**, for
§1.8 and §1.2, plus the [09 §5.1](../09-branching.md) re-read — and neither
blocks P6.0, which is the whole of the engine and ships no UI. §0.3 is the live
list.

**One thing to carry in from P5 before writing a line of it:** P5's exit gate was
never walked, it ships with no client surface for selecting a lorebook, and two
of its steps arrive here as obligations rather than as steps that changed
meaning. §0.3's blocking box has the short version.

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
  (`sessions/store.ts:434`) already **skips escaped effects when replaying**, so
  the rule is applied and not merely storable. Its neighbouring comment reasons
  explicitly about branches: a `delete` rebuilds the map without the key rather
  than mutating, *"so a channel that was removed on one branch must not
  disappear from a map another branch is still replaying against."* That is P6's
  invariant, written at P2, under test.
- **The head snapshot is derived and says so** (`sessions/channels.ts:270`),
  with the failure mode [02 §8.1](../02-data-model.md) warns about — *"a bug that
  only surfaces at P6 and is expensive by then"* — argued against in the code
  itself rather than left to this document.

**Not there, and this is the phase's actual size:**

- **No snapshot *cache*.** There is no depth-indexed cache and no eviction, and
  `sessions.snapshotEveryNTurns` reads nothing. ~~and no walk-up-replay-forward.
  P6.0 starts from nothing.~~ **Corrected at §0.1:** the walk and the fold both
  exist and compose —
  `replayChannels(walkPath(turns, id))`, in production at `store.ts:405` — so
  P6.0 starts from a tested O(depth) reconstruction and adds a cache in front of
  it. `store.ts:470` says the narrower true thing already.
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

> **No longer true, and the line numbers throughout this document have been
> refreshed rather than left.** That diff ran when only P5's document half had
> landed. Against the finished phase it is 17 files and ~1,800 lines, and eight
> citations moved: `applyEffects` 429→434, `reconcileHandEdits`' composition
> 400→405, the narrower-true-thing comment 453→470, `replayChannels` 459→475,
> the derived head snapshot in `channels.ts` 173→270, `advanceHead`'s incremental
> apply 367→372, and `gatherAssemblyInputs`' walk and channel read 73→86 and
> 77→91.
>
> **Every claim they anchor survived the move.** This was drift, not
> contradiction — which is the useful finding, because a re-audit that only
> checked whether the numbers still resolved would have reported eight failures
> and no substance. `walkPath` (`segments.ts:188`), `config.ts:278`,
> `state/jobs.ts:162`, `store.test.ts:224`, `state/commit.ts:346` and the
> `shared/src/turn.ts` citations never moved at all.
>
> **"Refreshed throughout" was an overclaim, corrected 2026-09-02.** The eight
> above were checked; the document was not swept. A mechanical pass over every
> citation found **four more** stale, now fixed: `turn.branch_id`
> 146→**212**, the 412 in `routes/sessions.ts` 462→**521**, the `indexTurn` call
> 341→**346**, and `rebuild.ts` 131→**133**. Every claim they anchor survived
> too. **The failure mode is worth naming, because it is the one this box assumed
> away:** these went stale by *insertion far from the subject* — P5 added lore
> schema above `branch_id` and route handlers above the 412 — so a citation can
> rot in a file the phase's diff barely touched near that line. Checking the ones
> you suspect is not a sweep. The head-gate triple was re-verified and is correct:
> `state/jobs.ts:162`, `sessions/store.ts:372`, `turns/gather.ts:91`.

What follows is what §0 got wrong about the *size*, the precondition that did
not happen, and five things missing from its own list.

#### §0 is wrong that P6.0 starts from nothing

> *"No snapshot machinery of any kind … there is no depth-indexed cache, no
> eviction, and no walk-up-replay-forward. P6.0 starts from nothing."*

The first half is right and the last two clauses are not. **Walk-up-replay-forward
exists, in production, today**: `walkPath` (`sessions/segments.ts:188`) climbs
`parentTurnId` with a cycle guard and reverses so the path reads root-first, and
`replayChannels` (`sessions/store.ts:475`) folds `applyEffects` along it. Composed
— `replayChannels(walkPath(turns, id))` — they answer *state at a node*, and
`reconcileHandEdits` calls exactly that composition at `store.ts:405`.

The function §0 is describing already contains the correct, narrower sentence:
*"P2 has no snapshot **cache** — that is P6's, and it is an optimisation rather
than a mechanism"* (`store.ts:470`). So the code says the true thing and this
document said a bigger one.

**What P6.0 actually starts from is a tested O(depth) reconstruction, and what it
adds is a cache in front of it plus the generalisation of the property from
*head* to *every index*.** That is a real reduction in the stage §5 calls the one
most likely to be under-priced — and it is not licence to relax, because §5's
other claim survives intact: the property test is still the deliverable, and the
next section is why.

#### ~~The precondition §5 names has not happened~~ — it has, see §0.1a

**Superseded.** All of P5 landed on 2026-09-02, and there are two production draw
sites. The paragraph below was true of P5's document half and is kept because the
*shape* of the problem it found survives: the tape is non-empty only on a turn
that actually rolled, which is not most turns. §0.1a carries the live reading.

> *"What would make this a plan rather than a skeleton: P5 landed, so the tape is
> non-empty and §1.3 is testable."*

**P5's *document half* landed. The retriever half did not**, and the retriever
half is the one that was going to draw. There is still no production draw site:
the runner constructs an `Rng` (`turns/runner.ts:304`) and copies its tape onto
the draft at every checkpoint, but nothing calls `rng.at()` anywhere outside
`rng/rng.test.ts` — the only other mention in the tree is a comment in
`turns/calls.ts:148` explaining why backoff deliberately does *not* draw. Every
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
  head a client should rebase onto (`routes/sessions.ts:521`). The wire already
  carries `headTurnId` as an explicit field, so this is a rule to relax rather
  than a schema to migrate — but it is a rule, it is deliberate, and §1.7's
  stale-head bullet is about *this line*. It should be P6's first and cheapest
  change, named as a step.
- **`advanceHead` is child-of-head-only.** It computes the new channel map as
  `applyEffects(session.channels, turn.effects)` (`sessions/store.ts:372`) —
  incrementally, from whatever the head's map happened to be. That is correct for
  the only case P2 produces and wrong for every gesture this phase adds: select a
  sibling, promote a ref, resume back-and-forward, and the state is the *abandoned*
  branch's plus the new turn's effects. This is precisely the bug
  [02 §8.1](../02-data-model.md) says *"only surfaces at P6 and is expensive by
  then"*, sitting in the open, held back by the head gate above it.
- **And `gatherAssemblyInputs` has the same shape.** It walks `history` to
  `request.parentTurnId` (`turns/gather.ts:86`) and then takes channels from
  `session.channels` — the *head* snapshot — whenever the file exists
  (`gather.ts:91`). Assembling at a non-head node would pair one branch's history
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
- **`scope: 'escaped'` has no producer.** `effects.ts:79`, `channels.ts:261` and
  `channels.ts:339` all hard-code `'session'`; the only `'escaped'` in the tree is
  a test. §1.5's *"P6 gets a field, not a migration"* is still true and now needs
  its second clause: the field exists, its only writer is a test, so the work is a
  producer plus the abandonment banner. **Still true after P5** — the lore timing
  effects are a fourth producer and they go through `acceptEffect` like the rest,
  so they inherit `'session'` too. Nothing has escaped yet.

#### ~~What P5 left under §1.9~~ — P5 paid it, see §0.1a

**Superseded.** P5.5 widened the key space, shipped `se.lore.timing`, and taught
`filterReads` about scoped values. This phase inherits the wider key rather than
building it, and §1.9's headline consequence — *"somebody widens the effect log's
key space"* — was answered by the other phase. The finding is kept because it is
the argument that decided which one paid.

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

- **`turn.branch_id`** exists in the index (`index-db/migrations.ts:212`), is
  plumbed end to end as a defaulted fourth parameter (`index-db/sessions.ts:90`)
  and comes back on every search row (`:41`) — and **both call sites omit it**
  (`sessions/store.ts:346`, `index-db/rebuild.ts:133`), so every row's
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

### 0.1a Re-audit at P5's *actual* close — 2026-09-02, at `347815e`

§0.1 was run on branch `p5` when only the **document half** had landed, and said
so. All eleven stages are Landed now — P5.−1 through P5.9, thirty-five commits — so
the findings that turned on the retriever half are re-checked here rather than
left to be discovered as false. **Two of §0.1's findings are closed outright
(§1.9, and its own claim that nothing had drifted), one is closed with a caveat
that is sharper than the finding was, and P5 left three things §0.1 could not
have anticipated.** Nothing here contradicts §0.1's reasoning; what changed is
the world it was reasoning about.

#### The precondition §5 names has now happened, and §1.3's dependency is met

§0.1's central finding was that *"there is still no production draw site … every
committed tape is `[]`"*, and that §1.3's rewrite/reroll split would therefore be
**untestable when this phase opens**. It amended §1.3 to declare a hard dependency
on P5.4–P5.6.

**That dependency is satisfied.** There are two production draw sites, both in
the retriever: `rng.at('lore.probability', entry.id).chance(…)`
(`retrieval/activate.ts:535`) and `rng.at('lore.group', key).weightedPick(…)`
(`:611`). ~~Both are keyed by entry or by book-and-group rather than positionally,
which is [07 §14]'s *keyed by site, never by position* being honoured by its first
real consumer~~ — so a rewrite that takes a slightly different path replays the
draws it can and draws fresh for the rest, which is the behaviour §1.3 needs to be
able to test at all.

> **Half wrong, corrected 2026-09-02 at [07 §0.5](07-p5-implementation.md).** The
> *site keys* are stable — entry id, and book-and-group — and that half is what
> [07 §14] asks for. **But `weightedPick`'s payload is a position.**
> `rng/rng.ts:196-213` records `index`, an offset into the candidate list, and
> the replay guard at `:120-125` accepts a recorded draw whenever
> `recorded.kind === kind && recorded.detail === detail` — where `detail` is
> `total=<summed weight>`. The candidate list is built in **scan order** from
> `firedHere` (`activate.ts:600`), which is `entry.order` then id.
>
> So a group whose membership was reordered, or one member swapped for another of
> equal weight, replays the old index onto a **different entry** and marks it
> `replayed: true` — and `Rng.diverged` under-reports. Nothing reaches this today
> because no production code constructs a replaying `Rng`. **P6.2 is the phase
> that will**, which makes this the phase's inheritance rather than P5's bug:
> §1.3's gate step 3 asks that *"the record marks replayed vs fresh draws"*, and
> that sentence can be satisfied today by a draw that replayed to the wrong
> entry. Fix before building on it — record the winning entry id, or put the
> member ids into `detail` so a changed candidate set misses the tape and draws
> fresh.

**But the tape is non-empty only for a turn that actually rolled**, and that is
the half of the finding that survives. `probability` is null by default and a
group contest needs two entries in one group both firing, so an ordinary turn
against an ordinary book still commits `[]`. [07 §14.6]'s rule — the reroll
affordance must not appear when a turn consumed no draws — therefore still hides
it most of the time, which is **correct behaviour and a poor test bed**. §1.3 is
now testable; gate step 3 needs a fixture that deliberately rolls, and should say
so rather than assuming any turn will do.

#### §1.9 is closed, and P5 paid

§0.1 recorded two mechanical blockers and said *"whether that is P5 or P6 is
exactly what §1.9 is about"*. **P5.5 paid**, and the phase order is the reason it
gave: the alternative was shipping a feature that clobbers itself and leaving
this phase to repair it.

- `applyEffects` keys on the pair now — `channelKey(effect.channelId,
  effect.scopeKey)` (`sessions/store.ts:445`) — and `acceptEffect` reads its
  `before` from the same composite key, with a comment naming precisely why
  §1.4's undo depends on it: *"`before` is the inverse an undo replays, so the
  mistake would surface as a restore that put the wrong entry's timing back."*
- `se.lore.timing` exists (`sessions/channels.ts:80`), `scope: 'entry'`,
  engine-computed, hidden. It is the first channel to use the `'entry'` arm, and
  the arm had been declared since the first channel was written.
- `filterReads` matches a step's declared read against a channel **and its scoped
  values** — `keyBelongsTo(key, id)` at `turns/steps.ts:246`, defined at
  `sessions/channels.ts:185` — which was the quiet member: a step declaring
  `reads: ['se.lore.timing']` would otherwise have received an empty map and
  behaved as though nothing had ever fired. `channelKey`
  (`sessions/channels.ts:171`) and `scopeKeyOf` (`:190`) are the pair this phase
  will reach for when it needs to ask *whose* timing a replayed effect carried.

**What this phase inherits is therefore a widened key space it did not have to
build, and a live consumer of it.** §1.9's "window is still open" paragraph is
spent; the note stays for the argument, not the instruction.

**`acceptEffect` still refuses anything but a whole-value set at `/`**
(`turns/effects.ts:49`), unchanged and still correct — P5's timing writes a whole
`EntryTiming` each turn. §1.4's undo is the next thing likely to want a narrower
op, and that refusal is still where it would be met.

#### What P5 left that changes this phase's *stakes* rather than its plan

**The effect log is no longer nearly empty.** Before P5, a turn wrote `se.clock`
and little else. Now every turn that touches a lorebook writes one
`se.lore.timing` effect per entry whose counters moved — a firing, a cooldown
ticking down, a sticky window closing. `retrieve` filters to entries that
actually changed, deliberately, because *"a library of four hundred entries would
otherwise write four hundred no-op effects every single turn, and the effect log
is what [09 §4] replays"*. That filter is what keeps reconstruction affordable, and
it is now load-bearing for P6.0 rather than a courtesy.

This raises the stakes on §0.1's head-gate triple without changing the work.
`advanceHead` still computes `applyEffects(session.channels, turn.effects)`
(`sessions/store.ts:372`) and `gatherAssemblyInputs` still takes channels from
`session.channels` (`turns/gather.ts:91`) — both correct only because the head
gate makes a non-head parent unreachable. What has changed is the *symptom*: a
branch that inherited the wrong channel map used to show a wrong clock. It will
now also show the wrong lore — entries sticky that never fired on this path,
cooldowns that belong to an abandoned line, an `ephemeral` entry spent by a turn
that is not in this history. That is silent, it is content rather than metadata,
and it is exactly [02 §8.1]'s *"expensive by then"*.

**The shape this phase replays, stated once so P6.0 does not have to derive it.**
The value under `se.lore.timing#<entryId>` — `SCOPE_SEPARATOR` is `#`
(`sessions/channels.ts:148`) — is an `EntryTiming` of exactly three
numbers (`retrieval/timing.ts:48`): `sticky` turns remaining, `cooldown` turns
remaining, and `fired` — the count an `ephemeral` limit is checked against. All
three are plain integers with no clock and no absolute turn index in them, which
is what makes them replayable at all: reconstruct the path, fold the effects, and
the counters land where that path put them. **`delay` is the deliberate
exception** and reads better for it — it counts `messagesSoFar` from the walked
history rather than from a counter, *"so a branch that rewinds four turns is four
messages shallower without anything having to be un-incremented"*
(`timing.ts:62`). That comment was written for this phase.

`same()` (`retrieve.ts:237`) compares all three fields, so the no-op filter has
no gap — an entry whose `fired` moved writes an effect even when `sticky` and
`cooldown` did not, which is what makes gate step 10's ephemeral case
reconstructible.

> **True by reading and protected by nothing** ([07 §0.5]). No test folds a
> lore-timing effect through `replayChannels` at all — every call site in the
> suite folds a clock-only path — and `left.fired === right.fired` is load-bearing
> only for an entry with **neither** `sticky` nor `cooldown`, which is the
> canonical `ephemeral` entry and exactly what the factory produces by default.
> So deleting that clause leaves the whole suite green and makes an ephemeral
> entry fire every turn forever. **P6.0 must not present the ephemeral case as
> reconstructible on the strength of reading that function**; P6.0a below writes
> the assertion, and it is the same test that discharges P5's gate step 14.

**A session's lore links are session-wide, not per-node, and that is a relief
worth recording.** `SessionFile` gained `treatment` and `lore` at P5.6, and
`resolveLore` reads them from the session file rather than from any turn — so
switching branches does not change *which books are in play*, only which entries
their timing says have fired. Nothing in this phase has to reconstruct a book
list. The same is true of `cast`.

#### Two smaller corrections to §0.1's own text

- **`turn.branch_id`'s NULL columns are unchanged**, and §1.6's choice is still
  open. P5 added `lore_entry` and `lore_entry_fts` to the index and did not touch
  it.
- **§0.1's drift note stands**: the per-draw flag is `turn.ts:109`.

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

> **Amended 2026-09-02 by [07 §0.5](07-p5-implementation.md), which added one and
> took none away.** **P5's exit gate has never been walked**, and five of its
> eighteen steps cannot be passed as written. Two of those five are already
> this phase's: step 11's reproduction half is §3's step 3 here, and step 14's
> pre-P6 discharge is P6.0a. **That does not block P6 opening** — the work is
> named and owned. What *is* worth knowing before starting: P5 shipped with **no
> client surface for selecting a lorebook**, so `pnpm seed` produces a session
> that resolves zero books and every fixture in this phase that needs lore must
> build its selection through `POST /api/sessions { treatment, lore }` or
> `PUT /sessions/:id/lore` itself. Gate step 3 needs a rolling entry and gate
> step 10 needs a sticky/cooldown/ephemeral one. **Do not assume `pnpm seed`
> gives you a world.**

- ~~**P5.4–P5.6, for §1.3's rewrite/reroll split and gate step 3 — and for
  nothing else.**~~ **Satisfied 2026-09-02** — all eleven P5 stages landed and
  `retrieval/activate.ts` draws at two sites (§0.1a). The paragraph below is kept
  because its *narrowness* was the useful part and still is, with one clause now
  reading differently: it is no longer that a draw site does not exist, but that
  a turn only draws when a `probability` or a group contest is in play. **Gate
  step 3 therefore needs a fixture that deliberately rolls**; it cannot be
  written against an arbitrary turn. This is the whole of P6's upstream
  dependency and it is narrower than it reads. The *two gestures* — redo,
  continue differently — need no draws and can ship. What needs a non-empty tape
  is the **split inside redo**, and on a turn that consumed no draws the reroll
  affordance must by [07 §14.6](../07-tech-stack.md)'s own rule not appear. So
  P6.0, P6.1 and most of P6.2 were unblocked even before P5 finished.
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
the head's map (`sessions/store.ts:372`), and `gatherAssemblyInputs` pairing a
walked history with `session.channels` (`turns/gather.ts:91`). Both are correct
today *only* because the gate makes them unreachable. Relax it first and fix
them after, and the phase spends its first week debugging state that belongs to
a branch nobody is on — which is [02 §8.1](../02-data-model.md)'s *"expensive by
then"*, arriving on schedule.

**P5 made this ordering matter more, not less** (§0.1a). The wrong-map symptom
used to be a wrong clock, which is one visibly bogus number. It is now also
wrong *lore* — an entry sticky on a line that never fired it — which changes the
prose the model is given rather than a field on the screen, and is therefore the
kind of bug a person notices as *the writing got strange* three sessions later.
Fix the triple first.

Two smaller orderings, each cheap to get right and annoying to retrofit:

- ~~**The effect log's key space, if §1.9 is to hold by construction.**
  `applyEffects` ignores `scopeKey` and `acceptEffect` refuses anything but a
  whole-value set; widening them is the precondition for an entry-scoped timing
  channel. Whether P5 or P6 pays is §1.9's question — but it is *work on a
  persisted shape*, so it wants deciding before either phase writes the first
  effect that needs it.~~ **Done by P5.5, so it is not an ordering here at all**
  (§0.1a). Worth keeping visible as the one item on this list that got settled by
  being written down early enough for the *other* phase to read it — which is
  what §1.9's closing paragraph asks both documents to keep doing.
- **§1.6's column, before the index work rather than during it.** Populate the
  `branch_id` that ships NULL, or add the materialised path the design asked for
  and drop it. Either is fine; discovering the choice halfway through is not.

#### Worth clearing before the phase rather than inside it

None of these blocks anything; all four are small, and each is the kind of thing
that costs more attention when met mid-stage than when cleared cold.

1. **`SessionFile`'s docstring advertises branch refs the interface does not
   have** (`sessions/types.ts:42`). A reader will believe the field exists.
   *Now doubly out of date:* it also omits `treatment` and `lore`, which P5.6
   added and which are the session's lore links. One edit fixes both.
2. **Gate step 9 owes a test that does not exist** (§0.1). Writing it is
   independent of the snapshot work and pins what "applied" has to mean.
3. **C8's stale framing** in §1.1 here and in [09 §9](../09-branching.md) — both
   still ask a question [06](../06-open-questions.md) answered.
4. **§4's handoff names one consumer where there are two** (§0.2), and the
   constraint P6 hands forward is two-level keying rather than "a chain".
5. **Deselecting a lorebook strands its timing counters**, and nothing has
   decided whether that is right. `setLore` (`sessions/store.ts:557`) writes
   `treatment`, `lore` and `updatedAt` and never touches `channels`, while
   `timingFrom` (`retrieve.ts:195`) harvests every `se.lore.timing#<entryId>` key
   in the map without consulting which books are selected. Removing a book is an
   explicitly supported gesture — *"and back to none, which is how somebody
   removes a book they regret"* — and it leaves that book's
   `{sticky, cooldown, fired}` behind, so re-adding it resumes a spent
   `ephemeral` and a mid-count `cooldown`. Inert for reconstruction; **P6.3's
   undo will meet it**. Decide whether deselection prunes or deliberately keeps,
   and say which in `setLore`'s comment.
6. **The group draw's payload is a position** (§0.1a). Not clearable before the
   phase — it is P6.2's own first task — but it belongs on a list somebody reads
   before writing the replay path, because the mistake it enables looks like
   success in the record.

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

> ~~**Depends on P5.4–P5.6, and §0.1 makes that a stated dependency rather than an
> assumption.** The rewrite/reroll half needs a non-empty tape, and there is
> still no production draw site — so on today's code the reroll affordance
> would be correct, unexercised, and by [07 §14.6]'s own rule never visible,
> since it must not appear for a turn that consumed no draws.~~ **Dependency met
> 2026-09-02** (§0.1a). The draw sites are `rng.at('lore.probability', entry.id)`
> and `rng.at('lore.group', key)`, both in `retrieval/activate.ts`, both keyed by
> entry or group rather than by position — which is what makes a rewrite able to
> replay the draws that still apply and draw fresh for the rest.
>
> **What survives is a testing constraint, not a blocker.** A turn only rolls
> when an entry carries a `probability` or two entries contest a group; against
> an ordinary book the tape is still `[]` and [07 §14.6]'s rule correctly hides
> the affordance. So the split is exercisable but not incidentally — **a fixture
> has to be built to roll**, and gate step 3 should name it. The two *buttons* do
> not depend on any of this; the *split* does.

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
  split is untestable until then and fully testable after. ~~***Overtaken
  2026-09-01 (§0.1): P5's document half landed and its retriever half did not,
  so the tape is still empty and the split is still untestable at this phase's
  start.***~~ ***Resolved 2026-09-02 (§0.1a): the retriever half landed too, and
  P2 §2.13's prediction came true almost exactly — activation draws are the
  tape's first real use.*** The one word P2 could not have known is *sometimes*:
  the tape is non-empty on a turn that rolled, not on every turn.
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

**Settled 2026-09-02: P5 shipped first, so this phase verifies rather than
chooses — and P5 paid the mechanical cost of the choice** (§0.1a). Timing lives
in channels, as `se.lore.timing`, `scope: 'entry'`, engine-computed and hidden.
P5.5 widened `applyEffects` to key on `channelKey(channelId, scopeKey)` and
taught `filterReads` about scoped values, so the widening §0.1 costed as *"work
on a persisted shape"* is not this phase's work. **What this phase owes is the
check, unchanged and now writable against real state:** a sticky entry activated
on one line must not be sticky on a sibling line that never activated it.

That check is [P5 §3]'s gate step 14 arriving here as promised — *"Timing
counters reconstruct correctly at an old node (with P6 landed, this becomes the
branch test; before P6, replay-from-zero covers it)."* **It is now the branch
test**, and §3 below carries it rather than leaving it in P5's gate to go red.

*The paragraph pair still stands as a habit even though this instance resolved
well:* it resolved well because both documents were read, not because the
ordering was lucky.

---

## 2. Stages

*Expanded 2026-09-02 from a four-line sketch per stage, at the close-out audit
([07 §0.5](07-p5-implementation.md)). The sketches said what each stage builds;
they did not say what it must **prove**, or what it may not start before — and
§0.3 spends four paragraphs arguing that the ordering inside P6.0 is what decides
whether the phase spends its first week debugging state belonging to a branch
nobody is on. A stage list that leaves that in prose gets read as four bullets,
and the one-line change gets made first. It is steps now.*

**Before the phase opens, read this much and no more:** §0.1a for what P5 left,
§0.3 for what still blocks, and this section. §0 and §0.1 are superseded audits
kept for their arguments; §1 is the decisions, and each stage below names the
ones it has to honour.

### P6.0 — Reconstruction, the head gate, and the snapshot cache

*Resized at §0.1: the walk-up-replay-forward exists, so this stage is the cache,
the generalisation of the property from head to every index, and the two
head-snapshot readers — not the mechanism.* Pure engine, no UI. **Four sub-steps
in a fixed order, and the order is the stage's only real risk.**

#### P6.0a — the property test, written before anything moves

**Builds:** reconstruction generalised from *head* to *every index*, asserted
against the code exactly as it stands today. A new `sessions/reconstruct-property.test.ts`,
or a new describe in `sessions/store.test.ts`, over `walkPath`
(`sessions/segments.ts:188`) and `replayChannels` (`sessions/store.ts:475`).

**Must prove:** for a fixture session with at least one sibling pair, channel
state at every node equals `replayChannels(walkPath(turns, node))` — and **the
fixture's effects must include `se.lore.timing#<entryId>` values, not only
`se.clock`.** That clause is the whole point of putting this first. Every
existing `replayChannels` test folds a clock-only path (`store.test.ts:286`,
`:298-299`, `:337`; `channels.test.ts:121`, `:167`; `p2-gate-storage.test.ts:628`,
`:750` — the last because its `createSession` helper posts `{ name }` alone, so
no book is ever selected and no timing effect is ever written). Assert the three
`EntryTiming` integers by name (`retrieval/timing.ts:48`), and include one entry
with **neither `sticky` nor `cooldown`** so that `same()`'s
`left.fired === right.fired` clause (`retrieve.ts:239`) is protected — today
deleting it leaves the suite green and makes an ephemeral entry fire forever.

**This sub-step is also [P5 §3](07-p5-implementation.md) step 14 discharged**,
which is why it comes first rather than last: P5's pre-P6 escape clause was
*"replay-from-zero covers it"* and that was never written, so this phase inherits
an obligation rather than a step that changed meaning.

**Blocks:** everything else in the phase. Without it, P6.0b's regression is
invisible.

#### P6.0b — fix the two head-snapshot readers, with the gate still closed

**Builds:** `advanceHead` (`sessions/store.ts:372`) stops computing
`applyEffects(session.channels, turn.effects)` from whatever the head's map
happened to be, and takes its parent map from the node being appended to.
`gatherAssemblyInputs` (`turns/gather.ts:91`) stops preferring `session.channels`
when the file exists and takes channels from the walked history it already
computed at `:86` — the `session ? session.channels : replayChannels(history)`
ternary is the exact line, and the `session.channels` arm is what pairs one
branch's history with another's state.

**Must prove:** (i) with the head gate **still in place**, every existing test
passes unchanged — no behaviour change at the head, which is what makes the diff
reviewable; (ii) driven at store level with a hand-built sibling, both functions
return the *sibling's* state and not the head's; (iii) P6.0a's property still
holds.

*Why this is sharper after P5:* the symptom of the wrong map used to be a wrong
clock, which is one visibly bogus number. It is now also wrong **lore** — entries
sticky that never fired on this path, an `ephemeral` spent by a turn not in this
history — which changes the prose the model is given rather than a field on the
screen, and is noticed as *the writing got strange* three sessions later.

**May not start before P6.0a. Must complete before P6.0c.**

#### P6.0c — relax the head gate, and decide §1.7's stale-head case in the same commit

**Builds:** the refusal at `state/jobs.ts:162` and the route's `412` at
`routes/sessions.ts:521`. **§1.7's first bullet must be decided here, not
later**, because *"explicit sibling"* and *"a refusal that offers one"* are
different code: the first removes the check, the second keeps it and changes the
response.

**Must prove:** (i) submitting against a non-head parent produces a sibling turn,
and P6.0a's property still holds at both children; (ii) two submissions against
one head do not manufacture a branch nobody asked for — gate step 12;
(iii) idempotency-key retention still holds, so a retry cannot charge twice.

**May not start before P6.0b. Blocks P6.1 and P6.2 entirely** — no gesture can
ship over a head-gated store.

#### P6.0d — the snapshot cache, and the config key

**Builds:** the cache keyed by `TurnId`; the location is already fixed by
[02 §5.1](../02-data-model.md) and this stage does not get to choose it (§0.2).
Snapshot **at every N of depth and at any node that acquires a second child** —
[09 §4](../09-branching.md) names both triggers and §1.1 carries only the first;
*"a node with several children is a node whose state will be materialised
repeatedly, once per sibling explored"* is the cheap win. No eviction at 1.0
(§1.1; [06 C8](../06-open-questions.md) reads RESOLVED — pick generously). Flip
`config.ts:278` from `'unread'` to `'applied'` and **write the test that does not
exist** (gate step 9): the behavioural shape from `routes/live-config.test.ts`,
saving a new N over `PUT /config` on a running server and showing the *cadence*
change rather than the number.

**Must prove:** (i) delete every snapshot and everything still works, slower,
with the property asserting equality at every index — gate step 6; (ii) gate step
14's cost bound. Note the cache now earns its place on **effect volume** as well
as walk depth, because every turn touching a lorebook writes one
`se.lore.timing` effect per entry whose counters moved.

**May start any time after P6.0a; must land before the phase gate.**

### P6.1 — Navigation and the head

**Builds:** `BranchRef` and `lastSelectedChildId` in `packages/shared/src`;
`branchRefs` on `SessionFile` — and fix that interface's docstring
(`sessions/types.ts:42`) while there, which advertises branch refs the interface
does not have *and* omits `treatment` and `lore`, added at P5.6 (§0.3 item 1: one
edit closes both). Move-head in `sessions/store.ts`; the route in
`routes/sessions.ts`, since branching has had no route since [P2C §5](15-p2c-first-real-run.md).
**`state/commit.ts:346` already builds the parent→children index this stage
needs** and refuses to guess at a node with two children — reuse it rather than
writing a second.

**Must prove:** (i) moving the head to an arbitrary node re-derives
`session.channels` through P6.0b's path rather than incrementally — this is the
first consumer of that fix and where a regression would show; (ii) history
renders the path to the new head, selected path only ([09 §6](../09-branching.md));
(iii) the event stream stays correct when the head moves mid-view; (iv) creating,
renaming and deleting a `BranchRef` moves no turn data, and deleting a ref
deletes no turns; (v) back-and-forward resumes from `lastSelectedChildId` rather
than guessing.

**Decide here, not during P6.3: §1.6's column.** `turn.branch_id` exists
(`index-db/migrations.ts:212`), is plumbed as a defaulted parameter
(`index-db/sessions.ts:90`) and is written NULL by both call sites
(`sessions/store.ts:346`, `index-db/rebuild.ts:133`). Populate it, or add the
materialised path [09 §3] actually asks for and drop it. §0.3 says *before* the
index work rather than during it; this is that moment.

**May not start before P6.0c.**

### P6.2 — The gestures

**Builds:** §1.3's two buttons on every ~~message~~ **turn** — [09 §7](../09-branching.md)
resolves branching inside a multi-message turn to that turn's *node*, which is
C11, and under `per-actor` dispatch one turn is several messages, so *message* is
the unit C11 was closed to stop people using (§0.2). Client work in
`packages/client/src/play/`; server work in `turns/runner.ts`, **which must gain
a replay path**: `runner.ts:304`'s bare `const rng = new Rng();` becomes
`new Rng({ replay })` when a tape is supplied, with the field added to
`RunnerOptions` or `TurnPayload`. `turns/preview.ts:135` is the second bare
construction and belongs in the same pass. P3's edit-and-re-run reconciles onto
the same sibling mechanism — it already writes siblings
([05 §1.2](05-p3-implementation.md)).

**Fix the group draw's payload before any of this can mean anything.**
`weightedPick` (`rng/rng.ts:196-213`) records an *index* into a candidate list
built in scan order, guarded on replay only by `detail = total=<summed weight>`,
so a group whose membership changed without changing the weight sum replays the
old index onto a different entry and still reports `replayed: true` (§0.1a).
Gate step 3's *"the record marks replayed vs fresh draws"* is otherwise
satisfiable by a draw that replayed to the wrong entry.

**Must prove:** (i) gate step 3 against **a fixture built to roll** — a lore
entry with `probability` below 100, or two entries contesting one group —
asserting the tape is non-empty *before* asserting anything about it, since an
ordinary turn commits `[]` and the step would otherwise pass by asserting
nothing; (ii) rewrite reproduces the same activation set and reroll does not,
with `replayed` marked per draw (`shared/src/turn.ts:109`); (iii) the reroll
affordance does not appear on a turn that consumed no draws
([07 §14.6](../07-tech-stack.md)); (iv) §1.8's decision is implemented **and
written down where a person can find it** — gate step 11.

*One trap for the fixture:* a session's lore links are session-wide but **not
time-invariant** — mutable at any moment through `PUT /sessions/:id/lore`, and
the books are live links resolved at assembly, so reconstructing an old node uses
today's book list and today's entry text. That is deliberate design, not a bug,
but the fixture must not change its book between the original turn and the
rewrite, or the step reddens for a reason that is not a defect.

**May not start before P6.1.** The two buttons need no draws and could in
principle precede the rewrite/reroll split; the split cannot.

### P6.3 — Siblings, undo, and hygiene

**Builds:** §1.2's inline sibling affordance (count, prev/next,
promote-to-named-ref). §1.4's tip-only undo — **the phase's most under-priced
line**: nothing inverts an effect anywhere in the tree, and the
`(channelId, scopeKey, path)` index §1.4 names has no table behind it. Two things
P5 changed here: `applyEffects` now keys on
`channelKey(effect.channelId, effect.scopeKey)` (`sessions/store.ts:445`), so an
undo replaying `before` lands on the right entry's timing; and `acceptEffect`
(`turns/effects.ts:49`) still refuses anything but a whole-value set at `/`,
correct for P5's timing writes and the place a narrower undo op would first be
met. §1.5's escaped-effect **producer** plus the abandonment banner — nothing
writes `'escaped'` today. §1.6's branch-labelled search, over whichever column
P6.1 decided. Tombstone skipping in the turn reader verified (compaction stays
unbuilt — tolerated, not shipped, per [02 §5.5](../02-data-model.md)).

**Must prove:** (i) gate step 10 **extended past sticky** — a `sticky`, a
`cooldown` and an `ephemeral` entry activated on one line are absent from a
sibling line that branched before the activation. This should hold *by
construction* through P6.0b; if it does not, the bug is in this phase's
reconstruction and not in P5's key, which is a useful thing to know before
debugging; (ii) gate step 4 — undo at the tip reverts locally, a deeper invert is
refused, and the refusal offers the branch; (iii) gate step 5 — a character dead
on one line is alive on the other; (iv) gate step 7 — search finds text on an
abandoned branch, labelled, never passed off as current; (v) gate step 8 — kill
the server, delete `index.sqlite`, restart, and the tree, refs and head survive.

**May not start its §1.6 half before P6.1's column decision.** The rest may run
in parallel with P6.2.

*Ends at:* the demo.

---
## 3. Verification — the P6 exit gate

~~Sketch; expand on revisit.~~ *Steps 1–8 were the sketch and stand. Steps 9–13
were added 2026-08-31 from §0 and §1.7–§1.9, which is the part of a gate worth
writing early: a gate written after the code is a gate written to pass. Step 14
and the amendments to 3 and 10 were added 2026-09-02 from §0.1a, once P5 had
actually landed and the gate could name real state instead of hypothetical.*

1. Branch from a message 200 turns back → new line in one action, no
   precondition, state at the fork correct per the property test.
2. Swipe a reply → a sibling; swipe again → a third; navigate among them; the
   discarded ones still exist an hour later. Promote one to a named ref —
   nothing copies.
3. Rewrite a turn that rolled dice → same outcome, different prose; reroll →
   new outcome; the record marks replayed vs fresh draws. At temperature 0 a
   rewrite returns ~the same text, and that is correct
   ([07 §14.6](../07-tech-stack.md)).
   **The fixture has to be built to roll** (§0.1a): the production draw sites are
   `lore.probability` and `lore.group`, so the session needs a lore entry with a
   `probability` below 100 or two entries contesting one group. A turn against an
   ordinary book commits an empty tape, and this step would then pass by
   asserting nothing. **Assert the tape is non-empty before asserting anything
   about it** — that is the assertion that fails if a future change quietly stops
   drawing.
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
    not have it. ~~Whether that holds by construction or by repair depends on
    which phase shipped first, and the gate does not care which.~~ **P5 shipped
    first and paid**, so this should hold *by construction* — `se.lore.timing`
    effects are keyed `se.lore.timing#<entryId>` and replay along the walked path
    like any other. **If it does not, the bug is in this phase's
    reconstruction and not in P5's key**, which is a useful thing to know before
    debugging. Extend it past sticky: **`cooldown` and `ephemeral` too** —
    ephemeral especially, since an entry spent on one line being spent on a
    sibling that never fired it is the same bug with a less visible symptom.
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
    **Sharpened by [07 §0.5](07-p5-implementation.md): it arrives undischarged,
    not changed.** The pre-P6 replay-from-zero test was never written — every
    `replayChannels` call site in P5's suite folds a clock-only path — so P6.0a
    *is* that discharge, generalised. Edit the step to say so rather than ticking
    it. **And P5's step 11 is subsumed by step 3 above**: P5 discharged the
    keying, this phase owns the reproduction, and P5's record now says so.

14. **Reconstruction stays affordable against a real lorebook** *(added
    2026-09-02 from §0.1a)*. P5 made the effect log an order of magnitude
    busier: every turn touching a book writes one `se.lore.timing` effect per
    entry whose counters moved. `retrieve` already filters to entries that
    actually changed — *"a library of four hundred entries would otherwise write
    four hundred no-op effects every single turn"* — and **that filter is now
    load-bearing for replay rather than a courtesy**. Reconstruct at depth 200
    against a session using a book of a few hundred entries and show the
    property test still passes in a time a person would accept. If it does not,
    the answer is the snapshot cache doing its job, which is P6.0 — not
    loosening the filter, which would trade a replay cost for a storage one.

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
is non-empty and §1.3 is testable~~ ~~**P5.4–P5.6 landed** — §0.1 checked, and it
is the *retriever* half that draws, so P5's document half landing changed
nothing here~~ **done 2026-09-02** (§0.1a: two production draw sites in
`retrieval/activate.ts`, with the caveat that only a rolling turn has a
non-empty tape); PLAYABLE run, so §1.1 and §1.8 have evidence; and a re-read of
[09 §5.1](../09-branching.md) against P8's chain, which §4 already names as the
handoff to check and which is the one of the three nobody is blocked on.

**So one of the three is spent and two remain, and only one of those blocks.**
PLAYABLE is the real gate on §1.1, §1.8 and §1.2; the [09 §5.1](../09-branching.md)
re-read is a desk task nobody is waiting on and could be done now.

*Re-priced again at §0.1a, downward on the largest line.* **§1.9's widening —
named above as the place the "P6 builds no storage" headline was conditional —
was paid by P5.5.** `SessionFile.channels` is keyed by `channelKey(channelId,
scopeKey)` already, so this phase inherits the persisted shape rather than
migrating it, and the headline is settled rather than conditional. What replaces
it is smaller but not nothing: **the effect log this phase replays is an order of
magnitude busier than the one §0 audited**, because every turn touching a
lorebook now writes a `se.lore.timing` effect per entry whose counters moved.
P6.0's snapshot cache is therefore load-bearing for a reason §0 could not see —
not just walk depth, but per-turn effect volume — and the property test has real
state to disagree about for the first time.
