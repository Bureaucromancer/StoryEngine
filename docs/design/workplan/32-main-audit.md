# The audit of `main`, 2026-09-25 to 2026-10-01

**Status: landed, 2026-10-01.** A read of the whole of `main` for what ought to
be revised now — bugs, broken behaviour, code quality and the refactors worth
their cost, and small missing features only where they were really fixes — and
the 103 commits that answered it, followed by the second half of the
[2026-09-17 polish review](06-polish.md#the-2026-09-17-review-and-the-pass-that-answered-it)
that the audit had been put in front of.

**Why this document exists.** The audit's plan, its finders' reports and its
verifiers' verdicts were working files outside the repository, and they go
with the session that made them. Every commit says what it did and why, at
length; what no commit can say is what the audit was as a whole — what it
decided, what it left, and what the next release owes its readers. That is
this document, and it is short on purpose: the commits are the detail.

---

## 1. How it ran

**Two facts came before anybody read a line.** `main`'s CI had been red for
seventeen runs: Windows since 2026-09-15 (`system-library.test.ts`, `EBUSY` on
`index.sqlite`), Linux since P10.3's restart work on 2026-09-16 (the runner is a systemd
service, and `supervisionOf(process.env)` inherited its `INVOCATION_ID`). Every
merge since 2026-09-15 had landed on a red gate, and every named gate step after
`pnpm test` read *skipped* the whole time. And the checkout the audit was
planned from was 24 commits behind, so the read was taken from `origin/main`.

**Sixteen scoped finders, read-only**: both CI legs, P12's backups, the turn
pipeline, sessions and state, routes and auth, import and export, the index and
storage, three client areas, the shared schemas with the SDK and the modes,
tooling and CI, and two cross-cutting lenses, security and refactoring. **Then
an adversarial verifier per finding**, told to refute it against the code, the
design notes and the known-issue registers, and a completeness critic last.
**159 confirmed and 1 refuted**, about 140 distinct. So few refutations was
itself a caution, and the reason was visible in the verdicts: the verifiers
mostly *corrected* — severity, usually down, and the fix, several times *wrong
as written* — rather than rejected. Twelve of the headline claims were checked
again by hand against the code; all twelve held.

**A gap round, 2026-09-27**, over what nobody had read in full: the session
routes, the collector and the picture prompt's assembly, the untrusted-file
importers, most of the shared schemas, the three mode presets and a dozen client
library views. Six finders, eighteen verifiers — the SillyTavern and Marinara
claims checked against **those projects' own source at pinned commits**, with
the converters run on real exports. **About 69 confirmed, 2 refuted**; half of
the confirmations changed the fix, and six proposed fixes were wrong as written
(a sort that reversed every first turn's depth order; a regex that sent literal
`{{random::` to the model; a lock the first backup would have dropped; a trial
bind that refused the ordinary loopback-to-LAN edit; a context mapping that
capped NovelAI presets at 150 tokens; a step the Windows leg could not run).

**Every fix landed with a regression test that was falsified** — mutated, seen
red, restored — and the full suite passed before each push, apart from one
known Node-22 lint fixture.

---

## 2. What was decided, and by whom

**Settled by the owner, 2026-09-25:**

| Question | Answer |
| --- | --- |
| Where the commits land | Straight into `main`, one at a time, each pushed only after the checks and the full suite |
| The four fixes that change prompts — system blocks in place, Scene's clock and place, Freeform's premise, the assistant's context | Apply all four, and name them as behaviour changes (§7) |
| A gap round over what the first read did not reach | After tiers 0 to 2 |
| The audit against polish 5–12 | The audit's tiers first |

**Defaults the audit took where a finding left a choice**, each stated in its
commit and each reversible:

- **Summary links are per-stretch** (`e9d1a14`), which re-derives every
  existing chain once.
- **A card's `{{user}}` is kept and flagged at import**, not rewritten
  (`d3acf4a`): [triage §6.1](02-triage.md) leaves it open, and a flag loses
  nothing.
