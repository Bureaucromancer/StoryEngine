// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import type {
  Candidate,
  CastEntry,
  ChannelDefinition,
  MessageRevision,
  OutputMessage,
  RevisionNotice,
  StepDefinition,
  StepHost,
  StepInput,
  StepResult,
  SurfaceContribution,
  TranscriptTurn,
} from '@storyengine/sdk';

/**
 * ***The editor*** — Marinara's prose guardian and continuity checker, as one
 * Scene step —
 * [P13 §1.9.4](../../../../docs/design/workplan/30-p13-scene-and-session-import.md),
 * built at [P13.5c].
 *
 * Marinara merges its rewrite agents into **one combined editor call** after
 * generation (`prose-guardian-settings.ts:135-220`,
 * `mergePairedBuiltInRewriteAgents`), rewrites the message, and keeps the
 * original in the message's extras. Here the call is `se.scene.edit`, a `post`
 * step declaring `revises`, and what it answers is Marinara's shape —
 * `{ editNeeded, editedText, changes }` — plus the continuity findings it did
 * not apply. The engine does the rest: it replaces the message's text **before
 * the turn is written**, keeps what it replaced as `OutputMessage.original`,
 * and puts the `changes` and the findings on this step's outcome.
 *
 * ***Style applies; continuity reports, by default.*** [24 §2c.2] decided
 * continuity in so many words — *"emits notices, never effects… a checker
 * confident enough to rewrite the story would be worse than the problem"* — so
 * a finding is a line on the message it is about, with the exact words and a
 * fix, and applying one is the edit gesture: a sibling authored with the fix.
 * `se.edit.continuity.apply` is Marinara's own behaviour, opt-in and labelled.
 *
 * *Immersive HTML is not here, and that is a refusal* (§1.9.4): model-authored
 * markup rendered from this server's origin is a script-injection surface, and
 * [10 §8.1] keeps `html: string` out of the widget vocabulary for that reason.
 */

export const SE_SCENE_EDIT = 'se.scene.edit';

/** Scene's id, spelled again for `tracking.ts`'s reason (a TDZ across the `mode.ts` cycle). */
const OWNER = 'storyengine.scene';

