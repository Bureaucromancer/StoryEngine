# 06 — Polish list

**Status: intent, not a proposal.** A running list of things that are worth
doing and are not feature-list items. The distinction matters, because
[24](../24-roadmap.md) has a bar — an entry there is a *feature* held out of the
committed versions, and it earns its place by being additive to the data model.
Nothing here clears that bar and nothing here should have to. These are the small differences
between a surface that works and a surface that is pleasant, and every one of
them is the kind of thing that is obvious the moment a real person uses the app
and invisible while reading the spec.

**The house rule for this file:** an item belongs here if it changes what a user
sees or does, is bounded, and needs no schema change and no new contract. If an
item turns out to need either, it stops being polish — move it to
[24](../24-roadmap.md), where it gets a priority tier, or to the phase plan it
actually belongs to.

Order is intent, not priority. Two of these are arcs and should land in order:
items 1 and 2, and items 4 and 5 — 4 takes a landing place away, so 5 has to
provide one.

---

## 1. A by-field view in the library, without opening the editor

**Landed at [P5.−1](docs/design/workplan/17-p5-implementation.md)**, which is where this item stopped
being a dependency of a phase and became the first stage of one:
[ByField.tsx](../../../packages/client/src/library/ByField.tsx) renders it, over
a field description derived at runtime from the schema
([fields.ts](../../../packages/client/src/library/fields.ts)). Everything below
is kept rather than deleted, because four of the decisions the argument leaves
open were closed in the build and a reason is worth least where the argument it
answers has gone missing.

- **The single description is the schema itself, read at runtime**, which is the
  only arrangement in which [10 §11.2d](../10-ui-surfaces.md)'s *a field added
  to the schema lands in the editor and in §5.3's read-only fold without a
  second edit* is true. Any hand-written list of a kind's fields is the second
  description this item exists to prevent, and the labels come from the field
  names by a rule rather than a table for the same reason. The cost, stated:
  those labels are English because they are what the JSON says, and a table of
  translated ones would be the second description again.
- **Empty is shown rather than omitted**, which is the branch this item leaves
  open. Shown, because a field nobody can see is a field nobody fills —
  [11 §4.1](../11-lorebooks-as-a-format.md) makes exactly that argument about
  `description` — and shown in three words rather than one, since an absent
  value, a blank string and an empty list are three different facts and the
  schemas draw meaning from the difference.
- **The fields moved above the storage block, which kept its own heading.** Not
  decoration: the complaint in this item is that the page answers *where is this
  file* when the question was *what does it say*, and a build that left seven
  rows of path and hash above the prose would have answered in the old order
  with a new component underneath.
- **Keys the schema does not declare stay with *As stored*** (§2), which is the
  view whose stated job they are. A kind this build has never heard of is the
  one exception, and barely one: with no declaration to be the authority on what
  belongs, the file's own keys are the only description there is.

**And the closing clause below is now paid in full.** The `actors` half moved
into the same module the fields come from — and took the *route* with it,
because the Edit link named the kind twice, once in the condition and once in
the address, so widening one without the other would have opened a lorebook in
the actor editor.

~~**Today.**~~ **As it was**, and the tense is the whole of the change. The
library detail page
([ObjectDetailPage.tsx](../../../packages/client/src/library/ObjectDetailPage.tsx))
showed a metadata block — kind, folder, identifier, schema, timestamps, content
hash — and then the whole object as pretty-printed JSON. To read an actor's
personality or its greeting the way it was *written*, you opened the editor.
*One detail of that had gone stale before this item landed: the JSON moved
behind §2's fold at P3.3, so what the page actually showed by then was the
metadata block and a closed pane.*

**What that costs.** Opening the editor to read is the wrong gesture in three
different ways. It is a write surface, so it invites accidental edits and it
takes the object's lock in whatever form that eventually takes. It is
kind-specific, so only the kinds with an editor are readable at all — everything
else is JSON or nothing. And it is not available for objects that are not the
user's to edit: bundled and shadowed objects have no editor, and those are
exactly the ones a user most needs to *read* to understand what they inherited.

**What to build.** The same field-by-field presentation the editor uses, in
read-only form, on the detail page: labelled fields in the schema's own order,
long text rendered as text rather than as a JSON string with `\n` in it, empty
fields either omitted or shown as explicitly empty, and lists as lists.

**The thing to get right.** It should be recognisably *the same view* as the
editor's, not a second layout that drifts. That is the whole design constraint —
one description of a kind's fields, two renderings of it.

