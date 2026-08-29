# 14 — Post-1.0 roadmap, and desired extensions

**Status: proposal.** Two distinct lists that are easy to confuse:

- **§1–3, the roadmap** — things *we* intend to build after 1.0. **§2b and §2e
  are committed with a release attached; the rest is intent.** An item earns
  a place by being *additive*: if deferring it would force a data-model change
  later, it belongs in 1.0 instead, and the test for each entry is "what does
  this oblige 1.0 to do?"
- **§4, desired extensions** — things we hope *someone else* builds, and in
  several cases should never be in core at all. Hints for expansion authors,
  and the standing acceptance test for the extension contract.

§4 is likely to graduate into user-facing documentation once the SDK exists.

---

## 1. Branch tree visualiser

The turn tree ([09 §3](09-branching.md)) makes every swipe and branch a node in
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
reconstructible ([09 §4](09-branching.md)), so the visualiser can answer *how
these two lines differ in substance*:

> On this line you have 40 gold and Vera trusts you. On that one you are broke
> and she is hostile. They split 12 turns ago, when you took the bribe.

Concretely: colour or badge edges where a watched channel diverges; select two
nodes for a channel-state diff; select a channel and see where in the tree it
changed. "Where did this go wrong" becomes a question with an answer.

**R4 — Curate.** Rename, promote a swipe to a named ref, prune a subtree,
bookmark. Pruning must surface the escaped-effects warning from
[09 §7](09-branching.md): deleting a subtree cannot un-write library entries or
generated images that line produced, and the UI should say so with a count
rather than let it be discovered later.

**R5 — Cost.** Tokens and spend attributed across the tree; abandoned lines
made visible as what they cost. Cheap once R1 exists, since the data is already
on every node.

### 1.5 A nice extra: summary sharing

Content-addressed summaries ([09 §5](09-branching.md)) mean the tree knows which
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

## 2. Character Studio

The actor card carries embedded media with typed roles and structured visual
descriptors from 1.0 ([02 §5.2.2](02-data-model.md)). The Studio is the surface
that makes that capability worth having.

### 2.1 The problem it addresses

A Tavern-style card describes a character in prose and carries one picture. That
is enough for text roleplay and nowhere near enough to hand a character to an
image or video pipeline and get *the same person* back twice. Visual consistency
is the unsolved problem in this space, and everything the field has converged on
— reference images, multi-view sheets, structured descriptor tags, style
anchors, seed pinning, per-character adapters — needs somewhere to live.

The Studio's premise: **extend the card from a description of a character into a
usable visual identity**, so a card can drive a generation pipeline and produce a
stable likeness. That is a meaningful extension of what a character card *is*,
and it is the reason the format work is 1.0 while the tooling is not.

### 2.2 What it is

An editing surface for an actor's visual identity, sitting beside the text
editor rather than inside it:

- **Reference set curation.** Choose, generate, crop and label the canonical
  likeness images. Multi-angle where the pipeline can use it.
- **Descriptor authoring**, structured (`VisualDescriptors`) with the prose
  appearance derivable from it or maintained alongside — the two must not drift
  silently, which is a real design question, not a detail.
- **Expression and pose sets**, generated from the references and kept
  consistent with them, feeding sprite display in Scene mode as a side effect.
- **Style anchoring.** Style is a property of the *production*, not the person —
  the same character rendered in ink wash and in photoreal is still that
  character. So style exemplars are a separate media role and separately
  selectable, and Marinara's `image-style-profile` is the nearest prior art.
- **A test bench.** Generate a few images against the current identity and see
  whether it holds. Without this the Studio is a form; with it, it is a tool.

### 2.3 Why post-1.0

The format lands at 1.0 and the tooling does not, for two reasons. It is
genuinely large — a curation UI, a generation pipeline, and a consistency
evaluation loop are three features. And it is the area where the underlying
technology moves fastest, so specifying the tooling now against 2026 techniques
would be designing for the wrong thing.

