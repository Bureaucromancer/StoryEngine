// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import type { CardPromptPart, CastRow, ChatSettings, SwipeGroups } from '../api.js';

/**
 * ***The chat surface's arithmetic*** —
 * [P13 §1.8](../../../../docs/design/workplan/30-p13-scene-and-session-import.md),
 * built at [P13.5].
 *
 * Every decision the transcript, the cast panel and the composer make about a
 * chat that is not rendering: which lines are hidden and what a hide sends,
 * which siblings a message's counter counts, who may be asked to speak, and
 * what a card's prompt switch writes. **Here rather than in the components**,
 * for the reducer's reason: each is a statement about data, testable exactly,
 * and a component that computed one inline would be tested only through a DOM.
 */

/** A turn's hide entry, as the effective settings hold it. */
export type HiddenEntry = true | readonly number[] | undefined;

export function hiddenEntry(chat: ChatSettings | undefined, turnId: string): HiddenEntry {
  return chat?.hidden[turnId];
}

/** Whether one message of a turn is hidden — by its own index, or by the turn hidden whole. */
export function isMessageHidden(entry: HiddenEntry, index: number): boolean {
  return entry === true || entry?.includes(index) === true;
}

/**
 * ***What a hide or an unhide of one message sends*** — the turn's whole entry,
 * because the route sets rather than toggles ([P13.4]).
 *
 * *Unhiding one message of a turn hidden whole* keeps the rest hidden: the
 * entry becomes every other index. What it cannot keep is the input, which only
 * a whole-turn hide covers — and that is the honest reading of the gesture,
 * since the person pointed at a reply, not at their own move. *Hiding every
 * message one by one* stays a list rather than becoming `true`, for the same
 * reason in the other direction: nobody asked to hide the move.
 */
export function hideSent(
  entry: HiddenEntry,
  index: number,
  count: number,
  hide: boolean,
): boolean | number[] {
  const held =
    entry === true
      ? Array.from({ length: count }, (_, at) => at)
      : entry === undefined
        ? []
        : [...entry];
  const next = hide ? [...new Set([...held, index])] : held.filter((at) => at !== index);
  next.sort((a, b) => a - b);
  return next.length === 0 ? false : next;
}

/**
 * ***The siblings a message's counter counts*** — [P13 §1.6]: *"the sibling
 * strip for siblings that differ only from message k is drawn on message k"*.
 *
 * The server groups them (`swipeGroups`): the siblings that answer the same
 * move and say the same messages before *k*, one alternative per distinct
 * message *k*, ordered by the first-created sibling saying it. That is a set
 * every member agrees on, so the count reads *2 of 3* the same from whichever
 * of them is on screen, and stepping one way and back returns to the line it
 * started on. **The last message also carries the alternatives that go on past
 * it** — the round a branch was cut from — because the turn has no message
 * there to draw them on. Fewer than two is no counter.
 */
export function messageSiblings(
  groups: SwipeGroups | undefined,
  index: number,
  last: boolean,
): string[][] {
  if (groups === undefined) return [];
  const here = groups.messages[index] ?? [];
  const beyond = last ? (groups.messages[index + 1] ?? []) : [];
  return [here, beyond].filter((ids) => ids.length >= 2);
}

/**
 * ***The siblings the turn's own strip keeps*** — the ones that answer a
 * different move, which no message's counter can hold. A turn not drawn as a
 * chat keeps them all, as it did before [P13.5]: a prose turn's siblings are
 * redos of the whole of it.
 */
export function turnSiblings(
  siblings: readonly string[],
  groups: SwipeGroups | undefined,
  chatShaped: boolean,
): string[] {
  if (!chatShaped || groups === undefined) return [...siblings];
  return [...groups.turn];
}

/**
 * ***Who may be asked to speak*** — force-talk's three grounds ([P13 §1.3]):
 * seated, not the persona, and not dead or departed. **Muted members may**:
 * that is what *speak* is for, and it is SillyTavern's `force_chid` bypassing
 * `disabled_members`.
 */
export function canSpeak(
  row: Pick<CastRow, 'actorId' | 'status'>,
  roster: { persona: string | null; actors: readonly string[] } | undefined,
): boolean {
  if (roster === undefined) return false;
  if (row.actorId === roster.persona) return false;
  if (!roster.actors.includes(row.actorId)) return false;
  return row.status !== 'dead' && row.status !== 'departed';
}

