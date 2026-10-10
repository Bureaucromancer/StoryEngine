# 35 — P16 implementation plan: World, the set that travels

**Status: skeleton, written 2026-10-04**, the day
[15](../15-world.md) was rewritten under the owner's decision of 2026-10-03
([26 B17](../26-open-questions.md)) and [16](../16-publish.md) was written beside
it. ~~Nothing is built.~~ Format follows [P1](07-p1-implementation.md); citations
follow the corpus convention.

***Opened 2026-10-10, by the owner's word, ahead of P12A*** — on the bare branch
`p16`, cut from `main` at `ad47e39` (alpha 6). §0.1 filed this phase after
[P12A](34-p12a-the-look.md) by a decision with its reversal written beside it —
*a release cut before P12A* — and alphas 5 and 6 were both cut before either
phase opened; the 2026-10-07 note left *whether P16.0 still moves ahead of P12A*
to the owner, and the owner's answer was to start the whole phase. **So it runs
first, and by `PLAN_ORDER`'s rule — execution order is filing order — it files
first too**: the refile is `tools/renumber-docs.mjs`'s, at the merge, as
[P15](33-p15-setup-from-a-turn.md)'s was, rather than inside a phase whose own
document thirty-six files cite. §0.1's one scheduling claim about another
phase's gate is unchanged: R4 waits on both. §2 records each stage as it is
built.

**P16 delivers the half of [15](../15-world.md) that is 1.0's**: World as a
working kind that **replaces Package** — the kind itself, renamed as a migration;
**membership**, a durable named set of references, sessions included;
**contribution**, a new session started in a World prefilled from it; and
**transport**, [16](../16-publish.md)'s review and the file it writes. **Accrual
and the story bible are not this phase** (§4): they wait for real play, on
[15 §4.3](../15-world.md)'s gate.

**The demo that defines done:**

> *Select a lorebook, a treatment and three actors, publish them, and keep the
> World that makes. Start two sessions in it and watch both begin with the book
> already in their lore list and the treatment chosen. Delete one of the actors
> and watch the World say it is gone while both sessions carry on. Publish the
> World again with one session ticked, read the diff, and import the file on a
> second account as a World holding exactly what landed.*

**What makes the phase smaller than it looks:** the stored form already is
membership. A Package holds references, the index already draws them as links,
*Used by* already lists Packages beside treatments, and the delete confirmation
already counts them without blocking (§0.2). P16 renames that, gives it an
editor, reads it at session creation, and builds the export flow
[04 §9.1](../04-schemas.md) specified and nothing ever built.

**What makes it riskier than it looks:** it renames a portable kind on installs
that hold it, it widens a closed portable union whose rules are an open question
for the owner ([26 B16](../26-open-questions.md)), and it writes a format the
first release to carry it will freeze.

**CI this phase establishes:** that a World's reach into the other portable kinds
is exactly one union arm — [work plan §0.2](01-work-plan.md)'s check, as a test
rather than a promise, due at this phase's exit rather than at a release (§1.6).

---

## 0. What this document is, and where it sits

[P7 §0](23-p7-implementation.md) states the shared answer and it is not restated
here: collect the deferrals, name the decisions, hold the gate's shape. Three
things are specific to this one.

**Its subject arrived by decision rather than by plan.** Every phase before it
built something the work plan had intended since the design run, or finished one
it had. This one exists because a branch argued that [04 §9](../04-schemas.md)'s
container and [15](../15-world.md)'s continuity were one object, an audit
corrected the argument by half, and the owner took the half that needs no play
([15 §0](../15-world.md)). **So there is almost no prior phase whose deferrals
accumulate here** — the usual first move, reading what earlier phases pushed
forward, returns the three obligations [15 §5](../15-world.md) says are already
met, P7B's package editor, P11's `.sepack` export, and a closure table no stage
ever built against.

**Its source material is a branch's plan that is not adopted.** The `worlds`
branch wrote a phase called P8A on 2026-09-14 (`d8656c68`), filed between P8 and
P9, with five stages that built accrual and the bible too. Its decisions on
membership, on [P5.7]'s reversal and on the bible's cache are carried here where
they still apply; its schedule, its stage list and its claim that the kind's
schema had already landed (`448c53e3`, a rename `main` never took) are not.
*P8A was a name, never a stage anyone built, and this document does not cite its
stages as though they existed.*

### 0.1 Where it executes, and why writing 15 moved the beta gate again

**Beta is a completeness gate** ([releases §0](04-repo-and-releases.md)):
*feature complete to the 1.0 spec*, read against these documents by
[P11](28-p11-implementation.md)'s **R4**, a person going through the 1.0 corpus
capability by capability. [P12A §0.1](34-p12a-the-look.md) recorded what writing
[10 §1.3](../10-ui-surfaces.md) did to that gate — *the corpus R4 reads now
contains commitments the build does not meet* — and writing
[15](../15-world.md) does it again: membership, contribution and transport are
1.0's now, and R4 would read them. **So R4 must not be walked until this phase
lands, as it must not be walked until P12A lands** — the one scheduling claim
this document makes about another phase's gate. R1, R2, R3, R5 and R6 are
unaffected.

**It executes after [P12A](34-p12a-the-look.md), and is the last phase before
beta is said.** Filed at 35, by `PLAN_ORDER` in
[`tools/renumber-docs.mjs`](../../../tools/renumber-docs.mjs), and nothing
renumbers. The order is a decision rather than a default, and these are its
reasons:

- **P12A is ready and this is not.** P12A has been planned since 2026-09-22, part
  of it is built ([polish §17](06-polish.md)), and nothing in it waits on anybody.
  This phase was written today, and P16.2's `LoreScope` arm waits on an owner's
  answer to [26 B16](../26-open-questions.md). A phase with an open question in it
  should not be put in front of one without.
- **The deadline binds both phases equally.** [26 B17](../26-open-questions.md)
  gives the rename B16's release — the first that exports native objects — as its
  deadline, or else it ships as a migration. Beta is that release unless an alpha
  is cut first, and either order lands both phases before beta. And P16.0 is a
  migration whichever release it follows (§1.1), because the installs that hold
  Packages are already there.
- **New surfaces are cheaper after the look than before it.** This phase builds a
  panel's editor, a picker, a review and a session-form choice. Built after
  P12A, they are built to its tokens, its motions, its editors' identity header
  and its phone rules; built first, they are three more surfaces in P12A's sweep.
- **Execution order is the order the work happens in**, the rule
  `PLAN_ORDER`'s own comments state, and nothing about this phase makes it happen
  sooner.

**What would reorder it:** a release cut before P12A lands. P16.0 is the one
stage with a release-shaped reason to go first — every release that writes the
old name adds files the legacy read must cover — so if one is planned, P16.0
moves ahead of P12A on its own, and this document is refiled by
`tools/renumber-docs.mjs`, never by hand.

*(2026-10-07: alpha 5 was cut before P12A and before P16.0, by the owner's
decision to record the cost rather than move the stage. It exports
`storyengine.package/1` and `.sepack` files, so P16.0's legacy read now covers
files a tagged release handed out, not only those dev builds wrote. Whether
P16.0 still moves ahead of P12A is left to the owner, and nothing was refiled.)*

### 0.2 What the code is today — audited 2026-10-04

Read before costing anything below. Ten facts, each a reason a stage is cheaper
or dearer than it looks:

1. **The kind.** `storyengine.package/1` (`shared/src/schema/package.ts`), filed
   under `library/packages/<slug>/package.json`, `LibraryKind` `packages`, in
   `PORTABLE_SCHEMAS`, with an emitted `packages/shared/schemas/storyengine.package.1.json`.
   Its `contents` is `PortableObjectEnvelope[]` — `{ schema, id, name }` —
   **references, not copies**, whatever [04 §9](../04-schemas.md) said until
   2026-10-04 and whatever the field's own docstring and `storage/layout.ts`'s
   comment said until the same day.
2. **The editor** ([P7B.6](24-p7b-presets-and-prompts.md)) writes name, version
   and description, and shows the contents as stored. **There is no way to add a
   member** except by hand-editing the file, so membership has a store and no
   surface.
3. **The links.** `index-db/links.ts` indexes a Package's contents as outbound
   links, so a lorebook's *Used by* already names the Packages holding it, and the
   delete confirmation's reference count already includes them and blocks nothing
   ([03 §10.1](../03-data-model.md)).
4. **The export.** `GET /library/packages/:id/export` (`packaging/export.ts`,
   [P11.10](28-p11-implementation.md)) resolves the declared contents **one
   level**, writes `storyengine.package-export/1` — a manifest beside each
   object's stored JSON, no pixels — as `<name>.sepack.json`, and reports what
   did not resolve in `x-storyengine-missing`, which the detail page states under
   the link. It re-reads every object at export time, which is
   [04 §9.1](../04-schemas.md)'s *re-resolve* already.
