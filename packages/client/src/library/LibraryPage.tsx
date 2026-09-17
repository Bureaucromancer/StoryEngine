// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { getRouteApi, Link, useNavigate } from '@tanstack/react-router';
import { useId, useMemo, useState, type JSX } from 'react';

import { kindOfSchema, LIBRARY_KINDS, type LibraryKind, type LibraryObject } from '../api.js';
import { useAuthState, useLibrary, usePatchPrefs, usePrefs, useTags } from '../queries.js';
import { formatCount } from '../format.js';
import { parseKinds } from '../search-lists.js';
import { Button } from '../ui/Button.js';
import { SelectorBar, selectionHref } from '../ui/SelectorBar.js';
import { TagChip } from '../ui/TagChip.js';
import { link, page, table } from '../ui/classes.js';
import { Field, SelectField } from '../ui/Field.js';
import { workbenchOpenFromPrefs, workbenchOpenPatch } from '../workbench/prefs.js';
import { newObjectFor, newRouteFor, type NewRoute } from './fields.js';
import { KIND_LABELS, ShadowedBadge } from './labels.js';
import { QuarantinePanel } from './QuarantinePanel.js';
import {
  emptyMessage,
  panelFor,
  panelNameBadges,
  searchText,
  tagsOf,
  type PanelColumn,
} from './panels.js';
import { matches } from './search.js';
import { folderRows, insideClosedFolder } from '../tags/folders.js';
import { passesTagFilters, TagFilterBar, type TagFilters } from '../tags/TagFilterBar.js';

/**
 * The library list, as P1.6 built it: one surface for all six kinds with a kind
 * filter, the filter living in the URL's search params so a filtered view is a
 * link like any other.
 *
 * **The position this was built from has since been reversed.**
 * [10 §5](../../../../docs/design/10-ui-surfaces.md) now calls for one panel per kind — the
 * kinds are distinct by design and a merged table teaches otherwise — with the
 * all-kinds view kept behind a preference. The routing and the shared list
 * machinery here are what that is built out of; see
 * [polish §4](../../../../docs/design/workplan/06-polish.md) for the change.
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
  const navigate = useNavigate();
  /**
   * The kinds on screen — `[]` for all of them, one for a panel, several for
   * the mixed table narrowed.
   *
   * **One kind is a panel; anything else is the mixed table**, and that is where
   * multi-select meets [10 §5](../../../../docs/design/10-ui-surfaces.md)'s *one
   * panel per kind*. A panel is a kind's sorts, filters, columns and create
   * control; there is no honest panel for *actors and lorebooks*, so several
   * kinds get the table the all-kinds view already has, narrowed on the client.
   * The server is asked for the whole library in that case rather than once per
   * kind — `?kind=` takes one — and the rows are cut here by schema.
   */
  const kinds = parseKinds(search.kind);
  const single = kinds.length === 1 ? kinds[0] : undefined;
  const library = useLibrary(single);
  const objects =
    kinds.length <= 1
      ? library.data?.objects
      : library.data?.objects.filter((object) => {
          const kind = kindOfSchema(object.schema);
          return kind !== null && kinds.includes(kind);
        });

  return (
    // The page's own column, now that the shell's `<main>` is a bare scroll
    // container ([P3.−1] — `ui/classes.ts` has the why).
    <div className={page.tooling}>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-title text-ink">Library</h1>
        <ImportButton />
      </div>
      <SelectorBar
        label="Filter by kind"
        allLabel="All kinds"
        options={LIBRARY_KINDS.map((kind) => ({ value: kind, label: KIND_LABELS[kind] }))}
        selected={kinds}
        hrefFor={(next) => selectionHref('/library', 'kind', next)}
        onChange={(next) => {
          void navigate({
            to: '/library',
            search: next.length === 0 ? {} : { kind: next.join(',') },
          });
        }}
      />

      {/* Above the list and below the filter: it is about objects that are
          *missing* from the list, so a reader has to meet it before concluding
          something was deleted ([P7B.8]). */}
      <QuarantinePanel />

      <MakeSomething kinds={kinds} />

      {library.isPending ? <p className="text-ink-subtle">Loading the library…</p> : null}
      {library.isError ? (
        <p role="alert" className="text-danger-ink">
          {library.error.message}
        </p>
      ) : null}
      {objects !== undefined ? (
        <ObjectTable
          key={kinds.length === 0 ? 'all' : kinds.join(',')}
          objects={objects}
          kind={single}
          several={kinds.length > 1}
        />
      ) : null}
    </div>
  );
}

