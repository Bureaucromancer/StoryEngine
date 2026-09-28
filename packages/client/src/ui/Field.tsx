// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { useId, type JSX } from 'react';
import { useAssistContract, type AssistSubject } from './assist.js';
import { control, fieldLabel } from './classes.js';

/**
 * The field primitive every editor is built from
 * ([10 §11](../../../../docs/design/10-ui-surfaces.md)): one component owning label,
 * value, validation, and the place assist will attach — so that "does this
 * field have AI assist?" is never a question anyone asks.
 *
 * **The assist slot renders nothing in P1.** Deliberately empty rather than
 * disabled-with-a-promise: a greyed "Generate" button that cannot work is a
 * placeholder in the [work plan §2.2](../../../../docs/design/workplan/01-work-plan.md) sense and also a
 * bad UI. What P1 commits to is this *component boundary*, not the assist
 * contract — the four operations of [10 §11.1] attach here when providers
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
   * The most characters the control holds — the server's own limit, said where
   * the typing happens, so a field that goes past it is stopped at the key
   * rather than refused whole at the save.
   */
  maxLength?: number;
  /**
   * Marked with a glyph and announced as required — [10 §11.1a].
   *
   * **The glyph is `aria-hidden` and the announcement is `aria-required`**,
   * which is one fact told twice rather than two facts: a reader who can see the
   * label gets the mark, a reader who cannot gets the state, and neither gets
   * the word "asterisk". Spelling it into the label text instead would put
   * "required" in the accessible name and have it read out again on every
   * focus.
   *
   * It does not gate the control. Refusing the save is the editor's job
   * ([10 §11.6] puts the refusal beside the Save that caused it), because a
   * field that refuses to hold what somebody typed is worse than one that holds
   * it and says it is not enough.
   */
  required?: boolean;
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
  /**
   * ***What this field is, in the object being edited*** — [10 §11.2], [P11.2].
   *
   * The dotted path the `generated` provenance map is keyed by, and the one
   * thing a field has to say about itself for assist to be possible. **A field
   * with no path gets no assist**, which is the right default for the two kinds
   * that must never have one: a secret, and a control whose value is not the
   * author's prose.
   *
   * *It is not a `hasAssist` boolean, and the difference is [10 §11]'s whole
   * argument.* A boolean is the question *does this field have AI assist?* asked
   * once per call site; a path is a fact about the field that happens to be
   * enough.
   */
  path?: string;
}

/**
 * One string rather than a join: the `+` that used to sit here would now report
 * against the class-list rule, because the assembly rule beside it cannot tell
 * `rounded border` from two English words.
 *
 * `placeholder:text-ink-faint` is new, and it is the fix for the defect this
 * consolidation came out of — a placeholder with no colour of its own inherits
 * the surrounding ink, which on a surface that is not the one the shell assumed
 * resolves to the background.
 */
const CONTROL_CLASS = control;

/**
 * Six sites spelled this out verbatim before it had a name, and it has since
 * moved to `classes.ts` — the read-only by-field view labels a rendered value
 * with the same class, and *recognisably the same view* ([polish §1]) is a
 * claim two private copies could not keep.
 */
const LABEL_CLASS = fieldLabel;

