// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import type { DatabaseSync } from 'node:sqlite';

import type { TurnLocation } from '../sessions/segments.js';
import type { SessionFile, Turn } from '../sessions/types.js';
import { inTransaction } from '../storage/transaction.js';
import { clearLinks, writeLinks } from './links.js';

/**
 * Sessions and turns in the index — [19 §7.1](../../../../docs/design/19-tech-stack.md),
 * [P2 §2.3](../../../../docs/design/workplan/08-p2-implementation.md).
 *
 * Two jobs, and it is worth being clear that they are different. The **turn
 * row** is a location — turn id to `(segment, offset)` — which is what makes
 * reading the last twenty turns of a long session a query instead of a walk
 * through every segment on disk. The **FTS row** is the text, indexed on write
 * rather than lazily, because a lazy index is one that is empty exactly when
 * somebody first searches.
 *
 * Both are derived. `session.json` and the segments are the truth; deleting
 * `index.sqlite` costs a rescan and nothing else
 * ([21 §5](../../../../docs/design/21-internal-contracts.md)), which is why the rebuild scans
 * sessions too and why the CI gate holds the two producers to one answer.
 */

export interface SessionRow {
  sessionId: string;
  owner: string;
  name: string;
  headTurnId: string | null;
  archived: boolean;
  updatedAt: string;
}

export interface TurnHit {
  turnId: string;
  sessionId: string;
  sessionName: string;
  segment: string;
  offset: number;
  /**
   * ***The matched text, which is what makes a hit worth returning*** —
   * [10 §14.1](../../../../docs/design/10-ui-surfaces.md),
   * [P11.1](../../../../docs/design/workplan/28-p11-implementation.md).
   *
   * §14.1 asks for *"results as a list of turns with a snippet"* and this index
   * returned a turn id. **At six hundred turns the difference is the whole
   * feature**: a list of nine dates is a list of nine things to open, which is
   * the scrolling §14 exists to prevent wearing a different shape. §14.5 makes
   * the same complaint about lore entries in so many words — *"close to
   * useless at book scale"* — and that half was paid at P5.2 while this one was
   * not.
   *
   * *No markers around the match.* `lore_entry_fts` passes empty strings for
   * `snippet`'s open and close arguments and this does the same, because the
   * text goes into a React child rather than into `innerHTML`: a marker would
   * have to be parsed back out, and parsing markers out of prose that may
   * legitimately contain them is how an excerpt starts lying about the story.
   */
  snippet: string;
}

/**
 * The text of a turn, for the search index.
 *
 * Input and output, joined — the two fields a person would expect to find by
 * searching for something they remember reading or typing. Deliberately *not*
 * the assembled blocks or the system prompt: those are in the record for
 * inspection, and a search that matched them would return a hit for every turn
 * in the session the moment a lorebook entry mentioned the word.
 */
export function turnText(turn: Turn): string {
  return [turn.input?.text, turn.output?.text].filter((text) => Boolean(text)).join('\n');
}

export function indexSession(db: DatabaseSync, owner: string, session: SessionFile): void {
  db.prepare(
    `insert into session (session_id, owner, name, head_turn_id, archived, updated_at)
       values (?, ?, ?, ?, ?, ?)
       on conflict(session_id) do update set owner = excluded.owner,
                                             name = excluded.name,
                                             head_turn_id = excluded.head_turn_id,
                                             archived = excluded.archived,
                                             updated_at = excluded.updated_at`,
  ).run(
    session.id,
    owner,
    session.name,
    session.headTurnId,
    session.archivedAt === undefined ? 0 : 1,
    session.updatedAt,
  );

  /**
   * ***What this session uses*** — [03 §10.1], [10 §5.2], [P11.7].
   *
   * The cast it plays with and the lorebooks it selected, which is what
   * *referenced by 12 sessions* counts. **Its pack is not in the list**, and
   * that is a fact about the record rather than an omission: a session's preset
   * is **embedded**, not referenced — [P7B.2] made it the session's own copy so
   * that editing one does not reach into a library object — so there is nothing
   * pointed at to count.
   *
   * *An archived session still counts*, on [03 §10.3]'s rule that archiving
   * hides from a list rather than removing: telling somebody an actor is unused
   * when four archived sessions are built on them is the same lie a search that
   * skipped archives would tell.
   */
  writeLinks(db, { kind: 'session', id: session.id, name: session.name, owner }, [
    ...(session.cast?.persona === null || session.cast?.persona === undefined
      ? []
      : [session.cast.persona]),
    ...(session.cast?.actors ?? []),
    ...(session.lore ?? []),
  ]);
}

