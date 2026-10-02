# StoryEngine and Marinara: a baseline for the beta re-review

Review date: **2026-09-16**. Recommendation: **continue StoryEngine to a bounded, use-tested beta; investigate a Marinara capability package before considering a permanent fork.** Reconsider the recommendation if StoryEngine's distinctive mechanisms do not improve actual play and authoring enough to justify their maintenance.

This is a source-and-documentation review, not a hands-on comparison of narrative quality. Neither application's tests were run for this review. Implementation and test presence are evidence of mechanisms, not evidence that all workflows pass. No maintainer discussion, contribution, or migration was undertaken.

The snapshots are StoryEngine `af23e8df0425ded5bac5036262c9c545a464cd62` (local HEAD, September 15; package version `1.0.0-alpha.4`) and Marinara main `cc783dd194bacd97379191b9d490939afbe6759e` (September 15; package version `2.4.6`). Marinara was inspected through a fresh shallow clone of its public repository. Main is its released line; staging and the separately released agent packages may advance independently. A future review must pin all relevant versions again.

## What is actually being compared

StoryEngine has a narrower product and a more uniform internal model: character-driven fiction in Scene and Freeform, built around inspectable turns, budgeted context, validated channel changes, a portable library, and account ownership. Marinara is a broader local chat, roleplay, and game application with substantially more providers, media, optional agents, platform packaging, and ecosystem integration. Its stated audience includes both nontechnical users and power users. Neither project's version number proves stability: StoryEngine is alpha, and Marinara's README still carries an alpha warning alongside its stable release label. [Marinara product brief][m-product], [release overview][m-readme].

StoryEngine's top-level README lags its current implementation. It describes four library kinds as read-only, but P7B has merged the missing preset, treatment, setup, and package editing surfaces. P7B's own status correctly says that its code is merged while its critical manual gate remains open. P8 is ready to start, rather than implemented: rolling summaries and cross-session memory must not be credited as present features. P9–P11 still contain substantial media, delivery, usability, export, backup/restore, and beta work. Write, Character Studio, World, and Campaign are later release scopes, not current advantages.

StoryEngine evidence: [P7B status and delivered scope](../design/workplan/24-p7b-presets-and-prompts.md), [P8 status](../design/workplan/25-p8-implementation.md), [P11 scope](../design/workplan/28-p11-implementation.md), [release scope](../design/workplan/04-repo-and-releases.md).

| Area | StoryEngine at this snapshot | Marinara at this snapshot | Strategic implication |
|---|---|---|---|
| Playing and directing fiction | Scene and Freeform packages; hooks, confirmed goals, presence/party channels, difficulty and directedness, suggestions, staged sprites/backdrops | Conversation, Roleplay, Game; GM systems, quests/combat, trackers, narrative direction, extensive visual/audio features | More storytelling controls alone are a weak reason for a separate application. The workflow and state semantics must earn it. |
| Prompt inspection | Stored blocks with sources, inclusion/budget decisions, rendered messages, calls, effects, and turn comparison | Role-based assembly, exact saved text-prompt inspection, lore activation and budget-skip reporting, agent debug information | Inspection is shared territory. StoryEngine's distinction is the connected explanation across the whole turn. |
| Branching and state | Append-only turn ancestry and channel reconstruction, with property tests over branching histories | Chat/message copying plus snapshots and feature-specific restoration/remapping, including memory and game state | Both branch. The difference is how reliably new stateful features inherit branch behavior. |
| Library and identity | Six portable kinds; actor covers persona and NPC roles; per-object storage and history | Character/persona distinction; lorebooks, presets, chat settings, imports, and reusable package-owned documents | StoryEngine's authoring model is distinctive; some of its content concepts now have plausible package-level homes in Marinara. |
| Users and hosting | Accounts and account-rooted storage/access; server deployment is part of the design | Explicitly local/single-user; shared install authentication and remote-access controls | A household server with independent account ownership remains a substantial difference. Multiple personas or devices do not establish that capability. |
| Memory and retrieval | Working lore retrieval; long-term memory and rolling summaries remain P8 work | Implemented memory/summary integrations and optional knowledge agents | Marinara has the present feature advantage. StoryEngine's future memory guarantees need implementation and use evidence. |
| Extension model | Separate Scene/Freeform packages consume the SDK; declared channels, steps, setup and surfaces | Downloadable capability modules with resource/model APIs, documents, transactions, chat locks, prompt contribution and events | A Marinara package is a serious fourth option, alongside standalone, upstream core work, and a permanent fork. |
| Providers and delivery | Current factory builds OpenAI-compatible chat only; private alpha/container workflow | Broad provider/media support and multiple installation paths | These are expensive recurring obligations StoryEngine can avoid only by keeping its scope deliberately narrow. |

