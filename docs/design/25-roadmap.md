# 25 — The feature list, and desired extensions

**Status: proposal.** Two distinct lists that are easy to confuse:

- **§§1–3, the feature list** — things *we* intend to build, in three priority
  tiers, with **no release attached to any of them**. The committed versions live
  in [work plan §0](workplan/01-work-plan.md); this document is everything else.
- **§4, desired extensions** — things we hope *someone else* builds, and in
  several cases should never be in core at all. Hints for expansion authors, and
  the standing acceptance test for the extension contract.

**Unscheduled is not unwanted.** Nothing here is promised, and nothing here is
refused. An entry carries a priority rather than a release, and **any of it can
be pulled forward by whoever wants to build it** — out of order, mid-series, or
by someone who is not us. A tier says what we would reach for next; it is not a
queue anything has to wait in. Several entries below are frankly likely to be
grabbed early by whoever gets annoyed enough by their absence, and that is the
system working rather than the plan failing.

An item still earns its place by being *additive*: if deferring it would force a
data-model change later, it belongs in a committed version instead, and the test
for each entry is "what does this oblige 1.0 to do?"

| Tier | What it means |
|---|---|
| **High** | Wanted soon, and the first things to reach for once a committed release lands. Several would be picked up mid-series given the chance. |
| **Low** | Wanted, but held back by something — usually judgement, sometimes competence in an area this project has not earned yet, occasionally a dependency that does not exist. |
| **Eventually** | Real, and not soon. Nothing here is refused; nothing here is close. |

**§§1 and 2c.2 are High-tier entries that have their own designs**, because they
were written out before the tiers existed and the reasoning is worth keeping.
§3 is the tiered list of everything else, and §3.4 holds one cluster that is a
direction rather than a feature.

**§2, §2c.1 and §2c.3 are stubs pointing at committed releases.** Each was a
feature-list entry until it turned out to be constitutive of a release rather
than adjacent to one — the story bible to World ([15](15-world.md)), lorebook
extraction to the authoring tier ([17](17-authoring.md)), and the Character
Studio to a release of its own ([18](18-character-studio.md)). The stubs stay
because the section numbers are cited elsewhere and because *why something left
this list* is the most useful thing this document can record about it.

§4 is likely to graduate into user-facing documentation once the SDK exists.

---

## 1. Branch tree visualiser

**Tier: High.** The turn tree ([07 §3](07-branching.md)) makes every swipe and branch a node in
one structure. At 1.0 the reading surface shows the **selected path**, with
siblings as an inline affordance on each node ([26 C9](26-open-questions.md)).
That is the right default and it is deliberately not a tree browser.

The visualiser is the escalation: a view of the whole tree for when the default
stops being enough.

### 1.1 Why it is not a committed version

It is pure addition. Everything it displays — topology, cost, model, channel
effects, summary reuse — is already recorded by 1.0 for other reasons
([03 §8](03-data-model.md)). It derives, it does not require.

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
([10 §3](10-ui-surfaces.md)) already diffs turn records; this is a second
entry point into it.

**R3 — State divergence.** The genuinely novel tier, and the one no tool in the
survey can do. Because effects are per-node, channel state at any node is
reconstructible ([07 §4](07-branching.md)), so the visualiser can answer *how
these two lines differ in substance*:

> On this line you have 40 gold and Vera trusts you. On that one you are broke
> and she is hostile. They split 12 turns ago, when you took the bribe.

Concretely: colour or badge edges where a watched channel diverges; select two
nodes for a channel-state diff; select a channel and see where in the tree it
changed. "Where did this go wrong" becomes a question with an answer.

**R4 — Curate.** Rename, promote a swipe to a named ref, prune a subtree,
bookmark. Pruning must surface the escaped-effects warning from
[07 §7](07-branching.md): deleting a subtree cannot un-write library entries or
generated images that line produced, and the UI should say so with a count
rather than let it be discovered later.

**R5 — Cost.** Tokens and spend attributed across the tree; abandoned lines
made visible as what they cost. Cheap once R1 exists, since the data is already
on every node.

### 1.5 A nice extra: summary sharing

Content-addressed summaries ([07 §5](07-branching.md)) mean the tree knows which
parts of itself share memory. Showing the extent of a shared summary as a span
over the spine makes an abstract property concrete, and explains to a user why
branching was free here and expensive there. Small, and unusually explanatory.

### 1.6 What this obliges 1.0 to do

Almost nothing — which is the point of deferring it. Everything above derives
from data 1.0 already records.

