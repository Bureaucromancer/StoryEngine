// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { getRouteApi, Link, useNavigate } from '@tanstack/react-router';
import { useEffect, useRef, useState, type JSX } from 'react';

import {
  entriesGoverned,
  entryGate,
  resolvedFolderId,
  uuidv7,
  type GateReason,
  type Lorebook,
  type LoreEntry,
} from '@storyengine/shared';

import { ApiError, type LibraryObject } from '../api.js';
import { formatCount } from '../format.js';
import { AsStored } from '../library/AsStored.js';
import { lorebookShape } from '../library/LorebookView.js';
import { matches } from '../library/search.js';
import { useAuthState, useCreateObject, useEditorBase, useSaveObject } from '../queries.js';
import { Alert } from '../ui/Alert.js';
import { Button } from '../ui/Button.js';
import { page, table } from '../ui/classes.js';
import { Field } from '../ui/Field.js';
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
import { ConflictDialog } from './ActorEditorPage.js';
import { EntryFields } from './EntryFields.js';
import { HistoryPanel } from './HistoryPanel.js';

/**
 * The entry editor's minimum —
 * [P5.1](../../../../docs/design/workplan/07-p5-implementation.md),
 * [05 §11.2d](../../../../docs/design/05-ui-surfaces.md).
 *
 * **The page's subject is the book and its unit of work is an entry**, which is
 * not a compromise between the two but what the write path is: an entry has no
 * address on disk, so creating, renaming or deleting one is a write of the whole
 * lorebook through the same route, hash and history every other object uses
 * ([05 §11.2c] says so from the import side — *"the merge goes through the same
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
  return <Editor initial={base.data} />;
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

function Editor(props: { initial: LibraryObject }): JSX.Element {
  const [base, setBase] = useState(props.initial);
  const [draft, setDraft] = useState<Draft>(() => structuredClone(props.initial.object));
  /**
   * The draft as it read when `base` was loaded — what *my edits* is measured
   * against, both for the entry list's unsaved marks and for the 412 merge.
   * Moves in step with `base`.
   */
  const [pristine, setPristine] = useState<Draft>(() => structuredClone(props.initial.object));
  const [conflict, setConflict] = useState<LibraryObject | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [folder, setFolder] = useState<FolderChoice>(null);

  const auth = useAuthState();
  const locale = auth.data?.account?.locale ?? undefined;
  const save = useSaveObject();
  const createCopy = useCreateObject();
  const navigate = useNavigate();
  const search = routeApi.useSearch();

  const book = draft as unknown as Lorebook;
  const changed = bookChanges(base.object, draft);
  const selected = search.entry === undefined ? undefined : entryOf(draft, search.entry);

  function edit(next: Draft): void {
    setDraft(next);
    setNotice(null);
  }

  /** Selecting an entry is an address, so it goes through the router. */
  function select(id: string | undefined): void {
    setConfirmingDelete(false);
    void navigate({
      to: '/library/lorebooks/$id/edit',
      params: { id: base.id },
      search: id === undefined ? {} : { entry: id },
    });
  }

  function handleSave(): void {
    if (!changed) return;
    /**
     * **Sent unstamped**, unlike the actor editor beside this one. The server
     * stamps `provenance.updatedAt` itself on any real change, and it decides
     * the no-op rule on the object *as sent, before any stamping* — so a client
     * stamp reaches disk in no case at all and only ever makes the sent bytes
     * differ from the file. Since this editor's own change test is the same
     * byte comparison the server makes, sending unstamped keeps the server's
     * test as a live second opinion rather than one this client has disabled.
     */
    save.mutate(
      { kind: 'lorebooks', id: base.id, object: draft, contentHash: base.contentHash },
      {
        onSuccess: (result) => {
          setBase((previous) => ({
            ...previous,
            object: result.object,
            contentHash: result.contentHash,
          }));
          setDraft(structuredClone(result.object));
          setPristine(structuredClone(result.object));
          setNotice('Saved.');
        },
        onError: (failure) => {
          // A 412 the dialog can act on carries the current object. A 409 from
          // a diverged file does not, and reload-and-reapply has nothing to
          // reapply onto — so it stays an error rather than becoming a dialog
          // with a button that cannot work.
          if (failure instanceof ApiError && failure.status === 412 && failure.current) {
            setConflict(failure.current as LibraryObject);
          }
        },
      },
    );
  }

  function reloadAndReapply(): void {
    if (conflict === null) return;
    const problem = editableBookShape(conflict.object);
    if (problem !== null) {
      setConflict(null);
      setNotice(
        `The newer version could not be loaded: ${problem}. Fix the file on disk, then reload this page.`,
      );
      return;
    }
    const merged = reapplyBookEdits(pristine, draft, conflict.object);
    setDraft(merged);
    setPristine(structuredClone(conflict.object));
    setBase(conflict);
    setConflict(null);
    setNotice(
      'The newer version was loaded and your edits were reapplied onto it, entry by entry. Review, then save again.',
    );
  }

  /** The second offer: my version becomes a new book; theirs keeps this one. */
  function saveAsCopy(): void {
    if (conflict === null) return;
    const copy = structuredClone(draft);
    copy['id'] = uuidv7();
    copy['name'] = `${nameOf(draft)} (copy)`;
    createCopy.mutate(
      { kind: 'lorebooks', object: copy },
      {
        onSuccess: (result) => {
          setConflict(null);
          void navigate({
            to: '/library/lorebooks/$id/edit',
            params: { id: result.id },
            search: {},
          });
        },
      },
    );
  }

  const entries = entryList(draft);
  const visible =
    folder === null
      ? entries
      : entries.filter((entry) => resolvedFolderId(book, entry) === folder.id);

  return (
    <>
      <p className="mb-4">
        <Link
          to="/library/$kind/$id"
          params={{ kind: 'lorebooks', id: base.id }}
          search={{}}
          className="text-sm text-ink-subtle underline hover:text-ink"
        >
          Back to the lorebook
        </Link>
      </p>

      <header className="mb-6">
        <h1 className="text-title text-ink">{nameOf(draft)}</h1>
        <p className="text-sm text-ink-subtle">
          {`${formatCount(entries.length, locale)} entries, edited together and saved as one book.`}
        </p>
      </header>

      {notice !== null ? (
        <p
          role="status"
          className="mb-4 rounded-md border border-line-strong bg-surface-sunken p-3 text-sm"
        >
          {notice}
        </p>
      ) : null}

      {save.isError &&
      !(save.error instanceof ApiError && save.error.status === 412 && save.error.current) ? (
        <Alert tone="error" role="alert" className="mb-4">
          {save.error.message}
        </Alert>
      ) : null}

      <form
        className="flex flex-col gap-8"
        onSubmit={(event) => {
          event.preventDefault();
          handleSave();
        }}
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
          hint="What the library shelf calls it. Renaming does not move the file."
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
               * still had it ([05 §11.2a]).
               */}
              <Fine>Nothing is written until you save, and history keeps the version before.</Fine>
            </div>
          </section>
        )}

        <div className="flex items-center gap-3">
          <Button type="submit" disabled={!changed || save.isPending} variant="primary">
            Save
          </Button>
          {changed ? null : <span className="text-sm text-ink-faint">No changes to save.</span>}
          <Button
            type="button"
            className="ms-auto"
            aria-expanded={historyOpen}
            onClick={() => {
              setHistoryOpen((open) => !open);
            }}
          >
            History
          </Button>
        </div>
      </form>

      <div className="mt-6">
        <AsStored
          value={base.object}
          caption="The saved book, not the form's working state — what a reload would find."
        />
      </div>

      {historyOpen ? (
        <div className="mt-6">
          <HistoryPanel
            kind="lorebooks"
            id={base.id}
            currentObject={base.object}
            contentHash={base.contentHash}
            locale={locale}
            onRestored={(result) => {
              setBase((previous) => ({
                ...previous,
                object: result.object,
                contentHash: result.contentHash,
              }));
              setDraft(structuredClone(result.object));
              setPristine(structuredClone(result.object));
              // A restore replaces every entry at once, so the entry the
              // address names may not be in the book any more. Said rather
              // than redirected: the list below is the answer, and silently
              // rewriting somebody's address is worse than telling them.
              setNotice('Version restored. The state you were on is the newest history entry.');
            }}
          />
        </div>
      ) : null}

      {conflict !== null ? (
        <ConflictDialog
          onReload={reloadAndReapply}
          onSaveAsCopy={saveAsCopy}
          onCancel={() => {
            setConflict(null);
          }}
          copyPending={createCopy.isPending}
          copyError={createCopy.isError ? createCopy.error.message : null}
        />
      ) : null}
    </>
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
 * The two nudge buttons, which are one row tall and carry no label text.
 *
 * Inline rather than a token in `classes.ts`, following this package's rule
 * that only what a design decision *shares* is lifted: these are one control in
 * one list, and a token used once is a second place to look.
 */
