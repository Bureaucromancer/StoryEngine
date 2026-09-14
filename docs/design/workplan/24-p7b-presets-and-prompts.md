# 28 — P7B implementation plan: presets and prompt handling

**Status: skeleton, written 2026-09-11 at `46bec98` — the phase after P7, and
filed out of order on purpose.** Its place is after [P7](23-p7-implementation.md)
and before [P8](24-p8-implementation.md), which is 24. Taking that number today
renumbers P8 through P11 and repoints every citation to them — including the
ones inside the P7 document that branch `p7` is editing — so it sits at the
first free number instead. `PLAN_ORDER` in
[`tools/renumber-docs.mjs`](../../../tools/renumber-docs.mjs) already holds its
real position; one scripted run after P7 merges moves it, and nothing cites a
work-plan number, so the move costs nothing
([README](README.md)). Format follows [P1](07-p1-implementation.md); citations
follow the corpus convention.

**Written against `main` while P7 runs on its branch.** Nothing in this
document edits a file that branch is editing, and every claim below about what
P7 does or does not build is quoted from P7's own document *as it stood on
branch `p7` at its 2026-09-10 re-audit* — P7.0 through P7.2 had landed there
when this was written. §0.3 is the list of things that are P7's until P7 closes
without them, and it is written so that the hand-over needs no second routing.

**P7B delivers:** presets and prompt handling into a usable state. Concretely —
the built-in prompt pack as a library object a user can open and copy; an editor
for the prompt pack; an editor for the treatment, because its framing is
injected every turn and is therefore the other half of every prompt; a
session-settings surface that can change what a running session is prompted
with — the pack, its parameters, and the session's own copy; and
edit-a-block-and-re-run, answered through the pack rather than through a field
on the record.

**The demo that defines done:** *open the Scene pack from the library, copy it,
change the sentence that begins "You are the narrator of a scene", start a
session on the copy, take a turn, and read the changed sentence in the
workbench's rendered messages. Then, mid-session, switch to a second pack, take
the same turn again, and watch compare show exactly what changed.* No JSON, no
text editor, no `curl` anywhere in the walk. Every one of those steps is
impossible today, and the first one has been impossible since P2.

**Why a phase, and why here.** [P7 §5](23-p7-implementation.md) says a plan
that cuts under pressure *cuts a panel and never the boundary* — and three
editors are three panels, which is the pressure. P7's own text knows the gap:
its P7.9 grows *"a thirteen-block preset that is a code constant nobody can
open"*, and its re-audit found *"a hook has nowhere to be authored"* and chose
hand-edited JSON for P7.5 rather than inherit an editor. That is the right call
for P7 and the wrong end state for 1.0. Why not P11: [P11.2](27-p11-implementation.md)
applies [10 §11](../10-ui-surfaces.md) *across every editor*, and
[P11 §1](27-p11-implementation.md) says in as many words that the size of that
clause *"depends entirely on how many editors P5 through P9 add"*. A hardening
phase applies a contract across editors; it should not be discovering that
half of them are missing.

---

## 0. What this document is, and the audit it opens with

Three things, per [P7 §0](23-p7-implementation.md)'s statement of what a
skeleton is for: collect the deferrals, name the decisions, hold the gate's
shape. The first is the load-bearing one here, because the deferral this phase
exists for was made six times and collected nowhere.

### 0.1 The chain, and where it broke — audited 2026-09-11 at `46bec98`

**The sentence that makes Scene a narrator is the `se.instruction` block of
`SCENE_PRESET`**, a code constant in `modes/scene/preset.ts` on `main` and
under `packages/modes/scene` on branch `p7` after P7.0's move. Its own docstring
states the cost: *"the default preset is readable in the turn record and not
editable in the app until P7."* Every session gets a `structuredClone` of it at
creation ([P4 §1.9](16-p4-implementation.md)), or of a library preset if the
create form named one.

**Six documents sent the editor onward, and the chain terminates in nobody:**

