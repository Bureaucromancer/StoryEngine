// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import type { Turn } from './types.js';

/**
 * ***How far into the story a path is, counted in the story's turns***
 * (2026-09-27).
 *
 * A session's path holds turns nothing narrated: a channel write (a HUD edit,
 * the pacing dial, a hook commitment), an undo, a divergence, a *Remember
 * this*, a backdrop choice. Each appends a turn with no input, no output and no
 * steps, because each is a change to the record that must branch like one. And
 * every turn-count gate read the path's length, so they counted those too: a
 * hook authored `notBefore: { turn: 12 }` became eligible at the ninth story
 * turn of a session with a few HUD changes and backdrops, memory extraction
 * *every eight turns* fired at irregular story turns and skipped stretches as
 * bookkeeping shifted the modulus, and the speaker rotation skipped people.
 *
 * **A story turn is one a person or a job took**: it has an input, an output,
 * or the steps a job ran (a setup turn has only those). Derived from the path
 * rather than stored, so a rewind or a branch changes it as it should.
 *
 * *Its own module, importing nothing but types*, because `sessions/hooks.ts`
 * reads it and `mode-loader.ts` reads that, and a storage import here would
 * pull the storage layer into the tools project's graph.
 */
export function isStoryTurn(turn: Turn): boolean {
  return turn.input !== undefined || turn.output !== undefined || turn.steps !== undefined;
}

/**
 * The story turns of a path, in order — what the history window takes the
 * last of and what the summary chain covers the rest of (2026-09-27). One
 * predicate for both, because a window counted one way and a chain counted
 * another would leave a turn in neither or in both.
 */
export function storyTurns(path: readonly Turn[]): Turn[] {
  return path.filter(isStoryTurn);
}

/** The story turns on a path. */
export function storyDepth(path: readonly Turn[]): number {
  let depth = 0;
  for (const turn of path) if (isStoryTurn(turn)) depth += 1;
  return depth;
}
