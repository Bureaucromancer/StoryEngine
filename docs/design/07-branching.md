# 09 — Branching

**Status: capability requirement, with a proposed design.**

---

## 1. The requirement

> Branch a session at **any point, at any time**. Scroll back to any prior
> message, press one button, and you are on a new line of story.

Explicitly:

- **No preconditions.** No checkpoint to have been taken, no chapter to have
  closed, no summarisation to have run, no "branching mode" to enable.
- **No coupling to memory structure.** Branch points are not chapter boundaries.
- **Cheap enough to be casual.** If a user hesitates before branching because it
  feels expensive or messy, the feature has failed.
- **Worst case is recomputation, not refusal.** If some derived artefact — a
  summary, a state snapshot — is not valid for the new branch, the fallback is
  to rescan prior state and re-derive it. That is an acceptable cost. Blocking,
  degrading, or silently carrying stale state is not.

This is Marinara's behaviour: a branch is a record pointing at
`(parentChatId, parentMessageId)`, created in one action from any message.

It is explicitly **not** Aventuras' behaviour, which is the better-engineered
system and the wrong fit. Aventuras' `Branch` carries a
`checkpointId` "for world state restoration", so a branch depends on a
checkpoint existing; and `branchId` appears on eight entity types
(`StoryEntry`, `Character`, `Location`, `Item`, `StoryBeat`, `Chapter`, `Entry`,
plus world-state rows) with copy-on-write `overridesId` parents, `deleted`
tombstones, and a `snapshotComplete` flag to short-circuit lineage resolution.
Every one of those is machinery for branching *mutable rows*.

---

## 2. Why this is nearly free in this design

The requirement looks expensive and mostly isn't, because of a decision already
made for other reasons.

[02 §8](02-data-model.md) makes the turn log **append-only**, and records each
turn's `effects: ChannelEffect[]` — the state changes it caused, individually
reversible. [00 §2.8](00-stance.md) chose that over Aventuras'
`PersistentRetryState` precisely to avoid hand-maintained snapshots.

The consequence: **session state at turn N is a pure function of the effect log
up to turn N.** Nothing needs to be captured at branch time, because nothing was
ever destroyed. A branch is not a copy of anything.

So branching is not a feature to build so much as a property to not break:

> Any design decision that makes state at turn N unreconstructible from the log
> also breaks branching. That is the real reason effects must be complete and
> reversible, and it is a sharper test than "undo would be nice".

---

## 3. The session is a tree of turns

**Decision: swipes and branches are one mechanism.** Working that through
invalidated the first sketch of this section, which modelled a branch as a
`Branch` record carrying a `forkTurnIndex`, with turns identified by
`(branchId, index)`. That model breaks under heavy swiping, and the reason is
worth recording because it is not obvious.

**The wandering-trunk problem.** Under `forkTurnIndex`, the first attempt at a
turn lives on the parent branch and every swipe creates a child. Take the good
third swipe and continue, and your story is now on that child. Do it again
twenty turns later and you are two deep. Over a long session the actual
storyline migrates through hundreds of branch records; "trunk" stops meaning
anything, reading history walks a chain hundreds of records deep, and the first
attempt at every turn is privileged for no reason other than being first. The
model imported a linear-log assumption that swiping does not respect.

The fix is to drop the linear log. **A session is a tree of turns.**

```ts
interface Turn {
  id: TurnId                     // stable, opaque, immutable
  sessionId: SessionId
  parentTurnId: TurnId | null    // null = first turn
  // … input, request, output, effects, cost — as [02 §8]
}

interface BranchRef {            // a *name*, nothing more
  id: BranchRefId
  name: string
  headTurnId: TurnId
}
```

That is the entire model. There is no `Branch` entity owning turns, no
`forkTurnIndex`, no parent-branch chain.

- **Continue** = append a child to the current node.
- **Swipe / regenerate** = append *another* child to the same parent.
- **Branch from an old message** = append another child to that old node.

