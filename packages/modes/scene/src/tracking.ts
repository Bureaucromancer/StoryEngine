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
  TranscriptTurn,
} from '@storyengine/sdk';

/**
 * ***Marinara's trackers, as Scene's channels and one step*** —
 * [P13 §1.9.2](../../../../docs/design/workplan/30-p13-scene-and-session-import.md),
 * built at [P13.5a].
 *
 * [06 §6] said it before this phase did: *"Marinara's agents … are all steps
 * under this definition, differing only in stage and cadence"*, and [06 §4]
 * makes channels *"the generalisation of Marinara's HUD widgets / trackers /
 * game state"*. So what Marinara keeps as `game_state_snapshots` rows keyed
 * `(chatId, messageId, swipeIndex)` — with a commit flag and a branch-copy of
 * every snapshot — is here **an effect on the turn that produced it**, and a
 * swipe having its own tracker state is the tree doing what it always did.
 *
 * ***What the story has established, as a model reading it reports*** — and
 * that is the line between this file and Campaign's library. No arithmetic, no
 * rules: a sword is in the inventory because the prose said the player picked
 * it up. [P13 §1.9.2]'s correction (2026-09-29) is the other half: these are
 * the subjects' channels and 5.0 **inherits** them, changing the update policy
 * of the ones it makes mechanical. That is why the ids are the subjects'
 * (`se.track.inventory`) rather than a roleplay flavour of them.
 *
 * *The value shapes are Marinara's stored ones* (`game-state.ts:54-164`,
 * `quest-state.ts`, the result appliers at `generate.routes.ts:8243-8930`),
 * with our field names where §1.9.2's table gives them. Its prompts are not
 * taken and could not be: the agents' manifests ship as downloadable packages,
 * not in its repository.
 */

export const SE_SCENE_TRACK = 'se.scene.track';

/**
 * Scene's id, **spelled again rather than imported from `mode.ts`**: that file
 * imports this one, and a `const` read across the cycle at module evaluation is
 * a TDZ `ReferenceError` — the cycle [P7.0] moved the channel type out of the
 * engine to dissolve. `mode.test.ts` pins the two spellings together.
 */
const OWNER = 'storyengine.scene';

/**
 * ***The switches, and why they are channels*** — the representation
 * [P13 §1.9.6] leaves to the build: *"switches in the session's settings"*.
 *
 * **User-only channels, not a `session.trackers` field**, for four reasons that
 * each settle it:
 *
 * 1. *The engine may not name a mode's content.* A field on the session record
 *    is engine schema; `session.trackers.world` would be the engine knowing
 *    Scene has a world tracker. A channel is declared here and the engine only
 *    ever sees ids.
 * 2. *The step gates itself on a declared read*, which is [P7.12]'s staging
 *    toggle exactly (`se.staging`): `planFor` zips every step a mode declares,
 *    so a mode's step cannot be kept out of a plan and has to look.
 * 3. *A switch is then branch-correct and undoable for nothing*: switching the
 *    inventory on is a `user` effect on an engine turn, written through the
 *    `PUT /sessions/:id/channels/:key` every channel already has.
 * 4. *An import has somewhere to put Marinara's settings* ([P13 §2.6]:
 *    `activeAgentIds`, `manualTrackers`): effects on the root turn, like every
 *    other piece of imported channel state, rather than a second write path.
 *
 * One boolean per tracker rather than one set-valued channel, because a
 * boolean is what the vocabulary's `toggle` widget already renders and what
 * `EstablishedState.enabledBy` can name. **All off**: [00 §4]'s *"RPG systems
 * are opt-in channels"*, and each one costs tokens in every later prompt.
 */
function toggle(id: string): ChannelDefinition {
  return {
    id,
    owner: OWNER,
    version: 1,
    scope: 'session',
    // The person whose model pays for the call decides, as with staging.
    update: 'user-only',
    visibility: 'player',
    schema: { type: 'boolean' },
    init: { kind: 'literal', value: false },
    budget: null,
  };
}

/** Short free text: a mood, a date, a place. Capped so a runaway answer fails the schema. */
const LINE = { type: 'string', maxLength: 500 } as const;
/** A name that rows are matched and locked by. */
const NAME = { type: 'string', minLength: 1, maxLength: 120 } as const;