5. **No reader.** Nothing in the build imports a `.sepack.json`, and the guide's
   import page says so. *That is why the rename strands nothing anyone was
   given*: the only files in that format are ones dev installs wrote since P11.10.
   *(2026-10-10: no longer only dev installs — alphas 5 and 6 shipped the export,
   so tagged releases have handed `.sepack.json` files out. Still nothing reads
   one, so the rename strands none of them; P16.3's reader of the frozen envelope
   is what they are waiting for, as §0.1's 2026-10-07 note already says of the
   legacy read.)*
6. **`LoreScope`** is `global | linked` and read by nothing ([P5.7]).
   `newLorebook` writes `global`, and so does the SillyTavern importer for
   **every standalone book** — `applyScope` in `import/sillytavern/lorebook.ts`
   sets it unconditionally, and a book bound to a chat only adds a warning,
   because SillyTavern's format carries no scope for anything else to read. A book
   embedded in a character card imports `linked` to that card's actor
   (`import/sillytavern/card.ts`, `import/sweep.ts`). A book's scope is visible
   only in *As stored*. *The comments beside both writers — `lorebook.ts`'s
   `LoreScope` docstring, `newLorebook`'s and `applyScope`'s — still describe B14
   and B15 as open*, each with a dated note since 2026-10-04 that
   [26](../26-open-questions.md) answered them; P16.2 rewrites them when it
   changes the default, because that is when what they say about today stops
   being true.
7. **Sessions** carry no World. Creation copies hooks from every carrier
   ([03 §4.1](../03-data-model.md)), names a `treatment` and a `lore` list, and
   writes nothing a World could read.
8. **What an older build does with a newer object, today.** The backup reader
   maps library folders through `LIBRARY_DIRECTORIES` and reports an unknown one
   as `import.backup.unknownKind`, skipped; the native import arm refuses an
   unknown schema as `unknown-schema`; the index ignores a folder
   `parseObjectPath` cannot place; and an identified build older than a volume's
   stamp will not open it at all ([P6A §1.7](19-p6a-alpha-1.md)). **There is no
   migration machinery** — the stamp refuses, it does not convert.
9. **`Provenance.source` has a `'package'` literal with no writer**, in a shared
   substructure five published schemas carry.
10. **The first-party namespaces are called packages in the code's comments** —
    `mode-loader.ts`'s — and mean the namespace sense ([15 §6](../15-world.md)).
    They are not renamed by this phase, because they are not the kind. *The SDK's
    `ChannelDefinition.owner` docstring was the one that went further*: it read
    `storyengine.lore` owning a channel as [06 §4.1](../06-modes-and-turn-pipeline.md)'s
    obligation exercised, which only the namespace sense was, and since it is the
    extension contract authors read, it carries a dated correction from 2026-10-04
    rather than a reading.

## 1. Decisions this plan has to make

### 1.1 The rename is a migration, and it reads both names

**Read both, write the new one, and keep the old read for as long as anything
might hold the old shape** — which, because backups taken before P16.0 exist, is
indefinitely.

- **Stored objects.** A `storyengine.package/1` body, and a
  `library/packages/<slug>/package.json` folder, are read as a World: the
  registry and the layout know both names, and the body is upgraded in memory by
  its schema id alone — [04 §2](../04-schemas.md)'s *a /2 reader accepts /1 and
  upgrades in memory*, applied to a rename. **Every write writes the new one**:
  `storyengine.world/1` in `library/worlds/<slug>/world.json`. The first write to
  a legacy object — an edit, a member added, a World kept by a publish — moves
  its folder, and **its history moves with it**, because history lives inside the
  object's folder (`storage/history.ts`). An object nobody writes stays where it
  is and is read as a World every time, which is correct rather than a backlog.
- **The move takes a fresh slug when the old one is taken, and keeps the id.**
  Slugs are allocated per kind root (`resolveFreeSlug(kindRoot, name)` in
  `library.ts`), so a World made after P16.0 can already be
  `library/worlds/rain-city` while `library/packages/rain-city` still waits for
  its first edit — two objects, not a conflict, and the edit must not fail or
  overwrite for it. The move therefore runs `resolveFreeSlug` against
  `library/worlds/` and keeps the object's id, which is what the index, the links
  and every route address, so nothing follows the folder name. *Checking both
  roots at allocation instead* was the alternative, and it was not taken: it
  makes every new World's slug depend on a legacy directory, and still leaves a
  restore from the trash and an imported archive needing the same rule. **This is
  the first place the engine moves a user's directory**, and `resolveFreeSlug`'s
  docstring — *the engine never moves the user's directories* — gets a dated note
  in the change that lands the move.
- **Fields keep their names.** `contents` stays `contents`: it already means
  references, on the stored form and in the manifest, and renaming it would double
  the in-memory upgrade to buy a word.
- **Backups.** The backup reader's directory map gains `packages` as a second
  name for the World kind, so an archive taken before P16.0 imports into a later
  build as Worlds rather than as `unknownKind` rows.
- **The trash, which no backup carries.** A Package deleted before P16.0 sits at
  `trash/packages/<slug>-<uuid>` (`layout.trashDestination`), and
  `backup/archive.ts` leaves the trash out, so the backup alias never reaches it.
  `storage/trash.ts` builds its kinds from `LIBRARY_DIRECTORIES`' values plus
  `sessions` (`trashKinds()`); with `packages` gone from that map, such an entry
  would never be listed, `splitTrashId` would refuse its address as a
  `TrashAddressError`, and the sweep would never expire it — a folder on disk for
  good that nobody can see or restore, which is the stranding a migration exists
  not to cause. **So `trashKinds()` keeps `packages` as a legacy entry**, for as
  long as the legacy read lives, and the restore maps it to the World kind where
  it turns a trash directory back into a schema. A restored legacy entry lands in
  `library/worlds/` — a restore is a write, and every write writes the new form,
  so its body becomes `world.json` under the new id exactly as the first write's
  does — under its old slug if that is free and a fresh one if not, by the move's
  rule above; today's `occupied` answer would strand it instead, because slugs are
  frozen and renaming the World that took the name frees nothing. *It is not
  moved at startup*: nothing in this engine rewrites a user's folders on boot, and
  listing, restoring and expiring it where it lies is what every other trash entry
  already gets.
- **The emitted schema: `storyengine.world.1.json` replaces
  `storyengine.package.1.json`, and the old artefact is not kept.** *An earlier
  draft of this plan (2026-10-04, the same day) kept it frozen beside the new
  one*, so a tool validating an old file could still fetch its schema
  ([20 §4](../20-tech-stack.md)). That is the exact case
  `packages/shared/scripts/emit-schemas.ts`'s stale-artefact sweep exists to
  prevent — every build deletes each `*.json` in `packages/shared/schemas/`
  before emitting, *"so a renamed or removed kind does not leave a file behind
  that consumers keep validating against"* — and two checks enforce the sweep from
  opposite sides: CI's *Emitted schemas are current* step with
  `tools/repo-shape.test.ts`'s *commits every schema the build emits*, which
  would fail on a committed file the build deletes, and the same file's *six
  portable kinds* count, which would fail on a seventh. Keeping it would have
  meant one of two mechanisms, both rejected. *A second, frozen schema table*
  that the sweep spares, with both repo-shape assertions and
  `schema/invariants.test.ts`'s emitted-artefact counts taught about the extra
  file — a standing exception to a sweep whose comment names this case. *Or
  Package left in `PORTABLE_SCHEMAS`* as a read-only legacy kind, which brings
  `packages` back as a `LibraryKind` through `registry.test.ts`'s key parity
  with `LIBRARY_DIRECTORIES` — the opposite of this section — and makes
  [04](../04-schemas.md)'s *the six portable kinds stay six* false. Neither buys
  enough: the in-memory upgrade renames the id and validates the body against the
  World's schema, whose shape is identical, so no build needs the old artefact to
  read an old file; every file under the old id is a stored object or a backup on
  an install this build reads; and the artefact stays in every tagged tree that
  shipped it. *(Corrected 2026-10-04, after review.)*
- **Routes and the kind's name.** `/library/packages/*` becomes
  `/library/worlds/*`, `LibraryKind` `packages` becomes `worlds`, and the panel
  is *Worlds*. **The old paths are not kept**: the only caller is the client that
  ships with the server, and [the API reference](../../api.md) changes in the same
  commit. §6 lists this as a revisit question rather than a settled one.
- **The envelope is not touched here.** P16.0 leaves
  `storyengine.package-export/1`'s writer as it is; P16.3 defines the World's
  format once, writes it, and reads the frozen one beside it. Renaming the
  envelope at .0 and reshaping it at .3 would be two formats written inside one
  phase.

**What an older build does with a file this phase writes** — the question a
rename always has, and B16's third answer whatever B16 decides about unions,
because a renamed kind is a new schema id:

| A P16 build wrote | An older build |
|---|---|
| a data directory it has opened | will not open it, if identified — the stamp ([P6A §1.7](19-p6a-alpha-1.md)). An unidentified dev build opens it and cannot see `library/worlds/`, which `parseObjectPath` cannot place; the Worlds are invisible and intact, and a later build sees them again |
| a backup archive | imports everything else and reports each World's folder as `import.backup.unknownKind`, skipped |
| one World, downloaded as stored | refuses it as `unknown-schema`, as it would any kind it has never heard of |
| a World's file (P16.3) | refuses it at the import panel, as it refuses a `.sepack.json` today — no older build reads either |

