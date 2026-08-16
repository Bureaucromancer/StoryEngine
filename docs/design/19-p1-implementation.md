# 19 — P1 implementation plan

**Status: plan.** Expands [15 P1](15-work-plan.md) into something that can be
worked from. The first document here that describes *code to write* rather than a
design to argue with.

**P1 delivers:** repo shape, the portable schemas, files on disk, the derived
index, login, library CRUD, a library list, and a prototype actor editor.

**The demo that defines done**, from [15 P1](15-work-plan.md): *create an actor
through the API, see the folder appear, edit the JSON on disk by hand, watch the
change reflected without a restart.* That last gesture is the whole storage
thesis — if it does not work, the design has already failed on its own terms
([05 §4.1](05-ui-surfaces.md)).

**One correction to the demo before it is attempted.** Actor JSON lives inside
`card.png` ([02 §5.2](02-data-model.md)), so "edit the JSON by hand" is PNG chunk
surgery for exactly the kind the demo names. Do the folder-appears half with an
**actor** and the hand-edit half with a **lorebook**, which is plain JSON on
disk.

That is worth more than a note about demo mechanics. **Hand-editing an actor is a
promise the format does not currently keep**, and the file-access feature
([05 §4](05-ui-surfaces.md)) will eventually need an "edit card JSON" action that
splices for the user. Recorded here because P1 is where it becomes visible.

**The discipline this phase runs under** is [15 §2.2](15-work-plan.md):
*demonstrate minimally, but build nothing whose only purpose is to be replaced.*
It decides several things below that would otherwise look arbitrary — why auth
ships whole rather than stubbed (§1.3), why the `Capabilities` record is written
in P1 but nothing enforces it, and why the actor editor ships with a real write
path and an empty assist slot rather than the reverse (P1.7). The line is between
a real thing scoped small and a fake thing scoped fully.

**P1 ends somewhere that looks like an application**, not only somewhere that
proves a storage model. That is the point of the last two stages: the spine is
worth little if nothing has ever tried to use it, and the editor is what turns
the exit gate from *the files behave* into *the files behave while someone is
working on them*.

**CI gate this phase establishes:** rebuild-from-disk equals the incrementally
maintained index.

---

## 1. Decisions this plan had to make

Two things the design documents left open that P1 cannot be written without, one
revision to the work plan's phasing, and one verification.

### 1.1 Folder names versus identity — the `<slug>` question

The storage layout ([02 §5.1](02-data-model.md)) uses `actors/<slug>/`,
`lorebooks/<slug>/` and three more, and **no document says what a slug is**, how
it is derived, whether it is unique, or what happens on rename. Ids are uuidv7
and live *inside* the file.

**DECIDED: the slug is derived at creation and then frozen.** Derived from `name`
— kebab-case, ASCII-folded, length-capped — and de-duplicated against the
existing directory with a numeric suffix. Renaming an object changes the name
*inside the file*. The folder keeps the name it was born with.

- **The slug is not identity.** The uuidv7 inside the file is, and the index maps
  `id → path`. Nothing resolves by slug — which is what keeps a *foreign* rename
  (someone renaming the folder in a file manager) an update to an existing row
  rather than the creation of a second object.
- **The engine never moves the user's directories.** If a user wants the folder
  tidied to match a new name, they rename it themselves and the watcher follows.
  A "tidy folder name" action can be offered later; it is not automatic, and it
  is not P1.
- **Assets are unaffected** by any rename, because the manifest holds paths
  *relative to the folder* ([02 §5.3](02-data-model.md)) and the whole directory
  moves together. Worth a test rather than an assumption.
- **References are unaffected**, because `Ref` resolves by id
  ([13 §3](13-schemas.md)). A setting linking a renamed actor keeps working.

**Why not auto-rename**, recorded so the question is not reopened by the first
person who notices a folder whose name has drifted. Tracking the name over time
buys a data directory that always reads the way the library does, and costs:
dedup on every rename, a rename that must emit suppression tokens for two paths
and update `id → path` synchronously or the object appears to vanish, and a
two-step dance for case-only renames on Windows and macOS. It also means the
engine invalidates the user's *own* external references — a symlink, a script, a
path in their notes — on a name edit. The filesystem is the user's
([00 §3.3](00-stance.md)); moving their directories behind their back to keep a
cosmetic property is the wrong trade. Drift is bounded and legible: the folder
reads the way the library did when the object was created.

