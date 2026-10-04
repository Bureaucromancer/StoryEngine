// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { createHash } from 'node:crypto';
import {
  chmod,
  copyFile,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  stat,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { SourceRefusal } from '../import/source.js';
import { openImportScratch } from './import-scratch.js';
import { Layout } from './layout.js';
import {
  copySourceFile,
  type FileCopyOutcome,
  looksLikeSqlite,
  runInWorker,
  SNAPSHOT_FREE_RESERVE_BYTES,
  snapshotDatabase,
  SnapshotSpaceError,
  type SnapshotInput,
  type SnapshotRefusal,
  type SnapshotTask,
  type SnapshotTaskOutcome,
} from './sqlite-snapshot.js';

/**
 * ***The snapshot, and the stage's proof obligation*** —
 * [P13.1](../../../../docs/design/workplan/30-p13-aventuras-import.md):
 * *"a WAL-mode database with committed, un-checkpointed frames snapshots with
 * those frames present, by both routes."*
 *
 * **The fixture is the case, not an approximation of it.** A running Aventuras
 * holds its database open in WAL mode, and between checkpoints a commit lives
 * only in `aventura.db-wal`. So every proof below keeps the writer's connection
 * open — closing the last connection checkpoints the log into the file, and a
 * test that closed it would pass against a snapshot that read the file alone —
 * and first shows that the file alone does **not** hold the row, so the
 * assertion that the snapshot does is about the log and nothing else.
 *
 * The tables are two columns and made up; Aventuras' own schema is P13.2's,
 * and none of it matters to whether a copy is whole.
 */

let root: string;
let layout: Layout;
let sources: string;
/** Every connection a test opened, closed afterwards whatever the test did. */
let open: DatabaseSync[];

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'se-snapshot-'));
  layout = new Layout(join(root, 'data'));
  sources = join(root, 'aventuras');
  await mkdir(sources, { recursive: true });
  // There, so the room check asks a real filesystem in every test that does
  // not stand in for it — `statfs` on a directory that is not there answers
  // nothing, and the check would be skipped.
  await mkdir(layout.dataRoot, { recursive: true });
  open = [];
});

afterEach(async () => {
  for (const db of open) {
    if (db.isOpen) db.close();
  }
  await rm(root, { recursive: true, force: true });
});

function connect(path: string, options?: { readOnly: boolean }): DatabaseSync {
  const db = options === undefined ? new DatabaseSync(path) : new DatabaseSync(path, options);
  open.push(db);
  return db;
}

/**
 * A database as a running Aventuras leaves it between checkpoints: one row in
 * the file, one row committed and still only in the log, and the writer's
 * connection open so nothing moves it.
 */
function withUnsavedFrames(path: string): DatabaseSync {
  const writer = connect(path);
  writer.exec('pragma journal_mode = wal');
  // No automatic checkpoint, so a commit stays in the log until something
  // asks — which is what the app looks like between its own.
  writer.exec('pragma wal_autocheckpoint = 0');
  writer.exec('create table vault (id text primary key, name text)');
  writer.exec("insert into vault values ('saved', 'in the file')");
  writer.exec('pragma wal_checkpoint(truncate)');
  writer.exec("insert into vault values ('unsaved', 'only in the log')");
  return writer;
}

/** A WAL database as Aventuras leaves it when it is closed: one file, and nothing beside it. */
function closedCleanly(path: string): void {
  const db = connect(path);
  db.exec('pragma journal_mode = wal');
  db.exec('create table vault (id text primary key, name text)');
  db.exec("insert into vault values ('saved', 'in the file')");
  db.close();
}

/**
 * A write large enough to grow the file — so the change is in its size and
 * not only in a modification time, which a test that writes twice inside one
 * tick of the filesystem's clock could not rely on.
 */
function writeAndCheckpoint(db: DatabaseSync, id: string): void {
  db.prepare('insert into vault values (?, ?)').run(id, 'x'.repeat(20_000));
  db.exec('pragma wal_checkpoint(truncate)');
}

/** The ids a database holds, read the way the reader will: from the path handed back. */
function idsIn(path: string): string[] {
  const db = connect(path, { readOnly: true });
  try {
    return db
      .prepare('select id from vault order by id')
      .all()
      .map((row) => String(row['id']));
  } finally {
    db.close();
  }
}

/**
 * What a copy of the main file alone would hold — the precondition every proof
 * states first. Without it the proof could pass against a fixture whose row
 * had been checkpointed after all, which is a test of nothing.
 */
async function idsInTheFileAlone(path: string): Promise<string[]> {
  const alone = join(root, 'alone');
  await mkdir(alone, { recursive: true });
  const copy = join(alone, `copy-${String(Date.now())}.sqlite`);
  await copyFile(path, copy);
  return idsIn(copy);
}

async function scratchEntries(): Promise<string[]> {
  try {
    return await readdir(layout.importScratchRoot);
  } catch {
    return [];
  }
}

async function sha(path: string): Promise<string> {
  return createHash('sha256')
    .update(await readFile(path))
    .digest('hex');
}

async function listing(directory: string): Promise<string[]> {
  return (await readdir(directory)).sort();
}

/** The real worker for everything but `VACUUM INTO`, which fails as a read-only mount's open does. */
function vacuumCannotOpen(task: SnapshotTask): Promise<SnapshotTaskOutcome> {
  if (task.op === 'vacuum') {
    return Promise.resolve({ ok: false, message: 'unable to open database file', errcode: 14 });
  }
  return runInWorker(task);
}

