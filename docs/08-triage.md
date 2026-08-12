# 08 — Triage: adopt, port, rebuild, discard

**Status: proposal.** A per-subsystem verdict on all three sources. Read
[01-source-survey.md](01-source-survey.md) first for what each thing *is*; this
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
  [04 §8](04-server-multiuser-deployment.md).
- **Dependencies must be AGPL-compatible.** Permissive licences (MIT, Apache-2.0,
  BSD, ISC) are fine and cover everything on the BUY list in §7. Watch for
  SSPL, BUSL, "source-available", and non-commercial terms, which are not.
- **User content is not affected.** Actors, settings, lorebooks, packages and
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
- **[06 A1](06-open-questions.md) is now purely technical again.** The extension
  execution model — in-process modules versus sandboxed workers — was carrying a
  licensing dimension it no longer has. Decide it on safety, blast radius and
  API ergonomics alone. In-process is licence-viable, which is the simpler
  starting point.
- **The SDK package must itself be AGPL**, deliberately. This is the mechanism
  by which the decision actually holds: extensions import `sdk`, so `sdk`'s
  licence is what makes them combined works. Publishing it permissively "to be
  friendly" would quietly undo the decision. See [07 §10](07-tech-stack.md).
- **Extension manifests should declare a licence field**, surfaced by the
  installer. Not enforcement — legibility. It makes the expectation visible at
  the point of authoring and lets a user see what they are installing.

### 1.2 The line that must stay crisp: code is AGPL, content is not

This decision makes one distinction load-bearing, and getting it wrong would
produce exactly the perception the decision exists to avoid.

| Kind | Licence |
|---|---|
| Code extensions and modes (import the SDK, run in our process) | **AGPL-3.0, required** |
| Actors, lorebooks, settings, presets, sessions | **The author's own. Any licence, including none.** |
| Packages — including their **authored rules** ([09 §2](09-infinite-worlds.md)) | **The author's own.** |

Rules are the case worth being explicit about, because they *look* like code.
They are not: a rule is a term in a closed vocabulary that our evaluator
interprets, no different in kind from a lorebook entry's activation settings. A
package full of rules is authored content and its author licenses it however
they like — or not at all.

This has a pleasant consequence. The authored-rules tier is not merely an
expressiveness feature, it is also **the escape hatch for anyone who wants to
ship something they control**: build it as a package of rules and content rather
than as a code extension, and the copyleft question never arises. That makes
[09](09-infinite-worlds.md)'s third tier more valuable under this decision than
it was before it, and it is worth saying so publicly rather than leaving people
to discover it.

Both halves of the table belong somewhere user-facing — the About surface in
[04 §7](04-server-multiuser-deployment.md) is the natural home.

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
- **Architectural ideas** — everything in [00](00-stance.md) and
  [03](03-modes-and-turn-pipeline.md).

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
| ST lorebook / chat / preset import | Marinara `import/` (~4,450 ln total) | **PORT** | The single largest body of "someone already found the edge cases" in any of the three. |
| Character card *format* | all three | **REBUILD** | [02 §2](02-data-model.md). |
| Lorebook entry model | Marinara `types/lorebook.ts` | **PORT ~intact** | [02 §3](02-data-model.md). Four scoped changes only. |
| Scenario / setting object | Marinara `feat/scenarios` | **PORT the design** | The design plans are worth more than the code; adopt their §3.3 deferred reframe. |
| Pack / preset bundle | Aventuras `services/packs/` | **PORT** | Especially the `contentHash`/`baselineHash` update mechanism. |
| Avatar crop as normalised source rect | Marinara `types/avatar-crop.ts` | **PORT** | Coordinates in 0..1 survive resize/re-encode; the render-only legacy variant is a good format-migration pattern. [05 §11.3](05-ui-surfaces.md) |
| Per-field generation provenance | Marinara `GeneratedFieldProvenance` | **PORT, widened** | Scenario-only upstream; applies to every authored kind here. [05 §11.2](05-ui-surfaces.md) |
| Structured `VisualDescriptors` | Aventuras `types/index.ts` | **PORT** | face/hair/eyes/build/clothing/accessories/distinguishing. Prose appearance is for the narrator; this is for image pipelines. [02 §2.1](02-data-model.md) |
| Media embedded in the card, with typed roles | — *none of the three* | **NEW** | V2/V3 caps a card at one picture, which is why every tool bolts sprites on the side. [02 §5.2.2](02-data-model.md) |
| Branching | Aventuras COW+tombstones vs Marinara pointer | **REBUILD** — *verdict revised, see [10 §8](10-branching.md)* | Aventuras' is the better engineering and the wrong fit: COW exists to branch mutable rows, which we don't have. Take Marinara's UX, derive state from the effect log. |
| `PersistentRetryState` | Aventuras | **DISCARD** | Hand-maintained undo snapshot; replaced by reversible effects. |
| Per-field `translated*` columns | Aventuras | **DISCARD** | [01 §2](01-source-survey.md). |
| `GameSetupConfig` | Marinara | **REBUILD** | ~70 fields mixing narrative and production. |
| Per-user directory islands | ST `USER_DIRECTORY_TEMPLATE` | **REBUILD** | Layout idea yes; isolation model no ([04 §4.3](04-server-multiuser-deployment.md)). |
| Four backend settings dirs | ST | **DISCARD** | Completion-era fossil. |

