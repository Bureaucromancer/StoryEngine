// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { cp, mkdir, mkdtemp, rename, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  type Closure,
  type ClosureNode,
  type FoundNode,
  fileSet,
  LEGACY_PACKAGE_SCHEMA,
  LOREBOOK_SCHEMA,
  newActor,
  newLorebook,
  newPreset,
  newSetup,
  newTreatment,
  newWorld,
  PRESET_SCHEMA,
  type PublishStart,
  SESSION_SCHEMA,
  type SessionNode,
  worldIdsOf,
} from '@storyengine/shared';

import { rebuild } from '../index-db/rebuild.js';
import { list } from '../library.js';
import { ensureMemoryBook } from '../memory/books.js';
import type { SessionFile } from '../sessions/types.js';
import { makeTestServer, setUpAdmin, type TestServer } from '../test-server.js';
import {
  type ClosureReader,
  type ClosureRefusal,
  libraryReader,
  type Resolved,
  walkClosure,
} from './closure.js';

/**
 * ***The walker, over the table*** — [04 §9.1](../../../../docs/design/04-schemas.md),
 * [16 §4](../../../../docs/design/16-publish.md),
 * [P16 §1.4](../../../../docs/design/workplan/35-p16-world.md), [P16.3a].
 *
 * **Two halves, for the reason `links.ts` records about its setup cast**: the
 * first draft of that reader was wrong in a way its unit test shared, and the
 * route test caught it. So the walker's rules — the bare-ref trap, resolution
 * order, id-only arms, cycles, the sibling rule, the two edges the owner added
 * on 2026-10-10 — are proved over an in-memory library where each case builds
 * exactly what it needs; and the second half walks a real library through real
 * routes, where the only claim is that `libraryReader` is the library — that a
 * setup made by `POST /library/setups` resolves through the real `resolveRef`,
 * that a session started in a World is a member and reaches what it names, and
 * that **a memory book is not reached**, which is the case nothing but a real
 * library could make.
 */

// ── An in-memory library ────────────────────────────────────────────────────

const ME = 'user:ned';

/** A reader method, or the read of a body the reader handed back. */
type Read = keyof ClosureReader | 'body';

interface Shelf {
  /** Puts an object on the shelf, as the person's own or the system's. */
  put<T extends { schema: string; id: string; name: string }>(object: T, owner?: string): T;
  session(file: Partial<SessionFile> & { id: string }): SessionFile;
  reader: ClosureReader;
  /**
   * Every read after this throws, as an index that has gone away would — or,
   * with `which`, only the reads it picks, so a case can let the start resolve
   * and fail one lookup the walk makes after it.
   */
  breaks(message: string, which?: (method: Read, id: string | null) => boolean): void;
  /** How many reads the walk has made — a runaway walk is a failed test, not a hung one. */
  reads(): number;
}

/**
 * ***An in-memory library with the real one's contracts*** — `ref` is id, then
 * case-insensitive name within the kind, then null; `id` and `anyKind` are null
 * when not found and throw when broken; `scopedTo` filters by `worldIdsOf` and
 * orders by name.
 *
 * **Bounded**: past a few thousand reads — lookups and body reads both — it
 * throws. A walk that does not terminate would otherwise spin on resolved
 * promises, where no test timeout can interrupt it, until the heap gives out;
 * so the cycle cases fail by throwing rather than by hanging.
 */
function shelf(): Shelf {
  const rows: Resolved[] = [];
  const sessions = new Map<string, SessionFile>();
  let broken: { message: string; which: (method: Read, id: string | null) => boolean } | null =
    null;
  let reads = 0;
  const read = (method: Read, id: string | null): void => {
    reads += 1;
    if (broken?.which(method, id) === true) throw new Error(broken.message);
    if (reads > 5000) throw new Error('runaway walk');
  };
  const byId = (id: string, kind?: string): Resolved | null =>
    rows.find((row) => row.id === id && (kind === undefined || row.schemaId === kind)) ?? null;

  return {
    put(object, owner = ME) {
      const row = {
        id: object.id,
        schemaId: object.schema,
        name: object.name,
        owner,
        path: `library/${object.schema}/${object.id}`,
        contentHash: `sha256:${object.id}`,
      };
      // The body counts as a read too: a walk memoises references, so a walk
      // that re-expanded what it already holds would make no new lookups and
      // would only show itself by reading bodies — or by running out of memory.
      Object.defineProperty(row, 'body', {
        enumerable: true,
        get: () => {
          read('body', object.id);
          return object;
        },
      });
      rows.push(row as Resolved);
      return object;
    },
    session(file) {
      const full = {
        schema: SESSION_SCHEMA,
        name: 'A session',
        createdAt: '2026-10-10T00:00:00.000Z',
        updatedAt: '2026-10-10T00:00:00.000Z',
        headTurnId: null,
        channels: {},
        ...file,
      } as SessionFile;
      sessions.set(file.id, full);
      return full;
    },
    reader: {
      ref(ref, kind) {
        read('ref', ref.id);
        if (ref.id !== null) {
          const hit = byId(ref.id, kind);
          if (hit !== null) return hit;
        }
        if (ref.name === null) return null;
        const wanted = ref.name.toLowerCase();
        return (
          rows.find((row) => row.schemaId === kind && row.name.toLowerCase() === wanted) ?? null
        );
      },
      id(id, kind) {
        read('id', id);
        return byId(id, kind);
      },
      anyKind(id) {
        read('anyKind', id);
        return byId(id);
      },
      scopedTo(worldId) {
        read('scopedTo', worldId);
        return rows
          .filter(
            (row) =>
              row.schemaId === LOREBOOK_SCHEMA &&
              worldIdsOf((row.body as { scope?: unknown }).scope).includes(worldId),
          )
          .sort((a, b) => a.name.localeCompare(b.name));
      },
      session(id) {
        read('session', id);
        return Promise.resolve(sessions.get(id) ?? null);
      },
    },
    breaks(message, which = () => true) {
      broken = { message, which };
    },
    reads: () => reads,
  };
}

/** A walk that must succeed. */
async function walked(reader: ClosureReader, start: PublishStart): Promise<Closure> {
  const result = await walkClosure(reader, start);
  if ('refusal' in result) throw new Error(`refused: ${result.refusal}`);
  return result;
}

const objects = (...ids: string[]): PublishStart => ({ kind: 'objects', ids });
const world = (id: string): PublishStart => ({ kind: 'world', id });

