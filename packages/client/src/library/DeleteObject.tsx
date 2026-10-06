// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { useUsedBy, usedByLine } from './UsedBy.js';
import { useState, type JSX } from 'react';

import { api, type LibraryKind } from '../api.js';
import { TwoStep } from '../ui/TwoStep.js';

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
 * confirmations that could drift apart in wording. ***Four since 2026-10-06***
 * — every row of the shelf one of your own ([polish §27]), which is what
 * `named` and `stay` are for, and the argument for one control held: the row
 * was a fourth place for the same sentences to drift.
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
  /**
   * ***The object's name, where several of these stand together*** — the
   * shelf, one per row (2026-10-06, [polish §27]).
   *
   * Polish §23's rule: a table of buttons that are all *Delete* is a list
   * nobody can choose from. So it names the trigger for a screen reader, and
   * the question for everybody, since the question is what both answers are
   * described by and *Move to trash?* in row nine says nothing about row nine.
   * A page about one object leaves it out, and asks as it always has.
   */
  named?: string;
  /**
   * ***Stay where the delete was asked from*** — the shelf (2026-10-06).
   *
   * The pages about one object leave, because what they showed is gone. A row
   * on the shelf is not a page: leaving would send somebody from
   * `/library?kind=treatments` to every kind at once for the crime of tidying
   * up, and the list they were reading is the one thing still worth showing.
   */
  stay?: boolean;
  /** Position only — an `ms-auto`. */
  className?: string;
}): JSX.Element {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);

  const remove = async (): Promise<void> => {
    setError(null);
    try {
      await api.deleteObject(props.kind, props.id, props.contentHash);
      if (props.stay === true) {
        /**
         * **The object's own entries go, and only the ones nothing watches.**
         * The editor's base is the ghost the comment below describes, and a
         * read page visited earlier is the same ghost under the other prefix;
         * neither is mounted on the shelf. An *active* entry under that prefix
         * — the workbench, open on this very object — is left to the refetch,
         * which answers it with the 404 that is now true, where removing it
         * would orphan the observer showing it.
         *
         * **Awaited, so the row is gone before the question closes.** The
         * shelf's refetch is what removes the row; settled first, the question
         * would close onto a Delete button for an object already in the
         * trash, for as long as the list took to come back.
         */
        queryClient.removeQueries({ queryKey: ['editor', props.kind, props.id], type: 'inactive' });
        queryClient.removeQueries({
          queryKey: ['library', props.kind, props.id],
          type: 'inactive',
        });
        await queryClient.invalidateQueries({ queryKey: ['library'] });
        return;
      }
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
    }
  };

  const classes = 'flex flex-wrap items-center gap-3 text-sm';
  return (
    <span className={props.className === undefined ? classes : `${props.className} ${classes}`}>
      {/*
       * **The message lives outside both branches, and that is a fix.** It used
       * to render only inside the confirming row — but the `catch` above closed
       * the question, so the branch that would have shown it had just been
       * replaced by the one that would not. A refused delete rendered
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
      {/*
       * ***The shared two-step*** (2026-10-01, polish 8) — `ui/TwoStep.tsx`
       * was cut from this control's own: the destructive answer first and
       * Cancel where the trigger was. What it adds is what this one lacked:
       * the question is announced, and the keyboard is not dropped to the page
       * when the button it was on turns into the question.
       *
       * ***What this object is used by, before the click*** —
       * [03 §10.1](../../../../docs/design/03-data-model.md), [P11.7]. §10.1
       * asks for it here by name — *referenced by 12 sessions, 3 treatments and
       * 1 package* — and [03 §10.2]'s posture is why it is a sentence rather
       * than a refusal: delete is a **move** until the retention window closes,
       * so the count informs a decision it must not make.
       */}
      <TwoStep
        label="Delete"
        {...(props.named === undefined ? {} : { name: `Delete ${props.named}` })}
        question={question(props.named, props.unsaved === true)}
        variant="dangerOutline"
        aside={<ReferenceCount kind={props.kind} id={props.id} />}
        // Cleared on asking rather than on the next attempt: a stale message
        // beside a fresh question is worse than no message.
        onAsk={() => {
          setError(null);
        }}
        onConfirm={remove}
      />
    </span>
  );
}

/**
 * The question, whole — built here rather than in the JSX, because a sentence
 * split across children is what the assembly rule reports. The name is quoted:
 * objects are called things like *Vera Solano, edited a third time*, and a
 * question that runs into its own subject stops reading as one.
 */
function question(named: string | undefined, unsaved: boolean): string {
  const ask = named === undefined ? 'Move to trash?' : `Move “${named}” to trash?`;
  return unsaved ? `${ask} Unsaved edits are not kept.` : ask;
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
