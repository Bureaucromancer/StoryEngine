// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import type { ImportNote } from '@storyengine/shared';

import type {
  ChatMessage,
  ChatSettings,
  ChatSourceChat,
  ChatSwipe,
  ForeignRef,
} from '../chat/types.js';
import { parsed, refused, type ParseOutcome } from '../parse.js';

/**
 * ***One SillyTavern chat file, read*** —
 * [P13.7](../../../../../docs/design/workplan/30-p13-scene-and-session-import.md):
 * the bytes of one `.jsonl` in, the tree builder's {@link ChatSourceChat} out,
 * with what the file's header says about the chat and what the person should
 * be told.
 *
 * **Pure, and a status rather than a throw.** No I/O, no clock, no library: the
 * bytes and the file's path arrive, values leave. `parse.ts` gives the reason
 * for the second half, and a chat file is where it bites hardest — a sweep reads
 * hundreds of these, each written a line at a time by a browser that could be
 * closed mid-write. So *one poisoned line never costs the file*: it is skipped
 * with a note naming its line, which is what SillyTavern itself does with it
 * (`getChatData`, `endpoints/chats.js:502`, filters every line `JSON.parse`
 * refuses). Only a file with nothing in it to read is refused.
 *
 * ***Two sources, one format*** — [P13 §0.4]. Marinara's per-chat export
 * (`chats.routes.ts:3596`) writes this same JSONL with a few extras of its own —
 * `extra.marinara_role`, `extra.marinara_character_id`, `extra.marinara_swipes`
 * and `chat_metadata.marinara_metadata` — and the one place it and SillyTavern
 * disagree is load-bearing: **Marinara writes `is_system` for its `system`
 * role**, where SillyTavern's `is_system` means *hidden from the prompt*
 * ([P13 §0.5]). A line carrying Marinara's role is therefore read by Marinara's
 * meaning of every flag, and a line without one by SillyTavern's. Reading
 * Marinara's system lines as hidden would silently drop every scene-setting
 * line from the prompt of every Marinara chat; reading SillyTavern's hidden
 * lines as narration would put every `/hide` back in.
 *
 * ***What this module does not decide***, each because it needs more than one
 * file to decide it:
 * - **families** — `main_chat` names a chat by the name SillyTavern gave it,
 *   and which file that is, and whether it is here, is a question about the
 *   folder ([P13.9]); so {@link SillyTavernChatMeta.mainChat} is the raw name;
 * - **resolution** — which library object a speaker key or a lorebook name is
 *   ([P13.8]); so speakers are {@link ForeignRef}s in the source's own terms;
 * - **group settings** — activation strategy, self-responses and muted members
 *   live in `groups/<id>.json`, not in the chat ([P13.9]).
 */

/**
 * ***What a chat file's header says about the chat***, beside its messages.
 * Every member is what the file said, raw, or absent when it said nothing
 * usable — the parser does not guess, because every consumer of these is a
 * later stage with more of the folder in view than one file gives.
 *
 * - **`source`**: `marinara` when the file is Marinara's export — a header
 *   carrying `marinara_metadata`, or any line carrying Marinara's role — and
 *   `sillytavern` otherwise. It says how to read the speaker keys: a Marinara
 *   character is keyed by its id, a SillyTavern one by its card file.
 * - **`group`**: the file is a group chat. Known from where it lives
 *   (`group chats/<id>.jsonl`, `endpoints/chats.js:803`), or — ***only for a
 *   file that arrived without its place***, a bare upload — from the one shape
 *   only a group file has: **no header**. `saveChat` has written a header on
 *   every single chat since single chats existed; group chats written before
 *   `chat_metadata` reached groups did not, which is why `getGroupChat` strips
 *   line 0 only when it carries one (`group-chats.js:268`). *Where the file
 *   lives wins over its shape*: under `chats/<folder>/` a missing header is a
 *   corrupted one, since `getChat` shifts line 0 off every single chat
 *   unconditionally (`script.js:7597`), and reading the file as a group there
 *   would batch its greeting as a group's.
 * - **`mainChat`**: `chat_metadata.main_chat` — the name, without extension, of
 *   the chat this one was branched or checkpointed from (`bookmarks.js:199`,
 *   `:281`). *A name, not an id*: turning it into a chat of the family is
 *   [P13.9]'s, which has the folder to look in.
 * - **`integrity`**: `chat_metadata.integrity`. **It names a family, not a
 *   chat** ([P13 §0.2]): a branch inherits its parent's.
 * - **`persona`**: `chat_metadata.persona`, the persona locked to the chat, as
 *   the same key a player's line carries (`User Avatars/<file>`), so the
 *   resolver reads one vocabulary for both.
 * - **`worldInfo`**: `chat_metadata.world_info`, the chat's own lorebook by name
 *   (`world-info.js:94`), for [P13 §2.5]'s `worlds/<name>.json`.
 * - **`note`**: the author's note ([P13 §2.6]), in the session's own shape.
 * - **`marinara`**: `chat_metadata.marinara_metadata` as written, for [P13.10],
 *   which maps Marinara's chat settings for the profile path and should map
 *   them once. *Carried rather than read here* because reading them twice is
 *   two opinions about Marinara, and the profile is the path with the tables to
 *   check the answers against.
 */
export interface SillyTavernChatMeta {
  source: 'sillytavern' | 'marinara';
  group: boolean;
  mainChat?: string;
  integrity?: string;
  persona?: string;
  worldInfo?: string;
  note?: NonNullable<ChatSettings['note']>;
  marinara?: Readonly<Record<string, unknown>>;
}

/**
 * One chat file, read: the chat as the builder takes it, what its header said,
 * and everything worth telling the person — `ImportNote`s under
 * `import.chat.*`, each carrying the chat's name, because a family's notes are
 * read together and "line 7" means nothing without "of which chat".
 */
export interface SillyTavernChat {
  chat: ChatSourceChat;
  meta: SillyTavernChatMeta;
  notes: ImportNote[];
}

/**
 * ***The key of a speaker the file names only by name*** — `name:<display
 * name>`.
 *
 * A character line normally says who spoke by card file (`original_avatar`, a
 * character thumbnail), and a single chat says it by folder. Some lines say
 * neither: `/sendas` to a name with no card (`slash-commands.js:5801`, which
 * then records ST's placeholder image rather than a card), or a chat uploaded
 * on its own with no folder around it. Dropping the speaker would print their
 * lines as narration; guessing a card from the name would be a guess. So the
 * key says what is known, and **it cannot collide with a card**: SillyTavern
 * passes every avatar file name through `sanitize-filename`, which strips `:`.
 *
 * Exported for the resolver ([P13.8]): a key with this prefix has no file to
 * look up, and goes straight to [P13 §2.5]'s unique-name match.
 */
