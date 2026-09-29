// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import type { ImportNote } from '@storyengine/shared';

import { SPEAKER_BY_NAME } from '../sillytavern/chat.js';
import type { ChatFamily, ChatResolution, ForeignRef, ResolvedRef } from './types.js';

/**
 * ***What the library knows about a chat's names*** —
 * [P13 §2.5](../../../../../docs/design/workplan/30-p13-scene-and-session-import.md)'s
 * resolution table, built at
 * [P13.8](../../../../../docs/design/workplan/30-p13-scene-and-session-import.md).
 *
 * The builder (`build.ts`) is handed a {@link ChatResolution} and never looks
 * anything up, which is what keeps it pure. This is where the looking up
 * happens — and ***it is pure too, over an interface*** ({@link ChatLibrary}),
 * so the table below is testable as a table: which file a speaker key is tried
 * as, in which order, and what a second actor with the same name does to the
 * answer. The one implementation over the real index is the door's
 * (`import/chat-sessions.ts`), and it is two queries.
 *
 * ***Nothing is invented, and that is the rule every arm below keeps.*** A
 * speaker the library does not have stays the chat's own name for them, which
 * `Ref` shows by name and flags as missing (`schema/common.ts:43`); a persona
 * not found leaves the session without one; a lorebook not found is not linked.
 * Each is a note. The alternative — an actor minted from a chat line's name —
 * would put a character in the library with no description, no card and no
 * source, made by an import that was asked to bring in a conversation.
 *
 * **The order, and why it is this one.** The re-import rule's own lookup
 * first (`priorImportId`, `import/identity.ts`): a card imported from a file
 * is stamped with that file's source-relative path, and the chat names the same
 * file, so the two meet exactly and the answer survives a rename in either
 * place. Only when that fails, an **exact, unique** name match — [P13 §2.5]'s
 * fallback, for the card imported some other way than beside its chats (typed
 * in by hand, copied from another install, uploaded under a different file
 * name). *Unique* is the load-bearing word: two actors called *Vera* is no
 * match, because choosing one would be the import guessing whose transcript it
 * was, and a wrong guess gives one character a whole conversation they never
 * had.
 */

/** The two kinds a chat names. */
export type ChatLibraryKind = 'actor' | 'lorebook';

/**
 * ***What the resolver asks of a library, and nothing more.***
 *
 * - **`imported`** is `priorImportRef` (`import/identity.ts`): the object an
 *   earlier import of this source-relative file produced in this account's
 *   library, or null.
 * - **`named`** is every object of the kind in this account's library called
 *   exactly `name` — *every* one, because the caller counts
 *   (`index-db/query.ts`'s `objectsNamed`).
 *
 * Two methods, so a test's fake is a pair of maps.
 */
export interface ChatLibrary {
  imported(kind: ChatLibraryKind, filename: string): ResolvedRef | null;
  named(kind: ChatLibraryKind, name: string): readonly ResolvedRef[];
}

/**
 * ***What a chat says beyond its lines***, for the two references a line does
 * not carry.
 *
 * - **`persona`**: the persona key locked to the chat — SillyTavern's
 *   `chat_metadata.persona`, which the parser has already written in the same
 *   vocabulary a player's line uses (`User Avatars/<file>`), so the two are
 *   tried alike. The lines' own persona keys come first ([P13 §2.5]'s *"a user
 *   line's `force_avatar` … else `chat_metadata.persona`"*): they say who the
 *   player actually was, and the lock says only who they were last set to be.
 * - **`lore`**: lorebooks the chat binds by name — SillyTavern's
 *   `chat_metadata.world_info`.
 */
export interface ChatHints {
  persona?: string;
  lore?: readonly string[];
}

/**
 * The resolution, what the person should be told about it, and — for the door
 * — which speaker names were left unresolved because they were **ambiguous**
 * rather than absent.
 *
 * `ambiguous` exists because the builder already says of every unresolved
 * speaker that they are *not in this library*, and for these that is false:
 * two of them are. The door drops the builder's sentence for exactly these
 * names, so the person reads one true statement rather than two contradictory
 * ones (`chat-sessions.ts`).
 */
export interface ChatResolved {
  resolution: ChatResolution;
  notes: ImportNote[];
  ambiguous: ReadonlySet<string>;
}

