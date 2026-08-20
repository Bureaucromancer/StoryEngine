// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { readFileBytes } from '../storage/files.js';
import type { Layout } from '../storage/layout.js';
import { resolveWithin } from '../storage/paths.js';
import type { RoleBindings } from './roles.js';

/**
 * Where a user's role bindings live — `users/<handle>/bindings.json`.
 *
 * **A decision made under silence, and worth flagging as one.**
 * [04 §4.5](../../../../docs/design/04-server-multiuser-deployment.md) and
 * [07 §5.1](../../../../docs/design/07-tech-stack.md) both say a binding points at a
 * connection and neither says where it is written; [02 §5.1](../../../../docs/design/02-data-model.md)'s
 * tree has no file for it. So: a file in the user's own directory, beside
 * `connections/`, following the same rule everything else does — the path is the
 * owner ([04 §4.3]).
 *
 * **P2.5 shipped the reader and no writer**, and named the writer's home as P7.
 * That was wrong about the phase rather than about the reasoning: the surface
 * that sets a binding is
 * [P2B](../../../../docs/design/workplan/14-p2b-provider-configuration.md)'s, which is the phase
 * that makes a fresh install usable at all.
 *
 * **It landed for one of the two files.** `system/bindings.json` has a writer —
 * `PUT /api/admin/bindings` and `POST /api/admin/bindings/defaults`, behind
 * the admin prefix. `users/<handle>/bindings.json` deliberately still has none:
 * [P2B §2.7] draws the line at *the system scope and only the system scope*,
 * and the personal half waits with the rest of
 * [05 §15.1](../../../../docs/design/05-ui-surfaces.md)'s user surface. So a personal binding
 * is still hand-written, which is [05 §4](../../../../docs/design/05-ui-surfaces.md) working
 * exactly as designed rather than a gap — and it is a *smaller* gap than it
 * was, because the layer underneath it now answers.
 *
 * **Two layers, not one.** `system/bindings.json` holds the install defaults
 * everyone inherits and a user's own file overrides it per role — [07 §5.1]'s
 * order, read from the weak end. They are deliberately the *same shape read by
 * the same reader*: merging them before resolution would give the same answer
 * for every role that resolves and lose the one thing the surface needs, which
 * is **which layer won** ([P2B §2.1]).
 *
 * Absent or malformed reads as `{}` — every role unbound at that layer. A turn
 * whose role is unbound at both fails with `unbound`, naming the role, which is
 * the answer that tells somebody what to do; a startup error over a missing
 * optional file would not.
 */

export function bindingsFile(layout: Layout, handle: string): string {
  return resolveWithin(layout.userRoot(handle), 'bindings.json');
}

/** The install defaults, layered under every user's own ([P2B §2.1]). */
export async function readSystemBindings(layout: Layout): Promise<RoleBindings> {
  return readBindingsAt(layout.systemBindingsFile);
}

export async function readBindings(layout: Layout, handle: string): Promise<RoleBindings> {
  return readBindingsAt(bindingsFile(layout, handle));
}

async function readBindingsAt(path: string): Promise<RoleBindings> {
  const bytes = await readFileBytes(path);
  if (bytes === null) return {};

  try {
    const value: unknown = JSON.parse(new TextDecoder().decode(bytes));
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return {};
    // Not validated field by field: `resolveRole` already answers `dangling`
    // for a binding whose connection is gone, and that is the same answer a
    // nonsense one deserves. A schema here would turn a typo into a startup
    // failure instead of a legible per-role refusal.
    return value;
  } catch {
    return {};
  }
}
