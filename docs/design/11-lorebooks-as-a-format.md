# 11 — Lorebooks as a format in their own right

**Status: position.** This document argues a stance about what a lorebook *is*;
it defines nothing and changes no schema. The surfaces it calls for are specified
in [10 §5.3](docs/design/10-ui-surfaces.md), [10 §11.2d](docs/design/10-ui-surfaces.md) and
[10 §14.5](docs/design/10-ui-surfaces.md), and the work is sequenced as the document half of
[P5](docs/design/workplan/17-p5-implementation.md). It sits here rather than folded into
[03 §3](docs/design/03-data-model.md) because it is a claim about the format's *audience*
rather than about its shape, and because it cuts across the data model, the
library and the exchange story at once — the same reason
[08](docs/design/08-cross-session-memory.md) is its own document.

---

## 1. The position

**A lorebook is a portable, semi-structured encyclopedia that happens to feed a
model, and this project has built everything for the second half of that sentence
and nothing for the first.**

The observation is not ours, and it is worth stating in the form it arrived in.
People are using lorebooks to hold alternate-history settings, fictional
geographies and reference material they have no intention of ever putting in
front of a model, because the format turns out to be a pleasant unit of
authorship: bigger than a note, much smaller than an article, and independent
enough that a setting can be rearranged without tearing up a manuscript. The
niche it occupies is the one between `setting-notes.txt` and *I suppose I have to
install MediaWiki now*, and nothing else occupies it well.

[03 §3](docs/design/03-data-model.md) already says the format has converged and should be
taken essentially unchanged. That was argued on interchange grounds — every
lorebook anyone has is shaped like this, so diverging costs import fidelity and
buys nothing users can perceive. This document reaches the same conclusion from
the other end: the format is worth keeping not only because everyone else uses
it, but because it is *good*, and the properties that make it good are legible to
a reader who never runs a model at all.

### 1.1 The thesis

> **The format needs no work; the *address* does.**

A lorebook is the only library kind whose object is a **collection**. An Actor is
one document with fields. A Treatment is tone plus links. A Preset is machinery,
a Setup is a starting configuration, a Package is a manifest. A Lorebook is a
record with a corpus inside it — and the library, which addresses objects, is
therefore off by one level for exactly this kind and no other.

[10 §11.2c](docs/design/10-ui-surfaces.md) already wrote half of this, in order to justify
entry-level import and export:

> *"the book is the unit of play and frequently not the unit of authorship."*

That sentence was spent on exchange and it buys a great deal more. If the entry
is the unit of authorship, it is also the unit of **reading**, of **searching**,
of **linking** and of **addressing** — and today an entry has none of those,
because it has no address. Give it one and the rest follow from it rather than
each having to be designed separately.

### 1.2 The philosophical claim is the warrant, not the thesis

Worth separating, because the two produce different documents.

*Lorebooks are a good knowledge format independent of LLMs* is true, and it is
why this pass is worth doing. It is not a specification, and treating it as one
produces a mood board — an aspiration to be wiki-like, discharged by whoever
builds the page. Treated as a **warrant** it produces a constraint instead, and
the constraint is what keeps the pass safe:

> **The reading surface must be legible to someone who never runs a model.**

Which is [10 §2.1](docs/design/10-ui-surfaces.md)'s *no invented vocabulary* rule arriving
from the opposite direction, and it lands in the same place: the surface shows
the file, and helps by arranging it rather than by translating it.

---

## 2. What the format already gets right

Each property below is something the format does well, and each is already
carried by a field that ships today. None of them needs building. All of them
need *showing*.

- **Atomic entries.** One concept can be rewritten without touching the others.
  This is the property a document fights, because a document wants a sequence —
  introduction, divergence, politics, economy, conclusion — and settings are not
  shaped like that. `entries[]` is the whole mechanism.
- **No mandatory hierarchy.** *British small arms* does not have to decide
  whether it belongs under Military → Britain → Equipment or Technology →
  Firearms. `folderId` is nullable and `tag` is open vocabulary, so an entry can
  be filed, or not, or filed one way and found another.
