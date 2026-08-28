// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { useMatch } from '@tanstack/react-router';
import { useRef, useState, type CSSProperties, type JSX, type RefObject } from 'react';

import { isLibraryKind } from '../api.js';
import { useAuthState, usePatchPrefs, usePrefs, useTranscript } from '../queries.js';
import { Button } from '../ui/Button.js';
import {
  clampSize,
  MAX_SIZE,
  MIN_SIZE,
  SIZE_STEP,
  workbenchSizeFromPrefs,
  workbenchSizePatch,
} from './prefs.js';
import { LibrarySubject } from './library/LibrarySubject.js';
import { TurnSubject } from './turn/TurnSubject.js';

/**
 * The workbench frame — [05 §3](../../../../docs/design/05-ui-surfaces.md),
 * built by [P3.1](../../../../docs/design/workplan/05-p3-implementation.md):
 * a non-modal `<aside>` docked at the shell's inline end, whose subject is
 * whatever the main view is showing. The subject over Play is the head turn
 * rendered by `TurnSubject` — the block table, budget verdict and call
 * inspector, [P3.2]. Over a library object it is `LibrarySubject` — the raw
 * truth of that object, [P3.3]. Over everything else, an honest empty state.
 *
 * **Non-modal is the load-bearing property, and it is achieved by omission.**
 * No `aria-modal`, no `useFocusTrap` — that hook must never be attached here:
 * it yanks escaped focus back on the next Tab press and swallows Escape
 * unconditionally, which over a dock makes the main view unusable while the
 * dock is open, the exact opposite of §3's *left open while you work*. Tab
 * passes straight through; `dock.test.tsx` pins the inverse of the trap's
 * behaviour so the next person reaching for the hook meets a red test.
 *
 * **Escape is an element-scoped handler, not a document listener**, and the
 * scoping *is* the plan's "only when focus is inside it" guard: a keydown
 * only bubbles through this element when its target is inside, so there is no
 * `contains()` check to forget, no cleanup to leak, and no ordering
 * relationship with the focus trap's document-level Escape. The
 * dialog-over-dock case resolves by the same structure — focus held in a
 * modal never reaches this handler, so one Escape closes only the dialog.
 * The corner that remains, accepted and named: focus *clicked* into the open
 * dock under an open modal (a state the trap's Tab-gated recovery makes
 * transient) lets one Escape close both, and `defaultPrevented` cannot
 * distinguish it because this handler runs earlier on the bubble path.
 *
 * **The subject follows the route, not a stored selection.** §3 says the
 * panel is a reader with no state of its own; deriving the subject from the
 * router is what keeps that true, and the empty state over subjectless routes
 * is [P3 §7.3]'s interim answer — remembering the last subject would quietly
 * make the reader stateful, which [05 §2] forbids.
 */
export function Workbench({ onClose }: { onClose: () => void }): JSX.Element {
  const play = useMatch({ from: '/play/$sessionId', shouldThrow: false });
  // The library detail route only ([P3 §1.3]): the list has no selection
  // concept, so over it the panel stays honestly empty — and the actor
  // editor is a sibling route, so it stays empty there too.
  const object = useMatch({ from: '/library/$kind/$id', shouldThrow: false });
  const asideRef = useRef<HTMLElement | null>(null);
  const prefs = usePrefs();
  const patchPrefs = usePatchPrefs();
  const size = workbenchSizeFromPrefs(prefs.data?.prefs);
  const patchSize = patchPrefs.mutate;

  return (
    <aside
      ref={asideRef}
      id="workbench"
      aria-labelledby="workbench-title"
      onKeyDown={(event) => {
        if (event.key === 'Escape') onClose();
      }}
      // The width is a custom property the stylesheet consumes ([P3.1a]):
      // committed renders land here from the preference, and the drag writes
      // the same property imperatively between them, so mid-gesture frames
      // never re-render the subject. Logical properties throughout: the dock
      // sits at the inline end, so its one border faces the start side.
      style={{ '--workbench-size': `${String(size)}px` } as CSSProperties}
      className="relative flex w-(--workbench-size) shrink-0 flex-col border-s border-line bg-surface"
    >
      <ResizeHandle
        asideRef={asideRef}
        committed={size}
        onCommit={(width) => {
          patchSize(workbenchSizePatch(width));
        }}
      />
      {/* The scroll region is inside the frame, not the frame itself: an
          absolutely positioned handle inside a scroll container would scroll
          away with the content it is supposed to be the edge of. */}
      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-4">
        <div className="flex items-center justify-between">
          <h2 id="workbench-title" className="text-section text-ink">
            Workbench
          </h2>
          <Button type="button" variant="quiet" size="tiny" onClick={onClose}>
            Close
          </Button>
        </div>
        {play !== undefined ? (
          <PlaySubject sessionId={play.params.sessionId} />
        ) : object !== undefined && isLibraryKind(object.params.kind) ? (
          <LibrarySubject
            kind={object.params.kind}
            id={object.params.id}
            at={
              object.search.slug === undefined
                ? undefined
                : { source: object.search.source ?? 'user', slug: object.search.slug }
            }
          />
        ) : (
          <EmptySubject />
        )}
      </div>
    </aside>
  );
}

