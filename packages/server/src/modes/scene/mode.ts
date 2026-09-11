// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import type {
  Mode,
  ModeDefinition,
  StepDefinition,
  StepHost,
  StepInput,
  StepResult,
} from '@storyengine/sdk';

import { CLOCK_CHANNEL } from '../../sessions/channels.js';
import { SCENE_PRESET } from './preset.js';

/**
 * Scene — the P2 mode, and it is **allowed to be embarrassingly small**.
 *
 * [P2 §5](../../../../../docs/design/workplan/08-p2-implementation.md) draws the line in as many
 * words: *a second step, a channel with a widget, a participant policy — each is
 * small and each belongs to P7, where the contract is tested by two real modes
 * rather than grown one convenience at a time.* So the interesting thing about
 * this file is what is **not** in it.
 *
 * Everything here is data except `narrate`, which is one host call. The mode
 * does no I/O and holds no handle.
 *
 * **It reaches for exactly one thing under `server/`, and that is the whole of
 * what is left of the move** — [P7.0](../../../../../docs/design/workplan/23-p7-implementation.md).
 * Its types now come from `@storyengine/sdk`, which is what `modes/contract.ts`
 * existed to enumerate and why that file is gone. What remains is
 * `CLOCK_CHANNEL`, a **value**: the engine's channel registry is still a frozen
 * record built from static imports, so the mode cannot yet own the channel it
 * declares. Inverting that registry is the next commit, and it is the last thing
 * between this file and a package.
 */

export const SCENE_ID = 'storyengine.scene';

export const NARRATE: StepDefinition = {
  id: 'se.narrate',
  stage: 'generate',
  reads: ['history'],
  /**
   * `contributes: 'messages'` with an empty `writes` is what makes
   * `callPurposeFor` yield `prose` and admit the guidance block. **One entry in
   * `writes` would turn every guidance-carrying turn into an
   * `AdvisoryLeakError` abort** — which is [06 §5.2] working exactly as
   * designed, and worth knowing before somebody adds a channel here.
   */
  writes: [],
  contributes: 'messages',
  // What a preset's `appliesTo` matches. Scene makes one kind of call.
  callKind: 'narrate',
  when: { when: 'cadence', everyNTurns: 1 },
  // If the call fails there is nothing else to narrate, and a turn that
  // continued would commit a record with no prose in it.
  failure: 'abort',
  role: 'prose',
};

/**
 * The whole of Scene's behaviour: ask the host, and the answer is the turn.
 *
 * The step does not assemble, does not choose a model, and does not know what a
 * Scene is. It asks; the runner resolves the role from the definition and
 * assembles with the purpose the definition implies.
 */
async function narrate(_input: StepInput, host: StepHost): Promise<StepResult> {
  const result = await host.call({ stream: true });
  return { message: { text: result.text } };
}

export const SCENE: ModeDefinition = {
  id: SCENE_ID,
  version: '1.0.0',
  displayName: 'Scene',
  voice: 'narrator',
  dispatch: 'merged',
  /**
   * Empty by fact rather than by omission. [06 §1] names presets for Adventure;
   * Scene has no second way to be configured, and minting `scene.default` would
   * create a permanent content identifier for a distinction nothing makes.
   */
  presets: [],
  participants: { select: 'fixed', maxActors: 1 },
  assembly: { defaultPreset: SCENE_PRESET, historyWindow: 20 },
  steps: [NARRATE],
  /**
   * **A declaration the engine does not yet consult, and this is the honest
   * place to say so.** Effect application resolves a channel from the
   * module-global registry in `sessions/channels.ts`, not from the running
   * mode — so listing `se.clock` here documents what Scene uses and does not
   * *enable* it. Making the registry mode-derived is the change that would give
   * this field teeth, and it belongs with P7's second real mode, where a mode
   * with a channel of its own can prove it.
   */
  channels: [CLOCK_CHANNEL],
  /**
   * One kind, matching what the wire already defaults to — so nothing that
   * works today stops working. `say` / `think` / `story` arrive with the
   * input-kind selector, which is a surface this stage does not build.
   */
  inputs: ['do'],
  /** [10 §8] has extensions declare widgets; that machinery is P7's. */
  surfaces: [],
  setup: { kind: 'none' },
};

export const SCENE_MODE: Mode = { definition: SCENE, run: { [NARRATE.id]: narrate } };
