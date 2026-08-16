// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { describe, expect, it } from 'vitest';

import { newActor, newLoreEntry, newLorebook } from '../factories.js';
import type { EmbeddedMedia } from './common.js';
import type { Lorebook } from './lorebook.js';
import { validate } from './registry.js';

/**
 * Images on lore — docs/design/13-schemas.md §5.1, reasoning in
 * [02 §3.6](docs/design/02-data-model.md).
 *
 * [19 §P1.7](docs/design/19-p1-implementation.md) says lore media is
 * schema-only at P1 and that *"P1.1's round-trip tests are the whole of their
 * coverage"*. That sentence is what this file exists to make true: every other
 * fixture in the suite round-trips an empty `media: []`, which would leave the
 * guarantee asserted and unchecked.
 *
 * What is deliberately **not** tested here is that media does not activate.
 * That is a property of the assembler, which does not exist until P2 — the rule
 * lives as a warning on the field for now, and the test that enforces it belongs
 * with the code that could break it.
 */

function media(overrides: Partial<EmbeddedMedia> = {}): EmbeddedMedia {
  return {
    id: '0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b',
    role: 'map',
    mime: 'image/png',
    digest: 'sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    bytes: 40_912,
    ref: 'assets/maps/rain-city.png',
    tags: ['aerial', 'winter', 'by Mireille'],
    ...overrides,
  };
}

/** A book with pictures on it and on one of its entries. */
function illustratedLorebook(): Lorebook {
  const cover = media({ label: 'Rain City, from the harbour' });
  const entry = newLoreEntry('The Docks');

  return {
    ...newLorebook('Rain City'),
    media: [cover],
    primaryMediaId: cover.id,
    assets: [{ path: 'assets/maps/rain-city-4k.png', role: 'map', label: 'Print resolution' }],
    entries: [
      {
        ...entry,
        keys: ['docks', 'harbour'],
        content: 'Cranes, containers, and the smell of diesel.',
        media: [
          media({
            id: '0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5c',
            role: 'reference',
            ref: 'assets/docks.png',
            tags: ['night'],
          }),
        ],
      },
    ],
  };
}

describe('a lorebook carrying images', () => {
  it('validates with media on the book and on an entry', () => {
    const result = validate(illustratedLorebook());
    expect(result.valid ? [] : result.issues).toEqual([]);
  });

  it('round-trips through JSON unchanged', () => {
    // The whole of the coverage doc 19 promises. If a field is dropped by the
    // codec or the schema, it shows up here as a diff rather than as silence.
    const book = illustratedLorebook();
    const roundTripped: unknown = JSON.parse(JSON.stringify(book));

    expect(roundTripped).toEqual(book);
    expect(validate(roundTripped).valid).toBe(true);
  });

  it('preserves unknown fields alongside populated media', () => {
    const book = illustratedLorebook();
    const fromTheFuture = {
      ...book,
      media: [{ ...book.media[0]!, focalPoint: { x: 0.5, y: 0.3 } }],
    };

    expect(validate(fromTheFuture)).toEqual({ valid: true });
  });

  it('accepts a primaryMediaId that points at nothing', () => {
    // Not cross-validated, on purpose, and `Openings` sets the precedent. A
    // dangling id degrades to "no cover picture" rather than to an error —
    // dangling references are normal here ([00 §3.3](docs/design/00-stance.md)).
    const book = { ...illustratedLorebook(), primaryMediaId: 'nothing-by-this-id' };
    expect(validate(book).valid).toBe(true);
  });

  it('accepts a book with no pictures at all', () => {
    const bare = newLorebook('Rain City');
    expect(bare.media).toEqual([]);
    expect(bare.primaryMediaId).toBeNull();
    expect(validate(bare).valid).toBe(true);
  });
});

describe('MediaRole is a closed union', () => {
  it('accepts map — the one role lore needed', () => {
    // A diagram is genuinely not a likeness, which is the whole argument for
    // adding it rather than filing maps under `gallery`.
    const book = { ...newLorebook('Rain City'), media: [media({ role: 'map' })] };
    expect(validate(book).valid).toBe(true);
  });

  it('rejects a role nobody defined', () => {
    // Guards the union against quietly becoming a string. `illustration` is the
    // specific value to test with: it was considered and rejected as a synonym
    // for `reference`, so it is the one someone will reach for by instinct.
    const book = {
      ...newLorebook('Rain City'),
      media: [{ ...media(), role: 'illustration' }],
    };

    const result = validate(book);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.issues.some((issue) => issue.path.includes('/media/0/role'))).toBe(true);
    }
  });

  it('keeps one vocabulary across kinds — reference means the same on an actor', () => {
    // The reason lore did not get a vocabulary of its own: rendition
    // conditioning ([11 §3](docs/design/11-roadmap.md)) has to be able to treat
    // a location's reference image the way it treats an actor's.
    const actor = { ...newActor('Vera Solano'), media: [media({ role: 'reference' })] };
    expect(validate(actor).valid).toBe(true);
  });
});

describe('EmbeddedMedia.tags', () => {
  it('is required, not optional', () => {
    // The one decision here that is easy to soften later by accident, and
    // required-vs-optional is invisible until somebody's data depends on it.
    // An absent list and an empty one would mean the same thing, and offering
    // both spellings of "none" is how writers and readers drift apart.
    const withoutTags: Record<string, unknown> = { ...media() };
    delete withoutTags['tags'];
    const book = { ...newLorebook('Rain City'), media: [withoutTags] };

    const result = validate(book);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.issues.some((issue) => issue.message.includes('tags'))).toBe(true);
    }
  });

  it('carries notation no role vocabulary should try to hold', () => {
    const book = {
      ...newLorebook('Rain City'),
      media: [media({ tags: ['winter', 'aerial', 'before the fire'] })],
    };
    expect(validate(book).valid).toBe(true);
  });

  it('applies to every kind that carries media, not only lore', () => {
    // Applied to EmbeddedMedia generally: an actor gallery wants "scar visible"
    // for the same reasons a lore gallery wants "winter".
    const actor = { ...newActor('Vera Solano'), media: [media({ role: 'gallery', tags: [] })] };
    expect(validate(actor).valid).toBe(true);
  });
});
