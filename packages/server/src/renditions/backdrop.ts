// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { uuidv7 } from '@storyengine/shared';

import { acceptEffect } from '../turns/effects.js';
import {
  appendTurnToSession,
  readSession,
  readTurns,
  reconstructAlong,
  type SessionContext,
} from '../sessions/store.js';
import { walkPath } from '../sessions/segments.js';

/**
 * Which backdrop is showing — [06 §10.1a](../../../../docs/design/06-modes-and-turn-pipeline.md),
 * [P9 §1.7], [P9.3].
 *
 * ***The artefact is not an effect; the selection is.*** §10.1a's whole
 * separation: a rendition hangs off its turn and takes no part in state
 * reconstruction, and the **pointer** naming which one is showing is ordinary
 * channel state — reversible, recorded, and reconstructed like everything else.
 * Reading the two halves as one is how a backdrop ends up as a special case in
 * the branching code, which it is not.
 *
 * ***And the selection is an ordinary one***, which is the half [P9 §0.3] had to
 * add because `escapes` did not exist when §1.7 was written. `ChannelDefinition`
 * gained `escapes?: boolean` at [P8.2], and an effect whose channel declares it
 * is written with `scope: 'escaped'` — a scope `applyEffects`, `undoTurn` and
 * `reconstructAlong` all **skip**, because an escaped effect is one a session
 * cannot take back. A backdrop declared that way would be correct on the turn it
 * was written and would silently fail to return on rewind: gate step 11 failing
 * in the single manner an *empty diff* does not look for, because nothing was
 * written and that is the bug. `BACKDROP_CHANNEL` declares no `escapes` and must
 * not gain one.
 */

/**
 * Points the backdrop channel at a rendition.
 *
 * ***The engine writes it; a step may not propose it.*** `se.backdrop` is
 * `update: 'engine-computed'`, and [P7.9] wrote that clause for this function:
 * *"a person may pick a backdrop, a model may not, and P9's generator writes it
 * through the engine rather than out of its step."* A `{ kind: 'step' }`
 * proposal is turned into a **recorded refusal** by `acceptEffect`, so a step
 * that tried would produce a workbench row saying *engine-computed* and no
 * backdrop — and [P9 §1.7] warns what happens next: *"a stage that discovers
 * this policy by failing an effect proposal will be tempted to widen the
 * channel, and widening it is the one repair that undoes the argument."*
 *
 * **A turn with no model call and no tape**, which is `writeChannel`'s shape,
 * `undoTurn`'s, `divergenceTurn`'s and `memory/capture.ts`'s `recordEscape` —
 * the fourth worked example rather than a new mechanism. A picture arrives after
 * its turn has committed and an append-only segment cannot be revised, so the
 * pointer needs a node of its own to hang on; that is the same problem a memory
 * leaving the session had, answered the same way.
 *
 * `by` is `{ kind: 'engine' }` when a generator finished one and
 * `{ kind: 'user' }` when a person chose among siblings. Both are admitted by
 * `engine-computed` and a model is not, which is the policy meaning exactly what
 * it says.
 */
export async function selectBackdrop(
  sessions: SessionContext,
  handle: string,
  sessionId: string,
  renditionId: string,
  by: { kind: 'engine' } | { kind: 'user' },
): Promise<void> {
  const session = await readSession(sessions, handle, sessionId);
  if (session === null) return;

  const turns = await readTurns(sessions, handle, sessionId);
  const path = walkPath(turns, session.headTurnId);
  const running = await reconstructAlong(sessions, handle, sessionId, path);

  const id = uuidv7();
  const effect = acceptEffect(
    id,
    {
      channelId: SE_BACKDROP,
      scopeKey: null,
      op: { type: 'set', path: '/' },
      /**
       * ***`MediaSelection`'s second arm, written for the first time in this
       * build.***
       *
       * `packages/sdk/src/media.ts` has carried it since [P7.9] with *"nothing
       * writes this arm until [P9]"* on it, declared then precisely so the
       * channel's schema would not have to change under live sessions when
       * something did ([06 §4.2]). It does not: `MEDIA_SELECTION_SCHEMA` already
       * admits this shape, so P7's obligation is collected rather than paid
       * again.
       */
      after: { from: 'rendition', renditionId },
      proposedBy: by,
    },
    running,
  );

  await appendTurnToSession(sessions, handle, sessionId, {
    id,
    sessionId,
    parentTurnId: session.headTurnId,
    createdAt: new Date().toISOString(),
    status: 'complete',
    effects: [effect],
    tape: [],
  });
}

/**
 * The channel Scene declares and the engine writes.
 *
 * *A literal here rather than an import*, which is the split `staging.ts`
 * already models: the engine may not import a mode ([P7.0], and
 * `tools/repo-shape.test.ts` enforces it), so the id it writes is a string on
 * this side and a declaration on that one. `mode-loader.test.ts` is where the
 * two are pinned to each other — neither side importing the other is what makes
 * that check possible at all.
 */
export const SE_BACKDROP = 'se.backdrop';

/**
 * Which rendition the backdrop channel currently names, or null.
 *
 * Read through `unknown`, which is `readSummary`'s rule and `originOf`'s: the
 * value came off a session file that a person may have edited, and a declared
 * shape would make the checks look redundant to the compiler while doing the
 * only work that matters.
 */
export function selectedBackdrop(
  channels: Readonly<Record<string, { value: unknown }>>,
): string | null {
  const value: unknown = channels[SE_BACKDROP]?.value;
  if (typeof value !== 'object' || value === null) return null;
  const selection = value as { from?: unknown; renditionId?: unknown };
  if (selection.from !== 'rendition' || typeof selection.renditionId !== 'string') return null;
  return selection.renditionId;
}
