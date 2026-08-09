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

Not examined in any depth: client component trees, extension/plugin runtimes in
detail, TTS/image/video subsystems, tokenizers, the Noodle subsystem, Marinara's
tactical combat engine, Aventuras' retrieval implementation. Anything asserted
about those areas below is inference and marked as such.

---

## 1. Marinara Engine

A pnpm monorepo (`packages/{client,server,shared}`) — Node/TypeScript server,
React client, SQLite-plus-file storage, Docker and Android packaging. Structurally
the most modern of the three and the closest to what StoryEngine wants to be.

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
generalised (see [03 §3](03-modes-and-turn-pipeline.md)).

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

---

## 2. Aventuras

A SvelteKit + Tauri app (Svelte 5 runes), Vercel AI SDK across ~8 providers,
local database, single-user desktop-shaped. Version 0.7.8. The smallest and most
coherent of the three.

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
channel model in [03](03-modes-and-turn-pipeline.md).

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
setting → protagonist → supporting cast → lorebook → portraits → writing style →
opening), with an AI *expansion* step in the middle: a short `settingSeed` is
expanded into a structured `ExpandedSetting` (name, description, keyLocations,
atmosphere, themes, potentialConflicts) which the user can then edit, refine with
guidance, or reject via `useSettingAsIs()`. The seed→expand→edit→accept loop is
the right interaction for setting creation and should be the template for the
"opening prompt vs written opening" pair in the requirements.

**`ContextBuilder`** — a flat variable store accumulated across services, then
rendered through Liquid templates, with `RenderResult { system, user }`. The flat
namespace is a weakness (see below) but the "services contribute, one renderer
consumes" structure is sound.

**Diagnostic honesty.** `EntryMetadata.retrievalSnapshot` is annotated
"Diagnostic only — nothing reads it back". Storing what retrieval put in the
prompt, per turn, is exactly right — StoryEngine should promote it from
diagnostic to first-class (see [05](05-ui-surfaces.md)).

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
Tailscale integration in [04](04-server-multiuser-deployment.md).

**Per-user directory tree** (`USER_DIRECTORY_TEMPLATE`, `src/constants.js:16`) —
~30 named subdirectories per user (`characters`, `chats`, `groups`,
`group chats`, `worlds`, `backgrounds`, `themes`, `vectors`, `backups`, plus one
settings directory per backend family). Files on disk, human-navigable, no
database. The *storage philosophy* is what StoryEngine wants.

**PNG card embedding** (`src/character-card-parser.js`) — the reference
implementation, and better than expected: it *splices tEXt chunks* rather than
re-encoding the image, removes existing `chara`/`ccv3` chunks before writing to
avoid mismatch, writes both V2 (`chara`) and V3 (`ccv3`) chunks, and reads with
V3 taking precedence. StoryEngine should copy this technique (chunk splicing, no
pixel re-encode) even while rejecting the payload schema.

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

**Per-user islands with no sharing.** Every user gets a complete private copy of
everything. For a household LAN server where people want to share character cards
but keep their sessions private, this is the wrong default. See
[04 §3](04-server-multiuser-deployment.md).

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
designing the NPC-to-actor path in [02 §2.5](02-data-model.md).
