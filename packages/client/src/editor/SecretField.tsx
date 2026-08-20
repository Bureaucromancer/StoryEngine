// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { useId, type JSX } from 'react';

/**
 * A masked input — a password, or an API key.
 *
 * **Its own file rather than a sibling in `Field.tsx`, and that is the point of
 * it.** Every control in that file carries the assist slot
 * ([05 §11](../../../../docs/design/05-ui-surfaces.md)), deliberately, so that *does this field
 * have AI assist?* keeps having one answer. A secret is the one input in this
 * application that must never acquire one — so it is not a `Field`, it is not
 * next to the `Field`s, and it does not share their props.
 *
 * It began as `PasswordInput`, file-private inside `UserSettings.tsx`. That was
 * right while there was exactly one masked box in the app. There are now two
 * kinds — a password and a provider key — and the second brought a requirement
 * the first never had.
 *
 * ## `keptNote`, and why an empty box is ambiguous
 *
 * A stored key is never sent to the browser, so the form cannot show it. Which
 * leaves an empty box meaning either *there is no key, this is a local
 * endpoint* or *there is a key and you are not being shown it* — two states an
 * admin has to tell apart, and the reason `hasKey` exists on the wire at all
 * ([P2B §2.2](../../../../docs/design/workplan/14-p2b-provider-configuration.md)).
 *
 * So the note is a **whole sentence supplied by the caller**, not a boolean this
 * component turns into one. [01 §2](../../../../docs/design/workplan/01-work-plan.md)'s rule:
 * a sentence assembled around a value cannot be translated, and a component that
 * chose between two hardcoded strings would be that rule broken one level down.
 */
export interface SecretFieldProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  /**
   * What an empty box means here — *leave blank to keep the stored key*, or
   * nothing at all when there is nothing stored.
   */
  keptNote?: string;
  /** A validation message. The field is announced invalid while present. */
  error?: string | null;
  /**
   * `new-password` on a password change, `off` on a provider key.
   *
   * Named rather than fixed because a browser offering to fill an API key from
   * a saved login is worse than useless — it silently rotates a credential to
   * the wrong value and the failure arrives at the next turn.
   */
  autoComplete?: 'off' | 'new-password' | 'current-password';
}

export function SecretField(props: SecretFieldProps): JSX.Element {
  const controlId = useId();
  const noteId = useId();
  const invalid = props.error != null;
  const note = props.error ?? props.keptNote;

  return (
    <div>
      <label htmlFor={controlId} className="mb-1 block text-sm font-medium text-slate-700">
        {props.label}
      </label>
      {/* No assist slot. See the header — this is the whole reason for the file. */}
      <input
        id={controlId}
        type="password"
        autoComplete={props.autoComplete ?? 'off'}
        className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus-visible:outline-2 focus-visible:outline-slate-500"
        value={props.value}
        onChange={(event) => {
          props.onChange(event.target.value);
        }}
        aria-invalid={invalid || undefined}
        aria-describedby={note === undefined ? undefined : noteId}
      />
      {note === undefined ? null : (
        <p
          id={noteId}
          {...(invalid ? { role: 'alert' } : {})}
          className={invalid ? 'mt-1 text-xs text-red-900' : 'mt-1 text-xs text-slate-500'}
        >
          {note}
        </p>
      )}
    </div>
  );
}
