// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import type { ChatMessage } from './types.js';

/**
 * ***A round is a turn*** —
 * [P13 §2.2](../../../../../docs/design/workplan/30-p13-scene-and-session-import.md),
 * which follows [P13 §1.1](../../../../../docs/design/workplan/30-p13-scene-and-session-import.md)
 * exactly, *"so an import is a session Part A could have produced"*.
 *
 * A turn here is one node however many messages it emits
 * ([25 C11](../../../../../docs/design/25-open-questions.md)): the player's line
 * and every reply to it. A foreign chat is a flat list of lines, so the first
 * thing an import has to do is find the rounds in it — and the whole of what
 * this module decides is **where one round ends and the next begins**:
 *
 * | Lines | Round |
 * |---|---|
 * | a `user` line, then the replies until the next `user` line **or a change of SillyTavern batch** | input + messages |
 * | replies with no `user` line before them — a greeting, auto-mode, a force-talk, a Marinara empty send | output-only |
 * | a `user` line nobody answered | input-only |
 * | a narrator line | a message, in whichever round it falls |
 *
 * ***A batch boundary is SillyTavern's own, read the way SillyTavern reads
 * it.*** `gen_id` is minted once per group generation (`group-chats.js:988`),
 * so a force-talked member after a round is a new batch and becomes its own
 * output-only turn, exactly as Part A would record it. When SillyTavern itself
 * walks back over a round to regenerate it (`regenerateGroup`,
 * `group-chats.js:172`), it stops at a line whose `gen_id` differs from the
 * round's — **and only when both have one**. So does this: a narrator line or a
 * line written before `gen_id` existed carries none, and it falls into the round
 * it sits in rather than splitting it. Where there is no batch at all — single
 * chats, Marinara — consecutive replies simply fold into the round.
 *
 * ***Nothing is dropped, hidden lines included.*** A hidden line is placed like
 * any other and the builder hides it afterwards. That is forced by
 * [P13 §2.7] as much as chosen: hiding is mutable session state there, and an
 * *unhide* in SillyTavern has to arrive on the next import as a changed flag on
 * the same turn. If hiding moved round boundaries, an unhide would change the
 * rounds, and so the turn ids, and a sync would fork the session over a ghost
 * icon.
 */

/** One round: the player's line, if any, and the replies that answered it. */
export interface Round {
  /**
   * ***The line that opened the round*** — the `user` line, or the first reply
   * of an output-only round. It gives the turn its foreign id and — with its
   * swipes, when it is a reply — its time (`build.ts`'s `roundTime`), and it
   * is a field rather than something a reader works out because *a round is
   * never empty* is this function's promise, and a promise is better kept in a
   * type than re-checked by every caller.
   */
  opening: ChatMessage;
  input: ChatMessage | null;
  /** `character` and `narrator` lines, in order. Empty for an input-only round. */
  replies: ChatMessage[];
}

/**
 * The rounds of one chat, in order. Pure, and total: every line lands in
 * exactly one round, and a round always holds at least one line.
 */
export function roundsOf(messages: readonly ChatMessage[]): Round[] {
  const rounds: Round[] = [];
  let current: (Round & { batch: string | undefined }) | null = null;

  for (const message of messages) {
    if (message.role === 'user') {
      current = { opening: message, input: message, replies: [], batch: undefined };
      rounds.push(current);
      continue;
    }

    /**
     * *The round's batch is the last one seen in it*, so a narrator line between
     * two lines of one generation does not reset it, and the first batched reply
     * to a `user` line adopts its batch rather than being split off from the
     * line it answers.
     */
    const newBatch =
      current !== null &&
      message.batch !== undefined &&
      current.batch !== undefined &&
      message.batch !== current.batch;
    if (current === null || newBatch) {
      current = { opening: message, input: null, replies: [], batch: undefined };
      rounds.push(current);
    }
    current.replies.push(message);
    if (message.batch !== undefined) current.batch = message.batch;
  }

  // The working `batch` is this function's own bookkeeping, and a caller that
  // serialised a round must not find it there.
  return rounds.map(({ opening, input, replies }) => ({ opening, input, replies }));
}