### Retrieval and context

| Subsystem | Best source | Verdict | Note |
|---|---|---|---|
| Keyword matching semantics | Marinara `keyword-scanner.ts` / ST `world-info.js` | **PORT** | Behaviour spec. Marinara's is ST's superset and better organised. |
| Regex ReDoS guard | Marinara `regex-timeout.ts` (~60 ln) | **ADOPT** | See §5.1 — the strongest single lift candidate in all three repos. |
| Two-tier token budget + trim order + skip reporting | Marinara | **PORT** | Already the budgeter [00 §2.6](00-stance.md) argues for. |
| Tiered retrieval (always / keyword / LLM-select) | Aventuras `EntryRetrievalService` | **PORT** | Best memory design of the three; fills the [06 §E](06-open-questions.md) gap. |
| Stickiness tuning constants | Aventuras `STICKINESS_BY_TYPE` | **PORT** | See §5.2 — empirical tuning is the asset. |
| Chapter summarisation + batching | Aventuras `ChapterBatchPlanner/Service` | **PORT** | Unexamined in detail; flagged as the next design doc. |
| Agentic retrieval (tool-driven search) | Aventuras `AgenticRetrievalService` | **REBUILD** | Right idea; ours is a pipeline step ([03 §6](03-modes-and-turn-pipeline.md)). |
| Prompt assembly | Marinara `assembler.ts` + `marker-expander.ts` | **REBUILD** | The central thing we are redesigning. |
| Macro system | ST `macros.js` | **DISCARD** | See §6.1. |
| Instruct / context templates | ST | **DISCARD** | [00 §2.2](00-stance.md). |
| Tokenizers | ST `src/tokenizers/` + 9 bundled model files | **BUY/DISCARD** | See §7. |
| Embedding backends (9 providers) | ST `src/vectors/` | **BUY** | See §7. |

### Modes and gameplay

| Subsystem | Best source | Verdict | Note |
|---|---|---|---|
| Three-mode concept | Marinara `ChatMode` | **PORT** | The organising idea. |
| `GroupChatMode: merged \| individual` | Marinara | **PORT** | Split into two axes ([03 §3](03-modes-and-turn-pipeline.md)). |
| Group activation strategies | ST `group_activation_strategy` | **PORT** | Taxonomy yes; card-swapping implementation no. |
| Group generation by card swap | ST `group_generation_mode.SWAP` | **DISCARD** | [00 §2.10](00-stance.md). |
| Conversation feature set | Marinara | **PORT** | Presence, schedules, autonomous messages, reactions, profiles, gated commands. |
| Adventure/RPG systems | Marinara Game Mode | **REBUILD as channels** | [03 §4](03-modes-and-turn-pipeline.md). |
| Typed input (do/say/story) + chapters | Aventuras | **PORT** | The Chronicle preset. |
| Duplicated RP-vs-Game combat & HUD | Marinara | **DISCARD one of each** | [00 §2.7](00-stance.md). |
| Big-bang world gen + Repair JSON modal | Marinara | **DISCARD the mechanism** | [00 §2.3](00-stance.md). |
| Hidden GM state / Secret Plot | Marinara | **PORT as a channel** | Generalises to all modes for free. |
| Setup snapshot | Marinara | **PORT, strengthened** | Becomes a real Package. |
| Seed → expand → edit → accept | Aventuras wizard | **PORT** | The right interaction for authoring. |
| Table games, Spotify, haptics, calls, Echo Chamber, storyboards | Marinara | **DISCARD from core** | Must be *expressible* as extensions; none ship. |

