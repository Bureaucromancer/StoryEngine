// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import type { ImportNote } from '@storyengine/shared';

import type { ChatSettings } from '../chat/types.js';
import { parsed, refused, type ParseOutcome } from '../parse.js';
import { SPEAKER_BY_NAME } from './chat.js';

/**
 * ***SillyTavern's families and groups*** —
 * [P13.9](../../../../../docs/design/workplan/30-p13-scene-and-session-import.md),
 * [P13 §0.1](../../../../../docs/design/workplan/30-p13-scene-and-session-import.md),
 * [P13 §2.5](../../../../../docs/design/workplan/30-p13-scene-and-session-import.md),
 * [P13 §2.6](../../../../../docs/design/workplan/30-p13-scene-and-session-import.md).
 *
 * **What one file cannot say about itself.** The parser (`chat.ts`) reads a chat
 * file and stops at its edges: `main_chat` is a name, and which file that is —
 * and whether it is here at all — is a question about the folder. A group
 * chat's roster, reply strategy and muted members are not in the chat either;
 * they are in `groups/<id>.json`. This module answers both, over the whole set
 * of files a sweep holds, and hands the session pass (`chat-sessions.ts`) a
 * plan: which chats are one family, in what order, who their group is.
 *
 * ***Plans, not chats.*** Grouping reads each chat's header and first times, and
 * never holds a family's messages: the pass reads every chat once to learn its
 * heading, lets it go, and reads a family's files again when it builds that
 * family. A SillyTavern folder's chats are most of its bytes, and a pass that
 * held them all to group them would hold the whole tree to write one session.
 * The second read is the cost of that, paid in I/O rather than memory, and it
 * is the same trade the pass already makes by reading nothing until the cards
 * are written.
 *
 * **Pure**: headings and group files in, plans and notes out.
 */

/**
 * ***What grouping needs to know about one chat file***, and nothing more — so
 * the pass can drop the chat itself once it has this.
 *
 * - **`path`** is the chat's identity ([P13 §0.2]): `chats/<card>/<name>.jsonl`,
 *   `group chats/<id>.jsonl`, or a bare file name for an upload.
 * - **`name`** is the file's name without `.jsonl` — the thing `main_chat` names,
 *   and a group's `chats` list.
 * - **`mainChat`**: the header's `chat_metadata.main_chat`, raw.
 * - **`group`**: the parser's `meta.group`.
 * - **`earliest`**: the earliest readable time of any of its messages, else the
 *   chat's own creation, else null — the creation order the family is sorted by
 *   (see {@link familiesOf}).
 */
export interface ChatHeading {
  path: string;
  name: string;
  mainChat?: string;
  group: boolean;
  earliest: number | null;
}

/**
 * ***`groups/<id>.json`, read*** — the shape `endpoints/groups.js` writes
 * (`/create`, `:156-188`), reduced to what [P13 §2.5] and §2.6 map.
 *
 * - **`members`**: the members' card files, in the group's order — which is
 *   the order `list` answers in, and the cast's.
 * - **`muted`**: `disabled_members` that are also members. SillyTavern keeps a
 *   member's name in the list when the member is removed, and reads it only
 *   through `members` (`enabledMembers`, `group-chats.js:1003`), so a stale
 *   entry mutes nobody there and must not mute anybody here.
 * - **`speakers`**: `activation_strategy` and `allow_self_responses` onto
 *   [P13 §1.2]'s fields, only as far as the file said them.
 * - **`generationMode`**: `generation_mode`, named, or null when the file did
 *   not say — recorded in a note and nothing else ([P13 §2.6]).
 * - **`chats`**: `chats`, the group's chat file names, plus `chat_id` (the one
 *   open) if the list somehow lacks it.
 * - **`legacyMetadata`**: each chat's `chat_metadata` as a group file written
 *   before SillyTavern moved it into the chats kept it, keyed by chat name —
 *   empty for a file that has been migrated, which is nearly every one
 *   ({@link parseSillyTavernGroup}).
 * - **`notes`**: what did not map — an activation strategy this build has no
 *   arm for — and which older shape the file was read in.
 */