The format is different: typed media roles and structured descriptors are cheap,
stable, and unpleasant to retrofit. Hence the split.

### 2.4 What it obliges 1.0 to do

- **Typed media roles**, not a flat image list ([02 §5.2.2](02-data-model.md)).
  The single most important one, because guessing which image is the canonical
  likeness is not recoverable later.
- **Structured `VisualDescriptors`** on the profile ([02 §2.1](02-data-model.md)).
  Fields now, or prose parsing later.
- **Per-media generation provenance**, reusing `GeneratedFieldProvenance`
  ([05 §11.2](05-ui-surfaces.md)) — which model, which prompt, which seed. A
  reference image whose seed was not recorded cannot be regenerated
  consistently, which defeats the purpose.
- **Crop as a stored rectangle** rather than a destructive edit
  ([02 §5.2.1](02-data-model.md)).

All four are small. None is a feature at 1.0; all four are preconditions.

### 2.5 Non-goals

- **Not a model training surface.** If per-character adapters become the
  standard answer, the Studio should *reference* one, not train it.
- **Not an image editor.** Crop and label, not paint.
- **Not required.** A text-only actor with no media stays completely valid, and
  nothing in the Studio may become a precondition for using a card.

---

## 2b. The 2.0 modes — committed, not deferred

**Adventure–Campaign** and **Messages** are scheduled for a 2.0 series
([work plan §0](workplan/01-work-plan.md)), which puts them in a different category from
most of this document. §1–2 are things we intend to build and might
not; §4 is things we hope someone else builds. These two are **committed work
with a release attached** — as is §2e, which was written later and takes the
same category rather than a new one.

Their designs are already written — Messages in
[03 §7.1](03-modes-and-turn-pipeline.md), Campaign in
[03 §7.3](03-modes-and-turn-pipeline.md) — so there is nothing to add here
beyond the scheduling. What travels with them: presence, schedules, autonomous
messaging and the Web Push / webhook delivery channels for Messages; the RPG
channel library and incremental world generation for Campaign
([work plan §0.1](workplan/01-work-plan.md)).

---

## 2c. Continuity checking, and the story bible

Two roadmap features that belong together: one derives what a session has
established, the other checks the story against it. Both are direct applications
of [00 §3.6](00-stance.md) — *the engine's understanding is visible, and
correctable* — and both are readers over data 1.0 already records, which is what
keeps them additive.

### 2c.1 The story bible

**A derived view of what a session has established**, separate from its prose.
Who exists and what is known about them, what state the channels hold, which lore
entries have fired and when, which goals were completed and where.

Nothing here is new data. Actors and their presence come from
[03 §8.1](03-modes-and-turn-pipeline.md); established facts come from extraction
steps whose output already lands as channel effects; lore activation history is
in every turn record ([02 §8](02-data-model.md)); the goal chain is in its own
channel ([03 §7.3.4](03-modes-and-turn-pipeline.md)). **The bible is a reader**,
in the same sense that the workbench is a reader — which is why it is cheap and
why it was worth designing the record to be complete.

Two reasons it earns a place rather than being a nicety:

- **People already do this by hand.** The spreadsheet-beside-the-session is a
  well-known habit in long-form RP, and it exists because the information is
  genuinely scattered and genuinely needed. Software that has all of it and shows
  none of it is leaving the obvious on the table.
- **It is the appendix to the reading view** ([05 §12](05-ui-surfaces.md)). One
  answers *what happened*, the other *what is true*, and a long story wants both.

**Where it must not go:** the bible is derived, never authoritative. Editing it
means editing the thing underneath — a channel, an actor, a lore entry — not
writing to a parallel store. A bible that could drift from the session it
describes would be [00 §2.8](00-stance.md)'s derived-data-persisted-as-truth
failure in a new costume.

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
  ([07 §5.1](07-tech-stack.md)) applies squarely: this runs often and judges
  rather than writes.
