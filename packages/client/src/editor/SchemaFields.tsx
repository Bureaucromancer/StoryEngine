// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import type { JSX } from 'react';

import {
  boundsOf,
  groupsOf,
  itemSchemaOf,
  objectFieldsOf,
  type FieldGroup,
  type FieldRow,
  type SchemaNode,
} from '../library/fields.js';
import { CheckboxField, Field, NumberField } from '../ui/Field.js';
import { LinesField } from './ListField.js';
import { Fine, SubsectionTitle } from '../ui/Text.js';
import { disclosure } from '../ui/classes.js';

/**
 * The object, field by field, **writable** — [P7B.1], and the write-side twin
 * of [ByField](../library/ByField.tsx).
 *
 * [10 §11.2d](../../../../docs/design/10-ui-surfaces.md) settled this shape for
 * the lore-entry editor and the sentence generalises: *the structure already
 * exists, in the schema file, and the only editorial decision left is which
 * groups start open.* The machinery for reading it has been general since
 * [banners.ts](../../../shared/src/schema/banners.ts) promoted the comment
 * banners to a real annotation — `fields.ts`'s own docstring says so: *"this is
 * not a lorebook feature that other kinds opt into, it is the general shape."*
 * Four kinds now need it and nothing had ever used it for writing.
 *
 * **`ByField`'s division holds unchanged**: *structure comes from the schema;
 * presentation comes from the value.* Nothing in a schema distinguishes a name
 * from a page of prose, and a `format` keyword invented to say so would be
 * schema written to serve a rendering, which
 * [11 §4](../../../../docs/design/11-lorebooks-as-a-format.md) refuses by name.
 * So the *control* is chosen by declared type where there is one and by the
 * value where there is not, and how tall a textarea is, is decided by what is
 * in it.
 *
 * ---
 *
 * ***The invariant, which is the reason a disclosure is allowed here at all.***
 *
 * > **A closed section must name what is inside it that is not at its default.**
 *
 * [10 §2.1](../../../../docs/design/10-ui-surfaces.md) forbids hidden fields, and
 * a collapse that conceals a non-default value *is* one. A collapse that
 * advertises its non-defaults is a summary, and §11.2d says the difference is
 * exactly the difference between an entry whose surprising behaviour is
 * discoverable and one whose is not. It is implemented here rather than left to
 * each page, because six pages is six chances to leave it out and nothing would
 * fail if one did.
 *
 * **What it cannot do, said plainly.** A schema's `default` keyword is what
 * *default* means here; a field the emitted artefact declares no default for is
 * compared against emptiness instead — absent, blank, or an empty list. That is
 * weaker than the invariant deserves and is visible rather than silent: a
 * section whose fields have no declared defaults says *(set)* rather than
 * nothing, so the reader is told something is in there even when the summary
 * cannot say what.
 */

/** What control a field gets. Chosen by declared type, then by value. */
type Control = 'text' | 'number' | 'boolean' | 'lines' | 'opaque';

interface Node extends SchemaNode {
  type?: string;
  default?: unknown;
}

function controlFor(schema: SchemaNode | undefined, value: unknown): Control {
  const declared = (schema as Node | undefined)?.type;
  if (declared === 'string') return 'text';
  if (declared === 'number' || declared === 'integer') return 'number';
  if (declared === 'boolean') return 'boolean';
  // An array of strings is a textarea, one per line — the shape the actor
  // editor's aliases and traits already use. Anything else in an array is a
  // structure, and a structure is its own component's business.
  //
  // ***Decided by what the list holds, not by what it holds now*** (2026-09-27).
  // This asked the value, and `[].every(…)` is true of anything: every empty
  // list was a list of strings, so a new treatment's Cast and Lore, a setup's
  // Goals and a preset's Variables got a box that wrote strings where objects
  // belong — refused by the server, with every other edit blocked until the
  // box was emptied again. The item schema says; only an undeclared one falls
  // back to the value, and then only to a value that has something in it.
  if (declared === 'array') {
    const item = (itemSchemaOf(schema) as Node | undefined)?.type;
    if (item === 'string') return 'lines';
    if (item !== undefined) return 'opaque';
    return Array.isArray(value) && value.length > 0 && value.every((one) => typeof one === 'string')
      ? 'lines'
      : 'opaque';
  }
  if (declared !== undefined) return 'opaque';

  // No declared type — a union, or a field the emitted artefact does not
  // describe. Read the value, which is what `ByField` does for the same reason.
  if (typeof value === 'string') return 'text';
  if (typeof value === 'number') return 'number';
  if (typeof value === 'boolean') return 'boolean';
  if (Array.isArray(value) && value.every((one) => typeof one === 'string')) return 'lines';
  return 'opaque';
}

