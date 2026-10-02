# Lorebooks and memory

A **lorebook** holds **entries**, and each entry has **keys** — words that trigger it —
and **content**. On each turn StoryEngine scans the recent conversation, and an entry
whose key appears there has its content added to the prompt. A lorebook is how a
story knows about a city, a magic system or a character's history without carrying
all of it in every prompt.

Lorebooks are also how StoryEngine remembers. **Memory books** are lorebooks that play
writes into, and the **running summary** keeps the gist of turns too old to send in
full.

If you know SillyTavern's World Info, most of this will be familiar; the differences
are called out as they come.

## How a lorebook gets into a story

A lorebook takes part in a session in one of three ways:

- the session chose it — in the start form, or later in the play page's lore panel
  (*Retrieving from …*);
- the session's treatment links it;
- it is one of your memory books, for a character in the cast (see [Memory](#memory)).

A book that is only in your library is never in a prompt.

These are links, not copies: edit a lorebook and every session using it reads the new
text from its next turn. (A lorebook's plot hooks are the exception — they are copied
into a session when the session starts.) A linked book that has been deleted simply
stops contributing, without a warning.

## Making and editing a lorebook

**New lorebook**, on the library page, opens a draft; give it a **Book name** and
**Save**. The editor has four parts: the book's name, its **Retrieval** settings, its
**Pictures**, and its entries — with **Plot hooks** folded at the bottom. Everything is
one draft: changed entries say *unsaved* until you **Save** the book.

### The book's settings

Under **Retrieval** — each read on every turn that reaches the book:

| Setting | New books | Meaning |
| --- | --- | --- |
| **Book enabled** | on | Off retrieves nothing from this book, whatever its entries and folders say. |
| **Scan depth** | 2 | How many recent messages are searched for keys. `0` searches the whole session. See [Which text is scanned](#which-text-is-scanned). |
| **Token budget** | 2048 | The most this book may add to one prompt. `0` is unlimited. |
| **Entry limit** | 100 | The most entries that may fire at once (1 to 1000). |
| **Recursive scanning** | off | An entry that fired is itself searched for this book's keys, so one entry can pull in another. |
| **Max recursion depth** | 3 | How many times that can chain. |

A book's description and tags are shown on its page, and its writing samples only in the
page's **As stored** JSON; none of them can be changed in the editor.

### Entries

**New entry** adds an entry and opens it. **Find an entry** filters the list by name;
drag a row, or use its arrows, to reorder the list. Reordering changes the book's
reading order only — not which entries go first into a prompt (see
[The book's limits](#the-books-limits)). **Remove this entry** asks once; nothing is
written until you save, and the book's history keeps the version before.

The editor can change these fields of an entry:

- **Name** — for you and for search; never sent to the model.
- **Description** — for you and for search.
- **Content** — the text that goes into the prompt when the entry fires.
- **Keys** — one per line.
- **Enabled** — off keeps the entry in the book without ever firing it.
- **Position** — **Before char**, **After char**, **At depth** or **Outlet**, and
  **Outlet name** when it is an outlet. See [Where an entry lands](#where-an-entry-lands).
- Its pictures, in the strip above its fields.

Every other setting an entry can have — secondary keys, case sensitivity, whole-word
matching, regular expressions, its own scan depth, **Constant** (always on), probability, timing,
order, depth, message role, groups, filters, recursion — is **shown in the editor but
not changeable there**. These arrive with an imported book (SillyTavern and Marinara
books carry them) or from editing the book's `lorebook.json` by hand. **Matching** and
**Firing** start open and the other groups start folded (**Position** is under
**Placement**); each heading lists what is not at its default — *Timing (sticky 4)* — or
says *all at default*.

An entry made in the editor therefore has: whole words **on**, case **insensitive**, no
regular expressions or secondary keys, no timing, order 100, sent as a system message,
and depth 0.

## How entries fire

### Which text is scanned

The scan reads the conversation as **messages**, newest first: the move being sent (with
any picture captions), then the previous reply, then the move before that, and so on.
**Each turn counts as two messages** — your move and the reply. The default scan depth
of 2 is therefore the move you are sending and the last reply. In a group chat, a
character who speaks after another also scans the replies already given this round,
ahead of your move — so at depth 2 the second speaker's scan reads the first speaker's
reply and your move. An entry keyed on a word
said ten turns ago will not fire again until the word comes back, unless the book's scan
depth reaches that far; `0` scans the whole session, beyond what is sent as history.
Keys are matched within one message at a time.

The scan runs for each reply the story writes — the narrator's, or each character's in a
group chat — and for **Draft my next message**. It does not run for the background calls
(the summary, judges, trackers), which have their own prompts.

### The checks, in order

1. **Is it on?** The book, any folder above the entry, the entry itself, and its filters
   (see [Folders, gates and filters](#folders-gates-and-filters)).
2. **Timing** — is it still active from an earlier turn, used up, too early, or cooling
   down? (See [Timing](#timing).)
3. **Constant** entries fire without keys.
4. **Keys.** For an entry made in StoryEngine, a key matches regardless of case and only
   as a whole word: the characters on either side of it must not be letters, digits,
   underscores or combining marks. So `ash` does not match `ashes`, and a key in
   Devanagari does not match inside a longer word. Entries can instead be case-sensitive,
   match anywhere, or treat keys as regular expressions — and entries imported from
   SillyTavern or Marinara usually **match anywhere**, because those books leave
   whole-word matching unset and the importers read that as off.
5. **Secondary keys**, for entries that use them: one of them must also be present, or
   all of them, or none, or not all — the entry's *selective logic*.
6. **Probability** — an entry can fire only some of the time on purpose. An entry that
   fires one turn in four is doing what it was told.
7. **Groups** — of the entries in one group that fired in a book, one survives, drawn by
   weight.

**Scripts written without spaces** — Chinese, Japanese, Thai — work badly with whole-word
matching, because a key surrounded by other letters never counts as a whole word. The
editor cannot turn whole-word matching off; set `"matchWholeWords": false` on those
entries in the book's file, or import the book with that setting.

**Regular-expression keys** are JavaScript patterns, given 50 milliseconds each. A pattern
that is invalid or too slow is reported and not run again in that scan.

### Timing

- **Sticky** — after firing, an entry stays in for a number of scans without needing its
  keys again.
- **Cooldown** — after it fires (or its sticky window ends), it cannot fire for a number of
  scans.
- **Delay** — it cannot fire until the story has that many turns.
- **Ephemeral** — after firing that many times, it is used up on this line of the story.

A scan is one reply call, so in a one-to-one chat **Sticky** and **Cooldown** count turns.
SillyTavern counts them in chat messages, two to a turn, and the importer copies the
numbers unchanged — so an imported book's sticky and cooldown windows last about twice as
long here. (The book's Markdown and the workbench call them *messages* all the same.)

These counters move only for entries whose text actually reached the prompt: an entry
dropped by a budget is not spent. They belong to the line of the story you are on, so
going back to an earlier turn puts them back as they were. **Redo** replays a turn's
probability and group draws; **Reroll**, shown on a turn that drew, draws again.

### Recursion

With **Recursive scanning** on, the content of the entries that fired is scanned again for
the book's keys, up to **Max recursion depth** more times. Recursion stays within one book.
Entries can be set to never feed it, never be found by it, or fire only through it.

### The book's limits

The entries that fired are ranked — **Constant** entries first, then entries whose key is
in the newest message, then by each entry's *order* (lower first). The book's **Entry
limit** is applied first and its **Token budget** second; an entry that does not fit is
skipped and the next is tried, so a smaller one can still get in. Tokens are estimated as
one per four characters, which can be well off for scripts other than English.

After that the whole prompt has to fit the model's window: if it does not, the lowest-
priority blocks go first, and lore ranks with **Constant** entries kept longest. See
[Presets and prompts](presets.md#how-a-prompt-is-put-together).

### Where an entry lands

| Position | Where it goes |
| --- | --- |
| **Before char** | The preset's lore slot. The usual place. |
| **After char** | The preset's *lore (after)* slot. The assistant's preset has none — nor does a new preset, which starts as a copy of it. |
| **At depth** | Inside the history, at the entry's depth — counted in messages back from the last reply. The editor leaves the depth at 0: just after the last reply, ahead of the move you are sending. |
| **Outlet** | Only a lore slot in the preset whose **Outlet** field has exactly this name (an outlet entry with no name lands in the ordinary lore slot instead). See below. |

An entry that fires with nowhere to land is recorded as unplaced on the turn.

**Outlets need a slot of their own, added by hand.** The shipped presets name no outlet,
and the preset editor cannot add a slot. Giving an existing lore slot an **Outlet** makes
it take that outlet's entries and nothing else — so naming a pack's only *lore* slot
leaves every **Before char** entry unplaced. Instead, add a second lore slot to your
preset's `preset.json`, beside the existing *lore* block:

```json
{
  "id": "my.lore.harbour",
  "label": "lore (harbour)",
  "role": "system",
  "enabled": true,
  "placement": { "at": "sequence" },
  "priority": 25,
  "appliesTo": [],
  "advisory": false,
  "omitWhenEmpty": true,
  "kind": "slot",
  "source": { "of": "lore", "phase": "before", "outlet": "harbour" }
}
```

A session plays from its own copy of its preset, so switch the session to the edited
preset afterwards. (The `{{outlet::name}}` spelling in the field's hint is not read
anywhere; only the slot's `outlet` counts.)

## Folders, gates and filters

**Folders** group a book's entries. They arrive with imported books — Marinara's, for one
— with entries imported from another book, or by hand-editing the file; the editor cannot
create, rename, nest or delete folders, or move an entry between them. When a book has
folders, the editor shows a **Folders** table:

- **Gate** — unticking it turns off every entry in that folder and the folders inside it,
  without touching the entries' own **Enabled**. The entry then says *off: the folder …
  is off*.
- Clicking a folder's name narrows the entry list to it, and is where the next **New
  entry** goes.
- **Ungrouped** holds the entries in no folder, and is always on.

**Filters** decide an entry's scenes rather than its words. They come from imports or the
file, and the editor shows them under **Grouping and gating**:

- **Actor filter** — fire only when particular characters are in the scene (or the
  persona), or never when they are;
- **Actor tag filter** — the same, by the tags on the characters, matched exactly. When
  you rename a tag, the tag manager offers to update the filters that name it — see
  [The library](library.md#tags);
- **Generation trigger filter** — by kind of call, named as the engine names them: for
  instance `narrate` for the replies, or `impersonate` for **Draft my next message**.

## Reading a lorebook

A lorebook's page in the library reads as a document: its description and settings, its
folders, and each entry with its keys and content.

- **Search this book** searches names, keys, descriptions and content. Clicking a key or a
  tag filters to the entries that carry it; **Clear** resets.
- **Expand all** and **Collapse all**; long content shows **Show all**.
- **Mark what the scanner sees** highlights where *other* entries' keys appear in each
  entry's text, under those entries' own rules — what recursive scanning would find.
  (Regular-expression keys are not shown.)
- **Mentions** and **Mentioned by** list the entries an entry names and is named by.
- **As configured** lists every setting of an entry.
- **Print** and **Copy as Markdown** — the Markdown has the book's title and description,
  folders as headings where entries sit in folders, each entry with its keys and a line of
  firing notes — off, always on, probability, sticky, cooldown — then its content.

## Moving entries between books

Above the entry list in the editor:

- **Select several**, tick entries (**All**, **None**), then **Export selected** — a
  lorebook named "*Book* — entries" (downloaded as *Book entries.json*) holding those
  entries and their folders.
  Pictures stay behind, and it says how many.
- **Import entries…** adds the entries from a StoryEngine lorebook file to this book: it
  never overwrites, renames a clashing name with " (2)", gives a clashing entry a new
  identity, and reuses folders the book already has. **What arrived** lists what was
  renamed, entries naming characters this install does not have, pictures that could not
  come, and the settings in which this book differs from the one the entries came from —
  which can make an entry tuned there go quiet here. Nothing is written until you save.

Import entries takes StoryEngine lorebook files only. To take entries from a SillyTavern
or Marinara book, import that book into your library first, then export entries from it.

## Seeing what lore did

The [workbench](playing.md#the-workbench) shows what retrieval did:

- **While you are typing a move**, it shows what would be sent, with a **Lore** section:
  each book in play and why (*linked by the treatment*, *linked by this session*,
  *memories of somebody in the cast*), how many entries and tokens it used against its
  limits, and **Did not fire** — every entry that did not fire and why: *none of its keys
  are in the text*, *the folder … is shut*, *it fired recently and is waiting*, *its
  probability roll failed*, and so on. This is the only place the reasons are shown.
- **For a finished turn**, the block table lists the lore that went in, each with why:
  *always on*, *keyword match: "harbour"*, *still active from an earlier turn*, *named by
  another entry*. Entries a book's own limits refused are not rows there.

The preview draws probability fresh each time, so an entry that fires half the time can
differ from what the turn then does.

### When an entry never fires

Work down this list; the first thing that is wrong is usually the only thing:

1. Is the entry on — its own **Enabled**, any folder's **Gate**, the book's **Book
   enabled**? The editor writes *off* beside it, and says which.
2. Is the book in this session — chosen, or linked by the treatment?
3. Is the key in the text that was scanned — the last **Scan depth** messages, two per
   turn?
4. Does it need secondary keys, or a whole word that is not there?
5. Is it timed — cooling down, delayed, used up — or set to fire only some of the time?
6. Did it fire and get dropped by the book's limits or the prompt's budget?

The workbench's preview answers most of these for the move you are typing. For the last,
it shows each book's entries and tokens against its limits, but an entry the book's
limits refused is not listed — it is neither a row in the block table nor under **Did
not fire**.

## Memory

### Memory books

Each character you play with can have a **memory book** for each persona you meet them as
— *Memories — Mira*, or *Memories — Mira (with Ned)*. They are ordinary lorebooks, marked
**Memories** in the library, written by play rather than by hand. A memory book reaches
any session with that character in the cast and the same persona, so what happened in one
story can come up in the next.

Memories get into a book two ways:

- **Remember this**, under any turn of a session with characters in it: choose **Whose
  memory**, write **What to remember** (it starts as the turn's reply — put it in your
  own words), give **Keywords that bring it back, comma separated**, and **Save to
  memories**. It is refused on a turn where a plot hook fired, because that turn's words
  may spoil a hook for another playthrough; write the fact from another turn instead.
- **Automatically**, on every eighth story turn while the session is sharing memories:
  one more model call reads the story turns since the last pass — the eight before the
  turn that triggers it, seven the first time — and writes the facts it finds, each with
  a few keywords, into the book of every character in the cast. The triggering turn, and
  any turns after the last pass, wait for the next one. It skips facts a book already
  has, never changes an existing entry, and if it fails, the turn is unaffected. Unlike
  **Remember this** it does not skip turns where a plot hook fired, so for a playthrough
  whose twists must not carry over, turn **Share memories from this session** off, or
  start it isolated.

Memories are kept when you rewind past the turn that made them, and when you delete the
session. Correct them as you would any lorebook entry: each says where it came from —
*Remembered from …, 1 Oct 2026, 14:05*, with *· left alone by automatic extraction* on
one you wrote — and a corrected entry is left alone afterwards. Since
the automatic pass compares wording, it can write a fact again that you reworded or
deleted.

Memory books start with the usual lorebook settings, so an old memory fires when one of
its keywords is in the last two messages.

### Memory settings for a session

In the session panel (*Prompted with …*) → **Memories**:

- **Share memories from this session** (on) — new memories go into the characters' books.
  Off makes the session read history without adding to it.
- **Use memories from these characters** (on) — earlier sessions with the same characters
  can reach this one. Off makes a fresh start — and, unless another session below is set
  to **Always**, hides this session's own memories too.
- **Remember across all my personas** (off) — by default, a character meeting a different
  persona is meeting a different person, and remembers a different history.
- **Books** — a link to each character's memory book, with how many memories it holds.
- **Other sessions with these characters** — **Auto**, **Always** or **Never** for each.

Choosing a memory book by hand in the lore panel brings it in as an ordinary book, outside
these rules.

When you start a session with a treatment you have played before, the sessions page warns
that memories — twists included — can reach it, and offers **Start isolated**.

### The running summary

Scene and Freeform sessions send the model the last 20 story turns in full. Once a story
is longer than that, the older turns are summarised, in stretches of 20, and the summary
goes into the prompt as *the story so far*. It needs no setting and has no controls — but
it runs only while the session's preset has a *the story so far* slot. Scene's and
Freeform's do; the Assistant's, and so a new preset copied from it, do not, and a session
switched to one stops summarising: turns older than the last 20 simply drop out.

- The newest stretch is re-summarised as it grows, so a long story costs one more model
  call per turn. Finished stretches are kept and reused, including on other branches.
- Summaries use *Writing the story*. Changing that model, or any of the preset's
  generation settings — the session's **Temperature** and **Maximum reply length** among
  them, including by switching to a preset whose settings differ — rewrites the whole
  summary on the next turn: many calls on a long story.
- A summary cut off at the reply length is not kept, and the step says so in the
  workbench; raise **Maximum reply length** if it keeps happening. Earlier stretches still
  reach the prompt.
- To see the summary, open the workbench on a turn: its blocks come from *Earlier turns*.
  There is no screen for reading or editing summaries.