const WAL_NOTE = { key: 'import.aventuras.walCopied', params: {}, level: 'warn' };
const UNREADABLE = { ok: false, refusal: 'unreadable-root' };
const LIVE = { ok: false, refusal: 'live-install' };

describe('committed frames still in the log are in the snapshot — the proof obligation', () => {
  it('by VACUUM INTO from the real file, while the writer holds it open', async () => {
    const source = join(sources, 'aventura.db');
    withUnsavedFrames(source);
    expect(await idsInTheFileAlone(source)).toEqual(['saved']);

    const snapshot = await snapshotDatabase(layout, { kind: 'path', path: source });

    expect(snapshot.ok).toBe(true);
    if (!snapshot.ok) return;
    expect(snapshot.route).toBe('vacuum');
    expect(idsIn(snapshot.path)).toEqual(['saved', 'unsaved']);
    // §1.2: a `VACUUM INTO` that succeeded needs no note.
    expect(snapshot.notes).toEqual([]);
    // Ours, not theirs: in the scratch root, and the source's log untouched —
    // a read-only connection cannot checkpoint somebody else's database.
    expect(snapshot.path.startsWith(layout.importScratchRoot)).toBe(true);
    expect((await readFile(`${source}-wal`)).length).toBeGreaterThan(0);
    await snapshot.dispose();
  });

  it('by the fallback copy, when the read-only open fails', async () => {
    const source = join(sources, 'aventura.db');
    withUnsavedFrames(source);
    expect(await idsInTheFileAlone(source)).toEqual(['saved']);

    const snapshot = await snapshotDatabase(
      layout,
      { kind: 'path', path: source },
      { run: vacuumCannotOpen },
    );

    expect(snapshot.ok).toBe(true);
    if (!snapshot.ok) return;
    expect(snapshot.route).toBe('copy');
    expect(idsIn(snapshot.path)).toEqual(['saved', 'unsaved']);
    // A copy that replayed a log says Aventuras may have been open.
    expect(snapshot.notes).toEqual([WAL_NOTE]);
    // One file: the log was folded in, and nothing a failed attempt made is left.
    expect(await readdir(dirname(snapshot.path))).toEqual(['copy.sqlite']);
    await snapshot.dispose();
  });

  it('by bytes, with the log handed over beside them', async () => {
    const source = join(sources, 'aventura.db');
    withUnsavedFrames(source);

    const snapshot = await snapshotDatabase(layout, {
      kind: 'bytes',
      database: await readFile(source),
      wal: await readFile(`${source}-wal`),
    });

    expect(snapshot.ok).toBe(true);
    if (!snapshot.ok) return;
    expect(snapshot.route).toBe('bytes');
    expect(idsIn(snapshot.path)).toEqual(['saved', 'unsaved']);
    expect(snapshot.notes).toEqual([WAL_NOTE]);
    await snapshot.dispose();
  });

  it('and not without the log, which is why the log is carried', async () => {
    // The control for the three above: the same bytes, minus the log, are a
    // perfectly good older database — which is the quiet loss the log prevents.
    const source = join(sources, 'aventura.db');
    withUnsavedFrames(source);

    const snapshot = await snapshotDatabase(layout, {
      kind: 'bytes',
      database: await readFile(source),
    });

    expect(snapshot.ok).toBe(true);
    if (!snapshot.ok) return;
    expect(idsIn(snapshot.path)).toEqual(['saved']);
    expect(snapshot.notes).toEqual([]);
    await snapshot.dispose();
  });

  it('by a file the server already holds, with its log beside it', async () => {
    // [P13.8]'s landing: the upload is in scratch already, and is checked where
    // it lies rather than copied a second time.
    const source = join(sources, 'aventura.db');
    withUnsavedFrames(source);
    const space = await openImportScratch(layout);
    await copyFile(`${source}-wal`, space.path('landed.db-wal'));
    await copyFile(source, space.path('landed.db'));

    const snapshot = await snapshotDatabase(layout, { kind: 'owned', space, name: 'landed.db' });

    expect(snapshot.ok).toBe(true);
    if (!snapshot.ok) return;
    expect(snapshot.route).toBe('owned');
    expect(snapshot.path).toBe(space.path('landed.db'));
    expect(idsIn(snapshot.path)).toEqual(['saved', 'unsaved']);
    expect(snapshot.notes).toEqual([WAL_NOTE]);
    await snapshot.dispose();
    expect(await scratchEntries()).toEqual([]);
  });
});

