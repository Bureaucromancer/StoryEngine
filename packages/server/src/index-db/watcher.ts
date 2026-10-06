// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import type { DatabaseSync } from 'node:sqlite';
import type { Logger } from '../state/commit.js';

import { basename, dirname, join } from 'node:path';

import { type FSWatcher, watch } from 'chokidar';

import { selfWrites, type SelfWriteRegistry } from '../storage/atomic.js';
import { appendLine, statFile, unlinkFile } from '../storage/files.js';
import type { Layout } from '../storage/layout.js';
import { PathEscapeError } from '../storage/paths.js';
import { takeInForeignEdit } from './foreign-edit.js';
import { clearFileError, matureTombstones, recordUnusableName, removeFile } from './ingest.js';

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
   * tiered `live` ([22 §4]), and the app hands this watcher the very
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

function isProbe(layout: Layout, path: string): boolean {
  return dirname(path) === layout.dataRoot && basename(path).startsWith(PROBE_PREFIX);
}

/**
 * ***Everything the watcher looks at*** (2026-10-06): what leads to an object,
 * and its own delivery probe.
 *
 * **The probe is the half that is easy to lose.** It sits at the data root and
 * leads to no object, so the layout's rule alone refuses it — and nothing
 * fails when it does: `start()` waits out its whole ladder for an event that
 * cannot come and gives up quietly, which is the behaviour it keeps for a root
 * whose events genuinely never arrive. A function of its own so the pair can
 * be asked about without starting anything.
 */
