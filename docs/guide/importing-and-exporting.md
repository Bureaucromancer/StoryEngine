# Importing and exporting

StoryEngine reads what you already have in **SillyTavern**, **Marinara Engine** and
**Aventuras**: characters become actors, world info becomes lorebooks, presets become
presets, and chats become sessions you can carry on playing. Things go back out as
StoryEngine's own files, as Aventuras files, or — for a treatment — as a SillyTavern
character card, with a note of anything the conversion could not carry.

Nothing is staged. What imports lands in your library at once, and everything that did
not is listed in the review afterwards. Everything is recognised by its contents, never
by its file extension.

## The import panel

**Import…**, at the top of the library page, opens the import panel in the workbench.
It has three ways in, under **Add to your library**:

- **One file** — **Choose a file…** for a card, lorebook, preset, chat, CHARX, zip,
  Aventuras database or story. You see what it would become before anything is written.
- **Or a folder from this browser** — **Choose a folder…** for a SillyTavern, Marinara
  or Aventuras data folder on the computer you are using.
- **Or a folder on this machine** — the full path to a data folder on the server's own
  disk. This one needs a permission an administrator grants (**Import from a folder on
  this machine**, under Settings → Administration → Accounts), because it lets the server
  read any folder outside its data directory. Without it the panel says so.

Below them, **Also bring Aventuras stories across as sessions** decides whether an
Aventuras library's stories come too (it is off each time).

### One file

1. **Choose a file…** — the panel reads it and shows **Before it lands**: *It would be
   imported as "…"*, *It would become a preset called "…"*, *It would become a treatment
   called "…", with 3 of its characters imported beside it*, or *Everything inside would
   be imported* for an archive or database. The name shown is the file's name.
2. For a preset, the preview lists its blocks in order and its sampler settings, marking
   the ones this build stores but does not send. For an Aventuras scenario, **What this
   should become** chooses a treatment (the default) or a lorebook.
3. If the server can tell the file was imported before and has changed — it can for
   presets, Aventuras scenarios and story files — it asks **What to do with the one already
   here**: **Replace it — the old state stays in its history**, or **Keep both**.
4. **Import** sends it, with a progress bar, and shows the review. **Cancel**, before
   that, leaves nothing behind.

### A folder from this browser

The browser sends only the names and sizes of the folder's files first; the server says
which ones it will read, and only those are uploaded. If the folder holds chats, the
panel stops at **Before it is sent**: *This folder holds 312 chats, 85 MB in all*, with
**Also import the chats** — off by default — because chats are usually most of a
folder's size. It also says which files will not fit under the upload limit.

The whole upload has to fit under the install's upload limit (`limits.maxUploadMb`, 64 MB
by default); library files go first and chats use what is left. A folder on the server's
own disk has no such limit, apart from skipping single files over 64 MB.

### A folder on this machine

Type the folder's full path. When you leave the box, the panel looks and says what it
found — *A SillyTavern library. Ready to import.*, *A Marinara data folder.*, *An
Aventuras library.*, or *Not a SillyTavern, Marinara or Aventuras folder*, in which case
anything importable in it is taken one file at a time. If you named a folder near the
right one, it suggests the right one with **Use that folder**.

| Application | The folder to give |
| --- | --- |
| SillyTavern | The one holding `settings.json` beside `characters/` and `worlds/` — usually `data/default-user` inside SillyTavern's directory. |
| Marinara | The one holding `storage/tables/`. |
| Aventuras | The one holding `aventura.db` — `com.karelian.aventura` inside `~/.config` on Linux, `~/Library/Application Support` on a Mac, or `%APPDATA%` on Windows. |

**Import folder** imports it at once and shows the review. Close the other application
first: a folder whose application is running is refused (*That application is running, or
is part-way through an upgrade*). Folders inside StoryEngine's own data directory are
refused too.

### The review

**What happened** counts each outcome, then lists every file with what became of it:

| Outcome | Means |
| --- | --- |
| **Imported** | Now in your library — or, for a chat, a session in Play. |
| **Already here** | Identical to what is here, so nothing was written. Also used for a changed file the import was told not to overwrite. |
| **Credential removed** | A connection or a password. Removed and never stored. |
| **Recorded, not imported** | Read and named, but this build has nowhere to put it yet. |
| **Not importable** | There is nothing here for it to become, and there will not be. |
| **Skipped** | Deliberately not taken — including files that did not fit the upload limit. |
| **Not recognised** | Could not be identified, or could not be read. |

