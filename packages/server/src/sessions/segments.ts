// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { appendLine, ensureDirectory, listEntryNames, readFileBytes } from '../storage/files.js';
import { resolveWithin } from '../storage/paths.js';
import type { Turn } from './types.js';

/**
 * Append-only turn segments — [03 §5.5](../../../../docs/design/03-data-model.md).
 *
 * ```
 * sessions/<id>/
 *   session.json
 *   turns/000001.jsonl … 000014.jsonl     # append-only, never rewritten
 * ```
 *
 * **Not one file per turn** (thousands of small files for a long campaign) and
 * **not one growing document** (rewritten on every turn). Segments roll on
 * whichever limit is reached first, a turn count or a byte size.
 *
 * ## File order is creation order; reading order is a tree walk
 *
 * The decision that makes branching a non-issue for storage, and it points the
 * opposite way to the instinct. Turns form a tree, and the tempting move is to
 * make storage resemble it — per-branch files, or segments kept in reading
 * order. That is exactly where reconstructing the primary thread of a long,
 * repeatedly branched session becomes hard.
 *
 * So turns append in creation order whatever branch they belong to, and a
 * segment is never touched again. Reading a path walks `parentTurnId` from the
 * head and resolves each id to a location. What that buys: branching costs
 * nothing in the write path, segments stay immutable and therefore rsync- and
 * backup-friendly, and a corrupted segment loses a bounded window rather than a
 * session.
 *
 * ## Removal is designed in, not retrofitted
 *
 * A removed turn is a **tombstone the reader skips**. Nothing removes turns at
 * 1.0, but pruning a branch subtree does, and retrofitting deletion into a
 * format that assumed pure append is a migration rather than a feature.
 */

/** Where a turn lives, which is what the index stores. */
export interface TurnLocation {
  /** `000001` — the segment's number, zero-padded as on disk. */
  segment: string;
  /** Line offset within the segment, from zero. */
  offset: number;
}

export interface SegmentLimits {
  /** Roll after this many turns in a segment. */
  maxTurns: number;
  /** Roll once a segment is at least this many bytes. */
  maxBytes: number;
}

/**
 * Deliberately modest. A segment is a *window*, and the cost of a small one is
 * more files while the cost of a large one is a bigger loss when one is
 * corrupted and a slower cold read.
 */
export const DEFAULT_LIMITS: SegmentLimits = { maxTurns: 200, maxBytes: 4 * 1024 * 1024 };

const SEGMENT_DIGITS = 6;

function segmentName(number: number): string {
  return String(number).padStart(SEGMENT_DIGITS, '0');
}

function segmentFile(turnsRoot: string, segment: string): string {
  return resolveWithin(turnsRoot, `${segment}.jsonl`);
}

/** The segments on disk, in creation order. */
export async function listSegments(turnsRoot: string): Promise<string[]> {
  const names = await listEntryNames(turnsRoot);
  return names
    .filter((name) => /^\d+\.jsonl$/.test(name))
    .map((name) => name.replace(/\.jsonl$/, ''))
    .sort();
}

/**
 * Appends a turn, rolling to a new segment when the current one is full.
 *
 * **The caller serialises.** Two appends to one session must not interleave, and
 * that is the session's write queue rather than this function's business — the
 * same `KeyedQueue` the library write path uses, for the same reason.
 */
export async function appendTurn(
  turnsRoot: string,
  turn: Turn,
  limits: SegmentLimits = DEFAULT_LIMITS,
): Promise<TurnLocation> {
  await ensureDirectory(turnsRoot);

  const segments = await listSegments(turnsRoot);
  let segment = segments.at(-1) ?? segmentName(1);
  let existing = await readSegmentLines(turnsRoot, segment);

  const full = existing.length >= limits.maxTurns || byteLength(existing) >= limits.maxBytes;
  if (full) {
    segment = segmentName(Number(segment) + 1);
    existing = [];
  }

  // Through the storage package rather than reaching for `fs` here: one audited
  // door, which is the rule sessions are as subject to as the library. And an
  // *append* rather than the atomic writer, because a segment is append-only —
  // see `appendLine` for that trade.
  await appendLine(segmentFile(turnsRoot, segment), `${JSON.stringify(turn)}\n`);

  return { segment, offset: existing.length };
}

/** Every line of a segment, undecoded. */
async function readSegmentLines(turnsRoot: string, segment: string): Promise<string[]> {
  const bytes = await readFileBytes(segmentFile(turnsRoot, segment));
  if (bytes === null) return [];
  const text = new TextDecoder().decode(bytes);
  return text.split('\n').filter((line) => line.length > 0);
}

function byteLength(lines: string[]): number {
  return lines.reduce((sum, line) => sum + line.length + 1, 0);
}

/**
 * The turn at a location, or null.
 *
 * A line that does not parse is null rather than an exception: a segment is the
 * one file a crash can leave half-written, and one bad line at the tail must
 * not make the turns before it unreadable.
 */
export async function readTurnAt(turnsRoot: string, location: TurnLocation): Promise<Turn | null> {
  const lines = await readSegmentLines(turnsRoot, location.segment);
  const line = lines[location.offset];
  if (line === undefined) return null;
  return parseTurn(line);
}

function parseTurn(line: string): Turn | null {
  try {
    const value: unknown = JSON.parse(line);
    if (typeof value !== 'object' || value === null) return null;
    const turn = value as Turn;
    return typeof turn.id === 'string' ? turn : null;
  } catch {
    return null;
  }
}

/**
 * Every turn in the session, in creation order, with its location.
 *
 * This is the cold read — a rebuild, or a session whose index rows are gone.
 * The hot read is *"the last N turns of the current path"*, which
 * {@link walkPath} answers from the index instead.
 */
export async function readAllTurns(
  turnsRoot: string,
): Promise<{ turn: Turn; location: TurnLocation }[]> {
  const found: { turn: Turn; location: TurnLocation }[] = [];

  for (const segment of await listSegments(turnsRoot)) {
    const lines = await readSegmentLines(turnsRoot, segment);
    for (const [offset, line] of lines.entries()) {
      const turn = parseTurn(line);
      // A tombstone is skipped by the reader rather than removed from the file.
      if (turn !== null && turn.removed !== true) {
        found.push({ turn, location: { segment, offset } });
      }
    }
  }

  return found;
}

/**
 * The path from a head turn back to the root, oldest first.
 *
 * The tree structure lives in the records, not in the layout: this is the walk
 * that makes it so. A missing parent stops the walk rather than throwing — a
 * pruned subtree or a half-written segment should shorten history, not make it
 * unreadable.
 */
export function walkPath(turns: Map<string, Turn>, headTurnId: string | null): Turn[] {
  const path: Turn[] = [];
  const seen = new Set<string>();

  let at = headTurnId;
  while (at !== null) {
    const turn = turns.get(at);
    if (turn === undefined || seen.has(turn.id)) break;
    seen.add(turn.id);
    path.push(turn);
    at = turn.parentTurnId;
  }

  return path.reverse();
}
