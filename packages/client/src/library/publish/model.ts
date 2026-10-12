// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import {
  type Closure,
  type ClosureEdge,
  type ClosureNode,
  type FileSet,
  type FoundNode,
  type MissingNode,
  type NodeKey,
  type PublishRecord,
  type SessionNode,
  tooLargeToTravel,
} from '@storyengine/shared';

/**
 * ***What the review draws, worked out from a closure and the ticks*** —
 * [P16.3g](../../../../../docs/design/workplan/34-p16-world.md).
 *
 * **Pure, and none of it decides what is in the file.** That is `fileSet`'s
 * alone (`shared/src/publish.ts`), which the confirm writes with; everything
 * here is *where* a row is drawn and *what it says*, read off the same closure
 * and the same `FileSet`. A helper here that answered *does this travel* on its
 * own would be the second rule the shared module exists to prevent, so the
 * ones that need it take the `FileSet` and ask it.
 */

/** Whether a node is on: ticked, or untouched and on by default — `fileSet`'s own reading. */
export function isOn(node: ClosureNode, ticked: Readonly<Record<NodeKey, boolean>>): boolean {
  if (node.state !== 'found' && node.state !== 'session') return false;
  if (node.state === 'found' && !node.canUncheck) return true;
  const tick = Object.hasOwn(ticked, node.key) ? ticked[node.key] : undefined;
  return typeof tick === 'boolean' ? tick : node.defaultOn;
}

/**
 * ***The ticks a fresh look keeps*** — *Look again* re-walks the library, and a
 * tick whose key the new closure still holds is the person's choice about the
 * same thing; one whose key is gone named something no longer reached, and
 * keeping it would let it come back ticked if the thing did. [P16.3]'s plan:
 * *Look again keeps the ticks whose keys still exist.*
 */
export function keepKnown(
  ticked: Readonly<Record<NodeKey, boolean>>,
  closure: Closure,
): Record<NodeKey, boolean> {
  const keys = new Set(closure.nodes.map((node) => node.key));
  return Object.fromEntries(Object.entries(ticked).filter(([key]) => keys.has(key)));
}

/** A node's name for a sentence: its own, or the reference's, or the id it was written with. */
export function nameOf(node: ClosureNode | undefined): string {
  if (node === undefined) return '';
  if (node.state === 'missing') return node.ref.name ?? node.ref.id ?? '';
  return node.name ?? node.id;
}

/** The edges that reach a node, the first-reaching one first — every reason it is here. */
export function reasonsOf(closure: Closure, node: ClosureNode): ClosureEdge[] {
  const first = closure.edges[node.parent];
  const rest = node.inbound
    .filter((index) => index !== node.parent)
    .map((index) => closure.edges[index])
    .filter((edge): edge is ClosureEdge => edge !== undefined);
  return first === undefined ? rest : [first, ...rest];
}

/** One depth's rows, with the heading the review gives it. */
export interface DepthGroup {
  depth: 0 | 1 | 2 | 3;
  rows: ClosureNode[];
}

/**
 * ***Every level, grouped*** — [16 §5]'s *every level is shown, not just the
 * first*, as the plan lays it out: what was chosen (or the World's members),
 * what they name, two steps out, and further.
 *
 * **What is drawn as a row**, and why each exclusion is not a hiding:
 *
 * - *A session* is not — it has its own section, because its tick is a
 *   different decision ([16 §5]: one per session, off until ticked).
 * - *A missing reference* is a row only when a starting point is what is
 *   missing (a member deleted since, a chosen id gone); otherwise it is drawn
 *   **under the row that names it** ({@link missingUnder}), which is where a
 *   reader looks for it.
 * - ***What only a session reaches, while no such session is ticked***, is not
 *   a row here: it cannot travel — R1's one cascade — and a ticked box beside
 *   it would say it does. Its session's row counts it instead (*brings N things
 *   not otherwise in the file*), and the moment that session is ticked it is
 *   drawn at its depth with its reason. A ticked box always means *in the
 *   file*.
 */
export function depthGroups(closure: Closure, set: FileSet): DepthGroup[] {
  const carried = new Set(set.sessions.map((session) => session.key));
  const groups: ClosureNode[][] = [[], [], [], []];
  for (const node of closure.nodes) {
    if (node.state === 'session') continue;
    if (node.state === 'missing') {
      const first = closure.edges[node.parent];
      if (first?.from !== null) continue;
    }
    if (node.state === 'found' || node.state === 'missing') {
      if (!node.base && !node.gates.some((gate) => carried.has(gate))) continue;
    }
    groups[Math.min(node.depth, 3)]?.push(node);
  }
  return groups.flatMap((rows, depth) =>
    rows.length === 0 ? [] : [{ depth: depth as DepthGroup['depth'], rows }],
  );
}

