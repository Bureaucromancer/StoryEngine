// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { useEffect, useState, type JSX } from 'react';

import type { ChatSettings, SpeakerPolicy } from '../api.js';
import { labels } from '../i18n/catalogue.js';
import { useLibrary, useSession, useSetChatSettings } from '../queries.js';
import { AlertNote } from '../ui/Alert.js';
import { Button } from '../ui/Button.js';
import { CheckboxField, Field, NumberField, SelectField } from '../ui/Field.js';
import { disclosure } from '../ui/classes.js';
import { CardPrompts } from './CardPrompts.js';
import { ModeRegion } from './ModeRegion.js';

/**
 * ***How this chat plays*** —
 * [P14 §1.8](../../../../docs/design/workplan/31-p14-scene-and-session-import.md)'s
 * *"session settings gain voice, dispatch, policy, self-responses, names in
 * history and the author's note"*, built at [P14.5].
 *
 * ***Two visible controls with plain-language labels, not a four-way enum*** —
 * [06 §7.2](../../../../docs/design/06-modes-and-turn-pipeline.md)'s
 * instruction, followed literally. Voice and dispatch are two axes, and a
 * select of their four products would make a person learn our vocabulary to
 * answer a question they already have words for: *do the characters speak for
 * themselves?* and *does each one get a call of their own?*
 *
 * **Dispatch shows only under the characters' own voice.** [P14.2] built a
 * narrator that ignores it — a narrator speaks for nobody, so there is no
 * speaker to give a call — and asked this stage to either hide the control or
 * say it does nothing. Hiding it is the one that cannot be misread.
 *
 * ***The smart policy says its cost in its label*** — [P14 §1.3a] point 8: *"the
 * cost is in the label, not a help page"*. A person choosing it is choosing an
 * extra model call on some turns, and the only honest place to say so is the
 * option they are choosing.
 *
 * *Every control writes as it changes*, as the dial panel's selects do, except
 * the author's note, which is prose and is saved when its author says so — a
 * write per keystroke would put half-sentences into the prompt of any turn
 * that happened to start meanwhile.
 *
 * *Read from the session's effective settings* (`chat` on the read, through
 * the server's one reader), so a session written before P14 shows the
 * narrated, merged, first-played settings its turns actually get.
 */
const WORDS = labels('play.chat-settings', {
  summary: 'How this chat plays',
  voiceLegend: 'Who writes the replies',
  embodied: 'The characters, each in their own voice',
  narrator: 'A narrator, telling the scene',
  dispatch: 'Each character replies in a call of their own',
  dispatchHint:
    'On: one call per speaker, each seeing the replies before it. Off: one reply that may speak for several characters at once.',
  policy: 'Who replies',
  policyHint: 'A character you name in your message replies whatever this says.',
  maxPerRound: 'The most a smart pick may choose',
  selfResponses: 'A character may reply straight after themselves',
  namesInHistory: 'Naming speakers to the model',
  instruction: 'Send the prompt pack’s own instruction',
  instructionHint:
    'Off sends a card’s own system prompt alone, which is what SillyTavern does by default.',
  note: 'Author’s note',
  noteHint:
    'Standing advice placed a few lines back in the story, every so many of your messages. Unlike guidance, it stays until you change it.',
  depth: 'How many lines back',
  every: 'Every how many of your messages (0 switches it off)',
  saveNote: 'Save the note',
  removeNote: 'Remove the note',
  cards: 'What each card sends',
  failed: 'That setting could not be saved.',
  modeSettings: 'Session settings',
});

/**
 * The policies a person may choose, in the order they are offered. `fixed` is
 * not among them: it is how a session written before P14 reads, and it is
 * shown as itself only on such a session, so the select never lies about it.
 */
const POLICY_WORDS: Readonly<Record<string, string>> = labels('play.speaker-policy', {
  natural: 'Whoever is addressed, then whoever feels like talking',
  list: 'Everyone, in cast order',
  pooled: 'One at a time, taking turns',
  manual: 'Only who I ask, or one at random when I let them talk',
  smart: 'Smart — a model picks who replies (one extra call on turns where nobody is named)',
  fixed: 'As this session was first played',
});

const OFFERED: readonly SpeakerPolicy[] = ['natural', 'list', 'pooled', 'manual', 'smart'];