**One exception, and it is worth acting on now.** R4's pruning implies deleting
turns, and [03 §5.5](03-data-model.md) proposes storing turns as append-only
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
- **Not a merge tool.** Cross-branch merge is [26 C10](26-open-questions.md) and
  stays out of scope. The visualiser is where a merge UI would eventually live,
  which is a reason to keep its layout honest, not a reason to build merging.
- **Not editable topology.** No dragging nodes to re-parent. The tree records
  what happened; rewriting history is not a story feature.

---

## 2. Character Studio — moved

**The Character Studio is a committed release of its own at 3.0
([18](18-character-studio.md)).**

It was a High-tier entry here until the authoring tier acquired a release, and it
went there on the shape it shares with lorebook extraction and authored rules:
each turns something you played into something you can author with, and the
Studio is that move for an actor's visual identity.

**It moved a second time when that shape turned out not to be a dependency.**
Nothing in the tier gated it and nothing it needs waits for the corpus that holds
the tier back, so it now carries a release number rather than a tier membership
([18 §1.2](18-character-studio.md)). Its four obligations on 1.0 — typed media
roles, structured descriptors, per-media generation provenance, and crop as a
stored rectangle — are unchanged through both moves and now live at
[18 §5](18-character-studio.md).

---

## 2c. Continuity checking, and the play-to-authoring loop

**Tier: High.** This section has been hollowed out by two promotions and is kept
for the one entry left in it: **§2c.2, continuity checking**. §2c.1's story bible
went to World and §2c.3's extraction went to the authoring tier — both because
they turned out to be constitutive of a release rather than adjacent to one.

**The two no longer land anywhere near each other, and that is the 2026-09-14
correction to this paragraph.** It read *"World at 4.0"* and *"the authoring tier
at 6.0"* — both at the far end of the line, which made the pair look like one
promotion into the same distant neighbourhood. World is now **1.0**
([15](15-world.md)), the line shortened by one behind it, and the tier is
therefore **5.0** ([17](17-authoring.md)). Neither entry moved on its own merits;
the line under them did. What it leaves is a section whose two departures sit at
opposite ends of the series — one inside the release being built, one four
releases out — and a third entry still here with no release at all.

What continuity checking retains from the original framing is the reason it is
additive: it reads data 1.0 already records, and it is a direct application of
[00 §3.6](00-stance.md) — *the engine's understanding is visible, and
correctable*.

### 2c.1 The story bible — moved

**The story bible is no longer here. It ships with World — ~~at 4.0~~ at 1.0
([15 §7](15-world.md)).**

It was defined as *what a session has established*, and [15 §1](15-world.md)
defines a World partly as that same view widened across a canon — which made it
World's definition rather than its neighbour. A canon with no way to see what is
in it is half a feature, so the two went together into a committed release.

**And then that release moved, 2026-09-14.** World left 4.0 for 1.0 because the
portable bundle [04 §9](04-schemas.md) had been calling a Package turned out to
be the object [15](15-world.md) was describing from the other end — so the kind
was **renamed rather than added**, the portable kinds are still six, and the
container the bible belongs to stopped being a fourth-release proposal and became
part of the release being built ([15 §0](15-world.md)). The bible came with it
for the same reason it went to World at all: it was never a separable thing to
schedule. **An entry three releases out is now inside the first one**, and
nothing about the bible caused that — it moved because the thing it belongs to
was found to be something else.

The citation moved with it: [15](15-world.md) was rewritten rather than revised,
so the bible is its §7, and the §4 this stub used to point at is now membership.

Continuity checking did **not** go with it, and §2c.2 says why: the bible is a
cheap reader and checking is an expensive advisory pass with a false-positive
problem the bible does not have. They were a pair in the sense that one enables
the other, not in the sense that they ship together.

### 2c.2 Continuity checking

**An advisory step that reads recent turns against established state and flags
contradictions.** *"Turn 12 says Vera's eyes are green."* *"Kell was marked dead
at turn 88."* *"The Foundry was described as abandoned."*

Contradiction is the most-complained-about failure in long-form play, and the
important thing about it is that **it is not preventable, but it is checkable.**
No amount of context management stops a model from changing an eye colour four
hundred turns later; what is available is noticing.

The shape, and every piece of it exists:

- **A `fast`-role step** at `post`. The cheap-model principle
  ([20 §5.1](20-tech-stack.md)) applies squarely: this runs often and judges
  rather than writes.
- **Reads recent turns plus channel state plus activated lore** — precisely what
  `StepDefinition.reads` already declares
  ([06 §6](06-modes-and-turn-pipeline.md)).
- **Emits notices, never effects.** It does not correct anything. It cannot
  correct anything; a checker confident enough to rewrite the story would be
  worse than the problem.
