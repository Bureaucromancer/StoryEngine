# Prose Adventure for Marinara

Standalone project design · 2026-09-17 · revision 1

**Status: proposed implementation, grounded in source inspection.** No package, engine patch, or acceptance result is implied by this document. “Prose Adventure” is a working name; `prose-adventure` is the proposed package identifier, subject to collision checking.

This file is intended to become `DESIGN.md` in an independent repository. It contains the product scope, architectural decisions, implementation sequence, evaluation protocol, and source references needed by a new project or implementation task. It has no required links to a local StoryEngine checkout and needs no surrounding conversation to be understood.

## 1. Purpose and the three deliverables

Build a useful, prose-first interactive adventure inside Marinara, using its existing extension mechanisms as far as they can carry the experience. The player reads an ongoing story, acts within it, and occasionally contributes an authored event. The narrator manages the world and supporting cast; game machinery supports the fiction without dominating its presentation.

The project has three equally explicit deliverables:

1. **A playable application feature.** A Marinara package that a person can install, use for sustained play, configure, update, and remove through supported mechanisms. It must be worth using independently of the architectural argument.
2. **Evidence for narrow engine extensions.** Reproducible examples of requirements that the supported interfaces cannot express, accompanied by the smallest general host changes that resolve them. An extension request earns its place through an observed limitation and a working demonstration.
3. **A concrete account of why StoryEngine is a different project.** Show which experiences transfer readily and which guarantees depend on a different underlying model. Similar-looking story screens do not establish equivalent state, authorship, ownership, or diagnostic contracts.

The third deliverable is an investigation with an open outcome. Do not manufacture friction, duplicate unnecessary infrastructure, or weaken the Marinara implementation to make StoryEngine look necessary. If a supported package satisfies the requirements that matter, record that success. If some StoryEngine distinctions prove practically unimportant, record that too.

Success can mean “Marinara gains an excellent prose adventure” and “StoryEngine remains useful for different requirements” at the same time. This project does not decide whether to discontinue StoryEngine, and it does not depend on StoryEngine reaching beta first.

## 2. Evidence baseline and terminology

The inspected host baseline is **Marinara Engine 2.4.6**, main commit `cc783dd194bacd97379191b9d490939afbe6759e`. Its source declares **Capability API 1.18**. Pin the actual engine commit, package artifacts, API version, and relevant agent versions in the new repository before implementation; recheck all observations against that pin. A version range is not a substitute for a tested build.

The reference interaction is StoryEngine's implemented Freeform mode at `af23e8df0425ded5bac5036262c9c545a464cd62`, plus the Aventuras adventure format inspected locally at `8ae0d79a0df0745be3594fa5affcc98dd02c5a75`. Neither reference is a dependency. The Aventuras reference is an August 16 checkout, not a claim about its latest release. StoryEngine's planned memory, chapters, Write surface, Character Studio and Campaign are not treated as existing behavior.

Terms used here:

| Term | Meaning |
|---|---|
| Capability package | Marinara's executable/content package with a validated manifest, entrypoints, permissions, compatibility requirements and hashed files |
| Game Experience | A package contributing a `game-surface` within the existing Game mode |
| Prompt content | Editable narrator instructions, GM prompt templates and package-contributed context; use the appropriate existing host mechanism |
| Custom agent | A focused model-driven helper using Marinara's agent system; not a synonym for an executable Game Experience |
| Treatment | Reusable narrative framing: premise, tone, setting, cast references, prose preferences and optional hooks |
| Passage | One assistant narrative response as read by the player; not a VN segment |
| Chapter | A reader/author grouping of passages; not automatically a Marinara campaign session |

“Official methods” means using interfaces and installation mechanisms provided by Marinara. It does not imply official endorsement, catalog acceptance, or that every internal helper is a stable public API. Personal Extensions, ordinary agent JSON imports, capability packages, and prompt presets are different mechanisms; do not substitute one without documenting the consequences.

## 3. The experience to ship

### 3.1 The main loop