- **Only additions follow the shipped pack** (`7714875`): a session on its
  mode's own pack gains blocks the mode ships later; a change to a block it
  already holds reaches new sessions only.
- **`MediaRole` stays closed** (`df495ae`), and
  [25 B16](../25-open-questions.md) puts the widening question to the owner.
- **Uploads are recorded as uploads** (`56e952d`): `import_job` gains a
  `transport` column defaulting to `path`, true of every existing row, so
  *Update from source* still offers a file picker for an uploaded chat.
- **Scene's time and place stand aside while the world tracker is on**
  (`abb11ee`), whose own block already renders a date, a time and a place.
- **A mode's channel is in play where the playing mode declares it**
  (`12ab446`); a package's, everywhere.
- **Freeform's premise is a slot source**, `{ of: 'setup', field }`
  (`c1274b6`), which widens `storyengine.preset/0`'s closed union as P14's
  `state` arm had; an older build refuses a pack that carries it.
- **A step's undeclared effect is refused, not the step's failure**
  (`263ddcc`).
- **The SDK's step-side cast member is `StepCastMember`** (`09f35b3`), not
  `CastEntry`, which shadowed the treatment's row of that name.
- **A dial's fragments are budgeted at their block's priority** and ranked
  within it by their order (A2.S2). So a fragment its pack ranks at 30 can
  outlive the persona at 70 — though only once the budget has dropped
  everything ranked below the block. `collect.ts` documents it as deliberate,
  and no test showed it biting, so it stands as that decision rather than as
  the lower of the two numbers. [21 §1.1](../21-internal-contracts.md) says so
  beside the record's `difficulty` source.

---

## 3. The commits

In landing order within each group. A tier is a theme, not a phase; the letters
are the plan's.

**Tier 0 — the gate means something again.** `0be9ca1` CI is green on both
legs, and says why it was not; `3d88f5c` a long answer is not interrupted on a
slow runner.

**Tier 1 — restart and restore work where they are shipped.** `f7e158e`
Restart now comes back, and shutdown finishes; `3db0579` restore can run where
it is shipped; `e83ca44` a backup holds whole files; `f10ded9` a whole turn
gets the time the gate gives it; `546386f` importing a backup brings everything
back.

**Tier 2 — data loss outside backups.** `316a7f6` an append after a torn tail is
not swallowed; `62787df` writes that move the head wait for the turn; `6f58fb7`
and `a8eac12` import identity; `d7d37b1` the bytes beside an object outlive a
change of mind; `8669ed3` a finished turn that cannot commit is not one that
never started.

**Tiers 3 to 5 — bounded work, the index, background work, auth and settings.**
`1a3d50b` one file cannot take the server down; `baef897` the index agrees with
the disk; `af8ab18` the importers answer whatever they are handed; `8bc2e7b` a
start that does not rebuild still looks; `a3c6366` background work that
actually runs; `bb215fd` a picture's record always has a job behind it;
`b228199` one server per data directory; `38759b3` backups one at a time, on an
honest clock; `36a23da` sign-in edges that hold; `833ceeb` settings the next
start can use; `96c2127` settings numbers that mean what they say; `8dc8e58` a
provider built from the connection it is used for; `cbc5b7d` goals and packs
checked on the way in; `98724f7` a hook pool one bad hook cannot stop;
`eca751d` session replies that do not carry the spoilers.

**Tier 6 — what reaches the model is what the record says.** `3d57b72` the
prompt in the order the record shows; `d291059` turn counts that count the
story; `60be58a` the record credits the call and the turn that did it;
`80c8c3b` lore counters that count what was read; `33f8ebf` a draft and a
preview assembled the way the turn is; `6b1a3c5` calls that can be answered;
`e8c00b4` one memory book per scope; `75a7ba5` one clock on a provider call;
`8c34a7f` a field assist is a call like every other; `e9d1a14` the summary
chain in stretches; `262b3f5` the memory extractor reads the turns since it
last ran; `7402894` the collector fills and places what the pack asks;
`7714875` a session on its mode's own pack gains what the mode ships later;
`d3acf4a` who is who.

