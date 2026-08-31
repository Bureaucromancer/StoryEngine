# StoryEngine — Preliminary Design Notes

**Status: design exploration, with the load-bearing questions now answered.**
These are design notes, not documentation of what exists — see [../](../) for
that distinction, and treat anything here as intent rather than as a description
of the code. Where a document still says *proposal*, it is one; the decisions
that have since been settled are recorded as **RESOLVED** or **CONFIRMED** in
[06](06-open-questions.md), and [P1](workplan/03-p1-implementation.md) is a plan being
worked from rather than argued with.

**Phase: alpha** — see the [root README](../../README.md) for what actually runs
today.

**[work plan §0](workplan/01-work-plan.md) is the only place the version cut is
stated.** It is not restated here, deliberately: this block used to carry a copy
and copies drift. In one line, 1.0 is the Play surface and the releases after it
add Write, then World, then Campaign.

Distribution, when there is something to distribute, is build-it-yourself until
beta — which is defined as *feature complete to the 1.0 spec*. See
[releases §0](workplan/11-repo-and-releases.md).

**The first checkpoint is PLAYABLE** ([work plan §4.1](workplan/01-work-plan.md)) — well before
beta, and the point at which the design gets tested by use rather than completed
on paper.

These are working documents for a clean-sheet engine that takes the *feature
territory* of Aventuras, Marinara Engine and SillyTavern without inheriting
their accumulated structure. Infinite Worlds — closed-source, and in the same
genre as the Freeform and Campaign modes — is a fourth reference, surveyed in
[08](08-infinite-worlds.md). They are deliberately **not comprehensive**. They
record an initial set of positions on where StoryEngine should *diverge* from
the obvious approach — "port the three feature sets into one server" — and they
leave large areas untouched on purpose.

Where a document takes a position, it is a proposal to argue with, not a
decision. Open questions are collected in [06-open-questions.md](06-open-questions.md)
and also flagged inline as **[OPEN]**.

## Two folders, and how they are cited

**This folder is the design; [`workplan/`](workplan/) is the sequence for
building it.** The split is by what a document answers. Design documents answer
*what this is and why* — they change when a position changes. Work-plan
documents answer *what gets built, in what order, and what is left to do* — they
change as work lands, and several of them are worked from rather than argued
with. [14 — the feature list](14-roadmap.md) sits at the end of the design side
on purpose: it is where intent stops being design and starts pointing at the
mechanical lists next door. It holds **no release commitments** — those are all
in [work plan §0](workplan/01-work-plan.md).

**Citations differ by folder, deliberately.** Design documents are cited by
number — `[02 §5]`, `[13 §1]`. Work-plan documents are cited by **name** —
`[P1 §1.3]`, `[work plan §4.1]`, `[triage §6.2]`, `[polish §4]`,
`[testing §2]`, `[releases §2]` — because both folders number from `01` and a
bare `02` would otherwise mean two different documents.

## Reading order

Numbers are the reading order within each folder, not the order the documents
were written in. **Start with 00, then 01.**

### Start here

| Doc | What it covers |
|---|---|
| [00-stance.md](00-stance.md) | Design principles, and the specific legacy patterns being dropped |

### What we are building on

| Doc | What it covers |
|---|---|
| [01-source-survey.md](01-source-survey.md) | What Aventuras, Marinara and SillyTavern actually do |
| [08-infinite-worlds.md](08-infinite-worlds.md) | The fourth reference, and the authored-rules tier it exposes as missing |
| [workplan/02-triage.md](workplan/02-triage.md) | The base decision — standalone, not a fork — and per-subsystem verdicts: adopt, port, rebuild, discard, buy |

### The design

| Doc | What it covers |
|---|---|
| [02-data-model.md](02-data-model.md) | **Why** the objects are shaped as they are; storage on disk |
| [10-schemas.md](10-schemas.md) | **What** they are — definitions, and the stability boundary |
| [03-modes-and-turn-pipeline.md](03-modes-and-turn-pipeline.md) | The mode contract, the modes, channels, party, assembly, renditions |
| [09-branching.md](09-branching.md) | Branch anywhere: the effect log makes it a pointer, and summaries survive |
| [11-cross-session-memory.md](11-cross-session-memory.md) | Characters remembering you between sessions, as an auto-maintained lorebook |
| [04-server-multiuser-deployment.md](04-server-multiuser-deployment.md) | Server-authoritative generation, notifications, multi-user, LAN, packaging |
| [05-ui-surfaces.md](05-ui-surfaces.md) | Web-only client, density stance, home, library and play, the workbench panel, file access, editors |
| [16-lorebooks-as-a-format.md](16-lorebooks-as-a-format.md) | Why a lorebook is worth reading, browsing and searching in its own right — and why that costs no schema |
| [15-account-gallery.md](15-account-gallery.md) | The front door: a sign-in gallery as an opt-in arrival screen, the hide flag, account avatars |
| [17-write-mode.md](17-write-mode.md) | The Write surface and its two modes, Outline and Prose: the manuscript kind, beats, the binder layouts, and a third top-level surface |
| [18-writing-samples.md](18-writing-samples.md) | Prose pasted in as an exemplar of tone rather than a description of it — on actors, treatments and lorebooks |
| [19-world.md](19-world.md) | World: a grouping of sessions that share a continuity, and the story bible that says what one contains |
| [20-authoring.md](20-authoring.md) | The authoring tier: authored rules, lorebook extraction and the Character Studio — turning what you played into what you can author with |