function nodeOf(closure: Closure, key: string): ClosureNode {
  const node = closure.nodes.find((one) => one.key === key);
  if (node === undefined) throw new Error(`no node ${key}`);
  return node;
}

function foundOf(closure: Closure, key: string): FoundNode {
  const node = nodeOf(closure, key);
  if (node.state !== 'found') throw new Error(`${key} is ${node.state}`);
  return node;
}

/** Every found object's id, in discovery order. */
function foundIds(closure: Closure): string[] {
  return closure.nodes.filter((node) => node.state === 'found').map((node) => node.key);
}

/** The rules of the edges that reach `key`. */
function rulesInto(closure: Closure, key: string): string[] {
  return closure.edges.filter((edge) => edge.to === key).map((edge) => edge.rule);
}

/** What the file would carry with these ticks — `fileSet`, the rule both sides draw with. */
function carried(closure: Closure, ticked: Record<string, boolean> = {}): string[] {
  const set = fileSet(closure, { ticked, history: false });
  return [...set.objects, ...set.sessions].map((one) => one.key);
}

function envelope(object: { schema: string; id: string; name: string }) {
  return { schema: object.schema, id: object.id, name: object.name };
}

/** A whole hook, as `links.test.ts` builds them — a stub proves a reader that never looked. */
function hook(id: string, involves: unknown[], introduces?: unknown): Record<string, unknown> {
  return {
    id,
    title: id,
    premise: '',
    magnitude: 'local',
    involves,
    weight: 1,
    delivery: 'guidance',
    once: true,
    ...(introduces === undefined
      ? {}
      : { introduces: { actor: introduces, entrances: [], primaryEntranceId: null } }),
  };
}

const refTo = (object: { id: string; name: string }) => ({ id: object.id, name: object.name });

// ── Each row, through the walker ────────────────────────────────────────────

