// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import type { ModeDefinition } from '@storyengine/sdk';

import { writeJsonAtomic } from '../storage/atomic.js';
import { chatSettingsOf, type ChatSettings, type SpeakerSettings } from './chat-settings.js';
import {
  indexWrittenSession,
  readSession,
  sessionFilePath,
  withSessionLock,
  type SessionContext,
} from './store.js';
import type { CardPromptPart, SessionFile } from './types.js';

/**
 * ***Changing how a session plays as a chat*** —
 * [P14 §1.2](../../../../docs/design/workplan/31-p14-scene-and-session-import.md),
 * [§1.5](../../../../docs/design/workplan/31-p14-scene-and-session-import.md) and
 * [§1.8](../../../../docs/design/workplan/31-p14-scene-and-session-import.md)'s
 * *"session settings gain voice, dispatch, policy, self-responses, names in
 * history and the author's note"*, built at [P14.5].
 *
 * P14.0 gave the session its chat fields and one reader, `chatSettingsOf`; P14.3
 * and P14.4 built everything that reads them. Nothing wrote them after creation
 * but an import, so the settings a person was promised had no door. This is the
 * door, and it is shaped by the reader's one hard rule.
 *
 * ***Writing one of voice, dispatch and speakers writes all three.*** Absence
 * is not one thing (`chatSettingsOf`, rule 2): a session carrying none of the
 * three was written before P14.0 and reads as the mode's `legacy` values —
 * Scene's narrator/merged/fixed. A write that set only `dispatch` on such a
 * session would move it into the modern era, and its absent `voice` would then
 * fall to the mode's *declared* value, `embodied`: a person ticking one box
 * would re-voice a whole saved game. So the write reads the effective three
 * first and puts every one of them on the file, with the requested change laid
 * over — the same explicitness creation has had since P14.0, reached late.
 *
 * *The other fields are independent* and are written only when sent:
 *
 * - **`note`** — the author's note whole, or `null` to remove it. A note with no
 *   text is no note (`noteOf`'s rule), so empty text removes it too; an
 *   interval of 0 switches it off with the text kept, which is ST's meaning and
 *   what the reader already takes it to mean.
 * - **`prompts`** — merged per key, so a cast row that toggles one card sends
 *   that card alone. `instruction: true` and a card's `true` or empty list are
 *   *send everything*, which the file spells as no entry ([P14 §1.5]'s
 *   *"absent means send everything"*); `false` and a list of parts are what is
 *   skipped.
 *
 * *Under the session's lock and not refused while a turn runs*, for
 * `setHidden`'s reason: nothing here moves a node, and the running turn read its
 * settings before it started, so the change reaches the next one — which is
 * what changing a setting mid-reply means.
 */
export interface ChatPatch {
  voice?: ChatSettings['voice'];
  dispatch?: ChatSettings['dispatch'];
  speakers?: Partial<SpeakerSettings>;
  note?: { text: string; depth: number; every: number } | null;
  prompts?: {
    instruction?: boolean;
    cards?: Record<string, boolean | readonly CardPromptPart[]>;
  };
}

export type ChatWriteOutcome =
  { kind: 'written'; session: SessionFile; chat: ChatSettings } | { kind: 'no-session' };

export async function setChatSettings(
  context: SessionContext,
  handle: string,
  sessionId: string,
  mode: ModeDefinition,
  patch: ChatPatch,
): Promise<ChatWriteOutcome> {
  return withSessionLock(sessionId, async () => {
    const session = await readSession(context, handle, sessionId);
    if (session === null) return { kind: 'no-session' };

    const current = chatSettingsOf(session, mode);
    const next: SessionFile = { ...session, updatedAt: new Date().toISOString() };

    if (patch.voice !== undefined || patch.dispatch !== undefined || patch.speakers !== undefined) {
      next.voice = patch.voice ?? current.voice;
      next.dispatch = patch.dispatch ?? current.dispatch;
      next.speakers = { ...current.speakers, ...definedOnly(patch.speakers ?? {}) };
    }

    if (patch.note !== undefined) {
      if (patch.note === null || patch.note.text === '') delete next.note;
      else next.note = { ...patch.note };
    }

    if (patch.prompts !== undefined) {
      const prompts = promptsAfter(session.prompts, patch.prompts);
      if (prompts === null) delete next.prompts;
      else next.prompts = prompts;
    }

    await writeJsonAtomic(sessionFilePath(context.layout, handle, sessionId), next);
    indexWrittenSession(context, handle, next);
    return { kind: 'written', session: next, chat: chatSettingsOf(next, mode) };
  });
}

/**
 * The prompts field after a patch, or null for *nothing switched off* — the
 * record's usual shape for none, which is what a session that never switched
 * anything off already holds.
 */
function promptsAfter(
  held: SessionFile['prompts'],
  patch: NonNullable<ChatPatch['prompts']>,
): NonNullable<SessionFile['prompts']> | null {
  // Rebuilt rather than deleted from, as `setHidden` rebuilds its map: the
  // cards a patch sends back to *everything* are the ones left out.
  const patched = patch.cards ?? {};
  const cards: Record<string, false | CardPromptPart[]> = Object.fromEntries(
    Object.entries(held?.cards ?? {}).filter(([actorId]) => !(actorId in patched)),
  );
  for (const [actorId, entry] of Object.entries(patched)) {
    if (entry === false) cards[actorId] = false;
    else if (entry !== true && entry.length > 0) cards[actorId] = [...new Set(entry)];
  }
  const instruction =
    patch.instruction === undefined ? held?.instruction : patch.instruction ? undefined : false;

  const prompts: NonNullable<SessionFile['prompts']> = {};
  if (instruction === false) prompts.instruction = false;
  if (Object.keys(cards).length > 0) prompts.cards = cards;
  return Object.keys(prompts).length === 0 ? null : prompts;
}

/** A partial with its `undefined` members dropped, so a spread cannot blank a default. */
function definedOnly<T extends object>(value: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(value).filter(([, member]) => member !== undefined),
  ) as Partial<T>;
}
