// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import type { ImportNote } from '@storyengine/shared';

import type {
  ChatMessage,
  ChatSettings,
  ChatSourceChat,
  ChatStateValue,
  ChatSwipe,
  ForeignRef,
} from '../chat/types.js';
import { parseTimestamp } from '../sillytavern/chat.js';
import { snapshotStates, trackerSwitches, unreadKeys } from './trackers.js';

/**
 * ***Marinara's chats, read from its tables*** —
 * [P13.10](../../../../../docs/design/workplan/30-p13-scene-and-session-import.md),
 * [P13 §0.3](../../../../../docs/design/workplan/30-p13-scene-and-session-import.md),
 * [P13 §2.2](../../../../../docs/design/workplan/30-p13-scene-and-session-import.md),
 * [P13 §2.6](../../../../../docs/design/workplan/30-p13-scene-and-session-import.md).
 *
 * **The same thing SillyTavern's parser says, from a different shape.** A
 * SillyTavern chat is one file of lines; a Marinara chat is a `chats` row, the
 * `messages` rows that point back at it, and the `message_swipes` rows that
 * point back at those — three tables joined by id, as the store reader
 * (`reader.ts`) hands them over, flat or sharded. This module does the join and
 * says what each chat *is* in the builder's source-neutral terms
 * (`chat/types.ts`), so the one builder ([P13.6]) decides what a round is for
 * both sources. `families.ts` beside it says which chats are one family.
 *
 * ***Pure***: rows in, chats and notes out. No file is read here, and nothing
 * about the library is known — a speaker is Marinara's character id, which the
 * resolver (`chat/resolve.ts`) tries as the row the reader stamped
 * (`storage/tables/characters.json#<id>`).
 *
 * ***Rows as the store holds them, and as the API returns them.*** The store
 * keeps `metadata`, `characterIds` and `extra` as JSON *text*
 * (`db/schema/chats.ts` at the pin: `text("metadata")`, `text("character_ids")`,
 * `text("extra")`), which is what a data root and a profile archive carry; a
 * hand-made or older snapshot may hold the parsed object. Both are read, the
 * same lesson the preset converter paid for (`preset.ts`, 2026-09-27): a
 * converter written against one shape reads nothing of the other, and no test
 * written against the same shape notices.
 *
 * ~~***Not in this stage***, and deliberately: `game_state_snapshots` onto
 * tracker effects, `agent_memory`'s secret plot, and the chat's agent switches
 * ([P13 §2.6]'s second table).~~ ***The trackers came at [P13.5a]***, with the
 * channels they needed: each message and swipe carries the state its
 * snapshot established (`ChatMessage.state`, `ChatSwipe.state`, read by
 * `trackers.ts`), the builder writes it as effects on the turn holding it, and
 * the chat's tracker switches travel as {@link MarinaraChat.state}.
 * `agent_memory`'s secret plot still waits on [P13.5b]'s channel, and a chat
 * running agents that are not trackers still says so
 * (`import.chat.agentsNotCarried`).
 */

/** The candidate format the store reader hands the session pass (`reader.ts`). */
export const MARINARA_CHATS_FORMAT = 'marinara.chats';

/** Where the reader stamps a persona — [P13 §2.5]'s `storage/tables/personas.json#<chat.personaId>`. */
const PERSONAS = 'storage/tables/personas.json#';

type Row = Readonly<Record<string, unknown>>;

/**
 * ***What the store reader hands over*** — the three chat tables, and the two
 * library tables whose names the lines need. `characters` and `personas` are
 * read for *names* only: a Marinara message names its speaker by id and nothing
 * else, and a transcript line needs a name to show when resolution finds no
 * actor. Absent is no names, and a line is then shown under its id.
 */
export interface MarinaraTables {
  chats: readonly Row[];
  messages: readonly Row[];
  swipes: readonly Row[];
  characters?: readonly Row[];
  personas?: readonly Row[];
  /**
   * `game_state_snapshots` — the trackers' state per message and swipe
   * ([P13.5a]). Absent is a store that never ran them.
   */
  snapshots?: readonly Row[];
}

