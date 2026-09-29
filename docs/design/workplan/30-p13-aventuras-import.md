# 30 — P13 implementation plan

**Status: merged to `main` 2026-09-29 at `7565265`, from
`claude/epic-hypatia-p1h6my`; the phase is open. Part 1 is built — P13.1 to
P13.9, each cited below by its commit, P13.9 closed `recorded` — and its gate is
unwalked; Part 2 was scheduled by the person on 2026-09-29
([§0.3](#03-how-this-sits-with-25-e4)) and is being built. P13.0 done —
`34b3174` (the failing tests), `75c56ca` (the fix), 2026-09-28, and the fix set
aside for main's own at the merge of 2026-09-29
([§0.4](#04-what-the-survey-found-in-our-own-tree)).** Written 2026-09-26 on
`claude/epic-hypatia-p1h6my`, from a survey of Aventuras at `c43da108`
(2026-09-25). Part 1 is planned to the stage; ~~**Part 2 is headed and not
scheduled**, for the reasons [§0.3](#03-how-this-sits-with-25-e4) gives~~
**Part 2 was headed and not scheduled, and is now scheduled**, as
[§0.3](#03-how-this-sits-with-25-e4) records.
[§0.4](#04-what-the-survey-found-in-our-own-tree)'s findings against shipped
code are fixed, and [§0.5](#05-found-in-passing-and-not-fixed-here) records what
the work that fixed them found and left.

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
  reader. [P12.8](29-p12-implementation.md)'s `backup/import.ts:275` already
  does exactly this for our own archives, so the shape has a working instance.
- **Deleting it deletes nothing else.** If Aventuras moves and nobody follows,
  the producer is removed and the reader, the format and every other import are
  untouched. That is the property E4 wanted, and it is the test a per-source
  *importer* fails.

[18 §6](../18-session-import.md) says *"no phase number is proposed"*, and this
document gives the stories a number anyway. It does so on
[P12 §1.5](29-p12-implementation.md)'s argument — a roadmap entry holds no
commitment, and Part 1 is being built — and only as **headings**, so the stage
names are checkable by `tools/citation-targets.test.ts`. ~~The stories stay not
scheduled; 18 §6 records the reading.~~

***Scheduled by the person, 2026-09-29.*** Asked to build P13's remaining parts,
the person answered *yes to everything for part 2*, with its two open questions
decided — [§4](#4--open-questions): system entries become turns, and locations,
items and story beats become lore entries, *"for now lore is the right
place"*, story beats being a feature they mean to build here later. That is the
commitment the paragraphs above said a number did not make, and it is made by
the person rather than by this document, which is the order E4 asks for. **The
shape does not change**: the story converter is still a producer of
`storyengine.session-export/1` handing its export to `importSession`, and
deleting it still deletes nothing else. [18 §6](../18-session-import.md) and
[25 E4](../25-open-questions.md) each record the scheduling where their own
*not scheduled* stood.

### 0.4 What the survey found in our own tree

~~Three findings~~ *Four*, each against code that has shipped, and together
[P13.0](#p130--the-findings-against-shipped-code-done) — **fixed at `75c56ca`**,
and the first of them fixed *again*, differently, by main the day before; the
merge kept main's (below).
The first was reproduced on 2026-09-28 and turned out to be larger than this
section first said, by a different mechanism; the text it replaced is kept
struck, because a finding that was wrong about its own mechanism is worth being
able to read.

~~**`importSession` may re-point another session's turns** — suspected, not yet
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
is not reproduced is a guess.~~

**An imported session shared its turn ids with the one it came from, and
everything that keys a turn by its id alone held only one of them** —
reproduced and fixed. [P11.10](28-p11-implementation.md) kept an imported
session's turn ids on the argument that a collision needed two installs
importing each other's sessions. It needed one: an export imported back onto the
install that wrote it, and every backup imported into its own account
([P12.8](29-p12-implementation.md)), is two sessions with one set of ids. Four
things key a turn by its id alone and were each wrong in their own way:

- **The index** — `turn` is keyed on `turn_id` (`index-db/migrations.ts:239`).
  The copy's turns were filed under the *original's* session id, because the
  importer never rewrote `turn.sessionId`, and the copy held no rows at all.
- **Search**, separately and even across installs: the importer copied
  `createSession`'s write steps and not the fourth, `indexSession`, so an
  imported session had no session row and search — which joins it — never found
  a word in it until the session played a turn.
- **The rendition jobs**, which were the worst of it. A job is unique by
  `rendition_id` (`state/migrations.ts:336`) and a rendition id is
  `${turnId}.${n}` (`renditions/store.ts:114`), so an **Illustrate** on the copy
  found the original's job and ran it: a paid render, the original's picture
  overwritten, and for a backdrop a turn appended to the original's session —
  possibly another account's.
- **The notification dedupe**, `artifact:${turnId}`, folded two sessions'
  notices into one.

The test this section planned could not have failed. `readTurns` walks the
segments and `readTurnById` checks the id on the line it read back and falls
back to the walk, so re-reading the original after importing its copy passed
against the defect and would have passed against the wrong fix. The defect
showed through **search, delete and rebuild**, and that is where `34b3174`
asserts it.

~~**The fix re-mints the turn ids** (`sessions/remint.ts`), by the person's
decision over the alternative — keying the index and the rendition jobs by
`(session, turn)` — as a rewrite by value, with `writeNewSession`, an append
guard, a rebuild that filed turns by folder (`INDEX_SCHEMA_VERSION` 10) and a
rendition-dispatch guard beside it; the backup docstring's promised skip
corrected rather than implemented.~~

***Superseded at the merge, 2026-09-29, by main's fix*** — `546386f` and the
commits around it, 2026-09-27, found from P12's side a day earlier and answered
a third way: **keep the turn ids and refuse the import** when the install
already holds its turns (`409 already-here`), which is also the skip the backup
docstring promised, now implemented. The same commits restamp each turn's
`sessionId`, index the session row, key rendition jobs by session, rework the
index (`INDEX_SCHEMA_VERSION` 11, per-session stamps) and write imported
renditions — so everything the re-mint fixed, main fixed too, except that a
session can no longer be imported beside itself. The person chose main's
answer when the branches met; `remint.ts`, the v10 rebuild rule and the
dispatch guard were dropped at the merge, and [P11.10](28-p11-implementation.md)'s
record is main's with one line pointing here. What this section still adds is
the account of the mechanism from the import side — the Illustrate on a copy
that re-rendered the original's picture, and why the turn routes hid all of it.

**Vault lorebooks are not stored as `Entry[]`.** `lorebook_vault.entries` holds
`VaultLorebookEntry[]` — `{ name, type, description, keywords, aliases,
injectionMode, priority }`, flat (`src/lib/types/index.ts:305`) — and the
`Entry[]` that `convertAventurasLorebook` reads is what Aventuras' *file* export
produces from it, through `vaultEntryToEntryLike`
(`lorebookImportExport/export/vault.ts:18`). `isAventurasLorebook` requires
`injection.mode`, so a vault row handed over as-is is `wrong-shape` every time.
The reader ports that one function. [P4 §1.5](16-p4-implementation.md)'s mapping
line — *"`Entry`'s static half → lorebook entries"* — is corrected there. *Not a
defect in shipped code but in the plan's reading of it; it is P13.4's.*

~~**Aventuras entry ids collide on a repeated name, possibly.**~~ **Aventuras
entry ids collided on a repeated name** — confirmed and fixed.
`aventuras/lorebook.ts:103` derived an entry's id as
`stableId('aventuras-entry', book, name)`, and nothing in Aventuras makes an
entry name unique within a book. Nothing downstream caught it either:
validation does not walk the array, the index keys entries by position, and the
editor resolves an id to its first match — so the second twin could not be
opened, and deleting or dragging either deleted both. The scenario-as-lorebook
path had the same defect twice over: twin npcs, and an npc literally named
`setting`, which derived the setting entry's own id. ~~`claimId`~~ — fixed on
this branch with `claimId`, and on main the same day with `distinctIds`
(`import/identity.ts`), which the merge kept: the first claimant keeps its id,
so a book with no repeats converts to the same bytes and re-imports
`unchanged`, and a repeat is re-derived until it is free.

**`VERDICT_LABELS` lacked `charx` and `storyengine-backup`**, so a person
pointing the panel at either folder was told its raw kind. Both now have a
sentence, a test reads the probe table so the next kind cannot be missed, and
`docs/api.md` lists the five directory verdicts. `aventuras` joins at P13.2,
when the kind exists.

### 0.5 Found in passing, and not fixed here

The investigation behind P13.0 read widely, and found these. None is P13's, and
each is recorded so it is not rediscovered. ***The three that lose data are
fixed*** — `4625232` red, `25cb412` green, 2026-09-28, at the person's ask;
***the rest do not***, which is why they stay: lore timing is behaviour, and
the trash, folder-name and `foreign.source` items are index rows or words,
which a rebuild or a correction recovers without anything having been lost.

- ~~**Twin npc actors overwrite each other.**~~ *Fixed at `25cb412`: a repeated
  name is keyed `#npc-repeat:<n>:<name>`, the first keeps its old key, and the
  review says so.* **Twin npc actors overwrite each other.** A scenario imported as a treatment
  stamps each npc `${source}#npc:${name}` (`import/sweep.ts:721`); the second of
  two npcs with one name `identify()`s as the first, replaces it, and the cast
  names one actor twice.
- **Lore timing is keyed by entry id across books.** `se.lore.timing`
  (`sessions/channels.ts:58-87`, `retrieval/retrieve.ts:196-232`) takes an entry
  id alone, while [04 §5.2](../04-schemas.md) says the same id in two books is
  not the same entry; `retrieval/blocks.ts:200-206` namespaces block ids by book
  for this reason and timing was never given the same.
- ~~**The client's `withoutEntry` and `moveEntryBefore`**~~ *Fixed at
  `25cb412`: both now act on the first match, as `withEntry` did.* **The
  client's `withoutEntry` and `moveEntryBefore`** (`editor/book-form.ts:110`,
  `:162`) act on every entry sharing an id, where `withEntry` acts on the first —
  so a byte-identical twin from any converter is deleted with its sibling.
- ~~**A backup swept from the import panel defaults to `replace`**~~ *Fixed at
  `25cb412`: the sweep applies `DEFAULT_BACKUP_CONFLICT` to a backup root when
  no policy is given.* **A backup swept from the import panel defaulted to
  `replace`**, where
  [P12.8](29-p12-implementation.md) decided `skip` for a backup meeting a live
  account: the panel sends no `onConflict` and the sweep's default is `replace`.
- **A session restored from the trash is never re-indexed.** `routes/me.ts`
  says the watcher does it; the watcher parses library paths only.
- **`readSession` never checks a folder's name against the id inside it**, so a
  session folder copied by hand without editing its id overwrites the original's
  `session` row on rebuild.
- ~~**`DirectorySource.read()` and `exists()` followed symlinks out of the
  sweep root**~~ — *found and fixed at P13.1*: `#resolve` is lexical, so a link
  inside a swept folder could read a file outside it, including the data
  directory's own `accounts.json`, against `FileSource`'s documented contract.
  Both now go through `#reach`, which checks the link's target.
- **`sweep()` drops a reader's survey notes on success** — found at P13.2. A
  `SourceSurvey` carries notes, and on a successful survey nothing puts them in
  the report: the Aventuras reader carries its own on the database's row as a
  workaround, and the backup reader's `import.backup.noSuchAccount` has never
  reached a person. A report-level notes field is the fix, and it touches the
  shared type and the ledger.
- **`foreign.source` means two things.** `turn.ts:962-970` describes the source
  application; the importer writes the source *session's* id.
- **A vault character's unreadable `metadata` still imports around it** —
  found at P13.5. Since P13.5 that column carries the character's
  `linkedLorebookId`, so under `replace` a re-sweep drops `actor.lore` from a
  good copy; history keeps the old version. P13.3's behaviour is kept because an
  actor is far more than its link, where a treatment largely is its links — but
  it is the class of loss P13.4 and P13.5 refuse rows over.
- **A scenario's npcs duplicate vault characters of the same name** — found at
  P13.5. [§1.5](#15-identity-is-the-row-not-the-file)'s keying makes each npc its own actor,
  `…/scenario_vault/<id>#npc:<name>`, so a cast member who is also a vault
  character arrives twice. As written, and worth a later dedupe or a review
  sentence.
- **`tagColourDiffers` will be common, and rarely about a choice** — found at
  P13.6. Aventuras draws a tag's colour at random per name and kind, so a name
  used by two kinds usually differs, and the colour the note reports is seldom
  one a person picked. A quieter note, or none when neither colour was ever
  edited, would need Aventuras to record that, and it does not.
- **A tag name with no `vault_tags` row gets no colour** — found at P13.6.
  Aventuras seeds the table from its objects' tags only while it is empty
  (`ensureTagsMigrated`), so an object can carry a name the table never had;
  tags are open, so it renders neutral, and nothing is lost.
- **Neither zip reader checks CRCs** — noted at P13.8. Both trust the inflate
  and the database's own `quick_check` afterwards; recorded in
  `storage/zip-file.ts`'s header.
- **`storage/README.md`'s file table is stale** — found at P13.8: it lists five
  files and misses the zip and tar readers, the trash, the snapshot and more.
- **Neither upload door records an import job** — found at P13.7. Only
  `/import/sweep` calls `recordImport`, so a library brought in by folder or
  file upload has no addressable review, and `/import/objects/:id/notes` finds
  nothing for its objects. It predates P13 and holds for every upload.
- **A server-path sweep of the wrong folder walks it before advising** — found
  at P13.7. Pointed at `~/.config` or a home folder, the sweep loose-walks it
  within `DEFAULT_LOCAL_LIMITS` before the near miss is shown; the client asks
  `inspect` first, which softens it, and a direct API sweep does not.
- **Aventuras' Liquid is `jsTruthy`, and ours is not** — found at P13.9. An
  empty string is falsy there and truthy here, so any later pack converter, or
  a person pasting a template across by hand, gets a branch that fires where
  it did not.
- **A story's own narrator prompt lives in `stories`, not the pack** — found
  at P13.9, for Part 2. `settings.customSystemPrompt` overrides the pack per
  story, so the narrator prompt somebody actually edited may be there;
  [P13.11](#p1311--the-tree-and-the-pairing) should record it rather than
  drop it.
- **The trash defeats both `already-here` checks** — found at P13.10. A
  trashed session has no index rows, so the same export or source imports
  again, and restoring the trashed one then leaves two sessions with one set of
  turn ids — [§0.4](#04-what-the-survey-found-in-our-own-tree)'s problem by
  another road. `backup/import.ts` guards by session id; `/sessions/import` and
  a producer cannot. Recorded in `sessions/import.ts`'s header.
- **The exporter's id sort is not creation order across installs** — found at
  P13.10. Clock skew between two installs that played one session lets a child
  sort first; the importer no longer depends on it, and export files can still
  list children first.
- **`POST /sessions/import` drops `prior`** — found at P13.10: a key-based
  `already-here` cannot tell the person which session it matched, where the
  client could offer a link to it.
- **Copies made before main's fix keep the original's turn ids on disk.** Main's
  index rework decides what a rebuild makes of them; the repair is to delete the
  copy, since main now refuses the import that made it. No release carried
  session import, so this is development data.

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

~~An `aventurasPreflight` sits beside `marinaraPreflight` and is called from both
`classifyRoot` and the reader's `survey()`, the pairing
[P4 §1.3](16-p4-implementation.md) requires so a preview and a sweep cannot
disagree.~~ *As built, P13.2:* the probe is **name-only**, and the gate runs
once, in the reader's `survey()`, on the snapshot. `classifyRoot` also answers
a folder plan — names and no bytes — and a preview, and a `FileSource.read` is
capped at 64 MB while a real database is often larger; a gate that needs SQLite
on a copy cannot run there. A preview can therefore say *an Aventuras library*
of a database the sweep then refuses, which is the one disagreement the pairing
existed to prevent, and the price of a probe that stays a probe.

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

***Amended at P13.1, 2026-09-29, by what building it found.*** Three things
the paragraphs above did not know:

- **A read-only open is not free.** A connection to a WAL database — a
  read-only one included — creates the `-wal` and `-shm` beside it when they
  are missing, and leaves them. A cleanly closed Aventuras has neither, so the
  ordinary case, *close the app, then import*, would have left two files in
  somebody's config directory, made by our process. So the vacuum route is
  taken **only when it creates nothing** — a rollback-journal database, or a
  WAL database whose `-wal` and `-shm` are both already there (Aventuras open,
  or crashed) — and every other real path takes the copy route.
- **The copy route brackets itself.** It copies the `-wal` before the
  database and fingerprints the source before and after; a source that moved
  in the window refuses `live-install` rather than yielding a copy that mixes
  two moments. `quick_check` stays as the last word.
- **Room first.** A snapshot is a copy the size of somebody's whole install,
  written into our data volume, so it checks free space before allocating
  anything — the backup subsystem's rule — and a shortfall is a typed
  `SnapshotSpaceError` carrying the numbers, which P13.8's route turns into a
  507. A failure that is ours (disk full, out of memory, an I/O error on our
  copy) throws; only the source's faults refuse.

***Both run in a worker thread*** — *added 2026-09-28, from the P13.8 review.*
`node:sqlite` is synchronous, and the server has no worker threads today, so a
`VACUUM INTO` or a `quick_check` over a database of hundreds of megabytes on the
main thread would stall **every** request for as long as it ran, other people's
live turns included. A worker is the whole remedy: the snapshot is a function of
two paths and returns a path, so nothing crosses the boundary but strings.

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
~~applying `#resolve`'s containment and data-root checks~~ *resolving the link
target and checking it against the root and the data directory*, so a
server-path sweep can hand SQLite the real file.

*As built, P13.1.* `#resolve` turned out to be lexical only — it never looked at
a link's target — so `realPath` checks the **resolved** path, through a new
`#reach`; and `read` and `exists` now go through `#reach` too
([§0.5](#05-found-in-passing-and-not-fixed-here)). Scratch is its own module,
`storage/import-scratch.ts` — one directory per use, so disposing it takes the
side files SQLite makes with it — and **P13.8's hand-over is not a `realPath`
amendment**, as P13.1's stage text first had it: scratch lives inside the data
directory, which `realPath` refuses by design. A landed upload is instead an
`owned` input to the snapshot, whose ownership passes to it.

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

*As built, P13.2 — two refinements the letter above would have got wrong.* A
table the database's **own recorded version predates** — `preset_packs` before
migration 030 — is read as empty, not refused; only a table missing from a
database at or past the migration that made it is `unknown-format`. Without
that, every backup older than the packs would be refused with a message saying
it was too new. And `pack_variables.description` and `sort_order`, added one
migration after their table, are optional beside the two late columns named
above (`import/aventuras/schema.ts`).

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
existing one is left alone, **and nothing is recoloured**. ~~Aventuras' free hex
colours~~ Aventuras' colours — *as built at P13.6*, a Tailwind token such as
`indigo-500` drawn at random from seventeen, with hex read as well — map to the
nearest of the eight `TAG_SWATCHES` (`shared/src/tags.ts:51`) by hue, low
saturation to `stone`, and a colour that will not read to no swatch at all. Their `type` column
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
pack holds up to forty-three template ids, ~~each with a `-user` half; two are
narrator prompts, one is P8-shaped~~ *thirty-eight of them with a `-user` half,
eighty-one rows in all; two are narrator prompts and nine the memory and
retrieval pipeline* (counted at P13.9), and the rest — classifier, wizard,
image, translation — have no counterpart here. Their Liquid resolves against
Aventuras' flat context and needs [P4 §1.6](16-p4-implementation.md)'s mapping
table. And most of them are not the person's: ~~only a pack that is not the
default, and only a template whose `content_hash` differs from its
`baseline_hash`, is something somebody wrote~~ *as built at P13.9, a template
is somebody's when it differs from the text the pin ships, by Aventuras' own
hash — the default pack's edits are real ones, which is what migration 036 was
for; Aventuras' pack import writes content as its baseline, so a shared pack
reads as untouched by the older test; and a database before 036 has no
baseline at all*.

So Part 1 records packs with counts, and
[P13.9](#p139--packs-into-presets-done-recorded) ~~converts the ones that are
worth it~~ *found none worth it, and names what stays behind*.
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
[P13.8](#p138--streaming-large-uploads-done)**. The server-path sweep will not, which
~~is why Part 1 is useful without P13.8~~ is why P13.8 comes after the reader
rather than before it: an operator mounts the Aventuras config directory and
sweeps it.

***P13.8 is in Part 1*** — [§4](#4--open-questions)'s first question, answered
2026-09-28. The case for it is narrower than *operators have no shell*: a
compose user has edited a YAML file, and unraid's data share is visible over
SMB. The people with **no other route** are a person on a phone — an Android
backup exists only as a file — and every account without `fileAccess`, which is
the default, and which the server-path sweep refuses. Building the upload arms
once, streamed, is also cheaper than building them in memory at P13.7 and again
here. It is not forced by the gate: critical row 2 holds for any backup under
64 MB.

---

## 2 — Stages

*Depends on:* [P4](16-p4-implementation.md)'s sweep and converters,
[P11.10](28-p11-implementation.md)'s session format for Part 2, and
[P12.8](29-p12-implementation.md) for the shape a producer takes.

### Part 1 — the library

### ~~P13.0 — The findings against shipped code~~ Done

*Done — `34b3174` (the tests, red), `75c56ca` (the fix), 2026-09-28; the
session half superseded by main's fix at the merge of 2026-09-29 (§0.4).*
[§0.4](#04-what-the-survey-found-in-our-own-tree)'s findings. ~~The
`importSession` index re-point, as a failing test that re-reads the **original**
session after importing its own export, then the fix — the turns take the new
session's id, and `foreign` keeps the old one — then the same assertion over
`backup/import.ts`.~~ The turn-id collision, as failing tests through **search,
delete and rebuild** — the turn routes cannot show it — then the fix: turn ids
re-minted on import by value (`sessions/remint.ts`), the session indexed when it
lands, a rebuild that files turns by folder, and a rendition dispatch that
never runs another session's job; the same assertions over `backup/import.ts`
under all three policies. The entry-id collision, verified, then fixed with
`claimId`. And `VERDICT_LABELS`, which lacked `charx` and `storyengine-backup`.
~~*Ends at:* the re-point test is green, and 28's P11.10 record names the defect.~~
*Ended at:* fifteen tests red for their stated reasons at `34b3174`, green at
`75c56ca` with the rest of the suite, and 28's P11.10 record corrected.

### ~~P13.1 — Scratch and the snapshot~~ Done

*Done — `c44feed`, 2026-09-29.* `Layout.importScratchRoot`
(`state/import-scratch/`) and `storage/import-scratch.ts`; `realPath` on the
directory source, through the new link-checking `#reach`;
`storage/sqlite-snapshot.ts` with four inputs (`path`, `bytes`, `owned`, and the
copy fallback) and a self-contained worker, `sqlite-snapshot-worker.ts`, that
runs `VACUUM INTO` and `quick_check` off the main thread and loads from both the
TypeScript sources and `dist` (`sqlite-snapshot.dist.test.ts`, which needs
`pnpm build` first, as CI does); the backup exclusion; the boot sweep in
`buildApp`, deliberately not in `buildServices`. ~~`Layout.importScratchRoot`,
`LocalSource.realPath`, `storage/sqlite-snapshot.ts`
([§1.2](#12-the-snapshot-and-why-a--wal-file-never-refuses),
[§1.3](#13-scratch-lives-under-state-through-the-layout)), run in a worker
thread, the backup exclusion and the boot cleanup. P13.8 lands its uploads in
the same scratch root, so it also needs a way to hand the reader a file it
already owns — recorded here as an amendment to §1.3's `realPath`, which only
covers a server-path source.~~ The hand-over is the `owned` input
([§1.3](#13-scratch-lives-under-state-through-the-layout)).
*Proof obligation, met:* a WAL-mode database with committed, un-checkpointed
frames — writer held open, autocheckpoint off — snapshots with those frames
present by the vacuum route, the copy route, bytes with the log, and an owned
file with its log; a control shows the main file alone lacks them. Two tests
hold a main-thread lock that only a main-thread timer releases, so the snapshot
completing proves the SQLite work ran elsewhere.

### ~~P13.2 — The kind, the probe, and a reader that converts nothing yet~~ Done

*Done — `0de1454`, 2026-09-29.* The `'aventuras'` kind and a name-only probe
(§1.1, as built); `import/aventuras/reader.ts` taking the snapshot by path,
from bytes, or from an owned landing, and `import/aventuras/schema.ts`'s column
gate (§1.4, as built); `SourceReader.close?()`, called by `sweep()` in a
`finally`; the vendored registry, `registries/aventuras.ts` — 28 tables, one
disposition each, `settings` counted and never selected; observed rows for the
database, each table, each story (what Part 2 would bring) and every other file
in the root; the 507 `no-space` answer on the sweep, folder and file routes,
brought forward from P13.8 because a server-path sweep can already need it; a
folder upload of an Aventuras folder carrying only the database, its log and
`metadata.json`, and refusing — rather than silently describing an older
database — when it names a log it does not send; and
`fixtures/test-aventuras-db.ts`, hand-written DDL with every column tagged by
the migration that added it. ~~The `'aventuras'` arm; the probe;
`aventurasPreflight` with the column gate; a `SourceReader.close?()` that
`sweep()` calls in a `finally` — the first reader to hold a resource; `readerFor`
receiving the layout.~~ *Ended at:* a sweep of a database produces a complete
review and writes nothing — every registry table accounted for, per-story
counts right, and a fake provider key in `settings` appearing nowhere in the
report or the ledger.

### ~~P13.3 — Characters and their portraits~~ Done

*Done — `2560802`, 2026-09-29.* `import/aventuras/vault-character.ts` maps each
`character_vault` row as Aventuras' own mapper would, repairing the legacy
descriptor array, and hands its portrait over as `ImportCandidate.inline`. A
PNG is the card; a JPEG or WebP is `portrait-source` media on the blank card
`#createActor` already had — so `CreateFrom.cardPixels` did not need to become
optional, as §1.6 expected; a portrait over 64 MB is measured and never loaded
(`import.aventuras.portraitTooLarge`). Two things beyond the stage, found by
it: a PNG whose body will not parse now costs the portrait rather than the
actor on every road in, and an actor carrying media now reports the id it was
stored under. `sweep()` logs a `close()` failure after a successful read
rather than losing the report of rows already written. ~~The
`mapVaultCharacter` port, including `migrateVisualDescriptors`
(`database.ts:105`) — `visual_descriptors` can still be the legacy string array,
and `isVaultCharacter` wants a record — then the existing `#aventurasCharacter`.
Portraits per [§1.6](#16-portraits-are-carried).~~

### ~~P13.4 — Vault lorebooks~~ Done

*Done — `b7651c7`, 2026-09-29.* `import/aventuras/vault-lorebook.ts`: each
`lorebook_vault` row mapped, its `VaultLorebookEntry[]` ported to the `Entry`
shape without invented state, and converted through the converter's core,
`convertAventurasEntries`, so an empty book imports empty while the file
path's guard stands. **An `entries` column that will not read refuses the row
and writes nothing** — first built as *import an empty book with a warning*,
and reversed before commit, because under the default `replace` a re-sweep
would then have emptied a good book already here. Lorebooks are emitted before
characters, for §1.7's links. *Recorded rather than fixed:* two vault books
with one name derive the same entry ids, which is harmless in a book and not
in a session, since lore timing is keyed by entry id alone — §0.5's timing
item, made likelier. ~~`vaultEntryToEntryLike` ported without its `state` and
timestamps, so `entryStateRecorded` does not fire on state the vault never had;
`convertVaultLorebook(row)` wrapping `convertAventurasLorebook` and setting the
book's own description and tags.~~

### ~~P13.5 — Scenarios, and the links~~ Done

*Done — `804f026`, 2026-09-29.* `import/aventuras/vault-scenario.ts` maps each
`scenario_vault` row as Aventuras' own mapper would and converts it through the
existing `convertScenario` — no second converter. An unreadable `npcs`,
`alternate_greetings` or `metadata` refuses the row, for P13.4's reason: a
treatment largely *is* its cast, its openings and its link, and under `replace`
a degraded one would overwrite a good one; a bad `tags` or `starting_time`
costs only itself. Candidates run lorebooks, characters, scenarios, and the
Writer maps each Aventuras lorebook id to the book stored for it — written,
unchanged, skipped or kept-both alike, so a re-sweep and a `skip` still
resolve. **Beyond §1.7:** a link whose book this sweep refused falls back to the
book an earlier sweep stored for that row (`identity.ts`'s `priorImport`),
since otherwise one corrupt book would, under `replace`, unlink everything
pointing at the good copy P13.4 deliberately left; a consequence is that a link
to a row since deleted in Aventuras still resolves to the book in the library.
`linkedLorebookMissing` fires for a row only when nothing resolves; the file
path, which cannot resolve, still says it always. Vault characters take their
own format, `aventuras.vault-character`, because rows resolve links and files
do not. *Ended at:* a database with linked books imports with `treatment.lore`
and `actor.lore` set, and a second sweep is all `unchanged`. ~~Candidate order,
the lorebook-id map, `treatment.lore` and `actor.lore`
([§1.7](#17-links-resolve-inside-the-database)). `starting_time` rides in
`treatment.metadata`, which it already would.~~

### ~~P13.6 — Tags~~ Done

*Done — `a0ef8b4`, 2026-09-29.* `import/aventuras/vault-tag.ts` reads each
`vault_tags` row as a candidate, emitted ahead of the books, and the Writer
hands it to `VaultTagMerge`, which joins it to the account's registry by
`sameTag`: a new name is minted, last in order, on the swatch nearest its
colour by hue, greys on `stone`; a name already here is left exactly as it
was, and `onConflict` is not asked, since a merge that never overwrites has
nothing for it to decide — `replace` recolouring would be the adoption §1.8
forbids by another road. **The colours were not hex**, as §1.8 expected: the
pin stores a Tailwind token (`indigo-500`) drawn at random from seventeen, so
tokens are read first and hex as well, and the whole palette's mapping is
pinned in a test (green lands on teal, the one close call). A colour that does
not read mints the tag without a swatch — the registry's own *no colour
chosen* — rather than as `stone`, which would claim a grey nobody picked. One
name from two kinds is one tag, in the first row's colour;
`import.aventuras.tagColourDiffers` fires when another row, or a tag already
here, lands on a different swatch. Rows report `converted` when their tag is
new to the sweep and `unchanged` otherwise, with no `objectId`. No imported
object carries `tagIds`. `SweepRequest.tags` is required, and every door that
sweeps passes it. *Ended at:* a second sweep is all `unchanged`, mints nothing
and writes nothing. ~~[§1.8](#18-tags-merge-and-are-never-adopted).
`SweepRequest` gains the tag store.~~

### ~~P13.7 — The other transports~~ Done

*Done — `2543afe`, 2026-09-29.* The upload doors themselves — a bare database
under any name, and a backup zip — were P13.8's. What was left: the preview
arm, where `/import/file/preview` answers a SQLite file as it answers a zip,
`import.file.importsAsFolder` by its bytes and without opening it, so an older
client or an API caller gets the answer the client now makes locally (it
remains a prediction the column gate can refuse at the word, the trade §1.1
already makes for folders); and the near miss, in `import/near-miss.ts`'s own
table rather than a new module — six fixed places for
`com.karelian.aventura/aventura.db` (the platform config folder itself, and
from a home folder `.config`, `Library/Application Support` and
`AppData/Roaming`, from `~/Library` and from `AppData`), each one question,
verified against the classifier's own mark, never followed out of the picked
folder, and silent for a bundle-id folder with no database. The notes are
`import.root.aventurasBelow` and, beyond the stage, `aventurasAbove` from a
backup's `stories/`, in the family every near miss already shares. **Found by
the end condition:** `/import/file` answered a root as one file — its first
converted row — so a second upload of a backup read as one `recorded` row and
*all unchanged* could not be seen through that door, by a test or by a person.
A root's answer now carries the sweep's whole `report` beside `item` and
`notes`, and the panel renders it. *Ended at:* one fixture database, handed
over as a server-path sweep, a folder upload, a bare SQLite named otherwise and
a backup zip, each into a server of its own, makes the same library — every
object's whole body with ids resolved to their rows, the card's pixels, the tag
registry — and the second import of each is all `unchanged`, no object gaining a
version (`routes/import-aventuras-transports.test.ts`). `pnpm test:gate` and
`test:fixture-pair` pass at this boundary. ~~The bare `.db` upload
(`looksLikeSqlite` beside `looksLikeZip`), the zip upload, the preview arm, and
a near-miss: a sweep pointed at `~/.config`, or at `Application Support`,
suggests `com.karelian.aventura` beneath it (`near-miss.ts`).~~

### ~~P13.8 — Streaming large uploads~~ Done

*Done — `5c6e5e6`, 2026-09-29.* `POST /import/file` sniffs at least sixteen
bytes across chunks and lands a zip or a SQLite database in the import scratch
root as it arrives (`routes/import-upload.ts`, `storage/upload-landing.ts`),
under `limits.maxImportUploadMb` — 1024, `live`, applied; the seven-place edit,
with [21 §4.3](../21-internal-contracts.md)'s live-key count corrected from a
stale figure on the way. In order: the declared length, refused before the
body; `fileSize` on the call and `truncated` after; for a landing declared past
`maxUploadMb` or undeclared, one in flight server-wide (`503`, `retry-after`);
1.1× free space plus the snapshot reserve (`507`); a 60-second idle timeout
(`408`). Every early refusal closes the connection, and scratch and the slot
are released before the reply. **Every archive lands, not only large ones** —
deciding by size would trust `Content-Length` and give a zip two readers, so
one backup would read differently at 60 MB and at 70 MB; size decides only who
takes the slot. `storage/zip-file.ts` reads the archive on disk from the
22 + 65535 + 20 tail window, sharing `zip.ts`'s central-directory parse, with
the limits split — per entry at parse time (4× the import limit), 64 MB per
`read()`, 256 MB of bytes actually inflated into memory; extraction to disk is
bounded by the entry's declared size and a room check instead, since counting
it would refuse exactly the databases this stage is for. The database and its
log are inflated to their own scratch and reach the reader through a new
`FileSource.land`, as the snapshot's `owned` input; a cut-short archive is
`malformed`, not `not-a-zip`. The client sniffs locally and previews an archive
without sending it — [P4's *a look, then a word*](16-p4-implementation.md),
amended there — shows progress, and turns a dropped connection or a proxy's
bare 413 into a sentence; `docs/deploy.md` names the proxy's body limit and read
timeout. *Beyond the stage, from P13.7:* a bare SQLite upload of any name, and
an Aventuras backup zip, import end to end through the landing, including a
database past 64 MB inside a zip.

*As planned:*

~~A multipart part streamed to scratch rather than buffered, and one zip entry
stream-inflated to scratch with its bounds still checked from the central
directory first. Probably a limit key of its own rather than a larger
`maxUploadMb` — which is the five-place config edit, and
`config.test.ts` will say so if one is missed. **Deferrable**; see
[§1.11](#111-size-and-the-one-transport-with-no-ceiling).~~

**In Part 1, after P13.1 and before P13.7**, keeping its number
([§1.11](#111-size-and-the-one-transport-with-no-ceiling)). Nothing in
[P12](29-p12-implementation.md) streams an upload — backup import and restore
take an id, not a file — the zip reader holds the whole archive in memory, and
the multipart buffer peaks near twice the file. Two halves, the second only
because the first cannot carry a zip:

1. **A streamed landing on `/import/file`.** The part is piped into the scratch
   root with `fileSize` passed on every call — the plugin's default is the
   startup `bodyLimit` and does not follow Settings — and `truncated` checked
   after, because busboy's limit does not throw. Free space of at least 1.1×
   the upload, one large upload in flight, an idle timeout, and
   `Connection: close` on an early refusal so the browser sees the refusal
   rather than a reset. The magic is sniffed from at least sixteen accumulated
   bytes (SQLite's header is sixteen; a first chunk can be shorter).
2. **A file-backed zip reader.** The central directory from the file's tail —
   a window of 22 + 65535 + 20 bytes, so a maximum-length comment still leaves
   the zip64 locator in view — with the limits split: a per-entry cap at parse
   time, 64 MB inside an ordinary `read()`, and only extracted bytes counted
   toward the total (old backups also carry `stories/*.avt`). The one
   `aventura.db` entry is inflated to scratch. [01 §2](../01-source-survey.md)'s
   format check permits this: Aventuras writes deflate at level 1 through a
   seekable writer, with no zip64 below 4 GiB.

**A config key of its own**, `limits.maxImportUploadMb`, default 1024, tier
`live` — a separate cap that can be *lowered*, not `max()` against
`maxUploadMb`, which would leave no way to tighten an ungated upload. That is a
seven-place edit: the five [CLAUDE.md] names, the live-key count in
[21 §4](../21-internal-contracts.md), and `routes/live-config.test.ts`, whose
full `limits` literal stops typechecking otherwise. No `SE_*` variable. A line
in `docs/deploy.md` on a reverse proxy's body size and read timeout, which will
refuse the upload before the server sees it.

**The client** sniffs the file and shows *imports as a folder* locally rather
than uploading a large archive for a preview — an amendment to
[P4](16-p4-implementation.md)'s *a look, then a word*, recorded as one — shows
progress, and maps a dropped connection or a proxy's 413 to a sentence.

*Not in it:* streamed folder uploads, zip64, resumable uploads, and uploading a
StoryEngine backup, which has its own 256 MB cap.

### ~~P13.9 — Packs into presets~~ Done, recorded

*Done — `6451804`, 2026-09-29, and closed `recorded`, which the stage allowed.*
The mapping table came first (`import/aventuras/packs.ts`, one comment per
group). Of the pin's eighty-one template rows only the narrator's four have a
counterpart here, and in those four one variable of eighteen translates:
`protagonistName` is `user`. The story's `genre`, `tone`, `themes`,
`settingDescription`, `chapterSummaries`, `tieredContextBlock` and `storyTime`
are bodies that slots supply here; `lengthInstruction`, `styleGuidance` and the
image modes have no equivalent. **The rest are the ones the templates branch
on** — `pov`, `tense` and `narratorReinforcement` have no name in
[P4 §1.6](16-p4-implementation.md)'s namespace — so both `-user` halves would
render nothing, and the system half's voice rules would say *second person,
present* to a story whose own treatment says otherwise: the mangled prompt that
looks fine, made by the importer. Aventuras also renders its context into the
system prompt through those variables, where ours positions it with slots, so a
preset "from" a pack would be ours around a foreign prompt; and `pack_variables`
would carry one for one and stay inert, read as empty. **What was built
instead:** each pack is a `recorded` row, `aventura.db/preset_packs/<id>`,
counting its templates, its custom and tracked variables, and the templates
that differ from the text Aventuras ships — those named at `warn`
(`import.aventuras.packTemplatesDiffer`), because they are what somebody wrote
and what this import leaves in Aventuras. The test for *somebody's* is
[§1.10](#110-packs-are-their-own-stage)'s, as built. *What would reopen this* is
growing the render namespace — `pov` and `tense` from the treatment — which is
a renderer's decision and not an importer's. `pack_runtime_variables` stays
P7's, gated on `pack_id` since migration 32. ~~A table from template id to what
it becomes here, P4 §1.6's namespace table for the Liquid, variables one for
one, and only modified templates. *This stage may close as `recorded`* if the
mapping table shows too little survives to be worth a preset — that is a
finding, not a failure.~~

### Part 2 — the stories, ~~not scheduled~~ scheduled 2026-09-29

~~*Every stage below is a heading so it can be cited and checked, and none of them
is scheduled.*~~ *Scheduled by the person on 2026-09-29
([§0.3](#03-how-this-sits-with-25-e4)); every stage is built in order.* [0.3](#03-how-this-sits-with-25-e4) is the argument;
[18 §2.3.1](../18-session-import.md) is the survey these stages would build on.

### ~~P13.10 — `importSession` for a producer~~ Done

*Done — `6fb33b0`, 2026-09-29.* `importSession` takes `originalFilename` and
stores it as `origin.originalFilename`, keeping a key an export's own `origin`
already carries, as `foreign` is kept — **the format does not change**, since
`origin` was always part of the session document. The key is indexed as
`session.origin_filename` — a column, not `findPriorImport`'s `json_extract`,
because a session row keeps no copy of its file — and a key this account
already holds, archived sessions included, is refused `already-here` naming the
prior session. **The search index rebuilds once, at version 12**, which the
next tag's changelog line owes an existing install. Turns are appended parents
first; a dangling parent, a cycle or a head not in the file is refused
`broken-tree` (422) before anything is written. ~~Parents validated to
precede children~~ — **out-of-order turns are mended, not refused**, because
our own exporter sorts by id, and a child minted on a slower clock sorts before
its parent: refusing would reject our own exports. Cast, lore and treatment
links are checked as `library.read` resolves them — reported in `missing` by
default, since an export loaded on another install almost always names a cast
that lives elsewhere and P11's round trip must survive that, and refused as
`missing-links` under `requireLinks`, which a producer that writes those
objects itself first should pass. `sessions/producer.ts`'s `producedTurnId`
derives a version-8 UUID from the handle, the origin and the source id, the
source's time in its first 48 bits so ids still sort by when they were made;
the handle is in it because turn ids are unique across the install while the
key is per account. *Ended at:* an in-test producer's second import of a
derived-id story is refused without its key, a minted-id one is copied unless
it passes its key, and a second account can import the same story;
`backup/import.ts` is unchanged and its tests pass as they were; `pnpm
test:gate` and `test:fixture-pair` pass at this boundary. ~~What the one reader lacks for a second caller. An optional
`origin.originalFilename`, which becomes the idempotence key
(`aventura.db/stories/<id>`), and a lookup for a prior session carrying it;
~~renditions written, not counted~~ *renditions written — done on main,
2026-09-27*; parents validated to precede children, which the reader's own
comment assumes and nothing checks (*briefly done by `remint` at P13.0, and set
aside with it at the merge*); `cast` and `lore` ids that must exist. **And one
consequence of main's `already-here` for a producer**: an Aventuras story
imported twice is refused the second time only if its turn ids are the same —
so the producer should derive turn ids stably from the Aventuras entry ids,
which makes a re-import of the same story a refusal rather than a copy.~~

### P13.11 — The tree, and the pairing

[18 §2.3.1](../18-session-import.md)'s rebuild — lineage from
`branches.fork_entry_id` and per-branch positions, never from `parent_id`, which
is always null — and its pairing table: an action and its narration are one
`Turn`; an opening narration is a turn with no `input`; an action nobody
answered is `failed`; a second narration in a row is a turn of its own; **a
`system` entry is a turn with no `input`** and its text as output — decided
2026-09-28 ([§4](#4--open-questions)), because a turn that never ran a model is
honest here and dropping the entry is not. A fork
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
differently is recorded. ~~Locations, items and story beats per
[§4](#4--open-questions).~~ **Locations, items and story beats become entries in
that lorebook, tagged by kind** — decided 2026-09-28. For story beats this is an
interim home and recorded as one: they are a feature StoryEngine means to grow
in its own right, and when it does, a beat imported as lore is what that
feature's own import will read from, not something it has to reverse.

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
| 9 | A backup over 64 MB uploaded from a browser — one of them from a phone — imports, shows progress, and a proxy's refusal reads as a sentence | [manual testing](05-manual-testing.md) |

*Row 9 was added 2026-09-28 when P13.8 joined Part 1*, before anything was
walked — extending the remainder, which is what [manual testing §0] allows, and
not editing the critical list.

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

1. ~~**Is [P13.8](#p138--streaming-large-uploads-done) in Part 1?** Without it, a large
   library reaches us only by server path, and a person with no shell on their
   server cannot hand one over.~~ **Yes** — 2026-09-28, on
   [§1.11](#111-size-and-the-one-transport-with-no-ceiling)'s narrower grounds.
2. ~~**Part 2: are `system` entries turns?** They are rare, and a turn with no
   input and system text is honest; so is `recorded`.~~ **Yes**, turns with no
   input — [P13.11](#p1311--the-tree-and-the-pairing).
3. ~~**Part 2: locations, items, story beats** — lore entries tagged by kind now,
   or `recorded` until a channel wants them? The first imports something usable
   and the second imports nothing wrong.~~ **Lore entries, tagged by kind**, story
   beats included and marked as their interim home —
   [P13.12](#p1312--world-state).

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
