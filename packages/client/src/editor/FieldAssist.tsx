// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { useEffect, useState, type JSX } from 'react';

import { ApiError } from '../api.js';
import { remedySentence } from '../failures.js';
import { labels } from '../i18n/catalogue.js';
import type { AssistSubject } from '../ui/assist.js';
import { Button } from '../ui/Button.js';
import { Fine } from '../ui/Text.js';

/**
 * ***§11.1's four operations, on one field*** —
 * [10 §11.1](../../../../docs/design/10-ui-surfaces.md),
 * [P11.2](../../../../docs/design/workplan/28-p11-implementation.md).
 *
 * *"Generate — write this field from nothing. Refine — rewrite it against a
 * free-text guidance string… Revert — back to the value before the assist ran,
 * and separately back to the generated original after manual editing. Accept
 * as-is — the escape hatch. **Nothing may require a model call to proceed,
 * ever.**"*
 *
 * ***Accept is the absence of a control, and that is the strongest reading of
 * the fourth bullet.*** Aventuras' `useSettingAsIs()` is a button because its
 * assist is a *step* in a wizard — something you are in the middle of, which
 * has to be got out of. Here the field is just a field: what a person types
 * stands, and closing this panel changes nothing. **A button labelled *accept*
 * would imply the opposite** — that the value is pending until blessed — which
 * is exactly the requirement-to-call the sentence forbids, rebuilt as an
 * interface.
 *
 * ***Two reverts, because §11.1 asks for two and they are genuinely
 * different.*** *Before* is the value the field held when the assist ran, and it
 * is what *undo* means. *Generated* is what the model wrote, and it is what
 * somebody wants after editing the machine's paragraph into a mess. Aventuras
 * keeps `previousExpandedSetting` for the first; the second is what the
 * provenance map ([10 §11.2]) is for, and this is the surface that spends it.
 *
 * **A disclosure rather than a dialog.** The guidance box has to be readable
 * *beside* the field it is about — *make it darker* is a sentence about the text
 * three lines down — and a modal that covered the field would make the one
 * interaction §11.1 calls the whole thing impossible to compose.
 */

const WORDS = labels('editor.assist', {
  open: 'Assist',
  close: 'Close',
  generate: 'Write it',
  rewrite: 'Rewrite it',
  guidance: 'What should change?',
  guidanceHint: 'Make it darker. Shorter. Less of the weather.',
  revertBefore: 'Undo the assist',
  revertGenerated: 'Back to what the model wrote',
  working: 'Writing…',
  notBound: 'No model is set up for writing yet. Bind one in Settings.',
  noAnswer: 'The endpoint answered with nothing.',
  stopped: 'The server stopped before the assist was written. Try again.',
  failed: 'The assist did not finish.',
  superseded: 'A version was restored while this was being written, so it was not put in.',
});

export interface AssistHistory {
  /** What the field held before the last assist, if one has run. */
  before: string | null;
  /** What the model wrote, from the provenance map. */
  generated: string | null;
}

/**
 * ***The control, and only the control*** (2026-09-27).
 *
 * The request used to live here — started, awaited and landed by this
 * component — and that tied an assist's life to one mounted instance of one
 * field's label. The lorebook editor does not remount when `?entry=` changes, so
 * the instance that asked for Harbour's content went on to render Lighthouse's,
 * and showed *Writing…* there. Keyed by path, the instance goes when its field
 * does, and a running assist's *Writing…* and a failed one's sentence would have
 * gone with it. So the request, whether it is running and why it failed are
 * held per path by `useAssistFor`, which outlives every field, and this draws
 * them: what is left here is the panel's own state — whether it is open and
 * what has been typed into the guidance box.
 */
