// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { describe, expect, it } from 'vitest';

import { mentionSpans, namedIn, type Mentionable } from './mentions.js';

/**
 * Mention resolution — [06 §8.2], [03 §8], [10 §13.1], built at [P7.7].
 *
 * ***An overlay, never a rewrite.*** What these assert is that the overlay says
 * what the scanner found and nothing more — and in particular that it never
 * asserts somebody the session does not have, which [P7.7] calls *"precisely the
 * failure the feature exists to make visible"*.
 */

function vera(over: Partial<Mentionable> = {}): Mentionable {
  return { actorId: 'actor-vera', name: 'Vera Kohl', terms: ['Vera Kohl', 'Vera'], ...over };
}

describe('who a turn’s text was about', () => {
  it('finds a name and says who it points at', () => {
    const spans = mentionSpans('Vera opened the door.', 'output', [vera()]);

    expect(spans).toEqual([
      {
        field: 'output',
        start: 0,
        end: 4,
        target: { kind: 'actor', ref: { id: 'actor-vera', name: 'Vera Kohl' } },
        method: 'matched',
        confidence: null,
      },
    ]);
  });

  /**
   * **`matched`, because a scanner found it** — [10 §13.1] renders the methods
   * differently on purpose, and *"a tentative match that looks certain is worse
   * than no highlighting"*. Nothing here is tentative, which is also why
   * `confidence` is null rather than 1: the field is *"only meaningful for
   * proposed"*.
   */
  it('never asserts a confidence it does not have', () => {
    const spans = mentionSpans('Vera waited.', 'output', [vera()]);

    expect(spans[0]?.method).toBe('matched');
    expect(spans[0]?.confidence).toBeNull();
  });

  /**
   * ***Longest first, and overlaps dropped.*** *Vera Kohl* and *Vera* hit the
   * same words; two spans would be two highlights over one name, and the longer
   * is the more specific claim about who was meant.
   */
  it('prefers the longer surface form over the shorter one inside it', () => {
    const spans = mentionSpans('Vera Kohl signed it.', 'output', [vera()]);

    expect(spans).toHaveLength(1);
    expect([spans[0]?.start, spans[0]?.end]).toEqual([0, 9]);
  });

  /**
   * *Dropped rather than merged.* `mergeSpans` joins geometry, and two names
   * welded into one span would point at one actor over both — a claim about the
   * text that nothing made.
   */
  it('keeps two people in one sentence as two spans', () => {
    const cast = [vera(), { actorId: 'actor-lund', name: 'Lund', terms: ['Lund'] }];
    const spans = mentionSpans('Vera told Lund.', 'output', cast);

    expect(spans.map((span) => span.target.ref.id)).toEqual(['actor-vera', 'actor-lund']);
  });

  /**
   * ***Whole words, always, and the rule is stated rather than configurable.***
   * An actor is not a `LoreEntry` and carries none of its three matching flags,
   * so this cannot inherit them — and `shared/mentions.ts` already argues the
   * honest default at length: one rule, visible, rather than thirty approximated.
   */
  it('does not find a name inside a longer word', () => {
    expect(mentionSpans('The veranda was wet.', 'output', [vera()])).toEqual([]);
  });

  /**
   * ***In every script*** (2026-09-30) — a vowel sign after a name is part of
   * the longer word it makes, not the end of the name: *राम* is not mentioned
   * in *रामायण*.
   */
  it('does not find a name inside a longer word that a combining mark continues', () => {
    const ram = vera({ name: 'राम', terms: ['राम'] });

    expect(mentionSpans('उसने रामायण पढ़ी', 'output', [ram])).toEqual([]);
    expect(mentionSpans('राम घर गया', 'output', [ram])).toHaveLength(1);
  });

  /**
   * *Case-insensitive*, which differs from the lore-entry scanner and is right
   * here: an alias is a **name**, and a narrator writing it at the start of a
   * sentence has not named somebody else.
   */
  it('finds a name however it was capitalised', () => {
    expect(mentionSpans('and then VERA left', 'output', [vera()])).toHaveLength(1);
  });

  it('finds nobody in an empty cast, and nothing in an empty text', () => {
    expect(mentionSpans('Vera opened the door.', 'output', [])).toEqual([]);
    expect(mentionSpans('', 'output', [vera()])).toEqual([]);
  });

  it('says which of the turn’s two texts it indexes into', () => {
    // 03 §8: the turn stores two texts, and 06 §8.2's original shape had no way
    // to say which — which is the ambiguity `field` exists to remove.
    expect(mentionSpans('Vera.', 'input', [vera()])[0]?.field).toBe('input');
  });
});

describe('whether somebody turned up', () => {
  /**
   * The predicate [P7.5]'s provisional firing waits on — and a **read of the
   * overlay** rather than a second scan, so the panel's highlight and the hook's
   * fate are the same finding by construction.
   */
  it('reads the overlay rather than scanning again', () => {
    const spans = mentionSpans('Vera came in from the rain.', 'output', [vera()]);

    expect(namedIn(spans, 'actor-vera')).toBe(true);
    expect(namedIn(spans, 'actor-lund')).toBe(false);
    expect(namedIn([], 'actor-vera')).toBe(false);
  });
});
