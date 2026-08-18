// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { describe, expect, it } from 'vitest';

import { INITIAL, reduce, type PlayState } from './reducer.js';
import { SseParser } from './sse.js';

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

  it('seeds the duplicate guard from the snapshot cursor', () => {
    // Without this, every frame the snapshot already accounted for would be
    // applied a second time on reconnect.
    const state = run(INITIAL, [snapshot({ cursor: 'job-1.7' }), progress(7), progress(8)]);

    expect(state.seen['job-1']).toBe(8);
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
    const next = reduce(finished, { kind: 'submitted' });

    expect(next.text).toBe('');
    expect(next.status).toBe('running');
  });
});
