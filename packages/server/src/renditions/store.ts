// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { RENDITION_SCHEMA, type Rendition } from '@storyengine/shared';

import { writeJsonAtomic } from '../storage/atomic.js';
import { ensureDirectory, listEntryNames, readFileBytes } from '../storage/files.js';
import type { Layout } from '../storage/layout.js';
import { PathEscapeError, resolveWithin } from '../storage/paths.js';

/**
 * The rendition store — [06 §10.7](../../../../docs/design/06-modes-and-turn-pipeline.md),
 * [03 §5.5](../../../../docs/design/03-data-model.md), [P9.0].
 *
 * **`sessions/summaries.ts`'s posture, with one difference that is the whole
 * reason this is a separate argument rather than a third copy.** The shape is
 * the same and deliberately so: one file per key, a lexical path guard, one
 * directory read to list, `writeJsonAtomic`, and **every read failure is a
 * miss** — because a session that cannot be opened because one derived file went
 * bad is the failure `snapshots.ts` refused first and `summaries.ts` refused
 * after it.
 *
 * ***The difference is the write path, and it runs the other way.*** Those two
 * stores swallow a write failure and return `false`, and they are right to:
 * losing a snapshot costs a reconstruction and losing a summary costs a model
 * call. **Losing a rendition record costs the recipe**, which
 * [06 §10.7](../../../../docs/design/06-modes-and-turn-pipeline.md) says is
 * *"never discarded"* and which is the only thing standing between an evicted
 * asset and a picture nobody can make again. So a failed write **throws**, and
 * the caller — a job worker with a status column to set — records it as a failed
 * rendition rather than reporting a success nothing backs.
 *
 * *Which is [21 §5.1]'s test applied honestly rather than by analogy*: **if
 * losing it would surprise a user, it is not derived.** Losing the pixels would
 * not — that is what an eviction policy is for. Losing the prompt and the seed
 * would.
 *
 * ---
 *
 * ***One file per rendition rather than one per turn, and concurrency decides
 * it.*** The tempting shape is a per-turn file holding an array, which makes
 * rendering a transcript one read per visible turn instead of one directory
 * listing. It also makes two workers finishing two renditions of one turn a lost
 * update, because each rewrites the whole file and the second wins. A rendition
 * is written by **exactly one worker** and read by everybody, so the file is the
 * unit its writer owns — and the reading side gets `readTurns`' shape, which the
 * transcript already pays for once per session rather than once per turn.
 *
 * **In the session directory rather than the library**, for the reason snapshots
 * and summaries are there and for one more that is this subsystem's own:
 * [03 §5.5] makes the backdrop *"session content, and it travels and deletes
 * with the session"*. A rendition promoted into the library would be a picture
 * that outlived the story it was of.
 */

export function renditionsRoot(layout: Layout, handle: string, sessionId: string): string {
  return resolveWithin(layout.sessionRoot(handle, sessionId), 'renditions');
}

/**
 * Where the pixels go — `sessions/<id>/assets/`, [03 §5.5].
 *
 * ***A module function taking a `Layout`, not a method on it***, and that is
 * [P9 §1.1]'s storage fork answered by refusing both halves of it. §0.1's
 * finding 8 says *"`storage/layout.ts` has no accessor for it… so P9.0 adds the
 * accessor"*, and [P8.2] had just deleted `memoriesRoot` for dangling, with
 * [03 §5](../../../../docs/design/03-data-model.md)'s rule behind the deletion:
 * *"a path helper that survives the phase without a caller is the same defect
 * twice."*
 *
 * **The fork dissolves because `Layout` was never how a session subdirectory is
 * added.** `summariesRoot` and `snapshotsRoot` are both module functions of
 * exactly this shape, in the modules that write them, and `Layout` stayed at
 * seventeen methods through both. So this root cannot dangle as a `Layout`
 * method because it is not one, `repo-shape.test.ts`'s *"the storage layout
 * keeps no root the library owns"* arm stays green untouched, and P9 adds no
 * accessor at all. §1.1 anticipated the outcome without naming the route: *"if
 * that leaves this stage with no storage arm at all, it has exactly the right
 * number."*
 *
 * Declared here beside `renditionsRoot` rather than in the worker that first
 * writes bytes, because a record's `asset.path` is relative to this directory
 * and the two roots are one fact about a session's shape.
 */
