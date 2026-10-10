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

  const options = open ? props.optionsFor(term) : [];
  const activeOption = options[active];
  const spoken = (value: string): string => props.nameOf?.(value) ?? value;

  function announce(text: string): void {
    // A trailing space alternates, so the same sentence twice still changes the
    // node and is still read out.
    setAnnouncement((previous) => (previous === text ? `${text} ` : text));
  }

  function commit(value: string): void {
    const trimmed = value.trim();
    if (trimmed === '') return;
    if (props.values.includes(trimmed)) {
      // Already carried. Cleared rather than left standing, so the box does not
      // sit there holding a word that will never become a chip.
      setTerm('');
      announce(`${spoken(trimmed)} is already here.`);
      return;
    }
    props.onChange([...props.values, trimmed]);
    setTerm('');
    setActive(0);
    announce(`Added ${spoken(trimmed)}. ${String(props.values.length + 1)} in the list.`);
  }

  function remove(value: string): void {
    props.onChange(props.values.filter((each) => each !== value));
    announce(`Removed ${spoken(value)}.`);
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
          {props.values.map((value) => (
            <li key={value}>
              <span className="inline-flex items-center gap-1">
                {props.renderToken(value)}
                <button
                  type="button"
                  aria-label={removeLabel(spoken(value))}
                  className="rounded-control px-1 text-ink-faint hover:text-ink"
                  onClick={() => {
                    remove(value);
                    inputRef.current?.focus();
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
          aria-expanded={open}
          aria-controls={listboxId}
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

        {open && options.length > 0 ? (
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
