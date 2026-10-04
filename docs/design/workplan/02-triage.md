# 02 — Triage: adopt, port, rebuild, discard

**Status: proposal.** A per-subsystem verdict on all three sources. Read
[01-source-survey.md](../01-source-survey.md) first for what each thing *is*; this
document is about what to *do* with it.

---

## 1. The license gate — DECIDED: StoryEngine is AGPL-3.0

**Decision (2026-08-09): StoryEngine is licensed AGPL-3.0**, matching all three
sources. `LICENSE` in the repository root is the verbatim FSF text. The rest of
this section records what that settles and what it newly raises.

**Settled:**

- **Code may be lifted from any of the three**, licence-wise. The ADOPT verdicts
  in §5 are live. Attribution and the original copyright notices must be
  preserved on anything taken.
- **AGPL §13 applies to us.** StoryEngine is a multi-user server reached over a
  network, which is precisely the case §13 exists for: users interacting with it
  remotely must be offered the corresponding source. In practice a "Source" link
  in the UI footer resolving to the repository, plus the ability to serve the
  exact running version. **This is a 1.0 requirement, not a nicety** — see
  [09 §8](../09-server-multiuser-deployment.md).
- **Dependencies must be AGPL-compatible.** Permissive licences (MIT, Apache-2.0,
  BSD, ISC) are fine and cover everything on the BUY list in §7. Watch for
  SSPL, BUSL, "source-available", and non-commercial terms, which are not.
- **User content is not affected.** Actors, treatments, lorebooks, packages and
  sessions are data produced *by* the program, not derivative works *of* it.
  Nobody's characters become AGPL by being authored in StoryEngine. Worth saying
  plainly somewhere user-facing, because this is a common and reasonable worry.

**Newly raised, and time-sensitive — see §1.1.**

### 1.1 Extensions are AGPL too — DECIDED

**Decision (2026-08-09): code extensions and modes must be AGPL-3.0. No linking
exception.**

The reasoning is about community dynamics rather than law: the friction of
telling extension authors they must be copyleft is smaller and more recoverable
than the damage done when a copyleft project is perceived to be closing things
down. That failure mode is well-attested in this ecosystem and it is not worth
courting to enable a proprietary-extension case nobody has asked for.

**What this settles:**

- **No linking exception, so no deadline.** An exception can only be granted by
  the copyright holders, which made it a decide-before-the-first-outside-PR
  question. Declining it removes that time bomb entirely.
- **[26 A1](../26-open-questions.md) is now purely technical again.** The extension
  execution model — in-process modules versus sandboxed workers — was carrying a
  licensing dimension it no longer has. Decide it on safety, blast radius and
  API ergonomics alone. In-process is licence-viable, which is the simpler
  starting point.
- **The SDK package must itself be AGPL**, deliberately. This is the mechanism
  by which the decision actually holds: extensions import `sdk`, so `sdk`'s
  licence is what makes them combined works. Publishing it permissively "to be
  friendly" would quietly undo the decision. See [20 §10](../20-tech-stack.md).
- **Extension manifests should declare a licence field**, surfaced by the
  installer. Not enforcement — legibility. It makes the expectation visible at
  the point of authoring and lets a user see what they are installing.

### 1.2 The line that must stay crisp: code is AGPL, content is not

This decision makes one distinction load-bearing, and getting it wrong would
produce exactly the perception the decision exists to avoid.

| Kind | Licence |
|---|---|
| Code extensions and modes (import the SDK, run in our process) | **AGPL-3.0, required** |
| Actors, lorebooks, treatments, presets, sessions | **The author's own. Any licence, including none.** |
| Packages — including their **authored rules** ([02 §2](../02-infinite-worlds.md)) | **The author's own.** |

Rules are the case worth being explicit about, because they *look* like code.
They are not: a rule is a term in a closed vocabulary that our evaluator
interprets, no different in kind from a lorebook entry's activation settings. A
package full of rules is authored content and its author licenses it however
they like — or not at all.

This has a pleasant consequence. The authored-rules tier is not merely an
expressiveness feature, it is also **the escape hatch for anyone who wants to
ship something they control**: build it as a package of rules and content rather
than as a code extension, and the copyleft question never arises. That makes
[02](../02-infinite-worlds.md)'s third tier more valuable under this decision than
it was before it, and it is worth saying so publicly rather than leaving people
to discover it.

Both halves of the table belong somewhere user-facing — the About surface in
[09 §7](../09-server-multiuser-deployment.md) is the natural home.

---

## 1.2 Background: what the licences were

Retained because it explains why the verdicts below are shaped as they are.

**All three sources are AGPL-3.0.**

| Project | License | Also |
|---|---|---|
| SillyTavern | AGPL-3.0 | — |
| Aventuras | AGPL-3.0 | — |
| Marinara Engine | AGPL-3.0 | Separate trademark/branding policy (`TRADEMARKS.md`) |

Matching them was the decision with the fewest consequences, and it is
effectively one-way in any case: once AGPL code is in the tree, moving to a
permissive licence would mean rewriting the affected parts and proving you did.

Marinara's separate trademark policy is worth one note: it governs the *name*
and branding, not the code, and it explicitly permits truthful descriptive
references. Nothing in this project needs Marinara's marks, so it only matters
if StoryEngine ever describes itself in terms of them.