- **Soft indexing.** `keys` and `secondaryKeys` are, to the engine, activation
  triggers. To a reader they are **aliases and index terms** — the surface forms
  a concept goes by. That one field serves both is the format's happiest
  accident, and it means an index already exists inside every book anyone has
  ever written. Nothing reads it as one.
- **Portable toggles.** `enabled` on the book, `enabled` on the entry, and — the
  strong one — `enabled` on the folder, which the schema documents as *a gate:
  when false every entry inside is inactive regardless of its own `enabled`,
  which is preserved rather than mutated*. **That is a variant switch.** *Does
  this timeline contain the 747 airborne carrier?* is one folder gate, today,
  rather than a forked copy of the whole setting. It has no surface at all.
- **Self-contained entries as writing discipline.** The format pushes authors to
  write entries that stand alone, because titles and trigger metadata are not
  inserted into context and an entry leaning on its neighbours arrives naked.
  That is good discipline for human notes for the same reason it is good for a
  model: both meet the entry independently.
- **One file.** A much larger advantage than it sounds. *Here is the setting* can
  mean one file rather than a vault, a repository, or an account on something.
  [03 §5.1](docs/design/03-data-model.md) already stores a book as one JSON document and
  [10 §5](docs/design/10-ui-surfaces.md) already commits that export produces one file.
- **Composability.** A scenario takes the subset of books it needs, and *this
  work is compatible with A and B but does not require C* is a useful thing to be
  able to say even if no model ever reads the files. The mechanism is already
  right: books do not point at books, consumers link books
  ([25 B2](docs/design/25-open-questions.md)), and the cohesion is delivered as a view
  ([10 §5.2](docs/design/10-ui-surfaces.md)) rather than bought with a schema.

### 2.1 The corollary about the machinery, and the misreading it prevents

The properties above are carried by a handful of fields. The other thirty are
`probability`, `depth`, `scanDepth`, `recursiveScanning`, `groupWeight`,
`delayUntilRecursion` and their relatives — and to somebody browsing a setting
they are **application metadata**, in the way a font-embedding table is metadata
to somebody reading a book.

**This is not a demotion, and the distinction matters because the obvious
misreading of this document is that the activation fields are unimportant.** They
are the reason the format exists, and [03 §3.1](docs/design/03-data-model.md) is explicit
that *each flag is a direct UI control* — which this document does not reopen and
[10 §11.2d](docs/design/10-ui-surfaces.md) honours field by field. The claim is narrower and
concerns **prominence** only: a surface for reading a setting should lead with
what the setting says, and a surface for tuning activation should lead with the
tuning. Those are two jobs, and the library already knows how to hold both —
[10 §2.1](docs/design/10-ui-surfaces.md)'s *browse and inspect are raw; editing is assisted*
is the same split one level up.

---

## 3. Raw is a claim about the words, not about the layout

**The objection has to be met first, because it is a good one.**

An entry rendered as a titled article — index terms under the heading, a summary
line set apart, the body in reading measure — is *exactly* the translation layer
[10 §5.1](docs/design/10-ui-surfaces.md) withdrew. That section killed *Worlds* and *Games*
as panel names for being friendlier than the schema, and concluded that the
library's one job is *"saying plainly what the thing on disk is called."* A
reading view is friendliness with a better haircut, and it deserves to be
suspected on precisely those grounds.

**The licence, and it is one sentence inside the same section that raises the
objection** — [10 §2.1](docs/design/10-ui-surfaces.md):

> *"Raw means no invented vocabulary, no hidden fields, no lossy summary — it
> does not mean no information architecture."*

And the sentence immediately before it, which chose this very kind as the hard
case for its own rule:

> *"A faithful rendering of a three-hundred-entry lorebook with a two-tier budget
> does not explain itself merely because nothing was hidden."*

The document already knew which kind would test the principle. It did not follow
through, and this is the follow-through.

**The rule, from which everything in [10 §5.3](docs/design/10-ui-surfaces.md) derives:**

