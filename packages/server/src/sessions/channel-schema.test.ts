// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { beforeEach, describe, expect, it } from 'vitest';

import { schemaFailure } from './channel-schema.js';
import { channelDefinition, registerChannel, SE_CLOCK, SE_LORE_TIMING } from './channels.js';
import { installBuiltIns } from '../mode-loader.js';

/**
 * A channel's schema, held to — [06 §4.2], [22 §1.2], [P7.1].
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
    expect(schemaFailure(channelDefinition(SE_CLOCK), { day: 1, hour: 8, minute: 0 })).toBeNull();
    expect(
      schemaFailure(channelDefinition(SE_CLOCK), { day: 912, hour: 23, minute: 59 }),
    ).toBeNull();
  });

  it('catches the hour a hand edit can write and `advance` cannot', () => {
    // **The value this schema exists for.** `advance` carries minutes into hours
    // and days, so 25 is not reachable through the engine — it is reachable
    // through `session.json`, which [03 §8.1] makes a supported way to get data
    // in. The bound is where "normalised" stops being a convention.
    const failure = schemaFailure(channelDefinition(SE_CLOCK), { day: 1, hour: 25, minute: 0 });

    expect(failure).not.toBeNull();
    expect(failure?.issues.join(' ')).toContain('/hour');
  });

  it('catches a missing member and a wrong type, which are different mistakes', () => {
    expect(
      schemaFailure(channelDefinition(SE_CLOCK), { day: 1, hour: 8 })?.issues.join(' '),
    ).toContain('minute');
    expect(
      schemaFailure(channelDefinition(SE_CLOCK), { day: 1, hour: '8', minute: 0 }),
    ).not.toBeNull();
    // Not an object at all — what a truncated or half-typed edit leaves behind.
    expect(schemaFailure(channelDefinition(SE_CLOCK), 'morning')).not.toBeNull();
    expect(schemaFailure(channelDefinition(SE_CLOCK), null)).not.toBeNull();
  });

  it('floors lore timing at zero, which is the value that would never expire', () => {
    // `timingOf` already refuses a non-object; what it cannot refuse is an
    // object with the right keys and impossible values. `sticky: -3` reads as a
    // number like any other and makes an entry eligible forever.
    expect(
      schemaFailure(channelDefinition(SE_LORE_TIMING), { sticky: 0, cooldown: 0, fired: 0 }),
    ).toBeNull();
    expect(
      schemaFailure(channelDefinition(SE_LORE_TIMING), { sticky: -3, cooldown: 0, fired: 0 }),
    ).not.toBeNull();
  });

  it('says nothing about a channel nobody declared', () => {
    // Same posture as `refuse`'s unknown-channel branch and [00 §3.3]'s rule: an
    // unknown channel is not this function's to refuse, and answering "invalid"
    // for it would turn an uninstalled mode into a wall of rejected effects.
    expect(schemaFailure(channelDefinition('example.nobody'), { anything: true })).toBeNull();
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

    expect(schemaFailure(channelDefinition('example.broken'), { anything: true })).toBeNull();
  });

  it('recompiles when a channel is re-registered, version bumped or not', () => {
    // **The cache is keyed by the definition object**, and this test is why.
    // It was keyed by `id@version` on the reasoning that a schema change *ought*
    // to carry a bump — true, and [06 §4.2]'s mechanism — but a cache is the
    // wrong place to enforce an authoring rule: an author who forgets the bump
    // got stale validation for the life of the process, silently. A route test
    // registering a stricter schema at the same version is what found it.
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
    expect(schemaFailure(channelDefinition('example.versioned'), { n: 'one' })).not.toBeNull();

    // The bumped case, which the string key handled.
    registerChannel({ ...strict, version: 2, schema: { type: 'object' } });
    expect(schemaFailure(channelDefinition('example.versioned'), { n: 'one' })).toBeNull();

    // **And the unbumped one, which it did not.** Same id, same version, a
    // different schema — a new object, so a new validator.
    registerChannel({ ...strict, version: 2 });
    expect(schemaFailure(channelDefinition('example.versioned'), { n: 'one' })).not.toBeNull();
  });
});
