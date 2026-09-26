// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import type { EffectProposal } from '@storyengine/sdk';
import { uuidv7, type Opening, type Openings, type Setup } from '@storyengine/shared';

import { acceptEffect } from '../turns/effects.js';
import { SE_PARTY } from './cast.js';
import { SE_HOOK } from './hooks.js';
import type { ChannelEffect, PooledHook, Turn } from './types.js';

/**
 * ***A Setup's opening, as the session's first turn*** —
 * [03 §6](../../../../docs/design/03-data-model.md),
 * [04 §7.2](../../../../docs/design/04-schemas.md),
 * [P13.3](../../../../docs/design/workplan/30-p13-implementation.md).
 *
 * **What 03 §6 has always said happens at session creation, and nothing did**:
 * *"the user picks one written opening, one seed to expand, or neither (start
 * cold)."* `Setup.openings` reached a session only inside the Setup's copy and
 * no reader on either side looked at it, so a Setup's opening was a field the
 * library kept and the game ignored. This is the written half. The seed half —
 * expand, edit, accept — stays where [P7B §1.11] put it, because it is a model
 * call and a review loop where this is a copy.
 *
 * ---
 *
 * ***An opening is a turn, and [P7.4] asked for one by name.*** Session creation
 * does not read `cast.partyDefault`, and the route says why: *"seeding it means
 * writing effects, which needs a turn."* An opening **is** that turn. So the
 * seeding writes ride on it — the party, and the hooks a Setup made from a turn
 * says had already fired — through `acceptEffect` and the ordinary log, which
 * is what makes them branch and undo like anything else. Rewind past the
 * opening and the party is a party of one again and the spent hooks are back in
 * the pool, which is exactly what a person rewinding past the start of a story
 * would expect.
 *
 * **`engine` proposes them**, which both channels' policies admit: `se.party`
 * is model-proposed and takes anyone, and `se.hook` is engine-computed and
 * refuses a model and a step but not the engine. The hand-edit reconciler's
 * divergence turn is the precedent — an engine-written turn carrying effects
 * and no call — and `divergenceTurn` is the shape this copies.
 *
 * ---
 *
 * ***No turn at all when there is nothing to write***, which is [P7.4]'s rule
 * for a mode with no parts: *"an empty plan would commit a turn that did
 * nothing, which is a blank first entry in somebody's transcript."* A Setup with
 * no written opening, no party beyond the persona and no spent hooks starts a
 * session with no turns, exactly as before this stage.
 *
 * *A Setup that seeds state but chose no opening* — a hand-written one with a
 * `partyDefault`, or a person who pressed *start cold* — gets an effects-only
 * turn, which is the divergence turn's shape exactly: no input, no output, and
 * the transcript already renders nothing for it.
 */

/**
 * Which opening a creation asked for.
 *
 * `undefined` — the parameter absent — is **the primary**, which is 03 §6's
 * default and what *start a session from this Setup* means. `null` is **start
 * cold**, the third of 03 §6's three choices, and it is a choice rather than an
 * absence: somebody who picked it wants no opening even though there is one.
 * A string names one written opening.
 */
export type OpeningChoice = string | null | undefined;

/**
 * The written opening a choice resolves to, or `null` for none.
 *
 * **An id that names nothing is `unknown`, never silently the primary.** A
 * client that asked for a particular opening and got a different one would
 * have started a story somebody did not choose, which is the dangling Setup's
 * argument for a 422 one field smaller. *A primary id that names nothing falls
 * back to the first written one*: a hand-edited Setup whose primary was
 * deleted still has openings, and refusing to start it over a stale pointer
 * would be [00 §3.3]'s visible refusal spent on the wrong failure.
 */
export function chooseOpening(
  openings: Openings | undefined,
  choice: OpeningChoice,
): Opening | null | 'unknown' {
  const written = openings?.written ?? [];
  if (choice === null) return null;
  if (choice !== undefined) return written.find((one) => one.id === choice) ?? 'unknown';
  const primary = openings?.primaryWrittenId ?? null;
  return written.find((one) => one.id === primary) ?? written[0] ?? null;
}

export interface OpeningRequest {
  sessionId: string;
  setup: Setup;
  opening: Opening | null;
  /** The session's pool, so a spent id that names nothing in it is not written. */
  pool: readonly PooledHook[];
  /** The session's persona, who is in the party by the reader's invariant already. */
  persona: string | null;
  createdAt?: string;
}

/**
 * The opening turn, or `null` when there is nothing to write.
 *
 * **The seeding writes, each for its stated reason:**
 *
 * - **`se.party: companion`** for each `partyDefault` member who is not the
 *   persona. The persona is in the party by `readParty`'s invariant and writing
 *   it would be a second answer to the same question. *Companion* rather than
 *   the control they had when the Setup was made, because a `Ref` carries none —
 *   and [06 §8]'s default for a member who is not the player's is companion.
 * - **`se.hook: fired`** for each `spentHooks` id **the pool holds**. An id that
 *   names nothing is skipped rather than written: an effect on a hook the pool
 *   does not contain would be an orphan row in every hook panel, and a Setup
 *   whose treatment was swapped should still start.
 *
 * Duplicates are written once, so a hand-edited list that names someone twice
 * does not produce a `before` that is its own `after`.
 */
export function openingTurn(request: OpeningRequest): Turn | null {
  const id = uuidv7();
  const proposals: EffectProposal[] = [];

  const party = new Set<string>();
  for (const member of request.setup.cast.partyDefault) {
    if (member.id === '' || member.id === request.persona || party.has(member.id)) continue;
    party.add(member.id);
    proposals.push(engineSet(SE_PARTY, member.id, 'companion'));
  }

  const pooled = new Set(request.pool.map((entry) => entry.hook.id));
  const spent = new Set<string>();
  for (const hookId of request.setup.spentHooks ?? []) {
    if (!pooled.has(hookId) || spent.has(hookId)) continue;
    spent.add(hookId);
    proposals.push(engineSet(SE_HOOK, hookId, 'fired'));
  }

  if (request.opening === null && proposals.length === 0) return null;

  // Distinct keys throughout, so each `before` is the channel's initial state
  // and there is no running map to chain — `acceptEffect` reads `null` for a
  // key nothing has written, which is what both channels' `init` is.
  const effects: ChannelEffect[] = proposals.map((proposal) => acceptEffect(id, proposal, {}));

  return {
    id,
    sessionId: request.sessionId,
    parentTurnId: null,
    createdAt: request.createdAt ?? new Date().toISOString(),
    status: 'complete',
    ...(request.opening === null
      ? {}
      : { output: { text: request.opening.text }, opening: { id: request.opening.id } }),
    effects,
    tape: [],
  };
}

function engineSet(channelId: string, scopeKey: string, after: string): EffectProposal {
  return {
    channelId,
    scopeKey,
    op: { type: 'set', path: '/' },
    after,
    proposedBy: { kind: 'engine' },
  };
}