/** Marinara's `CharacterStat` (`game-state.ts`): a bar with a ceiling. */
const STAT = {
  type: 'object',
  properties: {
    name: NAME,
    value: { type: 'number' },
    max: { type: 'number' },
    color: { type: 'string', maxLength: 32 },
  },
  required: ['name', 'value', 'max'],
  additionalProperties: false,
} as const;

/** An inventory row: Marinara's `InventoryTrackerRow`, `qty` optional as there. */
const ITEM = {
  type: 'object',
  properties: { name: NAME, qty: { type: 'number' } },
  required: ['name'],
  additionalProperties: false,
} as const;

function list(items: object, maxItems = 50): object {
  return { type: 'array', items, maxItems };
}

const WORLD_SCHEMA = {
  type: 'object',
  properties: {
    date: LINE,
    time: LINE,
    location: LINE,
    weather: LINE,
    temperature: LINE,
    // Marinara's `worldCustomFields`, as rows so a lock can name one.
    fields: list({
      type: 'object',
      properties: { name: NAME, value: LINE },
      required: ['name', 'value'],
      additionalProperties: false,
    }),
    // Its `recentEvents`: a handful of lines, newest last.
    recent: list(LINE, 10),
  },
  required: ['date', 'time', 'location', 'weather', 'temperature', 'fields', 'recent'],
  additionalProperties: false,
} as const;

const CHARACTER_SCHEMA = {
  type: 'object',
  properties: {
    mood: LINE,
    appearance: LINE,
    outfit: LINE,
    thoughts: LINE,
    /**
     * ***A field map, and the beholder folds in here*** — [P13 §1.9.5]:
     * worn, holding, wounds as fields rather than a seventh channel, *"without
     * a second per-actor tracker to keep in step with the first"*. Our choice,
     * not Marinara's.
     */
    fields: { type: 'object', additionalProperties: LINE, maxProperties: 30 },
    stats: list(STAT, 20),
  },
  required: ['mood', 'appearance', 'outfit', 'thoughts', 'fields', 'stats'],
  additionalProperties: false,
} as const;

const PERSONA_SCHEMA = {
  type: 'object',
  properties: { status: LINE, stats: list(STAT, 20) },
  required: ['status', 'stats'],
  additionalProperties: false,
} as const;

/** Marinara's stored `QuestProgress` (`game-state.ts:158`), our names. */
const QUESTS_SCHEMA = list({
  type: 'object',
  properties: {
    name: NAME,
    stage: LINE,
    objectives: list(
      {
        type: 'object',
        properties: { text: { ...LINE, minLength: 1 }, completed: { type: 'boolean' } },
        required: ['text', 'completed'],
        additionalProperties: false,
      },
      30,
    ),
    completed: { type: 'boolean' },
  },
  required: ['name', 'objectives', 'completed'],
  additionalProperties: false,
});

/**
 * Three groups, each replaced whole when named and kept when not — Marinara's
 * inventory tracker. *Persona-stats' own `InventoryItem`s fold into
 * `inventory`* ([P13 §1.9.2]'s table), so there is one place a sword can be.
 */
const INVENTORY_SCHEMA = {
  type: 'object',
  properties: { currencies: list(ITEM), equipped: list(ITEM), inventory: list(ITEM, 100) },
  required: ['currencies', 'equipped', 'inventory'],
  additionalProperties: false,
} as const;

/** Rows whose names a person defines; the model only ever fills values. */
const CUSTOM_SCHEMA = list({
  type: 'object',
  properties: { name: NAME, value: { type: ['string', 'number', 'boolean'] } },
  required: ['name', 'value'],
  additionalProperties: false,
});

/**
 * One tracker: the channel, its switch, and the name its part of the answer
 * goes under. `answer` is the model's word, not the channel's, because a model
 * reads `"characters": { "Vera": … }` more easily than a channel id.
 */
interface Tracker {
  channel: ChannelDefinition;
  toggle: ChannelDefinition;
  answer: 'world' | 'characters' | 'persona' | 'quests' | 'inventory' | 'custom';
  empty: unknown;
}

