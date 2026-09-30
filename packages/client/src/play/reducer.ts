// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import type { Rendition } from '@storyengine/shared';

import type { SseFrame } from '../sse/parser.js';

/**
 * What the play surface knows, and how a frame changes it.
 *
 * **A pure reducer, and that is where the correctness of this feature lives.**
 * Reattach, ordering and the no-duplicate promise are all statements about a
 * sequence of frames — testable exactly, with no DOM, no timers and no server.
 * What is left for the components is rendering, which is the part a component
 * test is actually good at.
 */

/**
 * One step of the turn being taken, as the progress events describe it —
 * [P3.5].
 *
 * **Not a `StepOutcome`, deliberately**, and the difference is the whole of
 * what P3.5 decided. The record's step carries what a step *did*; this
 * carries what the event feed has *said so far*, which is a smaller and
 * differently-shaped thing: `running` is a state no committed step can be in,
 * the timings are the ones the events reported rather than the ones the
 * record measured, and the call's figures arrive in two instalments. Naming
 * it apart is what stops somebody rendering it through the record's views and
 * inheriting claims the events never made.
 */
export interface LiveStep {
  stepId: string;
  stage: string;
  state: 'running' | 'ok' | 'skipped' | 'failed';
  /** Why it was skipped — a class, as the server sends it. */
  skipReason: string | null;
  /** The failure class. Never a provider's words: those stay in the log. */
  error: string | null;
  /** What the step reported on finishing. Absent while it runs. */
  ms: number | null;
  contributed: { blocks: number; effects: number } | null;
  /** The call this step made, once it has started one. */
  call: {
    role: string;
    model: string;
    /** An estimate of the output so far, from `call.streaming`. */
    tokens: number | null;
    /** Measured, from `call.finished`. Null until then, and null if unreported. */
    promptTokens: number | null;
    completionTokens: number | null;
    ms: number | null;
  } | null;
}

/** A channel change as the event feed reports it — [P3.5]. */
export interface LiveEffect {
  channelId: string;
  accepted: boolean;
  /**
   * Which policy refused, when one did — the same class the record carries,
   * so the live view and the record cannot disagree about *why*. That
   * agreement is [P3.5]'s stated precondition, and it is why the event grew
   * this field.
   */
  reason: string | null;
}

/**
 * The turn being taken, as far as the events have said — [P3.5].
 *
 * Rebuilt from the event feed alone, which is what makes it survive a
 * reconnect: a fresh attach replays every event for the job from seq 0, so
 * this reconstructs itself without needing the draft the snapshot carries.
 * *True since 2026-09-28*: `seen` was seeded from the snapshot's cursor, which
 * is that replay's last seq, so every frame of it was dropped as a duplicate
 * (`applySnapshot` has the rest).
 */
export interface LiveTurn {
  turnId: string | null;
  steps: LiveStep[];
  effects: LiveEffect[];
  /** Terminal once `turn.finished` names it. */
  state: 'running' | 'complete' | 'failed' | 'suspended';
}