- **Reads recent turns plus channel state plus activated lore** — precisely what
  `StepDefinition.reads` already declares
  ([03 §6](03-modes-and-turn-pipeline.md)).
- **Emits notices, never effects.** It does not correct anything. It cannot
  correct anything; a checker confident enough to rewrite the story would be
  worse than the problem.
- **Surfaced where the subject lives** — a character contradiction on the cast
  panel ([05 §13.2](05-ui-surfaces.md)), a world contradiction as a notice. And
  dismissible, permanently, per notice: **the author is allowed to contradict
  themselves on purpose**, and a checker that cannot be told *"yes, deliberately"*
  becomes noise within an hour.

**Why roadmap rather than 1.0.** It wants long real sessions to tune against —
the false-positive rate is the entire question, and there is no way to know it
without a corpus. Shipping a noisy version early would teach people to ignore it,
which is the one outcome that cannot be undone. **It obliges 1.0 to** record
extraction output as channel effects rather than as prose, which is already the
rule, so the debt is nil.

**The pairing is the point.** The bible is what continuity is checked *against*;
continuity checking is what makes the bible more than a curiosity. Neither is
worth much alone, and together they are the strongest available answer to the
genre's most common complaint.

### 2c.3 Lorebook extraction: closing the play-to-authoring loop

Two thirds of this loop already exist. A running session can emit a **Setup**
([10 §7](10-schemas.md)), and a session-local actor can be promoted to the
library ([02 §2.3](02-data-model.md)). The missing third is **extracting a
lorebook from what a session established** — the places visited, the people met,
the things decided.

It is the natural output of §2c.1: once the bible exists, "make this a lorebook"
is a selection and a write rather than a new mechanism.

Both existing halves set the pattern this must follow: **offered, never
automatic, and reviewed before it lands.** Marinara's own conclusion about
auto-promotion applies unchanged — a session tried once and abandoned must leave
nothing behind ([02 §2.3](02-data-model.md)) — and an extractor that silently
wrote lore entries would be the mention-resolution failure
([05 §13.1](05-ui-surfaces.md)) at a larger scale.

*Play a session, keep the world* is the whole pitch, and it is the answer to
something the sources handle badly: worlds currently have to be authored before
they can be played in, when in practice they are discovered while playing.

---

## 2d. World — the continuity container

**The word is reserved now and spent later.** A World is a grouping of sessions
that share a continuity: history available as context across them, a shared
starting set of lorebooks and a shared treatment baseline, with the stylistic
particulars still varying per session. *"The Rain City campaign"*, holding six
sessions that know about each other.

It belongs here rather than in [02](02-data-model.md) because it is post-1.0, and
it is written down now rather than later because the *word* is a 1.0 decision:
[05 §2.1](05-ui-surfaces.md) declines to spend "World" on a library label
precisely so this can have it.

**Two existing open questions are what this answers**, which is the argument for
it being real rather than invented:

- [11 §8](11-cross-session-memory.md) carries *"cross-session memory for the
  narrator rather than a character — 'the GM remembers your last campaign'.
  Coherent, and **a different scope key**."* Memory today is keyed
  `(user, actor, persona)` — character-centric. A World is the world-centric key
  that question noticed was missing and did not name.
- §2c.1's story bible is defined as *"what a **session** has established."* A
  World is that widened across sessions, and §2c.1's discipline carries over
  unchanged: **derived, never authoritative.** A World that accumulated its own
  parallel truth would be [00 §2.8](00-stance.md)'s
  derived-data-persisted-as-truth failure at a larger scale.

**What separates it from Setup**, since they will otherwise be confused:

> **A Setup is a starting configuration; a World is an accumulating history.**

A Setup looks forward at one game and is complete the moment play begins. A World
looks backward across many and is worth nothing until the third session. That is
also why it cannot be modelled as "a Setup with several sessions" — its whole
value is in what accrues.

