// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { describe, expect, it } from 'vitest';

import type { AssembledPrompt } from '@storyengine/shared';

import type { Binding } from '../providers/types.js';
import { recipeDigest } from './digest.js';

/**
 * The reuse key — [06 §10.1a], [P9 §1.7], and [P9 §0.3]'s item 2.
 *
 * ***Two of these tests are about a sentence §1.7 did not have.*** As that
 * section first wrote it the digest hashed the fragments alone, and the
 * rebinding case below is what that costs: the old provider's backdrop comes
 * back for every place already visited, permanently, with no way to ask for the
 * new one. `summariserKey` had already made the opposite call for the identical
 * reason, which is why the amendment is a correction rather than a new idea.
 */

const BINDING: Binding = { connectionId: 'c-1', modelId: 'sdxl' };

function prompt(over: Partial<AssembledPrompt> = {}): AssembledPrompt {
  return {
    fragments: [
      { id: 'place', text: 'the harbour steps', rank: 100, required: true },
      { id: 'tone', text: 'cold and salt-bitten', rank: 80 },
    ],
    separator: ', ',
    budget: { maxChars: null, usefulChars: null },
    text: 'the harbour steps, cold and salt-bitten',
    kept: ['place', 'tone'],
    dropped: [],
    overCap: false,
    ...over,
  };
}

describe('equal recipes hash equal', () => {
  it('answers the same for the same place described the same way', () => {
    // The whole point: walk back into a room and the digest already matches, so
    // `reusableBackdrop` finds it and no job is dispatched. Gate row 10's
    // arithmetic, one level below where it is asserted.
    expect(recipeDigest(BINDING, prompt(), { steps: 20 })).toBe(
      recipeDigest(BINDING, prompt(), { steps: 20 }),
    );
  });

  it('ignores the order the workflow was written in', () => {
    // An object's insertion order is not a fact about the request. Two steps
    // setting the same parameters in different orders are asking for the same
    // picture, and a digest that disagreed would dispatch a second job for a
    // place already rendered.
    expect(recipeDigest(BINDING, prompt(), { steps: 20, cfg: 6.5 })).toBe(
      recipeDigest(BINDING, prompt(), { cfg: 6.5, steps: 20 }),
    );
  });

  it('ignores the sampling seed, which is the whole trick', () => {
    /**
     * §10.1a: *"a hash over the assembled ranked fragments as sent, **excluding
     * the sampling seed**"*. With the seed in, every generation is unique, the
     * reuse lookup never matches, and the digest is a function that always
     * returns null — which looks like a working feature that quietly costs one
     * image per turn.
     */
    expect(recipeDigest(BINDING, prompt(), { steps: 20, seed: 1 })).toBe(
      recipeDigest(BINDING, prompt(), { steps: 20, seed: 99_999 }),
    );
  });

  it('ignores a fragment the cap dropped, because it was not sent', () => {
    // *"The fragments as sent"*, literally. A fragment that was assembled and
    // then dropped did not reach the endpoint, so two prompts that sent the same
    // text are the same recipe whatever they offered.
    const sent = prompt();
    const offeredMore = prompt({
      fragments: [...prompt().fragments, { id: 'channels', text: 'just before dawn', rank: 60 }],
      dropped: [{ id: 'channels', rank: 60, reason: 'over-useful-cap' }],
    });

    expect(recipeDigest(BINDING, offeredMore, {})).toBe(recipeDigest(BINDING, sent, {}));
  });
});

describe('different recipes hash differently', () => {
  it('answers differently for a different place', () => {
    const elsewhere = prompt({
      fragments: [
        { id: 'place', text: 'the lighthouse stair', rank: 100, required: true },
        { id: 'tone', text: 'cold and salt-bitten', rank: 80 },
      ],
      text: 'the lighthouse stair, cold and salt-bitten',
    });

    expect(recipeDigest(BINDING, elsewhere, {})).not.toBe(recipeDigest(BINDING, prompt(), {}));
  });

  it('answers differently when the workflow changes', () => {
    expect(recipeDigest(BINDING, prompt(), { steps: 20 })).not.toBe(
      recipeDigest(BINDING, prompt(), { steps: 40 }),
    );
  });

  it('answers differently after the image role is rebound', () => {
    /**
     * ***[P9 §0.3]'s item 2, as the scenario it was found by.***
     *
     * Without the binding in the key, a person who points `image` at a better
     * endpoint gets the *old* provider's backdrop for every place they have
     * already visited — permanently, because the digest matches and the lookup
     * short-circuits before anything dispatches. There is no control that would
     * fix it and nothing on screen that would explain it.
     *
     * `summariserKey` makes the same call for summaries ([P8 §1.9]): *"the whole
     * binding, not the model id. Two connections serving what they both call
     * `llama-3.1-8b` are not the same model."* The asymmetry is the same size —
     * wrong toward *derive* costs one image, wrong toward *reuse* shows a
     * picture nobody's current configuration accounts for.
     */
    const other: Binding = { connectionId: 'c-2', modelId: 'sdxl' };
    expect(recipeDigest(other, prompt(), {})).not.toBe(recipeDigest(BINDING, prompt(), {}));
  });

  it('answers differently for the same model id on a different connection', () => {
    // The half of [P8 §1.9]'s sentence that a model-id-only key would miss: two
    // connections serving what they both call `sdxl` are two endpoints.
    const sameModel: Binding = { connectionId: 'c-3', modelId: 'sdxl' };
    expect(recipeDigest(sameModel, prompt(), {})).not.toBe(recipeDigest(BINDING, prompt(), {}));
  });

  it('answers differently for a different model on one connection', () => {
    const otherModel: Binding = { connectionId: 'c-1', modelId: 'flux' };
    expect(recipeDigest(otherModel, prompt(), {})).not.toBe(recipeDigest(BINDING, prompt(), {}));
  });
});

describe('the length prefix', () => {
  it('tells two fragmentations of one string apart', () => {
    /**
     * ***The collision the primitive exists to make unreachable***, reached
     * through this function so the argument is tested where it is relied on.
     *
     * `sessions/digest.ts` states it for summaries — *"a collision in a cache
     * key is not a crash, it is a session quietly reading another line's
     * summary"* — and read for renditions it is *a session quietly showing
     * another place's backdrop*, which is the same defect with pixels and harder
     * to notice: a summary from the wrong line reads oddly, and a picture of the
     * wrong room looks like a picture.
     *
     * A bare concatenation would make these two equal, because both join to
     * `"ab, c"` under a separator that is part of neither fragment.
     */
    const split = prompt({
      fragments: [
        { id: 'a', text: 'ab', rank: 100 },
        { id: 'b', text: 'c', rank: 80 },
      ],
      kept: ['a', 'b'],
      text: 'ab, c',
    });
    const otherSplit = prompt({
      fragments: [
        { id: 'a', text: 'a', rank: 100 },
        { id: 'b', text: 'bc', rank: 80 },
      ],
      kept: ['a', 'b'],
      text: 'a, bc',
    });

    expect(recipeDigest(BINDING, split, {})).not.toBe(recipeDigest(BINDING, otherSplit, {}));
  });

  it('tells a different separator apart', () => {
    // Two recipes that render alike under one separator are still two recipes,
    // and the one that was sent is the one the digest is about.
    expect(recipeDigest(BINDING, prompt({ separator: ' | ' }), {})).not.toBe(
      recipeDigest(BINDING, prompt(), {}),
    );
  });
});
