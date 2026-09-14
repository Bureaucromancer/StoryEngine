// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import {
  bannerOf,
  isKnownSchema,
  LOREBOOK_SCHEMA,
  newActor,
  newLorebook,
  PORTABLE_SCHEMAS,
} from '@storyengine/shared';

import type { LibraryKind } from '../api.js';

/**
 * **One description of a kind's fields**, which is
 * [polish §1](../../../../docs/design/workplan/06-polish.md)'s whole design
 * constraint stated as a module: *one description of a kind's fields, two
 * renderings of it.*
 *
 * The description is **the schema itself**, read at runtime. That is the only
 * arrangement in which [10 §11.2d](../../../../docs/design/10-ui-surfaces.md)'s
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
  /**
   * The numeric bounds, read by {@link boundsOf} — added at [P7.14], when the
   * first editor over a bounded number needed them.
   *
   * Two more keywords the emitted artefact is *not obliged* to carry, which is
   * why `boundsOf` returns what it finds rather than a pair: an unbounded field
   * and a field whose bounds this build cannot see must render the same way, or
   * the absence becomes a claim.
   */
  minimum?: number;
  maximum?: number;
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
 * [polish §1](../../../../docs/design/workplan/06-polish.md)'s closing clause
 * asks for exactly this: the Edit gate *"should come from the same place the
 * fields do, rather than growing a second list of kinds"*. The ownership half
 * of that clause was paid at [P4.5] — one `mutable` predicate behind both Edit
 * and Delete — and this is the `actors` half it left.
 *
 * ~~The library's create control is the next reader and is deliberately not one
 * yet.~~ **It is one now, at P5.1**, and it arrived the way
 * [10 §5](../../../../docs/design/10-ui-surfaces.md) said it would: create and
 * edit are one question, so a kind becomes creatable in the same edit that
 * gives it an editor and never before. What that clause did *not* anticipate is
 * that it would arrive before the panels split — P5.0 built the Lorebooks panel
 * as the first of [polish §4]'s six, and the create control is still the merged
 * page's, so the reader turned up a stage early and this table answered anyway.
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
  lorebooks: '/library/lorebooks/$id/edit',
} as const satisfies Partial<Record<LibraryKind, string>>;

/**
 * What a new one of each of those kinds *is*, and the word for it.
 *
 * **Typed `Record<EditorKind, …>` on purpose**, so the two tables cannot drift:
 * a kind added above without a row here fails to typecheck, which is
 * [10 §5](../../../../docs/design/10-ui-surfaces.md)'s rule — *create arrives
 * with the kind's editor and never before it* — enforced by the compiler rather
 * than remembered. It is also the reason this is a second table and not a
 * second *list*: the key set is the one above.
 *
 * The factories are the shared ones, so an object made in the browser is the
 * same object the API's create path makes and the same one an import produces.
 * A local literal would be a second definition of *what a new lorebook is*, and
 * the one that drifted — which is the argument `newActor`'s call site here has
 * made since P1.5.
 */
const NEW_OBJECTS: Record<
  EditorKind,
  { noun: string; make: (name: string) => Record<string, unknown> }
> = {
  actors: { noun: 'actor', make: (name) => newActor(name) },
  lorebooks: { noun: 'lorebook', make: (name) => newLorebook(name) },
};

/**
 * Where a new one of each kind is *written*, before it exists —
 * [polish §10](../../../../docs/design/workplan/06-polish.md).
 *
 * A second table rather than a suffix on `EDITOR_ROUTES`, because these two
 * addresses do different things: one opens a file, and one opens a form over
 * nothing. Typed against the same key set, so a kind cannot acquire an editor
 * without acquiring a way in.
 */
const NEW_ROUTES = {
  actors: '/library/actors/new',
  lorebooks: '/library/lorebooks/new',
} as const satisfies Record<EditorKind, string>;

/**
 * ***One kind is now created from outside these tables, and saying so here is
 * the point*** — [P7.4], 2026-09-12.
 *
 * `SessionsPage`'s *Save as a setup* writes a `setups/` object, and `setups` is
 * in neither table above. That is not the rule being broken: [10 §5]'s *create
 * arrives with the kind's editor and never before it* is about **this** create
 * control — the library's own New button, which opens a form over nothing and
 * would strand somebody on a kind with no editor to land in.
 *
 * A Setup is *how to start playing*, and the session form collects exactly that
 * control for control, so saving one is naming a configuration that already
 * exists rather than opening an empty form. **`setups` stays out of these tables
 * until it has an editor**, which is what the library's New button would need
 * and what a hand-written Setup form is the wrong way to get ([P7.4]'s cell
 * names *"every editor and settings pane is hand-written JSX"* as the
 * complaint). Until then a saved Setup is readable on the generic shelf and in
 * §5.3's read-only fold, which is what every kind without an editor gets.
 */