const NAMES_WORDS: Readonly<Record<string, string>> = labels('play.names-in-history', {
  never: 'Never name who said what',
  groups: 'Name who said what once two or more are talking',
  always: 'Always name who said what',
});

export function ChatSettingsPanel(props: { sessionId: string }): JSX.Element | null {
  const session = useSession(props.sessionId);
  const chat = session.data?.chat;
  /**
   * ***What the mode put in settings*** — the `settings` region, [P14.5a]:
   * [P14 §1.9.6]'s agent switches, *"in the session's settings, grouped under
   * Agents"*. Inside this panel for a chat, which is where a Marinara user
   * looks; on its own for a mode that declares settings and does not play as a
   * chat, so a switch never goes missing with the panel around it.
   */
  const declared = (
    <ModeRegion sessionId={props.sessionId} surfaces={session.data?.surfaces} region="settings" />
  );
  if (chat === undefined) {
    if (!(session.data?.surfaces ?? []).some((one) => one.region === 'settings')) return null;
    return (
      <details className="rounded-control border border-line bg-surface px-3 py-2">
        <summary className={`${disclosure.quiet} text-sm`}>{WORDS.modeSettings}</summary>
        <div className="mt-3">{declared}</div>
      </details>
    );
  }
  return (
    <Settings
      sessionId={props.sessionId}
      chat={chat}
      roster={session.data?.session.cast}
      declared={declared}
    />
  );
}

function Settings(props: {
  sessionId: string;
  chat: ChatSettings;
  roster: { persona: string | null; actors: string[] } | undefined;
  declared: JSX.Element;
}): JSX.Element {
  const { chat } = props;
  const write = useSetChatSettings(props.sessionId);
  const actors = useLibrary('actors');

  const policies: readonly string[] = OFFERED.includes(chat.speakers.policy)
    ? OFFERED
    : [...OFFERED, chat.speakers.policy];

  return (
    <details className="rounded-control border border-line bg-surface px-3 py-2">
      <summary className={`${disclosure.quiet} text-sm`}>{WORDS.summary}</summary>
      <div className="mt-3 flex flex-col gap-3">
        <fieldset className="flex flex-col gap-1">
          <legend className="text-sm font-medium text-ink-muted">{WORDS.voiceLegend}</legend>
          {(['embodied', 'narrator'] as const).map((voice) => (
            <label key={voice} className="flex items-center gap-2 text-sm text-ink">
              <input
                type="radio"
                name={`voice-${props.sessionId}`}
                checked={chat.voice === voice}
                disabled={write.isPending}
                onChange={() => {
                  write.mutate({ voice });
                }}
              />
              {WORDS[voice]}
            </label>
          ))}
        </fieldset>

        {chat.voice === 'embodied' ? (
          <CheckboxField
            label={WORDS.dispatch}
            hint={WORDS.dispatchHint}
            checked={chat.dispatch === 'per-actor'}
            disabled={write.isPending}
            onChange={(checked) => {
              write.mutate({ dispatch: checked ? 'per-actor' : 'merged' });
            }}
          />
        ) : null}

        <SelectField
          label={WORDS.policy}
          hint={WORDS.policyHint}
          value={chat.speakers.policy}
          options={policies.map((one) => [one, POLICY_WORDS[one] ?? one] as const)}
          onChange={(policy) => {
            write.mutate({ speakers: { policy: policy as SpeakerPolicy } });
          }}
        />

        {chat.speakers.policy === 'smart' ? (
          <CountField
            label={WORDS.maxPerRound}
            value={chat.speakers.maxPerRound}
            min={1}
            max={32}
            onCommit={(maxPerRound) => {
              write.mutate({ speakers: { maxPerRound } });
            }}
          />
        ) : null}

        <CheckboxField
          label={WORDS.selfResponses}
          checked={chat.speakers.allowSelfResponses}
          disabled={write.isPending}
          onChange={(allowSelfResponses) => {
            write.mutate({ speakers: { allowSelfResponses } });
          }}
        />

        <SelectField
          label={WORDS.namesInHistory}
          value={chat.speakers.namesInHistory}
          options={(['never', 'groups', 'always'] as const).map(
            (one) => [one, NAMES_WORDS[one] ?? one] as const,
          )}
          onChange={(namesInHistory) => {
            write.mutate({
              speakers: {
                namesInHistory: namesInHistory as ChatSettings['speakers']['namesInHistory'],
              },
            });
          }}
        />

        <CheckboxField
          label={WORDS.instruction}
          hint={WORDS.instructionHint}
          checked={chat.prompts.instruction}
          disabled={write.isPending}
          onChange={(instruction) => {
            write.mutate({ prompts: { instruction } });
          }}
        />

        <NoteEditor
          note={chat.note}
          busy={write.isPending}
          onSave={(note) => {
            write.mutate({ note });
          }}
        />

        {(props.roster?.actors ?? []).filter((id) => id !== props.roster?.persona).length ===
        0 ? null : (
          <div className="flex flex-col gap-2">
            <span className="text-sm font-medium text-ink-muted">{WORDS.cards}</span>
            {(props.roster?.actors ?? [])
              .filter((id) => id !== props.roster?.persona)
              .map((id) => (
                <CardPrompts
                  key={id}
                  sessionId={props.sessionId}
                  actorId={id}
                  name={(actors.data?.objects ?? []).find((one) => one.id === id)?.name ?? id}
                  chat={chat}
                />
              ))}
          </div>
        )}

        {props.declared}

        {write.isError ? <AlertNote role="alert">{WORDS.failed}</AlertNote> : null}
      </div>
    </details>
  );
}