describe('each row of 04 §9.1, through the walker', () => {
  it('rows 1 and 2: a treatment’s lore, required and not', async () => {
    const lib = shelf();
    const harbour = lib.put(newLorebook('Harbour'));
    const weather = lib.put(newLorebook('Weather'));
    const rain = lib.put({
      ...newTreatment('Rain'),
      lore: [
        { ref: refTo(harbour), required: true },
        { ref: refTo(weather), required: false },
      ],
    });
    const closure = await walked(lib.reader, objects(rain.id));

    expect(foundIds(closure)).toEqual([rain.id, harbour.id, weather.id]);
    expect(foundOf(closure, harbour.id)).toMatchObject({
      required: true,
      optional: false,
      depth: 1,
    });
    expect(foundOf(closure, weather.id)).toMatchObject({
      required: false,
      optional: true,
      depth: 1,
    });
    expect(closure.edges[foundOf(closure, harbour.id).parent]).toMatchObject({
      from: rain.id,
      rule: 'treatment.lore',
      field: '/lore/0/ref',
      resolvedBy: 'id',
      required: true,
      default: 'included',
    });
  });

  it('row 3: a treatment’s cast', async () => {
    const lib = shelf();
    const vera = lib.put(newActor('Vera'));
    const rain = lib.put({ ...newTreatment('Rain'), cast: [{ ref: refTo(vera), role: '' }] });
    const closure = await walked(lib.reader, objects(rain.id));
    expect(rulesInto(closure, vera.id)).toEqual(['treatment.cast']);
  });

  it('row 4: a treatment’s hooks — involves and the introduced actor', async () => {
    const lib = shelf();
    const ada = lib.put(newActor('Ada'));
    const cy = lib.put(newActor('Cy'));
    const rain = lib.put({
      ...newTreatment('Rain'),
      hooks: [hook('h-1', [refTo(ada)], refTo(cy))],
    });
    const closure = await walked(lib.reader, objects(rain.id));
    expect(rulesInto(closure, ada.id)).toEqual(['treatment.hooks.involves']);
    expect(rulesInto(closure, cy.id)).toEqual(['treatment.hooks.introduces']);
  });

  it('row 5: an actor’s bare lore Refs', async () => {
    const lib = shelf();
    const harbour = lib.put(newLorebook('Harbour'));
    const vera = lib.put({ ...newActor('Vera'), lore: [refTo(harbour)] });
    const closure = await walked(lib.reader, objects(vera.id));
    expect(rulesInto(closure, harbour.id)).toEqual(['actor.lore']);
  });

  it('row 6: a setup’s treatment, and the treatment’s closure under it', async () => {
    const lib = shelf();
    const harbour = lib.put(newLorebook('Harbour'));
    const rain = lib.put({
      ...newTreatment('Rain'),
      lore: [{ ref: refTo(harbour), required: false }],
    });
    const start = lib.put({ ...newSetup('Start'), treatment: refTo(rain) });
    const closure = await walked(lib.reader, objects(start.id));
    expect(rulesInto(closure, rain.id)).toEqual(['setup.treatment']);
    // Every level, not the first: the book is two steps out and still here.
    expect(foundOf(closure, harbour.id).depth).toBe(2);
  });

  it('row 7: a setup’s own lore and its cast’s three fields', async () => {
    const lib = shelf();
    const harbour = lib.put(newLorebook('Harbour'));
    const you = lib.put(newActor('You'));
    const vera = lib.put(newActor('Vera'));
    const voice = lib.put(newActor('The voice'));
    const start = lib.put({
      ...newSetup('Start'),
      lore: [{ ref: refTo(harbour), required: true }],
      cast: { personaOptions: [refTo(you)], partyDefault: [refTo(vera)], narrator: refTo(voice) },
    });
    const closure = await walked(lib.reader, objects(start.id));
    expect(rulesInto(closure, harbour.id)).toEqual(['setup.lore']);
    expect(foundOf(closure, harbour.id).required).toBe(true);
    expect([you, vera, voice].map((one) => rulesInto(closure, one.id))).toEqual([
      ['setup.cast.personaOptions'],
      ['setup.cast.partyDefault'],
      ['setup.cast.narrator'],
    ]);
  });

  it('row 8: a setup’s own hooks', async () => {
    const lib = shelf();
    const ada = lib.put(newActor('Ada'));
    const cy = lib.put(newActor('Cy'));
    const start = lib.put({ ...newSetup('Start'), hooks: [hook('h-1', [refTo(ada)], refTo(cy))] });
    const closure = await walked(lib.reader, objects(start.id));
    expect(rulesInto(closure, ada.id)).toEqual(['setup.hooks.involves']);
    expect(rulesInto(closure, cy.id)).toEqual(['setup.hooks.introduces']);
  });

  it('row 9: a setup’s preset, optional', async () => {
    const lib = shelf();
    const pack = lib.put(newPreset('Pack'));
    const start = lib.put({ ...newSetup('Start'), preset: refTo(pack) });
    const closure = await walked(lib.reader, objects(start.id));
    expect(foundOf(closure, pack.id)).toMatchObject({ schema: PRESET_SCHEMA, optional: true });
  });

  it('row 10: a lorebook’s hooks, and not its entries', async () => {
    const lib = shelf();
    const ada = lib.put(newActor('Ada'));
    const cy = lib.put(newActor('Cy'));
    const harbour = lib.put({
      ...newLorebook('Harbour'),
      hooks: [hook('h-1', [refTo(ada)], refTo(cy))],
    });
    const closure = await walked(lib.reader, objects(harbour.id));
    expect(foundIds(closure)).toEqual([harbour.id, ada.id, cy.id]);
  });

  it('row 11: a World’s members, in order, as the starting points', async () => {
    const lib = shelf();
    const vera = lib.put(newActor('Vera'));
    const harbour = lib.put(newLorebook('Harbour'));
    const rain = lib.put({
      ...newWorld('Rain City'),
      contents: [envelope(harbour), envelope(vera)],
    });
    const closure = await walked(lib.reader, world(rain.id));
    expect(closure.origin).toBe('world');
    expect(closure.roots).toEqual([harbour.id, vera.id]);
    expect(closure.world).toMatchObject({ id: rain.id, name: 'Rain City', version: '1.0.0' });
    expect(closure.edges.map((edge) => [edge.from, edge.rule, edge.field])).toEqual([
      [null, 'world.member', '/contents/0'],
      [null, 'world.member', '/contents/1'],
    ]);
  });

  /**
   * ***Row 12, the owner's second answer*** (2026-10-10). A book whose scope
   * names the World is offered to every session started in it, so it travels
   * with the World — reached by asking, since nothing the World holds names it,
   * and each one a starting point the person can untick.
   */
  describe('row 12: the books scoped to the World', () => {
    function scoped() {
      const lib = shelf();
      const vera = lib.put(newActor('Vera'));
      const rain = newWorld('Rain City');
      const other = newWorld('Elsewhere');
      const tides = lib.put({
        ...newLorebook('Tides'),
        scope: { kind: 'world', worldIds: [rain.id] },
        hooks: [hook('h-1', [refTo(vera)])],
      });
      const docks = lib.put({
        ...newLorebook('Docks'),
        scope: { kind: 'world', worldIds: [other.id, rain.id] },
      });
      const elsewhere = lib.put({
        ...newLorebook('Far away'),
        scope: { kind: 'world', worldIds: [other.id] },
      });
      const plain = lib.put(newLorebook('Harbour'));
      lib.put({ ...rain, contents: [envelope(plain)] });
      lib.put({ ...other, contents: [] });
      return { lib, rain, tides, docks, elsewhere, plain, vera };
    }

    it('reaches every book scoped to it, by name, after the members, each uncheckable', async () => {
      const { lib, rain, tides, docks, plain, vera } = scoped();
      const closure = await walked(lib.reader, world(rain.id));
      expect(closure.roots).toEqual([plain.id, docks.id, tides.id]);
      const edge = closure.edges[foundOf(closure, docks.id).parent];
      expect(edge).toMatchObject({
        from: null,
        rule: 'world.scopedBook',
        field: '/scope/worldIds/1',
        ref: { id: rain.id, name: null },
        resolvedBy: 'id',
        default: 'included',
      });
      expect(foundOf(closure, tides.id)).toMatchObject({
        canUncheck: true,
        defaultOn: true,
        depth: 0,
      });
      // And each one's closure: the actor its hook names.
      expect(rulesInto(closure, vera.id)).toEqual(['lorebook.hooks.involves']);
      expect(carried(closure, { [tides.id]: false })).not.toContain(tides.id);
      expect(carried(closure, { [tides.id]: false })).toContain(docks.id);
    });

    it('does not reach a book scoped to another World', async () => {
      const { lib, rain, elsewhere } = scoped();
      const closure = await walked(lib.reader, world(rain.id));
      expect(foundIds(closure)).not.toContain(elsewhere.id);
    });

    /**
     * The scope arm is an inbound statement, read from the World's end and only
     * there: a selection holding a scoped book reaches the book's own closure,
     * and neither the World it names nor the other books scoped to it.
     */
    it('is never asked from a selection — a scoped book there reaches no World and no sibling', async () => {
      const { lib, tides, plain, vera } = scoped();
      const closure = await walked(lib.reader, objects(tides.id, plain.id));
      expect(foundIds(closure)).toEqual([tides.id, plain.id, vera.id]);
      expect(closure.edges.some((edge) => edge.rule === 'world.scopedBook')).toBe(false);
    });

    it('is one node for a book that is both a member and scoped, and for a copy answered twice', async () => {
      const lib = shelf();
      const rain = newWorld('Rain City');
      const tides = lib.put({
        ...newLorebook('Tides'),
        scope: { kind: 'world', worldIds: [rain.id] },
      });
      // The same id on the shelf twice, as a copied folder would be; this
      // query answers both, where the real one drops the shadowed copy.
      lib.put(tides);
      lib.put({ ...rain, contents: [envelope(tides)] });
      const closure = await walked(lib.reader, world(rain.id));
      expect(closure.nodes).toHaveLength(1);
      expect(rulesInto(closure, tides.id)).toEqual([
        'world.member',
        'world.scopedBook',
        'world.scopedBook',
      ]);
    });
  });

  describe('row 13: a session’s links, and the actors its hook pool names', () => {
    it('reaches its treatment, lore, persona and actors, by id', async () => {
      const lib = shelf();
      const rain = lib.put(newTreatment('Rain'));
      const harbour = lib.put(newLorebook('Harbour'));
      const you = lib.put(newActor('You'));
      const vera = lib.put(newActor('Vera'));
      const session = lib.session({
        id: 'session-1',
        treatment: rain.id,
        lore: [harbour.id],
        cast: { persona: you.id, actors: [vera.id] },
      });
      const home = lib.put({
        ...newWorld('Rain City'),
        contents: [{ schema: SESSION_SCHEMA, id: session.id, name: 'Night one' }],
      });
      const closure = await walked(lib.reader, world(home.id));
      expect(nodeOf(closure, session.id)).toMatchObject({
        state: 'session',
        depth: 0,
        canUncheck: true,
        defaultOn: false,
        base: false,
        gates: [],
      });
      expect([rain, harbour, you, vera].map((one) => rulesInto(closure, one.id))).toEqual([
        ['session.treatment'],
        ['session.lore'],
        ['session.cast.persona'],
        ['session.cast.actors'],
      ]);
    });

    /**
     * ***The owner's first answer*** (2026-10-10), and its gate. A pooled
     * hook's `involves` is followed fired or not; its `introduces.actor` only
     * while unfired. Everything the pool reaches is reached *through the
     * session*, so it travels exactly when the session is ticked.
     */
    it('reaches pooled hooks’ actors only through the session, and only when it is ticked', async () => {
      const lib = shelf();
      const ada = lib.put(newActor('Ada'));
      const bo = lib.put(newActor('Bo'));
      const cy = lib.put(newActor('Cy'));
      const di = lib.put(newActor('Di'));
      const session = lib.session({
        id: 'session-1',
        hooks: [
          {
            hook: hook('fired-one', [refTo(ada)], refTo(cy)) as never,
            source: { kind: 'session' },
          },
          { hook: hook('waiting', [refTo(bo)], refTo(di)) as never, source: { kind: 'session' } },
        ],
        channels: { 'se.hook#fired-one': { value: 'fired' } } as never,
      });
      const home = lib.put({
        ...newWorld('Rain City'),
        contents: [{ schema: SESSION_SCHEMA, id: session.id, name: 'Night one' }],
      });
      const closure = await walked(lib.reader, world(home.id));

      // involves either way — the fired hook's and the waiting one's; the fired
      // arrival's subject not; the unfired one's yes.
      expect(rulesInto(closure, ada.id)).toEqual(['session.hooks.involves']);
      expect(rulesInto(closure, bo.id)).toEqual(['session.hooks.involves']);
      expect(foundIds(closure)).not.toContain(cy.id);
      expect(rulesInto(closure, di.id)).toEqual(['session.hooks.introduces']);

      for (const actor of [ada, bo, di]) {
        expect(foundOf(closure, actor.id)).toMatchObject({ base: false, gates: [session.id] });
      }
      expect(carried(closure)).toEqual([]);
      expect(carried(closure, { [session.id]: true })).toEqual([ada.id, bo.id, di.id, session.id]);
    });

    it('does not reach an actor named by a pooled hook’s source', async () => {
      const lib = shelf();
      const rain = lib.put(newTreatment('Rain'));
      const session = lib.session({
        id: 'session-1',
        hooks: [{ hook: hook('h-1', []) as never, source: { kind: 'treatment', id: rain.id } }],
      });
      const home = lib.put({
        ...newWorld('Rain City'),
        contents: [{ schema: SESSION_SCHEMA, id: session.id, name: 'Night one' }],
      });
      expect(foundIds(await walked(lib.reader, world(home.id)))).toEqual([]);
    });
  });
});

