# 00 — Design stance

**Status: proposal.** These are the positions the rest of the documents assume.
Each is arguable; several have real costs, noted inline.

---

## 1. The organising principle

The three source projects are all, structurally, **frontends that assemble a
string**. Everything else — cards, lorebooks, presets, macros, group chats,
agents — exists to decide what goes into that string and in what order. Six
years of feature growth happened on top of an abstraction that was chosen when
models took a single prose completion and returned prose.

StoryEngine should be built on a different core abstraction:

> A **turn** is a pipeline that assembles a *typed, structured request* from
> named blocks under explicit budgets, runs one or more model calls, and applies
> validated *state effects* to named channels.

Everything a mode does, everything an extension does, and everything the UI
inspects is expressed in those terms. Modes are configurations of the pipeline.
Agents are pipeline steps. Lorebooks are retrievers feeding blocks. Game systems
are channels plus reducers.

The practical test: **it must be possible to persist, display, diff and replay
exactly what was sent, and why each block was included.** If a feature can't be
expressed that way, the abstraction is wrong, not the feature.

---

## 2. What we are deliberately not carrying forward

This section is the "not beholden to the last six years" list. Each entry names
the legacy pattern, why it existed, and the replacement.

### 2.1 The mega-string prompt and macro substitution

`{{char}}`, `{{user}}`, `{{persona}}`, depth-injection-by-string-index — these
are string surgery on a single assembled blob because there was nothing else to
manipulate.

**Replacement:** context is a list of typed blocks, each with an id, a source, a
role, a priority, a token cost and a budget verdict. Templates render *within* a
block. Positioning is expressed as ordering constraints between blocks, not as
"insert at character offset N" or "depth 4 messages from the end".

*Cost:* users who know ST macros will have to relearn. A macro compatibility
shim is possible but should be an import-time transform, not a runtime feature.

### 2.2 Text-completion-era model plumbing

Instruct templates, context templates, per-model prompt formats, stop-sequence
juggling, "add BOS token" toggles. This is the largest surface area in
SillyTavern and it exists to serve raw-completion local backends.

**Replacement:** the baseline model contract is *chat-shaped with roles,
structured output and tool calling*. Raw completion is an **adapter** that
downgrades the structured request into a string at the edge — not the core
representation everything else is shaped around.

*Cost:* this genuinely disadvantages some local/raw backends. That is an
accepted trade, and it should be an explicit, stated trade rather than a
discovered one. **[OPEN]** how much raw-completion support ships at 1.0.

### 2.3 "Model emits JSON in prose; we regex it out and ask the user to fix it"

Marinara's Game Mode world generation asks for one large strict JSON document
and ships a **"Repair JSON" modal** — a line-numbered editor where the user
hand-fixes the model's malformed output (`Marinara-Engine/docs/game/getting-started.md`).
That modal is an honest response to a real failure, and it is also the clearest
possible evidence that the mechanism is wrong.

**Replacement:** state changes go through provider-native structured
output / tool calls against a declared schema, with a bounded automatic
re-ask loop on validation failure, and a **partial-application** model — a world
generation that produces 8 of 10 valid sections applies 8 and re-asks for 2. A
manual repair editor may still exist as a last resort, but it should be the
fourth thing tried, not the first thing surfaced.

Corollary: **big-bang generation is an anti-pattern.** Marinara's world-gen is
one enormous call that must succeed completely; its own docs tell users this is
where model choice matters most and where failures concentrate. Prefer
incremental, resumable generation with per-section validity.

### 2.4 The character card as a prompt configuration file

The V2/V3 card carries `system_prompt`, `post_history_instructions`,
`depth_prompt`, `talkativeness`, and — in Marinara's fork — fifteen further
engine-specific fields inside `extensions`, several explicitly annotated
"Conversation mode ONLY … Never read in RP/VN/Game"
(`Marinara-Engine/packages/shared/src/types/character.ts`). The interface is
terminated by `[key: string]: unknown`.

**Replacement:** the card describes *who the actor is*. How that description is
turned into a request is owned by the mode and the preset. Mode-specific
material is allowed but must live in a namespaced `modeData` map with a declared
owning mode, so it is legible which mode reads what and safe to strip on export.

*Cost:* breaks direct compatibility with the ST ecosystem. Mitigated by an
import shim that preserves unrecognised legacy fields verbatim in a `compat`
block, so nothing is lost and re-export is possible.

### 2.5 Keyword scanning as the only retrieval mechanism

Lorebook keyword activation is predictable and users genuinely like it. It is
also the only mechanism in the ST lineage, which pushes everything else into
"always-on" entries that silently eat context.

