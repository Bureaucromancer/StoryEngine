# Modes

A **mode** is the kind of story a session is. You choose it when you start the
session, under **Mode** in the start form's setup, and it cannot be changed
afterwards. Three modes ship:

| Mode | What it is | Who writes the replies |
| --- | --- | --- |
| **Scene** (the default) | A roleplay chat with one character or a group, in the manner of SillyTavern or Marinara Engine. | The characters, each in their own voice — or a narrator, if you prefer. |
| **Freeform** | A narrated story that grows from a premise you write. You say what kind of move each one is, and two dials set how hard the world pushes back and how much the narrator steers. | A narrator. |
| **Assistant** | Help with StoryEngine itself and with the object you have open, from the **Assistant** button in the header. | The assistant. |

Everything that sessions share — the sessions page, taking turns, branching, the
panels, the workbench — is in [Playing a session](playing.md). This page is what each
mode adds.

The page of a session does not say which mode it is in; the mode chips over the sessions
list (**Scenes**, **Freeform**, **Assistant**) do. A session whose mode is not installed on this server is played as a
Scene, without a warning.

## Scene

A Scene is a chat. You write a line; the characters answer, each in their own message
with their own portrait. With several characters it is a group chat, and they answer
each other as well as you.

### Starting a Scene

Tick the **Characters** on the sessions page — up to 32 — in the order you want them
seated. A character whose card has more than one greeting gets **How *name* opens**,
with the card's usual one marked *(their usual)*.

The greetings become the story's first turn, without a model call. `{{user}}` in a
greeting becomes your persona's name (or *the player* if you have none) and `{{char}}`
the character's. With one character, each of its greetings becomes a version of that
first turn you can step between; with a group, the first turn holds one greeting from
each member, in cast order. Characters without a greeting are skipped.

A Scene with no characters at all is narrated. A typed line gets a reply, but **Let them
talk** is refused there (*Nobody here can reply…*), and so the automatic carrying-on below
stops at once.

### Chatting

- **Send** — type and press Enter. Who answers is decided by **Who replies** (below),
  unless you choose.
- **Let them talk** — with the box empty, **Send** becomes **Let them talk**: a turn
  with no line from you, and the cast carries on. If nobody can answer — everyone muted,
  dead or gone — the page says *Nobody here can reply: everyone is muted or gone. Name
  somebody, or unmute them in the cast.*
- **Who speaks next** — choose the next speaker for one turn. While a round streams, the
  same place shows who is replying and why: *The rules chose*, *A model chose*, *You
  chose*.
- **Speak**, on a cast row, asks that character to reply now. It reaches muted
  characters too, but never your persona, or someone dead or departed.
- **Push the story** — **Naturally** or **With a surprise** — nudges the next reply to
  move things on. It costs one small model call before the reply.
- **Let them keep talking on their own**, with **Seconds of quiet** (5 by default),
  sends **Let them talk** whenever the chat has been quiet that long. Typing, **Stop**,
  opening an edit box, a failed turn or nobody being able to reply turns it off, and it
  is forgotten when the page reloads.

### Who replies

**How this chat plays** → **Who replies** decides who answers each turn. *Eligible*
means seated in the cast, not your persona, not muted, and not dead or departed.

| Choice | Who answers |
| --- | --- |
| **Whoever is addressed, then whoever feels like talking** (the default) | Anyone you name in your message, in the order you named them; then anyone whose talkativeness roll succeeds; failing that, one at random. On a turn you did not start, the last speaker sits out. |
| **Everyone, in cast order** | Every eligible member, once each. |
| **One at a time, taking turns** | One member — someone who has not spoken since your last message, where possible. |
| **Only who I ask, or one at random when I let them talk** | Nobody answers a line you type; use **Who speaks next** or **Speak**. **Let them talk** gets one at random. |
| **Smart — a model picks who replies** | A name in your message still wins. Otherwise a model chooses up to **The most a smart pick may choose** (3 by default). If that call fails or names nobody who can reply, the default's pick plays instead. One extra call on turns where nobody is named. |

Naming someone makes them answer only under the default and **Smart**; under the
others, a name in your message is just words — whatever the hint under **Who replies**
says.

**How readily they join in**, on each cast row, is a character's talkativeness: from
*Rarely: when named, or if nobody else can* to *Whenever they can*, 50% by default. It
is stored on the **character card**, so it changes every chat that character is in,
and it cannot be changed on a shipped card.

