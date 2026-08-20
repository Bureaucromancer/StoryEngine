// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { useId, type JSX } from 'react';

/**
 * The field primitive every editor is built from
 * ([05 §11](../../../../docs/design/05-ui-surfaces.md)): one component owning label,
 * value, validation, and the place assist will attach — so that "does this
 * field have AI assist?" is never a question anyone asks.
 *
 * **The assist slot renders nothing in P1.** Deliberately empty rather than
 * disabled-with-a-promise: a greyed "Generate" button that cannot work is a
 * placeholder in the [work plan §2.2](../../../../docs/design/workplan/01-work-plan.md) sense and also a
 * bad UI. What P1 commits to is this *component boundary*, not the assist
 * contract — the four operations of [05 §11.1] attach here when providers
 * exist at P2, and if this component starts growing an assist mechanism before
 * then, the rule has been broken and the work should stop.
 */

export interface FieldProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  /** Renders a textarea instead of a single-line input. */
  multiline?: boolean;
  rows?: number;
  /** A validation message. The field is announced invalid while present. */
  error?: string | null;
  /** Fine print under the control. */
  hint?: string;
  placeholder?: string;
  /**
   * Renders the control read-only, with this as the reason.
   *
   * **A reason rather than a boolean**, because a field a person cannot edit and
   * cannot find out why about is worse than no field at all — they conclude the
   * app is broken. `dataDir` is the case this exists for: it decides where
   * `config.json` itself lives, so a form that edited it and then wrote to the
   * old location would be a one-click way to appear to lose everything
   * ([P2A §2.6]). The note points at `--data` and the file instead.
   */
  readOnlyNote?: string;
}

const CONTROL_CLASS =
  'w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 ' +
  'focus-visible:outline-2 focus-visible:outline-slate-500';

export function Field(props: FieldProps): JSX.Element {
  const controlId = useId();
  const errorId = useId();
  const hintId = useId();
  const invalid = props.error != null;
  const note = props.readOnlyNote ?? props.hint;
  const describedBy = invalid ? errorId : note === undefined ? undefined : hintId;

  return (
    <div>
      <div className="mb-1 flex items-center justify-between gap-2">
        <label htmlFor={controlId} className="block text-sm font-medium text-slate-700">
          {props.label}
        </label>
        {/* The assist slot. Empty in P1 — see the header comment. */}
        <span aria-hidden="true" />
      </div>
      {props.multiline === true ? (
        <textarea
          id={controlId}
          className={CONTROL_CLASS}
          value={props.value}
          rows={props.rows ?? 4}
          onChange={(event) => {
            props.onChange(event.target.value);
          }}
          aria-invalid={invalid || undefined}
          aria-describedby={describedBy}
          placeholder={props.placeholder}
        />
      ) : (
        <input
          id={controlId}
          className={CONTROL_CLASS}
          value={props.value}
          readOnly={props.readOnlyNote !== undefined}
          onChange={(event) => {
            props.onChange(event.target.value);
          }}
          aria-invalid={invalid || undefined}
          aria-describedby={describedBy}
          placeholder={props.placeholder}
        />
      )}
      <Notes errorId={errorId} hintId={hintId} error={props.error} hint={note} />
    </div>
  );
}

/**
 * The same field, holding a number.
 *
 * A sibling in this file rather than a `type` prop on {@link Field}, and the
 * reason is [05 §11]'s: *does this field have assist?* must keep having one
 * answer. A union of props behind one component makes that answer "it depends
 * on the type", and the slot would grow a condition rather than a value.
 *
 * The value is a **string**, not a number, because a partially-typed number is
 * not one — `''` and `'-'` are both states a person passes through, and a
 * controlled numeric input that rejects them deletes the character they just
 * typed. Parsing is the caller's, at submit.
 */
export interface NumberFieldProps extends Omit<FieldProps, 'multiline' | 'rows'> {
  min?: number;
  max?: number;
  /** Rendered read-only, with the reason. See {@link Field}'s `readOnlyNote`. */
  readOnlyNote?: string;
}

