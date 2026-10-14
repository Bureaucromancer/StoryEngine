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
 *
 * *(2026-10-13, [P12A](../../../../docs/design/workplan/35-p12a-the-look.md)
 * P12A.6: on the motion tokens — `respond` for its length and `swap` for its
 * curve, which are the 150ms and the curve it took from Tailwind's defaults
 * before, so nothing on screen changes. What changes is that it is spelled the
 * way every motion in this file is, naming what it spends, and that the
 * reduced-motion block reaches it by name rather than through the default it
 * used to ride. A row that comes up under the pointer answers something the
 * person just did, which is what `respond` is for.)*
 *
 * ***The whole reveal, and one per group*** (2026-10-13,
 * [P12A](../../../../docs/design/workplan/35-p12a-the-look.md) P12A.8). It was
 * the hidden state and the touch-screen arm, and each call site added the two
 * arms that bring the row back — under the pointer and on the keyboard —
 * naming its own group. So the paragraph above had half come true again: four
 * call sites, three group names, and the arms that make the row reachable
 * written at each. They are here now, a string per group, because Tailwind
 * emits only a class it can read whole and a group's name is part of the
 * class; theme.test.ts holds the strings to one recipe that differs in the
 * name alone, and refuses an arm that reveals on hover anywhere but here.
 *
 * ***And a row nobody can see takes no tap*** — the hybrid device the second
 * paragraph keeps the quiet version for. A laptop with a touchscreen answers
 * *yes* to `(hover: hover)`, so the row is transparent there, and a finger
 * that landed on it pressed a control the person could not see: Undo, from a
 * tap meant for the line above it. So the hidden row ignores the pointer —
 * `pointer-events` off at rest, on wherever the row is shown — and the tap
 * goes through to the turn beneath, which a touch screen reports as hovered
 * until the next tap lands elsewhere: the first tap shows the row and the
 * second presses what it shows. A mouse is never told the difference, since
 * the turn is hovered before the pointer reaches the row; and the keyboard is
 * not touched by `pointer-events` at all.
 */
export const reveal = {
  /** The per-turn gestures under a turn of the transcript. */
  turn: 'pointer-events-none opacity-0 transition-opacity duration-respond ease-swap group-hover/turn:pointer-events-auto group-hover/turn:opacity-100 group-focus-within/turn:pointer-events-auto group-focus-within/turn:opacity-100 [@media(hover:none)]:pointer-events-auto [@media(hover:none)]:opacity-100',
  /** A chat line's gestures — the player's line and each message. */
  line: 'pointer-events-none opacity-0 transition-opacity duration-respond ease-swap group-hover/line:pointer-events-auto group-hover/line:opacity-100 group-focus-within/line:pointer-events-auto group-focus-within/line:opacity-100 [@media(hover:none)]:pointer-events-auto [@media(hover:none)]:opacity-100',
  /** A lorebook entry's reorder arrows. */
  entry:
    'pointer-events-none opacity-0 transition-opacity duration-respond ease-swap group-hover/entry:pointer-events-auto group-hover/entry:opacity-100 group-focus-within/entry:pointer-events-auto group-focus-within/entry:opacity-100 [@media(hover:none)]:pointer-events-auto [@media(hover:none)]:opacity-100',
} as const;

/**
 * ***A room change is a fade*** — the backdrop's crossfade (2026-10-13),
 * [10 §2.3](../../../../docs/design/10-ui-surfaces.md), built at
 * [P12A](../../../../docs/design/workplan/35-p12a-the-look.md) P12A.2 and the
 * first of the five motions P12A.6 names *(2026-10-14, P12A.6, after review:
 * the first built, and the fourth in 10 §1.3's order — a scene changing)*.
 *
 * *"It does not animate a transition the reader has to wait through. A room
 * change is a fade, not an event."* So a new picture arrives **over** the one
 * it replaces, which stays fully drawn underneath until the next change: the
 * stage is never empty between two rooms, and nothing has to fade *out* — a
 * fade-out would need an end event to clean up after, and a transition whose
 * duration is zero fires none.
 *
 * **`arrive` and `swap`, the tokens P12A.0 named for this**: `arrive` because
 * the person did not cause the picture (the story moved, or they chose it in a
 * dialog that has closed), and `swap` because neither end of a crossfade is an
 * arrival — one state is handed to another in place. The duration is zeroed
 * by `index.css`'s reduced-motion block, so for someone who has asked for less
 * motion the new picture is simply there once its pixels are: *absent, not
 * fast*, which is what T5 walks.
 *
 * *Three strings, because the layer holds two states*: `waiting` until the
 * picture's bytes have arrived — an image fading in before it has decoded
 * fades in nothing and then pops — and `shown` after. `picture` is on both.
 * Here and not at the call site for `reveal`'s reason: a hidden state and a
 * motion are each spelled in this file and nowhere else, and theme.test.ts
 * refuses either written elsewhere.
 */