describe('somebody else’s directory, as the snapshot leaves it', () => {
  it('reads a crash-left database by VACUUM INTO and writes none of it', async () => {
    /**
     * ***The case that tells a read-only open from a read-write one*** —
     * found at review, 2026-09-29, when nothing did: every other vacuum test
     * keeps the writer open, and a read-write connection that is not the
     * last one closes without checkpointing. Here the files are what a crash
     * leaves — the file, its log and its index, and nobody holding them — so
     * a read-write open would be the last connection, checkpoint the log into
     * the file and delete it: a write to somebody's Aventuras database. Read
     * only, both are byte for byte as they were.
     */
    const running = join(root, 'running');
    await mkdir(running);
    const writer = withUnsavedFrames(join(running, 'aventura.db'));
    for (const side of ['', '-wal', '-shm']) {
      await copyFile(join(running, `aventura.db${side}`), join(sources, `aventura.db${side}`));
    }
    writer.close();
    const source = join(sources, 'aventura.db');
    const before = { db: await sha(source), wal: await sha(`${source}-wal`) };

    const snapshot = await snapshotDatabase(layout, { kind: 'path', path: source });

    expect(snapshot.ok).toBe(true);
    if (!snapshot.ok) return;
    expect(snapshot.route).toBe('vacuum');
    expect(idsIn(snapshot.path)).toEqual(['saved', 'unsaved']);
    await snapshot.dispose();
    expect(await sha(source)).toBe(before.db);
    expect(await sha(`${source}-wal`)).toBe(before.wal);
    expect(await listing(sources)).toEqual(['aventura.db', 'aventura.db-shm', 'aventura.db-wal']);
  });

  it('copies a WAL database that was closed cleanly, and makes nothing beside it', async () => {
    /**
     * ***Found at review, 2026-09-29.*** A read-only open of a WAL database
     * with no `-wal` and no `-shm` creates both, in the owner's directory,
     * and leaves them — which is the ordinary case: close Aventuras, then
     * import. So such a database is copied instead, and nothing a copy with
     * no log could replay needs a note.
     */
    const source = join(sources, 'aventura.db');
    closedCleanly(source);
    const before = await sha(source);
    expect(await listing(sources)).toEqual(['aventura.db']);

    const snapshot = await snapshotDatabase(layout, { kind: 'path', path: source });

    expect(snapshot.ok).toBe(true);
    if (!snapshot.ok) return;
    expect(snapshot.route).toBe('copy');
    expect(idsIn(snapshot.path)).toEqual(['saved']);
    expect(snapshot.notes).toEqual([]);
    await snapshot.dispose();
    expect(await listing(sources)).toEqual(['aventura.db']);
    expect(await sha(source)).toBe(before);
  });

  it('takes VACUUM INTO from a rollback-journal database, which needs nothing beside it', async () => {
    const source = join(sources, 'aventura.db');
    const db = connect(source);
    db.exec('pragma journal_mode = delete');
    db.exec('create table vault (id text primary key, name text)');
    db.exec("insert into vault values ('saved', 'in the file')");
    db.close();

    const snapshot = await snapshotDatabase(layout, { kind: 'path', path: source });

    expect(snapshot.ok).toBe(true);
    if (!snapshot.ok) return;
    expect(snapshot.route).toBe('vacuum');
    await snapshot.dispose();
    expect(await listing(sources)).toEqual(['aventura.db']);
  });
});

describe('VACUUM INTO while somebody else is writing', () => {
  it('leaves out a transaction that is open and not committed', async () => {
    const source = join(sources, 'aventura.db');
    const writer = withUnsavedFrames(source);
    writer.exec('begin immediate');
    writer.exec("insert into vault values ('uncommitted', 'not yet')");

    try {
      const snapshot = await snapshotDatabase(layout, { kind: 'path', path: source });

      expect(snapshot.ok).toBe(true);
      if (!snapshot.ok) return;
      expect(snapshot.route).toBe('vacuum');
      expect(idsIn(snapshot.path)).toEqual(['saved', 'unsaved']);
      await snapshot.dispose();
    } finally {
      writer.exec('rollback');
    }
  });

  it('is one point in time while another connection keeps committing', async () => {
    /**
     * Every write moves two things together — a row into `ledger` and the
     * count in `total` — so a copy taken at one moment has them agree, and a
     * copy stitched together from two moments almost never would. The writer
     * keeps going for as long as the snapshot takes, on the main thread, which
     * is only possible because the snapshot is not on it.
     */
    const source = join(sources, 'aventura.db');
    const writer = connect(source);
    writer.exec('pragma journal_mode = wal');
    writer.exec('create table ledger (n integer primary key, pad text)');
    writer.exec('create table total (n integer)');
    const seed = 4000;
    writer.exec('begin');
    const insert = writer.prepare('insert into ledger (pad) values (?)');
    for (let row = 0; row < seed; row += 1) insert.run('x'.repeat(200));
    writer.exec(`insert into total values (${String(seed)})`);
    writer.exec('commit');

    let writing = true;
    let during = 0;
    const write = (): void => {
      if (!writing) return;
      writer.exec('begin');
      insert.run('written while the snapshot ran');
      writer.exec('update total set n = n + 1');
      writer.exec('commit');
      during += 1;
      setImmediate(write);
    };
    setImmediate(write);

    let snapshot;
    try {
      snapshot = await snapshotDatabase(layout, { kind: 'path', path: source });
    } finally {
      // Stopped whatever happened, or the next write lands on a connection
      // `afterEach` has closed and throws where no test can see it.
      writing = false;
    }

    expect(snapshot.ok).toBe(true);
    if (!snapshot.ok) return;
    expect(snapshot.route).toBe('vacuum');
    expect(during).toBeGreaterThan(0);
    const copy = connect(snapshot.path, { readOnly: true });
    const rows = Number(copy.prepare('select count(*) as n from ledger').get()?.['n']);
    const total = Number(copy.prepare('select n from total').get()?.['n']);
    expect(rows).toBe(total);
    expect(rows).toBeGreaterThanOrEqual(seed);
    expect(copy.prepare('pragma quick_check').all()).toEqual([{ quick_check: 'ok' }]);
    copy.close();
    await snapshot.dispose();
  });
});