// ── The rules a walker built against the table has to get right ─────────────

describe('what a walker has to get right', () => {
  /**
   * ***The bare-ref trap*** — 04 §9.1's paragraph, as a count. A walker that
   * read `involves[].ref` would find the introduced actor and nothing else, and
   * would still find *something*, which is why the number is four.
   */
  it('three involves and an introduces give four actors', async () => {
    const lib = shelf();
    const ada = lib.put(newActor('Ada'));
    const bo = lib.put(newActor('Bo'));
    const cy = lib.put(newActor('Cy'));
    const di = lib.put(newActor('Di'));
    const rain = lib.put({
      ...newTreatment('Rain'),
      hooks: [hook('h-1', [refTo(ada), refTo(bo)]), hook('h-2', [refTo(cy)], refTo(di))],
    });
    const closure = await walked(lib.reader, objects(rain.id));
    expect(foundIds(closure)).toEqual([rain.id, ada.id, bo.id, cy.id, di.id]);
  });

  /**
   * ***Resolution order, and what it records.*** By id, then by name within
   * the kind — a book called *Vera* is not the actor *Vera* — then missing. A
   * hit by name says so (the review's *found by name*), and **merges with the
   * same object reached directly**: one node keyed by the id it resolved to.
   */
  it('resolves by id, then by name within the kind, then reports it missing', async () => {
    const lib = shelf();
    const vera = lib.put(newActor('Vera'));
    const bo = lib.put(newActor('Bo'));
    lib.put(newLorebook('Keeper'));
    const rain = lib.put({
      ...newTreatment('Rain'),
      cast: [
        { ref: { id: vera.id, name: 'Bo' } }, // id wins over a name that names someone else
        { ref: { id: 'foreign-1', name: 'bo' } }, // a foreign id, found by name
        { ref: { id: 'foreign-2', name: 'Keeper' } }, // a book's name is not an actor's
      ],
    });
    const closure = await walked(lib.reader, objects(rain.id, bo.id));
    const [byId, byName, missing] = closure.edges.filter((edge) => edge.from === rain.id);
    expect([byId?.to, byId?.resolvedBy]).toEqual([vera.id, 'id']);
    expect([byName?.to, byName?.resolvedBy]).toEqual([bo.id, 'name']);
    expect(nodeOf(closure, missing?.to ?? '')).toMatchObject({
      state: 'missing',
      expected: 'storyengine.actor/1',
      ref: { id: 'foreign-2', name: 'Keeper' },
    });
    expect(missing?.resolvedBy).toBeNull();
    // Bo reached as a starting point and by name is one node with both edges.
    expect(closure.nodes.filter((node) => node.key === bo.id)).toHaveLength(1);
    expect(rulesInto(closure, bo.id)).toEqual(['selected', 'treatment.cast']);
  });

  /**
   * ***Id-only means id-only.*** A World member and a session's links resolve
   * by id alone: the World editor matches members by id, and a name arm here
   * would quietly publish *a* Vera because *the* Vera was deleted.
   */
  it('never falls back to a name on an envelope or a session link', async () => {
    const lib = shelf();
    const vera = lib.put(newActor('Vera'));
    const rain = lib.put(newTreatment('Rain'));
    const session = lib.session({
      id: 'session-1',
      // Hand-edited into a Ref: the name is there, and must not be used.
      treatment: { id: 'gone-treatment', name: rain.name } as never,
    });
    const home = lib.put({
      ...newWorld('Rain City'),
      contents: [
        { schema: 'storyengine.actor/1', id: 'gone-actor', name: 'Vera' },
        { schema: SESSION_SCHEMA, id: session.id, name: 'Night one' },
      ],
    });
    const closure = await walked(lib.reader, world(home.id));
    expect(foundIds(closure)).not.toContain(vera.id);
    expect(foundIds(closure)).not.toContain(rain.id);
    expect(closure.nodes.filter((node) => node.state === 'missing')).toHaveLength(2);
  });

  /**
   * ***One absence, one row*** — whatever each reference happened to call it.
   * Three hooks written at three moments name the deleted actor three ways (a
   * name since changed, a bare id, the name it had), and the review lists one
   * missing actor with three reasons. A name-only reference stays its own row:
   * with no id there is nothing to say it is the same person.
   */
  it('makes a deleted actor three hooks name one missing node with three inbound edges', async () => {
    const lib = shelf();
    const rain = lib.put({
      ...newTreatment('Rain'),
      hooks: [
        hook('h-1', [{ id: 'actor-gone', name: 'Vera' }]),
        hook('h-2', ['actor-gone']),
        hook('h-3', [], { id: 'actor-gone', name: 'V.' }),
        hook('h-4', [{ name: 'Somebody' }]),
      ],
    });
    const closure = await walked(lib.reader, objects(rain.id));
    const missing = closure.nodes.filter((node) => node.state === 'missing');
    expect(missing.map((node) => node.inbound.length)).toEqual([3, 1]);
  });

  it('terminates on a cycle — actor → book → actor', async () => {
    const lib = shelf();
    const vera = newActor('Vera');
    const harbour = lib.put({ ...newLorebook('Harbour'), hooks: [hook('h-1', [refTo(vera)])] });
    lib.put({ ...vera, lore: [refTo(harbour)] });
    const closure = await walked(lib.reader, objects(vera.id));
    expect(foundIds(closure)).toEqual([vera.id, harbour.id]);
    expect(rulesInto(closure, vera.id)).toEqual(['selected', 'lorebook.hooks.involves']);
  });

  it('terminates on a World holding itself, which is excluded unread', async () => {
    const lib = shelf();
    const rain = newWorld('Rain City');
    lib.put({
      ...rain,
      contents: [envelope(rain), { ...envelope(rain), schema: 'storyengine.actor/1' }],
    });
    const closure = await walked(lib.reader, world(rain.id));
    expect(closure.nodes).toEqual([
      expect.objectContaining({ key: `excluded:${rain.id}`, reason: 'nested-world' }),
    ]);
  });

  it('excludes a World member under either name, and a kind this build does not know', async () => {
    const lib = shelf();
    const inner = lib.put(newWorld('Inner'));
    const home = lib.put({
      ...newWorld('Rain City'),
      contents: [
        envelope(inner),
        { schema: LEGACY_PACKAGE_SCHEMA, id: 'old-package', name: 'Old' },
        { schema: 'storyengine.campaign/1', id: 'campaign-1', name: 'Later' },
      ],
    });
    const closure = await walked(lib.reader, world(home.id));
    expect(
      closure.nodes.map((node) => [node.key, node.state === 'excluded' && node.reason]),
    ).toEqual([
      [`excluded:${inner.id}`, 'nested-world'],
      ['excluded:old-package', 'nested-world'],
      ['excluded:campaign-1', 'unknown-kind'],
    ]);
    // Excluded is unread: the inner World's members are not walked.
    expect(fileSet(closure, { ticked: {}, history: false }).notes.map((note) => note.key)).toEqual([
      'publish.closure.excluded',
      'publish.closure.excluded',
      'publish.closure.excluded',
    ]);
  });

  /**
   * ***Every starting point is placed before anything is expanded.*** Here the
   * treatment links the book and the World also holds it: a walker that
   * expanded the treatment before placing the book would put it a level down
   * under the wrong parent.
   */
  it('keeps the shallowest depth when a node is reached twice', async () => {
    const lib = shelf();
    const harbour = lib.put(newLorebook('Harbour'));
    const rain = lib.put({
      ...newTreatment('Rain'),
      lore: [{ ref: refTo(harbour), required: false }],
    });
    const home = lib.put({
      ...newWorld('Rain City'),
      contents: [envelope(rain), envelope(harbour)],
    });
    const closure = await walked(lib.reader, world(home.id));
    const book = foundOf(closure, harbour.id);
    expect(book.depth).toBe(0);
    expect(closure.edges[book.parent]?.rule).toBe('world.member');
    expect(book.inbound).toHaveLength(2);
  });

  it('walks the same library to a deep-equal closure twice', async () => {
    const lib = shelf();
    const vera = lib.put(newActor('Vera'));
    const harbour = lib.put({ ...newLorebook('Harbour'), hooks: [hook('h-1', [refTo(vera)])] });
    const session = lib.session({ id: 'session-1', cast: { persona: null, actors: [vera.id] } });
    const home = lib.put({
      ...newWorld('Rain City'),
      contents: [envelope(harbour), { schema: SESSION_SCHEMA, id: session.id, name: 'One' }],
    });
    expect(await walked(lib.reader, world(home.id))).toEqual(
      await walked(lib.reader, world(home.id)),
    );
  });

  /**
   * ***Never a sibling session*** — 04 §9.1's Session row, *the row's point*.
   * There is no edge from one session to another to follow, so what is left to
   * get wrong is the gate: ticking A must carry what A names and nothing only B
   * names, and an actor both name is A's to carry when A is ticked.
   */
  it('ticking session A never reaches session B, or what only B names', async () => {
    const lib = shelf();
    const ada = lib.put(newActor('Ada'));
    const bo = lib.put(newActor('Bo'));
    const both = lib.put(newActor('Both'));
    const a = lib.session({ id: 'session-a', cast: { persona: null, actors: [ada.id, both.id] } });
    const b = lib.session({
      id: 'session-b',
      cast: { persona: null, actors: [bo.id, both.id] },
      memory: { associations: { 'session-a': 'always' } } as never,
    });
    const home = lib.put({
      ...newWorld('Rain City'),
      contents: [
        { schema: SESSION_SCHEMA, id: a.id, name: 'A' },
        { schema: SESSION_SCHEMA, id: b.id, name: 'B' },
      ],
    });
    const closure = await walked(lib.reader, world(home.id));
    expect(closure.edges.some((edge) => edge.from === a.id && edge.to === b.id)).toBe(false);
    expect(closure.edges.some((edge) => edge.from === b.id && edge.to === a.id)).toBe(false);
    expect(foundOf(closure, both.id).gates).toEqual([a.id, b.id]);
    expect(carried(closure, { [a.id]: true })).toEqual([ada.id, both.id, a.id]);
  });

  it('rejects the walk when the index fails, rather than calling everything missing', async () => {
    const lib = shelf();
    const vera = lib.put(newActor('Vera'));
    lib.breaks('database is locked');
    await expect(walkClosure(lib.reader, objects(vera.id))).rejects.toThrow('database is locked');
  });

  /**
   * ***And when it fails after the start has resolved*** (2026-10-10, the
   * P16.3a review). The case above fails the first read there is, so a walker
   * that caught errors anywhere past the start — around a `Ref`, an id-only
   * arm, the scope query — would still pass it, and publish a file that says a
   * book is gone because a query failed. Each lookup the walk makes after the
   * start is broken here on its own.
   */
  it('rejects when a lookup past the start fails — a Ref, an id-only arm, the scope query', async () => {
    const lib = shelf();
    const harbour = lib.put(newLorebook('Harbour'));
    const weather = lib.put(newLorebook('Weather'));
    const rain = lib.put({
      ...newTreatment('Rain'),
      lore: [{ ref: refTo(harbour), required: true }],
    });
    const session = lib.session({ id: 'session-1', lore: [weather.id] });
    const home = lib.put({
      ...newWorld('Rain City'),
      contents: [envelope(harbour), { schema: SESSION_SCHEMA, id: session.id, name: 'One' }],
    });
    const failing = 'database is locked';

    lib.breaks(failing, (method) => method === 'ref');
    await expect(walkClosure(lib.reader, objects(rain.id))).rejects.toThrow(failing);

    // Both id-only arms: a member's envelope, and a session's bare-id link.
    lib.breaks(failing, (method, id) => method === 'id' && id === harbour.id);
    await expect(walkClosure(lib.reader, world(home.id))).rejects.toThrow(failing);
    lib.breaks(failing, (method, id) => method === 'id' && id === weather.id);
    await expect(walkClosure(lib.reader, world(home.id))).rejects.toThrow(failing);

    lib.breaks(failing, (method) => method === 'scopedTo');
    await expect(walkClosure(lib.reader, world(home.id))).rejects.toThrow(failing);

    // And each of those starts walks when nothing is broken, so the failures
    // above are the lookups', not the starts'.
    lib.breaks(failing, () => false);
    await expect(walked(lib.reader, objects(rain.id))).resolves.toBeDefined();
    await expect(walked(lib.reader, world(home.id))).resolves.toBeDefined();
  });

  it('reports an unreadable session as a missing member', async () => {
    const lib = shelf();
    const home = lib.put({
      ...newWorld('Rain City'),
      contents: [{ schema: SESSION_SCHEMA, id: 'session-gone', name: 'Lost' }],
    });
    const closure = await walked(lib.reader, world(home.id));
    expect(closure.nodes).toEqual([
      expect.objectContaining({
        state: 'missing',
        expected: SESSION_SCHEMA,
        ref: { id: 'session-gone', name: 'Lost' },
      }),
    ]);
  });

  it('turns a system object off by default, and leaves it tickable', async () => {
    const lib = shelf();
    const pack = lib.put(newPreset('Default'), 'system');
    const start = lib.put({ ...newSetup('Start'), preset: refTo(pack) });
    const closure = await walked(lib.reader, objects(start.id));
    expect(foundOf(closure, pack.id)).toMatchObject({
      owner: 'system',
      defaultOn: false,
      canUncheck: true,
    });
    expect(carried(closure)).toEqual([start.id]);
    expect(carried(closure, { [pack.id]: true })).toEqual([start.id, pack.id]);
  });

  it('reads a Setup’s mode, and a session’s mode and bindings', async () => {
    const lib = shelf();
    const start = lib.put({ ...newSetup('Start'), mode: { id: 'scene', config: null } });
    const session = lib.session({
      id: 'session-1',
      mode: { id: 'chat', config: null },
      roles: { narrator: { connectionId: 'c-1', modelId: 'm-1' } } as never,
      stepRoles: {},
      archivedAt: '2026-10-09T00:00:00.000Z',
    });
    const home = lib.put({
      ...newWorld('Rain City'),
      contents: [envelope(start), { schema: SESSION_SCHEMA, id: session.id, name: 'One' }],
    });
    const closure = await walked(lib.reader, world(home.id));
    expect(foundOf(closure, start.id).modes).toEqual(['scene']);
    expect(nodeOf(closure, session.id) as SessionNode).toMatchObject({
      modes: ['chat'],
      leavesBehind: ['roles'],
      archived: true,
      name: 'A session',
    });
  });
});