export interface SillyTavernGroup {
  path: string;
  id: string;
  name: string;
  members: string[];
  muted: string[];
  speakers: NonNullable<ChatSettings['speakers']>;
  generationMode: 'swap' | 'append' | 'append-disabled' | null;
  chats: string[];
  legacyMetadata: Readonly<Record<string, Readonly<Record<string, unknown>>>>;
  notes: ImportNote[];
}

/**
 * `group_activation_strategy` (`group-chats.js:122`) onto [P13 §1.3]'s arms —
 * the table [P13 §2.6] gives, and the order [06 §7.2] took the taxonomy in.
 */
const STRATEGIES: Readonly<Record<number, NonNullable<ChatSettings['speakers']>['policy']>> = {
  0: 'natural',
  1: 'list',
  2: 'manual',
  3: 'pooled',
};

/** `group_generation_mode` (`group-chats.js:129`). */
const GENERATION_MODES: Readonly<Record<number, NonNullable<SillyTavernGroup['generationMode']>>> =
  {
    0: 'swap',
    1: 'append',
    2: 'append-disabled',
  };

const UTF8 = new TextDecoder('utf-8');

/**
 * Reads one `groups/<id>.json`. Refused, never thrown: not JSON, or not an
 * object, is `unreadable`; an object with no `members` list is `missing-field`,
 * since a group with no roster is not a group anybody made in SillyTavern.
 *
 * *The id is the file's name*, not the `id` field, because that is what
 * SillyTavern keys it by on disk (`sanitize(`${id}.json`)`) and what a chat's
 * `group chats/<id>.jsonl` path agrees with; the field is the fallback only for
 * a name that is somehow empty.
 */