export interface PlayState {
  /** The job being watched, or null between turns. */
  jobId: string | null;
  /** What the turn has produced so far. Replaced by a snapshot, appended by a delta. */
  text: string;
  /** Where to resume from. The last durable event this client actually has. */
  cursor: string | null;
  /** The highest sequence seen per job, so a replayed frame is ignored. */
  seen: Readonly<Record<string, number>>;
  status: 'idle' | 'running' | 'finished' | 'reconnecting' | 'failed';
  /**
   * The turn under construction, from the events — [P3.5], and the field the
   * stage asked for when it said *the reducer keeps enough*.
   *
   * It replaces a `turn: unknown` that held the snapshot's draft record and
   * that **nothing ever read**: it was written once at attach, went stale for
   * the rest of the turn, and its docstring named an affordance deleted at
   * P3.2. Keeping a record nobody reads while the events that could answer
   * the question went unrendered was the exact shape of the problem this
   * stage was asked to decide.
   */
  live: LiveTurn | null;
  /**
   * Every rendition this stream has announced, keyed by id — [P9.2], [P9.4].
   *
   * ***A map because the frame carries the whole record.*** A rendition frame
   * has no `id:` line and takes no part in the backlog, which is what
   * `stream/sse.ts` traded for keeping `attachToSession` synchronous: *"it
   * carries the **whole record**, so a client applies it by upsert and converges
   * on the same map whatever it missed."* Upsert is the client's half of that
   * bargain, and it is one line because the key is on the record.
   *
   * **Why the reducer holds it at all**, when `useRenditions` already reads the
   * set: a rendition's state moves **after** its turn has finished, and
   * `PlayPage`'s invalidation effect is keyed on the `running → finished`
   * *transition* — a later frame leaves `status` at `'finished'` and invalidates
   * nothing. Folding the record here fixes that without a refetch at all, which
   * is better than the invalidate this stage set out to add: the frame already
   * holds everything the surface renders.
   *
   * ***Started afresh by every snapshot*** (2026-09-28). The page lets this map
   * outrank the query, which is right only while the map has heard everything
   * since it was filled: a frame sent while the stream was down reached nobody,
   * and nothing re-sent the set on attach (`attach.ts` has the correction), so
   * a picture that failed and then came out elsewhere stayed failed here
   * through every refetch. A snapshot is an attach; the map empties, the page
   * refetches the set on any but the first (`attached`), and a frame after it
   * is newer than anything the map held.
   */
  renditions: Readonly<Record<string, Rendition>>;
  /**
   * How many snapshots this stream has had — the first is the page opening, and
   * every one after is a re-attach, on which `PlayPage` refetches the pictures
   * the map above just forgot.
   */
  attached: number;
  /**
   * ***The round, message by message, as it streams*** — [P14 §1.8], [P14.5].
   *
   * Under `per-actor` dispatch each speaker's call streams into a message of
   * its own: `call.started` says which message and whose (`message`,
   * `speaker`), and each `delta` carries the index it belongs to. So a round
   * can be painted as the chat it will be — a bubble per speaker, named as it
   * opens — rather than as one paragraph by nobody that becomes a chat only
   * when the turn lands. `text` above is still appended by every delta, which
   * is the old reader's view and the fallback.
   *
   * ***`whole` is whether this client saw every piece.*** Deltas are not
   * durable: a reattach mid-round gets the joined text in the snapshot and
   * then only the pieces after it. The `call.started` frames before it do
   * replay, so the messages open under their speakers' names — ~~and `seen` is
   * seeded from the snapshot's cursor, so the `call.started` frames before it
   * do not replay either~~ (corrected 2026-09-28, when the seeding went) — but
   * what was said in them before this moment is in `text` and nowhere else.
   * So a snapshot that already had text sets `whole` false and a surface
   * paints `text` instead: less shape, nothing lost.
   */
  round: {
    messages: Readonly<Record<number, LiveMessage>>;
    whole: boolean;
  };
  /**
   * ***Who this round is for, in order*** — `speakers.picked`, [P14 §1.3a]
   * point 8: the *who speaks next* control shows it while the round streams.
   * `by` says whether a model chose (`model`), the rules did (`rules`), a
   * smart call fell back to them (`fallback`), or a rewrite kept the pick
   * (`rewrite`). Null until the server says, and for a narrator's turn.
   */
  order: { speakers: { id: string; name: string }[]; by: string } | null;
  /** A failure class, never a message: the server sends classes ([01 §2]). */
  error: string | null;
}

/** One message of the round being written — its author, and what has streamed. */
export interface LiveMessage {
  speaker: { id: string; name: string } | null;
  text: string;
}

const FRESH_ROUND: PlayState['round'] = { messages: {}, whole: true };

