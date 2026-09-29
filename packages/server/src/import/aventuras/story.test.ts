// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { DatabaseSync } from 'node:sqlite';

import { afterEach, describe, expect, it } from 'vitest';

import type { BranchRef, ImportNote, SessionExport, Turn } from '@storyengine/shared';

import {
  BLANK_PAGE,
  buildAventurasDatabase,
  LANTERN_FORK,
  QUIET_HARBOUR,
  STORIES,
  STORY_TREES,
  type AventurasDbOptions,
  type FixtureTree,
} from '../fixtures/test-aventuras-db.js';
import { aventurasPreflight, tablesIn } from './schema.js';
import { produceStory, type StoryProduction } from './story.js';
import { readStoryRows, type AventurasStoryRows } from './story-rows.js';

/**
 * ***The tree, and the pairing*** —
 * [P13.11](../../../../../docs/design/workplan/30-p13-aventuras-import.md),
 * [18 §2.3.1](../../../../../docs/design/18-session-import.md).
 *
 * The producer, from rows to document, with nothing written: each claim of
 * its header — the pairing table, the lineage rebuilt from the branches and
 * never from `parent_id`, the head, the fields and where each one goes, and
 * ids that are the same on every run — against the fixture's hand-written
 * stories, read out of a real database through `story-rows.ts` so the column
 * gate and the row reader are exercised with them. That the document survives
 * `importSession`, and what a sweep says about it, is the route test's
 * (`routes/import-aventuras-stories.test.ts`).
 */

let open: DatabaseSync[] = [];

afterEach(() => {
  for (const db of open) if (db.isOpen) db.close();
  open = [];
});

/** The fixture's database, in memory, with the tree stories unless the options say otherwise. */
function database(options: AventurasDbOptions = {}): DatabaseSync {
  const db = new DatabaseSync(':memory:');
  open.push(db);
  buildAventurasDatabase(db, { storyTrees: STORY_TREES, ...options });
  return db;
}

function rowsOf(db: DatabaseSync, story: { id: string }): AventurasStoryRows {
  const rows = readStoryRows(db, story.id, tablesIn(db));
  if (rows === null) throw new Error(`no story ${story.id}`);
  return rows;
}

const KEY = (story: { id: string }, handle = 'ned') => ({
  handle,
  origin: `aventura.db/stories/${story.id}`,
});

function produced(
  tree: FixtureTree,
  options: AventurasDbOptions = {},
): Extract<StoryProduction, { ok: true }> {
  const outcome = produceStory(rowsOf(database(options), tree), KEY(tree));
  if (!outcome.ok) throw new Error('expected a document');
  return outcome;
}

/** The turn whose `foreign.id` is this Aventuras entry — the answer, or a lone action. */
function turnFor(document: SessionExport, entryId: string, parentOf?: string | null): Turn {
  const found = document.turns.filter(
    (turn) =>
      turn.foreign?.id === entryId && (parentOf === undefined || turn.parentTurnId === parentOf),
  );
  if (found.length !== 1) throw new Error(`${String(found.length)} turns for ${entryId}`);
  return found[0]!;
}

function keys(notes: readonly ImportNote[]): string[] {
  return notes.map((note) => note.key);
}

