// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

/**
 * Identity: uuidv7 for objects, and slugs for the folders they live in.
 *
 * The two are deliberately unrelated. The uuid inside the file is identity; the
 * slug is a human-readable folder name that is frozen at creation and never
 * resolved against (docs/design/19-p1-implementation.md §1.1). A renamed folder
 * is an update to an existing row, not a second object, precisely because
 * nothing here derives one from the other.
 *
 * This is the one file exempt from the randomness rule
 * (docs/design/07-tech-stack.md §14.4), and the exemption is argued in
 * eslint.config.js: an id is not a draw. Nothing replays it and no outcome
 * depends on its value.
 *
 * The randomness comes from the **Web Crypto global**, not `node:crypto`:
 * `shared` is on the client's side of the boundary graph (client → shared,
 * docs/design/16-testing.md §2), and a `node:crypto` import is the one thing
 * that would make this package unloadable in a browser.
 */

// ---------------------------------------------------------------------------
// uuidv7
// ---------------------------------------------------------------------------

const MAX_COUNTER = 0xfff; // 12 bits of rand_a
const COUNTER_SEED_CEILING = 0x400; // leave 3072 increments of headroom per ms

/**
 * A uniform draw from [0, COUNTER_SEED_CEILING). The ceiling is a power of
 * two, so masking a random word is exact — no rejection loop, no modulo bias.
 */
function randomCounterSeed(): number {
  const word = new Uint32Array(1);
  crypto.getRandomValues(word);
  return (word[0] ?? 0) & (COUNTER_SEED_CEILING - 1);
}

/**
 * Builds an independent generator.
 *
 * The generator is **stateful**, because monotonicity is state: it has to
 * remember the last millisecond it emitted and how far into that millisecond it
 * has counted. That is worth making explicit rather than hiding in a module,
 * for the same reason the RNG service takes its source by injection
 * (docs/design/07-tech-stack.md §14.3) — a caller that needs a fresh sequence,
 * or a test that needs one uncontaminated by whatever ran before it, can have
 * one. `uuidv7` below is the shared instance almost everything should use.
 */
export function createUuidv7(): (now?: number) => string {
  let lastMs = -1;
  let counter = 0;

  return function generate(now: number = Date.now()): string {
    let ms = now;

    if (ms > lastMs) {
      lastMs = ms;
      counter = randomCounterSeed();
    } else {
      // Same millisecond, or a clock that went backwards. Either way, continue
      // from where we are rather than emitting an id that sorts before its
      // predecessor.
      ms = lastMs;
      counter += 1;
      if (counter > MAX_COUNTER) {
        lastMs += 1;
        ms = lastMs;
        counter = randomCounterSeed();
      }
    }

    const bytes = new Uint8Array(16);

    // 48-bit big-endian timestamp. Written in two halves because a 48-bit value
    // exceeds what bitwise operators can hold.
    const msHigh = Math.floor(ms / 0x1_0000_0000);
    const msLow = ms >>> 0;
    bytes[0] = (msHigh >>> 8) & 0xff;
    bytes[1] = msHigh & 0xff;
    bytes[2] = (msLow >>> 24) & 0xff;
    bytes[3] = (msLow >>> 16) & 0xff;
    bytes[4] = (msLow >>> 8) & 0xff;
    bytes[5] = msLow & 0xff;

    // Version 7 in the high nibble, then the counter across rand_a.
    bytes[6] = 0x70 | ((counter >>> 8) & 0x0f);
    bytes[7] = counter & 0xff;

    crypto.getRandomValues(bytes.subarray(8));
    // Variant bits: 0b10 in the top two bits of byte 8.
    bytes[8] = 0x80 | ((bytes[8] ?? 0) & 0x3f);

    return format(bytes);
  };
}

