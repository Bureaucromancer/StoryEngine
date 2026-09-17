// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import type { JSX } from 'react';

import type { TextSpan } from '@storyengine/shared';
import { runsFor } from '../library/search.js';

/**
 * What the engine understood, drawn over the prose it understood it from —
 * [10 §13.1](../../../../docs/design/10-ui-surfaces.md),
 * [06 §8.2](../../../../docs/design/06-modes-and-turn-pipeline.md), built at
 * [P7.7](../../../../docs/design/workplan/23-p7-implementation.md).
 *
 * ***An overlay, and the text under it is untouched.*** 06 §8.2 is the whole
 * rule: *"spans on the turn record, never a rewrite of the message text."* This
 * component takes the prose and the spans and renders the same characters with
 * marks around some of them — which is why a reader who turns it off gets
 * exactly what the model wrote, byte for byte.
 *
 * **`runsFor` rather than a second slicer**, which is the same sharing the
 * server does one layer down. That helper's own docstring says why it exists:
 * *"this takes positions worked out by the **real matcher's** rules… sharing the
 * `Run` shape is what lets one component render both."* The lorebook page
 * already renders highlights through it, so a mention and a keyword hit are one
 * implementation of *draw a mark here*.
 *
 * ***Rendered differently per method, because [10 §13.1] requires it***: *"a
 * tentative match that looks certain is worse than no highlighting."* Only
 * `matched` ships at [P7.7] and it is the certain one, so it gets the plain
 * mark; the styling fork is written now rather than retro-fitted, because the
 * tentative arm is the one that must never inherit the certain one's appearance
 * by default.
 */
export function MentionOverlay(props: {
  text: string;
  spans: readonly TextSpan[];
  className?: string;
}): JSX.Element {
  /**
   * *Only this text's spans, and in order.* A turn carries spans over **two**
   * texts and `runsFor` walks one — it skips any span that starts behind its
   * cursor, so an unsorted list would silently drop marks rather than draw them
   * wrongly.
   */
  const ordered = [...props.spans].sort((left, right) => left.start - right.start);
  const runs = runsFor(props.text, ordered);

  return (
    <p className={props.className}>
      {/* Keyed by index, which is right here rather than tolerated: runs are a
          positional decomposition of one string, so the index *is* the
          identity, and two runs carrying the same text are genuinely different
          runs of it. */}
      {runs.map((run, at) =>
        run.hit ? (
          /**
           * ***The highlight pair, which is what it is for.*** This was
           * `provenance`, and `provenance` has a meaning: `Badge`'s own header
           * spends a paragraph on it — *"System" and "Hand edit on disk" say
           * **this was not authored here**"*. A name the player typed a second
           * ago is the opposite of that.
           *
           * `index.css` invented `highlight` for exactly this shape and says
           * so: amber *"is spoken for twice over — `warn` and `provenance`"*,
           * and the blue is there so *"a marked word is obviously the thing you
           * typed rather than a badge that grew inside a sentence."* Three
           * components draw marks through `runsFor`; the other two already
           * spend this pair, and this was the odd reading.
           */
          <mark key={at} className="rounded-control bg-highlight-surface text-highlight-ink">
            {run.text}
          </mark>
        ) : (
          <span key={at}>{run.text}</span>
        ),
      )}
    </p>
  );
}
