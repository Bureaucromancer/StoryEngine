// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { describe, expect, it } from 'vitest';

import { REMEDY_SENTENCES, remedySentence } from './failures.js';

/**
 * ***The claim this stage makes is about prose, so the check is about prose*** —
 * [09 §6.5](../../../docs/design/09-server-multiuser-deployment.md),
 * [P11.6](../../../docs/design/workplan/28-p11-implementation.md).
 *
 * The defect being fixed was not a missing sentence. It was a **machine word
 * rendered at a reader** — *The turn failed (transient)* — and the thing that
 * makes that class of defect recur is that it costs nothing to write and looks
 * fine to whoever wrote it. So the assertion is the one a reviewer would
 * actually make: **every one of these is a sentence, and none of them contains
 * one of our own words.**
 *
 * *Exhaustiveness is the compiler's here*, not this file's.
 * `Record<FailureRemedy, string>` in [`failures.ts`](./failures.ts) means the
 * server cannot add an arm without the build failing, which is stronger than
 * the grep [`library/note-labels.test.ts`](./library/note-labels.test.ts) has to
 * use — and that file explains why its own vocabulary cannot be closed the same
 * way.
 */

describe('every remedy is something a person could read aloud', () => {
  it('finds the table, so an empty one cannot pass', () => {
    expect(Object.keys(REMEDY_SENTENCES).length).toBeGreaterThan(5);
  });

  it('is a sentence: a capital, some words, a full stop', () => {
    for (const [remedy, sentence] of Object.entries(REMEDY_SENTENCES)) {
      expect(sentence, remedy).toMatch(/^[A-Z].*[.]$/);
      expect(sentence.split(' ').length, remedy).toBeGreaterThan(4);
    }
  });

  /**
   * ***The actual regression guard.*** Every arm of `FailureRemedy` is a
   * hyphenated lower-case key and every `StepFailureReason` is a bare
   * lower-case word or a hyphenated pair, and neither belongs in a sentence.
   * *The keys are checked against their own values* rather than against a
   * hand-written list, so an arm added later is covered without anybody
   * remembering to extend this.
   */
  it('contains none of the engine’s own words', () => {
    const machineWords = [
      ...Object.keys(REMEDY_SENTENCES),
      'transient',
      'retryable',
      'terminal',
      'advisory-leak',
      'dangling',
      'unbound',
      'internal',
    ];
    for (const [remedy, sentence] of Object.entries(REMEDY_SENTENCES)) {
      for (const word of machineWords) {
        expect(sentence.toLowerCase(), `${remedy} leaks ${word}`).not.toContain(word);
      }
    }
  });
});

describe('a remedy this build has never heard of', () => {
  /**
   * **Null rather than the key**, which is the opposite of
   * [`note-labels.ts`](./library/note-labels.ts)'s fallback and is deliberate:
   * that table renders an unknown key *as itself* so a newer server's note is
   * legible rather than blank. A remedy has no such reading — it is not a name,
   * it is a sentence's identifier — so the honest answer to a skew is to say
   * nothing extra, and both callers have a sensible line without one.
   */
  it('produces nothing rather than a machine word', () => {
    expect(remedySentence('endpoint-eaten-by-a-bear')).toBeNull();
    expect(remedySentence(null)).toBeNull();
  });

  it('produces a sentence for one it does know', () => {
    expect(remedySentence('endpoint-silent-offline')).toContain('no internet access');
  });
});
