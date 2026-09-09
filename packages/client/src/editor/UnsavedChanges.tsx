// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { useBlocker, type ShouldBlockFn } from '@tanstack/react-router';
import { useCallback, type JSX } from 'react';

import { Button } from '../ui/Button.js';
import { Dialog } from '../ui/Dialog.js';
import { SubsectionTitle } from '../ui/Text.js';

/**
 * Leaving an editor with unsaved changes — [10 §11.6](../../../../docs/design/10-ui-surfaces.md).
 *
 * **The draft lives in memory and nothing is written until Save**, which is the
 * property the rest of the editing surface is built on: a delete is mild
 * because the file still has the entry ([10 §11.2a]), the entry list can mark
 * what is unsaved ([P5 §1328]), and *as stored* can sit under the form without
 * either of them lying. The whole cost of that design lands in one moment — the
 * draft is gone the instant the page unmounts — and every other surface in this
 * app is one click away in the header.
 *
 * So the exit is confirmed. Not the edits themselves: an editor that autosaved
 * would be a different design with a different set of guarantees, and this is
 * the one small thing the current one needs to be safe.
 *
 * **Two exits, and they are not the same mechanism.** In-app navigation — the
 * *Back to* link, the header, the browser's own Back button — never touches
 * `beforeunload`, and is the exit people actually take; that is the router's
 * blocker and the dialog below. Reload, close and a typed URL never reach the
 * router; only the browser's own dialog can stop those, and it is deliberately
 * generic and unstylable. Each covers exactly what the other cannot.
 */

export function UnsavedChangesGuard(props: {
  /** Whether the draft differs from what is on disk — the editor already knows. */
  changed: boolean;
  /** The whole heading, as one sentence: word order is not ours to assemble. */
  heading: string;
}): JSX.Element | null {
  const { changed } = props;

  /**
   * **Leaving is a different path, not a different address.** The lorebook
   * editor puts the entry it is showing in `?entry=`, so picking the next entry
   * out of the list is a navigation — and a guard that asked only *are there
   * changes* would raise a dialog about losing work on the single most common
   * click in that editor, while the draft it was warning about is book-wide and
   * was never at risk. An editor's identity is its path; what it has open is
   * search.
   *
   * Memoised on `changed` alone because the function's identity is a dependency
   * of the hook's own effect: an inline arrow re-registers the blocker on every
   * render, and a re-registration while the dialog is open replaces the promise
   * its two buttons are holding.
   */
  const shouldBlockFn = useCallback<ShouldBlockFn>(
    ({ current, next }) => changed && next.pathname !== current.pathname,
    [changed],
  );

  const blocker = useBlocker({ shouldBlockFn, enableBeforeUnload: changed, withResolver: true });

  if (blocker.status !== 'blocked') return null;

  const { proceed, reset } = blocker;

  return (
    // `alertdialog`, by `Dialog`'s own rule: this one is raised because
    // something is about to go wrong rather than because anybody opened it, and
    // its message has to be announced with it.
    <Dialog role="alertdialog" labelledBy="unsaved-title" onDismiss={reset}>
      <SubsectionTitle id="unsaved-title" as="h2" className="mb-2">
        {props.heading}
      </SubsectionTitle>
      <p className="mb-4 text-sm text-ink-subtle">
        Nothing is written until you save, so leaving now discards these edits — and because they
        were never saved, there is no version in the history to bring them back from.
      </p>
      <div className="flex flex-col gap-2">
        {/*
          Staying is first, primary and focused, and dismissing with Escape is
          also staying — every default lands on the reversible answer. The
          dialog exists because the other one is not.
        */}
        <Button type="button" variant="primary" autoFocus onClick={reset}>
          Keep editing
        </Button>
        <Button type="button" variant="dangerOutline" onClick={proceed}>
          Leave without saving
        </Button>
      </div>
    </Dialog>
  );
}