15 through 20 sit after 14 by number only — the slots beneath them were taken
when they were written. 15 reads beside 04 and 05; 16 reads after 02 and 05,
whose lorebook and library sections it takes a position about and whose surfaces
carry the specifications; 17 reads after 03 and 05, whose mode contract it
extends and whose surface count it changes; 19 reads after 02 and 11, whose
session model and memory keying it widens; 20 reads after 03 and 08, whose
extensibility tiers it completes. Which is why they are all indexed here.

**19 and 20 were promoted out of [14](14-roadmap.md)** when their subjects
acquired releases. That is the pattern rather than an accident: the feature list
holds no release commitments, so anything scheduled leaves it for a design note
of its own.

### The technical ground

| Doc | What it covers |
|---|---|
| [07-tech-stack.md](07-tech-stack.md) | Language, runtime, framework, localisation, randomness, dev mode |
| [13-internal-contracts.md](13-internal-contracts.md) | The types P2 is built against — the completed turn record, channel effects, provider capabilities, `config.json` |
| [12-extensions.md](12-extensions.md) | The extension boundary and interface: worker isolation, host API, storage |

### What comes after, and what is unresolved

| Doc | What it covers |
|---|---|
| [14-roadmap.md](14-roadmap.md) | The feature list — three priority tiers, no releases attached — plus desired extensions, hints for expansion authors |
| [06-open-questions.md](06-open-questions.md) | Every open decision, ordered by how expensive it is to answer late |

### Then the work plan

[`workplan/`](workplan/) has its own index. In reading order it is the work plan
itself, the triage the plan is built on, the phase documents — one per phase from
P1 to P11, plus P2A, P2B and P2C — the polish list, testing, the release model,
and the P2C supplements. The phase documents are numbered in the order they were
written, so P2A, P2B and P2C are 13, 14 and 15 rather than sitting between P2 and
P3, and P7 through P11 are 18 through 22.

**02 and 10 are a pair.** 02 carries the reasoning and the alternatives
considered; 10 carries the definitions. Where they disagree, 10 is current.

**10 and 13 split by portability, not by importance.** 10 holds structures that
travel between installs and are therefore committed; 13 holds structures that
never leave and are free to migrate — but which everything is built against, so
they still have to exist before code does.

## The four commitments these documents are built around

1. **Natively multi-user.** Username/password access separation for a trusted
   LAN. Not a security boundary, and the docs say so plainly wherever it matters.
2. **Natively web-based, server-first.** The default install is a server
   expecting LAN connections. The browser is *the* client — no desktop app, no
   native mobile app — and it is a view onto server-side state, not the place
   generation happens. The only secondary interface is direct file access to the
   data directory, offered in-UI as a permission level.
3. **Surfaces own modes, and modes are an extension point rather than a fixed
   feature set.** Play holds Scene and Freeform at 1.0 and Campaign later; Write
   is a surface of its own holding Outline and Prose
   ([17](17-write-mode.md)); a Social surface is proposed and undefined
   ([14 §3.4](14-roadmap.md)). **Which release each lands in is
   [work plan §0](workplan/01-work-plan.md)'s to say, not this file's.** What is
   a commitment rather than a schedule is the consequence: a later release should
   need no change to the 1.0 portable schemas
   ([work plan §0.2](workplan/01-work-plan.md)) — and **Write is the real test of
   that claim**, because it is the first thing that needs the contract to grow
   rather than to be configured.
4. **Data objects that make sense for LLM workflows**, stored as files on disk,
   with character cards stored natively as cards — drag a folder out of the
   storage directory and you have exported it.

## Terminology used throughout

- **Actor** — the single card type. Personas and NPCs are flags/tags on an
  actor, not separate types.
- **Treatment** — the reusable tone/framing object that *points at* world content
  rather than containing it. A lorebook is the world; a treatment is how it is
  handled here ([10 §6](10-schemas.md) records why the name changed from
  *Setting*).
- **Package** — a shareable bundle of actors, treatments, lorebooks, presets and
  mode config; the "full game setup" export.
- **Session** — one running story/chat. Sessions are created *from* treatments and
  packages by copy, and never hold a live link back to them.
- **Mode** — the thing that defines how a turn is built and what state it owns.
- **Channel** — a named, typed slice of session state owned by a mode or
  extension (HP, quests, clock, weather, relationship, …).
- **Manuscript** — the long-form artefact: a binder of nodes, with the prose in
  Markdown files beside it. A library kind, and internal tier
  ([17 §5](17-write-mode.md)).
- **Beat** — a short instruction with a position in a manuscript. The Write
  mode's unit of input ([17 §7](17-write-mode.md)).