**What was never restricted, regardless of licence.** Copyright covers
expression, not interoperability. These would have been fair game even under a
permissive licence, and they are where most of the value sits:

- **File and data formats** — Character Card V2/V3, the `chara`/`ccv3` PNG chunk
  convention, CHARX, ST's World Info JSON, ST's chat JSONL, lorebook exports.
  Reading and writing them is interoperability.
- **Observable behaviour and semantics** — what "selective AND_ALL with
  secondary keys" means, the order entries are trimmed in, what `sticky` does.
- **Documented parameters and defaults** — scan depth 2, token budget 2048,
  entry limit 100.
- **Architectural ideas** — everything in [00](../00-stance.md) and
  [06](../06-modes-and-turn-pipeline.md).

The practical consequence: **the specification is free, the implementation is
not.** Most of the value in these three codebases is specification — which is
why §2 argues the licence question turned out to be low-stakes either way.

---

## 2. Why the lift value is lower than it looks

Worth stating before the table, because it changes the shape of the answer.

Measured source sizes:

| | Files | Lines |
|---|---:|---:|
| Marinara `packages/` | 1,250 | ~494k |
| SillyTavern `public/scripts/` | 202 | ~133k |
| Aventuras `src/` | 589 | ~124k |
| SillyTavern `src/` | 97 | ~33k |

*Re-measured 2026-08-18 in §2A.2: Marinara's `packages/*/src` alone is now ~518k
lines across 1,294 files. The growth in between — roughly this entire codebase,
in nine days — is one of the four measurements that decided §2A.*

Nearly a million lines, and very little of it is usefully liftable — because
**the code worth having is the code most entangled with what we are discarding.**

- Marinara's prompt assembler is genuinely sophisticated, and it assembles V2
  cards plus `CharacterExtensions` against `GameSetupConfig` through its own DB
  layer. All three of those are on the discard list.
- Aventuras' retrieval is the best memory implementation of the three, and it is
  written against `Entry` / `Character` / `Chapter` with Svelte 5 runes stores
  and a single-user database module.
- SillyTavern's world-info logic is the most battle-tested keyword matcher in
  existence, and it lives in a 6,289-line browser module operating on globals.

The pieces that *are* cleanly liftable are small, self-contained utilities — and
being small, they are also the cheapest to rewrite. That is an unusual and
convenient alignment: **the licence question was low-stakes either way**,
because the honest lift list is a few hundred lines. Going AGPL (§1) makes those
few hundred lines available; it did not unlock a shortcut of any consequence,
and no plan below should be built on the assumption that it did.

---

## 2A. Build versus fork — DECIDED: standalone

**Decision (2026-08-18): StoryEngine is built standalone.**

The question — *is a Marinara fork, rebuilt where this design disagrees and
borrowing from Aventuras along the way, a better route to the same objectives?* —
is a reasonable one, was never written down anywhere, and will be asked again.
Most plausibly at the low point somewhere in P7, when the spine is finished and
the breadth is not. This section exists so that it gets answered from
measurements rather than from mood.

Numbered `2A` rather than inserted as a new §3 because §4 through §9 are cited by
number from four other documents. [P2A](09-p2a-configuration-surface.md) sets the
precedent for inserting without renumbering.

Three framings were considered. The third is the one that keeps coming back, and
§2A.3 admits it rather than pretending the first two exhaust the space.

| | The proposal |
|---|---|
| **Fork** | Base on Marinara, rebuild what this design disagrees with, port from Aventuras along the way |
| **Contribute** | Drop the structural argument entirely; push Freeform mode and the treatment/scenario/plot-thread material into Marinara as PRs |
| **Standalone** | §4's verdicts: take the specifications, write the code |

### 2A.1 The fork, at full strength

Recorded properly, because a decision argued against a weak version of the
alternative is worth nothing.

Marinara is structurally the closest of the three to what this project wants to
be: a pnpm monorepo, Node/TypeScript server, React client, and — the part
[00 §2.9](../00-stance.md) does not credit it for, because that complaint is
SillyTavern's — **generation already server-side**, under `services/generation/`
and `routes/generate/`. It ships three modes, nine providers, keyword-scanned
lorebooks, card/lorebook/preset import, a setup wizard, capability packages, and
Docker/Windows/Android packaging. It has a team, CI and a release cadence. A fork
starts playable on day one, and the effort goes into the parts this project has
an opinion about instead of into re-deriving the parts it does not.

That is a genuine offer, and it is why this section is long.

### 2A.2 Four measurements that decide it

**1. There is no user model to fork.** Marinara's entire auth surface is
`packages/server/src/middleware/basic-auth.ts` — one `BASIC_AUTH_USER` /
`BASIC_AUTH_PASS` pair from the environment, plus an IP allowlist and host
validation. There is no `users`, `accounts` or `sessions` table among the 32 in
`packages/server/src/db/schema/`. Every row in the install belongs to the
install. Commitment 1 of these documents is *natively multi-user*
([09 §4](../09-server-multiuser-deployment.md)), and that is not a feature to be
added: it is an ownership dimension running through every table, route, query and
client store. [Work plan §2.2](01-work-plan.md) already priced this exact shape of
mistake — a stub identity threaded through every route and later torn out is
every route written twice. A fork commits to that at 518k-line scale before the
first commit.

