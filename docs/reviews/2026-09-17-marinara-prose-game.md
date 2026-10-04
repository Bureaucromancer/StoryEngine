# A prose-first Freeform game in Marinara

**Finding: this is a real present product gap and a plausible bounded Marinara feature.** Replicating StoryEngine's current Freeform interaction or the Aventuras adventure format does not require replicating StoryEngine's entire architecture. For this specific objective, a Marinara Game Experience plus targeted host changes deserves an experiment now, before deciding that a separate engine is necessary.

Inspected on 2026-09-17: Marinara main `cc783dd194bacd97379191b9d490939afbe6759e` (2.4.6, unchanged from the previous review), current StoryEngine Freeform source, and the existing local Aventuras checkout at `8ae0d79a0df0745be3594fa5affcc98dd02c5a75` (August 16, package 0.7.8). Aventuras here is a concrete format reference, not a claim about its latest upstream release. This is source analysis; no prototype or live model comparison was performed.

**The intended experience.** A player reads substantial passages of continuous prose, with dialogue naturally embedded in narration, and responds with an action, speech, private thought, or an authored story event. The narrator manages the world and supporting cast. State and memory persist behind the text; combat, maps, sprites and dice can be optional. Both passage length and continuity across many passages matter. Increasing an output token limit addresses only one small part of this experience.

The distinction also concerns agency. A long response should develop the scene without consuming decisions the player should make. “Think” should remain private; “do” expresses an attempt; “story” establishes an authored event. Aventuras' creative-writing mode goes further and permits the narrator to control the protagonist, so it should not be conflated with its adventure mode or StoryEngine Freeform.

StoryEngine implements narrator/merged dispatch, four input kinds (`do`, `say`, `think`, `story`) and editable prompt fragments for their meanings. Its default narrator uses third-person past tense and preserves the player's dialogue, thoughts and decisions. Difficulty and directedness are separately expressed in prompt fragments. Its current Freeform mode is relatively thin because common services do the rest. Chapters and the full long-story memory design must not be credited as completed Freeform capabilities merely because the design describes them. See [mode](../../packages/modes/freeform/src/mode.ts) and [preset](../../packages/modes/freeform/src/preset.ts).

The inspected Aventuras source has a scrolling story view, bounded rendering of entries for large stories, narrative Markdown rendering, five input choices including free input, configurable viewpoint/tense, response-length instructions, and chapter services. Local reference paths: `C:/Dev/Aventuras/src/lib/components/story/{StoryView,StoryEntry,ActionInput}.svelte`, `src/lib/services/prompts/templates/narrative.ts`, and `src/lib/services/generation/ChapterService.ts`.

**What Marinara already supplies.** Game Mode already has a narrator controlling the world and NPCs, arbitrary player input, an ongoing campaign, game-state tracking, party/NPC context, session summaries and continuation. Its documentation explicitly allows story-driven play without using all the RPG mechanics. There is no evidence here of a fundamental inability to generate or store long prose. [Game guide][game-guide], [sessions][sessions].

**What currently pushes against the format.**

| Layer | Evidence in current code | Consequence |
|---|---|---|
| System framing | `buildGmSystemPrompt` identifies the experience as RPG/VN; a custom GM prompt replaces an instruction section inside that larger construction | A prompt override does not replace every engine-authored assumption |
| Final format reminder | `buildGmFormatReminder` asks for 1–4 sentences per narrative beat, separately tagged speaker/expression lines, and separation of dialogue and narration | The model is encouraged to produce a script-like sequence rather than integrated literary prose |
| Injection order | The Game route bypasses the ordinary preset assembler, adds package context, then appends the GM format reminder as a final user-role message | A package or preset saying “write prose” competes with a later engine instruction; this is not a reliable supported solution |
| Rendering | `GameNarration` parses segments, tracks an active segment and text reveal, and can split even fallback prose into dialogue segments | Styling the current box differently does not fully change the reading model |
| Existing alternative display | `gameDialogueDisplayMode` supports `classic` and `stacked`; stacked builds its history from those same segments | Scrolling exists, but it is still a segmented game transcript rather than a dedicated prose document |
| Turn progression | `GameSurface` uses `narrationDone` in choices, replay-related interaction and queued game events | A replacement reader must integrate with completion and event handling, not simply cover the old component |

Sources: [GM prompts][gm], [generation route][generation], [narration component][narration], [Game surface][surface]. These are formatting and orchestration constraints, not hard per-response word limits. The GM instructions themselves allow longer turns in some situations.

**The best implementation boundary is already partly present.** Marinara's capability manifest has a `game-surface` contribution, optional startup preparation, setup seed/defaults, and a package stylesheet class. The mounted Experience receives `messages`, `latestAssistant`, `isStreaming`, `sendMessage`, game metadata and other state. It can supply player input and choices, and request that the built-in narration collapse. This is much closer to the required extension point than the generic prompt-injection hook alone. [Manifest][manifest], [Experience props][surface].

