// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import type { Candidate, StepDefinition } from '@storyengine/sdk';

import {
  LOREBOOK_SCHEMA,
  newLoreEntry,
  newLorebook,
  remedyFor,
  SETUP_SCHEMA,
  type ErrorClass,
  type FailureRemedy,
  type Lorebook,
  type ModelCall,
  type Setup,
} from '@storyengine/shared';

import type { Accounts } from '../auth/accounts.js';
import type { Config } from '../config.js';
import { create, remove, type LibraryContext } from '../library.js';
import { titleFor } from '../memory/capture.js';
import { alreadyKnown, EXTRACT_PROMPT, EXTRACT_SCHEMA, readExtraction } from '../memory/extract.js';
import type { ProviderFactory } from '../providers/factory.js';
import {
  buildSetup,
  carryAt,
  previewOf,
  type Carry,
  type CarryChoices,
  type CarryPreview,
  type SetupTexts,
} from '../sessions/setup-from-turn.js';
import type { SessionContext } from '../sessions/store.js';
import { ensureChain, type Summariser } from '../sessions/summaries.js';
import { unitWordsOf } from '../sessions/summary-chain.js';
import { fromModelCall, recordUsage } from '../usage/log.js';
import {
  CallFailed,
  Cancelled,
  performCall,
  RoleUnresolved,
  WindowTooSmall,
  type CallOutcome,
} from './calls.js';
import { gatherAssemblyInputs, roleLayersOf, type AssemblyInputs } from './gather.js';
import {
  chainPlanFor,
  keptSummary,
  renderUnits,
  SUMMARISE_STEP,
  summarisablePath,
  summaryCandidates,
} from './summarise.js';
import { transcriptOf } from './steps.js';

/**
 * ***Make a setup from here: the draft*** —
 * [04 §7.2](../../../../docs/design/04-schemas.md),
 * [P15.6](../../../../docs/design/workplan/33-p15-setup-from-a-turn.md).
 *
 * **What a person reviews before anything is written** — [17 §3]'s *offered,
 * never automatic, and reviewed before it lands*. Nothing here writes to the
 * library or the session; the commit does, from what the person kept.
 *
 * ---
 *
 * ***Four parts, each its own call***, which is [00 §2.3]'s *"separate validated
 * generations, each individually retryable, applied as they succeed"* read for a
 * wizard rather than a turn: a story so far that failed does not cost the
 * opening that did not, and *Regenerate* on one part is the same request with
 * one part named.
 *
 * | Part | Asked for |
 * |---|---|
 * | `storySoFar` | the condensed history, from the chain and the recent turns |
 * | `opening` | a scene that re-establishes where the story is, for a reader who has not seen it — or the narrator's last words verbatim, which is no call at all |
 * | `title` | a name and a library-card blurb |
 * | `facts` | keyed lore entries, by the memory extractor's own prompt and schema |
 *
 * ***The summary chain is reused, not rebuilt.*** The chain up to this turn is
 * `ensureChain` under the session's **own** summariser key, so every link the
 * runner has already written is read by its content address and only the
 * missing ones cost a call — and a link this derives is one the runner would
 * have derived, byte for byte, because the key, the prompt and the candidates
 * are the runner's own (`summaryCandidates`). ~~The chain's last link is the
 * whole story up to the window; the turns after it go in verbatim.~~ *The root
 * and every link are the story up to the window* — a link is its own stretch
 * since `main`'s `e9d1a142` — and the turns after it go in verbatim.
 *
 * ***Rewritten onto `main`'s chain at the merge*** (2026-10-03). The branch
 * built its own path (`{ input: { text } }`), so a move's pictures were not in
 * its unit keys and a pictured session got a chain the runner never reads; it
 * kept every reply, so a summary cut off at its length limit was written under
 * the runner's key and read as the story from then on — the defect
 * `keptSummary` fixed on `main` the day after the branch was written; it re-derived
 * the key and policy by hand; and it caught a throw `ensureChain` no longer
 * makes, so a failed link quietly drafted from a short chain. Now: the
 * runner's path (`summarisablePath`), its plan (`chainPlanFor`, root included),
 * its keep rule, its role layers (`roleLayersOf`), and the chain's `failure`
 * read as an answer.
 *
 * ***What the model is shown is what the player saw.*** `transcriptOf` is the
 * sanctioned narrow payload — what was said and what came back, and nothing
 * about how either was produced — and the chain is built from it. Hidden
 * channels, unfired hooks and hidden goals never reach these prompts, so they
 * cannot leak into a story so far that a person is about to read.
 *
 * ***What it costs is written down*** — [10 §11.4], through the usage log every
 * call that writes no turn uses (`usage/log.ts`). One line per call, the
 * `role` the call resolved as for every such line, and a purpose that names
 * the wizard first: `setup-draft:<part>` for a part (`storySoFar`, `opening`,
 * `title`, `facts`) and `setup-draft:summarise` for a link of the chain the
 * draft had to derive. *The link under the wizard's name rather than the
 * warm's `summarise`*, because the question a spend view asks first is what
 * pressing a button cost, and the links a draft derives are part of that
 * answer even though the next turn reads them too. A call that failed or was
 * stopped after it reached the provider is written too, as the warm and the
 * on-demand steps write theirs: it was paid for.
 */