describe('a copy of a file somebody wrote while it was copied', () => {
  it('refuses as live-install when Aventuras started and checkpointed during the copy', async () => {
    /**
     * The race the copy of a cleanly closed database opens: nothing is
     * writing it when the copy starts, and something may be by the time it
     * ends. The seam stands in for Aventuras opening its database, writing
     * and checkpointing as the copy is taken; the file's record before and
     * after disagrees, and the copy is refused rather than handed back.
     */
    const source = join(sources, 'aventura.db');
    closedCleanly(source);
    const aventurasStarts = async (from: string, to: string): Promise<FileCopyOutcome> => {
      const copied = await copySourceFile(from, to);
      writeAndCheckpoint(connect(source), 'written while it was copied');
      return copied;
    };

    expect(
      await snapshotDatabase(layout, { kind: 'path', path: source }, { copy: aventurasStarts }),
    ).toEqual(LIVE);
    expect(await scratchEntries()).toEqual([]);
  });

  it('copies the log before the file, and refuses a checkpoint between them', async () => {
    /**
     * ***Found at review, 2026-09-29***: the order the copy route's comment
     * leaned on had no test, and a file copied first then checkpointed over
     * would have been a quietly older database — the log it needed truncated
     * away before it was copied. Now both halves are held: the order, and the
     * file's record, which sees the checkpoint between the two copies and
     * refuses rather than replaying a log older than the file.
     */
    const source = join(sources, 'aventura.db');
    const writer = withUnsavedFrames(source);
    const order: string[] = [];
    const checkpointBetween = async (from: string, to: string): Promise<FileCopyOutcome> => {
      const copied = await copySourceFile(from, to);
      order.push(basename(from));
      if (order.length === 1) writeAndCheckpoint(writer, 'later');
      return copied;
    };

    const snapshot = await snapshotDatabase(
      layout,
      { kind: 'path', path: source },
      { run: vacuumCannotOpen, copy: checkpointBetween },
    );

    expect(order).toEqual(['aventura.db-wal', 'aventura.db']);
    expect(snapshot).toEqual(LIVE);
    expect(await scratchEntries()).toEqual([]);
  });
});

describe('on a worker thread, so the server keeps answering', () => {
  /**
   * ***A rendezvous rather than a stopwatch.*** A stopwatch — *did a timer fire
   * during the snapshot* — passes on a loaded machine for the wrong reason and
   * fails on a slow one for no reason. This asks something only a second
   * thread can answer: the source is locked by a connection on the **main**
   * thread, the snapshot has to wait for that lock, and the only thing that
   * releases it is a timer on the main thread.
   *
   * On a worker, SQLite waits out the lock, the timer fires, and the copy is
   * made by `VACUUM INTO`. On the main thread the wait would hold the very
   * thread the timer needs, the lock would never be released while SQLite
   * waited, and the attempt would give up busy and fall back to copying — so
   * the route is the observable.
   */
  it('runs VACUUM INTO while the main thread is free to release a lock it waits on', async () => {
    const source = join(sources, 'aventura.db');
    const holder = connect(source);
    // A rollback journal, where an exclusive lock keeps readers out. (Under WAL
    // a reader never waits for a writer, which is the point of WAL and no use
    // here.)
    holder.exec('pragma journal_mode = delete');
    holder.exec('create table vault (id text primary key, name text)');
    holder.exec("insert into vault values ('held', 'behind a lock')");
    holder.exec('begin exclusive');

    let released = false;
    const release = setTimeout(() => {
      holder.exec('commit');
      released = true;
    }, 250);

    try {
      const snapshot = await snapshotDatabase(layout, { kind: 'path', path: source });

      expect(released).toBe(true);
      expect(snapshot.ok).toBe(true);
      if (!snapshot.ok) return;
      expect(snapshot.route).toBe('vacuum');
      expect(idsIn(snapshot.path)).toEqual(['held']);
      await snapshot.dispose();
    } finally {
      clearTimeout(release);
      if (holder.isTransaction) holder.exec('rollback');
    }
  });

  it('runs quick_check there too', async () => {
    // The same rendezvous on the other task: a file the caller owns, locked by
    // the caller on the main thread, released by a timer while the check waits.
    const space = await openImportScratch(layout);
    const landed = space.path('landed.db');
    const holder = connect(landed);
    holder.exec('create table vault (id text primary key, name text)');
    holder.exec("insert into vault values ('landed', 'by an upload')");
    holder.exec('begin exclusive');

    let released = false;
    const release = setTimeout(() => {
      holder.exec('commit');
      holder.close();
      released = true;
    }, 250);

    try {
      const snapshot = await snapshotDatabase(layout, { kind: 'owned', space, name: 'landed.db' });

      expect(released).toBe(true);
      expect(snapshot.ok).toBe(true);
      if (!snapshot.ok) return;
      expect(idsIn(snapshot.path)).toEqual(['landed']);
      // P13.8's landing has no log, and a note on every upload would tell
      // everyone to close an app that was never open.
      expect(snapshot.notes).toEqual([]);
      await snapshot.dispose();
    } finally {
      clearTimeout(release);
      if (holder.isOpen && holder.isTransaction) holder.exec('rollback');
    }
  });
});