**2. The storage model is the inverse of the thesis.** `db/file-backed-store.ts`
is file-native in the sense that a relational store is *persisted* as JSON table
snapshots — `storage/tables/<table>.json`, sharded per chat for some tables —
behind an in-memory index, a query layer with unique constraints, and a
`STORAGE_VERSION` migration chain. It is a database that writes JSON, which is a
respectable design and is not [00 §3.4](../00-stance.md)'s *drag a folder out of
the storage directory and you have exported it*. Replacing it means replacing the
persistence layer under every service in the tree.

**3. There is no test suite underneath the demolition.** A search for
`*.test.ts` under `packages/` returns **zero** across ~518k lines; the
repository's own `CLAUDE.md` says as much. What exists is one Playwright file
(`e2e/core-flows.e2e.ts`) and a set of `scripts/check-*.mjs` regression guards.
The fork plan is *replace the ownership model, the storage layer and the
assembler* — the three most load-bearing subsystems — in a codebase with no unit
tests beneath any of them. Set against [testing §2](03-testing.md)'s stance that a
claim nobody can break the build over is not a claim, this is the least
defensible risk profile of the three options, and it is the measurement that
would decide this section on its own.

*~~There is no test suite~~ — **withdrawn**, by
[the 2026-09-16 review](../../reviews/2026-09-16-storyengine-marinara.md) and
recorded here 2026-10-03, before the repository went public. The filename count
was literally true and its reading was wrong: Marinara's tests are not named
`*.test.ts`. At that review's snapshot it had 282 behavioural regression files
under `scripts/regressions/`, 37 browser test files under `e2e/`, and CI that
runs them. The decision this section supports does not rest on point 3 alone,
and points 1, 2 and 4 are unaffected; but a measurement this document said
"would decide this section on its own" decided nothing, and it is struck rather
than left to stand as a description of somebody else's project. The same goes
for "untested" in point 4.*

**4. The upstream can be neither tracked nor caught.** In the nine days from this
project's first commit to this decision, Marinara made **712 commits** to
StoryEngine's 149, changing 698 files under `packages/` for +56k/−16k — a net
gain, in nine days, of roughly the entire size of this codebase. A fork therefore
has two exits and both are bad: track upstream while restructuring its
foundations, which is a permanent merge war against a mainline moving five times
faster; or stop tracking, and own half a million lines of ~~untested~~ code somebody
else wrote — including the whole of §6.3's discard list, which does not stop
being maintained just because it is unwanted.

Measured 2026-08-18. TS/TSX under `packages/*/src`, and `src/` for Aventuras:

| | StoryEngine | Marinara | Aventuras |
|---|---:|---:|---:|
| Lines | ~40k | ~518k | ~133k |
| Unit test files / lines | 64 / 18.5k | **0 / 0** | 80 / 14.3k |
| Commits, 08-09 → 08-18 | 149 | 712 | 10 |
| User model | accounts since P1 | none | none |
| Storage | folder per object | JSON table snapshots | local database |

### 2A.2a What the velocity measurement does to the usual argument

The standard case for forking is *the rebuild takes years and the fork runs
today*. That premise is measurably false here, and it is worth saying why rather
than letting the numbers imply it.

Nine days from `Initial commit` produced the storage spine with its watcher and
derived index, accounts with scrypt and sessions, the library API, an actor
editor with version history and a conflict refusal, the provider layer, the RNG
service and its tape, assembler → budgeter → render, the complete turn record,
resumable server-side turn jobs with SSE reattach, a Scene mode written as data,
and a play surface. P2 is through its exit gate and
[P2A](09-p2a-configuration-surface.md) is landing. PLAYABLE
([work plan §4.1](01-work-plan.md)) is two phases out, and P3 is a *reader* over a
record that already exists.

At that rate the standalone build reaches a defensible product before a fork
finishes its demolition phase. This is the measurement most likely to change —
see §2A.5.

### 2A.3 The third framing, admitted: contribute instead of building

There is a cheaper framing than either, and it deserves recording because it is
not obviously wrong: **drop the structural argument entirely.** Do not fork, do
not rebuild. Take the two things this project actually wants that Marinara lacks
— a Freeform mode, and the treatment / scenario / plot-thread material — and push
them upstream as pull requests. Marinara keeps its maintainers, its release
cadence and its users; the ideas land where the users already are; nobody
retrofits multi-user into anything.

It is the only framing whose cost is bounded, and the only one that does not
require agreeing with [00](../00-stance.md) at all. Three things stop it.

**It is still a hard upstreaming problem, and the hardness is structural rather
than social.** Outside contributors need an approving review from a single named
owner in addition to the automated gates; the contribution guide asks for an
issue first *"so we can agree on direction, scope"*, and asks that PRs stay
focused and small. Those are good policies. They are also precisely the policies
under which a fourth chat mode and a re-shaped treatment object are not features
but *direction* — and `ChatMode = "conversation" | "roleplay" | "game"` is a
closed union baked into three tables, with a `retired-chat-mode-migration.ts`
recording that the maintainers' demonstrated instinct is to *retire* a mode
(`visual_novel` → `roleplay`) rather than accumulate one.

