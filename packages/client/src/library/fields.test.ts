// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { ACTOR_SCHEMA, LOREBOOK_SCHEMA, newActor } from '@storyengine/shared';
import { describe, expect, it } from 'vitest';

import { LIBRARY_KINDS } from '../api.js';
import {
  editorRouteFor,
  fieldsOf,
  kindHasEditor,
  labelFor,
  newObjectFor,
  objectFieldsOf,
  schemaFor,
} from './fields.js';

/**
 * The description half of [polish §1] — *one description of a kind's fields* —
 * tested where it is pure, which is nearly all of it.
 *
 * **The assertions that matter are the ones about where the list comes from**,
 * because the item's whole claim is that it comes from the schema rather than
 * from a hand-written table. So: declaration order rather than alphabetical or
 * the value's; a field the value has not got still listed; and a key the value
 * has that the schema does not, *not* listed. Each of those goes red under a
 * different plausible shortcut.
 */

describe('labels come from the field name, by a rule rather than a table', () => {
  it('splits the camel case the schemas are written in', () => {
    expect(labelFor('matchWholeWords')).toBe('Match whole words');
    expect(labelFor('secondaryKeys')).toBe('Secondary keys');
    expect(labelFor('useRegex')).toBe('Use regex');
    expect(labelFor('maxRecursionDepth')).toBe('Max recursion depth');
  });

  it('leaves a one-word name alone but for its first letter', () => {
    expect(labelFor('name')).toBe('Name');
    expect(labelFor('content')).toBe('Content');
  });

  it('separates a trailing number, which is where a run-on reads worst', () => {
    expect(labelFor('rgba8')).toBe('Rgba 8');
  });
});

describe('the field list is the schema, read at runtime', () => {
  it('is in the schema’s declaration order, not the value’s and not alphabetical', () => {
    const keys = objectFieldsOf(ACTOR_SCHEMA, newActor('Vera')).map((row) => row.key);

    expect(keys.slice(0, 5)).toEqual(['name', 'aliases', 'pronouns', 'roles', 'tags']);
    // Alphabetical would put `aliases` first and `provenance` before `roles`.
    expect(keys).not.toEqual([...keys].sort());
  });

  it('lists a field the object does not carry, so an unset one can be seen', () => {
    const withoutSamples: Record<string, unknown> = { ...newActor('Vera') };
    delete withoutSamples['writingSamples'];

    const keys = objectFieldsOf(ACTOR_SCHEMA, withoutSamples).map((row) => row.key);

    expect(keys).toContain('writingSamples');
  });

  /**
   * The other half of the same rule, and the one a *"just walk the value"*
   * implementation would get wrong. Unknown keys belong to *As stored*
   * ([polish §2]) — the view whose stated job is showing fields this build has
   * no rendering for.
   */
  it('does not list a key the object carries and the schema does not declare', () => {
    const hand = { ...newActor('Vera'), somethingAHandEditAdded: 'x' };

    const keys = objectFieldsOf(ACTOR_SCHEMA, hand).map((row) => row.key);

    expect(keys).not.toContain('somethingAHandEditAdded');
  });

  it('drops only what the page states verbatim a few lines higher', () => {
    const keys = objectFieldsOf(ACTOR_SCHEMA, newActor('Vera')).map((row) => row.key);

    expect(keys).not.toContain('schema');
    expect(keys).not.toContain('id');
    // Provenance is *not* dropped: the page shows two of its seven fields, and
    // creator, version and licence have no other home on it.
    expect(keys).toContain('provenance');
  });

  it('carries the declared shape down, so a nested value knows its own fields', () => {
    const profile = objectFieldsOf(ACTOR_SCHEMA, newActor('Vera')).find(
      (row) => row.key === 'profile',
    );

    expect(fieldsOf(profile?.schema, {}).map((row) => row.key)).toEqual([
      'visual',
      'traits',
      'sections',
    ]);
  });

  /**
   * A record declares no properties, so its keys are its content and the file's
   * order is the only order there is. `metadata`, `modeData` and `compat` are
   * all this shape, and all three are where an import puts what it could not
   * name.
   */
  it('falls back to the value’s own keys where the schema declares none', () => {
    const rows = fieldsOf(undefined, { second: 2, first: 1 });

    expect(rows.map((row) => row.key)).toEqual(['second', 'first']);
    expect(rows.map((row) => row.label)).toEqual(['Second', 'First']);
  });

  /**
   * An unknown kind is not an error ([04 §2]): a world may carry one a newer
   * build wrote. With no schema to be the authority on what belongs, the
   * object's own keys are the only description there is — the record case, and
   * a strictly better page than the metadata block alone.
   */
  it('reads an unknown kind by its own keys rather than refusing it', () => {
    expect(schemaFor(LOREBOOK_SCHEMA)).toBeDefined();
    expect(schemaFor('storyengine.something-newer/9')).toBeUndefined();

    const rows = objectFieldsOf('storyengine.something-newer/9', {
      schema: 'storyengine.something-newer/9',
      id: 'x',
      whatever: 1,
    });

    expect(rows.map((row) => row.key)).toEqual(['whatever']);
  });
});

describe('which kinds have an editor, asked in one place', () => {
  it('answers for the two kinds that have one, each at its own address', () => {
    expect(kindHasEditor('actors')).toBe(true);
    expect(editorRouteFor('actors')).toBe('/library/actors/$id/edit');
    expect(kindHasEditor('lorebooks')).toBe(true);
    expect(editorRouteFor('lorebooks')).toBe('/library/lorebooks/$id/edit');
  });

  /**
   * The condition and the address are one lookup on purpose: they used to be
   * two literals in one JSX branch, so widening the condition alone would have
   * pointed a lorebook at the actor editor. P5.1 is the widening that would
   * have done it, which is why the second address is asserted above rather than
   * only the second `true`.
   */
  it('answers for the four that do not, address included', () => {
    for (const kind of ['treatments', 'setups', 'presets', 'worlds'] as const) {
      expect(kindHasEditor(kind)).toBe(false);
      expect(editorRouteFor(kind)).toBeNull();
    }
  });

  /**
   * [10 §5]'s rule — *create arrives with the kind's editor and never before
   * it* — as an assertion over the whole key set rather than over the two rows
   * somebody remembered. The tables are typed to make the mismatch a
   * compile error; this is the same claim where a reader can see it.
   */
  it('offers a way to make one for exactly the kinds that can be edited', () => {
    for (const kind of LIBRARY_KINDS) {
      expect(newObjectFor(kind) !== null).toBe(kindHasEditor(kind));
    }
  });

  /**
   * Through the shared factory, so a lorebook made in the browser carries the
   * same defaults as one made with `curl` — the argument `newActor`'s call site
   * has made since P1.5, now with a second kind able to break it.
   */
  it('makes a new one through the factory rather than a literal', () => {
    const made = newObjectFor('lorebooks')?.make('Ardent');
    expect(made?.['schema']).toBe(LOREBOOK_SCHEMA);
    expect(made?.['name']).toBe('Ardent');
    expect(made?.['scanDepth']).toBe(2);
    expect(made?.['entries']).toEqual([]);
  });
});
