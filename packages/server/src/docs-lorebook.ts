// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { LOREBOOK_SCHEMA, newLoreEntry, type Lorebook, type LoreEntry } from '@storyengine/shared';

/**
 * ***The assistant's docs lorebook*** —
 * [06 §7.4](../../../docs/design/06-modes-and-turn-pipeline.md),
 * [P11.3](../../../docs/design/workplan/28-p11-implementation.md).
 *
 * §7.4: *"Docs retrieval needs no new machinery. Ship the documentation as a
 * built-in lorebook and attach it to the assistant. Keyword activation plus the
 * budgeter already do the work."*
 *
 * ***The machinery shipped at P11.3 and the corpus did not***, which the phase
 * record named as *"the one thing between this assistant and the one §7.4
 * describes"*: the pack positions a `lore` slot, the retriever runs, and no book
 * was attached. **Shipping an empty book to close the row would have been the
 * placeholder shape the phase refused at every stage**, so it was carried as an
 * absence until somebody wrote the entries. This is the entries.
 *
 * ***What is in it is what a person asks, not what a document says.*** The
 * design corpus is reasoning about decisions; an entry here is an answer to a
 * question somebody types at three in the morning — *why does my lorebook entry
 * never fire*, *which model answers*, *what does scan depth count*. The keys are
 * the words they would use, including the wrong ones, because a key that only
 * matches the correct term is a key that only helps somebody who did not need
 * help.
 *
 * ***It is an ordinary lorebook.*** System-owned, so a release replaces it and
 * the editor refuses to write to it — and copyable into your own library like
 * any other shipped object, which is what makes *disagree with it* a thing you
 * can do. Nothing about it is special to the assistant except that the assistant
 * session attaches it.
 *
 * ***Fixed ids and a fixed stamp***, for `materialiseModePresets`' rules: a
 * restart must write the same bytes so the no-op rule holds, and an id that
 * moved would orphan every session that named the book.
 *
 * **Every entry is `constant: false` and keyed.** A constant entry would be in
 * every assistant prompt, which for twenty-six entries is the whole budget
 * spent on documentation nobody asked about — and §7.4's own claim is that
 * *keyword activation plus the budgeter already do the work*.
 */

/** Fixed, so a restart writes the same bytes and the no-op rule holds. */
const STAMP = '2026-01-01T00:00:00.000Z';

export const DOCS_LOREBOOK_ID = '0199c000-0000-7000-8000-00000000d0c5';

/**
 * The shelves — §11.2b's folders, used here for what folders are for: a reader
 * opening this book sees eleven headings rather than twenty-six entries
 * (twenty-five until 2026-10-03, when *make a setup from here* joined them).
 */
const FOLDERS: readonly { id: string; name: string }[] = [
  { id: 'lore', name: 'Lorebooks' },
  { id: 'authoring', name: 'Presets and prompts' },
  { id: 'models', name: 'Models and connections' },
  { id: 'sessions', name: 'Sessions' },
  { id: 'library', name: 'The library' },
  { id: 'import', name: 'Importing' },
  { id: 'memory', name: 'Memory' },
  { id: 'pictures', name: 'Pictures' },
  { id: 'debugging', name: 'When something is wrong' },
  { id: 'deployment', name: 'Running the server' },
  { id: 'assistant', name: 'The assistant' },
];

/**
 * One entry, over the factory's defaults.
 *
 * **`newLoreEntry` rather than a literal**, which is the rule the editor follows
 * for the same reason: an entry written here by hand would drift from the shape
 * a freshly created one has, and the drift would show up as a shipped entry
 * whose disclosures announce non-defaults it has not got.
 */
function entry(row: {
  id: string;
  name: string;
  folderId: string;
  keys: readonly string[];
  description: string;
  content: string;
}): LoreEntry {
  return {
    ...newLoreEntry(row.name),
    id: row.id,
    folderId: row.folderId,
    keys: [...row.keys],
    /**
     * Read by a knowledge-router step to judge relevance, and never injected —
     * so this is a sentence *about* the entry, which is what that reader wants,
     * rather than a shorter version of it.
     */
    description: row.description,
    content: row.content,
    metadata: { createdAt: STAMP, updatedAt: STAMP },
  };
}