describe('what it refuses', () => {
  it('a file that is not SQLite, by every route, as unreadable-root', async () => {
    const text = join(sources, 'aventura.db');
    await writeFile(text, 'an HTML error page somebody saved under the right name');

    expect(await snapshotDatabase(layout, { kind: 'path', path: text })).toEqual(UNREADABLE);
    expect(
      await snapshotDatabase(layout, { kind: 'bytes', database: await readFile(text) }),
    ).toEqual(UNREADABLE);

    const space = await openImportScratch(layout);
    await copyFile(text, space.path('landed.db'));
    expect(await snapshotDatabase(layout, { kind: 'owned', space, name: 'landed.db' })).toEqual(
      UNREADABLE,
    );

    // Refused before anything was copied, and the handed-over space removed.
    expect(await scratchEntries()).toEqual([]);
  });

  it('an empty file, a missing one and a directory, as unreadable-root', async () => {
    // Zero bytes is a valid empty database to SQLite and holds nothing to
    // import; the header check says so before a copy is made.
    const empty = join(sources, 'empty.db');
    await writeFile(empty, '');

    for (const path of [empty, join(sources, 'missing.db'), sources]) {
      expect(await snapshotDatabase(layout, { kind: 'path', path }), path).toEqual(UNREADABLE);
    }
    expect(await scratchEntries()).toEqual([]);
  });

  it('a copy that fails quick_check, as live-install', async () => {
    /**
     * What a copy of a file caught mid-write looks like: a b-tree page with
     * garbage in it, and a file cut short. Both keep a valid header, so the
     * header check lets them through and it is `quick_check` that refuses.
     */
    const source = join(sources, 'aventura.db');
    const db = connect(source);
    db.exec('create table vault (id integer primary key, name text)');
    db.exec('create index vault_name on vault (name)');
    db.exec('begin');
    const insert = db.prepare('insert into vault (name) values (?)');
    for (let row = 0; row < 2000; row += 1) insert.run(`character ${String(row)}`.padEnd(60, '.'));
    db.exec('commit');
    db.close();
    const whole = await readFile(source);
    const pageSize = 4096;

    const torn = Uint8Array.from(whole);
    torn.fill(0xff, pageSize * 2, pageSize * 2 + 200);
    const short = whole.subarray(0, pageSize * Math.floor(whole.length / pageSize / 2));

    for (const database of [torn, short]) {
      expect(looksLikeSqlite(database)).toBe(true);
      expect(await snapshotDatabase(layout, { kind: 'bytes', database })).toEqual(LIVE);
    }
    expect(await scratchEntries()).toEqual([]);
  });

  it('refuses in the importer’s own words', () => {
    // A compile-time check as much as a run-time one: every `SnapshotRefusal`
    // is a `SourceRefusal`, so P13.2's reader passes it through untranslated.
    // A member added here and not there fails `pnpm typecheck` on this line.
    const passedThrough = (refusal: SnapshotRefusal): SourceRefusal => refusal;
    expect(passedThrough('live-install')).toBe('live-install');
  });

  it('throws for a relative path, which would mean whatever the cwd is', async () => {
    await expect(snapshotDatabase(layout, { kind: 'path', path: 'aventura.db' })).rejects.toThrow(
      /absolute/,
    );
  });

  it('reads a database it may not write, rather than throwing', async () => {
    /**
     * ***Found at review, 2026-09-29.*** A header whose file-format write
     * version this SQLite does not know (byte 18 above 2) makes the database
     * readable and not writable. The check folded every WAL copy's log into
     * its file, which failed as `SQLITE_READONLY` — read as our fault, and
     * thrown — for a copy the check had just passed. The reviewer's case
     * exactly: a WAL database, with a log to replay.
     */
    const source = join(sources, 'aventura.db');
    withUnsavedFrames(source);
    const database = await readFile(source);
    database[18] = 3;

    const snapshot = await snapshotDatabase(layout, {
      kind: 'bytes',
      database,
      wal: await readFile(`${source}-wal`),
    });

    expect(snapshot.ok).toBe(true);
    if (!snapshot.ok) return;
    expect(idsIn(snapshot.path)).toEqual(['saved', 'unsaved']);
    expect(snapshot.notes).toEqual([WAL_NOTE]);
    await snapshot.dispose();
    expect(await scratchEntries()).toEqual([]);
  });
});

describe('a log it cannot use', () => {
  it('refuses rather than making a quietly older database', async () => {
    /**
     * Something at `aventura.db-wal` that is not a file cannot be copied, and
     * the file without it is the database as of its last checkpoint — whole,
     * plausible, and missing whatever was committed since. A directory stands
     * in here for the unreadable log a root-run test cannot make; a link, the
     * test after next.
     */
    const source = join(sources, 'aventura.db');
    withUnsavedFrames(source);
    const mount = join(root, 'mount');
    await mkdir(mount);
    await copyFile(source, join(mount, 'aventura.db'));
    await mkdir(join(mount, 'aventura.db-wal'));

    expect(
      await snapshotDatabase(
        layout,
        { kind: 'path', path: join(mount, 'aventura.db') },
        { run: vacuumCannotOpen },
      ),
    ).toEqual(UNREADABLE);
    expect(await scratchEntries()).toEqual([]);
  });

  it('refuses the same beside a file the caller owns, and removes the space', async () => {
    // The owned route's own look at the log: without it SQLite fails to open
    // the directory as a log, which reads as a fault of ours and throws.
    const source = join(sources, 'aventura.db');
    withUnsavedFrames(source);
    const space = await openImportScratch(layout);
    await copyFile(source, space.path('landed.db'));
    await mkdir(space.path('landed.db-wal'));

    expect(await snapshotDatabase(layout, { kind: 'owned', space, name: 'landed.db' })).toEqual(
      UNREADABLE,
    );
    expect(await scratchEntries()).toEqual([]);
  });

  it('refuses a log that is a link, which realPath never vouched for', async () => {
    /**
     * With no seam: `realPath` checked where the database leads and not
     * where a `-wal` beside it does, so a link there could carry a log from
     * anywhere — our own data directory included — into the copy. It is
     * asked about with `lstat`, and refused.
     */
    const source = join(sources, 'aventura.db');
    withUnsavedFrames(source);
    const elsewhere = join(root, 'elsewhere');
    const mount = join(root, 'mount');
    await mkdir(elsewhere);
    await mkdir(mount);
    await copyFile(`${source}-wal`, join(elsewhere, 'aventura.db-wal'));
    await copyFile(source, join(mount, 'aventura.db'));
    try {
      await symlink(join(elsewhere, 'aventura.db-wal'), join(mount, 'aventura.db-wal'), 'file');
    } catch {
      return; // Windows without developer mode.
    }

    expect(
      await snapshotDatabase(layout, { kind: 'path', path: join(mount, 'aventura.db') }),
    ).toEqual(UNREADABLE);
    expect(await scratchEntries()).toEqual([]);
  });

  it('refuses a log that could not be read, as a disk would fail it', async () => {
    const source = join(sources, 'aventura.db');
    withUnsavedFrames(source);
    const logUnreadable = (from: string, to: string): Promise<FileCopyOutcome> =>
      from.endsWith('-wal') ? Promise.resolve('unreadable') : copySourceFile(from, to);

    expect(
      await snapshotDatabase(
        layout,
        { kind: 'path', path: source },
        { run: vacuumCannotOpen, copy: logUnreadable },
      ),
    ).toEqual(UNREADABLE);
    expect(await scratchEntries()).toEqual([]);
  });
});

