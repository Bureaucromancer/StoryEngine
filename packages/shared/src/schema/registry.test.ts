// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { describe, expect, it } from 'vitest';

import {
  newActor,
  newLorebook,
  newPackage,
  newPreset,
  newSetting,
  newSetup,
} from '../factories.js';
import { ACTOR_SCHEMA } from './actor.js';
import { PACKAGE_SCHEMA } from './package.js';
import {
  createValidator,
  isKnownSchema,
  isTimestamp,
  LIBRARY_DIRECTORIES,
  PORTABLE_SCHEMAS,
  schemaIdOf,
  validate,
} from './registry.js';

/**
 * One minimal instance of every kind — **all six** (F18).
 *
 * Package was missing, which made "a minimal instance of every kind validates"
 * a claim about five of them. It is the kind least like the others and so the
 * most worth including: a container whose contents are open by design, and the
 * one whose round trip has never been exercised.
 */
const library = {
  actor: newActor('Vera Solano'),
  lorebook: newLorebook('Rain City'),
  setting: newSetting('Rain City, noir'),
  setup: newSetup('The Fixer’s Debt'),
  preset: newPreset('House style'),
  package: newPackage('The Rain City bundle'),
};

describe('the registry', () => {
  it('validates a minimal instance of every library kind', () => {
    for (const [kind, object] of Object.entries(library)) {
      const result = validate(object);
      // Report which kind failed and why, rather than a bare false.
      expect(result.valid ? [] : result.issues, kind).toEqual([]);
    }
  });

  it('covers every portable kind, so a container never enumerates them', () => {
    // The registry is the mechanism behind "every portable object
    // self-describes, so containers never enumerate kinds"
    // ([work plan §2](../../../../docs/design/workplan/01-work-plan.md)). If a kind is added to the design
    // and not here, a Package would carry it as unrecognised.
    expect(Object.keys(PORTABLE_SCHEMAS).sort()).toEqual(
      [
        'storyengine.actor/1',
        'storyengine.lorebook/1',
        'storyengine.package/1',
        'storyengine.preset/0',
        'storyengine.setting/1',
        'storyengine.setup/1',
      ].sort(),
    );
  });

  it('gives every portable kind a library directory', () => {
    // [02 §5.1](../../../../docs/design/02-data-model.md) lists all six under
    // users/<handle>/library/, `packages/` included. A kind added to the
    // registry without a directory would have nowhere to be written.
    expect(Object.keys(LIBRARY_DIRECTORIES).sort()).toEqual(Object.keys(PORTABLE_SCHEMAS).sort());
    expect(LIBRARY_DIRECTORIES[PACKAGE_SCHEMA]).toBe('packages');
  });

  it('reads the schema id off a self-describing object', () => {
    expect(schemaIdOf(library.actor)).toBe(ACTOR_SCHEMA);
    expect(schemaIdOf({})).toBeNull();
    expect(schemaIdOf(null)).toBeNull();
    expect(schemaIdOf('actor')).toBeNull();
    expect(schemaIdOf({ schema: 7 })).toBeNull();
  });

  it('rejects an object that is not self-describing at all', () => {
    const result = validate({ name: 'nameless' });
    expect(result.valid).toBe(false);
  });

  it('catches a genuinely malformed object', () => {
    const broken = { ...library.actor, aliases: 'not an array' };
    const result = validate(broken);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.issues.some((issue) => issue.path === '/aliases')).toBe(true);
    }
  });

  it('accepts a kind it has never heard of rather than rejecting it', () => {
    // A Package may legitimately contain a kind this build does not know —
    // Campaign, at 2.0. Rejecting it is the stranding §2 forbids: the object
    // must survive a round trip through an older reader.
    expect(isKnownSchema('storyengine.campaign/1')).toBe(false);
    expect(validate({ schema: 'storyengine.campaign/1', id: 'x', anything: true })).toEqual({
      valid: true,
    });
  });
});

