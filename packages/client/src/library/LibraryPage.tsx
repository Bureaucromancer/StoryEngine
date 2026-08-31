// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { getRouteApi, Link, useNavigate } from '@tanstack/react-router';
import { useState, type JSX } from 'react';

import { newActor } from '@storyengine/shared';

import { kindOfSchema, LIBRARY_KINDS, type LibraryKind, type LibraryObject } from '../api.js';
import { useCreateObject, useLibrary } from '../queries.js';
import { Alert } from '../ui/Alert.js';
import { Button } from '../ui/Button.js';
import { control, page } from '../ui/classes.js';
import { KIND_LABELS, ShadowedBadge, SourceBadge } from './labels.js';

/**
 * The library list, as P1.6 built it: one surface for all six kinds with a kind
 * filter, the filter living in the URL's search params so a filtered view is a
 * link like any other.
 *
 * **The position this was built from has since been reversed.**
 * [05 §5](../../../../docs/design/05-ui-surfaces.md) now calls for one panel per kind — the
 * kinds are distinct by design and a merged table teaches otherwise — with the
 * all-kinds view kept behind a preference. The routing and the shared list
 * machinery here are what that is built out of; see
 * [polish §4](../../../../docs/design/workplan/09-polish.md) for the change.
 *
 * **Making something lives here as of [P4.−1]**, and only for actors. That is
 * not a shortcut around the other five:
 * [05 §11.2d](../../../../docs/design/05-ui-surfaces.md) says the first editor owes
 * create, and the inverse of it is the rule this page follows — a New control
 * for a kind with no editor lands the user on a read-only page holding an empty
 * object they cannot fill in, which is a blank-page dead end rather than a
 * create affordance. The five arrive when their editors do.
 */

const routeApi = getRouteApi('/library');

export function LibraryPage(): JSX.Element {
  const search = routeApi.useSearch();
  const library = useLibrary(search.kind);

  return (
    // The page's own column, now that the shell's `<main>` is a bare scroll
    // container ([P3.−1] — `ui/classes.ts` has the why).
    <div className={page.tooling}>
      <h1 className="mb-4 text-title text-ink">Library</h1>
      <nav aria-label="Filter by kind" className="mb-6 flex flex-wrap gap-2">
        <FilterLink kind={undefined} current={search.kind} />
        {LIBRARY_KINDS.map((kind) => (
          <FilterLink key={kind} kind={kind} current={search.kind} />
        ))}
      </nav>

      <MakeSomething kind={search.kind} />

      {library.isPending ? <p className="text-ink-subtle">Loading the library…</p> : null}
      {library.isError ? (
        <p role="alert" className="text-danger-ink">
          {library.error.message}
        </p>
      ) : null}
      {library.data !== undefined ? (
        <ObjectTable objects={library.data.objects} kind={search.kind} />
      ) : null}
    </div>
  );
}

/**
 * The create control, or the sentence that says why there is not one.
 *
 * **A sentence rather than a disabled button.** A greyed *New lorebook* is the
 * placeholder [Field](../ui/Field.tsx) rejects by name and
 * [work plan §2.2](../../../../docs/design/workplan/01-work-plan.md) rejects in
 * general: it promises a control that cannot work and teaches nothing about
 * why. The sentence names the path that does work instead.
 */
function MakeSomething(props: { kind: LibraryKind | undefined }): JSX.Element {
  if (props.kind === undefined || props.kind === 'actors') return <NewActorForm />;
  return (
    <p className="mb-6 text-sm text-ink-subtle">
      Actors are the only kind that can be made here: creating one lands in an editor, and the other
      kinds have none yet. The API creates any of them.
    </p>
  );
}

/**
 * Name it, and you are in the editor.
 *
 * The shape is [SessionsPage](../play/SessionsPage.tsx)'s deliberately — one
 * field and one button, inline above the list rather than behind a modal —
 * because it is the same job, and because it survives
 * [polish §4](../../../../docs/design/workplan/09-polish.md)'s per-kind panels
 * unchanged: when *Actors* is a panel rather than a filter, this form is
 * already that panel's.
 *
 * **Nothing here builds an actor by hand.** `newActor` is what the API's own
 * create path calls, so the four conventional sections
 * ([10 §4](../../../../docs/design/10-schemas.md)) exist on an actor made in the
 * browser exactly as they do on one made with `curl`. A local literal would be
 * a second definition of *what a new actor is*, and the one that drifted.
 */
