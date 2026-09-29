// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import type { OutputMessage, Turn } from './turn.js';

/**
 * ***A turn's output as messages, and as the text every older reader reads*** —
 * [P13 §1.1](../../../docs/design/workplan/30-p13-scene-and-session-import.md),
 * [P13.0](../../../docs/design/workplan/30-p13-scene-and-session-import.md).
 *
 * **Beside the turn record and not part of it**, which is `remedy.ts`'s
 * arrangement and for the same reason: `turn.ts` is pure types by its own
 * header's rule, and these are functions over what it declares.
 *
 * ***Why a module for three small functions.*** `Turn.output.text` became
 * *derived* when `messages` arrived, and a derived value is only as good as the
 * agreement between everything that derives it. The runner derives it when a
 * step returns messages; P13's later stages derive it again — a hand-authored
 * edit, a swipe that carries messages from its sibling, a SillyTavern group
 * round converted on import — and the client derives the other direction when
 * it renders a transcript that predates the field. **One function per
 * direction is what keeps those from being five opinions about the separator.**
 * In `shared` because the writers are on the server and one reader is in the
 * browser, which is the same argument `remedy.ts` makes for itself.
 */

/**
 * The separator, stated once. A blank line, because that is how two paragraphs
 * are told apart in every place `text` is shown or searched — and so a reader
 * that knows nothing of messages shows a group round as the paragraphs it is,
 * rather than as one run-on block.
 */
const BETWEEN_MESSAGES = '\n\n';

/**
 * `Turn.output.text` for a turn that has `messages` — their texts, in order,
 * joined by a blank line.
 *
 * *Every message counts, carried ones included.* `carried` says who did the
 * work, not what the turn says: a swipe's output is the whole round as it now
 * stands, and a reader of `text` is reading the round.
 */
export function joinMessageTexts(messages: readonly OutputMessage[]): string {
  return messages.map((message) => message.text).join(BETWEEN_MESSAGES);
}

/**
 * ***The output a writer records for a list of messages***, with `text` — and
 * `reasoning`, when any message has some — derived from them.
 *
 * **`reasoning` is derived by the same rule as `text`, and for the same
 * reason.** A turn-level `reasoning` written beside messages that carry their
 * own would be a second account of the same thinking, free to disagree with the
 * first; deriving it leaves one account and a projection of it for readers that
 * predate the field. Absent when no message has any, which is what the record
 * has always meant by absent.
 *
 * *The messages are copied*, so a caller that goes on to mutate its own array —
 * a runner accumulating a round — cannot reach into a record that was already
 * checkpointed.
 */
export function outputFromMessages(
  messages: readonly OutputMessage[],
): NonNullable<Turn['output']> {
  const thought = messages.flatMap((message) =>
    message.reasoning === undefined ? [] : [message.reasoning],
  );
  return {
    text: joinMessageTexts(messages),
    ...(thought.length === 0 ? {} : { reasoning: thought.join(BETWEEN_MESSAGES) }),
    messages: messages.map((message) => ({ ...message })),
  };
}

/**
 * ***What a turn said, as messages, whenever it was written*** — the reader's
 * half.
 *
 * - **`messages`, when the turn has them.** They are the record; `text` is a
 *   projection of them for readers that do not know this function.
 * - **One narrator message, when it has only `text`** — every turn written
 *   before [P13.0], and every turn a merged narrator call still writes. That is
 *   not a guess about who spoke: `speaker: null` *is* the narrator, and a
 *   single merged reply spoken by nobody in particular is exactly what
 *   `StepCallRequest.actorId`'s absence has always meant.
 * - **None, when there is no output** — a turn that failed before anything was
 *   said, or a channel write that never ran a model. Empty rather than one empty
 *   message, because *nothing was said* and *somebody said nothing* are
 *   different facts and a transcript draws them differently.
 */
export function outputMessagesOf(output: Turn['output']): OutputMessage[] {
  if (output === undefined) return [];
  if (output.messages !== undefined) return output.messages;
  return [
    {
      speaker: null,
      text: output.text,
      ...(output.reasoning === undefined ? {} : { reasoning: output.reasoning }),
    },
  ];
}