**Correction, because this item used to claim the first half already existed.**
It said *the editor already derives its fields from the schema*, and it does
not. `ActorForm` names its six fields by hand
([form.ts](../../../packages/client/src/editor/form.ts)) and
[ActorEditorPage.tsx](../../../packages/client/src/editor/ActorEditorPage.tsx)
writes one `<Field>` per field in JSX; the primitive those are built from
([Field.tsx](../../../packages/client/src/ui/Field.tsx) — in `ui/`, not
`editor/`, which is what made the old link dangle) owns a label, a control and
an assist slot, and knows nothing about any schema. So the read view **cannot**
derive its fields *the same way* as the editor, because the editor does not
derive them at all. The single description is work this item has to do rather
than something it inherits, and that is the difference between a second
rendering and a small piece of design.

**Also worth doing while in there:** the Edit button is currently gated to
`actors` and `source === 'user'`. As other kinds get editors that condition
should come from the same place the fields do, rather than growing a second list
of kinds. *Half paid at [P4.5](docs/design/workplan/16-p4-implementation.md), and by the route this
note predicted: Delete needed the same gate, so rather than a second copy of it
the ownership half became one predicate both read. What is left is the part this
note is actually about — the `actors` half, which still names a kind and should
come from wherever the fields come from.*

## 2. *As stored*, kept in the library and added to the editor as a pane

**Landed at [P3.3](docs/design/workplan/15-p3-implementation.md)**, as one component on all three
surfaces — the detail page, the workbench's library subject and the editor's
saved-state pane — collapsed by default, with the open state in the per-user
`prefs.json` and a copy control over the whole object. This item was struck late,
at [P5.−1](docs/design/workplan/17-p5-implementation.md), and the lateness is worth a sentence: the
one clause it could not honestly claim was *collapsed by default is correct once
the by-field view exists*, and §1 is what made that true.

**Keep it.** The `As stored` block on the detail page stays after item 1 lands.
It is not a placeholder for the by-field view and it is not developer debris —
it is the surface that teaches the storage model, and that is a deliberate
position ([10 §5](../10-ui-surfaces.md)): the folder *is* the object, and a user who
can see exactly what is on disk is a user who will confidently open the file. It
is also the only view that shows fields the client does not know how to render
yet — extension-written keys, newer schema fields, anything a hand edit added.
Losing it would make those invisible rather than merely unstyled.

**Add it to the editor too**, for the same reason: the editor is where hand
edits and app edits meet, and being able to check what the save actually wrote
is the answer to a whole class of "did that take?" doubt.

**Collapsed by default, in both places.** An expandable pane, closed on arrival,
its state remembered per user rather than per object — which needs somewhere to
put a preference, and that is [25 B13](../25-open-questions.md), not this item.
*Unblocked: B13 resolved at [P2A §2.2](docs/design/workplan/09-p2a-configuration-surface.md) and the
per-user `prefs.json` store shipped with it, so this item no longer waits on
anything.* In the library that is a
change from today, where the block is always open — and that is correct once the
by-field view exists, because the by-field view becomes the thing you came to
read and the JSON becomes the thing you go looking for.

**Details worth settling once, in one place:**

- One component, both surfaces. Two JSON viewers that disagree about wrapping
  and copy behaviour is a bad outcome for a small feature.
- Copy-to-clipboard on the pane, of the whole object.
- In the editor, it shows the **saved** object, not the form's working state,
  and it says so. Showing unsaved form state as "as stored" would be a lie in
  the one place a user came for the truth.
- Long objects need a bounded height with its own scroll, not a page that grows
  to a thousand lines.

## 3. Version history: manual version numbers on pinned versions

**Today.** History records the author's own `provenance.version` alongside each
snapshot (`authorVersion` in
[history.ts](../../../packages/server/src/storage/history.ts)) and the panel can
pin, rename and restore
([HistoryPanel.tsx](../../../packages/client/src/editor/HistoryPanel.tsx)). The
version string is theirs, the revision counter is ours, and the two are kept
apart on purpose ([03 §11.5](../03-data-model.md)).

**What is missing is the gesture that connects pinning to that string.** Pinning
already means *this one matters, do not prune it* ([03 §11.3](../03-data-model.md)).
In practice the versions people pin are the ones they would also like to *name
with a number* — "1.0", "1.2", "the one I shared" — and today the only way to
attach a number is to have happened to set `provenance.version` before making
the edit that snapshotted it. That is backwards: you know a state was a release
after you have moved past it, not before.

