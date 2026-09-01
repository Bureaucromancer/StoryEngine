// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { isKnownSchema, PORTABLE_SCHEMAS } from '@storyengine/shared';

import type { LibraryKind } from '../api.js';

/**
 * **One description of a kind's fields**, which is
 * [polish §1](../../../../docs/design/workplan/09-polish.md)'s whole design
 * constraint stated as a module: *one description of a kind's fields, two
 * renderings of it.*
 *
 * The description is **the schema itself**, read at runtime. That is the only
 * arrangement in which [05 §11.2d](../../../../docs/design/05-ui-surfaces.md)'s
 * promise holds — *a field added to the schema lands in the editor and in
 * §5.3's read-only fold without a second edit* — because any hand-written list
 * of a kind's fields is a second description, and a second description is the
 * thing that drifts. This repository has the receipt already: [P3 §5] records
 * two JSON viewers that shipped and disagreed.
 *
 * `PORTABLE_SCHEMAS` is TypeBox at the point of authorship and plain JSON
 * Schema at the point of use, which is why nothing here imports TypeBox: the
 * client reads the emitted shape — `properties` in declaration order, `items`,
 * `anyOf` — and never the authoring library's types. It also costs the bundle
 * nothing. The schemas and their validator are already in it, because
 * `newActor` reaches the same barrel.
 *
 * **The labels are the file's field names, and that is a decision with a cost.**
 * `matchWholeWords` becomes *Match whole words* by a rule rather than by a
 * table, so a field added to the schema arrives already labelled. What that
 * gives up is translation: these labels stay English because they are what the
 * JSON says, and a translated label table would be exactly the second
 * description this module exists to avoid. Where a kind wants a word the field
 * name does not carry, the schema is where the word goes.
 */

/**
 * As much of a JSON Schema node as anything here reads.
 *
 * Deliberately not TypeBox's `TSchema`. Every property below is one this module
 * actually branches on; a wider type would invite reading keywords the emitted
 * artefact is not obliged to carry.
 */
export interface SchemaNode {
  properties?: Record<string, unknown>;
  items?: unknown;
}

/** One field, as both renderings see it. */
export interface FieldRow {
  /** The property name, which is also its address in the file. */
  key: string;
  label: string;
  /** The declared shape, where one is declared. Absent for a record's keys. */
  schema: SchemaNode | undefined;
}

/**
 * The envelope fields the detail page states verbatim a few lines higher.
 *
 * Only these two, and the shortness of the list is the point: `provenance` is
 * *not* here, because the page shows two of its seven fields and the other five
 * — creator, version, licence, original filename, source — have no other home
 * on it. Skipping a field because it appears elsewhere is a claim that has to be
 * true of the whole field.
 */
const SHOWN_AS_STORAGE = new Set(['schema', 'id']);

/**
 * The kinds with an editor to land in, which is the same list as *the kinds
 * whose fields somebody has described for writing* — and that is why it lives
 * beside the description rather than inside a page.
 *
 * [polish §1](../../../../docs/design/workplan/09-polish.md)'s closing clause
 * asks for exactly this: the Edit gate *"should come from the same place the
 * fields do, rather than growing a second list of kinds"*. The ownership half
 * of that clause was paid at [P4.5] — one `mutable` predicate behind both Edit
 * and Delete — and this is the `actors` half it left.
 *
 * The library's create control is the next reader and is deliberately not one
 * yet: [05 §5](../../../../docs/design/05-ui-surfaces.md) makes create and edit
 * one question, since create arrives with the kind's editor and never before
 * it, but *which* panel offers it is
 * [polish §4](../../../../docs/design/workplan/09-polish.md)'s per-kind
 * property rather than this item's, and the form the control renders is the
 * actor editor's own. It asks this list when the panels split.
 *
 * The route is in the table rather than at the call site, and the table is what
 * the page navigates by — so a kind that gains an editor gains its address in
 * the same edit, and cannot be enabled here while still linking somewhere
 * else. That failure is not hypothetical at one row: the Edit link was written
 * against `actors` literally, and any widening of the condition alone would
 * have sent a lorebook to the actor editor.
 */
