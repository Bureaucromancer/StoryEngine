// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { describe, expect, it } from 'vitest';

import type { ModelCall, Turn } from './sessions/types.js';
import { callOnRecord, onRecord } from './test-record.js';

/**
 * The narrowing helpers the record suites read turns through — `test-record.ts`.
 *
 * **A helper whose whole purpose is to fail loudly needs its failure proven**,
 * and nothing else in the suite reaches either throw: every call site hands it a
 * turn this process just produced, so the absent branch is the one path the
 * 1402 tests never take. That is the shape this project calls a check that
 * cannot fail, one level down — the helper could be `return value as T` and the
 * whole suite would stay green. So the branches are exercised here, and the
 * messages are asserted rather than merely the throwing, because the messages
 * are the entire reason the helper exists instead of a `!`: `lineFor` in
 * `routes/recovery.test.ts` makes the same argument one type further up, that
 * *"cannot read property of undefined"* reads as a broken test rather than as
 * the record being thin where the test was looking.
 *
 * The fixtures are cast from object literals rather than built from factories.
 * `callOnRecord` reads exactly three things — `turn.id`, `turn.request` and
 * `request.calls` — so a `ModelCall` fixture wall would be ceremony that tests
 * nothing, and these suites already turn off the `no-unsafe-*` family for
 * precisely this reason.
 */

const CALL_A = { resolved: { connectionId: 'c1', modelId: 'm1' } } as unknown as ModelCall;
const CALL_B = { resolved: { connectionId: 'c2', modelId: 'm2' } } as unknown as ModelCall;

function turnWith(calls: ModelCall[] | undefined): Turn {
  return {
    id: 'turn-1',
    ...(calls === undefined ? {} : { request: { calls } }),
  } as unknown as Turn;
}

describe('onRecord — the doubt discharged once, loudly', () => {
  it('returns the value when the record carried it', () => {
    // Mutation: return a fresh object instead of `value` and this fails on
    // identity — the helper must be a narrowing, never a copy.
    const blocks = [{ id: 'se.input' }];
    expect(onRecord(blocks, 'the blocks')).toBe(blocks);
  });

  it('throws naming what was missing, not where it died', () => {
    // **The reason this is a helper rather than a `!`.** Mutation: drop the
    // `what` from the template and the message stops telling a reader which
    // layer of the record went thin, which is the whole claim.
    expect(() => {
      onRecord(undefined, 'the blocks on the in-flight call');
    }).toThrow('The record is missing the blocks on the in-flight call');
  });

  it('passes null through, because null is a value this record means', () => {
    // `usage: null` means the provider reported nothing and `error: null` means
    // nothing failed — claims, not gaps. Mutation: widen the guard to
    // `value == null` and this throws, which would let a test assert away a
    // null the record wrote on purpose.
    expect(onRecord<string | null>(null, 'the usage')).toBeNull();
  });
});

describe('callOnRecord — two layers that fail for different reasons', () => {
  it('takes the call at the position asked for, counting from the end for a negative', () => {
    // Mutation: `request.calls[position]` instead of `.at(position)` and the
    // negative case returns undefined, which is the retry-interrupted shape.
    expect(callOnRecord(turnWith([CALL_A, CALL_B]))).toBe(CALL_A);
    expect(callOnRecord(turnWith([CALL_A, CALL_B]), -1)).toBe(CALL_B);
  });

  it('says the turn had no request at all, and names the turn', () => {
    // A turn with no request died before assembly — a different defect from a
    // request whose calls are empty, which is why the two layers keep separate
    // messages. Mutation: collapse both into one string and this stops
    // distinguishing them.
    expect(() => callOnRecord(turnWith(undefined))).toThrow(
      'The record is missing a request on turn turn-1',
    );
  });

  it('says which position was empty and how many calls there were', () => {
    // The interrupted call missing from the record. Mutation: drop the count
    // from the message and a reader cannot tell "no calls at all" from "fewer
    // than I asked for", which is the difference between two real defects.
    expect(() => callOnRecord(turnWith([]))).toThrow('Turn turn-1 has no call at position 0 of 0');
    expect(() => callOnRecord(turnWith([CALL_A]), 3)).toThrow(
      'Turn turn-1 has no call at position 3 of 1',
    );
  });
});