**The path under an id still changes**, so the machinery is not avoided, only
concentrated. A foreign rename produces exactly the failure auto-rename would
have: unlink on the old path, add on the new. Handle it **once, in ingest** — an
unlink tombstones the row rather than deleting it, and an add carrying the same
uuid before the tombstone matures is a move, which rewrites `id → path`. One
mechanism, one caller, exercised by the foreign-rename test that P1.4 needs
anyway. A rename through the API is then an ordinary write.

### 1.2 The same id in two folders

Independent of 1.1: it follows from folders being copy-pasteable, which is a
feature. Someone duplicates `vera-solano/` to `vera-draft/` and there are now two
files claiming one uuid.

**DECIDED: the winner is the lexicographically first path, the loser is flagged,
nothing blocks.** The index records the conflict, the library shows both with a
warning on the shadowed one, and no remedy is performed.

This is the dangling-reference posture ([00 §3.3](00-stance.md)) applied to a
collision: survivable, visible, non-blocking. Refusing to load either would
punish a user for using the filesystem the way this design explicitly invites
them to.

Two things this deliberately is not:

- **Not mtime-ordered.** mtime is unstable in exactly the ways this design
  invites — `cp -p`, a backup restore and a git checkout all rewrite or equalise
  it, and equal mtimes leave the tiebreak undefined. It also inverts under normal
  use: editing the real object makes it *newer* than the stale copy, so an
  oldest-wins rule silently promotes the copy. Path order is deterministic,
  immune to editing, and makes **rebuild-from-disk equals incremental** — this
  phase's CI gate — trivially true rather than something to hope holds.
- **Not a resolution UI.** A dialog showing both folders and timestamps and
  asking which keeps the id is a *remedy*, and remedies need what P1 has not
  built: a confirmation model, an undo story, and a write that rewrites identity
  rather than content. P1.7 having an editor does not change that — editing an
  object's fields and reassigning its id are different operations with different
  risks. P1 shows a badge on the shadowed row and explains what happened.

### 1.3 Auth is day-zero, not a stub

Per-user layout is a day-one item ([15 §2](15-work-plan.md)), so P1 writes to
`users/<handle>/` from the first write. An earlier draft supplied `<handle>` from
a stub context module returning a fixed `dev` user, with real accounts at P10.

**REVISED: build the real thing in P1**, per [15 §2.2](15-work-plan.md) — the
stub was a system whose only purpose was to be deleted, and it would have been
threaded through every route written between here and P10. The reason it is
affordable is that there is very little "real thing" to build. [04 §4.1](04-server-multiuser-deployment.md) already
scopes auth to access separation among people who trust each other, and
explicitly rules out rate limiting, lockout, complexity policy, email
verification and 2FA. [04 §4.2](04-server-multiuser-deployment.md) rules out
self-registration and identity providers. What is left is roughly the whole of
what will *ever* ship:

- `Account` per [04 §4.2](04-server-multiuser-deployment.md), including the
  `Capabilities` block with defaults. Nothing enforces capabilities in P1 because
  none of the gated features exist yet — but the record is written once rather
  than migrated later.
- **scrypt** for the password hash ([07 §9](07-tech-stack.md)) — no native
  dependency, in the standard library.
- A session cookie with sane flags, and **CSRF on state-changing routes**. Both
  are named in [04 §4.1](04-server-multiuser-deployment.md) as the things whose
  absence is embarrassing rather than defensible, and both are far cheaper to
  put in before there are routes than after.
- **First-run creates the first admin.** Safe on the default loopback bind
  ([04 §5.1](04-server-multiuser-deployment.md)), which is exactly the window
  that section revised the default to protect.

**Accounts are authoritative state, so they are a file, not an index row** —
`data/accounts.json`, atomic-written, never derived. Deleting `index.sqlite` must
stay a non-event ([18 §5](18-internal-contracts.md)), and it cannot be if
accounts live there. It sits outside every user directory so the file browser
([05 §4.2](05-ui-surfaces.md)) can never serve a password hash, whatever
`fileAccess` a user is granted. It is written through `storage/atomic.ts` like
everything else, so P1.0's no-direct-`fs` rule needs no exemption for auth.

**What stays at P10**, so this does not become the auth phase: account management
UI, capability *enforcement*, the notification router, deployment and the
Tailscale provider seam ([04 §5.2](04-server-multiuser-deployment.md)). P10
becomes the multi-user and deployment phase it is named for, rather than
retrofitting an identity into a codebase that assumed one.

