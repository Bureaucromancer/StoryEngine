// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { setupAnswerSchema, type SetupSchema } from '@storyengine/sdk';
import { createValidator, type ValidateFunction } from '@storyengine/shared';

/**
 * Holding a session's setup answers to the mode's declaration —
 * [06 §7.3](../../../../docs/design/06-modes-and-turn-pipeline.md),
 * [P7.4](../../../../docs/design/workplan/23-p7-implementation.md).
 *
 * **This is what makes a declared wizard load-bearing.** A mode says what it
 * needs before the first turn; without a check, that declaration describes a
 * screen somebody might build and constrains nothing. With one, a `required`
 * field cannot be skipped and a key the mode never asked for cannot reach a
 * session file.
 *
 * **The schema is derived, never declared beside the fields** —
 * `setupAnswerSchema` is in the SDK so the client validates against the same
 * derivation, which is `library/fields.ts`' arrangement: one description of a
 * kind's fields, two readers of it.
 *
 * *The opposite posture from `channel-schema.ts`, and the difference is who is
 * wrong.* There, a value that fails is a model's proposal or a mode's own
 * schema drifting under live sessions, so nothing throws and the session always
 * opens. Here the value is a **form submission that has not been stored yet**,
 * so refusing it costs nobody a session and accepting it would write data the
 * mode cannot read.
 */

/**
 * Compiled validators, keyed by the declaration object.
 *
 * A mode's `setup` is a constant on its definition, so the object identity is
 * stable for the life of the process and a re-registered mode is a different
 * object — the `WeakMap`-on-the-object argument `channel-schema.ts` arrived at
 * after getting a string key wrong once.
 */
const compiled = new WeakMap<SetupSchema, ValidateFunction | null>();

const validator = createValidator();

function validatorFor(setup: SetupSchema): ValidateFunction | null {
  const held = compiled.get(setup);
  if (held !== undefined) return held;

  let fn: ValidateFunction | null;
  try {
    fn = validator.compile(setupAnswerSchema(setup));
  } catch {
    /**
     * **A declaration that will not compile accepts everything**, which is the
     * same call `channel-schema.ts` makes and for the same reason: a broken
     * declaration is a mode author's mistake, and refusing every session over it
     * takes the mode out of service for something nobody playing can fix
     * ([00 §3.3]).
     *
     * *It is nearly unreachable, because the schema is derived from a closed
     * widget vocabulary rather than authored — which is an argument for the
     * derivation rather than a reason to skip the guard.*
     */
    fn = null;
  }
  compiled.set(setup, fn);
  return fn;
}

/**
 * The issues, or `null` when the answers fit.
 *
 * A mode declaring `{ kind: 'none' }` accepts exactly `{}` — the derivation says
 * `additionalProperties: false` over no properties — so a client sending answers
 * to a mode with no wizard is told rather than quietly ignored.
 */
export function setupMisfit(setup: SetupSchema, answers: unknown): string[] | null {
  const validate = validatorFor(setup);
  if (validate === null) return null;
  if (validate(answers)) return null;

  return (validate.errors ?? [])
    .map(
      (error) => `${error.instancePath === '' ? '/' : error.instancePath} ${error.message ?? ''}`,
    )
    .map((line) => line.trim())
    .slice(0, 8);
}