Code behind the comparison: StoryEngine [turn record](../../packages/shared/src/turn.ts), [effect acceptance](../../packages/server/src/turns/effects.ts), [reconstruction tests](../../packages/server/src/sessions/reconstruct-property.test.ts), [mode contract](../../packages/sdk/src/mode.ts), [provider factory](../../packages/server/src/providers/factory.ts); Marinara [assembler][m-assembler], [prompt inspection and branching routes][m-chats], [branch-state helpers][m-branch], [capability contract][m-capability].

## What the August decision gets right, and what should change

The existing [build-versus-fork decision, §2A](../design/workplan/02-triage.md) should remain as a historical decision. Its evidence and forecasts should not be carried forward unchanged.

**The ownership mismatch still holds.** Marinara's contribution guide explicitly describes a single-user deployment model, and the inspected storage schema and resource contract do not provide StoryEngine-style account ownership. Retrofitting that dimension into a full application remains costly. However, decide whether it is a real usage requirement: isolated Marinara instances per person might be adequate if shared library administration and in-app account management are unnecessary. That is a concession to assess, not an equivalent implementation. [Contributor guide][m-contributing], [resource contract][m-capability].

**The storage mismatch still holds, with a material refinement.** Marinara storage format 5 shards every table by an owning entity or primary key. That improves write granularity and recovery. It still stores relational rows across table directories; it is not StoryEngine's self-contained object folder plus rebuildable index. Entity ownership in this sharding scheme is not user-account ownership. Both designs are file-backed; only one makes the portable library object the primary storage unit. [Storage architecture][m-storage].

**The “no test suite” argument must be withdrawn.** The filename measurement remains literally true but its interpretation is wrong. At the reviewed snapshot, Marinara has zero `*.test.ts(x)`/`*.spec.ts(x)` files inside package source, but **282 `*.regression.ts`/`*.regression.mjs` files under scripts/regressions and 37 browser test files under e2e**. The sampled context-fit regression executes the real implementation and asserts behavior; these are not merely file-content guards. CI includes a complete Node regression job and browser jobs. This does not establish coverage of every proposed architectural change, but it decisively rules out describing Marinara as untested. [Behavioral regression example][m-regression], [CI workflow][m-ci].

For reproducibility, raw TS/TSX line counts under package `src` directories were 163,919 for StoryEngine, including 76,813 lines across 231 colocated test files, and 565,281 for Marinara. Counts include comments and blank lines; Marinara's regression/e2e files are outside that source scope, and optional agent code lives in a separate repository. These are rough scope indicators, not a productivity, quality, or coverage score. Never compare StoryEngine's test-inclusive total with Marinara's production-source total as if they measured the same thing.

**The “frontends that assemble a string” framing is too broad.** Marinara assembles role-based messages, preserves exact saved text prompts, distinguishes historical exact inspection from a best-effort current preview, and returns lore activation and budget information. It also has server-side generation that can continue after a passive client disconnect. The stronger distinction is StoryEngine's uniform provenance and state contract, rather than a claim that Marinara cannot inspect prompts or orchestrate generation. Exact text-prompt capture also must not be inflated into a guarantee of complete provider-wire replay in either project. [Assembler][m-assembler], [inspection endpoint][m-chats], [generation lifecycle][m-generation].

**Upstream contribution is more feasible than the old argument allows.** Marinara's capability contract now offers reusable JSON documents with revisions, resource creation, model calls, transactions, locks, spatial snapshots, and roleplay events. Its prompt-context registry accepts package contributions. These are concrete places to attempt a treatment library or plot-hook controller without replacing the host application. They do not yet constitute StoryEngine's generic mode/channel/turn contract: ChatMode remains the three-value union, and prompt contribution is primarily text, not a universal block-budget/effect protocol. [Capability contract][m-capability], [module activation API][m-modules], [prompt contributions][m-context], [chat types][m-chat-types].

**The velocity and governance conclusions need weaker wording.** The August nine-day commit sample cannot forecast the cost of finishing beta, maintaining releases, or onboarding users. A missing historical scenario branch does not prove that maintainers reject scenarios, nor that a present contribution would fail. Marinara does require outside contributors to obtain the owner's approval and target staging, but that is a coordination condition, not evidence of hostility. Maintainer interest in a concrete proposal remains unknown. [Contribution rules][m-contributing].

## What deserves to remain independent

The strongest standalone case is a combination of requirements:

