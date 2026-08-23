// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import type { ComponentProps, JSX } from 'react';

/**
 * The button.
 *
 * It replaces three incompatible spellings of the primary button and four of
 * the secondary, and the differences were not only cosmetic: the variant the
 * settings surface used had no hover state and no disabled state, so a button
 * that could not be pressed looked exactly like one that could. Consolidating
 * onto one definition gives those seven call sites both, which is a behaviour
 * change and is the point.
 *
 * **`type` is required.** All forty-four `<button>` elements in the client
 * already spelled it out, so requiring it costs nothing and keeps a default
 * from quietly eroding the discipline — an omitted `type` inside a `<form>` is
 * a submit button, which is the kind of bug that only appears on the one screen
 * nobody re-tested.
 *
 * **`className` is for position, not appearance.** A margin or an `ms-auto`
 * belongs to the layout that holds the button; a colour does not belong to the
 * call site at all. Utilities land after the variant's, but Tailwind's cascade
 * is by rule order in the stylesheet rather than by order in the attribute, so
 * a colour passed here fights the variant instead of overriding it.
 */

export type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'dangerOutline' | 'quiet';
export type ButtonSize = 'default' | 'compact' | 'tiny';

const BASE = 'rounded-control font-medium disabled:cursor-not-allowed';

const VARIANT: Record<ButtonVariant, string> = {
  primary: 'bg-accent text-on-accent hover:bg-accent-hover disabled:bg-accent-muted',
  secondary:
    'border border-line-strong text-ink-muted hover:bg-surface-muted disabled:text-ink-faint',
  danger: 'bg-danger text-on-danger hover:bg-danger-ink disabled:opacity-40',
  dangerOutline: 'border border-danger-line text-danger-ink hover:bg-danger-surface',
  quiet: 'text-ink-subtle underline hover:text-ink',
};

const SIZE: Record<ButtonSize, string> = {
  default: 'px-4 py-2 text-sm',
  compact: 'px-3 py-1 text-sm',
  /**
   * For a control inside a dense row — the revision table's per-row actions.
   * A third size rather than a call-site override, because "smaller than
   * compact" is a decision the type scale should make once.
   */
  tiny: 'px-2 py-0.5 text-xs',
};

export interface ButtonProps extends Omit<ComponentProps<'button'>, 'className'> {
  type: 'button' | 'submit' | 'reset';
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Position only — a margin, an `ms-auto`, a `w-full`. Never a colour. */
  className?: string;
}

export function Button({
  variant = 'secondary',
  size = 'default',
  className,
  ...rest
}: ButtonProps): JSX.Element {
  const classes = `${BASE} ${VARIANT[variant]} ${SIZE[size]}`;
  return (
    <button {...rest} className={className === undefined ? classes : `${className} ${classes}`} />
  );
}