/**
 * ***One roleplay chat, read*** — the chat as the builder takes it, and what
 * its row says around it.
 *
 * - **`chat`**: `id` is the chat row's id; `name` is its branch label
 *   (`metadata.branchName`) when it has one, else its name — Marinara keeps
 *   a branch's `name` equal to the chat it was made from (*"Keep the main
 *   thread/chat name stable and store the per-branch display label in
 *   metadata"*, `chats.routes.ts:3757`), so the label is what tells the refs
 *   apart. `parentId` is left for `families.ts` to set.
 * - **`title`**: the thread's own `name`, which the family's session is called.
 * - **`branchOf`**: `metadata.branchParentChatId`, raw.
 * - **`members`**: `characterIds`, in the chat's order, each with a name —
 *   the roster ([P13 §2.5]).
 * - **`persona`**: `personaId` as the key the reader stamps a persona with.
 * - **`settings`**: [P13 §2.6]'s group rows, for a chat of more than one member.
 * - **`metadata`**: the row's `metadata`, parsed — kept so the session pass can
 *   read the root's group rows against a family's whole roster, which a branch
 *   that added a member makes larger than the root's own (`chat-sessions.ts`).
 * - **`earliest`**: the earliest readable time among its messages, else the
 *   chat's creation — the order `families.ts` sorts by.
 * - **`notes`**: what did not come across, each naming the chat.
 */
export interface MarinaraChat {
  chat: ChatSourceChat;
  title: string;
  branchOf?: string;
  members: ForeignRef[];
  persona?: string;
  settings: ChatSettings;
  metadata: Readonly<Record<string, unknown>>;
  earliest: number | null;
  notes: ImportNote[];
  /**
   * ***The chat's tracker switches*** — `activeAgentIds` and `manualTrackers`
   * as `se.track.*` values ([P13.5a], `trackers.ts`), for the family's
   * opening turns. The session pass takes the root's, as it takes the root's
   * group settings.
   */
  state: ChatStateValue[];
}

/** A chat that is not `roleplay`, recorded by the pass rather than imported. */
export interface MarinaraOtherChat {
  id: string;
  name: string;
  mode: string;
}

/**
 * {@link parseMarinaraChats}' answer: the roleplay chats, the rest, and how many
 * rows pointed at nothing — so the review can say so rather than dropping them.
 */
export interface MarinaraChats {
  chats: MarinaraChat[];
  other: MarinaraOtherChat[];
  orphans: { messages: number; swipes: number };
}

/**
 * ***The tables, joined*** — every chat row, each roleplay chat with its
 * messages in Marinara's order and each message with its swipes.
 *
 * **Only `roleplay` becomes a session** ([P13 §2.6]: *"Marinara `conversation`
 * and `game` chats stay recorded; Part B imports `roleplay`"*). A conversation
 * is a messenger thread with schedules, calls and reactions, and a game has an
 * engine state a Scene has no place for; importing either as a Scene would be
 * a session that looks like the chat and plays like neither. They come back in
 * `other`, so each still gets a row.
 *
 * ***Orphans are counted, not guessed at.*** Marinara's sharded store keeps a
 * shard of rows whose chat it could not place (`orphaned-rows.json`), and a
 * message whose chat was deleted outside the app is the same thing seen from
 * the other side. Neither has a chat to be a line of, so neither is imported,
 * and the count is what the review says instead of nothing.
 *
 * *Chats come back in id order*, which the store's listing cannot move; the
 * family order that ids depend on is `families.ts`'s, and starts from this.
 */
