// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import type {
  Candidate,
  StepCallResult,
  StepDefinition,
  StepImplementation,
  StepInput,
} from '@storyengine/sdk';
import { outputMessagesOf, type SpeakerPick, type Turn } from '@storyengine/shared';

import { scanText } from '../assembly/pictures.js';
import type { ChatSettings } from '../sessions/chat-settings.js';
import { isStoryTurn } from '../sessions/depth.js';

import { saysSomething } from './speakers.js';

/**
 * ***Smart order*** — a model asked who replies, when no rule has already said —
 * [P13 §1.3a](../../../../docs/design/workplan/30-p13-scene-and-session-import.md),
 * built at [P13.1](../../../../docs/design/workplan/30-p13-scene-and-session-import.md).
 *
 * Marinara's `smart` order (`generate.routes.ts:5306-5456`) is the best answer
 * either source has to *"who would actually speak now?"*, and the only arm whose
 * answer is a judgement rather than a rule. **This takes that behaviour and
 * builds it the way the hook selector is built** (`turns/hook-selector.ts`,
 * [P7.5]), because that step is this build's existing answer to *a cheap engine
 * judgement before the prose* and every decision it made about cost, failure
 * and trust applies here unchanged:
 *
 * - **an engine-owned `pre` step**, planned by the runner and never by
 *   `planFor`, because what it reads — who is eligible, the session's hidden
 *   lines, the rules' fallback — is the session's and not a mode's;
 * - **its own candidates**, so neither the preset nor the retriever runs and the
 *   call costs a roster and six lines rather than the scene;
 * - **a closed answer enforced twice**, by an `enum` schema and again by the
 *   reader, because [P7.4] measured that nothing validates the degraded path;
 * - **`failure: 'warn'` and a deterministic fallback**, so a broken call never
 *   costs somebody their turn and never lands anywhere a replay would not;
 * - **a report cell**, because who speaks is not something a `StepResult` may
 *   carry.
 *
 * ***Most turns never get here, and that is the design rather than an
 * optimisation.*** `selectSpeakers`' `smart` arm answers force-talk, a mention
 * and a room of one without a model ([P13 §1.3a]'s first table), and only a
 * turn none of those settles is handed to this step — with `natural`'s pick
 * already drawn on the tape as what it lands on if the call does not work out.
 * In a three-person scene where the player addresses somebody by name, that is
 * not most turns.
 */

/**
 * The step id, which is also what a session's `stepRoles` names to point this
 * one call at a cheaper model — §1.3a point 5, and the reason the role below can
 * afford to be `prose`.
 *
 * `se.speakers.smart` rather than `se.smart`: the namespace is the thing
 * decided, as `se.hooks.select` is, and `smart` is which of the six arms asked.
 */
export const SE_SPEAKERS_SMART = 'se.speakers.smart';

/**
 * ***How many characters of a member's `se.summary` the roster carries*** —
 * §1.3a's *"the first ~300 characters"*. Marinara sends 500 of personality and
 * 500 of description per member; this is one field, and the one the card
 * schema calls *"the always-present core, short by design"*. Enough to know who
 * someone is, and a roster of eight still costs less than one reply.
 */
const SUMMARY_CHARS = 300;

/**
 * ***What just happened: six messages, each cut to ~600 characters*** —
 * §1.3a's numbers. Marinara sends five exchanges at 900; six messages is a
 * three-way exchange twice round, which is how far back *who is being spoken
 * to* usually reaches, and the cut keeps one long monologue from being the
 * whole of the context.
 */
const RECENT_MESSAGES = 6;
const MESSAGE_CHARS = 600;

/**
 * ***How much of a `because` the record keeps*** — one line, and a length the
 * workbench can show without folding. The model is asked for one short line;
 * this is what holds when it writes a paragraph, because the line lands on a
 * turn record that is kept for as long as the story is.
 */
const BECAUSE_CHARS = 200;

/**
 * ***Temperature 0.2, as Marinara's*** (`generate.routes.ts:5427`) — §1.3a
 * point 5. A choice among a handful of ids wants the model's most likely
 * answer rather than its most interesting one, and *low* rather than zero
 * keeps a tie between two equally apt speakers from resolving the same way on
 * every reroll, which is the one gesture that asks again on purpose.
 */
const SMART_TEMPERATURE = 0.2;

