// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { useEffect, useRef, useState, type JSX, type ReactNode } from 'react';

import {
  entriesGoverned,
  entriesInFolder,
  entryGate,
  LOREBOOK_SCHEMA,
  offCount,
  resolvedFolderId,
  type GateReason,
  type Lorebook,
  type LoreEntry,
  type LoreFolder,
} from '@storyengine/shared';

import { formatCount } from '../format.js';
import { Badge } from '../ui/Badge.js';
import { Button } from '../ui/Button.js';
import { table } from '../ui/classes.js';
import { Field } from '../ui/Field.js';
import { Panel } from '../ui/Panel.js';
import { Fine, Note, SectionTitle, SubsectionTitle } from '../ui/Text.js';
import { ByFields } from './ByField.js';
import { itemSchemaOf, schemaFor, type SchemaNode } from './fields.js';
import type { ObjectImportNotes } from '../api.js';
import { ImportNotes, notesForEntry } from './ImportNotes.js';
import { sentence } from './note-labels.js';
import { entryMatches, highlight, matches } from './search.js';

/**
 * Which folder the list is narrowed to, where the outer `null` is *any folder*
 * and an inner `id` of `null` is the **Ungrouped** node.
 *
 * Two levels rather than a sentinel string, because *ungrouped* is a real node
 * a person can pick and `''` or `'any'` are both values a `folderId` could
 * legally hold. A collision here would silently filter to the wrong set.
 */
type FolderChoice = { id: string | null } | null;

/**
 * The book as a document — [05 §5.3](../../../../docs/design/05-ui-surfaces.md).
 *
 * **Not a new page.** This is what the existing detail route renders when the
 * kind is `lorebooks`, so there stays one detail route and one place the
 * shadowed-copy discriminator lives. The header, the storage block and *As
 * stored* are the page's and are unchanged; what this replaces is the generic
 * by-field body, because a lorebook is the only library kind whose object is a
 * collection and a by-field rendering of a three-hundred-entry array is not a
 * reading surface.
 *
 * **It renders configuration and never behaviour**, which is
 * [P5 §1.6](../../../../docs/design/workplan/07-p5-implementation.md)'s line
 * between the two halves of this phase: nothing here says *will fire*. An
 * entry that is off says so and says which gate did it; whether an active entry
 * ever matches anything is the retriever's to answer, at a surface that has a
 * matcher behind it.
 *
 * **The default density is the readable one and the default order is the
 * file's.** Compact is one click away and injection order is an offered sort,
 * both deliberately not the default: a page that opens as a table has settled
 * the question of whether these are documents before the reader arrives, and
 * sorting a reading list by `order` would sort it by something that has nothing
 * to do with reading.
 */

/** What the readable unit already shows, so the fold does not repeat it. */
const SHOWN_ABOVE = new Set(['name', 'content', 'description', 'keys', 'tag']);

/** §5.3's three ways off, in the design's own words. */
const OFF_LABELS: Record<GateReason['kind'], string> = {
  'entry-off': 'off',
  'folder-off': 'off: its folder is off',
  'book-off': 'off: the book is off',
};

/**
 * Why this object cannot be read as a book, in one sentence — or null when it
 * can.
 *
 * The same crash guard `actorFormShape` is, for the same reason: a hand-edited
 * file is the storage thesis working, and a white screen is the one answer this
 * surface may not give it. The page falls back to the by-field view, which
 * renders whatever is actually there.
 */
export function lorebookShape(object: Record<string, unknown>): string | null {
  if (!Array.isArray(object['entries'])) return 'its "entries" is not a list';
  if (!Array.isArray(object['folders'])) return 'its "folders" is not a list';
  for (const entry of object['entries'] as unknown[]) {
    if (typeof entry !== 'object' || entry === null) return 'an entry is not an object';
  }
  for (const folder of object['folders'] as unknown[]) {
    if (typeof folder !== 'object' || folder === null) return 'a folder is not an object';
  }
  return null;
}

/** `Lorebook.entries.items` — the entry schema, for the fold. */
function entrySchema(): SchemaNode | undefined {
  const declared = schemaFor(LOREBOOK_SCHEMA)?.properties?.['entries'];
  return itemSchemaOf(typeof declared === 'object' && declared !== null ? declared : undefined);
}

/**
 * Wraps an entry's name in a link to that entry's own address.
 *
 * Supplied by the page rather than built here, because the address of a *copy*
 * is `?source=&slug=` and an entry link that dropped those would send a reader
 * of the shadowed copy to the winner. One place builds links; this renders what
 * it is given.
 */
export type EntryLink = (entryId: string, children: ReactNode) => JSX.Element;