/** The missing references a node names — drawn under it, with the edge that names each. */
export function missingUnder(
  closure: Closure,
  key: NodeKey,
): { node: MissingNode; edge: ClosureEdge }[] {
  const byKey = new Map(closure.nodes.map((node) => [node.key, node]));
  const out: { node: MissingNode; edge: ClosureEdge }[] = [];
  const seen = new Set<NodeKey>();
  for (const edge of closure.edges) {
    if (edge.from !== key || seen.has(edge.to)) continue;
    const target = byKey.get(edge.to);
    if (target?.state !== 'missing') continue;
    seen.add(edge.to);
    out.push({ node: target, edge });
  }
  return out;
}

/**
 * ***What a session would bring that nothing else does*** — the found objects
 * reachable only through sessions, with this one among their gates, that are
 * on and would not travel already through another ticked session. *"Brings 1
 * thing not otherwise in the file"* ([P16.3]'s plan): the size of the side
 * door a tick opens, said before it is opened.
 */
export function sessionBrings(
  closure: Closure,
  session: SessionNode,
  set: FileSet,
  ticked: Readonly<Record<NodeKey, boolean>>,
): number {
  const others = new Set(
    set.sessions.filter((one) => one.key !== session.key).map((one) => one.key),
  );
  return closure.nodes.filter(
    (node): node is FoundNode =>
      node.state === 'found' &&
      !node.base &&
      node.writtenByPlay !== true &&
      !tooLarge(node) &&
      node.gates.includes(session.key) &&
      !node.gates.some((gate) => others.has(gate)) &&
      isOn(node, ticked),
  ).length;
}

/**
 * ***Too large to be one file in a World*** — `measureObject`'s mark for an
 * object whose own stored file is over the entry limit: no entries, and that
 * file named in `omitted`. The writer then leaves **the whole object** home as
 * `too-large` with `publish.file.objectTooLarge` (risk 3: *a large card leaves
 * its actor behind; the review shows this before confirm*).
 *
 * *Added 2026-10-11, the P16.3g review*: the review drew such an object as a
 * ticked row, counted it in *In the file*, and called its own file *a picture
 * … stays behind*. `fileSet` still carries it — it is the walk's rule, and the
 * size is the writer's — so this is read here, beside the rule rather than
 * instead of it: the row has no checkbox and says why, the totals leave it
 * out, and *What opening it needs* names the object rather than a picture.
 * The ledger was never wrong: it records the file's manifest, which does not
 * hold it.
 *
 * ***The predicate itself moved to `shared` at [P16.3h]*** (2026-10-11), as
 * `tooLargeToTravel`, because the re-publish diff reads it too: an object too
 * large last time and too large again is in `fileSet`'s carried list and in no
 * ledger record, and a diff with its own reading of *too large* would call it
 * *added* while the rows here said it stays home. This name stays, for the
 * call sites that read it as the review's word.
 */
export function tooLarge(node: FoundNode): boolean {
  return tooLargeToTravel(node);
}

/** The objects the file will hold: `fileSet`'s, less what is too large to be one file. */
export function travelling(set: FileSet): FoundNode[] {
  return set.objects.filter((object) => !tooLarge(object));
}

/** The totals line's numbers — `fileSet`'s, with {@link travelling}'s count of objects. */
export function totalsOf(set: FileSet): FileSet['totals'] {
  return { ...set.totals, objects: travelling(set).length };
}

/** What history would add to what is carried, measured as though asked for ([03 §11.6]). */
export function historyAdds(set: FileSet): { versions: number; bytes: number } {
  let versions = 0;
  let bytes = 0;
  for (const object of set.objects) {
    versions += object.facts?.history.versions ?? 0;
    bytes += object.facts?.history.bytes ?? 0;
  }
  return { versions, bytes };
}

/**
 * ***Orphans, grouped by what they came with*** — so *Leave these out too*
 * unticks one group at a time: the books a dropped treatment brought, and not
 * the ones a dropped setup did, which the person may still want ([P16.3]'s
 * plan, R1: *with Leave these out too on the group*). The group's key is the
 * nearest left-out node each came with.
 */
