// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

/**
 * The import review's vocabulary — what happened to each thing a sweep saw.
 *
 * **Internal tier, deliberately outside `schema/`**, on the same argument as the
 * turn record: no `$id`, no registry entry, no emitted artefact. A review report
 * is something the app shows about an operation it ran; it is not a portable
 * object anybody exchanges, and giving it a published schema would promise a
 * stability nobody wants from it.
 *
 * **Shared rather than server-only** because the client renders it, and the
 * client imports only from here ([P3.0]'s precedent for the turn record). What
 * crosses is *classes and parameters*, never sentences —
 * [P4 §1.4](../../../docs/design/workplan/06-p4-implementation.md) decides that
 * and [06 A2d](../../../docs/design/06-open-questions.md) is why: a report
 * stored as English is a bug that only shows up when somebody changes language.
 * There is no ICU message layer in this repository yet
 * ([P11 §1.3](../../../docs/design/workplan/22-p11-implementation.md) owns the
 * catalogue), so the client renders these through the same open-keyed label maps
 * every other class-to-word surface uses. Emitting `{ key, params }` now is what
 * keeps the largest body of user-facing prose any phase has added off that
 * sweep's debt list — and it is only cheap before the strings are written.
 */

/**
 * What became of one thing the sweep saw — a file, a table, a row.
 *
 * **Every name in a source's registry maps to one of these, and a test asserts
 * it** ([P4 §1.8]). That is what makes *nothing is silently dropped* a single
 * checkable claim rather than a promise: a name with no disposition fails the
 * build, and a name in neither the registry nor the map is `unrecognised`, which
 * is reported rather than ignored.
 *
 * The three not-converted arms are separate because **they answer differently**,
 * and collapsing them is how a review stops being useful: *never coming* and
 * *not yet* and *we could not tell what this was* send a person to three
 * different places.
 */
export type ImportDisposition =
  /** Became a library object, or part of one. */
  | 'converted'
  /**
   * A connection or a credential. **Dropped, and never landing in `compat`** —
   * the one class of source field with no escape hatch ([P4 §1.1]). Reported by
   * name so the person knows what was removed rather than wondering.
   */
  | 'credential'
  /**
   * Read and named in the review, not converted, because the machinery it would
   * need belongs to a later phase — channel-shaped state, setup-shaped config.
   * **The review says *when***, which is the whole difference between this and
   * the arm below.
   */
  | 'recorded'
  /**
   * Not converted, **by position**: there is nothing chat-shaped for it to
   * become, ever. Instruct and context templates, the raw-completion settings
   * ([00 §2.2]). "Will never come" answers differently from "not yet".
   */
  | 'by-position'
  /** Deliberately not taken — derived data, another app's subsystem — and counted. */
  | 'skipped'
  /** The sweep could not classify it. Counted, never silently passed over. */
  | 'unrecognised';

/**
 * Where a field that would not convert ended up.
 *
 * Per-kind honesty ([P4 §1.4]): Actors and Presets carry `compat`; Lorebooks,
 * Treatments and Setups carry `metadata` only. The review says which, or that
 * the field was dropped — because "preserved somewhere" and "gone" are not the
 * same promise, and [00 §2.4]'s *nothing is lost* is a claim only the first one
 * supports.
 */
export type ImportFieldOutcome = 'compat' | 'metadata' | 'dropped';

/** How serious a note is. `error` is reserved for what the server could not do. */
export type ImportNoteLevel = 'info' | 'warn';

/**
 * One thing worth saying about one item, as a message key and its parameters.
 *
 * Never a sentence. The params must carry **everything the sentence needs**,
 * because a renderer cannot go back for more — the same requirement
 * [04 §3.4](../../../docs/design/04-server-multiuser-deployment.md) puts on
 * notification summaries, and the reason its params are the interesting half.
 */
export interface ImportNote {
  key: string;
  params: Record<string, string | number>;
  level: ImportNoteLevel;
}

/** One row of the review: a thing the sweep saw, and what became of it. */
export interface ImportItemReport {
  /**
   * What this was, **named relative to the sweep root** — never absolutely.
   * [13 §4.1](../../../docs/design/13-internal-contracts.md)'s foreign-path
   * doctrine: the root is recorded once, on the job, where the person who typed
   * it can see it. A per-item absolute path turns a report somebody pastes into
   * an issue into a description of their filesystem.
   */
  source: string;
  disposition: ImportDisposition;
  /** The library object this became, when it became one. */
  objectId?: string;
  notes: ImportNote[];
}

/** The durable output of a sweep ([P4 §1.3]), addressed by the job's id. */
export interface ImportReport {
  jobId: string;
  /** What the probe decided the root was ([P4 §1.3]) — not what the person called it. */
  source: string;
  items: ImportItemReport[];
  /** One count per disposition, so the summary needs no pass over `items`. */
  counts: Record<ImportDisposition, number>;
}

/** Every arm, for exhaustiveness checks and for the coverage tests to iterate. */
export const IMPORT_DISPOSITIONS = [
  'converted',
  'credential',
  'recorded',
  'by-position',
  'skipped',
  'unrecognised',
] as const satisfies readonly ImportDisposition[];