/**
 * RFC 9562 uuidv7: a 48-bit millisecond timestamp, then version, then 74 random
 * bits — of which the first 12 are used as a sub-millisecond counter.
 *
 * **Monotonic**, which is the property worth having and the reason this is not
 * `crypto.randomUUID()`. Ids sort in creation order, so a directory listing, an
 * index scan and a turn sequence all agree without a separate ordering column.
 * Within a single millisecond the counter provides the ordering; it is seeded
 * randomly low rather than at zero, so two processes starting in the same
 * millisecond do not walk the same sequence.
 *
 * A clock that jumps backwards does not break the ordering: the generator keeps
 * using the last millisecond it saw and lets the counter carry it forward. That
 * costs a little entropy and preserves the invariant callers actually rely on —
 * so the `now` argument is a *floor*, not a promise, and a caller that needs the
 * timestamp honoured exactly should use a fresh `createUuidv7()`.
 *
 * uuidv7 rather than v4 because [15 §2](docs/design/15-work-plan.md) requires
 * ids to be globally unique and never namespaced per user — a future shared
 * library merges without collisions.
 */
export const uuidv7 = createUuidv7();

function format(bytes: Uint8Array): string {
  let hex = '';
  for (const byte of bytes) {
    hex += byte.toString(16).padStart(2, '0');
  }
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20, 32),
  ].join('-');
}

const UUIDV7_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

/**
 * True for a well-formed uuidv7.
 *
 * Note what this is *not* used for: the schemas do not constrain `id` to this
 * pattern. An imported object may carry an id minted by something else, and a
 * `Ref` may point at one — rejecting those would strand exactly the data the
 * import path exists to rescue. This is for our own writes.
 */
export function isUuidv7(value: string): boolean {
  return UUIDV7_PATTERN.test(value);
}

/** Milliseconds since the epoch encoded in a uuidv7, or null if it is not one. */
export function uuidv7Timestamp(value: string): number | null {
  if (!isUuidv7(value)) return null;
  return Number.parseInt(value.slice(0, 8) + value.slice(9, 13), 16);
}

// ---------------------------------------------------------------------------
// Slugs
// ---------------------------------------------------------------------------

/** Long enough never to truncate a real name, short enough to leave path headroom. */
const MAX_SLUG_LENGTH = 64;

const FALLBACK_SLUG = 'untitled';

/**
 * Reserved on Windows in every directory, with or without an extension. Windows
 * is the development platform for this project (see .gitattributes), so a slug
 * that cannot be a directory there is a bug that would be found late and
 * awkwardly — by someone whose actor happens to be called Aux.
 */
const WINDOWS_RESERVED = new Set([
  'con',
  'prn',
  'aux',
  'nul',
  ...Array.from({ length: 9 }, (_, i) => `com${String(i + 1)}`),
  ...Array.from({ length: 9 }, (_, i) => `lpt${String(i + 1)}`),
]);

/**
 * Derives a folder name from an object's name.
 *
 * **Derived once, at creation, and then frozen**
 * (docs/design/19-p1-implementation.md §1.1). Renaming an object changes the
 * name inside the file; the folder keeps the name it was born with, and the
 * engine never moves the user's directories. Drift is bounded and legible: the
 * folder reads the way the library did when the object was created.
 *
 * Uniqueness is not this function's job — it has no view of the directory. The
 * caller de-duplicates with a numeric suffix, which is why the `-2`, `-3` shape
 * is left free here and why a reserved name is escaped with a trailing
 * underscore rather than a number.
 */
export function slugify(name: string): string {
  const folded = name
    .normalize('NFKD')
    // Strip the combining marks NFKD just separated out, so "Verá" folds to
    // "vera" rather than losing the letter entirely.
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase();

  let slug = folded
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');

  if (slug.length > MAX_SLUG_LENGTH) {
    slug = slug.slice(0, MAX_SLUG_LENGTH);
    // Prefer cutting at a word boundary, but not at the cost of most of the
    // name — a single very long word truncates mid-word rather than vanishing.
    const lastBoundary = slug.lastIndexOf('-');
    if (lastBoundary > MAX_SLUG_LENGTH / 2) {
      slug = slug.slice(0, lastBoundary);
    }
    slug = slug.replace(/-$/, '');
  }

  if (slug.length === 0) {
    // A name made entirely of characters that do not survive folding — CJK,
    // emoji, punctuation. The object is fine; only its folder name is unusable,
    // and the id inside the file is what identity runs on anyway.
    return FALLBACK_SLUG;
  }

  if (WINDOWS_RESERVED.has(slug)) {
    return `${slug}_`;
  }

  return slug;
}
