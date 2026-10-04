// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { contentHashOf } from '../index-db/ingest.js';
import { writeJsonAtomic } from '../storage/atomic.js';
import { readFileBytes } from '../storage/files.js';
import type { Layout } from '../storage/layout.js';
import { resolveWithin } from '../storage/paths.js';
import type { RoleBindings } from './roles.js';
import { MODEL_ROLES } from './types.js';

/**
 * Where a user's role bindings live — `users/<handle>/bindings.json`.
 *
 * **A decision made under silence, and worth flagging as one.**
 * [09 §4.5](../../../../docs/design/09-server-multiuser-deployment.md) and
 * [20 §5.1](../../../../docs/design/20-tech-stack.md) both say a binding points at a
 * connection and neither says where it is written; [03 §5.1](../../../../docs/design/03-data-model.md)'s
 * tree has no file for it. So: a file in the user's own directory, beside
 * `connections/`, following the same rule everything else does — the path is the
 * owner ([09 §4.3]).
 *
 * **P2.5 shipped the reader and no writer**, and named the writer's home as P7.
 * That was wrong about the phase rather than about the reasoning: the surface
 * that sets a binding is
 * [P2B](../../../../docs/design/workplan/10-p2b-provider-configuration.md)'s, which is the phase
 * that makes a fresh install usable at all.
 *
 * **It landed for one of the two files.** `system/bindings.json` has a writer —
 * `PUT /api/admin/bindings` and `POST /api/admin/bindings/defaults`, behind
 * the admin prefix. ~~`users/<handle>/bindings.json` deliberately still has
 * none~~ **and the personal one landed at [P7.3]**, 2026-09-12: `PUT
 * /api/me/bindings`, which is [10 §15.1]'s *role bindings* bullet and the real
 * blocker [R2 / F-01](../../../../docs/design/workplan/21-playable-log.md) was
 * waiting on. *The old text is kept because its reasoning was right and is what
 * dates the change: [P2B §2.7] drew the line at "the system scope and only the
 * system scope", and the personal half waited with the rest of
 * [10 §15.1](../../../../docs/design/10-ui-surfaces.md)'s user surface — which
 * [10 §15.5] gates on the `privateConnections` check existing, because a
 * personal surface that predates it is "the trivial bypass [09 §4.5] warns
 * about, wearing a UI". That check has been real since P3.*
 *
 * **Hand-writing this file stays supported and is not a fallback.**
 * [10 §4](../../../../docs/design/10-ui-surfaces.md) promises editing your own
 * data on disk works; the route reads fresh on every request and writes the
 * whole document under a hash guard, so a hand edit between a read and a write
 * answers 412 rather than being silently overwritten.
 *
 * **Two layers, not one.** `system/bindings.json` holds the install defaults
 * everyone inherits and a user's own file overrides it per role — [20 §5.1]'s
 * order, read from the weak end. They are deliberately the *same shape read by
 * the same reader*: merging them before resolution would give the same answer
 * for every role that resolves and lose the one thing the surface needs, which
 * is **which layer won** ([P2B §2.1]).
 *
 * **Absent, unparseable, or nonsense reads as nothing bound at that layer** — and
 * the third of those was a lie until a P2B review probed it. A turn whose role
 * is unbound at both layers fails with `unbound`, naming the role, which is the
 * answer that tells somebody what to do; a startup error over a missing optional
 * file would not.
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

/**
 * **Every entry is checked for shape, and this file used to say it was not.**
 *
 * The old comment argued that field-by-field validation was unnecessary because
 * *"`resolveRole` already answers `dangling` for a binding whose connection is
 * gone, and that is the same answer a nonsense one deserves."* The premise was
 * false: `resolveRole` skipped only `undefined`, so a well-formed JSON file
 * saying `{"prose": null}` reached `usable.find(c => c.id === binding.connectionId)`
 * and threw. One person's hand-written file answered **500** on an admin page
 * listing everybody — and hand-writing this file is the designed path
 * ([10 §4](../../../../docs/design/10-ui-surfaces.md)) until the surface that writes the
 * per-user one exists at all.
 *
 * Found by a P2B review probing what happens to values the parse accepts but
 * the resolver does not. Nothing went red, because nothing wrote one.
 *
 * A malformed *entry* is dropped and its neighbours survive, which is the same
 * posture `readConnectionsIn` takes towards one bad connection file and for the
 * same reason: the failure a person will actually have is a typo in one place,
 * and taking down every other role because of it is the wrong answer.
 */
export function pickBindings(value: Record<string, unknown>): RoleBindings {
  const picked: RoleBindings = {};
  for (const role of MODEL_ROLES) {
    const entry = value[role];
    if (typeof entry !== 'object' || entry === null) continue;
    const record = entry as Record<string, unknown>;
    if (typeof record['connectionId'] !== 'string' || typeof record['modelId'] !== 'string') {
      continue;
    }
    picked[role] = { connectionId: record['connectionId'], modelId: record['modelId'] };
  }
  return picked;
}

async function readBindingsAt(path: string): Promise<RoleBindings> {
  const bytes = await readFileBytes(path);
  if (bytes === null) return {};

  try {
    const value: unknown = JSON.parse(new TextDecoder().decode(bytes));
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return {};
    return pickBindings(value as Record<string, unknown>);
  } catch {
    return {};
  }
}

/**
 * A bindings document plus a hash of the bytes it came from — [P2B §6].
 *
 * **The hash is over the file, not over the picked document**, which is what
 * makes it a guard rather than a formality: a hand edit that adds a role this
 * build does not know changes the file and not the pick, and a client holding
 * the old hash should still be told the file moved under it.
 *
 * *Lifted here from `routes/connections.ts` at [P7.3] so the two bindings files
 * are hashed by one rule.* The empty-file convention is the subtle half and was
 * the reason to lift it: an absent file hashes as the empty document rather
 * than as nothing, so **there is no file** and **there is an empty file**
 * present the same guard — which is what a first write needs, since the client
 * has neither. `writeJsonAtomic` emits exactly these bytes for `{}`.
 */
export async function bindingsStateAt(
  path: string,
): Promise<{ bindings: RoleBindings; contentHash: string }> {
  const bytes = await readFileBytes(path);
  return {
    bindings: await readBindingsAt(path),
    contentHash: contentHashOf(bytes ?? new TextEncoder().encode('{}\n')),
  };
}

export async function systemBindingsState(
  layout: Layout,
): Promise<{ bindings: RoleBindings; contentHash: string }> {
  return bindingsStateAt(layout.systemBindingsFile);
}

export async function userBindingsState(
  layout: Layout,
  handle: string,
): Promise<{ bindings: RoleBindings; contentHash: string }> {
  return bindingsStateAt(bindingsFile(layout, handle));
}

/**
 * One account's own bindings, replaced wholesale.
 *
 * **A whole document rather than a patch per role**, the same shape the system
 * writer takes and for the same reason: eight roles is not a chatty write path,
 * and a bindings document *is* exactly its eight possible keys, so there is
 * nothing on disk a merge would be preserving.
 *
 * The caller picks before calling. This does not pick for them, because the
 * route has to answer with what it wrote and a silent narrowing inside the
 * writer would make that answer a second guess.
 */
export async function writeBindings(
  layout: Layout,
  handle: string,
  bindings: RoleBindings,
): Promise<void> {
  await writeJsonAtomic(bindingsFile(layout, handle), bindings);
}