export const INITIAL: PlayState = {
  jobId: null,
  text: '',
  cursor: null,
  seen: {},
  status: 'idle',
  live: null,
  renditions: {},
  attached: 0,
  round: FRESH_ROUND,
  order: null,
  error: null,
};

export type PlayAction =
  | { kind: 'frame'; frame: SseFrame }
  /**
   * `error` carries the class where the transport has one — [P6B.0].
   *
   * `onFatal` has always been handed a class and this action had nowhere to
   * put it, so a stream the connector gave up on produced `status: 'failed'`
   * and `error: null`: the surface could say *something went wrong* and never
   * *what*. Optional rather than required because `reconnecting` is the same
   * action and genuinely has no class.
   */
  | { kind: 'status'; status: PlayState['status']; error?: string }
  | { kind: 'submitted'; jobId: string };

export function reduce(state: PlayState, action: PlayAction): PlayState {
  if (action.kind === 'status') {
    return {
      ...state,
      status: action.status,
      ...(action.error === undefined ? {} : { error: action.error }),
    };
  }
  if (action.kind === 'submitted') {
    /**
     * **The turn may already be over.**
     *
     * A step that refuses immediately — nothing bound to the prose role — takes
     * about a millisecond, and its frames travel on a connection that was
     * already open. So `turn.finished` can arrive and reduce *before* the POST's
     * response is handled, and a `submitted` that unconditionally said
     * `running` would overwrite a terminal state with a live one: the surface
     * sits on **Stop** forever, waiting for a turn that ended before it was
     * announced.
     *
     * Keyed on the job id rather than on time, because that is the only thing
     * that distinguishes *this turn already finished* from *the previous one
     * did*.
     */
    if (state.jobId === action.jobId && state.status === 'finished') return state;
    // Otherwise a fresh turn, and its text clears the previous one's so the
    // reader does not watch the last answer while waiting for this one.
    //
    // *The round is kept when this job's frames beat its POST here* — the case
    // above, one step earlier: `call.started` for this job may already have
    // opened a message, and clearing it would paint the round from its second
    // piece on. A new job is a new round. Keeping is safe because a frame of a
    // new job already cleared the last one's text and round (`forJob`), so
    // whatever `same` keeps is this job's.
    const same = state.jobId === action.jobId;
    return {
      ...state,
      jobId: action.jobId,
      text: same ? state.text : '',
      round: same ? state.round : FRESH_ROUND,
      order: same ? state.order : null,
      status: 'running',
      error: null,
    };
  }

  const { frame } = action;
  switch (frame.event) {
    case 'snapshot':
      return applySnapshot(state, frame.data);
    case 'progress':
      return applyProgress(state, frame);
    case 'delta':
      return applyDelta(state, frame.data);
    case 'rendition':
      return applyRendition(state, frame.data);
    case 'overflow':
      /**
       * The server gave up on a slow client and said where to resume. Not an
       * error: the cursor makes it lossless, and the connector reconnects from
       * it. Recorded as `reconnecting` so the UI can say something true.
       */
      return { ...state, cursor: cursorOf(frame.data) ?? state.cursor, status: 'reconnecting' };
    case 'error':
      // A class the server chose. Fatal — the connector does not retry it.
      return { ...state, status: 'failed', error: classOf(frame.data) };
    default:
      return state;
  }
}

