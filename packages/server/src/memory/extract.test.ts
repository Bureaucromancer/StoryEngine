// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { describe, expect, it } from 'vitest';

import { newLorebook, newLoreEntry, type Lorebook } from '@storyengine/shared';

import { alreadyKnown, EXTRACT_PROMPT, readExtraction } from './extract.js';

/**
 * ***The extractor's two judgements, and neither is about prose*** —
 * [08 §2.1](../../../../docs/design/08-cross-session-memory.md),
 * [P11.12](../../../../docs/design/workplan/28-p11-implementation.md).
 *
 * A model's words are nobody's contract, so what is assertable here is what the
 * step does **with** them: which of them it will write down, and which it
 * already knows. The judgement half — whether the facts it picks are the ones a
 * reader would have picked — is [G](../../../../docs/design/workplan/05-manual-testing.md)'s,
 * and belongs with the tuning this phase cannot do at a desk.
 *
 * ***The locked rule is not tested here because there is no code to test.***
 * [P8.3] gave `LoreEntry.locked` a writer and owed it a reader —
 * *"the extractor never rewrites a locked entry"* — and the shape that honours
 * it is **appending and never updating**: a hand-written memory cannot be eaten
 * because nothing in this module edits an entry at all. *The cheapest way not
 * to eat corrections is to have no code that could*, and the assertion for that
 * is `repo-shape`-shaped rather than behavioural.
 */

function bookWith(...contents: string[]): Lorebook {
  return {
    ...newLorebook('Vera remembers'),
    entries: contents.map((content, at) => ({
      ...newLoreEntry(content.slice(0, 20)),
      id: `entry-${String(at)}`,
      content,
      keys: ['vera'],
    })),
  };
}

describe('what the model said, narrowed to what a book will take', () => {
  it('keeps a memory with text and keys', () => {
    expect(
      readExtraction({
        memories: [{ text: 'Vera lost her brother at sea.', keys: ['Vera', 'sea'] }],
      }),
    ).toEqual([{ text: 'Vera lost her brother at sea.', keys: ['Vera', 'sea'] }]);
  });

  /**
   * ***A keyless memory is dropped rather than written***, which is
   * `capture.ts`'s rule and matters more on the automatic path: a person
   * writing one would at least see it in the editor, while an extractor
   * producing them fills a book with entries that exist, are listed, are
   * editable and **can never reach a prompt**.
   */
  it('drops a memory that could never fire', () => {
    expect(readExtraction({ memories: [{ text: 'Something happened.', keys: [] }] })).toEqual([]);
    expect(readExtraction({ memories: [{ text: '   ', keys: ['vera'] }] })).toEqual([]);
  });

  /**
   * A newer model, a degraded schema, a provider that answered with prose: each
   * arrives as something that is not the shape. **Nothing written is the right
   * answer to all three** — the alternative is inventing a memory out of a
   * parse failure.
   */
  it('writes nothing at all for an answer it cannot read', () => {
    expect(readExtraction(null)).toEqual([]);
    expect(readExtraction({ memories: 'a paragraph' })).toEqual([]);
    expect(readExtraction({ memories: [null, 42, 'text'] })).toEqual([]);
  });
});

describe('what the book already knows', () => {
  /**
   * §2's *"a second session about the same events does not double the book"*,
   * and the honest shape of it without embeddings ([25 E2] puts semantic
   * retrieval post-1.0): the text, normalised.
   */
  it('recognises the same fact said again with different punctuation', () => {
    const book = bookWith('Vera lost her brother at sea.');
    expect(alreadyKnown(book, { text: 'Vera lost her brother at sea', keys: ['vera'] })).toBe(true);
    expect(alreadyKnown(book, { text: 'VERA LOST HER BROTHER AT SEA!', keys: ['vera'] })).toBe(
      true,
    );
  });

  it('writes a fact the book does not have', () => {
    const book = bookWith('Vera lost her brother at sea.');
    expect(alreadyKnown(book, { text: 'Vera keeps his compass.', keys: ['compass'] })).toBe(false);
  });

  it('knows nothing when the book is empty', () => {
    expect(alreadyKnown(bookWith(), { text: 'Anything.', keys: ['x'] })).toBe(false);
  });
});

describe('what the model is told', () => {
  /**
   * ***Discrete facts, not summaries*** — §2.1's one instruction this prompt
   * exists to carry, and the failure it prevents is the feature quietly
   * becoming a second summariser: *"a summary is one blob with one relevance;
   * five memories are five things that can be retrieved independently."*
   */
  it('asks for discrete facts and says not to summarise', () => {
    expect(EXTRACT_PROMPT).toContain('discrete facts');
    expect(EXTRACT_PROMPT).toContain('Not a summary');
  });

  /**
   * ***Three refusals, each a failure mode 08 names and each invisible in the
   * output.*** A fabricated memory, a private thought recorded as a fact and a
   * prediction of what comes next all read as plausible memories to anybody who
   * was not at the table.
   */
  it('forbids inventing, mind-reading and predicting', () => {
    expect(EXTRACT_PROMPT).toContain('Do not invent');
    expect(EXTRACT_PROMPT).toContain('privately thought');
    expect(EXTRACT_PROMPT).toContain('Do not speculate');
  });
});
