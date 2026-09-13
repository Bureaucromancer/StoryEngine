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
 * ~~**Ids, never cards.**~~ ***Ids and the names they answer to, since [P7.7]***
 * — the filter asks one question of each (*is there an object behind this
 * `Ref`*), and [04 §6.1a] makes the dangling case a *visible* refusal rather
 * than a quiet retirement, which is all the filter needs. But [06 §6.1] requires
 * the other half: a firing *"adds their aliases to the shared keyword scan"*,
 * and a subject who is not in the cast has no other way into it.
 *
 * *Still not the card*, which is what that sentence was protecting: what travels
 * is a string array per hook, off the same `read` the existence check already
 * makes.
 *
 * *Reads each id once* even when six hooks name the same person, because a pool
 * with thirty hooks is the case [06 §6.1] sizes the mechanical filter for.
 */
export function resolvableActors(
  library: LibraryContext,
  handle: string,
  pool: readonly PooledHook[],
): { known: ReadonlySet<string>; terms: ReadonlyMap<string, string[]> } {
  const asked = new Set<string>();
  for (const { hook } of pool) {
    for (const who of hook.involves) asked.add(who.id);
    if (hook.introduces !== undefined) asked.add(hook.introduces.actor.id);
  }

  const known = new Set<string>();
  const terms = new Map<string, string[]>();
  for (const id of asked) {
    try {
      const row = read(library, handle, id, ACTOR_SCHEMA);
      known.add(id);
      /**
       * ***And the surface forms, which [06 §6.1] requires by name.*** A firing
       * *"contributes the subject's card for that turn and **adds their aliases
       * to the shared keyword scan**"* — and a subject who is not in the cast has
       * no other way in, which is the one turn the scan matters on.
       *
       * *This is why the read is a read and not an existence check*, and it is
       * where the paragraph above narrows: the **filter** needs only an id, and
       * the **scan** needs the names. Both come off one `read`, so carrying the
       * second costs a string array per hook rather than a second pass.
       */
      const body: unknown = row.body;
      const aliases =
        typeof body === 'object' &&
        body !== null &&
        'aliases' in body &&
        Array.isArray(body.aliases)
          ? body.aliases.filter((one): one is string => typeof one === 'string')
          : [];
      // `row.name` is the index's own copy of the object's name, which is what
      // the rest of the app resolves a `Ref` through — so the scan and the panel
      // agree about what somebody is called without a second read.
      terms.set(id, [row.name, ...aliases]);
    } catch {
      // **The throw is the answer**, which is what `read` gives back for an id
      // that is not there, is not an actor, or is a file that no longer parses
      // as one. All three are *gone* as far as a hook is concerned, and saying
      // so beats failing the turn — the same never-throws posture `resolveCast`
      // takes one function over.
    }
  }
  return { known, terms };
}
