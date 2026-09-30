// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { outputMessagesOf, type OutputMessage, type Turn } from '@storyengine/shared';

/**
 * ***Where a path turn's siblings are drawn*** — the counter on each message,
 * and the turn's own strip.
 *
 * - `messages[k]` is the ordered alternatives on message *k*'s counter, the
 *   turn itself among them, or `[]` when there is only one. It has **one more
 *   entry than the turn has messages**: the last is the alternatives that say
 *   everything this turn says and then go on (the round a branch-at-a-message
 *   was cut from), which a client draws on the turn's last message because
 *   there is no message *k* to draw them on.
 * - `turn` is the turn and every sibling that answers a different move, or
 *   `[]` when there is only the turn.
 */
export interface SwipeGroups {
  messages: string[][];
  turn: string[];
}

/**
 * ***Which alternatives each message's counter holds*** —
 * [P14 §1.6](../../../../docs/design/workplan/31-p14-scene-and-session-import.md)'s
 * *"swipes surface on the message, not the turn. The sibling strip for siblings
 * that differ only from message k is drawn on message k"*, built at [P14.5].
 *
 * ***Grouped by what the siblings say, not the `carried` flag***, because a
 * swipe's family is wider than what one sibling carried. A swipe of message 2
 * carries 0..1 from the turn it named, and the turn it named carried nothing —
 * yet both belong on message 2's counter, beside every other swipe of it. It
 * also answers an import, whose swipes were never swiped here and carry no
 * flag.
 *
 * ***The same counter from whichever member is on screen.*** The first cut
 * placed each sibling relative to the viewing turn, so a message-1 swipe saw
 * a message-2 swipe of the original as an alternative the original itself did
 * not show: *2 of 2* from one side, *3 of 3* from the other, and stepping
 * forward then back did not return. So the counter on message *k* is built
 * from a set every member agrees on — the siblings answering the same move
 * and saying the same messages `0..k-1` — and within it,
 *
 * - **one alternative per distinct message *k*** (by speaker and text): two
 *   siblings that differ only later are the same reply here, and the later
 *   message's counter tells them apart;
 * - **ordered by the first-created sibling saying it**, which no viewer can
 *   change;
 * - **named by the viewing turn where it says that line, and otherwise by the
 *   first-created**, so stepping to an alternative lands somewhere fixed.
 *
 * A sibling that answers a **different move** — an edit of the input, or
 * another thing typed from the same place — is not a swipe of anything the
 * turn said, and the turn's own strip keeps it.
 *
 * **Computed on the server because only it holds the siblings**: the
 * transcript sends the path, and the siblings are ids. A client asking for
 * each one would be a request per alternative on every page load.
 */
export function swipeGroups(turn: Turn, siblings: readonly Turn[]): SwipeGroups {
  const own = outputMessagesOf(turn.output);
  const same = siblings.filter((sibling) => sibling.id === turn.id || sameMove(turn, sibling));
  const said = new Map(same.map((sibling) => [sibling.id, outputMessagesOf(sibling.output)]));
  const messages: string[][] = [];
  for (let k = 0; k <= own.length; k += 1) {
    // `siblings` is creation order, so the first member seen for a line is the
    // first-created sibling saying it — the group's order and its default name.
    const groups = new Map<string, string>();
    for (const sibling of same) {
      const theirs = said.get(sibling.id) ?? [];
      if (sharedPrefix(own, theirs) < k) continue;
      const line = lineKey(theirs[k]);
      const held = groups.get(line);
      if (held === undefined || sibling.id === turn.id) groups.set(line, sibling.id);
    }
    messages.push(groups.size < 2 ? [] : [...groups.values()]);
  }
  const other = siblings.filter((sibling) => sibling.id === turn.id || !sameMove(turn, sibling));
  return { messages, turn: other.length < 2 ? [] : other.map((sibling) => sibling.id) };
}

/** Whether two turns answer the same move — both none, or the same words by the same hand. */
function sameMove(one: Turn, other: Turn): boolean {
  if (one.input === undefined || other.input === undefined) {
    return one.input === undefined && other.input === undefined;
  }
  return one.input.text === other.input.text && one.input.actorId === other.input.actorId;
}

function sharedPrefix(one: readonly OutputMessage[], other: readonly OutputMessage[]): number {
  let at = 0;
  while (at < one.length && at < other.length && sameLine(one[at], other[at])) at += 1;
  return at;
}

function sameLine(one: OutputMessage | undefined, other: OutputMessage | undefined): boolean {
  if (one === undefined || other === undefined) return false;
  return one.text === other.text && (one.speaker?.id ?? null) === (other.speaker?.id ?? null);
}

/**
 * One message as a map key — speaker and text, which is `sameLine`'s identity.
 * A sibling with no message *k* is its own alternative there: the round that
 * stopped before it.
 */
function lineKey(message: OutputMessage | undefined): string {
  if (message === undefined) return 'absent'; // JSON keys open with `[`, so this cannot collide
  return JSON.stringify([message.speaker?.id ?? null, message.text]);
}
