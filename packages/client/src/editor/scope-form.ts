// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { worldIdsOf } from '@storyengine/shared';

/**
 * ***A book's scope, as the lorebook editor writes it*** —
 * [P16.2](../../../../docs/design/workplan/35-p16-world.md),
 * [P16 §1.3](../../../../docs/design/workplan/35-p16-world.md),
 * [15 §5.3](../../../../docs/design/15-world.md),
 * [26 B16](../../../../docs/design/26-open-questions.md).
 *
 * **Why the field gets a control now and never had one.** Until P16.2 `scope`
 * was stored, exported, preserved — and read by nothing, so a control for it
 * would have been a switch wired to nothing. The `world` arm is the first thing
 * since [P5.7]'s reversal that reads it, once, at the start of a session in a
 * World; and P16 §1.3 says the rest: *a field that is read and can only be
 * changed in As stored is a field nobody sets* — which would also make
 * [15 §8]'s test, *watch whether the arm gets set*, a measurement of the missing
 * control rather than of the idea.
 *
 * **Pure, and apart from the page**, `members-form.ts`'s reason: the cases
 * where a control quietly rewrites somebody's file — a scope from a newer build,
 * an older book's `global`, a list of ids that no longer resolve — are each a
 * rule worth a test that needs no DOM.
 *
 * ***The choices are the person's words for the arms, and there are more choices
 * than arms.*** `linked` holds two quite different statements — *about these
 * characters* and, since 26 B15's default moved to `{ kind: 'linked',
 * actorIds: [] }`, *about nobody in particular* — and the Lorebooks panel
 * already tells them apart (`scopeShelfOf`), so the control does too. `global`
 * and a kind this build does not know are choices **only for a book that
 * already says them**: neither is anything a person should be invited to pick,
 * and both have to stay pickable while they are what the book says, or the
 * select would be showing a value it cannot hold.
 */

/** What the scope select can say — one per option, never one per arm. */
export type ScopeChoice = 'nobody' | 'actors' | 'worlds' | 'global' | 'unknown';

/** The `kind` a scope declares, or null for one that declares none readably. */
export function scopeKindOf(scope: unknown): string | null {
  if (typeof scope !== 'object' || scope === null) return null;
  const kind: unknown = (scope as { kind?: unknown }).kind;
  return typeof kind === 'string' ? kind : null;
}

/**
 * The actors a `linked` scope names, or none — `worldIdsOf`'s shape for the
 * other list arm, read defensively for its reason: the draft is the file, and a
 * hand-edited file can say `linked` with anything beside it.
 */
export function actorIdsOf(scope: unknown): string[] {
  if (scopeKindOf(scope) !== 'linked') return [];
  const actorIds: unknown = (scope as { actorIds?: unknown }).actorIds;
  return Array.isArray(actorIds)
    ? actorIds.filter((id): id is string => typeof id === 'string')
    : [];
}

/**
 * Which option a scope reads as.
 *
 * **A scope with no readable kind reads as *not tied to anything***, which is
 * what it does — nothing reads it, as nothing reads `linked` with nobody in it —
 * and it is left as it is on disk until somebody picks an option. Shown as
 * *unknown* instead, the select would offer to keep a value whose only content
 * is that it is broken. *A `linked` whose `actorIds` is not a list* reads the
 * same way, for `scopeShelfOf`'s reason: it names nobody this build can read.
 */
export function scopeChoiceOf(scope: unknown): ScopeChoice {
  const kind = scopeKindOf(scope);
  if (kind === null) return 'nobody';
  if (kind === 'global') return 'global';
  if (kind === 'linked') return actorIdsOf(scope).length > 0 ? 'actors' : 'nobody';
  if (kind === 'world') return 'worlds';
  return 'unknown';
}

/**
 * ***The scope a choice writes.***
 *
 * **What the saved book said, when it said this choice** — so switching to
 * *For particular worlds* by mistake and straight back to *For particular
 * characters* puts back the characters the file names rather than an empty
 * list, and *Global* or a kind from a newer build comes back **byte for byte**,
 * whatever else that object carries. The unknown choice is never anything else:
 * it is offered only for a book that holds one, and it means *keep that*.
 *
 * Otherwise the arm, empty. *Not tied to anything* is always the factory's
 * `{ kind: 'linked', actorIds: [] }` — never the saved value — because a book
 * that reads as nobody may be reading that way because its scope is unreadable,
 * and picking the option is how somebody repairs that.
 */
export function scopeFor(choice: ScopeChoice, saved: unknown): Record<string, unknown> {
  const restorable = choice !== 'nobody' && scopeChoiceOf(saved) === choice;
  if (restorable) return structuredClone(saved) as Record<string, unknown>;
  switch (choice) {
    case 'nobody':
    case 'actors':
      return { kind: 'linked', actorIds: [] };
    case 'worlds':
      return { kind: 'world', worldIds: [] };
    case 'global':
      return { kind: 'global' };
    case 'unknown':
      // Unreachable through the control, which offers this only for a book
      // holding such a scope; the narrowest honest value if it ever is.
      return { kind: 'linked', actorIds: [] };
  }
}

/**
 * The scope with its list replaced — the characters for `actors`, the Worlds
 * for `worlds`.
 *
 * **Spread over the scope rather than rebuilt from it** when the arm is already
 * the one being written, for [04 §2]'s reason every writer here gives: a field
 * a newer build put beside `worldIds` survives a pick.
 */
export function withScopeIds(
  scope: unknown,
  choice: 'actors' | 'worlds',
  ids: readonly string[],
): Record<string, unknown> {
  const kind = choice === 'actors' ? 'linked' : 'world';
  const key = choice === 'actors' ? 'actorIds' : 'worldIds';
  const base = scopeKindOf(scope) === kind ? (scope as Record<string, unknown>) : { kind };
  return { ...base, [key]: [...ids] };
}

/** The ids a scope's list holds, for whichever list choice the control is on. */
export function scopeIdsOf(scope: unknown, choice: 'actors' | 'worlds'): string[] {
  return choice === 'actors' ? actorIdsOf(scope) : worldIdsOf(scope);
}

/**
 * ***Which ids a pick may write: one already held, or one offered.***
 *
 * The picker is a combobox, and a combobox's text box can be typed into; a
 * scope that took whatever was typed would name an actor called *Mira* by the id
 * `Mira`, which resolves to nothing anywhere. So the list only ever grows by an
 * id somebody chose from what was offered. **A held id is never refused**,
 * resolvable or not — dropping one that no longer resolves is exactly the
 * silent repair [15 §3.1]'s *dangles visibly* rules out.
 */
export function pickableIds(
  next: readonly string[],
  held: readonly string[],
  offered: ReadonlySet<string>,
): string[] {
  const was = new Set(held);
  return next.filter((id, at) => (was.has(id) || offered.has(id)) && next.indexOf(id) === at);
}

/**
 * The options the select offers for this book — the three a person picks
 * among, plus *Global* and *unknown* only while the saved book or the draft
 * says one.
 */
export function scopeChoicesFor(saved: unknown, draft: unknown): ScopeChoice[] {
  const said = new Set([scopeChoiceOf(saved), scopeChoiceOf(draft)]);
  return [
    'nobody',
    'actors',
    'worlds',
    ...(said.has('global') ? (['global'] as const) : []),
    ...(said.has('unknown') ? (['unknown'] as const) : []),
  ];
}
