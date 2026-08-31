// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import type { DatabaseSync } from 'node:sqlite';

import {
  IMPORT_DISPOSITIONS,
  uuidv7,
  type ImportItemReport,
  type ImportNote,
  type ImportReport,
} from '@storyengine/shared';

/**
 * The review report, kept
 * ([P4 §1.4](../../../../docs/design/workplan/06-p4-implementation.md),
 * [§7.4](../../../../docs/design/workplan/06-p4-implementation.md)).
 *
 * **The cut that came back.** §1.4 specified the review as *post-hoc,
 * addressable, structured*, and P4.4 shipped the first and third of those and
 * cut the second — so a three-hundred-object sweep's report lived in a React
 * `useState` and was gone when the page closed. The tables for it landed in the
 * same stage and nothing wrote them, which is how the audit found this: two
 * tables no code touches.
 *
 * Addressable matters more than it sounds. A sweep is the one operation here
 * that makes a hundred decisions at once — a clamped entry limit, a collapsed
 * position, a dropped chat scope — and every one of them is a thing somebody
 * will want to look up later, from the object rather than from the sweep. The
 * report is where the answer is, and a report you cannot re-open is a report
 * that answered once.
 *
 * **Written after the sweep, in one transaction, not streamed.** A sweep is
 * fast, synchronous and already atomic from the caller's side; the progress
 * emitter [13 §5]'s `job.progress` key was left open for belongs to a *long*
 * import — the zip of somebody's entire Marinara install — and that is a
 * different feature with a different surface. Recording the outcome is what
 * makes the report addressable; recording it live is what makes a progress bar,
 * and pretending the first is the second would leave a half-built emitter
 * nobody drives.
 */

/** What the sweep did, in the store's own vocabulary. */
export type ImportJobStatus = 'finished' | 'refused';

/**
 * `source` is a plain string on purpose, and it carries two vocabularies.
 *
 * On a finished job it is the classification — `sillytavern`, `marinara`,
 * `charx`, `loose-files`. On a refused one it is *why*, which is a
 * `SourceRefusal` or a `RootRefusal` depending on which of the two gates turned
 * it away. Narrowing the parameter to that union would be a promise the column
 * cannot keep: it is TEXT, it holds rows written by older builds, and a value
 * this build has never heard of has to read back as itself rather than fail a
 * type assertion on the way out of SQLite.
 */

export interface RecordedJob {
  id: string;
  root: string;
  source: string;
  status: ImportJobStatus;
  createdAt: number;
  finishedAt: number | null;
  counts: Record<string, number>;
}

/**
 * Stores a completed sweep and returns the job id.
 *
 * The **absolute root is stored here and only here**, which is [13 §4.1.1]'s
 * foreign-path doctrine written into the schema rather than trusted to callers:
 * every item names its file relative to this row, so the report can be shown,
 * logged and pasted into an issue without becoming a map of somebody's disk.
 */
export function recordImport(
  db: DatabaseSync,
  input: {
    account: string;
    root: string;
    source: string;
    items: readonly ImportItemReport[];
    at: number;
  },
): string {
  const id = uuidv7();

  db.exec('begin immediate');
  try {
    db.prepare(
      `insert into import_job (id, account, root, source, status, created_at, updated_at, finished_at)
       values (?, ?, ?, ?, 'finished', ?, ?, ?)`,
    ).run(id, input.account, input.root, input.source, input.at, input.at, input.at);

    const item = db.prepare(
      `insert into import_item (job_id, seq, source, disposition, object_id, notes)
       values (?, ?, ?, ?, ?, ?)`,
    );
    let seq = 0;
    for (const row of input.items) {
      item.run(
        id,
        seq,
        row.source,
        row.disposition,
        row.objectId ?? null,
        JSON.stringify(row.notes),
      );
      seq += 1;
    }
    db.exec('commit');
  } catch (error) {
    db.exec('rollback');
    throw error;
  }

  return id;
}

/**
 * A root that was turned away, which is a job too.
 *
 * **`refused` is a status rather than an absence**, and the migration's own
 * comment says why: a root rejected before anything was written is not a failed
 * run, it is a run that correctly did not start. Keeping it means somebody can
 * ask *why did my import not happen* and get the answer from the same place
 * every other answer comes from, rather than from a toast they dismissed.
 */
export function recordRefusal(
  db: DatabaseSync,
  input: { account: string; root: string; refusal: string; at: number },
): string {
  const id = uuidv7();
  db.prepare(
    `insert into import_job (id, account, root, source, status, created_at, updated_at, finished_at)
     values (?, ?, ?, ?, 'refused', ?, ?, ?)`,
  ).run(id, input.account, input.root, input.refusal, input.at, input.at, input.at);
  return id;
}

