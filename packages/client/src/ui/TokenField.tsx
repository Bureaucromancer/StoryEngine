// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { useId, useRef, useState, type JSX, type ReactNode } from 'react';

import { control, fieldLabel } from './classes.js';

/**
 * A list of committed values, typed into one at a time — the input half of
 * [05](../../../../docs/design/05-tagging.md), and generic because it knows
 * nothing about tags.
 *
 * **It is a real combobox**, not a text box with a menu drawn under it. The
 * APG editable-combobox-with-listbox pattern, spelled out: the input owns
 * `role="combobox"`, `aria-expanded`, `aria-controls` and
 * `aria-activedescendant`, and the popup is a `listbox` of `option`s that are
 * **never focused**. Focus staying on the input is what `aria-activedescendant`
 * is for, and it is also why the options cannot break the Tab-wrapping of a
 * dialog this field is rendered inside — `useFocusTrap` sweeps for focusable
 * nodes, and there are none in the popup.
 *
 * **Two keys work here that do not work in the surface this imitates.**
 * SillyTavern's tag input requires arrowing onto an option before Enter does
 * anything, so typing a new tag and pressing Enter silently does nothing; and
 * it has no Backspace handling at all, so a chip can only be removed by finding
 * its small `×`. Both are the sort of thing somebody tries once and stops
 * trying, so Enter commits what you typed and Backspace on an empty box removes
 * the last chip.
 *
 * ***Except under `strict`, where Backspace on an empty box moves to the last
 * chip's remove button and does not press it*** (2026-10-10, [P16.2]'s review
 * of the hook editor's id pickers — the paragraph *The hook editor's two
 * pickers take the same fix* in
 * [P16](../../../../docs/design/workplan/35-p16-world.md)). The removal above is
 * safe for a tag because a tag removed by accident can be typed straight back.
 * A strict field's value may be one the field will never offer again — an id
 * that resolves to nothing, kept on purpose and marked *Missing*, or a ref an
 * older picker stored from typed text — and a key held to clear a search ran
 * on into the chips and took it, with no way back short of leaving the editor
 * unsaved. So under `strict` the removal is a press of its own: focus goes to
 * the button, whose name says what it removes, and Backspace, Enter or Space
 * there is the deliberate act. *A held key never reaches it*: the button
 * ignores a repeated Backspace, or the move would be the same accident one
 * auto-repeat later. Nothing is announced on the move — the focused button
 * speaks its own name, which is the only thing worth hearing, and a *Removed*
 * would be untrue.
 *
 * **`optionsFor` is a prop rather than a search this component does**, which is
 * what keeps the policy — which values are offered, how they are matched, what
 * *create* looks like — at the call site beside the other filtering policies,
 * and keeps `library/` out of `ui/`.
 */

/** One row of the popup. `create` marks the one that mints the typed term. */
export interface TokenOption {
  value: string;
  /** Rendered content — a plain string, or marked runs from a matcher. */
  label: ReactNode;
  create?: boolean;
}

export interface TokenFieldProps {
  label: string;
  values: readonly string[];
  onChange: (values: string[]) => void;
  /** The options for a term, already filtered and ordered by the caller. */
  optionsFor: (term: string) => readonly TokenOption[];
  /** How one committed value draws. The caller owns the chip's appearance. */
  renderToken: (value: string) => ReactNode;
  hint?: string | undefined;
  placeholder?: string | undefined;
  /**
   * ***Only an offered option can be committed*** — [P16.2], for a field whose
   * values are ids rather than words.
   *
   * A tag is whatever somebody types, so Enter, a comma and leaving the box all
   * commit the term, and that is the point of this component. An id is not:
   * typed text that became one would be a reference to something called by its
   * own name, resolving to nothing anywhere. So under `strict` the text only
   * narrows the options — Enter commits the active one or nothing, a comma is a
   * character (a name can hold one), and a term left in the box is left there
   * rather than committed on blur.
   *
   * ***And an offered value is committed exactly as given*** (2026-10-10, the
   * review the header's *Except under `strict`* cites). Every commit trimmed,
   * which is right for a word somebody typed and wrong for an id somebody
   * chose: `Id` is unpatterned, so one a hand-edited file holds with a space at
   * either end came back without it — a reference to nothing, announced under
   * the trimmed id, which the hook editor's `pickable` had to map back to what
   * was offered. Under `strict` the typed term is still a search and nothing
   * more: it reaches `optionsFor` as typed, for the caller to trim as its
   * matching wants (`BookScope`'s and the hook editor's do), and is trimmed
   * here only to tell whether anything was typed and for the *Nothing matches*
   * sentence — while the committed value is never touched. A duplicate is the
   * same value byte for byte, so two ids that differ by a space are two ids.
   * Only the empty string is refused, being no id at all (`Id`'s
   * `minLength: 1`).
   *
   * ***And Backspace on an empty box moves rather than removes*** — the
   * header's *Except under `strict`*.
   */
  strict?: boolean | undefined;
  /**
   * How a value is **spoken** — its remove button and the live region — when
   * the value is not a word anybody can hear: an id reads as a string of hex.
   * Absent, the value is its own name, which is right for a tag.
   */
  nameOf?: ((value: string) => string) | undefined;
}

