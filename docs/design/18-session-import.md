# 18 — Session import, and what it would need from us

**Status: feasibility assessment.** It defines nothing, schedules nothing, and
changes no schema. [25 E4](25-open-questions.md) already holds the position — that
session import is *conditional on an interchange format* rather than refused — and
this document is the survey that condition needs in order to be checkable rather
than merely stated. Where it disagrees with an existing note it says so and does
not quietly correct either side.

**Revisited 2026-09-28, at [§7](#7-revisited-2026-09-28--the-condition-is-met-and-what-is-left-is-ours).**
§6's condition has been met — P11.10 shipped the format, its writer and its
reader — and three of §4's four gaps are closed. §1–§6 are kept as written;
§7 is the verdict as it now stands.

It sits here rather than in [01](01-source-survey.md) because the source survey
answers *what these codebases do* and this answers *what it would cost us*, and
because §3 is addressed to a phase — [P11](workplan/28-p11-implementation.md) —
rather than to a reader.

**Sources surveyed from disk, and pinned**, on the argument
[01 §1](01-source-survey.md) already makes about unpinned surveys being stale on
arrival:

| Source | Pinned at | Dated |
|---|---|---|
| SillyTavern | `8172dcd0ee672d3cd9a5e5f7af134f91a45cd2b8` (v1.18.0) | 2026-07-07 |
| Marinara Engine | `34442e26da577ff0d95ee890a87024e35831bfa9` (v2.4.3) | 2026-08-18 |
| Aventuras | `8ae0d79a0df0745be3594fa5affcc98dd02c5a75` (v0.7.8) | 2026-08-16 |
| Aventuras, again | `c43da108f6b3679950e76afe020f6b26abf0c9ce` (v0.7.11) | 2026-09-25 — §2.3's corrections and §2.3.1 only |

The first and third match the commits [P4](workplan/16-p4-implementation.md)
already cites; the second matches [01 §1](01-source-survey.md)'s on-disk survey.
Nothing here required a newer checkout, which is itself worth recording — the
session halves of these three products have not moved under the library halves.

---

## 0. The correction this document opens with

**The position on session import changed on 2026-08-31, and four sites still
quote the version it replaced.**

[25 E4](25-open-questions.md) was retitled from *"Session import from other
platforms — speculative, not roadmapped"* to *"— conditional on an interchange
format"*, and its opening line now reads **"Not a commitment, and no longer a
flat refusal. The condition is the shape, not the appetite."** The four sites
that cite it were written one to two days earlier and say *closed*:

- [P4 §4](workplan/16-p4-implementation.md) — *"Chat and session history import —
  closed, not deferred… Confirmed by citation"*, quoting E4's superseded
  *"speculative and unroadmapped"*.
- [P7 §1.10](workplan/23-p7-implementation.md) — *"[25 E4] already closed chat and
  session import"*.
- `packages/server/src/import/registries/sillytavern.ts` and
  `.../marinara.ts` — *"Chat import is closed rather than deferred ([25 E4])"*,
  in the comment above the `recorded` dispositions.

P4 was itself edited on 2026-08-31, at §7.5's `.seactor` repair, so §4's stale
quotation survived a pass over the same document. That is the ordinary way a
citation chain rots and the reason this document leads with it rather than
burying it: **four places assert a decision the deciding document no longer
makes**, and every one of them is load-bearing for somebody deciding whether to
start.

The corrections are made in place at each site. **No disposition changes** —
`chats`, `messages`, `message_swipes` and the rest stay `recorded`, and under
E4's revision that is now the *right* arm rather than an approximate one.
`ImportDisposition.recorded` is defined as *"not converted, because the machinery
it would need belongs to a later phase — the review says **when**"*, which sat
badly against a decision described as closed and sits correctly against one
described as conditional. The comment was the only wrong part.

---

## 1. The verdict

**Feasible, cheaper than E4's language suggests in the plumbing, more expensive
than it looks in the target — and correctly sequenced after
[P11](workplan/28-p11-implementation.md).**

Three findings hold it up, and the third is the one that decides the schedule.

**The parse is small.** Aventuras ships a SillyTavern chat importer today —
`src/lib/services/stChatImporter.ts`, **116 lines**, tests beside it. It reads the
JSONL, skips line 0 and the system messages, maps `is_user` to one of two entry
types, and keeps `{ type, content }`. That is the whole of it. The cost E4 warns
about is real but it is not in the parsing, and saying so is not an argument
against E4 — see the next paragraph, which is the same finding read the other way.

**The fidelity is where the cost lives.** Those 116 lines discard swipes, `extra`,
per-message send dates, avatar bindings and every link to the character card;
`characterName` survives as a bare string that resolves to nothing. It is a
perfectly honest importer for a product that wants the prose, and it is precisely
the *"half-working importer"* E4 declines to ship — not through carelessness but
because full fidelity is a different and much larger job. **The two readings are
not in tension: the lift is large exactly where E4 says, and nowhere else.**

**The target does not exist yet, and that is what fixes the order.** P4 struck
`.seactor` from its own import list because an importer for it *"would have been a
reader for a format with no writer, which [work plan §2.2] forbids"*
([P4 §1.3](workplan/16-p4-implementation.md), corrected 2026-08-31). A session
importer aimed at the interchange format before session export writes it has that
shape exactly. [work plan §2.2](workplan/01-work-plan.md) is the rule — *"do not build a
system whose only purpose is to be replaced"* — and §2.1 supplies the
qualification that settles it: if nothing needs it yet, deferring is *"work not
done, which is better."*

So the recommendation is not *later because it is hard*. It is **later because
the one artefact the work depends on is scheduled, and building against its
absence is a mistake this project has already made once and caught.**

---

## 2. The three sources

One subsection each: how the data leaves the app, what a session *is* there, and
what a conversion would meet. The concept table at
[01 §4](01-source-survey.md) has one cell for all of this — *"Running story |
`Story` + `StoryEntry[]` | `Chat` + messages | chat jsonl"* — which was the entire
recorded corpus before this pass.

### 2.1 SillyTavern — a flat file with no message identity

**Extraction is the file itself.** Chats live at `chats/<character>/<name>.jsonl`
and `group chats/<id>.jsonl` in the per-user tree the sweep already walks, and the
app's own export of a chat is a byte copy of that file (`src/endpoints/chats.js`,
the `format === 'jsonl'` short path). There is nothing to obtain that a person
pointing at their data directory has not already given us — which makes this the
cheapest transport of the three and the reason `chats/` is currently *excluded*
from the folder-upload plan rather than absent from it.