/**
 * ***What a route reads off an error of ours*** — found at the P13.2 review,
 * 2026-09-29. `SQLITE_FULL` is a full disk that SQLite noticed rather than the
 * file system, and is thrown with the file system's `ENOSPC` so the routes
 * answer it `507 no-space` as they do the copy's own; `SQLITE_IOERR_WRITE`
 * may be a failing disk, and carries no code a route would answer as full.
 */
const FULL_DISK_CODE: Readonly<Record<number, string | undefined>> = {
  13: 'ENOSPC',
  778: undefined,
};

async function rejectionOf(promise: Promise<unknown>): Promise<NodeJS.ErrnoException> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof Error) return error;
    throw new Error('rejected with something that is not an Error', { cause: error });
  }
  throw new Error('resolved, and was expected to reject');
}

describe('what is ours to fix, thrown rather than refused', () => {
  it('when the check fails for a reason that is ours', async () => {
    /**
     * A full disk while the log is replayed is not somebody's open Aventuras,
     * and `live-install` would send them off to close an app that had nothing
     * to do with it. `SQLITE_FULL`, then `SQLITE_IOERR_WRITE`, whose primary
     * code sits in the low byte of the extended one.
     */
    for (const errcode of [13, 778]) {
      const full = (task: SnapshotTask): Promise<SnapshotTaskOutcome> =>
        task.op === 'check'
          ? Promise.resolve({ ok: false, message: 'database or disk is full', errcode })
          : runInWorker(task);
      const source = join(sources, `full-${String(errcode)}.db`);
      const db = connect(source);
      db.exec('create table vault (id text)');
      db.close();

      const thrown = await rejectionOf(
        snapshotDatabase(
          layout,
          { kind: 'bytes', database: await readFile(source) },
          { run: full },
        ),
      );
      expect(thrown.message).toMatch(/could not be checked/);
      expect(thrown.code).toBe(FULL_DISK_CODE[errcode]);
    }
    expect(await scratchEntries()).toEqual([]);
  });

  it('when VACUUM INTO failed on our side, without copying the database again', async () => {
    /**
     * ***Found at review, 2026-09-29.*** Every failed `VACUUM INTO` used to
     * fall back to a copy, so a full disk was filled a second time by a copy
     * of the whole database, and a log it replayed said *"close Aventuras"*
     * for a fault that was ours. `SQLITE_FULL`, then `SQLITE_IOERR_WRITE`:
     * neither can be the source's, which is open read-only.
     */
    const source = join(sources, 'aventura.db');
    withUnsavedFrames(source);
    let copies = 0;
    const counted = (from: string, to: string): Promise<FileCopyOutcome> => {
      copies += 1;
      return copySourceFile(from, to);
    };

    for (const errcode of [13, 778]) {
      const full = (task: SnapshotTask): Promise<SnapshotTaskOutcome> =>
        task.op === 'vacuum'
          ? Promise.resolve({ ok: false, message: 'database or disk is full', errcode })
          : runInWorker(task);
      const thrown = await rejectionOf(
        snapshotDatabase(layout, { kind: 'path', path: source }, { run: full, copy: counted }),
      );
      expect(thrown.message).toMatch(/could not be copied/);
      expect(thrown.code).toBe(FULL_DISK_CODE[errcode]);
    }
    expect(copies).toBe(0);
    expect(await scratchEntries()).toEqual([]);
  });

  it('when writing our copy fails, whatever the error says', async () => {
    // `ENOSPC` part way through: the disk filled after the room was found.
    // Ours, and thrown with its code, which a route answers `507`.
    const source = join(sources, 'aventura.db');
    withUnsavedFrames(source);
    const noRoom = (): Promise<FileCopyOutcome> =>
      Promise.reject(Object.assign(new Error('no space left on device'), { code: 'ENOSPC' }));

    await expect(
      snapshotDatabase(
        layout,
        { kind: 'path', path: source },
        { run: vacuumCannotOpen, copy: noRoom },
      ),
    ).rejects.toMatchObject({ code: 'ENOSPC' });
    expect(await scratchEntries()).toEqual([]);
  });
});