const ENTRIES: readonly LoreEntry[] = [
  entry({
    id: '0199c000-0000-7000-8000-000000000001',
    name: 'Why a lorebook entry never fires',
    folderId: 'lore',
    keys: [
      'entry never fires',
      'lorebook not working',
      'entry not firing',
      'lore not showing',
      'keyword not matching',
      'entry never triggers',
    ],
    description:
      'The checklist for an entry that never appears in a prompt. The commonest single cause is scan depth, and the second is a folder gate.',
    content:
      "Work down this list; the first one that is wrong is usually the only one.\n\n1. **Is the entry on?** Its own `enabled`, then its folder's gate, then the book's `enabled`. The editor writes **off**, **off: its folder is off** or **off: the book is off** beside the entry so you do not have to guess which.\n2. **Is the book selected for this session?** No lorebook is active that has not been selected for the session. A book in your library is not in a prompt.\n3. **Do the keys match the text that was scanned?** Matching is against the last `scanDepth` messages, not the whole session — the book's `scanDepth` unless the entry overrides it, and `0` means the whole session. An entry keyed on a word said thirty turns ago in a book that scans two will never fire again.\n4. **Is `selective` on with `secondaryKeys` set?** Then both sets have to agree, under `selectiveLogic`.\n5. **`matchWholeWords`, `caseSensitive`, `useRegex`** — a key of `ash` with whole words on does not match `ashes`.\n6. **Did it fire and get dropped?** That is a budget question, not a matching one, and the workbench's block table says so: a dropped block is listed with the reason.\n7. **`probability`, `cooldown`, `delay`, `sticky`** — these make an entry fire *sometimes on purpose*. An entry that fires one turn in four is doing what it was told.\n\nThe workbench over a turn shows what the lore pass considered and what it did with each candidate, which turns all of the above from a guess into a reading.",
  }),
  entry({
    id: '0199c000-0000-7000-8000-000000000002',
    name: 'Scan depth, and what it is measured in',
    folderId: 'lore',
    keys: ['scan depth', 'scandepth', 'how far back', 'how many messages'],
    description:
      "What scanDepth counts, the difference between the book's and the entry's, and what 0 means.",
    content:
      "`scanDepth` is **how many recent messages the keyword scan reads**, not how many turns and not how many tokens.\n\n- On the **book**, it is the default for every entry in it. `0` means the whole session.\n- On an **entry**, `null` means *inherit the book's*; a number overrides it.\n\nThis is the setting that most often makes an entry that worked in one book go quiet in another, because an entry tuned inside a book that scans eight messages deep can go silent in one that scans two while itself changing in no way. Importing entries between books names the difference for you, and the real answer is to try the keyword against real text.",
  }),
  entry({
    id: '0199c000-0000-7000-8000-000000000003',
    name: 'Order, and why dragging an entry does not change it',
    folderId: 'lore',
    keys: ['entry order', 'reorder entries', 'drag entries', 'injection order', 'order field'],
    description:
      "The difference between the list's reading order and the entry's `order` field, which is injection order.",
    content:
      "Two different orders, and conflating them is the mistake this design refuses.\n\n- **Reading order** is the order of the list — the array in the file. Dragging a row, or the move-up and move-down buttons on it, changes this and nothing else. It is how the book is arranged for a person reading it.\n- **`order`** is **injection order**: where the entry lands among the other entries in the assembled prompt. It is a labelled number in the entry's own form.\n\nSo a drag never changes what the model sees. If you want an entry earlier in the prompt, set `order`; if you want it earlier in the list, drag it.",
  }),
  entry({
    id: '0199c000-0000-7000-8000-000000000004',
    name: 'Token budget, entry limit, and what gets dropped',
    folderId: 'lore',
    keys: ['token budget', 'entry limit', 'too much lore', 'dropped entry', 'budget'],
    description:
      "How a book's tokenBudget and entryLimit interact with the prompt budgeter, and where to see what was dropped.",
    content:
      "A book has two caps and the prompt has a third.\n\n- **`tokenBudget`** — how many tokens this book's activated entries may take. `0` is unlimited.\n- **`entryLimit`** — how many entries may activate at once.\n- And the **preset's own budget** for the lore block, which is what the assembler enforces last.\n\nWhen something has to go, the lowest priority goes first. **The workbench's block table is where you find out**: every block that went into the prompt is listed with its size, and a block that was dropped is listed as dropped with the reason. A prompt that came out shorter than you expected is not a mystery — it is a row in that table.",
  }),
  entry({
    id: '0199c000-0000-7000-8000-000000000005',
    name: 'What a preset is, and what is in one',
    folderId: 'authoring',
    keys: ['preset', 'what is a preset', 'prompt template', 'blocks'],
    description:
      'A preset is the recipe for assembling a prompt: an ordered list of blocks, each with a source and a budget.',
    content:
      "A **preset** is how a prompt gets built. It is an ordered list of **blocks**, and each block says where its text comes from and how much of the budget it may have.\n\nA block's source is a **slot** the engine fills — the cast, the lore, the history, the input, the mode's own instruction — or literal text you wrote. A slot with no budget is not rendered as a prompt block at all.\n\nPresets are ordinary library objects: you can copy one, edit it, and point a session at it. Every mode ships a default preset, and that default is a system object — read-only, so copy it to your own library before editing.\n\nWhat a preset does **not** hold is which model answers. That is the role binding.",
  }),
  entry({
    id: '0199c000-0000-7000-8000-000000000006',
    name: 'Getting a block to come out earlier, or survive a long prompt',
    folderId: 'authoring',
    keys: ['block order', 'block priority', 'prompt order', 'block dropped'],
    description:
      'The two knobs on a block — its position and its budget — and which one to reach for.',
    content:
      "A block has a **position** in the list and a **budget**.\n\n- Position decides where it appears in the assembled prompt.\n- Budget decides how much of it survives when the prompt runs long, and the lowest priority is dropped first.\n\nIf a block is in the wrong place, move it. If it keeps disappearing on long sessions, it is losing a budget argument, and the workbench's block table names what won. Raising its budget takes the room from something else, which is the honest trade rather than a setting that makes prompts free.",
  }),
  entry({
    id: '0199c000-0000-7000-8000-000000000007',
    name: 'Model roles, and which model answers',
    folderId: 'models',
    keys: ['role', 'binding', 'which model', 'model binding', 'prose model', 'bind a model'],
    description:
      'The eight model roles, and the layers a role resolves through to reach a connection and a model id.',
    content:
      "A **role** is a job, not a model: `prose`, `fast`, `reasoning`, `vision`, `image`, `video`, `speech`, `embedding`. A step asks for a role and the server resolves it to a connection and a model id.\n\nResolution takes **the first layer that resolves**, not the first that exists — so a binding naming a connection you cannot use falls through to the next layer rather than failing the turn. Your own bindings sit above the install's defaults, which is what lets you point `summarize` at a cheaper model without a key of your own.\n\n`prose` is the one a story turn needs. If a turn fails with nothing bound, that is the role to look at first. `image` is what renditions need, and it has to be a connection whose provider actually renders images — which is a fact about the endpoint, so you say so on the connection.",
  }),
  entry({
    id: '0199c000-0000-7000-8000-000000000008',
    name: 'Connections, and what a connection is not',
    folderId: 'models',
    keys: ['connection', 'endpoint', 'api key', 'base url', 'provider', 'add a model'],
    description:
      'What a connection holds, the difference between an install connection and your own, and where the capability flags come from.',
    content:
      "A **connection** is an endpoint: a base URL, a provider kind, a credential if it needs one, and the model ids it serves.\n\nThere are two scopes. The **install's** connections are the administrator's and are shared; **your own** are yours and need the private-connections capability. A role binding names a connection and a model id on it.\n\n**Capabilities are declared, not guessed.** Whether the URL behind an OpenAI-compatible connection also answers image requests is a fact about that endpoint, so it is a flag somebody who knows sets on the connection — **Makes pictures**, under *What this endpoint can do*, and beside it **Sends a seed with a picture** for an endpoint that accepts one. Nothing infers either from the provider name.\n\n**Test** on a connection tries it using what is saved: one short message, asked again the way a turn is if the endpoint is busy or unreachable, or one picture, asked once, where it makes them. It costs what any call costs, and it tells a refused key from an unreachable address from a model the endpoint does not serve.",
  }),
  entry({
    id: '0199c000-0000-7000-8000-000000000009',
    name: 'Branching: Redo, Reroll, and what is lost',
    folderId: 'sessions',
    keys: ['branch', 'redo', 'reroll', 'try again', 'alternative', 'regenerate', 'sibling'],
    description:
      'The difference between taking a second turn and branching, and the promise that nothing is lost by branching.',
    content:
      "Taking a turn continues the line. **Redo** branches it: another attempt at *that* turn, from the same parent, with the same words — which is what makes the transcript a tree.\n\n- **Redo** — that turn again. Where draws exist, it rewrites: the mechanical outcomes come off the turn's own tape.\n- **Reroll** — that turn again with fresh draws.\n- **Redo with guidance** — that turn again, plus an out-of-band instruction about what to change.\n\n**Nothing is lost.** The attempt you replaced is still there, and a turn with siblings carries a strip saying *2 of 3* with a way to step between them and to give one a name. The view follows the new sibling, and moving the head back to the old one is a click.",
  }),
  entry({
    id: '0199c000-0000-7000-8000-00000000000a',
    name: 'Rewinding, and what a rewind does to commitments',
    folderId: 'sessions',
    keys: ['rewind', 'go back', 'undo a turn', 'head', 'move the head'],
    description: "What moving a session's head backwards does, and what it does not undo.",
    content:
      'A session has a **head** — the turn you are on. Moving it back is a rewind, and nothing is deleted: the turns after it are still on disk, reachable as a branch.\n\nState that was written by turns after the head is no longer in effect, because state is reconstructed from the line you are on rather than mutated in place. A commitment made on a turn you rewound past is not committed on the line you are now on — and a rewind landing *between* a commitment and its lapse behaves the way reading the line says it should.',
  }),
  entry({
    id: '0199c000-0000-7000-8000-00000000000b',
    name: 'Actors, treatments, setups, presets, packages — which is which',
    folderId: 'library',
    keys: ['treatment', 'setup', 'package', 'what kind', 'object kinds', 'difference between'],
    description:
      "A one-line answer for each of the library's kinds and the split that is easiest to get wrong.",
    content:
      "- **Actor** — a character. A card, importable from and exportable to the formats other tools use.\n- **Lorebook** — a collection of entries that activate on keywords. The unit other tools trade.\n- **Treatment** — the *world and the story*: what this fiction is, independent of any one playthrough.\n- **Setup** — the *particular game*: this cast, in this situation, of that treatment.\n- **Preset** — the recipe for assembling a prompt.\n- **Package** — a mode's own bundle of what it needs.\n\n**The Treatment/Setup split is the one with no prior anywhere else**, and it is the one worth learning: a treatment is reusable across playthroughs and a setup is one of them. If you find yourself copying a treatment to change who is in it, you wanted a setup.",
  }),
  entry({
    id: '0199c000-0000-7000-8000-00000000000c',
    name: 'Importing from other tools',
    folderId: 'import',
    keys: [
      'import',
      'character card',
      'png card',
      'sillytavern',
      'world info',
      'chub',
      'import a card',
      'import chats',
      'chat history',
    ],
    description:
      'What can be imported, how — chats included, as sessions — and what the import reports back.',
    content:
      "Character cards (v2 and v3, PNG or JSON), world-info books, and presets convert on the way in. Drop a file on the library's import panel, or point the sweep at a folder.\n\n**Chats from SillyTavern or Marinara become sessions.** A folder picked in the browser that holds chats stops and asks first, saying how many and how large, with **Also import the chats** unticked, because chats are most of a folder's size; a folder swept from the server brings its chats with it. A single `.jsonl` loads from the sessions page. Each chat arrives as a new session in Play whose cast is the matching characters in your library. Updating a session from its source comes later: until then, importing the same chat again the same way changes nothing, and the review says so when the chat has grown since.\n\nWhat lands is reported per object: what it was, what it became, and anything the converter had to decide. **A file is a fact about the world rather than a malformed request**, so a file the reader does not recognise is reported rather than refused.\n\nRe-importing the same file is recognised as the same object rather than doubling it, and what a re-import does on a conflict — replace, or keep both — is a question the panel asks rather than a default it applies silently.",
  }),
  entry({
    id: '0199c000-0000-7000-8000-00000000000d',
    name: 'Moving entries between books',
    folderId: 'lore',
    keys: ['move entries', 'copy entry', 'entry export', 'import entries', 'cherry pick'],
    description:
      'Selecting entries, exporting a selection, and importing entries into an open book.',
    content:
      "The entry list has a **Select several** mode. With entries ticked, **Export selected** writes a file; **Import entries…** reads one into the book you have open.\n\n**An entry export is a lorebook.** There is no fragment format — the file opens in anything that reads a lorebook, and the way in is the way in for any book you downloaded, so cherry-picking four entries out of a two-hundred-entry book does not mean the book arriving in your library to be cleaned up afterwards.\n\nA selection brings the folders above it and not the rest. A merge **adds and never overwrites**: an entry whose id is already here takes a fresh one, and the collision is reported rather than resolved for you, because two books hold an entry under one id precisely when one was copied from the other. Nothing is written until you save, and the book's history records the import.",
  }),
  entry({
    id: '0199c000-0000-7000-8000-00000000000e',
    name: 'What the assistant remembers between sessions',
    folderId: 'memory',
    keys: ['memory', 'remember', 'summary', 'rolling summary', 'memory book', 'cross-session'],
    description:
      'The three things that carry a story forward: the rolling summary, memory books, and manual capture.',
    content:
      'Three different mechanisms, deliberately.\n\n- **The rolling summary** is a chain: each summary is derived from the one before it plus the turns since, so it is reproducible from the line you are on rather than accumulated in place.\n- **Memory books** are lorebooks a session writes into, so what happened in one story can be retrieved in another. They are ordinary lorebooks — you can read, edit and export them.\n- **Remember this** is manual capture: you pick the moment, and what is written is an entry you can then edit.\n\nThe book carries a history entry naming the session an extraction came from, so *which story wrote this* is answerable later.',
  }),
  entry({
    id: '0199c000-0000-7000-8000-00000000000f',
    name: 'Pictures: backdrops, illustrations, and what they cost',
    folderId: 'pictures',
    keys: ['image', 'picture', 'backdrop', 'illustration', 'render', 'generate image', 'rendition'],
    description:
      'How a picture gets made, what the illustrate channel controls, and why a turn never waits for one.',
    content:
      'A picture is a **rendition**, and it is a job of its own: the turn completes on text with the picture still pending, and the session stays usable while it resolves. **A failed rendition is a placeholder with a retry, never a failed turn.**\n\n`se.illustrate` is the control: **off**, **on-demand**, or **each-turn**. A **backdrop** is a picture of the place, made from what the session knows about where it is — and a place you have already rendered comes back to the backdrop you chose rather than being paid for twice.\n\nThe recipe outlives the pixels: re-creating a picture does not re-ask the text model. It needs the `image` role bound to a connection that actually renders images.',
  }),
  entry({
    id: '0199c000-0000-7000-8000-000000000010',
    name: 'The workbench: seeing what was sent',
    folderId: 'debugging',
    keys: ['workbench', 'what was sent', 'prompt inspector', 'debug a turn', 'why did it say'],
    description: 'What the workbench shows over a turn, and which question each section answers.',
    content:
      "Open the workbench over a turn and it shows the turn's own record.\n\n- **The block table** — every block that went into the prompt, its size, and every block that was dropped with the reason. This is where *why was the prompt short* and *why did my lore not appear* are answered.\n- **The budget verdict** — what the cap was and where it came from.\n- **The step list** — which steps ran, which were skipped, and why.\n- **The model** — which connection and model id the role actually resolved to.\n- **Cost** — what the turn used.\n- **Renditions** — what was made of the turn, and what it was made from.\n\nTwo siblings of one turn that differ only in their seed is the sharpest shape for *why did this one come out different*.",
  }),
  entry({
    id: '0199c000-0000-7000-8000-000000000011',
    name: 'Deleting things, and getting them back',
    folderId: 'library',
    keys: ['delete', 'trash', 'restore', 'undo delete', 'recover', 'deleted'],
    description: 'Deletion is a move to trash with a retention window, and history survives it.',
    content:
      "**Deleting is a move, not an erasure.** A deleted object goes to your trash with its history intact and is restorable from the settings page for the retention window — 30 days unless the install changed it. After that a sweep removes it.\n\nEditing is separately recoverable: every save snapshots the state it replaced, so the version before any edit is in the object's own history and one restore away. That is also what makes a bad import one restore rather than twelve deletions.",
  }),
  entry({
    id: '0199c000-0000-7000-8000-000000000012',
    name: 'Taking a session somewhere else',
    folderId: 'sessions',
    keys: [
      'export session',
      'import session',
      'share a session',
      'session file',
      'move a session',
      'jsonl',
      'load a chat',
      'chat file',
    ],
    description:
      'Exporting a session to a file, loading one on another install, and loading a chat from SillyTavern or Marinara.',
    content:
      "**Export this session** on the session panel writes a file with **every branch**, not only the line you are on.\n\nLoading one back is **Load a session or a chat** on the sessions page. It arrives as a **new session** with a new id, keeping the turn ids it came with and recording where it came from — so an export and its original can sit side by side without either pretending to be the other.\n\nThe same button takes a `.jsonl` chat from SillyTavern or Marinara: it arrives as a new session, with its characters found in your library. Updating a session from its source comes later; until then, loading the same chat again changes nothing, and a chat already imported with its folder arrives as a second session.\n\nAn export loads here rather than in the library's import panel because a session is not a library object: it does not merge into a shelf, and what it produces is a session. A folder's chats can also come in with the folder, through the library's import panel.",
  }),
  entry({
    id: '0199c000-0000-7000-8000-000000000013',
    name: 'Backing the whole install up',
    folderId: 'deployment',
    keys: [
      'backup',
      'restore from backup',
      'restore a backup',
      'archive',
      'move to a new machine',
      'migrate',
    ],
    description:
      'What a backup contains, what it deliberately leaves out, and what a restore has to do.',
    content:
      'The data directory is the whole install: library, sessions, accounts and config. A backup is an archive of it.\n\n**The search index is not in the archive**, deliberately: it is derived, and a restored index would be a stale copy of something the server can rebuild exactly. So a restore lands the files and the server rebuilds the index on the next start, which is what makes it a restore rather than a copy.',
  }),
  entry({
    id: '0199c000-0000-7000-8000-000000000014',
    name: 'Settings, and which ones need a restart',
    folderId: 'deployment',
    keys: ['config', 'settings', 'restart', 'config.json', 'environment variable'],
    description:
      'Where settings live, the three reload tiers, and how the environment interacts with the file.',
    content:
      'Settings live in `config.json` in the data directory, and the settings page writes the same file — hand-editing it is supported, which is why writes are checked against what was last read.\n\nEach key has a **reload tier**: **live** takes effect at once, **reconnect** takes effect on the next connection, and **restart** needs one. The settings page says which is which rather than leaving you to find out.\n\n`SE_*` environment variables override the file for the keys that have them — which is how the container is configured, and why the deploy page lists them.',
  }),
  entry({
    id: '0199c000-0000-7000-8000-000000000015',
    name: 'Reading a session as prose',
    folderId: 'sessions',
    keys: ['read', 'reading view', 'print', 'export prose', 'copy the story'],
    description: 'The reading view, what it strips, and what it is for.',
    content:
      "The reading view renders a session's selected line as prose: attribution, no machinery, and a print stylesheet that produces something worth printing.\n\nIt is deliberately not the workbench. The reading directory refuses to import the turn-inspection machinery at all, so a change that made the reading view leak the assembler's vocabulary would be a build error rather than a design drift.",
  }),
  entry({
    id: '0199c000-0000-7000-8000-000000000016',
    name: 'Finding things',
    folderId: 'library',
    keys: ['search', 'find', 'full text', 'look up'],
    description: 'What search covers and what it does not.',
    content:
      "Search runs over the library's objects and over session prose. A lorebook's own page searches the prose of its entries and links back into the editor at the entry it found; the entry list's box searches names only, which is why it says so.\n\nSearch is served from an index the server maintains. The index is derived: it can always be rebuilt from the files, and after a restore it is.",
  }),
  entry({
    id: '0199c000-0000-7000-8000-000000000017',
    name: 'Writing a line for a character',
    folderId: 'sessions',
    keys: ['impersonate', 'write for', 'speak as', 'put words'],
    description: "Taking a turn in a character's voice rather than your own.",
    content:
      'Impersonation is taking a turn **as somebody else in the cast** — you write the line a character says rather than what you do. It goes through the ordinary turn path, so it is in the transcript, in the record, and branchable like any other turn.',
  }),
  entry({
    id: '0199c000-0000-7000-8000-000000000018',
    name: 'What this assistant can and cannot do',
    folderId: 'assistant',
    keys: ['what can you do', 'assistant', 'help', 'tools', 'can you edit'],
    description:
      "The assistant's own scope: domain operations over your library, proposals rather than silent writes, and no shell.",
    content:
      'I work over **your** library, with your permissions, and everything I can do is a library operation.\n\n- I can read and search your objects, explain what went into a turn, and diagnose a preset or a lorebook that never fires.\n- I can **propose** a change as a diff. I do not write silently, and a change you apply is marked as machine-written so *the assistant wrote this bit* stays answerable later.\n- I have **no shell and no filesystem tools**. That is deliberate: on a server other people can reach, an in-app assistant with shell access is a privilege-escalation path wearing a friendly hat.\n\nI also know what you have open — the actor, the session — and that context is a block in my own turn record, visible like any other, rather than something I know quietly.',
  }),
  entry({
    id: '0199c000-0000-7000-8000-000000000019',
    name: 'When a turn fails',
    folderId: 'debugging',
    keys: [
      'turn failed',
      'error',
      'no binding',
      'refused',
      'provider error',
      'timeout',
      'rate limit',
    ],
    description: 'How to read a failed turn, and the four commonest causes.',
    content:
      'A failed turn is a turn: it commits, it is in the transcript, and it says why. The workbench over it carries the step that failed and what the provider said.\n\nThe common ones, in the order they are worth checking:\n\n1. **Nothing bound** — the role the step asked for resolved to nothing usable. `prose` is the one a story turn needs.\n2. **The endpoint is unreachable** — wrong base URL, or the server is not running.\n3. **The credential is wrong or missing** — for an endpoint that wants one.\n4. **The model id is not one that endpoint serves** — the connection lists them; a typo is a 404 from the provider.\n\nItems 2 to 4 can be checked without taking another turn: **Test** on the connection says which of them it is.\n\nA turn that failed before assembly ever ran says so with *this turn made no request*, which is a different fault from one that asked and was refused.',
  }),
  /**
   * ***Make a setup from here*** — [P15](../../../docs/design/workplan/33-p15-setup-from-a-turn.md),
   * added 2026-10-03 at its merge. In the *sessions* folder rather than the
   * library's, because the question arrives from inside a story — *can I start
   * again from this point* — and the setup is the answer rather than the
   * subject. Keyed on the words somebody uses before they know the feature's
   * name, and never on `setup` alone, which the kinds entry above already owns.
   */
  entry({
    id: '0199c000-0000-7000-8000-00000000001a',
    name: 'Starting again from a point in a story',
    folderId: 'sessions',
    keys: [
      'make a setup',
      'setup from here',
      'start from here again',
      'save this point',
      'story so far',
      'start from a setup',
      'setup opening',
    ],
    description:
      'Making a setup from any turn of a session, what it carries and hides, and how a session started from a setup begins.',
    content:
      "**Make a setup from here**, on any turn beside *Continue from here*, saves that point as a **setup** in your library: somewhere new sessions start, again and again, without the turns that led there. *Continue from here* keeps the history; this condenses it away.\n\nA dialog drafts **the story so far**, an **opening**, a **name and blurb**, and the **facts** the story established — each its own call on the writing model, each editable and regenerable on its own. Kept facts become a lorebook linked from the setup. The party, the current goal and the plot hooks carry too, each with a switch to leave it out.\n\n**Nothing it would spoil is shown.** Hooks that have not happened are counted, not described, and a goal hidden from you says only that it is hidden. They are carried all the same, and hooks already used are marked so they do not happen twice.\n\nA session started from the setup — on the sessions page, or **Start a session** on the setup's own page — shows the model the story so far from its first turn, as the oldest part of its running summary, which needs a preset with a summary slot. **A setup's own opening is always its first turn**: in a chat whose characters would greet you, their greetings are not used when the setup has an opening of its own, even if you start it cold. A setup with no opening begins on the greetings instead. An opening was written, not generated, so it cannot be redone.",
  }),
];

