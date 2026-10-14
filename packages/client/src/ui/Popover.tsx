// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type FocusEvent as ReactFocusEvent,
  type JSX,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from 'react';

import { enter } from './classes.js';

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
 *
 * ***Two placements, and the second is the HUD strip's*** (2026-10-13,
 * [P12A](../../../../docs/design/workplan/35-p12a-the-look.md) P12A.4). The
 * paragraph above promised *an element prop when it arrives*; the strip is
 * where it arrived, and it needed two things at once, so the prop is a
 * placement rather than a tag. **`beside`** is the mention's card: phrasing
 * content, a `w-64` card anchored at its trigger, as before. **`under`** is a
 * strip item's: flow content — a strip item opens the cast panel, the goal
 * panel's form, the hook panel's rows — in a `<div>`, drawn **under whatever
 * positioned box holds it, at that box's full width**. The wrapper is left
 * unpositioned on purpose, so the panel's containing block is the strip: every
 * item opens to the same place, the column's width, however far along the line
 * its trigger sits — where a card anchored at a trigger near the end of the
 * line would run off the column on a phone, the fault P12A.3 left for P12A.8 on
 * the mention's card. It scrolls itself past most of a screen's height, since
 * the hook panel's rows have no bound.
 *
 * ***And `under` is hidden when closed rather than unmade.*** What a strip item
 * opens is a panel that stood in the column until this stage — the cast, the
 * goal, the hooks — and each was always on the page, a `<details>` keeping its
 * contents while shut. Unmade on every close, the add-a-hook form would drop
 * the title half typed into it when a press landed outside, *You play* would
 * forget a choice not yet pressed, and every open would mount the panel's own
 * read of the session afresh — a stale cache read on mount is a refetch, once
 * per open. So the panel stays, `hidden`, which takes it out of the
 * accessibility tree and the tab order exactly as unmaking it did. *The
 * mention's card is still unmade*: a transcript has a card per mark, and a
 * hidden copy of each would be a second transcript's worth of nodes for
 * nothing anyone typed.
 *
 * ***Held from outside, when the holder needs to be told how it closed***
 * (2026-10-13, P12A.4). `open` and `onOpenChange` make it controlled — the
 * player's face opens the strip's cast item from a line of the transcript, and
 * a strip entry holding a typed value commits it on every close **but
 * Escape**, which is the one that means *never mind*: the paragraph on focus
 * leaving above said a widget holding an unsaved value would have to, and
 * `onOpenChange` is told which of the four ways it was. Uncontrolled, as the
 * mention uses it, nothing changes.
 *
 * ***A close that strands the keyboard hands it to the trigger*** (2026-10-13,
 * P12A.4). A holder may close it itself — a strip entry closes on its own
 * Save — and the control that held the keyboard goes with the panel, leaving
 * focus on nothing or on a control nobody can see, from which the next Tab
 * starts again at the top of the page. So a close the holder made, or the
 * trigger, that leaves focus inside the panel or nowhere gives it to the
 * trigger, as Escape always did. **A press outside and focus leaving are not
 * this**: each put the keyboard somewhere already, which is the paragraph
 * above's rule, and pulling it back would undo what the person did.
 */
export type PopoverChange = 'trigger' | 'escape' | 'outside' | 'focus';

/**
 * The panel's two placements — under a block-level trigger, full width and
 * scrolling within its own height; beside an inline one, a fixed width.
 *
 * ***Quoted constants, not text in the template*** (2026-10-14,
 * [P12A](../../../../docs/design/workplan/35-p12a-the-look.md) P12A.6, after
 * review). Each was a `className="…"` until it began to spend `enter`, and
 * then the list sat in a template literal beside the recipe —
 * `tailwind-utilities.test.ts` reads quoted literals only, so a utility
 * misspelt in either, or a token that does not exist, would have passed the
 * one test that exists to catch it. Quoted, the test reads them again. *Not the bracketed value*: Tailwind emits an arbitrary
 * value whatever its brackets hold, so a unit mistyped inside the first
 * list's maximum height builds a rule and passes, quoted or not — a mutation
 * showed it. (Not spelt out here: the build reads comments too, and the
 * misspelling written as a class would be emitted from this sentence.)
 */
const PANEL_BELOW =
  'absolute inset-x-0 top-full z-10 mt-1 flex max-h-[70dvh] flex-col gap-2 overflow-y-auto rounded-panel border border-line bg-surface p-3 font-ui text-sm text-ink shadow-overlay';
const PANEL_INLINE =
  'absolute start-0 top-full z-10 mt-1 flex w-64 flex-col gap-2 rounded-panel border border-line bg-surface p-3 font-ui text-sm text-ink shadow-overlay';