The player selects Prose Adventure when creating a Game, chooses an existing connection and persona, supplies a premise or treatment, optionally selects supporting characters and lorebooks, and starts. The player receives coherent paragraphs with dialogue embedded naturally in the prose. Subsequent passages follow from the player's chosen input kind.

| Input | Interpretation | Required example |
|---|---|---|
| Do | Attempt an action; the world determines the outcome | “Pick the lock” does not assert that the lock opens |
| Say | The protagonist speaks; applicable characters may hear it | “I know about the letter” is spoken dialogue |
| Think | Private protagonist thought, not an observable act | “Mara must be lying” must not be rendered as speech |
| Story | The player establishes a fictional event as an author | “The last ferry has already left” is accepted as the next fact, subject to resolving contradictions visibly |

Keep a separate way to address the GM out of character, using the existing host behavior where possible. Story and OOC have different meanings. Empty submissions do not generate accidentally; an explicit Continue action, if included, clearly asks for continuation without a new player action.

The narrator must leave strategic choices, exact dialogue and private thoughts of the protagonist to the player. Longer passages must stop at meaningful decisions. This is adventure play, not Aventuras' creative-writing mode where the model may control the protagonist fully.

### 3.2 Reading and controls

Use a continuous, readable story column with ordinary paragraphs, integrated dialogue, responsive typography, keyboard-accessible input and a stable reading position. New streaming output must not drag a person away from an older passage they are reading. Bound the rendered history for large stories while keeping older content reachable.

Essential controls: input kind, send/stop, retry or regenerate through the host, navigate history, open the host's state/summary tools, and open story preferences. Use host edit/branch controls where compatible; identify any missing adapter explicitly. Put state changes and choices near the passage they belong to, without scattering machine tags into literary prose.

Difficulty and directedness are separate settings. Difficulty changes how readily attempts succeed and the consequences of mistakes. Directedness changes how actively the narrator introduces and pursues plot. Viewpoint, tense and preferred passage length are independent settings. Start with third-person past tense and a moderate passage preference. Length is a model instruction and output-budget choice, not a promise of an exact word count.

Sprites, images, voice, dice and tactical combat are optional. The first release must work with a text connection alone. Do not silently enable paid helpers or media generators. Existing state and inventory features remain available when selected.

### 3.3 Scope boundaries

**First complete release:** installable Experience; continuous prose; four input kinds; narrator preferences; reusable treatment with session prefill; existing host state and summaries; persistence across reload; supported retry/branch/resume; compatibility diagnostics; and the evidence package described below.

**Second increment:** chapter markers and navigation, editable chapter notes, a small user-authored hook list, and optional existing agents for continuity/retrieval. Add these only after the first loop is reliable. A hook controller should propose or consume hooks visibly; it is not a second hidden plot engine.

**Outside this project:** a new account system, replacement database, universal effect log, general-purpose mode SDK, new provider framework, StoryEngine's workbench, novel-authoring workstation, combat engine, automatic migration of complete StoryEngine sessions, and a permanent full Marinara fork. These may be subjects of findings; they are not prerequisites for a good prose game.

## 4. Use Marinara first

Choose a **Game Experience capability package inside the existing `game` mode**. A fourth `ChatMode` is not justified by prose presentation alone.

| Responsibility | Preferred owner and mechanism | Boundary to verify |
|---|---|---|
| Reader and typed input | Package client in `game-surface` | Full passage rendering and lifecycle participation |
| Narrator preferences | Editable GM prompt/template content plus bounded package context | Engine's final format instruction must agree |
| Treatment library | Package-owned documents through the capability runtime | Revisions, package ownership, import/export and removal behavior |
| Effective story settings | Namespaced chat metadata through supported host updates | Atomic preservation alongside concurrent host writers |
| Player, NPCs, lore | Existing personas, characters and lorebook APIs | Preserve host identities rather than inventing an actor migration |
| Sending, streaming, retry | Host Game generation and message storage | Use one generation loop and one authoritative transcript |
| World state and game commands | Existing Game services and selected host agents | Rendering prose must preserve canonical mutations |
| Long-story context | Existing Game summaries and verified compatible retrieval | Do not assume Roleplay-only agent placement works in Game |
| Installation and updates | Capability catalog and installer | Test a custom catalog and exact artifact compatibility |
| Engine changes | Small separately testable patches | Each patch tied to a reproduced missing contract |

