// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { getRouteApi, Link } from '@tanstack/react-router';
import { useState, type JSX, type ReactNode } from 'react';

import { exportFormatsFor, type Lorebook } from '@storyengine/shared';

import {
  ApiError,
  isLibraryKind,
  type LibraryKind,
  type LibraryObject,
  type ObjectAddress,
} from '../api.js';
import { formatTimestamp, timestampsOf } from '../format.js';
import { useAuthState, useLibraryObject, useObjectImportNotes } from '../queries.js';
import { Alert } from '../ui/Alert.js';
import { Button } from '../ui/Button.js';
import type { ObjectSearch } from '../router.js';
import { link, page } from '../ui/classes.js';
import { MetadataRow } from '../ui/MetadataRow.js';
import { Note, SectionTitle } from '../ui/Text.js';
import { useQuery } from '@tanstack/react-query';

import { listSessions } from '../api.js';
import { AsStored } from './AsStored.js';
import { bookToMarkdown } from './book-document.js';
import { UsedByPanel } from './UsedBy.js';
import { provenanceSourceOf } from './panels.js';
import { ByField } from './ByField.js';
import { CopyToMyLibrary } from './CopyToMyLibrary.js';
import { DeleteObject } from './DeleteObject.js';
import { editorRouteFor } from './fields.js';
import { LorebookView, lorebookShape } from './LorebookView.js';
import { labels } from '../i18n/catalogue.js';
import { KIND_LABELS, ShadowedBadge, SourceBadge } from './labels.js';

/**
 * The detail view. Read-only at this stage — editing is P1.7, and keeping the
 * stages separate is deliberate: this one is what the hot-reload demo runs on
 * ([P1 §P1.6](../../../../docs/design/workplan/07-p1-implementation.md)).
 *
 * The disk layout is shown on purpose. The folder *is* the object, and exposing
 * that is how a user learns the storage model is theirs to touch
 * ([10 §5](../../../../docs/design/10-ui-surfaces.md)).
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
        <p role="alert" className="text-danger-ink">
          This address does not name a known kind of library object.
        </p>
        <Controls />
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
        <Note>Loading…</Note>
        <Controls />
      </>
    );
  }

  if (query.isError) {
    const missing = query.error instanceof ApiError && query.error.status === 404;
    return (
      <>
        <p role="alert" className="text-danger-ink">
          {missing ? 'There is no such object in your library.' : query.error.message}
        </p>
        <Controls />
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
 * [polish §1](../../../../docs/design/workplan/06-polish.md)'s closing note taken at its
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
 * ([03 §5.1](../../../../docs/design/03-data-model.md)).
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
      <header className="mb-6 flex flex-wrap items-center gap-3">
        <h1 className="text-title text-ink">{object.name}</h1>
        <SourceBadge source={object.source} />
        {object.shadowed ? <ShadowedBadge /> : null}
      </header>

      {object.shadowed ? (
        <Alert tone="error" className="mb-6">
          Another folder on disk holds the same id at an earlier path, and that copy is the one that
          loads. Nothing is lost; this copy is shown so the duplicate stays visible.
        </Alert>
      ) : null}

      {/*
       * ***The warning [08 §2](../../../../docs/design/08-cross-session-memory.md)
       * asks for, on the object rather than on an export path*** — [P8.2].
       *
       * That section says a memory book *"must not be treated as authored
       * content"* and asks to **warn on any export path — this is the one place
       * the reuse could bite.** ***There is no export path.*** Nothing in this
       * build downloads a library object, and session export is
       * [25 B12](../../../../docs/design/25-open-questions.md), explicitly out of
       * this phase's scope — so a warning written against that path would be a
       * warning nobody can reach, which is the deliverable-nothing-noticed shape
       * this phase deleted a helper over.
       *
       * **So it goes where a person meets the book**, which is here: the page
       * that shows what it holds, and the page they are on when they decide to
       * copy it out of the app by hand. What is owed when an export path is
       * built is that it read the same marking, and the marking is what this
       * phase put on disk. *Recorded rather than quietly deferred* — [P8.2] says
       * the warning lands **with** the book, and this is it landing.
       *
       * Neutral rather than warning: nothing is wrong with the book, and colouring
       * a working feature as a fault is the surface arguing with the person — the
       * same rule the `Off` badge follows one file over.
       */}
      {provenanceSourceOf(object) === 'session' ? (
        <Alert tone="neutral" className="mb-6">
          This book was written by play rather than by hand. It is personal, it may hold things you
          would not hand to anyone, and it is not meant to be shared or published. Correcting an
          entry is expected — a corrected entry is left alone afterwards.
        </Alert>
      ) : null}

      {/*
       * **The fields first, and the storage facts under a heading below them.**
       * Reordered here rather than left where it was, because
       * [polish §1](../../../../docs/design/workplan/06-polish.md)'s complaint
       * is that this page answers *where is this file* when the question was
       * *what does it say* — and a build of that item which left seven rows of
       * path and hash above the prose would have answered in the same order.
       * The block is not demoted out of sight: [10 §5] wants the disk layout
       * legible, and a heading is what turns a lead paragraph into a section.
       */}
      <ObjectBody object={object} kind={kind} search={props.search} locale={locale} />

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

      {/*
        ***Used by*** — [10 §5.2](../../../../docs/design/10-ui-surfaces.md),
        [P11.7]. **Above *As stored* rather than below it**, because §5.2 is
        about the object's place in somebody's library and *As stored* is about
        its bytes: a reader scrolling to find out whether an actor matters
        should not have to pass the JSON to get there.

        *Renders nothing for an object nothing points at*, which is the honest
        empty state — a heading over an empty list is a question the page asked
        itself.
      */}
      <UsedByPanel kind={kind} id={object.id} />

      {/*
        ***A bundle that travels*** — [04 §9](../../../../docs/design/04-schemas.md),
        [P11 §1.9], [P11.10]. [P7B.6](../../../../docs/design/workplan/24-p7b-presets-and-prompts.md)
        shipped the package editor with *"the honest limit"* written beside it —
        *the editor lands able to make and describe a bundle and not to send
        one* — and this is the send. **A plain anchor, because it is a file.**

        *Not on a shadowed copy* (2026-09-27): the route takes an id and
        nothing narrower, so from this copy's page it would bundle the winner —
        a different package, under this one's heading. Read-only addresses stop
        at single objects; a bundle resolves what it names by id anyway.
      */}
      {kind === 'packages' && !object.shadowed ? (
        <a
          href={`/api/library/packages/${encodeURIComponent(object.id)}/export`}
          className={link.inline}
          download
        >
          Export this package
        </a>
      ) : null}

      <TakeItWithYou kind={kind} object={object} />

      <AsStored value={object.object} />

      <Controls>
        {/*
         * The kind gate comes from the same place the fields do
         * ([polish §1](../../../../docs/design/workplan/06-polish.md)), and it
         * carries the address with it: this branch used to name `actors`
         * twice — once in the condition and once in the route — so widening
         * one without the other would have opened a lorebook in the actor
         * editor.
         */}
        {editorRoute !== null && mutable(object) ? (
          <Link to={editorRoute} params={{ id: object.id }} className={link.action}>
            Edit
          </Link>
        ) : null}
        {/*
         * *In place of edit*, which is [10 §5]'s own phrasing — so it sits
         * where Edit would have been rather than beside it, and only for the
         * scope that cannot be edited. A shadowed user copy gets neither:
         * `mutable` withholds Edit from it for the F19 reason above, and
         * offering to fork the losing half of a duplicated id would copy an
         * object other than the one on screen.
         */}
        {object.source === 'system' ? <CopyToMyLibrary kind={kind} object={object.object} /> : null}
        {mutable(object) ? (
          <DeleteObject
            kind={kind}
            id={object.id}
            contentHash={object.contentHash}
            className="ms-auto"
          />
        ) : null}
      </Controls>
    </>
  );
}

