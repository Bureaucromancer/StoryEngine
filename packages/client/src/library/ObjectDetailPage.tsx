// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { getRouteApi, Link, useNavigate } from '@tanstack/react-router';
import { useState, type JSX } from 'react';

import {
  ApiError,
  isLibraryKind,
  type LibraryKind,
  type LibraryObject,
  type ObjectAddress,
} from '../api.js';
import { formatTimestamp, timestampsOf } from '../format.js';
import { useAuthState, useDeleteObject, useLibraryObject } from '../queries.js';
import { Alert } from '../ui/Alert.js';
import { Button } from '../ui/Button.js';
import { link, page } from '../ui/classes.js';
import { Dialog } from '../ui/Dialog.js';
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
 *
 * **Delete lives here as of [P4.−1]**, and unlike the Edit link beside it, it
 * is kind-general: removing a folder needs no editor, so every kind a user owns
 * can be unmade from the page that shows it.
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

/**
 * Whether this page may offer to *change* what it is showing — the one gate
 * behind both Edit and Delete.
 *
 * One predicate rather than two spellings, which is
 * [polish §1](../../../../docs/design/workplan/09-polish.md)'s closing note taken at its
 * word: the Edit condition used to be written out inline, and a second
 * hand-written copy of it for Delete is how the two drift apart on the day a
 * third source or a third state arrives.
 *
 * Two conditions, and the second is the one worth explaining. `source` is the
 * obvious half: the system library is read-only and the server would answer
 * 403 anyway ([04 §4.3](../../../../docs/design/04-server-multiuser-deployment.md)).
 *
 * **`shadowed` is F19 wearing a third hat.** Two files can hold the same id;
 * this page can be addressed at either through `?source=&slug=`, but every
 * *write* route resolves the id to the winner and nothing on the wire can say
 * otherwise. So a Delete offered on the shadowed copy would move a different
 * folder than the one on screen — the exact confusion the address parameter
 * was added to end, with the stakes raised from "shows the wrong object" to
 * "removes the wrong object". The affordance is withheld rather than made to
 * lie. Resolving the duplicate is a file-system job until there is a surface
 * for it ([02 §5.1](../../../../docs/design/02-data-model.md)).
 */
function mutable(object: LibraryObject): boolean {
  return object.source === 'user' && !object.shadowed;
}

function ObjectView(props: {
  object: LibraryObject;
  kind: LibraryKind;
  locale: string | undefined;
}): JSX.Element {
  const { object, kind, locale } = props;
  const stamps = timestampsOf(object.object);
  const [confirming, setConfirming] = useState(false);

  return (
    <>
      <BackLink />
      <header className="mb-6 flex flex-wrap items-center gap-3">
        <h1 className="text-title text-ink">{object.name}</h1>
        <SourceBadge source={object.source} />
        {object.shadowed ? <ShadowedBadge /> : null}
        <span className="ms-auto flex items-center gap-3">
          {kind === 'actors' && mutable(object) ? (
            <Link to="/library/actors/$id/edit" params={{ id: object.id }} className={link.action}>
              Edit
            </Link>
          ) : null}
          {mutable(object) ? (
            <Button
              type="button"
              variant="dangerOutline"
              size="compact"
              onClick={() => {
                setConfirming(true);
              }}
            >
              Delete
            </Button>
          ) : null}
        </span>
      </header>

      {confirming ? (
        <DeleteObjectDialog
          object={object}
          kind={kind}
          onDismiss={() => {
            setConfirming(false);
          }}
        />
      ) : null}

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

/**
 * The confirmation, and what it is careful to claim.
 *
 * **`role="dialog"`, not `alertdialog`.** [Dialog](../ui/Dialog.tsx)'s rule is
 * that `alertdialog` belongs to a dialog raised *because something went wrong*;
 * this one the user opened on purpose, and a destructive question is still a
 * question. (`RemoveConnectionDialog` in the settings surface says
 * `alertdialog` for the same shape. One of the two is wrong and this is the
 * one that followed the rule as written.)
 *
 * **It says what it does not check, because it cannot yet check it.**
 * [02 §10.1](../../../../docs/design/02-data-model.md) specifies a
 * reference-counted confirmation — *referenced by 12 sessions, 3 treatments and
 * 1 package* — and there is no backlinks query in the codebase to build it
 * from. Dangling references are survivable, visible and non-blocking by stance
 * ([00 §3.3](../../../../docs/design/00-stance.md)), so shipping without the counts is
 * defensible; shipping without *saying* the counts are missing would be the
 * dialog quietly implying a check it never ran.
 */
function DeleteObjectDialog(props: {
  object: LibraryObject;
  kind: LibraryKind;
  onDismiss: () => void;
}): JSX.Element {
  const navigate = useNavigate();
  const remove = useDeleteObject();
  // A 412 here means the same thing it means on a save, and it is the reason
  // the hash is sent at all: something changed the file after this page read
  // it, and deleting on a stale read would discard an edit nobody saw.
  const stale = remove.error instanceof ApiError && remove.error.status === 412;

  return (
    <Dialog role="dialog" labelledBy="delete-object" onDismiss={props.onDismiss}>
      <h2 id="delete-object" className="mb-2 text-section text-ink">
        {deleteTitle(props.object.name)}
      </h2>
      <p className="mb-1 text-sm text-ink-muted">{trashNote()}</p>
      <p className="mb-2">
        <code className="text-xs text-ink-muted">{trashPath(props.kind)}</code>
      </p>
      <p className="mb-4 text-sm text-ink-subtle">
        Nothing checks what refers to this first. Anything pointing at it keeps the reference and
        shows it as missing.
      </p>

      {remove.isError ? (
        <Alert tone="error" role="alert" className="mb-4">
          {stale
            ? 'This object changed on disk after the page read it, so it was not deleted. Reload and look at it again before deciding.'
            : remove.error.message}
        </Alert>
      ) : null}

      {/* "Delete it" rather than a second "Delete": the control that opened
          this dialog is still on the page behind it, and two buttons with one
          accessible name is a question ("which Delete?") with no answer for
          anyone navigating by name. */}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="secondary" onClick={props.onDismiss}>
          Keep it
        </Button>
        <Button
          type="button"
          variant="danger"
          disabled={remove.isPending}
          onClick={() => {
            remove.mutate(
              { kind: props.kind, id: props.object.id, contentHash: props.object.contentHash },
              {
                onSuccess: () => {
                  void navigate({ to: '/library', search: {} });
                },
              },
            );
          }}
        >
          Delete it
        </Button>
      </div>
    </Dialog>
  );
}

/**
 * Whole sentences, per the i18n rule
 * ([work plan §2](../../../../docs/design/workplan/01-work-plan.md)) — word order moves
 * between languages, so a sentence half in JSX and half in a value cannot be
 * translated at all. The path is the one thing that is *not* a sentence
 * fragment: it is a value the note points at, on its own line, which is also
 * how it keeps the `<code>` styling the page's disk-is-legible stance wants
 * ([05 §5](../../../../docs/design/05-ui-surfaces.md)).
 */
function deleteTitle(name: string): string {
  return `Delete ${name}?`;
}

function trashNote(): string {
  return 'Its folder moves to your trash, version history and all — nothing is erased. It stays on disk here:';
}

function trashPath(kind: LibraryKind): string {
  return `trash/${kind}/`;
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