const EDITOR_ROUTES = {
  actors: '/library/actors/$id/edit',
} as const satisfies Partial<Record<LibraryKind, string>>;

/** Where this kind is edited, or null when it has no editor yet. */
export function editorRouteFor(kind: LibraryKind): EditorRoute | null {
  return Object.hasOwn(EDITOR_ROUTES, kind) ? EDITOR_ROUTES[kind as EditorKind] : null;
}

/** The same question where only the answer matters — the create control asks it. */
export function kindHasEditor(kind: LibraryKind): boolean {
  return editorRouteFor(kind) !== null;
}

type EditorKind = keyof typeof EDITOR_ROUTES;
type EditorRoute = (typeof EDITOR_ROUTES)[EditorKind];

/** A JSON Schema node, or undefined for anything that is not one. */
function asNode(value: unknown): SchemaNode | undefined {
  return typeof value === 'object' && value !== null ? value : undefined;
}

/**
 * The schema a self-describing object names, when this build knows it.
 *
 * Through `isKnownSchema` rather than a hand-rolled key test, because that
 * predicate is the registry's own answer to *do we know this kind* and an
 * unknown one is not an error ([10 §2]) — a package may legitimately carry a
 * kind a newer build wrote. Undefined here means the page falls back to no
 * field list rather than to a broken one.
 */
export function schemaFor(schemaId: string): SchemaNode | undefined {
  return isKnownSchema(schemaId) ? asNode(PORTABLE_SCHEMAS[schemaId]) : undefined;
}

/**
 * `matchWholeWords` → *Match whole words*.
 *
 * Splits on the lower-to-upper boundary and on the letter-to-digit one, then
 * lowercases everything but the opening word. Nothing here is a special case:
 * an acronym would come out wrong, and the answer to that is a `title` on the
 * field rather than a list of exceptions here, because a list of exceptions is
 * a second description again.
 */
export function labelFor(key: string): string {
  const words = key
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Za-z])(\d)/g, '$1 $2')
    .toLowerCase()
    .trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/**
 * The fields of one value, in the order they are declared.
 *
 * **Two sources, and which one applies is a property of the schema rather than
 * a preference.** A schema that declares `properties` supplies the whole list,
 * in its own order, including fields the value has not got — an absent optional
 * field is a field, and rendering it as unset is what gets it written
 * ([16 §4.1](../../../../docs/design/16-lorebooks-as-a-format.md) makes that
 * argument about `description` specifically). A schema that declares none is a
 * record — `metadata`, `modeData`, `compat` — whose keys *are* its content, so
 * the value supplies them, in the file's own order.
 *
 * **What is deliberately not here: keys the schema does not declare.**
 * [polish §2](../../../../docs/design/workplan/09-polish.md) already assigns
 * those to *As stored*, which it calls "the only view that shows fields the
 * client does not know how to render yet". Rendering them here as unlabelled
 * rows would take that job without doing it as well.
 */
export function fieldsOf(schema: SchemaNode | undefined, value: unknown): FieldRow[] {
  const declared = schema?.properties;
  const keys =
    declared === undefined
      ? typeof value === 'object' && value !== null && !Array.isArray(value)
        ? Object.keys(value)
        : []
      : Object.keys(declared);

  return keys.map((key) => ({
    key,
    label: labelFor(key),
    schema: declared === undefined ? undefined : asNode(declared[key]),
  }));
}

/**
 * The same list for a whole object, minus what the page has already said.
 *
 * A kind this build does not know falls through to the record case above and is
 * read by its own keys, which is deliberate: [10 §2] makes an unknown `schema`
 * a normal thing to meet rather than an error, and with no declaration to be
 * the authority on what belongs, the file is the only description there is.
 */
export function objectFieldsOf(schemaId: string, value: unknown): FieldRow[] {
  return fieldsOf(schemaFor(schemaId), value).filter((row) => !SHOWN_AS_STORAGE.has(row.key));
}

/** The element schema of an array field, where one is declared. */
export function itemSchemaOf(schema: SchemaNode | undefined): SchemaNode | undefined {
  return asNode(schema?.items);
}
