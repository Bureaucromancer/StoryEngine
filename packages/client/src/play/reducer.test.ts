// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { describe, expect, it } from 'vitest';

import { INITIAL, liveMessages, reduce, type PlayState } from './reducer.js';
import { SseParser } from '../sse/parser.js';

/**
 * The play surface's state machine — [P2 §2.10], exit gate 14.
 *
 * Everything that can be got wrong about reattach is a statement about a
 * *sequence of frames*, so it is asserted here rather than through a rendered
 * component: no DOM, no timers, no server, and a failure names the frame that
 * caused it.
 */

function run(state: PlayState, frames: { event: string; id?: string; data: unknown }[]): PlayState {
  return frames.reduce((current, frame) => reduce(current, { kind: 'frame', frame }), state);
}

const snapshot = (over: Record<string, unknown> = {}): { event: string; data: unknown } => ({
  event: 'snapshot',
  data: {
    sessionId: 's',
    job: { id: 'job-1', status: 'running', turnId: 't', commitStep: 0 },
    turn: null,
    text: '',
    cursor: null,
    ...over,
  },
});

const progress = (
  seq: number,
  key = 'call.streaming',
): { event: string; id: string; data: unknown } => ({
  event: 'progress',
  id: `job-1.${String(seq)}`,
  data: { jobId: 'job-1', seq, key, params: {}, at: 0 },
});

/** A `turn.finished` that says how the turn ended, as the server's does. */
const finishedFrame = (
  jobId: string,
  seq: number,
): { event: string; id: string; data: unknown } => ({
  event: 'progress',
  id: `${jobId}.${String(seq)}`,
  data: { jobId, seq, key: 'turn.finished', params: { state: 'complete' }, at: 0 },
});

const delta = (text: string): { event: string; data: unknown } => ({
  event: 'delta',
  data: { jobId: 'job-1', text },
});

describe('a turn watched from the start', () => {
  it('accumulates deltas and ends on turn.finished', () => {
    const state = run(INITIAL, [
      snapshot(),
      progress(1, 'turn.started'),
      delta('The rain '),
      delta('had not stopped.'),
      progress(2, 'turn.finished'),
    ]);

    expect(state.text).toBe('The rain had not stopped.');
    expect(state.status).toBe('finished');
    expect(state.cursor).toBe('job-1.2');
  });

  it('is idle between turns', () => {
    expect(run(INITIAL, [snapshot({ job: null })]).status).toBe('idle');
  });
});

describe('reattach loses nothing and repeats nothing', () => {
  it('does not let a replayed frame drag the cursor backwards', () => {
    // The client's half of exactly-once: the server promises not to skip, and
    // this promises not to double-count. A reconnect replays *from* a cursor, so
    // the frame at that cursor arrives again by design — and a client that
    // applied it would reconnect from an older place next time, re-reading
    // everything between. Asserted on the *stale* frame arriving last, because
    // replaying in order reaches the right answer either way.
    const caught = run(INITIAL, [snapshot(), progress(1), progress(2), progress(3)]);
    const afterStale = run(caught, [progress(1)]);

    expect(afterStale.cursor).toBe('job-1.3');
    expect(afterStale.seen['job-1']).toBe(3);
  });

  it('does not let a replayed turn.finished reopen a turn that ended', () => {
    const ended = run(INITIAL, [snapshot(), progress(1), progress(2, 'turn.finished')]);
    // A reconnect that replayed the whole job would otherwise walk the UI back
    // through running and out again.
    const replayed = run(ended, [progress(1, 'turn.started')]);

    expect(replayed.status).toBe('finished');
  });

  it('takes the snapshot text wholesale rather than appending to a stale buffer', () => {
    // The reason a delta needs no id. A reattach replaces; it does not continue
    // — so the deltas the last checkpoint had not caught arrive once, inside the
    // snapshot, rather than twice.
    const mid = run(INITIAL, [snapshot(), delta('The rain ')]);
    const reattached = run(mid, [
      snapshot({ text: 'The rain had not stopped.', cursor: 'job-1.4' }),
    ]);

    expect(reattached.text).toBe('The rain had not stopped.');
    expect(reattached.cursor).toBe('job-1.4');
  });

  /**
   * ***Replaced 2026-09-28.*** *"Seeds the duplicate guard from the snapshot
   * cursor"* gave its snapshot a cursor and sent no backlog — a shape the
   * server never sends: its cursor is the last seq of the backlog that
   * follows the snapshot (`attach.ts`), so the seeding dropped every frame of
   * it. These use the real shape, a cursor and then the frames up to it.
   */
  it('applies the backlog that follows a snapshot, up to the snapshot’s own cursor', () => {
    const reloaded = run(INITIAL, [
      snapshot({ text: 'The rain ', cursor: 'job-1.3' }),
      progress(1, 'turn.started'),
      progress(2, 'step.started'),
      progress(3, 'call.started'),
    ]);

    expect(reloaded.seen['job-1']).toBe(3);
    expect(reloaded.live?.state).toBe('running');
    expect(reloaded.text).toBe('The rain ');
    expect(reloaded.status).toBe('running');
  });

  it('finishes a turn that ended during a drop, from the frames the reconnect replays', () => {
    const before = run(INITIAL, [snapshot(), progress(1, 'turn.started'), progress(2)]);
    const after = run(before, [
      snapshot({
        job: { id: 'job-1', status: 'committed', turnId: 't', commitStep: 0 },
        text: 'The rain had not stopped.',
        cursor: 'job-1.4',
      }),
      progress(3),
      finishedFrame('job-1', 4),
    ]);

    expect(after.live?.state).toBe('complete');
    expect(after.status).toBe('finished');
    expect(after.seen['job-1']).toBe(4);
  });
});

