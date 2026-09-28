// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { uuidv7, type SessionDocument, type SessionExport, type Turn } from '@storyengine/shared';

/**
 * ***New ids for a session that arrived from somewhere else*** —
 * [P13.0](../../../../docs/design/workplan/30-p13-aventuras-import.md).
 *
 * [P11.10] kept an imported session's turn ids, on the argument that a
 * collision needed two installs importing each other's sessions. It needed
 * one. An export imported back onto the install that wrote it — the ordinary
 * way to copy a session, and what every backup import into its own account
 * does — put two sessions' turns under one set of ids, and **every structure
 * here that keys a turn by its id alone** then held one of them: the index's
 * `turn` table, the rendition jobs (whose ids are `${turnId}.${n}`, so an
 * Illustrate on the copy re-rendered the *original's* picture), the
 * notification dedupe. The id rule the work plan states — *uuidv7, globally
 * unique* — is what all of them assume, and this is where it is restored,
 * rather than in each of them.
 *
 * ***The ids a turn had where it came from travel as `foreign.id`***, which is
 * the identity [18 §3] asked the format to carry. A turn that already has
 * `foreign` keeps it — the first install it came from is the one that matters.
 *
 * ***Pure.*** No I/O, and the minting function is a parameter, so the rewrite is
 * testable as a function of its input; `importSession` is the one caller.
 */

export interface RemintTarget {
  /** The session id this install has just minted. */
  sessionId: string;
  /** The session id the document carried — what `foreign.source` records. */
  was: string;
}

export interface Reminted {
  /** The session document with its references rewritten; `id` is the new one. */
  session: SessionDocument;
  /** Every line of the document that is a turn, parents first, with new ids. */
  turns: Turn[];
  /**
   * Old id to new, for the caller that has to place something by turn id after
   * the import — [P13.13]'s rendition assets are the case waiting for it.
   */
  turnIds: ReadonlyMap<string, string>;
}

/**
 * ***A uuid is found by value; anything else only where the tree keeps it.***
 *
 * The rewrite below is by value rather than by path: a field this build has
 * never heard of — a mode's channel value, a newer build's addition, an effect's
 * untyped `before` — holding a turn id is rewritten along with the fields we
 * know, which is what keeps a frozen format's unknown fields from pointing at
 * another session. That is only safe for an id nothing else could equal. A
 * uuid is: 122 random-or-time bits cannot turn up as a word, a count or another
 * id by accident. A producer that used `"1"` and `"2"` as turn ids is legal —
 * the format does not say what an id looks like — and rewriting every `"1"` in
 * the document would be a corruption rather than a remapping. So an id that is
 * not uuid-shaped is rewritten only in the tree's own fields, which name it
 * unambiguously.
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function remint(
  read: SessionExport,
  target: RemintTarget,
  mint: () => string = uuidv7,
): Reminted {
  const lines = turnLines(read.turns);
  const ordered = parentsFirst(lines);

  /**
   * *Minted in parent-first order*, so the new ids sort the way the turns were
   * made — which is what `sessions/export.ts` relies on when it sorts by id
   * and calls the result creation order. One id per old id: a backup envelope
   * carries raw segment lines, and a turn written twice is two lines.
   */
  const turnIds = new Map<string, string>();
  for (const line of ordered) if (!turnIds.has(line.id)) turnIds.set(line.id, mint());

  const byValue = new Map<string, string>();
  for (const [old, now] of turnIds) if (UUID.test(old)) byValue.set(old, now);
  if (UUID.test(target.was)) byValue.set(target.was, target.sessionId);

  const renamed = (id: string): string => turnIds.get(id) ?? id;
  const tree = (id: string | null): string | null => (id === null ? null : renamed(id));

  const turns = ordered.map((line) => {
    const { foreign, ...rest } = line;
    const rewritten = rewrite(rest, byValue) as Turn;
    return {
      ...rewritten,
      id: renamed(line.id),
      sessionId: target.sessionId,
      parentTurnId: tree(line.parentTurnId),
      foreign: foreign ?? { source: target.was, id: line.id },
    };
  });

  return {
    session: rewriteSession(read.session, byValue, renamed, target.sessionId),
    turns,
    turnIds,
  };
}

/**
 * The lines of `turns` that are turns — defensively, because the document is a
 * file somebody chose. A line with no string id cannot be placed in a tree and
 * is left out, which is what the importer did before this existed.
 */
function turnLines(candidates: unknown[]): Turn[] {
  const found: Turn[] = [];
  for (const candidate of candidates) {
    if (typeof candidate !== 'object' || candidate === null) continue;
    const turn = candidate as Turn;
    if (typeof turn.id !== 'string') continue;
    found.push({
      ...turn,
      parentTurnId: typeof turn.parentTurnId === 'string' ? turn.parentTurnId : null,
    });
  }
  return found;
}