Prefer configuration, then prompt content, then package code, then a focused host extension. This is a preference order, not a ritual requiring known-broken workarounds. Record why a lower-cost option cannot meet a requirement and move on.

Do not monkey-patch host functions, mutate private client stores, hide essential controls with incidental CSS selectors, write host table files directly, or run a parallel model-call loop just to avoid proposing a legitimate extension. Use `surfaceClass` for declared styling, not to simulate lifecycle ownership. If an official package bundles host sources, distinguish its distribution technique from a supported runtime contract; copying an internal file still creates maintenance coupling.

## 5. Observed extension surface and its limits

At the pinned baseline, the manifest supports `game-surface`, `surfaceClass`, startup preparation, and setup seed/default declarations. The mounted Experience receives messages, the latest assistant message, streaming state, `sendMessage`, chat metadata, and game-specific state. It may supply player input and choices and request collapsed built-in narration. [Host schema][schema], [Experience integration][surface].

Server modules can register prompt-context contributors and use capability resource/model/persistence APIs. The persistence contract includes reusable documents with revisions, chat locks and transactions. A prompt contributor is read-only, has a short execution deadline, and can return attributed package text. It is not the place to run slow generation or mutate story state. [Runtime][runtime], [module API][modules], [context registry][context].

Three observations constrain the current design:

1. **Game generation bypasses the ordinary preset assembler.** Package context is injected before a final GM format reminder. A generic prompt-pack import is therefore not equivalent to owning Game's output format.
2. **The final format reminder favors VN beats and tagged dialogue.** The customizable GM instruction section does not replace the whole prompt.
3. **Presentation completion is intertwined with Game controls.** Stacked display still consumes narration segments, and collapse does not transfer ownership of completion to another reader.

These are verified architectural observations, not proof that every possible configuration fails. Milestone 1 below produces the smallest runnable examples. [Generation][generation], [GM prompts][gm], [narration][narration].

Pixelforge is a relevant official-source example of a `game-surface` Experience with startup preparation and setup defaults; its repository describes it as in development. Gacha Forge illustrates a different route, a package-owned Home destination. Neither proves this project works, and neither should be copied wholesale. Pin a compatible example and inspect its source/build process during bootstrap. [Pixelforge manifest][pixelforge], [Gacha Forge manifest][gacha].

## 6. Package data and authority

The following names describe **proposed package data**, not existing Marinara fields. Validate and version the actual representation before writing it.

| Record | Proposed contents | Authority |
|---|---|---|
| Treatment | Schema version, id/revision, title, premise, tone, setting text, host cast/lore references, narrator preferences, optional hook definitions | Reusable package document |
| Story configuration | Treatment revision/hash and copied effective content; prose preferences; mechanic selections | Namespaced metadata belonging to this chat |
| Input annotation | Kind, submission correlation key, committed user-message identity, schema version | Host message metadata if supported; a package document only with a proven atomic link/remapping strategy |
| Chapter marker | Title, notes, chat id and boundary message identity | Package annotation over the host transcript |
| Diagnostic receipt | Package version, settings revision, contributed context identifiers/hash, host turn/message identity, observed outcome | Diagnostic only; never authoritative game state |

Starting a story copies treatment content into its effective configuration. Changing the reusable treatment does not rewrite an existing story. Applying a newer treatment to a running story is an explicit action with a visible difference. Existing host character/lore references keep host semantics; copying a treatment does not imply freezing every referenced object. Record that limitation.

A treatment must not include credentials, provider endpoints, executable source or hidden configuration that enables paid services. Model bindings remain install-specific host configuration. Missing cast/lore references are shown and can be repaired; never silently substitute a different character.

The host owns messages, swipes, state and branch operations. Store package settings and annotations, not a second copy of the transcript or parallel inventory. Diagnostic receipts can identify package contributions; they must not masquerade as StoryEngine's complete turn record.

