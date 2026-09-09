// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

/**
 * The tag registry — [05](../../../docs/design/05-tagging.md).
 *
 * **Internal tier, deliberately, and unlike everything under `schema/`.** The
 * same call `turn.ts` makes and for the same reason: `schema/` means portable,
 * versioned, in `PORTABLE_SCHEMAS`, emitted, and carryable inside a Package. A
 * registry of one person's colour choices crosses no install boundary. It lives
 * in this package only so the server that writes it and the client that draws
 * it stop re-declaring the shape.
 *
 * **What the registry is not** is the part worth reading twice
 * ([05 §2](../../../docs/design/05-tagging.md)). It decorates names; it does not
 * own them. Nothing here validates a tag against it, nothing refuses a name it
 * has not seen, and an object may carry a tag with no entry — that tag renders,
 * filters and gates lore exactly as a registered one does, with no swatch and no
 * position. A helper in this file that started refusing names would be the
 * moment tags stopped being open.
 *
 * **Read tolerantly, written strictly.** The document is hand-editable, like
 * everything else in the data directory, so {@link readTagRegistry} drops what
 * it cannot understand and keeps going: a typo makes one tag render plainly
 * rather than making the file unreadable. Writing is the other way round,
 * because the writer is us and a document we produced should be one we would
 * accept.
 */

/**
 * The document's version, spelled inline the way `storyengine.prefs/1` is.
 *
 * Not an emitted schema and not an `$id`. Additive optional fields are free;
 * changing what an existing one *means* bumps this and the reader upgrades in
 * memory. There is no migration burden either way, because the file never
 * leaves the install that wrote it.
 */
export const TAG_REGISTRY_SCHEMA = 'storyengine.tags/1';

/**
 * The palette, by name rather than by colour — [05 §4].
 *
 * A swatch id is stored; the colour it resolves to lives in the client's token
 * layer and nowhere else. That is what lets the palette be re-tuned, or a theme
 * redefine it, without rewriting anybody's data.
 *
 * Eight, because the list has to stay small enough that the colours are
 * *distinguishable* — a promise no contrast test can make, and the reason the
 * count is a judgement rather than a maximum.
 */
export const TAG_SWATCHES = [
  'rose',
  'amber',
  'lime',
  'teal',
  'sky',
  'violet',
  'fuchsia',
  'stone',
] as const;

export type TagSwatch = (typeof TAG_SWATCHES)[number];

/**
 * How a tag behaves as a folder over a shelf — [05 §5].
 *
 * `closed` hides its members from the ungrouped list until the folder is
 * entered; `open` shows them in both places; `none` is an ordinary tag, which
 * is nearly all of them.
 */
export type TagFolder = 'none' | 'open' | 'closed';

/**
 * One tag's decoration.
 *
 * **`swatch` and `folder` are open strings with documented values**, not closed
 * unions — the call [04 §8.2](../../../docs/design/04-schemas.md) makes for
 * `ActorRole`, generalised there into a rule: *a portable enum is a `string`
 * with known values documented, unless the engine truly cannot proceed without
 * understanding it*. Nothing here proceeds on a swatch at all. An unknown one
 * renders neutral and an unknown folder mode reads as `none`, which is what
 * keeps a hand-typed mistake from costing somebody their whole file.
 */
export interface TagEntry {
  /** Stable across renames — what an object's `tagIds` points at. */
  id: string;
  name: string;
  /** A {@link TAG_SWATCHES} id, or null for the neutral badge. */
  swatch: string | null;
  /** Manual order. Dense within a registry, but nothing depends on that. */
  sortOrder: number;
  /** A {@link TagFolder} value. */
  folder: string;
  /** Hidden from an object's inline chip strip, and from nowhere else ([05 §5]). */
  hidden: boolean;
  createdAt: string;
}

/**
 * The whole document.
 *
 * **A list rather than a map keyed by name**, which [05 §4] argues from the file
 * being hand-editable: an array diffs readably, carries `sortOrder` next to the
 * thing it orders, and survives a duplicated name as two rows somebody can see
 * and repair rather than as a key JSON silently collapsed.
 */
export interface TagRegistry {
  schema: string;
  tags: TagEntry[];
}

/** An empty one. The state every account starts in and most stay in. */
export function newTagRegistry(): TagRegistry {
  return { schema: TAG_REGISTRY_SCHEMA, tags: [] };
}

/**
 * A tag name as it is stored: trimmed, with internal runs of whitespace
 * collapsed.
 *
 * **Not lower-cased.** Case is the author's — `Noir` and `NPC` are how somebody
 * chose to write them — and folding it here would make the registry decide how
 * names look, which is the one thing [05 §2] says it may not do. Case-insensitive
 * *comparison* is {@link sameTag}'s job, which is a different question.
 */
export function normaliseTagName(raw: string): string {
  return raw.trim().replace(/\s+/g, ' ');
}

/**
 * Whether two names are the same tag.
 *
 * **The helper exists so nothing hand-rolls `toLowerCase()`**, because the day
 * this needs to fold accents as well is the day a dozen open-coded comparisons
 * would each have to be found. `localeCompare` with sensitivity `accent` treats
 * case as insignificant and keeps `é` distinct from `e`, which is the reading a
 * person writing tags expects.
 */