**It is a play-side object.** Per [05 §2.1](05-ui-surfaces.md), the library
represents the objects as they are and Play carries the conveniences; grouping
your own sessions is a convenience over sessions, not a seventh portable kind.
That also keeps it out of the export surface, which is right — a continuity is
about *your* play, and the material underneath it already travels as a Package
([10 §9.1](10-schemas.md)).

### What this obliges 1.0 to do

The test this document sets itself. Three of the four elements cost nothing:

| Element | Obligation |
|---|---|
| Sessions belong to a World | **None.** Sessions are the *free to move* tier ([10 §1](10-schemas.md)) — internal, migrate at will. |
| Shared lorebooks, shared treatment baseline | **None, by construction.** Prefill-not-binding ([00 §3.1](00-stance.md)) means session creation *copies*; a World is one more prefill source. Per-session divergence is already the default rather than a feature to add. |
| World-scoped memory | **Small.** Do not hard-code the three-tuple into how memory books are keyed and named on disk. [11 §8](11-cross-session-memory.md)'s open question about book granularity should be decided knowing a fourth key is coming. |
| Continuity across sessions | **One real obligation** — below. |

**Hook identity must survive the copy.** [02 §4.1](02-data-model.md) has session
creation *copy* hooks from all sources, with the session tracking which have
fired. Within a World, a hook fired in session one must not fire again in session
two — the same *"firing a hook about someone who died four sessions ago"* failure
that document calls severe, reached by a different route. Cross-session
de-duplication is only possible if a session's copied hook keeps the **source
hook's `id`** rather than getting a fresh one. `PlotHook.id` exists and
`blockedBy` / `notBefore.afterHook` already reference ids, so the field is there;
what needs pinning at 1.0 is that copying preserves it. One line now,
unrecoverable later.

*(The clause about the session tracking firings is superseded — that state is a
channel as of [02 §4.1](02-data-model.md). Nothing here changes: the obligation
was always about the **id** surviving the copy, and where the firing record lives
is orthogonal to it.)*

**An introduction hook needs a second de-duplication key, and id is not it.**
[10 §6.1a](10-schemas.md)'s `introduces` fires on a character rather than an
event, so the failure it must avoid is *this person arriving for the first time,
twice*. Id-matching catches only the case where the **same hook** fired before;
it misses the commoner one, where a different hook — or the narrator, unprompted
— introduced them in session one. So within a World the suppression key is the
**subject**, not the hook: a character already introduced in this continuity has
no first arrival left to stage. Cheap to note now, and it costs 1.0 nothing,
because the *introduced* predicate it needs already exists per-session
([03 §8.1](03-modes-and-turn-pipeline.md)) and only its scope widens.

**A known collision, recorded rather than rediscovered.** Two *stable-tier*
schemas already spend the word: `PlotHook.magnitude` no longer does, but
`Lorebook.category: "world" | …` still carries it, and `hook.magnitude` was
renamed away from `scope: "world"` for exactly this reason
([10 §5](10-schemas.md), [10 §6.1](10-schemas.md)). `category` is gone as of that
same pass, so what remains is ordinary lowercase prose — "world facts", "the
world as a whole" — which coexists with a capital-W kind without real ambiguity.
Worth knowing that portable schemas cannot be cleaned up later without a version
bump ([10 §2](10-schemas.md)), so any *new* use of the word in a portable
structure between now and then should be refused.

---

## 2e. Write — the 3.0 mode

**Write is scheduled for a 3.0 series**, which puts it in §2b's category rather
than §1–2's: committed work with a release attached, not intent. **There is no
3.0 anywhere else in these documents.** The term starts here and in
[17](17-write-mode.md), and the release line it extends is in
[work plan §0](workplan/01-work-plan.md).

Its design is [17](17-write-mode.md), so as with §2b there is nothing to add
here beyond the scheduling. What travels with it: the **Manuscript** kind
([17 §5](17-write-mode.md)) and the seventh library panel it costs, the Write
surface and the `top-level` arm on the mode contract's surface declarations
([17 §6](17-write-mode.md)), beats ([17 §§7–8](17-write-mode.md)), the three
outline views ([17 §10](17-write-mode.md)), the codex read as a query over the
existing library rather than a new kind ([17 §9](17-write-mode.md)), and this
repository's first structured editor ([17 §12](17-write-mode.md)).