/** One account's recent imports, newest first. */
export function listImports(db: DatabaseSync, account: string, limit = 50): RecordedJob[] {
  const rows = db
    .prepare(
      `select id, root, source, status, created_at, finished_at
         from import_job where account = ? order by created_at desc limit ?`,
    )
    .all(account, limit) as {
    id: string;
    root: string;
    source: string;
    status: string;
    created_at: number;
    finished_at: number | null;
  }[];

  return rows.map((row) => ({
    id: row.id,
    root: row.root,
    source: row.source,
    status: row.status as ImportJobStatus,
    createdAt: row.created_at,
    finishedAt: row.finished_at,
    counts: countsFor(db, row.id),
  }));
}

/**
 * One import's report, in exactly the shape the panel already renders.
 *
 * **The same `ImportReport` the POST answers with**, deliberately: the client
 * has one renderer for a review and it should not learn that a stored one is a
 * different thing. That is also what makes gate step 11 checkable as written —
 * *fetch the review report over the API* — rather than as something adjacent.
 *
 * Scoped by account in the query rather than checked after, so a job belonging
 * to somebody else is indistinguishable from one that does not exist ([04 §4.4]'s
 * 404-for-everything posture).
 */
export function readImport(db: DatabaseSync, account: string, id: string): ImportReport | null {
  const job = db
    .prepare(`select id, source, status from import_job where id = ? and account = ?`)
    .get(id, account) as { id: string; source: string; status: string } | undefined;
  if (job === undefined) return null;

  const rows = db
    .prepare(
      `select source, disposition, object_id, notes from import_item
         where job_id = ? order by seq`,
    )
    .all(id) as {
    source: string;
    disposition: string;
    object_id: string | null;
    notes: string;
  }[];

  const items: ImportItemReport[] = rows.map((row) => ({
    source: row.source,
    disposition: row.disposition as ImportItemReport['disposition'],
    notes: parseNotes(row.notes),
    ...(row.object_id === null ? {} : { objectId: row.object_id }),
  }));

  return {
    jobId: job.id,
    source: job.source,
    items,
    counts: countBy(items),
  };
}

/** Every review row that named this object, oldest first ([P5 §1.8]). */
export function importNotesFor(
  db: DatabaseSync,
  objectId: string,
): { jobId: string; source: string; notes: ImportNote[] }[] {
  const rows = db
    .prepare(`select job_id, source, notes from import_item where object_id = ? order by rowid`)
    .all(objectId) as { job_id: string; source: string; notes: string }[];

  return rows.map((row) => ({
    jobId: row.job_id,
    source: row.source,
    notes: parseNotes(row.notes),
  }));
}

/**
 * Notes are stored as JSON and read back defensively.
 *
 * A row this cannot parse is a row whose notes are lost, not a report that
 * fails to load — the same rule the sweep itself follows about a poisoned file,
 * applied to our own storage. A review is worth more with one row's detail
 * missing than not at all.
 */
function parseNotes(raw: string): ImportNote[] {
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as ImportNote[]) : [];
  } catch {
    return [];
  }
}

/**
 * The same zero-filled shape `countBy` produces, from a `group by`.
 *
 * A `group by` returns only the dispositions that occurred, and letting the list
 * carry a sparse shape while the report carries a full one would mean a client
 * writing `counts.skipped ?? 0` in one place and `counts.skipped` in the other —
 * two spellings of the same lookup, which is how one of them ends up wrong.
 */
function countsFor(db: DatabaseSync, jobId: string): Record<string, number> {
  const rows = db
    .prepare(`select disposition, count(*) as n from import_item where job_id = ? group by 1`)
    .all(jobId) as { disposition: string; n: number }[];

  const counts: Record<string, number> = Object.fromEntries(
    IMPORT_DISPOSITIONS.map((disposition) => [disposition, 0]),
  );
  for (const row of rows) counts[row.disposition] = row.n;
  return counts;
}

/**
 * Every disposition, zeroed, then counted.
 *
 * **Not an empty object built up from what is present**, which is what this did
 * first and what made a fetched report unequal to the one the POST answered
 * with: `sweep.ts` starts from all seven at zero, so a sweep with nothing
 * skipped reports `skipped: 0` and a reconstructed one omitted the key. The two
 * have to be the same object for a client to have one renderer, and a test that
 * compares them is the only thing that would ever have said so.
 *
 * Driven off the shared list rather than a second literal, so a new disposition
 * cannot be added to the vocabulary and missed here.
 */
function countBy(items: readonly ImportItemReport[]): ImportReport['counts'] {
  const counts = Object.fromEntries(
    IMPORT_DISPOSITIONS.map((disposition) => [disposition, 0]),
  ) as ImportReport['counts'];
  for (const item of items) counts[item.disposition] += 1;
  return counts;
}
