// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { describe, expect, it } from 'vitest';

import { PATTERN_TIMEOUT_MS, testPattern } from './regex.js';

/**
 * The regex timeout — [P5 §1.10] makes this P5.4's first commit *and its own
 * test*, before any matcher exists to call it.
 *
 * **The assertion that carries the file is the second one**, and it is the
 * reason a unit test can say anything here at all: a catastrophic pattern
 * without this guard does not fail, it *hangs*, and a test that hangs is
 * indistinguishable from a suite that is slow. So the case is written to a
 * budget — abandoned in well under a second — rather than to a boolean, and it
 * would fail by timing out the whole file if the guard were removed.
 */

/**
 * The schoolbook catastrophic pattern, and a string chosen to be hopeless.
 *
 * `(a+)+b` over a run of `a` with no `b` is the exponential case: every way of
 * splitting the run between the two quantifiers is tried before the engine can
 * conclude there is no match. Forty characters is comfortably past the point
 * where a machine finishes this century, and short enough that nobody reading
 * it wonders whether the input is doing the work.
 */
const CATASTROPHIC = '(a+)+b';
const HOPELESS = 'a'.repeat(40);

describe('a pattern that matches', () => {
  it('answers plainly', () => {
    expect(testPattern('harbour', '', 'the harbour at dawn')).toEqual({ kind: 'matched' });
  });

  it('says no when it does not', () => {
    expect(testPattern('harbour', '', 'the bridge at dawn')).toEqual({ kind: 'no-match' });
  });

  it('honours the flags it is given', () => {
    expect(testPattern('HARBOUR', '', 'the harbour')).toEqual({ kind: 'no-match' });
    expect(testPattern('HARBOUR', 'i', 'the harbour')).toEqual({ kind: 'matched' });
  });

  it('runs the pattern as a pattern, not as a literal', () => {
    // The whole point of `useRegex`: an author writing `ferry(man|boat)` means
    // an alternation, and a substring match would find neither.
    expect(testPattern('ferry(man|boat)', '', 'the ferryboat')).toEqual({ kind: 'matched' });
  });
});

describe('a pattern that would never finish', () => {
  /**
   * **The one that matters.** Removing the guard does not turn this red — it
   * makes the file hang, which is why the budget is asserted rather than the
   * outcome alone.
   */
  it('is abandoned at the timeout rather than stalling the process', () => {
    const started = Date.now();
    const outcome = testPattern(CATASTROPHIC, '', HOPELESS);
    const spent = Date.now() - started;

    expect(outcome).toEqual({ kind: 'timed-out', pattern: CATASTROPHIC });
    // Generous against a loaded machine and still four orders of magnitude
    // short of what an unguarded run costs.
    expect(spent).toBeLessThan(2000);
  });

  /**
   * **It does not quietly become a substring match**, which triage §5.1 names
   * as the tempting fallback and refuses: the pattern may match perfectly well
   * on simpler input, so substituting different semantics turns a refusal into
   * a different answer nobody asked for. `aaa…` *contains* no `b`, but a
   * fallback that stripped the operators would find `a` in it and say yes.
   */
  it('reports the refusal rather than answering a different question', () => {
    const outcome = testPattern(CATASTROPHIC, '', HOPELESS);

    expect(outcome.kind).not.toBe('matched');
    expect(outcome.kind).not.toBe('no-match');
  });

  /**
   * The pattern travels with the refusal so a surface can say *which* entry
   * stopped firing — exit-gate step 15's *the entry reports why*, which a bare
   * boolean could not support.
   */
  it('carries the pattern, because a refusal nobody can trace is not a report', () => {
    const outcome = testPattern(CATASTROPHIC, '', HOPELESS);

    expect(outcome).toMatchObject({ pattern: CATASTROPHIC });
  });

  /**
   * The isolate is reused across calls, so the question worth asking is whether
   * one torn out by the interrupt leaves the next call broken. It does not —
   * which is why there is no discard-and-rebuild step in the module.
   */
  it('leaves the next pattern working', () => {
    testPattern(CATASTROPHIC, '', HOPELESS);

    expect(testPattern('harbour', 'i', 'The Harbour')).toEqual({ kind: 'matched' });
  });

  it('takes a shorter budget when one is given', () => {
    const started = Date.now();
    testPattern(CATASTROPHIC, '', HOPELESS, 10);

    expect(Date.now() - started).toBeLessThan(PATTERN_TIMEOUT_MS * 10);
  });
});

describe('a pattern that is not one', () => {
  /**
   * A hand-edited book, or one converted from a tool whose dialect JavaScript
   * does not speak. Not the server's fault, not the author's emergency, and
   * **not a reason to stop scanning the rest of the book** — so it is an
   * outcome rather than a throw.
   */
  it('reports an unbalanced group instead of throwing', () => {
    const outcome = testPattern('(unclosed', '', 'anything');

    expect(outcome.kind).toBe('invalid');
    expect(outcome).toMatchObject({ pattern: '(unclosed' });
  });

  it('reports a flag that does not exist', () => {
    expect(testPattern('harbour', 'q', 'the harbour').kind).toBe('invalid');
  });

  it('says what was wrong with it, for whoever has to fix the entry', () => {
    const outcome = testPattern('[', '', 'anything');

    expect(outcome.kind === 'invalid' && outcome.detail.length > 0).toBe(true);
  });
});

/**
 * **The pattern crosses as data and never as source.**
 *
 * The first version of this described the risk as arbitrary code execution on
 * the server and probed for it with an escaped-quote payload; a mutation that
 * interpolated the pattern into the script survived both. Measuring what the
 * isolate actually holds explained why on both counts — its global has three
 * strings on it, `process` and `require` are `undefined`, and an assignment to
 * its `globalThis` does not reach ours, so the payload could not have proved
 * anything even if it had run.
 *
 * What interpolation really costs is **the wrong answer**, and the case that
 * shows it needs no payload at all.
 */
describe('a pattern crossing as data rather than as source', () => {
  /**
   * **A slash in a pattern is ordinary** — a date, a URL, *and/or* — and it is
   * the character a `/${pattern}/` script is delimited by. Interpolated, this
   * becomes `/a/b/.test(text)`: flags `b`, a syntax error, and an author told
   * their perfectly good key is malformed. As data it is simply the pattern it
   * looks like. This is the assertion that kills the interpolation mutation.
   */
  it('matches a pattern that contains the delimiter', () => {
    expect(testPattern('a/b', '', 'the a/b junction')).toEqual({ kind: 'matched' });
  });

  it('still answers a pattern made of quotes and brackets', () => {
    // Not a security probe — the isolate has nothing to reach. It is the same
    // ordinary-input claim: punctuation an interpolating implementation would
    // choke on is punctuation an author may legitimately write.
    expect(testPattern("don't\\(", '', "don't(")).toEqual({ kind: 'matched' });
  });
});