**Line 0 is a header, every later line is a message.** The header carries
`{ user_name, character_name, create_date, chat_metadata }`; the shipped writer
stores the literal string `'unused'` in `user_name` and `character_name`
(`src/endpoints/chats.js`, and `public/script.js` where new chats are minted), so
the two fields that look like the cast are usually not it. A message is
`{ name, is_user, is_system, send_date, mes, extra, force_avatar?, swipes?,
swipe_id?, swipe_info?, gen_started?, gen_finished? }`.

**A message has no id.** This is the finding that matters most and it is not
recorded anywhere in our tree. `mesId` in `public/script.js` is a transient render
and event handle from `getNextMessageId(type)`; nothing durable identifies a line.
A message is addressed by its index in the file, so **any edit to any earlier
message re-addresses every message after it.** Re-import identity — which
[P4 §6.2](workplan/16-p4-implementation.md) already flags as the weak point of the
filename rule — has nothing better to key on than *(file, index, content hash)*,
and that key is not stable under exactly the operation people perform most.

The one durable identifier is chat-level: `chat_metadata.integrity`, a uuid. It is
minted **lazily on load** when absent (`public/script.js`), and the server's own
integrity check treats its absence as *assume intact*
(`src/endpoints/chats.js`). So it is usable when present and cannot be relied on:
a chat never opened since the field was introduced does not have one.

**Swipes are an array with the active one duplicated.** `swipes: string[]`,
`swipe_id: number`, `swipe_info: object[]`, and the writer assigns
`item.swipes[swipeId] = item.mes` — `mes` is a denormalised copy of the active
swipe, not a sibling of them. A conversion that maps swipes onto sibling turns
must drop that copy or it will import every message twice at its live branch.

### 2.2 Marinara — real ids, and branches that are copied chats

**Three shapes leave the app**, all already enumerated at
[01 §1](01-source-survey.md) and all already readable here: the data root, the
zipped profile archive, and the single-object `.marinara.json` envelope. The
session tables are the **sharded** half of the store — `messages`,
`message_swipes`, the `game_*` and `conversation_call_*` families — and
`MarinaraReader`'s `#rows()` already reads either layout, `orphaned-rows.json`
included. **The transport for Marinara session data works today**; it is the only
one of the three that needs no new reading code at all.

**A message has an id, and so does its chat.** `Message` is
`{ id, chatId, role, characterId, content, activeSwipeIndex, swipeCount?, rowid?,
createdAt, extra }`; `MessageSwipe` is
`{ id, messageId, index, content, createdAt, extra }` in its own table rather than
an array on the message. Re-import identity has something real to key on, which is
the opposite of §2.1's problem and worth stating as the reason the two sources
cannot share one identity rule.

