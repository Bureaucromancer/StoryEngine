// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import type {
  Closure,
  ClosureEdge,
  ClosureNode,
  ClosureRule,
  FoundNode,
  NodeKey,
  PublishOrigin,
  PublishPreview,
  SessionNode,
} from '@storyengine/shared';

/**
 * ***A closure, by hand, for the review's tests*** — [P16.3g](../../../../../docs/design/workplan/35-p16-world.md).
 *
 * `shared/src/publish.test.ts`'s builder, in the client's terms: nodes and
 * edges as the walker writes them, with the derived parts — `parent`, `depth`,
 * `inbound`, `base`, `gates` — computed the walker's way rather than typed into
 * each case, so a case reads as its graph and cannot hand the review a closure
 * no walker would produce. *A test helper, not a second walker*: it knows
 * nothing about the library, only the shape the preview route answers with.
 */
export interface Graph {
  found(key: NodeKey, schema: string, more?: Partial<FoundNode>): Graph;
  session(key: NodeKey, more?: Partial<SessionNode>): Graph;
  missing(key: NodeKey, expected: string, name: string | null, required?: boolean): Graph;
  excluded(id: string, reason: 'nested-world' | 'unknown-kind', name?: string): Graph;
  edge(
    from: NodeKey | null,
    to: NodeKey,
    rule: ClosureRule,
    more?: Partial<Pick<ClosureEdge, 'required' | 'resolvedBy'>> & { optional?: boolean },
  ): Graph;
  closure(origin?: PublishOrigin, world?: Closure['world']): Closure;
}

export function graph(): Graph {
  const nodes: ClosureNode[] = [];
  const edges: ClosureEdge[] = [];
  const base = { depth: 0, parent: -1, inbound: [], base: false, gates: [] };
  const api: Graph = {
    found(key, schema, more = {}) {
      nodes.push({
        ...base,
        key,
        state: 'found',
        schema: schema as FoundNode['schema'],
        id: key,
        name: key,
        owner: 'user',
        path: `users/ned/library/${key}`,
        contentHash: `sha256:${key}`,
        modes: [],
        required: false,
        optional: false,
        canUncheck: true,
        defaultOn: true,
        ...more,
      });
      return api;
    },
    session(key, more = {}) {
      nodes.push({
        ...base,
        key,
        state: 'session',
        id: key,
        name: key,
        updatedAt: '2026-10-02T09:00:00.000Z',
        headTurnId: null,
        archived: false,
        modes: [],
        leavesBehind: [],
        canUncheck: true,
        defaultOn: false,
        ...more,
      });
      return api;
    },
    missing(key, expected, name, required = false) {
      // The id a reference was written with, as the walker records it — a
      // selection's id that resolves to nothing has no name, only this.
      nodes.push({
        ...base,
        key,
        state: 'missing',
        expected,
        ref: { id: `${key}-id`, name },
        required,
      });
      return api;
    },
    excluded(id, reason, name = 'Inner') {
      nodes.push({
        ...base,
        key: `excluded:${id}`,
        state: 'excluded',
        schema: reason === 'nested-world' ? 'storyengine.world/1' : 'example.widget/1',
        id,
        name,
        reason,
      });
      return api;
    },
    edge(from, to, rule, more = {}) {
      edges.push({
        from,
        to,
        rule,
        field: '/x',
        ref: { id: to, name: null },
        resolvedBy: more.resolvedBy ?? 'id',
        required: more.required ?? false,
        default: more.optional === true ? 'optional' : 'included',
      });
      return api;
    },
    closure(origin = 'world', world = null) {
      const built = nodes.map((node) => ({
        ...node,
        inbound: [] as number[],
        gates: [] as NodeKey[],
      }));
      const byKey = new Map(built.map((node) => [node.key, node]));
      edges.forEach((edge, index) => {
        const node = byKey.get(edge.to);
        if (node === undefined) return;
        if (node.inbound.length === 0) {
          node.parent = index;
          node.depth = edge.from === null ? 0 : (byKey.get(edge.from)?.depth ?? 0) + 1;
        }
        node.inbound.push(index);
      });
      const reach = (from: NodeKey[]): NodeKey[] => {
        const order = [...from];
        for (const at of order) {
          for (const edge of edges) {
            if (edge.from !== at || order.includes(edge.to)) continue;
            if (byKey.get(edge.to)?.state === 'session') continue;
            order.push(edge.to);
          }
        }
        return order;
      };
      const roots = [...new Set(edges.filter((edge) => edge.from === null).map((edge) => edge.to))];
      for (const key of reach(roots.filter((key) => byKey.get(key)?.state !== 'session'))) {
        const node = byKey.get(key);
        if (node !== undefined && node.state !== 'session') node.base = true;
      }
      for (const session of built.filter((node) => node.state === 'session')) {
        for (const key of reach([session.key]).slice(1)) byKey.get(key)?.gates.push(session.key);
      }
      return {
        start:
          origin === 'world'
            ? { kind: 'world', id: world?.id ?? 'world-1' }
            : { kind: 'objects', ids: roots },
        origin,
        roots,
        world,
        nodes: built,
        edges,
      };
    },
  };
  return api;
}

/** A preview around a closure, with the answers the route gives beside it. */
export function previewOf(closure: Closure, more: Partial<PublishPreview> = {}): PublishPreview {
  return {
    closure,
    modeVersions: {},
    suggestedName: closure.world?.name ?? 'Rain City',
    sameAs: [],
    justTheObject: false,
    reviewed: 'sha256:reviewed',
    build: { version: null },
    previous: null,
    ...more,
  };
}

/** A World start's `world`, as the walker reads it; `more` for the diff's World cases. */
export function worldOf(
  name = 'Rain City',
  more: Partial<NonNullable<Closure['world']>> = {},
): NonNullable<Closure['world']> {
  return {
    id: 'world-1',
    name,
    description: '',
    version: '1.0.0',
    contentHash: 'sha256:world',
    about: 'sha256:about',
    requires: { modes: [], extensions: [], capabilities: [] },
    ...more,
  };
}
