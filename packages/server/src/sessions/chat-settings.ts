// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { PARTICIPANT_SELECTORS, type ModeDefinition } from '@storyengine/sdk';

import type { CardPromptPart, SessionFile } from './types.js';

/**
 * ***How a session plays as a chat, read out of whatever is in the file*** —
 * [P14 §1.2](../../../../docs/design/workplan/31-p14-scene-and-session-import.md),
 * [P14 §1.5](../../../../docs/design/workplan/31-p14-scene-and-session-import.md),
 * [P14 §1.6](../../../../docs/design/workplan/31-p14-scene-and-session-import.md),
 * added at [P14.0].
 *
 * **The one reader of the chat fields**, and there has to be exactly one,
 * because what a missing field means is not a local question. `voice`,
 * `dispatch` and `speakers` default to the mode's values — but *which* values
 * depends on when the file was written, and only a function that sees all three
 * at once can tell. A caller reading `session.voice ?? mode.voice` would be
 * right today and would silently re-voice every pre-P14 Scene session on the
 * day Scene's declared values change, which is the failure `ModeDefinition.legacy`
 * exists to prevent.
 *
 * ***The rule, in order:***
 *
 * 1. **A field present on the session wins.** It is a setting somebody chose,
 *    or one creation wrote down from the mode on the day the session was made.
 * 2. **A session with none of the three reads the mode's `legacy`**, when the
 *    mode declares one. From P14.0 on, creation writes all three explicitly,
 *    so *none of them* is precisely the set of sessions written before — and
 *    they keep what they were played with.
 * 3. **Otherwise the mode's declared values**: `voice`, `dispatch` and
 *    `participants.select`.
 *
 * *Presence means the key is there*, not that its value is usable. A pre-P14
 * file has none of these keys at all; a file carrying a misspelt `voice` was
 * written or edited since, and is read as a modern session with one field that
 * falls to its default. Deciding the era from whether a value *parsed* would
 * let one typo move a session between eras — and move its other two fields
 * with it.
 *
 * ***Tolerant, field by field, and never throwing*** — `readMemoryConfig`'s
 * posture, and for its reason: `readSession` validates nothing
 * beyond the id being a string, and hand-editing `session.json` is a supported
 * way to get data in ([03 §5.1](../../../../docs/design/03-data-model.md)). A
 * malformed field falls to its default, and a session somebody mistyped still
 * opens and still plays.
 */

/** The speaker policy as it is read — every member present. */
export type SpeakerSettings = NonNullable<SessionFile['speakers']>;

export interface ChatSettings {
  voice: NonNullable<SessionFile['voice']>;
  dispatch: NonNullable<SessionFile['dispatch']>;
  speakers: SpeakerSettings;
  /** The author's note, or null when the session has none. */
  note: NonNullable<SessionFile['note']> | null;
  /** Turn id to *the whole turn* or *these message indices*. Empty hides nothing. */
  hidden: Readonly<Record<string, true | readonly number[]>>;
  prompts: {
    /** Whether the pack's own instruction is sent. `false` only when a person turned it off. */
    instruction: boolean;
    /** Per actor: every card prompt skipped (`false`), or the parts listed. Absent sends all. */
    cards: Readonly<Record<string, false | readonly CardPromptPart[]>>;
  };
}

/**
 * The three speaker settings a mode does not declare, and what they are when
 * nobody has said.
 *
 * - `allowSelfResponses: false` — SillyTavern's own default: the member who
 *   just spoke is not picked again unless a person allows it.
 * - `namesInHistory: 'groups'` — a name prefix once two or more speakers are in
 *   the window, which is SillyTavern's default names behaviour ([P14 §1.5]).
 * - `maxPerRound: 3` — [P14 §1.2]'s default for how many a `smart` pick may
 *   choose.
 */
export const SPEAKER_DEFAULTS: Omit<SpeakerSettings, 'policy'> = {
  allowSelfResponses: false,
  namesInHistory: 'groups',
  maxPerRound: 3,
};

/**
 * Where an author's note sits and how often, when a note says only its text.
 * Depth 4 is the default [P14 §1.5] gives a card's own depth prompt, so the two
 * kinds of depth-placed text agree unless somebody says otherwise; every 1 is
 * *every input*, the only reading of a missing interval under which a note is
 * ever seen.
 *
 * *A missing or unreadable interval, that is — not a zero.* An interval of 0 or
 * less is a note switched off, and `noteOf` reads it as `every: 0` rather than
 * as this default; see there.
 */
const NOTE_DEFAULTS = { depth: 4, every: 1 } as const;

const VOICES: readonly ChatSettings['voice'][] = ['narrator', 'embodied'];
const DISPATCHES: readonly ChatSettings['dispatch'][] = ['merged', 'per-actor'];
const NAMES_IN_HISTORY: readonly SpeakerSettings['namesInHistory'][] = [
  'never',
  'groups',
  'always',
];
const CARD_PROMPT_PARTS: readonly CardPromptPart[] = ['system', 'post-history', 'depth'];

