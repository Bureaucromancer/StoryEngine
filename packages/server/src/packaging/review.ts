// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { createHash } from 'node:crypto';

import {
  type Closure,
  fileSet,
  type PublishPreview,
  type PublishStart,
  WORLD_SCHEMA,
  type World,
} from '@storyengine/shared';

import { LibraryError, list, read } from '../library.js';
import { modeById } from '../mode-registry.js';
import { type ClosureRefusal, libraryReader, walkClosure } from './closure.js';
import { lastPublishOf } from './ledger.js';
import { measureObject, measureSession, type WorldFileContext } from './world-file.js';

/**
 * ***The review's answer: what a publish would send, measured*** —
 * [16 §5](../../../../docs/design/16-publish.md),
 * [16 §2](../../../../docs/design/16-publish.md),
 * [04 §9.1](../../../../docs/design/04-schemas.md), [P16.3d].
 *
 * **It writes nothing, and that is the contract rather than a property it
 * happens to have.** [16 §5]: *"It stages nothing and holds no copy: the file
 * is produced on confirm from the library as it is then"* — [P4 §7.17]'s
 * posture for import's look before commit. So the preview walks the library,
 * measures what the walk reached with the writer's own functions (which read
 * and `stat`, and stage nothing when not given somewhere to), and answers. It
 * opens no scratch space, appends no ledger line, touches neither the index
 * nor the library — the route test holds it to all four, and to the whole data
 * directory besides. What the person decides travels back with the confirm,
 * which re-walks; nothing here survives the response.
 *
 * ***The numbers are the file's.*** `NodeFacts` and `SessionFacts` are filled
 * by `measureObject` and `measureSession`, the same surveys `planWorldFile`
 * copies from, so the size beside a row is the size that row adds to the file
 * — a card counted as it will travel, re-spliced or not; a memory book as the
 * nothing it carries. History is measured as though the person had opted into
 * it, so the toggle can say what it would add before it is pressed.
 */

/**
 * What the publish routes read: the writer's context, and the disk's free
 * space for the confirm's room check (`AppServices.freeBytes`, a seam so a
 * test can answer *full*).
 */
export interface PublishContext extends WorldFileContext {
  freeBytes: (path: string) => Promise<number | null>;
}

/**
 * ***The review for a start***, or the walk's refusal: `not-found` for a
 * World or a lone id that is not there — or, since 2026-10-11, a selection
 * none of whose ids is — `world-in-selection` for a selection
 * holding a World ([P16.3]'s decisions — a set of sets has no honest kept
 * form, [15 §3.1]). A selection id that is not there, beside one that is,
 * is a missing **node**, reported in the closure, never a refusal ([16 §4]).
 */
export async function previewPublish(
  context: PublishContext,
  handle: string,
  start: PublishStart,
): Promise<PublishPreview | ClosureRefusal> {
  const closure = await walkClosure(libraryReader(context, handle), start);
  if ('refusal' in closure) return closure;
  await measureClosure(context, handle, closure);

  const defaults = fileSet(closure, { ticked: {}, history: false });
  return {
    closure,
    modeVersions: modeVersionsOf(closure),
    suggestedName: suggestedNameOf(closure),
    sameAs: closure.origin === 'selection' ? sameAs(context, handle, closure) : [],
    justTheObject:
      closure.origin === 'object' &&
      defaults.objects.length === 1 &&
      defaults.sessions.length === 0,
    reviewed: closureHash(closure),
    build: { version: context.build?.version ?? null },
    previous:
      closure.world === null
        ? null
        : await lastPublishOf(context.library.layout, handle, closure.world.id),
  };
}

/**
 * ***The closure's identity, for drift*** — sha256 over every node's own
 * answer to *has this changed*, sorted, with the start World's hash and the
 * origin beside them.
 *
 * - **A found object by its `contentHash`** — the stored file's, so a portrait
 *   replaced or an entry edited is a change, and a name reached by a
 *   different object after a rename is a different node.
 * - **A session by its head and its `updatedAt`** — wider than the plan's
 *   *key:headTurnId*, and deliberately: a session renamed, or a turn hidden,
 *   moves no head and still changes the export the file would carry.
 * - **A missing or excluded node by what it names**, not by its key — a
 *   missing key is an ordinal in discovery order, and two walks of one library
 *   agree on it only because they agree on everything else.
 *
 * Facts are not in it: they are measurements of what the hashes already
 * identify. Neither are ticks, which are the person's and not the library's.
 */
