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
[21](docs/design/21-internal-contracts.md) licenses the storage tier to change
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