**Branching is an explicit integration requirement.** IDs may be remapped when the host copies messages. A chapter, input annotation or consumed hook must not point into the abandoned branch or inherit future state. Verify the available branch/export/remapping hooks before selecting storage. Global package documents do not become branch-local merely because they contain a `chatId`.

For derived annotations, invalidation and rebuilding from the selected host history may be sufficient. For authored facts, require correct preservation or a visible unsupported operation; silently deleting them is unacceptable. If host lifecycle support is missing, document extension E4 rather than implementing a private generic event-sourcing engine.

## 7. Proposed engine extensions

These are **contract proposals, not available API names or accepted upstream work**. Implement the smallest subset that the baseline experiment establishes as necessary. Ship package-level functionality while evaluating them; do not turn this section into an engine rewrite roadmap.

### E1 — Coherent narrative output format

**Problem:** the final Game instruction asks for VN-formatted beats even when a package requests continuous prose.

**Proposal:** a validated narrative-format selection owned by the host, initially existing VN behavior and continuous prose. Resolve it once and use it consistently in system framing, the final output reminder and presentation selection. Keep content preferences separate from command/tool instructions and state-validation rules. Do not grant arbitrary package control over the complete provider request as the first solution.

**Proof:** the same Game context can produce either format without contradictory instructions. A saved effective prompt in prose mode contains no VN-only dialogue-format requirement. Both formats still process a state-changing command correctly. Unconfigured existing games retain the current behavior.

**General value:** other Experiences, accessible readers and text-adventure surfaces need control of presentation without giving up Game state.

### E2 — Alternate reader lifecycle

**Problem:** replacing the visible narration does not replace its segment-completion contract.

**Proposal:** let a registered alternate presentation participate explicitly in the host turn lifecycle. The host remains authoritative for generation, persistence, cancellation and game mutations. Identify presentation acknowledgements by chat, message/swipe and generation epoch, so a stale acknowledgement cannot complete a later turn. Define one presentation owner and teardown behavior; unmounting a package must not strand a game.

For prose, generation completion, postprocessing completion and human reading are distinct. The reader need not wait for a “read every segment” action. Interactive commands that intentionally interrupt a turn still need an explicit policy; do not auto-acknowledge every event or simply force `narrationDone = true`.

**Proof:** the next valid input and choices work with no hidden VN reader, errors remain actionable, replay does not execute effects, and retries/reconnects do not duplicate commands. Test switching/unloading the Experience and late callbacks from the prior turn.

**General value:** alternate readers and other Game Experiences can share generation without imitating VN playback.

### E3 — Typed player input, only if the existing contract cannot carry it

**Problem to establish:** does the host preserve a package-selected input kind with its message through submission, editing, retry, export and branch remapping?

**Proposal if needed:** validated namespaced input metadata attached atomically to the user message, available to prompt construction and relevant UI. Preserve the raw player text separately from generated explanatory wrappers. Recognize ordinary unannotated messages as the existing default.

**Proof:** a saved Think remains Think after reload and branch; a retried Story does not become an attempted action; the annotation cannot attach to another concurrent submission. The final prompt interpretation agrees with the visible selector.

Prompting a model to respect private thoughts is a behavioral instruction, not a hard information-flow guarantee. The prototype must not advertise it as equivalent to enforced source isolation across every downstream agent.

### E4 — Package annotations across lifecycle operations, conditional

**Problem to establish:** can package-owned annotations follow branch, delete, session continuation, export/import and restore with appropriate identity remapping?

**Proposal if needed:** the narrowest validated lifecycle callback or host-managed annotation facility required by the concrete records in section 6. Avoid granting arbitrary callbacks permission to rewrite all branch state. Specify rollback or failure reporting so an operation is not reported as complete with half its annotations missing.

**Proof:** chapter markers and one consumed plot hook are correct on both sides of a fork, including a fork before the hook was consumed. Delete and import cannot leave an active annotation referring to a different story.

**General value:** package annotations need durable identity across existing host operations. This does not claim universal reversible state effects.

### Extension admission rule

