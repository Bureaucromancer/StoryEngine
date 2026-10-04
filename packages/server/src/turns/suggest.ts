// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import type {
  Candidate,
  ChannelDefinition,
  StepDefinition,
  StepHost,
  StepImplementation,
  StepInput,
} from '@storyengine/sdk';

import { initialValue } from '../sessions/channels.js';

/**
 * What the player could do next —
 * [06 §7.3](../../../../docs/design/06-modes-and-turn-pipeline.md)'s *suggested
 * actions*, [R11](../../../../docs/design/workplan/22-walkthrough-refinements.md),
 * built at [P7.9](../../../../docs/design/workplan/23-p7-implementation.md).
 *
 * ***R11's shape survived contact with the code***, which is true of three of
 * the eleven refinements and of this one in full: *"suggested actions, pre-1.0,
 * per-session toggle, keep the unselected."* What it did not settle is **where
 * the unselected ones live**, and [22 §4] says why that is not a detail:
 * *"R11's 'save unselected suggestions' is a persisted-shape requirement, and
 * that puts it on the critical path to P11's export freeze rather than in the
 * discretionary pile."*
 *
 * ***The fork, and the answer.*** §4 names it exactly: *"turn segments are
 * append-only and never rewritten, so suggestions generated after a turn commits
 * cannot be added to its record — which forces a fork the note does not mention:
 * generate them inside the turn as a `post` step, or store them on the mutable
 * half beside `lastSelectedChild`."*
 *
 * **They go on the turn, as a `post` step, and the argument is about what a
 * suggestion *is*.** It is a reading of one turn's ending — the same reading the
 * model had just done to write it — so it belongs to that turn the way `spans`
 * and `hooks` do, and the three consequences follow for free:
 *
 * - **A rewind takes them back.** State at a node is a function of the path
 *   ([07 §2]); suggestions stored beside `lastSelectedChild` would be a map
 *   keyed by turn id that survives its turn being rewound past, which is a stale
 *   offer to do something in a story that no longer happened.
 * - **A branch inherits them by inheriting its turn**, with no reconciliation
 *   and no second rule.
 * - ***Kept, unselected, by construction.*** R11 asks for that specifically, and
 *   the append-only record is the one place in this build where *kept* needs no
 *   mechanism: what the turn recorded is what it recorded, and a player picking
 *   one does not edit it.
 *
 * *And the mutable half would have needed a garbage collector*, which is the
 * practical half of the same point: a map growing one entry per turn forever,
 * pruned by nothing, in a file that is rewritten on every write.
 *
 * ***The toggle is a gate inside the step rather than a condition on it***,
 * which is the arrangement [P7.5]'s pacing gate settled and for the same reason:
 * {@link StepCondition} has three arms — cadence, stage, armed — and *"a channel
 * predicate"* is not one of them yet. A step that returns before calling costs a
 * function call; a step that could not express its own gate would have needed
 * the condition vocabulary widened for one consumer.
 */

export const SE_SUGGEST = 'se.suggest';

/**
 * ***R11's per-session toggle***, declared by the mode that offers suggestions.
 *
 * **`user-only`, and it is the only policy that reads right.** A model turning
 * its own suggestions on would be a narrator deciding to offer the player
 * choices; the engine turning them on would be a production setting
 * ([00 §3.2]). R11 asks for *per-session*, and a channel is what per-session
 * means in this build — it branches, it is recorded, and rewinding past the
 * moment somebody turned it off turns it back on.
 *
 * ***Off by default, which is a decision R11 does not make and somebody has
 * to.*** The first draft of this said *on*, on the grounds that a feature
 * nobody finds is a feature nobody has — and it was wrong about what it costs.
 * **A suggestion is a second model call on every turn**, which on a self-hosted
 * build is not a rounding error: it is the player's own GPU, roughly doubling
 * the wait between pressing Send and reading the next paragraph, for a list they
 * may never look at. [00 §3.2]'s *no production settings* is about the opposite
 * failure and the instinct underneath is the same one — **do not spend
 * somebody's machine on their behalf.**
 *
 * *So the discoverability problem is answered by a surface rather than by a
 * default*: the control is on the play screen whether or not it is on, which is
 * [work plan §2.3]'s standing line doing the work the default was being asked to
 * do.
 *
 * *`visibility: 'player'`* so the HUD can carry it, and no `surface` yet: the
 * control belongs beside the suggestions, and that is a layout a mode cannot
 * declare until `surfaces` is built.
 *
 * ***Owned by a package rather than by a mode, which is the choice R11 does not
 * make and [06 §7.3] argues for.*** R11 names suggested actions under Freeform,
 * and the section they come from says the opposite about the class of thing:
 * *"Generalising it means Scene and Freeform get it free — which is exactly the
 * cross-pollination the requirements ask for."* The step is engine-owned and
 * reads nothing but the turn's own prose, so there is nothing mode-shaped about
 * it; routing the channel through one mode's declaration would make the second
 * mode either import the first or declare a rival `se.suggest`, which is
 * `registerChannel`'s last-write-wins rule being asked to arbitrate — the
 * argument `HOOK_PACING_CHANNEL` already made, one dial over.
 */
export const SUGGEST_CHANNEL: ChannelDefinition = suggestChannel('storyengine.suggest');

function suggestChannel(owner: string): ChannelDefinition {
  return {
    id: SE_SUGGEST,
    owner,
    version: 1,
    scope: 'session',
    update: 'user-only',
    visibility: 'player',
    schema: { type: 'boolean' },
    init: { kind: 'literal', value: false },
    budget: null,
  };
}

