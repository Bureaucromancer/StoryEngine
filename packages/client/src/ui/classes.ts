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
  inline:
    'text-sm text-ink-subtle underline hover:text-ink focus-visible:outline-2 focus-visible:outline-focus',
  /**
   * A link that is the primary action on its surface — "Edit" on an object
   * page. It is a navigation, so it must stay an `<a>`: a `<Button>` here would
   * cost the middle-click, the open-in-new-tab and the status-bar preview that
   * a person reasonably expects from something that changes the address. It
   * therefore borrows the button's look rather than the button.
   */
  action:
    'rounded-control bg-accent px-3 py-1 text-sm font-medium text-on-accent hover:bg-accent-hover focus-visible:outline-2 focus-visible:outline-focus',
  /** The object name in a library row — the primary target in its line. */
  object:
    'font-medium text-ink underline decoration-line-strong hover:decoration-ink-subtle focus-visible:outline-2 focus-visible:outline-focus',
  /** Back to the surface above this one. */
  back: 'text-sm text-ink-subtle underline hover:text-ink focus-visible:outline-2 focus-visible:outline-focus',
  /**
   * An anchor *inside* rendered prose — the changelog's links on home, and the
   * reading view's since [P11.1] brought it.
   *
   * **It is `inline` without the size, and that is the whole difference.**
   * `inline` carries `text-sm` because it is used under a heading and beside a
   * control, where there is no surrounding type step to inherit. Prose has one:
   * a `text-story` paragraph sets the size and the leading, and an anchor that
   * reset itself to `text-sm` would be a word a step smaller than the sentence
   * it sits in — visible on every line it wraps, and the kind of wobble nobody
   * can name when they see it.
   *
   * `text-ink` rather than `ink-subtle` for the same reason: dimming a link
   * inside body copy makes it read as less important than the words around it,
   * which is backwards. The underline carries the affordance and the decoration
   * colour carries the hover, which is `object`'s arrangement one step quieter.
   */
  prose:
    'text-ink underline decoration-line-strong hover:decoration-ink-subtle focus-visible:outline-2 focus-visible:outline-focus',
} as const;

/**
 * The shell's primary navigation, which is three strings rather than one
 * because TanStack Router picks between them per route.
 */
/**
 * ***A row of controls that keeps out of the way until you look at it*** — the
 * transcript's per-turn gestures, and the lorebook entry's reorder arrows.
 *
 * **The third variant is the one that had been missing, and it was not a
 * nicety.** Tailwind compiles `hover:` to `@media (hover: hover)`, so on a
 * device with no pointer the hover state is *unreachable* — the row stayed at
 * `opacity-0` for ever while remaining in the tab order and hit-testable. On a
 * phone or a tablet that is Redo, Reroll, Continue from here, Illustrate,
 * Remember this and Undo: every per-turn gesture in the app, invisible, over a
 * transparent strip that still swallows a tap. [10 §1] commits to *"responsive
 * and genuinely usable on a phone"* as the 1.0 bar, and this is the single
 * place that commitment was most obviously not met.
 *
 * `(hover: none)` rather than `(pointer: coarse)`: the question is whether this
 * device can hover at all, not how precise it is. A laptop with a touchscreen
 * has a fine pointer *and* a hover, and should keep the quiet version.
 *
 * Here rather than at the two call sites because it is appearance, and because
 * the two of them had already been written twice — the same string with a
 * different group name, which is how the next one comes to be written a third
 * time with the media query left out again.
 */
export const reveal = 'opacity-0 transition-opacity [@media(hover:none)]:opacity-100';

export const navLink = {
  base: 'rounded-control px-3 py-1 text-sm focus-visible:outline-2 focus-visible:outline-focus',
  idle: 'text-ink-muted hover:bg-surface-muted',
  active: 'bg-accent text-on-accent',
} as const;

/**
 * ***A disclosure's summary, in two registers rather than seven spellings.***
 *
 * There are fourteen `<summary>` elements in this client and they were written
 * seven ways — `text-sm text-ink-subtle`, `text-ink-muted hover:text-ink`,
 * `px-3 py-2 text-sm text-ink`, `text-xs text-ink-muted hover:text-ink`, a bare
 * `cursor-pointer`, and two more. **Half of them had no hover at all**, which
 * is the part that is not cosmetic: a fold that does not respond to a pointer
 * does not read as a thing you can open, and the play column stacks *seven* of
 * them between the heading and the transcript.
 *
 * Two registers, because there genuinely are two: a fold that is a quiet aside
 * inside a panel, and a fold that titles its own region. Size and padding stay
 * at the call site — they are the type step and the layout, and neither belongs
 * to a rule about disclosures.
 */
