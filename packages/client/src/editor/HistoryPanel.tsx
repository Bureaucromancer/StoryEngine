// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { useState, type JSX } from 'react';

import { ApiError, type LibraryKind, type ObjectVersion } from '../api.js';
import { diffObjects, type FieldChange } from '../diff.js';
import { RevisionList } from '../library/RevisionList.js';
import { Alert } from '../ui/Alert.js';
import { Button } from '../ui/Button.js';
import { TwoStep } from '../ui/TwoStep.js';
import {
  useAmendVersion,
  useObjectHistory,
  useRestoreVersion,
  useVersionPayload,
} from '../queries.js';
import { Note } from '../ui/Text.js';

/**
 * The history panel — [10 §11.2a](../../../../docs/design/10-ui-surfaces.md), interaction
 * copied closely from the source it credits. The *list* itself lives in
 * `library/RevisionList.tsx` since [P3.3] split one component across two
 * hosts; this is the powered host — restore, rename, pin, and diff — and the
 * kind is a prop rather than a hardcoded `'actors'`, so the panel's read-only
 * host works for every kind while only the editor's call site names one.
 */

export interface HistoryPanelProps {
  kind: LibraryKind;
  id: string;
  /** The saved state the diff compares against — the object, not the form. */
  currentObject: Record<string, unknown>;
  contentHash: string;
  locale: string | undefined;
  onRestored: (result: { object: Record<string, unknown>; contentHash: string }) => void;
  /**
   * Whether the form holds edits nothing has written. A restore replaces the
   * form with the version, so those edits go — said before the click, not
   * discovered after it.
   */
  unsaved?: boolean;
}

