# 30 — P13 implementation plan

**Status: planned 2026-09-28, for immediate implementation.** No stage has
landed. A feature in its own document, on the precedent
[P12 §1.5](29-p12-implementation.md) set; §1.10 says why it is filed as a phase
at all.

**P13 is session import from SillyTavern and Marinara — single-character and
group chats, swipes and branches included — into ordinary StoryEngine sessions
that can be read, navigated and played on.** It is
[18 §7](../18-session-import.md)'s verdict built: a pure converter per source,
emitting the [P11.10](28-p11-implementation.md) interchange format, handed to
the `importSession` reader that already exists.

**Sources are pinned**, as 18's are, and at the same commits — both were fetched
and read for this document rather than recalled:

| Source | Pinned at | What was read |
|---|---|---|
| SillyTavern | `8172dcd0ee672d3cd9a5e5f7af134f91a45cd2b8` (v1.18.0) | `public/script.js` (`saveChat`, `getChat`), `public/scripts/bookmarks.js`, `public/scripts/group-chats.js`, `public/scripts/chats.js`, `public/scripts/utils.js` (`parseTimestamp`), `src/endpoints/chats.js`, `src/endpoints/groups.js` |
| Marinara Engine | `34442e26da577ff0d95ee890a87024e35831bfa9` (v2.4.3) | `packages/shared/src/types/chat.ts`, `packages/server/src/db/schema/chats.ts`, `services/storage/chats.storage.ts`, `routes/chats.routes.ts` (branch, export), `services/import/st-chat.importer.ts` |

---

## 0 — What the pinned sources say that 18 did not

18 was written against the same pins, but its session sections read the message
shapes and not the code that writes them. Reading the writers moved five things,
and 18 §7 is corrected in place to match.

### 0.1 SillyTavern branches and checkpoints are copied chats, as Marinara's are

`createBranch(mesId)` (`bookmarks.js:186`) saves messages `0..mesId` as a **new
chat file** whose `chat_metadata.main_chat` names the chat it came from, and
pushes the new name onto `extra.branches` of the fork message in the parent.
`createNewBookmark` (checkpoints, `:253`) does the same with
`extra.bookmark_link`. A branch of a branch names the branch. **So both sources
need the same family reconstruction**, and 18 §2.1's *"a flat file"* is true of
one file and false of what a person has.

### 0.2 `chat_metadata.integrity` identifies a family, not a chat

`saveChat` builds the branch header from `{ ...chat_metadata, ...withMetadata }`
(`script.js:7347`), and `integrity` is minted only when absent
(`script.js:7606`, `group-chats.js:277`). **A branch inherits its parent's
integrity uuid.** 18 §2.1 called it the one durable chat-level identifier; it is
the one durable *family*-level identifier, which is less and is still useful. A
chat's own identity is its file path: `chats/<card file sans .png>/<name>.jsonl`
(`endpoints/chats.js:554`) or `group chats/<id>.jsonl`.

### 0.3 `mes` is authoritative; `swipes[swipe_id]` is the copy that goes stale

18 §2.1 said `mes` is *"a denormalised copy of the active swipe"* to be dropped.
The direction is the other way round: an edit writes `mes`, and older builds
left `swipes[swipe_id]` holding the pre-edit text. Marinara's own SillyTavern
importer says so and overwrites the swipe with `mes`
(`st-chat.importer.ts:341-343`). **Marinara stores the same asymmetry**:
`setActiveSwipe` copies `messages.content` onto the outgoing swipe row only when
switching away (`chats.storage.ts:1527-1556`), so the message row, not its swipe
row, holds the active swipe's current text.

### 0.4 Marinara's per-chat export is SillyTavern JSONL

`chats.routes.ts:3596` writes a chat as ST JSONL with `extra.marinara_role`,
`extra.marinara_character_id`, `extra.marinara_swipes` and
`chat_metadata.marinara_metadata`. **One JSONL parser serves both sources'
single-file path**; the Marinara extras refine it rather than needing a reader.

### 0.5 Hidden is a flag on an ordinary message, in both

ST's `/hide` sets `is_system: true` on a normal line (`chats.js:157`) and prompt
assembly filters on it (`script.js:4437`); narrator lines are `is_system: false`
with `extra.type: 'narrator'` and **are** sent. Marinara's equivalent is
`extra.hiddenFromAI`, set among other things by its summariser when *"hide
summarised messages"* is on. `is_system` does not mean *system*; it means *not
in the prompt*.