export const SE_CONDENSE = 'se.condense';

/**
 * The step every part dispatches as.
 *
 * ***`prose`, for the summariser's reason*** — nothing in this build binds any
 * other role and `resolveRole` has no cross-role fallback — and **a step of its
 * own**, so a session's `stepRoles` can send the wizard to a different model
 * from the narration: this is exactly the call somebody might want a larger
 * model for, once, rather than on every turn.
 *
 * `post` and a cadence of one are nominal: nothing schedules this step, and
 * the runner never sees it. `reads: ['transcript']` is the declaration that
 * matters, and it is the truth.
 */
export const CONDENSE_STEP: StepDefinition = {
  id: SE_CONDENSE,
  stage: 'post',
  reads: ['transcript'],
  writes: [],
  /**
   * ***Messages, which makes every call here a `prose` call*** — and that is
   * the truth rather than a way past the firewall. `callPurposeFor` reads a
   * step that contributes messages and writes nothing as prose, and everything
   * this step makes is words for a person to read, edit and keep: it proposes
   * no effect and judges nothing. So a person's steer, which is advisory and
   * barred from effects and verdict calls, may reach it — the first version
   * left this out and every *Regenerate, but shorter* was refused as an
   * advisory block on an effects call.
   */
  contributes: 'messages',
  callKind: 'summarise',
  when: { when: 'cadence', everyNTurns: 1 },
  failure: 'warn',
  role: 'prose',
};

export const SETUP_PARTS = ['storySoFar', 'opening', 'title', 'facts'] as const;
export type SetupPart = (typeof SETUP_PARTS)[number];

/**
 * Why a part came back empty-handed. Classes, never prose — [01 §2].
 *
 * *Two added at the merge* (2026-10-03). `window-too-small` is
 * `performCall`'s own refusal, which was rethrown here and so answered a
 * wizard with a 500 — impersonation's mapping, for impersonation's reason.
 * `truncated` is a reply that ran into its length limit — {@link finished}
 * says why that is not offered.
 *
 * ***And two for the chain, at review the same day.*** A link of the summary
 * chain that `keptSummary` refused fails every part (the chain's note in
 * {@link draftSetupFromTurn}), and it used to fail them as `truncated` or
 * `no-answer` — the words for a part's own reply. The wizard reads those as
 * *the draft ran past the reply length … try again with a note asking for it
 * shorter*, and a note reaches only the part it names, never the summariser:
 * for the one failure that shows on every part at once, the sentence named
 * the wrong reply and offered a fix that could not work. So a link's refusal
 * is `summary-truncated` or `summary-no-answer`, and the client says *a
 * summary of the earlier story* and the fix that reaches it.
 */
