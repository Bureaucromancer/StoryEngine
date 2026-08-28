// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import type { JSX, ReactNode } from 'react';

import type { ObjectVersion } from '../api.js';
import { formatTimestamp } from '../format.js';
import { Badge } from '../ui/Badge.js';

/**
 * The revision list — **one component, two hosts, different powers**
 * ([P3 §1.4](../../../../docs/design/workplan/05-p3-implementation.md)): the
 * editor's history panel wraps it with restore, rename, pin and diff; the
 * workbench's library subject renders it bare, which is the whole read-only
 * point — *browse and inspect are raw; editing is assisted*, and restore is
 * an edit.
 *
 * What is shared is the *list*: the synthetic current entry pinned on top
 * ([13 §1.6](../../../../docs/design/13-internal-contracts.md) — the live
 * object is never written to the history file, so the list is where it gets
 * said), the empty state, and each revision's header row. Everything below a
 * header arrives through `body`, because the powers are exactly what the two
 * hosts do not share; the default body is the revision's reason, read-only.
 *
 * The source badge is not decoration. More things edit objects here than
 * anywhere else — a hand edit picked up from disk, a restore, later an
 * assist or an import — and *"who changed my character"* is the question
 * this list answers.
 */

const SOURCE_LABELS: Record<string, string> = {
  manual: 'Edited in the app',
  external: 'Hand edit on disk',
  restore: 'Restored',
  assist: 'Assist',
  extension: 'Extension',
  import: 'Import',
};

export function RevisionList({
  versions,
  locale,
  body,
}: {
  versions: ObjectVersion[];
  locale: string | undefined;
  /** The host's per-revision powers. Absent means read-only: the reason. */
  body?: ((version: ObjectVersion) => ReactNode) | undefined;
}): JSX.Element {
  return (
    <ol className="flex flex-col gap-2">
      <li className="rounded-md border border-line-strong bg-surface-sunken p-2 text-sm">
        <span className="font-medium">Current</span>
        <span className="ms-2 text-ink-subtle">The object as it is now.</span>
      </li>
      {versions.length === 0 ? (
        <li className="p-2 text-sm text-ink-subtle">
          No versions yet. The first edit records the state it replaces.
        </li>
      ) : null}
      {versions.map((version) => (
        <li key={version.id} className="rounded-md border border-line p-2 text-sm">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium">{`Revision ${String(version.revision)}`}</span>
            <SourceBadge kind={version.source.kind} />
            {version.pinned ? <Badge>Pinned</Badge> : null}
            <span className="text-ink-subtle">{formatTimestamp(version.authoredAt, locale)}</span>
            {version.authorVersion !== null ? (
              <span className="text-xs text-ink-faint">v{version.authorVersion}</span>
            ) : null}
          </div>
          {body === undefined ? (
            <p className="mt-1 text-ink-subtle">{version.reason === '' ? '—' : version.reason}</p>
          ) : (
            body(version)
          )}
        </li>
      ))}
    </ol>
  );
}

function SourceBadge(props: { kind: string }): JSX.Element {
  const label = SOURCE_LABELS[props.kind] ?? props.kind;
  return props.kind === 'external' ? (
    <Badge tone="provenance">{label}</Badge>
  ) : (
    <Badge>{label}</Badge>
  );
}