And one from our own code, which the exploration for this document found:
**18 §7.5 recommended `scene` for groups, and Scene is `maxActors: 1`**
(`packages/modes/scene/src/mode.ts:434`). Freeform is `natural`, `maxActors: 6`.
Corrected in 18.

---

## 1 — The decisions this phase makes

### 1.1 One shape for every path: foreign → `SessionExport` → `importSession`

18 §7.2 argued it; this phase holds to it without exception. Every entry point —
a folder sweep, a zip, a Marinara profile, one uploaded `.jsonl` — ends in
`importSession(context, handle, document)`, which already mints the session id,
stamps `origin`, marks turns `foreign`, refuses a collision and indexes. The
backup import (`backup/import.ts:305-317`) is the precedent: it builds an
envelope and calls the same function.

**The converters are pure.** `(messages, resolution) → { documents, items }`, no
I/O, no library access. What the library knows — which actor a card became —
arrives as a `resolution` argument the caller builds (§1.6). That split is what
makes the converters testable over plain values and keeps [25 E4]'s bargain: a
converter that rots is one pure function and its fixtures.

### 1.2 A turn is an optional input and an optional output — never a merge

The message list maps onto turns totally, with no message joined to another:

| Messages | Turn |
|---|---|
| user, then character | one turn: `input` + `output` |
| character with no user message before it (greeting, a second group member, a narrator line) | output-only |
| user with no character message after it | input-only |

`input.kind` is **`do`**: it is the one kind every shipped mode accepts, and it
has no wrapper in any shipped preset, so the words reach the model as they were
typed. `input.raw` is the text; `input.actorId` is the persona if resolved
(§1.6), else null. `output.reasoning` takes ST's `extra.reasoning` and
Marinara's `extra.thinking`. `status: 'complete'`, `effects: []`, `tape: []`,
and nothing else: [18 §3]'s first obligation, no fabricated instrumentation.

Output-only turns hide Redo and Reroll in the play surface
(`PlayPage.tsx:1268`, `rerunnable = turn.input !== undefined`), which is right
for a greeting and a limit for an imported group reply; an input-only turn
renders as the grey input line alone. Both are walked at the gate (§3), because
nothing has drawn either until now.

### 1.3 Swipes are siblings; the active one is the one the source holds

Each swipe of a character message is a sibling turn under the same parent,
carrying the same `input`. The active swipe's text is `mes` (ST) or
`messages.content` (Marinara) — §0.3 — and every other swipe's is `swipes[i]` /
the swipe row. `lastSelectedChild[parent]` names the active sibling, so the
session opens on the path the chat was on. Continuations hang off the active
swipe only, because that is where the source hung them; the others are leaves.

### 1.4 Turn identity: a trie over *(account, family, parent, content)*, printed as uuidv7

A turn's id is minted, not carried — ST messages have none, and Marinara's are
re-minted on every branch copy (`chats.routes.ts:3861`). The id is:

```
id = uuidv7Shaped( time, H(account, familyKey, parentId, input.text, output.text, speakerKey) )
```

- **Content and parent, not position.** Two chats in one family that share a
  prefix produce the same ids for it, so the prefix collapses into one path and
  each branch forks where it actually diverged — including a branch whose copy
  was later *edited* before the fork point, which becomes a fork at the edit.
  That is §0.1's family reconstruction falling out of identity rather than
  being a separate matching pass.
- **Account in the hash.** `sessionHoldingTurns` looks turn ids up across the
  whole index (`index-db/sessions.ts:368`). Without the account, a second person
  importing the same shared chat would be refused `already-here` — and learn
  that somebody else has it.
- **uuidv7-shaped**, per 18 §7.4: `exportSession` sorts by id and
  `importSession` appends in file order, so a re-export must list parents first.
  `time` is the message's send time, forced strictly above its parent's
  (`max(parsed, parent + 1ms)`) — both sources hold send times that repeat or
  run backwards (`st-chat.importer.ts:89`). The random bits are the hash.
- **Deterministic**, so re-importing the same chat is `already-here` → the
  ledger's `unchanged`. And, per 18 §7.4, **a chat that grew since it was
  imported cannot be imported again**: its prefix is here. One-shot, not a sync,
  and the import surface says so (§2, P13.4).

### 1.5 Families, branch refs and the head

A **family** is the set of chats connected by back-pointers: ST `main_chat`
within one character folder or one group's chat list; Marinara
`metadata.branchParentChatId`. A back-pointer to a chat that is not in the
source makes that chat the root of its own family, with a note — renamed and
deleted parents are ordinary in both.