export const crossfade = {
  picture: 'transition-opacity duration-arrive ease-swap',
  waiting: 'opacity-0',
  shown: 'opacity-100',
} as const;

/**
 * ***A turn arriving*** (2026-10-13) — the first motion
 * [10 §1.3](../../../../docs/design/10-ui-surfaces.md) names, built at
 * [P12A](../../../../docs/design/workplan/35-p12a-the-look.md) P12A.6, where
 * the backdrop's crossfade above is the fourth.
 *
 * **Only the turn this page watched finish wears it**, and that is the design
 * rather than a detail of it. `starting:` is CSS's `@starting-style`, which
 * applies to an element's first style and to nothing after, so the motion is
 * a mount's — and a page opening mounts every turn of the story at once.
 * Spent by every turn, a forty-turn session would open as forty paragraphs
 * rising out of nothing: an event to wait through on the one occasion
 * somebody came to read. So `PlayPage` hands it to the one turn the reducer
 * saw go from running to finished (`PlayState.arrived`), and to no turn that
 * was there already — a turn whose stream had ended before the page opened
 * among them, though its frames are replayed to the page.
 *
 * **A fade and a short rise.** The story grows at its end, so what is new
 * comes up from below into its place; a quarter of a rem is enough to be seen
 * arriving and not enough to move the line somebody is reading by more than a
 * hair. `arrive` and `ease-arrive`, which `index.css` names for exactly this —
 * it starts at once and comes to rest. Under reduced motion the duration is
 * zero, and the turn is simply there.
 *
 * *What it lands on*: the live turn leaves at `turn.finished`, and the
 * record's turn comes with the transcript's refetch a round trip later, so a
 * reply that streamed is gone for that moment and then fades back in as the
 * record, its player's line above it for the first time. The gap is older
 * than this — the turn used to pop back — and P12A §2's record says why it is
 * left.
 */
export const arrival =
  'transition duration-arrive ease-arrive starting:translate-y-1 starting:opacity-0';

/**
 * ***The streaming state*** (2026-10-13) — P12A.6: a dot in the status line's
 * own ink, breathing from Send until the turn is over.
 *
 * Beside *Waiting for the first words…* while nothing has come, and alone on
 * that line once words are arriving — because a stream that pauses, between
 * two steps or while a model thinks, looked exactly like one that had
 * finished: the words stop either way, and the only sign left was Stop where
 * Send had been. [polish §11](../../../../docs/design/workplan/06-polish.md)'s
 * bar holds: it says the engine is busy, which the server does report, and
 * claims no progress, which it does not.
 *
 * **It loops, so it is the one motion here whose reduced-motion arm is not a
 * zeroed duration.** `animate-busy` reads `--animate-busy`, and the
 * reduced-motion block in `index.css` sets that to `none` — so for someone who
 * has asked for less motion the dot is drawn and holds still: the motion
 * absent, not a slower one. theme.test.ts holds the recipe to a token that
 * block stills. The shape is here with the motion because the two are one
 * element spelled once, and `bg-current` makes it the line's ink in both
 * themes without a colour of its own.
 */
export const busy = 'inline-block size-2 shrink-0 rounded-full bg-current animate-busy';