export function Popover(props: {
  /** What the trigger shows. Its text is the trigger's accessible name. */
  trigger: ReactNode;
  /** The trigger's classes: it looks like whatever it opens from. */
  triggerClassName: string;
  /** The panel's name for a screen reader, as a dialog's heading would be. */
  label: string;
  /**
   * What it opens. Phrasing content for `beside`, drawn only while open; for
   * `under`, drawn always and hidden while closed — see above.
   */
  children: ReactNode;
  /** `beside` its trigger (the default), or `under` the box that holds it. */
  place?: 'beside' | 'under';
  /** Controlled: whether it is open. Absent, it holds its own state. */
  open?: boolean;
  /** Told of every change, and how a close came about. */
  onOpenChange?: (open: boolean, how: PopoverChange) => void;
}): JSX.Element {
  const [own, setOwn] = useState(false);
  const open = props.open ?? own;
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLElement | null>(null);
  const holdPanel = useCallback((node: HTMLElement | null) => {
    panel.current = node;
  }, []);
  const id = useId();

  /**
   * How the last close came about, or `null` for one the holder made — read
   * by the effect below, which hands a stranded keyboard back (see above).
   */
  const closedBy = useRef<PopoverChange | null>(null);
  /**
   * ***The latest holder, read when a change happens rather than when the
   * listener was added.*** The outside-press listener lives as long as the
   * panel is open, and a holder's handler closes over what was typed — a
   * listener holding the handler from the render that opened it would commit
   * the empty value the panel opened with.
   */
  const holder = useRef({ controlled: false, tell: props.onOpenChange });
  useEffect(() => {
    holder.current = { controlled: props.open !== undefined, tell: props.onOpenChange };
  });
  const change = useCallback((next: boolean, how: PopoverChange) => {
    closedBy.current = next ? null : how;
    if (!holder.current.controlled) setOwn(next);
    holder.current.tell?.(next, how);
  }, []);

  const wasOpen = useRef(false);
  useEffect(() => {
    if (!open) {
      const by = closedBy.current;
      if (wasOpen.current && by !== 'outside' && by !== 'focus') {
        const at = document.activeElement;
        const stranded =
          at === null || at === document.body || panel.current?.contains(at) === true;
        if (stranded) trigger.current?.focus();
      }
      wasOpen.current = false;
      closedBy.current = null;
      return;
    }
    wasOpen.current = true;
    const inside = panel.current?.querySelector<HTMLElement>(
      'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled])',
    );
    (inside ?? panel.current)?.focus();

    function onPointerDown(event: PointerEvent): void {
      const target = event.target instanceof Node ? event.target : null;
      if (panel.current?.contains(target) === true || trigger.current?.contains(target) === true) {
        return;
      }
      change(false, 'outside');
    }
    document.addEventListener('pointerdown', onPointerDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
    };
  }, [open, change]);

  const under = props.place === 'under';
  const wrapper = {
    onKeyDown: (event: ReactKeyboardEvent<HTMLElement>) => {
      if (event.key !== 'Escape' || !open) return;
      event.preventDefault();
      event.stopPropagation();
      change(false, 'escape');
      trigger.current?.focus();
    },
    onBlur: (event: ReactFocusEvent<HTMLElement>) => {
      // React's blur bubbles — it is `focusout` underneath — so this hears
      // focus leaving anything inside. Only a real element outside counts as
      // the keyboard's press outside. A `null` `relatedTarget` is left alone:
      // the window losing focus, or Safari's button press that focuses
      // nothing, would otherwise close the card — and a press on the trigger
      // would then open it again. The `pointerdown` listener above already
      // covers presses outside.
      const into = event.relatedTarget;
      if (open && into !== null && !event.currentTarget.contains(into)) change(false, 'focus');
    },
  };
  const button = (
    <button
      ref={trigger}
      type="button"
      aria-haspopup="dialog"
      aria-expanded={open}
      {...(open ? { 'aria-controls': id } : {})}
      className={props.triggerClassName}
      onClick={() => {
        change(!open, 'trigger');
      }}
    >
      {props.trigger}
    </button>
  );
  const dialog = {
    ref: holdPanel,
    id,
    role: 'dialog',
    'aria-label': props.label,
    tabIndex: -1,
  };

  if (under) {
    return (
      <div {...wrapper}>
        {button}
        {/* Hidden rather than unmade — see the docstring's `under` paragraphs. */}
        <div
          {...dialog}
          hidden={!open}
          // Fading in on every opening, though it is never unmade
          // (2026-10-13, P12A.6): `@starting-style` applies on the way from
          // hidden to drawn as well — `enter` in `classes.ts` says the rest.
          className={`${enter} ${PANEL_BELOW}`}
        >
          {props.children}
        </div>
      </div>
    );
  }
  return (
    <span className="relative" {...wrapper}>
      {button}
      {open ? (
        <span {...dialog} className={`${enter} ${PANEL_INLINE}`}>
          {props.children}
        </span>
      ) : null}
    </span>
  );
}