export function sessionAssetsRoot(layout: Layout, handle: string, sessionId: string): string {
  return resolveWithin(layout.sessionRoot(handle, sessionId), 'assets');
}

/**
 * A rendition's id, from the turn it hangs off and its ordinal under that turn.
 *
 * ***Derived rather than minted, and the commit protocol is why.*** The runner's
 * `write()` builds the checkpoint draft and **runs several times per turn** —
 * once at the start, once per coalescing window during a stream, once at the
 * end — and each of those writes `Turn.renditions.requested`. A `uuidv7()` there
 * would name three different files for one picture, and the last checkpoint to
 * land would win a race against the job that was already filling the first.
 *
 * So the id is a function of facts the turn already has. Two checkpoints of one
 * turn produce the same ids by construction, which is the same property
 * `SubmitRequest.turnId` buys for the turn itself: *"allocated at reservation,
 * because step 2 cannot be idempotent without it."*
 *
 * **The ordinal, not a hash of the recipe.** A digest would make two identical
 * illustrations of one turn the same file, and [06 §10.7] is explicit that
 * *"illustrating an old turn adds; it does not overwrite"* — regenerating until
 * it is right is the thing renditions exist to allow, and two runs of one recipe
 * with different seeds are two pictures.
 *
 * A manual **Illustrate** of an old turn takes the next free ordinal, which is
 * how one scheme serves both and why the store can enumerate a turn's siblings
 * without an index.
 */
export function renditionIdFor(turnId: string, ordinal: number): string {
  return `${turnId}.${String(ordinal)}`;
}

/**
 * The path an id would have, or null when the id cannot be one.
 *
 * `summaries.ts`' guard and its reason, which applies harder here: a rendition
 * id reaches this function from a **route parameter** as well as from a record,
 * so `../../session.json` is a shape somebody will eventually send on purpose
 * rather than only a shape a hand-edited file might hold. Null rather than a
 * throw keeps a miss a miss — the request 404s, which is what it would have done
 * for an id that simply did not exist.
 */
function pathFor(layout: Layout, handle: string, sessionId: string, id: string): string | null {
  try {
    return resolveWithin(renditionsRoot(layout, handle, sessionId), `${id}.json`);
  } catch (error) {
    if (error instanceof PathEscapeError) return null;
    throw error;
  }
}

/**
 * Which ids are held, as one directory read.
 *
 * `listSummaries`' economics for `listSummaries`' reason, and here it is also
 * what {@link readRenditions} is built on: answering *what does this session
 * have* by twenty failed opens would be the cost the per-turn file was supposed
 * to save, paid in a worse place.
 */
export async function listRenditions(
  layout: Layout,
  handle: string,
  sessionId: string,
): Promise<Set<string>> {
  const names = await listEntryNames(renditionsRoot(layout, handle, sessionId));
  return new Set(
    names.filter((name) => name.endsWith('.json')).map((name) => name.slice(0, -'.json'.length)),
  );
}

/**
 * A rendition, or null when there is not a readable one under that id.
 *
 * **Every failure is a miss**, per the header — the read path is the one a
 * session's transcript walks, and it must not be able to fail a page.
 *
 * The id is checked against the file's own field as well as against its name,
 * which is `readSummary`'s check and `readSnapshot`'s: a record copied or
 * renamed is refused rather than believed.
 *
 * ***And `provenance` is checked structurally, which is the arm [P9 §1.1] is
 * actually about.*** That section's warning is that
 * `GeneratedFieldProvenance`'s fields would *"satisfy the type, pass review, and
 * quietly ship a rendition that cannot be reproduced"* — so a record carrying
 * `{ original, at, model, seed: string, unreviewed }` is refused **here**, where
 * a hand-edited file or an older build's output would arrive. The type-level
 * half of the same claim is in `rendition.test.ts`; this is the half that works
 * on bytes.
 */