/** A name match's answer, and whether *none* meant *more than one*. */
interface Match {
  ref: ResolvedRef | null;
  ambiguous: boolean;
}

const NO_MATCH: Match = { ref: null, ambiguous: false };

/**
 * Resolves one family's references against one library.
 *
 * *Deterministic*: the same family, hints and library answers give the same
 * resolution and the same notes in the same order, which the builder's own
 * byte-identity promise needs from its input.
 */
export function resolveChat(
  family: ChatFamily,
  hints: ChatHints,
  library: ChatLibrary,
): ChatResolved {
  const notes: ImportNote[] = [];
  const ambiguous = new Set<string>();
  /** Names already noted as ambiguous, so a name met twice is said once. */
  const said = new Set<string>();

  /**
   * ***An exact, unique name match, or nothing.*** More than one is noted —
   * once per name and kind — and answers null: the import does not choose
   * between two people. `ambiguous` travels with the answer so no caller has
   * to ask the library the same question twice to find out why it got none.
   */
  const unique = (kind: ChatLibraryKind, name: string): Match => {
    if (name.trim() === '') return NO_MATCH;
    const found = library.named(kind, name);
    if (found.length === 1) return { ref: found[0] ?? null, ambiguous: false };
    if (found.length === 0) return NO_MATCH;
    if (!said.has(`${kind}:${name}`)) {
      said.add(`${kind}:${name}`);
      notes.push({
        key: 'import.chat.nameAmbiguous',
        params: { name, count: found.length },
        level: 'warn',
      });
    }
    return { ref: null, ambiguous: true };
  };

  // -------------------------------------------------------------------------
  // Speakers — by key, each key once
  // -------------------------------------------------------------------------

  const speakers = new Map<string, ResolvedRef | null>();
  const resolve = (speaker: ForeignRef): void => {
    if (speakers.has(speaker.key)) return;
    const match = resolveSpeaker(family.source, speaker, library, unique);
    if (match.ambiguous) ambiguous.add(speaker.name);
    speakers.set(speaker.key, match.ref);
  };
  /**
   * ***A group's roster first*** ([P13 §2.5]'s *"plus `groups/<id>.json`
   * `members` for the roster"*, [P13.9]): every member is looked up whether or
   * not they spoke, because the cast is the members and a muted one is exactly
   * who the lines never mention. A member who did speak is the same key either
   * way, so they are looked up once.
   */
  for (const member of family.roster ?? []) resolve(member);
  for (const chat of family.chats) {
    for (const message of chat.messages) {
      const speaker = message.role === 'character' ? message.speaker : undefined;
      if (speaker !== undefined) resolve(speaker);
    }
  }

  // -------------------------------------------------------------------------
  // The persona — [P13 §2.5]: the lines' own first, then the chat's lock
  // -------------------------------------------------------------------------

  const personas = personaCandidates(family, hints.persona);
  let persona: ResolvedRef | null = null;
  for (const key of personas.keys) {
    persona = library.imported('actor', key);
    if (persona !== null) break;
  }
  /**
   * ***A name match on the chat's own speaker is not the player.*** In a chat
   * the player and the characters answering them are different parties, so a
   * persona name that uniquely finds an actor already resolved as a speaker
   * means the player gave their persona the character's name — not that the
   * character was the player. Taking it would record every input as the
   * character's and make the chat's one character the session's persona too;
   * force-talk would then refuse them and the selector drop them, leaving
   * nobody to answer. So it is left unresolved, with the note that says so.
   * *Only the name match*: an import stamp is the persona's own file meeting
   * the line that named it, which is evidence rather than a guess.
   */
  const cast = new Set([...speakers.values()].flatMap((ref) => (ref === null ? [] : [ref.id])));
  const personaName = personas.names[0];
  const byName =
    persona !== null || personaName === undefined ? NO_MATCH : unique('actor', personaName);
  persona ??= byName.ref !== null && cast.has(byName.ref.id) ? null : byName.ref;
  if (persona === null && !byName.ambiguous && personas.keys.length + personas.names.length > 0) {
    notes.push({
      key: 'import.chat.personaUnresolved',
      params: { persona: personaName ?? fileOf(personas.keys[0] ?? '') },
      level: 'warn',
    });
  }

  // -------------------------------------------------------------------------
  // Lorebooks — `worlds/<name>.json`, then the bare file, then the name
  // -------------------------------------------------------------------------

  const lore: string[] = [];
  for (const book of hints.lore ?? []) {
    const imported =
      library.imported('lorebook', `worlds/${book}.json`) ??
      library.imported('lorebook', `${book}.json`);
    const match =
      imported === null ? unique('lorebook', book) : { ref: imported, ambiguous: false };
    if (match.ref !== null) {
      if (!lore.includes(match.ref.id)) lore.push(match.ref.id);
    } else if (!match.ambiguous) {
      notes.push({ key: 'import.chat.loreUnresolved', params: { book }, level: 'warn' });
    }
  }

  return { resolution: { speakers, persona, lore }, notes, ambiguous };
}