**What to build.** On a pinned version, let the user set the version string
directly, after the fact. The rename affordance is already there for `reason`;
this is the same shape for `authorVersion`. Pin, then number.

**The rules that keep this honest:**

- **It stays the author's field.** Nothing here computes, increments or suggests
  a number, and a version string is never required. An author who never uses
  them sees no change beyond one more optional control.
- **Numbering a version does not rewrite the object.** Treatment `1.2` on a
  pinned snapshot changes that record, not the live object's
  `provenance.version` — unless the user asks for both, which is worth offering
  as an explicit second action rather than as a side effect.
- **Duplicates are allowed but flagged.** Two pinned versions claiming `1.0` is
  the author's business; the panel should say so quietly rather than refuse.
- **Unpinning does not erase the number**, but it should warn, because the
  record it is attached to becomes prunable again.

**Display, which is half the value.** Once pinned versions carry numbers, the
history list should read as a release list where they exist: the numbered ones
visually distinct from the ordinary run of edits, and filterable down to just
them. A long history with four pinned releases in it is a very different
document depending on whether you can see only those four.

### 3.1 Where this meets export

"Send them 1.2" is the obvious thing to want once versions carry numbers, and it
is the one part of this item that is not polish — it sets a default on the
export flow, which is P4's ([P4](docs/design/workplan/16-p4-implementation.md)) and belongs in
[03 §11.6](../03-data-model.md) once settled. The intended shape:

- **Native export (`.seactor`, `.sepack`) sends the active version**, with
  **full history as an opt-in** on the export. This is [03 §11.6](../03-data-model.md)
  unchanged, and its reasons hold: forty drafts make the file large for no
  benefit to most recipients, and a working record carries false starts nobody
  agreed to publish. Sharing is the common case and collaboration is the
  exception, so the exception is the one that asks.
- **SillyTavern-compatible export is active-version-only, always**, with no
  option. Not a policy choice — the format has nowhere to put a history, and
  offering a toggle that silently does nothing is worse than not offering one.

The two paths therefore differ in exactly one place: the native one has a
checkbox. That is the point — a user who has not thought about history gets the
same file from both, and the choice only appears where it can mean something.

**Where the numbers come in.** Independently of history, both paths want to
answer *which* version is being sent, and "the active one" is not always the one
the author considers released. A numbered pinned version is the natural
alternative to offer — "export at 1.2" alongside "export the current state" —
and it works on the SillyTavern path too, since selecting a version is not the
same as shipping the history. That is the whole reason the two items are
related; the numbering does not depend on the export work and should ship
first.

## 4. Per-kind library surfaces; *All kinds* stops being a browsing view

**Today.** The library filter offers **All kinds** first, it is the unfiltered
state, and it is what `/` renders on arrival
([LibraryPage.tsx](../../../packages/client/src/library/LibraryPage.tsx)). Every
object the user has, of every kind, in one table sorted by nothing in
particular.

**The position is settled and lives in [10 §5](../10-ui-surfaces.md)** — one panel
per kind, because the kinds are distinct by design and a merged table teaches
otherwise; the all-kinds view behind a preference, because a cross-kind list is
a search result rather than a way to browse; and the naming, settled in
[10 §5.1](../10-ui-surfaces.md), which withdrew the earlier renaming layer — the
panels are named for the kinds. What is left here is the client work.

**What the change is.**

- **Six panels**, one per portable kind (`LIBRARY_KINDS` already enumerates
  them), **named for the kinds** — Actors, Lorebooks, Treatments, Setups,
  Presets, Packages. *Correction:* this bullet read *"using the presented names —
  Actors, Worlds and Games offered, Lorebooks, Presets and Packages reachable"*,
  which is the renaming layer [10 §5.1](../10-ui-surfaces.md) withdrew — and
  which the paragraph immediately above already cited as withdrawn. **The item
  argued against itself**, and the bullet was the stale half.
- **Shared machinery, per-kind surfaces.** One list component, one set of
  badges, filters, sorting and actions, one detail route. What each panel
  supplies is its columns, its sort and its empty state. Today's
  `ObjectTable` is most of that already, with the Kind column falling away
  wherever it is the panel's own kind. **The Lorebooks panel's columns, badges,
  filters and empty state are specified** at
  [10 §5.3](../10-ui-surfaces.md) — the one kind where the per-panel choice is a
  correction rather than a preference, because its object is a collection
  ([11](../11-lorebooks-as-a-format.md)). The other five are still this item's to
  choose.
