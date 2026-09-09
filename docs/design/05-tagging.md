# 05 — Tagging

**Status: the position behind `feat/tagging_and_search`.** Tags have existed on
six schemas since P1 and have been edited, the whole time, as a textarea of one
name per line. This note is what had to be settled before that became a real
surface — because the honest version of *what a tag is* turned out to differ from
what two other notes say.

Like [13](13-write-mode.md), [15](15-world.md) and [16](16-authoring.md) it is
a note that arrived after the original run rather than a new tier of document.
It sits here, beside the pair whose position on tags it corrects.

> **A tag is a name an author chose. The registry decorates names; it never owns
> them.**

---

## 1. The sentence that was already false

[03 §2.2](03-data-model.md) is headed *Roles are closed, tags are open*, and
[03 §3.6](03-data-model.md) restates it in one line: `ActorRole` is closed and
read by the engine, **"`tags` are open and nothing branches on them"**.
[04 §3.4](04-schemas.md) and [10 §11.2b](10-ui-surfaces.md) say the same thing in
their own words.

The last clause is not true, and has not been since P5.

`LoreEntry.actorTagFilter` is a `{ mode, values }` gate matched against the
cast's tags. Activation reads it on every entry, every turn, and the comparison
is `includes` over a flattened set — **exact, and case-sensitive**. Separately,
retrieval folds an actor's tags into the text that lore keys are matched against,
so a tag can cause an entry to fire without any gate naming it at all.

**The honest restatement**, which is what this note asks 02 to adopt:

> The engine never enumerates tags and has no built-in meaning for any of them.
> An author may point a lore gate at one.

That is still *open* in the sense §2.2 cares about — there is no closed union, no
vocabulary the software owns, and no tag the engine treats specially. What it is
not is inert. The difference is the whole reason this note exists, because it
decides what a rename costs: **renaming a tag is a change to authored behaviour,
not a cosmetic edit**, and a surface that offers rename without saying so is a
surface that silently changes which lore fires.

## 2. What the registry is, and what it must never become

The registry is a list of names with decoration attached — a colour, a position,
a folder mode, a visibility flag. It is *not* a vocabulary, and four invariants
keep it from becoming one. They are load-bearing; a change that breaks any of
them is a change to §1's restatement, not an implementation detail.

1. **Anyone can create any tag by typing it.** The input's *create* option is
   always available. The registry never rejects a name and has no approved list.
2. **The engine never reads the registry.** It reads tag names, exactly as it
   does today. [13 §9.2](13-write-mode.md)'s promise that tags never reach the
   model is untouched, and nothing in retrieval or activation learns that a
   registry exists.
3. **The stored object stays readable.** An actor's file carries tag *names*, not
   opaque identifiers, so an export means something on another install and a
   person reading the JSON can see what the tags are.
4. **Losing a registry entry never loses a tag.** A tag whose entry has been
   deleted still renders, still filters, still gates lore. It loses its colour
   and its position, which is all the registry was ever holding.

Invariant 4 is the one that earns the rest. It means a partly-failed bulk
operation degrades into *some tags are undecorated* rather than into a library
the registry refuses to describe, and that is why the operations in §5 can be
best-effort rather than transactional.

## 3. Identity is an id; the name is kept beside it

An object references a tag by **id**, in `tagIds`, and keeps the tag's **name**
in `tags` beside it.

The alternative — objects storing names, the registry keyed by name — was tried
first on paper and rejected because it makes every rename a write across the
whole library, each one a new version in each object's history. Renaming a tag
carried by forty actors would put forty entries into forty history panels.

The opposite alternative — `tags` itself becoming a list of identifiers — is
worse, and §1 is why. Tag names are what the engine compares. Replace them with
identifiers and every `actorTagFilter` in every imported lorebook stops matching,
silently, with nothing anywhere reporting it. Invariant 3 dies too.

So both fields exist, and one rule keeps them from disagreeing in any way that
matters:

> **Names are resolved from `tagIds` and the registry when an object is loaded.**
> What the engine and the client see is always registry-current. The copy in the
> file is refreshed on that object's next write.

The consequence to be honest about: between a rename and an object's next save,
the name in the file is stale, and the *As stored* view will show it. That is a
cosmetic lag by construction, not a correctness one — nothing reads the stale
copy except a person looking at the raw file, and what they are seeing is true:
that is what is on disk.

**An object with no `tagIds` predates the registry.** That is why the field is
optional while `tags` is required — here, unlike in
[04 §2](04-schemas.md)'s usual argument, absent and empty genuinely differ:
absent means *not yet adopted*, empty means *no tags*.

**Adoption is one deliberate pass that somebody asks for**, not something that
happens on a read or accumulates on writes. It walks the library once, mints an
entry for every name in use that has none, and stamps the ids alongside the
names. Two properties are load-bearing rather than tidy: it is **idempotent**, so
a partial run is simply repeated and nobody is punished for pressing it twice;
and it **never mints two entries for one name**, case-folded, or the vocabulary
it produces would be worse than the one it replaced.

Why a button and not a migration on startup: it is a write across the whole
library, every object it touches gains a history entry, and a server that did
that on first boot after an upgrade would be rewriting a person's files without
being asked. The cost is paid once and visibly, and afterwards every rename is a
single write to one small file.