**The honest cost.** P1.6 carries a login form and a first-run form on top of the
list. Cheap, and neither needs anything the field-assist contract provides.

**`system/library/` is loaded and merged from P1 too**, shipped empty. The merge
is a query, not a special case ([02 §5.1](02-data-model.md)), and retrofitting it
into every list endpoint later is the annoying version. It is a scope an admin
administers and **not** an account — there is no system login
([04 §4.5](04-server-multiuser-deployment.md)).

### 1.4 Verified locally, so the stack choice holds

- **`node:sqlite` has FTS5, with no flag** (Node 26.4, SQLite 3.53.2). This was
  the live risk in [07 §7](07-tech-stack.md); the documented fallback to
  `better-sqlite3` is not needed. ~~Re-run the probe on whichever LTS gets
  pinned~~ — **settled at P1.0: the pin is 26, which is the LTS this probe was
  always going to be re-run against.** It becomes LTS in October 2026, roughly
  two months after the first commit and well inside P1, so the probe above
  stands as run and there is nothing to repeat. `engines.node` is `>=26.4.0` and
  CI runs the single version; the reasoning is recorded at
  [07 §2](07-tech-stack.md).
- **`crypto.randomUUID()` is v4 only.** uuidv7 is ~20 lines — 48-bit millisecond
  timestamp, version nibble, random tail — and goes in `shared` with a
  monotonicity test. Not worth a dependency.

---

## 2. Stages

Each ends somewhere runnable. Ordered so the discipline mechanisms exist before
there is code to be undisciplined with.

### P1.0 — Repo skeleton

pnpm workspaces per [07 §10](07-tech-stack.md):

```
packages/shared/     types + schemas, no runtime deps
packages/sdk/        scaffolded, re-exports shared
packages/server/
packages/client/     React + Vite; list in P1.6, actor editor in P1.7
                     modes/* deferred to P7 — the boundary rules land now
```

> **Corrected as built ([20 §1.4](20-p2-implementation.md)):** `shared`
> shipped with two runtime deps — TypeBox and Ajv. The dependency is right
> (one schema technology, five jobs); this line was wrong.

- TypeScript strict, `"type": "module"`, project references.
- **ESLint flat config with `eslint-plugin-boundaries`**, encoding
  [16 §2](16-testing.md)'s graph: `modes/* → sdk, shared` (never `server`, never
  `client`); `client → shared`; `sdk → shared`.

  Rules for `modes/*` are written now, before the directory exists. This is
  [07 §10](07-tech-stack.md)'s "discipline mechanism, not organisation" — the
  claim that built-in modes consume the published SDK exactly as a third party
  would is only true if violating it is a build error, and a rule added after the
  first mode is written is a rule negotiated with existing code.
- **Two day-one lint rules that apply immediately**: no direct `fs` outside
  `server/src/storage`, and no `Math.random` or `node:crypto` randomness outside
  the RNG service — which does not exist yet, so the rule bans it everywhere
  until it does ([07 §14.4](07-tech-stack.md)).
- Stylelint with the logical-properties rule, written before there is any CSS.
- AGPL header check as a lint rule; `LICENSE` is already in place.
- CI on PR: typecheck, lint, build, test. Fast enough never to be skipped
  ([16 §6](16-testing.md)).

*Ends at:* `pnpm build && pnpm lint && pnpm test` green, CI green, nothing runs.

### P1.1 — `shared`: the portable schemas

TypeBox authored, **JSON Schema is the artefact** ([07 §4](07-tech-stack.md)) —
emitted to `packages/shared/schemas/*.json` by a build step, so third-party tools
can validate without compiling our types.

```
packages/shared/src/
  ids.ts             uuidv7 (§1.4), slugify (§1.1)
  schema/common.ts   Ref, LoreLink, Provenance, GeneratedFieldProvenance,
                     Openings, Opening, SourceRect, VisualDescriptors,
                     MediaRole, EmbeddedMedia, AssetRef, ModelHint
  schema/actor.ts    Actor, ActorProfile, Section, ActorRole
  schema/lorebook.ts
  schema/setting.ts  incl. PlotHook, CastEntry
  schema/setup.ts    incl. Goal
  schema/preset.ts   incl. SlotBlock / TextBlock / SlotSource / Placement
  schema/package.ts
  schema/registry.ts `schema` string → validator, so containers never
                     enumerate kinds ([13 §9](13-schemas.md))
```

