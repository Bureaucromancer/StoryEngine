// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { useMatch } from '@tanstack/react-router';
import type { JSX } from 'react';

import { useTranscript } from '../queries.js';
import { Button } from '../ui/Button.js';
import { Panel } from '../ui/Panel.js';

/**
 * The workbench frame — [05 §3](../../../../docs/design/05-ui-surfaces.md),
 * built by [P3.1](../../../../docs/design/workplan/05-p3-implementation.md):
 * a non-modal `<aside>` docked at the shell's inline end, whose subject is
 * whatever the main view is showing. At this stage the subject over Play is
 * the head turn's record as stored — the block table, budget verdict and call
 * inspector are P3.2's — and over everything else it is an honest empty
 * state.
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
  const match = useMatch({ from: '/play/$sessionId', shouldThrow: false });

  return (
    <aside
      id="workbench"
      aria-labelledby="workbench-title"
      onKeyDown={(event) => {
        if (event.key === 'Escape') onClose();
      }}
      // Logical properties throughout: the dock sits at the inline end, so its
      // one border faces the start side. `w-96` is a chosen default, not a
      // decision — P3.1a's drag makes it a preference.
      className="flex w-96 shrink-0 flex-col gap-3 overflow-y-auto border-s border-line bg-surface p-4"
    >
      <div className="flex items-center justify-between">
        <h2 id="workbench-title" className="text-section text-ink">
          Workbench
        </h2>
        <Button type="button" variant="quiet" size="tiny" onClick={onClose}>
          Close
        </Button>
      </div>
      {match === undefined ? <EmptySubject /> : <PlaySubject sessionId={match.params.sessionId} />}
    </aside>
  );
}

/**
 * Today's JSON for the current turn — the head of the transcript the play
 * surface already fetched, read from the same cache entry so opening the dock
 * issues no request. `at(-1)` because the route returns the path from the
 * head oldest-first; a read-a-turn-by-id is P3.0's, and until it lands the
 * head is the one turn the panel can name without the transcript riding
 * along.
 *
 * The `Panel` inset variant is the primitive documented as "a read-only echo
 * of stored bytes" — deliberately not a third JSON-viewer spelling beside the
 * two that already ship and disagree; consolidating those is P3.3's.
 */
function PlaySubject({ sessionId }: { sessionId: string }): JSX.Element {
  const transcript = useTranscript(sessionId);

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
      <p className="text-sm text-ink-muted">The head turn of this session, as stored.</p>
      <Panel variant="inset">
        <pre className="overflow-x-auto text-xs">{JSON.stringify(head, null, 2)}</pre>
      </Panel>
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
