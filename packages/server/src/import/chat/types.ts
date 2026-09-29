// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import type { ImportNote, SessionExport } from '@storyengine/shared';

import type { SessionFile } from '../../sessions/types.js';

/**
 * ***What a foreign chat is, once a source's parser has read it and before
 * anything here has decided what it means*** —
 * [P13 §2.1](../../../../../docs/design/workplan/30-p13-scene-and-session-import.md),
 * [P13.6](../../../../../docs/design/workplan/30-p13-scene-and-session-import.md).
 *
 * **Source-neutral, and that is the stage's whole reason to exist.** SillyTavern
 * and Marinara store a chat differently — a JSONL file of lines against a table
 * of rows joined to a table of swipes — and store *the same thing*: messages in
 * order, each by the player, a character or the narrator, some with swipes, some
 * hidden, and a family of chats copied from one another ([P13 §0.1]). So each
 * source gets a parser that says what its chat *is* in these terms (P13.7,
 * P13.10), and one builder says what that means as a session. Two builders
 * would be two opinions about what a round is, and the first place they
 * disagreed would be a group chat, which is the case nobody tests by hand.
 *
 * ***Plain data, and nothing here is a library object.*** A speaker is named in
 * the source's own identity space — a card file, a character row — because the
 * parser has no library to look in, and because turn identity must not depend
 * on one (see {@link ForeignRef}). What the library knows arrives separately,
 * as a {@link ChatResolution} (P13.8), which is the pure converter's
 * `(chats, resolution) → documents` signature [P13 §2.1] asks for.
 */

/**
 * ***A speaker or persona as the source names it*** — a SillyTavern card's
 * avatar file (`Vera.png`) or the chat's folder, or a Marinara character id.
 *
 * **`key` is what turn identity hashes, and never a resolved library id.** That
 * is not tidiness; [P13 §2.7]'s sync depends on it. A turn's id is a function of
 * its content ([P13 §2.4]), and the content includes who spoke. If *who* were
 * the library's answer, then importing a chat before its card and again after
 * would give every turn a new id, and the second import — which ought to find
 * every turn already present — would instead fork the whole session beside
 * itself. The source's own name for the speaker is the one thing about them
 * that does not change when this library does.
 *
 * `name` is what the transcript shows when resolution finds nothing, which is
 * why it travels with the key rather than being looked up later.
 */
export interface ForeignRef {
  key: string;
  name: string;
}

/**
 * One alternative a character message was given — SillyTavern's `swipes[i]`
 * with its `swipe_info[i]`, Marinara's `message_swipes` row.
 *
 * `at` is when that alternative was generated, in milliseconds since the epoch,
 * or null when the source did not say or said something unreadable.
 */
export interface ChatSwipe {
  text: string;
  reasoning?: string;
  at: number | null;
  /** What the source had established as of this alternative — {@link ChatStateValue}. */
  state?: readonly ChatStateValue[];
}

/**
 * ***A channel's value, as the source had it at a message*** — [P13 §2.6]'s
 * *"`game_state_snapshots` row for a message's swipe → effects on the turn
 * holding that message"*, added at [P13.5a].
 *
 * **Source-neutral, like everything here**: a channel id and a value in that
 * channel's shape, which the source's own parser has already translated
 * (`marinara/trackers.ts`). The builder knows no tracker; it writes each value
 * as an effect on the turn holding the message or swipe it came with, and only
 * where it moves the state along that path.
 *
 * - **`version`** is the channel's, which the effect records
 *   (`channelVersion`); the parser that spells the id spells the version with
 *   it, and a test pins both to the registered channel.
 * - **`init`** is what the channel reads before anything wrote it — its
 *   declared `init`. A value equal to what the path already holds, *or to this
 *   when nothing has written it*, is no effect: a source that records every
 *   tracker in every snapshot, most of them empty, would otherwise give every
 *   turn six effects saying nothing.
 * - **`member`**, for an actor-scoped channel, is who it is about **as the
 *   source names them** — resolved to an actor by the builder, as a speaker
 *   is, and skipped (and counted) when the library has no such actor or the
 *   cast does not hold them.
 * - **`paths`**: the value is a list of field paths (`<channel key>/<JSON
 *   Pointer>`), and a key `<channel>#<member key>` in one names a member the
 *   source's way. The builder rewrites each to the actor, and drops one it
 *   cannot — a lock on a character who is not in the session locks nothing.
 */
export interface ChatStateValue {
  channelId: string;
  version: number;
  init: unknown;
  value: unknown;
  member?: ForeignRef;
  paths?: true;
}