All six portable kinds, from [13](13-schemas.md). Pure, no I/O, fully
unit-testable — the cheapest place in the project to be thorough.

**The trap, and it is a one-line setting.** [13 §2](13-schemas.md) requires
readers to *preserve* unknown fields. Ajv's `removeAdditional` does the opposite
and is exactly the sort of thing switched on for tidiness. It stays off,
`additionalProperties` stays permissive, and a round-trip test enforces it.
Silently stripping a field written by a newer version is the failure that strands
people, and it is invisible until someone downgrades.

*Tests:* round-trip identity per kind; unknown-field preservation
([16 §1](16-testing.md)); **no portable schema declares a property matching the
connection/credential denylist** — the [00 §3.2](00-stance.md) invariant, made a
property over the emitted JSON Schema rather than a habit.

### P1.2 — `server/storage`: paths and atomic writes

```
packages/server/src/storage/
  paths.ts     THE audited path helper
  atomic.ts    write-file-atomic + the self-write token (P1.4)
  layout.ts    user/system roots, kind dirs, slug resolution (§1.1)
```

`paths.ts` is [07 §9](07-tech-stack.md)'s "single most important piece of
security code in the project": one resolver, containment-checked against the user
root, symlink-aware, and the reason the no-direct-`fs` rule from P1.0 exists.
Asset manifests are relative paths within the folder and never escape it
([02 §5.3](02-data-model.md)).

*Tests:* traversal attempts — `../`, absolute paths, a symlink pointing out, UNC
paths, NTFS alternate data streams. Windows is the development platform, so its
path quirks are the ones most likely to be tested by accident and least likely to
be tested deliberately. Plus: an atomic write leaves no partial file when killed
mid-write.

### P1.3 — The card envelope

```
packages/server/src/storage/card.ts
```

`png-chunks-extract` + `png-chunk-text`. **Splice chunks, never re-encode
pixels** — re-encoding on every save quietly degrades user art
([02 §5.2](02-data-model.md)).

Two chunks, per [06 B5](06-open-questions.md):

- `tEXt` carrying base64 JSON — simplest, most widely readable by third-party
  tools.
- A **private binary chunk** for `EmbeddedMedia`: length-prefixed blob index, raw
  bytes rather than base64 ([02 §5.2.2](02-data-model.md)).

Written as an **envelope with per-container encoders** from the start
([02 §5.2](02-data-model.md)), PNG being the only one implemented — so WebP and
JPEG are later a codec rather than a migration.

*Tests:* `object → chunk → object` is identity ([16 §1](16-testing.md)); pixel
bytes byte-identical across a save; a V2/V3 `chara` card still parses; an unknown
ancillary chunk survives a round trip.

### P1.4 — Index, watcher, and the dual write path

```
packages/server/src/index-db/
  migrations.ts  schema versioning for the index itself
  open.ts        node:sqlite, FTS5 (§1.4)
  ingest.ts      file → rows, one per kind; tombstone-and-match (§1.1)
  rebuild.ts     full scan; the startup option
  watcher.ts     chokidar + self-write suppression
```

The write path is [02 §5.1.1](02-data-model.md)'s dual model, and it is the part
of P1 most likely to be got subtly wrong:

- The server indexes **its own writes synchronously**, so the API is
  read-after-write consistent.
- The watcher handles **foreign writes** — hand edits, git checkouts, restores —
  and periodic reconciliation.
- Self-write events are suppressed by a short-lived `(path, mtime, size)` token.
  `write-file-atomic` does temp + rename, so without suppression the watcher sees
  an add/unlink pair per write and re-indexes everything twice.
- **An unlink tombstones rather than deletes** (§1.1). If an add carrying the
  same uuid arrives before the tombstone matures, it is a move: rewrite
  `id → path` and keep the row. This is the whole of the rename story — there is
  no rename special case anywhere else, because the engine never renames folders.

Turn text indexing ([07 §7.1](07-tech-stack.md)) is scaffolded but unused — no
turns exist until P2.

