// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { useEffect, useId, useRef, useState, type JSX, type ReactNode } from 'react';

/**
 * ***The non-modal popover*** — built at
 * [P12A](../../../../docs/design/workplan/35-p12a-the-look.md) P12A.3 for a
 * mention's card, and the one P12A.4's HUD widgets open in place; §0.4 records
 * that there was none in `ui/` and that it is built once, here.
 *
 * **Not `Dialog`, and the difference is the whole component.** `Dialog` is the
 * modal: it traps the keyboard, marks everything behind it inert, and puts a
 * scrim over the page, which is right for a question that must be answered
 * before anything else happens. A mention's card answers nothing — it says who
 * a name was matched to and where to change that — and a HUD value opened to be
 * corrected sits on a story somebody is still reading. So this one is
 * **anchored** to what opened it and scrolls with it, **traps nothing** (Tab
 * leaves it as it leaves any other part of the page, in reading order, since
 * the panel follows its trigger in the document), and **closes four ways**:
 * its trigger again, Escape, a press anywhere outside it, and focus leaving it.
 *
 * ***Focus leaving it is the keyboard's press outside*** (2026-10-14,
 * P12A.3, after review). It closed three ways, and a keyboard user who Tabbed
 * past the last link left the card drawn over the lines below its mark — so the
 * next control they reached could sit under it (WCAG 2.4.11, *focus not
 * obscured*) — and Escape no longer reached it, since the keystroke no longer
 * passed through the wrapper. Only a pointer could close it from there. So focus
 * going to a real element outside the wrapper closes it, as a press there would,
 * and leaves the keyboard where it went. Focus moving *inside* never closes it:
 * from the trigger to the first link on opening, onto the panel itself when its
 * text is clicked, back onto the trigger, whose click then closes it. **A
 * widget that holds an unsaved value** — P12A.4's HUD, when it reuses this —
 * will have to commit on blur, as `TokenField` does, or Tabbing away will drop
 * what was typed.
 *
 * ***Where focus goes, which is the part popovers get wrong.*** Opening hands
 * the keyboard to the first control inside, or to the panel itself when it has
 * none, so the panel's name is announced as focus lands on it and the next
 * keystroke acts in it. **Escape hands it back to the trigger**, because a
 * keyboard user who dismissed the panel is still where they opened it, and the
 * panel's controls are about to stop existing. **A press outside does not move
 * it**: the press already put focus where the person meant it to go — on the
 * control they pressed, or on the page — and pulling it back to the trigger
 * would undo their click.
 *
 * *Escape stops here.* A container that closes on Escape — the workbench —
 * would otherwise close round a popover that was only asked to close itself.
 *
 * ***Phrasing content, because it may open inside a paragraph.*** A mention is a
 * word in a line of the story, and a `<div>` cannot sit in a `<p>`; so the
 * wrapper and the panel are `<span>`s laid out as blocks, and what goes inside
 * must be phrasing content too — text, links, buttons, a face. A widget that
 * needs a form is not in a paragraph, and can grow an element prop when it
 * arrives rather than this guessing at one now.
 *
 * *It sets its own face and size*, `font-ui text-sm`, because a paragraph of
 * story is set in the story's, and a card about the story is tooling.
 */
export function Popover(props: {
  /** What the trigger shows. Its text is the trigger's accessible name. */
  trigger: ReactNode;
  /** The trigger's classes: it looks like whatever it opens from. */
  triggerClassName: string;
  /** The panel's name for a screen reader, as a dialog's heading would be. */
  label: string;
  /** Drawn only while open. Phrasing content — see above. */
  children: ReactNode;
}): JSX.Element {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLSpanElement>(null);
  const id = useId();

  useEffect(() => {
    if (!open) return;
    const inside = panel.current?.querySelector<HTMLElement>(
      'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled])',
    );
    (inside ?? panel.current)?.focus();

    function onPointerDown(event: PointerEvent): void {
      const target = event.target instanceof Node ? event.target : null;
      if (panel.current?.contains(target) === true || trigger.current?.contains(target) === true) {
        return;
      }
      setOpen(false);
    }
    document.addEventListener('pointerdown', onPointerDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
    };
  }, [open]);

  return (
    <span
      className="relative"
      onKeyDown={(event) => {
        if (event.key !== 'Escape' || !open) return;
        event.preventDefault();
        event.stopPropagation();
        setOpen(false);
        trigger.current?.focus();
      }}
      onBlur={(event) => {
        // React's blur bubbles — it is `focusout` underneath — so this hears
        // focus leaving anything inside. Only a real element outside counts as
        // the keyboard's press outside. A `null` `relatedTarget` is left alone:
        // the window losing focus, or Safari's button press that focuses
        // nothing, would otherwise close the card — and a press on the trigger
        // would then open it again. The `pointerdown` listener above already
        // covers presses outside.
        const into = event.relatedTarget;
        if (open && into !== null && !event.currentTarget.contains(into)) setOpen(false);
      }}
    >
      <button
        ref={trigger}
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        {...(open ? { 'aria-controls': id } : {})}
        className={props.triggerClassName}
        onClick={() => {
          setOpen((was) => !was);
        }}
      >
        {props.trigger}
      </button>
      {open ? (
        <span
          ref={panel}
          id={id}
          role="dialog"
          aria-label={props.label}
          tabIndex={-1}
          className="absolute start-0 top-full z-10 mt-1 flex w-64 flex-col gap-2 rounded-panel border border-line bg-surface p-3 font-ui text-sm text-ink shadow-overlay"
        >
          {props.children}
        </span>
      ) : null}
    </span>
  );
}
