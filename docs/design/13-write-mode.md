# 13 — Write: the long-form prose surface

**Status: proposal, with a release attached.** This is the design for the **2.0**
series; [work plan §0](workplan/01-work-plan.md) is where it is scheduled. It
sits in its own file rather than as a fifth entry in
[06 §7](06-modes-and-turn-pipeline.md) because it is not one more configuration
of the pipeline over the same artefact. Play's modes differ in what they
assemble; this differs in **what the result lands in**, which means it touches
the object set
([03 §1](03-data-model.md)), the mode contract
([06 §2](06-modes-and-turn-pipeline.md)), the surface count
([10 §2](10-ui-surfaces.md)) and the stability tiers ([04 §1](04-schemas.md)) at
once — the same reason [08](08-cross-session-memory.md) and
[11](11-lorebooks-as-a-format.md) are their own documents. It is also the first
note here that asks to *change* an internal shape rather than consume one, and
that argument (§4) wants room. It changes no portable schema. It asks for three
optional fields on one ([04 §5](04-schemas.md)), and §13 says when they have to
land — which is now 1.0, not with Write.

**Write is a surface holding two modes, Outline and Prose** (§6.4). An earlier
draft called it a fifth *mode*, which was the right instinct expressed with the
wrong noun: what it actually needed was a place in the navigation, and a place
in the navigation is what a surface is. Nothing in the design below changes
because of the renaming — §6 already argued for the nav entry, and §§7–12 were
already two clusters of work that this makes explicit rather than invents.

**It is nearer than it was.** This document described a far release when it was
written and now describes the next one, and §4.8's window has shut rather than
narrowed: session export ships at 1.0 ([work plan §0.5](workplan/01-work-plan.md)),
so §4 must be settled *before* export rather than protected by export's absence.

---

## 1. Roleplay machinery pointed at a document, not an authoring tool that grew an assistant

The stance decides most of the arguments below, so it goes first rather than in
a closing paragraph nobody reaches.

> **This is not a serious authorial tool that grew an assistant. It is the
> roleplay machinery pointed at a document instead of a chat log.**

The honest version of the claim underneath it: **serious prose fiction is not
being written this way and is not about to be.** A tool built on the opposite
assumption acquires a submission format, a style checker and a compile dialogue,
and it acquires them instead of the thing people actually want, which is to use
the techniques that already work in guided roleplay over something longer than a
scene and less gamey than an adventure. Saying so plainly is not modesty; it is
what keeps the feature small enough to be good.

Three consequences, and each settles a later section:

- **Light beats complete.** The audience is someone who already plays in Scene
  and wants the same handles over a longer form — not someone who would
  otherwise be using Scrivener. §14 refuses, by name, everything that follows
  from getting this wrong.
- **Every existing convenience must reach it unchanged.** The guidance box, the
  workbench, rewrite and reroll, the reading view, per-turn cost, mentions, the
  cast panel, version history and the hand-edit watcher are all wanted here and
  **none of them may be reimplemented.** [00 §2.7](00-stance.md) is the standing
  rule against per-mode duplication and this mode is its largest test.
- **The prose is the product, so the prose is a file.** Not a field in a record
  and not rows in a table. §5 turns that into a storage decision, and
  [00 §3.4](00-stance.md) is what makes it non-negotiable.

**"Collaborative" means human and model, one human.** Real-time co-editing
between two people is [09 §8](09-server-multiuser-deployment.md)'s deferred
question, unchanged and not reopened by this — a manuscript is a library object
under one user, exactly as everything else in the library is.

---

## 2. NovelCrafter supplies the interaction, Scrivener supplies the structure

Not a survey — a list of what is taken, in the register of
[01](01-source-survey.md).

**From NovelCrafter, taken essentially whole:**

- **Beats.** A short instruction typed inline, yielding roughly five hundred
  words; a scene holds six or more; *continue writing* is the same mechanism
  with a preset instruction and no author text. The post-generation four-way —
  **Apply / Retry / Discard / Section** — is the interaction, and §8 maps all
  four onto machinery that already exists.
- **The codex**, and specifically its tracking controls: track by name and
  alias, case sensitivity, automatic plurals, an exclusion list for false
  positives, and a four-valued setting for when an entry reaches the model. §9
  argues the codex is not a thing to build and that four of those controls are.
- **Plan** — acts, chapters and scenes in three views, and *create from outline*
  against a plotting method.
- **Mentions and the heatmap** — matched names marked in the prose and counted
  across it.

**From Scrivener, taken as structure:**

- **The binder** — one tree in which a folder may itself hold text. It is the
  thirty-year-old answer and it should be adopted rather than redesigned.
- **Synopsis and notes per document**, which is what makes a corkboard and an
  outliner two layouts over one field set rather than two features.
- **Label and status** as free-text axes.
- **Snapshots**, which land directly on [03 §11](03-data-model.md)'s version
  history (§5).
- **Compile as a separate pass**, taken *as a concept only*: the manuscript is
  not the output. The output is the reading view ([10 §12](10-ui-surfaces.md)),
  and §14 refuses the typesetting half by name.

**Not taken:** NovelCrafter's prompt-function language, refused in this
project's own terms in §11; and Scrivener's compile format engine.

---

## 3. The pipeline is the same; the artefact is not

> **In Play, the turn record is the story with its workings attached. In Write,
> the manuscript is the story and the turn record is only the workings.**

The tempting formulation is *a beat is the turn's input and the manuscript is
the transcript*. The first half is exactly right and §7 builds on it. The second
half is wrong in three ways, and each wrong turn has a consequence:

| Where the transcript analogy breaks | Consequence |
|---|---|
| **Ordering.** A transcript's order is a `parentTurnId` walk ([03 §5.5](03-data-model.md)). A manuscript's order is a binder the author drags around, and a chapter that moves has not branched. | Reading order leaves the turn log entirely. §4. |
| **Mutability.** A message is written once. A paragraph is edited fifty times, and the fiftieth edit is not a swipe. | Edits are versions, not turns. §4, §5. |
| **Cardinality.** A turn produces the message. A beat produces a *candidate* that may be applied, retried three times, discarded or shelved — so calls outnumber accepted prose and most leave no trace in the artefact. | Apply is not a turn; Discard destroys nothing. §8. |

What that leaves untouched is the reassuring part, and it is most of the system:
**collect, budget, render, the tape, the cost record and the workbench do not
change.** What changes is which producers fill which slots (§11) and where the
output goes (§4).

---

## 4. A call is a turn; an edit is a version; Apply is an edit

The hard question, and the one the rest of the note depends on. The constraint
is that a beat call is **not** an inline sequential turn with branches — the
manuscript is edited in place and its order is the author's, not the log's.

> **A call is a turn. An edit is a version. Apply is an edit.**

### 4.1 `Turn` survives, and that is the argument against inventing anything

A beat generation records `input` (the instruction and its kind), `request.calls`
(what was assembled and sent, blocks and verdict per call), `output` (the
candidate prose), `steps`, `cost`, `tape` and `effects` — every field meaning
precisely what it means today. **The workbench reads a Write turn with no
changes**, which is the strongest available argument against a parallel
generation record: a second record type for the same job is
[00 §2.7](00-stance.md)'s per-mode reimplementation arriving dressed as
architecture.

