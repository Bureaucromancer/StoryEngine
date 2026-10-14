// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { useState, type JSX } from 'react';
import { createPortal } from 'react-dom';

import type { ModeSurface } from '../api.js';
import { crossfade } from '../ui/classes.js';

/**
 * ***The backdrop, behind the column rather than in it*** —
 * [10 §2.3](../../../../docs/design/10-ui-surfaces.md), built at
 * [P12A](../../../../docs/design/workplan/35-p12a-the-look.md) P12A.2.
 *
 * Until this stage the stage region was drawn by `ModeRegion` like every other
 * region: an `<img>` in the column's flow, above the transcript, with the
 * widget's label as its `alt` — a picture in the column, which is the thing
 * 10 §2.3 says a backdrop is not. Its four bullets are each a property of
 * where the picture is, and none of them can be had in flow:
 *
 * - ***The prose wins.*** The picture fills the window behind everything in
 *   the page, and the reading column is drawn over it on the veil
 *   (`--color-veil`, P12A.0's scrim), whose floor `contrast.test.ts` computes
 *   for every ink the column sets prose in, over the worst pixel either theme
 *   can have behind it. Ink on the column clears 4.5:1 *whatever is behind
 *   it*, which is a test rather than a hope.
 * - ***It is chrome.*** `fixed`, so it does not scroll with the transcript and
 *   cannot push the layout when it changes: it takes no room in the flow at
 *   all. A change is a crossfade (`crossfade` in `ui/classes.ts`), never a
 *   pop and never a wait.
 * - ***Off is a real setting.*** No selection, no layer, no veil: the page is
 *   what it was before the session had a backdrop, to the class. And a
 *   selection whose picture will not load — an object deleted, a file gone —
 *   is treated as off rather than drawn as a broken image (`useStage`).
 * - ***Not a status display.*** Decorative to a screen reader: `alt=""` and
 *   the layer `aria-hidden`. The widget's label (*Scene*) names the region,
 *   not the picture, and a reader told *Scene* on every page learns nothing
 *   about where the story is — which is the location channel's job, and the
 *   strip's.
 *
 * **On a phone it is the first thing to go**: `max-sm:hidden`, the codebase's
 * phone idiom (`Shell.tsx`'s dock, `Workbench.tsx`). Below the breakpoint the
 * column is the whole window and a picture behind it is all cost. ~~The veil
 * needs no phone arm of its own: it is the canvas at 82%, and the canvas over
 * the canvas is the canvas.~~ *(2026-10-13, after review: the veil is painted
 * by `<main>` now, and only from `sm` up, where the layer is — see `veiled`
 * below; under the breakpoint there is nothing for it to veil.)*
 *
 * ***And not fetched there either*** (2026-10-13, after review): **each
 * picture is `loading="lazy"`**, because `max-sm:hidden` stops the drawing and
 * not the download. An eager `<img>` is fetched whether or not it is
 * displayed, so every phone session with a backdrop was downloading each
 * full-size background the story staged or a person chose — a generated or
 * imported picture of several megabytes, over mobile data — and never showing
 * it, which is the cost 10 §2.3 drops the layer to avoid. A lazy picture is
 * fetched when it comes near the viewport, and an element that is not
 * displayed is never near it, so below the breakpoint no bytes move. From `sm`
 * up the layer is the whole window and is in view at once, so it loads as it
 * did; and the crossfade waits for `load` either way, so nothing about the
 * fade changes. *A media-query hook that skipped rendering below `sm` would
 * also do it*, at more code and with a second statement of the breakpoint
 * beside the class — the attribute keeps `max-sm:hidden` the only one.
 *
 * ***Keyed on the region, not on the widget.*** The `image` arm is shared with
 * the message region, where an expression sprite beside a speaker's line is
 * content and keeps its inline `<img>` and its label (`ModeRegion`). The SDK
 * leaves exactly this to the host — *"where a picture goes and how big it is
 * are the region's business"* (`sdk/src/channels.ts`) — so a mode that puts a
 * picture on the stage gets a backdrop, and nothing here names a channel.
 *
 * ***Drawn into `document.body`, not where it is written.*** A `fixed` element
 * is fixed to the window only while no ancestor has a transform, a filter or
 * containment; one that does becomes its containing block, and the layer
 * would then scroll with that ancestor and be clipped by it. The column and
 * `<main>` are exactly where a later stage puts such a thing — P12A.6's
 * motions are transforms and opacity *(2026-10-13, P12A.6, as built: the two
 * transforms are a finished turn's rise and a button's press, inside the
 * column for the length of a transition and never on it or on `<main>`; the
 * portal does not depend on that staying so)* — so the layer is a portal, outside
 * every box the page owns, and behind all of them at `-z-10`: after the
 * canvas, before everything else, so the header, the dock and the footer,
 * each on `bg-surface`, cover it, and ~~the column covers it with the veil~~
 * *(2026-10-13, after review: `<main>` covers it with the veil, in a strip
 * under the column — `veiled` below. `<main>` is `relative`, so it is painted
 * with the positioned boxes, over a layer at `-z-10`)*.
 */