export const SPEAKER_BY_NAME = 'name:';

/**
 * ***A chat file, as a reader hands it on*** — the `ImportCandidate.format` of
 * a SillyTavern (or Marinara-exported) `.jsonl`,
 * [P13.8](../../../../../docs/design/workplan/30-p13-scene-and-session-import.md).
 *
 * Named here, beside the parser the candidate ends at, because three places
 * spell it and must agree: the tree reader routing `chats/` and `group chats/`
 * (`reader.ts`), the one-file probe that recognises a chat by its lines
 * (`upload.ts`), and the sweep that sets such candidates aside for its session
 * pass rather than handing them to the library writer (`sweep.ts`). *A
 * candidate carries no payload*: the pass reads the file when it gets to it,
 * so a tree whose chats are most of its bytes is not held in memory while its
 * cards are written.
 */
export const SILLYTAVERN_CHAT_FORMAT = 'sillytavern.chat';

/**
 * ***A group's own file*** — `groups/<id>.json`, its members, its reply
 * strategy and who is muted. Routed to the session pass with the chats, because
 * that is where [P13.9] reads it: a group chat's roster and settings come from
 * here, and the chats it names are in `group chats/`. *Recorded and not yet
 * read* until then, and the review says so.
 */
export const SILLYTAVERN_GROUP_FORMAT = 'sillytavern.group';

/**
 * ***A group's greetings share one batch***, so they become one opening turn —
 * [P13 §1.7]'s *"each member's primary opening, as one message each"*.
 *
 * SillyTavern gives each greeting its own `gen_id`, and a random one
 * (`Date.now() * Math.random() * 1000000`, `group-chats.js:600`), so read
 * literally every member's greeting is a batch of its own and [P13 §2.2]'s rule
 * makes each its own turn. That is not a distinction anybody made: the greetings
 * are written together, all at once, when the group chat is created
 * (`getGroupChat`, `group-chats.js:280`). A string that no `gen_id` can be — they
 * are numbers — keeps them together without colliding with a real batch.
 */
const GREETINGS = 'greetings';

/**
 * ***SillyTavern talking to the person, not the story*** — the
 * `system_message_types` (`system-messages.js:18`) that are its interface: the
 * help pages, the welcome screen, the empty-chat placeholder, the bias-only
 * send. Each is `is_system` and each can be saved into a chat file if the chat
 * is saved while it is showing.
 *
 * *Skipped, with a count*, rather than imported hidden: a help page is not a
 * line anybody wrote or anything a model was ever sent, and a hidden copy of it
 * in the transcript would be a ghost of a menu. Absent from this list, and so
 * imported like any other line: `narrator` and `comment` (below), and
 * `assistant_message`, which is the neutral Assistant's greeting and is sent to
 * the model like any greeting.
 */
const INTERFACE = new Set([
  'help',
  'welcome',
  'empty',
  'generic',
  'slash_commands',
  'formatting',
  'hotkeys',
  'macros',
  'welcome_prompt',
  'assistant_note',
]);

/** `chats/<card file sans .png>/<name>.jsonl` — `endpoints/chats.js:554`. */
const SINGLE = /^chats\/([^/]+)\/[^/]+$/;
/** `group chats/<id>.jsonl` — `endpoints/chats.js:803`. */
const GROUP = /^group chats\/[^/]+$/;

/**
 * Where SillyTavern's author's note can sit outside the history —
 * `extension_prompt_types` (`script.js:483`) `IN_PROMPT` (after the story
 * string) and `BEFORE_PROMPT` (before it); the third, `IN_CHAT`, is the only
 * place this session's note can be, since [P13 §1.5] places a note in the
 * history at a depth and nowhere else.
 */
const NOTE_OUTSIDE_HISTORY: ReadonlySet<unknown> = new Set([0, 2]);
/** `extension_prompt_roles` (`script.js:493`), for the note's role. */
const NOTE_ROLES: Readonly<Record<number, string>> = { 1: 'user', 2: 'assistant' };

/**
 * Reads one SillyTavern (or Marinara-exported) chat file.
 *
 * `path` is the file's place in the source, relative to the SillyTavern user
 * directory — `chats/Vera/Vera - 2024-07-12@01h31m37s123ms.jsonl`,
 * `group chats/2024-07-12@01h31m37s.jsonl` — or a bare file name when the file
 * arrived alone. It is the chat's id ([P13 §0.2]: *"a chat's own identity is
 * its path"*), the prefix of every line's foreign id, and, for a single chat,
 * the only place the file says whose chat it is.
 *
 * Refused, never thrown:
 * - `unreadable` — nothing in it parses as a line: an empty file, a text file,
 *   a JSON file that is not one object per line;
 * - `missing-field` (`messages`) — a header and nothing a person wrote.
 */