export function parseMarinaraChats(tables: MarinaraTables): MarinaraChats {
  const characterNames = namesOf(tables.characters ?? [], (row) => {
    const card = recordOf(row['data']);
    // A card is V2's `{ name, … }` or wrapped in `{ data: { name } }`, as a card
    // file is; Marinara stores the former, and reading both costs one lookup.
    return str(card['name']) || str(recordOf(card['data'])['name']) || str(row['name']);
  });
  const personaNames = namesOf(tables.personas ?? [], (row) => str(row['name']));

  /**
   * ***One row per id***, the first kept — as the chat rows below are. The
   * reader reads a sharded table's primaries only (`reader.ts`, `#rows`), but a
   * `.bak` or a half-written temp copy beside a shard holds the *same* rows,
   * and reading one twice is every reply arriving with a phantom second swipe
   * of itself. This is the second guard, which costs nothing when the first
   * held: a store with two rows under one id is one Marinara would not load.
   */
  const messageRows = firstById(tables.messages);
  const swipeRows = firstById(tables.swipes);

  const chatIds = new Set(tables.chats.map((row) => str(row['id'])).filter((id) => id !== ''));
  const messagesOf = new Map<string, Row[]>();
  let orphanMessages = 0;
  for (const row of messageRows) {
    const chatId = str(row['chatId']);
    if (!chatIds.has(chatId)) {
      orphanMessages += 1;
      continue;
    }
    const held = messagesOf.get(chatId);
    if (held === undefined) messagesOf.set(chatId, [row]);
    else held.push(row);
  }
  const messageIds = new Set(
    messageRows.flatMap((row) => (chatIds.has(str(row['chatId'])) ? [str(row['id'])] : [])),
  );
  const anyMessage = new Set(messageRows.map((row) => str(row['id'])));
  const swipesOf = new Map<string, Row[]>();
  let orphanSwipes = 0;
  for (const row of swipeRows) {
    const messageId = str(row['messageId']);
    if (!messageIds.has(messageId)) {
      // A swipe of an orphaned message is part of that orphan, not one of its own.
      if (!anyMessage.has(messageId)) orphanSwipes += 1;
      continue;
    }
    const held = swipesOf.get(messageId);
    if (held === undefined) swipesOf.set(messageId, [row]);
    else held.push(row);
  }

  /** Every snapshot row by its message, for the chat that holds the message. */
  const snapshotsOf = new Map<string, Row[]>();
  for (const row of tables.snapshots ?? []) {
    const messageId = str(row['messageId']);
    const held = snapshotsOf.get(messageId);
    if (held === undefined) snapshotsOf.set(messageId, [row]);
    else held.push(row);
  }

  const chats: MarinaraChat[] = [];
  const other: MarinaraOtherChat[] = [];
  const rows = [...tables.chats]
    .filter((row) => str(row['id']) !== '')
    .sort((a, b) => compare(str(a['id']), str(b['id'])));
  const seen = new Set<string>();
  for (const row of rows) {
    const id = str(row['id']);
    // Two rows with one id is a store Marinara would refuse to load
    // (`primaryKey`); the first is kept, as its own reader keeps the first.
    if (seen.has(id)) continue;
    seen.add(id);
    const mode = str(row['mode']);
    const name = str(row['name']) || id;
    if (mode !== 'roleplay') {
      other.push({ id, name, mode: mode === '' ? 'unknown' : mode });
      continue;
    }
    chats.push(
      chatOf(
        row,
        messagesOf.get(id) ?? [],
        swipesOf,
        { characterNames, personaNames },
        snapshotsOf,
      ),
    );
  }

  return { chats, other, orphans: { messages: orphanMessages, swipes: orphanSwipes } };
}

interface Names {
  characterNames: ReadonlyMap<string, string>;
  personaNames: ReadonlyMap<string, string>;
}

