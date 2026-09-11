// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { beforeEach, describe, expect, it } from 'vitest';

import { schemaFailure } from './channel-schema.js';
import { registerChannel, SE_CLOCK, SE_LORE_TIMING } from './channels.js';
import { installBuiltIns } from '../mode-loader.js';

/**
 * A channel's schema, held to — [06 §4.2], [21 §1.2], [P7.1].
 *
 * `ChannelDefinition.schema` arrived one commit ago with no reader; this is the
 * reader, and the assertions are mostly about *which* values the shipped
 * channels' schemas actually catch. A schema nobody has tried a wrong value
 * against is a schema that type-checks.
 */
describe('a value against the channel that declares it', () => {
  beforeEach(async () => {
    await installBuiltIns();
  });

  it('passes a clock the engine would produce', () => {
    expect(schemaFailure(SE_CLOCK, { day: 1, hour: 8, minute: 0 })).toBeNull();
    expect(schemaFailure(SE_CLOCK, { day: 912, hour: 23, minute: 59 })).toBeNull();
  });

  it('catches the hour a hand edit can write and `advance` cannot', () => {
    // **The value this schema exists for.** `advance` carries minutes into hours
    // and days, so 25 is not reachable through the engine — it is reachable
    // through `session.json`, which [03 §8.1] makes a supported way to get data
    // in. The bound is where "normalised" stops being a convention.
    const failure = schemaFailure(SE_CLOCK, { day: 1, hour: 25, minute: 0 });

    expect(failure).not.toBeNull();
    expect(failure?.issues.join(' ')).toContain('/hour');
  });

  it('catches a missing member and a wrong type, which are different mistakes', () => {
    expect(schemaFailure(SE_CLOCK, { day: 1, hour: 8 })?.issues.join(' ')).toContain('minute');
    expect(schemaFailure(SE_CLOCK, { day: 1, hour: '8', minute: 0 })).not.toBeNull();
    // Not an object at all — what a truncated or half-typed edit leaves behind.
    expect(schemaFailure(SE_CLOCK, 'morning')).not.toBeNull();
    expect(schemaFailure(SE_CLOCK, null)).not.toBeNull();
  });

  it('floors lore timing at zero, which is the value that would never expire', () => {
    // `timingOf` already refuses a non-object; what it cannot refuse is an
    // object with the right keys and impossible values. `sticky: -3` reads as a
    // number like any other and makes an entry eligible forever.
    expect(schemaFailure(SE_LORE_TIMING, { sticky: 0, cooldown: 0, fired: 0 })).toBeNull();
    expect(schemaFailure(SE_LORE_TIMING, { sticky: -3, cooldown: 0, fired: 0 })).not.toBeNull();
  });

  it('says nothing about a channel nobody declared', () => {
    // Same posture as `refuse`'s unknown-channel branch and [00 §3.3]'s rule: an
    // unknown channel is not this function's to refuse, and answering "invalid"
    // for it would turn an uninstalled mode into a wall of rejected effects.
    expect(schemaFailure('example.nobody', { anything: true })).toBeNull();
  });

  it('treats a schema that will not compile as unconstrained, not as a wall', () => {
    // **A broken declaration is the author's mistake and the player's problem**,
    // so the two get opposite treatment: refusing every value would take the
    // channel out of service over something the person playing cannot fix.
    registerChannel({
      id: 'example.broken',
      owner: 'example.quiet',
      version: 1,
      scope: 'session',
      update: 'model-proposed',
      visibility: 'player',
      budget: null,
      // `type` takes a string or an array of them, never a number.
      schema: { type: 7 },
      init: { kind: 'literal', value: null },
    });

    expect(schemaFailure('example.broken', { anything: true })).toBeNull();
  });

  it('recompiles when a channel is re-registered at a new version', () => {
    // **The cache is keyed by id *and* version**, because `registerChannel` is
    // last-write-wins: a reload can replace a definition in place, and a cache
    // keyed on id alone would go on validating new values against the old shape
    // — silently, which is the failure hardest to see from outside.
    const strict = {
      id: 'example.versioned',
      owner: 'example.quiet',
      version: 1,
      scope: 'session',
      update: 'model-proposed',
      visibility: 'player',
      budget: null,
      schema: { type: 'object', properties: { n: { type: 'integer' } }, required: ['n'] },
      init: { kind: 'literal', value: { n: 0 } },
    } as const;

    registerChannel(strict);
    expect(schemaFailure('example.versioned', { n: 'one' })).not.toBeNull();

    registerChannel({ ...strict, version: 2, schema: { type: 'object' } });
    expect(schemaFailure('example.versioned', { n: 'one' })).toBeNull();
  });
});
