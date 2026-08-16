// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { describe, expect, it } from 'vitest';

import { KeyedQueue } from './keyed-queue.js';

/** A promise the test controls by hand. */
function gate(): { promise: Promise<void>; open: () => void } {
  let open!: () => void;
  const promise = new Promise<void>((resolve) => {
    open = resolve;
  });
  return { promise, open };
}

describe('KeyedQueue', () => {
  it('runs tasks on one key strictly in submission order', async () => {
    const queue = new KeyedQueue();
    const order: number[] = [];
    const first = gate();

    const a = queue.run('k', async () => {
      await first.promise;
      order.push(1);
    });
    const b = queue.run('k', async () => {
      order.push(2);
      return Promise.resolve();
    });
    const c = queue.run('k', async () => {
      order.push(3);
      return Promise.resolve();
    });

    // Nothing after the first task may run while it is blocked.
    await new Promise((tick) => setImmediate(tick));
    expect(order).toEqual([]);

    first.open();
    await Promise.all([a, b, c]);
    expect(order).toEqual([1, 2, 3]);
  });

  it('runs tasks on different keys concurrently', async () => {
    const queue = new KeyedQueue();
    const blocked = gate();
    const ran: string[] = [];

    const slow = queue.run('a', async () => {
      await blocked.promise;
      ran.push('a');
    });
    const fast = queue.run('b', async () => {
      ran.push('b');
      return Promise.resolve();
    });

    await fast;
    // Key b finished while key a is still held — no cross-key ordering.
    expect(ran).toEqual(['b']);

    blocked.open();
    await slow;
    expect(ran).toEqual(['b', 'a']);
  });

  it('delivers a rejection to its own caller and does not poison successors', async () => {
    const queue = new KeyedQueue();

    const failing = queue.run('k', () => Promise.reject(new Error('task failure')));
    const after = queue.run('k', () => Promise.resolve('survived'));

    await expect(failing).rejects.toThrow('task failure');
    await expect(after).resolves.toBe('survived');
  });

  it('returns each task its own result', async () => {
    const queue = new KeyedQueue();
    const one = queue.run('k', () => Promise.resolve(1));
    const two = queue.run('k', () => Promise.resolve(2));
    expect(await one).toBe(1);
    expect(await two).toBe(2);
  });

  it('cleans up a drained key, including after a rejection', async () => {
    const queue = new KeyedQueue();

    await queue.run('k', () => Promise.resolve());
    await queue.run('other', () => Promise.reject(new Error('boom'))).catch(() => undefined);

    // Cleanup runs in a microtask after the tail settles.
    await new Promise((tick) => setImmediate(tick));
    expect(queue.size).toBe(0);
  });

  it('does not drop a task enqueued while cleanup is pending', async () => {
    const queue = new KeyedQueue();

    // Settle the first task, then immediately (before cleanup's microtask can
    // observe the map) enqueue a second on the same key. The identity check
    // must leave the second task's tail in place.
    await queue.run('k', () => Promise.resolve());
    const second = queue.run('k', () => Promise.resolve('ran'));

    await expect(second).resolves.toBe('ran');
    await new Promise((tick) => setImmediate(tick));
    expect(queue.size).toBe(0);
  });
});