function tracker(
  id: string,
  answer: Tracker['answer'],
  shape: {
    scope?: 'actor';
    schema: object;
    empty: unknown;
    render: string;
    budget: number;
    label: string;
  },
): Tracker {
  const on = toggle(`${id}.on`);
  return {
    answer,
    empty: shape.empty,
    toggle: on,
    channel: {
      id,
      owner: OWNER,
      version: 1,
      scope: shape.scope ?? 'session',
      /**
       * ***`model-proposed`***: a judgement about prose, which a model makes and
       * `refuse()` admits from a step — and a person's edit is admitted too, so
       * *Marinara's manual override is simply the latest effect* ([P13 §1.9.2]).
       */
      update: 'model-proposed',
      visibility: 'player',
      schema: shape.schema,
      init: { kind: 'literal', value: shape.empty },
      render: shape.render,
      budget: shape.budget,
      state: { label: shape.label, enabledBy: on.id },
    },
  };
}

/**
 * ***How each reads in the established-state block*** — Liquid over the value,
 * as every channel's `render` is. The collector drops the blank lines the
 * `{% if %}` arms leave, so these are written for legibility rather than for
 * whitespace control; an empty value renders nothing and its heading goes too.
 *
 * *Budgets are ceilings with slack*, the posture the clock's takes: a guard
 * against a value that grew, not a target. The whole block at every budget is
 * about 1,200 tokens with two characters, which is the price a person pays for
 * switching all six on — and why none is on by default.
 */
const STAT_LINE = '{% for s in stats %}{{ s.name }}: {{ s.value }}/{{ s.max }}\n{% endfor %}';

export const WORLD = tracker('se.track.world', 'world', {
  schema: WORLD_SCHEMA,
  empty: { date: '', time: '', location: '', weather: '', temperature: '', fields: [], recent: [] },
  render: [
    '{% if date != "" %}Date: {{ date }}{% endif %}',
    '{% if time != "" %}Time: {{ time }}{% endif %}',
    '{% if location != "" %}Location: {{ location }}{% endif %}',
    '{% if weather != "" %}Weather: {{ weather }}{% endif %}',
    '{% if temperature != "" %}Temperature: {{ temperature }}{% endif %}',
    '{% for f in fields %}{{ f.name }}: {{ f.value }}\n{% endfor %}',
    '{% if recent.size > 0 %}Recently: {{ recent | join: "; " }}{% endif %}',
  ].join('\n'),
  budget: 200,
  label: 'The world',
});

export const CHARACTER = tracker('se.track.character', 'characters', {
  scope: 'actor',
  schema: CHARACTER_SCHEMA,
  empty: { mood: '', appearance: '', outfit: '', thoughts: '', fields: {}, stats: [] },
  render: [
    '{% if mood != "" %}Mood: {{ mood }}{% endif %}',
    '{% if appearance != "" %}Appearance: {{ appearance }}{% endif %}',
    '{% if outfit != "" %}Outfit: {{ outfit }}{% endif %}',
    '{% if thoughts != "" %}Thoughts: {{ thoughts }}{% endif %}',
    '{% for f in fields %}{{ f[0] }}: {{ f[1] }}\n{% endfor %}',
    STAT_LINE,
  ].join('\n'),
  budget: 200,
  label: 'Character',
});

export const PERSONA = tracker('se.track.persona', 'persona', {
  schema: PERSONA_SCHEMA,
  empty: { status: '', stats: [] },
  render: ['{% if status != "" %}Status: {{ status }}{% endif %}', STAT_LINE].join('\n'),
  budget: 120,
  label: 'The player’s character',
});

export const QUESTS = tracker('se.track.quests', 'quests', {
  schema: QUESTS_SCHEMA,
  empty: [],
  render: [
    '{% for q in value %}',
    '{{ q.name }}{% if q.completed %} (done){% endif %}{% if q.stage and q.stage != "" %} — {{ q.stage }}{% endif %}',
    '{% for o in q.objectives %}- [{% if o.completed %}x{% else %} {% endif %}] {{ o.text }}',
    '{% endfor %}{% endfor %}',
  ].join('\n'),
  budget: 300,
  label: 'Quests',
});

