// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { useEffect, useRef, useState, type JSX } from 'react';

import type { HudEdit } from '../api.js';
import { labels } from '../i18n/catalogue.js';
import { useWriteChannel } from '../queries.js';
import { AlertNote } from '../ui/Alert.js';
import { Button } from '../ui/Button.js';
import { Field, NumberField } from '../ui/Field.js';
import { Popover, type PopoverChange } from '../ui/Popover.js';
import { strip } from '../ui/classes.js';
import { Fine } from '../ui/Text.js';
import { writeFailed } from './WriteFailed.js';

/**
 * The strip entry's words. A refusal is said by its class, never by the
 * server's English, as every refusal in the client is ([Q1a]).
 */
const WORDS = labels('play.hud', {
  notSet: 'not set',
  readOnly:
    'This can’t be changed from here: the strip changes a line of text or a number, and this is neither.',
  // For an entry sent with no edit at all, which may well be a line of text —
  // the docstring's 2026-10-14 note says why it is not `readOnly`.
  notHere: 'This can’t be changed from here.',
  save: 'Save',
  emptyIsNotSet: 'Leave it empty for not set.',
  number: 'That is not a number.',
  whole: 'That is not a whole number.',
  between: 'Between {min} and {max}.',
  atLeast: 'At least {min}.',
  atMost: 'At most {max}.',
  schema: 'That doesn’t fit what {label} holds.',
  gone: 'This session has no {label} any more.',
  refused: 'The engine refused it.',
  notChanged: '{label} was not changed. {why}',
});

/** One entry, as either of its two senders spells it — see {@link HudEntry}. */
export interface HudEntryShape {
  key: string;
  label: string;
  text: string;
  edit?: HudEdit | null;
  value?: string | number | null;
}

/**
 * ***One fact about now, opened in place to be corrected*** —
 * [10 §1.3](../../../../docs/design/10-ui-surfaces.md)'s *"world state as a
 * strip of widgets you can edit in place"*, built at
 * [P12A](../../../../docs/design/workplan/35-p12a-the-look.md) P12A.4 under its
 * §0.4, which found that the write was complete and the strip could not use it.
 *
 * **It knows no channel**, which is `ChannelHud`'s rule and the reason the
 * entry carries its own edit: the server derives it from the channel's declared
 * schema (`hudEdit`), so a string is a line of text, a number is a number with
 * the bounds its schema gives, and anything else opens to a sentence saying it
 * is not changed here. *(2026-10-14,
 * [P12A](../../../../docs/design/workplan/35-p12a-the-look.md)'s final audit:
 * and an entry sent with **no edit at all** — a placement the server offers no
 * edit for, which since P12A.5 is a mode's `panel` reading drawn in the strip,
 * or an entry from an older server — says only that it is not changed here.
 * The sentence for the rest says *the strip changes a line of text or a
 * number, and this is neither*, which is true of a schema the strip cannot
 * edit and false of a string a mode placed outside `hud`: only `hud`
 * placements carry an edit, and the string on the trigger is a line of text.)*
 * There is no `if (channelId === 'se.location')` in this
 * file, and the day one is wanted the vocabulary was too narrow.
 *
 * **The write is the ordinary channel write** — `PUT /sessions/:id/channels/
 * :key`, a turn with a `user` effect, on the record, undoable, branch-correct —
 * which is [P12A §1.4](../../../../docs/design/workplan/35-p12a-the-look.md)'s
 * condition: *"a correction is a state effect and has to reach the record like
 * any other"*. A refusal is a `200` with the effect unapplied, and is said here
 * in the entry's own words by its class.
 *
 * ***What was typed is never dropped, and Escape is the only way to drop
 * it.*** [P12A.3]'s review left this stage a sentence: the popover closes when
 * focus leaves it, so a widget holding an unsaved value *"has to commit it on
 * blur, as `TokenField` does, or Tabbing out of the popover drops what was
 * typed."* So the value is held here, outside the panel, and every close but
 * Escape writes it — Save, Enter, Tab away, a press outside, the trigger
 * again — while Escape, the one close that means *never mind*, puts it back.
 * Nothing is written when nothing changed: an unchanged close is a close, not
 * an empty turn on the record — and words the engine has just refused are not
 * sent again by a close, which would record the refusal twice (`settle`).
 *
 * *What a refused close says, and where.* Inside the panel while it is open;
 * once it has closed — Tabbed away from, pressed past — the sentence stands in
 * the strip after the entry, named, so a write that did not land never looks
 * as though it did. Opening the entry again brings back what was typed and the
 * sentence with it, to be corrected or let go.
 */
