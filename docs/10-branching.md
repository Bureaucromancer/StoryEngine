# 10 — Branching

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

## 3. The branch object

```ts
interface Branch {
  id: BranchId
  sessionId: SessionId
  parentBranchId: BranchId | null   // null = trunk
  forkTurnIndex: number             // this branch's turns start here
  name: string | null               // null = unnamed (see §6)
  createdAt: string
}
```

That is the whole write on branch creation — a few dozen bytes. No checkpoint,
no entity copies, no tombstones, no `snapshotComplete`.

**Reading a branch's history** walks the parent chain: turns `< forkTurnIndex`
come from the parent (recursively), turns `>= forkTurnIndex` from this branch.
Turns before the fork are *not copied* — they are the same turns, shared, and
that sharing is what §5 exploits.

**Turn identity.** A turn is `(branchId, index)`. Pre-fork turns keep their
original branch id, so a turn is written exactly once and read from many
branches.

---

## 4. Reconstructing state at the fork

Replaying every effect from turn 0 is correct and, at turn 800, too slow to feel
casual.

**State snapshots as a derived cache.** Periodically (every N turns, and always
at a fork point once one is created), write the full channel state alongside the
log. Reconstruction is then *nearest snapshot ≤ target, replay forward*.

Snapshots follow the same rule as the SQLite index
([02 §5.1](02-data-model.md)): **derived, disposable, never authoritative.**
Deleting every snapshot must cost time and nothing else. A snapshot that
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

Given that, consider a summary `S` covering turns `[a, b]`, and a branch forking
at turn `f`:

| Case | Result |
|---|---|
| `b < f` — entirely before the fork | **Valid, reused.** Those turns are literally the same turns, so the key matches. |
| `a > f` — entirely after the fork | Irrelevant; belongs to the other branch. |
| `a ≤ f ≤ b` — straddles the fork | **Invalid.** Key differs. Recompute over `[a, f]`. |

**At most one summary is ever invalidated by a fork: the one in progress.**
Everything older is shared, unchanged, and reused without a single model call.

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

---

## 6. Swipes are branches

ST and Marinara both treat swipes (regenerate an alternative reply) and branches
as separate mechanisms with separate storage. If a branch costs a few dozen
bytes, they are the same thing:

- A **swipe** is an unnamed branch forking at the current turn.
- "Show my other swipes" is "show sibling branches at this turn index".
- **Promoting** a swipe to a named branch is setting `name`. No data moves.
- Continuing from a swipe you took twenty turns ago is not a special feature —
  it is just navigating to that branch.

This collapses two features into one and gives something no tool in the survey
does well: **swipes stop being ephemeral.** Today a discarded swipe is
unrecoverable in all three sources; here nothing is thrown away unless the user
asks.

The cost is UI, not storage: a long session accumulates many unnamed branches,
so the branch view must distinguish named/promoted branches from swipe noise by
default, and offer a prune action. **[OPEN]** whether unnamed sibling branches
should be garbage-collected on a retention policy, and whether that is even
desirable given the above.

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

**Branching within a multi-message turn.** Under `per-actor` dispatch
([03 §3](03-modes-and-turn-pipeline.md)) one turn produces several messages.
"Branch from message 2 of 3" has no clean meaning, because the turn is the
atomic unit for effects.

Proposal: anchor branches at **turn boundaries**. Branching from a message
inside a multi-message turn forks *before* that turn and pre-fills the original
input, which is the honest behaviour and matches what the user usually wants
("run that turn again, differently"). **[OPEN]** — worth confirming against real
use.

**Two branch points, one gesture.** From a given message the user may mean
"redo this" (fork before the turn) or "continue differently from here" (fork
after it). Same mechanism, `forkTurnIndex` differs by one. Both should be
offered; guessing will be wrong half the time.

**Branch and the derived index.** Library search must not surface content from
branches the user is not on. The index carries `branchId` on session-scoped
rows; this is index hygiene rather than a design problem, but it is the sort of
thing that is discovered late.

---

## 8. Correction to the triage

[08](08-triage.md) lists Aventuras' branching (COW + tombstones) as
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

Added to [06](06-open-questions.md) as C8–C10.

- **C8. Snapshot interval and eviction.** Every N turns, plus at fork points —
  what is N, and are old snapshots evicted? Cheap to tune later; needs a default.
- **C9. Unnamed-branch retention.** Does §6 keep every swipe forever? Storage
  says yes trivially; UI says the branch view needs a strong default filter.
- **C10. Cross-branch merge.** Explicitly out of scope for 1.0 — but worth
  confirming nothing above precludes it. Nothing appears to: merging is a
  question about reconciling two effect sequences, which the log makes
  expressible even if it is not easy.