export const SMART_SPEAKERS_STEP: StepDefinition = {
  id: SE_SPEAKERS_SMART,
  /**
   * **`pre`, because the answer is who the rest of the turn is for.** Speakers
   * are selected once, before the loop, and handed to every step; this is the
   * one step that may change that answer, so it has to run before any step
   * that reads it — and the runner places it first of all, ahead even of the
   * other `pre` steps, since nothing they do depends on who speaks and a turn
   * cancelled early should have settled the question it is most about.
   */
  stage: 'pre',
  /**
   * **`history` for the last six messages and who spoke when, and nothing
   * else.** The roster, the hidden map and the fallback arrive resolved in the
   * context — a step does not go shopping, the hook selector's rule — and no
   * channel is read: eligibility was decided by the rules before this step was
   * planned, and a second reading of presence here could only disagree with it.
   */
  reads: ['history'],
  writes: [],
  // No `contributes`: what this produces is who speaks, which reaches the
  // steps after it as `StepInput.speakers` through the runner's cell — never as
  // a candidate, and never as an effect a mode could have proposed instead.
  callKind: 'speaker-select',
  when: { when: 'cadence', everyNTurns: 1 },
  /**
   * **`warn`, never `abort`** — §1.3a point 4, and [00 §3.3]'s rule that a
   * broken piece of machinery must not cost somebody their turn. A call that
   * fails lands on `natural`'s pick, already on the tape; the turn goes on, and
   * the outcome says it was the rules' pick and why.
   */
  failure: 'warn',
  /**
   * ***`prose`, and that is deliberate*** — §1.3a point 5, and the hook
   * selector's finding word for word.
   *
   * *Cheap* names `fast`, and `resolveRole` has no cross-role fallback: a role
   * nobody bound resolves `unbound` and the step fails. Nothing in the build
   * binds anything but `prose`, so declaring `fast` would make every smart turn
   * on a stock install a warned step that played the fallback — a `smart`
   * setting that silently meant `natural`, which is the failure [00 §3.3]
   * refuses, arrived at by asking for the right thing. *The cheapness is a
   * property of the call* — a roster and six lines — and an install that wants
   * a smaller model for it points the session's `stepRoles` at this step's id,
   * which is the case that layer exists for.
   */
  role: 'prose',
};

/**
 * One member the model may choose, as the runner resolved them.
 *
 * *Resolved rather than read here*: the name is the card's, the talkativeness
 * is read under the session's own mode id (`talkativenessOf`), and the summary
 * is a section of the card — none of which a step should reach for.
 */
export interface SmartMember {
  id: string;
  name: string;
  talkativeness: number;
  /** The card's `se.summary` body, whole; the prompt cuts it. Empty when it has none. */
  summary: string;
}

export interface SmartSpeakersContext {
  /**
   * Who may be chosen, in cast order — the eligible members `selectSpeakers`
   * handed back in `ask`, and nobody else. **The enum and the reader both close
   * over this list**, so an id outside it cannot reach `StepInput.speakers` by
   * either path.
   */
  eligible: readonly SmartMember[];
  /**
   * Everybody who might have said something on the path, by id — the cast,
   * eligible or not — so a line spoken by a muted member still reads as theirs.
   * A message whose speaker is not here falls back to the name its `Ref`
   * carries.
   */
  names: ReadonlyMap<string, string>;
  /** The persona's name, for the player's lines; null reads as *the player*. */
  player: string | null;
  /**
   * The session's hidden lines, `chatSettingsOf(...).hidden` — §1.3a point 2:
   * *"hidden lines are excluded, because the orchestrator sees what the
   * characters see"*.
   */
  hidden: ChatSettings['hidden'];
  /**
   * ***`natural`'s pick, drawn on the tape before this step ran*** — §1.3a
   * point 4. What every failure lands on, and what the runner has already
   * handed the steps as `speakers`; this step only ever *replaces* it.
   */
  fallback: readonly string[];
  /** The session's `speakers.maxPerRound` — the most one answer may name. */
  maxPerRound: number;
  /**
   * ***Present on a rewrite***, carrying the redone turn's speakers — §1.3a
   * point 7. A rewrite makes no call: *"not that sentence"* keeps who spoke,
   * and only a reroll asks again.
   */
  rewrite: { kept: readonly string[] } | null;
  /**
   * Where the pick goes — the runner's cell. **Called exactly once on every
   * path that does not end in a Stop**, success or failure, so the outcome
   * always says who spoke and how they were chosen.
   */
  report: (pick: SpeakerPick) => void;
}

