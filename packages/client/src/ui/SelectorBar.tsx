// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { useState, type JSX, type MouseEvent } from 'react';

/**
 * The bar that narrows a list to some of its kinds — the Library's kinds, Play's
 * modes, and whichever surface grows a list of two sorts of thing next.
 *
 * **One control on every surface, and the sameness is the feature.** The
 * Library's kind filter was a row of links written into `LibraryPage`; Play
 * needed the same row the day there were two modes to list sessions by. Two
 * rows that look alike and answer a click differently teach a person that
 * neither can be predicted, so the row moved here and both pages render it.
 *
 * **A plain click switches; adding to the selection is the secondary path.**
 * Picking one kind is what nearly every visit wants, so it costs one click and
 * nothing to learn. Several at once is for the surface where it matters —
 * sessions of two modes side by side — and is offered two ways because no one
 * way reaches everybody:
 *
 * - **Ctrl-click (⌘-click)**, the convention every file browser has taught.
 *   It takes that gesture away from *open in a new tab* on these links, which
 *   is the trade that was chosen; **middle-click still opens a tab**, because
 *   that is an `auxclick` and this never sees it, and shift-click still opens a
 *   window.
 * - **The *Select several* toggle**, for a touch screen that has no Ctrl and a
 *   person who has never heard of the convention. While it is on, a plain click
 *   adds or removes.
 *
 * **Every selection is still an address.** The chips are links whose `href` is
 * the single-option view — which is what a plain click goes to, and what a
 * middle-click opens — and the page is told the selection rather than keeping
 * one, so a filtered view is bookmarkable the way the kind filter always was.
 *
 * **Router-agnostic on purpose.** The page supplies the `href` and does the
 * navigating: the bar has no business knowing which route it sits on or how
 * that route spells its search params, and a component importing the router's
 * `Link` would be a component every test has to build a router for.
 */

export interface SelectorOption<T extends string> {
  value: T;
  label: string;
}

/**
 * The selection after a toggle.
 *
 * **Two collapses, both to `[]`, and both are about one view having one
 * address.** Removing the last option leaves nothing selected, and *nothing* is
 * not an empty list on screen — it is *All*, which is what the chip that clears
 * the selection already means. Selecting every option is *All* by another name,
 * and letting it stand would give the unfiltered view two URLs.
 *
 * Kept in the order of `all`, not of clicking, so the address a selection
 * produces does not depend on the order it was built in.
 */
export function toggleSelection<T extends string>(
  selected: readonly T[],
  value: T,
  all: readonly T[],
): T[] {
  const next = new Set(selected);
  if (next.has(value)) next.delete(value);
  else next.add(value);
  const ordered = all.filter((candidate) => next.has(candidate));
  return ordered.length === all.length ? [] : ordered;
}

/**
 * The href for a selection: the path alone for *All*, a comma-joined search
 * param otherwise.
 *
 * **Comma-joined rather than an array param**, because the router serialises an
 * array as JSON, and `?kind=%5B%22actors%22%5D` is an address nobody can read
 * or type. A single value is spelled exactly as the one-kind filter always
 * spelled it, so every link saved before multi-select still means what it did.
 */
export function selectionHref(path: string, key: string, values: readonly string[]): string {
  if (values.length === 0) return path;
  return `${path}?${new URLSearchParams({ [key]: values.join(',') }).toString()}`;
}

const CHIP_ACTIVE = 'rounded-md bg-accent px-3 py-1 text-sm font-medium text-on-accent';
const CHIP_IDLE =
  'rounded-md border border-line-strong bg-surface px-3 py-1 text-sm text-ink-muted hover:bg-surface-muted';
const TOGGLE_ON = 'rounded-md border border-accent px-3 py-1 text-sm text-ink';
const TOGGLE_OFF =
  'rounded-md border border-dashed border-line-strong px-3 py-1 text-sm text-ink-subtle hover:bg-surface-muted';

export function SelectorBar<T extends string>(props: {
  /** The landmark's name — *Filter by kind*, *Filter by mode*. */
  label: string;
  /** The chip that clears the selection — *All kinds*, *All sessions*. */
  allLabel: string;
  options: readonly SelectorOption<T>[];
  /** `[]` is *All*. */
  selected: readonly T[];
  hrefFor: (next: readonly T[]) => string;
  onChange: (next: T[]) => void;
}): JSX.Element | null {
  /**
   * **Local state, not the URL**: whether a click adds or switches is how
   * somebody is using the control right now, not a place they are in, and a
   * link shared from a phone should not arrive on a desktop with every click
   * behaving differently.
   *
   * *On to begin with when the address already holds several*, so a person
   * landing on a multi-selection sees the mode that explains it. Turning it off
   * leaves the selection alone — the next plain click narrows it, the same as
   * after a Ctrl-click.
   */
  const [several, setSeveral] = useState(() => props.selected.length > 1);

  // Nothing to pick between — `InputKind`'s rule. A bar offering *All* and one
  // other chip that shows the same list is a control that cannot do anything.
  if (props.options.length < 2) return null;

  const all = props.options.map((option) => option.value);
  const single = props.selected.length <= 1;

  function follow(event: MouseEvent<HTMLAnchorElement>, next: () => T[]): void {
    // Shift- and Alt-click are the browser's (new window, download); leave them
    // to it. Middle-click never arrives here at all.
    if (event.button !== 0 || event.shiftKey || event.altKey) return;
    event.preventDefault();
    props.onChange(next());
  }

  return (
    <nav aria-label={props.label} className="mb-6 flex flex-wrap items-center gap-2">
      <a
        href={props.hrefFor([])}
        aria-current={props.selected.length === 0 ? 'page' : undefined}
        className={props.selected.length === 0 ? CHIP_ACTIVE : CHIP_IDLE}
        onClick={(event) => {
          follow(event, () => []);
        }}
      >
        {props.allLabel}
      </a>
      {props.options.map((option) => {
        const active = props.selected.includes(option.value);
        return (
          <a
            key={option.value}
            href={props.hrefFor([option.value])}
            /**
             * `page` when this chip *is* the view, `true` when it is one of
             * several that make it up — [ARIA]'s distinction between the current
             * page and the current item of a set, which is exactly the
             * difference a screen reader user needs to hear.
             */
            aria-current={active ? (single ? 'page' : 'true') : undefined}
            className={active ? CHIP_ACTIVE : CHIP_IDLE}
            onClick={(event) => {
              follow(event, () =>
                several || event.ctrlKey || event.metaKey
                  ? toggleSelection(props.selected, option.value, all)
                  : [option.value],
              );
            }}
          >
            {option.label}
          </a>
        );
      })}
      <button
        type="button"
        aria-pressed={several}
        title="Or Ctrl-click (⌘-click) a chip"
        className={several ? TOGGLE_ON : TOGGLE_OFF}
        onClick={() => {
          setSeveral((on) => !on);
        }}
      >
        Select several
      </button>
    </nav>
  );
}