/**
 * The author's note — [P14 §1.5]. *Held locally until saved*, and re-seeded
 * when the stored note changes underneath it (another tab, an import), so what
 * the box shows is never older than what the next turn will send unless
 * somebody is in the middle of typing it.
 */
function NoteEditor(props: {
  note: ChatSettings['note'];
  busy: boolean;
  onSave: (note: ChatSettings['note']) => void;
}): JSX.Element {
  const stored = props.note ?? { text: '', depth: 4, every: 1 };
  const [text, setText] = useState(stored.text);
  const [depth, setDepth] = useState(String(stored.depth));
  const [every, setEvery] = useState(String(stored.every));
  useEffect(() => {
    setText(stored.text);
    setDepth(String(stored.depth));
    setEvery(String(stored.every));
  }, [stored.text, stored.depth, stored.every]);

  const whole = (value: string, fallback: number): number => {
    const parsed = Number.parseInt(value, 10);
    return Number.isInteger(parsed) && parsed >= 0 ? parsed : fallback;
  };

  return (
    <div className="flex flex-col gap-2">
      <Field
        label={WORDS.note}
        hint={WORDS.noteHint}
        multiline
        rows={3}
        value={text}
        onChange={setText}
      />
      <div className="flex flex-wrap gap-3">
        <NumberField label={WORDS.depth} value={depth} min={0} onChange={setDepth} />
        <NumberField label={WORDS.every} value={every} min={0} onChange={setEvery} />
      </div>
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          disabled={props.busy}
          onClick={() => {
            props.onSave(
              text.trim() === ''
                ? null
                : { text, depth: whole(depth, stored.depth), every: whole(every, stored.every) },
            );
          }}
        >
          {WORDS.saveNote}
        </Button>
        {props.note === null ? null : (
          <Button
            type="button"
            variant="quiet"
            disabled={props.busy}
            onClick={() => {
              props.onSave(null);
            }}
          >
            {WORDS.removeNote}
          </Button>
        )}
      </div>
    </div>
  );
}

/** A small whole-number setting, written when the box is left or Enter is pressed. */
function CountField(props: {
  label: string;
  value: number;
  min: number;
  max: number;
  onCommit: (value: number) => void;
}): JSX.Element {
  const [held, setHeld] = useState(String(props.value));
  useEffect(() => {
    setHeld(String(props.value));
  }, [props.value]);
  return (
    <NumberField
      label={props.label}
      value={held}
      min={props.min}
      max={props.max}
      onChange={setHeld}
      onCommit={() => {
        const parsed = Number.parseInt(held, 10);
        if (!Number.isInteger(parsed) || parsed < props.min || parsed > props.max) {
          setHeld(String(props.value));
          return;
        }
        if (parsed !== props.value) props.onCommit(parsed);
      }}
    />
  );
}