1. **Correctable explanations:** a user can trace an unwanted response or state change to the source material and decision that produced it, change the relevant input, and compare the result.
2. **Consistent branch behavior:** a newly added stateful mechanic uses the same validated effects and reconstruction as existing mechanics, instead of adding another branch-repair routine.
3. **Portable authoring:** actors, treatments, lorebooks and prompt packs are understandable reusable artifacts with visible history and ownership.
4. **Independent users:** multiple people can use one managed install with the intended account and content boundaries.

These mechanisms exist in meaningful form today. They should not be described as fully proven. For example, current effect application accepts whole-value channel sets, even though the type vocabulary contains additional operations. P8's audit also identifies gaps in the existing contract around source filtering and advisory content. The SDK has been exercised by two built-in modes, not by a mature third-party ecosystem. Reconstruction of recorded state does not promise byte-identical fresh LLM responses.

The decisive question is whether those properties save effort or improve stories. A user who almost never opens the workbench, uses one persona on one computer, and primarily wants expressive characters, memory and media may gain little from them. A user who repeatedly repairs long-running stories, branches consequential state, reuses authored treatments, or hosts a household may gain a great deal.

The standalone case should therefore be framed as a specialized product with measurable benefits, not a race to match Marinara's catalog. Completing the existing beta specification is already substantial; adding more parity features would obscure this test.

## The four paths and their costs

| Path | What it buys | What it costs or concedes | When to choose it |
|---|---|---|---|
| Continue StoryEngine | Full control of the engine and authoring model; existing implementation remains useful | Own delivery, compatibility, maintenance, UI, documentation and support; smaller ecosystem | Distinctive workflows prove valuable and maintenance remains sustainable |
| Marinara capability package | Existing application, providers and distribution; relatively bounded feature ownership | Adapt to host identity/storage/branch behavior; verify extension seams and compatibility | Desired storytelling experience mostly fits existing modes and package APIs |
| Upstream Marinara core contributions | Shared ownership and delivery if accepted; wider reach without permanent divergence | Maintainer agreement, staged changes, migration design and ongoing support | Specific additions benefit Marinara's product and maintainers want them |
| Permanent Marinara fork | Immediate control of a broad application and access to its existing features | Both product maintenance and recurring upstream integration; potentially invasive foundation changes | A prototype demonstrates a small durable patch set, or the value of consciously abandoning upstream tracking exceeds its costs |

**A permanent fork is currently the least attractive default.** Replacing ownership, storage and turn semantics consumes exactly the common code that makes upstream updates useful. But “never fork” is stronger than the evidence supports: a narrowly scoped downstream could be sensible if most of StoryEngine's architectural requirements are deliberately relaxed. Measure the patch set before deciding.

**An embedded StoryEngine runtime is possible in principle, but not automatically cheap.** A service boundary can avoid translating every internal type, while still leaving two persistence models, two identities, lifecycle coordination, errors, and UI integration to maintain. Treat this as a prototype hypothesis; merely displaying StoryEngine in a Marinara panel would not establish a unified product.

Existing StoryEngine code is not a reason to continue solely because of past effort. It is, however, a usable asset that lowers the remaining cost of the standalone option. Conversely, discarding an engine does not require discarding its concepts, fixtures, or behavioral tests. Compare future costs and retained benefits from today's state.

## A concrete beta re-review

Run this when the current core and memory workflows have been exercised and the beta candidate is sufficiently stable for comparison. Do not wait for every cosmetic item before learning whether the product is worth maintaining. There is no automation or future reminder created by this document.

**First, establish a common workload.** Use the same imported cast, setting, treatment, model and comparable context/output limits where supported. Record unavoidable differences. Alternate which application is used first. Use more than one session, since narrative quality varies between calls. Record time to first satisfactory scene, manual corrections, tokens/calls, latency, and whether the user wants to continue playing.

| Exercise | What to measure | What could change the decision |
|---|---|---|
| Long story under context pressure | Resume a substantial session; inspect an omission or contradiction; repair it and continue | StoryEngine's workbench and budget model provide no practical improvement over Marinara's inspection/memory tools |
| Consequential branching | Branch before a death, relationship change, hook, or goal completion; reroll and switch branches; inspect state and later memory | Leakage or repair burden erases StoryEngine's supposed state advantage, or Marinara proves equally reliable for the actual mechanics used |
| Reusable authoring | Create and revise a treatment, start two sessions, change the original, and inspect what changed in each session | Marinara package documents and setup flows provide the same useful experience with acceptable identity/storage compromises |
| Household hosting, if required | Two real accounts, independent stories/credentials/content, administrative maintenance | The requirement is unused, or separate Marinara instances are an acceptable operational solution |
| Interruption and recovery | Disconnect/reconnect clients, interrupt calls, restart the server, recover a backup on a fresh install | Deployment or recovery costs dominate the value of the engine; compare each failure separately rather than claiming generic “resumability” |
| Extension implementation | Add the same small stateful storytelling feature, including UI, validation and branch behavior | StoryEngine's SDK does not make the work materially easier, or Marinara can deliver it through a small stable package |