| Document | What it said |
|---|---|
| [P2 §5](08-p2-implementation.md), and the file itself | *no cast, mode or preset picker, those are P7's*; *not editable in the app until P7* |
| [P3 §5](15-p3-implementation.md) | *A preset editor. Edit a block edits this turn's input, never the preset that produced it — and at P3 the preset is a code constant* |
| [P4 §1.9](16-p4-implementation.md) | *P7 keeps the surface — browsing, previewing, switching mid-session; P4 takes only copy-at-creation* |
| [P5 §3](17-p5-implementation.md) | *`SlotSource.outlet` is set by no shipped preset, there is no preset editor … whose only repair today is hand-writing preset JSON* |
| [P6B §4](20-p6b-playable.md) | *The cast panel and any session-settings surface. P7.2 owns them*; *Changing a preset after creation … which P7's surface revisits* |
| [P6B §5](20-p6b-playable.md) | *No treatment editor … Creation follows each kind's editor, and that is P7's and P11's* |

**P7 collected the deferral and did not stage it.** [P7 §1.10](23-p7-implementation.md)
records P4's amendment and keeps *"browsing, previewing, switching
mid-session"* — pack selection, never block editing — and no stage from P7.0
to P7.9 carries even that. P7.2 is the cast panel. P7.3, on branch `p7`, carries
voice and dispatch as session fields, the session and step overrides of
[19 §5.1](../19-tech-stack.md), and the role-binding editor; not the pack, not
`params`. P7's §4 does not list an editor as out of scope, so it is neither in
nor deliberately out. **P8 through P11 do not build one either**: P9, P10 and
P11 never use the word *preset*, and P8's one use is an import marker. The only
sentence in the corpus that names an owner is P6B §5's, in a
*what-not-to-report* list, and the two phases it names have never read it.

**That is [manual testing §0](05-manual-testing.md)'s fourth state** — not
owned, not deferred with an owner, not handed over — reached by the route
[work plan §2.3](01-work-plan.md) exists to close: *no phase exits with
configuration that has no surface*, unpaid for the prompt pack since P2. And the
design is emphatic about which layer this is. [04 §8.5](../04-schemas.md):
*"Prompt packs are where model-behaviour opinion belongs … Someone who dislikes
how 'hard' behaves can read the fragment that caused it and change it."*
[06 §7.3.1](../06-modes-and-turn-pipeline.md): *"the layer that shapes model
behaviour should be the layer an author can open and edit."* P7.8 ships
difficulty levels *supplied by the prompt pack rather than engine code*, so P7
builds a feature whose levels a user is meant to author, in a pack nobody can
open.

### 0.2 What a user can and cannot do today, checked against the client

**Can.** Pick a library preset on the create form — P6B.0's disclosure, with the
hint *"Copied into the session at creation, and not changeable afterwards"*.
Read any *library* preset field by field at `/library/presets/:id`, blocks and
`template` text included, through the by-field view [polish §1](06-polish.md)
landed, and the raw file under *As stored*. Read the assembled prompt of a
committed turn, instruction sentence and all, in the workbench's rendered
messages. Change which lorebooks and which treatment a session retrieves from,
mid-session, through `LorePanel`.

**Cannot, anywhere in the app.**

- **Edit any preset.** `EDITOR_ROUTES` in `client/src/library/fields.ts` has two
  entries, `actors` and `lorebooks`, and `fields.test.ts` asserts the negative for
  the other four kinds. The detail page shows *Edit* only where that table has
  a row; a preset's only write is *Delete*.
- **Open the built-in pack at all.** It is not a library object: nothing writes
  to `system/library/`, which `library.ts` says is *"shipped empty"*, so the
  Scene pack has no library row, no detail route, and a session created from it
  records no `presetId` — which is why the workbench's block row for
  `se.instruction` has nothing to link to (`workbench/address.ts` links a preset
  source only when the record carries an id). It appears in exactly one place:
  the rendered-messages panel of a turn that has already run.
- **Change a session's pack, parameters or model after creation.**
  `PATCH /api/sessions/:id` accepts `SessionPatch`, which is `name` and
  `archived`. No route touches a session's `preset` or `params`; the client's
  own hint says so. [Manual testing](05-manual-testing.md)'s C3 still reads
  *"No UI for this: hand-edit `preset.params.maxTokens` in the session's own
  `session.json`"*, and D11 still hand-edits a block's priority on disk to give
  compare something to show.
- **Author a treatment.** Same table, same negative. The framing that
  `se.treatment` injects every turn, the tone, the writing samples and the cast
  billing are all JSON-only.
