// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import type { ImportNote } from '@storyengine/shared';

import type { ChatStateValue } from '../chat/types.js';

/**
 * ***Marinara's editor and echo chamber, as Scene's*** —
 * [P14 §2.6](../../../../../docs/design/workplan/31-p14-scene-and-session-import.md)'s
 * second table and [§1.9.6], built at [P14.5c]:
 *
 * | Marinara | Here |
 * |---|---|
 * | `prose-guardian` in `activeAgentIds` | `se.edit.style.on` |
 * | `continuity` in `activeAgentIds` | `se.edit.continuity.on`, applying (Marinara's behaviour) |
 * | `echo-chamber` in `activeAgentIds` | `se.echo.on` |
 * | `proseGuardianBannedWords` / `…AvoidInstructions` / `…StyleInstructions` | `se.edit.style` |
 * | `proseGuardianHoldForRewrite` | `se.edit.hold` |
 * | `html`, `card-evolution-auditor` | a note each: not built, and why ([§1.9.4], [§1.9.5]) |
 *
 * ***Pure, and it spells Scene's channel ids***, for `trackers.ts`' reason:
 * the SDK boundary keeps the mode's package out of the server's reach, so the
 * ids, versions and inits are pinned to the registered channels by
 * `editor.test.ts` beside this file, and every value built here is validated
 * there against the registered schema.
 */
export const SCENE_EDITOR = {
  styleOn: { id: 'se.edit.style.on', version: 1, init: false },
  style: {
    id: 'se.edit.style',
    version: 1,
    init: {
      banned: 'ozone',
      avoid:
        'Repeating phrases or sentence shapes from the last few messages; opening with dialogue when the last reply did; purple prose.',
      prefer: '',
    },
  },
  continuityOn: { id: 'se.edit.continuity.on', version: 1, init: false },
  continuityApply: { id: 'se.edit.continuity.apply', version: 1, init: false },
  hold: { id: 'se.edit.hold', version: 1, init: true },
  echoOn: { id: 'se.echo.on', version: 1, init: false },
} as const;

/** The style record's ceiling — `edit.ts`'s, so an imported rule is one the channel takes. */
const TEXT = 2000;

/**
 * ***What the chat's metadata says about its editor and its chorus*** — for
 * `ChatSettings.state`, the family's opening turns, beside the tracker and
 * plot switches.
 *
 * **A switch is on only when Marinara ran the agent** — `active` is already
 * `enableAgents` and `activeAgentIds` together, the trackers' rule. *The
 * settings come whenever the chat set them*, switch on or off: they are what
 * a person typed, and a person switching the editor on later should find their
 * banned words there.
 *
 * ***Continuity comes applying.*** Marinara's continuity checker rewrites the
 * message (it is one of its three rewrite agents), so a chat that ran it ran
 * *apply*; landing it on this build's default *notice* would quietly change
 * what the chat did. The note says so, and how to switch it back.
 */
export function editorSwitches(
  metadata: Readonly<Record<string, unknown>>,
  active: readonly string[],
  chat: string,
  notes: ImportNote[],
): ChatStateValue[] {
  const out: ChatStateValue[] = [];
  const on = (spelled: { id: string; version: number; init: boolean }): void => {
    out.push({ channelId: spelled.id, version: spelled.version, init: spelled.init, value: true });
  };
  if (active.includes('prose-guardian')) on(SCENE_EDITOR.styleOn);
  if (active.includes('continuity')) {
    on(SCENE_EDITOR.continuityOn);
    on(SCENE_EDITOR.continuityApply);
    notes.push({ key: 'import.chat.continuityApplies', params: { chat }, level: 'info' });
  }
  if (active.includes('echo-chamber')) {
    on(SCENE_EDITOR.echoOn);
    // Same switch, different feature ([§1.9.5]): Marinara's is a live audience
    // of invented handles; Scene's has the scene's characters react.
    notes.push({ key: 'import.chat.echoChamberDiffers', params: { chat }, level: 'info' });
  }

  const style = styleOf(metadata);
  if (style !== null) {
    out.push({
      channelId: SCENE_EDITOR.style.id,
      version: SCENE_EDITOR.style.version,
      init: SCENE_EDITOR.style.init,
      value: style,
    });
  }
  // Marinara holds unless told not to (`readSharedHoldForRewrite`), which is our default.
  if (metadata['proseGuardianHoldForRewrite'] === false) {
    out.push({
      channelId: SCENE_EDITOR.hold.id,
      version: SCENE_EDITOR.hold.version,
      init: SCENE_EDITOR.hold.init,
      value: false,
    });
  }

  /**
   * ***What is not built, said rather than dropped*** — each with its reason
   * in the note's words: immersive HTML is a refusal ([§1.9.4]: model-authored
   * markup rendered from this server's origin), the card-evolution auditor a
   * design choice ([§1.9.5]: an agent editing a card from inside a session
   * bleeds that session into every later one).
   */
  if (active.includes('html')) {
    notes.push({ key: 'import.chat.immersiveHtmlNotBuilt', params: { chat }, level: 'info' });
  }
  if (active.includes('card-evolution-auditor')) {
    notes.push({ key: 'import.chat.cardEvolutionNotBuilt', params: { chat }, level: 'info' });
  }
  return out;
}

/** The agents this module carries or answers for — `trackers.ts` leaves them out of `agentsNotCarried`. */
export const EDITOR_AGENTS: ReadonlySet<string> = new Set([
  'prose-guardian',
  'continuity',
  'echo-chamber',
  'html',
  'card-evolution-auditor',
]);

/**
 * ***The three prose-guardian settings*** — each a string in the chat's
 * metadata, read as Marinara's `applyProseGuardianChatSettings` reads them: a
 * string (even empty) is the chat's word, anything else falls back to the
 * default, which here is the channel's `init` — Marinara's defaults in
 * substance. Null when the chat set none of the three, so an untouched
 * setting is not written as though somebody chose it.
 */
function styleOf(metadata: Readonly<Record<string, unknown>>): Record<string, string> | null {
  const fields = {
    banned: metadata['proseGuardianBannedWords'],
    avoid: metadata['proseGuardianAvoidInstructions'],
    prefer: metadata['proseGuardianStyleInstructions'],
  };
  if (Object.values(fields).every((value) => typeof value !== 'string')) return null;
  const init = SCENE_EDITOR.style.init;
  const pick = (value: unknown, fallback: string): string =>
    typeof value === 'string' ? value.trim().slice(0, TEXT) : fallback;
  return {
    banned: pick(fields.banned, init.banned),
    avoid: pick(fields.avoid, init.avoid),
    prefer: pick(fields.prefer, init.prefer),
  };
}