describe('the pairing table', () => {
  it('makes one turn of an action and its answer, and one of every entry that answers nothing', () => {
    const { document } = produced(LANTERN_FORK);
    const opening = turnFor(document, 'lf-e1');
    const pair = turnFor(document, 'lf-e3');
    const second = turnFor(document, 'lf-e4');
    const system = turnFor(document, 'lf-e5');
    const answered = turnFor(document, 'lf-e7');
    const unanswered = turnFor(document, 'lf-e8');

    // The opening: no input, its narration as output, the root of the story.
    expect(opening).toMatchObject({ parentTurnId: null, status: 'complete' });
    expect(opening.input).toBeUndefined();
    expect(opening.output?.text).toBe('The lighthouse is dark.');

    // An action and its answer: one turn.
    expect(pair.parentTurnId).toBe(opening.id);
    expect(pair.input?.text).toBe('You climb the stairs.');
    expect(pair.output?.text).toBe('The lamp room smells of oil.');

    // A second narration in a row: a turn of its own, with no input.
    expect(second.parentTurnId).toBe(pair.id);
    expect(second.input).toBeUndefined();
    expect(second.output?.text).toBe('Wind rattles the glass.');

    // A `system` entry: a turn with no input and its text as output (§4).
    expect(system.parentTurnId).toBe(second.id);
    expect(system).toMatchObject({ status: 'complete', output: { text: 'Chapter one ends.' } });
    expect(system.input).toBeUndefined();

    expect(answered.parentTurnId).toBe(system.id);
    expect(answered.input?.text).toBe('You light the lamp.');

    // An action nobody answered: failed, input only, and still on the line.
    expect(unanswered).toMatchObject({ parentTurnId: answered.id, status: 'failed' });
    expect(unanswered.input?.text).toBe('You wait for a ship.');
    expect(unanswered.output).toBeUndefined();
  });

  it('opens on an action when the story did, and ends an action cut off by a system entry', () => {
    const { document } = produced(QUIET_HARBOUR);
    const first = turnFor(document, 'qh-e2');
    expect(first).toMatchObject({ parentTurnId: null, status: 'complete' });
    expect(first.input?.text).toBe('Begin at the pier.');

    // Built by hand: an action, a system entry, then a narration. The action
    // was not answered — the system text is its own turn, and the narration
    // after it answers nothing either.
    const rows = rowsOf(database(), QUIET_HARBOUR);
    const at = rows.entries[0]!.createdAt;
    rows.entries = [
      { ...rows.entries[0]!, id: 'x-a', type: 'user_action', position: 0, branchId: null },
      { ...rows.entries[0]!, id: 'x-s', type: 'system', position: 1, createdAt: at + 1 },
      { ...rows.entries[0]!, id: 'x-n', type: 'narration', position: 2, createdAt: at + 2 },
    ];
    rows.branches = [];
    const outcome = produceStory(rows, KEY(QUIET_HARBOUR));
    if (!outcome.ok) throw new Error('expected a document');
    const [action, system, narration] = outcome.document.turns;
    expect(action).toMatchObject({ status: 'failed', parentTurnId: null });
    expect(system).toMatchObject({ status: 'complete', parentTurnId: action!.id });
    expect(system!.input).toBeUndefined();
    expect(narration).toMatchObject({ parentTurnId: system!.id });
    expect(narration!.input).toBeUndefined();
  });
});