export function HistoryPanel(props: HistoryPanelProps): JSX.Element {
  const history = useObjectHistory(props.kind, props.id);
  const restore = useRestoreVersion();
  const amend = useAmendVersion();

  const [diffVersionId, setDiffVersionId] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<{ id: string; reason: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const diffQuery = useVersionPayload(props.kind, props.id, diffVersionId);

  function handleRestore(version: ObjectVersion): void {
    setError(null);
    restore.mutate(
      { kind: props.kind, id: props.id, versionId: version.id, contentHash: props.contentHash },
      {
        onSuccess: (result) => {
          props.onRestored(result);
        },
        onError: (failure) => {
          setError(
            failure instanceof ApiError && failure.status === 412
              ? 'The object has changed since the editor loaded it. Save or reload first, then restore.'
              : failure.message,
          );
        },
      },
    );
  }

  function handleRename(versionId: string, reason: string): void {
    amend.mutate(
      { kind: props.kind, id: props.id, versionId, patch: { reason } },
      {
        onSuccess: () => {
          setRenaming(null);
        },
        onError: (failure) => {
          setError(failure.message);
        },
      },
    );
  }

  function handlePin(version: ObjectVersion): void {
    amend.mutate(
      { kind: props.kind, id: props.id, versionId: version.id, patch: { pinned: !version.pinned } },
      {
        onError: (failure) => {
          setError(failure.message);
        },
      },
    );
  }

  return (
    <section aria-label="Version history" className="rounded-md border border-line bg-surface p-4">
      <h2 className="mb-3 text-section text-ink">History</h2>

      {error !== null ? (
        <Alert tone="error" role="alert" className="mb-3">
          {error}
        </Alert>
      ) : null}

      {history.isPending ? <Note>Loading the history…</Note> : null}
      {history.isError ? (
        <p role="alert" className="text-sm text-danger-ink">
          {history.error.message}
        </p>
      ) : null}

      {history.data !== undefined ? (
        <RevisionList
          versions={history.data.versions}
          locale={props.locale}
          body={(version) => (
            <>
              {renaming?.id === version.id ? (
                <form
                  className="mt-2 flex gap-2"
                  onSubmit={(event) => {
                    event.preventDefault();
                    handleRename(version.id, renaming.reason);
                  }}
                >
                  <input
                    className="w-full rounded-md border border-line-strong px-2 py-1 text-sm"
                    value={renaming.reason}
                    onChange={(event) => {
                      setRenaming({ id: version.id, reason: event.target.value });
                    }}
                    aria-label="Reason for this version"
                    autoFocus
                  />
                  <Button type="submit" size="tiny">
                    Save
                  </Button>
                  <Button
                    type="button"
                    size="tiny"
                    onClick={() => {
                      setRenaming(null);
                    }}
                  >
                    Cancel
                  </Button>
                </form>
              ) : (
                <p className="mt-1 text-ink-subtle">
                  {version.reason === '' ? '—' : version.reason}
                </p>
              )}

              <div className="mt-2 flex flex-wrap gap-2">
                {/* ***Guarded when it would cost something*** (2026-10-01,
                    polish 8). A restore replaces the form, so over unsaved
                    edits it threw them away at the first click — the saved
                    state goes into history, the typing goes nowhere. It asks
                    then, and only then: a restore over a clean form loses
                    nothing, and the state it leaves is the newest entry here. */}
                {props.unsaved === true ? (
                  <TwoStep
                    label="Restore"
                    question="Restore this version? Your unsaved edits are lost."
                    size="tiny"
                    disabled={restore.isPending}
                    onConfirm={() => {
                      handleRestore(version);
                    }}
                  />
                ) : (
                  <Button
                    type="button"
                    size="tiny"
                    disabled={restore.isPending}
                    onClick={() => {
                      handleRestore(version);
                    }}
                  >
                    Restore
                  </Button>
                )}
                <Button
                  type="button"
                  size="tiny"
                  aria-expanded={diffVersionId === version.id}
                  onClick={() => {
                    setDiffVersionId(diffVersionId === version.id ? null : version.id);
                  }}
                >
                  Diff
                </Button>
                <Button
                  type="button"
                  size="tiny"
                  onClick={() => {
                    setRenaming({ id: version.id, reason: version.reason });
                  }}
                >
                  Rename
                </Button>
                <Button
                  type="button"
                  size="tiny"
                  onClick={() => {
                    handlePin(version);
                  }}
                >
                  {version.pinned ? 'Unpin' : 'Pin'}
                </Button>
              </div>

              {diffVersionId === version.id ? (
                <DiffView
                  changes={
                    diffQuery.data === undefined
                      ? null
                      : diffObjects(diffQuery.data.object, props.currentObject)
                  }
                />
              ) : null}
            </>
          )}
        />
      ) : null}
    </section>
  );
}

/** What changed between the selected version and the current object. */
function DiffView(props: { changes: FieldChange[] | null }): JSX.Element {
  if (props.changes === null) {
    return <p className="mt-2 text-xs text-ink-subtle">Loading the comparison…</p>;
  }
  if (props.changes.length === 0) {
    return (
      <p className="mt-2 text-xs text-ink-subtle">
        This version is identical to the current object.
      </p>
    );
  }
  return (
    <div className="mt-2 overflow-x-auto">
      <table className="w-full border-collapse text-xs">
        <thead>
          <tr className="border-b border-line text-start text-ink-subtle">
            <th scope="col" className="py-1 pe-3 text-start font-medium">
              Field
            </th>
            <th scope="col" className="py-1 pe-3 text-start font-medium">
              This version
            </th>
            <th scope="col" className="py-1 text-start font-medium">
              Current
            </th>
          </tr>
        </thead>
        <tbody>
          {props.changes.map((change) => (
            <tr key={change.path} className="border-b border-line align-top">
              <td className="py-1 pe-3">
                <code>{change.path}</code>
              </td>
              <td className="py-1 pe-3 whitespace-pre-wrap">{shortValue(change.before)}</td>
              <td className="py-1 whitespace-pre-wrap">{shortValue(change.after)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function shortValue(value: unknown): string {
  if (value === undefined) return '(absent)';
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  return text.length > 200 ? `${text.slice(0, 200)}…` : text;
}