describe('room first', () => {
  /**
   * ***Found at review, 2026-09-29*** — `backup/archive.ts`'s rule of
   * 2026-09-27, which this had not followed: a copy the size of somebody's
   * whole install was written into the data volume without asking whether it
   * fitted, and a full disk is what stops the server saving turns.
   */
  const reporting = (free: number | null) => (): Promise<number | null> => Promise.resolve(free);

  it('refuses before anything is written, with the numbers', async () => {
    const source = join(sources, 'aventura.db');
    withUnsavedFrames(source);
    const size = (await stat(source)).size;
    const wal = (await stat(`${source}-wal`)).size;
    const free = SNAPSHOT_FREE_RESERVE_BYTES;

    const byPath = await snapshotDatabase(
      layout,
      { kind: 'path', path: source },
      { freeBytes: reporting(free) },
    ).catch((error: unknown) => error);
    expect(byPath).toBeInstanceOf(SnapshotSpaceError);
    // The file, its log twice — copied, then folded in — and the reserve.
    expect(byPath).toMatchObject({ needed: free + size + 2 * wal, free });

    const database = await readFile(source);
    const log = await readFile(`${source}-wal`);
    const byBytes = await snapshotDatabase(
      layout,
      { kind: 'bytes', database, wal: log },
      { freeBytes: reporting(free) },
    ).catch((error: unknown) => error);
    expect(byBytes).toMatchObject({ needed: free + database.length + 2 * log.length, free });

    // Refused before a space was even opened.
    expect(await scratchEntries()).toEqual([]);
  });

  it('counts only what the check adds to a file the caller owns', async () => {
    // P13.8 found the room for its landing; a landing with no log adds
    // nothing, and one with a log adds what folding it in can.
    const source = join(sources, 'aventura.db');
    withUnsavedFrames(source);

    const bare = await openImportScratch(layout);
    await copyFile(source, bare.path('landed.db'));
    const noLog = await snapshotDatabase(
      layout,
      { kind: 'owned', space: bare, name: 'landed.db' },
      { freeBytes: reporting(0) },
    );
    expect(noLog.ok).toBe(true);
    if (noLog.ok) await noLog.dispose();

    const logged = await openImportScratch(layout);
    await copyFile(`${source}-wal`, logged.path('landed.db-wal'));
    await copyFile(source, logged.path('landed.db'));
    await expect(
      snapshotDatabase(
        layout,
        { kind: 'owned', space: logged, name: 'landed.db' },
        { freeBytes: reporting(0) },
      ),
    ).rejects.toBeInstanceOf(SnapshotSpaceError);
    // The space was the snapshot's, so the snapshot removed it.
    expect(await scratchEntries()).toEqual([]);
  });

  it('goes ahead on a filesystem that will not say', async () => {
    const source = join(sources, 'aventura.db');
    withUnsavedFrames(source);

    const snapshot = await snapshotDatabase(
      layout,
      { kind: 'path', path: source },
      { freeBytes: reporting(null) },
    );

    expect(snapshot.ok).toBe(true);
    if (snapshot.ok) await snapshot.dispose();
  });
});

/**
 * ***The real read-only mount*** — the case the copy route exists for,
 * measured rather than simulated: a directory SQLite may not write, holding a
 * `-wal` and no `-shm`. A read-only open cannot build the index there and
 * fails; since 2026-09-29 the snapshot does not try, because a read-only open
 * of such a database on a directory it *can* write would leave a `-shm`
 * behind — and the copy is what either way comes to.
 *
 * **Skipped as root and on Windows**, and the seams are why the proof does
 * not depend on it. Root reads and writes through every permission bit, which
 * is what a container's user usually is, so the open does not fail there; and
 * Windows has no read-only directories in the sense SQLite would notice.
 */
const unprivileged = process.platform !== 'win32' && process.getuid?.() !== 0;

describe.skipIf(!unprivileged)('on a read-only mount', () => {
  it('copies the database and its log', async () => {
    const source = join(sources, 'aventura.db');
    withUnsavedFrames(source);
    const mount = join(root, 'mount');
    await mkdir(mount);
    await copyFile(`${source}-wal`, join(mount, 'aventura.db-wal'));
    await copyFile(source, join(mount, 'aventura.db'));
    await chmod(mount, 0o555);

    try {
      const snapshot = await snapshotDatabase(layout, {
        kind: 'path',
        path: join(mount, 'aventura.db'),
      });

      expect(snapshot.ok).toBe(true);
      if (!snapshot.ok) return;
      expect(snapshot.route).toBe('copy');
      expect(idsIn(snapshot.path)).toEqual(['saved', 'unsaved']);
      expect(snapshot.notes).toEqual([WAL_NOTE]);
      await snapshot.dispose();
    } finally {
      await chmod(mount, 0o755);
    }
  });

  it('refuses a log it may not read, rather than leaving it out', async () => {
    // The real permission, where the seam test above stands in for it: the
    // copy of the log fails on the source's side, and the file alone would be
    // a quietly older database.
    const source = join(sources, 'aventura.db');
    withUnsavedFrames(source);
    const mount = join(root, 'mount');
    await mkdir(mount);
    await copyFile(`${source}-wal`, join(mount, 'aventura.db-wal'));
    await copyFile(source, join(mount, 'aventura.db'));
    await chmod(join(mount, 'aventura.db-wal'), 0o000);

    try {
      expect(
        await snapshotDatabase(layout, { kind: 'path', path: join(mount, 'aventura.db') }),
      ).toEqual(UNREADABLE);
      expect(await scratchEntries()).toEqual([]);
    } finally {
      await chmod(join(mount, 'aventura.db-wal'), 0o644);
    }
  });
});

