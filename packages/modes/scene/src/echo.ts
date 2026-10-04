// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import type {
  Candidate,
  StepCastMember,
  ChannelDefinition,
  StepDefinition,
  StepHost,
  StepInput,
  StepResult,
  SurfaceContribution,
  TranscriptTurn,
} from '@storyengine/sdk';

/**
 * ***The echo chamber*** — side reactions from the other characters, shown
 * beside the chat —
 * [P14 §1.9.5](../../../../docs/design/workplan/31-p14-scene-and-session-import.md),
 * built at [P14.5c].
 *
 * *"Built as a panel fed by a cadence step, since it never touches the
 * story."* So: a `post` step writing one channel, `se.echo`, which **no prompt
 * reads** — it declares no `render` and no slot places it, so the narrator
 * never learns what the chorus muttered and the chorus cannot steer the story
 * by the back door. It is an effect on the turn all the same, so a swipe has
 * its own reactions and a rewind takes them back, which is the tree doing what
 * it does for every channel. **Off by default.**
 *
 * *Present members only*: a muted member is out of the room, and the persona's
 * words are the player's. *
 * ***Not Marinara's echo chamber, on purpose*** (§1.9.5, corrected at
 * review): Marinara's is a live audience of invented handles that accumulates
 * and skips regenerates; this is the cast's asides, per turn, run on a swipe,
 * so the panel stays inside the cast and agrees with the tree.
 */

export const SE_SCENE_ECHO = 'se.scene.echo';

/** Scene's id, spelled again for `tracking.ts`'s reason (a TDZ across the `mode.ts` cycle). */
const OWNER = 'storyengine.scene';

/** ***The echo chamber's switch*** — Marinara's `echo-chamber` agent. User-only; **off**. */
export const ECHO_ON: ChannelDefinition = {
  id: 'se.echo.on',
  owner: OWNER,
  version: 1,
  scope: 'session',
  update: 'user-only',
  visibility: 'player',
  schema: { type: 'boolean' },
  init: { kind: 'literal', value: false },
  budget: null,
};

/** Every turn, as Marinara's runs in its parallel phase each generation. */
export const ECHO_EVERY = 1;

/** ***How often the chorus speaks*** — every how many story turns. Shown only while it is on. */
export const ECHO_CADENCE: ChannelDefinition = {
  id: 'se.echo.cadence',
  owner: OWNER,
  version: 1,
  scope: 'session',
  update: 'user-only',
  visibility: 'player',
  schema: {
    type: 'object',
    properties: { everyNTurns: { type: 'integer', minimum: 1, maximum: 100 } },
    required: ['everyNTurns'],
    additionalProperties: false,
  },
  init: { kind: 'literal', value: { everyNTurns: ECHO_EVERY } },
  budget: null,
  enabledBy: ECHO_ON.id,
};

const REACTION = 300;
const NAME = 120;

/**
 * ***The reactions*** — the answer's `{ characterName, reaction }[]`, kept as
 * `{ name, value }` rows so the panel draws them with the `pairs` arm the
 * custom tracker already uses; nothing about the value needed a new widget.
 * `model-proposed`, so a person may clear a reaction they would rather not
 * read, and **no `render`**: no prompt, no picture.
 */
export const ECHO: ChannelDefinition = {
  id: 'se.echo',
  owner: OWNER,
  version: 1,
  scope: 'session',
  update: 'model-proposed',
  visibility: 'player',
  schema: {
    type: 'array',
    maxItems: 12,
    items: {
      type: 'object',
      properties: {
        name: { type: 'string', minLength: 1, maxLength: NAME },
        value: { type: 'string', maxLength: REACTION },
      },
      required: ['name', 'value'],
      additionalProperties: false,
    },
  },
  init: { kind: 'literal', value: [] },
  budget: null,
  enabledBy: ECHO_ON.id,
};

export const ECHO_CHANNELS: readonly ChannelDefinition[] = [ECHO, ECHO_ON, ECHO_CADENCE];

export const ECHO_SURFACES: readonly SurfaceContribution[] = [
  {
    region: 'settings',
    group: 'Agents',
    channelId: ECHO_ON.id,
    widget: {
      kind: 'toggle',
      label: 'Echo chamber: the other characters react beside the chat, outside the story',
    },
  },
  {
    region: 'settings',
    group: 'Agents',
    channelId: ECHO_CADENCE.id,
    widget: {
      kind: 'record',
      label: 'When the echo chamber reacts',
      fields: [{ key: 'everyNTurns', label: 'Every how many turns', show: 'number' }],
    },
  },
  {
    region: 'panel',
    group: 'Echo chamber',
    channelId: ECHO.id,
    widget: {
      kind: 'record',
      label: 'Reactions',
      fields: [{ key: '', label: 'Reactions', show: 'pairs' }],
    },
  },
];

const RECENT_TURNS = 3;
const TURN_CHARS = 1200;

export const ECHO_STEP: StepDefinition = {
  id: SE_SCENE_ECHO,
  /** `post`: the chorus reacts to what was just said, after the editor settled it. */
  stage: 'post',
  // Its own channel too: an empty answer clears the panel and a repeated one
  // writes nothing, and both are judged against what the panel holds.
  reads: ['output', 'transcript', 'cast', ECHO.id, ECHO_ON.id, ECHO_CADENCE.id],
  writes: [ECHO.id],
  contributes: 'effects',
  callKind: 'echo',
  /** *Every turn, and the step decides* — the trackers' reason ([26 C17]). */
  when: { when: 'cadence', everyNTurns: 1 },
  failure: 'warn',
  role: 'prose',
};