const SWITCH: Omit<ChannelDefinition, 'id'> = {
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
 * ***Edit replies for style*** — Marinara's prose guardian switch
 * (`prose-guardian` in `activeAgentIds`). User-only, for the trackers' reasons:
 * a model call per message is the person's to spend, and a switch that is a
 * channel is branch-correct and where an import can put Marinara's. **Off.**
 */
export const STYLE_ON: ChannelDefinition = { ...SWITCH, id: 'se.edit.style.on' };

/** ***Check replies for continuity*** — Marinara's `continuity` agent. **Off.** */
export const CONTINUITY_ON: ChannelDefinition = { ...SWITCH, id: 'se.edit.continuity.on' };

/**
 * ***Let the editor fix continuity itself*** — §1.9.4's *"a session setting
 * `continuity: 'apply'`"*, as a switch. *A switch rather than a two-valued
 * setting* because the widget vocabulary has no choice arm and this is the one
 * setting that would need it: off is `notice` (the default, findings listed on
 * the message), on is `apply` (the editor folds its fixes into the edit, as
 * Marinara's does). Drawn only while continuity is on.
 */
export const CONTINUITY_APPLY: ChannelDefinition = {
  ...SWITCH,
  id: 'se.edit.continuity.apply',
  enabledBy: CONTINUITY_ON.id,
};

/**
 * ***Hold replies until the editor is done*** — Marinara's
 * `proseGuardianHoldForRewrite`, whose default is on
 * (`readSharedHoldForRewrite`: anything but an explicit `false`). While it is
 * on and the editor is, a round streams to the transcript only once the edit
 * is in (`StepDefinition.revises.hold`). *No `enabledBy`*: it serves either
 * switch, and a channel names one.
 */
export const HOLD: ChannelDefinition = {
  ...SWITCH,
  id: 'se.edit.hold',
  init: { kind: 'literal', value: true },
};

const TEXT = 2000;

const STYLE_DEFAULT = {
  banned: 'ozone',
  avoid:
    'Repeating phrases or sentence shapes from the last few messages; opening with dialogue when the last reply did; purple prose.',
  prefer: '',
};

/**
 * ***What the style editor is told*** — Marinara's three prose-guardian
 * settings (`proseGuardianBannedWords`, `…AvoidInstructions`,
 * `…StyleInstructions`), per session as there. *The defaults are Marinara's in
 * substance* (`applyProseGuardianChatSettings`: *ozone* banned, repetition and
 * purple prose avoided, nothing preferred), in this pack's words.
 */
export const STYLE: ChannelDefinition = {
  id: 'se.edit.style',
  owner: OWNER,
  version: 1,
  scope: 'session',
  update: 'user-only',
  visibility: 'player',
  schema: {
    type: 'object',
    properties: {
      banned: { type: 'string', maxLength: TEXT },
      avoid: { type: 'string', maxLength: TEXT },
      prefer: { type: 'string', maxLength: TEXT },
    },
    required: ['banned', 'avoid', 'prefer'],
    additionalProperties: false,
  },
  init: { kind: 'literal', value: STYLE_DEFAULT },
  budget: null,
  enabledBy: STYLE_ON.id,
};

export const EDIT_CHANNELS: readonly ChannelDefinition[] = [
  STYLE_ON,
  STYLE,
  CONTINUITY_ON,
  CONTINUITY_APPLY,
  HOLD,
];

const AGENTS = 'Agents';

/** Under *Agents*, beside the trackers and the secret plot — [P13 §1.9.6]. */
export const EDIT_SURFACES: readonly SurfaceContribution[] = [
  {
    region: 'settings',
    group: AGENTS,
    channelId: STYLE_ON.id,
    widget: {
      kind: 'toggle',
      label: 'Edit replies for style: a model rewrites each reply against your rules',
    },
  },
  {
    region: 'settings',
    group: AGENTS,
    channelId: STYLE.id,
    widget: {
      kind: 'record',
      label: 'The style editor’s rules',
      fields: [
        { key: 'banned', label: 'Banned words and phrases', show: 'line' },
        { key: 'avoid', label: 'Avoid', show: 'line' },
        { key: 'prefer', label: 'Prefer', show: 'line' },
      ],
    },
  },
  {
    region: 'settings',
    group: AGENTS,
    channelId: CONTINUITY_ON.id,
    widget: {
      kind: 'toggle',
      label: 'Check replies for continuity: what a reply gets wrong is listed on it',
    },
  },
  {
    region: 'settings',
    group: AGENTS,
    channelId: CONTINUITY_APPLY.id,
    widget: { kind: 'toggle', label: 'Let the editor fix continuity itself' },
  },
  {
    region: 'settings',
    group: AGENTS,
    channelId: HOLD.id,
    widget: { kind: 'toggle', label: 'Show replies only once the editor is done with them' },
  },
];

/** How many earlier story turns the editor reads, for continuity. */
const RECENT_TURNS = 6;
const TURN_CHARS = 1200;

export const EDIT_STEP: StepDefinition = {
  id: SE_SCENE_EDIT,
  /**
   * **`post`, and first among Scene's `post` steps**, so the stager, the
   * trackers and every engine step after them (mentions, the judge, the
   * suggester, memory, a picture) read the edited prose, which is the prose
   * the turn is written with.
   */
  stage: 'post',
  reads: [
    'output',
    'transcript',
    'cast',
    STYLE_ON.id,
    STYLE.id,
    CONTINUITY_ON.id,
    CONTINUITY_APPLY.id,
  ],
  writes: [],
  callKind: 'edit',
  /** *Every turn, and the step decides* — the trackers' reason ([25 C17]). */
  when: { when: 'cadence', everyNTurns: 1 },
  /** **`warn`**: a reply the editor could not reach is still the reply. */
  failure: 'warn',
  /** `prose`, for [25 C15]'s reason; `stepRoles` at this id binds a cheaper model. */
  role: 'prose',
  revises: { enabledBy: [STYLE_ON.id, CONTINUITY_ON.id], hold: HOLD.id },
};

const ANSWER_SCHEMA = {
  type: 'object',
  properties: {
    editNeeded: { type: 'boolean' },
    editedText: { type: 'string' },
    changes: {
      type: 'array',
      items: {
        type: 'object',
        properties: { description: { type: 'string' } },
        required: ['description'],
      },
    },
    issues: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          issue: { type: 'string' },
          quote: { type: 'string' },
          fix: { type: 'string' },
        },
        required: ['issue'],
      },
    },
  },
  required: ['editNeeded', 'editedText', 'changes'],
} as const;