describe('the lineage, rebuilt from the branches', () => {
  it('hangs a branch off the turn that holds its fork entry', () => {
    const { document } = produced(LANTERN_FORK);
    // Ferry forks from the narration `lf-e3`, which ends the climb's turn.
    const ferry = turnFor(document, 'lf-f2');
    expect(ferry.parentTurnId).toBe(turnFor(document, 'lf-e3').id);
    expect(ferry.input?.text).toBe('You go back down.');
  });

  it('re-pairs a fork that splits a pair from the forked action, beside the parent’s answer', () => {
    const outcome = produced(LANTERN_FORK);
    const { document } = outcome;
    const mainAnswer = turnFor(document, 'lf-e7');
    const towerFirst = turnFor(document, 'lf-t1');

    // Tower forks from `lf-e6`, whose answer is main's: the branch's first
    // turn is the same action with Tower's own answer, a sibling of main's.
    expect(towerFirst.parentTurnId).toBe(mainAnswer.parentTurnId);
    expect(towerFirst.input?.text).toBe('You light the lamp.');
    expect(towerFirst.output?.text).toBe('The wick will not take.');
    expect(towerFirst.id).not.toBe(mainAnswer.id);
    expect(turnFor(document, 'lf-t3').parentTurnId).toBe(towerFirst.id);

    const split = outcome.notes.filter((note) => note.key === 'import.aventuras.forkSplitPair');
    expect(split).toEqual([
      {
        key: 'import.aventuras.forkSplitPair',
        params: { story: 'The Lantern Fork', branch: 'Tower' },
        level: 'info',
      },
    ]);
  });

  it('finds a grandchild’s fork on its parent’s line, not on main’s', () => {
    const { document } = produced(LANTERN_FORK);
    // Tower Stair forks from Tower's answer `lf-t1`, which only Tower holds.
    expect(turnFor(document, 'lf-s2').parentTurnId).toBe(turnFor(document, 'lf-t1').id);
  });

  it('makes every entry one turn, and never reads `parent_id`', () => {
    const db = database();
    // Aventuras never writes it; were it read, this would scramble the tree.
    db.prepare('update story_entries set parent_id = ? where story_id = ?').run(
      'lf-e1',
      LANTERN_FORK.id,
    );
    const outcome = produceStory(rowsOf(db, LANTERN_FORK), KEY(LANTERN_FORK));
    if (!outcome.ok) throw new Error('expected a document');
    // Eight entries on main make six turns; Ferry one; Tower two, the first
    // re-pairing main's action; Tower Stair one.
    expect(outcome.document.turns).toHaveLength(10);
    expect(outcome.document.turns.filter((turn) => turn.parentTurnId === null)).toHaveLength(1);
    expect(outcome.document).toEqual(produced(LANTERN_FORK).document);
  });

  it('places every parent before its children', () => {
    const { document } = produced(LANTERN_FORK);
    const seen = new Set<string>();
    for (const turn of document.turns) {
      if (turn.parentTurnId !== null) expect(seen.has(turn.parentTurnId)).toBe(true);
      seen.add(turn.id);
    }
  });

  it('hangs a branch that wrote nothing at its fork, and names it there', () => {
    const { document } = produced(QUIET_HARBOUR);
    const refs = document.session['branchRefs'] as BranchRef[];
    const fork = turnFor(document, 'qh-e2').id;
    expect(refs.map((ref) => [ref.name, ref.headTurnId])).toEqual([
      ['Main', fork],
      ['Still Water', fork],
    ]);
  });

  it('keeps a branch whose fork is gone as a line of its own, and says so', () => {
    const rows = rowsOf(database(), LANTERN_FORK);
    rows.branches = rows.branches.map((branch) =>
      branch.id === 'lf-ferry' ? { ...branch, forkEntryId: 'nowhere' } : branch,
    );
    const outcome = produceStory(rows, KEY(LANTERN_FORK));
    if (!outcome.ok) throw new Error('expected a document');
    expect(turnFor(outcome.document, 'lf-f2').parentTurnId).toBeNull();
    expect(keys(outcome.notes)).toContain('import.aventuras.forkEntryMissing');
  });

  it('reads a database from before branches as one line', () => {
    // Migration 12: no `branches` table, no `branch_id`, no `current_branch_id`.
    const db = database({ version: 12 });
    expect(aventurasPreflight(db).ok).toBe(true);
    const rows = rowsOf(db, LANTERN_FORK);
    expect(rows.branches).toEqual([]);
    expect(rows.entries.every((entry) => entry.branchId === null)).toBe(true);
    expect(rows.story.currentBranchId).toBeNull();
  });
});