describe('where a walk starts', () => {
  it('one object is an object start, whose root cannot be unchecked', async () => {
    const lib = shelf();
    const vera = lib.put(newActor('Vera'));
    const closure = await walked(lib.reader, objects(vera.id, vera.id));
    expect(closure.origin).toBe('object');
    expect(closure.roots).toEqual([vera.id]);
    expect(foundOf(closure, vera.id).canUncheck).toBe(false);
    expect(carried(closure, { [vera.id]: false })).toEqual([vera.id]);
  });

  it('a duplicate in a selection is one starting point', async () => {
    const lib = shelf();
    const vera = lib.put(newActor('Vera'));
    const bo = lib.put(newActor('Bo'));
    const closure = await walked(lib.reader, objects(vera.id, bo.id, vera.id));
    expect(closure.origin).toBe('selection');
    expect(closure.roots).toEqual([vera.id, bo.id]);
    expect(closure.edges.map((edge) => edge.field)).toEqual(['/ids/0', '/ids/1']);
    expect(foundOf(closure, vera.id).canUncheck).toBe(true);
  });

  it('a World in a selection is refused, and so is one alone', async () => {
    const lib = shelf();
    const vera = lib.put(newActor('Vera'));
    const home = lib.put(newWorld('Rain City'));
    const refused: ClosureRefusal = { refusal: 'world-in-selection' };
    expect(await walkClosure(lib.reader, objects(vera.id, home.id))).toEqual(refused);
    expect(await walkClosure(lib.reader, objects(home.id))).toEqual(refused);
  });

  it('a World that is not there, a lone id that is not, and nothing at all are not-found', async () => {
    const lib = shelf();
    const notFound: ClosureRefusal = { refusal: 'not-found' };
    expect(await walkClosure(lib.reader, world('no-such-world'))).toEqual(notFound);
    expect(await walkClosure(lib.reader, objects('no-such-object'))).toEqual(notFound);
    expect(await walkClosure(lib.reader, objects())).toEqual(notFound);
  });

  it('an id in a selection that is not there is a missing row, reported', async () => {
    const lib = shelf();
    const vera = lib.put(newActor('Vera'));
    const closure = await walked(lib.reader, objects(vera.id, 'gone'));
    expect(nodeOf(closure, closure.roots[1] ?? '')).toMatchObject({
      state: 'missing',
      expected: '',
      ref: { id: 'gone', name: null },
    });
  });
});