**It concedes the unified actor, which is not a detail.** Marinara keeps
`Character` and `Persona` as separate types (`types/persona.ts`,
`services/personas/persona-projector.ts`, plus `PersonaCardSnapshot`,
`PersonaCardVersion` and `PersonaGroup` in `types/character.ts`). This project's
terminology entry is one sentence — *personas and NPCs are flags on an actor, not
separate types* — and [03 §2](../03-data-model.md) builds on it. Unifying two card
types in a shipping product is a data migration, a UI reorganisation and a
compatibility break for every existing install, which is not a PR anyone should
accept from a contributor and not one worth asking for. So the framing that
promises to skip the structural work turns out to skip precisely the structural
thing most wanted.

**And the release cadence is hostile to it — with direct evidence.**
[01 §1](../01-source-survey.md) calls the `feat/scenarios` design work *"the single
most valuable artefact in any of the three repos"*: four planning documents
carrying the prefill-not-binding principle, the narrative/production seam, and the
§3.3 reframe making Setting first-class. As of 2026-08-18 that branch is **gone
from the remote**, and no scenario or setting type or table exists in the tree.
The design this framing proposes to contribute is a design Marinara already had,
written by its own people, which did not survive contact with 712 commits of other
work. A long-running outside feature branch would fare worse, not better.

*Amended 2026-08-29, and the argument is unaffected:* gone from the remote is not
gone. A local checkout at `a5b72ef91b8867c2e3bff547ad25d1df2f0eb8c6` (2026-08-04)
still carries `types/scenario.ts` and the four planning documents, and
[01 §1](../01-source-survey.md) now records where. That makes the artefact
readable — which matters for P4 and for [03 §3](../03-data-model.md)'s
borrowings — and changes nothing about the cadence: the point was never that the
files were unrecoverable, but that the work did not survive in the tree people
actually run.

**The honest form of the objection, kept because it is the strongest thing here:**
this framing optimises a different objective. It asks *how do these ideas reach
users soonest*, and the answer to that question really might be Marinara. It does
not ask, and cannot answer, *does the engine [00 §1](../00-stance.md) describes
exist* — because a turn that persists, displays, diffs and replays exactly what
was sent is not a feature to be added to a mega-string assembler; it is the thing
the assembler would have to stop being. Choosing standalone is choosing the second
question. That is a preference about what to spend years on, and it should be
stated as one rather than dressed up as a refutation.

### 2A.4 What this decision does not settle

**It is not a decision to write everything from scratch.** §4's PORT verdicts are
unaffected and, if anything, worth more now than when they were written. §2 priced
the lift honestly for *code* — the good parts are entangled with what is being
discarded, and that remains true. What has changed is the cost of a PORT, which
was implicitly priced at hand-reimplementation: re-expressing 4,666 lines of
import edge cases, or a keyword scanner's activation semantics, against a new
model is materially cheaper at this project's demonstrated working rate than it
was when §2 was written. The conclusion does not flip — it sharpens. **Take the
specifications harder**, particularly P4's import, P5's activation semantics, and
Marinara's `scripts/regressions/` pattern (§4, Platform).

**Marinara is worth more as a corpus than as a codebase.** It is the best
available generator of realistic import fixtures for P4 and the most useful
behavioural oracle for P5 — a use that costs nothing, requires no coordination,
and survives their next five thousand commits.

**Nothing here revises a §4 verdict.** This section is about the base, not the
parts.

### 2A.5 What would reopen it

Recorded so that reopening is a judgement against conditions rather than a mood on
a bad week:

- **The velocity measurement is the load-bearing one, and it is the one most
  likely to change.** §2A.2a's argument rests on a nine-day sample from a single
  developer. If the sustained rate through P5–P7 falls far enough that 1.0 stops
  being reachable, the *contribute* framing of §2A.3 — never the fork — becomes
  the serious alternative, because it is the one that does not require the rate.
- **If Marinara grows a real user model and folder-native object storage on its
  own**, two of §2A.2's four measurements disappear and the third framing gets
  materially cheaper. Worth re-checking; not worth waiting for.
- **If PLAYABLE ([work plan §4.1](01-work-plan.md)) falsifies the core
  hypotheses** — the record is not legible, one budgeter over everything is not
  comprehensible — then the thing being built is not the thing these documents
  describe, and the question stops being fork-versus-build and becomes what to
  build instead.

Nothing in §2A.2 is expected to change: an upstream does not shrink, and a test
suite absent across 518k lines does not appear.

---

## 3. Verdict vocabulary

| Verdict | Meaning |
|---|---|
| **ADOPT** | Take the code, licence permitting. Small, self-contained, hard to improve on. |
| **PORT** | Take the behaviour, tuning or algorithm; reimplement against our model. The spec is the asset. |
| **REBUILD** | The concept is right, the implementation is not. Design fresh from the requirement. |
| **DISCARD** | Do not build this. Either it solves a problem we don't have, or it belongs to an extension. |
| **BUY** | Don't build it at all — use a dependency. |

---

## 4. Master triage

### Data and formats

