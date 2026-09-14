// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { beforeEach, describe, expect, it } from 'vitest';

import { BUILT_IN_MODE_PACKAGES, installBuiltIns, loadModes } from './mode-loader.js';
import { DEFAULT_MODE_ID, modeById, planFor, registeredModes } from './mode-registry.js';
import { schemaFailure } from './sessions/channel-schema.js';
import {
  channelDefinition,
  registeredChannels,
  SE_CLOCK,
  SE_LORE_TIMING,
} from './sessions/channels.js';

/**
 * **The seam the move created, which nothing else in the suite crosses** —
 * [P7.0](../../../docs/design/workplan/23-p7-implementation.md).
 *
 * Every other test here is on one side of the boundary or the other.
 * `mode-registry.test.ts` invents a mode so it can assert the container without
 * naming a real one; `packages/modes/scene`'s own tests assert what Scene
 * declares and cannot see the engine at all. Between them sits a run-time
 * module resolution that **no compiler checks**: `mode-loader.ts` holds a bare
 * specifier in a variable, reads a key off whatever comes back, and the whole
 * arrangement is opaque to `tsc` on purpose ([20 §10](../../../docs/design/20-tech-stack.md)
 * — a built-in mode consumes the SDK exactly as a third party would, so the
 * engine has no compile-time knowledge of it to check).
 *
 * **What that costs is a class of failures that used to be build errors and are
 * now startup errors**, and this file is what converts them back into a red
 * suite. Each of these was impossible before the move and is now one edit away:
 *
 * - the mode package is not resolvable from the server — a missing root
 *   dependency, a `pnpm deploy` that copied the server and not the mode;
 * - the entry export is renamed, or stops being an array;
 * - `DEFAULT_MODE_ID` and Scene's `SCENE_ID` drift apart, which used to be a
 *   type error and is now two string literals in two packages;
 * - `SE_CLOCK` and the id Scene declares drift apart, same reason.
 *
 * **Nothing here imports `@storyengine/mode-scene`**, and that is the discipline
 * rather than an oversight: this is a server test, the boundary graph forbids
 * the import, and a test that reached for the mode to check the loader found the
 * mode would be proving the wrong thing anyway. Everything below goes through
 * the registry, by id.
 */
describe('loading the built-in modes', () => {
  beforeEach(async () => {
    await installBuiltIns();
  });

  it('finds and registers the packages it ships', async () => {
    // **The one that catches a deploy that forgot the mode.** `loadModes` is
    // called directly rather than through `installBuiltIns` so the failure, if
    // there is one, names the specifier rather than arriving as "no modes are
    // registered" three frames up.
    for (const specifier of BUILT_IN_MODE_PACKAGES) {
      const loaded = await loadModes(specifier);
      expect(loaded.length, specifier).toBeGreaterThan(0);
    }
    expect(registeredModes().length).toBeGreaterThanOrEqual(BUILT_IN_MODE_PACKAGES.length);
  });

  it('registers the mode the default names, which is what pins two literals together', () => {
    // `DEFAULT_MODE_ID` is a literal in `mode-registry.ts` and `SCENE_ID` is a
    // literal in a package the engine may not import. Before the move a shared
    // constant held them together; now this does, and it needs no import in
    // either direction — the registry is the meeting place.
    const mode = modeById(DEFAULT_MODE_ID);

    expect(mode, `the default mode ${DEFAULT_MODE_ID} did not load`).not.toBeNull();
    expect(mode?.definition.id).toBe(DEFAULT_MODE_ID);
  });

  it('builds a runnable plan for the default mode, over the real package', () => {
    // **Was `scene/mode.test.ts`'s, and it could not stay there**: `planFor` is
    // engine code. It is worth more here anyway — this asserts that what the
    // *loader* produced can run, which is the composition the move put at risk,
    // rather than that an object imported three lines above matches itself.
    const mode = modeById(DEFAULT_MODE_ID);
    if (!mode) throw new Error(`${DEFAULT_MODE_ID} is not registered`);

    const plan = planFor(mode);

    expect(plan.steps).toHaveLength(mode.definition.steps.length);
    expect(plan.steps.map((step) => step.definition.id)).toEqual(
      mode.definition.steps.map((step) => step.id),
    );
  });

  it('installs the clock from the mode that owns it, under the id the engine uses', () => {
    // **The other pair of literals.** `SE_CLOCK` lives here because the engine
    // advances the clock after the step loop and has to name it; the definition
    // lives in Scene because Scene owns it. Nothing makes the two agree except
    // this line — and the failure if they stop agreeing is silent in the worst
    // way: effect application would refuse a clock effect for an unknown
    // channel, on every turn, in a build that started cleanly.
    const clock = channelDefinition(SE_CLOCK);

    expect(clock, `no channel is registered for ${SE_CLOCK}`).not.toBeNull();
    expect(clock?.owner).toBe(DEFAULT_MODE_ID);
  });

  it('installs the channels no mode can own, which is why the loader does more than load', () => {
    // `se.lore.timing` is owned by `storyengine.lore`, a package rather than a
    // mode ([06 §4.1]), so there is no mode for it to arrive with and the loader
    // registers it directly. A loader that only loaded would leave lore timing
    // unresolvable and every lore-bearing turn refusing its own bookkeeping.
    expect(channelDefinition(SE_LORE_TIMING)?.owner).toBe('storyengine.lore');
  });

  it('installs idempotently, so asking twice is asking once', async () => {
    // `beforeEach` has already installed once. Module resolution is cached and
    // registration is keyed by id, so the second pass must be a no-op rather
    // than a second copy — which is what lets a test ask without knowing
    // whether something already did.
    const before = registeredModes();

    await installBuiltIns();

    expect(registeredModes()).toEqual(before);
  });
});