Each file's notes say what is worth knowing in a sentence: what a conversion changed,
what it dropped, characters a chat names that are not in your library, links that could
not be resolved.

**Earlier imports**, below, lists your 50 most recent imports with their counts; clicking
one reopens its review. A lorebook's page also shows **What the import did** for that
book.

### Importing the same thing again

- A file is recognised by where it came from: the same file name from the same place.
  The same card imported alone and again inside a folder makes two characters; renaming
  a file between imports makes a new object.
- A changed card, lorebook or StoryEngine file is **replaced**, with the old version kept
  in its history. Folder imports always replace; only presets, Aventuras scenarios and
  story files ask first.
- Re-importing a chat **adds to** its session: new messages, edits and branches arrive
  beside what is there, nothing is deleted or rewritten, and your place is kept.

## What each application's files become

### SillyTavern

| What | Becomes |
| --- | --- |
| **Character cards** — PNG or JSON, versions 1 to 3 | A character. The description becomes its **Summary** section; a short comma list of personality becomes traits (otherwise it joins the summary); the first message and alternate greetings become its greetings; example messages become a writing sample; the card's system prompt, post-history instructions and depth prompt become its card prompts; tags come across; everything else is kept with the character, unused. |
| A card's **embedded lorebook** | A lorebook of its own, linked to the character. |
| A card's **scenario** | A treatment named *Scenario: …*, with the characters who share it as its cast. Cards with the same scenario text share one. |
| **CHARX** cards | A character; its portrait becomes the card image, and every other picture in it an expression, labelled by its file name. |
| **World Info** books | Lorebooks, with nearly every entry setting: keys, secondary keys and logic, whole words, case, regex, scan depth, enabled, constant, probability, sticky, cooldown, delay, position and depth, order, role, group and the recursion flags. Fields StoryEngine does not use are kept on the entry. |
| **Chat-completion presets** | Presets — see [Presets and prompts](presets.md#imported-presets). |
| **Text-completion presets** | Presets carrying sampler settings only. |
| **System prompts** | A preset of the system prompt, the history and the post-history instructions. |
| **Personas** | Characters, with their description and avatar. |
| **Chats**, single and group | Sessions, as Scenes. Swipes become alternative replies, hidden lines stay hidden, and the author's note comes across. Characters and lorebooks are found by the file they were imported from, then by name. |
| Instruct, context and reasoning templates; NovelAI and KoboldAI settings | Recognised, and not converted: there is nothing here for them to become. |
| Backgrounds, themes, extensions, quick replies, sprites | Skipped. |

`{{char}}` and its spellings in a card become the character's name. `{{user}}` is kept as
written — the review warns that the model will read the placeholder rather than a name.
`{{original}}` is removed, with a warning that the card wanted to override prompts.

### Marinara

| What | Becomes |
| --- | --- |
| A **data folder** (`storage/tables/`), or a zip of one | Characters (with their avatars), personas (as characters), lorebooks with their folders, presets, roleplay chats as sessions with their trackers and secret plot, and the account's own data. API connections and the encryption key are removed. Conversation and game chats, sprites and images are recorded and not imported. Installs older than 1.5.7 cannot be read. |
| **Exported** characters, personas, lorebooks, presets and profiles (`.json`) | Imported as a small folder of their own. |
| Chat presets, chat settings profiles, memory recall | Recorded, not imported. |
| Single chat exports (`.jsonl`) | Sessions. |

A Marinara chat switches on the Scene agents it was using — trackers, secret plot, editor,
echo chamber.

### Aventuras

| What | Becomes |
| --- | --- |
| The **database** (`aventura.db`) — as a folder, the database file, or a backup zip | Vault characters (with their portraits), lorebooks and scenarios (as treatments with their cast); its tags join your tags. Settings, which hold keys, are removed unread. Prompt packs are recorded, not imported. |
| **Stories**, with **Also bring Aventuras stories across as sessions** | A session per story, opening where it was left, with its branches, its protagonist as your persona, the world at each branch as characters and a story lorebook, and its pictures. Chapters, checkpoints and the story's own narrator prompt are not carried. Importing the library again never duplicates or replaces a story. |
| A **`.avt`** story file | Its story, as a session, whatever the checkbox says. |
| Character, scenario and lorebook `.json` files | A character (without its portrait), a treatment or a lorebook. |

A database copied from a machine where Aventuras was open is read as it stood; close
Aventuras first for a clean read.

### StoryEngine

| What | Becomes |
| --- | --- |
| A downloaded object (`.json`), or a downloaded character (`.png`) | The same object, under its own identity — so importing it where it already is counts as **Already here**. |
| An unpacked backup folder | Your own library objects from it. Sessions, tags and settings are listed and left behind; bring them with Settings → **Backups** → **Import from a backup** instead. |
| A session export (`.session.json`) | Load it on the sessions page — see below. |

Backup archives (`.tar.gz`) and package files (`.sepack.json`) cannot be imported through
this panel.

## Chats and sessions

**Load a session or a chat**, on the sessions page, takes a StoryEngine session export
(`.json`) or a SillyTavern or Marinara chat (`.jsonl`). Either arrives as a new session,
with every branch, and opens. A chat whose characters are not in your library still
loads: their messages keep their names, and the characters show as missing. The same
session export cannot be loaded twice on one install.

Loading a chat again **updates** its session, as above.

**Update from source**, in the session panel of a session imported from a chat, reads the
chat again and adds what is new: new messages, edits and branches, beside what is already
there. Nothing is deleted or rewritten, nothing is written back to the source, and if you
have played on, your place is kept and the new messages wait on the source's branches.
Where the chat came from decides how:

- **from a folder on this machine** — the server reads that folder again (and brings every
  chat in it up to date);
- **as one uploaded file** — the panel asks you to choose the file again, under the same
  name;
- **with a folder through the browser**, or inside a zip — import the folder again from
  the library's import panel.

## Taking things out

### From an object's page

Every object's page in the library has links for taking it with you:

- **Download this …** — the object as StoryEngine stores it. A character downloads as its
  `.png` card, with its pictures inside; everything else as `.json`, and pictures kept
  beside the object stay behind (the page says how many).
- **Export as …** — the object written in another application's format:

  | Object | Export | Can that application read it? |
  | --- | --- | --- |
  | Treatment | **Export as SillyTavern character card** (JSON) | Yes. Named after, and describing, the first character in the cast; the treatment's framing becomes the card's scenario. |
  | Treatment | **Export as Aventuras scenario** | No — it is what Aventuras writes, not what it reads. |
  | Actor | **Export as Aventuras character** | No, as above. |
  | Lorebook | **Export as Aventuras lorebook** | Yes. Folders are not carried, so entries a shut folder was holding off arrive switched on. |

  Under each link, what the conversion could not carry is listed after the download: cast
  members no longer in your library, plot hooks with nowhere to go, linked lorebooks to
  export separately, sections folded into one description.
- **Export this package** — for a package, one `.sepack.json` holding it and the objects
  it names.

There is no export of a character as a SillyTavern card. A character imported from a
SillyTavern PNG keeps that file's original card data inside its PNG, unchanged, so another
application reading StoryEngine's download sees the card as it was imported, not your edits.

### Other ways out

- **Lorebook entries** — **Export selected** in the lorebook editor; see
  [Lorebooks and memory](lorebooks-and-memory.md#moving-entries-between-books).
- **A lorebook as a document** — **Copy as Markdown** and **Print** on its page.
- **A session** — **Export this session** in its session panel: every turn on every branch,
  with pictures as their descriptions. **Read it as a story** has its own **Copy as
  Markdown**, **Copy as text** and **Print**. See [Playing a session](playing.md#archiving-deleting-and-exporting).
- **Everything** — a backup; see [Backups, restore and the trash](backups-and-trash.md).

## When an import is refused

| What you see | Why, and what to do |
| --- | --- |
| *That file is larger than the … MB upload limit.* | An administrator can raise `limits.maxUploadMb` — or `limits.maxImportUploadMb` (1024 MB) for zips and databases chosen with **Choose a file…**. A folder on the server's disk has no such limit. |
| *Something between you and StoryEngine refused this file as too large* | A reverse proxy's own upload limit — nginx allows 1 MB unless told otherwise. See [Running a built StoryEngine](../deploy.md#configuration). |
| *There is not enough free space on the disk to receive this upload* | Large uploads are written to disk as they arrive; free some space. |
| *Another large import is being uploaded to this server.* | One large upload at a time; try again when it has finished. |
| *The upload stopped arriving part way through.* | A minute passed with nothing arriving. Try again. |
| *That application is running, or is part-way through an upgrade.* | Close SillyTavern, Marinara or Aventuras, and import again. |
| *That folder is in a format this build cannot read* | Written by a newer version of that application, or missing a part this build needs. |
| *That folder is inside this install's own data directory.* | Import reads other applications' folders. |
| *… is an archive this build will not open (…)* | A damaged zip, or one past the safety limits on size and number of files. |