- **Archive or delete a session.** Both routes exist; `SessionsPage` offers
  neither, and [refinements §4](22-walkthrough-refinements.md) has R9 as *"a
  small client stage over routes that exist"* with no phase.
- **Edit a block and re-run** — [10 §3](../10-ui-surfaces.md)'s sentence,
  which [P3 §1.8](15-p3-implementation.md) sent to P6 and
  [P6 §1.8](18-p6-implementation.md) answered as a different question. P3's
  diagnosis stands: no block-override hook, and no field on the record in which
  to say a block was overridden.

**Three absences stacked, and any one of them alone would keep the sentence
unchangeable.** No editor; no object for an editor to open; no session-level
path around either. §2 is one stage per absence, in dependency order.

### 0.3 What P7 took since, and what this phase collects conditionally

**Taken by P7 on branch `p7`, and not this phase's** — checked so the revisit
does not find them twice: voice and dispatch as optional session fields, the
session and step model overrides, and the role-binding editor (P7.3); the
input-kind selector and R11's suggested actions (P7.9); the guidance one-click
refill of [25 C14](../25-open-questions.md) (*"lands in this phase unless
somebody moves it"*, P7 §0.1); the setup wizard and the `setups/` kind's writer
(P7.4); and the two false deferrals P7 §0.1a struck — the context-window surface
and the advisory marker — which were already built.

**P7's, until P7 closes without them — then this phase's without a second
routing.** Each is something P7's document calls its own and no P7 stage carries
at the time of writing; the rule is that this document strikes the item if P7
builds it and absorbs it otherwise, at the revisit, with the date.

1. **Browsing, previewing and switching a pack mid-session** — P7 §1.10's
   *"P7 keeps the surface"*. Absorbed as P7B.2's switch (§1.4).
2. **Any session-settings surface** — P6B §4's routing to P7.2, whose text is
   the cast panel. Absorbed as P7B.2 entire, over whatever P7.3 built.
3. **A treatment editor for hook authoring** — P7 §0.1a: *"Either P7.5
   inherits an editor … or the whole stage is exercised through hand-edited
   JSON."* P7 chose JSON. Absorbed as P7B.3, which is why hooks are read-only
   there at minimum (§1.5): the panel that makes a pool authorable is P7.5's
   and P11.5's, and this phase's editor is the object beneath it.

### 0.4 The bar, and the line it must not cross

**Usable, not complete.** Every editor here is the [10 §11.2d](../10-ui-surfaces.md)
minimum — *create, rename, delete, and the durable core … with everything else
visible and read-only* — on the P1 precedent, real write path and no assist.
The field-assist contract, image slots, provenance display and the entry-level
exchange are [P11.2](27-p11-implementation.md)'s and stay there. A stage in
this phase that starts building assist has crossed the line, because the reason
this phase exists is that nobody can change one sentence, and assist is a way
of writing sentences faster.

**And the same discipline [P6B §0.3](20-p6b-playable.md) held.** This phase
touches the record in one place at most (§1.1), and if that decision comes out
as *no record change*, the phase touches it nowhere. A phase about surfaces that
grows a schema is a phase that has started being P8.

---

## 1. Decisions this plan has to make

### 1.1 What a session's preset is after creation

[P4 §1.9](16-p4-implementation.md) decided *copy, never link* for the reason
`sessions/types.ts` states: *editing a preset must not silently change an
ongoing game* ([03 §8](../03-data-model.md)). [P6B §4](20-p6b-playable.md) then
declined to add a route for changing it because doing so *"is a question about
what a session's preset is"*. This is that question, and it has two parts.

**Switching is a new copy, and the old one is the record's to remember.** A
switch replaces the session's copy with a fresh clone of another pack; the
turns already taken keep the blocks they were assembled from, because the turn
record holds them — which is what compare reads, and what [10 §3](../10-ui-surfaces.md)'s
*"the same turn before and after a preset change"* has always meant. **Lean:
the pack stays a session field and not a channel.** [06 §4](../06-modes-and-turn-pipeline.md)'s
channels are story state — things a turn can change and a rewind must restore.
A pack is configuration: the runner reads it, no step writes it, and a rewind
that silently restored an older pack would surprise more people than one that
does not. The cost, stated: **rewinding past a switch does not un-switch**, and
the workbench has to say which pack each turn used rather than let the reader
assume the current one. The revisit confirms this against what P7.3 did with
voice and dispatch, which are the same shape of question — *session field whose
absence means the mode's value* — and were decided the same way.

**Editing the session's own copy in place is the same operation as switching
to a pack of one.** Once the copy is addressable through the settings panel,
changing a block's text or a priority there is a write to the session, not to
the library, and the library object it was copied from is untouched — the rule
above holds by construction. What the copy needs that it does not have is a
**back-reference**: `presetId` is recorded only when the create form named a
library preset, so a session on the default has no way to say where its pack
came from. §2's first stage gives the default an id, which closes that.

**[OPEN for the revisit]:** whether the *switch* is recorded on the session as
an event with a turn id — *switched at turn 41* — so that the workbench can
render a boundary, or whether *each turn's record names its pack* is enough. The
second is cheaper and is what the record already nearly does; the first is what
a reader scrolling a long session will ask for.

### 1.2 The built-in pack becomes an object, and where it lives

The mode needs `assembly.defaultPreset` as a value regardless — P7.0 moved the
constant behind the SDK and nothing here moves it back. What is missing is a
**library address** for it, so that it lists, opens, links from the workbench,
and can be copied the way [10 §5](../10-ui-surfaces.md) says a system object is
copied: *"Read-only system objects show a Copy to my library action in place of
edit — which forks a real copy they own"* ([09 §4.3](../09-server-multiuser-deployment.md)).
That action has never been built for anything, because nothing has ever been
in the system library to copy.

**Two ways, and the lean is the one that adds no third scope.**

- **Materialise at boot.** The server writes each loaded mode's default pack
  into `system/library/presets/<mode>/` when it starts, regenerated every
  start, never hand-edited (a hand edit is overwritten, which is what
  *shipped* means). It then has a folder, an index row, a `source: 'system'`
  badge, and refuses edit and delete through the code that already refuses
  them for every system object (`library.ts`'s *"System library objects cannot
  be edited."*). The watcher sees an ordinary file. **Lean.**
- **A virtual `source: 'mode'`.** List and detail queries learn a third origin
  that reads from the loaded modes rather than from disk. No file, no boot
  write — and a scope every list endpoint, every badge, every filter and
  [polish §4](06-polish.md)'s panels have to learn, for one object per mode.

**What the boot write has to get right, since `library.ts` says the system
library is shipped empty and P1 built the merge against nothing:** the id is
the mode's, stable across restarts (`SCENE_PRESET.id` already is, fixed for
exactly this reason); the write is atomic like every other; a mode that stops
being loaded leaves its folder behind rather than deleting it, because a
session may still name it; and the index's rebuild-equals-incremental gate has
to hold with the folder present, which is a test rather than a hope.

**The copy is the first fork in the app.** `provenance.source` and
`GeneratedFieldProvenance` are already on every portable object; what the fork
records is *copied from which object, at which content hash*, so that a later
*your copy is behind the shipped one* is answerable — not built here, but not
foreclosed either. The conflict dialog's *save as a copy* is the existing
precedent for a copy that lands in the user's library; this is that operation
with a system object as its source.

### 1.3 The editor's shape is the schema's shape, and blocks are the list

[10 §11.2d](../10-ui-surfaces.md) settled the lorebook entry editor by reading
the schema's own comment banners as disclosures and leaving the field order
verbatim. The preset schema ([04 §8](../04-schemas.md)) reads the same way, and
the editor should too: `name`, `blurb`, `modes`, `tags` at the head; `blocks` as
the body; then `budget`, `params`, `modelHint`, `variables`,
`difficultyLevels`, `provenance`, `compat`.

**Blocks are a reorderable list, and the two block kinds edit differently.** A
**text** block's `template` and `wrapper` are the prose the author came to
write, and they are the textarea. A **slot** block's `source` is positional —
*where the engine's content goes* — and is shown, not typed: what is editable
on a slot is `priority`, `enabled`, `placement`, `advisory`, `omitWhenEmpty`,
`appliesTo`, and `source.outlet`, which is the field [P5 §3](17-p5-implementation.md)
recorded as settable by nothing and repairable only by hand. Reorder is
`ui/reorder.ts`, already built for entries. Adding a block offers the two kinds
and, for a slot, the `SlotSource` arms the assembler knows — read from the
schema rather than listed in the client, so P7.1's new arms appear without a
second edit.

**`params` and `budget` are numbers with meanings the workbench already
explains.** `temperature` and `maxTokens` are the two the walk sheet needs
(C3); the rest of `GenerationParams` renders as the schema has it, and
[polish §8](06-polish.md)'s note — five sampler settings the adapter drops —
stays a polish item about the adapter, with the editor showing every field the
schema carries and the workbench's call view showing which reached the
provider. `budget.contextShare` and `reserveOutputTokens` get the same
treatment; a preset that spends more than it has is a budget verdict the
workbench already renders, not an editor error.

**`variables` and `difficultyLevels` are editable from the first version**,
because P7.8 consumes levels and P4 imports variables that *"do nothing yet"*
— an editor that showed them read-only would be the placeholder
[work plan §2.2](01-work-plan.md) forbids.

**Create is a copy, not a blank.** [10 §11.2d](../10-ui-surfaces.md)'s *the
first editor owes create* is honoured, but *New preset* starts from a mode's
default pack rather than from an empty block list, because an empty block list
is a session that assembles nothing and a user would learn that at their first
turn. The same rule [P4.5](16-p4-implementation.md) applied to actors —
a blank-page dead end teaches worse than no button — applied to a kind where
the blank page is silent rather than empty.

### 1.4 The session-settings surface, and what P7.3 already put on it

[06 §7.2](../06-modes-and-turn-pipeline.md): *"Both axes from §3 exposed
directly in the session settings … two visible controls with plain-language
labels."* That is P7.3's, and on branch `p7` it is a stage. What P7.3 does not
carry is everything else a session's settings are: **the pack** (which one, a
link to its object, and switch — §1.1), **the parameters** (the session's own
`params`, as an override the record can see), **the session's own copy**
(editable in place, §1.1), and **housekeeping** — rename exists, archive and
delete have routes and no control, and `RenameSession`'s own docstring says a
second rename form *"would start to be the session-settings surface that
P6B §4 puts inside P7.2's scope"*. This is that surface, built once.

