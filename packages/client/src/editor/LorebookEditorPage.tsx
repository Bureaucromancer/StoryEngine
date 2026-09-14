// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { getRouteApi, Link, useNavigate } from '@tanstack/react-router';
import { useCallback, useEffect, useRef, useState, type JSX } from 'react';

import {
  entriesGoverned,
  entryGate,
  LOREBOOK_SCHEMA,
  resolvedFolderId,
  type GateReason,
  type Lorebook,
  type LoreEntry,
} from '@storyengine/shared';

import { ApiError, type LibraryObject } from '../api.js';
import { formatCount } from '../format.js';
import {
  blankFor,
  boundsOf,
  isRequiredField,
  labelFor,
  schemaFor,
  type SchemaNode,
} from '../library/fields.js';
import { lorebookShape } from '../library/LorebookView.js';
import { matches } from '../library/search.js';
import { landing, nudge } from '../ui/reorder.js';
import { useAuthState, useEditorBase } from '../queries.js';
import { Alert } from '../ui/Alert.js';
import { Button } from '../ui/Button.js';
import { page, table } from '../ui/classes.js';
import { CheckboxField, Field, NumberField } from '../ui/Field.js';
import { Fine, Note, SectionTitle, SubsectionTitle } from '../ui/Text.js';
import {
  bookChanges,
  entryList,
  entryOf,
  moveEntryBefore,
  reapplyBookEdits,
  withEntry,
  withFolderGate,
  withNewEntry,
  withoutEntry,
  type Draft,
} from './book-form.js';
import { EditorFrame } from './EditorFrame.js';
import { useObjectEditor, type EditorKind } from './object-editor.js';
import { EntryFields } from './EntryFields.js';

/**
 * The entry editor's minimum —
 * [P5.1](../../../../docs/design/workplan/17-p5-implementation.md),
 * [10 §11.2d](../../../../docs/design/10-ui-surfaces.md).
 *
 * **The page's subject is the book and its unit of work is an entry**, which is
 * not a compromise between the two but what the write path is: an entry has no
 * address on disk, so creating, renaming or deleting one is a write of the whole
 * lorebook through the same route, hash and history every other object uses
 * ([10 §11.2c] says so from the import side — *"the merge goes through the same
 * write path as every other edit, so the book takes a history entry"*).
 *
 * One entry is edited at a time, named by `?entry=` the way the read page names
 * the entry it scrolled to. **The draft is book-wide even so**, and that is the
 * fact the entry list has to render rather than hide: a save writes every entry
 * touched since the last one, so an entry edited and then navigated away from
 * is an unsaved change the surface must keep visible — a hidden field one level
 * up, which is the defect §11.2d's own invariant exists to forbid.
 *
 * **`?source=` and `?slug=` are deliberately absent**, where the read route
 * carries them. A shadowed copy is readable and nothing else: every write
 * resolves an id to the winner (`packages/server/src/library.ts` says so twice),
 * so an edit address naming a losing copy would be a URL claiming something the
 * server ignores. The detail page already withholds Edit on a shadowed object;
 * this route simply has nowhere to put the claim.
 */

const routeApi = getRouteApi('/library/lorebooks/$id/edit');

export function LorebookEditorPage(): JSX.Element {
  const params = routeApi.useParams();
  return (
    <div className={page.tooling}>
      {/*
       * Keyed on the **book**, never on `?entry=`. Selecting an entry is a
       * search-param change and must not remount: the draft is book-wide, so a
       * remount on every click would discard every edit made to the entry
       * before this one.
       */}
      <EditorLoader key={params.id} id={params.id} />
    </div>
  );
}

function EditorLoader(props: { id: string }): JSX.Element {
  const base = useEditorBase('lorebooks', props.id);

  if (base.isPending) return <p className="text-ink-subtle">Loading the lorebook…</p>;
  if (base.isError) {
    const missing = base.error instanceof ApiError && base.error.status === 404;
    return (
      <p role="alert" className="text-danger-ink">
        {missing ? 'There is no such lorebook in your library.' : base.error.message}
      </p>
    );
  }
  if (base.data.source === 'system') {
    return (
      <p role="alert" className="text-ink-muted">
        System library objects are read-only. Copy it to your library to edit it.
      </p>
    );
  }

  // The guard before the cast. The route is addressable directly, so it must
  // refuse what the detail page's Edit link would have withheld — a hand-edited
  // book is the storage thesis working, and a white screen is the one answer
  // this surface may not give it.
  const problem = editableBookShape(base.data.object);
  if (problem !== null) {
    return <Unopenable id={props.id} problem={problem} />;
  }
  return <SavedEditor initial={base.data} id={props.id} />;
}

/**
 * Why this book cannot be *edited*, in one sentence — or null when it can.
 *
 * **Stricter than [lorebookShape](../library/LorebookView.tsx), and the extra
 * check is the whole reason it exists.** Reading a book needs its entries to be
 * objects; writing one needs every entry to have a **string id**, because every
 * edit here addresses an entry by id and a merge keys on it. Two entries whose
 * ids are not strings collapse to one under any id-keyed operation, which would
 * delete an entry silently — the failure a read surface cannot have and a write
 * surface can.
 */
