// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

/**
 * The tile nobody uploaded — [12 §5.4](../../../../docs/design/12-account-gallery.md),
 * [P10.4].
 *
 * ***In `ui/` since 2026-10-13, and for actors as well as accounts***
 * ([P12A](../../../../docs/design/workplan/35-p12a-the-look.md) P12A.3, under
 * its §0.4). It was `auth/tile.ts`, the sign-in gallery's, while the play
 * page's portraits spelled the same idea a second way — one letter, cut by code
 * point, on a grey disc — which is the *second invention* P12A.3 was written
 * to prevent, already made. There is one spelling now, here, and `Face` beside
 * it is the one component that draws it. **The inputs were renamed rather than
 * reinterpreted**: `handle` and `displayName` became `id` and `name`, because
 * an actor has no handle and its immutable key is its id — the argument below
 * for the handle is the argument for the actor's id, word for word.
 *
 * ***Every account has a face from the day the feature ships***, which is what
 * makes an uploaded image an **override** rather than a requirement — and that
 * is the difference between a gallery and a grid of grey squares waiting for
 * somebody to do homework.
 *
 * ***Deterministic and cheap, and the two inputs are chosen rather than
 * convenient.*** **Initials from the display name**, since that is the name on
 * the tile and a face whose letters disagreed with its caption would be a small
 * lie. **Hue from the handle**, since the handle is immutable and *a rename
 * should not change anybody's colour* — the tile is how you find yourself in a
 * grid, and having it move under you is precisely the failure a generated
 * identicon exists to avoid. *(An actor's: initials from its name, hue from its
 * id, which a rename leaves where it was and the folder's slug does not.)*
 *
 * *Drawn client-side*: no bytes stored, no server involvement, no upload
 * required.
 */

/**
 * Up to two letters, taken the way a person would read them.
 *
 * ***Grapheme-aware rather than by code unit***, because a name is free
 * text and `"Ná"[0]` is the kind of thing that silently produces half a
 * character. The lint rules already forbid spreading a string for this reason;
 * `Intl.Segmenter` is the same argument with an answer.
 *
 * **Words, not characters**, so *Ada Lovelace* is `AL` and *Ada* is `A` rather
 * than `Ad`. A one-word name with one initial looks deliberate; two letters cut
 * out of the middle of a word look like a bug.
 */
export function initialsOf(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return '?';

  const first = firstGrapheme(words[0] ?? '');
  if (words.length === 1) return first.toUpperCase();
  return (first + firstGrapheme(words.at(-1) ?? '')).toUpperCase();
}

function firstGrapheme(word: string): string {
  // `Intl.Segmenter` is in every browser this project targets and in Node ≥ 18;
  // the fallback is for a runtime that has neither, where one code point is a
  // better guess than one code unit.
  const Segmenter = (
    Intl as unknown as { Segmenter?: new (locale?: string, options?: object) => object }
  ).Segmenter;
  if (Segmenter === undefined) {
    // **`codePointAt` rather than a spread**, which the lint rule forbids and
    // is right to — and the fallback is the whole reason it is tempting here.
    // One code point is a better guess than one code unit: it keeps a surrogate
    // pair whole, which is the half of the problem a runtime with no
    // `Intl.Segmenter` can still get right.
    const point = word.codePointAt(0);
    return point === undefined ? '' : String.fromCodePoint(point);
  }

  const segmenter = new Segmenter(undefined, { granularity: 'grapheme' }) as {
    segment: (text: string) => Iterable<{ segment: string }>;
  };
  for (const piece of segmenter.segment(word)) return piece.segment;
  return '';
}

/**
 * A hue in degrees, from an immutable key — an account's handle, an actor's id.
 *
 * ***FNV-1a rather than anything stronger***, and the choice is deliberate on
 * two counts: this is a **colour**, not a token — nothing about it needs to
 * resist being guessed — and the lint rule that bans `Math.random` and
 * `node:crypto` outside `rng/` is right to, so a hash that is plainly arithmetic
 * over the bytes of a string is the honest thing to reach for.
 *
 * *The gold-angle multiplier spreads adjacent handles apart*: `ned` and `neil`
 * differ in one byte, and without it two people on one install would get two
 * colours a person cannot tell apart, which is the whole job undone.
 */
export function hueOf(id: string): number {
  let hash = 0x811c9dc5;
  for (let at = 0; at < id.length; at += 1) {
    hash ^= id.charCodeAt(at);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return Math.round(((hash % 360) * 137.508) % 360);
}

export interface DrawnTile {
  initials: string;
  /** An `oklch` background, so it sits in the same colour space as the theme. */
  background: string;
  /** The ink on it, chosen for contrast rather than inherited. */
  ink: string;
}

/**
 * ***`oklch` rather than `hsl`, which is the appearance layer's own choice.***
 * `index.css` defines every token in `oklch` precisely because equal lightness
 * numbers *look* equally light across hues there and do not in `hsl` — so a
 * generated tile spelled in `hsl` would be the one surface in the app whose
 * yellows glare and whose blues disappear.
 *
 * **Fixed lightness and chroma, varying only the hue**, so every tile in the
 * grid has the same weight and the grid reads as a set rather than as a
 * collection. The ink is a very dark version of the same hue rather than black:
 * it keeps the tile one colour, and at this lightness it clears contrast
 * comfortably.
 */
export function drawnTile(input: { id: string; name: string }): DrawnTile {
  const hue = hueOf(input.id);
  return {
    initials: initialsOf(input.name),
    background: `oklch(0.82 0.09 ${String(hue)})`,
    ink: `oklch(0.32 0.08 ${String(hue)})`,
  };
}