**That last row is said where the file is made**: P16.3's review states that the
file needs a build from this phase on. It costs a sentence, and it is the honest
form of a fact no design choice here can change.

### 1.2 Membership lives on the World, once

**The World's `contents` is the one place membership is written**
([15 §3.2](../15-world.md)), and that includes sessions: a session member is an
envelope like any other, `{ schema: 'storyengine.session/1', id, name }`, which
the envelope already accepts because it validates `schema` as a string and never
as a kind.

- **Starting a session in a World adds it** to that World's `contents` — the same
  write a person makes by adding it from the World's editor or from the session
  list.
- **A session carries no World.** [15 §3.2](../15-world.md) argues it: for a set,
  one place; for accrual's key, a different question this phase must not answer by
  accident. *There is therefore no session field to land before
  [P11 §1.8](28-p11-implementation.md)'s freeze*, which is the ordering
  constraint the branch's plan had to manage and this one does not: a field added
  when accrual is designed is additive, and the session export carries unknown
  fields through.
- **The reverse view is a query.** A session's page shows *In these Worlds* by
  asking which Worlds name it, which is a fine cost for a panel and would be the
  wrong one for a key read every turn — the same sentence, from this side.
- **A World never blocks a delete, and deleting a World deletes no member.** The
  first is [26 B2](../26-open-questions.md) one level up and is already true of
  the stored form (§0.2's third fact); the second is what makes membership not
  ownership, and the one delete there is already obeys it. A Package can be
  deleted from its read page and from its editor (`DeleteObject`, which calls
  `DELETE /library/:kind/:id` for every kind), and `library.ts`'s `remove` moves
  only that object's folder to the trash; nothing follows `contents`. *No test
  says so*, which is what P16.1 adds: a test deletes a World holding a lorebook and
  a session and asserts both are still readable, so a later change that taught
  delete to follow members fails rather than ships.

### 1.3 Contribution is a copy at creation, and P5.7 is the thing to re-read first

**What went wrong at [P5.7]**, because it went wrong in a day and the shape is
easy to rebuild from the other direction: a book's own `scope` was briefly allowed
to *admit* it to a session, and since `global` is the factory default and what the
SillyTavern importer writes for every standalone book, a person's whole library
appeared in every prompt. The lesson was recorded as **a library is not a world**.

**Why this is not that.** A World is a subset somebody named, and contribution
happens **once, at session creation, by copying** — never as a query that
re-decides each turn. [15 §5.3](../15-world.md) records the three things that had
to be decided together — the copy and the arm under the owner's
[26 B17](../26-open-questions.md), the default and B14's *no* as recommended
answers the owner deferred — and this stage builds them:

- **The copy.** The World's lorebook members go into `session.lore`, its treatment
  members are offered as the session's treatment, and the hooks those carry are
  copied by [03 §4.1](../03-data-model.md)'s rule with their ids. Prefill, never
  binding ([00 §3.1](../00-stance.md)).
- **The arm.** `LoreScope` gains `{ kind: 'world', worldIds: string[] }`: at
  creation in one of those Worlds, a book in the person's library whose scope
  names it is copied into `session.lore` beside the members. It is the only arm
  anything reads; `global` and `linked` stay read by nothing.
- **The default.** A new book's scope becomes `{ kind: 'linked', actorIds: [] }`,
  and so does **every standalone SillyTavern book's** — one line in `applyScope`,
  whose chat-bound warning stays. The test that changes is `lorebook.test.ts`'s
  *imports a chat-scoped book as global*, and a second one pins a plain book with
  no `chatId`, because that is the case most imports are. A native
  `storyengine.lorebook` file that says `global` keeps saying it — that format
  carries the value, and imports preserve what they are given — which is safe
  because `global` admits nothing. [26 B14](../26-open-questions.md) keeps *no*.
  ***Both are recommended answers, owner deferred, 2026-10-04*** — overrule at
  [26 B15](../26-open-questions.md) and [26 B14](../26-open-questions.md); the
  builder of this stage reads that here rather than by following the link.
  **The default does not wait on [26 B16](../26-open-questions.md)**: it is a
  factory default and an importer's value inside the union `/1` already has, and
  changes no portable schema.

**The check that proves the distinction held**, and the stage ends on it: after
starting a session in a World, `session.lore` names the books — as data, on disk,
editable — and nothing reaches the prompt that is not selected there. **If a book
reaches the prompt without appearing in that list, this stage rebuilt P5.7.**

**The arm waits on [26 B16](../26-open-questions.md), and the copy does not.**
`LoreScope` is a closed union in `storyengine.lorebook/1`, and an older build
fails a book carrying an arm it does not know, whole. B16 is the owner's, open,
and due before the same release this phase is; how the arm lands follows from
its answer:

| B16's answer | How the `world` arm lands |
|---|---|
| **Open the unions** | Additively, inside `/1`: an older build keeps an unknown scope and ignores it, as it already does an unknown `ActorRole` |
| **Bump the version** | As `storyengine.lorebook/2`, whose only change is the arm, read-compatible with `/1` and upgraded in memory; every lorebook a P16 build writes is then `/2` |
| **Accept** | Additively, inside `/1`, with the sentence on every surface that exports a book: an older build refuses one that names a World |

***The first row, by the owner's answer of 2026-10-10.*** `LoreScope` opens —
an arm a build does not know is kept and ignored rather than failing the book —
and the `world` arm lands inside `/1` beside it, at P16.2. **The open arm is part
of the exception §1.6's check names**, because opening the union is how the arm
lands; the check is widened to admit exactly that and nothing else. *The other
three unions B16 named* — `MediaRole`'s, and the preset block source's two arms
— open under the same answer; they are B16's and owed before beta, not this
phase's, and touching the actor and preset artefacts is precisely what §1.6
pins against, so they land in a change of their own that re-pins it with a line
saying why.

**So P16.2 lands the copy from membership and the two defaults first, and the arm
second**, and if B16 is still open when the copy and the defaults are done, the
stage records the arm as waiting and the phase does not close on it — the arm is
P16.2's, and so is the scope surface below, and neither is reassigned.

**A book's scope gets a surface with the arm**, because a field that is read and
can only be changed in *As stored* is a field nobody sets — and the falsification
test in [15 §8](../15-world.md) that watches whether it gets set would be
measuring the missing control. [26 B15](../26-open-questions.md) says there is no
surface for it today.

### 1.4 The review writes one thing, and the walker is built against the table

[16](../16-publish.md) is the specification and is not restated. Two decisions
are this phase's:

- **The walker is built against [04 §9.1](../04-schemas.md)'s table as it stands**
  — twelve rows, the World and Session rows added 2026-10-04 — and against its
  paragraph on bare and wrapped references, which describes the walker that drops
  every `involves` edge silently. `packaging/export.ts`'s one-level resolution is
  replaced, not extended. *(2026-10-10: the table as it stands is now thirteen
  rows and a query — the owner's answers at P16.3's plan added the World's scoped
  books and a ticked session's hook actors — and the walker is built against
  that.)*
- **Keeping a World on publish is the one write**, on confirm, and only when the
  starting point was a selection of two or more objects and the snapshot choice
  was not taken. *One object is not a selection* — from its detail page, or a
  selection of one in a panel, it publishes its closure to a file and keeps
  nothing, because a World is a set somebody named and one object with what the
  walk found is not one ([16 §2](../16-publish.md), [16 §3](../16-publish.md)). The preview holds nothing,
  as [P4 §7.17](16-p4-implementation.md)'s import preview holds nothing.

### 1.5 The wire shape is decided before P16.3 writes it

***Decided 2026-10-10, by the owner: the zip*** — [16 §5.2](../16-publish.md)'s
lean, a stored zip of the members' own folders, so an actor travels as its card
and a lorebook with its pictures. P16.3 builds the writer the server did not have.

[16 §5.2](../16-publish.md) leaves one question open on purpose: whether the
World's file is P11.10's JSON envelope renamed, which cannot carry an actor's
portrait, or a zip of the members' stored folders, which can and needs a writer
the server does not have. **The revisit before P16.3 decides it**, because the
format is frozen the first time a release writes it — [P11 §1.9](28-p11-implementation.md)'s
*a second envelope written later is two formats forever*, which this phase already
pays once by reading the frozen `storyengine.package-export/1` envelope beside the
new one.

### 1.6 The release check is a test

[Work plan §0.2](01-work-plan.md)'s check — **World must change no other portable
schema, `LoreScope`'s `world` arm the one named, additive exception** — is
checkable against `packages/shared/schemas/`, which holds every emitted portable
schema as a committed file. P16.2 ends with a test that pins the actor, treatment,
setup and preset artefacts by content and allows the lorebook artefact to differ
from its pinned form only inside `LoreScope`. The World's own artefact is not
pinned — it is the kind this phase changes, and it replaces the package one
rather than standing beside it (§1.1). *A test rather than a promise*,
because a check with an unstated exception is a check that gets waived the first
time it fires, and one with a stated exception is still a check only if something
reads it.

### 1.7 What this phase does not decide

- **[26 B16](../26-open-questions.md)** — the owner's. §1.3 says how each answer
  lands.
- **`Provenance.source`'s `'package'` literal.** It has no writer, and removing or
  renaming a union member in a substructure five published schemas carry is a
  breaking change. P16.3's reader stamps what it imports `import`, as every
  importer does, and the literal waits for a decision of its own.
- **Memory book granularity** — [P8 §1.2](25-p8-implementation.md)'s, on volume
  data this phase does not produce.
- **A World owning a channel.** The content arm of
  [06 §4.1](../06-modes-and-turn-pipeline.md)'s `owner` is a World from now on, and
  declaring a channel is the authoring tier's ([17 §2](../17-authoring.md)).

## 2. Stages

Each stage names its end condition, because *a green suite closes a stage, not a
phase*. The order is the dependency order: nothing reads membership until it can
be written, and nothing publishes a World until there are Worlds.

### P16.0 — The kind: Package becomes World

§1.1, built: the schema id, the registry, the folder and file names, `LibraryKind`,
the routes, the panel's name and the editor's words, with the legacy read for the
stored form, for backups and for the trash; the first write's move under a fresh
slug when the old one is taken; and the emitted `package/1` artefact replaced by
`world/1`, as `emit-schemas.ts`'s sweep replaces any renamed kind's, with no
frozen copy kept (§1.1 says why).

**Owed in the same change**, because docs are contract: [04 §9](../04-schemas.md)
and [04 §1](../04-schemas.md)'s tier table, [03 §1](../03-data-model.md),
[03 §5.1](../03-data-model.md) and [03 §7](../03-data-model.md),
[09 §4.3](../09-server-multiuser-deployment.md)'s layout block,
[10 §5.1](../10-ui-surfaces.md)'s six panels, the API reference's routes and kind
list, the guide's library, concepts and import pages, the docs lorebook's kinds
entry, and the changelog. **And in code, the same commit or CI fails**: the
artefact swap committed — `storyengine.package.1.json` deleted,
`storyengine.world.1.json` added — because CI's *Emitted schemas are current*
step and `tools/repo-shape.test.ts`'s *commits every schema the build emits*
compare what the build writes with what is tracked; `storage/trash.ts`'s legacy
`packages` kind; and the dated note on `resolveFreeSlug`'s *never moves the user's
directories*, which this stage makes false for the first time.

**Ends when** a data directory holding a Package made before the stage opened
shows it in the *Worlds* panel with its members; editing it moves the folder to
`library/worlds/` with its history, and under a fresh slug when a World made after
the upgrade already holds its name; a Package trashed before the stage is listed,
restorable into `library/worlds/`, and expired by the sweep; a backup archive
taken before the stage imports as Worlds; and tests pin each of it — the stored
form's read, the backup alias and the trash's legacy kind, each failing with its
alias removed, and one that makes a World named like a legacy Package before the
Package's first edit, which fails if the move reuses the taken slug.

**Built 2026-10-10, on `p16`.** What shipped is §1.1, with five things §1.1 did
not say, each found by reading the code the rename touched rather than the plan:

- ***Both names in both folders.*** The layout reads a World from `worlds/` or
  `packages/` (`LEGACY_LIBRARY_DIRECTORIES`) under `world.json` or `package.json`
  (`LEGACY_OBJECT_FILENAMES`) — the cross product rather than the two pure
  shapes, because the move is three steps (the new body written over the old
  file in place, the folder renamed, the file renamed) and **every state it can
  stop in then reads**. Admitting only the two pure shapes would make a crash
  between the renames a World that vanished, and nothing in this engine rewrites a
  user's folders at start to rescue one. The upgrade is `upgradeLegacySchema`,
  called at every door a stored or archived body comes through — the index's
  ingest, a version's payload, the backup reader, the native import arm and a
  write's own body — and **deliberately not inside `validate`**, which answers an
  unknown id with *valid* and would have left every caller reading `schema`
  afterwards looking at the old one.
- ***Every path into an object's folder is read off the object's path.***
  History, assets, a hand edit's snapshot, an import's carried pictures and
  delete all built the folder from `(kind, slug)`, which named the same folder
  for every object until a kind had two. For a Package still in `packages/` it
  named `worlds/<slug>` — nothing, or **another World made since under the same
  name**, whose history would have been listed and whose folder a delete would
  have trashed. `Layout.folderOf` is the one door; a legacy object deleted after
  the stage goes to `trash/packages/` (`trashDestinationFor`), so the trash keeps
  *an entry under a folder holds that folder's file*.
- ***The index's version is 13.*** An index an older build wrote holds each
  Package as a row of the old kind, and nothing re-reads a file whose size and
  time have not changed — so without the bump every untouched Package would have
  stayed a row no route names. The rescan is the cost, as at 9 and 11. *(14 since
  P16.3b, the same day, when the index came to read the walker's table: an
  install upgrading from alpha 6 rescans once either way, and a `p16` data
  directory indexed at 13 rescans again, for the links 13 never held. 15 with
  the row 13 correction after it, so a `p16` index built at 14 rescans too, for
  the arrivals 14 left out, without anybody having to ask.)*
- ***An import over an unmoved Package finds it unchanged.*** `identifyNative`
  compared the arriving object's encoding with the hash of the old bytes, which
  can never match once one side says the new id; a legacy prior is compared by
  its upgraded encoding instead, so a backup taken before the stage, imported
  over the install it came from, writes nothing.
- ***A move keeps the folder's name rather than re-slugifying it***
  (`resolveFreeFolder`), so a hand-named folder in `packages/` arrives in
  `worlds/` under the name it had, suffixed only on a collision.

**The export route is `/library/worlds/:id/export`, and its file is unchanged** —
`storyengine.package-export/1`, `.sepack.json` — for §1.1's last bullet. The old
paths answer 404, and §6 still holds that as the revisit's question.

**Tests.** `routes/world-migration.test.ts` starts a P16 server on a data
directory as a pre-P16 build left it — a Package with members and a history —
and holds the panel listing, the history, the first edit's move, the fresh slug
beside a World made since (which **fails if the move reuses the taken slug**),
delete into `trash/packages/` and restore back as a World, the backlink, and an
index an older build wrote (which fails without the version bump);
`storage/layout.test.ts` the legacy parse in all four shapes and the watcher's
scope; `storage/trash.test.ts` a Package trashed before the stage — listed,
expired, restored as `world.json` under its id and history, under a fresh name
when taken, and a body it cannot read left as it was;
`import/storyengine/reader.test.ts` a pre-P16 archive importing as Worlds and an
unmoved Package found unchanged; `schema/registry.test.ts` the old id read and
never registered. ***Each alias was removed in turn and its tests watched
fail***, 2026-10-10: the layout's legacy folder (all 7 migration cases), the
backup reader's (both archive cases), the trash's legacy kind (all 5 of its
cases), the ingest's upgrade (all 7 migration cases), and the move taking the old
slug unchecked (the fresh-slug case).

***After review, 2026-10-10*** — an adversarial pass over the stage's diff,
each finding verified before it was acted on, moved six things:

- **The move is best-effort once the write has landed.** A move refused after
  the new bytes were on disk — a scanner holding the folder on Windows — turned a
  saved edit into a 500 and left the index describing bytes that were gone, and
  the watcher drops the event as the process's own write, so every later save
  was a 412. Now the object is indexed where it is, a World that reads under its
  old name, and the next write tries again.
- **No move while the id has another copy.** Every `packages/` path sorts before
  every `worlds/` one, and the earliest path wins a duplicated id, so moving the
  edited copy away from its twin handed the win to the twin and the edit vanished
  from every read. With a duplicate on disk the write lands in place.
- **Asset stores, asset copies and version amendments take the object's turn**
  on the library's write queue (`storage/library-writes.ts`, moved out of
  `library.ts` for the next bullet), because the first write to a legacy World
  moves the folder they write into.