export function LorebookView({
  book,
  focused,
  linkToEntry,
  importNotes,
}: {
  book: Lorebook;
  /** The entry `?entry=` names, or null. Unknown ids simply match nothing. */
  focused?: string | null;
  linkToEntry?: EntryLink;
  /** What every import said about this book ([P5 §1.8]). */
  importNotes?: ObjectImportNotes[];
}): JSX.Element {
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
  const [query, setQuery] = useState('');
  const [key, setKey] = useState<string | null>(null);
  const [tag, setTag] = useState<string | null>(null);
  const [folder, setFolder] = useState<FolderChoice>(null);
  const narrowed = query !== '' || key !== null || tag !== null || folder !== null;

  /**
   * **Within a book, search is free, and §5.3 calls that the strongest fact in
   * the section**: the detail route already holds the whole object, so nothing
   * here asks the server anything. The four narrowings compose — a key chip and
   * a folder and a search term are all *and* — because each answers a different
   * question and a person who has picked two has narrowed twice on purpose.
   */
  const visible = book.entries.filter(
    (entry) =>
      entryMatches(entry, query) &&
      (key === null || entry.keys.includes(key) || entry.secondaryKeys.includes(key)) &&
      (tag === null || entry.tag === tag) &&
      (folder === null || resolvedFolderId(book, entry) === folder.id),
  );

  const allOpen = visible.length > 0 && visible.every((entry) => expanded.has(entry.id));
  const clear = (): void => {
    setQuery('');
    setKey(null);
    setTag(null);
    setFolder(null);
  };

  return (
    <div className="flex flex-col gap-8">
      <BookHeader book={book} />
      <ImportNotes rows={importNotes ?? []} />
      <FolderGates book={book} chosen={folder} onChoose={setFolder} />

      <section>
        <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
          <SectionTitle as="h2">Entries</SectionTitle>
          {book.entries.length === 0 ? null : (
            <Button
              type="button"
              variant="quiet"
              size="compact"
              onClick={() => {
                setExpanded(allOpen ? new Set() : new Set(visible.map((entry) => entry.id)));
              }}
            >
              {allOpen ? 'Collapse all' : 'Expand all'}
            </Button>
          )}
        </div>

        {book.entries.length === 0 ? (
          <Note>This book has no entries.</Note>
        ) : (
          <>
            <div className="mb-3 flex flex-col gap-2">
              {/*
               * `Field`, rather than a search box of its own. §5.3 asks that the
               * input mounted here be "the same component the eventual
               * cross-library box will use", and the way to be that is to be the
               * one text control this client already has — a second component
               * whose only job was to be shared later would be machinery built
               * ahead of its second caller.
               */}
              <Field
                label="Search this book"
                value={query}
                onChange={setQuery}
                placeholder="Name, keys, description or content"
                hint="Everything here is local — nothing is sent anywhere."
              />

              {narrowed ? (
                <div className="flex flex-wrap items-center gap-2 text-sm text-ink-subtle">
                  <span>{`Showing ${formatCount(visible.length)} of ${formatCount(book.entries.length)}`}</span>
                  {key === null ? null : (
                    <Chip
                      label={`key: ${key}`}
                      onClick={() => {
                        setKey(null);
                      }}
                    />
                  )}
                  {tag === null ? null : (
                    <Chip
                      label={`tag: ${tag}`}
                      onClick={() => {
                        setTag(null);
                      }}
                    />
                  )}
                  {folder === null ? null : (
                    <Chip
                      label={`folder: ${folderName(book, folder.id)}`}
                      onClick={() => {
                        setFolder(null);
                      }}
                    />
                  )}
                  <Button type="button" variant="quiet" size="tiny" onClick={clear}>
                    Clear
                  </Button>
                </div>
              ) : null}
            </div>

            {visible.length === 0 ? (
              <Note>No entry in this book matches.</Note>
            ) : (
              <div className="flex flex-col gap-4">
                {visible.map((entry) => (
                  <EntryUnit
                    key={entry.id}
                    book={book}
                    entry={entry}
                    query={query}
                    activeKey={key}
                    focused={entry.id === (focused ?? null)}
                    importNotes={notesForEntry(importNotes ?? [], entry.name)}
                    linkToEntry={linkToEntry}
                    open={expanded.has(entry.id)}
                    onToggle={() => {
                      setExpanded((current) => {
                        const next = new Set(current);
                        if (!next.delete(entry.id)) next.add(entry.id);
                        return next;
                      });
                    }}
                    onKey={setKey}
                    onTag={setTag}
                  />
                ))}
              </div>
            )}
          </>
        )}
      </section>
    </div>
  );
}

