// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import {
  ACTOR_SCHEMA,
  LOREBOOK_SCHEMA,
  type ImportItemReport,
  type ImportNote,
} from '@storyengine/shared';

import { ownerKey } from '../index-db/ingest.js';
import { objectsNamed } from '../index-db/query.js';
import { turnsNotHeld } from '../index-db/sessions.js';
import type { LibraryContext } from '../library.js';
import { CHAT_IMPORT_MODE_ID } from '../mode-registry.js';
import { importSession } from '../sessions/import.js';
import type { SessionContext } from '../sessions/store.js';
import { userOwner } from '../storage/layout.js';
import { buildSession } from './chat/build.js';
import { readableTime } from './chat/ids.js';
import {
  resolveChat,
  type ChatHints,
  type ChatLibrary,
  type ChatLibraryKind,
} from './chat/resolve.js';
import type { ChatFamily, ChatMessage, ChatSettings, ForeignRef } from './chat/types.js';
import { priorImportRef } from './identity.js';
import {
  marinaraGroupSettings,
  MARINARA_CHATS_FORMAT,
  parseMarinaraChats,
  type MarinaraTables,
} from './marinara/chat.js';
import { MARINARA_CHAT_SOURCE, marinaraFamilies } from './marinara/families.js';
import {
  parseSillyTavernChat,
  SILLYTAVERN_GROUP_FORMAT,
  SPEAKER_BY_NAME,
  type SillyTavernChat,
  type SillyTavernChatMeta,
} from './sillytavern/chat.js';
import {
  familiesOf,
  legacyMetadataOf,
  parseSillyTavernGroup,
  siblingPath,
  type ChatHeading,
  type SillyTavernGroup,
} from './sillytavern/families.js';
import type { FileSource, ImportCandidate } from './source.js';

/**
 * ***The doors a chat comes in by, and the one path they share*** —
 * [P13.8](../../../../docs/design/workplan/30-p13-scene-and-session-import.md),
 * [P13 §2.1](../../../../docs/design/workplan/30-p13-scene-and-session-import.md).
 *
 * §2.1 names four ways in — a folder sweep, a zip, a Marinara profile, one
 * uploaded `.jsonl` — and one way out: *foreign → `SessionExport` →
 * `importSession`*. This is the middle of that sentence for SillyTavern's chat
 * file, and every door calls it rather than doing it again:
 *
 * 1. **Parse** (`sillytavern/chat.ts`, P13.7) — the bytes into a chat, what its
 *    header says, and what was lost reading it.
 * 2. **Resolve** (`chat/resolve.ts`) — the chat's names against this account's
 *    library, through {@link libraryLookup}.
 * 3. **Build** (`chat/build.ts`, P13.6) — one family into one session document.
 * 4. **Load** (`sessions/import.ts`) — the document into a new session, by the
 *    same reader that loads another install's export, which is §2.1's whole
 *    argument: a second writer of sessions would be a second opinion about what
 *    a valid one is.
 *
 * ***One report per file seen***, in the review's own vocabulary, so a sweep of
 * cards and chats reads as one list: `converted` with the new session's id and
 * everything the four steps noted; `unchanged` when a session here already
 * holds every turn of the family; `recorded` when one holds its beginning and
 * the source has grown since; `unrecognised` with the reason when the file will
 * not read.
 * One chat that will not load is one row, and the sweep goes on around it —
 * the poisoned-file rule ([21 §4.1.1]) applied to conversations.
 *
 * ***A family is one session*** ([P13 §2.5], [P13.9]). A sweep groups a
 * character folder's chats — and `group chats/`, by each group's list — by
 * `main_chat` into families (`sillytavern/families.ts`), keyed by the root
 * chat's bare path ([P13 §2.7]'s `originalFilename`, `chat/types.ts`), and
 * builds each family as one session whose shared prefix exists once. A group
 * chat's roster, reply strategy, self-responses and muted members come from
 * `groups/<id>.json` beside it. A chat arriving alone, through
 * {@link importChatFile}, is still a family of its own.
 */

/** Where the session is written, whose it is, and whose library resolves it. */
export interface ChatDoor {
  library: LibraryContext;
  sessions: SessionContext;
  handle: string;
}

/**
 * ***The resolver's library, over the real index*** — the two questions
 * {@link ChatLibrary} asks, each one query.
 *
 * *This account's library only*, never the system's: a chat is resolved against
 * what the person imported and made, and a stock example that happened to share
 * a character's name is not their character.
 */