/**
 * The stage region's picture, or `null` — the first `image` widget a mode put
 * on the stage. *The first*, because a backdrop is one picture: a second
 * contribution to the same region would be a second layer behind the same
 * prose, which no mode declares and the design has no place for. A widget of
 * another kind on the stage is skipped, as `ModeRegion` skips an arm it does
 * not know: there is nothing a layer behind the prose could do with a meter.
 */
export function stagePicture(surfaces: readonly ModeSurface[] | undefined): string | null {
  for (const surface of surfaces ?? []) {
    if (surface.region === 'stage' && surface.kind === 'image' && surface.image !== undefined) {
      return surface.image.url;
    }
  }
  return null;
}

/**
 * ***The reading column while a backdrop shows behind it*** — ~~added to
 * `page.reading`~~ *(2026-10-13, after review: spread onto the column as an
 * attribute, below)*, and never otherwise, so a session with no backdrop draws
 * the column exactly as before.
 *
 * - ~~**`bg-veil`**, P12A.0's scrim — each theme's canvas at 82%, the floor
 *   `contrast.test.ts` derives for `ink-subtle`, the player's line, over the
 *   worst pixel a picture can hold. The prose keeps its contrast whatever is
 *   behind it.~~
 * - ~~**`overflow-y-auto`, because a background stops at its box.** The column
 *   is `h-full` — the transcript's own scrolling depends on it — and the
 *   panels above the transcript can be taller than the window (P12A §0.4
 *   counts up to thirteen blocks), so the column's content runs past its box
 *   and `<main>` scrolls it. Without a picture that is invisible; with one,
 *   everything past the first screenful — the composer among it — would be
 *   drawn over the bare picture. So while a backdrop shows, the column
 *   scrolls itself, and everything in it stays on the veil.~~
 * - ~~**`max-sm:overflow-visible`**, because below the breakpoint the layer is
 *   gone and `<main>` can scroll the column as it always has; the veil stays,
 *   and over the canvas it is the canvas.~~
 *
 * ***A marker, and `<main>` paints the veil*** (2026-10-13, after review). The
 * problem the second bullet named was real — a background stops at its box,
 * and the column's box is one screenful tall — but a column that scrolls
 * itself was the wrong answer to it, twice over:
 *
 * - ***It made a second scroller, and the first one kept scrolling.*** An
 *   absolutely positioned descendant belongs to its nearest *positioned*
 *   ancestor, and a scroll container that is not one neither clips nor
 *   scrolls it. Every `sr-only` label in the column — the composer's among
 *   them — was still `<main>`'s, sat at its static position below the fold,
 *   and gave `<main>` a scroll range of its own: two scrollbars, and scrolling
 *   the outer one slid the veiled box up and left bare picture under it, with
 *   the composer clipped inside a scroller nobody had found yet. It is the
 *   failure `Shell.tsx`'s 2026-10-07 note fixed for `<main>`, one box further
 *   in.
 * - ***It moved the reader whenever the picture changed.*** Switching which
 *   box scrolls throws the position away: a first staged picture arriving, a
 *   chosen one failing to load and *No backdrop* each took a reader at the
 *   bottom of the story back to the top of the panels, and while a picture
 *   showed the wheel and the keyboard did nothing outside the column — the
 *   layout pushed around on a change, which 10 §2.3 rules out.
 *
 * So the column takes nothing that changes its box: while a picture is
 * staged it carries **`data-veiled`**, and nothing else differs, so its class
 * list is the one it has with no backdrop. `<main>`, the one scroller, paints
 * the veil as its own background, a strip of the column's width centred in
 * it and keyed on this marker on its direct child (`Shell.tsx`, which says
 * how). A scroller's own background stays put while its content scrolls, so
 * the strip is under the column on every screenful and the column scrolls
 * over it; nothing else moves when it comes and goes, and `<main>`'s
 * `scrollTop` survives every arrival, failure and switch-off. The veil is
 * still P12A.0's — `--color-veil`, each theme's canvas at ~~82%~~ — and is now
 * painted only from `sm` up, where the layer is drawn. *(2026-10-14, P12A's
 * final audit: at 86% — the keyboard's ring and the column's `warn-ink`
 * failure lines needed more than the turn's inks did, and `index.css` says
 * how much.)*
 *
 * *An attribute rather than a class*, because it says a state of the page
 * rather than how anything looks, and because Tailwind would read an unknown
 * class as nothing at all — the marker has to be something `<main>`'s
 * selector can find and that no stylesheet rule hangs on by accident.
 */