One family → one session. Each chat in it becomes a `BranchRef { name,
headTurnId }` (ST: the file name; Marinara: `metadata.branchName ?? chat.name`),
the session's `headTurnId` is the **root chat's** head, and `lastSelectedChild`
follows the root's active path. Chats that are not linked stay separate
sessions even when they open on the same greeting; merging those would claim a
relationship the person never made.

### 1.6 Resolution: cast, persona and lore are found, never invented

The converter names foreign things; the caller resolves them against the
library with `priorImportId` (`import/identity.ts:80`), which is the re-import
rule's own lookup:

| Foreign reference | Tried, in order |
|---|---|
| ST character, single chat | the chat folder → `characters/<folder>.png`, then `<folder>.png` (a single-file card upload's filename) |
| ST character, group | each message's `original_avatar` → the same two forms; `groups/<id>.json` `members` for the roster |
| ST persona | a user line's `force_avatar` thumbnail URL's `file=` → `User Avatars/<file>`; else `chat_metadata.persona` |
| ST chat lorebook | `chat_metadata.world_info` → `worlds/<name>.json` |
| Marinara character | `storage/tables/characters.json#<characterId>` |
| Marinara persona | `storage/tables/personas.json#<chat.personaId>` |

Then, only if none of those resolves, **an exact, unique name match** against the
account's actors — the case the provenance rule cannot reach, a card imported
through some other door. Two actors with the name is no match. What does not
resolve is a note, never a fabricated actor: [00 §3.3]'s posture, and the
session's cast panel can link it afterwards. `resolveCast` already drops a
dangling id silently (`turns/cast.ts:124`), so an unresolved speaker costs
nothing at turn time.

### 1.7 Mode: Scene for one character, Freeform for a group

A single-character chat imports into **Scene**, the default mode (`fixed`,
`maxActors: 1`). A group imports into **Freeform** (`natural`, `maxActors: 6`).
A group of more than six keeps the six who speak most, in order of first line,
and names the rest in a note — `importSession` does not enforce the cap, but
the next cast edit would refuse (`routes/sessions.ts:915`), and a session that
cannot be edited without losing members is a trap. Preset absent, so each mode's
own; treatment none.

**The voice will not match, and that is recorded, not fixed.** Both modes are
narrator-voiced; most ST and Marinara roleplay is written in the character's own
voice. The imported history reads correctly and the next turn is written by a
narrator. An embodied roleplay mode is a mode, not an import, and this phase
does not build one. It goes on the gate so a person judges how much it matters.

### 1.8 Group speakers: `output.speaker`, an additive field on the frozen record

The turn record has one speaker field and it is on the input
(`Turn.input.actorId`); an output has none, and no mode attributes output
(`dispatch: 'merged'` everywhere). For a single-character import that is fine —
the speaker is the cast. For a group it is the whole difference between a
transcript and a pile of paragraphs.

**Decided: `Turn.output.speaker?: Ref`** (`{ id, name }`, `schema/common.ts:43`),
where `Ref` already resolves by id, then by case-insensitive name, then shows as
missing — so a speaker the library never linked still has a name.

- **Additive and optional, so the freeze holds.** [P11.10] froze the format as
  *a promise not to tighten*; an optional field a reader does not know rides
  through `importSession`'s spread unchanged, and every session ever written
  lacks it and stays valid. `storyengine.session-export/1` does not change.
- **Only an importer writes it in this phase.** A future `per-actor` dispatch is
  its natural second writer and is not built here.
- **Consumers:** the history slot renders `Name: text` for an output that has a
  speaker *when the windowed history holds two or more distinct speakers* — so a
  single-character import prompts exactly as it would without the field; the
  play surface and the reading view name the speaker.

*The alternative, rejected:* bake `Name: ` into `output.text` at import. It is
what SillyTavern sends and it needs no format change — and it rewrites the
person's words, puts a prefix into every search hit and every summary, and
cannot be undone by a later reader that does know who spoke. Rejected on
[18 §3]'s own ground: import must not fabricate, and an edited transcript is a
fabrication with better intentions.

### 1.9 What is left out, and says so

Each is a note on the chat's review row, never silence:

- **Hidden lines** (ST `is_system`, Marinara `hiddenFromAI`) — not imported,
  counted. They were not in the source's prompt, and the turn record has no
  *visible but not sent* state; `removed` is a tombstone, not that. A chat whose
  hidden lines are Marinara's summarised-away history loses them here too, and
  the summary chain recomputes from what is imported.
- **Author's note** (`note_prompt`), chat variables, Marinara's rolling summary,
  tracker and game state, reactions, attachments without bytes, and
  `extra.api`/`model`/`token_count`. The last three are real instrumentation
  with a real home (`request`, `cost`) and still left out: a `TurnRequest` built
  from three of its fields is a fabrication of the other twenty.
- **Marinara `conversation` and `game` chats** — recorded, as 18 §2.2 argued.
  `roleplay` only.
- **Chat-scoped lorebooks** stay `global`-scoped books linked to the session:
  `LoreScope`'s third arm is still [18 §4.4]'s open question.

### 1.10 A phase, and a branch that is not `p13`

It is filed as a phase for P12's reason — a roadmap entry holds no commitment,
and this is being built now — and because it changes the frozen turn record,
which is exactly the kind of decision the phase documents exist to date.
***The branch is `claude/sillytavern-marinara-import-id4eim`***, by instruction;
recorded so nobody hunts for a `p13`.

---

## 2 — Stages

*Depends on:* nothing unbuilt. P11.10's format and reader, P6's branch
navigation and P4's library importers are all on `main`.

**Order**, per 18 §7.6: SillyTavern single-character, then its families, then
Marinara, then groups — with the one piece of groups that is a format decision
(§1.8) pulled into the first stage, because the tree builder emits it and a
format field decided late is decided twice.

### P13.0 — Corrections, registries and the record

18 §7 corrected to §0. `Turn.output.speaker?: Ref` added to `turn.ts` with its
docstring and the round-trip test extended to carry it — no consumer yet.
*Ends at:* the export round-trip test carries a speaker it has never seen through
export and import unchanged.

### P13.1 — The chat tree builder

`packages/server/src/import/chat/` — source-neutral and pure:

- `ChatMessage` — `{ role: 'user' | 'character' | 'narrator', text, reasoning?,
  speaker?: ForeignRef, persona?: ForeignRef, at: number | null, swipes?:
  { text, reasoning?, at }[], activeSwipe, hidden }`, what both parsers produce.
- `ChatFamily` — chats with their messages and back-pointers.
- `buildSession(family, resolution, account)` → `SessionExport` plus
  `ImportNote[]`: pairing (§1.2), swipes (§1.3), ids and times (§1.4), branch
  refs and head (§1.5).

*Proof obligation* — property tests over generated families, because every
fixture anybody writes by hand is linear: two chats sharing a prefix of length
*k* produce exactly *k* shared turns; every turn's parent precedes it in id
order; the same family and account produce byte-identical documents twice; two
accounts produce disjoint ids; the number of turns reachable from the head equals
the active path's pairing.

### P13.2 — SillyTavern JSONL

`import/sillytavern/chat.ts`: header detection (line 0 is a header when it
carries `chat_metadata` or no `mes` — group files written before the header
existed have none); `parseTimestamp` ported from `utils.js:1096` (epoch numbers,
ISO, `June 19, 2023 2:20pm`, and the three `@h m s` humanized forms);
`mes` over `swipes[swipe_id]`; `swipe_info[i]` for per-swipe reasoning and time;
`is_system` hidden; `extra.type === 'narrator'` as a narrator line; the
`marinara_*` extras (§0.4) honoured when present.
*Ends at:* the fixture chat in `test-sillytavern.ts` converts, and a table of
real-shaped lines — every timestamp form, a stale swipe, a hidden line, a
narrator line, a headerless group file — converts as §1.2–§1.3 say.

### P13.3 — Resolution and the write

`import/chat/resolve.ts` implements §1.6 over `priorImportId` and a name index;
the caller hands the converter a `resolution` and calls `importSession`. A chat
becomes one `ImportItemReport` — `converted` with `objectId` the session id,
`unchanged` on `already-here`, `unrecognised` on a file that is not a chat —
with its notes, keys under `import.chat.*` so `note-labels.test.ts` (which scans
`server/src/import/`) holds their wording.
*Ends at:* a converted chat's session has the imported card in its cast and the
persona on its inputs.

### P13.4 — The three doors

- **The folder sweep and zips.** `sweep()` gains a session pass **after** the
  library loop, so a sweep that brings cards and chats together resolves
  against the cards it just wrote. The ST reader yields chat files to it instead
  of marking them `recorded`; `chats`, `group chats` and `groups` move to
  `converted` in the registry.
- **The browser folder upload.** Chats are the bulk of an ST tree, so they are
  **opt-in**: `planUpload` reports their bytes separately, the panel offers
  *"also import chats"*, and only then are they `wanted`
  (`directory-upload.ts:74`).
- **One file.** `readUpload` learns JSONL (content, not extension); `/import/file`
  converts it; Play's *Import session* accepts `.jsonl` beside `.json` and goes
  through the same route. One file is one family of one chat — branches need
  the folder.

The import surface says, once, that an import is a copy taken now and that a
chat which has grown since cannot be taken again (§1.4).
*Ends at:* each door imports the fixture chat, and the sweep's ledger row names
the session.

### P13.5 — SillyTavern families

`main_chat` links within a folder or a group's `chats` list, branch of branch,
a missing parent (its child becomes a root, with a note), and checkpoints.
*Ends at:* a fixture folder of a chat, a branch, a branch of the branch and a
checkpoint imports as **one** session whose shared prefix exists once, with four
branch refs, opening on the root's head.

### P13.6 — Marinara

`import/marinara/chat.ts` over the reader's `#rows` (sharded and flat layouts
and `orphaned-rows.json`, all already read): `chats` filtered to
`mode === 'roleplay'`; `messages` by `chatId`, ordered `(createdAt, id)` as
Marinara orders them (`chats.storage.ts:963`); `message_swipes` by `messageId`
and `index`, with §0.3's rule for the active one; `role` `user`/`assistant`/
`narrator`, `system` as narrator unless hidden; `characterId` as speaker;
`hiddenFromAI`; families on `branchParentChatId`. The profile archive, the data
root and the `.marinara.json` v1 profile (`envelope.ts:63`) all arrive through
the sweep; the per-chat JSONL export through P13.2.
*Ends at:* `test-marinara.ts` grows a `chats` table and a branched roleplay, and
it imports as one session with the prefix once.

