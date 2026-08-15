// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { getRouteApi, Link } from '@tanstack/react-router';
import type { JSX, ReactNode } from 'react';

import { ApiError, isLibraryKind, type LibraryKind, type LibraryObject } from '../api.js';
import { formatTimestamp, timestampsOf } from '../format.js';
import { useAuthState, useLibraryObject } from '../queries.js';
import { KIND_LABELS, ShadowedBadge, SourceBadge } from './labels.js';

/**
 * The detail view. Read-only at this stage — editing is P1.7, and keeping the
 * stages separate is deliberate: this one is what the hot-reload demo runs on
 * ([19 §P1.6](docs/design/19-p1-implementation.md)).
 *
 * The disk layout is shown on purpose. The folder *is* the object, and exposing
 * that is how a user learns the storage model is theirs to touch
 * ([05 §5](docs/design/05-ui-surfaces.md)).
 */

const routeApi = getRouteApi('/library/$kind/$id');

export function ObjectDetailPage(): JSX.Element {
  const params = routeApi.useParams();
  if (!isLibraryKind(params.kind)) {
    return (
      <>
        <BackLink />
        <p role="alert" className="text-red-900">
          This address does not name a known kind of library object.
        </p>
      </>
    );
  }
  return <ObjectDetail kind={params.kind} id={params.id} />;
}

function ObjectDetail(props: { kind: LibraryKind; id: string }): JSX.Element {
  const query = useLibraryObject(props.kind, props.id);
  const auth = useAuthState();
  const locale = auth.data?.account?.locale ?? undefined;

  if (query.isPending) {
    return (
      <>
        <BackLink />
        <p className="text-slate-600">Loading…</p>
      </>
    );
  }

  if (query.isError) {
    const missing = query.error instanceof ApiError && query.error.status === 404;
    return (
      <>
        <BackLink />
        <p role="alert" className="text-red-900">
          {missing ? 'There is no such object in your library.' : query.error.message}
        </p>
      </>
    );
  }

  return <ObjectView object={query.data} kind={props.kind} locale={locale} />;
}

function ObjectView(props: {
  object: LibraryObject;
  kind: LibraryKind;
  locale: string | undefined;
}): JSX.Element {
  const { object, kind, locale } = props;
  const stamps = timestampsOf(object.object);

  return (
    <>
      <BackLink />
      <header className="mb-6 flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-semibold">{object.name}</h1>
        <SourceBadge source={object.source} />
        {object.shadowed ? <ShadowedBadge /> : null}
      </header>

      {object.shadowed ? (
        <p
          role="note"
          className="mb-6 rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-900"
        >
          Another folder on disk holds the same id at an earlier path, and that copy is the one
          that loads. Nothing is lost; this copy is shown so the duplicate stays visible.
        </p>
      ) : null}

      <dl className="mb-8 grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-sm">
        <MetadataRow label="Kind">{KIND_LABELS[kind]}</MetadataRow>
        <MetadataRow label="Folder">
          <code className="text-xs">
            {kind}/{object.slug}/
          </code>
        </MetadataRow>
        <MetadataRow label="Identifier">
          <code className="text-xs">{object.id}</code>
        </MetadataRow>
        <MetadataRow label="Schema">
          <code className="text-xs">{object.schema}</code>
        </MetadataRow>
        {stamps.createdAt === null ? null : (
          <MetadataRow label="Created">{formatTimestamp(stamps.createdAt, locale)}</MetadataRow>
        )}
        {stamps.updatedAt === null ? null : (
          <MetadataRow label="Updated">{formatTimestamp(stamps.updatedAt, locale)}</MetadataRow>
        )}
        <MetadataRow label="Content hash">
          <code className="break-all text-xs">{object.contentHash}</code>
        </MetadataRow>
      </dl>

      <section aria-label="The object as stored">
        <h2 className="mb-2 text-lg font-semibold">As stored</h2>
        <pre className="overflow-x-auto rounded-md border border-slate-200 bg-white p-4 text-xs">
          {JSON.stringify(object.object, null, 2)}
        </pre>
      </section>
    </>
  );
}

function MetadataRow(props: { label: string; children: ReactNode }): JSX.Element {
  return (
    <>
      <dt className="font-medium text-slate-600">{props.label}</dt>
      <dd className="text-slate-900">{props.children}</dd>
    </>
  );
}

function BackLink(): JSX.Element {
  return (
    <p className="mb-4">
      <Link to="/" search={{}} className="text-sm text-slate-600 underline hover:text-slate-900">
        Back to the library
      </Link>
    </p>
  );
}