**`roleplay` is a mode, not a kind of chat.**
`ChatMode = "conversation" | "roleplay" | "game"` is a field on `Chat`
(`packages/shared/src/types/chat.ts`), so scoping an import to roleplay is a
filter on rows, not a different reader. The other two modes are not degenerate
cases of it: `game` drags the six `game_*` tables that
[P7 §1.10](workplan/23-p7-implementation.md) already owns as channel-shaped, and
`conversation` carries the command surface — `uno`, `poker`, `call` — that has no
counterpart here at all.

**A branch is a copied chat.** Not a tree edge: `ChatMetadata` carries
`branchName`, `branchParentChatId`, `branchParentMessageId` and `branchMessageId`
— *"Copied message corresponding to `branchParentMessageId`"* — so forking
duplicates the prefix into a new chat and leaves a back-pointer. This is the
sharpest structural mismatch of the three, and it cuts both ways:

- Imported naively, a family of branched chats becomes *N* sessions that each
  repeat their common prefix. Every shared message is imported once per branch.
- Reconstructed, the back-pointers rebuild our tree exactly — join on
  `branchParentMessageId`, keep the prefix once, and hang each branch off the node
  it forked from.

The second is the right answer and it is **not** a per-message mapping; it is a
whole-family operation that has to see every chat in the group before it writes
one. Worth naming now because it is the kind of thing a converter written
message-at-a-time cannot be retrofitted into.

### 2.3 Aventuras — the format E4 is asking us to build

**`.avt` is a versioned, single-file, documented export**, and surveying it is the
finding that most changes the shape of this document.
`src/lib/services/import/types.ts` defines `AventuraExport` as
`{ version, exportedAt, story, entries, characters, locations, items, storyBeats,
lorebookEntries?, styleReviewState?, embeddedImages?, checkpoints?, branches?,
chapters?, currentBgImage? }`, at `EXPORT_FORMAT_VERSION = '1.8.0'`, with the
version history written into the file: nine versions, and every one after the
first is a field added rather than a field changed. Images are base64 inside the
JSON, injected natively from SQLite so the bytes never pass through the JS heap.
*At `c43da108` the version is **1.10.0**: `packBinding` (the pack's identity and
variable shape, never its templates) arrived at 1.9.0 and `timeAnchors` at
1.10.0, both additions — so the paragraph's claim held through two more
revisions.*

**This is the shape [25 E4](25-open-questions.md) argues for, built by somebody
else and working.** One documented target the app owns and versions, additive
across nine revisions, with the importer explicitly forbidden from depending on
the exporter — the header comment says so. It is evidence that E4's proposed shape
is not merely tidy in principle, and it is the strongest single argument in this
document for taking E4's condition seriously rather than treating it as a
formality to be waived.

It also means the `.avt` path is the **cheapest of the three to convert** — one
file, no tree walk, no relational join, a declared version to gate on — which
inverts the ordering somebody would guess from [01 §2](01-source-survey.md), where
Aventuras is the source with no on-disk survey.

*Correcting our own record:* [P4 §1.5](workplan/16-p4-implementation.md) surveyed
three Aventuras extraction paths — lorebooks as SillyTavern files, characters and
scenarios as raw JSON, and the whole vault as a zip of a SQLite snapshot. **`.avt`
is a fourth and was missed**, which matters because P4 called the SQLite snapshot
*"the heavy path"* and described the vault export as the way a whole library
leaves. For sessions specifically there is a light path, and it is better than any
of the three.

**The history model is the closest of the three to ours.** `StoryEntry` is
`{ id, storyId, type, content, parentId, position, createdAt, metadata, branchId,
… }` with `type: 'user_action' | 'narration' | 'system' | ~~'retry'~~` —
~~a real `parentId`, so the history is already a tree~~ *a `parentId` that is
never written: every site that creates an entry sets it `null`
(`stores/story.svelte.ts:864`, `:947`, `:5408` at `c43da108`), so the tree is
rebuilt from the branches rather than read — §2.3.1* — and `Branch` is
`{ id, storyId, name, parentBranchId, forkEntryId, checkpointId, createdAt,
snapshotComplete }`, which is [07 §3](07-branching.md)'s `BranchRef` with a fork
point attached. `EntryMetadata` carries `tokenCount`, `model`, `profileId`,
`temperature`, `reasoningEffort` and `generationTime`: genuine instrumentation
that lands in our `cost` and `request.calls[].params` rather than being
fabricated.

