// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import {
  newTagRegistry,
  normaliseTagName,
  readTagRegistry,
  sameTag,
  TAG_REGISTRY_SCHEMA,
  type TagEntry,
  type TagRegistry,
} from '@storyengine/shared';

import { writeJsonAtomic } from '../storage/atomic.js';
import { readFileBytes } from '../storage/files.js';
import { KeyedQueue } from '../storage/keyed-queue.js';
import type { Layout } from '../storage/layout.js';

/**
 * The tag registry on disk — [05 §4](../../../../docs/design/05-tagging.md).
 *
 * **Shaped like `PrefsStore`, with one deliberate difference: this one
 * validates.** The preferences store documents at length that it does not, and
 * that is the whole of [26 B13]'s decision — a bag whose keys nothing
 * interprets can be added to and abandoned without a migration. A structured
 * document with a schema is what that decision *excluded*, which is why this is
 * a second file rather than a key in the first one, and why validating here
 * upholds B13 instead of contradicting it.
 *
 * **Read tolerantly, written strictly.** `readTagRegistry` in the shared module
 * drops what it cannot understand rather than throwing, because the file is
 * hand-editable like everything else in the data directory and what it holds is
 * decoration: a registry that refused to load would grey out every chip in the
 * library over one typo in a colour name. Writes go the other way — the writer
 * is us, and a document we produced should be one we would accept back.
 */

/** Bounds, not meaning. The same distinction `prefs.ts` draws for its own. */
const MAX_TAGS = 500;
const MAX_NAME_LENGTH = 64;

export class TagsError extends Error {
  readonly code: 'invalid' | 'conflict' | 'not-found';

  constructor(code: TagsError['code'], message: string) {
    super(message);
    this.name = 'TagsError';
    this.code = code;
  }
}

interface TagsFile {
  schema: string;
  tags: TagEntry[];
}

/**
 * The registry, or an empty one — the read half, as a free function.
 *
 * **Separate from the store because reading needs nothing the store owns.** The
 * class exists for its write queue, and a reader that had to construct one
 * would be building a critical section it never enters. The turn assembly reads
 * the registry once per turn and holds a `Layout` and nothing else, which is
 * exactly this signature.
 *
 * **An unreadable file reads as empty**, repaired by the next write — the
 * asymmetry `prefs.ts` argues against `accounts.json`, and the same one: a
 * broken accounts file means the server cannot tell who anyone is, and a broken
 * tag file means the chips are grey.
 */
export async function readRegistry(layout: Layout, handle: string): Promise<TagRegistry> {
  const bytes = await readFileBytes(layout.tagsFile(handle));
  if (bytes === null) return newTagRegistry();

  try {
    return readTagRegistry(JSON.parse(new TextDecoder().decode(bytes)));
  } catch {
    return newTagRegistry();
  }
}

export class TagStore {
  readonly #layout: Layout;
  /**
   * One queue, keyed by handle — `PrefsStore`'s reason exactly. Every mutation
   * below is a read-modify-write across an `await`, so two tabs recolouring two
   * different tags at once would otherwise have the second read land before the
   * first wrote, and the loser's change would vanish with no error anywhere.
   */
  readonly #writes = new KeyedQueue();

  constructor(layout: Layout) {
    this.#layout = layout;
  }

  /**
   * The registry, or an empty one.
   *
   * **An unreadable file reads as empty**, repaired by the next write — the
   * asymmetry `prefs.ts` argues against `accounts.json`, and the same one: a
   * broken accounts file means the server cannot tell who anyone is, and a
   * broken tag file means somebody's chips are grey.
   */
  async read(handle: string): Promise<TagRegistry> {
    return readRegistry(this.#layout, handle);
  }

  /**
   * Replaces the whole list, under the queue.
   *
   * Whole-list rather than per-entry, which is what makes reordering a single
   * write with no interleaving to reason about. The per-entry operations below
   * are all expressed as a read, a change and one of these.
   */
  async write(handle: string, tags: readonly TagEntry[]): Promise<TagRegistry> {
    return this.#writes.run(handle, async () => this.#writeNow(handle, tags));
  }

  /**
   * Reads, changes and writes as one critical section.
   *
   * Every mutation goes through here rather than through `read` and `write`
   * separately, because a caller that did those two things itself would have
   * re-opened the gap the queue exists to close.
   */
  async mutate(
    handle: string,
    change: (registry: TagRegistry) => readonly TagEntry[],
  ): Promise<TagRegistry> {
    return this.#writes.run(handle, async () => {
      const current = await this.read(handle);
      return this.#writeNow(handle, change(current));
    });
  }

  async #writeNow(handle: string, tags: readonly TagEntry[]): Promise<TagRegistry> {
    const checked = validated(tags);
    const file: TagsFile = { schema: TAG_REGISTRY_SCHEMA, tags: checked };
    await writeJsonAtomic(this.#layout.tagsFile(handle), file);
    return { schema: TAG_REGISTRY_SCHEMA, tags: checked };
  }
}

/**
 * What this store is willing to have written under its name.
 *
 * The checks are the ones a *caller* could get wrong — a name that is empty
 * after normalising, two entries that are one tag, a list without end. Nothing
 * here interprets a swatch or a folder mode, because those are open strings
 * whose unknown values are the shared module's business ([05 §4]).
 */
function validated(tags: readonly TagEntry[]): TagEntry[] {
  if (tags.length > MAX_TAGS) {
    throw new TagsError('invalid', `A registry holds at most ${String(MAX_TAGS)} tags.`);
  }

  const out: TagEntry[] = [];
  for (const tag of tags) {
    const name = normaliseTagName(tag.name);
    if (name === '') throw new TagsError('invalid', 'A tag needs a name.');
    if (name.length > MAX_NAME_LENGTH) {
      throw new TagsError(
        'invalid',
        `A tag name is at most ${String(MAX_NAME_LENGTH)} characters.`,
      );
    }
    if (tag.id === '') throw new TagsError('invalid', 'A tag needs an id.');
    if (out.some((kept) => kept.id === tag.id)) {
      throw new TagsError('conflict', `Two tags share the id ${tag.id}.`);
    }
    if (out.some((kept) => sameTag(kept.name, name))) {
      throw new TagsError('conflict', `${name} is already a tag.`);
    }
    out.push({ ...tag, name });
  }
  return out;
}
