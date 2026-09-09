// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import type { DatabaseSync } from 'node:sqlite';
import type { Logger } from '../state/commit.js';

import { basename, dirname, join } from 'node:path';

import { type FSWatcher, watch } from 'chokidar';

import { selfWrites, type SelfWriteRegistry } from '../storage/atomic.js';
import { appendLine, statFile, unlinkFile } from '../storage/files.js';
import { snapshotReplaced } from '../storage/history.js';
import type { Layout } from '../storage/layout.js';
import { isContained, PathEscapeError } from '../storage/paths.js';
import { ingestFile, matureTombstones, recordUnusableName, removeFile } from './ingest.js';
import { findByPath } from './query.js';

/**
 * The watcher — **foreign writes only**.
 *
 * [03 §5.1.1](../../../../docs/design/03-data-model.md) is the whole design of this file.
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
  /**
   * Retention cap for the history a foreign edit leaves behind ([03 §11.3]).
   *
   * **Read at the point of use, not copied here.** `history.keepPerObject` is
   * tiered `live` ([21 §4]), and the app hands this watcher the very
   * `LibraryContext` the routes write through — so both paths into one object's
   * history read the same cell, and a live change reaches both. Copying the
   * number into a field at construction is what made the tier untrue, and it
   * made the two paths able to disagree, which is worse than either being
   * stale.
   */
  keepHistoryPerObject?: number;
  /** Called after each handled event. Test seam, and a logging point later. */
  onChange?: (event: WatchEvent) => void;
}

/**
 * The delivery probe's filename prefix — a dotfile directly under the data
 * root, which no layout path is. See {@link LibraryWatcher.start}.
 */
const PROBE_PREFIX = '.watcher-probe-';

export interface WatchEvent {
  /**
   * `ignored` is *not an object path*; `refused` is an object path this build
   * will not resolve — the folder is named `con`, or ends in a space. The two
   * were one outcome until [P6B.1], which is part of why the second went
   * unnoticed for so long: nothing distinguished a file that was none of our
   * business from a file we could see and could not open.
   */
  type: 'indexed' | 'removed' | 'suppressed' | 'ignored' | 'refused';
  path: string;
  moved?: boolean;
}

export class LibraryWatcher {
  readonly #db: DatabaseSync;
  readonly #layout: Layout;
  #log: Logger | null = null;
  readonly #registry: SelfWriteRegistry;
  readonly #onChange: (event: WatchEvent) => void;
  readonly #stabilityThresholdMs: number;
  /** The options object itself, so `keepHistoryPerObject` stays a live read. */
  readonly #options: WatcherOptions;
  #watcher: FSWatcher | null = null;
  /** Resolves the pending delivery-probe wait, while `start()` is proving the pipe. */
  #probeSeen: (() => void) | null = null;
  /**
   * Events are serialised through one promise chain.
   *
   * chokidar does not wait for a handler, so a rename firing unlink-then-add
   * could otherwise have the add's tombstone lookup run before the unlink's
   * update commits — turning a move into a delete plus a create, which is the
   * exact failure [P1 §1.1](../../../../docs/design/workplan/07-p1-implementation.md) exists to
   * prevent. Ordering is not an optimisation here; it is the mechanism.
   */
  #queue: Promise<void> = Promise.resolve();

  constructor(options: WatcherOptions) {
    this.#db = options.db;
    this.#layout = options.layout;
    this.#registry = options.registry ?? selfWrites;
    this.#onChange = options.onChange ?? (() => undefined);
    this.#stabilityThresholdMs = options.stabilityThresholdMs ?? 150;
    this.#options = options;
  }

  /**
   * The same seam the turn runner uses, and for the same reason: the watcher is
   * built inside `buildServices` and the app's logger does not exist yet.
   */
  setLogger(log: Logger): void {
    this.#log = log;
  }

  async start(): Promise<void> {
    const watcher = watch(this.#layout.dataRoot, {
      ignoreInitial: true,
      // A rebuild is the startup path ([03 §5.1]); the watcher is for what
      // happens after. Reporting every existing file as an add would duplicate
      // that scan and slow start-up on a large library.
      awaitWriteFinish: {
        stabilityThreshold: this.#stabilityThresholdMs,
        pollInterval: 20,
      },
      // **Links are not followed** (F1). chokidar's default is to follow them,
      // which would make a link inside the library a second path to content
      // outside it — indexed as an object, with the escaping path stored in a
      // row that later reads open. The audited resolver refuses such a path
      // when asked; not following the link means it is never even offered.
      followSymlinks: false,
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
    await this.#proveDelivery();
  }

  /**
   * **`ready` is not `live`, and the difference is a silently missed edit.**
   *
   * On macOS every `fs.watch` in the process funnels through libuv's one
   * shared FSEvents stream on a helper thread, and each watcher added or
   * removed — ours or anybody's — tears that stream down and recreates it
   * "since now". chokidar's `ready` fires when the scan is done and the
   * handles *exist*; the rebuilt stream may not be delivering yet, and a write
   * that lands in the gap is dropped permanently, with no error and no
   * catch-up. Measured: under load a watcher could sit event-dead for seconds
   * after `ready` while the raw layer reported nothing at all — which is
   * [10 §4.1](../../../../docs/design/10-ui-surfaces.md)'s central gesture failing
   * silently, at the exact moment a rebuild has just declared the index
   * current.
   *
   * So `start()` proves the pipe before returning: write a probe file under
   * the root and wait for its own event to come back, a fresh filename per
   * attempt because a creation the dead stream missed is never announced
   * later. Both handlers swallow probe events — the probe is `start()`'s
   * implementation detail, not an observation. If the root refuses the probe
   * (read-only, or a filesystem whose events genuinely never come), give up
   * quietly after the ladder: a broken root will say so louder on first use.
   */
  async #proveDelivery(): Promise<void> {
    // Long enough for awaitWriteFinish to release the probe's add, plus slack
    // for the helper thread this wait exists to outwait.
    const waitMs = this.#stabilityThresholdMs + 150;
    const written: string[] = [];
    try {
      for (let attempt = 0; attempt < 12 && this.#watcher; attempt += 1) {
        const seen = new Promise<boolean>((resolve) => {
          this.#probeSeen = () => {
            resolve(true);
          };
          setTimeout(() => {
            resolve(false);
          }, waitMs);
        });
        const path = join(this.#layout.dataRoot, `${PROBE_PREFIX}${String(attempt)}`);
        await appendLine(path, 'delivery probe\n');
        written.push(path);
        if (await seen) return;
      }
    } catch {
      // The probe could not even be written; nothing here to prove.
    } finally {
      this.#probeSeen = null;
      await Promise.all(written.map((path) => unlinkFile(path).catch(() => undefined)));
    }
  }

