// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import type { Mode, ModeDefinition, StepDefinition } from '@storyengine/sdk';

import {
  channelDefinition,
  channelSurfaces,
  registerChannel,
  type ChannelSurface,
} from './sessions/channels.js';
import type { ChannelState } from './sessions/types.js';
import type { TurnPlan } from './turns/steps.js';

/**
 * Which modes this build knows — [06 §2].
 *
 * ~~A frozen record and a lookup, mirroring `sessions/channels.ts`'s `CHANNELS`,
 * and deliberately **not** a `registerMode` API. Dynamic registration is what an
 * extension needs and it arrives with the SDK boundary at P7; a registry that
 * could be written to now would be a shape that phase has to live with, built
 * before anything could exercise it.~~
 *
 * **That deferral is discharged at [P7.0], and the boundary is what forced it
 * rather than what merely permitted it.** The graph allows `server → server,
 * sdk, shared` — so the moment the Scene mode is `packages/modes/scene`, this
 * file's `import { SCENE_MODE } from './scene/mode.js'` is a **build error**,
 * and there is no compiling around it. Dynamic registration was never the
 * optional companion to the move; it is its prerequisite.
 *
 * **This file now knows no mode at all**, which is the property worth keeping:
 * it holds a map, a lookup and a proof, and something else decides what goes in.
 * *It also no longer lives in a directory called `modes/`*: the host half and the
 * mode were neighbours for five stages, and [P7.0] ends with
 * `packages/server/src/modes/` gone and a repo-shape check that fails if it
 * comes back, because a directory with that name beside the engine is where a
 * mode ends up next time somebody is in a hurry.
 * That something is [`mode-loader.ts`](./mode-loader.ts) — the one file that
 * reaches for a mode, and, since the move, the one file in the server that can.
 *
 * *Mutable rather than an instance threaded through every caller, deliberately.*
 * What P7 needs is that the registry stops being populated by a static import;
 * whether mode availability is ever **scoped** — per install, per account — is
 * [P10](../../../docs/design/workplan/26-p10-implementation.md)'s, with
 * extension installation, and inventing the scoping now would be exactly the
 * shape the struck paragraph above warned against building early.
 */

const registered = new Map<string, Mode>();

/**
 * Adds a mode to this build's registry.
 *
 * **Last registration wins, and that is the honest rule for a loader**: an
 * install that ships two copies of one mode id has a configuration problem, and
 * refusing at startup would take the server down over it. Idempotent for the
 * same object, which is what lets a test register the built-ins without caring
 * whether something already did.
 */
export function registerMode(mode: Mode): void {
  registered.set(mode.definition.id, mode);
  /**
   * **And its channels, which is what gives `ModeDefinition.channels` teeth.**
   * The field has existed since P2.6 and Scene's `mode.ts` said what it was
   * worth: listing a channel there "documents what Scene uses and does not
   * *enable* it", because effect application resolved a definition from the
   * engine's own frozen record. Registering here is the inversion that sentence
   * named — and the boundary is what forced it, since a mode that cannot import
   * a value from the engine cannot be handed its own channel any other way.
   */
  for (const channel of mode.definition.channels) registerChannel(channel);
}

/**
 * What a session runs when it names no mode, or names one this build has never
 * heard of.
 *
 * **Resolving to a default rather than refusing** is [00 §3.3]: a session whose
 * mode came from a newer build, or from an extension that is not installed, is
 * still somebody's story and should still open. The substitution is logged, and
 * P7 — where a mode can genuinely be missing rather than merely unknown — is
 * where it earns a visible warning on the session itself.
 *
 * **A literal since [P7.0], where it used to be `SCENE_ID`.** The default is an
 * *id*, and an id is content ([06 §2] — it lands in `session.json`); reaching
 * for the mode's own constant would reintroduce the import the boundary
 * forbids. `sessions/channels.ts` spells `'storyengine.scene'` the same way and
 * for a neighbouring reason, and a test in the mode pins the two together.
 */
export const DEFAULT_MODE_ID = 'storyengine.scene';

export function modeById(id: string): Mode | null {
  return registered.get(id) ?? null;
}

/**
 * The build's default mode, or a throw naming what is wrong.
 *
 * **The throw is the point.** `DEFAULT_MODE_ID` names an id and registering is
 * a call, so the two can disagree — a loader that found no package, a
 * composition root that forgot `installBuiltIns`, a default pointed at a mode
 * this build does not ship. Every caller that reaches for the default has to
 * handle that, and a helper is better than three copies of the same null check
 * disagreeing about what to say.
 */