export function parseSillyTavernChat(
  source: Uint8Array | string,
  path: string,
): ParseOutcome<SillyTavernChat> {
  const name = chatNameOf(path);
  const entries = linesOf(typeof source === 'string' ? source : UTF8.decode(source));

  const first = entries.find((entry) => entry.value !== null);
  if (first?.value == null) return refused('unreadable');
  const header = isHeader(first.value) ? first : null;
  const metadata = recordOf(header?.value?.['chat_metadata']);

  const folder = SINGLE.exec(path)?.[1] ?? null;
  const group = GROUP.test(path) || (header === null && folder === null);

  const notes: ImportNote[] = [];
  const messages: ChatMessage[] = [];
  const counts = { interface: 0, tools: 0, attachments: 0, models: 0 };
  let marinara = isRecord(metadata['marinara_metadata']);
  let greetings = group;

  for (const entry of entries) {
    if (entry === header) continue;
    const line = entry.value;
    const text = line?.['mes'];
    /**
     * *A line that is not a message is a line nobody can read*, whether
     * `JSON.parse` refused it or it parsed to something with no text. The
     * second is the rarer and the more telling — a second header from two files
     * pasted together, a truncated write that happened to close its braces —
     * and either way the person holding the file is told which line.
     */
    if (line === null || typeof text !== 'string') {
      notes.push({
        key: 'import.chat.lineUnreadable',
        params: { chat: name, line: entry.index + 1 },
        level: 'warn',
      });
      continue;
    }

    const extra = recordOf(line['extra']);
    const theirs = marinaraRoleOf(extra['marinara_role']) ?? marinaraRoleOf(line['role']);
    if (theirs !== undefined) marinara = true;

    if (theirs === undefined && truthy(line['is_system']) && INTERFACE.has(str(extra['type']))) {
      counts.interface += 1;
      continue;
    }
    if (hasAttachment(extra)) counts.attachments += 1;

    /**
     * ***A tool call's record is the system's voice, kept and hidden.***
     * SillyTavern saves a function call as an `is_system` line holding the
     * calls and their results (`tool-calling.js:891`) and — alone among
     * `is_system` lines — sends it to a model that can call tools
     * (`script.js:4437`). A turn here has no tool-call record to put it in, so
     * it becomes what it most resembles, a narrator line, hidden so the model is
     * not sent a transcript of calls it never made; and the person is told,
     * because that is a change to what the model sees.
     */
    const tool = theirs === undefined && Array.isArray(extra['tool_invocations']);
    if (tool) counts.tools += 1;

    const role = theirs ?? roleOf(line, extra, tool);
    if (role === 'character' && recordsModel(extra)) counts.models += 1;
    /**
     * *A tool call's `is_system` is not the source hiding it* — it is the one
     * `is_system` line SillyTavern sends — so its hiding is the import's
     * (`hiddenByImport`), and the builder does not count it among the lines the
     * source hid.
     */
    const hidden =
      theirs === undefined
        ? (!tool && truthy(line['is_system'])) || extra['type'] === 'comment'
        : truthy(extra['hiddenFromAI']);

    /**
     * *Greetings end at the first line somebody sent or something generated.*
     * A greeting is written by `getFirstCharacterMessage` with no generation
     * record — no `gen_started`, no `extra.api` — where every generated reply
     * and every `/sendas` line has one (`script.js:6700`,
     * `slash-commands.js:5972`). A narrator line neither ends them nor joins
     * them: it carries no batch (see {@link batchOf}'s caller below).
     *
     * ***Read from the line's first swipe when it has one***, because that is
     * what the line began as. Swiping the last greeting of a group regenerates
     * it in place — `saveReply`'s `swipe` arm (`script.js:6612`) writes
     * `gen_started` and `extra.api` onto the line and leaves its `gen_id`
     * alone — while `swipe_info[0]` keeps the greeting's own record, with
     * neither (`ensureSwipes` and `syncMesToSwipe`, `script.js:6802`, `:6880`).
     * Read from the line, the greeting would end the greetings with itself
     * whenever its regenerated swipe was the one showing, and [P13 §1.7]'s one
     * opening turn would split in two over which swipe the person left up.
     */
    if (role === 'user') greetings = false;
    const infos = line['swipe_info'];
    const origin = Array.isArray(infos) && isRecord(infos[0]) ? infos[0] : line;
    const originExtra = origin === line ? extra : recordOf(origin['extra']);
    const generated = origin['gen_started'] !== undefined || typeof originExtra['api'] === 'string';
    if (role === 'character' && generated) greetings = false;

    const at = parseTimestamp(line['send_date']);
    const reasoning = role === 'user' ? undefined : reasoningOf(line, extra);
    /**
     * ***Only a character line carries its batch.*** `gen_id` is what one
     * group generation shares ([P13 §2.2]), and SillyTavern stamps it on
     * narrator and comment lines too — but there it is only the clock at the
     * moment the slash command ran (`slash-commands.js:6037`), marking a line
     * that no generation produced. Passed on, it would make a `/sys` line typed
     * after a group's replies a turn of its own, where [P13 §2.2] puts a
     * narrator line *"in the round it falls in"*.
     */
    const batch =
      role !== 'character' ? undefined : greetings ? GREETINGS : batchOf(extra['gen_id']);
    const swiped = role === 'character' ? swipesOf(line, extra, text, reasoning, at) : null;
    const speaker = role === 'character' ? speakerOf(line, extra, theirs, folder) : undefined;
    const persona = role === 'user' ? personaOf(line) : undefined;

    messages.push({
      role,
      text,
      ...(reasoning === undefined ? {} : { reasoning }),
      ...(speaker === undefined ? {} : { speaker }),
      ...(persona === undefined ? {} : { persona }),
      at,
      ...(swiped ?? {}),
      ...(hidden ? { hidden: true } : {}),
      ...(tool ? { hiddenByImport: true as const } : {}),
      ...(batch === undefined ? {} : { batch }),
      foreignId: `${path}#${String(entry.index)}`,
    });
  }

  if (messages.length === 0) return refused('missing-field', 'messages');

  if (counts.interface > 0) {
    notes.push({
      key: 'import.chat.interfaceSkipped',
      params: { chat: name, count: counts.interface },
      level: 'info',
    });
  }
  if (counts.tools > 0) {
    notes.push({
      key: 'import.chat.toolCallsHidden',
      params: { chat: name, count: counts.tools },
      level: 'warn',
    });
  }
  /**
   * *Attachments arrive as a count, never as bytes.* SillyTavern keeps an
   * attachment as a path or a URL into its own user directory (`extra.files`,
   * `extra.media` and their older spellings, `script.js:2060`), and Marinara as
   * a row of its own; neither is in the chat file. [P13 §2.6]: *"attachments
   * without bytes"* are a note.
   */
  if (counts.attachments > 0) {
    notes.push({
      key: 'import.chat.attachmentsNotCarried',
      params: { chat: name, count: counts.attachments },
      level: 'warn',
    });
  }
  /**
   * *Which model wrote a reply is not carried, and the person is told once.*
   * [P13 §2.6]: *"A `TurnRequest` built from three of its fields is a
   * fabrication of the other twenty."* Slash-command lines are left out of the
   * count: their `model` is SillyTavern's name for *typed by hand*.
   */
  if (counts.models > 0) {
    notes.push({
      key: 'import.chat.modelsNotCarried',
      params: { chat: name, count: counts.models },
      level: 'info',
    });
  }
  /**
   * *Chat variables are state a script wrote* (`/setvar`), read back by macros
   * and scripts this install does not run. [P13 §2.6] lists them as a note, and
   * a warning: a chat whose prompt read `{{getvar::mood}}` plays differently
   * without them.
   */
  const variables = recordOf(metadata['variables']);
  if (Object.keys(variables).length > 0) {
    notes.push({
      key: 'import.chat.variablesNotCarried',
      params: { chat: name, count: Object.keys(variables).length },
      level: 'warn',
    });
  }

  const note = noteOf(metadata, name, notes);
  const mainChat = nameOf(metadata['main_chat']);
  const integrity = nameOf(metadata['integrity']);
  const persona = nameOf(metadata['persona']);
  const worldInfo = nameOf(metadata['world_info']);
  const marinaraMetadata = metadata['marinara_metadata'];

  return parsed({
    chat: {
      id: path,
      name,
      messages,
      createdAt: parseTimestamp(header?.value?.['create_date']),
    },
    meta: {
      source: marinara ? 'marinara' : 'sillytavern',
      group,
      ...(mainChat === undefined ? {} : { mainChat }),
      ...(integrity === undefined ? {} : { integrity }),
      ...(persona === undefined ? {} : { persona: `User Avatars/${persona}` }),
      ...(worldInfo === undefined ? {} : { worldInfo }),
      ...(note === undefined ? {} : { note }),
      ...(isRecord(marinaraMetadata) ? { marinara: marinaraMetadata } : {}),
    },
    notes,
  });
}