**The objection to meet first, because it is a good one.**
[10 §11.4](10-ui-surfaces.md) already establishes a second call path — field
assists and library image generation — which runs outside any session and
deliberately **produces no turn record**, using generated-field provenance
instead. A beat looks like that. It is not, and the difference is what a beat
call *needs*:

- An assist fills one field of an object that has version history. Its record
  *is* the version, and there is nothing to arbitrate.
- A beat call assembles a dozen budgeted blocks from history, lore, outline and
  cast, and the author's question when the prose is wrong is *why did it send
  that* — which is the workbench's question, and the workbench reads turn
  records.
- A beat is retried against alternatives that have to be comparable. That needs
  siblings, and siblings are turns.

So the line is not *calls outside Play are not turns*; it is **a call whose
inclusion decisions are worth explaining is a turn.** Field assists stay outside
it, unchanged.

### 4.2 A Write session has a turn *log*, not a turn *tree*

`parentTurnId` does two jobs in Play because in a transcript they coincide: it is
the **causal parent** and the **reading predecessor**. In Write they come apart,
and the field keeps the first job only.

- **Retry is a sibling**, which is [07 §6](07-branching.md) doing exactly what it
  was built for. *"A swipe is a sibling node nobody named"*, and siblings carry
  their full record — blocks, verdict, cost. NovelCrafter's Retry **deletes the
  previous response**; ours cannot, and comparing two attempts can therefore
  compare *why they differed* rather than only their text. **This is the clearest
  thing this project adds to the tool it is copying, and it costs nothing** — it
  is a consequence of a decision already made for other reasons.
- **The tree is local to a beat, never global to the manuscript.** Worth saying
  plainly, so nobody later points the branch visualiser
  ([24 §1](24-roadmap.md)) at a Write session and finds a field of small bushes
  with no spine to hang them on. Its collapse-linear-runs trick has nothing to
  collapse here.
- **[07](07-branching.md)'s reconstruction guarantees are not claimed here, and
  must not be.** Channel state rebuilt at a node is meaningful when the artefact
  is rebuilt from effects. The manuscript is not: the file on disk *is* the
  state. Write's answer to the fear branch-anywhere addresses is version history
  (§5.4), which is a different mechanism for the same reassurance.

### 4.3 One new field on the turn, and it is optional

```ts
/** Write only. Which part of which document this call was aimed at. */
anchor?: {
  manuscriptId: string
  nodeId: string
  beatId: string | null
  /** Where in the node's text. Null for a whole-node call. */
  at: { start: number; end: number } | null
}
```

**The anchor lives on the turn, not on the node.** Two reasons, both existing
rules rather than new preferences. A node carrying turn ids would put engine
bookkeeping into the file [00 §3.4](00-stance.md) promises you can drag out and
read. And it would be [00 §2.8](00-stance.md)'s derived-data-persisted-as-truth
the moment the turn already knows — *which calls produced this scene* is an index
query over `anchor.nodeId`, which is what a derived, rebuildable index is for
([03 §5.1](03-data-model.md)).

Note the asymmetry, because it is what keeps two similar-looking facts honest.
**The anchor records where a call was aimed**, is written before the provider is
asked, and stays true when nothing was applied. **Provenance on the prose records
which bytes came from which turn**, and is written only on Apply. Neither is
derivable from the other, and a system with only one of them cannot answer both
*what did this cost me* and *who wrote this paragraph*.

### 4.4 What each of the four choices writes

| Action | Writes | Does not write |
|---|---|---|
| **Beat call** | A turn | Nothing in the manuscript |
| **Retry** | A sibling turn | Nothing in the manuscript. The previous candidate is *replaced on screen*, never deleted — a deliberate divergence from the source, named as one |
| **Discard** | Nothing | The turn stays. `Turn.removed` is a tombstone for pruning ([03 §5.5](03-data-model.md)); a rejected candidate is not pruned, because it happened and it cost money |
| **Apply** | A text edit, provenance, a beat state change, and a version under the snapshot policy | **No turn.** [03 §8](03-data-model.md) is explicit that an absent `request` and an empty one are different claims, and a turn carrying nothing but a pointer would be a record asserting a prompt was built |

The objection someone will raise, answered here so it is not rediscovered later:
[03 §8.1](03-data-model.md) *does* mint a call-less turn when a hand edit to
`session.json` diverges from replayed channel state. That is a turn because
channel state is reconstructed from the effect log, so an edit outside the log is
a genuine divergence with nowhere else to be recorded. **The manuscript has no
such reconstruction.** The mechanism that already answers *how did this file come
to be this way* is version history ([03 §11](03-data-model.md)). Different
invariant, different home.

### 4.5 Where Write turns live

- **A Write session is an ordinary Session**, under `sessions/<id>/`, with
  `turns/*.jsonl` and the whole existing store. The assembly gather keeps its
  key, the path walk keeps working, the dry-run preview keeps working.
- **The manuscript is a library object the session names in its mode config**,
  which the host stores verbatim and never interprets
  ([06 §2](06-modes-and-turn-pipeline.md)) — so this costs no schema change.
- The manuscript folder therefore stays clean: binder, prose, assets, history.
  No turn ids in it.

**One session per manuscript, created lazily on the first call, and never shown
to the user.** In Write you open a manuscript, not a session. **[OPEN]** whether
several should be allowed; it would matter mainly for two humans, which is a
non-goal (§14), so the lean is one.

### 4.6 The exception this creates, named rather than discovered

[00 §3.1](00-stance.md) — prefill, not binding — has session creation *copy* what
it needs. **A Write session must not copy the manuscript**, because editing the
artefact is the whole point.

State it as a reconciliation rather than an exception: prefill-not-binding
protects a story in progress from later edits to a *reusable template*. A
manuscript is not a template; it is the subject. The session is the tool, and the
tool holds a live reference to the work.

The consequence is already handled. Turn records will reference prose that has
since changed — and a block source already carries a content hash precisely so it
addresses *the bytes that were used* rather than the object with that id today
([21 §1.1](21-internal-contracts.md)). An existing decision collecting, not a new
problem.

### 4.7 Rewrite and reroll collapse, and the reason is already written down

[19 §14.5](19-tech-stack.md) makes rewrite the default because *"I didn't like
how that was written"* is the common intent over a narration of a resolved
outcome. A beat resolves nothing, so that argument does not transfer — and the
same section supplies the answer: in a mode that consumed no draws, rewrite and
reroll are the same operation and **the second affordance should not appear.**

So **Retry is one button**, and becomes two on the day someone switches on a
stochastic lore entry, with no code change and no design revisit.

### 4.8 The window this depends on, and when it shuts

The turn record is internal tier and free to move, and **session export is the
event that ends that freedom** — [04 §1](04-schemas.md),
[25 B12](25-open-questions.md), and the record's own definition all say so.

This section was written while that freedom still existed, and it no longer does.
The original disjunction was *either export is scheduled after 3.0, or its format
is designed knowing Write is coming*; **export now ships at 1.0**
([work plan §0.5](workplan/01-work-plan.md)), which takes the first branch off
the table and forces the second.

So the practical rule is: **§4 is settled before export's format is frozen, not
after.** Everything here is still free *today* — nothing has shipped — but the
window closes at P11 rather than at some point beyond three releases, and
§15's second reopening condition has fired rather than being a hypothetical.
§13 carries this as the sharpest row in the table.

---

## 5. A library kind, internal tier, and the prose is what travels

