// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { folderOf, TAG_SWATCHES, type TagEntry, type TagFolder } from '@storyengine/shared';
import { useId, useMemo, useState, type JSX } from 'react';

import { useTags, useWriteTags } from '../queries.js';
import { Alert } from '../ui/Alert.js';
import { Button } from '../ui/Button.js';
import { Dialog } from '../ui/Dialog.js';
import { table } from '../ui/classes.js';
import { Field, SelectField } from '../ui/Field.js';
import { landing, nudge } from '../ui/reorder.js';
import { TagChip } from '../ui/TagChip.js';
import { TAG_SWATCH_STYLES, tagClassFor } from '../ui/tag-colors.js';

import { labels } from '../i18n/catalogue.js';

/**
 * The tag manager — [05 §5](../../../../docs/design/05-tagging.md).
 *
 * **Tags in use with no registry entry are rows too**, listed after the
 * registered ones. That is invariant 1 made visible rather than merely
 * promised: this surface shows every tag in the library, not the ones it has
 * opinions about, and the way to give one an opinion is a button rather than a
 * migration.
 *
 * **Renaming asks about lore before it happens.** It is the operation [05 §1]
 * says can change which lore fires, because an entry's `actorTagFilter` holds
 * author-written names and activation compares them exactly. So the surface
 * finds the gates first, says how many, and only rewrites them if told to —
 * both answers are defensible, and choosing one silently is what §1 forbids.
 *
 * **Ordering is manual, and the drag is the second half.** The nudge buttons are
 * the real implementation and the drag is a convenience over the same reducer,
 * which is the way round the entry list settled on: a list reorderable only by
 * dragging is one a keyboard cannot reorder at all.
 */

export type TagSortMode = 'manual' | 'name' | 'count';

const SORTS: readonly (readonly [TagSortMode, string])[] = [
  ['manual', 'Manual order'],
  ['name', 'Name'],
  ['count', 'Most used'],
];

/** The three folder modes, cycled by one control ([05 §5]). */
const FOLDER_NEXT: Record<TagFolder, TagFolder> = {
  none: 'open',
  open: 'closed',
  closed: 'none',
};

const FOLDER_LABEL: Record<TagFolder, string> = labels('tags.folder', {
  none: 'Not a folder',
  open: 'Open folder — members also stay in the list',
  closed: 'Closed folder — members hidden until it is opened',
});

const FOLDER_GLYPH: Record<TagFolder, string> = { none: '–', open: '▾', closed: '▸' };

export interface TagManagerDialogProps {
  onDismiss: () => void;
  /** How many objects carry each tag name, from the shelf the caller is holding. */
  counts: ReadonlyMap<string, number>;
}

