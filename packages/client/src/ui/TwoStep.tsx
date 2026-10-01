// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { useEffect, useId, useRef, useState, type JSX, type ReactNode } from 'react';

import { Button, type ButtonSize, type ButtonVariant } from './Button.js';

/**
 * ***A destructive action asks once, and asks the same way everywhere***
 * (2026-10-01, polish 8).
 *
 * The client had one two-step that worked — `DeleteObject`'s *Move to trash?*
 * — and around it every other removal made its own choice: a lorebook entry
 * asked, an actor's sample, a preset's block, a hook, an entrance and a picture
 * went at the first click, a tag's registry row and every unused tag at once
 * went at the first click with no name on the button, and a story's hook went
 * from the server at the first click. Even the one that asked lost the
 * keyboard: the button you pressed is replaced by the question, so focus fell
 * to the page and a screen reader heard nothing at all.
 *
 * So this is the one way, and it does three things the copies did not:
 *
 * - **The keyboard moves to Cancel**, the harmless answer, for the same reason
 *   `DeleteObject` puts the destructive answer first and Cancel where the
 *   trigger was: a second press that arrives before the eye has caught up lands
 *   on the answer that undoes nothing. Enter twice is not a delete.
 * - **The question is announced by arriving there.** Both answers are
 *   described by it, so a screen reader landing on Cancel says what Cancel
 *   answers. Not a live region: one inserted already holding its text is one
 *   most screen readers never read, and one kept mounted and empty until it
 *   asks would put a live region in every row of a table of tags — the first
 *   version of this did, and a page's own status line could no longer be told
 *   from forty silent ones.
 * - **It comes back.** Cancel, or an answer that leaves the trigger standing,
 *   returns focus to the trigger rather than to the top of the page.
 *
 * *Not every confirmation in the app is this one*, deliberately. A restore of a
 * whole install, a backup import over existing data and removing an account ask
 * for more than a second click — a typed word, or a dialog that names what goes
 * — because they cannot be undone from inside the app. This is for the kind a
 * second click is the right price for: the editor's removals, which nothing
 * writes until Save and history keeps the version before; a move to the trash;
 * a registry row that loses no data; a hook taken out of one story.
 */
export function TwoStep(props: {
  /** The trigger's words — *Remove*, *Delete*, *Prune 3 unused*. */
  label: string;
  /**
   * The trigger's accessible name, when its words alone do not say what it
   * acts on: eight buttons called *Remove* in a table are a list nobody can
   * choose from.
   */
  name?: string;
  /** The question, as a sentence: *Remove this entry from the book?* */
  question: string;
  /** The answer's words; the trigger's when not given. */
  confirm?: string;
  /**
   * What the answer does. A promise keeps the answer disabled until it settles,
   * so a slow write cannot be sent twice.
   */
  onConfirm: () => unknown;
  disabled?: boolean;
  size?: ButtonSize;
  /** The trigger's look. The answer is always `danger`: it is the destructive one. */
  variant?: ButtonVariant;
  /** Said beside the question — what uses the thing, what is kept. */
  aside?: ReactNode;
  /** When the question opens — to clear a message the last attempt left. */
  onAsk?: () => void;
  /** Position only. */
  className?: string;
}): JSX.Element {
  const [asking, setAsking] = useState(false);
  const [settling, setSettling] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const cancel = useRef<HTMLButtonElement>(null);
  /** Whether closing the question should hand focus back to the trigger. */
  const returning = useRef(false);
  const mounted = useRef(true);
  const questionId = useId();

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    if (asking) {
      cancel.current?.focus();
    } else if (returning.current) {
      returning.current = false;
      trigger.current?.focus();
    }
  }, [asking]);

  const close = (): void => {
    returning.current = true;
    setAsking(false);
  };

  const answer = (): void => {
    const result = props.onConfirm();
    if (result instanceof Promise) {
      setSettling(true);
      void result
        .catch(() => undefined)
        .finally(() => {
          if (!mounted.current) return;
          setSettling(false);
          close();
        });
      return;
    }
    close();
  };

  const classes = 'inline-flex flex-wrap items-center gap-2';
  return (
    <span className={props.className === undefined ? classes : `${props.className} ${classes}`}>
      {asking ? (
        <>
          <span id={questionId} className="text-sm text-ink-subtle">
            {props.question}
          </span>
          {props.aside}
          {/* The answer first and Cancel last: Cancel lands where the trigger
              was, so the pixels the question was asked from are the harmless
              ones. */}
          <Button
            type="button"
            variant="danger"
            size={props.size ?? 'compact'}
            disabled={settling}
            aria-describedby={questionId}
            onClick={answer}
          >
            {props.confirm ?? props.label}
          </Button>
          <Button
            ref={cancel}
            type="button"
            variant="quiet"
            size={props.size ?? 'compact'}
            aria-describedby={questionId}
            onClick={close}
          >
            Cancel
          </Button>
        </>
      ) : (
        <Button
          ref={trigger}
          type="button"
          variant={props.variant ?? 'secondary'}
          size={props.size ?? 'compact'}
          disabled={props.disabled}
          aria-label={props.name}
          onClick={() => {
            props.onAsk?.();
            setAsking(true);
          }}
        >
          {props.label}
        </Button>
      )}
    </span>
  );
}