// ── Against a real library ──────────────────────────────────────────────────

describe('walking a real library', () => {
  let server: TestServer;

  beforeEach(async () => {
    server = await makeTestServer();
    await setUpAdmin(server, 'ned');
  });

  afterEach(async () => {
    healIndex();
    await server.dispose();
  });

  /** Makes every index query throw, as a locked or vanished database would. */
  function breakIndex(): void {
    Object.defineProperty(server.services.library.db, 'prepare', {
      configurable: true,
      value: () => {
        throw new Error('database is locked');
      },
    });
  }

  /** Undoes {@link breakIndex}: the instance's own `prepare` goes, and the class's answers again. */
  function healIndex(): void {
    Reflect.deleteProperty(server.services.library.db, 'prepare');
  }

  async function created<T>(kind: string, payload: T): Promise<T & { slug: string }> {
    const response = await server.request({ method: 'POST', url: `/api/library/${kind}`, payload });
    expect(response.status, JSON.stringify(response.body)).toBe(201);
    return { ...payload, slug: response.body.slug as string };
  }

  const reader = (): ClosureReader =>
    libraryReader({ library: server.services.library, sessions: server.services.sessions }, 'ned');

  it('walks a setup made through the route, through the real resolveRef', async () => {
    const harbour = await created('lorebooks', newLorebook('Harbour'));
    const vera = await created('actors', newActor('Vera'));
    const rain = await created('treatments', {
      ...newTreatment('Rain'),
      lore: [{ ref: refTo(harbour), required: true }],
      hooks: [hook('h-1', [refTo(vera)])],
    });
    const pack = list(server.services.library, 'ned', PRESET_SCHEMA).find(
      (row) => row.owner === 'system',
    );
    const start = await created('setups', {
      ...newSetup('Start'),
      treatment: refTo(rain),
      cast: { personaOptions: [], partyDefault: [refTo(vera)], narrator: null },
      preset: pack === undefined ? null : { id: pack.id, name: pack.name },
    });

    const closure = await walked(reader(), objects(start.id));
    expect(foundIds(closure)).toEqual([
      start.id,
      rain.id,
      vera.id,
      ...(pack === undefined ? [] : [pack.id]),
      harbour.id,
    ]);
    expect(rulesInto(closure, vera.id)).toEqual([
      'setup.cast.partyDefault',
      'treatment.hooks.involves',
    ]);
    expect(foundOf(closure, harbour.id)).toMatchObject({
      required: true,
      owner: 'user',
      path: expect.stringMatching(/^users\/ned\/library\/lorebooks\//),
    });
    if (pack !== undefined) {
      expect(foundOf(closure, pack.id)).toMatchObject({ owner: 'system', defaultOn: false });
    }
  });

  /**
   * ***The real reader's error contract*** (2026-10-10, the P16.3a review).
   * `libraryReader` turns `read`'s *not found* into a missing row and must let
   * every other failure through: an index error reported as a missing book
   * publishes a file that says the book is gone because a query failed. So the
   * index is broken here — its `prepare` throws, as a locked database's would —
   * at the start, and then *after* the start has resolved, so that each lookup
   * the walk makes through the real library meets it: a World member by id, a
   * treatment's `Ref`, the scope query.
   */
  it('rejects the walk when the real index fails, at the start and past it', async () => {
    const harbour = await created('lorebooks', newLorebook('Harbour'));
    const rain = await created('treatments', {
      ...newTreatment('Rain'),
      lore: [{ ref: refTo(harbour), required: true }],
    });
    const home = await created('worlds', { ...newWorld('Rain City'), contents: [envelope(rain)] });
    const bare = await created('worlds', newWorld('Elsewhere'));

    /** The real reader, with the index breaking the moment the start has been read. */
    const breaksAfterStart = (): ClosureReader => {
      const real = reader();
      const then = <T>(row: T): T => {
        breakIndex();
        return row;
      };
      return {
        ...real,
        id: (id, kind) => then(real.id(id, kind)),
        anyKind: (id) => then(real.anyKind(id)),
      };
    };
    const failing = 'database is locked';

    breakIndex();
    await expect(walkClosure(reader(), objects(rain.id))).rejects.toThrow(failing);
    healIndex();
    // A member, read by id: `read`'s error, which only *not found* may turn into null.
    await expect(walkClosure(breaksAfterStart(), world(home.id))).rejects.toThrow(failing);
    healIndex();
    // A treatment's `Ref`: `resolveRef` rethrows whatever is not *not found*.
    await expect(walkClosure(breaksAfterStart(), objects(rain.id))).rejects.toThrow(failing);
    healIndex();
    // The scope query, asked of a World with no members.
    await expect(walkClosure(breaksAfterStart(), world(bare.id))).rejects.toThrow(failing);
    healIndex();

    // Healed, each of those walks — so what failed above was the index.
    await expect(walked(reader(), world(home.id))).resolves.toBeDefined();
    await expect(walked(reader(), objects(rain.id))).resolves.toBeDefined();
  });

  /**
   * ***And the one failure it does swallow*** — a session that cannot be read
   * is a missing member, not a World that cannot be published. A session folder
   * that leads out of the data directory is `readSession`'s refusal working
   * (`layout.assertReal` throws); one bad transcript must not refuse the
   * publish of everything else the World holds.
   */
  it('reports a session whose folder leads out of the data directory as a missing member', async () => {
    const vera = await created('actors', newActor('Vera'));
    const home = await created('worlds', { ...newWorld('Rain City'), contents: [envelope(vera)] });
    const started = await server.request({
      method: 'POST',
      url: '/api/sessions',
      payload: { name: 'Night one', world: home.id, cast: { persona: null, actors: [vera.id] } },
    });
    expect(started.status, JSON.stringify(started.body)).toBe(201);
    const sessionId = started.body.session.id as string;

    const outside = await mkdtemp(join(tmpdir(), 'se-closure-outside-'));
    try {
      // A junction, as `attachments.test.ts` explains: no elevation on Windows,
      // and an ordinary symlink on POSIX.
      const root = server.services.layout.sessionRoot('ned', sessionId);
      await rename(root, join(outside, 'session'));
      await symlink(join(outside, 'session'), root, 'junction');

      const closure = await walked(reader(), world(home.id));
      expect(closure.roots).toHaveLength(2);
      expect(nodeOf(closure, closure.roots[1] ?? '')).toMatchObject({
        state: 'missing',
        expected: SESSION_SCHEMA,
        ref: { id: sessionId },
      });
      expect(foundIds(closure)).toEqual([vera.id]);
    } finally {
      await rm(outside, { recursive: true, force: true });
    }
  });

  /**
   * ***The name arm is why imports work*** ([P5.6]): an imported treatment's
   * links carry ids its producer minted, and the books were imported under ids
   * of ours. And the id arm comes first: a link whose id resolves is not
   * redirected by a name that names another book.
   */
  it('resolves an imported-style foreign lore id by name, and an id before a name', async () => {
    const harbour = await created('lorebooks', newLorebook('Harbour'));
    const weather = await created('lorebooks', newLorebook('Weather'));
    const rain = await created('treatments', {
      ...newTreatment('Rain'),
      lore: [
        { ref: { id: 'st-world-0001', name: 'harbour' }, required: false },
        { ref: { id: weather.id, name: 'Harbour' }, required: false },
        { ref: { id: 'st-world-0002', name: 'Nowhere' }, required: false },
      ],
    });
    const closure = await walked(reader(), objects(rain.id));
    expect(
      closure.edges
        .filter((edge) => edge.from === rain.id)
        .map((edge) => [edge.to.startsWith('missing:') ? 'missing' : edge.to, edge.resolvedBy]),
    ).toEqual([
      [harbour.id, 'name'],
      [weather.id, 'id'],
      ['missing', null],
    ]);
  });

  it('walks a session started in a World as a member, reaching what it names', async () => {
    const harbour = await created('lorebooks', newLorebook('Harbour'));
    const vera = await created('actors', newActor('Vera'));
    const keeper = await created('actors', newActor('The keeper'));
    const rain = await created('treatments', {
      ...newTreatment('Rain'),
      hooks: [hook('h-1', [], refTo(keeper))],
    });
    const home = await created('worlds', {
      ...newWorld('Rain City'),
      contents: [envelope(harbour)],
    });
    const started = await server.request({
      method: 'POST',
      url: '/api/sessions',
      payload: {
        name: 'Night one',
        world: home.id,
        treatment: rain.id,
        cast: { persona: null, actors: [vera.id] },
      },
    });
    expect(started.status, JSON.stringify(started.body)).toBe(201);
    const sessionId = started.body.session.id as string;

    const closure = await walked(reader(), world(home.id));
    expect(closure.roots).toEqual([harbour.id, sessionId]);
    expect(nodeOf(closure, sessionId)).toMatchObject({ state: 'session', name: 'Night one' });
    expect(rulesInto(closure, rain.id)).toEqual(['session.treatment']);
    expect(rulesInto(closure, vera.id)).toEqual(['session.cast.actors']);
    // The World's book reached the session's lore by contribution ([P16.2]):
    // a member and a session link, one node.
    expect(rulesInto(closure, harbour.id)).toEqual(['world.member', 'session.lore']);
    // The pool copied the treatment's arrival; its subject is reached both ways.
    expect(rulesInto(closure, keeper.id).sort()).toEqual([
      'session.hooks.introduces',
      'treatment.hooks.introduces',
    ]);
    expect(foundOf(closure, keeper.id)).toMatchObject({ base: false, gates: [sessionId] });
  });

  /**
   * ***A memory book is not reached*** — the case only a real library makes.
   * Vera has a memory book, as play would have given her: a lorebook about her,
   * named by nothing, found at play time by `resolveLore`'s query. A walker that
   * borrowed the play-time resolver would publish it with the session.
   */
  it('does not reach a memory book', async () => {
    const vera = await created('actors', newActor('Vera'));
    const home = await created('worlds', newWorld('Rain City'));
    const started = await server.request({
      method: 'POST',
      url: '/api/sessions',
      payload: { name: 'Night one', world: home.id, cast: { persona: null, actors: [vera.id] } },
    });
    expect(started.status).toBe(201);
    const memories = await ensureMemoryBook(
      server.services.library,
      'ned',
      { actor: vera.id, persona: null },
      { actor: 'Vera', persona: null },
    );

    const closure = await walked(reader(), world(home.id));
    expect(foundIds(closure)).toEqual([vera.id]);
    expect(closure.nodes.some((node) => node.key === memories.id)).toBe(false);
  });

  it('walks a Package that was never moved as the World it is', async () => {
    const vera = await created('actors', newActor('Vera'));
    const legacy = {
      ...newWorld('Rain City'),
      schema: LEGACY_PACKAGE_SCHEMA,
      contents: [envelope(vera)],
    };
    const folder = join(server.dataDir, 'users', 'ned', 'library', 'packages', 'rain-city');
    await mkdir(folder, { recursive: true });
    await writeFile(join(folder, 'package.json'), `${JSON.stringify(legacy, null, 2)}\n`);
    await rebuild(server.services.index.db, server.services.layout);

    const closure = await walked(reader(), world(legacy.id));
    expect(closure.world).toMatchObject({ id: legacy.id, name: 'Rain City' });
    expect(closure.roots).toEqual([vera.id]);
  });

  /**
   * ***Row 12 against the real query*** — `booksScopedTo`, the function a
   * session started in the World also reads. A copied folder is one object held
   * twice; the shadowed copy is not a second book.
   */
  it('reaches the books scoped to the World through the real query, a copied folder once', async () => {
    const home = await created('worlds', newWorld('Rain City'));
    const other = await created('worlds', newWorld('Elsewhere'));
    const tides = await created('lorebooks', {
      ...newLorebook('Tides'),
      scope: { kind: 'world', worldIds: [home.id] },
    });
    await created('lorebooks', {
      ...newLorebook('Far away'),
      scope: { kind: 'world', worldIds: [other.id] },
    });
    const lorebooks = join(server.dataDir, 'users', 'ned', 'library', 'lorebooks');
    await cp(join(lorebooks, tides.slug), join(lorebooks, 'zz-copy-of-tides'), { recursive: true });
    await rebuild(server.services.index.db, server.services.layout);
    expect(
      list(server.services.library, 'ned', LOREBOOK_SCHEMA).filter((row) => row.id === tides.id),
    ).toHaveLength(2);

    const closure = await walked(reader(), world(home.id));
    expect(closure.roots).toEqual([tides.id]);
    expect(closure.edges).toHaveLength(1);
    expect(closure.edges[0]).toMatchObject({ rule: 'world.scopedBook', to: tides.id });
  });
});
