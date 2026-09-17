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

/**
 * ***The focus ring belongs here, and its absence was visible in a straight
 * line.*** `ui/classes.ts`'s `control` has carried
 * `focus-visible:outline-2 focus-visible:outline-focus` since the appearance
 * layer landed, and so do the gallery tile, the context meter and the
 * workbench's resize handle — but not the button, not the nav and not the
 * links. So tabbing across the shell header changed focus treatment control by
 * control: a designed ring in `--color-focus` on anything you type into, and
 * whatever the user agent draws on everything you press. On the dark theme the
 * accent is a *light* fill, and the UA ring over it was never measured against
 * anything.
 */
const BASE =
  'rounded-control font-medium focus-visible:outline-2 focus-visible:outline-focus disabled:cursor-not-allowed';

/**
 * ***Three of these had no disabled state, and one dimmed with the mechanism
 * `classes.ts` refuses by name.***
 *
 * The consolidation that created this component existed because *"the variant
 * the settings surface used had neither a hover nor a disabled state, so a
 * button that could not be pressed looked exactly like one that could"*. Two
 * variants added afterwards — `quiet` and `dangerOutline` — arrived without
 * one, which is the same defect growing back on the file that was written to
 * remove it.
 *
 * `danger` had one and it was `disabled:opacity-40`, which `control`'s own
 * docstring rejects in as many words: *"it dims text and border together and
 * can push either below the contrast floor, which is how a fix for this becomes
 * the previous bug."* Named tokens instead, so `contrast.test.ts` can measure
 * what a disabled Delete actually looks like.
 */
const VARIANT: Record<ButtonVariant, string> = {
  primary: 'bg-accent text-on-accent hover:bg-accent-hover disabled:bg-accent-muted',
  secondary:
    'border border-line-strong text-ink-muted hover:bg-surface-muted disabled:text-ink-faint',
  danger:
    'bg-danger text-on-danger hover:bg-danger-ink disabled:bg-danger-muted disabled:text-ink-faint',
  dangerOutline:
    'border border-danger-line text-danger-ink hover:bg-danger-surface disabled:border-line disabled:text-ink-faint',
  quiet: 'text-ink-subtle underline hover:text-ink disabled:text-ink-faint disabled:no-underline',
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