However, collapse is a temporary UI request, not ownership of the narration lifecycle. The inspected Experience props expose `narrationDone` as state but do not expose an equivalent general callback through which a new reader declares its own completion. The built-in narration remains mounted underneath the Experience. Therefore a pure package might demonstrate the appearance, but a supported implementation should resolve the remaining host contracts explicitly. Building a separate package-owned model-call loop would bypass the conflict at the cost of duplicating valuable Game machinery.

**Recommended design: an Adventure/Freeform Experience within Game, backed by an explicit prose presentation option.** The naming is a proposal. It need not be a fourth top-level `ChatMode`.

1. **Separate prose policy from command instructions.** Add a host-supported narrative format setting. In prose mode, both the system framing and final reminder request integrated paragraphs and ordinary dialogue. Viewpoint, tense, passage length and player agency should agree. Keep necessary state-update instructions distinct so choosing prose does not accidentally disable inventory, location, quest or other persistence.
2. **Provide a continuous story reader.** Reuse the Experience surface for the transcript and input. Render full passages, stream into the current passage, support earlier turns and preserve reading position. Avoid routing prose through the VN dialogue splitter. Render recognized game command outcomes separately from the literary text. Reuse existing commands/state processing for a first implementation; replacing the entire output protocol is a separate project.
3. **Make reader completion explicit.** Introduce a supported way for the prose surface to participate in, or opt out of, segment-based presentation completion. Define when choices and queued events become available, and distinguish generation/postprocessing completion from whether a person has read the text. Preserve interruption, failure, retry, replay and duplicate-action protection.
4. **Add typed input and coherent defaults.** A package can render Do/Say/Think/Story controls. For a credible experiment, input wrappers can instruct the narrator; a durable implementation should preserve input kind in stored metadata and regenerate/history paths. Keep hidden thoughts out of NPC knowledge. Treat Story as an explicit authorial assertion. Default the experience to minimal mechanics and optional imagery.
5. **Reuse continuity first, then measure gaps.** Begin with existing session summaries, world/NPC state and available retrieval. An Aventuras-style chapter is not automatically equivalent to a Marinara campaign session: chapter boundaries, navigation, summaries and older-event retrieval may require additional work. Prove long-story continuity separately from successful long passages.

This is a cross-layer feature, not just a prompt pack. It is nevertheless a much narrower undertaking than migrating StoryEngine's accounts, object storage, actor identity and turn/effect model into Marinara. An exact effort estimate would be premature until the reader lifecycle and command interactions have been prototyped.

| Route | Suitability for this objective |
|---|---|
| Roleplay with a narrator card and custom preset | Fastest no-core-change approximation for testing whether prose-first play is enjoyable; does not establish equivalence to the complete Game experience |
| Game prompt override plus stacked display | Useful partial approximation, but retains competing format instructions and segmentation |
| Game Experience plus targeted host changes | Best candidate for a durable integrated feature: reuse Game backend/state while changing narration and interaction |
| Fourth top-level mode | Consider only if the required state/turn behavior genuinely diverges; prose presentation alone does not justify it |
| Permanent fork/replacement engine | Not justified by this feature gap alone; broader StoryEngine requirements could still justify independence |

**The first experiment should answer this exact question.** Start a prose-first Game with a protagonist and two supporting characters. Generate a substantial scene containing several paragraphs and integrated dialogue; submit each typed input; make a consequential state change; retry, branch and reload; conclude/resume a session. Inspect the actual outgoing prompt to confirm that VN-only format instructions are absent. Verify that command processing, choices and the next input do not depend on clicking through an invisible segmented reader. Compare the result with the inspected StoryEngine/Aventuras interaction, using the same model where possible.

Use a short sequence to validate the new presentation and lifecycle, then a separate extended session to test memory. A pretty transcript after three turns proves neither branch correctness nor long-form continuity. Conversely, a successful experiment would weaken the standalone argument substantially if this is the user's main unmet need: it would demonstrate that the desired experience can live on Marinara's existing platform.

[game-guide]: https://github.com/Pasta-Devs/Marinara-Engine/blob/cc783dd194bacd97379191b9d490939afbe6759e/docs/game/getting-started.md
[sessions]: https://github.com/Pasta-Devs/Marinara-Engine/blob/cc783dd194bacd97379191b9d490939afbe6759e/docs/game/sessions-and-saves.md
[gm]: https://github.com/Pasta-Devs/Marinara-Engine/blob/cc783dd194bacd97379191b9d490939afbe6759e/packages/server/src/services/game/gm-prompts.ts
[generation]: https://github.com/Pasta-Devs/Marinara-Engine/blob/cc783dd194bacd97379191b9d490939afbe6759e/packages/server/src/routes/generate.routes.ts
[narration]: https://github.com/Pasta-Devs/Marinara-Engine/blob/cc783dd194bacd97379191b9d490939afbe6759e/packages/client/src/components/game/GameNarration.tsx
[surface]: https://github.com/Pasta-Devs/Marinara-Engine/blob/cc783dd194bacd97379191b9d490939afbe6759e/packages/client/src/components/game/GameSurface.tsx
[manifest]: https://github.com/Pasta-Devs/Marinara-Engine/blob/cc783dd194bacd97379191b9d490939afbe6759e/packages/shared/src/schemas/capability-package.schema.ts
