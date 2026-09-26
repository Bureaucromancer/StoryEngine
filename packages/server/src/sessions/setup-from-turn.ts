// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import {
  blankProvenance,
  newSetup,
  uuidv7,
  type Goal,
  type HookPacing,
  type LoreLink,
  type PlotHook,
  type Setup,
} from '@storyengine/shared';

import type { ResolvedLore } from '../turns/lore.js';
import type { CastMember } from '../turns/cast.js';
import { readParty, SE_PARTY } from './cast.js';
import { splitChannelKey } from './channels.js';
import { readConcluded, readCurrentGoal, readGoalState } from './goals.js';
import { asPacing, readHookState, SE_HOOK_PACING } from './hooks.js';
import type { PooledHook, SessionFile } from './types.js';

/**
 * ***What a Setup made from a turn carries*** —
 * [04 §7.2](../../../../docs/design/04-schemas.md),
 * [P13.5](../../../../docs/design/workplan/30-p13-implementation.md).
 *
 * **Pure, and the most tested file in the phase**, because it is where the two
 * promises the feature makes are kept or broken: that a session started from
 * the Setup begins where this one was, and that the person still playing this
 * one is not told what they have not yet been told.
 *
 * ---
 *
 * ***Four groups cross, and channel state does not.*** [P13 §1.2] is the
 * decision: the party, the goal the story is on, the hooks — unfired ones
 * carried and fired ones spent — and the story so far, which is not here
 * because it is written by a model and edited by a person rather than read off
 * the record. Each crosses through a field a Setup already has or an additive
 * one with a host-owned meaning. **Raw channel values never do**: channel state
 * is [04 §1]'s free-to-move tier and a Setup is its stable one, so a Setup that
 * carried them would freeze every engine channel's shape into a portable format
 * by accident.
 *
 * ***Three functions, for three audiences.***
 *
 * - {@link carryAt} reads the state at a turn into a {@link Carry}. It holds
 *   hidden content — an unfired hook's premise, a hidden goal — and so it is
 *   **only ever held on the server**.
 * - {@link previewOf} is the carry as the wizard may show it: names, the
 *   current goal's statement only when a player may see it, and counts.
 * - {@link buildSetup} is the Setup the commit writes, from a carry the server
 *   **recomputed** — never one a browser sent back.
 *
 * That split is `sessions/promote.ts`'s argument followed through: the panel's
 * view of the pool is a redaction, so a surface that let the client assemble
 * the Setup would have to hand it the unredacted pool first.
 */

export interface Ref {
  id: string;
  name: string;
}

/** Why the goal chain carried what it did — the preview says it in words. */
export type GoalsCarried = 'carried' | 'none' | 'open' | 'concluded';

export interface Carry {
  mode: { id: string; config: unknown };
  treatment: Ref | null;
  /** `null` is *the mode's own*, which is what a session given no preset has. */
  preset: Ref | null;
  persona: Ref | null;
  /** The party at the turn, **without** the persona — see {@link carryAt}. */
  party: Ref[];
  /** The goal the story is on first, then the ones not yet achieved. */
  goals: Goal[];
  goalsCarried: GoalsCarried;
  /** Unfired hooks this session's Setup or the session itself authored. */
  hooks: PlotHook[];
  /** Every hook that had fired by the turn, from any source. */
  spentHooks: string[];
  hookPacing?: HookPacing;
  lore: LoreLink[];
  stagingNotes?: string;
}

/**
 * The state at a turn, as `gatherAssemblyInputs` returns it for that node.
 *
 * *A subset of `AssemblyInputs` rather than the whole*, so the tests can build
 * one out of values and the route passes the gather's result straight through.
 */
export interface CarrySource {
  session: Pick<SessionFile, 'mode' | 'treatment' | 'lore' | 'setup' | 'preset' | 'cast'>;
  channels: Readonly<Record<string, { value: unknown }>>;
  pool: readonly PooledHook[];
  goals: readonly Goal[];
  lore: Pick<ResolvedLore, 'treatment' | 'books'>;
  cast: { persona: CastMember | null; actors: readonly CastMember[] };
  /**
   * The id of the pack the mode ships. A session given no preset holds a copy
   * of it, and a Setup naming it would pin a future session to *this* version
   * of the mode's default — so it is carried as `null`, *the mode's own*, which
   * is what the person chose by choosing nothing.
   */
  defaultPresetId: string | null;
}

