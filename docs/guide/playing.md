# Playing a session

A **session** is one story. Each time you send a move and the model answers, that is
a **turn**, and a session's turns form a tree rather than a list: redo a reply and the
new attempt sits beside the old one; go back to an earlier turn and carry on, and the
later turns are kept as a branch. The turn you are on now is the **head**, and the
play page shows the line from the start of the story to the head.

Nothing in a session is ever deleted by playing it. Every attempt, every branch and
every abandoned line is still there, and still searchable.

This page covers what every session has. What is particular to Scene, Freeform and
the assistant is in [Modes](modes.md); pictures are in [Pictures](pictures.md).

## The sessions page

**Play**, in the header, lists your sessions, most recently changed first — renaming a
session, archiving it or changing one of its settings moves it to the top as a turn
does. Each row has the session's name — *Untitled session* if it has none —
**Rename**, and **Add to a world…**, which lists your worlds that do not already hold
the session and adds it to the one you choose: the session becomes a member of that
world, beside its books and characters, and nothing about the session changes.

- The mode chips over the list narrow it to **Scenes**, **Freeform** or **Assistant**
  sessions (**All sessions** shows every one); **Select several** picks more than one.
  The chips are hidden when only one mode is installed.
- **Show archived sessions** includes the ones you archived, marked **Archived**.
  Archived sessions are only hidden from this list: they stay playable from their
  address, and search still finds them.

Sessions the assistant creates for itself are ordinary sessions named *Assistant*,
so they appear here too.

## Starting a session

The quickest start is a name (or none) in **Name it now, or later**, then **Start**.
The new session appears at the top of the list — **Start does not open it**; click it
to begin.

### Characters

