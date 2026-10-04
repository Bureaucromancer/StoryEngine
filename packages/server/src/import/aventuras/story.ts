// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import {
  SESSION_EXPORT_SCHEMA,
  type BranchRef,
  type ImportNote,
  type SessionExport,
  type Turn,
  type TurnCost,
} from '@storyengine/shared';

import { producedTurnId } from '../../sessions/producer.js';
import { DEFAULT_INPUT_KIND } from '../../turns/preview.js';
import { stripPicTags } from './pic-tags.js';
import { isRecord } from './shapes.js';
import type { AventurasBranch, AventurasEntry, AventurasStoryRows } from './story-rows.js';

/**
 * ***An Aventuras story, as a `storyengine.session-export/1` document*** —
 * [P13.11](../../../../../docs/design/workplan/30-p13-aventuras-import.md),
 * [19 §2.3.1](../../../../../docs/design/19-session-import.md),
 * [P13 §0.3](../../../../../docs/design/workplan/30-p13-aventuras-import.md#03-how-this-sits-with-25-e4).
 *
 * ***A producer, not an importer*** — [26 E4]'s *one format, not N importers*,
 * kept by construction. This module returns a document and writes nothing; the
 * sweep's Writer hands the document to `importSession`, the one reader, which
 * is the only thing that writes an imported session (`sessions/producer.ts`
 * says what a producer owes it). Deleting this file deletes the Aventuras story
 * import and nothing else, which is the test a per-source *importer* fails.
 *
 * ## The tree is the branches
 *
 * **Aventuras' `parent_id` is always null** — the rows are never read for it
 * (`story-rows.ts`). What makes a story a tree is:
 *
 * - **Main** is every entry with no `branch_id`, in `position` order. It has
 *   no `branches` row; Aventuras draws it as *Main*.
 * - **A branch** is its parent's lineage up to and including `fork_entry_id`,
 *   then its own rows — it owns only what it wrote, and its positions continue
 *   the parent's from the fork, so two sibling branches reuse the same numbers
 *   after it (Aventuras' `getStoryEntriesForBranch` and `buildBranchLineage`).
 *
 * So a conversion builds main as a chain of turns, and hangs each branch's
 * first turn off **the turn that holds the fork entry in its parent's
 * lineage** — [19 §2.3.1]'s rule. Parents are placed before children, so the
 * turn that holds a fork entry always exists by the time a branch asks.
 *
 * ***The lookup walks the lineage, not the story.*** A branch's view of an
 * entry can differ from the main line's: after a fork that split a pair
 * (below), the forked action is the input of a turn on the branch *and* of a
 * turn on the parent. A grandchild forking from that action means the branch's
 * turn. So each line keeps what it placed, and a fork is looked up on the
 * parent's own line first and then up through its ancestors.
 *
 * ## Pairing — [19 §2.3.1]'s table
 *
 * | Entries, in lineage order | Turn |
 * |---|---|
 * | `user_action`, then `narration` | one turn: the action as `input`, the narration as `output` |
 * | a leading `narration` — the opening | a turn with no `input` |
 * | a `user_action` nobody answered | `status: 'failed'`, `input` only |
 * | a second `narration` in a row | a turn of its own, with no `input` |
 * | `system` | **a turn with no `input`**, its text as `output` — decided 2026-09-28 ([P13 §4]), because a turn that never ran a model is honest here and dropping the entry is not |
 *
 * ***An unanswered action stays on the line.*** In Aventuras it stays in the
 * story, and the narration after the next action was written with it in view,
 * so the failed turn is the next turn's parent rather than a leaf beside it:
 * the path through the imported session reads as the story did.
 *
 * ***A fork that splits a pair re-pairs from the forked action.*** When
 * `fork_entry_id` is a `user_action` whose narration is on the parent's side,
 * the one turn that pair became on the parent cannot be the branch's parent:
 * the branch shares the action and not the answer. So the branch's first turn
 * hangs off *that turn's parent*, and the forked action is paired again with
 * the branch's own first narration — a sibling of the parent's turn, which is
 * exactly what [07 §3] says a regenerated answer is. It says so
 * (`import.aventuras.forkSplitPair`). A fork from an action nobody answered on
 * the parent goes the same way and says nothing, since nothing was split: the
 * branch's answer is the retry the parent never had.
 *
 * ## The fields — [P13.11]'s list
 *
 * - **`foreign`** is `{ source: 'aventuras', id }`, set here so the reader's
 *   `foreignise` keeps it: the entry that is the turn's answer, or the action
 *   when there is no answer — the one entry that belongs to this turn alone,
 *   since a re-paired action belongs to two.
 * - **Metadata into `cost`, never into `request`.** `request` is what was
 *   assembled and asked for, and nothing recorded that; writing the model,
 *   temperature or effort into a `ModelCall` would fabricate a call
 *   ([19 §3]'s first consequence). So `cost` carries what was measured — the
 *   model and the wall-clock time — and the temperature, reasoning effort and
 *   profile have no field that would not claim a request, and stay in
 *   Aventuras.
 * - **`reasoning`** into `output.reasoning`, beside the text it belongs to.
 * - **`suggested_actions`** into `suggestions`, the texts only: [06 §7.3]'s
 *   suggestions are strings a player submits as their own input, and
 *   Aventuras' `type` beside each (`action`, `dialogue`, …) is a label for a
 *   button this engine does not draw.
 * - **Aventuras' branches into `branchRefs`**, each a name on the turn its
 *   line ends at, and *Main* beside them when there are any, so a person can
 *   find their way back to the line they did not end on.
 * - **The head from `stories.current_branch_id`** — the line the person was
 *   on when they left Aventuras is the one the session opens on.
 *
 * ***Turn ids are derived*** (`producedTurnId`), from the account, this
 * story's key and the entry that keys each turn — so a second import of the
 * same story is refused by the reader as `already-here` rather than written as
 * a copy, and the same story imported by two accounts on one install is two
 * sessions that do not collide.
 *
 * ## What this stage leaves, and where it will slot in
 *
 * The session this makes has no cast, no lore, no pictures and no chapters.
 * Those are [P13.12]–[P13.14]'s: the head branch's world resolved into a cast
 * and a per-story lorebook, the images as renditions, the chapter summaries.
 * Each adds to the document before it is returned — cast and lore as links
 * the Writer resolves (which is why the Writer already passes
 * `requireLinks`), renditions beside the turns — and none changes the tree.
 *
 * *As built at P13.12*: the world is a producer of its own, `world.ts`, pure
 * like this one, and **the Writer** adds its links to this document once it
 * has stored what they name — so this file still never learns that a cast
 * exists, and the tree is untouched by it.
 *
 * *And at P13.13* the pictures are `pictures.ts`'s, on the same terms: this
 * file says where each entry landed ({@link StoryPlacement}) and nothing
 * more, and the renditions join the document's `renditions` beside the turns.
 *
 * ***The chapter summaries do not come*** — P13.14 closed `recorded`: an
 * Aventuras chapter is a summary its model wrote over a range of entries, and
 * the one place this engine keeps a summary of a session is the rolling
 * chain, a content-addressed cache keyed on *this* install's summariser
 * (`sessions/summary-chain.ts`). A foreign summary filed there would either be
 * served as ours or never be looked up, and the turns it summarises are all
 * here, so the chain derives its own. The reader's `storyWorldRecorded` says
 * so on the story's row.
 *
 * ***And the text is the prose Aventuras showed***, not the `content` column
 * as stored: an inline picture's `<pic …>` tag is markup Aventuras swaps for
 * the picture and a person never reads, so it is taken out here
 * ({@link proseOf}, `pic-tags.ts`), and `pictures.ts` anchors the picture
 * where the tag stood.
 */