**One panel, not three.** `LorePanel` is a disclosure on the play page holding
treatment and books; P7.3's two controls will need a home; this phase adds the
pack, the parameters and the verbs. Three disclosures in a column is the shape
[10 §1.1](../10-ui-surfaces.md) warns against — density is the position, but
density with a structure. **Lean:** one *Session* panel with the existing lore
selection as its first section, P7.3's axes as its second, the pack and
parameters as its third, and the verbs at the foot; each section saving on its
own, as `LorePanel` does, because a single Save over four stores with different
semantics is what [10 §15.1](../10-ui-surfaces.md) refused for preferences.
The revisit decides against what P7.3 actually built.

**The route.** `PATCH /api/sessions/:id` grows `preset` (an id to switch to, or
the literal `default`) and `params`, or the session gains a `PUT …/preset`
sibling of `PUT …/lore` and `PUT …/cast`, which is the shape the last two
selection surfaces took and the one whose body is the object rather than a
diff. The second is the lean, for the same reason [P6B.0](20-p6b-playable.md)
gave: *ids, not objects* for links, and the whole document for the thing the
session owns. The stale check applies — a hand edit to `session.json` while the
panel is open is refused, not clobbered ([09 §4.4](../09-server-multiuser-deployment.md)).

### 1.5 The treatment editor is prompt handling