function NewActorForm(): JSX.Element {
  const navigate = useNavigate();
  const create = useCreateObject();
  const [name, setName] = useState('');
  const ready = name.trim().length > 0;

  return (
    <div className="mb-6">
      <form
        className="flex gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          if (!ready || create.isPending) return;
          create.mutate(
            {
              kind: 'actors',
              object: newActor(name.trim()),
            },
            {
              // The id the *server* answered with, not the one minted above.
              // They agree today — `create()` echoes what it was posted — and
              // routing on the response is what keeps that an implementation
              // detail rather than something this page depends on.
              onSuccess: (result) => {
                setName('');
                void navigate({ to: '/library/actors/$id/edit', params: { id: result.id } });
              },
            },
          );
        }}
      >
        <label className="flex-1">
          <span className="sr-only">Name for the new actor</span>
          <input
            className={control}
            value={name}
            placeholder="A new actor"
            onChange={(event) => {
              setName(event.target.value);
            }}
          />
        </label>
        <Button type="submit" variant="primary" disabled={!ready || create.isPending}>
          New actor
        </Button>
      </form>

      {create.isError ? (
        // Shown rather than swallowed. A factory-built actor should never be
        // refused as invalid, which is exactly why a refusal here has to be
        // visible: it means the schema and the factory have parted company.
        <Alert tone="error" role="alert" className="mt-2">
          {create.error.message}
        </Alert>
      ) : null}
    </div>
  );
}

function FilterLink(props: {
  kind: LibraryKind | undefined;
  current: LibraryKind | undefined;
}): JSX.Element {
  const active = props.kind === props.current;
  return (
    <Link
      to="/library"
      search={props.kind === undefined ? {} : { kind: props.kind }}
      aria-current={active ? 'page' : undefined}
      className={
        active
          ? 'rounded-md bg-accent px-3 py-1 text-sm font-medium text-on-accent'
          : 'rounded-md bg-surface px-3 py-1 text-sm text-ink-muted ' +
            'border border-line-strong hover:bg-surface-muted'
      }
    >
      {props.kind === undefined ? 'All kinds' : KIND_LABELS[props.kind]}
    </Link>
  );
}

function ObjectTable(props: {
  objects: LibraryObject[];
  kind: LibraryKind | undefined;
}): JSX.Element {
  if (props.objects.length === 0) {
    return (
      <p className="text-ink-subtle">
        {props.kind === undefined
          ? // This used to name the API as the only way in, which stopped being
            // true at [P4.−1]. The word it still owes is "import", and that one
            // belongs to P4.4 along with the surface behind it.
            'The library is empty. Name an actor above to make one, or drop a folder into the data directory — anything the API creates appears here too.'
          : 'There is nothing of this kind in the library yet.'}
      </p>
    );
  }

  return (
    <table className="w-full border-collapse">
      <thead>
        <tr className="border-b border-line-strong text-sm text-ink-subtle">
          <th scope="col" className="py-2 pe-4 text-start font-medium">
            Name
          </th>
          <th scope="col" className="py-2 pe-4 text-start font-medium">
            Kind
          </th>
          <th scope="col" className="py-2 text-start font-medium">
            Source
          </th>
        </tr>
      </thead>
      <tbody>
        {props.objects.map((object) => (
          <ObjectRow key={`${object.source}:${object.id}:${object.slug}`} object={object} />
        ))}
      </tbody>
    </table>
  );
}

function ObjectRow(props: { object: LibraryObject }): JSX.Element {
  const kind = kindOfSchema(props.object.schema);
  return (
    <tr className="border-b border-line">
      <td className="py-2 pe-4">
        <span className="flex items-center gap-2">
          {kind === null ? (
            <span>{props.object.name}</span>
          ) : (
            <Link
              to="/library/$kind/$id"
              params={{ kind, id: props.object.id }}
              // A shadowed row carries where it lives, because the id alone
              // resolves to the winner — which is what made this link open the
              // wrong object while the page insisted otherwise (F19). Ordinary
              // rows stay id-only: one object, one address.
              search={
                props.object.shadowed
                  ? { source: props.object.source, slug: props.object.slug }
                  : {}
              }
              className="font-medium text-ink underline decoration-line-strong hover:decoration-ink-subtle"
            >
              {props.object.name}
            </Link>
          )}
          {props.object.shadowed ? <ShadowedBadge /> : null}
        </span>
      </td>
      <td className="py-2 pe-4 text-sm text-ink-subtle">
        {kind === null ? props.object.schema : KIND_LABELS[kind]}
      </td>
      <td className="py-2">
        <SourceBadge source={props.object.source} />
      </td>
    </tr>
  );
}
