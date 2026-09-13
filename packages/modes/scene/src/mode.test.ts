// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { describe, expect, it } from 'vitest';

import { validate } from '@storyengine/sdk';

import { modes } from './index.js';
import {
  BACKDROP_CHANNEL,
  CLOCK_CHANNEL,
  EXPRESSION_CHANNEL,
  LOCATION_CHANNEL,
  NARRATE,
  SCENE,
  SCENE_ID,
  SCENE_MODE,
  STAGING_CHANNEL,
} from './mode.js';
import { STAGE_STEP } from './staging.js';
import { SCENE_PRESET } from './preset.js';

/**
 * Scene, held to what it claims — [06 §2], [P2 §2.4].
 *
 * Two of these matter more than the rest. **The preset is a real portable
 * object**, validated by the same validator a user's write goes through — which
 * is what caught `SlotSource` missing the `guidance` arm that [06 §5.1] requires
 * a preset to be able to position. And **the mode is data**: a manifest with a
 * function on it would be the back door §2 says means the contract is wrong.
 *
 * **Four assertions left this file at [P7.0] and none of them was lost.** They
 * reached into the engine — `callPurposeFor`, `channelDefinition`, `planFor`,
 * `installBuiltIns` — and a mode package may not, which is the boundary doing
 * its job rather than an inconvenience to route around. Each was really an
 * assertion about the *engine's* treatment of a declaration, so each moved to
 * where the engine is: the generic half to `mode-registry.test.ts`, the
 * Scene-specific half to `mode-loader.test.ts`, which names Scene by id and
 * imports nothing from here. What is left is the half that was always about
 * Scene — what it declares, and whether the preset it ships is a real object.
 *
 * *`validate` arrives through `@storyengine/sdk` rather than from
 * `@storyengine/shared` directly. Both are permitted by the boundary graph; one
 * is permitted by the package manifest, which lists a single dependency because
 * that is the claim 19 §10 makes about a built-in mode.*
 */

describe('the manifest is data', () => {
  it('survives a round trip through JSON with nothing lost', () => {
    // The P7 relocation is a move rather than a rewrite exactly to the extent
    // this holds: anything that did not survive here is something that cannot
    // cross a worker boundary.
    expect(JSON.parse(JSON.stringify(SCENE))).toEqual(SCENE);
  });

  it('carries no function on any field', () => {
    // `collect()` on an AssemblyPlan is the specific back door [06 §5] rules
    // out — it would also mean the collector P4 needs for imported presets is a
    // second implementation of the same thing.
    const walk = (value: unknown, path: string): void => {
      expect(typeof value, `${path} is a function`).not.toBe('function');
      if (Array.isArray(value)) {
        value.forEach((item, i) => {
          walk(item, `${path}[${String(i)}]`);
        });
      }
      if (!Array.isArray(value) && value !== null && typeof value === 'object') {
        for (const [key, child] of Object.entries(value)) walk(child, `${path}.${key}`);
      }
    };
    walk(SCENE, 'SCENE');
  });

  it('keeps what it runs separate from what it declares', () => {
    // [22 §3]'s split: `definition` crosses any boundary unchanged, `run` is
    // what becomes a dispatch table.
    expect(Object.keys(SCENE_MODE.run)).toEqual([NARRATE.id, STAGE_STEP.id]);
    expect(SCENE_MODE.definition).toBe(SCENE);
  });
});