**Why a release of its own, rather than a fifth mode inside 2.0.** Not because it
is unopinionated — it is the most opinionated thing in this document, and
[17 §1](17-write-mode.md) states the position it takes about what LLM prose
writing is actually for. It is deferred because it is **downstream**: it consumes
lorebook activation, mention resolution, the mode contract as a real interface
rather than a shape one built-in mode happens to fit, and the summary chain. That
is the same argument [work plan §0](workplan/01-work-plan.md) makes for building
Campaign against a proven substrate, and it holds harder here, because Write is
the first mode that needs the contract to *grow* rather than to be configured.

**It meets this document's bar, and the check is worth naming rather than
assuming.** §1's test is *what does this oblige 1.0 to do* — and the answer is a
table in [17 §13](17-write-mode.md) rather than a section here, because two of
its rows land at **1.0**, not at 2.0, and belong beside the argument that
produces them. The two that matter: the mention-span overlay has to carry a
tagged entity reference from the first span ever written, and session export
([06 B12](06-open-questions.md)) must not freeze the turn record before
[17 §4](17-write-mode.md) is settled.

**Two entries above acquire a second consumer**, which is worth a line each
rather than a rewrite. §2c.1's story bible is *what a session established*;
Write's outline is what a manuscript *intends*, and the two want the same
derived-never-authoritative discipline. And §3's **manual chapterisation** row
stops being only a reading feature: a binder is chapterisation authored up front,
which is the same information arriving from the other end.

---

## 3. Other deferred items

Already deferred in their own documents; listed here so the roadmap has shape.
None is specified further than its original entry.

