// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { Link } from '@tanstack/react-router';
import type { JSX, ReactNode } from 'react';

import { AsStored } from '../library/AsStored.js';
import { DeleteObject } from '../library/DeleteObject.js';
import { useAuthState } from '../queries.js';
import { Button } from '../ui/Button.js';
import { link, page } from '../ui/classes.js';
import { KIND_WORDS } from '../library/labels.js';
import { AssistProvider } from '../ui/assist.js';
import { useAssistFor } from './assist.js';
import { ConflictDialog } from './ConflictDialog.js';
import { HistoryPanel } from './HistoryPanel.js';
import type { EditorKind, ObjectEditor } from './object-editor.js';
import { UnsavedChangesGuard } from './UnsavedChanges.js';

/**
 * Everything around the fields — [P7B.1].
 *
 * The frame an editor has whatever it is editing: the form element, the
 * critical-control strip held against the bottom of the scrollport
 * ([10 §11.6](../../../../docs/design/10-ui-surfaces.md)), the saved-state fold
 * ([polish §2](../../../../docs/design/workplan/06-polish.md)), the version
 * history ([10 §11.2a](../../../../docs/design/10-ui-surfaces.md)), the
 * unsaved-changes guard and the 412 dialog
 * ([09 §4.4](../../../../docs/design/09-server-multiuser-deployment.md)).
 *
 * **Its subject is the *frame*, which is why the fields are `children`.** The
 * division is the one [10 §11.6](../../../../docs/design/10-ui-surfaces.md)
 * already draws when it says the cost of explicit saving *"lands in two places,
 * and both are the frame around the form rather than anything in it"* — that
 * sentence is this component's scope, written before it existed.
 *
 * ***What it must not become.*** A frame that grew a prop per kind — an avatar
 * here, an entry rail there — would be six editors again with a switch in the
 * middle. Anything a single kind needs goes above it (`header`) or inside it
 * (`children`), and the test for a new prop is whether every kind has an answer
 * for it.
 */