/**
 * The splitter — [P3.1a]'s drag, and the reason the size is *patched on the
 * gesture's end* rather than as it changes: the prefs store serialises a
 * read-modify-write per handle through a `KeyedQueue`, so a PATCH per
 * pointermove would queue behind itself for the whole drag ([P3 §1.2]). The
 * live width travels as this component's own state plus the aside's custom
 * property, set imperatively so a sixty-hertz drag re-renders one thin strip
 * and not the JSON beside it; the one write happens at pointerup, keyup, or
 * blur — whenever the gesture is over.
 *
 * A window splitter in the ARIA sense: `role="separator"`, focusable, arrows
 * to resize — the pointer-only version would be the first mouse-trapped
 * control in a client that has kept its keyboard story clean. The arrows
 * follow the writing direction (the grow key is the one pointing *into*
 * main), Escape mid-adjustment abandons the change instead of closing the
 * dock — it stops propagating only while an adjustment is live, so an idle
 * Escape still reaches the aside's close handler — and pointer capture is
 * taken when the platform offers it (jsdom does not, which is why the guard
 * is a feature check and the tests drive the handle directly).
 */
function ResizeHandle(props: {
  asideRef: RefObject<HTMLElement | null>;
  committed: number;
  onCommit: (width: number) => void;
}): JSX.Element {
  const [live, setLive] = useState<number | null>(null);
  /**
   * The state is for the render — `aria-valuenow` — and the ref is the
   * gesture's synchronous truth. A burst of pointer events can land inside
   * one task, before React has re-rendered between them, and a `commit` that
   * read last render's state would find `null` and silently drop the write:
   * measured with a synthetic drag, and cheap insurance against real event
   * coalescing doing the same.
   */
  const liveRef = useRef<number | null>(null);
  const drag = useRef<{ pointerId: number; startX: number; startWidth: number; rtl: boolean }>(
    null,
  );
  const width = live ?? props.committed;

  function apply(next: number): void {
    const clamped = clampSize(next);
    liveRef.current = clamped;
    setLive(clamped);
    props.asideRef.current?.style.setProperty('--workbench-size', `${String(clamped)}px`);
  }

  function commit(): void {
    const settled = liveRef.current;
    if (settled === null) return;
    liveRef.current = null;
    setLive(null);
    props.onCommit(settled);
  }

  function abandon(): void {
    if (liveRef.current === null) return;
    liveRef.current = null;
    setLive(null);
    props.asideRef.current?.style.setProperty('--workbench-size', `${String(props.committed)}px`);
  }

  return (
    <div
      role="separator"
      tabIndex={0}
      aria-orientation="vertical"
      aria-label="Workbench width"
      aria-valuemin={MIN_SIZE}
      aria-valuemax={MAX_SIZE}
      aria-valuenow={width}
      className="absolute -start-1 inset-block-0 w-2 cursor-col-resize touch-none hover:bg-line focus-visible:outline-2 focus-visible:outline-focus"
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        drag.current = {
          pointerId: event.pointerId,
          startX: event.clientX,
          startWidth: props.committed,
          rtl: getComputedStyle(event.currentTarget).direction === 'rtl',
        };
        // Typed as optional through a cast, because lib.dom promises the
        // method unconditionally and jsdom does not ship it — the runtime
        // truth is the one the guard has to follow.
        const surface = event.currentTarget as { setPointerCapture?: (id: number) => void };
        try {
          surface.setPointerCapture?.(event.pointerId);
        } catch {
          // Capture is a nicety, not the mechanism: without it a fast drag
          // can outrun the handle, but moves still arrive while the pointer
          // is over it and pointerup still commits. An inactive pointer — a
          // synthetic event, a device gone mid-press — throws here, and
          // losing capture is the right price; losing the resize is not.
          // (jsdom takes the other branch: no such method at all.)
        }
      }}
      onPointerMove={(event) => {
        const state = drag.current;
        if (state === null) return;
        if (event.pointerId !== state.pointerId) return;
        // Dragging toward main grows the dock, whichever side main is on.
        const delta = state.rtl ? event.clientX - state.startX : state.startX - event.clientX;
        apply(state.startWidth + delta);
      }}
      onPointerUp={(event) => {
        if (drag.current?.pointerId !== event.pointerId) return;
        drag.current = null;
        commit();
      }}
      onPointerCancel={() => {
        drag.current = null;
        abandon();
      }}
      onKeyDown={(event) => {
        if (event.key === 'Escape' && liveRef.current !== null) {
          event.stopPropagation();
          abandon();
          return;
        }
        const rtl = getComputedStyle(event.currentTarget).direction === 'rtl';
        const grow = rtl ? 'ArrowRight' : 'ArrowLeft';
        if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
        event.preventDefault();
        // The ref again, not the rendered width: held-key repeats can land
        // faster than renders, and each step must stack on the last.
        apply((liveRef.current ?? props.committed) + (event.key === grow ? SIZE_STEP : -SIZE_STEP));
      }}
      onKeyUp={(event) => {
        if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') commit();
      }}
      onBlur={() => {
        commit();
      }}
    />
  );
}