export function editableBookShape(object: Record<string, unknown>): string | null {
  const readable = lorebookShape(object);
  if (readable !== null) return readable;

  for (const entry of object['entries'] as Record<string, unknown>[]) {
    if (typeof entry['id'] !== 'string') return 'an entry has no "id" string';
  }
  for (const folder of object['folders'] as Record<string, unknown>[]) {
    if (typeof folder['id'] !== 'string') return 'a folder has no "id" string';
    if (typeof folder['enabled'] !== 'boolean') return 'a folder has no "enabled" flag';
  }
  return null;
}

function Unopenable(props: { id: string; problem: string }): JSX.Element {
  return (
    <Alert tone="error" role="alert">
      <p className="mb-2 font-medium">This lorebook cannot be opened in the editor.</p>
      <p className="mb-2">
        {`The file on disk does not have the shape the editor needs: ${props.problem}. This usually means a hand edit went wrong. The file itself is untouched — fix it on disk and it will load.`}
      </p>
      <p>
        <Link
          to="/library/$kind/$id"
          params={{ kind: 'lorebooks', id: props.id }}
          search={{}}
          className="underline"
        >
          Back to the lorebook
        </Link>
      </p>
    </Alert>
  );
}

/**
 * The saved editor, which keeps its selection in the address — [10 §5.3] asks
 * the read view's edit affordance to be *a link into the editor at the
 * entry's address*, so the write surface has to hold one.
 *
 * Split out so `Editor` itself takes the selection as a prop: the draft route
 * has no address to keep it in, and a component that reached for
 * `routeApi.useSearch()` directly would throw the moment it rendered anywhere
 * but here.
 */
function SavedEditor(props: { initial: LibraryObject; id: string }): JSX.Element {
  const search = routeApi.useSearch();
  const navigate = useNavigate();

  return (
    <Editor
      initial={props.initial}
      selectedEntry={search.entry}
      onSelectEntry={(entry) => {
        void navigate({
          to: '/library/lorebooks/$id/edit',
          params: { id: props.id },
          search: entry === undefined ? {} : { entry },
        });
      }}
    />
  );
}

/**
 * The book's name, read the way everything else here reads the draft: through
 * `unknown`, because the premise of the guard above is that the file may not be
 * what the type says. The shape check does not police `name`, since a book
 * without one is still perfectly readable and editable — it just has nothing to
 * put in the heading.
 */
function nameOf(book: Draft): string {
  const name = book['name'];
  return typeof name === 'string' ? name : '';
}

/** Which folder the entry list is standing in — `{ id: null }` is *Ungrouped*. */
type FolderChoice = { id: string | null } | null;

/**
 * A new lorebook, which does not exist yet — [polish §10]. The actor editor's
 * `NewActorPage` carries the argument for why nothing is written until the
 * first Save; this is the same route for the other kind that has an editor.
 */
export function NewLorebookPage(): JSX.Element {
  /**
   * **Which entry is open is local here, where it is an address everywhere
   * else.**
   *
   * The saved editor puts the selection in `?entry=`, because an entry is a
   * place and [10 §5.3] asks the read view's edit affordance to be a link into
   * one. A draft has no address to put it in — the book has no id until the
   * first Save — so the same state lives in `useState` for exactly as long as
   * the book has no file, and the editor is handed it rather than reaching for
   * a route API that this route is not.
   */
  const [selectedEntry, setSelectedEntry] = useState<string | undefined>(undefined);
  const [draft] = useState<LibraryObject>(() => {
    const object = blankFor('lorebooks');
    return {
      id: object['id'] as string,
      schema: object['schema'] as string,
      name: '',
      slug: '',
      contentHash: '',
      source: 'user',
      shadowed: false,
      object,
    };
  });

  return (
    <Editor
      initial={draft}
      unsaved
      selectedEntry={selectedEntry}
      onSelectEntry={setSelectedEntry}
    />
  );
}

/**
 * What the editor needs that differs between a book with a file and one
 * without: where the selection lives, and whether there is anything on disk.
 */
interface EditorProps {
  initial: LibraryObject;
  unsaved?: boolean;
  /** The entry open right now — from `?entry=` when saved, from state when not. */
  selectedEntry: string | undefined;
  onSelectEntry: (id: string | undefined) => void;
}

/**
 * What the shell needs to know about a lorebook — [P7B.1].
 *
 * **Thinner than the actor's, because the draft *is* the object.** This editor
 * has always held a `Draft` — a structural clone of the file — rather than a
 * projection of it into named form fields, which is what an entry list of forty
 * fields apiece makes sensible. So `formOf` is a clone and `apply` returns the
 * draft unchanged, and [04 §2]'s unknown-field rule, which the actor's
 * `applyForm` works to keep, holds here by never having taken the object apart.
 */
const LOREBOOKS: EditorKind<Draft> = {
  kind: 'lorebooks',
  formOf: (object) => structuredClone(object),
  apply: (_base, draft) => draft,
  changed: bookChanges,
  shape: editableBookShape,
  reapply: reapplyBookEdits,
  requiredValues: (draft) => ({ name: nameOf(draft) }),
  requiredLabels: { name: 'Book name' },
  nameOf,
  untitled: { draft: 'New lorebook', saved: 'Untitled lorebook' },
  editorRoute: '/library/lorebooks/$id/edit',
};