Every extension carries: a reproducible baseline failure; the required user behavior; existing alternatives tried; a minimal contract; package/host ownership; backward compatibility and cleanup rules; behavioral tests; a working consumer; and an estimate based on the actual patch. Reduce or remove a proposal if upstream has already solved it. A source file's size is not sufficient justification.

## 8. Installation, compatibility and development ownership

Produce a schema-valid capability manifest and hashed artifact through a reproducible build. The current schema's package kinds include `agent`, `maps`, `conversation-calls` and `turn-game`; **do not invent a manifest kind named `experience` or `plugin`**. Follow a compatible official-source Experience for the appropriate manifest classification. Declare only the API minor version actually required; using setup defaults at the inspected baseline requires API 1.18.

Use `builtAgainst` and tested engine compatibility bounds. Declare package permissions from the code's actual use. UI and chat reading are expected; prompt context, chat writing, storage, routes or agent-runtime permissions are included only where their mechanisms are used. Keep persistence mediated by the capability APIs and scoped to this package's records. Privileged routes use the host's access controls and validate identifiers and payloads server-side.

The host supports **`MARINARA_AGENT_CATALOG_URL`** for a custom catalog and reports custom provenance. Its catalog fetch policy at the baseline requires HTTPS. Use this supported mechanism in an isolated development/test install; validate artifact URLs, manifest/file hashes, installation, restart requirements and updates through the normal manager. Do not assume plain HTTP localhost works, edit `installed.json` manually, impersonate the official catalog, or disable integrity checks. Verify how overriding the catalog affects visibility of optional official dependencies before documenting a user install recipe. [Package manager][manager].

Official catalog inclusion is a separate upstream decision. A custom agent import toggle is not an installation recipe for an executable Experience. If development installation reveals a host limitation, report it as such rather than patching around the trust path invisibly.

Maintain two explicit test targets:

- **Released-host baseline:** unmodified pinned Engine, package and documented approximations. Record unsatisfied requirements. Do not label this full Prose Adventure if essential format/lifecycle behavior remains absent.
- **Extension candidate:** the same Engine pin plus a named minimal patch series, paired with a package requiring the new behavior. Do not publish an artifact as stock-compatible when its capabilities exist only in the candidate.

If numeric API versions cannot yet distinguish a development patch, keep that artifact a clearly identified development build and add a capability check. Production compatibility follows an actual released host contract, not an invented upstream API number.

The future project repository contains the package and evidence. Engine changes live as reviewable commits in a separate Engine checkout, with exported patch references in the project. Do not vendor a complete Engine copy into the package repository. Current upstream contribution rules target `staging`; re-read the contribution guide before preparing upstream work. This document authorizes neither posting an issue/PR nor publishing a package; those are separate actions. Local implementation and preparation need not wait for catalog acceptance. [Contributor guide][contributing].

## 9. Long-form memory, state and prose policy

Long passages and long stories are separate acceptance targets. Reuse host summaries and verified Game-compatible retrieval first. Record the actual enabled packages and settings: a library entry or catalog listing does not establish that an agent contributes to this Game's prompt.

A chapter is initially a navigation marker and an authored note over an existing transcript. Ending a chapter must not silently invoke a campaign-session transition or reset state. If chapters later trigger summaries, key their inputs to the actual message range/revisions; edits and branching must invalidate stale derived summaries. Do not describe these as StoryEngine's immutable summary chain unless that exact mechanism has been implemented and tested.

The first implementation retains existing game command processing. Show a clean prose projection while preserving authoritative host content and command outcomes. Handle incomplete streamed tags without leaking machine syntax or deleting legitimate bracketed prose. Never replay commands merely because a reader re-renders a passage. Reuse a supported parser/render adapter where available; if the only parser is private, document the required extraction instead of copying it without tracking provenance.

Imported text and model output render through safe existing content handling. The Experience does not execute arbitrary story HTML. Retain enough original material to make editing/regeneration correct; plain-text export may omit command syntax, but it is then an export view rather than a lossless game backup.