A treatment is *how this world is handled here*: `framing` is injected every
turn through `se.treatment`; `tone.styleNotes`, `pov`, `tense` and
`contentRating` are advisory prose the pack reads; `writingSamples` fill the
samples slot; the cast's `billing` says who is the persona option and who is the
narrator option. Every one of those reaches the prompt. So the treatment editor
belongs with the preset editor rather than with P11, and it is the smaller of
the two: a form over a short schema, plus the writing-sample row the actor
editor already has, plus `CastEntry` rows over actors the user owns.

**Hooks are visible and read-only at minimum.** P7.5 builds the hook panel and
P11.5 tunes it; what a treatment carries is the *authored* pool, and P7's audit
chose hand-edited JSON for it. This editor shows the pool as the schema has
it and lets the fields P7.5 leaves editable be edited — decided at the revisit
against what P7.5 shipped, not guessed here.

**Create is [10 §5.2](../10-ui-surfaces.md)'s verb.** *New treatment on this
world* from a lorebook's page, pre-linked, is the ladder [10 §5.1](../10-ui-surfaces.md)
says is learned by starting a second thing under a thing you already have. The
lorebook page gains one button; the treatment editor opens with the link set.

### 1.6 Edit a block, through the pack

[10 §3](../10-ui-surfaces.md) wants *edit a block and re-run*.
[P3 §1.8](15-p3-implementation.md) found three mechanical reasons it could not
be built then and handed it to P6; [P6 §1.8](18-p6-implementation.md) answered
*which reply an edit changes* and left the override itself with nobody.
Two shapes:

- **A one-off override recorded on the turn** — a new field on `ModelCall` or
  `Turn` saying *this block was replaced by this text for this run*. Honest,
  and a record change, which §0.4 says this phase does not make.
- **An edit to the session's copy, then a reroll.** §1.1 makes the session's
  pack editable in place; §1.4 gives it a surface; reroll already exists. The
  workbench's block table gains *Edit this block in the pack*, which opens the
  session's copy at that block. The re-run is an ordinary sibling, compare
  shows the difference, and nothing on the record is new. **Lean.**

The second gives up one thing: an edit is durable rather than one-off, so a
user who wanted *just this once* has to edit back. The first is refused until a
finding asks for it by name, because the durable version is what a person
reaching for the workbench to fix a prompt actually wants — the sentence that
was wrong stays wrong on the next turn otherwise.

### 1.7 Three comments name the wrong phase, and this phase corrects them

The same repair [P2B](10-p2b-provider-configuration.md) made to `bindings.ts`
when its *"which is P7's"* turned out to be P2B's: `modes/scene/preset.ts`
(*until P7*), `routes/sessions.ts` (*P7 keeps the surface*), and
`play/SessionsPage.tsx` (*not changeable afterwards*). Each is corrected in the
stage that makes it false, not in a sweep at the end — a comment that names a
phase is a deferral, and [manual testing §10.1](05-manual-testing.md) is what a
deferral pointed at the wrong place turns into.

### 1.8 What this takes from polish, and what it leaves

[Polish §4](06-polish.md)'s per-kind panels: **Treatments and Presets arrive
here**, because create arrives with the kind's editor and the panel is what
renders the button; Setups and Packages stay with polish until theirs have a
phase, and the shared machinery stays specified there. [Polish §8](06-polish.md)'s
sampler settings: the *adapter* half stays polish, the *surface* half is
§1.3's. [Polish §1](06-polish.md) and [§2](06-polish.md) landed already and are
what the editors' read-only fields render through. [Polish §10](06-polish.md)'s
*New actor is a button, not a form* is the shape *New preset* and *New
treatment* copy.

---

## 2. Stages

In dependency order: the object, then the editor that opens it, then the
surface that switches it, then the editor for the other half of the prompt,
then the workbench affordance that uses all of it, then the sweep.

### P7B.0 — The pack as an object

§1.2 built: each loaded mode's default pack materialised into the system
library at boot, with the rebuild gate holding; a session created without a
named preset records the default's `presetId`; the workbench's block row for a
preset source links whenever there is an id, which is now always; *Copy to my
library* on every system object, as [10 §5](../10-ui-surfaces.md) specifies it,
recording where the copy came from; the create form's picker lists the default
by its name rather than as *the mode's own*. The `preset.ts` comment corrected.

*Ends at:* the `se.instruction` row in the workbench links to an object, and
that object has a *Copy to my library* button.

### P7B.1 — The preset editor, minimum

§1.3 built: `/library/presets/:id/edit` and `/library/presets/new`,
`EDITOR_ROUTES` gaining its third entry and `fields.test.ts` flipping the
negative; blocks as the reorderable list with the two kinds editing as §1.3
says; `outlet` settable; `params`, `budget`, `variables` and `difficultyLevels`
editable; everything else visible and read-only; the history panel, the
unsaved-changes guard and the 412 dialog inherited from the lorebook editor;
the same `validate()` the write path runs. The Presets panel of
[polish §4](06-polish.md) with its *New preset* button, per §1.8.