/**
 * The fields a person has to fill in before this kind can be saved —
 * [10 §11.1a](../../../../docs/design/10-ui-surfaces.md).
 *
 * **A curated set rather than a reading of the schema**, and that is the part
 * worth writing down, because the schema is right there and the rest of this
 * module derives from it at runtime. JSON Schema's `required` means *the
 * property is present*, not *somebody filled it in*: an actor's only optional
 * property is `writingSamples`, so marking from it would mark nearly every
 * field, which tells a reader no more than marking none would. Nor is there a
 * floor underneath — no portable schema constrains a string's length except an
 * id, so `name: ""` validates and stores. This is a client convention with
 * nothing beneath it, which is §11.1a's whole argument for keeping it small.
 *
 * Typed against `EditorKind` for the reason the two tables above are: a kind
 * that grows an editor and no row here fails to typecheck, rather than quietly
 * requiring nothing of anybody.
 */
const REQUIRED_FIELDS: Record<EditorKind, readonly string[]> = {
  actors: ['name'],
  lorebooks: ['name'],
};

/** Where a new one is written, or null when this kind has no editor yet. */
export function newRouteFor(kind: LibraryKind): NewRoute | null {
  return Object.hasOwn(NEW_ROUTES, kind) ? NEW_ROUTES[kind as EditorKind] : null;
}

/**
 * The blank object a new one starts as — the shared factory's, never a literal.
 *
 * Total rather than nullable, because the caller is an editor that knows which
 * kind it is: `newRouteFor` above is the nullable question, asked by the
 * library, and by the time one of these routes has matched the answer is no
 * longer in doubt.
 *
 * The name is empty on purpose. It is the one field the editor will refuse to
 * save without ([10 §11.1a]), and a placeholder here would be a name somebody
 * did not choose — which, because the folder is slugged from it once and then
 * frozen ([03 §5.2]), would be a name they could never take back.
 */
export function blankFor(kind: EditorKind): Record<string, unknown> {
  return NEW_OBJECTS[kind].make('');
}

/** Where this kind is edited, or null when it has no editor yet. */
export function editorRouteFor(kind: LibraryKind): EditorRoute | null {
  return Object.hasOwn(EDITOR_ROUTES, kind) ? EDITOR_ROUTES[kind as EditorKind] : null;
}

/** How to make a new one of this kind, or null when nothing here can. */
export function newObjectFor(
  kind: LibraryKind,
): { noun: string; make: (name: string) => Record<string, unknown> } | null {
  return Object.hasOwn(NEW_OBJECTS, kind) ? NEW_OBJECTS[kind as EditorKind] : null;
}

/**
 * The fields this kind refuses to be saved without, in the order a refusal
 * should visit them. Empty for a kind with no editor, which is the honest
 * answer rather than a throw: nothing can require a field nothing can edit.
 */
export function requiredFieldsFor(kind: LibraryKind): readonly string[] {
  return Object.hasOwn(REQUIRED_FIELDS, kind) ? REQUIRED_FIELDS[kind as EditorKind] : [];
}

/** Whether this one field is among them — what a field asks to mark itself. */
export function isRequiredField(kind: LibraryKind, key: string): boolean {
  return requiredFieldsFor(kind).includes(key);
}

/**
 * Which of them are blank, given what the editor currently holds.
 *
 * The editor supplies the values because it is the only thing that knows how
 * its form maps onto the object's fields — but *which* fields are asked about
 * comes from the table, so a second required field is one row rather than one
 * row and a forgotten condition.
 */
export function missingRequired(
  kind: LibraryKind,
  values: Readonly<Record<string, string>>,
): readonly string[] {
  return requiredFieldsFor(kind).filter((key) => (values[key] ?? '').trim() === '');
}

/**
 * The sentence a refused save says, naming what still has to be answered.
 *
 * Labels come from the caller because they are the caller's: the editor already
 * spells "Book name" over a field whose property is `name`, and a refusal that
 * said *name* would be naming the JSON at somebody reading a form.
 */