export const DOCS_LOREBOOK: Lorebook = {
  schema: LOREBOOK_SCHEMA,
  id: DOCS_LOREBOOK_ID,
  name: 'StoryEngine help',
  description:
    'How this build works, in entries the assistant retrieves by keyword. Shipped with the app and replaced by each release — copy it into your own library to change it.',
  /**
   * **`global`, and it means nothing here.** Nothing reads `scope`: a lorebook
   * reaches a session by being selected for it and by nothing else, which is
   * exactly why this book is not in every prompt despite saying `global`.
   */
  scope: { kind: 'global' },
  enabled: true,
  /**
   * ***Four rather than the factory's two***, which is the one activation
   * setting this book tunes and the reason is the shape of the conversation it
   * is for. Somebody asks a question, reads an answer, then asks a follow-up
   * that names none of the original words — *and what about the folder?* Two
   * messages of scan depth loses the subject at exactly that point.
   */
  scanDepth: 4,
  /**
   * **Enough for three or four entries and not the whole book.** The budgeter
   * drops the lowest priority first, so this is a ceiling on how much of a
   * prompt documentation may take before the conversation itself starts losing
   * room — which is the failure §7.4's *"keyword activation plus the budgeter
   * already do the work"* depends on not happening.
   */
  tokenBudget: 2400,
  entryLimit: 4,
  /**
   * **Off, deliberately.** Recursive scanning lets one entry's text activate
   * another, and these entries mention each other constantly — *the workbench*,
   * *the block table*, *the budget* — so a single question would pull in half
   * the book. The cross-references are for a person reading, not for the
   * matcher.
   */
  recursiveScanning: false,
  maxRecursionDepth: 3,
  folders: FOLDERS.map((folder, at) => ({
    ...folder,
    parentFolderId: null,
    enabled: true,
    order: at,
  })),
  entries: [...ENTRIES],
  tags: [],
  media: [],
  primaryMediaId: null,
  assets: [],
  /**
   * **Stamped, not blank.** `blankProvenance` calls `now()`, which would make
   * every restart write different bytes and turn the no-op rule into a write
   * every boot — the same rule the assistant card's fixed `STAMP` exists for.
   */
  provenance: {
    source: 'manual',
    creator: 'StoryEngine',
    version: null,
    license: null,
    originalFilename: null,
    createdAt: STAMP,
    updatedAt: STAMP,
  },
  generated: null,
  metadata: { createdAt: STAMP, updatedAt: STAMP },
};