describe('the head', () => {
  it('opens on the branch the person was on, not on main', () => {
    const { document, branches } = produced(LANTERN_FORK);
    // `current_branch_id` is Tower: its last turn, not main's unanswered action.
    expect(document.session.headTurnId).toBe(turnFor(document, 'lf-t3').id);
    expect(branches).toBe(3);

    const refs = document.session['branchRefs'] as BranchRef[];
    expect(refs.map((ref) => [ref.name, ref.headTurnId])).toEqual([
      ['Main', turnFor(document, 'lf-e8').id],
      ['Ferry', turnFor(document, 'lf-f2').id],
      ['Tower', turnFor(document, 'lf-t3').id],
      ['Tower Stair', turnFor(document, 'lf-s2').id],
    ]);
  });

  it('continues toward the head at every fork on the way to it', () => {
    const { document } = produced(LANTERN_FORK);
    const chosen = document.session['lastSelectedChild'] as Record<string, string>;
    const towerFirst = turnFor(document, 'lf-t1');
    // Every turn on the head's path that has more than one child, and only those.
    expect(chosen).toEqual({
      [turnFor(document, 'lf-e3').id]: turnFor(document, 'lf-e4').id,
      [turnFor(document, 'lf-e5').id]: towerFirst.id,
      [towerFirst.id]: turnFor(document, 'lf-t3').id,
    });
  });

  it('opens on main when the person was there, or on a branch that is gone', () => {
    expect(produced(QUIET_HARBOUR).document.session.headTurnId).toBe(
      turnFor(produced(QUIET_HARBOUR).document, 'qh-e2').id,
    );

    const rows = rowsOf(database(), LANTERN_FORK);
    rows.story.currentBranchId = 'deleted-branch';
    const outcome = produceStory(rows, KEY(LANTERN_FORK));
    if (!outcome.ok) throw new Error('expected a document');
    expect(outcome.document.session.headTurnId).toBe(turnFor(outcome.document, 'lf-e8').id);
    expect(keys(outcome.notes)).toContain('import.aventuras.headBranchMissing');
  });
});

describe('the fields', () => {
  it('marks every turn foreign before the reader sees it', () => {
    const { document } = produced(LANTERN_FORK);
    for (const turn of document.turns) {
      expect(turn.foreign?.source).toBe('aventuras');
    }
    // The answer keys a pair; a lone action keys itself.
    expect(turnFor(document, 'lf-e3').input?.text).toBe('You climb the stairs.');
    expect(turnFor(document, 'lf-e8').status).toBe('failed');
  });

  it('puts what was measured in `cost`, and never writes a `request`', () => {
    const { document } = produced(LANTERN_FORK);
    for (const turn of document.turns) expect(turn.request).toBeUndefined();

    const generated = turnFor(document, 'lf-e3');
    expect(generated.cost).toEqual({
      promptTokens: null,
      completionTokens: 42,
      wallMs: 1234,
      model: 'fixture-model-7b',
    });
    // Temperature, effort and profile had no field that would not claim a call.
    expect(JSON.stringify(generated)).not.toContain('0.8');
    expect(JSON.stringify(generated)).not.toContain('profile-1');

    // An answer with no generation time recorded has no cost, rather than a free one.
    expect(turnFor(document, 'lf-e7').cost).toBeUndefined();
    expect(turnFor(document, 'lf-e1').cost).toBeUndefined();
  });

  it('carries reasoning beside the answer, suggestions as texts, and the untranslated input', () => {
    const { document } = produced(LANTERN_FORK);
    const generated = turnFor(document, 'lf-e3');
    expect(generated.output).toEqual({
      text: 'The lamp room smells of oil.',
      reasoning: 'They went up, so describe the top.',
    });
    expect(generated.suggestions).toEqual(['Light the lamp', 'Call out']);
    expect(generated.input).toEqual({
      actorId: null,
      kind: 'do',
      text: 'You climb the stairs.',
      raw: 'Subes las escaleras.',
    });
    // Nothing saved is absent, not empty.
    expect(turnFor(document, 'lf-e7').suggestions).toBeUndefined();
    expect(turnFor(document, 'lf-e7').input?.raw).toBe('You light the lamp.');
  });

  it('names the story, its times, and no mode, cast or lore', () => {
    const { document } = produced(LANTERN_FORK);
    expect(document.session.name).toBe('The Lantern Fork');
    expect(document.session['mode']).toBeUndefined();
    expect(document.session['cast']).toBeUndefined();
    expect(document.session['lore']).toBeUndefined();
    expect(document.renditions).toEqual([]);
  });

  it('records a narrator prompt of the story’s own, and what it could not place', () => {
    const outcome = produced(QUIET_HARBOUR);
    expect(outcome.mode).toBe('creative-writing');
    expect(outcome.notes).toEqual(
      expect.arrayContaining([
        {
          key: 'import.aventuras.customNarratorPrompt',
          params: { story: 'Quiet Harbour', length: 41 },
          level: 'warn',
        },
        {
          key: 'import.aventuras.entryTypeUnknown',
          params: { story: 'Quiet Harbour', type: 'retry', count: 1 },
          level: 'warn',
        },
        {
          key: 'import.aventuras.entriesUnplaced',
          params: { story: 'Quiet Harbour', count: 1 },
          level: 'warn',
        },
      ]),
    );
    // And the prompt's text is in no turn and nowhere in the document.
    expect(JSON.stringify(outcome.document)).not.toContain('Speak only in tides');
  });
});