- **A legacy trash restore claims its folder on the kind's turn**, the one a
  create and the move take, and **rewrites in place then renames**, the move's
  order — writing `world.json` before removing `package.json` could stop with
  both, a duplicate the next edit never resolved.
- **The assistant's proposals read `packages` as `worlds`**, as its context
  rendering already did.
- **The older-index test writes version 12, the number alpha 6 shipped**, not
  one less than today's constant — which would have differed from it whether or
  not anybody bumped it, so the test pinned nothing.

Three more were already fixed by then, found by the suite: `folderOf` re-applies
the name rules (a folder named `con` is a 422 again, not an empty history),
rebuild and reconcile ask `objectFile` first as the watcher does, and `POST`
upgrades a body in the old name as `PUT` did.

### P16.1 — Membership: the panel, the editor, and sessions as members

The World as something a person can make and fill, and see from the outside.

- **The panel**, Package's, renamed: columns for members by kind and for sessions.
- **The editor is a picker over the objects you own**, every kind and sessions,
  with a member's missing state shown in place — the editor
  [manual testing §10](05-manual-testing.md) placed for the old kind and
  [P7B.6](24-p7b-presets-and-prompts.md) built without one.
- **New World**, from the panel, without publishing anything, so that
  [15 §8](../15-world.md)'s test of Worlds that are never published can tell a
  kept World from a by-product.
