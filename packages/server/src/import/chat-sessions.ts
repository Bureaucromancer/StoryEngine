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
import { resolveChat, type ChatLibrary, type ChatLibraryKind } from './chat/resolve.js';
import type { ChatFamily, ChatSettings } from './chat/types.js';
import { priorImportRef } from './identity.js';
import { parseSillyTavernChat, SILLYTAVERN_GROUP_FORMAT } from './sillytavern/chat.js';
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
 * ***One report per chat file***, in the review's own vocabulary, so a sweep of
 * cards and chats reads as one list: `converted` with the new session's id and
 * everything the four steps noted; `unchanged` when a session here already
 * holds every turn of the chat; `recorded` when one holds its beginning and the
 * source has grown since; `unrecognised` with the reason when the file will
 * not read.
 * One chat that will not load is one row, and the sweep goes on around it —
 * the poisoned-file rule ([21 §4.1.1]) applied to conversations.
 *
 * ***For this stage, each chat file is a family of its own***, keyed by its
 * bare root path ([P13 §2.7]'s `originalFilename`, `chat/types.ts`). A branch
 * made in SillyTavern therefore imports as a second session beside its parent
 * today, sharing nothing. [P13.9] groups a character's chats by `main_chat`
 * into one family, and reads `groups/<id>.json` for a group's roster and
 * settings; both land here, in {@link importChats}, which is why the group files
 * are routed to this pass already and recorded by it.
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
 * ***One chat file, all the way to a session.***
 *
 * `path` is the file's place in its source — `chats/Vera/Vera - 2024.jsonl`
 * under a swept tree, the bare file name for an upload — and is the chat's
 * identity three times over: the parser reads whose chat it is from it, the
 * family is keyed by it, and every turn id hashes it ([P13 §2.4]). So the same
 * file must arrive under the same path to be recognised as already here, and a
 * tree swept after its chats were uploaded one by one is a different family.
 * That is the frozen form of `ChatFamily.key`, not a choice made here.
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
  if (bytes === null) {
    return {
      source: path,
      disposition: 'unrecognised',
      notes: [{ key: 'import.file.unreadable', params: { file: path }, level: 'warn' }],
    };
  }

  const parsed = parseSillyTavernChat(bytes, path);
  if (!parsed.ok) {
    return {
      source: path,
      disposition: 'unrecognised',
      notes: [
        {
          key: 'import.file.refused',
          params: { file: path, refusal: parsed.refusal },
          level: 'warn',
        },
      ],
    };
  }

  const { chat, meta, notes: read } = parsed.value;
  const family: ChatFamily = {
    // A Marinara export says so in its lines, and its speaker keys are
    // Marinara's character ids — which the resolver tries as Marinara stamps
    // them.
    source: meta.source,
    key: path,
    name: chat.name,
    chats: [chat],
  };

  const resolved = resolveChat(
    family,
    {
      ...(meta.persona === undefined ? {} : { persona: meta.persona }),
      lore: meta.worldInfo === undefined ? [] : [meta.worldInfo],
    },
    library,
  );

  /**
   * *The header's say about how the chat is played* ([P13 §2.6]) — for a
   * single SillyTavern chat, its author's note and nothing else. A group's
   * strategy, self-responses and muted members live in `groups/<id>.json`,
   * which is [P13.9]'s; until then a group chat plays on Scene's defaults.
   */
  const settings: ChatSettings = meta.note === undefined ? {} : { note: meta.note };

  const built = buildSession(
    family,
    resolved.resolution,
    // The account's handle is hashed into every turn id, so two people
    // importing one chat get disjoint sessions and neither learns the other
    // has it ([P13 §2.4]).
    { account: door.handle, now: new Date().toISOString(), modeId: CHAT_IMPORT_MODE_ID },
    settings,
  );

  /**
   * ***One statement about each unresolved speaker, and a true one.*** The
   * builder says of every speaker it was handed no actor for that they are
   * *not in this library*; for a name two actors share, the resolver has
   * already said the opposite — there are two — and why neither was chosen.
   * Both would leave the person believing neither.
   */
  const building = built.notes.filter(
    (note) =>
      !(
        note.key === 'import.chat.speakerUnresolved' &&
        resolved.ambiguous.has(String(note.params['name']))
      ),
  );
  const notes: ImportNote[] = [...read, ...resolved.notes, ...building];

  try {
    const result = await importSession({ sessions: door.sessions }, door.handle, built.document);
    if (result.ok) {
      return {
        source: path,
        disposition: 'converted',
        objectId: result.sessionId,
        notes: [
          {
            key: 'import.chat.imported',
            params: { name: chat.name, turns: result.turns },
            level: 'info',
          },
          ...notes,
        ],
      };
    }
    /**
     * ***Already here, and whether that is all of it.*** A session on this
     * account holds this chat's turns — the same file imported before, or the
     * same chat grown since, whose opening turns are the same content and so
     * the same ids ([P13 §2.4]). The refusal cannot tell the two apart, and
     * they are not the same answer:
     *
     * - **Every turn held** is `unchanged` — what the review calls a file
     *   identical to what is here, and [P13 §2.7] keeps for `appended: 0`.
     * - **Some turns not held** is a chat that grew, or was edited, in its
     *   source since. [P13 §2.7] makes that *extend* the session it came from,
     *   and the extending is [P13.10a]'s; until then those turns are not
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
          source: path,
          disposition: 'unchanged',
          notes: [{ key: 'import.chat.alreadyHere', params: {}, level: 'info' }],
        };
      }
      return {
        source: path,
        disposition: 'recorded',
        notes: [
          ...notes,
          {
            key: 'import.chat.grownSince',
            params: { chat: chat.name, count: missing },
            level: 'warn',
          },
        ],
      };
    }
    return {
      source: path,
      disposition: 'unrecognised',
      notes: [
        ...notes,
        {
          key: 'import.chat.sessionRefused',
          params: { chat: chat.name, reason: result.reason },
          level: 'warn',
        },
      ],
    };
  } catch (error) {
    // A session that could not be written costs that session, and the sweep
    // goes on — the library writer's own answer to a failed store.
    return {
      source: path,
      disposition: 'unrecognised',
      notes: [
        ...notes,
        {
          key: 'import.file.notStored',
          params: { object: chat.name, reason: error instanceof Error ? error.name : 'unknown' },
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
 * **Sequential, one file read at a time.** A tree's chats are most of its
 * bytes, and each is read, turned into a session and let go before the next is
 * opened; nothing here holds more than one chat in memory. The resolver's
 * library is built once, since nothing the pass writes is a library object and
 * the answers cannot change under it.
 *
 * Four answers that are not a session, each a row with a reason:
 * - **not chosen** (`skipped`) — a browser upload whose person left chats out,
 *   so the file was named and never sent;
 * - **over the limit** (`skipped`) — a browser upload whose person chose chats,
 *   and this one did not fit under the upload limit with the rest; named, not
 *   sent, and told how to bring it in instead;
 * - **no session store** (`recorded`) — a sweep that was asked for library
 *   objects only, which in this build is a test harness or a backup, whose
 *   sessions travel their own way;
 * - **a group's file** (`recorded`) — read at [P13.9].
 */
export async function importChats(
  pass: ChatPass,
  candidates: readonly ImportCandidate[],
): Promise<ImportItemReport[]> {
  const reports: ImportItemReport[] = [];
  const library =
    pass.door === undefined ? null : libraryLookup(pass.door.library, pass.door.handle);

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
    if (candidate.format === SILLYTAVERN_GROUP_FORMAT) {
      reports.push({
        source,
        disposition: 'recorded',
        notes: [{ key: 'import.chat.groupNotRead', params: {}, level: 'info' }],
      });
      continue;
    }
    if (pass.door === undefined || library === null) {
      reports.push({
        source,
        disposition: 'recorded',
        notes: [{ key: 'import.chat.notImportedHere', params: {}, level: 'info' }],
      });
      continue;
    }
    if (pass.notCarried?.has(source) === true) {
      reports.push({
        source,
        disposition: 'skipped',
        notes: [
          { key: 'import.chat.overLimit', params: { limit: pass.limitMb ?? 0 }, level: 'warn' },
        ],
      });
      continue;
    }
    reports.push(await importChatFile(pass.door, source, await pass.files.read(source), library));
  }
  return reports;
}