- **Surfaced where the subject lives** — a character contradiction on the cast
  panel ([10 §13.2](10-ui-surfaces.md)), a world contradiction as a notice. And
  dismissible, permanently, per notice: **the author is allowed to contradict
  themselves on purpose**, and a checker that cannot be told *"yes, deliberately"*
  becomes noise within an hour.

**Why not 1.0.** It wants long real sessions to tune against —
the false-positive rate is the entire question, and there is no way to know it
without a corpus. Shipping a noisy version early would teach people to ignore it,
which is the one outcome that cannot be undone. **It obliges 1.0 to** record
extraction output as channel effects rather than as prose, which is already the
rule, so the debt is nil.

**The pairing is the point.** The bible is what continuity is checked *against*;
continuity checking is what makes the bible more than a curiosity. Neither is
worth much alone, and together they are the strongest available answer to the
genre's most common complaint.

**Half of that pair now lands at 1.0** (§2c.1), which changes nothing about why
this half is deferred and a good deal about when it could stop being. What holds
checking back is the corpus rather than the reader, and from the first release
there is something to read — so the earliest honest condition for pulling it
forward is *1.0 has been played in long enough to measure a false-positive rate*,
where it used to be *World exists*. [15 §7](15-world.md) refuses the
down-payment reading of that and is right to: a shipped bible does not make a
noisy checker acceptable. It only means the expensive half is the half left.

### 2c.3 Lorebook extraction — moved

**Extraction ships with the authoring tier at ~~6.0~~ 5.0
([17 §3](17-authoring.md)).** *Play a session, keep the world* turned out to be
the clearest single statement of what that release is for, which made it the
wrong thing to leave on a list with no release attached.

**The number changed on 2026-09-14 and the position did not.** The tier still
sits one release behind Campaign, because Campaign is what produces the corpus
it is designed against ([17](17-authoring.md)); Campaign came forward to 4.0
when World took 1.0, and the tier came with it. Worth recording for the entry's
own sake: extraction was gated twice, on the story bible and on the corpus, and
**the first gate is gone** — the bible it reads now ships at 1.0, so what is
left holding this is the softer of the two reasons ([17 §3](17-authoring.md)).

---

## 3. The tiered list

Everything not given a section of its own above. Each entry was deferred in its
own document and none is specified further than its original entry; what the
note adds is *why it sits in this tier*, which is the only thing this document
knows that the original does not.

**A struck row is one that left**, and it stays for the reason the stubs above
stay: an entry answered somewhere else is more use on the page than deleted from
it, because the next person to have the idea will look here first and deserves
to find where it went rather than nothing.

### 3.1 High

| Item | Deferred in | Note |
|---|---|---|
| **Tailscale, all levels** | [09 §5.2](09-server-multiuser-deployment.md) | Level 1 yes, Level 2 maybe, Level 3 not worth it ([26 D1](26-open-questions.md)). Keep the auth layer shaped so Level 2 is a provider rather than a special case. High because reaching your own server from outside the house is the most-asked-for thing this project does not do |
| **A real user role system** | [09 §4.2.1](09-server-multiuser-deployment.md) | Named capabilities on the account cover the household case; roles, groups and per-object permissions are the wrong shape of effort for four users. Enumerating the capabilities now makes it a *move* rather than an invention. Signals it is needed: a capability that is not a boolean, wanting one set applied to several people, or permissions scoped to objects rather than accounts |
| **Prompt-overrun recovery** | [20 §5.4](20-tech-stack.md) | Detect a length-driven refusal and retry smaller, bounded by a regenerate-attempts setting. Deferred because providers signal length failures inconsistently, so detection is heuristic and wants real failures to tune against. **Obliges 1.0 to** declare prompt caps and assemble prompts from ranked fragments, which turns the retry into "drop the lowest fragment and resend" |
| **Manual chapterisation** | [26 E1](26-open-questions.md) | The rolling summary is the 1.0 answer. Chapters are **primarily a reading feature** ([10 §12](10-ui-surfaces.md)) — a human knows where a chapter ended better than a heuristic, so the interaction is manual with agentic advice ("this looks like a break"), never automatic. Chunking summaries along those boundaries falls out as a secondary benefit. **Obliges 1.0 to** keep full history on disk, which it does, so chapters apply retroactively to sessions that predate the feature. Named as a likely out-of-sequence pickup somewhere in the 1.0–2.0 range |
| **Lore-conditioned renditions** | [03 §3.6](03-data-model.md) | **Committed intent, not a maybe** — much of why lore images exist. A location's `reference` image is the same shape of input to *illustrate this scene* that an actor's already is ([06 §10.3](06-modes-and-turn-pipeline.md)). Deferred because the plumbing is not the hard part: **choosing which images** is, when six active entries and three present actors all carry references, and conditioning on all of them produces mud. Wants the location channel (P7) for an honest selector, a precedence rule against actor references, and real sessions to tune how many references help before they fight. Half-built — *attach every active entry's image* — gives worse illustrations than no feature, and gets switched off rather than reported. **Obliges 1.0 to** give `reference` the same meaning on lore as on actors, make media addressable per entry, and carry `tags` so a selector has something finer than a role to discriminate on ([04 §3](04-schemas.md)). **The backdrop does not open this** ([06 §10.1a](06-modes-and-turn-pipeline.md)): it conditions on channel state as *text* and ships at 1.0 on that basis, while feeding a location's `reference` image to the model stays here. Recorded because a picture of a place is the most plausible-looking reason anyone will have to move the line, and the selector problem is absent rather than solved |

