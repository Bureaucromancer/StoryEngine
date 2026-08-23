// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import type { Config } from '../config.js';

/**
 * The one password rule, checked where a password is set — [04 §4.1](../../../../docs/design/04-server-multiuser-deployment.md).
 *
 * **A function rather than the `minLength` in the four schemas it replaces**,
 * and the reason is the tier. Ajv compiles a route schema once, when the route
 * is registered, so a literal there would be this install's policy *as it stood
 * at boot* — and `auth.minPasswordLength` is tiered `live`, which is a promise
 * that a save takes effect on the next request rather than the next start.
 *
 * **It takes the `Config` rather than the number**, deliberately.
 * `applyLiveConfig` assigns *into* `services.config` (`app.ts`) rather than
 * replacing it, so holding that object is safe and holding a number read out of
 * it is not. A signature that cannot accept the number is a signature nobody
 * can hoist the number out of.
 *
 * **It returns the body rather than sending it**, so the shape below is written
 * once. That shape is not free invention: it is exactly what the global error
 * handler produced while these were schema literals, down to Ajv's own wording,
 * because [the API doc](../../../../docs/api.md) publishes `400 invalid` as
 * carrying `issues` — `{path, message}` per field — and a refactor that quietly
 * stopped carrying them would make a shipped contract false for precisely the
 * requests it describes.
 *
 * **Nothing here runs where a password is verified.** Login measures nothing: a
 * length rule at the door would refuse a password that is genuinely correct —
 * every account whose password predates a raised minimum, and every one the
 * console set below it — and would turn the login route into a way to read this
 * install's rule from outside.
 */
export interface Refusal {
  error: 'invalid';
  message: string;
  issues: { path: string; message: string }[];
}

/**
 * The refusal body for a password shorter than this install accepts, or `null`
 * when it is long enough.
 *
 * `field` is the body property being set — `password` on setup and on an admin
 * creating an account, `newPassword` on either reset — and it is what makes the
 * `issues` entry point at the field the caller actually sent.
 */
export function refuseShortPassword(
  field: string,
  password: string,
  config: Config,
): Refusal | null {
  const minimum = config.auth.minPasswordLength;
  if (password.length >= minimum) return null;

  // Ajv's own sentence for `minLength`, reproduced rather than paraphrased:
  // this reply used to come from Ajv, and no client should be able to tell that
  // it stopped.
  const message = `must NOT have fewer than ${String(minimum)} characters`;
  return {
    error: 'invalid',
    message: `body/${field} ${message}`,
    issues: [{ path: `/${field}`, message }],
  };
}