export function libraryLookup(context: LibraryContext, handle: string): ChatLibrary {
  const schemaOf = (kind: ChatLibraryKind) => (kind === 'actor' ? ACTOR_SCHEMA : LOREBOOK_SCHEMA);
  const owner = ownerKey(userOwner(handle));
  return {
    imported: (kind, filename) => priorImportRef(context, handle, schemaOf(kind), filename),
    named: (kind, name) => objectsNamed(context.db, owner, schemaOf(kind), name),
  };
}

/**
 * ***One chat file, all the way to a session*** — the one-file door: an
 * uploaded `.jsonl`, or Play's *Import session*.
 *
 * `path` is the file's place in its source — `chats/Vera/Vera - 2024.jsonl`
 * under a swept tree, the bare file name for an upload — and is the chat's
 * identity three times over: the parser reads whose chat it is from it, the
 * family is keyed by it, and every turn id hashes it ([P13 §2.4]). So the same
 * file must arrive under the same path to be recognised as already here, and a
 * tree swept after its chats were uploaded one by one is a different family.
 * That is the frozen form of `ChatFamily.key`, not a choice made here.
 *
 * *A file on its own is a family on its own.* Its `main_chat`, if it has one,
 * names a chat that did not come with it, so it is a root with its parent
 * missing ([P13 §2.5]) and the builder says so; a group chat's `groups/<id>.json`
 * did not come either, so it plays on Scene's defaults with its roster read off
 * its lines, and a note says that too. {@link importChats} is where a folder's
 * chats find each other.
 *
 * `bytes` null is a file the source would not hand over — gone since the walk,
 * past the size limit, or named in a browser upload without being sent.
 */
export async function importChatFile(
  door: ChatDoor,
  path: string,
  bytes: Uint8Array | null,
  library: ChatLibrary = libraryLookup(door.library, door.handle),
): Promise<ImportItemReport> {
  const read = readChat(path, bytes);
  if (!read.ok) return read.report;

  const { chat, meta, notes } = read.value;
  const family: ChatFamily = {
    // A Marinara export says so in its lines, and its speaker keys are
    // Marinara's character ids — which the resolver tries as Marinara stamps
    // them.
    source: meta.source,
    key: path,
    name: chat.name,
    chats: [
      meta.mainChat === undefined || meta.mainChat.trim() === ''
        ? chat
        : { ...chat, parentId: siblingPath(path, meta.mainChat.trim()) },
    ],
  };
  const groupless: ImportNote[] = meta.group
    ? [{ key: 'import.chat.groupMissing', params: { chat: chat.name }, level: 'info' }]
    : [];
  return {
    source: path,
    ...(await loadFamily(
      door,
      {
        family,
        hints: hintsOf([meta]),
        // *The header's say about how the chat is played* ([P13 §2.6]) — for
        // one file, its author's note, and for a Marinara export its group's
        // settings as the profile path reads them.
        settings: {
          ...(meta.note === undefined ? {} : { note: meta.note }),
          ...exportedGroupSettings(meta, chat.messages),
        },
        notes: [...notes, ...groupless],
      },
      library,
    )),
  };
}

/**
 * ***A Marinara export's group settings*** — [P13 §0.4]: the per-chat export is
 * SillyTavern JSONL with the chat's metadata under
 * `chat_metadata.marinara_metadata`, which the parser carries unread so that
 * [P13.10] maps it once (`sillytavern/chat.ts`). This is that once: the same
 * {@link marinaraGroupSettings} the profile path uses.
 *
 * *The members are whoever spoke*, in the order they first did, because the
 * export writes no `characterIds`; so a group whose members never all spoke is
 * read by those who did, and a group in which only one member ever spoke reads
 * as the single chat it then looked like. A mute on a member who never spoke
 * is lost with them — the profile path, which has the chat row, has neither
 * gap.
 */
function exportedGroupSettings(
  meta: SillyTavernChatMeta,
  messages: readonly ChatMessage[],
): ChatSettings {
  if (meta.source !== 'marinara' || meta.marinara === undefined) return {};
  const members: ForeignRef[] = [];
  for (const message of messages) {
    const speaker = message.role === 'character' ? message.speaker : undefined;
    if (speaker !== undefined && !members.some((member) => member.key === speaker.key)) {
      members.push(speaker);
    }
  }
  return members.length > 1 ? marinaraGroupSettings(meta.marinara, members) : {};
}

/** A chat file read, or the row that says why it was not. */
type ChatRead = { ok: true; value: SillyTavernChat } | { ok: false; report: ImportItemReport };

