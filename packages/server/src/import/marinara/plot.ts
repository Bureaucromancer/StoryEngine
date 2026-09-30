// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import type { ChatStateValue } from '../chat/types.js';

/**
 * ***Marinara's secret plot, as Scene's*** —
 * [P14 §2.6](../../../../../docs/design/workplan/31-p14-scene-and-session-import.md)'s
 * second table, built at [P14.5b]:
 *
 * | Marinara | Here |
 * |---|---|
 * | `agent_memory` `overarchingArc` | `se.plot.secret` on the root chat's head turn |
 * | `narrativeDirectorSecretPlotEnabled` | the plot's switch, `se.plot.secret.on` |
 * | `narrativeDirectorSecretPlotRunInterval` | its cadence, in story turns |
 *
 * ***Pure, and it spells Scene's channel ids***, for `trackers.ts`' reason:
 * an import converts into the mode chats are imported into, and the SDK
 * boundary keeps that mode's package out of the server's reach. The ids,
 * versions and inits are pinned to the registered channels by
 * `plot.test.ts` beside this file, and every arc built here is validated
 * there against the registered schema.
 *
 * ***On the head, not the opening.*** Marinara keeps one arc per chat, rewritten
 * in place (`agentsStore.setMemory`), with no record of which message it was
 * revised at — so what is known is the arc *as of now*, and now is the chat's
 * head. Written on an opening turn it would claim the story began with an arc
 * it only reached later; on the head it is the state the session opens in,
 * and the builder writes the head cache to match.
 */
export const SCENE_PLOT = {
  secret: { id: 'se.plot.secret', version: 1, init: null },
  on: { id: 'se.plot.secret.on', version: 1, init: false },
  cadence: { id: 'se.plot.secret.cadence', version: 1, init: { everyNTurns: 4 } },
} as const;

// Schema ceilings — `plot.ts`'s in the Scene package, so an imported arc is one the channel takes.
const DESCRIPTION = 1500;
const ARC_LINE = 800;

type Row = Readonly<Record<string, unknown>>;

/**
 * ***The plot's switch and cadence*** — for `ChatSettings.state`, the family's
 * opening turns, beside the tracker switches.
 *
 * **On only when Marinara ran it**: its maintenance runs only for a resolved
 * director (`generate.routes.ts:3784-3797`) — `enableAgents` and `director` in
 * `activeAgentIds`, the trackers' rule — and then only when the chat's
 * `narrativeDirectorSecretPlotEnabled` says so. *The per-chat flag only*: the
 * director's own `secretPlotEnabled` default lives on its global agent config,
 * which is not per chat and is not read. The run interval counts messages,
 * the player's and the replies' together, so half of it is story turns.
 */
export function plotSwitches(
  metadata: Readonly<Record<string, unknown>>,
  active: readonly string[],
): ChatStateValue[] {
  if (!active.includes('director') || metadata['narrativeDirectorSecretPlotEnabled'] !== true) {
    return [];
  }
  const out: ChatStateValue[] = [
    { channelId: SCENE_PLOT.on.id, version: SCENE_PLOT.on.version, init: false, value: true },
  ];
  const interval = Number(metadata['narrativeDirectorSecretPlotRunInterval']);
  if (Number.isFinite(interval) && interval >= 1) {
    const everyNTurns = Math.min(Math.max(Math.round(interval / 2), 1), 100);
    if (everyNTurns !== SCENE_PLOT.cadence.init.everyNTurns) {
      out.push({
        channelId: SCENE_PLOT.cadence.id,
        version: SCENE_PLOT.cadence.version,
        init: SCENE_PLOT.cadence.init,
        value: { everyNTurns },
      });
    }
  }
  return out;
}

/**
 * ***The arc a chat's director kept*** — the `agent_memory` row keyed
 * `overarchingArc` for this chat, the latest by `updatedAt` should there be
 * two (one per director config), read as Marinara's `normalizeSecretPlotArc`
 * reads it: a string is a description, an object its four fields, and neither
 * is nothing. Stored as JSON text (`setMemory` stringifies anything that is
 * not a string), and read either way.
 */
export function secretPlotOf(rows: readonly Row[], chatId: string): ChatStateValue[] {
  let latest: Row | null = null;
  for (const row of rows) {
    if (str(row['chatId']) !== chatId || str(row['key']) !== 'overarchingArc') continue;
    if (latest === null || str(row['updatedAt']) > str(latest['updatedAt'])) latest = row;
  }
  if (latest === null) return [];
  const arc = arcOf(parsed(latest['value']));
  return arc === null
    ? []
    : [
        {
          channelId: SCENE_PLOT.secret.id,
          version: SCENE_PLOT.secret.version,
          init: SCENE_PLOT.secret.init,
          value: arc,
        },
      ];
}

function arcOf(raw: unknown): Record<string, unknown> | null {
  if (typeof raw === 'string') {
    const description = clip(raw, DESCRIPTION);
    return description === '' ? null : { description, protagonistArc: '', completed: false };
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null;
  const arc = raw as Row;
  const description = clip(str(arc['description']), DESCRIPTION);
  // An arc with no description is no arc here: the channel's schema needs one,
  // and Marinara's own reader keeps such an arc only for its `completed` flag.
  if (description === '') return null;
  const characterArc = clip(str(arc['characterArc']), ARC_LINE);
  return {
    description,
    protagonistArc: clip(str(arc['protagonistArc']), ARC_LINE),
    ...(characterArc === '' ? {} : { characterArc }),
    completed: arc['completed'] === true,
  };
}

function parsed(value: unknown): unknown {
  if (typeof value !== 'string') return value ?? null;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return value;
  }
}

function clip(text: string, limit: number): string {
  const trimmed = text.trim();
  return trimmed.length <= limit ? trimmed : trimmed.slice(0, limit).trimEnd();
}

function str(value: unknown): string {
  return typeof value === 'string' ? value : typeof value === 'number' ? String(value) : '';
}
