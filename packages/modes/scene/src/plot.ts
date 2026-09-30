// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import type {
  Candidate,
  CastEntry,
  ChannelDefinition,
  EffectProposal,
  StepDefinition,
  StepHost,
  StepInput,
  StepResult,
  SurfaceContribution,
  TranscriptTurn,
} from '@storyengine/sdk';

/**
 * ***The secret plot*** — the narrative director's hidden arc, as a Scene
 * channel and one step —
 * [P13 §1.9.3](../../../../docs/design/workplan/30-p13-scene-and-session-import.md),
 * built at [P13.5b].
 *
 * [06 §7.3]: *"Hidden GM state (… the Narrative Director's Secret Plot) is a
 * channel with `visibility: "hidden"` and a reveal affordance."* Marinara keeps
 * it as `agent_memory`'s `overarchingArc` for the chat
 * (`director-secret-plot-runtime.ts`), one row rewritten in place; here it is
 * **an effect on the turn that revised it**, so a swipe or a rewind has the
 * arc it had, and every revision is a line a person can read in the
 * workbench.
 *
 * *The tension, stated in the plan and kept visible here*: [06 §7.3.2] calls
 * authored hooks *"the honest form of directedness"*, and a secret plot is a
 * narrator improvising a pull. So it is **off by default**, labelled as a
 * model-kept hidden arc where it is switched on, and its reveal is one toggle
 * away. [triage]'s verdict — PORT as a channel — accepted the trade.
 */

export const SE_SCENE_PLOT = 'se.scene.plot';

/**
 * Scene's id, spelled again for `tracking.ts`'s reason: `mode.ts` imports this
 * file, and a `const` read across that cycle at evaluation is a TDZ error.
 * `mode.test.ts` pins the spellings together.
 */
const OWNER = 'storyengine.scene';

/**
 * ***Whether this session keeps a secret plot*** — [P13 §1.9.6]'s switch under
 * *Agents*, Marinara's `narrativeDirectorSecretPlotEnabled`. User-only for the
 * trackers' reasons (`tracking.ts`, `toggle`): a model call every few turns is
 * the person's to spend, and a switch that is a channel is branch-correct and
 * where an import can put Marinara's. **Off.**
 */
export const PLOT_ON: ChannelDefinition = {
  id: 'se.plot.secret.on',
  owner: OWNER,
  version: 1,
  scope: 'session',
  update: 'user-only',
  visibility: 'player',
  schema: { type: 'boolean' },
  init: { kind: 'literal', value: false },
  budget: null,
};

/**
 * ***The reveal*** — [06 §7.3]'s affordance: while this is on, the plot is
 * drawn in the panel for the player to read. **Off by default**, since a plot
 * the player can read is not secret; and its own toggle is drawn only while
 * the plot is switched on (`enabledBy`), because revealing a plot nobody keeps
 * is a control with nothing behind it.
 */
export const REVEAL: ChannelDefinition = {
  ...PLOT_ON,
  id: 'se.plot.secret.reveal',
  enabledBy: PLOT_ON.id,
};

/** The session's cadence: every how many story turns the arc is revisited. */
export const PLOT_EVERY = 4;

/**
 * ***When the arc is revisited*** — Marinara's
 * `narrativeDirectorSecretPlotRunInterval`, as a count of **story turns**, the
 * unit this build's cadences all use. Its default is 8 *messages*, the
 * player's and the replies' together, which is about four rounds — so four.
 * Shown only while the plot is on.
 */
export const PLOT_CADENCE: ChannelDefinition = {
  id: 'se.plot.secret.cadence',
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
  init: { kind: 'literal', value: { everyNTurns: PLOT_EVERY } },
  budget: null,
  enabledBy: PLOT_ON.id,
};

const ARC_SCHEMA = {
  type: 'object',
  properties: {
    description: { type: 'string', minLength: 1, maxLength: 1500 },
    protagonistArc: { type: 'string', maxLength: 800 },
    characterArc: { type: 'string', maxLength: 800 },
    completed: { type: 'boolean' },
  },
  required: ['description', 'protagonistArc', 'completed'],
  additionalProperties: false,
} as const;