/**
 * ***The pass*** — one call per message this turn wrote, in order.
 *
 * **Per message, whatever the dispatch** — §1.9.4's *"under `per-actor`
 * dispatch it edits each message on its own"*: a `merged` or narrated turn is
 * one message, so the loop is one call there. *Carried messages are skipped*,
 * which is a swipe's earlier lines — an earlier turn's work, already edited or
 * not when it was written — and an empty one has nothing to edit.
 *
 * **Any call failing fails the step**, `warn`: the engine then lets the round
 * through unedited, and an edit applied to the first speaker and not the
 * second is a round nobody would guess at from the record.
 */
export async function edit(input: StepInput, host: StepHost): Promise<StepResult> {
  const style = on(input, STYLE_ON.id);
  const continuity = on(input, CONTINUITY_ON.id);
  if ((!style && !continuity) || input.output === undefined) return {};
  const apply = continuity && on(input, CONTINUITY_APPLY.id);
  // A session that never touched the rules reads them as declared.
  const rules = style ? rulesOf(input.channels[STYLE.id]?.value ?? STYLE_DEFAULT) : null;

  const messages: readonly OutputMessage[] = input.output.messages ?? [
    { speaker: null, text: input.output.text },
  ];
  const revisions: MessageRevision[] = [];
  for (const [index, message] of messages.entries()) {
    if (message.carried === true || message.text.trim() === '') continue;
    const result = await host.call({
      candidates: [
        block('se.scene.edit.task', 'system', taskText(style, continuity, apply)),
        ...(rules === null ? [] : [block('se.scene.edit.rules', 'system', rules)]),
        ...(continuity
          ? [block('se.scene.edit.recent', 'user', recentText(input, input.cast ?? []))]
          : []),
        block('se.scene.edit.reply', 'user', replyText(message)),
      ],
      schema: ANSWER_SCHEMA,
    });
    const revision = revisionOf(
      index,
      message.text,
      result.object,
      style || apply,
      continuity && !apply,
    );
    if (revision !== null) revisions.push(revision);
  }
  return revisions.length === 0 ? {} : { revisions };
}

/**
 * ***What the model's answer revises*** — Marinara's contract read as its
 * applier reads it (`editNeeded` false is no edit whatever `editedText` says;
 * `true` with an empty text is no edit either). *A malformed answer fails the
 * step*, the trackers' rule: an editor that silently did nothing reads as
 * *nothing needed changing*, which the model did not say.
 *
 * Findings are kept only when continuity reports (`notice`); under `apply`
 * they are the edit's business. A finding's `quote` is kept only when it is
 * in the text the message will carry — the edited text when there is one —
 * because applying it substitutes there; one that is not is kept as a line to
 * read without its fix.
 *
 * ***No rewrite unless something may rewrite*** (`mayRewrite`, style on or
 * continuity applying): continuity under `notice` *"emits notices, never
 * effects"* ([24 §2c.2]), so a rewrite the model returned anyway is dropped,
 * and the findings' quotes are matched against the unedited text.
 */