**Second, build one time-boxed Marinara integration spike.** A suitable proposed limit is five focused development days, agreed as a budget rather than forecast. Use a treatment document that prefills a session and a small hook/goal feature with visible provenance. Start with existing Roleplay or Game plus a capability package; only propose a new chat mode if the interaction actually needs one. Exercise branching and memory as part of the spike. Merely injecting a paragraph into the prompt is insufficient evidence of equivalence.

Record core files changed, APIs missing, storage migrations, duplicate state, branch-specific repair, and which StoryEngine requirements were conceded. Test the package across a subsequent upstream revision. If it needs architectural replacements immediately, that is evidence against migration. If it delivers the desired experience through supported seams, the contribute/package path becomes substantially stronger. A prototype is future work, not something this review implemented.

**Third, resolve the social and maintenance inputs.** Once there is a concrete proposal, ask maintainers which portions they want in Engine, which belong in Marinara-Agents, and what they would maintain. A package, an upstream feature, and a new core mode are different proposals. Compare several weeks of actual repair, dependency, release and support work on StoryEngine with the integration work observed in the spike. Do not substitute commits, lines of code, stars, or automated code-generation speed for that measurement.

**Decision rule:** continue independently if the distinctive workflows repeatedly matter, beta remains reachable, and the maintenance cost is acceptable. Prefer a package or upstream contribution if the desired experience fits Marinara with a small supported change surface and the discarded architectural requirements are genuinely dispensable. Choose a permanent fork only after measuring a durable downstream boundary. If neither option yields enjoyable, maintainable storytelling, reduce or revise the product scope rather than letting feature completion decide by inertia.

[m-readme]: https://github.com/Pasta-Devs/Marinara-Engine/blob/cc783dd194bacd97379191b9d490939afbe6759e/README.md
[m-product]: https://github.com/Pasta-Devs/Marinara-Engine/blob/cc783dd194bacd97379191b9d490939afbe6759e/PRODUCT.md
[m-contributing]: https://github.com/Pasta-Devs/Marinara-Engine/blob/cc783dd194bacd97379191b9d490939afbe6759e/CONTRIBUTING.md
[m-storage]: https://github.com/Pasta-Devs/Marinara-Engine/blob/cc783dd194bacd97379191b9d490939afbe6759e/docs/development/file-storage.md
[m-assembler]: https://github.com/Pasta-Devs/Marinara-Engine/blob/cc783dd194bacd97379191b9d490939afbe6759e/packages/server/src/services/prompt/assembler.ts
[m-chats]: https://github.com/Pasta-Devs/Marinara-Engine/blob/cc783dd194bacd97379191b9d490939afbe6759e/packages/server/src/routes/chats.routes.ts
[m-generation]: https://github.com/Pasta-Devs/Marinara-Engine/blob/cc783dd194bacd97379191b9d490939afbe6759e/packages/server/src/routes/generate.routes.ts
[m-branch]: https://github.com/Pasta-Devs/Marinara-Engine/blob/cc783dd194bacd97379191b9d490939afbe6759e/packages/server/src/services/game/branch-state.ts
[m-capability]: https://github.com/Pasta-Devs/Marinara-Engine/blob/cc783dd194bacd97379191b9d490939afbe6759e/packages/shared/src/types/capability-runtime.ts
[m-modules]: https://github.com/Pasta-Devs/Marinara-Engine/blob/cc783dd194bacd97379191b9d490939afbe6759e/packages/server/src/services/capability-packages/capability-module-runtime.service.ts
[m-context]: https://github.com/Pasta-Devs/Marinara-Engine/blob/cc783dd194bacd97379191b9d490939afbe6759e/packages/server/src/services/capability-packages/capability-prompt-context.service.ts
[m-chat-types]: https://github.com/Pasta-Devs/Marinara-Engine/blob/cc783dd194bacd97379191b9d490939afbe6759e/packages/shared/src/types/chat.ts
[m-regression]: https://github.com/Pasta-Devs/Marinara-Engine/blob/cc783dd194bacd97379191b9d490939afbe6759e/scripts/regressions/context-fit.regression.ts
[m-ci]: https://github.com/Pasta-Devs/Marinara-Engine/blob/cc783dd194bacd97379191b9d490939afbe6759e/.github/workflows/playwright.yml
