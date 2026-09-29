// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { describe, expect, it } from 'vitest';

import type { TurnRecord } from '../api.js';
import { attribution, passages, toMarkdown, toPlainText } from './prose.js';

/**
 * The model behind three renderings —
 * [10 §12.2](../../../../docs/design/10-ui-surfaces.md), [P11.1].
 *
 * §12.2 ships HTML, Markdown and plain text, and the reason they share a model
 * is that three hand-written traversals disagree. **So what is asserted here is
 * the agreement**, not the wording: the same session read three ways names the
 * same speakers in the same order and loses nothing.
 */

function turn(over: Partial<TurnRecord> & { id: string }): TurnRecord {
  return {
    sessionId: 's',
    parentTurnId: null,
    createdAt: '2026-09-17T00:00:00.000Z',
    status: 'complete',
    ...over,
  } as TurnRecord;
}

const NAMES: Record<string, string> = { 'actor-vera': 'Vera' };
const nameOf = (id: string): string | null => NAMES[id] ?? null;

describe('turns become passages', () => {
  it('keeps what the player did and what the story said, in order', () => {
    const read = passages(
      [
        turn({
          id: 't1',
          input: { actorId: 'actor-vera', kind: 'say', text: 'Where is the lighthouse?', raw: '' },
          output: { text: 'The keeper points north.' },
        }),
      ],
      nameOf,
    );

    expect(read).toHaveLength(1);
    expect(read[0]?.said).toEqual({
      kind: 'say',
      text: 'Where is the lighthouse?',
      who: 'Vera',
      pictures: [],
    });
    expect(read[0]?.prose).toBe('The keeper points north.');
  });

  /**
   * ***A move that was only a picture is a move*** — [25 E15]. Blank words used
   * to mean *no input*, and a picture with no words would have vanished from
   * the reading view; and the two text copies, which cannot hold a picture, say
   * it in words rather than dropping it.
   */
  it('keeps a move that was only a picture, and says it in the text copies', () => {
    const read = passages(
      [
        turn({
          id: 't1',
          input: {
            actorId: null,
            kind: 'do',
            text: '',
            raw: '',
            attachments: [
              { id: '0', kind: 'image', caption: 'the harbour at dusk' },
              { id: '1', kind: 'image' },
            ],
          },
          output: { text: 'Gulls, and the smell of tar.' },
        }),
      ],
      nameOf,
    );

    expect(read[0]?.said?.pictures).toHaveLength(2);
    const markdown = toMarkdown(read, { title: 'The harbour' });
    expect(markdown).toContain('(Picture: the harbour at dusk)');
    expect(markdown).toContain('(A picture)');
    expect(toPlainText(read, { title: 'The harbour' })).toContain('(Picture: the harbour at dusk)');
  });

  /**
   * ***An engine-authored turn has no speaker, and inventing one would be the
   * defect.*** A setup turn, a continuation and an undo's divergence marker all
   * arrive with no input; a reading view that printed a heading for them would
   * put words in somebody's mouth.
   */
  it('gives a turn with no input no attribution at all', () => {
    const read = passages([turn({ id: 't1', output: { text: 'Rain, all afternoon.' } })], nameOf);
    expect(read[0]?.said).toBeNull();
    expect(read[0]?.prose).toBe('Rain, all afternoon.');
  });

  /**
   * ***An unresolvable actor is unattributed, never an id.*** A cast member
   * removed since, a persona from an import: §12.1's whole claim is *without
   * the machinery*, and a uuid in the middle of a story is the machinery.
   */
  it('renders an unknown actor as no name rather than as an id', () => {
    const read = passages(
      [turn({ id: 't1', input: { actorId: 'actor-gone', kind: 'do', text: 'Knock.', raw: '' } })],
      nameOf,
    );
    expect(read[0]?.said?.who).toBeNull();
    expect(attribution(read[0]!.said!)).toBe('did');
  });

  it('marks a failed turn rather than leaving a gap', () => {
    const read = passages([turn({ id: 't1', status: 'failed' })], nameOf);
    expect(read[0]?.unfinished).toBe(true);
  });
});

describe('the three formats agree', () => {
  const read = passages(
    [
      turn({
        id: 't1',
        input: { actorId: 'actor-vera', kind: 'say', text: 'Two lines\nof speech', raw: '' },
        output: { text: 'The keeper points north.' },
      }),
      turn({ id: 't2', output: { text: 'Rain, all afternoon.' } }),
    ],
    nameOf,
  );

  it('carries every word of the story into both text formats', () => {
    for (const rendered of [
      toMarkdown(read, { title: 'The harbour' }),
      toPlainText(read, { title: 'The harbour' }),
    ]) {
      expect(rendered).toContain('The harbour');
      expect(rendered).toContain('Vera said');
      expect(rendered).toContain('Two lines');
      expect(rendered).toContain('of speech');
      expect(rendered).toContain('The keeper points north.');
      expect(rendered).toContain('Rain, all afternoon.');
    }
  });

  /**
   * ***A block quote ends at the first line that is not prefixed***, which is
   * the one thing a hand-written Markdown serialiser gets wrong about
   * multi-line input — and multi-line input is what a `story` turn is.
   */
  it('prefixes every line of a multi-line move, not just the first', () => {
    const markdown = toMarkdown(read, { title: 'The harbour' });
    expect(markdown).toContain('> Two lines');
    expect(markdown).toContain('> of speech');
  });

  it('renders no machinery in either format', () => {
    for (const rendered of [
      toMarkdown(read, { title: 'The harbour' }),
      toPlainText(read, { title: 'The harbour' }),
    ]) {
      expect(rendered).not.toContain('t1');
      expect(rendered).not.toContain('actor-vera');
    }
  });
});