function applySnapshot(state: PlayState, data: unknown): PlayState {
  if (!isRecord(data)) return state;
  const job = isRecord(data['job']) ? data['job'] : null;
  const jobId = typeof job?.['id'] === 'string' ? job['id'] : null;
  const cursor = typeof data['cursor'] === 'string' ? data['cursor'] : null;

  return {
    ...state,
    jobId,
    // The snapshot's text is authoritative — it includes the deltas the last
    // checkpoint had not caught, which is what closes the reattach hole.
    text: typeof data['text'] === 'string' ? data['text'] : '',
    cursor,
    /**
     * ***`seen` is left as this client's own record*** (2026-09-28). ~~Seeding
     * `seen` from the snapshot's cursor is what makes a replayed frame a no-op
     * rather than a duplicate.~~ It made every replayed frame a no-op, the ones
     * this client had never had included: the server sends its backlog *after*
     * the snapshot, and the snapshot's cursor is that backlog's last seq
     * (`attach.ts`). So a reload mid-turn dropped the whole feed and `live` was
     * never rebuilt, and a reconnect dropped what it had missed —
     * `turn.finished` among it, so a turn that ended in the gap showed as
     * running until the next one began. The server already promises no
     * overlap — its backlog starts after the cursor asked for, and what it
     * buffered meanwhile is filtered against that backlog — so the guard needs
     * only what this client has applied. The test that stood for the seeding
     * gave its snapshot a cursor and no backlog, a shape the server never sends.
     */
    /**
     * **The snapshot's `turn` is deliberately dropped** — [P3.5].
     *
     * It carries the whole checkpointed draft, and the stage decided against
     * rendering it: it arrives once, at open, and then goes stale for the rest
     * of the turn, so a view fed from it would freeze mid-sentence while the
     * events kept flowing past. The events are what this client keeps instead,
     * and the backlog replays from seq 0 on a fresh attach — so `live` is
     * rebuilt by the frames that follow this one rather than seeded from here.
     * The draft comes back when something can use it whole: P3.7's dry run.
     */
    live: state.live,
    // Afresh, for `renditions`' reason: the set is refetched on a re-attach, and
    // what this map heard before the drop may be older than what it missed.
    renditions: {},
    attached: state.attached + 1,
    // The pieces before this moment are in `text` and nowhere else, so a
    // snapshot that holds any means this client cannot paint the round whole.
    round: {
      messages: {},
      whole: typeof data['text'] !== 'string' || data['text'] === '',
    },
    status: job === null ? 'idle' : statusOf(job['status']),
    error: null,
  };
}

function applyProgress(state: PlayState, frame: SseFrame): PlayState {
  if (!isRecord(frame.data)) return state;
  const jobId = typeof frame.data['jobId'] === 'string' ? frame.data['jobId'] : null;
  const seq = typeof frame.data['seq'] === 'number' ? frame.data['seq'] : null;
  if (jobId === null || seq === null) return state;

  /**
   * **The duplicate guard.** A reconnect replays from a cursor, and a frame at
   * or below what this client already has is one it already applied. Dropping
   * it here rather than trusting the server is the client's half of
   * exactly-once: the server promises not to skip, and this promises not to
   * double-count.
   */
  if (seq <= (state.seen[jobId] ?? 0)) return state;

  const key = keyOf(frame.data);
  const params = paramsOf(frame.data);
  const seen = { ...state.seen, [jobId]: seq };
  const cursor = frame.id ?? state.cursor;

  /**
   * ***An older job's frames move nothing the snapshot said*** (2026-09-28).
   *
   * A reconnect that spans jobs gets a snapshot naming the newest — its
   * status, its text so far — and then the older ones' frames before the
   * newest one's (`attach.ts` replays the cursor's job first, then every job
   * after it). Every frame of another job used to switch to it: the older
   * tail took `jobId` back, and `forJob` cleared the newest job's text from the
   * snapshot; its own frames then switched again, onto an empty buffer and a
   * status an older `turn.finished` had left at *finished* while it ran.
   *
   * Job ids are uuidv7 and sort in the order they were minted (`shared/ids.ts`
   * says why that holds), so an older job is one whose id sorts first. Its
   * frames still close the live turn they belong to — the one on screen until
   * the next `turn.started` replaces it — and move nothing else. A newer job is
   * followed from its first frame, whichever that is: a turn is not the only
   * way a job ends, and one finalised before it ever ran says only
   * `turn.finished`.
   */
  if (state.jobId !== null && jobId !== state.jobId && mintedBefore(jobId, state.jobId)) {
    return { ...state, seen, cursor, live: applyToLive(state.live, key, params) };
  }

  const finished = key === 'turn.finished';
  const current = forJob(state, jobId);
  return {
    ...current,
    jobId,
    seen,
    cursor,
    // A new job's start is running whatever the last one ended as — which
    // `idle` alone did not cover, so a job whose frames beat its POST sat at
    // the previous job's *finished* until the POST answered.
    status: finished
      ? 'finished'
      : jobId !== state.jobId || state.status === 'idle'
        ? 'running'
        : state.status,
    live: applyToLive(state.live, key, params),
    round: key === 'call.started' ? openMessage(current.round, params) : current.round,
    order: key === 'speakers.picked' ? (orderOf(params) ?? current.order) : current.order,
  };
}

