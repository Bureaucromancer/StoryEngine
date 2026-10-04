// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import type { Candidate, StepDefinition, StepImplementation, StepInput } from '@storyengine/sdk';
import { outputMessagesOf, type Direction } from '@storyengine/shared';

import { scanText } from '../assembly/pictures.js';
import type { ChatSettings } from '../sessions/chat-settings.js';

import { saysSomething } from './speakers.js';

/**
 * ***Push story*** — the narrative director's push, as an engine step —
 * [P14 §1.9.3](../../../../docs/design/workplan/31-p14-scene-and-session-import.md),
 * built at [P14.5b].
 *
 * Marinara's director *push* runs only when the player arms it for one turn,
 * *natural* or *random* (`generate.routes.ts:942-945`, `:3819-3826`; its client
 * clears the flag after one use). Here the flag is the submission's `push`, and
 * it arms this step — **the first producer `StepCondition.armed` has had**
 * ([25 C17] recorded `armed` as an arm nothing could raise). The runner puts
 * `push` in the turn's armed set when a submission carries one, and this step's
 * `when` is that flag.
 *
 * ***Engine-owned, for the hook selector's reason, and built the way it is***
 * (`turns/hook-selector.ts`, [P7.5]):
 *
 * - **What it produces is guidance**, and guidance is the one thing a step may
 *   not hand back ([06 §5.2]); a step's own candidates are appended after the
 *   preset's, so a direction returned as one would arrive at the end of the
 *   prompt rather than where the pack put the guidance slot. So the words go
 *   to the runner through a report cell and fill the slot as `direction`
 *   ([06 §5.1]: *"one slot, several producers… or a step such as a Narrative
 *   Director push"*).
 * - **Its own candidates** — the recent messages and the secret plot, if the
 *   session keeps one — so the call is small and neither the preset nor the
 *   retriever runs.
 * - **`failure: 'warn'` and a fixed fallback.** A push that cannot be written
 *   is not a lost turn: the pack's own push text for the flavour stands in
 *   (`Preset.pushDirections`, Marinara's individual-mode directive at
 *   `generate.routes.ts:5754-5763`), and the outcome says so beside the error.
 *
 * *`se.scene.direct` is a step id, not a mode id*: the director is Scene's idea
 * and its id says so, but nothing here reads a mode, and a Freeform session
 * whose pack ships push texts is pushed by the same step.
 */

export const SE_SCENE_DIRECT = 'se.scene.direct';

/**
 * ***The armed flag a push raises*** — what the runner puts in
 * `ConditionContext.armed` for a submission carrying `push`, and what this
 * step's `when` names. One flag for both flavours: *which* push is the
 * report's, and *whether* is the condition's.
 */
export const PUSH_FLAG = 'push';

export type Push = Direction['push'];

/**
 * ***How many messages of what just happened the director reads*** — the
 * smart order's numbers, for its reason: enough to see where the scene is
 * standing still, and a cut so one long reply is not the whole of it.
 */
const RECENT_MESSAGES = 8;
const MESSAGE_CHARS = 600;

/**
 * ***How long a direction may be on the record and in the slot*** — the task
 * asks for one to three sentences, and this is what holds when the answer is a
 * paragraph: the guidance slot is advisory text, and a page of it would be the
 * director writing the reply.
 */
const DIRECTION_CHARS = 600;

export const DIRECT_STEP: StepDefinition = {
  id: SE_SCENE_DIRECT,
  /**
   * **`pre`, because the direction is for this turn's reply**, and the guidance
   * slot is filled from the cell before any later step assembles. The runner
   * places it after the mode's own `pre` steps, so a secret plot a pass just
   * rewrote is the one it reads.
   */
  stage: 'pre',
  /** The path, for the recent messages. The secret plot arrives resolved. */
  reads: ['history'],
  writes: [],
  // No `contributes`, for the hook selector's reason: what this produces is
  // guidance, which reaches the slot through the runner's cell and never as a
  // candidate or an effect.
  callKind: 'direct',
  /** ***Armed, never on a cadence*** — the push is a person's, one turn at a time. */
  when: { when: 'armed', flag: PUSH_FLAG },
  failure: 'warn',
  /**
   * `prose`, for [25 C15]'s reason and the hook selector's word for word: a
   * role nobody bound fails the step, and `stepRoles` at this id is where an
   * install points it at a smaller model.
   */
  role: 'prose',
};

export interface DirectContext {
  /** The flavour the submission armed. */
  push: Push;
  /**
   * ***The pack's fixed push text for that flavour***, or null when the pack
   * ships none (`Preset.pushDirections`). Resolved by the runner, which holds
   * the pack — a step does not go shopping.
   */
  fallback: string | null;
  /**
   * ***The secret plot, if the session keeps one***, as its channels render —
   * every switched-on hidden channel that declares a reveal
   * (`secretChannels`), so the engine names none. Empty is no secret.
   *
   * ***A thunk, read when the step runs***: the director is placed after the
   * mode's `pre` steps so that a plot pass which just wrote a fresh arc is the
   * one it reads, and a value captured when the plan was built would be the
   * arc from before the turn started.
   */
  secrets: () => readonly string[];
  /** The persona's name, for the player's lines; null reads as *the player*. */
  player: string | null;
  /** Who said each line, by actor id — a `Ref`'s own name is the fallback. */
  names: ReadonlyMap<string, string>;
  /** The session's hidden lines — the director reads what the characters see. */
  hidden: ChatSettings['hidden'];
  /**
   * Where the direction goes — the runner's cell. **Called on every path that
   * does not end in a Stop**, success or fallback, so a pushed turn's outcome
   * always says what it was given.
   */
  report: (direction: Direction) => void;
}