describe('the default preset is a real portable object', () => {
  it('validates through the shared registry', () => {
    // Not "looks like a preset" — the actual validator, the actual schema.
    const result = validate(SCENE_PRESET);
    expect(result.valid, JSON.stringify(result.valid ? [] : result.issues)).toBe(true);
  });

  it('positions the guidance block, which is the whole point of the slot', () => {
    // [06 §5.1] says the guidance block is positioned by the preset. Until the
    // `SlotSource` fix this line could not be written: the schema had no
    // `guidance` arm, so this preset would not have validated above.
    const guidance = SCENE_PRESET.blocks.find(
      (block) => block.kind === 'slot' && block.source.of === 'guidance',
    );
    expect(guidance).toBeDefined();
    // Advisory in the pack as well as forced by the collector — an author
    // reading the preset should see the claim, not just inherit it.
    expect(guidance?.advisory).toBe(true);
  });

  it('positions the previous attempt after the guidance, advisory, and ranked below it', () => {
    // [06 §5.1]'s second advisory slot, the one a guided redo fills. Three
    // claims, each with its own falsifying mutation.
    const blocks = SCENE_PRESET.blocks;
    const at = (of: string): number =>
      blocks.findIndex((block) => block.kind === 'slot' && block.source.of === of);
    const attempt = blocks[at('attempt')];
    expect(attempt?.kind).toBe('slot');
    if (attempt?.kind !== 'slot') return;

    // Advisory in the pack, as guidance is, so an author sees the claim.
    expect(attempt.advisory).toBe(true);
    expect(attempt.omitWhenEmpty).toBe(true);
    expect(attempt.role).toBe('system');

    // **A wrapper, and one that frames.** Bare, the slot is a system message
    // holding prose the model itself wrote, with nothing to say it is a
    // discarded draft — dropping the wrapper is the mutation this catches.
    expect(attempt.wrapper).toContain('{{content}}');
    expect(attempt.wrapper?.replace('{{content}}', '').trim().length).toBeGreaterThan(0);

    // **Directly after the guidance.** `render` merges adjacent same-role
    // blocks and the guidance slot has no wrapper, so the other order would
    // hand a provider the instruction as the last line of the attempt's prose.
    expect(at('attempt')).toBe(at('guidance') + 1);

    // **Below the instruction in the order of sacrifice**, as a relationship
    // rather than a number: a squeezed redo drops the reply it is discarding
    // before the instruction about it.
    const priorityOf = (of: string): number | undefined => blocks[at(of)]?.priority;
    expect(priorityOf('attempt')).toBeLessThan(priorityOf('guidance') ?? 0);
  });

  it('positions the player action, and nothing else is a user-role block', () => {
    const user = SCENE_PRESET.blocks.filter((block) => block.role === 'user');
    expect(user).toHaveLength(1);
    expect(user[0]?.kind === 'slot' && user[0].source.of).toBe('input');
  });

  it('is deterministic, so a golden snapshot over it means something', () => {
    // `newPreset()` would mint a fresh uuid and stamp `now()` per process.
    expect(SCENE_PRESET.id).toBe('0199c000-0000-7000-8000-00000000e5e7');
    expect(SCENE_PRESET.provenance.createdAt).toBe(SCENE_PRESET.provenance.updatedAt);
  });

  it('ranks writing samples above history and below lore', () => {
    // [04 §3.1]. The constant is the whole behaviour of the feature under
    // pressure, and it is not self-evident: history is emitted at
    // `priority + index` across the window, so this preset's history spans
    // 10..29 rather than sitting at its declared 10. A sample at 20 therefore
    // outlives the oldest turns and dies before the newest, and before lore.
    //
    // Asserted as a *relationship* rather than a bare 20, so re-tuning the
    // scale stays free and only changing the order of sacrifice trips it.
    const priorityOf = (of: string): number | undefined =>
      SCENE_PRESET.blocks.find((block) => block.kind === 'slot' && block.source.of === of)
        ?.priority;

    const samples = priorityOf('samples');
    expect(samples).toBeDefined();
    expect(samples).toBeGreaterThan(priorityOf('history') ?? 0);
    expect(samples).toBeLessThan(priorityOf('lore') ?? 0);
  });

  it('namespaces every block id', () => {
    // F18's reservation, applied where the first `se.*` ids in a shipped
    // artefact appear.
    for (const block of SCENE_PRESET.blocks) expect(block.id.startsWith('se.')).toBe(true);
  });

  /**
   * **Lore has two phases and this preset had one slot** — [P5 §0.5]'s second
   * live defect, fixed at [P6B.1].
   *
   * `placementOf` maps SillyTavern's `after_char` to `{ at: 'after' }` and
   * `collect.ts` fills an `after` placement only from an `after` slot, so with
   * one `before` slot every such entry activated, was charged against its
   * book's `tokenBudget` and `entryLimit`, matched nothing, and vanished —
   * with the lore report still counting it kept. **ST positions 1, 2, 3, 5 and
   * 6 all import as `after_char`**, so the first imported book lost most of its
   * entries after they had spent the budget, and a hand-made book never showed
   * it because `newLoreEntry` defaults to `before_char`.
   *
   * Asserted over the shipped preset because that is the artefact that was
   * wrong: the collector's phase routing already had a test, and the routing
   * was never the bug.
   */
  it('positions both lore phases, so an imported entry has somewhere to land', () => {
    const phases = SCENE_PRESET.blocks
      .filter((block) => block.kind === 'slot' && block.source.of === 'lore')
      .map((block) => (block.kind === 'slot' && block.source.of === 'lore' ? block.source : null))
      // An outlet slot takes its outlet, not the ordinary entries of its phase.
      .filter((source) => source !== null && (source.outlet ?? '') === '')
      .map((source) => source?.phase);

    expect(phases).toContain('before');
    expect(phases).toContain('after');
  });
});

