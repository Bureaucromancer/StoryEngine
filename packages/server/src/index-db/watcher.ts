// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import type { DatabaseSync } from 'node:sqlite';

import { type FSWatcher, watch } from 'chokidar';

import { selfWrites, type SelfWriteRegistry } from '../storage/atomic.js';
import { statFile } from '../storage/files.js';
import { snapshotReplaced } from '../storage/history.js';
import type { Layout } from '../storage/layout.js';
import { isContained } from '../storage/paths.js';
import { ingestFile, matureTombstones, removeFile } from './ingest.js';
import { findByPath } from './query.js';

/**
 * The watcher — **foreign writes only**.
 *
 * [02 §5.1.1](docs/design/02-data-model.md) is the whole design of this file.
 * An earlier draft of the data model had *all* index updates come from here,
 * which is appealing — one path, the index provably a function of the disk — and
 * wrong in a way that would not have surfaced until the P1 demo: it makes every
 * write eventually consistent, so a `GET` straight after a `POST` can
 * legitimately miss it, and tests race by construction.
 *
 * So there are two writers with different jobs. The application indexes its own
 * writes synchronously; this handles hand edits, `git checkout`, restored
 * backups, and anything else that was not us.
 *
 * **Self-write events are suppressed rather than merely tolerated.** Atomic
 * writes are temp-then-rename, so chokidar reports an add and an unlink for
 * every single save; without suppression the index does every job twice. The
 * token is `(path, mtime, size)` and it is consumed on match, which is what
 * stops one of our writes from swallowing a genuinely foreign change to the
 * same file moments later.
 */

export interface WatcherOptions {
  db: DatabaseSync;
  layout: Layout;
  registry?: SelfWriteRegistry;
  /**
   * Milliseconds of quiet before a file is considered settled. chokidar's
   * `awaitWriteFinish`, which is what keeps a large card being copied in from
   * being read half-written.
   */
  stabilityThresholdMs?: number;
  /** Retention cap for the history a foreign edit leaves behind ([02 §11.3]). */
  keepHistoryPerObject?: number;
  /** Called after each handled event. Test seam, and a logging point later. */
  onChange?: (event: WatchEvent) => void;
}

export interface WatchEvent {
  type: 'indexed' | 'removed' | 'suppressed' | 'ignored';
  path: string;
  moved?: boolean;
}

export class LibraryWatcher {
  readonly #db: DatabaseSync;
  readonly #layout: Layout;
  readonly #registry: SelfWriteRegistry;
  readonly #onChange: (event: WatchEvent) => void;
  readonly #stabilityThresholdMs: number;
  readonly #keepHistoryPerObject: number;
  #watcher: FSWatcher | null = null;
  /**
   * Events are serialised through one promise chain.
   *
   * chokidar does not wait for a handler, so a rename firing unlink-then-add
   * could otherwise have the add's tombstone lookup run before the unlink's
   * update commits — turning a move into a delete plus a create, which is the
   * exact failure [19 §1.1](docs/design/19-p1-implementation.md) exists to
   * prevent. Ordering is not an optimisation here; it is the mechanism.
   */
  #queue: Promise<void> = Promise.resolve();

  constructor(options: WatcherOptions) {
    this.#db = options.db;
    this.#layout = options.layout;
    this.#registry = options.registry ?? selfWrites;
    this.#onChange = options.onChange ?? (() => undefined);
    this.#stabilityThresholdMs = options.stabilityThresholdMs ?? 150;
    this.#keepHistoryPerObject = options.keepHistoryPerObject ?? 50;
  }

  async start(): Promise<void> {
    const watcher = watch(this.#layout.dataRoot, {
      ignoreInitial: true,
      // A rebuild is the startup path ([02 §5.1]); the watcher is for what
      // happens after. Reporting every existing file as an add would duplicate
      // that scan and slow start-up on a large library.
      awaitWriteFinish: {
        stabilityThreshold: this.#stabilityThresholdMs,
        pollInterval: 20,
      },
      // What the watcher must never watch: its own index (whose SQLite/WAL
      // writes would otherwise feed the event queue on every ingest), the
      // operational store, and the two root files that are not content —
      // accounts and config should not even be stat'ed on someone's behalf.
      // `isContained` rather than string matching: the previous predicate
      // compared mixed separators and never matched on Windows, which is the
      // development platform. It matches the root itself, so it covers single
      // files as well as directories.
      ignored: (path) =>
        isContained(this.#layout.indexRoot, path) ||
        isContained(this.#layout.stateRoot, path) ||
        isContained(this.#layout.accountsFile, path) ||
        isContained(this.#layout.configFile, path),
    });

    watcher.on('add', (path) => {
      this.#enqueue(() => this.#onUpsert(path));
    });
    watcher.on('change', (path) => {
      this.#enqueue(() => this.#onUpsert(path));
    });
    watcher.on('unlink', (path) => {
      this.#enqueue(() => {
        this.#onUnlink(path);
      });
    });

    this.#watcher = watcher;
    await new Promise<void>((ready) => {
      watcher.once('ready', () => {
        ready();
      });
    });
  }

  /** Resolves once every event seen so far has been handled. */
  async settled(): Promise<void> {
    await this.#queue;
  }

  async stop(): Promise<void> {
    await this.#queue;
    await this.#watcher?.close();
    this.#watcher = null;
  }

  #enqueue(work: () => void | Promise<void>): void {
    this.#queue = this.#queue.then(work, work).then(() => undefined);
  }

  async #onUpsert(path: string): Promise<void> {
    const parsed = this.#layout.parseObjectPath(path);
    if (!parsed) {
      this.#onChange({ type: 'ignored', path });
      return;
    }

    if (await this.#isOwnWrite(path)) {
      this.#onChange({ type: 'suppressed', path });
      return;
    }

    // The state a foreign edit is replacing, read *before* the index moves on.
    const previous = findByPath(this.#db, path);

    matureTombstones(this.#db);
    const outcome = await ingestFile(this.#db, this.#layout, path);

    // **Hand-edits get history for free** ([02 §11.2]) — the strongest argument
    // for building the mechanism now, while the watcher exists and no editor
    // does. Snapshot when the content genuinely changed, and also when the new
    // content failed to parse at all: someone breaking a file in a text editor
    // is exactly the person the last good state is being kept for. A move is
    // neither — same content, new path — and records nothing.
    const changed =
      outcome.kind === 'indexed'
        ? outcome.row.contentHash !== previous?.contentHash
        : outcome.reason === 'invalid';
    if (previous && changed) {
      await snapshotReplaced({
        objectRoot: this.#layout.objectRoot(parsed.scope, parsed.schemaId, parsed.slug),
        payload: previous.body,
        source: { kind: 'external' },
        reason: '',
        keepPerObject: this.#keepHistoryPerObject,
      });
    }

    this.#onChange(
      outcome.kind === 'indexed'
        ? { type: 'indexed', path, moved: outcome.moved }
        : { type: 'ignored', path },
    );
  }

  #onUnlink(path: string): void {
    if (!this.#layout.parseObjectPath(path)) {
      this.#onChange({ type: 'ignored', path });
      return;
    }
    // No self-write check: the unlink half of temp-then-rename is on the *temp*
    // file, which is not an object path and was ignored above. An unlink on the
    // object path is somebody deleting it.
    const removed = removeFile(this.#db, path);
    this.#onChange({ type: removed ? 'removed' : 'ignored', path });
  }

  async #isOwnWrite(path: string): Promise<boolean> {
    const facts = await statFile(path);
    if (!facts) return false;
    return this.#registry.claim({ path, ...facts });
  }
}