### 5.1 What it holds

A binder in Scrivener's sense — uniform, and a folder may carry text of its own:

```ts
interface ManuscriptNode {
  id: string
  parentId: string | null
  order: number
  kind: 'folder' | 'document' | 'scratch'
  title: string
  /** Authored. What this scene is *meant* to be. The card's face. */
  synopsis: string
  /** Authored, private. Never injected unless a slot asks for it. */
  notes: string
  /** Free text, both. Scrivener's two axes, taken as they are. */
  label: string | null
  status: string | null
  pov: { actorId: string; person: 'first' | 'third' } | null
  /** Which threads this node advances. Declared, not derived — §10. */
  threads: Ref[]
  /** Scrivener's "include in compile", read here as "include in context". */
  include: boolean
  wordTarget: number | null
}
```

And on the manuscript itself: the node list, `beats` (§7), `localActors` (§9),
provenance spans, `tags`, `media`, `provenance`, `metadata`.

**Synopsis and summary are two fields and must stay two.** The synopsis is
authored intent; the summary is derived from what the scene became. NovelCrafter
carries both columns, which is independent evidence the split is real, and §10
turns it into the asymmetry that decides two slots.

### 5.2 On disk

```
library/manuscripts/<slug>/
  manuscript.json      # binder, beats, local cast, spans
  text/
    <nodeId>.md        # one file per node with prose. Clean Markdown.
    INDEX.md           # derived, disposable, never read back
  assets/
  history/             # [03 §11] machinery, unchanged
```

**Prose bodies are Markdown files, one per node**, on four legs:

1. **[00 §3.4](00-stance.md).** Drag the folder out and you have the novel, in
   the format everyone already reads. A single JSON object with prose inside
   string fields fails that test exactly as a proprietary project file does.
2. **The precedent exists.** [03 §5.4](03-data-model.md)'s *everything else is
   JSON* is a rule about **objects**; a scene body is a **document** — the same
   distinction that made the card PNG canonical for an actor rather than a mirror
   of a JSON file ([03 §5.2](03-data-model.md)).
3. **The watcher gets granular for free.** Editing chapter three in an external
   editor produces one `external` version against one node rather than a
   whole-manuscript version. This is the leg that actually decides it.
4. **It round-trips into the reading view**, which already emits Markdown
   ([10 §12.2](10-ui-surfaces.md)).

**Filenames are ids, not `NN-title.md`.** Order encoded in a path is a second
source of truth for the binder ([00 §2.8](00-stance.md)), and reordering must not
rewrite the filesystem. The cost is real — the folder is drag-portable but not
*browsable* — and it is paid by `text/INDEX.md`: a generated, ordered, titled
index the engine rewrites on binder change and never reads back. That is the move
[03 §8.1](03-data-model.md) already makes for the head channel snapshot, a
derived legibility affordance explicitly not authoritative. **[OPEN]** whether it
is enough in practice; §15 carries the test.

### 5.3 Tier: internal, with a portability path rather than a portability promise

The cost of portable is not small ([04 §1–2](04-schemas.md)): define it now,
change only additively, version on breakage, emit a JSON Schema, register it,
preserve unknown fields — and pay all of that from 1.0, for a shape nobody has
yet written a novel in, against a feature landing at 2.0.

**The case for portable** is [04 §1](04-schemas.md)'s own asymmetry — *breaking a
container costs a re-export; breaking an Actor costs somebody's character* — and
this is somebody's novel. It is a real argument, which is why the answer is not
simply *internal, done*.

**The case for internal wins on three counts:**

- **There is no ecosystem to be compatible with.** [11 §1](11-lorebooks-as-a-format.md)
  keeps the lorebook format because everyone else uses it. Nobody else uses this.
  Committing a manuscript-with-beats-and-links structure is an interchange claim
  no second implementation would honour.
- **The prose is already portable in the sense that matters.** `text/` is
  Markdown on disk, so [00 §3.4](00-stance.md) is satisfied by the directory
  whatever tier the JSON sits in. Portability would buy *structure* interchange,
  which has no consumer.
- **The right analogy is Session, not Actor.** A manuscript is one person's
  accumulating work, not a reusable authored artefact — which is
  [04 §1](04-schemas.md)'s *free to move* tier, where Session and the turn record
  already live. [15 §3](15-world.md) declines to make World a portable kind on
  a related instinct.

**So, concretely:** it lives in the library and uses the object-folder machinery
— history, watcher, index, backlinks, the detail route. It carries a
`storyengine.manuscript/0` schema string from its first write, so a later
promotion is a version bump rather than an invention. It is **not** in the
portable registry, **not** validated on import, and **not** package-exportable at
2.0. Getting a manuscript out is three things that already exist: the reading
view, the `text/` folder, and a zip that is transport rather than a format
promise.

**And it is a seventh library panel, which is a cost this project has already
priced.** [10 §5.1](10-ui-surfaces.md) settles on six panels named for the kinds
and marks that *for now*, sending any reduction to the simple/advanced question
rather than deciding it there. A seventh is therefore allowed and not free, and
the honest defence is the one that section already makes for six: density is the
position, and a shelf showing every kind legibly beats one that hides a kind
behind a mode. The one-line answer to *why is a manuscript in the library when a
session is not* — **the library is where editing, browsing, searching and
hand-editing live** ([10 §2.1](10-ui-surfaces.md)), and a manuscript wants all
four. A session is a transcript you continue; a manuscript is content you edit.

### 5.4 Version history, and the one storage decision inside it

Both existing writers apply unchanged — the application's own path, and the
watcher's `external` snapshots for hand edits — with two decisions:

- **A version is a manifest, not a document.** Its payload is the set of content
  hashes for `manuscript.json` and every `text/*.md`. Payloads are already
  content-addressed, so an unchanged node costs nothing, restore is atomic across
  the whole manuscript, and no per-node history index is needed. **[OPEN]**
  against per-node history; the lean is the manifest, because Scrivener's
  snapshots are *restore points* and this is the shape that gives them.
- **The snapshot policy is idle-plus-explicit.** Prose changes continuously and a
  version per keystroke batch is unusable. An idle autosnapshot plus an explicit
  *take a snapshot* is Scrivener's model and the right import.

One thing to **verify rather than assume**, and §13 carries it: the snapshot
payload must stay opaque digest-addressed bytes rather than a typed object, or a
manifest is not expressible and Write grows a second history mechanism.

---

## 6. A mode may declare a top-level surface; only the host can satisfy one

Write needs a place in the navigation, and that is the one thing in this document
the existing surfaces genuinely cannot absorb. §6.4 names the two modes that
share the surface once it exists.

### 6.1 The widening

~~`SurfaceContribution` today names a region — a HUD slot, a side panel, a message
decoration.~~ ***It carries the payload this section proposed, since 2026-09-13,
and it arrived two releases early.*** [P7.11](workplan/23-p7-implementation.md)
built `{ region, channelId, widget }` **citing this section as the shape** —
[06 §7.2](06-modes-and-turn-pipeline.md) needed a mode to be able to show a
backdrop at 1.0, and the 2.0 widening proposed here was already the right answer,
so it was built rather than reinvented. *Recorded here because a proposal that
ships elsewhere and leaves no note behind reads, later, as a proposal nobody
took.*