*Tests:* **rebuild-from-disk equals incremental**, this phase's CI gate; a
foreign write is picked up; a self-write does not double-index; deleting
`index.sqlite` and restarting is a non-event ([18 §5](18-internal-contracts.md));
**a foreign rename is a move, not a delete followed by a create** — the row
survives with its id and a new path (§1.1); a duplicate id is flagged rather than
fatal, and **the same copy wins after a rebuild as won incrementally** (§1.2).

### P1.5 — Config, HTTP, and library CRUD

```
packages/server/src/
  config.ts          load + validate + reload tiers
  auth/accounts.ts   accounts.json, scrypt, first-run admin (§1.3)
  auth/session.ts    session cookie + CSRF; request → handle
  app.ts             Fastify
  routes/auth.ts     login, logout, first-run setup
  routes/library.ts  CRUD over all six kinds, kind-agnostic
```

**Config** is [18 §4](18-internal-contracts.md)'s interface and key table, with
the tier annotation as the *source* of the restart-required notice rather than a
parallel hand-maintained list ([06 D0](06-open-questions.md)). `server.host`
defaults to `127.0.0.1` ([04 §5.1](04-server-multiuser-deployment.md)); ship the
commented `config.example.json` ([02 §5.4](02-data-model.md)).

**Routes are kind-agnostic** — the registry from P1.1 means one handler set, not
six. List merges user and system libraries with a source badge
([05 §5](05-ui-surfaces.md)). Fastify validates against the same JSON Schema the
storage layer uses, which is the fifth job for one schema technology
([07 §3](07-tech-stack.md)). *Not delivered as built — params only, no body
schemas; recorded at [20 §1.4](20-p2-implementation.md) (F2) and repaired at
20 P2.0.*

**Every library route resolves its root from the session**, never from a
parameter. `paths.ts` is containment-checked against *that* user's root, which is
the version of the P1.2 check that matters once there is more than one root.

**Rename is not a special route.** A name change is an ordinary write of the
object's `name`; the folder does not move (§1.1).

**Every read carries a content hash and every write must present one**
([04 §4.4](04-server-multiuser-deployment.md)). A stale hash is rejected with the
current object in the response body, so the client can offer a choice rather than
guess. It lands here rather than in P1.7 because it is a property of the write
path, not of the UI — and because a rejected write is the only defence the
hot-reload thesis has against silently eating a hand-edit.

### P1.6 — The library list, and login

React + Vite + TanStack ([07 §6](07-tech-stack.md)). Deliberately small: **one
surface for all six kinds with a kind filter** ([05 §5](05-ui-surfaces.md)), a
source badge for user versus system, and a detail view.

**Plus login and first-run** (§1.3): no accounts on disk routes every request to
create-the-first-admin; otherwise a login form. Small, but it is the reason this
stage is not purely read-only.

**No editing at this stage** — that is P1.7, and keeping it a separate stage is
deliberate: this one has to be green on its own, because it is what the hot-reload
demo runs on.

This stage is the model for [15 §2.2](15-work-plan.md)'s good case: **nothing
here is thrown away.** The list, the detail view, the routing and the login are
all the real surfaces, scoped small.

It earns its place by making the demo's most important step *visible*: a
hand-edit on disk appearing in a browser without a restart is a far stronger
demonstration of the storage thesis than a second `curl` returning different
JSON.

**The day-one client rules start here**, because this is the first stylesheet and
the first component ([15 §2](15-work-plan.md)):

- **CSS logical properties only** — `margin-inline-start`, never `margin-left`.
  Enforced by the Stylelint rule from P1.0, which is why that rule was written
  before there was any CSS to check.
- **No sentence built from concatenated fragments, and no user-visible string in
  logic** ([07 §12.6a](07-tech-stack.md)). Full i18n extraction is a pre-beta
  sweep rather than a P1 obligation — these two habits are the part that cannot
  be retrofitted.
- **`Intl` for every date and relative time.** No hand-rolled "2 minutes ago".
- **Semantic HTML, focus management, and no state encoded in colour alone** — the
  source badge needs a second channel.

*Ends at:* the storage demo.

### P1.7 — A prototype actor editor

The stage that turns the skeleton into something recognisably an application.
Everything before it proves the storage spine is sound; this one shows the spine
can be *used*, which is a different claim and the one that is easy to defer until
it is expensive.