describe('nothing is left behind', () => {
  async function everyRoute(): Promise<SnapshotInput[]> {
    const source = join(sources, 'aventura.db');
    withUnsavedFrames(source);
    const space = await openImportScratch(layout);
    await copyFile(source, space.path('landed.db'));
    return [
      { kind: 'path', path: source },
      { kind: 'bytes', database: await readFile(source), wal: await readFile(`${source}-wal`) },
      { kind: 'owned', space, name: 'landed.db' },
    ];
  }

  it('dispose removes the copy and whatever was made beside it, by every route', async () => {
    const inputs = await everyRoute();
    const taken = [];
    for (const input of inputs) taken.push(await snapshotDatabase(layout, input));
    taken.push(
      await snapshotDatabase(
        layout,
        { kind: 'path', path: join(sources, 'aventura.db') },
        { run: vacuumCannotOpen },
      ),
    );

    for (const snapshot of taken) {
      expect(snapshot.ok).toBe(true);
      if (!snapshot.ok) continue;
      // What SQLite makes beside a database when somebody opens it — which the
      // reader will — under names nobody here chose.
      for (const side of ['-wal', '-shm', '-journal']) {
        await writeFile(`${snapshot.path}${side}`, 'made by whoever opened it');
      }
      await snapshot.dispose();
      // Twice is fine: a reader's `close()` may run from more than one path.
      await snapshot.dispose();
    }
    expect(await scratchEntries()).toEqual([]);
  });

  it('removes everything when the worker itself fails, by every route', async () => {
    const broken = (): Promise<SnapshotTaskOutcome> =>
      Promise.reject(new Error('the worker could not start'));

    for (const input of await everyRoute()) {
      await expect(snapshotDatabase(layout, input, { run: broken })).rejects.toThrow(
        'the worker could not start',
      );
    }
    expect(await scratchEntries()).toEqual([]);
  });

  it('starts the fallback in a space of its own, whatever a failed VACUUM INTO left', async () => {
    /**
     * ***Found at review, 2026-09-29***: no test left anything behind a failed
     * `VACUUM INTO`, so the clean-up could have gone unnoticed. Here the
     * attempt leaves most of a database, a `-journal` SQLite would read as
     * hot, and a name nobody here chose; the copy is made in a fresh space,
     * and the failed one is gone.
     */
    const source = join(sources, 'aventura.db');
    withUnsavedFrames(source);
    const leavesAMess = async (task: SnapshotTask): Promise<SnapshotTaskOutcome> => {
      if (task.op !== 'vacuum') return runInWorker(task);
      for (const name of [task.target, `${task.target}-journal`, `${task.target}-wal`]) {
        await writeFile(name, 'what a VACUUM INTO that failed part way left');
      }
      return { ok: false, message: 'unable to open database file', errcode: 14 };
    };

    const snapshot = await snapshotDatabase(
      layout,
      { kind: 'path', path: source },
      { run: leavesAMess },
    );

    expect(snapshot.ok).toBe(true);
    if (!snapshot.ok) return;
    expect(await readdir(dirname(snapshot.path))).toEqual(['copy.sqlite']);
    expect(await scratchEntries()).toEqual([basename(dirname(snapshot.path))]);
    expect(idsIn(snapshot.path)).toEqual(['saved', 'unsaved']);
    await snapshot.dispose();
    expect(await scratchEntries()).toEqual([]);
  });
});

describe('copySourceFile', () => {
  it('copies every byte, and blames each failure on the side it happened on', async () => {
    /**
     * ***Found at review, 2026-09-29***: `copyFile` was one call for both
     * ends, and an error from either was read as the source's — so a fault on
     * our own disk came back as `unreadable-root`. Missing and unreadable are
     * the source's, and answered; a target that cannot be written is ours, and
     * thrown.
     */
    const from = join(sources, 'several-chunks.bin');
    const bytes = new Uint8Array(2.5 * 1024 * 1024).map((_, at) => at % 251);
    await writeFile(from, bytes);
    const space = await openImportScratch(layout);

    expect(await copySourceFile(from, space.path('copy.bin'))).toBe('copied');
    expect(await sha(space.path('copy.bin'))).toBe(await sha(from));
    expect(await copySourceFile(join(sources, 'missing.db'), space.path('gone.bin'))).toBe('gone');
    expect(await copySourceFile(sources, space.path('directory.bin'))).toBe('unreadable');
    await expect(copySourceFile(from, space.path('copy.bin'))).rejects.toMatchObject({
      code: 'EEXIST',
    });
    await space.dispose();
  });
});

describe('runInWorker, when the worker itself fails', () => {
  /**
   * ***Found at review, 2026-09-29***: every worker failure was a seam that
   * rejected, so the worker's own `error` and `exit` handling never ran, and
   * a worker that exited without answering could have hung the import. Each
   * way a worker can fail, for real.
   */
  const task: SnapshotTask = { op: 'check', path: '/nowhere/copy.sqlite' };
  const module = (source: string): URL =>
    new URL(`data:text/javascript,${encodeURIComponent(source)}`);

  it('rejects when the module cannot be loaded', async () => {
    await expect(
      runInWorker(task, new URL('./no-such-snapshot-worker.js', import.meta.url)),
    ).rejects.toThrow();
  });

  it('rejects when the module throws', async () => {
    await expect(
      runInWorker(task, module('throw new Error("a worker that broke")')),
    ).rejects.toThrow('a worker that broke');
  });

  it('rejects, rather than waiting for ever, when it exits without answering', async () => {
    await expect(runInWorker(task, module(''))).rejects.toThrow(/without answering/);
  });
});

describe('looksLikeSqlite', () => {
  it('reads the sixteen-byte header and nothing else', () => {
    const header = new TextEncoder().encode('SQLite format 3\0');
    expect(looksLikeSqlite(header)).toBe(true);
    expect(looksLikeSqlite(header.subarray(0, 15))).toBe(false);
    expect(looksLikeSqlite(new TextEncoder().encode('SQLite format 2\0'))).toBe(false);
    expect(looksLikeSqlite(new Uint8Array(0))).toBe(false);
  });
});
