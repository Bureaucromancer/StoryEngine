# 30 — P13 implementation plan

**Status: design only — no stage started.** Written 2026-09-26 on
`claude/epic-hypatia-p1h6my`, from a survey of Aventuras at `c43da108`
(2026-09-25). Part 1 is planned to the stage; **Part 2 is headed and not
scheduled**, for the reasons [§0.3](#03-how-this-sits-with-25-e4) gives. Nothing
here has been built, and [§0.4](#04-what-the-survey-found-in-our-own-tree)'s
three findings against shipped code are findings, not fixes.

**P13 is the whole of an Aventuras install, in one import: the library now, the
stories after.** Today a person leaving Aventuras hands us one vault record per
file — a scenario, a character, a lorebook
([P4 §1.5](16-p4-implementation.md)) — and has no way to hand us the rest. The
rest is one SQLite file, and every road out of Aventuras that carries more than
one object passes through it.

---

## 0 — Why this phase exists

### 0.1 The library half is transport, because the converters are written

[P4 §1.5](16-p4-implementation.md) wrote three converters —
`import/aventuras/{scenario,character,lorebook}.ts` — against the vault's own
export shapes, and those shapes are **the rows of three tables run through
Aventuras' row mappers** (`src/lib/services/database.ts`, `mapVaultCharacter`
`:3042`, `mapVaultLorebook` `:3154`, `mapVaultScenario` `:4347`). A reader that
produces the mapped objects from the rows hands the existing converters exactly
what they already take, with two exceptions
[§0.4](#04-what-the-survey-found-in-our-own-tree) names. So most of Part 1 is
not conversion. It is getting from a file somebody has to a row somebody can
read — which is the part P4 called *"the heavy path"* and did not build.

### 0.2 The database is the only artefact that carries everything

[01 §2](../01-source-survey.md)'s *library on disk* is the survey; the short
form is that Aventuras keeps **one** SQLite file, `aventura.db`, holding every
story, every vault object, every pack, every tag and every setting, and that
four things leave the app:

| Exit | Carries | Read here |
|---|---|---|
| Vault JSON, one record per file | one character, scenario or lorebook | **yes** — [P4 §1.5](16-p4-implementation.md) |
| `.avt`, one story per file, versioned (1.10.0) | one story, all branches, images inline | no — Part 2, [P13.15](#p1315--avt-through-the-same-producer) |
| Full backup: a zip of a `VACUUM INTO` snapshot plus `metadata.json` | everything | **this phase** |
| LAN sync | selected stories as `.avt`, one request each, from a running app | no — it is a phone-to-desktop feature, not an export |

**Nothing but the database carries the vault as a whole, the packs, or the
tags.** A person with forty characters and a dozen books can hand us forty-odd
files today, one export dialog at a time, and still cannot hand us their packs
at all. The backup zip is one button in Aventuras' settings, and the config
directory is one path.

### 0.3 How this sits with 25 E4

[25 E4](../25-open-questions.md) makes **session** import conditional on an
interchange format and argues against the shape this phase could be mistaken
for: *"writing a converter per source is what rots."* Part 1 is not session
import — it is card, lorebook and preset import, which E4's last paragraph calls
*"committed and early"*, arriving through a new transport. **Part 1 needs no
reading of E4 at all.**

Part 2 does, and the reading is recorded at E4 rather than only here. E4's
condition was *an interchange format*; [P11.10](28-p11-implementation.md)
shipped `storyengine.session-export/1` and its reader, so the condition is met
in the letter. What E4 is protecting is the maintenance shape — *"we maintain
one format, not N importers"* — and Part 2 keeps it by construction:

- **The Aventuras story converter is a producer of the format, not a reader of
  its own.** It emits a `SessionExport` and hands it to `importSession`, the one
  reader. [P12.8](29-p12-implementation.md)'s `backup/import.ts:251` already
  does exactly this for our own archives, so the shape has a working instance.
- **Deleting it deletes nothing else.** If Aventuras moves and nobody follows,
  the producer is removed and the reader, the format and every other import are
  untouched. That is the property E4 wanted, and it is the test a per-source
  *importer* fails.

[18 §6](../18-session-import.md) says *"no phase number is proposed"*, and this
document gives the stories a number anyway. It does so on
[P12 §1.5](29-p12-implementation.md)'s argument — a roadmap entry holds no
commitment, and Part 1 is being built — and only as **headings**, so the stage
names are checkable by `tools/citation-targets.test.ts`. The stories stay not
scheduled; 18 §6 records the reading.

### 0.4 What the survey found in our own tree

Three findings, each against code that has shipped, and each a stage of its own
before anything is built on top.

**`importSession` may re-point another session's turns** — suspected, not yet
reproduced. `sessions/import.ts:151` appends each turn with the `sessionId` it
arrived with (`foreignise` adds `foreign` and nothing else), and
`appendTurnOnly` hands that turn to `indexTurn`
(`index-db/sessions.ts:136`, `:148`), which indexes by `turn.sessionId` and
upserts on `turn_id`. Turn ids are kept on import by design. So importing a
session **onto the install it was exported from** would write index rows naming
the *original* session for turns whose bytes live in the *copy* — and the
original's rows for the same ids would be overwritten to point there.
`sessions/import.test.ts:66-100` imports onto the same install, which is the
case, but reads the new session back and never re-reads the original, which is
where it would show. [P12.8]'s `backup/import.ts` shares the path. **P13.0
writes the failing test first**, because a finding against a shipped reader that
is not reproduced is a guess.

**Vault lorebooks are not stored as `Entry[]`.** `lorebook_vault.entries` holds
`VaultLorebookEntry[]` — `{ name, type, description, keywords, aliases,
injectionMode, priority }`, flat (`src/lib/types/index.ts:305`) — and the
`Entry[]` that `convertAventurasLorebook` reads is what Aventuras' *file* export
produces from it, through `vaultEntryToEntryLike`
(`lorebookImportExport/export/vault.ts:18`). `isAventurasLorebook` requires
`injection.mode`, so a vault row handed over as-is is `wrong-shape` every time.
The reader ports that one function. [P4 §1.5](16-p4-implementation.md)'s mapping
line — *"`Entry`'s static half → lorebook entries"* — is corrected there.

**Aventuras entry ids collide on a repeated name, possibly.**
`aventuras/lorebook.ts:103` derives an entry's id as
`stableId('aventuras-entry', book, name)`, and nothing in Aventuras makes an
entry name unique within a book. Two entries both called *The Harbour* would
share an id. **To verify before fixing** — the converter may dedupe downstream,
and the file path has had this key since P4.3 without a report.

---

## 1 — The decisions this phase makes

### 1.1 One source kind, four transports

A new `ImportSourceKind` arm, `'aventuras'` (`import/source.ts:71`), and a
probe that requires only `aventura.db` (`import/detect.ts`). One kind because
[P12.8](29-p12-implementation.md)'s rule holds here too — *an archive is a root
read through a different file source* — and every transport below arrives at
the same thing: a root with `aventura.db` in it.

| Transport | How it becomes a root |
|---|---|
| The config directory, by server path (`POST /import/sweep`) | `openLocalSource`, as a SillyTavern tree does |
| An unzipped backup, as a folder upload (`POST /import/directory`) | the upload's own file source |
| The backup zip (`POST /import/file`) | `ZipFileSource`, as a Marinara profile archive does |
| A bare `aventura.db` (`POST /import/file`) | `MemoryFileSource({ 'aventura.db': bytes })`, recognised by the SQLite header |

**`metadata.json` is not required**, because a config directory has none; when
it is present its `appVersion` and `storyCount` become notes. A backup old
enough to carry only `stories/*.avt` and no database classifies as
`loose-files`, which is correct: it is a folder of `.avt` files, and those are
Part 2's.

An `aventurasPreflight` sits beside `marinaraPreflight` and is called from both
`classifyRoot` and the reader's `survey()`, the pairing
[P4 §1.3](16-p4-implementation.md) requires so a preview and a sweep cannot
disagree.

### 1.2 The snapshot, and why a `-wal` file never refuses

**The reader never opens the source database for anything but a copy.** Two
routes to the copy:

- **With a real path** — a server-path sweep — open the source `readOnly` and
  `VACUUM INTO` a scratch file. This is Aventuras' own backup method
  (`backupService.ts`), and it is consistent under WAL while Aventuras is
  running: SQLite's own locking gives the snapshot a single point in time, and
  committed frames still in `-wal` are included. No bytes pass through the JS
  heap.
- **Without one** — a zip entry, an upload, a read-only mount on which the
  read-only open itself fails — write `aventura.db` and any `aventura.db-wal`
  into scratch, open the copy so SQLite replays the log, and run
  `PRAGMA quick_check`.

**A `-wal` file alone is not a refusal.** Marinara refuses a live install
because it marks one — `.writer-lease` — and reading around a lease produces a
torn library ([P4 §1.3](16-p4-implementation.md)). Aventuras marks nothing: a
`-wal` is left by every crash and every open app alike, and refusing on it
would refuse most real config directories. So the rule is the snapshot's: a
`VACUUM INTO` that succeeded needs no note; a copy that passed `quick_check`
carries `import.aventuras.walCopied` at `warn`, saying Aventuras may have been
open; a copy that fails the check refuses as `live-install`, whose message
already says the right thing.

### 1.3 Scratch lives under `state/`, through the layout

There is no scratch directory today. [P12]'s snapshot writes
`state/state.snapshot-<id>.sqlite` beside the database it copies, and this
follows it: `Layout.importScratchRoot` is `state/import-scratch/`.

- **Not `os.tmpdir()`**: in a container `/tmp` is commonly a small tmpfs, and
  these files are the size of somebody's whole Aventuras install.
- **Not under `users/`**: the watcher and the library never see it.
- **Excluded from backups** (`backup/archive.ts:183`'s `alwaysSkipped`), removed
  at boot for anything a crash left, and unlinked by the reader's `close()`.

`node:fs` stays inside `storage/` — the lint rule is not bent. The snapshot is a
new `storage/sqlite-snapshot.ts`; the reader receives a path it may open with
`node:sqlite`, which is not lint-confined and is already opened directly by
`index-db/open.ts` and `state/open.ts`. `LocalSource` gains `realPath(path)`,
applying `#resolve`'s containment and data-root checks, so a server-path sweep
can hand SQLite the real file.

### 1.4 Gate on the columns, not on the version number

Aventuras records its schema in sqlx's own table: `SELECT max(version) FROM
_sqlx_migrations WHERE success = 1` is 39 at the pin. **The gate is the columns
the reader selects** (`PRAGMA table_info`), not that number:

- a required column missing, or no `_sqlx_migrations` at all, refuses
  `unknown-format`;
- a version newer than the pin imports, with `import.aventuras.newerSchema
  { version, known: 39 }` at `warn`;
- late optional columns (`scenario_vault.starting_time` from 039,
  `pack_templates.baseline_hash` from 036) are read when present.

***This departs from Marinara's rule on purpose.*** Marinara refuses a store
newer than it knows because its version number stands in for an on-disk layout
we cannot inspect without guessing — a wrong guess converts through the wrong
tables ([P4 §1.3](16-p4-implementation.md)). SQL tables describe themselves, and
Aventuras' migrations have been additive for thirty-nine revisions. A newer
database with every column we read is a database we can read; refusing it would
refuse every install that updated after this survey.

Old versions are the more common case, and the reason for the rule rather than
an edge of it: **a restored backup is not migrated until Aventuras next
starts**, so backups in the wild carry whatever version wrote them.

### 1.5 Identity is the row, not the file

Every candidate's `source` is `aventura.db/<table>/<rowId>`. `stampImported`
makes that the object's `provenance.originalFilename`, and `identify()` keys
re-import on it. Aventuras row ids are uuids, so no install discriminator is
needed, and the key is the same whether the database arrived as a directory, a
zip or a bare file. A scenario's npc actors keep the existing
`${source}#npc:${name}`.

**The known cost, said in the review rather than discovered:** an object
imported earlier from an Aventuras *JSON file* has a filename-keyed provenance,
so a later full import does not recognise it and makes a second copy. The
conflict policy is the person's lever; the review names the first-time case.

### 1.6 Portraits are carried

The file path drops portraits with `import.aventuras.portraitNotCarried`. From
the database they are recoverable — a data URL or bare base64 in
`character_vault.portrait` — and a full import that lost every face would be a
worse import than the files.

- The reader decodes the portrait and hands the bytes to the Writer through a
  new `ImportCandidate.inline` map keyed like `assets`; `#createActor` reads
  `inline` before `request.files`.
- **A PNG becomes the card's pixels.**
- **Anything else** — Aventuras stores JPEG and WebP too — rides as
  `portrait-source` media on a blank card. `codecFor` knows only PNG
  (`storage/card/index.ts:29`), so `CreateFrom.cardPixels` becomes optional in
  `library.ts`, and `encodeObject` already falls back to `blankCardPixels`.
- An unreadable portrait is `import.card.portraitUnreadable` at `warn`, and the
  actor imports without it.

### 1.7 Links resolve inside the database

`linkedLorebookId` names a vault lorebook, and it appears on **characters**
(`characterVault.svelte.ts:429`) as well as scenarios. From a file it cannot
resolve; from the database it can. The reader emits candidates in dependency
order — tags, lorebooks, characters, scenarios — and the Writer keeps a map
from an Aventuras lorebook id to the id it stored, so a scenario's link becomes
`treatment.lore` and a character's becomes `actor.lore`.
`import.aventuras.linkedLorebookMissing` fires only when the link names a row
that is not there.

### 1.8 Tags merge and are never adopted

`vault_tags` joins the tag registry by `sameTag`: a new name is minted, an
existing one is left alone, **and nothing is recoloured**. Aventuras' free hex
colours map to the nearest of the eight `TAG_SWATCHES`
(`shared/src/tags.ts:51`), low saturation to `stone`. Their `type` column
(character, lorebook, scenario) has nowhere to go — our registry is not scoped
by kind — so one name used by two kinds becomes one tag, and a colour that
differed between them is a note.

**The imported objects are not stamped with `tagIds`.** `tags/adopt.ts`'s
header makes adoption an explicit act, and a bulk import is the least explicit
act there is.

### 1.9 Credentials are dropped, and not read

`settings` holds provider keys in plain text (`api_profiles`,
`openai_api_key`). [P4 §1.1](16-p4-implementation.md): **dropped, not
quarantined**. The reader runs `SELECT count(*)` on the table and nothing else,
and the review carries the count as the `credential` disposition. Nothing else
in the table is worth carrying: it is window widths, a theme and the same keys
again under other names.

### 1.10 Packs are their own stage

`pack_variables` carry across one for one — `PresetVariable` was adopted from
`CustomVariable` ([P4 §1.5](16-p4-implementation.md)). The templates do not. A
pack holds up to forty-three template ids, each with a `-user` half; two are
narrator prompts, one is P8-shaped, and the rest — classifier, wizard, image,
translation — have no counterpart here. Their Liquid resolves against
Aventuras' flat context and needs [P4 §1.6](16-p4-implementation.md)'s mapping
table. And most of them are not the person's: only a pack that is not the
default, and only a template whose `content_hash` differs from its
`baseline_hash`, is something somebody wrote.

So Part 1 records packs with counts, and
[P13.9](#p139--packs-into-presets) converts the ones that are worth it.
`pack_runtime_variables` are per-entity tracked state — channel-shaped, P7's —
and stay `recorded`.

### 1.11 Size, and the one transport with no ceiling

| Transport | Ceiling today | This phase |
|---|---|---|
| Server-path sweep | `maxFileBytes` 64 MB per read (`local-source.ts:57`) | **none** — `realPath` plus `VACUUM INTO` never reads the file into memory |
| Bare `.db` upload | `limits.maxUploadMb`, 64 by default, whole body in memory | works to the limit; past it, the existing 413 with the number |
| Backup zip upload | the upload limit, then `DEFAULT_ZIP_LIMITS` 64 MB per entry, 256 MB total | works while the database is under 64 MB; past it, `too-large` |

Aventuras keeps images as base64 in the database, so an install with a gallery
is hundreds of megabytes, and **the upload paths will turn those away until
[P13.8](#p138--streaming-large-uploads)**. The server-path sweep will not, which
is why Part 1 is useful without P13.8: an operator mounts the Aventuras config
directory and sweeps it. Whether P13.8 belongs in Part 1 is
[§4](#4--open-questions)'s first question, because it decides whether a person
on a Docker install with no shell can import a large library at all.

---

## 2 — Stages

*Depends on:* [P4](16-p4-implementation.md)'s sweep and converters,
[P11.10](28-p11-implementation.md)'s session format for Part 2, and
[P12.8](29-p12-implementation.md) for the shape a producer takes.

### Part 1 — the library

### P13.0 — The findings against shipped code

[§0.4](#04-what-the-survey-found-in-our-own-tree)'s three. The `importSession`
index re-point, as a failing test that re-reads the **original** session after
importing its own export, then the fix — the turns take the new session's id,
and `foreign` keeps the old one — then the same assertion over
`backup/import.ts`. The entry-id collision, verified before it is fixed. And
`VERDICT_LABELS` in `ImportPanel.tsx`, which lacks `charx` and
`storyengine-backup` and will need `aventuras`.
*Ends at:* the re-point test is green, and 28's P11.10 record names the defect.

### P13.1 — Scratch and the snapshot

`Layout.importScratchRoot`, `LocalSource.realPath`, `storage/sqlite-snapshot.ts`
([§1.2](#12-the-snapshot-and-why-a--wal-file-never-refuses),
[§1.3](#13-scratch-lives-under-state-through-the-layout)), the backup exclusion
and the boot cleanup.
*Proof obligation:* a WAL-mode database with committed, un-checkpointed frames
snapshots with those frames present, by both routes.

### P13.2 — The kind, the probe, and a reader that converts nothing yet

The `'aventuras'` arm; the probe; `aventurasPreflight` with the column gate
([§1.4](#14-gate-on-the-columns-not-on-the-version-number)); a
`SourceReader.close?()` that `sweep()` calls in a `finally` — the first reader
to hold a resource; `readerFor` receiving the layout. A vendored
`import/registries/aventuras.ts` — every table at the pin, a disposition for
each, the provenance comment `registries/marinara.ts` carries — with
`registries.test.ts` extended so no table lacks one, and a table found in
`sqlite_master` and not in the list reported `unrecognised`. Per-story tables
are `recorded` **with counts per story**, so the review says what Part 2 would
bring rather than only that something exists.
*Ends at:* a sweep of a real database produces a complete review and writes
nothing.

### P13.3 — Characters and their portraits

The `mapVaultCharacter` port, including `migrateVisualDescriptors`
(`database.ts:105`) — `visual_descriptors` can still be the legacy string array,
and `isVaultCharacter` wants a record — then the existing `#aventurasCharacter`.
Portraits per [§1.6](#16-portraits-are-carried).

### P13.4 — Vault lorebooks

`vaultEntryToEntryLike` ported without its `state` and timestamps, so
`entryStateRecorded` does not fire on state the vault never had;
`convertVaultLorebook(row)` wrapping `convertAventurasLorebook` and setting the
book's own description and tags. **An empty book imports as an empty book** —
`isAventurasLorebook([])` is false today, which is right for a file and wrong
for a row that exists.

### P13.5 — Scenarios, and the links

Candidate order, the lorebook-id map, `treatment.lore` and `actor.lore`
([§1.7](#17-links-resolve-inside-the-database)). `starting_time` rides in
`treatment.metadata`, which it already would.

### P13.6 — Tags

[§1.8](#18-tags-merge-and-are-never-adopted). `SweepRequest` gains the tag store.

### P13.7 — The other transports

The bare `.db` upload (`looksLikeSqlite` beside `looksLikeZip`), the zip upload,
the preview arm, and a near-miss: a sweep pointed at `~/.config`, or at
`Application Support`, suggests `com.karelian.aventura` beneath it
(`near-miss.ts`).
*Ends at:* the same database, handed over all four ways, produces the same
library, and the second sweep of any of them is all `unchanged`.

### P13.8 — Streaming large uploads

A multipart part streamed to scratch rather than buffered, and one zip entry
stream-inflated to scratch with its bounds still checked from the central
directory first. Probably a limit key of its own rather than a larger
`maxUploadMb` — which is the five-place config edit, and
`config.test.ts` will say so if one is missed. **Deferrable**; see
[§1.11](#111-size-and-the-one-transport-with-no-ceiling).

### P13.9 — Packs into presets

[§1.10](#110-packs-are-their-own-stage). A table from template id to what it
becomes here, [P4 §1.6](16-p4-implementation.md)'s namespace table for the
Liquid, variables one for one, and only modified templates. *This stage may
close as `recorded`* if the mapping table shows too little survives to be worth
a preset — that is a finding, not a failure.

### Part 2 — the stories, not scheduled

*Every stage below is a heading so it can be cited and checked, and none of them
is scheduled.* [0.3](#03-how-this-sits-with-25-e4) is the argument;
[18 §2.3.1](../18-session-import.md) is the survey these stages would build on.

### P13.10 — `importSession` for a producer

What the one reader lacks for a second caller. An optional
`origin.originalFilename`, which becomes the idempotence key
(`aventura.db/stories/<id>`), and a lookup for a prior session carrying it;
renditions written, not counted (`sessions/import.ts:155` counts them today);
parents validated to precede children, which the reader's own comment assumes
and nothing checks; `cast` and `lore` ids that must exist.

### P13.11 — The tree, and the pairing

[18 §2.3.1](../18-session-import.md)'s rebuild — lineage from
`branches.fork_entry_id` and per-branch positions, never from `parent_id`, which
is always null — and its pairing table: an action and its narration are one
`Turn`; an opening narration is a turn with no `input`; an action nobody
answered is `failed`; a second narration in a row is a turn of its own. A fork
that splits a pair re-pairs from the forked action, with
`import.aventuras.forkSplitPair`. Fields: `foreign = { source: 'aventuras', id }`,
set before the reader sees it so `foreignise` keeps it; metadata into `cost`,
**never** into `request`, which would fabricate a call
([18 §3](../18-session-import.md)'s first consequence); `reasoning` into
`output.reasoning`; `suggested_actions` into `suggestions`; branches into
`branchRefs`; the head from `stories.current_branch_id`.

### P13.12 — World state

Copy-on-write resolution for the head branch — `overrides_id` shadows,
`deleted` hides — then characters into cast actors and the story's `entries`
into one per-story lorebook in `session.lore`. What another branch holds
differently is recorded. Locations, items and story beats per
[§4](#4--open-questions).

### P13.13 — Images as renditions

`embedded_images` as `illustration`, `background_images` as `background`
(`shared/src/rendition.ts:87`). The format carries records, not pixels
(`session-export.ts:86`), so the producer writes the bytes through
`renditions/store.ts` itself.

### P13.14 — Chapters

Aventuras' chapter summaries onto [P8](25-p8-implementation.md)'s memory
channel, or recorded. The question is whether a summary somebody else's model
wrote is a memory this engine should trust, and it is P8's to answer.

### P13.15 — `.avt` through the same producer

A `.avt` is `gatherStoryData()` — every row for one story — serialised, so the
producer that reads a story from the database reads it from JSON with a
different row source. Optional; worth it only if people arrive with `.avt`
files and no database, which the LAN-sync and Android cases make plausible.

### What is deliberately not in this phase

- **LAN sync as a transport.** StoryEngine would have to be the client of a
  phone's HTTP server, from inside a container, per story.
- **`vault_assistant_conversations`** — a chat with Aventuras' own assistant,
  with no counterpart. `recorded`.
- **Checkpoints, world-state snapshots, time anchors, the time tracker,
  `kept_separate`, translations.** Derived, superseded, or ours already by
  another route. `recorded` or `skipped`, with a count.
- **Writing back.** Nothing here exports to Aventuras' database. The vault
  single-file writers ([P4](16-p4-implementation.md)) stay what they are.

---

## 3 — The exit gate

Two tiers, per [manual testing §0](05-manual-testing.md). The rows are not
edited to match what was walked. **Part 1's gate only** — Part 2 has no gate
until it is scheduled.

### 3.1 The critical list

| # | What | Why it is critical | Check |
|---|---|---|---|
| 1 | A real Aventuras config directory, swept by path **while Aventuras is open**, imports; the review reads correctly; Aventuras is unharmed and still opens | The snapshot's whole claim, and the one no fixture can make: that reading a live WAL database through `VACUUM INTO` is safe for the app holding it | By hand, on a real install |
| 2 | A real backup zip, uploaded, produces the same library as the directory sweep — same objects, and the second import of either is all `unchanged` | Identity keyed on the row, across transports | By hand |
| 3 | Portraits: a PNG portrait is the card image, a JPEG one is visible as its source image | The one place Part 1 carries more than the file path did, and a picture is only checkable by looking | By hand |
| 4 | A scenario with a linked lorebook, started as a session, plays with that lore bound | The link resolved is the link used, which the review cannot show | By hand, one turn |

### 3.2 The remainder — extends the standing list

| # | What | Where |
|---|---|---|
| 5 | A database of several hundred MB by server path: time and peak memory stay reasonable | [manual testing](05-manual-testing.md) |
| 6 | A Docker install with the Aventuras config directory mounted read-only | [manual testing](05-manual-testing.md) |
| 7 | A backup exported from Aventuras on Android | [manual testing](05-manual-testing.md) |
| 8 | Imported tag colours look like the ones in Aventuras | [manual testing](05-manual-testing.md) |

**Test obligations, for the stage commits.** A fixture database is built in the
test from **hand-written DDL** — only the columns the reader selects, taken from
the pinned schema — in `import/fixtures/test-aventuras-db.ts`, rather than from
Aventuras' thirty-nine migration files. Those are AGPL-3.0 text from another
project that would need their own attribution beside our SPDX pair, and they
would pin every test to far more schema than the reader reads. Variants:
current; legacy (string-array descriptors, no late columns); newer (040 and an
extra column, which must import); broken (a required column missing, which must
refuse); WAL with un-checkpointed frames; and zipped through
`storage/test-zip.ts`. The tests live in the `packages` vitest project.

---

## 4 — Open questions

1. **Is [P13.8](#p138--streaming-large-uploads) in Part 1?** Without it, a large
   library reaches us only by server path, and a person with no shell on their
   server cannot hand one over.
2. **Part 2: are `system` entries turns?** They are rare, and a turn with no
   input and system text is honest; so is `recorded`.
3. **Part 2: locations, items, story beats** — lore entries tagged by kind now,
   or `recorded` until a channel wants them? The first imports something usable
   and the second imports nothing wrong.

---

## 5 — The survey this rests on

| Source | Pinned at | Dated |
|---|---|---|
| Aventuras | `c43da108f6b3679950e76afe020f6b26abf0c9ce` (v0.7.11, 39 migrations, `.avt` 1.10.0) | 2026-09-25 |

The earlier pin, [18](../18-session-import.md)'s `8ae0d79a` (v0.7.8), is stale
for everything here: `.avt` has gained two versions since, the vault's tables
have gained columns, and the `retry` entry type 18 §2.3 describes has been
removed as never written. [01 §2](../01-source-survey.md)'s *library on disk* is
the survey in full.