/** The clamp, in lines, and what it takes for text to reach it. */
const CLAMP_LINES = 6;
const CLAMP_CHARS = 400;

/** Whether this text is long enough that a clamp would actually clamp it. */
function clampable(content: string): boolean {
  return content.split(/\r?\n/).length > CLAMP_LINES || content.length > CLAMP_CHARS;
}
/** A folder's name for a chip, or the word the Ungrouped node goes by. */
function folderName(book: Lorebook, id: string | null): string {
  if (id === null) return 'Ungrouped';
  const found = book.folders.find((candidate) => candidate.id === id);
  return found === undefined || found.name === '' ? 'Untitled folder' : found.name;
}

/** An active narrowing, and the control that removes it. */
function Chip({ label, onClick }: { label: string; onClick: () => void }): JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded-control bg-badge-surface px-2 py-0.5 text-xs font-medium text-badge-ink hover:bg-surface-muted"
    >
      {label}
    </button>
  );
}

/** The matched stretches of a string, marked. Renders plainly when nothing is. */
function Marked({ text, query }: { text: string; query: string }): JSX.Element {
  return (
    <>
      {highlight(text, query).map((run, index) =>
        run.hit ? (
          <mark
            key={`${String(index)}:${run.text}`}
            className="rounded-control bg-highlight-surface text-highlight-ink"
          >
            {run.text}
          </mark>
        ) : (
          <span key={`${String(index)}:${run.text}`}>{run.text}</span>
        ),
      )}
    </>
  );
}

/**
 * The book's own fields, and the counts §5.3 asks for beside them.
 *
 * *214 entries, 31 off* is the shape of a book's variants, and it is invisible
 * at every surface that exists without it. The activation settings are one
 * quiet strip below: [02 §3.1]'s *each flag is a direct UI control* is
 * satisfied by **reachable**, not by prominent, and this is the first place
 * that distinction has to be made out loud.
 */
function BookHeader({ book }: { book: Lorebook }): JSX.Element {
  const off = offCount(book);

  return (
    <section className="flex flex-col gap-3">
      {book.description === '' ? null : (
        <p className="whitespace-pre-wrap text-ink">{book.description}</p>
      )}

      <p className="text-sm text-ink-subtle">
        {off === 0
          ? `${formatCount(book.entries.length)} entries`
          : `${formatCount(book.entries.length)} entries, ${formatCount(off)} off`}
      </p>

      {book.tags.length === 0 ? null : (
        <div className="flex flex-wrap gap-2">
          {book.tags.map((tag) => (
            <Badge key={tag}>{tag}</Badge>
          ))}
        </div>
      )}

      <Panel variant="inset">
        <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-1 text-xs">
          <Setting label="Scan depth">{formatCount(book.scanDepth)}</Setting>
          <Setting label="Token budget">{formatCount(book.tokenBudget)}</Setting>
          <Setting label="Entry limit">{formatCount(book.entryLimit)}</Setting>
          <Setting label="Recursive scanning">{book.recursiveScanning ? 'Yes' : 'No'}</Setting>
          <Setting label="Max recursion depth">{formatCount(book.maxRecursionDepth)}</Setting>
        </dl>
      </Panel>
    </section>
  );
}

function Setting({ label, children }: { label: string; children: string }): JSX.Element {
  return (
    <>
      <dt className="text-ink-faint">{label}</dt>
      <dd className="text-ink-muted tabular-nums">{children}</dd>
    </>
  );
}

/**
 * The folders panel — each folder with its gate and what it governs.
 *
 * **The column is headed *Gate*, which is the schema's own word for it**, so
 * nothing here is invented vocabulary. This is where *does this timeline
 * contain the airborne carrier* becomes a one-screen answer, and it is a
 * rendering of `folders[].enabled` and nothing else.
 *
 * **Ungrouped is a real row.** `folderId: null` gets a node rather than being
 * quietly omitted, because a nullable field that renders as nothing hides
 * entries — and so does a `folderId` naming a folder the book does not contain,
 * which lands in the same row for the same reason.
 */
