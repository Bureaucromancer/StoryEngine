// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import type { JSX } from 'react';

import { labels } from '../i18n/catalogue.js';
import { Fine } from '../ui/Text.js';

/**
 * ***The composer's chat controls*** —
 * [P13 §1.8](../../../../docs/design/workplan/30-p13-scene-and-session-import.md),
 * built at [P13.5]: *"sending an empty box is let them talk; a who-speaks-next
 * control forces a member; Impersonate stays"* — and auto-mode beside them,
 * because it is the same gesture on a timer.
 *
 * **Who speaks next is one-shot**, unlike the input kind above it: the kind is
 * a mode of composing that a conversation keeps, while naming who answers is
 * about *this* message — SillyTavern's *speak* button and Marinara's
 * `forCharacterId` are both a single press. The page clears it when the turn is
 * sent.
 *
 * ***While a round streams it shows the order*** — [P13 §1.3a] point 8,
 * Marinara's `response_queue`: who is replying, in order, and whether a model
 * chose them. The select is disabled then anyway, so the line takes its place
 * rather than sitting beside a control nobody can use.
 */
const WORDS = labels('play.chat-composer', {
  who: 'Who speaks next',
  whoever: 'Whoever the scene picks',
  replying: 'Replying: {names}',
  byModel: 'A model chose.',
  byRules: 'The rules chose.',
  byForced: 'You chose.',
  byFallback: 'The model could not choose, so the rules did.',
  byRewrite: 'Kept from the reply this redoes.',
  auto: 'Let them keep talking on their own',
  autoHint:
    'Sends an empty message whenever the chat has been quiet this long. Typing or Stop turns it off.',
  autoSeconds: 'Seconds of quiet',
  letThemTalk: 'Let them talk',
  nobody:
    'Nobody here can reply: everyone is muted or gone. Name somebody, or unmute them in the cast.',
});

/** The Send button's word when the box is empty — the catalogue's, read at render. */
export function letThemTalkLabel(): string {
  return WORDS.letThemTalk;
}

/** Who chose the order, in a sentence — read at render, so a locale switch reaches it. */
function chosenBy(by: string): string {
  if (by === 'model') return WORDS.byModel;
  if (by === 'fallback') return WORDS.byFallback;
  if (by === 'rewrite') return WORDS.byRewrite;
  // Force-talk — *Speak* or *who speaks next*: the person named the speaker,
  // and crediting the rules with it would be telling them they did not.
  if (by === 'forced') return WORDS.byForced;
  return WORDS.byRules;
}

export function WhoSpeaksNext(props: {
  members: readonly { id: string; name: string }[];
  value: string;
  onChange: (actorId: string) => void;
  disabled: boolean;
  order: { speakers: { id: string; name: string }[]; by: string } | null;
  running: boolean;
}): JSX.Element | null {
  if (props.running && props.order !== null && props.order.speakers.length > 0) {
    const names = props.order.speakers.map((one) => one.name).join(' → ');
    return (
      <p role="status" className="text-sm text-ink-subtle">
        {`${WORDS.replying.replace('{names}', () => names)} ${chosenBy(props.order.by)}`}
      </p>
    );
  }
  if (props.members.length === 0) return null;
  return (
    <label className="flex flex-wrap items-center gap-2 text-sm text-ink-muted">
      {WORDS.who}
      <select
        className="rounded-control border border-line bg-surface p-1 text-ink"
        value={props.value}
        disabled={props.disabled}
        onChange={(event) => {
          props.onChange(event.target.value);
        }}
      >
        <option value="">{WORDS.whoever}</option>
        {props.members.map((one) => (
          <option key={one.id} value={one.id}>
            {one.name}
          </option>
        ))}
      </select>
    </label>
  );
}

/**
 * ***Auto-mode's two controls*** — on or off, and how long the chat must be
 * quiet first (SillyTavern's `auto_mode_delay`, 5 seconds by default). The
 * clock itself is `useAutoMode`.
 */
export function AutoMode(props: {
  on: boolean;
  seconds: string;
  onToggle: (on: boolean) => void;
  onSeconds: (seconds: string) => void;
}): JSX.Element {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <label className="flex items-center gap-2 text-sm text-ink-muted" title={WORDS.autoHint}>
        <input
          type="checkbox"
          checked={props.on}
          onChange={(event) => {
            props.onToggle(event.target.checked);
          }}
        />
        {WORDS.auto}
      </label>
      <label className="flex items-center gap-2 text-sm text-ink-muted">
        {WORDS.autoSeconds}
        <input
          type="number"
          min={1}
          max={600}
          className="w-20 rounded-control border border-line bg-surface p-1 text-ink"
          value={props.seconds}
          onChange={(event) => {
            props.onSeconds(event.target.value);
          }}
        />
      </label>
    </div>
  );
}

/** What an empty send would get when nobody can answer — [P13.4]'s note to this stage. */
export function NobodyWouldReply(): JSX.Element {
  return <Fine>{WORDS.nobody}</Fine>;
}

/** Seconds as typed, read as a delay: a whole number from 1 to 600, else the default. */
export function autoDelayMs(seconds: string, fallback: number): number {
  const parsed = Number.parseInt(seconds, 10);
  return (Number.isInteger(parsed) && parsed >= 1 && parsed <= 600 ? parsed : fallback) * 1000;
}
