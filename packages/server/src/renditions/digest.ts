// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import type { AssembledPrompt } from '@storyengine/shared';

import { digest } from '../sessions/digest.js';
import type { Binding } from '../providers/types.js';

/**
 * The reuse key — [06 §10.1a](../../../../docs/design/06-modes-and-turn-pipeline.md),
 * [P9 §1.7], and the thing that decides what a backdrop costs.
 *
 * §10.1a: *"before dispatching, the step looks for a ready background rendition
 * in this session whose **recipe digest** already matches — a hash over the
 * assembled ranked fragments as sent, excluding the sampling seed — and selects
 * that one instead of paying again."* Keyed, a backdrop costs roughly one image
 * per **place**; unkeyed it costs one per turn, which is §5's cost question
 * arriving by accident.
 *
 * ***The digest is free, and §1.7 says that is not a coincidence***: it hashes
 * the recipe, which is the artefact this phase's exit gate re-runs anyway. *A
 * recipe permanent enough to re-run is a recipe stable enough to key on* — so if
 * this function turns out to be hard to write, the property is not being
 * honoured and the digest is the cheap early warning for it.
 */

/**
 * `H(binding ‖ the fragments as sent ‖ the workflow minus the seed)`.
 *
 * ***Two amendments to what §1.7 originally specified***, both from
 * [P9 §0.3]'s item 2, and neither is visible until you read
 * [`sessions/digest.ts`](../sessions/digest.ts) beside that paragraph.
 *
 * **The resolved binding is in the key.** As §1.7 first wrote it — a hash over
 * the fragments alone — rebinding the `image` role to a different endpoint
 * returns the *old* provider's backdrop for every place already visited,
 * permanently and with no way to ask for the new one, because the digest cannot
 * tell the two apart. `summariserKey` makes the opposite call for the identical
 * reason ([P8 §1.9]): *"the whole binding, not the model id. Two connections
 * serving what they both call `llama-3.1-8b` are not the same model."* The
 * asymmetry is the same size here and points the same way — wrong toward
 * *derive* costs one image, wrong toward *reuse* shows a picture nobody's
 * current configuration accounts for.
 *
 * **The parts are length-prefixed**, which is why this calls {@link digest}
 * rather than joining. A bare concatenation makes `H("ab","c")` and
 * `H("a","bc")` equal, and over a list of fragment texts that is *a session
 * quietly showing another place's backdrop*.
 *
 * ***What is excluded, and why exclusion is the whole trick.*** The **sampling
 * seed** is out: it is different on every generation by construction, so a
 * digest carrying it would never match anything and the reuse lookup would be a
 * function that always returns null. Everything else in the request either
 * describes the same place the same way or does not, so it is in.
 *
 * **Hashed over the kept fragments individually rather than over `prompt.text`.**
 * That is literally *"the assembled ranked fragments as sent"*, and it is the
 * case the length prefix exists for: two different fragmentations that join to
 * one string must not collide, because they are two different recipes that
 * happen to render alike under one separator.
 */
export function recipeDigest(
  binding: Binding,
  prompt: AssembledPrompt,
  workflow: Readonly<Record<string, string | number | boolean>>,
): string {
  const byId = new Map(prompt.fragments.map((fragment) => [fragment.id, fragment.text]));
  const sent = prompt.kept.map((id) => byId.get(id) ?? '');

  return digest([
    /**
     * A domain tag, so a rendition digest and a summary key can never be the
     * same string for the same inputs. They are stored in sibling directories
     * under one session and read by different code; a collision across the two
     * would be a category error that looks like a cache hit.
     */
    'rendition',
    binding.connectionId,
    binding.modelId,
    prompt.separator,
    ...sent,
    canonicalWorkflow(workflow),
  ]);
}

/**
 * The workflow as one stable string, minus the seed.
 *
 * **Sorted by key, because an object's insertion order is not a fact about the
 * request.** Two steps that set the same parameters in different orders are
 * asking for the same picture, and a digest that disagreed would dispatch a
 * second job for a place already rendered — the exact failure this module
 * exists to prevent, arriving through the back door.
 *
 * *Scalars only, which `RenditionProvenance.workflow` already requires and which
 * this is the reason for*: a nested object would need a recursive canonicaliser,
 * and a canonicaliser with a bug is a digest that is stable until the day
 * somebody nests something.
 */
function canonicalWorkflow(workflow: Readonly<Record<string, string | number | boolean>>): string {
  const entries = Object.entries(workflow)
    .filter(([key]) => key !== 'seed')
    .sort(([left], [right]) => left.localeCompare(right));
  return JSON.stringify(entries);
}