export function carryAt(source: CarrySource): Carry {
  const { session, channels } = source;
  const actorName = new Map<string, string>();
  for (const member of [source.cast.persona, ...source.cast.actors]) {
    if (member !== null) actorName.set(member.actor.id, member.actor.name);
  }
  const refTo = (id: string, name: string | undefined): Ref => ({ id, name: name ?? id });

  const personaId = session.cast?.persona ?? null;

  /**
   * ***The party is read off the channel map, not off the cast.*** A seated
   * actor is not a member until something made them one, and a member need not
   * be seated — the channel is the truth, and `readParty` is the reader every
   * other surface uses. **The persona is left out**, because it is in the party
   * by the reader's invariant and a Setup offers it separately, as
   * `personaOptions`.
   */
  const party: Ref[] = [];
  for (const key of Object.keys(channels)) {
    const { channelId, scopeKey } = splitChannelKey(key);
    if (channelId !== SE_PARTY || scopeKey === null || scopeKey === personaId) continue;
    if (readParty(channels, scopeKey, personaId) === null) continue;
    party.push(refTo(scopeKey, actorName.get(scopeKey)));
  }

  const goals = carriedGoals(source.goals, channels);

  /**
   * ***Hooks, split by who owns them.*** A treatment's and a lorebook's hooks
   * come back on their own when a session is started from a Setup that links
   * the same objects — `poolFor` rebuilds the pool from them — so carrying them
   * here would put each one in the new pool twice. What cannot come back on its
   * own is what this session's Setup or the session itself authored, so those
   * are the ones copied, **ids kept** ([15 §5.1]).
   *
   * *Spent is every source*, for the opposite reason: a treatment's hook that
   * fired before this turn **will** come back on its own, fresh, and would fire
   * twice. `provisional` is not spent — it is an introduction the extract stage
   * has not confirmed, and a lapsed one returns to the pool.
   */
  const hooks: PlotHook[] = [];
  const spent: string[] = [];
  const seen = new Set<string>();
  for (const entry of source.pool) {
    const id = entry.hook.id;
    if (seen.has(id)) continue;
    seen.add(id);
    const state = readHookState(channels, id);
    if (state === 'fired') {
      spent.push(id);
      continue;
    }
    if (entry.source.kind === 'setup' || entry.source.kind === 'session') {
      hooks.push(structuredClone(entry.hook));
    }
  }

  /**
   * ***Pacing only when somebody said something.*** The live dial if it was
   * turned, else the Setup's own authored value; never the channel's `init` or
   * the build's fallback, which would write *this build's default* into a file
   * that travels to builds with different ones.
   */
  const pacing = asPacing(channels[SE_HOOK_PACING]?.value) ?? asPacing(session.setup?.hookPacing);

  const bookName = new Map(source.lore.books.map((book) => [book.id, book.book.name]));
  const lore: LoreLink[] = (Array.isArray(session.lore) ? session.lore : []).map((id) => ({
    ref: refTo(id, bookName.get(id)),
    required: false,
  }));

  const treatmentId = typeof session.treatment === 'string' ? session.treatment : '';
  const presetId = session.preset?.id ?? '';

  return {
    mode: {
      id: session.mode?.id ?? '',
      config: structuredClone(session.mode?.config ?? null),
    },
    treatment:
      treatmentId === ''
        ? null
        : refTo(
            treatmentId,
            source.lore.treatment?.id === treatmentId
              ? source.lore.treatment.treatment.name
              : undefined,
          ),
    preset:
      presetId === '' || presetId === source.defaultPresetId
        ? null
        : refTo(presetId, session.preset?.name),
    persona:
      personaId === null || personaId === '' ? null : refTo(personaId, actorName.get(personaId)),
    party,
    goals: goals.goals,
    goalsCarried: goals.why,
    hooks,
    spentHooks: spent,
    ...(pacing === null ? {} : { hookPacing: pacing }),
    lore,
    ...(typeof session.setup?.stagingNotes === 'string' && session.setup.stagingNotes !== ''
      ? { stagingNotes: session.setup.stagingNotes }
      : {}),
  };
}

/**
 * ***`goals[0]` is where play begins*** ([04 §7]), so the goal the story is on
 * goes first and the ones already achieved are dropped — they are the story so
 * far now. **Nothing needs seeding**, because `readCurrentGoal` reads an
 * unwritten cursor as `goals[0]`.
 *
 * *Two states carry nothing, and say why.* A story that was ended carries no
 * goal to begin on; one that answered *continue open* at a completion is on no
 * goal by choice, and handing it the next one would undo a decision somebody
 * made. `next` pointers into a dropped goal are cleared — *null is ask*, and a
 * pointer to nothing would be a chain that breaks at its first completion.
 */
function carriedGoals(
  chain: readonly Goal[],
  channels: Readonly<Record<string, { value: unknown }>>,
): { goals: Goal[]; why: GoalsCarried } {
  if (chain.length === 0) return { goals: [], why: 'none' };
  if (readConcluded(channels)) return { goals: [], why: 'concluded' };
  const current = readCurrentGoal(channels, chain);
  if (current === null) return { goals: [], why: 'open' };

  const kept = [
    current,
    ...chain.filter(
      (goal) => goal.id !== current.id && readGoalState(channels, goal.id) !== 'achieved',
    ),
  ];
  const ids = new Set(kept.map((goal) => goal.id));
  return {
    goals: kept.map((goal) => ({
      ...structuredClone(goal),
      next: goal.next !== null && ids.has(goal.next) ? goal.next : null,
    })),
    why: 'carried',
  };
}

