// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { useState, type JSX } from 'react';

import { Field } from '../ui/Field.js';
import { joinLines, splitLines } from './form.js';

/**
 * ***A list of strings edited as text*** — one per line, or separated by
 * commas.
 *
 * **The text is state and the array is derived**, for the reason
 * [form.ts](./form.ts) keeps `aliasesText`: splitting on every keystroke and
 * re-joining would eat the newline — or the comma, or the space before the
 * next word — somebody has just typed, so the buffer has to be allowed to
 * hold a line that is not yet a value.
 *
 * **Re-seeded on identity, not on content**, which is the part worth reading
 * slowly. Typing hands the parent exactly the array this component produced, so
 * that array comes back as the same reference and the buffer is left alone. A
 * value arriving from anywhere else — a version restored, a newer copy loaded
 * after a 412 — is a different reference and re-seeds. Comparing the *contents*
 * instead would loop forever the first time a hand-edited book carried a key
 * with a space around it, because the split trims and the comparison would
 * never converge.
 *
 * ***Shared since 2026-09-27.*** This was the lorebook entry's alone, and its
 * docstring described the trap exactly; the generic editor's one-per-line
 * control and a picture's comma-separated tags were each written without it,
 * so a trailing space or an Enter at the end of a line was deleted as it was
 * typed — *dark fantasy* could not be typed into a Tags box at all.
 */
function BufferedList(props: {
  label: string;
  value: readonly string[];
  onChange: (value: string[]) => void;
  split: (text: string) => string[];
  join: (value: readonly string[]) => string;
  multiline: boolean;
  rows?: number;
  hint?: string;
  path?: string;
  readOnlyNote?: string;
}): JSX.Element {
  const [held, setHeld] = useState<{ text: string; from: readonly string[] }>(() => ({
    text: props.join(props.value),
    from: props.value,
  }));

  if (props.value !== held.from) {
    setHeld({ text: props.join(props.value), from: props.value });
  }

  return (
    <Field
      label={props.label}
      value={held.text}
      onChange={(text) => {
        const parsed = props.split(text);
        setHeld({ text, from: parsed });
        props.onChange(parsed);
      }}
      {...(props.multiline ? { multiline: true, rows: props.rows ?? 4 } : {})}
      {...(props.hint === undefined ? {} : { hint: props.hint })}
      {...(props.path === undefined ? {} : { path: props.path })}
      {...(props.readOnlyNote === undefined ? {} : { readOnlyNote: props.readOnlyNote })}
    />
  );
}

/** One per line — aliases, keys, tags, a preset's modes. */
export function LinesField(props: {
  label: string;
  value: readonly string[];
  onChange: (value: string[]) => void;
  hint: string;
  rows?: number;
  path?: string;
  readOnlyNote?: string;
}): JSX.Element {
  return <BufferedList {...props} split={splitLines} join={joinLines} multiline />;
}

/** Separated by commas on one line — a picture's tags. */
export function CommaField(props: {
  label: string;
  value: readonly string[];
  onChange: (value: string[]) => void;
  hint: string;
}): JSX.Element {
  return <BufferedList {...props} split={splitCommas} join={joinCommas} multiline={false} />;
}

function splitCommas(text: string): string[] {
  return text
    .split(',')
    .map((part) => part.trim())
    .filter((part) => part !== '');
}

function joinCommas(value: readonly string[]): string {
  return value.join(', ');
}
