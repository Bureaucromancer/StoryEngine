// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The registry as a thing you write to — [P7.0](../../../docs/design/workplan/23-p7-implementation.md).
 *
 * **Loaded fresh per test, which is the only way to see an empty one.** The map
 * is a module global, so every other test in the suite has already put Scene in
 * it by the time this file runs; `resetModules` plus a dynamic import is what
 * lets the *unregistered* state be asserted at all. That state is not
 * hypothetical — it is what a build has between starting and calling
 * `installBuiltIns`, and after the move it is what a build has if the
 * loader fails to find the mode package.
 *
 * The mode's own registry assertions stay in `scene/mode.test.ts`, where they
 * can name Scene. These are about the container.
 */
describe('the mode registry', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  async function freshRegistry(): Promise<typeof import('./mode-registry.js')> {
    return import('./mode-registry.js');
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

  it('installs a mode’s declared channels, which is what the declaration is for', async () => {
    // **The inversion [P7.0] had to make, and the reason is the boundary.** A
    // mode cannot import a value from the engine once it is a package, so a
    // channel it declares has to arrive *with* it or not at all. Before this,
    // `ModeDefinition.channels` documented what a mode used and enabled
    // nothing — effect application resolved a definition from a frozen record
    // beside the engine.
    const registry = await freshRegistry();
    const channels = await import('./sessions/channels.js');
    const mode = fakeMode('example.quiet');
    const declared = {
      id: 'example.mood',
      owner: 'example.quiet',
      version: 1,
      scope: 'session',
      update: 'model-proposed',
      visibility: 'player',
      budget: null,
      schema: { type: 'object' },
      init: { kind: 'literal', value: null },
    } as const;

    expect(channels.channelDefinition('example.mood')).toBeNull();

    registry.registerMode({
      ...mode,
      definition: { ...mode.definition, channels: [declared] },
    });

    // The very object the mode declared, not a copy: the mode is where the
    // definition comes from now.
    expect(channels.channelDefinition('example.mood')).toBe(declared);
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

  it('names the mode chats are imported into apart from the default', async () => {
    // [P13.8]: the same string today, for a different reason — the default is
    // a fallback and this is a mapping. Two constants, so that moving the
    // default does not quietly move every imported chat with it.
    const registry = await freshRegistry();

    expect(registry.CHAT_IMPORT_MODE_ID).toBe('storyengine.scene');
  });

  it('refuses to serve a build that cannot play what a chat imports into', async () => {
    // Every mode below can run, and the build still cannot take the one
    // import a SillyTavern user arrives with: each chat would be written into
    // a mode nothing registered, and would open under the default with a
    // logged substitution. Said at startup instead.
    const registry = await freshRegistry();
    registry.registerMode(fakeMode('example.quiet'));

    expect(() => {
      registry.assertModesRunnable();
    }).toThrow(/Chats are imported into storyengine\.scene/);
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

function fakeMode(id: string): import('@storyengine/sdk').Mode {
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
        defaultPreset: {} as import('@storyengine/sdk').ModeDefinition['assembly']['defaultPreset'],
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

/**
 * ***What a mode put where*** — [06 §9]'s fifth bullet, [P7.11].
 *
 * `surfaces` was a compile-time-required, runtime-unchecked, wire-transmitted
 * field that **nothing read**. These are the assertions that make it mean
 * something, and the two that matter are about what is *skipped*: the
 * composition must narrow to the session's mode and to channels that mode may
 * see, because the registry is process-wide and a session is not.
 */
describe('a mode’s contributed surfaces', () => {
  // Loaded fresh per test, for the reason the describe above states: the
  // registry is a module global and every other test in the suite has already
  // put Scene in it.
  beforeEach(() => {
    vi.resetModules();
  });

  async function freshRegistry(): Promise<typeof import('./mode-registry.js')> {
    return import('./mode-registry.js');
  }

  const backdrop = {
    id: 'example.backdrop',
    owner: 'example.quiet',
    version: 1,
    scope: 'session',
    update: 'engine-computed',
    visibility: 'player',
    budget: null,
    schema: { type: ['object', 'null'] },
    init: { kind: 'literal', value: null },
  } as const;

  async function withBackdrop(): Promise<typeof import('./mode-registry.js')> {
    const registry = await freshRegistry();
    const mode = fakeMode('example.quiet');
    registry.registerMode({
      ...mode,
      definition: {
        ...mode.definition,
        channels: [backdrop],
        surfaces: [
          {
            region: 'stage',
            channelId: backdrop.id,
            widget: { kind: 'image', label: 'Behind you' },
          },
        ],
      },
    });
    return registry;
  }

  /**
   * **The server resolves the pointer, down to a URL.** [04 §3] makes
   * `EmbeddedMedia` *"a reference to bytes carried by the container"*; a client
   * that followed one itself would be a second implementation of the manifest
   * living in a browser.
   */
  it('resolves an authored media reference to something a browser can fetch', async () => {
    const registry = await withBackdrop();
    const surfaces = registry.modeSurfaces(
      {
        'example.backdrop': {
          version: 1,
          value: { from: 'authored', kind: 'actors', objectId: 'a-1', mediaId: 'm-1' },
        },
      },
      'example.quiet',
    );

    expect(surfaces).toHaveLength(1);
    expect(surfaces[0]?.image?.url).toBe('/api/library/actors/a-1/media/m-1');
    expect(surfaces[0]?.region).toBe('stage');
  });

  /**
   * ***`null` for the rendition arm is not a gap*** — nothing generates a
   * picture until [P9], and the arm exists so the channel's schema does not have
   * to change under live sessions when something does ([06 §10.1a]).
   */
  it('shows nothing for a generated backdrop, because nothing generates one yet', async () => {
    const registry = await withBackdrop();
    const surfaces = registry.modeSurfaces(
      { 'example.backdrop': { version: 1, value: { from: 'rendition', renditionId: 'r-1' } } },
      'example.quiet',
    );

    expect(surfaces).toEqual([]);
  });

  /**
   * ***Nothing when there is nothing***, which for the stage is a requirement:
   * [10 §2.3] — *"with the backdrop off Play is the surface it was before, not a
   * surface with an empty frame in it."*
   */
  it('shows nothing at all when the channel is unset', async () => {
    const registry = await withBackdrop();
    expect(registry.modeSurfaces({}, 'example.quiet')).toEqual([]);
  });

  /**
   * ***A contribution belongs to the session playing that mode*** — the same
   * rule `channelInPlay` enforces for the HUD and the channel write route, and
   * the defect that was invisible until a second mode declared anything.
   */
  it('contributes nothing to a session playing something else', async () => {
    const registry = await withBackdrop();
    const surfaces = registry.modeSurfaces(
      {
        'example.backdrop': {
          version: 1,
          value: { from: 'authored', kind: 'actors', objectId: 'a-1', mediaId: 'm-1' },
        },
      },
      'example.loud',
    );

    expect(surfaces).toEqual([]);
  });

  /**
   * *A hidden channel has no surface*, whatever a mode declares — `visibility`
   * governs what may be shown and a contribution does not override it. The
   * alternative would make `hidden` mean *unless somebody asks*.
   */
  it('refuses to show a hidden channel', async () => {
    const registry = await freshRegistry();
    const mode = fakeMode('example.quiet');
    registry.registerMode({
      ...mode,
      definition: {
        ...mode.definition,
        channels: [{ ...backdrop, visibility: 'hidden' }],
        surfaces: [
          {
            region: 'stage',
            channelId: backdrop.id,
            widget: { kind: 'image', label: 'Behind you' },
          },
        ],
      },
    });

    const surfaces = registry.modeSurfaces(
      {
        'example.backdrop': {
          version: 1,
          value: { from: 'authored', kind: 'actors', objectId: 'a-1', mediaId: 'm-1' },
        },
      },
      'example.quiet',
    );

    expect(surfaces).toEqual([]);
  });
});