/**
 * The create control, or the sentence that says why there is not one.
 *
 * **Offered exactly where an editor exists, and that is the rule rather than a
 * shortcut.** [10 §11.2d](../../../../docs/design/10-ui-surfaces.md) says the
 * first editor owes create; read from the library's side it says the inverse,
 * and the inverse is the constraint here — a *New lorebook* before P5.1 landed
 * somebody on a read-only page holding an empty book they could not fill in.
 * So the question is asked of [fields.ts](./fields.ts) rather than answered by
 * a literal, which is the same table the Edit link navigates by: a kind cannot
 * become creatable here while its editor is somewhere else, or missing.
 *
 * **A sentence rather than a disabled button.** A greyed *New treatment* is the
 * placeholder [Field](../ui/Field.tsx) rejects by name and
 * [work plan §2.2](../../../../docs/design/workplan/01-work-plan.md) rejects in
 * general: it promises a control that cannot work and teaches nothing about
 * why. The sentence names the paths that do work, and since P4.4 one of them
 * is the panel above. It no longer names *which* kinds can be made, because the
 * answer changes with every editor that lands and a sentence naming them is a
 * second list of the table above — the one that was false the day this one grew
 * its second row.
 *
 * ***And as of [P7B.6] both of those sentences are unreachable, which is the
 * good outcome and not a reason to delete them*** (2026-09-14, amended at the
 * merge with the selector bar, which turned one refusal into two).
 * `EDITOR_ROUTES` now covers the whole of `LibraryKind` — the six folders
 * [03 §5.1](../../../../docs/design/03-data-model.md) names — so `makeable` is
 * never empty for any selection, and every branch of this component that is
 * ever taken is the buttons. The refusal stays because **it is the guard, not
 * the message**: a seventh kind is added to `LIBRARY_DIRECTORIES` in one edit
 * and its editor in another, and the window between them is exactly when a
 * *New* that landed nowhere would ship. Deleting an unreachable guard is how
 * the thing it guarded against comes back.
 */
function MakeSomething(props: { kinds: readonly LibraryKind[] }): JSX.Element {
  /**
   * **Every kind on screen that can be made, not one of them.** The all-kinds
   * view used to fall back to `actors`, which answered [polish §4]'s question —
   * *which kind does an unfiltered New make?* — by picking the one there are
   * usually most of. Once the bar can show several kinds the fallback has
   * nothing left to stand in for: the view shows a set, so it offers the set's
   * editors, read from the same table as a single panel's one button, and a
   * kind that gains an editor appears here in the same edit.
   */
  const kinds = props.kinds.length === 0 ? LIBRARY_KINDS : props.kinds;
  const makeable = kinds.flatMap((kind) => {
    const blank = newObjectFor(kind);
    const route = newRouteFor(kind);
    return blank !== null && route !== null ? [{ kind, noun: blank.noun, route }] : [];
  });
  if (makeable.length > 0) {
    return (
      <div className="mb-6 flex flex-wrap gap-2">
        {makeable.map((entry) => (
          <NewObjectButton key={entry.kind} noun={entry.noun} route={entry.route} />
        ))}
      </div>
    );
  }
  return (
    <p className="mb-6 text-sm text-ink-subtle">
      {kinds.length === 1
        ? 'This kind has no editor yet, so nothing here can make one: it would land on a page that cannot fill it in. Import brings them in, and the API creates any of them.'
        : 'None of these kinds has an editor yet, so nothing here can make one: it would land on a page that cannot fill it in. Import brings them in, and the API creates any of them.'}
    </p>
  );
}