/**
 * What the detail route renders for the object itself.
 *
 * **One route, two bodies, and the second is not a promotion.** A lorebook is
 * the only library kind whose object is a collection
 * ([11 §1.1](../../../../docs/design/11-lorebooks-as-a-format.md)), so a
 * by-field rendering of it is off by one level — a three-hundred-element array
 * under a label is not a reading surface. Every other kind is unchanged, and
 * lorebooks keep this route, its header, its storage block and its *As stored*
 * fold ([10 §5.3](../../../../docs/design/10-ui-surfaces.md): *not a new page*).
 *
 * **A book this build cannot read falls back rather than failing.** A
 * hand-edited file is the storage thesis working, so the guard runs first and
 * the by-field view renders whatever is actually on disk — which is more useful
 * than a book page insisting the file is a book.
 */

/**
 * ***Getting it out again*** —
 * [10 §2.1](../../../../docs/design/10-ui-surfaces.md)'s *the library is the
 * model*, finally with a door in it.
 *
 * **This page said *there is no export path* in a comment for two phases**, and
 * the sentence was accurate: nothing in the build downloaded a library object
 * except a `.sepack`. For a library whose whole claim is *these are your files,
 * in folders you may edit by hand*, that is the wrong kind of quiet.
 *
 * **Two rows, and they are different promises.** *Download* is the object as
 * stored, byte for byte — the primitive, no conversion, nothing lost because
 * nothing was converted. The rest are **writers**, each of which loses
 * something, and each of which says so: `EXPORT_FORMATS` carries `roundTrips`
 * and a format whose target application cannot read its own export back gets
 * that said under it rather than implied away. Aventuras is exactly that case.
 *
 * **Plain anchors**, on the package export's reasoning directly above: these are
 * files, and a file is what a link is for.
 */
