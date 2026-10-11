// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { describe, expect, it } from 'vitest';

import {
  type Closure,
  type ClosureEdge,
  type ClosureNode,
  type ClosureRule,
  closureTree,
  type FoundNode,
  fileSet,
  mergeRequires,
  type NodeFacts,
  type NodeKey,
  pathTo,
  type PublishOrigin,
  type SessionFacts,
} from './publish.js';
import { ACTOR_SCHEMA } from './schema/actor.js';
import { LOREBOOK_SCHEMA } from './schema/lorebook.js';
import { PRESET_SCHEMA } from './schema/preset.js';
import type { PortableSchemaId } from './schema/registry.js';
import { SETUP_SCHEMA } from './schema/setup.js';
import { TREATMENT_SCHEMA } from './schema/treatment.js';

/**
 * ***The one rule for what is in the file*** — [16 §4](../../../docs/design/16-publish.md),
 * [16 §5](../../../docs/design/16-publish.md), [P16.3a].
 *
 * `fileSet` is what the review draws with and the confirm writes with, so each
 * clause of the rule is a case here: what is on by default, the one cascade
 * (sessions), orphans rather than cascades everywhere else, which left-outs warn
 * and which are silent, and what `leftBehind` may name. **The closures are
 * built by hand**, because the walker is the server's and this module must hold
 * for any closure a client is handed — a stale one included.
 */

// ── A closure, by hand ──────────────────────────────────────────────────────

interface Built {
  nodes: ClosureNode[];
  edges: ClosureEdge[];
}

/**
 * ***Nodes and edges as a walker would produce them***, with the derived parts
 * computed the walker's way: `parent` and `depth` from the first edge into a
 * node, `inbound` from all of them, `base` from the non-session starting points
 * without passing a session, `gates` per session. Kept small and literal so a
 * case reads as its graph.
 */
interface Graph {
  found(key: NodeKey, schema: PortableSchemaId, more?: Partial<FoundNode>): Graph;
  session(
    key: NodeKey,
    more?: { modes?: string[]; leavesBehind?: ('roles' | 'stepRoles')[]; facts?: SessionFacts },
  ): Graph;
  missing(key: NodeKey, expected: string, name: string): Graph;
  excluded(id: string): Graph;
  edge(
    from: NodeKey | null,
    to: NodeKey,
    rule: ClosureRule,
    more?: { required?: boolean; optional?: boolean },
  ): Graph;
  closure(origin?: PublishOrigin): Closure;
}

