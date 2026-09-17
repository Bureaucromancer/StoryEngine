// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { describe, expect, it } from 'vitest';

import {
  LOREBOOK_SCHEMA,
  PACKAGE_SCHEMA,
  SETUP_SCHEMA,
  TREATMENT_SCHEMA,
} from '@storyengine/shared';

import { referencesIn } from './links.js';

/**
 * ***What counts as a reference*** —
 * [03 §10.1](../../../../docs/design/03-data-model.md),
 * [10 §5.2](../../../../docs/design/10-ui-surfaces.md),
 * [P11.7](../../../../docs/design/workplan/28-p11-implementation.md).
 *
 * The stage's proof obligation is *"an object referenced by a session, a
 * treatment and a package reports **three**"* — a claim [03 §10.1] makes and
 * one a panel showing *Used by* would otherwise assert only by looking right.
 * The counting is `usedBy`'s and the deciding is here, which is where a wrong
 * answer would come from: **a reference is a link somebody authored, not a
 * mention.**
 */

describe('what an object points at', () => {
  it('reads a setup’s treatment, preset, cast and lore', () => {
    const found = referencesIn(SETUP_SCHEMA, {
      id: 'setup-1',
      treatment: { id: 'treatment-1', name: 'Rain' },
      preset: { id: 'preset-1', name: 'Default' },
      cast: {
        personaOptions: [{ id: 'actor-you', name: 'You' }],
        partyDefault: [{ id: 'actor-vera' }],
        narrator: null,
      },
      lore: [{ ref: { id: 'book-1', name: 'Harbour' }, required: true }],
    });
    expect(new Set(found)).toEqual(
      new Set(['treatment-1', 'preset-1', 'actor-you', 'actor-vera', 'book-1']),
    );
  });

  /**
   * ***Both shapes, because the corpus has both.*** `Setup.treatment` is a
   * `Ref` and a session's `cast.actors` is an array of bare ids; a reader that
   * took only one would silently count half the references, which is worse than
   * counting none because the number still looks like an answer.
   */
  it('reads a bare id as readily as a Ref', () => {
    const found = referencesIn(SETUP_SCHEMA, {
      id: 'setup-1',
      cast: { personaOptions: ['actor-you'], partyDefault: ['actor-vera'], narrator: null },
    });
    expect(new Set(found)).toEqual(new Set(['actor-you', 'actor-vera']));
  });

  it('reads a treatment’s lore and cast', () => {
    const found = referencesIn(TREATMENT_SCHEMA, {
      id: 'treatment-1',
      lore: [{ ref: { id: 'book-1' } }],
      cast: [{ ref: { id: 'actor-vera' } }],
    });
    expect(new Set(found)).toEqual(new Set(['book-1', 'actor-vera']));
  });

  it('reads a package’s contents', () => {
    const found = referencesIn(PACKAGE_SCHEMA, {
      id: 'package-1',
      contents: [{ id: 'actor-vera' }, { id: 'book-1' }],
    });
    expect(new Set(found)).toEqual(new Set(['actor-vera', 'book-1']));
  });

  /**
   * ***A lorebook's entries are inside it, not pointed at by it.*** This is the
   * kind where a generic walk over every `{ id, name }`-shaped value looks most
   * principled and is most wrong: it would produce a table where a book
   * references its own three hundred entries, and *Used by* would answer with
   * the book's own contents.
   */
  it('finds nothing in a lorebook, because its entries are its own', () => {
    expect(
      referencesIn(LOREBOOK_SCHEMA, {
        id: 'book-1',
        entries: [{ id: 'entry-1', name: 'The keeper' }],
        folders: [{ id: 'folder-1', name: 'The docks' }],
      }),
    ).toEqual([]);
  });

  it('reports each target once, however many fields name it', () => {
    const found = referencesIn(SETUP_SCHEMA, {
      id: 'setup-1',
      cast: {
        personaOptions: [{ id: 'actor-vera' }],
        partyDefault: [{ id: 'actor-vera' }],
        narrator: null,
      },
    });
    expect(found).toEqual(['actor-vera']);
  });

  it('answers empty for a kind that points at nothing and for a malformed one', () => {
    expect(referencesIn(SETUP_SCHEMA, null)).toEqual([]);
    expect(referencesIn(SETUP_SCHEMA, { id: 'setup-1', lore: 'not an array' })).toEqual([]);
  });
});
