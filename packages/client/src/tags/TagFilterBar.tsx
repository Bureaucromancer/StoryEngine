// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { findTag, type TagEntry } from '@storyengine/shared';
import type { JSX } from 'react';

import { tagClassFor } from '../ui/tag-colors.js';

/**
 * The library's tag filter — [05 §5](../../../../docs/design/05-tagging.md).
 *
 * **Three states, not two.** Neutral, selected, excluded, and back. A two-state
 * filter can say *show me the noir ones*; it cannot say *anything but the
 * drafts*, which is the half people reach for once a library is big enough to
 * need filtering at all.
 *
 * **`aria-pressed` is deliberately not used.** It is a two-state attribute and
 * this is a three-state control, so a toggle button would have to lie about one
 * of them. Each chip is an ordinary button whose accessible name carries the
 * state as a word, which is also the only spelling a screen reader can act on.
 *
 * **Registry order first, then everything else alphabetically.** A tag that has
 * been given a place keeps it; a tag in use that nobody has arranged still
 * appears, because it filters exactly as well ([05 §2] invariant 1) and a bar
 * that hid it would be a bar that lied about what the shelf contains.
 */

export type TagFilterState = 'selected' | 'excluded';

/** Keyed by the case-folded name, which is how a tag is compared everywhere. */
export type TagFilters = ReadonlyMap<string, TagFilterState>;

export interface TagFilterBarProps {
  /** Every tag name in use on this shelf, in the spelling first seen. */
  names: readonly string[];
  registry: { tags: readonly TagEntry[] } | undefined;
  filters: TagFilters;
  onChange: (filters: TagFilters) => void;
}

const NEXT: Record<'neutral' | TagFilterState, 'neutral' | TagFilterState> = {
  neutral: 'selected',
  selected: 'excluded',
  excluded: 'neutral',
};

export function TagFilterBar(props: TagFilterBarProps): JSX.Element | null {
  if (props.names.length === 0) return null;

  const ordered = order(props.names, props.registry);

  function cycle(name: string): void {
    const key = name.toLowerCase();
    const next = NEXT[props.filters.get(key) ?? 'neutral'];
    const updated = new Map(props.filters);
    if (next === 'neutral') updated.delete(key);
    else updated.set(key, next);
    props.onChange(updated);
  }

  const active = props.filters.size > 0;

  return (
    <div className="mb-4 flex flex-wrap items-center gap-1.5">
      {ordered.map(({ name, swatch }) => {
        const state = props.filters.get(name.toLowerCase()) ?? 'neutral';
        return (
          <button
            key={name}
            type="button"
            aria-label={chipLabel(name, state)}
            className={chipClass(state, swatch)}
            onClick={() => {
              cycle(name);
            }}
          >
            {name}
          </button>
        );
      })}
      {active ? (
        <button
          type="button"
          className="rounded-control px-2 py-0.5 text-xs text-ink-subtle underline"
          onClick={() => {
            props.onChange(new Map());
          }}
        >
          Clear tags
        </button>
      ) : null}
    </div>
  );
}

/**
 * Whether an object's tags satisfy the bar.
 *
 * **Selected are ORed and excluded reject**, which is the reading
 * `activate.ts` already argues for its own `include`: a filter listing three
 * tags means *anything with one of these*, because that is what somebody
 * writing a list expects. An excluded tag rejects whatever else matched, since
 * *not the drafts* is not a preference to be outvoted.
 */
export function passesTagFilters(tags: readonly string[], filters: TagFilters): boolean {
  if (filters.size === 0) return true;
  const held = new Set(tags.map((tag) => tag.toLowerCase()));

  for (const [name, state] of filters) {
    if (state === 'excluded' && held.has(name)) return false;
  }

  const selected = [...filters].filter(([, state]) => state === 'selected');
  if (selected.length === 0) return true;
  return selected.some(([name]) => held.has(name));
}

/** Registry order first, then the rest alphabetically. */
function order(
  names: readonly string[],
  registry: { tags: readonly TagEntry[] } | undefined,
): { name: string; swatch: string | null }[] {
  const rows = names.map((name) => {
    const entry = registry ? findTag(registry, name) : null;
    return {
      name,
      swatch: entry?.swatch ?? null,
      rank: entry ? entry.sortOrder : Number.MAX_SAFE_INTEGER,
    };
  });
  return rows
    .sort((a, b) => a.rank - b.rank || a.name.localeCompare(b.name))
    .map(({ name, swatch }) => ({ name, swatch }));
}

/**
 * The chip's look per state.
 *
 * Whole class literals, never assembled — Tailwind emits only names that appear
 * verbatim in the source it scans, so a computed one is a chip with no colour
 * and no error anywhere.
 */
function chipClass(state: 'neutral' | TagFilterState, swatch: string | null): string {
  const base = 'rounded-control px-2 py-0.5 text-xs font-medium';
  if (state === 'selected') return `${base} outline-2 outline-focus ${tagClassFor(swatch)}`;
  if (state === 'excluded') {
    return `${base} line-through opacity-60 outline-2 outline-danger ${tagClassFor(swatch)}`;
  }
  return `${base} opacity-70 ${tagClassFor(swatch)}`;
}

/**
 * The state as a word, in the accessible name.
 *
 * A three-state control has no attribute to carry this, so the name does. Built
 * here rather than in the JSX because a sentence split across children is what
 * the assembly rule reports.
 */
function chipLabel(name: string, state: 'neutral' | TagFilterState): string {
  if (state === 'selected') return `${name}, showing only these`;
  if (state === 'excluded') return `${name}, hidden`;
  return `${name}, not filtered`;
}