**One mismatch, and it is structural rather than lossy.** A `StoryEntry` is one
*message* — a `user_action` or a `narration` — and a [03 §8](03-data-model.md)
`Turn` is one *input and its output together*. Converting is a pairing pass over
the entry list, not a rename, and `type: 'retry'` is a third case that pairs with
neither. Nothing is lost either direction; the point is that the arithmetic is not
one-to-one and a plan that assumes it is will be wrong about its own size.

*Corrected 2026-09-26, against `c43da108`.* **`'retry'` no longer exists**:
Aventuras removed it at that commit (#535) as a type *"never written"*, so it was
never a third case in anybody's data, and the pairing has two inputs rather than
three. The `parentId` claim above was read from the type, not from the writers,
which is the ordinary way a survey of a type definition goes wrong — the field is
real and the tree it promises is not.

#### 2.3.1 The database, and what a story is in it

*Added 2026-09-26, for [P13](workplan/30-p13-aventuras-import.md), whose Part 2
would build on it and is not scheduled.* §2.3 costed `.avt`; the database
[01 §2](01-source-survey.md) now surveys holds the same rows, every story at once,
and one fact §2.3 did not have.

**The tree is the branches.** Main is the entries with `branch_id` null, in
`position` order. A branch is its parent's lineage up to and including
`fork_entry_id`, then its own rows — it owns only what it wrote, and continues
its parent's positions from the fork, so sibling branches reuse numbers after
it (Aventuras' `getStoryEntriesForBranch`, `database.ts:618`). A conversion
builds main as a chain of turns and hangs each branch's first turn off **the
turn that contains the fork entry** in its parent's lineage.

**Pairing, and the one case that is not clean.**

| Entries, in lineage order | Turn |
|---|---|
| `user_action`, then `narration` | one turn: `input` from the action (`original_input` as `raw` when a translation replaced it), `output` from the narration, its `reasoning` beside it |
| a leading `narration` — the opening | a turn with no `input` |
| a `user_action` nobody answered | `status: 'failed'`, `input` only |
| a second `narration` in a row | a turn of its own, with no `input` |
| `system` | open — a turn, or recorded |

**A fork can fall between an action and its answer.** When `fork_entry_id` is a
`user_action` whose narration is on the parent's side, the pair the fork splits
is one turn on the parent and cannot be a parent to the branch. The branch's
first turn then hangs off *that pair's parent* and re-pairs the forked action
with the branch's own first narration — a sibling of the parent's turn, which is
exactly what [07 §3](07-branching.md) says a regenerated answer is.

**World state is copy-on-write, and resolves per branch.** A branch's cast is
its lineage's `characters` with each row's `overrides_id` shadowing the row it
names and `deleted` rows removed; `snapshot_complete` marks a branch that owns a
complete copy and needs no lineage. One session has one cast, so a conversion
resolves the head branch's and records where other branches differ.

**What still has nowhere to go** is unchanged from §4: nothing here is lossy
against the turn record, and everything that is not a turn — chapters,
checkpoints, the time tracker, images — is §4's list and the phase's decision.

---

## 3. What import asks of the interchange format

**This is the section with a deadline, and the only one addressed to a phase.**

[25 B12](25-open-questions.md) ships session export at 1.0, owned by
[P11 §1.8](workplan/28-p11-implementation.md), and E4 is explicit that *"a format
designed with import in mind and a format designed without it are different
documents, and only one of them can be written at P11."* What follows is that
difference, as concretely as this survey can put it. None of it is a request to
build an importer.

1. **An imported turn must be representable without fabricated instrumentation.**
   It already is, and the export format must not undo it: on `Turn`, `input`,
   `output`, `request`, `cost` and `steps` are all optional, so a turn that never
   ran a model is `{ id, sessionId, parentTurnId, createdAt, status, effects: [],
   tape: [] }` and nothing invents a prompt it did not send. A format that makes
   any of those five mandatory — which a serialiser written against our own
   records would do without noticing, because ours always have them — closes this
   without anybody deciding to.

2. **A foreign message identifier must have somewhere to go.** Re-import
   idempotence needs it, and the three sources supply three different things: a
   Marinara `Message.id`, an Aventuras `StoryEntry.id`, and for SillyTavern
   nothing at all (§2.1). The format therefore needs a place for *"the id this
   came from, in the space it came from"* that tolerates being absent — and the
   absent case is not an edge, it is the most widely deployed source of the three.

3. **Siblings must survive the round trip.** [07 §3](07-branching.md) makes swipes
   and branches one mechanism, which is what lets ST `swipes[]`, Marinara
   `message_swipes` and Aventuras `'retry'` entries all land as sibling nodes. An
   export that serialises `walkPath(head)` — the current path, which is what every
   read surface uses today — silently drops every sibling and would make the
   format lossy against our own data before any import touched it.

4. **Provenance needs a field.** See §4.1: there is nowhere to write it, and the
   window to add it closes when the record freezes.

Recorded against P11 as an obligation on the export stage, not as scope added to
it. The cost of honouring all four while the format is being written is small; the
cost of retrofitting any of them afterwards is a migration of the one record this
project has the most of.

---

## 4. What our own model is missing

Four gaps. The first is time-critical; the rest are ordinary work that would sit
inside a session importer whenever one is written.

### 4.1 Session and Turn carry no provenance at all — and the window is closing

`SessionFile` (`packages/server/src/sessions/types.ts`) and `Turn`
(`packages/shared/src/turn.ts`) have **no `provenance`, no `metadata`, no
`compat`** — not an unfilled field, no field. Every portable kind has
`Provenance`, whose `source` union has included `'import'` since P1, and the
session record has nothing.

[03 §8](03-data-model.md) specifies `origin: Provenance` on Session and it is
unimplemented. `stampImported<T extends { provenance: Provenance }>`
(`packages/server/src/import/identity.ts`) — the function that makes a re-import
findable — does not typecheck against a session.

**Why this one is urgent and the other three are not.** [04 §1](04-schemas.md)
puts Session and Turn in the *free to move* tier **because nothing exports them**,
and `turn.ts` names the event that ends it in its own header. Adding a field now
is an edit; adding it after P11 is a migration of a frozen portable format. This
is [work plan §2](workplan/01-work-plan.md)'s retrofit test met exactly — *it changes a
persisted shape* — and it is the one item in this document that costs more by
waiting.

### 4.2 The sweep has no branch that could persist a session

`Writer.store()` (`packages/server/src/import/sweep.ts`) speaks
`PortableSchemaId` and writes through `library.create` / `library.update`.
Sessions are not library objects; they live under
`packages/server/src/sessions/` behind a per-session lock that is **not
reentrant**, and the app holds one shared context so the lock is genuinely shared.
A session importer needs a write path that does not go through the library at all
— `createSession`, then `appendTurnOnly` per turn, then `advanceHead`, with
`reconcileSession` available to link turns already on disk.

Not difficult. Worth naming because the existing `Writer` reads as though adding a
`case` to its format switch would be enough, and it would not.

### 4.3 Imported swipes would be written and then invisible

`BranchRef` is specified at [07 §3](07-branching.md) and **has no
implementation** — no occurrence in `packages/`, and the index's `branch_id`
column is written `null` by construction. `GET /sessions/:id/turns` returns
`walkPath(head)`, so siblings are unreachable from the only surface that lists
turns.

The consequence is specific: import a chat with swipes today and the alternatives
land correctly in the tree and cannot be seen, named, or switched to.
[P6](workplan/18-p6-implementation.md) owns the turn tree and its sibling
navigation, which is the phase that removes this — another reason the sequencing
in §1 is a finding rather than a preference.

### 4.4 `LoreScope` would gain a target it has never had

[P4 §1.4](workplan/16-p4-implementation.md) shipped `LoreScope` with two arms
rather than three because *"an ST book scoped to a chat has no representable"*
home, and chat-scoped books import as `global` with the dropped scope named in
the review — *"because there are no chats for it to bind to."* If sessions become
importable that stops being true, and the third arm becomes writable for the first
time. Recorded here so whoever reopens it finds the reason it was two.

---

## 5. What is already built

Collected because the plumbing is genuinely most of a session importer, and a
future reader deciding the size should not re-derive it.

- **The reader seam.** `SourceReader` yields candidates rather than files
  (`packages/server/src/import/source.ts`), chosen precisely because Marinara is
  relational. A session reader is a new arm on `ImportSourceKind`, not a second
  engine — which is what that seam was built to make true.
- **Sharded-table reading.** `MarinaraReader`'s `#rows()` already handles both
  layouts and `orphaned-rows.json`. §2.2's transport is done.
- **A bounded zip reader and `node:sqlite`.** `storage/zip.ts` checks its four
  bounds from the central directory before inflating a byte, `ZipFileSource` makes
  an archive a root, and `node:sqlite` is a live dependency. Aventuras' heavy path
  needs no new dependency; the light path (§2.3) needs neither.
- **`stableId`.** `packages/server/src/import/identity.ts`, which exists because
  *a converter that mints uuids is not reproducible* — the discipline turn ids
  would need, already written and already argued.
- **The review vocabulary.** `{ key, params }` notes, seven dispositions, the
  addressable report, `import_job` / `import_item`, and the near-miss diagnosis.
  A session sweep would emit into all of it unchanged, which also keeps its prose
  off [P11 §1.3](workplan/28-p11-implementation.md)'s localisation sweep.
- **The session write path.** `createSession`, `appendTurnOnly`, `advanceHead`,
  `reconcileSession` — turns can be written without running a model today.

**What is missing is the format, not the plumbing.** That is the same sentence E4
arrives at from the other direction, and the two agreeing is the closest thing to
a conclusion this document has.

---

## 6. Sequencing

**After [P11](workplan/28-p11-implementation.md), and not before**, for the reason
in §1: until session export exists, an importer for the interchange format is a
reader for a format with no writer, and [work plan §2.2](workplan/01-work-plan.md)
forbids it under the rule that struck `.seactor`.

**One thing pulled forward**, and only one: §3's four obligations on the export
format, of which §4.1's provenance field is the only one that costs more later
than now. Recorded against P11 §1.8. Nothing else here asks for anything before
its phase.

**No phase number is proposed.** [`workplan/README.md`](workplan/README.md)
records that there are deliberately no phase documents past 1.0, and E4 declines
to schedule an importer at all — *"if nobody ever writes one that is a fine
outcome."* Numbering this would contradict both, and the survey does not need a
number to be useful. What it needed was to exist before P11 rather than after, and
that is now true.

***And P11 is past, and a number was given anyway*** — *2026-09-26.* The
ordering above is satisfied: [P11.10](workplan/28-p11-implementation.md) shipped
`storyengine.session-export/1` and its reader, so an importer aimed at the format
is no longer a reader without a writer. [P13](workplan/30-p13-aventuras-import.md)
gives Aventuras' stories stage headings — P13.10 to P13.15 — **and does not
schedule them.** The number is for the headings, which
`tools/citation-targets.test.ts` can only check under a phase name, and for
P13's Part 1, which is card and lorebook import and was never this document's
subject. The paragraph above stands for the stories: a number is not a
commitment, and [25 E4](25-open-questions.md) records the shape they would take.

***And the stories are scheduled*** — *2026-09-29.* The person scheduled
P13's Part 2 ([P13 §0.3](workplan/30-p13-aventuras-import.md#03-how-this-sits-with-25-e4)):
the commitment the paragraph above withheld is now given, by the person and not
by the numbering. The shape is unchanged — a producer of
`storyengine.session-export/1` for Aventuras' stories, handing its export to
`importSession`, the one reader — so §1's ordering and E4's *one reader* both
still hold.

**The one recorded way to reopen it earlier** is
[P7 §1.10](workplan/23-p7-implementation.md)'s: *"a **format** argument rather
than a completeness one… the case reopens for that one shape only."* E4's revision
supplies exactly that argument, and P7's own §1.10 was written before it. Whoever
holds P7's revisit should read the two together rather than either alone — which
is why §0's corrections reach that section too.

---

## 7. Revisited 2026-09-28 — the condition is met, and what is left is ours

**§6's sequencing was a condition, not a date, and it has been satisfied.**
[P11.10](workplan/28-p11-implementation.md) shipped the format and its writer
(`packages/server/src/sessions/export.ts`, `storyengine.session-export/1`), and
on 2026-09-17 the reader arrived beside it (`sessions/import.ts`,
`POST /sessions/import`, `play/ImportSession.tsx`), which the backup import now
calls too. *"A reader for a format with no writer"* no longer describes a
converter aimed at it. This section re-reads §1–§5 against the code as it stands
and says what a SillyTavern or Marinara importer would cost **now**. It still
schedules nothing: [25 E4](25-open-questions.md)'s *"not a commitment"* is
untouched, and whether to build one is a person's decision.

*Sources are still the pins in the table at the top.* Upstream was not
re-checked for this pass — the container it was written in could not reach it —
and one claim below (§7.3's SillyTavern branches) is from knowledge of the
product rather than from the pinned tree, and is marked where it appears.
*(Later the same day, both pins were fetched and read for
[P14 §0](workplan/31-p14-scene-and-session-import.md); the corrections are made below, struck through where they
replace what this section first said.)*

### 7.1 What moved since the survey

| Survey item | Then | Now |
|---|---|---|
| §1, §6 — the target does not exist | Blocking | **Met.** Writer and reader both shipped at P11.10 |
| §3.1 — no fabricated instrumentation | Obligation | Honoured: `input`, `output`, `request`, `cost`, `steps` optional on `Turn`, and the round-trip test carries a turn with five absent fields |
| §3.2 — a foreign id has somewhere to go | Obligation | `Turn.foreign: { source, id }`, and `Rendition.foreign` |
| §3.3 — siblings survive | Obligation | `readTurns`, not `walkPath`; asserted over a branched fixture |
| §4.1 — no provenance on Session or Turn | Urgent | `SessionFile.origin?: Provenance`, both optional, as §4.1 asked |
| §4.2 — the sweep cannot persist a session | Gap | **Sidestepped rather than closed** — see §7.2 |
| §4.3 — imported swipes invisible | Gap | Closed at [P6](workplan/18-p6-implementation.md): `branchRefs`, `lastSelectedChild`, sibling navigation |
| §4.4 — `LoreScope` has no chat arm | Open | **Still open**: two arms, so chat-bound books still import `global` |

Three of four model gaps are closed and the fourth is a scope edge, not a
blocker. **The plumbing §5 said was "most of a session importer" is now all of
the write half.**

### 7.2 The shape: foreign → `SessionExport` → `importSession`

**A converter should emit a `SessionExport` document and hand it to the reader
that already exists**, rather than adding a session arm to the sweep's
`Writer`. Three reasons, in order of weight:

1. **It is the only session write path that has been built for foreign turns.**
   `importSession` already mints the session id, stamps `origin`, marks every
   turn `foreign`, refuses a collision (`already-here`), indexes the session and
   carries renditions. §4.2's library-shaped `Writer` would need all of that
   re-derived beside a lock that is not reentrant.
2. **It is [25 E4](25-open-questions.md)'s posture taken literally.** The
   converter is a pure function from somebody else's file to *our* documented
   format; the thing this project maintains is the format. A converter that
   rots breaks one pure function and its fixture pair — never the session store.
   Whether the converters live in this repository or outside it becomes a
   packaging question rather than an architectural one, because their output
   is a file a person could produce by other means.
3. **It makes the format prove it is a target.** Until something other than
   `exportSession` writes one, *"designed with import in mind"* is asserted by
   three tests of our own records. A SillyTavern chat is the first document
   that was not.

The converters would sit where the library converters sit
(`import/sillytavern/chat.ts`, `import/marinara/chat.ts`), take no I/O, and be
tested as fixture pairs in the project `pnpm test:fixture-pair` already runs.

### 7.3 The mapping, which is simpler than §2.3 feared

**A `Turn` with optional `input` and optional `output` makes the message-to-turn
mapping total without merging anything.** §2.3 called the conversion *"a
pairing pass… not one-to-one"*, which is true of its size and not of its
difficulty:

- a user message followed by a character message → one turn, `input` + `output`;
- the greeting, or any character message not preceded by a user message → an
  output-only turn (the first one a root);
- a user message not followed by a character message → an input-only turn.

`isStoryTurn` counts all three and `collect.ts` renders whichever halves exist,
so each lands in the prompt in the role it had. *The record allows the last
two; how the play surface draws an input-only turn has not been walked.*

**SillyTavern.** Swipes become sibling turns under the same parent, carrying
the same `input` and one `swipes[i]` each — ~~§2.1's warning stands, `mes` is the
active swipe's copy and is dropped~~ *(corrected: `mes` is authoritative and
`swipes[swipe_id]` is the copy that goes stale after an edit, so the active
sibling takes `mes` — [P14 §0](workplan/31-p14-scene-and-session-import.md), §0.3)*. `swipe_id` sets `lastSelectedChild` at that
parent and the head follows the active path, so the imported session opens where
the chat was. `extra.reasoning` lands in `output.reasoning` rather than nowhere.
Hidden messages (`is_system` on a character or user line) and narrator lines
have no exact home: reported, and imported as story text only if a person says
so. **Group chats** are the real loss: `Turn.output` has no speaker, so a
character's `name` survives only as text in the output — acceptable for a
narrator-mode session, lossy for anything that later wants attribution.
*P14 §1.1 answers this with an additive `Turn.output.messages`, one attributed message each — [25 C11](25-open-questions.md)'s one node, several messages.*

~~*From knowledge of the product, not verified against the pin:*~~
*Verified at the pin* (`bookmarks.js:186`, `:253`), and with one addition: the
branch copies the parent's whole `chat_metadata`, so `integrity` is shared by a
family rather than owned by a chat (P14 §0.2). SillyTavern's
**branches and checkpoints are copied chats too** — a new file whose
`chat_metadata.main_chat` names the chat it forked from, with the fork message
marked in the parent. If that holds at the pin, §2.2's family reconstruction
applies to SillyTavern as well, which is worth checking before anyone writes a
single-file converter and discovers it cannot be widened into a family one.

**Marinara.** `messages` joined to `message_swipes` on `messageId`, ordered by
`index`, active by `activeSwipeIndex`; swipes map exactly as above. **Better
than SillyTavern in two places**: `characterId` gives each message a speaker,
which can populate `input.actorId` and at least name the voice in a group; and
§2.2's branch family rebuilds our tree exactly — join on
`branchParentMessageId`, keep the prefix once. Scoped to `mode: "roleplay"` as
§2.2 says; `game` and `conversation` stay out.

### 7.4 Identity, and two consequences of reusing the reader

**Mint ids that are uuidv7-shaped**, with the timestamp from the message's
send date (monotonic-adjusted, since SillyTavern's `send_date` has been three
different formats over its life) and the random bits from a hash of *(source
chat identity, position in the family, content)*. The first half is not
cosmetic: `exportSession` sorts turns by id on the stated ground that uuidv7
sorts by mint time, and `importSession` appends them in file order. A
content-hash id — `stableId`'s `im-…` shape — satisfies neither, so an imported
session **re-exported** would list children before parents. The second half is
what makes a branch family's shared prefix collapse for free: identical position
and content, identical id.

**Two consequences of `already-here`, one good and one to state up front.**
Re-importing the same chat is refused with a 409, which is re-import
idempotence without any machinery — the thing §2.1 said SillyTavern had
nothing to key on. But the same check means **a chat that has grown since it
was imported cannot be imported again**: its prefix is already here. That makes
this a one-shot migration, not a sync, and the import surface should say so
rather than let the 409 say it.

### 7.5 What is genuinely new work

- **The converters.** SillyTavern, single-character, with swipes: small — a few
  hundred lines with the fixture pair. Marinara roleplay with branch families:
  medium, because §2.2's whole-family pass has to see every chat before it
  writes one. Group chats on either: small extra code, a product decision about
  attribution first.
- **Cast, mode and preset.** `session.cast.actors` are library ids the converter
  cannot know. Either the import resolves them (the chat's folder name against
  imported actors' `provenance.originalFilename`, which the card import already
  stamps) or the session arrives with an empty cast and the session-settings
  panel fills it. The second is free and honest; the first is what people will
  expect. Mode: ~~`freeform` for one character, `scene` for a group~~
  ~~*(corrected: Scene is `maxActors: 1`, so the reverse — Scene for one
  character, Freeform, `maxActors: 6`, for a group; P14 §1.7)*~~
  *(re-corrected the same day: **Scene for both.** The cap was P2's minimum, not
  the design — [06 §7.2](06-modes-and-turn-pipeline.md) specifies Scene as the
  SillyTavern/Marinara shape with "one or more actors present" — and P14's
  Part A builds Scene out to it, so an import lands in a mode that plays the
  way the chat did; [P14 §0.6](workplan/31-p14-scene-and-session-import.md))*.
- **The summary chain's first turn is a cliff.** `ensureChain` is lazy and
  sequential by design (link *n* is `f(link(n-1), units)`), and nothing is
  derived until somebody asks. An imported 2,000-turn chat at the default
  `span: 20` asks for ~99 summariser calls, one after another, **inside the
  first turn played after import**. Either a post-import job warms the chain or
  the first turn says why it is slow. The memory extractor, which reads the turns
  since it last ran, has the same shape and was not checked.
- **Transport.** `POST /sessions/import` takes a `SessionExport` body; the
  client either converts before posting or the route learns to detect `.jsonl`.
  The folder-upload plan excludes `chats/` today (§2.1), which is the right
  default until a person opts in per chat.

### 7.6 Verdict, revised

**Feasible now, and no longer sequenced behind anything.** The format exists,
its reader is built and tested against foreign-shaped turns, and branching is
navigable. What remains is two pure converters, a cast-linking decision, and a
warm-up for the summary chain — none of which changes a persisted shape, so none
of it costs more by waiting.

If it is built, the order that follows from the above is **SillyTavern
single-character first** (the most deployed source, the simplest file, and the
first test of the format by a document we did not write), **Marinara roleplay
second** (better fidelity, transport already done, but the family pass is the
larger piece), **group chats last** (a product question before a code one).
[25 E4](25-open-questions.md)'s objection is answered by §7.2's shape rather
than by effort: what this project would own is the format and a pure function
per source, which is the maintenance E4 said it would accept.
