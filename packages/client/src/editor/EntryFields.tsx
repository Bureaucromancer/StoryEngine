// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { useState, type JSX } from 'react';

import type { LoreEntry } from '@storyengine/shared';

import { ReadOnlyField } from '../library/ByField.js';
import { groupSummary } from '../library/entry-defaults.js';
import {
  fieldsOf,
  groupsOf,
  labelFor,
  loreEntrySchema,
  type FieldGroup,
  type FieldRow,
} from '../library/fields.js';
import { CheckboxField, Field, SelectField } from '../ui/Field.js';
import { Fine, SubsectionTitle } from '../ui/Text.js';
import { joinLines, splitLines } from './form.js';

/**
 * One entry, as the schema's own shape —
 * [10 §11.2d](../../../../docs/design/10-ui-surfaces.md).
 *
 * **A `LoreEntry` has around forty fields and four of them are what an author
 * came to write**, so the editor has a disclosure problem; §11.2d's answer is
 * that the structure already exists in the schema file and the only editorial
 * decision left is which groups start open. So: one disclosure per banner, in
 * the schema's order, labelled with the schema's own words, and **nothing
 * lifted** — the core is made loud by which sections open rather than by
 * promoting its fields, because lifting is what would break the *verbatim*
 * claim §11.2d rests on.
 *
 * That is why the fields this editor writes are rendered **in place**, each
 * control standing exactly where its read-only row would. A form that gathered
 * the writable five at the top and folded the rest beneath would be a second
 * arrangement of the schema, which is what
 * [fields.ts](../library/fields.ts) exists to prevent.
 *
 * **Everything not owned here renders read-only through the book page's own
 * component** ([ByField.tsx](../library/ByField.tsx)'s `ReadOnlyField`), which
 * is [polish §1]'s *one description, two renderings* holding at the level where
 * it is easiest to lose: inside a single group, alternating.
 */

/**
 * The five fields this stage writes are the five cases of `EntryRow`'s switch
 * below — [10 §11.2d]'s durable core, verbatim: *"the first editor owes create,
 * rename, delete, and the durable core plus the folder gates, with everything
 * else visible and read-only."*
 *
 * **They are not listed twice**, and that is a correction rather than a
 * preference: a `Set` of owned keys used to stand here as a guard in front of
 * that switch, and removing the guard rendered every field as the *last* case's
 * control while the tests stayed green. A list of what is owned and a switch
 * deciding what each one renders as are two descriptions of one thing.
 *
 * Note what stays true either way: a field added to `LoreEntry` arrives in this
 * editor with no edit here at all — read-only, in its own group, which is
 * exactly what §11.2d asks for.
 */

/**
 * Which groups start open, **named by the field the banner hangs on rather than
 * by the banner's words**.
 *
 * §11.2d says *Matching and Firing*, and `keys` and `enabled` are the fields
 * those two banners annotate. Keying on the words would be branching on
 * displayed text — the thing `eslint.rules.js` reports, and it would only
 * report half of it, since `'Matching'` is one word and `'Grouping and gating'`
 * is three. It would also be wrong in practice rather than in principle: P5.0
 * *reworded* a banner, and a rewording must not silently change which sections
 * a reader finds open.
 */
const OPEN_AT_FIRST: ReadonlySet<string> = new Set(['keys', 'enabled']);

/** The field whose banner opened this group, which is also the group's id here. */
function openerOf(group: FieldGroup): string {
  return group.fields[0]?.key ?? '';
}

