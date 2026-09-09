# 18 — Session import, and what it would need from us

**Status: feasibility assessment.** It defines nothing, schedules nothing, and
changes no schema. [25 E4](docs/design/25-open-questions.md) already holds the position — that
session import is *conditional on an interchange format* rather than refused — and
this document is the survey that condition needs in order to be checkable rather
than merely stated. Where it disagrees with an existing note it says so and does
not quietly correct either side.

It sits here rather than in [01](docs/design/01-source-survey.md) because the source survey
answers *what these codebases do* and this answers *what it would cost us*, and
because §3 is addressed to a phase — [P11](docs/design/workplan/27-p11-implementation.md) —
rather than to a reader.

**Sources surveyed from disk, and pinned**, on the argument
[01 §1](docs/design/01-source-survey.md) already makes about unpinned surveys being stale on
arrival:

| Source | Pinned at | Dated |
|---|---|---|
| SillyTavern | `8172dcd0ee672d3cd9a5e5f7af134f91a45cd2b8` (v1.18.0) | 2026-07-07 |
| Marinara Engine | `34442e26da577ff0d95ee890a87024e35831bfa9` (v2.4.3) | 2026-08-18 |
| Aventuras | `8ae0d79a0df0745be3594fa5affcc98dd02c5a75` (v0.7.8) | 2026-08-16 |

The first and third match the commits [P4](docs/design/workplan/16-p4-implementation.md)
already cites; the second matches [01 §1](docs/design/01-source-survey.md)'s on-disk survey.
Nothing here required a newer checkout, which is itself worth recording — the
session halves of these three products have not moved under the library halves.

---

## 0. The correction this document opens with

**The position on session import changed on 2026-08-31, and four sites still
quote the version it replaced.**

[25 E4](docs/design/25-open-questions.md) was retitled from *"Session import from other
platforms — speculative, not roadmapped"* to *"— conditional on an interchange
format"*, and its opening line now reads **"Not a commitment, and no longer a
flat refusal. The condition is the shape, not the appetite."** The four sites
that cite it were written one to two days earlier and say *closed*:

- [P4 §4](docs/design/workplan/16-p4-implementation.md) — *"Chat and session history import —
  closed, not deferred… Confirmed by citation"*, quoting E4's superseded
  *"speculative and unroadmapped"*.
- [P7 §1.10](docs/design/workplan/23-p7-implementation.md) — *"[25 E4] already closed chat and
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
[P11](docs/design/workplan/27-p11-implementation.md).**

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
([P4 §1.3](docs/design/workplan/16-p4-implementation.md), corrected 2026-08-31). A session
importer aimed at the interchange format before session export writes it has that
shape exactly. [work plan §2.2](docs/design/workplan/01-work-plan.md) is the rule — *"do not build a
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
[01 §4](docs/design/01-source-survey.md) has one cell for all of this — *"Running story |
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
[P4 §6.2](docs/design/workplan/16-p4-implementation.md) already flags as the weak point of the
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
[01 §1](docs/design/01-source-survey.md) and all already readable here: the data root, the
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
[P7 §1.10](docs/design/workplan/23-p7-implementation.md) already owns as channel-shaped, and
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

**This is the shape [25 E4](docs/design/25-open-questions.md) argues for, built by somebody
else and working.** One documented target the app owns and versions, additive
across nine revisions, with the importer explicitly forbidden from depending on
the exporter — the header comment says so. It is evidence that E4's proposed shape
is not merely tidy in principle, and it is the strongest single argument in this
document for taking E4's condition seriously rather than treating it as a
formality to be waived.

It also means the `.avt` path is the **cheapest of the three to convert** — one
file, no tree walk, no relational join, a declared version to gate on — which
inverts the ordering somebody would guess from [01 §2](docs/design/01-source-survey.md), where
Aventuras is the source with no on-disk survey.

*Correcting our own record:* [P4 §1.5](docs/design/workplan/16-p4-implementation.md) surveyed
three Aventuras extraction paths — lorebooks as SillyTavern files, characters and
scenarios as raw JSON, and the whole vault as a zip of a SQLite snapshot. **`.avt`
is a fourth and was missed**, which matters because P4 called the SQLite snapshot
*"the heavy path"* and described the vault export as the way a whole library
leaves. For sessions specifically there is a light path, and it is better than any
of the three.

