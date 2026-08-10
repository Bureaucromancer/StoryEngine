# 11 — Post-1.0 roadmap, and desired extensions

**Status: proposal.** Two distinct lists that are easy to confuse:

- **§1–2, the roadmap** — things *we* intend to build, after 1.0. An item earns
  a place by being *additive*: if deferring it would force a data-model change
  later, it belongs in 1.0 instead, and the test for each entry is "what does
  this oblige 1.0 to do?"
- **§3, desired extensions** — things we hope *someone else* builds, and in
  several cases should never be in core at all. Hints for expansion authors,
  and the standing acceptance test for the extension contract.

§3 is likely to graduate into user-facing documentation once the SDK exists.

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

The peripheral feature surface discarded in [08 §6.3](08-triage.md) — table
games, music, calls, haptics — deliberately does **not** appear above. It is not
a roadmap; it is §3.

---

## 3. Desired extensions

Not a roadmap. Nothing here is planned, scheduled, or promised, and several
entries would be actively wrong to ship in core. This section exists as **a set
of large hints for anyone who wants to write an expansion** — what is worth
building, which seam it should use, and where the naive version goes wrong.

It doubles as the acceptance test for [03 §9](03-modes-and-turn-pipeline.md): if
a motivated person cannot build these against the published contract without
engine changes, the contract has failed and that is our problem, not theirs.

### 3.1 First question: rules or code?

Before anything else, work out which tier the idea belongs to
([09 §2](09-infinite-worlds.md)):

- **Authored rules** — declarative conditions and effects over channels, shipped
  as data inside a package. No installation, no code review, no AGPL obligation
  ([08 §1.2](08-triage.md)), works for anyone who imports the package.
- **Code extension** — a real module with steps, channels and widgets. More
  power, more responsibility, must be AGPL, must be installed deliberately.

The test: **does it need to compute something, or only to decide something?**

A weather system that shifts conditions with season and location is *deciding* —
rules. A weather system that runs a wind model is *computing* — code. Rules
handle far more than people expect, and Infinite Worlds' community built class
trees, loot tables, encounter generators and quest state machines without ever
touching code. Reach for code second.

### 3.2 The principle behind the best ones

The strongest extension ideas share a shape, and it is worth naming because it
is the opposite of the instinct most people arrive with.

> **Let a deterministic system do the hard work. Let the model do the voice.**

An LLM asked to play chess plays bad chess. It also writes *worse prose* while
doing it, because attention spent tracking legality is attention not spent on
character. Give the board to a real engine and the model to the commentary, and
both halves get better at once — the moves become correct and the writing
becomes about the opponent's smugness rather than about the rules.

This is `update: "engine-computed"` from [03 §4](03-modes-and-turn-pipeline.md),
and it is Marinara's own observation about combat generalised: round maths is
calculated by the engine, not the model, "so results stay fair and consistent."

The corollary is what makes these extensions interesting rather than mechanical.
Once the engine owns correctness, **character expresses itself in the space the
rules leave open** — which move a reckless character picks from the legal set,
whether they gloat, whether they let you win. That is far better
characterisation than an LLM impersonating a chess engine, and it is only
available once you stop asking the model to do arithmetic.

### 3.3 The list

**Table games** — chess, poker, and the rest. *Poker is first-party, see §3.4.*
*Seam:* an engine-computed channel holding board state, a step validating and
applying moves, a declared widget for the board.
*The trap:* letting the model adjudicate anything. It proposes a move; the
engine rules on legality and outcome; the model narrates what the engine
decided. Never the reverse.
*Why it is worth doing:* this is the purest available demonstration of §3.2, and
Messages mode is a natural home — playing cards with a character you talk to
daily is a genuinely good feature that no amount of prompt engineering
approximates.
*Proves:* engine-computed channels, the widget vocabulary, per-mode gating.

**Music** — ambience driven by scene state.
*Seam:* a step reading channels (location, mood, tension, time), mapping to a
track, plus a provider shim for local folders or a streaming service.
*The trap:* asking a model "what music suits this scene?" every turn. That is
expensive, slow, inconsistent, and worse than a lookup table an author wrote
once. Map from declared channel state deterministically; involve a model only
when the mapping comes up empty, and cache what it decides.
*Proves:* steps reading channels, external services through the capability API,
and the discipline of not calling a model where a lookup will do.

**Dice and skill resolution.** — *first-party, see §3.4.*
*Seam:* an engine-computed channel plus a pre-narration evaluation step
([09 §4.3](09-infinite-worlds.md)).
*The trap:* the model rolling. It cannot, will not produce a defensible
distribution, and players can feel it. The engine rolls before narration and
hands the outcome down; the model writes the consequence it was given.
*Proves:* evaluate-before-narrate, and that mechanics can have teeth without
being baked into core.

**Tactical combat** — grid battles, initiative, line of sight.
*Seam:* mostly engine-computed channels and a large widget; possibly its own
mode.
*The trap:* scope. This is the largest thing on the list and the one most likely
to want an escape hatch from the declarative widget vocabulary
([05 §7](05-ui-surfaces.md)). A good first attempt at it would tell us whether
that escape hatch needs to exist sooner than planned.

