// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { describe, expect, it } from 'vitest';

import { newLoreEntry, newLorebook } from './factories.js';
import { recipeOfRendition, seedDigits, STORYENGINE_GENERATOR } from './media-recipe.js';
import { RENDITION_SCHEMA, type Rendition } from './rendition.js';
import type { GeneratedFieldProvenance, MediaRecipe } from './schema/common.js';
import { validate } from './schema/registry.js';

/**
 * ***[26 B20](../../../docs/design/26-open-questions.md)'s line, held as code.***
 *
 * B20 decided that a kept picture's recipe travels and its binding does not.
 * `recipeOfRendition` is where that is drawn, so this file is where it is
 * checked: the connection never crosses, a seed the picture was not made from
 * never crosses, and what does cross is a recipe the portable schema accepts —
 * because a projection the published schema then refused would be a line drawn
 * somewhere nobody can stand.
 */

/** True only when `From` is assignable to `To`. A compile-time assertion carrier. */
type Assignable<From, To> = [From] extends [To] ? true : false;

const KEPT: Rendition = {
  schema: RENDITION_SCHEMA,
  id: 'r-1',
  sessionId: 's-1',
  turnId: 't-1',
  createdAt: '2026-10-13T09:00:00.000Z',
  kind: 'image',
  purpose: 'illustration',
  scope: null,
  state: 'ready',
  prompt: {
    fragments: [
      { id: 'moment', text: 'a woman with cropped grey hair at a rail', rank: 100, required: true },
      { id: 'tone', text: 'overcast, salt-bitten', rank: 60 },
    ],
    separator: ', ',
    budget: { maxChars: 320, usefulChars: 180 },
    text: 'a woman with cropped grey hair at a rail, overcast, salt-bitten',
    kept: ['moment', 'tone'],
    dropped: [],
    overCap: false,
  },
  asset: { path: 'r-1.png', mime: 'image/png', bytes: 20_481, digest: 'sha256:abc' },
  provenance: {
    at: '2026-10-13T09:00:04.000Z',
    binding: { connectionId: 'conn-on-this-install', modelId: 'sdxl-turbo' },
    answeredAs: null,
    seed: 918_273,
    seedSent: true,
    workflow: { steps: 24, cfg: 6.5, sampler: 'dpmpp_2m', hires: false },
  },
  error: null,
  digest: 'd-1',
  ordering: 0,
};

function keptWith(provenance: Partial<Rendition['provenance']>): Rendition {
  return { ...KEPT, provenance: { ...KEPT.provenance, ...provenance } };
}

describe('a rendition kept as library media', () => {
  it('carries when, what ran it, the model, the seed, the prompt as sent and the workflow', () => {
    expect(recipeOfRendition(KEPT)).toEqual({
      at: '2026-10-13T09:00:04.000Z',
      generator: STORYENGINE_GENERATOR,
      model: 'sdxl-turbo',
      seed: '918273',
      prompt: 'a woman with cropped grey hair at a rail, overcast, salt-bitten',
      workflow: { steps: 24, cfg: 6.5, sampler: 'dpmpp_2m', hires: false },
    });
  });

  it('leaves the connection on the install that made the call', () => {
    // [00 §3.2]: a connection id names something on one install. It is the
    // half of `RenditionProvenance` that is a setting rather than a record,
    // and the whole reason that type stays internal.
    const serialised = JSON.stringify(recipeOfRendition(KEPT));
    expect(serialised).not.toContain('conn-on-this-install');
    expect(serialised).not.toContain('connection');
  });

  it('names the model that answered when it was not the one asked for', () => {
    expect(recipeOfRendition(keptWith({ answeredAs: 'sdxl-turbo-1.1' })).model).toBe(
      'sdxl-turbo-1.1',
    );
    expect(recipeOfRendition(keptWith({ binding: null })).model).toBeNull();
  });

  /**
   * ***Only a seed that was sent.*** `seedSent: false` means the endpoint drew
   * its own; absent means nobody recorded whether it was sent — every record
   * from before 2026-10-03, when the OpenAI-compatible adapter never sent one
   * while each record went on stating it. A recipe that offered either seed
   * would re-create a different picture and call it this one.
   */
  it('offers a seed only when the picture was made from it', () => {
    expect(recipeOfRendition(keptWith({ seedSent: false })).seed).toBeNull();

    const unrecorded: Rendition = { ...KEPT, provenance: { ...KEPT.provenance } };
    delete unrecorded.provenance.seedSent;
    expect(recipeOfRendition(unrecorded).seed).toBeNull();

    expect(recipeOfRendition(keptWith({ seed: null })).seed).toBeNull();
  });

  it('copies the workflow rather than sharing it', () => {
    const recipe = recipeOfRendition(KEPT);
    expect(recipe.workflow).not.toBe(KEPT.provenance.workflow);
  });

  /**
   * ***The projection and the published schema agree.*** A recipe this
   * function makes, on a row, inside a real portable object, validates — the
   * check that the code side of B20's line and the schema side are the same
   * line.
   */
  it('validates where it will live: on a picture inside a portable object', () => {
    const entry = newLoreEntry('The Quay');
    const book = {
      ...newLorebook('Rain City'),
      entries: [
        {
          ...entry,
          media: [
            {
              id: '0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b',
              role: 'reference' as const,
              mime: 'image/png',
              digest: 'sha256:abc',
              bytes: 20_481,
              ref: 'assets/abc.png',
              tags: [],
              recipe: recipeOfRendition(KEPT),
            },
          ],
        },
      ],
    };
    const result = validate(book);
    expect(result.valid ? [] : result.issues).toEqual([]);
  });
});

describe('a seed spelled as digits', () => {
  it('spells a safe non-negative integer, and nothing else', () => {
    expect(seedDigits(0)).toBe('0');
    expect(seedDigits(2_147_483_646)).toBe('2147483646');
    expect(seedDigits(Number.MAX_SAFE_INTEGER)).toBe('9007199254740991');

    // Past 2^53 a number has already been rounded by the time it arrives, so
    // there is no exact spelling to give — and an inexact one is the failure
    // the string type exists to prevent.
    expect(seedDigits(2 ** 53)).toBeNull();
    expect(seedDigits(-1)).toBeNull();
    expect(seedDigits(1.5)).toBeNull();
    expect(seedDigits(Number.NaN)).toBeNull();
    expect(seedDigits(null)).toBeNull();
  });
});

describe('the two provenance types stay apart', () => {
  /**
   * `GeneratedFieldProvenance.seed` is a string holding a prompt, and
   * `MediaRecipe.seed` is a string holding digits — one word apart, both
   * strings. The schema tells them apart by pattern (`schema/media.test.ts`);
   * this tells them apart by shape, so neither can be handed in for the other.
   */
  it('refuses one where the other is wanted, both ways', () => {
    const refused: Assignable<GeneratedFieldProvenance, MediaRecipe> = false;
    expect(refused).toBe(false);
    const alsoRefused: Assignable<MediaRecipe, GeneratedFieldProvenance> = false;
    expect(alsoRefused).toBe(false);
  });
});