**The importers, as their sources write.** `2cc062f` and `77a189a` SillyTavern
presets in the order and the meaning SillyTavern gives them; `28c0bda` Marinara
as Marinara stores it; `29d2c7c` every converter says which macros it took out;
`cce0419` a scenario is its whole text.

**Tier 7 — the client keeps what was typed.** `c3522f4` editors write to the
form as it is now; `21f7568` an assist belongs to its field; `ff675e0` late
answers elsewhere; `448466c` a signed-in app stays signed in, and only as its
own account; `868384f` reload-and-reapply keeps what each side did; `24f9010`
session settings written once; `ae0bdbc` controls reach the copy on screen.

**Tier 8 — controls that do what they say.** `d669100` refusals are read by
their class, never by their words; `029dbd2` a folder made while the watcher
looks at its parent is watched; `71d7d4e` links that went nowhere; `dec04f3`
fields that take what is typed; `e292b93` editors say what they could not do;
`f9e43ae` a copy brings its pictures; `0c15140` archived sessions come back;
`32204c1` the row pressed, and a goal panel that says what it could not do;
`921de13` a tag rename that asks first; `f0945d4` and `56e952d` an upload's
review says what happened, and is recorded; `2e4b6cb` and `a53d3d1` an actor
downloads as its card, and a download says what it left out; `3f97526` a broken
file is said where it is opened.

**Tier 9 — live state that does not freeze.** `d5ed3d7` a reconnect rebuilds the
live turn; `a593c42` a picture the stream missed is read again; `f93f6b5` a
notification raised while the stream was down still chimes; `988b2aa` restart
and restore read the server's answer; `3f17896` a write refreshes what it
changed; `31cd657` and `e99d895` a change of language, and the account's
formats, reach the page; `3bf4c28` an open dialog keeps focus.

**Tier 10 — the modes do what their designs say.** `1d06126` an empty slot says
its source was empty; `75f88d0` a generated backdrop is drawn, and the one you
walk back to returns; `709a69f` the stager finds the place without faces;
`abb11ee` the narrator is told when and where; `c52f6d4` a backdrop is of the
place this turn reached; `2362524` a picture draws who is in the room and names
nobody; `f701a5b` a picture that is gone is listed as gone; `12ab446` a session
plays one mode; `4aed877` the assistant is told what is open; `c1274b6`
Freeform's premise reaches the narrator; `263ddcc` a step's effects are what it
declared; `ff46539` a word is a word in every script; `0ceb5ff` the assistant's
proposals are real, current and shown; `09f35b3` SDK hygiene.

**Tier 11 — releases and tools that cannot ship broken.** `c79926d` the image
and the tarball build again; `3de3b8e` the tarball carries its links and is
started before it ships; `3ee0f4e` CI's schema check sees a new schema;
`f30a7a6` a release publishes only what passed; `f2e2fb0` `reset-data` removes
a data directory and nothing else; `6009c4a` the e2e server starts on any
platform; `d66ad2b` the journeys pass again; `30d1e96` dead exports; `0e0efd5`
stale paths and the seed; `df495ae` `MediaRole`'s comment; `d7ac703` the lint
rules catch the shapes they claim to.

**After CI came back** (§6). `78c6c8d` two tests compared an 8.3 temp path with
the root the layout had resolved; `49795a9` one move of an account's trash at a
time.

