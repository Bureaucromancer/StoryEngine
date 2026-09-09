// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import type { CSSProperties, JSX } from 'react';

import type { TurnPreview, UnmeasurableReason } from '../api.js';
import { formatCount } from '../format.js';
import { usePatchPrefs, usePrefs } from '../queries.js';
import { headroom } from '../workbench/headroom.js';
import { workbenchOpenFromPrefs, workbenchOpenPatch } from '../workbench/prefs.js';

/**
 * The context-fill meter — [10 §3]'s **[RESOLVED]** answer, built at [P3.4]:
 * *Play keeps one always-visible signal — a context-fill meter — and clicking
 * it opens the panel in place, already on the current turn.*
 *
 * **It is a button, and deliberately not a `role="meter"`.** ARIA makes every
 * descendant of a button presentational, so a meter nested inside the click
 * target is pruned from the accessibility tree — a role that lints clean and
 * announces nothing. Splitting them would either give one strip two semantics
 * or shrink the click target to a fraction of it. So the figure lives in the
 * button's own accessible name, which is what `aria-valuetext` would have
 * carried anyway. (The resize handle's `role="separator"` is the other shape:
 * a focusable widget that is not a button. The two should not be made to
 * rhyme.)
 *
 * **The number is the estimate, uncorrected.** It reads about a tenth low
 * against what providers report — the estimator is `length/4` and the chat
 * template costs tokens — and the honest response is the word *estimated* in
 * the name, not a fudge factor: a corrected number would disagree with the
 * drops the budgeter actually made, and the margin already lives in
 * `reserveOutputTokens` where [25 E5] put it.
 *
 * **The denominator is what assembly may spend** — the window minus the
 * completion reserve, which is `headroom()`'s own definition. Using the raw
 * ceiling would paint a fuller-looking bar that disagrees with the drops. And
 * the warn tone is `headroom().imminent`, the same judgement the panel's
 * verdict uses: one function decides *close to full* for both surfaces, so
 * they cannot disagree about it.
 *
 * The click **opens** rather than toggles, and does not write when the dock is
 * already open — a redundant patch is the thing `dock.test.tsx` asserts
 * against on a mount that finds the preference already set.
 */

const UNMEASURABLE: Record<UnmeasurableReason, string> = {
  'role-unbound': 'nothing is bound to the prose role',
  'role-dangling': 'the prose role points at a connection that is gone',
  'no-prose-step': 'this mode narrates nothing',
};

/** The name the button carries, which is the whole of what it says. */
export function meterLabel(
  preview: TurnPreview | undefined,
  locale: string | undefined,
): { text: string; ratio: number | null; imminent: boolean } {
  if (preview === undefined) {
    return { text: 'Context fill has not been measured yet.', ratio: null, imminent: false };
  }
  if (preview.state === 'unmeasurable') {
    return {
      text: `Context fill is unmeasurable: ${UNMEASURABLE[preview.reason]}.`,
      ratio: null,
      imminent: false,
    };
  }

  const room = headroom(preview.budget);
  const ratio = room.available === 0 ? 1 : Math.min(1, room.spent / room.available);
  return {
    text: `Context fill: ${formatCount(room.spent, locale)} of ${formatCount(room.available, locale)} estimated tokens. Open the workbench to see the block table.`,
    ratio,
    imminent: room.imminent,
  };
}

export function ContextMeter({
  preview,
  busy,
  locale,
}: {
  preview: TurnPreview | undefined;
  /** A preview is in flight, or a turn is. The last reading is held, not blanked. */
  busy: boolean;
  locale: string | undefined;
}): JSX.Element {
  const prefs = usePrefs();
  const patchPrefs = usePatchPrefs();
  const open = workbenchOpenFromPrefs(prefs.data?.prefs);
  const { text, ratio, imminent } = meterLabel(preview, locale);

  return (
    <button
      type="button"
      aria-label={text}
      title={text}
      aria-expanded={open}
      aria-controls={open ? 'workbench' : undefined}
      aria-busy={busy}
      onClick={() => {
        if (!open) patchPrefs.mutate(workbenchOpenPatch(true));
      }}
      className="flex w-full items-center gap-2 rounded-control px-1 py-1 text-start focus-visible:outline-2 focus-visible:outline-focus"
    >
      <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-muted">
        {ratio === null ? null : (
          <span
            // The width travels as a custom property, following the dock's
            // `--workbench-size`: a percentage is a value, not a utility, and
            // there is no palette scale to reach for by accident.
            style={{ '--context-fill': `${String(Math.round(ratio * 100))}%` } as CSSProperties}
            className={
              imminent
                ? 'block h-full w-(--context-fill) bg-warn-ink'
                : 'block h-full w-(--context-fill) bg-accent-muted'
            }
          />
        )}
      </span>
      <span className="text-xs text-ink-faint tabular-nums">{figures(preview, locale)}</span>
    </button>
  );
}

/**
 * The figure beside the bar — **beside it, never on the fill**. `contrast.test`
 * enumerates the text-on-surface pairs the palette guarantees, and ink on a
 * filled bar would be a pair it does not cover, which would quietly make that
 * account incomplete rather than merely untested.
 */
function figures(preview: TurnPreview | undefined, locale: string | undefined): string {
  if (preview === undefined) return '—';
  if (preview.state === 'unmeasurable') return 'not measurable';
  const room = headroom(preview.budget);
  return `${formatCount(room.spent, locale)} / ${formatCount(room.available, locale)}`;
}
