// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { describe, expect, it } from 'vitest';

import type { Turn } from '@storyengine/shared';

import { turnText } from '../index-db/sessions.js';
import { unitTextOf } from '../sessions/summary-chain.js';
import { transcriptOf } from '../turns/steps.js';
import { moveText, pictureTexts, pictureWords, quoted, scanText } from './pictures.js';

/**
 * ***A picture, in words, everywhere a move is read as text*** — [25 E15], R1.
 *
 * Every text consumer — the summariser, memory, the index, the transcript a
 * step reads, the lore scan — used to read `input.text` alone, so a move that
 * was a picture was a move of nothing to all of them. The property each test
 * below holds is the pair that makes the change safe: **a move with pictures
 * is read with them**, and **a move without is read exactly as it always was**,
 * which is what keeps every key and every index row written before pictures
 * unchanged.
 */

const WORDS = { text: 'Look.' };
const WITH_PICTURES = {
  text: 'Look.',
  attachments: [{ caption: 'a lantern' }, {}],
};

describe('a picture in words', () => {
  it('uses the caption, or says there is none', () => {
    expect(pictureWords({ caption: 'a lantern' })).toBe('[Picture: a lantern]');
    expect(pictureWords({})).toBe('[Picture, not described]');
    expect(pictureWords({ caption: '   ' })).toBe('[Picture, not described]');
  });

  it('tells a model that cannot see it that it is not being shown', () => {
    expect(pictureTexts({ caption: 'a lantern' })).toEqual({
      sent: '[Picture: a lantern]',
      held: '[Picture — not shown: a lantern]',
    });
  });

  it('reads a move without pictures exactly as before', () => {
    expect(moveText(WORDS)).toBe('Look.');
    expect(scanText(WORDS)).toBe('Look.');
  });

  it('reads a move with pictures with their stand-ins, and scans captions only', () => {
    expect(moveText(WITH_PICTURES)).toBe('Look.\n[Picture: a lantern]\n[Picture, not described]');
    // A lorebook keyed on *picture* must not fire because somebody attached one.
    expect(scanText(WITH_PICTURES)).toBe('Look.\na lantern');
  });
});

describe('the summary key', () => {
  /**
   * ***Stable for every turn that has no picture*** — the whole reason `a` is
   * added only when there are pictures. A chain built before this change is a
   * chain of these keys, and changing one would regenerate every summary
   * anybody has.
   */
  it('is unchanged for a move with no pictures', () => {
    expect(unitTextOf({ id: 't', input: WORDS, output: { text: 'Yes.' } })).toBe(
      JSON.stringify({ i: 'Look.', o: 'Yes.' }),
    );
  });

  it('hashes the captions, never the words a prompt uses for a picture', () => {
    const text = unitTextOf({ id: 't', input: WITH_PICTURES, output: { text: 'Yes.' } });
    expect(JSON.parse(text)).toEqual({ i: 'Look.', a: ['a lantern', null], o: 'Yes.' });
    expect(text).not.toContain('[Picture');
  });
});

describe('what a step’s transcript and the index say', () => {
  const turn = {
    id: 'turn-1',
    input: {
      actorId: null,
      kind: 'do',
      text: 'Look.',
      raw: 'Look.',
      attachments: [
        {
          id: '0',
          kind: 'image',
          digest: `sha256:${'e'.repeat(64)}`,
          mime: 'image/png',
          caption: 'a lantern',
        },
      ],
    },
    output: { text: 'A lantern, lit.' },
  } as Turn;

  it('gives a transcript the kind and caption, never the bytes’ address', () => {
    const [entry] = transcriptOf([turn]);
    expect(entry?.input?.attachments).toEqual([{ kind: 'image', caption: 'a lantern' }]);
    expect(JSON.stringify(entry)).not.toContain('sha256');
  });

  it('indexes the caption, so a search for it finds the turn', () => {
    expect(turnText(turn)).toContain('a lantern');
    expect(turnText({ ...turn, input: { ...turn.input!, attachments: [] } })).toBe(
      'Look.\nA lantern, lit.',
    );
  });
});

/**
 * ***A move quoted line by line*** — what the summariser and memory extraction
 * hand a model as *what the player did*, beside a reply left bare.
 *
 * They used to put one `> ` in front of the whole string, which quotes the
 * first line only: {@link moveText} puts each picture's stand-in on a line of
 * its own, so the stand-in read as the first line of the narrator's reply —
 * and so did the second line of any move typed with a line break, which was
 * wrong before pictures existed.
 */
describe('a move as a quotation', () => {
  /**
   * *Empty in, empty out.* A move with nothing in it — a continue, a turn that
   * was only ever a reply — must add no bare `>` for its caller's `filter` to
   * miss. Falsified by quoting unconditionally (`'>'` or `'> '`).
   */
  it('adds nothing to an empty move', () => {
    expect(quoted('')).toBe('');
  });

  it('quotes a single line', () => {
    expect(quoted('a')).toBe('> a');
  });

  /**
   * The case the function exists for. Falsified by quoting the string rather
   * than each line — the old `> ${said}` — which leaves the stand-in bare.
   */
  it('quotes every line, so a picture on the next line stays the player’s', () => {
    expect(quoted('a\n[Picture: x]')).toBe('> a\n> [Picture: x]');
    expect(quoted(moveText(WITH_PICTURES))).toBe(
      '> Look.\n> [Picture: a lantern]\n> [Picture, not described]',
    );
  });

  /**
   * A blank line inside a move is still inside the quotation, and is written as
   * a bare `>` — Markdown's own spelling — rather than `> ` with a trailing
   * space a formatter or a model would strip. Falsified by skipping blank lines
   * (the quotation splits in two) or by writing them as `> `.
   */
  it('keeps a blank line inside the quotation as a bare marker', () => {
    expect(quoted('a\n\nb')).toBe('> a\n>\n> b');
  });

  /**
   * A move that is only pictures has no words, and `moveText` leaves out the
   * empty line rather than leading with it — so the quotation starts at the
   * first stand-in, not at a bare `>`.
   */
  it('quotes a move that is only pictures from its first picture', () => {
    expect(quoted(moveText({ text: '', attachments: [{ caption: 'x' }, {}] }))).toBe(
      '> [Picture: x]\n> [Picture, not described]',
    );
  });
});