export async function readRendition(
  layout: Layout,
  handle: string,
  sessionId: string,
  id: string,
): Promise<Rendition | null> {
  const path = pathFor(layout, handle, sessionId, id);
  if (path === null) return null;

  const bytes = await readFileBytes(path);
  if (bytes === null) return null;

  try {
    const held = renditionFrom(JSON.parse(new TextDecoder().decode(bytes)));
    return held?.id === id ? held : null;
  } catch {
    return null;
  }
}

/**
 * A rendition record, or null when this is not one: `readRendition`'s checks,
 * for a record that did not come from this install's disk. The session
 * importer writes what passes, so a record it accepts is one this module
 * would read back.
 */
export function renditionFrom(value: unknown): Rendition | null {
  // Read as unknown rather than as a `Partial<Rendition>`, for `readSummary`'s
  // reason: the file is whatever is on disk, and a declared type would make
  // the checks below look redundant to the compiler while doing the only work
  // that matters.
  if (typeof value !== 'object' || value === null) return null;
  const held = value as Record<string, unknown>;
  if (held['schema'] !== RENDITION_SCHEMA || typeof held['id'] !== 'string') return null;
  if (typeof held['turnId'] !== 'string') return null;
  if (typeof held['digest'] !== 'string') return null;
  if (!isRecipe(held['prompt'])) return null;
  if (!isProvenance(held['provenance'])) return null;
  return held as unknown as Rendition;
}

/**
 * Every rendition this session holds, keyed by id.
 *
 * **One listing and one read each**, which is what the per-file shape costs on
 * the reading side and why it is paid once per request rather than once per
 * turn. A session's renditions are bounded by the turns that have them, and a
 * session where every turn has one is a session that has already spent far more
 * on images than this costs to list.
 *
 * *Unreadable entries are skipped rather than failing the set*, which is the
 * header's rule arriving at the only place it can be observed: one bad file must
 * cost one picture, never a transcript.
 */
export async function readRenditions(
  layout: Layout,
  handle: string,
  sessionId: string,
): Promise<Map<string, Rendition>> {
  const ids = await listRenditions(layout, handle, sessionId);
  const held = new Map<string, Rendition>();
  for (const id of ids) {
    const rendition = await readRendition(layout, handle, sessionId, id);
    if (rendition !== null) held.set(id, rendition);
  }
  return held;
}

/**
 * Writes a rendition, and **fails the caller when it cannot**.
 *
 * The one place this store parts company with the two it copies, argued in the
 * header: a snapshot or a summary lost to a full disk costs compute, and a
 * rendition record lost to one costs the recipe. The caller is a job worker with
 * a status column; a throw it catches becomes a failed rendition with a class, a
 * placeholder and a retry button, which is [06 §10.2]'s answer to every other
 * way this can go wrong and is the right answer to this one too.
 */
export async function writeRendition(
  layout: Layout,
  handle: string,
  sessionId: string,
  rendition: Rendition,
): Promise<void> {
  const path = pathFor(layout, handle, sessionId, rendition.id);
  if (path === null) {
    throw new Error(`Rendition id ${JSON.stringify(rendition.id)} does not name a path.`);
  }
  await ensureDirectory(renditionsRoot(layout, handle, sessionId));
  await writeJsonAtomic(path, rendition);
}