/**
 * ***Whether anybody would answer a turn nobody was named for*** — [P13.4]'s
 * note to this stage: *"a turn with no input and no reply happens only when
 * nobody in the cast is eligible, and the composer should not offer that
 * send, or should say it will get no reply."* Eligible is `canSpeak` and
 * present.
 */
export function anyoneWouldReply(
  rows: readonly CastRow[],
  roster: { persona: string | null; actors: readonly string[] } | undefined,
): boolean {
  return rows.some((row) => row.presence && canSpeak(row, roster));
}

/** The card prompt parts a session skips for one member. Absent skips none. */
export function skippedParts(chat: ChatSettings | undefined, actorId: string): CardPromptPart[] {
  const entry = chat?.prompts.cards[actorId];
  if (entry === undefined) return [];
  if (entry === false) return [...CARD_PARTS];
  return [...entry];
}

export const CARD_PARTS: readonly CardPromptPart[] = ['system', 'post-history', 'depth'];

/**
 * ***What one card switch writes*** — the member's whole entry after the change:
 * `true` for *send everything* (the file's no entry), `false` for every part
 * skipped, which is [P13 §1.5]'s *"cards[actorId]: false skips that card's
 * prompts entirely"*, and otherwise the parts skipped.
 */
export function cardSwitch(
  skipped: readonly CardPromptPart[],
  part: CardPromptPart,
  send: boolean,
): boolean | CardPromptPart[] {
  const next = send ? skipped.filter((one) => one !== part) : [...new Set([...skipped, part])];
  if (next.length === 0) return true;
  if (CARD_PARTS.every((one) => next.includes(one))) return false;
  return CARD_PARTS.filter((one) => next.includes(one));
}

/**
 * ***A card's talkativeness*** — `modeData[modeId].talkativeness`, SillyTavern's
 * 0-to-1 chance of joining a `natural` round, default 0.5 ([P13 §1.3]).
 *
 * *Read through the session's mode id*, as the runner reads it: talkativeness
 * is how a mode plays a card, and a client naming Scene's key would be that
 * mode's behaviour living where no other mode could have it. A string reads as
 * a number, as the importer's does; anything else is the default.
 */
export const TALKATIVENESS_DEFAULT = 0.5;

export function talkativenessOf(object: Record<string, unknown>, modeId: string): number {
  const modeData = object['modeData'];
  if (typeof modeData !== 'object' || modeData === null) return TALKATIVENESS_DEFAULT;
  const own = (modeData as Record<string, unknown>)[modeId];
  if (typeof own !== 'object' || own === null) return TALKATIVENESS_DEFAULT;
  const raw = (own as Record<string, unknown>)['talkativeness'];
  const value = typeof raw === 'string' ? Number(raw) : raw;
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.min(Math.max(value, 0), 1)
    : TALKATIVENESS_DEFAULT;
}

/** The card with its talkativeness set, everything else in `modeData` kept. */
export function withTalkativeness(
  object: Record<string, unknown>,
  modeId: string,
  value: number,
): Record<string, unknown> {
  const modeData =
    typeof object['modeData'] === 'object' && object['modeData'] !== null
      ? (object['modeData'] as Record<string, unknown>)
      : {};
  const own =
    typeof modeData[modeId] === 'object' && modeData[modeId] !== null
      ? (modeData[modeId] as Record<string, unknown>)
      : {};
  return { ...object, modeData: { ...modeData, [modeId]: { ...own, talkativeness: value } } };
}

/**
 * ***Where each message sits in `output.text`*** — so the mention overlay can
 * be drawn per message ([P13.5]).
 *
 * The spans a turn carries are offsets into `output.text`, which is the
 * messages' texts joined by a blank line with the empty ones left out
 * (`joinMessageTexts`). A message's start is therefore the sum of the texts
 * before it plus two for each join; an empty message has no place and gets
 * null. *Derived rather than stored*, because the join is the one rule both
 * sides already share.
 */
export function messageOffsets(texts: readonly string[]): (number | null)[] {
  let at = 0;
  let first = true;
  return texts.map((text) => {
    if (text.length === 0) return null;
    if (!first) at += 2;
    first = false;
    const start = at;
    at += text.length;
    return start;
  });
}