export function parseSillyTavernGroup(
  source: Uint8Array | string,
  path: string,
): ParseOutcome<SillyTavernGroup> {
  let value: unknown;
  try {
    value = JSON.parse(typeof source === 'string' ? source : UTF8.decode(source));
  } catch {
    return refused('unreadable');
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return refused('unreadable');
  }
  const row = value as Record<string, unknown>;
  if (!Array.isArray(row['members'])) return refused('missing-field', 'members');

  const file = (path.split('/').at(-1) ?? path).replace(/\.json$/i, '');
  const id = file === '' ? str(row['id']) : file;
  const name = str(row['name']) || id;
  const notes: ImportNote[] = [];

  /**
   * ***A group file from before `chat_id`*** — one SillyTavern has never saved
   * since. Such a group had one chat, named by the group's id, and its
   * `members` were character *names*, not card files; `getGroups` converts
   * both in memory when it loads the list (`group-chats.js:777-784`), and the
   * file keeps the old shape on disk until the group is next saved. Read as
   * written it would be a group with no chats and a roster of cards nobody
   * has, so it is read as `getGroups` reads it: the one chat, and each member
   * as a {@link SPEAKER_BY_NAME} key, which the resolver matches by name —
   * `getGroups`' own `characters.find(y => y.name == x)`. A name that matches
   * nothing is what SillyTavern drops (`.filter(x => x)`); here it resolves to
   * nobody and the resolver's usual note says so. `disabled_members` is read
   * the same way, so a mute still names a member.
   */
  const legacy = row['chat_id'] === undefined || row['chat_id'] === null;
  const asMember = (entry: string): string => (legacy ? `${SPEAKER_BY_NAME}${entry}` : entry);
  const members = unique(strings(row['members']).map(asMember));
  const muted = unique(strings(row['disabled_members']).map(asMember)).filter((key) =>
    members.includes(key),
  );
  if (legacy) {
    notes.push({ key: 'import.chat.groupLegacyFormat', params: { group: name }, level: 'info' });
  }

  const speakers: NonNullable<ChatSettings['speakers']> = {};
  const strategy = row['activation_strategy'];
  if (strategy !== undefined && strategy !== null) {
    const policy = typeof strategy === 'number' ? STRATEGIES[strategy] : undefined;
    if (policy === undefined) {
      /**
       * *A strategy with no arm here*, from a SillyTavern newer than the pin or
       * an extension: said, and the session plays Scene's default rather than a
       * guess at what the number meant.
       */
      notes.push({
        key: 'import.chat.groupStrategyUnknown',
        params: { group: name, strategy: JSON.stringify(strategy) },
        level: 'warn',
      });
    } else {
      speakers.policy = policy;
    }
  }
  if (row['allow_self_responses'] !== undefined) {
    // `!!` is what `/create` stores (`groups.js:167`), so it is how it is read.
    speakers.allowSelfResponses = Boolean(row['allow_self_responses']);
  }

  const mode = row['generation_mode'];
  const open = legacy ? id : str(row['chat_id']);
  const chats = legacy ? [id] : strings(row['chats']);
  if (open !== '' && !chats.includes(open)) chats.push(open);

  /**
   * ***Chat metadata kept in the group file*** — where SillyTavern put a group
   * chat's `chat_metadata` (its `main_chat`, author's note, persona lock and
   * lorebook) until it moved each into its chat's header: `chat_metadata` for
   * the open chat and `past_metadata[chatId]` for the rest, which its one-time
   * migration folds into exactly this map (`migrateGroupChatsMetadataFormat`,
   * `groups.js:58-61`) before writing each into a headerless chat. A tree
   * copied from an install that never ran the migration still has them here,
   * and a pass that read only the chats would lose every group branch's
   * parent — so they are kept, for the session pass to read a headerless chat
   * by ({@link legacyMetadataOf}), and the note says the file was that old.
   */
  const legacyMetadata: Record<string, Readonly<Record<string, unknown>>> = {};
  if (Object.hasOwn(row, 'chat_metadata') || Object.hasOwn(row, 'past_metadata')) {
    const past = row['past_metadata'];
    if (isRecord(past)) {
      for (const [chat, metadata] of Object.entries(past)) {
        if (isRecord(metadata)) legacyMetadata[chat] = metadata;
      }
    }
    if (open !== '') {
      const current = row['chat_metadata'];
      legacyMetadata[open] = isRecord(current) ? current : {};
    }
    notes.push({ key: 'import.chat.groupLegacyMetadata', params: { group: name }, level: 'info' });
  }

  return parsed({
    path,
    id,
    name,
    members,
    muted,
    speakers,
    generationMode: typeof mode === 'number' ? (GENERATION_MODES[mode] ?? null) : null,
    chats: unique(chats),
    legacyMetadata,
    notes,
  });
}

/**
 * ***The metadata a group file kept for one of its chats***, if any — for a
 * chat under `group chats/` whose file has no header of its own, which is how
 * the migration left the chats it had not reached. The first group by path
 * that holds an entry answers, the same tie-break {@link familiesOf} gives a
 * chat two groups list.
 */
export function legacyMetadataOf(
  groups: readonly SillyTavernGroup[],
  path: string,
): Readonly<Record<string, unknown>> | undefined {
  if (folderOf(path) !== GROUP_CHATS) return undefined;
  const name = (path.split('/').at(-1) ?? path).replace(/\.jsonl$/i, '');
  for (const group of [...groups].sort((a, b) => (a.path < b.path ? -1 : 1))) {
    const found = group.legacyMetadata[name];
    if (found !== undefined) return found;
  }
  return undefined;
}

/**
 * ***One family, as the pass will build it*** — [P13 §2.5]'s *"a chat and every
 * chat that points back to it"*.
 *
 * - **`key`** is the root chat's path, which is `ChatFamily.key` and so hashed
 *   into every turn id ([P13 §2.4]).
 * - **`chats`**: root first, then the rest in creation order, each with the
 *   path of the chat it names as its parent — present in the family, or, for a
 *   root whose `main_chat` names a chat that is not here, the path that chat
 *   would have had, so the builder's `parentMissing` says which.
 * - **`group`**: the group whose `chats` list holds this family, when its file
 *   came too.
 * - **`notes`**: what grouping had to decide — a cycle broken, a chat that
 *   named itself.
 */