- **The all-kinds view moves behind a preference**, off by default, alongside
  whatever other "show me the machinery" settings accumulate — the same instinct
  that keeps §2's *As stored* pane. Removing it outright is acceptable if the
  preference plumbing is what stands between this and shipping. Where a
  preference persists is [25 B13](../25-open-questions.md), shared with item 2;
  the surface that eventually shows them is [10 §15.1](../10-ui-surfaces.md).
  *Both shipped at [P2A](docs/design/workplan/09-p2a-configuration-surface.md), so the escape hatch in
  the sentence above — delete the view rather than wait — is no longer needed.*
- **`/` moves to home** (item 5). Landing on an arbitrarily chosen single kind
  instead — actors, because there are usually most of those — would be a worse
  answer than today's mixed list, not a better one.
- **Each panel also supplies whether its kind can be made here**, which is the
  fourth thing alongside columns, sort and empty state.
  [P4.5](docs/design/workplan/16-p4-implementation.md) put a **New actor** control on the merged
  list and a sentence in place of one on the five kinds with no editor to land
  in; splitting the list into panels is what turns that sentence into a
  per-panel property. [10 §5](../10-ui-surfaces.md) carries the rule — create
  arrives with the kind's editor, never as a row of six buttons — so a panel
  never has to decide it, only to render it.

**Nothing server-side changes.** The API goes on accepting an absent `kind`, and
the tests that cover it stay as they are — this is a client presentation
decision and should stay one.

**One thing the panels must carry over.** P2.0 makes a shadowed duplicate-id row
individually addressable — the row links by a path discriminator rather than by
id alone, because id-addressing always opens the winner ([P2 §1.3](docs/design/workplan/08-p2-implementation.md),
F19). That lives in the read route and the link contract, so the panels inherit
it by using the same detail route; what would lose it is a panel building its
own links from `{kind, id}`. The duplicate warning without the link is the bug
F19 already fixed once.

## 5. A home, so arrival is not an arbitrary library view

**What home is and what it holds is [10 §2.2](../10-ui-surfaces.md)** — resume,
start, notice, recent work, in that order, and the library not owning arrival.
This item is the build, and the reason it is urgent is item 4: today `/` answers
*"what was I doing?"* with a table of everything, and after item 4 there is no
mixed table left to answer it with at all.

**Scope discipline, since this is the item most likely to sprawl.** A home page
attracts every idea anyone has ever had about a dashboard. The rule: it shows
only what some other surface already computes, it introduces no endpoint that
exists solely to populate it, and every element on it is a link to a place that
does the real work. If a panel cannot be built from what the library and session
lists already return, it does not belong in this item.

**It grows with the phases**, and that is fine. Before sessions exist, home is
the entry points plus recent objects plus notices — already a better arrival
than a table of every kind at once. The resume list is the piece that makes it
obviously right, and it slots in when there is something to resume.

**Routing.** Home takes `/`, and the library moves to its own route with the
kind filter still in its search params. Worth doing in the same change rather
than leaving the library at `/` with a home bolted beside it — the route a user
lands on is the one they will bookmark and share.

---

## 6. The styling layer, and the second theme it exists to allow

**Landed rather than proposed**, and recorded here because the shape of what
landed decides what the next few items in this file cost.

**Today, before it.** Every colour in the client was written at the call site:
338 `className` lines across 20 files, 174 distinct class strings, no `@theme`
block, no CSS custom property defined by the project, and five separate files
that had each independently extracted a class constant — two of them named
`BUTTON_CLASS`, for different buttons. The primary button had three
incompatible spellings, and they differed in *behaviour* rather than only shade:
the variant the settings surface used had neither a hover nor a disabled state,
so a button that could not be pressed looked exactly like one that could.

**What it is now.** [10 §1.2](../10-ui-surfaces.md) and
[19 §6.1](../19-tech-stack.md) carry the design; the enforcement is the part
that matters to this list:

- The palette is `packages/client/src/index.css` and nowhere else. A Tailwind
  scale — `bg-slate-800`, `text-red-900` — written anywhere else in the client
  is a build error, as is a `dark:` variant, which means a token is missing.
- The look is `packages/client/src/ui/`. A component when it owns behaviour or
  ARIA, a class list when it owns appearance only.