/** One roleplay chat row, its messages and their swipes. */
function chatOf(
  row: Row,
  rows: readonly Row[],
  swipesOf: ReadonlyMap<string, readonly Row[]>,
  names: Names,
  snapshotsOf: ReadonlyMap<string, readonly Row[]>,
): MarinaraChat {
  const id = str(row['id']);
  const title = str(row['name']) || id;
  const metadata = recordOf(row['metadata']);
  const branchName = str(metadata['branchName']).trim();
  const label = branchName === '' ? title : branchName;
  const members = unique(stringsOf(row['characterIds'])).map((key): ForeignRef => ({
    key,
    name: names.characterNames.get(key) ?? '',
  }));
  const personaId = str(row['personaId']);
  const notes: ImportNote[] = [];

  /**
   * ***Marinara's order***: `(createdAt, id)`, which is `listMessages`'
   * `orderBy(messages.createdAt, messages.id)` (`chats.storage.ts:963`). Both
   * are strings compared as strings — the store's ISO times sort that way, and
   * an id breaks a tie exactly as the store breaks it — so the chat reads in
   * the order the person scrolled it, even where two lines share a moment.
   */
  const ordered = [...rows].sort(
    (a, b) =>
      compare(str(a['createdAt']), str(b['createdAt'])) || compare(str(a['id']), str(b['id'])),
  );

  /**
   * ***The latest conversation start*** — `extra.isConversationStart`. At
   * generation Marinara walks back from the end to the last message carrying
   * it and sends nothing before it (`generate.routes.ts:1299-1307`): *"start a
   * new conversation here"* without leaving the chat. Those earlier lines are
   * still in the chat, and still shown, and never sent — which is what hidden
   * is here, so they are hidden, on the same path `hiddenFromAI` takes.
   * Imported plain, every one of them would be sent again on every turn of a
   * session that had stopped sending them.
   */
  let start = -1;
  for (let i = ordered.length - 1; i >= 0; i--) {
    if (recordOf(ordered[i]?.['extra'])['isConversationStart'] === true) {
      start = i;
      break;
    }
  }

  /**
   * ***What the rolling summary hid*** — the union of its entries'
   * `hiddenMessageIds`. With `hideSummarisedMessages` on, Marinara hides the
   * lines a summary entry covers and records the ones it flipped as that
   * entry's own (`chats.routes.ts:4363-4413`), so a later toggle can restore
   * exactly those. The hide was the summary's, standing in for the lines it
   * replaced; the summary does not come across at this stage
   * (`noteChatState`), so keeping its hide would leave the model with neither
   * the summary nor the story it summarised. These lines come in visible, and
   * a line the person hid by hand — one no entry claims — stays hidden.
   */
  const summaryHid = new Set(
    arrayOf(metadata['summaryEntries']).flatMap((entry) =>
      stringsOf(recordOf(entry)['hiddenMessageIds']),
    ),
  );

  /**
   * ***What the trackers had established, by message and swipe*** —
   * `trackers.ts`. Each snapshot is placed on the line or swipe it names;
   * one naming a swipe the message does not have is counted, not guessed at.
   */
  const chatSnapshots = rows.flatMap((message) => snapshotsOf.get(str(message['id'])) ?? []);
  const states = snapshotStates(chatSnapshots);
  let placed = 0;

  const counts = {
    unknownRole: 0,
    attachments: 0,
    models: 0,
    perCharacterHidden: 0,
    hiddenFromUser: 0,
    rewritten: 0,
    summaryRestored: 0,
    beforeStart: 0,
    startPerCharacter: 0,
  };
  const messages: ChatMessage[] = [];
  for (const [position, message] of ordered.entries()) {
    const role = roleOf(message['role']);
    if (role === undefined) {
      counts.unknownRole += 1;
      continue;
    }
    const extra = recordOf(message['extra']);
    const text = str(message['content']);
    const reasoning = str(extra['thinking']) || undefined;
    const at = parseTimestamp(message['createdAt']);

    if (hasAttachment(extra)) counts.attachments += 1;
    if (str(recordOf(extra['generationInfo'])['model']) !== '') counts.models += 1;
    if (extra['hiddenFromAI'] !== true && stringsOf(extra['hiddenFromAICharacterIds']).length > 0) {
      counts.perCharacterHidden += 1;
    }
    if (extra['hiddenFromUser'] === true) counts.hiddenFromUser += 1;
    if (str(extra['proseGuardianOriginalText']) !== '') counts.rewritten += 1;
    if (stringsOf(extra['conversationStartForCharacterIds']).length > 0) {
      counts.startPerCharacter += 1;
    }

    const foreignId = str(message['id']);
    const bySummary = extra['hiddenFromAI'] === true && summaryHid.has(foreignId);
    if (bySummary) counts.summaryRestored += 1;
    const beforeStart = position < start;
    if (beforeStart) counts.beforeStart += 1;
    const hidden = (extra['hiddenFromAI'] === true && !bySummary) || beforeStart;

    const bySwipe = states.get(foreignId);
    const active = Number(message['activeSwipeIndex'] ?? 0);
    const own = bySwipe?.get(Number.isInteger(active) && active >= 0 ? active : 0);
    if (own !== undefined) placed += 1;
    const line: ChatMessage = {
      role,
      text,
      ...(reasoning === undefined ? {} : { reasoning }),
      at,
      foreignId,
      ...(hidden ? { hidden: true } : {}),
      ...(own === undefined ? {} : { state: own }),
    };
    if (role === 'character') {
      /**
       * *Who spoke*: the row's `characterId`, else the chat's first member —
       * which is Marinara's own answer for a reply with none
       * (`getDisplayName` falls back to `primaryCharName`,
       * `chats.routes.ts:3500`), and the ordinary case of a single chat's
       * greeting written before messages carried a speaker.
       */
      const key = str(message['characterId']) || (members[0]?.key ?? '');
      if (key !== '') {
        line.speaker = { key, name: names.characterNames.get(key) ?? '' };
      }
      const swipes = swipesOfMessage(
        message,
        extra,
        swipesOf.get(line.foreignId) ?? [],
        bySwipe ?? new Map<number, ChatStateValue[]>(),
      );
      if (swipes !== null) {
        placed += swipes.placed;
        line.swipes = swipes.swipes;
        if (swipes.activeSwipe !== undefined) line.activeSwipe = swipes.activeSwipe;
      }
    }
    if (role === 'user') {
      /**
       * *Who the player was*: the persona the line recorded when it was sent
       * (`extra.personaSnapshot`), else the chat's. A person who switched
       * persona mid-chat played those lines as the other one, and the resolver
       * counts lines per persona to pick the session's
       * (`chat/resolve.ts`, `personaCandidates`).
       */
      const snapshot = recordOf(extra['personaSnapshot']);
      const persona = str(snapshot['personaId']) || personaId;
      if (persona !== '') {
        line.persona = {
          key: `${PERSONAS}${persona}`,
          name: str(snapshot['name']) || (names.personaNames.get(persona) ?? ''),
        };
      }
    }
    messages.push(line);
  }

  noteCounts(notes, label, counts);
  noteChatState(notes, label, metadata, counts.summaryRestored);
  const state = trackerSwitches(metadata, label, notes);
  noteSnapshots(notes, label, chatSnapshots, states, placed);

  let earliest: number | null = null;
  for (const message of messages) {
    if (message.at !== null && (earliest === null || message.at < earliest)) earliest = message.at;
  }
  const createdAt = parseTimestamp(row['createdAt']);
  const branchOf = str(metadata['branchParentChatId']).trim();
  /**
   * *A branch whose link did not travel.* Marinara writes `branchName` only
   * when it makes a branch (`chats.routes.ts:3884`), and its profile export
   * deletes `branchParentChatId` from every chat's metadata while keeping
   * `branchName` (`sanitizeProfileTableRows`, `backup.routes.ts:586-600`). So a
   * profile's branches arrive with nothing to join them to their family: each
   * is its own session, with the start it shares with its parent repeated.
   * Rebuilding the family from names and shared prefixes would be a heuristic
   * of its own, deferred; until then the review says what happened.
   */
  if (branchOf === '' && branchName !== '') {
    notes.push({ key: 'import.chat.branchLinkMissing', params: { chat: label }, level: 'info' });
  }

  return {
    chat: { id, name: label, messages, createdAt },
    title,
    ...(branchOf === '' ? {} : { branchOf }),
    members,
    ...(personaId === '' ? {} : { persona: `${PERSONAS}${personaId}` }),
    settings: members.length > 1 ? marinaraGroupSettings(metadata, members) : {},
    metadata,
    earliest: earliest ?? createdAt,
    notes,
    state,
  };
}

