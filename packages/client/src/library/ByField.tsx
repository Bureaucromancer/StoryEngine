// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import type { JSX } from 'react';

import { fieldLabel } from '../ui/classes.js';
import { Panel } from '../ui/Panel.js';
import { Fine, SubsectionTitle } from '../ui/Text.js';
import {
  fieldsOf,
  groupsOf,
  itemSchemaOf,
  objectFieldsOf,
  type FieldGroup,
  type FieldRow,
  type SchemaNode,
} from './fields.js';

/**
 * The object, field by field, read-only —
 * [polish §1](../../../../docs/design/workplan/09-polish.md).
 *
 * **What it removes is a gesture, not a rendering.** To read an actor's
 * greeting the answer was *open the editor*, which is wrong in three ways that
 * item names: it is a write surface, so it invites accidental edits; it is
 * kind-specific, so only actors were readable at all; and it does not exist for
 * bundled or shadowed objects, which are precisely the ones a person most needs
 * to read to understand what they inherited. None of those are fixed by a
 * prettier JSON dump, which is why *As stored* stays and this is a different
 * thing rather than a replacement for it.
 *
 * **Label above value, because that is the editor's layout.** *Recognisably the
 * same view as the editor's, not a second layout that drifts* is the item's
 * whole constraint, and `Field` puts its label above its control. So the two
 * renderings share the label class ([classes.ts](../ui/classes.ts)'s
 * `fieldLabel`, moved there for this) and the same vertical rhythm, and the
 * only difference is that one of them has an input in it.
 *
 * **Structure comes from the schema; presentation comes from the value.** The
 * field list, its order and its labels are [fields.ts](./fields.ts)'s, derived
 * from the schema so that a new field arrives without a second edit. How a
 * value is drawn is decided by looking at the value, because nothing in the
 * schema distinguishes a name from a page of prose — and a `format` keyword
 * invented to say so would be schema written to serve a rendering, which
 * [16 §4](../../../../docs/design/16-lorebooks-as-a-format.md) refuses by name.
 *
 * **Empty is shown rather than omitted**, which is the branch
 * [polish §1](../../../../docs/design/workplan/09-polish.md) leaves open
 * ("either omitted or shown as explicitly empty"). Shown, because a field
 * nobody can see is a field nobody fills, and
 * [16 §4.1](../../../../docs/design/16-lorebooks-as-a-format.md) makes exactly
 * that argument about `description`: *a field nobody fills is a field that does
 * not work when its real consumer arrives.* Three words rather than one, since
 * an absent value, a blank string and an empty list are three different facts
 * and the schemas draw meaning from the difference — `pronouns: null` means
 * unknown, and "" would not.
 */

/** How deep a nested value is drawn before it becomes bytes again. */
const MAX_DEPTH = 3;

/** Keys an object may carry that name it to a reader. In preference order. */
const NAMING_KEYS = ['title', 'name', 'label'] as const;

export function ByField({ schemaId, value }: { schemaId: string; value: unknown }): JSX.Element {
  return <FieldGroups groups={groupsOf(objectFieldsOf(schemaId, value))} value={value} />;
}

/**
 * The same rendering over a value whose schema is known rather than named — the
 * book page's *as configured* fold ([05 §5.3](../../../../docs/design/05-ui-surfaces.md)),
 * which renders one entry.
 *
 * `omit` is what makes it a fold rather than a repetition: §5.3 renders an
 * entry's name, tag, keys, description and content as the readable unit above
 * it, and asks this for **every remaining field**. The set belongs to the
 * caller because it is a fact about that surface rather than about the schema.
 */
export function ByFields(props: {
  schema: SchemaNode | undefined;
  value: unknown;
  omit?: ReadonlySet<string>;
}): JSX.Element {
  const { omit } = props;
  /**
   * **Grouped first, then filtered, and the order is a fix rather than a
   * preference.** A banner is an annotation on the field that opens its group,
   * so filtering first can remove the field the group's name was hanging on —
   * and the group then loses its heading and its remaining fields fall into the
   * one above. §5.3's fold omits `keys`, which is exactly the field `Matching`
   * hangs on, so the failure was not hypothetical: it was this surface's first
   * caller.
   */
  const groups = groupsOf(fieldsOf(props.schema, props.value))
    .map((group) => ({
      ...group,
      fields: group.fields.filter((row) => omit?.has(row.key) !== true),
    }))
    .filter((group) => group.fields.length > 0);
  return <FieldGroups groups={groups} value={props.value} />;
}

/**
 * The groups a schema declares, as sections.
 *
 * **One untitled group renders as no groups at all**, which is every kind but a
 * lore entry, and that is the property worth having: this is not a lorebook
 * feature the other kinds opt into. A schema written under banners gets
 * headings; a schema written without them looks exactly as it did before
 * banners existed.
 */
function FieldGroups(props: { groups: FieldGroup[]; value: unknown }): JSX.Element | null {
  const [only] = props.groups;
  if (only === undefined) return null;
  if (props.groups.length === 1 && only.title === null) {
    return <FieldList rows={only.fields} value={props.value} depth={0} />;
  }

  return (
    <div className="flex flex-col gap-6">
      {props.groups.map((group, index) => (
        <section key={group.title ?? `head:${String(index)}`}>
          {group.title === null ? null : (
            <SubsectionTitle as="h3" className="mb-1">
              {group.title}
            </SubsectionTitle>
          )}
          {group.note === undefined ? null : <Fine className="mb-2">{group.note}</Fine>}
          <FieldList rows={group.fields} value={props.value} depth={0} />
        </section>
      ))}
    </div>
  );
}