function TakeItWithYou(props: { kind: LibraryKind; object: LibraryObject }): JSX.Element {
  const { kind, object } = props;
  const id = encodeURIComponent(object.id);
  const formats = exportFormatsFor(object.schema);
  /**
   * ***The copy on screen, not the winner*** (2026-09-27).
   *
   * An id resolves to the winner, so on a shadowed copy's page these links
   * handed over the other file under this one's name. The page was reached
   * through `?source=&slug=` and already shows the right copy; the download and
   * the export take the same address now, and carry it only where it changes
   * the answer — a copy that is not shadowed *is* what its id resolves to.
   */
  const at = object.shadowed
    ? `?source=${object.source}&slug=${encodeURIComponent(object.slug)}`
    : '';

  return (
    <section aria-label="Take it with you" className="flex flex-col gap-1">
      {/*
        **Each address written out whole rather than built from a shared stem**,
        which looks redundant and is not: `route-callers.test.ts` scans this
        package for `/api/...` literals to prove every route the server serves is
        reached by something, and it resolves helper *functions* and not local
        constants. A stem factored out here is two routes that read as orphaned.
        The copy's address is appended after the literal for the same reason.
      */}
      <a href={`/api/library/${kind}/${id}/download` + at} className={link.inline} download>
        {downloadLabel(kind)}
      </a>

      {formats.map((format) => (
        <span key={format.id} className="flex flex-col">
          <a
            href={`/api/library/${kind}/${id}/export/${format.id}` + at}
            className={link.inline}
            download
          >
            {exportLabel(format.label)}
          </a>
          {format.roundTrips ? null : (
            <span className="text-xs text-ink-subtle">{archivalNote(format.label)}</span>
          )}
        </span>
      ))}
    </section>
  );
}

/**
 * The kind, in the singular, for a sentence about one object.
 *
 * Derived from the kind rather than typed into the sentence, so the two cannot
 * drift — the rule `editorRouteFor` states, applied to prose: this branch used
 * to be the place a kind got named twice.
 */
const SINGULAR: Readonly<Record<LibraryKind, string>> = labels('library.kind.singular', {
  actors: 'actor',
  lorebooks: 'lorebook',
  treatments: 'treatment',
  setups: 'setup',
  presets: 'preset',
  packages: 'package',
});

/**
 * Whole phrases, because half a phrase cannot be translated.
 *
 * Both of these were JSX with the value between two runs of text, which
 * `no-restricted-syntax` refuses on [work plan §2]'s reasoning: word order
 * differs between languages, so a sentence assembled by concatenation is the
 * part of i18n that cannot be retrofitted. The kind is still derived rather than
 * typed twice — that was the other thing the interpolation was doing right.
 */
function downloadLabel(kind: LibraryKind): string {
  return `Download this ${SINGULAR[kind]}`;
}

function exportLabel(label: string): string {
  return `Export as ${label}`;
}

/**
 * Said under a format its own application cannot read back.
 *
 * **A whole sentence with the name substituted in**, on the `userFacing` rule:
 * a caveat assembled from fragments around a value is the half of i18n that
 * cannot be retrofitted.
 */
function archivalNote(label: string): string {
  return `${label} is what that app writes, not what it reads — use this to archive or move the file, not to send it back.`;
}

function ObjectBody(props: {
  object: LibraryObject;
  kind: LibraryKind;
  search: ObjectSearch;
  /** The reader's, for a memory's origin date — [19 §12.6]. */
  locale: string | undefined;
}): JSX.Element {
  const { object, search } = props;

  if (props.kind === 'lorebooks' && lorebookShape(object.object) === null) {
    return <LorebookBody object={object} search={search} locale={props.locale} />;
  }
  return <ByField schemaId={object.schema} value={object.object} />;
}

/**
 * The book, and what the imports said about it.
 *
 * Its own component so the notes query mounts only for a lorebook: a request
 * per object view for a kind that has no book page to put the answer on would
 * be traffic for a question nobody asked.
 */
