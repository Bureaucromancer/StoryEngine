# Changelog

Every release tag has an entry here — [releases §7](docs/design/workplan/04-repo-and-releases.md).
The reason is not bookkeeping: [09 §7](docs/design/09-server-multiuser-deployment.md)
makes _what am I running_ a user-facing question rather than a maintainer's one,
and the About surface planned at [P11.6](docs/design/workplan/28-p11-implementation.md)
links here to answer it.

Versions are [semantic](https://semver.org), with the caveat
[releases §7](docs/design/workplan/04-repo-and-releases.md) states plainly: before
1.0 they mean little, and **the data formats carry the real compatibility
story**. Package and card schema versions are independent of the application's
([03 §7](docs/design/03-data-model.md)).

Each build also has a name — _1.0-alpha 1_, _1.0-beta 1_, _1.0_ — derived from
the string by the rule in [releases §7.1](docs/design/workplan/04-repo-and-releases.md)
and never written without it. A heading here opens with the string, because the
release workflow reads it there, and carries the name and the date after it.

## 1.0.0-alpha.6 — 1.0-alpha 6 — 2026-10-08

A day after alpha 5, for one thing asked of it: the settings page had become a
long scroll, and now it has contents. **Upgrading from alpha 5 needs nothing.**
From an earlier alpha, alpha 5's *Before you upgrade* still applies — above
all the one-line `accounts.json` edit, without which the server will not start.

### Added

- **Settings has contents, in the workbench.** Open the dock over Settings —
  *Contents…* beside the title does it — and it lists every section the page
  shows you; choosing one takes the page there. The administration half is
  listed only for an administrator, and *Your connections* only where you may
  have them. On a phone, where the open dock covers the page, choosing a
  section closes it.
- **Every section of Settings has an address** — `/settings#trash-section` and
  the like — so a link to one can be shared, bookmarked or reloaded and lands
  in the same place, with the keyboard's focus on that section.

### Changed

- **The first load is about 40 kB smaller, compressed.** The changelog and the
  renderer that draws it now load with the home page rather than with every
  page, so the sign-in screen, the library and Settings no longer fetch a
  document they do not show. Home says so in a line while its release loads.

### Fixed

- **A long page could scroll the whole window and take the header with it.**
  Labels meant only for screen readers, deep in a long page, were positioned
  against the document instead of the page's own scrolling area, so the
  document grew to the page's full length. Anything that scrolled the window —
  find-in-page, or a jump to a section — moved the header off the screen. The
  page's area contains them now, and the window does not scroll.

### Known

- **Alpha 5's Known section stands**: no compatibility promise between alpha
  builds; the image is private and each tag's tarball a public download for
  ninety days; and most of what alpha 5 added has not been walked by a person.

## 1.0.0-alpha.5 — 1.0-alpha 5 — 2026-10-07

Four weeks after alpha 4, and the first tag since the repository went public.
Most of what the work plan calls P7 to P15 is in it — modes as packages, a
prompt pack you can open, memory, pictures, notifications, backups, three
importers and a Setup made from any turn — and so is the audit of `main` that
followed them. **Read the first section before upgrading**: an install from an
earlier alpha will not start until one file is edited, and its trash starts
being emptied.

### Before you upgrade

- **Add `"scheduledBackups": false` to every account's `capabilities` in
  `accounts.json`**, at the root of the data directory, before starting this
  build. Every alpha so far wrote that file without it, this build requires it,
  and the server refuses to start rather than guess (*"is not a valid accounts
  file"*). There is no migration, by decision: too few installs to carry one.
- **The trash is emptied for the first time.** `trash.retentionDays` (30) was
  never read before. A sweep now runs at every start and daily, so anything
  deleted more than thirty days ago goes on the first start. Set it to `0`
  first to keep everything.
- **Everyone is signed out once.** A sign-in is now bound to the account it was
  made for, and older cookies are refused.
- **More model calls, by default.** Past twenty turns a session summarises
  what leaves its window — one call per turn, before the reply — and memory
  extraction runs every eighth turn. Both are on for existing sessions.
- **What reaches the model changed, deliberately**, in ways
  [the audit](docs/design/workplan/32-main-audit.md) §7 lists: blocks placed
  after the history are sent where they sit rather than hoisted into the opening
  prompt, and a treatment's framing reaches the prompt at last. A Scene session
  from an earlier build goes on playing the way it was first played.
- **The server talks to the network on its own now**: a daily update check
  against GitHub's releases (`updates.checkEnabled: false` stops it), and,
  bound beyond loopback, `storyengine.local` over mDNS on UDP 5353
  (`server.mdnsName: ""` turns it off).
- **A container made from the old unraid template lacks `SE_SUPERVISED=1`**,
  so it offers neither *Restart now* nor a restore. Add the variable, or take
  the new template.
- The search index rebuilds once (version 12) and the state store migrates, on
  the first start. The HTTP API is stricter in places — an unknown field in a
  turn's `input` is a `400` — and [the API reference](docs/api.md) has the
  routes.

### Added

- **The prompt pack is something you can open.** Each mode's pack is a library
  object with an editor — blocks in order, slots, budgets, difficulty — and a
  running session has a settings panel to switch its pack, set reply length
  and temperature, or edit its own copy. Turns already taken keep the blocks
  they were built from. Treatments, setups and packages have editors too, so
  all six kinds do.
- **Modes are packages, and there are three**: Scene; Freeform — a premise, a
  difficulty and how far the narrator steers, with `do`, `say`, `think` and
  `story` moves; and an assistant that proposes edits you apply. **Scene is a
  chat now**: one character or a group, each answering in its own message,
  with SillyTavern's reply strategies and a *Smart* one, swipes, continue, edit
  and hide. Its trackers, secret plot and editors are agents, all off until
  you switch them on.
- **Hooks, goals and the cast each have a panel.** A hook can be paced, forced,
  written mid-session, or saved out to a treatment, setup or lorebook. A goal
  the model thinks is met, and a death it proposes, both wait for you.
- **A long session keeps its past as a chain of summaries**, and **a character
  remembers across sessions**: *Remember this* on any turn writes to that
  character's memory book, and an extractor proposes more. It only ever adds,
  so nothing you wrote is rewritten.
- **Pictures.** *Illustrate* any turn, or every turn, and Scene can draw its
  backdrop, from a connection marked *Makes pictures*. A turn never waits for
  its picture, and the recipe outlives the pixels. **A move can carry
  pictures** — up to four, captioned. A model that sees pictures gets them and
  any other gets the caption, so a picture never ties a session to one model.
- **Backups from the browser**, your own or the whole install's, `full` or
  `redacted`, and on a schedule where an administrator allows it. Two ways
  back, kept apart by name: *Import* merges into the running server, and
  *Restore* replaces the install across a restart and keeps what it replaced.
- **Imports, and a way out.** A whole Aventuras install at once — its library
  and, if you tick *stories*, its stories as sessions. SillyTavern and Marinara
  roleplay chats, single or group, as Scene sessions you can update from the
  source. A session exports as one file and comes back with its branches.
  Every object can be downloaded, or exported as a SillyTavern card or an
  Aventuras file, and the export says what it lost.
- **Make a setup from here.** Any turn offers it beside *Continue from here*: a
  dialog drafts the story so far, an opening and the facts established, you
  choose what carries, and new sessions start from it. Nothing it would spoil
  is shown. *The party* is who travels — a chat character who never joined it
  does not.
- **Around the story**: a reading view that prints and copies; search with
  snippets; *Assist* on every editor field; *Impersonate*; notifications, with
  sound; connections of your own, and *Test* on any connection, which says
  which field to fix; *Restart now* where something will restart the server; a
  sign-in gallery, off by default; a trash, *Used by*, and *Delete* on every
  row of the library; French, machine-translated and unreviewed; and `/`,
  which shows this changelog.
- **A Linux tarball** beside the image, with a systemd unit and an install
  script.

### Changed

- **The look.** The story is set in a book face and the interface in the
  system's, the action colour is indigo, the header folds on a phone, the
  per-turn controls exist on a touch screen, the story prints, and a
  destructive action asks once, the same way everywhere. The composer grows as
  you type: Enter sends, Shift+Enter is a new line.
- **Imports read their sources the way those programs do**, so importing again
  gives a different and better result — SillyTavern presets in the order it
  sends them, and a card's own name where its prose says `{{char}}`.
- **Enter makes a new line in the editors' long fields** instead of saving, and
  a failure says what to do rather than naming a category.

### Fixed

Against alpha 4 — fixes to what is new since are part of it above, and
[the audit](docs/design/workplan/32-main-audit.md) §7 has the long list.

- **Delete, restore from the trash and removing an account work on Windows.**
  Anything ever saved — an object with history, a session with turns — failed
  with a bare 500, because the file watcher held every folder under the data
  root open. Linux, Docker and unraid never saw it.
- **A story survives a full disk.** An append after a torn line was swallowed,
  and the story with it.
- **One upload cannot take the server down**, and **one data directory has one
  server**: a second refuses to start, naming it.
- **The index agrees with the disk** after a killed first start, an unreadable
  file, or a hand edit made while the server was down.
- **A finished turn that fails to save is saved again**, and a reload or a
  reconnect mid-turn rebuilds it.
- **A session started in the browser has a persona**, so the narrator stops
  addressing *the player*.
- **Lore keys and names match whole words**, in every script.
- **Marinara 2.4 imports**, where it was refused as newer than this build.

### Known

- **No compatibility promise between alpha builds**, and this is the first that
  exports native objects. An older build refuses, whole, a file that uses what
  this one added inside a portable schema — the `background` picture role, or a
  pack slot that reads a tracker or a setup answer. That is accepted for the
  alphas ([26 B16](docs/design/26-open-questions.md)). Packages still export as
  `storyengine.package/1`; World will rename them and go on reading the old
  name.
- **The image is still private, and the tarball is not.** Each tag's tarball is
  a workflow artifact on a public repository — a download for anyone signed in
  to GitHub, for ninety days
  ([releases §0.1a](docs/design/workplan/04-repo-and-releases.md)). There is no
  GitHub Release and no `latest`.
- **Most of this has not been walked by a person.** Eleven phases, P6B to P15,
  are merged and held open on sittings nobody has sat
  ([manual testing](docs/design/workplan/05-manual-testing.md), L to Z), and
  several want hardware or an endpoint this project has not had: nobody has
  watched a generated picture arrive. PLAYABLE has still not run.

## 1.0.0-alpha.4 — 1.0-alpha 4 — 2026-09-09

The build the walk gets walked against. Alpha 3 made the retrieval half
reachable; this one is what a person needs in front of them before
[sitting K](docs/design/workplan/05-manual-testing.md) can produce a finding
that is worth anything — including the fix for a control that has never worked
with a pointer.

### Added

- **Tags, and a registry behind them.** A tag has a home on disk, an API over
  it, a manager, and eight colours proven legible rather than chosen. Objects
  reference a tag **by id** and names resolve through the registry, so renaming
  a tag renames it everywhere instead of orphaning what carried the old name —
  and a rename is only offered once the library has been linked to the
  registry, because a half-linked library is where a rename loses things. Tags
  are typed into a combobox rather than a textarea of one per line.
- **A tag can be a folder.** Entering one is applying its filter, and the
  filter is three-state: **hidden means only what it says**, which is the
  distinction a two-state filter cannot make.
- **Every shelf can be searched and sorted**, not just Lorebooks.
- **A session need not be named**, and can be renamed whenever you know what it
  is. *Start* just starts. Unnamed is a state a session may stay in rather than
  a gap to be filled with a placeholder.
- **A field says it is required**, and a save that cannot proceed says why
  rather than leaving a control disabled with nothing beside it. **New actor is
  a button** now: the editor opens on an unsaved draft, and nothing is written
  to disk until the name exists — so an abandoned attempt leaves no `untitled`
  folder in the one part of this design meant to be legible in a file browser.

### Fixed

- **The workbench resize handle had no height, and nothing could have said so.**
  It carried `inset-block-0`, which is not a Tailwind utility, so no rule was
  emitted and an absolutely-positioned element with no block inset is zero
  pixels tall. **The panel has been resizable since P3 and grabbable by pointer
  never** — only the keyboard half ever worked. The fix ships with a test that
  reads the *built stylesheet* and fails on a class that emits no rule, which is
  the gate this class of bug has never had.

### Changed

- **Nothing user-facing**, but the corpus this project is steered by was
  renumbered into reading order and every citation in it repointed — 4,573
  links across 330 files. Work-plan documents are now cited **by name**, so
  their numbers are pure filing order. A test (`tools/doc-links.test.ts`) holds
  it: links resolve, fragments name real headings, and the one citation shape
  nothing can verify is forbidden rather than tolerated.

### Known

- **The manual test list is a standing project now, not a phase gate.** A phase
  closes on a small **critical list** walked before the close; the remainder
  extends [the standing list](docs/design/workplan/05-manual-testing.md) and
  drains continuously. The reason is in that file: **five phase gates
  accumulated unwalked, and no gate in this project has ever been closed by a
  person.** P5, P6 and P6A closed on 2026-09-09 under that rule, with their
  gates standing as sittings F, J and I.
- **This image is what sitting K wants.** 110 items are on the standing list;
  49 have a result. K is ten of them and it is what closes P6B.
- **PLAYABLE has still not run.** The instrument is repaired and the checkpoint
  has begun. Four hypotheses are open, and the fourth has never been in contact
  with anything — an earlier record claiming otherwise is corrected in that
  file.
- **No compatibility promise between alpha builds**, unchanged from Alpha 2.
## 1.0.0-alpha.3 — 1.0-alpha 3 — 2026-09-08

The build that makes the retrieval half reachable. Alpha 1 and 2 shipped a
lorebook system nothing could switch on: a session accepted `treatment` and
`lore` over the API and no surface ever sent them, so every session resolved
**zero books** and the whole of P5 was unreachable from the product. That is
what this release is for.

### Added

- **A session can be told what to read.** The create form carries a treatment,
  a lorebook multi-select and a preset — the preset there specifically, because
  it is the one field with no second chance: a session copies it at creation and
  no route changes it after. A **mid-session lore panel** changes the selection
  through `PUT /api/sessions/:id/lore`, so a book you realise you need forty
  turns in does not cost the session.
- **Lore has two placement phases.** SillyTavern positions 1, 2, 3, 5 and 6 all
  import as `after_char`, and the shipped preset had one slot, at
  `before`. Such an entry activated, spent the book's token and entry budget,
  matched no slot and **vanished unreported** while the lore report still counted
  it kept. The first imported ST book silently lost most of its entries. There is
  a second slot now, and an entry whose phase has no slot is **reported** rather
  than dropped in silence.
- **A sticky entry says how much longer it stays** — *"still active from an
  earlier turn, 2 messages remaining"*, and *"and this is its last"* when the
  window closes, which is the one state a count alone cannot express. The effects
  list prints the scope key beside the channel id, so four entries writing
  `se.lore.timing` in one turn are four rows you can tell apart rather than the
  same name four times.
- **A failed turn submission says so.** Every mutation on the play page could
  fail and none rendered anything: a busy session, a stale head, an unbound role
  were all silent. The most recent failure is shown, by when it was submitted, so
  a stale one cannot outrank a fresh one.

### Fixed

- **A per-book `tokenBudget` of `0` means unlimited**, which is what the
  schema and the format's own convention always said. It was a plain ceiling, so
  such a book refused every entry with *"over the book's token budget of 0"*.
- **Recursion scans every entry that fired, not the first two.** The recursive
  pass was being truncated by `scanDepth` — a setting that counts *messages* —
  so on a default book only two activated entries' text was ever re-scanned, and
  raising an entry's `order`, which is a placement setting, silently removed its
  text from the scan. The entry that then failed to fire was told *no match*,
  which was not true.
- **A library folder this build cannot open is recorded rather than half-indexed.**
  A hand-made folder with a name that is unopenable on Windows — `con`, or a
  trailing space — was skipped in silence by a rebuild and *indexed* by the live
  watcher, which wrote a row pointing at a file nothing in the build can read.
  Both now agree, and the folder appears as a named file error instead of
  disappearing.

### Known

- **The pre-P6 walk is in progress, not finished.** Sitting A — a fresh install
  through to a streamed turn and its record — is walked and passed; B through H
  are outstanding
  ([manual testing](docs/design/workplan/05-manual-testing.md), which that sheet
  was merged into on 2026-09-08). This image exists so the rest
  of that walk happens against a container rather than a dev server.
- **No compatibility promise between alpha builds**, unchanged from Alpha 2.

## 1.0.0-alpha.2 — 1.0-alpha 2 — 2026-09-07

What the first install of Alpha 1 found, on unraid, and what it asked for.

### Added

- **The version, visibly.** Every page ends with the build's name —
  _1.0-alpha 2_ — login and setup included, and Settings opens with an About
  block: the name, the version string and the commit, for every account. A
  development run says so instead of inventing a version. The name is derived
  from the string by [releases §7.1](docs/design/workplan/04-repo-and-releases.md)'s
  rule, which is code now, in `@storyengine/shared`, and the headings in this
  file are held to it.
- **`GET /api/auth/state` carries `build`**, so the pages before sign-in can
  say what they are; the admin notices route keeps its copy.
- **A `testing` channel.** Every tagged build is also pushed as
  `storyengine:testing`, and the unraid template follows it, so unraid's update
  check offers each alpha; `compose.yaml` stays pinned to the version. `latest`
  still names nothing
  ([releases §4](docs/design/workplan/04-repo-and-releases.md)).

### Fixed

- **A data directory the process cannot write is refused in one line**, naming
  the directory, the user the process runs as and the fix, instead of an
  `EACCES` stack trace out of `mkdir /data/state`. Docker creates a missing
  bind-mount source as root and the container runs as uid 1000; the unraid
  template's Data field and [docs/deploy.md](docs/deploy.md) say so now and
  give the one-time `chown`.
- **The setup token is easier to find.** The log line that carries it is
  written on every start until the first admin exists — it always was, though
  the template and the deploy page said _once_ — and it now ends with the token
  itself rather than carrying it only as a field, and names the file it is kept
  in: `state/setup.token` in the data directory, which host access can read
  when the log is gone. The setup form says so too, under the token field.

## 1.0.0-alpha.1 — 1.0-alpha 1 — 2026-09-06

**The first build you can go back to.** Until now the only record of a working
state was the commit graph, which makes _the version where lorebooks worked
before I touched the budgeter_ an act of archaeology rather than something you
can run. This is that state, frozen and named.

**It is an artifact, not a distribution.** The repository is private, the
registry package is private, and the unraid template is committed rather than
submitted — so [releases §0](docs/design/workplan/04-repo-and-releases.md)'s
deferral of release engineering to beta stands untouched, and AGPL §13 does not
attach ([P6A §0.1](docs/design/workplan/19-p6a-alpha-1.md)). Nobody else is
running it, which is the property that carries every obligation.

**No compatibility promise between alpha builds.**
[22](docs/design/22-internal-contracts.md) licenses the storage tier to change
without migration for exactly as long as nothing leaves the install. What this
build ships instead of migration machinery is a refusal: a data directory
carries the build that wrote it, and an older build will not open a directory a
newer one has touched
([P6A §1.7](docs/design/workplan/19-p6a-alpha-1.md)).

### Added

- **The server can be told where to bind.** `SE_HOST`, `SE_PORT`, `SE_DATA_DIR`
  and `SE_CLIENT_ROOT` override the config file's defaults, resolved between the
  defaults and the file so a value written in the file still wins. Before this
  the server read one environment variable in the whole codebase and it was
  dev-only, so a container bound its own loopback and was unreachable however
  its port was mapped.
- **The server serves the web client.** `server.clientRoot` points at a built
  client and one process on one port serves both halves. Unset by default:
  development stays two processes with Vite proxying `/api`.
- **A setup token that something checks.** On an install bound beyond loopback
  with no account yet, creating the first administrator requires a token printed
  to the server's console — `docker logs`, for a container. Stored, so a restart
  does not invalidate one you have already copied out.
- **`server.cookieSecure`**, for an install with TLS in front of it. Off by
  default, because plain HTTP on a LAN you trust is supported and a `Secure`
  cookie is not sent back over it.
- **A version and a commit the running server reports**, on
  `GET /api/admin/notices` and on the startup line.
- **A container image, a compose file and an unraid template**, with an on-tag
  workflow that publishes to a private registry. See
  [docs/deploy.md](docs/deploy.md) — starting with the fact that the package is
  private, so nothing pulls until you have logged in.
- **A favicon** — the wordmark's initial on a typewriter key.
- **Redo with guidance.** A turn's Redo and Reroll can carry an instruction
  saying what to change, typed into a field the turn reveals, and the model is
  then shown the attempt it is redoing beside it — so "make it rain harder"
  has an *it*. On the wire the submission names the attempt (`redoOf`) the way
  a rewrite names its tape; the record carries the attempt as its own advisory
  block, naming the turn, and it never enters history. With the field empty,
  both buttons do exactly what they did.
- **Every critical control stays in reach.** The editors' held Save row is now
  a strip every surface keeps its critical controls in, held against the
  bottom of the scrollport: the way back, Save or Edit, History and Delete on
  the editors and the read page, and the action row of every form on the
  settings page — so no control is reachable only by scrolling past everything
  it is about. Delete is reachable from the editors for the first time, and
  moves the file as saved. On the settings page a form the server refuses as
  stale is answered inside the strip rather than below the fold it covers.
- **What a save says is said where Save is.** _Saved._, a restored version, a
  reapplied draft and any write the server refused short of a conflict render
  in the strip beside Save, rather than at the top of a page the strip has
  scrolled out of sight.
- **A dragged entry says where it will land.** In the lorebook editor a row
  shows a line along the edge the dragged entry will go in front of or behind,
  by the same computation the drop uses, and the list scrolls itself while the
  drag leans on its top or bottom edge — which the browser's own drag would not
  do for a list inside a page.

### Fixed

- Comments in `config.example.json`, `config.ts` and `main.ts` described a
  container that could not have worked. They describe one that can.
- The release workflow tagged the image `v<version>` while `compose.yaml` and
  the unraid template pull `<version>`, and it handed the registry the
  repository owner in the case GitHub reports it, which a registry path
  refuses. It strips the `v` and lowercases the owner now, and
  `tools/release.test.ts` holds it to both. Found before the first tag rather
  than by it.
- The image's build stage asked for pnpm through corepack, which Node stopped
  shipping at 25, so the first run of the release workflow failed at that line
  before building anything. It installs pnpm with npm now, at the version
  `package.json` pins, and `tools/release.test.ts` holds the two to one number.
- **A build serving its own client on loopback said to open Vite's port**,
  where nothing is listening. The first-run line asks the config which of the
  two arrangements this is now: with `server.clientRoot` set it names this
  server's own address, and without it the development client's, as before.
