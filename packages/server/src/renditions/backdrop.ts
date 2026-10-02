// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import type { Turn } from '@storyengine/shared';

import { acceptEffect } from '../turns/effects.js';
import {
  appendEngineTurn,
  engineTurn,
  type EngineTurnOutcome,
  type SessionContext,
} from '../sessions/store.js';
import type { Layout } from '../storage/layout.js';
import { readRendition } from './store.js';

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
): Promise<EngineTurnOutcome> {
  /**
   * ***Read, built and appended under the session's lock*** (2026-09-27). This
   * read the head and built its turn outside the lock and appended under it,
   * so a turn committing in between left the selection on a dead line. And a
   * backdrop arriving while a turn is in flight answers `busy` rather than
   * becoming a sibling that turn's commit abandons: the caller defers it to
   * that commit (`DeferredBackdrops`).
   */
  return appendEngineTurn(sessions, handle, sessionId, (session, running) =>
    engineTurn(session, (id) =>
      acceptEffect(
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
      ),
    ),
  );
}

/**
 * ***An engine selection held for the turn that was in flight*** (2026-09-27).
 *
 * A backdrop that finishes while the next turn is being written cannot be
 * shown yet: a selection now would be a sibling of that turn, which its commit
 * abandons, so the picture somebody paid for would never appear on the line
 * being played. Dropping it is no better. So it waits here, one per session,
 * and the runner applies it right after that turn commits.
 *
 * **Unless the turn asked for a backdrop of its own.** It moved somewhere, or
 * went back to a place it had one for, and the newer picture is the one that
 * belongs on it; showing the older one over it would be wrong until the newer
 * arrived, and after it for a reused one that never arrives.
 *
 * *One per session, the latest winning*, because only the last selection would
 * be showing anyway. In memory, and lost on a restart, which costs a backdrop
 * that is on disk and can still be chosen by hand.
 */
export class DeferredBackdrops {
  readonly #held = new Map<string, { account: string; renditionId: string }>();

  hold(sessionId: string, account: string, renditionId: string): void {
    this.#held.set(sessionId, { account, renditionId });
  }

  /** Takes what is held for a session, leaving nothing behind. */
  take(sessionId: string): { account: string; renditionId: string } | undefined {
    const held = this.#held.get(sessionId);
    this.#held.delete(sessionId);
    return held;
  }
}

/**
 * A finished backdrop, shown now or held for the turn in flight — what the
 * worker calls when a background lands. Whether it is showing now is the
 * answer: `false` when it was held, or when the session has gone.
 */
export async function offerBackdrop(
  sessions: SessionContext,
  held: DeferredBackdrops,
  account: string,
  sessionId: string,
  renditionId: string,
): Promise<boolean> {
  const outcome = await selectBackdrop(sessions, account, sessionId, renditionId, {
    kind: 'engine',
  });
  if (outcome.kind === 'busy') held.hold(sessionId, account, renditionId);
  return outcome.kind === 'written';
}

/**
 * What the runner calls once a turn has committed: the backdrop held for it,
 * shown on top of it, unless the turn asked for one of its own. If yet another
 * turn is already under way, it is held for that one instead.
 *
 * ***Says what it showed*** (2026-09-30), because a page has to be told: the
 * selection is a node appended after `turn.finished` has already sent the
 * page to read the head, so without a word the page kept the turn as its head
 * and the next thing it sent was refused as out of date. The caller sends the
 * rendition's frame again, which is the page's sign that the backdrop moved.
 */
export async function showHeldBackdrop(
  sessions: SessionContext,
  held: DeferredBackdrops,
  sessionId: string,
  turn: Turn,
): Promise<{ account: string; renditionId: string } | null> {
  const one = held.take(sessionId);
  if (one === undefined) return null;
  if (await asksForItsOwnBackdrop(sessions.layout, one.account, sessionId, turn)) return null;
  const shown = await offerBackdrop(sessions, held, one.account, sessionId, one.renditionId);
  return shown ? one : null;
}

/**
 * Whether a committed turn asked for a backdrop of its own, which supersedes
 * one held for it (see `DeferredBackdrops`): one it reused, or a background
 * among the pictures it requested.
 */
export async function asksForItsOwnBackdrop(
  layout: Layout,
  account: string,
  sessionId: string,
  turn: Turn,
): Promise<boolean> {
  const report = turn.renditions;
  if (report === undefined) return false;
  if (report.reused !== undefined) return true;
  for (const id of report.requested) {
    const record = await readRendition(layout, account, sessionId, id);
    if (record?.purpose === 'background') return true;
  }
  return false;
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