**This reverses an earlier position**, which put all editing out of P1 on the
grounds of [05 §11](05-ui-surfaces.md)'s editors-are-not-dumb-forms. That
argument turns out to prove something narrower than it first appears. Assist is
what [05 §11](05-ui-surfaces.md) is about, and assist needs providers, which do
not exist until P2 — so the *assist* half is deferred by dependency, not by
choice. The **write** half is entirely P1's business, and leaving it unbuilt
means P1's central claim goes untested in the one condition that matters.

**The argument for building it here**, rather than "it would be nice to see":

- **It is the only thing that exercises the write path under contention.** The
  read-only list demonstrates hot reload. An editor demonstrates hot reload
  *while a user is mid-edit*, which is where [02 §5.1.1](02-data-model.md)'s dual
  write path either holds or does not. The stale-hash rejection from P1.5 is
  unfalsifiable without a UI that can hold a stale hash.
- **It is the sharpest available test of unknown-field preservation.** P1.1 calls
  that the trap that strands people and is invisible until someone downgrades.
  A round-trip test proves the codec preserves them; only an editor proves the
  whole stack does — load an actor carrying fields this build does not know,
  edit one field, save, and confirm the rest survived.
- **It proves the schemas are usable, not merely valid.** Six kinds of TypeBox
  are an assertion until something renders a form from one and writes it back.

**Scope, held down deliberately.** Actor only — the kind with the richest shape
([13](13-schemas.md)), so it is the honest test rather than the easy one. Text
and simple structured fields, sections, and the existing avatar shown but not
replaced. No other kind gets an editor in P1; the list stays read-only for the
other five.

**Lore media is schema-only in P1.** `Lorebook.media`, `LoreEntry.media` and
`EmbeddedMedia.tags` ([13 §5.1](13-schemas.md)) land in P1.1 with the rest of the
schemas, because the roles are the part that cannot be retrofitted
([02 §3.6](02-data-model.md)). Nothing renders them — the lorebook editor is not
in P1 — and P1.1's round-trip tests are the whole of their coverage. Worth
naming so the fields are not mistaken for an unfinished feature.

**Built as the smallest real editor, per [15 §2.2](15-work-plan.md)** — which
means one specific thing about its shape:

- **A single `Field` primitive** owning label, value, validation and the slot
  where assist actions will attach. [05 §11](05-ui-surfaces.md) is explicit that
  assist must be a primitive rather than a per-field bolt-on, so the primitive is
  where the seam belongs. In P1 that slot renders nothing.
- **The slot is empty, not disabled-with-a-promise.** A greyed "Generate" button
  that cannot work is a placeholder in the §2.2 sense and also a bad UI.
- **Provenance is preserved, never authored.** `GeneratedFieldProvenance`
  ([05 §11.2](05-ui-surfaces.md)) is already in P1.1's `schema/common.ts`. Nothing
  writes it until P2, and the editor must not drop the map on save — which is the
  unknown-field discipline applied to a field we *do* know.

**Version history is part of this stage**, on both sides. The storage half
belongs with P1.2 — every write snapshots the state it replaces
([02 §11](02-data-model.md)) — and the editor is where it becomes visible: a
history panel with restore and diff ([05 §11.2a](05-ui-surfaces.md)).

That pairing is not decoration, it is what makes a *prototype* editor safe to
have. An editor built before the assist contract is one people will use on real
characters anyway, and the argument for building it early is undermined if a bad
save is unrecoverable. History removes that objection entirely — and the two
features share the write path, so building them together costs less than
building either alone would suggest.

It also gives the stage a second falsifiable claim: **the `source` field is
populated correctly.** An edit through the UI records `manual`, a hand-edit on
disk records `external` ([18 §1.6](18-internal-contracts.md)). If those come out
the same, the watcher is not distinguishing its own writes from foreign ones,
which is [02 §5.1.1](02-data-model.md) failing in a way nothing else in P1
surfaces.

**The risk, stated because [15 §2.2](15-work-plan.md) requires it to be.**
Building a field primitive before the assist contract is proven can bake in the
wrong shape. The mitigation is that P1 commits to a *component boundary*, not to
the contract: one component, whose interface changes cheaply if P2 shows the four
operations want a different shape. That is the "build less of it" branch of §2.2,
not the "build a false version" one. If P1.7 starts growing an assist mechanism
before providers exist, the rule has been broken and the work should stop.

*Ends at:* the demo, now including the editor.

---

## 3. Verification — the P1 exit gate

```bash
pnpm install && pnpm build && pnpm lint && pnpm test
pnpm dev    # http://127.0.0.1:8080
```