export function EntryFields(props: {
  entry: LoreEntry;
  onPatch: (patch: Partial<LoreEntry>) => void;
}): JSX.Element {
  const groups = groupsOf(fieldsOf(loreEntrySchema(), props.entry));

  return (
    <div className="flex flex-col gap-6">
      {groups.map((group) => {
        const opener = openerOf(group);

        // The head group — `id`, `name`, `content`, `description` — is never a
        // disclosure. §11.2d leaves the identity fields un-bannered at the
        // head, and a section that is always open needs no summary, which is
        // why the closed-section invariant never has to reckon with `id`
        // differing from a fresh entry's by construction.
        if (group.title === null) {
          return (
            <FieldRows key="head" rows={group.fields} entry={props.entry} onPatch={props.onPatch} />
          );
        }

        return (
          /*
           * **No open state, and no toggle handler**, which is a correction
           * rather than a simplification that happened to fit.
           *
           * This began as `AsStored`'s controlled pattern — `open` from state,
           * a `toggle` handler syncing it back — so that the annotation below
           * could be dropped while the section was open. In a browser it threw
           * on the first click and took the whole page to the router's error
           * card: `currentTarget` is valid only for the length of the handler,
           * and a state updater runs later, in React's render phase, by which
           * time it is null. **No test saw it**, in either direction — the
           * suite renders under `act`, where the updater flushes inside the
           * dispatch and the reference is still alive.
           *
           * What replaced it needs neither. React writes a DOM prop only when
           * the *prop* changes, so a constant `open` is applied once at mount
           * and never again: opening or closing a section by hand sticks, and
           * so does a section a browser opened by itself to show a find-in-page
           * match. That last property is the one worth having and it is now
           * true by construction rather than by a handler that has to be
           * written correctly.
           *
           * The cost is that the annotation shows while the section is open,
           * beside the fields it describes. That is redundant and it is the
           * cheaper mistake: the alternative is a stale-event hazard the suite
           * cannot see.
           */
          <details key={opener} open={OPEN_AT_FIRST.has(opener)}>
            {/*
             * **The whole phrase, computed** — the closed-section invariant's
             * string comes from one function so that no part of the sentence
             * exists only as a shape in the tree, which is what the assembly
             * rule reports and what a catalogue cannot pick up. A `summary`
             * takes phrasing content *or* a single heading, so the heading goes
             * inside it and the group's editorial note goes into the panel
             * below rather than beside the title.
             */}
            <summary className="cursor-pointer">
              <SubsectionTitle as="h4">{groupSummary(group, props.entry)}</SubsectionTitle>
            </summary>
            {group.note === undefined ? null : <Fine className="mt-1">{group.note}</Fine>}
            <div className="mt-3">
              <FieldRows rows={group.fields} entry={props.entry} onPatch={props.onPatch} />
            </div>
          </details>
        );
      })}
    </div>
  );
}

/** One group's fields, in the schema's order, controls standing in place. */
function FieldRows(props: {
  rows: FieldRow[];
  entry: LoreEntry;
  onPatch: (patch: Partial<LoreEntry>) => void;
}): JSX.Element {
  return (
    <div className="flex flex-col gap-4">
      {props.rows.map((row) => (
        <EntryRow key={row.key} row={row} entry={props.entry} onPatch={props.onPatch} />
      ))}
    </div>
  );
}

/**
 * One field — a control where this stage owns it, and the read-only rendering
 * where it does not.
 *
 * The branch is on the property name, which is an identifier rather than
 * displayed text; the label beside it is still `labelFor`'s, so the words a
 * reader sees are the schema's in both arms.
 *
 * **The switch is the whole answer, and there is no membership set beside it.**
 * There was one, and a mutation removed the guard in front of this switch
 * without a test noticing: every field fell through to a `default` that was
 * `enabled`'s checkbox, so *Position* rendered as a switch labelled *Position*
 * and bound to somebody else's field. A set that lists which fields are owned
 * and a switch that decides what each one renders as are two descriptions of
 * the same thing, and this is the one that cannot disagree with itself —
 * anything with no case is read-only, by construction.
 */