**Replacement:** keyword activation is *one retriever behind a common
interface*, alongside recency, explicit pin, channel-state-driven (e.g. "the
party is in this location"), embedding similarity and agent-selected. All
retrievers emit candidate blocks; a single budgeter arbitrates. Marinara already
has `current_location` as a forced activation source with its own budget — that
is the right idea arriving as a special case, and it should be general.

### 2.6 Unbudgeted "important" blocks that evict history

Marinara's own analysis of its group-scenario slot is worth quoting in
substance: the character block has no token budget, lorebooks do, and so what
gets trimmed under pressure is *conversation history* — while framing text sits
there permanently, unbudgeted
(`Marinara/scenarios/.github/plans/scenarios/scenarios-consumption-design.md`).

**Replacement:** every block is budgeted, including the ones we are sure are
important. "Never trim this" is a priority value, not the absence of a budget,
and the UI must show what a pinned block costs on every turn.

### 2.7 Per-mode reimplementation of the same feature

Marinara has a Roleplay combat system *and* a separate Game Mode combat system,
documented separately and explicitly described as "separate from Game Mode's own
combat". Same for HUD/trackers vs Game HUD widgets, and RP scenes vs Game
sessions.

**Replacement:** features are channels + steps registered against the mode
contract. A mode chooses which to enable. "Combat" is one implementation used by
whichever mode turns it on. This is the mechanism that makes the user's
requested cross-pollination possible without pre-designing combinations.

### 2.8 Derived data persisted as truth

Aventuras' `VaultScenario` persists derived counters; Marinara's port
deliberately drops them. Aventuras' `PersistentRetryState` is a hand-maintained
snapshot of "which entity ids existed before this action" so a retry can delete
the difference — a manual undo log, reconstructed field by field, with
`// Added in v1.4.0` / `v1.4.1` comments marking where it grew.

**Replacement:** derive what can be derived. For undo, make the turn log
append-only and state effects reversible by construction, rather than
maintaining a parallel snapshot structure that has to be extended every time a
new entity type is added.

### 2.9 Browser-side orchestration

SillyTavern's generation loop lives in the browser. This is why group chats,
autonomous messages and mobile all get harder rather than easier, and it is
incompatible with multi-user.

**Replacement:** see [04](04-server-multiuser-deployment.md). Generation is
server-side and resumable; clients subscribe to an event stream.

### 2.10 Group chat by card-swapping

ST's `group_generation_mode.SWAP` swaps the active character card in and out of
a single-character prompt structure; `APPEND` joins fields with configurable
prefixes and suffixes (`public/scripts/group-chats.js`). Both are workarounds for
a prompt builder that assumes exactly one character.

**Replacement:** the assembler is multi-actor from the start. "One actor speaks"
is the degenerate case of the general form, not the base case with extensions.

---

## 3. Principles that are actually load-bearing

### 3.1 Prefill, not binding

Creating a session from a setting or a package **copies** what it needs. There is
no live pointer back. Editing a setting later cannot retroactively change a
running story, and the same setting seeds many stories.

This is Aventuras' behaviour, precisely characterised in Marinara's port
analysis, and it is correct. It should be a stated invariant, not an emergent
one, because the alternative (live links) is superficially attractive and quietly
destroys reproducibility.

### 3.2 Content and production settings never mix

The single most important boundary in the data model. Shareable content —
actors, settings, lorebooks, packages — must **never** carry connections, API
keys, endpoint URLs, model bindings, or per-install feature toggles. Importing a
stranger's package must not be able to repoint your provider, flip your content
rating, or switch on generation against your paid image endpoint.

Marinara's scenario design states this as "the single most important decision in
the design", and it is right. StoryEngine should enforce it structurally: the
shareable types have no fields for that material, so violating it requires
changing a type rather than forgetting a check.

Model *preferences* are allowed, as abstract hints resolved locally — see
[02 §2.6](02-data-model.md).

### 3.3 Dangling references are normal, not an error

A package references a lorebook you don't have; a setting links an actor that was
deleted. This must be survivable, visible and non-blocking: resolve by id, fall
back to name match, otherwise show "missing" in the editor and carry on. Never
block a flow on a missing link, never silently drop it.

### 3.4 The file on disk is the artefact

If the user can get the thing out by dragging it out of the storage folder, the
export feature is a convenience rather than a dependency. This constrains the
storage design considerably and is worth the constraint. See
[02 §5](02-data-model.md).

### 3.5 The workflow surfaces are the product

Data management and call construction UI rank *with* the chat surface, not below
it. In practice this means the prompt workbench and library are designed in the
same pass as the chat views, and the turn record is designed to be displayed —
see [05](05-ui-surfaces.md).

---

## 4. Non-goals for 1.0

Stating these so they stop being re-litigated:

- **Not a security product.** Multi-user is access separation among people who
  already trust each other on a LAN.
- **Not a tabletop RPG engine.** Adventure mode's default is single-persona
  narrative play. RPG systems are opt-in channels.
- **Not an ST drop-in replacement.** We import from it; we do not promise
  behavioural parity, and we do not adopt its extension API.
- **Not a mobile app.** Responsive web on a LAN server. Native shells are a
  later question.
- **No pre-designed cross-mode feature combinations.** The requirement is that
  the seams exist, not that the combinations ship.