export function watches(layout: Layout, path: string): boolean {
  return isProbe(layout, path) || layout.leadsToObjects(path);
}

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
  /** Set by `stop()`, after which no event is queued. */
  #stopped = false;

  /** Post-construction subscribers — see {@link LibraryWatcher.observe}. */
  readonly #observers = new Set<(event: WatchEvent) => void>();

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

  /**
   * Subscribe to what the watcher did, after it did it.
   *
   * **The same seam as `setLogger`, and it exists for the same reason**: the
   * watcher is constructed inside `buildServices`, so `onChange` — which has
   * carried the comment *"Test seam, and a logging point later"* since it was
   * written — is only reachable by whoever built it. Nothing a test holds can
   * get at it, which is why every test waiting on a foreign write polls instead.
   *
   * **Polling is the thing this replaces, and the reason is not speed.** A poll
   * asks "has it happened yet" on a timer and reports `false` when it runs out,
   * so a watcher that never delivered and a watcher that was merely slow produce
   * the same failure — an assertion that says a condition "never held" and
   * nothing about which condition or what it saw instead. An observer says when,
   * and says nothing when it did not happen, which is a hang with a name rather
   * than a timeout with a shrug.
   *
   * Fires **after** the handler has finished — after the ingest and after any
   * history snapshot — so an observer that has seen `indexed` for a path can
   * read the consequences without a second wait.
   *
   * Returns its own unsubscribe. Observers are a set rather than a single slot
   * because `onChange` already occupies the one the constructor owns, and a
   * second subscriber must not displace the first.
   */
  observe(observer: (event: WatchEvent) => void): () => void {
    this.#observers.add(observer);
    return () => this.#observers.delete(observer);
  }

  /**
   * One place the two notification paths meet, so neither can be updated
   * without the other.
   */
  #emit(event: WatchEvent): void {
    this.#onChange(event);
    for (const observer of this.#observers) observer(event);
  }

  async start(): Promise<void> {
    // A watcher stopped and started again is watching again.
    this.#stopped = false;
    // ***chokidar is patched*** (2026-09-27, `patches/chokidar@5.0.0.patch`).
    // It met a new directory by reading it and only then watching it, so a
    // folder made inside one in between was never watched, and nothing written
    // under it was seen until a restart — gate step 16's intermittent timeout,
    // and `cp -r` into the library for real. The patch watches first; the test
    // `a folder made while its parent is still being read` holds it there.
    const watcher = watch(this.#layout.dataRoot, {
      ignoreInitial: true,
      // A rebuild is the startup path ([03 §5.1]); the watcher is for what
      // happens after. Reporting every existing file as an add would duplicate
      // that scan and slow start-up on a large library.
      //
      // ***And on every other start, the check*** (2026-09-27). A start that
      // did not rebuild looked at nothing, so an edit made while the server
      // was stopped was never seen until the file changed again.
      // `reconcileIndex` is that look, by the recorded size and time, and it
      // runs before this starts.
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
      // ***Only what leads to an object*** (2026-10-06), which is `watches`
      // above. ~~What the watcher must never watch~~ was a list — the index,
      // the operational store, accounts, config, and at
      // [P12.2](../../../../docs/design/workplan/29-p12-implementation.md)
      // the backups — and a list is the wrong shape for it, because everything
      // it did not name was watched and discarded: sessions, the trash, and
      // every object's `history/` and `assets/`. On Windows each of those is a
      // directory handle held open, and **a held handle inside a folder is a
      // folder that cannot be renamed** — so every delete of an object that had
      // ever been saved, and of every session with turns, failed with `EPERM`.
      //
      // Each reason the list gave still holds, and now holds by default: the
      // index's SQLite/WAL writes would feed the event queue on every ingest;
      // accounts and config should not even be stat'ed on someone's behalf;
      // and `awaitWriteFinish` **stats a file repeatedly until it stops
      // growing**, so a half-gigabyte backup archive would be minutes of
      // polling for an answer known in advance. `isContained` underneath
      // rather than string matching, still: the list's first predicate
      // compared mixed separators and never matched on Windows.
      ignored: (path) => !watches(this.#layout, path),
    });

    watcher.on('add', (path) => {
      this.#enqueue(path, () => this.#onUpsert(path));
    });
    watcher.on('change', (path) => {
      this.#enqueue(path, () => this.#onUpsert(path));
    });
    watcher.on('unlink', (path) => {
      this.#enqueue(path, () => {
        this.#onUnlink(path);
      });
    });
    watcher.on('unlinkDir', (path) => {
      this.#enqueue(path, () => {
        this.#onUnlinkDir(path);
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
    return isProbe(this.#layout, path);
  }

  /** Resolves once every event seen so far has been handled. */
  async settled(): Promise<void> {
    await this.#queue;
  }

  /**
   * ***Closes the watcher, then finishes what it had already queued***
   * (2026-09-27). The other way round, an event arriving between the drain and
   * the close was queued after the drain and ran once the caller had closed the
   * index under it.
   */
  async stop(): Promise<void> {
    this.#stopped = true;
    await this.#watcher?.close();
    this.#watcher = null;
    await this.#queue;
  }

  /**
   * ***A total queue: one event's failure is that event's, and is said***
   * (2026-09-27).
   *
   * `then(work, work)` ran the next event whether or not the last one failed,
   * and left the failure itself as a rejected promise that nothing handled
   * until the next event arrived. Node's default for that is to end the
   * process. So a card saved as a link to a file outside the data directory
   * (the real-path check refuses it, which is the check working), a file a
   * scanner holds locked on Windows, or a full disk during the snapshot took
   * the whole server down, and after the restart the edit was never looked at
   * again, because the watcher does not replay what it has already seen.
   *
   * Now a refused path is a `warn` and a `refused` event, what the name check
   * above already says for a name, and anything else is an `error` and an
   * `ignored` event. Both carry the path, so anything waiting on this file
   * hears an answer rather than a silence. The shape and not the error object,
   * for [22 §4.1]'s reason: a log is not a place for whatever an error carries.
   */
  #enqueue(path: string, work: () => void | Promise<void>): void {
    if (this.#stopped) return;
    this.#queue = this.#queue.then(work).catch((error: unknown) => {
      const refused = error instanceof PathEscapeError;
      const fields = {
        event: refused ? 'library.refused' : 'watcher.failed',
        path: this.#layout.portablePath(path) ?? basename(path),
        message: error instanceof Error ? error.message : String(error),
      };
      if (refused) this.#log?.warn(fields, 'A library file was refused');
      else this.#log?.error(fields, 'A watched change could not be indexed');
      try {
        this.#emit({ type: refused ? 'refused' : 'ignored', path });
      } catch {
        // An observer that throws must not be what breaks the queue again.
      }
    });
  }

  async #onUpsert(path: string): Promise<void> {
    if (this.#isProbe(path)) {
      this.#probeSeen?.();
      return;
    }

    const parsed = this.#layout.parseObjectPath(path);
    if (!parsed) {
      this.#emit({ type: 'ignored', path });
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
      this.#emit({ type: 'refused', path });
      return;
    }

    if (await this.#isOwnWrite(path)) {
      this.#emit({ type: 'suppressed', path });
      return;
    }

    matureTombstones(this.#db, this.#layout);
    // The ingest and the history a hand edit earns, shared with the start-up
    // check so an edit made while the server was stopped is kept the same way
    // (2026-09-27).
    const outcome = await takeInForeignEdit({
      db: this.#db,
      layout: this.#layout,
      parsed,
      keepPerObject: this.#options.keepHistoryPerObject ?? 50,
    });

    // A link out of the data directory, refused and recorded by the ingest.
    // What the queue's catch says for a refusal it meets anywhere else, and
    // for the same reason: the check working is a `warn`, not an `error`.
    if (outcome.kind === 'skipped' && outcome.reason === 'refused') {
      this.#log?.warn(
        { event: 'library.refused', path: this.#layout.portablePath(path) ?? basename(path) },
        'A library file was refused',
      );
      this.#emit({ type: 'refused', path });
      return;
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
     * `warn` rather than `error` — [22 §4.1]'s boundary: the server refused a
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

    this.#emit(
      outcome.kind === 'indexed'
        ? { type: 'indexed', path, moved: outcome.moved }
        : { type: 'ignored', path },
    );
  }

  #onUnlink(path: string): void {
    if (this.#isProbe(path)) return;
    if (!this.#layout.parseObjectPath(path)) {
      this.#emit({ type: 'ignored', path });
      return;
    }
    // No self-write check: the unlink half of temp-then-rename is on the *temp*
    // file, which is not an object path and was ignored above. An unlink on the
    // object path is somebody deleting it.
    const removed = removeFile(this.#db, this.#layout, path);
    this.#emit({ type: removed ? 'removed' : 'ignored', path });
  }

  /**
   * ***A folder that went away takes its name's complaint with it***
   * (2026-09-27).
   *
   * An `unusable-name` row is keyed by the object *folder* (`recordUnusableName`
   * says why), and every clear was keyed by a file path, so renaming `con` to
   * `con-city` indexed the book and left the quarantine panel reporting a
   * folder that no longer existed, until a rebuild — which by default never
   * runs. chokidar reports the folder by the same absolute path the row was
   * written under, since both are built from the data root.
   */
  #onUnlinkDir(path: string): void {
    if (clearFileError(this.#db, path)) this.#emit({ type: 'removed', path });
    else this.#emit({ type: 'ignored', path });
  }

  async #isOwnWrite(path: string): Promise<boolean> {
    const facts = await statFile(path);
    if (!facts) return false;
    return this.#registry.claim({ path, ...facts });
  }
}