/**
 * ***The arc*** — `{ description, protagonistArc, characterArc?, completed }`,
 * Marinara's `overarchingArc` field for field (`director-secret-plot-runtime.ts`,
 * `normalizeSecretPlotArc`). `null` until the first pass writes one.
 *
 * - **Hidden, with a reveal** — `visibility` is the player's view; the narrator
 *   is told through the pack's channel slot among the system blocks, where
 *   Marinara puts its *Secret plot* system message (before the first chat
 *   message, `appendSecretPlotSystemMessage`).
 * - **`model-proposed`**: the pass writes it as a model's judgement, and a
 *   person's edit on the revealed card is admitted as the latest effect.
 * - **`enabledBy`**: switched off, the slot says nothing and the director is
 *   not told — the value stays on the tree for when it comes back.
 * - **A completed arc renders nothing.** It is the state between one arc and
 *   the next, which the second pass normally closes in the same turn; if that
 *   pass failed, the narrator is better told nothing than steered toward an
 *   arc the story has already resolved.
 */
export const SECRET_PLOT: ChannelDefinition = {
  id: 'se.plot.secret',
  owner: OWNER,
  version: 1,
  scope: 'session',
  update: 'model-proposed',
  visibility: 'hidden',
  schema: { oneOf: [ARC_SCHEMA, { type: 'null' }] },
  init: { kind: 'literal', value: null },
  render: [
    '{%- unless completed -%}',
    '{{ description }}',
    '{%- if protagonistArc != "" %}',
    'The player’s character: {{ protagonistArc }}',
    '{%- endif -%}',
    '{%- if characterArc and characterArc != "" %}',
    'Another character: {{ characterArc }}',
    '{%- endif -%}',
    '{%- endunless -%}',
  ].join('\n'),
  // About three times a four-sentence arc with both growth lines: a guard
  // against a runaway answer, not a target — the clock's posture.
  budget: 300,
  enabledBy: PLOT_ON.id,
  reveal: REVEAL.id,
};

export const PLOT_CHANNELS: readonly ChannelDefinition[] = [
  SECRET_PLOT,
  PLOT_ON,
  REVEAL,
  PLOT_CADENCE,
];

const AGENTS = 'Agents';
const DIRECTOR = 'Director';

/**
 * ***Where it is switched, and where it is shown*** — [P13 §1.9.6]'s *Agents*
 * group for the switch and the cadence, beside the trackers'; the reveal and
 * the revealed arc in the panel, under their own heading, because reading the
 * plot is reading the story rather than configuring it. The arc's card is
 * drawn only while it is revealed and the plot is on (the host reads
 * `reveal` and `enabledBy`); the reveal toggle only while the plot is on.
 */
export const PLOT_SURFACES: readonly SurfaceContribution[] = [
  {
    region: 'settings',
    group: AGENTS,
    channelId: PLOT_ON.id,
    widget: {
      kind: 'toggle',
      label: 'Keep a secret plot: a hidden arc a model keeps, which steers the narrator',
    },
  },
  {
    region: 'settings',
    group: AGENTS,
    channelId: PLOT_CADENCE.id,
    widget: {
      kind: 'record',
      label: 'When the secret plot is revisited',
      fields: [{ key: 'everyNTurns', label: 'Every how many turns', show: 'number' }],
    },
  },
  {
    region: 'panel',
    group: DIRECTOR,
    channelId: REVEAL.id,
    widget: { kind: 'toggle', label: 'Show me the secret plot' },
  },
  {
    region: 'panel',
    group: DIRECTOR,
    channelId: SECRET_PLOT.id,
    widget: {
      kind: 'record',
      label: 'The secret plot',
      fields: [
        { key: 'description', label: 'The arc', show: 'line' },
        { key: 'protagonistArc', label: 'Your character', show: 'line' },
        { key: 'characterArc', label: 'Another character', show: 'line' },
        { key: 'completed', label: 'Resolved', show: 'flag' },
      ],
    },
  },
];

