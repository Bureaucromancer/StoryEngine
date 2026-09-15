// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { Link, useMatch, useNavigate } from '@tanstack/react-router';
import { useRef, useState, type CSSProperties, type JSX, type RefObject } from 'react';

import { isLibraryKind, type TurnRecord } from '../api.js';
import {
  useAuthState,
  useLiveTurn,
  usePatchPrefs,
  usePrefs,
  usePreview,
  useTranscript,
} from '../queries.js';
import { Button } from '../ui/Button.js';
import { SelectField } from '../ui/Field.js';
import { link } from '../ui/classes.js';
import {
  clampSize,
  MAX_SIZE,
  MIN_SIZE,
  SIZE_STEP,
  workbenchSizeFromPrefs,
  workbenchSizePatch,
} from './prefs.js';
import { ForceFire } from './ForceFire.js';
import { ReleaseSubject } from './home/ReleaseSubject.js';
import { ImportSubject } from './import/ImportSubject.js';
import { LibrarySubject } from './library/LibrarySubject.js';
import { LiveSubject } from './live/LiveSubject.js';
import { PreviewSubject } from './turn/PreviewSubject.js';
import { TurnSubject } from './turn/TurnSubject.js';

/**
 * The workbench frame — [10 §3](../../../../docs/design/10-ui-surfaces.md),
 * built by [P3.1](../../../../docs/design/workplan/15-p3-implementation.md):
 * a non-modal `<aside>` docked at the shell's inline end, whose subject is
 * whatever the main view is showing. The subject over Play is the head turn
 * rendered by `TurnSubject` — the block table, budget verdict and call
 * inspector, [P3.2]. Over a library object it is `LibrarySubject` — the raw
 * truth of that object, [P3.3]. Over home it is `ReleaseSubject` — every
 * release of the changelog the page is showing one of, [home, revised]. Over
 * everything else, an honest empty state.
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
 * make the reader stateful, which [10 §2] forbids.
 *
 * **[P3.4] widened what the subject over Play *is*, and left the rule
 * alone.** It is now the turn about to be taken, falling back to the head
 * when nothing is composed — because the meter that opens this panel is about
 * the pending input, and a panel answering about the previous turn would
 * contradict the control that opened it. The panel still holds no state: it
 * chooses on the route and on one cache entry whose reader provably cannot
 * fetch, and that entry is dropped at submit and again on leave. Written back
 * into [10 §3] rather than left as an implicit reinterpretation.
 */