export const disclosure = {
  /** A quiet aside: Guidance, Lore, the session's own state. */
  quiet: 'cursor-pointer text-ink-muted hover:text-ink',
  /** A fold that names the region it opens: Pictures, Memories, a field group. */
  titled: 'cursor-pointer text-ink hover:text-ink-muted',
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
  /**
   * A number column — token counts, the workbench's block table ([P3.2],
   * this recipe's first consumer). `text-end` is logical and lint-legal;
   * `tabular-nums` keeps a column of counts comparable by eye.
   */
  thNumeric: 'py-1 pe-3 text-end font-medium text-ink-muted',
  cellNumeric: 'py-1 pe-3 text-end align-top tabular-nums',
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
/**
 * The label above a control, and above a **value** — which is the second
 * consumer that moved it here.
 *
 * `Field` had spelled it out for six call sites and named it `LABEL_CLASS`
 * privately; the read-only by-field view ([polish §1]) renders the same label
 * over a rendered value rather than over an input, and *recognisably the same
 * view* is that item's entire design constraint. A private constant copied
 * into a second file would have made the two look alike on the day and drift
 * afterwards.
 */
export const fieldLabel = 'block text-sm font-medium text-ink-muted';
export const control =
  'w-full rounded-control border border-line-strong bg-surface px-3 py-2 text-sm text-ink placeholder:text-ink-faint focus-visible:outline-2 focus-visible:outline-focus disabled:cursor-not-allowed disabled:border-line disabled:bg-surface-muted disabled:text-ink-muted';

/**
 * The two page columns — [P3.−1]'s width settlement, spelled once.
 *
 * The audit found two widths under three spellings: the shell's 56rem three
 * times, and 48rem as both `max-w-reading` and `max-w-3xl`. These are the two,
 * each spelled here and nowhere else. `tooling` is the shell's width —
 * [10 §1.2] names it as the measure the reading column is *against* — and
 * ~~`reading` is the story column's and nothing else's.~~
 *
 * ***The recipe is still the story column's; the measure it is built on is
 * not*** — [home, revised]. Home renders the changelog as prose, and [10 §1.2]
 * says what makes prose prose: **type** (`text-story font-story`), **measure**
 * (`--container-reading`) and **chrome** (none). Home takes the first two, for
 * that one block, and none of the third — because it sits beside the workbench
 * and carries a control. So it is a reading column *inside* a tooling column
 * rather than a page that has quietly become a reading surface, and it spells
 * `max-w-reading` at its own call site as the layout that is, rather than
 * reaching for this recipe: `reading`'s `mx-auto` and padding are a *page
 * column*, and nesting one inside another is how a measure becomes an indent.
 * The struck sentence was right about the recipe and was read as a claim about
 * the token; this is the distinction it was missing.
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
  /**
   * The row a surface's critical controls sit in — the way back up, the
   * primary action, and the destructive one — held against the bottom of the
   * scrollport for as long as there is page left below it.
   *
   * **It began as the editors' Save row** ([10 §11.6]) and became the strip
   * every surface keeps its critical controls in: the editors' *Back to*,
   * Save, History and Delete; the read page's *Back to the library*, Edit and
   * Delete; and the action row of every form on the settings page. One recipe
   * rather than three, because the argument is the same each time — a control
   * reachable only by scrolling past everything it is about is a control that
   * teaches people not to use it — and a second spelling would be a second
   * bar for the eye to learn.
   *
   * **`-mx-6 px-6` is not a margin the call site chose**, which is why it is
   * here with the columns rather than there with the layout. It is exactly the
   * column's own `px-6`, cancelled and re-applied, so that the bar reaches both
   * edges of the column while what is in it stays on the column's text line.
   * The two are one decision — change a column's padding and this is wrong —
   * and that is the same ground the `mx-auto` above stands on. It follows
   * that the element holding it must itself span the column: a settings form
   * that used to be `max-w-md` now constrains its fields in a block of that
   * width and leaves the form, and so the bar, at the column's.
   *
   * `bg-surface` is opacity rather than decoration: the bar floats over the
   * form, and a transparent one renders two lines of text in the same pixels.
   * `flex-wrap` because the strip now holds five things, and a narrow column
   * must fold it rather than push its last control off the edge.
   *
   * It sticks within **whichever element holds it**, against `<main>`, which is
   * the scroll container ([P3.−1]). So it goes last inside the thing it should
   * stay in front of — in the editors, the form: it releases only over the
   * panels below, which is the part of the page a person reads rather than
   * edits. On the read page it goes last in the column, because there the
   * whole page is the object the controls are about.
   */
  actions:
    'sticky bottom-0 z-10 -mx-6 flex flex-wrap items-center gap-3 border-t border-line bg-surface px-6 py-3',
} as const;

/**
 * The same strip, held inside a card — the settings page's *Add someone*, its
 * connection form and its first-run offer, each a form in a bordered box
 * narrower than the column.
 *
 * A card is `p-4` (`Panel`'s recipe, spelled inline by those three because a
 * `Panel` is a `div` and they are forms), so this is `page.actions` with the
 * card's padding cancelled and re-applied in place of the column's. **The
 * bottom padding is cancelled too**, so the strip sits on the card's own edge
 * with corners that follow the card's: a rule floating a padding's height
 * above the border would read as a mistake in the state the strip spends most
 * of its time in, which is released. The negative margin does not stop the
 * pin — sticky constrains the *margin* box to the card, so the border box may
 * reach the card's padding edge and no further, which is exactly the edge it
 * should rest on.
 *
 * Checked in a browser rather than by test, because jsdom computes no layout:
 * pinned, the strip's bottom is the scrollport's; released, it is the card's
 * padding edge.
 */
export const panel = {
  actions:
    'sticky bottom-0 z-10 -mx-4 -mb-4 flex flex-wrap items-center gap-3 rounded-b-panel border-t border-line bg-surface px-4 py-3',
} as const;