### Who writes the replies

- **The characters, each in their own voice** (the default) — each speaker writes their
  own message. With **Each character replies in a call of their own** (on by default),
  every speaker gets a model call of their own, seeing the replies before theirs. Off,
  one call writes a reply that may speak for several characters at once.
- **A narrator, telling the scene** — one call, written as narration in the third
  person; the characters' own card prompts are not sent. In this voice the cast's
  checkbox reads **In the scene** rather than **Muted**, and the per-character controls
  go: **Who speaks next**; **Speak**, **How readily they join in** and **Card prompts**
  on cast rows; **Another reply** and **Continue** on messages.

When each character replies in a call of their own, StoryEngine tidies a reply that
wanders: a leading `Name:` is removed, and the reply is cut where it starts writing
another member's or your lines. **Edited: show the original** keeps what the model
actually wrote.

### Working with messages

On each message — on hover or focus, and always on a touch screen:

- **Edit** — rewrite the message by hand. It becomes a new version of that turn; no
  model is called. Editing your own line keeps the replies that followed it.
- **Another reply** — the same speaker tries that message again, as a new version. On a
  message that is not the last of its round, the new version keeps the lines before it
  and drops the replies after it; those stay on the old version, a step away with ‹ ›.
- **Continue** — on the last message, the same speaker carries on from where it stopped.
- **Hide** / **Unhide** — the model stops seeing that line, which stays on screen,
  faded: *Hidden from the story. The characters do not see this line.* On your own line,
  **Hide this exchange** hides the whole turn with its replies. Hiding changes the line
  where it is; it is not a branch.
- **Branch here** — keeps the round up to this message as a new version, or, on the
  last message of an earlier turn, continues from there.
- **Delete** — on the last message of a turn: go back to the turn before. The exchange
  is kept as a branch.

A message with versions carries **‹ 2 of 3 ›** to step between them; a one-character
chat's greetings appear there too. **Thinking** opens a model's reasoning, where it
sent any. The turn-wide controls — **Redo**, **Continue from here**, **Undo** and the
rest — are under each turn as in every mode.

### How this chat plays

The settings for one chat, in the panel under the cast. Switches and lists save as you
change them; **The most a smart pick may choose** saves when you leave the box; the
author's note has its own **Save the note**; and the agents' cadence and rules cards
change with **Edit**, then **Save**:

- **Who writes the replies**, **Each character replies in a call of their own** and
  **Who replies** — above.
- **A character may reply straight after themselves** — off by default.
- **Naming speakers to the model** — whether lines in the history sent to the model
  carry `Name:` in front: **Never name who said what**, **Name who said what once two
  or more are talking** (the default), **Always name who said what**.
- **Send the prompt pack's own instruction** — on by default. Off sends a card's own
  system prompt alone, which is what SillyTavern does by default.
- **Author's note** — standing advice placed a few lines back in the story: **How many
  lines back** (4) and **Every how many of your messages** (1; 0 switches it off). It
  stays until you change it, unlike guidance, which lasts one turn. **Save the note**,
  **Remove the note**.
- **What each card sends** — for each character, whether its **system prompt**, its
  **post-history instructions** and its **depth prompt** are used. All three are on by
  default; the same switches are on each cast row under **Card prompts**.
- **Agents** — the optional helpers below.

A card's system prompt goes in just after the pack's own instruction, the depth prompt
inside the history at the depth the card asks for, and the post-history instructions
last, after your line. They are sent only when the characters speak in their own
voices; each character's call carries its own card's prompts.