export function NumberField(props: NumberFieldProps): JSX.Element {
  const controlId = useId();
  const errorId = useId();
  const hintId = useId();
  const invalid = props.error != null;
  const locked = props.readOnlyNote !== undefined;
  const note = props.readOnlyNote ?? props.hint;

  return (
    <div>
      <Label htmlFor={controlId} text={props.label} />
      <input
        id={controlId}
        type="number"
        inputMode="numeric"
        className={CONTROL_CLASS}
        value={props.value}
        min={props.min}
        max={props.max}
        readOnly={locked}
        onChange={(event) => {
          props.onChange(event.target.value);
        }}
        aria-invalid={invalid || undefined}
        aria-describedby={invalid ? errorId : note === undefined ? undefined : hintId}
        placeholder={props.placeholder}
      />
      <Notes errorId={errorId} hintId={hintId} error={props.error} hint={note} />
    </div>
  );
}

/**
 * A checkbox, with its consequence written beside it.
 *
 * [05 §15.2](../../../../docs/design/05-ui-surfaces.md) asks for the consequence next to each
 * switch, so `hint` is where that sentence goes and it is not decoration — a
 * capability toggle whose effect is only discoverable by trying it is the thing
 * that section exists to prevent.
 */
export interface CheckboxFieldProps {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  hint?: string;
  disabled?: boolean;
}

export function CheckboxField(props: CheckboxFieldProps): JSX.Element {
  const controlId = useId();
  const hintId = useId();

  return (
    <div className="flex items-start gap-2">
      <input
        id={controlId}
        type="checkbox"
        className="mt-1"
        checked={props.checked}
        disabled={props.disabled}
        onChange={(event) => {
          props.onChange(event.target.checked);
        }}
        aria-describedby={props.hint === undefined ? undefined : hintId}
      />
      <div>
        <label htmlFor={controlId} className="block text-sm font-medium text-slate-700">
          {props.label}
        </label>
        {props.hint === undefined ? null : (
          <p id={hintId} className="mt-0.5 text-xs text-slate-500">
            {props.hint}
          </p>
        )}
      </div>
    </div>
  );
}

/** A closed set of values. `options` is `[value, label]` so the label can differ. */
export interface SelectFieldProps {
  label: string;
  value: string;
  options: readonly (readonly [string, string])[];
  onChange: (value: string) => void;
  hint?: string;
}

export function SelectField(props: SelectFieldProps): JSX.Element {
  const controlId = useId();
  const hintId = useId();

  return (
    <div>
      <Label htmlFor={controlId} text={props.label} />
      <select
        id={controlId}
        className={CONTROL_CLASS}
        value={props.value}
        aria-describedby={props.hint === undefined ? undefined : hintId}
        onChange={(event) => {
          props.onChange(event.target.value);
        }}
      >
        {props.options.map(([value, label]) => (
          <option key={value} value={value}>
            {label}
          </option>
        ))}
      </select>
      {/* `hintId`, not `controlId` — this passed the select's own id, which
          would have been a duplicate in the DOM the moment it rendered. */}
      <Notes errorId={hintId} hintId={hintId} error={null} hint={props.hint} />
    </div>
  );
}

/** The label row, including the assist slot every field carries. */
function Label({ htmlFor, text }: { htmlFor: string; text: string }): JSX.Element {
  return (
    <div className="mb-1 flex items-center justify-between gap-2">
      <label htmlFor={htmlFor} className="block text-sm font-medium text-slate-700">
        {text}
      </label>
      {/* The assist slot. Empty — see the header comment. */}
      <span aria-hidden="true" />
    </div>
  );
}

/** The error or the hint under a control. An error hides the hint. */
function Notes({
  errorId,
  hintId,
  error,
  hint,
}: {
  errorId: string;
  hintId: string;
  error: string | null | undefined;
  hint: string | undefined;
}): JSX.Element | null {
  if (error != null) {
    return (
      <p id={errorId} role="alert" className="mt-1 text-xs text-red-900">
        {error}
      </p>
    );
  }
  /**
   * **The hint carries an id too**, because a control has to be able to point at
   * it — and until [P2B](../../../docs/design/workplan/14-p2b-provider-configuration.md) only
   * `CheckboxField` did. [05 §15.2](../../../docs/design/05-ui-surfaces.md) asks for the
   * consequence beside the switch, and on a text or select field it was there
   * for a sighted reader and announced to nobody: the label read out, the
   * sentence explaining what the control does silently skipped.
   *
   * A separate id from the error's, rather than reusing one, because the two are
   * never present together and sharing would make `aria-describedby` point at a
   * node that is not there in whichever state the control is not in.
   */
  return hint === undefined ? null : (
    <p id={hintId} className="mt-1 text-xs text-slate-500">
      {hint}
    </p>
  );
}
