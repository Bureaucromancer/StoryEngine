// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { describe, expect, it } from 'vitest';

import type { CastEntry } from '@storyengine/sdk';

import { capPrompt, type PromptFragment } from '../providers/prompt-caps.js';
import { capabilitiesFor } from '../providers/capabilities.js';
import type { ProviderCapabilities } from '../providers/types.js';
import {
  assemblePrompt,
  backdropFragments,
  fragmentsFor,
  illustrationFragments,
  type FragmentInputs,
} from './assemble.js';

/**
 * Where an image prompt comes from — [06 §10.3], [P9.1].
 *
 * ***This file is `prompt-caps.ts` acquiring its first production caller***, two
 * phases after it was written and tested with none ([P9 §0.1]'s finding 6). So
 * the assertions here are about **ranking**, not about capping: what goes in,
 * what order it is given up in, and the two rules §10.3 says the assembler owns
 * rather than asking a model for.
 */

const CAPS: ProviderCapabilities = capabilitiesFor('fake', {
  // The one place in the suite that sets these, and it is a test double rather
  // than `KNOWN_PROVIDERS`: `capabilities.ts` ships no invented numbers, and
  // CLIP's 77 tokens is a property of an endpoint's text encoder rather than of
  // "openai-compatible". A connection is where a person who knows says so.
  maxPromptChars: 200,
  usefulPromptChars: 80,
});

const ELENA: CastEntry = {
  actorId: 'a-1',
  name: 'Elena',
  kind: 'actors',
  media: [{ id: 'm-1', role: 'reference' }],
  visual: { hair: 'cropped grey hair', build: 'a tall woman', clothing: 'an oilskin coat' },
};

const NAMELESS: CastEntry = {
  actorId: 'a-2',
  name: 'The Harbourmaster',
  kind: 'actors',
  media: [],
};

function inputs(over: Partial<FragmentInputs> = {}): FragmentInputs {
  return {
    moment: 'a guttering lantern on a wet quay',
    cast: [ELENA],
    channels: [
      { id: 'se.location', text: 'the harbour steps' },
      { id: 'se.clock', text: 'just before dawn' },
    ],
    tone: 'cold and salt-bitten',
    ...over,
  };
}

describe('the illustration ranking', () => {
  it('opens with the moment, and the moment is required', () => {
    const fragments = illustrationFragments(inputs());
    const moment = fragments.find((one) => one.id === 'moment');

    // [19 §5.3]'s list opens with *subject*, and §10.3 names the moment as it.
    // `required` is what makes `capPrompt` report `overCap` rather than quietly
    // cutting the one fragment the prompt is pointless without.
    expect(moment?.text).toBe('a guttering lantern on a wet quay');
    expect(moment?.required).toBe(true);
    expect(Math.max(...fragments.map((one) => one.rank))).toBe(moment?.rank);
  });

  it('gives up the clock before the place, and the place before the tone', () => {
    const fragments = illustrationFragments(inputs());
    const rank = (id: string): number => fragments.find((one) => one.id === id)?.rank ?? -1;

    // Lower goes first. So this reads bottom-up: the other channels are the
    // first thing dropped and the moment is the last.
    expect(rank('channels')).toBeLessThan(rank('place'));
    expect(rank('place')).toBeLessThan(rank('tone'));
    expect(rank('tone')).toBeLessThan(rank('actors'));
    expect(rank('actors')).toBeLessThan(rank('moment'));
  });

  it('contributes nothing at all for a turn that narrated nothing', () => {
    const fragments = illustrationFragments(inputs({ moment: '   ' }));
    expect(fragments.some((one) => one.id === 'moment')).toBe(false);
  });
});

describe("a character's name never appears in an image prompt", () => {
  it('describes appearance and never identity', () => {
    /**
     * [06 §10.3]'s first assembler rule, and the clearest vindication [04 §3]'s
     * structured field has had: *"the image model does not know who Elena is; it
     * knows what a woman with cropped grey hair looks like."* Aventuras states
     * this rule **to the model**, which is the wrong place for it — a rule a
     * model is asked to follow is one it can decline to.
     */
    const actors = illustrationFragments(inputs()).find((one) => one.id === 'actors');

    expect(actors?.text).toContain('cropped grey hair');
    expect(actors?.text).not.toContain('Elena');
  });

  it('says nothing rather than a name when a card has no descriptors', () => {
    /**
     * The rule at its hardest, and where an implementation would be tempted to
     * fall back. A card imported from a format with no structured appearance has
     * `visual: null`, and *"The Harbourmaster"* in an image prompt is worse than
     * silence: it produces a stranger with confidence instead of an unspecified
     * figure.
     */
    const fragments = illustrationFragments(inputs({ cast: [NAMELESS] }));

    expect(fragments.some((one) => one.id === 'actors')).toBe(false);
    expect(fragments.map((one) => one.text).join(' ')).not.toContain('Harbourmaster');
  });

  it('keeps the people it can describe when one of them has no descriptors', () => {
    const actors = illustrationFragments(inputs({ cast: [ELENA, NAMELESS] })).find(
      (one) => one.id === 'actors',
    );

    expect(actors?.text).toContain('cropped grey hair');
    expect(actors?.text).not.toContain('Harbourmaster');
  });
});

