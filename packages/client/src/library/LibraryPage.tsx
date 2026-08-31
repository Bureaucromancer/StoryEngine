// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { getRouteApi, Link } from '@tanstack/react-router';
import type { JSX } from 'react';

import { kindOfSchema, LIBRARY_KINDS, type LibraryKind, type LibraryObject } from '../api.js';
import { usePatchPrefs, usePrefs, useLibrary } from '../queries.js';
import { Button } from '../ui/Button.js';
import { page } from '../ui/classes.js';
import { workbenchOpenFromPrefs, workbenchOpenPatch } from '../workbench/prefs.js';
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
 */

const routeApi = getRouteApi('/library');

export function LibraryPage(): JSX.Element {
  const search = routeApi.useSearch();
  const library = useLibrary(search.kind);

  return (
    // The page's own column, now that the shell's `<main>` is a bare scroll
    // container ([P3.−1] — `ui/classes.ts` has the why).
    <div className={page.tooling}>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-title text-ink">Library</h1>
        <ImportButton />
      </div>
      <nav aria-label="Filter by kind" className="mb-6 flex flex-wrap gap-2">
        <FilterLink kind={undefined} current={search.kind} />
        {LIBRARY_KINDS.map((kind) => (
          <FilterLink key={kind} kind={kind} current={search.kind} />
        ))}
      </nav>

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
 * The way to import, now that the panel lives in the dock.
 *
 * **An entry point has to survive the move.** [05 §5] says the empty library
 * *"points at import"*, and a feature reachable only by knowing that Ctrl+`
 * opens a panel which happens to show it over this route is not pointed at by
 * anything. So the page keeps a control, and the control's whole job is to open
 * the dock — which is why it patches the preference rather than routing
 * anywhere: [P3 §1.2] is explicit that the panel's open state is a preference
 * and deliberately **not** the URL, because a URL-addressable panel is a place,
 * and §3 spent its argument on the panel not being one.
 *
 * Deliberately not disabled or hidden when the dock is already open: the button
 * is where somebody looks for import, and a control that vanishes once it has
 * worked is a control you cannot find twice.
 */
function ImportButton(): JSX.Element {
  const prefs = usePrefs();
  const patchPrefs = usePatchPrefs();
  const open = workbenchOpenFromPrefs(prefs.data?.prefs);

  return (
    <Button
      type="button"
      size="compact"
      aria-expanded={open}
      aria-controls={open ? 'workbench' : undefined}
      onClick={() => {
        if (!open) patchPrefs.mutate(workbenchOpenPatch(true));
      }}
    >
      Import…
    </Button>
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
        {/*
         * **The empty state finally knows the word "import"** ([P4 §2], P4.4).
         * It used to name the two ways in that existed — an API call and a file
         * dropped into the data directory — which is an honest sentence to
         * write when those are the only two, and a strange one to leave up once
         * a person can point the app at their SillyTavern folder.
         */}
        {props.kind === undefined
          ? 'The library is empty. Import from SillyTavern or Marinara above, or create objects through the API — anything dropped into the data directory appears here too.'
          : 'There is nothing of this kind in the library yet. An import may bring some.'}
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
