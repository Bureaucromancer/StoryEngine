// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import type { ChannelDefinition } from '@storyengine/sdk';
import { createValidator, type Ajv, type ValidateFunction } from '@storyengine/shared';

import { channelDefinition } from './channels.js';

/**
 * Holding a channel's value to the schema it declares —
 * [06 §4.2](../../../../docs/design/06-modes-and-turn-pipeline.md),
 * [25 B7](../../../../docs/design/25-open-questions.md), built at
 * [P7.1](../../../../docs/design/workplan/23-p7-implementation.md).
 *
 * **Two callers, two answers, and they are not the same rule.** A *proposal*
 * that fails its schema is refused and recorded as refused — 21 §1.2 lists
 * *"validation failure"* first among `rejectedReason`'s causes and nothing had
 * ever produced one. A value *already in state* that fails is a different
 * situation: nobody is proposing anything, the value was legal when it was
 * written, and the mode changed shape underneath it. That one runs the ladder.
 *
 * **The calibration 06 §4.2 opens with is load-bearing here.** Channel state is
 * *"tracked numbers and flags — HP, a clock, a reputation. It is not the
 * story."* The worst honest outcome of getting this wrong is a reset inventory,
 * which is why a session **always opens** and why none of this throws.
 */

/**
 * Compiled validators, keyed by channel id and version.
 *
 * **Version is in the key because a definition can be replaced in place.**
 * `registerChannel` is last-write-wins, so the same id can carry a different
 * schema after a reload — and a cache keyed on id alone would then validate new
 * values against the old shape, silently, which is the failure mode hardest to
 * see from the outside. Two entries for one id costs a few hundred bytes.
 *
 * *A `Map` rather than a `WeakMap` on the definition object because the key has
 * to survive a definition being re-registered as an equal-but-distinct object,
 * which is what a loader that re-imports a package produces.*
 */
const compiled = new Map<string, ValidateFunction>();

const validator = createValidator();

function validatorFor(definition: ChannelDefinition): ValidateFunction | null {
  return cached(compiled, validator, definition);
}

function cached(
  into: Map<string, ValidateFunction>,
  ajv: Ajv,
  definition: ChannelDefinition,
): ValidateFunction | null {
  const key = `${definition.id}@${String(definition.version)}`;
  const held = into.get(key);
  if (held !== undefined) return held;

  let fn: ValidateFunction;
  try {
    fn = ajv.compile(definition.schema);
  } catch {
    /**
     * **A schema that will not compile is a broken declaration, not a broken
     * value**, and the two deserve opposite treatment. Refusing every value on a
     * channel whose author wrote invalid JSON Schema would take the channel out
     * of service over a mistake the *player* cannot fix; treating it as
     * unconstrained lets the session keep working and leaves the mistake where
     * it belongs. Same shape as `refuse`'s unknown-channel branch, and the same
     * reason: a turn that failed over this would be a worse outcome than one
     * that carried on.
     */
    return null;
  }
  into.set(key, fn);
  return fn;
}

/** What a failed validation has to say for itself. */
export interface SchemaFailure {
  /** Ajv's messages, joined and trimmed to something a panel can render. */
  issues: string[];
}

/**
 * Validates a value against a channel's declared schema.
 *
 * Returns `null` when it passes, when the channel is unknown, or when its schema
 * could not be compiled — each for a stated reason above. A caller that needs to
 * tell those apart has `channelDefinition` to hand.
 */
export function schemaFailure(channelId: string, value: unknown): SchemaFailure | null {
  const definition = channelDefinition(channelId);
  if (definition === null) return null;

  const validate = validatorFor(definition);
  if (validate === null) return null;
  if (validate(value)) return null;

  return { issues: issuesOf(validate) };
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
 * ***The load-time ladder is not here, and leaving it out was a finding rather
 * than a scope cut*** — [P7.1], 2026-09-11.
 *
 * [06 §4.2]'s ladder is *validate → coerce → migrate → quarantine*, and the
 * first draft of this file implemented three of those rungs as a pure function
 * over a stored `ChannelState`. It is not shipped, because there was nowhere
 * correct to call it and finding that out is worth recording.
 *
 * **The obvious call site breaks the P6 gate.** `turns/gather.ts` is the one
 * place the pipeline reads channel state, and the runner chains each effect's
 * `before` from that map. Ladder there and a quarantined clock's reset becomes
 * the next effect's `before`, while the log's previous effect still records the
 * impossible value as its `after` — so replay-from-zero and
 * snapshot-plus-replay disagree at that node, which is the assertion
 * [07 §4](../../../../docs/design/07-branching.md) makes a CI step of. The same
 * argument rules out laddering inside `readSession`: `reconcileHandEdits`
 * compares the file against a raw replay, and a laddered file would read as a
 * hand edit and be written into the log as one.
 *
 * **So a quarantine is a change of state, not a way of looking at state**, and
 * 06 §4.2 says as much without drawing the conclusion: *"initialise the channel
 * to its default"* is a write. Which means it belongs where
 * `divergenceEffects` already lives — a recorded, attributed, reversible effect
 * appended at load, on the same lock, in the same turn — and it needs one thing
 * that does not exist yet: a way for `applyEffects` to know an effect was a
 * quarantine, so `ChannelState.degraded` acquires a writer rather than staying
 * the inert type [P7 §0.1a] found it as. That is the next commit's, and it is a
 * record-shape decision rather than a wiring job, which is why it is not folded
 * into this one.
 *
 * *What ships here is the rung with an unambiguous home: validation on the way
 * **in**, where 21 §1.2 already names the outcome.*
 */