function readChat(
  path: string,
  bytes: Uint8Array | null,
  legacyMetadata?: Readonly<Record<string, unknown>>,
): ChatRead {
  if (bytes === null) {
    return {
      ok: false,
      report: {
        source: path,
        disposition: 'unrecognised',
        notes: [{ key: 'import.file.unreadable', params: { file: path }, level: 'warn' }],
      },
    };
  }
  const parsed = parseSillyTavernChat(bytes, path, legacyMetadata);
  if (!parsed.ok) {
    return {
      ok: false,
      report: {
        source: path,
        disposition: 'unrecognised',
        notes: [
          {
            key: 'import.file.refused',
            params: { file: path, refusal: parsed.refusal },
            level: 'warn',
          },
        ],
      },
    };
  }
  return { ok: true, value: parsed.value };
}

/**
 * ***What the family's chats say about resolution*** — the persona locked to a
 * chat and the chat's lorebook, root first. A branch copies its parent's
 * metadata (`saveChat`'s `{ ...chat_metadata, ...withMetadata }`,
 * `script.js:7347`), so these mostly agree; where a branch was re-locked since,
 * the root's lock is tried first and a book any chat linked is linked.
 */
function hintsOf(metas: readonly SillyTavernChatMeta[]): ChatHints {
  const persona = metas.find((meta) => meta.persona !== undefined)?.persona;
  const lore = [
    ...new Set(metas.flatMap((meta) => (meta.worldInfo === undefined ? [] : [meta.worldInfo]))),
  ];
  return { ...(persona === undefined ? {} : { persona }), lore };
}

/** A family ready to build: the chats, what they say, and what reading them noted. */
interface FamilyInput {
  family: ChatFamily;
  hints: ChatHints;
  settings: ChatSettings;
  notes: ImportNote[];
}

/**
 * ***One family, resolved, built and loaded*** — steps 2 to 4 of this module's
 * header, shared by the one-file door and the sweep's pass, and answered as a
 * row without its `source`: the caller knows which file, or files, it was.
 */
async function loadFamily(
  door: ChatDoor,
  input: FamilyInput,
  library: ChatLibrary,
): Promise<Omit<ImportItemReport, 'source'>> {
  const { family } = input;
  const resolved = resolveChat(family, input.hints, library);

  const built = buildSession(
    family,
    resolved.resolution,
    // The account's handle is hashed into every turn id, so two people
    // importing one chat get disjoint sessions and neither learns the other
    // has it ([P13 §2.4]).
    { account: door.handle, now: new Date().toISOString(), modeId: CHAT_IMPORT_MODE_ID },
    input.settings,
  );

  /**
   * ***One statement about each unresolved speaker, and a true one.*** The
   * builder says of every speaker it was handed no actor for that they are
   * *not in this library* — and of every muted member it could not mute, the
   * same; for a name two actors share, the resolver has already said the
   * opposite — there are two — and why neither was chosen. Both would leave
   * the person believing neither.
   */
  const building = built.notes.filter(
    (note) =>
      !(
        (note.key === 'import.chat.speakerUnresolved' ||
          note.key === 'import.chat.mutedUnresolved') &&
        resolved.ambiguous.has(String(note.params['name']))
      ),
  );
  const notes: ImportNote[] = [...input.notes, ...resolved.notes, ...building];

  try {
    const result = await importSession({ sessions: door.sessions }, door.handle, built.document);
    if (result.ok) {
      return {
        disposition: 'converted',
        objectId: result.sessionId,
        notes: [
          {
            key: 'import.chat.imported',
            params: { name: family.name, turns: result.turns },
            level: 'info',
          },
          ...notes,
        ],
      };
    }
    /**
     * ***Already here, and whether that is all of it.*** A session on this
     * account holds this family's turns — the same files imported before, or
     * the same chats grown since, whose opening turns are the same content and
     * so the same ids ([P13 §2.4]). The refusal cannot tell the two apart, and
     * they are not the same answer:
     *
     * - **Every turn held** is `unchanged` — what the review calls a file
     *   identical to what is here, and [P13 §2.7] keeps for `appended: 0`.
     * - **Some turns not held** is a chat that grew, or was edited, in its
     *   source since — or a branch made since, which is the same thing seen
     *   from the family. [P13 §2.7] makes that *extend* the session it came
     *   from, and the extending is [P13.10a]'s; until then those turns are not
     *   written anywhere. Calling that `unchanged` would say the source had
     *   nothing new while its new messages were left out — letting the
     *   refusal speak for the surface, which [18 §7.4] says it must not — so
     *   it is `recorded`, with a note that counts what was left out and why.
     *
     * *Nothing is written in either case*, so the one session is still the one
     * session; a second copy of the old turns is what `already-here` exists to
     * refuse.
     */
    if (result.reason === 'already-here') {
      const missing = turnsNotHeld(
        door.sessions.index,
        built.document.turns.map((turn) => turn.id),
      );
      if (missing === 0) {
        return {
          disposition: 'unchanged',
          notes: [{ key: 'import.chat.alreadyHere', params: {}, level: 'info' }],
        };
      }
      return {
        disposition: 'recorded',
        notes: [
          ...notes,
          {
            key: 'import.chat.grownSince',
            params: { chat: family.name, count: missing },
            level: 'warn',
          },
        ],
      };
    }
    return {
      disposition: 'unrecognised',
      notes: [
        ...notes,
        {
          key: 'import.chat.sessionRefused',
          params: { chat: family.name, reason: result.reason },
          level: 'warn',
        },
      ],
    };
  } catch (error) {
    // A session that could not be written costs that session, and the sweep
    // goes on — the library writer's own answer to a failed store.
    return {
      disposition: 'unrecognised',
      notes: [
        ...notes,
        {
          key: 'import.file.notStored',
          params: { object: family.name, reason: error instanceof Error ? error.name : 'unknown' },
          level: 'warn',
        },
      ],
    };
  }
}