/**
 * ***What the snapshots came to*** — how many were carried, how many named a
 * swipe the chat does not have, and how many lock or hidden keys could not be
 * read as a field path. Said per chat, as every Marinara note is.
 */
function noteSnapshots(
  notes: ImportNote[],
  chat: string,
  rows: readonly Row[],
  states: ReadonlyMap<string, ReadonlyMap<number, unknown>>,
  placed: number,
): void {
  let total = 0;
  for (const bySwipe of states.values()) total += bySwipe.size;
  if (placed > 0) {
    notes.push({
      key: 'import.chat.trackersCarried',
      params: { chat, count: placed },
      level: 'info',
    });
  }
  if (total > placed) {
    notes.push({
      key: 'import.chat.trackerSnapshotsUnplaced',
      params: { chat, count: total - placed },
      level: 'warn',
    });
  }
  const unread = unreadKeys(rows);
  if (unread > 0) {
    notes.push({
      key: 'import.chat.trackerKeysNotCarried',
      params: { chat, count: unread },
      level: 'info',
    });
  }
}

/**
 * ***A reply's alternatives*** — [P13 §2.3], and [P13 §0.3]'s rule read from
 * Marinara's side.
 *
 * **`messages.content` is the active swipe's current text; its swipe row is
 * the copy that goes stale.** An edit writes the message row. `setActiveSwipe`
 * copies the message's content and extra onto the *outgoing* swipe row only
 * when switching away (`chats.storage.ts:1527-1556`), so until then the active
 * swipe's row holds whatever it held when it was last switched to — before any
 * edit since. The active swipe is therefore the message's content, reasoning
 * and time; every other swipe is its own row's.
 *
 * - **Which is active**: `activeSwipeIndex`, matched against the rows' own
 *   `index` rather than their position — `removeSwipe` leaves gaps, and the
 *   index is the row's name for itself. An index no row has is left out, and
 *   the builder finds the active swipe by its text, as it does for
 *   SillyTavern's out-of-range `swipe_id`.
 * - **Order**: by `index`, then id — the order Marinara's swipe arrows walk.
 * - **Fewer than two is none.** `createMessage` writes swipe 0 for every
 *   message (`chats.storage.ts:1065`), so one row is the message itself.
 */