export function defaultMode(): Mode {
  const mode = registered.get(DEFAULT_MODE_ID);
  if (!mode) {
    throw new Error(
      `The default mode ${DEFAULT_MODE_ID} is not registered. Call installBuiltIns() before serving.`,
    );
  }
  return mode;
}

/** Every mode registered so far, in registration order. */
export function registeredModes(): readonly Mode[] {
  return [...registered.values()];
}

/**
 * A mode as a client may see it — [10 §8], [P7.4].
 *
 * **Nothing had ever read `registeredModes` outside a test**, which is the gap
 * [P7.4]'s cell records as *"no route that would hand a declaration to the
 * client"* — and it is wider than the wizard: until this there was no way for a
 * browser to know which modes exist at all, so the session form offered *the
 * mode's own* and nothing else.
 *
 * **A `Pick`-shaped presentation rather than the definition, and the omissions
 * are the design.** `assembly.defaultPreset` is a thirteen-block prompt pack the
 * session *copies* at creation ([03 §8]), so sending it would be shipping a
 * copy of something the client has no use for and cannot change; `steps` and
 * `channels` are what the engine runs and what it registers, neither of which a
 * client acts on — a channel reaches the browser as a rendered `hud` entry on
 * the session, which is 10 §8's whole arrangement.
 *
 * *`presets` travels as ids only, for the same reason `assembly` does not: a
 * `ModePreset.config` is opaque and never interpreted by the host ([04 §7]), so
 * a client showing one would be showing bytes.*
 */
export interface PublicMode {
  id: string;
  displayName: string;
  voice: ModeDefinition['voice'];
  dispatch: ModeDefinition['dispatch'];
  participants: ModeDefinition['participants'];
  inputs: readonly string[];
  presetIds: readonly string[];
  setup: ModeDefinition['setup'];
  surfaces: ModeDefinition['surfaces'];
}

export function presentMode(mode: Mode): PublicMode {
  const { definition } = mode;
  return {
    id: definition.id,
    displayName: definition.displayName,
    voice: definition.voice,
    dispatch: definition.dispatch,
    participants: definition.participants,
    inputs: definition.inputs,
    presetIds: definition.presets.map((preset) => preset.id),
    /**
     * **The fields, never the parts** — [P7.4].
     *
     * `steps` are absent from this shape because they are what the engine runs;
     * `DeclaredSetup.parts` are `StepDefinition`s and are the same thing on the
     * same grounds — `callKind`, `role` and `writes` are engine-facing and a
     * client acts on none of them. What a client needs is what it must *ask*,
     * and that is `fields`.
     *
     * *A person watching a generation sees it through the turn's `step.*`
     * progress events, which name the part that is running — so the client
     * learns what the parts are from the run rather than from the declaration,
     * the same way it learns what a turn's steps are.*
     */
    setup: withoutParts(definition.setup),
    surfaces: definition.surfaces,
  };
}

/**
 * Zips a mode's declared steps with the implementations behind them.
 *
 * **Throws when a declared step id has no implementation**, and that is the
 * right failure: a plan silently short one step is a turn that quietly narrates
 * nothing, which looks like a bad model rather than a broken build. Called once
 * per mode by `assertModesRunnable`, so the throw lands at startup rather than
 * inside somebody's turn.
 */
export function planFor(mode: Mode): TurnPlan {
  return zip(mode, mode.definition.steps, 'step');
}

/**
 * The plan for a session's **first** turn, when its mode generates one — [06 §7.3],
 * [P7.4].
 *
 * **Empty for every mode that declares no parts**, which is every mode today and
 * Scene forever — and an empty plan is why the caller checks before reserving a
 * turn rather than starting one that would do nothing.
 *
 * *The same `run` table as the steps, so a part's implementation is written
 * where a step's is and `assertModesRunnable` proves both at startup. A part
 * that a mode declares and does not implement is the same failure as a step
 * that is, and it fails at the same moment.*
 */
export function setupPlanFor(mode: Mode): TurnPlan {
  const setup = mode.definition.setup;
  return zip(mode, setup.kind === 'declared' ? (setup.parts ?? []) : [], 'setup part');
}

function zip(mode: Mode, declared: readonly StepDefinition[], what: string): TurnPlan {
  return {
    steps: declared.map((definition) => {
      const run = mode.run[definition.id];
      if (run === undefined) {
        throw new Error(
          `Mode ${mode.definition.id} declares ${what} ${definition.id} with no implementation.`,
        );
      }
      return { definition, run };
    }),
  };
}