/**
 * How many earlier story turns the pass reads beside this move. Marinara's pass
 * reads the recent messages and the chat summary; this build's summary is the
 * narrator's, so the arc's own text carries what is older.
 */
const RECENT_TURNS = 6;
const TURN_CHARS = 1200;

export const PLOT_STEP: StepDefinition = {
  id: SE_SCENE_PLOT,
  /**
   * **`pre`**, as Marinara's maintenance runs before generation: an arc
   * written this turn steers this turn's reply, and the director's push reads
   * the fresh one (the runner puts the director after the mode's `pre` steps).
   */
  stage: 'pre',
  reads: ['transcript', 'cast', SECRET_PLOT.id, PLOT_ON.id, PLOT_CADENCE.id],
  writes: [SECRET_PLOT.id],
  contributes: 'effects',
  callKind: 'plot',
  /**
   * *Every turn, and the step decides* — the trackers' reason: a mode cannot
   * keep its own step out of a plan ([25 C17]), and the cadence is the
   * session's.
   */
  when: { when: 'cadence', everyNTurns: 1 },
  /** **`warn`**: an arc that could not be revisited is not a lost turn. */
  failure: 'warn',
  /** `prose`, for [25 C15]'s reason; `stepRoles` at this id binds a cheaper model. */
  role: 'prose',
};

interface Arc {
  description: string;
  protagonistArc: string;
  characterArc?: string;
  completed: boolean;
}

/**
 * ***The pass*** — revisit the arc when it is due, and write what changed.
 *
 * **Due** when there is no arc, when the last one completed, or on the
 * session's cadence — Marinara's `shouldRunDirectorSecretPlotMaintenance`,
 * counted in story turns over the transcript as the engine counts its own.
 *
 * ***A pass that completes the arc is followed at once by a second*** —
 * Marinara's `runDirectorSecretPlotMaintenance`: the first answer, marked
 * completed, is written as it is (the record keeps the arc that resolved),
 * and the second, shown that completed arc, writes the next. *If the second
 * fails the completion still stands*: the step returns what it has, and the
 * next turn is due because the arc is completed — a lost follow-up costs one
 * turn without an arc, where failing the step would have lost the completion
 * the story reached.
 */
export async function plot(input: StepInput, host: StepHost): Promise<StepResult> {
  if (input.channels[PLOT_ON.id]?.value !== true) return {};

  const was = arcOf(input.channels[SECRET_PLOT.id]?.value);
  const before = input.transcript?.length ?? 0;
  const due = was === null || was.completed || (before + 1) % everyOf(input.channels) === 0;
  if (!due) return {};

  const effects: EffectProposal[] = [];
  const propose = (arc: Arc, callId: string, from: Arc | null): void => {
    if (JSON.stringify(arc) === JSON.stringify(from)) return;
    effects.push({
      channelId: SECRET_PLOT.id,
      op: { type: 'set', path: '/' },
      after: arc,
      proposedBy: { kind: 'model', callId },
    });
  };

  const first = await revisit(input, host, was);
  propose(first.arc, first.callId, was);
  if (first.arc.completed) {
    try {
      const next = await revisit(input, host, first.arc);
      propose(next.arc, next.callId, first.arc);
    } catch (error) {
      // A Stop is a Stop, whatever it interrupted. *Read structurally*: this
      // package's `lib` carries no DOM, so `AbortSignal` is a name it cannot
      // resolve, and the one property wanted is spelled here.
      const signal: { aborted?: unknown } = host.signal as { aborted?: unknown };
      if (signal.aborted === true) throw error;
    }
  }
  return effects.length === 0 ? {} : { effects };
}

