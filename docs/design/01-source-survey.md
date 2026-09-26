# 01 — Source survey

What the three codebases actually do, and what each is worth taking.

**Confidence note.** This survey is based on a targeted read, not an exhaustive
one. What was actually examined:

- **Marinara Engine** — `PRODUCT.md`, `DESIGN.md`, the `docs/` tree for game /
  conversation / roleplay / characters / prompts / lorebooks / agents,
  `packages/shared/src/types/{character,chat,game,capability-runtime}.ts`,
  `packages/shared/src/features/folder-packages/`, the package/service directory
  layout, and the `feat/scenarios` branch's `scenario.ts` plus its four design
  plans under `.github/plans/scenarios/`.
- **Aventuras** — `src/lib/types/index.ts` (977 lines, read in part),
  `src/lib/stores/wizard/*`, `src/lib/services/packs/types.ts`,
  `src/lib/services/context/*`, `src/lib/services/generation/*` (phase list and
  pipeline types).
- **SillyTavern** — `src/users.js`, `src/constants.js`,
  `src/character-card-parser.js`, `public/scripts/group-chats.js` (activation and
  generation modes), endpoint and directory layout.
- **Both projects' image subsystems**, added 2026-09-03 — Aventuras'
  `services/generation/phases/{Image,BackgroundImage}Phase.ts`,
  `services/ai/image/*`, `services/ai/sdk/schemas/imageanalysis.ts` and
  `services/prompts/templates/image.ts`; Marinara's
  `routes/game.routes.ts` storyboard path, `services/game/game-asset-generation.ts`,
  `services/roleplay/storyboard-episode.ts`,
  `shared/src/constants/game-storyboard-prompts.ts` and the Illustrator agent in
  `routes/generate.routes.ts`. The two *How it generates images* sections below
  are what that read found.

  *Marinara caveat:* commit `f1e688c12` moved the storyboard planner prompt
  bodies out of the repository into an installable agent package fetched at
  runtime, leaving only the host contract. Prompts quoted below are the last
  in-repo copies, read via `git show f1e688c12^:…`, and the shipped package's may
  have moved on.

Not examined in any depth: client component trees, extension/plugin runtimes in
detail, TTS and video subsystems, tokenizers, Marinara's tactical combat engine,
Aventuras' retrieval implementation. Assertions about those areas are inference
and should be read as such — a promise this document previously made in the form
*"and marked as such"*, which it never kept: no claim anywhere below carries an
inference marker. Stating the caveat once here is honest; the per-claim version
was not. (The Noodle subsystem was on this list until it was read; the notes are
at [24 §4.6](24-roadmap.md), and [triage §9](workplan/02-triage.md) had already
struck it here.)

---

## 1. Marinara Engine

A pnpm monorepo (`packages/{client,server,shared}`) — Node/TypeScript server,
React client, file-native storage, Docker and Android packaging. Structurally
the most modern of the three and the closest to what StoryEngine wants to be.

*Corrected 2026-08-18.* This said **SQLite-plus-file storage**, which was true
when surveyed. Marinara now persists relational tables as JSON snapshots under
`storage/tables/` — a database that writes files, which is not the same claim as
[00 §3.4](00-stance.md)'s. The distinction is load-bearing for
[triage §2A](workplan/02-triage.md).

### The library on disk — surveyed 2026-08-29, at `34442e26d`

*Added 2026-08-29, because P4 needed it and no document had it.* The correction
above was the whole of what this corpus recorded about where a Marinara library
lives, and the layout it names has since been superseded. Everything below is
`Pasta-Devs/Marinara-Engine` v2.4.3 at
`34442e26da577ff0d95ee890a87024e35831bfa9` (2026-08-18) — **pinned, because an
unpinned survey of this repository is stale on arrival**
([triage §2A.2](workplan/02-triage.md) measured 712 commits in nine days).

**A data root is a store beside its assets.** `storage/manifest.json` carries
`{ version, savedAt, backend: "file-native", tables: { name: rowCount },
shards? }` (`packages/server/src/db/file-backed-store.ts:89`, `:1034`,
`:3009`); `storage/tables/` holds the rows; and seventeen asset directories sit
beside `storage/` — `avatars`, `sprites`, `backgrounds`, `gallery`, `fonts`,
`lorebooks/images`, `prompts/images` and ten more, enumerated once as
`BACKUP_DIRS` (`packages/server/src/routes/backup.routes.ts:67`).

