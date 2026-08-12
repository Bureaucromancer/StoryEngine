# 14 — Cross-session memory

**Status: proposal.**

Characters should remember you between sessions. This document covers memory
*across* sessions; memory *within* a long session — summarisation, chapters,
retrieval over prior turns — is still unwritten and remains the larger gap in
[06 §E](06-open-questions.md).

---

## 1. The requirement

- A character defaults to having prior sessions available, unless turned off.
- Each session has **two toggles**: whether it *shares* its memories, and
  whether it *intakes* memories from relevant actors.
- Beyond those, **manual association**: a list of the account's sessions, each
  individually forceable on or off regardless of the toggles.

---

## 2. Memories are a lorebook

The mechanism, and the reason this feature is smaller than it looks.

A memory is a discrete, keyed, retrievable piece of text with an origin and a
date. That is a lorebook entry. So:

> **Each (actor × persona) pair, per user, has an auto-maintained memory
> lorebook.** Entries are extracted from sessions; each carries a ref to its
> origin session and a timestamp.

Everything then already exists ([02 §3](02-data-model.md)): keyword and
similarity retrieval, the two-tier token budget, the trim order, skip reporting,
sticky and cooldown timing, the workbench showing exactly which memories were
injected and why. No new retrieval path, no new budgeter, no new UI for
inspecting what happened.

Three consequences worth having deliberately:

- **Memories are hand-editable**, because lorebook entries are. Users will want
  to correct a mis-extracted memory, and giving them the normal editor is free.
- **Memories are prunable and disableable individually**, per entry, with the
  affordances that already exist.
- **They must not be treated as authored content.** An auto-maintained memory
  book is *derived*, personal, and often full of things you would not hand
  someone. Mark it non-shareable by default and warn on any export path — this
  is the one place the reuse could bite.

### 2.1 What gets extracted

A step at session end, and periodically during long sessions, writes memory
entries. Manual capture — a "remember this" action on a message — should exist
too and is nearly free.

**Extract discrete facts and events, not summaries.** A summary is one blob with
one relevance; five memories are five things that can be retrieved
independently, attributed separately, and deleted individually when one turns
out to be wrong.

---

## 3. Scope: whose memory is it?

The part the naive version gets wrong.

**Memories are scoped `(user, actor, persona)`.**

- **Per user, absolutely.** Sessions are private ([04 §4.3](04-server-multiuser-deployment.md)),
  so Alice's history with Vera can never inform Bob's, even though it is the
  same card. Not a toggle. Not overridable.
- **Per actor**, which is the obvious axis and what the requirement means by
  "relevant actors".
- **Per persona, by default** — and this is the non-obvious one. If you play two
  personas, Vera remembering what she did with persona A while talking to
  persona B is both a coherence failure and a spoiler. She is talking to a
  different person, and she should know a different history.

Persona scope is a **default, not a law**: a setting widens it to "this actor
remembers across all my personas", which some people will want and which is
right for a single-persona install where the distinction is invisible anyway.

**[OPEN]** Whether an actor should remember *other actors* it shared sessions
with — Vera recalling that she and Tomas both know you. Appealing, and it
multiplies the scope matrix. Not at 1.0.

---

## 4. The toggles

Two per session, both defaulting **on**, and their asymmetry is the useful part:

```ts
interface SessionMemoryConfig {
  /** This session contributes memories to its actors' memory books. */
  share: boolean          // default true
  /** This session draws on memories from its actors. */
  intake: boolean         // default true
  /** Per-session overrides. Absent = governed by `intake`. */
  associations: Record<string, "always" | "never">
}
```

All four combinations are meaningful, which is why these are two controls
rather than one:

| share | intake | Use |
|---|---|---|
| on | on | The default. A continuing relationship. |
| **off** | **on** | An experiment. Learns from history without polluting it. |
| on | off | A fresh start that still becomes canon going forward. |
| off | off | A sealed alternate universe. |

