// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import type {
  Closure,
  ClosureEdge,
  ClosureNode,
  FileSet,
  FoundNode,
  MissingNode,
  NodeKey,
  SessionNode,
} from '@storyengine/shared';

/**
 * ***What the review draws, worked out from a closure and the ticks*** —
 * [P16.3g](../../../../../docs/design/workplan/35-p16-world.md).
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
 */
export function tooLarge(node: FoundNode): boolean {
  return node.facts?.entries === 0 && node.facts.omitted.length > 0;
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