- Light and dark both ship, chosen by `prefers-color-scheme`.

**Why that changes the cost of the items above.** Each of 1, 2, 4 and 5 adds a
surface, and before this the honest estimate for any of them included inventing
its colours again and getting them slightly different — which is how the play
surface ended up at 1.01 to 1 against the shell it renders inside
([P2C](docs/design/workplan/12-p2c-first-real-run.md)). A new surface now inherits a palette, a type
scale, and a dark theme it does not have to think about.

**What was deliberately not done.**

- **No config file.** [25 E10](../25-open-questions.md) records the reasoning.
  The theme *setting* did follow, once both themes were right: light, dark or
  match my system, in the Preferences pane ([10 §15.1](../10-ui-surfaces.md)),
  written to the per-user `prefs.json` that [25 B13](../25-open-questions.md)
  settled — which makes it the first thing to use that store, and the reason the
  pane exists at all. Note the order, because it is E10's whole argument: the
  surfaces were made correct first, and only then was one of them made
  selectable.
- **Radix is still not installed.** `ui/Dialog` owns the focus trap and
  `aria-modal` a primitive would take over, so the boundary is there; the
  dependency is not, and adding it is its own change.
- **Layout was left inline.** Only what carries a colour, a border, a radius or
  a type step moved. Arrangement is not theming — E10 draws exactly that line —
  and a named recipe holding `mx-auto flex max-w-3xl` would be layout smuggled
  into the appearance layer.

## 7. A filter over the sign-in gallery

**Blocked on the gallery existing.** The opt-in account-gallery arrival
screen is [12](../12-account-gallery.md), homed at P10; this item is the
escalation that note defers, recorded here so the deferral has an address.

**Today.** There is no gallery yet. When it ships, it is tiles for every
listed account plus a *Sign in by name* link, and at household scale that is
the whole answer — single-digit tiles are scanned, not searched
([12 §7](../12-account-gallery.md)).

**What to build, when tile count defeats scanning.** A type-to-filter box on
the gallery, narrowing the tiles as you type — client-side, over the listing
the screen already fetched. No schema change, no new contract: squarely
inside this file's house rule.

**The thing to get right.** [12 §7](../12-account-gallery.md) records the
intent: once a text entry exists on the gallery, the separate by-name link
may fold into it — a typed handle that matches no tile *is* the by-name
case — leaving the screen one text affordance instead of two. Build the
filter as that, not as a second box beside the link.

## 8. Five sampler settings the adapter drops

**Found at [P4 §7.17](docs/design/workplan/16-p4-implementation.md), named there and fixed here.** It
clears this file's bar exactly: it changes what a user sees — their `min_p`
starts working — it is bounded, and it needs no schema change and no new
contract. `GenerationParams` already declares every field involved.

**Today.** `toSdkParams` in `openai-compatible.ts` puts eight parameters on the
wire. `GenerationParams` has thirteen, and five of the difference — `topK`,
`topA`, `minP`, `repetitionPenalty` and `n` — convert faithfully from a
SillyTavern preset, validate, store, and appear in the editor without ever
reaching a model. Somebody imports a preset tuned around `min_p`, the review
says *"6 of 41 sampler settings carried over"*, the object shows the number, and
the model never hears about it.

`FORWARDED_SAMPLER_PARAMS` names the narrower set so the import preview can be
honest in the meantime, and a test reads that list off the outgoing request body
rather than off the adapter. **That test is what should turn red when this
lands**, which is the point of it: the day the gap closes is the day the
preview's sentence has to change.

**What to build.** The four this build never names are a line each in
`toSdkParams`, routed through the adapter's provider-specific body. `topK` is
the one to be careful with and the reason this is not a five-minute change:
`toSdkParams` **already passes it**, and `@ai-sdk/openai-compatible` drops it
before the body because `top_k` is not in the OpenAI chat schema. So the fix is
not *add the missing line* — the line is there — and whoever takes this will
reach for it first and find it already written.

**The thing to get right.** These are not universal. `min_p` and
`repetition_penalty` are understood by llama.cpp, Ollama, KoboldCpp and TabbyAPI
and not by OpenAI; sending them to an endpoint that refuses unknown body keys
turns a working preset into a failing turn. So this is the third of
[04 §8.5](../04-schemas.md)'s open questions arriving in a concrete form —
*whether the portable subset holds or needs a provider-specific escape hatch* —
and it wants a per-connection answer rather than a global one, which is why it
is a polish item with a design question inside it rather than a patch.