**Voice — calls, speech in and out.**
*Seam:* an I/O surface rather than a game system; heavier on surface
contribution than anything else here.
*Why it is interesting:* it stresses a completely different part of the
contract, which makes it valuable feedback even if few people use it.

**Alternative memory strategies.**
*Seam:* retrieval and summarisation steps, replacing the defaults.
*Why:* memory is the least settled area of this design ([06 §E](06-open-questions.md)),
and the honest position is that someone will have a better idea than ours.
Retrieval being a set of steps behind a common interface
([02 §3](02-data-model.md)) exists precisely so that person does not have to
fork the project.

**Per-actor knowledge scope — anti-omniscience.**
*Seam:* a channel recording who knows what, updated when information is
exchanged in scene, gating lore retrieval per speaking actor.
*Why it is on this list rather than the roadmap:* it is [09 §5](09-infinite-worlds.md)'s
acceptance test. NPCs acting on things the player never told them is one of the
most-complained-about failures in this genre and none of the four references
solves it structurally. If it is buildable as an extension, the channel model
has earned its keep. If it is not, we need to know early.

**Haptics.**
*Seam:* device access through the capability API.
*Why it is listed:* not because it is a priority, but because it is the sharpest
test of the capability API being *narrow*. Device access must be something an
extension has to be granted, never something it inherits by being installed. An
attempt at this would find out.

### 3.4 What we owe extension authors

If this section is to be more than a wishlist:

- The contract has to be published and versioned, with the built-in modes
  visibly consuming it ([07 §10](07-tech-stack.md)).
- The declarative widget vocabulary has to be documented with worked examples,
  since it is the part most likely to block someone.
- Rules need reference documentation at least as good as the code SDK's, because
  §3.1 pushes most people there first and a badly documented tier is one nobody
  uses.

---

### 3.4 First-party reference extensions: dice and poker

**Two, with different jobs.** An earlier draft proposed one, and picked dice.
That was wrong, and the reason is worth keeping.

**Dice ships because Adventure needs it, which is exactly why it cannot be the
proof.** A reference extension is supposed to demonstrate that an outsider can
build something real against the published contract. Dice will not demonstrate
that, because we will be building a thing core modes depend on: if the contract
turns out to be inadequate we will widen it, quietly, and never notice we did.
It will read — correctly — as a core feature that happens to use the extension
hooks.

So dice is a **dependency**, not a demonstration. That still makes it useful:
Adventure declaring `requires: [dice]` exercises the mode-to-extension
dependency path in [02 §7](02-data-model.md), and uninstalling dice should
degrade Adventure legibly rather than break it.

**Poker is the proof, precisely because nothing needs it.** Nobody can mistake
it for core. If it works, the contract works. Beyond that it stresses seams dice
never touches:

- **Per-actor hidden state.** Hole cards are visible to one actor and not the
  others — and critically, the model call generating a character's action must
  see *that character's* cards and not anyone else's. Channels currently have
  hidden-versus-visible ([03 §7.3](03-modes-and-turn-pipeline.md)); this needs
  per-actor visibility, and per-actor filtering of assembled context.

  **This is the same machinery as anti-omniscience** ([09 §5](09-infinite-worlds.md)),
  in a bounded and testable form. Poker is a hand of cards; anti-omniscience is
  everything an NPC has ever learned. Build the first and the second becomes a
  question of scope rather than of mechanism. That connection is the strongest
  single argument for poker over any other game on the list.

- **Bluffing makes the §3.2 split vivid in a way nothing else does.** The engine
  knows the cards. The character's job is to *misrepresent* them — credibly, in
  voice, consistently with a hand it can see and its opponents cannot. Here the
  model is not narrating the truth the engine computed; it is lying about it on
  purpose, while the engine keeps score. No other example separates correctness
  from voice so cleanly, and it is a genuinely good demonstration of what the
  architecture is *for*.

- **Personality inside the legal move set.** A tight character folds, a loose one
  chases. The extension derives a play-style knob from actor traits and the
  engine enforces legality around it — §3.2's corollary, concretely.

- **Multi-participant action between player turns.** A hand runs several betting
  rounds with characters acting in sequence and the player acting in the middle
  of them. This exercises step iteration and the suspend-for-input mechanism
  ([06 C5](06-open-questions.md)) harder than anything else on the list.

*Scope control:* hand evaluation is a solved problem with libraries, and side
pots and multi-way all-ins are where the complexity actually lives. Heads-up
first, or fixed-limit, is a reasonable first cut — the point is the seams, not
completeness.

### 3.5 One constraint this puts on core: seeded randomness

Both extensions roll dice, in the general sense, and that has a core
implication worth recording now.

Randomness must come from a **core-provided, seeded source, and every draw must
be recorded in the turn's effects** ([02 §8](02-data-model.md)). Replay works
because it replays *effects* rather than re-running generation
([10 §2](10-branching.md)), so a roll recorded as an effect reconstructs
correctly on any branch. A step that calls `Math.random()` directly and does not
record the result breaks that quietly — state at turn N stops being a function
of the log, which is the one invariant branching depends on.

So the capability API should expose randomness and *not* leave extensions to
find their own, and the effect record needs somewhere to put the draw. Small,
and much cheaper to establish before two first-party extensions and an
authored-rules vocabulary (`<<1d20>>`, [09 §3](09-infinite-worlds.md)) all grow
their own habits.
