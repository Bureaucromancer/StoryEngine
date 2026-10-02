# Presets and prompts

A **preset** — the session panel calls it a **prompt pack** — is the recipe for the
prompt a model receives on each turn. It is an ordered list of **blocks**:

- a **text block** is words you wrote, such as the narrator's instructions;
- a **slot** is a place the engine fills: the history, the lore, the characters, your
  move.

A preset also holds the budget rules — how much of the model's window the prompt may
use, and how much is kept for the reply — and generation settings such as temperature.
Each mode ships one. A session started here plays from **its own copy** of a preset; one
imported from another application's chat has none, and plays from its mode's preset as
shipped (see [A session's own copy](#a-sessions-own-copy)).

## The shipped presets

| Preset | Blocks | Temperature | Replies up to |
| --- | --- | --- | --- |
| **Scene** | 25 | 0.85 | 800 tokens |
| **Freeform** | 27 | 0.85 | 800 tokens |
| **Assistant** | 9 | 0.4 | 900 tokens |

They are **System** objects: read-only for everyone, and rewritten whenever a new build
changes them. To change one, open it in the library and **Copy to my library**; your
copy is yours, and later releases do not touch it. Rename your copy: it keeps the shipped
name, and the lists show the shipped one and yours under the same name. [Modes](modes.md) describes what
Scene's and Freeform's presets send.

**New preset**, on the library page, starts from a copy of the **Assistant** preset — not
Scene's. To build on Scene or Freeform, copy that one instead.

## A session's own copy

When a session starts, it copies the preset chosen under **Preset** in the start form —
or the mode's own — and plays from the copy from then on. Editing the library preset
later does not change a story in progress.

The session panel (*Prompted with …*) works on that copy:

- **Prompt pack** — **Keep the one this session has**, **Switch to the mode's own**, or
  **Switch to** a preset from your library. Switching takes a fresh copy and discards any
  edits made to the old one. Turns already taken keep the blocks they were built from,
  and rewinding past a switch does not switch back. Every preset is offered, other modes'
  included, without a warning: a Scene switched to Freeform's pack loses Scene's time,
  place and secret-plot blocks.
- **Temperature** and **Maximum reply length** — the session copy's own settings, so they
  start at the preset's (0.85 and 800 tokens in Scene). Blank removes the setting and
  leaves it to the provider. These apply to **every** model call made for the session,
  not just the story's replies: summaries, trackers, judges, suggestions and the picture
  prompt use them too — except the **Smart** choice of who replies, which always asks at
  a temperature of 0.2. The reply length is also what is held back from the window for
  the reply; with none, the preset's reserve (1024 tokens in the shipped presets) is held
  back instead.
- **Editing one block's text.** In the [workbench](playing.md#the-workbench), over a
  finished turn, a block from the preset has **Edit in the pack**. It opens the session
  panel on that block — *Block: …* — with **Save this block**. The change applies from
  the next turn; **Redo** the turn to see the difference. Only text blocks have words to
  edit.

A session imported from a SillyTavern or Marinara chat, or an Aventuras story, has no copy
of its own: the panel says it *has no pack of its own and is assembled from whatever its
mode ships*, and shows neither **Temperature** nor **Maximum reply length**, and **Edit in
the pack** has nothing to edit. Pick a preset under **Prompt pack** to give it a copy.

Sessions on the mode's own preset also pick up **blocks added** to that preset by later
releases. Changed wording in blocks they already have does not reach them, and sessions
on a library or imported preset get nothing; **Switch to the mode's own** brings a
session fully up to date, at the cost of its edits.

## Editing a preset

**Edit**, on a preset of yours, opens the preset editor:

- **Name**.
- **Blocks**, in order. Each shows its label, or its id, and whether it is `text` or a
  `slot`. **↑** and **↓** reorder, and **Remove** removes (nothing is written until you
  save).
  - A text block has its **Template**, with **Assist**.
  - A slot says what it positions — *Positions history.* — and has an **Outlet**: the name
    lorebook entries use to land in this slot specifically. Only a lore slot reads it, and
    a lore slot given an outlet takes **only** that outlet's entries — set it on a copy's
    main lore slot and ordinary lore stops landing anywhere (see
    [Lorebooks and memory](lorebooks-and-memory.md#where-an-entry-lands)).
- **Blurb**, **Modes**, **Tags** and **Tag ids**.
- **Budget**, **Params** and the level lists, shown as stored.

The editor cannot add a block, rename one, or change a block's role, whether it is
enabled, its priority, its placement, which calls it applies to, or a slot's wrapper;
the budget and the generation settings are read-only too. As settings, these are shown
only on the preset's page in the library and under **As stored** (the workbench shows how
one turn used them), and a disabled block looks like any other in the editor. To change them, edit the preset's `preset.json` by
hand — the library notices the change while the server runs.

## How a prompt is put together

### Order

Blocks go in list order. A block placed **in the history** is spliced in at a depth,
counted in messages back from the last reply (a past turn is usually two messages, your
move and the reply — an opening is one, and a reply in several voices is one per voice). Neighbouring blocks with the same role are merged into one message.

A block can apply only to some calls: to the story's replies (`narrate`) or to **Draft my
next message** (`impersonate`); to one kind of move, such as Freeform's **Say**; or to
one voice — the narrator, or characters speaking for themselves.

Only the story's replies and **Draft my next message** are built from the preset's
blocks. The background calls — summaries, judges, trackers, suggestions, the picture
prompt — bring prompts of their own.

### What the slots hold

| Slot | Holds |
| --- | --- |
| Persona | Your persona's character sections. |
| Actor | One section of each character's profile — the summary, looks, voice, traits — one block per character, the one speaking first. Muted characters are left out. |
| Lore | The lorebook entries that fired, before or after the characters, or for one outlet. |
| History | The past turns in the window — the last 20 story turns in Scene and Freeform, 40 for the assistant — your moves as user messages and the replies as the model's. |
| Writing samples | Writing samples from the treatment, the lorebooks and the characters. |
| Channel | Something the story keeps track of, such as Scene's time and place, the secret plot, or what the assistant can see. |
| Trackers | What Scene's trackers have established. |
| Treatment | The treatment's framing. |
| Setup answer | An answer from the mode's start questions — Freeform's premise. |
| Goal | The current objective. |
| Difficulty, directedness | The text for the level each of Freeform's dials is at. |
| Guidance | **Guidance for this turn**, a fired plot hook's words, and **Push the story**. |
| Previous attempt | On **Redo with guidance**, the reply being redone. |
| Input | Your move, with its pictures. It is never dropped. |
| Summary | The summary of turns older than the history, in stretches. |

Some things are added by the engine wherever a preset puts its blocks: replies already
given earlier in the same round, a chat's author's note, the instruction for
**Continue**, and the instruction to answer in a particular shape for calls that need
one.

### The budget

1. **The window** is the connection's context window, or `limits.contextTokens` (8192)
   when the connection does not say. A preset can set a lower ceiling.
2. **The preset's share** of it — 75% in every shipped preset.
3. **Less room for the reply**: the session's **Maximum reply length** — which starts at
   the preset's own, 800 tokens in Scene — or, when that is blank, the preset's reserve
   (1024 tokens in every shipped preset).

With the defaults and the Scene preset that is 8192 × 0.75 − 800 = **5,344 tokens** of
prompt. Tokens are estimated as one per four characters.

When the prompt does not fit, blocks are dropped **lowest priority first**, and among
equals the later in the list first. Your move is never dropped. History is ranked oldest
lowest, so the oldest turns go first; lore that is always on outlasts lore that merely
matched. If the window cannot hold anything beside the reply, the turn is refused with
*The model's context window is too small to hold anything beside its reply* — see
[Connections and models](connections-and-models.md#context-window-and-reply-length).

### System blocks after the history

Only the system blocks at the very start of a prompt become the request's system prompt.
A system block that comes after the conversation has started is sent **where it
stands, as user text** — joined to the user message beside it, or as a user message of
its own. That is how Scene's goal and guidance reach the model, just before your move.
The workbench still lists such blocks as system.

## Templates

Text blocks, and the words a slot's wrapper puts around its content, are
[Liquid](https://liquidjs.com/) templates. They can use:

| Variable | Is |
| --- | --- |
| `char` | The character speaking, or the first in the cast; *the character* when there is no cast. |
| `user` | Your persona's name, or *the player*. |
| `group` | Every character in the cast, comma-separated. |
| `charIfNotGroup` | `char` in a cast of one, otherwise `group`. |
| `notChar` | Everyone but the speaker, your persona first; on a call that speaks for nobody — a narrated reply, **Draft my next message** — your persona alone. |
| `dispatch` | `per-actor` or `merged`. |

Liquid's own tags and filters work; unknown variables render as nothing. A slot's wrapper
marks the slot's content with exactly `{{content}}`, without spaces. A template that
cannot be rendered — a syntax error, or one that runs too long — is sent as its own text,
braces and all, so literal `{{` from one of the preset's own blocks, in the messages the
workbench shows, means that template failed. Character cards, lore and history are never
treated as templates, so braces in them go out as written — an imported card keeps its
`{{user}}`.

## Generation settings

A preset stores temperature, top-p, top-k, top-a, min-p, frequency, presence and
repetition penalties, a seed, the number of replies, maximum tokens and stop sequences.
Only **temperature, top-p, frequency and presence penalty, maximum tokens, stop sequences
and a seed of zero or more** are sent to an endpoint; the rest are kept and not used.
The only ones with controls in the app are **Temperature** and **Maximum reply length**,
per session.

## Seeing what was sent

- **While you type**, the context meter above the composer measures the turn you are
  about to send, and the workbench shows it under *What happens next*: the blocks, the
  budget, what came back empty and why. It is the real assembly, with a few differences:
  lore is drawn fresh each time, only the first speaker's call in a round is shown, and a
  guided redo, a fired hook or a push are not included.
- **For a finished turn**, the workbench shows each call's blocks with where each came
  from and what the budget did with it, the settings the call asked for (some are never
  sent — see [Generation settings](#generation-settings)), and the messages as assembled,
  each marked with the blocks it was made from; system text after the history is shown
  as system, though it went as user text.

**Collected nothing** lists the preset's blocks — text as well as slots — that produced
nothing, with why: *switched off in the preset*, *not for this kind of call*, *nothing
produces this yet*, *its source had nothing to give*.

## Imported presets

**SillyTavern chat-completion presets** become presets of yours:

- The prompt order SillyTavern uses is kept (character-specific orders are dropped, with
  a note). Each prompt becomes a block with its name, role and on/off state; prompts the
  preset held but did not use come in switched off.
- SillyTavern's markers become slots: chat history → history, world info before and
  after → lore, character description → the character's summary, personality → traits,
  persona description → persona, dialogue examples → writing samples, scenario → the
  treatment's framing.
- In-chat (absolute) prompts are placed in the history at their depth.
- The impersonation prompt applies to **Draft my next message**. The continue, group
  nudge, new chat and example prompts are kept but never used.
- Macros: `{{char}}`, `{{user}}`, `{{charIfNotGroup}}`, `{{group}}` and `{{notChar}}`
  become template variables. Macros that pull content in — `{{description}}`,
  `{{persona}}` and the like — are removed, because slots do that job; dice, time and
  other macros are removed too, and unknown ones are left as written. The import review
  lists each.
- Sampler settings come across, and the review says which of them reach the model. The
  maximum context becomes the preset's ceiling. Model choices are kept but not used, and
  any keys or addresses in the file are removed.

**SillyTavern system prompts** become a preset of a system prompt, the history, and the
post-history instructions. **Text-completion presets** carry their sampler settings, and
their context size where the file makes it clear, which becomes the preset's ceiling.
Instruct, context and reasoning templates are recognised but not converted.

**Marinara presets** become blocks in their sections, wrapped as Marinara wraps them, with
their markers as slots and their sampler settings. Aventuras prompt packs are not
imported.

Three things to know about imported presets:

- **Every block arrives at the same priority**, so when a long story fills the window,
  the main prompt and character blocks are dropped before most of the history. A larger
  context window on the connection helps, up to the preset's own ceiling, which an
  imported SillyTavern preset takes from its maximum context: raise
  `budget.maxContextTokens` in the preset's file too, or set it to `null`.
- **Blocks imported switched off** cannot be switched on in the app; set `"enabled": true`
  in the preset's file.
- **Known problem: an imported SillyTavern or Marinara preset has no slot for your current
  move**, and a session playing from one does not send the model your latest message.
  Until this is fixed, add the slot by hand: in the preset's `preset.json`, after the
  history block, add

  ```json
  {
    "id": "se.input",
    "label": "input",
    "role": "user",
    "enabled": true,
    "placement": { "at": "sequence" },
    "priority": 100,
    "appliesTo": [],
    "advisory": false,
    "omitWhenEmpty": true,
    "kind": "slot",
    "source": { "of": "input" }
  }
  ```

  then switch the session to the edited preset. One difference from SillyTavern remains:
  an imported prompt placed in the chat at depth 0 lands just before your move here,
  where SillyTavern puts it after.