Those are the same operation. The distinction between a swipe and a branch is
presentational — a swipe is a sibling you are comparing right now, a branch is a
sibling someone bothered to name — and a `BranchRef` is just a bookmark on a
node, like a git ref. Promoting a swipe to a named branch writes ~50 bytes and
moves no data.

**Turn ids are stable and opaque, not `(branchId, index)`.** This matters more
than it looks: §5 keys summaries on turn ids, so an identifier that changes when
a turn is re-parented would silently break the summary cache. Position in the
tree is a field, never part of identity.

**Session head.** The session stores `headTurnId` — where you are. Named refs
are separate and optional. A node may also record `lastSelectedChildId`, purely
so that navigating back and then forward again resumes where you were rather
than guessing.

**Reading history** walks `parentTurnId` from the head to the root: O(depth),
against turns you were going to read anyway. The derived index can materialise
paths for fast queries, which is index hygiene rather than a model concern.

**Everything before a fork is shared by construction** — the same nodes, not
copies — which is what §5 exploits.

---

## 4. Reconstructing state at the fork

Replaying every effect from turn 0 is correct and, at turn 800, too slow to feel
casual.

**State snapshots as a derived cache.** Periodically (every N turns of depth,
and at nodes that have acquired more than one child), write the full channel
state alongside the log, keyed by `TurnId`. Reconstruction is then *walk up to
the nearest ancestor holding a snapshot, replay effects forward along the path*.

Snapshotting at fork points is the cheap win: a node with several children is a
node whose state will be materialised repeatedly, once per sibling explored.

Snapshots follow the same rule as the SQLite index
([02 §5.1](02-data-model.md)): **derived, disposable, never authoritative.**
Deleting every snapshot must cost time and nothing else.

**Including the one in `session.json`.** That file carries channel state at the
head, which reads like the session's canonical state and is not — it is a
snapshot like any other, materialised there because a human opening the file
should be able to read the clock ([02 §8.1](02-data-model.md)). Treating it as
authoritative would mean branch switching rewrites it, which puts mutable state
back in the middle of the one mechanism this document exists to keep cheap. The
reconciliation, including what happens when someone hand-edits it, is in
[02 §8.1](02-data-model.md). A snapshot that
disagrees with a replay is a bug in the effects, and CI should check exactly
that on a fixture session — replay-from-zero must equal snapshot-plus-replay at
every index.

This keeps branch creation O(1) and state materialisation bounded by the
snapshot interval, without adding a precondition to branching.

---

## 5. Memory: why summaries mostly survive a branch

This is the part the requirement is really about, and the answer is better than
the stated worst case.

**Make summaries content-addressed.** A summary's cache key is a hash of its
inputs — the turn ids and content fingerprints it covers, plus the summariser
prompt, model and parameters. Not the branch it was made on.

In tree terms this gets simpler to state than it was under the linear model. A
summary covers a run of turns along a path. Fork at node `F` by giving it a
second child:

| The summary's turns | Result |
|---|---|
| entirely at or above `F` | **Valid, reused.** They are the *same nodes*, so the key matches exactly. |
| spanning `F` and below | **Invalid.** Key differs. Recompute over the ancestor portion. |
| entirely below `F` on the sibling path | Irrelevant; belongs to the other line. |

**At most one summary is ever invalidated by a fork: the one in progress.**
Everything older sits on shared ancestor nodes, unchanged, and is reused without
a single model call.

This also handles hierarchical summarisation — summaries of summaries —
correctly and without special cases. A parent summary's key includes its
children's fingerprints, so a changed child yields a different key, which is a
cache miss, which is a recompute. Ordinary content-addressed caching does the
invalidation for free.

And it delivers the requirement's stated fallback exactly: when a key misses,
the answer is to rescan the underlying turns and re-summarise. That path is
real, it is the safety net, and it turns out to be rarely taken at full scope.