/**
 * Proves every registered mode can actually run, at startup rather than at play.
 *
 * The cost of getting this wrong is paid by a user mid-turn; the cost of
 * checking is one pass over a small map.
 *
 * **Runs after registration closes rather than at module load**, which is what
 * registration being a call rather than an import costs and buys: it can no
 * longer fire before the modes are there, and it now also catches a build that
 * registered nothing — a server with no modes cannot take a turn, and finding
 * that out at startup beats finding it out when somebody presses Send.
 */
export function assertModesRunnable(): void {
  if (registered.size === 0) {
    throw new Error('No modes are registered. Call installBuiltIns() before serving.');
  }
  for (const mode of registered.values()) {
    planFor(mode);
    // Parts too, and for the same reason: a declared generation with no
    // implementation is a session that creates itself and silently produces
    // nothing, which reads as a bad model rather than as a broken build.
    setupPlanFor(mode);
  }
}

function withoutParts(setup: ModeDefinition['setup']): ModeDefinition['setup'] {
  // Rebuilt rather than destructured-and-rested: the rest element would name a
  // binding nothing reads, which the lint rule is right about — and naming the
  // two fields that travel is the more honest spelling anyway, since a third
  // added to `DeclaredSetup` should have to decide whether it is client-facing.
  return setup.kind === 'declared' ? { kind: setup.kind, fields: setup.fields } : setup;
}

/*
 * ***The two below live here rather than in `sessions/channels.ts`, and the
 * reason is a cycle rather than a taxonomy.*** They are questions about a
 * channel *and* a mode, and `mode-registry.ts` already imports
 * `registerChannel` — so putting them on the channels side would have made the
 * two modules import each other. That is not a style objection: ESM resolves a
 * cycle by handing one side a half-initialised module, and the shape it took
 * was a **green typecheck and a build whose every turn failed**, because
 * `registerChannel` was `undefined` at the moment `registerMode` reached for
 * it. Found at [P7.9] by 141 route tests going red at once.
 */
/**
 * Whether a channel is in play for a session on this mode — [06 §4], [06 §4.1],
 * found and built at [P7.9].
 *
 * ***The registry is process-wide and a session is not***, which was invisible
 * while one mode declared channels and became a defect the moment a second one
 * did. `registeredChannels()` holds the union of every built-in's declarations,
 * so a reader that walks it is answering *does this build have such a channel*
 * when the question is *does this session*. Freeform declares `se.difficulty`;
 * without this, a **Scene** session would offer a difficulty dial, accept a
 * write to it, and put whatever it held in front of a mode that has no such
 * concept.
 *
 * ***The rule is `owner`, and it is the field's own meaning rather than a new
 * one.*** [06 §4.1] admits two kinds of owner and draws exactly this line:
 *
 * - **A mode id** — the channel is that mode's, and belongs to a session
 *   playing it. `se.clock` is Scene's; `se.difficulty` is a declaring mode's.
 * - **A package** (`storyengine.cast`, `storyengine.hooks`,
 *   `storyengine.goals`, `storyengine.lore`) — deliberately *not* a mode,
 *   precisely because [06 §8]'s sixth rule says such state is *"available to
 *   **every** mode, not a Freeform or Campaign feature"*. Those stay available
 *   everywhere, which is why they were registered outside a mode in the first
 *   place.
 *
 * So the test is *is there a registered mode with this owner, and is it not the
 * one being played* — and an owner no mode answers to is a package's.
 *
 * *An unregistered channel is not in play either*, which keeps the two answers a
 * caller cares about — **unknown** and **not yours** — from needing two calls.
 */
export function channelInPlay(channelId: string, modeId: string): boolean {
  const definition = channelDefinition(channelId);
  if (definition === null) return false;
  return modeById(definition.owner) === null || definition.owner === modeId;
}

/**
 * The HUD for one session — {@link channelSurfaces} narrowed by the mode.
 *
 * Kept as a wrapper rather than a parameter with a default so that the
 * unfiltered walk stays available to the workbench, which is about the *build*
 * rather than about a session and should keep seeing everything.
 */
export function sessionSurfaces(
  channels: Readonly<Record<string, ChannelState>>,
  modeId: string,
): ChannelSurface[] {
  return channelSurfaces(channels).filter((surface) => channelInPlay(surface.channelId, modeId));
}