const ITEMS = (group: string, label: string): string =>
  `{% if ${group}.size > 0 %}${label}: {% for i in ${group} %}{{ i.name }}{% if i.qty %} ×{{ i.qty }}{% endif %}{% unless forloop.last %}, {% endunless %}{% endfor %}{% endif %}`;

export const INVENTORY = tracker('se.track.inventory', 'inventory', {
  schema: INVENTORY_SCHEMA,
  empty: { currencies: [], equipped: [], inventory: [] },
  render: [
    ITEMS('currencies', 'Money'),
    ITEMS('equipped', 'Equipped'),
    ITEMS('inventory', 'Carrying'),
  ].join('\n'),
  budget: 200,
  label: 'Inventory',
});

export const CUSTOM = tracker('se.track.custom', 'custom', {
  schema: CUSTOM_SCHEMA,
  empty: [],
  render: '{% for f in value %}{{ f.name }}: {{ f.value }}\n{% endfor %}',
  budget: 150,
  label: 'Also tracked',
});

/** In declaration order, which is the order the state block and the answer read in. */
export const TRACKERS: readonly Tracker[] = [WORLD, CHARACTER, PERSONA, QUESTS, INVENTORY, CUSTOM];

/**
 * ***Fields the model may not change*** — [P13 §1.9.2]'s locks.
 *
 * A set of **field paths**: a channel key, then a JSON Pointer into its value
 * (`se.track.world/location`, `se.track.character#<actorId>/mood`). A row in
 * a list is addressed by its `name` — or its `text`, for an objective — rather
 * than its index, because the model reorders lists and a lock on *the third
 * item* would follow whatever moved there; Marinara reached the same answer
 * and migrated its index keys to name keys (`tracker-field-locks.ts:76`). A
 * bare key locks the whole value. See {@link trackerPath}.
 *
 * *User-only*: a lock the model could lift would be a suggestion.
 */
export const LOCKS: ChannelDefinition = {
  id: 'se.track.locks',
  owner: OWNER,
  version: 1,
  scope: 'session',
  update: 'user-only',
  visibility: 'player',
  schema: { type: 'array', items: { type: 'string', minLength: 1 }, uniqueItems: true },
  init: { kind: 'literal', value: [] },
  budget: null,
};

/**
 * ***Fields the player would rather not see*** — [P13 §1.9.2]: *"the
 * channel's `visibility`, extended to a field list the same way"* as the locks.
 *
 * **Hidden from the reader, not from the narrator**, and that is Marinara's
 * meaning too: its `hiddenTrackerFields` are read only by its HUD components
 * (`RoleplayHUDPanels.tsx`, the tracker cards). A character's thoughts are the
 * case — worth the narrator knowing, a spoiler on the panel. The engine reads
 * nothing here; the tracker panel does. Same path grammar as {@link LOCKS}.
 */
export const HIDDEN: ChannelDefinition = { ...LOCKS, id: 'se.track.hidden' };

/**
 * ***When the step runs*** — Marinara's `runInterval` and `manualTrackers`
 * ([P13 §1.9.2]'s *cadence and manual mode*), one session setting.
 *
 * *A channel for the switches' reasons*, and one channel rather than two
 * because the two are one answer to *when*: every *n*th story turn, or only
 * when asked. `everyNTurns` counts story turns on the path, which is what the
 * engine's own cadence counts (`evaluateCondition`), so a branch that rewinds
 * gets the cadence the rewound turns had.
 */
export const CADENCE: ChannelDefinition = {
  id: 'se.track.cadence',
  owner: OWNER,
  version: 1,
  scope: 'session',
  update: 'user-only',
  visibility: 'player',
  schema: {
    type: 'object',
    properties: {
      everyNTurns: { type: 'integer', minimum: 1, maximum: 100 },
      manual: { type: 'boolean' },
    },
    required: ['everyNTurns', 'manual'],
    additionalProperties: false,
  },
  init: { kind: 'literal', value: { everyNTurns: 1, manual: false } },
  budget: null,
};

export const TRACKING_CHANNELS: readonly ChannelDefinition[] = [
  ...TRACKERS.flatMap((one) => [one.channel, one.toggle]),
  LOCKS,
  HIDDEN,
  CADENCE,
];