A minimal hook increment uses authored hooks with visible states such as available, proposed and consumed. Do not add an autonomous director by default. Any model-driven hook judgment is fallible and correctable. Demonstrating one hook across a branch is more valuable here than building a large plot-planning subsystem.

## 10. How this demonstrates the StoryEngine distinction

The player-facing overlap is intentional. The comparison asks what obligations each implementation assumes when the experience grows.

| Question | What this Marinara project should demonstrate | StoryEngine distinction to examine |
|---|---|---|
| Can it tell the desired story? | Continuous prose with meaningful player input, state and continuity | Similar output can be achieved on a different engine; this alone does not establish a need for StoryEngine |
| Why did this turn happen? | Effective host prompt plus a truthful receipt for this package's contributions | StoryEngine's common turn record connects block sources, budgets, calls and accepted/rejected effects; a package receipt is narrower |
| What happens on a branch? | Correct behavior for the concrete host state and package annotations tested | StoryEngine applies common channel reconstruction rather than requiring each feature to supply bespoke restoration; breadth of that guarantee needs its own evidence |
| What is an actor? | Adapt to Marinara's character/persona distinction | StoryEngine unifies these roles in its content model; reproducing a screen does not unify host identities |
| What is portable? | Explicit treatment export and the host's chat/backup facilities | StoryEngine uses per-object artifacts and a derived index; a JSON package document stored in host tables is a different contract |
| Who owns a story? | Marinara's existing single-install user model | StoryEngine's independent accounts and content roots are outside this package's remit |
| How does a new mechanic integrate? | Exercise one stateful extension using actual host APIs | StoryEngine's SDK declares steps, channels and surfaces over a common pipeline; this package is a consumer of Marinara's current Game contract |

Do not repeat obsolete claims that Marinara has no tests, no prompt inspection, no server-side generation, or no extension architecture. It has all four. Conversely, do not treat a StoryEngine type declaration or unwalked plan as a demonstrated guarantee. Current StoryEngine effect acceptance uses whole-value channel sets, and later memory/authoring work remains separate from its implemented Freeform interaction.

Classify every finding as **solved by configuration**, **solved by package**, **solved by a small host extension**, **requires a broader architectural change**, or **not valuable enough to pursue**. The resulting evidence, not a predetermined winner, is the comparison deliverable.

## 11. Implementation sequence and completion gates

| Milestone | Work | Evidence required to finish |
|---|---|---|
| M0 — Reproducible host/package setup | Pin Engine and compatible example source; create package build, manifest, test catalog and isolated data directory; record observed contracts | Install, activate, restart if required, update and uninstall a minimal package through the host manager; no private registry edits |
| M1 — Best unmodified-host experience | Add reader surface and typed-input controls using existing props; try supported prompt configuration and stacked display; record exact effective prompts | A playable baseline and reproducible evidence for remaining format/lifecycle problems; do not claim full completion |
| M2 — Prose output and reader contract | Implement only justified E1/E2 host changes and package adapter | Full prose turn; working next input, choices, stop/retry and reconnect; existing classic Game behavior retained |
| M3 — Durable play and authoring | Treatment library/prefill, settings, input persistence; resolve E3 only if needed; host state/summary integration | Two sessions from one treatment stay independent; typed input survives retry/branch; state changes and reload agree |
| M4 — Extended story and lifecycle | Longer fixture, branch-before-change, concluded-session continuation, backup/restore, package upgrade/uninstall | Correct retained data and clear degraded behavior without the package; context continuity evaluated separately from UI |
| M5 — Bounded chapter/hook increment | Navigation markers and one authored hook using host persistence; evaluate E4 if needed | A branch before hook consumption does not inherit it; chapter anchors remain correct or fail visibly |
| M6 — Demonstration and handoff | Clean-install guide, demo script, extension proposals, findings matrix and maintenance record | Another person can reproduce the playable result and assess each architectural claim without StoryEngine's repository |

M0–M4 define the first complete playable release. M5 supplies the deliberately bounded stateful extension demonstration; M6 completes the full project brief. A failure at an architectural boundary may still complete an evidence milestone, but it does not count as completing a missing gameplay requirement. Record the distinction.

