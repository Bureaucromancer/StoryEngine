// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { useState, type JSX } from 'react';

import type { LoreEntry } from '@storyengine/shared';

import { ReadOnlyField } from '../library/ByField.js';
import { groupSummary } from '../library/entry-defaults.js';
import {
  fieldsOf,
  groupsOf,
  loreEntrySchema,
  type FieldGroup,
  type FieldRow,
} from '../library/fields.js';
import { CheckboxField, Field } from '../ui/Field.js';
import { Fine, SubsectionTitle } from '../ui/Text.js';
import { joinLines, splitLines } from './form.js';

/**
 * One entry, as the schema's own shape —
 * [05 §11.2d](../../../../docs/design/05-ui-surfaces.md).
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
 * below — [05 §11.2d]'s durable core, verbatim: *"the first editor owes create,
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
      return (
        <Field
          label={row.label}
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
    default:
      return (
        <ReadOnlyField row={row} value={(entry as unknown as Record<string, unknown>)[row.key]} />
      );
  }
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
