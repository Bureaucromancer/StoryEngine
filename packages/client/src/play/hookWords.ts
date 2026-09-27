// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import type { HookRefusal, HookRow } from '../api.js';

/**
 * A refusal class turned into a sentence — [06 §6.1](../../../../docs/design/06-modes-and-turn-pipeline.md),
 * [10 §10.1](../../../../docs/design/10-ui-surfaces.md), built at
 * [P7.5](../../../../docs/design/workplan/23-p7-implementation.md).
 *
 * **The class is what crosses the wire and the sentence is the panel's** — the
 * rule this codebase holds every durable reason to, and the reason the engine
 * never grew a free-English field for *why*. 10 §10.1 asks the panel to say
 * *"waiting on turn 40, Vera is not in this session, superseded by a lorebook
 * hook naming the same character"*, which is this list.
 *
 * **A class this build does not know gets a sentence rather than a throw.** The
 * vocabulary is open in the direction of a *newer server*, which is the ordinary
 * shape of a client one deploy behind — and an unrecognised reason is still
 * information: *the engine is holding it back and this build cannot say why* is
 * honest, while an empty row would read as *eligible*.
 *
 * *In its own module because it is the panel's one piece of derivation*, and
 * `castBadge` beside it settled that argument already: a derivation in a
 * component is a derivation nothing tests.
 */
export function hookWords(refusal: HookRefusal | (string & {})): string {
  switch (refusal) {
    case 'fired':
      return 'Already fired';
    case 'pending':
      return 'Fired, waiting to be confirmed';
    case 'book-inactive':
      return 'Its lorebook is not in this session';
    case 'blocked':
      return 'Ruled out by a hook that has fired';
    case 'too-early':
      return 'Waiting for a later turn';
    case 'cast-gone':
      return 'Someone it is about is not here';
    /**
     * **The one arm that is an authoring error rather than a state**, which
     * [04 §6.1a] is explicit about: a dangling `introduces.actor` is *"a broken
     * hook, not a retired one… ineligible with a visible reason, and the author
     * is told"*. So the sentence says *broken* where every other one says
     * *waiting* — the remedy is to fix the hook, not to play on.
     */
    case 'subject-gone':
      return 'Broken: the character it introduces does not exist';
    case 'subject-met':
      return 'They are already in the story';
    case 'subject-unavailable':
      return 'They cannot arrive: gone, or here already';
    /**
     * ***The second authoring error*** (2026-09-27): the pool holds something
     * the hook schema refuses, written by hand or brought in by an import, and
     * the engine will not read it at all. *Broken*, for `subject-gone`'s reason:
     * the remedy is to fix or remove the hook, not to play on.
     */
    case 'malformed':
      return 'Broken: this is missing something every hook needs';
    default:
      return 'Held back for a reason this version does not recognise';
  }
}

/**
 * What a row's state is called, or `null` for a hook that is simply waiting.
 *
 * *Null rather than "Waiting"*, because a badge on every row is a badge that
 * says nothing: the pool is mostly hooks that have not fired, and the rows worth
 * marking are the three that have a story attached.
 */
export function hookState(row: Pick<HookRow, 'state'>): string | null {
  switch (row.state) {
    case 'fired':
      return 'Fired';
    case 'provisional':
      return 'Firing';
    case 'committed':
      return 'Committed';
    case 'forced':
      return 'Firing next turn';
    default:
      return null;
  }
}