/**
 * ***A reconnect that spans two jobs*** (2026-09-28). The snapshot names the
 * newer job, and the older one's tail is replayed after it and before the
 * newer one's feed. Every frame of another job used to switch to that job, so
 * the older tail took the newer job's text from the snapshot and left its
 * status at the older job's *finished*.
 */
describe('a reconnect that spans two jobs', () => {
  const second = (seq: number, key: string, params: Record<string, unknown> = {}) => ({
    event: 'progress',
    id: `job-2.${String(seq)}`,
    data: { jobId: 'job-2', seq, key, params, at: 0 },
  });
  const onJobTwo = (over: Record<string, unknown>) =>
    snapshot({ job: { id: 'job-2', status: 'running', turnId: 't2', commitStep: 0 }, ...over });

  it('ends on the newer job, with the text the snapshot gave it', () => {
    const before = run(INITIAL, [snapshot(), progress(1, 'turn.started'), progress(2)]);
    const after = run(before, [
      onJobTwo({ text: 'Lund looked up.', cursor: 'job-2.2' }),
      progress(3, 'turn.finished'),
      second(1, 'turn.started', { turnId: 't2' }),
      second(2, 'step.started', { stepId: 'se.narrate', stage: 'generate' }),
    ]);

    expect(after.jobId).toBe('job-2');
    expect(after.text).toBe('Lund looked up.');
    expect(after.status).toBe('running');
    expect(after.live?.turnId).toBe('t2');
    expect(after.seen).toEqual({ 'job-1': 3, 'job-2': 2 });
  });

  it('closes the older turn when the newer has not started, and follows the newer', () => {
    const before = run(INITIAL, [snapshot(), progress(1, 'turn.started'), progress(2)]);
    const after = run(before, [
      onJobTwo({ job: { id: 'job-2', status: 'queued', turnId: 't2', commitStep: 0 } }),
      finishedFrame('job-1', 3),
    ]);

    expect(after.jobId).toBe('job-2');
    expect(after.live?.state).toBe('complete');
    expect(after.status).toBe('running');
  });

  it('ends on the newest of three, the middle one replayed whole before it', () => {
    const third = (seq: number, key: string, params: Record<string, unknown> = {}) => ({
      event: 'progress',
      id: `job-3.${String(seq)}`,
      data: { jobId: 'job-3', seq, key, params, at: 0 },
    });
    const before = run(INITIAL, [snapshot(), progress(1, 'turn.started'), progress(2)]);
    const after = run(before, [
      snapshot({
        job: { id: 'job-3', status: 'running', turnId: 't3', commitStep: 0 },
        text: 'The tide turned.',
        cursor: 'job-3.1',
      }),
      finishedFrame('job-1', 3),
      second(1, 'turn.started', { turnId: 't2' }),
      finishedFrame('job-2', 2),
      third(1, 'turn.started', { turnId: 't3' }),
    ]);

    expect(after.jobId).toBe('job-3');
    expect(after.text).toBe('The tide turned.');
    expect(after.status).toBe('running');
    expect(after.live?.turnId).toBe('t3');
  });

  it('runs a new job from its start, before its POST has answered', () => {
    const done = run(INITIAL, [
      snapshot(),
      progress(1, 'turn.started'),
      progress(2, 'turn.finished'),
    ]);
    const next = run(done, [second(1, 'turn.started', { turnId: 't2' })]);

    expect(next.jobId).toBe('job-2');
    expect(next.status).toBe('running');
  });
});

