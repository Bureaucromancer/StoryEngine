// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { writeAtomic } from '../storage/atomic.js';
import { ensureDirectory, readFileBytes } from '../storage/files.js';
import type { Layout } from '../storage/layout.js';
import { generateSecret } from './secrets.js';

/**
 * The first-run setup token — [09 §5.1](../../../../docs/design/09-server-multiuser-deployment.md),
 * [P6A §1.4](../../../../docs/design/workplan/19-p6a-alpha-1.md), F10.
 *
 * **The check, not the print** — [P10 §1.1](../../../../docs/design/workplan/26-p10-implementation.md)
 * names the failure this file exists to not repeat. P1 printed a freshly
 * generated token on every non-loopback boot and stored it nowhere, so nothing
 * ever verified it: security theatre in the one place theatre is worst, because
 * an operator who reads *setup token* in a console reasonably concludes
 * something is enforcing it. P2.0 removed the print rather than half-building
 * the check. This is the check, and the print comes back with it.
 *
 * **Why now.** [09 §5.1] scheduled it against an artifact rather than a phase —
 * *until an image ships, nothing binds non-loopback without someone typing a
 * bind address* — and that sentence is a condition. P6A ships the image, so the
 * condition fired here.
 *
 * **Stored, and that is the whole difference.** Generated once and kept beside
 * the session key, so a restart does not invalidate a token an operator has
 * already copied out of `docker logs` — which is exactly the window in which
 * they are using it, and a container that restarts while somebody is reading
 * its log is ordinary rather than exotic.
 *
 * It is not revoked after setup. Nothing reads it once an admin exists: both
 * the check and the advertisement are conditioned on `needsSetup()`, so the file
 * is inert rather than dangerous, and deleting it on success would be a write
 * during the one operation that must not acquire new ways to fail.
 */
export async function loadOrCreateSetupToken(layout: Layout): Promise<string> {
  const path = layout.setupTokenFile;
  const existing = await readFileBytes(path);
  if (existing !== null) {
    const text = new TextDecoder().decode(existing).trim();
    if (text.length > 0) return text;
  }

  const token = generateSecret();
  await ensureDirectory(layout.stateRoot);
  await writeAtomic(path, `${token}\n`);
  return token;
}
