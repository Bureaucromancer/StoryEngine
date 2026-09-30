// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { useEffect, useRef } from 'react';

/**
 * ***Auto-mode*** —
 * [P14 §1.8](../../../../docs/design/workplan/31-p14-scene-and-session-import.md),
 * built at [P14.5]: SillyTavern's `auto_mode_delay`. *"While the page is idle,
 * a client timer submits* let them talk *turns, and typing stops it. It is
 * client-side in both sources and stays client-side here."*
 *
 * **A timer per idle stretch, not an interval.** The clock starts when the page
 * becomes idle — the last turn landed, the box is empty — and a turn starting
 * clears it, so the next one waits the whole delay again after the reply is
 * on screen. An interval would fire on its own beat regardless, and a slow
 * model would have turns queuing behind each other; SillyTavern's own timer is
 * re-armed after each generation for the same reason.
 *
 * *What stops it is the caller's*: typing, Stop and a failed turn each switch
 * `on` off in the page, because each is a decision about the whole feature
 * rather than about one tick — and a failure left to retry itself every five
 * seconds is a loop against a model that is not answering.
 *
 * `fire` is read through a ref so a new closure each render does not restart
 * the clock: the delay is measured from when the page went idle, not from its
 * last render.
 */
export const AUTO_MODE_DEFAULT_SECONDS = 5;

export function useAutoMode(options: {
  on: boolean;
  idle: boolean;
  delayMs: number;
  fire: () => void;
}): void {
  const fire = useRef(options.fire);
  useEffect(() => {
    fire.current = options.fire;
  });

  const { on, idle, delayMs } = options;
  useEffect(() => {
    if (!on || !idle) return;
    const timer = setTimeout(() => {
      fire.current();
    }, delayMs);
    return () => {
      clearTimeout(timer);
    };
  }, [on, idle, delayMs]);
}
