// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { findTag, normaliseTagName, sameTag } from '@storyengine/shared';
import { useMemo, useState, type JSX } from 'react';

import { useLibrary, useTags } from '../queries.js';
import { highlight, matches } from '../library/search.js';
import { Button } from '../ui/Button.js';
import { TagChip } from '../ui/TagChip.js';
import { TokenField, type TokenOption } from '../ui/TokenField.js';
import { TagManagerDialog } from './TagManagerDialog.js';

/**
 * The tag field an editor actually mounts — [05](../../../../docs/design/05-tagging.md).
 *
 * `TokenField` owns the combobox and knows nothing about tags; this owns the
 * policy: **what is offered, how it is matched, and what *create* means.**
 *
 * **Suggestions are the tags already in use**, gathered from the shelf the
 * client is already holding. That is the same rule the library's tag filter
 * states — *a tag filter offering tags nobody has used is a list of dead ends* —
 * and it costs nothing, because `GET /api/library` ships every object's body and
 * the query cache has it.
 *
 * **Nothing here writes anything.** Committing a tag adds a string to the form
 * and stops. A keystroke must not fire a server write inside a form whose whole
 * model is that nothing is written until Save, and a failed write in the middle
 * of typing has nowhere good to be reported. This is a deliberate divergence
 * from the surface it imitates, whose tags are id-keyed and therefore *must*
 * exist before they can be attached.
 */

export interface TagInputProps {
  label: string;
  values: readonly string[];
  onChange: (values: string[]) => void;
  hint?: string;
}

export function TagInput(props: TagInputProps): JSX.Element {
  const library = useLibrary();
  /**
   * The registry, for **colour only**.
   *
   * A tag with no entry draws neutral and behaves identically — [05 §2]'s
   * invariant 4. Nothing here waits on this query, refuses a tag because of it,
   * or treats its absence as an error: if it never loads, every chip is grey and
   * every other thing this field does still works.
   */
  const registry = useTags();
  const [managing, setManaging] = useState(false);

  /**
   * Every tag name on the shelf, deduplicated case-insensitively, first spelling
   * kept, sorted.
   *
   * Memoised on the poll's timestamp rather than on the array: the library
   * refetches every couple of seconds and hands back a new array each time, so
   * an identity-keyed memo would rebuild this on a timer for no reason.
   */
  const known = useMemo(
    () => vocabulary(library.data?.objects ?? []),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- see the comment above
    [library.dataUpdatedAt],
  );

  function optionsFor(term: string): readonly TokenOption[] {
    const typed = normaliseTagName(term);

    // Already carried tags are not offered. Removing them at the source is what
    // makes "no options" mean "nothing left to add", rather than a list of
    // things that would quietly do nothing.
    const offerable = known.filter((name) => !props.values.some((held) => sameTag(held, name)));
    const hits = offerable.filter((name) => matches(name, typed));

    const options: TokenOption[] = hits.map((name) => ({
      value: name,
      label: marked(name, typed),
    }));

    if (typed === '') return options;

    /**
     * **The create option, and the one case it is withheld.**
     *
     * Offering the typed text whenever it is not an exact match is what makes
     * inline creation the same gesture as picking — there is no separate *add*
     * button, and the option simply shows what you typed.
     *
     * It is withheld when a tag differing only in case exists, and the existing
     * spelling is offered instead. `noir` and `Noir` are one tag to a person and
     * two to the engine, which compares tag names exactly when it gates lore
     * ([05 §1]) — so quietly minting the second spelling would produce two tags
     * that gate differently, which is the failure that section exists to
     * prevent.
     */
    const held = props.values.some((value) => sameTag(value, typed));
    const exists = offerable.some((name) => sameTag(name, typed));
    if (held || exists) return options;

    return [{ value: typed, label: typed, create: true }, ...options];
  }

  /** How many objects carry each tag, keyed the way a lookup asks for it. */
  const counts = useMemo(
    () => tagCounts(library.data?.objects ?? []),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- see `known` above
    [library.dataUpdatedAt],
  );

  return (
    <>
      <TokenField
        label={props.label}
        values={props.values}
        onChange={props.onChange}
        optionsFor={optionsFor}
        renderToken={(value) => (
          <TagChip
            name={value}
            swatch={registry.data ? (findTag(registry.data, value)?.swatch ?? null) : null}
          />
        )}
        placeholder="Type to search or create"
        hint={props.hint}
      />

      <div className="mt-2">
        <Button
          type="button"
          size="compact"
          onClick={() => {
            setManaging(true);
          }}
        >
          Manage tags…
        </Button>
      </div>

      {managing ? (
        <TagManagerDialog
          counts={counts}
          onDismiss={() => {
            setManaging(false);
          }}
        />
      ) : null}
    </>
  );
}

/**
 * Objects per tag name, case-folded for the key.
 *
 * Counted here rather than asked of the server: `GET /api/library` already
 * ships every object's body and this page is holding it, so a second answer
 * computed server-side would be a second thing to keep true.
 */
function tagCounts(objects: readonly { object: Record<string, unknown> }[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const row of objects) {
    const tags = row.object['tags'];
    if (!Array.isArray(tags)) continue;
    const seen = new Set<string>();
    for (const tag of tags) {
      if (typeof tag !== 'string') continue;
      const key = normaliseTagName(tag).toLowerCase();
      if (key === '' || seen.has(key)) continue;
      seen.add(key);
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }
  return counts;
}

/**
 * The distinct tag names in use, in the spelling they were first written in.
 *
 * Case-folded for the *comparison* and never for the stored value — the same
 * split `normaliseTagName` and `sameTag` make in the shared module, and for the
 * same reason: how a name looks is the author's.
 */
function vocabulary(objects: readonly { object: Record<string, unknown> }[]): string[] {
  const seen: string[] = [];
  for (const row of objects) {
    const tags = row.object['tags'];
    if (!Array.isArray(tags)) continue;
    for (const tag of tags) {
      if (typeof tag !== 'string') continue;
      const name = normaliseTagName(tag);
      if (name === '') continue;
      if (seen.some((kept) => sameTag(kept, name))) continue;
      seen.push(name);
    }
  }
  return seen.sort((a, b) => a.localeCompare(b));
}

/**
 * The matched run marked, using the same `Run` machinery the book search draws
 * with — shared as a function rather than as a widget, which is the shape
 * [10 §5.3] asks for.
 */
function marked(name: string, term: string): JSX.Element {
  return (
    <>
      {highlight(name, term).map((run, index) =>
        run.hit ? (
          <mark
            key={`${String(index)}:${run.text}`}
            className="rounded-control bg-highlight-surface text-highlight-ink"
          >
            {run.text}
          </mark>
        ) : (
          <span key={`${String(index)}:${run.text}`}>{run.text}</span>
        ),
      )}
    </>
  );
}