describe('the backdrop ranking', () => {
  it('is the place first, and the place is required', () => {
    const fragments = backdropFragments(inputs());
    const place = fragments.find((one) => one.id === 'place');

    expect(place?.text).toBe('the harbour steps');
    expect(place?.required).toBe(true);
    expect(Math.max(...fragments.map((one) => one.rank))).toBe(place?.rank);
  });

  it('takes no moment, no output text and no actor descriptors', () => {
    /**
     * ***Three absences, and each is the design*** — [06 §10.3]'s background
     * branch, *"and the difference is the point rather than an optimisation"*.
     * No moment because a place has no moment (which is also why this branch
     * makes no call); no output text for the same reason one level down; no
     * descriptors because a backdrop is staged *behind* the cast rather than of
     * them.
     */
    const fragments = backdropFragments(inputs());
    const ids = fragments.map((one) => one.id);

    expect(ids).not.toContain('moment');
    expect(ids).not.toContain('actors');
    expect(fragments.map((one) => one.text).join(' ')).not.toContain('lantern');
  });

  it('is the same fragment set under a different ordering, not a second path', () => {
    /**
     * [P9 §1.7]: *"not a second assembly path — the same step under the same cap,
     * ranking channel state and tone up and the turn's output text and actor
     * descriptors out."* The check is that the two rankings disagree about
     * **order** over fragments they share, which is what *one set, two
     * orderings* means and what a second path would not produce.
     */
    const picture = illustrationFragments(inputs());
    const backdrop = backdropFragments(inputs());

    const placeUp = (list: PromptFragment[]): boolean => {
      const place = list.find((one) => one.id === 'place')?.rank ?? -1;
      const tone = list.find((one) => one.id === 'tone')?.rank ?? -1;
      return place > tone;
    };

    expect(placeUp(picture)).toBe(false);
    expect(placeUp(backdrop)).toBe(true);
  });

  it('is what `fragmentsFor` picks for a background', () => {
    // One statement of which builder a purpose uses, so a caller cannot pick
    // wrong — and P9.3's *Set the scene* and P9.1's step go through it.
    expect(fragmentsFor('background', inputs())).toEqual(backdropFragments(inputs()));
    expect(fragmentsFor('illustration', inputs())).toEqual(illustrationFragments(inputs()));
  });
});

describe('the recipe is what the cap ran over', () => {
  it('re-caps to the same text it sent', () => {
    /**
     * ***The property [21 §7] states and this phase's exit gate compares***:
     * `capPrompt(fragments, budget, separator).text === text`, for every
     * rendition, forever.
     *
     * It is only true because `fragments` holds **everything offered** rather
     * than what survived. `CappedPrompt.kept` is a list of ids, so a record that
     * stored only the outcome could name what it dropped and never reproduce the
     * input — which is what [06 §10.3]'s *written once and replayed* needs.
     */
    const prompt = assemblePrompt(illustrationFragments(inputs()), CAPS);

    const again = capPrompt(
      prompt.fragments.map((fragment) => ({ ...fragment })),
      {
        maxChars: prompt.budget.maxChars ?? undefined,
        usefulChars: prompt.budget.usefulChars ?? undefined,
      },
      prompt.separator,
    );

    expect(again.text).toBe(prompt.text);
    expect(again.kept).toEqual(prompt.kept);
    expect(again.dropped).toEqual(prompt.dropped);
  });

  it('survives the round trip through JSON, budget and all', () => {
    /**
     * `PromptBudget` is `number | undefined` and a stored recipe's is
     * `number | null`, because `undefined` does not survive `JSON.stringify` —
     * a budget that came back as an absent key would re-cap under *no* budget
     * and produce a longer prompt than the one that was sent.
     */
    const prompt = assemblePrompt(illustrationFragments(inputs()), CAPS);
    const read = JSON.parse(JSON.stringify(prompt)) as typeof prompt;

    expect(read.budget).toEqual({ maxChars: 200, usefulChars: 80 });
    expect(read.fragments).toEqual(prompt.fragments);
  });

  it('records a null budget rather than an absent one when nothing declared a cap', () => {
    // Which is every install today: `maxPromptChars` is set by no connection
    // fixture and no `KNOWN_PROVIDERS` entry, so `budgetFor` answers with two
    // undefineds and `capPrompt` drops nothing.
    const prompt = assemblePrompt(illustrationFragments(inputs()), capabilitiesFor('fake'));

    expect(prompt.budget).toEqual({ maxChars: null, usefulChars: null });
    expect(prompt.dropped).toEqual([]);
  });
});

describe('a prompt over the cap drops its lowest-ranked fragment and says which', () => {
  it('drops from the bottom and records the reason', () => {
    /**
     * **Gate row 7.** [19 §5.3]'s failure is *"silent truncation: the request
     * succeeds, the tail is discarded, and the user gets a degraded image with
     * nothing to indicate why"* — so the assertion is not that the prompt fits,
     * it is that the record says what went and why.
     */
    const tight: ProviderCapabilities = capabilitiesFor('fake', {
      maxPromptChars: 200,
      usefulPromptChars: 45,
    });
    const prompt = assemblePrompt(illustrationFragments(inputs()), tight);

    expect(prompt.dropped.length).toBeGreaterThan(0);
    expect(prompt.dropped.map((one) => one.id)).toContain('channels');
    expect(prompt.dropped.every((one) => one.reason === 'over-useful-cap')).toBe(true);
    // The subject is never what goes.
    expect(prompt.kept).toContain('moment');
    expect(prompt.text).toContain('a guttering lantern');
  });

  it('says so rather than cutting the subject when the subject alone is too long', () => {
    // `capPrompt` will not cut a required fragment in half to hide the problem,
    // and the record carries `overCap` so the workbench can say the prompt that
    // was sent was over the endpoint's limit.
    const tiny: ProviderCapabilities = capabilitiesFor('fake', {
      maxPromptChars: 10,
      usefulPromptChars: 5,
    });
    const prompt = assemblePrompt(illustrationFragments(inputs()), tiny);

    expect(prompt.overCap).toBe(true);
    expect(prompt.kept).toEqual(['moment']);
  });
});