function FolderGates(props: {
  book: Lorebook;
  chosen: FolderChoice;
  onChoose: (choice: FolderChoice) => void;
}): JSX.Element | null {
  const { book } = props;
  const ungrouped = entriesInFolder(book, null);
  if (book.folders.length === 0 && ungrouped.length === book.entries.length) return null;

  const ordered = [...book.folders].sort((a, b) => a.order - b.order);

  /** Picking the folder already picked unpicks it, so the row is the way back. */
  const choose = (id: string | null) => () => {
    props.onChoose(props.chosen !== null && props.chosen.id === id ? null : { id });
  };
  const picked = (id: string | null): boolean => props.chosen !== null && props.chosen.id === id;

  return (
    <section>
      <SubsectionTitle as="h2" className="mb-2">
        Folders
      </SubsectionTitle>
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
          {ordered.map((folder) => (
            <tr key={folder.id} className={table.row}>
              <td
                className={table.cellCompact}
                style={{ paddingInlineStart: indent(book, folder) }}
              >
                {/*
                 * The name is the control. §5.3 wants a key chip to filter the
                 * book to the entries carrying it; a folder row is the same
                 * gesture one level up, and giving it to the row rather than to
                 * a separate control keeps the panel a rendering of
                 * `folders[].enabled` with one affordance rather than two lists
                 * of the same folders.
                 */}
                <button
                  type="button"
                  aria-pressed={picked(folder.id)}
                  onClick={choose(folder.id)}
                  className="underline decoration-line-strong hover:decoration-ink-subtle"
                >
                  {folder.name === '' ? 'Untitled folder' : folder.name}
                </button>
              </td>
              <td className={table.cellCompact}>
                {folder.enabled ? <Fine>On</Fine> : <Badge>Off</Badge>}
              </td>
              <td className={table.cellNumeric}>
                {formatCount(entriesGoverned(book, folder.id).length)}
              </td>
            </tr>
          ))}
          {ungrouped.length === 0 ? null : (
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
                <Fine>On</Fine>
              </td>
              <td className={table.cellNumeric}>{formatCount(ungrouped.length)}</td>
            </tr>
          )}
        </tbody>
      </table>
    </section>
  );
}

/**
 * How deep a folder sits, as an inline-start inset.
 *
 * An inline style rather than a class, because the depth is data: a class per
 * level would be a fixed ladder that a book nested one deeper than we guessed
 * falls off. Bounded so a pathological file cannot push a name off the page,
 * and cycle-guarded because these files are hand-edited.
 */
function indent(book: Lorebook, folder: LoreFolder): string {
  const byId = new Map(book.folders.map((found) => [found.id, found]));
  const seen = new Set<string>([folder.id]);
  let depth = 0;
  let parent = folder.parentFolderId;
  while (parent !== null && !seen.has(parent) && depth < 6) {
    seen.add(parent);
    const found = byId.get(parent);
    if (found === undefined) break;
    depth += 1;
    parent = found.parentFolderId;
  }
  return `${String(depth * 1.25)}rem`;
}

/**
 * One entry, as a readable unit.
 *
 * Name, its `tag`, its keys as an index-term row, `description` set apart above
 * the body, `content` in reading measure and clamped with an expand — and,
 * folded beneath, *as configured*, carrying every remaining field in the
 * schema's own groups. The fold is the component the editor will use in its
 * read-only mode, so a field added to the schema appears in both without a
 * second edit.
 */