/** Whether this field is at whatever counts as its default — see the header. */
function atDefault(schema: SchemaNode | undefined, value: unknown): boolean {
  const declared = (schema as Node | undefined)?.default;
  if (declared !== undefined) return JSON.stringify(value) === JSON.stringify(declared);
  if (value === undefined || value === null) return true;
  if (value === '') return true;
  if (Array.isArray(value)) return value.length === 0;
  if (typeof value === 'object') return Object.keys(value).length === 0;
  return false;
}

/**
 * What a closed section says about itself.
 *
 * Names the fields rather than counting them where it can: *Timing (sticky,
 * order)* tells a reader what to expect and *(2 set)* does not. It falls back to
 * the count past three, because a summary longer than the heading it sits under
 * is a summary nobody reads.
 */
function summaryOf(fields: FieldRow[], value: Record<string, unknown>): string | null {
  const set = fields.filter((row) => !atDefault(row.schema, value[row.key]));
  if (set.length === 0) return null;
  if (set.length <= 3) return set.map((row) => row.label.toLowerCase()).join(', ');
  return `${String(set.length)} set`;
}

/**
 * The value of a field with nothing in it yet, as a list — **one array for
 * every render**, because `LinesField` re-seeds its text whenever the array it
 * is given is a different one, and a fresh `[]` each time would re-seed it on
 * every render, forever.
 */
const NO_LINES: readonly string[] = [];

export function SchemaFields(props: {
  schemaId: string;
  value: Record<string, unknown>;
  onChange: (key: string, next: unknown) => void;
  /**
   * Fields this page renders itself — a preset's `blocks`, a lorebook's
   * `entries`. **Named by the page rather than guessed here**: a generic
   * renderer that decided which fields were "too complex" would be deciding a
   * kind's layout from the outside.
   */
  handled?: readonly string[];
  /** Fields to render read-only, with the reason, rather than omit. */
  readOnly?: Readonly<Record<string, string>>;
}): JSX.Element {
  const handled = new Set(props.handled ?? []);
  const rows = objectFieldsOf(props.schemaId, props.value).filter((row) => !handled.has(row.key));
  const groups = groupsOf(rows);

  return (
    <>
      {groups.map((group, index) => (
        <FieldGroupView
          key={group.title ?? `head-${String(index)}`}
          group={group}
          value={props.value}
          onChange={props.onChange}
          readOnly={props.readOnly ?? {}}
          // The head group — the fields before the first banner — is the
          // identity of the thing and is never behind a disclosure. §11.2d
          // leaves it deliberately un-bannered for exactly this.
          head={group.title === null}
        />
      ))}
    </>
  );
}

function FieldGroupView(props: {
  group: FieldGroup;
  value: Record<string, unknown>;
  onChange: (key: string, next: unknown) => void;
  readOnly: Readonly<Record<string, string>>;
  head: boolean;
}): JSX.Element {
  const body = (
    <div className="flex flex-col gap-4">
      {props.group.fields.map((row) => (
        <OneField
          key={row.key}
          row={row}
          value={props.value[row.key]}
          onChange={(next) => {
            props.onChange(row.key, next);
          }}
          {...(props.readOnly[row.key] === undefined
            ? {}
            : { readOnlyNote: props.readOnly[row.key] })}
        />
      ))}
    </div>
  );

  if (props.head) return body;

  const summary = summaryOf(props.group.fields, props.value);
  return (
    <details className="rounded-control border border-line p-3">
      <summary className={`${disclosure.titled} text-sm font-medium`}>
        {props.group.title}
        {summary === null ? null : <span className="ms-2 text-ink-subtle">({summary})</span>}
      </summary>
      {props.group.note === undefined ? null : <Fine className="mt-1">{props.group.note}</Fine>}
      <div className="mt-3">{body}</div>
    </details>
  );
}