**`associations` is a tri-state, not a boolean.** "Auto, always, never" —
because a plain boolean cannot express *exclude this one specific session
despite intake being on*, which is precisely the control the requirement asks
for. Absent from the map means auto.

**Manual association overrides the toggles in both directions**, per the
requirement: `"always"` pulls a session in even when `intake` is off, and
`"never"` excludes one that would otherwise qualify.

**[OPEN]** `share: true` by default means every throwaway session contributes.
The requirement states the default for intake; sharing defaults on by symmetry.
The mitigation is that isolating a session must be one obvious action rather
than two toggles found in a drawer — plausibly a "scratch session" preset that
sets both off at creation.

---

## 5. Memories are advisory, and must not write state

The same boundary as the guidance box ([03 §5.2](03-modes-and-turn-pipeline.md)),
and for the same reason.

An imported memory says Vera trusted you. It must not *set* a trust channel in
this session. Otherwise starting a new session silently populates its state from
another one, and a mechanic that looks like it was earned here was inherited
from somewhere the player may not even remember.

So memory blocks are marked `advisory: true` and are inadmissible to evaluation
steps, rule conditions and engine-computed channel updates. They inform the
narrator; the narrator's output can then legitimately move state, exactly as
with guidance — and that indirect path is the system working, not a leak.

---

## 6. Failure modes worth designing against

**Spoiler bleed is the sharp one.** Replay a package or start a second story in
the same setting, and intake will happily import what happened last time —
including twists, plot hooks that fired ([02 §4.1](02-data-model.md)), and
things a fresh protagonist has no business knowing. This is the failure most
likely to make someone turn the whole feature off.

Mitigations, in order of how much they cost:

- **Warn at session creation** when a new session's setting or package matches
  an existing one, and offer to start isolated. Cheap and catches the common
  case.
- **Never import memories derived from hidden content** — a hook's premise, a
  hidden channel, GM-only state. Extraction should refuse those at the source
  rather than filtering them later.
- **[OPEN]** Whether sessions seeded from the same package should default to not
  sharing with each other. Tempting, and probably too clever — a continuing
  campaign in the same package is a normal thing to want.

**Contradiction and staleness.** A memory says she is friendly; she is hostile
now. Memories carry timestamps and retrieval should prefer recent ones, but the
real answer is §5 — they are context, not truth, and the current session's
channels always win.

**Volume.** Fifty sessions of memories is a lot of candidate entries. This is
exactly what the existing budgeter is for, and the reason §2's reuse matters
more than it first appears.

**Genre contamination.** A comedy AU bleeding into a serious campaign. Manual
`"never"` handles it; the warning in the spoiler mitigation catches some of it.

---

## 7. The UI, as the requirement describes it

Per session, in settings:

- **Two switches** — *Share memories from this session* / *Use memories from
  these characters*.
- **A list of the account's other sessions involving the same actors**, each
  tri-state: auto (default), always, never. Sessions the toggles already include
  show as auto-on rather than being hidden, so the effective result is visible
  rather than inferred.
- **A link to the memory book itself**, opening the ordinary lorebook editor.
  That is where individual memories are read, corrected and deleted, and it
  needs no bespoke UI.

The workbench ([05 §3](05-ui-surfaces.md)) already answers "which memories
actually reached this turn, and why" without anything being added, because
memory entries are lorebook entries and lorebook activation is already recorded
per block.

---

## 8. Open

- **[OPEN]** Extraction cadence and cost. Session end is obvious; periodic
  extraction during long sessions is better and costs calls. Should it reuse the
  summarisation pass rather than being a second one?
- **[OPEN]** What happens to memories when their origin session is deleted.
  Keeping them orphans the attribution; deleting them loses history the user may
  value. Probably: ask, defaulting to keep with the origin marked as deleted.
- **[OPEN]** Whether memory books are per (actor × persona) as separate books,
  or one book per actor with per-entry persona tags and filtered retrieval. The
  second is fewer objects and more query complexity.
- **[OPEN]** Cross-session memory for the *narrator* rather than a character —
  "the GM remembers your last campaign". Coherent, and a different scope key.