const nudge =
  'rounded-control px-1 text-sm text-ink-muted hover:bg-surface-muted disabled:opacity-40';

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
  const [moved, setMoved] = useState('');
  const held = useRef<HTMLUListElement>(null);

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
        <ul ref={held} className="flex max-h-80 flex-col overflow-y-auto">
          {visible.map((entry, at) => {
            const before = saved.get(entry.id);
            const unsaved = before === undefined || before !== JSON.stringify(entry);
            const current = entry.id === props.selectedId;
            const previous = visible[at - 1];
            const next = visible[at + 1];
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
                }}
                onDragOver={(event) => {
                  // Without this the drop never fires: the default action for a
                  // dragover is *refuse the drop*.
                  if (dragging !== null && dragging !== entry.id) event.preventDefault();
                }}
                onDrop={(event) => {
                  event.preventDefault();
                  const from = visible.findIndex((candidate) => candidate.id === dragging);
                  const source = visible[from];
                  setDragging(null);
                  if (source === undefined || from === at) return;
                  /**
                   * Dropping on a row above puts the entry in front of it;
                   * dropping on one below puts it behind — which is the same
                   * rule every list with this gesture uses, and the only one
                   * where the row ends up where the pointer left it.
                   */
                  move(source, from > at ? entry.id : after(entry.id), at);
                }}
                className={
                  dragging === entry.id
                    ? 'flex items-baseline gap-1 opacity-50'
                    : 'group/entry flex items-baseline gap-1'
                }
              >
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
                 * of [01 §2.1]'s day-one habit failing in one control. Shown on
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
 * [05 §5.3] says turning a folder off must never look like turning its entries
 * off; a control that also flipped the entries would destroy the variant switch
 * [16 §2] says this field already is.
 *
 * **The folder's name is a second control**, selecting it: that narrows the
 * entry list and, more importantly, is where a new entry lands. `folderId` is
 * not a field this stage writes ([05 §11.2d]'s minimum), so the place an entry
 * is filed has to be chosen at the moment it is created or there is nowhere to
 * choose it at all.
 */
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
