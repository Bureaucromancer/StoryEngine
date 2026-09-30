// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import type { JSX } from 'react';

import type { CardPromptPart, ChatSettings } from '../api.js';
import { labels } from '../i18n/catalogue.js';
import { useSetChatSettings } from '../queries.js';
import { CARD_PARTS, cardSwitch, skippedParts } from './chat.js';

/**
 * ***A card's own prompt fields, one switch each*** —
 * [P14 §1.5](../../../../docs/design/workplan/31-p14-scene-and-session-import.md),
 * built at [P14.5]: *"Both toggles live in the session-settings panel, and the
 * card toggles also appear on each member's cast row, because that is where a
 * person looks when one character misbehaves."* So this renders in both, and
 * is one component so the two cannot disagree about what a switch writes.
 *
 * **Ticked is sent**, which is the file's default — *absent means send
 * everything* — so a card nobody touched shows three ticks, and unticking one
 * is SillyTavern's `forbid_overrides`, made per card and per field.
 *
 * *A card with no such field is unaffected either way*: the switch says what
 * this chat would send, not what the card carries, and reading every card to
 * hide the switches it does not need would be a library read per member for a
 * control that changes nothing when it is wrong.
 */
const WORDS = labels('play.card-prompts', {
  legend: 'What {name}’s card sends',
  system: 'Its system prompt',
  'post-history': 'Its post-history instructions',
  depth: 'Its depth prompt',
});

export function CardPrompts(props: {
  sessionId: string;
  actorId: string;
  name: string;
  chat: ChatSettings;
}): JSX.Element {
  const write = useSetChatSettings(props.sessionId);
  const skipped = skippedParts(props.chat, props.actorId);
  const legend = WORDS.legend.replace('{name}', () => props.name);

  const set = (part: CardPromptPart, send: boolean): void => {
    write.mutate({ prompts: { cards: { [props.actorId]: cardSwitch(skipped, part, send) } } });
  };

  return (
    <fieldset className="flex flex-wrap gap-3">
      <legend className="text-sm text-ink-muted">{legend}</legend>
      {CARD_PARTS.map((part) => (
        <label key={part} className="flex items-center gap-1 text-sm text-ink-muted">
          <input
            type="checkbox"
            checked={!skipped.includes(part)}
            disabled={write.isPending}
            onChange={(event) => {
              set(part, event.target.checked);
            }}
          />
          {WORDS[part]}
        </label>
      ))}
    </fieldset>
  );
}