// ---------------------------------------------------------------------------
// Lines and the header
// ---------------------------------------------------------------------------

/**
 * ***Bytes as SillyTavern reads them***: UTF-8 with a bad byte replaced rather
 * than refused (Node's `readFileSync(path, 'utf8')`, which `getChatData` uses),
 * and a leading byte-order mark dropped. One mangled character in a long chat
 * is a mangled character, not a lost chat.
 */
const UTF8 = new TextDecoder('utf-8');

interface Entry {
  /** The line's index in the file, from 0 — the header, when there is one, is 0. */
  index: number;
  /** The line as an object, or null when it is not one. */
  value: Record<string, unknown> | null;
}

/**
 * The file's lines, split on `\n` as `getChatData` splits them (a `\r` left at
 * the end of a line is whitespace to `JSON.parse`). Blank lines are dropped
 * without a word — the file's trailing newline is one, and nothing was lost.
 */
function linesOf(text: string): Entry[] {
  const entries: Entry[] = [];
  const body = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  for (const [index, raw] of body.split('\n').entries()) {
    if (raw.trim() === '') continue;
    let value: unknown;
    try {
      value = JSON.parse(raw);
    } catch {
      value = null;
    }
    entries.push({ index, value: isRecord(value) ? value : null });
  }
  return entries;
}

/**
 * ***A header carries `chat_metadata`, or has no `mes`.*** The first half is
 * `getGroupChat`'s own test (`group-chats.js:268`); the second catches the
 * headers written before `chat_metadata` existed, which held `user_name`,
 * `character_name` and `create_date` and no text. Applied to the first line
 * that parses rather than to line 0, so a corrupted first line costs itself
 * and not the header after it — or, in a headerless group file, the first
 * message after it.
 *
 * *`user_name` and `character_name` are never read.* SillyTavern has written
 * the literal `'unused'` into both since v1.10 (`script.js:7372`), and older
 * files hold whatever the names were on the day the chat began.
 */
function isHeader(line: Record<string, unknown>): boolean {
  return Object.hasOwn(line, 'chat_metadata') || line['mes'] === undefined;
}

/**
 * The chat's name — its file name without `.jsonl`, which is what SillyTavern
 * calls it everywhere: in the chat list, and in the `main_chat` of every branch
 * made from it (`bookmarks.js:198`).
 */
function chatNameOf(path: string): string {
  const file = path.split('/').at(-1) ?? path;
  const name = file.replace(/\.jsonl$/i, '');
  return name === '' ? path : name;
}

// ---------------------------------------------------------------------------
// One message
// ---------------------------------------------------------------------------

/** Marinara's four roles, as its own importer normalises them (`st-chat.importer.ts:133`). */
function marinaraRoleOf(value: unknown): ChatMessage['role'] | undefined {
  if (typeof value !== 'string') return undefined;
  switch (value.trim().toLowerCase()) {
    case 'user':
      return 'user';
    case 'assistant':
      return 'character';
    /**
     * *Both are narration* — [P13 §2.2]'s *"Marinara `role: 'narrator' |
     * 'system'`"*: Marinara sends each as the `system` role, unattributed.
     */
    case 'system':
    case 'narrator':
      return 'narrator';
    default:
      return undefined;
  }
}

/**
 * A SillyTavern line's role. **`extra.type` before `is_user`**, which is
 * SillyTavern's own order wherever it asks what a line is —
 * `messageRoleCallback` answers `system` for a narrator's line before it looks
 * at `is_user` (`slash-commands.js:5836`). The writers keep the two apart
 * (`/sys` and `/comment` write `is_user: false`, `slash-commands.js:6029`,
 * `:6116`), so the order only decides a file somebody edited by hand into
 * saying both, and then it decides it as SillyTavern would. A comment is a
 * narrator line that is hidden ([P13 §2.6]'s *"a hidden narrator message"*);
 * its hiding is read with the rest of the hiding, above.
 */
function roleOf(
  line: Record<string, unknown>,
  extra: Record<string, unknown>,
  tool: boolean,
): ChatMessage['role'] {
  if (tool || extra['type'] === 'narrator' || extra['type'] === 'comment') return 'narrator';
  return truthy(line['is_user']) ? 'user' : 'character';
}

/**
 * ***Who said a character line***, in the source's own terms — the key
 * [P13 §2.5]'s resolver looks up, and the thing turn identity hashes (see
 * {@link ForeignRef}). In order:
 *
 * 1. **Marinara's character id**, `extra.marinara_character_id` or the export's
 *    top-level `character_id` — Marinara's own name for the speaker.
 * 2. **`original_avatar`**, the card file every group reply and `/sendas` line
 *    records (`script.js:6715`). *Unless it is a path*: a `/sendas` to a name
 *    with no card writes SillyTavern's placeholder image there
 *    (`slash-commands.js:5803`), and a card file never contains `/`.
 * 3. **A character thumbnail in `force_avatar`**, `/thumbnail?type=avatar&file=…`
 *    (`script.js:7490`) — the same card file, and the only record of it in
 *    group lines written before `original_avatar` existed.
 * 4. **The chat's own folder**, for a line in a single chat that forces no
 *    avatar at all. SillyTavern files a single chat under its card
 *    (`chats/<card file sans .png>/`), and writes no avatar on the lines of
 *    the chat's own character — its replies, its greeting, a `/sendas` to it
 *    (`slash-commands.js:5796`) — because the chat already says whose it is.
 *    *A line that does force an avatar is someone else's*, and never falls
 *    through to the folder: that is how a `/sendas` line by a stranger is not
 *    attributed to the card.
 * 5. **The name**, as {@link SPEAKER_BY_NAME}.
 */
