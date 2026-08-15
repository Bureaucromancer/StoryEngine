// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { useId, type JSX } from 'react';

/**
 * The field primitive every editor is built from
 * ([05 §11](docs/design/05-ui-surfaces.md)): one component owning label,
 * value, validation, and the place assist will attach — so that "does this
 * field have AI assist?" is never a question anyone asks.
 *
 * **The assist slot renders nothing in P1.** Deliberately empty rather than
 * disabled-with-a-promise: a greyed "Generate" button that cannot work is a
 * placeholder in the [15 §2.2](docs/design/15-work-plan.md) sense and also a
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
}

const CONTROL_CLASS =
  'w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 ' +
  'focus-visible:outline-2 focus-visible:outline-slate-500';

export function Field(props: FieldProps): JSX.Element {
  const controlId = useId();
  const errorId = useId();
  const invalid = props.error != null;

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
          aria-describedby={invalid ? errorId : undefined}
          placeholder={props.placeholder}
        />
      ) : (
        <input
          id={controlId}
          className={CONTROL_CLASS}
          value={props.value}
          onChange={(event) => {
            props.onChange(event.target.value);
          }}
          aria-invalid={invalid || undefined}
          aria-describedby={invalid ? errorId : undefined}
          placeholder={props.placeholder}
        />
      )}
      {invalid ? (
        <p id={errorId} role="alert" className="mt-1 text-xs text-red-900">
          {props.error}
        </p>
      ) : null}
      {props.hint !== undefined && !invalid ? (
        <p className="mt-1 text-xs text-slate-500">{props.hint}</p>
      ) : null}
    </div>
  );
}