function Editor(props: EditorProps): JSX.Element {
  const editor = useObjectEditor(LOREBOOKS, props.initial, {
    ...(props.unsaved === undefined ? {} : { unsaved: props.unsaved }),
  });
  const { base, form: draft, missing } = editor;

  /** Entry-list state, which is this page's and not the shell's. */
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [folder, setFolder] = useState<FolderChoice>(null);

  const auth = useAuthState();
  const locale = auth.data?.account?.locale ?? undefined;
  const search = { entry: props.selectedEntry };

  const book = draft as unknown as Lorebook;
  const selected = search.entry === undefined ? undefined : entryOf(draft, search.entry);

  function edit(next: Draft): void {
    editor.patch(next);
  }

  /**
   * Selecting an entry is an address when there is one to put it in — the
   * caller decides which, because only it knows whether this book has a file.
   */
  function select(id: string | undefined): void {
    setConfirmingDelete(false);
    props.onSelectEntry(id);
  }

  const entries = entryList(draft);
  const visible =
    folder === null
      ? entries
      : entries.filter((entry) => resolvedFolderId(book, entry) === folder.id);

  return (
    <EditorFrame
      editor={editor}
      descriptor={LOREBOOKS}
      conflictTitle="The lorebook changed while you were editing"
      backLabel="Back to the lorebook"
      unsavedHeading="This lorebook has unsaved changes"
      listSearch={{ kind: 'lorebooks' }}
      formClassName="flex flex-col gap-8"
      storedCaption="The saved book, not the form's working state — what a reload would find."
      header={
        <header className="mb-6">
          <h1 className="text-title text-ink">{editor.heading}</h1>
          <p className="text-sm text-ink-subtle">
            {`${formatCount(entries.length, locale)} entries, edited together and saved as one book.`}
          </p>
        </header>
      }
    >
      {/*
       * The book's own name, which is the one book-level field this stage
       * writes and is owed by the create control rather than by §11.2d: the
       * library's *New lorebook* names a book on the way in and this is the
       * only surface that could ever rename it before P11.
       */}
      <Field
        label="Book name"
        value={nameOf(draft)}
        onChange={(name) => {
          edit({ ...draft, name });
        }}
        required={isRequiredField('lorebooks', 'name')}
        error={missing.includes('name') ? 'A lorebook needs a name.' : null}
        hint="What the library shelf calls it. Renaming does not move the file."
      />

      <BookRetrieval
        book={book}
        onSet={(patch) => {
          edit({ ...draft, ...patch });
        }}
      />

      <FolderGates
        book={book}
        chosen={folder}
        locale={locale}
        onChoose={setFolder}
        onGate={(id, enabled) => {
          edit(withFolderGate(draft, id, enabled));
        }}
      />

      <section>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <SectionTitle as="h2">Entries</SectionTitle>
          <Button
            type="button"
            onClick={() => {
              const made = withNewEntry(draft, '');
              // Filed where the list is standing, which is the only way an
              // entry created here ever reaches a folder: `folderId` is not
              // a field this stage writes, so create is where the choice
              // has to be made or there is none.
              const filed =
                folder?.id == null
                  ? made.book
                  : withEntry(made.book, made.id, { folderId: folder.id });
              edit(filed);
              select(made.id);
            }}
          >
            New entry
          </Button>
        </div>

        <EntryList
          book={book}
          entries={visible}
          base={base.object}
          selectedId={search.entry}
          onSelect={select}
          onMove={(id, beforeId) => {
            edit(moveEntryBefore(draft, id, beforeId));
          }}
        />
      </section>

      {selected === undefined ? (
        <Note>
          {search.entry === undefined
            ? 'Choose an entry to edit it, or make a new one.'
            : 'That entry is not in this book. Choose one from the list.'}
        </Note>
      ) : (
        <section className="flex flex-col gap-4">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <SubsectionTitle as="h3">
              {selected.name === '' ? 'Untitled entry' : selected.name}
            </SubsectionTitle>
            <GateNote book={book} entry={selected} />
          </div>

          <EntryFields
            entry={selected}
            onPatch={(patch) => {
              edit(withEntry(draft, selected.id, patch));
            }}
          />

          <div className="flex items-center gap-3 text-sm">
            {confirmingDelete ? (
              <>
                <span className="text-ink-subtle">Remove this entry from the book?</span>
                <Button
                  type="button"
                  onClick={() => {
                    edit(withoutEntry(draft, selected.id));
                    setConfirmingDelete(false);
                    select(undefined);
                  }}
                >
                  Remove
                </Button>
                <Button
                  type="button"
                  variant="quiet"
                  onClick={() => {
                    setConfirmingDelete(false);
                  }}
                >
                  Cancel
                </Button>
              </>
            ) : (
              <Button
                type="button"
                onClick={() => {
                  setConfirmingDelete(true);
                }}
              >
                Remove this entry
              </Button>
            )}
            {/*
             * Said where the control is, because it is the thing that makes
             * the confirmation mild: nothing has left the file until Save,
             * and after Save the book's own history holds the version that
             * still had it ([10 §11.2a]).
             */}
            <Fine>Nothing is written until you save, and history keeps the version before.</Fine>
          </div>
        </section>
      )}
    </EditorFrame>
  );
}