**What this rules out:** a summariser whose output depends on hidden mutable
state not captured in the key — "summarise since last time" with a moving
cursor, or a rolling summary that mutates a single record in place. Both make
summaries un-shareable across branches and would force the expensive path every
time. Summaries must be *values keyed by their inputs*, not *a running total*.

### 5.1 The rolling summary is a chain, not a blob

[06 E1](06-open-questions.md) settles the rolling summary as the default
in-session memory, which reads like a collision with the paragraph above. It is
not, provided one thing holds: **"rolling" describes the chain, not mutation.**

```
summary(n) = f( summary(n-1), turns[a..b] )
```

Each link is a value keyed by the hash of its inputs — the previous link's key
plus the turns it consumes. That is §5's rule applied to a chain rather than a
flat run, so everything above follows unchanged: a fork leaves every link up to
`F` byte-identical, exactly the straddling link misses, and the branch's chain
continues from a shared prefix.

The forbidden design is the one-record-updated-in-place version, and it is
forbidden for a reason worth restating: it is the *obvious* implementation, it
looks identical from the UI, and the damage only shows up the first time someone
branches a long session. Build the chain from the start.

---

## 6. Swipes are branches — DECIDED

ST and Marinara both treat swipes (regenerate an alternative reply) and branches
as separate mechanisms with separate storage: swipes as an array of alternatives
hanging off a message, branches as their own records. Under §3 they are one
thing, and this is adopted.

- A **swipe** is a sibling node nobody named.
- "Show my other swipes" is "show this node's siblings".
- **Promoting** a swipe is creating a `BranchRef` pointing at it. No data moves.
- Continuing from a swipe taken twenty turns ago is not a feature — it is
  navigating to that node and appending.

What this buys, beyond one mechanism instead of two:

- **Swipes stop being ephemeral.** In all three sources a discarded swipe is
  gone. Here nothing is destroyed unless someone asks. "I liked the second
  version from an hour ago" becomes answerable.
- **Swipe alternatives carry their full turn record** — the assembled blocks,
  the budget verdict, the cost ([02 §8](02-data-model.md)). Comparing two swipes
  can therefore compare *why they differed*, not just their text. No tool in the
  survey can do this, and it falls out for free.
- **Effects are per-attempt.** A swipe whose channel effects differ from its
  sibling's is handled correctly with no special case, because each node owns
  its own effects. The sources' swipe arrays cannot express this at all — which
  is why swiping in a game-like mode tends to corrupt tracked state in practice.