/**
 * How many earlier story turns the model is shown beside this one — *"the last
 * few messages"*. Enough that a location settled two turns ago is in view; few
 * enough that the call stays small, since the current values carry everything
 * older.
 */
const RECENT_TURNS = 3;

export const TRACK_STEP: StepDefinition = {
  id: SE_SCENE_TRACK,
  stage: 'post',
  /**
   * The trackers and their switches, the locks and the cadence — and
   * `transcript`, for the last few turns *and* for the count the cadence is
   * taken over. `cast` for who the characters are. **Not `history`**: a step
   * that read twenty turns and the whole record would be paying for context the
   * current values already summarise.
   */
  reads: [
    'output',
    'transcript',
    'cast',
    ...TRACKERS.flatMap((one) => [one.channel.id, one.toggle.id]),
    LOCKS.id,
    CADENCE.id,
  ],
  writes: TRACKERS.map((one) => one.channel.id),
  contributes: 'effects',
  callKind: 'track',
  /**
   * *Every turn, and the step decides* — for the reason the staging step's
   * gate gives: a mode cannot keep its own step out of a plan, and the cadence
   * is a session's rather than the declaration's.
   */
  when: { when: 'cadence', everyNTurns: 1 },
  /**
   * **`warn`**: the prose exists by now, and a turn thrown away because a
   * tracker could not be updated would be the bookkeeping deciding whether the
   * scene happened.
   */
  failure: 'warn',
  /** `prose`, for [25 C15]'s reason, and `stepRoles` binds a cheaper model here. */
  role: 'prose',
  /** *Update trackers* — the one on-demand step in this phase ([P13 §1.9.2]). */
  onDemand: true,
};

/**
 * What the model is asked. *A reading, never an invention* — the staging
 * step's rule — and *absent is not empty*, which is Marinara's
 * (`generate-route-utils.ts:205`): leaving a part out keeps it.
 */
const TASK = [
  'You keep track of what the story has established. Below is the tracked state as it stands, a few earlier turns, and the turn that just happened.',
  '',
  'Answer with the tracked state as it is AFTER this turn, in the same shape.',
  '- Change only what the story has actually shown: a character moving somewhere, an item changing hands, a quest advancing, a mood shifting. Never invent.',
  '- Leave out any part that did not change. A part you leave out keeps its current value; a part you include replaces it whole, so include every item of any list you send.',
  '- Keep names exactly as they are written, so an item or a quest stays the same item or quest.',
  '- For the custom fields, fill values only for the names given.',
].join('\n');

/** The session's cadence, read defensively: a value that is not the shape is the default. */
function cadenceOf(channels: StepInput['channels']): { everyNTurns: number; manual: boolean } {
  const value = channels[CADENCE.id]?.value;
  if (typeof value !== 'object' || value === null) return { everyNTurns: 1, manual: false };
  const { everyNTurns, manual } = value as { everyNTurns?: unknown; manual?: unknown };
  return {
    everyNTurns:
      typeof everyNTurns === 'number' && Number.isInteger(everyNTurns) && everyNTurns >= 1
        ? everyNTurns
        : 1,
    manual: manual === true,
  };
}

/**
 * The characters the tracker follows, each under a name the model can read.
 *
 * *Everyone in the cast but the persona*, who has a tracker of their own
 * ({@link CastEntry.persona}). Two members with one name are told apart by a
 * number, because the answer is keyed by name and a collision would write one
 * person's mood onto the other.
 */
function charactersOf(cast: readonly CastEntry[]): { actorId: string; label: string }[] {
  const seen = new Map<string, number>();
  return cast
    .filter((member) => member.persona !== true)
    .map((member) => {
      const count = (seen.get(member.name) ?? 0) + 1;
      seen.set(member.name, count);
      return {
        actorId: member.actorId,
        label: count === 1 ? member.name : `${member.name} (${String(count)})`,
      };
    });
}

