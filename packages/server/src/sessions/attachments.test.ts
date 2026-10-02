// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readdir, rm, symlink, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { crc32, deflateSync } from 'node:zlib';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { TurnAttachment } from '@storyengine/shared';

import { statFile } from '../storage/files.js';
import { Layout } from '../storage/layout.js';
import { PathEscapeError } from '../storage/paths.js';
import {
  attachmentsAgain,
  attachmentsFor,
  presentAttachments,
  readAttachment,
  type StoredAttachment,
  storeAttachment,
  sweepAttachments,
  UNSENT_GRACE_MS,
} from './attachments.js';

/**
 * ***The store behind a picture on a move*** — [25 E15](../../../../docs/design/25-open-questions.md),
 * R1: `sessions/<id>/attachments/<sha256 hex>.<ext>`.
 *
 * `routes/attachments.test.ts` walks the whole path — upload, turn, redo,
 * backup — and in doing so can only ever see a picture that is minutes old,
 * because that is all a test that goes through the routes can make. Every rule
 * in this module that matters is a rule about *age*: what the sweep may collect,
 * and which acts count as somebody wanting a picture today. So these tests go
 * underneath the routes, where a file's mtime can be put a day in the past and
 * the sweep asked what it makes of that.
 *
 * ***The regression the 2026-09-27 change exists for is the first test.*** A
 * picture uploaded more than a day ago and uploaded again today changed nothing
 * on disk — content addressing said the file was already there — so the sweep
 * the second upload runs deleted it as a day-old file nothing named. The upload
 * answered `201`, and the move that named it was refused as a picture this
 * session never had.
 *
 * *No `session.json` is written*: nothing in this module reads one. The route
 * checks the session exists before it stores; the store itself asks only where
 * the session's folder is and whether that folder is really there.
 */

const HANDLE = 'ned';
const SESSION = '0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a55';
const HOUR = 60 * 60 * 1000;

let dataDir: string;
let layout: Layout;

beforeEach(async () => {
  dataDir = await mkdtemp(join(tmpdir(), 'se-attachments-'));
  layout = new Layout(dataDir);
  await mkdir(layout.sessionRoot(HANDLE, SESSION), { recursive: true });
});

afterEach(async () => {
  await rm(dataDir, { recursive: true, force: true });
});

/**
 * A real PNG, built from its three chunks: solid grey, `width` by `height`.
 *
 * *Built rather than inlined*, for two reasons. The store is content-addressed,
 * so two pictures are two files only if their bytes differ, and a test that
 * needs an abandoned picture beside a named one needs as many distinct pictures
 * as it has roles — the size is the easiest thing to vary. And the dimensions
 * the record should carry are then the ones written in the test, rather than a
 * fact about somebody's base64 that a reader has to take on trust.
 */
