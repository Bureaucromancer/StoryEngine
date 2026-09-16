// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { describe, expect, it } from 'vitest';

import type { GeneratedFieldProvenance } from './schema/common.js';
import {
  RENDITION_SCHEMA,
  type Rendition,
  type RenditionProvenance,
  type RenditionRequest,
} from './rendition.js';

/**
 * ***The recipe is a field, not a hope*** — [P9.0]'s proof obligation, and the
 * second arm is the one that matters.
 *
 * [P9 §1.1]'s whole warning is that the *wrong type passes review*:
 * [06 §10.1](../../../docs/design/06-modes-and-turn-pipeline.md) types
 * `Rendition.provenance` as `GeneratedFieldProvenance`, whose `seed` is
 * documented *"the input the generation ran from"* — a prompt string — while
 * §10.7 means the **sampling seed**, *"the load-bearing field here, and the one
 * an implementation is most likely to drop as uninteresting"*. The two readings
 * are one word apart. So this file asserts, at the type level, that they are no
 * longer one *assignment* apart either.
 *
 * *The obligation named `packages/shared/src/schema/rendition.test.ts` and this
 * is not that path*, deliberately. `schema/` means **portable** — a `$id`, an
 * entry in `PORTABLE_SCHEMAS`, an emitted artefact — and a rendition is internal
 * tier, governed by `turn.ts`'s sentence about the export freeze. Putting the
 * file there to match a path written before that was re-read would be filing the
 * type under a claim P9 declines to make. `repo-shape.test.ts` holds the claim
 * mechanically; this holds the recipe.
 */

/** True only when `From` is assignable to `To`. A compile-time assertion carrier. */
type Assignable<From, To> = [From] extends [To] ? true : false;

const A_RENDITION: Rendition = {
  schema: RENDITION_SCHEMA,
  id: 'r-1',
  sessionId: 's-1',
  turnId: 't-1',
  createdAt: '2026-09-16T10:00:00.000Z',
  kind: 'image',
  purpose: 'illustration',
  scope: { anchor: 'the lantern guttered' },
  state: 'ready',
  prompt: {
    fragments: [
      { id: 'moment', text: 'a guttering lantern on a wet quay', rank: 100, required: true },
      { id: 'tone', text: 'cold, salt-bitten, close to dawn', rank: 60 },
      { id: 'place', text: 'the harbour steps', rank: 40 },
    ],
    separator: ', ',
    budget: { maxChars: 320, usefulChars: 180 },
    text: 'a guttering lantern on a wet quay, cold, salt-bitten, close to dawn',
    kept: ['moment', 'tone'],
    dropped: [{ id: 'place', rank: 40, reason: 'over-useful-cap' }],
    overCap: false,
  },
  asset: { path: 'r-1.png', mime: 'image/png', bytes: 20_481, digest: 'sha256:abc' },
  provenance: {
    at: '2026-09-16T10:00:04.000Z',
    binding: { connectionId: 'c-1', modelId: 'sdxl-turbo' },
    answeredAs: null,
    seed: 918_273,
    workflow: { steps: 24, cfg: 6.5, sampler: 'dpmpp_2m', hires: false },
  },
  error: null,
  digest: 'd-1',
  ordering: 0,
};

