# StoryEngine — Preliminary Design Notes

**Status: design exploration, with the load-bearing questions now answered.**
These are design notes, not documentation of what exists — see [../](../) for
that distinction, and treat anything here as intent rather than as a description
of the code. Where a document still says *proposal*, it is one; the decisions
that have since been settled are recorded as **RESOLVED** or **CONFIRMED** in
[25](25-open-questions.md), and the phase plans from
[P1](workplan/07-p1-implementation.md) through
[P7](workplan/23-p7-implementation.md) have been worked from rather than argued
with, each carrying its own record of what shipped.

**Phase: alpha, with Alpha 1 — the first tagged build, private and for the
project's own use — cut 2026-09-06 as `v1.0.0-alpha.1`**
([P6A](workplan/19-p6a-alpha-1.md)). See the [root README](../../README.md) for
what actually runs today, and [`CHANGELOG.md`](../../CHANGELOG.md) for what
that build says it is.

**[work plan §0](workplan/01-work-plan.md) is the only place the version cut is
stated.** It is not restated here, deliberately: this block used to carry a copy
and copies drift. In one line, 1.0 is the Play surface and the releases after it
add Write, then World, then Campaign.

Distribution, when there is something to distribute, is build-it-yourself until
beta — which is defined as *feature complete to the 1.0 spec*. See
[releases §0](workplan/04-repo-and-releases.md). The one build before that is
not a distribution, and [releases §0.1](workplan/04-repo-and-releases.md) is
the distinction.

**The first checkpoint is PLAYABLE** ([work plan §4.1](workplan/01-work-plan.md)) — well before
beta, and the point at which the design gets tested by use rather than completed
on paper.

These are working documents for a clean-sheet engine that takes the *feature
territory* of Aventuras, Marinara Engine and SillyTavern without inheriting
their accumulated structure. Infinite Worlds — closed-source, and in the same
genre as the Freeform and Campaign modes — is a fourth reference, surveyed in
[02](02-infinite-worlds.md). They are deliberately **not comprehensive**. They
record an initial set of positions on where StoryEngine should *diverge* from
the obvious approach — "port the three feature sets into one server" — and they
leave large areas untouched on purpose.

Where a document takes a position, it is a proposal to argue with, not a
decision. Open questions are collected in [25-open-questions.md](25-open-questions.md)
and also flagged inline as **[OPEN]**.

## Two folders, and how they are cited

**This folder is the design; [`workplan/`](workplan/) is the sequence for
building it.** The split is by what a document answers. Design documents answer
*what this is and why* — they change when a position changes. Work-plan
documents answer *what gets built, in what order, and what is left to do* — they
change as work lands, and several of them are worked from rather than argued
with. [24 — the feature list](24-roadmap.md) sits near the end of the design
side on purpose: it is where intent stops being design and starts pointing at
the mechanical lists next door. Only [25](25-open-questions.md) comes after it,
because that one is a ledger you consult rather than a document you read
through, and it is ordered by how expensive its questions are to answer late. It holds **no release commitments** — those are all
in [work plan §0](workplan/01-work-plan.md).

**Citations differ by folder, deliberately.** Design documents are cited by
number — `[03 §5]`, `[21 §1]`. Work-plan documents are cited by **name** —
`[P1 §1.3]`, `[work plan §4.1]`, `[triage §6.2]`, `[polish §4]`,
`[testing §2]`, `[releases §2]`.

**The reason is no longer that a bare `02` is ambiguous — it is that a work-plan
number is filing order and was never a citation key.** Nothing cites one, so
moving a work-plan document costs nothing. That is what makes the reading order
below maintainable rather than a claim that decays, and
[`tools/doc-links.test.ts`](../../tools/doc-links.test.ts) holds both halves: a
label opening with two digits must name the number of the file it links to, and
a work-plan target must be cited by a name from the registry. The convention was
stated here from the beginning and broken in 527 places before anything checked
it.

## Reading order

Numbers are the reading order within each folder, not the order the documents
were written in. **Start with 00, then 01, and keep going.**

That sentence was aspirational until 2026-09-09 and is now true. Before then the
numbers were allocation order — the next free integer at the moment of writing —
and this file said so twenty-five lines apart from claiming otherwise.

**Keeping it true has a cost, and the cost is paid by a script.** A note
inserted in the middle renumbers everything below it, which is only tolerable
because [`tools/renumber-docs.mjs`](../../tools/renumber-docs.mjs) does it and
the link checker proves it landed. **Do not add a note at the end to avoid the
renumber** — that is exactly how the previous ordering decayed, one honest
shortcut at a time.

### Start here

| Doc | What it covers |
|---|---|
| [00-stance.md](00-stance.md) | Design principles, and the specific legacy patterns being dropped |

### What we are building on

| Doc | What it covers |
|---|---|
| [01-source-survey.md](01-source-survey.md) | What Aventuras, Marinara and SillyTavern actually do |
| [02-infinite-worlds.md](02-infinite-worlds.md) | The fourth reference, and the authored-rules tier it exposes as missing |
| [workplan/02-triage.md](workplan/02-triage.md) | The base decision — standalone, not a fork — and per-subsystem verdicts: adopt, port, rebuild, discard, buy |

### The design

