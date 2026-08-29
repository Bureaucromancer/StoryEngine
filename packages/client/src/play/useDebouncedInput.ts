// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { useEffect, useState } from 'react';

/**
 * The composer's text, settled — [P3.4], and **the client's first debounce**.
 *
 * The context meter asks the server what the pending turn would assemble to
 * ([P3 §5]: *the panel never recomputes what a dry run would produce — it asks
 * the server*), and the server's answer costs a read of every segment in the
 * session. One request per keystroke would be one full transcript read per
 * keystroke; one request per *pause* is the same signal at a fraction of the
 * cost, and a pause is also when somebody looks up at the meter.
 *
 * Co-located with its one consumer rather than hoisted to a shared `hooks/`
 * folder, following `useToggleChord`'s precedent: the second consumer is P5's
 * keyword tester, and moving it then is one import line. Generalising now
 * would be guessing at what the second caller needs.
 *
 * **Cancellation on unmount is the effect's own teardown**, and deliberately
 * not a second mechanism. The `clearTimeout` that supersedes a keystroke is
 * the same one that fires when the surface goes away — a debounce with two
 * ways to cancel is a debounce with two ways to be wrong.
 *
 * The bail-out inside `setSettled` is not a micro-optimisation. The effect
 * arms on mount, so without it the first timer would produce a fresh object
 * with a new identity, which is a new value to every consumer downstream and
 * therefore one redundant request every time the page mounts.
 */
export function useDebouncedInput(
  text: string,
  guidance: string,
  ms: number,
): { text: string; guidance: string } {
  const [settled, setSettled] = useState({ text, guidance });

  useEffect(() => {
    const timer = setTimeout(() => {
      setSettled((current) =>
        current.text === text && current.guidance === guidance ? current : { text, guidance },
      );
    }, ms);
    return () => {
      clearTimeout(timer);
    };
  }, [text, guidance, ms]);

  return settled;
}