export function EditorFrame<F>(props: {
  editor: ObjectEditor<F>;
  descriptor: EditorKind<F>;
  /** The kind's own heading block — a card image, a blurb, whatever it has. */
  header?: ReactNode;
  /** The fields. Everything between the form's top and the control strip. */
  children: ReactNode;
  /** Where *back* goes when there is no saved object yet. */
  listSearch: Record<string, unknown>;
  /** What the back link says once there is one — *Back to the actor*. */
  backLabel: string;
  /** What the guard's dialog is about — *This actor has unsaved changes*. */
  unsavedHeading: string;
  /** The 412 dialog's whole sentence — see `ConflictDialog` for why not a noun. */
  conflictTitle: string;
  /**
   * How far apart the fields sit. Every kind has an answer and they differ: an
   * actor's fields are a column of inputs, a lorebook's are sections with a
   * rail between them.
   */
  formClassName?: string;
  /** The saved-state fold's caption — *The saved book*, *The saved object*. */
  storedCaption?: string;
}): JSX.Element {
  const { editor, descriptor } = props;
  const auth = useAuthState();
  const locale = auth.data?.account?.locale ?? undefined;
  /**
   * ***Provided once, here, and that is the whole of why P11.2 is a stage
   * rather than a sweep*** — [10 §11], [P11.2].
   *
   * §11's requirement is that assist be *"a primitive the editors are built
   * from, so that 'does this field have AI assist?' is never a question anyone
   * asks"*. The frame is the one thing all six editors are built from, so the
   * slot is provided exactly once and every `Field` with a `path` inside any of
   * them has it. **A field gains assist by being in an editor**, and loses it by
   * not being — which is the same rule for a login form, a settings control and
   * a secret, none of which are inside this component.
   */
  const contract = useAssistFor(descriptor, editor, KIND_WORDS[descriptor.kind]);

  return (
    <AssistProvider contract={contract}>
      {props.header}

      <form
        ref={editor.formRef}
        className={props.formClassName ?? 'flex flex-col gap-4'}
        onSubmit={(event) => {
          event.preventDefault();
          editor.save();
        }}
      >
        {props.children}

        {/* The critical controls, held against the bottom of the scrollport —
            [10 §11.6], and the recipe in `ui/classes.ts` carries the why. Last
            inside the `<form>`, because that is the extent a sticky element is
            held within and the form is everything Save is about. The way back
            and Delete share the strip with Save: they are the controls that
            matter, and where the page happens to be scrolled is not a reason
            for any of them to be out of reach. */}
        <div className={page.actions}>
          {editor.unsaved ? (
            <Link to="/library" search={props.listSearch} className={link.back}>
              Back to the library
            </Link>
          ) : (
            <Link
              to="/library/$kind/$id"
              params={{ kind: descriptor.kind, id: editor.base.id }}
              className={link.back}
            >
              {props.backLabel}
            </Link>
          )}
          <Button
            type="submit"
            disabled={!editor.savable || editor.savePending || editor.copyPending}
            variant="primary"
          >
            Save
          </Button>
          {/*
           * What the last control did, said where the control is. *Saved.*, a
           * restored version, a reapplied draft and a refused write used to
           * render above the form — which, with the strip pinned halfway down
           * a long form, is as far out of sight as the foot of the page. The
           * slot takes the remaining width, with a floor of ten rem: at the
           * column's width a long sentence wraps in place rather than folding
           * the strip onto a second line, and on a narrow column the buttons
           * fold under it rather than squeezing it to a word a line. The
           * notice stands in for *No changes to save.* while it shows: after
           * a save both are true, and the second says nothing the first did
           * not.
           *
           * Every 412 used to be filtered out of the error, on the assumption
           * the dialog had it — but the dialog only opens when the body
           * carried `current`, so a 412 without one vanished entirely. Only
           * what the dialog owns is filtered.
           */}
          <span className="flex min-w-0 grow basis-40 flex-wrap items-center gap-3 text-sm">
            {editor.saveError !== null ? (
              <span role="alert" className="text-danger-ink">
                {editor.saveError}
              </span>
            ) : null}
            {editor.refusal !== null ? (
              <span role="alert" className="text-danger-ink">
                {editor.refusal}
              </span>
            ) : null}
            {editor.notice !== null ? (
              <span role="status" className="text-ink-subtle">
                {editor.notice}
              </span>
            ) : editor.changed ? null : (
              <span className="text-ink-faint">No changes to save.</span>
            )}
          </span>
          {/* Both of these ask about a file, and a draft has not made one:
              there are no versions to list and nothing to delete. Absent
              rather than disabled, which is the same call [10 §11.1a] makes
              about Save — a control that cannot work explains nothing. */}
          {editor.unsaved ? null : (
            <span className="ms-auto flex flex-wrap items-center gap-3">
              {/* ***Says which way it goes*** (2026-10-01, polish 10). The panel
                  opens below *As stored*, a screen or more away on a long
                  object, so a press showed nothing where it was made and read
                  as a button that did nothing. The panel now takes the keyboard
                  when it opens (`HistoryPanel`), which brings it into view, and
                  this says *Hide history* while it is open — the shelf's
                  *Search* / *Hide search*. */}
              <Button
                type="button"
                aria-expanded={editor.historyOpen}
                onClick={() => {
                  editor.setHistoryOpen((open) => !open);
                }}
              >
                {editor.historyOpen ? 'Hide history' : 'History'}
              </Button>
              <DeleteObject
                kind={descriptor.kind}
                id={editor.base.id}
                contentHash={editor.base.contentHash}
                unsaved={editor.changed}
              />
            </span>
          )}
        </div>
      </form>

      {/* The saved state, not the form's — [polish §2]'s editor pane, and the
          caption is its required honesty: showing unsaved form state as "as
          stored" would be a lie in the one place a user came for the truth. */}
      {editor.unsaved ? null : (
        <div className="mt-6">
          <AsStored
            value={editor.base.object}
            caption={
              props.storedCaption ??
              "The saved object, not the form's working state — what a reload would find."
            }
          />
        </div>
      )}

      {editor.historyOpen ? (
        <div className="mt-6">
          <HistoryPanel
            kind={descriptor.kind}
            id={editor.base.id}
            currentObject={editor.base.object}
            contentHash={editor.base.contentHash}
            locale={locale}
            unsaved={editor.changed}
            onRestored={(result) => {
              editor.adopt(
                result.object,
                result.contentHash,
                'Version restored. The state you were on is the newest history entry.',
              );
            }}
          />
        </div>
      ) : null}

      <UnsavedChangesGuard changed={editor.changed} heading={props.unsavedHeading} />

      {editor.conflict !== null ? (
        <ConflictDialog
          title={props.conflictTitle}
          onReload={editor.reloadAndReapply}
          onSaveAsCopy={editor.saveAsCopy}
          onCancel={editor.dismissConflict}
          copyPending={editor.copyPending}
          copyError={editor.copyError}
        />
      ) : null}
    </AssistProvider>
  );
}
