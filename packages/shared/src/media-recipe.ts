// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import type { Rendition } from './rendition.js';
import type { MediaRecipe } from './schema/common.js';

/**
 * ***A rendition's recipe, as a picture in the library carries it*** —
 * [26 B20](../../../docs/design/26-open-questions.md), built 2026-10-13.
 *
 * Two records describe a generated picture and they sit on opposite sides of
 * [00 §3.2](../../../docs/design/00-stance.md)'s line. `RenditionProvenance` is
 * **internal**: it names the connection the call went through, says whether the
 * seed left the process, and lives with its session. {@link MediaRecipe} is
 * **portable**: it rides on an `EmbeddedMedia` row inside a card anybody can
 * download. B20 decided that the recipe crosses and the binding does not, and
 * this function is that sentence as code — the one place the line is drawn
 * rather than described, so a reader wanting to know what leaves an install with
 * a kept picture reads six fields here instead of three documents.
 *
 * ***What crosses, and how each field is decided:***
 *
 * - **`model` is what answered, else what was bound** — `answeredAs` when the
 *   endpoint reported a different model from the one asked for, and the bound
 *   model id otherwise. *Never `binding.connectionId`*: that names a
 *   connection on one install, and on anybody else's install it names nothing,
 *   so a recipe has no use for it. *(Corrected 2026-10-13, at the merge into
 *   `main`: this said §3.2 keeps the id at home, and it does not — §3.2 keeps
 *   the connection, its URL and its key. ~~A session export and a World file's
 *   sessions carry the whole rendition record, id included, on P16's reasoning
 *   in `packaging/world-file.ts`: an id is not a connection.~~ The recipe leaves
 *   it out because it is useless there, not because it may not travel.)*
 *   *(2026-10-13 again, the owner's decision the same day: the struck sentence
 *   was true when it was written and is not now. A session export and a World
 *   file's sessions carry the rendition record whole **except** this id — the
 *   binding travels as `{ modelId }` (`sessions/export.ts`,
 *   `travellingRendition`) — for the reason given here: on anybody else's
 *   install it names nothing. Nothing about this function changes; the
 *   projection never read the id, and an absent one projects the same model.)*
 * - **`seed` only when it was sent.** `seedSent` is the one field that says
 *   whether the picture was made from the seed the record states, and it reads
 *   three ways (`rendition.ts`): `true`, sent; `false`, not sent, so the
 *   endpoint drew its own; absent, not recorded — a record from before
 *   2026-10-03, when the OpenAI-compatible adapter never put a seed on the wire
 *   at all while every record went on stating one. **Only `true` can vouch for
 *   the seed**, so only `true` projects one; the other two are `null`. B20 named
 *   `false` and stopped short of the absent case, which is the same answer for
 *   the same reason: a recipe that offered a seed the picture was not made from
 *   would re-create a different picture while claiming to re-create this one.
 * - **`seed` as digits**, and only a safe non-negative integer becomes one. This
 *   build draws seeds below 2³¹ (`renditions/illustrate.ts`), so anything else
 *   is a record somebody edited, and a seed this cannot spell exactly is a seed
 *   it does not offer.
 * - **`prompt` is the text as sent** — `AssembledPrompt.text`, after capping.
 *   The fragments and what the cap dropped are how this build re-derives that
 *   text, and they stay with the rendition: another tool re-creates the picture
 *   from the prompt, not from our assembler.
 * - **`workflow` is copied.** Scalars on both sides, under the same rule, and
 *   this build's own generators send `{}`. What a workflow from somewhere else
 *   says about its author's disk is an export question (B20's third item), not
 *   this function's.
 * - **`generator` is `"StoryEngine"`**, without a version: the prompt as sent is
 *   recorded, so the assembler that produced it does not need to be.
 *
 * ***Called by nothing yet, and said so.*** Nothing in 1.0 keeps a rendition as
 * library media — `renditions/store.ts` argues a backdrop must not outlive its
 * story — and the first thing that does is the Character Studio's reference set
 * ([18 §3](../../../docs/design/18-character-studio.md)) or a front end that
 * hands the library a picture it made. It ships ahead of both because B20's
 * line is only checkable where it is code: `media-recipe.test.ts` pins that no
 * connection id survives the projection and that an unsent seed never does. A
 * caller that writes its own projection inline instead is the defect this
 * module exists to prevent.
 *
 * Pure, per this package's rule: a record in, a record out, no clock.
 */
/** What a recipe this build wrote says made it. */
export const STORYENGINE_GENERATOR = 'StoryEngine';

export function recipeOfRendition(rendition: Rendition): MediaRecipe {
  const { provenance } = rendition;
  return {
    at: provenance.at,
    generator: STORYENGINE_GENERATOR,
    model: provenance.answeredAs ?? provenance.binding?.modelId ?? null,
    seed: provenance.seedSent === true ? seedDigits(provenance.seed) : null,
    prompt: rendition.prompt.text,
    workflow: { ...provenance.workflow },
  };
}

/**
 * A seed as {@link MediaRecipe} spells one, or null when there is no exact
 * spelling — a fraction, a negative, or a number past 2⁵³ that has already been
 * rounded by the time it reaches here.
 */
export function seedDigits(seed: number | null): string | null {
  if (seed === null || !Number.isSafeInteger(seed) || seed < 0) return null;
  return String(seed);
}