function EntryRow(props: {
  row: FieldRow;
  entry: LoreEntry;
  onPatch: (patch: Partial<LoreEntry>) => void;
}): JSX.Element {
  const { row, entry, onPatch } = props;

  switch (row.key) {
    case 'name':
      return (
        <Field
          label={row.label}
          path={`entries.${entry.id}.${row.key}`}
          value={entry.name}
          onChange={(name) => {
            onPatch({ name });
          }}
          hint="For you, in this book and in search. Never injected as content."
        />
      );
    case 'description':
      return (
        <Field
          label={row.label}
          path={`entries.${entry.id}.${row.key}`}
          value={entry.description}
          onChange={(description) => {
            onPatch({ description });
          }}
          multiline
          rows={3}
          hint="Read by a knowledge-router step to judge relevance. Never injected as content."
        />
      );
    case 'content':
      /**
       * ***The path is the entry's id and the field's key*** — [10 §11.2],
       * [P11.2]. A book's entries are reordered constantly — [10 §11.2c] makes
       * that an ordinary action on the list — so an index in this key would
       * attribute one entry's generated prose to whichever entry took its
       * place. That is worse than no provenance, because it reads as an answer.
       */
      return (
        <Field
          label={row.label}
          path={`entries.${entry.id}.${row.key}`}
          value={entry.content}
          onChange={(content) => {
            onPatch({ content });
          }}
          multiline
          rows={10}
          hint="What this entry contributes to the prompt when it fires."
        />
      );
    case 'keys':
      return (
        <LinesField
          label={row.label}
          value={entry.keys}
          onChange={(keys) => {
            onPatch({ keys });
          }}
          hint="One per line. Also this entry's index terms, which the book page makes clickable."
        />
      );
    case 'enabled':
      return (
        <CheckboxField
          label={row.label}
          checked={entry.enabled}
          onChange={(enabled) => {
            onPatch({ enabled });
          }}
          hint="Off keeps the entry in the book without ever firing it. A folder gate is separate and does not change this."
        />
      );
    /**
     * ***Where the entry lands, and the second half of [P7 §0.1a] item 11*** —
     * [P7.14]. `outlet` is a position no surface could set: an entry could be
     * made an outlet entry only by editing the file, which is [work plan §2.3]'s
     * test failed outright — *"whether the feature can be used at all without
     * someone setting the value"*.
     *
     * **A picker over the schema's own union**, the way `AdminInstall` renders a
     * closed union and for the argument it records: a hand-written list is a
     * second copy of the schema, and a second copy drifts. `positionOptions`
     * reads the four literals out of `row.schema`.
     */
    case 'position':
      return (
        <SelectField
          label={row.label}
          value={entry.position}
          options={positionOptions(row)}
          onChange={(next) => {
            onPatch({ position: next as LoreEntry['position'] });
          }}
          hint="Where an activated entry is pasted. An outlet entry lands wherever the preset puts it, rather than near the character."
        />
      );
    /**
     * ***Shown only at `outlet`***, and that is the one editorial judgement in
     * this pair. The field is meaningless on a `before_char` entry — it names
     * the `{{outlet::name}}` slot this entry fills — so a box sitting there
     * inert on every other entry would be a question with no answer, which is
     * what §11.2d's disclosure argument is about.
     *
     * *Read-only rather than hidden when it does not apply*, because a
     * hand-edited book may carry a name on a non-outlet entry and a field that
     * vanished would hide it. [04 §2]'s promise is that nothing is silently
     * dropped, and the save keeps it either way — this is only about whether it
     * can be typed into.
     */
    case 'outletName':
      if (entry.position !== 'outlet') {
        return (
          <ReadOnlyField row={row} value={(entry as unknown as Record<string, unknown>)[row.key]} />
        );
      }
      return (
        <Field
          label={row.label}
          value={entry.outletName ?? ''}
          onChange={(text) => {
            // Empty is `null` rather than `''`: the schema's union is
            // `string | null` and *no outlet named* is the null, so a blank box
            // must not write a name that is the empty string.
            onPatch({ outletName: text.trim() === '' ? null : text });
          }}
          hint="Exact and case-sensitive. The preset slot spelled {{outlet::name}} is where this lands."
        />
      );
    default:
      return (
        <ReadOnlyField row={row} value={(entry as unknown as Record<string, unknown>)[row.key]} />
      );
  }
}

/**
 * The four placements, from the schema's own union rather than from a list here.
 *
 * **`labelFor` on the value**, so `before_char` reads as *Before char* and the
 * words come from the same derivation every field label uses. A table mapping
 * each literal to nicer prose is the second description this module is built to
 * avoid — and it would be a table of English in a file [01 §2] keeps English out
 * of, which is the same objection one level up.
 *
 * *An empty union falls back to the entry's own value*, so a build reading a
 * schema it cannot parse renders a picker with one option rather than an empty
 * one that would silently clear the field on focus.
 */
function positionOptions(row: FieldRow): [string, string][] {
  const arms = (row.schema as { anyOf?: { const?: unknown }[] } | undefined)?.anyOf ?? [];
  const values = arms
    .map((arm) => arm.const)
    .filter((value): value is string => typeof value === 'string');
  return values.map((value) => [value, labelFor(value)]);
}

/**
 * A list of strings edited as one per line.
 *
 * **The text is state and the array is derived**, for the reason
 * [form.ts](./form.ts) keeps `aliasesText`: splitting on every keystroke and
 * re-joining would eat the newline somebody has just typed, so the buffer has
 * to be allowed to hold a line that is not yet a value.
 *
 * **Re-seeded on identity, not on content**, which is the part worth reading
 * slowly. Typing hands the parent exactly the array this component produced, so
 * that array comes back as the same reference and the buffer is left alone. A
 * value arriving from anywhere else — a version restored, a newer copy loaded
 * after a 412 — is a different reference and re-seeds. Comparing the *contents*
 * instead would loop forever the first time a hand-edited book carried a key
 * with a space around it, because `splitLines` trims and the comparison would
 * never converge.
 */
function LinesField(props: {
  label: string;
  value: string[];
  onChange: (value: string[]) => void;
  hint: string;
}): JSX.Element {
  const [held, setHeld] = useState<{ text: string; from: string[] }>(() => ({
    text: joinLines(props.value),
    from: props.value,
  }));

  if (props.value !== held.from) {
    setHeld({ text: joinLines(props.value), from: props.value });
  }

  return (
    <Field
      label={props.label}
      value={held.text}
      onChange={(text) => {
        const parsed = splitLines(text);
        setHeld({ text, from: parsed });
        props.onChange(parsed);
      }}
      multiline
      rows={4}
      hint={props.hint}
    />
  );
}
