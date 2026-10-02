# Concepts

The ideas the rest of the guide leans on, each in a few paragraphs, with a link to where
it is covered properly.

## One install, several people

A StoryEngine **install** is one server with one data directory. Several people can share
it, each with an **account** of their own: their own library, stories, model choices,
backups and trash, which nobody else on the install can see — administrators included.

**Administrators** also look after the install: its accounts, the model connections
everybody shares, its configuration and its backups. What every account shares is the
**System** library that ships with StoryEngine, and the install's connections.

See [Settings, accounts and the install](settings-and-accounts.md).

## The library

Your **library** is your story material. It holds six kinds of object:

- **Actors** — characters, including the one you play.
- **Lorebooks** — collections of entries that enter the prompt when their keywords come up.
- **Treatments** — how a world is handled: its framing, its lore, its plot hooks. Reusable
  across many stories.
- **Setups** — one particular game: a mode, a treatment, a preset, a persona and lorebooks,
  kept together.
- **Presets** — the recipe for a prompt.
- **Packages** — a bundle of objects that travels as one file.

A treatment is how a world is handled — its lorebooks hold the world itself; a setup is
one playthrough's starting arrangement in it. If you find yourself copying a treatment to
change who is in it, you wanted a setup.

Every object is a folder of files on the server's disk, which you can edit by hand while
the server runs. Every save keeps the version it replaced, so any earlier version can be
restored; deleting moves the object to your trash, from where it can be put back.

See [The library](library.md).

## Sessions, turns and the tree

A **session** is one story. Each **turn** is one step of it: your move, whatever the engine
did to answer it, and the reply. Every turn is recorded in full — what went into the prompt,
which model answered, what changed — and the [workbench](playing.md#the-workbench) shows it.

A session's turns form a **tree**, not a list:

- **Redo** writes another attempt at a turn beside the first. The turn now has versions — *2
  of 3* — and you can step between them.
- **Continue from here**, on an earlier turn, makes that turn the **head** — the one you are
  on — and your next move starts a new **branch** from there.

Nothing is deleted. Every version and every branch you leave is kept, and search finds them.
The play page shows the **line** from the start of the story to the head.

See [Playing a session](playing.md).

## What the story keeps track of

Besides its text, a story has **state**: who is present, alive or dead; which plot hooks have
fired; the current goal; Freeform's dials; Scene's clock and place and trackers; which
switches are on. State belongs to the line of the story: each branch has its own, so a
character can be dead on one branch and alive on another, and going back to an earlier turn
puts the state back as it was. Changing state from a panel is recorded as a turn of its own,
which is why rewinding undoes it.

Some settings belong to the session as a whole instead, and are the same on every branch:
its lorebooks, its prompt pack, a Scene chat's settings, its cast.

## Modes

The **mode** is the kind of story a session is, chosen when it starts:

- **Scene** — a roleplay chat with one character or a group, each speaking in their own
  voice.
- **Freeform** — a narrated story from a premise you write.
- **Assistant** — help with StoryEngine itself, from the button in the header.

See [Modes](modes.md).

## The prompt

On each turn StoryEngine builds the prompt from the session's **preset**: its own
instructions, then slots the engine fills — your persona, the characters, the lorebook
entries that fired, a summary of older events, the recent history, your move. The preset
also decides what to drop when the prompt is too long for the model's window: the least
important blocks go first, oldest history first among them.

Each session plays from its own copy of a preset, so editing the library's preset does not
change a story already under way.

See [Presets and prompts](presets.md).

## Lore and memory

**Lorebook** entries come into the prompt when their keywords appear in the recent
conversation, so a story can know a great deal without sending it all every turn.

StoryEngine remembers in two ways. **Memory books** are lorebooks play writes into — by
**Remember this**, or automatically every few turns — one per character and persona, so a
character can remember an earlier story. The **running summary** condenses turns too old to
send in full.

See [Lorebooks and memory](lorebooks-and-memory.md).

## Connections and jobs

StoryEngine has no model of its own. A **connection** is a model endpoint — a local Ollama or
LM Studio, or any OpenAI-compatible service. Each **job** — *Writing the story*, *Making
images*, … — is bound to a model on a connection: by the install, and by each person for
their own stories. A turn asks for a job, never a model, and whatever is bound to the job
answers.

See [Connections and models](connections-and-models.md).

## Pictures

StoryEngine can draw a turn, keep a backdrop of where a Scene is, and show the model a
picture you attach to a move. Pictures are made in the background and never hold up a turn.

See [Pictures](pictures.md).