describe('the recipe survives the round trip', () => {
  it('keeps the sampling seed as a number and the workflow whole', () => {
    const read = JSON.parse(JSON.stringify(A_RENDITION)) as Rendition;

    // The one field §10.7 calls load-bearing, and the one a JSON round trip is
    // most likely to quietly turn into a string if it were ever typed as one.
    expect(read.provenance.seed).toBe(918_273);
    expect(typeof read.provenance.seed).toBe('number');
    expect(read.provenance.workflow).toEqual({
      steps: 24,
      cfg: 6.5,
      sampler: 'dpmpp_2m',
      hires: false,
    });
    expect(read.provenance.binding).toEqual({ connectionId: 'c-1', modelId: 'sdxl-turbo' });
  });

  it('keeps every fragment the cap ran over, not only the ones it kept', () => {
    const read = JSON.parse(JSON.stringify(A_RENDITION)) as Rendition;

    /**
     * ***The difference between a record and a recipe.*** `CappedPrompt.kept` is
     * a list of *ids*, so a record that stored only the outcome could name what
     * it dropped and could never reproduce the input the cap ran over — which is
     * exactly what re-creation under a changed budget needs. [06 §10.3]'s
     * *"written once… and **replayed** on re-creation"* is unsatisfiable without
     * this array.
     */
    expect(read.prompt.fragments.map((one) => one.id)).toEqual(['moment', 'tone', 'place']);
    expect(read.prompt.kept).toEqual(['moment', 'tone']);
    expect(read.prompt.dropped).toEqual([{ id: 'place', rank: 40, reason: 'over-useful-cap' }]);

    // The separator too, because `capPrompt(fragments, budget, separator).text
    // === text` is the property the exit gate compares and a default would make
    // it true only for as long as nobody changed the default.
    expect(read.prompt.separator).toBe(', ');
  });

  it('survives an evicted asset with the recipe intact', () => {
    // [25 E3] and §1.4: the hook, not the policy. Dropping `asset` is the whole
    // of what an eviction policy would ever do, and it must cost nothing else.
    const evicted: Rendition = { ...A_RENDITION, asset: null };
    const read = JSON.parse(JSON.stringify(evicted)) as Rendition;

    expect(read.asset).toBeNull();
    expect(read.prompt.text).toBe(A_RENDITION.prompt.text);
    expect(read.provenance.seed).toBe(918_273);
    expect(read.digest).toBe('d-1');
  });
});

describe('the wrong provenance no longer passes review', () => {
  it('refuses a GeneratedFieldProvenance where a RenditionProvenance is wanted', () => {
    /**
     * ***[P9 §1.1]'s warning, made a compile error.***
     *
     * *"The two readings of `seed` are close enough that an implementation would
     * satisfy the type, pass review, and quietly ship a rendition that cannot be
     * reproduced."* It cannot now: `GeneratedFieldProvenance.seed` is
     * `string | null` and this one's is `number | null`, so the assignment the
     * design's own interface invited is refused by `tsc` rather than by whoever
     * is reading the diff.
     *
     * A conditional type rather than a `@ts-expect-error`, because the negative
     * is the assertion: an expect-error comment goes green the moment somebody
     * makes the assignment legal, which is the change this test exists to catch.
     */
    const refused: Assignable<GeneratedFieldProvenance, RenditionProvenance> = false;
    expect(refused).toBe(false);

    // And the other direction, so the two types are not merely different sizes:
    // a recipe is not a field-provenance either, and neither can stand in.
    const alsoRefused: Assignable<RenditionProvenance, GeneratedFieldProvenance> = false;
    expect(alsoRefused).toBe(false);
  });
});

describe('the step contract emits a list from the first commit', () => {
  it('asks for renditions as an array, with one element', () => {
    /**
     * [P9 §4]'s first of the three things that keep the count judgement's
     * deferral cheap: *"the step contract emits a **list** of rendition requests
     * from the first commit even though the list has one element, and the
     * ordering field the judgement will sort on has a home on the record."*
     *
     * Asserted as a shape rather than a behaviour because the behaviour is one
     * image per turn and will be for this whole release — what is being pinned
     * is that widening it is a change to a producer rather than to a type.
     */
    const requests: RenditionRequest[] = [
      {
        kind: 'image',
        purpose: 'illustration',
        scope: { anchor: 'the lantern guttered' },
        prompt: A_RENDITION.prompt,
        workflow: { steps: 24 },
        digest: 'd-1',
        ordering: 0,
      },
    ];

    expect(requests).toHaveLength(1);
    expect(requests[0]?.ordering).toBe(0);
  });
});
