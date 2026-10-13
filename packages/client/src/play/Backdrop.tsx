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
 * column is the whole window and a picture behind it is all cost. The veil
 * needs no phone arm of its own: it is the canvas at 82%, and the canvas over
 * the canvas is the canvas.
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
 * motions are transforms and opacity — so the layer is a portal, outside
 * every box the page owns, and behind all of them at `-z-10`: after the
 * canvas, before everything else, so the header, the dock and the footer,
 * each on `bg-surface`, cover it, and the column covers it with the veil.
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
 * ***The reading column while a backdrop shows behind it*** — added to
 * `page.reading`, and never otherwise, so a session with no backdrop draws
 * the column exactly as before.
 *
 * - **`bg-veil`**, P12A.0's scrim — each theme's canvas at 82%, the floor
 *   `contrast.test.ts` derives for `ink-subtle`, the player's line, over the
 *   worst pixel a picture can hold. The prose keeps its contrast whatever is
 *   behind it.
 * - **`overflow-y-auto`, because a background stops at its box.** The column
 *   is `h-full` — the transcript's own scrolling depends on it — and the
 *   panels above the transcript can be taller than the window (P12A §0.4
 *   counts up to thirteen blocks), so the column's content runs past its box
 *   and `<main>` scrolls it. Without a picture that is invisible; with one,
 *   everything past the first screenful — the composer among it — would be
 *   drawn over the bare picture. So while a backdrop shows, the column
 *   scrolls itself, and everything in it stays on the veil.
 * - **`max-sm:overflow-visible`**, because below the breakpoint the layer is
 *   gone and `<main>` can scroll the column as it always has; the veil stays,
 *   and over the canvas it is the canvas.
 */
export const veiled = 'bg-veil overflow-y-auto max-sm:overflow-visible';

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
   */
  if (props.url !== top) {
    setUnder(props.url === null ? null : top !== null && arrived.has(top) ? top : under);
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
        <img key={under} src={under} alt="" className={`${picture} ${crossfade.shown}`} />
      )}
      <img
        key={top}
        src={top}
        alt=""
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