  #isProbe(path: string): boolean {
    return dirname(path) === this.#layout.dataRoot && basename(path).startsWith(PROBE_PREFIX);
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
    if (this.#isProbe(path)) {
      this.#probeSeen?.();
      return;
    }

    const parsed = this.#layout.parseObjectPath(path);
    if (!parsed) {
      this.#onChange({ type: 'ignored', path });
      return;
    }

    /**
     * **The name rule, applied on the way in — F22, settled at [P6B.1].**
     *
     * `parseObjectPath` is the inverse of `objectFile` and was never its
     * mirror: it takes the slug apart without asking whether the slug is one
     * this build would put back together. So a folder named `con` was indexed
     * here and skipped by a rebuild, and the row the watcher wrote pointed at a
     * file that no read could open — every one of them goes back through
     * `objectFile`, which throws. Indexing it was worse than not indexing it.
     *
     * Asked by *calling the builder* rather than by re-testing the name, since
     * a second copy of a rule is a rule that eventually disagrees with itself.
     */
    try {
      this.#layout.objectFile(parsed.owner, parsed.schemaId, parsed.slug);
    } catch (error) {
      if (!(error instanceof PathEscapeError)) throw error;
      recordUnusableName(
        this.#db,
        this.#layout,
        parsed.owner,
        parsed.schemaId,
        parsed.slug,
        error,
        Date.now(),
      );
      this.#onChange({ type: 'refused', path });
      return;
    }

    if (await this.#isOwnWrite(path)) {
      this.#onChange({ type: 'suppressed', path });
      return;
    }

    // The state a foreign edit is replacing, read *before* the index moves on.
    const previous = findByPath(this.#db, path);

    matureTombstones(this.#db, this.#layout);
    const outcome = await ingestFile(this.#db, this.#layout, path);

    // **Hand-edits get history for free** ([03 §11.2]) — the strongest argument
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
        objectRoot: this.#layout.objectRoot(parsed.owner, parsed.schemaId, parsed.slug),
        payload: previous.body,
        source: { kind: 'external' },
        reason: '',
        keepPerObject: this.#options.keepHistoryPerObject ?? 50,
      });
    }

    /**
     * **A file somebody broke by hand is said out loud** — F34.
     *
     * The index records it and `GET /api/library/errors` exposes it, and until
     * now **nothing logged it and no client read the route** — so a hand-edit
     * that failed to parse was invisible to the person who made it and invisible
     * to anyone reading the log afterwards. [manual gate §2.1](../../../../docs/design/workplan/11-p2-manual-gate.md)
     * step 8 tells a tester to do exactly this.
     *
     * `warn` rather than `error` — [21 §4.1]'s boundary: the server refused a
     * file, which is the system working. The path is relative to the data root,
     * which is what the error row already stores and what that section requires.
     *
     * The card that shows this to the person who broke the file is
     * [P2 §4](../../../../docs/design/workplan/08-p2-implementation.md) step 7 and still not built.
     * This is the half that makes it findable rather than the half that makes it
     * visible.
     */
    if (outcome.kind !== 'indexed' && outcome.reason === 'invalid') {
      this.#log?.warn(
        { event: 'library.invalid', path: this.#layout.portablePath(path), reason: outcome.reason },
        'A library file could not be read',
      );
    }

    this.#onChange(
      outcome.kind === 'indexed'
        ? { type: 'indexed', path, moved: outcome.moved }
        : { type: 'ignored', path },
    );
  }

  #onUnlink(path: string): void {
    if (this.#isProbe(path)) return;
    if (!this.#layout.parseObjectPath(path)) {
      this.#onChange({ type: 'ignored', path });
      return;
    }
    // No self-write check: the unlink half of temp-then-rename is on the *temp*
    // file, which is not an object path and was ignored above. An unlink on the
    // object path is somebody deleting it.
    const removed = removeFile(this.#db, this.#layout, path);
    this.#onChange({ type: removed ? 'removed' : 'ignored', path });
  }

  async #isOwnWrite(path: string): Promise<boolean> {
    const facts = await statFile(path);
    if (!facts) return false;
    return this.#registry.claim({ path, ...facts });
  }
}