/**
 * ***An entry's text as Aventuras shows it*** — its inline `<pic …>` tags
 * taken out (`pic-tags.ts`), since each is a placeholder for a picture and
 * never words. Found at P13.13, fixed with P13.14.
 *
 * *Both halves of a turn*, as Aventuras' own history builder strips both
 * (`NarrativeService.buildUserPrompt`): a tag in an action is rare, and would
 * be the person pasting one, but it renders as a picture there too. `raw`
 * falls back to the same prose, since it stands for what the person typed and
 * nobody typed markup that was then hidden from them. `reasoning` is left as
 * written: Aventuras never renders tags in it, and it is a record of what the
 * model thought, markup included.
 */
function proseOf(content: string): string {
  return stripPicTags(content).text;
}

/** The candidate format a story row is emitted as. */
export const STORY_FORMAT = 'aventuras.story';

/**
 * ***The kind every imported action is*** — the engine's default,
 * `DEFAULT_INPUT_KIND`, which every mode this install ships accepts.
 *
 * **Aventuras keeps no kind on the row.** Its *do*, *say*, *think* and *story*
 * are prefixes folded into the text before the entry is written
 * (`ActionInput.svelte`: `actionPrefixes[actionType] + rawInput`), so the text
 * already reads *"You open the door"* and no column says which button made it.
 * Guessing a kind back from the prose would be inventing a field; the default
 * is the one kind that claims nothing beyond *the player did this*.
 *
 * ***And no mode, for a reason the gate holds.*** An imported session names
 * no `mode`, so it plays in the install's default, as every session made
 * before P2.3 does. Freeform calls itself *"the Aventuras shape"* and would be
 * the natural home — but **the engine does not spell a mode id**
 * (`tools/repo-shape.test.ts`, [06 §2], [P7 §3] row 2b): which modes exist is
 * the registry's knowledge and not the importer's, and a producer that named
 * one would be the precedent that gate exists to make awkward. A mode chosen
 * by the person on the sweep request, validated against the registry, is the
 * road to Freeform that keeps it; this stage records Aventuras' own mode on
 * the review row instead (`storyImported`), so nothing is lost by waiting.
 */