### P13.7 — Groups

- ST: `group chats/<id>.jsonl` with `groups/<id>.json`'s `members` for the
  roster; `original_avatar` per line. Marinara: `characterIds`, `characterId`
  per message.
- Freeform, the six-member cap and its note (§1.7).
- `output.speaker`'s consumers (§1.8): the history slot in
  `assembly/collect.ts`, `TurnView` in `PlayPage.tsx`, and
  `reading/prose.ts`.
*Ends at:* a three-member group imports with each reply named, previews a turn
whose history carries the names, and a one-character import previews
byte-identically to before this stage.

### P13.8 — The first turn after a long import

`ensureChain` is lazy and sequential (`sessions/summaries.ts:213`): a 2,000-turn
import at `span: 20` asks for ~99 summariser calls inside the first turn played.
After `importSession`, a **background warm** derives the chain for the head's
path with the session's resolved summariser, outside any turn job, and reports
progress on the event bus. It is safe to race a turn: links are content-keyed
and a link's key never includes its text, so a duplicate derivation costs one
call and changes no key downstream. A mode with no summary slot, or no
summariser bound, warms nothing.
*Ends at:* a long fixture imports, the warm runs, and the first turn's preview
derives zero links.

### P13.9 — The corpus and the gate test

A fixture pair per source in the `fixture-pair` project (`FIXTURE_PAIR` becomes
a list, used in both the project `include` and the packages `exclude`): sweep a
tree holding cards and chats, open the imported session, preview a turn, and
assert history, persona and actor slots fill — the existing gate's shape
(`fixture-pair.test.ts:64-229`) with a session that was never played here.
And one size test: a 10,000-message chat imports inside the suite's time budget,
because `importSession` appends turn by turn and nobody has measured it.

