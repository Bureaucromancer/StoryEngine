// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { writeJsonAtomic } from '../storage/atomic.js';
import { readFileBytes } from '../storage/files.js';
import type { Layout } from '../storage/layout.js';
import { resolveWithin } from '../storage/paths.js';

/**
 * ***Which role a call outside any session asks for, when its owner has
 * said*** — `users/<handle>/task-roles.json`, added 2026-09-27.
 *
 * **A stopgap for [25 C15](../../../../docs/design/25-open-questions.md), named
 * as one.** [10 §11.4](../../../../docs/design/10-ui-surfaces.md) says field
 * assist *"wants the `fast` role"*; the code asks for `prose`, because
 * `resolveRole` has no cross-role fallback and an install that never bound
 * `fast` would get an assist button that fails every time. C15 is where that is
 * decided for every role at once. Until it is, the person who knows whether
 * their `fast` model is bound — and whether it is any good at writing a
 * character's appearance — chooses, and the default stays the one that works on
 * every install.
 *
 * ***A choice of role, not of model.*** A model is already chosen per role in
 * the table above this control, and a second place to bind one would be a
 * second resolution order to explain. So this picks *which of your roles* the
 * assist uses, and the answer to *which model is that* stays in one place. When
 * C15 settles, this file is what gets retired, and the role vocabulary it
 * pointed into is unchanged.
 *
 * ***Its own file, not a key in `bindings.json` or `prefs.json`.*** The bindings
 * document is exactly its role keys, replaced whole under a hash, and a second
 * kind of entry would be dropped by its reader and fight its writer. The
 * preferences bag is one the server deliberately never interprets ([25 B13]), and
 * this is a thing the server acts on.
 *
 * **Absent, unreadable or nonsense reads as the default**, the posture every
 * hand-editable file here takes: a typo costs the setting, not the feature.
 */

/** The roles a field assist may ask for — the text-writing ones, and no others. */
export const ASSIST_ROLES = ['prose', 'fast', 'reasoning'] as const;
export type AssistRole = (typeof ASSIST_ROLES)[number];

export interface TaskRoles {
  /** What field assist ([10 §11.1]) asks for. `prose` unless somebody said. */
  assist: AssistRole;
}

export const DEFAULT_TASK_ROLES: TaskRoles = { assist: 'prose' };

export function taskRolesFile(layout: Layout, handle: string): string {
  return resolveWithin(layout.userRoot(handle), 'task-roles.json');
}

function isAssistRole(value: unknown): value is AssistRole {
  return typeof value === 'string' && (ASSIST_ROLES as readonly string[]).includes(value);
}

export async function readTaskRoles(layout: Layout, handle: string): Promise<TaskRoles> {
  const bytes = await readFileBytes(taskRolesFile(layout, handle));
  if (bytes === null) return DEFAULT_TASK_ROLES;
  try {
    const value: unknown = JSON.parse(new TextDecoder().decode(bytes));
    if (typeof value !== 'object' || value === null) return DEFAULT_TASK_ROLES;
    const assist = (value as Record<string, unknown>)['assist'];
    return { assist: isAssistRole(assist) ? assist : DEFAULT_TASK_ROLES.assist };
  } catch {
    return DEFAULT_TASK_ROLES;
  }
}

export async function writeTaskRoles(
  layout: Layout,
  handle: string,
  roles: TaskRoles,
): Promise<void> {
  await writeJsonAtomic(taskRolesFile(layout, handle), roles);
}