const IMPORTED_INPUT_KIND = DEFAULT_INPUT_KIND;

/** The entry types Aventuras writes at the pin. Anything else is reported and left out. */
const ENTRY_TYPES: ReadonlySet<string> = new Set(['user_action', 'narration', 'system']);

/** The main line's key. Aventuras gives it no row, so no branch id can be this. */
const MAIN = '';

/** What a producer is told: whose session it will be, and the story's key. */
export interface StoryKey {
  /** The account the session lands in — part of every turn id (`producedTurnId`). */
  handle: string;
  /** `aventura.db/stories/<id>`: the candidate's `source`, and `importSession`'s `originalFilename`. */
  origin: string;
}

export type StoryProduction =
  | {
      ok: true;
      document: SessionExport;
      /** Named branches carried as `branchRefs` — Aventuras' own, not counting *Main*. */
      branches: number;
      /** What Aventuras called the mode, for the note: `adventure` when it said nothing. */
      mode: string;
      /** Where each entry landed, and where each line ends — for the pictures ([P13.13]). */
      placement: StoryPlacement;
      notes: ImportNote[];
    }
  /** A story with no entries this can place: nothing to import, and `importSession` would refuse it. */
  | { ok: false; reason: 'empty'; notes: ImportNote[] };

/**
 * ***Which turn each entry became, and which turn each line ends on*** —
 * [P13.13](../../../../../docs/design/workplan/30-p13-aventuras-import.md),
 * for what hangs off a turn without being one: the pictures (`pictures.ts`).
 *
 * **An entry is looked up on its own line first**, which is the pairing's
 * lookup and matters once: a forked action re-paired on a branch is the input
 * of a turn there *and* of the turn it was answered in on the line it was
 * written on. Its own line is where it was written, so that is its turn — a
 * picture Aventuras drew into it belongs where the person first saw it. An
 * entry no turn holds — a kind this build does not know, or one on a branch
 * with no row — is not here.
 */
export interface StoryPlacement {
  /** An Aventuras entry's id → the id of the turn that holds it. */
  turnOf: ReadonlyMap<string, string>;
  /** A branch's id, or `null` for the main line → the id of the turn its line ends on. */
  headOf: ReadonlyMap<string | null, string>;
}

/** One turn's worth of entries, before it is a turn. */
interface Pair {
  input: AventurasEntry | null;
  output: AventurasEntry | null;
  /** The input is a forked action, re-paired on a branch — see the header. */
  carried: boolean;
}

/** Where an entry landed on one line: the turn, and which half of it. */
interface Placed {
  turn: Turn;
  role: 'input' | 'output';
}