| Item | Deferred in | Note |
|---|---|---|
| Real multiplayer — turn arbitration, per-user hidden state, simultaneous input | [04 §8](04-server-multiuser-deployment.md) | Posture is "don't preclude, don't build"; three cheap 1.0 decisions keep the door open |
| Truly mobile-optimised layout | [05 §1](05-ui-surfaces.md) | A mode of the same web app, never a native shell |
| **In-UI file access, the whole feature** | [05 §4](05-ui-surfaces.md) | Deprioritised to experimental ([06 D3](06-open-questions.md)). Import/export UIs and in-app library management matter more; a file-management UI is disproportionate surface and risk for something most people never open. The capability field and the audited path helper still land at 1.0, and hand-editing on disk keeps working regardless |
| Custom extension rendering (sandboxed iframe) | [05 §8](05-ui-surfaces.md) | The declarative widget vocabulary covers 1.0; the escape hatch is real work |
| **Tailscale, all levels** | [04 §5.2](04-server-multiuser-deployment.md) | **Post-2.0** ([06 D1](06-open-questions.md)). Level 1 yes, Level 2 maybe, Level 3 not worth it. Keep the auth layer shaped so Level 2 is a provider rather than a special case |
| A native client | [05 §1](05-ui-surfaces.md) | Not ours to build and not a priority, but no longer ruled out — the bar is a feature-complete client with a real advantage over the web app ([06 D4](06-open-questions.md)) |
| Cross-branch merge | [06 C10](06-open-questions.md) | Nothing in the tree model precludes it |
| Per-actor knowledge scope (anti-omniscience) | [08 §5](08-infinite-worlds.md) | Held as an acceptance test for the channel model, not a feature commitment |
| A real user role system | [04 §4.2.1](04-server-multiuser-deployment.md) | **Post-2.0.** Named capabilities on the account cover the household case; roles, groups and per-object permissions are the wrong shape of effort for four users. Enumerating the capabilities now makes it a *move* rather than an invention. Signals it is needed: a capability that is not a boolean, wanting one set applied to several people, or permissions scoped to objects rather than accounts |
| Prompt-overrun recovery — detect a length-driven refusal and retry smaller, bounded by a regenerate-attempts setting |  [07 §5.4](07-tech-stack.md) | Deferred because providers signal length failures inconsistently, so detection is heuristic and wants real failures to tune against. **Obliges 1.0 to** declare prompt caps and assemble prompts from ranked fragments, which turns the retry into "drop the lowest fragment and resend" |
| **Manual chapterisation** | [06 E1](06-open-questions.md) | The rolling summary is the 1.0 answer. Chapters are **primarily a reading feature** ([05 §12](05-ui-surfaces.md)) — a human knows where a chapter ended better than a heuristic, so the interaction is manual with agentic advice ("this looks like a break"), never automatic. Chunking summaries along those boundaries falls out as a secondary benefit. **Obliges 1.0 to** keep full history on disk, which it does, so chapters can be applied retroactively to sessions that predate the feature |
| Embeddings and semantic retrieval | [06 E2](06-open-questions.md) | Aimed at cross-session memory ([11](11-cross-session-memory.md)) first, lorebooks a distant second — keyword activation plus the budgeter already covers most lorebook use, and "cosine 0.71" is not a reason a human can act on. Vectors live in the derived index, so re-embedding is a rebuild rather than data loss |
| Backup and restore command | [06 E6](06-open-questions.md) | Small: quiesce, archive the data directory excluding the index, restore and rebuild. Files on disk means `rsync` works today and should be documented. **The part that matters is a CI restore test** ([testing](workplan/10-testing.md)) — an untested restore is not a backup |
| **Lore-conditioned renditions** | [02 §3.6](02-data-model.md) | **Committed intent, not a maybe** — much of why lore images exist. A location's `reference` image is the same shape of input to *illustrate this scene* that an actor's already is ([03 §10.3](03-modes-and-turn-pipeline.md)). Deferred because the plumbing is not the hard part: **choosing which images** is, when six active entries and three present actors all carry references, and conditioning on all of them produces mud. Wants the location channel (P7) for an honest selector, a precedence rule against actor references, and real sessions to tune how many references help before they fight. Half-built — *attach every active entry's image* — gives worse illustrations than no feature, and gets switched off rather than reported. **Obliges 1.0 to** give `reference` the same meaning on lore as on actors, make media addressable per entry, and carry `tags` so a selector has something finer than a role to discriminate on ([10 §3](10-schemas.md)) |
| Aggregate cost and usage view | [05 §3](05-ui-surfaces.md) | Per-turn cost still shows at 1.0 — it is a field on the record. The dashboard is not core functionality: the audience at this stage are power users already monitoring provider usage. **Obliges 1.0 to record cost anyway**, including for library-time assist calls, since a spend view built later over uncaptured data shows nothing |

The peripheral feature surface discarded in [triage §6.3](workplan/02-triage.md) — table
games, music, calls, haptics — deliberately does **not** appear above. It is not
a roadmap; it is §3.

---

## 4. Desired extensions

Not a roadmap. Nothing here is planned, scheduled, or promised, and several
entries would be actively wrong to ship in core. This section exists as **a set
of large hints for anyone who wants to write an expansion** — what is worth
building, which seam it should use, and where the naive version goes wrong.

It doubles as the acceptance test for [03 §9](03-modes-and-turn-pipeline.md): if
a motivated person cannot build these against the published contract without
engine changes, the contract has failed and that is our problem, not theirs.

### 4.1 First question: rules or code?

Before anything else, work out which tier the idea belongs to
([08 §2](08-infinite-worlds.md)):

- **Authored rules** — declarative conditions and effects over channels, shipped
  as data inside a package. No installation, no code review, no AGPL obligation
  ([triage §1.2](workplan/02-triage.md)), works for anyone who imports the package.
  **Arrives at 2.0** ([work plan §0.4](workplan/01-work-plan.md)), so until then everything below
  that would have been rules is a code extension — which is worth knowing before
  starting, and is also the best available evidence for what the vocabulary
  should eventually contain.
