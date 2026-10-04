// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import type { RoleRow } from '../api.js';
import { labels } from '../i18n/catalogue.js';

/**
 * The sentences a role table says, spelled once for the two tables that say
 * them — [10 §15.1](../../../../docs/design/10-ui-surfaces.md), [P7.3].
 *
 * **Lifted out of `AdminConnections.tsx` when the user half arrived.** That
 * component's `RoleTable` already carried the whole vocabulary, including the
 * *"Your own setting, on …"* branch it could never reach — it resolves the
 * install's layers and passes no personal ones, so `via` is never `binding`
 * there. The branch was written for this phase and has been waiting for a
 * caller; two copies of it would have been two chances for the two tables to
 * describe the same resolution differently.
 *
 * [work plan §2](../../../../docs/design/workplan/01-work-plan.md) keeps the i18n
 * discipline that matters on day one: each of these returns a **whole** phrase,
 * never a fragment to be assembled around a value, because word order differs
 * between languages and a sentence built from pieces cannot be translated at
 * all.
 */

/**
 * The eight roles, in words somebody who did not write this can read.
 *
 * The vocabulary is [20 §5.1]'s and it stays the vocabulary — this only decides
 * what a *table* says, and every id it does not know falls through to itself
 * rather than to a blank cell.
 */
const ROLE_LABELS: Record<string, string> = labels('settings.role', {
  prose: 'Writing the story',
  reasoning: 'Working things out',
  fast: 'Quick background jobs',
  vision: 'Reading images',
  embedding: 'Searching your library',
  image: 'Making images',
  video: 'Making video',
  speech: 'Speech',
});

export function roleLabel(role: string): string {
  return ROLE_LABELS[role] ?? role;
}

export function roleModel(row: RoleRow): string {
  if (row.ok && row.modelId !== undefined) return row.modelId;
  return row.tier === 'unset' ? 'Nothing yet' : 'Nothing — this will fail';
}

export function roleSource(row: RoleRow): string {
  if (row.ok) {
    const label = row.connectionLabel ?? row.connectionId ?? '';
    /**
     * **Five layers resolve and three of them can reach a person's screen.**
     * `binding` is their own file, `default` the install's. `session` and `step`
     * are [P7.3]'s overrides — reachable from the session surface rather than
     * from here, and named so that a table rendered against a session's
     * resolution does not report an override as the install's doing. `hint` is
     * an actor card preferring a model the resolved connection already offers;
     * it never changes the connection, which is why it reads as a preference
     * rather than as a setting.
     */
    switch (row.via) {
      case 'binding':
        return `Your own setting, on ${label}`;
      case 'session':
        return `This session's override, on ${label}`;
      case 'step':
        return `An override for one step, on ${label}`;
      case 'hint':
        return `A character's preferred model, on ${label}`;
      default:
        return `This install's default, on ${label}`;
    }
  }
  if (row.reason === 'dangling') {
    return 'The connection this was set to has been removed. Set it to another one.';
  }
  return row.tier === 'unset'
    ? 'Nothing can do this yet, and nothing needs to.'
    : 'Nothing is set for this, so anything that needs it will fail.';
}
