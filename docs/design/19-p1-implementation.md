# 19 — P1 implementation plan

**Status: plan.** Expands [15 P1](15-work-plan.md) into something that can be
worked from. The first document here that describes *code to write* rather than a
design to argue with.

**P1 delivers:** repo shape, the portable schemas, files on disk, the derived
index, library CRUD, and a read-only library list.

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

**CI gate this phase establishes:** rebuild-from-disk equals the incrementally
maintained index.

---

## 1. Decisions this plan had to make

Three things the design documents left open that P1 cannot be written without,
plus one verification.

### 1.1 Folder names versus identity — the `<slug>` question

The storage layout ([02 §5.1](02-data-model.md)) uses `actors/<slug>/`,
`lorebooks/<slug>/` and three more, and **no document says what a slug is**, how
it is derived, whether it is unique, or what happens on rename. Ids are uuidv7
and live *inside* the file.

**DECIDED: the folder name tracks the object's name.** Renaming an object renames
its folder, so the data directory always reads the way the library does.

- Slug derived from `name` — kebab-case, ASCII-folded, length-capped — and
  de-duplicated with a numeric suffix. **Dedup runs at every rename**, not only
  at creation, since a rename can collide with an existing folder.
- **The slug is still not identity.** The uuidv7 inside the file is, and the
  index maps `id → path`. Nothing resolves by slug — which is what keeps a
  *foreign* rename (someone renaming the folder in a file manager) an update to
  an existing row rather than the creation of a second object.

Four mechanics this needs, all cheap and all unpleasant to discover late:

- **A rename is one self-write, not two events.** At the filesystem level a
  directory rename is unlink + add, so it emits suppression tokens
  ([02 §5.1.1](02-data-model.md)) for *both* paths, then updates `id → path`
  synchronously. Without this the watcher re-ingests the object as a deletion
  followed by a creation, and anything holding the old row sees it vanish.
- **Case-only renames need a two-step.** `Vera` → `vera` through a single
  `fs.rename` is a no-op or an error on Windows and macOS, and Windows is the
  development platform. Go through a temporary name.
- **Assets are unaffected**, because the manifest holds paths *relative to the
  folder* ([02 §5.3](02-data-model.md)) and the whole directory moves together.
  Worth a test rather than an assumption.
- **References are unaffected**, because `Ref` resolves by id
  ([13 §3](13-schemas.md)). A setting linking a renamed actor keeps working.

**The accepted cost**, recorded once so it is a known trade rather than a
surprise: a rename invalidates the user's *own* external references — a symlink,
a script, a path in their notes. Nothing in the engine can prevent that. Git
usually copes, since rename detection works on unchanged content.

### 1.2 The same id in two folders

Follows from 1.1 and from folders being copy-pasteable, which is a feature.
Someone duplicates `vera-solano/` to `vera-draft/` and there are now two files
claiming one uuid.

**DECIDED: first-wins by mtime, the loser is flagged, nothing blocks.** The index
records the conflict, the library shows both with a warning on the shadowed one,
and the fix is *offered* (assign a new id) rather than performed.

This is the dangling-reference posture ([00 §3.3](00-stance.md)) applied to a
collision: survivable, visible, non-blocking. Refusing to load either would
punish a user for using the filesystem the way this design explicitly invites
them to.

### 1.3 A user context before there is auth

Per-user layout is a day-one item ([15 §2](15-work-plan.md)); accounts and login
are P10. So P1 writes to `users/<handle>/` from the first write, with `<handle>`
supplied by a **stub context module** returning a fixed `dev` user.

Stated so neither wrong thing happens: not building auth early, and not building
a flat store "for now" — the second is what the checklist calls miserable to
retrofit. The stub is one file and P10 replaces its innards.

**`system/library/` is loaded and merged from P1 too**, shipped empty. The merge
is a query, not a special case ([02 §5.1](02-data-model.md)), and retrofitting it
into every list endpoint later is the annoying version.

