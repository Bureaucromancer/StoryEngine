// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { useEffect, useState, type JSX } from 'react';

import type { OutputMessage, RevisionNotice, TextSpan } from '@storyengine/shared';

import type { ChatSettings, LibraryObject, SwipeGroups, TurnRecord } from '../api.js';
import { labels } from '../i18n/catalogue.js';
import { Button } from '../ui/Button.js';
import { control, disclosure, reveal } from '../ui/classes.js';
import { Fine } from '../ui/Text.js';
import { isMessageHidden, messageOffsets, messageSiblings, type HiddenEntry } from './chat.js';
import { MentionOverlay } from './MentionOverlay.js';
import { Portrait } from './Portrait.js';

/**
 * ***A turn, drawn as the chat it is*** —
 * [P13 §1.8](../../../../docs/design/workplan/30-p13-scene-and-session-import.md),
 * built at [P13.5].
 *
 * *"The transcript is a chat. For each message: the speaker's portrait and
 * name, and the persona's for the input; the reasoning, collapsed; the swipe
 * counter on the message it belongs to; a ghost on hidden lines; actions:
 * edit, continue, swipe, hide, branch. A narrator message is drawn as one."*
 * That list is this component, row for row.
 *
 * **For every turn of a chat**, `output.messages` or not. A turn written
 * before P13 — or a narrated one — arrives as one narrator message
 * (`outputMessagesOf`), drawn as narration: no portrait and no name, because
 * giving a paragraph by nobody a bubble would be claiming a shape the record
 * does not have. It is drawn here rather than as `TurnView`'s prose all the
 * same, because hide, edit, branch and delete are the chat's gestures on every
 * line of it, and a narrator-voice chat is nothing but such turns.
 *
 * ***Every gesture is a sibling, and that is [P13 §1.6]'s design rather than a
 * limitation.*** An edit is a turn written by hand beside this one; a continue
 * and a swipe are siblings carrying what they did not redo; a branch at a
 * message is an edit that stops there. The original stays on the tree, and the
 * counter on the message is how a person gets back to it. Only hide changes
 * something in place, because hiding is state about a line rather than a line.
 *
 * *The turn-level gestures stay on the turn* (`TurnView`): redo, reroll,
 * continue-from-here, illustrate, remember, undo. [07 §7] resolves branching
 * inside a multi-message turn to the turn's node, and these are the ones that
 * are about the node.
 */
const WORDS = labels('play.chat', {
  you: 'You',
  thinking: 'Thinking',
  hidden: 'Hidden from the story. The characters do not see this line.',
  hiddenTurn: 'Hidden from the story, with its replies.',
  edit: 'Edit',
  editLabel: 'Edit this line',
  save: 'Save',
  cancel: 'Cancel',
  continue: 'Continue',
  swipe: 'Another reply',
  hide: 'Hide',
  unhide: 'Unhide',
  hideTurn: 'Hide this exchange',
  unhideTurn: 'Unhide this exchange',
  branch: 'Branch here',
  delete: 'Delete',
  previous: 'Previous reply',
  next: 'Next reply',
  count: '{at} of {of}',
  original: 'Edited: show the original',
  findings: 'What the continuity check found',
  apply: 'Apply',
});

/**
 * ***What the model wrote, a click away*** — shared with the prose view, where
 * a narrated turn the editor changed keeps `output.original` rather than
 * becoming a message ([P13.5c]).
 */
export function EditedOriginal({ text }: { text: string }) {
  return (
    <details>
      <summary className={`${disclosure.quiet} text-sm`}>{WORDS.original}</summary>
      <p className="whitespace-pre-wrap text-sm text-ink-subtle">{text}</p>
    </details>
  );
}

export interface ChatGestures {
  onGo: (turnId: string) => void;
  onSwipe: (turn: TurnRecord, index: number) => void;
  onContinue: (turn: TurnRecord) => void;
  onEditMessage: (turn: TurnRecord, index: number, text: string) => void;
  onEditInput: (turn: TurnRecord, text: string) => void;
  /** Hide or unhide one message (`index`), or the whole exchange (`null`). */
  onHide: (turn: TurnRecord, hide: boolean, index: number | null) => void;
  onBranch: (turn: TurnRecord, index: number) => void;
  /** [P13 §1.6]'s *Delete*: the head moves to the turn's parent. */
  onDelete: (turn: TurnRecord) => void;
  /**
   * A line's edit box opened (`true`) or closed. **Stable across renders** —
   * it is an effect's dependency. The page counts open boxes and is not idle
   * while any is: opening one is taking the turn back, which stops auto-mode
   * as typing in the composer does.
   */
  onEditing: (open: boolean) => void;
}