- **Add to a World** from a session's page and from the session list.
- **Backlinks** ([10 §5.2](../10-ui-surfaces.md)): *Used by* already lists the
  World on each library member; a session's page gains *In these Worlds*.

**Ends when** a person can create a World, add and remove members of every kind
including sessions, see it from each member's backlinks, delete a member without
the World blocking it, and delete the World without losing a member — a dangling
reference, visible and non-blocking, being the correct outcome and walked rather
than only asserted (AA2).

**Built 2026-10-10, on `p16`; the walk is AA2's and has not happened.** What
shipped, against the bullets above:

- **The panel**: *Worlds*, with columns for the members by kind (*2 actors · 1
  lorebook*, a kind this build does not know counted as *other* rather than
  dropped) and for sessions, sorted by name, by recency or by size, and an empty
  state written for somebody who never saw a Package (AA10's reading).
- **The editor's picker** (`editor/MembersField.tsx`, `editor/members-form.ts`):
  members listed in order, by kind and by their **current** name — a reference
  sees the edit — with a member that resolves to nothing kept in place and marked
  *Missing*, never removed for the person; **Add members** over everything of the
  account's own of every kind **but Worlds** ([15 §3.1](../15-world.md)) and its
  sessions, archived ones labelled, filtered by name and kind and capped at fifty
  shown with the rest counted (AA11 is where that cap meets a real library). A
  412's merge takes `contents` member by member, as the hook list's does, with one
  stated gap: a member they removed and I removed and re-added unchanged stays
  removed, because the two are indistinguishable from *untouched*.
- **Add to a world** from a session's row and its page, and ***In these worlds***
  on the page. **One server door** for the first, `POST
  /library/worlds/:id/members` (`library/worlds.ts`, `addMembers`): idempotent by
  id, hash-checked and retried on a stale read, refusing a World or the World
  itself as a member — because a button on a session page holds no version of the
  World, and a read-modify-write in a browser loses whatever a second tab saved.
  **The second is a query and the client's** (§1.2): the Worlds whose `contents`
  name the session, read off the same list the first control offers.
- **Backlinks**: a library member's *Used by* already named its Worlds, and does.

**What §1.2 said no test held now does**: `routes/world-membership.test.ts`
deletes a World holding a lorebook and a session and reads both back; deletes a
book and a session a World holds and finds the World still naming them; and pins
the members door — idempotence, the refusals, not-found for a missing World and
for another kind's id. *An independent review of the client found four defects
and two tests that passed vacuously, fixed before the commit*: a malformed
`contents` entry could take down the session list and the play page, *Add to a
world*'s accessible name did not contain its visible text, a long World name
pushed the phone row sideways, and an unnamed session sorted and filtered by its
empty name; and Enter in the picker's filter submitted — saved — the World.

### P16.2 — Contribution

§1.3, built: starting a session in a World — from the World's page, and as a
choice on the new-session form — copies its books into `session.lore`, offers its
treatments, copies the hooks they carry, and adds the session to the World; and
the factory and importer defaults move to `{ kind: 'linked', actorIds: [] }`,
which change no portable schema and so wait on nothing. Then, on
[26 B16](../26-open-questions.md)'s answer, the `world` arm and its surface on a
lorebook.

**Ends when** §1.3's check passes — the books named in `session.lore` on disk,
editable, and nothing in the prompt that is not selected there — and §1.6's
test is green. *If B16 is still open*, the stage ends at the copy and the
defaults, and the arm and its scope surface are recorded here as waiting, with
the phase open on them.

**The copy and the defaults, built 2026-10-10, on `p16`.** B16 was answered the
same day (*open the unions*, §1.3's first row), so the arm is this stage's too and
follows in a commit of its own; what is recorded here is the half that never
waited on it.

- **`world` on `POST /sessions`** (`library/worlds.ts`, `worldContribution`): a
  default one rung below a Setup's, as §1.3 lays it out — the caller's `lore`
  and `treatment` first, then the Setup's, then the World's: its lorebook members
  joining the Setup's books in the World's order, its treatment **only when it
  holds exactly one**. The hooks those carry are pooled as every carrier's are.
  **`treatment: null` is *none*, said out loud**, and overrides every rung —
  absent had always meant *take the default*, and until a World could supply one
  there was never a default to refuse. The session then joins the World through
  `addMembers`, after it exists and unable to undo it: a World that refuses the
  write costs the membership, logged, not the session. A World that is not there
  is `422 unknown-world`, for the Setup's reason.
- **The form and the page**: *Start in a world* on the new-session form ticks the
  World's books after any already ticked and chooses its one treatment, all of it
  editable, and sends what it shows — an empty list and a `null` treatment
  included, because absent beside a World would be read as the World's; a World's
  page has *Start a session in this world*, straight in, and *Choose first…*, the
  form with `?world=` set. A book the World names and the library no longer holds
  is ticked and said, as the server would copy it.
- **The defaults**: `newLorebook` and every standalone SillyTavern book write
  `{ kind: 'linked', actorIds: [] }`; `lorebook.test.ts` pins the chat-bound case
  and a plain one. The Lorebooks panel's *Linked* badge is drawn only for a book
  linked to somebody, and its scope filter reads *Global*, *Linked to characters*,
  *Linked to nobody*.
- **The request bound on `lore` is 512**, from 64, on the create and lore routes:
  a World's books arrive as an explicit list when a form shows them.

**§1.3's check passes** — `routes/world-contribution.test.ts` starts a session in
a World whose library also holds a `global` book keyed on a word the input says,
and finds the World's book in `session.lore` on disk and alone in the preview's
books and blocks. **§1.6's test is green** (§3.3, row 5). *An independent review of
the client found one defect, fixed before the commit*: a World deleted in another
tab after it was chosen left its books and treatment selected and no longer drawn,
so Start would have sent what the form did not show.

**The arm, built 2026-10-10, on `p16`**, after the owner answered
[26 B16](../26-open-questions.md) — *open the unions*, §1.3's first row.

- **`LoreScope` is open, and the `world` arm is in it**, inside `/1`
  (`schema/lorebook.ts`): `{ kind: 'world', worldIds: string[] }` beside the two
  arms `/1` shipped with, and an open arm after them — any `kind` that is *not*
  one of `LORE_SCOPE_KINDS` — so a scope a newer build writes is kept and read by
  nothing. **The known kinds are refused by the open arm**, so a `linked` without
  `actorIds` or a `world` without `worldIds` is still a malformed book rather
  than an unknown one. `worldIdsOf(scope)` is the one read of the arm, written
  once because the open arm's `kind: string` defeats narrowing on `kind`.
- **Read once, at creation, by copying** (`worldContribution`): after the World's
  own lorebook members, every lorebook the person can read whose scope names the
  World, by name, deduplicated against the members — as part of the World's
  default, which an explicit `lore` overrides as it overrides the rest. A book
  scoped to a World after a session started in it reaches that session only by
  being chosen there.
- **§1.6's check is widened by exactly the open arm**: `world-release-check.test.ts`
  now requires the two `/1` arms, then the `world` arm, then the open arm, and
  nothing else. §3.3 row 5 is answered again for the arm.
- **Where this disagrees with §1.3's table, said rather than smoothed**: the first
  row's *an older build keeps an unknown scope and ignores it* is true of builds
  from this one on, not of the alphas already released. Alpha 5 and alpha 6
  carry the closed union and refuse, whole, a book that names a World — which is
  B16's own argument for answering before the release that would freeze the
  closed shape, and not something this stage can reach back and change.

~~The scope surface — §1.3's *a book's scope gets a surface with the arm* — follows
in a commit of its own.~~

**The surface, built the same day** — §1.3's *a book's scope gets a surface with
the arm*, because a field that is read and set only in *As stored* is set by
nobody, and [15 §8](../15-world.md)'s test of whether it gets set would measure the missing
control.

- **The lorebook editor says what the book is for** (`BookScope.tsx`, its rules in
  `scope-form.ts`): *Not tied to anything* — the factory's
  `{ kind: 'linked', actorIds: [] }` — *For particular characters*, and *For
  sessions started in particular worlds*, with a help line saying what the last
  does and that it does it once. *Global (from an older book)* and a kind this
  build does not know are choices **only for a book that already says them**,
  and choosing back to what the saved book says restores it as stored, so an
  unknown scope is never overwritten except by a deliberate choice. Characters
  are picked from the library and worlds from the person's own; an id that no
  longer resolves stays, under its id, marked *Missing*. `TokenField` gained an
  opt-in `strict` — for a field of ids, only an offered option is committed —
  and `nameOf`, so a remove button speaks a name rather than an id.
- **The session form ticks what the server would copy**: after the World's own
  books, every book whose scope names it, by name, and a line saying why they
  are ticked; choosing another World takes them back with the rest. *The builder
  found a defect in P16.2's own form*: arriving with `?world=` applied the World
  as soon as the Worlds list loaded, before the lorebooks had, so a scope-named
  book could never have been ticked on that path. It now waits for both.
- **The shelf**: a *For worlds* scope filter, by kind, and a neutral **World**
  badge only when the book names a World — the *Linked* badge's rule. A kind
  this build does not know is under no filter but the unfiltered shelf, and
  carries no badge.
- **The read page keeps scope off its strip**, for a narrower reason than its
  comment gave (`LorebookView.tsx`, a dated note): the strip is what decides
  whether an entry fires on a turn, and the arm decides nothing on any turn.
- **The entry budget is raised to 312**, from 304 (`tools/entry-budget.test.ts`,
  with every stage's measurement): P16 took the entry from 299.63 to 306.79,
  all its own code and no dependency. **It was found by the isolated full run of
  `c511641`, not by the stage's own checks**, which were targeted and built no
  client — so from here a stage that touches the client builds it and runs the
  `release` project before it calls itself verified.
*An independent review of the surface found three defects, each fixed with a
test that fails without it*: the session form drew its World choice as soon as
the Worlds had loaded and before the lorebooks had, so a World picked in that
window ticked only its members and Start sent a list without the books the server
would have added — the choice now waits for both, the condition `?world=` waits
on; the *ticked because the book says it is for this world* line could name a
book the person had ticked themselves, and now names only what the World's
choice added; and `TokenField`'s `strict` answered Enter after Escape with
*nothing matches* while options matched, and now reopens the list. It also found
a test that could not fail — the editor's worlds picker offering every World
rather than the person's own — and added the one that can.
*Not changed, and why*: both sides order scope-named books with
`localeCompare` and no locale, so a server and a browser that collate
differently could disagree — but the form sends the list it shows, so what a
person saw is what starts, and the server's order governs only *Start a session
in this world*, where there was no client order to disagree with.

**The hook editor's two pickers take the same fix, the same day**, at the owner's
request — not a P16 stage, but `strict` is this stage's, and the hook editor had
the flaw it was written for. *Involves* (`involves: Ref[]`) and *Blocked by*
(`blockedBy`) were tag fields: Enter, a comma or leaving the box committed
whatever was typed, so a typo became a `Ref` naming nobody — and
[03 §4.1](../03-data-model.md) retires a hook whose `involves` dangles, quietly.
Both now pass `strict` and a `nameOf` that speaks what the chip shows; a guard
writes only an id that was held or offered; a value already stored that resolves
to nothing keeps its chip under its stored name, marked *Missing* only once the
library has answered, with the reason in the field's hint as well as the badge's
title. Built, reviewed through three lenses (what is written, what is heard,
whether the tests can fail), and fixed: ten findings, all verified real, seven
fixed here with tests that fail without them. *Three are `TokenField`'s own*: in
`strict`, an offered id is trimmed before it is committed, and a *Missing* value
removed by Backspace cannot be typed back; and `aria-expanded` stays true with no
list drawn. The first two are defects of this stage's `strict` and follow in a
commit of their own. *(Repaired the same day, in the commit after `ecf7ebf`, with
the third: under `strict` an offered value is committed exactly as given and
compared byte for byte; Backspace in an empty box moves focus to the last chip's
remove button, which a second, deliberate press removes — never a held key, and
in a tag field the button takes no Backspace at all; and `aria-expanded` and
`aria-controls` follow whether a list is drawn. Its own review added the focus
ring that makes the move visible. Escape still follows the internal open state,
recorded beside the code, because changing it changes Escape in a dialog.)*
*A disagreement found on the way, and not this phase's*: [04 §3](../04-schemas.md)
says a `Ref` resolves by id **then by case-insensitive name**, always; the turn
pipeline's hook pool (`sessions/hook-pool.ts`) resolves `involves` by id alone,
so a typed-in name the old picker stored still retires its hook. The badge follows
the server. Which of the two gives way is its own decision.

### P16.3 — Publish

[16](../16-publish.md), built: the walker against [04 §9.1](../04-schemas.md)'s
~~twelve rows~~ table *(thirteen rows and a query since the owner's answers of
2026-10-10, below)*; the review in the panel — every level, `required` warnings, a
checkbox per session defaulted off, history opt-in, every picture that stays
behind named, re-publishing opening on the diff, and the snapshot choice; a World
kept when the starting point was a selection of two or more, and none when it was
one object (§1.4); the World's format, written in the
shape §1.5 decided, with the sentence §1.1 owes; and the reader, through the
import review, for the World's format and the frozen
`storyengine.package-export/1`, with ticked sessions landing through
`sessions/import.ts`. The World's page carries Publish where the package's page
carried *Export this package*.

**Ends when** a World published with one session ticked imports on a second
account as a World naming exactly what landed, with the session opening; a
`.sepack.json` written before the stage imports as a World; and publishing an
edited World again opens on what changed.

**The build plan, 2026-10-10.** Three designs — the walker, the file and its
reader, the flow and its surface — were made independently against the branch
and synthesised into one plan, whose load-bearing facts were then checked in the
code. Eight sub-stages, each closing on the whole suite and recording its commit
here; the three end clauses above are tests in P16.3e, P16.3f and P16.3h.

**Decisions the plan takes**, where the designs disagreed: unchecking a row never
cascades — a book a dropped treatment brought stays ticked and is labelled as
nothing-left-names-it, with *leave these out too* on its group — and sessions are
the one cascade, because the Session row says *excluded until ticked*; system
objects are off by default and can be ticked; review choices are keyed by id and
re-applied on a confirm that re-walks the library, so the preview holds nothing
([P4 §7.17](16-p4-implementation.md)'s posture); a World in a selection is a
`422`, not an exclusion; integrity is checked by the manifest's `sha256` per file,
and the zip readers' behaviour for third-party archives is not changed; the World
is created only after the file is planned, so a refusal leaves no stray World;
`requires` as stored stays the World's, and the derived union goes in the
manifest for the reader's warning.

**The owner's answers, 2026-10-10**, to the three questions the plan could not
take: **a ticked session's hook actors travel** — 04 §9.1's Session row gains the
pool's `involves` and ~~unfired~~ `introduces.actor` *(fired or not, with the
played cast — corrected at P16.3b, below)*; **books scoped to a World travel
with it**, included and each uncheckable — a new World row, the table's one query,
because P16.2's arm is an inbound link the walk would otherwise never see; and
**a session's pictures travel** beside its export ([16 §5.2](../16-publish.md)).

**What the fact check changed**, the same day — an adversarial read of the plan's
load-bearing claims against the code, which found most of them true, two
**partly** true, and one **false**:

- *False*: that one exact-match rewrite carries a re-minted or re-keyed id
  through a session. A session keys ids in map **keys** and composite strings —
  its channels (`se.status#<actorId>`), `prompts.cards`, `hidden`,
  `renditionSelection`, `lastSelectedChild` — and a session landed with the old
  keys would, on first open, record "hand edits" deleting the re-minted actors'
  state. P16.3e and P16.3f map the keys too, and their tests scan keys as well as
  values.
- *Partly*: the turn table's holder check must count a turn with no session row
  as held by somebody else, and *already here* must mean every turn is held, not
  any — a session played on since it was last sent lands what is new (P16.3f).
  Re-keying needs a fallback for turn ids that are not v7, which every chat and
  Aventuras import produces (P16.3f).
- *Leaks the plan had not named*: a session's `memory.associations` keys name its
  sibling sessions, unticked ones included, and are stripped from every session
  that travels; the leak test checks an unticked session's **id** as well as its
  name (P16.3c). A turn's recorded calls name the connection that answered —
  an id, never the connection — and stay; its recorded prompt may quote memory
  drawn from another session, and the review says so rather than scrubbing what
  the session sent (P16.3g).
- *Gaps*: the World landing refuses a nested World envelope itself, since only
  `addMembers` did (P16.3e); tag ids name the sender's tag registry and are
  dropped where the recipient has no such tag (P16.3e); landing a session warms
  the recipient's summariser, which the reader either suppresses or the preview
  says (P16.3f); the reader's byte budget counts re-reads, and a session export
  over the readers' 64 MiB entry bound is left behind by name (P16.3c, P16.3e).
- *The older-build sentence* (below) holds in outline with four caveats for
  P16.3g's check against alpha 6: its picker does not offer the extension;
  carried history would land each object at an old version; a book scoped to a
  World is refused by its closed union; and folder pictures arrive loose.

**Where the design notes and the plan disagree, said rather than smoothed**:

- *[04 §9](../04-schemas.md)'s "an object of an unrecognised kind is kept, not
  usable here"* has no home to keep it in. The reader reports one and does not
  keep it, and the sender's review names an unknown-kind member as left behind;
  §9 gets a dated note when P16.3e lands.
- *[16 §5](../16-publish.md)'s "the review writes one thing"* cannot be literal
  beside *re-publishing opens on the diff*: the plan reads it as one **library**
  write, and the ledger line is written on confirm.
- *§1.1's last row* — that an older build refuses the World's file — is, on a
  reading of the code, wrong: an older build sweeps a `.seworld` as loose files
  and imports its objects without the World or its sessions. P16.3g checks it
  against an alpha 6 build before the review's sentence says it.

#### P16.3a — The reference table and the walker

`library/references.ts` — one pure reader of [04 §9.1](../04-schemas.md)'s rows
per kind — and `packaging/closure.ts`, a breadth-first walker over it that
resolves `Ref`s by id then name and envelopes and session links by id alone, never
calls `resolveLore` (memory books), and reports a missing reference as a node —
with the owner's two edges, the World's scoped books as a query and a ticked
session's hook actors gated on the session;
`shared/src/publish.ts`, the closure's types and `fileSet` — the one rule for what
is in the file, which the review draws with and the confirm writes with.

**Ends when** every row has a named test through the reader and through the
walker, and the integration cases pass against real routes.

**Built 2026-10-10, on `p16`**, by a builder, two reviewers — fidelity to the
table, and robustness with test adequacy — and a fixer, after a first run was
cut off by a session limit with half its files written. **It ends as written**:
`references.test.ts` has a case per row of 04 §9.1 as amended, thirteen of them
with the World's scoped books as row twelve, and `closure.test.ts` walks each
through an in-memory reader and through the real `resolveRef`, `read` and session
reader on a test server — a Setup made by its route, a foreign lore id found by
name, a session started in a World and reached as its member, a memory book
*not* reached, an unmoved legacy Package walked as a World. Every load-bearing
test was checked by breaking what it guards — the bare-`Ref` trap, resolution
order, envelopes and session links never falling back to a name, siblings never
reached, the session gate, the cycle, the shadowed copy, an index error
propagating from every lookup — and failed.

- **The owner's two edges.** A World's scoped books are asked of the reader
  (`scopedTo`) only for the World a publish starts from, and answered by
  `booksScopedTo` in `library/worlds.ts`, which the session start's
  `worldContribution` now shares — **so what a publish carries and what a session
  started in the World is offered are one query**. They join the roots after the
  members, so leaving one out is noted no more than leaving out a member. A ticked
  session's pool reaches every `involves`, and `introduces.actor` only while
  `readHookState` does not say *fired*.
- **What an orphan is, decided where the plan said it twice.** R1 says
  reachability decides which rows are orphans, and the rule list under it said
  *no inbound edge from a carried node*. The review found the second blind to a
  cycle — an actor and her own lorebook, kept after the treatment that brought
  them is unticked — and to a book two steps out. `fileSet` takes R1: **a carried
  row is an orphan when no carried starting point reaches it through carried
  rows**, and *came with* names the first left-out row behind it.
- **The index disagrees with the table in three places, not two**: an actor's
  lore, a session's treatment, and a session's hook pool. `links.test.ts` pins
  exactly those three, so P16.3b removes them knowingly or the test says so.
- *The walker refuses where it cannot honestly answer*: an index error at any
  lookup rejects the walk; an unreadable session — a link that escapes the data
  directory included — is a missing member, not an error.

#### P16.3b — The index reads the same table

`referencesIn` becomes the reader's ids, a session indexes its `treatment`, index
version 14.

**Ends when** the index and the walker agree with no listed differences.
*Independent; may move to a follow-up*.

**Built 2026-10-10, on `p16`**, by a builder, a reviewer and a fixer. **It ends
as written**: `referencesIn` is the walker's reader's ids, a session indexes the
ids `sessionEdges` reads, and `links.test.ts`'s parity case holds on every
portable kind and on a session **with no listed differences**. Through the route
the panel calls: a lorebook's *Used by* names the actors that link it, a
treatment's counts the sessions played under it, and an actor's counts the
sessions whose hook pool names them — the index is refreshed on every head move,
so ~~a hook firing updates it~~ *an arrival — a presence, status or party write —
updates it (corrected with row 13, below)*. The index's version is 14 *(15 with
the correction)*.

- **What the index stops linking, measured rather than assumed.** Old against new
  over every position of every kind and twenty-eight value shapes: the new
  reader links more (an actor's lore, a session's treatment and hook pool, bare
  `Ref`s and wrappers where the old one wanted one shape), and loses only
  hand-edit shapes no writer produces — a `Ref` that also carries its own `ref`
  key. Kept as one reading of the table rather than two; `links.ts` records the
  shapes.
- **A `Ref` that resolves only by name** links its id as written, as before: an
  index that resolved by name would make one file's links depend on files nothing
  re-derives. The walker finds it by name; the index does not. Said in both.
- **A book's world scope is not a link**, before or after — it is a fact about
  the book, read by `booksScopedTo` from the book's own row.
- *The review found the row's own claim false, and the stage pins the row as
  printed rather than as it should read*: 04 §9.1's Session row follows a pooled
  arrival's subject only while unfired, because *a fired arrival's subject is in
  the cast*. It is not in `cast.actors`, which is what the row reads: firing
  writes only the hook's channel, and an arrived character joins the cast a turn
  is played with through `resolveCast`'s union with channel state. So the
  session drops out of the arrived character's *Used by*, and out of a publish of
  that session. The test that pins it says *as row 13 stands*; the correction
  follows in a commit of its own. *(It did, the commit after `adedc22`: the row
  reads "its cast" as the **played** cast — the persona, and `cast.actors`
  together with every actor the session's channels hold state for, which is
  `resolveCast`'s set — with those in play through channel state as their own
  rule, `session.cast.arrived`, which the review must word as *in play, not in
  the configured cast* rather than promise an arrival, since someone taken off
  the roster who still holds state is one too; and every pooled arrival's subject
  is followed, fired or not. 04 §9.1 strikes the false reason with a dated note.
  The walker's played cast was checked against `resolveCast` itself over forty
  thousand generated sessions; the walker and the index still agree, with no
  listed differences. The review made the pointer search one pass, since the
  index runs it on every session write, and the index's version is **15**, so a
  `p16` index built at 14 rescans on its own.)*

#### P16.3c — The zip writer and the World file

The server's first zip writer (stored, UTF-8 names, no zip64, refusing before
writing anything its own readers would refuse) and the World file:
`storyengine.world-file/1`, `.seworld`, a manifest first, the members' stored
folders under `library/`, sessions under `sessions/` with their pictures, every
file re-hashed at write so an edit mid-publish fails it whole.

**Ends when** a planned file is accepted by both repository readers and by `unzip
-t`, and an unticked session's name appears nowhere in its bytes.

**Built 2026-10-10, on `p16`**, by a builder, three reviewers — the format and
its readers, what leaves and what must not, whether the tests can fail — and a
fixer. **It ends as written, and further**: a plan made from a real P16.3a walk
writes a `.seworld` that `zip.ts`, `ZipFile`, `unzip -t`, `zipinfo -v` and
Python's `zipfile` all accept, and a property test holds that whatever the writer
accepts the reader returns identically — its generator now really producing lone
surrogates and duplicate names, which the review found it only claimed to. **An
unticked session's name *and id* appear nowhere in the file**, searched in its raw
bytes and inside every carried card's decoded envelope and pictures, with history
on and off.

- **The writer** (`storage/zip-writer.ts`) writes stored entries with UTF-8 names
  and one fixed time, to a `.part` it removes on any failure, and refuses —
  before the offending byte — anything the repository's readers would refuse: a
  name `safeZipName` rejects, an entry or archive past their bounds, a central
  directory past `ZipFile`'s 16 MiB. The readers parse an entry's CRC and still
  enforce none; the file's integrity is the manifest's `sha256` per member.
- **What a plan holds to.** Each stored file must hash to the index's
  `contentHash`, so the bytes copied are the body that chose the pictures; every
  member is re-hashed at write, and a change between plan and write — the same
  length included — fails the publish whole, leaving no file. Session exports
  are streamed to scratch one turn at a time as they are surveyed, so a plan
  never holds every transcript at once, and one too large to travel stays home,
  named, rather than throwing.
- **What the review found leaving that should not**, fixed: with history on, an
  unticked session's name travelled in ordinary members' `history/index.jsonl`
  — a hook promoted from it, a memory written by it — and the index is now
  rebuilt with a memory source's session id dropped and the generated reasons
  saying *a session*. The World's own history never travels: its old versions
  name members and sessions the publish left out.
- **Two decisions the stage took, conservative and reversible, recorded for the
  owner.** *An object play wrote stays home* — a memory book, `provenance.source`
  `session` — as `not-portable`, because its entries are a session's text and
  may be an unticked one's; the walker still draws it as included, so P16.3g's
  review shows the row staying home and why. Carrying one deliberately, scrubbed
  and off until ticked as a session is, is the alternative, and it is not built.
  *A card drops the pictures its author removed*: a card that still embeds a
  picture no current media row names is re-spliced without it, every other chunk
  and the pixels untouched — so an author's deleted expressions do not travel in
  a file meant for somebody else. A sender importing their own file sees such a
  card as changed, and a replace merges its pictures back.
- *Interpretations*: a book scoped to the World and not a member is `member:
  false` in the manifest and not named in `world.json`; a folder name colliding,
  case-folded, takes `-2`; a session member that cannot be read stays home with
  a note; a picture whose bytes do not match its name stays home, named.
  `publish.file.*` notes have no client sentences yet — P16.3g's.

#### P16.3d — The publish routes and the ledger

`POST /api/publish/preview` (writes nothing), `POST /api/publish` (returns the
file; the one library write is the kept World), and a per-account ledger,
`users/<handle>/publishes.jsonl`, which the diff reads and [16
§8](../16-publish.md)'s counts come from.

**Ends when** the one-write rule holds in every origin's test.

#### P16.3e — The reader: objects, identity across accounts, the World, the legacy file

The reader's objects: identity across accounts — kept ids where this account can
hold them, re-minted where another account does, references followed by
exact-match rewriting — the World landing last and naming what landed, and the
frozen `.sepack.json` read through the same reader.

**Ends when** a World file imports on a second account of one install with every
reference followed and the first account untouched, and the legacy fixture imports
as a World.

#### P16.3f — The reader: sessions, and the look before commit

The reader's sessions — turn ids re-keyed only when another account holds them —
and the look before commit, from the manifest's head bytes through the existing
preview door.

**Ends when** the first end clause, as a route test.

#### P16.3g — The client: selection, the review, the doors

The client: selection on the shelves, the review as its own lazy route, *Publish…*
on every object's page and *Publish this world…* on a World's; the old export link
and route removed.

**Ends when** the client builds with the entry under 312 — **the ceiling is not
raised for this stage**; the review is lazy, and the selection bar follows it if
it must.

#### P16.3h — Re-publishing opens on the diff

Re-publishing opens on the diff against the ledger's last record, with *choose as
last time*.

**Ends when** the third end clause, as a route test.

## 3. Verification — the P16 exit gate

Split under [manual testing §0](05-manual-testing.md)'s two-tier rule. **The
gate's own steps are never edited to match what was walked**; §3.3 records what
was answered.

### 3.1 The critical list, and why each row is on it

**Registered as [sitting AA](05-manual-testing.md) on 2026-10-04**, before a line
of the phase is built — the second list registered that early, after
[P12A](34-p12a-the-look.md)'s T, and for T's reason: the claims are written before
the code, and R4 waits on the phase. Derived by
[manual testing §0](05-manual-testing.md)'s criterion — **(i)** it can falsify a
claim this phase makes about itself, **(ii)** the claim compounds, **(iii)** it is
walkable with what is to hand:

| # | Check | (i) The claim | (ii) Why it compounds | (iii) To hand |
|---|---|---|---|---|
| 1 | **The rename, on an install that had Packages.** A data directory — one Package live, one in the trash — and a backup archive from before P16.0, opened and imported by a P16 build. | P16.0's legacy read | A rename that mishandles a folder strands files on disk, and nothing found later restores what a migration dropped | The walker's own data directory, after a Package's contents are filled by hand as AA0 says — no build before P16.1 has a surface for membership (§0.2's second fact) — copied before upgrading |
| 2 | **Membership is not ownership.** Delete a member a World holds, and delete a World that holds members and sessions. | P16.1: never blocks, never cascades | Every later feature over Worlds inherits whichever answer ships, and a cascade destroys data | Any install |
| 3 | **Contribution copies, and P5.7 stays reversed.** A session started in a World whose library also holds a `global` book. | P16.2's check | Every session started in a World carries what this decides, in its record and in its prompts | An install and one turn against [R2](05-manual-testing.md) |
| 4 | **A World published, and arriving.** Publish with a session ticked, import on a second account, publish again after an edit. | P16.3: the round trip and the diff | The format freezes the first time a release writes it; a wrong shape found later is two formats forever | A second account on one install |
| 5 | **Desk work: the release check, recorded.** §1.6's test output written into §3.3 and into [work plan §0.2](01-work-plan.md). | The phase's one portable-schema claim | [Work plan §5](01-work-plan.md): each series is when its check gets answered, and an unrecorded answer is no answer | The repository |