**The history model is the closest of the three to ours.** `StoryEntry` is
`{ id, storyId, type, content, parentId, position, createdAt, metadata, branchId,
… }` with `type: 'user_action' | 'narration' | 'system' | 'retry'` — a real
`parentId`, so the history is already a tree — and `Branch` is
`{ id, storyId, name, parentBranchId, forkEntryId, checkpointId, createdAt,
snapshotComplete }`, which is [07 §3](docs/design/07-branching.md)'s `BranchRef` with a fork
point attached. `EntryMetadata` carries `tokenCount`, `model`, `profileId`,
`temperature`, `reasoningEffort` and `generationTime`: genuine instrumentation
that lands in our `cost` and `request.calls[].params` rather than being
fabricated.

**One mismatch, and it is structural rather than lossy.** A `StoryEntry` is one
*message* — a `user_action` or a `narration` — and a [03 §8](docs/design/03-data-model.md)
`Turn` is one *input and its output together*. Converting is a pairing pass over
the entry list, not a rename, and `type: 'retry'` is a third case that pairs with
neither. Nothing is lost either direction; the point is that the arithmetic is not
one-to-one and a plan that assumes it is will be wrong about its own size.

---

## 3. What import asks of the interchange format

**This is the section with a deadline, and the only one addressed to a phase.**

[25 B12](docs/design/25-open-questions.md) ships session export at 1.0, owned by
[P11 §1.8](docs/design/workplan/27-p11-implementation.md), and E4 is explicit that *"a format
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

3. **Siblings must survive the round trip.** [07 §3](docs/design/07-branching.md) makes swipes
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

[03 §8](docs/design/03-data-model.md) specifies `origin: Provenance` on Session and it is
unimplemented. `stampImported<T extends { provenance: Provenance }>`
(`packages/server/src/import/identity.ts`) — the function that makes a re-import
findable — does not typecheck against a session.

**Why this one is urgent and the other three are not.** [04 §1](docs/design/04-schemas.md)
puts Session and Turn in the *free to move* tier **because nothing exports them**,
and `turn.ts` names the event that ends it in its own header. Adding a field now
is an edit; adding it after P11 is a migration of a frozen portable format. This
is [work plan §2](docs/design/workplan/01-work-plan.md)'s retrofit test met exactly — *it changes a
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

`BranchRef` is specified at [07 §3](docs/design/07-branching.md) and **has no
implementation** — no occurrence in `packages/`, and the index's `branch_id`
column is written `null` by construction. `GET /sessions/:id/turns` returns
`walkPath(head)`, so siblings are unreachable from the only surface that lists
turns.

The consequence is specific: import a chat with swipes today and the alternatives
land correctly in the tree and cannot be seen, named, or switched to.
[P6](docs/design/workplan/18-p6-implementation.md) owns the turn tree and its sibling
navigation, which is the phase that removes this — another reason the sequencing
in §1 is a finding rather than a preference.

### 4.4 `LoreScope` would gain a target it has never had

[P4 §1.4](docs/design/workplan/16-p4-implementation.md) shipped `LoreScope` with two arms
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
  off [P11 §0.4](docs/design/workplan/27-p11-implementation.md)'s localisation sweep.
- **The session write path.** `createSession`, `appendTurnOnly`, `advanceHead`,
  `reconcileSession` — turns can be written without running a model today.

**What is missing is the format, not the plumbing.** That is the same sentence E4
arrives at from the other direction, and the two agreeing is the closest thing to
a conclusion this document has.

---

## 6. Sequencing

**After [P11](docs/design/workplan/27-p11-implementation.md), and not before**, for the reason
in §1: until session export exists, an importer for the interchange format is a
reader for a format with no writer, and [work plan §2.2](docs/design/workplan/01-work-plan.md)
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

**The one recorded way to reopen it earlier** is
[P7 §1.10](docs/design/workplan/23-p7-implementation.md)'s: *"a **format** argument rather
than a completeness one… the case reopens for that one shape only."* E4's revision
supplies exactly that argument, and P7's own §1.10 was written before it. Whoever
holds P7's revisit should read the two together rather than either alone — which
is why §0's corrections reach that section too.
