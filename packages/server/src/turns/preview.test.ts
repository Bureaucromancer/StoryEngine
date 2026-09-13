// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { describe, expect, it } from 'vitest';

import { TEST_MODE } from '../test-mode.js';
import type { Mode } from '@storyengine/sdk';
import type { StepDefinition } from './steps.js';
import { previewStepFor } from './preview.js';

/**
 * Which call a preview is about — [P3.4], pinned against a **synthetic** mode.
 *
 * The route tests cannot hold this claim: Scene ships exactly one step and it
 * is the prose one, so `steps[0]` and *the first prose step* are the same
 * answer there, and a test written over the real mode passes under either. The
 * distinction is real all the same — [06 §5.2] admits guidance only to a call
 * whose purpose is prose, so the prose call is the only one the guidance box
 * can change, and previewing anything else would measure a prompt the person
 * on the input bar cannot affect. A mode with a pre-step arrives with P7 at
 * the latest; this is what stops it arriving as a silent wrong answer.
 */

function step(over: Partial<StepDefinition> & Pick<StepDefinition, 'id'>): StepDefinition {
  const narrate = TEST_MODE.definition.steps[0];
  if (narrate === undefined) throw new Error('Scene declares no steps.');
  return { ...narrate, ...over };
}

function modeOf(steps: StepDefinition[]): Mode {
  return {
    ...TEST_MODE,
    definition: { ...TEST_MODE.definition, steps },
  };
}

describe('the step a preview is about', () => {
  it('is the prose step, not merely the first one', () => {
    // The falsifying mutation is `steps[0]`, which is indistinguishable from
    // the right answer against every mode this repo currently ships.
    const mode = modeOf([
      step({ id: 'se.retrieve', role: 'fast', callKind: 'retrieve' }),
      step({ id: 'se.narrate', role: 'prose', callKind: 'narrate' }),
    ]);

    expect(previewStepFor(mode)?.id).toBe('se.narrate');
  });

  it('is the first prose step when a mode declares several', () => {
    const mode = modeOf([
      step({ id: 'se.narrate', role: 'prose', callKind: 'narrate' }),
      step({ id: 'se.embellish', role: 'prose', callKind: 'narrate' }),
    ]);

    expect(previewStepFor(mode)?.id).toBe('se.narrate');
  });

  it('is nothing at all when a mode asks no prose of anyone', () => {
    // Answered as `no-prose-step` by the caller rather than as an empty
    // prompt: a mode that never narrates has no context fill to report, and
    // reporting zero would be a measurement nobody made.
    const mode = modeOf([step({ id: 'se.extract', role: 'fast', callKind: 'extract' })]);

    expect(previewStepFor(mode)).toBeNull();
  });

  it('finds Scene’s narrate step, which is the one the meter measures today', () => {
    expect(previewStepFor(TEST_MODE)?.id).toBe('se.narrate');
  });
});