/**
 * Builds the engine's own `{ definition, run }` pair for a turn — a function
 * rather than a constant for the hook selector's reason: the roster, the
 * fallback and the hidden lines are facts about this session at this node, and
 * the plan is rebuilt every turn anyway.
 */
export function smartSpeakers(context: SmartSpeakersContext): {
  definition: StepDefinition;
  run: StepImplementation;
} {
  const nameOf = (id: string): string =>
    context.eligible.find((member) => member.id === id)?.name ?? context.names.get(id) ?? id;
  const picks = (ids: readonly string[]): SpeakerPick['picked'] =>
    ids.map((id) => ({ id, name: nameOf(id) }));

  return {
    definition: SMART_SPEAKERS_STEP,
    run: async (input, host) => {
      /**
       * ***A rewrite keeps the speakers, and a reroll asks again*** — §1.3a
       * point 7, which is the line [07] draws between *"not that sentence"* and
       * *"not that outcome"*. Who replies is the outcome; the call is not made.
       *
       * *Filtered to who may be chosen now*, as the reader filters an answer —
       * the node is the same one the redone turn answered at, so this drops
       * nobody in the ordinary case, and it is the guard for the one where a
       * card was since deleted. **Nobody left is the tape's pick, not a call**:
       * a redone turn that recorded no speakers was one the rules settled, or
       * one played under another policy, and the tape's `natural` draws are
       * that turn's own — so replaying them is the rewrite, and asking a model
       * would be the reroll the person did not press.
       */
      if (context.rewrite !== null) {
        const allowed = new Set(context.eligible.map((member) => member.id));
        const kept = [...new Set(context.rewrite.kept)].filter((id) => allowed.has(id));
        context.report({
          by: 'rewrite',
          picked: picks(kept.length > 0 ? kept : context.fallback),
        });
        return {};
      }

      /**
       * ***Every failure lands on the fallback, and says so*** — §1.3a point 4.
       * Reported first and then raised, which is the summariser's arrangement:
       * the outcome records who spoke instead, and the error — classified by
       * the runner, so a timeout is still `transient` and an unbound role still
       * `unbound` — records why. *Not on a Stop*: a cancelled turn played
       * nobody, and an outcome claiming the rules' pick played would be wrong
       * about a turn that never ran.
       */
      const fallBack = (): void => {
        if (!host.signal.aborted)
          context.report({ by: 'fallback', picked: picks(context.fallback) });
      };

      const max = Math.min(context.maxPerRound, context.eligible.length);
      let result: StepCallResult;
      try {
        result = await host.call({
          candidates: [
            block('se.speakers.smart.task', 'system', task(max)),
            block('se.speakers.smart.roster', 'system', rosterText(context, input.history ?? [])),
            block('se.speakers.smart.recent', 'user', recentText(context, input)),
          ],
          schema: pickSchema(
            context.eligible.map((member) => member.id),
            max,
          ),
          params: { temperature: SMART_TEMPERATURE },
        });
      } catch (error) {
        fallBack();
        throw error;
      }

      /**
       * **The object when the call produced one, and the text when it did
       * not.** `performCall` withholds an object that failed the schema — a
       * name where an id belongs is exactly that — and the text is still the
       * model's answer. Reading it is what lets §1.3a's *"a name instead of an
       * id is accepted"* hold on the path where it matters, since a name is
       * never a member of the enum.
       */
      const reading = readPick(result.object ?? result.text, context.eligible, max);
      if (!reading.ok) {
        fallBack();
        throw new Error(UNUSABLE[reading.why]);
      }
      context.report({ by: 'model', picked: reading.picked });
      return {};
    },
  };
}

/**
 * What an unusable answer says on the outcome — a sentence per class, for
 * `missMessage`'s reason: *"the model did not answer with JSON"* is something a
 * person can act on, and a class name is not. **None of them quotes the
 * answer**: the message reaches the log too, and [21 §4.1] keeps model output
 * out of it — the call's own record is where a person reads what came back.
 */
const UNUSABLE: Record<Exclude<PickReading, { ok: true }>['why'], string> = {
  unreadable:
    'The model’s answer could not be read as a list of who should reply, so the rule-based pick played.',
  empty: 'The model named nobody to reply, so the rule-based pick played.',
  ineligible: 'The model named nobody who can reply here, so the rule-based pick played.',
};

