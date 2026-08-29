// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import type { JSX, ReactNode } from 'react';

/**
 * One `dt`/`dd` pair for a definition grid — the label-value shape the
 * assembled-prose rule blesses, because the words and the value live in
 * separate elements by construction.
 *
 * Lifted from the object detail page at [P3.2], when the workbench's budget
 * and call views became its second and third consumers — the audit's own
 * complaint about the two JSON viewers is the argument against a third local
 * spelling. The `dl` at the call site owns the grid
 * (`grid grid-cols-[auto_1fr] gap-x-6 gap-y-2`); this row owns only the pair.
 */
export function MetadataRow(props: { label: string; children: ReactNode }): JSX.Element {
  return (
    <>
      <dt className="font-medium text-ink-subtle">{props.label}</dt>
      <dd className="text-ink">{props.children}</dd>
    </>
  );
}