/**
 * ***One message, as the source's chat shows it*** —
 * [P13 §2.2](../../../../../docs/design/workplan/30-p13-scene-and-session-import.md)'s
 * table reads these.
 *
 * - **`role`**: `user` is the player's line (a turn's input), `character` is a
 *   cast member's (an attributed output message), `narrator` is the scene's own
 *   voice — SillyTavern's `extra.type: 'narrator'`, Marinara's `narrator` and
 *   `system` — which becomes a `speaker: null` message.
 * - **`speaker`** is who said a `character` line. Absent on one is read as
 *   *nobody in particular*, which is what `outputMessagesOf` has always made of
 *   a turn with no messages: a parser that cannot tell who spoke should not
 *   guess, and a null speaker is the record's word for not guessing.
 * - **`persona`** is who the player was on a `user` line, for the resolver
 *   (P13.8). The builder does not read it: a session has one persona
 *   (`cast.persona`), and which one is resolution's answer, not a per-line one.
 * - **`at`**: milliseconds since the epoch, or null when unknown. Both sources
 *   hold send times that repeat or run backwards (`st-chat.importer.ts:89`),
 *   and the builder copes with that rather than the parser: see `ids.ts`.
 * - **`swipes` and `activeSwipe`**: for a `character` line with alternatives.
 *   ***`swipes[activeSwipe]` has already been made authoritative by the
 *   parser*** — [P13 §0.3]: `mes` (or Marinara's `messages.content`) is the
 *   active swipe's current text, and the swipe row is the copy that goes stale
 *   after an edit. So the parser overwrites the stale copy, as Marinara's own
 *   importer does, and the builder trusts what it is given. `text` is the same
 *   string, and is what the builder uses for the line itself. Swipes on a
 *   `user` or `narrator` line are ignored ([P13 §2.3] is about replies).
 * - **`hidden`**: SillyTavern's `is_system`, Marinara's `hiddenFromAI` —
 *   *not in the prompt*, which is not the same as *not in the chat*
 *   ([P13 §0.5]). Placed like any other line and hidden by `session.hidden`.
 * - **`hiddenByImport`**: hidden because the import has nowhere to keep the
 *   line as the source had it, *not because the source hid it* — a
 *   SillyTavern tool call's record, which SillyTavern sent to a model that
 *   could call tools and a turn here has no place for. Hidden the same way;
 *   kept apart only so the builder's `hiddenKept` note, which says the source
 *   hid what it counts, does not count it. The parser that sets it writes a
 *   note of its own saying what happened.
 * - **`batch`**: SillyTavern's `extra.gen_id`, the one mark a group generation
 *   shares (`group-chats.js:988`). Absent in single chats and in Marinara.
 * - **`foreignId`**: where this line is in the source — SillyTavern
 *   `"<chat path>#<index>"`, since its lines have no ids; Marinara's message
 *   id. Provenance, carried to `Turn.foreign`; never identity.
 */
export interface ChatMessage {
  role: 'user' | 'character' | 'narrator';
  text: string;
  reasoning?: string;
  speaker?: ForeignRef;
  persona?: ForeignRef;
  at: number | null;
  swipes?: readonly ChatSwipe[];
  activeSwipe?: number;
  hidden?: boolean;
  hiddenByImport?: true;
  batch?: string;
  foreignId: string;
  /**
   * What the source had established as of this line — its active swipe's, for
   * a reply with alternatives, each of which carries its own on
   * {@link ChatSwipe.state}. See {@link ChatStateValue}.
   */
  state?: readonly ChatStateValue[];
}

/**
 * ***One chat of a family*** — a SillyTavern `.jsonl`, a Marinara `chats` row.
 *
 * - **`id`** is the chat's own identity in its source: SillyTavern's path
 *   (`chats/<folder>/<name>.jsonl`, `group chats/<id>.jsonl` —
 *   `endpoints/chats.js:554`), Marinara's chat id. *Not* `chat_metadata.integrity`,
 *   which a branch inherits and which therefore names a family rather than a
 *   chat ([P13 §0.2]).
 * - **`name`** is what the chat is called, and becomes its `BranchRef`'s name.
 * - **`parentId`** is the back-pointer the family was grouped by: SillyTavern's
 *   `main_chat` resolved to a chat id, Marinara's `branchParentChatId`. ***The
 *   builder does not build the tree from it*** — content does that
 *   ([P13 §2.4]) — and only checks that it names a chat in the family.
 * - **`createdAt`**: milliseconds since the epoch, or null. Read only when the
 *   chat's first round has no time of its own.
 */