**Only a person can walk rows 1 and 4**, because the suite plants fixtures and the
claim is about what a real install and a real second account do with them. Row 2
is on the list for clause (ii) rather than for being invisible: its two halves are
assertable and will be asserted, and what the walk adds is that a person reading
the World afterwards understands what happened.

### 3.2 The remainder, which extends the standing list

Drained continuously ([manual testing §5](05-manual-testing.md)), and registered
as rows in [sitting AA](05-manual-testing.md), in this order: **AA10**, the
panel's columns and empty state read by somebody who never saw Packages;
**AA11**, the picker at the scale of a real library (R1); **AA12**, the backlinks
from each member kind; **AA13**, a World holding only sessions, published without
them; and **AA14**, the review and the picker on a phone, which P12A's rules now
govern.

### 3.3 What was answered

| # | Answered by | Date | Result |
|---|---|---|---|
| 5 | Claude, at the desk, on branch `p16` with P16.0 to P16.2 built | 2026-10-10 | **Passes.** `world-release-check.test.ts`, 7 of 7: the actor, treatment, setup and preset artefacts are as they were at `ad47e39`; the lorebook's is too, `LoreScope` included, because the `world` arm waits on [26 B16](../26-open-questions.md); the emitted set is those five and the World's. Written into [work plan §0.2](01-work-plan.md) the same day. *Rows 1–4 are a person's and are not answered.* |
| 5 | Claude, at the desk, after B16 was answered and the arm built | 2026-10-10 | **Passes, with the exception used as named.** 7 of 7: the four artefacts unchanged; the lorebook's unchanged outside `LoreScope`, and inside it the two `/1` arms kept with exactly the `world` arm and the open arm after them. Work plan §0.2's answer gained the same note. |

