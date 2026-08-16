// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

/**
 * A per-key FIFO task queue — the serialization primitive behind the write
 * paths in `library.ts` and `history.ts`.
 *
 * Why it exists: the object store has several read-then-write sequences (the
 * stale-hash check, slug allocation, the history index's append-vs-rewrite
 * pair) whose correctness depends on nothing else touching the same object
 * between the read and the write. Node gives no such guarantee across `await`
 * points, so the sequences run as tasks on a queue keyed by what they touch —
 * an object id, a kind directory, a history root. Tasks on different keys run
 * concurrently; tasks on one key run strictly in submission order.
 *
 * Deliberately **not** shared with the watcher's event chain
 * (`watcher.ts` `#enqueue`), for two reasons. The watcher's chain is
 * global-ordered across *paths* — a rename arrives as events on two different
 * paths whose relative order the tombstone mechanism depends on, which a
 * per-key queue would destroy. And the watcher's self-write `claim()` runs
 * inside its chain against a 2-second token TTL (`atomic.ts`); queuing it
 * behind long library writes could push a claim past the TTL and turn a
 * self-write into a phantom "external" edit.
 */
export class KeyedQueue {
  /**
   * The settled tail per key. Stored tails never reject — rejection is
   * delivered to the task's own caller and only there — so a failed task
   * cannot poison its successors or raise an unhandled rejection here.
   */
  readonly #tails = new Map<string, Promise<void>>();

  /**
   * Runs `task` after every previously submitted task for `key` has settled.
   * The returned promise is the task's own outcome.
   */
  run<T>(key: string, task: () => Promise<T>): Promise<T> {
    const previous = this.#tails.get(key) ?? Promise.resolve();
    const result = previous.then(task);
    const tail = result.then(
      () => undefined,
      () => undefined,
    );
    this.#tails.set(key, tail);
    // Drop the map entry once the queue for this key drains. The identity
    // check is the race guard: a task enqueued while this cleanup microtask
    // is pending has already replaced the entry, and the delete is skipped.
    void tail.then(() => {
      if (this.#tails.get(key) === tail) this.#tails.delete(key);
    });
    return result;
  }

  /** How many keys currently have work queued or running. For tests. */
  get size(): number {
    return this.#tails.size;
  }
}