export function Field(props: FieldProps): JSX.Element {
  const controlId = useId();
  const errorId = useId();
  const hintId = useId();
  const invalid = props.error != null;
  const note = props.readOnlyNote ?? props.hint;
  const describedBy = invalid ? errorId : note === undefined ? undefined : hintId;
  const contract = useAssistContract();

  /**
   * The field's own `onChange`, with the editor told that a person typed.
   *
   * *Every keystroke rather than a blur*, because the flag is idempotent and
   * cheap — `markReviewed` returns the same map when there is nothing to clear —
   * and a blur-based version would miss the case a reviewer most wants counted:
   * somebody editing the model's paragraph and then navigating away.
   */
  function edited(next: string): void {
    if (props.path !== undefined) contract?.onEdited(props.path);
    props.onChange(next);
  }

  return (
    <div>
      <Label
        htmlFor={controlId}
        text={props.label}
        required={props.required}
        {...(props.path === undefined || props.readOnlyNote !== undefined
          ? {}
          : {
              // Read-only fields carry no assist, and the reason is the
              // `readOnlyNote` itself: a control a person may not edit is one an
              // assist could only write over, which would be the form
              // contradicting its own explanation.
              assist: {
                path: props.path,
                label: props.label,
                value: props.value,
                onChange: props.onChange,
                multiline: props.multiline === true,
              },
            })}
      />
      {props.multiline === true ? (
        <textarea
          id={controlId}
          className={CONTROL_CLASS}
          value={props.value}
          rows={props.rows ?? 4}
          // Read-only on the same terms as the `<input>` below (2026-09-27):
          // this branch ignored the note, which was latent while no read-only
          // field was ever multiline — and every generic text field is now.
          readOnly={props.readOnlyNote !== undefined}
          onChange={(event) => {
            edited(event.target.value);
          }}
          aria-required={props.required === true ? true : undefined}
          aria-invalid={invalid || undefined}
          aria-describedby={describedBy}
          placeholder={props.placeholder}
          maxLength={props.maxLength}
        />
      ) : (
        <input
          id={controlId}
          className={CONTROL_CLASS}
          value={props.value}
          readOnly={props.readOnlyNote !== undefined}
          onChange={(event) => {
            edited(event.target.value);
          }}
          aria-required={props.required === true ? true : undefined}
          aria-invalid={invalid || undefined}
          aria-describedby={describedBy}
          placeholder={props.placeholder}
          maxLength={props.maxLength}
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
 * reason is [10 §11]'s: *does this field have assist?* must keep having one
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
  /**
   * ***Done with it*** (2026-09-27) — on leaving the box, and on Enter.
   *
   * For a control whose every value is a write: a number is typed a character
   * at a time, and `0.75` passes through `0` and `0.` on the way, so a control
   * that wrote on each change sent every one of them. A caller that commits here
   * and only holds text in `onChange` writes the number the person meant, once.
   */
  onCommit?: () => void;
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
      <Label htmlFor={controlId} text={props.label} required={props.required} />
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
        onBlur={props.onCommit}
        onKeyDown={(event) => {
          if (event.key === 'Enter') props.onCommit?.();
        }}
        aria-required={props.required === true ? true : undefined}
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
 * [10 §15.2](../../../../docs/design/10-ui-surfaces.md) asks for the consequence next to each
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
        <label htmlFor={controlId} className={LABEL_CLASS}>
          {props.label}
        </label>
        {props.hint === undefined ? null : (
          <p id={hintId} className="mt-0.5 text-xs text-ink-faint">
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
  /**
   * Hide the label from sight, never from the accessibility tree — [P7.3].
   *
   * **For a control in a table cell, where the name is already on the screen.**
   * The row header says which job this select is for and the column header says
   * what the column does, so drawing the label again would print the row header
   * twice in one row.
   *
   * *A real `<label>` with `sr-only`, not `aria-label` and not a dropped
   * label.* `label` stays required and stays the accessible name — a control
   * without one is not shippable — and this only decides whether it is painted.
   * The alternative spellings both cost something: `aria-label` overrides
   * whatever visible text somebody adds later, and no label at all leaves the
   * name to whatever the browser guesses from the cell.
   */
  hideLabel?: boolean;
}

export function SelectField(props: SelectFieldProps): JSX.Element {
  const controlId = useId();
  const hintId = useId();

  return (
    <div>
      <Label htmlFor={controlId} text={props.label} hidden={props.hideLabel} />
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
function Label({
  htmlFor,
  text,
  required,
  hidden,
  assist,
}: {
  htmlFor: string;
  text: string;
  /**
   * What the slot is about, when there is a slot to fill — [P11.2]. Absent for
   * a field with no path, a read-only field, and every field outside an editor,
   * all three of which render the empty span this replaced.
   */
  assist?: AssistSubject | undefined;
  /** `| undefined` because `exactOptionalPropertyTypes` is on and this is
   *  forwarded from an optional prop rather than spelled at the call site. */
  required?: boolean | undefined;
  /**
   * Out of sight and still in the accessibility tree — `sr-only`, not
   * `display: none`, which would take the label out of both ([P7.3]).
   *
   * The assist slot goes with it: it is `aria-hidden` and empty, so keeping it
   * laid out around a label nobody can see would reserve a row of space for
   * nothing.
   */
  hidden?: boolean | undefined;
}): JSX.Element {
  if (hidden === true) {
    return (
      <label htmlFor={htmlFor} className="sr-only">
        {text}
      </label>
    );
  }

  return (
    <div className="mb-1 flex items-center justify-between gap-2">
      <label htmlFor={htmlFor} className={LABEL_CLASS}>
        {text}
        {required === true ? (
          <span aria-hidden="true" className="ms-0.5">
            *
          </span>
        ) : null}
      </label>
      {/*
       * ***The assist slot, filled from the context an editor provides*** —
       * [10 §11.1], [P11.2]. It stays an `aria-hidden` empty span everywhere
       * else, which is what it was from P1 to here: a field outside an editor —
       * a login form, a settings control — is not a place where a model writes
       * anything, and `ui/assist.tsx` makes that the default rather than a
       * decision per call site.
       */}
      <AssistHere assist={assist} />
    </div>
  );
}

/**
 * The slot's contents, or the empty span.
 *
 * *A component rather than an inline read*, because a hook cannot be called
 * conditionally and `Label` returns early for a hidden label. Splitting it is
 * the cheap way to keep the rule.
 */
function AssistHere({ assist }: { assist: AssistSubject | undefined }): JSX.Element {
  const contract = useAssistContract();
  if (assist === undefined || contract === null) return <span aria-hidden="true" />;
  return <span className="relative flex items-center gap-1">{contract.slot(assist)}</span>;
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
      <p id={errorId} role="alert" className="mt-1 text-xs text-danger-ink">
        {error}
      </p>
    );
  }
  /**
   * **The hint carries an id too**, because a control has to be able to point at
   * it — and until [P2B](../../../../docs/design/workplan/10-p2b-provider-configuration.md) only
   * `CheckboxField` did. [10 §15.2](../../../../docs/design/10-ui-surfaces.md) asks for the
   * consequence beside the switch, and on a text or select field it was there
   * for a sighted reader and announced to nobody: the label read out, the
   * sentence explaining what the control does silently skipped.
   *
   * A separate id from the error's, rather than reusing one, because the two are
   * never present together and sharing would make `aria-describedby` point at a
   * node that is not there in whichever state the control is not in.
   */
  return hint === undefined ? null : (
    <p id={hintId} className="mt-1 text-xs text-ink-faint">
      {hint}
    </p>
  );
}
