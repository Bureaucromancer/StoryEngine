# 08 — P6 implementation plan

**Status: skeleton, expanded 2026-08-31 with a readiness audit and the deferrals
collected.** ~~Drafted during P1; to be revisited before the phase starts.~~
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

- **No snapshot machinery of any kind.** `sessions/` mentions the *head*
  snapshot and nothing else; there is no depth-indexed cache, no eviction, and
  no walk-up-replay-forward. P6.0 starts from nothing.
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

---

## 1. Decisions this plan has to make

### 1.1 Snapshot interval and eviction — closing C8

[06 C8](../06-open-questions.md): snapshots every N turns of depth, plus at any
node that acquires a second child (the node about to be materialised once per
sibling). Needs a default N; `sessions.snapshotEveryNTurns` already exists in
config at `10` ([13 §4](../13-internal-contracts.md)), which is the provisional
answer. Eviction: none at 1.0 — snapshots are small (channel state is numbers
and flags), derived, and deleting them all must already cost only time, which
the property test enforces. Decide N finally on revisit with real session sizes
from PLAYABLE.

### 1.2 Sibling presentation — closing C9 far enough to ship

[06 C9](../06-open-questions.md): everything is kept; the question is
presentation. The 1.0 answer per [09 §6](../09-branching.md): history shows the
selected path only; a node with siblings gets an inline affordance (count +
prev/next + promote-to-named-ref); the full tree visualiser stays post-1.0
([14 §1](../14-roadmap.md)). `lastSelectedChildId` per node so back-and-forward
resumes rather than guesses ([09 §3](../09-branching.md)).

### 1.3 The two gestures are two buttons

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
migration.

### 1.6 Branch hygiene in the index and search

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
  split is untestable until then and fully testable after.
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

State-at-node as walk-up-replay-forward over §1.1's snapshot cache;
`session.json`'s head snapshot rewritten on head move (staying derived —
[02 §8.1](../02-data-model.md)); the replay property test green. This stage is
pure engine and ships no UI.

### P6.1 — Navigation and the head

Move head to any node; history renders the path to it; `BranchRef` create /
rename / delete (a ref is ~50 bytes and moves no data); reattach and the event
stream correct when the head moves mid-view.

### P6.2 — The gestures

§1.3's two buttons on every message; rewrite/reroll over the tape with
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

9. **`sessions.snapshotEveryNTurns` reads `applied`**, and its test passes. It
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
[09 §5.1](../09-branching.md), and this phase's revisit should re-read that
section as the handoff); retention/compaction policy (keep everything,
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

**What would make this a plan rather than a skeleton:** P5 landed, so the tape
is non-empty and §1.3 is testable; PLAYABLE run, so §1.1 and §1.8 have evidence;
and a re-read of [09 §5.1](../09-branching.md) against P8's chain, which §4
already names as the handoff to check.