Until it runs, nothing is broken and nothing is faster — an un-adopted object
works exactly as it always did, from its names, and simply cannot benefit from a
rename, because nothing connects the name it holds to the registry row that
changed.

## 4. Where the document lives

A per-user `tags.json`, beside `prefs.json` in the canonical per-user block
([09 §4.3](09-server-multiuser-deployment.md)).

**Not in `prefs.json`.** That file carries an explicit decision —
[25 B13](25-open-questions.md) — that it is a bag the server does not validate,
and the whole return on that decision
is that a preference the client stops using rots quietly instead of needing a
migration. A structured document with a schema does not belong in it. This one
validates what it writes, and it may, precisely *because* it is not the bag. B13
is upheld here rather than amended.

**Not a portable schema.** `schema/` means portable, versioned, emitted, and
carryable inside a Package. A registry of one person's colour choices crosses no
install boundary. It lives in the internal tier beside the turn record, and
carries an inline version string the way the preferences document does.

The file is hand-editable, like everything else in the data directory, and the
shape follows from that: a list rather than a map, so it diffs readably and so a
duplicated name arrives as two rows to repair rather than as a silently collapsed
key. The colour is a swatch *name*, not a colour value, so the palette can be
re-tuned without rewriting anyone's data. Swatch and folder mode are open strings
with documented values rather than closed unions — the call
[04 §8.2](04-schemas.md) makes for `ActorRole` — so a typo makes one tag render
plainly instead of making the document unreadable.

## 5. The management surface

One row per tag: reorder, folder mode, visibility, colour, name, the count of
objects carrying it, and delete. Tags in use with no registry entry are listed
too, after the registered ones — that is invariant 1 made visible rather than
merely promised.

**Rename** is one write to the registry, and §1 is why it is still not free: an
`actorTagFilter` naming the old spelling stops matching. The surface offers to
rewrite matching gates and reports how many it found. It does not do it silently
in either direction, because both directions are defensible — an author who wrote
a gate on *noir* may have meant that tag, or may have meant that word.

**Delete** removes the entry. It offers, separately and explicitly, to detach the
tag from the objects carrying it, or to merge it into another tag. The default
does neither, per invariant 4.

**Prune** removes entries nothing carries. A tag used only by the system library
is in use, and survives; system-owned objects cannot be rewritten at all, so any
operation that would have to touch one reports it as skipped rather than
pretending it succeeded.

**Ordering** is manual, with alphabetical and by-count as alternative views. The
manual order is authored data and lives in the document; *which view you are
looking at* is a preference and lives in the bag. That split is what keeps B13
honest in both directions.

**Hidden means: not drawn in an object's inline chip strip.** It does not hide
the tag from the filter bar, from suggestions, or from this surface. The flag
exists to quiet bookkeeping tags — `imported-2026-08`, `wip` — that are worth
filtering by and not worth looking at on every row. This sentence is here because
the flag reads like a stronger promise than it is, and the strong reading is
wrong: a flag that also hid the tag from the filter would be a second, invisible
filter state, and would make objects unreachable without saying so.

**Folder mode** groups a shelf by a tag. `closed` hides members from the
ungrouped list until the folder is entered; `open` shows them in both places;
most tags are neither. Entering a folder *is* applying that tag's filter — not a
second navigation model with its own state, just the filter the surface already
has, driven from a different control.

## 6. Non-goals

- **A closed tag vocabulary**, in any form: no approved list, no validation, no
  autocomplete-only input. §2 invariant 1.
- **Tags reaching the model.** [13 §9.2](13-write-mode.md) stands unchanged.
- **A tag column in the derived index.** Counts are computed from the object
  bodies the library route already ships. This becomes worth revisiting if that
  route ever stops shipping them, and not before.
- **Backup and restore of the registry as its own file.** The data directory is
  the backup unit ([03 §5](03-data-model.md)); a second, narrower backup format
  is a second thing to keep correct.
- **`EmbeddedMedia.tags`.** Those are per-image descriptors — *winter*, *aerial*,
  *by Mireille* ([03 §3.6](03-data-model.md)) — a genuinely different vocabulary
  that happens to share a field name. Sweeping them in would make renaming an
  actor's tag rewrite an unrelated image tag nested inside that actor. The
  registry covers the five object-level `tags` fields and stops there.

## 7. How we would know this was wrong

- **An author renames a tag and lore stops firing**, and the surface did not
  warn them. That is §1 not having been taken seriously enough, and it is the
  failure this note was written to prevent.
- **Someone asks which tags are "real"**, or hesitates before typing a new one.
  That is invariant 1 having leaked: the registry has started reading as a
  vocabulary even though nothing enforces it.
- **The two fields disagree in a way somebody notices.** The lag in §3 is meant
  to be invisible outside the raw-file view. If it shows up anywhere else, the
  resolution rule has a hole in it.
- **Adoption mints duplicates**, or folds two spellings nobody asked it to fold.
  Case-differing pairs are the case to watch: they are one tag to a person and
  two to the engine, and the surface should offer the merge rather than decide.
