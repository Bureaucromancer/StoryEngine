// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { mkdir, stat } from 'node:fs/promises';
import { dirname } from 'node:path';

import writeFileAtomic from 'write-file-atomic';

/**
 * Every canonical write goes through here.
 *
 * **Temp file, fsync, rename** ([20 §7](../../../../docs/design/20-tech-stack.md)). The
 * failure it prevents is a truncated character card: a crash or a full disk
 * halfway through a direct write leaves a file that is neither the old actor nor
 * the new one, and `card.png` is the only copy of that actor
 * ([03 §5.2](../../../../docs/design/03-data-model.md)).
 *
 * The library rather than thirty lines of our own, because the fiddly parts are
 * not the temp-and-rename — mode and ownership preservation, and cleaning up
 * the temp file when the write fails partway. Those are exactly the things a
 * hand-rolled version gets right on the developer's machine and wrong on
 * somebody's NAS.
 *
 * **The Windows `EPERM` retry is ours, and this paragraph used to say it was
 * the library's.** Measured: `write-file-atomic@8` does a bare `fs.rename`,
 * and its one `EPERM` branch guards *chown*, not the rename. So a reader — a
 * poll, a virus scanner, anything — holding the destination open at the wrong
 * instant surfaced `EPERM` straight through, which showed up as the history
 * trim failing roughly one full-suite run in three on Windows: a test polled
 * `listVersions` in a loop while the trim renamed the index over it. The
 * retry below is bounded and backs off; a lock that outlasts a second is a
 * real lock, not a scanner, and deserves the error.
 */

const BUSY_RETRY_MS = [10, 50, 100, 250, 500] as const;

async function writeRetryingBusy(path: string, data: string | Uint8Array): Promise<void> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      await writeFileAtomic(path, data);
      return;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      const wait = BUSY_RETRY_MS[attempt];
      if ((code !== 'EPERM' && code !== 'EACCES') || wait === undefined) throw error;
      await new Promise((tick) => setTimeout(tick, wait));
    }
  }
}

/**
 * The token the P1.4 watcher matches events against.
 *
 * `write-file-atomic` does temp-then-rename, so chokidar sees an add and an
 * unlink for every single write. Without suppression the index re-does every
 * job the application already did synchronously
 * ([03 §5.1.1](../../../../docs/design/03-data-model.md)) — which is not a correctness bug
 * so much as a doubling of all indexing work, and it is why the token is
 * `(path, mtime, size)` rather than just the path: a *foreign* write to the same
 * file moments later must not be swallowed by our own token.
 */
export interface SelfWriteToken {
  path: string;
  mtimeMs: number;
  size: number;
}

/**
 * How long a token stays claimable.
 *
 * Long enough to cover chokidar's debounce and a slow disk; short enough that a
 * hand edit arriving a second after ours is still seen as foreign. Erring
 * shorter is the safe direction: an unsuppressed self-write costs a redundant
 * re-index, whereas a suppressed foreign write costs a stale row until the next
 * reconciliation pass.
 */
export const SELF_WRITE_TTL_MS = 2000;

/**
 * Records what this process just wrote, so the watcher can tell its own echo
 * from someone else's edit.
 *
 * Not a `Set` of paths: the same file is written repeatedly, and a
 * path-keyed record would let one write's token suppress a later, genuinely
 * foreign change to the same file.
 */
export class SelfWriteRegistry {
  readonly #tokens = new Map<string, SelfWriteToken[]>();
  readonly #ttlMs: number;

  constructor(ttlMs: number = SELF_WRITE_TTL_MS) {
    this.#ttlMs = ttlMs;
  }

  register(token: SelfWriteToken): void {
    const existing = this.#tokens.get(token.path) ?? [];
    existing.push(token);
    this.#tokens.set(token.path, existing);

    // Timers rather than a sweep, so a quiet server holds nothing. Unref'd
    // because a pending token must never keep the process alive.
    setTimeout(() => {
      this.#expire(token);
    }, this.#ttlMs).unref();
  }

  #expire(token: SelfWriteToken): void {
    const remaining = (this.#tokens.get(token.path) ?? []).filter((held) => held !== token);
    if (remaining.length === 0) {
      this.#tokens.delete(token.path);
    } else {
      this.#tokens.set(token.path, remaining);
    }
  }

  /**
   * True if this event is our own echo — and consumes the token, so a genuine
   * second change to the same file is not swallowed too.
   */
  claim(event: SelfWriteToken): boolean {
    const held = this.#tokens.get(event.path);
    if (!held) return false;

    const index = held.findIndex(
      (token) => token.size === event.size && token.mtimeMs === event.mtimeMs,
    );
    if (index === -1) return false;

    held.splice(index, 1);
    if (held.length === 0) this.#tokens.delete(event.path);
    return true;
  }

  /** Test and diagnostic surface. Not part of the write path. */
  get size(): number {
    return this.#tokens.size;
  }
}

/** The registry the application writes through. P1.4's watcher reads it. */
export const selfWrites = new SelfWriteRegistry();

export interface AtomicWriteOptions {
  /** Create the containing directory first. Defaults to true. */
  ensureDirectory?: boolean;
  /**
   * Register a self-write token for the watcher. Defaults to true — turning it
   * off means the watcher will re-index the file as though a stranger wrote it,
   * which is correct behaviour, only wasteful.
   */
  suppressWatcher?: boolean;
  registry?: SelfWriteRegistry;
}

/**
 * Writes a file atomically and records the token.
 *
 * The path is expected to have come from `paths.ts` already. This function
 * deliberately does *not* re-check containment: a second, differently-shaped
 * check here would invite callers to skip the first one, and two resolvers is
 * how a project ends up with one that is wrong.
 */
export async function writeAtomic(
  path: string,
  data: string | Uint8Array,
  options: AtomicWriteOptions = {},
): Promise<SelfWriteToken> {
  const { ensureDirectory = true, suppressWatcher = true, registry = selfWrites } = options;

  if (ensureDirectory) {
    await mkdir(dirname(path), { recursive: true });
  }

  await writeRetryingBusy(path, data);

  // Stat *after* the rename: the token has to describe the file the watcher
  // will see, and the temp file's mtime is not it.
  const stats = await stat(path);
  const token: SelfWriteToken = { path, mtimeMs: stats.mtimeMs, size: stats.size };

  if (suppressWatcher) {
    registry.register(token);
  }

  return token;
}

/** JSON, formatted for humans — [03 §5.4](../../../../docs/design/03-data-model.md). */
export async function writeJsonAtomic(
  path: string,
  value: unknown,
  options: AtomicWriteOptions = {},
): Promise<SelfWriteToken> {
  // Two spaces and a trailing newline, so the store stays diffable, greppable
  // and git-able. A user who wants to keep their library in git should be able
  // to, and a single-line JSON blob makes that useless.
  return writeAtomic(path, `${JSON.stringify(value, null, 2)}\n`, options);
}