/**
 * Whether this session wants them.
 *
 * *Absent reads as the declaration*, through `initialValue`, for the reason
 * `readPacing`'s fourth rung does: the channel is what says what unspecified
 * means, and a restated `?? true` here would be a second statement of it.
 */
export function readSuggesting(channels: Readonly<Record<string, { value: unknown }>>): boolean {
  const value = channels[SE_SUGGEST]?.value ?? initialValue(SE_SUGGEST);
  return value === true;
}

export const SUGGEST_STEP: StepDefinition = {
  id: SE_SUGGEST,
  stage: 'post',
  reads: ['history', 'output'],
  // Nothing: what this produces lands on the turn through the runner, the way a
  // hook selection and a span set do. A `writes` entry would also cost the
  // `prose` purpose, which this step does not want and does not use.
  writes: [],
  callKind: 'suggest',
  when: { when: 'cadence', everyNTurns: 1 },
  /**
   * **`warn`, never `abort`** — the prose exists by the time a `post` step runs,
   * and a turn thrown away over a list of suggestions would be the tail wagging
   * the story. A player with no suggestions has a text box.
   */
  failure: 'warn',
  /**
   * `prose`, for [25 C15]'s reason: `resolveRole` has no cross-role fallback and
   * nothing in this build binds any role but this one, so asking for `fast`
   * would make every suggesting session log a failed step. An install that wants
   * something cheaper says so through the session's `stepRoles`.
   */
  role: 'prose',
};

/** How many to ask for. */
export const SUGGEST_COUNT = 3;

export interface SuggestReport {
  /** What the model offered, in the order it offered them. Empty if it declined. */
  actions: readonly string[];
}

export interface SuggestContext {
  /**
   * Whether the session wants them — the per-session toggle R11 asks for,
   * resolved by the caller because it is channel state.
   */
  enabled: boolean;
  report: (report: SuggestReport) => void;
}

/**
 * ***What it asks for, and the two things it is told not to do.***
 *
 * A suggestion that spoils is worse than no suggestion — [08 §6] makes unfired
 * hidden content hidden from the *player*, and a list of next actions is exactly
 * the surface where a model that has read the hook pool would leak one. It has
 * not read the pool; what it has is the prose, which is the only material a
 * suggestion may be a reading of.
 *
 * And a suggestion must be *an action*, not a narration: R11's offer is
 * something a player can press to submit, so *"you decide to look under the
 * bed"* is a turn somebody else took.
 */
const TASK = [
  'Suggest what the player could do next.',
  '',
  /**
   * ***As the list the schema reads*** (2026-09-27). This line asked for
   * *one per line, no numbering* while the same call's schema asks for an
   * object, and on an endpoint that ignores `response_format` — the ordinary
   * self-hosted case, where the schema is asked for in words after this — a
   * model followed the first format it was given: three plain lines, a reply
   * that does not parse, and two identical retries. Three calls a turn, and no
   * suggestions.
   */
  `Give exactly ${String(SUGGEST_COUNT)} short actions, as the "actions" list.`,
  'Each must be something the player could do right now, phrased as an instruction they would type.',
  'Write them in the second person and keep each under twelve words.',
  'Do not narrate an outcome, and do not suggest anything the story has not shown them.',
].join('\n');

const SCHEMA = {
  type: 'object',
  properties: {
    actions: {
      type: 'array',
      items: { type: 'string', minLength: 1, maxLength: 200 },
      maxItems: SUGGEST_COUNT,
    },
  },
  required: ['actions'],
  additionalProperties: false,
};

export function suggest(context: SuggestContext): {
  definition: StepDefinition;
  run: StepImplementation;
} {
  return {
    definition: SUGGEST_STEP,
    run: async (input: StepInput, host: StepHost) => {
      // The toggle, and a turn that narrated nothing. Both answer the same way
      // and neither costs a call.
      const prose = input.output?.text ?? '';
      if (!context.enabled || prose.trim() === '') {
        context.report({ actions: [] });
        return {};
      }

      const result = await host.call({
        candidates: [
          block('se.suggest.task', 'system', TASK),
          block('se.suggest.turn', 'user', prose),
        ],
        schema: SCHEMA,
      });

      context.report({ actions: readActions(result.object) });
      return {};
    },
  };
}

/**
 * **Read defensively, because a refusal is a normal answer here.** A model that
 * returns nothing, returns prose, or returns four when asked for three has not
 * broken anything: the step is `warn`, the player has a text box, and the worst
 * available outcome is a malformed suggestion rendered as a button.
 *
 * *Trimmed and de-duplicated*, because three identical offers is the failure a
 * reader would blame the feature for rather than the model.
 */
function readActions(object: unknown): string[] {
  if (typeof object !== 'object' || object === null) return [];
  const actions = (object as { actions?: unknown }).actions;
  if (!Array.isArray(actions)) return [];

  const kept: string[] = [];
  for (const action of actions) {
    if (typeof action !== 'string') continue;
    const text = action.trim();
    if (text === '' || kept.includes(text)) continue;
    kept.push(text);
    if (kept.length === SUGGEST_COUNT) break;
  }
  return kept;
}

/**
 * *A local helper, like the judge's and the selector's.* Three steps now build
 * their own candidates this way and the repetition is deliberate for as long as
 * it is three lines: what would be shared is a `reason` string, which is
 * author-facing English about **this** step and is the one part that must not be.
 */
function block(id: string, role: 'system' | 'user', text: string): Candidate {
  return {
    id,
    source: { kind: 'step', stepId: SE_SUGGEST },
    reason: 'suggested actions',
    role,
    text,
    required: true,
  };
}