/** §5.3's three ways off, in the design's own words. */
const OFF_LABELS: Record<GateReason['kind'], string> = {
  'entry-off': 'off',
  'folder-off': 'off: its folder is off',
  'book-off': 'off: the book is off',
};

/**
 * Why this entry will not fire, if it will not — the **same** `entryGate` the
 * book page renders and P5.7 will act on, at the surface that can change the
 * answer.
 *
 * Worth having here rather than only there: an author switching an entry on
 * inside a shut folder needs to know that the switch they just moved is not the
 * one holding it. Muted rather than danger, for the reason the book page gives
 * — a shut folder gate is the mechanism a book carries a timeline with, not a
 * fault.
 */
function GateNote({ book, entry }: { book: Lorebook; entry: LoreEntry }): JSX.Element | null {
  const blocked = entryGate(book, entry).blockedBy[0];
  if (blocked === undefined) return null;
  return (
    <span className="text-xs font-medium text-ink-muted">
      {blocked.kind === 'folder-off'
        ? `off: the folder ${blocked.folderName} is off`
        : OFF_LABELS[blocked.kind]}
    </span>
  );
}

/**
 * The entry list — names, what is unsaved, and which one is open.
 *
 * **The unsaved mark is the load-bearing part.** One save writes the whole
 * book, so an entry edited and then left is a pending change with nothing on
 * screen to say so; this is where the surface admits that the draft is wider
 * than the form. Added and removed entries count as changes for the same
 * reason.
 *
 * **It is a pane with a bottom, and that is a fix rather than styling.** Opened
 * on a real book of two hundred and forty-seven entries, this list stood seven
 * thousand pixels tall and the form it selects into sat underneath all of it —
 * so clicking an entry visibly did nothing, which is the same complaint P5.0's
 * dead *Show all* earned, arriving from the other direction. Bounded and
 * scrolled, the form is the next thing on the page whatever the book's size.
 *
 * **And it narrows by name**, because the folder rail alone does not: a hundred
 * and eighty-two of that book's entries are ungrouped, so *pick a folder* leaves
 * a wall. This is deliberately not the book page's search — one field, names
 * only, no keys or content and no highlighting — because a second full search
 * over the same object is the thing not to build. Finding an entry *by what it
 * says* is the read page's job, and it has the Edit link that lands here.
 */
/**
 * How near the list's top or bottom edge a hovering drag has to be before the
 * list scrolls itself, in pixels, and the most it moves per frame once there.
 *
 * The browser's own drag scrolls the page and not a list inside it — Firefox
 * never scrolls an inner box, and where Chromium does it is a courtesy this
 * list cannot rely on — so a book two hundred entries tall was one the pointer
 * could not cross with a row in hand. Forty pixels is a row and a half: enough
 * to find without aiming, small enough that the middle of the list holds
 * still. Twelve pixels a frame at the very edge, easing to one at the zone's
 * inner limit, so leaning harder into the edge is faster and hovering just
 * inside it is a crawl a person can stop on a row.
 */
const SCROLL_EDGE = 40;
const SCROLL_STEP = 12;

/**
 * How far the list should move this frame for a pointer at `y`, given the
 * list's box: negative is up, positive is down, zero is *hold still*. Nearer
 * the edge is faster, and the nearer edge wins where a short list's two zones
 * overlap — though a list that short has nothing to scroll.
 */
function scrollVelocity(y: number, box: { top: number; bottom: number }): number {
  const fromTop = y - box.top;
  const fromBottom = box.bottom - y;
  if (fromTop < SCROLL_EDGE && fromTop <= fromBottom) {
    return -Math.ceil(SCROLL_STEP * (1 - Math.max(fromTop, 0) / SCROLL_EDGE));
  }
  if (fromBottom < SCROLL_EDGE) {
    return Math.ceil(SCROLL_STEP * (1 - Math.max(fromBottom, 0) / SCROLL_EDGE));
  }
  return 0;
}