/**
 * The renditions of one turn, oldest first.
 *
 * **Oldest first because accumulation is additive** ([06 §10.7]: *"illustrating
 * an old turn adds; it does not overwrite"*), so the order is the order they
 * were made in and a reader can see which came second. Which one is *shown* is a
 * different question and a different field — `SessionFile.renditionSelection`
 * for an illustration, the `se.backdrop` channel for a backdrop.
 *
 * A pure function over a map the caller already read, rather than a second
 * directory walk: a transcript resolves every visible turn against one read.
 */
export function renditionsOfTurn(all: ReadonlyMap<string, Rendition>, turnId: string): Rendition[] {
  return [...all.values()]
    .filter((rendition) => rendition.turnId === turnId)
    .sort((left, right) => left.createdAt.localeCompare(right.createdAt));
}

/**
 * A backdrop already paid for, or null — [06 §10.1a](../../../../docs/design/06-modes-and-turn-pipeline.md),
 * [P9 §1.7].
 *
 * ***The money function.*** A backdrop generates when the place changes, and the
 * half that matters more is that returning to a place you have been costs
 * nothing: *"before dispatching, the step looks for a ready background rendition
 * in this session whose recipe digest already matches"*.
 *
 * **It resolves to the currently selected sibling rather than the oldest**,
 * which is §10.1a's own clause and is the difference between *a* backdrop for
 * the tavern and *the* backdrop you chose for it: a manual regenerate adds a
 * sibling and selects it, so a digest with three renditions behind it has to
 * answer with the one a person picked. `selected` is the id the `se.backdrop`
 * channel currently names, which the caller reads from reconstructed state —
 * this function does no I/O and takes no view of what *should* be showing.
 *
 * *Only `ready` renditions count.* A pending one is a job already in flight and
 * a failed one is a placeholder; reusing either would either double-dispatch or
 * show nothing, and both read on screen as the feature being broken.
 */
export function reusableBackdrop(
  all: ReadonlyMap<string, Rendition>,
  digest: string,
  selected: string | null,
): Rendition | null {
  const matches = [...all.values()].filter(
    (rendition) =>
      rendition.purpose === 'background' &&
      rendition.state === 'ready' &&
      rendition.digest === digest,
  );
  if (matches.length === 0) return null;

  const chosen = selected === null ? undefined : matches.find((one) => one.id === selected);
  if (chosen !== undefined) return chosen;

  /**
   * **Newest rather than oldest when nothing is selected**, and the asymmetry is
   * deliberate: with no selection there is no choice to honour, and the newest
   * is the one a manual *Set the scene* just made. Falling back to the oldest
   * would make regenerating a backdrop look like it had done nothing.
   */
  return matches.sort((left, right) => right.createdAt.localeCompare(left.createdAt))[0] ?? null;
}

/** Enough of an {@link AssembledPrompt} to be re-runnable. */
function isRecipe(value: unknown): boolean {
  if (typeof value !== 'object' || value === null) return false;
  const prompt = value as Record<string, unknown>;
  return (
    Array.isArray(prompt['fragments']) &&
    typeof prompt['text'] === 'string' &&
    typeof prompt['separator'] === 'string'
  );
}

/**
 * Enough of a {@link RenditionProvenance} to be the recipe rather than a
 * lookalike.
 *
 * `seed` must be a **number or null**, which is the whole check: the type this
 * refuses is `GeneratedFieldProvenance`, whose `seed` is a string holding the
 * prompt an assist ran against. [P9 §1.1] says the two readings are close enough
 * that the wrong one *"would satisfy the type, pass review"* — and `typeof` is
 * where that stops being true of bytes.
 */
function isProvenance(value: unknown): boolean {
  if (typeof value !== 'object' || value === null) return false;
  const provenance = value as Record<string, unknown>;
  const seed = provenance['seed'];
  if (seed !== null && typeof seed !== 'number') return false;
  const workflow = provenance['workflow'];
  return typeof workflow === 'object' && workflow !== null && !Array.isArray(workflow);
}