### 3.2 Low

| Item | Deferred in | Note |
|---|---|---|
| **Auto-provisioning accounts** | [26 D2](26-open-questions.md) | Self-registration, invites, an identity provider. Low rather than eventual because the shape is known and the demand is not — a household install does not need it, and everything larger wants the role system above first |
| Truly mobile-optimised layout | [10 §1](10-ui-surfaces.md) | A mode of the same web app, never a native shell. Low because the responsive floor already works and the ceiling is a real design project |
| Custom extension rendering (sandboxed iframe) | [10 §8](10-ui-surfaces.md) | The declarative widget vocabulary covers 1.0; the escape hatch is real work. Tactical combat or anything map-shaped are the likely triggers (§4.3) |
| **Per-actor knowledge scope** (anti-omniscience) | [02 §5](02-infinite-worlds.md) | Held as an acceptance test for the channel model rather than a feature commitment. Low on competence rather than importance: this project has not yet earned an opinion about memory scoping, and guessing at one produces a feature that is wrong in a way nobody can debug |
| Embeddings and semantic retrieval | [26 E2](26-open-questions.md) | Aimed at cross-session memory ([08](08-cross-session-memory.md)) first, lorebooks a distant second — keyword activation plus the budgeter already covers most lorebook use, and "cosine 0.71" is not a reason a human can act on. Vectors live in the derived index, so re-embedding is a rebuild rather than data loss. Same competence caveat as the row above |
| Cross-actor memory | [08 §8](08-cross-session-memory.md) | *"Vera recalling that she and Tomas both know you."* Explicitly not 1.0, and in the same memory-scoping area held back for the same reason |
| Rendition asset eviction policy | [26 E3](26-open-questions.md) | The hook ships at P9; the policy does not. Operational rather than absent — it bites once renditions are used heavily, and not before. Backdrops are what make *heavily* arrive sooner: one image per place, kept for the life of the session ([06 §10.1a](06-modes-and-turn-pipeline.md)) |
| Mention resolution beyond actors | [10 §13.1](10-ui-surfaces.md) | Locations, items, factions. Not in scope at 1.0. The span overlay carries a tagged reference from the first span written ([13 §13](13-write-mode.md)), so widening the target set is addition rather than migration |
| The `proposed` mention tier | [10 §13.1](10-ui-surfaces.md) | `explicit` and `matched` ship at 1.0; the fuzzy model-proposed tier may follow. Wants real transcripts to judge the false-positive rate against |
| Hook packs as a shareable kind | [03 §4.1](03-data-model.md) | Lean was "not at 1.0", and it still is. Hooks travel inside a **World** already — ~~a Package~~, the same kind under the name it carried until 2026-09-14 ([15 §0](15-world.md)) — so nothing about the rename makes this easier. It sharpens the cost instead: a pack of their own would be **a seventh portable kind**, which is the thing the release check made World prove it was not ([15 §3](15-world.md)), and a new format commitment is a higher bar than a convenience clears for a sharing pattern nobody has yet |
| ~~Prologue packages~~ | [26 B10](26-open-questions.md) | **Left this list, 2026-09-14 — answered by a mechanism rather than scheduled as a feature.** A prologue is *a session ticked in a World's publish review* ([15 §4](15-world.md), [16 §5](16-publish.md)): the container that can carry a partly-played session and the review that decides whether sessions travel both ship at 1.0 for reasons that have nothing to do with prologues, so there is no feature here left to rank. The row is struck rather than deleted because what it said was wrong twice over — it cited B12, the session-export question it was *blocked on* rather than B10, the question it *is*; and "low only because nobody has asked for it" read the wait as demand when what it was actually waiting for was a shape. Nothing gets built for it and it arrives anyway, which is the best end an entry on this list can come to |