/**
 * ***The step*** — one structured call over every tracker that is on.
 *
 * **One call, not one per tracker**: Marinara's batching
 * (`agent-pipeline.ts:76-142`, agents sharing a model share a call), and
 * [25 C18]'s *"three `post` steps make three calls over the same prose"*
 * answered for this case. The schema is the enabled trackers' schemas side by
 * side, loosened so that any part may be left out.
 *
 * ***Its candidates are its own***: the current values, the last few turns and
 * this one — never the scene prompt, which is the whole story and the cards
 * and has nothing in it this question needs.
 *
 * Four gates before anything is spent, none of which costs a call: no tracker
 * on; manual mode on a turn nobody asked for; not a cadence turn; nothing said.
 */
export async function track(input: StepInput, host: StepHost): Promise<StepResult> {
  const on = TRACKERS.filter((one) => input.channels[one.toggle.id]?.value === true);
  if (on.length === 0) return {};

  if (input.onDemand !== true) {
    const cadence = cadenceOf(input.channels);
    if (cadence.manual) return {};
    // Over the story turns before this one, as the engine counts its own.
    const before = input.transcript?.length ?? 0;
    if ((before + 1) % cadence.everyNTurns !== 0) return {};
  }

  const cast = input.cast ?? [];
  const player = cast.find((member) => member.persona === true)?.name ?? null;
  const said = [input.input?.text ?? '', input.output?.text ?? ''].join('').trim();
  if (said === '') return {};

  const characters = charactersOf(cast);
  // A character tracker with nobody to track has nothing to ask about.
  const asking = on.filter((one) => one !== CHARACTER || characters.length > 0);
  const customNames = namesOf(current(input, CUSTOM, null));
  const asked = asking.filter((one) => one !== CUSTOM || customNames.length > 0);
  if (asked.length === 0) return {};

  const result = await host.call({
    candidates: [
      block('se.scene.track.task', 'system', TASK),
      block(
        'se.scene.track.state',
        'system',
        `The tracked state now:\n${JSON.stringify(stateNow(input, asked, characters), null, 2)}`,
      ),
      ...(recent(input.transcript ?? [], player) === ''
        ? []
        : [
            block(
              'se.scene.track.recent',
              'user',
              `Earlier:\n${recent(input.transcript ?? [], player)}`,
            ),
          ]),
      block('se.scene.track.turn', 'user', `This turn:\n${thisTurn(input, player)}`),
    ],
    schema: schemaFor(asked, characters, customNames),
  });

  /**
   * ***An answer that is not the shape is the step's failure***, not a quiet
   * nothing — the host hands `object: undefined` when the check missed. The
   * staging step shrugs at the same thing because a missing face is visible;
   * a tracker that silently did not update reads as *nothing changed*, which
   * is a claim. Failing `warn` puts the miss on the record.
   */
  if (typeof result.object !== 'object' || result.object === null) {
    throw new Error('The model did not answer with the tracked state.');
  }
  const answer = result.object as Record<string, unknown>;
  const locks = locksOf(input.channels);
  const by = { kind: 'model' as const, callId: result.callId };

  const effects: EffectProposal[] = [];
  const propose = (one: Tracker, scopeKey: string | null, given: unknown): void => {
    if (given === undefined) return;
    const was = current(input, one, scopeKey);
    const merged = merge(one, was, given);
    const key = scopeKey === null ? one.channel.id : `${one.channel.id}#${scopeKey}`;
    const next = writeBack(merged, was, locks, key);
    // Unchanged is not proposed: an effect is a claim that something moved,
    // and a turn whose record said every tracker was set would be noise.
    if (same(next, was)) return;
    effects.push({
      channelId: one.channel.id,
      ...(scopeKey === null ? {} : { scopeKey }),
      op: { type: 'set', path: '/' },
      after: next,
      proposedBy: by,
    });
  };

  for (const one of asked) {
    if (one === CHARACTER) {
      const given = answer['characters'];
      if (typeof given !== 'object' || given === null) continue;
      for (const character of characters) {
        propose(one, character.actorId, (given as Record<string, unknown>)[character.label]);
      }
      continue;
    }
    propose(one, null, answer[one.answer]);
  }

  return effects.length === 0 ? {} : { effects };
}

/** A tracker's value now, or its empty value — the channel's own `init`. */
function current(input: StepInput, one: Tracker, scopeKey: string | null): unknown {
  const key = scopeKey === null ? one.channel.id : `${one.channel.id}#${scopeKey}`;
  return input.channels[key]?.value ?? one.empty;
}