/**
 * ***The carry as the wizard may show it.***
 *
 * **Names and counts, and one sentence.** The party's names are on the cast
 * panel already; the current goal's statement is shown **only** when its
 * `visibility` is `player`, because a hidden goal is the GM's arc ([04 §7.1]);
 * hooks are **counts**, because an unfired hook's premise is hidden content by
 * [08 §6]'s definition and a fired one's is already in the transcript. Nothing
 * here is a premise, an entrance, a hidden statement, or an id a client could
 * use to ask for one.
 */
export interface CarryPreview {
  mode: string;
  treatment: string | null;
  preset: string | null;
  persona: string | null;
  party: string[];
  goals: {
    carried: GoalsCarried;
    /** The goal play would begin on, when a player may read it. */
    current: { statement: string } | { hidden: true } | null;
    count: number;
    hidden: number;
  };
  hooks: { carried: number; spent: number };
  lore: string[];
}

export function previewOf(carry: Carry): CarryPreview {
  const [first] = carry.goals;
  return {
    mode: carry.mode.id,
    treatment: carry.treatment?.name ?? null,
    preset: carry.preset?.name ?? null,
    persona: carry.persona?.name ?? null,
    party: carry.party.map((member) => member.name),
    goals: {
      carried: carry.goalsCarried,
      current:
        first === undefined
          ? null
          : first.visibility === 'player'
            ? { statement: first.statement }
            : { hidden: true },
      count: carry.goals.length,
      hidden: carry.goals.filter((goal) => goal.visibility === 'hidden').length,
    },
    hooks: { carried: carry.hooks.length, spent: carry.spentHooks.length },
    lore: carry.lore.map((link) => link.ref.name),
  };
}

/** Which carried groups the person kept — the wizard's three toggles. */
export interface CarryChoices {
  party: boolean;
  goals: boolean;
  hooks: boolean;
}

/** What a person wrote, or accepted, in the wizard. */
export interface SetupTexts {
  name: string;
  blurb: string;
  storySoFar: string;
  opening: { label: string; text: string };
}

/**
 * ***The Setup the commit writes.***
 *
 * **Everything a person reviewed is theirs; everything else is the record's.**
 * The texts come from the wizard, and the carry is the server's own reading of
 * the turn. `provenance.source` is `session` — honest about where it came from,
 * and safe on a Setup because only lorebooks are read for that marker
 * (`retrieval/blocks.ts`, [P13 §0.3]).
 *
 * *`companion` is the facts lorebook when one was kept*, linked `required`: the
 * Setup's story was written against those facts, so a session that cannot find
 * them is missing its world rather than a nice extra, which is exactly what
 * that flag says.
 */
export function buildSetup(
  carry: Carry,
  choices: CarryChoices,
  texts: SetupTexts,
  extra: {
    generated?: Setup['generated'];
    companion?: Ref | null;
    at?: string;
  } = {},
): Setup {
  const made = newSetup(texts.name.trim());
  const at = extra.at ?? new Date().toISOString();
  const openingId = uuidv7();
  const storySoFar = texts.storySoFar.trim();

  return {
    ...made,
    blurb: texts.blurb.trim(),
    mode: structuredClone(carry.mode),
    treatment: carry.treatment,
    preset: carry.preset,
    cast: {
      personaOptions: carry.persona === null ? [] : [carry.persona],
      partyDefault: choices.party ? carry.party : [],
      narrator: null,
    },
    lore: [
      ...carry.lore,
      ...(extra.companion === undefined || extra.companion === null
        ? []
        : [{ ref: extra.companion, required: true }]),
    ],
    openings: {
      written:
        texts.opening.text.trim() === ''
          ? []
          : [
              {
                id: openingId,
                label:
                  texts.opening.label.trim() === '' ? 'Where it left off' : texts.opening.label,
                text: texts.opening.text,
              },
            ],
      seeds: [],
      primaryWrittenId: texts.opening.text.trim() === '' ? null : openingId,
      primarySeedId: null,
    },
    hooks: choices.hooks ? carry.hooks : [],
    goals: choices.goals ? carry.goals : [],
    ...(carry.hookPacing === undefined ? {} : { hookPacing: carry.hookPacing }),
    ...(carry.stagingNotes === undefined ? {} : { stagingNotes: carry.stagingNotes }),
    ...(storySoFar === '' ? {} : { storySoFar }),
    ...(choices.hooks && carry.spentHooks.length > 0 ? { spentHooks: carry.spentHooks } : {}),
    provenance: { ...blankProvenance('session'), createdAt: at, updatedAt: at },
    generated: extra.generated ?? null,
  };
}