/**
 * ***The question, in our words*** — §1.3a point 2, which is Marinara's
 * instruction in substance (`generate.routes.ts:5351-5354`): usually one,
 * several only with a reason each, and not the same character twice running.
 *
 * **In the engine and not in the pack**, for the hook selector's reason: this is
 * the sentence that makes the schema answerable, and a pack able to edit it
 * could make the answer not parse.
 *
 * *No "or nobody"*, and that is §1.3a's deliberate omission: a smart arm that
 * could answer nobody would make *let them talk* silently do nothing, which is
 * what `manual` is for. `minItems: 1` is the guard, and this is the sentence
 * that asks for what the guard enforces.
 */
function task(max: number): string {
  return [
    'You decide who speaks next in a group conversation. You do not write what they say.',
    'Name the members who should reply to the latest message, in the order they should speak,',
    'using their ids from the roster.',
    'Usually name exactly one. Name more than one only when each of them has an immediate',
    'reason of their own to reply.',
    'Do not name whoever spoke last unless the latest message is addressed to them.',
    `Name at most ${String(max)}. For each, you may add one short line saying why.`,
  ].join('\n');
}

/**
 * ***The roster*** — each eligible member's id, name, talkativeness, the start
 * of their summary, and how long since they last spoke (§1.3a point 2).
 *
 * *Rounds since they last spoke* is the half of Marinara's *"who has spoken
 * recently"* that six lines cannot carry: a member silent for ten rounds and one
 * who has never spoken read the same in a window that shows neither, and the
 * question is partly whose turn it is.
 */
function rosterText(context: SmartSpeakersContext, history: readonly Turn[]): string {
  const rounds = roundsSinceSpoke(history, context.hidden);
  const lines = context.eligible.map((member) => {
    const ago = rounds.get(member.id);
    const spoke =
      ago === undefined
        ? 'has not spoken yet'
        : `last spoke ${String(ago)} ${ago === 1 ? 'round' : 'rounds'} ago`;
    const head = `${member.id}: ${member.name} — talkativeness ${formatTalk(member.talkativeness)}; ${spoke}`;
    const summary = cut(member.summary, SUMMARY_CHARS);
    return summary === '' ? head : `${head}\n${summary}`;
  });
  return [
    'Who can reply. Talkativeness runs from 0 (speaks only when it is needed) to 1 (joins in',
    'whenever they can).',
    '',
    lines.join('\n\n'),
  ].join('\n');
}

/**
 * ***What just happened*** — the last six messages, oldest first, each named
 * and cut (§1.3a point 2), ending on the move this turn answers when it says
 * anything.
 *
 * **Hidden lines are left out**, by `chatSoFar`'s keying: a whole turn when it is
 * hidden, input and all, and the listed indices of its output's messages when
 * it is not. *"The orchestrator sees what the characters see"* — a line hidden
 * from the prompt that still steered who answered it would be the hidden line
 * leaking by the side door.
 */
function recentText(context: SmartSpeakersContext, input: StepInput): string {
  const player = context.player === null ? 'The player' : `${context.player} (the player)`;
  const said: string[] = [];

  for (const turn of input.history ?? []) {
    const held = context.hidden[turn.id];
    if (held === true) continue;
    if (saysSomething(turn.input))
      said.push(`${player}: ${cut(scanText(turn.input), MESSAGE_CHARS)}`);
    for (const [index, message] of outputMessagesOf(turn.output).entries()) {
      if (message.text === '' || held?.includes(index) === true) continue;
      const who =
        message.speaker === null
          ? 'Narrator'
          : (context.names.get(message.speaker.id) ?? message.speaker.name);
      said.push(`${who}: ${cut(message.text, MESSAGE_CHARS)}`);
    }
  }
  if (saysSomething(input.input))
    said.push(`${player}: ${cut(scanText(input.input), MESSAGE_CHARS)}`);

  const recent = said.slice(-RECENT_MESSAGES);
  return recent.length === 0
    ? 'Nothing has been said yet.'
    : ['The conversation so far, oldest first:', '', ...recent].join('\n');
}

/**
 * How many rounds ago each member last said something that is not hidden — 1 is
 * the last story turn on the path. **Story turns**, by `isStoryTurn`, so a HUD
 * edit or a backdrop choice between two replies is not a round nobody spoke in.
 */
function roundsSinceSpoke(
  history: readonly Turn[],
  hidden: ChatSettings['hidden'],
): Map<string, number> {
  const rounds = new Map<string, number>();
  let ago = 0;
  for (let at = history.length - 1; at >= 0; at -= 1) {
    const turn = history[at];
    if (turn === undefined || !isStoryTurn(turn)) continue;
    ago += 1;
    const held = hidden[turn.id];
    if (held === true) continue;
    for (const [index, message] of outputMessagesOf(turn.output).entries()) {
      if (message.speaker === null || message.text === '' || held?.includes(index) === true) {
        continue;
      }
      if (!rounds.has(message.speaker.id)) rounds.set(message.speaker.id, ago);
    }
  }
  return rounds;
}