/**
 * ***A panel or sheet entering*** (2026-10-13) — P12A.6: `ui/Dialog` with its
 * scrim, `ui/Popover` in both its places, the workbench and the assistant,
 * each fading in where it belongs.
 *
 * **A fade and nothing else**, unlike a turn. A panel opens in its own place —
 * centred, under its trigger, docked at the edge — and one that slid toward
 * that place would claim to have come from somewhere else. `arrive`, because a
 * panel opening is something new coming into view, which is the occasion
 * `index.css` names it for; on `Dialog`'s scrim rather than its card, so the
 * two fade as one.
 *
 * **Leaving does not move, deliberately.** Each of these unmounts when it
 * closes — `Popover`'s `under` arm is hidden instead — and a fade out needs
 * the element kept in the tree until the fade has ended: a timer, or a
 * `transitionend` that a zeroed duration never fires, which is why
 * `index.css`'s reduced-motion block forbids waiting on one. A panel somebody
 * dismissed should be gone when they dismiss it.
 *
 * `@starting-style` applies when an element goes from undrawn to drawn as
 * well as when it is made, so the popover that is hidden rather than unmade
 * fades in on every opening, as the rest do on every mount.
 */
export const enter = 'transition-opacity duration-arrive ease-arrive starting:opacity-0';

/**
 * ***On a phone, a panel is a sheet*** (2026-10-13) —
 * [10 §1.3](../../../../docs/design/10-ui-surfaces.md)'s first phone rule,
 * *sheets rather than shrunken panels*, built at
 * [P12A](../../../../docs/design/workplan/35-p12a-the-look.md) P12A.8 for
 * `ui/Popover` in both its places.
 *
 * A panel anchored where it was opened is the right shape on a desk and the
 * wrong one at a phone's width: a mention's card is a fixed width from the
 * mark, so a mark near the end of a line pushed it past the screen's edge
 * (P12A.3 left that for this stage), and a strip item's panel opened at the
 * top of the column, a stretch of thumb away from where a phone is held.
 * **Below the `sm` breakpoint** — `max-sm:`, the codebase's one spelling of
 * *a phone*, beside the backdrop's and the dock's — the panel leaves its
 * anchor for the bottom edge of the screen, the screen's full width, as tall
 * as it needs up to seven-tenths of the screen and scrolling inside itself,
 * its scroll kept from running on into the page behind it, square at the
 * bottom where the screen's edge is and ruled only along its top.
 *
 * **The stylesheet's, not a script's.** Nothing about the panel changes but
 * where it is drawn: the same element in the same place in the document, so
 * Tab still leaves it in reading order and the four ways it closes are the
 * four they were. A script asking the width would have to keep asking as a
 * phone turns, and would carry a second copy of the breakpoint; a media query
 * is asked by the browser on every frame, and is Tailwind's own. *Fixed*
 * positioning is what takes it out of the transcript's scroller, which clipped
 * a mention's card on any width — so long as nothing between it and the page
 * transforms or filters, which would trap it; the transcript's arrival is the
 * one transform, and it holds for the length of a fade.
 *
 * *No scrim*, because the popover is not modal: the page above the sheet is
 * still the page, a press there still closes it, and dimming it would say
 * otherwise. *No slide*: `enter`'s paragraph says why a panel fades where it
 * is drawn, and the bottom of the screen is where this one is drawn.
 */
export const sheet =
  'max-sm:fixed max-sm:inset-x-0 max-sm:top-auto max-sm:bottom-0 max-sm:mt-0 max-sm:w-auto max-sm:max-h-[70dvh] max-sm:overflow-y-auto max-sm:overscroll-contain max-sm:rounded-b-none max-sm:border-x-0 max-sm:border-b-0';