/**
 * The head turn, rendered — the transcript the play surface already fetched,
 * read from the same cache entry so opening the dock issues no request.
 * `at(-1)` because the route returns the path from the head oldest-first.
 *
 * The head is still the *only* turn the panel can show: read-a-turn-by-id
 * landed with [P3.0] and `useTurn` exists, but nothing here calls it — the
 * subject follows the main view, and the main view has no way to point at a
 * historical turn until the transcript grows per-turn affordances ([P3.6]).
 * Consequence, stated rather than hidden: with the raw disclosure gone from
 * the transcript, a historical turn's record is unreachable in the UI until
 * then. Its bytes are safe in the store; the reader is what lags.
 */
function PlaySubject({ sessionId }: { sessionId: string }): JSX.Element {
  const transcript = useTranscript(sessionId);
  const auth = useAuthState();
  const locale = auth.data?.account?.locale ?? undefined;

  if (transcript.isPending) {
    return <p className="text-sm text-ink-subtle">Loading the record…</p>;
  }
  if (transcript.isError) {
    return (
      <p role="alert" className="text-sm text-danger-ink">
        {transcript.error.message}
      </p>
    );
  }
  const head = transcript.data.turns.at(-1);
  if (head === undefined) {
    return <p className="text-sm text-ink-muted">This session has no turns yet.</p>;
  }
  return (
    <>
      <p className="text-sm text-ink-muted">The head turn of this session.</p>
      <TurnSubject turn={head} locale={locale} />
    </>
  );
}

function EmptySubject(): JSX.Element {
  return (
    <p className="text-sm text-ink-muted">
      Nothing here has a record to show. The workbench follows the main view — open a session in
      Play and it will show the turn beneath it.
    </p>
  );
}