> **Raw is a claim about the words, not about the layout.** The reading view may
> re-arrange, and it may not re-word.

Three consequences, stated because each is a decision somebody would otherwise
make differently:

- **`content` may be set in reading measure. It may not be relabelled *Body*.**
  Line length is typography; a new name for a field is a translation layer.
- **`description` may sit above the body, smaller and set apart. It may not be
  called an *abstract*.** It also earns one plain note that it is never injected
  as content, because its own docstring says so and no reader would guess it from
  a rendering.
- **`keys` may render as an unlabelled chip row.** Omitting a label is not
  renaming a field. But `keys` and `secondaryKeys` must stay **distinguishable,
  and nameable on inspection** — two lists rendered identically would be a hidden
  field, which the rule forbids.

And one boundary that reads like a violation and is not: **content may be clamped
with an expand.** A clamp is a scroll boundary, not a lossy summary;
[10 §2.1](docs/design/10-ui-surfaces.md) forbids rewriting, not pagination. Said out loud
because it is the first thing a careful reader of that section would challenge.

**The cost, stated.** The result is less handsome than the *EPUB for fictional
settings* the idea starts from, because it goes on saying `keys` where a book
designer would say nothing at all. That is the price of the library being the
model, and it is the right price.

---

## 4. The schema verdict: ~~no changes~~ one change, and it is recorded

> **Overridden once, deliberately, by [14](docs/design/14-writing-samples.md).**
> `Lorebook.writingSamples` was added after this section refused it. The
> override is written here rather than only there because §4.2 below asks that
> refusals be recorded with their reasons "so that they get re-checked rather
> than re-argued" — this is the re-check, and it went the other way.
>
> **The count below is not disputed. The new field is simply not the kind it
> counts.** Every field in the table ships and is read by nothing; a writing
> sample has a reader on the day it lands — the assembler fills a slot from it,
> and the block table shows what it cost. It does not join the unread eleven.
>
> The two constraints this section actually protects both hold. The field is
> **book-scoped rather than on an entry**, because an exemplar that appears only
> when somebody says a magic word is not an exemplar — so it buys no activation
> machinery, which is what the count was guarding against. And it is **a fact
> about the book rather than about how you like the book**, so §4.2's
> portability rule is satisfied: it travels with an export the way `description`
> does.
>
> Everything else in §4 and §4.1 stands, and the four candidate gaps refused
> there are still refused.

**And the argument is stronger than conservatism — it is a count.**

The schema is currently *ahead* of the interface by eleven fields that ship,
validate, round-trip, and that **nothing reads as the field it is**:

| Field | Reader today | Reader once [10 §5.3](docs/design/10-ui-surfaces.md) exists |
|---|---|---|
| `Lorebook.description` | none | the book's header |
| `Lorebook.tags` | none | the panel's filter — its documented consumer ([04 §5](docs/design/04-schemas.md)) |
| `Lorebook.enabled` | none | a panel badge; an entry's reason for being off |
| `Lorebook.primaryMediaId` | none | the library card's picture — its documented consumer |
| `Lorebook.folders` | none | the tree, and the gate panel |
| `LoreFolder.enabled` | none | the gate, rendered with its reason |
| `LoreEntry.name` | none | the entry's title, and its address |
| `LoreEntry.keys` / `secondaryKeys` | none | index chips, click-to-filter, *Mentions* |
| `LoreEntry.description` | none | the summary line |
| `LoreEntry.tag` | none | a filter chip |
| `LoreEntry.enabled` | none | *off*, distinguished from *gated* |