export type PartRefusal =
  | 'role-unbound'
  | 'role-dangling'
  | 'window-too-small'
  | 'call-failed'
  | 'truncated'
  | 'no-answer'
  | 'summary-truncated'
  | 'summary-no-answer';

/**
 * A part that could not be drafted.
 *
 * ***A provider failure carries its class and a remedy*** (2026-10-03, at the
 * merge), as impersonation's, the field assist's and the on-demand steps' do:
 * a bare `call-failed` told a person *the model did not answer* for a wrong
 * key, a model server that was down and a 429 alike, when each has its own
 * fix. `remedyFor` is the one diagnosis every surface shares; `detail` is the
 * endpoint's own words, on `CallFailed.detail`'s terms — for the log, never UI
 * copy — and carried as impersonation carries it.
 */
export type PartFailure =
  | { ok: false; reason: Exclude<PartRefusal, 'call-failed'> }
  | {
      ok: false;
      reason: 'call-failed';
      class: ErrorClass;
      remedy: FailureRemedy;
      detail?: string;
    };

export type PartOutcome<T> = { ok: true; value: T; model: string | null } | PartFailure;

/**
 * What every usage line the draft writes is filed under, before the colon —
 * see the module docstring for the scheme and why a link is filed here too.
 */
export const DRAFT_PURPOSE = 'setup-draft';

export interface DraftFact {
  text: string;
  keys: string[];
}

export interface Draft {
  carry: CarryPreview;
  /**
   * What the person should know before they save. `no-summary-slot`: the
   * session's preset positions no summary, so a session started from this
   * Setup with the same pack would never show the model the story so far.
   */
  warnings: 'no-summary-slot'[];
  parts: {
    storySoFar?: PartOutcome<string>;
    opening?: PartOutcome<string>;
    title?: PartOutcome<{ name: string; blurb: string }>;
    facts?: PartOutcome<DraftFact[]>;
  };
}

export interface CondenseContext {
  sessions: SessionContext;
  accounts: Accounts;
  providers: ProviderFactory;
  config: Config;
  /**
   * Whether the server's last check reached the internet — what `remedyFor`
   * needs to tell an endpoint that is down from a network that is. Read at
   * failure time, as impersonation reads it; absent is *not known*.
   */
  online?: () => boolean | null;
}

export interface DraftRequest {
  account: string;
  sessionId: string;
  turnId: string;
  parts: readonly SetupPart[];
  /** A person's steer for one part — *Regenerate, but shorter*. Advisory. */
  guidance?: Partial<Record<SetupPart, string>>;
  /** `verbatim` is the narrator's last words at the turn, and makes no call. */
  openingFrom?: 'scene' | 'verbatim';
  signal: AbortSignal;
}

/** The state at the turn, gathered once and shared by the draft and the commit. */
export async function stateAt(
  context: Pick<CondenseContext, 'sessions' | 'accounts'>,
  request: { account: string; sessionId: string; turnId: string },
): Promise<{ inputs: AssemblyInputs; carry: Carry } | null> {
  const inputs = await gatherAssemblyInputs(
    { sessions: context.sessions, accounts: context.accounts },
    { account: request.account, sessionId: request.sessionId, parentTurnId: request.turnId },
  );
  if (inputs.session === null || !inputs.turnsById.has(request.turnId)) return null;

  const carry = carryAt({
    session: inputs.session,
    channels: inputs.channels,
    pool: inputs.hooks.pool,
    goals: inputs.goals.chain,
    lore: inputs.lore,
    cast: inputs.cast,
    defaultPresetId: inputs.mode.definition.assembly.defaultPreset.id,
  });
  return { inputs, carry };
}

