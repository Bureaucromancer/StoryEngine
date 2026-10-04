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

**Landed at [P5.−1](17-p5-implementation.md)**, which is where this item stopped
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
of kinds. *Half paid at [P4.5](16-p4-implementation.md), and by the route this
note predicted: Delete needed the same gate, so rather than a second copy of it
the ownership half became one predicate both read. What is left is the part this
note is actually about — the `actors` half, which still names a kind and should
come from wherever the fields come from.*

## 2. *As stored*, kept in the library and added to the editor as a pane

**Landed at [P3.3](15-p3-implementation.md)**, as one component on all three
surfaces — the detail page, the workbench's library subject and the editor's
saved-state pane — collapsed by default, with the open state in the per-user
`prefs.json` and a copy control over the whole object. This item was struck late,
at [P5.−1](17-p5-implementation.md), and the lateness is worth a sentence: the
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
*Unblocked: B13 resolved at [P2A §2.2](09-p2a-configuration-surface.md) and the
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
export flow, which is P4's ([P4](16-p4-implementation.md)) and belongs in
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
  *Both shipped at [P2A](09-p2a-configuration-surface.md), so the escape hatch in
  the sentence above — delete the view rather than wait — is no longer needed.*
- **`/` moves to home** (item 5). Landing on an arbitrarily chosen single kind
  instead — actors, because there are usually most of those — would be a worse
  answer than today's mixed list, not a better one.
- **Each panel also supplies whether its kind can be made here**, which is the
  fourth thing alongside columns, sort and empty state.
  [P4.5](16-p4-implementation.md) put a **New actor** control on the merged
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
id alone, because id-addressing always opens the winner ([P2 §1.3](08-p2-implementation.md),
F19). That lives in the read route and the link contract, so the panels inherit
it by using the same detail route; what would lose it is a panel building its
own links from `{kind, id}`. The duplicate warning without the link is the bug
F19 already fixed once.

**Two of the five panels have a phase now, 2026-09-11.** Treatments and Presets
arrive with their editors at [P7B](24-p7b-presets-and-prompts.md), because
create arrives with the editor and the panel is what renders the button;
~~Setups and Packages stay here until theirs do~~ ***and since 2026-09-14 theirs
do too — [P7B.6](24-p7b-presets-and-prompts.md) — so all four panels travel with
their editors and none of the five is left here waiting on one***. The shared
machinery stays specified here either way.

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
lands on is the one they will bookmark and share. ***Already true, and it has
been since P4:*** `/` is a redirect to `/library` rather than a second address
for one page, under a docstring that says it is *"the address that will still be
correct after home lands."* So the routing half of this item is paid.

### 5a. Split in two, 2026-09-14 — a prototype now, the rest before beta

**This item acquired a destination three days ago and it is being changed.**
The 2026-09-11 sweep placed home at [P10.4](27-p10-implementation.md) beside the
account gallery, on the good argument that arrival before sign-in and arrival
after it should not disagree. **The diagnosis behind that placement stands and
is the reason this section reads differently now:**
[manual testing §10](05-manual-testing.md) files this file's contents as *"the
twelve polish items | unscheduled by design,"* so an item routed here was routed
nowhere — fine for eleven of the twelve, and not fine for a named surface in
[10](../10-ui-surfaces.md). What changed is the size, not the finding.

**The full version is deferred, deliberately and on the record.** It is not
core-alpha work. It stays nominally a 1.0 feature, expected to land
*immediately before the cut-over to feature-complete beta*, **and it may be
pushed further out than that** — recorded as said rather than tidied into a
phase number, because the condition is a judgement about readiness and not a
date.

**What lands first is the smallest thing that makes the address real**, at
[P7B.9](24-p7b-presets-and-prompts.md): `/` stops being a redirect, the wordmark points at
it, and the page shows the changelog. Nothing else — that fence is the stage,
and it is this section's own scope-discipline rule applied to a version of the
page that has not earned any panels yet.

***What the prototype actually buys*** is not a changelog. It is that item 4's
dependency comes undone: this item is urgent *because* item 4 takes away the
mixed table that answers *what was I doing?* today. A page at `/` does not
answer that question either — but item 4 no longer has to wait for the answer,
and the arc the file's header names (*"4 takes a landing place away, so 5 has to
provide one"*) is discharged by a page with one thing on it as well as by a page
with four.

**Scheduled 2026-09-11 at [P10.4](27-p10-implementation.md)**, beside the
account gallery: both are arrival, one before sign-in and one after, and one
stage owning both keeps them from disagreeing about what arrival is for. The
scope rule above travels with it.