export function TagManagerDialog(props: TagManagerDialogProps): JSX.Element {
  const heading = useId();
  const registry = useTags();
  const write = useWriteTags();

  const [sort, setSort] = useState<TagSortMode>('manual');
  const [newName, setNewName] = useState('');
  /** The tag being renamed, and what to. `null` is nobody. */
  const [renaming, setRenaming] = useState<{ id: string; from: string; to: string } | null>(null);
  /** What the last rename reported, so the offer to fix the gates has a subject. */
  const [gates, setGates] = useState<{ book: string; entry: string }[]>([]);
  const [lastRenamed, setLastRenamed] = useState<{ id: string; to: string } | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);

  const tags = useMemo(() => registry.data?.tags ?? [], [registry.data]);

  function countOf(tag: { name: string }): number {
    return props.counts.get(tag.name.toLowerCase()) ?? 0;
  }

  /**
   * Manual order is the stored order; the other two are views over it.
   *
   * Which view you are looking at is a preference and never touches the
   * document — [05 §5]'s split, and what keeps a glance at *most used* from
   * silently rewriting somebody's arrangement.
   */
  const shown = useMemo(() => {
    const rows = [...tags];
    if (sort === 'name') return rows.sort((a, b) => a.name.localeCompare(b.name));
    if (sort === 'count') {
      return rows.sort((a, b) => countOf(b) - countOf(a) || a.name.localeCompare(b.name));
    }
    return rows.sort((a, b) => a.sortOrder - b.sortOrder);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- counts is a prop map, stable per render
  }, [tags, sort, props.counts]);

  /**
   * Registry entries nothing carries — what Prune removes, and nothing else.
   *
   * Reads the counts map directly rather than through `countOf`, which is
   * redeclared on every render and would make the memo recompute every time
   * anyway. The lookup is the same one, spelled where the dependency can see it.
   */
  const unused = useMemo(
    () => tags.filter((tag) => (props.counts.get(tag.name.toLowerCase()) ?? 0) === 0),
    [tags, props.counts],
  );

  /** Tags the library carries that the registry has never heard of. */
  const unregistered = useMemo(() => {
    const known = new Set(tags.map((tag) => tag.name.toLowerCase()));
    return [...props.counts.keys()].filter((name) => !known.has(name)).sort();
  }, [tags, props.counts]);

  function move(id: string, to: number): void {
    const order = shown.map((tag) => tag.id);
    const from = order.indexOf(id);
    if (from === -1 || to < 0 || to >= order.length) return;
    order.splice(to, 0, ...order.splice(from, 1));
    // Dragging while a computed view is on would otherwise write an order the
    // view invented rather than the one on screen, so the view goes back to the
    // one that is actually stored.
    setSort('manual');
    write.mutate({ kind: 'order', ids: order });
  }

  return (
    <Dialog role="dialog" labelledBy={heading} onDismiss={props.onDismiss} size="large">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id={heading} className="text-title text-ink">
          Tags
        </h2>
        <div className="min-w-40">
          <SelectField
            label="Sort by"
            value={sort}
            options={SORTS}
            onChange={(value) => {
              setSort(value as TagSortMode);
            }}
          />
        </div>
      </div>

      <p className="text-sm text-ink-subtle">
        A tag works whether or not it is listed here. This is where it gets a colour, a place in the
        order, and the two behaviours below — nothing here decides which tags you may use.
      </p>

      {write.isError ? (
        <Alert tone="error" role="alert">
          {write.error.message}
        </Alert>
      ) : null}

      {/*
       * **[05 §1]'s answer, shown rather than acted on.** A gate naming the old
       * spelling stops matching, and activation says nothing when it does — so
       * the count is reported and the rewrite is a separate, deliberate press.
       */}
      {gates.length === 0 ? null : (
        <Alert tone="warning" role="status">
          <p className="mb-2">{gatesPrompt(gates.length)}</p>
          <Button
            type="button"
            disabled={write.isPending || lastRenamed === null}
            onClick={() => {
              if (lastRenamed === null) return;
              write.mutate({
                kind: 'rename',
                id: lastRenamed.id,
                to: lastRenamed.to,
                rewriteGates: true,
              });
            }}
          >
            Update them to the new name
          </Button>
        </Alert>
      )}

      {registry.isPending ? <p className="text-ink-subtle">Loading the tags…</p> : null}

      {/*
       * **Nothing between loading and loaded.** An earlier spelling of this
       * condition rendered the table while the query was still pending, so the
       * dialog opened on a header row with nothing under it and then filled in
       * — which reads as *you have no tags* for as long as the request takes.
       */}
      {registry.isPending ? null : tags.length === 0 ? (
        <p className="text-ink-subtle">
          No tag has been given a colour yet. Anything already in use is listed below.
        </p>
      ) : (
        <table className={table.root}>
          <thead>
            <tr className={table.head}>
              <th scope="col" className={table.th}>
                Order
              </th>
              <th scope="col" className={table.th}>
                Tag
              </th>
              <th scope="col" className={table.th}>
                Colour
              </th>
              <th scope="col" className={table.th}>
                Folder
              </th>
              <th scope="col" className={table.th}>
                On cards
              </th>
              <th scope="col" className={table.thNumeric}>
                Used by
              </th>
              <th scope="col" className={table.th}>
                <span className="sr-only">Remove</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {shown.map((tag, index) => (
              <TagRow
                key={tag.id}
                tag={tag}
                index={index}
                total={shown.length}
                count={countOf(tag)}
                manual={sort === 'manual'}
                dropEdge={
                  over === tag.id && dragging !== null
                    ? landing(
                        shown.findIndex((row) => row.id === dragging),
                        index,
                      )
                    : undefined
                }
                onDragStart={() => {
                  setDragging(tag.id);
                }}
                onDragOver={() => {
                  setOver(tag.id);
                }}
                onDrop={() => {
                  if (dragging !== null && dragging !== tag.id) move(dragging, index);
                  setDragging(null);
                  setOver(null);
                }}
                onNudge={(to) => {
                  move(tag.id, to);
                }}
                onPatch={(patch) => {
                  write.mutate({ kind: 'patch', id: tag.id, patch });
                }}
                onRename={() => {
                  setRenaming({ id: tag.id, from: tag.name, to: tag.name });
                }}
                onDelete={() => {
                  write.mutate({ kind: 'delete', id: tag.id });
                }}
              />
            ))}
          </tbody>
        </table>
      )}

      {renaming === null ? null : (
        <Alert tone="warning" role="status">
          <p className="mb-2">{renamePrompt(renaming.from)}</p>
          <div className="flex flex-wrap items-end gap-2">
            <div className="flex-1">
              <Field
                label="New name"
                value={renaming.to}
                onChange={(to) => {
                  setRenaming({ ...renaming, to });
                }}
                required
              />
            </div>
            <Button
              type="button"
              variant="primary"
              disabled={write.isPending || renaming.to.trim() === ''}
              onClick={() => {
                write.mutate(
                  {
                    kind: 'rename',
                    id: renaming.id,
                    to: renaming.to.trim(),
                    // Reported first; rewriting is a second, separate press.
                    rewriteGates: false,
                  },
                  {
                    onSuccess: (result) => {
                      setGates(result.gatesFound ?? []);
                      setLastRenamed({ id: renaming.id, to: renaming.to.trim() });
                      setRenaming(null);
                    },
                  },
                );
              }}
            >
              Rename
            </Button>
            <Button
              type="button"
              onClick={() => {
                setRenaming(null);
              }}
            >
              Cancel
            </Button>
          </div>
        </Alert>
      )}

      {unregistered.length === 0 ? null : (
        <section>
          <h3 className="mb-1 text-sm font-medium text-ink-muted">In use, not listed</h3>
          <p className="mb-2 text-xs text-ink-faint">
            These work exactly as the ones above do. Adding one only gives it somewhere to keep a
            colour.
          </p>
          <ul className="flex flex-wrap items-center gap-2">
            {unregistered.map((name) => (
              <li key={name} className="flex items-center gap-1">
                <TagChip name={name} />
                <Button
                  type="button"
                  size="tiny"
                  aria-label={adoptLabel(name)}
                  disabled={write.isPending}
                  onClick={() => {
                    write.mutate({ kind: 'create', name });
                  }}
                >
                  Add
                </Button>
              </li>
            ))}
          </ul>
        </section>
      )}

      <form
        className="flex items-end gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          if (newName.trim() === '') return;
          write.mutate({ kind: 'create', name: newName.trim() });
          setNewName('');
        }}
      >
        <div className="flex-1">
          <Field
            label="New tag"
            value={newName}
            onChange={setNewName}
            placeholder="A tag nothing uses yet"
          />
        </div>
        <Button type="submit" variant="primary" disabled={write.isPending}>
          Add
        </Button>
      </form>

      <div className="flex flex-wrap items-center justify-between gap-3">
        {/*
         * **Prune removes entries nothing carries, and only those.** It is a
         * registry operation, not a library one: no object is touched, because
         * an entry with a count of zero is by definition on nothing. The count
         * comes from the shelf the caller handed in, so a tag used only by
         * something this view cannot see would be wrongly pruned — which is why
         * the caller passes counts over the *whole* library rather than the
         * filtered shelf.
         */}
        <span className="flex flex-wrap items-center gap-3">
          <Button
            type="button"
            disabled={write.isPending || unused.length === 0}
            onClick={() => {
              for (const tag of unused) write.mutate({ kind: 'delete', id: tag.id });
            }}
          >
            {pruneLabel(unused.length)}
          </Button>
          {/*
           * **The one deliberate write across the library** — [05 §3]. Until it
           * runs, a rename reaches nothing: an object with no ids works from its
           * own names and has no connection to the row that changed. Afterwards
           * every rename is one registry write.
           *
           * A button rather than something the server does on startup, because
           * every object it touches gains a history entry and rewriting a
           * person's files is not a thing to do unasked.
           */}
          <Button
            type="button"
            disabled={write.isPending}
            onClick={() => {
              write.mutate({ kind: 'adopt' });
            }}
          >
            Link tags to the library
          </Button>
        </span>
        <Button type="button" onClick={props.onDismiss}>
          Done
        </Button>
      </div>
    </Dialog>
  );
}

