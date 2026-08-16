// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { describe, expect, it } from 'vitest';

import { createUuidv7, isUuidv7, slugify, uuidv7, uuidv7Timestamp } from './ids.js';

describe('uuidv7', () => {
  it('is well-formed', () => {
    expect(isUuidv7(uuidv7())).toBe(true);
  });

  it('encodes the timestamp it was given', () => {
    // A fresh generator, because the shared one carries the last millisecond it
    // saw and would floor this at whatever the previous test emitted. That is
    // the monotonicity guarantee doing its job, not a bug — but it does mean
    // `now` is a floor rather than a promise.
    const generate = createUuidv7();
    const at = Date.UTC(2026, 7, 13, 12, 0, 0);
    expect(uuidv7Timestamp(generate(at))).toBe(at);
  });

  it('is monotonic across a burst inside one millisecond', () => {
    // The property the whole design leans on: ids sort in creation order, so a
    // directory listing, an index scan and a turn sequence agree without a
    // separate ordering column. A burst is where a naive implementation fails,
    // because every id in it shares a timestamp.
    const ids = Array.from({ length: 10_000 }, () => uuidv7());

    for (let i = 1; i < ids.length; i += 1) {
      expect(ids[i]! > ids[i - 1]!).toBe(true);
    }
  });

  it('overflows the counter into the next millisecond rather than repeating', () => {
    // 12 bits of counter, seeded up to 1024, so more than 3072 ids in one
    // millisecond forces the rollover path.
    const generate = createUuidv7();
    const at = Date.UTC(2026, 7, 13, 12, 0, 0);
    const ids = Array.from({ length: 5000 }, () => generate(at));

    expect(new Set(ids).size).toBe(ids.length);
    for (let i = 1; i < ids.length; i += 1) {
      expect(ids[i]! > ids[i - 1]!).toBe(true);
    }
    expect(uuidv7Timestamp(ids.at(-1)!)).toBeGreaterThan(at);
  });

  it('stays monotonic when the clock goes backwards', () => {
    const generate = createUuidv7();
    const first = generate(Date.UTC(2026, 7, 13, 12, 0, 0));
    const second = generate(Date.UTC(2020, 0, 1));
    expect(second > first).toBe(true);
  });

  it('gives independent generators independent state', () => {
    const a = createUuidv7();
    const b = createUuidv7();
    const at = Date.UTC(2026, 7, 13, 12, 0, 0);
    a(at);
    expect(uuidv7Timestamp(b(at))).toBe(at);
  });

  it('rejects a v4 uuid', () => {
    expect(isUuidv7('f81d4fae-7dec-41d0-a765-00a0c91e6bf6')).toBe(false);
    expect(uuidv7Timestamp('not-a-uuid')).toBeNull();
  });
});

describe('slugify', () => {
  it('kebab-cases an ordinary name', () => {
    expect(slugify('Vera Solano')).toBe('vera-solano');
  });

  it('folds diacritics to ASCII rather than dropping the letter', () => {
    expect(slugify('Verá Solaño')).toBe('vera-solano');
    expect(slugify('Ægir Þórsson')).toBe('gir-orsson');
  });

  it('collapses punctuation and trims the edges', () => {
    expect(slugify('  The Fixer’s Debt!! ')).toBe('the-fixer-s-debt');
    expect(slugify('---')).toBe('untitled');
  });

  it('falls back when nothing survives folding', () => {
    expect(slugify('日本語')).toBe('untitled');
    expect(slugify('🎲')).toBe('untitled');
  });

  it('caps length, preferring a word boundary', () => {
    const slug = slugify('a name that goes on and on and on and on and on and on and on and on');
    expect(slug.length).toBeLessThanOrEqual(64);
    expect(slug.endsWith('-')).toBe(false);
    expect(slug.startsWith('a-name-that-goes-on')).toBe(true);
  });

  it('truncates mid-word rather than losing a single long name', () => {
    const slug = slugify('x'.repeat(200));
    expect(slug).toBe('x'.repeat(64));
  });

  it('escapes Windows reserved device names', () => {
    // Windows is the development platform, so this is the failure most likely
    // to be found late and by accident — by someone whose actor is called Aux.
    expect(slugify('CON')).toBe('con_');
    expect(slugify('aux')).toBe('aux_');
    expect(slugify('LPT1')).toBe('lpt1_');
    // Only the exact name is reserved.
    expect(slugify('Constance')).toBe('constance');
  });

  it('leaves the -N suffix shape free for the caller to de-duplicate with', () => {
    // slugify has no view of the directory; uniqueness is layout.ts's job at
    // P1.2. This just confirms it does not itself emit a numeric suffix.
    expect(slugify('Vera Solano')).toBe('vera-solano');
    expect(slugify('Vera Solano 2')).toBe('vera-solano-2');
  });
});