### What is deliberately not in this phase

- **Sync.** Re-importing a grown chat (§1.4).
- **An embodied roleplay mode** (§1.7).
- **`LoreScope`'s chat arm** ([18 §4.4]).
- **Aventuras `.avt`**, the cheapest of 18's three and not asked for.
- **Backfilling cross-session memory** from imported history. The extractor
  reads the eight turns since it last ran (`memory/extract.ts:345`), so an
  imported history is never offered to it. Recorded; a person decides whether
  an imported past should be remembered.

---

## 3 — The exit gate

### 3.1 The critical list

By [manual testing §0](05-manual-testing.md)'s criterion, walked before the phase
closes:

1. **A real SillyTavern data folder**, not a fixture: chats import beside their
   cards, a branched chat opens as one session, and switching branches shows
   what the person remembers being there.
2. **A real Marinara profile**, the same walk.
3. **A group chat, played one turn.** The names read right in the play surface,
   the reading view and the workbench's history rows — and a person judges the
   narrator's first reply against the imported voice (§1.7).
4. **An output-only and an input-only turn in the play surface** — the two
   shapes nothing drew before this phase (§1.2).

### 3.2 The remainder — extends the standing list

The one-shot message is understood by somebody who has not read §1.4; hidden-line
and author's-note notes are worded so a person knows what they lost; a 10,000-
message chat's first turn after the warm feels like any other turn.