export function HudEntry(props: { sessionId: string; entry: HudEntryShape }): JSX.Element {
  const { entry } = props;
  const write = useWriteChannel(props.sessionId);
  const [open, setOpen] = useState(false);
  /** What was typed, or `null` for nothing yet — the box then shows the value. */
  const [draft, setDraft] = useState<string | null>(null);
  /**
   * Why the last attempt did not land, in the entry's words: at the **box**
   * when what was typed is not a value the edit describes — said on the field,
   * where it is fixed — or at the **write** when the server refused it or the
   * request failed.
   */
  const [problem, setProblem] = useState<{ at: 'box' | 'write'; text: string } | null>(null);
  /** What was typed when a write last did not land — see `settle`. */
  const tried = useRef<string | null>(null);
  /**
   * ***What is typed now, for a write's answer*** (2026-10-14, after review).
   * The answer closes over the render that sent it, and words typed while it
   * was out are not the words it wrote — so it reads this rather than its own
   * `draft`, which is the one it sent. Kept current the way `Popover` keeps
   * its holder.
   */
  const now = useRef(draft);
  useEffect(() => {
    now.current = draft;
  });
  /**
   * ***The entry's form, for what its box cannot say in its value***
   * (2026-10-14, after review). The panel is hidden rather than unmade while
   * shut, so this is live at every close. A `type="number"` box holding text
   * the browser cannot read — *1-2* in Chrome, *abc* in Firefox — reports its
   * value as `''`, the same as a box emptied on purpose, and only its
   * `validity.badInput` tells the two apart. For a number that may be unset
   * the difference is *That is not a number.* against a recorded write of
   * `null` that clears the channel.
   */
  const form = useRef<HTMLFormElement>(null);
  const edit = knownEdit(entry.edit);
  const typed = draft ?? startOf(entry.value);
  const range = edit?.kind === 'number' ? rangeOf(edit) : null;

  /**
   * Writes what was typed, if anything was and it differs. `onLanded` runs
   * when there is nothing left to say — written, or nothing to write.
   * *(2026-10-14, after review: written, and nothing typed since it was sent —
   * see `now`; and a number box holding text it cannot read is something left
   * to say — see `form`.)* `asked` is a Save or an Enter; anything else is a
   * close.
   *
   * ***Once at a time.*** A Save still waiting on its answer, then a Tab out
   * of the panel, would otherwise send the same value twice — two turns on the
   * record for one correction, the second a write of the value the first had
   * just made. While one is out, a close writes nothing, and the write already
   * out says how it went.
   *
   * ***And a close does not ask again what was just refused.*** A refusal is a
   * turn on the record, so a close that re-sent the words the engine had just
   * turned down would record the same refusal twice for one attempt — and
   * again on every close after. What did not land stays typed and said; a
   * Save asks again, and so does a close once the words have changed.
   */
  function settle(onLanded: () => void, asked: boolean): void {
    if (write.isPending) return;
    if (edit === null) {
      onLanded();
      return;
    }
    // Before the draft is read, and before `draft === null` closes quietly:
    // unreadable text the box never reported as a change is still in the box,
    // and a close that said nothing about it would look like a save.
    if (
      edit.kind === 'number' &&
      form.current?.querySelector('input')?.validity.badInput === true
    ) {
      setProblem({ at: 'box', text: WORDS.number });
      return;
    }
    if (draft === null) {
      onLanded();
      return;
    }
    if (!asked && draft === tried.current) return;
    const read = parse(edit, draft);
    if (!read.ok) {
      setProblem({ at: 'box', text: read.why });
      return;
    }
    if (read.value === (entry.value ?? null)) {
      setDraft(null);
      setProblem(null);
      onLanded();
      return;
    }
    setProblem(null);
    const sent = draft;
    write.mutate(
      { key: entry.key, value: read.value },
      {
        onSuccess: (result) => {
          if (result.effect.applied) {
            tried.current = null;
            // Only `sent` landed. Anything typed since — more words after a
            // Save, or a new place typed into an entry reopened while a close's
            // write was out — is still unsaved, so it stays in the box, and a
            // Save does not close the panel over it.
            if (now.current !== sent) return;
            setDraft(null);
            onLanded();
            return;
          }
          tried.current = sent;
          setProblem({ at: 'write', text: refusal(result.effect.rejectedReason, entry.label) });
        },
        onError: (error) => {
          tried.current = sent;
          setProblem({ at: 'write', text: writeFailed(error) });
        },
      },
    );
  }

  function change(next: boolean, how: PopoverChange): void {
    if (next) {
      setOpen(true);
      return;
    }
    setOpen(false);
    if (how === 'escape') {
      tried.current = null;
      setDraft(null);
      setProblem(null);
      return;
    }
    settle(() => undefined, false);
  }

  return (
    <>
      <Popover
        place="under"
        label={entry.label}
        open={open}
        onOpenChange={change}
        triggerClassName={strip.item}
        trigger={
          <>
            <span className={strip.label}>{entry.label}</span>{' '}
            <span className={entry.text === '' ? strip.unset : 'text-ink'}>
              {entry.text === '' ? WORDS.notSet : entry.text}
            </span>
          </>
        }
      >
        {edit === null ? (
          <Fine>{entry.edit === undefined ? WORDS.notHere : WORDS.readOnly}</Fine>
        ) : (
          /**
           * `noValidate`: the bounds and the whole-number rule are said in
           * the entry's words, on the field, by `parse` — a browser's own
           * bubble over a `type="number"` box would refuse a submit first, in
           * its own language and before this file has said anything.
           */
          <form
            ref={form}
            noValidate
            className="flex flex-col gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              settle(() => {
                // Closed by the holder, with the keyboard inside: `Popover`
                // gives it back to the entry, which now reads what was saved.
                setOpen(false);
              }, true);
            }}
          >
            {edit.kind === 'text' ? (
              <Field
                label={entry.label}
                value={typed}
                onChange={setDraft}
                error={problem?.at === 'box' ? problem.text : null}
                {...(edit.nullable ? { hint: WORDS.emptyIsNotSet } : {})}
              />
            ) : (
              <NumberField
                label={entry.label}
                value={typed}
                onChange={setDraft}
                error={problem?.at === 'box' ? problem.text : null}
                {...(edit.min === null ? {} : { min: edit.min })}
                {...(edit.max === null ? {} : { max: edit.max })}
                {...(range === null ? {} : { hint: range })}
              />
            )}
            <div>
              <Button type="submit" size="compact" disabled={write.isPending}>
                {WORDS.save}
              </Button>
            </div>
            {problem?.at === 'write' ? (
              <AlertNote role="alert">{notChanged(entry.label, problem.text)}</AlertNote>
            ) : null}
          </form>
        )}
      </Popover>
      {open || problem === null ? null : (
        <AlertNote role="alert" className="basis-full">
          {notChanged(entry.label, problem.text)}
        </AlertNote>
      )}
    </>
  );
}

