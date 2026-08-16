# 24 — P6 implementation plan

**Status: skeleton.** Drafted during P1; to be revisited before the phase
starts. Unusually for these plans, most of P6 is *already decided* — the tree
model, swipes-as-branches, snapshots-as-cache and the tape are settled in
[10](10-branching.md) and [07 §14.5](07-tech-stack.md) — so this document is
mostly sequencing plus the two open questions those documents left (C8, C9).
Format follows [19](19-p1-implementation.md).

**P6 delivers**, from [15 P6](15-work-plan.md): branching, rewrite/reroll, the
RNG tape in anger, and sibling navigation. **Why before modes:** it changes the
shape of the turn store's *use*, and every mode built after it inherits the
behaviour for free; built after modes, it is a migration.

**The demo that defines done:** *scroll back to any prior message, press one
button, and be on a new line of story — with channel state correct, summaries
untouched (none exist yet — the constraint is on shape, not features), and the
old line intact and reachable.* Marinara's UX on our storage:
no checkpoint precondition, no branching mode, cheap enough to be casual
([10 §1](10-branching.md)).

**What P2 already bought.** `parentTurnId` is on every turn from the first
([20 §2.5](20-p2-implementation.md)), segments append in creation order
([02 §5.5](02-data-model.md)), effects are complete and reversible, and the
tape is recorded keyed by site. P6 builds no storage; it builds **navigation,
reconstruction performance, and the two-gesture UI** over storage that was
tree-shaped all along. If P6 finds itself migrating the turn store, P2 broke
its contract.

**CI this phase establishes:** the replay property test —
*for a fixture session, state at every index is identical reconstructed from
zero or from the nearest snapshot* ([16 §3.3](16-testing.md),
[10 §4](10-branching.md)). One property protecting branching, regeneration and
undo simultaneously.

---

## 1. Decisions this plan has to make

### 1.1 Snapshot interval and eviction — closing C8

[06 C8](06-open-questions.md): snapshots every N turns of depth, plus at any
node that acquires a second child (the node about to be materialised once per
sibling). Needs a default N; `sessions.snapshotEveryNTurns` already exists in
config at `10` ([18 §4](18-internal-contracts.md)), which is the provisional
answer. Eviction: none at 1.0 — snapshots are small (channel state is numbers
and flags), derived, and deleting them all must already cost only time, which
the property test enforces. Decide N finally on revisit with real session sizes
from PLAYABLE.

### 1.2 Sibling presentation — closing C9 far enough to ship

[06 C9](06-open-questions.md): everything is kept; the question is
presentation. The 1.0 answer per [10 §6](10-branching.md): history shows the
selected path only; a node with siblings gets an inline affordance (count +
prev/next + promote-to-named-ref); the full tree visualiser stays post-1.0
([11 §1](11-roadmap.md)). `lastSelectedChildId` per node so back-and-forward
resumes rather than guesses ([10 §3](10-branching.md)).

### 1.3 The two gestures are two buttons

*Redo* (sibling of this node) and *continue differently* (child of this node)
are both offered explicitly from any message — guessing is wrong half the time
([10 §7](10-branching.md)). Redo further splits rewrite/reroll where draws
exist, rewrite default, reroll the explicit second action, no second affordance
when the turn consumed no draws ([07 §14.5–14.6](07-tech-stack.md)).

### 1.4 Undo is tip-only, and the refusal is a feature

Undo applies `before` at the tip; anything deeper is refused and the branch
path offered instead — the check is the index knowing the latest effect per
`(channelId, scopeKey, path)` ([18 §1.2.1](18-internal-contracts.md)). This
lands at P6 rather than P2 because the refusal's *alternative* (branch here) is
what makes it acceptable UI, and that alternative is this phase.

### 1.5 Escaped effects, and the honesty banner

Effects carry `scope: "session" | "escaped"` per [10 §7](10-branching.md);
escaped ones (library writes, generated assets) are never replayed or
reverted, and abandoning a line says plainly that N library writes from it
still exist. Small, and it pre-empts a confusing class of bug reports.
**Closed at the P2 revisit, the way it leaned:** `scope` was added to
`ChannelEffect` in [18 §1.2](18-internal-contracts.md) and P2 writes only
`"session"` ([20 §2.7](20-p2-implementation.md)) — P6 gets a field, not a
migration.

### 1.6 Branch hygiene in the index and search

Session-scoped index rows carry their turn id and a materialised path;
turn-search hits off the current path stay indexed and are **labelled** with
their branch, never hidden and never passed off as current
([07 §7.1](07-tech-stack.md), [05 §14.2](05-ui-surfaces.md)). Path
materialisation for the head is one more derived thing the index holds.

---

## 2. Stages

### P6.0 — Reconstruction and snapshots

State-at-node as walk-up-replay-forward over §1.1's snapshot cache;
`session.json`'s head snapshot rewritten on head move (staying derived —
[02 §8.1](02-data-model.md)); the replay property test green. This stage is
pure engine and ships no UI.

### P6.1 — Navigation and the head

Move head to any node; history renders the path to it; `BranchRef` create /
rename / delete (a ref is ~50 bytes and moves no data); reattach and the event
stream correct when the head moves mid-view.

### P6.2 — The gestures

§1.3's two buttons on every message; rewrite/reroll over the tape with
replayed-vs-fresh draws marked in the record; P3's edit-and-re-run reconciled
onto the same sibling mechanism (it was already writing siblings —
[21 §1.2](21-p3-implementation.md)).

### P6.3 — Siblings, undo, and hygiene

§1.2's inline sibling affordance; §1.4's tip-only undo with the branch offer;
§1.5's escaped-effect labelling; §1.6's branch-labelled search. Tombstone
skipping in the turn reader verified (compaction itself stays unbuilt —
tolerated, not shipped, per [02 §5.5](02-data-model.md)).

*Ends at:* the demo.

---

## 3. Verification — the P6 exit gate

Sketch; expand on revisit.

1. Branch from a message 200 turns back → new line in one action, no
   precondition, state at the fork correct per the property test.
2. Swipe a reply → a sibling; swipe again → a third; navigate among them; the
   discarded ones still exist an hour later. Promote one to a named ref —
   nothing copies.
3. Rewrite a turn that rolled dice → same outcome, different prose; reroll →
   new outcome; the record marks replayed vs fresh draws. At temperature 0 a
   rewrite returns ~the same text, and that is correct
   ([07 §14.6](07-tech-stack.md)).
4. Undo the newest turn → channel state reverts locally; attempt to invert a
   deeper effect → refused, branch offered (§1.4).
5. A character dead on one line is alive on the other; timing counters
   ([23 §1.1](23-p5-implementation.md)) diverge per line correctly.
6. Delete every snapshot → everything still works, slower; the property test
   asserts equality at every index.
7. Search finds text on an abandoned branch, labelled as such (§1.6).
8. Kill the server, delete `index.sqlite`, restart → the tree, refs and head
   all survive; only derived things were lost.

---

## 4. Out of scope, deliberately

The branch tree visualiser (post-1.0, [11 §1](11-roadmap.md)); branch/subtree
pruning UI (post-1.0 — the storage tolerates it, which was P2's obligation);
cross-branch merge ([06 C10](06-open-questions.md) — out of scope and
deliberately not precluded); summarisation (P8 — but P8's rolling summary
**must** arrive as the content-addressed chain of
[10 §5.1](10-branching.md), and this phase's revisit should re-read that
section as the handoff); retention/compaction policy (keep everything,
[02 §5.5](02-data-model.md)); multiplayer arbitration over shared heads
([04 §8](04-server-multiuser-deployment.md)).