function EntryUnit(props: {
  book: Lorebook;
  entry: LoreEntry;
  query: string;
  activeKey: string | null;
  focused: boolean;
  importNotes: ObjectImportNotes['notes'];
  // Required and nullable rather than optional: `exactOptionalPropertyTypes`
  // makes those different, and the caller forwards a value that may be absent.
  linkToEntry: EntryLink | undefined;
  open: boolean;
  onToggle: () => void;
  onKey: (key: string | null) => void;
  onTag: (tag: string | null) => void;
}): JSX.Element {
  const { book, entry, query, focused } = props;
  const gate = entryGate(book, entry);
  const blocked = gate.blockedBy[0];
  const card = useRef<HTMLDivElement>(null);

  /**
   * **Landing on an entry is the whole point of it having an address**, and in
   * a book of a few hundred an address that does not bring the entry into view
   * has delivered the reader to the right page and the wrong screen. Runs when
   * the focused entry changes rather than on every render, so narrowing the
   * list does not keep yanking the page around.
   */
  useEffect(() => {
    if (focused) card.current?.scrollIntoView({ block: 'center' });
  }, [focused, entry.id]);

  const name = entry.name === '' ? 'Untitled entry' : entry.name;

  /**
   * **A search opens the entries whose prose answered it.** The body is clamped
   * by default because these are documents, but a clamp that hides the very
   * words somebody just searched for is a search that found something and then
   * put it out of sight. Only for a match in `content` — a hit on the name or a
   * key is already visible above the clamp.
   */
  const open = props.open || (query !== '' && matches(entry.content, query));

  return (
    <Panel
      variant="card"
      ref={card}
      /*
       * Marked rather than merely scrolled to. Arriving at a page that has
       * quietly moved is disorienting on its own; the outline says *this is the
       * one the link meant*, and it uses the focus token because "which entry
       * is in focus" is §5.3's own phrase for what the address carries.
       */
      className={focused ? 'flex flex-col gap-2 outline-2 outline-focus' : 'flex flex-col gap-2'}
      {...(focused ? { 'aria-current': 'true' as const } : {})}
    >
      <div className="flex flex-wrap items-baseline gap-2">
        <SubsectionTitle as="h3">
          {props.linkToEntry === undefined ? (
            <Marked text={name} query={query} />
          ) : (
            props.linkToEntry(entry.id, <Marked text={name} query={query} />)
          )}
        </SubsectionTitle>
        {entry.tag === null || entry.tag === '' ? null : (
          <Chip
            label={entry.tag}
            onClick={() => {
              props.onTag(entry.tag);
            }}
          />
        )}
        {/*
         * **Muted rather than danger, and that is the same argument the shelf
         * badge makes.** Switching an entry off is something an author does on
         * purpose, and a shut folder gate is not a fault at all — it is the
         * mechanism a book carries a timeline with. Colouring either as an
         * error is the surface arguing with the person who wrote the file.
         * §5.3 asks for text first and colour second; the words are doing the
         * work, and they are the design's own words.
         */}
        {blocked === undefined ? null : (
          <span className="text-xs font-medium text-ink-muted">
            {blocked.kind === 'folder-off'
              ? `off: the folder ${blocked.folderName} is off`
              : OFF_LABELS[blocked.kind]}
          </span>
        )}
      </div>

      {/*
       * **Clicking a key filters the book to the entries carrying it**, which is
       * the one behaviour §5.3 says turns [16 §2]'s soft indexing from an
       * observation into a working index: keywords stop being trigger
       * configuration the moment they are clickable. Clicking the one already
       * chosen unpicks it, so the chip is also the way back.
       */}
      {entry.keys.length === 0 ? null : (
        <ul className="flex flex-wrap gap-1">
          {entry.keys.map((key) => (
            <li key={key}>
              <Chip
                label={key}
                onClick={() => {
                  props.onKey(props.activeKey === key ? null : key);
                }}
              />
            </li>
          ))}
        </ul>
      )}

      {entry.description === '' ? null : (
        <Fine>
          <Marked text={entry.description} query={query} />
        </Fine>
      )}

      {entry.content === '' ? (
        <Note>This entry has no content.</Note>
      ) : (
        <p
          className={
            open
              ? 'whitespace-pre-wrap text-sm text-ink'
              : 'line-clamp-6 whitespace-pre-wrap text-sm text-ink'
          }
        >
          <Marked text={entry.content} query={query} />
        </p>
      )}

      {/*
       * **The control appears only where it does something**, which is a fix
       * rather than a nicety: most entries in a real book are two lines long,
       * and a *Show all* on one of those is a button that visibly changes
       * nothing when pressed — the same complaint `Field` makes about a greyed
       * control that cannot work, arriving from the other direction.
       *
       * An estimate, and it errs toward offering it. The clamp is six lines at
       * whatever width the column happens to be, which is a fact about layout
       * that this component cannot know without measuring; six newlines or four
       * hundred characters is the shape of text that reaches it. Being wrong
       * high costs a button that does nothing — where the page was before —
       * and being wrong low would hide text, so the thresholds sit where they
       * do on purpose.
       */}
      {clampable(entry.content) ? (
        <div>
          <Button type="button" variant="quiet" size="tiny" onClick={props.onToggle}>
            {open ? 'Show less' : 'Show all'}
          </Button>
        </div>
      ) : null}

      {/*
       * **The import's own words about this entry, where the entry is.** §1.8
       * puts an import's consequences on the book; an entry-level note — *this
       * sat at a position with no equivalent here* — belongs on the entry it is
       * about, which is the half that section calls the interesting one.
       */}
      {props.importNotes.length === 0 ? null : (
        <ul className="flex flex-col gap-1 text-xs text-ink-muted">
          {props.importNotes.map((note, index) => (
            <li key={`${note.key}:${String(index)}`}>{sentence(note)}</li>
          ))}
        </ul>
      )}

      <details>
        <summary className="cursor-pointer text-xs text-ink-muted hover:text-ink">
          As configured
        </summary>
        <div className="mt-2">
          {/*
           * `h4`, because these groups sit inside the entry whose name is the
           * `h3` above them. Heading level is document structure and belongs
           * to the page rather than to the component that draws the words.
           */}
          <ByFields schema={entrySchema()} value={entry} omit={SHOWN_ABOVE} headingAs="h4" />
        </div>
      </details>
    </Panel>
  );
}