export interface FamilyPlan {
  key: string;
  chats: { path: string; parentId?: string }[];
  group: SillyTavernGroup | null;
  notes: ImportNote[];
}

/**
 * ***A chat held back*** because the family it belongs to hangs from a chat
 * that is in the source and was not read — see {@link familiesOf}. `parent` is
 * the name of that chat, for the row that says so.
 */
export interface HeldBack {
  path: string;
  parent: string;
}

/** {@link familiesOf}'s answer: the families to build, and the chats that wait. */
export interface Families {
  plans: FamilyPlan[];
  heldBack: HeldBack[];
}

/**
 * ***A folder's chats, grouped into families*** — [P13 §0.1], [P13 §2.5].
 *
 * **A chat's parent is the chat its `main_chat` names, in the same folder.**
 * Branches (`createBranch`, `bookmarks.js:186`) and checkpoints
 * (`createNewBookmark`, `:253`) both write it, as the *name* of the chat they
 * were made from — the current chat's file name for a branch, the character's
 * or group's current chat for a checkpoint — and both write the new file beside
 * it: under the same card's folder, or into `group chats/` and onto the same
 * group's `chats` list (`saveGroupBookmarkChat`, `group-chats.js:2358`). So a
 * name is looked for among the files of the folder the chat is in, and a
 * branch of a branch names the branch and chains.
 *
 * ***The older checkpoint rule.*** A checkpoint made before checkpoints wrote
 * `main_chat` has none, and SillyTavern worked its parent out from the chat's
 * own name when it was opened (`getMainChatName`, `bookmarks.js:110-127`): the
 * text before the last `Checkpoint #`, trimmed. That is transcribed, for single
 * chats only — the source's own comment says groups had no checkpoints before
 * metadata — with one allowance: today's names end `<main> - Checkpoint #N`, so
 * the rule's own answer keeps a trailing ` -` that no file is called, and one
 * trailing dash is dropped when the name with it names nothing. ***Only a match
 * counts.*** A name that merely contains the words is a chat somebody named, not
 * a stated parent, so a derivation that finds no chat is no parent and no note.
 *
 * ***A parent that is not here*** makes the chat a root of its own family
 * ([P13 §2.5]), keeping the pointer so the builder's `parentMissing` fires.
 *
 * ***A parent that is here and was not read is not missing.*** `unread` is the
 * source's chats that were named and never parsed — over a browser upload's
 * limit, or refused. Building a branch of one as its own root would give its
 * turns ids hashed under its own path ([P13 §2.4]); when the parent arrives
 * later the same lines come in again under the parent's key, a second copy
 * rather than `unchanged`. So such a chat, and every chat below it, is
 * {@link HeldBack held back} — not imported now, rather than imported as
 * something it is not — and its row says what to do instead. A *derived*
 * parent (the older checkpoint rule) is not held for: it is a guess that only
 * counts when it names a chat that is present.
 *
 * ***A chat that names itself*** has no parent: it is a root, with a note of its
 * own, since calling it a loop would name two chats where there is one.
 *
 * ***A cycle*** — `a` names `b`, `b` names `a`, or a longer loop — is nothing
 * SillyTavern writes, and is what a hand-renamed folder produces. It is
 * broken at the member first in creation order, which becomes the root: the
 * rule that gives the same answer whichever order the files were listed in, and
 * the member most likely to be the original. Said with a note naming the chat
 * it named, which is in the loop whatever its length.
 *
 * ***Order***, which ids depend on: the root first, then every other chat by
 * creation — its earliest message's time, then its depth below the root, then
 * its path. A node shared by two branches takes its time from whichever is
 * visited first (`ChatFamily.chats`), so the order has to be one the source
 * listing cannot move. *Creation by earliest message is mostly a tie* — a
 * branch copies its parent's opening lines, send times and all — so depth and
 * path are what usually decide, and that is fine: both are fixed, copied lines
 * carry the same times whichever copy is visited, and depth puts a branch
 * after the branch it was made from, which it cannot have preceded. (Path
 * alone would not: `… - Branch #1 - Branch #1` sorts before `… - Branch #1`,
 * since a space is before a dot.)
 */