function revisionOf(
  index: number,
  was: string,
  answer: unknown,
  mayRewrite: boolean,
  noticing: boolean,
): MessageRevision | null {
  if (typeof answer !== 'object' || answer === null || Array.isArray(answer)) {
    throw new Error('The model did not answer with an edit.');
  }
  const held = answer as Record<string, unknown>;
  if (typeof held['editNeeded'] !== 'boolean') {
    throw new Error('The model did not say whether an edit was needed.');
  }
  const edited =
    held['editNeeded'] && typeof held['editedText'] === 'string' ? held['editedText'].trim() : '';
  const text = mayRewrite && edited !== '' && edited !== was.trim() ? edited : null;
  const changes =
    text === null
      ? []
      : listOf(held['changes'])
          .map((change) =>
            typeof change === 'string'
              ? change
              : str((change as Record<string, unknown>)['description']),
          )
          .map((change) => change.trim())
          .filter((change) => change !== '')
          .slice(0, 12);
  const final = text ?? was;
  const notices: RevisionNotice[] = noticing
    ? listOf(held['issues'])
        .flatMap((raw): RevisionNotice[] => {
          const row = raw as Record<string, unknown>;
          const issue = str(row['issue']).trim();
          if (issue === '') return [];
          const quote = str(row['quote']);
          const fix = str(row['fix']);
          return [
            {
              issue: issue.slice(0, 500),
              ...(quote !== '' && final.includes(quote) && typeof row['fix'] === 'string'
                ? { quote, fix }
                : {}),
            },
          ];
        })
        .slice(0, 8)
    : [];
  if (text === null && notices.length === 0) return null;
  return {
    index,
    ...(text === null ? {} : { text }),
    ...(changes.length === 0 ? {} : { changes }),
    ...(notices.length === 0 ? {} : { notices }),
  };
}

/**
 * ***What the editor is asked*** — Marinara's combined-editor instruction
 * (`buildMergedRewritePrompt`) in substance, in this pack's words: rewrite
 * only the reply, preserve what happens, and answer in one object. The
 * continuity half is ours: under `notice` it lists and does not fix.
 */
function taskText(style: boolean, continuity: boolean, apply: boolean): string {
  return [
    'You are the editor of one reply in an ongoing story. You never add story beats.',
    'Preserve every event, fact, line of dialogue, speaker, order and formatting of the reply unless an instruction below requires the change.',
    ...(style
      ? [
          '',
          'Style: rewrite the reply only where it breaks the rules you are given. Remove every banned word or phrase.',
        ]
      : []),
    ...(continuity
      ? apply
        ? [
            '',
            'Continuity: fix, in the reply, anything that contradicts what the story has established (where people are, what they hold, what they know, what time it is). Physical continuity outranks style.',
          ]
        : [
            '',
            'Continuity: do not fix contradictions with what the story has established. List each one in issues instead: issue says what is wrong; quote is the exact words of the reply as you return it; fix is the words that should replace them.',
          ]
      : []),
    '',
    // Under notice alone nothing may rewrite, so the rewrite shape is not
    // offered: the schema still wants the three fields, answered empty.
    ...(style || apply
      ? [
          'Answer with one object: {"editNeeded": false, "editedText": "", "changes": []} when nothing needs rewriting,',
          'or {"editNeeded": true, "editedText": "the whole reply, rewritten", "changes": [{"description": "what you changed"}]}.',
          'editedText is always the entire reply, never a part of it or a comment on it.',
        ]
      : [
          'Do not rewrite the reply. Answer with one object: {"editNeeded": false, "editedText": "", "changes": [], "issues": [...]}.',
        ]),
    ...(continuity && !apply ? ['Add "issues": [] with what you found, or leave it empty.'] : []),
  ].join('\n');
}

function rulesOf(value: unknown): string | null {
  const held =
    typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
  const lines = [
    ['Banned words and phrases', str(held['banned'])],
    ['Avoid', str(held['avoid'])],
    ['Prefer', str(held['prefer'])],
  ]
    .filter(([, text]) => text?.trim() !== '')
    .map(([label, text]) => `${label ?? ''}: ${(text ?? '').trim()}`);
  return lines.length === 0 ? null : lines.join('\n');
}

function replyText(message: OutputMessage): string {
  const who = message.speaker === null ? 'the narrator' : message.speaker.name;
  return [`The reply to edit, written as ${who}:`, '', message.text].join('\n');
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
    ? 'Nothing has happened before this reply.'
    : ['What the story has established, most recent last:', '', ...said].join('\n\n');
}

function on(input: StepInput, id: string): boolean {
  return input.channels[id]?.value === true;
}

function listOf(value: unknown): unknown[] {
  return Array.isArray(value)
    ? value.filter((one) => typeof one === 'object' || typeof one === 'string')
    : [];
}

function str(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function block(id: string, role: 'system' | 'user', text: string): Candidate {
  return {
    id,
    source: { kind: 'step', stepId: SE_SCENE_EDIT },
    reason: 'editor',
    role,
    text,
    required: true,
  };
}
