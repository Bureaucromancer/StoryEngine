// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { getRouteApi, Link, useNavigate } from '@tanstack/react-router';
import { useState, type JSX } from 'react';

import { uuidv7 } from '@storyengine/shared';

import { api, ApiError, type LibraryObject } from '../api.js';
import { useAuthState, useCreateObject, useEditorBase, useSaveObject } from '../queries.js';
import {
  actorFormShape,
  applyForm,
  formChanges,
  formFromActor,
  reapplyEdits,
  stampUpdated,
  type ActorForm,
} from './form.js';
import { Alert } from '../ui/Alert.js';
import { Button } from '../ui/Button.js';
import { page } from '../ui/classes.js';
import { Dialog } from '../ui/Dialog.js';
import { Field } from '../ui/Field.js';
import { SubsectionTitle } from '../ui/Text.js';
import { AsStored } from '../library/AsStored.js';
import { HistoryPanel } from './HistoryPanel.js';

/**
 * The prototype actor editor — [P1 §P1.7](../../../../docs/design/workplan/03-p1-implementation.md).
 *
 * Actor only, deliberately: the kind with the richest shape, so it is the
 * honest test rather than the easy one. Text and simple structured fields,
 * sections, the existing avatar shown but not replaced — and no assist
 * anywhere, because assist needs providers and providers are P2. The empty
 * slot in `Field` is not an invitation.
 *
 * The editor holds a *base* — the envelope it loaded or last saved over — and
 * the form edits against it. A save presents the base's hash; if the object
 * moved underneath (the likelier conflict is not two tabs but one tab and a
 * text editor), the 412 carries the current object and the dialog offers
 * reload-and-reapply or save-as-a-copy
 * ([04 §4.4](../../../../docs/design/04-server-multiuser-deployment.md)). Nothing here
 * guesses.
 */

const routeApi = getRouteApi('/library/actors/$id/edit');

export function ActorEditorPage(): JSX.Element {
  const params = routeApi.useParams();
  return (
    // The page's own column, now that the shell's `<main>` is a bare scroll
    // container ([P3.−1] — `ui/classes.ts` has the why). Wrapped here rather
    // than per branch of the loader, so pending, error and editor lay out
    // alike. Keyed by id so save-as-a-copy lands in a fresh editor rather
    // than a stale one.
    <div className={page.tooling}>
      <EditorLoader key={params.id} id={params.id} />
    </div>
  );
}

function EditorLoader(props: { id: string }): JSX.Element {
  const base = useEditorBase('actors', props.id);

  if (base.isPending) {
    return <p className="text-ink-subtle">Loading the actor…</p>;
  }
  if (base.isError) {
    const missing = base.error instanceof ApiError && base.error.status === 404;
    return (
      <p role="alert" className="text-danger-ink">
        {missing ? 'There is no such actor in your library.' : base.error.message}
      </p>
    );
  }
  if (base.data.source === 'system') {
    return (
      <p role="alert" className="text-ink-muted">
        System library objects are read-only. Copy it to your library to edit it.
      </p>
    );
  }
  // The guard before the cast: a hand-edited card is the storage thesis
  // working, and the one answer the editor may not give it is a white screen.
  const problem = actorFormShape(base.data.object);
  if (problem !== null) {
    return (
      <Alert tone="error" role="alert">
        <p className="mb-2 font-medium">This actor cannot be opened in the editor.</p>
        <p className="mb-2">
          {`The file on disk does not have the shape the form needs: ${problem}. This usually means a hand edit went wrong. The file itself is untouched — fix it on disk and it will load.`}
        </p>
        <p>
          <Link
            to="/library/$kind/$id"
            params={{ kind: 'actors', id: props.id }}
            className="underline"
          >
            Back to the actor
          </Link>
        </p>
      </Alert>
    );
  }
  return <Editor initial={base.data} />;
}