function speakerOf(
  line: Record<string, unknown>,
  extra: Record<string, unknown>,
  theirs: ChatMessage['role'] | undefined,
  folder: string | null,
): ForeignRef | undefined {
  const name = str(line['name']);
  if (theirs !== undefined) {
    const id = str(extra['marinara_character_id']) || str(line['character_id']);
    if (id !== '') return { key: id, name };
  }
  const original = str(line['original_avatar']);
  if (original !== '' && !original.includes('/')) return { key: original, name };
  const thumbnail = thumbnailFileOf(line['force_avatar'], 'avatar');
  if (thumbnail !== null) return { key: thumbnail, name };
  if (folder !== null && line['force_avatar'] === undefined) {
    return { key: `${folder}.png`, name };
  }
  return name === '' ? undefined : { key: `${SPEAKER_BY_NAME}${name}`, name };
}

/**
 * ***Who the player was on a line*** — [P13 §2.5]'s *"a user line's
 * `force_avatar` thumbnail `file=` → `User Avatars/<file>`"*. SillyTavern locks
 * a line to its persona by writing the persona's thumbnail URL
 * (`script.js:5835`); the key is the persona image's place in the user
 * directory, which is also the `originalFilename` the library stamped on that
 * persona when it was imported (`sillytavern/reader.ts`). No `force_avatar`,
 * no persona: the chat's locked persona ({@link SillyTavernChatMeta.persona})
 * is the resolver's fallback, not the parser's.
 */
function personaOf(line: Record<string, unknown>): ForeignRef | undefined {
  const avatar = line['force_avatar'];
  const file =
    thumbnailFileOf(avatar, 'persona') ??
    (typeof avatar === 'string' && avatar.startsWith('User Avatars/')
      ? avatar.slice('User Avatars/'.length)
      : null);
  if (file === null || file === '' || file.includes('/')) return undefined;
  return { key: `User Avatars/${file}`, name: str(line['name']) };
}

/**
 * The `file` of a SillyTavern thumbnail URL of the given type —
 * `/thumbnail?type=persona&file=ned.png` — decoded, or null. `URLSearchParams`
 * rather than a pattern because SillyTavern writes the file with
 * `encodeURIComponent` (`script.js:7490`), and a card called `Mr. & Mrs.png`
 * is a real card; and it never throws on a malformed escape.
 */
function thumbnailFileOf(value: unknown, type: 'avatar' | 'persona'): string | null {
  if (typeof value !== 'string') return null;
  const query = value.indexOf('?');
  if (query === -1) return null;
  const params = new URLSearchParams(value.slice(query + 1));
  const file = params.get('file');
  if (params.get('type') !== type || file === null || file === '' || file.includes('/')) {
    return null;
  }
  return file;
}

/**
 * A line's reasoning: SillyTavern's `extra.reasoning`, or the `reasoning_content`
 * Marinara's export lifts out of `extra` onto the line (`chats.routes.ts:3585`).
 * Empty is none.
 */
function reasoningOf(
  line: Record<string, unknown>,
  extra: Record<string, unknown>,
): string | undefined {
  const reasoning = str(extra['reasoning']) || str(line['reasoning_content']);
  return reasoning === '' ? undefined : reasoning;
}

/**
 * `gen_id` as a batch — SillyTavern writes a number (`Date.now()`,
 * `group-chats.js:988`); a string is kept as it is. Printed with `String`,
 * which for a number `JSON.parse` produced is the same text on every run, so a
 * batch compares equal across two reads of the file.
 */
function batchOf(value: unknown): string | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  if (typeof value === 'string' && value !== '') return value;
  return undefined;
}

/**
 * ***A character line's alternatives*** — [P13 §2.3], and [P13 §0.3]'s rule.
 *
 * **`mes` is the active swipe's current text.** An edit writes `mes`; older
 * SillyTavern left `swipes[swipe_id]` holding what was there before, and only a
 * later swipe away and back resynced it (`syncMesToSwipe`, `script.js:6843`).
 * So the active swipe is overwritten with `mes`, which is exactly Marinara's
 * own importer (`st-chat.importer.ts:341-343`), and the builder trusts
 * `swipes[activeSwipe]` because this did. *Not a note*: the stale copy is one
 * SillyTavern itself never shows again.
 *
 * - **Which swipe is active**: `swipe_id`, and **0 when it is not a number**,
 *   which is `ensureSwipes` (`script.js:6803`). An index outside the array is
 *   left out rather than clamped, and the builder then finds the active swipe
 *   by its text — the one thing it can be sure of.
 * - **A non-string swipe is empty**, `ensureSwipes` again: SillyTavern shows it
 *   as a swipe with nothing in it, and so does this.
 * - **Per-swipe time and reasoning** from `swipe_info[i]` (`send_date`,
 *   `extra.reasoning`, `script.js:6733`), or for a Marinara line from
 *   `extra.marinara_swipes`, whose `index` is Marinara's own swipe number and
 *   whose position matches `swipes` (both are mapped from one list,
 *   `chats.routes.ts:3564`). The active swipe takes the line's own time and
 *   reasoning, for `mes`'s reason: the line is the authoritative copy.
 * - **Fewer than two is none.** A lone swipe is the line itself, and
 *   SillyTavern writes one on nearly every reply.
 */
function swipesOf(
  line: Record<string, unknown>,
  extra: Record<string, unknown>,
  text: string,
  reasoning: string | undefined,
  at: number | null,
): { swipes: ChatSwipe[]; activeSwipe?: number } | null {
  const raw = line['swipes'];
  if (!Array.isArray(raw) || raw.length < 2) return null;
  const texts = raw.map((swipe) => (typeof swipe === 'string' ? swipe : ''));
  const info = Array.isArray(line['swipe_info']) ? line['swipe_info'] : [];
  const theirs = Array.isArray(extra['marinara_swipes']) ? extra['marinara_swipes'] : [];

  const id = line['swipe_id'];
  const byMarinara = theirs.findIndex((swipe) => recordOf(swipe)['index'] === id);
  const active =
    typeof id !== 'number'
      ? 0
      : byMarinara !== -1
        ? byMarinara
        : Number.isInteger(id) && id >= 0 && id < texts.length
          ? id
          : undefined;

  const swipes = texts.map((swipeText, index): ChatSwipe => {
    if (index === active) {
      return { text, ...(reasoning === undefined ? {} : { reasoning }), at };
    }
    const own = recordOf(info[index]);
    const marinara = recordOf(theirs[index]);
    const swipeReasoning = str(recordOf(own['extra'])['reasoning']);
    return {
      text: swipeText,
      ...(swipeReasoning === '' ? {} : { reasoning: swipeReasoning }),
      at: parseTimestamp(marinara['created_at'] ?? marinara['createdAt'] ?? own['send_date']),
    };
  });
  return active === undefined ? { swipes } : { swipes, activeSwipe: active };
}