**Two consequences for what follows.** The first arm below is **shipped**, not
proposed — with a fourth region, `stage`, which [10 §8.0](10-ui-surfaces.md)
argues for and which did not exist when this was written. And the widening this
section is actually about is now **only** the `top-level` arm, which is
unchanged: it is the half no channel value can express, because a nav entry is
not a rendering of anything.

It grows an arm rather than a field:

```ts
type SurfaceContribution =
  // Shipped at P7.11, with a fourth region. `channelId` is what makes a
  // contribution addressable — the value it renders is a channel's.
  | { region: 'hud' | 'panel' | 'message' | 'stage'; channelId: string; widget: WidgetSpec }
  | {
      region: 'top-level'
      /** The nav slug. One segment, owned by the mode. */
      slug: string
      /** Never English on the wire; the client keys off this. */
      labelKey: string
      /** What the route is keyed by. The router builds the path. */
      subject: { kind: 'library-object'; schema: string } | { kind: 'session' }
    }
```

Three things are being declared there and only one of them is a rendering claim,
which is the whole reconciliation:

| Piece | Contract, or bespoke |
|---|---|
| **A nav entry exists because a mode asked for one** | **Contract.** The client's fixed list of surfaces becomes a list resolved from the registered modes. |
| **The address shape** — what the route is keyed by | **Contract, and thin.** The mode declares the subject kind; the router builds the path. |
| **What the page draws** | **Bespoke, and admitted.** Write's surface is host code, exactly as Play's is. No extension supplies a page at 2.0. |

### 6.2 Why this is not the escape hatch arriving early

[10 §8.1](10-ui-surfaces.md) defers custom rendering *as far as it will go*, and
pairs the deferral with a commitment: when an extension cannot express something,
the first response is to ask **what widget would let it**, and add that. A
declared nav entry rendered by host code is that commitment being honoured. The
thing §8.1 forbids — the vocabulary quietly acquiring an `html: string` — is not
being done, and must not be done to close the gap below.

**And the gap should be stated rather than smoothed.** A third-party mode may
declare a top-level surface and get a nav entry leading to a page it did not
write. Nothing in the *server-side* contract is bypassed: the declaration is
complete and honest, and [22 §3](22-extensions.md)'s claim that contributing UI
crosses the worker boundary with **nothing** still holds. What is missing is a
**page vocabulary**, which is [10 §8.1](10-ui-surfaces.md)'s deferral arriving
from a new direction rather than a back door in the mode contract.

So the client holds a map from mode id to page component with one entry, and an
unknown mode's declared surface renders **a stub naming the mode that wanted
it**. That is [00 §3.3](00-stance.md) — dangling references are survivable,
visible and non-blocking — applied to navigation, and it makes the hole legible
instead of silent.

### 6.3 Reconciling with 16, which refuses a second surface by name

[11 §5](11-lorebooks-as-a-format.md) is unambiguous: *"No second surface, no
mode, no promotion in the navigation. Everything here happens inside the
library."* Three points, in this order, because the first is the one that
matters:

1. **16's refusal is about a kind.** Its argument is that a lorebook is one of
   six kinds and elevating one above its siblings is a category error. **Write
   elevates an activity, not an object.** The Manuscript kind gets exactly what a
   lorebook gets — a panel, the detail route, the backlink panel — and nothing
   more. Nobody navigates to *Manuscripts* to write; they navigate to Write.
2. **Surfaces hold modes by construction.** [10 §2](10-ui-surfaces.md) already
   describes Play as the surface its modes live in. What is new is only that
   these modes' views do not fit inside Play's frame.
3. **Why Play cannot simply contain it.** Play is session-shaped — a transcript,
   an input bar, a head, a stream. Write is document-shaped — a binder, an
   editor, a cursor. Putting a binder inside Play makes Play's *layout*
   conditional on the mode, which is the one-surface-two-personalities failure
   [10 §5.1](10-ui-surfaces.md) rejects for a merged library list.

**The cost, stated.** [10 §2](10-ui-surfaces.md) had two surface rows and a title
that named the count. At 2.0 it has three, and a fourth is proposed
([24 §3.4](24-roadmap.md)); §16 lists the edit that owed it. The count was always
a fact about what ships rather than a principle — and the reasoning that demotes
the workbench is untouched, because a reader is still not a surface.

### 6.4 The two modes: Outline and Prose

The surface holds two modes, and the split is not new — it is the shape §§7–12
already have, named.

| Mode | What it is for | Specified in |
|---|---|---|
| **Outline** | The binder: structure, synopses, threads, status, and the three layouts over them. Where a manuscript is *planned* and rearranged. | §10, and §5.1's node tree |
| **Prose** | The text: beats, the four choices, placeholders and slots, and the editor that has to keep offsets stable. Where a manuscript is *written*. | §§7, 8, 11, 12 |

**Why two rather than one mode with two views.** The distinction is the one
§10.2 already draws — *the past is summarised; the future is outlined* — and it
reaches further than layout. The two differ in what a call means: an Outline call
produces structure and synopses, a Prose call produces text at a position. They
differ in what a version is, in what the budgeter is assembling for, and in what
an undo undoes. Modes are how this project expresses "same contract, different
assembly" ([06 §2](06-modes-and-turn-pipeline.md)), and that is exactly what
these are.

**Why not two surfaces.** They share the artefact, the binder, the codex and the
navigation. Splitting the nav entry would make *the manuscript you are working
on* a thing you re-select when you switch between planning and writing, which is
[10 §1.1](10-ui-surfaces.md)'s per-visit cost charged for nothing.

**What this obliges the contract to do, and it is small.** The `top-level` arm
(§6.1) is declared by a mode; two modes naming the same `slug` are how a surface
with more than one mode is expressed. The host resolves them into one nav entry
whose modes are the declarers. Play is the same shape read backwards — Scene,
Freeform and Campaign are the modes of a surface the host happened to build
before the contract existed. **No new mechanism**, one rule: a slug is shared
deliberately or not at all, and a collision between unrelated modes is a
registration error rather than a merge.

---

## 7. A beat is an instruction with a position, stored beside the prose

```ts
interface Beat {
  id: string
  nodeId: string
  /** An offset into the node's text, maintained exactly as a mention span is. */
  at: number
  text: string
  kind: 'beat' | 'continue' | 'expand' | 'rewrite'
  state: 'pending' | 'applied' | 'discarded'
  /** Turn ids, newest first. The retry chain. */
  attempts: string[]
}
```

**Beats live in `manuscript.json`, never inline in the prose.** This is
[10 §13.1](10-ui-surfaces.md)'s *annotate, never rewrite* applied one level out:
the moment a beat is an HTML comment or a fenced block inside the file, the prose
file stops being prose and hand-editing acquires a syntax. Stored outside,
rendered inline — which is what an overlay is.

**The cost is the cost mentions already pay, and that is the point.** A beat's
offset indexes text a human is editing, so it drifts and must be maintained
across edits — precisely what [10 §13.1](10-ui-surfaces.md) means by *editing a
message recomputes the spans*. One mechanism, not two. It is why §13's
span-generalisation obligation matters, and it is what §12's editor decision has
to be held to.

Two consequences worth naming:

- **What a beat is not.** Not a channel, not an effect, not a step. It is an
  input waiting to be sent.
- **Length is a preset parameter**, not a constant. NovelCrafter's five hundred
  words is an output cap on the prose role, and *a scene holds six or more* is an
  observation about how people write rather than something to encode.