1. First boot with no `accounts.json` → the browser lands on first-run setup.
   Create the admin, log in (§1.3). Call the handle `ned`.
2. `POST /api/library/actors` with a minimal actor → `201` with a uuidv7.
3. `ls data/users/ned/library/actors/` → `vera-solano/card.png` exists.
4. `GET /api/library/actors` **immediately** → the actor is listed.
   *This is the read-after-write guarantee. If it needs a retry, P1.4 is wrong.*
5. Open the library list in a browser → both kinds listed, source badges correct.
6. `POST /api/library/lorebooks` → folder appears.
7. Open `data/users/ned/library/lorebooks/<slug>/lorebook.json` in a text editor,
   change the title, save.
8. **The browser shows the new title without a restart.** The storage thesis,
   demonstrated rather than asserted.
9. Rename the lorebook through the API → the title changes, the folder does not,
   the id is unchanged (§1.1).
10. Rename that folder on disk in a file manager → the list does not flicker
    through a delete, and the id survives with a new path (§1.1).
11. Stop the server, delete `data/index/index.sqlite`, start → everything still
    lists, and **the admin can still log in** — accounts are not in the index
    (§1.3).
12. Copy an actor folder under a new name → both appear, the shadowed one
    flagged, and the same one stays shadowed after a rebuild (§1.2).
13. Open the actor in the editor, change the summary, save → the change is on
    disk, and `card.png`'s pixel bytes are unchanged (P1.3).
14. Add a field the build does not know to the card JSON by hand. Open the actor,
    edit a *different* field, save → **the unknown field is still there** (P1.1).
15. With the actor open in the editor, hand-edit the same object on disk, then
    save from the UI → the write is **rejected** on a stale hash and the UI
    offers reload-and-reapply or save-as-a-copy
    ([04 §4.4](04-server-multiuser-deployment.md)).
16. Open the actor's history → the edit from step 13 is listed as `manual`, and
    the hand-edit from step 15 as `external` ([02 §11](02-data-model.md)). Two
    entries, correctly attributed; one entry or two identical ones means the
    watcher is not telling its own writes from foreign ones.
17. Save the actor again without changing anything → **no new version.** The
    no-op rule ([02 §11.1](02-data-model.md)), and the difference between a
    history someone reads and one they scroll past.
18. Restore the step-13 version → the summary reverts, and the state you were on
    is now the newest entry rather than gone.
19. Diff two versions → the changed field, and only the changed field.

*Automated equivalents of 4 and 7–19 are this phase's CI suite*, plus the
rebuild-equals-incremental property test. *Overstated as built — steps 16,
11's login half, DELETE, and the rebuild property test were not automated;
recorded at [20 §1.4](20-p2-implementation.md) (F11) and completed at
20 P2.0.*

**Steps 16–18 are cheap to write and disproportionately worth having**, because
each fails silently otherwise: mis-attributed sources look like a working
feature, no-op suppression is invisible until the list is unusable, and a
destructive restore is only discovered by someone who needed the thing it
destroyed.

**Step 10 matters more than it looks.** The path under a stable id is the part of
P1 most likely to be got subtly wrong, and a foreign rename is the only thing
that exercises it — which is the argument for keeping it the *single* way a path
ever changes.

**Steps 14 and 15 are why P1.7 exists.** Neither is reachable without an editor,
and both test a claim P1 makes and would otherwise ship unverified: that this
storage model survives contact with a second writer, and that it does not eat
data it does not understand.

---

## 4. Out of scope, deliberately

Named so they do not creep in: **field assist in any form** and **editors for the
other five kinds** (P1.7 is actor-only); the workbench (P3);
account management, capability enforcement and deployment (P10 — but login and
first-run land now, §1.3); the turn pipeline and providers (P2); import
(P4); lorebook *activation* semantics — P1 stores lorebooks, it does not retrieve
from them (P5); and `modes/*` (P7).

**The assist line is now the one most likely to erode**, and it moved: it used to
be the editing line, and editing turned out to be defensible on its own terms
(P1.7). Assist is not, and it will feel like the obvious next thing precisely
because P1.7 leaves a visible slot for it. The slot is not an invitation. Assist
needs providers, a context builder over the object and its links, and the four
operations of [05 §11.1](05-ui-surfaces.md) — none of which exist before P2, and
a version built without them is the per-field bolt-on that section exists to
prevent.
