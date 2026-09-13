// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { ACTOR_SCHEMA, type PlotHook, type Setup } from '@storyengine/shared';

import { read } from '../library.js';
import type { LibraryContext } from '../library.js';

import type { ResolvedLore } from '../turns/lore.js';
import type { PooledHook } from './types.js';

/**
 * The session's hook pool, and where each hook came from —
 * [03 §4.1](../../../../docs/design/03-data-model.md),
 * [06 §6.1](../../../../docs/design/06-modes-and-turn-pipeline.md), built at
 * [P7.5](../../../../docs/design/workplan/23-p7-implementation.md).
 *
 * **Four sources, which is more sourcing than any other object has** — a
 * treatment, a setup, the active lorebooks, and the session itself. 03 §4.1
 * names that as a cost and names its mitigation in the same breath: *"every hook
 * shows its source, and editing navigates to whichever object owns it"*. So the
 * pool is a list of hooks **with attribution**, not a list of hooks.
 *
 * **Copied at creation, not resolved per turn**, which is [06 §6.1]'s *pulled,
 * never pushed* over [00 §3.1]: editing a treatment must not reach a game
 * already in progress. The same asymmetry the preset has, and the opposite of
 * the cast's — and the reason the pool is on the session file at all.
 *
 * *Its own module because it reads the lore resolver, and `hooks.ts` beside it
 * is imported by `mode-loader.ts` to register a channel — a type-only import was
 * enough to drag the storage layer into the tools project's graph.*
 */
/**
 * The pool a new session starts with.
 *
 * ***A copied hook keeps the source hook's `id`*** — [15 §5], and the obligation
 * [P7.5] calls *free at this stage and unrecoverable after it*. Within a
 * continuity, a hook that fired in session one must not fire again in session
 * two, and cross-session de-duplication is only possible if the copy preserved
 * the id. **A corpus of sessions whose hooks have unrelated ids cannot be
 * retro-fitted into a continuity, because the linking information was never
 * written.** Nothing is being added to make this true — `PlotHook.id` exists and
 * `blockedBy` and `notBefore.afterHook` already reference ids — what is being
 * done is *not minting a fresh one*, which is why it is pinned by a test rather
 * than left as a property of a `structuredClone`.
 *
 * **Order is treatment, setup, lorebooks, session**, which is 03 §4.1's own
 * order and puts the primary home first. Nothing downstream depends on it —
 * selection is weighted — but a list a person reads should not be in whatever
 * order a resolver happened to produce.
 *
 * *Deliberately no de-duplication by id.* The same hook reaching a session
 * through two sources is a real authoring situation — a treatment and one of its
 * own lorebooks — and collapsing them here would drop the attribution 03 §4.1
 * requires while making the *pool* disagree with what the author sees in two
 * places. The filter is where a fired hook stops being eligible, and it keys on
 * the id, so a duplicate fires once regardless.
 */
export function poolFor(options: {
  lore: ResolvedLore;
  setup?: Setup | undefined;
  own?: readonly PlotHook[] | undefined;
}): PooledHook[] {
  const pool: PooledHook[] = [];

  const treatment = options.lore.treatment;
  if (treatment !== null) {
    for (const hook of treatment.treatment.hooks) {
      pool.push({ hook: structuredClone(hook), source: { kind: 'treatment', id: treatment.id } });
    }
  }

  const setup = options.setup;
  if (setup !== undefined) {
    for (const hook of setup.hooks) {
      pool.push({ hook: structuredClone(hook), source: { kind: 'setup', id: setup.id } });
    }
  }

  for (const book of options.lore.books) {
    for (const hook of book.book.hooks ?? []) {
      pool.push({ hook: structuredClone(hook), source: { kind: 'lore', id: book.id } });
    }
  }

  for (const hook of options.own ?? []) {
    pool.push({ hook: structuredClone(hook), source: { kind: 'session' } });
  }

  return pool;
}

/**
 * Which of a pool's actors resolve — the set `FilterContext.known` wants.
 *
 * **Here rather than in `gather.ts`, because a second caller arrived** — the
 * hook panel ([10 §10.1]) reads the same pool at the same node and has to get
 * the same answer. *A panel that disagreed with the selector about whether a
 * hook's subject exists would be the exact failure the surface is built to
 * prevent.* This module is where a hook question that needs the library already
 * lives.
 *
 * **Ids, never cards.** The filter asks one question of each — *is there an
 * object behind this `Ref`* — and reading the actor whole would put an unfired
 * introduction's subject into memory on every turn for a hook that will fire on
 * none of them. [04 §6.1a] makes the dangling case a *visible* refusal rather
 * than a quiet retirement, which is the only thing this has to be able to say.
 *
 * *Reads each id once* even when six hooks name the same person, because a pool
 * with thirty hooks is the case [06 §6.1] sizes the mechanical filter for.
 */
export function resolvableActors(
  library: LibraryContext,
  handle: string,
  pool: readonly PooledHook[],
): ReadonlySet<string> {
  const asked = new Set<string>();
  for (const { hook } of pool) {
    for (const who of hook.involves) asked.add(who.id);
    if (hook.introduces !== undefined) asked.add(hook.introduces.actor.id);
  }

  const known = new Set<string>();
  for (const id of asked) {
    try {
      read(library, handle, id, ACTOR_SCHEMA);
      known.add(id);
    } catch {
      // **The throw is the answer**, which is what `read` gives back for an id
      // that is not there, is not an actor, or is a file that no longer parses
      // as one. All three are *gone* as far as a hook is concerned, and saying
      // so beats failing the turn — the same never-throws posture `resolveCast`
      // takes one function over.
    }
  }
  return known;
}