**The pedantic objection, and it is worth answering because it is true.** Every
field in that table *is* on screen today, inside the serialised object the detail
page prints ([polish §2](docs/design/workplan/06-polish.md)'s *as stored*). That is not a
reader and the distinction is the whole point: a JSON dump displays a field
without knowing the field exists, so it cannot filter on `tags`, cannot say an
entry is off because its folder gate is, and cannot make `keys` clickable. It
renders the file's *bytes* where a reader renders its *meaning*, and the gap
between those two is the interface this document is asking for. **A dump is
evidence that nothing was hidden, not evidence that anything was shown.**

~~**This document proposes no field, and that table is the reason.**~~ — see the
override above; it proposed none, and exactly one was added later against it. A
pass that added one while eleven went unread would be buying machinery to avoid
building a surface, and that remains the test any *next* field has to pass. It is also the advice the idea arrived with — *do not invent some grand
new schema to accomplish it* — and it agrees with this project's own precedent:
[03 §3.4](docs/design/03-data-model.md) removed `category` rather than renaming it, on the
grounds that `tags` already did the job openly, and [04 §5](docs/design/04-schemas.md) keeps
a *deliberately absent* list precisely so that absences stay decisions rather
than oversights.

### 4.1 Four candidate gaps, stress-tested

Each of these looks like a missing field. None of them is.

**A stable anchor for an entry deep link.** `LoreEntry.id` exists, but
[04 §5.2](docs/design/04-schemas.md) says it *"is unique within one book and carries no
meaning beyond it"*, and that an importer may renumber freely. So a link to an
entry survives edits and does not survive a re-import. *Not a gap* — this is
exactly the property a session-local id has, the route already degrades an
unknown id to the whole book, and a portable cross-install entry identifier is a
far larger idea than the one being served here. **Recorded as a known limit
rather than fixed.**

**A display order distinct from `order`.** `LoreEntry.order` is *injection*
order. A reading list sorted by it would be sorted by something that has nothing
to do with reading, and the tempting fix is a second field. *Not a gap* — the
array is the order and the array is the file. A `displayOrder` creates two orders
and a synchronisation problem between them, which is
[00 §2.8](docs/design/00-stance.md)'s derived-data-as-truth failure in miniature. The reading
view uses array order and offers injection order as an explicitly labelled sort.

**`LoreEntry.description` gaining a second consumer.** Its docstring reserves it
for a knowledge-router step. Showing it to a person is not a change to the field,
and there is a consequence worth naming because it runs the *helpful* way:
surfacing `description` prominently is what will get it written, and the router
that eventually reads it wants exactly that. A field nobody fills is a field that
does not work when its real consumer arrives.

**A non-shareable mark for memory books.**
[08 §2](docs/design/08-cross-session-memory.md) requires that an auto-maintained memory
lorebook be *"marked non-shareable by default"*, with a warning on any export
path, and no field carries that today. **This is the one place a field may
genuinely be needed, and it is not this document's to open** — it belongs to the
phase that builds memory. It is flagged here because it has a consequence *here*:
memory books are lorebooks, so the Lorebooks panel will eventually list a pile of
derived books beside authored ones and will need to tell them apart. That is one
more argument for shipping the `tags` filter now.

### 4.2 Refused by name

Two proposals that follow naturally from this document's own premises and should
lose anyway. Recorded with their reasons so that they get re-checked rather than
re-argued.

**A saved variant, profile or toggle-set field.** If folder gates are how a book
carries *does this timeline contain X*, the obvious next ask is to name and save
a set of them — *IDT with the airborne carrier*, *IDT without*. It loses three
ways. It duplicates folders, which already are the mechanism. A named toggle set
is a fact about how *you* like this book rather than a fact about the book, which
is precisely the portability argument that moved state out of entries in
[03 §3.3](docs/design/03-data-model.md) — a lorebook you export must not carry your
preferences any more than it carries your playthrough. And it is machinery
proposed in place of a rendering that does not exist yet: **build the folder
panel, then find out whether anybody wants the field.**

**`requires` or `compatibleWith` on the book.** The composability property in §2
invites a declared compatibility list. It loses because books do not point at
books by design, and reopening that reopens the ownership question
[25 B2](docs/design/25-open-questions.md) closed. It also loses on its own terms: a declared
list **decays silently** as both books change, where a derived one cannot. The
honest version is co-occurrence — which other books appear beside this one in the
same Treatment's or Package's links — which is a query rather than a field, and
is specified in [10 §5.3](docs/design/10-ui-surfaces.md). The escape hatch already exists
besides: `tags`, `description` and `metadata` all travel, and *works with IDT
Core* as a tag is exactly what tags are for.

---

## 5. What this is not

- **Not an elevation above the library.** Lorebooks stay one kind among six, in
  the panels [10 §5.1](docs/design/10-ui-surfaces.md) named for the kinds, reached through
  the one detail route. No second surface, no mode, no promotion in the
  navigation. Everything here happens inside the library.
- **Not a wiki.** No page hierarchy, no namespaces, no link maintenance, no
  templates — and specifically no transclusion, since an entry copied between
  books forgets where it came from ([10 §11.2c](docs/design/10-ui-surfaces.md)). The appeal
  of the format is that it stops short of wiki-ness, and a reader that
  reintroduces it has spent the thing it was built to read.
- **Not a second store.** The reading view renders `lorebook.json` and nothing
  else. No derived document, no cached render, no parallel representation to fall
  out of date. The one derived thing it computes — *Mentions* — is recomputed at
  render and deliberately never indexed.
- **Not a claim that activation is secondary.** §2.1. The retrieval half is the
  reason the format exists; this is about which half a *reading* surface leads
  with.
- **Not a rendering that predicts behaviour.** Nothing in the reading view may
  say *will fire*. It describes configuration; only the assembler describes
  behaviour, and the distance between those two is the whole subject of the
  workbench ([10 §3](docs/design/10-ui-surfaces.md)).

---

## 6. How we would know this was wrong

Every test here is cheap, and all four run against the imported library rather
than against fixtures — which means none can be run before
[P4](docs/design/workplan/16-p4-implementation.md), ~~and all of them should be run shortly
after~~.

> **Amended 2026-08-30: "shortly after P4" was written expecting P4 to produce a
> corpus, and it will not.** [P4 §1.2](docs/design/workplan/16-p4-implementation.md)
> established that no used SillyTavern or Marinara install is on hand, so P4
> imports fixtures that were synthesised for it. Running these counts over those
> fixtures would confirm whatever the fixtures were built to contain — the
> premise under test is a claim about **how real authors chose keys**, and a
> corpus we wrote cannot answer it either way.
>
> So the tests are **deferred until a real library exists, not skipped**, and
> that is a weaker position than this section wanted: the warrant in §2 stays
> unfalsified for longer than intended, and this document should be read as
> holding an untested premise rather than a tested one. Acquiring a library is a
> named prerequisite of [P5 §1.6](docs/design/workplan/17-p5-implementation.md)'s document
> half — person-blocked, with lead time — and the two counts run when it lands.
> The instrument itself is not deferred: P5.3 writes the script and runs it over
> whatever is to hand, recording what it ran against, so the real reading has a
> control to be compared with.

- **Count the mentions across the whole imported corpus.** *Mentions* pairs
  entries whose `name` or keys occur in another entry's `content`. If real books
  produce empty or absurd lists, then keys were chosen purely to trigger, with no
  aliasing intent behind them — **the *keys are index terms* premise in §2 is
  false, and this document's warrant falls with it.** This is the sharpest test
  available, and it is a script rather than a judgement.
- **Count folders across the imported corpus.** If real books have few or none,
  *portable toggles* is a StoryEngine aspiration rather than an observed
  practice, and the folder gate panel is speculative rather than overdue.
- **Watch whether people still open the JSON.** *As stored*
  ([polish §2](docs/design/workplan/06-polish.md)) is the thing the reading view exists to
  replace. If it stays what people reach for, the view did not do its job.
- **Watch what within-book search gets used for.** If it is overwhelmingly a way
  to find an entry in order to *edit* it, then the value was mis-sited and this
  work belonged in the editor rather than in a reading surface.

And one reopening condition rather than a test: **if an entry ever gains a
portable, cross-install identity**, the *known limit* in §4.1 stops being a limit
and entry-level linking between books becomes possible. That would be a genuinely
different document, and it is not this one.