**Characters** — who is in the scene — appears for modes that seat more than one
character. Tick characters from your library; the order you tick them in is the
order of the cast. Scene seats up to 32, Freeform up to 6. If you tick more than the
mode seats, only the first ones are used. It is hidden when you
[start from a setup](#starting-from-a-setup), which brings its own party.

In Scene, a character whose card has several openings gets **How *name* opens**,
choosing which greeting starts the story. Only greetings with words in them are
offered: one left blank on the card is skipped. The openings are written as the session's
first turn: one character's alternative greetings become versions of that turn you
can step between, and a group gets one opening message from each member.

### The setup

The disclosure under the start form summarises its choices — *Nothing chosen yet —
the mode default, and no lorebooks* — and opens to:

- **Start in a world** — one of your worlds, or **No world**. See
  [Starting in a world](#starting-in-a-world); it fills in the lorebooks and the
  treatment below, for you to change. Shown only when you have a world.
- **Start from a setup** — one of the setups in your library, or **None — choose
  everything below**. See [Starting from a setup](#starting-from-a-setup); choosing
  one replaces every control below.
- **Mode** — what kind of story this is: Scene (the default), Freeform or Assistant.
  It decides what else is asked, and **it cannot be changed afterwards**.
- **The mode's own questions.** Freeform asks for a premise and two settings; see
  [Modes](modes.md#freeform). A required list shows its first option but records
  nothing until the selection changes, so in each one pick another option and then
  the one you want — even when it was already showing. Until you do, **Start** is
  refused with *That is not what this mode asked for.*
- **Treatment** — the setting and story this session is in, with its framing,
  lorebooks and plot hooks. See [Concepts](concepts.md#the-library).
- **Preset** — how prompts are put together: the mode's own, or one from your library.
  The session keeps its own **copy**, so editing the library preset later does not
  change a story in progress; you can switch the session to another one later.
- **Persona** — who you are playing: **Nobody in particular**, or a character from
  your library. The narrator is told who you are and addresses you by name. The
  persona cannot be changed from the app once the session has started.
- **Lorebooks** — which of your lorebooks this story draws on. A treatment brings its
  own as well.

(The fine print on this form says everything but the preset can be changed later; in
fact the preset can be switched, and the mode and persona cannot.)

**Save as a setup** keeps these choices as a library object to start from again. It
needs a name first. It keeps the mode and its answers, the treatment, the preset,
the persona and the lorebooks — not the characters or their openings. To keep a point
in a story you are already playing, use
[Make a setup from here](#make-a-setup-from-here) instead.

### Starting in a world

Pick it in **Start in a world**. Its lorebooks are ticked under **Lorebooks**, after
any you had already ticked and in the order the world holds them, then every lorebook
of yours whose **Scope** is for this world, by name (see
[The book's settings](lorebooks-and-memory.md#the-books-settings)); and its treatment
is chosen if it holds exactly one; if it holds several, they are listed first and
none is chosen — you pick. **All of it is yours to change before Start**: untick a
book and it stays unticked, choose another treatment or **None**, and the session
starts with what the form shows. A book the world names that is no longer in your
library is listed as *(not in your library)*. Choosing another world, or **No
world**, takes back only what the previous world filled in.

The new session **joins the world** — it appears among the world's members, and its
page says **In these worlds**. What it copied is now the session's own: editing the
world afterwards changes nothing in a session already started. A lorebook is in a
session because the session's list names it: a book's scope can put it in the start
form, and from then on it is the list that counts.

With a **setup** chosen as well, the setup decides, and the world adds under it: its
lorebooks join the setup's, and its treatment is used only if the setup names none.
The form says which.

A world's own page has **Start a session in this world**, which starts and opens it
in one step with exactly what the world holds, and **Choose first…**, which opens
this form with the world already picked.

### Starting from a setup

Pick it in **Start from a setup**. The disclosure's summary then reads *From the
setup "…"*, and the mode, treatment, preset, persona, lorebooks, party, goals and plot
hooks all come from the setup — to change any of them, open it in the library. What
is left to choose is how it begins:

- **Opening**, when the setup has written openings of its own: **Its own — …** (its
  main one), any of the others by name, or **None — start cold**. An opening is the
  story's first turn, written rather than generated, so it is the same every time, and
  there is no **Redo** on it.
- **A setup's own opening comes first, always.** In a mode whose characters greet you
  — a Scene chat — a setup that has an opening begins on it, and its characters'
  greetings are not used, not even if you choose **None — start cold**. The form says
  so when there are greetings it is setting aside.
- A setup with no opening of its own, in a mode that greets you, begins on its
  characters' greetings instead, and **How they open** lets you choose each one's.

**Start** works as it always does — the session appears at the top of the list. A
setup's own page has **Start a session** too, which starts and opens it in one step;
see [The library](library.md#an-objects-page).

The setup's party is seated from the start — in the cast, as companions — the first of
its goals is the one the story begins on, and a plot hook it lists as already used is
marked as fired, so it does not happen again.

If the treatment you chose is one you have played before, the page says so: memories
from the earlier sessions can reach this one, twists included. **Start isolated** stops
the new session using memories from other sessions and sharing its own; **Keep memories
on** leaves both on. See
[Lorebooks and memory](lorebooks-and-memory.md#memory).

**Load a session or a chat** brings in a StoryEngine session export or a SillyTavern
or Marinara chat as a new session — see
[Importing and exporting](importing-and-exporting.md#chats-and-sessions).

## The play page

From the top: the session's name, **Rename** and **Add to a world…**, and under them
**In these worlds** when any world names the session; a strip of the story's state where
the mode keeps one; the **Cast**; for a Scene chat, **How this chat plays**; the lore
panel (*Retrieving from …*); the session panel (*Prompted with …*); goals; plot
hooks; Freeform's dials; picture controls; the **transcript**; and at the bottom the
composer.

The transcript runs oldest at the top, in its own scrolling area. It shows the most
recent **100** turns of the line you are on; older ones are in the
[reading view](#reading-a-story) and in [search](#search). It does not scroll itself:
when a reply arrives, scroll down to it.

## Taking a turn

Type in the box at the bottom and press **Enter** to send — **Shift+Enter** starts a
new line. **Send** reads **Sending…** while it goes. The reply streams into the
transcript; until the first words arrive the page says *Waiting for the first
words…*.

- **What kind of turn.** Freeform offers **Do**, **Say**, **Think** and **Story**
  (writing the next part yourself); the box's prompt changes with it — *What do you
  do?*, *What do you say?* and so on. The choice sticks between turns. Scene and the
  assistant take one kind of move and show no buttons.
- **An empty box.** In a Scene chat, sending nothing means **Let them talk**: the cast
  carries on without you. Anywhere else, an empty Send does nothing.
- **Guidance for this turn**, folded under the composer, is a note to the model about
  this one turn — *Keep this short. Not part of the story.* It is sent beside your
  move rather than in it, and cleared once the turn is sent.
- **Pictures**: **Attach a picture** adds up to four pictures to a move, each with a
  caption. See [Pictures](pictures.md#showing-the-model-a-picture).
- **Stop** replaces **Send** while a turn runs. A stopped turn stays in the story as a
  failed turn with whatever it had written, and raises no notification.

The **context meter** above the box shows how much of the room the prompt may use the
next turn would take — the room being the model's window, less the share the pack holds
back and the space kept for the reply. It is re-measured as you type and changes colour
at 85% of that room. Click it to open the workbench; with something typed, it shows what
would be sent.

A turn runs **on the server**, not in your browser. Closing the tab mid-turn is safe:
the turn finishes, and when you come back the page picks up where it was — or a
notification is waiting. If the server itself stops mid-turn, a turn that had started
writing is recorded as failed when it starts again; one caught before it had written
anything leaves no turn behind, so send the move again.

### Help with your own move

- **Draft my next message** has the model write your persona's next move into the box.
  Nothing is sent: edit it, send it, or press again for another. It needs a persona;
  with *Nobody in particular* it is refused with *You do not author that character, so
  there is nothing here to draft for.*
- **Suggest what I could do**, a switch under the composer, offers a few possible next
  moves after each turn, as buttons that fill the box. It costs one more model call
  per turn and is off by default.

## Branching, rewinding and undoing

Under each turn — on hover or keyboard focus, and always on a touch screen — are the
actions for that turn:

- **Redo** — another attempt at that turn, from the same point with the same words.
  The page follows the new attempt, and the old one stays beside it. Any dice the turn
  rolled are replayed, so what happened holds and only the telling changes.
- **Reroll** — the same, with fresh dice. It appears only on turns that rolled any.
- **Redo with guidance** — asks *What should change?* and redoes the turn with your
  note and the previous attempt in front of the model.
- **Continue from here** — makes that turn the head. The turns after it leave the page
  but are kept, and your next move starts a new branch from there.
- **Make a setup from here** — turns the story up to that turn into a setup new
  sessions can start from. See [Make a setup from here](#make-a-setup-from-here).
- **Undo** — reverses the **state** that turn changed (a dial, someone's presence, a
  hook firing) by adding a new turn that puts the old values back. It does **not**
  remove the turn's text: to drop a reply, **Continue from here** on the turn before
  it, or redo it. Undo is refused for a turn that changed no state — *That turn changed
  no channel state.*, which in Freeform and the assistant is most ordinary turns — and
  for one whose state a later turn has changed since: *Something has written those
  channels since. Branch instead.* In Scene every turn moves the story clock on, so Undo
  on the newest turn turns the clock back and leaves the text, and on any earlier turn it
  is refused.

A turn with more than one version carries **‹ 2 of 3 ›**: step between the versions,
and play resumes from wherever you last were on that line. **Name this line** gives a
version a name (the app does not yet list named lines anywhere).

A turn that failed stays in the transcript as *This turn did not finish.* with the
reason; **Redo** tries it again. See [Troubleshooting](troubleshooting.md).

Changes to the story's state from the panels — a dial, a hook's pacing or commitment,
someone's presence or status, a goal's progress, the suggestions and pictures
switches — are recorded as turns too, with no text of their own. That is what lets you
rewind them, and why they appear as empty rows in the transcript. The session's
settings are not turns, and rewinding does not change them: its lorebooks, prompt pack,
temperature and reply length, memories, a chat's cast list, and the hooks you add or
remove. Things a session
writes **outside itself**, such as memories saved to a character's book, are not
undone by rewinding; the page says so when you move away from a line that wrote
some.

## Make a setup from here

**Continue from here** keeps the history behind a turn; **Make a setup from here**
condenses it away. It saves the point you are at as a setup in your library — a
starting place you can begin from again and again, or hand to someone else in a
world, without the turns that led there. It is offered on every turn, beside
**Continue from here**.

It opens a dialog that drafts four things, each with one model call (on the model set
up for writing), and each one you can edit, steer with a note and **Regenerate**:

- **The story so far** — *What had already happened*, condensed from what you saw in
  this session up to that turn. A session started from the setup shows it to the model
  from its first turn, as the oldest part of the story's running summary.
- **Opening** — *The first thing the story says*: **A new scene, written for someone
  arriving**, or **This turn's own words**, which copies the turn as it is and makes no
  call.
- **Established facts** — what the story has settled: people, places, decisions. Each
  fact you keep becomes an entry, found by its keys, in a lorebook linked from the
  setup. A fact with no keys is never found, and is dropped.
- **Name and blurb.** A setup needs a name.

A part that fails says why and leaves the others as they were. Above them, **What it
carries** lists the mode, treatment, preset, persona and lorebooks, and three switches:
**The party**, **Goals** and **Plot hooks**. Switch one off and the setup leaves it out.
*The party* is who travels with you — your companions — not everyone in the scene: a
character who was there without ever joining the party is not carried, and the switch
reads *The party (nobody but you)* when nobody has joined.

**Nothing it would spoil is shown.** A plot hook that has not happened yet is counted,
not described — *3 still waiting, 2 already used* — and a goal hidden from you reads
*Begins on a goal that is hidden from you.* They are carried all the same: the setup
holds them, and a session started from it plays them when their time comes. Hooks
already used are marked as used, so they do not happen twice.

If this session's prompt pack has no place for a summary, the dialog warns that a
session started with the same pack will not show the model the story so far; a pack
with a summary slot will. See [Presets and prompts](presets.md).

**Save as a setup** writes the facts' lorebook first and then the setup, and offers
**Start a session from it**. The setup is an ordinary one from then on: open it in the
library to edit its story so far, its name, its plot hooks or anything else the editor
writes, and every session started afterwards begins from the edited version. See
[Starting from a setup](#starting-from-a-setup).

What does not carry: who is present or dead (the story so far says it, the cast does
not); a character who was in the scene without ever joining the party — in a chat, the
character you were talking to, unless the story made them a companion — whom you can put
back with [Add to the cast](modes.md#the-cast-in-a-chat) once the new session has begun;
a dial's current value; and changes this session made to its own copy of the prompt
pack — the setup names the library preset.

## The panels

### Cast

Everyone in the story, each with a badge — **Here**, **Elsewhere**, **Dead**,
**Departed** — and, where it applies, **You write them**, **Companion** or **With
you**; someone not yet met says *not yet met*. Each row has **In the scene** and a
status list (**Alive**, **Dead**, **Departed**). These are part of the story's state,
so a character can be dead on one branch and alive on another. Nothing in play
changes them for you: they change when you change them.

A character counts as met only once their presence has been set on this line, and
nothing in play sets it: until you tick **In the scene** (or, in a chat where the
characters speak for themselves, mute and unmute them), the row says *not yet met*,
and every plot hook about them is held as *Someone it is about is not here*.

In a Scene chat the cast panel does more — making someone speak, muting them, adding
and removing members, how readily each joins in. See
[Modes](modes.md#the-cast-in-a-chat).

### Lore — *Retrieving from …*

Which **Treatment** the session uses and which **Lorebooks** it draws on; **Save
selection** applies changes from the next turn. These are links to your library, not
copies: edit a lorebook and the session uses the new text at the next turn. See
[Lorebooks and memory](lorebooks-and-memory.md).

### The session — *Prompted with …*

- **Prompt pack** — keep the session's copy, switch to the mode's own, or switch to a
  preset from your library. Switching copies the pack into the session; turns already
  taken keep what they were built from.
- **Temperature** and **Maximum reply length** for this session, starting from the
  pack's own values. Blank leaves them to the provider. Each saves when you leave the
  box or press Enter.
- **Read it as a story**, **Export this session**, **Archive this session** and
  **Delete this session** — see [Reading a story](#reading-a-story) and
  [Archiving, deleting and exporting](#archiving-deleting-and-exporting).
- **Memories** — whether this session shares and uses memories. See
  [Lorebooks and memory](lorebooks-and-memory.md#memory).
- **Illustrate the story** — **Never**, **Only when I ask** or **Every turn**. See
  [Pictures](pictures.md).
- For a session imported from a chat, **Update from source**. See
  [Importing and exporting](importing-and-exporting.md#chats-and-sessions).

Editing one block of the session's pack opens from the workbench (**Edit in the
pack**). See [Presets and prompts](presets.md#a-sessions-own-copy).

### Goals

A story can have an objective, or a chain of them, written into a setup or set by you.
A session [started from a setup](#starting-from-a-setup) begins on the setup's first
one; otherwise you set it here. The panel's heading says where things stand:
*Working toward: …*, *Playing on, with no objective*, *The story has ended*.

- **Set an objective** and **Set** adds one and points play at it. The narrator sees
  the current objective every turn.
- After each turn a **judge** — one more model call — asks whether the objective is
  met, leaning towards *not yet*. Its *yes* is only a question to you: *The narrator
  thinks this is done. Is it?* — **Yes, that's done** or **Not yet**.
- **Mark it done** (or **Done**) completes it yourself.
- Once done: **Carry on**, **Next: …** for the next objective in the chain, or **End
  the story**. An ended story stays readable, and you can still play on or rewind.

### Plot hooks

A plot hook is something that could happen — a stranger at the door, a storm — kept
back until the moment suits it. Hooks come from the treatment, the setup and the
session's lorebooks when the session starts, and you can add your own. The heading
says how many are eligible now.

- **How often hooks fire**: **Rarely**, **Now and then** (the usual default), **Often**,
  or **Only when I say**. A judgement — one more model call — decides whether one fires.
  It runs every sixth story turn at **Rarely**, every third at **Now and then**, every
  turn at **Often**, and never at **Only when I say**; after one fires it waits 20, 10 or
  4 story turns. A committed hook is judged every turn whatever the setting.
- Each hook says where it came from, whether it is eligible, and if not, why: *Already
  fired*, *Waiting for a later turn*, *Someone it is about is not here*, *Its lorebook
  is not in this session*, and so on. What a hook says will happen stays hidden until
  it fires.
- **Commit** puts a hook first in line, asking first if it is held back for a reason;
  **Release** lets it go. A committed hook that has not landed within three turns goes
  back to the pool.
- **Remove** takes a hook out of this session only.
- **Save this to…** copies a hook into the session's treatment, setup or one of its
  lorebooks, for future stories. The session is unchanged.
- **Add** a hook of your own: *Something you want to happen* and *What happens*; the
  judgement decides when.

To fire a particular hook on the next turn without waiting, use **Audition a hook** in
the [workbench](#the-workbench).

### Dials

Freeform sessions have two: **How much the world resists you** and **How much the
narrator steers**. Harder means longer and more expensive, never impossible. Each
change is a turn, so rewinding undoes it.

## The workbench

The workbench is a panel beside the page that shows what a turn was made of. Open it
from **Workbench** in the header, with **Ctrl+`** (when the keyboard is not in a text
box), or by clicking the context meter; **Close** shuts it, and so does **Escape** while
the keyboard is inside it. Its width can be dragged, and whether it is open is
remembered for your account. On a phone-sized screen it takes over the page.

Over a session it shows, by default, the turn beneath the page:

- **While a turn runs** — its progress, step by step, and the effects so far.
- **While you are typing** — *What happens next*: what would be sent if you sent now,
  nothing yet sent. This is the only place that lists the lore entries that did **not**
  fire, and why.
- **For a finished turn**, one section per model call:
  - the **block table** — every piece of the prompt, where it came from, why it is
    there, its size, and what the budget did with it. Blocks that were dropped stay as
    faded rows. A block from the preset has **Edit in the pack**;
  - the **budget** — the window, the share used, room kept for the reply, what was
    spent, and what would fall out first;
  - the model that answered, the settings sent, token counts, time taken, retries, and
    the messages exactly as sent.

  Then for the whole turn: its **effects** on the story's state (applied or rejected,
  and by whom), its **pictures**, its **steps** (ran, skipped or failed, with reasons),
  and its **cost** in tokens and time. Money is never priced.

**Showing** picks any of the last 100 turns on the line, numbered from the oldest of
those. **Compare with the turn before it**
opens the two turns' records side by side: the pair, an aligned block table marking
what changed, what was asked and what came out.

**Audition a hook** lists the waiting plot hooks with **Fire next turn**: the hook is
delivered on the next turn with no judgement. Rewind afterwards to put it back.

## Reading a story

**Read it as a story**, in the session panel, shows the line as prose with none of the
machinery: your moves as quoted blocks (*You did*, *You said*), each speaker's lines
under their name, and illustrations in place. **Copy as Markdown**, **Copy as text**
and **Print** are at the top; printing gives the whole story, black on white, without
the app around it. (Over plain HTTP to a network address the browser will not copy;
select the text yourself.)

It is live rather than a snapshot, and shows up to the 1,000 most recent turns. A
search result opens it at the story as it stood at that turn.

## Search

**Search**, in the header, searches your library and every turn of every story you
own — your words, picture captions and the replies, in archived sessions too, but not
in the trash. Results come in three groups: **In your stories**, **In your library**
and **In your lorebooks**. A story result opens the reading view ending at that turn.

By default only matches on the line you are on are shown; **Also show … hits on
branches you left** adds the rest, marked *On a branch you left*.

Search understands quoted phrases and trailing `*` for word starts. Punctuation — an
apostrophe as in `Vera's`, a hyphen as in `half-elf`, a comma or full stop — works only
inside double quotes (`"Vera's"`); unquoted, like unbalanced quotes, it gives *That
search could not be run. Try different words.* Each group shows at most 50 results,
best matches first, and the count of hits on branches you left is taken from within
those.

## Archiving, deleting and exporting

All three are in the session panel.

- **Archive this session** hides it from the sessions list at once, and **Take out of
  the archive** brings it back. Nothing else changes.
- **Delete this session** → **Move it to trash** moves the whole session to your
  trash, from where Settings → **Trash** → **Put it back** restores it. Memories it
  saved and anything it added to your library stay where they are. A session cannot be
  deleted while a turn is running in it.
- **Export this session** downloads a `.session.json` file with every turn on every
  branch. Pictures travel as their descriptions, not their pixels; a
  [backup](backups-and-trash.md) carries the pictures themselves. **Load a session or a
  chat** on the sessions page loads such a file as a new session — on another install,
  or on this one once the session it came from has been deleted. While that session is
  still here it is refused: *That session is already here…*

## When the story will not move

- *This session already has a turn in flight.* — one turn at a time per session,
  including one started in another tab or on another device. Most panels say *A turn is
  running. Try again when it has finished.*; the goals panel says *That could not be
  saved.*
- *The session has moved on since this was composed.* — another tab or device moved
  the story on (a turn, **Continue from here**, a panel change) and this page is
  behind. Your draft is kept: switch to another tab and back so the page catches up,
  then send again. Reloading also works, but it empties the box — copy your draft
  first.
- *This server is restarting. Your next turn will go through once it is back.*
- *No model is set up to write with yet, so a move cannot be sent.* — nothing is bound
  to *Writing the story*; **Choose one in Settings** goes there. See
  [Connections and models](connections-and-models.md#jobs).
- *This turn did not finish.*, with a reason — see
  [Troubleshooting](troubleshooting.md#a-turn-did-not-finish).

Two tabs on one session both show a running turn as it streams. Changes that are not
turns of text — **Continue from here**, a panel change — reach the other tab when it
is reloaded or refocused.

## Limits

| | |
| --- | --- |
| A move | 100,000 characters |
| Guidance for one turn | 4,000 characters |
| Pictures on one move | 4, PNG, JPEG or WebP of any size: each is scaled down to 1,568 pixels on its longer side before it is sent |
| Lorebooks in a session | 64 |
| Characters in a session | Scene 32, Freeform 6, the assistant 1 |
| A session's name | 200 characters |

## Keyboard

- **Enter** sends; **Shift+Enter** is a new line.
- Freeform's move buttons (**Do**, **Say**, **Think**, **Story**) are one stop for Tab:
  the arrow keys move between them, **Home** and **End** jump to the ends.
- **Ctrl+`** opens and closes the workbench when the keyboard is not in a text box;
  **Escape** closes it while the keyboard is inside it.
- **Skip to the page**, the first Tab stop on every page, jumps past the header.
- The plot-hook questions put the focus on **Cancel**; **Delete this session** does
  not.