describe('the two frames a client must not treat as ordinary', () => {
  it('reads overflow as a place to resume, not as a failure', () => {
    // The server gave up on a slow reader and said where to pick up. The cursor
    // is what makes that lossless.
    const state = run(INITIAL, [snapshot(), { event: 'overflow', data: { cursor: 'job-1.9' } }]);

    expect(state.status).toBe('reconnecting');
    expect(state.cursor).toBe('job-1.9');
    expect(state.error).toBeNull();
  });

  it('reads an error frame as fatal, carrying a class rather than prose', () => {
    // Sent after the head is already 200, so the transport cannot see it as a
    // status — which is the whole reason the frame exists.
    const state = run(INITIAL, [snapshot(), { event: 'error', data: { error: 'internal' } }]);

    expect(state.status).toBe('failed');
    expect(state.error).toBe('internal');
  });

  /**
   * **A transport failure carries its class too** — [P6B.0].
   *
   * `onFatal` has always been handed a class and this action had nowhere to
   * put it, so a stream the connector gave up on arrived as `failed` with a
   * null error and the surface could only say *something went wrong*. The two
   * fatal paths — a frame the server sent, and a connection the client gave up
   * on — now answer the same question.
   */
  it('carries a class through a fatal status, and none through a reconnect', () => {
    const failed = reduce(INITIAL, { kind: 'status', status: 'failed', error: 'unbound' });
    expect(failed.status).toBe('failed');
    expect(failed.error).toBe('unbound');

    // A reconnect has no class and must not invent one — nor wipe the one a
    // previous failure left, which is why the field is only written when it is
    // given.
    const reconnecting = reduce(failed, { kind: 'status', status: 'reconnecting' });
    expect(reconnecting.status).toBe('reconnecting');
    expect(reconnecting.error).toBe('unbound');
  });
});

describe('the parser', () => {
  it('holds a frame split across chunk boundaries', () => {
    // The case a component test would never reproduce reliably, and the only
    // reason this is a separate object.
    const parser = new SseParser();

    expect(parser.push('event: prog')).toEqual([]);
    expect(parser.push('ress\ndata: {"seq":1}')).toEqual([]);
    expect(parser.push('\n\n')).toEqual([{ event: 'progress', data: { seq: 1 } }]);
  });

  it('yields nothing for a keepalive comment', () => {
    expect(new SseParser().push(': keepalive\n\n')).toEqual([]);
  });

  it('keeps the id, which is the cursor', () => {
    const frames = new SseParser().push('id: job-1.3\nevent: progress\ndata: {"seq":3}\n\n');
    expect(frames[0]?.id).toBe('job-1.3');
  });

  it('reports a frame whose data is not JSON rather than losing it', () => {
    expect(new SseParser().push('event: x\ndata: not json\n\n')).toEqual([
      { event: 'x', data: 'not json' },
    ]);
  });
});

describe('submitting', () => {
  it('clears the previous answer so the reader is not watching a stale one', () => {
    const finished = run(INITIAL, [snapshot(), delta('An old answer.')]);
    const next = reduce(finished, { kind: 'submitted', jobId: 'job-2' });

    expect(next.text).toBe('');
    expect(next.status).toBe('running');
  });

  /**
   * **The turn that ends before it is announced.**
   *
   * Observed, not imagined: submitting against a session with nothing bound to
   * the prose role produced a turn that failed in one millisecond, so
   * `turn.finished` arrived on the open stream before the POST's response was
   * handled. The surface then showed *Stop* with no job to stop, permanently.
   */
  it('does not reopen a turn the stream already closed', () => {
    const already = run(INITIAL, [progress(1, 'turn.finished')]);
    expect(already.status).toBe('finished');

    const next = reduce(already, { kind: 'submitted', jobId: already.jobId ?? '' });

    expect(next.status).toBe('finished');
  });

  it('still opens a different turn on the same stream', () => {
    const already = run(INITIAL, [progress(1, 'turn.finished')]);
    const next = reduce(already, { kind: 'submitted', jobId: 'a-later-job' });

    expect(next.status).toBe('running');
    expect(next.jobId).toBe('a-later-job');
  });
});