export async function draftSetupFromTurn(
  context: CondenseContext,
  request: DraftRequest,
): Promise<Draft | { held: 'no-turn' }> {
  const state = await stateAt(context, request);
  if (state === null) return { held: 'no-turn' };
  const { inputs, carry } = state;

  const warnings: Draft['warnings'] = inputs.preset.blocks.some(
    (block) => block.enabled && block.kind === 'slot' && block.source.of === 'summary',
  )
    ? []
    : ['no-summary-slot'];

  /** One usage line — see the module docstring for the purpose scheme. */
  const spent = (made: ModelCall, purpose: string): Promise<void> =>
    recordUsage(
      context.sessions.layout,
      request.account,
      fromModelCall(made, `${DRAFT_PURPOSE}:${purpose}`, { sessionId: request.sessionId }),
    );

  const call = async (
    definition: StepDefinition,
    candidates: Candidate[],
    purpose: string,
    schema?: object,
  ): Promise<CallOutcome> => {
    try {
      const outcome = await performCall(
        {
          definition,
          // The session's own overrides and the cast among them — the one
          // answer to *which model is this* the runner, the preview and the
          // warm share. The branch built this object by hand; a copy is how
          // the preview once came to meter a session against the wrong model.
          ...roleLayersOf(inputs),
          providers: context.providers,
          config: context.config,
          preset: { params: inputs.preset.params, budget: inputs.preset.budget },
          signal: request.signal,
          notFilled: [],
          onCallAssembled: () => {
            /* No draft to checkpoint: nothing is written until the commit. */
          },
          onProgress: () => {
            /* No event stream: the wizard waits for the answer. */
          },
        },
        { candidates, ...(schema === undefined ? {} : { schema }) },
        [],
      );
      await spent(outcome.call, purpose);
      return outcome;
    } catch (error) {
      // A call that got as far as the provider was paid for, even if nothing
      // it said is kept — the warm's rule and the on-demand steps'.
      if ((error instanceof CallFailed || error instanceof Cancelled) && error.call !== undefined) {
        await spent(error.call, purpose);
      }
      throw error;
    }
  };

  const wanted = new Set(request.parts);
  const parts: Draft['parts'] = {};
  const turn = inputs.turnsById.get(request.turnId);

  // The one part that needs no model at all, answered before anything can fail.
  if (wanted.has('opening') && request.openingFrom === 'verbatim') {
    const words = turn?.output?.text ?? '';
    parts.opening =
      words.trim() === ''
        ? { ok: false, reason: 'no-answer' }
        : { ok: true, value: words, model: null };
    wanted.delete('opening');
  }
  if (wanted.size === 0) return { carry: previewOf(carry), warnings, parts };

  /**
   * ***The chain, as the runner keys it.*** `chainPlanFor` is the resolution
   * `summaryPlanFor` makes for the turn, the warm and the preview — whose
   * summariser, how the path is cut, and the story so far it starts from —
   * without the two gates that decide whether a *turn* builds one: the draft
   * needs the story above the window whatever the pack positions. So a key here
   * is a key there; an unresolvable role fails every part that would have
   * needed it, with the class a person can act on.
   */
  const chainPlan = chainPlanFor(inputs);
  if (!chainPlan.ok) {
    const reason = chainPlan.reason === 'dangling' ? 'role-dangling' : 'role-unbound';
    for (const part of wanted) parts[part] = { ok: false, reason };
    return { carry: previewOf(carry), warnings, parts };
  }
  const { plan } = chainPlan;

  /**
   * *The runner's path, by the runner's function* — `summarisablePath` over the
   * same transcript the summariser step is handed, so a move's pictures and
   * their captions are in the unit keys as they are in the turn's
   * ([26 E15]). *The runner's keep rule*, so a link cut off at its length
   * limit, refused or empty is never written under the runner's key: the
   * runner would read it as held and carry the cut for the rest of the session.
   * And `signal`, so a draft that joined the warm's derivation of a link stops
   * waiting when the person leaves.
   */
  const path = summarisablePath(transcriptOf(inputs.history));
  const summariser: Summariser = {
    key: plan.key,
    signal: request.signal,
    run: async ({ previous, units }) => {
      const outcome = await call(SUMMARISE_STEP, summaryCandidates(previous, units), 'summarise');
      try {
        return keptSummary({ text: outcome.text, outcome: outcome.call.outcome });
      } catch (refused) {
        // A link's own reasons, not a part's — see `PartRefusal`.
        throw new NotKept(
          outcome.call.outcome === 'truncated' ? 'summary-truncated' : 'summary-no-answer',
          refused,
        );
      }
    },
  };

  const chain = await ensureChain(
    context.sessions.layout,
    request.account,
    request.sessionId,
    path,
    summariser,
    plan.policy,
    plan.root,
  );
  /**
   * ***A link that could not be derived fails the parts that read it***
   * (2026-10-03). `ensureChain` no longer throws: since `main`'s `e9d1a142` it
   * returns the held prefix beside the failure, for the turn, which is better
   * off with part of the story than none. A draft is not: a story so far
   * written from a chain that stops short reads as the whole story and is
   * missing its middle, and a person reviewing it has no way to see the gap.
   * So every part still wanted fails with the link's own class, and *Try again*
   * asks for that link again. A stop is still a stop — {@link failureOf}
   * rethrows it, and the route ends a request nobody is waiting for.
   */
  if (chain.failure !== undefined) {
    const failed = failureOf(chain.failure, context.online?.() ?? null);
    for (const part of wanted) parts[part] = failed;
    return { carry: previewOf(carry), warnings, parts };
  }

  /**
   * ***The material every part reads.*** ~~The chain's last link is the story up
   * to the window — the summariser is asked for one continuous summary, so the
   * last link covers what every earlier one did — or the root alone when the
   * chain is empty~~ — *the root and every link, oldest first* (2026-10-03):
   * each link is its own stretch since `e9d1a142`, so the last one alone was
   * the latest twenty turns presented as everything before the window. The
   * turns after the chain go in verbatim, in the summariser's own rendering
   * (`renderUnits` over `unitWordsOf`), so a picture move reads as its
   * stand-ins here as it does to the summariser.
   */
  const covered = chain.links.at(-1)?.to ?? -1;
  const before = [plan.root?.text, ...chain.links.map((link) => link.text)].filter(
    (text): text is string => text !== undefined && text.trim() !== '',
  );
  const recent = renderUnits(path.slice(covered + 1).map(unitWordsOf));
  const material: Candidate[] = [
    ...(before.length === 0
      ? []
      : [block('se.condense.before', 'user', `The story before this:\n\n${before.join('\n\n')}`)]),
    ...(recent === ''
      ? []
      : [block('se.condense.recent', 'user', `What happened most recently:\n\n${recent}`)]),
  ];
  const steer = (part: SetupPart): Candidate[] => {
    const words = request.guidance?.[part]?.trim() ?? '';
    return words === ''
      ? []
      : [{ ...block(`se.condense.guidance`, 'user', words), advisory: true }];
  };

  const attempt = async <T>(
    run: () => Promise<{ value: T | null; model: string | null }>,
  ): Promise<PartOutcome<T>> => {
    try {
      const { value, model } = await run();
      return value === null ? { ok: false, reason: 'no-answer' } : { ok: true, value, model };
    } catch (error) {
      return failureOf(error, context.online?.() ?? null);
    }
  };

  const text = async (prompt: string, part: SetupPart) => {
    const outcome = finished(
      await call(
        CONDENSE_STEP,
        [block('se.condense.task', 'system', prompt), ...material, ...steer(part)],
        part,
      ),
    );
    const words = outcome.text.trim();
    return { value: words === '' ? null : words, model: outcome.call.resolved.modelId };
  };

  /**
   * ***One after another, in a fixed order, and never at once.*** An endpoint
   * on somebody's own machine serves one request at a time, so four at once is
   * four in a queue with three of them timing out behind the first; and a fixed
   * order makes the job log read the way the wizard does, top to bottom.
   */
  for (const part of SETUP_PARTS) {
    if (!wanted.has(part)) continue;
    switch (part) {
      case 'storySoFar':
        parts.storySoFar = await attempt(() => text(STORY_SO_FAR_PROMPT, 'storySoFar'));
        break;
      case 'opening':
        parts.opening = await attempt(() => text(OPENING_PROMPT, 'opening'));
        break;
      case 'title':
        parts.title = await attempt(async () => {
          const outcome = finished(
            await call(
              CONDENSE_STEP,
              [block('se.condense.task', 'system', TITLE_PROMPT), ...material, ...steer('title')],
              'title',
              TITLE_SCHEMA,
            ),
          );
          return { value: readTitle(outcome.object), model: outcome.call.resolved.modelId };
        });
        break;
      case 'facts':
        parts.facts = await attempt(async () => {
          const outcome = finished(
            await call(
              CONDENSE_STEP,
              [block('se.condense.task', 'system', EXTRACT_PROMPT), ...material, ...steer('facts')],
              'facts',
              EXTRACT_SCHEMA,
            ),
          );
          /**
           * **What a linked book already says is not offered again** — the
           * extractor's own dedupe, against every book this session reads. A
           * fact the Setup's world already holds is a retrieval budget spent
           * twice.
           */
          const found = readExtraction(outcome.object).filter(
            (fact) => !inputs.lore.books.some((book) => alreadyKnown(book.book, fact)),
          );
          return { value: found, model: outcome.call.resolved.modelId };
        });
        break;
    }
  }

  return { carry: previewOf(carry), warnings, parts };
}

