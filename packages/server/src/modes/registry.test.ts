// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The registry as a thing you write to — [P7.0](../../../../docs/design/workplan/23-p7-implementation.md).
 *
 * **Loaded fresh per test, which is the only way to see an empty one.** The map
 * is a module global, so every other test in the suite has already put Scene in
 * it by the time this file runs; `resetModules` plus a dynamic import is what
 * lets the *unregistered* state be asserted at all. That state is not
 * hypothetical — it is what a build has between starting and calling
 * `installBuiltInModes`, and after the move it is what a build has if the
 * loader fails to find the mode package.
 *
 * The mode's own registry assertions stay in `scene/mode.test.ts`, where they
 * can name Scene. These are about the container.
 */
describe('the mode registry', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  async function freshRegistry(): Promise<typeof import('./registry.js')> {
    return import('./registry.js');
  }

  it('knows nothing until something registers a mode', async () => {
    const registry = await freshRegistry();

    expect(registry.modeById('storyengine.scene')).toBeNull();
    expect(registry.registeredModes()).toHaveLength(0);
  });

  it('refuses to serve a build that registered nothing', async () => {
    // **The failure the split makes possible, so it is the one it has to
    // catch.** While registration was a static import this could not happen;
    // now it can — a loader that finds no mode package, or a composition root
    // that forgets the call — and a server with no modes cannot take a turn.
    // Finding that out at startup beats finding it out when somebody presses
    // Send.
    const registry = await freshRegistry();

    expect(() => {
      registry.assertModesRunnable();
    }).toThrow(/No modes are registered/);
  });

  it('hands back what was registered, by id', async () => {
    const registry = await freshRegistry();
    const mode = fakeMode('example.quiet');

    registry.registerMode(mode);

    expect(registry.modeById('example.quiet')).toBe(mode);
    expect(registry.registeredModes()).toEqual([mode]);
  });

  it('lets a later registration of one id win', async () => {
    // The honest rule for a loader: an install shipping two copies of one mode
    // id has a configuration problem, and refusing at startup would take the
    // server down over it.
    const registry = await freshRegistry();
    const first = fakeMode('example.quiet');
    const second = fakeMode('example.quiet');

    registry.registerMode(first);
    registry.registerMode(second);

    expect(registry.modeById('example.quiet')).toBe(second);
    expect(registry.registeredModes()).toHaveLength(1);
  });

  it('still proves every registered mode can run', async () => {
    const registry = await freshRegistry();
    registry.registerMode({
      definition: { ...fakeMode('example.broken').definition, steps: [step('example.missing')] },
      run: {},
    });

    expect(() => {
      registry.assertModesRunnable();
    }).toThrow(/no implementation/);
  });

  it('names a default that is an id rather than an import', async () => {
    // The server may not import a mode once the mode is a package, so the
    // default is a literal. `scene/mode.test.ts` pins it to Scene's own
    // constant, which is the check that keeps a literal honest.
    const registry = await freshRegistry();

    expect(registry.DEFAULT_MODE_ID).toBe('storyengine.scene');
    // And it is emphatically not resolvable on its own — naming a default does
    // not register one, which is the distinction that made the guard above
    // necessary.
    expect(registry.modeById(registry.DEFAULT_MODE_ID)).toBeNull();
  });
});

function step(id: string): import('@storyengine/sdk').StepDefinition {
  return {
    id,
    stage: 'generate',
    reads: [],
    writes: [],
    contributes: 'messages',
    callKind: 'narrate',
    when: { when: 'cadence', everyNTurns: 1 },
    failure: 'abort',
    role: 'prose',
  };
}

function fakeMode(id: string): import('./types.js').Mode {
  const narrate = step(`${id}.narrate`);
  return {
    definition: {
      id,
      version: '1.0.0',
      displayName: id,
      voice: 'narrator',
      dispatch: 'merged',
      presets: [],
      participants: { select: 'fixed', maxActors: 1 },
      assembly: {
        defaultPreset: {} as import('./types.js').ModeDefinition['assembly']['defaultPreset'],
        historyWindow: 20,
      },
      steps: [narrate],
      channels: [],
      inputs: ['do'],
      surfaces: [],
      setup: { kind: 'none' },
    },
    run: { [narrate.id]: () => Promise.resolve({}) },
  };
}