/**
 * Whether a line had something attached — SillyTavern's current `files` and
 * `media`, the older `file`, `image`, `image_swipes` and `video` its loader
 * still migrates (`ensureMessageMediaIsArray`, `script.js:2060`), and
 * Marinara's `attachments`.
 */
function hasAttachment(extra: Record<string, unknown>): boolean {
  const some = (value: unknown): boolean =>
    (Array.isArray(value) && value.length > 0) ||
    (typeof value === 'string' && value !== '') ||
    isRecord(value);
  return ATTACHMENTS.some((field) => some(extra[field]));
}

const ATTACHMENTS = ['files', 'media', 'file', 'image', 'image_swipes', 'video', 'attachments'];

/** A reply that recorded the model that wrote it — not a slash command's `manual`. */
function recordsModel(extra: Record<string, unknown>): boolean {
  return str(extra['model']) !== '' && extra['api'] !== 'manual';
}

// ---------------------------------------------------------------------------
// The header's author's note
// ---------------------------------------------------------------------------

/**
 * ***The author's note, in the session's shape*** — [P13 §2.6]'s
 * `note_prompt` / `note_depth` / `note_interval` onto `session.note`.
 *
 * **No text is no note**, as `chatSettingsOf` reads it: SillyTavern keeps an
 * empty `note_prompt` in every chat that opened the panel. A depth or interval
 * that is missing or not a whole number takes SillyTavern's own default, 4 and
 * 1 (`authors-note.js:272`), which are also this session's. ***An interval of 0
 * or less is copied as 0***, a note switched off with its text kept —
 * SillyTavern's *"0 = Disable"* (`authors-note.js:351`), and `chatSettingsOf`'s
 * reading of the same number.
 *
 * *Where SillyTavern put the note is not always somewhere a note can be here.*
 * Its note could sit beside the story string, outside the history, or be sent
 * as the user's or the assistant's message; this session's note sits in the
 * history at its depth ([P13 §1.5]). Each difference is a note of its own,
 * because each changes what the model is sent.
 */
function noteOf(
  metadata: Record<string, unknown>,
  chat: string,
  notes: ImportNote[],
): NonNullable<ChatSettings['note']> | undefined {
  const text = metadata['note_prompt'];
  if (typeof text !== 'string' || text === '') return undefined;
  const depth = metadata['note_depth'];
  const every = metadata['note_interval'];
  const note = {
    text,
    depth: typeof depth === 'number' && Number.isInteger(depth) && depth >= 0 ? depth : 4,
    every: typeof every === 'number' && Number.isInteger(every) ? Math.max(every, 0) : 1,
  };

  if (NOTE_OUTSIDE_HISTORY.has(metadata['note_position'])) {
    notes.push({
      key: 'import.chat.noteOutsideHistory',
      params: { chat, depth: note.depth },
      level: 'warn',
    });
  }
  const role = metadata['note_role'];
  const spoken = typeof role === 'number' ? NOTE_ROLES[role] : undefined;
  if (spoken !== undefined) {
    notes.push({ key: 'import.chat.noteRole', params: { chat, role: spoken }, level: 'warn' });
  }
  return note;
}

// ---------------------------------------------------------------------------
// Timestamps — `parseTimestamp`, ported
// ---------------------------------------------------------------------------

/**
 * ***SillyTavern's `parseTimestamp`, ported*** — `public/scripts/utils.js:1096`
 * at the pin, with the `moment` 2.30.1 parsing it leans on — answering in
 * milliseconds since the epoch, or null where SillyTavern shows *Invalid date*.
 *
 * **Ported rather than approximated**, because `send_date` has been written
 * five ways over SillyTavern's life and every one of them is in somebody's
 * chats: an ISO string (today, `getMessageTimeStamp`), epoch milliseconds (the
 * oldest), `June 19, 2023 2:20pm`, and three spellings of its humanized
 * `2024-07-12@01h31m37s123ms`. `Date.parse` reads the first and misreads or
 * refuses the rest — and a time read wrong is not a cosmetic bug here: it is
 * part of every turn id ([P13 §2.4]), so two readings of the same line must
 * agree to the millisecond. The branches run in SillyTavern's order, and the
 * first form that matches decides, valid or not, as it does there.
 *
 * ***Three deliberate departures, each where SillyTavern consults something a
 * pure function cannot:***
 *
 * - **A time with no zone is read as UTC.** SillyTavern hands the ISO string to
 *   `moment`, which reads a zoneless one — `2024-07-12T01:31:37`, and every
 *   `June 19, 2023 2:20pm` — in the *browser's* zone. A server has no browser,
 *   and reading it in the server's zone would make turn ids depend on the
 *   `TZ` the server was started with: the same chat imported on two machines
 *   would not collapse, and a sync after a move would fork the session. UTC
 *   is at worst hours off, the same hours on every install. The humanized
 *   forms are unaffected: SillyTavern itself appends `Z` to them.
 * - **An unknown month name is null.** `moment().month('Smarch')` leaves the
 *   month unchanged — *the current month* — so SillyTavern dates such a line
 *   in whatever month it is displayed.
 * - **Anything that is not a string, a number or a `Date` is null**, where
 *   SillyTavern would throw (`timestamp.match` on an object) or coerce (an
 *   array of one number passes its digit test). So is a `Date` that is invalid
 *   or a number past `Date`'s range, both of which throw in `toISOString`.
 */