interface TagRowProps {
  tag: TagEntry;
  index: number;
  total: number;
  count: number;
  manual: boolean;
  dropEdge: 'before' | 'after' | undefined;
  onDragStart: () => void;
  onDragOver: () => void;
  onDrop: () => void;
  onNudge: (to: number) => void;
  onPatch: (patch: { swatch?: string | null; folder?: string; hidden?: boolean }) => void;
  onRename: () => void;
  onDelete: () => void;
}

function TagRow(props: TagRowProps): JSX.Element {
  const folder = folderOf(props.tag);

  return (
    <tr
      className={props.dropEdge === undefined ? table.row : `${table.row} bg-surface-muted`}
      data-drop={props.dropEdge}
      draggable={props.manual}
      onDragStart={(event) => {
        // Firefox starts no drag without a payload, whatever the handlers say.
        event.dataTransfer.setData('text/plain', props.tag.id);
        props.onDragStart();
      }}
      onDragOver={(event) => {
        // The default action for a dragover is to refuse the drop.
        event.preventDefault();
        props.onDragOver();
      }}
      onDrop={(event) => {
        event.preventDefault();
        props.onDrop();
      }}
    >
      <td className={table.cell}>
        {props.manual ? (
          <span className="flex items-center gap-1">
            <button
              type="button"
              className={nudge}
              aria-label={moveLabel(props.tag.name, 'up')}
              disabled={props.index === 0}
              onClick={() => {
                props.onNudge(props.index - 1);
              }}
            >
              ↑
            </button>
            <button
              type="button"
              className={nudge}
              aria-label={moveLabel(props.tag.name, 'down')}
              disabled={props.index === props.total - 1}
              onClick={() => {
                props.onNudge(props.index + 1);
              }}
            >
              ↓
            </button>
          </span>
        ) : (
          <span className="text-xs text-ink-faint">—</span>
        )}
      </td>

      <td className={table.cell}>
        <TagChip name={props.tag.name} swatch={props.tag.swatch} />
      </td>

      <td className={table.cell}>
        <span role="radiogroup" aria-label={swatchLabel(props.tag.name)} className="flex gap-1">
          <SwatchButton
            tag={props.tag}
            value={null}
            label="None"
            onPick={(swatch) => {
              props.onPatch({ swatch });
            }}
          />
          {TAG_SWATCHES.map((id) => (
            <SwatchButton
              key={id}
              tag={props.tag}
              value={id}
              label={TAG_SWATCH_STYLES[id].label}
              onPick={(swatch) => {
                props.onPatch({ swatch });
              }}
            />
          ))}
        </span>
      </td>

      <td className={table.cell}>
        <button
          type="button"
          className={nudge}
          title={FOLDER_LABEL[folder]}
          aria-label={folderLabel(props.tag.name, FOLDER_LABEL[folder])}
          onClick={() => {
            props.onPatch({ folder: FOLDER_NEXT[folder] });
          }}
        >
          {FOLDER_GLYPH[folder]}
        </button>
      </td>

      <td className={table.cell}>
        <label className="flex items-center gap-1 text-xs text-ink-muted">
          <input
            type="checkbox"
            checked={!props.tag.hidden}
            onChange={(event) => {
              props.onPatch({ hidden: !event.target.checked });
            }}
          />
          <span className="sr-only">{cardsLabel(props.tag.name)}</span>
          <span aria-hidden="true">Show</span>
        </label>
      </td>

      <td className={table.cellNumeric}>{props.count}</td>

      <td className={table.cell}>
        <span className="flex items-center gap-1">
          <Button
            type="button"
            size="tiny"
            aria-label={renameLabel(props.tag.name)}
            onClick={props.onRename}
          >
            Rename
          </Button>
          <Button type="button" size="tiny" onClick={props.onDelete}>
            Remove
          </Button>
        </span>
      </td>
    </tr>
  );
}