/**
 * Indexes one turn — its location and its text, in one transaction.
 *
 * Together for the same reason the operational store sequences an event with the
 * draft change it describes: a turn that is locatable but unsearchable, or
 * searchable but unlocatable, is a state no reader knows how to handle, and
 * there is no reason to allow it to exist.
 *
 * ***The session is the folder's, not the turn's own field*** (2026-09-27).
 * `segment` and `offset` say where the turn is, and they are only true of the
 * session whose `turns/` holds it, so the id beside them has to be that one.
 * It was `turn.sessionId`, and an imported session's turns still named the
 * session they were exported from: the rows went under an id this install did
 * not have, and the imported story could not be searched. A rebuild now files
 * such a turn where it lives.
 */
export function indexTurn(
  db: DatabaseSync,
  sessionId: string,
  turn: Turn,
  location: TurnLocation,
): void {
  inTransaction(db, () => {
    db.prepare(
      `insert into turn (turn_id, session_id, segment, offset)
         values (?, ?, ?, ?)
         on conflict(turn_id) do update set session_id = excluded.session_id,
                                            segment = excluded.segment,
                                            offset = excluded.offset`,
    ).run(turn.id, sessionId, location.segment, location.offset);

    // FTS5 has no upsert, so a reindex of the same turn is a delete and an
    // insert. Cheap, and it keeps a re-run of the same append — which the commit
    // protocol's idempotency makes an ordinary event — from leaving two rows
    // that both match.
    db.prepare('delete from turn_fts where turn_id = ?').run(turn.id);

    const text = turnText(turn);
    if (text.length > 0) {
      db.prepare('insert into turn_fts (turn_id, session_id, text) values (?, ?, ?)').run(
        turn.id,
        sessionId,
        text,
      );
    }
  });
}

/** Everything the index holds about a session. Called when its folder goes. */
export function removeSessionRows(db: DatabaseSync, sessionId: string): void {
  inTransaction(db, () => {
    db.prepare('delete from turn_fts where session_id = ?').run(sessionId);
    db.prepare('delete from turn where session_id = ?').run(sessionId);
    db.prepare('delete from session where session_id = ?').run(sessionId);
    // And what it pointed at — [P11.7]. A deleted session is not a user of
    // anything, and the count a delete confirmation shows is about now.
    clearLinks(db, 'session', sessionId);
  });
}

export function listSessionRows(
  db: DatabaseSync,
  owners: readonly string[],
  options: { includeArchived?: boolean } = {},
): SessionRow[] {
  if (owners.length === 0) return [];
  const placeholders = owners.map(() => '?').join(', ');
  const rows = db
    .prepare(
      `select session_id, owner, name, head_turn_id, archived, updated_at
         from session
        where owner in (${placeholders})${options.includeArchived === true ? '' : ' and archived = 0'}
        order by updated_at desc`,
    )
    .all(...owners) as {
    session_id: string;
    owner: string;
    name: string;
    head_turn_id: string | null;
    archived: number;
    updated_at: string;
  }[];

  return rows.map((row) => ({
    sessionId: row.session_id,
    owner: row.owner,
    name: row.name,
    headTurnId: row.head_turn_id,
    archived: row.archived === 1,
    updatedAt: row.updated_at,
  }));
}

/**
 * Full-text search over turns, scoped to the caller's sessions — F10.
 *
 * **The owner comes from the session row, not the turn row.** A turn knows its
 * session and a session knows its owner, so the join is what enforces
 * [09 §4.3](../../../../docs/design/09-server-multiuser-deployment.md)'s rule that a request
 * never reaches another user's data. Denormalising the owner onto the turn would
 * be faster and would give the rule two places to be wrong.
 *
 * Archived sessions **are** searched. They are hidden from the default list, not
 * gone ([03 §10.3]), and a search that skipped them would turn archiving into a
 * quiet way of losing things.
 */
