// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { randomBytes, randomInt } from 'node:crypto';

/**
 * Where the numbers actually come from —
 * [20 §14.3](../../../../docs/design/20-tech-stack.md).
 *
 * **`node:crypto`, and `randomInt` specifically.** It is uniform, where the
 * naive `Math.floor(Math.random() * n)` is subtly *non*-uniform — the sort of
 * thing that goes unnoticed in a dice system for years, and then turns out to
 * have been quietly favouring low rolls the whole time.
 *
 * **Injected, so a test can be deterministic.** One seam, no third-party
 * dependency, and no network of any kind: a LAN server with no internet must
 * roll dice normally, so remote entropy services and provider-side randomness
 * are excluded on purpose rather than merely unused.
 */
export interface RandomSource {
  /** A uniform integer in `[0, bound)`. `bound` is at least 1. */
  intBelow(bound: number): number;
  /** A uniform float in `[0, 1)`. */
  float(): number;
}

/** 2^48 — six bytes, which is more precision than a float needs and cheap. */
const FLOAT_DIVISOR = 2 ** 48;

export const cryptoSource: RandomSource = {
  intBelow(bound: number): number {
    // `randomInt` refuses a bound of 1 in some Node versions and always returns
    // 0 in that case anyway.
    return bound <= 1 ? 0 : randomInt(bound);
  },
  float(): number {
    const bytes = randomBytes(6);
    let value = 0;
    for (const byte of bytes) value = value * 256 + byte;
    return value / FLOAT_DIVISOR;
  },
};

/**
 * A deterministic source for tests and fixtures.
 *
 * xorshift128, which is not cryptographic and does not need to be: its only job
 * is to make a fixture roll the same way twice. It is here rather than in a
 * test helper because *fixtures* want it too — a golden file with dice in it is
 * only a golden file if the dice are predictable.
 */
export function seededSource(seed: number): RandomSource {
  let x = seed >>> 0 || 0x9e3779b9;
  let y = 0x243f6a88;
  let z = 0xb7e15162;
  let w = 0x0f1bbcdc;

  function next(): number {
    const t = x ^ (x << 11);
    x = y;
    y = z;
    z = w;
    w = (w ^ (w >>> 19) ^ (t ^ (t >>> 8))) >>> 0;
    return w;
  }

  return {
    intBelow(bound: number): number {
      if (bound <= 1) return 0;
      // Rejection sampling rather than a modulo, for the same reason the real
      // source uses `randomInt`: a biased test generator hides a biased test.
      const limit = Math.floor(0x1_0000_0000 / bound) * bound;
      let value = next();
      while (value >= limit) value = next();
      return value % bound;
    },
    float(): number {
      return next() / 0x1_0000_0000;
    },
  };
}