function picture(width: number, height: number): Uint8Array {
  const chunk = (type: string, data: Buffer): Buffer => {
    const head = Buffer.alloc(8);
    head.writeUInt32BE(data.length, 0);
    head.write(type, 4, 'ascii');
    const tail = Buffer.alloc(4);
    tail.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])), 0);
    return Buffer.concat([head, data, tail]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8; // bit depth
  header[9] = 0; // greyscale
  const row = Buffer.concat([Buffer.from([0]), Buffer.alloc(width, 0x80)]);
  const pixels = Buffer.concat(Array.from({ length: height }, () => row));
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(pixels)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/** A digest the store has never been given anything for. */
const UNKNOWN = `sha256:${'e'.repeat(64)}`;

/** Stores a picture, and fails the test rather than hand back `null`. */
async function store(bytes: Uint8Array): Promise<StoredAttachment> {
  const stored = await storeAttachment(layout, HANDLE, SESSION, bytes);
  if (stored === null) throw new Error('the store refused a picture this test built');
  return stored;
}

function folder(): string {
  return join(layout.sessionRoot(HANDLE, SESSION), 'attachments');
}

/** Where a stored picture lives. Every picture in this file is a PNG. */
function fileOf(stored: StoredAttachment): string {
  return join(folder(), nameOf(stored));
}

function nameOf(stored: StoredAttachment): string {
  return `${stored.digest.slice('sha256:'.length)}.png`;
}

async function mtimeOf(path: string): Promise<number> {
  const facts = await statFile(path);
  if (facts === null) throw new Error(`${path} is not there`);
  return facts.mtimeMs;
}

/**
 * Puts a file an hour past the sweep's grace — what a picture attached and
 * abandoned yesterday looks like.
 *
 * ***With node's own `utimes`, not `touchFile`***, although the latter takes a
 * date: `touchFile` is half of the behaviour under test, and a backdate made
 * through it would go quiet the day it stopped honouring `at` — every test here
 * would then be about minutes-old files, and would pass for that reason alone.
 * The assertion after it is the same guard stated outright: a test that relies
 * on a file being old checks that it is.
 */
async function age(path: string): Promise<void> {
  const past = new Date(Date.now() - UNSENT_GRACE_MS - HOUR);
  await utimes(path, past, past);
  expect(await mtimeOf(path)).toBeLessThan(Date.now() - UNSENT_GRACE_MS);
}

/** Renewed means *touched just now*: the backdate above is a whole day earlier. */
async function expectRenewed(path: string): Promise<void> {
  expect(await mtimeOf(path)).toBeGreaterThan(Date.now() - HOUR);
}

async function expectStillOld(path: string): Promise<void> {
  expect(await mtimeOf(path)).toBeLessThan(Date.now() - UNSENT_GRACE_MS);
}

const nothingNamed = (): Promise<ReadonlySet<string>> => Promise.resolve(new Set<string>());

describe('the sweep', () => {
  /**
   * ***The regression this change fixes.*** A picture first stored more than a
   * day ago, stored again, and swept straight after — which is exactly what the
   * upload route does, since every upload runs a sweep once its own bytes are
   * down.
   *
   * Before 2026-09-27 the second store found the file already there and wrote
   * nothing, so its mtime was still yesterday's and the sweep collected it: the
   * upload answered `201` and the move naming it was refused. The falsifying
   * mutation is a store that skips an existing file without renewing it —
   * `if (!(await fileExists(path))) await writeAtomic(path, bytes)` — which is
   * the obvious way to write content addressing and was the way it was written.
   *
   * *A second, abandoned picture is the control.* Aged the same way and never
   * uploaded again, it is what the sweep does with a day-old file nothing
   * names — so the one that survives survives because it was uploaded again,
   * and not because the sweep was never going to collect anything.
   */
  it('keeps a picture uploaded again after a day, through the sweep that upload runs', async () => {
    const bytes = picture(4, 3);
    const again = await store(bytes);
    const abandoned = await store(picture(2, 2));
    await age(fileOf(again));
    await age(fileOf(abandoned));

    const second = await store(bytes);
    expect(second).toEqual(again);
    await expectRenewed(fileOf(again));

    expect(await sweepAttachments(layout, HANDLE, SESSION, nothingNamed)).toBe(1);

    expect(await readdir(folder())).toEqual([nameOf(again)]);
    const read = await readAttachment(layout, HANDLE, SESSION, again.digest);
    expect(read?.mime).toBe('image/png');
    expect(Buffer.from(read?.bytes ?? []).equals(Buffer.from(bytes))).toBe(true);
  });

  /**
   * ***Both halves of the rule, and the names it is allowed to apply to.*** A
   * file goes only when it is past the grace *and* no turn names it; either
   * alone keeps it. The mutations: `||` for `&&` (the fresh one or the named
   * one goes), a comparison of the file name rather than the digest against
   * `referenced` (the named one goes, since the set holds `sha256:` digests and
   * the folder holds `<hex>.png`), and a sweep that deletes by age alone.
   *
   * ***And nothing that is not the store's own shape***, however old. A file
   * somebody put in the folder by hand is not this store's to collect — the
   * library learned this with `assets -> .`, where the listing became the
   * object folder — so `notes.txt`, a sixty-four-hex name with an extension the
   * store never writes, and a sixty-three-hex one are all old and all kept. A
   * sweep that tested the extension alone, or the hex alone, would take one of
   * them.
   */
  it('collects an old picture nothing names, and nothing else', async () => {
    const abandoned = await store(picture(1, 1));
    const fresh = await store(picture(2, 1));
    const named = await store(picture(3, 1));
    const strangers = ['notes.txt', `${'c'.repeat(64)}.gif`, `${'d'.repeat(63)}.png`];
    for (const name of strangers) await writeFile(join(folder(), name), 'by hand');
    for (const path of [
      fileOf(abandoned),
      fileOf(named),
      ...strangers.map((n) => join(folder(), n)),
    ]) {
      await age(path);
    }

    const removed = await sweepAttachments(layout, HANDLE, SESSION, () =>
      Promise.resolve(new Set([named.digest])),
    );

    expect(removed).toBe(1);
    expect((await readdir(folder())).sort()).toEqual(
      [nameOf(fresh), nameOf(named), ...strangers].sort(),
    );
  });

  /**
   * ***The turns are read only when something is old enough to go*** — the
   * library sweep's rule, and its reason: reading every segment of a long
   * session on every upload, to learn that nothing is past its grace, is the
   * uncommon case's cost paid every time.
   *
   * Three states that must not ask: a session with no `attachments` folder at
   * all, a folder whose pictures are all fresh, and a folder whose only old
   * file is one the sweep would never take — an old `notes.txt` is not
   * *something old enough to go*. Then one that must, and only once: the
   * mutation that reads the turns per candidate is as quiet as the one that
   * reads them unconditionally, and costs more.
   */
  it('reads the turns only when something is old enough to go', async () => {
    let asked = 0;
    const counting = (): Promise<ReadonlySet<string>> => {
      asked += 1;
      return Promise.resolve(new Set<string>());
    };

    expect(await sweepAttachments(layout, HANDLE, SESSION, counting)).toBe(0);
    expect(asked).toBe(0);

    const first = await store(picture(5, 5));
    const second = await store(picture(6, 5));
    await writeFile(join(folder(), 'notes.txt'), 'by hand');
    await age(join(folder(), 'notes.txt'));
    expect(await sweepAttachments(layout, HANDLE, SESSION, counting)).toBe(0);
    expect(asked).toBe(0);

    await age(fileOf(first));
    await age(fileOf(second));
    expect(await sweepAttachments(layout, HANDLE, SESSION, counting)).toBe(2);
    expect(asked).toBe(1);
  });

  /**
   * ***A picture renewed while the sweep reads the turns is kept.*** Reading
   * every segment is the slow part, and it is not under the session's lock, so
   * a re-upload or a submitted move can renew a picture the sweep has already
   * listed as old — and be told it succeeded. The renewal here happens inside
   * `referenced`, which is exactly that window. Deleting from the list made
   * before the read took the picture the move was about to send; the mutation
   * is dropping the second look before the unlink.
   */
  it('keeps a picture renewed while it reads the turns', async () => {
    const wanted = await store(picture(7, 7));
    const abandoned = await store(picture(8, 7));
    await age(fileOf(wanted));
    await age(fileOf(abandoned));

    const renewing = async (): Promise<ReadonlySet<string>> => {
      await store(picture(7, 7));
      return new Set<string>();
    };
    expect(await sweepAttachments(layout, HANDLE, SESSION, renewing)).toBe(1);

    expect(await readAttachment(layout, HANDLE, SESSION, wanted.digest)).not.toBeNull();
    expect(await readAttachment(layout, HANDLE, SESSION, abandoned.digest)).toBeNull();
  });

  /**
   * ***Something with a stored name that will not unlink is passed over***, not
   * the end of the sweep. A directory named like a picture is the case — put
   * there by hand, since this store writes only files — and the old pictures
   * listed after it in the folder must still go.
   */
  it('passes over an entry it cannot remove, and collects the rest', async () => {
    const old = await store(picture(9, 7));
    await age(fileOf(old));
    const stray = join(folder(), `${'0'.repeat(64)}.png`);
    await mkdir(stray);
    await age(stray);

    expect(await sweepAttachments(layout, HANDLE, SESSION, nothingNamed)).toBe(1);
    expect(await readAttachment(layout, HANDLE, SESSION, old.digest)).toBeNull();
    expect(await readdir(folder())).toContain(`${'0'.repeat(64)}.png`);
  });
});

/**
 * ***What a composer named, as the record will keep it*** —
 * {@link attachmentsFor}. The client names digests and captions and nothing
 * else; every other fact is read from this server's own store.
 */
describe('pictures a move names', () => {
  /**
   * ***A submission refuses a digest the store does not hold***, and says which
   * — the route answers `422 unknown-attachment` from it. The mutation is the
   * preview's rule applied to a submission: the unknown picture left out, and a
   * move sent without a picture somebody attached.
   *
   * *A string that is not a digest at all* is refused the same way rather than
   * thrown on, because it becomes a file name only through `candidatesFor`'s
   * pattern, and a caller that skipped the pattern would hand `resolveWithin` a
   * segment of the client's choosing.
   */
  it('refuses a submission naming a picture the store does not hold', async () => {
    const held = await store(picture(3, 2));

    expect(
      await attachmentsFor(
        layout,
        HANDLE,
        SESSION,
        [{ digest: held.digest }, { digest: UNKNOWN }],
        'submit',
      ),
    ).toEqual({ ok: false, digest: UNKNOWN });
    expect(
      await attachmentsFor(layout, HANDLE, SESSION, [{ digest: '../../accounts' }], 'submit'),
    ).toEqual({ ok: false, digest: '../../accounts' });
  });

  /**
   * ***The record holds what the store read***, `rewriteOf`'s *ids, not
   * claims*: type, size and dimensions from the bytes on disk, the caption
   * trimmed and dropped when nothing is left of it, and ids that are ordinals
   * of the list as sent — so the same picture named twice is two entries, `0`
   * and `2`, rather than one.
   *
   * Mutations: a caption kept untrimmed, an empty one recorded as `''`, the
   * width and height left off (the record's size is what R3's per-picture cost
   * will be computed from, and an export does not carry the bytes to read it
   * again), or ids minted from anything but the position.
   */
  it('records what the store read, with the caption trimmed and ids as ordinals', async () => {
    const harbour = await store(picture(3, 2));
    const lantern = await store(picture(5, 4));

    const read = await attachmentsFor(
      layout,
      HANDLE,
      SESSION,
      [
        { digest: harbour.digest, caption: '  the harbour at dusk \n' },
        { digest: lantern.digest },
        { digest: harbour.digest, caption: '   ' },
      ],
      'submit',
    );

    const facts = (stored: StoredAttachment) => ({
      digest: stored.digest,
      mime: 'image/png',
      bytes: stored.bytes,
    });
    expect(read).toEqual({
      ok: true,
      attachments: [
        {
          id: '0',
          kind: 'image',
          ...facts(harbour),
          width: 3,
          height: 2,
          caption: 'the harbour at dusk',
        },
        { id: '1', kind: 'image', ...facts(lantern), width: 5, height: 4 },
        { id: '2', kind: 'image', ...facts(harbour), width: 3, height: 2 },
      ],
    });
  });

  /**
   * ***Submitting a picture renews it***, so the sweep's day is counted from the
   * move that wants it. Between a submission and its commit nothing on disk
   * names the picture — the turn is still running — and another upload's sweep
   * in that window would otherwise see a day-old file nothing names.
   *
   * Checked twice: the mtime moves, and the sweep that follows keeps it with
   * nothing named. The mutation is a submission that only reads.
   */
  it('renews a submitted picture, so the sweep counts its day from the move', async () => {
    const held = await store(picture(3, 2));
    await age(fileOf(held));

    const read = await attachmentsFor(layout, HANDLE, SESSION, [{ digest: held.digest }], 'submit');
    expect(read.ok).toBe(true);

    await expectRenewed(fileOf(held));
    expect(await sweepAttachments(layout, HANDLE, SESSION, nothingNamed)).toBe(0);
  });

  /**
   * ***A preview leaves an unknown picture out, in place***, and writes
   * nothing.
   *
   * *Out rather than refused*, because a preview runs every time somebody
   * pauses typing, and a picture swept a moment ago is not a request worth a
   * `422`. *In place*, because the preview labels pictures as the turn will: the
   * pictures that remain keep the ids a submission of the same list would give
   * them. Named `[unknown, A, unknown, B]`, that is `1` and `3` — and a preview
   * that numbered what it kept would say `0` and `1`, and label the prompt it
   * shows with ids the turn will not have.
   *
   * *Writes nothing*: a preview promises it, and renewing on every keystroke
   * would make a picture that sits in a composer immortal without anybody ever
   * sending it. The mutation is a preview that renews.
   */
  it('leaves an unknown picture out of a preview in place, and renews nothing', async () => {
    const first = await store(picture(3, 2));
    const second = await store(picture(5, 4));
    await age(fileOf(first));
    await age(fileOf(second));

    const read = await attachmentsFor(
      layout,
      HANDLE,
      SESSION,
      [
        { digest: UNKNOWN },
        { digest: first.digest },
        { digest: `sha256:${'f'.repeat(64)}` },
        { digest: second.digest },
      ],
      'preview',
    );

    // Type and size, which a preview answers from the file's stat; dimensions
    // are a submission's to read, since a preview never records what it reads.
    expect(
      read.ok && read.attachments.map((one) => [one.id, one.digest, one.mime, one.bytes]),
    ).toEqual([
      ['1', first.digest, 'image/png', first.bytes],
      ['3', second.digest, 'image/png', second.bytes],
    ]);
    await expectStillOld(fileOf(first));
    await expectStillOld(fileOf(second));
  });
});

/**
 * ***A redo's pictures: the record's, as it stands*** — {@link attachmentsAgain}.
 *
 * Until 2026-09-27 a redo's client rebuilt the list from digest and caption and
 * the server re-minted it, which is lossless for every record this build writes
 * and lossy for every other. `routes/attachments.test.ts` pins the ordinary case
 * (a redo keeps a picture whose bytes did not travel); this pins the records
 * this build does not write, which is where re-minting lost things.
 */
describe('a redo’s pictures', () => {
  /**
   * One entry per way a re-mint loses something:
   *
   * - **a kind this build does not know**, kept as it is. Re-minted it became
   *   `image`, and a newer build's kind whose bytes happened to be here would
   *   then have gone to a model as pixels;
   * - **a picture recorded without a digest** — an importer that had no bytes —
   *   kept with its caption. Re-minted, it had nothing to name and was dropped;
   * - **a digest the store holds**, whose type, size and dimensions are read
   *   again from the bytes rather than trusted from the record — here recorded
   *   wrongly on purpose, so a copy that did not refresh would show;
   * - **an unknown kind whose bytes *are* here**, which is refreshed and still
   *   not made an `image`: the facts come from the bytes, the kind from the
   *   record;
   * - **a digest the store does not hold**, kept exactly as recorded, facts and
   *   all.
   *
   * *Ids that are not their positions*, `9` and `4` at the fourth and fifth
   * places, so a copy that re-minted ordinals would show as plainly as one that
   * dropped an entry. And both pictures whose bytes are here are renewed, for
   * the submission's reason: a redo is a move that wants them.
   */
  it('copies the record as it stands, and re-reads only what the bytes can say', async () => {
    const here = await store(picture(3, 2));
    const newer = await store(picture(7, 1));
    await age(fileOf(here));
    await age(fileOf(newer));

    const recorded: TurnAttachment[] = [
      { id: '0', kind: 'hologram', caption: 'x' },
      { id: '1', kind: 'image', caption: 'no bytes' },
      {
        id: '2',
        kind: 'image',
        digest: here.digest,
        mime: 'image/jpeg',
        bytes: 1,
        caption: 'here',
      },
      { id: '9', kind: 'hologram', digest: newer.digest, caption: 'from a newer build' },
      {
        id: '4',
        kind: 'image',
        digest: UNKNOWN,
        mime: 'image/webp',
        bytes: 99,
        width: 10,
        height: 20,
        caption: 'gone',
      },
    ];

    const again = await attachmentsAgain(layout, HANDLE, SESSION, recorded);

    expect(again).toEqual([
      { id: '0', kind: 'hologram', caption: 'x' },
      { id: '1', kind: 'image', caption: 'no bytes' },
      {
        id: '2',
        kind: 'image',
        digest: here.digest,
        mime: 'image/png',
        bytes: here.bytes,
        width: 3,
        height: 2,
        caption: 'here',
      },
      {
        id: '9',
        kind: 'hologram',
        digest: newer.digest,
        mime: 'image/png',
        bytes: newer.bytes,
        width: 7,
        height: 1,
        caption: 'from a newer build',
      },
      recorded[4],
    ]);
    await expectRenewed(fileOf(here));
    await expectRenewed(fileOf(newer));
  });
});

/**
 * ***A folder that leads out of the session*** (2026-09-27, the library's
 * same-day fix brought here). Every path in this module is spelled inside the
 * session, and the folder can still send it elsewhere: an `attachments` that
 * is a link to another account's session, or to the data root. The rule is
 * that *an escape is a picture this store does not have* — refused to a
 * store, absent to a read, and never swept.
 *
 * A junction rather than a symlink, as `paths.test.ts` explains: creating a
 * symlink on Windows needs elevation and a junction does not, and on POSIX node
 * makes an ordinary symlink, so this runs everywhere.
 */
describe('an attachments folder that leads somewhere else', () => {
  let outside: string;

  beforeEach(async () => {
    outside = await mkdtemp(join(tmpdir(), 'se-attachments-outside-'));
  });

  afterEach(async () => {
    await rm(outside, { recursive: true, force: true });
  });

  /**
   * ***Rooted at the session, not at `attachments/`*** — which is what this
   * test falsifies. A check rooted at the link resolves the root through the
   * link as well, so everything behind it is *inside* and every assertion here
   * goes the other way: the store writes into the stranger's folder, the read
   * serves a picture that was never uploaded to this session, and the sweep —
   * the one that matters — deletes an old file there that nothing in this
   * session names, because nothing in this session could.
   *
   * *The picture already out there is the sharpest case*: its bytes are what a
   * read of that digest would serve, and storing the same bytes would renew it
   * through the link.
   */
  it('is not written, read, reported or swept through', async () => {
    const theirs = picture(3, 2);
    const theirsName = `${digestHex(theirs)}.png`;
    const stranger = `${'b'.repeat(64)}.png`;
    await writeFile(join(outside, theirsName), theirs);
    await writeFile(join(outside, stranger), 'somebody else’s');
    await age(join(outside, stranger));
    await symlink(outside, folder(), 'junction');
    const before = (await readdir(outside)).sort();

    await expect(storeAttachment(layout, HANDLE, SESSION, picture(5, 4))).rejects.toBeInstanceOf(
      PathEscapeError,
    );
    await expect(storeAttachment(layout, HANDLE, SESSION, theirs)).rejects.toBeInstanceOf(
      PathEscapeError,
    );

    const digest = `sha256:${theirsName.slice(0, 64)}`;
    expect(await readAttachment(layout, HANDLE, SESSION, digest)).toBeNull();
    expect(await presentAttachments(layout, HANDLE, SESSION, [digest])).toEqual(new Set());

    let asked = 0;
    const removed = await sweepAttachments(layout, HANDLE, SESSION, () => {
      asked += 1;
      return Promise.resolve(new Set<string>());
    });
    expect(removed).toBe(0);
    expect(asked).toBe(0);
    expect((await readdir(outside)).sort()).toEqual(before);
    await expectStillOld(join(outside, stranger));
  });

  /**
   * ***And when the whole session folder is the link***, which a check rooted at
   * the session cannot see: the folder and its `attachments` move together, so
   * everything is inside it. That is `layout.assertReal` on the session root —
   * the data root's check — and the mutation is `realSession` without it, which
   * stores into, reads from and sweeps a folder outside the data directory.
   */
  it('is not written, read or swept through when the whole session leads outside', async () => {
    const root = layout.sessionRoot(HANDLE, SESSION);
    const moved = join(outside, SESSION);
    await mkdir(join(moved, 'attachments'), { recursive: true });
    const theirs = picture(3, 2);
    const theirsName = `${digestHex(theirs)}.png`;
    await writeFile(join(moved, 'attachments', theirsName), theirs);
    await age(join(moved, 'attachments', theirsName));
    await rm(root, { recursive: true, force: true });
    await symlink(moved, root, 'junction');

    await expect(storeAttachment(layout, HANDLE, SESSION, picture(5, 4))).rejects.toBeInstanceOf(
      PathEscapeError,
    );
    expect(
      await readAttachment(layout, HANDLE, SESSION, `sha256:${theirsName.slice(0, 64)}`),
    ).toBeNull();
    expect(await sweepAttachments(layout, HANDLE, SESSION, nothingNamed)).toBe(0);
    expect(await readdir(join(moved, 'attachments'))).toEqual([theirsName]);
  });

  /**
   * ***One picture that is a link out is skipped, and the sweep goes on.*** A
   * real folder with one entry in the store's own shape that leads to a file
   * somewhere else: it is not this store's, so it is neither collected nor
   * served — and it is *not a reason to stop collecting the rest*. The mutation
   * is a sweep that lets the per-name escape throw, which collects nothing at
   * all from then on (the route swallows a failed sweep, so nothing would say
   * so) and leaves every abandoned picture in the session for good.
   *
   * *A file link needs privileges on Windows*, which is why this one is skipped
   * there, as `watcher.test.ts`'s is: the code is the same on both, and the two
   * tests above hold the folder-level case everywhere.
   */
  it.skipIf(process.platform === 'win32')(
    'skips a picture that is a link out, and still collects the rest',
    async () => {
      const abandoned = await store(picture(1, 1));
      await age(fileOf(abandoned));
      const target = join(outside, 'theirs.png');
      await writeFile(target, picture(9, 9));
      await age(target);
      const linked = `${'a'.repeat(64)}.png`;
      await symlink(target, join(folder(), linked));

      expect(await sweepAttachments(layout, HANDLE, SESSION, nothingNamed)).toBe(1);

      expect(await readdir(folder())).toEqual([linked]);
      expect(await readdir(outside)).toEqual(['theirs.png']);
      expect(await readAttachment(layout, HANDLE, SESSION, `sha256:${'a'.repeat(64)}`)).toBeNull();
    },
  );
});

/**
 * The hex a picture would be stored under, computed the way the store does it
 * but without asking the store — the folder these tests put it in is one the
 * store must refuse to write to.
 */
function digestHex(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}