/**
 * ***The story so far.*** Written to be read by a model as context on every
 * turn of a session that has not seen any of it — and by a person, in the
 * wizard and in the library, deciding whether it is right.
 */
export const STORY_SO_FAR_PROMPT = [
  'Condense the story below into "the story so far": everything a new session needs',
  'to continue it as though it had been played.',
  '',
  'Write it in the past tense, as continuous prose. Keep every name, place, relationship,',
  'decision, promise and unresolved thread a later scene might depend on, and say where',
  'things stand at the end. Drop description and atmosphere.',
  'Do not invent anything, do not address the reader, and do not continue the story.',
].join('\n');

/**
 * ***The opening.*** The first thing a session started from this Setup says —
 * so a scene, in the narrator's voice, that puts a reader who has read only the
 * story so far back where the story is.
 */
export const OPENING_PROMPT = [
  'Write the opening passage of a new session that begins exactly where the story below',
  'leaves off.',
  '',
  'It is a scene, not a recap: in the narrator’s voice and register, present the',
  'situation as it stands — who is here, where, and what is happening — so that a reader',
  'who has read only a summary of what came before can step straight in.',
  'End at a moment that invites the player to act. Do not act or speak for the player’s',
  'character, and do not resolve anything the story left open.',
].join('\n');

export const TITLE_PROMPT = [
  'Name the starting point below as a library entry somebody would choose to play from.',
  '',
  '"name" is a short title — a few words, no quotation marks. "blurb" is one or two',
  'sentences for the library card, saying what the player walks into, without spoiling',
  'anything the story has kept hidden.',
].join('\n');

