// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { getRouteApi, Link } from '@tanstack/react-router';
import type { JSX } from 'react';

import {
  ApiError,
  isLibraryKind,
  type LibraryKind,
  type LibraryObject,
  type ObjectAddress,
} from '../api.js';
import { formatTimestamp, timestampsOf } from '../format.js';
import { useAuthState, useLibraryObject } from '../queries.js';
import { Alert } from '../ui/Alert.js';
import { link, page } from '../ui/classes.js';
import { MetadataRow } from '../ui/MetadataRow.js';
import { AsStored } from './AsStored.js';
import { KIND_LABELS, ShadowedBadge, SourceBadge } from './labels.js';

/**
 * The detail view. Read-only at this stage — editing is P1.7, and keeping the
 * stages separate is deliberate: this one is what the hot-reload demo runs on
 * ([P1 §P1.6](../../../../docs/design/workplan/03-p1-implementation.md)).
 *
 * The disk layout is shown on purpose. The folder *is* the object, and exposing
 * that is how a user learns the storage model is theirs to touch
 * ([05 §5](../../../../docs/design/05-ui-surfaces.md)).
 */

const routeApi = getRouteApi('/library/$kind/$id');

export function ObjectDetailPage(): JSX.Element {
  const params = routeApi.useParams();
  const search = routeApi.useSearch();
  if (!isLibraryKind(params.kind)) {
    return (
      // The page's own column ([P3.−1] — `ui/classes.ts` has the why), on
      // both branches, so a bad address is laid out like a good one.
      <div className={page.tooling}>
        <BackLink />
        <p role="alert" className="text-danger-ink">
          This address does not name a known kind of library object.
        </p>
      </div>
    );
  }
  return (
    <div className={page.tooling}>
      <ObjectDetail
        kind={params.kind}
        id={params.id}
        {...(search.slug === undefined
          ? {}
          : { at: { source: search.source ?? 'user', slug: search.slug } })}
      />
    </div>
  );
}

function ObjectDetail(props: { kind: LibraryKind; id: string; at?: ObjectAddress }): JSX.Element {
  const query = useLibraryObject(props.kind, props.id, props.at);
  const auth = useAuthState();
  const locale = auth.data?.account?.locale ?? undefined;

  if (query.isPending) {
    return (
      <>
        <BackLink />
        <p className="text-ink-subtle">Loading…</p>
      </>
    );
  }

  if (query.isError) {
    const missing = query.error instanceof ApiError && query.error.status === 404;
    return (
      <>
        <BackLink />
        <p role="alert" className="text-danger-ink">
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
        <h1 className="text-title text-ink">{object.name}</h1>
        <SourceBadge source={object.source} />
        {object.shadowed ? <ShadowedBadge /> : null}
        {kind === 'actors' && object.source === 'user' && !object.shadowed ? (
          <Link
            to="/library/actors/$id/edit"
            params={{ id: object.id }}
            className={`ms-auto ${link.action}`}
          >
            Edit
          </Link>
        ) : null}
      </header>

      {object.shadowed ? (
        <Alert tone="error" className="mb-6">
          Another folder on disk holds the same id at an earlier path, and that copy is the one that
          loads. Nothing is lost; this copy is shown so the duplicate stays visible.
        </Alert>
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

      <AsStored value={object.object} />
    </>
  );
}

function BackLink(): JSX.Element {
  return (
    <p className="mb-4">
      <Link to="/library" search={{}} className="text-sm text-ink-subtle underline hover:text-ink">
        Back to the library
      </Link>
    </p>
  );
}