### Platform

| Subsystem | Best source | Verdict | Note |
|---|---|---|---|
| Multi-user auth (scrypt, cookies, CSRF, admin flag) | ST `users.js` | **PORT** | Shape is right; ~200 lines of standard practice. |
| Header-SSO behind `trustedProxies` | ST `users.js` | **PORT** | Directly reusable for Tailscale ([04 §5.2](04-server-multiuser-deployment.md)). |
| Provider adapters | Marinara (9) / Aventuras (AI SDK) | **BUY** | Aventuras already made this call correctly. |
| Generation pipeline phases | Aventuras `services/generation/phases/` | **PORT the structure** | Closest thing to our turn pipeline. |
| Agent/step execution | Marinara `agents/agent-executor.ts` etc. | **REBUILD** | Unify agent and pipeline step. |
| Extension capability API | Marinara `CapabilityRuntime` | **PORT the design** | Including its typed-union instinct. |
| Baked-in assistant | Marinara Professor Mari | **PORT the shape, REBUILD on sessions** | Suggestion chips and change-review are worth taking directly. [03 §7.4](03-modes-and-turn-pipeline.md) |
| Assistant shell/filesystem tools (`bash`, `write`, shell sandbox) | Marinara | **DISCARD** | A coding-agent tool surface. On a multi-user LAN server it is privilege escalation wearing a friendly hat. Domain tools only. |
| Folder-package export | Marinara `folder-packages/` | **PORT** | Good shape for our `.sepack`. |
| Browser-side orchestration | ST | **DISCARD** | [00 §2.9](00-stance.md). |
| Desktop/mobile shells | Aventuras Tauri, Marinara `.exe`/Android | **DISCARD** | [05 §1](05-ui-surfaces.md). |
| In-editor field assist (generate / refine-with-guidance / revert) | Aventuras wizard | **PORT, widened** | Wizard-only upstream; becomes a primitive every editor is built from. [05 §11.1](05-ui-surfaces.md) |
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
([00 §2.1](00-stance.md)): a `{{char}}` in an imported card becomes a structured
reference, once, at the boundary. **[OPEN]** whether any macro syntax survives
into authoring — some template-level substitution inside a block is probably
unavoidable, and Liquid already provides it.

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
only if raw-completion support ([06 A4](06-open-questions.md)) argues otherwise.

### 6.3 Marinara's peripheral feature surface

Table games (six), Spotify integration, haptic device control, audio/video
calls, Echo Chamber, storyboard/anime-episode directors. Each is defensible;
collectively they define the product as "everything".

The verdict is not "these are bad" — it is that **the correct response is to
make them buildable, not to build them.** If the mode and channel contracts are
right, a table game is an extension: a channel holding board state, a step that
validates moves, a declared widget. If a motivated person cannot build UNO
against the extension API without engine changes, [03 §9](03-modes-and-turn-pipeline.md)
has failed — which makes this list a useful acceptance test rather than a
backlog.

The desirable ones are picked up as **desired extensions** in
[11 §4](11-roadmap.md), with the seam each should use and where the naive
version goes wrong. Two in particular — table games and music — are genuinely
natural in some modes, and are *better* as extensions than they would be in
core, because the whole point is to let a real engine do work the model only
pretends to do.

### 6.4 The Repair JSON modal

Discarding the *modal* means fixing the *mechanism* ([00 §2.3](00-stance.md)):
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
5. **The three modes**, each as a separate package against the public contract.
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

- **Marinara's Noodle subsystem** — substantial (own types, schemas, services,
  scheduler, regressions), purpose not investigated.
- **Marinara's tactical combat engine**, spatial-context / hierarchical maps.
- **All three image/video/TTS pipelines**, beyond noting they exist.
- **ST's extension runtime and the `third-party` loading path** — relevant to
  [06 A1](06-open-questions.md) and worth a look before deciding the extension
  execution model.
- **Client component trees** in all three.
- **Marinara's `professor-mari`, `sidecar`, `achievements`, `bot-browser`**
  services.