function swipesOfMessage(
  message: Row,
  extra: Readonly<Record<string, unknown>>,
  rows: readonly Row[],
  /** The message's snapshots by swipe index — each inactive swipe takes its own. */
  states: ReadonlyMap<number, ChatStateValue[]>,
): { swipes: ChatSwipe[]; activeSwipe?: number; placed: number } | null {
  if (rows.length < 2) return null;
  let placed = 0;
  const ordered = [...rows].sort(
    (a, b) => indexOf(a) - indexOf(b) || compare(str(a['id']), str(b['id'])),
  );
  const activeIndex = message['activeSwipeIndex'];
  const active = ordered.findIndex((row) => indexOf(row) === Number(activeIndex ?? 0));
  const text = str(message['content']);
  const reasoning = str(extra['thinking']);
  const at = parseTimestamp(message['createdAt']);

  const swipes = ordered.map((row, position): ChatSwipe => {
    if (position === active) {
      return { text, ...(reasoning === '' ? {} : { reasoning }), at };
    }
    const own = str(recordOf(row['extra'])['thinking']);
    // *By the row's own index*, which is the snapshot's `swipeIndex` — the
    // name a swipe has for itself, gaps and all.
    const state = states.get(indexOf(row));
    if (state !== undefined) placed += 1;
    return {
      text: str(row['content']),
      ...(own === '' ? {} : { reasoning: own }),
      at: parseTimestamp(row['createdAt']),
      ...(state === undefined ? {} : { state }),
    };
  });
  return active === -1 ? { swipes, placed } : { swipes, activeSwipe: active, placed };
}

/** A swipe row's `index`, or past the end when it has none a number can read. */
function indexOf(row: Row): number {
  const index = Number(row['index']);
  return Number.isFinite(index) ? index : Number.MAX_SAFE_INTEGER;
}

/**
 * ***A group's settings*** — [P13 §2.6]'s three Marinara rows and its muted
 * members, read as Marinara reads them at generation, which is what the chat
 * actually did:
 *
 * - **`groupChatMode`** → `dispatch`: `individual` is `per-actor`, and
 *   *anything else is `merged`* — `resolveGroupGenerationMode` answers
 *   `configuredMode === "individual" ? "individual" : "merged"`
 *   (`generate-route-utils.ts:1048`). So an absent mode is written as
 *   `merged`, not left to Scene's default: absent *means* merged there, and a
 *   group that played merged in Marinara must not start playing per-actor here
 *   because the row never said the word.
 * - **`groupResponseOrder`** → `policy`: `sequential` is `list`, `manual` is
 *   `manual`, `smart` is `smart`, and absent is `sequential`
 *   (`generate.routes.ts:3527`, `?? "sequential"`). A value outside the three
 *   is what Marinara's own branch at `:5555` falls through to sequential for.
 * - **`groupSpeakerNamesInHistory`** → `namesInHistory`: `groups` only for an
 *   **individual** chat whose flag is exactly `true`, else `never` — Marinara
 *   prefixes a speaker's name in history only when the chat has more than one
 *   member, is not a game, is in `individual` mode, and (for a roleplay) the
 *   flag is `true` (`shouldPrefixGroupHistorySpeakers`, `:1862-1866`). A
 *   merged group never had the prefixes, whatever the flag says, and must not
 *   gain them here.
 * - **`inactiveCharacterIds`** → `muted`, kept only for members of the chat —
 *   Marinara filters the list to them on every write (`chats.routes.ts:1129`),
 *   so a stale id mutes nobody there, and must not here.
 *
 * *Exported for the one-file door*, which reads the same metadata off a
 * Marinara JSONL export's header (`chat_metadata.marinara_metadata`,
 * `sillytavern/chat.ts`), so the two paths hold one opinion about it.
 */