### 1.4 Verified locally, so the stack choice holds

- **`node:sqlite` has FTS5, with no flag** (Node 26.4, SQLite 3.53.2). This was
  the live risk in [07 §7](07-tech-stack.md); the documented fallback to
  `better-sqlite3` is not needed. **Re-run the probe on whichever LTS gets
  pinned**, since 26 may be Current rather than LTS.
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
packages/client/     React + Vite; the read-only list ships in P1.6
                     modes/* deferred to P7 — the boundary rules land now
```

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
  ingest.ts      file → rows, one per kind
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

Turn text indexing ([07 §7.1](07-tech-stack.md)) is scaffolded but unused — no
turns exist until P2.

*Tests:* **rebuild-from-disk equals incremental**, this phase's CI gate; a
foreign write is picked up; a self-write does not double-index; deleting
`index.sqlite` and restarting is a non-event ([18 §5](18-internal-contracts.md));
a duplicate id is flagged rather than fatal (§1.2).

### P1.5 — Config, HTTP, and library CRUD

```
packages/server/src/
  config.ts          load + validate + reload tiers
  context.ts         the stub user (§1.3)
  app.ts             Fastify
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
([07 §3](07-tech-stack.md)).

**Rename lands here**, since it is a route rather than a storage primitive: a
name change triggers §1.1's folder move, with suppression tokens on both paths
and a synchronous index update.

### P1.6 — A read-only library list

React + Vite + TanStack ([07 §6](07-tech-stack.md)). Deliberately small: **one
surface for all six kinds with a kind filter** ([05 §5](05-ui-surfaces.md)), a
source badge for user versus system, and a detail view.

**No editing.** That is [05 §11](05-ui-surfaces.md)'s editors-are-not-dumb-forms,
and it wants the field-assist contract that does not exist yet.

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

*Ends at:* the demo.

---

## 3. Verification — the P1 exit gate

```bash
pnpm install && pnpm build && pnpm lint && pnpm test
pnpm dev    # http://127.0.0.1:8080
```

1. `POST /api/library/actors` with a minimal actor → `201` with a uuidv7.
2. `ls data/users/dev/library/actors/` → `vera-solano/card.png` exists.
3. `GET /api/library/actors` **immediately** → the actor is listed.
   *This is the read-after-write guarantee. If it needs a retry, P1.4 is wrong.*
4. Open the library list in a browser → both kinds listed, source badges correct.
5. `POST /api/library/lorebooks` → folder appears.
6. Open `data/users/dev/library/lorebooks/<slug>/lorebook.json` in an editor,
   change the title, save.
7. **The browser shows the new title without a restart.** The storage thesis,
   demonstrated rather than asserted.
8. Rename the lorebook through the API → the folder on disk is renamed, the id is
   unchanged, and the list does not flicker through a delete (§1.1).
9. Rename to a name colliding with another → suffixed, both intact.
10. Rename changing only case → succeeds on Windows (the two-step, §1.1).
11. Stop the server, delete `data/index/index.sqlite`, start → everything still
    lists.
12. Copy an actor folder under a new name → both appear, the shadowed one flagged
    (§1.2).

*Automated equivalents of 3 and 6–12 are this phase's CI suite*, plus the
rebuild-equals-incremental property test.

**Steps 8–10 matter more than they look.** Auto-rename is the decision with the
most moving parts in P1, and each of those three is a distinct way for it to fail
— watcher churn, collision handling, and case-insensitive filesystems.

---

## 4. Out of scope, deliberately

Named so they do not creep in: **editing in the UI**; the workbench (P3); auth
and accounts (P10, but see §1.3); the turn pipeline and providers (P2); import
(P4); lorebook *activation* semantics — P1 stores lorebooks, it does not retrieve
from them (P5); and `modes/*` (P7).

**The editing line is the one most likely to erode**, because a list view makes
the absence of an edit button feel like an omission. It is not: an editor built
before the assist contract is an editor rebuilt after it.