/**
 * ***The answer's shape*** — §1.3a point 3: the eligible ids as an `enum`,
 * `minItems: 1`, `maxItems` the most one round may name, and an optional
 * `because` on each.
 *
 * ***Wrapped in an object, where §1.3a writes a bare array — a deliberate
 * difference.*** A structured-output endpoint wants an object at the root:
 * OpenAI's `json_schema` response format takes nothing else, and the SDK's own
 * `Output.array` wraps its array as `{ elements: [...] }` for exactly that
 * reason — read in the `ai` package this workspace pins, and not something its
 * `Output.object`, which the adapter uses, does on our behalf. A bare array
 * would be a schema the one path that validates on the wire could not be
 * sent. The reader still takes a bare array, because a model asked in words
 * writes one anyway — Marinara asks for exactly that (`:5362`).
 *
 * `maxItems` is capped by the eligible count as well as by `maxPerRound`, so
 * the schema never allows more distinct answers than there are people.
 */
function pickSchema(ids: readonly string[], max: number): object {
  return {
    type: 'object',
    properties: {
      speakers: {
        type: 'array',
        minItems: 1,
        maxItems: max,
        items: {
          type: 'object',
          properties: {
            id: { type: 'string', enum: [...ids] },
            because: { type: 'string' },
          },
          required: ['id'],
          additionalProperties: false,
        },
      },
    },
    required: ['speakers'],
    additionalProperties: false,
  };
}

/** What the reader made of an answer. */
export type PickReading =
  | { ok: true; picked: SpeakerPick['picked'] }
  | {
      ok: false;
      /**
       * `unreadable` — no list of speakers could be found in it; `empty` — a
       * list with nobody on it, which `minItems: 1` forbids and the degraded
       * path cannot enforce; `ineligible` — a list naming nobody who may reply.
       */
      why: 'unreadable' | 'empty' | 'ineligible';
    };

/**
 * ***The second enforcement*** — §1.3a point 3, and the hook selector's reason
 * word for word: [P7.4] measured that `jsonSchema()` is not validated on the
 * degraded path, and *"a model naming an ineligible hook is the failure [06
 * §6.1] warns about"*. So, whatever the schema said:
 *
 * - **filtered to the eligible** — an id nobody may choose is dropped, not
 *   trusted;
 * - **a name accepted when it matches exactly one eligible member**, because
 *   Marinara found models do that (`:5262-5304`) — and *exactly one*, because a
 *   name two members share names neither of them;
 * - **de-duplicated**, first mention kept, and **capped** at `max`.
 *
 * *Lenient about the wrapping and strict about the content*, which is the
 * right way round: a local model asked in words wraps JSON in a code fence or a
 * sentence often enough that refusing it would make `smart` mean `natural` on
 * exactly the installs least able to afford a second try — so the first JSON
 * value in the text is read, as Marinara's parser does (`:5262-5277`). What is
 * in it is then held to the eligible list without exception.
 */
export function readPick(
  answer: unknown,
  eligible: readonly SmartMember[],
  max: number,
): PickReading {
  const value = typeof answer === 'string' ? firstJson(answer) : answer;
  const listed = Array.isArray(value)
    ? (value as unknown[])
    : isRecord(value) && Array.isArray(value['speakers'])
      ? (value['speakers'] as unknown[])
      : undefined;
  if (listed === undefined) return { ok: false, why: 'unreadable' };
  if (listed.length === 0) return { ok: false, why: 'empty' };

  const picked: SpeakerPick['picked'] = [];
  for (const item of listed) {
    if (picked.length >= max) break;
    const named = namedIn(item);
    if (named === null) continue;
    const member = memberFor(named.token, eligible);
    if (member === undefined || picked.some((one) => one.id === member.id)) continue;
    const because = named.because === undefined ? '' : oneLine(named.because);
    picked.push({ id: member.id, name: member.name, ...(because === '' ? {} : { because }) });
  }
  return picked.length === 0 ? { ok: false, why: 'ineligible' } : { ok: true, picked };
}

/**
 * The id or name an item names, and its `because`. A bare string is an id or a
 * name with no reason given — the shape a model asked in words most often
 * writes. `name` is read where `id` is missing, for the reason a name is
 * accepted at all.
 */