export function Workbench({ onClose }: { onClose: () => void }): JSX.Element {
  const play = useMatch({ from: '/play/$sessionId', shouldThrow: false });
  // The library detail route only ([P3 §1.3]): the list has no selection
  // concept, so over it the panel stays honestly empty — and the actor
  // editor is a sibling route, so it stays empty there too.
  const object = useMatch({ from: '/library/$kind/$id', shouldThrow: false });
  // The list route itself, which used to fall through to the empty state.
  // [P3 §7.3] asked what a subjectless route should show; over the library list
  // the answer is import, because the list as a whole is what it is about
  // ([P4 §7.12]).
  const libraryList = useMatch({ from: '/library', shouldThrow: false });
  // Home ([home, revised]) — the only route whose subject is a *document*
  // rather than a record, and still a reader: `ReleaseSubject` carries the
  // argument for why that is not [10 §3]'s second exception. Matched last in
  // the chain below because `/` is the least specific address in the app.
  const home = useMatch({ from: '/', shouldThrow: false });
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
          <PlaySubject sessionId={play.params.sessionId} selected={play.search.turn} />
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
        ) : libraryList !== undefined ? (
          <ImportSubject />
        ) : home !== undefined ? (
          <ReleaseSubject selected={home.search.release} />
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
      className="absolute -start-1 inset-y-0 w-2 cursor-col-resize touch-none hover:bg-line focus-visible:outline-2 focus-visible:outline-focus"
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
 * The turn this session would send next, or the one it last sent — [P3.4].
 *
 * **The subject over Play widened at P3.4, and the rule did not.** It used to
 * be *the head turn*; it is now *the turn about to be taken, falling back to
 * the head when nothing is composed* — because the meter that opens this panel
 * is about the pending input, and a panel that answered about the previous
 * turn would contradict the control that opened it ([P3 §1.6]).
 *
 * That is a wider object for the rule, not a breach of it. The panel still
 * holds no state: the two facts it chooses on are the **route** (which
 * session) and the **cache** (what the composer last asked the server), and
 * `usePreview` is a reader that provably cannot fetch — `skipToken` is the
 * mechanism. Nothing about the composer is remembered anywhere the panel can
 * reach, the entry is dropped when a turn is submitted because the record
 * supersedes it, and it is dropped again when the surface is left.
 *
 * The head half is unchanged, including its limit: the head is still the only
 * *committed* turn the panel can show, because the main view has no way to
 * point at a historical one until the transcript grows per-turn affordances
 * ([P3.6]).
 */
function PlaySubject({
  sessionId,
  selected,
}: {
  sessionId: string;
  selected: string | undefined;
}): JSX.Element {
  /**
   * **Force-fire sits under whichever subject is showing** — [10 §10.1], [P7.5].
   *
   * That section puts it here rather than on the hook panel: *"Commit is a move
   * in the story and belongs where the story is played; force-fire is a test of
   * the material and belongs in the workbench, beside the keyword test and the
   * dry run it is a sibling of."* Both siblings are in this panel — the dry run
   * is `PreviewSubject` and the generalised keyword test is `LoreReportView`
   * inside it.
   *
   * *Under all four branches rather than one*, because it is a fact about the
   * session's material and not about whichever turn the panel happens to be
   * describing — and it renders nothing when there is no hook left to audition,
   * which is every session without a pool.
   */
  return (
    <div className="flex flex-col gap-4">
      <TurnOrPreview sessionId={sessionId} selected={selected} />
      <ForceFire sessionId={sessionId} />
    </div>
  );
}

function TurnOrPreview({
  sessionId,
  selected,
}: {
  sessionId: string;
  selected: string | undefined;
}): JSX.Element {
  const transcript = useTranscript(sessionId);
  const preview = usePreview(sessionId);
  const liveTurn = useLiveTurn(sessionId);
  const auth = useAuthState();
  const locale = auth.data?.account?.locale ?? undefined;

  /**
   * **A turn being taken outranks both** — [P3.5]. While the server is working
   * there is nothing to compose (the input is disabled) and the head is about
   * to be superseded, so the honest subject is the one thing that is actually
   * happening. It is the event feed rendered rather than the record rendered
   * early, which is the decision the stage made about [09 §3.3]; the record
   * takes over the moment the turn commits and the transcript refetches.
   */
  /**
   * ***An explicit selection outranks both*** — [P7B.7].
   *
   * The two branches below are about *what is happening now*, and they are the
   * right default precisely because nobody asked for anything else. Once
   * somebody has asked, yanking the panel away to the live turn or to the
   * composer would make the picker a control that undoes itself — and the
   * composer's is the worse of the two, because typing is exactly what a person
   * does while reading an old turn.
   */
  if (selected === undefined) {
    const live = liveTurn.data?.live;
    if (live?.state === 'running') {
      return <LiveSubject live={live} locale={locale} />;
    }

    const pending = preview.data?.preview;
    if (pending?.pendingInput === true) {
      return <PreviewSubject preview={pending} locale={locale} />;
    }
  }

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
  const turns = transcript.data.turns;
  if (turns.length === 0) {
    return <p className="text-sm text-ink-muted">This session has no turns yet.</p>;
  }

  /**
   * ***The panel can be pointed at a turn the head has passed*** — [P7B.7],
   * closing [F-05] and [R1].
   *
   * [10 §3](../../../../docs/design/10-ui-surfaces.md) has said the panel shows
   * any turn, *current or historical*, since it was written; it was wired to
   * the head, and the paragraph above this function recorded that as a limit
   * waiting on *"per-turn affordances"* that never arrived. The affordance is
   * the picker below and the selection lives in the address (`?turn=`), which
   * is what keeps the panel a reader rather than a place.
   *
   * **Read from the transcript, not fetched.** The transcript is the path, and
   * *the head has passed it* is exactly what a path turn is — so the turn is
   * already here and selecting one costs no request. `useTurn` is what reaches
   * a turn **off** the path, which `ComparePage` already does and which this
   * picker deliberately does not offer: the tree is the surface for choosing
   * among siblings, and a flat list that mixed abandoned branches into it would
   * be a second, worse tree.
   */
  const chosen = selected === undefined ? undefined : turns.find((one) => one.id === selected);
  const head = turns.at(-1);
  const subject = chosen ?? head;
  if (subject === undefined) {
    return <p className="text-sm text-ink-muted">This session has no turns yet.</p>;
  }
  return (
    <>
      <TurnPicker turns={turns} sessionId={sessionId} selected={chosen?.id} />
      <p className="text-sm text-ink-muted">
        {chosen === undefined
          ? 'The head turn of this session.'
          : 'A turn the head has passed. Nothing here is live.'}
      </p>
      {/* **The panel supplies the entry point, and the view supplies the
          address** — [P3 §1.5]. Rendered only when there is something to
          compare against: the first turn of a session has no before, and a
          link to a comparison that cannot exist is worse than no link. The
          destination is a full view rather than a second subject here, which
          is [P3 §7.2]'s settlement in one element: you leave once, on
          purpose, and arrive somewhere you can bookmark. */}
      {subject.parentTurnId === null ? null : (
        <p>
          <Link
            to="/compare/$sessionId"
            params={{ sessionId }}
            search={{ before: subject.parentTurnId, after: subject.id }}
            className={link.inline}
          >
            Compare with the turn before it
          </Link>
        </p>
      )}
      <TurnSubject turn={subject} locale={locale} sessionId={sessionId} />
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

/**
 * Which committed turn the panel is describing — [P7B.7].
 *
 * **A select, not a list.** The panel is a column two hundred pixels wide
 * beside the thing it describes; a scrollable turn list in it would be a second
 * transcript competing with the first. The tree is where somebody chooses among
 * *branches*; this chooses among the turns on the path they are already on.
 *
 * **Newest first**, because the head is the default and the turns anybody
 * reaches back for are the recent ones. The blank option is not *no turn* — it
 * is P3.4's subject, *the turn about to be taken, falling back to the head*,
 * which is a live answer rather than an absence and is why it is worded as one.
 */
function TurnPicker({
  turns,
  sessionId,
  selected,
}: {
  turns: readonly TurnRecord[];
  sessionId: string;
  selected: string | undefined;
}): JSX.Element {
  const navigate = useNavigate();

  return (
    <SelectField
      label="Showing"
      value={selected ?? ''}
      options={[
        ['', 'What happens next'],
        ...[...turns].reverse().map((turn: TurnRecord, index: number) => {
          const ordinal = turns.length - index;
          return [turn.id, `Turn ${String(ordinal)}`] as [string, string];
        }),
      ]}
      onChange={(turn) => {
        void navigate({
          to: '/play/$sessionId',
          params: { sessionId },
          search: turn === '' ? {} : { turn },
        });
      }}
    />
  );
}