/** What the sweep's session pass is given, beyond the door. */
export interface ChatPass {
  /** The door, or undefined for a sweep that writes library objects only. */
  door: ChatDoor | undefined;
  /** The root being swept, which the pass reads each chat from. */
  files: FileSource;
  /** Whether chats were asked for — false for a browser upload that did not choose them. */
  take: boolean;
  /**
   * ***Chat files chosen and not sent, because the upload limit ran out*** —
   * a browser folder upload's, where the person chose chats and the plan
   * carried only those that fit beside the library (`directory-upload.ts`).
   * Each is named in the manifest and has no bytes here, which on its own
   * reads exactly like a file that *could not be read*; this is what lets the
   * row say the true thing instead.
   */
  notCarried?: ReadonlySet<string>;
  /** The upload limit those did not fit under, in MB, for the sentence that says so. */
  limitMb?: number;
}

/**
 * ***The sweep's session pass*** — every chat and group candidate the reader
 * set aside, after the library loop has written the cards they name.
 *
 * **In three steps, and never more than one family's chats in memory.**
 * 1. *Headings*: each group file is read whole, since it is a few hundred
 *    bytes; then each chat file is read and parsed once for what grouping
 *    needs — its name, its `main_chat`, when it began ({@link ChatHeading}) —
 *    and let go.
 * 2. *Families* (`sillytavern/families.ts`, [P13.9]): the headings grouped by
 *    `main_chat` within their folder, and each group chat's family matched to
 *    its group.
 * 3. *Sessions*: each family's files read again, in the family's order, and
 *    built into one session. A tree's chats are most of its bytes, and holding
 *    them all to group them would hold the whole tree to write one session;
 *    the second read is paid in I/O instead. The resolver's library is built
 *    once, since nothing the pass writes is a library object and the answers
 *    cannot change under it.
 *
 * ***A row per file seen*** — the review's unit, [21 §4.1.1]'s poisoned-file
 * rule applied to conversations: one chat that will not load is one row, and
 * the pass goes on around it. A family's chats each get a row, all pointing at
 * the family's one session; the root's carries what building it said, and the
 * rest say whose branch they are. A group's file gets a row pointing at the
 * sessions it set up.
 *
 * Five answers that are not a session, each a row with a reason:
 * - **not chosen** (`skipped`) — a browser upload whose person left chats out,
 *   so the file was named and never sent;
 * - **over the limit** (`skipped`) — a browser upload whose person chose chats,
 *   and this one did not fit under the upload limit with the rest; named, not
 *   sent, and told how to bring it in instead;
 * - **no session store** (`recorded`) — a sweep that was asked for library
 *   objects only, which in this build is a test harness or a backup, whose
 *   sessions travel their own way;
 * - **a group with none of its chats here** (`recorded`) — read, and with
 *   nothing to apply its roster and settings to;
 * - **a branch whose parent was not read** (`skipped`) — the parent is in the
 *   source but over the limit or refused, and the branch waits for it rather
 *   than coming in under ids it would not have beside it ([P13 §2.4]).
 */