export function parseTimestamp(timestamp: unknown): number | null {
  if (!timestamp) return null;

  if (timestamp instanceof Date) {
    const time = timestamp.getTime();
    return Number.isFinite(time) ? time : null;
  }

  // Unix time — "legacy TAI / tags". Milliseconds, as `new Date(n)` reads them,
  // and truncated as `new Date(n)` truncates.
  if (typeof timestamp === 'number' || (typeof timestamp === 'string' && /^\d+$/.test(timestamp))) {
    const unixTime = Number(timestamp);
    if (!Number.isFinite(unixTime) || unixTime < 0 || unixTime > LATEST_DATE) return null;
    return Math.trunc(unixTime);
  }
  if (typeof timestamp !== 'string') return null;

  const iso = strictIso(timestamp);
  if (iso !== null) return iso;

  // June 19, 2023 2:20pm — built into a zoneless ISO string and read back.
  const meridiem = MERIDIEM.exec(timestamp);
  if (meridiem !== null) {
    const [, month = '', day = '', year = '', hour = '', minute = '', half = ''] = meridiem;
    const monthNumber = monthOf(month);
    if (monthNumber === null) return null;
    const hour12 = parseInt(hour, 10) % 12;
    return instantOf({
      year: Number(year),
      month: monthNumber,
      day: Number(day),
      hour: half.toLowerCase() === 'pm' ? hour12 + 12 : hour12,
      minute: Number(minute),
      second: 0,
      millisecond: 0,
      offset: 0,
    });
  }

  // The humanized forms, each built into an ISO string with `Z` and read back.
  for (const pattern of HUMANIZED) {
    const humanized = pattern.exec(timestamp);
    if (humanized === null) continue;
    const [, year = '', month = '', day = '', hour = '', minute = '', second = '', ms] = humanized;
    return instantOf({
      year: Number(year),
      month: Number(month),
      day: Number(day),
      hour: Number(hour),
      minute: Number(minute),
      second: Number(second),
      millisecond: ms === undefined ? 0 : Number(ms.padStart(3, '0')),
      offset: 0,
    });
  }

  return null;
}

/** `Date`'s own limit, ±8.64e15 ms; past it `toISOString` throws. */
const LATEST_DATE = 8.64e15;

const MERIDIEM = /(\w+)\s(\d{1,2}),\s(\d{4})\s(\d{1,2}):(\d{1,2})(am|pm)/i;

/**
 * `2024-07-12@01h31m37s123ms`, `2024-7-12@01h31m37s` and
 * `2024-6-5 @14h 56m 50s 682ms`, in SillyTavern's order — which matters, since
 * none is anchored and the second matches the start of the first.
 */
const HUMANIZED = [
  /(\d{4})-(\d{1,2})-(\d{1,2})@(\d{1,2})h(\d{1,2})m(\d{1,2})s(\d{1,3})ms/,
  /(\d{4})-(\d{1,2})-(\d{1,2})@(\d{1,2})h(\d{1,2})m(\d{1,2})s/,
  /(\d{4})-(\d{1,2})-(\d{1,2}) @(\d{1,2})h (\d{1,2})m (\d{1,2})s (\d{1,3})ms/,
];

const MONTHS = [
  'january',
  'february',
  'march',
  'april',
  'may',
  'june',
  'july',
  'august',
  'september',
  'october',
  'november',
  'december',
];

/**
 * ***`moment().month(name).format('MM')`***, from 1. `moment`'s English
 * locale matches a month by prefix, full name or three-letter short, first
 * month first and ignoring case (`localeMonthsParse`, `^june|^jun`), so `Jun`,
 * `JUNE` and `Juni` are all June — and since every full name begins with its
 * short one, the short prefix alone is the same test. Digits are a month counted from zero that wraps into the
 * next year, as the setter does — `13` is February. Anything else is null:
 * see {@link parseTimestamp} on the current month.
 */
function monthOf(word: string): number | null {
  if (/^\d+$/.test(word)) {
    const index = Number(word);
    // Past a few million months the date leaves `Date`'s range, and moment's
    // answer is *Invalid date*.
    return index <= 3_000_000 ? (index % 12) + 1 : null;
  }
  const lower = word.toLowerCase();
  const at = MONTHS.findIndex((month) => lower.startsWith(month.slice(0, 3)));
  return at === -1 ? null : at + 1;
}

/**
 * `moment`'s ISO 8601 grammar, verbatim (`extendedIsoRegex`, `basicIsoRegex`).
 * The `\s*` both allow — leading, and before `Z` — is text a *strict* parse
 * then leaves over, which fails it; {@link strictIso} says so explicitly.
 */
const EXTENDED_ISO =
  /^\s*((?:[+-]\d{6}|\d{4})-(?:\d\d-\d\d|W\d\d-\d|W\d\d|\d\d\d|\d\d))(?:(T| )(\d\d(?::\d\d(?::\d\d(?:[.,]\d+)?)?)?)([+-]\d\d(?::?\d\d)?|\s*Z)?)?$/;
const BASIC_ISO =
  /^\s*((?:[+-]\d{6}|\d{4})(?:\d\d\d\d|W\d\d\d|W\d\d|\d\d\d|\d\d|))(?:(T| )(\d\d(?:\d\d(?:\d\d(?:[.,]\d+)?)?)?)([+-]\d\d(?::?\d\d)?|\s*Z)?)?$/;

type DateShape = 'calendar' | 'ordinal' | 'week';

/**
 * `moment`'s `isoDates`, in its order: the first whose pattern occurs anywhere
 * in the date part names the format, and `time: false` is a date that may not
 * carry a time. Each is paired with the exact shape a strict parse of that
 * format accepts — anchored, which is what *strict* adds — and the groups it
 * reads. A date part the chosen format does not fit exactly (`+002024194`
 * picks `YYYYMMDD` for its eight digits and then fails on the sign) is not a
 * date, as it is not to `moment`.
 */
const ISO_DATES: readonly { find: RegExp; fit: RegExp; shape: DateShape; time: boolean }[] = [
  {
    find: /[+-]\d{6}-\d\d-\d\d/,
    fit: /^([+-]\d{6})-(\d\d)-(\d\d)$/,
    shape: 'calendar',
    time: true,
  },
  { find: /\d{4}-\d\d-\d\d/, fit: /^(\d{4})-(\d\d)-(\d\d)$/, shape: 'calendar', time: true },
  { find: /\d{4}-W\d\d-\d/, fit: /^(\d{4})-W(\d\d)-(\d)$/, shape: 'week', time: true },
  { find: /\d{4}-W\d\d/, fit: /^(\d{4})-W(\d\d)$/, shape: 'week', time: false },
  { find: /\d{4}-\d{3}/, fit: /^(\d{4})-(\d{3})$/, shape: 'ordinal', time: true },
  { find: /\d{4}-\d\d/, fit: /^(\d{4})-(\d\d)$/, shape: 'calendar', time: false },
  { find: /[+-]\d{10}/, fit: /^([+-]\d{6})(\d\d)(\d\d)$/, shape: 'calendar', time: true },
  { find: /\d{8}/, fit: /^(\d{4})(\d\d)(\d\d)$/, shape: 'calendar', time: true },
  { find: /\d{4}W\d{3}/, fit: /^(\d{4})W(\d\d)(\d)$/, shape: 'week', time: true },
  { find: /\d{4}W\d{2}/, fit: /^(\d{4})W(\d\d)$/, shape: 'week', time: false },
  { find: /\d{7}/, fit: /^(\d{4})(\d{3})$/, shape: 'ordinal', time: true },
  { find: /\d{6}/, fit: /^(\d{4})(\d\d)$/, shape: 'calendar', time: false },
  { find: /\d{4}/, fit: /^(\d{4})$/, shape: 'calendar', time: false },
];