/**
 * The turn under construction — [P3.5].
 *
 * The stage decided [09 §3.3] against its own *one component live and
 * historical* claim: the live view is the **progress events** rendered, not
 * the record rendered early. So these assert what the feed says and nothing
 * more — no field here is inferred, and none is borrowed from the draft the
 * snapshot carries.
 */
const event = (
  seq: number,
  key: string,
  params: Record<string, unknown> = {},
): { event: string; id: string; data: unknown } => ({
  event: 'progress',
  id: `job-1.${String(seq)}`,
  data: { jobId: 'job-1', seq, key, params, at: 0 },
});

describe('the live turn', () => {
  it('is nothing until a turn starts, and starts empty', () => {
    const before = run(INITIAL, [snapshot()]);
    expect(before.live).toBeNull();

    const started = run(before, [event(1, 'turn.started', { turnId: 't-1' })]);
    expect(started.live).toEqual({ turnId: 't-1', steps: [], effects: [], state: 'running' });
  });

  it('follows a step from started to finished, with what it reported', () => {
    const state = run(INITIAL, [
      snapshot(),
      event(1, 'turn.started', { turnId: 't-1' }),
      event(2, 'step.started', { stepId: 'se.narrate', stage: 'generate' }),
      event(3, 'call.started', { stepId: 'se.narrate', role: 'prose', model: 'gemma-4' }),
      event(4, 'call.streaming', { stepId: 'se.narrate', tokens: 42 }),
      event(5, 'call.finished', {
        stepId: 'se.narrate',
        promptTokens: 397,
        completionTokens: 214,
        ms: 23_412,
      }),
      event(6, 'step.finished', {
        stepId: 'se.narrate',
        contributed: { blocks: 2, effects: 0 },
        ms: 23_500,
      }),
    ]);

    expect(state.live?.steps).toHaveLength(1);
    const step = state.live?.steps[0];
    expect(step?.state).toBe('ok');
    expect(step?.stage).toBe('generate');
    expect(step?.ms).toBe(23_500);
    expect(step?.contributed).toEqual({ blocks: 2, effects: 0 });
    // The call's figures arrive in two instalments and both land on one step.
    expect(step?.call).toEqual({
      role: 'prose',
      model: 'gemma-4',
      tokens: 42,
      promptTokens: 397,
      completionTokens: 214,
      ms: 23_412,
    });
  });

  it('keeps a skipped step, which never announces itself first', () => {
    // [09 §3.3]: *a step whose `when` predicate was false is a common source of
    // "why didn't that happen?", and silence is the worst possible answer.*
    // `step.skipped` arrives with no preceding `step.started`, so a fold that
    // required one would drop exactly the answer the event exists to give.
    const state = run(INITIAL, [
      snapshot(),
      event(1, 'turn.started', { turnId: 't-1' }),
      event(2, 'step.skipped', { stepId: 'se.recap', reason: 'cadence' }),
    ]);

    expect(state.live?.steps).toHaveLength(1);
    expect(state.live?.steps[0]?.state).toBe('skipped');
    expect(state.live?.steps[0]?.skipReason).toBe('cadence');
  });

  it('records a failure as the class the server sent, never a message', () => {
    const state = run(INITIAL, [
      snapshot(),
      event(1, 'turn.started', { turnId: 't-1' }),
      event(2, 'step.started', { stepId: 'se.narrate', stage: 'generate' }),
      event(3, 'step.failed', { stepId: 'se.narrate', error: 'terminal', willRetry: false }),
      event(4, 'turn.finished', { state: 'failed' }),
    ]);

    expect(state.live?.steps[0]?.state).toBe('failed');
    expect(state.live?.steps[0]?.error).toBe('terminal');
    expect(state.live?.state).toBe('failed');
  });

  it('carries why an effect was refused, so it cannot disagree with the record', () => {
    // [P3.5]'s stated precondition. Before this stage the event carried only
    // `{channelId, accepted}`, so a live reader said *refused* where the record
    // said *refused because the engine computes this channel*.
    const state = run(INITIAL, [
      snapshot(),
      event(1, 'turn.started', { turnId: 't-1' }),
      event(2, 'effect.applied', {
        channelId: 'se.clock',
        accepted: false,
        reason: 'engine-computed',
      }),
      event(3, 'effect.applied', { channelId: 'se.clock', accepted: true, reason: null }),
    ]);

    expect(state.live?.effects).toEqual([
      { channelId: 'se.clock', accepted: false, reason: 'engine-computed' },
      { channelId: 'se.clock', accepted: true, reason: null },
    ]);
  });

  it('rebuilds itself from a replayed backlog, which is what a reattach delivers', () => {
    // A fresh attach replays every event for the job from seq 0
    // (`attach.ts`: `from = ... : 0`), so the live view reconstructs without
    // ever needing the draft the snapshot carries. This is the property that
    // let the stage drop the snapshot's `turn` entirely.
    const backlog = [
      event(1, 'turn.started', { turnId: 't-1' }),
      event(2, 'step.started', { stepId: 'se.narrate', stage: 'generate' }),
      event(3, 'call.started', { stepId: 'se.narrate', role: 'prose', model: 'gemma-4' }),
    ];

    const live = run(INITIAL, [snapshot(), ...backlog]);
    const reattached = run(INITIAL, [snapshot(), ...backlog]);

    expect(reattached.live).toEqual(live.live);
    expect(reattached.live?.steps[0]?.call?.model).toBe('gemma-4');
  });

  it('replaces the last turn rather than appending to it', () => {
    const first = run(INITIAL, [
      snapshot(),
      event(1, 'turn.started', { turnId: 't-1' }),
      event(2, 'step.started', { stepId: 'se.narrate', stage: 'generate' }),
      event(3, 'turn.finished', { state: 'complete' }),
    ]);
    const second = run(first, [event(4, 'turn.started', { turnId: 't-2' })]);

    expect(second.live?.turnId).toBe('t-2');
    expect(second.live?.steps).toEqual([]);
    expect(second.live?.state).toBe('running');
  });

  it('ignores an event it has not learned, rather than breaking on it', () => {
    const state = run(INITIAL, [
      snapshot(),
      event(1, 'turn.started', { turnId: 't-1' }),
      event(2, 'job.progress', { jobId: 'j', kind: 'rendition', state: 'running' }),
    ]);

    expect(state.live?.steps).toEqual([]);
    expect(state.live?.state).toBe('running');
  });
});

