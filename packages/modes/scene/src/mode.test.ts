// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { describe, expect, it } from 'vitest';

import { validate } from '@storyengine/sdk';
import type { StepCallRequest, StepCallResult, StepHost, StepInput } from '@storyengine/sdk';

import { modes } from './index.js';
import {
  BACKDROP_CHANNEL,
  BACKDROP_ON_CHANNEL,
  CLOCK_CHANNEL,
  EXPRESSION_CHANNEL,
  LOCATION_CHANNEL,
  NARRATE,
  SCENE,
  SCENE_ID,
  SCENE_MODE,
  STAGING_CHANNEL,
} from './mode.js';
import { ECHO_CHANNELS, ECHO_STEP } from './echo.js';
import { EDIT_CHANNELS, EDIT_STEP } from './edit.js';
import { PLOT_CHANNELS, PLOT_STEP } from './plot.js';
import { STAGE_STEP } from './staging.js';
import { TRACK_STEP, TRACKING_CHANNELS } from './tracking.js';
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
    expect(Object.keys(SCENE_MODE.run)).toEqual([
      PLOT_STEP.id,
      NARRATE.id,
      STAGE_STEP.id,
      TRACK_STEP.id,
      EDIT_STEP.id,
      ECHO_STEP.id,
    ]);
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

  /**
   * ~~*Nothing else is a user-role block*~~ — *and the card's post-history
   * instructions* since [P13.3], which [P13 §1.5] places *"after the last
   * message, user role"*. They follow the input in sequence, so they are the
   * last thing a speaking call sends.
   */
  it('positions the player action, and after it only the card’s post-history instructions', () => {
    const user = SCENE_PRESET.blocks.filter((block) => block.role === 'user');
    // The established state is a user block too since [P13.5a], and it sits in
    // the history — before the move, not after it — so the claim holds.
    expect(user.map((block) => block.id)).toEqual(['se.state', 'se.input', 'se.card.post-history']);
    expect(user[0]?.placement).toEqual({ at: 'in-history', fromEnd: 0 });
    expect(user[1]?.kind === 'slot' && user[1].source.of).toBe('input');
    const ids = SCENE_PRESET.blocks.map((block) => block.id);
    expect(ids.at(-1)).toBe('se.card.post-history');
  });

  /**
   * ***The narrator's instruction is a narration's*** (2026-09-27). It applied
   * to every kind of call, and an impersonation asks for exactly what it
   * forbids — the player's own words.
   *
   * ***Keyed to the voice since [P13.3]***, ~~`['narrate']`~~: `narrate` is the
   * call kind of the embodied reply too. Neither voice is ever set on an
   * impersonation, so the 2026-09-27 narrowing holds.
   */
  it('keeps the narrator instruction to narration, and the embodied one to the chat', () => {
    const appliesTo = (id: string) =>
      SCENE_PRESET.blocks.find((block) => block.id === id)?.appliesTo;
    expect(appliesTo('se.instruction')).toEqual(['narrator']);
    expect(appliesTo('se.instruction.embodied')).toEqual(['embodied']);
    for (const id of ['se.card.system', 'se.card.depth', 'se.card.post-history']) {
      expect(appliesTo(id), id).toEqual(['embodied']);
    }
  });

  /**
   * ***The card's own prompts, placed as [P13 §1.5]'s table says*** — [P13.3].
   * The system prompt directly after the instruction, the depth prompt in the
   * history, the post-history instructions after the move; all three `voiced`,
   * so a per-actor call carries its speaker's and a merged call everyone's.
   */
  it('stacks the card’s system prompt directly after the instruction', () => {
    const ids = SCENE_PRESET.blocks.map((block) => block.id);
    expect(ids.indexOf('se.card.system')).toBe(ids.indexOf('se.instruction.embodied') + 1);
    const card = (id: string) => SCENE_PRESET.blocks.find((block) => block.id === id);
    for (const id of ['se.card.system', 'se.card.depth', 'se.card.post-history']) {
      const block = card(id);
      expect(block?.kind === 'slot' && block.source.of === 'actor' && block.source.scope, id).toBe(
        'voiced',
      );
    }
    expect(card('se.card.depth')?.placement).toEqual({ at: 'in-history', fromEnd: 4 });
    const samples = card('se.samples');
    expect(
      samples?.kind === 'slot' && samples.source.of === 'samples' && samples.source.scope,
    ).toBe('voiced');
  });

  /**
   * ***Whose block is whose*** (2026-09-27). Bare, the persona's and the actor
   * blocks reached the model as bodies with nothing to say who they were
   * about. Each now names its subject, and keeps the one placeholder the
   * content goes in.
   */
  it('names who each persona and actor block is about', () => {
    // The card's own prompts are the card's words, bare, and are not among
    // these ([P13.3]): a wrapper round *"You are Vera"* would be ours.
    const named = SCENE_PRESET.blocks.filter(
      (block) =>
        block.kind === 'slot' &&
        (block.source.of === 'persona' || block.source.of === 'actor') &&
        !block.id.startsWith('se.card.'),
    );

    expect(named.map((block) => block.id)).toEqual([
      'se.persona',
      'se.actor.summary',
      'se.actor.appearance',
      'se.actor.voice',
      'se.actor.traits',
      'se.actor.background',
    ]);
    for (const block of named) {
      if (block.kind !== 'slot') continue;
      const who = block.source.of === 'persona' ? '{{ user }}' : '{{ char }}';
      expect(block.wrapper, block.id).toContain(who);
      expect(block.wrapper, block.id).toContain('{{content}}');
    }
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

  it('declares its channels, and owns every one of them', () => {
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
      BACKDROP_ON_CHANNEL,
      STAGING_CHANNEL,
      EXPRESSION_CHANNEL,
      LOCATION_CHANNEL,
      // The trackers, their switches, locks, hidden fields and cadence —
      // [P13.5a]; `tracking.test.ts` holds them to their own claims.
      ...TRACKING_CHANNELS,
      // The secret plot, its switch, reveal and cadence — [P13.5b], `plot.test.ts`.
      ...PLOT_CHANNELS,
      // The editor's and the echo chamber's — [P13.5c], `edit.test.ts`, `echo.test.ts`.
      ...EDIT_CHANNELS,
      ...ECHO_CHANNELS,
    ]);
    expect(CLOCK_CHANNEL.id).toBe('se.clock');
    // [06 §7.2]'s background channel, declared at [P7.9]. The id is a literal
    // here for the reason `se.clock`'s is — nothing in the engine names it yet,
    // and [P9] will name it from the other side.
    expect(BACKDROP_CHANNEL.id).toBe('se.backdrop');
    /**
     * ***And its switch, declared at [P9.4] — Scene's rather than the
     * engine's.***
     *
     * `se.illustrate` is package-owned because every mode can want a picture of
     * a turn; this one turns on a generator that writes `se.backdrop`, and a
     * mode with no backdrop channel has nowhere to put the result. A
     * package-owned switch would appear in Freeform offering a control with no
     * mechanism behind it — which is the case where *"a control that is on the
     * screen either way"* stops being honest and starts being a lie.
     */
    expect(BACKDROP_ON_CHANNEL.id).toBe('se.backdrop.on');
    expect(BACKDROP_ON_CHANNEL.update).toBe('user-only');
    // Off, like `se.staging` and for its reason: an image is the player's own
    // machine, and the control being visible is what makes the default honest.
    expect(BACKDROP_ON_CHANNEL.init).toEqual({ kind: 'literal', value: false });
    /**
     * ***And neither backdrop channel escapes*** — [P9 §0.3]'s amendment to
     * [P9 §1.7], asserted here because this is where the declaration is.
     *
     * `ChannelDefinition` gained `escapes?: boolean` at [P8.2], and an effect
     * whose channel declares it is written with `scope: 'escaped'` — a scope
     * `applyEffects`, `undoTurn` and `reconstructAlong` all **skip**, because an
     * escaped effect is one a session cannot take back. A backdrop selection
     * declared that way would be correct on the turn it was written and would
     * silently fail to return on rewind, which is the one way [P9]'s *the diff
     * is empty* check can be satisfied and still be wrong.
     */
    expect(BACKDROP_CHANNEL.escapes).toBeUndefined();
    expect(BACKDROP_ON_CHANNEL.escapes).toBeUndefined();
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
    // still what §5 left them. ~~`participants` too~~ — [P13.3] declared Scene's
    // group chat, and the pin on it is the declared-values test below.
    expect(SCENE.presets).toEqual([]);
    expect(SCENE.setup).toEqual({ kind: 'none' });
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
  it('contributes its surfaces, each over a channel it owns', () => {
    const owned = new Set(SCENE.channels.map((channel) => channel.id));
    // The fourth is the backdrop's own switch, added at [P9.4] — beside the
    // staging toggle rather than over the picture, because a control floating
    // on a backdrop is a control competing with the thing it controls. The
    // rest are [P13.5a]'s: six tracker cards in the panel, and six switches
    // and the cadence in settings — then [P13.5b]'s secret plot: its switch and
    // cadence in settings, its reveal and its card in the panel — then
    // [P13.5c]'s editor (five settings) and echo chamber (two settings, a card).
    expect(SCENE.surfaces.map((one) => one.region)).toEqual([
      'stage',
      'message',
      'panel',
      'panel',
      ...Array<string>(6).fill('panel'),
      ...Array<string>(7).fill('settings'),
      'settings',
      'settings',
      'panel',
      'panel',
      ...Array<string>(7).fill('settings'),
      'panel',
    ]);
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
    // [06 §10.6]: two states and not three — *on* means when the place changes,
    // and a backdrop that regenerated every turn is the failure mode rather than
    // the thorough setting.
    expect(byChannel.get('se.backdrop.on')?.widget.kind).toBe('toggle');
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
    expect(SCENE.steps.map((step) => step.id)).toEqual([
      'se.scene.plot',
      'se.narrate',
      'se.scene.edit',
      'se.scene.stage',
      'se.scene.track',
      'se.scene.echo',
    ]);
    for (const step of SCENE.steps) expect(typeof SCENE_MODE.run[step.id]).toBe('function');
    // `pre` first — the secret plot steers this turn's reply — then `generate`
    // before `post`: the editor first of the `post` steps ([P13.5c]), so the
    // stager, the trackers and the echo chamber read the prose as edited.
    expect(SCENE.steps.map((step) => step.stage)).toEqual([
      'pre',
      'generate',
      'post',
      'post',
      'post',
      'post',
    ]);
  });

  /**
   * ~~*Says narrator and merged, and the instruction block agrees*~~ — ***the
   * declared values and the pack agreeing with them***, [P13.3]
   * ([P13 §1.2]: *"Scene's declared values become `embodied`, `per-actor`,
   * `natural`"*). The pin was always the pair, not the values: a declaration the
   * pack contradicts is decoration. So it pins what a new session is created
   * with, and that the pack has an instruction for that voice **and** for the
   * narrated one a person may switch to.
   */
  it('declares an embodied, per-actor, natural chat, and the pack speaks both voices', () => {
    expect(SCENE.voice).toBe('embodied');
    expect(SCENE.dispatch).toBe('per-actor');
    expect(SCENE.participants).toEqual({ select: 'natural', castIsPresent: true, maxActors: 32 });

    const template = (id: string): string => {
      const block = SCENE_PRESET.blocks.find((one) => one.id === id);
      return block?.kind === 'text' ? block.template : '';
    };
    const embodied = template('se.instruction.embodied');
    // Embodied: it names the speaker as the one to write — ST's main prompt in
    // sense (`openai.js:101`) — and in a group says to write only as them
    // (`openai.js:114`), which only a group sees.
    expect(embodied).toContain("Write {{ char }}'s next reply");
    expect(embodied).toContain('{{ charIfNotGroup }}');
    // Only under `per-actor`: a merged reply may voice every member (2026-09-29).
    expect(embodied).toMatch(
      /\{% if charIfNotGroup != char and dispatch == 'per-actor' %\}.*write only as \{\{ char \}\}/,
    );
    // Narrated: it describes rather than speaks as anybody, and is the narrator
    // instruction every earlier session was created with, word for word.
    const narrator = template('se.instruction');
    expect(narrator).toContain('narrator');
    expect(narrator).not.toContain('in character');
    expect(narrator).toBe(
      "You are the narrator of a scene. Write what happens next in third person, past tense. Describe only what the player could perceive. Never write the player's own dialogue, thoughts or decisions, and never end by asking what they do.",
    );
  });

  /**
   * ***A Scene session from before P13.0 reads as what it was played as*** —
   * [P13 §1.2](../../../../docs/design/workplan/30-p13-scene-and-session-import.md),
   * and half of [P13.0]'s *Ends at*.
   *
   * Pinned against literals rather than against `SCENE.voice` and friends, and
   * that is the test: those move when P13 flips Scene's declared values, and
   * this must not move with them, or every Scene session somebody has played
   * would be re-voiced by the flip.
   */
  it('keeps what a pre-P13 session was played as: narrator, merged, fixed', () => {
    expect(SCENE.legacy).toEqual({ voice: 'narrator', dispatch: 'merged', select: 'fixed' });
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

/**
 * ***The pacing dial has words at every setting*** —
 * [06 §6.1](../../../../docs/design/06-modes-and-turn-pipeline.md),
 * [P11.5](../../../../docs/design/workplan/28-p11-implementation.md).
 *
 * §6.1 splits the dial in two — *"Level → cadence, cooldown and patience is
 * engine code; the level's prose is the prompt pack's"* — and for four phases
 * only the engine half existed. **A pack missing a level is the failure that
 * looks like nothing**: `pacingLevel` returns null, the selector omits the
 * block, and the setting silently goes back to meaning only a cadence. There is
 * no screen on which that is visible, which is why it is a test.
 */
describe('the pacing prose this pack ships', () => {
  const ids = (SCENE_PRESET.pacingLevels ?? []).map((level) => level.id);

  it('has a level for every setting the dial offers', () => {
    expect(ids.sort()).toEqual(['aggressive', 'manual-only', 'normal', 'sparse']);
  });

  it('says something at each of them', () => {
    for (const level of SCENE_PRESET.pacingLevels ?? []) {
      expect(level.fragments.length, level.id).toBeGreaterThan(0);
      for (const fragment of level.fragments)
        expect(fragment.text.length, level.id).toBeGreaterThan(20);
    }
  });

  /**
   * ***`aggressive` must not reach railroading***, which is §6.1's own sentence
   * and the one way this prose can do real harm: *"The dial changes how often a
   * hook is **considered**. Guidance stays advisory at every setting and none of
   * them makes the narrator comply — otherwise the top of the dial is not brisk
   * pacing, it is the directedness [§7.3.2] spends a section refusing."*
   *
   * *A word list is a crude check and is the honest one available.* It cannot
   * read prose, so it watches for the vocabulary somebody reaches for when they
   * are writing an instruction rather than a disposition — and it is here
   * because the top of this dial is precisely where a later edit will be
   * tempted.
   */
  it('never tells the narrator to comply, at the top of the dial', () => {
    const brisk = (SCENE_PRESET.pacingLevels ?? []).find((level) => level.id === 'aggressive');
    const text = (brisk?.fragments ?? []).map((fragment) => fragment.text).join(' ');
    expect(text.length).toBeGreaterThan(0);
    for (const word of ['must ', 'always ', 'insist', 'ignore the player', 'regardless']) {
      expect(text.toLowerCase(), word).not.toContain(word);
    }
    // And the refusal it *should* carry: the player is still mid-something.
    expect(text.toLowerCase()).toContain('player');
  });
});

/**
 * ***How the generate step speaks*** — [P13 §1.4](../../../../docs/design/workplan/30-p13-scene-and-session-import.md),
 * [P13.2]. Against a host that records what it was asked, which is all a mode
 * can see of the engine: the loop's order, which member each call named, and
 * what the step returned. What a speaking call *does* — the re-scoped prompt,
 * the round, the cleanup — is the engine's, and `runner-dispatch.test.ts`
 * proves it through a real turn.
 */
describe('the generate step, by voice and dispatch', () => {
  const run = SCENE_MODE.run[NARRATE.id];

  /**
   * A host that records what it was asked. `random` and `signal` are stubbed by
   * omission, for the reason `staging.test.ts` gives at length: the step reads
   * neither, and `AbortSignal` is a host global this package's tsconfig
   * deliberately does not declare.
   */
  function host(): { asked: StepCallRequest[]; host: StepHost } {
    const asked: StepCallRequest[] = [];
    return {
      asked,
      host: {
        call: (request: StepCallRequest): Promise<StepCallResult> => {
          asked.push(request);
          const id = request.speaker;
          return Promise.resolve({
            callId: `c-${String(asked.length)}`,
            text: id === undefined ? 'The rain kept on.' : `"${id} speaks."`,
            usage: null,
            ...(id === undefined ? {} : { speaker: { id, name: id.toUpperCase() } }),
            ...(id === 'vera' ? { original: 'Vera: "vera speaks."' } : {}),
          });
        },
      } as unknown as StepHost,
    };
  }

  const input = (over: Partial<StepInput>): StepInput => ({
    turnId: 't',
    sessionId: 's',
    parentTurnId: null,
    channels: {},
    history: [],
    ...over,
  });

  it('narrates as it always has: one call, no speaker, one message', async () => {
    const { asked, host: stub } = host();
    const result = await run?.(input({ voice: 'narrator', speakers: ['vera', 'lund'] }), stub);
    expect(asked).toEqual([{ stream: true }]);
    expect(result).toEqual({ message: { text: 'The rain kept on.' } });
  });

  it('reads a host that says nothing about voice as a narrator', async () => {
    const { asked, host: stub } = host();
    await run?.(input({ speakers: ['vera'] }), stub);
    expect(asked).toEqual([{ stream: true }]);
  });

  it('speaks once per member, in the selection’s order, under per-actor dispatch', async () => {
    const { asked, host: stub } = host();
    const result = await run?.(
      input({ voice: 'embodied', dispatch: 'per-actor', speakers: ['lund', 'vera', 'marlow'] }),
      stub,
    );
    expect(asked.map((request) => request.speaker)).toEqual(['lund', 'vera', 'marlow']);
    expect(result).toEqual({
      messages: [
        { speaker: { id: 'lund', name: 'LUND' }, text: '"lund speaks."' },
        {
          speaker: { id: 'vera', name: 'VERA' },
          text: '"vera speaks."',
          original: 'Vera: "vera speaks."',
        },
        { speaker: { id: 'marlow', name: 'MARLOW' }, text: '"marlow speaks."' },
      ],
    });
  });

  it('speaks once, for the first member, under merged dispatch', async () => {
    const { asked, host: stub } = host();
    const result = await run?.(
      input({ voice: 'embodied', dispatch: 'merged', speakers: ['lund', 'vera'] }),
      stub,
    );
    expect(asked).toEqual([{ stream: true, speaker: 'lund' }]);
    expect(result).toEqual({
      messages: [{ speaker: { id: 'lund', name: 'LUND' }, text: '"lund speaks."' }],
    });
  });

  it('makes no call and returns nothing when nobody was selected', async () => {
    for (const dispatch of ['per-actor', 'merged'] as const) {
      const { asked, host: stub } = host();
      const result = await run?.(input({ voice: 'embodied', dispatch, speakers: [] }), stub);
      expect(asked, dispatch).toEqual([]);
      expect(result, dispatch).toEqual({});
    }
  });

  it('makes the one merged call when an embodied session makes no selection at all', async () => {
    // `fixed` hands no `speakers`; silence forever would be the wrong answer.
    const { asked, host: stub } = host();
    const result = await run?.(input({ voice: 'embodied', dispatch: 'per-actor' }), stub);
    expect(asked).toEqual([{ stream: true }]);
    expect(result).toEqual({ message: { text: 'The rain kept on.' } });
  });

  it('lets a failed speaking call through to the host, which decides what the round keeps', async () => {
    const { host: stub } = host();
    let calls = 0;
    const failing: StepHost = {
      ...stub,
      call: (request) => {
        calls += 1;
        return calls === 2 ? Promise.reject(new Error('gone')) : stub.call(request);
      },
    };
    await expect(
      run?.(
        input({ voice: 'embodied', dispatch: 'per-actor', speakers: ['a', 'b', 'c'] }),
        failing,
      ),
    ).rejects.toThrow('gone');
    expect(calls).toBe(2);
  });
});