/**
 * ***What a session is created with*** — the three fields creation writes
 * explicitly, from the mode's **declared** values.
 *
 * **Written rather than left absent, and that is rule 2 above made safe.** A
 * session created now keeps the voice it was created with when a later stage
 * changes what the mode declares — and it is the reason *none of the three*
 * can mean *written before P14.0*. The legacy values are deliberately not
 * consulted: they describe old files, and a new session is not one.
 */
export function chatSettingsAtCreation(
  mode: ModeDefinition,
): Required<Pick<SessionFile, 'voice' | 'dispatch' | 'speakers'>> {
  return {
    voice: mode.voice,
    dispatch: mode.dispatch,
    speakers: { policy: mode.participants.select, ...SPEAKER_DEFAULTS },
  };
}

/**
 * The effective chat settings of a session under its mode.
 *
 * `session` is read as `unknown` for `readMemoryConfig`'s reason: the type is
 * what the file ought to hold, and what this function exists to establish.
 */
export function chatSettingsOf(session: unknown, mode: ModeDefinition): ChatSettings {
  const file: Record<string, unknown> =
    typeof session === 'object' && session !== null ? (session as Record<string, unknown>) : {};

  const declared = {
    voice: mode.voice,
    dispatch: mode.dispatch,
    select: mode.participants.select,
  };
  const predates =
    file['voice'] === undefined && file['dispatch'] === undefined && file['speakers'] === undefined;
  const era = predates ? (mode.legacy ?? declared) : declared;

  return {
    voice: oneOf(file['voice'], VOICES) ?? era.voice,
    dispatch: oneOf(file['dispatch'], DISPATCHES) ?? era.dispatch,
    speakers: speakersOf(file['speakers'], era.select),
    note: noteOf(file['note']),
    hidden: hiddenOf(file['hidden']),
    prompts: promptsOf(file['prompts']),
  };
}

/**
 * ***Whether this session reads an untouched member as present*** — the
 * mode's `participants.castIsPresent`, **in an embodied session only**
 * (2026-09-29, the [P14.3] review).
 *
 * `castIsPresent` is a statement about how the mode's *chat* reads presence:
 * a group whose members are all here until somebody mutes one. A narrated
 * session is not that chat. Its presence channel still means what it meant
 * before P14.3 — *in this room or not*, `init: false`, written by the model
 * as people walk in and out — and [P7.3] decided that a member who is not in
 * the room keeps their card in the narrator's call. Read through the mode
 * alone, every narrated Scene session — `legacy`, and the ones P14.0 created
 * with explicit narrator values — changed under it at P14.3: a member the
 * story had walked out lost every card from the one merged call, and every
 * member nobody had touched moved from *Elsewhere* to *Here* on the panel.
 * Tying the reading to the voice keeps those sessions' prompts byte-identical,
 * which is what `legacy` exists to promise.
 *
 * *The collector's cards and the cast panel ask this.* The runner's speaker
 * selection keeps the mode's flag, because it runs only in an embodied voice,
 * where the two agree.
 */
export function castIsPresentFor(chat: Pick<ChatSettings, 'voice'>, mode: ModeDefinition): boolean {
  return mode.participants.castIsPresent === true && chat.voice === 'embodied';
}

/**
 * ***Whether a mode plays its cast as a chat*** — the test the session read
 * route uses to send the chat settings and the settings route uses to accept
 * them ([P14.5]).
 *
 * **`castIsPresent`, not the voice**, because the voice is a setting the chat
 * owns: a Scene session switched to the narrator is still a chat that can be
 * switched back, and *"narrator stays one control away"* ([P14 §1.2]) needs
 * the control to survive being used. The assistant is embodied and not a chat
 * — one card, `fixed`, nobody to choose between — and Freeform narrates a
 * cast it never seats as speakers; neither declares that an untouched member is
 * in the room, which is the one declaration only a chat makes.
 */
export function isChatMode(mode: ModeDefinition): boolean {
  return mode.participants.castIsPresent === true;
}

/**
 * The speaker policy, **member by member**: a partial object — one somebody
 * wrote by hand with only the policy they wanted — keeps what it says and
 * takes the rest from the defaults, rather than being thrown away whole for
 * the members it left out.
 */
function speakersOf(value: unknown, select: SpeakerSettings['policy']): SpeakerSettings {
  const held = isRecord(value) ? value : {};
  const allowSelfResponses = held['allowSelfResponses'];
  const maxPerRound = held['maxPerRound'];
  return {
    policy: oneOf(held['policy'], PARTICIPANT_SELECTORS) ?? select,
    allowSelfResponses:
      typeof allowSelfResponses === 'boolean'
        ? allowSelfResponses
        : SPEAKER_DEFAULTS.allowSelfResponses,
    namesInHistory:
      oneOf(held['namesInHistory'], NAMES_IN_HISTORY) ?? SPEAKER_DEFAULTS.namesInHistory,
    maxPerRound: isCount(maxPerRound, 1) ? maxPerRound : SPEAKER_DEFAULTS.maxPerRound,
  };
}