/**
 * A strict `moment(timestamp, moment.ISO_8601, true)`: the instant, or null
 * when `isValid()` would be false.
 *
 * The time part needs no table of its own: both grammars admit exactly the
 * shapes `moment`'s `isoTimes` read (`HH`, `HH:mm`, `HH:mm:ss`, a fraction with
 * `.` or `,`, and their colon-free twins), so the digits are read in pairs. A
 * fraction is milliseconds as `moment` computes them,
 * `floor(Number('0.' + digits) * 1000)` — the same arithmetic, so the same
 * rounding.
 */
function strictIso(text: string): number | null {
  const match = EXTENDED_ISO.exec(text) ?? BASIC_ISO.exec(text);
  if (match === null || /^\s/.test(text)) return null;
  const [, datePart = '', , timePart, zone] = match;
  if (zone !== undefined && /^\s/.test(zone)) return null;

  const format = ISO_DATES.find((candidate) => candidate.find.test(datePart));
  const fields = format?.fit.exec(datePart);
  if (format === undefined || fields == null) return null;
  if (!format.time && timePart !== undefined) return null;

  const year = Number(fields[1]);
  const second = Number(fields[2] ?? '1');
  const third = Number(fields[3] ?? '1');
  const date =
    format.shape === 'calendar'
      ? { year, month: second, day: third }
      : format.shape === 'ordinal'
        ? ordinalDate(year, second)
        : weekDate(year, second, third);
  if (date === null) return null;

  const digits = (timePart ?? '').replace(/:/g, '');
  const [whole = '', fraction] = digits.split(/[.,]/);
  return instantOf({
    ...date,
    hour: Number(whole.slice(0, 2) || '0'),
    minute: Number(whole.slice(2, 4) || '0'),
    second: Number(whole.slice(4, 6) || '0'),
    millisecond: fraction === undefined ? 0 : Math.floor(Number(`0.${fraction}`) * 1000),
    offset: offsetOf(zone),
  });
}

/** A calendar date, before its time of day. */
interface Day {
  year: number;
  /** 1–12. */
  month: number;
  day: number;
}

/**
 * `moment`'s `offsetFromString`: `Z` is 0, `+05`, `+0530` and `+05:30` are
 * minutes east of UTC. *No zone is 0* — see {@link parseTimestamp}.
 */
function offsetOf(zone: string | undefined): number {
  if (zone === undefined || zone === 'Z') return 0;
  const [, sign = '+', hours = '0', minutes = '0'] = /^([+-])(\d\d):?(\d\d)?$/.exec(zone) ?? [];
  const total = Number(hours) * 60 + Number(minutes);
  return sign === '-' ? -total : total;
}

/**
 * An ordinal date's calendar date, or null at day 0 or past the year's end —
 * `moment`'s `_overflowDayOfYear`.
 */
function ordinalDate(year: number, dayOfYear: number): Day | null {
  if (dayOfYear < 1 || dayOfYear > (isLeap(year) ? 366 : 365)) return null;
  return dayOf(utc(year, 0, dayOfYear));
}

/**
 * An ISO week date's calendar date — week 1 holds 4 January, weeks start on
 * Monday — or null for a week the year does not have or a weekday outside 1–7,
 * `moment`'s `_overflowWeeks` and `_overflowWeekday`. The answer may fall in
 * the neighbouring calendar year (`2020-W53-5` is 1 January 2021), which is why
 * it is a whole {@link Day} rather than a month and day of `year`.
 */
function weekDate(year: number, week: number, weekday: number): Day | null {
  /** Monday of week 1, as a day of January (0 and below reach into December). */
  const weekOne = (of: number): number => 4 - ((utc(of, 0, 4).getUTCDay() + 6) % 7);
  const start = weekOne(year);
  const weeks = ((isLeap(year) ? 366 : 365) - start + weekOne(year + 1)) / 7;
  if (week < 1 || week > weeks || weekday < 1 || weekday > 7) return null;
  return dayOf(utc(year, 0, start + (week - 1) * 7 + (weekday - 1)));
}

function dayOf(date: Date): Day {
  return { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1, day: date.getUTCDate() };
}

function isLeap(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

/** A UTC date whose year is taken literally — `Date.UTC` reads 0–99 as 1900–1999. */
function utc(year: number, monthIndex: number, day: number): Date {
  const date = new Date(0);
  date.setUTCFullYear(year, monthIndex, day);
  return date;
}

interface Fields extends Day {
  hour: number;
  minute: number;
  second: number;
  millisecond: number;
  /** Minutes east of UTC. */
  offset: number;
}

/**
 * ***The instant, if `moment` would call the fields valid***, else null — its
 * `checkOverflow`: a month of 1–12, a day the month has, an hour of 0–24 where
 * 24 is allowed only as `24:00:00.000` (and means the next midnight, which
 * `Date` carries over), minutes and seconds of 0–59. A year past `Date`'s range
 * is *Invalid date* in `moment` too.
 */
function instantOf(fields: Fields): number | null {
  const { year, month, day, hour, minute, second, millisecond, offset } = fields;
  if (month < 1 || month > 12 || day < 1 || day > utc(year, month, 0).getUTCDate()) return null;
  if (hour > 24 || (hour === 24 && (minute !== 0 || second !== 0 || millisecond !== 0))) {
    return null;
  }
  if (minute > 59 || second > 59) return null;

  const date = utc(year, month - 1, day);
  date.setUTCHours(hour, minute, second, millisecond);
  const time = date.getTime() - offset * 60_000;
  return Number.isFinite(time) ? time : null;
}

// ---------------------------------------------------------------------------
// Small readers
// ---------------------------------------------------------------------------

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function recordOf(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}

function str(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

/** SillyTavern's own reading of its flags — `if (mes.is_user)`, never `=== true`. */
function truthy(value: unknown): boolean {
  return Boolean(value);
}

/**
 * A name the header gives — a chat, a persona file, a world. Group chat ids
 * have been numbers in some builds (`Date.now()`), and a number names the file
 * its digits spell.
 */
function nameOf(value: unknown): string | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return typeof value === 'string' && value !== '' ? value : undefined;
}
