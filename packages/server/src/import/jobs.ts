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
 * ([P4 §1.4](../../../../docs/design/workplan/16-p4-implementation.md),
 * [§7.4](../../../../docs/design/workplan/16-p4-implementation.md)).
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
 * emitter [21 §5]'s `job.progress` key was left open for belongs to a *long*
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
 * The **absolute root is stored here and only here**, which is [21 §4.1.1]'s
 * foreign-path doctrine written into the schema rather than trusted to callers:
 * every item names its file relative to this row, so the report can be shown,
 * logged and pasted into an issue without becoming a map of somebody's disk.
 */
/**
 * ***How an import arrived*** (2026-09-28): a sweep of the server's disk, whose
 * `root` a later sweep can open again, or an upload, whose `root` is only the
 * name of what the browser sent. Recorded so {@link recordedRootFor} can tell
 * them apart — uploads were never recorded before, and that reader relied on
 * it.
 */
export type ImportTransport = 'path' | 'upload';

export function recordImport(
  db: DatabaseSync,
  input: {
    account: string;
    root: string;
    source: string;
    items: readonly ImportItemReport[];
    at: number;
    /** `path` unless said: every recorder before 2026-09-28 was a server-path sweep. */
    transport?: ImportTransport;
  },
): string {
  const id = uuidv7();

  db.exec('begin immediate');
  try {
    db.prepare(
      `insert into import_job (id, account, root, source, status, created_at, updated_at, finished_at, transport)
       values (?, ?, ?, ?, 'finished', ?, ?, ?, ?)`,
    ).run(
      id,
      input.account,
      input.root,
      input.source,
      input.at,
      input.at,
      input.at,
      input.transport ?? 'path',
    );

    const item = db.prepare(
      `insert into import_item (job_id, seq, source, disposition, object_id, notes)
       values (?, ?, ?, ?, ?, ?)`,
    );
    let seq = 0;
    for (const row of input.items) {
      /**
       * **One row per object the file produced, all sharing the item's `seq`.**
       *
       * A file that made two objects — a card carrying a `character_book` —
       * needs its notes findable from either, and the only key `import_item`
       * has is `object_id`. Sharing `seq` is what keeps that from changing the
       * review: `readImport` collapses rows by it, so the report still has one
       * item per file seen, which is what a review is a row of.
       */
      const produced = [row.objectId ?? null, ...(row.alsoProduced ?? [])];
      for (const objectId of produced) {
        item.run(id, seq, row.source, row.disposition, objectId, JSON.stringify(row.notes));
      }
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
  input: {
    account: string;
    root: string;
    refusal: string;
    at: number;
    transport?: ImportTransport;
  },
): string {
  const id = uuidv7();
  db.prepare(
    `insert into import_job (id, account, root, source, status, created_at, updated_at, finished_at, transport)
     values (?, ?, ?, ?, 'refused', ?, ?, ?, ?)`,
  ).run(
    id,
    input.account,
    input.root,
    input.refusal,
    input.at,
    input.at,
    input.at,
    input.transport ?? 'path',
  );
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
 * to somebody else is indistinguishable from one that does not exist ([09 §4.4]'s
 * 404-for-everything posture).
 */
export function readImport(db: DatabaseSync, account: string, id: string): ImportReport | null {
  const job = db
    .prepare(`select id, source, status from import_job where id = ? and account = ?`)
    .get(id, account) as { id: string; source: string; status: string } | undefined;
  if (job === undefined) return null;

  const rows = db
    .prepare(
      `select seq, source, disposition, object_id, notes from import_item
         where job_id = ? order by seq, rowid`,
    )
    .all(id) as {
    seq: number;
    source: string;
    disposition: string;
    object_id: string | null;
    notes: string;
  }[];

  /**
   * **Collapsed by `seq`, because a file that made two objects has two rows.**
   *
   * The extra rows exist so the notes are findable from either object
   * (`recordImport` says why); the *review* is a row per file seen, so the
   * first row of each `seq` is the item and the rest are addressing. Ordered by
   * `rowid` within a `seq` so "first" means the object the item was primarily
   * about — the actor, for a card that carried a book.
   */
  const firstOfEach = rows.filter((row, index) => rows[index - 1]?.seq !== row.seq);

  const items: ImportItemReport[] = firstOfEach.map((row) => {
    /**
     * The extra rows come back as `alsoProduced`, so a report fetched by id is
     * the same object the sweep answered with. That equality is asserted, and
     * it is what lets one client renderer be correct for both paths — a
     * round-trip that quietly dropped a field would make the two reports
     * *nearly* the same, which is the harder kind of difference to notice.
     */
    const alsoProduced = rows
      .filter((other) => other.seq === row.seq && other !== row)
      .flatMap((other) => (other.object_id === null ? [] : [other.object_id]));

    return {
      source: row.source,
      disposition: row.disposition as ImportItemReport['disposition'],
      notes: parseNotes(row.notes),
      ...(row.object_id === null ? {} : { objectId: row.object_id }),
      ...(alsoProduced.length === 0 ? {} : { alsoProduced }),
    };
  });

  return {
    jobId: job.id,
    source: job.source,
    items,
    counts: countBy(items),
  };
}

/**
 * Every review row that named this object, oldest first ([P5 §1.8]).
 *
 * **Scoped by account**, which it was not when it was written and nobody had
 * noticed because it had no callers. An object id is a uuid and hard to guess,
 * but *hard to guess* is not an access rule — and this is the one query in the
 * module that reaches rows by something other than a job id, so it is the one
 * where forgetting the join is possible. Joined rather than checked after, the
 * way `readImport` does it, so somebody else's row is indistinguishable from a
 * row that is not there ([09 §4.4]).
 */
export function importNotesFor(
  db: DatabaseSync,
  account: string,
  objectId: string,
): { jobId: string; source: string; notes: ImportNote[] }[] {
  const rows = db
    .prepare(
      `select item.job_id, item.source, item.notes from import_item as item
         join import_job as job on job.id = item.job_id
        where item.object_id = ? and job.account = ?
        order by item.rowid`,
    )
    .all(objectId, account) as { job_id: string; source: string; notes: string }[];

  return rows.map((row) => ({
    jobId: row.job_id,
    source: row.source,
    notes: parseNotes(row.notes),
  }));
}

/**
 * ***The server path a session last came in from***, or null —
 * [P14 §2.7](../../../../docs/design/workplan/31-p14-scene-and-session-import.md)'s
 * *"re-sweeps the server path recorded in the ledger when the import came
 * from one"*, [P14.10a].
 *
 * ~~Only a sweep of a server path records a root: an upload names its file and
 * nothing more ([21 §4.1.1]), and a refused sweep wrote nothing. So a row
 * naming this session under a `finished` job is exactly *came from a path*,~~
 * ***Uploads are recorded since 2026-09-28***, with the name of what was sent
 * as their root — which no sweep can open — so this asks for `path` rows by
 * name: a row naming this session under a `finished` sweep of a path is
 * exactly *came from a path*, and the newest one is where it was last brought
 * up to date from. Scoped by account through the join, as
 * {@link importNotesFor} is.
 */
export function recordedRootFor(
  db: DatabaseSync,
  account: string,
  objectId: string,
): string | null {
  const row = db
    .prepare(
      `select job.root from import_item as item
         join import_job as job on job.id = item.job_id
        where item.object_id = ? and job.account = ? and job.status = 'finished'
          and job.transport = 'path'
        order by job.created_at desc, item.rowid desc
        limit 1`,
    )
    .get(objectId, account) as { root: string } | undefined;
  return row?.root ?? null;
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
    .prepare(
      // `distinct seq` and not `count(*)`: a file that produced two objects has
      // two rows, and a review counts *files seen*. Counting rows would report
      // a sweep of a hundred cards carrying books as two hundred conversions.
      `select disposition, count(distinct seq) as n from import_item where job_id = ? group by 1`,
    )
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