/**
 * ***One speaker, by [P13 §2.5]'s table.***
 *
 * - **A SillyTavern key is a card file** (`Vera.png`: the folder a single chat
 *   is filed under, or a group line's `original_avatar`). Tried as
 *   `characters/<key>` — how the sweep stamps a card it found in the tree —
 *   then as `<key>` bare, which is how a card uploaded on its own is stamped:
 *   the upload's source is its file name and nothing else
 *   (`routes/import.ts`, `readUpload`).
 * - **A Marinara key is a character id**, stamped by its reader as the row it
 *   came from (`storage/tables/characters.json#<id>`, `marinara/reader.ts`).
 *   Reached here only through Marinara's per-chat JSONL export today; the
 *   profile path is [P13.10]'s.
 * - **A {@link SPEAKER_BY_NAME} key has no file** — the line named the speaker
 *   and nothing else — so it goes straight to the name.
 */
function resolveSpeaker(
  source: ChatFamily['source'],
  speaker: ForeignRef,
  library: ChatLibrary,
  unique: (kind: ChatLibraryKind, name: string) => Match,
): Match {
  if (!speaker.key.startsWith(SPEAKER_BY_NAME)) {
    const files =
      source === 'marinara'
        ? [`storage/tables/characters.json#${speaker.key}`]
        : [`characters/${speaker.key}`, speaker.key];
    for (const file of files) {
      const found = library.imported('actor', file);
      if (found !== null) return { ref: found, ambiguous: false };
    }
  }
  return unique('actor', nameOfSpeaker(speaker));
}

/**
 * The name a speaker is matched by: the one a `name:` key spells, else the
 * name the line was written under.
 */
function nameOfSpeaker(speaker: ForeignRef): string {
  return speaker.key.startsWith(SPEAKER_BY_NAME)
    ? speaker.key.slice(SPEAKER_BY_NAME.length)
    : speaker.name;
}

/**
 * ***Who the player was, in the order to try it.***
 *
 * **The lines' persona keys by how many lines carry each**, ties to the first
 * met: a session has one persona (`cast.persona`) and a chat whose player
 * switched persona once, near the end, was still mostly played as the first.
 * Then the chat's lock, which says only who the player was last set to be.
 * The names are the lines' names for those personas, in the same order, for
 * the fallback.
 */
function personaCandidates(
  family: ChatFamily,
  locked: string | undefined,
): { keys: string[]; names: string[] } {
  const counts = new Map<string, { count: number; name: string }>();
  for (const chat of family.chats) {
    for (const message of chat.messages) {
      const persona = message.role === 'user' ? message.persona : undefined;
      if (persona === undefined) continue;
      const held = counts.get(persona.key);
      if (held === undefined) counts.set(persona.key, { count: 1, name: persona.name });
      else held.count += 1;
    }
  }
  // A stable sort over first-met order is the tie-break.
  const ranked = [...counts.entries()].sort((a, b) => b[1].count - a[1].count);
  const keys = ranked.map(([key]) => key);
  if (locked !== undefined && locked !== '' && !keys.includes(locked)) keys.push(locked);
  const names = [
    ...new Set(ranked.map(([, held]) => held.name).filter((name) => name.trim() !== '')),
  ];
  return { keys, names };
}

/** `User Avatars/ned.png` → `ned.png`: what a persona with no name is called in a note. */
function fileOf(key: string): string {
  return key.split('/').at(-1) ?? key;
}