describe('unknown-field preservation (docs/design/10-schemas.md §2)', () => {
  it('accepts fields the schema does not declare', () => {
    // "A file written by a newer version must survive a round trip through an
    // older one." A /1 reader meeting a field added in /2 must not reject it.
    const fromTheFuture = {
      ...library.actor,
      somethingAddedLater: { nested: ['value'] },
    };
    expect(validate(fromTheFuture)).toEqual({ valid: true });
  });

  it('does not strip them — the trap, and it is a one-line setting', () => {
    // Ajv's `removeAdditional` mutates the object it validates. This is the
    // failure that strands people, and it is invisible until someone downgrades:
    // load a card written by a newer build, save it, and the newer build's data
    // is gone with no error anywhere.
    const object: Record<string, unknown> = {
      ...library.actor,
      somethingAddedLater: 'still here',
    };

    validate(object);
    expect(object['somethingAddedLater']).toBe('still here');
  });

  it('does not materialise defaults, so absent stays absent', () => {
    // `useDefaults` would turn an omitted optional into a present one, and §2
    // makes deliberate meaning of the difference between null and absent.
    const validator = createValidator().compile(PORTABLE_SCHEMAS[ACTOR_SCHEMA]);
    const object: Record<string, unknown> = { ...library.actor };
    delete object['compat'];

    validator(object);
    expect(Object.hasOwn(object, 'compat')).toBe(false);
  });

  it('round-trips every kind through JSON unchanged, unknown fields included', () => {
    for (const [kind, object] of Object.entries(library)) {
      const decorated = { ...object, futureField: { deep: [1, 2, 3] } };
      const roundTripped: unknown = JSON.parse(JSON.stringify(decorated));

      expect(roundTripped, kind).toEqual(decorated);
      expect(validate(roundTripped).valid, kind).toBe(true);
    }
  });
});

describe('timestamps', () => {
  it('accepts RFC 3339 and rejects prose', () => {
    expect(isTimestamp('2026-08-13T12:00:00.000Z')).toBe(true);
    expect(isTimestamp('2026-08-13T12:00:00+01:00')).toBe(true);
    expect(isTimestamp('yesterday')).toBe(false);
    expect(isTimestamp('2026-08-13')).toBe(false);
    // Never epoch milliseconds ([10 §3](../../../../docs/design/10-schemas.md)).
    expect(isTimestamp('1786622400000')).toBe(false);
  });

  it('is enforced on provenance, not merely documented', () => {
    const object = {
      ...library.actor,
      provenance: { ...library.actor.provenance, createdAt: 'yesterday' },
    };
    expect(validate(object).valid).toBe(false);
  });
});

describe('the reserved `se.` namespace', () => {
  // Reserved since P1.0 and enforced nowhere until P2.4 (F18) — the stage where
  // the first `se.*` ids appear in anger. A reservation nothing checks is one
  // that gets discovered by a card that already violates it.
  it('refuses an author-defined section in it', () => {
    const actor = newActor('Vera Solano') as unknown as {
      profile: { sections: { id: string; title: string; body: string; disposition: string }[] };
    };
    actor.profile.sections.push({
      id: 'se.mine',
      title: 'Mine',
      body: '',
      disposition: 'always',
    });

    const result = validate(actor);
    expect(result.valid).toBe(false);
    expect(result.valid ? [] : result.issues[0]?.message).toContain('reserved');
  });

  it('permits the four conventional ids, which are themselves `se.*`', () => {
    // The rule is a namespace reservation, not a ban: the engine's own ids live
    // in it, and `newActor` creates all four.
    expect(validate(newActor('Vera Solano')).valid).toBe(true);
  });

  it('leaves an author-defined section outside the namespace alone', () => {
    const actor = newActor('Vera Solano') as unknown as {
      profile: { sections: { id: string; title: string; body: string; disposition: string }[] };
    };
    actor.profile.sections.push({
      id: 'combat-notes',
      title: 'Combat notes',
      body: '',
      disposition: 'always',
    });

    expect(validate(actor).valid).toBe(true);
  });
});