function FieldList(props: { rows: FieldRow[]; value: unknown; depth: number }): JSX.Element | null {
  if (props.rows.length === 0) return null;
  const owner = props.value as Record<string, unknown>;

  return (
    <dl className="flex flex-col gap-4">
      {props.rows.map((row) => (
        <div key={row.key}>
          <dt className={fieldLabel}>{row.label}</dt>
          <dd className="mt-1 text-sm text-ink">
            <Value value={owner[row.key]} schema={row.schema} depth={props.depth} />
          </dd>
        </div>
      ))}
    </dl>
  );
}

/**
 * One value, drawn as what it is.
 *
 * The order of the branches is the order of how much is known: the three
 * absences first, because they are the ones a type check would otherwise dress
 * up as a value; then the primitives; then the two shapes; then the fallback,
 * which exists because this component must never be the reason a page fails to
 * render an object somebody hand-edited.
 */
function Value(props: {
  value: unknown;
  schema: SchemaNode | undefined;
  depth: number;
}): JSX.Element {
  const { value } = props;

  // Absent and null are one row, because they are one fact to a reader: there
  // is nothing here. Which of the two is on disk is *As stored*'s to answer.
  if (value === undefined || value === null) return <Absent>Not set</Absent>;
  if (typeof value === 'string') {
    if (value === '') return <Absent>Empty</Absent>;
    // Every string wraps and preserves its own newlines, rather than only the
    // ones a heuristic calls long. A short name is unaffected by the rule and a
    // paragraph stops being a JSON string with `\n` in it, which is the defect.
    return <p className="whitespace-pre-wrap">{value}</p>;
  }
  if (typeof value === 'number') return <>{String(value)}</>;
  if (typeof value === 'boolean') return value ? <>Yes</> : <>No</>;

  if (Array.isArray(value)) {
    if (value.length === 0) return <Absent>None</Absent>;
    return <ItemList items={value} schema={props.schema} depth={props.depth} />;
  }

  if (typeof value === 'object') {
    const rows = fieldsOf(props.schema, value);
    if (rows.length === 0) return <Absent>None</Absent>;
    if (props.depth >= MAX_DEPTH) return <AsBytes value={value} />;
    return (
      <Panel variant="card">
        <FieldList rows={rows} value={value} depth={props.depth + 1} />
      </Panel>
    );
  }

  return <AsBytes value={value} />;
}

/**
 * A list, which is two different renderings sharing one branch.
 *
 * A list of strings is a list; a list of objects is a stack of small records,
 * each with a heading when it carries something that names it. Reading the
 * heading off the item rather than off the schema is deliberate — the schemas
 * spell the naming field `title` on a section, `name` on a media role and
 * `label` on an opening, and a rule that reads whichever is there needs no
 * table of which kind uses which.
 */
function ItemList(props: {
  items: unknown[];
  schema: SchemaNode | undefined;
  depth: number;
}): JSX.Element {
  const itemSchema = itemSchemaOf(props.schema);

  if (props.items.every((item) => typeof item === 'string')) {
    return (
      <ul className="list-disc ps-5">
        {props.items.map((item, index) => (
          <li key={`${String(index)}:${item}`} className="whitespace-pre-wrap">
            {item}
          </li>
        ))}
      </ul>
    );
  }

  if (props.depth >= MAX_DEPTH) return <AsBytes value={props.items} />;

  return (
    <div className="flex flex-col gap-3">
      {props.items.map((item, index) => (
        <Panel key={indexKey(item, index)} variant="card">
          <ItemHeading item={item} />
          {typeof item === 'object' && item !== null && !Array.isArray(item) ? (
            <FieldList rows={fieldsOf(itemSchema, item)} value={item} depth={props.depth + 1} />
          ) : (
            <Value value={item} schema={itemSchema} depth={props.depth + 1} />
          )}
        </Panel>
      ))}
    </div>
  );
}

/** The item's own name, where it has one worth showing above its fields. */
function ItemHeading({ item }: { item: unknown }): JSX.Element | null {
  if (typeof item !== 'object' || item === null) return null;
  const fields = item as Record<string, unknown>;
  for (const key of NAMING_KEYS) {
    const candidate = fields[key];
    if (typeof candidate === 'string' && candidate.trim() !== '') {
      return <p className="mb-2 font-medium text-ink">{candidate}</p>;
    }
  }
  return null;
}

/**
 * A stable-enough key for a list item.
 *
 * The index alone would reorder badly and an id alone is not always there, so
 * this prefers the item's own id and falls back to the position — which is what
 * the array is, and what every other reading of it uses.
 */
function indexKey(item: unknown, index: number): string {
  if (typeof item === 'object' && item !== null) {
    const id: unknown = (item as { id?: unknown }).id;
    if (typeof id === 'string' && id !== '') return id;
  }
  return String(index);
}

/** Not written, blank, or none of — in the faintest step that is still text. */
function Absent({ children }: { children: string }): JSX.Element {
  return <span className="text-ink-faint">{children}</span>;
}

/**
 * The last resort, and it is a real one rather than an apology.
 *
 * A value too deeply nested to draw, or of a shape this build has no rendering
 * for, is still *shown* — as the bytes it is. The alternative is a blank where
 * something exists, which is the one failure a reading surface may not have.
 */
function AsBytes({ value }: { value: unknown }): JSX.Element {
  return <code className="break-all text-xs">{JSON.stringify(value)}</code>;
}
