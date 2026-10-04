// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { describe, expect, it } from 'vitest';

import { newLorebook, newLoreEntry, type Lorebook } from '@storyengine/shared';

import type { StepCallRequest, StepHost, TranscriptTurn } from '@storyengine/sdk';

import type { LibraryContext } from '../library.js';
import {
  alreadyKnown,
  EXTRACT_EVERY_N_TURNS,
  EXTRACT_PROMPT,
  extractMemories,
  readExtraction,
} from './extract.js';

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
   * and the honest shape of it without embeddings ([26 E2] puts semantic
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

/**
 * ***The turns since it last ran*** (2026-09-27). The step rendered the whole
 * transcript on every eighth turn, so each extraction re-read the session from
 * its first turn: quadratic in the session's length, every old exchange offered
 * again, and a long session outgrowing the window with a block that cannot be
 * trimmed. Asked with no memories to write, so nothing but the call is seen.
 */
describe('what the extractor reads', () => {
  it('reads the last eight turns of the story, not the whole of it', async () => {
    const asked: StepCallRequest[] = [];
    const host: StepHost = {
      call: (request) => {
        asked.push(request);
        return Promise.resolve({ callId: 'c1', text: '', usage: null, object: { memories: [] } });
      },
      random: {} as StepHost['random'],
      signal: new AbortController().signal,
    };
    const step = extractMemories({
      library: {} as LibraryContext,
      handle: 'ned',
      sessionId: 's-1',
      session: { name: 'Rain City', cast: { persona: null, actors: ['a-vera'] } },
      nameOf: () => 'Vera',
      report: () => undefined,
    });
    const transcript: TranscriptTurn[] = Array.from({ length: 31 }, (_, at) => ({
      turnId: `t-${String(at)}`,
      output: { text: `Day ${String(at)} on the road.` },
    }));

    await step.run(
      { turnId: 't-now', sessionId: 's-1', parentTurnId: 't-30', channels: {}, transcript },
      host,
    );

    const turns = asked[0]?.candidates?.find((one) => one.id === 'se.memory.turns')?.text ?? '';
    const first = 31 - EXTRACT_EVERY_N_TURNS;
    expect(turns).toContain(`Day ${String(first)} on the road.`);
    expect(turns).toContain('Day 30 on the road.');
    expect(turns).not.toContain(`Day ${String(first - 1)} on the road.`);
  });
});

/**
 * ***The player's move is quoted to its last line*** — [26 E15], and the rule
 * `quoted` exists for. The extractor quotes the move and leaves the reply bare
 * so a model can tell what somebody did from what the narrator said; with one
 * `> ` in front of the whole move, each picture's stand-in — on a line of its
 * own — read as narration, and a memory of a picture the player showed could
 * come back as something the narrator described.
 *
 * Asked with no memories to write, as above, so nothing but the call is seen.
 */
describe('a move with pictures, as the extractor reads it', () => {
  /**
   * One turn that is words and a captioned picture, one that is two pictures
   * and no words — the whole exchange, so the whole block can be asserted.
   *
   * Falsified by: quoting the move as one string (`> ${moveText(...)}`), which
   * leaves every stand-in after the first line bare; or reading `input.text`
   * rather than `moveText`, which drops the pictures and leaves turn 1 with a
   * reply and no move.
   */
  it('quotes every line of the move and leaves the reply bare', async () => {
    const asked: StepCallRequest[] = [];
    const host: StepHost = {
      call: (request) => {
        asked.push(request);
        return Promise.resolve({ callId: 'c1', text: '', usage: null, object: { memories: [] } });
      },
      random: {} as StepHost['random'],
      signal: new AbortController().signal,
    };
    const transcript: TranscriptTurn[] = [
      {
        turnId: 't-0',
        input: {
          actorId: null,
          kind: 'do',
          text: 'I wonder.',
          attachments: [{ kind: 'image', caption: 'a lantern' }],
        },
        output: { text: 'Nothing moves.' },
      },
      {
        turnId: 't-1',
        input: {
          actorId: null,
          kind: 'do',
          text: '',
          attachments: [{ kind: 'image', caption: 'the harbour' }, { kind: 'image' }],
        },
        output: { text: 'The tide turns.' },
      },
    ];

    await extractMemories({
      library: {} as LibraryContext,
      handle: 'ned',
      sessionId: 's-1',
      session: { name: 'Rain City', cast: { persona: null, actors: ['a-vera'] } },
      nameOf: () => 'Vera',
      report: () => undefined,
    }).run(
      { turnId: 't-now', sessionId: 's-1', parentTurnId: 't-1', channels: {}, transcript },
      host,
    );

    expect(asked[0]?.candidates?.find((one) => one.id === 'se.memory.turns')?.text).toBe(
      [
        '> I wonder.',
        '> [Picture: a lantern]',
        'Nothing moves.',
        '',
        '> [Picture: the harbour]',
        '> [Picture, not described]',
        'The tide turns.',
      ].join('\n'),
    );
  });
});