/**
 * ***A press acknowledged*** (2026-10-13) — P12A.6, the fifth motion, and
 * the first word of the vocabulary:
 * [polish §11](../../../../docs/design/workplan/06-polish.md)'s *something
 * happens between Send and the first token*, whose bar is **acknowledgement,
 * not progress**.
 *
 * A button goes down a pixel under the pointer or the key and comes back up
 * when it is let go — the control's own answer to being pressed, before its
 * label turns to *Sending…* and the status line starts to breathe. `respond`,
 * because the person just did this; `swap`, because neither end of a press is
 * an arrival.
 *
 * **Spent by `ui/Button`, so every ~~button~~ *`ui/Button`* presses and not
 * Send alone.** A press answered on one button teaches that the others did not
 * register, and polish §11 put Send's busy state in `ui/` rather than at its
 * call site for a reason that holds more strongly for a pressed state, which
 * no button lacks. **`enabled:`**, because a disabled Send that went down
 * under a press would acknowledge a press that does nothing — the false answer
 * §11 removed when it stopped Send being live for the length of the post. A
 * link drawn as a button (`link.action`) does not press: it is a navigation,
 * and the page changing is its answer. Under reduced motion the press is still
 * drawn, down for as long as it is held, and simply does not travel.
 *
 * *(2026-10-14, P12A.6, after review: **every `ui/Button`, and not every
 * button.** The `<button>`s drawn by hand do not spend it yet — `ui/Popover`'s
 * trigger, and with it every item of the HUD strip; `play/InputKind`'s
 * toggles, which sit beside Send; `play/ContextMeter`; `play/ChooseBackdrop`'s
 * tiles; `play/Portrait`; `ui/SelectorBar`; and others in the editors, the
 * library and the tag manager. Spending it on them is left open rather than
 * done in passing: spent in `Popover` itself it would reach the prose too,
 * since `MentionOverlay` makes each mention the trigger of the same Popover,
 * and a word of the story that went down under a press is a different
 * decision from a button that does.
 * [P12A](../../../../docs/design/workplan/35-p12a-the-look.md) §2 records it
 * as a stated limit.)*
 */
export const press =
  'transition-transform duration-respond ease-swap enabled:active:translate-y-px';

/**
 * ***An item of the HUD strip*** (2026-10-13) —
 * [10 §1.3](../../../../docs/design/10-ui-surfaces.md)'s *"a strip of widgets
 * you can edit in place"*, built at
 * [P12A](../../../../docs/design/workplan/35-p12a-the-look.md) P12A.4.
 *
 * **A fact first and a control second**, which is the register the strip
 * keeps above the prose: at rest an item reads as a line of muted text — a
 * label in the faintest ink, the value beside it — and only a pointer over it,
 * the keyboard on it or its panel open gives it a ground. *(2026-10-14, after
 * review: the faintest ink **the strip can stand on**, which is `ink-subtle`
 * and not `ink-faint` — `label` says why.)* A button that looked
 * like a button eight times in a row would be the instrument panel
 * [10 §1.1](../../../../docs/design/10-ui-surfaces.md) keeps off a story
 * surface; a line of text that is not obviously pressable is why the ground
 * comes on hover and stays while the panel it opened is open.
 *
 * *`warn` is the one item allowed a ground at rest*: a channel that could not
 * be loaded is the sentence [06 §4.2](../../../../docs/design/06-modes-and-turn-pipeline.md)
 * says must not be missed, so it wears `Alert`'s warning tone, whose pairs the
 * contrast test already measures. Here rather than at the call sites — the
 * health item, an entry, a mode's picture or record, the cast, the goal and
 * the hooks are drawn in six files — so that the strip is one register and not
 * six spellings of it.
 */
