// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { describe, expect, it } from 'vitest';

import type { CastRow } from '../api.js';
import {
  anyoneWouldReply,
  canSpeak,
  cardSwitch,
  hideSent,
  isMessageHidden,
  messageOffsets,
  messageSiblings,
  talkativenessOf,
  turnSiblings,
  withTalkativeness,
} from './chat.js';

/**
 * The chat surface's arithmetic — [P13 §1.8], [P13.5]. Each of these is a
 * decision a component would otherwise make inline and a DOM test would pin
 * only by accident.
 */

describe('hiding', () => {
  it('reads a line as hidden by its index or by the whole turn', () => {
    expect(isMessageHidden([1], 1)).toBe(true);
    expect(isMessageHidden([1], 0)).toBe(false);
    expect(isMessageHidden(true, 3)).toBe(true);
    expect(isMessageHidden(undefined, 0)).toBe(false);
  });

  it('sends the turn’s whole entry, and an empty one as false', () => {
    expect(hideSent(undefined, 1, 3, true)).toEqual([1]);
    expect(hideSent([1], 0, 3, true)).toEqual([0, 1]);
    expect(hideSent([1], 1, 3, false)).toBe(false);
  });

  it('keeps the rest hidden when one line of a hidden turn is unhidden', () => {
    expect(hideSent(true, 1, 3, false)).toEqual([0, 2]);
  });
});

describe('which counter a sibling is drawn on', () => {
  const siblings = ['a', 'b', 'c', 'd'];
  const groups = { messages: [['b', 'c'], ['a', 'b'], [], ['b', 'e']], turn: ['b', 'd'] };

  it('reads the server’s groups, and the alternatives past the last message on it', () => {
    expect(messageSiblings(groups, 1, false)).toEqual([['a', 'b']]);
    expect(messageSiblings(groups, 0, false)).toEqual([['b', 'c']]);
    expect(messageSiblings(groups, 2, false)).toEqual([]);
    expect(messageSiblings(groups, 2, true)).toEqual([['b', 'e']]);
    expect(messageSiblings(undefined, 0, true)).toEqual([]);
  });

  it('leaves another move on the turn, and a prose turn’s siblings all there', () => {
    expect(turnSiblings(siblings, groups, true)).toEqual(['b', 'd']);
    expect(turnSiblings(siblings, groups, false)).toEqual(siblings);
  });
});

describe('who may be asked to speak', () => {
  const roster = { persona: 'me', actors: ['vera', 'lund', 'me', 'abel'] };
  const row = (actorId: string, over: Partial<CastRow> = {}): CastRow => ({
    actorId,
    presence: true,
    status: 'alive',
    pending: null,
    introduced: true,
    party: null,
    ...over,
  });

  it('reaches a muted member but never the persona, the dead or the unseated', () => {
    expect(canSpeak(row('vera', { presence: false }), roster)).toBe(true);
    expect(canSpeak(row('me'), roster)).toBe(false);
    expect(canSpeak(row('abel', { status: 'dead' }), roster)).toBe(false);
    expect(canSpeak(row('stranger'), roster)).toBe(false);
  });

  it('says nobody would reply when everybody seated is muted', () => {
    expect(anyoneWouldReply([row('vera', { presence: false })], roster)).toBe(false);
    expect(anyoneWouldReply([row('vera', { presence: false }), row('lund')], roster)).toBe(true);
  });
});

describe('a card’s prompt switches', () => {
  it('writes send-everything as true and every part skipped as false', () => {
    expect(cardSwitch([], 'system', false)).toEqual(['system']);
    expect(cardSwitch(['system'], 'system', true)).toBe(true);
    expect(cardSwitch(['system', 'depth'], 'post-history', false)).toBe(false);
    expect(cardSwitch(['depth', 'system'], 'post-history', true)).toEqual(['system', 'depth']);
  });
});

describe('talkativeness', () => {
  it('reads the mode’s own key, a string as a number, and defaults to a half', () => {
    expect(talkativenessOf({ modeData: { 'm.scene': { talkativeness: 0.9 } } }, 'm.scene')).toBe(
      0.9,
    );
    expect(talkativenessOf({ modeData: { 'm.scene': { talkativeness: '0.2' } } }, 'm.scene')).toBe(
      0.2,
    );
    expect(talkativenessOf({ modeData: { other: { talkativeness: 1 } } }, 'm.scene')).toBe(0.5);
    expect(talkativenessOf({}, 'm.scene')).toBe(0.5);
  });

  it('sets it without disturbing anything else the mode keeps', () => {
    const card = { name: 'Vera', modeData: { 'm.scene': { mood: 'wet' }, other: { x: 1 } } };
    expect(withTalkativeness(card, 'm.scene', 0.8)).toEqual({
      name: 'Vera',
      modeData: { 'm.scene': { mood: 'wet', talkativeness: 0.8 }, other: { x: 1 } },
    });
  });
});

describe('where each message sits in the joined text', () => {
  it('skips empty messages and counts the blank line between the rest', () => {
    // "ab\n\ncde" — the empty one between has no place.
    expect(messageOffsets(['ab', '', 'cde'])).toEqual([0, null, 4]);
  });
});