Do not speculate on a full delivery date before M0/M1. After those milestones, estimate from the actual changed surfaces and unknowns. If work starts expanding into a new persistence or orchestration framework, stop that expansion, write the finding, and return to the smaller playable scope.

## 12. Acceptance fixtures and evaluation

Use an original small scenario, **The Last Ferry**. The protagonist arrives at Greywater carrying a sealed letter. Mara runs the ferry; Ivo watches the bridge. The letter's contents are hidden from both NPCs. The ferry schedule, the letter's location and whether Ivo has been warned provide concrete continuity checks. This is test content, not copied material from either reference application.

### Deterministic integration checks

Use a fake or recorded text provider through the host's actual generation path, plus focused package/host behavioral tests. Do not assert that merely setting a flag implements the promised behavior.

| Check | Expected observation |
|---|---|
| Format selection | Prose prompt has no VN-only format rule; default Game prompt behavior remains covered |
| Mixed prose and dialogue | Paragraph order and inline speech survive streaming and reload without unwanted segmentation |
| Do versus Story | Do attempts to open the letter; Story establishes that it is already open; the stored kind and final prompt agree |
| Think versus Say | The former is not serialized as spoken dialogue; the latter is; downstream scope is documented |
| Concurrent submit/retry | Input metadata attaches to the intended message once; late responses cannot attach to the next turn |
| Partial streaming command | No raw command flicker, lost prose or duplicate mutation after reconnect |
| Reader lifecycle | Input and choices become available by the specified host state, without clicking a hidden VN reader |
| Treatment revision | Editing the source treatment does not change existing session copies |
| Consequential branch | Branch before giving Mara the letter; only the appropriate branch records that transfer |
| Annotation branch | Hook consumption and chapter anchors refer to the correct copied/remapped history |
| Replay and restore | Reading prior turns does not apply commands; restored data reproduces the visible story and supported state |
| Package lifecycle | Upgrade preserves data; uninstall does not erase the host transcript; reinstall can recover package data according to the documented policy |
| Compatibility failure | Unsupported host capability produces an actionable message, not a blank overlay or a falsely supported build |

For UI scale, use a synthetic long transcript (for example 500 passages) to test bounded rendering, history access and scroll behavior without buying model calls. Measure on a named device/browser; choose performance thresholds from the first baseline and record them.

### Live play evaluation

Run a short structured sequence for interaction quality and an extended story for continuity. Include action, speech, private thought, authored event, a change of location, a consequential inventory/fact change, a retry, a branch before that change, and session continuation. Compare equivalent story/model settings when possible; disclose unavoidable differences.

Record readable-prose quality, protagonist-agency violations, thoughts treated as public knowledge, forgotten facts, corrections required, time to repair, provider calls/tokens, latency and willingness to keep playing. Distinguish prompt construction correctness from model compliance. Do not require identical prose across runs or infer better stories from a passing fake-provider test.

The public-facing demonstration should show: one enjoyable scene; one limitation reproduced on the unmodified host; the same case working with the focused extension; and one broader requirement the package does not claim to solve. If the baseline already passes, remove the claimed limitation.

## 13. Repository and handoff shape

Proposed layout for the independent repository; this is a plan, not a claim that these files already exist:

```text
DESIGN.md
README.md
src/
  client/             # Experience reader, input, preferences
  server/             # supported module hooks and document operations
  content/            # narrator templates and sample treatments
  shared/             # package-owned schemas
scripts/              # build, manifest/hash generation, compatibility checks
tests/                # behavioral package and host-integration coverage
fixtures/             # original story content, deterministic provider data
docs/
  compatibility.md
  installation.md
  demo.md
  findings.md
  engine-proposals/   # E1–E4 only when supported by evidence
integration/
  engine.lock.json    # exact engine/package/agent pins and patch identities
  patches/            # reviewable candidate patches or their reproducible refs
dist/                 # generated package artifacts; tracked/published by policy
```