export function produceStory(rows: AventurasStoryRows, key: StoryKey): StoryProduction {
  const { story } = rows;
  const title = story.title;
  const notes: ImportNote[] = [];

  // ── The lines: main, and one per branch row ─────────────────────────────
  const branchById = new Map<string, AventurasBranch>();
  for (const branch of rows.branches) branchById.set(branch.id, branch);

  const lines = new Map<string, AventurasEntry[]>([[MAIN, []]]);
  for (const branch of rows.branches) lines.set(branch.id, []);

  const unknownTypes = new Map<string, number>();
  const entryById = new Map<string, AventurasEntry>();
  let unplaced = 0;
  for (const entry of rows.entries) {
    entryById.set(entry.id, entry);
    if (!ENTRY_TYPES.has(entry.type)) {
      unknownTypes.set(entry.type, (unknownTypes.get(entry.type) ?? 0) + 1);
      continue;
    }
    const line = lines.get(entry.branchId ?? MAIN);
    // An entry on a branch with no row: Aventuras deletes a branch's entries
    // with it, so this is a database somebody else wrote, and no lineage
    // Aventuras could draw would show it.
    if (line === undefined) unplaced += 1;
    else line.push(entry);
  }
  for (const line of lines.values()) line.sort(inLineOrder);

  // ── The branches, parents first ─────────────────────────────────────────
  const parentOf = new Map<string, string>();
  for (const branch of rows.branches) {
    const parent = branch.parentBranchId;
    // A parent with no row is main — Aventuras' own `ON DELETE SET NULL` —
    // and a branch cannot be its own parent.
    parentOf.set(
      branch.id,
      parent !== null && parent !== branch.id && branchById.has(parent) ? parent : MAIN,
    );
  }
  const ordered = parentsFirst(rows.branches, parentOf);

  // ── Placing ─────────────────────────────────────────────────────────────
  const turns: Turn[] = [];
  const placedOn = new Map<string, Map<string, Placed>>();
  const heads = new Map<string, string | null>();

  const turnOf = (pair: Pair, line: string, parentTurnId: string | null): Turn => {
    const keyed = pair.output ?? pair.input;
    if (keyed === null) throw new Error('A pair with neither half.');
    const first = pair.input ?? keyed;
    /**
     * ***What keys the turn***: the answer when there is one, since an answer
     * belongs to one turn only; a lone action otherwise — namespaced by the
     * line when it is a re-paired fork, because two branches forking from one
     * unanswered action would otherwise derive one id for two turns.
     */
    const sourceId =
      pair.output !== null
        ? `entry:${pair.output.id}`
        : pair.carried
          ? `fork:${line}:${keyed.id}`
          : `action:${keyed.id}`;
    const turn: Turn = {
      id: producedTurnId({ handle: key.handle, origin: key.origin, sourceId, at: first.createdAt }),
      // The reader stamps its own; this is the document's.
      sessionId: story.id,
      parentTurnId,
      createdAt: isoOf(first.createdAt),
      status: pair.output === null ? 'failed' : 'complete',
      foreign: { source: 'aventuras', id: keyed.id },
      effects: [],
      tape: [],
    };
    if (pair.input !== null) {
      turn.input = {
        actorId: null,
        kind: IMPORTED_INPUT_KIND,
        text: proseOf(pair.input.content),
        // What the person typed, when Aventuras translated it into `content`
        // before sending it ([19 §2.3.1]'s *`original_input` as `raw`*).
        raw: pair.input.originalInput ?? proseOf(pair.input.content),
      };
    }
    if (pair.output !== null) {
      const { output } = pair;
      turn.output = {
        text: proseOf(output.content),
        ...(output.reasoning === null ? {} : { reasoning: output.reasoning }),
      };
      const cost = costOf(output.metadata);
      if (cost !== undefined) turn.cost = cost;
      const suggestions = suggestionsOf(output.suggestedActions);
      if (suggestions !== undefined) turn.suggestions = suggestions;
    }
    return turn;
  };

  /** Chains a line's pairs from `anchor`, and remembers where every entry landed. */
  const place = (line: string, anchor: string | null, pairs: readonly Pair[]): void => {
    const here = new Map<string, Placed>();
    let parent = anchor;
    for (const pair of pairs) {
      const turn = turnOf(pair, line, parent);
      turns.push(turn);
      if (pair.input !== null) here.set(pair.input.id, { turn, role: 'input' });
      if (pair.output !== null) here.set(pair.output.id, { turn, role: 'output' });
      parent = turn.id;
    }
    placedOn.set(line, here);
    heads.set(line, parent);
  };

  /** Where `entryId` landed in `line`'s lineage — its own placements first, then its ancestors'. */
  const lookup = (line: string, entryId: string): Placed | undefined => {
    for (let at: string | undefined = line; at !== undefined;) {
      const placed = placedOn.get(at)?.get(entryId);
      if (placed !== undefined) return placed;
      at = at === MAIN ? undefined : parentOf.get(at);
    }
    return undefined;
  };

  place(MAIN, null, pairsOf(lines.get(MAIN) ?? [], null));

  for (const branch of ordered) {
    const own = lines.get(branch.id) ?? [];
    const fork = lookup(parentOf.get(branch.id) ?? MAIN, branch.forkEntryId);
    if (fork === undefined) {
      /**
       * *A fork entry no line holds* — Aventuras calls this corruption and
       * refuses to switch to the branch. Its own entries are still the
       * person's, so they are kept, as a line of their own from the start of
       * the story, and the review says where they went.
       */
      notes.push({
        key: 'import.aventuras.forkEntryMissing',
        params: { story: title, branch: branch.name },
        level: 'warn',
      });
      place(branch.id, null, pairsOf(own, null));
      continue;
    }
    if (fork.role === 'input') {
      if (fork.turn.output !== undefined) {
        notes.push({
          key: 'import.aventuras.forkSplitPair',
          params: { story: title, branch: branch.name },
          level: 'info',
        });
      }
      // The action itself, which is the fork entry: re-paired on this line.
      place(
        branch.id,
        fork.turn.parentTurnId,
        pairsOf(own, entryById.get(branch.forkEntryId) ?? null),
      );
      continue;
    }
    place(branch.id, fork.turn.id, pairsOf(own, null));
  }

  if (turns.length === 0) {
    return {
      ok: false,
      reason: 'empty',
      notes: [...notes, ...leftOut(title, unknownTypes, unplaced)],
    };
  }

  // ── The head, the names, and the way back to the head ───────────────────
  let head = heads.get(MAIN) ?? null;
  const current = story.currentBranchId;
  if (current !== null) {
    if (branchById.has(current)) head = heads.get(current) ?? head;
    else {
      notes.push({
        key: 'import.aventuras.headBranchMissing',
        params: { story: title },
        level: 'warn',
      });
    }
  }
  // A story whose main line is empty and whose person was on it: open on the
  // last line placed rather than on nothing, which reads as an empty story.
  head ??= turns.at(-1)?.id ?? null;

  const branchRefs: BranchRef[] = [];
  for (const branch of ordered) {
    const at = heads.get(branch.id) ?? null;
    if (at === null) continue;
    branchRefs.push({ id: refIdOf(key, branch.id), name: branch.name, headTurnId: at });
  }
  const mainHead = heads.get(MAIN) ?? null;
  if (branchRefs.length > 0 && mainHead !== null) {
    branchRefs.unshift({ id: refIdOf(key, MAIN), name: 'Main', headTurnId: mainHead });
  }

  notes.push(...narratorPrompt(title, story.settings));
  notes.push(...leftOut(title, unknownTypes, unplaced));
  if (rows.unreadable > 0) {
    notes.push({
      key: 'import.aventuras.entryFieldsUnreadable',
      params: { story: title, count: rows.unreadable },
      level: 'warn',
    });
  }

  const entryTurns = new Map<string, string>();
  for (const entry of entryById.values()) {
    const placed = lookup(entry.branchId ?? MAIN, entry.id);
    if (placed !== undefined) entryTurns.set(entry.id, placed.turn.id);
  }
  const headOf = new Map<string | null, string>();
  for (const [line, at] of heads) {
    if (at !== null) headOf.set(line === MAIN ? null : line, at);
  }

  const lastSelectedChild = pathTo(turns, head);
  const document: SessionExport = {
    schema: SESSION_EXPORT_SCHEMA,
    // From the source and never the clock, so the same story is the same
    // document on every run — which a person diffing two runs relies on, and
    // the stable-id test does.
    exportedBy: { version: null, at: isoOf(story.updatedAt ?? story.createdAt ?? 0) },
    session: {
      id: story.id,
      name: title,
      createdAt: isoOf(story.createdAt ?? 0),
      updatedAt: isoOf(story.updatedAt ?? story.createdAt ?? 0),
      headTurnId: head,
      channels: {},
      ...(branchRefs.length === 0 ? {} : { branchRefs }),
      ...(Object.keys(lastSelectedChild).length === 0 ? {} : { lastSelectedChild }),
    },
    turns,
    renditions: [],
  };

  return {
    ok: true,
    document,
    branches: branchRefs.length === 0 ? 0 : branchRefs.length - 1,
    mode: story.mode ?? 'adventure',
    placement: { turnOf: entryTurns, headOf },
    notes,
  };
}