/**
 * ***A frame of another job starts a fresh turn*** — its text, round and order.
 * *Of a newer job*, since 2026-09-28: an older job's frames arrive after a
 * snapshot that already names the newer one, and clearing on them took the
 * current job's text with it (`applyProgress` says when that happens).
 *
 * A new job's frames can reach the reducer before its POST's response does
 * (`submitted`'s docstring), and until this they were applied on top of the
 * previous job's state: the old reply's words showed inside the new live turn,
 * legacy and narrated turns included, where `submitted` used to be the thing
 * that always cleared the text. `applyDelta` needs no such check — it carries
 * no job id, and a new job's progress frames reach here ahead of its first
 * delta.
 */
function forJob(state: PlayState, jobId: string): PlayState {
  if (jobId === state.jobId) return state;
  return { ...state, text: '', round: FRESH_ROUND, order: null };
}

/**
 * A speaking call opening its message — [P14.5]. *Opened, not overwritten*: a
 * continue's call writes into a message that already has text, and a retried
 * call re-announces the one it is retrying.
 */
function openMessage(
  round: PlayState['round'],
  params: Record<string, unknown>,
): PlayState['round'] {
  const index = params['message'];
  if (typeof index !== 'number') return round;
  const held = round.messages[index];
  return {
    ...round,
    messages: {
      ...round.messages,
      [index]: {
        speaker: refOf(params['speaker']) ?? held?.speaker ?? null,
        text: held?.text ?? '',
      },
    },
  };
}

function orderOf(params: Record<string, unknown>): PlayState['order'] {
  const listed = params['speakers'];
  if (!Array.isArray(listed)) return null;
  const speakers = listed.flatMap((one: unknown) => {
    const ref = refOf(one);
    return ref === null ? [] : [ref];
  });
  return { speakers, by: stringOr(params['by'], 'rules') };
}

function refOf(value: unknown): { id: string; name: string } | null {
  if (!isRecord(value)) return null;
  const { id, name } = value;
  return typeof id === 'string' && typeof name === 'string' ? { id, name } : null;
}

/**
 * The turn under construction, folded from one event — [P3.5].
 *
 * **Every arm reads only what its own event carries**, which is the property
 * that keeps this a rendering of the feed rather than a reconstruction of the
 * record. Where the events are silent the fields stay null and the view says
 * so; nothing here infers, and nothing here reaches for the draft.
 *
 * Unknown keys fall through unchanged, so a server that grows a twelfth event
 * does not break a client that has not learned it yet.
 */
