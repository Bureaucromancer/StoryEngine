// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { PUBLISH_RECORD_SCHEMA, type PublishRecord } from '@storyengine/shared';

import { appendLine, readFileBytes } from '../storage/files.js';
import { KeyedQueue } from '../storage/keyed-queue.js';
import type { Layout } from '../storage/layout.js';

/**
 * ***The publish ledger*** — `users/<handle>/publishes.jsonl`,
 * [16 §5](../../../../docs/design/16-publish.md),
 * [16 §8](../../../../docs/design/16-publish.md), [P16.3d].
 *
 * **Why there is a ledger at all, when the review "writes one thing".** [16 §5]
 * says the review stages nothing and holds no copy, and that *the one write is
 * the World*; the same section says *re-publishing opens on the diff* — what
 * changed since the last file. A diff needs a record of the last file, and
 * the server holds no file: the bytes went to the person's browser and the
 * library re-resolves. So the plan reads §5's sentence as **one *library*
 * write** ([P16.3]'s plan, §5 D-doc1 — owed to 16 §5 as a dated note), and
 * this is the record, written on confirm and never by the review. It is also
 * where [16 §8]'s *how would we know this was wrong* gets its numbers — how
 * often a World is published, how often a row is unticked, a session ticked,
 * a snapshot taken — without a second write anywhere.
 *
 * ***`usage/log.ts`'s shape, exactly***: one file per account, append-only
 * JSON lines through `appendLine` (whose torn-tail repair means a crash costs
 * the newest line and never the next one), serialised per file on a
 * {@link KeyedQueue}, and an append that **never throws**. A record of what
 * happened is never rewritten, and a person can read it.
 *
 * ***Written when the download finished, not when the file was planned***
 * ([P16.3d]): the route appends on the response's `finish`, so a download the
 * person abandoned leaves no line. The cost is named in the plan's risk 15 — a
 * World kept by a publish whose download aborted reads as never published —
 * and is the right way round: a line for a file nobody received would make
 * the next diff compare against something the recipient never had.
 */

/** Appends serialised per file — `usage/log.ts`'s reason, and `history.ts`'s before it. */
const appends = new KeyedQueue();

/**
 * Records one publish. **Never throws.**
 *
 * *A decision, not an omission*, and `recordUsage`'s: by the time this runs the
 * file has been delivered, and there is nobody left to tell — the response is
 * finished. A lost line costs the next re-publish its diff baseline, which the
 * review then reads as a first publish; a disk that cannot take one line of
 * JSON is failing every other write the server makes, and will say so louder.
 */
export async function appendPublishRecord(
  layout: Layout,
  handle: string,
  record: PublishRecord,
): Promise<void> {
  try {
    const path = layout.publishLogFile(handle);
    await appends.run(path, () => appendLine(path, `${JSON.stringify(record)}\n`));
  } catch {
    // See the docstring: the file reached the person; its receipt is not
    // worth an unhandled rejection after the response has closed.
  }
}

/**
 * Every record, **newest first**, optionally only those of one World.
 *
 * ***What it skips, and why each is a skip rather than a failure***:
 *
 * - **A line that does not parse** — a torn last line, which `appendLine`
 *   leaves when a crash or a full disk interrupts it and closes off on the
 *   next append, or a person's half-finished hand edit.
 * - **A schema this build does not read** — a later build's
 *   `publish-record/2`, or anything else. Reading a format nobody has written
 *   yet as this one would be wrong in the quiet direction.
 * - **A line whose shape is not a record** — the fields a reader acts on
 *   (`at`, `origin`, `world`, the lists) missing or of the wrong type. A
 *   filter that read `record.world.id` from a hand-edited line would otherwise
 *   throw for the whole account.
 *
 * A file that is not there is no records. Any other failure to read it
 * throws: an unreadable account file is the server's fault, and answering
 * *never published* would make the next diff compare against nothing.
 */
export async function readPublishRecords(
  layout: Layout,
  handle: string,
  filter: { world?: string } = {},
): Promise<PublishRecord[]> {
  const bytes = await readFileBytes(layout.publishLogFile(handle));
  if (bytes === null) return [];
  const records: PublishRecord[] = [];
  for (const line of new TextDecoder().decode(bytes).split('\n')) {
    if (line.trim() === '') continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      continue;
    }
    if (!isPublishRecord(parsed)) continue;
    if (filter.world !== undefined && parsed.world?.id !== filter.world) continue;
    records.push(parsed);
  }
  // Appended in time order, so the file read backwards is newest first —
  // without trusting `at`, which a clock that moved back would reorder.
  return records.reverse();
}

/**
 * The newest record of a World — what a re-publish of it opens its diff
 * against ([P16.3h]) — or `null` when it has never been published from this
 * account. Created and existing alike: the publish that kept a World and the
 * ones made from it since are one history.
 */
export async function lastPublishOf(
  layout: Layout,
  handle: string,
  worldId: string,
): Promise<PublishRecord | null> {
  const [newest] = await readPublishRecords(layout, handle, { world: worldId });
  return newest ?? null;
}

const ORIGINS: ReadonlySet<unknown> = new Set(['object', 'selection', 'world']);

/**
 * ***Enough of a record to act on*** — the fields a reader filters, sorts or
 * iterates by. Not a full validation: a line this build wrote is whole, and a
 * field the diff reads and finds absent is the diff's to tolerate, as every
 * reader of a hand-editable file here does.
 */
function isPublishRecord(value: unknown): value is PublishRecord {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  if (record['schema'] !== PUBLISH_RECORD_SCHEMA) return false;
  if (typeof record['at'] !== 'string' || !ORIGINS.has(record['origin'])) return false;
  const world = record['world'];
  if (
    world !== null &&
    (typeof world !== 'object' || typeof (world as { id?: unknown }).id !== 'string')
  ) {
    return false;
  }
  return ['start', 'objects', 'sessions', 'unticked', 'ticked'].every((field) =>
    Array.isArray(record[field]),
  );
}
