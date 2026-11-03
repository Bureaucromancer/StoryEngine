// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import type { ModelModalities } from '../api.js';

/**
 * ***Narrowing what an endpoint offers*** — the model picker's filters, kept
 * out of the component so the rules are tested as rules (2026-10-25).
 *
 * The condition they fix: an aggregator — OpenRouter, NanoGPT — answers
 * `/models` with several hundred ids, and one alphabetical column of checkboxes
 * is a list nobody can provision from. Searching is the part every endpoint
 * gets; the modality filters are the part only an endpoint that says what its
 * models take and give can have, and they appear only then.
 */
export interface ModelFilter {
  /** Free text; every whitespace-separated word must appear in the id. */
  query: string;
  /** Modality words a model must take in — all of them, not any. */
  takes: readonly string[];
  /** Modality words a model must give back — all of them, not any. */
  gives: readonly string[];
  /** Only the models already ticked, for reviewing a selection in a long list. */
  tickedOnly: boolean;
}

export const NO_FILTER: ModelFilter = { query: '', takes: [], gives: [], tickedOnly: false };

/**
 * ***Every word, in any order.*** An aggregator's ids are `vendor/family-size-variant`,
 * and what a person remembers is two of those pieces — `llama 70b`,
 * `claude sonnet` — not the order they were joined in. Substring rather than
 * prefix for the same reason: the vendor comes first and is the part most
 * often left out.
 */
export function matchesQuery(id: string, query: string): boolean {
  const haystack = id.toLowerCase();
  return query
    .toLowerCase()
    .split(/\s+/)
    .filter((word) => word.length > 0)
    .every((word) => haystack.includes(word));
}

/**
 * The models the filter lets through, in the endpoint's own order.
 *
 * ***All, not any, within a row.*** Ticking *pictures in* and *sound in* is
 * asking for a model that takes both, which is the question somebody filtering
 * by capability is asking; *any* would make each extra tick widen the list,
 * which reads as the filter being broken.
 *
 * **A model the endpoint said nothing about fails every modality filter.** It
 * may well take pictures, but the filter is a claim about what the endpoint
 * said, and passing an unknown model would put a text-only one in front of
 * somebody who asked for vision. {@link hiddenUnknown} counts them so the page
 * can say that they were hidden rather than that they do not exist.
 */
export function filterOffered(
  offered: readonly string[],
  modalities: ReadonlyMap<string, ModelModalities>,
  chosen: readonly string[],
  filter: ModelFilter,
): string[] {
  const ticked = new Set(chosen);
  return offered.filter((id) => {
    if (filter.tickedOnly && !ticked.has(id)) return false;
    if (!matchesQuery(id, filter.query)) return false;
    if (filter.takes.length === 0 && filter.gives.length === 0) return true;
    const known = modalities.get(id);
    if (known === undefined) return false;
    return (
      filter.takes.every((word) => known.input.includes(word)) &&
      filter.gives.every((word) => known.output.includes(word))
    );
  });
}

/**
 * How many models a modality filter hid only because nothing was said about
 * them — the ones the search and *ticked only* would otherwise have shown.
 */
export function hiddenUnknown(
  offered: readonly string[],
  modalities: ReadonlyMap<string, ModelModalities>,
  chosen: readonly string[],
  filter: ModelFilter,
): number {
  if (filter.takes.length === 0 && filter.gives.length === 0) return 0;
  const unfiltered = filterOffered(offered, modalities, chosen, {
    ...filter,
    takes: [],
    gives: [],
  });
  return unfiltered.filter((id) => !modalities.has(id)).length;
}

export function isFiltering(filter: ModelFilter): boolean {
  return (
    filter.query.trim().length > 0 ||
    filter.takes.length > 0 ||
    filter.gives.length > 0 ||
    filter.tickedOnly
  );
}

/**
 * The words to offer as filters: whichever the endpoint actually used, so a
 * provider that adds `video` gets a `video` box without this build knowing the
 * word. The familiar ones go first in a fixed order, because a row whose order
 * changed with every endpoint would be a row nobody learns.
 */
export function modalityWords(modalities: Iterable<ModelModalities>): {
  input: string[];
  output: string[];
} {
  const input = new Set<string>();
  const output = new Set<string>();
  for (const each of modalities) {
    for (const word of each.input) input.add(word);
    for (const word of each.output) output.add(word);
  }
  return { input: ordered(input), output: ordered(output) };
}

const FAMILIAR = ['text', 'image', 'audio', 'video', 'file', 'embedding'];

function ordered(words: Set<string>): string[] {
  const familiar = FAMILIAR.filter((word) => words.has(word));
  const rest = [...words].filter((word) => !FAMILIAR.includes(word)).sort();
  return [...familiar, ...rest];
}

/**
 * The page's word for one modality — *pictures* rather than *image*, because
 * that is the word every other control on this form already uses.
 */
export function modalityLabel(word: string): string {
  switch (word) {
    case 'text':
      return 'Text';
    case 'image':
      return 'Pictures';
    case 'audio':
      return 'Sound';
    case 'video':
      return 'Video';
    case 'file':
      return 'Files';
    case 'embedding':
      return 'Embeddings';
    default:
      return word.charAt(0).toUpperCase() + word.slice(1);
  }
}