function Editor(props: { initial: LibraryObject }): JSX.Element {
  const [base, setBase] = useState(props.initial);
  const [form, setForm] = useState<ActorForm>(() => formFromActor(props.initial.object));
  /**
   * The form as it read when `base` was loaded — what "my edits" is measured
   * against. Moves in step with `base`: after a save the two agree again, and
   * after reload-and-reapply it re-reads from the newer object.
   */
  const [pristineForm, setPristineForm] = useState<ActorForm>(() =>
    formFromActor(props.initial.object),
  );
  const [conflict, setConflict] = useState<LibraryObject | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);

  const auth = useAuthState();
  const locale = auth.data?.account?.locale ?? undefined;
  const save = useSaveObject();
  const createCopy = useCreateObject();
  const navigate = useNavigate();

  const changed = formChanges(base.object, form);

  function patchForm(patch: Partial<ActorForm>): void {
    setForm((previous) => ({ ...previous, ...patch }));
    setNotice(null);
  }

  function handleSave(): void {
    if (!changed) return;
    // `updatedAt` is stamped only on a real change — stamping a no-op save
    // would itself be a change, and would defeat the server's no-op rule.
    const object = stampUpdated(applyForm(base.object, form));
    save.mutate(
      { kind: 'actors', id: base.id, object, contentHash: base.contentHash },
      {
        onSuccess: (result) => {
          setBase((previous) => ({
            ...previous,
            object: result.object,
            contentHash: result.contentHash,
          }));
          setPristineForm(formFromActor(result.object));
          setNotice('Saved.');
        },
        onError: (failure) => {
          if (failure instanceof ApiError && failure.status === 412 && failure.current) {
            // `ApiError.current` is `unknown`: three routes speak the 412
            // idiom and they carry three different shapes, so the narrowing
            // happens at the call site that knows which one it asked for.
            setConflict(failure.current as LibraryObject);
          }
        },
      },
    );
  }

  /**
   * The 412 dialog's first offer. The newer object becomes the base, and
   * **only the fields actually edited** are reapplied over it — an untouched
   * field takes the newer value, or the reload would eat the very change the
   * 412 refused to overwrite.
   */
  function reloadAndReapply(): void {
    if (conflict === null) return;
    // The 412 body is parsed without validation, so guard before the cast —
    // the same rule as the loader, for the same hand-edited input.
    const problem = actorFormShape(conflict.object);
    if (problem !== null) {
      setConflict(null);
      setNotice(
        `The newer version could not be loaded into the form: ${problem}. Fix the file on disk, then reload this page.`,
      );
      return;
    }
    const fresh = formFromActor(conflict.object);
    setForm(reapplyEdits(pristineForm, form, fresh));
    setPristineForm(fresh);
    setBase(conflict);
    setConflict(null);
    setNotice(
      'The newer version was loaded and your edits were reapplied over it. Review, then save again.',
    );
  }

  /** The second offer: my version becomes a new object; theirs keeps this one. */
  function saveAsCopy(): void {
    if (conflict === null) return;
    const object = stampUpdated(applyForm(base.object, form));
    object['id'] = uuidv7();
    object['name'] = `${form.name} (copy)`;
    createCopy.mutate(
      { kind: 'actors', object },
      {
        onSuccess: (result) => {
          setConflict(null);
          void navigate({ to: '/library/actors/$id/edit', params: { id: result.id } });
        },
      },
    );
  }

  return (
    <>
      <p className="mb-4">
        <Link
          to="/library/$kind/$id"
          params={{ kind: 'actors', id: base.id }}
          className="text-sm text-ink-subtle underline hover:text-ink"
        >
          Back to the actor
        </Link>
      </p>

      <header className="mb-6 flex items-center gap-4">
        {/* Shown, never replaced here — the card's pixels are the portrait as
            intended, and replacing them is not this stage's business. */}
        <img
          src={api.avatarUrl(base.id, base.contentHash)}
          alt=""
          className="h-20 w-20 rounded-md border border-line bg-surface-muted object-cover"
        />
        <div>
          <h1 className="text-title text-ink">{form.name}</h1>
          <p className="text-sm text-ink-subtle">
            The card image travels with the file; this editor shows it and does not replace it.
          </p>
        </div>
      </header>

      {notice !== null ? (
        <p
          role="status"
          className="mb-4 rounded-md border border-line-strong bg-surface-sunken p-3 text-sm"
        >
          {notice}
        </p>
      ) : null}

      {/* Every 412 used to be filtered here, on the assumption the dialog had
          it — but the dialog only opens when the body carried `current`, so a
          412 without one vanished entirely. Filter only what the dialog owns. */}
      {save.isError &&
      !(save.error instanceof ApiError && save.error.status === 412 && save.error.current) ? (
        <Alert tone="error" role="alert" className="mb-4">
          {save.error.message}
        </Alert>
      ) : null}

      <form
        className="flex flex-col gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          handleSave();
        }}
      >
        <Field
          label="Name"
          value={form.name}
          onChange={(name) => {
            patchForm({ name });
          }}
          error={form.name.trim() === '' ? 'An actor needs a name.' : null}
        />
        <Field
          label="Pronouns"
          value={form.pronouns}
          onChange={(pronouns) => {
            patchForm({ pronouns });
          }}
          hint="Leave blank for unknown. Never inferred from the name."
        />
        <Field
          label="Aliases"
          value={form.aliasesText}
          onChange={(aliasesText) => {
            patchForm({ aliasesText });
          }}
          multiline
          rows={3}
          hint="One per line. Also the default keyword set for lore matching."
        />
        <Field
          label="Tags"
          value={form.tagsText}
          onChange={(tagsText) => {
            patchForm({ tagsText });
          }}
          multiline
          rows={3}
          hint="One per line."
        />
        <Field
          label="Traits"
          value={form.traitsText}
          onChange={(traitsText) => {
            patchForm({ traitsText });
          }}
          multiline
          rows={3}
          hint="One per line."
        />

        {form.sections.map((section, index) => (
          <fieldset key={section.id} className="rounded-md border border-line p-4">
            <legend className="px-1 text-sm font-medium text-ink-muted">
              {section.title === '' ? 'Untitled section' : section.title}
              <span className="ms-2 text-xs font-normal text-ink-faint">{section.disposition}</span>
            </legend>
            <div className="flex flex-col gap-3">
              <Field
                label="Title"
                value={section.title}
                onChange={(title) => {
                  const sections = form.sections.map((candidate, position) =>
                    position === index ? { ...candidate, title } : candidate,
                  );
                  patchForm({ sections });
                }}
              />
              <Field
                label="Body"
                value={section.body}
                onChange={(body) => {
                  const sections = form.sections.map((candidate, position) =>
                    position === index ? { ...candidate, body } : candidate,
                  );
                  patchForm({ sections });
                }}
                multiline
                rows={5}
              />
            </div>
          </fieldset>
        ))}

        <div className="flex items-center gap-3">
          <Button
            type="submit"
            disabled={!changed || save.isPending || form.name.trim() === ''}
            variant="primary"
          >
            Save
          </Button>
          {!changed ? <span className="text-sm text-ink-faint">No changes to save.</span> : null}
          <Button
            type="button"
            className="ms-auto"
            aria-expanded={historyOpen}
            onClick={() => {
              setHistoryOpen((open) => !open);
            }}
          >
            History
          </Button>
        </div>
      </form>

      {/* The saved state, not the form's — [polish §2]'s editor pane, and the
          caption is its required honesty: showing unsaved form state as "as
          stored" would be a lie in the one place a user came for the truth. */}
      <div className="mt-6">
        <AsStored
          value={base.object}
          caption="The saved object, not the form's working state — what a reload would find."
        />
      </div>

      {historyOpen ? (
        <div className="mt-6">
          <HistoryPanel
            kind="actors"
            id={base.id}
            currentObject={base.object}
            contentHash={base.contentHash}
            locale={locale}
            onRestored={(result) => {
              setBase((previous) => ({
                ...previous,
                object: result.object,
                contentHash: result.contentHash,
              }));
              setForm(formFromActor(result.object));
              setPristineForm(formFromActor(result.object));
              setNotice('Version restored. The state you were on is the newest history entry.');
            }}
          />
        </div>
      ) : null}

      {conflict !== null ? (
        <ConflictDialog
          onReload={reloadAndReapply}
          onSaveAsCopy={saveAsCopy}
          onCancel={() => {
            setConflict(null);
          }}
          copyPending={createCopy.isPending}
          copyError={createCopy.isError ? createCopy.error.message : null}
        />
      ) : null}
    </>
  );
}

/**
 * The stale-hash dialog — the only defence the hot-reload thesis has against
 * silently eating a hand edit, surfaced instead of swallowed
 * ([04 §4.4](../../../../docs/design/04-server-multiuser-deployment.md)).
 */
export function ConflictDialog(props: {
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
        The actor changed while you were editing
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