/** *Place was not changed*, and why — the one sentence a write that did not land is said in. */
function notChanged(label: string, why: string): string {
  return WORDS.notChanged.replace('{label}', () => label).replace('{why}', () => why);
}

/** An edit this build knows, or `null` — a newer kind reads as not editable here. */
function knownEdit(edit: HudEdit | null | undefined): HudEdit | null {
  if (edit === undefined || edit === null) return null;
  // Widened on purpose: the type names two kinds, the wire may carry a third.
  const kind: string = edit.kind;
  return kind === 'text' || kind === 'number' ? edit : null;
}

function startOf(value: string | number | null | undefined): string {
  return value === undefined || value === null ? '' : String(value);
}

/**
 * ***What was typed, as the value it would write*** — or why it would not.
 *
 * Text is trimmed, and an empty box is `null` where the schema admits it,
 * which is *not set*; a channel whose schema does not is sent the empty string
 * and its schema answers. A number is checked against what the entry says the
 * schema bounds it by before anything is sent, so the common mistake is said
 * at the box rather than as a refusal on the record; anything the edit does not
 * describe — a `multipleOf`, an exclusive bound — is the schema's to refuse,
 * and the refusal is said the same way.
 */
function parse(
  edit: HudEdit,
  typed: string,
): { ok: true; value: string | number | null } | { ok: false; why: string } {
  const trimmed = typed.trim();
  if (edit.kind === 'text') {
    return { ok: true, value: trimmed === '' && edit.nullable ? null : trimmed };
  }
  if (trimmed === '') return edit.nullable ? { ok: true, value: null } : bad(WORDS.number);
  const number = Number(trimmed);
  if (!Number.isFinite(number)) return bad(WORDS.number);
  if (edit.integer && !Number.isInteger(number)) return bad(WORDS.whole);
  const range = rangeOf(edit);
  if ((edit.min !== null && number < edit.min) || (edit.max !== null && number > edit.max)) {
    return bad(range ?? WORDS.number);
  }
  return { ok: true, value: number };
}

function bad(why: string): { ok: false; why: string } {
  return { ok: false, why };
}

/** The bounds, said — or `null` when the schema gives none. */
function rangeOf(edit: Extract<HudEdit, { kind: 'number' }>): string | null {
  const min = edit.min === null ? null : String(edit.min);
  const max = edit.max === null ? null : String(edit.max);
  if (min !== null && max !== null) {
    return WORDS.between.replace('{min}', () => min).replace('{max}', () => max);
  }
  if (min !== null) return WORDS.atLeast.replace('{min}', () => min);
  if (max !== null) return WORDS.atMost.replace('{max}', () => max);
  return null;
}

/**
 * A refusal in the entry's words, by its class. A person's write can be refused
 * for two reasons the engine has — the value does not fit the schema, or the
 * channel is not one this session has — and anything else, an extension's
 * class or a newer build's, is said as a refusal without a reason rather than
 * as its raw word.
 */
function refusal(reason: string | null, label: string): string {
  if (reason === 'schema') return WORDS.schema.replace('{label}', () => label);
  if (reason === 'unknown-channel') return WORDS.gone.replace('{label}', () => label);
  return WORDS.refused;
}