| Subsystem | Best source | Verdict | Note |
|---|---|---|---|
| PNG card chunk read/write | ST `character-card-parser.js` | **ADOPT/BUY** | ~120 lines over two npm packages. Technique matters more than code: splice chunks, never re-encode pixels. |
| Card V2/V3 + CHARX import | ST + Marinara `st-character.importer.ts` (869 ln) | **PORT** | The edge cases are the asset, not the code. |
| ST lorebook / chat / preset import | Marinara `import/` (4,666 ln at `34442e26d`) | **PORT** | The single largest body of "someone already found the edge cases" in any of the three. `st-bulk.importer.ts` (841 ln) is a folder scan of an ST user tree — direct prior art for P4's sweep. |
| ST chat-completion **prompt manager** — `prompts[]` + `prompt_order[]` | ST `public/scripts/PromptManager.js`, `openai.js` | **PORT the model, rebuild the code** | The closest prior art to our block assembler, and it independently arrived at the slot-versus-text split we need ([04 §8.1](../04-schemas.md)). Its `prompts[]` already separates `marker: true` placeholders from authored `content`. The conversion path is mostly renaming ([04 §8.4](../04-schemas.md)). |
| ST preset `sensitiveFields` handling | ST `openai.js` | **REBUILD, harder** | ST detects proxy URLs and passwords in presets on import *and* export, and offers to strip them — with "Import as-is" among the options. Ours drops them unconditionally, because `Preset` has nowhere to put them ([04 §8.4.4](../04-schemas.md)). |
| Instruct / context / reasoning presets | ST | **DISCARD** | Raw-completion plumbing ([00 §2.2](../00-stance.md)) and reasoning-block parsing nothing consumes at 1.0. |
| Text-completion sampler presets | ST `presets/textgen/` | **PARTIAL** | Converts to `params` only; most fields are backend-specific samplers with no chat-API equivalent. Report the ratio rather than implying fidelity. |
| Character card *format* | all three | **REBUILD** | [03 §2](../03-data-model.md). |
| Lorebook entry model | Marinara `types/lorebook.ts` | **PORT ~intact** | [03 §3](../03-data-model.md). Four scoped changes only. |
| Scenario / treatment object | Marinara `feat/scenarios` | **PORT the design** | The design plans are worth more than the code; adopt their §3.3 deferred reframe. |
| Pack / preset bundle | Aventuras `services/packs/` | **PORT** | Especially the `contentHash`/`baselineHash` update mechanism. |
| Avatar crop as normalised source rect | Marinara `types/avatar-crop.ts` | **PORT** | Coordinates in 0..1 survive resize/re-encode; the render-only legacy variant is a good format-migration pattern. [10 §11.3](../10-ui-surfaces.md) |
| Per-field generation provenance | Marinara `GeneratedFieldProvenance` | **PORT, widened** | Scenario-only upstream; applies to every authored kind here. [10 §11.2](../10-ui-surfaces.md) |
| Structured `VisualDescriptors` | Aventuras `types/index.ts` | **PORT** | face/hair/eyes/build/clothing/accessories/distinguishing. Prose appearance is for the narrator; this is for image pipelines. [03 §2.1](../03-data-model.md) |
| Media embedded in the card, with typed roles | — *none of the three* | **NEW** | V2/V3 caps a card at one picture, which is why every tool bolts sprites on the side. [03 §5.2.2](../03-data-model.md) |
| Branching | Aventuras COW+tombstones vs Marinara pointer | **REBUILD** — *verdict revised, see [07 §8](../07-branching.md)* | Aventuras' is the better engineering and the wrong fit: COW exists to branch mutable rows, which we don't have. Take Marinara's UX, derive state from the effect log. |
| `PersistentRetryState` | Aventuras | **DISCARD** | Hand-maintained undo snapshot; replaced by reversible effects. |
| Per-field `translated*` columns | Aventuras | **DISCARD** | [01 §2](../01-source-survey.md). |
| `GameSetupConfig` | Marinara | **REBUILD** | ~70 fields mixing narrative and production. |
| Per-user directory islands | ST `USER_DIRECTORY_TEMPLATE` | **REBUILD** | Layout idea yes; isolation model no ([09 §4.3](../09-server-multiuser-deployment.md)). |
| Four backend treatments dirs | ST | **DISCARD** | Completion-era fossil. |

### Retrieval and context

| Subsystem | Best source | Verdict | Note |
|---|---|---|---|
| Keyword matching semantics | Marinara `keyword-scanner.ts` / ST `world-info.js` | **PORT** | Behaviour spec. Marinara's is ST's superset and better organised. |
| Regex ReDoS guard | Marinara `regex-timeout.ts` (~60 ln) | **ADOPT** | See §5.1 — the strongest single lift candidate in all three repos. |
| Two-tier token budget + trim order + skip reporting | Marinara | **PORT** | Already the budgeter [00 §2.6](../00-stance.md) argues for. |
| Tiered retrieval (always / keyword / LLM-select) | Aventuras `EntryRetrievalService` | **PORT** | Best memory design of the three; Retrieval tiers pair with the rolling summary ([26 E1](../26-open-questions.md)). |
| Stickiness tuning constants | Aventuras `STICKINESS_BY_TYPE` | **PORT** | See §5.2 — empirical tuning is the asset. |
| Chapter summarisation + batching | Aventuras `ChapterBatchPlanner/Service` | **PORT** | Unexamined in detail; flagged as the next design doc. |
| Agentic retrieval (tool-driven search) | Aventuras `AgenticRetrievalService` | **REBUILD** | Right idea; ours is a pipeline step ([06 §6](../06-modes-and-turn-pipeline.md)). |
| Prompt assembly | Marinara `assembler.ts` + `marker-expander.ts` | **REBUILD** | The central thing we are redesigning. |
| Macro system | ST `macros.js` | **DISCARD** | See §6.1. |
| Instruct / context templates | ST | **DISCARD** | [00 §2.2](../00-stance.md). |
| Tokenizers | ST `src/tokenizers/` + 9 bundled model files | **BUY/DISCARD** | See §7. |
| Embedding backends (9 providers) | ST `src/vectors/` | **BUY** | See §7. |

