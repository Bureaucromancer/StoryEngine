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
 * **P2.5 ships the reader and no writer.** The surface that sets a binding is
 * part of the provider settings UI, which is P7's; until then a binding is
 * hand-written, which is [05 §4](../../../../docs/design/05-ui-surfaces.md) working exactly as
 * designed rather than a gap. Shipping a writer now would be inventing a route
 * shape that phase has to live with.
 *
 * Absent or malformed reads as `{}` — every role unbound. A turn then fails
 * with `unbound`, naming the role, which is the answer that tells somebody what
 * to do; a startup error over a missing optional file would not.
 */

export function bindingsFile(layout: Layout, handle: string): string {
  return resolveWithin(layout.userRoot(handle), 'bindings.json');
}

export async function readBindings(layout: Layout, handle: string): Promise<RoleBindings> {
  const bytes = await readFileBytes(bindingsFile(layout, handle));
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