export const TITLE_SCHEMA = {
  type: 'object',
  properties: { name: { type: 'string' }, blurb: { type: 'string' } },
  required: ['name', 'blurb'],
  additionalProperties: false,
} as const;

function readTitle(value: unknown): { name: string; blurb: string } | null {
  if (typeof value !== 'object' || value === null) return null;
  const shape = value as { name?: unknown; blurb?: unknown };
  const name = typeof shape.name === 'string' ? shape.name.trim() : '';
  if (name === '') return null;
  return { name, blurb: typeof shape.blurb === 'string' ? shape.blurb.trim() : '' };
}

/**
 * A reply that came back and is not offered — cut off, refused, empty, or the
 * wrong shape. Its own class so {@link failureOf} can tell it from a failure
 * the provider raised, and keep the one distinction a person acts on.
 */
type NotKeptReason = 'truncated' | 'no-answer' | 'summary-truncated' | 'summary-no-answer';

class NotKept extends Error {
  readonly reason: NotKeptReason;

  constructor(reason: NotKeptReason, cause?: unknown) {
    super(
      reason === 'truncated' || reason === 'summary-truncated'
        ? 'The reply was cut off at its length limit, so it was not offered.'
        : 'The reply held nothing usable, so it was not offered.',
      cause === undefined ? undefined : { cause },
    );
    this.name = 'NotKept';
    this.reason = reason;
  }
}