**And the polish pass**, 2026-10-01: `04e45a5`, `8bea85f`, `8a9cd32`, `8ae68e4`,
`2a3b4b2`, `5cd0838`, `73be6b6` and `2ad7ebc` — [polish §17 to §24](06-polish.md#17-the-story-has-a-face-of-its-own) —
with `7508a7d` raising the entry budget for both (§5).

---

## 4. Records the audit corrects

**Three corrections can only be made here**, because what they correct is a
commit message, and a message cannot be struck:

- `62787df`'s says the play panels *"still show their generic failure for a
  `409 busy`"*. HookPanel's and DialPanel's writes, and CastPanel's channel
  writes, showed nothing at all — `32204c1` found it, and polish 9
  (`2a3b4b2`) made every write on the play surface say why it was refused.
- `30d1e96`'s subject says two test-only exports *"become the real path"*. Only
  `isAdopted` did; `resolveWorld` stays a test seam, which its docstring now
  says.
- `78c6c8d`'s says CI's runs *"165 onward"* were its first real ones since K.
  Run 155 was (§6).

**And inside the documents themselves**, each dated where it stands, and no
gate step edited (`2026-10-01`, the commit after the one that wrote this
document):

- [Manual testing](05-manual-testing.md): M6 (the quarantine did not retire
  manual gate §3.5 until `3f97526`), B9 (its third clause was false until
  `868384f`), O3 (no generated backdrop was drawn until `75f88d0`), R3 (the
  assistant's context and proposals, `4aed877` and `0ceb5ff`), S1 to S5
  (restore, refusal and import underneath them, and S2's undo path), and the
  §5 rows for P9's money row and P11's journeys.
- [P7B §3.2](24-p7b-presets-and-prompts.md)'s row 15 and
  [manual gate §3.5](11-p2-manual-gate.md), for the quarantine.
- [P9 §3.2](26-p9-implementation.md)'s row 10: true of the count, not the
  step, until `75f88d0`.
- [P11 §3.2](28-p11-implementation.md)'s rows 4 and 8, and a paragraph the
  docs-lorebook commit had pasted into its record twice.
- [Testing §3.5](03-testing.md)'s *branch is Redo*, since P14's chat.
- [P2A](09-p2a-configuration-surface.md)'s walk of step 15, and
  [P12](29-p12-implementation.md)'s P12.12 *Ends at*, for the undo's path.
- [P13 §0.5](30-p13-aventuras-import.md) and its P13.6 record, for the
  re-minted tag.
- [P7](23-p7-implementation.md) and [19 §10](../19-tech-stack.md), for the
  per-mode deploys that failed every build from P7.0; and [19 §9](../19-tech-stack.md)
  for the `fs` ban's `import()` gap.
- [04 §8.2](../04-schemas.md) and [21 §1.1](../21-internal-contracts.md): the
  slot and block sources written in — `state`, `difficulty`, `directedness` and
  `summary` in the first; `state`, `difficulty`, `summary`, `schema` and
  `continue` in the second; lore's `outlet` and `bookId` and preset's
  `presetId` — and both derivations corrected to the five a slot cannot name,
  as `preset.ts`'s docstring is.
- [10 §11.2](../10-ui-surfaces.md), for the `generated` map's known gap.

---

## 5. What it left, and where

- **The `generated` map keeps paths whose rows are gone** (deferred at
  `c3522f4`; [10 §11.2](../10-ui-surfaces.md) now says so). An actor's `sections.<id>` is `profile.sections` on disk, so
  pruning needs a per-kind map from form paths to object paths. Already true of
  any removal before the audit; a late assist is one more way in.
- **The `import()` half of the `fs` ban** (`d7ac703`). A dynamic import of
  `node:fs` is not caught; catching it needs the fs-aware syntax restated in
  every block of the rule.
- **The closed `MediaRole` union, and the preset union's widenings** — a
  question to the owner at [25 B16](../25-open-questions.md), before the first
  release that exports native objects.
- **A renamed Aventuras tag is minted again by a re-sweep** of the same
  database — P13's, found beside `921de13` and recorded in
  [P13 §0.5](30-p13-aventuras-import.md).
- **`30d1e96`'s subject overstates**: only `isAdopted` became the real path;
  `resolveWorld` stays a test seam, documented as one.
- **The entry budget's remedy** — the first `React.lazy`, or the note sentences
  off the entry with the library surface that reads them — named a fourth time
  at `7508a7d` and still not a polish commit's decision.
- **The polish pass's own leftovers** are
  [polish §24](06-polish.md#24-what-the-pass-found-and-left).

---

## 6. CI across the audit

| Runs | What they were |
| --- | --- |
| to 74 | Red on `main` from 2026-09-15 (Windows) and 2026-09-16 (Linux); green on both legs at runs 73 and 74, after Tier 0 |
| 75 to 154 | **Refused at the account level**, 2026-09-27 to 2026-09-30: every job failed in two to seven seconds, with no steps and no logs. Every commit from K to T-b went in verified locally, on Linux, and nowhere else |
| 155 to 174 | **Back**, from 2026-10-01 00:08 UTC — `78c6c8d`'s message says 165, which is ten runs late. Linux green wherever it was read; the journeys red until 166 (`d66ad2b`), as they had been since P14. Windows found two things Linux could not: an 8.3 short temp path compared with the root the layout resolves (`78c6c8d`), and two restores of one trash item both succeeding, because Windows renames a folder through a handle (`49795a9`) |
| 175, 176 | **Green on all three jobs**, Windows included — the first since run 74 |
| 177 onward | **Refused again**, from 2026-10-01 05:26 UTC, the same way. Polish 10 to 12, the budget raise and this record went in verified locally |

The refusal is the account's — Actions minutes or a spending limit — and
nothing in the repository can lift it. When it lifts, one run on the newest
`main` covers every commit before it, because the tree is cumulative; a red
Windows leg there is work to do at once.

---

## 7. What the next release's changelog entry should say

The changelog is written when a release is cut ([releases §7](04-repo-and-releases.md)),
and an `## Unreleased` section is a decision the changelog's parser asks for
rather than takes, so the entry waits here. Nothing has been tagged since
1.0-alpha 4, and this is what changed for somebody running it.

### Behaviour changes to name

- **Everyone is signed out once after upgrading.** A sign-in is now bound to the
  account it was made for, so a removed account's cookie can no longer sign
  into the next account given the same handle; older cookies are refused.
- **What reaches the model changed, deliberately, in nine places.** System
  blocks a pack places after the history are sent where they sit, as user
  text, rather than hoisted into the opening prompt — guidance, a goal, a
  redo's attempt, depth-placed text, the impersonation instruction — which is
  what the turn record always said was sent. Hooks, memory extraction, delayed
  lore and the history window count turns of the story, not bookkeeping turns.
  Summaries are written per stretch, and every session's summary chain is
  re-derived once. A treatment's framing reaches the prompt; it never did.
  Sessions on their mode's own pack gain the blocks the mode shipped later
  (the summary, the goal, after-character lore, the dials). In new sessions,
  persona and actor blocks say whose they are. Scene's narrator is told the
  story's time and, once there is one, its place. Freeform's premise reaches
  the narrator. The assistant is told what you have open. A drafted move is
  collected as a draft: in new sessions the narrator's brief no longer reaches
  it, and in older ones its own instruction says the brief does not apply.
- **Two arms widen `storyengine.preset/0`.** A pack slot can name a tracker's
  state (`{ of: 'state' }`, P14) or a setup answer (`{ of: 'setup', field }`);
  an older build refuses a pack that carries either.
- **Imports read their sources as those programs do**, so re-importing gives a
  different and better result: SillyTavern presets in the order SillyTavern
  sends them, with its format strings, macros and lengths as it means them;
  Marinara presets, lorebooks and profiles in the shape Marinara stores; a
  card's own name where its prose says `{{char}}`, with `{{user}}` kept and
  flagged; a scenario as its whole text, so two cards whose openings start
  alike are two treatments.
- **Enter makes a new line in the editors' long text fields** instead of saving.
- **A settings save writes only what changed**, and refuses an address, a port
  or a cookie setting the next start could not use.

### Fixed: what you keep

- **Restart now comes back** under the shipped systemd unit and Docker, and
  shutdown finishes with a tab open; it hung, and a requested restart left the
  tarball install stopped.
- **Restore runs where it is shipped** — Docker, unraid and the systemd unit —
  swapping inside the data directory and rolling back a failed swap rather
  than starting an empty install; stored backups survive it.
- **A backup holds whole files**: one taken during play could store truncated
  or padded JSON and report success. Removed accounts' archives, keys
  included, are no longer in a redacted backup.
- **Importing a backup brings everything back**: pictures, folders' assets,
  sessions once (not twice), and tags merged rather than refused.
- **A story survives a full disk**: an append after a torn line was swallowed,
  and the story vanished.
- **A change made while a turn runs waits for it** (`409 busy`): a dial, a
  *Remember this* or a backdrop written mid-turn landed on a line that was
  about to be abandoned, and deleting a session with a turn running could make
  it unrestorable.
- **Each character card is its own**: every CHARX import after the first
  overwrote the one before; a downloaded StoryEngine lorebook re-imported
  through the SillyTavern converter and re-enabled every disabled entry.
- **A picture history still names is kept**, and the sweep never follows a
  link out of the data directory.
- **A finished turn that fails to save is saved again** rather than replaced by
  a stand-in.
- **Editors keep what you type** while an assist, an upload or an entry import
  runs, in all six; an assist belongs to its field and *Undo* returns what was
  there when it landed.
- **A signed-in app stays signed in** through a server restart, and a shared
  browser no longer shows the next person the last one's library.

### Fixed: the server stays up, and agrees with its disk

- **One upload cannot take the server down**: a compressed card, an archive or
  a template that expands without bound is refused.
- **One server per data directory**; a second refuses to start, naming the
  directory.
- **The index agrees with the disk**: a killed first start, an unreadable file,
  a restored session and a hand edit made while the server was down are all
  reconciled; another account's library no longer hides your search results.
- **Background work runs**: the trash is swept on a daily restart, pictures
  interrupted by a restart are marked, and backups run one at a time on an
  honest clock.
- **A provider call has one clock**, `providerTimeoutMs` (0 is off); a hidden
  300-second limit under it is gone.

### Fixed: import and export

- An upload's review is the whole review, says what the size limit left out,
  and is kept under *Earlier imports*.
- *Download this actor* saves its card, pictures and all, and the card comes
  back as itself; a download says what it left out, and a failed one says why.
- A file the index cannot read is said on its own page, and can be deleted.

### Fixed: play

- A reload or a reconnect mid-turn rebuilds the turn; a picture or a
  notification that arrived while the connection was down is shown.
- Scene draws its generated backdrops (they were made and never shown), finds
  its place without needing faces, puts faces on the right people, and draws
  only who is in the room, never by name.
- A Freeform session keeps no clock; a session of a mode this build lacks plays
  and is shown as the default mode.
- Lore keys and names match whole words in every script.
- Every control on the play surface says when a change was not saved, and when
  the reason is a turn still running, says to wait.

### Fixed: library, editors and settings

- Search's library hits open; links, labels and archived sessions reach where
  they say; a tag rename that lore gates on asks first and then does it.
- Hooks, goals and pictures: remove the row pressed, say what failed, bring
  pictures along with a copy.
- Language and formats follow the account on every page, and switch on the page
  you are on; dialogs keep the keyboard.

### Fixed: releases

- The image and the release tarball build, and the tarball starts: the
  per-mode deploys had failed every build since P7.0, and the packer dropped
  every link in `node_modules`. No artifact since alpha 4 met either.
- A release publishes only a commit that passes, with a dated entry here, and
  the image carries its AGPL Source link.

### Changed: the interface

The [polish pass](06-polish.md#the-2026-09-17-review-and-the-pass-that-answered-it):
the story is set in a book face and the interface in the system's; the action
colour is indigo; notifications link to their story and the reading view back
to it; a destructive action asks once, the same way everywhere; the library
and settings say what happened; and a skip link, a radio group's arrows,
announced search results and named buttons for keyboards and screen readers.
