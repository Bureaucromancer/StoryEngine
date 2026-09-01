// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { useQueryClient } from '@tanstack/react-query';
import { getRouteApi, Link, useNavigate } from '@tanstack/react-router';
import { useState, type JSX } from 'react';

import type { Lorebook } from '@storyengine/shared';

import {
  api,
  ApiError,
  isLibraryKind,
  type LibraryKind,
  type LibraryObject,
  type ObjectAddress,
} from '../api.js';
import { formatTimestamp, timestampsOf } from '../format.js';
import { useAuthState, useLibraryObject } from '../queries.js';
import { Alert } from '../ui/Alert.js';
import type { ObjectSearch } from '../router.js';
import { link, page } from '../ui/classes.js';
import { MetadataRow } from '../ui/MetadataRow.js';
import { SectionTitle } from '../ui/Text.js';
import { AsStored } from './AsStored.js';
import { ByField } from './ByField.js';
import { editorRouteFor } from './fields.js';
import { LorebookView, lorebookShape } from './LorebookView.js';
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
        search={search}
        {...(search.slug === undefined
          ? {}
          : { at: { source: search.source ?? 'user', slug: search.slug } })}
      />
    </div>
  );
}

function ObjectDetail(props: {
  kind: LibraryKind;
  id: string;
  search: ObjectSearch;
  at?: ObjectAddress;
}): JSX.Element {
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

  return <ObjectView object={query.data} kind={props.kind} locale={locale} search={props.search} />;
}

/**
 * Whether this page may offer to *change* what it is showing — the one gate
 * behind both Edit and Delete.
 *
 * One predicate rather than two spellings, which is
 * [polish §1](../../../../docs/design/workplan/09-polish.md)'s closing note taken at its
 * word: the Edit condition was written out inline, Delete grew a second and
 * shorter hand-written copy of it, and the two had already drifted by the time
 * they were put side by side.
 *
 * **They had drifted on `shadowed`, and that was the bug.** Delete asked only
 * about `source`. But two files can hold one id, this page can be addressed at
 * either through `?source=&slug=`, and every *write* route resolves an id to
 * the winner regardless — so Delete on the losing copy moved a folder other
 * than the one on screen. That is F19 with the stakes raised from *shows the
 * wrong object* to *removes the wrong object*, and no server-side check can
 * catch it, because from the server's side the request is perfectly
 * well-formed. The affordance is withheld rather than made to lie; resolving a
 * duplicate stays a file-system job until there is a surface for it
 * ([02 §5.1](../../../../docs/design/02-data-model.md)).
 */
function mutable(object: LibraryObject): boolean {
  return object.source === 'user' && !object.shadowed;
}