export function familiesOf(
  headings: readonly ChatHeading[],
  groups: readonly SillyTavernGroup[],
  unread: ReadonlySet<string> = new Set(),
): Families {
  const byPath = new Map(headings.map((heading) => [heading.path, heading]));
  const inFolder = new Map<string, Map<string, string>>();
  for (const heading of headings) {
    const folder = folderOf(heading.path);
    const names = inFolder.get(folder) ?? new Map<string, string>();
    // Two files one name apart only by case would be two chats; `main_chat` is
    // an exact name, so the first listed by path keeps it, for a stable answer.
    const held = names.get(heading.name);
    if (held === undefined || heading.path < held) names.set(heading.name, heading.path);
    inFolder.set(folder, names);
  }
  const lookup = (heading: ChatHeading, name: string): string | undefined =>
    inFolder.get(folderOf(heading.path))?.get(name);

  /**
   * The parent each chat names: present (`parent`), missing (`missing`), or in
   * the source and unread (`waiting`, by the name it was named by).
   */
  const parent = new Map<string, string>();
  const missing = new Map<string, string>();
  const waiting = new Map<string, string>();
  const selfNotes = new Map<string, ImportNote>();
  for (const heading of headings) {
    const stated = heading.mainChat?.trim() ?? '';
    if (stated !== '') {
      const found = lookup(heading, stated);
      const would = siblingPath(heading.path, stated);
      if (found === heading.path) {
        selfNotes.set(heading.path, {
          key: 'import.chat.familySelfParent',
          params: { chat: heading.name },
          level: 'warn',
        });
      } else if (found !== undefined) parent.set(heading.path, found);
      else if (unread.has(would)) waiting.set(heading.path, stated);
      else missing.set(heading.path, would);
      continue;
    }
    if (heading.group) continue;
    const derived = legacyCheckpointParent(heading.name, (name) => lookup(heading, name));
    if (derived !== undefined && derived !== heading.path) parent.set(heading.path, derived);
  }

  const order = (one: string, two: string): number => {
    const a = byPath.get(one)?.earliest ?? null;
    const b = byPath.get(two)?.earliest ?? null;
    if (a !== b) {
      if (a === null) return 1;
      if (b === null) return -1;
      return a - b;
    }
    return one < two ? -1 : one > two ? 1 : 0;
  };

  // -------------------------------------------------------------------------
  // Cycles — broken at the earliest member, each with a note
  // -------------------------------------------------------------------------

  const cycleNotes = new Map<string, ImportNote[]>();
  for (const start of [...parent.keys()].sort(order)) {
    const seen: string[] = [];
    let at: string | undefined = start;
    while (at !== undefined && !seen.includes(at)) {
      seen.push(at);
      at = parent.get(at);
    }
    if (at === undefined) continue;
    const loop = seen.slice(seen.indexOf(at));
    const first = [...loop].sort(order)[0];
    if (first === undefined) continue;
    const was = parent.get(first);
    parent.delete(first);
    const note: ImportNote = {
      key: 'import.chat.familyCycle',
      params: {
        chat: byPath.get(first)?.name ?? first,
        parent: byPath.get(was ?? '')?.name ?? was ?? first,
      },
      level: 'warn',
    };
    cycleNotes.set(first, [...(cycleNotes.get(first) ?? []), note]);
  }

  // -------------------------------------------------------------------------
  // Families — each chat to its root, the root's key the family's
  // -------------------------------------------------------------------------

  const rootOf = (path: string): string => {
    let at = path;
    for (let next = parent.get(at); next !== undefined; next = parent.get(at)) at = next;
    return at;
  };
  const members = new Map<string, string[]>();
  const heldBack: HeldBack[] = [];
  for (const heading of headings) {
    const root = rootOf(heading.path);
    const held = waiting.get(root);
    if (held !== undefined) {
      heldBack.push({ path: heading.path, parent: held });
      continue;
    }
    members.set(root, [...(members.get(root) ?? []), heading.path]);
  }
  heldBack.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));

  const groupOf = new Map<string, SillyTavernGroup>();
  for (const group of [...groups].sort((a, b) => (a.path < b.path ? -1 : 1))) {
    for (const chat of group.chats) {
      if (!groupOf.has(chat)) groupOf.set(chat, group);
    }
  }

  const depthOf = (path: string): number => {
    let depth = 0;
    for (let next = parent.get(path); next !== undefined; next = parent.get(next)) depth += 1;
    return depth;
  };
  const creation = (one: string, two: string): number => {
    const a = byPath.get(one)?.earliest ?? null;
    const b = byPath.get(two)?.earliest ?? null;
    if (a === b) {
      const deeper = depthOf(one) - depthOf(two);
      if (deeper !== 0) return deeper;
    }
    return order(one, two);
  };

  const plans: FamilyPlan[] = [];
  for (const root of [...members.keys()].sort()) {
    const paths = members.get(root) ?? [];
    const rest = paths.filter((path) => path !== root).sort(creation);
    const chats = [root, ...rest].map((path) => {
      const parentId = parent.get(path) ?? missing.get(path);
      return parentId === undefined ? { path } : { path, parentId };
    });
    /**
     * *The group is found by the family's chats, root first*, in the group
     * files' `chats` lists — only under `group chats/`, where a group's chats
     * live: a single chat's name can coincide with a group chat's, and is not
     * one.
     */
    const group =
      folderOf(root) === GROUP_CHATS
        ? ([root, ...rest]
            .map((path) => groupOf.get(byPath.get(path)?.name ?? ''))
            .find((found) => found !== undefined) ?? null)
        : null;
    plans.push({
      key: root,
      chats,
      group,
      notes: paths.flatMap((path) => {
        const self = selfNotes.get(path);
        return [...(self === undefined ? [] : [self]), ...(cycleNotes.get(path) ?? [])];
      }),
    });
  }
  return { plans, heldBack };
}

