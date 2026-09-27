// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { describe, expect, it } from 'vitest';

import type { Turn } from '@storyengine/shared';

import { turnText } from '../index-db/sessions.js';
import { unitTextOf } from '../sessions/summary-chain.js';
import { transcriptOf } from '../turns/steps.js';
import { moveText, pictureTexts, pictureWords, scanText } from './pictures.js';

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