### Modes and gameplay

| Subsystem | Best source | Verdict | Note |
|---|---|---|---|
| Three-mode concept | Marinara `ChatMode` | **PORT** | The organising idea. |
| `GroupChatMode: merged \| individual` | Marinara | **PORT** | Split into two axes ([06 §3](../06-modes-and-turn-pipeline.md)). |
| Group activation strategies | ST `group_activation_strategy` | **PORT** | Taxonomy yes; card-swapping implementation no. |
| Group generation by card swap | ST `group_generation_mode.SWAP` | **DISCARD** | [00 §2.10](../00-stance.md). |
| Conversation feature set | Marinara | **PORT** | Presence, schedules, autonomous messages, reactions, profiles, gated commands. |
| Adventure/RPG systems | Marinara Game Mode | **REBUILD as channels** | [06 §4](../06-modes-and-turn-pipeline.md). |
| Typed input (do/say/story) + chapters | Aventuras | **PORT** | The Freeform preset. |
| Duplicated RP-vs-Game combat & HUD | Marinara | **DISCARD one of each** | [00 §2.7](../00-stance.md). |
| Big-bang world gen + Repair JSON modal | Marinara | **DISCARD the mechanism** | [00 §2.3](../00-stance.md). |
| Hidden GM state / Secret Plot | Marinara | **PORT as a channel** | Generalises to all modes for free. |
| Setup snapshot | Marinara | **PORT, strengthened** | Becomes a real `Setup` object emitted from a running session, not a text file ([04 §7](../04-schemas.md)). |
| Seed → expand → edit → accept | Aventuras wizard | **PORT** | The right interaction for authoring. |
| **Card version history** | Marinara `characters.storage.ts`, `CharacterCardVersion` | **PORT, generalised** | Automatic snapshot-on-change, no-op suppression, the replaced state's own timestamp, and non-destructive restore are all the non-obvious choice and all correct. Widened from two card types to every library object, and moved from a database table to files in the object's folder ([03 §11](../03-data-model.md)). Add a retention cap, which Marinara lacks. |
| Character panel with active/inactive/dead | Aventuras | **PORT, corrected** | The state tracking is the valuable part. Split the one enum into presence and status channels, and make the panel *editable* so it repairs identity errors rather than only reporting them ([10 §13.2](../10-ui-surfaces.md)). |
| NPC identity resolution | Aventuras | **REBUILD** | Splits one character into several and merges several into one — notably worse at it than the models are. Ours proposes rather than auto-materialising, and surfaces its conclusions as linked mentions ([10 §13.1](../10-ui-surfaces.md)). |
| Table games, Spotify, haptics, calls, Echo Chamber, storyboards | Marinara | **DISCARD from core** | Must be *expressible* as extensions; none ship. The storyboard *surface* is what is discarded — the planner call under it, which decides how many moments of a turn deserve a picture, is taken and rebuilt ([06 §10.4](../06-modes-and-turn-pipeline.md)). A judgement about one turn is not an anime-episode director; the difference is the surface. |
| Noodle (in-app social timeline) | Marinara | **DISCARD from core**; carryover **PORT as a general pattern** | The feed is a skin. Ambient off-screen activity feeding context both ways is the reusable idea. [25 §4.6](../25-roadmap.md) |

### Platform

| Subsystem | Best source | Verdict | Note |
|---|---|---|---|
| Multi-user auth (scrypt, cookies, CSRF, admin flag) | ST `users.js` | **PORT** | Shape is right; ~200 lines of standard practice. |
| Header-SSO behind `trustedProxies` | ST `users.js` | **PORT** | Directly reusable for Tailscale ([09 §5.2](../09-server-multiuser-deployment.md)). |
| Provider adapters | Marinara (9) / Aventuras (AI SDK) | **BUY** | Aventuras already made this call correctly. |
| Generation pipeline phases | Aventuras `services/generation/phases/` | **PORT the structure** | Closest thing to our turn pipeline. |
| Agent/step execution | Marinara `agents/agent-executor.ts` etc. | **REBUILD** | Unify agent and pipeline step. |
| Extension capability API | Marinara `CapabilityRuntime` | **PORT the design** | Including its typed-union instinct. |
| Baked-in assistant | Marinara Professor Mari | **PORT the shape, REBUILD on sessions** | Suggestion chips and change-review are worth taking directly. [06 §7.4](../06-modes-and-turn-pipeline.md) |
| Assistant shell/filesystem tools (`bash`, `write`, shell sandbox) | Marinara | **DISCARD** | A coding-agent tool surface. On a multi-user LAN server it is privilege escalation wearing a friendly hat. Domain tools only. |
| Folder-package export | Marinara `folder-packages/` | **PORT** | Good shape for our `.sepack`. |
| Browser-side orchestration | ST | **DISCARD** | [00 §2.9](../00-stance.md). |
| Desktop/mobile shells | Aventuras Tauri, Marinara `.exe`/Android | **DISCARD** | [10 §1](../10-ui-surfaces.md). |
| In-editor field assist (generate / refine-with-guidance / revert) | Aventuras wizard | **PORT, widened** | Wizard-only upstream; becomes a primitive every editor is built from. [10 §11.1](../10-ui-surfaces.md) |
| In-UI image crop and generate on any image slot | Marinara | **PORT, widened** | Available wherever an image appears, not only avatars. |
| Regression-script pattern | Marinara `scripts/regressions/` | **PORT** | Especially `context-fit`. |