*Ends at:* the demo's first half — the sentence changed in the browser and read
in the rendered messages.

### P7B.2 — The session-settings surface

§1.1 and §1.4 built: the route; the panel, absorbing lore selection and P7.3's
controls if they exist; the pack shown, linked and switchable; `params`
overridable; the session's own copy editable in place; archive and delete from
the session list and the play page, delete going to trash like every delete.
The `sessions.ts` and `SessionsPage.tsx` comments corrected.

*Ends at:* C3 and D11 walked with no text editor open.

### P7B.3 — The treatment editor, minimum

§1.5 built: `/library/treatments/:id/edit` and `/new`; framing, tone, samples,
cast billing, lorebook links; hooks as P7.5 left them; *New treatment on this
world* from the lorebook page; the Treatments panel with its button.

*Ends at:* a framing sentence typed in the browser arriving in the next turn's
`se.treatment` block.

### P7B.4 — Edit a block, through the pack

§1.6 built: *Edit this block in the pack* on the workbench's block table,
opening the session's copy at that block; reroll from there; compare reading
the result. No record change.

*Ends at:* [10 §3](../10-ui-surfaces.md)'s sentence answered, and
[P3 §1.8](15-p3-implementation.md)'s three mechanical facts re-stated as
*still true, and no longer in the way*.

### P7B.5 — The sweep

`docs/README.md`'s *"the four kinds that have no editor"* becomes two;
[manual testing](05-manual-testing.md)'s C3 and D11 rewritten to the UI path
with their old wording struck; the [10 §5](../10-ui-surfaces.md) create rule's
consequence — *New* on four shelves rather than two — checked against every
panel; and if P7 has merged, `node tools/renumber-docs.mjs --plan` and the
move this document's status line promises.

*Ends at:* the demo.

---

## 3. Verification — the P7B exit gate

Written to [manual testing §0](05-manual-testing.md)'s two-tier gate from the
start rather than brought up to it later: the critical list is derived by §0's
criterion on the day the phase closes, and the remainder extends the standing
list as a sitting. The candidates for the critical list are marked, because each
is a claim that compounds — a pack that cannot be opened, a switch that lies
about history, a save that clobbers a hand edit.

1. **Critical candidate.** Copy the Scene default from the library, change the
   narrator sentence, start a session on the copy, take a turn, and read the
   changed sentence in the rendered messages. No JSON anywhere. This is the
   phase's whole claim and a person walks it.
2. The default pack has an object: a session created with no preset named
   records a `presetId`, and the workbench row links. *Automated.*
3. The system copy refuses edit and delete and offers *Copy to my library*; the
   copy is the user's, records its source, and edits to it leave the system
   object untouched. *Automated.*
4. A slot block's `outlet`, set in the editor, positions an outlet-addressed
   lore entry — [P5 §3](17-p5-implementation.md)'s standing defect retired.
   *Automated.*
5. **Critical candidate.** Switch the pack mid-session and take the same turn
   again: the new turn assembles from the new pack, the old turn's record still
   names the old blocks, compare shows the difference, and a rewind past the
   switch behaves as §1.1 documents. *Automated, and walked once.*
6. C3 without a text editor: `maxTokens` set to ten from the settings panel,
   the next call reports `outcome: 'truncated'`. *Walked; retires C3's "no UI
   for this".*
7. A treatment's framing edited in the browser reaches the next turn's
   `se.treatment` block. *Automated.*
8. Archive and delete a session from the UI; delete moves the folder to trash.
   *Automated.*
9. `fields.test.ts`'s negative flips for treatments and presets and holds for
   setups and packages; *New* appears on exactly the shelves with an editor.
   *Automated.*
10. **Critical candidate.** Hand-edit the session's copied pack on disk while
    the settings panel has it open; the panel's save is refused with the
    conflict dialog, not accepted over the hand edit. *Walked* —
    [09 §4.4](../09-server-multiuser-deployment.md)'s claim, for the one object
    the walk sheet has always edited by hand.