export function refusalFor(
  missing: readonly string[],
  labels: Readonly<Record<string, string>>,
): string {
  const named = missing.map((key) => labels[key] ?? key);
  if (named.length === 1) return `${named[0] ?? ''} cannot be empty.`;
  return `These cannot be empty: ${named.join(', ')}.`;
}

/** The same question where only the answer matters — the create control asks it. */
export function kindHasEditor(kind: LibraryKind): boolean {
  return editorRouteFor(kind) !== null;
}

export type EditorKind = keyof typeof EDITOR_ROUTES;
export type NewRoute = (typeof NEW_ROUTES)[EditorKind];
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
 * unknown one is not an error ([04 §2]) — a world may legitimately carry a
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
 *
 * **And on the underscore, added at [P7.14]** when the first caller passed an
 * enum *value* rather than a key: `before_char` → *Before char*. No key in any
 * of the 215 the portable schemas declare carries one — they are camelCase
 * throughout — so this widens what the function accepts without changing what it
 * answers for anything that already called it. *A value is a machine name like a
 * key is*, which is the whole reason the same derivation serves both and a table
 * of nicer prose does not get written.
 */
export function labelFor(key: string): string {
  const words = key
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Za-z])(\d)/g, '$1 $2')
    .replace(/_+/g, ' ')
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
 * ([11 §4.1](../../../../docs/design/11-lorebooks-as-a-format.md) makes that
 * argument about `description` specifically). A schema that declares none is a
 * record — `metadata`, `modeData`, `compat` — whose keys *are* its content, so
 * the value supplies them, in the file's own order.
 *
 * **What is deliberately not here: keys the schema does not declare.**
 * [polish §2](../../../../docs/design/workplan/06-polish.md) already assigns
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
 * read by its own keys, which is deliberate: [04 §2] makes an unknown `schema`
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

/** One of the schema's own field groups — its comment banner, at runtime. */
export interface FieldGroup {
  /** The banner's words, or null for the fields that precede the first one. */
  title: string | null;
  /** The banner's editorial subtitle, where its author wrote one. */
  note: string | undefined;
  fields: FieldRow[];
}

/**
 * The rows cut into the groups their schema declares
 * ([banners.ts](../../../shared/src/schema/banners.ts)).
 *
 * **A banner opens a group and nothing closes one**, which is what the comment
 * banners in the schema file did and is why a field added under one needs no
 * edit here. Fields before the first banner are the head group and carry no
 * title — `LoreEntry`'s identity fields, which
 * [10 §11.2d](../../../../docs/design/10-ui-surfaces.md) leaves deliberately
 * un-bannered.
 *
 * A schema with no banners comes back as one untitled group, so every kind but
 * `LoreEntry` renders exactly as it did before groups existed. That is the
 * property worth having: this is not a lorebook feature that other kinds opt
 * into, it is the general shape, and lorebooks are the only schema so far
 * written in groups.
 */
export function groupsOf(rows: FieldRow[]): FieldGroup[] {
  const groups: FieldGroup[] = [];

  for (const row of rows) {
    const opens = bannerOf(row.schema);
    if (opens !== null || groups.length === 0) {
      groups.push({
        title: opens === null ? null : opens.title,
        note: opens?.note,
        fields: [],
      });
    }
    groups[groups.length - 1]?.fields.push(row);
  }

  return groups;
}

/**
 * What the schema says a number may be — [10 §15.3]'s precedent, at [P7.14]:
 * *"its numeric inputs carry the server's own bounds, and it says so when a save
 * is refused."*
 *
 * **Spread into the props rather than returned as a pair**, because
 * `exactOptionalPropertyTypes` makes `min: undefined` and *no* `min` different
 * things, and only the second renders an unbounded input.
 */
export function boundsOf(schema: SchemaNode | undefined): {
  min?: number;
  max?: number;
} {
  return {
    ...(typeof schema?.minimum === 'number' ? { min: schema.minimum } : {}),
    ...(typeof schema?.maximum === 'number' ? { max: schema.maximum } : {}),
  };
}

/**
 * `Lorebook.entries.items` — the entry schema, which three surfaces now want.
 *
 * Here rather than beside any one of them because it was written out in
 * [LorebookView.tsx](./LorebookView.tsx) first and the editor is the second
 * caller: the walk from the book's schema to its entry's is four steps of
 * `properties` and `items` chasing, and two copies of it is two places to
 * discover that the emitted artefact spells something differently.
 */
export function loreEntrySchema(): SchemaNode | undefined {
  const declared = schemaFor(LOREBOOK_SCHEMA)?.properties?.['entries'];
  return itemSchemaOf(asNode(declared));
}
