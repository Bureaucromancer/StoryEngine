// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import type { JSX, ReactNode } from 'react';

import { tagClassFor } from './tag-colors.js';

/**
 * A tag, drawn — [05 §5](../../../../docs/design/05-tagging.md).
 *
 * **Not a `Badge` tone**, and the distinction is the one `Badge`'s own header
 * spends its length on: that component's tones are *meanings*. `provenance` and
 * `warning` are both amber and are still two tones, because *this was not
 * authored here* is not a warning and a later theme has to be able to move one
 * without the other. A tag's colour is an author's arbitrary choice with no
 * meaning at all, so putting it in that union would destroy exactly the
 * distinction the union exists to hold.
 *
 * What it shares with `Badge` is the neutral case, spelled again in
 * `tag-colors.ts` rather than imported, for the same reason.
 */
export interface TagChipProps {
  name: string;
  /** A swatch id, or null for the neutral chip. Unknown values read as null. */
  swatch?: string | null;
  /** Rendered instead of the plain name — marked runs from a search. */
  children?: ReactNode;
  title?: string;
}

const BASE = 'rounded-control px-2 py-0.5 text-xs font-medium';

export function TagChip({ name, swatch = null, children, title }: TagChipProps): JSX.Element {
  return (
    <span title={title} className={`${BASE} ${tagClassFor(swatch)}`}>
      {children ?? name}
    </span>
  );
}
