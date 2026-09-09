// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import type { JSX } from 'react';

import type { IndexRow, LibraryKind, LibraryObject, ObjectVersion } from '../../api.js';
import { formatTimestamp } from '../../format.js';
import { AsStored } from '../../library/AsStored.js';
import { RevisionList } from '../../library/RevisionList.js';
import { MetadataRow } from '../../ui/MetadataRow.js';
import { Fine, Note, SubsectionTitle } from '../../ui/Text.js';
import { IndexRowTable } from './IndexRowTable.js';

/**
 * The library subject, rendered — [10 §3]'s *raw truth of that object*: the
 * folder path, provenance as rows, the JSON as stored, the read-only
 * revision list, and the index rows. Strictly a reader over what the store
 * answered, like the turn subject beside it; the detail page underneath
 * shows the object's front, and the panel's win is depth without the visit.
 *
 * The folder comes from the **subject's own index row** — matched by
 * `(source, slug)`, the same discriminator that addresses a copy — because
 * over a shadowed copy the winner's folder would be exactly the wrong
 * answer: the one question this panel exists to settle is which path is
 * which.
 *
 * Provenance renders **whole**, not the two timestamps the detail page kept
 * ([P3.3]'s "rows rather than two timestamps"): origin, creator, the
 * author's own version string, license, original filename. Null fields are
 * omitted — nothing was recorded, so nothing is claimed — and a body with
 * no provenance at all says so, because *this never happened* and *this is
 * empty* are different claims everywhere in this codebase.
 */

const PROVENANCE_LABELS: Record<string, string> = {
  manual: 'Made in the app',
  import: 'Imported',
  generated: 'Generated',
  package: 'From a package',
  session: 'From a session',
};

interface ProvenanceView {
  source: string | null;
  creator: string | null;
  version: string | null;
  license: string | null;
  originalFilename: string | null;
  createdAt: string | null;
  updatedAt: string | null;
}

/**
 * A defensive read, not a validation: the body is whatever the store holds
 * (hand edits are a feature), so each field is used only if it is the string
 * the schema promises and silently omitted otherwise — the as-stored fold
 * below is where a malformed shape can be seen as itself.
 */
function readProvenance(body: Record<string, unknown>): ProvenanceView | null {
  const raw = body['provenance'];
  if (typeof raw !== 'object' || raw === null) return null;
  const fields = raw as Record<string, unknown>;
  const text = (key: string): string | null => {
    const value = fields[key];
    return typeof value === 'string' ? value : null;
  };
  return {
    source: text('source'),
    creator: text('creator'),
    version: text('version'),
    license: text('license'),
    originalFilename: text('originalFilename'),
    createdAt: text('createdAt'),
    updatedAt: text('updatedAt'),
  };
}

export function ObjectSubject({
  kind,
  object,
  rows,
  versions,
  locale,
}: {
  kind: LibraryKind;
  object: LibraryObject;
  rows: IndexRow[] | undefined;
  versions: ObjectVersion[] | undefined;
  locale: string | undefined;
}): JSX.Element {
  const subjectRow = rows?.find((row) => row.source === object.source && row.slug === object.slug);
  const folder =
    subjectRow === undefined ? undefined : `${subjectRow.path.split('/').slice(0, -1).join('/')}/`;
  const provenance = readProvenance(object.object);

  return (
    <div className="flex flex-col gap-4">
      <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-1 text-sm">
        {folder === undefined ? null : (
          <MetadataRow label="Folder">
            <code className="break-all text-xs">{folder}</code>
          </MetadataRow>
        )}
        {provenance === null ? null : (
          <>
            {provenance.source === null ? null : (
              <MetadataRow label="Origin">
                {PROVENANCE_LABELS[provenance.source] ?? provenance.source}
              </MetadataRow>
            )}
            {provenance.creator === null ? null : (
              <MetadataRow label="Creator">{provenance.creator}</MetadataRow>
            )}
            {provenance.version === null ? null : (
              <MetadataRow label="Version">{provenance.version}</MetadataRow>
            )}
            {provenance.license === null ? null : (
              <MetadataRow label="License">{provenance.license}</MetadataRow>
            )}
            {provenance.originalFilename === null ? null : (
              <MetadataRow label="Original file">
                <code className="break-all text-xs">{provenance.originalFilename}</code>
              </MetadataRow>
            )}
            {provenance.createdAt === null ? null : (
              <MetadataRow label="Created">
                {formatTimestamp(provenance.createdAt, locale)}
              </MetadataRow>
            )}
            {provenance.updatedAt === null ? null : (
              <MetadataRow label="Updated">
                {formatTimestamp(provenance.updatedAt, locale)}
              </MetadataRow>
            )}
          </>
        )}
      </dl>
      {provenance === null ? (
        <Note>This object carries no provenance — the field is absent from the stored bytes.</Note>
      ) : null}

      <AsStored value={object.object} />

      <section aria-label="History" className="flex flex-col gap-2">
        <SubsectionTitle as="h4">History</SubsectionTitle>
        {versions === undefined ? (
          <Fine>Loading the history…</Fine>
        ) : (
          <RevisionList versions={versions} locale={locale} />
        )}
      </section>

      <IndexRowTable
        kind={kind}
        id={object.id}
        rows={rows}
        subject={{ source: object.source, slug: object.slug }}
        subjectShadowed={object.shadowed}
      />
    </div>
  );
}