/**
 * ***The pairing table***, over one line's own entries — with `carried`, the
 * forked action a branch re-pairs from, leading.
 */
function pairsOf(entries: readonly AventurasEntry[], carried: AventurasEntry | null): Pair[] {
  const pairs: Pair[] = [];
  let pending: { entry: AventurasEntry; carried: boolean } | null =
    carried === null ? null : { entry: carried, carried: true };
  const unanswered = (): void => {
    if (pending !== null)
      pairs.push({ input: pending.entry, output: null, carried: pending.carried });
    pending = null;
  };

  for (const entry of entries) {
    if (entry.type === 'user_action') {
      unanswered();
      pending = { entry, carried: false };
      continue;
    }
    if (entry.type === 'narration' && pending !== null) {
      pairs.push({ input: pending.entry, output: entry, carried: pending.carried });
      pending = null;
      continue;
    }
    // A narration with nothing to answer — the opening, or a second in a row —
    // or a `system` entry, which answers nothing even after an action: that
    // action was not answered, and the system text is its own turn.
    unanswered();
    pairs.push({ input: null, output: entry, carried: false });
  }
  unanswered();
  return pairs;
}

/** Position within a line; time and id only decide between two rows a race gave one position. */
function inLineOrder(a: AventurasEntry, b: AventurasEntry): number {
  return (
    a.position - b.position || a.createdAt - b.createdAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
  );
}

