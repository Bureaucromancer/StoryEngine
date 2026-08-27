// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

/**
 * The class lists, spelled once.
 *
 * Most of the appearance layer is components — `Button`, `Alert`, `Badge` and
 * the rest of this directory — because a component can own behaviour and ARIA
 * as well as a look. This file is the remainder: the two places where wrapping
 * the element would cost more than naming its classes.
 *
 * **Links**, because TanStack Router owns the element. `Shell.tsx` already
 * hands classes to it through `activeProps={{ className }}`, and a wrapper
 * around `<Link>` would have to re-export its generic route typing to gain
 * nothing.
 *
 * **Table cells**, because `HistoryPanel.test.tsx` reads `row.querySelector('code')`
 * and `rows[0].querySelectorAll('td')`. A `Table` root is safe; a `<Td>` that
 * renders anything other than a bare `td` is a test failure waiting for whoever
 * adds a wrapper to it later.
 *
 * Two rules hold here, both enforced rather than remembered
 * (`eslint.config.js`, the `packages/client/src/ui/**` block):
 *
 * - **One string literal per entry, never joined with `+`.** The assembly rule
 *   cannot tell a class list from a sentence — `rounded border` is two plain
 *   words in a row — so a join reports as untranslatable prose, with advice
 *   about word order that is not what is wrong.
 * - **Semantic tokens only, never a palette scale.** `bg-surface`, not
 *   `bg-white`. The palette lives in `index.css` and nowhere else, which is
 *   what lets a second theme redefine it.
 *
 * Position is not appearance: a margin belongs at the call site, so nothing
 * here carries one — except the page columns, whose `mx-auto` is not a
 * position among siblings but the column itself.
 */

export const link = {
  /** Inside prose, or under a heading. */
  inline: 'text-sm text-ink-subtle underline hover:text-ink',
  /**
   * A link that is the primary action on its surface — "Edit" on an object
   * page. It is a navigation, so it must stay an `<a>`: a `<Button>` here would
   * cost the middle-click, the open-in-new-tab and the status-bar preview that
   * a person reasonably expects from something that changes the address. It
   * therefore borrows the button's look rather than the button.
   */
  action:
    'rounded-control bg-accent px-3 py-1 text-sm font-medium text-on-accent hover:bg-accent-hover',
  /** The object name in a library row — the primary target in its line. */
  object: 'font-medium text-ink underline decoration-line-strong hover:decoration-ink-subtle',
  /** Back to the surface above this one. */
  back: 'text-sm text-ink-subtle underline hover:text-ink',
} as const;

/**
 * The shell's primary navigation, which is three strings rather than one
 * because TanStack Router picks between them per route.
 */
export const navLink = {
  base: 'rounded-control px-3 py-1 text-sm',
  idle: 'text-ink-muted hover:bg-surface-muted',
  active: 'bg-accent text-on-accent',
} as const;

export const table = {
  root: 'w-full border-collapse text-sm',
  /** The header row's rule sits under it, so the cells carry no border. */
  head: 'border-b border-line-strong text-start',
  th: 'py-2 pe-4 text-start font-medium text-ink-muted',
  row: 'border-b border-line',
  cell: 'py-2 pe-4 align-top',
  /** Denser, for the revision table inside the history panel. */
  thCompact: 'py-1 pe-3 text-start font-medium text-ink-muted',
  cellCompact: 'py-1 pe-3 align-top',
} as const;

/**
 * Every text control in the app, including the one a turn is typed into.
 *
 * **It lives here because three files had spelled it out separately**, and the
 * composer and the guidance box — the two a session spends its time in — were
 * the two the shared `Field` version could not reach. A class list copied is a
 * class list that drifts, and this one drifted into the state below.
 *
 * **The disabled variants are not decoration.** Without them a disabled control
 * is pixel-identical to an enabled one, which reintroduces the exact symptom the
 * palette work removed — a box that does nothing when you type into it — on the
 * same control, in the state the composer holds for the whole of every streaming
 * turn. A report of that reads as a regression of the contrast fix and is a
 * different bug.
 *
 * `disabled:opacity-*` is deliberately not the mechanism: it dims text and
 * border together and can push either below the contrast floor, which is how a
 * fix for this becomes the previous bug. Named tokens instead, so
 * {@link ../ui/contrast.test.ts} can measure them.
 */
export const control =
  'w-full rounded-control border border-line-strong bg-surface px-3 py-2 text-sm text-ink placeholder:text-ink-faint focus-visible:outline-2 focus-visible:outline-focus disabled:cursor-not-allowed disabled:border-line disabled:bg-surface-muted disabled:text-ink-muted';

/**
 * The two page columns — [P3.−1]'s width settlement, spelled once.
 *
 * The audit found two widths under three spellings: the shell's 56rem three
 * times, and 48rem as both `max-w-reading` and `max-w-3xl`. These are the two,
 * each spelled here and nowhere else. `tooling` is the shell's width —
 * [05 §1.2] names it as the measure the reading column is *against* — and
 * `reading` is the story column's and nothing else's.
 *
 * **Pages own their column; the shell does not wrap the outlet.** The reason
 * is mechanical rather than aesthetic: Play's column must be the scroll
 * container's direct child for its `h-full` to resolve, and an auto-height
 * centering wrapper in between is exactly how the transcript never scrolled.
 * The flex additions a page needs — Play's `flex h-full flex-col` — are
 * layout, and belong at the call site like any other position.
 */
export const page = {
  tooling: 'mx-auto w-full max-w-4xl px-6 py-8',
  reading: 'mx-auto w-full max-w-reading px-6 py-8',
} as const;