export function orphanGroups(set: FileSet): { cameWith: NodeKey | null; keys: NodeKey[] }[] {
  const groups = new Map<NodeKey | null, NodeKey[]>();
  for (const orphan of set.orphans) {
    const by = orphan.cameWith[0] ?? null;
    groups.set(by, [...(groups.get(by) ?? []), orphan.key]);
  }
  return [...groups].map(([cameWith, keys]) => ({ cameWith, keys }));
}

/**
 * ***Choose as last time*** — [P16.3h](../../../../../docs/design/workplan/34-p16-world.md),
 * [16 §5](../../../../../docs/design/16-publish.md): the choices the last file
 * was made with, as the ledger recorded them ([22 §9]'s `ticked` and
 * `unticked`, *the person's overrides, both directions*), and its history flag.
 *
 * **Defaults stay the table's, and this is a button, not a default.** The
 * review opens on 04 §9.1's defaults whatever was chosen last time — every
 * user object on, system objects and sessions off — because a session must
 * never come back ticked by itself ([16 §5]: *"a thing to choose rather than a
 * thing to discover you did"*). Pressing this is the choosing.
 *
 * ***What it sets, box by box***, over the person's ticks now (`current`):
 *
 * - **What the record unticked** goes off, and **what it ticked** goes on —
 *   the untick winning where a record names one id in both, which no build
 *   writes: the one way this button may be wrong is by leaving something home.
 * - **A session the record did not tick** goes off (its default). *As last
 *   time* means the boxes as they were, and a session is ticked only when the
 *   record's `ticked` names it.
 * - **An object the last file held**, untouched by the record, takes its
 *   default — on — so a thing the person has unticked since comes back, as it
 *   was.
 * - ***Anything else stays as the person has it*** — chiefly what is new
 *   since. ~~The map answered held only the record's overrides, so every
 *   other box fell back to its default~~ until 2026-10-11 (the P16.3h
 *   review), which turned **on** a book added since that the person had just
 *   unticked: the last file never held it and the record never ticked it, so
 *   *as last time* has nothing to say about it, and turning it on would send a
 *   thing the person had said not to. **This never turns a box on unless the
 *   last file held that thing or the record ticked it.**
 *
 * Only keys the closure holds, so a tick for something no longer reached is not
 * carried in the person's choices to come back with a later *Look again*.
 * Called on every render with the ticks as they are, the answer is also what
 * the status line asks: the boxes are *as last time* exactly when pressing
 * would change none of them ({@link sameTicks}).
 */
export function asLastTime(
  previous: PublishRecord,
  closure: Closure,
  current: Readonly<Record<NodeKey, boolean>>,
): { ticked: Record<NodeKey, boolean>; history: boolean } {
  const ids = (list: unknown, read: (entry: unknown) => unknown): Set<string> =>
    new Set(
      (Array.isArray(list) ? (list as unknown[]) : [])
        .map(read)
        .filter((id): id is string => typeof id === 'string'),
    );
  const unticked = ids(previous.unticked, (entry) => (entry as { id?: unknown } | null)?.id);
  const ticked = ids(previous.ticked, (entry) => entry);
  const held = ids(previous.objects, (entry) => (entry as { id?: unknown } | null)?.id);

  const next: Record<NodeKey, boolean> = {};
  for (const node of closure.nodes) {
    if (node.state !== 'found' && node.state !== 'session') continue;
    const key = node.key;
    if (unticked.has(node.id)) next[key] = false;
    else if (ticked.has(node.id)) next[key] = true;
    else if (node.state === 'session' || held.has(node.id)) continue;
    else if (Object.hasOwn(current, key) && typeof current[key] === 'boolean') {
      next[key] = current[key];
    }
  }
  // Through `unknown`, as `publishDiff` reads it: the line is hand-editable.
  return { ticked: next, history: (previous.history as unknown) === true };
}

/**
 * ***Whether two sets of ticks draw the same file*** — every found object and
 * session on or off alike, by {@link isOn}, so a map that spells a default out
 * and one that leaves it unsaid are the same choice. What the diff's *these
 * are the last file's choices* line is decided by.
 */
export function sameTicks(
  closure: Closure,
  one: Readonly<Record<NodeKey, boolean>>,
  other: Readonly<Record<NodeKey, boolean>>,
): boolean {
  return closure.nodes.every((node) => isOn(node, one) === isOn(node, other));
}