### 5b. The prototype revised, 2026-09-15 — the changelog as a document

**Revisions to the prototype, not a step toward the full version**, and the
distinction is the whole of why this subsection exists rather than a commit
message. Two things were wrong with the page in use. The changelog was not
rendered — every release heading, section and bold lead reached the screen as
the characters that spell them, inside a `<pre>` — and there was no history: the
whole file at once, which is too much on arrival and too little for looking
anything up.

**What it is now.** The page shows **one** release, the newest by default,
rendered as a document. The **workbench holds the index** of every release
([10 §3](../10-ui-surfaces.md)), and opening one puts it in the page. The
selection lives in the address, `/?release=…`, because the list is in a panel
that [10 §3] calls a reader with no state of its own.

**The dependency was taken knowingly and the price is on the record.**
`react-markdown` is pinned in the client, and `/` is the entry route, so this
fires [20 §7](../20-client-loading.md)'s revisit trigger by definition. The
measurement — **+120.59 kB minified, +36.71 kB gzip, a sixth of the entry** —
and the decision not to bring P11.0's audit forward are recorded at
[20 §7.1](../20-client-loading.md), with the lazy-loading contingency
pre-argued. The struck reasoning in `HomePage.tsx` was right about the price and
wrong about the trade: sixteen kilobytes in a `<pre>` is not *legible as it
stands* when it is the only thing on the page.

***Why this is not the accretion [P7B.9] warned about.*** That stage's own note
says *"a prototype that quietly grew a session list would be that deferral being
reversed by accretion rather than by decision"*, and the test of the warning is
**which deferral**. §5's four panels — resume, start, notice, recent work — are
each a reader over *the user's own data*, needing a surface that computes
something. **None of them is here and none is nearer.** What changed is the one
thing the prototype already showed. A document that renders as a document, and a
panel listing the releases of the same document, add no new *subject*: the
page's is still *what changed in this build*, and the panel's is still *what the
main view is showing*.

**The deferral's terms are unchanged, restated here so proximity to good news
does not soften them.** The full version is not core-alpha work; it stays
nominally a 1.0 feature, expected *immediately before the cut-over to
feature-complete beta*, **and it may be pushed further out than that**.

**One seam recorded rather than solved.** [CHANGELOG.md](../../../CHANGELOG.md)'s
own preamble says the About surface planned at
[P11.6](28-p11-implementation.md) links to it to answer *what am I running*;
[P7B.9](24-p7b-presets-and-prompts.md) put the changelog on home instead, for a
reason that was explicitly *"the value is not the changelog"*. This revision
makes home much the better of the two and still does not decide what About shows
when it arrives. That question belongs to P11.6 and should not be discovered
there.

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
([P2C](12-p2c-first-real-run.md)). A new surface now inherits a palette, a type
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

**Found at [P4 §7.17](16-p4-implementation.md), named there and fixed here.** It
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
[work plan §2.2](01-work-plan.md) rejects in general and which
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

---

## 11. Something happens between Send and the first token

*Routed here 2026-09-09 by [P6B.3](20-p6b-playable.md), from
[F-02](21-playable-log.md) and graded at [R10](22-walkthrough-refinements.md).*