### 3.3 Eventually

| Item | Deferred in | Note |
|---|---|---|
| Real multiplayer — turn arbitration, per-user hidden state, simultaneous input | [09 §8](09-server-multiuser-deployment.md) | Posture is "don't preclude, don't build"; three cheap 1.0 decisions keep the door open |
| **In-UI file access, the whole feature** | [10 §4](10-ui-surfaces.md) | Deprioritised to experimental ([26 D3](26-open-questions.md)). Import/export UIs and in-app library management matter more; a file-management UI is disproportionate surface and risk for something most people never open. The capability field and the audited path helper still land at 1.0, and hand-editing on disk keeps working regardless |
| Aggregate cost and usage view | [10 §3](10-ui-surfaces.md) | Per-turn cost still shows at 1.0 — it is a field on the record. The dashboard is not core functionality: the audience at this stage are power users already monitoring provider usage. **Obliges 1.0 to record cost anyway**, including for library-time assist calls, since a spend view built later over uncaptured data shows nothing |
| Sharing content between users on one install | ~~[26 A3](26-open-questions.md)~~ [03 §5](03-data-model.md) | The path is the owner and there is no sharing primitive. Open when it arrives, and not before someone has two users who both want it. **The citation was stale and is corrected here, 2026-09-14**: A3 is *server-scoped connections* — resolved account-scoped, with a system scope — and has nothing to say about library content. It was a wrong pointer that then survived a renumber, which is how these last: renumbering rewrites a citation faithfully without ever asking what it meant. The deferral lives in [03 §5](03-data-model.md), which also records the shape it will most likely take — a third library location read the same way — and the question that holds it open is [26 A2e](26-open-questions.md). Its near neighbour is deliberately not its answer: [16 §7](16-publish.md) has two accounts on one server exchanging a file like anybody else, which is unglamorous and is not sharing |
| Video renditions | [06 §10](06-modes-and-turn-pipeline.md) | The `kind` union and `scope.messageId` ship at P9; the implementation does not. An animated backdrop is `{ kind: "video", purpose: "background" }` — expressible from P9 and unbuilt, which is the whole reason `purpose` is not a fourth `kind` ([06 §10.1a](06-modes-and-turn-pipeline.md)) |
| Speech and TTS renditions | [06 §10](06-modes-and-turn-pipeline.md) | As above — the shape ships, the feature does not. Voice as an *I/O surface* is a desired extension rather than this (§4.3) |
| Rendition series and storyboarding | [06 §10.4](06-modes-and-turn-pipeline.md) | **The surface, not the mechanism.** The count judgement beneath it — which moments of a turn deserve a picture, and how many — is now specified and lands in a phase after P9. What stays here is presenting the result *as* a storyboard, with its own surface and pacing, which is also the line that keeps [triage §6.3](workplan/02-triage.md)'s discard verdict intact |
| A native client | [10 §1](10-ui-surfaces.md) | Not ours to build and not a priority, but no longer ruled out — the bar is a feature-complete client with a real advantage over the web app ([26 D4](26-open-questions.md)) |
| Cross-branch merge | [26 C10](26-open-questions.md) | Nothing in the tree model precludes it, and nothing in use has asked for it |
| A simple/advanced split, or a rearrangeable layout | [26 D7](26-open-questions.md) | Explicitly not blocking. Density and disclosure carry 1.0; a second layout system is a large commitment to make on a guess |

The peripheral feature surface discarded in [triage §6.3](workplan/02-triage.md) —
table games, music, calls, haptics — deliberately does **not** appear above. It
is not a tier; it is §4.

### 3.4 Social — a cluster, not a tier

**Messages, an in-app feed, and a bulletin board**, held together by one
proposition: that **Social is a fourth top-level surface with its own modes**,
rather than messaging being one more mode of Play.

Messages was scheduled for 2.0 until this pass
([work plan §0](workplan/01-work-plan.md)). What moved it was not doubt about
the feature but a better reading of its shape: a messenger, a Marinara-style
activity feed (§4.6) and something board-shaped — threaded, persistent,
many-to-many, closer to a forum than to a chat — are three answers to the same
question, and that question is *what does asynchronous social contact with
characters look like*. Building one of them as a Play mode would foreclose the
other two.

**It is deliberately untiered.** The idea is not defined well enough to rank,
and ranking it would imply more settledness than there is. What exists is a
direction and three candidate modes; what does not exist is a design.