describe('the ids', () => {
  it('are the same on every run, and so is the document', () => {
    const first = produced(LANTERN_FORK).document;
    const second = produced(LANTERN_FORK).document;
    expect(second).toEqual(first);
    expect(new Set(first.turns.map((turn) => turn.id)).size).toBe(first.turns.length);
  });

  it('differ for another account, and for another story', () => {
    const db = database();
    const ours = produceStory(rowsOf(db, LANTERN_FORK), KEY(LANTERN_FORK, 'ned'));
    const theirs = produceStory(rowsOf(db, LANTERN_FORK), KEY(LANTERN_FORK, 'ada'));
    if (!ours.ok || !theirs.ok) throw new Error('expected documents');
    const mine = new Set(ours.document.turns.map((turn) => turn.id));
    expect(theirs.document.turns.some((turn) => mine.has(turn.id))).toBe(false);
  });

  it('sort by when Aventuras wrote each turn’s first entry', () => {
    const { document } = produced(LANTERN_FORK);
    const main = ['lf-e1', 'lf-e3', 'lf-e4', 'lf-e5', 'lf-e7', 'lf-e8'].map(
      (id) => turnFor(document, id).id,
    );
    expect([...main].sort()).toEqual(main);
  });
});

describe('a story with nothing to place', () => {
  it('produces no document', () => {
    const outcome = produceStory(rowsOf(database(), BLANK_PAGE), KEY(BLANK_PAGE));
    expect(outcome.ok).toBe(false);
  });

  it('pairs the stories generated by the count, which every Part 1 test still has', () => {
    // An opening, then action and answer in turn; the branches forked from the
    // opening and wrote nothing.
    const story = STORIES[0]!;
    const outcome = produceStory(rowsOf(database({ storyTrees: [] }), story), KEY(story));
    if (!outcome.ok) throw new Error('expected a document');
    expect(outcome.document.turns.map((turn) => turn.status)).toEqual([
      'complete',
      'complete',
      'complete',
      'failed',
    ]);
    expect(outcome.branches).toBe(story.rows.branches);
  });
});

describe('the column gate', () => {
  it('refuses a database past migration 13 without `story_entries.branch_id`', () => {
    // Read as absent, every branch's entries would join the main line.
    const verdict = aventurasPreflight(database({ omitColumns: { story_entries: ['branch_id'] } }));
    expect(verdict).toMatchObject({ ok: false, missing: 'story_entries.branch_id' });
  });

  it('refuses one without a branch’s fork entry', () => {
    const verdict = aventurasPreflight(database({ omitColumns: { branches: ['fork_entry_id'] } }));
    expect(verdict).toMatchObject({ ok: false, missing: 'branches.fork_entry_id' });
  });
});