/**
 * A button, and you are in the editor — [polish §10].
 *
 * **It used to collect the name first**, in an inline box, with the button
 * disabled until something was typed into it. That was a gate in front of the
 * one surface built to collect that field, and a disabled control saying
 * nothing about why is the placeholder
 * [work plan §2.2](../../../../docs/design/workplan/01-work-plan.md) rejects —
 * the same argument the sentence below this control already makes about kinds
 * with no editor.
 *
 * **Nothing is created here any more.** The editor holds a draft and its first
 * Save is the create, which is what keeps the folder name honest: the slug is
 * taken from the name once and then frozen ([03 §5.2]), so an object created
 * before it was named would keep `untitled-2` for the rest of its life. It also
 * means opening this and walking away leaves nothing behind, which the old flow
 * could not have offered without leaving something.
 *
 * **The address comes from the table**, as the editor address did before it:
 * navigating by a literal was safe while there was one editor and is exactly
 * the failure [fields.ts](./fields.ts) records at its other call site.
 */
function NewObjectButton(props: { noun: string; route: NewRoute }): JSX.Element {
  const navigate = useNavigate();

  return (
    <Button
      type="button"
      variant="primary"
      onClick={() => {
        void navigate({ to: props.route });
      }}
    >
      {`New ${props.noun}`}
    </Button>
  );
}

