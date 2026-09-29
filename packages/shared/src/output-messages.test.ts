// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { describe, expect, it } from 'vitest';

import { joinMessageTexts, outputFromMessages, outputMessagesOf } from './output-messages.js';
import type { OutputMessage } from './turn.js';

/**
 * ***`text` is derived, and both directions agree*** —
 * [P13 §1.1](../../../docs/design/workplan/30-p13-scene-and-session-import.md),
 * [P13.0](../../../docs/design/workplan/30-p13-scene-and-session-import.md).
 *
 * What these hold to account is the promise §1.1 makes to every reader that
 * predates `messages`: search, the summary chain, the memory extractor and an
 * older install read `text` and keep working. That is only true while the
 * writer's derivation and the reader's fallback are inverses of each other on
 * the one case they share — a single narrator message — and it is the kind of
 * property that stops being true when somebody changes one of them.
 */

const MARLOW = { id: 'actor-marlow', name: 'Marlow' };
const ELENA = { id: 'actor-elena', name: 'Elena' };

const ROUND: OutputMessage[] = [
  { speaker: null, text: 'Rain on the tin roof.' },
  { speaker: MARLOW, text: '"You came."', reasoning: 'He is relieved.', carried: true },
  { speaker: ELENA, text: '"I said I would."' },
];

describe('joinMessageTexts', () => {
  it('joins in order with a blank line, carried messages included', () => {
    expect(joinMessageTexts(ROUND)).toBe(
      'Rain on the tin roof.\n\n"You came."\n\n"I said I would."',
    );
  });

  it('is the text itself for one message, and empty for none', () => {
    expect(joinMessageTexts([{ speaker: null, text: 'Only this.' }])).toBe('Only this.');
    expect(joinMessageTexts([])).toBe('');
  });

  it('leaves out a message that said nothing, so no blank line doubles', () => {
    // A per-actor reply cleanup cut to nothing ([P13.2] review, 2026-09-29).
    expect(
      joinMessageTexts([
        { speaker: null, text: 'A' },
        { speaker: null, text: '', original: 'Ned: "Enough."' },
        { speaker: null, text: 'C' },
      ]),
    ).toBe('A\n\nC');
  });
});

describe('outputFromMessages', () => {
  it('derives text, and reasoning only from the messages that have some', () => {
    expect(outputFromMessages(ROUND)).toEqual({
      text: joinMessageTexts(ROUND),
      reasoning: 'He is relieved.',
      messages: ROUND,
    });
  });

  it('leaves reasoning absent when no message has any', () => {
    const output = outputFromMessages([{ speaker: ELENA, text: 'Hm.' }]);
    expect(output).not.toHaveProperty('reasoning');
  });

  /**
   * ***`original` is kept and never joined*** — [P13 §1.1]. It is what the
   * model returned before cleanup or the editor changed it, and `text` is what
   * the transcript shows; a derivation that joined `original` would put the
   * unedited reply back into everything that reads `text`.
   */
  it('keeps a message’s original on the message and out of the text', () => {
    const cleaned: OutputMessage = {
      speaker: MARLOW,
      text: '"You came."',
      original: 'Marlow: "You came."\nElena: "I said I would."',
    };
    const output = outputFromMessages([cleaned]);

    expect(output.text).toBe('"You came."');
    expect(output.messages).toEqual([cleaned]);
  });

  /**
   * *A copy, so a runner accumulating a round cannot reach into a record it
   * already checkpointed.* The falsifying mutation is `messages` stored by
   * reference.
   */
  it('copies the messages rather than holding the caller’s array', () => {
    const round = [{ speaker: MARLOW, text: 'One.' }];
    const output = outputFromMessages(round);
    round.push({ speaker: ELENA, text: 'Two.' });
    const first = round[0];
    if (first !== undefined) first.text = 'Changed.';

    expect(output.messages).toEqual([{ speaker: MARLOW, text: 'One.' }]);
  });
});

describe('outputMessagesOf', () => {
  it('prefers the messages when the turn has them', () => {
    expect(outputMessagesOf(outputFromMessages(ROUND))).toEqual(ROUND);
  });

  /**
   * ***Every turn written before P13.0 reads as one narrator message*** — and
   * `null` is an answer rather than a gap: a merged reply spoken by nobody in
   * particular is what the narrator is.
   */
  it('reads a turn with only text as one narrator message, reasoning kept', () => {
    expect(outputMessagesOf({ text: 'The door opened.' })).toEqual([
      { speaker: null, text: 'The door opened.' },
    ]);
    expect(outputMessagesOf({ text: 'The door opened.', reasoning: 'Keep it short.' })).toEqual([
      { speaker: null, text: 'The door opened.', reasoning: 'Keep it short.' },
    ]);
  });

  it('answers none for a turn that said nothing, not one empty message', () => {
    expect(outputMessagesOf(undefined)).toEqual([]);
  });

  /**
   * ***The two directions are inverses on the case they share.*** A pre-P13
   * turn read as messages and written back out is the turn it was, which is
   * what lets a later writer handle every turn one way.
   */
  it('round-trips a pre-P13 output through messages unchanged', () => {
    for (const output of [{ text: 'Plain.' }, { text: 'Plain.', reasoning: 'Why.' }]) {
      const { messages, ...derived } = outputFromMessages(outputMessagesOf(output));
      expect(derived).toEqual(output);
      expect(messages).toHaveLength(1);
    }
  });
});