**The rows are not one file per table.** At storage format 4
(`STORAGE_VERSION`, `file-backed-store.ts:239`) sixteen tables shard into
`storage/tables/<table>/<shardKey>.json`, with children whose parent is unknown
collected under `orphaned-rows.json`; every other table stays
`storage/tables/<table>.json`, a JSON array of rows. The sharded sixteen
(`SHARDED_TABLES`, `file-backed-store.ts:259`) are *exactly* the chat- and
session-scoped tables — `messages`, `message_swipes`, `memory_chunks`, the
`game_*` and `conversation_call_*` families — and nothing else, which means the
half of the store a library import would read is entirely flat, `lorebooks`
deliberately so.

**The manifest states the version and cannot be trusted for the layout.** A
lost manifest is recovered from its `.bak` or inferred from the tables
themselves, and a crash between the shard migration and its first flush leaves
sharded data sitting under a version-2 manifest — Marinara's own comment says
so (`file-backed-store.ts:2596`). Which shape a table is in is a question for
the filesystem: a directory, or a file.

**An object is a join, not a file.** A character is `characters` plus
`character_card_versions`, `character_images` and a file under `avatars/`; a
lorebook is `lorebooks` plus `lorebook_entries`, `lorebook_folders` and the two
link tables; a preset is `prompt_presets` plus `prompt_sections`,
`prompt_groups` and `choice_blocks`. This is the structural difference from
SillyTavern that matters most, and §4's concept table understates it: ST's tree
is one file per object; Marinara's is a relational store that happens to be
written as files. A row in `characters.json` carries its card in a `data`
**string** — JSON inside JSON.

**Three shapes leave the app**, all of which a person can hand an importer: the
data root itself; a profile archive, the same tree zipped behind a
`ProfileArchiveStorageSnapshot` (`backup.routes.ts:254`); and a single-object
`.marinara.json` — an `ExportEnvelope { type, version, exportedAt, data }` over
eight `ExportType` values covering characters, personas, lorebooks, presets and
the profile itself (`packages/shared/src/types/export.ts:8`).

**What a reader meets that is not data.** A live install saves on a 750 ms
debounce and marks itself with `.writer-lease` and `owner.json`
(`file-backed-store.ts:240-241`); a store part-way through the
monolith-to-shard migration carries `.migrating` (`:297`); tables and the
manifest may each have a `.bak` sibling, which is a second copy of the same
rows rather than more of them. The store refuses outright to open a format
newer than it knows (`StorageFormatTooNewError`, `file-backed-store.ts:2569`).
And the data root holds `.encryption-key`
(`packages/server/src/utils/crypto.ts:56`) — a credential, not content, and one
Marinara's own backup writer deliberately omits from the archive it builds
(`backup.routes.ts:3121`).

**`feat/scenarios` is gone from the remote but not lost.** A local checkout at
`a5b72ef91b8867c2e3bff547ad25d1df2f0eb8c6` (2026-08-04) preserves
`packages/shared/src/types/scenario.ts` and the four design plans under
`.github/plans/scenarios/` that [triage §4](workplan/02-triage.md) called worth
more than the code. Nothing scenario-shaped ships, so that verdict stands; what
changes is that the design is readable rather than only remembered.

### What it gets right and we should take

**Three chat modes as a first-class concept.** `ChatMode = "conversation" |
"roleplay" | "game"` (`packages/shared/src/types/chat.ts:15`). The modes are
genuinely different products sharing a substrate, and the docs treat them that
way. This is the shape StoryEngine wants.

**`GroupChatMode = "merged" | "individual"`** (same file, line 18) — exactly the
axis requested: combine multi-character turns into one call, or give each
character its own call. It already exists here and is worth studying rather than
reinventing.

**The Game Mode setup wizard** (7 steps: connection, world, party, goals,
lorebooks, features, GM) and its **immutable setup snapshot** — the campaign
records the setup that created it, so a player can play first and decide the
combination is worth sharing afterward. Explicitly excludes credentials, server
URLs, API keys and local ids from the shared text. This is the seed of the
"full game package as a first-class export" requirement and it already has the
content/production split half-solved.

**GM Mode as a modal distinction**: `GameGmMode = "standalone" | "character"` —
a synthesised narrator versus one of your own cards *acting as* narrator. This is
the narrator/embodied distinction the requirements ask for, and it should be
generalised (see [06 §3](06-modes-and-turn-pipeline.md)).

