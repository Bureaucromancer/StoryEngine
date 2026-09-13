// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import type { Candidate } from '@storyengine/sdk';
import { createValidator, type ValidateFunction } from '@storyengine/shared';

/**
 * Getting a shape out of a model that was never told about shapes —
 * [06 §7.3](../../../../docs/design/06-modes-and-turn-pipeline.md)'s incremental
 * generation, built at
 * [P7.4](../../../../docs/design/workplan/23-p7-implementation.md).
 *
 * **Two halves the provider layer deliberately does not do.** `GenerationRequest.schema`
 * says the degrade *"is a decision the caller makes with the capabilities in
 * hand, not a silent fallback"* in the adapter, and P7.4 measured the second
 * half: the SDK's `jsonSchema()` is a **carrier** — it puts the document on the
 * wire so the model is told what to write — and nothing on this side checks that
 * it did. `{"nom":"Vera"}` comes back as a successful object against a schema
 * requiring `name`. So:
 *
 * - **Ask in words when the wire cannot ask**, which for a self-hosted install
 *   is the ordinary path rather than the fallback: `openai-compatible` declares
 *   `supportsStructuredOutput: false` because the endpoint behind it could be
 *   anything, and out of the box the SDK drops the schema and asks for bare JSON.
 * - **Validate whichever path produced it.** The engine is the only validation
 *   there is.
 */

/**
 * The instruction a model gets when the wire could not carry the schema.
 *
 * **A candidate, not a message**, so it goes through `assemble` like everything
 * else: it is estimated, it lands in the block table with a source the workbench
 * can name, and `RenderedMessage.fromBlocks` stays non-empty. A prompt the
 * record cannot account for would be worst on exactly the calls hardest to
 * debug.
 *
 * **`required`, so the budgeter never drops it.** That field is for *"the things
 * a request is meaningless without"*, and a call that must answer in a shape is
 * meaningless without the sentence that says which shape. A schema large enough
 * to threaten the budget is a mode asking for too much in one part — which is
 * what incremental generation is for, and it is a better failure than a silently
 * unshaped call.
 *
 * **Not advisory**, and it must not be: `06 §5.2` refuses advisory content on a
 * call that produces effects, and every call that wants a schema is such a call.
 * This is not guidance — it is the request's own terms.
 *
 * *Last, and as a system message.* An instruction about the reply's form belongs
 * after the material it is about, which is also where every endpoint's own JSON
 * mode puts it.
 */
export function schemaInstruction(schema: object): Candidate {
  return {
    id: 'se.schema',
    source: { kind: 'schema' },
    // The workbench's words. A block whose reason read "schema" would be a debug
    // string; what a reader needs is why a sentence they did not write is in
    // their prompt.
    reason: 'this endpoint cannot be sent a schema, so it was asked in words',
    role: 'system',
    text: [
      'Reply with JSON and nothing else — no prose, no explanation, no code fence.',
      'It must match this JSON Schema:',
      JSON.stringify(schema),
    ].join('\n'),
    required: true,
  };
}

/**
 * Whether a schema was asked for in words rather than on the wire.
 *
 * **The capability, read at the call site**, which is where
 * `GenerationRequest.schema` says the decision belongs. A caller that degraded
 * unconditionally would spend tokens on every request to an endpoint that did
 * not need them; one that never degraded would ask a local model for a shape it
 * was never shown.
 */
export function needsPrompting(
  schema: object | undefined,
  supportsStructuredOutput: boolean,
): schema is object {
  return schema !== undefined && !supportsStructuredOutput;
}

/**
 * Compiled validators, keyed by the schema object.
 *
 * The same `WeakMap`-on-the-object argument `channel-schema.ts` arrived at after
 * getting it wrong once: a string key means a schema edited without a version
 * bump is validated by a stale function for the life of the process, silently.
 * Here there is not even a version to bump — a request schema is whatever a step
 * handed over — so the object is the only honest key.
 */
const compiled = new WeakMap<object, ValidateFunction | null>();

const validator = createValidator();

function validatorFor(schema: object): ValidateFunction | null {
  const held = compiled.get(schema);
  if (held !== undefined) return held;

  let fn: ValidateFunction | null;
  try {
    fn = validator.compile(schema);
  } catch {
    /**
     * **A schema that will not compile is cached as such**, unlike the channel
     * one — and the difference is the caller. There, a broken declaration is a
     * mode author's mistake that must not take a channel out of service, and the
     * cost of recompiling is paid once per value on a channel nobody can use.
     * Here it would be paid on every call of every turn, because a step's schema
     * is handed over afresh each time.
     */
    fn = null;
  }
  compiled.set(schema, fn);
  return fn;
}

/** What a reply that did not fit has to say for itself. */
export interface SchemaMiss {
  /** The vocabulary a retry and a record both use. */
  reason: 'unparseable' | 'invalid';
  /** Ajv's messages, trimmed to something a panel can render. Empty for a parse miss. */
  issues: string[];
}

/**
 * Whether the object a call produced is the one it was asked for.
 *
 * `null` means it fits — or that nobody asked, or that the schema itself will
 * not compile. **The last of those is deliberately a pass**, and it is the same
 * call `channel-schema.ts` makes: a mode shipping invalid JSON Schema is a
 * broken declaration, and failing every call over it takes the mode out of
 * service for a mistake nobody playing can fix. [00 §3.3] is *resolve what you
 * can*; the mistake stays where it belongs, in the declaration.
 *
 * **`undefined` is `unparseable` rather than *nothing came back***, because the
 * adapter only leaves the key undefined when a schema *was* asked for — a call
 * nobody asked a shape of carries no key at all, and never reaches here.
 */
export function schemaMiss(schema: object | undefined, object: unknown): SchemaMiss | null {
  if (schema === undefined) return null;
  if (object === undefined) return { reason: 'unparseable', issues: [] };

  const validate = validatorFor(schema);
  if (validate === null) return null;
  if (validate(object)) return null;

  return { reason: 'invalid', issues: issuesOf(validate) };
}

function issuesOf(validate: ValidateFunction): string[] {
  return (validate.errors ?? [])
    .map(
      (error) => `${error.instancePath === '' ? '/' : error.instancePath} ${error.message ?? ''}`,
    )
    .map((line) => line.trim())
    .slice(0, 8);
}

/**
 * What a miss reads as in the turn record — [21 §1.4].
 *
 * **A sentence rather than Ajv's list**, because `ModelCall.error.message` is
 * what a person sees and *"/name must be string"* on its own does not say what
 * failed or that it was the model's doing. The issues go into it because they
 * are the only thing that distinguishes *nearly right* from *nothing like it*,
 * and that is the difference between raising the budget and rewriting the step.
 */
export function missMessage(miss: SchemaMiss): string {
  return miss.reason === 'unparseable'
    ? 'The model did not answer with JSON.'
    : `The model's answer did not match the shape asked for: ${miss.issues.join('; ')}`;
}
