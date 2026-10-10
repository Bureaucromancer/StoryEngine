# The library

The library is your shelf of story material: characters, lorebooks, the treatments and
setups you build from them, and the presets that decide how prompts are put together.
Each account has its own library, which other accounts cannot open (an administrator's
whole-install backup does include it), and every account also sees a small **System**
library that ships with StoryEngine.

Every object is an ordinary folder on the server's disk. You can work with the
library entirely in the browser, edit the files by hand, or both — StoryEngine notices
changes on disk while it runs.

## What is in it

| Kind | What it is | How a session uses it |
| --- | --- | --- |
| **Actor** | A character: name, pronouns, aliases, traits, a profile in sections, writing samples, greetings, pictures. Stored as a character card. | As a cast member or as your persona. Read fresh every turn, so edits reach stories in progress. |
| **Lorebook** | Entries that come into the prompt when their keywords appear. See [Lorebooks and memory](lorebooks-and-memory.md). | Chosen per session, or brought by a treatment — or, for a memory book, brought by a character in the cast. Read fresh every turn. |
| **Treatment** | How a world is handled: its framing, which goes into every turn, plus its lorebooks, plot hooks, writing samples and tone. Reusable across many stories. | Chosen when a session starts (or later). Its framing and lorebooks are read every turn; its hooks are copied into the session when it starts — a treatment picked later brings its framing and lorebooks, not its hooks. |
| **Setup** | One particular game: a mode and its answers, a treatment, a preset, a persona and lorebooks, kept together to start from again — and, for one made from a story, its party, goals, plot hooks, openings and the story so far. | Saved from the start form, or made from any turn of a story with **Make a setup from here**. Started from the sessions page or from its own page with **Start a session**; a session copies it when it starts, so later edits reach only sessions started afterwards. |
| **Preset** | The recipe for a prompt: its blocks, their order and budget, and the generation settings. See [Presets and prompts](presets.md). | **Copied** into a session when it starts, so later edits do not reach that session. |
| **World** | A named set of library objects, kept together so they can travel as one file. Called a *package* before this version — see [Files on disk](#files-on-disk) for what happens to one an earlier version made. | Not used by sessions directly. |

The difference between a treatment and a setup is the one worth learning: a treatment
is how a world is handled and told (its lorebooks hold the world itself), reusable
across playthroughs; a setup is one playthrough's starting arrangement. If you are copying a treatment to change who is in
it, you wanted a setup.

## Browsing

**Library**, in the header, lists your objects together with the System ones.

- **The kind bar** — **All kinds**, **Actors**, **Lorebooks**, **Treatments**,
  **Setups**, **Presets**, **Worlds**. A click shows one kind; **Select several**, or
  Ctrl-click (⌘-click), adds and removes kinds.
- **Sort by** — **Name**, **Recently updated**, and for lorebooks **Entry count**.
- **Search** opens **Search this shelf**, which matches names and tags on the shelf
  you are looking at. To search inside objects and stories, use **Search** in the
  header — see [Playing a session](playing.md#search).
- **Tags** — when anything on the shelf is tagged, a bar of tag chips appears. Each
  click cycles a chip through *showing only these*, *hidden* and back; **Clear tags**
  resets. A tag can also be a **folder**, shown as a row at the top of the list (see
  [Tags](#tags)).
- The **Lorebooks** shelf has its own columns — entries, tags, source, when updated —
  and filters for **Scope**, **Enabled** and **Source**.

Each row is the object's name, with **Yours** or **System**. On the **Lorebooks** shelf,
a book can also say **Off** (switched off), **Linked** (written for particular
characters) or **Memories** (written by play). **Shadowed** means another folder on disk holds the same object; see
[Files on disk](#files-on-disk).

**New actor**, **New lorebook** and the other **New** buttons are under the kind bar;
**Import…**, at the top, opens the import panel — see
[Importing and exporting](importing-and-exporting.md).

## An object's page

Clicking a name opens the object's page: a read-only view of it, field by field — a
lorebook reads as a document, with **Print** and **Copy as Markdown**. Below it:

- **Storage** — the kind, the folder it lives in, its identifier, when it was created
  and updated.
- **Used by** — what points at it (see [Used by](#used-by)), when anything does.
- **Download this …** and **Export as …** links — see
  [Importing and exporting](importing-and-exporting.md#taking-things-out).
- **As stored** — the object's stored fields as JSON (for a character, the data inside
  its card), with **Copy**.

At the bottom: **Back to the library**, **Edit** (for your own objects), **Copy to my
library** (for System objects) and **Delete** (for your own).

A setup's page also has **Start a session**, which starts a session from it — on its
own opening, when it has one — and opens it straight away. There is nothing to fill in,
because the setup already says everything a session needs. To start from a setup with a different
opening, or cold, use the sessions page: see
[Starting from a setup](playing.md#starting-from-a-setup).

The page shows no pictures. The workbench over it shows the object's provenance, its
version history and how the index sees it.

## Making something new

The **New** buttons open an unsaved draft. Nothing is written to disk until the first
**Save**, so walking away leaves nothing behind. The name is the only thing you must
fill in.

A new actor starts with four profile sections — Summary, Appearance, Voice and
Background. A new preset starts as a copy of the shipped **Assistant** preset; to build
on Scene's or Freeform's instead, open that preset and use **Copy to my library**.

An object's folder is named from its name when it is first saved — lowercase letters,
digits and hyphens — and **never changes**: renaming the object changes the name inside
the file, not the folder.

To keep the start form's choices as a setup, use **Save as a setup** on the sessions
page — see [Playing a session](playing.md#the-setup). To keep a point in a story you
are playing, use **Make a setup from here** on that turn — see
[Make a setup from here](playing.md#make-a-setup-from-here).

## Editing

**Edit** opens the object's editor. Every editor has the same strip along the bottom:
**Back to …**, **Save**, a line saying what happened (*No changes to save.*,
*Saved.*), **History** and **Delete**, with **As stored** — the saved version, not your
unsaved form — below it; those last three appear once the object has been saved.
Pressing Enter in a single-line box such as **Name** saves. In the treatment, setup and
world editors the other text boxes take Enter as a new line.

Leaving an editor with unsaved changes asks first: **Keep editing** or **Leave without
saving**. Unsaved edits were never saved, so there is no version of them in the history
to bring back.

### Characters

The actor editor shows the character's card image (it travels with the file; the
editor does not replace it) and has:

- **Name**, **Pronouns** (*Leave blank for unknown. Never inferred from the name.*),
  **Aliases** (one per line — the other names the character goes by; a lorebook entry
  about the character still needs keywords of its own, whatever the field's hint
  says), **Tags** and **Traits** (one per line);
- each **profile section**, with its **Title** and **Body**. Sections can be edited but
  not added, removed or reordered here;
- **Writing samples** — passages in the character's voice, offered to the model as an
  example to write like. Each has a **Title** (for you, never sent), the **Sample**
  itself, a **Priority** (higher survives longer when the prompt is full) and **Send
  this sample**. **Add a writing sample** adds one.

A character's greetings, lorebook links, pictures and expressions, and model hint
cannot be edited in the app yet; they come with an imported card.

### Treatments, setups and worlds

These share one editor, built from each kind's fields. Text fields are text boxes,
lists are one item per line, and fields the editor cannot yet write are shown as they
are stored, marked *This editor does not write this field yet.*

- **Treatment** — editable: name, blurb, framing, staging notes, tags and **Plot
  hooks**. Shown as stored: tone, writing samples, lore, cast, openings, pictures.
- **Setup** — editable: name, blurb, staging notes, tags, plot hooks, **Story so far**
  (what the model is told had already happened, which a setup made from a story fills
  in) and **Spent hooks** (the ids of hooks already used, one per line). Shown as
  stored: the mode, treatment, preset, cast, lore, openings and goals.
- **World** — editable: name, version and description. Its list of contents is shown
  as stored.

**Plot hooks**, on treatments, setups and lorebooks, are hooks a session starts with: a
treatment's hooks are copied into every session started from it, and a setup's are
added to the treatment's. Each hook has a title, its premise, how big it is, who it
involves, what blocks it, when it may first fire, its weight, how it is delivered,
whether it fires once, and anyone it introduces with their entrances. **Something you
want to happen** and **Add a hook** add one. See
[Playing a session](playing.md#plot-hooks) for how hooks fire.

Lorebooks and presets have editors of their own: see
[Lorebooks and memory](lorebooks-and-memory.md) and [Presets and prompts](presets.md).

### When the file changed while you were editing

If something wrote the object after your editor loaded it — another tab, a text editor,
a sync tool — **Save** is refused and a dialog explains why, with:

- **Load the newer version and reapply my edits** — the fields you changed keep your
  values, the rest take the newer ones. Review, then save again.
- **Save my version as a copy instead** — a new object named "*name* (copy)", with its
  pictures, opened in its own editor.
- **Cancel** — your edits stay in the form.

There is no "overwrite": a save never silently replaces someone else's change.

### Help writing a field

Most text fields in the editors have **Assist**. It opens **What should change?** —
*Make it darker. Shorter. Less of the weather.* — and **Write it** (with the box empty,
a fresh attempt) or **Rewrite it** (with your guidance). While it works the field stays
editable; the answer replaces what the field holds when it arrives.

Afterwards, **Undo the assist** puts back what was there, and **Back to what the model
wrote** returns to the model's text after you have edited it. When you save, the object
records which fields a model wrote; editing such a field marks it reviewed.

The assist is one model call that sees the object you are editing and nothing else — not
its links, your sessions or your lore. It uses the model of the job chosen under
Settings → **Which models your stories use** → **Writing help in the library**
(*Writing the story* unless you changed it). If you leave the editor before it answers,
the answer is dropped.

## History

Every save keeps the version it replaced, and so do restores, tag changes and hand edits
noticed on disk. A save that changes nothing records nothing.

**History**, in the editor strip, lists them newest first: **Revision 12**, **Revision
11**… with where each came from — *Edited in the app*, *Hand edit on disk*, *Restored*,
*Import*, *Written by play* (a save that keeps an assist's text counts as *Edited in the
app*) — when it was written, and its reason. For each:

- **Restore** puts that version back. The version you were on is kept first, so a
  restore can itself be undone.
- **Diff** compares that version with the saved object, field by field.
- **Rename** gives the version a reason you will recognise.
- **Pin** keeps a version from ever being pruned.

Each object keeps at most 50 versions (`history.keepPerObject`; `0` keeps all). Past
that, the oldest unpinned ones are dropped; pinned versions are never dropped, but they
count toward the 50. History lives in the object's folder, so it goes to the trash and
comes back with it. It holds the object's fields, not picture files: restoring a
character restores the text, not an old portrait. A lorebook's pictures stay on disk
while any kept version names them, so restoring an earlier version of the book brings
them back.

## Tags

Tags are yours for organising; they never go into a story's prompt. (An **Assist**
request does send the whole object being edited, tags included. And a lorebook entry can
be gated on a character's tags — see
[Lorebooks and memory](lorebooks-and-memory.md#folders-gates-and-filters).)

- **Characters** have a **Tags** box: type to find a tag the library already uses or to
  make a new one; Enter or a comma adds it.
- **Treatments, setups and presets** have **Tags**, one per line, and a **Tag ids** box,
  which is internal: leave it alone.
- **Lorebooks** have no tag control in the editor; their tags come with an import or a
  hand edit. **Worlds** have no tags.

**Manage tags…**, under a character's **Tags** box, opens the tag manager. It lists your
tags with their order, **Colour**, folder setting and how many objects use them:

- **New tag** and **Add**; tags in use but not listed appear under **In use, not
  listed**, each with **Add**.
- A colour — None, Rose, Amber, Lime, Teal, Sky, Violet, Fuchsia or Stone — shown on
  the shelf's tag chips and folder rows, in a character's **Tags** box and here.
- **Folder** — a small button that cycles, one click at a time, through not a folder,
  an open folder (*Open folder — members also stay in the list*) and a closed folder
  (*Closed folder — members hidden until it is opened*).
- **On cards** — whether the tag shows in the lorebook shelf's Tags column.
- **Rename** — renames the tag everywhere it is linked. If lorebook entries gate on the
  old name and a linked character carries the tag, it asks whether to update them too:
  **Rename and update them** or **Rename only**. Otherwise it renames at once and leaves
  the gates alone — they keep working, because unlinked characters keep the old name.
  Renaming to a tag that already exists is refused; there is no merge.
- **Remove** drops the tag's entry here — its colour and order — but leaves the tag on
  everything that carries it. **Prune … unused** removes the entries nothing uses.
- **Link tags to the library** adds an entry here for every tag your objects carry, then
  links every object you own to those entries, so that renames reach them. The first
  time, it writes every object you own once — untagged ones too — and each write leaves
  a version in that object's history (*Adopted tags into the registry*); running it
  again writes only the objects whose tags changed since. Only linked objects follow a
  rename: an object tagged before linking, or retagged since, keeps the old name until
  you link again.
- **Known problem:** on a linked character, swapping one tag for another while keeping
  the number of tags (say `wip` for `drafts`) brings the old tag back the next time the
  character is read, and a later save keeps it.

## Pictures on library objects

Only lorebooks have a picture editor: **Pictures** for the book, a gallery with a cover,
and a strip on each entry. **Add a picture** takes a PNG, JPEG or WebP up to the
install's upload limit (64 MB by default). Each picture has a **Label**, a **Role**
(Reference, Gallery, Map, Background, Style reference, Pose, Expression, Portrait
source), **Tags**, **Replace** and **Remove**; **Use as the cover** picks the book's
cover. Pictures on an entry are cropped to a centred square. A book must be saved once
before pictures can be added, and they are never sent to a model.

A character's card image is shown in its editor but cannot be replaced there. Pictures
on treatments, setups and worlds are shown as stored. A picture you upload but never
save is removed by a later save of that book, once the picture is a day old.

## Copies, deleting and the trash

- **Copy to my library**, on a System object's page, makes your own copy — with a new
  identity and the same name — and opens it. Later releases never change your copy.
  There is no copy for your own objects, apart from **Save my version as a copy
  instead** when a save is refused.
- **Delete** asks *Move to trash?*, saying how many things point at the object; press
  **Delete** again to confirm. The whole
  folder, history and pictures included, moves to your trash; Settings → **Trash** →
  **Put it back** restores it. See
  [Backups, restore and the trash](backups-and-trash.md#the-trash).

## Used by

An object's page lists what points at it — *Referenced by 2 sessions and 1 treatment.*,
with the names — and the delete question repeats the count. It never blocks a delete.
What counts:

- **sessions** count the characters in their cast and persona, and their chosen
  lorebooks — archived sessions included, deleted ones not;
- **setups** count their treatment, preset, cast, lorebooks and the characters their
  hooks name;
- **treatments** count their lorebooks, cast and hook characters;
- **lorebooks** count the characters their hooks name;
- **worlds** count their contents.

A session's treatment and preset do not count.

## Shipped objects

The System library holds one preset per mode — **Scene**, **Freeform** and **Assistant**
— the **Assistant** character, and the **StoryEngine help** lorebook the assistant
reads. They are read-only for everyone: the server rewrites them at every start, so a
hand edit to one is overwritten. To change one, **Copy to my library** and change your
copy.

## Files on disk

Your library lives in the data directory, at `users/<handle>/library/<kind>/<folder>/`:

| Kind | File |
| --- | --- |
| Actor | `card.png` — a character card: a PNG with the character's data inside |
| Lorebook | `lorebook.json`, with an `assets/` folder for its pictures |
| Treatment, setup, preset, world | `treatment.json`, `setup.json`, `preset.json`, `world.json` |

Each folder also gets a `history/` folder once the object has been changed. Your trash
is `users/<handle>/trash/`, your tags
`users/<handle>/tags.json`, and the shipped objects `system/library/` — an administrator
can put folders there by hand to share them, read-only, with every account.

**A package from an earlier version.** Worlds were called packages before this
version, and lived at `library/packages/<folder>/package.json`. That folder is still
read: each package in it shows under **Worlds** as a world, and nothing moves it while
nobody changes it. The first save to it — an edit, or a version put back from its
history — moves the whole folder, history and pictures included, to `library/worlds/`,
under the same folder name unless a world made since already has that name, in which
case it gets a number on the end. A package deleted before the upgrade is still in your
trash, and **Put it back** returns it as a world.

**Editing by hand while the server runs is supported.** The change is noticed within a
moment, shows in the browser within a couple of seconds, and the state it replaced is
kept in the object's history as *Hand edit on disk*. Changes made while the server was
stopped are found when it starts. An editor already open on that object is not reloaded:
its next save meets the *changed while you were editing* dialog — or, if the edit broke
the file, is refused with a message beside **Save** saying to repair or delete it.

**Files the library could not read** appears above the list when a file on disk does not
read as an object — not JSON, missing something, a folder name the system cannot open, a
permissions problem, or a link pointing outside the data directory. Nothing is deleted:
an object that read before stays in the list as it last read, with its editing turned off
until the file is repaired, and **Delete** still works. The panel clears itself once the
file is fixed.

**Two folders with the same object** — usually a folder copied by hand — are both
listed. The one at the earlier path is the one every session and save uses; the other is
marked **Shadowed** and can be downloaded but not edited, copied or deleted in the app.
Remove it on disk.