export async function importChats(
  pass: ChatPass,
  everything: readonly ImportCandidate[],
): Promise<ImportItemReport[]> {
  /**
   * *A Marinara store's chats are one candidate of their own* ([P13.10]), read
   * by their own pass below and answered after SillyTavern's. One sweep holds
   * one source, so in practice the two lists never both have something in them.
   */
  const candidates = everything.filter((candidate) => candidate.format !== MARINARA_CHATS_FORMAT);
  const reports: ImportItemReport[] = [];
  for (const candidate of everything) {
    if (candidate.format === MARINARA_CHATS_FORMAT) {
      reports.push(...(await importMarinaraChats(pass, candidate)));
    }
  }
  if (candidates.length === 0) return reports;
  const door = pass.door;
  const library = door === undefined ? null : libraryLookup(door.library, door.handle);

  const headings: ChatHeading[] = [];
  const groups: SillyTavernGroup[] = [];
  /**
   * *Chats in the source that were not read* — not carried, not handed over,
   * or refused. A branch of one waits for it rather than coming in as a root
   * of its own ({@link familiesOf}'s `unread`).
   */
  const unread = new Set<string>();
  /**
   * *Chats are read after every group file*, because a group file old enough to
   * hold its chats' metadata is where a headerless group chat's `main_chat`
   * is ({@link legacyMetadataOf}), and a chat grouped without it would be a
   * family of one.
   */
  const chats: string[] = [];

  for (const candidate of candidates) {
    const source = candidate.source;
    if (!pass.take) {
      reports.push({
        source,
        disposition: 'skipped',
        notes: [{ key: 'import.chat.notChosen', params: {}, level: 'info' }],
      });
      continue;
    }
    if (door === undefined || library === null) {
      reports.push({
        source,
        disposition: 'recorded',
        notes: [{ key: 'import.chat.notImportedHere', params: {}, level: 'info' }],
      });
      continue;
    }
    if (pass.notCarried?.has(source) === true) {
      unread.add(source);
      reports.push({
        source,
        disposition: 'skipped',
        notes: [
          { key: 'import.chat.overLimit', params: { limit: pass.limitMb ?? 0 }, level: 'warn' },
        ],
      });
      continue;
    }
    if (candidate.format !== SILLYTAVERN_GROUP_FORMAT) {
      chats.push(source);
      continue;
    }
    const bytes = await pass.files.read(source);
    const group = bytes === null ? null : parseSillyTavernGroup(bytes, source);
    if (group?.ok === true) {
      groups.push(group.value);
      continue;
    }
    reports.push({
      source,
      disposition: 'unrecognised',
      notes: [
        group === null
          ? { key: 'import.file.unreadable', params: { file: source }, level: 'warn' }
          : {
              key: 'import.file.refused',
              params: { file: source, refusal: group.refusal },
              level: 'warn',
            },
      ],
    });
  }

  if (door === undefined || library === null) return reports;

  const readAgain = async (path: string): Promise<ChatRead> =>
    readChat(path, await pass.files.read(path), legacyMetadataOf(groups, path));
  for (const source of chats) {
    const read = await readAgain(source);
    if (!read.ok) {
      unread.add(source);
      reports.push(read.report);
      continue;
    }
    headings.push(headingOf(source, read.value));
  }

  const sessionsOf = new Map<SillyTavernGroup, ImportItemReport[]>();
  const { plans, heldBack } = familiesOf(headings, groups, unread);
  for (const held of heldBack) {
    reports.push({
      source: held.path,
      disposition: 'skipped',
      notes: [{ key: 'import.chat.parentNotHere', params: { parent: held.parent }, level: 'warn' }],
    });
  }
  /**
   * *Two families of one group are named apart.* A group's family is named
   * after the group ([P13 §2.5]), which is what the person called it; a group
   * that started over — a new chat, not a branch — is a second family of the
   * same group, and two sessions both called the group's name would be one name
   * for two things in Play's list. Such a family is named by its chat too.
   */
  const perGroup = new Map<SillyTavernGroup, number>();
  /**
   * *Which group each group chat went to*, by name — for a group whose chats
   * all came in under another group that lists them too, whose row would
   * otherwise say it came without them.
   */
  const claimedBy = new Map<string, SillyTavernGroup>();
  for (const plan of plans) {
    if (plan.group === null) continue;
    perGroup.set(plan.group, (perGroup.get(plan.group) ?? 0) + 1);
    for (const chat of plan.chats) claimedBy.set(chatNameOf(chat.path), plan.group);
  }

  for (const plan of plans) {
    const read: { path: string; parentId?: string; chat: SillyTavernChat }[] = [];
    for (const member of plan.chats) {
      const again = await readAgain(member.path);
      if (!again.ok) {
        // Changed or gone between the two reads: that file's row says so, and
        // the family is built from the rest of it.
        reports.push(again.report);
        continue;
      }
      read.push({ ...member, chat: again.value });
    }
    const root = read[0];
    if (root === undefined) continue;

    const group = plan.group;
    const rootName = root.chat.chat.name;
    const name =
      group === null
        ? rootName
        : (perGroup.get(group) ?? 0) > 1
          ? `${group.name} (${rootName})`
          : group.name;
    const family: ChatFamily = {
      source: root.chat.meta.source,
      key: plan.key,
      name,
      chats: read.map(({ chat, parentId }) =>
        parentId === undefined ? chat.chat : { ...chat.chat, parentId },
      ),
      ...(group === null ? {} : { roster: rosterOf(group, read) }),
    };

    const notes: ImportNote[] = [...read.flatMap(({ chat }) => chat.notes), ...plan.notes];
    // Keyed on the chat, as the one-file door keys it: a group chat found
    // anywhere but `group chats/` is still a group chat whose file is missing.
    if (group === null && root.chat.meta.group) {
      notes.push({ key: 'import.chat.groupMissing', params: { chat: rootName }, level: 'info' });
    }
    if (group !== null) {
      notes.push(...group.notes);
      if (group.generationMode !== null) {
        notes.push({
          key: 'import.chat.groupGenerationMode',
          params: { group: group.name, mode: group.generationMode },
          level: 'info',
        });
      }
    }

    const outcome = await loadFamily(
      door,
      {
        family,
        hints: hintsOf(read.map(({ chat }) => chat.meta)),
        settings: settingsOf(root.chat.meta, group),
        notes,
      },
      library,
    );

    const [first, ...rest] = read;
    if (first !== undefined) reports.push({ source: first.path, ...outcome });
    for (const branch of rest) {
      reports.push({
        source: branch.path,
        disposition: outcome.disposition,
        ...(outcome.objectId === undefined ? {} : { objectId: outcome.objectId }),
        notes: [
          {
            key: 'import.chat.inFamily',
            params: { chat: branch.chat.chat.name, family: name },
            level: 'info',
          },
        ],
      });
    }
    if (group !== null) {
      sessionsOf.set(group, [...(sessionsOf.get(group) ?? []), { source: plan.key, ...outcome }]);
    }
  }

  for (const group of groups) {
    const other = group.chats
      .map((chat) => claimedBy.get(chat))
      .find((by) => by !== undefined && by !== group);
    reports.push(groupRow(group, sessionsOf.get(group) ?? [], other));
  }
  return reports;
}