## 4. Not this phase: accrual and the story bible — gated on PLAYABLE

**[15 §4](../15-world.md) keeps them designed and unscheduled, and this phase
builds nothing of either.** World-scoped memory, a hook not firing again in
another session of the same World, an introduction made once per World, the
session-side World those three would key on, and the bible that would show what a
continuity holds.

**The reason is the old reason for 4.0, applied to the half it still fits**: a
continuity container designed before continuities exist is designed against a
guess ([15 §2](../15-world.md)). The branch's plan put both in this phase and
conceded, in its own §1.5, that they would ship *"against a guess"*, and that the
revisit should ask whether PLAYABLE had produced any session worth putting in a
World. It has not: [sitting G](05-manual-testing.md), PLAYABLE's long pass, has
never been walked.

**What reopens them** is [15 §4.3](../15-world.md)'s evidence, and the tests that
produce it, by when each becomes runnable:

| Watch | Runnable | A result that reopens accrual |
|---|---|---|
| A second session played in the same setting | now, against real play | It happens, and the second session wanted the first's history |
| Session names that hand-encode continuity | now | *"Rain City 3"* |
| Sessions per World | from P16.1 | Worlds made here hold sessions, and their owners wish the sessions knew about each other |
| Members per World, by kind | from P16.1 | — it tests the set, not accrual: all-lorebooks means a collection with extra steps |
| `LoreScope`'s `world` arm set by anybody | from P16.2's arm | — it tests contribution: never set means the arm is ceremony |
| Worlds that are never published | from P16.3 | — it tests the kind: every World made by a publish and never opened means durability was scaffolding |