---

## 5. The genuine ADOPT list

The honest total is a few hundred lines. Both items are licence-encumbered, and
both are cheap enough to reimplement that the encumbrance barely matters.

### 5.1 Regex execution timeout

`Marinara-Engine/packages/server/src/services/lorebook/regex-timeout.ts`, ~60
lines. Lorebook entries accept user-authored regex keys. A static ReDoS check
catches common shapes; expert-crafted patterns still get through. This runs
`regex.test` inside a fresh `node:vm` context with a hard timeout, because V8
inserts interrupt checks during regex execution, so catastrophic backtracking
aborts instead of stalling the event loop.

Two details that make it worth citing rather than reinventing:

- It **recompiles the pattern inside the vm** so the interrupt check is wired
  through that isolate's regex engine. Passing the compiled `RegExp` in would
  not work, and that is not obvious.
- On timeout it **deliberately does not fall back to literal substring
  matching**, because the pattern may legitimately match on simpler input and
  substituting different semantics would cause silent surprise matches. It logs
  the pattern source so the author can see why their entry stopped firing.

This is exactly the kind of thing that is obvious in hindsight and expensive to
arrive at. In a multi-user server it also stops being a robustness nicety and
becomes a shared-resource concern: one user's bad regex should not stall
everyone's turns.

### 5.2 Stickiness tuning

`Aventuras/src/lib/services/ai/retrieval/EntryRetrievalService.ts`:

```ts
STICKINESS_BY_TYPE = { concept: 10, faction: 8, character: 6,
                       location: 6, event: 4, item: 6 }
```

Numbers, not code — so this is a PORT, and free of licence questions. The value
is that someone played with these until they felt right. Rediscovering them costs
weeks of play-testing.

The accompanying comment is more valuable than the constants: the timer is
deliberately *not* refreshed while an entry is sticky, so an entry named every
single turn still drops out when its window expires and is re-matched the turn
after. That is a hard ceiling on continuous presence rather than a sliding
window — a deliberate choice, made to stop a once-relevant entry pinning itself
in the prompt forever. That reasoning should be carried into our design and
tested for.

---

## 6. The interesting DISCARDs

Cases where a source has invested heavily and the right answer is still "don't".

### 6.1 SillyTavern's macro system

`public/scripts/macros.js` currently runs **two macro engines at once** — a
legacy `MacrosParser` and a newer `macro-system.js` registry — with a bridge
that re-registers legacy macros into the new engine and logs deprecation
warnings at each call site. That is a well-managed migration, and it is also a
precise measurement of what string-substitution macros cost once an ecosystem
depends on them.

We inherit none of it. Macros are an *import-time transform*
([00 §2.1](../00-stance.md)): a `{{char}}` in an imported card becomes a structured
reference, once, at the boundary. **[OPEN]** whether any macro syntax survives
into authoring — some template-level substitution inside a block is probably
unavoidable, and Liquid already provides it.

*Built in part, 2026-09-27.* A card's placeholders for **itself** — `{{char}}`,
`{{charIfNotGroup}}` and the legacy `<BOT>`, `<CHAR>` — are written as its name
at import, in every prose field and in the book it carries: a card is one
character, so they can only ever mean that. **`{{user}}` is kept and flagged**,
because who plays is a session's to decide and this question is still open; the
review says the placeholder will reach the model as written.

### 6.2 Bundled tokenizers

ST ships nine sentencepiece/JSON tokenizer models (`llama`, `mistral`, `gemma`,
`yi`, `jamba`, `nerdstash` ×2, `llama3`, `claude`) plus 1,231 lines of
client-side tokenizer plumbing. This exists because token counts had to be exact
for local completion backends with hard context limits and no server-side
counting.

We need token counts for budgeting, but not that precision. Providers return
real usage; a fast local approximation is enough for *pre*-flight budgeting, and
the turn record stores actual counts afterward. Shipping tokenizer model files
is a large maintenance surface for accuracy we do not need. **DISCARD**, revisit
Now unconditional: raw-completion support is dropped ([20 §5.5](../20-tech-stack.md)),
so the one thing that might have argued for exact tokenisation is gone.

### 6.3 Marinara's peripheral feature surface

Table games (six), Spotify integration, haptic device control, audio/video
calls, Echo Chamber, storyboard/anime-episode directors. Each is defensible;
collectively they define the product as "everything".

The verdict is not "these are bad" — it is that **the correct response is to
make them buildable, not to build them.** If the mode and channel contracts are
right, a table game is an extension: a channel holding board state, a step that
validates moves, a declared widget. If a motivated person cannot build UNO
against the extension API without engine changes, [06 §9](../06-modes-and-turn-pipeline.md)
has failed — which makes this list a useful acceptance test rather than a
backlog.

