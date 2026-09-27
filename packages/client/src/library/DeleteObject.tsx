// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { useUsedBy, usedByLine } from './UsedBy.js';
import { useState, type JSX } from 'react';

import { api, type LibraryKind } from '../api.js';
import { Button } from '../ui/Button.js';

/**
 * **Delete, which the server has been able to do since P1 and no surface could
 * reach** ([P4 §1.4]) — reachable now from the read page and from both editors,
 * through the critical-controls strip each of them holds against the bottom of
 * the scrollport ([10 §11.6](../../../../docs/design/10-ui-surfaces.md)).
 *
 * The import review's whole posture — commit immediately, report loudly, no
 * staging area — rests on a bad import being reversible. That was true on disk
 * and false in the app: the trash window and the version history existed, and
 * nothing here could remove an object, so *undo* meant opening a file manager.
 * This is the cost of the posture, paid rather than hand-waved.
 *
 * Two-step rather than a modal, because a modal for a reversible action is
 * ceremony — and this one *is* reversible: the folder moves to trash and the
 * retention window is what makes the second thought possible
 * ([03 §10.2](../../../../docs/design/03-data-model.md)).
 *
 * **One control for three surfaces**, which is why it left the detail page's
 * file. The two-step and the refused-412 sentence were each found wrong once
 * while this lived beside the header it started in; a copy in each editor
 * would be three places for the next such finding to hide, and three
 * confirmations that could drift apart in wording.
 */
export function DeleteObject(props: {
  kind: LibraryKind;
  id: string;
  /** The hash the surface read, so a delete stops on a file that moved underneath it. */
  contentHash: string;
  /**
   * Whether the surface holds edits nothing has written — the editors know,
   * the read page never does. It changes the question rather than the answer:
   * the trash receives the file *as saved*, and the sentence has to say so
   * before the click rather than leave somebody to discover it while looking
   * for their edits in the trash.
   */
  unsaved?: boolean;
  /** Position only — an `ms-auto`. */
  className?: string;
}): JSX.Element {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const remove = async (): Promise<void> => {
    setError(null);
    try {
      await api.deleteObject(props.kind, props.id, props.contentHash);
      /**
       * ***Leave first, then refetch*** (2026-09-27).
       *
       * The list is now wrong in a way it cannot detect. ~~`resetQueries`
       * rather than `removeQueries`: a destroyed entry does not notify its
       * observers ([P3.5]).~~ That reset ran *before* the navigation and was
       * awaited, and it reached the page still on screen: the object just
       * deleted went back to pending and was read again, answered `404`, was
       * retried a second later, and only then did the page leave — a second
       * and more of *Loading…* where the object had been, after a click that
       * had already succeeded.
       *
       * So in order: what nothing is watching is dropped, so the shelf this
       * lands on is read fresh rather than shown with the deleted row in it;
       * the page leaves; the deleted object's own entries go, now that nothing
       * mounted watches them; and what is left under `['library']` — lists an
       * editor's pickers were holding, say — is refetched as usual. A fetch the
       * shelf has already started since arriving is kept, not restarted: it
       * began after the delete.
       */
      queryClient.removeQueries({ queryKey: ['library'], type: 'inactive' });
      /**
       * **`ignoreBlocker`, because the editors mount an unsaved-changes guard**
       * and the draft it guards is of an object that is now in the trash. Left
       * to run, the guard would raise a dialog offering to keep editing a file
       * that no longer exists — and *Keep editing* would keep it, in a form
       * whose next Save the server refuses. On the read page there is no
       * blocker and the flag is inert.
       */
      await navigate({ to: '/library', search: {}, ignoreBlocker: true });
      /**
       * The editor's base is cached apart from `['library']` on purpose —
       * `staleTime: Infinity`, so the object under an open form does not shift
       * beneath it ([P2 §4] F12) — which after a delete makes it a ghost: the
       * browser's Back button would reopen the editor on a cached envelope of
       * a file that is gone, and never refetch. Removed after the navigation
       * rather than before it, so no mounted observer watches its entry vanish.
       * The read page's entries are the same ghost under the other prefix.
       */
      queryClient.removeQueries({ queryKey: ['editor', props.kind, props.id] });
      queryClient.removeQueries({ queryKey: ['library', props.kind, props.id] });
      void queryClient.invalidateQueries({ queryKey: ['library'] }, { cancelRefetch: false });
    } catch (cause) {
      // A 412 here means somebody edited it while this page was open, which is
      // exactly when a delete should stop and say so.
      setError(cause instanceof Error ? cause.message : 'It could not be deleted.');
      setConfirming(false);
    }
  };

  const classes = 'flex flex-wrap items-center gap-3 text-sm';
  return (
    <span className={props.className === undefined ? classes : `${props.className} ${classes}`}>
      {/*
       * **The message lives outside both branches, and that is a fix.** It used
       * to render only inside the confirming row — but the `catch` above calls
       * `setConfirming(false)`, so the branch that would have shown it had just
       * been replaced by the one that would not. A refused delete rendered
       * nothing at all: the 412 the comment in `remove` calls *exactly when a
       * delete should stop and say so* stopped, silently, and read as a click
       * that did not register. Announced, because it appears in reaction to
       * something the user just did.
       */}
      {error !== null ? (
        <span role="alert" className="text-danger-ink">
          {error}
        </span>
      ) : null}
      {confirming ? (
        <>
          <span className="text-ink-subtle">
            {props.unsaved === true
              ? 'Move to trash? Unsaved edits are not kept.'
              : 'Move to trash?'}
          </span>
          {/*
            ***What this object is used by, before the click*** —
            [03 §10.1](../../../../docs/design/03-data-model.md), [P11.7].
            §10.1 asks for it here by name — *referenced by 12 sessions, 3
            treatments and 1 package* — and [03 §10.2]'s posture is why it is a
            sentence rather than a refusal: delete is a **move** until the
            retention window closes, so the count informs a decision it must not
            make.
          */}
          <ReferenceCount kind={props.kind} id={props.id} />
          {/*
           * Delete first and Cancel last, so the button that answers the
           * question is not the pixels the question was asked from: the first
           * Delete sat at the strip's end, and after the click that place holds
           * Cancel. A second click that arrives before the eye has caught up
           * lands on the harmless answer.
           */}
          <Button type="button" variant="danger" size="compact" onClick={() => void remove()}>
            Delete
          </Button>
          <Button
            type="button"
            variant="quiet"
            onClick={() => {
              setConfirming(false);
            }}
          >
            Cancel
          </Button>
        </>
      ) : (
        <Button
          type="button"
          variant="dangerOutline"
          size="compact"
          onClick={() => {
            // Clearing here rather than on the next attempt: a stale message
            // beside a fresh question is worse than no message.
            setError(null);
            setConfirming(true);
          }}
        >
          Delete
        </Button>
      )}
    </span>
  );
}

/**
 * The count, or nothing at all.
 *
 * ***Nothing while it loads***, and that is a judgement rather than an
 * omission: this sits in a confirmation somebody is mid-decision in, and a
 * spinner beside *Move to trash?* is a reason to hesitate about the wrong
 * thing. If the answer arrives it arrives; if the index is slow the delete is
 * still the reversible act it was.
 */
function ReferenceCount(props: { kind: string; id: string }): JSX.Element | null {
  const usage = useUsedBy(props.kind, props.id);
  const line = usage === undefined ? null : usedByLine(usage);
  return line === null ? null : <span className="text-warn-ink">{line}</span>;
}