| Doc | What it covers |
|---|---|
| [03-data-model.md](03-data-model.md) | **Why** the objects are shaped as they are; storage on disk |
| [04-schemas.md](04-schemas.md) | **What** they are — definitions, and the stability boundary |
| [06-modes-and-turn-pipeline.md](06-modes-and-turn-pipeline.md) | The mode contract, the modes, channels, party, assembly, renditions |
| [07-branching.md](07-branching.md) | Branch anywhere: the effect log makes it a pointer, and summaries survive |
| [08-cross-session-memory.md](08-cross-session-memory.md) | Characters remembering you between sessions, as an auto-maintained lorebook |
| [09-server-multiuser-deployment.md](09-server-multiuser-deployment.md) | Server-authoritative generation, notifications, multi-user, LAN, packaging |
| [10-ui-surfaces.md](10-ui-surfaces.md) | Web-only client, density stance, home, library and play, the workbench panel, file access, editors |
| [11-lorebooks-as-a-format.md](11-lorebooks-as-a-format.md) | Why a lorebook is worth reading, browsing and searching in its own right — and why that costs no schema |
| [12-account-gallery.md](12-account-gallery.md) | The front door: a sign-in gallery as an opt-in arrival screen, the hide flag, account avatars |
| [13-write-mode.md](13-write-mode.md) | The Write surface and its two modes, Outline and Prose: the manuscript kind, beats, the binder layouts, and a third top-level surface |
| [14-writing-samples.md](14-writing-samples.md) | Prose pasted in as an exemplar of tone rather than a description of it — on actors, treatments and lorebooks |
| [15-world.md](15-world.md) | World: a grouping of sessions that share a continuity, and the story bible that says what one contains |
| [16-authoring.md](16-authoring.md) | The authoring tier: authored rules and lorebook extraction — turning what you played into what you can author with |
| [17-character-studio.md](17-character-studio.md) | The Character Studio: reference-set curation, structured descriptors and the consistency loop that makes a card produce the same person twice |
| [18-session-import.md](18-session-import.md) | Whether play history can be imported from the three surveyed sources, what it would cost, and the four things it asks of the session export format |
| [23-randomizers.md](23-randomizers.md) | Two agentic addons — a plot randomizer that draws an outcome before narration, and an appearance randomizer that draws descriptors before the model writes — and the eight things they ask of the design |
| [05-tagging.md](05-tagging.md) | Tagging: what a tag is now that lore can gate on one, and a registry that decorates names without owning them |

The table order **is** the numbering. Where a note reads beside an earlier one
rather than after it, its row says so.

**Three of these were promoted out of [24](24-roadmap.md)** when their subjects
acquired releases — [15](15-world.md), [16](16-authoring.md) and
[17](17-character-studio.md), the last of them twice. That is the pattern rather
than an accident: the feature list holds no release commitments, so anything
scheduled leaves it for a design note of its own.

### The technical ground

| Doc | What it covers |
|---|---|
| [19-tech-stack.md](19-tech-stack.md) | Language, runtime, framework, localisation, randomness, dev mode |
| [20-client-loading.md](20-client-loading.md) | Deferred client-loading options: expected bundle growth, route and tool boundaries, shared schemas, caching, and what to measure before acting |
| [21-internal-contracts.md](21-internal-contracts.md) | The types P2 is built against — the completed turn record, channel effects, provider capabilities, `config.json` |
| [22-extensions.md](22-extensions.md) | The extension boundary and interface: worker isolation, host API, storage |

### What comes after, and what is unresolved

| Doc | What it covers |
|---|---|
| [24-roadmap.md](24-roadmap.md) | The feature list — three priority tiers, no releases attached — plus desired extensions, hints for expansion authors |
| [25-open-questions.md](25-open-questions.md) | Every open decision, ordered by how expensive it is to answer late |

### Then the work plan

[`workplan/`](workplan/) has its own index. In reading order it is the work plan
itself, the triage the plan is built on, the phase documents — one per phase from
P1 to P11, plus P2A, P2B, P2C, P6A and P6B — the polish list, testing, the
release model, and the supplements the two manual phases carry.

~~The phase documents are numbered in the order they were written, so P2A, P2B
and P2C are 13, 14 and 15 rather than sitting between P2 and P3, P7 through P11
are 18 through 22, P6A is 23, and P6B is 24 with its findings log at 25. **26 is
the manual ledger**~~ ***That paragraph described the filing this file's own
renumber replaced, and outlived it by four days*** (corrected 2026-09-13). **The
work plan is in execution order too**: P7 through P11 are 23 through 27, P6A and
P6B are 19 and 20 with the PLAYABLE log at 21, and **05 is the manual ledger** —
every gate's walk state and every deferral with an owner, which 11 does for the
P2 phases and 05 does for the rest. *That this went stale at all is the argument
for the rule two paragraphs up: nothing cites a work-plan number, so moving one
costs nothing — and a sentence that **spells** the numbers out is the one place
that freedom has a price.*

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
   ([13](13-write-mode.md)); a Social surface is proposed and undefined
   ([24 §3.4](24-roadmap.md)). **Which release each lands in is
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
  handled here ([04 §6](04-schemas.md) records why the name changed from
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
  ([13 §5](13-write-mode.md)).
- **Beat** — a short instruction with a position in a manuscript. The Write
  mode's unit of input ([13 §7](13-write-mode.md)).