**One item on that list has since been split rather than discarded whole**, and
saying so keeps this section from contradicting
[06 §10.4](../06-modes-and-turn-pipeline.md).
Reading Marinara's storyboard path in 2026-09 found a planner call inside it
answering a question core does need — *which moments of this turn deserve a
picture, and how many* — which is now designed as part of illustration. What is
discarded is what the list was ever about: the storyboard as a **surface**, with
its own presentation and its own pacing. A judgement about one turn is not an
episode director, and the line between them is the surface rather than the call.

The desirable ones are picked up as **desired extensions** in
[25 §4](../25-roadmap.md), with the seam each should use and where the naive
version goes wrong. Two in particular — table games and music — are genuinely
natural in some modes, and are *better* as extensions than they would be in
core, because the whole point is to let a real engine do work the model only
pretends to do.

### 6.4 The Repair JSON modal

Discarding the *modal* means fixing the *mechanism* ([00 §2.3](../00-stance.md)):
structured outputs against a declared schema, a bounded automatic re-ask, and
partial application. A manual repair editor may still exist as a fourth
resort — it must not be the first thing a user meets.

---

## 7. BUY: things none of the three should be the source for

All three hand-roll infrastructure that is now off-the-shelf. Marinara maintains
nine provider adapters; SillyTavern maintains nine embedding backends and nine
tokenizer models.

| Need | Use | Instead of |
|---|---|---|
| Provider adapters, streaming, tools, structured output | Vercel AI SDK | Marinara's 9 hand-rolled providers; ST's per-backend modules |
| Embeddings | one provider via the SDK + a SQLite vector index | ST's 9 vector backends |
| Token estimation | provider usage + a local approximation | ST's bundled tokenizer models |
| Templating | LiquidJS | any bespoke templating |
| PNG chunks | `png-chunks-extract` / `png-chunk-text` | hand-rolled chunk walking |
| Atomic writes | `write-file-atomic` | hand-rolled temp+rename |

Aventuras already made the provider call correctly and is the proof: ~8
providers via `@ai-sdk/*` with no adapter maintenance at all.

---

## 8. What this implies for sequencing

The triage suggests an order, because some verdicts depend on others being right.

1. **Licence, stack, repo shape.** §1 first; it constrains everything.
2. **The spine, with one throwaway mode.** Object model, storage + derived
   index, turn record, assembler, budgeter. Prove it by making the *simplest*
   mode work end to end. The turn record and workbench should exist here — they
   are the debugging tool for everything after.
3. **Lorebooks.** Mostly a PORT of a known-good spec, and the first real test of
   the block/budget model.
4. **Import.** Early, not late — it is how you get a realistic library to test
   retrieval and budgeting against, and it is the largest PORT in the document.
5. **The modes** — Scene and Freeform at 1.0 ([work plan §0](01-work-plan.md)),
   each as a separate package against the public contract.
6. **Retrieval and memory.** The Aventuras PORT. Needs a real library and real
   long sessions to tune, so it wants to come after import.
7. **Multi-user, then file access.** Auth is small; the shared-library ownership
   model is the part with design content.

The two things worth doing earlier than instinct suggests are **import** (item 4)
and **the workbench** (inside item 2). Both are usually late-stage work, and both
are load-bearing for evaluating everything else.

---

## 9. Not examined

Stated so the gaps are known. Verdicts above do not cover these and should not
be assumed to:

- ~~Marinara's Noodle subsystem~~ — **now examined**, notes in
  [25 §4.6](../25-roadmap.md). An in-app fake social timeline, ~6,400 lines of
  server services. Verdict: **one candidate shape for the Social cluster**
  ([25 §3.4](../25-roadmap.md)) rather than a core feature — the earlier verdict
  was "extension, probably not by us", which changed when Messages left the
  release schedule and the question widened. Its *carryover* mechanism
  generalises into something worth having either way, and attempting it reveals
  two gaps in the extension model.
- **ST's extension runtime and the `third-party` loading path** — relevant to
  [26 A1](../26-open-questions.md) and worth a look before deciding the extension
  execution model. The remaining item most worth closing.
- **Client component trees** in all three.
- **Marinara's `bot-browser`** service.

### 9.1 Closed without further examination

Decided rather than investigated, because the verdict does not depend on the
detail:

| | Verdict |
|---|---|
| **Tactical combat engine**, spatial context, hierarchical maps | **Out of scope.** Grid battle is a desired extension at most ([25 §4.3](../25-roadmap.md)), and the largest one there. Not examined further because nothing in core depends on the answer. |
| **Achievements** | **DISCARD.** No plans, no roadmap entry, no seam owed to it. |
| **`sidecar`** — Marinara's in-process local model | **DISCARD, firmly.** See [20 §5.2](../20-tech-stack.md). Local models are supported *as connections*, never as an embedded runtime. |
| **`professor-mari`** | Examined for the assistant design; see [06 §7.4](../06-modes-and-turn-pipeline.md). General-purpose assistant yes, its tool surface no, its default tone no, and the card is swappable. |
| **Image / video / TTS pipelines** | ~~Not examined~~ — **the image halves of both were read on 2026-09-03**, notes in [survey §1](../01-source-survey.md) and [survey §2](../01-source-survey.md), and [06 §10.3](../06-modes-and-turn-pipeline.md), [§10.4](../06-modes-and-turn-pipeline.md) and [§10.4a](../06-modes-and-turn-pipeline.md) are what changed as a result. Still not ported: the requirement is designed rather than taken. TTS and video remain unexamined. |