- **Rewrite and reroll are separable, and rewrite is the default.** Each node
  records the draws it consumed ([07 §14.5](07-tech-stack.md)), so a sibling can
  either replay that tape — *rewrite*: same mechanical outcome, different
  writing — or draw fresh — *reroll*: new outcome. Without the distinction,
  swiping past a failed check is save-scumming by accident. Both siblings are
  ordinary nodes either way; the difference is only which draws they inherited,
  and the turn record says which. Either may carry an instruction about the
  attempt it replaces ([§7](#7-edges-worth-naming)), and the record says that
  too: which sibling was shown, and what was asked.

The cost is UI, not storage. A long session accumulates many unnamed siblings,
so the history view must default to the selected path and surface siblings as an
inline affordance on the node, with the full tree behind a deliberate action.
Retention is [06 C9](06-open-questions.md); the storage argument for keeping
everything is strong, so the question is really about presentation.

That "deliberate action" is the branch tree visualiser, specified as a post-1.0
item in [14 §1](14-roadmap.md). It is pure addition — everything it draws is
already recorded — with one obligation on 1.0: turn storage must tolerate
removal, so pruning is possible later without a migration.

---

## 7. Edges worth naming

**Effects that escaped the session.** Reversibility holds for channel state.
It does not hold for things that left: a lorebook entry promoted to the shared
library, an actor card written, an image generated and stored, a message sent by
an extension to something external. Branching cannot un-write those, and
pretending otherwise would be worse than admitting it.

Proposal: effects carry a `scope: "session" | "escaped"`. Escaped effects are
recorded in the turn record like everything else but are explicitly not replayed
or reverted, and the branch UI can say plainly that N library writes from the
abandoned line still exist. This is a small honesty feature that avoids a
confusing class of bug reports.

**Two gestures, and the tree names them cleanly.** From a given message the user
may mean *redo this* or *continue differently from here*. In the tree these are
obviously distinct and both are one operation:

- **Redo** — add a sibling to that node (same parent).
- **Continue differently** — add a child to that node.

Both should be offered explicitly. Guessing will be wrong half the time, and the
earlier `forkTurnIndex ± 1` framing made them look like the same thing with an
off-by-one, which they are not.

**Redo may carry an instruction — DECIDED.** *Redo this* is often *redo this,
but change X*, and a redo that cannot say so sends the user back to typing the
instruction into their action, which is the habit the guidance box exists to
end ([03 §5.1](03-modes-and-turn-pipeline.md)). So the per-turn controls carry
a field for it, and what is typed there rides with whichever of rewrite and
reroll is pressed next — a modifier on the gesture, not a third gesture,
because "not that sentence" and "not that outcome" are still different
requests ([07 §14.5](07-tech-stack.md)). With an instruction the model is also
shown the attempt it is about: a sibling is an ordinary node with a full
record, so the redo's record says which attempt was shown and what was asked,
and the attempt itself is never history. Empty, the field changes nothing.

**Branching within a multi-message turn.** Under `per-actor` dispatch
([03 §3](03-modes-and-turn-pipeline.md)) one turn produces several messages. A
turn is still **one node**, because the turn is the atomic unit for effects — so
"branch from message 2 of 3" resolves to an operation on that turn's node.
Turn-granular, and now obviously so rather than by convention.

**Branch and the derived index.** Library search must not surface content from
lines the user is not on. Session-scoped index rows carry their `TurnId` and a
materialised path; index hygiene rather than a design problem, but the sort of
thing discovered late.

---

## 8. Correction to the triage

[triage](workplan/02-triage.md) lists Aventuras' branching (COW + tombstones) as
**PORT — "best-in-class among the three; nothing comparable elsewhere"**.

**That verdict was wrong for this requirement, and is revised to REBUILD.**

The engineering quality assessment stands — it *is* the most sophisticated of
the three. But COW-with-tombstones exists to branch **mutable entity rows**, and
we do not have mutable entity rows; we have an append-only effect log. Porting
that machinery would import a checkpoint precondition, per-entity branch
plumbing on eight types, and lineage resolution — all to solve a problem the
effect log has already dissolved.

What to take from Aventuras here is narrower and still valuable: the
**observation** that branches need entity-level and not just message-level
divergence (true, and handled by channels), and the `snapshotComplete`
performance instinct (which reappears as §4's snapshot cache).

The UX to port is **Marinara's**: one button, any message, any time.

---

## 9. Open questions

Added to [06](06-open-questions.md) as C8–C10. C11 (branch anchor within a
multi-message turn) is **resolved** by §3 — a turn is one node.

- **C8. Snapshot interval and eviction.** Every N turns of depth, plus at nodes
  with multiple children — what is N, and are old snapshots evicted? Cheap to
  tune later; needs a default.
- **C9. Unnamed-sibling retention.** Does §6 keep every swipe forever? Storage
  says yes trivially; the real question is presentation, since the history view
  must not turn into a tree browser by default.
- **C10. Cross-branch merge.** Explicitly out of scope for 1.0 — but worth
  confirming nothing above precludes it. Nothing appears to: merging is
  reconciling two effect sequences from a common ancestor, and the tree makes
  the common ancestor trivially findable, which is the part that is usually
  hard.