**Landed 2026-09-17, whole, at polish 2 (`a0e4313`)** — [§14](#14-the-composer-is-a-box-for-prose-and-send-says-it-heard-you)
below. One polite live region for the whole wait, from Send to the first word,
and a busy Send whose label is the reason it is greyed; acknowledgement and not
progress, which is this item's own bar. It took two things this item did not
describe, both found in building it: the composer stopped being a one-line
`<input>`, and the button stopped being live for the length of the POST, which
had let a second press start a second turn. Everything below is kept as the
argument it was.

**The condition is not a regression and was written down before anybody hit
it.** [P2C brief §3.4](13-p2c-brief.md) says it nearly word for word: *"There is
no progress, no step display and no spinner."* It was accepted deliberately,
and this item is not an argument that the acceptance was wrong. **What is new is
that a person walked into it across every turn of four sittings and called it
painful** — which is the evidence the acceptance was waiting for and could not
produce for itself.

**What a person actually gets today**: the button does not change, no live
region fires, and the composer clears. So the only feedback that the app
received anything is *your own text disappearing* — which is indistinguishable
from having lost it.

**What to build, and why it is one file.** The Send control takes a busy state,
and a polite live region says a turn started. Both are
`packages/client/src/ui/` — [10 §1.2](../10-ui-surfaces.md) consolidated the look
there deliberately, and `ui/classes.ts` already spells the shared control
string once. **This is not a UI pass over forty-four buttons**, which is how the
request arrived; the request was right about the symptom and wrong about the
surface area.

**What it must not become.** A spinner that claims progress the server is not
reporting. The server emits ten step events and the play page subscribes to
none of them; wiring those is a *step display*, which is a bigger thing with a
contract in it and belongs to a phase rather than here. The bar for this item
is **acknowledgement**, not progress.

**And the thing it is fighting.** [F-03](21-playable-log.md) is the same
absence one layer out — a turn in flight is invisible unless the workbench is
open — and it is *not* polish: [10 §9](../10-ui-surfaces.md) specifies it, and
it sits in [manual testing §10](05-manual-testing.md) as unowned. Doing this
item does not discharge that one, and the two should not be confused because
they feel like the same complaint.

---

## 12. A search over the settings pages

*Routed here 2026-09-09 by [P6B.3](20-p6b-playable.md), from the half of
[R3](22-walkthrough-refinements.md) the design does **not** argue back at.*

**R3 arrived as three things and only this one survives grading.** The other
two — roll the settings sections up behind disclosure, and reuse the workbench
as a table of contents — are refused by [10 §1.1](../10-ui-surfaces.md), which
rejects disclosure-as-reflex *for this surface by name*. **The complaint
underneath is real** — the settings pages are long and finding a control means
reading — and a search is the remedy that does not hide anything.

**Why it is cheap here specifically.** The idiom exists: item 9 above puts
search and sort on every library shelf, and the search input, its debounce and
its empty state are already built for the Lorebooks shelf. This is that
component over a static list of control labels rather than over an index.

**No schema change, no new contract, nothing hidden** — which is exactly this
file's house rule, and is why the other two thirds of R3 are at
[25 E10](../25-open-questions.md) instead.

---

# The 2026-09-17 review, and the pass that answered it

**A read of the client on 2026-09-17 found what follows**, and it was approved as
twelve commits, titled *Polish 1* to *Polish 12*. The first four landed the same
day. The rest waited behind the audit of `main` approved on 2026-09-25 — the
decision was *audit tiers first* — and landed on 2026-10-01; this record is the
twelfth. **An entry's number is not its commit's**: entries 13 to 23 are commits
1 to 11, in order, and each says what was found, struck, then what shipped.
Entry 24 is what the pass found and left, unstruck, because it has not shipped.

Where a finding turned out to be the same as an audit fix, it went with the audit
and is said here only by reference: the reading view's title for an unnamed
session, and refusals read by their class rather than by their English, both
landed in the audit's Q tier.

---

## 13. The story prints

**Landed 2026-09-17 at polish 1 (`b2926fc`).** ~~*A printed story is its first
page.*~~ [10 §12.2](../10-ui-surfaces.md) makes the browser's print-to-PDF the
whole PDF story, and since [P3.−1](15-p3-implementation.md) `<main>` has been the
scroll container — a box with a definite height and `overflow: auto`, which
Chrome and Firefox print as one page. The print block now releases the
scrollport, and `Shell.tsx` releases its two height-managed ancestors at the
call site. The docks, the restart banner and the toast stay off the paper, and an
illustration is bounded by the column rather than stretched to it.
`theme.test.ts` holds that the release is present; whether it prints well is
still [manual testing](05-manual-testing.md)'s row R2.

## 14. The composer is a box for prose, and Send says it heard you

**Landed 2026-09-17 at polish 2 (`a0e4313`)**, and with it all of
[§11](#11-something-happens-between-send-and-the-first-token). ~~*A turn is typed
into one line that scrolls sideways; Send stays live while the turn is posted, so
a second press starts a second turn; and nothing says anything until the first
word.*~~ A textarea that starts at one line and grows — at three rows the
transcript collapsed to nothing at 720px, which is a measured finding rather than
a caution — with Enter to send, Shift+Enter for a paragraph, and an input
method's Enter left alone. One live region for the wait, focus given back to the
box when a turn ends, and Stop as a mutation that can say it failed.

## 15. The per-turn controls exist on a touch screen

**Landed 2026-09-17 at polish 3 (`783fe9d`).** ~~*Every per-turn gesture —
Redo, Reroll, Continue from here, Illustrate, Remember this, Undo — is invisible
on a device with no pointer.*~~ Tailwind's `hover:` is `@media (hover: hover)`,
so a row held at `opacity-0` until hover never showed on a phone, while staying in
the tab order and taking taps. `ui/classes.ts` gained `reveal` with the
`(hover: none)` arm, and `theme.test.ts` refuses `opacity-0` anywhere else. With
it: the header folds; every dialog takes the height cap only `large` had; below
`sm` an open dock is the view rather than a neighbour of it; the shelf scrolls in
its own wrapper. It named the two nested `<main>`s and left them for
[§23](#23-the-keyboard-and-the-screen-reader-get-there-too).

## 16. The appearance layer, which had grown back most of what it removed

**Landed 2026-09-17 at polish 4 (`78c4cf5`)** — [§6](#6-the-styling-layer-and-the-second-theme-it-exists-to-allow)'s
conditions, returned. ~~*`control` spelled four ways, three without the
disabled half; `Note` re-typed at 58 sites; three button variants without a
disabled state of their own; nothing you press drawing the focus ring that
everything you type into does; fourteen `<summary>`s in seven spellings.*~~ Each
fix is argued by a docstring already in the tree. It also gave Sessions, Search
and Reading the page-title step — the *h2 start* the accessibility entry was
later approved with — and the reading view one title element for screen and
print.

## 17. The story has a face of its own

**Landed 2026-10-01 at polish 5 (`04e45a5`).** ~~*The story is set in the
browser's default sans, the same as every label around it.*~~
[10 §1.2](../10-ui-surfaces.md) separates the quiet surfaces by type, measure and
chrome, and type was only a size. Two system stacks, no webfont: an interface
face on `body`, a book face — Charter, Sitka Text, Cambria and their kin — on
every `text-story`, held together by `theme.test.ts`.

## 18. The action colour is a colour

**Landed 2026-10-01 at polish 6 (`8bea85f`).** ~~*The accent is slate-800, so a
primary button reads as a heavier paragraph, and the selected chip and the focus
ring are grey on grey.*~~ Indigo in all three theme blocks, at the lightness the
slate steps had where it mattered, so a disabled button looks exactly as disabled.
`contrast.test.ts` measures a button's label at rest and under the pointer
against 4.5:1 and the ring and the accent against 3:1, both themes.

## 19. Finding your way back

**Landed 2026-10-01 at polish 7 (`8a9cd32`).** ~~*A notification names its
story and does not link to it; the reading view has no way back to the session;
the header lights every surface but Settings.*~~ The notification's title is a
link that marks it read and closes the list; the reading view has Compare's
*Back to the session*, under a failure too; Settings is drawn as the surfaces
are. A fourth finding, search hits on an unnamed session as zero-width links,
had gone with the audit.

## 20. Destructive actions ask once, the same way everywhere

**Landed 2026-10-01 at polish 8 (`8ae68e4`).** ~~*One removal asks and loses
the keyboard doing it; the rest go at the first click, a tag's under a button
called Remove in a column of them, a story's hook from the server.*~~
`ui/TwoStep.tsx` is the one way: the keyboard to Cancel and back, the question
announced by describing the answers rather than by a live region, a slow answer
held. Spent on every editor removal, a tag's Remove and Prune, the play surface's
hook, and Restore over unsaved edits. Not on the three that cannot be undone from
inside the app, which ask for more than a click.

## 21. The play surface answers

**Landed 2026-10-01 at polish 9 (`2a3b4b2`).** ~~*A dozen play-surface writes
say nothing when refused, and the few that speak have one sentence, so `busy` —
a turn in flight — reads like a fault.*~~ `play/WriteFailed.tsx` reads a refusal
by class: `busy` says to wait, anything else is the panel's own sentence.
Illustrate is answered where it was pressed; a fresh install says no model is
bound before the first Send; the sessions list says when it is loading, unreadable
or empty; the hook form marks its premise required.

## 22. The library and settings answer

**Landed 2026-10-01 at polish 10 (`5cd0838`).** ~~*Import's Cancel is live while
the import runs and stops nothing; an unreadable trash says nothing was deleted;
a first Save lands on a page that says there is nothing to save; the empty
library points at the API; two copy buttons say different things; Search and
Rename reveal a box the keyboard is not in; History shows nothing where it was
pressed; Priority drops a stored number on a typo.*~~ Each now says what
happened. One the review did not have: `docs/deploy.md` called notifications
*the one thing plain HTTP costs you*, and the clipboard is the second.

## 23. The keyboard and the screen reader get there too

**Landed 2026-10-01 at polish 11 (`73be6b6`).** ~~*Nine header controls before
every page's own; a second `<main>` on Search and Reading; a radio group the
arrows do nothing in; a filled composer and a returned search that nobody hears;
an illustration read as its sentence twice; lists of buttons all called
Remove.*~~ A skip link; one `<main>`, which `shell-layout.test.tsx` now counts on
both pages; the radio group's arrows; focus into a filled box and a status line
for search; the empty alt the play surface already gave; buttons named for what
they act on. Two more in the same rows: committing a hook past a refusal now keeps
the keyboard, and a move with no persona reads *You did* rather than *DID*.

## 24. What the pass found and left

Unstruck, because none of it has shipped.

- **The history panel's per-version buttons are unnamed.** Five versions are five
  *Restore*s, *Diff*s, *Rename*s and *Pin*s, the list §23 fixed elsewhere.
  *Restore revision 3* is the fix; it was left out of §23 to keep that commit to
  the removals it was approved for.
- **A route change is silent to a screen reader.** Nothing announces the new
  page or moves focus to its title, which a single-page app owes and the router
  does not do. Bigger than a polish commit: it wants one decision for every
  route.
- **Renaming a session shows the server's English** where every other refusal in
  the client is read by its class.
- **The context meter in the dark theme** fills `accent-muted` on a slate-800
  track at about 1.45:1, as faint as before §18. The figure beside it carries
  the number, so it is not a WCAG 1.4.11 failure; it is a meter that barely
  reads as one.

---

# Filed after the pass

***Numbering carries on from the pass, and an entry here is not one of its
commits.*** §25 was built on 2026-09-26 on a branch cut when this file ended at
§12, and was §13 there; the review's entries took §13 to §24 on `main` on
2026-10-01, and when the two met at the merge (2026-10-03) the later filing took
the next free number. Every citation of it moved with it — thirty-three in
fourteen files — and nothing outside the branch had cited it.

## 25. A connection can be tried without taking a turn

*Built 2026-09-26, routed here from
[P2B §5](10-p2b-provider-configuration.md), which put it out of scope in so
many words: "a connection health check beyond the model fetch — *is this key
still good* is a live call with a cost, and it belongs with the connectivity
work P10 does once P11's producer exists." Both have landed, and
[P11.6](28-p11-implementation.md) gave `/models` the `offline` code this
answers in. Merged to `main` 2026-10-03, adapted to what `main` had become in
the week between — see* Merged a week later *below.*

**The condition it fixes.** The connections surface had one way to touch an
endpoint — *ask it what it offers*, a `GET /models` — and that one sends only
what is typed in the form, so it cannot use a stored key, and it never calls
`/chat/completions` or `/images/generations`, which are the two calls a turn
makes. So the first real evidence that a connection works was a failed turn.
For pictures it was worse: `rendersImages` could only be set by editing the
file, and [manual testing R10](05-manual-testing.md) — *an endpoint that serves
the `image` role* — had no cheap way to be confirmed before P9's gate.

**What shipped.**

- A **Test** button on every connection row, admin and personal, opening a
  panel with a model picker, an editable prompt that starts filled, and the
  answer: the reply or the picture, how long it took, which model answered when
  that is not the one asked for, and what it used. Not on a row nothing
  resolves to, under the same guard as that row's Edit and Remove.
- A ***Makes pictures*** control in *What this endpoint can do*, merged over
  what is stored the way *reports token counts* is, in a group headed *Drawing
  pictures* so it cannot be read as [25 E15](../25-open-questions.md)'s *Models
  that can see pictures* beside it. **Try a picture** is offered only where it
  says yes, and the server refuses a picture anywhere else before sending
  anything.
- ***Sends a seed with a picture*** beside it, shown once *Makes pictures* says
  yes — `supportsImageSeed`, which the youthful-keller merge made the seed's
  gate on 2026-10-03 and left a hand edit (see *Merged a week later*).
- `POST /api/admin/connections/:id/test` and its personal twin
  ([`api.md`](../../api.md)), and a `status` on `ProviderError` — carried on
  through `CallFailed` — so a refused key and a refused request, both
  `terminal`, can be told apart, which is finding 5 in the
  [P2C log](14-p2c-log.md) arriving at its second route.

**Why it is polish and not a phase stage.** It changes what a person sees and
does, it is bounded, and it needs no schema change — `rendersImages` has been a
stored capability since [21 §3](../21-internal-contracts.md), and
`supportsImageSeed` since the merge before this one — and no new contract: two
routes in the model fetch's family, an optional field on two internal classes
nothing in 21 specifies, and one more value in a field 21 does specify, the
usage line's `role` ([21 §1.4](../21-internal-contracts.md), recorded there),
which is additive inside `storyengine.usage/1` and read by nothing yet.
[Item 8](#8-five-sampler-settings-the-adapter-drops) is the precedent for
server work in this file. P10 and P11 are both merged, so a stage heading there
would have claimed more than this is.

**What it deliberately is not:**

- **Not automatic.** It costs money, and a picture can cost more than a turn, so
  it is a button a person presses and nothing else —
  [10 §11.5](../10-ui-surfaces.md)'s first trap.
- **Not a test of a turn.** It sends one user message, a completion ceiling of
  256 and no sampler settings, through the non-streaming call. It proves the
  key, the address and the model; it says nothing about a preset or about
  streaming.
- **Not a test of the form.** It tries what is *saved* — the stored key through
  the same memoised provider a turn gets — and refuses a body carrying a key.
  Unsaved edits have to be saved first. That keeps the key on the server and
  means a pass is a promise about turns.
- ~~**Not recorded.** [10 §11.4](../10-ui-surfaces.md) says a model call that is
  not a turn must still be recorded; nothing in this build records one, field
  assists included, and a test button is not where a ledger should start. The
  log line's token counts are the only trace, and that gap is §11.4's, not this
  item's.~~ ***Recorded*** *(2026-10-03, at the merge: the struck sentence was
  true of the build it was written against and false of `main` from 2026-09-27,
  when c814f3ed gave the calls that write no turn a usage log — field assists
  first)*. A test that returns writes one line to the presser's `usage.jsonl`;
  see *Merged a week later* for the role it carries and why.

**The model that thinks first.** The ceiling is 256 rather than something
smaller because a reasoning model spends its first tokens where nobody sees
them, and at a tiny cap it returns *no text, finished by length* — the exact
shape of a broken endpoint. That answer is a `200`, and the panel says so in a
sentence: the key, the address and the model all worked, and a turn gives it
far more room.

**Merged a week later, and what that changed.** The branch was written against
a `main` that had no usage log, no rule about how a model call is made, no
`disconnectSignal` and no per-model vision list, and it met all four at the
merge. Four questions that raised were put to the owner, who deferred each to
its recommended answer; they are recorded here as decisions, **2026-10-03,
recommended answer, owner deferred**:

1. ***The message goes through `performCall`***, like every call that is not a
   turn since 8c34a7f7 (2026-09-27), which moved the field assist — the last
   direct caller — because it was the one call with no idle bound, no retry
   ladder and no classification. So a test message is planned, timed, retried
   and classed as a turn's call is, and the branch's *one attempt* goes: a 429
   that clears on the second ask clears for a turn too, so answering `busy` to
   it reported a fault no turn would meet. A 429 that lasts the ladder is still
   `busy`. It also earns one refusal the branch had no way to give:
   `window-too-small`, when the connection's own context window cannot hold the
   test beside its reply — which every turn would meet too. **The picture does
   not, and cannot**: `performCall` has no picture arm, `renditions/worker.ts`
   calls `renderImage` directly for the same reason, and a picture is asked
   once by the owner's other decision of the day
   ([25 E7](../25-open-questions.md)), so it keeps the branch's one bounded
   attempt. Argued at the route as well as here.
2. ***It is recorded***, in the usage log of whoever pressed it, admin or not,
   with the purpose `connection-test:text` or `connection-test:image` and the
   role **`connection-test`** — a value no binding can have, because a test
   resolves no role, and any real role written there would fold a person's
   tests into a spend view's figures for that role. A failed or cancelled test
   writes nothing, as the field assist, impersonation and Illustrate's moment
   call do — which is not `main`'s one rule, because there is none yet: the
   on-demand step behind *Update trackers* and background summaries, both since
   P14, write a line for a failed or cancelled call that reached the provider,
   with null figures. The picture's line is the one image call the log
   carries: a rendition's cost has no field
   ([25 E16](../25-open-questions.md)), and a test picture leaves no record of
   its own.
3. ***It stops when the person leaves*** — `disconnectSignal`, as Illustrate
   and the field assist take it, on both arms. The branch had argued that
   aborting a picture does not un-spend what a hosted endpoint has already
   accepted; that is still true, and nobody is left to see the answer, the
   server stops holding a socket for it, and an endpoint that notices a closed
   request stops working. A request ended so answers nothing and logs nothing
   at error level.
4. ***A control for `supportsImageSeed`, beside* Makes pictures**. The
   youthful-keller merge made the seed travel only where that capability says
   so, left it settable only by hand, and recorded the control as owed at
   [P9 §3.2](26-p9-implementation.md) — [work plan §2.3](01-work-plan.md)'s
   *no configuration without a surface*. It is shown only once *Makes pictures*
   says yes, and hiding it never clears a value written by hand.

Three smaller things the merge took on without asking, because the code would
otherwise have been wrong on `main`: a stall the transport reports from below
(undici's header and body limits, `ProviderError.stalled`, 2026-09-27) answers
`timeout` rather than falling through to `refused`; *Load what is on disk*
after a refusal reloads the two picture overrides, which it was written before
the form held; and the Test button sits under `main`'s guard on a shadowed
row, which had grown to cover Edit and Remove while the branch was out.

**A code/doc disagreement this found and does not fix.**
`ProviderCapabilities.rendersImages`' docstring in `providers/types.ts`, and
[21 §3](../21-internal-contracts.md) beside it, say the binding surface reads the
flag. Nothing in the client does: the role table offers every connection for
the `image` role. Filtering it is a role-table change with its own argument
about what an unset `image` role should look like, and is left for that. *Still
so at the merge (2026-10-03)*: the form now sets the flag, and the role table
still does not read it.

**Proved against doubles only.** Every test of the button, the routes and the
form runs against `FakeProvider` or a stub transport — the real adapter over a
stubbed `fetch` for the image arm's rate limit and its first adapter-level
picture test — and none against a live endpoint: the machine this was merged on
has none configured. Which sentence a real 401, a real 404 and a real stall
produce is sitting V's to say.

**What the changelog will say**, parked here because
`changelog.test.ts` refuses an `## Unreleased` section:

- **A connection can be tried.** *Test* on any connection sends one short
  message — or, where the connection makes pictures, one picture — using what
  is saved, and says what came back or, in plain words, which field to go and
  fix. *Makes pictures* and *Sends a seed with a picture* are settings on the
  connection at last.

**What needs a person:** [sitting V](05-manual-testing.md#v--a-connection-tried--twenty-minutes-and-it-wants-r2-and-r3)
— a real hosted endpoint and a real local one, a wrong key, a model the
endpoint does not serve, and R10 if one is to hand.

## 26. A connection that hides another says so

*Filed and built 2026-10-04, from the known follow-up the loving-bardeen merge
recorded under [P2B §1.5](10-p2b-provider-configuration.md) on 2026-10-03 and
tracked, unowned, as a row of [manual testing §10](05-manual-testing.md). That
merge left one question open — should the collision also show in the
Connections list? — and its review recommended no answer to it.* **Decided
2026-10-04, recommended answer, owner deferred: show it.** The question was put
again with that recommendation, and the owner deferred to it; this entry is
where to overrule it.

**The condition it fixes.** A personal connection file whose id an install
connection also claims wins that id for its owner: every job naming it — the
person's own choices *and* the install's defaults — reaches the personal file,
on the personal key. Since [P2B §2.4](10-p2b-provider-configuration.md)'s
*Amended 2026-09-27* that reaches nobody else, and since the merge it was
reported — as a count in the runner's log, `connections.shadowing`, at `warn`.
Nothing on screen said it. *Your connections* read `shadowed: false` for the
file, which is true, since it is the one that wins, and silent about what it
hid; an administrator's install row looked like any other; and *Which models
your stories use* offered the hidden connection's models as choices that saved
cleanly and then sent to the personal file — and, where both connections listed
a model, two options with one value. A create through the form mints a uuidv7
and cannot collide, so the file arrives by a hand copy or by a backup import,
which copies ids verbatim (`backup/import.ts`): exactly the cases where nobody
chose it.

**What shipped.**

- **Your connections.** A row that wins an install connection's id says so in
  a sentence naming that connection: your stories use this one wherever a job
  is set to it, *including this install's defaults*; everyone else still uses
  the install's; remove this one if that is not what you meant. The row keeps
  **Test**, **Edit** and **Remove**, and Remove is the undo.
- **Administration → Connections.** The install row an administrator's own
  file hides says it is hidden *for them*, that everyone else still uses it,
  and that changes there still reach everyone else. It keeps its controls.
- **Which models your stories use.** The hidden connection's models are not
  offered, and a sentence above the table says why — once, even where two
  install files share the id *and* the label, a straight copy inside the
  install's folder, since every install claimant is marked and two identical
  sentences say nothing the first did not. A job already set to it —
  the natural order is choosing the install's connection first and restoring
  the file second — reads as the file it reaches. *Where that file lists the
  model*, which a straight copy always does, it is simply that file's option,
  *"gpt-hi — My copy"*, since the two share the value `<id>\n<model>`; *where it
  does not*, it reads *"gpt-lo — My copy, which does not list it"*, rather than
  *on a connection that is gone*.
- **On the wire** ([`api.md`](../../api.md)): `shadows: { label }` on a
  `/api/me/connections` row, on the list and on an edit's answer, and
  `shadowedBy: { label }` on a `/api/me/roles` connection. A label each, and
  nothing else of the other connection. **One function pairs them**,
  `shadowsAcrossScopes` in `providers/connections.ts`, which the resolver's
  `shadowing` list — and so the runner's count — now comes from too, so *which
  personal file wins an id* is decided once rather than three times.

**Decisions taken in building it** — each **2026-10-04, recommended answer,
owner deferred**, recorded here so that each can be overruled on its own:

1. ***Both rows keep their controls*** — against the letter of `main`'s
   shadowed-row rule (no Edit or Remove on a shadowed row, 2026-09-27, and no
   Test either since §25) and in keeping with its reason. That rule exists
   because those buttons act on an *id* and, within **one** directory, reach
   the other file of two. Across scopes they cannot: the personal routes reach
   the personal directory and the admin routes the install's, so every button
   on either row acts on exactly the file it is drawn under. Taking them off
   the personal row would remove the undo; taking them off the install row
   would let one person's file stop an administrator managing a connection
   everybody else still uses. So `shadowed` keeps its meaning — *nothing
   resolves to this file* — and the new fields sit beside it rather than
   overloading it.
2. ***The install row's sentence reads `/api/me/roles`, not the admin route.***
   It is a fact about one person's turns, and the admin routes answer *what has
   the install got* and nothing narrower ([P2B §2.7](10-p2b-provider-configuration.md)'s
   line, which `GET /api/admin/roles` keeps too). The query is the one the role
   pane already holds on the same page, needs no capability, and carries the
   server's answer, so the client decides no precedence of its own.
3. ***Left out of the role picker, not relabelled.*** Two options with one
   value cannot both be chosen, and the one a person picked would not be the
   one saved.
4. ***Said, not refused or repaired*** — [P1 §1.2](07-p1-implementation.md)'s
   *nothing blocks*, which [P2B §2.3](10-p2b-provider-configuration.md) adopts
   as *reported, not repaired*. The file still wins for its owner, as P2B §1.5
   says it should.

**Why it is polish and not a phase stage — and the row that said otherwise.**
The house rule wants no schema change and no new contract. Nothing stored
changes. The [manual testing §10](05-manual-testing.md) row filed at the merge
said *deferred rather than polish*, because showing it needs a new field on one
of the two routes and the `api.md` text to match — *a new contract*. §25,
merged the same day, read the rule the other way: its *no new contract* covered
two whole routes and optional fields on classes
[21](../21-internal-contracts.md) does not specify. On §25's reading, two
optional fields on existing responses,
neither specified by 21, are not a new contract, and that is the reading taken
here; that row is struck and noted rather than left disagreeing. And
[P10](27-p10-implementation.md), whose P10.3 built *Your connections*, is
merged, so a stage heading there would claim more than this is — §25's
argument, unchanged.

**What it deliberately is not:**

- **Not a cross-account view.** Each person sees what their *own* files hide;
  an administrator is never told which accounts' files hide an install
  connection. The runner's count stays the operator's only trace of that, by
  [09 §4.5](../09-server-multiuser-deployment.md)'s rule as the runner applies
  it: counts, never contents.
- **Not about two files in one scope.** Two personal files claiming one id were
  already marked `shadowed`, and so were two install files on the admin list.
  ***Found and left***: the role picker still offers *both* of two install files
  claiming one id, which is this entry's defect in the install's own scope — a
  person sees two connections, and choosing the second binds the first. The
  remedy is the same field one case wider; it is left because the sentence it
  would carry is one only an administrator can act on, and that wants its own
  wording.

**Proved against** `providers/connections.test.ts` (*what each row says it
hides* — the pairing, the winner of two personal claimants, the install file
resolution would fall back to, every install claimant marked, nothing when the
capability is off), `routes/my-connections.test.ts` and `routes/me.test.ts`
(the routes, by label alone, with neither the install key nor its address in
the body), and `settings/Connections.test.tsx` and `settings/MyRoles.test.tsx`
(both sentences, the controls kept, the picker, the role pane's sentence said
once for two install copies sharing an id and a label, and the held binding
both ways — a model your file lists and one it does not). Each mechanism was
reverted and the tests seen red before it was restored.

**What it cost the entry bundle**: **0.41 kB** gzip, from 335.55 to 335.96
against `tools/entry-budget.test.ts`'s ceiling of 336, which leaves 0.04 — so
the next client change meets that ceiling, and the file says so in its own
words rather than this entry raising it.

**What the changelog will say**, parked here for §25's reason:

- **A connection of yours that shares an install connection's id says so** — on
  your row, on the install's row where you can see it, and in *Which models
  your stories use*, which stops offering the one that can never answer.

**What needs a person:** [sitting Z](05-manual-testing.md#z--a-connection-that-hides-another--ten-minutes-a-text-editor-and-a-second-account)
— a file copied by hand, read on both rows by somebody who did not make it.
