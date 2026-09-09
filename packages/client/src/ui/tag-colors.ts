// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { TAG_SWATCHES, type TagSwatch } from '@storyengine/shared';

/**
 * What a swatch id looks like — [05 §4](../../../../docs/design/05-tagging.md).
 *
 * The registry stores a **name**; this is the only place that turns one into a
 * colour, which is what lets the palette move without touching stored data.
 *
 * **Every class list is one whole string literal, and both halves of that
 * matter.** `eslint.rules.js` forbids assembling a class list with `+`, so a
 * computed one would not lint — but the harder reason is that **Tailwind only
 * emits a utility whose class name appears literally in the source it scans**.
 * A tidy `` `bg-tag-${id}-surface` `` produces eight chips with no background
 * and no error anywhere: not a lint failure, not a type failure, not a test
 * failure unless something asserts on the computed style, which jsdom does not
 * have. It would be found by looking at it, in a browser, some time later.
 *
 * The token names carry no digits on purpose, which is what keeps them clear of
 * the palette rule that bans `bg-rose-100` in a component — see the block these
 * are declared in, in `index.css`.
 *
 * The **label** is what the swatch is called in the manager. English, like every
 * other label derived from a field name in this client, and for the same reason
 * [fields.ts](../library/fields.ts) gives.
 */
export interface TagSwatchStyle {
  label: string;
  /** One literal, never joined. See above. */
  className: string;
  /** The tokens, so `contrast.test.ts` can measure the pair it draws. */
  surfaceToken: string;
  inkToken: string;
}

export const TAG_SWATCH_STYLES: Record<TagSwatch, TagSwatchStyle> = {
  rose: {
    label: 'Rose',
    className: 'bg-tag-rose-surface text-tag-rose-ink',
    surfaceToken: 'tag-rose-surface',
    inkToken: 'tag-rose-ink',
  },
  amber: {
    label: 'Amber',
    className: 'bg-tag-amber-surface text-tag-amber-ink',
    surfaceToken: 'tag-amber-surface',
    inkToken: 'tag-amber-ink',
  },
  lime: {
    label: 'Lime',
    className: 'bg-tag-lime-surface text-tag-lime-ink',
    surfaceToken: 'tag-lime-surface',
    inkToken: 'tag-lime-ink',
  },
  teal: {
    label: 'Teal',
    className: 'bg-tag-teal-surface text-tag-teal-ink',
    surfaceToken: 'tag-teal-surface',
    inkToken: 'tag-teal-ink',
  },
  sky: {
    label: 'Sky',
    className: 'bg-tag-sky-surface text-tag-sky-ink',
    surfaceToken: 'tag-sky-surface',
    inkToken: 'tag-sky-ink',
  },
  violet: {
    label: 'Violet',
    className: 'bg-tag-violet-surface text-tag-violet-ink',
    surfaceToken: 'tag-violet-surface',
    inkToken: 'tag-violet-ink',
  },
  fuchsia: {
    label: 'Fuchsia',
    className: 'bg-tag-fuchsia-surface text-tag-fuchsia-ink',
    surfaceToken: 'tag-fuchsia-surface',
    inkToken: 'tag-fuchsia-ink',
  },
  stone: {
    label: 'Stone',
    className: 'bg-tag-stone-surface text-tag-stone-ink',
    surfaceToken: 'tag-stone-surface',
    inkToken: 'tag-stone-ink',
  },
};

/**
 * The neutral chip, for a tag with no swatch and for one whose swatch this
 * build has never heard of.
 *
 * `Badge`'s own neutral tone, spelled again rather than imported, because
 * `Badge`'s tones are *meanings* — its header argues that at length — and a tag
 * colour is an author's arbitrary choice. Sharing the constant would be the
 * first step towards a `tone: 'tag'`, which is the distinction that file exists
 * to protect.
 */
export const NEUTRAL_TAG_CLASS = 'bg-badge-surface text-badge-ink';

/**
 * The classes for a stored swatch value.
 *
 * **An unknown value is neutral, not an error.** `swatch` is an open string
 * ([05 §4]) precisely so a hand-edited typo costs one grey chip instead of a
 * file that will not load, and this is the function that keeps that promise.
 */
export function tagClassFor(swatch: string | null): string {
  if (swatch === null) return NEUTRAL_TAG_CLASS;
  return isSwatch(swatch) ? TAG_SWATCH_STYLES[swatch].className : NEUTRAL_TAG_CLASS;
}

/** Whether this build knows the swatch — the guard `tagClassFor` reads. */
export function isSwatch(value: string): value is TagSwatch {
  return (TAG_SWATCHES as readonly string[]).includes(value);
}
