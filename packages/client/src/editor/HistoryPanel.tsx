// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { useState, type JSX } from 'react';

import { ApiError, type ObjectVersion } from '../api.js';
import { diffObjects, type FieldChange } from '../diff.js';
import { formatTimestamp } from '../format.js';
import {
  useAmendVersion,
  useObjectHistory,
  useRestoreVersion,
  useVersionPayload,
} from '../queries.js';

/**
 * The history panel — [05 §11.2a](../../../../docs/design/05-ui-surfaces.md), interaction
 * copied closely from the source it credits. Revisions newest first with the
 * live object pinned on top as *current*; restore, rename, pin, and diff.
 *
 * **The source badge is not decoration.** More things edit objects here than
 * anywhere else — a hand edit picked up from disk, a restore, later an assist
 * or an import — and *"who changed my character"* is the question this panel
 * answers.
 */

const SOURCE_LABELS: Record<string, string> = {
  manual: 'Edited in the app',
  external: 'Hand edit on disk',
  restore: 'Restored',
  assist: 'Assist',
  extension: 'Extension',
  import: 'Import',
};

const BUTTON_CLASS =
  'rounded-md border border-slate-300 px-2 py-0.5 text-xs text-slate-700 hover:bg-slate-100';

export interface HistoryPanelProps {
  id: string;
  /** The saved state the diff compares against — the object, not the form. */
  currentObject: Record<string, unknown>;
  contentHash: string;
  locale: string | undefined;
  onRestored: (result: { object: Record<string, unknown>; contentHash: string }) => void;
}

export function HistoryPanel(props: HistoryPanelProps): JSX.Element {
  const history = useObjectHistory('actors', props.id);
  const restore = useRestoreVersion();
  const amend = useAmendVersion();

  const [diffVersionId, setDiffVersionId] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<{ id: string; reason: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const diffQuery = useVersionPayload('actors', props.id, diffVersionId);

  function handleRestore(version: ObjectVersion): void {
    setError(null);
    restore.mutate(
      { kind: 'actors', id: props.id, versionId: version.id, contentHash: props.contentHash },
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
      { kind: 'actors', id: props.id, versionId, patch: { reason } },
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
      { kind: 'actors', id: props.id, versionId: version.id, patch: { pinned: !version.pinned } },
      {
        onError: (failure) => {
          setError(failure.message);
        },
      },
    );
  }

  return (
    <section
      aria-label="Version history"
      className="rounded-md border border-slate-200 bg-white p-4"
    >
      <h2 className="mb-3 text-lg font-semibold">History</h2>

      {error !== null ? (
        <p
          role="alert"
          className="mb-3 rounded-md border border-red-300 bg-red-50 p-2 text-sm text-red-900"
        >
          {error}
        </p>
      ) : null}

      {history.isPending ? <p className="text-sm text-slate-600">Loading the history…</p> : null}
      {history.isError ? (
        <p role="alert" className="text-sm text-red-900">
          {history.error.message}
        </p>
      ) : null}

      {history.data !== undefined ? (
        <ol className="flex flex-col gap-2">
          <li className="rounded-md border border-slate-300 bg-slate-50 p-2 text-sm">
            <span className="font-medium">Current</span>
            <span className="ms-2 text-slate-600">The object as it is now.</span>
          </li>
          {history.data.versions.length === 0 ? (
            <li className="p-2 text-sm text-slate-600">
              No versions yet. The first edit records the state it replaces.
            </li>
          ) : null}
          {history.data.versions.map((version) => (
            <li key={version.id} className="rounded-md border border-slate-200 p-2 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium">Revision {String(version.revision)}</span>
                <SourceBadge kind={version.source.kind} />
                {version.pinned ? (
                  <span className="rounded-md bg-slate-200 px-1.5 text-xs text-slate-700">
                    Pinned
                  </span>
                ) : null}
                <span className="text-slate-600">
                  {formatTimestamp(version.authoredAt, props.locale)}
                </span>
                {version.authorVersion !== null ? (
                  <span className="text-xs text-slate-500">v{version.authorVersion}</span>
                ) : null}
              </div>

              {renaming?.id === version.id ? (
                <form
                  className="mt-2 flex gap-2"
                  onSubmit={(event) => {
                    event.preventDefault();
                    handleRename(version.id, renaming.reason);
                  }}
                >
                  <input
                    className="w-full rounded-md border border-slate-300 px-2 py-1 text-sm"
                    value={renaming.reason}
                    onChange={(event) => {
                      setRenaming({ id: version.id, reason: event.target.value });
                    }}
                    aria-label="Reason for this version"
                    autoFocus
                  />
                  <button type="submit" className={BUTTON_CLASS}>
                    Save
                  </button>
                  <button
                    type="button"
                    className={BUTTON_CLASS}
                    onClick={() => {
                      setRenaming(null);
                    }}
                  >
                    Cancel
                  </button>
                </form>
              ) : (
                <p className="mt-1 text-slate-600">
                  {version.reason === '' ? '—' : version.reason}
                </p>
              )}

              <div className="mt-2 flex flex-wrap gap-2">
                <button
                  type="button"
                  className={BUTTON_CLASS}
                  disabled={restore.isPending}
                  onClick={() => {
                    handleRestore(version);
                  }}
                >
                  Restore
                </button>
                <button
                  type="button"
                  className={BUTTON_CLASS}
                  aria-expanded={diffVersionId === version.id}
                  onClick={() => {
                    setDiffVersionId(diffVersionId === version.id ? null : version.id);
                  }}
                >
                  Diff
                </button>
                <button
                  type="button"
                  className={BUTTON_CLASS}
                  onClick={() => {
                    setRenaming({ id: version.id, reason: version.reason });
                  }}
                >
                  Rename
                </button>
                <button
                  type="button"
                  className={BUTTON_CLASS}
                  onClick={() => {
                    handlePin(version);
                  }}
                >
                  {version.pinned ? 'Unpin' : 'Pin'}
                </button>
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
            </li>
          ))}
        </ol>
      ) : null}
    </section>
  );
}

function SourceBadge(props: { kind: string }): JSX.Element {
  const label = SOURCE_LABELS[props.kind] ?? props.kind;
  return props.kind === 'external' ? (
    <span className="rounded-md bg-amber-100 px-1.5 text-xs font-medium text-amber-900">
      {label}
    </span>
  ) : (
    <span className="rounded-md bg-slate-200 px-1.5 text-xs font-medium text-slate-700">
      {label}
    </span>
  );
}

/** What changed between the selected version and the current object. */
function DiffView(props: { changes: FieldChange[] | null }): JSX.Element {
  if (props.changes === null) {
    return <p className="mt-2 text-xs text-slate-600">Loading the comparison…</p>;
  }
  if (props.changes.length === 0) {
    return (
      <p className="mt-2 text-xs text-slate-600">
        This version is identical to the current object.
      </p>
    );
  }
  return (
    <div className="mt-2 overflow-x-auto">
      <table className="w-full border-collapse text-xs">
        <thead>
          <tr className="border-b border-slate-200 text-start text-slate-600">
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
            <tr key={change.path} className="border-b border-slate-100 align-top">
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