What travels with Messages whenever this is built: presence
(Active/Idle/DND/Invisible), per-actor schedules, autonomous first-contact
messaging, Discord-style profiles, reactions, the command-family gating model,
**background scheduling** — the server-side timer that starts a turn with no
client attached — and the Web Push, ntfy and webhook delivery channels
([09 §3](09-server-multiuser-deployment.md)).

**One cost is already being paid for this**, and
[work plan §0.3](workplan/01-work-plan.md) records it rather than hiding it:
background scheduling and presence were Messages' to prove, they are specified,
and with Messages off the release schedule there is now no date at which that
seam gets exercised. That is an argument for defining this cluster sooner rather
than later.

---

## 4. Desired extensions

Not a roadmap. Nothing here is planned, scheduled, or promised, and several
entries would be actively wrong to ship in core. This section exists as **a set
of large hints for anyone who wants to write an expansion** — what is worth
building, which seam it should use, and where the naive version goes wrong.

It doubles as the acceptance test for [06 §9](06-modes-and-turn-pipeline.md): if
a motivated person cannot build these against the published contract without
engine changes, the contract has failed and that is our problem, not theirs.

### 4.1 First question: rules or code?

Before anything else, work out which tier the idea belongs to
([02 §2](02-infinite-worlds.md)):

- **Authored rules** — declarative conditions and effects over channels, shipped
  as data inside a World. No installation, no code review, no AGPL obligation
  ([triage §1.2](workplan/02-triage.md)), works for anyone who imports the World.
  **Arrives at ~~6.0~~ 5.0, the authoring tier**
  ([work plan §0.6](workplan/01-work-plan.md)). That is a considerably longer
  wait than the 2.0 this once promised, and the reason is the one that defers the
  tier at all: the vocabulary is to be designed against a corpus of real authored
  worlds, and Campaign at ~~5.0~~ 4.0 is what produces one. Until then everything
  below that would have been rules is a code extension — which is worth knowing
  before starting, and is also the best available evidence for what the vocabulary
  should eventually contain. **If you are reading this because you want to write
  rules, that evidence is the most useful thing you can give us.**
- **Code extension** — a real module with steps, channels and widgets. More
  power, more responsibility, must be AGPL, must be installed deliberately.

**The bundle in that first bullet used to be called a Package**, and the rename
belongs here rather than only in the note that made it, because this section is
where an extension author meets the word first. `storyengine.package/1` became
`storyengine.world/1` in the 2026-09-14 pass, when [15](15-world.md) found that
the portable bundle and the continuity container were one object approached from
opposite ends — **a rename, not a seventh kind** ([15 §0](15-world.md)). **What
did not change is the other sense of the word.** The first-party namespaces that
own channels and steps — `storyengine.lore`, `storyengine.cast`,
`storyengine.goals`, `storyengine.suggest` — are a code namespace rather than a
bundle, and they keep the old word ([06 §4.1](06-modes-and-turn-pipeline.md)).
An extension author is the one reader who meets both senses in the same
afternoon, which is why saying it twice is cheaper than letting it be guessed.

The test: **does it need to compute something, or only to decide something?**

A weather system that shifts conditions with season and location is *deciding* —
rules. A weather system that runs a wind model is *computing* — code. Rules
handle far more than people expect, and Infinite Worlds' community built class
trees, loot tables, encounter generators and quest state machines without ever
touching code. Reach for code second.

### 4.2 The principle behind the best ones

The strongest extension ideas share a shape, and it is worth naming because it
is the opposite of the instinct most people arrive with.

> **Let a deterministic system do the hard work. Let the model do the voice.**

An LLM asked to play chess plays bad chess. It also writes *worse prose* while
doing it, because attention spent tracking legality is attention not spent on
character. Give the board to a real engine and the model to the commentary, and
both halves get better at once — the moves become correct and the writing
becomes about the opponent's smugness rather than about the rules.

This is `update: "engine-computed"` from [06 §4](06-modes-and-turn-pipeline.md),
and it is Marinara's own observation about combat generalised: round maths is
calculated by the engine, not the model, "so results stay fair and consistent."

The corollary is what makes these extensions interesting rather than mechanical.
Once the engine owns correctness, **character expresses itself in the space the
rules leave open** — which move a reckless character picks from the legal set,
whether they gloat, whether they let you win. That is far better
characterisation than an LLM impersonating a chess engine, and it is only
available once you stop asking the model to do arithmetic.

### 4.3 The list

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
([02 §4.3](02-infinite-worlds.md)).
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
([10 §8](10-ui-surfaces.md)). A good first attempt at it would tell us whether
that escape hatch needs to exist sooner than planned.