**When they reopen, they get a phase of their own**, written against the play
that reopened them, and never a stage added to this one after it closes. Their 1.0
obligations are met ([15 §5](../15-world.md)), so nothing in this phase has to be
shaped around them.

## 5. Out of scope, deliberately

- **Accrual and the bible** — §4.
- **Lorebook extraction from a session.** It reads what a bible would, and it is
  the authoring tier's ([17 §3](../17-authoring.md)).
- **Continuity checking** ([25 §2c.2](../25-roadmap.md)) — the bible would make it
  possible, and there is no bible.
- **Anything collaborative.** [15 §7](../15-world.md) is explicit, and sharing
  between users on one install stays deferred ([03 §5](../03-data-model.md)).
- **Nesting.** A World does not hold a World ([15 §3.1](../15-world.md)).

## 6. What only the revisit can settle

Written now so the revisit has a list rather than a blank page.

- ~~**[26 B16](../26-open-questions.md)'s answer**, which decides how P16.2's arm
  lands, and whether it lands inside this phase at all.~~ ***Answered 2026-10-10
  by the owner: open the unions*** — the arm lands additively inside
  `storyengine.lorebook/1`, with `LoreScope` opened beside it (§1.3's first row).
- ~~**JSON or zip** ([16 §5.2](../16-publish.md), §1.5) — before P16.3.~~
  ***Answered 2026-10-10 by the owner: the zip*** (§1.5).
- **Whether the old routes need to answer.** §1.1 drops them on the ground that
  the client is the only caller; anything that turns out to have bookmarked one is
  the evidence that reverses it.
- **What the picker does with three hundred members.** It is specified at the
  scale a household has, and nothing has tried the other one.
- **Whether a World created by publishing should open afterwards**, or stay a line
  in the panel. [16 §8](../16-publish.md)'s first test is what would answer it, and
  it cannot run until the stage it is about has shipped.
