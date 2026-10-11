// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { useId, type JSX } from 'react';

import { fieldLabel } from '../../ui/classes.js';

/**
 * ***A checkbox with its consequence beside it*** — `ui/Field.tsx`'s
 * `CheckboxField`, drawn the same way with the same classes, **written again
 * here on purpose** and only because of where it lives.
 *
 * The review is a chunk of its own ([21 §7](../../../../../docs/design/21-client-loading.md)),
 * and every module it shares with the entry the bundler moves into a file of
 * its own that the entry then preloads — measured at P16.3g: importing
 * `CheckboxField` split `ui/Field.tsx` out of the entry as a chunk the first
 * load fetches, and the gzip of two files is more than the gzip of one. P16.3f
 * met the same cost and took the same way out (`ImportWorldLoad.tsx`). So this
 * is the twelve lines of markup, with `fieldLabel` — a class list the entry
 * already shares — keeping it the same control to the eye. *If the two drift,
 * `CheckboxField` is the one that is right.*
 */
export function Tick(props: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  hint?: string;
}): JSX.Element {
  const id = useId();
  const hint = useId();
  return (
    <div className="flex items-start gap-2">
      <input
        id={id}
        type="checkbox"
        className="mt-1"
        checked={props.checked}
        onChange={(event) => {
          props.onChange(event.target.checked);
        }}
        aria-describedby={props.hint === undefined ? undefined : hint}
      />
      <div className="min-w-0">
        <label htmlFor={id} className={`${fieldLabel} break-words`}>
          {props.label}
        </label>
        {props.hint === undefined ? null : (
          <p id={hint} className="mt-0.5 break-words text-xs text-ink-faint">
            {props.hint}
          </p>
        )}
      </div>
    </div>
  );
}