export interface ChatSourceChat {
  id: string;
  name: string;
  parentId?: string;
  messages: readonly ChatMessage[];
  createdAt: number | null;
}

/**
 * ***A chat and every chat that points back to it*** —
 * [P13 §2.5](../../../../../docs/design/workplan/30-p13-scene-and-session-import.md).
 * One family becomes one session.
 *
 * - **`key`** is the family's **root chat path**, exactly as [P13 §2.7] gives
 *   it: SillyTavern's `chats/<folder>/<file>.jsonl` or `group chats/<id>.jsonl`,
 *   Marinara's `storage/tables/chats.json#<chatId>` —
 *   `chats/Vera/2026-01-01.jsonl`, say. *Source-relative and unprefixed*, like
 *   every other `originalFilename` the library stamps (`stampImported`, which
 *   the sweep calls with the file's path under the source's root): which
 *   source it is, is `source`'s to say and not the key's. It is hashed into
 *   every turn id ([P13 §2.4]), and it is what §2.7's sync finds the session by
 *   (`origin.originalFilename`), so it must be the same string on every import
 *   of the same root — ***and its form is frozen with the id scheme***, since a
 *   key spelled differently later is a different family whose turns share no
 *   id with this one's.
 * - **`chats`**: the root first, then the rest. ***The order is part of the
 *   input and callers must keep it stable***: a node shared by two branches but
 *   not the root takes its time from whichever is visited first, and a time is
 *   part of an id. Copied chats copy their send times, so in practice the two
 *   agree — but only a caller ordering the rest by something that does not
 *   change (creation, then id) makes that more than a hope.
 * - **`name`**: the session's name.
 *
 * - **`roster`**: the members of a group, **in the group's own order**, when
 *   the source keeps a list of them apart from the lines — SillyTavern's
 *   `groups/<id>.json` `members` ([P13 §2.5]'s *"plus `groups/<id>.json`
 *   `members` for the roster"*), Marinara's chat `characterIds`. Absent for a
 *   single chat, and for a group chat whose group file did not come with it:
 *   then the cast is whoever the lines say spoke, in the order they first did,
 *   which is all the source left to go on. *Present, it is the cast's order and
 *   its floor*: every member is resolved and cast whether or not they ever
 *   spoke, because a member who was muted the whole chat, or joined and never
 *   got a word in, is still a member — and a muted one has to be in the cast
 *   for the presence that mutes them to name anybody (see
 *   {@link ChatSettings.muted}). Speakers the roster does not name — a
 *   `/sendas` stranger, a member removed since — follow it, in first-met order.
 *   ***Not hashed into any id***: who is in a group changes without a line of
 *   the chat changing, and a turn is its content ([P13 §2.4]).
 *
 * *Grouping is the caller's job, not the builder's.* Which chats are a family
 * depends on what the source holds, and a pointer to a chat the source does not
 * have is a decision the caller makes ([P13 §2.5]'s *"a root of its own"*); the
 * builder is handed the result and only says, with a note, when a chat's
 * `parentId` names nobody in it.
 */
export interface ChatFamily {
  source: 'sillytavern' | 'marinara';
  key: string;
  name: string;
  chats: readonly ChatSourceChat[];
  roster?: readonly ForeignRef[];
}

/** A library object as the session will name it. */
export interface ResolvedRef {
  id: string;
  name: string;
}

/**
 * ***What the library knows about the family's foreign references*** —
 * [P13 §2.5](../../../../../docs/design/workplan/30-p13-scene-and-session-import.md)'s
 * resolution, found by P13.8 and handed in, so that the builder stays pure.
 *
 * - **`speakers`**, by {@link ForeignRef.key}: the actor, or null when nothing
 *   was found. A key absent from the map reads as null — nothing is invented.
 * - **`persona`**: the family's persona, or null.
 * - **`lore`**: lorebook ids to link, SillyTavern's `chat_metadata.world_info`
 *   resolved.
 */
export interface ChatResolution {
  speakers: ReadonlyMap<string, ResolvedRef | null>;
  persona: ResolvedRef | null;
  lore: readonly string[];
}