**The honest alternative, if that answer is slow in coming.** Keep the adapter
as it is and make the *editor* say what the preview now says, so a number nobody
sends is at least labelled everywhere it appears rather than only at import.
That is strictly worse than sending them and strictly better than today.

---

## 9. Search and sort on every library shelf, not just Lorebooks

**The library cannot be searched at all.** A book can be searched from the inside
([§1](#1-a-by-field-view-in-the-library-without-opening-the-editor)'s neighbour,
`LorebookView`), and the shelf holding it cannot. The sort control has the same
shape of gap for a different reason: it renders only when the current panel
declares sorts, and only Lorebooks does, so five of the six shelves show no
controls whatsoever — not an empty control row, no row.

**What to build.** A control row that is always there: a search toggle, a sort
dropdown, then whatever filters the panel declares. The search is a live filter
over the shelf already in memory — `GET /api/library` ships every object's full
body and the page is already holding all of it, so this needs nothing from the
server. Give the generic panel real sorts (name, recently updated) so the
dropdown is not Lorebooks-only furniture.

**The thing to get right.** [10 §5.3](../10-ui-surfaces.md) names *a search box
per kind* as the failure it is preventing, and asks that the input mounted in the
book panel be "the same component the eventual cross-library box will use". That
is already satisfied and should stay satisfied the cheap way: the book box is the
plain field primitive, because a second component whose only job was to be shared
later would be machinery built ahead of its second caller, and the matching and
the marked runs are shared as *functions* rather than as a widget
([search.ts](../../../packages/client/src/library/search.ts)).

**So this item does not extract a `SearchField`.** What the library box adds is a
toggle that reveals and clears, and it adds it in one place — the other two
inputs are always visible and want no toggle at all. A shared widget for a
behaviour with one caller would be the same mistake §5.3 refused, wearing the
other hat. It becomes worth extracting when something else needs to reveal a
search, and not before.

**Four smaller things that will bite.**

- **Closing the search must clear the query**, or the shelf stays filtered with
  nothing on screen explaining why.
- **There is a third empty state now.** *Nothing on this shelf matches these
  filters* is filter-specific wording and stops being true the moment a search
  term can also empty the list.
- **A lorebook's whole entry array is in the object.** Searching it finds a book
  by an entry inside it, which is probably wanted, and is a decision rather than
  a default — and it wants memoising, because the shelf re-polls every two
  seconds and the array identity changes each time.
- **The narrowing state belongs to the page, not the table.** It is local to the
  table today and survives a change of kind, which is already wrong and is
  invisible only because one panel has sorts.

## 10. *New actor* is a button, not a form

**The name is collected in the list, before the editor opens**, in an inline text
box with a screen-reader-only label, and the button stays disabled until
something is typed into it. It is a gate in front of a surface built to collect
exactly that field, and it is the only place in the app where a control is
disabled with nothing saying why, which is the placeholder
[work plan §2.2](docs/design/workplan/01-work-plan.md) rejects in general and which
[10 §11.1a](../10-ui-surfaces.md) has since made a rule.

**What to build.** A plain button that opens the editor on an unsaved draft. The
name becomes a marked, required field *in* the editor, which is
[10 §11.1a](../10-ui-surfaces.md)'s contract rather than a rule invented here —
the item consumes a contract that already exists, which is what keeps it inside
this file's house rule.

**The thing to get right: do not create the object first.** The obvious cheap
version — mint it immediately under a placeholder name, let the editor rename
it — is wrong here for a reason particular to this project. The folder name is
derived from the object's name **once, at creation, and then frozen**
([03 §5.2](../03-data-model.md)); renaming changes the name inside the file and
never moves the directory. An empty or placeholder name is accepted by the
server, so that version does not fail — it succeeds, and leaves `untitled`,
`untitled-2`, `untitled-3` on disk permanently, in the one part of this design
that is meant to be legible to a person with a file browser. So nothing is
written until the first Save, and the first Save is a create.

**What that costs.** The editors learn a create-versus-update branch and an
unsaved-draft state, and *leaving discards it* has to be what the unsaved-changes
guard says for a draft that has never existed on disk. The three tests that pin
the current gate — including the one that proves a name of only spaces is
refused — are rewritten rather than deleted: the refusal moves from the list to
the editor, and it should still be proved.