function EntryList(props: {
  book: Lorebook;
  entries: LoreEntry[];
  base: Draft;
  selectedId: string | undefined;
  onSelect: (id: string) => void;
  onMove: (id: string, beforeId: string | null) => void;
}): JSX.Element {
  const [query, setQuery] = useState('');
  const [dragging, setDragging] = useState<string | null>(null);
  /**
   * The row the pointer is over while a drag is in progress — where the line
   * that says *you would land here* is drawn. Set by the row's `dragover`,
   * because that is the event that decides whether a drop is allowed, so the
   * line appears exactly where `preventDefault` is called and nowhere else.
   * Cleared when the drag drops or ends, when the pointer is over the row
   * being dragged (nothing can land there, so nothing is promised), and when
   * it leaves the list. A primitive rather than a field beside `dragging`,
   * because `dragover` fires every few dozen milliseconds and setting the
   * same id again must cost nothing — which a state object would have to be
   * guarded to manage, in a list that can be two hundred rows long.
   */
  const [over, setOver] = useState<string | null>(null);
  const [moved, setMoved] = useState('');
  const held = useRef<HTMLUListElement>(null);

  /**
   * The self-scroll, while a drag hovers near an edge: how far to move per
   * frame, and the frame that will move it. Refs rather than state, because a
   * value that changes on every `dragover` and is read on every frame must not
   * render two hundred rows to do either. The loop schedules itself only while
   * the velocity is non-zero, so a pointer that comes back to the middle lets
   * it run out on the next frame rather than leaving a timer ticking; a drop,
   * a `dragend` or a pointer leaving the list stop it at once.
   */
  const velocity = useRef(0);
  const frame = useRef<number | null>(null);

  const stopScrolling = useCallback((): void => {
    velocity.current = 0;
    if (frame.current !== null) {
      cancelAnimationFrame(frame.current);
      frame.current = null;
    }
  }, []);
  // A list that unmounts mid-drag must not leave a frame scheduled against it.
  useEffect(() => stopScrolling, [stopScrolling]);

  function scrollTowards(next: number): void {
    velocity.current = next;
    if (next === 0 || frame.current !== null) return;
    const tick = (): void => {
      const list = held.current;
      if (list === null || velocity.current === 0) {
        frame.current = null;
        return;
      }
      list.scrollTop += velocity.current;
      frame.current = requestAnimationFrame(tick);
    };
    frame.current = requestAnimationFrame(tick);
  }

  const saved = new Map(
    entryList(props.base).map((entry) => [entry.id, JSON.stringify(entry)] as const),
  );
  const visible = props.entries.filter((entry) => matches(entry.name, query));

  /**
   * **Arriving from the read page's Edit link lands on an entry that may be
   * three hundred rows down**, and a pane scrolled to the top would hide the
   * very entry the address named. Keyed on the selection rather than on every
   * render, so typing in the form does not keep yanking the list.
   */
  useEffect(() => {
    held.current?.querySelector('[aria-current="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [props.selectedId]);

  /**
   * The whole book's order, which is what a move is expressed against.
   *
   * This list is filtered twice over — by the folder rail and by the name box —
   * so *the row below the one I dropped on* is a fact about the screen and not
   * about the array. `moveEntryBefore` takes the entry a row should land in
   * front of, and this is where a visible neighbour is turned into that.
   */
  const full = props.book.entries;

  /** The entry after this one in the book, or null for the end of it. */
  function after(id: string): string | null {
    const at = full.findIndex((entry) => entry.id === id);
    return at < 0 ? null : (full[at + 1]?.id ?? null);
  }

  /** The dragged row's place among the visible rows, or -1 while nothing is dragged. */
  const from = visible.findIndex((entry) => entry.id === dragging);

  function move(entry: LoreEntry, beforeId: string | null, to: number): void {
    props.onMove(entry.id, beforeId);
    // Announced rather than only shown, because the thing that changed is a
    // *position*, and a row moving under the pointer is exactly the change a
    // screen reader is not told about by the DOM alone.
    setMoved(
      `Moved ${nameOfEntry(entry)} to position ${String(to + 1)} of ${String(visible.length)}.`,
    );
  }

  return (
    <div className="flex flex-col gap-2">
      {props.entries.length === 0 ? null : (
        <Field
          label="Find an entry"
          value={query}
          onChange={setQuery}
          placeholder="By name"
          hint="Names only. The book's own page searches the prose, and links back into here."
        />
      )}

      {props.entries.length === 0 ? (
        <Note>No entries here yet.</Note>
      ) : visible.length === 0 ? (
        <Note>No entry here is named that.</Note>
      ) : (
        <ul
          ref={held}
          className="flex max-h-80 flex-col overflow-y-auto"
          onDragOver={(event) => {
            // Only a drag of one of these rows scrolls the list: a file dragged
            // in from the desktop is not going anywhere in it.
            if (dragging === null) return;
            scrollTowards(
              scrollVelocity(event.clientY, event.currentTarget.getBoundingClientRect()),
            );
          }}
          onDragLeave={(event) => {
            /**
             * The list's `dragleave` fires for every row the pointer leaves,
             * including on its way into the next one, so clearing on each
             * would clear on every move. `relatedTarget` is where the pointer
             * is going: still inside the list means the next row's `dragover`
             * is about to move the line, so it is left alone; outside, or
             * nowhere (out of the window), means it comes down.
             *
             * Chromium and WebKit leave `relatedTarget` null on drag events —
             * open bugs in both trackers — so there the check reduces to
             * clearing on every leave. That does not blink: a leave and the
             * next row's `dragover` are fired in one task, both are continuous
             * events, and React renders the pair as one update, so the line
             * goes from row to row with no frame between. Firefox sets it, and
             * the test asserts the contract rather than the batching.
             */
            const into = event.relatedTarget;
            if (into instanceof Node && event.currentTarget.contains(into)) return;
            // And the scroll with it: a pointer that has left the list is not
            // asking it to move.
            stopScrolling();
            setOver(null);
          }}
        >
          {visible.map((entry, at) => {
            const before = saved.get(entry.id);
            const unsaved = before === undefined || before !== JSON.stringify(entry);
            const current = entry.id === props.selectedId;
            const previous = visible[at - 1];
            const next = visible[at + 1];
            const drop = over === entry.id ? landing(from, at) : undefined;
            return (
              <li
                key={entry.id}
                /**
                 * The row is the drag handle, which is what a list of one-line
                 * rows can afford: a separate grip would be a third target in a
                 * row that already has a button and two more beside it.
                 */
                draggable
                onDragStart={(event) => {
                  setDragging(entry.id);
                  event.dataTransfer.effectAllowed = 'move';
                  // Firefox starts no drag at all without payload, and the id
                  // is what a drop between two editors would want anyway.
                  event.dataTransfer.setData('text/plain', entry.id);
                }}
                onDragEnd={() => {
                  setDragging(null);
                  setOver(null);
                  stopScrolling();
                }}
                onDragOver={(event) => {
                  if (dragging === null) return;
                  // Over the row being dragged nothing can land, so nothing is
                  // promised: the line a neighbour was showing comes down
                  // rather than staying to say a drop here would go there.
                  if (dragging === entry.id) {
                    setOver(null);
                    return;
                  }
                  // Without this the drop never fires: the default action for a
                  // dragover is *refuse the drop*.
                  event.preventDefault();
                  setOver(entry.id);
                }}
                onDrop={(event) => {
                  event.preventDefault();
                  const source = visible[from];
                  setDragging(null);
                  setOver(null);
                  stopScrolling();
                  if (source === undefined || from === at) return;
                  // The edge is `landing`'s — the same answer the line gave.
                  move(source, landing(from, at) === 'before' ? entry.id : after(entry.id), at);
                }}
                data-drop={drop}
                className={
                  dragging === entry.id
                    ? 'relative flex items-baseline gap-1 opacity-50'
                    : 'group/entry relative flex items-baseline gap-1'
                }
              >
                {/*
                 * The line: two pixels of `accent` along the edge the entry
                 * would land on. Absolutely positioned so it takes no space —
                 * a border would grow the row and shift every row below it as
                 * the line moved — and inside the row rather than astride its
                 * edge, because the list clips: a line hung a pixel above the
                 * first row would lose its top half whenever the list is
                 * scrolled to the top, which is where the first row is, and
                 * one hung below the last would add a pixel of scrollable
                 * overflow only while it showed. It sits in the button's own
                 * padding, never over text. Paint only: `aria-hidden`,
                 * because the live region says the outcome and the buttons are
                 * the screen reader's path; and `pointer-events-none`, so the
                 * thing drawn under the pointer never becomes the thing under
                 * the pointer. `data-drop` on the row is the fact this renders
                 * from and the fact a test can read, since jsdom cannot see
                 * two pixels.
                 */}
                {drop === undefined ? null : (
                  <span
                    aria-hidden="true"
                    className={
                      drop === 'before'
                        ? 'pointer-events-none absolute inset-x-0 top-0 h-0.5 bg-accent'
                        : 'pointer-events-none absolute inset-x-0 bottom-0 h-0.5 bg-accent'
                    }
                  />
                )}
                <button
                  type="button"
                  aria-current={current ? 'true' : undefined}
                  onClick={() => {
                    props.onSelect(entry.id);
                  }}
                  className={
                    current
                      ? 'flex flex-1 items-baseline gap-2 rounded-control bg-surface-muted px-2 py-1 text-start text-sm'
                      : 'flex flex-1 items-baseline gap-2 rounded-control px-2 py-1 text-start text-sm hover:bg-surface-muted'
                  }
                >
                  <span className="text-ink">{nameOfEntry(entry)}</span>
                  {entryGate(props.book, entry).active ? null : (
                    <span className="text-xs text-ink-faint">off</span>
                  )}
                  {unsaved ? <span className="ms-auto text-xs text-ink-muted">unsaved</span> : null}
                </button>

                {/*
                 * **The keyboard's half of the same gesture**, and not an
                 * afterthought: a list that can only be reordered by dragging
                 * cannot be reordered by a keyboard at all, which is the whole
                 * of [work plan §2.1]'s day-one habit failing in one control. Shown on
                 * hover and on focus, so a pointer sees them where it is looking
                 * and a tab reaches them where it is.
                 */}
                <span className="flex gap-1 opacity-0 transition-opacity group-focus-within/entry:opacity-100 group-hover/entry:opacity-100">
                  <button
                    type="button"
                    aria-label={`Move ${nameOfEntry(entry)} up`}
                    disabled={previous === undefined}
                    className={nudge}
                    onClick={() => {
                      if (previous !== undefined) move(entry, previous.id, at - 1);
                    }}
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    aria-label={`Move ${nameOfEntry(entry)} down`}
                    disabled={next === undefined}
                    className={nudge}
                    onClick={() => {
                      if (next !== undefined) move(entry, after(next.id), at + 1);
                    }}
                  >
                    ↓
                  </button>
                </span>
              </li>
            );
          })}
        </ul>
      )}

      {/*
       * One region for the whole list rather than a message per row: what is
       * announced is the outcome of a gesture, and a live region that moves with
       * the rows is one that gets re-read when the list re-renders.
       */}
      <span aria-live="polite" className="sr-only">
        {moved}
      </span>
    </div>
  );
}

/** The name a row shows, which is also the name a control is labelled with. */
function nameOfEntry(entry: LoreEntry): string {
  return entry.name === '' ? 'Untitled entry' : entry.name;
}

/**
 * The folder gates, writable — the other half of what this stage owes.
 *
 * **The gate writes only `folders[].enabled`.** The schema says a shut folder
 * leaves each entry's own `enabled` *preserved rather than mutated*, and
 * [10 §5.3] says turning a folder off must never look like turning its entries
 * off; a control that also flipped the entries would destroy the variant switch
 * [11 §2] says this field already is.
 *
 * **The folder's name is a second control**, selecting it: that narrows the
 * entry list and, more importantly, is where a new entry lands. `folderId` is
 * not a field this stage writes ([10 §11.2d]'s minimum), so the place an entry
 * is filed has to be chosen at the moment it is created or there is nowhere to
 * choose it at all.
 */
/**
 * ***The six knobs that govern retrieval, with a control at last*** —
 * [P7.14](../../../../docs/design/workplan/23-p7-implementation.md), discharging
 * two of the four instances [P7 §0.1a] found of the standing line *no
 * configuration without a surface*.
 *
 * **They all have live consumers and had no write path anywhere.** `scanDepth`,
 * `tokenBudget`, `entryLimit`, `recursiveScanning` and `maxRecursionDepth` are
 * read by `retrieval/` on every turn that touches a book, and the only way to
 * set one was to edit the file by hand. [work plan §2.3]'s own test is *"whether
 * the feature can be used at all without someone setting the value"*, and
 * recursive scanning cannot: it is off by default and nothing could turn it on.
 *
 * *The book's `enabled` gate comes with them*, because it is the coarsest of the
 * six and shares their surface: a book switched off retrieves nothing, which is
 * how you compare with and without.
 *
 * ***Labels through `labelFor`, not written here.*** They come out identical to
 * the read view's — *Scan depth*, *Token budget*, *Entry limit*, *Recursive
 * scanning*, *Max recursion depth* — and that is the point rather than a
 * coincidence: [polish §1]'s *one description, two renderings* means the two
 * surfaces must not be able to drift, and two literal tables are exactly how
 * they would.
 *
 * **Bounds from the schema, for [10 §15.3]'s reason**: `entryLimit` is 1–1000
 * in `lorebook.ts`, so the browser refuses an out-of-range value before the save
 * does. A hand-written `min` here would be the same second description one level
 * down.
 */
function BookRetrieval(props: {
  book: Lorebook;
  onSet: (patch: Record<string, unknown>) => void;
}): JSX.Element {
  const { book, onSet } = props;
  const declared = schemaFor(LOREBOOK_SCHEMA)?.properties;
  const node = (key: string): SchemaNode | undefined => asSchemaNode(declared?.[key]);

  return (
    <section>
      <SectionTitle as="h2" className="mb-2">
        Retrieval
      </SectionTitle>
      <Fine>
        What this book costs a turn, and how hard it looks. Every one of these is read on every turn
        that reaches this book.
      </Fine>

      <div className="mt-3 flex flex-col gap-4">
        {/*
         * ***The one label here written by hand, and the exception is narrow.***
         * `labelFor('enabled')` is *Enabled*, and this page already has an
         * *Enabled* — the selected entry's own switch, two sections down. Two
         * controls with one accessible name on one page is the ambiguity
         * [10 §15.2] is about, and the section heading resolves it visually and
         * not for anybody reading the controls in order.
         *
         * *The five below keep `labelFor`*, because they have a second rendering
         * on the book page and drift between the two is exactly what that
         * derivation prevents. This one has no second rendering at all, so there
         * is nothing to drift from — the field name plus its scope is what
         * distinguishes it, and that is what the label says.
         */}
        <CheckboxField
          label="Book enabled"
          checked={book.enabled}
          onChange={(enabled) => {
            onSet({ enabled });
          }}
          hint="Off retrieves nothing from this book, whatever its entries and folders say."
        />

        <NumberRow
          label={labelFor('scanDepth')}
          value={book.scanDepth}
          schema={node('scanDepth')}
          onChange={(scanDepth) => {
            onSet({ scanDepth });
          }}
          hint="How many recent messages are searched for keys. 0 searches the whole session."
        />

        <NumberRow
          label={labelFor('tokenBudget')}
          value={book.tokenBudget}
          schema={node('tokenBudget')}
          onChange={(tokenBudget) => {
            onSet({ tokenBudget });
          }}
          hint="The most this book may contribute to one prompt. 0 is unlimited."
        />

        <NumberRow
          label={labelFor('entryLimit')}
          value={book.entryLimit}
          schema={node('entryLimit')}
          onChange={(entryLimit) => {
            onSet({ entryLimit });
          }}
          hint="The most entries that may fire at once, whatever the budget allows."
        />

        <CheckboxField
          label={labelFor('recursiveScanning')}
          checked={book.recursiveScanning}
          onChange={(recursiveScanning) => {
            onSet({ recursiveScanning });
          }}
          hint="On, an entry that fired is itself searched for keys, so one entry can pull in another."
        />

        <NumberRow
          label={labelFor('maxRecursionDepth')}
          value={book.maxRecursionDepth}
          schema={node('maxRecursionDepth')}
          onChange={(maxRecursionDepth) => {
            onSet({ maxRecursionDepth });
          }}
          hint="How many times that can chain. Ignored with recursive scanning off."
        />
      </div>
    </section>
  );
}

/** A schema node, or nothing — the same narrowing `fields.ts` does internally. */
function asSchemaNode(value: unknown): SchemaNode | undefined {
  return typeof value === 'object' && value !== null ? value : undefined;
}

/**
 * A number held as text while it is being typed.
 *
 * **`LinesField`'s pattern, for `NumberField`'s stated reason**: *"a partially
 * typed number is not one — `''` and `'-'` are both states a person passes
 * through, and a controlled numeric input that rejects them deletes the
 * character they just typed."* So the text is state and the number is derived,
 * and the draft keeps the last value that parsed.
 *
 * *Re-seeded on inequality rather than on identity*, which is where this differs
 * from `LinesField` and why: a number is a primitive, so `!==` is the same test
 * that component makes on a reference. Typing hands the parent exactly the
 * number this produced and it comes back equal, leaving the buffer alone; a
 * value arriving from a version restore or a 412 reload differs and re-seeds.
 */
function NumberRow(props: {
  label: string;
  value: number;
  schema: SchemaNode | undefined;
  onChange: (value: number) => void;
  hint: string;
}): JSX.Element {
  const [held, setHeld] = useState<{ text: string; from: number }>(() => ({
    text: String(props.value),
    from: props.value,
  }));

  if (props.value !== held.from) {
    setHeld({ text: String(props.value), from: props.value });
  }

  return (
    <NumberField
      label={props.label}
      value={held.text}
      {...boundsOf(props.schema)}
      onChange={(text) => {
        const parsed = Number(text);
        // An unparseable box keeps the last number that did parse, so the draft
        // is never briefly invalid — and `''` is deliberately in that set, even
        // though `Number('')` is 0: an empty box is somebody mid-edit, and 0 is
        // a *meaningful* value for two of these three fields.
        const next = text.trim() === '' || Number.isNaN(parsed) ? held.from : parsed;
        setHeld({ text, from: next });
        props.onChange(next);
      }}
      hint={props.hint}
    />
  );
}

function FolderGates(props: {
  book: Lorebook;
  chosen: FolderChoice;
  locale: string | undefined;
  onChoose: (choice: FolderChoice) => void;
  onGate: (folderId: string, enabled: boolean) => void;
}): JSX.Element | null {
  const { book } = props;
  if (book.folders.length === 0) return null;

  const ordered = [...book.folders].sort((a, b) => a.order - b.order);
  const picked = (id: string | null): boolean => props.chosen?.id === id;
  const choose = (id: string | null) => () => {
    props.onChoose(picked(id) ? null : { id });
  };

  return (
    <section>
      <SectionTitle as="h2" className="mb-2">
        Folders
      </SectionTitle>
      <table className={table.root}>
        <thead>
          <tr className={table.head}>
            <th scope="col" className={table.thCompact}>
              Folder
            </th>
            <th scope="col" className={table.thCompact}>
              Gate
            </th>
            <th scope="col" className={table.thNumeric}>
              Entries
            </th>
          </tr>
        </thead>
        <tbody>
          {ordered.map((entry) => (
            <tr key={entry.id} className={table.row}>
              <td className={table.cellCompact}>
                <button
                  type="button"
                  aria-pressed={picked(entry.id)}
                  onClick={choose(entry.id)}
                  className="underline decoration-line-strong hover:decoration-ink-subtle"
                >
                  {entry.name === '' ? 'Untitled folder' : entry.name}
                </button>
              </td>
              <td className={table.cellCompact}>
                {/*
                 * A bare checkbox rather than `CheckboxField`, which is the one
                 * place in this file that reaches past the primitive. The
                 * primitive puts a visible label beside the box and the
                 * consequence beneath it, and both are already on screen here:
                 * the row names the folder and the column header names what the
                 * switch does. Rendering them again would print the folder's
                 * name twice in one row. The accessible name is supplied
                 * instead, because a screen reader is not reading the row.
                 */}
                <input
                  type="checkbox"
                  checked={entry.enabled}
                  aria-label={`Gate for ${entry.name === '' ? 'Untitled folder' : entry.name}`}
                  onChange={(event) => {
                    props.onGate(entry.id, event.target.checked);
                  }}
                />
              </td>
              <td className={table.cellNumeric}>
                {formatCount(entriesGoverned(book, entry.id).length, props.locale)}
              </td>
            </tr>
          ))}
          <tr className={table.row}>
            <td className={table.cellCompact}>
              <button
                type="button"
                aria-pressed={picked(null)}
                onClick={choose(null)}
                className="text-ink-subtle underline decoration-line-strong hover:decoration-ink-subtle"
              >
                Ungrouped
              </button>
            </td>
            <td className={table.cellCompact}>
              <Fine>Always on</Fine>
            </td>
            <td className={table.cellNumeric}>
              {formatCount(entriesGoverned(book, null).length, props.locale)}
            </td>
          </tr>
        </tbody>
      </table>
    </section>
  );
}
