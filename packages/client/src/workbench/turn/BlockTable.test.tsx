// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import type { AssembledBlock, BlockImage } from '@storyengine/shared';

import { BlockTable } from './BlockTable.js';

/**
 * ***Pixels or words, and why*** — [25 E15], at the one surface where somebody
 * asks *did the model actually see it*.
 *
 * `views.test.tsx` holds the block table's older claims over whole turn
 * fixtures; this file holds the picture badge alone, over literal blocks,
 * because what can go wrong is small and specific: **three states that read
 * alike in a hurry**. A picture sent, a picture that went as its words, and a
 * picture the budget dropped are three different answers to that question, and
 * the badge's title is where each one says what it leaves out — a sent picture
 * is *counted* as its words, which is the sentence that explains a call that
 * overflowed on the endpoint while this table showed room.
 *
 * **No router mock, unlike `views.test.tsx`**, and on purpose: every block here
 * is an `input` source, which has no library page to link to, and no
 * `sessionId` is passed, so the *Edit in the pack* column is absent too. Nothing
 * here renders a `Link`, so nothing here needs one stubbed — and a test that
 * started rendering one would fail loudly rather than pass against a stub.
 */

const DIGEST = `sha256:${'a'.repeat(64)}`;

function block(id: string, over: Partial<AssembledBlock> = {}): AssembledBlock {
  return {
    id,
    source: { kind: 'input' },
    reason: 'the move being made',
    role: 'user',
    text: `the text of ${id}`,
    tokens: 10,
    included: true,
    ...over,
  };
}

/** One picture on the move being made, in whichever state the test names. */
function picture(id: string, image: Omit<BlockImage, 'attachmentId' | 'digest' | 'mime'>) {
  return block(id, {
    source: { kind: 'input', part: 'attachment', attachmentId: '0' },
    text: '[Picture: the harbour at dusk]',
    image: { attachmentId: '0', digest: DIGEST, mime: 'image/png', ...image },
  });
}

function rowFor(id: string): HTMLElement {
  // By the block id *cell*, which is `AlignedBlockTable.test.tsx`'s rule: a
  // row's whole text would also match the header and any reason that happened
  // to quote an id.
  const row = screen
    .getAllByRole('row')
    .find((one) => one.querySelector('code')?.textContent === id);
  if (row === undefined) throw new Error(`no row for ${id}`);
  return row;
}

describe('the picture badge', () => {
  /**
   * All three states in one table, and each asserted **on its own row**, so a
   * badge that rendered the right words on the wrong block — or one reason
   * for every picture — cannot pass by the words merely being somewhere on
   * the page.
   *
   * The falsifying mutations, one per row: `sent` reading the `held` label
   * (a sent picture announced as words, which is the lie that sends somebody
   * off to change a model that was already seeing it); the `budget` arm
   * collapsed into `held` (a dropped picture claimed to have gone as its
   * caption, when neither went); and the title reading a fixed sentence
   * rather than the block's own `withheld`, which the middle row's reason is
   * there to catch.
   */
  it('says whether each picture went as pixels, as words, or not at all — and why', () => {
    render(
      <BlockTable
        blocks={[
          block('se.input'),
          picture('se.input.sent', { sent: true }),
          picture('se.input.words', { sent: false, withheld: 'model-text-only' }),
          {
            ...picture('se.input.dropped', { sent: false, withheld: 'budget' }),
            included: false,
            droppedBy: 'over budget — priority 20',
          },
        ]}
        rules={new Map()}
        locale={undefined}
      />,
    );

    const sent = within(rowFor('se.input.sent')).getByText('Picture sent');
    expect(sent.getAttribute('title')).toBe(
      'Counted as its words: what the picture itself costs the model is not estimated yet',
    );

    const words = within(rowFor('se.input.words')).getByText('Picture as words');
    expect(words.getAttribute('title')).toBe('this model is not marked as seeing pictures');

    const dropped = within(rowFor('se.input.dropped')).getByText('Picture dropped');
    expect(dropped.getAttribute('title')).toBe(
      'the budget left it out, so neither the picture nor its words went',
    );
  });

  /**
   * ***Absent on every block that is not a picture*** — the field's own
   * contract. A badge on the move's words would claim a picture where there
   * is none, and it is the row a reader looks at first.
   */
  it('marks nothing on a block that is not a picture', () => {
    render(<BlockTable blocks={[block('se.input')]} rules={new Map()} locale={undefined} />);

    expect(within(rowFor('se.input')).queryByText(/^Picture /)).toBeNull();
  });
});
