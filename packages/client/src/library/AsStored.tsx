// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { useState, type JSX } from 'react';

import { usePatchPrefs, usePrefs } from '../queries.js';
import { Button } from '../ui/Button.js';
import { Panel } from '../ui/Panel.js';
import { Note } from '../ui/Text.js';

/**
 * The object's bytes, behind a fold — [polish §2](../../../../docs/design/workplan/09-polish.md)'s
 * component, built at [P3.3](../../../../docs/design/workplan/05-p3-implementation.md)
 * and discharging that item: one component wherever stored JSON is shown back
 * (the detail page, the workbench's library subject, the editor's saved-state
 * pane), or several ship and disagree about wrapping and copy — which is not a
 * hypothetical; the audit in [P3 §5] found two that already did.
 *
 * **Collapsed by default, in both places**, with the open state a *per-user*
 * preference rather than per-object component state — polish §2's own detail,
 * unblocked by the prefs store. ~~One honest caveat, recorded where the next
 * reader will meet it: polish §2 argues the collapse from the by-field view
 * existing, and it does not exist yet — what blunts that is exactly the
 * preference: one click opens the fold and it stays open, everywhere, until
 * closed.~~ *Discharged at [P5.−1]: the by-field view exists
 * ([ByField.tsx](./ByField.tsx)), so the collapse now rests on the argument
 * polish §2 actually made for it rather than on the preference standing in.*
 *
 * **And this pane is not what that view replaced.** It shows fields the client
 * has no rendering for — extension-written keys, a newer build's additions,
 * anything a hand edit added — which the by-field view deliberately leaves
 * here, because it renders what the schema declares and nothing else. Losing
 * this would make those invisible rather than merely unstyled.
 *
 * The copy control copies the **whole object** — the same bytes the pane
 * shows, not a summary of them. The clipboard is reached through a feature
 * check rather than the DOM type's promise, because jsdom ships no clipboard
 * at all and insecure contexts hide it; a copy that cannot happen says so
 * instead of pretending.
 *
 * Bounded height with its own scroll, in the `Panel` inset variant that was
 * built for read-only echoes of stored bytes — a long object scrolls inside
 * the fold, never growing the page to a thousand lines.
 */

export const AS_STORED_OPEN_KEY = 'ui.as-stored-open';

/** Collapsed is the absence of the preference, as closed is for the dock. */
export function asStoredOpenFromPrefs(prefs: Record<string, unknown> | undefined): boolean {
  return prefs?.[AS_STORED_OPEN_KEY] === true;
}

/** The patch that records a toggle. `null` deletes, which is what closed is. */
export function asStoredOpenPatch(open: boolean): Record<string, unknown> {
  return { [AS_STORED_OPEN_KEY]: open ? true : null };
}

export function AsStored({
  value,
  caption,
}: {
  value: unknown;
  /** A host-supplied truth sentence — the editor's "saved, not the form". */
  caption?: string | undefined;
}): JSX.Element {
  const prefs = usePrefs();
  const patchPrefs = usePatchPrefs();
  const open = asStoredOpenFromPrefs(prefs.data?.prefs);
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'refused'>('idle');
  const text = JSON.stringify(value, null, 2);

  return (
    <section aria-label="The object as stored">
      <details
        open={open}
        onToggle={(event) => {
          // The guard keeps the mount-time toggle (React applying a stored
          // preference) from writing the preference back to itself; only a
          // change of heart patches.
          if (event.currentTarget.open !== open) {
            patchPrefs.mutate(asStoredOpenPatch(event.currentTarget.open));
          }
        }}
      >
        <summary className="cursor-pointer text-ink-muted hover:text-ink">As stored</summary>
        <div className="mt-2 flex flex-col gap-2">
          {caption === undefined ? null : <Note>{caption}</Note>}
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="quiet"
              size="tiny"
              onClick={() => {
                // Typed as optional through a cast, because lib.dom promises
                // the clipboard unconditionally and the runtime does not: the
                // feature check is the truth the guard has to follow.
                const clipboard = (
                  navigator as { clipboard?: { writeText: (data: string) => Promise<void> } }
                ).clipboard;
                if (clipboard === undefined) {
                  setCopyState('refused');
                  return;
                }
                clipboard.writeText(text).then(
                  () => {
                    setCopyState('copied');
                  },
                  () => {
                    setCopyState('refused');
                  },
                );
              }}
            >
              Copy
            </Button>
            {copyState === 'copied' ? <Note role="status">Copied.</Note> : null}
            {copyState === 'refused' ? <Note role="status">The clipboard refused.</Note> : null}
          </div>
          <Panel variant="inset" className="max-h-96 overflow-auto">
            <pre className="text-xs">{text}</pre>
          </Panel>
        </div>
      </details>
    </section>
  );
}
