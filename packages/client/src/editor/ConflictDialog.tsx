// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import type { JSX } from 'react';

import { Alert } from '../ui/Alert.js';
import { Button } from '../ui/Button.js';
import { Dialog } from '../ui/Dialog.js';
import { SubsectionTitle } from '../ui/Text.js';

/**
 * The stale-hash dialog — the only defence the hot-reload thesis has against
 * silently eating a hand edit, surfaced instead of swallowed
 * ([09 §4.4](../../../../docs/design/09-server-multiuser-deployment.md)).
 *
 * ***Its own file, and one word of it is a bug fix*** — [P7B.1]. It lived
 * inside `ActorEditorPage` and the lorebook editor imported it from there, so
 * **a 412 on a lorebook has always said *The actor changed while you were
 * editing***. Nothing caught it: the only tests over this dialog are the actor
 * editor's, where the sentence is true.
 *
 * That is worth more than the fix, because it is the argument for the shell
 * [object-editor.ts](./object-editor.ts) is. A component shared by importing it
 * from whichever page happened to write it first carries that page's vocabulary
 * with it, and the second caller inherits a sentence nobody wrote for them.
 * `title` is the whole repair, and it is required rather than defaulted: a
 * default would be one page's word again, silently, for the next four kinds.
 */
export function ConflictDialog(props: {
  /**
   * The whole sentence, from the caller — *The lorebook changed while you were
   * editing*.
   *
   * ***A sentence and not a noun, and the lint rule is why.*** The first
   * version of this prop was `noun`, interpolated into *The {noun} changed
   * while you were editing* — which `no-restricted-syntax` refused, correctly:
   * word order differs between languages, so a sentence assembled from
   * fragments cannot be translated at all
   * ([work plan §2](../../../../docs/design/workplan/01-work-plan.md) keeps this
   * on day one precisely because it is the unretrofittable part). Handing the
   * whole sentence over costs each caller six words and is the only shape that
   * survives a catalogue.
   */
  title: string;
  onReload: () => void;
  onSaveAsCopy: () => void;
  onCancel: () => void;
  copyPending: boolean;
  /** Why the copy failed, if it did — the user's escape hatch must not fail silently. */
  copyError: string | null;
}): JSX.Element {
  const { onCancel } = props;
  // The trap lives in `useFocusTrap` since [P2A §3] — the settings surface has
  // two dialogs of its own, and two spellings of a trap is how one of them ends
  // up missing the Escape arm. `Dialog` now owns the call, for the same reason
  // one step out: the markup the trap attaches to was also spelled three times.
  return (
    <Dialog role="alertdialog" labelledBy="conflict-title" onDismiss={onCancel}>
      <SubsectionTitle id="conflict-title" as="h2" className="mb-2">
        {props.title}
      </SubsectionTitle>
      <p className="mb-4 text-sm text-ink-subtle">
        Something else wrote to this object since it was loaded — another tab, or a text editor
        working on the file. Saving now would overwrite that change, so it was refused.
      </p>
      {props.copyError !== null ? (
        <Alert tone="error" role="alert" className="mb-3">
          {props.copyError}
        </Alert>
      ) : null}
      <div className="flex flex-col gap-2">
        <Button type="button" variant="primary" autoFocus onClick={props.onReload}>
          Load the newer version and reapply my edits
        </Button>
        <Button type="button" onClick={props.onSaveAsCopy} disabled={props.copyPending}>
          Save my version as a copy instead
        </Button>
        <Button type="button" variant="quiet" onClick={props.onCancel}>
          Cancel
        </Button>
      </div>
    </Dialog>
  );
}