/**
 * The author's note. **No text is no note**: depth and interval are where and
 * how often, and without something to place there is nothing for them to
 * describe. A usable text with a malformed depth or interval keeps the text.
 *
 * ***An interval of 0 or less is a note switched off, and reads as
 * `every: 0`.*** That is SillyTavern's meaning — `setFloatingPrompt` inserts
 * nothing when `note_interval <= 0` (`authors-note.js:351`), and the field is
 * labelled *"0 = Disable, 1 = Always"* — and [P14 §2.6] maps `note_interval`
 * straight onto `every`. Read as malformed, it fell to the default of 1, so a
 * converter copying the value across and a person typing 0 to silence the note
 * both got a note on **every** input: the opposite of what either asked for.
 *
 * *Switched off rather than dropped*, because switching a note off is not
 * deleting it: the text survives, so a settings panel built on this reader
 * still shows the note, and saving it cannot write over what was kept. The
 * renderer ([P14.3]) places no note whose `every` is 0. Any other interval that
 * is not a whole number — missing, fractional, a string — is still the default.
 */
function noteOf(value: unknown): ChatSettings['note'] {
  if (!isRecord(value)) return null;
  const { text, depth, every } = value;
  if (typeof text !== 'string' || text.length === 0) return null;
  return {
    text,
    depth: isCount(depth, 0) ? depth : NOTE_DEFAULTS.depth,
    every: isCount(every, 1) ? every : isSwitchedOff(every) ? 0 : NOTE_DEFAULTS.every,
  };
}

/** A whole-number interval of 0 or less — SillyTavern's *disabled*. */
function isSwitchedOff(value: unknown): boolean {
  return typeof value === 'number' && Number.isInteger(value) && value <= 0;
}

/**
 * The hide map, **entry by entry**: an entry that is neither `true` nor a list
 * of message indices is dropped, and so is an index that is not one. What
 * survives is exactly what a reader can act on — and a hand edit that broke one
 * entry has not unhidden the rest.
 */
function hiddenOf(value: unknown): ChatSettings['hidden'] {
  if (!isRecord(value)) return {};
  const hidden: Record<string, true | readonly number[]> = {};
  for (const [turnId, entry] of Object.entries(value)) {
    if (entry === true) {
      hidden[turnId] = true;
    } else if (Array.isArray(entry)) {
      const indices = (entry as unknown[]).filter((index): index is number => isCount(index, 0));
      // An empty list hides nothing, which is the same as no entry.
      if (indices.length > 0) hidden[turnId] = indices;
    }
  }
  return hidden;
}

/**
 * What the chat has switched off. **Only `false` switches anything off**, which
 * is [P14 §1.5]'s *absent means send everything* applied to a malformed value
 * as well as to a missing one: a toggle nobody can read is a toggle nobody set.
 */
function promptsOf(value: unknown): ChatSettings['prompts'] {
  const held = isRecord(value) ? value : {};
  const cards: Record<string, false | readonly CardPromptPart[]> = {};
  const listed = held['cards'];
  if (isRecord(listed)) {
    for (const [actorId, entry] of Object.entries(listed)) {
      if (entry === false) {
        cards[actorId] = false;
      } else if (Array.isArray(entry)) {
        const parts = (entry as unknown[]).flatMap((part) => {
          const known = oneOf(part, CARD_PROMPT_PARTS);
          return known === null ? [] : [known];
        });
        // Skipping no parts is sending all of them, which is no entry.
        if (parts.length > 0) cards[actorId] = parts;
      }
    }
  }
  return { instruction: held['instruction'] !== false, cards };
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[]): T | null {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value)
    ? (value as T)
    : null;
}

/** A whole number no smaller than `least` — a depth, an interval, an index, a cap. */
function isCount(value: unknown, least: number): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= least;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * ***Whether the author's note is placed on this input*** — [P14 §1.5],
 * [P14.3]: SillyTavern's `setFloatingPrompt` (`authors-note.js:324-392`), to
 * its letter.
 *
 * `inputs` is how many of the player's messages the chat holds **counting the
 * one being answered** — ST counts `is_user` messages after the new one is in
 * the chat, and counts hidden ones too (hiding sets `is_system`, not
 * `is_user`). Then:
 *
 * - an interval of 0 or less is a note switched off (`:351`), text kept;
 * - an interval of 1 is every input, *even the first turn of a chat the player
 *   has not spoken in* — ST forces its count to 1 (`:347-349`);
 * - otherwise the note goes in when the count is a multiple of the interval
 *   (`:358-361`), so an interval of 3 places it on the 3rd, 6th, 9th input,
 *   and never before the 3rd.
 */
export function noteDue(
  note: ChatSettings['note'],
  inputs: number,
): { text: string; depth: number } | null {
  if (note === null || note.every <= 0) return null;
  const count = note.every === 1 ? 1 : inputs;
  if (count <= 0 || count < note.every || count % note.every !== 0) return null;
  return { text: note.text, depth: note.depth };
}
