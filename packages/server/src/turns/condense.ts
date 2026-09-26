// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import type { Candidate, StepDefinition } from '@storyengine/sdk';

import {
  LOREBOOK_SCHEMA,
  newLoreEntry,
  newLorebook,
  SETUP_SCHEMA,
  type Lorebook,
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
import {
  DEFAULT_SUMMARY_POLICY,
  summariserKey,
  type SummarisableTurn,
  type SummaryLink,
} from '../sessions/summary-chain.js';
import { CallFailed, performCall, resolveStepRole, RoleUnresolved } from './calls.js';
import { gatherAssemblyInputs, type AssemblyInputs } from './gather.js';
import { SUMMARISE_PROMPT, SUMMARISE_STEP, summaryCandidates, renderUnits } from './summarise.js';
import { transcriptOf } from './steps.js';

/**
 * ***Make a setup from here: the draft*** —
 * [04 §7.2](../../../../docs/design/04-schemas.md),
 * [P13.6](../../../../docs/design/workplan/30-p13-implementation.md).
 *
 * **What a person reviews before anything is written** — [16 §3]'s *offered,
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
 * are the runner's own (`summaryCandidates`). The chain's last link is the
 * whole story up to the window; the turns after it go in verbatim.
 *
 * ***What the model is shown is what the player saw.*** `transcriptOf` is the
 * sanctioned narrow payload — what was said and what came back, and nothing
 * about how either was produced — and the chain is built from it. Hidden
 * channels, unfired hooks and hidden goals never reach these prompts, so they
 * cannot leak into a story so far that a person is about to read.
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

/** Why a part came back empty-handed. Classes, never prose — [01 §2]. */
export type PartRefusal = 'role-unbound' | 'role-dangling' | 'call-failed' | 'no-answer';

export type PartOutcome<T> =
  { ok: true; value: T; model: string | null } | { ok: false; reason: PartRefusal };

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

  const roles = {
    bindings: inputs.bindings,
    defaults: inputs.defaults,
    usable: inputs.usable,
    ...(inputs.session?.roles === undefined ? {} : { sessionRoles: inputs.session.roles }),
    ...(inputs.session?.stepRoles === undefined ? {} : { stepRoles: inputs.session.stepRoles }),
    cast: inputs.cast,
  };
  const call = (definition: StepDefinition, candidates: Candidate[], schema?: object) =>
    performCall(
      {
        definition,
        ...roles,
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

  const wanted = new Set(request.parts);
  const parts: Draft['parts'] = {};
  const path = inputs.history;
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
   * ***The chain, under the runner's key.*** Resolved the way the runner
   * resolves it, so a key here is a key there; an unresolvable role fails every
   * part that would have needed it, with the class a person can act on.
   */
  const summariser = resolveStepRole(
    roles,
    SUMMARISE_STEP,
    SUMMARISE_STEP.role ?? 'prose',
    undefined,
  );
  if (!summariser.ok) {
    const reason: PartRefusal = summariser.reason === 'dangling' ? 'role-dangling' : 'role-unbound';
    for (const part of wanted) parts[part] = { ok: false, reason };
    return { carry: previewOf(carry), warnings, parts };
  }

  const transcript = transcriptOf(path);
  const summarisable: SummarisableTurn[] = transcript.map((one) => ({
    id: one.turnId,
    ...(one.input === undefined ? {} : { input: { text: one.input.text } }),
    ...(one.output === undefined ? {} : { output: { text: one.output.text } }),
  }));
  const policy = {
    ...DEFAULT_SUMMARY_POLICY,
    window: inputs.mode.definition.assembly.historyWindow,
  };
  const chainer: Summariser = {
    key: summariserKey(
      { connectionId: summariser.connection.id, modelId: summariser.modelId },
      SUMMARISE_PROMPT,
      inputs.preset.params,
    ),
    run: async ({ previous, units }) =>
      (await call(SUMMARISE_STEP, summaryCandidates(previous, units))).text.trim(),
  };

  let links: readonly SummaryLink[];
  try {
    links = (
      await ensureChain(
        context.sessions.layout,
        request.account,
        request.sessionId,
        summarisable,
        chainer,
        policy,
        inputs.summaryRoot,
      )
    ).links;
  } catch (error) {
    if (!(error instanceof CallFailed)) throw error;
    for (const part of wanted) parts[part] = { ok: false, reason: 'call-failed' };
    return { carry: previewOf(carry), warnings, parts };
  }

  /**
   * ***The material every part reads.*** The chain's last link is the story up
   * to the window — the summariser is asked for one continuous summary, so the
   * last link covers what every earlier one did — or the root alone when the
   * chain is empty; the turns after the chain go in verbatim, rendered the way
   * the summariser renders them.
   */
  const covered = links.at(-1)?.to ?? -1;
  const before = links.at(-1)?.text ?? inputs.summaryRoot?.text ?? null;
  const recent = renderUnits(
    summarisable
      .slice(covered + 1)
      .map((one) => ({ said: one.input?.text ?? '', replied: one.output?.text ?? '' })),
  );
  const material: Candidate[] = [
    ...(before === null
      ? []
      : [block('se.condense.before', 'user', `The story before this:\n\n${before}`)]),
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
      if (error instanceof RoleUnresolved) {
        return {
          ok: false,
          reason: error.reason === 'dangling' ? 'role-dangling' : 'role-unbound',
        };
      }
      if (error instanceof CallFailed) return { ok: false, reason: 'call-failed' };
      throw error;
    }
  };

  const text = async (prompt: string, part: SetupPart) => {
    const outcome = await call(CONDENSE_STEP, [
      block('se.condense.task', 'system', prompt),
      ...material,
      ...steer(part),
    ]);
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
          const outcome = await call(
            CONDENSE_STEP,
            [block('se.condense.task', 'system', TITLE_PROMPT), ...material, ...steer('title')],
            TITLE_SCHEMA,
          );
          return { value: readTitle(outcome.object), model: outcome.call.resolved.modelId };
        });
        break;
      case 'facts':
        parts.facts = await attempt(async () => {
          const outcome = await call(
            CONDENSE_STEP,
            [block('se.condense.task', 'system', EXTRACT_PROMPT), ...material, ...steer('facts')],
            EXTRACT_SCHEMA,
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
 * ***The commit: the companion book, then the Setup*** — [P13.7].
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
       * ***`generated`, and never `session`*** — [P13 §0.3]. A lorebook marked
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
