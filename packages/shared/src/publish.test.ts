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
  isWrittenByPlay,
  mergeRequires,
  type NodeFacts,
  type NodeKey,
  pathTo,
  PUBLISH_RECORD_SCHEMA,
  publishDiff,
  type PublishOrigin,
  type PublishRecord,
  type SessionFacts,
} from './publish.js';
import { SESSION_SCHEMA } from './publish-constants.js';
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

/** What a session node may be given beside its key — the diff's cases ([P16.3h]) set the last three. */
interface SessionMore {
  modes?: string[];
  leavesBehind?: ('roles' | 'stepRoles')[];
  facts?: SessionFacts;
  name?: string;
  headTurnId?: string | null;
  updatedAt?: string;
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
  session(key: NodeKey, more?: SessionMore): Graph;
  missing(key: NodeKey, expected: string, name: string, id?: string): Graph;
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
    session(key: NodeKey, more: SessionMore = {}): Graph {
      built.nodes.push({
        ...base,
        key,
        state: 'session',
        id: key,
        name: more.name ?? key,
        updatedAt: more.updatedAt ?? '2026-10-10T00:00:00.000Z',
        headTurnId: more.headTurnId ?? null,
        archived: false,
        modes: more.modes ?? [],
        leavesBehind: more.leavesBehind ?? [],
        canUncheck: true,
        defaultOn: false,
        ...(more.facts === undefined ? {} : { facts: more.facts }),
      });
      return api;
    },
    missing(key: NodeKey, expected: string, name: string, id = `${key}-id`): Graph {
      built.nodes.push({
        ...base,
        key,
        state: 'missing',
        expected,
        ref: { id, name },
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
    // The member that is gone is a starting point, with a key of its own
    // (2026-10-11, the P16.3g review): the file does not name it.
    expect(noteKeys(set)).toEqual([
      'publish.closure.missingStart',
      'publish.closure.requiredMissing',
    ]);
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
        facts: {
          turns: 9,
          pictures: 1,
          attachments: 0,
          missingPixels: 0,
          entries: 4,
          bytes: 40,
          digest: '',
        },
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
  /**
   * ***A lorebook's marking, and only a lorebook's*** (2026-10-11, the [P16
   * audit], privacy finding 2): a Setup made from a turn carries
   * `provenance.source: 'session'` too ([P15 §0.3]) and travels. Asked of
   * `LOREBOOK_SCHEMA` itself, which also holds the predicate's own spelling of
   * the id to the constant's.
   */
  it('is a lorebook marked session, and no other kind marked so', () => {
    const marked = { provenance: { source: 'session' } };
    expect(isWrittenByPlay(LOREBOOK_SCHEMA, marked)).toBe(true);
    expect(isWrittenByPlay(SETUP_SCHEMA, marked)).toBe(false);
    expect(isWrittenByPlay(ACTOR_SCHEMA, marked)).toBe(false);
    expect(isWrittenByPlay(LOREBOOK_SCHEMA, { provenance: { source: 'generated' } })).toBe(false);
    expect(isWrittenByPlay(LOREBOOK_SCHEMA, null)).toBe(false);
  });

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

// ── What changed since the last file — [P16.3h] ─────────────────────────────

/**
 * ***The diff a re-publish opens on*** — [16 §5](../../../docs/design/16-publish.md)'s
 * *"what changed since the last file, so 'send them 1.2' is a decision made
 * against what 1.2 actually is"*, [22 §9](../../../docs/design/22-internal-contracts.md),
 * [P16.3h].
 *
 * **What left last time is a ledger record, built by hand here** the way the
 * confirm writes one — stored hashes, a session by its head, its count and its
 * time — and **what would leave now is `fileSet` over a hand-built closure**,
 * which is what the review hands `publishDiff` on every tick. Each case is one
 * clause of the diff: what is new, what changed by its stored hash, a rename,
 * every reason something in the last file is not in this one, a session played
 * on and one only renamed or hidden, the history flag, and the card the writer
 * re-spliced, which must read as the same object it is.
 */
describe('the diff a re-publish opens on', () => {
  /** A ledger line as the confirm writes one, for a World start. */
  const recordOf = (over: Partial<PublishRecord> = {}): PublishRecord => ({
    schema: PUBLISH_RECORD_SCHEMA,
    at: '2026-10-03T10:00:00.000Z',
    build: null,
    origin: 'world',
    start: ['world-1'],
    world: {
      id: 'world-1',
      name: 'Rain City',
      kept: 'existing',
      version: '1.0.0',
      about: 'sha256:about',
    },
    fileName: 'rain-city.seworld',
    bytes: 1,
    entries: 1,
    objects: [],
    sessions: [],
    offered: { objects: 0, sessions: 0 },
    unticked: [],
    ticked: [],
    history: false,
    justTheObject: false,
    missing: 0,
    drift: false,
    ...over,
  });
  /** An object as the record holds what left: its stored hash, by the builder's own spelling. */
  const left = (
    id: string,
    schema: string,
    more: Partial<PublishRecord['objects'][number]> = {},
  ): PublishRecord['objects'][number] => ({
    schema,
    id,
    name: id,
    contentHash: `sha256:${id}`,
    ...more,
  });
  /**
   * A session as the record holds it — with no `digest` unless a case gives
   * one, which is a line from before the digest was recorded: compared by its
   * head and its time.
   */
  const sent = (
    id: string,
    more: Partial<PublishRecord['sessions'][number]> = {},
  ): PublishRecord['sessions'][number] => ({
    id,
    name: id,
    headTurnId: null,
    turns: 0,
    updatedAt: '2026-10-10T00:00:00.000Z',
    digest: '',
    ...more,
  });
  const facts = (turns: number, digest = ''): SessionFacts => ({
    turns,
    pictures: 0,
    attachments: 0,
    missingPixels: 0,
    entries: 1,
    bytes: 1,
    digest,
  });
  /** A World start's `world`, as the walk reads it — the record's own by default. */
  const worldNow = (
    more: Partial<NonNullable<Closure['world']>> = {},
  ): NonNullable<Closure['world']> => ({
    id: 'world-1',
    name: 'Rain City',
    description: '',
    version: '1.0.0',
    contentHash: 'sha256:world',
    about: 'sha256:about',
    requires: { modes: [], extensions: [], capabilities: [] },
    ...more,
  });
  const diffOf = (
    previous: PublishRecord,
    closure: Closure,
    ticked: Record<string, boolean> = {},
    history = false,
  ) => publishDiff(previous, fileSet(closure, { ticked, history }), closure, history);
  const ids = (entries: { id: string }[]): string[] => entries.map((one) => one.id);

  it('says when the last file was made and what it was called', () => {
    const diff = diffOf(recordOf(), graph().closure());
    expect(diff.since).toEqual({ at: '2026-10-03T10:00:00.000Z', fileName: 'rain-city.seworld' });
  });

  it('names what is new, what changed by its stored hash, and counts what did not', () => {
    const closure = graph()
      .found('rain', TREATMENT_SCHEMA)
      .found('vera', ACTOR_SCHEMA, { contentHash: 'sha256:vera-portrait-replaced' })
      .found('harbour', LOREBOOK_SCHEMA)
      .found('pier', LOREBOOK_SCHEMA, { name: 'The Pier' })
      .edge(null, 'rain', 'world.member')
      .edge(null, 'pier', 'world.member')
      .edge('rain', 'vera', 'treatment.cast')
      .edge('rain', 'harbour', 'treatment.lore')
      .closure();
    const diff = diffOf(
      recordOf({
        objects: [
          left('rain', TREATMENT_SCHEMA),
          left('vera', ACTOR_SCHEMA),
          left('harbour', LOREBOOK_SCHEMA),
        ],
      }),
      closure,
    );
    expect(diff.added).toEqual([{ id: 'pier', schema: LOREBOOK_SCHEMA, name: 'The Pier' }]);
    // The name is the same; the stored bytes are not — a portrait replaced.
    expect(diff.changed).toEqual([{ id: 'vera', schema: ACTOR_SCHEMA, name: 'vera' }]);
    expect(diff.unchanged).toBe(2);
    expect(diff.removed).toEqual([]);
  });

  it('says what a renamed object was called in the last file', () => {
    const closure = graph()
      .found('harbour', LOREBOOK_SCHEMA, { name: 'Harbour', contentHash: 'sha256:renamed' })
      .edge(null, 'harbour', 'world.member')
      .closure();
    const diff = diffOf(
      recordOf({ objects: [left('harbour', LOREBOOK_SCHEMA, { name: 'Harbor' })] }),
      closure,
    );
    expect(diff.changed).toEqual([
      { id: 'harbour', schema: LOREBOOK_SCHEMA, name: 'Harbour', renamedFrom: 'Harbor' },
    ]);
  });

  /**
   * ***A card the writer re-spliced is not a changed card*** ([22 §9]). The
   * file's member hashed differently from the stored card — the writer dropped
   * a picture no row names — and the ledger kept the stored hash; the walk
   * reads the stored hash again. The measured size, which is the re-spliced
   * card's, is not part of the comparison, so nothing about the file's bytes
   * can make an untouched card read as edited.
   */
  it('does not call a re-spliced card changed: stored hash against stored hash', () => {
    const closure = graph()
      .found('vera', ACTOR_SCHEMA, {
        contentHash: 'sha256:stored-card',
        facts: {
          entries: 1,
          bytes: 900,
          pictures: { count: 1, bytes: 800 },
          history: { versions: 0, entries: 0, bytes: 0 },
          omitted: [],
        },
      })
      .edge(null, 'vera', 'world.member')
      .closure();
    const diff = diffOf(
      recordOf({
        objects: [left('vera', ACTOR_SCHEMA, { contentHash: 'sha256:stored-card' })],
      }),
      closure,
    );
    expect(diff.changed).toEqual([]);
    expect(diff.unchanged).toBe(1);
  });

  it('says why each thing in the last file is not in this one', () => {
    const closure = graph()
      .found('rain', TREATMENT_SCHEMA)
      // Still reached, and its own box is unticked now.
      .found('weather', LOREBOOK_SCHEMA, { name: 'Weather' })
      // Still reached, through a session that is not ticked now.
      .session('night')
      .found('keeper', ACTOR_SCHEMA, { name: 'The Keeper' })
      // Ticked, and now larger than one file in a World may be.
      .found('atlas', LOREBOOK_SCHEMA, {
        name: 'Atlas',
        facts: {
          entries: 0,
          bytes: 0,
          pictures: { count: 0, bytes: 0 },
          history: { versions: 0, entries: 0, bytes: 0 },
          omitted: [{ ref: 'lorebook.json', bytes: 70 * 1024 * 1024 }],
        },
      })
      // A member the World still names, deleted since.
      .missing('missing:0', LOREBOOK_SCHEMA, 'Old Pier', 'pier')
      .edge(null, 'rain', 'world.member')
      .edge(null, 'night', 'world.member')
      .edge(null, 'atlas', 'world.member')
      .edge(null, 'missing:0', 'world.member')
      .edge('rain', 'weather', 'treatment.lore')
      .edge('night', 'keeper', 'session.cast.actors')
      .closure();
    const diff = diffOf(
      recordOf({
        objects: [
          left('rain', TREATMENT_SCHEMA),
          left('weather', LOREBOOK_SCHEMA),
          left('keeper', ACTOR_SCHEMA),
          left('atlas', LOREBOOK_SCHEMA),
          left('pier', LOREBOOK_SCHEMA, { name: 'Old Pier' }),
          // Taken out of the World since: nothing walked names it.
          left('tide', LOREBOOK_SCHEMA, { name: 'Tide Tables' }),
        ],
      }),
      closure,
      { weather: false },
    );
    expect(diff.removed).toEqual([
      { id: 'weather', schema: LOREBOOK_SCHEMA, name: 'Weather', why: 'left-out' },
      { id: 'keeper', schema: ACTOR_SCHEMA, name: 'The Keeper', why: 'left-out' },
      { id: 'atlas', schema: LOREBOOK_SCHEMA, name: 'Atlas', why: 'too-large' },
      { id: 'pier', schema: LOREBOOK_SCHEMA, name: 'Old Pier', why: 'gone' },
      { id: 'tide', schema: LOREBOOK_SCHEMA, name: 'Tide Tables', why: 'no-longer-reached' },
    ]);
    expect(diff.unchanged).toBe(1);
    // Too large last time is never in a record, so too large again is not *added*.
    expect(ids(diff.added)).toEqual([]);
  });

  it('never calls an object too large to travel added, though fileSet carries it', () => {
    const closure = graph()
      .found('atlas', LOREBOOK_SCHEMA, {
        facts: {
          entries: 0,
          bytes: 0,
          pictures: { count: 0, bytes: 0 },
          history: { versions: 0, entries: 0, bytes: 0 },
          omitted: [{ ref: 'lorebook.json', bytes: 70 * 1024 * 1024 }],
        },
      })
      .edge(null, 'atlas', 'world.member')
      .closure();
    const diff = diffOf(recordOf(), closure);
    expect(diff.added).toEqual([]);
    expect(diff.removed).toEqual([]);
  });

  /**
   * ***Played on is *holds more turns than it did**** — the record's count of
   * the turns its export held, against the walk's count now
   * (`facts.turns`), retries and branches included in both.
   */
  it('names a session played on, and how many more turns it holds', () => {
    const closure = graph()
      .session('night', {
        name: 'Night Market',
        headTurnId: 'turn-13',
        updatedAt: '2026-10-11T08:00:00.000Z',
        facts: facts(13),
      })
      .edge(null, 'night', 'world.member')
      .closure();
    const diff = diffOf(
      recordOf({
        sessions: [sent('night', { name: 'Night Market', headTurnId: 'turn-10', turns: 10 })],
      }),
      closure,
      { night: true },
    );
    expect(diff.sessions.playedOn).toEqual([
      { id: 'night', schema: SESSION_SCHEMA, name: 'Night Market', turnsSince: 3 },
    ]);
    expect(diff.sessions.changed).toEqual([]);
    expect(diff.sessions.unchanged).toBe(0);
  });

  it('calls a session renamed, hidden or rewound but not played changed, never played on', () => {
    const at = '2026-10-10T00:00:00.000Z';
    const later = '2026-10-11T08:00:00.000Z';
    const closure = graph()
      // Renamed: the name and the time moved, the head and the count did not.
      .session('dawn', {
        name: 'Dawn Patrol',
        headTurnId: 'd-4',
        updatedAt: later,
        facts: facts(4),
      })
      // A turn hidden: only the time moved.
      .session('dusk', { headTurnId: 'k-6', updatedAt: later, facts: facts(6) })
      // Rewound to an earlier turn: the head moved, and there is no turn more.
      .session('noon', { headTurnId: 'n-2', updatedAt: later, facts: facts(5) })
      // The head moved and the time did not — a clock set back, a hand edit:
      // the head alone still says it changed.
      .session('dial', { headTurnId: 'h-3', updatedAt: at, facts: facts(3) })
      // Nothing at all.
      .session('still', { headTurnId: 's-1', updatedAt: at, facts: facts(1) })
      .edge(null, 'dawn', 'world.member')
      .edge(null, 'dusk', 'world.member')
      .edge(null, 'noon', 'world.member')
      .edge(null, 'dial', 'world.member')
      .edge(null, 'still', 'world.member')
      .closure();
    const diff = diffOf(
      recordOf({
        sessions: [
          sent('dawn', { name: 'Dawn', headTurnId: 'd-4', turns: 4, updatedAt: at }),
          sent('dusk', { headTurnId: 'k-6', turns: 6, updatedAt: at }),
          sent('noon', { headTurnId: 'n-5', turns: 5, updatedAt: at }),
          sent('dial', { headTurnId: 'h-2', turns: 3, updatedAt: at }),
          sent('still', { headTurnId: 's-1', turns: 1, updatedAt: at }),
        ],
      }),
      closure,
      { dawn: true, dusk: true, noon: true, dial: true, still: true },
    );
    expect(diff.sessions.playedOn).toEqual([]);
    expect(diff.sessions.changed).toEqual([
      { id: 'dawn', schema: SESSION_SCHEMA, name: 'Dawn Patrol', renamedFrom: 'Dawn' },
      { id: 'dusk', schema: SESSION_SCHEMA, name: 'dusk' },
      { id: 'noon', schema: SESSION_SCHEMA, name: 'noon' },
      { id: 'dial', schema: SESSION_SCHEMA, name: 'dial' },
    ]);
    expect(diff.sessions.unchanged).toBe(1);
  });

  it('names sessions ticked now, and those no longer in the file, with why', () => {
    const closure = graph()
      .session('fresh', { name: 'Fresh Start' })
      .session('dusk', { name: 'Dusk' })
      .missing('missing:0', SESSION_SCHEMA, 'Deleted Night', 'deleted')
      .edge(null, 'fresh', 'world.member')
      .edge(null, 'dusk', 'world.member')
      .edge(null, 'missing:0', 'world.member')
      .closure();
    const diff = diffOf(
      recordOf({
        sessions: [
          sent('dusk', { name: 'Dusk' }),
          sent('deleted', { name: 'Deleted Night' }),
          sent('elsewhere', { name: 'Moved Away' }),
        ],
      }),
      closure,
      { fresh: true },
    );
    expect(diff.sessions.nowTicked).toEqual([
      { id: 'fresh', schema: SESSION_SCHEMA, name: 'Fresh Start' },
    ]);
    expect(diff.sessions.noLongerTicked).toEqual([
      { id: 'dusk', schema: SESSION_SCHEMA, name: 'Dusk', why: 'left-out' },
      { id: 'deleted', schema: SESSION_SCHEMA, name: 'Deleted Night', why: 'gone' },
      { id: 'elsewhere', schema: SESSION_SCHEMA, name: 'Moved Away', why: 'no-longer-reached' },
    ]);
  });

  it('says the history flag then and now, which way it flipped', () => {
    const closure = graph()
      .found('rain', TREATMENT_SCHEMA)
      .edge(null, 'rain', 'world.member')
      .closure();
    expect(diffOf(recordOf({ history: true }), closure, {}, false).history).toEqual({
      then: true,
      now: false,
    });
    expect(diffOf(recordOf({ history: false }), closure, {}, true).history).toEqual({
      then: false,
      now: true,
    });
  });

  /**
   * ***It follows the ticks*** — the review calls it on every one, so an
   * unticked row moves out of *unchanged* into *removed*, and a session ticked
   * moves into the comparison, with nothing held between the two calls.
   */
  it('is a function of the ticks: unticking and ticking move things between its lists', () => {
    const closure = graph()
      .found('rain', TREATMENT_SCHEMA)
      .session('night', { headTurnId: 't-2', facts: facts(2) })
      .edge(null, 'rain', 'world.member')
      .edge(null, 'night', 'world.member')
      .closure();
    const previous = recordOf({
      objects: [left('rain', TREATMENT_SCHEMA)],
      sessions: [sent('night', { headTurnId: 't-1', turns: 1 })],
    });
    const before = diffOf(previous, closure);
    expect(before.unchanged).toBe(1);
    expect(before.sessions.noLongerTicked.map((one) => one.why)).toEqual(['left-out']);
    expect(before.sessions.playedOn).toEqual([]);

    const after = diffOf(previous, closure, { rain: false, night: true });
    expect(after.unchanged).toBe(0);
    expect(after.removed.map((one) => [one.id, one.why])).toEqual([['rain', 'left-out']]);
    expect(after.sessions.noLongerTicked).toEqual([]);
    expect(after.sessions.playedOn.map((one) => [one.id, one.turnsSince])).toEqual([['night', 1]]);
  });

  /**
   * ***Changed, by what a session sends*** (2026-10-11, the P16.3h review):
   * where the line and the walk both hashed the session as it travels, the
   * hash decides — so a picture drawn since (which moves no head, no count
   * and no time) is a change, and an archive or a model dial (which move the
   * time and send nothing new) is not. A line from before the hash was kept is
   * still compared by its head and its time.
   */
  it('decides a session changed by what it sends, where both sides hashed it', () => {
    const at = '2026-10-10T00:00:00.000Z';
    const later = '2026-10-11T08:00:00.000Z';
    const closure = graph()
      // A picture drawn since: the same head, count and time; another hash.
      .session('drawn', { headTurnId: 'd-2', updatedAt: at, facts: facts(2, 'sha256:drawn-2') })
      // Archived, or its dials set: the time moved; what it sends did not.
      .session('shelved', {
        headTurnId: 's-2',
        updatedAt: later,
        facts: facts(2, 'sha256:shelved'),
      })
      // Played on, and renamed while it was: played on, saying both.
      .session('played', {
        name: 'Night Market',
        headTurnId: 'p-5',
        updatedAt: later,
        facts: facts(5, 'sha256:played-5'),
      })
      // A line from before the hash: the time moved, so changed.
      .session('older', { headTurnId: 'o-1', updatedAt: later, facts: facts(1, 'sha256:older') })
      .edge(null, 'drawn', 'world.member')
      .edge(null, 'shelved', 'world.member')
      .edge(null, 'played', 'world.member')
      .edge(null, 'older', 'world.member')
      .closure();
    const diff = diffOf(
      recordOf({
        sessions: [
          sent('drawn', { headTurnId: 'd-2', turns: 2, updatedAt: at, digest: 'sha256:drawn-1' }),
          sent('shelved', { headTurnId: 's-2', turns: 2, updatedAt: at, digest: 'sha256:shelved' }),
          sent('played', {
            name: 'Night Bazaar',
            headTurnId: 'p-3',
            turns: 3,
            updatedAt: at,
            digest: 'sha256:played-3',
          }),
          sent('older', { headTurnId: 'o-1', turns: 1, updatedAt: at }),
        ],
      }),
      closure,
      { drawn: true, shelved: true, played: true, older: true },
    );
    expect(diff.sessions.playedOn).toEqual([
      {
        id: 'played',
        schema: SESSION_SCHEMA,
        name: 'Night Market',
        turnsSince: 2,
        renamedFrom: 'Night Bazaar',
      },
    ]);
    expect(diff.sessions.changed).toEqual([
      { id: 'drawn', schema: SESSION_SCHEMA, name: 'drawn' },
      { id: 'older', schema: SESSION_SCHEMA, name: 'older' },
    ]);
    expect(diff.sessions.unchanged).toBe(1);
  });

  /**
   * ***Too large is the writer's reason, never the person's*** — so an
   * object too large to travel that the person has unticked is *left out*,
   * as any unticked thing is: saying *it stays home because of its size*
   * would hide that the box is off.
   */
  it('calls an object too large and unticked left out, not too large', () => {
    const closure = graph()
      .found('atlas', LOREBOOK_SCHEMA, {
        name: 'Atlas',
        facts: {
          entries: 0,
          bytes: 0,
          pictures: { count: 0, bytes: 0 },
          history: { versions: 0, entries: 0, bytes: 0 },
          omitted: [{ ref: 'lorebook.json', bytes: 70 * 1024 * 1024 }],
        },
      })
      .edge(null, 'atlas', 'world.member')
      .closure();
    const diff = diffOf(recordOf({ objects: [left('atlas', LOREBOOK_SCHEMA)] }), closure, {
      atlas: false,
    });
    expect(diff.removed).toEqual([
      { id: 'atlas', schema: LOREBOOK_SCHEMA, name: 'Atlas', why: 'left-out' },
    ]);
  });

  /**
   * ***The World itself*** (2026-10-11, the P16.3h review) — [16 §5]'s *send
   * them 1.2* is a version, and a diff of members alone said *nothing has
   * changed* of a World renamed and re-versioned. Each part is said only
   * where the line holds it.
   */
  it('says the World renamed, re-versioned and re-described — and only what the line records', () => {
    const members = (): Closure =>
      graph().found('rain', TREATMENT_SCHEMA).edge(null, 'rain', 'world.member').closure();
    const withWorld = (world: Closure['world']): Closure => ({ ...members(), world });
    const previous = recordOf({ objects: [left('rain', TREATMENT_SCHEMA)] });

    expect(diffOf(previous, withWorld(worldNow())).world).toEqual({ changed: false });
    expect(
      diffOf(
        previous,
        withWorld(worldNow({ name: 'Rain City Redux', version: '1.2.0', about: 'sha256:tides' })),
      ).world,
    ).toEqual({
      renamedFrom: 'Rain City',
      version: { then: '1.0.0', now: '1.2.0' },
      changed: true,
    });

    // A line from before the version and the hash were kept: its name only.
    const older = recordOf({
      objects: [left('rain', TREATMENT_SCHEMA)],
      world: { id: 'world-1', name: 'Rain City', kept: 'existing' } as never,
    });
    expect(
      diffOf(
        older,
        withWorld(worldNow({ name: 'Rain City Redux', version: '1.2.0', about: 'sha256:tides' })),
      ).world,
    ).toEqual({ renamedFrom: 'Rain City', changed: false });
    // No World to compare with — a closure that is not a World start's.
    expect(diffOf(previous, withWorld(null)).world).toEqual({ changed: false });
  });

  it('reads a hand-edited record without throwing, and says nothing it cannot know', () => {
    const closure = graph()
      .found('rain', TREATMENT_SCHEMA)
      .session('night', { headTurnId: 't-2', facts: facts(5) })
      .edge(null, 'rain', 'world.member')
      .edge(null, 'night', 'world.member')
      .closure();
    const previous = recordOf({
      objects: [
        { id: 'rain', schema: TREATMENT_SCHEMA } as never,
        null as never,
        { name: 'x' } as never,
      ],
      sessions: [{ id: 'night', headTurnId: 't-1', turns: 'many' } as never],
      history: 'yes' as never,
    });
    const diff = diffOf(previous, closure, { night: true });
    // No hash recorded: the diff cannot say it is the same.
    expect(diff.changed.map((one) => one.id)).toEqual(['rain']);
    // No count recorded: the head moved, so changed — never played on by a guessed amount.
    expect(diff.sessions.playedOn).toEqual([]);
    expect(diff.sessions.changed.map((one) => one.id)).toEqual(['night']);
    expect(diff.history.then).toBe(false);
  });
});