---

## 8. Four choices, four mechanisms that already exist

### 8.1 What a beat call assembles

- treatment framing and tone — the existing setting slot
- the active codex — the existing actor and lore slots, filled by a Write-side
  activation source (§9)
- **text before** the beat, and **text after** it — new arms (§11); *after* is
  the genuinely new one, because Play has no future text
- the node's synopsis, and its chapter's and act's — new arm
- **story so far** and **story to come** — new arm, and they come from different
  places (§10)
- the previous and next beat — new arm
- the beat instruction itself — the existing input slot, unchanged
- the guidance box — unchanged, one-shot and advisory
  ([06 §5.1](06-modes-and-turn-pipeline.md))

> **Every one of those is a candidate the one budgeter arbitrates. Nothing about
> assembly changes except which producers fill which slots.**

### 8.2 The four choices

| NovelCrafter | Mechanism here |
|---|---|
| **Apply** | A text edit, provenance naming the turn, `state: 'applied'`, and a version under the snapshot policy. Not a turn (§4.4). |
| **Retry** *(which deletes the previous response)* | A sibling turn. We keep the previous response — the divergence is deliberate and §4.2 argues it. |
| **Discard** | `state: 'discarded'`, and nothing else. The turn stays, in the record and in the cost. |
| **Section** *(kitbash, and apply later)* | A **scratch node**: an ordinary binder node with `include: false`. Already expressible as *a folder not marked for inclusion*, needing no new concept at all. Scrivener's research folder is the same idea. |

That last reduction is the nicest result in the feature and is worth stating as
one: the fourth button costs a boolean that already exists for another reason.

### 8.3 Input kinds, call kinds, and a free decision paying off

A mode declares its own input kinds, and a preset block filters on call kind —
which [04 §8](04-schemas.md) deliberately left **open**, so that a preset written
for a mode you do not have still round-trips rather than failing validation on a
string this build has not heard of.

So Write declares `beat`, `continue`, `expand` and `rewrite`; each is both an
input kind and a call kind; and **a preset carries a different instruction block
per kind with no new machinery**, which is the `appliesTo` filter doing the job
it was built for.

> ***Continue writing* is a beat call with an empty instruction and a preset
> block that applies to that kind. That is the whole implementation, and it is
> what a good abstraction looks like from the inside.**

### 8.4 What persists, and where

Five things, four homes, all of them existing:

| Thing | Home | Written when |
|---|---|---|
| The call | `sessions/<id>/turns/*.jsonl` | every generation |
| The beat | `manuscript.json` | on authoring; updated on state change |
| The prose | `text/<nodeId>.md` | on Apply |
| The provenance span | `manuscript.json` | on Apply |
| The version | `history/` | on the snapshot policy |

### 8.5 One refusal that belongs here rather than in §14

**Every call is user-initiated.** [10 §11.5](10-ui-surfaces.md)'s *never
auto-generate — not on focus, not on blur, not on opening an empty editor*
applies with full force to prose. Nothing writes into the manuscript because the
cursor moved, because a scene looks short, or because a beat has been sitting
there unrun. An editor that fills itself in is an editor people stop trusting,
and that is worse for a novel than for a form.

---

## 9. The codex is not a kind — it is the library, addressed from the manuscript

### 9.1 The argument

NovelCrafter's codex has five entry types, and this project already has homes for
all five: **character → Actor**; location, lore, object and subplot →
**lore entry**, whose tag field is already a free string with a suggested
vocabulary. A Codex kind would be [00 §2.7](00-stance.md)'s per-mode
reimplementation, and it would immediately produce the failure
[10 §13.2](10-ui-surfaces.md) exists to surface — two records for one person.

> **The codex is not a thing to build. It is the library, filtered to what this
> manuscript uses and sorted by where it appears — which is a query, not a
> kind.**

The precedent is [11 §4.2](11-lorebooks-as-a-format.md)'s refusal of a
compatibility field on the same grounds: the honest version is co-occurrence,
and that is a query rather than something to store.

### 9.2 What is already there, and what is genuinely new

| Tracking control | Status |
|---|---|
| Track by name and alias | **Exists.** An actor's aliases are already *the default keyword set for lore matching* ([04 §4](04-schemas.md)), which is why [10 §13.1](10-ui-surfaces.md)'s one-pass-two-consumers rule already covers this. **Write must not add a second matcher.** |
| Case sensitivity | **Exists on a lore entry, absent on an actor.** New on the actor side, or resolved as a matcher option. |
| Whole-word matching | **Exists on a lore entry, absent on an actor.** Same. |
| Automatic plurals | **New, and a property of the language rather than of the entry.** A matcher option at book or manuscript level, not a per-entry boolean. **[OPEN]** where it is configured; lean, matcher-level. |
| **Exclusion list** — the character named *Will* | **New, and genuinely needed.** Keys have no negative form. And this is *not* the existing `not_any` selective logic, which gates activation on other keys being present and cannot suppress one literal match. |
| **Four-valued AI context** | **Partly expressible, and the missing value is the interesting one.** A constant entry is *always*; a disabled entry is *never*; an ordinary one is *on match*. What has no expression is **tracked but never injected** — highlight *Will* everywhere and spend no tokens on him. The clean fix is not a fourth state but naming the two axes: an `aiContext` of always / on-match / never, **plus** a separate `track` boolean. That is [10 §13.2](10-ui-surfaces.md)'s *two axes, not one enum* arriving for the third time, and it should be cited as such rather than reinvented. |
| **Relations and nesting** | **Refused, and the reason is already written down.** Recursive activation already produces the effect text-first, and [10 §5.3](10-ui-surfaces.md) already decided links between entries are *offered, not drawn*. The blocker for a declared graph is [11 §4.1](11-lorebooks-as-a-format.md): an entry id is unique within one book and carries no meaning beyond it, so a stable relation cannot be declared to a thing with no stable identity. An actor's lore links plus recursion carry the real cases. §15 holds the reopening condition. |
| **A mentions index** | **New and cheap.** Full-text search already covers objects and turns; the manuscript's `text/` is a third subject. |
| **The heatmap** | Free once the index exists: a per-node count is a rendering. |
| Marking in the prose | [10 §13.1](10-ui-surfaces.md)'s overlay pointed at a node, with the same three methods and the same rule that they must look different. |
| Thumbnails | Embedded media — exists. |
| Tags never reaching the model | Exists on actors, books and entries, and none is injected. Worth restating as a promise, because NovelCrafter makes it explicitly and users rely on it. |

**One deliberate divergence from 16, and it must be declared rather than
slipped.** [11 §5](11-lorebooks-as-a-format.md) computes a lorebook's mentions
*at render and deliberately never indexes them*. **A ninety-thousand-word
manuscript is not a lorebook**, and a heatmap over it does want the index. The
rule 16 was protecting — no derived document, no parallel representation to fall
out of date — is kept: the index stays derived and rebuildable
([03 §5.1](03-data-model.md)), which was always the actual invariant.

**So: three new optional fields on the lore entry** — an exclusion list, the
AI-context value and the track flag — plus the matcher options. §13 says when
they have to land.

### 9.3 Characters mentioned without a card — three tiers, all existing