/**
 * ***The pass*** — due on the session's cadence (story turns over the
 * transcript, as the plot's is), and only with somebody present to react and
 * a reply to react to. A reaction from a name the scene does not hold is
 * dropped, and so is a second one from the same member. *An answer that is not
 * a list fails the step* (`warn`), the trackers' rule; an empty list is the
 * chorus with nothing to say, and writes an empty panel.
 */
export async function echo(input: StepInput, host: StepHost): Promise<StepResult> {
  if (input.channels[ECHO_ON.id]?.value !== true) return {};
  const said = input.output?.text.trim() ?? '';
  if (said === '') return {};
  const before = input.transcript?.length ?? 0;
  if ((before + 1) % everyOf(input.channels) !== 0) return {};
  const present = (input.cast ?? []).filter(
    (member) => member.persona !== true && member.present !== false,
  );
  if (present.length === 0) return {};

  const result = await host.call({
    candidates: [
      block('se.scene.echo.task', 'system', TASK),
      block(
        'se.scene.echo.cast',
        'system',
        `Who may react: ${present.map((m) => m.name).join(', ')}`,
      ),
      block('se.scene.echo.recent', 'user', recentText(input, said, input.cast ?? [])),
    ],
    schema: ANSWER_SCHEMA,
  });
  const reactions = reactionsOf(result.object, present);
  const was = input.channels[ECHO.id]?.value ?? [];
  if (JSON.stringify(was) === JSON.stringify(reactions)) return {};
  return {
    effects: [
      {
        channelId: ECHO.id,
        op: { type: 'set', path: '/' },
        after: reactions,
        proposedBy: { kind: 'model', callId: result.callId },
      },
    ],
  };
}

const ANSWER_SCHEMA = {
  type: 'object',
  properties: {
    reactions: {
      type: 'array',
      items: {
        type: 'object',
        properties: { characterName: { type: 'string' }, reaction: { type: 'string' } },
        required: ['characterName', 'reaction'],
      },
    },
  },
  required: ['reactions'],
} as const;

const TASK = [
  'You voice the side reactions of the characters in a scene: a muttered aside, a thought, a look, one or two sentences each.',
  'They are shown beside the story and never become part of it, so they must not add events, decide anything, or speak for the player’s character.',
  'Only the characters named may react, each at most once, and a character with nothing to say is left out.',
  'Answer with {"reactions": [{"characterName": "…", "reaction": "…"}]}.',
].join('\n');

function reactionsOf(
  answer: unknown,
  present: readonly StepCastMember[],
): { name: string; value: string }[] {
  const list =
    typeof answer === 'object' && answer !== null && !Array.isArray(answer)
      ? (answer as Record<string, unknown>)['reactions']
      : undefined;
  if (!Array.isArray(list)) throw new Error('The model did not answer with reactions.');
  const out: { name: string; value: string }[] = [];
  for (const raw of list) {
    if (typeof raw !== 'object' || raw === null) continue;
    const row = raw as Record<string, unknown>;
    const asked = typeof row['characterName'] === 'string' ? row['characterName'].trim() : '';
    const reaction = typeof row['reaction'] === 'string' ? row['reaction'].trim() : '';
    const member = present.find((one) => one.name.toLowerCase() === asked.toLowerCase());
    if (member === undefined || reaction === '') continue;
    if (out.some((one) => one.name === member.name)) continue;
    out.push({ name: member.name.slice(0, NAME), value: reaction.slice(0, REACTION) });
  }
  return out;
}

function recentText(input: StepInput, said: string, cast: readonly StepCastMember[]): string {
  const player = cast.find((member) => member.persona === true)?.name ?? 'The player';
  const turns: readonly Pick<TranscriptTurn, 'input' | 'output'>[] = [
    ...(input.transcript ?? []).slice(-RECENT_TURNS),
    { ...(input.input === undefined ? {} : { input: input.input }), output: { text: said } },
  ];
  return [
    'The story so far, most recent last:',
    '',
    ...turns
      .map((turn) =>
        [
          turn.input === undefined || turn.input.text.trim() === ''
            ? ''
            : `${player}: ${turn.input.text.trim()}`,
          turn.output?.text.trim() ?? '',
        ]
          .filter((part) => part !== '')
          .join('\n\n')
          .slice(0, TURN_CHARS),
      )
      .filter((text) => text !== ''),
  ].join('\n\n');
}

function everyOf(channels: StepInput['channels']): number {
  const value = channels[ECHO_CADENCE.id]?.value;
  const every =
    typeof value === 'object' && value !== null
      ? (value as { everyNTurns?: unknown }).everyNTurns
      : undefined;
  return typeof every === 'number' && Number.isInteger(every) && every >= 1 ? every : ECHO_EVERY;
}

function block(id: string, role: 'system' | 'user', text: string): Candidate {
  return {
    id,
    source: { kind: 'step', stepId: SE_SCENE_ECHO },
    reason: 'echo chamber',
    role,
    text,
    required: true,
  };
}