/**
 * ***Every parent before its children, and otherwise the order it came in.***
 *
 * The format says its turns are *"in no particular order, each naming its
 * parent"* (`session-export.ts`), and appending a child before its parent would
 * leave every forward reader with a dangling parent for the length of the
 * import. So a line waits for its parent and is released the moment its parent
 * is written — **a stable order, not a sort**, because two lines for one turn
 * are an earlier and a later version (a segment reads last-line-wins, and a
 * tombstone is a turn appended again), and swapping them would resurrect what
 * the second one superseded.
 *
 * A parent the document never mentions is not waited for: the turn is a root
 * as far as this document can say, which is what `walkPath` makes of it. A
 * cycle can never be released, and its lines go at the end in the order they
 * came — kept, because dropping a turn is the one thing an import must not do
 * quietly.
 */
function parentsFirst(lines: Turn[]): Turn[] {
  const present = new Set(lines.map((line) => line.id));
  const written = new Set<string>();
  const waiting = new Map<string, number[]>();
  const placed = new Array<boolean>(lines.length).fill(false);
  const ordered: Turn[] = [];

  const release = (start: number): void => {
    // A queue rather than recursion: a long session is a chain thousands deep.
    // An array's iterator re-reads its length, so children pushed below are
    // visited by this same loop.
    const queue = [start];
    for (const at of queue) {
      const line = lines[at];
      if (line === undefined) continue;
      placed[at] = true;
      ordered.push(line);
      if (written.has(line.id)) continue;
      written.add(line.id);
      const children = waiting.get(line.id);
      if (children !== undefined) {
        waiting.delete(line.id);
        queue.push(...children);
      }
    }
  };

  lines.forEach((line, at) => {
    const parent = line.parentTurnId;
    if (parent === null || !present.has(parent) || written.has(parent)) {
      release(at);
      return;
    }
    const queued = waiting.get(parent) ?? [];
    queued.push(at);
    waiting.set(parent, queued);
  });

  lines.forEach((line, at) => {
    if (!placed[at]) ordered.push(line);
  });
  return ordered;
}

/**
 * The session document, rewritten by value and then in the tree's own fields.
 *
 * The tree fields are set from the *original* values rather than trusted to
 * the value pass, so an id that is not uuid-shaped — rewritten nowhere else —
 * still moves where the tree names it: the head, the branch heads, and the
 * remembered child at each fork.
 */
function rewriteSession(
  session: SessionDocument,
  byValue: ReadonlyMap<string, string>,
  renamed: (id: string) => string,
  sessionId: string,
): SessionDocument {
  const rewritten = rewrite(session, byValue) as SessionDocument;
  const out: SessionDocument = {
    ...rewritten,
    id: sessionId,
    headTurnId: typeof session.headTurnId === 'string' ? renamed(session.headTurnId) : null,
  };

  const refs = session['branchRefs'];
  if (Array.isArray(refs)) {
    out['branchRefs'] = refs.map((ref, at) => {
      const was = (ref as { headTurnId?: unknown }).headTurnId;
      const now = (rewritten['branchRefs'] as unknown[])[at] as Record<string, unknown>;
      return typeof was === 'string' ? { ...now, headTurnId: renamed(was) } : now;
    });
  }

  const remembered = session['lastSelectedChild'];
  if (typeof remembered === 'object' && remembered !== null && !Array.isArray(remembered)) {
    out['lastSelectedChild'] = Object.fromEntries(
      Object.entries(remembered as Record<string, unknown>).map(([parent, child]) => [
        renamed(parent),
        typeof child === 'string' ? renamed(child) : child,
      ]),
    );
  }

  return out;
}

/**
 * Every string and every key, rewritten wherever a whole dot-separated segment
 * is an id being replaced.
 *
 * *Segments rather than whole strings*, because ids are composed: a rendition
 * is `${turnId}.${ordinal}` (`renditions/store.ts`) and an assembled block is
 * `${block}.${turnId}.${part}` (`assembly/collect.ts`). *Whole segments rather
 * than substrings*, so prose that mentions an id — a person pasting one into a
 * message — is left as they wrote it: a sentence is never a single segment that
 * equals a uuid.
 */
function rewrite(value: unknown, byValue: ReadonlyMap<string, string>): unknown {
  if (typeof value === 'string') return rewriteString(value, byValue);
  if (Array.isArray(value)) return value.map((item) => rewrite(item, byValue));
  if (typeof value === 'object' && value !== null) {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        rewriteString(key, byValue),
        rewrite(item, byValue),
      ]),
    );
  }
  return value;
}

function rewriteString(text: string, byValue: ReadonlyMap<string, string>): string {
  const whole = byValue.get(text);
  if (whole !== undefined) return whole;
  if (!text.includes('.')) return text;

  const segments = text.split('.');
  let changed = false;
  for (const [at, segment] of segments.entries()) {
    const now = byValue.get(segment);
    if (now === undefined) continue;
    segments[at] = now;
    changed = true;
  }
  return changed ? segments.join('.') : text;
}