export function ChatMessages(
  props: {
    turn: TurnRecord;
    messages: readonly OutputMessage[];
    hidden: HiddenEntry;
    /** The library's actors, read once by the page — `surfaces`' rule. */
    actors: readonly LibraryObject[];
    personaId: string | null;
    swipes: SwipeGroups | undefined;
    /**
     * The chat's voice. Under a narrator a swipe or a continue is refused
     * whoever said the line (`narrated-session`), so neither is offered.
     */
    voice: ChatSettings['voice'] | undefined;
    /** Whether this is the session's head turn — see *Branch here*. */
    head: boolean;
    busy: boolean;
  } & ChatGestures,
): JSX.Element {
  const { turn, messages } = props;
  const spans = (turn.spans ?? []).filter((span) => span.field === 'output');
  const offsets = messageOffsets(messages.map((message) => message.text));
  const lastSpoken = messages.length - 1;

  const actorOf = (id: string | null | undefined): LibraryObject | undefined =>
    id == null ? undefined : props.actors.find((one) => one.id === id);

  return (
    <div className="flex flex-col gap-3">
      {turn.input === undefined || turn.input.text === '' ? null : (
        <InputLine
          turn={turn}
          // The persona's name when the library has the card, *You* when there
          // is no persona or the card is gone — never an id.
          name={actorOf(turn.input.actorId ?? props.personaId)?.name ?? WORDS.you}
          actor={actorOf(turn.input.actorId ?? props.personaId)}
          hiddenWhole={props.hidden === true}
          busy={props.busy}
          onEdit={(text) => {
            props.onEditInput(turn, text);
          }}
          onHide={(hide) => {
            props.onHide(turn, hide, null);
          }}
          onEditing={props.onEditing}
        />
      )}
      {messages.map((message, index) => (
        <MessageLine
          // A message has no id of its own: its index is its identity on this
          // turn, and the turn is immutable, so the index never moves.
          key={index}
          turn={turn}
          index={index}
          message={message}
          spans={spansFor(spans, offsets[index] ?? null, message.text.length)}
          actor={actorOf(message.speaker?.id)}
          hidden={isMessageHidden(props.hidden, index)}
          last={index === lastSpoken}
          head={props.head}
          narrated={props.voice === 'narrator'}
          counters={messageSiblings(props.swipes, index, index === lastSpoken)}
          notices={(turn.steps ?? []).flatMap((step) =>
            (step.revisions ?? []).flatMap((row) =>
              row.index === index ? (row.notices ?? []) : [],
            ),
          )}
          busy={props.busy}
          gestures={props}
        />
      ))}
    </div>
  );
}

/** The spans inside one message, rebased onto its own text. A span across two is dropped. */
function spansFor(spans: readonly TextSpan[], start: number | null, length: number): TextSpan[] {
  if (start === null) return [];
  const end = start + length;
  return spans
    .filter((span) => span.start >= start && span.end <= end)
    .map((span) => ({ ...span, start: span.start - start, end: span.end - start }));
}

function InputLine(props: {
  turn: TurnRecord;
  name: string;
  actor: LibraryObject | undefined;
  hiddenWhole: boolean;
  busy: boolean;
  onEdit: (text: string) => void;
  onHide: (hide: boolean) => void;
  onEditing: (open: boolean) => void;
}): JSX.Element {
  const [editing, setEditing] = useState(false);
  useEditingReport(editing, props.onEditing);
  const text = props.turn.input?.text ?? '';
  return (
    <div
      className={`group/line flex gap-2 ${props.hiddenWhole ? 'opacity-50' : ''}`}
      data-hidden={props.hiddenWhole ? 'true' : undefined}
    >
      <Portrait actor={props.actor} name={props.name} />
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="text-sm font-medium text-ink-muted">{props.name}</span>
        {editing ? (
          <EditBox
            text={text}
            busy={props.busy}
            onSave={(next) => {
              props.onEdit(next);
              setEditing(false);
            }}
            onCancel={() => {
              setEditing(false);
            }}
          />
        ) : (
          <p className="whitespace-pre-wrap text-story text-ink-subtle">{text}</p>
        )}
        {props.hiddenWhole ? <Fine>{WORDS.hiddenTurn}</Fine> : null}
        <div
          className={`flex flex-wrap gap-2 ${reveal} group-focus-within/line:opacity-100 group-hover/line:opacity-100`}
        >
          <Button
            type="button"
            size="compact"
            disabled={props.busy || editing}
            onClick={() => {
              setEditing(true);
            }}
          >
            {WORDS.edit}
          </Button>
          <Button
            type="button"
            size="compact"
            disabled={props.busy}
            onClick={() => {
              props.onHide(!props.hiddenWhole);
            }}
          >
            {props.hiddenWhole ? WORDS.unhideTurn : WORDS.hideTurn}
          </Button>
        </div>
      </div>
    </div>
  );
}