/**
 * The way to import, now that the panel lives in the dock.
 *
 * **An entry point has to survive the move.** [10 §5] says the empty library
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

/**
 * The one list component, driven by whichever panel the kind supplies —
 * [polish §4](../../../../docs/design/workplan/06-polish.md)'s *shared
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
  /** The panel's kind — one kind selected, or `undefined` for the mixed table. */
  kind: LibraryKind | undefined;
  /** The mixed table narrowed to several kinds, which changes what *empty* means. */
  several: boolean;
}): JSX.Element {
  const panel = panelFor(props.kind);
  const auth = useAuthState();
  const locale = auth.data?.account?.locale ?? undefined;
  const [sortId, setSortId] = useState<string>(panel.sorts[0]?.id ?? '');
  const [chosen, setChosen] = useState<Record<string, string>>({});
  /**
   * The live search, and whether its box is on screen — [polish §9].
   *
   * **Two pieces of state rather than one**, because *closed* and *empty* are
   * different: closing the box clears the query, and it has to, or the shelf
   * stays narrowed with nothing on screen saying why. Keeping the query in the
   * same state as the visibility would make that rule an accident of how it
   * happens to be written rather than something a reader can see.
   *
   * Both are local, and the whole component is keyed on the kind, so switching
   * shelves puts the controls back to their defaults. That is deliberate: a
   * search for a name that exists among actors is not a search anybody meant to
   * run against presets, and the state used to survive the change only because
   * one panel had any.
   */
  const searchId = useId();
  const [searching, setSearching] = useState(false);
  const [query, setQuery] = useState('');
  /**
   * The tag filter — [05 §5](../../../../docs/design/05-tagging.md).
   *
   * Beside the search rather than in the panel's `filters`, because tags are on
   * every kind while scope, enabled and source are the lorebook's. The
   * single-select the Lorebooks panel used to declare is gone: two tag controls
   * on one shelf would be two answers to one question.
   */
  const [tagFilters, setTagFilters] = useState<TagFilters>(new Map());
  const registry = useTags();
  /**
   * Tags the registry says to keep off cards — [05 §5].
   *
   * Case-folded, because that is how a tag is compared everywhere else. **Only
   * the inline chip strip reads this.** The filter bar below still offers them,
   * the search still matches them, and the manager still lists them — a flag
   * that also hid a tag from the bar would be a second, invisible filter state,
   * and would make objects unreachable without saying so.
   */
  const hiddenTags = useMemo(
    () =>
      new Set(
        (registry.data?.tags ?? [])
          .filter((tag) => tag.hidden)
          .map((tag) => tag.name.toLowerCase()),
      ),
    [registry.data],
  );
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
         * panel's ([10 §5.3]), and that is why one shared sentence could not
         * have covered it.
         */}
        {props.several
          ? // Not the empty-library sentence: the library may be full, just
            // not of these.
            'There is nothing of these kinds in the library yet. An import may bring some.'
          : emptyMessage(props.kind)}
      </p>
    );
  }

  /**
   * **Narrowed before sorted, and the options come from the whole shelf.**
   * Deriving a filter's options from what the *other* filters have already left
   * would make the controls disagree with each other — pick a tag, and the
   * scope list quietly loses the values it no longer offers, so unpicking is
   * the only way back to a shelf you could see a moment ago.
   */
  /**
   * The folders on this shelf, and which of them the list is standing in —
   * [05 §5](../../../../docs/design/05-tagging.md).
   *
   * Counted before any narrowing, because a folder row is a way *in*: one that
   * disappeared as soon as a search excluded its members would be a door that
   * vanishes when you reach for it.
   */
  const folders = folderRows(
    registry.data?.tags ?? [],
    props.objects.map((object) => tagsOf(object)),
    tagFilters,
  );

  const matching = props.objects.filter(
    (object) =>
      matches(searchText(object), query) &&
      passesTagFilters(tagsOf(object), tagFilters) &&
      !insideClosedFolder(tagsOf(object), registry.data?.tags ?? [], tagFilters) &&
      panel.filters.every((filter) => {
        const value = chosen[filter.id] ?? '';
        return value === '' || filter.matches(object, value);
      }),
  );

  // A copy: the array belongs to the query cache, and sorting in place would
  // reorder what every other reader of that cache entry sees.
  const shown = sort === undefined ? matching : [...matching].sort(sort.compare);

  return (
    <>
      {/*
       * **Always rendered now**, where it used to appear only for a panel that
       * declared sorts or filters — which was Lorebooks and nothing else, so
       * five shelves out of six had no controls at all, not even an empty row.
       * Search is the control every kind can answer, so the condition had
       * nothing left to be about.
       */}
      <div className="mb-4 flex flex-wrap items-end gap-4">
        <Button
          type="button"
          aria-expanded={searching}
          aria-controls={searchId}
          onClick={() => {
            setSearching((open) => {
              if (open) setQuery('');
              // Closing clears. A hidden box holding a live query is a shelf
              // narrowed for a reason nobody on screen can see.

              return !open;
            });
          }}
        >
          {searching ? 'Hide search' : 'Search'}
        </Button>
        {panel.sorts.length === 0 ? null : (
          <div className="min-w-40">
            <SelectField
              label="Sort by"
              value={sortId}
              options={panel.sorts.map((candidate) => [candidate.id, candidate.label] as const)}
              onChange={setSortId}
            />
          </div>
        )}
        {panel.filters.map((filter) => (
          <div key={filter.id} className="min-w-40">
            <SelectField
              label={filter.label}
              value={chosen[filter.id] ?? ''}
              options={[['', 'Any'], ...filter.optionsFor(props.objects)]}
              onChange={(value) => {
                setChosen((current) => ({ ...current, [filter.id]: value }));
              }}
            />
          </div>
        ))}
      </div>

      {/*
       * The box itself, under the row rather than in it, so a long shelf's
       * controls do not reflow every time it opens. `Field` rather than a
       * search control of this page's own — [10 §5.3] asks the book panel's box
       * to be the component a cross-library one would use, and the way to be
       * that is to be the one text control this client already has.
       */}
      <TagFilterBar
        names={tagNames(props.objects)}
        registry={registry.data}
        filters={tagFilters}
        onChange={setTagFilters}
      />

      {searching ? (
        <div id={searchId} className="mb-4">
          <Field
            label="Search this shelf"
            value={query}
            onChange={setQuery}
            placeholder="Name or tag"
            hint="Names and tags, on this shelf only. Nothing is sent anywhere."
          />
        </div>
      ) : null}

      {/*
       * **Distinct from the empty shelf, and the difference is what a person
       * does next.** An empty library is answered by importing; a shelf
       * narrowed to nothing is answered by widening a filter. Telling somebody
       * to go and import when they have books they simply cannot see would be
       * the surface misreading its own state — and the controls stay on screen
       * above this, because they are the way out of it.
       */}
      {shown.length === 0 ? (
        <p className="text-ink-subtle">
          {query === ''
            ? 'Nothing on this shelf matches these filters.'
            : 'Nothing on this shelf matches that search.'}
        </p>
      ) : (
        /* The wrapper six other tables in this client already have
           (`IndexRowTable`, `BlockTable`, the history panel…): a shelf with a
           Tags column and four badges does not fit a narrow window, and without
           it the overflow pushes the page sideways rather than the table. */
        <div className="overflow-x-auto">
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
              {folders.map((folder) => (
                <tr key={`folder:${folder.tag.id}`} className={table.row}>
                  <td className={table.cell} colSpan={panel.columns.length + 1}>
                    <button
                      type="button"
                      className="flex items-center gap-2 text-sm text-ink"
                      aria-label={folderLabel(folder.tag.name, folder.open)}
                      onClick={() => {
                        /**
                         * **Entering a folder is applying its filter** — [05 §5].
                         * Not a second navigation model: the shelf already has a
                         * filter, and this is another control that drives it, so
                         * the chip in the bar is both the indicator and the way
                         * back out.
                         */
                        const key = folder.tag.name.toLowerCase();
                        const updated = new Map(tagFilters);
                        if (folder.open) updated.delete(key);
                        else updated.set(key, 'selected');
                        setTagFilters(updated);
                      }}
                    >
                      <span aria-hidden="true">{folder.open ? '▾' : '▸'}</span>
                      <TagChip name={folder.tag.name} swatch={folder.tag.swatch} />
                      <span className="text-ink-subtle">{formatCount(folder.count, locale)}</span>
                    </button>
                  </td>
                </tr>
              ))}
              {shown.map((object) => (
                <ObjectRow
                  key={`${object.source}:${object.id}:${object.slug}`}
                  object={object}
                  kind={props.kind}
                  columns={panel.columns}
                  locale={locale}
                  hidden={hiddenTags}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

function ObjectRow(props: {
  object: LibraryObject;
  kind: LibraryKind | undefined;
  columns: PanelColumn[];
  locale: string | undefined;
  /** Tag names to keep out of an inline chip strip — see `hiddenTags`. */
  hidden: ReadonlySet<string>;
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
          {column.cell(props.object, props.locale, props.hidden)}
        </td>
      ))}
    </tr>
  );
}

/**
 * Every tag name on this shelf, in the spelling first seen, deduplicated
 * case-insensitively.
 *
 * The bar offers what the shelf actually carries — the rule the single-select
 * tag filter stated before it: *a tag filter offering tags nobody has used is a
 * list of dead ends*, and one missing a tag somebody added yesterday is worse.
 */
function tagNames(objects: readonly LibraryObject[]): string[] {
  const seen = new Map<string, string>();
  for (const object of objects) {
    for (const tag of tagsOf(object)) {
      const key = tag.toLowerCase();
      if (!seen.has(key)) seen.set(key, tag);
    }
  }
  return [...seen.values()];
}

/**
 * The folder row's whole phrase, built here rather than in the JSX — a sentence
 * split across children is what the assembly rule reports.
 */
function folderLabel(name: string, open: boolean): string {
  return open ? `Leave the ${name} folder` : `Open the ${name} folder`;
}