describe('a mode package that is not one', () => {
  /**
   * **Every throw names the specifier, and that is the whole design.** What goes
   * wrong here is a packaging fact — a module that did not resolve, a deploy
   * step that did not copy it, an entry export renamed — and the person reading
   * the failure is an operator with a log line, not a developer with a debugger.
   *
   * These are asserted on the messages rather than only on "it throws", because
   * the message *is* the feature: an unnamed throw from a dynamic import is the
   * failure mode this file exists to prevent.
   */
  it('says so when the specifier does not resolve', async () => {
    await expect(loadModes('@storyengine/mode-that-is-not-installed')).rejects.toThrow(
      /@storyengine\/mode-that-is-not-installed could not be loaded/,
    );
  });

  it('says so when the module resolves and exports no modes', async () => {
    // A real module with no `modes` key — the engine's own entry will do, and
    // using a real one rather than a stub keeps this honest about what "resolved
    // but wrong" looks like.
    await expect(loadModes('node:path')).rejects.toThrow(/does not export a 'modes' array/);
  });
});

/**
 * ***Every channel's declared starting value has to satisfy its own schema*** —
 * [P7.5], and a property written because two shipped channels did not.
 *
 * `se.hook` declared `init: { kind: 'literal', value: null }` beside
 * `schema: { type: 'string', enum: [...] }`, which meant **the state every hook
 * starts in could never be written again**: `acceptEffect` validates a proposal
 * against the schema, so putting a lapsed commitment back in the pool was
 * refused against the channel's own idea of what it starts as. `se.party` had
 * the identical bug and the identical consequence — *absent is not in the party*
 * in its docstring, and a proposal of `null` refused — which nothing had noticed
 * because [P7.3] shipped the reader and the declaration and the control that
 * removes somebody is [P7.9]'s.
 *
 * **Two channels, one shape, neither author noticing**: `init` and `schema` are
 * a dozen lines apart in one object literal and each reads correctly on its own.
 * That is what a property is for.
 *
 * *Here rather than in `channels.test.ts`, and the reason is the registry being
 * a module global*: that file registers deliberately-invalid fixtures to test
 * refusals, so a loop over the registry there sees whatever an earlier test left
 * behind. This file's subject is exactly what `installBuiltIns` puts in it.
 */
describe('a channel can start where it says it starts', () => {
  beforeEach(async () => {
    await installBuiltIns();
  });

  it('holds for every channel the built-ins register', () => {
    const declared = registeredChannels();
    // Not vacuous: a build that registered nothing would pass a loop over it.
    expect(declared.length).toBeGreaterThan(0);

    for (const definition of declared) {
      // The `authored` arm is checked through its `fallback`, which is the value
      // an unauthored session actually gets ([04 §6.1b]).
      const starts =
        definition.init.kind === 'literal' ? definition.init.value : definition.init.fallback;
      expect(
        schemaFailure(definition, starts),
        `${definition.id} cannot be written its own initial value`,
      ).toBeNull();
    }
  });
});