function LorebookBody(props: {
  object: LibraryObject;
  search: ObjectSearch;
  locale: string | undefined;
}): JSX.Element {
  const { object, search } = props;
  const notes = useObjectImportNotes(object.id);
  /**
   * ***The account's sessions, so a memory can name where it came from*** —
   * [08 §2], [P8.5].
   *
   * **Read here rather than in the view**, which is pure and tested without a
   * query client; and `enabled` keeps an authored book from fetching a list it
   * has no use for.
   *
   * ***With the archived ones*** (2026-09-27): this read the live list, so a
   * memory from a session that was only archived said *a session you have
   * deleted*. Its own key rather than `SessionsPage`'s, whose list must not
   * grow archived rows because this page asked; `['sessions']` invalidations
   * still reach it by prefix.
   */
  const sessions = useQuery({
    queryKey: ['sessions', 'with-archived'],
    queryFn: () => listSessions({ archived: true }),
    enabled: provenanceSourceOf(object) === 'session',
  });

  const book = object.object as unknown as Lorebook;

  return (
    <>
      {/*
        ***Print, and copy as Markdown*** —
        [10 §5.3](../../../../docs/design/10-ui-surfaces.md), [P11.1].
        *"A setting should be readable as a setting, without the machinery"* —
        §12's argument on its second subject, and the same two formats for §12.2's
        reasons. **Not an export target**: §5.3 is explicit that it never sits
        beside the object export in a menu, because sitting there implies a round
        trip and there is none.
      */}
      <BookDocumentControls book={book} />
      <LorebookView
        book={book}
        focused={search.entry ?? null}
        {...(sessions.data === undefined ? {} : { sessions: sessions.data.sessions })}
        {...(props.locale === undefined ? {} : { locale: props.locale })}
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
        importNotes={notes.data?.notes ?? []}
        /**
         * **Offered only where the object can actually be written**, through the
         * same `mutable` predicate the strip's Edit and Delete go through — a
         * system book and a shadowed copy are both readable and neither is
         * writable, and an *Edit* on the losing copy of a duplicated id would open
         * the editor over the winner (F19 with the stakes raised).
         *
         * Spread rather than passed as `undefined`, because
         * `exactOptionalPropertyTypes` makes *absent* and *present and undefined*
         * two different things.
         */
        {...(mutable(object)
          ? {
              editEntry: (entryId: string, children: ReactNode) => (
                <Link
                  to="/library/lorebooks/$id/edit"
                  params={{ id: object.id }}
                  search={{ entry: entryId }}
                  className={link.inline}
                >
                  {children}
                </Link>
              ),
            }
          : {})}
      />
    </>
  );
}

/**
 * ***Two buttons, and no third format*** — [10 §5.3], [P11.1].
 *
 * §5.3's fence is *"no JavaScript in the output"*, and the way this file keeps
 * it is structural rather than disciplined: **Print** hands the page to the
 * browser, which is HTML plus the print stylesheet and nothing else, and
 * **Copy as Markdown** produces a string. Neither has anywhere to put a handler.
 *
 * *Copying is the half that can fail*, on the deployment this project is for: a
 * LAN install over plain HTTP is not a secure context and `navigator.clipboard`
 * is absent there. Saying so is better than a button that appears to work.
 */
function BookDocumentControls(props: { book: Lorebook }): JSX.Element {
  const [said, setSaid] = useState<string | null>(null);
  return (
    <div className="flex flex-wrap items-center gap-2 print:hidden">
      <Button
        type="button"
        onClick={() => {
          globalThis.print();
        }}
      >
        Print
      </Button>
      <Button
        type="button"
        onClick={() => {
          const clipboard = navigator.clipboard as Clipboard | undefined;
          if (clipboard === undefined) {
            setSaid(NO_CLIPBOARD);
            return;
          }
          void clipboard
            .writeText(bookToMarkdown(props.book))
            .then(() => {
              setSaid('Copied.');
            })
            .catch(() => {
              setSaid(NO_CLIPBOARD);
            });
        }}
      >
        Copy as Markdown
      </Button>
      {said === null ? null : (
        <span role="status" className="text-sm text-ink-subtle">
          {said}
        </span>
      )}
    </div>
  );
}

const NO_CLIPBOARD = 'This browser would not copy. Select the text and copy it yourself.';

/**
 * The page's critical controls, held against the bottom of the scrollport
 * ([10 §11.6](../../../../docs/design/10-ui-surfaces.md) — the read page's half
 * of it): the way up, then Edit and Delete when the object can be written.
 *
 * **Last in the column, and the column is what holds it**, where the editors
 * hold theirs inside the form. There the strip releases over the panels a
 * person reads rather than edits; here the whole page is the object the
 * controls are about, so there is nothing for it to release over. The way up
 * used to be the first thing on the page, and moving it here is what
 * *included in the element* costs: a reader who tabs through a long book now
 * meets the controls after it. What is bought is that they are on screen
 * wherever the page is scrolled, which is the whole point of holding them.
 *
 * Every branch of the loader renders it. A page still loading, or one refusing
 * an address, still has a way up, and the way up is the one control the
 * branches share.
 */
function Controls(props: { children?: ReactNode }): JSX.Element {
  return (
    <div className={page.actions}>
      <Link to="/library" search={{}} className={link.back}>
        Back to the library
      </Link>
      {props.children}
    </div>
  );
}
