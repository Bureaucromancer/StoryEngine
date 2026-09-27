// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import type { Goal } from '@storyengine/shared';

import { readableGoals } from './goals.js';
import type { SessionFile } from './types.js';

/**
 * ***A session as a reply carries it, which is not the file*** (2026-09-27).
 *
 * Every route that answers with a session sent `session.json` whole, and three
 * parts of it are exactly what the play surface exists not to show:
 *
 * - **the hook pool**, every unfired hook's premise included. [10 §10.1]: *the
 *   server is the only party that ever holds the hook*; the panel's rows are
 *   built by a redaction (`hookRows`) that shows a premise only once it has
 *   fired, and that redaction did nothing while the same reply carried the pool
 *   beside it. *The Flower Kingdom will declare war* was in the page's network
 *   log from the first read.
 * - **the Setup copy**, whose goals and hooks carry the same spoilers, where
 *   the only part a client reads is which Setup it was.
 * - **each goal's `detail`**, which [04 §7.1] calls *the author's fuller
 *   version, available to steps, not injected by default*, and which `docs/api.md`
 *   said *does not travel*.
 *
 * So a reply carries the pool not at all (the panel has its rows), the Setup as
 * its id and name, and the goals without `detail`, each read past as the turn
 * reads them. **The export is untouched**: it is the file, on purpose, for
 * somebody moving their own session.
 */
export type PresentedSession = Omit<SessionFile, 'hooks' | 'setup' | 'goals'> & {
  setup?: { id: string; name: string };
  goals?: PresentedGoal[];
};

export type PresentedGoal = Omit<Goal, 'detail'>;

export function presentSession(file: SessionFile): PresentedSession;
/** A few routes answer `{ session: null }` for a session that is gone, and still do. */
export function presentSession(file: SessionFile | null): PresentedSession | null;
export function presentSession(file: SessionFile | null): PresentedSession | null {
  if (file === null) return null;
  const shown: Partial<SessionFile> & Omit<SessionFile, 'hooks' | 'setup' | 'goals'> = {
    ...file,
  };
  delete shown.hooks;
  delete shown.setup;
  delete shown.goals;
  return {
    ...shown,
    ...(file.setup === undefined ? {} : { setup: { id: file.setup.id, name: file.setup.name } }),
    ...(file.goals === undefined ? {} : { goals: readableGoals(file.goals).map(withoutDetail) }),
  };
}

function withoutDetail(goal: Goal): PresentedGoal {
  return {
    id: goal.id,
    statement: goal.statement,
    visibility: goal.visibility,
    completion: goal.completion,
    thenDefault: goal.thenDefault,
    next: goal.next,
  };
}
