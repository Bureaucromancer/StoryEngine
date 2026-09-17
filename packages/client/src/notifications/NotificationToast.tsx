// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { useEffect, type JSX } from 'react';

import { Button } from '../ui/Button.js';
import { foldedSuffix, summary } from './labels.js';
import type { NotificationsState } from './useNotifications.js';

/**
 * The toast — [09 §3.6](../../../../docs/design/09-server-multiuser-deployment.md)'s
 * second in-app channel, [P10.2].
 *
 * ***The one channel with a deadline***, and that is what makes it different
 * from the other three rather than a decoration on them: a sound is gone the
 * instant it plays, a badge waits indefinitely, and this is the *"something just
 * happened"* that has to be visible without being modal. So it dismisses itself,
 * and it never steals focus.
 *
 * **`role="status"` and not `alert`.** An alert interrupts a screen reader
 * mid-sentence, which for *your turn is ready* would be exactly the wrong
 * priority — the person is reading. `status` is announced politely, at the next
 * pause, which is what a completion notice deserves. The `RestartBanner` in the
 * shell makes the same choice for the same reason.
 *
 * *This is the first toast in this client*, and the one place a toast was
 * considered before, it was rejected: `LorebookEditorPage` uses a live region
 * because what changed there was a **position**, which a toast would describe
 * worse than the list itself does. A notification is the opposite case — the
 * thing that happened is not on screen at all.
 */

/** Long enough to read two lines; short enough not to sit over the transcript. */
const DWELL_MS = 8000;

export function NotificationToast(props: { state: NotificationsState }): JSX.Element | null {
  const { toast, dismissToast, markRead } = props.state;
  const id = toast?.id ?? null;

  useEffect(() => {
    if (id === null) return;
    const timer = setTimeout(dismissToast, DWELL_MS);
    return () => {
      clearTimeout(timer);
    };
    // Keyed on the id rather than on the object, so a **fold** arriving for the
    // same row restarts the clock exactly once rather than on every render.
  }, [id, dismissToast]);

  if (toast === null) return null;
  const said = summary(toast);

  return (
    <div
      role="status"
      // Fixed rather than in the layout flow: the shell is height-managed
      // ([P3.−1]) and a toast that took part in that flex column would push the
      // transcript up by its own height every time a turn finished.
      className="fixed bottom-4 end-4 z-50 max-w-sm rounded-panel border border-line bg-surface p-4 shadow-lg print:hidden"
    >
      <p className="text-sm font-medium">
        {said.title}
        {foldedSuffix(toast.folded)}
      </p>
      {said.body === '' ? null : <p className="text-sm text-ink-muted">{said.body}</p>}
      <div className="mt-3 flex items-center gap-2">
        <Button
          type="button"
          size="compact"
          onClick={() => {
            markRead([toast.id]);
          }}
        >
          Mark read
        </Button>
        <Button type="button" size="compact" onClick={dismissToast}>
          Dismiss
        </Button>
      </div>
    </div>
  );
}