/**
 * One swatch, as a radio in all but element.
 *
 * A button rather than an `<input type="radio">` because the group is eight
 * colours and a label each would be eight visible words; the group carries the
 * name and each button carries its colour's, which is what a reader needs to
 * pick one.
 */
function SwatchButton(props: {
  tag: TagEntry;
  value: string | null;
  label: string;
  onPick: (swatch: string | null) => void;
}): JSX.Element {
  const picked = props.tag.swatch === props.value;
  return (
    <button
      type="button"
      role="radio"
      aria-checked={picked}
      aria-label={props.label}
      title={props.label}
      className={
        picked
          ? `h-5 w-5 rounded-control border-2 border-focus ${tagClassFor(props.value)}`
          : `h-5 w-5 rounded-control border border-line-strong ${tagClassFor(props.value)}`
      }
      onClick={() => {
        props.onPick(props.value);
      }}
    />
  );
}

/*
 * Whole phrases, built here rather than in the JSX. A label spelled
 * `<span>Move {name} up</span>` is a sentence split across children, which the
 * assembly rule reports — rightly, since that is also how a translatable string
 * gets cut in half.
 */
/**
 * Each adopt button says which tag it adopts.
 *
 * Eight buttons all called *Add* is a list a screen reader cannot choose from,
 * and it is also what made the first version of this component untestable — the
 * two failures have one cause, which is usually the sign the label was wrong
 * rather than the test.
 */
/** The whole phrase, including the count, rather than a word plus a number. */
function pruneLabel(count: number): string {
  return count === 0 ? 'Nothing to prune' : `Prune ${String(count)} unused`;
}

function renameLabel(name: string): string {
  return `Rename ${name}`;
}

function renamePrompt(from: string): string {
  return `Renaming ${from}. Everything carrying it will be called the new name.`;
}

/**
 * The whole sentence per case, rather than a number dropped into a fragment —
 * the discipline the password rule states, for the same reason.
 */
function gatesPrompt(count: number): string {
  return count === 1
    ? 'One lore entry gates on the old name and will stop matching. Its book is otherwise untouched.'
    : `${String(count)} lore entries gate on the old name and will stop matching. Their books are otherwise untouched.`;
}

function adoptLabel(name: string): string {
  return `Add ${name}`;
}

function moveLabel(name: string, direction: 'up' | 'down'): string {
  return direction === 'up' ? `Move ${name} up` : `Move ${name} down`;
}

function swatchLabel(name: string): string {
  return `Colour for ${name}`;
}

function folderLabel(name: string, state: string): string {
  return `Folder mode for ${name}: ${state}`;
}

function cardsLabel(name: string): string {
  return `Show ${name} on cards`;
}
