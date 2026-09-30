// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { describe, expect, it } from 'vitest';

import type { OutputMessage, Turn } from '@storyengine/shared';

import { swipeGroups } from './swipes.js';

/**
 * Where a sibling's counter is drawn — [P14 §1.6], [P14.5]. The route test
 * plays a real swipe; these pin the grouping rules a route test cannot reach
 * cheaply: a swipe of a swipe, a continue, a greeting, and the one the first
 * cut got wrong — the same counter read from each of its members.
 */

const VERA = { id: 'vera', name: 'Vera' };
const LUND = { id: 'lund', name: 'Lund' };

function turn(id: string, messages: OutputMessage[], input?: string): Turn {
  return {
    id,
    sessionId: 's',
    parentTurnId: 'p',
    createdAt: '2026-09-29T00:00:00.000Z',
    status: 'complete',
    ...(input === undefined
      ? {}
      : { input: { actorId: null, kind: 'do', text: input, raw: input } }),
    output: { text: messages.map((one) => one.text).join('\n\n'), messages },
    tape: [],
  } as unknown as Turn;
}

describe('swipeGroups', () => {
  const round = turn(
    'round',
    [
      { speaker: VERA, text: 'A' },
      { speaker: LUND, text: 'B' },
      { speaker: VERA, text: 'C' },
    ],
    'Well?',
  );

  it('puts a swipe, and a swipe of that swipe, on the message they redid', () => {
    const swipe = turn(
      'swipe',
      [
        { speaker: VERA, text: 'A', carried: true },
        { speaker: LUND, text: 'B2' },
      ],
      'Well?',
    );
    const again = turn(
      'again',
      [
        { speaker: VERA, text: 'A', carried: true },
        { speaker: LUND, text: 'B3' },
      ],
      'Well?',
    );
    expect(swipeGroups(swipe, [round, swipe, again])).toEqual({
      messages: [[], ['round', 'swipe', 'again'], []],
      turn: [],
    });
  });

  it('puts a continue on the last message, and another move on the turn', () => {
    const continued = turn(
      'continued',
      [
        { speaker: VERA, text: 'A' },
        { speaker: LUND, text: 'B' },
        { speaker: VERA, text: 'C and more' },
      ],
      'Well?',
    );
    const other = turn('other', [{ speaker: VERA, text: 'A' }], 'Something else');
    expect(swipeGroups(round, [round, continued, other])).toEqual({
      messages: [[], [], ['round', 'continued'], []],
      turn: ['round', 'other'],
    });
  });

  it('puts every greeting on the first message', () => {
    const primary = turn('primary', [{ speaker: VERA, text: 'Hello.' }]);
    const alternate = turn('alternate', [{ speaker: VERA, text: 'Evening.' }]);
    expect(swipeGroups(primary, [primary, alternate])).toEqual({
      messages: [['primary', 'alternate'], []],
      turn: [],
    });
  });

  it('reads the same counter from every member, and steps back to where it began', () => {
    // A, then B (a swipe of A's message 2), then C (a swipe of A's message 1).
    const a = turn('a', [
      { speaker: VERA, text: 'A0' },
      { speaker: LUND, text: 'A1' },
      { speaker: VERA, text: 'A2' },
    ]);
    const b = turn('b', [
      { speaker: VERA, text: 'A0' },
      { speaker: LUND, text: 'A1' },
      { speaker: VERA, text: 'B2' },
    ]);
    const c = turn('c', [
      { speaker: VERA, text: 'A0' },
      { speaker: LUND, text: 'C1' },
    ]);
    const family = [a, b, c];
    const byId = new Map(family.map((one) => [one.id, one]));
    const counterAt = (id: string, k: number): string[] =>
      swipeGroups(byId.get(id) ?? a, family).messages[k] ?? [];
    /** "n of m" on message k, as the viewing turn's counter would read it. */
    const reading = (id: string, k: number): string => {
      const ids = counterAt(id, k);
      return `${String(ids.indexOf(id) + 1)} of ${String(ids.length)}`;
    };

    // Message 1: A and B say the same line, so they are one alternative.
    expect(reading('a', 1)).toBe('1 of 2');
    expect(reading('b', 1)).toBe('1 of 2');
    expect(reading('c', 1)).toBe('2 of 2');

    for (const start of ['a', 'b', 'c']) {
      const ids = counterAt(start, 1);
      const at = ids.indexOf(start);
      const stepped = ids[at + 1] ?? ids[at - 1];
      expect(stepped).toBeDefined();
      const back = counterAt(stepped ?? '', 1);
      const there = back.indexOf(stepped ?? '');
      // Back the way it came: the line it started on is where it lands.
      const returned = at + 1 < ids.length ? back[there - 1] : back[there + 1];
      const startLine = outputLine(byId.get(start), 1);
      expect(outputLine(byId.get(returned ?? ''), 1)).toBe(startLine);
      expect(back).toHaveLength(ids.length);
    }

    // Message 2 is A's and B's alone: C never said one.
    expect(counterAt('a', 2)).toEqual(['a', 'b']);
    expect(counterAt('b', 2)).toEqual(['a', 'b']);
    expect(counterAt('c', 2)).toEqual([]);
  });

  it("puts the round a branch was cut from past the branch's last message", () => {
    const round = turn('round', [
      { speaker: VERA, text: 'A' },
      { speaker: LUND, text: 'B' },
    ]);
    const branch = turn('branch', [{ speaker: VERA, text: 'A' }]);
    expect(swipeGroups(branch, [round, branch]).messages).toEqual([[], ['round', 'branch']]);
    expect(swipeGroups(round, [round, branch]).messages).toEqual([[], ['round', 'branch'], []]);
  });
});

function outputLine(one: Turn | undefined, k: number): string | undefined {
  return (one?.output as { messages?: OutputMessage[] } | undefined)?.messages?.[k]?.text;
}
