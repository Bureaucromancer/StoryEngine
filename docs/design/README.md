# StoryEngine — Preliminary Design Notes

**Status: early design exploration. Nothing here is decided.** These are design
notes, not documentation of what exists — see [../](../) for that distinction.

**Phase: pre-alpha.** No code yet. **1.0 ships Scene and Adventure–Freeform;
Adventure–Campaign and Messages are 2.0** ([15 §0](15-work-plan.md)), as is the
authored-rule vocabulary ([15 §0.4](15-work-plan.md)).
Distribution, when there is something to
distribute, is build-it-yourself until beta — which is defined as *feature
complete to the 1.0 spec*. See [12 §0](12-repo-and-releases.md).

**The first checkpoint is PLAYABLE** ([15 §4.1](15-work-plan.md)) — well before
beta, and the point at which the design gets tested by use rather than completed
on paper.

These are working documents for a clean-sheet engine that takes the *feature
territory* of Aventuras, Marinara Engine and SillyTavern without inheriting
their accumulated structure. Infinite Worlds — closed-source, and in the same
genre as the Adventure mode — is a fourth reference, surveyed in
[09](09-infinite-worlds.md). They are deliberately **not comprehensive**. They
record an initial set of positions on where StoryEngine should *diverge* from
the obvious approach — "port the three feature sets into one server" — and they
leave large areas untouched on purpose.

Where a document takes a position, it is a proposal to argue with, not a
decision. Open questions are collected in [06-open-questions.md](06-open-questions.md)
and also flagged inline as **[OPEN]**.

## Reading order

File numbers reflect the order documents were written, not the order to read
them in. The groups below are the reading order; **start with 00, then 01**.

### Start here

| Doc | What it covers |
|---|---|
| [00-stance.md](00-stance.md) | Design principles, and the specific legacy patterns being dropped |

### What we are building on

| Doc | What it covers |
|---|---|
| [01-source-survey.md](01-source-survey.md) | What Aventuras, Marinara and SillyTavern actually do |
| [09-infinite-worlds.md](09-infinite-worlds.md) | The fourth reference, and the authored-rules tier it exposes as missing |
| [08-triage.md](08-triage.md) | Per-subsystem verdicts: adopt, port, rebuild, discard, buy |

### The design

| Doc | What it covers |
|---|---|
| [02-data-model.md](02-data-model.md) | **Why** the objects are shaped as they are; storage on disk |
| [13-schemas.md](13-schemas.md) | **What** they are — definitions, and the stability boundary |
| [03-modes-and-turn-pipeline.md](03-modes-and-turn-pipeline.md) | The mode contract, the modes, channels, party, assembly, renditions |
| [10-branching.md](10-branching.md) | Branch anywhere: the effect log makes it a pointer, and summaries survive |
| [14-cross-session-memory.md](14-cross-session-memory.md) | Characters remembering you between sessions, as an auto-maintained lorebook |
| [04-server-multiuser-deployment.md](04-server-multiuser-deployment.md) | Server-authoritative generation, notifications, multi-user, LAN, packaging |
| [05-ui-surfaces.md](05-ui-surfaces.md) | Web-only client, library and workbench, file access, editors |

### Implementation and process

| Doc | What it covers |
|---|---|
| [07-tech-stack.md](07-tech-stack.md) | Language, runtime, framework, localisation, randomness, dev mode |
| [15-work-plan.md](15-work-plan.md) | Sequence to beta, and the day-one checklist of now-or-never decisions |
| [16-testing.md](16-testing.md) | Testing, validation and CI — what to build, what to automate, what to skip |
| [17-extensions.md](17-extensions.md) | The extension boundary and interface: worker isolation, host API, storage |
| [12-repo-and-releases.md](12-repo-and-releases.md) | Project phases, branching and release model; draft CONTRIBUTING.md |

### What comes after, and what is unresolved

| Doc | What it covers |
|---|---|
| [11-roadmap.md](11-roadmap.md) | Post-1.0 roadmap, plus desired extensions — hints for expansion authors |
| [06-open-questions.md](06-open-questions.md) | Every open decision, ordered by how expensive it is to answer late |

**02 and 13 are a pair.** 02 carries the reasoning and the alternatives
considered; 13 carries the definitions. Where they disagree, 13 is current.

## The four commitments these documents are built around

1. **Natively multi-user.** Username/password access separation for a trusted
   LAN. Not a security boundary, and the docs say so plainly wherever it matters.
2. **Natively web-based, server-first.** The default install is a server
   expecting LAN connections. The browser is *the* client — no desktop app, no
   native mobile app — and it is a view onto server-side state, not the place
   generation happens. The only secondary interface is direct file access to the
   data directory, offered in-UI as a permission level.
3. **Four chat modes across two releases.** **1.0**: Scene (SillyTavern/Marinara
   RP) and Adventure–Freeform (the Aventuras shape). **2.0**: Adventure–Campaign
   (the Marinara RPG shape) and Messages (Marinara "Convo"). The cut is by where
   this project has an opinion — Campaign is already well done in Marinara and
   what we add is the substrate beneath it, while Messages is presentationally
   expensive for what it adds mechanically. Modes are specified as an *extension
   point* rather than a fixed feature set, so the 2.0 pair should need no change
   to the 1.0 schemas ([15 §0.2](15-work-plan.md)).
4. **Data objects that make sense for LLM workflows**, stored as files on disk,
   with character cards stored natively as cards — drag a folder out of the
   storage directory and you have exported it.

## Terminology used throughout

- **Actor** — the single card type. Personas and NPCs are flags/tags on an
  actor, not separate types.
- **Setting** — the reusable tone/framing object that *points at* world content
  rather than containing it.
- **Package** — a shareable bundle of actors, settings, lorebooks, presets and
  mode config; the "full game setup" export.
- **Session** — one running story/chat. Sessions are created *from* settings and
  packages by copy, and never hold a live link back to them.
- **Mode** — the thing that defines how a turn is built and what state it owns.
- **Channel** — a named, typed slice of session state owned by a mode or
  extension (HP, quests, clock, weather, relationship, …).