async function revisit(
  input: StepInput,
  host: StepHost,
  arc: Arc | null,
): Promise<{ arc: Arc; callId: string }> {
  const cast = input.cast ?? [];
  const result = await host.call({
    candidates: [
      block('se.scene.plot.task', 'system', TASK),
      block(
        'se.scene.plot.state',
        'system',
        arc === null
          ? 'There is no arc yet.'
          : `The arc as it stands:\n${JSON.stringify(arc, null, 2)}`,
      ),
      block('se.scene.plot.cast', 'system', castText(cast)),
      block('se.scene.plot.recent', 'user', recentText(input, cast)),
    ],
    schema: ARC_SCHEMA,
  });
  const answer = arcOf(result.object);
  /**
   * *An answer that is not an arc fails the step*, the trackers' rule: a pass
   * that silently wrote nothing reads as *the arc still holds*, which is a
   * claim the model did not make.
   */
  if (answer === null) throw new Error('The model did not answer with an arc.');
  return { arc: answer, callId: result.callId };
}

/**
 * ***What the pass is asked*** — Marinara's secret-plot instruction
 * (`NARRATIVE_DIRECTOR_SECRET_PLOT_PROMPT`) in substance, in this pack's
 * words: keep the arc, resolve it only when the story has, and build the next
 * from the last.
 */
const TASK = [
  'You keep a hidden long-term arc for this story. The narrator is steered by it; the player cannot see it.',
  '',
  '- If there is no arc, create one.',
  '- If the arc is still unresolved, keep its core and change details only when the story has materially moved.',
  '- If what has happened has now resolved the arc, return it unchanged but with completed set to true.',
  '- If the arc you are shown is already completed, create the next one, building on what came before, with completed false.',
  '',
  'description: two to four sentences — the arc, its mystery, what would resolve it, and the journey it asks of the player’s character.',
  'protagonistArc: one or two sentences on how the player’s character could grow.',
  'characterArc: optionally, one or two sentences on one other character’s growth.',
  'Never write scene prose or dialogue, and never decide what the player’s character says or does.',
].join('\n');

function castText(cast: readonly CastEntry[]): string {
  const player = cast.find((member) => member.persona === true)?.name;
  const others = cast
    .filter((member) => member.persona !== true && member.present !== false)
    .map((member) => member.name);
  return [
    `The player’s character: ${player ?? 'unnamed'}`,
    `Others in the scene: ${others.length === 0 ? 'nobody yet' : others.join(', ')}`,
  ].join('\n');
}

function recentText(input: StepInput, cast: readonly CastEntry[]): string {
  const player = cast.find((member) => member.persona === true)?.name ?? 'The player';
  const turns: readonly Pick<TranscriptTurn, 'input' | 'output'>[] = [
    ...(input.transcript ?? []).slice(-RECENT_TURNS),
    ...(input.input === undefined ? [] : [{ input: input.input }]),
  ];
  const said = turns
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
    .filter((text) => text !== '');
  return said.length === 0
    ? 'Nothing has happened yet.'
    : ['The story so far, most recent last:', '', ...said].join('\n\n');
}

/**
 * An arc, read defensively — Marinara's `normalizeSecretPlotArc` over a value
 * this channel's schema has already checked, or a model's answer it has not.
 */
function arcOf(value: unknown): Arc | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const held = value as Record<string, unknown>;
  const description = typeof held['description'] === 'string' ? held['description'].trim() : '';
  if (description === '') return null;
  const protagonistArc =
    typeof held['protagonistArc'] === 'string' ? held['protagonistArc'].trim() : '';
  const characterArc = typeof held['characterArc'] === 'string' ? held['characterArc'].trim() : '';
  return {
    description: description.slice(0, 1500),
    protagonistArc: protagonistArc.slice(0, 800),
    ...(characterArc === '' ? {} : { characterArc: characterArc.slice(0, 800) }),
    completed: held['completed'] === true,
  };
}

function everyOf(channels: StepInput['channels']): number {
  const value = channels[PLOT_CADENCE.id]?.value;
  const every =
    typeof value === 'object' && value !== null
      ? (value as { everyNTurns?: unknown }).everyNTurns
      : undefined;
  return typeof every === 'number' && Number.isInteger(every) && every >= 1 ? every : PLOT_EVERY;
}

function block(id: string, role: 'system' | 'user', text: string): Candidate {
  return {
    id,
    source: { kind: 'step', stepId: SE_SCENE_PLOT },
    reason: 'secret plot',
    role,
    text,
    required: true,
  };
}