function MessageLine(props: {
  turn: TurnRecord;
  index: number;
  message: OutputMessage;
  spans: TextSpan[];
  actor: LibraryObject | undefined;
  hidden: boolean;
  last: boolean;
  head: boolean;
  narrated: boolean;
  counters: string[][];
  /** What an editor found in this line and left for a person ([P13.5c]). */
  notices: RevisionNotice[];
  busy: boolean;
  gestures: ChatGestures;
}): JSX.Element {
  const { message, turn, index, gestures } = props;
  const [editing, setEditing] = useState(false);
  useEditingReport(editing, gestures.onEditing);
  const narrator = message.speaker === null;
  /**
   * ***Nobody's line, or nobody's chat.*** A narrator's line spoke for nobody,
   * so *"by the same speaker"* has no speaker and the server refuses a swipe or
   * a continue of it (`narrated-message`); a chat switched to the narrator's
   * voice refuses both on every line, including the embodied ones written
   * before the switch (`narrated-session`). Neither is shown as a button that
   * fails. Redo on the turn is the swipe either way.
   */
  const unspoken = narrator || props.narrated;
  const name = message.speaker?.name ?? '';

  const prose = editing ? (
    <EditBox
      text={message.text}
      busy={props.busy}
      onSave={(next) => {
        gestures.onEditMessage(turn, index, next);
        setEditing(false);
      }}
      onCancel={() => {
        setEditing(false);
      }}
    />
  ) : (
    <MentionOverlay
      text={message.text}
      spans={props.spans}
      className="whitespace-pre-wrap text-story text-ink"
    />
  );

  const body = (
    <div className="flex min-w-0 flex-1 flex-col gap-1">
      {narrator ? null : <span className="text-sm font-medium text-ink">{name}</span>}
      {prose}
      {message.reasoning === undefined || message.reasoning === '' ? null : (
        <details>
          <summary className={`${disclosure.quiet} text-sm`}>{WORDS.thinking}</summary>
          <p className="whitespace-pre-wrap text-sm text-ink-subtle">{message.reasoning}</p>
        </details>
      )}
      {/* ***Edited, and the original a click away*** — [P13 §1.9.4]: the
          editor's rewrite (or cleanup's trim) is the line; what the model
          wrote is `original`, offered, never shown in its place. */}
      {message.original === undefined ? null : <EditedOriginal text={message.original} />}
      {/* ***Continuity, as a checklist on the line it is about*** — each
          finding says what is wrong, and one that names its words and their
          fix is applied by the edit gesture: a sibling with that substitution,
          the line as it was staying on the tree. */}
      {props.notices.length === 0 ? null : (
        <ul aria-label={WORDS.findings} className="flex flex-col gap-1 text-sm text-ink-subtle">
          {props.notices.map((notice, at) => (
            <li key={at} className="flex items-start gap-2">
              <span className="flex-1">{notice.issue}</span>
              {notice.quote !== undefined &&
              notice.fix !== undefined &&
              message.text.includes(notice.quote) ? (
                <Button
                  type="button"
                  size="compact"
                  disabled={props.busy}
                  onClick={() => {
                    gestures.onEditMessage(
                      turn,
                      index,
                      message.text.replace(notice.quote ?? '', () => notice.fix ?? ''),
                    );
                  }}
                >
                  {WORDS.apply}
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      )}
      {props.hidden ? <Fine>{WORDS.hidden}</Fine> : null}
      {props.counters.map((ids, at) => (
        <Counter key={at} turnId={turn.id} ids={ids} busy={props.busy} onGo={gestures.onGo} />
      ))}
      <div
        className={`flex flex-wrap gap-2 ${reveal} group-focus-within/line:opacity-100 group-hover/line:opacity-100`}
      >
        <Button
          type="button"
          size="compact"
          disabled={props.busy || editing}
          onClick={() => {
            setEditing(true);
          }}
        >
          {WORDS.edit}
        </Button>
        {/* Not on a line nobody spoke, nor in a narrated chat — `unspoken`. */}
        {unspoken ? null : (
          <Button
            type="button"
            size="compact"
            disabled={props.busy}
            onClick={() => {
              gestures.onSwipe(turn, index);
            }}
          >
            {WORDS.swipe}
          </Button>
        )}
        {/* The last line only, and not a hidden one — the server refuses to
            continue what the characters cannot see (`hidden-message`). */}
        {unspoken || !props.last || props.hidden ? null : (
          <Button
            type="button"
            size="compact"
            disabled={props.busy}
            onClick={() => {
              gestures.onContinue(turn);
            }}
          >
            {WORDS.continue}
          </Button>
        )}
        <Button
          type="button"
          size="compact"
          disabled={props.busy}
          onClick={() => {
            gestures.onHide(turn, !props.hidden, index);
          }}
        >
          {props.hidden ? WORDS.unhide : WORDS.hide}
        </Button>
        {/* ***Not on the head's last line***: branching there is *continue
            from here* at the node the head is already on, a button that would
            do nothing visible. Anywhere else it cuts the round or moves the
            head. */}
        {props.head && props.last ? null : (
          <Button
            type="button"
            size="compact"
            disabled={props.busy}
            onClick={() => {
              gestures.onBranch(turn, index);
            }}
          >
            {WORDS.branch}
          </Button>
        )}
        {/* ***Delete, once per turn, on its last line*** — [P13 §1.6]: the head
            moves to the turn's parent and the turn stays as a sibling nobody is
            on, so it is the whole exchange that goes, not one message. */}
        {props.last ? (
          <Button
            type="button"
            size="compact"
            disabled={props.busy}
            onClick={() => {
              gestures.onDelete(turn);
            }}
          >
            {WORDS.delete}
          </Button>
        ) : null}
      </div>
    </div>
  );

  return (
    <div
      className={`group/line flex gap-2 ${props.hidden ? 'opacity-50' : ''}`}
      data-hidden={props.hidden ? 'true' : undefined}
    >
      {narrator ? null : <Portrait actor={props.actor} name={name} />}
      {body}
    </div>
  );
}

/**
 * ***The swipe counter, on the message it belongs to*** — [P13 §1.6]. A count
 * and two steps, which is what SillyTavern draws there; naming a line stays on
 * the turn's own strip, because a name is about a node, not a message.
 */
function Counter(props: {
  turnId: string;
  ids: readonly string[];
  busy: boolean;
  onGo: (turnId: string) => void;
}): JSX.Element | null {
  const at = props.ids.indexOf(props.turnId);
  if (props.ids.length < 2 || at < 0) return null;
  const previous = props.ids[at - 1];
  const next = props.ids[at + 1];
  const count = WORDS.count
    .replace('{at}', () => String(at + 1))
    .replace('{of}', () => String(props.ids.length));
  return (
    <div className="flex items-center gap-2 text-sm text-ink-subtle">
      <Button
        type="button"
        size="compact"
        aria-label={WORDS.previous}
        disabled={props.busy || previous === undefined}
        onClick={() => {
          if (previous !== undefined) props.onGo(previous);
        }}
      >
        ‹
      </Button>
      <span aria-live="polite">{count}</span>
      <Button
        type="button"
        size="compact"
        aria-label={WORDS.next}
        disabled={props.busy || next === undefined}
        onClick={() => {
          if (next !== undefined) props.onGo(next);
        }}
      >
        ›
      </Button>
    </div>
  );
}

/**
 * Tells the page while a line's edit box is open, and that it closed —
 * including by the line unmounting, which a turn landing can do mid-edit. The
 * page counts open boxes; one left counted would hold auto-mode off forever.
 */
function useEditingReport(editing: boolean, onEditing: (open: boolean) => void): void {
  useEffect(() => {
    if (!editing) return;
    onEditing(true);
    return () => {
      onEditing(false);
    };
  }, [editing, onEditing]);
}

function EditBox(props: {
  text: string;
  busy: boolean;
  onSave: (text: string) => void;
  onCancel: () => void;
}): JSX.Element {
  const [text, setText] = useState(props.text);
  return (
    <form
      className="flex flex-col gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        // An edit that changed nothing is not an edit: it would write a sibling
        // identical to its original, which the counter would then count.
        if (text === props.text) {
          props.onCancel();
          return;
        }
        props.onSave(text);
      }}
    >
      <label>
        <span className="sr-only">{WORDS.editLabel}</span>
        <textarea
          className={`${control} field-sizing-content max-h-80 resize-y`}
          value={text}
          autoFocus
          onChange={(event) => {
            setText(event.target.value);
          }}
        />
      </label>
      <div className="flex gap-2">
        <Button type="submit" size="compact" variant="primary" disabled={props.busy}>
          {WORDS.save}
        </Button>
        <Button type="button" size="compact" onClick={props.onCancel}>
          {WORDS.cancel}
        </Button>
      </div>
    </form>
  );
}