export function sameTag(a: string, b: string): boolean {
  return (
    normaliseTagName(a).localeCompare(normaliseTagName(b), undefined, { sensitivity: 'accent' }) ===
    0
  );
}

/**
 * Anything carrying a list of entries — the whole document, or the `{ tags }`
 * an API response is.
 *
 * The lookups below take this rather than {@link TagRegistry} because neither of
 * them has any use for `schema`, and asking a caller for a field to satisfy a
 * type it will not read is how a client ends up inventing one.
 */
export interface TagList {
  tags: readonly TagEntry[];
}

/** The entry for this name, or null. Case-insensitive, per {@link sameTag}. */
export function findTag(registry: TagList, name: string): TagEntry | null {
  return registry.tags.find((tag) => sameTag(tag.name, name)) ?? null;
}

/** The entry with this id, or null. */
export function tagById(registry: TagList, id: string): TagEntry | null {
  return registry.tags.find((tag) => tag.id === id) ?? null;
}

/**
 * A document read from disk, made safe to use.
 *
 * **Every failure is a drop, never a throw.** A registry that refused to load
 * would take the whole tag surface down over one bad row, and what it is
 * protecting is a colour. The asymmetry with `accounts.json` is `prefs.ts`'s and
 * is the same one: a broken accounts file means the server cannot tell who
 * anyone is, and a broken tag file means somebody's chips are grey.
 *
 * **A duplicate name keeps the first and drops the rest**, so the case a list
 * makes possible has a defined answer rather than depending on which reader
 * looked. Whoever hand-edited it can see both rows in the file; the app just
 * will not act on two.
 */
export function readTagRegistry(value: unknown): TagRegistry {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return newTagRegistry();
  const raw: unknown = (value as Record<string, unknown>)['tags'];
  if (!Array.isArray(raw)) return newTagRegistry();

  const tags: TagEntry[] = [];
  for (const candidate of raw) {
    const entry = readTagEntry(candidate);
    if (entry === null) continue;
    if (tags.some((kept) => kept.id === entry.id || sameTag(kept.name, entry.name))) continue;
    tags.push(entry);
  }

  return { schema: TAG_REGISTRY_SCHEMA, tags };
}

/** One row, or null when it is not one. Only `id` and `name` are load-bearing. */
function readTagEntry(value: unknown): TagEntry | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;

  const id = row['id'];
  const name = row['name'];
  if (typeof id !== 'string' || id === '') return null;
  if (typeof name !== 'string') return null;
  const normalised = normaliseTagName(name);
  if (normalised === '') return null;

  const swatch = row['swatch'];
  const folder = row['folder'];
  const sortOrder = row['sortOrder'];
  const createdAt = row['createdAt'];

  return {
    id,
    name: normalised,
    swatch: typeof swatch === 'string' && swatch !== '' ? swatch : null,
    sortOrder: typeof sortOrder === 'number' && Number.isFinite(sortOrder) ? sortOrder : 0,
    folder: typeof folder === 'string' ? folder : 'none',
    hidden: row['hidden'] === true,
    createdAt: typeof createdAt === 'string' ? createdAt : '',
  };
}

/**
 * The folder mode this entry actually behaves as.
 *
 * Read through a helper rather than compared inline, because `folder` is an
 * open string: an unknown value has to read as `none` everywhere, and *everywhere*
 * is a promise one call site cannot keep.
 */
export function folderOf(tag: TagEntry): TagFolder {
  return tag.folder === 'open' || tag.folder === 'closed' ? tag.folder : 'none';
}

/**
 * The names an object's tags actually have, now — [05 §3](../../../docs/design/05-tagging.md).
 *
 * **`tagIds` and `tags` are parallel arrays, written together and index-aligned.**
 * That is what lets a dangling id — an entry somebody deleted — fall back to the
 * name sitting beside it rather than vanishing, which is invariant 4: losing a
 * registry row must never lose data.
 *
 * Three cases, and each has a reason rather than a default:
 *
 * - **No `tagIds` at all**: the object predates the registry and has not been
 *   adopted. Its names are the truth and are returned unchanged, which is why
 *   an un-adopted library goes on working exactly as it did.
 * - **Lengths disagree**: somebody hand-edited one array and not the other. The
 *   *readable* copy wins, because it is the one a person was looking at, and
 *   guessing at an alignment that is visibly broken is how a tag silently
 *   becomes a different tag.
 * - **Aligned**: each id resolves through the registry, falling back to its
 *   own stored name.
 */
export function resolveTagNames(
  tags: readonly string[],
  tagIds: readonly string[] | undefined,
  registry: TagList,
): string[] {
  if (tagIds === undefined) return [...tags];
  if (tagIds.length !== tags.length) return [...tags];

  const names: string[] = [];
  for (const [index, id] of tagIds.entries()) {
    const name = tagById(registry, id)?.name ?? tags[index] ?? '';
    if (name !== '') names.push(name);
  }
  return names;
}

/**
 * Whether this object has been adopted — [05 §3].
 *
 * A question rather than a truthiness check, because the answer for an empty
 * array is *yes, and it has no tags*, which is exactly what `tagIds === []`
 * means and exactly what a `?.length` test would get wrong.
 */
export function isAdopted(tagIds: readonly string[] | undefined): boolean {
  return tagIds !== undefined;
}