[10 §13.1](10-ui-surfaces.md) applies unchanged and is the whole answer: **an
unresolved name is an offer, never a write.** A capitalised name the engine does
not know renders as `proposed` — visibly tentative, clickable — and nothing is
materialised. *"An unresolved mention is not an error"*, and most names in prose
are scenery.

Where an accepted offer lands, cheapest first:

1. **Manuscript-local.** `localActors` on the manuscript — the same Actor type,
   the same session-origin provenance, the same explicit promotion as
   [03 §2.3](03-data-model.md)'s session-local actors, moved onto the object that
   outlives the session. Not an invention: the same mechanism against the durable
   artefact, and the direct answer to *NPC-like handling of characters referenced
   without cards*.
2. **The library**, when a walk-on turns out to matter. One click, the existing
   promotion, offered and never automatic.
3. **Nothing at all**, which stays the default.

Why session-local is the *wrong* tier here is worth one line, because the rule it
bends is a good one: [03 §2.3](03-data-model.md) exists so that *a session tried
once and abandoned leaves nothing behind*. In Write the session is the tool and
the manuscript is the work, so a character invented in chapter three has to
outlive the afternoon.

---

## 10. Grid, Matrix and Outline are three layouts over one binder

**This section is Outline mode** (§6.4). What follows are its three layouts, not
three modes — the mode/layout distinction is the same one
[10 §5](10-ui-surfaces.md) draws for the library panels.

**The name collides with itself and that is tolerable.** Outline mode's default
layout is also called Outline, with Grid and Matrix as the alternatives. The mode
is named for its default the way a folder is named for what is usually in it;
renaming either to avoid the overlap would cost more legibility than the overlap
does. Recorded here so it is a decision rather than a thing someone notices later
and "fixes".

### 10.1 The three views

Not three features — the same *shared handling, distinct surfaces* line
[10 §5](10-ui-surfaces.md) draws for the library panels.

- **Outline** — the tree with synopses. Scrivener's outliner, and the default.
- **Grid** — cards, dragged to reorder. Scrivener's corkboard. The card face is
  title plus synopsis, which is exactly why synopsis is a first-class field
  rather than a note.
- **Matrix** — a table, one row per scene, with columns for synopsis, summary,
  POV, threads, label, status and word count. The cheapest of the three and
  probably the most used; [10 §1.1](10-ui-surfaces.md)'s density stance actively
  wants it.

**One divergence from NovelCrafter, taken from Scrivener: the board is per
container, not per manuscript.** Four hundred cards on one board is a mess, and
the binder already supplies the zoom.

**Threads are declared on the node, not derived from mentions.** Derived is free
and wrong whenever a scene advances a thread without naming it, and an
uneditable derived column is [00 §3.6](00-stance.md)'s *showing without
correcting*. A Matrix column has to be editable to be worth having.

### 10.2 Summaries, and the asymmetry that decides two slots

> **The past is summarised; the future is outlined.**

- *Story so far* is the chain of **derived node summaries** for everything before
  this node in binder order, budgeted.
- *Story to come* is the chain of **authored synopses** for everything after —
  because the future has no prose to summarise, only intent.

This puts [25 E1](25-open-questions.md)'s rolling summary and
[07 §5.1](07-branching.md)'s content-addressed chain on new ground: in Play the
chain runs over turns in path order, in Write over **nodes in binder order**.
Same machinery, different sequence.

**And it carries a cost Play does not have, which has to be stated.** In Play a
fork invalidates exactly one link. In Write, **dragging a chapter invalidates
every link after it.** The mitigation is in the keying, and it is why
[07 §5](07-branching.md)'s content-addressing has to land at 1.0 as designed
rather than as a running total: a *node summary* is keyed by that node's content,
and a *chain link* is keyed by the sequence of node-summary keys. A reorder
therefore recomputes the links — which take summaries as input rather than prose,
and are correspondingly cheap — and reuses every node summary untouched.

**Where a wrong summary is seen, and how it is fixed**, because a derived value
the user cannot reach is [00 §3.6](00-stance.md)'s *showing without correcting*
and this section would otherwise fail its own test. **The Matrix carries the
summary as a column beside the synopsis** — which is most of the answer, because
the two sitting adjacent is what makes a drifted summary visible at all: the
authored intent and the derived description of the result, disagreeing in one
row. An edited summary is **pinned**, held against regeneration and marked as
authored, in the same spirit as the *offered, never automatic* rule everywhere
else here. And because summaries are derived and disposable
([25 E1](25-open-questions.md)), the heavier repair is always available: discard
and regenerate one node, a chapter, or the chain, with a better model or a
better prompt. **Summary quality is not a one-way door**, which is what makes
shipping a simple version of this safe.

### 10.3 Create from outline

[00 §2.3](00-stance.md) forbids big-bang generation, and this is the textbook
application: generate the act list, validate, apply; chapters per act, validate,
apply; scene synopses per chapter, validate, apply. Each individually retryable,
with partial application and per-section validity.

**The plotting methods are content, not code.** Three-act, save-the-cat and the
hero's journey ship as a Treatment or a Preset — the same reasoning
[06 §7.3.1](06-modes-and-turn-pipeline.md) uses for difficulty levels: *the layer
that shapes model behaviour should be the layer an author can open and edit*.

---

## 11. A placeholder is invisible to the budgeter; a slot is a block with a cost

NovelCrafter has a function language over the story — scene text, codex queries,
POV predicates, story-so-far. **Refuse the language; add arms.**

And be precise about why, because the obvious citation is the weaker one.
[00 §2.1](00-stance.md) rejects macro substitution, but a function language is
not string surgery on a blob and would survive that objection. The argument that
actually decides it is [00 §2.6](00-stance.md):

> **A placeholder that expands inside a block is invisible to the budgeter. A
> slot that names a source is a block with a token cost, an inclusion reason and
> a verdict. That is the whole difference, and it is why the answer is arms
> rather than functions.**

A codex query inside a template cannot be dropped under pressure, cannot carry
*"keyword match: 'cathedral'"*, and cannot appear as a row in the workbench.
A second, smaller argument worth one sentence: a query language over the domain
model, shipped inside a **portable** preset, makes every rename in the domain
model a breaking change to everybody's presets.

### 11.1 The arms

| Arm | Fills with | Replaces |
|---|---|---|
| `manuscript` — with a `part` of before or after, and a `scope` of node, chapter or manuscript | prose preceding or following the beat | text-before, text-after, scene full text, previous and next scene. The `scope` is what makes this one arm rather than six. |
| `outline` — synopsis or notes, at scene, chapter or act level | the **authored** half | scene, chapter and act summaries |
| `summary` — so-far or to-come | the **derived** half | story-so-far and story-to-come. Two values, because §10.2 says they come from different places. |
| `beat` — previous or next | neighbouring instructions | previous and next beat. Two values, not three: the current beat **is** the input slot. |
| **A widening**, not a new arm: the actor slot gains a selector for *the POV actor* | the POV character's card | the POV character function. A second way to reach an actor would be a second source of truth about how an actor renders. |

**Refused by name**, so they are re-checked rather than re-argued:

- **A style arm** for tense, person and language. That is treatment framing, and
  the setting slot already carries it. If tense needs a field, it belongs on
  Treatment rather than in the slot vocabulary.
- **A snippet arm.** A snippet is a lore entry, a preset text block, or a scratch
  node. Three homes exist; a fourth is not needed.