function applyToLive(
  live: LiveTurn | null,
  key: string | null,
  params: Record<string, unknown>,
): LiveTurn | null {
  if (key === 'turn.started') {
    // A fresh turn replaces whatever the last one left behind.
    return { turnId: stringOr(params['turnId'], null), steps: [], effects: [], state: 'running' };
  }
  if (live === null) return live;

  switch (key) {
    case 'step.started':
      return withStep(live, params, (step) => ({ ...step, state: 'running' }));
    case 'step.skipped':
      return withStep(live, params, (step) => ({
        ...step,
        state: 'skipped',
        skipReason: stringOr(params['reason'], null),
      }));
    case 'step.finished':
      return withStep(live, params, (step) => ({
        ...step,
        state: 'ok',
        ms: numberOr(params['ms'], null),
        contributed: contributedOf(params['contributed']),
      }));
    case 'step.failed':
      return withStep(live, params, (step) => ({
        ...step,
        state: 'failed',
        error: stringOr(params['error'], null),
      }));
    case 'call.started':
      return withStep(live, params, (step) => ({
        ...step,
        call: {
          role: stringOr(params['role'], ''),
          model: stringOr(params['model'], ''),
          tokens: null,
          promptTokens: null,
          completionTokens: null,
          ms: null,
        },
      }));
    case 'call.streaming':
      return withStep(live, params, (step) =>
        step.call === null
          ? step
          : { ...step, call: { ...step.call, tokens: numberOr(params['tokens'], null) } },
      );
    case 'call.finished':
      return withStep(live, params, (step) =>
        step.call === null
          ? step
          : {
              ...step,
              call: {
                ...step.call,
                // Null rather than zero when the provider reported nothing —
                // the same distinction the record draws ([21 §1.4]).
                promptTokens: numberOr(params['promptTokens'], null),
                completionTokens: numberOr(params['completionTokens'], null),
                ms: numberOr(params['ms'], null),
              },
            },
      );
    case 'effect.applied': {
      const channelId = stringOr(params['channelId'], null);
      if (channelId === null) return live;
      return {
        ...live,
        effects: [
          ...live.effects,
          {
            channelId,
            accepted: params['accepted'] === true,
            reason: stringOr(params['reason'], null),
          },
        ],
      };
    }
    case 'turn.finished':
      return { ...live, state: terminalOf(params['state']) };
    default:
      return live;
  }
}

/**
 * Finds the step the event names and rewrites it, appending it first if this
 * is the first anyone has heard of it.
 *
 * Appending rather than requiring `step.started` first is what makes a
 * reconnect mid-step land somewhere sensible: the backlog replays from seq 0,
 * so it will normally have the start — but a `skipped` step never emits one
 * at all, and a view that dropped those would silently lose the answer
 * [09 §3.3] names as the whole point of `skipped` being visible.
 */
function withStep(
  live: LiveTurn,
  params: Record<string, unknown>,
  change: (step: LiveStep) => LiveStep,
): LiveTurn {
  const stepId = stringOr(params['stepId'], null);
  if (stepId === null) return live;

  const at = live.steps.findIndex((step) => step.stepId === stepId);
  const existing = live.steps[at] ?? {
    stepId,
    stage: stringOr(params['stage'], ''),
    state: 'running' as const,
    skipReason: null,
    error: null,
    ms: null,
    contributed: null,
    call: null,
  };
  // `stage` travels only on `step.started`; a later event must not blank it.
  const stage = stringOr(params['stage'], existing.stage);
  const next = change({ ...existing, stage });

  return {
    ...live,
    steps:
      at === -1 ? [...live.steps, next] : live.steps.map((step, i) => (i === at ? next : step)),
  };
}

function contributedOf(value: unknown): { blocks: number; effects: number } | null {
  if (!isRecord(value)) return null;
  return { blocks: numberOr(value['blocks'], 0), effects: numberOr(value['effects'], 0) };
}

function terminalOf(value: unknown): LiveTurn['state'] {
  return value === 'complete' || value === 'failed' || value === 'suspended' ? value : 'running';
}

function stringOr<T extends string | null>(value: unknown, fallback: T): string | T {
  return typeof value === 'string' ? value : fallback;
}

function numberOr<T extends number | null>(value: unknown, fallback: T): number | T {
  return typeof value === 'number' ? value : fallback;
}

function paramsOf(data: Record<string, unknown>): Record<string, unknown> {
  return isRecord(data['params']) ? data['params'] : {};
}

