// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import type { Lorebook, LoreEntry } from './schema/lorebook.js';

/**
 * Where one entry's surface forms turn up in another entry's prose —
 * [10 §5.3](../../../docs/design/10-ui-surfaces.md)'s *Mentions* and *Mentioned
 * by*.
 *
 * **The idea is right and the inline rendering is wrong**, and §5.3 spends its
 * argument on the difference: an underlined name inside a body reads as an
 * activation preview and is not one — the scanner runs over chat text, not over
 * entry content, except during recursion, and `recursiveScanning` defaults to
 * false. So this produces *lists*, and a list makes no claim about firing where
 * an underline inside a sentence does.
 *
 * **The four objections §5.3 raises are objections to drawing links, and each
 * of them is survivable in a list**, which is why this can exist at all:
 * `useRegex` entries are not literals — so this does not pretend to be the
 * matcher and says so; `matchWholeWords` and `caseSensitive` are per-entry, so
 * there is no single pass with one rule set — so this uses **one** rule, stated,
 * rather than approximating thirty; two entries may share a key, so any winner
 * would be a rule the file does not contain — so there is no winner and both are
 * listed. The fourth is the one that needed a decision: short and common keys
 * force a stop-list, *"which is invented policy and invisible invented policy at
 * that"*. The word doing the work there is **invisible**. So there is no
 * stop-list and no length floor: the rule is whole-word matching and nothing
 * else, a book whose keys are common words produces a long list, and that is the
 * file being what it is rather than this module hiding it.
 *
 * **This is also [11 §6](../../../docs/design/11-lorebooks-as-a-format.md)'s
 * sharpest falsification test**, which is why the rule lives here rather than in
 * the page: *"if real books produce empty or absurd lists, then keys were chosen
 * purely to trigger, with no aliasing intent behind them — the keys are index
 * terms premise in §2 is false, and this document's warrant falls with it."*
 * The instrument and the surface have to be the same code, or the reading is
 * about a rule nobody sees.
 *
 * **Derived at render and never indexed** (§5.3). It recomputes in milliseconds
 * over an object already in hand; an index would buy nothing and inherit an
 * invalidation problem.
 */

/** One entry named in another's prose, and the surface forms that named it. */
export interface MentionRow {
  entry: LoreEntry;
  /** What matched — §5.3: *every row names what matched*. In the file's order. */
  terms: string[];
}

/**
 * Both directions at once, keyed by the entry object.
 *
 * **By object rather than by id**, which is deliberate: an entry id is unique
 * within a book as a format rule that nothing enforces, and the importers derive
 * one by hashing name and content — so two entries can carry one id, and a map
 * keyed by id would silently merge their mentions. The caller always has the
 * entry in hand, because it got these from the same array.
 */
export interface MentionIndex {
  /** Entries this one names in its own content. */
  mentions: Map<LoreEntry, MentionRow[]>;
  /** Entries whose content names this one. */
  mentionedBy: Map<LoreEntry, MentionRow[]>;
}

/**
 * A string as it is compared: lowercased, every run of non-letters and
 * non-digits collapsed to one space, and padded with a space at each end.
 *
 * The padding is what makes a plain `includes` a **whole-word** test, and it is
 * why this is one line rather than a regular expression per term: a book with
 * three hundred entries offers a thousand terms, and building a thousand
 * anchored patterns per render is the version that would need the index §5.3
 * declines to build. It also makes multi-word terms work for free — *the docks*
 * matches *"across the docks, at dawn"* and not *"the dockside"*.
 *
 * Unicode-aware, because a key can be any language the author writes in.
 */
function normalise(text: string): string {
  return ` ${text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()} `;
}

/**
 * A field read through what the file actually has rather than through what the
 * type says.
 *
 * **This module is reached from a surface whose contract is that it never gives
 * a white screen.** The book page's guard checks that `entries` is a list of
 * objects and deliberately no more, because a hand-edited file is the storage
 * thesis working — so an entry can arrive here with no `secondaryKeys` at all,
 * and it did: the first thing these functions met outside their own tests was a
 * fixture built to be minimally book-shaped, and spreading an absent array threw
 * inside the component. Shared code reachable from that guard may not assume
 * more than the guard checks.
 */
function textsOf(value: unknown): string[] {
  if (typeof value === 'string') return [value];
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === 'string');
}

/**
 * The surface forms of an entry — [11 §2](../../../docs/design/11-lorebooks-as-a-format.md)'s
 * *soft indexing*: to the engine `keys` and `secondaryKeys` are activation
 * triggers, and to a reader they are the aliases a concept goes by. The name is
 * the third, and §5.3 names it first.
 *
 * Both key lists rather than only `keys`, because 11 §2 makes its argument about
 * the pair and the book page's own search already covers both — the two surfaces
 * disagreeing about which words name an entry would be the drift this repository
 * keeps paying for elsewhere.
 */
function surfaceFormsOf(entry: LoreEntry): string[] {
  const held = entry as unknown as Record<string, unknown>;
  return [
    ...textsOf(held['name']),
    ...textsOf(held['keys']),
    ...textsOf(held['secondaryKeys']),
  ].filter((term) => normalise(term).trim() !== '');
}

/**
 * Every mention in a book, both ways round.
 *
 * One pass over the entries to normalise their prose and collect their surface
 * forms, then one pass pairing them. The word set is a prune rather than the
 * test: checking that a term's first word occurs at all is a hash lookup, and it
 * removes almost every candidate before the substring scan that actually
 * decides.
 */
export function mentionIndex(book: Lorebook): MentionIndex {
  const prepared = book.entries.map((entry) => {
    const haystack = normalise(
      textsOf((entry as unknown as Record<string, unknown>)['content'])[0] ?? '',
    );
    return {
      entry,
      haystack,
      words: new Set(haystack.trim().split(' ')),
      terms: surfaceFormsOf(entry),
    };
  });

  const mentions = new Map<LoreEntry, MentionRow[]>();
  const mentionedBy = new Map<LoreEntry, MentionRow[]>();
  for (const { entry } of prepared) {
    mentions.set(entry, []);
    mentionedBy.set(entry, []);
  }

  for (const source of prepared) {
    for (const target of prepared) {
      // An entry naming itself is not a link. §5.3's subject is "the places
      // they occur in *other* entries".
      if (source.entry === target.entry) continue;

      const matched = target.terms.filter((term) => {
        const needle = normalise(term);
        const first = needle.trim().split(' ')[0];
        return first !== undefined && source.words.has(first) && source.haystack.includes(needle);
      });
      if (matched.length === 0) continue;

      mentions.get(source.entry)?.push({ entry: target.entry, terms: matched });
      mentionedBy.get(target.entry)?.push({ entry: source.entry, terms: matched });
    }
  }

  return { mentions, mentionedBy };
}