The lock file records upstream commit, actual host version/API, example/package pins, patch-series base and identifiers, enabled agent artifact versions/hashes and test environment. Keep credentials, personal stories and raw private provider captures out of fixtures. Record the source and required notices for any code/assets reused; do not copy a complete reference application into this repository.

Preserve a findings entry with this shape: requirement; baseline versions; user-visible symptom; reproduction; mechanism used; host changes required; tests; limitations; maintenance cost; and impact on the StoryEngine comparison. A screenshot is supporting evidence, not a substitute for a reproducible case.

### Initial task for a new implementation conversation

> Read DESIGN.md as the project brief. Begin with M0, then build the best M1 implementation against an unmodified pinned Marinara host. Use supported capability-package and Game Experience mechanisms. Verify installation through the package manager before assuming it works. Keep host changes in a separate checkout and mark every proposed API as proposed until implemented. Progress toward the playable result, collecting concrete evidence for necessary extensions. Do not create a second generation engine, storage system, or permanent fork. Treat the StoryEngine comparison as an open investigation and report results that weaken its rationale as readily as results that support it. Do not publish or contact maintainers without an explicit instruction to do so.

## 14. Source references and revalidation

Engine links below are pinned to the inspected commit. The two agent-package examples are discovery links and must be pinned before implementation because that repository releases independently. A future host may have removed the need for one or more proposed extensions.

- [Capability manifest and API version][schema]
- [Game Experience integration][surface]
- [Capability resource and persistence contracts][runtime]
- [Server module activation API][modules]
- [Prompt-context contributor contract][context]
- [Game generation and final reminder injection][generation]
- [GM system prompt and output format][gm]
- [Narration parser, stacked display and lifecycle][narration]
- [Capability catalog/installation implementation][manager]
- [Current contribution workflow at the baseline][contributing]
- [Pixelforge Experience manifest, moving example][pixelforge]
- [Gacha Forge Home package manifest, moving example][gacha]

[schema]: https://github.com/Pasta-Devs/Marinara-Engine/blob/cc783dd194bacd97379191b9d490939afbe6759e/packages/shared/src/schemas/capability-package.schema.ts
[surface]: https://github.com/Pasta-Devs/Marinara-Engine/blob/cc783dd194bacd97379191b9d490939afbe6759e/packages/client/src/components/game/GameSurface.tsx
[runtime]: https://github.com/Pasta-Devs/Marinara-Engine/blob/cc783dd194bacd97379191b9d490939afbe6759e/packages/shared/src/types/capability-runtime.ts
[modules]: https://github.com/Pasta-Devs/Marinara-Engine/blob/cc783dd194bacd97379191b9d490939afbe6759e/packages/server/src/services/capability-packages/capability-module-runtime.service.ts
[context]: https://github.com/Pasta-Devs/Marinara-Engine/blob/cc783dd194bacd97379191b9d490939afbe6759e/packages/server/src/services/capability-packages/capability-prompt-context.service.ts
[generation]: https://github.com/Pasta-Devs/Marinara-Engine/blob/cc783dd194bacd97379191b9d490939afbe6759e/packages/server/src/routes/generate.routes.ts
[gm]: https://github.com/Pasta-Devs/Marinara-Engine/blob/cc783dd194bacd97379191b9d490939afbe6759e/packages/server/src/services/game/gm-prompts.ts
[narration]: https://github.com/Pasta-Devs/Marinara-Engine/blob/cc783dd194bacd97379191b9d490939afbe6759e/packages/client/src/components/game/GameNarration.tsx
[manager]: https://github.com/Pasta-Devs/Marinara-Engine/blob/cc783dd194bacd97379191b9d490939afbe6759e/packages/server/src/services/capability-packages/package-manager.service.ts
[contributing]: https://github.com/Pasta-Devs/Marinara-Engine/blob/cc783dd194bacd97379191b9d490939afbe6759e/CONTRIBUTING.md
[pixelforge]: https://github.com/Pasta-Devs/Marinara-Agents/blob/main/packages/pixelforge/manifest.json
[gacha]: https://github.com/Pasta-Devs/Marinara-Agents/blob/main/packages/gacha-forge/manifest.json