- **Codex queries in the preset**, with or without relation expansion. Choosing
  *which* lore entries go in is the retriever's job
  ([00 §2.5](00-stance.md), [03 §3](03-data-model.md)); putting it in the preset
  moves retrieval into the prompt pack. The lore arm exists and the activation
  source decides. This is the cleanest refusal in the list.
- **Previous-scene-with-the-same-POV.** A retrieval predicate wearing a slot's
  clothes. If it turns out to matter it is a selector on the manuscript arm, not
  a new arm.

**Templating is not refused, and the note must not claim it is.**
[06 §5](06-modes-and-turn-pipeline.md) already intends templates to render
*within* a block, and that is unchanged. **[OPEN]** whether the existing wrapper
placeholder covers the small residue — a manuscript title, a POV name — or
whether Write is finally the feature that wants a template language inside a text
block. Lean: still no. Each of those residues is arguably a slot, and a template
language admitted for three tokens is admitted permanently.

---

## 12. The first structured editor, and the property it must have is offset stability

**[OPEN]**, with a lean. The requirement is narrower than *a rich-text editor*,
and getting the requirement right matters more than the choice.

Three constraints, and the third is the one that decides:

1. **The canonical form is plain Markdown on disk** (§5.2). An editor whose
   document model is a node tree makes the file a *render* of that model, which
   inverts the storage decision and reproduces the two-sources-of-truth failure
   [03 §5.2](03-data-model.md) rejects for cards.
2. **Annotate, never rewrite** ([10 §13.1](10-ui-surfaces.md)). No markup is
   injected into the authored bytes: mentions, provenance and beats are all
   offset-keyed overlays held outside the file.
3. **Therefore the editor must maintain externally-held, offset-keyed
   annotations across arbitrary edits.** That is the actual requirement, it is
   much sharper than *we need a rich text editor*, and it is what any candidate
   should be held to.

Against that: a hand-rolled contenteditable is not a candidate. A textarea with a
mirrored overlay is genuinely viable for decoration-only prose — no dependency,
offsets trivially correct — and loses inline block widgets, per-span hit targets
and long-document virtualisation. A plain-text editor component with a
first-class position-mapping API and decoration sets is a direct match for
constraint 3. Rich-text document models fight constraints 1 and 2.

**The lean is the plain-text-with-decorations family**, and the lean is safe
because the decision is contained: the document on disk is Markdown, the
annotations are offsets in `manuscript.json`, and nothing in the server, the
schemas or the API knows what the editor is. That is client-internal in the same
structural sense [19 §6](19-tech-stack.md) makes the framework choice reversible
— by construction rather than by promise. It is also this repository's **first
editor dependency of any kind**, so it is argued in the register
`packages/shared`'s dependency note establishes for this project, and it is
argued in the phase plan rather than assumed here.

Two constraints to record whichever way it goes:

- **Read-only rendering must not require the editor bundle.** The reading view
  ([10 §12](10-ui-surfaces.md)) and the library's raw view must not depend on it,
  or the editor becomes a dependency of everything.
- **The reopening condition.** If the beat interaction turns out to need rich
  structured content *inside* the prose — tables, embeds, threaded comments — the
  plain-text model is wrong, and the answer is a rich-text editor with a
  Markdown-canonical serialiser, which costs §5.2's storage decision. If it needs
  only block widgets you can tab into, plain text covers it.

---

## 13. What this obliges 1.0 to do

The standing test. Four rows say *nothing*, and that half is what makes the other
half credible.

**Every remaining row now lands at 1.0.** This table used to split across 1.0 and
2.0, on the reasoning that Write was three releases away and some of its debts
could be paid in the release before it. With Write at 2.0 there is no release in
between, so "before Write" and "at 1.0" are the same instruction.

| Element | Obligation |
|---|---|
| Turn tombstones and compaction | **None, and Write reduces the pressure.** Already required by [03 §5.5](03-data-model.md) for branch pruning; Write needs no deletion at all, because Discard keeps the turn. |
| An open call-kind union | **None — already done, and this is where it pays.** Write's four input kinds are call kinds with no schema change, and a preset carries a different instruction block per kind ([04 §8](04-schemas.md)). Recorded as a vindication rather than a debt. |
| The index holding a third kind of text | **None.** The index is derived and rebuildable ([03 §5.1](03-data-model.md)); another table is free. |
| Mode config naming a library object | **None.** It is stored verbatim and never interpreted ([06 §2](06-modes-and-turn-pipeline.md)). |
| Plot-hook identity, goals, presence | **None.** All are Play concepts Write does not use. |
| **The span overlay must generalise past actors** | **Real, and the largest.** [10 §13.1](10-ui-surfaces.md) already says the model *"should be built so that it can"* — Write needs three consumers of one span shape: mentions, machine-written provenance, and beat positions. So *generalises* has to mean **a tagged reference from the first span ever written**, and the type must not be named for mentions. If P7 ships it with an actor reference baked in, Write must either migrate every stored turn or grow a second span type — and the second is how one overlay becomes two. |
| **The lore entry's four-value axis must not be squeezed into the two booleans** | **Real, and it lands at 1.0** ([work plan §0.5](workplan/01-work-plan.md)). Optional fields are additive and free later ([04 §2](04-schemas.md)); *reinterpreting* the existing constant and enabled flags as the axis is a version bump, because a field that means something different is a new version. So add the AI-context value, the track flag and the exclusion list as **optional fields whose absence means today's behaviour.** The old deadline was "2.0 at the latest", which stopped meaning anything when Write became 2.0 — the consumer and the deadline collided, so the deadline moves in front of it. Free now, a bump later, so now. |
| **Summaries as content-addressed values, never a running total** | **Real, and Write is a second consumer rather than a new demand.** [07 §5.1](07-branching.md) and [25 E1](25-open-questions.md) already require it. Write's node-summary chain is impossible over a mutated blob, and §10.2's reorder analysis depends on the two-level keying. Strengthened, not added. |
| **Session export must not freeze the turn record before §4 is settled** | **Real, the sharpest, and no longer hypothetical.** [25 B12](25-open-questions.md) and the record's own definition both say export ends the record's freedom to move. Write adds an anchor and narrows what the parent link means. Export now ships at 1.0 ([work plan §0.5](workplan/01-work-plan.md)), which removes the "schedule export later" branch entirely: **§4 has to be settled before P11 freezes the format.** This is the one row that makes this document near-term work rather than a design for later. |
| **Version snapshot payloads stay opaque digest-addressed bytes** | **Small, and a check rather than a change.** A manuscript version is a manifest of file hashes (§5.4); if the payload is ever typed as *the object's JSON*, that is not expressible and Write grows a second history mechanism. Verify at P5, do not assume. |
| **`surfaces` stays a declared value on the mode definition** | ~~**None, but do not delete it.** Widening the union is internal work. What is worth writing down is that an empty `surfaces` on Scene means *this mode contributes none*, not *placeholder* — an empty array nothing reads is exactly what invites removal.~~ ***Discharged 2026-09-13, and both halves of the risk are gone.*** `surfaces` is read — [P7.11](workplan/23-p7-implementation.md) gave it a renderer and a wire shape — and **Scene's is no longer empty**: it contributes three at [P7.12](workplan/23-p7-implementation.md). Freeform's *is* still empty, and now honestly so, which is the distinction this row was protecting: it declares one channel a person writes and has nothing of its own to show. *The obligation was right and expired by being met, which is the best way for one to go* |