export const strip = {
  item: 'flex cursor-pointer items-center gap-1 rounded-control px-1.5 py-0.5 text-start text-ink-muted hover:bg-surface-muted hover:text-ink focus-visible:outline-2 focus-visible:outline-focus aria-expanded:bg-surface-muted aria-expanded:text-ink',
  warn: 'flex cursor-pointer items-center gap-1 rounded-control border border-warn-line bg-warn-surface px-1.5 py-0.5 text-start text-warn-ink focus-visible:outline-2 focus-visible:outline-focus',
  /**
   * The faint word before an item's value — *Time*, *Place*, *Cast*.
   *
   * ***`ink-subtle`, the quietest ink the strip can stand on*** (2026-10-14,
   * after review — it was `ink-faint`). Two grounds rule the faintest step
   * out. **The item's own**: hovered, focused or open, an item is
   * `surface-muted`, and `ink-faint` there is 4.35 to 1 in the light theme,
   * under the floor on the very ground that says *this is the one you are
   * on*. **And the backdrop's veil**: the strip is the part of Play's column
   * that stays over a picture once [P12A.5](../../../../docs/design/workplan/35-p12a-the-look.md)
   * has moved the configuration panels out, and the veil's 82% was worked
   * out for `ink-subtle` (4.745 to 1 over a black pixel, in light) —
   * `ink-faint` would need it at 99.5%, P12A.2's finding, and is about 3 to
   * 1 there. contrast.test.ts measures `ink-subtle` on `surface-muted` for
   * this, and on the veil already; theme.test.ts refuses `ink-faint` in the
   * strip.
   */
  label: 'text-ink-subtle',
  /**
   * An entry with nothing in it — *not set* — in the label's ink, for the
   * label's two reasons, and set apart from a value by being italic rather
   * than by being fainter.
   */
  unset: 'text-ink-subtle italic',
} as const;

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
 * (~~`--container-reading`~~ *`--container-story`, on the prose — 2026-10-13,
 * P12A.1*) and **chrome** (none). Home takes the first two, for that one
 * block, and none of the third — because it sits beside the workbench and
 * carries a control. So it is a reading column *inside* a tooling column
 * rather than a page that has quietly become a reading surface, and it spells
 * ~~`max-w-reading`~~ *`story` below (2026-10-13, P12A.1)* at its own call
 * site as the layout that is, rather than reaching for this recipe:
 * `reading`'s `mx-auto` and padding are a *page column*, and nesting one
 * inside another is how a measure becomes an indent. The struck sentence was
 * right about the recipe and was read as a claim about the token; this is the
 * distinction it was missing. *(2026-10-13, P12A.1: the measure it spells is
 * the story's now, through `story` below, which carries the step and the face
 * with it. The argument stands — the prose takes a measure and not a page
 * column — and the measure has stopped being a column width at all, for
 * anyone.)*
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
 * ***Story prose: its step, its face and its measure, as one recipe***
 * (2026-10-13) — [P12A](../../../../docs/design/workplan/35-p12a-the-look.md)
 * P12A.1, under §0.4's decision.
 *
 * [10 §1.2] separates the story from the tooling by **type**, **measure** and
 * **chrome**, and two of those three are this string. The step and the face
 * were one separator already, paired by hand at every one of the client's
 * fourteen paragraphs of story and held together by a test that read every
 * class string for the pair. The measure was not on the prose at all: it was
 * the column's width, `page.reading` above, which made it 45em whatever the
 * face — from about ninety to over a hundred and ten characters a line in
 * the stack's serifs, by the measurement `index.css` gives.
 *
 * **The measure moves onto the prose, and that is the reason this is one
 * recipe rather than a third word to remember.** It is `--container-story`,
 * about seventy characters held in `ch` — 55ch, because a `ch` is the zero,
 * and in the stack's serifs the zero is about 1.26 times the average advance
 * of running prose (`index.css` gives each face's figures) — and a `ch` is
 * resolved against the font of the element that carries the `max-width`. On
 * the column, which is set in the interface face, it would count zeros of
 * the sans and set the serif to some other number. On the element that
 * carries `font-story` it counts the face the reader is reading, which is
 * the point of writing the measure in characters at all. A recipe is how the
 * two cannot come apart: the step, the face and the measure are one string,
 * and theme.test.ts refuses any of the three spelled anywhere else.
 *
 * **The column stays the reading column**, 48rem, because the composer and
 * the HUD are in it, and neither is prose: a text box narrowed to the story's
 * measure would be a smaller box to type in for no reader's benefit. So the
 * prose is the narrower thing inside it, and it starts on the column's text
 * line like everything else there — **no centring**, by the rule at the top
 * of this file that a margin belongs at the call site. The title, the turns
 * and the composer keep one start edge, and the room the measure gives back
 * is on the far side.
 *
 * Where the space is already narrower than the cap, it is never reached and
 * costs nothing: Compare's two columns side by side, about 26em each, are
 * under it in every face measured, Liberation Serif's 55ch being the
 * narrowest at 27.5em. **A chat line is capped like any other** once the
 * window gives the column its width: beside its portrait the column leaves
 * about 42.5em, and 55ch is about 30.6em of Charter and 35em of DejaVu
 * Serif, the widest face measured. **The paper is the call site's business,
 * as the column's is**: the reading view releases both for print, because
 * there the page's margins are the measure.
 */
export const story = 'text-story font-story max-w-story';

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
