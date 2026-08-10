# 11 — Post-1.0 roadmap

**Status: proposal.** Things deliberately deferred past 1.0. An item earns a
place here by being *additive* — if deferring it would force a data-model change
later, it belongs in 1.0 instead, and the test for each entry below is "what
does this oblige 1.0 to do?"

---

## 1. Branch tree visualiser

The turn tree ([10 §3](10-branching.md)) makes every swipe and branch a node in
one structure. At 1.0 the reading surface shows the **selected path**, with
siblings as an inline affordance on each node ([06 C9](06-open-questions.md)).
That is the right default and it is deliberately not a tree browser.

The visualiser is the escalation: a view of the whole tree for when the default
stops being enough.

### 1.1 Why post-1.0

It is pure addition. Everything it displays — topology, cost, model, channel
effects, summary reuse — is already recorded by 1.0 for other reasons
([02 §8](02-data-model.md)). It derives, it does not require.

It is also the wrong thing to build early for a softer reason: **it is only
worth designing once real sessions exist.** The layout problem below depends
entirely on the shape trees actually take in use, and that is currently a guess.

### 1.2 What it is for

Four uses, in rough order of how often they will come up:

1. **Navigation.** Get back to a line abandoned two hours ago. This is the one
   that justifies the feature on its own.
2. **Comparison.** Two attempts at the same turn diverged; show how.
3. **Understanding divergence.** Where did the *state* split, not just the prose
   — when did this line's reputation, inventory or clock stop matching that
   one's.
4. **Curation.** Prune dead exploration; name lines worth keeping.

### 1.3 The topology problem, and the layout answer

A turn tree is not a balanced tree and generic graph layout will make a mess of
it. Its actual shape is **a long spine with occasional bushes**: the
overwhelming majority of nodes have exactly one child, punctuated by nodes with
several. A 600-turn session with an average of two swipes per turn is well over
a thousand nodes, nearly all of them structurally uninteresting.

So:

- **Collapse linear runs into single edges**, labelled with their length
  ("47 turns"). Only fork points, named refs, and the head are drawn as nodes.
  This is the whole trick — it takes a thousand-node picture down to a few dozen
  marks.
- **Semantic zoom.** Far out: named refs and major forks only. Closer: all forks.
  Closest: individual turns within a run.
- **Deterministic layered layout, never force-directed.** The picture must be
  *stable* — the same tree must look the same every time it is opened, and
  adding a turn must not reshuffle everything. A user builds a spatial memory of
  their own story; a layout that jumps destroys it. No animated re-layout.
- **Spine-anchored.** The currently selected path is the visual trunk and
  everything else hangs off it, rather than the tree being drawn "objectively"
  and the user having to find themselves in it.

### 1.4 Feature tiers

Roughly in build order; each is useful without the next.

**R1 — Navigate.** The collapsed tree, named refs, the head, click a node to go
there. Sibling counts on fork nodes. A minimap for long spines. This tier alone
is the feature.

**R2 — Compare.** Select two nodes, get a three-way comparison: output text,
assembled blocks, and cost. The block diff is not new work — the workbench
([05 §3](05-ui-surfaces.md)) already diffs turn records; this is a second
entry point into it.

**R3 — State divergence.** The genuinely novel tier, and the one no tool in the
survey can do. Because effects are per-node, channel state at any node is
reconstructible ([10 §4](10-branching.md)), so the visualiser can answer *how
these two lines differ in substance*:

> On this line you have 40 gold and Vera trusts you. On that one you are broke
> and she is hostile. They split 12 turns ago, when you took the bribe.

Concretely: colour or badge edges where a watched channel diverges; select two
nodes for a channel-state diff; select a channel and see where in the tree it
changed. "Where did this go wrong" becomes a question with an answer.

**R4 — Curate.** Rename, promote a swipe to a named ref, prune a subtree,
bookmark. Pruning must surface the escaped-effects warning from
[10 §7](10-branching.md): deleting a subtree cannot un-write library entries or
generated images that line produced, and the UI should say so with a count
rather than let it be discovered later.

**R5 — Cost.** Tokens and spend attributed across the tree; abandoned lines
made visible as what they cost. Cheap once R1 exists, since the data is already
on every node.

### 1.5 A nice extra: summary sharing

Content-addressed summaries ([10 §5](10-branching.md)) mean the tree knows which
parts of itself share memory. Showing the extent of a shared summary as a span
over the spine makes an abstract property concrete, and explains to a user why
branching was free here and expensive there. Small, and unusually explanatory.

### 1.6 What this obliges 1.0 to do

Almost nothing — which is the point of deferring it. Everything above derives
from data 1.0 already records.

**One exception, and it is worth acting on now.** R4's pruning implies deleting
turns, and [02 §5.5](02-data-model.md) proposes storing turns as append-only
JSONL segments. Deleting a record inside an append-only segment is awkward if
nothing anticipated it.

So 1.0 should ensure **turn storage tolerates removal**: a tombstone marker the
reader skips, plus a compaction pass that rewrites segments. Neither needs a UI
at 1.0, and neither is expensive to include up front. Retrofitting deletion into
a format that assumed pure append is exactly the kind of thing that turns a
pleasant later feature into a migration.

### 1.7 Non-goals

- **Not the default reading surface.** The 1.0 path view stays the default. A
  tree browser as the primary way to read your own story would be a bad trade
  for a feature most people use occasionally.
- **Not a merge tool.** Cross-branch merge is [06 C10](06-open-questions.md) and
  stays out of scope. The visualiser is where a merge UI would eventually live,
  which is a reason to keep its layout honest, not a reason to build merging.
- **Not editable topology.** No dragging nodes to re-parent. The tree records
  what happened; rewriting history is not a story feature.

---

## 2. Other deferred items

Already deferred in their own documents; listed here so the roadmap has shape.
None is specified further than its original entry.

| Item | Deferred in | Note |
|---|---|---|
| Real multiplayer — turn arbitration, per-user hidden state, simultaneous input | [04 §6](04-server-multiuser-deployment.md) | Posture is "don't preclude, don't build"; three cheap 1.0 decisions keep the door open |
| Truly mobile-optimised layout | [05 §1](05-ui-surfaces.md) | A mode of the same web app, never a native shell |
| In-UI file access: write, and the text editor | [05 §4.4](05-ui-surfaces.md) | Read plus zip-download ships earlier; write is the risky half |
| Custom extension rendering (sandboxed iframe) | [05 §7](05-ui-surfaces.md) | The declarative widget vocabulary covers 1.0; the escape hatch is real work |
| Tailscale levels 2 and 3 (tailnet identity, `tsnet` node) | [04 §4.2](04-server-multiuser-deployment.md) | Level 1 ships; the auth layer is shaped so 2 is a provider, not a special case |
| Cross-branch merge | [06 C10](06-open-questions.md) | Nothing in the tree model precludes it |
| Per-actor knowledge scope (anti-omniscience) | [09 §5](09-infinite-worlds.md) | Held as an acceptance test for the channel model, not a feature commitment |

**[OPEN]** Whether the peripheral feature surface discarded in
[08 §6.3](08-triage.md) — table games, music, calls, haptics — belongs on this
roadmap at all. The position taken there is that it should be *buildable* rather
than built, and that shipping any of it in core would be the wrong signal about
what the extension contract is for. Listing them as roadmap items would quietly
reverse that.