/**
 * ***A part's reply, if it finished*** (2026-10-03, at the merge — the
 * recommended answer to what a cut-off part answers, which the owner deferred
 * to).
 *
 * **A story so far or an opening cut off at its length limit is refused, as
 * `truncated`, not offered.** The wizard is a review, and a person reading a
 * long story so far reads it for whether it is right, not for whether its last
 * sentence ended — and the end is what a cut removes: *say where things stand
 * at the end* is the story so far's last instruction, and *end at a moment that
 * invites the player to act* is the opening's. A session started from either
 * begins from the part that is missing. Refusing costs one more call, with a
 * reason that names the fix (ask for it shorter, or raise the reply length),
 * and it is the summariser's own rule for the same failure (`keptSummary`).
 * *`incomplete` is offered* when it has words, for `keptSummary`'s reason:
 * some local endpoints never say why they stopped.
 *
 * *The structured parts too*: a name or a fact list cut off mid-object, or
 * refused, or still the wrong shape after `performCall`'s own retries
 * (`error`), is not an answer — and an empty fact list read off one would say
 * *nothing was established*, which nobody found out.
 */
function finished(outcome: CallOutcome): CallOutcome {
  if (outcome.call.outcome === 'truncated') throw new NotKept('truncated');
  if (outcome.call.outcome === 'refused' || outcome.call.outcome === 'error') {
    throw new NotKept('no-answer');
  }
  return outcome;
}

/**
 * What a failure inside a part — or inside the chain every part reads — comes
 * to: impersonation's mapping, for its reasons, plus the two refusals only a
 * draft has.
 *
 * ***Rethrows what is not an answer.*** A `Cancelled` is a stop, and a stop is
 * still a stop: the route ends a request whose client left, and anything else
 * that stops a draft is the server stopping. Anything this has no class for —
 * an advisory block reaching an effects call, a store that would not read — is
 * a fault, and a fault is not something to file under a part.
 */
function failureOf(error: unknown, online: boolean | null): PartFailure {
  if (error instanceof RoleUnresolved) {
    return { ok: false, reason: error.reason === 'dangling' ? 'role-dangling' : 'role-unbound' };
  }
  if (error instanceof WindowTooSmall) return { ok: false, reason: 'window-too-small' };
  if (error instanceof NotKept) return { ok: false, reason: error.reason };
  if (error instanceof CallFailed) {
    return {
      ok: false,
      reason: 'call-failed',
      class: error.class,
      remedy: remedyFor({
        reason: error.class,
        endpoint: error.endpoint,
        stalled: error.stalled,
        online,
      }),
      ...(error.detail === undefined ? {} : { detail: error.detail }),
    };
  }
  throw error;
}

/** A local helper, like every engine-owned step's — its `reason` is about this one. */
function block(id: string, role: 'system' | 'user', text: string): Candidate {
  return {
    id,
    source: { kind: 'step', stepId: SE_CONDENSE },
    reason: 'making a setup from this point',
    role,
    text,
    required: true,
  };
}

/**
 * The fields the wizard may say a model wrote, keyed as `generated` keys them —
 * by dotted path. *A closed list*: a client naming any other path is naming a
 * field the wizard does not produce, and it is dropped rather than recorded.
 */
export const GENERATED_PATHS = ['name', 'blurb', 'storySoFar', 'openings.written.0.text'] as const;
export type GeneratedPath = (typeof GENERATED_PATHS)[number];

export interface CommitRequest {
  account: string;
  sessionId: string;
  turnId: string;
  texts: SetupTexts;
  include: CarryChoices;
  /** The facts a person kept, as they left them. Empty is no companion book. */
  facts: readonly DraftFact[];
  /** Which fields a model wrote first, and what it wrote — for `generated`. */
  generated?: Partial<Record<GeneratedPath, { original: string; model: string | null }>>;
  at?: string;
}

