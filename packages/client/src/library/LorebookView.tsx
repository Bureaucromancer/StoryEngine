// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { useState, type JSX } from 'react';

import {
  entriesInFolder,
  entryGate,
  LOREBOOK_SCHEMA,
  offCount,
  type GateReason,
  type Lorebook,
  type LoreEntry,
  type LoreFolder,
} from '@storyengine/shared';

import { formatCount } from '../format.js';
import { Badge } from '../ui/Badge.js';
import { Button } from '../ui/Button.js';
import { table } from '../ui/classes.js';
import { Panel } from '../ui/Panel.js';
import { Fine, Note, SectionTitle, SubsectionTitle } from '../ui/Text.js';
import { ByFields } from './ByField.js';
import { itemSchemaOf, schemaFor, type SchemaNode } from './fields.js';

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

export function LorebookView({ book }: { book: Lorebook }): JSX.Element {
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
  const allOpen = expanded.size === book.entries.length && book.entries.length > 0;

  return (
    <div className="flex flex-col gap-8">
      <BookHeader book={book} />
      <FolderGates book={book} />

      <section>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <SectionTitle as="h2">Entries</SectionTitle>
          {book.entries.length === 0 ? null : (
            <Button
              type="button"
              variant="quiet"
              size="compact"
              onClick={() => {
                setExpanded(allOpen ? new Set() : new Set(book.entries.map((entry) => entry.id)));
              }}
            >
              {allOpen ? 'Collapse all' : 'Expand all'}
            </Button>
          )}
        </div>

        {book.entries.length === 0 ? (
          <Note>This book has no entries.</Note>
        ) : (
          <div className="flex flex-col gap-4">
            {book.entries.map((entry) => (
              <EntryUnit
                key={entry.id}
                book={book}
                entry={entry}
                open={expanded.has(entry.id)}
                onToggle={() => {
                  setExpanded((current) => {
                    const next = new Set(current);
                    if (!next.delete(entry.id)) next.add(entry.id);
                    return next;
                  });
                }}
              />
            ))}
          </div>
        )}
      </section>
    </div>
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
function FolderGates({ book }: { book: Lorebook }): JSX.Element | null {
  const ungrouped = entriesInFolder(book, null);
  if (book.folders.length === 0 && ungrouped.length === book.entries.length) return null;

  const ordered = [...book.folders].sort((a, b) => a.order - b.order);

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
                {folder.name === '' ? 'Untitled folder' : folder.name}
              </td>
              <td className={table.cellCompact}>
                {folder.enabled ? <Fine>On</Fine> : <Badge>Off</Badge>}
              </td>
              <td className={table.cellNumeric}>
                {formatCount(entriesInFolder(book, folder.id).length)}
              </td>
            </tr>
          ))}
          {ungrouped.length === 0 ? null : (
            <tr className={table.row}>
              <td className={table.cellCompact}>
                <span className="text-ink-subtle">Ungrouped</span>
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
  open: boolean;
  onToggle: () => void;
}): JSX.Element {
  const { book, entry } = props;
  const gate = entryGate(book, entry);
  const blocked = gate.blockedBy[0];

  return (
    <Panel variant="card" className="flex flex-col gap-2">
      <div className="flex flex-wrap items-baseline gap-2">
        <SubsectionTitle as="h3">
          {entry.name === '' ? 'Untitled entry' : entry.name}
        </SubsectionTitle>
        {entry.tag === null || entry.tag === '' ? null : <Badge>{entry.tag}</Badge>}
        {blocked === undefined ? null : (
          <span className="text-xs font-medium text-danger-ink">
            {blocked.kind === 'folder-off'
              ? `off: the folder ${blocked.folderName} is off`
              : OFF_LABELS[blocked.kind]}
          </span>
        )}
      </div>

      {entry.keys.length === 0 ? null : (
        <ul className="flex flex-wrap gap-1">
          {entry.keys.map((key) => (
            <li key={key}>
              <Badge>{key}</Badge>
            </li>
          ))}
        </ul>
      )}

      {entry.description === '' ? null : <Fine>{entry.description}</Fine>}

      {entry.content === '' ? (
        <Note>This entry has no content.</Note>
      ) : (
        <p
          className={
            props.open
              ? 'whitespace-pre-wrap text-sm text-ink'
              : 'line-clamp-6 whitespace-pre-wrap text-sm text-ink'
          }
        >
          {entry.content}
        </p>
      )}

      <div>
        <Button type="button" variant="quiet" size="tiny" onClick={props.onToggle}>
          {props.open ? 'Show less' : 'Show all'}
        </Button>
      </div>

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
