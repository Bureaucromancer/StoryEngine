# 25 — Polish list

**Status: intent, not a proposal.** A running list of things that are worth
doing and are not roadmap items. The distinction matters, because
[11](11-roadmap.md) has a bar — an entry there is a *feature* deferred past 1.0,
and it earns its place by being additive to the data model. Nothing here clears
that bar and nothing here should have to. These are the small differences
between a surface that works and a surface that is pleasant, and every one of
them is the kind of thing that is obvious the moment a real person uses the app
and invisible while reading the spec.

**The house rule for this file:** an item belongs here if it changes what a user
sees or does, is bounded, and needs no schema change and no new contract. If an
item turns out to need either, it stops being polish — move it to
[11](11-roadmap.md) or to the phase plan it actually belongs to.

Order is intent, not priority. Two of these are arcs and should land in order:
items 1 and 2, and items 4 and 5 — 4 takes a landing place away, so 5 has to
provide one.

---

## 1. A by-field view in the library, without opening the editor

**Today.** The library detail page
([ObjectDetailPage.tsx](packages/client/src/library/ObjectDetailPage.tsx)) shows
a metadata block — kind, folder, identifier, schema, timestamps, content hash —
and then the whole object as pretty-printed JSON. To read an actor's
personality or its greeting the way it was *written*, you open the editor.

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
editor's, not a second layout that drifts. The editor already derives its fields
from the schema ([Field.tsx](packages/client/src/editor/Field.tsx),
[form.ts](packages/client/src/editor/form.ts)); the read view should derive them
the same way, so a schema addition shows up in both without a second edit. That
is the whole design constraint — one description of a kind's fields, two
renderings of it.

**Also worth doing while in there:** the Edit button is currently gated to
`actors` and `source === 'user'`. As other kinds get editors that condition
should come from the same place the fields do, rather than growing a second list
of kinds.

## 2. *As stored*, kept in the library and added to the editor as a pane

**Keep it.** The `As stored` block on the detail page stays after item 1 lands.
It is not a placeholder for the by-field view and it is not developer debris —
it is the surface that teaches the storage model, and that is a deliberate
position ([05 §5](05-ui-surfaces.md)): the folder *is* the object, and a user who
can see exactly what is on disk is a user who will confidently open the file. It
is also the only view that shows fields the client does not know how to render
yet — extension-written keys, newer schema fields, anything a hand edit added.
Losing it would make those invisible rather than merely unstyled.

**Add it to the editor too**, for the same reason: the editor is where hand
edits and app edits meet, and being able to check what the save actually wrote
is the answer to a whole class of "did that take?" doubt.

**Collapsed by default, in both places.** An expandable pane, closed on arrival,
its state remembered per user rather than per object. In the library that is a
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
[history.ts](packages/server/src/storage/history.ts)) and the panel can pin,
rename and restore ([HistoryPanel.tsx](packages/client/src/editor/HistoryPanel.tsx)).
The version string is theirs, the revision counter is ours, and the two are kept
apart on purpose ([02 §11.5](02-data-model.md)).

**What is missing is the gesture that connects pinning to that string.** Pinning
already means *this one matters, do not prune it* ([02 §11.3](02-data-model.md)).
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
- **Numbering a version does not rewrite the object.** Setting `1.2` on a
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
export flow, which is P4's ([22](22-p4-implementation.md)) and belongs in
[02 §11.6](02-data-model.md) once settled. The intended shape:

- **Native export (`.seactor`, `.sepack`) sends the active version**, with
  **full history as an opt-in** on the export. This is [02 §11.6](02-data-model.md)
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
([LibraryPage.tsx](packages/client/src/library/LibraryPage.tsx)). Every object
the user has, of every kind, in one table sorted by nothing in particular.

**The position is settled and lives in [05 §5](05-ui-surfaces.md)** — one panel
per kind, because the kinds are distinct by design and a merged table teaches
otherwise; the all-kinds view behind a preference, because a cross-kind list is
a search result rather than a way to browse; the naming and prominence in
[05 §5.1](05-ui-surfaces.md). What is left here is the client work.

**What the change is.**

- **Six panels**, one per portable kind (`LIBRARY_KINDS` already enumerates
  them), using the presented names — Actors, Worlds and Games offered,
  Lorebooks, Presets and Packages reachable.
- **Shared machinery, per-kind surfaces.** One list component, one set of
  badges, filters, sorting and actions, one detail route. What each panel
  supplies is its columns, its sort and its empty state. Today's
  `ObjectTable` is most of that already, with the Kind column falling away
  wherever it is the panel's own kind.
- **The all-kinds view moves behind a preference**, off by default, alongside
  whatever other "show me the machinery" settings accumulate — the same instinct
  that keeps §2's *As stored* pane. Removing it outright is acceptable if the
  preference plumbing is what stands between this and shipping.
- **`/` moves to home** (item 5). Landing on an arbitrarily chosen single kind
  instead — actors, because there are usually most of those — would be a worse
  answer than today's mixed list, not a better one.

**Nothing server-side changes.** The API goes on accepting an absent `kind`, and
the tests that cover it stay as they are — this is a client presentation
decision and should stay one.

**One thing the panels must carry over.** P2.0 makes a shadowed duplicate-id row
individually addressable — the row links by a path discriminator rather than by
id alone, because id-addressing always opens the winner ([20 §1.3](20-p2-implementation.md),
F19). That lives in the read route and the link contract, so the panels inherit
it by using the same detail route; what would lose it is a panel building its
own links from `{kind, id}`. The duplicate warning without the link is the bug
F19 already fixed once.

## 5. A home, so arrival is not an arbitrary library view

**What home is and what it holds is [05 §2.1](05-ui-surfaces.md)** — resume,
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
