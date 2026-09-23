# 29 — P12 implementation plan

**Status: stages P12.0–P12.13 merged to `main` 2026-09-23, from
`claude/data-backup-system-0sir4i`. ***The exit gate
([§3](#3--the-exit-gate)) has not been walked***, so by
[manual testing §0](05-manual-testing.md) this phase is **not closed** — the
code is on `main` and the critical list is still owed. It is the **seventh** phase to
be merged and left open — P7, P7B, P8, P9, P10 and P11 are the others — which
is what §0 exists to keep visible rather than to excuse.**
One feature and its two halves, which is smaller than a phase usually is and is
filed as one anyway — see [§1.5](#15-a-feature-in-its-own-document-and-a-branch-that-is-not-p12).

**P12 is backups a person can take, list, delete, import and restore, from the
web UI, on a schedule.** [P11.11](28-p11-implementation.md) shipped backup and
restore as *"a script, two commands, and one test"* on 2026-09-17, which is what
[25 E6](../25-open-questions.md) asked for and all it asked for. This phase
reverses that decision deliberately, records why, and repairs two defects in
what shipped.

---

## 0 — Why this phase exists, when E6 said not to build it

[25 E6](../25-open-questions.md) is marked **Opinionated** and its first line is
*"the design already did most of this, so do not build a subsystem."*
[P11.11](28-p11-implementation.md)'s own record says *"this is a script rather
than a route, a server feature or a schedule."* This phase is that subsystem, so
the burden is on this document rather than on the code.

**Four arguments, and none of them is that the feature would be nice.**

### 0.1 E6's caller was an operator at a shell, and most installs have none

E6 reasons throughout about somebody who can run `rsync`, stop a process and
type a command. [docs/deploy.md](../../deploy.md)'s two supported paths are an
unraid template and a compose file, and
[09 §5.1](../09-server-multiuser-deployment.md) designs the install around a
household where *the operator and the user are the same person*. That person has
a browser. **A backup command nobody can reach is not a backup story**, and the
gap did not show at P11.11 because the person who wrote the script had a shell.

### 0.2 The in-process version quiesces what the script provably cannot

This is the argument that actually overturns E6 rather than working around it.
E6's quiesce paragraph reads: *"there is no write-lock to take from outside the
process, and inventing one would be the subsystem E6 forbids."* Every word of
that is about a process on the **outside**.

From the inside, three of the four consistency questions are already answered:

- `state/state.sqlite` is copied with `VACUUM INTO`, which is a
  transactionally consistent snapshot of a database being written to. The script
  cannot do this and says so — it tells an operator to stop the server.
- Library objects, `accounts.json`, `prefs.json`, `tags.json` and the bindings
  are written through `storage/atomic.ts`'s temp-and-rename, so a reader sees
  the old file or the new one and never a torn one.
- Turn segments are append-only, so an archive taken mid-append carries a prefix
  whose last line may be incomplete — and `sessions/segments.ts`'s `parseTurn`
  already returns `null` on a line that does not parse, *"because a segment is
  the one file a crash can leave half-written."* A restored install drops the
  partial turn and keeps the story.

So the in-process backup is **strictly more consistent** than
`pnpm backup create`, not less. E6's sentence was true of the thing E6 was
describing and does not generalise to this.

### 0.3 The per-account half was never E6's subject

E6 is about the install: archive the data directory, restore it, rebuild the
index. *Export my account* is a different feature in a different family —
session export ([25 B12](../25-open-questions.md)), library download
([10 §5.0a](../10-ui-surfaces.md)), `.sepack` — and it is how
[the corpus's fourth commitment](../README.md) (*"drag a folder out of the
storage directory and you have exported it"*) is kept for somebody who cannot
reach the storage directory.

### 0.4 Import is not what E6 declined at all

E6 reasoned about restore. **Import — bringing an archive's content into a
running install — is the import engine with one more source arm.**
[P4 §1.3](16-p4-implementation.md) built `FileSource` and `SourceReader` so that
a new transport costs a class rather than a second engine, and routing a backup
anywhere else would be the duplication that seam exists to prevent.

***E6's best sentence survives intact and is the bar this phase is held to:***
*"An untested restore is not a backup."*

### 0.5 Two defects in what P11.11 shipped — fixed first, at `aaf7345`

Found by reading `layout.ts` beside `backup.mjs`, not by a failure.

- ***The derived index was in every archive the script has ever written.*** The
  exclusion read `if (at === '' && DERIVED.test(entry.name))` — a filename test
  applied only at the data root — and [03 §5.1](../03-data-model.md) puts the
  index at `index/index.sqlite`, one level down. So the clause that
  [25 E6](../25-open-questions.md), [P11.11](28-p11-implementation.md) and
  [docs/deploy.md](../../deploy.md) all exist to describe **never fired once**.
  `restore.test.ts` could not catch it: its fixture wrote `index.sqlite` at the
  source *root*, agreeing with the mistake rather than with the layout. Two
  halves consistent with each other and neither consistent with the tree is the
  shape of defect a suite confirms rather than finds.
- ***`tarHeader` was cutting any member name past a hundred bytes.*** It read
  `name.slice(0, 100)`, which counts characters where the field counts bytes,
  and which produces not a broken archive but a plausible one: a lorebook's
  version payloads all land on the same truncated `…/history/` name and all but
  the last is lost. ustar's `prefix` field has been the answer since 1988.

*And a third, smaller:* [03 §10.2](../03-data-model.md) has said since P4 that
*"trash is excluded from export and from backup by default"* and nothing
enforced it.

---

## 1 — The decisions this phase makes

### 1.1 Two verbs, kept apart by name

|  | **Import** | **Restore** |
|---|---|---|
| Does what | Merges content into what is there | Replaces the data directory |
| Server | Running | Cannot be, in place — it drains and restarts |
| Touches | Library, sessions, tags; connections, prefs and config **only if asked** | Everything in the archive |
| Refuses | Nothing structural — a conflict is a policy | An `account` archive; an unsupervised install |
| Undo | History snapshots each replaced object | The previous directory, moved aside and never deleted |
| Who | Anyone, for their own; an admin, per handle | An admin |

**Conflating them is how somebody clicks *restore* meaning *import* and loses a
week.** The two are separate routes, separate controls, and separate paragraphs
in [docs/deploy.md](../../deploy.md).

### 1.2 tar.gz, and one reader

The format `tools/backup.mjs` already writes and reads, so **an archive the UI
produced restores with the documented command** and there is one tested reader
rather than two. A zip would be double-clickable in a file manager and would
fork the restore story; that trade was made deliberately and the other way.

The server cannot import `tools/tar.mjs` — the image ships `packages/server`
alone — and the script cannot import TypeScript, because it must run with no
build. So there are **two writers, admitted and held by
`tools/tar-seam.test.ts`**, which asserts identical bytes. It found a real
defect on its first run: the script's `headerName` used a `Buffer` method that,
handed a plain `Uint8Array`, returns comma-joined byte values instead of
throwing.

### 1.3 What an archive carries, and the two things it must never carry

Member names are **data-root-relative in both scopes**, so an account archive is
a strict subset of an install one: one reader, one restore path, and a subset
unpacks exactly where it belongs.

Always excluded: **`index/`**, because it is derived and carrying it restores a
stale belief about a newer tree; **`users/<handle>/trash/`**, per
[03 §10.2](../03-data-model.md); and **the backups directories themselves**,
because an archive of the archives makes every generation carry every one
before it.

`contents: 'full' | 'redacted'` decides the credentials — `accounts.json`, the
connections, `state/session.key`. **Both exist because the audiences differ**:
`full` restores to a working install, which is what makes it a backup rather
than a partial copy; `redacted` is the file somebody can put in cloud storage.
A `redacted` archive restores to an install nobody can sign into, so the restore
path refuses one unless told to proceed.

### 1.4 The archives are the schedule's state

There is no *last run* row anywhere. Each pass asks, per scope: *is the newest
archive for this scope older than the frequency?*

***This answers the case that actually matters on a household machine*** — a run
missed because the server was off overnight — with no new persisted state, and
it keeps deleting an archive by hand a non-event, which is the posture
[03 §5.1](../03-data-model.md) takes about the index. It is also why the listing
parses filenames rather than reading a table: **the directory is the record.**

*The schedule is a frequency plus an independent* also on every server start
*switch*, rather than one list containing both, because a machine that is up for
an hour and a machine that is up for a month want different halves and a machine
that is usually up wants both.

### 1.5 A feature in its own document, and a branch that is not `p12`

[P11 §1.1](28-p11-implementation.md)'s rule ejects features from a hardening
phase, so this is not a fourteenth stage appended to that document. It is
small for a phase and is filed as
one because the alternative — a roadmap entry ([24](../24-roadmap.md)) — holds
no release commitment, and this is being built now.

***The branch is `claude/data-backup-system-0sir4i`, not `p12`***, by
instruction rather than by choice. [releases §2](04-repo-and-releases.md) makes
phase branches bare `pN`; this one departs from that, and the departure is
recorded here so a reader is not left hunting for a branch that was never cut.

---

## 2 — Stages

*Depends on:* nothing, for the phase. [P11.11](28-p11-implementation.md) is the
only prior art and it is repaired rather than extended.

### P12.0 — The defects in what P11.11 shipped

[§0.5](#05-two-defects-in-what-p1111-shipped--fixed-first-at-aaf7345), plus the
trash exclusion [03 §10.2](../03-data-model.md) has always specified.
*Ends at:* the index is excluded at the depth it has, a 232-byte member name
survives a round trip, and the fixture no longer agrees with the mistake.
**Done — `aaf7345`.**

### P12.1 — A tar writer the server can reach

`packages/server/src/storage/tar.ts`, and `tools/tar-seam.test.ts` holding the
two copies to identical bytes ([§1.2](#12-targz-and-one-reader)).
*Proof obligation:* the seam test, which found a real defect on its first run.
**Done — `4e549a9`.**

### P12.2 — The manifest, the paths, and the archive

`packages/shared/src/backup.ts`; `Layout.backupsRoot`, `userBackupsRoot` and
`isBackupPath`; the watcher's ignore list, which would otherwise poll a
500 MB archive as it is written; and `backup/archive.ts`.
*Proof obligation:* **the index excluded at `index/index.sqlite`, the trash and
the backups directories excluded, the manifest first, and a session whose newest
segment ends mid-line surviving the round trip.**
*Ends at:* an archive exists on disk with a manifest that says what it is.

### P12.3 — Take, list, download, delete

The four routes, user and admin. The download is the first in this build to
stream a file body rather than send an object.
*Proof obligation:* a backup id from a client never becomes a path component —
the pattern refuses, **and** the handler resolves against the listing.
*Ends at:* a person can take one and get it off the machine.

### P12.4 — The capability, and where a person's schedule lives

`scheduledBackups`, default false — [09 §4.2.1](../09-server-multiuser-deployment.md)'s
*what an account may do*, and the answer to *a misconfigured schedule fills the
data directory*. **Exporting is never gated**; only scheduling is.
`users/<handle>/backup.json` is validated and schema'd, which is `tags.json`'s
side of the line `layout.ts` draws against `prefs.json`.

### P12.5 — Three config keys and the schedule

`backup.frequency`, `backup.onStart`, `backup.contents`, each a six-place edit
including `LIVE_APPLIERS` and both halves of [21 §4](../21-internal-contracts.md).
`startBackupSchedule` on `startTrashSweep`'s shape, wired where
`startUpdateCheck` is and stopped where `trash.stop()` is.
*Proof obligation:* **a run missed while the server was down happens on the next
pass** ([§1.4](#14-the-archives-are-the-schedules-state)), and the capability is
read per pass rather than captured.

### P12.6 — The two panels

`settings/Backups.tsx` after the trash for everyone, `settings/AdminBackups.tsx`
under Administration. The schedule form is **absent** without the capability
rather than disabled, which is the mechanism `SettingsPage.tsx` already uses.

### P12.7 — The corpus

This document, [25 E6](../25-open-questions.md)'s amendment,
[03 §5.1](../03-data-model.md)'s tree, [04](../04-schemas.md)'s manifest,
[21 §4](../21-internal-contracts.md)'s rows, [10](../10-ui-surfaces.md)'s
panels, `docs/api.md`, `docs/deploy.md`, the changelog, and the standing list.
***The point at which the original ask is delivered.***

### P12.8 — A backup as an import source

`BackupFileSource` and the `storyengine-backup` arm, with bounds checked before
anything is inflated and escaping members refused — *an archive is somebody
else's bytes, and the fact that this project writes its own is exactly the
assumption a reader must not make.*
**Native identity is the one new idea**: `identity.ts` keys on
`Provenance.originalFilename` *"because foreign files have no id we could key
on"*, and a backup has one.
*And the default policy is `skip` rather than `sweep`'s `replace`*, because a
backup meeting a live account is the past meeting the present.

### P12.9 — Import routes, and what is optional

Apply then report, through `sweep` and `import/jobs.ts`, so a backup import
lands in the same review surface and the same ledger as every other import.
Work and tags always; **provider connections, preferences and configuration
each a checkbox, each off by default, each reported whether taken or not**. A
configuration import refuses `dataDir` and `server.clientRoot`: both are paths
on another machine.

***This stage was planned as "preview then apply" and shipped as "apply then
report", which is a correction rather than a cut.*** The plan named
`import/preview.ts`, and reading it settled the question the other way:
`previewOne` predicts what **one hand-picked file** would become, reaching the
converters directly so that nothing is written, and
[P4 §1.4](16-p4-implementation.md) is explicit that the bulk case works
differently — *"a sweep still commits first and reports"* — because a staging
area for three hundred objects is a second library, and a scratch copy on the
server is that library. A backup import is a sweep of an entire subtree. Wiring
it to the one-file preview would have meant either a second engine or a
server-side staging copy, which are the two things [P4 §1.3] and §1.4
respectively exist to prevent.

*What a person gets instead is [P12.10]'s manifest read*, which answers the
questions the controls actually turn on. The safety story is the one a sweep
already has and it is written down rather than assumed: `skip` is the default
so nothing here is touched, `replace` writes what was here into the object's
history first, and a session is never replaced at all.

### P12.10 — The import flow

`settings/ImportBackup.tsx`, one component for both halves because the
difference is two fields: the admin says **which account in the archive** and
may tick a fourth box, settings.

***`GET …/backups/:id/manifest` is the stage's real addition***, and it is what
stands in for the preview P12.9 could not have. `backup.json` is the archive's
first member by construction, so reading the first member or nothing answers
*when was this taken, whose accounts are in it, does it carry credentials, what
does it weigh unpacked* for the cost of one gzip block rather than the cost of
an install archive. The handle control offers **the archive's** handles rather
than this install's accounts: an account here that the archive holds nothing for
is not a choice, and a text box would make a typo indistinguishable from an
account that is not in there. [P12.11] reads the same route for its free-disk
and scope preconditions, so it earns its keep twice.

*And `readTarGz` grew a `finally` for it.* A reader that breaks out after the
first member calls `.return()` on the generator, which ran nothing — the
iterator over the gunzip stream is held in a closure rather than by the loop —
so without it every manifest read leaked a file descriptor and an inflate
context. That is the kind of leak that looks like nothing until a schedule has
run for a fortnight.

*Ends at:* the two `POST …/backups/import` rows leave `route-callers.test.ts`'s
`OWED` map, discharged by building the surface rather than by editing the map.

### P12.11 — `POST /api/admin/restore`

**Every precondition checked while the server is still running**, because a
refusal after the process has exited is one nobody can read: supervision, the
archive parsing end to end, install scope, `acceptRedacted`, and free disk
against `unpackedBytes`.

`backup/restore.ts` is the half that runs while the server is up, and it writes
**nothing** until every check has passed — which is the one claim
`restore.test.ts` asserts in every case, refusal and absent marker together. A
marker written beside a refusal is a restore that happens anyway, at a moment
nobody chose, for a reason somebody was told was a refusal.

***Supervision is checked twice and neither check is redundant.*** The route
refuses before the marker is written, because a marker left in a process that
will never come back is a restore that fires whenever somebody next starts the
server by hand — possibly months later, possibly not knowing one was pending.
`beginRestart` checks again, because *a route that trusts its own earlier check
is a route that check has not met*. And when the drain will not start, the
marker is taken back: that is the **only** place one is ever deleted.

***Reading the archive end to end is the expensive check, and it earns its
place.*** A truncated archive is the realistic failure — a copy that ran out of
space, a download that stopped — and it is invisible from the manifest, which is
the first member and therefore the part that always survives. The member count
catches the other shape of the same lie: a valid archive whose manifest
overstates it, which is what a writer interrupted between the manifest and the
members would leave.

*Two things fell out of the work.* `readArchiveManifest` had to become total —
a file that is not a gzip **throws** where a file that is not ours returns, and
every caller's answer is the same sentence. And `state/restore.pending` joins
the always-skipped list: it is the one exclusion that is about the machine
rather than about the data, and it is what lets a successful restore need no
cleanup at all.

*Ends at:* `POST /api/admin/restore` joins `route-callers.test.ts`'s `OWED` map,
owed to [P12.13] — the control is a stage later because it is **absent** rather
than disabled where nothing would restart the process, and a control whose
existence is a condition is worth building against a route that already refuses.

### P12.12 — The swap, on the next boot

Before `buildServices`, which opens handles and stamps the directory. Unpack to
a sibling, rename the live directory aside, rename the new one in.
***The marker needs no deletion***, and that is the property worth having: it
lives in the directory that just moved aside, so a successful restore cannot
leave one behind and an unsuccessful one keeps exactly the state that describes
itself. A second attempt refuses rather than looping.

***It returns rather than logs, and that is not a small point.*** The swap runs
before `buildServices`, which is before `buildApp`, which is where the logger
comes from — and `main.ts`'s own rule is that everything this process reports
goes through one mechanism. So `performPendingRestore` answers with an outcome
and `main.ts` says it a few lines later, at `warn` for a **success** as much as
for a failure: a restore is never routine, and the sentence somebody will go
looking for months later — *where did my old data go* — is in it.

***`DELETE /api/admin/restore` was not in the plan and the work asked for
it.*** A failed restore keeps its marker on purpose, so that the next boot can
refuse it rather than loop; but a marker nothing will act on and nobody can
remove is a trap on exactly the install this feature was built for. [25 E6]'s
operator has a shell. `docs/deploy.md`'s household one has a web page and
nothing else, which is the first of the four arguments in §0 arriving from a
different direction.

*And the notice names a filesystem path*, which [21 §4.1] otherwise forbids in
what a person reads. The exception is argued rather than taken: the directory
that moved aside **is** the undo, and *your previous data is safe* without
saying where would be worse than saying nothing.

*Ends at:* a restored install serves the sessions the archive was taken from,
with the index rebuilt rather than carried — and `data.replaced-<uuid>` sitting
beside it, which is the undo.

### P12.13 — The restore control, and Part 2's corpus

Visually apart from the list, with a type-the-words confirmation; **absent**
when nothing will restart the process, with a sentence giving the command.

***The `acceptRedacted` flag is derived from the archive rather than asked for
in a second box.*** The panel already says, in the sentence beside the
selection, what a redacted archive leaves — an install nobody can sign into,
set up again from scratch — and the person has already typed the word. A
checkbox repeating it would be a confirmation of a confirmation, which is the
shape that trains people to click past both.

***`restorePending` joins `GET /api/admin/notices` rather than getting a route
of its own.*** It is one `stat`, on the one endpoint the shell already polls,
and the state it reports is state a **boot** wrote — so a client cannot know
whether a marker is there without asking, and the two moments one appears are
the two moments nobody is looking.

*Ends at:* `POST /api/admin/restore` and `DELETE /api/admin/restore` leave
`route-callers.test.ts`'s `OWED` map, and `docs/deploy.md` carries the
import-versus-restore table — the document the household operator actually
reads, which is §0's first argument arriving at its destination.

---

***P12.7 is a real stopping point rather than a formality.*** Everything through
it is *take, list, download, delete, schedule*, which is the whole of what was
asked for before the two verbs were separated. P12.8 onward is a second feature
wearing the same name.

### What is deliberately not in this phase

- **A retention policy.** Deferred explicitly. The two guards that are *not* a
  policy are here: a failed archive is unlinked in a `finally`, so it costs no
  space; and an *on start* backup is skipped when the newest for that scope is
  under an hour old, because **a restart is not a reason to take a second copy
  of a directory nothing has written to**. Both panels show the bytes the stored
  backups occupy, which is an action ([10 §15.4](../10-ui-surfaces.md) wants an
  action rather than a statistic) and not a dashboard.
- **Creating accounts from an archive.** An install import plans per handle, and
  a handle with no matching account is reported and skipped. An account created
  from an archive would have no password, and **who may sign in is not a thing
  an archive gets to decide**.
- **Importing `accounts.json`, `state/` or `system/library/`.** Install
  authority, and a restore's business. That line is what keeps the two verbs
  distinct rather than a slider.

---

## 2.1 — What the changelog will say

***Written here rather than in `CHANGELOG.md`, and the reason is a test.***
`packages/shared/src/changelog.test.ts` asserts that **every `##` heading in
that file is one the About surface can parse** — *"so there is nothing to decide
yet"* — and an `## Unreleased` heading is not. Deciding how an unreleased
section renders, or cutting `1.0.0-alpha.5` to have a heading to write under, is
a release decision and [releases §7](04-repo-and-releases.md) owns it. So the
prose is parked where the person cutting the release will find it.

**Added**

- **Backups you can take from the browser** — [25 E6](../25-open-questions.md),
  [P12](29-p12-implementation.md). Settings → Backups takes
  one, lists what is stored, hands it over as a download and deletes one. Same
  again for the whole install, under Administration. Three `backup.*` settings
  make it a schedule: a frequency, and an independent *also on every server
  start* for a machine that is not on all the time — because a fixed frequency
  may never come round on one that is off overnight.
- **A backup taken from inside the server is more consistent than one taken from
  outside it.** The operational store is snapshotted with `VACUUM INTO` while it
  is being written to; everything else was already atomic. This is why
  [25 E6](../25-open-questions.md) — *do not build a subsystem* — is
  amended rather than ignored: it reasoned about a process on the **outside**.
- **`scheduledBackups`, a fourth capability, default off.** Anyone may take a
  backup of their own work; what an administrator grants is the *server* writing
  them on a timer, which is the one way a setting somebody made once fills a
  disk.
- **`full` or `redacted`**, chosen per backup. A full archive restores to a
  working install and therefore carries credentials; a redacted one is the file
  you can keep somewhere else.

**Fixed**

- ***The derived index was in every archive `pnpm backup` had ever written.***
  The exclusion was a filename test applied at the data root and
  [03 §5.1](../03-data-model.md) puts the index one directory down, so
  it never once fired — the exact failure that command exists to prevent, and
  the restore test could not catch it because its fixture agreed with the
  mistake. **If you hold an archive taken before this, delete `index/` from the
  restored directory before starting the server.**
- ***Long paths were being silently truncated out of archives.*** `tarHeader`
  cut any member name past a hundred bytes rather than using ustar's `prefix`
  field, which collapsed a lorebook's version payloads onto one name and lost
  all but the last. Reachable in ordinary use: a version payload under a long
  slug is about 232 bytes.
- **The trash is excluded from backups**, which
  [03 §10.2](../03-data-model.md) has specified since P4 and nothing
  enforced.

---

## 3 — The exit gate

Two tiers, per [manual testing §0](05-manual-testing.md): a critical list a
person walks before the phase closes, and a remainder that extends the standing
list and drains continuously. **The rows below are not edited to match what was
walked** — a second table records what was answered.

### 3.1 The critical list

| # | What | Why it is critical | Check |
|---|---|---|---|
| 1 | An archive taken from the UI restores with `pnpm backup restore`, and a search answers afterwards | The whole claim, and a search answering is the only observable proof the index was **rebuilt rather than carried** | By hand, once, on a real data directory |
| 2 | A `full` install archive round-trips through the self-restore, and `data.replaced-<uuid>` is intact beside it | The undo is the single most important safety property here, and no test can witness a supervisor restarting a process | By hand, with `SE_SUPERVISED` set |
| 3 | An account archive is refused by `restore` and unpacks correctly with `tar -xzf` | The one sharp edge of data-root-relative names, and the one that erases other people's data if it is wrong | By hand |
| 4 | Importing a backup into a live account with `skip` returns what was deleted and keeps what was edited | The distinction the whole second half exists to make | By hand |
| 5 | A `redacted` archive is refused for restore unless confirmed, and says why | A restore that silently produces an install nobody can sign into | By hand |

### 3.2 The remainder — extends the standing list

| # | What | Where |
|---|---|---|
| 6 | An archive over a gigabyte: memory stays flat while it is written and downloaded | [manual testing](05-manual-testing.md) |
| 7 | A scheduled backup fires after a day the machine was off | [manual testing](05-manual-testing.md) |
| 8 | The disk filling during a backup leaves no `.part` and says so | [manual testing](05-manual-testing.md) |
| 9 | An install import across handles, one of which does not exist here | [manual testing](05-manual-testing.md) |
| 10 | A configuration import refuses `dataDir` and names it | [manual testing](05-manual-testing.md) |
| 11 | A restore whose archive breaks between the request and the boot: the install is untouched, the notice says so, the second start refuses rather than retrying, and **Call it off** clears it | [manual testing](05-manual-testing.md) |
| 12 | The import picker's manifest read is quick on an install archive of a real size — it is one gzip block, and this is the claim that would rot into *inflate the whole thing* without anybody noticing | [manual testing](05-manual-testing.md) |

***Rows 11 and 12 were added as the work grew rather than to match what was
walked***, which is the distinction [§0](05-manual-testing.md) draws: the
critical list above is untouched, and these extend the remainder because
[P12.12] and [P12.13] built two surfaces the plan did not name —
`DELETE /api/admin/restore` and the manifest read that stands in for a preview.

*Proof obligations that belong to a test rather than a person are in the stage
commits and are named there.* The one this phase inherits is
[P11.11](28-p11-implementation.md)'s, and it is now asserted at the depth the
index actually has.
