// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { useState } from 'react';

import type { TurnRecord as Turn } from '../api.js';

/**
 * The raw turn record, behind a disclosure — **one `<pre>` tag, not a system**.
 *
 * [P2 §3](../../../../docs/design/workplan/04-p2-implementation.md) says exactly that, and the
 * restraint is the point: the workbench that renders this properly — the block
 * table, the budget verdict, the call inspector — is [05 §7](../../../../docs/design/05-ui-surfaces.md)'s
 * and P3's. Building a nicer version here would be building P3 badly, and the
 * whole argument for the record being a first-class artefact is that it is
 * *complete*, not that it is pretty this phase.
 *
 * A `<details>` rather than a modal or a tab: it is native, it is keyboard
 * reachable without any code of ours, and its open state is the browser's to
 * remember.
 */
export function TurnRecordDisclosure({ turn }: { turn: Turn }): React.JSX.Element {
  const [open, setOpen] = useState(false);

  return (
    <details
      className="mt-2 text-sm"
      open={open}
      onToggle={(event) => {
        setOpen(event.currentTarget.open);
      }}
    >
      <summary className="cursor-pointer text-neutral-500 hover:text-neutral-300">
        Turn record
      </summary>
      {/* Rendered only when open: a session with fifty turns should not
          serialise fifty records nobody asked to see. */}
      {open ? (
        <pre className="mt-2 max-h-96 overflow-auto rounded bg-neutral-900 p-3 text-xs">
          {JSON.stringify(turn, null, 2)}
        </pre>
      ) : null}
    </details>
  );
}