export function FieldAssist(props: {
  subject: AssistSubject;
  /** An assist on this field is running. */
  busy: boolean;
  /** Why the last assist on this field did not land, in words, or null. */
  error: string | null;
  history: AssistHistory;
  /** Start one, with the guidance as typed — blank asks for a fresh write. */
  onRun: (guidance: string) => void;
  onReverted: (to: string) => void;
  /**
   * The value this field showed, after each render — so an answer landing later
   * knows what it is replacing (`useAssistFor`'s `before`). After the render
   * rather than during it, because a render may be thrown away and an effect
   * runs only for one that was shown.
   */
  onShown: (value: string) => void;
}): JSX.Element {
  // Open from the start when there is something to say. A field comes back into
  // view — the person returns to the entry — with an assist still running or
  // one that failed while they were elsewhere, and a shut panel would hide both.
  const [open, setOpen] = useState(() => props.busy || props.error !== null);
  const [guidance, setGuidance] = useState('');
  const { busy, error, onShown, subject } = props;

  useEffect(() => {
    onShown(subject.value);
  });

  return (
    <>
      <Button
        type="button"
        size="tiny"
        aria-expanded={open}
        onClick={() => {
          setOpen((was) => !was);
        }}
      >
        {open ? WORDS.close : WORDS.open}
      </Button>
      {open ? (
        <div className="absolute end-0 z-10 mt-8 w-72 rounded-panel border border-line bg-surface p-3 shadow-lg">
          <div className="flex flex-col gap-2">
            <label className="text-sm text-ink-muted" htmlFor={`${props.subject.path}-guidance`}>
              {WORDS.guidance}
            </label>
            <textarea
              id={`${props.subject.path}-guidance`}
              className="w-full rounded-control border border-line bg-surface p-2 text-sm text-ink"
              rows={2}
              value={guidance}
              placeholder={WORDS.guidanceHint}
              onChange={(event) => {
                setGuidance(event.target.value);
              }}
            />
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                size="tiny"
                variant="primary"
                disabled={busy}
                onClick={() => {
                  props.onRun(guidance);
                }}
              >
                {busy ? WORDS.working : guidance.trim() === '' ? WORDS.generate : WORDS.rewrite}
              </Button>
              {props.history.before === null ? null : (
                <Button
                  type="button"
                  size="tiny"
                  onClick={() => {
                    props.onReverted(props.history.before ?? '');
                  }}
                >
                  {WORDS.revertBefore}
                </Button>
              )}
              {props.history.generated === null ||
              props.history.generated === props.subject.value ? null : (
                <Button
                  type="button"
                  size="tiny"
                  onClick={() => {
                    props.onReverted(props.history.generated ?? '');
                  }}
                >
                  {WORDS.revertGenerated}
                </Button>
              )}
            </div>
            {error === null ? null : (
              <p role="alert" className="text-sm text-danger-ink">
                {error}
              </p>
            )}
            <Fine>
              {/* The disclosure [10 §11.2] asks for, at the moment it is true
                  rather than in a panel somebody has to go and find. */}
              {props.history.generated === null
                ? 'Nothing here was model-written.'
                : 'This field was model-written. Editing it marks it as reviewed.'}
            </Fine>
          </div>
        </div>
      ) : null}
    </>
  );
}

/**
 * ***The sentence for an answer that was not put in, because a restore replaced
 * the form it was written for*** (2026-09-27) — see `ObjectEditor.replacements`.
 */
export function supersededSentence(): string {
  return WORDS.superseded;
}

/**
 * ***The sentence for a failed assist, read off the code the server sent***
 * (2026-09-27).
 *
 * This read `body.error`, which an `ApiError` does not have — the class is
 * `code` — so every failure, an unbound role included, read *the assist did
 * not finish*. An endpoint's failure now gets the remedy a failed turn gets
 * ([P11.6]'s sentences), and a window with no room beside the reply gets its
 * own, because each points at a different thing to change.
 */
export function assistFailure(failure: unknown): string {
  const code = failure instanceof ApiError ? failure.code : null;
  if (code === 'not-bound') return WORDS.notBound;
  if (code === 'no-answer') return WORDS.noAnswer;
  if (code === 'cancelled') return WORDS.stopped;
  if (code === 'window-too-small') return remedySentence('window-too-small') ?? WORDS.failed;
  if (code === 'provider-failed' && failure instanceof ApiError) {
    return remedySentence(failure.remedy ?? null) ?? WORDS.failed;
  }
  return WORDS.failed;
}