/**
 * A rendition arriving, in whatever state it arrived in — [P9.2].
 *
 * ***Upsert, not append***, and the difference matters on a reconnect: the
 * `pending` frame and the `ready` frame that follows it are the **same** record
 * under the same id, so a list would grow a duplicate where a map converges.
 * That convergence is the whole reason the frame carries the record rather than
 * a progress key, so the client is where it has to be honoured.
 *
 * ***The guard checks the fields that decide rendering and trusts the rest.***
 * Every other reader here reconstructs from primitives because the events are a
 * *feed* — differently shaped from the record, per `LiveStep`'s docstring. A
 * rendition frame is the record, so rebuilding it field by field would be
 * writing `Rendition` twice and letting the two drift. What is checked is what
 * a wrong answer would break silently: the key it is filed under, the turn it
 * hangs on, and the two closed vocabularies the view switches on.
 */
function applyRendition(state: PlayState, data: unknown): PlayState {
  if (!isRecord(data)) return state;
  const id = data['id'];
  const turnId = data['turnId'];
  if (typeof id !== 'string' || typeof turnId !== 'string') return state;
  if (data['state'] !== 'pending' && data['state'] !== 'ready' && data['state'] !== 'failed') {
    return state;
  }
  if (data['purpose'] !== 'illustration' && data['purpose'] !== 'background') return state;

  return { ...state, renditions: { ...state.renditions, [id]: data as unknown as Rendition } };
}

function applyDelta(state: PlayState, data: unknown): PlayState {
  if (!isRecord(data) || typeof data['text'] !== 'string') return state;
  /**
   * Appended, and **deliberately not deduplicated**: a delta carries no id
   * because no store can answer for one ([P2 §2.10] declines to make them
   * durable). What makes that safe is the snapshot — a reattach replaces the
   * text wholesale rather than continuing to append to a stale buffer.
   */
  const index = data['message'];
  /**
   * ***A piece with an index is also that message's*** — [P14.2]'s `message`
   * on the frame. The blank line between two speakers comes without one, so it
   * lands in `text` alone, which is exactly where it belongs.
   */
  const round =
    typeof index === 'number'
      ? {
          ...state.round,
          messages: {
            ...state.round.messages,
            [index]: {
              speaker: state.round.messages[index]?.speaker ?? null,
              text: (state.round.messages[index]?.text ?? '') + data['text'],
            },
          },
        }
      : state.round;
  return { ...state, text: state.text + data['text'], round, status: 'running' };
}

/**
 * ***The round as bubbles, when this client can draw it so*** — in message
 * order, or null when it cannot: nothing indexed has arrived (a narrator's
 * turn, a server older than [P14.2]) or a reattach cost it the round's start
 * (`round.whole`). Null means *paint `text`*.
 */
export function liveMessages(state: PlayState): LiveMessage[] | null {
  if (!state.round.whole) return null;
  const indices = Object.keys(state.round.messages)
    .map(Number)
    .sort((a, b) => a - b);
  if (indices.length === 0) return null;
  return indices.flatMap((index) => {
    const message = state.round.messages[index];
    return message === undefined ? [] : [message];
  });
}

/**
 * Whether one job was minted before another. Job ids are uuidv7, which sort as
 * strings in the order they were minted — `shared/ids.ts`'s *monotonic*, the
 * property that id was chosen for.
 */
function mintedBefore(a: string, b: string): boolean {
  return a < b;
}

function statusOf(value: unknown): PlayState['status'] {
  return value === 'committed' || value === 'abandoned' ? 'finished' : 'running';
}

function cursorOf(data: unknown): string | null {
  return isRecord(data) && typeof data['cursor'] === 'string' ? data['cursor'] : null;
}

function classOf(data: unknown): string {
  return isRecord(data) && typeof data['error'] === 'string' ? data['error'] : 'internal';
}

function keyOf(data: Record<string, unknown>): string | null {
  return typeof data['key'] === 'string' ? data['key'] : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
