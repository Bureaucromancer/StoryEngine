// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import type { DatabaseSync } from 'node:sqlite';

import type { Layout } from '../storage/layout.js';
import { matureTombstones, TOMBSTONE_TTL_MS } from './ingest.js';

/**
 * Tombstone maturation, on a schedule of its own — F9.
 *
 * A tombstone is a row waiting to find out whether it was half of a rename
 * ([P1 §1.1](../../../../docs/design/workplan/07-p1-implementation.md)). After
 * the TTL nothing is coming, and the row is a real deletion that should stop
 * occupying the index.
 *
 * **It used to run only from the watcher**, which meant that with `watch: false`
 * — every route test, and any deployment that turns the watcher off — tombstones
 * accumulated forever. Nothing *reads* a matured tombstone, so the symptom was
 * not a wrong answer but an index that grew and never shrank, which is the kind
 * of bug that is invisible until somebody looks at a file size.
 *
 * So: once at startup, because a tombstone from before a restart has no watcher
 * coming for it, and then on a timer, because a long-running server with a
 * quiet library never fires an event.
 */

/** Long enough that it is not a busy-loop, short enough that rows do not pile up. */
export const MATURATION_INTERVAL_MS = TOMBSTONE_TTL_MS * 4;

export interface Maturation {
  /** Runs one pass now, and returns how many rows it removed. */
  runOnce(): number;
  stop(): void;
}

export function startMaturation(
  db: DatabaseSync,
  layout: Layout,
  intervalMs: number = MATURATION_INTERVAL_MS,
): Maturation {
  const runOnce = (): number => matureTombstones(db, layout);

  // At startup, before the timer: whatever a previous run left behind is
  // already past its TTL by definition.
  runOnce();

  const timer = setInterval(runOnce, intervalMs);
  // The sweep must never be the reason a process stays alive — it is
  // housekeeping over derived state, and a server that has been asked to exit
  // should not wait for it.
  timer.unref();

  return {
    runOnce,
    stop: () => {
      clearInterval(timer);
    },
  };
}
