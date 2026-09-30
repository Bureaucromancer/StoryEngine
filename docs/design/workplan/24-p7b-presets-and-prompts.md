# 24 — P7B implementation plan: presets, prompt handling, and the surfaces the server already has

**Status: merged into `main` 2026-09-15 at `e7d6dee`, and open.** All ten stages
are committed and each carries a *Done* block in §2 naming its commit. **The
merge is not the close** — [manual testing §7](05-manual-testing.md) says a phase
closes when its critical list is walked, and P7B's is not: gate rows **1, 5, 10
and 14** plus the judgement sitting at row **12** are
[sitting M](05-manual-testing.md) there, which is where a critical list has to
live to get walked. Results go into §3.2 when they exist, **never into §3's
seventeen steps**, which [§0](05-manual-testing.md)'s first honesty condition
forbids.

~~**Filed out of order on purpose.**~~ ***Moved to 24 at
[P7B.5](#p7b5--the-sweep), 2026-09-14, which is what the paragraph below said
would happen.*** Its place is after [P7](23-p7-implementation.md) and before
[P8](25-p8-implementation.md), ~~which is 24~~ **and it is now there**; P8
through P11 each moved up one and every citation to them was repointed by the
script. Written 2026-09-11 at `46bec98`; the original reasoning is kept because
it is the argument for filing a document at the wrong number rather than waiting:

> Taking that number today renumbers P8 through P11 and repoints every citation
> to them — including the ones inside the P7 document that branch `p7` is
> editing — so it sits at the first free number instead. `PLAN_ORDER` in
> [`tools/renumber-docs.mjs`](../../../tools/renumber-docs.mjs) already holds its
> real position; one scripted run after P7 merges moves it, and nothing cites a
> work-plan number, so the move costs nothing ([README](README.md)).

*The move cost two defects in the script, both found by running it and neither
findable without: a second copy of the slug-to-name table that had already
drifted — it would have rewritten every `[28 §x]` citation of **this** document
to `undefined §x` — and a root-relative test that read a sibling citation as a
path from the repository root and rewrote three thousand of them into links that
resolve nowhere a reader stands. A script kept in the repository to be run again
is only as good as its first real run says it is.* Format follows
[P1](07-p1-implementation.md); citations follow the corpus convention.

***Widened 2026-09-14 by a second sweep, and the two halves are one phase.***
A documentation pass looking for pre-1.0 commitments no phase owns found
seventeen — the register is [P11 §0.1](28-p11-implementation.md) — and five of
them turned out to be this document's finding wearing different clothes. §0.5 is
the argument for folding rather than filing them beside this one, and it is
short: the sentence this phase was written around and the sentence that sweep
was written around are the same sentence from two ends.

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

**And, since 2026-09-14, the four surfaces the second sweep found in the same
position** — built on the server, unreachable from the browser, and deferred to
a phase that never took them: **the setup and package editors**, which complete
the six library kinds; **the workbench pointed at a turn the head has passed**;
**the import quarantine's listing**; and **home as a prototype** that shows the
changelog and nothing else. Session archive and delete were already here, on
P7B.2's panel, and the second sweep only sharpened why they are worth the line
(§0.5).

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
for P7 and the wrong end state for 1.0. Why not P11: [P11.2](28-p11-implementation.md)
applies [10 §11](../10-ui-surfaces.md) *across every editor*, and
[P11 §1](28-p11-implementation.md) says in as many words that the size of that
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
~~voice and dispatch as session fields,~~ the session and step overrides of
[19 §5.1](../19-tech-stack.md), and the role-binding editor; not the pack, not
`params`. *Corrected 2026-09-29: P7.3 deferred voice and dispatch to P7.9, whose
record never mentions them; they became session fields at
[P14.0](31-p14-scene-and-session-import.md) ([P14 §0.6](31-p14-scene-and-session-import.md)).*
P7's §4 does not list an editor as out of scope, so it is neither in
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
does not find them twice: ~~voice and dispatch as optional session fields,~~ the
session and step model overrides, and the role-binding editor (P7.3); the
input-kind selector and R11's suggested actions (P7.9); the guidance one-click
refill of [25 C14](../25-open-questions.md) (*"lands in this phase unless
somebody moves it"*, P7 §0.1); the setup wizard and the `setups/` kind's writer
(P7.4); and the two false deferrals P7 §0.1a struck — the context-window surface
and the advisory marker — which were already built. *Corrected 2026-09-29: voice
and dispatch were not taken. P7.3 deferred them to P7.9, whose record never
mentions them, and no session field existed until [P14.0](31-p14-scene-and-session-import.md)
added both ([P14 §0.6](31-p14-scene-and-session-import.md)).*

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
exchange are [P11.2](28-p11-implementation.md)'s and stay there. A stage in
this phase that starts building assist has crossed the line, because the reason
this phase exists is that nobody can change one sentence, and assist is a way
of writing sentences faster.

**And the same discipline [P6B §0.3](20-p6b-playable.md) held.** This phase
touches the record in one place at most (§1.1), and if that decision comes out
as *no record change*, the phase touches it nowhere. A phase about surfaces that
grows a schema is a phase that has started being P8.

### 0.5 The second sweep, and why its findings are this phase

***Added 2026-09-14.*** A separate documentation pass went looking for pre-1.0
commitments no phase owns, starting from the observation that four of the six
library kinds have no editor and asking whether that was the only one of its
shape. **It was not; there are seventeen**, and the register is
[P11 §0.1](28-p11-implementation.md).

**Five of them belong here, and the reason is that they are this document's §0.1
from the other end.** §0.1 traces a *forward* chain: six documents each sent the
preset editor to the next phase, and the chain terminated in nobody. The second
sweep found the *backward* version of the same failure:

> **The server half shipped early, and no phase since had a reason to open the
> client file.**

[P7 §0.1a](23-p7-implementation.md) had already named that mechanism while
diagnosing two instances of it. There are six. **And the sharpest is not even a
missing call:** `SessionsPage` has called `renameSession` since P2 — a `PATCH`
to `/api/sessions/:id` — and **the same handler has accepted `{ archived }` the
whole time.** Somebody opened that file, added a control, and the capability one
field away went unbuilt, because nothing in the repository was in a position to
mention it.

*Two chains, one phase.* A deferral that travels forward until it runs out of
phases and a capability that never gets a caller are the same defect in a
corpus that routes by document: **both are things nobody was ever assigned to
look at.** Splitting them into two phases would have made each smaller and made
the pattern invisible, which is the one thing this document's §0.1 exists to
prevent.

**What the fold adds is four stages and one check.** The stages are P7B.6
through P7B.9. The check is not a stage and matters more than any of them:
**nothing in the suite asserts that a shipped route has a caller.** Five of this
phase's items are routes whose only callers are their own tests, green in CI the
whole time, for up to six phases — and the instrument that found them was a
person reading documentation, which is the most expensive one available. §3
carries it, and [manual testing §9](05-manual-testing.md) carries it as well,
because it outlives this phase.

**Two of the second sweep's findings were deliberately not folded**, and both
are recorded in §4 with the decision that put them there: **search** stays
[P11.1](28-p11-implementation.md)'s, and **the full home** stays a 1.0 feature
expected immediately before the beta cut-over.

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
assume the current one. ~~The revisit confirms this against what P7.3 did with
voice and dispatch, which are the same shape of question — *session field whose
absence means the mode's value* — and were decided the same way.~~ *Corrected
2026-09-29: P7.3 did nothing with voice and dispatch; it deferred them to P7.9,
whose record never mentions them ([P14 §0.6](31-p14-scene-and-session-import.md)).
They are the same shape of question, and [P14.0](31-p14-scene-and-session-import.md)
answered it the same way — session fields — with one refinement this lean did not
need: absence means the mode's `legacy` value for a session written before the
fields existed, because Scene's declared values move in P14.*

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

### 1.9 The setup and package editors, and what makes them different

***Added 2026-09-14 with §0.5's fold.*** Both complete the six kinds; neither is
another preset editor.

**A setup already has a create path and no edit path**, and the distinction is
[P7.4](23-p7-implementation.md)'s: `SessionsPage`'s *Save as a setup* writes a
`setups/` object, and `library/fields.ts` says in its own docstring why that is
not an editor — *"`setups` stays out of these tables until it has an editor."*
A saved Setup is readable on the generic shelf and nowhere changeable. **So the
setup editor is the smallest of the four**: the create side is done and is the
*right* shape — naming a configuration you already played rather than filling in
a blank one — and what is missing is opening one and changing a field.

*This corrects [P11.2](28-p11-implementation.md), which read that P7.4's wizard
**is** the setup's editor by [10 §6](../10-ui-surfaces.md)'s design. It is the
setup's **creator**; the code is explicit about the difference.*

**A package's editor is a picker, not a form** — a bundle is an arbitrary set of
objects ([03 §7](../03-data-model.md), [04 §9](../04-schemas.md)), so its editor
is a selection over what the user owns. **It was [P11.2](28-p11-implementation.md)'s
until 2026-09-14 and the argument for keeping it there undercut itself**: *across
every editor* cannot apply to an editor that does not exist, which is a reason to
build it before the sweep rather than inside it.

***And the honest limit, because it is an objection to the whole item.*** A
package editor with no `.sepack` import or export is a form over a bundle nobody
can move, and `.sepack` is **not** in this phase — [P4](16-p4-implementation.md)'s
*"P11-ish"* is the corpus's only assignment for it and it is routed beside
[P11.10](28-p11-implementation.md)'s session export, since both freeze a format
and nothing else here touches one. So the package editor lands able to *make* and
*describe* a bundle and not to *send* one. That is a real half-measure and it is
the one this phase accepts: the alternative is a sixth library kind that stays
uncreatable for another two phases.

### 1.10 Home arrives as a prototype, and the full version is deferred by name

***Added 2026-09-14, and it reverses a placement made three days earlier.*** The
first sweep put home at **[P10.4](27-p10-implementation.md)**, beside the
gallery. It is **deferred instead**, and the terms are recorded rather than
translated: **not core-alpha work**; still nominally a 1.0 feature, expected
*immediately before the cut-over to feature-complete beta*, **and it may be
pushed further out than that**. [Polish §5](06-polish.md) carries the wording,
where the item has always lived.

**What lands here is the smallest thing that makes the address real**: `/` stops
being a redirect, the wordmark points at it, and the page shows the changelog.
Nothing else — and that fence is the stage, because
[polish §5](06-polish.md) already says at length that a home page attracts every
idea anybody has ever had about a dashboard.

***Revised 2026-09-15, and the fence is where it was.*** The changelog is
rendered as a document rather than dumped as text, and the release history lives
in the workbench beside it. That is this one thing done properly, not a fifth
thing; the four deferred panels are untouched. P7B.9's *Revised* note below
carries the argument, the measured cost of the renderer, and the check against
the accretion this section is guarding against.

*The value is not the changelog.*
[`router.tsx`](../../../packages/client/src/router.tsx) throws a redirect from
`/` under a docstring reading *"`/` redirects until home is built… every link
resolves to the address that will still be correct after home lands"*, and
[`Shell.tsx`](../../../packages/client/src/Shell.tsx)'s wordmark points at the
library under a comment reading *"It becomes home once home exists
([10 §2.2](../10-ui-surfaces.md)) — the wordmark is the arrival affordance, and
arrival is not the library's job."* **Two comments describing a future.** This
stage makes them describe the present, after which the full home is a page that
gains sections rather than a route that has to be introduced — and
[polish §4](06-polish.md)'s item 4, which takes away the mixed table that
answers *what was I doing?* today, stops waiting on it.

**Where the changelog comes from: build-time, not a route.** `CHANGELOG.md` sits
at the repository root and nothing serves it. A build-time import wins on three
counts rather than convenience: **a changelog shown by a running build should be
that build's**, which is the same category of fact as the version string
`AboutBuild` already renders from the auth payload; **a route invites a question
nobody needs to answer**, namely who may read it and whether it exists before
sign-in; and `tools/release.test.ts` already pins `CHANGELOG.md`'s version
against three other files, so a fourth consumer inherits that guarantee. *The
cost, stated:* the bundle grows by the changelog — sixteen kilobytes today — and
[20 — client loading](../20-client-loading.md) is what measures whether that
matters, at [P11.0](28-p11-implementation.md).

### 1.11 What the fold deliberately did not collect

§0.5's sweep found seventeen and this phase took five. **The rule applied is
§0.5's** — a client surface over a server capability that already ships — and
four near-misses are named so the revisit does not re-litigate them:

- **Search** ([10 §14](../10-ui-surfaces.md)) fits the rule exactly and is
  **[P11.1](28-p11-implementation.md)'s anyway**, decided 2026-09-14: it and the
  reading view are read-surfaces over the same data and share a print story,
  which is a better grouping than *shipped route with no caller*. `README.md`
  already promises it to a reader, so the deferral is on the clock.
- **Openings, and the seed → expand → edit → accept → promote loop**
  ([03 §6](../03-data-model.md), **PORT** in [triage](02-triage.md)). By subject
  it belongs here — `play/setup-from-form.ts` lists `openings` among what has no
  control while naming owners for its neighbours, and `fromSeedId` has shipped
  since P1 with no writer anywhere. **What keeps it out is the expand loop**,
  which is a model call and a new interaction rather than a surface over a
  finished route. A candidate for the revisit, with that cost named.
- **[10 §9](../10-ui-surfaces.md)'s live turn view** — the collapsed in-flight
  line outside the workbench. Genuinely this phase's shape, and held because it
  overlaps [polish §11](06-polish.md) and
  [R4](22-walkthrough-refinements.md), which has no specification at all yet.
  Building one third of a scroll-and-progress story is how the other two thirds
  get built twice.
- **`.sepack` import and export** — §1.9's stated half-measure, routed beside
  [P11.10](28-p11-implementation.md).

### 1.12 What the check found that the sweep did not — 2026-09-14

**A different instrument, which is the whole argument for gate row 17.** §1.11
lists what a *person reading documentation* found and this phase declined to
take. This section lists what nobody found at all until
[`route-callers.test.ts`](../../../packages/server/src/routes/route-callers.test.ts)
walked the route table at P7B.5 — and it is four more routes in exactly the
position §0.5 describes: shipped, tested, green in CI, reachable from nothing.

*The check is the reason this section is short rather than the reason it is
long.* Thirty-one routes came back on the first run; twenty-four of those were
the check being wrong about prefixes and helper-composed addresses, and the
stage record under P7B.5 says how. Seven were real, and two of the seven are
correct absences with an argument already written somewhere:
`GET /api/modes/:modeId`, because `GET /api/modes` carries every mode's whole
declaration and a client holding the list never asks about one; and
`PUT /sessions/:id/cast`, because [06 §8](../06-modes-and-turn-pipeline.md) puts
the persona at setup and §1.6 has `cast.actors` mid-move to channel state, which
`play/LorePanel.tsx` says in as many words.

***The criterion for building one in the sweep rather than owing it***, stated
because a sweep that quietly builds four panels is not a sweep: **build it if
the surface is a control on a page that already exists and the route poses no
design question; owe it if the surface is a page or panel that does not exist,
or if where it goes is a decision.** One of the five passed.

- **Built here.** `POST /admin/accounts/:handle/password` — an administrator
  resetting somebody's password, shipped at P2A with no caller. The absence was
  not cosmetic: an account's folder under `data/users` **is** that person's
  library, so the only repair for a forgotten password was to delete the account
  and make a new one, which costs more than the problem. It is a field and a
  button on a row `AdminAccounts` already draws.
- **Owed: `PUT /sessions/:id/roles`** — a session's model override, which
  [19 §5.1](../19-tech-stack.md) is explicit that *"anyone who wants their own
  key overrides a role without the admin's involvement"*. [P7.3] built the
  route, the resolution layer and the tests, and named where the surface goes —
  *"beside the lore panel's disclosure"* — and built no control. It is a panel
  rather than a control, it needs the account's usable connections and the role
  vocabulary, and §1.4's placement answer predates the session panel this phase
  actually shipped. Routed to [P11 §0.1](28-p11-implementation.md)'s register.
- **Owed: `PATCH` and `DELETE /sessions/:id/refs/:refId`** — renaming and
  removing a named node. [07 §6](../07-branching.md) says *promoting a swipe is
  creating a `BranchRef`* and that *deleting one later deletes a name*; the
  promote half has a control on the play page and the other two have none, so a
  name is creatable and permanent. The surface is the list §6 sends to the
  history strip, which does not exist — the tree visualiser is post-1.0
  ([24 §1](../24-roadmap.md)) but a create with no undo is not what that
  deferral was about. Routed to the same register.
- **Not owed here: `GET /api/search`**, which §1.11 and §4 already route to
  [P11.1](28-p11-implementation.md).

**And one thing the check found that is not a route.** `workbench/address.ts`
linked a writing sample's block to its carrier only when the carrier was an
actor, because *"the other two carriers have no editor page to reach yet"* —
true when written, and false since P5.1 and P7B.3. Corrected in the sweep under
the same criterion: three lines, on a panel that already exists.

---

## 2. Stages

In dependency order: the object, then the editor that opens it, then the
surface that switches it, then the editor for the other half of the prompt,
then the workbench affordance that uses all of it, then the sweep.

***P7B.6 through P7B.9 were appended 2026-09-14 rather than placed in that
order*** (§0.5), **because stages are cited by number and renumbering six of
them to put four in their right place would break live citations to buy
tidiness.** By argument the two editors belong beside P7B.1 and P7B.3, and
**the sweep runs last whatever its number.** Read §2 as P7B.0–P7B.4, then
P7B.6–P7B.9, then P7B.5.

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

#### Done — 2026-09-14, `f37903c`

**The workbench link needed no code at all, and finding that out is the stage's
first result.** `collect.ts` has written `presetId` onto every preset-sourced
block since P4.4 and `workbench/address.ts` has linked whenever there is one;
what was missing was never the link, it was **an object at the other end**. A
stage sized as *wire the link* would have found nothing to wire and concluded
the feature worked.

**`materialiseModePresets` reads before it writes**, so an unchanged restart
touches no file — which is not tidiness but the exit-gate row 11 claim: a write
per boot would append a history version per boot, and a user's revision list for
a shipped object would fill with revisions nobody made. It runs after `Layout`
and before the rebuild and the watcher, so the index meets ordinary files by
either path, and `pnpm test:gate` holds with the folder present.

***And then twenty-three assertions broke, which is the finding worth keeping.***
Every one of them measured *the user's library* as *everything the list route
returned* — `expect(objects).toHaveLength(2)` over a route that merges the
user's scope with the system's, as [10 §5](../10-ui-surfaces.md) says it must.
They were not wrong about behaviour; they were wrong about vocabulary, and they
had been since P1 because the system scope was always empty. `ownObjects()` in
`test-server.ts` carries the distinction and its docstring carries this
paragraph. **Two were upgraded rather than patched** — the merge test, which
wanted the merge it was accidentally asserting away, and the scan-count test,
which now asserts a delta rather than an absolute, because an absolute count of
everything on disk is a number that changes whenever anything ships.

*`encodeObject` gained an export and a docstring naming its one caller outside
`library.ts`, rather than a second copy of the write path in the materialiser.*

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

#### Done — 2026-09-14, `b9dc9b2`, `a8c699f` and `dcd9194`

***The mechanism §1.3 asks for already existed and was already general***, which
is why one stage produced six editors rather than one.
`shared/src/schema/banners.ts` promoted the schema files' comment banners to a
real annotation at P5, and `client/src/library/fields.ts` has derived field
rows, groups, labels and numeric bounds from any schema since — its own
docstring says *"this is not a lorebook feature that other kinds opt into, it is
the general shape."* Only `lorebook.ts` carried banners and only `ByField.tsx`
read them. So `SchemaFields.tsx` is the **write-side twin of a read-side
component that was already written**, and §1.3's *the editor's shape is the
schema's shape* cost a file rather than a phase.

**Three commits, and the middle one is the answer to §4's own worry about
refactors.** `b9dc9b2` extracted the shell (`object-editor.ts`,
`EditorFrame.tsx`, `ConflictDialog.tsx`); `a8c699f` moved the lorebook editor
onto it — 1472 lines to 1187, and the actor editor 754 to 409 — with
`LorebookEditorPage.test.tsx` and `ActorEditorPage.test.tsx` **unedited where
they assert behaviour**; `dcd9194` is the preset editor, which is what the other
two were for.

***The extraction exposed two real defects, which is the argument for doing it
before writing four more editors rather than after.***

- **The 412 dialog said *"The actor changed"* over a lorebook.** Two editors had
  drifted into two dialogs and one of them carried the other's noun. *The first
  fix was worse than the bug*: a `noun` prop interpolated into a sentence, which
  `no-restricted-syntax` refused with the reason it exists — *a sentence
  assembled from fragments cannot be translated*. The dialog takes the whole
  sentence.
- **The two editors disagreed about stamping `provenance.updatedAt`**, and the
  lorebook's comment argued its side. Checked against `library.ts` rather than
  reasoned about: **the server stamps, and it compares the bytes as sent,
  before stamping.** So a client that stamps is a client racing the server's
  own clock for no gain. The shell sends unstamped and `stampUpdated` is deleted
  with a note saying why.

~~**What the preset editor retires by existing:** `SlotSource.outlet` had been
*settable by nothing* since P5 with hand-written JSON as its only repair, and
[P5 §3](17-p5-implementation.md) recorded that as a standing defect for two
phases.~~ *New preset* starts from a shipped pack rather than a blank, because
[P4.5](16-p4-implementation.md)'s *a blank-page dead end teaches worse than no
button* is worse here than for actors: an empty block list produces no error,
it produces a turn that narrates nothing, discovered at play time.

***And that first sentence was false on disk for a day*** — corrected
2026-09-15 at `3287d67`, found by [P8 §0.3](25-p8-implementation.md)'s readiness
audit rather than by anything here. **The editor decided a block was a slot by
reading `source.kind`, which no preset has ever carried**:
[04 §8.1](../04-schemas.md) puts the discriminator on the block
(`kind: 'slot' | 'text'`) and the arm on `source.of`, which is what `collect.ts`
and every shipped pack use. So every slot in every real file rendered as a *text*
block with an empty template box, **the Outlet control appeared nowhere**, and
[P5 §3](17-p5-implementation.md)'s defect was retired against a fixture and
nothing else.

***The part worth keeping is why the test did not catch it.*** The fixture spelled
a slot `{ source: { kind: 'lore' } }` — **invented beside the code it was
checking**, so the two agreed with each other about something neither had put to
the schema. The repair is therefore not only the discriminator: the fixture is
now in the schema's shape and a floor test **validates it with the shipped
`validate()`** before anything else asserts with it. *A fixture the validator
accepts cannot agree with the code by construction, which is the property this
file's other tests were quietly relying on and did not have.*

*This is also the sharpest instance of what [§0.5] is about, arriving from the
other direction: not a surface with no caller, but **a surface whose caller was
its own test**.*

### P7B.2 — The session-settings surface

§1.1 and §1.4 built: the route; the panel, absorbing lore selection and P7.3's
controls if they exist; the pack shown, linked and switchable; `params`
overridable; the session's own copy editable in place; archive and delete from
the session list and the play page, delete going to trash like every delete.
The `sessions.ts` and `SessionsPage.tsx` comments corrected.

*Ends at:* C3 and D11 walked with no text editor open.

#### Done — 2026-09-14, `614e750`

§1.4's route, in the shape §1.4 chose: `PUT /sessions/:sessionId/preset`, the
body being the object rather than a diff, like `PUT …/lore` and `PUT …/cast`
before it. `SessionPanel.tsx` carries the pack switcher, *Maximum reply length*
and the temperature, the session's own copy editable in place, and **archive and
delete** — the second of which had no client wrapper at all and the first of
which was one field on a `PATCH` `SessionsPage` has been sending since P2.

***What is not done, said plainly because the stage text promised it.*** §1.4
says **one Session panel, not three**. There is no such consolidation. The
honest reason is that §1.4 was written against a play page with three panels and
this stage's own work took it to six — lore, dials, hooks, cast, the HUD and now
this — so *consolidate the three* is no longer a description of anything, and
doing it properly is a layout decision about six surfaces rather than a
merge of two. **The debt is written into `SessionPanel.tsx` rather than left in
this document alone**, so the next person to open that file reads it before they
add a seventh.

*C3 and D11's old wordings are struck rather than replaced, per
[§0](05-manual-testing.md)'s rule that a gate step is never edited to match what
was walked — both were walked on the hand-edit path and passed, and the UI path
is a different check of the same claim.*

### P7B.3 — The treatment editor, minimum

§1.5 built: `/library/treatments/:id/edit` and `/new`; framing, tone, samples,
cast billing, lorebook links; hooks as P7.5 left them; *New treatment on this
world* from the lorebook page; the Treatments panel with its button.

*Ends at:* a framing sentence typed in the browser arriving in the next turn's
`se.treatment` block.

#### Done — 2026-09-14, `b55fe9e` — with P7B.6

**Recorded with P7B.6 because they are one commit and that is the finding.**
Once the shell and `SchemaFields` existed, a treatment editor was a
*declaration* rather than a component: `kinds.tsx` holds what each kind is
called, what its blurb says, what its 412 sentence reads and which fields are
shown read-only, and `SimpleEditorPage.tsx` is the page all three share. Three
editors, one file each of description.

**The bar is §0.4's and saying it plainly is part of the work: usable, not
complete.** A treatment's cast rows arrive **shown as stored and not writable**,
which `SchemaFields` renders with the sentence *this editor does not write this
field yet* rather than dropping the field —
[10 §2.1](../10-ui-surfaces.md) forbids a hidden field, and a field silently
absent from an editor is one a user cannot discover is there. Hooks are
read-only as §1.5 decided.

*What this replaces is worse than an incomplete form: before it, the only way to
change the sentence injected into every single turn was to write JSON by hand or
to `POST` it with `curl`.*

### P7B.4 — Edit a block, through the pack

§1.6 built: *Edit this block in the pack* on the workbench's block table,
opening the session's copy at that block; reroll from there; compare reading
the result. No record change.

*Ends at:* [10 §3](../10-ui-surfaces.md)'s sentence answered, and
[P3 §1.8](15-p3-implementation.md)'s three mechanical facts re-stated as
*still true, and no longer in the way*.

#### Done — 2026-09-14, `2023004`

*Edit in the pack* on the workbench's block table, shown for a block whose
source is `preset` and carries an id — which since P7B.0 is every block a
shipped pack contributed. It opens the **session's own copy**, and that is the
whole of why this stage is cheap: [03 §8](../03-data-model.md)'s copy already
guarantees the object the link opens is the one this session assembles from, so
there is no override to store and **no record field**, which is what
[P3 §1.8](15-p3-implementation.md) said was missing and what §1.6 declined to
add.

`sessionId` is threaded through `BlockTable`, `CallView` and `TurnSubject` as an
optional, so the compare view — which renders the same table for two turns of
possibly different sessions — keeps working without a link it cannot make
meaningful.

### P7B.5 — The sweep

~~`docs/README.md`'s *"the four kinds that have no editor"* becomes two~~
***becomes none, since P7B.6 takes the other two*** —
[manual testing](05-manual-testing.md)'s C3 and D11 rewritten to the UI path
with their old wording struck; the [10 §5](../10-ui-surfaces.md) create rule's
consequence — ~~*New* on four shelves rather than two~~ ***on all six*** —
checked against every panel; and if P7 has merged, `node tools/renumber-docs.mjs --plan`
and the move this document's status line promises.

**And the check §0.5 added, which is the one item here that is not bookkeeping:**
a walk of the server's route table against the client's request calls, failing
on a route with neither a caller nor a written exemption. **The exemptions are
the interesting half** — a route that legitimately has no client caller should
have to say so in one line, and writing those lines is itself the audit.
*The honest risk*, since §0.5 claims this outlives the phase: the client's
request layer may be too dynamic to walk statically, in which case the fallback
is a hand-maintained list — worse, and still more than exists today.

*Ends at:* the demo, and a test that fails when a route is added without a
caller.

#### Done — 2026-09-14

***The risk this stage was written with named itself on the first run, and the
answer was not the fallback.*** §0.5 and
[manual testing §9](05-manual-testing.md) both warned that *the client's request
layer may be too dynamic to walk statically, in which case the fallback is a
hand-maintained list — worse, and still more than exists today.* It is dynamic.
The fallback was not needed, and what it cost to avoid is worth recording,
because the first draft of this check was **wrong in two ways and both of them
would have passed review**:

- **It rebuilt route paths by regex from `routes/*.ts` and assumed every module
  mounts at `/api`.** Three mount at `/api/admin`, so seventeen admin routes
  came back as orphans. The repair is not a better regex: `routesUnder()` in
  `test-server.ts` reads Fastify's own routing tree and has done since P2B, and
  its docstring is about exactly this failure — *"a hand-maintained array is
  wrong the first time somebody adds one in a hurry, and it is wrong
  silently."* **The check therefore lives in `packages/server`, not in
  `tools/`**, which is a reversal of the draft's own stated reasoning: *text on
  both sides, no imports* is tidier and less true than *routes from Fastify,
  client as text*.
- **It matched string literals by equality.** `api.ts` composes six addresses
  through `objectUrl` and `versionUrl` and splits a seventh across a `+`, so
  history, rows, restore, amend and the media bytes all looked uncalled. Joining
  adjacent templates and expanding URL helpers **by shape rather than by name**
  reads them, and a seventh helper written the same way is found without editing
  the check.

*It also counted client **test** files as callers, which is the one corpus that
must never count: a route's own tests call it, and that is the reason the suite
could be green over five missing surfaces in the first place.*

**Thirty-one orphans on the first run, twenty-four of them the check being
wrong, seven real.** Two are correct absences and four are recorded as owed,
with the criterion that separates *build it now* from *owe it* — §1.12 carries
all of it, including the one that was built here (`POST
/admin/accounts/:handle/password`, an administrator resetting a password, which
had no caller and whose only alternative was deleting the account).

**Two maps rather than one**, which is the shape the gate row asks for read
carefully: `EXEMPT` is an argument that no surface is needed and `OWED` is a
promise that one is, and a reader can count the second. Both are checked against
the live route table, so a line outliving its route fails — which is
[manual testing §10.1](05-manual-testing.md)'s subject.

**And the bookkeeping.** `docs/README.md`'s *four kinds that have no editor*
becomes none; C3 and D11 struck and rewritten to the UI path; the *New* control
checked on all six shelves, with the dead-guard consequence recorded under
P7B.6; §1.7's three comments audited, of which **two were still standing** —
`routes/sessions.ts`' *"P7 keeps the surface"* and `SessionsPage.tsx`'s *"not
changeable afterwards"*, both falsified by P7B.2 and both missed by it. *§1.7's
rule is that a comment is corrected in the stage that falsifies it; the sweep is
the net under that rule rather than a replacement for it, and this is the
evidence that the net is needed.* `workbench/address.ts`' sample links, and the
renumber the status line promised, are the other two entries.

### P7B.6 — The setup and package editors

§1.9. `/library/setups/:id/edit` and `/library/packages/:id/edit` with their
`new` routes, `EDITOR_ROUTES` and `NEW_ROUTES` reaching all six kinds, and
`fields.test.ts`'s *"answers for the four that do not"* **deleted rather than
edited** — it is an assertion of absence and the absence is what is being
removed. The setup editor is the smaller: its create path exists and is
P7.4's *Save as a setup*, so what lands is opening one and changing a field.
The package editor is a picker over the objects a user owns, and lands able to
make and describe a bundle and not to send one (§1.9's stated limit).

*Depends on:* P7B.1, whose editor shell both reuse. *Ends at:* every library
kind answers `kindHasEditor`, and *New* is on all six shelves.

#### Done — 2026-09-14, `b55fe9e` — with P7B.3

The three declarations in `kinds.tsx`, and `fields.test.ts`'s *"answers for the
four that do not"* **deleted rather than edited**, as the stage asked: it
asserted an absence, and the absence is what was removed.

***The consequence nobody planned for is that the tables now cover the whole
union.*** `EDITOR_ROUTES` and `NEW_ROUTES` are typed against each other so a
kind in one and not the other fails to compile, and `LIBRARY_DIRECTORIES` is
exactly the six folders [03 §5.1](../03-data-model.md) names — so
`kindHasEditor` answers `true` for every input that exists, and
`LibraryPage`'s *"This kind has no editor yet"* sentence is unreachable.
**All three are kept and all three now say so in their comments**, because they
are the guard rather than the message: a seventh kind joins the directory map in
one edit and gains an editor in another, and the window between those two edits
is the only time any of them has ever had work to do. *Deleting an unreachable
guard is how the thing it guarded against comes back.*

The package editor lands at §1.9's stated limit — able to make and describe a
bundle, not to send one, because `.sepack` is not in this phase.

### P7B.7 — The workbench, pointed at any turn

[10 §3](../10-ui-surfaces.md) says the panel shows any turn, *current or
historical*; it is wired to the head. `useTurn`
([`queries.ts`](../../../packages/client/src/queries.ts)) is the reader it needs
and it exists, with one component calling it twice — `ComparePage`. **The reader
is built and the affordance is not**, which is the whole of
[F-05](21-playable-log.md), graded [R1](22-walkthrough-refinements.md) and filed
unowned in [manual testing §10](05-manual-testing.md) since 2026-09-09.

*Depends on:* nothing here. *Ends at:* selecting a turn the head has passed
shows that turn's blocks, calls, effects and budget verdicts — **and the panel
says which turn it is showing**, which is the ambiguity a panel acquires the
moment it can show two things.

#### Done — 2026-09-14, `3ca6de0`

`TurnPicker` in `Workbench.tsx`, and the selection lives in the URL as
`?turn=`, which is what makes a workbench view something a person can paste into
a bug report — the same claim the compare view's address already makes.

**The ordering rule is the stage's real content.** A panel that can show two
things needs an answer to *which*, and the answer is that **an explicit
selection outranks the live turn and the preview**: a turn arriving at the head
must not yank somebody off the turn they were reading, and a panel that silently
followed the head would be exactly [10 §3](../10-ui-surfaces.md)'s sentence
being false in the other direction. Clearing the selection returns to following
the head.

*[F-05](21-playable-log.md) is retired, three phases after it was graded
[R1](22-walkthrough-refinements.md) and five days after
[manual testing §10](05-manual-testing.md) recorded it unowned.*

### P7B.8 — The import quarantine's listing

`GET /api/library/errors`
([`library.ts`](../../../packages/server/src/routes/library.ts)) is the only way
to see what an import quarantined, and
[P2 manual gate §3.5](11-p2-manual-gate.md) has said *"No client code calls it"*
since P2. **A quarantine nobody can look into is a deletion with extra steps.**

*Depends on:* nothing. *Ends at:* somebody who imported a folder can see what
went to `compat` and why, from the browser — the gate step
[manual gate §3.5](11-p2-manual-gate.md) has failed since it was written.

#### Done — 2026-09-14, `f56dfc8` — with P7B.9

`QuarantinePanel` on the library page, over the route's own
`LibraryFileError[]` — path, source, kind, slug, reason, detail and when it was
seen. **It renders nothing when the quarantine is empty**, which is the same
rule the cast panel and the HUD follow: a permanent empty box teaches a reader
to stop looking at that corner of the screen, and this is a corner that must be
looked at on the one day it has something in it.

*`GET /api/library/errors` shipped at P2, and
[manual gate §3.5](11-p2-manual-gate.md) has carried "No client code calls it"
in every gate sheet since — six phases of a written observation that nothing
acted on. It is the clearest single instance of the class gate row 17's check
exists to catch, which is why it is worth the sentence.*

### P7B.9 — Home, as a prototype that shows the changelog

§1.10. `/` becomes a page rather than a redirect, the wordmark points at it, the
page renders the changelog, and **nothing else goes on it in this phase.**

*Depends on:* nothing. *Ends at:* the two comments in `router.tsx` and
`Shell.tsx` that describe home as a future are rewritten to describe the
present, and `/` is not a redirect.

#### Done — 2026-09-14, `f56dfc8` — with P7B.8

`HomePage` renders `CHANGELOG.md` through Vite's `?raw` import, so the page
shows **this build's** changelog rather than a fetched one — the same argument
`about/AboutBuild.tsx` makes about facts concerning the running build, and the
reason there is no route behind this.

**The fence is the stage**, and it held: nothing else is on the page. §1.10
defers the full [10 §2.2](../10-ui-surfaces.md) home by direction — nominally a
1.0 feature, expected immediately before the cut-over to feature-complete beta,
and possibly further out — and a prototype that quietly grew a session list
would be that deferral being reversed by accretion rather than by decision.

#### Revised — 2026-09-15 — the changelog becomes a document, and gains a history

The note above is a record of the fourteenth and is not edited. This is what
changed the day after, recorded in live prose beneath it: the terms of the
argument, and the check on the warning it closes with.

**Two defects in the prototype as shipped.** The page rendered `CHANGELOG.md` as
text, so its release headings, sections and bold leads reached the screen as the
characters that spell them — and the fence had been read as forbidding a
renderer rather than as forbidding *panels*. And it showed the whole file at
once, which is too much to arrive on and too little to look anything up in.

**What it is now.** One release, rendered, newest by default; the full release
history in the workbench, which is now that panel's fourth subject
([10 §3](../10-ui-surfaces.md)); the selection in the address, `/?release=…`,
because a selection held in the panel would have made a reader into a place.

**The dependency, and the trigger it fires.** `react-markdown` is pinned in the
client. `/` is the entry route, so this is
[20 §7](../20-client-loading.md)'s *"a substantial new browser dependency joins
the common entry"* by definition. It was measured at the time — **+120.59 kB
minified, +36.71 kB gzip, a sixth of the entry** — and the decision not to bring
P11.0's audit forward, with the lazy-loading contingency, is recorded at
[20 §7.1](../20-client-loading.md). The price the struck docstring named was
real; what it got wrong was the trade.

***The warning above is the right one, and this is not it.*** The test is
**which deferral**. [10 §2.2](../10-ui-surfaces.md)'s four panels — resume,
start, notice, recent work — are each a reader over *the user's own data*,
needing a surface that computes something; a session list is the first of them
and is exactly what the note names. None of the four is here and none is nearer.
What changed is the one thing the page already showed, shown properly, and
neither the rendering nor the release list adds a *subject*: the page's is still
*what changed in this build*. [Polish §5b](06-polish.md) carries the same
argument where the item lives, with the About seam this leaves open.

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
9. ~~`fields.test.ts`'s negative flips for treatments and presets and holds for
   setups and packages~~ ***its negative is deleted, because all six kinds have
   an editor*** (P7B.6, 2026-09-14); *New* appears on exactly the shelves with
   an editor, which is now all of them. *Automated.*
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

***Rows 13 to 17 added 2026-09-14 with §0.5's fold.***

13. A Setup saved from a session opens in an editor and a field changed there
    survives a reload; a package is assembled in the browser from objects the
    user owns. *Automated* — and **the second half is walked once**, because a
    picker over somebody's whole library is a surface a test cannot judge.
14. **Critical candidate.** The workbench opens on a turn the head has passed
    and shows that turn's blocks, calls and verdicts, and says which turn it is
    showing. *Walked* — [10 §3](../10-ui-surfaces.md)'s sentence has been false
    since P3 and a person is the only instrument that notices a panel quietly
    showing the wrong turn.
15. Break an actor file by hand, import, and read what was quarantined and why
    from the browser. *Walked* — it retires
    [manual gate §3.5](11-p2-manual-gate.md), which is a gate step that has
    failed since it was written.
16. `/` is a page, the wordmark reaches it, and it shows this build's changelog.
    *Automated*, and the comments in `router.tsx` and `Shell.tsx` no longer
    describe a future.
17. **The one that is not about this phase.** A test walks the server's route
    table against the client's request calls and fails on a route with neither a
    caller nor a written exemption. *Automated, and it is the gate item most
    worth having* — five of this phase's items were routes green in CI with no
    caller for up to six phases, and the instrument that found them was a person
    reading documentation. §0.5, and
    [manual testing §9](05-manual-testing.md).

***What this gate cannot reach, said because the phase's own claim needs it.***
Every row above checks that a named surface arrived. **None of them can say
whether an eighteenth is missing** — the class §0.5 is about is invisible to a
walk of the things a walker just built, which is exactly why row 17 is a test
and not a step.

**And the standing line from [work plan §2.3](01-work-plan.md): no phase exits
with configuration that has no surface.** This phase is that line being paid
for the prompt pack, nine phases late; the check here is that it does not
generate new debt of the same kind — every field the editors add is a field
some surface can set, and every one the schema carries that they do not set is
listed in §4 with the phase that will.

### 3.2 What was answered, and by what — opened 2026-09-15 at the merge

*A second table, which is [manual testing §0](05-manual-testing.md)'s first
honesty condition: **the seventeen steps above are never edited**, and this
records what answered them. Opened at the merge with the automated half filled
and the rest blank, rather than written after the walk — a table that appears
only once there is good news is a table nobody believes.*

| Step | Answered | By |
|---|---|---|
| **1** The pack demo end to end, no JSON | **NO — M1, a person** | Every part of it is asserted separately and **nothing asserts the walk**. Open. |
| **2** The default pack has an object; the workbench row links | **YES — AUTO** | `system-library.test.ts`; the link needed no code, since `collect.ts` has written `presetId` since P4.4 and `workbench/address.ts` has linked whenever there is one |
| **3** The system copy refuses edit and delete; *Copy to my library* works | **YES — AUTO** | `system-library.test.ts` and `library.ts`'s existing refusals; `CopyToMyLibrary.tsx` gives the copy a new `uuidv7()` and every other field verbatim |
| **4** A slot's `outlet`, set in the editor, positions an entry | ~~**YES — AUTO**~~ **YES — AUTO, from 2026-09-15** | `PresetEditorPage.test.tsx`'s *sets a slot block's outlet, which nothing could do before* — asserted on the **object the client sent**, because that is what would otherwise have been hand-written. ***It was false for a day***: the editor read `source.kind` and no preset carries that field, so no slot rendered as a slot and the control appeared nowhere. Fixed at `3287d67`, **and the fixture that hid it replaced by one the shipped validator accepts** — see P7B.1's record. [P5 §3](17-p5-implementation.md)'s standing defect, retired for real |
| **5** Switch the pack mid-session; the old record still names the old blocks | **PART — AUTO; the reading is M2** | `session-preset.test.ts` for the switch and the record. *What no assertion covers is whether the history **reads** as the record it is*, which is the failure §1.1 was written to prevent |
| **6** C3 without a text editor | **NO — M6, a person** | The control exists (*Maximum reply length*, P7B.2) and the walk is what retires C3's struck wording. Open. |
| **7** A treatment's framing reaches the next turn's `se.treatment` block | ~~**YES — AUTO**~~ **YES — AUTO, from 2026-09-27** | ~~The treatment editor writes the field and the assembler has read it since P5; `kinds.tsx` and the existing assembly tests~~ ***False from the day it was written, and found by the 2026-09-27 audit***: the assembler had **not** read it since P5. The collector's `treatment` arm returned nothing from P2.6 on, and the gather had carried the treatment since P5.6 only as a carrier for its samples, so the block was dropped as empty on every turn and no prompt ever held a framing. The tests cited assert the editor's half and nothing of the assembler's — *the row was answered by reading, not by a test*. Now `runner.test.ts`'s *puts a treatment's framing into the turn's treatment block*, the whole path the row names from the library object to the block on the turn's record, and `collect.test.ts`'s *the treatment slot* |
| **8** Archive and delete from the UI; delete lands in trash | **YES — AUTO** | `SessionPanel.test.tsx`, over `setSessionArchived` and `deleteSession` — the second of which had no client wrapper at all before this phase |
| **9** `fields.test.ts`'s negative deleted; *New* on exactly the shelves with an editor | **YES — AUTO** | The negative is deleted rather than edited, as the stage required. *And the tables now cover the whole of `LibraryKind`*, so `LibraryPage`'s no-editor refusal is unreachable — kept as the guard, with a comment saying so (P7B.6) |
| **10** A hand edit under an open panel is refused with the conflict dialog | **NO — M3, a person** | The 412 path is the editor shell's and is asserted on editor pages; **this is its first walk on a surface that is not one.** Open. |
| **11** The rebuild gate holds with the system folder; a restart writes no spurious version | **YES — AUTO** | `pnpm test:gate` with the folder present, and `materialiseModePresets`' read-then-compare |
| **12** Play several turns on a browser-authored pack and judge the narrator | **NO — M5, a sitting** | Not a step, and no test could be written for it even in principle: the question is about prose |
| **13** A Setup opens and survives a reload; a package assembled in the browser | **PART — AUTO; the picker is M6** | The editor half is `kinds.tsx`'s; a picker over somebody's whole library is a surface a test cannot judge |
| **14** The workbench on a passed turn, **and it says which turn** | **NO — M4, a person** | `Workbench.tsx` selects from `?turn=` and the ordering rule is asserted. *Every assertion here passes just as well against a panel that renders the head and labels it correctly by accident*, which is why this is a walk |
| **15** Break an actor file, import, read the quarantine from the browser | **NO — M6, a person** | `QuarantinePanel` exists and renders null when clean. The walk retires [manual gate §3.5](11-p2-manual-gate.md), failing since it was written. Open. |
| **16** `/` is a page, the wordmark reaches it, it shows this build's changelog | **YES — AUTO** | `HomePage.test.tsx`, over a build-time `?raw` import so the changelog is **this** build's; the comments in `router.tsx` and `Shell.tsx` no longer describe a future |
| **17** A route with neither a caller nor a written exemption fails | **YES — AUTO** | `packages/server/src/routes/route-callers.test.ts`, and it found four routes on its first honest run — §1.12 |

**Nine of seventeen answered by tests, two answered in part, six await a
person** — all six in [sitting M](05-manual-testing.md), and every one of them
wants a live endpoint.

---

## 4. Out of scope, deliberately

The field-assist contract, image slots, provenance display and entry-level
exchange ([10 §11](../10-ui-surfaces.md) — [P11.2](28-p11-implementation.md)'s,
across the editors this phase creates as much as the ones before it);
~~**the package editor** (P11.2, where [manual testing §10](05-manual-testing.md)
placed it on 2026-09-11 — a bundle's editor is a picker over the user's objects
and belongs with the exchange work)~~ ~~a setup editor beyond P7.4's wizard,
which *is* the setup's editor by [10 §6](../10-ui-surfaces.md)'s design~~
***both reversed 2026-09-14 and taken as P7B.6 — §1.9 has the argument and the
correction: P7.4 built the setup's **creator**, not its editor***; personal
connections and bindings ([10 §15.1](../10-ui-surfaces.md) — [P10.3](27-p10-implementation.md));
the hook panel and its tuning (P7.5, P11.5); a provider-specific escape hatch
in `params` ([04 §8.5](../04-schemas.md)'s open question, and it stays open);
the prompt *preview* as a separate feature, because the workbench's preview
subject already assembles without sending; preset **import** and the macro
namespace (P4's, and finished); Freeform's own pack (P7.9 writes it; this phase
makes it openable, which is a different verb); and difficulty *semantics*
(P7.8 — this phase makes levels editable and says nothing about what they
mean).

***And the four things the 2026-09-14 fold put out of scope***, each with the
decision that put it there rather than by omission: **search**
([P11.1](28-p11-implementation.md), §1.11); **the full home**
([polish §5](06-polish.md), deferred to immediately before the beta cut-over and
possibly further, §1.10); **openings and the seed-expansion loop**, a candidate
held on the expand loop's cost (§1.11); **[10 §9](../10-ui-surfaces.md)'s live
turn view**, held with [R4](22-walkthrough-refinements.md) and
[polish §11](06-polish.md) because the three are one story (§1.11); and
**`.sepack` import and export**, beside [P11.10](28-p11-implementation.md)
(§1.9).

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

***What the 2026-09-14 fold did to the size.*** Four stages, and **three of
them are small in a way that is worth believing rather than hoping**: P7B.7 is
a selection over a reader that already exists with one caller, P7B.8 is one list
over one route, and P7B.9 is a redirect becoming a page with one string on it.
**P7B.6 is the one that is not** — not because either editor is hard, but
because it is the stage that has to hold §1.9's half-measure without growing:
a package editor next to no way to send a package is an obvious thing to "just
finish", and finishing it is `.sepack`, which freezes a format. *The line to
watch is the same one [§0.4](#04-the-bar-and-the-line-it-must-not-cross) draws
for assist.*

**And row 17 is not a stage's work.** It sits in P7B.5 and it may not be
writable at all (§1.11's risk); if it is not, the fallback list still gets
written, because the alternative is the state this phase's two sweeps found.

**What it would cost to cut.** The demo's first half — copy, edit, play, read —
is P7B.0 and P7B.1 and cannot be cut without the phase being about nothing. The
switch (P7B.2) is what makes compare an instrument rather than a curiosity and
is what the walk sheet has wanted since P3. The treatment editor (P7B.3) and
the block affordance (P7B.4) are the two that could slip to P11.2 and P11.0
respectively without the phase failing its own claim — and if either slips, it
goes there by name, on the day, in [manual testing §10](05-manual-testing.md).
**Of the four folded stages, P7B.9 is the cheapest to cut and the only one whose
absence costs nothing** — it is a convenience over a redirect that already
works. P7B.7 and P7B.8 each retire a claim the corpus has had wrong since P3 and
P2 respectively, and P7B.6 is half the reason the fold happened.