/**
 * ***A round, painted as the chat it will be*** — [P14 §1.8], [P14.5].
 *
 * The three claims a simplification would break: a piece lands in the message
 * its index names and nowhere else but `text`; the between-speakers blank line
 * (no index) never becomes a bubble; and a reattach that cost the round's start
 * paints the text rather than half a chat.
 */
describe('the round, message by message', () => {
  const indexed = (text: string, message?: number): { event: string; data: unknown } => ({
    event: 'delta',
    data: { jobId: 'job-1', text, ...(message === undefined ? {} : { message }) },
  });
  const VERA = { id: 'vera', name: 'Vera' };
  const LUND = { id: 'lund', name: 'Lund' };

  it('opens a named bubble per speaker and fills each from its own pieces', () => {
    const state = run(INITIAL, [
      snapshot(),
      event(1, 'turn.started', { turnId: 't' }),
      event(2, 'speakers.picked', { speakers: [VERA, LUND], by: 'model' }),
      event(3, 'call.started', { stepId: 'g', message: 0, speaker: VERA }),
      indexed('"You ', 0),
      indexed('came."', 0),
      indexed('\n\n'),
      event(4, 'call.started', { stepId: 'g', message: 1, speaker: LUND }),
      indexed('"Aye."', 1),
    ]);

    expect(liveMessages(state)).toEqual([
      { speaker: VERA, text: '"You came."' },
      { speaker: LUND, text: '"Aye."' },
    ]);
    expect(state.text).toBe('"You came."\n\n"Aye."');
    expect(state.order).toEqual({ speakers: [VERA, LUND], by: 'model' });
  });

  it('paints the text when nothing is indexed, as a narrator’s turn is', () => {
    const state = run(INITIAL, [snapshot(), indexed('Rain.')]);
    expect(liveMessages(state)).toBeNull();
    expect(state.text).toBe('Rain.');
  });

  it('paints the text after a reattach that missed the round’s start', () => {
    const state = run(INITIAL, [
      snapshot({ text: '"You came."\n\n' }),
      event(1, 'call.started', { stepId: 'g', message: 1, speaker: LUND }),
      indexed('"Aye."', 1),
    ]);
    expect(liveMessages(state)).toBeNull();
    expect(state.text).toBe('"You came."\n\n"Aye."');
  });

  it('starts a new job with a fresh round and no order', () => {
    const state = run(INITIAL, [
      snapshot(),
      event(1, 'speakers.picked', { speakers: [VERA], by: 'rules' }),
      event(2, 'call.started', { stepId: 'g', message: 0, speaker: VERA }),
      indexed('Hello.', 0),
    ]);
    const next = reduce(state, { kind: 'submitted', jobId: 'job-2' });
    expect(liveMessages(next)).toBeNull();
    expect(next.order).toBeNull();
  });

  it('clears the last job’s words when the next job’s frames beat its POST', () => {
    const second = (seq: number, key: string, params: Record<string, unknown> = {}) => ({
      event: 'progress',
      id: `job-2.${String(seq)}`,
      data: { jobId: 'job-2', seq, key, params, at: 0 },
    });
    const done = run(INITIAL, [
      snapshot(),
      event(1, 'speakers.picked', { speakers: [VERA], by: 'rules' }),
      event(2, 'call.started', { stepId: 'g', message: 0, speaker: VERA }),
      indexed('Hello.', 0),
      event(3, 'turn.finished'),
    ]);
    const early = run(done, [
      second(1, 'turn.started', { turnId: 't2' }),
      second(2, 'call.started', { stepId: 'g', message: 0, speaker: LUND }),
      { event: 'delta', data: { jobId: 'job-2', text: 'Aye.', message: 0 } },
    ]);
    const next = reduce(early, { kind: 'submitted', jobId: 'job-2' });
    expect(next.text).toBe('Aye.');
    expect(liveMessages(next)).toEqual([{ speaker: LUND, text: 'Aye.' }]);
    expect(next.order).toBeNull();
  });
});