function ObjectView(props: {
  object: LibraryObject;
  kind: LibraryKind;
  locale: string | undefined;
  search: ObjectSearch;
}): JSX.Element {
  const { object, kind, locale } = props;
  const stamps = timestampsOf(object.object);
  const editorRoute = editorRouteFor(kind);

  return (
    <>
      <BackLink />
      <header className="mb-6 flex flex-wrap items-center gap-3">
        <h1 className="text-title text-ink">{object.name}</h1>
        <SourceBadge source={object.source} />
        {object.shadowed ? <ShadowedBadge /> : null}
        {/*
         * The kind gate comes from the same place the fields do
         * ([polish §1](../../../../docs/design/workplan/09-polish.md)), and it
         * carries the address with it: this branch used to name `actors`
         * twice — once in the condition and once in the route — so widening
         * one without the other would have opened a lorebook in the actor
         * editor.
         */}
        {editorRoute !== null && mutable(object) ? (
          <Link to={editorRoute} params={{ id: object.id }} className={`ms-auto ${link.action}`}>
            Edit
          </Link>
        ) : null}
        {mutable(object) ? <DeleteButton object={object} kind={kind} /> : null}
      </header>

      {object.shadowed ? (
        <Alert tone="error" className="mb-6">
          Another folder on disk holds the same id at an earlier path, and that copy is the one that
          loads. Nothing is lost; this copy is shown so the duplicate stays visible.
        </Alert>
      ) : null}

      {/*
       * **The fields first, and the storage facts under a heading below them.**
       * Reordered here rather than left where it was, because
       * [polish §1](../../../../docs/design/workplan/09-polish.md)'s complaint
       * is that this page answers *where is this file* when the question was
       * *what does it say* — and a build of that item which left seven rows of
       * path and hash above the prose would have answered in the same order.
       * The block is not demoted out of sight: [05 §5] wants the disk layout
       * legible, and a heading is what turns a lead paragraph into a section.
       */}
      <ObjectBody object={object} kind={kind} search={props.search} />

      <SectionTitle as="h2" className="mb-2 mt-8">
        Storage
      </SectionTitle>
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

/**
 * What the detail route renders for the object itself.
 *
 * **One route, two bodies, and the second is not a promotion.** A lorebook is
 * the only library kind whose object is a collection
 * ([16 §1.1](../../../../docs/design/16-lorebooks-as-a-format.md)), so a
 * by-field rendering of it is off by one level — a three-hundred-element array
 * under a label is not a reading surface. Every other kind is unchanged, and
 * lorebooks keep this route, its header, its storage block and its *As stored*
 * fold ([05 §5.3](../../../../docs/design/05-ui-surfaces.md): *not a new page*).
 *
 * **A book this build cannot read falls back rather than failing.** A
 * hand-edited file is the storage thesis working, so the guard runs first and
 * the by-field view renders whatever is actually on disk — which is more useful
 * than a book page insisting the file is a book.
 */
function ObjectBody(props: {
  object: LibraryObject;
  kind: LibraryKind;
  search: ObjectSearch;
}): JSX.Element {
  const { object, search } = props;

  if (props.kind === 'lorebooks' && lorebookShape(object.object) === null) {
    return (
      <LorebookView
        book={object.object as unknown as Lorebook}
        focused={search.entry ?? null}
        linkToEntry={(entryId, children) => (
          /**
           * **Every link on this page is built here**, which is the same
           * discipline that keeps the panel from reintroducing F19 one level
           * up: the address of a copy is `?source=&slug=`, and an entry link
           * that dropped them would send somebody from the shadowed copy they
           * are reading to the winner. So the current search is spread and only
           * `entry` is added.
           */
          <Link
            to="/library/$kind/$id"
            params={{ kind: 'lorebooks', id: object.id }}
            search={{ ...search, entry: entryId }}
            className={link.object}
          >
            {children}
          </Link>
        )}
      />
    );
  }
  return <ByField schemaId={object.schema} value={object.object} />;
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

/**
 * **Delete, which the server has been able to do since P1 and no surface could
 * reach** ([P4 §1.4]).
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
 * ([02 §10.2](../../../../docs/design/02-data-model.md)).
 */
function DeleteButton(props: { object: LibraryObject; kind: LibraryKind }): JSX.Element {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const remove = async (): Promise<void> => {
    setError(null);
    try {
      await api.deleteObject(props.kind, props.object.id, props.object.contentHash);
      // The list is now wrong in a way it cannot detect. `resetQueries` rather
      // than `removeQueries`: a destroyed entry does not notify its observers
      // ([P3.5]).
      await queryClient.resetQueries({ queryKey: ['library'] });
      await navigate({ to: '/library' });
    } catch (cause) {
      // A 412 here means somebody edited it while this page was open, which is
      // exactly when a delete should stop and say so.
      setError(cause instanceof Error ? cause.message : 'It could not be deleted.');
      setConfirming(false);
    }
  };

  return (
    <span className="ms-auto flex items-center gap-3 text-sm">
      {/*
       * **The message lives outside both branches, and that is a fix.** It used
       * to render only inside the confirming row — but the `catch` above calls
       * `setConfirming(false)`, so the branch that would have shown it had just
       * been replaced by the one that would not. A refused delete rendered
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
      {confirming ? (
        <>
          <span className="text-ink-subtle">Move to trash?</span>
          <button type="button" onClick={() => void remove()} className={link.action}>
            Delete
          </button>
          <button
            type="button"
            onClick={() => {
              setConfirming(false);
            }}
            className={link.action}
          >
            Cancel
          </button>
        </>
      ) : (
        <button
          type="button"
          onClick={() => {
            // Clearing here rather than on the next attempt: a stale message
            // beside a fresh question is worse than no message.
            setError(null);
            setConfirming(true);
          }}
          className={link.action}
        >
          Delete
        </button>
      )}
    </span>
  );
}