export type CommitOutcome =
  | {
      kind: 'saved';
      setup: { id: string; name: string };
      lorebook: { id: string; name: string } | null;
    }
  | { kind: 'no-turn' };

/**
 * ***The commit: the companion book, then the Setup*** — [P15.7].
 *
 * **The carry is recomputed here, from the turn**, never read off the request:
 * the preview a browser was shown is a redaction, and a Setup assembled from
 * what the browser sent back could only ever carry what it was shown — or,
 * worse, whatever a client chose to send. What the person decides is the texts,
 * the facts and three switches; what the record says is the record's.
 *
 * ***The book first, and taken back if the Setup does not land.*** The Setup
 * links the book, so the book has to exist to be linked; and a failed save
 * must leave nothing behind, which is [03 §2.3]'s *a session tried once and
 * abandoned must leave nothing behind* read one object further out.
 *
 * *`generated` is written reviewed* — `unreviewed: false` — because the wizard
 * is the review: every field it records was on a person's screen, editable,
 * when they pressed Save. `assistant/Proposal.tsx` writes the same after its
 * own review, and for the same reason.
 */
export async function commitSetupFromTurn(
  context: Pick<CondenseContext, 'sessions' | 'accounts'> & { library: LibraryContext },
  request: CommitRequest,
): Promise<CommitOutcome> {
  const state = await stateAt(context, request);
  if (state === null) return { kind: 'no-turn' };

  const at = request.at ?? new Date().toISOString();
  const name = request.texts.name.trim();
  const facts = request.facts
    .map((fact) => ({
      text: fact.text.trim(),
      keys: fact.keys.map((key) => key.trim()).filter((key) => key !== ''),
    }))
    // A fact with no keys can never reach a prompt — the extractor's own rule.
    .filter((fact) => fact.text !== '' && fact.keys.length > 0);

  let book: { id: string; name: string; contentHash: string } | null = null;
  if (facts.length > 0) {
    const made = newLorebook(`${name} — established facts`);
    const lorebook: Lorebook = {
      ...made,
      description:
        'What play had established by the point this setup was made from. Written by a ' +
        'model, kept by a person, and meant to be corrected.',
      /**
       * ***`generated`, and never `session`*** — [P15 §0.3]. A lorebook marked
       * `session` is a memory book to the retriever, and every block from one
       * is advisory — barred from every effect and verdict call. These are the
       * world's facts, not a character's memories.
       */
      provenance: { ...made.provenance, source: 'generated', createdAt: at, updatedAt: at },
      entries: facts.map((fact) => ({
        ...newLoreEntry(titleFor(fact.text)),
        keys: fact.keys,
        content: fact.text,
      })),
    };
    const stored = await create(context.library, request.account, lorebook, LOREBOOK_SCHEMA);
    book = { id: lorebook.id, name: lorebook.name, contentHash: stored.contentHash };
  }

  const generated: NonNullable<Setup['generated']> = {};
  for (const path of GENERATED_PATHS) {
    const one = request.generated?.[path];
    if (one === undefined) continue;
    generated[path] = {
      original: one.original,
      at,
      model: one.model,
      seed: null,
      unreviewed: false,
    };
  }

  const setup = buildSetup(state.carry, request.include, request.texts, {
    generated: Object.keys(generated).length === 0 ? null : generated,
    companion: book === null ? null : { id: book.id, name: book.name },
    at,
  });

  try {
    await create(context.library, request.account, setup, SETUP_SCHEMA);
  } catch (error) {
    if (book !== null) {
      await remove(
        context.library,
        request.account,
        book.id,
        book.contentHash,
        LOREBOOK_SCHEMA,
      ).catch(() => {
        /* The Setup's failure is the one worth reporting; a stray book is visible. */
      });
    }
    throw error;
  }

  return {
    kind: 'saved',
    setup: { id: setup.id, name: setup.name },
    lorebook: book === null ? null : { id: book.id, name: book.name },
  };
}