/** The names a person has given the custom tracker. */
function namesOf(custom: unknown): string[] {
  return Array.isArray(custom)
    ? custom.flatMap((row) =>
        typeof row === 'object' &&
        row !== null &&
        typeof (row as { name?: unknown }).name === 'string'
          ? [(row as { name: string }).name]
          : [],
      )
    : [];
}

/**
 * The state the model is shown, **in the shape it answers in** — the clearest
 * instruction a structured answer can have is the thing it is replacing.
 */
function stateNow(
  input: StepInput,
  asked: readonly Tracker[],
  characters: readonly { actorId: string; label: string }[],
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const one of asked) {
    if (one === CHARACTER) {
      out['characters'] = Object.fromEntries(
        characters.map((character) => [character.label, current(input, one, character.actorId)]),
      );
    } else if (one === CUSTOM) {
      out['custom'] = Object.fromEntries(
        (current(input, one, null) as { name: string; value: unknown }[]).map((row) => [
          row.name,
          row.value,
        ]),
      );
    } else {
      out[one.answer] = current(input, one, null);
    }
  }
  return out;
}

/**
 * ***The answer's schema: the enabled channels' schemas side by side***, each
 * loosened one level so a part may be left out — which is how *absent keeps
 * the old value* is said to a model that only reads the schema. The rows keep
 * their own `required`: a stat with no value is not a stat.
 */
function schemaFor(
  asked: readonly Tracker[],
  characters: readonly { label: string }[],
  customNames: readonly string[],
): object {
  const properties: Record<string, object> = {};
  for (const one of asked) {
    if (one === CHARACTER) {
      properties['characters'] = {
        type: 'object',
        properties: Object.fromEntries(
          characters.map((character) => [character.label, loosened(CHARACTER_SCHEMA)]),
        ),
        additionalProperties: false,
      };
    } else if (one === CUSTOM) {
      properties['custom'] = {
        type: 'object',
        properties: Object.fromEntries(
          customNames.map((name) => [name, { type: ['string', 'number', 'boolean'] }]),
        ),
        additionalProperties: false,
      };
    } else {
      properties[one.answer] = loosened(one.channel.schema);
    }
  }
  return { type: 'object', properties, additionalProperties: false };
}

function loosened(schema: object): object {
  return Object.fromEntries(Object.entries(schema).filter(([key]) => key !== 'required'));
}

/**
 * ***What the answer does to the value it replaces*** — whole-value `set`,
 * which is all the effect path accepts (`turns/effects.ts`), built from the
 * old value and the parts the model named.
 *
 * - An object tracker keeps every top-level part the model left out — *a group
 *   the model omits keeps its old value*: the inventory's three groups, the
 *   world's fields, a character's stats — and takes the ones it named whole.
 * - Quests are one list and are replaced when named, as Marinara's are.
 * - The custom tracker takes values for the names a person defined and nothing
 *   else: *whose names a person defines* means a model cannot add a row.
 */
function merge(one: Tracker, was: unknown, given: unknown): unknown {
  if (one === CUSTOM) {
    if (typeof given !== 'object' || given === null || !Array.isArray(was)) return was;
    return (was as { name: string; value: unknown }[]).map((row) => {
      const value = (given as Record<string, unknown>)[row.name];
      return value === undefined ? row : { name: row.name, value };
    });
  }
  if (Array.isArray(one.empty)) return Array.isArray(given) ? given : was;
  if (!isRecord(given) || !isRecord(was)) return was;
  const out: Record<string, unknown> = { ...was };
  for (const key of Object.keys(one.empty as Record<string, unknown>)) {
    if (given[key] !== undefined) out[key] = given[key];
  }
  return out;
}

/** The locks that stand now, read defensively. */
function locksOf(channels: StepInput['channels']): string[] {
  const value = channels[LOCKS.id]?.value;
  return Array.isArray(value) ? value.filter((one): one is string => typeof one === 'string') : [];
}

/**
 * ***A locked field's current value, written back into the proposal before it
 * is proposed*** — Marinara's `applyTrackerFieldLocksToGameStatePatch`
 * (`tracker-field-locks.ts:1043`), over this file's path grammar.
 *
 * *Before proposing* rather than refused after, because a refusal is all or
 * nothing on a whole value: the model's other changes to the same tracker
 * should land while the locked field stays put.
 */