/**
 * ***The pictures start afresh at every attach*** (2026-09-28). The page lets
 * this map outrank its query, which is right only while the map has heard
 * everything: a frame sent while the stream was down reached nobody, and a
 * failure the map still held outlived every refetch.
 */
describe('the pictures across an attach', () => {
  const picture = (state: string) => ({
    event: 'rendition',
    data: { id: 't-1.0', turnId: 't-1', sessionId: 's', state, purpose: 'illustration' },
  });

  it('forgets what it heard before a snapshot, and counts the attach', () => {
    const heard = run(INITIAL, [snapshot(), picture('failed')]);
    expect(heard.renditions['t-1.0']?.state).toBe('failed');
    expect(heard.attached).toBe(1);

    const back = run(heard, [snapshot()]);
    expect(back.renditions).toEqual({});
    expect(back.attached).toBe(2);
  });

  it('takes a frame after the snapshot as the newest word', () => {
    const state = run(INITIAL, [snapshot(), picture('failed'), picture('pending')]);
    expect(state.renditions['t-1.0']?.state).toBe('pending');
  });
});

/**
 * ***A backdrop reported ready is counted, every time*** (2026-09-30) — the
 * count `PlayPage` reads the session again on. Every time rather than once per
 * id, because the server sends a held backdrop's frame again once it is
 * showing, and that second frame is the one the page must hear.
 */
describe('a backdrop that lands', () => {
  const frame = (over: Record<string, unknown>) => ({
    kind: 'frame' as const,
    frame: {
      event: 'rendition',
      data: { id: 'r-1', turnId: 't-1', purpose: 'background', state: 'ready', ...over },
    },
  });

  it('is counted each time it is said to be ready, and nothing else is', () => {
    let state = reduce(INITIAL, frame({}));
    state = reduce(state, frame({}));
    expect(state.backdrops).toBe(2);

    state = reduce(state, frame({ purpose: 'illustration' }));
    state = reduce(state, frame({ id: 'r-2', state: 'pending' }));
    state = reduce(state, frame({ id: 'r-2', state: 'failed' }));
    expect(state.backdrops).toBe(2);
  });
});