export function TokenField(props: TokenFieldProps): JSX.Element {
  const inputId = useId();
  const listboxId = useId();
  const hintId = useId();
  const optionPrefix = useId();

  const [term, setTerm] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  /**
   * What the live region last said. A string rather than a boolean flag,
   * because the region has to *change* to be announced again — two identical
   * removals in a row would otherwise be announced once.
   */
  const [announcement, setAnnouncement] = useState('');
  const inputRef = useRef<HTMLInputElement | null>(null);
  /** The last chip's remove button — where a strict Backspace moves to. */
  const lastRemoveRef = useRef<HTMLButtonElement | null>(null);

  const options = open ? props.optionsFor(term) : [];
  /**
   * ***Whether a listbox is drawn — the only thing `aria-expanded` and
   * `aria-controls` may say*** (2026-10-10, the review the header's *Except
   * under `strict`* cites). `open` is this field's intent to show the popup,
   * and a term that matches nothing leaves it set with no popup to show: the
   * box said *expanded* over nothing, and `aria-controls` named a listbox id
   * absent from the document. The APG combobox pattern ties `aria-expanded` to
   * the popup being *visible* and says `aria-controls` *"only needs to be set
   * when the popup is visible"*; a reference to an element that is merely
   * hidden is allowed there, but this popup is not hidden when closed, it is
   * not rendered, so the id would point at nothing. `open` stays the state —
   * a term typed on into a match must draw the list without another key — and
   * this is what the box says of it.
   *
   * ***Escape still follows `open`, not this, and that is a known cost***
   * (2026-10-10, the fix's own review). Over a term that matches nothing the
   * first Escape is stopped and closes a popup that was never drawn — so it
   * does nothing anybody can see or hear, while the box already says
   * *collapsed* — and only the second clears the term and reaches a dialog
   * around the field. Keyed on `drawn`, that one press would clear the term
   * *and* close the dialog: the collision the Escape branch's stop exists for,
   * traded for a silent press, and a change to how Escape behaves in a dialog
   * that these three defects did not ask for. The APG's *if the popup is not
   * displayed, optionally clear the textbox* is the shape a repair would take,
   * and is its own decision.
   */
  const drawn = options.length > 0;
  const activeOption = options[active];
  const spoken = (value: string): string => props.nameOf?.(value) ?? value;

  function announce(text: string): void {
    // A trailing space alternates, so the same sentence twice still changes the
    // node and is still read out.
    setAnnouncement((previous) => (previous === text ? `${text} ` : text));
  }

  function commit(value: string): void {
    // Exact under `strict` — the prop's *committed exactly as given*: an
    // offered id is the id, a space at either end and all, and the trimmed one
    // named nothing. A tag is a typed word, and trimmed as it always was.
    const meant = props.strict === true ? value : value.trim();
    if (meant === '') return;
    if (props.values.includes(meant)) {
      // Already carried. Cleared rather than left standing, so the box does not
      // sit there holding a word that will never become a chip.
      setTerm('');
      announce(`${spoken(meant)} is already here.`);
      return;
    }
    props.onChange([...props.values, meant]);
    setTerm('');
    setActive(0);
    announce(`Added ${spoken(meant)}. ${String(props.values.length + 1)} in the list.`);
  }

  function remove(value: string): void {
    props.onChange(props.values.filter((each) => each !== value));
    announce(`Removed ${spoken(value)}.`);
  }

  /**
   * A remove button pressed, by any key or the pointer: the chip goes, and
   * focus returns to the box — so under `strict` the next Backspace is the
   * same two steps again, never a run through the chips.
   */
  function pressRemove(value: string): void {
    remove(value);
    inputRef.current?.focus();
  }

  function close(): void {
    setOpen(false);
    setActive(0);
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLInputElement>): void {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (!open) {
        setOpen(true);
        setActive(0);
        return;
      }
      const count = options.length;
      if (count === 0) return;
      const step = event.key === 'ArrowDown' ? 1 : -1;
      setActive((current) => (current + step + count) % count);
      return;
    }

    if (event.key === 'Home' || event.key === 'End') {
      if (!open || options.length === 0) return;
      event.preventDefault();
      setActive(event.key === 'Home' ? 0 : options.length - 1);
      return;
    }

    if (event.key === 'Enter') {
      /**
       * **Always prevented, whether or not anything is committed.** This field
       * lives inside the editors' `<form onSubmit>`, so an Enter that reached
       * the form would save the actor — which is the wrong thing to happen when
       * somebody has finished typing a tag.
       */
      event.preventDefault();
      if (props.strict === true) {
        // Nothing offered matches what was typed, so there is nothing to
        // commit — said, because a key that does nothing silently is the
        // reference's failure this component exists to avoid.
        if (activeOption === undefined) {
          // *Closed is not empty*: Escape shuts the popup and leaves the term,
          // and with nothing drawn there is no active option — so a term that
          // does match opens the list again rather than being told it matches
          // nothing, which would be the field lying about its own options.
          if (!open && term.trim() !== '' && props.optionsFor(term).length > 0) {
            setOpen(true);
            setActive(0);
            return;
          }
          if (term.trim() !== '') announce(`Nothing matches ${term.trim()}.`);
          return;
        }
        commit(activeOption.value);
        return;
      }
      commit(activeOption?.value ?? term);
      return;
    }

    if (event.key === ',' && props.strict !== true) {
      event.preventDefault();
      commit(term);
      return;
    }

    if (event.key === 'Escape') {
      if (open) {
        /**
         * **Stopped here when it closed the popup.** `useFocusTrap` binds
         * Escape on `document`, so without this one press inside a dialog would
         * close the popup *and* the dialog. The reference surface carries a
         * purpose-built guard for exactly this collision with its colour picker.
         */
        event.stopPropagation();
        close();
        return;
      }
      setTerm('');
      return;
    }

    if (event.key === 'Backspace' && term === '' && props.values.length > 0) {
      event.preventDefault();
      if (props.strict === true) {
        // Moved to, never pressed, and nothing announced — the header's
        // *Except under `strict`*. Leaving the box blurs it, which closes the
        // popup and, being strict, commits nothing.
        lastRemoveRef.current?.focus();
        return;
      }
      const last = props.values[props.values.length - 1];
      if (last !== undefined) remove(last);
      return;
    }

    if (event.key === 'Tab') close();
  }

  return (
    <div>
      <div className="mb-1 flex items-center justify-between gap-2">
        <label htmlFor={inputId} className={fieldLabel}>
          {props.label}
        </label>
        {/* The assist slot every field carries. */}
        <span aria-hidden="true" />
      </div>

      {props.values.length === 0 ? null : (
        <ul className="mb-2 flex flex-wrap items-center gap-1.5">
          {props.values.map((value, index) => (
            <li key={value}>
              <span className="inline-flex items-center gap-1">
                {props.renderToken(value)}
                <button
                  // Only the last chip's: a strict Backspace's one destination.
                  ref={index === props.values.length - 1 ? lastRemoveRef : undefined}
                  type="button"
                  aria-label={removeLabel(spoken(value))}
                  // The app's own focus ring, as `Button` and `control` draw
                  // it: a strict Backspace sends focus here from the box, and
                  // the second press is only deliberate if the move can be
                  // seen. Without it the `×` wore whatever ring the user agent
                  // draws, or none (2026-10-10, the fix's own review).
                  className="rounded-control px-1 text-ink-faint hover:text-ink focus-visible:outline-2 focus-visible:outline-focus"
                  onClick={() => {
                    pressRemove(value);
                  }}
                  onKeyDown={(event) => {
                    // Backspace presses this button as Enter and Space do —
                    // the second, deliberate press after a strict Backspace
                    // moved here. *Never a repeat*, which is a key held since
                    // the box, and the accident the move exists to stop.
                    // *Under `strict` only*: a tag's `×` never took Backspace,
                    // a tag field's Backspace is the box's, and the fix's own
                    // review found this handler had given every tag field a
                    // deletion key it never had (2026-10-10).
                    if (event.key !== 'Backspace' || props.strict !== true) return;
                    event.preventDefault();
                    if (event.repeat) return;
                    pressRemove(value);
                  }}
                >
                  ×
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}

      <div className="relative">
        <input
          id={inputId}
          ref={inputRef}
          role="combobox"
          aria-expanded={drawn}
          aria-controls={drawn ? listboxId : undefined}
          aria-autocomplete="list"
          aria-activedescendant={
            open && activeOption !== undefined ? `${optionPrefix}-${String(active)}` : undefined
          }
          aria-describedby={props.hint === undefined ? undefined : hintId}
          autoComplete="off"
          className={control}
          value={term}
          placeholder={props.placeholder}
          onChange={(event) => {
            setTerm(event.target.value);
            setOpen(true);
            setActive(0);
          }}
          onFocus={() => {
            // Opens on focus with no term, which is what makes the field
            // browsable rather than only searchable.
            setOpen(true);
          }}
          onBlur={() => {
            // A term left in the box is committed rather than discarded: type a
            // tag, click Save, and the tag should be there. Discarding is
            // silent data loss in the exact flow people hit.
            // Not under `strict`, where the term is a search and never a value.
            if (term.trim() !== '' && props.strict !== true) commit(term);
            close();
          }}
          onKeyDown={onKeyDown}
        />

        {drawn ? (
          <ul
            id={listboxId}
            role="listbox"
            className="absolute inset-x-0 z-10 mt-1 max-h-60 overflow-y-auto rounded-panel border border-line-strong bg-surface py-1 shadow-lg"
          >
            {options.map((option, index) => (
              <li
                key={option.value}
                id={`${optionPrefix}-${String(index)}`}
                role="option"
                aria-selected={index === active}
                className={
                  index === active
                    ? 'cursor-pointer bg-surface-muted px-3 py-1.5 text-sm text-ink'
                    : 'cursor-pointer px-3 py-1.5 text-sm text-ink'
                }
                // Before blur, so clicking an option does not first blur the
                // input and commit the raw term instead.
                onMouseDown={(event) => {
                  event.preventDefault();
                }}
                onMouseEnter={() => {
                  setActive(index);
                }}
                onClick={() => {
                  commit(option.value);
                  inputRef.current?.focus();
                }}
              >
                {option.label}
              </li>
            ))}
          </ul>
        ) : null}
      </div>

      {props.hint === undefined ? null : (
        <p id={hintId} className="mt-1 text-xs text-ink-faint">
          {props.hint}
        </p>
      )}

      {/*
       * One region for the whole field — the idiom the reorderable entry list
       * settled on. Two would compete, and a per-chip one would announce
       * nothing at the moment a chip stops existing.
       */}
      <p aria-live="polite" className="sr-only">
        {announcement}
      </p>
    </div>
  );
}

/**
 * Built here rather than in the JSX, because a label spelled
 * `<span>Remove {value}</span>` is a sentence split across children and the
 * assembly rule in `eslint.rules.js` reports it — rightly, since that is also
 * how a translatable string gets cut in half.
 */
function removeLabel(value: string): string {
  return `Remove ${value}`;
}
