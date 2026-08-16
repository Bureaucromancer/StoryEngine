// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

/**
 * The one file in the server allowed to draw cryptographic randomness.
 *
 * Same exemption as `shared/src/ids.ts` and the same argument: the randomness
 * rule ([07 §14](../../../../docs/design/07-tech-stack.md)) protects **replay and
 * branching** — every draw that can change what happens must be recorded, or a
 * reconstructed branch silently diverges. A password salt and a session key are
 * not draws. Nothing replays them, no narrative outcome depends on them, and
 * routing them through a recorded, replayable generator would be actively wrong:
 * it would put secrets on the turn tape.
 *
 * Kept to one file so the exemption stays one file wide and the fixture tests
 * can prove that the file next door is still caught.
 */

const scrypt = promisify(scryptCallback) as (
  password: string | Buffer,
  salt: string | Buffer,
  keylen: number,
) => Promise<Buffer>;

/**
 * scrypt, per [07 §9](../../../../docs/design/07-tech-stack.md).
 *
 * argon2id is marginally better and costs a native module. Given a threat model
 * of *access separation among people who already trust each other*
 * ([04 §4.1](../../../../docs/design/04-server-multiuser-deployment.md)) that trade is not
 * close — and it is also what SillyTavern uses, which matters for a project
 * whose users may migrate between them.
 *
 * What the threat model does **not** excuse, and this is the line doc 04 draws:
 * storing passwords in anything but a proper KDF. Rate limiting, lockout,
 * complexity policy and 2FA are all skippable. This is not.
 */
const SALT_BYTES = 16;
const KEY_BYTES = 64;

export interface PasswordHash {
  salt: string;
  hash: string;
}

export async function hashPassword(password: string): Promise<PasswordHash> {
  const salt = randomBytes(SALT_BYTES).toString('hex');
  const hash = await scrypt(password, salt, KEY_BYTES);
  return { salt, hash: hash.toString('hex') };
}

/**
 * Constant-time comparison.
 *
 * `timingSafeEqual` rather than `===` — cheap, and the alternative is the kind
 * of detail that is embarrassing rather than defensible when someone points at
 * it.
 */
export async function verifyPassword(password: string, stored: PasswordHash): Promise<boolean> {
  const expected = Buffer.from(stored.hash, 'hex');
  const actual = await scrypt(password, stored.salt, expected.length || KEY_BYTES);
  if (expected.length !== actual.length) return false;
  return timingSafeEqual(expected, actual);
}

/** A key for signing session cookies, or a setup token. */
export function generateSecret(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

/**
 * The one-time setup token printed to the console when the server is reachable
 * beyond loopback and no admin exists yet
 * ([04 §5.1](../../../../docs/design/04-server-multiuser-deployment.md)).
 *
 * Short enough to retype from a `docker logs` line, long enough that guessing it
 * inside the setup window is not a plan.
 */
export function generateSetupToken(): string {
  return randomBytes(12).toString('base64url');
}

/** Constant-time string comparison, for tokens that are not password hashes. */
export function secretsMatch(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}