/**
 * What grouping needs of a chat, so the chat itself can be let go. The
 * earliest time is found in one pass rather than by spreading every time into
 * `Math.min`, whose argument count a chat of a few hundred thousand lines
 * would exceed — a `RangeError` that would cost the whole sweep, not the chat.
 */
function headingOf(path: string, read: SillyTavernChat): ChatHeading {
  let earliest: number | null = null;
  for (const message of read.chat.messages) {
    const time = readableTime(message.at);
    if (time !== null && (earliest === null || time < earliest)) earliest = time;
  }
  earliest ??= readableTime(read.chat.createdAt);
  return {
    path,
    name: read.chat.name,
    ...(read.meta.mainChat === undefined ? {} : { mainChat: read.meta.mainChat }),
    group: read.meta.group,
    earliest,
  };
}

/** `group chats/1700.jsonl` → `1700`: the name a group's `chats` list uses. */
function chatNameOf(path: string): string {
  return (path.split('/').at(-1) ?? path).replace(/\.jsonl$/i, '');
}

/**
 * ***A group's members as the builder's roster*** — in the group's order, each
 * named as the lines name them, or by their card file's name when they never
 * spoke. The key is the card file, which is what every group line's
 * `original_avatar` says (`chat.ts`'s `speakerOf`), so a member who did speak
 * is the same key twice and resolved once.
 */
function rosterOf(
  group: SillyTavernGroup,
  read: readonly { chat: SillyTavernChat }[],
): ForeignRef[] {
  const named = new Map<string, string>();
  for (const { chat } of read) {
    for (const message of chat.chat.messages) {
      const speaker = message.speaker;
      if (speaker !== undefined && speaker.name !== '' && !named.has(speaker.key)) {
        named.set(speaker.key, speaker.name);
      }
    }
  }
  return group.members.map((key) => ({
    key,
    // A member from an older group file is keyed by name, and that is the name.
    name:
      named.get(key) ??
      (key.startsWith(SPEAKER_BY_NAME)
        ? key.slice(SPEAKER_BY_NAME.length)
        : key.replace(/\.[^.]+$/, '')),
  }));
}