**Voice — calls, speech in and out.**
*Seam:* an I/O surface rather than a game system; heavier on surface
contribution than anything else here.
*Why it is interesting:* it stresses a completely different part of the
contract, which makes it valuable feedback even if few people use it.

**Alternative memory strategies.**
*Seam:* retrieval and summarisation steps, replacing the defaults.
*Why:* the rolling summary ([26 E1](26-open-questions.md)) is deliberately the
simple answer, and the honest position is that someone will have a better idea
than ours.
Retrieval being a set of steps behind a common interface
([03 §3](03-data-model.md)) exists precisely so that person does not have to
fork the project.

**Per-actor knowledge scope — anti-omniscience.**
*Seam:* a channel recording who knows what, updated when information is
exchanged in scene, gating lore retrieval per speaking actor.
*Why it is here as well as in §3.2:* the feature-list entry is what *we* might
build; this one is [02 §5](02-infinite-worlds.md)'s acceptance test, and the two
are not the same claim. If a motivated author can build it against the published
contract, the channel model has earned its keep and our own entry matters less. NPCs acting on things the player never told them is one of the
most-complained-about failures in this genre and none of the four references
solves it structurally. If it is not buildable as an extension, we need to know
early.

**Haptics.**
*Seam:* device access through the capability API.
*Why it is listed:* not because it is a priority, but because it is the sharpest
test of the capability API being *narrow*. Device access must be something an
extension has to be granted, never something it inherits by being installed. An
attempt at this would find out.

**Randomizers — outcomes and appearances.** *Outlined in [24](24-randomizers.md);
wanted early, and first-party.*
*Seam:* for plot, a `generate`-stage step that asks the cheap model for a few
outcomes by kind, draws one with the RNG service under difficulty-derived
weights, and hands the narrator a verdict; for appearance, a field assist that
draws `VisualDescriptors` from an authored palette and has the model write the
prose around them.
*The trap:* the model weighting its own candidates. That is where the
sycophancy went, and asking it *how likely is this* re-imports the failure the
draw exists to remove. The model proposes and labels; the engine weighs and
draws; the model writes to what was drawn — §4.2's principle, one sentence
sharper.
*Proves:* evaluate-before-narrate with a real consumer, a step that draws
inside the boundary, structured output through `StepCallRequest.schema`, and
whether rewrite and reroll keep their meanings when a draw is made over a
model-written list ([24 §3.5](24-randomizers.md)).

### 4.4 First-party reference extensions: dice and poker

**Two, with different jobs.** An earlier draft proposed one, and picked dice.
That was wrong, and the reason is worth keeping.

**Dice ships because Freeform and Campaign need it, which is exactly why it cannot be the
proof.** A reference extension is supposed to demonstrate that an outsider can
build something real against the published contract. Dice will not demonstrate
that, because we will be building a thing core modes depend on: if the contract
turns out to be inadequate we will widen it, quietly, and never notice we did.
It will read — correctly — as a core feature that happens to use the extension
hooks.

So dice is a **dependency**, not a demonstration. That still makes it useful:
A mode declaring `requires: [dice]` exercises the mode-to-extension
dependency path in [03 §7](03-data-model.md), and uninstalling dice should
degrade the mode legibly rather than break it.

**Poker is the proof, precisely because nothing needs it.** Nobody can mistake
it for core. If it works, the contract works. Beyond that it stresses seams dice
never touches:

- **Per-actor hidden state.** Hole cards are visible to one actor and not the
  others — and critically, the model call generating a character's action must
  see *that character's* cards and not anyone else's. Channels currently have
  hidden-versus-visible ([06 §7.3](06-modes-and-turn-pipeline.md)); this needs
  per-actor visibility, and per-actor filtering of assembled context.

  **This is the same machinery as anti-omniscience** ([02 §5](02-infinite-worlds.md)),
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
  ([26 C5](26-open-questions.md)) harder than anything else on the list.

*Scope control:* hand evaluation is a solved problem with libraries, and side
pots and multi-way all-ins are where the complexity actually lives. Heads-up
first, or fixed-limit, is a reasonable first cut — the point is the seams, not
completeness.

### 4.5 One constraint this puts on core: randomness

Both extensions roll dice, in the general sense, which forced a core decision —
now settled in [20 §14](20-tech-stack.md).

There is **one canonical RNG service**, server-local, with no network
dependency, and every draw is recorded in the turn's effects. Extensions receive
it through the capability API and must not find their own: replay works by
replaying *effects* rather than re-running generation
([07 §2](07-branching.md)), so an unrecorded draw quietly breaks the invariant
branching depends on.

