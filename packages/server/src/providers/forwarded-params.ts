// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import type { GenerationParams } from '@storyengine/shared';

/**
 * The sampler parameters this build actually puts on the wire, and the five it
 * does not.
 *
 * **Two different subsets, and the gap between them is the point.**
 * `GenerationParams` ([10 §8.4](../../../../docs/design/10-schemas.md)) is the
 * portable subset an OpenAI-compatible chat endpoint *could* understand. This is
 * the narrower set that survives the trip through `toSdkParams` and the SDK to
 * the request body. `topK`, `topA`, `minP`, `repetitionPenalty` and `n` are in
 * the first and not the second — so a SillyTavern preset carrying `top_k`,
 * `top_a`, `min_p`, `rep_pen` or `n` converts them faithfully
 * (`../import/sillytavern/preset.ts`, `../import/sillytavern/text-completion.ts`),
 * stores them, shows them in the editor, and they never reach a model.
 *
 * **Five, and they go missing in two different ways — which matters for whoever
 * fixes this.** Four of them are absent because `toSdkParams` never names them:
 * a line each, and the adapter is honest about not sending them. `topK` is the
 * nastier case. `toSdkParams` *does* pass it, and
 * `@ai-sdk/openai-compatible` drops it on the floor before the body is built,
 * because `top_k` is not in the OpenAI chat schema. So the adapter reads as
 * though it handles `topK` and does not, and no amount of looking at our own
 * code would tell you — which is why this constant is derived from the wire by a
 * test rather than by reading `toSdkParams` and copying the list. An earlier
 * draft of this file did exactly that and was wrong about `topK`.
 *
 * The SDK does say so, for what it is worth, and to nobody in particular:
 * `AI SDK Warning (openai-compatible.chat): The feature "topK" is not
 * supported.` It goes to `process.emitWarning`, which is not a place a user
 * looks and not a place the turn record reaches. Surfacing those warnings is
 * worth doing on its own account and is not this change.
 *
 * **Named here rather than fixed, deliberately.** Closing the gap means an
 * escape hatch through the adapter's provider-specific body — which is the third
 * of [10 §8.5](../../../../docs/design/10-schemas.md)'s open questions and a
 * change to the generation path, not to import. It is scheduled at
 * [polish §8](../../../../docs/design/workplan/09-polish.md). What this constant
 * buys in the meantime is the ability for the import review to *say so*: a
 * review that reports "5 sampler settings carried over" while five of them are
 * inert is a review that lies, and it lied for three phases because nothing
 * anywhere wrote down which ones travel.
 *
 * **A checked claim rather than a comment.** The test beside it drives the
 * adapter with every field set and reads the outgoing request body, so this list
 * cannot drift from the wire without going red — and it goes red on the day
 * polish §8 lands, which is exactly the day the import note has to change.
 */
export const FORWARDED_SAMPLER_PARAMS = [
  'temperature',
  'topP',
  'frequencyPenalty',
  'presencePenalty',
  'maxTokens',
  'stop',
  'seed',
] as const satisfies readonly (keyof GenerationParams)[];

/**
 * What each forwarded parameter is called in the request body.
 *
 * Only here so the test can assert against the wire rather than against a second
 * copy of its own expectations; nothing else needs it. The names are the SDK's
 * to choose, so a change here is a change the test should notice rather than one
 * this file should predict.
 */
export const FORWARDED_WIRE_NAMES: Readonly<
  Record<(typeof FORWARDED_SAMPLER_PARAMS)[number], string>
> = {
  temperature: 'temperature',
  topP: 'top_p',
  frequencyPenalty: 'frequency_penalty',
  presencePenalty: 'presence_penalty',
  maxTokens: 'max_tokens',
  stop: 'stop',
  seed: 'seed',
};

/**
 * Which of the parameters actually set on a preset will not reach a model.
 *
 * Takes the params rather than the whole `Preset` because that is all the
 * question needs, and because the import preview asks it of a converted object
 * before anything has decided to store one.
 *
 * `undefined` is the only absence. `seed: null` is a *set* value meaning *leave
 * it to the provider*, and since `seed` is forwarded either way the distinction
 * never reaches this list.
 */
export function inertParams(params: Readonly<GenerationParams>): string[] {
  const forwarded = new Set<string>(FORWARDED_SAMPLER_PARAMS);
  // Read as `unknown` values on purpose. `Object.entries` over the declared type
  // yields no `undefined` — every field is optional, and an absent key is not
  // enumerated — so the guard below reads as dead code and lints as one. It is
  // not: a key written explicitly as `undefined` *is* enumerated, and a preset
  // arrives here from a converter that spreads, so that is a shape this can
  // actually be handed. The cast is what lets the check be a real one.
  return Object.entries(params as Record<string, unknown>)
    .filter(([name, value]) => value !== undefined && !forwarded.has(name))
    .map(([name]) => name);
}