describe('what Scene declares, and what the engine does with it', () => {
  it('makes its one step a prose call, which is what admits guidance', () => {
    // **The pair, not the verdict.** `callPurposeFor` is engine code and lives
    // on the other side of the boundary, so what this file can pin is the input
    // it reads: `contributes: 'messages'` with an empty `writes` is what yields
    // `prose` and admits the guidance block. One `writes` entry here would turn
    // every guidance-carrying turn into an `AdvisoryLeakError` abort — [06 §5.2]
    // working as designed, and worth pinning before somebody adds a channel to
    // the step.
    //
    // That the pair *means* prose is the engine's claim and the engine asserts
    // it, over its own fixture, in `test-mode.test.ts`. Splitting it this way is
    // what the boundary is for: neither half restates the other's business.
    expect(NARRATE.contributes).toBe('messages');
    expect(NARRATE.writes).toEqual([]);
  });

  it('declares its five channels, and owns every one of them', () => {
    // **Was "registering the mode is what enables it", asserted through the
    // engine's channel lookup** — which this package can no longer reach, and
    // should not: that a registered mode's declared channels become resolvable
    // is a property of `registerMode`, true of every mode, and it is asserted
    // once in `mode-registry.test.ts` over a mode invented for the purpose.
    //
    // What is Scene's own is the declaration: one channel, this id, this owner.
    // The two literals — `se.clock` here, `SE_CLOCK` in `sessions/channels.ts` —
    // are pinned to each other by `mode-loader.test.ts`, which loads the
    // built-ins and looks the engine's constant up. Neither side imports the
    // other, which is why that check can exist at all.
    expect(SCENE.channels).toEqual([
      CLOCK_CHANNEL,
      BACKDROP_CHANNEL,
      STAGING_CHANNEL,
      EXPRESSION_CHANNEL,
      LOCATION_CHANNEL,
    ]);
    expect(CLOCK_CHANNEL.id).toBe('se.clock');
    // [06 §7.2]'s background channel, declared at [P7.9]. The id is a literal
    // here for the reason `se.clock`'s is — nothing in the engine names it yet,
    // and [P9] will name it from the other side.
    expect(BACKDROP_CHANNEL.id).toBe('se.backdrop');
    // The three [P7.12] added, which are the rest of §7.2's sentence.
    expect(STAGING_CHANNEL.id).toBe('se.staging');
    expect(EXPRESSION_CHANNEL.id).toBe('se.expression');
    expect(LOCATION_CHANNEL.id).toBe('se.location');
    for (const channel of SCENE.channels) expect(channel.owner).toBe(SCENE_ID);
  });

  /**
   * ***§7.2's three things have three different writers***, and asserting it is
   * how the section stops reading like it forces [25 C16].
   *
   * A background's pointer is the engine's and [P9] writes it; an expression and
   * a location are judgements about prose and a step writes them; text-only is a
   * person's setting. **`model-proposed` on the two the stager writes is the
   * whole of why no policy had to change** — `refuse()` has no branch for it, so
   * a step may propose one and the effect carries the call it was judged in.
   */
  it('gives each of the three a writer the policy actually admits', () => {
    // A person turns staging on; a model deciding to spend somebody's GPU would
    // be the narrator deciding to spend somebody's GPU.
    expect(STAGING_CHANNEL.update).toBe('user-only');
    expect(STAGING_CHANNEL.init).toEqual({ kind: 'literal', value: false });
    // Judgements about the prose, which is what a model is for — and what makes
    // `se.scene.stage` a step that can write rather than one that is refused.
    expect(EXPRESSION_CHANNEL.update).toBe('model-proposed');
    expect(LOCATION_CHANNEL.update).toBe('model-proposed');
  });

  /**
   * *A face is shown and a place is said*, which is the whole of why one of
   * these two carries a `render` and the other does not — `se.presence`'s
   * argument, applied to the channel that most looks like it wants a line of
   * prose and least needs one.
   */
  it('injects the place and never the face', () => {
    expect(EXPRESSION_CHANNEL.render).toBeUndefined();
    expect(EXPRESSION_CHANNEL.budget).toBeNull();
    expect(LOCATION_CHANNEL.render).toContain('{{ value }}');
    expect(LOCATION_CHANNEL.budget).toBeGreaterThan(0);
  });

  /**
   * **Actor-scoped, because a scene has several people in it.** A session-scoped
   * expression channel would hold one face for everybody, which is not a smaller
   * feature but a wrong one — and `scopeKey` is what the stager sets per actor.
   */
  it('scopes a face to the person wearing it', () => {
    expect(EXPRESSION_CHANNEL.scope).toBe('actor');
    expect(LOCATION_CHANNEL.scope).toBe('session');
    expect(STAGING_CHANNEL.scope).toBe('session');
  });

  /**
   * ***The backdrop channel's value must be able to name a generated image from
   * the declaration onward*** — [06 §10.1a], and the obligation is to [P9]
   * rather than to this stage: *"narrowing it to a filename now means changing a
   * channel's schema under live sessions later to admit the generated case."*
   * **This is the assertion that would catch somebody narrowing it**, and it is
   * written now because the arm it protects has no writer until P9 and so no
   * other test can fail when it goes.
   */
  it('can hold a generated backdrop before anything generates one', () => {
    // The third arm is `{ type: 'null' }` — *nothing showing*, which is how
    // text-only stays first-class — so the tags come off the arms that have one.
    const arms =
      (BACKDROP_CHANNEL.schema as { oneOf?: { properties?: Record<string, unknown> }[] }).oneOf ??
      [];
    const froms = arms.map(
      (arm) => (arm.properties?.['from'] as { const?: string } | undefined)?.const,
    );

    expect(froms).toContain('authored');
    expect(froms).toContain('rendition');
    // Text-only is first-class: nothing showing is a state, not an absence.
    expect(BACKDROP_CHANNEL.init).toEqual({ kind: 'literal', value: null });
  });

  /**
   * *A person may pick one; a model and a step may not.* `engine-computed`
   * refuses `model` and `step` and admits `user`, which is exactly the set this
   * channel wants — and [P9]'s generator writes it through the engine rather
   * than out of its own step, which is the route the hook firing and the goal
   * achievement both take.
   */
  it('is not a thing the narrator decides', () => {
    expect(BACKDROP_CHANNEL.update).toBe('engine-computed');
  });

  it('ships its empty fields empty, and its one-armed fields at one arm', () => {
    // ~~[P2 §5]'s erosion line, as an assertion: a second step or a participant
    // policy belongs to P7, and this is what notices one arriving early.~~
    // **[P7] is where they arrive**, so two of these moved and the rest did not:
    // the line was never *stay at one* but *do not grow before the contract is
    // tested by two modes*. `presets`, `setup`, `participants` and `inputs` are
    // still what §5 left them.
    expect(SCENE.presets).toEqual([]);
    expect(SCENE.setup).toEqual({ kind: 'none' });
    expect(SCENE.participants).toEqual({ select: 'fixed', maxActors: 1 });
    expect(SCENE.inputs).toEqual(['do']);
  });

  /**
   * ***Where a scene shows up*** — [06 §9]'s fifth bullet, declared at [P7.12].
   *
   * **Three regions, one per kind of thing**, and the assertion worth having is
   * that each contribution names a channel this mode actually declares. A
   * surface pointing at somebody else's channel is what `channelInPlay` refuses
   * on the server; catching it here is catching it at the declaration.
   */
  it('contributes three surfaces, each over a channel it owns', () => {
    const owned = new Set(SCENE.channels.map((channel) => channel.id));
    expect(SCENE.surfaces.map((one) => one.region)).toEqual(['stage', 'message', 'panel']);
    for (const contribution of SCENE.surfaces) {
      expect(owned.has(contribution.channelId)).toBe(true);
      // Authored content travelling with the mode, like a preset's prose — so a
      // blank one would be a picture nobody not looking at it can find.
      expect(contribution.widget.label.length).toBeGreaterThan(0);
    }
  });

  /**
   * *The toggle is the one that shows with staging off*, which is what makes a
   * default of **off** honest rather than the feature hiding: [10 §2.3] wants no
   * empty frame, and a control you cannot find is a feature that does not exist.
   */
  it('puts the switch in the panel and the pictures elsewhere', () => {
    const byChannel = new Map(SCENE.surfaces.map((one) => [one.channelId, one]));
    expect(byChannel.get('se.staging')?.widget.kind).toBe('toggle');
    expect(byChannel.get('se.backdrop')?.widget.kind).toBe('image');
    expect(byChannel.get('se.expression')?.widget.kind).toBe('image');
    // `se.location` declares `surface` on the channel, which is the shorthand
    // for the HUD case — restating it here would contribute it twice.
    expect(byChannel.has('se.location')).toBe(false);
    expect(LOCATION_CHANNEL.surface).toEqual({ kind: 'text', label: 'Place' });
  });

  /**
   * **Two steps, and every one of them implemented** — the property
   * `assertModesRunnable` proves for the whole build at startup, asserted here
   * for this mode because a step declared with no implementation is a mode that
   * cannot take a turn.
   */
  it('implements every step it declares', () => {
    expect(SCENE.steps.map((step) => step.id)).toEqual(['se.narrate', 'se.scene.stage']);
    for (const step of SCENE.steps) expect(typeof SCENE_MODE.run[step.id]).toBe('function');
    // `generate` before `post`: the stager reads what the narrator wrote.
    expect(SCENE.steps.map((step) => step.stage)).toEqual(['generate', 'post']);
  });

  it('says narrator and merged, and the instruction block agrees', () => {
    // `voice` and `dispatch` have no engine consumer at P2.6, so what keeps
    // them from being decoration is that the prose they describe is checkable.
    expect(SCENE.voice).toBe('narrator');
    expect(SCENE.dispatch).toBe('merged');

    const instruction = SCENE_PRESET.blocks.find((block) => block.kind === 'text');
    const text = instruction?.kind === 'text' ? instruction.template : '';
    // narrator: it describes rather than speaks as anybody.
    expect(text).toContain('narrator');
    // merged: one reply, so it must not be told to answer as one actor.
    expect(text).not.toContain('in character');
  });
});

describe('what the package hands a host', () => {
  /**
   * **The entry contract, and it is the one thing here nothing else can check.**
   *
   * `mode-loader.ts` resolves this package by a bare specifier held in a
   * variable and reads `modes` off the namespace by name. It cannot import the
   * type — that is the boundary — so it validates the shape at runtime and
   * throws naming the specifier. Which means a rename of this export is a
   * *startup* failure in the server rather than a compile failure anywhere, and
   * this is the side of the boundary that can still catch it cheaply.
   */
  it('exports the modes it ships, under the key the host reads', () => {
    expect(modes).toEqual([SCENE_MODE]);
  });

  it('ships exactly one, so the array is a shape rather than a plan', () => {
    // [22 §6]'s manifest says `modes` and means a list; Scene is one mode and is
    // expected to stay one. A second arriving here is a design change, not a
    // refactor, and this is where it announces itself.
    expect(modes).toHaveLength(1);
  });
});