/**
 * Builds the engine's own `{ definition, run }` pair for a pushed turn — a
 * function for the hook selector's reason: the flavour, the pack's text and the
 * secret are facts about this submission at this node.
 */
export function direct(context: DirectContext): {
  definition: StepDefinition;
  run: StepImplementation;
} {
  return {
    definition: DIRECT_STEP,
    run: async (input, host) => {
      /**
       * ***Every failure lands on the pack's text, and says so*** — reported
       * first and then raised, the smart order's arrangement: the outcome
       * carries the direction that stood in, and the error, classified by the
       * runner, says why. *Not on a Stop*: a cancelled turn was given nothing.
       */
      const fallBack = (): void => {
        if (host.signal.aborted) return;
        context.report({
          push: context.push,
          by: 'fallback',
          ...(context.fallback === null ? {} : { text: context.fallback }),
        });
      };

      const secrets = context.secrets();
      let text: string;
      try {
        const result = await host.call({
          candidates: [
            block('se.scene.direct.task', 'system', TASKS[context.push]),
            ...(secrets.length === 0
              ? []
              : [
                  block(
                    'se.scene.direct.secret',
                    'system',
                    `Where the story is secretly heading (the player does not know this):\n${secrets.join('\n\n')}`,
                  ),
                ]),
            block('se.scene.direct.recent', 'user', recentText(context, input)),
          ],
        });
        text = cut(result.text, DIRECTION_CHARS);
      } catch (error) {
        fallBack();
        throw error;
      }
      if (text === '') {
        fallBack();
        throw new Error('The director answered with nothing, so the pack’s push text stood in.');
      }
      context.report({ push: context.push, by: 'model', text });
      return {};
    },
  };
}

/**
 * ***The question, in our words*** — Marinara's two director modes, as its
 * fixed directive states them (`generate.routes.ts:5754-5763`), asked of a
 * model rather than sent as they are.
 *
 * **In the engine and not in the pack**, for the hook selector's reason: this
 * is what makes the answer a *direction* — short, about what happens, never
 * the reply itself — and the pack's words are the fallback, not the question.
 */
const COMMON = [
  'Answer with one to three sentences for the narrator: what should happen in the next reply.',
  'Say what happens, not how to word it. Do not write prose or dialogue, and never decide what the player’s character says, does or feels.',
];

const TASKS: Readonly<Record<Push, string>> = {
  natural: [
    'You direct a story from behind the scenes, and the player has asked you to move it on.',
    'Push it forward naturally: carry it into a new scene, or drive it through the tensions, goals and unresolved threads it already has.',
    ...COMMON,
  ].join('\n'),
  random: [
    'You direct a story from behind the scenes, and the player has asked you to shake it up.',
    'Introduce one random but plausible event that fits the scene and everything established so far — something nobody saw coming.',
    ...COMMON,
  ].join('\n'),
};

/**
 * ***What just happened***, as the smart order reads it: the player's lines
 * under their name, each reply under its speaker's, hidden lines left out, the
 * move being made last.
 */
function recentText(context: DirectContext, input: StepInput): string {
  const player = context.player === null ? 'The player' : `${context.player} (the player)`;
  const said: string[] = [];
  for (const turn of input.history ?? []) {
    const held = context.hidden[turn.id];
    if (held === true) continue;
    if (saysSomething(turn.input)) {
      said.push(`${player}: ${cut(scanText(turn.input), MESSAGE_CHARS)}`);
    }
    for (const [index, message] of outputMessagesOf(turn.output).entries()) {
      if (message.text === '' || held?.includes(index) === true) continue;
      const who =
        message.speaker === null
          ? 'Narrator'
          : (context.names.get(message.speaker.id) ?? message.speaker.name);
      said.push(`${who}: ${cut(message.text, MESSAGE_CHARS)}`);
    }
  }
  if (saysSomething(input.input)) {
    said.push(`${player}: ${cut(scanText(input.input), MESSAGE_CHARS)}`);
  }
  const recent = said.slice(-RECENT_MESSAGES);
  return recent.length === 0
    ? 'Nothing has happened yet.'
    : ['The story so far, most recent last:', '', ...recent].join('\n');
}

function cut(value: string, limit: number): string {
  const flat = value.replace(/\s+/gu, ' ').trim();
  return flat.length <= limit ? flat : `${flat.slice(0, limit - 1).trimEnd()}…`;
}

function block(id: string, role: 'system' | 'user', text: string): Candidate {
  return {
    id,
    source: { kind: 'step', stepId: SE_SCENE_DIRECT },
    // Author-facing English, as P2.5 established for `reason`.
    reason: 'push story',
    role,
    text,
    required: true,
  };
}