function graph(): Graph {
  const built: Built = { nodes: [], edges: [] };
  const base = { depth: 0, parent: -1, inbound: [], base: false, gates: [] };
  const api: Graph = {
    found(
      key: NodeKey,
      schema: PortableSchemaId,
      more: Partial<FoundNode> & { facts?: NodeFacts } = {},
    ): Graph {
      built.nodes.push({
        ...base,
        key,
        state: 'found',
        schema,
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
    session(
      key: NodeKey,
      more: {
        modes?: string[];
        leavesBehind?: ('roles' | 'stepRoles')[];
        facts?: SessionFacts;
      } = {},
    ): Graph {
      built.nodes.push({
        ...base,
        key,
        state: 'session',
        id: key,
        name: key,
        updatedAt: '2026-10-10T00:00:00.000Z',
        headTurnId: null,
        archived: false,
        modes: more.modes ?? [],
        leavesBehind: more.leavesBehind ?? [],
        canUncheck: true,
        defaultOn: false,
        ...(more.facts === undefined ? {} : { facts: more.facts }),
      });
      return api;
    },
    missing(key: NodeKey, expected: string, name: string): Graph {
      built.nodes.push({
        ...base,
        key,
        state: 'missing',
        expected,
        ref: { id: `${key}-id`, name },
        required: false,
      });
      return api;
    },
    excluded(id: string): Graph {
      built.nodes.push({
        ...base,
        key: `excluded:${id}`,
        state: 'excluded',
        schema: 'storyengine.world/1',
        id,
        name: 'Inner',
        reason: 'nested-world',
      });
      return api;
    },
    edge(
      from: NodeKey | null,
      to: NodeKey,
      rule: ClosureRule,
      more: { required?: boolean; optional?: boolean } = {},
    ): Graph {
      built.edges.push({
        from,
        to,
        rule,
        field: '/x',
        ref: { id: to, name: null },
        resolvedBy: 'id',
        required: more.required ?? false,
        default: more.optional === true ? 'optional' : 'included',
      });
      return api;
    },
    closure(origin: PublishOrigin = 'world'): Closure {
      const nodes = built.nodes.map((node) => ({
        ...node,
        inbound: [] as number[],
        gates: [] as NodeKey[],
      }));
      const byKey = new Map(nodes.map((node) => [node.key, node]));
      built.edges.forEach((edge, index) => {
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
          for (const edge of built.edges) {
            if (edge.from !== at || order.includes(edge.to)) continue;
            if (byKey.get(edge.to)?.state === 'session') continue;
            order.push(edge.to);
          }
        }
        return order;
      };
      const roots = [...new Set(built.edges.filter((e) => e.from === null).map((e) => e.to))];
      for (const key of reach(roots.filter((key) => byKey.get(key)?.state !== 'session'))) {
        const node = byKey.get(key);
        if (node !== undefined) node.base = true;
      }
      for (const session of nodes.filter((node) => node.state === 'session')) {
        for (const key of reach([session.key]).slice(1)) byKey.get(key)?.gates.push(session.key);
      }
      return {
        start:
          origin === 'world' ? { kind: 'world', id: 'world-1' } : { kind: 'objects', ids: roots },
        origin,
        roots,
        world: null,
        nodes,
        edges: built.edges,
      };
    },
  };
  return api;
}

const keys = (things: { key: NodeKey }[]): NodeKey[] => things.map((one) => one.key);
const noteKeys = (set: ReturnType<typeof fileSet>): string[] => set.notes.map((one) => one.key);
const choose = (ticked: Record<string, boolean> = {}) => ({ ticked, history: false });

/** A World with a treatment that links two books, one required, and casts an actor. */
function rainCity(): Closure {
  return graph()
    .found('rain', TREATMENT_SCHEMA)
    .found('harbour', LOREBOOK_SCHEMA, { required: true })
    .found('weather', LOREBOOK_SCHEMA, { optional: true })
    .found('vera', ACTOR_SCHEMA)
    .found('pack', PRESET_SCHEMA, { owner: 'system', defaultOn: false })
    .session('night-one', { modes: ['scene'] })
    .found('keeper', ACTOR_SCHEMA)
    .edge(null, 'rain', 'world.member')
    .edge(null, 'pack', 'world.member')
    .edge(null, 'night-one', 'world.member')
    .edge('rain', 'harbour', 'treatment.lore', { required: true })
    .edge('rain', 'weather', 'treatment.lore', { optional: true })
    .edge('rain', 'vera', 'treatment.cast')
    .edge('night-one', 'keeper', 'session.hooks.introduces')
    .edge('night-one', 'vera', 'session.cast.actors')
    .closure();
}

// ── The rule ────────────────────────────────────────────────────────────────

describe('what is in the file', () => {
  it('carries every user object by default, and no session and no system object', () => {
    const set = fileSet(rainCity(), choose());
    expect(keys(set.objects)).toEqual(['rain', 'harbour', 'weather', 'vera']);
    expect(set.sessions).toEqual([]);
    expect(set.totals).toMatchObject({ objects: 4, sessions: 0 });
  });

  it('carries a system object when ticked, and a session when ticked', () => {
    const set = fileSet(rainCity(), choose({ pack: true, 'night-one': true }));
    expect(keys(set.objects)).toContain('pack');
    expect(keys(set.sessions)).toEqual(['night-one']);
  });

  /**
   * ***The one cascade.*** What only a session reaches is part of what the
   * Session row excludes until ticked — here, the actor its pool's arrival
   * names — and an actor a member also reaches is not the session's to hold
   * back.
   */
  it('carries what only a ticked session reaches, and never a sibling’s', () => {
    const closure = graph()
      .session('a')
      .session('b')
      .found('ada', ACTOR_SCHEMA)
      .found('bo', ACTOR_SCHEMA)
      .found('both', ACTOR_SCHEMA)
      .edge(null, 'a', 'world.member')
      .edge(null, 'b', 'world.member')
      .edge('a', 'ada', 'session.cast.actors')
      .edge('a', 'both', 'session.hooks.involves')
      .edge('b', 'bo', 'session.cast.actors')
      .edge('b', 'both', 'session.cast.actors')
      .closure();
    expect(keys(fileSet(closure, choose()).objects)).toEqual([]);
    const set = fileSet(closure, choose({ a: true }));
    expect(keys(set.objects)).toEqual(['ada', 'both']);
    expect(keys(set.sessions)).toEqual(['a']);
    expect(keys(fileSet(rainCity(), choose()).objects)).not.toContain('keeper');
    expect(keys(fileSet(rainCity(), choose({ 'night-one': true })).objects)).toContain('keeper');
  });

  /**
   * ***No other cascade.*** Dropping a treatment keeps the books it brought —
   * *send the setting, not my framing* is a real choice — and says they are
   * now named by nothing in the file, with what they came with.
   */
  it('leaves a dropped treatment’s books carried, and flags them as orphans', () => {
    const set = fileSet(rainCity(), choose({ rain: false }));
    expect(keys(set.objects)).toEqual(['harbour', 'weather', 'vera']);
    expect(set.orphans).toEqual([
      { key: 'harbour', cameWith: ['rain'] },
      { key: 'weather', cameWith: ['rain'] },
      { key: 'vera', cameWith: ['rain', 'night-one'] },
    ]);
    expect(set.notes.filter((note) => note.key === 'publish.closure.orphan')).toHaveLength(3);
  });

  /**
   * ***An orphan is what nothing kept still reaches*** — not merely what has no
   * carried node one step behind it. Vera is cast by the treatment and has a
   * book of her own whose hook involves her, which is the ordinary shape of a
   * character's book: Vera and her book name each other. Drop the treatment and
   * each still has a carried node naming it, so a one-hop reading labels
   * neither, and the pair travels ticked with nothing saying it came with what
   * was dropped — the *leave these out too* group could never offer it. The
   * history's book two steps out is the same case without the cycle.
   */
  it('flags what only a dropped treatment reached, at every depth and round a cycle', () => {
    const closure = (): Closure =>
      graph()
        .found('rain', TREATMENT_SCHEMA)
        .found('harbour', LOREBOOK_SCHEMA)
        .found('vera', ACTOR_SCHEMA)
        .found('vera-history', LOREBOOK_SCHEMA)
        .found('old-letters', LOREBOOK_SCHEMA)
        .edge(null, 'rain', 'world.member')
        .edge(null, 'harbour', 'world.member')
        .edge('rain', 'vera', 'treatment.cast')
        .edge('vera', 'vera-history', 'actor.lore')
        .edge('vera-history', 'vera', 'lorebook.hooks.involves')
        .edge('vera-history', 'old-letters', 'lorebook.hooks.involves')
        .closure();
    const set = fileSet(closure(), choose({ rain: false }));
    expect(keys(set.objects)).toEqual(['harbour', 'vera', 'vera-history', 'old-letters']);
    expect(set.orphans).toEqual([
      { key: 'vera', cameWith: ['rain'] },
      { key: 'vera-history', cameWith: ['rain'] },
      { key: 'old-letters', cameWith: ['rain'] },
    ]);
    expect(
      set.notes.filter((note) => note.key === 'publish.closure.orphan').map((one) => one.params),
    ).toEqual(
      ['vera', 'vera-history', 'old-letters'].map((id) => ({ id, name: id, cameWith: 'rain' })),
    );
    // Kept, the treatment reaches all three, and nothing is an orphan.
    expect(fileSet(closure(), choose()).orphans).toEqual([]);
    // Dropping Vera herself strands her book, which came with her and not with
    // Rain — and still with her alone when Rain is dropped too: what brought a
    // dropped node in is that node's story, not the book's.
    for (const ticked of [{ vera: false }, { rain: false, vera: false }]) {
      expect(fileSet(closure(), choose(ticked)).orphans).toEqual([
        { key: 'vera-history', cameWith: ['vera'] },
        { key: 'old-letters', cameWith: ['vera'] },
      ]);
    }
  });

  it('never calls a starting point an orphan, nor something a carried session names', () => {
    const set = fileSet(rainCity(), choose({ rain: false, 'night-one': true }));
    expect(keys(set.orphans.map((one) => ({ key: one.key })))).toEqual(['harbour', 'weather']);
  });

  /**
   * ***Which left-outs say what.*** A required book warns — the recipient will
   * be missing the world, not an extra; an optional one is silent, because that
   * is what *can be unchecked* means; any other `included` link is noted with
   * the rule that made it, because the review states every reason.
   */
  it('warns for a required book left out, is silent for an optional one, notes the rest by rule', () => {
    const set = fileSet(
      rainCity(),
      choose({ harbour: false, weather: false, keeper: false, 'night-one': true }),
    );
    expect(set.requiredLeftOut).toEqual([{ key: 'harbour', by: ['rain'] }]);
    expect(set.notes.filter((note) => note.level === 'warn')).toEqual([
      {
        key: 'publish.closure.requiredLeftOut',
        level: 'warn',
        params: {
          rule: 'treatment.lore',
          id: 'harbour',
          name: 'harbour',
          from: 'rain',
          fromName: 'rain',
        },
      },
    ]);
    expect(set.notes.some((note) => note.params['id'] === 'weather')).toBe(false);
    expect(set.notes).toContainEqual({
      key: 'publish.closure.leftOut',
      level: 'info',
      params: {
        rule: 'session.hooks.introduces',
        id: 'keeper',
        name: 'keeper',
        from: 'night-one',
        fromName: 'night-one',
      },
    });
  });

  it('warns for a missing required link, and notes a missing member', () => {
    const closure = graph()
      .found('rain', TREATMENT_SCHEMA)
      .missing('missing:0', LOREBOOK_SCHEMA, 'Harbour')
      .missing('missing:1', ACTOR_SCHEMA, 'Gone')
      .edge(null, 'rain', 'world.member')
      .edge(null, 'missing:1', 'world.member')
      .edge('rain', 'missing:0', 'treatment.lore', { required: true })
      .closure();
    const set = fileSet(closure, choose());
    expect(set.requiredLeftOut).toEqual([{ key: 'missing:0', by: ['rain'] }]);
    expect(noteKeys(set)).toEqual(['publish.closure.missing', 'publish.closure.requiredMissing']);
    expect(set.leftBehind).toEqual([
      {
        schema: LOREBOOK_SCHEMA,
        id: 'missing:0-id',
        name: 'Harbour',
        reason: 'missing',
        required: true,
        from: ['rain'],
      },
    ]);
  });

  /**
   * ***Membership is not a reference.*** An unticked member is not in the
   * file's World and names nothing the recipient would look for; a book a
   * carried treatment links and that stayed home is a reference the file makes.
   * And nothing an *uncarried* thing names is anybody's business.
   */
  it('names in leftBehind only references from carried things', () => {
    const set = fileSet(rainCity(), choose({ weather: false, rain: false }));
    expect(set.leftBehind).toEqual([]);
    const kept = fileSet(rainCity(), choose({ weather: false }));
    expect(kept.leftBehind).toEqual([
      {
        schema: LOREBOOK_SCHEMA,
        id: 'weather',
        name: 'weather',
        reason: 'unchecked',
        required: false,
        from: ['rain'],
      },
    ]);
    // The unticked session's pool names `keeper`; the session is not carried,
    // so the file names no such reference.
    expect(kept.leftBehind.some((one) => one.id === 'keeper')).toBe(false);
  });

  it('takes modes from carried Setups and ticked sessions, never from what stays home', () => {
    const closure = graph()
      .found('start', SETUP_SCHEMA, { modes: ['scene'] })
      .found('other', SETUP_SCHEMA, { modes: ['chat'] })
      .session('night-one', { modes: ['adventure'] })
      .edge(null, 'start', 'world.member')
      .edge(null, 'other', 'world.member')
      .edge(null, 'night-one', 'world.member')
      .closure();
    expect(fileSet(closure, choose({ other: false })).modes).toEqual(['scene']);
    expect(fileSet(closure, choose({ 'night-one': true })).modes).toEqual([
      'scene',
      'chat',
      'adventure',
    ]);
  });

  it('says one object alone is just the object', () => {
    const closure = graph()
      .found('vera', ACTOR_SCHEMA, { canUncheck: false })
      .edge(null, 'vera', 'selected')
      .closure('object');
    expect(noteKeys(fileSet(closure, choose()))).toEqual(['publish.closure.justTheObject']);
    // And the root of an object start is carried whatever a caller sends.
    expect(keys(fileSet(closure, choose({ vera: false })).objects)).toEqual(['vera']);
  });

  it('ignores a tick for a key the closure does not hold, and a tick that is not a boolean', () => {
    const set = fileSet(
      rainCity(),
      choose({ gone: false, constructor: false, rain: 'no' as unknown as boolean }),
    );
    expect(keys(set.objects)).toEqual(['rain', 'harbour', 'weather', 'vera']);
  });

  it('notes excluded members and the bindings a carried session leaves behind', () => {
    const closure = graph()
      .excluded('inner')
      .session('night-one', { leavesBehind: ['roles', 'stepRoles'] })
      .edge(null, 'excluded:inner', 'world.member')
      .edge(null, 'night-one', 'world.member')
      .closure();
    expect(noteKeys(fileSet(closure, choose()))).toEqual(['publish.closure.excluded']);
    expect(fileSet(closure, choose({ 'night-one': true })).notes).toContainEqual({
      key: 'publish.session.bindingsStayBehind',
      level: 'info',
      params: { id: 'night-one', name: 'night-one', fields: 'roles,stepRoles' },
    });
  });

  it('counts what it carries, with history only when asked', () => {
    const facts: NodeFacts = {
      entries: 3,
      bytes: 300,
      pictures: { count: 2, bytes: 200 },
      history: { versions: 4, entries: 5, bytes: 500 },
      omitted: [],
    };
    const closure = graph()
      .found('vera', ACTOR_SCHEMA, { facts })
      .found('bo', ACTOR_SCHEMA, { facts })
      .session('night-one', {
        facts: { turns: 9, pictures: 1, attachments: 0, missingPixels: 0, entries: 4, bytes: 40 },
      })
      .edge(null, 'vera', 'world.member')
      .edge(null, 'bo', 'world.member')
      .edge(null, 'night-one', 'world.member')
      .closure();
    expect(fileSet(closure, { ticked: { bo: false }, history: false }).totals).toEqual({
      objects: 1,
      sessions: 0,
      entries: 3,
      bytes: 300,
      pictures: 2,
    });
    expect(fileSet(closure, { ticked: { 'night-one': true }, history: true }).totals).toEqual({
      objects: 2,
      sessions: 1,
      entries: 3 + 5 + 3 + 5 + 4,
      bytes: 300 + 500 + 300 + 500 + 40,
      pictures: 5,
    });
  });
});

/**
 * ***What play wrote never leaves*** — 2026-10-10, [P16.3d], the half of
 * [P16.3c]'s *an object play wrote stays home* that the rule was missing. The
 * writer has refused a memory book since P16.3c; until this the walker drew one
 * as an ordinary object and `fileSet` carried it, so the review showed a ticked
 * row for a book the file would not hold. Each clause is a case: never carried
 * whatever the tick, the object start's own root included; listed as
 * `not-portable` with a note, from whatever carried thing names it or from
 * nothing when it is a starting point; a required link to it still warns; and
 * one that only something unticked names is not the file's to mention.
 */
describe('what play wrote', () => {
  const memory = (): Graph =>
    graph()
      .found('rain', TREATMENT_SCHEMA)
      .found('remembered', LOREBOOK_SCHEMA, { writtenByPlay: true })
      .found('vera', ACTOR_SCHEMA);

  it('is never carried, ticked or not, and is named as staying home', () => {
    const closure = memory()
      .edge(null, 'rain', 'world.member')
      .edge(null, 'remembered', 'world.member')
      .edge(null, 'vera', 'world.member')
      .closure();
    for (const ticks of [{}, { remembered: true }]) {
      const set = fileSet(closure, choose(ticks));
      expect(keys(set.objects)).toEqual(['rain', 'vera']);
      expect(set.leftBehind).toEqual([
        {
          schema: LOREBOOK_SCHEMA,
          id: 'remembered',
          name: 'remembered',
          reason: 'not-portable',
          required: false,
          from: [],
        },
      ]);
      expect(set.notes).toContainEqual({
        key: 'publish.closure.writtenByPlay',
        level: 'warn',
        params: { id: 'remembered', name: 'remembered', schema: LOREBOOK_SCHEMA },
      });
      expect(set.totals.objects).toBe(2);
    }
  });

  it('stays home as the one root of an object start, whose canUncheck is about choosing', () => {
    const closure = graph()
      .found('remembered', LOREBOOK_SCHEMA, { writtenByPlay: true, canUncheck: false })
      .edge(null, 'remembered', 'selected')
      .closure('object');
    const set = fileSet(closure, choose());
    expect(set.objects).toEqual([]);
    expect(set.leftBehind.map((one) => one.reason)).toEqual(['not-portable']);
    expect(noteKeys(set)).not.toContain('publish.closure.justTheObject');
  });

  it('is named by what carried thing links it, and a required link still warns', () => {
    const closure = memory()
      .edge(null, 'rain', 'world.member')
      .edge('rain', 'remembered', 'treatment.lore', { required: true })
      .edge('rain', 'vera', 'treatment.cast')
      .closure();
    const set = fileSet(closure, choose());
    expect(set.leftBehind).toEqual([
      {
        schema: LOREBOOK_SCHEMA,
        id: 'remembered',
        name: 'remembered',
        reason: 'not-portable',
        required: true,
        from: ['rain'],
      },
    ]);
    expect(set.requiredLeftOut).toEqual([{ key: 'remembered', by: ['rain'] }]);
    expect(noteKeys(set)).toEqual([
      'publish.closure.requiredLeftOut',
      'publish.closure.writtenByPlay',
    ]);
  });

  it('is not a left-out link either: its own note says why, once', () => {
    const closure = memory()
      .edge(null, 'rain', 'world.member')
      .edge('rain', 'remembered', 'treatment.cast')
      .closure();
    expect(noteKeys(fileSet(closure, choose()))).toEqual(['publish.closure.writtenByPlay']);
  });

  it('says nothing of one only an unticked thing names', () => {
    const closure = memory()
      .session('night-one')
      .edge(null, 'rain', 'world.member')
      .edge(null, 'night-one', 'world.member')
      .edge('night-one', 'remembered', 'session.lore')
      .closure();
    const set = fileSet(closure, choose());
    expect(set.leftBehind).toEqual([]);
    expect(noteKeys(set)).not.toContain('publish.closure.writtenByPlay');
    // Ticked, the session names it and the file says it stayed home.
    const ticked = fileSet(closure, choose({ 'night-one': true }));
    expect(keys(ticked.objects)).toEqual(['rain']);
    expect(ticked.leftBehind).toContainEqual(
      expect.objectContaining({ id: 'remembered', reason: 'not-portable', from: ['night-one'] }),
    );
  });
});

describe('the closure as the review reads it', () => {
  it('shows every level as a tree, with every other reason in alsoFrom', () => {
    const tree = closureTree(rainCity());
    expect(tree.map((root) => root.key)).toEqual(['rain', 'pack', 'night-one']);
    const [rain, , session] = tree;
    expect(rain?.children.map((child) => child.key)).toEqual(['harbour', 'weather', 'vera']);
    expect(rain?.children[2]?.alsoFrom.map((edge) => edge.rule)).toEqual(['session.cast.actors']);
    expect(session?.children.map((child) => child.key)).toEqual(['keeper']);
  });

  it('answers how the walk got to a node, outermost first', () => {
    const closure = graph()
      .found('start', SETUP_SCHEMA)
      .found('rain', TREATMENT_SCHEMA)
      .found('harbour', LOREBOOK_SCHEMA)
      .edge(null, 'start', 'selected')
      .edge('start', 'rain', 'setup.treatment')
      .edge('rain', 'harbour', 'treatment.lore')
      .closure('object');
    expect(pathTo(closure, 'harbour').map((edge) => edge.rule)).toEqual([
      'selected',
      'setup.treatment',
      'treatment.lore',
    ]);
    expect(pathTo(closure, 'nothing')).toEqual([]);
  });
});

describe('requires, derived and authored', () => {
  it('lets the author win by id, and adds what the derivation found besides', () => {
    expect(
      mergeRequires(
        {
          modes: [
            { id: 'scene', minVersion: '1.0.0' },
            { id: 'chat', minVersion: '0.3.0' },
          ],
          extensions: [{ id: 'dice', minVersion: '0.1.0' }],
          capabilities: ['images'],
        },
        {
          modes: [{ id: 'scene', minVersion: '1.2.0' }],
          extensions: [],
          capabilities: ['images', 'audio'],
        },
      ),
    ).toEqual({
      modes: [
        { id: 'scene', minVersion: '1.2.0' },
        { id: 'chat', minVersion: '0.3.0' },
      ],
      extensions: [{ id: 'dice', minVersion: '0.1.0' }],
      capabilities: ['images', 'audio'],
    });
  });

  it('takes the derived list when nothing is authored, and survives a hand-edited one', () => {
    const derived = {
      modes: [{ id: 'scene', minVersion: '1.0.0' }],
      extensions: [],
      capabilities: [],
    };
    expect(mergeRequires(derived, null)).toEqual(derived);
    expect(
      mergeRequires(derived, { modes: 'scene', extensions: null, capabilities: 7 } as never),
    ).toEqual(derived);
  });
});