function namedIn(item: unknown): { token: string; because?: string } | null {
  if (typeof item === 'string') return { token: item };
  if (!isRecord(item)) return null;
  const token = typeof item['id'] === 'string' ? item['id'] : item['name'];
  if (typeof token !== 'string') return null;
  const because = item['because'];
  return typeof because === 'string' ? { token, because } : { token };
}

/**
 * The eligible member a token names: an exact id, else a name matching **exactly
 * one** of them once case, spacing and composition are set aside.
 */
function memberFor(token: string, eligible: readonly SmartMember[]): SmartMember | undefined {
  const exact = eligible.find((member) => member.id === token.trim());
  if (exact !== undefined) return exact;
  const wanted = normalName(token);
  const byName = eligible.filter((member) => normalName(member.name) === wanted);
  return byName.length === 1 ? byName[0] : undefined;
}

function normalName(value: string): string {
  return value.normalize('NFC').trim().replace(/\s+/gu, ' ').toLowerCase();
}

/**
 * The first JSON array or object in a string, or undefined. From the first
 * opening bracket to the last matching close, which is Marinara's reading and
 * enough for *a fence, a sentence, then the answer*.
 */
function firstJson(text: string): unknown {
  const cleaned = text.replace(/```(?:json)?/giu, '').trim();
  const start = cleaned.search(/[[{]/u);
  if (start === -1) return undefined;
  const end = cleaned.lastIndexOf(cleaned[start] === '[' ? ']' : '}');
  if (end < start) return undefined;
  try {
    return JSON.parse(cleaned.slice(start, end + 1)) as unknown;
  } catch {
    return undefined;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** A `because`, as the record keeps it: its first line, cut. */
function oneLine(value: string): string {
  return cut(value.trim().split(/\r?\n/u)[0] ?? '', BECAUSE_CHARS);
}

/** Whitespace collapsed, and cut to `limit` characters with an ellipsis when it was longer. */
function cut(value: string, limit: number): string {
  const flat = value.replace(/\s+/gu, ' ').trim();
  return flat.length <= limit ? flat : `${flat.slice(0, limit - 1).trimEnd()}…`;
}

/** Two decimals at most, and none that say nothing: `0.5`, not `0.50`. */
function formatTalk(value: number): string {
  return String(Math.round(value * 100) / 100);
}

function block(id: string, role: 'system' | 'user', text: string): Candidate {
  return {
    id,
    source: { kind: 'step', stepId: SE_SPEAKERS_SMART },
    // Author-facing English, as P2.5 established for `reason`.
    reason: 'choosing who replies',
    role,
    text,
    required: true,
  };
}

/**
 * ***The speakers a rewrite keeps*** — read off the turn it redoes, §1.3a point
 * 7: *"a `rewriteOf` submission carries the redone turn's speakers, read from
 * its messages"*.
 *
 * **The messages first, as §1.3a says**: they are the record of who spoke,
 * and the only one the transcript shows. **Then the turn's own smart pick**,
 * when no message names anybody — and that second source is this file's
 * addition, for a case §1.3a does not reach. A narrator-voiced session speaks
 * in one message by nobody in particular, and so does every merged turn written
 * before [P13.2]'s per-actor dispatch; read from its messages alone, a rewrite
 * of such a turn keeps nobody, and a pick a person watched the workbench make
 * would be quietly replaced by the tape's. The outcome is the record of who the
 * turn was for, even where the prose did not attribute itself.
 *
 * *Empty when neither says*, which the step reads as *replay the tape's pick*.
 * A turn with no smart outcome was one a rule settled, and **not every rule is
 * on the tape**: a mention and a room of one are read again from the input the
 * rewrite resubmits and the room at the parent the two turns share, but
 * force-talk is neither a draw nor a model's answer. The route restores it
 * separately, from `Turn.input.speakers` into the payload's `speakers`, which
 * settles the rewrite before the rules ask — so this step is not planned for
 * it, and what this returns for a forced turn is never read.
 */
export function keptSpeakers(turn: Turn): string[] {
  const said = outputMessagesOf(turn.output).flatMap((message) =>
    message.speaker === null || message.text === '' ? [] : [message.speaker.id],
  );
  if (said.length > 0) return [...new Set(said)];
  const outcome = turn.steps?.find((step) => step.stepId === SE_SPEAKERS_SMART);
  return (outcome?.speakers?.picked ?? []).map((one) => one.id);
}
