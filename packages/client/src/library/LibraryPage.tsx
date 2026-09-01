// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { getRouteApi, Link, useNavigate } from '@tanstack/react-router';
import { useState, type JSX } from 'react';

import { newActor } from '@storyengine/shared';

import { kindOfSchema, LIBRARY_KINDS, type LibraryKind, type LibraryObject } from '../api.js';
import { useAuthState, useCreateObject, useLibrary, usePatchPrefs, usePrefs } from '../queries.js';
import { Alert } from '../ui/Alert.js';
import { Button } from '../ui/Button.js';
import { control, link, page, table } from '../ui/classes.js';
import { SelectField } from '../ui/Field.js';
import { workbenchOpenFromPrefs, workbenchOpenPatch } from '../workbench/prefs.js';
import { KIND_LABELS, ShadowedBadge } from './labels.js';
import { emptyMessage, panelFor, panelNameBadges, type PanelColumn } from './panels.js';

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
 * **Two ways in, and they sit at different heights on purpose.** Import is the
 * bulk path and belongs to the whole library, so it is reached from above the
 * filter — ~~`ImportPanel` is above the filter~~ *amended at the merge: the
 * panel moved into the workbench dock ([P4 §7.12]) and what stands here is the
 * `ImportButton` that opens it, because an entry point has to survive the
 * move.* Making one thing is kind-scoped — it needs to know *what* to make —
 * so it sits below the filter and reads it. When the filter becomes six panels
 * ([polish §4]), the way in stays where it is and the form is already the
 * Actors panel's.
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
 * **Actors only, and that is the rule rather than the shortcut.**
 * [05 §11.2d](../../../../docs/design/05-ui-surfaces.md) says the first editor owes
 * create; read from the library's side it says the inverse, and the inverse is
 * the constraint here — a *New lorebook* lands somebody on a read-only page
 * holding an empty book they cannot fill in. The other five arrive with their
 * editors.
 *
 * **A sentence rather than a disabled button.** A greyed *New lorebook* is the
 * placeholder [Field](../ui/Field.tsx) rejects by name and
 * [work plan §2.2](../../../../docs/design/workplan/01-work-plan.md) rejects in
 * general: it promises a control that cannot work and teaches nothing about
 * why. The sentence names the paths that do work, and since P4.4 one of them
 * is the panel above.
 */
function MakeSomething(props: { kind: LibraryKind | undefined }): JSX.Element {
  if (props.kind === undefined || props.kind === 'actors') return <NewActorForm />;
  return (
    <p className="mb-6 text-sm text-ink-subtle">
      Actors are the only kind that can be made here: creating one lands in an editor, and the other
      kinds have none yet. Import brings them in, and the API creates any of them.
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
 * browser exactly as they do on one made with `curl` or one that arrived
 * through an import. A local literal would be a second definition of *what a
 * new actor is*, and the one that drifted.
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
            { kind: 'actors', object: newActor(name.trim()) },
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

/**
 * The one list component, driven by whichever panel the kind supplies —
 * [polish §4](../../../../docs/design/workplan/09-polish.md)'s *shared
 * machinery, per-kind surfaces*, delivered for the first of its six.
 *
 * **The name cell stays here rather than moving into the panel**, and that is
 * the load-bearing part of the split: the name carries the link, and the link
 * carries the shadowed-copy discriminator that decides which of two files with
 * one id gets opened. A panel supplying its own name cell would be a panel
 * building its own links from `{kind, id}`, which is F19 and which
 * [polish §4] names in advance as the way to bring it back.
 */
function ObjectTable(props: {
  objects: LibraryObject[];
  kind: LibraryKind | undefined;
}): JSX.Element {
  const panel = panelFor(props.kind);
  const auth = useAuthState();
  const locale = auth.data?.account?.locale ?? undefined;
  const [sortId, setSortId] = useState<string>(panel.sorts[0]?.id ?? '');
  const sort = panel.sorts.find((candidate) => candidate.id === sortId);

  if (props.objects.length === 0) {
    return (
      <p className="text-ink-subtle">
        {/*
         * **The empty state finally knows the word "import"** ([P4 §2], P4.4),
         * and since P5.0 it is the panel's rather than the page's — because
         * the way *in* differs by kind, which is what makes it one of the four
         * things [polish §4] says a panel supplies. For lorebooks the order is
         * import first and *new book* second, the opposite of the Actors
         * panel's ([05 §5.3]), and that is why one shared sentence could not
         * have covered it.
         */}
        {emptyMessage(props.kind)}
      </p>
    );
  }

  // A copy: the array belongs to the query cache, and sorting in place would
  // reorder what every other reader of that cache entry sees.
  const shown = sort === undefined ? props.objects : [...props.objects].sort(sort.compare);

  return (
    <>
      {panel.sorts.length === 0 ? null : (
        <div className="mb-4 max-w-xs">
          <SelectField
            label="Sort by"
            value={sortId}
            options={panel.sorts.map((candidate) => [candidate.id, candidate.label] as const)}
            onChange={setSortId}
          />
        </div>
      )}
      <table className={table.root}>
        <thead>
          <tr className={table.head}>
            <th scope="col" className={table.th}>
              Name
            </th>
            {panel.columns.map((column) => (
              <th
                key={column.id}
                scope="col"
                className={column.numeric === true ? table.thNumeric : table.th}
              >
                {column.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {shown.map((object) => (
            <ObjectRow
              key={`${object.source}:${object.id}:${object.slug}`}
              object={object}
              kind={props.kind}
              columns={panel.columns}
              locale={locale}
            />
          ))}
        </tbody>
      </table>
    </>
  );
}

function ObjectRow(props: {
  object: LibraryObject;
  kind: LibraryKind | undefined;
  columns: PanelColumn[];
  locale: string | undefined;
}): JSX.Element {
  const kind = kindOfSchema(props.object.schema);
  return (
    <tr className={table.row}>
      <td className={table.cell}>
        <span className="flex flex-wrap items-center gap-2">
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
              className={link.object}
            >
              {props.object.name}
            </Link>
          )}
          {props.object.shadowed ? <ShadowedBadge /> : null}
          {panelNameBadges(props.kind, props.object)}
        </span>
      </td>
      {props.columns.map((column) => (
        <td
          key={column.id}
          className={
            column.numeric === true ? table.cellNumeric : `${table.cell} text-sm text-ink-subtle`
          }
        >
          {column.cell(props.object, props.locale)}
        </td>
      ))}
    </tr>
  );
}