/**
 * The branches with every parent before its children.
 *
 * *A cycle is placed off main*: Aventuras' `buildBranchLineage` stops at the
 * first branch it has seen, and nothing it writes can make one, so a cycle is a
 * database somebody edited — and a branch whose lineage never reaches main has
 * no fork any line could hold. Hanging it off main lets its fork be looked for
 * where every other lineage ends.
 */
function parentsFirst(
  branches: readonly AventurasBranch[],
  parentOf: Map<string, string>,
): AventurasBranch[] {
  const done = new Set<string>([MAIN]);
  const ordered: AventurasBranch[] = [];
  let pending = [...branches].sort(
    (a, b) => a.createdAt - b.createdAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  );
  while (pending.length > 0) {
    const ready = pending.filter((branch) => done.has(parentOf.get(branch.id) ?? MAIN));
    if (ready.length === 0) break;
    for (const branch of ready) {
      ordered.push(branch);
      done.add(branch.id);
    }
    pending = pending.filter((branch) => !done.has(branch.id));
  }
  for (const branch of pending) {
    parentOf.set(branch.id, MAIN);
    ordered.push(branch);
  }
  return ordered;
}

/**
 * ***What Aventuras measured about an answer, as `cost`*** — and only when it
 * measured the call: the wall-clock time a generation took is what says a
 * model ran (`generationTime`, narration only). An entry without it — an
 * opening a wizard wrote, text a person edited in, a story from before
 * Aventuras recorded times — has no cost rather than a zero one, which
 * `TurnCost` distinguishes (*unknown* against *free*).
 *
 * `completionTokens` is `tokenCount`, **Aventuras' own count of the answer's
 * text** with its own tokenizer rather than a provider's usage report — the
 * nearest thing to a completion count the row has, and recounted by Aventuras
 * when an entry is edited. `promptTokens` is null: nothing recorded what was
 * sent.
 */
function costOf(metadata: unknown): TurnCost | undefined {
  if (!isRecord(metadata)) return undefined;
  const wall = metadata['generationTime'];
  if (typeof wall !== 'number' || !Number.isFinite(wall) || wall < 0) return undefined;
  const model = metadata['model'];
  const tokens = metadata['tokenCount'];
  return {
    promptTokens: null,
    completionTokens:
      typeof tokens === 'number' && Number.isSafeInteger(tokens) && tokens >= 0 ? tokens : null,
    wallMs: Math.round(wall),
    model: typeof model === 'string' && model !== '' ? model : null,
  };
}

/**
 * The saved suggestions' texts, or `undefined` for none — *absent* on
 * `Turn.suggestions` means the step did not run, which for an entry with no
 * saved suggestions is what Aventuras recorded. A blob that will not parse is
 * the same answer: Aventuras' own restore drops one, and clears the buttons.
 */