export const veiled = { 'data-veiled': '' } as const;

/**
 * What the page stages, and how a picture that will not load says so.
 *
 * ***Held here rather than in the layer***, because two things depend on it:
 * the layer, and the column's veil. A picture that failed to load is no
 * picture, and a veil over nothing would be a column that changed colour for
 * no reason — so the page needs the answer as much as the layer does. *Only
 * the last failure is remembered*: choosing another picture stages it, and
 * choosing the failed one again stays dark until the page is read afresh,
 * which is the honest answer for bytes that were not there a moment ago.
 */
export function useStage(surfaces: readonly ModeSurface[] | undefined): {
  url: string | null;
  lose: (url: string) => void;
} {
  const staged = stagePicture(surfaces);
  const [lost, setLost] = useState<string | null>(null);
  return { url: staged === lost ? null : staged, lose: setLost };
}

/**
 * The layer. `url` is what to show, or `null` for nothing; `onLost` is told
 * when a picture's bytes do not arrive.
 *
 * **Two pictures at most**: the one showing, and the one arriving over it.
 * The new one is drawn at once, waiting, and shown when its pixels have
 * arrived, so the crossfade is from one room to the other rather than through
 * an empty frame. The old one stays drawn underneath until the next change —
 * it is covered, so it costs nothing to keep, and dropping it would need an
 * end-of-transition event that a zeroed duration never fires.
 *
 * *Which pictures have arrived is a set, not the last one*, because a room
 * can come back: going A → B → A puts A on top again in the element React
 * kept for it, which loaded long ago and will not fire `load` a second time.
 */
export function Backdrop(props: {
  url: string | null;
  onLost: (url: string) => void;
}): JSX.Element | null {
  const [top, setTop] = useState<string | null>(props.url);
  const [under, setUnder] = useState<string | null>(null);
  const [arrived, setArrived] = useState<ReadonlySet<string>>(() => new Set());

  /**
   * ***A change of picture, taken during render*** — React's own pattern for
   * state that follows a prop, and the one that cannot draw a frame with the
   * new picture on top and the old one already gone. The picture that was on
   * top goes underneath if it had arrived; one that had not is dropped, and
   * whatever was underneath it stays. *Off clears both*: a picture turned off
   * must not come back underneath the next one chosen.
   *
   * ***The picture coming in is never also the one underneath*** (2026-10-13,
   * after review). Going A → B → A before B's bytes have arrived drops B,
   * which never showed, and keeps what was under it — A, which is also the
   * picture now coming back on top. Drawn in both places, that is two
   * siblings with one key, which React does not support: it says so in the
   * console and may duplicate or drop an element on the next pass. A quick
   * pick and its Undo do it, and so does a staged picture that a rewind
   * replaces before it has loaded. A has arrived already, so it is shown on
   * top at once, and nothing needs to be under it.
   */
  if (props.url !== top) {
    const keep = top !== null && arrived.has(top) ? top : under;
    setUnder(props.url === null || keep === props.url ? null : keep);
    setTop(props.url);
  }

  if (top === null) return null;
  const picture = `absolute inset-0 size-full object-cover ${crossfade.picture}`;
  return createPortal(
    <div
      aria-hidden="true"
      className="pointer-events-none fixed inset-0 -z-10 max-sm:hidden print:hidden"
    >
      {under === null ? null : (
        <img
          key={under}
          src={under}
          alt=""
          loading="lazy"
          className={`${picture} ${crossfade.shown}`}
        />
      )}
      <img
        key={top}
        src={top}
        alt=""
        loading="lazy"
        className={`${picture} ${arrived.has(top) ? crossfade.shown : crossfade.waiting}`}
        onLoad={() => {
          setArrived((was) => new Set(was).add(top));
        }}
        onError={() => {
          props.onLost(top);
        }}
      />
    </div>,
    document.body,
  );
}