/**
 * ***How the family is played*** ([P13 §2.6]): the root chat's author's note,
 * and a group's strategy, self-responses and muted members from its file.
 */
function settingsOf(meta: SillyTavernChatMeta, group: SillyTavernGroup | null): ChatSettings {
  return {
    ...(meta.note === undefined ? {} : { note: meta.note }),
    ...(group === null
      ? {}
      : {
          ...(Object.keys(group.speakers).length === 0 ? {} : { speakers: group.speakers }),
          ...(group.muted.length === 0 ? {} : { muted: group.muted }),
        }),
  };
}

/**
 * ***A group's own row*** — what became of the file: the sessions its roster
 * and settings went into, or, with none of its chats here, nothing to apply
 * them to. Its disposition follows theirs: `converted` when any became a new
 * session, `unchanged` when every one was already here, `recorded` otherwise.
 *
 * ***It says applied only of what was.*** Members and settings go into a
 * session when the session is written, and a family already here — every turn
 * held, or grown since — is not written again ({@link loadFamily}); what the
 * group says now reaches those sessions only through [P13.10a]'s sync. So
 * `groupRead` counts the sessions made, and the rest are counted apart.
 *
 * `claimedBy` is another group whose file lists this one's chats too, and
 * took them ({@link familiesOf} gives a chat to the first group by path): with
 * no sessions of its own, that — not a missing chat — is why.
 */
function groupRow(
  group: SillyTavernGroup,
  sessions: readonly ImportItemReport[],
  claimedBy: SillyTavernGroup | undefined,
): ImportItemReport {
  if (sessions.length === 0) {
    return {
      source: group.path,
      disposition: 'recorded',
      notes: [
        claimedBy === undefined
          ? { key: 'import.chat.groupNoChats', params: { group: group.name }, level: 'info' }
          : {
              key: 'import.chat.groupChatsClaimed',
              params: { group: group.name, other: claimedBy.name },
              level: 'warn',
            },
      ],
    };
  }
  const made = sessions.flatMap((row) =>
    row.disposition === 'converted' && row.objectId !== undefined ? [row.objectId] : [],
  );
  const here = sessions.filter(
    (row) => row.disposition === 'unchanged' || row.disposition === 'recorded',
  ).length;
  const disposition: ImportItemReport['disposition'] =
    made.length > 0
      ? 'converted'
      : sessions.every((row) => row.disposition === 'unchanged')
        ? 'unchanged'
        : 'recorded';
  const [objectId, ...alsoProduced] = made;
  const notes: ImportNote[] = [];
  if (made.length > 0) {
    notes.push({
      key: 'import.chat.groupRead',
      params: { group: group.name, members: group.members.length, sessions: made.length },
      level: 'info',
    });
  }
  if (here > 0) {
    notes.push({
      key: 'import.chat.groupNotApplied',
      params: { group: group.name, sessions: here },
      level: 'info',
    });
  }
  return {
    source: group.path,
    disposition,
    ...(objectId === undefined ? {} : { objectId }),
    ...(alsoProduced.length === 0 ? {} : { alsoProduced }),
    notes,
  };
}

// ---------------------------------------------------------------------------
// Marinara — [P13.10]
// ---------------------------------------------------------------------------

/**
 * ***A Marinara store's chats, as sessions*** —
 * [P13.10](../../../../docs/design/workplan/30-p13-scene-and-session-import.md).
 *
 * The same three steps as SillyTavern's pass over a different first one: the
 * store reader has already read the tables, so there is nothing to read twice
 * and nothing to hold back; `marinara/chat.ts` joins them into chats,
 * `marinara/families.ts` groups the roleplay chats by `branchParentChatId`, and
 * each family is resolved, built and loaded by {@link loadFamily} — the one
 * path every door shares ([P13 §2.1]).
 *
 * ***A row per chat***, `storage/tables/chats.json#<id>`, which is what the
 * review had instead a row per message shard before this stage:
 * - a **roleplay** chat's family is one session; the root's row carries what
 *   building it said, and each branch's row says whose branch it is and points
 *   at the same session, as SillyTavern's do;
 * - a **conversation** or **game** chat is `recorded`, with a note that says why
 *   ([P13 §2.6]);
 * - **messages whose chat is not in the store** are one `skipped` row for the
 *   table, counted — they have no chat to be lines of.
 *
 * ***Not asked about, unlike SillyTavern's.*** A browser folder upload offers
 * chats as a choice because SillyTavern's are most of a tree's bytes and live
 * apart from the library; Marinara's live in the store that is sent either way
 * (`directory-upload.ts`: *"Zero for a Marinara root, where no choice is
 * offered"*). So `take` — which is false for any upload whose person did not
 * tick a box that was never shown — is not read here. A sweep with no session
 * store still records each chat, as SillyTavern's pass does.
 */