---

## 14. Non-goals, refused by name

- **Real-time multi-human co-editing.** [09 §8](09-server-multiuser-deployment.md)'s
  posture holds unchanged: don't preclude, don't build. A manuscript is a library
  object under one user, so this is the same deferred question as everything
  else, not a new one.
- **Typesetting, page layout, and compile-as-production.** Compile is adopted as
  a *concept* — the manuscript is not the output — and the output is the reading
  view, which already refuses to ship a PDF library
  ([10 §12.2](10-ui-surfaces.md)). Refused: pagination, fonts, style sheets, ePub
  production. **Compile is the reading view, and the reading view is not a
  typesetter.**
- **Track changes.** Version history answers *what changed* and provenance
  answers *who wrote it*. Track changes is a review workflow for several humans,
  which is the co-editing non-goal in different clothes.
- **A grammar or style checker.** A per-keystroke advisory over prose has the
  false-positive problem [24 §2c.2](24-roadmap.md) defers continuity checking
  for, without continuity checking's payoff — and the browser and the operating
  system already ship one.
- **A submission or publishing pipeline.** Query letters and manuscript format
  would be the clearest possible evidence of having misread §1's audience.
- **Replacing the reading view.** It renders a path through a turn tree;
  rendering a binder is a *second subject* for one view, not a competitor to it.
- **Being an import target for SillyTavern or NovelCrafter.**
  [00 §4](00-stance.md) already refuses ST parity; for NovelCrafter there is no
  exchange format to be a target of, and building against a closed product's
  export is a commitment to track someone else's roadmap. **What is not refused:
  content.** A folder of Markdown imports as prose and a codex export imports as
  a lorebook, both through ordinary paths. *Refuse fidelity, accept content.*
- **A drafting agent.** Nothing here writes a chapter unattended (§8.5). This is
  the refusal that keeps the mode light rather than turning it into an agent
  harness, and it is the one most likely to be argued with.
- **A second codex store.** §9's argument, restated as a refusal.
- **A wiki or a note-taking app.** [11 §5](11-lorebooks-as-a-format.md)'s refusal
  of wiki-ness carries over unchanged. The notes field is notes *on a node*, not
  a knowledge base.

---

## 15. How we would know this was wrong

Split by when each can be run, because the useful half runs at 1.0 — long before
any of this is built.

**Runnable at 1.0, against real play, and now the only window there is** — with
Write at 2.0 there is no intervening release to run these in:

- **Watch whether people write long prose in Play.** The premise is that guided
  long-form wants a different surface. If people are already producing chapters
  happily in Scene with the guidance box and the reading view, **the surface is a
  solution to a problem the existing modes solved**, and the move is to fold
  Write into a Scene preset rather than a mode with a place in the navigation.
  This is the cheapest and sharpest test available and it costs nothing but
  attention.
- **Watch whether mentions get switched off.** [10 §13.1](10-ui-surfaces.md) says
  an unresolved mention is not an error, which is easy to hold in a transcript. A
  ninety-thousand-word manuscript has hundreds of proper nouns. If the first
  thing people do at P7 is turn the marking off, **the overlay does not survive
  the scale change from turns to documents**, and an exclusion list is not the
  fix.
- **Measure a full turn record against a plausible manuscript.** Three hundred
  beats at three attempts each is nine hundred records at roughly ten to a
  hundred times their text ([03 §8](03-data-model.md)). If that number is
  unpleasant, retention stops being a comfortable open question and Write is what
  made it urgent.

**Runnable once Write exists:**

- **Count calls per applied span.** Near one means people are not iterating, the
  four-way choice is machinery for a decision nobody makes, and *continue
  writing* was the whole feature.
- **Count Section usage.** If nobody kitbashes, the scratch node is a
  NovelCrafter habit rather than a need, and one fewer button is better.
- **Count binder reorders after the fact.** If reordering is rare, the binder is
  an expensive answer to a static list and §10.2's invalidation cost was paid for
  nothing.
- **Watch whether people maintain a parallel cast.** §9's central claim is that
  the codex is the library. If manuscript-local actors accumulate and never get
  promoted, **the library is the wrong home and the codex is a real kind.**
- **Watch whether anyone opens `text/`.** §5.2 bets that id-named files plus a
  derived index are legible enough. If people cannot find their own chapter
  three, that naming decision reopens.

**Two reopening conditions rather than tests:**

- **If a lore entry ever gains a portable, cross-install identity**
  ([11 §4.1](11-lorebooks-as-a-format.md)), declared codex relations become
  possible and §9.2's refusal reopens.
- ~~**If session export is scheduled before 3.0**, §4 stops being a far-release
  design and becomes a near constraint, and this document has to be settled
  early.~~ **This has fired.** Export ships at 1.0
  ([25 B12](25-open-questions.md), [work plan §0.5](workplan/01-work-plan.md)),
  so §4 is a 1.0-adjacent constraint and this document is settled early rather
  than eventually. Kept struck through rather than deleted, because a reopening
  condition that quietly disappears when it fires teaches nobody anything.

---

## 16. What this document owes elsewhere, and what it has already paid

Recorded so the write-backs are checkable rather than remembered, and split by
whether they are done — because a list that does not distinguish the two is a
list nobody can act on.

**Discharged in the same pass as this document:**

- **[10 §2](10-ui-surfaces.md)** was titled *"Two surfaces and an inspector"*; it
  is now *"The surfaces, and an inspector"* and names Write's arrival at 2.0
  along with the proposed fourth (§6.3). A stale count in the surface document is
  exactly the sort of thing that gets cited later as a rule, which is why the
  count stopped being in the title.
- **[06 §7](06-modes-and-turn-pipeline.md)** carries a pointer here — deliberately
  a pointer rather than a §7.5, which would invite reading Write as Scene's peer.
  Write is a surface rather than a chat mode, a sharper version of the same
  distinction §7.4 already draws for the assistant.
- **[25](25-open-questions.md)** has taken this document's open questions as E11
  (the editor, §12) and E12 (the four smaller shapes: history granularity §5.4,
  plurals §9.2, sessions per manuscript §4.5, and templating inside a text block
  §11.1).
- **[work plan §0](workplan/01-work-plan.md)** and
  [releases §0](workplan/04-repo-and-releases.md) carry the scheduling, and
  [the design index](README.md) carries the surface and the two new terms.
  [24](24-roadmap.md) no longer carries any of it: §2e is gone, because the
  feature list stopped holding release commitments.

**Still owed, and deliberately not done here:**

- **[10 §5.1](10-ui-surfaces.md)** settles on **six** library panels and marks
  that *for now*. §5.3 spends the seventh, so that section owes a line — and so
  does [polish §5](workplan/06-polish.md), whose build item reads *six panels,
  one per portable kind*. Manuscript is a panel **without** being portable
  (§5.3), so that phrasing stops being true before the count does, which is the
  easier half to miss.
- **[04 §5](04-schemas.md)** takes the three optional lore-entry fields from
  §9.2, on §13's schedule — which is **now 1.0**, not "2.0 at the latest". The
  old objection was that adding them before there is a consumer puts three unread
  fields in a portable schema, which is how a schema accretes. That objection is
  overruled rather than answered: the alternative is reinterpreting two existing
  booleans after 1.0 has shipped, and a bump is worse than three documented
  optional fields.