function suggestionsOf(saved: string | null): string[] | undefined {
  if (saved === null) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(saved);
  } catch {
    return undefined;
  }
  if (!Array.isArray(parsed)) return undefined;
  const texts: string[] = [];
  for (const item of parsed as unknown[]) {
    const text = typeof item === 'string' ? item : isRecord(item) ? item['text'] : undefined;
    if (typeof text === 'string' && text.trim() !== '') texts.push(text);
  }
  return texts.length === 0 ? undefined : texts;
}

/**
 * ***The story's own narrator prompt, recorded rather than carried*** —
 * [P13 §0.5](../../../../../docs/design/workplan/30-p13-aventuras-import.md#05-found-in-passing-and-not-fixed-here),
 * found at P13.9.
 *
 * `settings.customSystemPrompt` overrides the pack's narrator template for one
 * story, so the narrator prompt somebody actually wrote may be here. **It is
 * not put in the session's preset**, for P13.9's reason about the pack's own
 * narrator templates: it is Liquid written against Aventuras' flat namespace
 * and its prompt layout — `pov`, `tense`, `narratorReinforcement`, the context
 * rendered into the system prompt — and a preset made of it would render a
 * prompt that reads plausibly and says the wrong things. The session has no
 * other field that would hold it without claiming it is used. So the review
 * says it exists, and how long it is, at `warn`: what somebody wrote, left in
 * Aventuras, which is P13.9's `packTemplatesDiffer` made for one story.
 */
function narratorPrompt(story: string, settings: unknown): ImportNote[] {
  if (!isRecord(settings)) return [];
  const prompt = settings['customSystemPrompt'];
  if (typeof prompt !== 'string' || prompt.trim() === '') return [];
  return [
    {
      key: 'import.aventuras.customNarratorPrompt',
      params: { story, length: prompt.length },
      level: 'warn',
    },
  ];
}

/** Entries no turn holds, said rather than dropped. */
function leftOut(story: string, unknownTypes: Map<string, number>, unplaced: number): ImportNote[] {
  const notes: ImportNote[] = [];
  for (const [type, count] of unknownTypes) {
    notes.push({
      key: 'import.aventuras.entryTypeUnknown',
      // Clamped: a type is somebody else's text on its way into the ledger.
      params: { story, type: type.slice(0, 64), count },
      level: 'warn',
    });
  }
  if (unplaced > 0) {
    notes.push({
      key: 'import.aventuras.entriesUnplaced',
      params: { story, count: unplaced },
      level: 'warn',
    });
  }
  return notes;
}

/**
 * ***Which child to continue through, on the way to the head*** — the
 * session's `lastSelectedChild`, for every turn on the head's path that has
 * more than one child. Without it, navigating from the start stops at the
 * first fork (`resumeFrom` will not guess), and the person would have to find
 * the line they were on by hand in a story they just brought across.
 */
function pathTo(turns: readonly Turn[], head: string | null): Record<string, string> {
  const byId = new Map<string, Turn>();
  const children = new Map<string, number>();
  for (const turn of turns) {
    byId.set(turn.id, turn);
    if (turn.parentTurnId !== null) {
      children.set(turn.parentTurnId, (children.get(turn.parentTurnId) ?? 0) + 1);
    }
  }
  const chosen: Record<string, string> = {};
  let at = head === null ? undefined : byId.get(head);
  while (at !== undefined && at.parentTurnId !== null) {
    const parent = at.parentTurnId;
    if ((children.get(parent) ?? 0) > 1) chosen[parent] = at.id;
    at = byId.get(parent);
  }
  return chosen;
}

/**
 * A branch ref's id, derived as a turn's is — so the document is the same on
 * every run — under a source id no entry can have.
 */
function refIdOf(key: StoryKey, branch: string): string {
  return producedTurnId({
    handle: key.handle,
    origin: key.origin,
    sourceId: `branch-ref:${branch === MAIN ? 'main' : branch}`,
    at: 0,
  });
}

/** Aventuras' milliseconds as ISO, with a time no `Date` can hold read as the epoch. */
function isoOf(ms: number): string {
  const date = new Date(ms);
  return Number.isNaN(date.getTime()) ? new Date(0).toISOString() : date.toISOString();
}