export function searchTurns(
  db: DatabaseSync,
  owners: readonly string[],
  term: string,
  limit = 50,
): TurnHit[] {
  if (owners.length === 0 || term.trim() === '') return [];
  const placeholders = owners.map(() => '?').join(', ');

  const rows = db
    .prepare(
      // The FTS table is named rather than aliased, for `query.ts`'s reason:
      // neither `match` nor `snippet`'s first argument resolves through an
      // alias.
      `select turn.turn_id, turn.session_id, turn.segment, turn.offset,
              session.name as session_name,
              snippet(turn_fts, -1, '', '', '…', 20) as snippet
         from turn_fts
         join turn on turn.turn_id = turn_fts.turn_id
         join session on session.session_id = turn.session_id
        where turn_fts match ? and session.owner in (${placeholders})
        order by rank limit ?`,
    )
    .all(term, ...owners, limit) as {
    turn_id: string;
    session_id: string;
    segment: string;
    offset: number;
    session_name: string;
    snippet: string;
  }[];

  return rows.map((row) => ({
    turnId: row.turn_id,
    sessionId: row.session_id,
    sessionName: row.session_name,
    segment: row.segment,
    offset: row.offset,
    snippet: row.snippet,
  }));
}

/**
 * One turn's location, scoped to its owner — [P3.0], the query the location
 * index existed for and never had. The header's promise — *"reading … a
 * query instead of a walk through every segment on disk"* — had exactly zero
 * by-id readers until the workbench's read-a-turn route.
 *
 * **The owner comes from the session row, not the turn row** — the same join
 * `searchTurns` draws and for the same reason ([09 §4.3]): denormalising the
 * owner onto the turn would give the rule two places to be wrong.
 */
export function findTurnLocation(
  db: DatabaseSync,
  turnId: string,
): { sessionId: string; owner: string; segment: string; offset: number } | null {
  const row = db
    .prepare(
      `select turn.session_id, session.owner, turn.segment, turn.offset
         from turn
         join session on session.session_id = turn.session_id
        where turn.turn_id = ?`,
    )
    .get(turnId) as
    { session_id: string; owner: string; segment: string; offset: number } | undefined;

  if (row === undefined) return null;
  return {
    sessionId: row.session_id,
    owner: row.owner,
    segment: row.segment,
    offset: row.offset,
  };
}

/**
 * The session already holding any of these turns, or null.
 *
 * ***A turn id is one row on the whole install***, which is what `turn`'s
 * primary key says, and what an import has to ask before it keeps a session's
 * turn ids ([P11.10]'s decision). A second session holding the same turns
 * would take the first one's rows at every append: its search hits, its
 * locations, and on deletion the rows themselves. Asked of the `turn` table
 * alone, without the `session` join, because a row is a claim whether or not
 * its session row is there.
 */
export function sessionHoldingTurns(db: DatabaseSync, turnIds: Iterable<string>): string | null {
  const find = db.prepare('select session_id from turn where turn_id = ?');
  for (const turnId of turnIds) {
    const row = find.get(turnId) as { session_id: string } | undefined;
    if (row !== undefined) return row.session_id;
  }
  return null;
}

/**
 * A deterministic dump of the session half of the index, for the CI gate.
 *
 * The same discipline as the object snapshot: content only. What must agree
 * between a rebuild and an incrementally maintained index is which sessions and
 * turns exist, where each turn lives, and what text it carries.
 */
export function sessionSnapshot(db: DatabaseSync): string[] {
  const sessions = db
    .prepare(
      `select session_id, owner, name, head_turn_id, archived, updated_at
         from session order by session_id`,
    )
    .all() as Record<string, unknown>[];

  const turns = db
    .prepare(
      `select turn.turn_id, turn.session_id, turn.segment, turn.offset,
              coalesce(turn_fts.text, '') as text
         from turn left join turn_fts on turn_fts.turn_id = turn.turn_id
        order by turn.turn_id`,
    )
    .all() as Record<string, unknown>[];

  return [
    ...sessions.map((row) => `session\t${Object.values(row).map(String).join('\t')}`),
    ...turns.map((row) => `turn\t${Object.values(row).map(String).join('\t')}`),
  ];
}