export function closureHash(closure: Closure): string {
  const parts = closure.nodes
    .map((node): string[] => {
      switch (node.state) {
        case 'found':
          return ['found', node.key, node.contentHash];
        case 'session':
          return ['session', node.key, node.headTurnId ?? '', node.updatedAt];
        case 'missing':
          return ['missing', node.expected, node.ref.id ?? '', node.ref.name ?? ''];
        case 'excluded':
          return ['excluded', node.key, node.schema, node.reason];
      }
    })
    .map((part) => JSON.stringify(part))
    .sort();
  const identity = JSON.stringify([closure.origin, closure.world?.contentHash ?? null, parts]);
  return `sha256:${createHash('sha256').update(identity, 'utf8').digest('hex')}`;
}

/**
 * ***The name the review offers*** — and the file's name when no World is
 * kept to name it.
 *
 * - **A World start**: the World's own.
 * - **One object**: that object's — the file is that object and what came with it.
 * - **A selection**: the first three starting points' names, in the order
 *   picked, and `…` when there were more. Names rather than a sentence, because
 *   the server sends no prose ([01 §2]) and a person's own names are not prose;
 *   the field is prefilled and theirs to change, and a selection that names
 *   nothing found offers nothing.
 */
export function suggestedNameOf(closure: Closure): string {
  if (closure.world !== null) return closure.world.name;
  const byKey = new Map(closure.nodes.map((node) => [node.key, node]));
  const names = closure.roots
    .map((key) => byKey.get(key))
    .map((node) => (node?.state === 'found' ? node.name.trim() : ''))
    .filter((name) => name !== '');
  if (names.length <= SUGGESTED_NAMES) return names.join(', ');
  return `${names.slice(0, SUGGESTED_NAMES).join(', ')}, …`;
}

/** How many starting points a selection's suggested name spells out. */
const SUGGESTED_NAMES = 3;

/**
 * ***Every found object and every session, measured*** — in place, onto the
 * closure the walk returned, one at a time so a World of long transcripts
 * holds one export in memory, not all of them.
 *
 * An object that has gone between the walk and its measure is left without
 * facts — the review reads that as zero, and the confirm's own walk is the one
 * that decides — while any other failure to read it is the server's, and
 * propagates, as it would from the writer at confirm.
 */
async function measureClosure(
  context: PublishContext,
  handle: string,
  closure: Closure,
): Promise<void> {
  for (const node of closure.nodes) {
    if (node.state === 'found') {
      let row;
      try {
        row = read(context.library, handle, node.id, node.schema);
      } catch (error) {
        if (error instanceof LibraryError && error.code === 'not-found') continue;
        throw error;
      }
      node.facts = await measureObject(context, handle, row, { history: true });
    } else if (node.state === 'session') {
      node.facts = await measureSession(context, handle, node.id);
    }
  }
}

/**
 * This install's version of every mode the closure names — a carried Setup's,
 * a session's, and any the start World's author required — or `null` for one
 * it does not have.
 */
function modeVersionsOf(closure: Closure): Record<string, string | null> {
  const ids = new Set<string>();
  for (const node of closure.nodes) {
    if (node.state === 'found' || node.state === 'session') {
      for (const id of node.modes) ids.add(id);
    }
  }
  for (const mode of closure.world?.requires.modes ?? []) {
    if (typeof mode.id === 'string' && mode.id !== '') ids.add(mode.id);
  }
  return Object.fromEntries(
    [...ids].sort().map((id) => [id, modeById(id)?.definition.version ?? null]),
  );
}

/**
 * ***Worlds that already hold exactly this selection*** — the same set of ids,
 * order and names aside, among the Worlds this person can read (their own and
 * the system library's; a shadowed copy is the winner's duplicate, not a
 * second World). A selection id that is not there counts as asked: a World
 * that names the same ghost is the same set.
 */
function sameAs(
  context: PublishContext,
  handle: string,
  closure: Closure,
): { id: string; name: string }[] {
  if (closure.start.kind !== 'objects') return [];
  const wanted = new Set(closure.start.ids.filter((id) => typeof id === 'string' && id !== ''));
  return list(context.library, handle, WORLD_SCHEMA)
    .filter((row) => !row.shadowed)
    .filter((row) => {
      const contents = (row.body as Partial<World>).contents;
      if (!Array.isArray(contents)) return false;
      const held = new Set(contents.map((entry) => entry.id));
      return held.size === wanted.size && [...wanted].every((id) => held.has(id));
    })
    .map((row) => ({ id: row.id, name: row.name }));
}