11. The rebuild-equals-incremental gate holds with the materialised system
    folder present, and a restart regenerates it without a spurious history
    version. *Automated.*
12. **Only a person can walk:** play a session on a pack authored entirely in
    the browser, several turns, and judge whether the narrator changed in the
    way the edit intended. A sitting, not a step.

**And the standing line from [work plan §2.3](01-work-plan.md): no phase exits
with configuration that has no surface.** This phase is that line being paid
for the prompt pack, nine phases late; the check here is that it does not
generate new debt of the same kind — every field the editors add is a field
some surface can set, and every one the schema carries that they do not set is
listed in §4 with the phase that will.

---

## 4. Out of scope, deliberately

The field-assist contract, image slots, provenance display and entry-level
exchange ([10 §11](../10-ui-surfaces.md) — [P11.2](27-p11-implementation.md)'s,
across the editors this phase creates as much as the ones before it); **the
package editor** (P11.2, where [manual testing §10](05-manual-testing.md) placed
it on 2026-09-11 — a bundle's editor is a picker over the user's objects and
belongs with the exchange work); a setup editor beyond P7.4's wizard, which
*is* the setup's editor by [10 §6](../10-ui-surfaces.md)'s design; personal
connections and bindings ([10 §15.1](../10-ui-surfaces.md) — [P10.3](26-p10-implementation.md));
the hook panel and its tuning (P7.5, P11.5); a provider-specific escape hatch
in `params` ([04 §8.5](../04-schemas.md)'s open question, and it stays open);
the prompt *preview* as a separate feature, because the workbench's preview
subject already assembles without sending; preset **import** and the macro
namespace (P4's, and finished); Freeform's own pack (P7.9 writes it; this phase
makes it openable, which is a different verb); and difficulty *semantics*
(P7.8 — this phase makes levels editable and says nothing about what they
mean).

**And one thing that is not out of scope but reads like it:** the record. §1.1
leans to no change and §1.6 refuses the override field, so the phase touches
`session.json`'s shape and nothing under `turns/`. If the revisit reverses
either lean, that is a schema decision and gets the sentence
[work plan §2.2](01-work-plan.md) asks for, not a field added on the way past.

---

## 5. The honest size, and what only the revisit can settle

**The preset editor is the large piece**, and the honest comparison is the
lorebook editor: [P5.1](17-p5-implementation.md) built the minimum and
[P5.7](17-p5-implementation.md) came back for what the minimum missed. Expect
the same shape — a list editor over two block kinds, with the schema's
disclosures, is more than a form. Everything else here is smaller than it
reads: the treatment editor is a form over a short schema plus two row types
that exist; the session-settings panel is one disclosure more once P7.3's
controls exist, and two if P7 closes without them (§0.3); edit-a-block is one
button and one route once §1.1 is built.

**P7B.0 is the stage most likely to surprise**, because it is the only one
that touches the server's idea of the system library — a scope P1 built the
merge for and nothing has ever written to. The rebuild gate, the watcher, and
the *shipped empty* comment in `library.ts` all have to be re-read against a
folder that appears at boot.

**Three things only the revisit can settle:**

- **Which of §0.3's items P7 closed with.** The document strikes what P7 built
  and absorbs the rest, dated, before any stage opens.
- **Where `SCENE_PRESET` lives after P7.0, and what sitting K's K4 found in
  it.** P7's document says K4 exists to interrogate the pack and that P6B.1
  already moved it once; if K4 changed its shape, P7B.0 materialises a
  different object than this document describes, and P7B.1's editor opens
  it.
- **§1.1's [OPEN]** — whether a switch is an event on the session with a turn
  id, or each turn's record naming its pack is enough. Cheap either way, and
  the reading view (P11.1) is the consumer that will notice which was chosen.

**What it would cost to cut.** The demo's first half — copy, edit, play, read —
is P7B.0 and P7B.1 and cannot be cut without the phase being about nothing. The
switch (P7B.2) is what makes compare an instrument rather than a curiosity and
is what the walk sheet has wanted since P3. The treatment editor (P7B.3) and
the block affordance (P7B.4) are the two that could slip to P11.2 and P11.0
respectively without the phase failing its own claim — and if either slips, it
goes there by name, on the day, in [manual testing §10](05-manual-testing.md).