/**
 * ***What the source says about how the chat is played*** —
 * [P13 §2.6](../../../../../docs/design/workplan/30-p13-scene-and-session-import.md),
 * each parser mapping its own settings onto these.
 *
 * *Not `sessions/chat-settings.ts`'s `ChatSettings`*, which is a session's
 * effective settings **read** under its mode, every member present. This is a
 * source's partial say **written** into a new session: any member it leaves out
 * takes the Scene chat default the builder writes (`build.ts`).
 *
 * - **`voice`, `dispatch`, `speakers`**: SillyTavern's `activation_strategy`
 *   and `allow_self_responses`, Marinara's `groupChatMode`,
 *   `groupResponseOrder` and `groupSpeakerNamesInHistory`, onto the fields
 *   [P13 §1.2] declares. `speakers` is partial so a parser says only what its
 *   source said.
 * - **`note`**: SillyTavern's `note_prompt`, `note_depth`, `note_interval`.
 * - **`hidden`**: foreign ids of lines to hide **in addition to** each line's
 *   own `hidden` flag — for a source that records hiding somewhere other than
 *   on the line.
 * - **`muted`**: {@link ForeignRef.key}s of members the source has switched
 *   off — SillyTavern's `disabled_members`, Marinara's `inactiveCharacterIds` —
 *   which [P13 §2.6] maps to presence `false`.
 *
 * ***Muted members are the one setting that is not a session field***, and
 * they were left out of this type until [P13.9] decided where they go.
 * Presence is the `se.presence` channel (`sessions/cast.ts`): state at a
 * node, written only by an effect on a turn, with `session.channels` a
 * derived cache of it at the head. So a mute is an effect or it is nothing —
 * and [P13 §2.2] has the builder write `effects: []` *"and nothing
 * fabricated"*. The builder's answer (`build.ts`, `mutedEffects`) is that
 * ***the source's own state is not a fabrication***: it writes, on each
 * opening turn, one applied `se.presence ← false` per muted member, proposed
 * by `engine` — the arm for a value the engine recorded rather than one a
 * model, a step or a person produced this session — and writes the matching
 * head cache, so the session opens with the room SillyTavern had. Everything
 * else §2.2 excludes stays excluded: no request, no cost, no tape, and no
 * effect the source did not state.
 */
export interface ChatSettings {
  voice?: NonNullable<SessionFile['voice']>;
  dispatch?: NonNullable<SessionFile['dispatch']>;
  speakers?: Partial<NonNullable<SessionFile['speakers']>>;
  note?: NonNullable<SessionFile['note']>;
  hidden?: readonly string[];
  muted?: readonly string[];
  /**
   * ***State the source keeps for the chat rather than for a message*** —
   * Marinara's agent switches (`activeAgentIds`, `manualTrackers`), [P13 §2.6]'s
   * *"the session's agent switches"*, added at [P13.5a]. Written on every
   * opening turn beside the muted members' presence and for their reason: the
   * source says it, a session keeps it only as state at a node, and the
   * opening is the one node every branch of the family inherits from.
   */
  state?: readonly ChatStateValue[];
}

/**
 * ***Everything the builder would otherwise take from the world*** — who is
 * importing, and when. Passed in so the build is a function of its arguments:
 * the same family, resolution and context give the same bytes ([P13.6]'s proof
 * obligation), which a clock or a session read could not.
 *
 * `account` is hashed into every turn id ([P13 §2.4]); `now` (ISO 8601) stamps
 * the session's own times and `exportedBy.at`.
 *
 * ***`modeId` is the mode the session is written into*** — Scene, by
 * [06 §1]'s *"SillyTavern/Marinara RP"* row — and it is an argument because
 * this module is engine code, and engine code spells no mode id
 * (`tools/repo-shape.test.ts`, *"the engine names no mode"*): a mode id written
 * here would be the engine knowing which modes exist, which is the bet
 * [19 §10] calls the design's central one. The caller names it through
 * `mode-registry.ts`, the one place with a reason to spell one.
 *
 * *Which constant the caller takes is P13.8's to decide, and it is not
 * obviously `DEFAULT_MODE_ID`.* That holds the same string today for a
 * different reason — it is the mode a session with none plays, and this is the
 * mode a chat is imported into — and if the default ever moved, imported chats
 * should not move with it. The door that calls this builder is where that
 * paragraph belongs, beside whatever it imports.
 */
export interface BuildContext {
  account: string;
  now: string;
  modeId: string;
}

/**
 * The builder's answer: a document `importSession` loads as it stands, and what
 * is worth telling the person about it — `ImportNote`s under `import.chat.*`,
 * which the review renders through `note-labels.ts`.
 */
export interface ChatBuild {
  document: SessionExport;
  notes: ImportNote[];
}
