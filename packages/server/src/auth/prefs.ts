// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { writeJsonAtomic } from '../storage/atomic.js';
import { readFileBytes } from '../storage/files.js';
import { KeyedQueue } from '../storage/keyed-queue.js';
import type { Layout } from '../storage/layout.js';

/**
 * Client preferences, per user — [25 B13](../../../../docs/design/25-open-questions.md),
 * closed at [P2A §2.2](../../../../docs/design/workplan/09-p2a-configuration-surface.md).
 *
 * B13 offered three homes and this is the third: a file beside the user's data
 * rather than `localStorage` or a map on `Account`. The lean was already written
 * into the layout — [09 §4.3](../../../../docs/design/09-server-multiuser-deployment.md)'s
 * canonical per-user block lists `prefs.json` — so closing the question was
 * mostly letting two documents agree.
 *
 * `localStorage` loses everything on a move to another browser, which for pane
 * state is exactly the case somebody notices. `accounts.json` is authentication:
 * a document every request reads and every password change rewrites is the wrong
 * place for whether a pane is collapsed, and it is the one file in this project
 * that refuses to start rather than degrade.
 *
 * **The server does not validate the contents**, and that is the position rather
 * than an omission. Keys are namespaced strings and values are whatever JSON the
 * client stored; a preference the client stops using rots quietly here instead of
 * needing a migration, which is the whole reason B13 chose a bag over a schema.
 */

/** What a preference document holds. Keys are the client's; values are JSON. */
export type Prefs = Record<string, unknown>;

/**
 * **Bounds, not validation** — and the code has to say which it is doing.
 *
 * These exist because an unvalidated store is otherwise an unbounded write
 * surface for any signed-in account: a key pattern so the document cannot grow
 * arbitrary structure in its *names*, and a size cap so it cannot grow without
 * limit at all. They bound the file. They do not interpret it, and nothing here
 * knows what any key means.
 *
 * The distinction matters because without it the next reader improves these into
 * a schema, which is the one answer B13 ruled out.
 */
const KEY_PATTERN = /^[a-z][a-z0-9]*(\.[a-z0-9-]+)+$/;
const MAX_DOCUMENT_BYTES = 64 * 1024;

export class PrefsError extends Error {
  readonly code: 'invalid' | 'too-large';

  constructor(code: PrefsError['code'], message: string) {
    super(message);
    this.name = 'PrefsError';
    this.code = code;
  }
}

const PREFS_SCHEMA = 'storyengine.prefs/1';

interface PrefsFile {
  schema: string;
  prefs: Prefs;
}

export class PrefsStore {
  readonly #layout: Layout;
  /**
   * One queue, keyed by handle.
   *
   * A patch is a read-modify-write across an `await`, which is exactly what
   * this primitive exists for: two tabs toggling two different preferences at
   * once would otherwise have the second read land before the first wrote, and
   * the loser's change would vanish with no error anywhere.
   */
  readonly #writes = new KeyedQueue();

  constructor(layout: Layout) {
    this.#layout = layout;
  }

  /**
   * The whole document, or an empty one.
   *
   * **An unreadable file reads as empty**, logged by the caller and repaired by
   * the next write. A deliberate asymmetry with `accounts.json`, which refuses
   * to start on a malformed file: a broken accounts file means the server
   * cannot tell who anyone is, and a broken prefs file means somebody's pane is
   * collapsed wrong. Refusing there would be treating those as the same event.
   */
  async read(handle: string): Promise<Prefs> {
    const bytes = await readFileBytes(this.#layout.prefsFile(handle));
    if (bytes === null) return {};

    try {
      const parsed: unknown = JSON.parse(new TextDecoder().decode(bytes));
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return {};
      // Read as `unknown` rather than through a `PrefsFile` cast: the cast
      // would tell the compiler this field is already a map, which is exactly
      // what a hand-edited file is not obliged to be — and would make the
      // null check below look redundant while remaining necessary.
      const prefs: unknown = (parsed as Record<string, unknown>)['prefs'];
      return typeof prefs === 'object' && prefs !== null && !Array.isArray(prefs)
        ? (prefs as Prefs)
        : {};
    } catch {
      return {};
    }
  }

  /**
   * Merges `patch` into the stored document and returns the whole result.
   *
   * **Shallow, and `null` deletes.** A whole-document write would make two open
   * tabs a lost update — the second save carrying the first's stale view of
   * every other key. Keys are flat and namespaced, so a shallow merge is well
   * defined and there is no nested case to get wrong.
   *
   * **The response is the whole map afterwards**, not an acknowledgement, so a
   * client lands on the truth rather than on its own guess about what its patch
   * did. That is what makes the one optimistic mutation in this codebase safe
   * to be optimistic about.
   */
  async patch(handle: string, patch: Prefs): Promise<Prefs> {
    for (const key of Object.keys(patch)) {
      if (!KEY_PATTERN.test(key)) {
        throw new PrefsError(
          'invalid',
          `${key} is not a preference key. Keys are namespaced, like "library.density".`,
        );
      }
    }

    return this.#writes.run(handle, async () => {
      const current = await this.read(handle);
      // `null` deletes rather than storing a null, so a client can put a
      // preference back to its default without knowing what the default is —
      // and without the document accumulating tombstones forever. Expressed as
      // a rebuild rather than a `delete`, which says the same thing and does
      // not need the dynamic-key escape hatch.
      const merged: Prefs = Object.fromEntries(
        Object.entries({ ...current, ...patch }).filter(([, value]) => value !== null),
      );

      const file: PrefsFile = { schema: PREFS_SCHEMA, prefs: merged };
      const encoded = new TextEncoder().encode(JSON.stringify(file));
      if (encoded.byteLength > MAX_DOCUMENT_BYTES) {
        throw new PrefsError(
          'too-large',
          `Preferences would exceed ${String(MAX_DOCUMENT_BYTES / 1024)}KB. Remove some first.`,
        );
      }

      await writeJsonAtomic(this.#layout.prefsFile(handle), file);
      return merged;
    });
  }
}