For extension authors specifically, the useful part is that this is
**self-policing under test**: an extension using its own randomness will fail a
replay-determinism check, because replaying its recorded effects will not
reproduce its behaviour. Use the provided source and that check passes for free.

### 4.6 Noodle — notes on Marinara's in-app social feed

Flagged as unexamined in the first triage pass ([triage §9](workplan/02-triage.md)); examined
now, because it turns out to be the most informative thing on this list even
though it is unlikely we build it.

**What it is.** A fake social timeline inside the app, served at a cosmetic
`noodle.local` address. Accounts are your persona, characters you invite from
the library, the assistant, and optional generated "random users". You post by
hand; a **Refresh timeline** action runs a generation that produces posts,
replies, likes, follows and polls across the invited accounts. There is an
automatic schedule, image generation, and a second simulated platform —
"NoodleR" — with subscriptions, locked posts, a coin wallet and staged identity
disclosure.

**It is not small.** Roughly 6,400 lines in server services alone, ~70 files
across the workspace, with its own scheduler, operation locks, generation log,
image and vision services, and prompt builders. Gimmicky in *concept*; the
implementation is a full parallel content system on the scale of a mode.

#### The idea worth keeping is not the feed

The first instinct — that it relates to Messages mode — is right, and the
connection is **carryover**. Noodle pushes a "Recent Social Media Activity"
block into chat prompts, per-mode toggles, with its own hard token budget; a
separate per-chat toggle sends activity the other way, into the next Noodle
refresh.

Strip the social-media skin and what remains is:

> **Ambient off-screen activity, generated on a schedule, feeding chat context
> in both directions.**

That is the same shape as Messages mode's autonomous messages — characters doing
things while you are not looking — and structurally the same as the share/intake
pair in cross-session memory ([08 §4](08-cross-session-memory.md)). Three
features, one pattern: **two opt-in toggles governing context flow between
separate activity streams.** A timeline is one skin on it. A character's
journal, in-world news, letters, or a group chat you are not in are others, and
all of them are cheaper than a social network.

#### What it would need that we do not currently offer

This is the useful part, and why it is a better stress test than poker.

- **Extension-owned durable storage that is not session state.** Noodle accounts,
  posts and interactions live across sessions and belong to no session. Channels
  ([06 §4](06-modes-and-turn-pipeline.md)) are session-scoped, and library access
  is read-plus-propose. There is currently **nowhere for an extension to keep its
  own persistent data**. Poker does not reveal this because a hand lives and dies
  inside one session.
- **The custom-rendering escape hatch.** The declarative widget vocabulary
  ([10 §8](10-ui-surfaces.md)) covers HUD widgets and panels; it cannot render a
  social feed with composer, polls, threads and profile pages. Noodle needs the
  sandboxed-iframe route that is deferred there.
- **Scheduler access**, to generate on a timer without a client connected.

Two of those three are gaps rather than answers. Worth knowing before someone
attempts an ambitious extension and discovers them.

#### What not to copy

Marinara's own documentation states that Noodle's built-in instructions treat
every account as adult and permit explicit content, and that **this is not a
setting that can be turned off**. Whatever one thinks of the default, a
non-optional content posture baked into a subsystem is the wrong shape — content
rating is a `Treatment` field with `null` meaning *ask*
([04 §6](04-schemas.md)), and any extension contributing generated content
should respect it rather than carry its own fixed policy.

The NoodleR economy — coins, subscriptions, locked posts — is where "gimmicky"
is most accurate and where the maintenance sits. Notable in passing: its type
definitions carefully distinguish platform separation from access control
("content separation between two fictional products, NOT a privacy or security
control"), which is exactly the comment someone writes after a near miss.

**Verdict: one candidate shape for the Social cluster (§3.4), not a core
feature on its own.** This section was written when the answer was "extension,
and probably not by us"; what changed is that Messages left the release schedule
and the question widened from *should we build a feed* to *what is the surface
that a messenger, a feed and a board are all modes of*. The analysis above is
unchanged and is the reason §3.4 exists — in particular the three things a feed
would need that do not exist, which are still the honest blockers.

The reusable idea — ambient activity as a bidirectional context source — remains
worth generalising into core whether or not any feed is ever built.

### 4.7 What we owe extension authors

If this section is to be more than a wishlist:

- The contract has to be published and versioned, with the built-in modes
  visibly consuming it ([20 §10](20-tech-stack.md)).
- The declarative widget vocabulary has to be documented with worked examples,
  since it is the part most likely to block someone.
- Rules need reference documentation at least as good as the code SDK's, because
  §4.1 pushes most people there first and a badly documented tier is one nobody
  uses.