/** The folder SillyTavern writes every group chat into (`endpoints/chats.js:803`). */
export const GROUP_CHATS = 'group chats';

/**
 * ***`getMainChatName`'s older arm*** (`bookmarks.js:118-122`): the text before
 * the last `Checkpoint #` in the chat's name, trimmed — and, when that names
 * nothing, the same with one trailing `-` dropped (see {@link familiesOf}).
 * Undefined when the name has no token, or no chat answers to what it gives.
 */
function legacyCheckpointParent(
  name: string,
  lookup: (name: string) => string | undefined,
): string | undefined {
  const token = name.lastIndexOf(CHECKPOINT_TOKEN);
  if (token === -1) return undefined;
  const stated = name.slice(0, token).trim();
  if (stated === '') return undefined;
  return lookup(stated) ?? lookup(stated.replace(/\s*-$/, '').trim());
}

/** `bookmarkNameToken` (`bookmarks.js:46`). */
const CHECKPOINT_TOKEN = 'Checkpoint #';

/** `chats/Vera/a.jsonl` → `chats/Vera`; a bare name → `''`. */
function folderOf(path: string): string {
  const slash = path.lastIndexOf('/');
  return slash === -1 ? '' : path.slice(0, slash);
}

/** The path a chat called `name` would have beside `path`. */
export function siblingPath(path: string, name: string): string {
  const folder = folderOf(path);
  return folder === '' ? `${name}.jsonl` : `${folder}/${name}.jsonl`;
}

function str(value: unknown): string {
  return typeof value === 'string' ? value : typeof value === 'number' ? String(value) : '';
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.map(str).filter((entry) => entry !== '') : [];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)];
}