**`gameExperienceId` + `experienceConfig`** (`types/game.ts:201-207`) — a game
may be driven by an installed package that "draws its own surface over the shared
narration", with its setup config "stored verbatim and never interpreted by the
host". This is *precisely* the "game mode as a specification for extensions"
requirement, already prototyped. Take the idea; it is currently one field on a
70-field config struct, and it deserves to be the primary mechanism.

**`CapabilityRuntime`** (`types/capability-runtime.ts`) — extensions get typed,
narrow record access (`CapabilityCharacterRecord`, `CapabilityLorebookCreateInput`,
a closed `CapabilityLorebookCategory` union with the comment "spelled out here
rather than left as a free string so a wrong value is a compile error in the
package instead of a silent rejection at write time"). That instinct is exactly
right and should be the model for StoryEngine's extension API.

**The `feat/scenarios` design work is the single most valuable artefact in any of
the three repos.** `.github/plans/scenarios/scenarios-consumption-design.md`
contains, already worked out: the prefill-not-binding principle; the narrative /
production field seam and why it is the most important decision; dangling-link
tolerance; the analysis of why an unbudgeted always-on framing slot degrades
badly; and — in §3.3 — the explicitly deferred reframe:

> make **Setting** the first-class entity and scenarios its children — one
> durable world, many entry points into it … A setting would own the world prose
> plus a lorebook.

Quoted verbatim; *Setting* is Marinara's word. StoryEngine adopted the reframe and
renamed the object **Treatment** ([04 §6](04-schemas.md)) — the parent here is the
stance on a world, not the world, and every material-word invited the opposite
reading.

That deferred reframe is what the StoryEngine requirements independently ask for.
It should be adopted as the starting point rather than a later refactor.

**Conversation mode's feature set** is the strongest realisation of MMS-style bot
chat in the three: presence status, weekly schedules, autonomous first-contact
messages, reactions, selfies, cross-posting, per-character Discord-style
profiles, and a gated command-family system (17 families under one master
toggle). The *gating design* is good: package-owned commands only appear when the
package is installed.

### What it gets wrong and we should not copy

**The card type.** `CharacterExtensions` (`types/character.ts`) is a V2 card
plus fifteen engine fields, several annotated "Conversation mode ONLY … Never
read in RP/VN/Game", terminated by `[key: string]: unknown`. The comments are
doing the work a type should do. See [00 §2.4](00-stance.md).

**`GameSetupConfig`** — a ~70-field flat struct mixing narrative content
(`genre`, `setting`, `tone`, `playerGoals`) with production settings
(`imageConnectionId`, `videoConnectionId`, `gameStoryboardKeyframeCount`,
`spotifyPlaylistId`). Marinara's own scenario design has to carefully enumerate
which half a scenario may write. StoryEngine should split the struct so the
enumeration is unnecessary.

**Big-bang world generation and the Repair JSON modal.** See
[00 §2.3](00-stance.md).

**Duplicated systems across modes** — RP combat vs Game combat, RP HUD/trackers
vs Game HUD widgets, RP scenes vs Game sessions. See [00 §2.7](00-stance.md).

**Feature surface as identity.** Spotify integration, haptics, six table games,
UNO and 8-ball as installable agent packages, Echo Chamber, storyboards, anime
episode directors. Individually defensible; collectively they define the product
as "everything". StoryEngine should ship a much smaller core with the seams that
would let all of that be built externally.

### How it generates images — surveyed 2026-09-03

**One planner call per turn, and it decides both the count and the prompts.**
`POST /game/storyboard/generate` builds one `game_turn_storyboards` row per
(chat, message, swipe) owning N `game_turn_storyboard_keyframes`. The call
returns free-form JSON — `responseFormat: { type: "json_object" }` against a
one-line shape string, no tool definition and no JSON Schema — validated by
hand-written normalisers.

**`gameStoryboardKeyframeCount` is a soft target and a hard ceiling, and never a
floor.** Bounds are 1–6, default 3, resolved per-request → per-chat → agent
global. It is interpolated into the planner prompt (*"Create exactly
`${keyframeCount}` ordered keyframes unless the narration is too short to support
that many"*, and for the animation presets *"return fewer shots rather than
duplicating moments, padding the plan, or inventing events"*) and enforced
downward by `.slice(0, keyframeCount)` then a second `.slice(0, 6)` in
`sanitizeStoryboardPlan`. Nothing pads back up — **except** the deterministic
fallback used when the planner call fails, which chunks the narration into
exactly N frames with a hardcoded prompt string. The one code path that runs
without a judgement is the one that manufactures moments.

**Keyframes are anchored into the narration**, by `anchorQuote` plus
`sectionStartIndex`/`sectionEndIndex` over a client-supplied section list, which
is how a storyboard frame knows which sentence it illustrates.

**The prompt is written by the planner and then wrapped by a formatter
template** that adds visibility rules, matched character appearance, reference
handling, location context, art direction and user instructions. Real character
reference *images* are attached for consistency, up to a provider-derived limit
running from 1 to 16 by backend, with a spatial location reference consuming one
slot. Several length budgets are enforced in code, up to 7000 characters on the
compiled prompt.

**It feeds the count forward into the narrator.** The GM system prompt carries
`{{gameStoryboardKeyframeCount}}` — *"Aim to include N strong visual anchor
moments when the scene and pacing support them"* — so the production setting
this section already criticises `GameSetupConfig` for mixing in with narrative
content also steers the prose. [06 §10.6](06-modes-and-turn-pipeline.md) declines
that coupling and says why.

**Timing.** The planner call blocks the HTTP request; image rendering is detached
behind it at a frame concurrency of 4, and the client polls a status field every
2.5s. There is no queue and no SSE for storyboards. A per-chat mutex serialises
asset generation.

**The separate Illustrator agent is the only per-turn *whether* judgement in
either project**: a `shouldGenerate` boolean — *"Only illustrate when the moment
deserves a picture"* — gated by a `runInterval` cadence defaulting to 5, counted
over messages since the last *successful* run. It is mutually suppressed with the
storyboard path. Its image count is a variation count (1–4 renders of one
prompt), not a count of moments.

**No cost gate of any kind**, here or anywhere: no credit, quota, budget or tier
check. Marinara is self-hosted, so the bill is the operator's problem and the
code never mentions it.

---

## 2. Aventuras

A SvelteKit + Tauri app (Svelte 5 runes), Vercel AI SDK across ~8 providers,
local database, single-user desktop-shaped. Version 0.7.8. The smallest and most
coherent of the three.

### The library on disk — surveyed 2026-09-26, at `c43da108`

*Added 2026-09-26, for [P13](workplan/30-p13-aventuras-import.md).* "Local
database" was the whole of what this corpus recorded about where an Aventuras
install lives, and the three export paths [P4 §1.5](workplan/16-p4-implementation.md)
found were found in the source rather than here. Everything below is
`AventurasTeam/Aventuras` v0.7.11 at
`c43da108f6b3679950e76afe020f6b26abf0c9ce` (2026-09-25), pinned for the reason
Marinara's survey above gives.

**One SQLite file holds the install, settings included.** `aventura.db`, opened
by `tauri-plugin-sql` from the WebView and by `sqlx` from Rust
(`src-tauri/src/db.rs`). It resolves against Tauri's **app config directory**,
not its data directory — `docs/architecture/persistence.md` says so because
their own native code once opened a database that did not exist — under the
bundle id `com.karelian.aventura`:

| Platform | Path |
|---|---|
| Linux | `~/.config/com.karelian.aventura/aventura.db` |
| macOS | `~/Library/Application Support/com.karelian.aventura/aventura.db` |
| Windows | `%APPDATA%\com.karelian.aventura\aventura.db` |
| Android | app-private storage; reachable only through the in-app backup |

Settings are rows in a `settings` key/value table in the same file, provider
keys among them in plain text (`api_profiles`, `openai_api_key`). There is no
second store.

**WAL mode, and no lease.** A running install has `aventura.db-wal` and
`-shm` beside the database, and the bare `.db` can be missing committed writes
— Aventuras' own backup refuses to archive it for exactly that reason
(`backupService.ts`). Nothing marks a live install the way Marinara's
`.writer-lease` does; a `-wal` is equally the residue of a crash.

**The schema is versioned by sqlx.** Thirty-nine files in
`src-tauri/migrations/`, applied at startup and recorded in
`_sqlx_migrations(version, …)`, so `max(version)` is the schema version. They are
additive throughout — columns added, never renamed — and checksummed, so a
shipped migration is never edited. **A restored backup is not migrated until the
app next starts**, so a backup in the wild carries whatever version wrote it.

**The tables divide into the install and the stories.**

- *The install:* `character_vault`, `lorebook_vault`, `scenario_vault`,
  `vault_tags`; `preset_packs` with `pack_templates` (Liquid, each with the
  `content_hash`/`baseline_hash` pair §2's pack paragraph praises),
  `pack_variables` and `pack_runtime_variables`; `settings`; the legacy
  `templates`; `vault_assistant_conversations`; `model_health_cache`.
- *Each story* (`story_id`, cascading): `stories`, `story_entries` (the
  transcript), `branches`, `characters`, `locations`, `items`, `story_beats`,
  `entries` (the story's lorebook — the unified `Entry` above), `chapters`,
  `checkpoints` and `world_state_snapshots` (both whole world states as JSON),
  `time_anchors`, `kept_separate`, `embedded_images`, `background_images`.

**Images are base64 text inside the database** — generated illustrations,
backgrounds, and every character and vault portrait. This is why an install with
a gallery is hundreds of megabytes, and why Aventuras moved its backup and
export into Rust: the WebView ran out of heap on Android.

**What leaves the app.** Four things, one of which carries everything:

- the **full backup**, a zip of a `VACUUM INTO` snapshot named `aventura.db`
  plus `metadata.json` — `{ version: 1, createdAt, appVersion, storyCount,
  hasDatabaseSnapshot, databaseSizeBytes }` — written by
  `src-tauri/src/backup.rs`. Older backups also carry `stories/*.avt`, which
  Aventuras' own restore ignores;
- **`.avt`**, one story as versioned JSON, now at 1.10.0
  (`services/import/types.ts`), which is `gatherStoryData()` — every row the
  story owns, all branches, images inlined — through the row mappers;
- the **vault's single-record JSON**, which [P4 §1.5](workplan/16-p4-implementation.md)
  reads;
- **LAN sync** (`src-tauri/src/sync/`), a token-checked `POST /sync` serving
  `.avt` for stories the person selects. A phone-to-desktop feature, not an
  export.

**The objects are the rows run through mappers, and the mappers do work.**
`src/lib/services/database.ts` holds one per table — `mapVaultCharacter`
`:3042`, `mapVaultLorebook` `:3154`, `mapVaultScenario` `:4347`, the pack
mappers from `:4368`, the story mappers from `:2687` — and they are not
renames. `mapVaultCharacter` repairs the legacy string-array form of
`visual_descriptors` through `migrateVisualDescriptors` (`:105`), so a reader
that selected the column raw would meet a shape the file exports never show.

**A vault lorebook is not `Entry[]`.** `lorebook_vault.entries` holds
`VaultLorebookEntry[]` — `{ name, type, description, keywords, aliases,
injectionMode, priority }` (`types/index.ts:305`) — and the `Entry[]` the file
export writes is produced from it by `vaultEntryToEntryLike`
(`lorebookImportExport/export/vault.ts:18`). The unified `Entry` above is a
**story** lorebook's shape; the vault keeps a flatter one.

**`linkedLorebookId` is a row reference, on characters as well as scenarios.**
Importing a card with an embedded book splits the book into its own
`lorebook_vault` row and stores the link in the new object's `metadata` —
`scenarioVault.svelte.ts:345`, `characterVault.svelte.ts:429`. From a file the
link names nothing; from the database it resolves.

**A story's history is a list, and the tree is in the branches.**
`story_entries` is `{ type: user_action | narration | system, content,
position, branch_id, … }`, append-only per branch; `branch_id` null is main.
`parent_id` exists and **is written `null` at every site that creates an entry**
(`stores/story.svelte.ts:864`, `:947`, `:5408`). A branch owns only the rows it
wrote, forks at `fork_entry_id` under `parent_branch_id`, and continues its
parent's positions from the fork. The world-state tables are copy-on-write on
top of that: `overrides_id` names the inherited row a branch's row shadows, and
`deleted` is a tombstone. Regeneration replaces rather than keeping siblings,
and the `retry` entry type was removed at `c43da108` itself (#535) as never
written — so the only siblings in an Aventuras story are branches.

### What it gets right and we should take

**The generation pipeline is a real pipeline.** `GenerationPhase = 'pre' |
'retrieval' | 'narrative' | 'classification' | 'translation' | 'image' | 'post'`
with one class per phase under `services/generation/phases/`, each with tests,
and a discriminated-union event stream. This is the closest thing in any of the
three to the turn abstraction StoryEngine needs, and it should be the starting
point for the mode contract.

**The unified `Entry` type** (`types/index.ts:474`) merges lorebook and tracker
into one object: static content (`description`, `hiddenInfo`, `aliases`) plus
*typed dynamic state* per entry type (`CharacterEntryState` with presence,
disposition, a −100..100 relationship level and history; `LocationEntryState`;
`ItemEntryState`; …), plus injection rules, plus mode-specific state slices
(`adventureState` / `creativeState`). "A lorebook entry and the thing that tracks
its state are the same object" is a genuinely good idea and it is the seed of the
channel model in [06](06-modes-and-turn-pipeline.md).

**Branching with copy-on-write and tombstones.** Entities carry
`branchId`, `overridesId` (COW parent) and `deleted` (COD tombstone), with a
`snapshotComplete` flag to short-circuit lineage resolution. Chapters,
checkpoints and branches are first-class. Marinara has branch fields on chats but
nothing comparable. Take the model; it is the right shape for "what if I'd done
that differently" which is central to this kind of play.

**The pack system** (`services/packs/types.ts`) — `PresetPack` owning
`PackTemplate[]` (Liquid templates, keyed to a `templateId` registry) plus
`CustomVariable[]` (author-defined wizard inputs with types, enums, defaults,
required flags, sort order) plus `RuntimeVariable[]` (author-defined *per-entity*
tracked variables with colour, icon, pinned flag, min/max). This is a real
authoring system: a pack author can add "Corruption: 0–100, pinned, purple" to
every character in their pack without touching engine code.

Two details worth stealing outright:

- `PackTemplate` carries both `contentHash` and `baselineHash`, with a comment
  explaining that the divergence between them is "the only signal separating
  'the app has a newer default' from 'the user changed this'". That is the
  correct solution to shipping template updates without clobbering user edits.
- `RuntimeVarsMap` is keyed by definition id, not variable name, "so rename is
  free". Correct, and the kind of thing that is painful to retrofit.

**The wizard as a genuine authoring flow.** Nine steps (mode → pack → world &
treatment → protagonist → supporting cast → lorebook → portraits → writing style →
opening), with an AI *expansion* step in the middle: a short `settingSeed` is
expanded into a structured `ExpandedSetting` (name, description, keyLocations,
atmosphere, themes, potentialConflicts) which the user can then edit, refine with
guidance, or reject via `useSettingAsIs()`. The seed→expand→edit→accept loop is
the right interaction for treatment creation and should be the template for the
"opening prompt vs written opening" pair in the requirements.

**`ContextBuilder`** — a flat variable store accumulated across services, then
rendered through Liquid templates, with `RenderResult { system, user }`. The flat
namespace is a weakness (see below) but the "services contribute, one renderer
consumes" structure is sound.

**Diagnostic honesty.** `EntryMetadata.retrievalSnapshot` is annotated
"Diagnostic only — nothing reads it back". Storing what retrieval put in the
prompt, per turn, is exactly right — StoryEngine should promote it from
diagnostic to first-class (see [10](10-ui-surfaces.md)).

### What it gets wrong and we should not copy

**`PersistentRetryState`** — a hand-maintained parallel snapshot listing
`characterIds`, `locationIds`, `itemIds`, `storyBeatIds`, `embeddedImageIds`
(`// Added in v1.4.0`), `characterSnapshots` (`// Added in v1.4.1`) so a retry
can delete entities created since. Every new entity type requires editing this
struct. Symptom of undo not being structural.

**Translation fields smeared across every entity.** `Character` carries
`translatedName`, `translatedDescription`, `translatedRelationship`,
`translatedTraits`, `translatedVisualDescriptors`, `translationLanguage`;
`StoryEntry` carries its own set; `Entry` more. Localisation as a per-field
parallel copy on every type does not scale. **[OPEN]** — StoryEngine needs a
position on translated play; a per-object translation sidecar keyed by
(objectId, field, language) is the obvious alternative.

**The flat `ContextBuilder` namespace.** Every service adds into one
`Record<string, any>` and every template can read every variable. Works at
current scale; there is no way to answer "which template needs this variable" or
"what happens if I remove it".

**Single-user, desktop-shaped throughout.** Vault stores are global singletons;
there is no ownership concept anywhere. Nothing here is reusable for multi-user
directly.

**Hardcoded entity taxonomy.** `EntryType = 'character' | 'location' | 'item' |
'faction' | 'concept' | 'event'` with a per-type state interface and a per-type
`BeforeState` for the undo system. Extensible only by editing the union.

### How it generates images — surveyed 2026-09-03

**Two mutually exclusive modes, and they decide the count in opposite ways.**
`imageGenerationMode: 'none' | 'agentic' | 'inline'`, set per adventure.

**`agentic` — a dedicated structured call, and a cap that is only a suggestion.**
The image phase gates on mode and configuration and then delegates to a scene
analysis service, which asks a model (Zod structured output) for
`scenes: [{ prompt, sourceText, sceneType, priority, characters,
generatePortrait }]` — a model-written image prompt, a verbatim 3–15 word
`sourceText` quote used for text matching, and a priority from 1 to 10. The
system prompt says *"identify up to `{{ maxImages }}` key visual moments"* and
*"Return empty array [] if no suitable visual moments exist"*, with qualitative
priority guidelines and an instruction to skip *"mundane actions, dialogue-only
scenes, abstract concepts"*.

Then the enforcement, or its absence: `maxImages` is interpolated into that
prompt **as a string and appears nowhere else in the program**. The result is
sorted by `priority` and every scene is queued — no slice, no threshold — and
`priority` is not persisted on the record. Ask for three, get eight, pay for
eight; and the field that would have chosen between them survives only as queue
order. [06 §10.4](06-modes-and-turn-pipeline.md) takes the opposite rule from
this.

**`inline` — the narrative model decides, in the same call, and here the cap is
real.** The narrative system prompt gains instructions to emit
`<pic prompt="…" characters="…"></pic>` tags mid-prose, *"Use sparingly: 1-3
images per response maximum, reserved for impactful visual moments"*. Because
enforcement is then a matter of counting tags in a string, it is enforced twice —
during streaming and again on rescan, the second counting existing rows so the
budget is per message rather than per call. The mode that trusts the model least
is the one that constrains it best. It is also markup inside the stored prose,
which is why [06 §10.4](06-modes-and-turn-pipeline.md) declines it and
[10 §13.1](10-ui-surfaces.md) supplies the rule.

**Nothing else gates a story image.** No scene-change detection, no importance
threshold, no cooldown, no minimum turns between images, no per-session cap, no
budget. The stated 500-character prompt limit is prompt text only; no provider
checks it, and the style suffix is concatenated *after* the model has budgeted,
so the total overruns routinely.

**Backgrounds are the exception, and they are prior art worth naming.** A
separate phase asks a model for
`{ changeNecessary: boolean, prompt: string }` over the last two narration
entries, with explicit criteria — *"A location change warrants a new background
only if the physical environment fundamentally shifts"*, and minor movement or
dialogue does not. It fails closed. This is independent confirmation that
[06 §10.1a](06-modes-and-turn-pipeline.md)'s *not every turn* requirement is
real; note only that StoryEngine answers the same question by diffing the
assembled fragments, which costs no call and caches on the recipe digest
besides.

---

## 3. SillyTavern

Node/Express server, jQuery-ish browser client, per-user directory tree on disk.
The oldest and most widely deployed; the ecosystem reference for card and
lorebook formats.

### What it gets right and we should take

**Multi-user already exists and the model is instructive.**
`src/users.js`: scrypt password hashing with per-user salt, `enabled` and `admin`
flags, session cookies with a persisted cookie secret, CSRF secret per session,
`requireLoginMiddleware` / `requireAdminMiddleware`, per-user backup archives,
and — notably — three SSO paths (Authelia, Authentik, and generic
`Remote-User`-style header auth) gated behind an explicit `sso.trustedProxies`
allowlist validated by `ip-matching`.

That header-auth-behind-a-trusted-proxy pattern is directly reusable for the
Tailscale integration in [09](09-server-multiuser-deployment.md).

**Per-user directory tree** (`USER_DIRECTORY_TEMPLATE`, `src/constants.js:16`) —
thirty named subdirectories per user (`characters`, `chats`, `groups`,
`group chats`, `worlds`, `backgrounds`, `themes`, `vectors`, `backups`, plus one
settings directory per backend family). Files on disk, human-navigable, no
database. The *storage philosophy* is what StoryEngine wants.

*Counted 2026-08-29, at `8172dcd`:* thirty-one keys, one of which is the root
itself. An importer that means to account for everything it saw needs the whole
list, not the familiar names — `thumbnails` and its three children, `user` with
`user/images`, `user/files` and `user/workflows`, `movingUI`, `extensions`,
`assets`, `instruct`, `context`, `sysprompt`, `reasoning` and `QuickReplies` are
all in it.

**Personas live in `User Avatars/`, and their text lives in `settings.json`.**
The directory holds one image per persona; the name and description sit under
`power_user.personas` and `power_user.persona_descriptions`
(`public/scripts/personas.js:234`, `:523`). Recorded here because this survey
never had it and P4 needs it: a persona is not a file, so importing one means
reading the settings file, which is not otherwise an import target.

**PNG card embedding** (`src/character-card-parser.js`) — the reference
implementation, and better than expected: it *splices tEXt chunks* rather than
re-encoding the image, removes existing `chara`/`ccv3` chunks before writing to
avoid mismatch, writes both V2 (`chara`) and V3 (`ccv3`) chunks, and reads with
V3 taking precedence. StoryEngine should copy this technique (chunk splicing, no
pixel re-encode) even while rejecting the payload schema.

*One thing the reference implementation does not cover, noted 2026-08-29:* cards
in the wild also arrive with their payload in a **compressed** `zTXt` chunk —
Character Tavern writes them that way, and Marinara's importer reads both
(`Marinara-Engine/packages/server/src/services/import/st-bulk.importer.ts:32`).
A reader that
handles `tEXt` alone does not fail on those cards; it fails to recognise them as
cards at all.

`src/charx.js` handles the V3 CHARX format — a zip carrying the card plus its
assets — which is the precedent for "what happens when a character has sprites".

**Group activation strategies** (`public/scripts/group-chats.js:122`):
`NATURAL` (mention/context-driven), `LIST` (fixed order), `MANUAL`, `POOLED`.
Independent of the generation mode. This is a well-worn set of answers to "who
speaks next" and StoryEngine should take the taxonomy even though it will
implement it differently.

### What it gets wrong and we should not copy

**Browser-side generation orchestration.** The generation loop, group turn
management, and prompt assembly live in the client. This is the root cause of the
multi-user, mobile and resumability limitations.

**Per-user islands with no sharing.** ~~For a household LAN server this is the
wrong default.~~ **Revised**: per-user stores are the right *default* and
StoryEngine now adopts essentially this model
([09 §4.3](09-server-multiuser-deployment.md)) — merging separate stores later
is mechanical, whereas splitting a shared one is adjudication. What SillyTavern
actually lacks is not per-user isolation but any *path* to sharing: no stable
object identity across users, no provenance to dedupe on, and a directory layout
where a shared area would be a new concept rather than a new location. The
critique stands, narrowed to that.

**Group chat by card-swapping.** See [00 §2.10](00-stance.md).

**Settings sprawl.** Four separate backend settings directories
(`NovelAI Settings`, `KoboldAI Settings`, `openAI Settings`, `TextGen Settings`)
in the user directory template is a fossil of the instruct/completion era.

**The card format itself.** V2's fixed field set (`description`, `personality`,
`scenario`, `first_mes`, `mes_example`, plus prompt-override fields) is the
lowest common denominator the whole ecosystem is pinned to. We import it; we do
not adopt it.

---

## 4. Cross-cutting reads

**All three converge on the same set of concepts** under different names:

| Concept | Aventuras | Marinara | SillyTavern |
|---|---|---|---|
| Character | `VaultCharacter` → per-story `Character` | `Character` (V2 + extensions) | card PNG |
| Player character | `Character` with `relationship: 'self'` | `Persona` (separate type) | persona (separate) |
| World facts | `VaultLorebook` / `Entry` | `Lorebook` | World Info |
| Reusable premise | `VaultScenario` | `Scenario` (feat branch) | — |
| Prompt config bundle | `PresetPack` | `ChatPreset` / prompt presets | preset + instruct/context |
| Running story | `Story` + `StoryEntry[]` | `Chat` + messages | chat jsonl |
| Background helper | pipeline phases | agents | extensions |

The convergence is a good sign that the concept set is close to right. The
divergence is almost entirely in *how much legacy each carries* per concept.

**Two of three already have a persona/character split, and both are quietly
regretting it.** Aventuras identifies the protagonist by
`relationship === 'self'` on an ordinary `Character`; Marinara has a separate
`Persona` type and then has to accept both in `partyCharacterIds` alongside
synthetic `npc:<slug>` ids. The unified actor card in the requirements is the
right call and both codebases are evidence for it.

**Nobody has solved NPC promotion.** Marinara's scenario plan considers and
explicitly rejects automatic promotion of an inline NPC into a real card,
concluding the judgement "is agentic, not algorithmic". Worth reading before
designing the NPC-to-actor path in [03 §2.5](03-data-model.md).