/**
 * ***The path is the key, and that is [10 §11.2]'s own spelling*** — [P11.2].
 *
 * The provenance map is *"keyed by dotted field path (`treatment.themes`)"*, and
 * a schema-derived field's path is its property name: this renderer walks one
 * object's own properties, so there is no prefix to compose. A nested renderer
 * would have one, and the day one exists the argument goes here rather than at
 * thirty call sites.
 */
function OneField(props: {
  row: FieldRow;
  value: unknown;
  onChange: (next: unknown) => void;
  readOnlyNote?: string;
}): JSX.Element {
  const { row, value } = props;
  const control = controlFor(row.schema, value);
  const note = props.readOnlyNote;

  if (control === 'number') {
    return (
      <NumberField
        label={row.label}
        value={typeof value === 'number' ? String(value) : ''}
        onChange={(next) => {
          // Blank clears the field rather than writing zero: `''` is a state a
          // person passes through, and a control that read it as 0 would put a
          // number in a field somebody was in the middle of emptying.
          props.onChange(next.trim() === '' ? undefined : Number(next));
        }}
        {...boundsOf(row.schema)}
        {...(note === undefined ? {} : { readOnlyNote: note })}
      />
    );
  }

  if (control === 'boolean') {
    return (
      <CheckboxField
        label={row.label}
        checked={value === true}
        onChange={props.onChange}
        {...(note === undefined ? {} : { disabled: true, hint: note })}
      />
    );
  }

  if (control === 'lines') {
    // The entry editor's buffered field, so a space or an Enter at the end of
    // a line survives being typed (2026-09-27) — this split and re-joined the
    // box on every keystroke, and *dark fantasy* could not be typed as a tag.
    return (
      <LinesField
        label={row.label}
        path={row.key}
        value={Array.isArray(value) ? (value as string[]) : NO_LINES}
        onChange={props.onChange}
        rows={3}
        hint="One per line."
        {...(note === undefined ? {} : { readOnlyNote: note })}
      />
    );
  }

  if (control === 'text') {
    const text = typeof value === 'string' ? value : '';
    return (
      <Field
        label={row.label}
        path={row.key}
        value={text}
        onChange={props.onChange}
        // Presentation from the value: a field holding a paragraph gets room
        // for one, and the same field holding a name does not. ***The height,
        // never the element*** (2026-09-27): this swapped an `<input>` for a
        // `<textarea>` at the 81st character, and a new element has no focus,
        // so a blurb stopped taking keystrokes mid-sentence.
        multiline
        rows={text.includes('\n') || text.length > 80 ? 4 : 1}
        {...(note === undefined ? {} : { readOnlyNote: note })}
      />
    );
  }

  /**
   * A structure this renderer will not invent a form for.
   *
   * **Shown rather than omitted**, which is [10 §2.1]'s rule and
   * [polish §1](../../../../docs/design/workplan/06-polish.md)'s: a field nobody
   * can see is a field nobody fills, and a field silently dropped from an editor
   * is one a user cannot discover is there. It reads, it does not write, and it
   * says which of those it is doing.
   */
  return (
    <div>
      <SubsectionTitle as="h3" className="text-sm">
        {row.label}
      </SubsectionTitle>
      <pre className="mt-1 overflow-x-auto rounded-control bg-surface-muted p-2 text-xs text-ink-subtle">
        {JSON.stringify(value ?? null, null, 2)}
      </pre>
      <Fine>Shown as stored. This editor does not write this field yet.</Fine>
    </div>
  );
}