- **Code extension** — a real module with steps, channels and widgets. More
  power, more responsibility, must be AGPL, must be installed deliberately.

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

This is `update: "engine-computed"` from [03 §4](03-modes-and-turn-pipeline.md),
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
([08 §4.3](08-infinite-worlds.md)).
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
([05 §8](05-ui-surfaces.md)). A good first attempt at it would tell us whether
that escape hatch needs to exist sooner than planned.

**Voice — calls, speech in and out.**
*Seam:* an I/O surface rather than a game system; heavier on surface
contribution than anything else here.
*Why it is interesting:* it stresses a completely different part of the
contract, which makes it valuable feedback even if few people use it.

**Alternative memory strategies.**
*Seam:* retrieval and summarisation steps, replacing the defaults.
*Why:* the rolling summary ([06 E1](06-open-questions.md)) is deliberately the
simple answer, and the honest position is that someone will have a better idea
than ours.
Retrieval being a set of steps behind a common interface
([02 §3](02-data-model.md)) exists precisely so that person does not have to
fork the project.

**Per-actor knowledge scope — anti-omniscience.**
*Seam:* a channel recording who knows what, updated when information is
exchanged in scene, gating lore retrieval per speaking actor.
*Why it is on this list rather than the roadmap:* it is [08 §5](08-infinite-worlds.md)'s
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

### 4.4 First-party reference extensions: dice and poker

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

  **This is the same machinery as anti-omniscience** ([08 §5](08-infinite-worlds.md)),
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

### 4.5 One constraint this puts on core: randomness

Both extensions roll dice, in the general sense, which forced a core decision —
now settled in [07 §14](07-tech-stack.md).

There is **one canonical RNG service**, server-local, with no network
dependency, and every draw is recorded in the turn's effects. Extensions receive
it through the capability API and must not find their own: replay works by
replaying *effects* rather than re-running generation
([09 §2](09-branching.md)), so an unrecorded draw quietly breaks the invariant
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
pair in cross-session memory ([11 §4](11-cross-session-memory.md)). Three
features, one pattern: **two opt-in toggles governing context flow between
separate activity streams.** A timeline is one skin on it. A character's
journal, in-world news, letters, or a group chat you are not in are others, and
all of them are cheaper than a social network.

#### What it would need that we do not currently offer

This is the useful part, and why it is a better stress test than poker.

- **Extension-owned durable storage that is not session state.** Noodle accounts,
  posts and interactions live across sessions and belong to no session. Channels
  ([03 §4](03-modes-and-turn-pipeline.md)) are session-scoped, and library access
  is read-plus-propose. There is currently **nowhere for an extension to keep its
  own persistent data**. Poker does not reveal this because a hand lives and dies
  inside one session.
- **The custom-rendering escape hatch.** The declarative widget vocabulary
  ([05 §8](05-ui-surfaces.md)) covers HUD widgets and panels; it cannot render a
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
([10 §6](10-schemas.md)), and any extension contributing generated content
should respect it rather than carry its own fixed policy.

The NoodleR economy — coins, subscriptions, locked posts — is where "gimmicky"
is most accurate and where the maintenance sits. Notable in passing: its type
definitions carefully distinguish platform separation from access control
("content separation between two fictional products, NOT a privacy or security
control"), which is exactly the comment someone writes after a near miss.

**Verdict: post-1.0, extension, and probably not by us.** The reusable idea —
ambient activity as a bidirectional context source — is worth generalising into
core; the timeline is worth leaving to whoever wants it.

### 4.7 What we owe extension authors

If this section is to be more than a wishlist:

- The contract has to be published and versioned, with the built-in modes
  visibly consuming it ([07 §10](07-tech-stack.md)).
- The declarative widget vocabulary has to be documented with worked examples,
  since it is the part most likely to block someone.
- Rules need reference documentation at least as good as the code SDK's, because
  §4.1 pushes most people there first and a badly documented tier is one nobody
  uses.