async function importMarinaraChats(
  pass: ChatPass,
  candidate: ImportCandidate,
): Promise<ImportItemReport[]> {
  const read = parseMarinaraChats(tablesOf(candidate.payload));
  const reports: ImportItemReport[] = [];

  for (const other of read.other) {
    reports.push({
      source: `${MARINARA_CHAT_SOURCE}${other.id}`,
      disposition: 'recorded',
      notes: [
        {
          key: 'import.chat.modeNotImported',
          params: { chat: other.name, mode: other.mode },
          level: 'info',
        },
      ],
    });
  }
  if (read.orphans.messages + read.orphans.swipes > 0) {
    reports.push({
      source: 'storage/tables/messages',
      disposition: 'skipped',
      notes: [
        {
          key: 'import.chat.orphanedMessages',
          params: { messages: read.orphans.messages, swipes: read.orphans.swipes },
          level: 'warn',
        },
      ],
    });
  }

  const door = pass.door;
  if (door === undefined) {
    for (const chat of read.chats) {
      reports.push({
        source: `${MARINARA_CHAT_SOURCE}${chat.chat.id}`,
        disposition: 'recorded',
        notes: [{ key: 'import.chat.notImportedHere', params: {}, level: 'info' }],
      });
    }
    return reports;
  }

  const library = libraryLookup(door.library, door.handle);
  for (const plan of marinaraFamilies(read.chats)) {
    const [root, ...rest] = plan.chats;
    if (root === undefined) continue;

    /**
     * *The roster is every member of every chat in the family*, root's order
     * first: a branch keeps its parent's `characterIds` unless somebody added a
     * member since, and a member added in a branch is still in the session
     * that branch is part of.
     */
    const roster: ForeignRef[] = [];
    for (const { chat } of plan.chats) {
      for (const member of chat.members) {
        if (!roster.some((held) => held.key === member.key)) roster.push(member);
      }
    }
    const family: ChatFamily = {
      source: 'marinara',
      key: plan.key,
      name: root.chat.title,
      chats: plan.chats.map(({ chat, parentId }) =>
        parentId === undefined ? chat.chat : { ...chat.chat, parentId },
      ),
      ...(roster.length === 0 ? {} : { roster }),
    };
    const persona = plan.chats.find(({ chat }) => chat.persona !== undefined)?.chat.persona;

    const outcome = await loadFamily(
      door,
      {
        family,
        hints: persona === undefined ? {} : { persona },
        // The root's, as SillyTavern's pass takes the root's: the session opens
        // on the root chat's head ([P13 §2.5]), so it opens as that chat played.
        // *Read against the family's roster*, though, not the root's members: a
        // solo root whose branch became a group is a group session, and it
        // plays as Marinara plays a group whose metadata never said otherwise —
        // merged, in order, no names — rather than with no group settings at all.
        settings: roster.length > 1 ? marinaraGroupSettings(root.chat.metadata, roster) : {},
        notes: [...plan.chats.flatMap(({ chat }) => chat.notes), ...plan.notes],
      },
      library,
    );

    reports.push({ source: `${MARINARA_CHAT_SOURCE}${root.chat.chat.id}`, ...outcome });
    for (const branch of rest) {
      reports.push({
        source: `${MARINARA_CHAT_SOURCE}${branch.chat.chat.id}`,
        disposition: outcome.disposition,
        ...(outcome.objectId === undefined ? {} : { objectId: outcome.objectId }),
        notes: [
          {
            key: 'import.chat.inFamily',
            params: { chat: branch.chat.chat.name, family: family.name },
            level: 'info',
          },
        ],
      });
    }
  }
  return reports;
}

/**
 * The reader's payload, as the parser's tables. Opaque to the engine by
 * contract (`ImportCandidate.payload`), so read defensively: a table that is
 * not a list is an empty one.
 */
function tablesOf(payload: unknown): MarinaraTables {
  const record =
    typeof payload === 'object' && payload !== null ? (payload as Record<string, unknown>) : {};
  const rows = (name: string): Record<string, unknown>[] => {
    const value = record[name];
    return Array.isArray(value)
      ? value.filter(
          (row): row is Record<string, unknown> =>
            typeof row === 'object' && row !== null && !Array.isArray(row),
        )
      : [];
  };
  return {
    chats: rows('chats'),
    messages: rows('messages'),
    swipes: rows('swipes'),
    characters: rows('characters'),
    personas: rows('personas'),
  };
}