export function marinaraGroupSettings(
  metadata: Readonly<Record<string, unknown>>,
  members: readonly ForeignRef[],
): ChatSettings {
  const keys = new Set(members.map((member) => member.key));
  const order = metadata['groupResponseOrder'];
  const muted = unique(stringsOf(metadata['inactiveCharacterIds'])).filter((key) => keys.has(key));
  return {
    dispatch: metadata['groupChatMode'] === 'individual' ? 'per-actor' : 'merged',
    speakers: {
      policy: order === 'smart' ? 'smart' : order === 'manual' ? 'manual' : 'list',
      namesInHistory:
        metadata['groupChatMode'] === 'individual' &&
        metadata['groupSpeakerNamesInHistory'] === true
          ? 'groups'
          : 'never',
    },
    ...(muted.length === 0 ? {} : { muted }),
  };
}

/** Marinara's four roles (`db/schema/chats.ts`): `system` and `narrator` are both narration. */
function roleOf(value: unknown): ChatMessage['role'] | undefined {
  switch (value) {
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
 * ***What the lines had that a session does not keep***, each a count and a
 * note naming the chat — [P13 §2.6]'s *"everything else is a note, never
 * silence"*.
 */
function noteCounts(
  notes: ImportNote[],
  chat: string,
  counts: {
    unknownRole: number;
    attachments: number;
    models: number;
    perCharacterHidden: number;
    hiddenFromUser: number;
    rewritten: number;
    beforeStart: number;
    startPerCharacter: number;
  },
): void {
  /** A role outside Marinara's four is a store edited by hand, or a newer Marinara. */
  if (counts.unknownRole > 0) {
    notes.push({
      key: 'import.chat.roleUnknown',
      params: { chat, count: counts.unknownRole },
      level: 'warn',
    });
  }
  /** Attachments are rows and files of their own; the message holds a reference. */
  if (counts.attachments > 0) {
    notes.push({
      key: 'import.chat.attachmentsNotCarried',
      params: { chat, count: counts.attachments },
      level: 'warn',
    });
  }
  /** *"A `TurnRequest` built from three of its fields is a fabrication of the other twenty."* */
  if (counts.models > 0) {
    notes.push({
      key: 'import.chat.modelsNotCarried',
      params: { chat, count: counts.models },
      level: 'info',
    });
  }
  /**
   * *Hidden from some characters and not others* — Marinara's
   * `hiddenFromAICharacterIds` ([P13 §0.5]). A turn here is hidden or not,
   * for every speaker, so these lines are shown to all of them, and the note
   * says so because it changes what some character's call is sent.
   */
  if (counts.perCharacterHidden > 0) {
    notes.push({
      key: 'import.chat.hiddenPerCharacter',
      params: { chat, count: counts.perCharacterHidden },
      level: 'warn',
    });
  }
  /**
   * *Sent to the model, and not shown to the person* — the reverse of hidden.
   * A transcript here shows every line it sends, so these are shown.
   */
  if (counts.hiddenFromUser > 0) {
    notes.push({
      key: 'import.chat.hiddenFromUserShown',
      params: { chat, count: counts.hiddenFromUser },
      level: 'info',
    });
  }
  /**
   * *The prose guardian's rewrites* — [P13 §2.6]: *"nothing to carry: the
   * imported text is the edited one, and the original is noted"*.
   */
  if (counts.rewritten > 0) {
    notes.push({
      key: 'import.chat.rewriteOriginalsNotCarried',
      params: { chat, count: counts.rewritten },
      level: 'info',
    });
  }
  /**
   * *Before the latest conversation start* — hidden, as Marinara never sent
   * them (see `chatOf`). Said, because a hidden line reads differently in a
   * transcript than a line that was simply there.
   */
  if (counts.beforeStart > 0) {
    notes.push({
      key: 'import.chat.conversationStartHidden',
      params: { chat, count: counts.beforeStart },
      level: 'info',
    });
  }
  /**
   * *A conversation start for some characters and not others* —
   * `conversationStartForCharacterIds`, which scopes what one character's call
   * is sent (`prompt-message-scope.ts:281`). A start here is for everyone or
   * no one, so these are not starts at all, and the note says so for the same
   * reason `hiddenPerCharacter` does.
   */
  if (counts.startPerCharacter > 0) {
    notes.push({
      key: 'import.chat.conversationStartPerCharacter',
      params: { chat, count: counts.startPerCharacter },
      level: 'warn',
    });
  }
}

/**
 * ***What the chat's metadata keeps that this stage does not bring*** — the
 * rolling summary ([P13 §2.6]'s *"Marinara rolling summaries"*, a note).
 * ~~And the agents: switches, trackers and the secret plot, which wait on
 * [P13.5a]'s channels.~~ The trackers' switches came at [P13.5a]
 * (`trackers.ts`, which also notes the agents that are still to come).
 */
function noteChatState(
  notes: ImportNote[],
  chat: string,
  metadata: Readonly<Record<string, unknown>>,
  summaryRestored: number,
): void {
  const entries = arrayOf(metadata['summaryEntries']);
  if (str(metadata['summary']).trim() !== '' || entries.length > 0) {
    notes.push({ key: 'import.chat.summaryNotCarried', params: { chat }, level: 'info' });
  }
  /** The lines the summary had hidden, shown again (see `chatOf`) — counted. */
  if (summaryRestored > 0) {
    notes.push({
      key: 'import.chat.summaryHiddenRestored',
      params: { chat, count: summaryRestored },
      level: 'info',
    });
  }
  // The agents' switches are `trackers.ts`'s now ([P13.5a]), and so is the
  // note about the agents that are not trackers.
}

/** Marinara's `attachments`, and the older single image a message could hold. */
function hasAttachment(extra: Readonly<Record<string, unknown>>): boolean {
  const attachments = extra['attachments'];
  return (Array.isArray(attachments) && attachments.length > 0) || str(extra['image']) !== '';
}

// ---------------------------------------------------------------------------
// Reading a column that may be JSON text
// ---------------------------------------------------------------------------

/**
 * A column the store keeps as JSON text and an API snapshot as the value — see
 * the module header. Text that will not parse is nothing, which costs that
 * column rather than the chat.
 */
function jsonOf(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return undefined;
  }
}

function recordOf(value: unknown): Readonly<Record<string, unknown>> {
  const parsed = jsonOf(value);
  return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
    ? (parsed as Record<string, unknown>)
    : {};
}

function arrayOf(value: unknown): unknown[] {
  const parsed = jsonOf(value);
  return Array.isArray(parsed) ? parsed : [];
}

/** The first row under each id; a row with no id is kept, as nothing names it twice. */
function firstById(rows: readonly Row[]): Row[] {
  const seen = new Set<string>();
  return rows.filter((row) => {
    const id = str(row['id']);
    if (id === '') return true;
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}

function stringsOf(value: unknown): string[] {
  const parsed = jsonOf(value);
  return Array.isArray(parsed)
    ? parsed.filter((entry): entry is string => typeof entry === 'string' && entry !== '')
    : [];
}

function namesOf(rows: readonly Row[], nameOf: (row: Row) => string): Map<string, string> {
  const names = new Map<string, string>();
  for (const row of rows) {
    const id = str(row['id']);
    const name = nameOf(row);
    if (id !== '' && name !== '' && !names.has(id)) names.set(id, name);
  }
  return names;
}

/** Ordinal string order — the store's, and the same on every machine. */
function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function str(value: unknown): string {
  return typeof value === 'string' ? value : typeof value === 'number' ? String(value) : '';
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)];
}