export function writeBack(
  proposed: unknown,
  was: unknown,
  locks: readonly string[],
  key: string,
): unknown {
  let out = proposed;
  for (const lock of locks) {
    const at = lock.indexOf('/');
    const lockKey = at === -1 ? lock : lock.slice(0, at);
    if (lockKey !== key) continue;
    const segments =
      at === -1
        ? []
        : lock
            .slice(at + 1)
            .split('/')
            .map(unescape);
    out = restore(out, was, segments);
  }
  return out;
}

/**
 * Puts `was`'s value at `segments` into `proposed`, and nothing else of it.
 *
 * *A locked row the story did not have stays absent* — a lock on the key to
 * the vault is a lock on its absence too — and *a locked row the model dropped
 * comes back*. An object field absent from both is left absent.
 */
function restore(proposed: unknown, was: unknown, segments: readonly string[]): unknown {
  const [head, ...rest] = segments;
  if (head === undefined) return copied(was);

  if (Array.isArray(proposed)) {
    const rows: unknown[] = proposed;
    const standing: unknown = Array.isArray(was)
      ? (was as unknown[]).find((row) => rowIs(row, head))
      : undefined;
    const index = rows.findIndex((row) => rowIs(row, head));
    if (standing === undefined) {
      return index === -1 ? rows : rows.filter((_, at) => at !== index);
    }
    if (index === -1) return [...rows, copied(standing)];
    const next = [...rows];
    next[index] = restore(rows[index], standing, rest);
    return next;
  }

  if (isRecord(proposed)) {
    const standing = isRecord(was) ? was[head] : undefined;
    if (standing === undefined) {
      return Object.fromEntries(Object.entries(proposed).filter(([key]) => key !== head));
    }
    return { ...proposed, [head]: restore(proposed[head], standing, rest) };
  }
  return proposed;
}

/** A list row is named by its `name`, or by its `text` for an objective. */
function rowIs(row: unknown, segment: string): boolean {
  if (!isRecord(row)) return false;
  return row['name'] === segment || (row['name'] === undefined && row['text'] === segment);
}

/**
 * A deep copy of a JSON value — *JSON because it is one*: every tracker value
 * is plain data by its schema, and this package's `lib` has no
 * `structuredClone`, which is a host global a mode should not assume.
 */
function copied<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

/**
 * ***A field path*** — a channel key, then each segment escaped as JSON Pointer
 * escapes it (`~` as `~0`, `/` as `~1`), so a quest called *Either/Or* is one
 * segment. What {@link LOCKS} and {@link HIDDEN} hold, and what a client
 * writes into them.
 */
export function trackerPath(key: string, ...segments: readonly string[]): string {
  return [key, ...segments.map((one) => one.replaceAll('~', '~0').replaceAll('/', '~1'))].join('/');
}

function unescape(segment: string): string {
  return segment.replaceAll('~1', '/').replaceAll('~0', '~');
}

/**
 * The last few turns, as a reader would have seen them — the player's move
 * under their character's name, then the reply.
 */
function recent(transcript: readonly TranscriptTurn[], player: string | null): string {
  return transcript
    .slice(-RECENT_TURNS)
    .map((turn) => said(turn.input?.text, turn.output?.text, player))
    .filter((text) => text !== '')
    .join('\n\n');
}

function thisTurn(input: StepInput, player: string | null): string {
  return said(input.input?.text, input.output?.text, player);
}

function said(move: string | undefined, reply: string | undefined, player: string | null): string {
  return [
    move === undefined || move.trim() === '' ? '' : `${player ?? 'The player'}: ${move.trim()}`,
    reply?.trim() ?? '',
  ]
    .filter((part) => part !== '')
    .join('\n\n');
}

function same(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** A candidate of this step's own, the way the staging step builds one. */
function block(id: string, role: 'system' | 'user', text: string): Candidate {
  return {
    id,
    source: { kind: 'step', stepId: SE_SCENE_TRACK },
    reason: 'trackers',
    role,
    text,
    required: true,
  };
}