These settings, apart from the agents, belong to the session as a whole: they apply on
every branch, and rewinding does not change them. Each agent switch is recorded as a turn
instead (see [Agents](#agents)).

### The cast in a chat

In a Scene, each cast row has a portrait, a status badge, **Muted**, a status list
(**Alive**, **Dead**, **Departed**), **Speak**, **Remove from the cast**, **How readily
they join in** and **Card prompts**. **Choose a character** and **Add to the cast**, at
the bottom, seat anyone from your library. Characters added later get no greeting:
greetings are written only when the session starts.

A muted character is never chosen to reply, and their card leaves every model call
except one where they are made to speak.

### Time, place and the stage

A Scene keeps a **clock** — Day 1, 08:00 at the start, five minutes later every turn —
and, once one is named, a **place**. Both show in the strip at the top. They are given to
every reply — each character's call as well as a narrator's — to the suggestions and to
**Draft my next message**, as *When this is happening* and *Where this is happening*.

Two switches in the panels under the cast decide how much the scene is staged. Both
are off by default. With either or both on, one more model call follows every reply,
shared by the two; **Stage a backdrop** also makes a picture when the place changes:

- **Show the scene** — reads each reply, picks an expression for each present character
  whose card has labelled expression pictures, and names the place.
- **Stage a backdrop** — names the place, and makes a backdrop picture when the place
  changes. See [Pictures](pictures.md#backdrops).

Expressions come from a CHARX character card: every picture in the archive besides the
portrait becomes an expression, labelled by its file name. SillyTavern's sprite folders
are not brought in, and there is no control in the app for adding expressions yet. Each
turn shows every character's *current* expression.

### Agents

Under **How this chat plays** → **Agents** are helpers that run beside the chat. Each is
off by default, each costs model calls on *Writing the story*, and each switch is
recorded as a turn, so it follows branches and rewinding undoes it. A helper that fails
never fails the turn; the workbench records it as a warning.

**Trackers** keep a record of the story and give it back to the model every turn, just
before your line, as what the story has established so far:

| Switch | Keeps |
| --- | --- |
| **Track the world: date, time, place, weather** | **The world** — date, time, location, weather, temperature. While it is on, it replaces the clock and place lines in the prompt. |
| **Track each character: mood, appearance, outfit, thoughts** | A card per present character, with stats. Hiding one of the four fields also freezes it: the model is neither shown it nor allowed to change it. |
| **Track your character: status and stats** | **You**. |
| **Track quests and their objectives** | **Quests**, with objectives to tick. |
| **Track your inventory and money** | **Inventory**. |
| **Track custom fields you name** | **Custom fields** — values for names you add; the model never adds rows. |

All the trackers that are on update together in one model call after a reply — every
turn by default (**Every how many turns**), or only when you press **Update trackers**.
The model is told to change only what the story showed. Each card can be edited by hand
(**Edit**, **Save**); in edit mode, **Lock** keeps the model from changing a field, and
**Hide** keeps it off the card (both save at once). **Update trackers** runs them now
and records the result as a turn; *Nothing to change.* means nothing moved.

**Keep a secret plot** has a model keep a hidden arc the story is building toward, which
steers the replies without being announced. It is revisited every few turns (four by
default) and when an arc resolves. **Show me the secret plot** reveals it, and the card
can be edited.

**Edit replies for style** has a model rewrite each reply against your rules — banned
words and phrases, what to avoid, what to prefer. **Check replies for continuity** lists
what a reply gets wrong under it, each finding with **Apply** where it names a fix; **Let
the editor fix continuity itself** rewrites instead. With **Show replies only once the
editor is done with them** (on by default), replies stay hidden until edited. One editor
call per message; if any of a round's calls fails, the whole round goes through
unedited.

**Echo chamber** writes a one- or two-sentence aside from each present character after a
reply, shown as **Reactions** beside the chat. It is never sent to the model, so it
cannot steer the story.

They run in this order: secret plot, the reply, the editor, staging, the trackers, the
echo chamber.

### Scene's prompt pack

The shipped **Scene** preset sends, in order: the instruction for the voice in use, the
character's system prompt, the treatment's framing, your persona, each character's
summary, looks, voice, traits and background, lore, the speaker's writing samples, the
secret plot, the time and place, the summary of the story so far, the last 20 story
turns with the card's depth prompt placed among them, what the trackers have
established, the current goal, guidance and any redo note, your line, and the card's
post-history instructions.
Temperature 0.85, replies up to 800 tokens. See [Presets and prompts](presets.md).

### Older sessions, and imported chats

Sessions started before Scene became a chat show **As this session was first played**
under **Who replies**, and play narrated. To have the characters speak, choose **The
characters, each in their own voice** *and* another **Who replies**.

SillyTavern and Marinara chats always import as Scenes. A Marinara chat switches on the
matching agents it was using (trackers, secret plot, editor, echo chamber); any others
are named in the import report and left off. See [Importing and exporting](importing-and-exporting.md#chats-and-sessions).

## Freeform

Freeform is a narrated story. A narrator in the third person answers your moves, and
you say what kind of move each one is. It has none of the chat machinery: no
per-character replies, greetings, agents, staging or clock.

### Starting a Freeform story

Under the start form's setup, choose **Freeform** as the **Mode** and answer three
questions:

- **What is this story about?** — a sentence or two. It goes into every prompt.
- **How much should the world resist you?** — **Gentle**, **Even** or **Harsh**.
- **How much should the narrator steer?** — **Follow me** or **Have its own ideas**.

All three are required. The two lists show **Gentle** and **Follow me** before you touch
them but record nothing until the selection changes, so in each pick another option and
then the one you want. Until you do, **Start** says *That is not what this mode asked
for.*

Characters can be added — up to six — and are narrated rather than speaking for
themselves. Every character's card is sent to the narrator, whether or not they are
ticked as in the scene.

The narrator does not open on its own: the story begins with your first move.

### Moves

Above the box, **Do**, **Say**, **Think** and **Story**. The choice stays from turn to
turn (until the page reloads), and each tells the narrator something different:

| Kind | Your words are sent as | The narrator is told |
| --- | --- | --- |
| **Do** | As you wrote them | Your attempt may fail, cost something, or work partly — but it is your attempt. |
| **Say** | *The player's character says: "…"* | Write what your words land on, never what you meant. |
| **Think** | *The player's character thinks: …* | Nobody heard it, and nothing may react to it. |
| **Story** | *The player narrates: …* | Take what you wrote as having happened, and carry on from it. |

### The dials

**How much the world resists you** (**Gentle**, **Even**, **Harsh**) and **How much the
narrator steers** (**Follow me**, **Have its own ideas**) start at your answers and can
be changed at any time. Each change is recorded as a turn, so it follows branches.
Harder means longer and more expensive, never impossible.

The premise and the other answers cannot be changed after the session starts.

The shipped **Freeform** preset sends the narrator's instruction, the treatment's
framing, the premise, your persona and the characters, lore, samples, the story so far
and the last 20 story turns, the goal, guidance, the two dials, and your move with the
instruction for its kind. Temperature 0.85, replies up to 800 tokens.

## The assistant

The **Assistant** button in the header opens the assistant beside any page. It answers
questions about StoryEngine from a built-in help lorebook, and can suggest a change to
the library object you have open, which you apply yourself.

### Starting

The first time, the panel offers **Start a conversation**. That creates a session named
*Assistant*, in the Assistant mode, with the shipped **Assistant** character and the
shipped **StoryEngine help** lorebook. After that the panel opens your most recently
updated Assistant session that is not archived. It is an ordinary session: it appears on
the sessions page under **Assistant**, and everything in
[Playing a session](playing.md) works in it. (Choosing **Assistant** as the **Mode** on
the sessions page makes a bare session without the character or the help book, which the
panel may then open instead.)

While the conversation has nothing on record, **Or start with one of these.** offers
starter questions; one fills the box without sending. Opening the panel over a library
object or a session records what you have open, so there they soon disappear.

To start afresh, open the session panel inside the assistant (*Prompted with …*) and
**Archive this session**; the panel then offers **Start a conversation** again.

### What it can see

The line under the panel's title says what it can see: *It can see: … — the library*
on a library page or editor, *— a session* on a play page, *— a session, as prose* in the
reading view, or *It cannot see any particular object from here.* It is told the
**kind and id** of what you have open — the line shows the id rather than the name — and
never its contents.

Its answers draw on the **StoryEngine help** lorebook: about 25 entries on common
questions, found by keyword in the last few messages. It is a lorebook like any other,
and you can attach it to other sessions. Where it and this guide disagree, trust the
guide: the help book's *What this assistant can and cannot do*, for one, still says it
can read and search your objects, which it cannot.

### Suggested changes

After each answer, a second model call checks whether the answer suggested a concrete
change to the object you have open. If it did, **A change it suggests** shows each field
with **Now** and **Proposed**, and:

- **Apply it** saves the change through the ordinary library save, noting that the
  assistant wrote those fields;
- **No thanks** hides the offer (until the page reloads).

Only fields the object already has as text can be changed, and a later answer that
suggests nothing withdraws the offer. Shipped objects cannot be changed: copy the object
into your library and ask again.

### What it cannot do

It cannot read your objects or turns, search your library, run anything, or change
anything without your **Apply it**. It cannot suggest changes to a session.
