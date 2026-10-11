// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import {
  type Closure,
  type ClosureEdge,
  type ClosureNode,
  type ExcludedNode,
  type FoundNode,
  isKnownSchema,
  isWrittenByPlay,
  LEGACY_PACKAGE_SCHEMA,
  LOREBOOK_SCHEMA,
  type MissingNode,
  type NodeKey,
  type PortableSchemaId,
  type PublishOrigin,
  type PublishStart,
  SESSION_SCHEMA,
  type SessionNode,
  SETUP_SCHEMA,
  WORLD_SCHEMA,
  type World,
} from '@storyengine/shared';

import type { IndexedObject } from '../index-db/query.js';
import { LibraryError, read, resolveRef, type LibraryContext } from '../library.js';
import { edgesOf, type OutboundRef, sessionEdges, worldScopeEdge } from '../library/references.js';
import { booksScopedTo } from '../library/worlds.js';
import { readSession, type SessionContext } from '../sessions/store.js';
import type { SessionFile } from '../sessions/types.js';

/**
 * ***The closure walk*** — [16 §4](../../../../docs/design/16-publish.md),
 * [04 §9.1](../../../../docs/design/04-schemas.md),
 * [P16 §1.4](../../../../docs/design/workplan/35-p16-world.md), [P16.3a].
 *
 * **It replaces `export.ts`'s one level, and does not extend it.** P11.10's
 * export read the `contents[]` a World already declares and stopped, which is
 * why 04 §9.1's hook rows could be owed for five phases at no cost: *"the only
 * reason that has cost nothing is that the walker does not exist either."* This
 * is that walker — breadth-first, every level, against the table as it stands
 * (`library/references.ts` is the table's reader, and this module never reads a
 * field itself). `export.ts` and its route stay until the client stops calling
 * them at P16.3g; nothing here calls them.
 *
 * ***Resolution is the documented order, and only where a row says so.*** A
 * `Ref` resolves by exact id, then by case-insensitive name within its kind,
 * then is missing — `resolveRef`, [P5.6]'s implementation of the sentence three
 * documents carry, and the reason an imported treatment's foreign ids find their
 * books at all. **An envelope and a session's links resolve by id alone**: a
 * World member is matched by id in the World editor, and a session link is a
 * bare id with no name beside it, so a name arm there would make the review
 * disagree with the editor about what a World holds — or, worse, quietly
 * publish *a* Vera because *the* Vera was deleted.
 *
 * ***A node is keyed by what it resolved to.*** A treatment's link that hit by
 * name and the same book reached as a World member are one node with two
 * inbound edges, and the review shows one row that says both. Refs are
 * memoised as written, so three hooks naming one actor resolve once; and a
 * reference that resolves to nothing is **one missing node per thing missing**
 * — a deleted actor three hooks name is one row with three reasons, not three
 * rows ([16 §4]: *reported, never dropped and never refused*).
 *
 * ***What it never does.*** It never calls `resolveLore`, which appends the
 * cast's **memory books** — a query over the library for books *about* whoever
 * a session plays with, which nothing names, which hold what play extracted,
 * and which 04 §9.1 never lists. A walker that borrowed the play-time resolver
 * because it already "knew what a session's lore is" would publish a person's
 * memories of every character in a shared World. It never follows a session to
 * another session ([04 §9.1]'s *never a sibling*: there is no session → session
 * edge to follow, and a session enters only as a member of the start World).
 * And it never reads into a World it reaches as a member: **a World inside a
 * World is excluded unread** ([15 §3.1]: a set of sets has no honest kept form),
 * under either schema name — `addMembers` refuses `storyengine.world/1` on
 * write, but the legacy `storyengine.package/1` envelope gets past it, and a
 * hand-edited file gets past anything.
 *
 * ***The owner's two edges, 2026-10-10.*** Both were answers at [P16.3]'s plan
 * and both are 04 §9.1 rows now. **A World reaches the books scoped to it** —
 * the table's one query: a book's `world` arm names the World, so nothing the
 * World holds points at the book, and the walk *asks* ({@link
 * ClosureReader.scopedTo}) rather than reads. Asked only for the start World,
 * because that is the only World this walk ever expands: a selection holding a
 * World is refused, and a World inside one is excluded unread. The books join
 * the starting points after the members, each its own uncheckable row. **A
 * ticked session reaches the actors its hook pool names** — read by
 * `sessionEdges`, gated by the session's tick exactly as its cast is
 * (`NodeBase.base`), so it needed no rule of its own here. *Nor did the
 * correction to it* (2026-10-10, after [P16.3b]'s review): row 13's cast is
 * the **played** cast, so `sessionEdges` also answers whoever arrived during
 * play (`session.cast.arrived`) and every pooled arrival's subject fired or
 * not, and both are edges from the session node — gated by its tick, with no
 * line here changed.
 *
 * ***What it decides and what it does not.*** It decides what was reached and
 * how — and the three flags that are facts about the walk: `defaultOn`,
 * `canUncheck`, and `base`/`gates`, computed after the walk because reachability
 * is a property of the finished graph. What is *in the file* given a person's
 * ticks is `fileSet`'s, in shared, so the review and the confirm draw with one
 * rule. The facts a review shows beside each row — sizes, pictures — are
 * P16.3d's (`NodeFacts`, `SessionFacts`), declared now and computed then.
 * *(Computed since [P16.3d] by `packaging/review.ts`, through the writer's own
 * `measureObject` and `measureSession`, onto the closure this returns — the
 * walk itself still reads no file. And one more fact is the walk's own from
 * that stage: `writtenByPlay`, read off the body it already holds.)*
 */

/** One library object as the walk reads it: the index row, with a portable path. */
export interface Resolved {
  id: string;
  schemaId: string;
  name: string;
  /** The index's owner key: `system`, or `user:<handle>`. */
  owner: string;
  /** Relative to the data root ([22 §4.1]): a closure is shown to a client. */
  path: string;
  contentHash: string;
  body: unknown;
}

/**
 * ***Everything the walk reads, and nothing it writes.***
 *
 * **An interface rather than the library itself**, so the walker's rules — the
 * bare-ref trap, resolution order, id-only arms, cycles, the sibling rule — are
 * tested over an in-memory library in milliseconds, and the integration tests
 * prove only that {@link libraryReader} is the real thing. Each method's
 * contract is the real function's:
 *
 * - `ref` is `resolveRef`: id, then name within the kind, then `null`.
 * - `id` and `anyKind` are `read`: *not found* — which includes another
 *   account's object, the anti-leak answer — is `null`; **any other failure
 *   throws**, and the walk rejects with it. An index or SQLite error is not a
 *   missing reference, and reporting it as one would publish a file that
 *   claims a book is gone because a query failed.
 * - `scopedTo` is row 12's query: every lorebook readable here whose scope's
 *   `world` arm names the World, not shadowed, by name (`booksScopedTo`, which
 *   a session started in the World also reads).
 * - `session` is `readSession`, and **any failure is `null`**: a session's
 *   folder is validated by nothing beyond its id, and one unreadable transcript
 *   becomes a missing row rather than a World that cannot be published.
 */
export interface ClosureReader {
  ref(ref: { id: string | null; name: string | null }, kind: PortableSchemaId): Resolved | null;
  id(id: string, kind: PortableSchemaId): Resolved | null;
  anyKind(id: string): Resolved | null;
  scopedTo(worldId: string): Resolved[];
  session(id: string): Promise<SessionFile | null>;
}

/** The reader over a real library and a real session store, as one account sees them. */
export function libraryReader(
  context: { library: LibraryContext; sessions: SessionContext },
  handle: string,
): ClosureReader {
  const resolved = (row: IndexedObject): Resolved => ({
    id: row.id,
    schemaId: row.schemaId,
    name: row.name,
    owner: row.owner,
    // `fileErrors`' fallback: a row outside the root has no portable address,
    // and inventing one would be worse than saying so.
    path: context.library.layout.portablePath(row.path) ?? '(outside the data directory)',
    contentHash: row.contentHash,
    body: row.body,
  });
  const unlessMissing = (work: () => IndexedObject): Resolved | null => {
    try {
      return resolved(work());
    } catch (error) {
      if (error instanceof LibraryError && error.code === 'not-found') return null;
      throw error;
    }
  };
  return {
    ref: (ref, kind) => {
      const row = resolveRef(context.library, handle, ref, kind);
      return row === null ? null : resolved(row);
    },
    id: (id, kind) => unlessMissing(() => read(context.library, handle, id, kind)),
    anyKind: (id) => unlessMissing(() => read(context.library, handle, id)),
    scopedTo: (worldId) => booksScopedTo(context.library, handle, worldId).map(resolved),
    session: async (id) => {
      try {
        return await readSession(context.sessions, handle, id);
      } catch {
        return null;
      }
    },
  };
}

/**
 * A start the walk will not take: **nothing there**, or **a World among the
 * objects** — P16.3d answers the second with `422 world-in-selection`
 * ([P16.3]'s decisions: the UI cannot build such a selection, so the API
 * misuse is refused rather than quietly excluded).
 */
export interface ClosureRefusal {
  refusal: 'not-found' | 'world-in-selection';
}

/**
 * ***Walk from a start, and answer everything reached.***
 *
 * **Starts:**
 *
 * - **A World**: its members, in the World's order, then the books scoped to it
 *   (row 12), by name. A World that does not resolve is `not-found`.
 * - **Library objects**: the distinct ids, in the order given. *Any* id that is
 *   a World refuses the whole start (`world-in-selection`), a lone id that is
 *   one too — a World is published as a World. One distinct id is an `object`
 *   start, whose root cannot be unchecked; two or more are a `selection`, in
 *   which an id that resolves to nothing is a missing row, reported, while a
 *   lone id that resolves to nothing is `not-found`, because there is nothing to
 *   publish. An empty list names nothing and is `not-found` too. ~~a lone id
 *   that resolves to nothing~~ — *any selection none of whose ids resolves*
 *   (2026-10-11, the P16.3d review), for the same reason: two objects deleted
 *   in another tab while the review was open walked to a closure of missing
 *   rows, and the confirm kept an empty World of it and sent a file of
 *   nothing. One id that resolves is enough for the rest to be missing rows.
 *
 * **The walk is breadth-first, and every starting point is placed before any
 * node is expanded**, which is what makes *first discovery* the shallowest:
 * a node's `depth` and `parent` are the first edge that reached it, and every
 * later edge joins its `inbound`. Expansion is in discovery order, and each
 * node's references in row order then array order, so the same library and the
 * same start give a deep-equal closure.
 */
export async function walkClosure(
  reader: ClosureReader,
  start: PublishStart,
): Promise<Closure | ClosureRefusal> {
  if (start.kind === 'world') {
    const world = reader.id(start.id, WORLD_SCHEMA);
    if (world === null) return { refusal: 'not-found' };
    const walk = new Walk(reader, world.id);
    for (const member of edgesOf(WORLD_SCHEMA, world.body)) await walk.follow(null, member);
    for (const book of reader.scopedTo(world.id)) {
      // The predicate is the reference module's, not the reader's: a reader
      // that answered a book whose scope does not name this World is not
      // trusted to have meant it, and the edge needs the pointer anyway.
      const scoped = worldScopeEdge(book.body, world.id);
      if (scoped !== null) walk.scopedBook(book, scoped);
    }
    await walk.drain();
    return walk.closure(start, 'world', summaryOf(world));
  }

  const ids: { id: string; at: number }[] = [];
  const seen = new Set<string>();
  start.ids.forEach((id, at) => {
    if (typeof id !== 'string' || id === '' || seen.has(id)) return;
    seen.add(id);
    ids.push({ id, at });
  });
  if (ids.length === 0) return { refusal: 'not-found' };

  const rows = ids.map((one) => reader.anyKind(one.id));
  if (rows.some((row) => row !== null && isWorld(row.schemaId))) {
    return { refusal: 'world-in-selection' };
  }
  // Nothing there at all — one id or several — is nothing to publish; the
  // lone id was the first case of this, not a different rule.
  if (rows.every((row) => row === null)) return { refusal: 'not-found' };

  const origin: PublishOrigin = ids.length === 1 ? 'object' : 'selection';
  const walk = new Walk(reader, null);
  ids.forEach((one, i) => {
    walk.selected(one.id, one.at, rows[i] ?? null);
  });
  await walk.drain();
  return walk.closure(start, origin, null);
}

/** What the walk resolved one reference to — the node to attach the edge to. */
interface Target {
  key: NodeKey;
  resolvedBy: 'id' | 'name' | null;
  /** Builds the node when this is the first edge to reach `key`. */
  make: (base: Placement) => ClosureNode;
  /** What expanding the node yields, when it is a node that names anything. */
  expand: (() => OutboundRef[]) | null;
}

/** Where a node sits in the walk: what first reached it, and how deep. */
interface Placement {
  key: NodeKey;
  depth: number;
  parent: number;
  inbound: number[];
  base: boolean;
  gates: NodeKey[];
}

/**
 * One walk's state. A class because the state is a handful of maps and lists
 * that move together, and the walk is three phases over them — starting
 * points, expansion, gates — which read more plainly as methods than as one
 * function's closures.
 */
class Walk {
  readonly #reader: ClosureReader;
  /** The start World's id, whose own envelope among its members is excluded unread. */
  readonly #world: string | null;
  readonly #nodes: ClosureNode[] = [];
  readonly #edges: ClosureEdge[] = [];
  readonly #at = new Map<NodeKey, number>();
  /** Each distinct reference, as written, resolved once. */
  readonly #memo = new Map<string, Target>();
  /** Missing references by what they name, so one absence is one row. */
  readonly #missing = new Map<string, NodeKey>();
  /** Discovered nodes still to expand, with how; consumed by `drain`. */
  readonly #queue: { index: number; expand: () => OutboundRef[] }[] = [];

  constructor(reader: ClosureReader, world: string | null) {
    this.#reader = reader;
    this.#world = world;
  }

  /** A selection's id: a starting point, already looked up by `anyKind`. */
  selected(id: string, at: number, row: Resolved | null): void {
    const target: Target =
      row === null
        ? this.#absent('', { id, name: null })
        : isKnownSchema(row.schemaId)
          ? this.#found(row, row.schemaId)
          : this.#excluded(row.schemaId, id, row.name, 'unknown-kind');
    this.#attach(null, target, {
      from: null,
      to: target.key,
      rule: 'selected',
      field: `/ids/${String(at)}`,
      ref: { id, name: null },
      resolvedBy: row === null ? null : 'id',
      required: false,
      default: 'included',
    });
  }

  /** A book the start World's scope query found — row 12, a starting point. */
  scopedBook(book: Resolved, scoped: OutboundRef): void {
    const target = this.#found(book, LOREBOOK_SCHEMA);
    this.#attach(null, target, {
      from: null,
      to: target.key,
      rule: scoped.rule,
      field: scoped.field,
      ref: scoped.ref,
      resolvedBy: 'id',
      required: scoped.required,
      default: scoped.default,
    });
  }

  /** Resolves one reference from `from` (or from the start) and records the edge. */
  async follow(from: { key: NodeKey; depth: number } | null, ref: OutboundRef): Promise<void> {
    const target = await this.#resolve(ref);
    this.#attach(from, target, {
      from: from?.key ?? null,
      to: target.key,
      rule: ref.rule,
      field: ref.field,
      ref: ref.ref,
      resolvedBy: target.resolvedBy,
      required: ref.required,
      default: ref.default,
    });
  }

  /** Expands every discovered node, in discovery order, until nothing new is found. */
  async drain(): Promise<void> {
    // `for…of` over an array that grows while it is read visits what is pushed
    // during the loop — which is the breadth-first queue, and the reason this
    // is not a copy.
    for (const pending of this.#queue) {
      const node = this.#nodes[pending.index];
      if (node === undefined) continue;
      for (const ref of pending.expand()) {
        await this.follow({ key: node.key, depth: node.depth }, ref);
      }
    }
  }

  /** The finished value, with `base` and `gates` computed over the whole graph. */
  closure(start: PublishStart, origin: PublishOrigin, world: Closure['world']): Closure {
    this.#gate();
    const roots = unique(this.#edges.filter((edge) => edge.from === null).map((edge) => edge.to));
    if (origin === 'object') {
      // The one root of an object start is what is being published: a file of
      // nothing is not a choice, and `fileSet` enforces the flag too.
      const only = this.#nodes[this.#at.get(roots[0] ?? '') ?? -1];
      if (only?.state === 'found') only.canUncheck = false;
    }
    return { start, origin, roots, world, nodes: this.#nodes, edges: this.#edges };
  }

  #attach(from: { key: NodeKey; depth: number } | null, target: Target, edge: ClosureEdge): void {
    const index = this.#edges.length;
    this.#edges.push(edge);
    const held = this.#at.get(target.key);
    if (held !== undefined) {
      const node = this.#nodes[held];
      if (node === undefined) return;
      node.inbound.push(index);
      if (node.state === 'found') {
        node.required ||= edge.required;
        node.optional &&= edge.default === 'optional';
      } else if (node.state === 'missing') {
        node.required ||= edge.required;
      }
      return;
    }
    const node = target.make({
      key: target.key,
      depth: from === null ? 0 : from.depth + 1,
      parent: index,
      inbound: [index],
      base: false,
      gates: [],
    });
    if (node.state === 'found') {
      node.required = edge.required;
      node.optional = edge.default === 'optional';
    } else if (node.state === 'missing') {
      node.required = edge.required;
    }
    this.#at.set(target.key, this.#nodes.length);
    this.#nodes.push(node);
    if (target.expand !== null) {
      this.#queue.push({ index: this.#nodes.length - 1, expand: target.expand });
    }
  }

  /**
   * ***One reference, classified and resolved — once.***
   *
   * - **An envelope** (`target: null`, row 11): a World under either name, or
   *   the start World's own id, is excluded unread; a session is read as a
   *   session; a kind this build knows is read by id in that kind; anything
   *   else is an unknown kind, excluded unread — the stored World holds only
   *   its envelope, so there is no body to carry ([P16.3]'s decisions, and the
   *   disagreement with [04 §9]'s *kept, not usable here* is stated there).
   * - **A `Ref`** resolves by id then name; **an id-only arm** by id alone, and
   *   a miss there never falls back to a name, which is the whole of what makes
   *   it id-only.
   */
  async #resolve(ref: OutboundRef): Promise<Target> {
    const memo = JSON.stringify([
      ref.resolve,
      ref.target,
      ref.envelopeSchema ?? null,
      ref.ref.id,
      ref.ref.name,
    ]);
    const held = this.#memo.get(memo);
    if (held !== undefined) return held;

    const target = await this.#classify(ref);
    this.#memo.set(memo, target);
    return target;
  }

  async #classify(ref: OutboundRef): Promise<Target> {
    const id = ref.ref.id;
    if (ref.target === null || ref.target === SESSION_SCHEMA) {
      const schema = ref.target ?? ref.envelopeSchema ?? '';
      if (id === null) return this.#absent(schema, ref.ref);
      if (isWorld(schema) || id === this.#world) {
        return this.#excluded(schema, id, ref.ref.name, 'nested-world');
      }
      if (schema === SESSION_SCHEMA) return this.#session(id, ref.ref);
      if (!isKnownSchema(schema)) return this.#excluded(schema, id, ref.ref.name, 'unknown-kind');
      const row = this.#reader.id(id, schema);
      return row === null ? this.#absent(schema, ref.ref) : this.#found(row, schema, id);
    }

    const kind = ref.target;
    const row =
      ref.resolve === 'id'
        ? id === null
          ? null
          : this.#reader.id(id, kind)
        : this.#reader.ref(ref.ref, kind);
    return row === null ? this.#absent(kind, ref.ref) : this.#found(row, kind, id);
  }

  /**
   * A library object, keyed by its own id. `asked` is the id the reference
   * carried: a hit whose id differs from it was found by name.
   */
  #found(row: Resolved, kind: PortableSchemaId, asked: string | null = row.id): Target {
    return {
      key: row.id,
      resolvedBy: asked === row.id ? 'id' : 'name',
      make: (placed): FoundNode => ({
        ...placed,
        state: 'found',
        schema: kind,
        id: row.id,
        name: row.name,
        owner: row.owner === 'system' ? 'system' : 'user',
        path: row.path,
        contentHash: row.contentHash,
        modes: kind === SETUP_SCHEMA ? modesOf(row.body) : [],
        required: false,
        optional: false,
        canUncheck: true,
        // [P16.3]'s decisions: a system object is off by default and can be
        // ticked. A recipient who has the mode resolves the reference to their
        // own copy, and shipping one would meet `create`'s install-wide id check.
        defaultOn: row.owner !== 'system',
        /**
         * ***Play wrote it*** (2026-10-10, [P16.3d]) — read from the indexed
         * body's provenance, the marking a memory book carries. A fact about
         * the object, like its owner, so it is the walker's to record and
         * `fileSet`'s to act on: the writer has left such a book home since
         * [P16.3c], and a closure that did not say so let the review draw it
         * as travelling. Its edges are still followed — a node is what the
         * walk reached, and what it names is reached through it either way.
         */
        ...(isWrittenByPlay(row.body) ? { writtenByPlay: true } : {}),
      }),
      // A World reached here would be one a kind-scoped read answered for a
      // World kind, which no row asks for; expanding it would publish its
      // members as the closure of something else, so it is not expanded.
      expand: isWorld(kind) ? null : () => edgesOf(kind, row.body),
    };
  }

  /**
   * A session member, read once — **the only way a session enters a walk**
   * ([16 §2]: a lone session is session export's). Keyed by the id it was read
   * by, which is the folder that holds it and the id the World names.
   */
  async #session(id: string, ref: OutboundRef['ref']): Promise<Target> {
    const file = await this.#reader.session(id);
    if (file === null) return this.#absent(SESSION_SCHEMA, ref);
    const session: Record<string, unknown> = { ...file };
    return {
      key: id,
      resolvedBy: 'id',
      make: (placed): SessionNode => ({
        ...placed,
        state: 'session',
        id,
        name: textOr(session['name'], ''),
        updatedAt: textOr(session['updatedAt'], ''),
        headTurnId: textOr(session['headTurnId'], null),
        archived: typeof session['archivedAt'] === 'string',
        modes: modesOf(session),
        leavesBehind: (['roles', 'stepRoles'] as const).filter((field) =>
          hasEntries(session[field]),
        ),
        canUncheck: true,
        defaultOn: false,
      }),
      expand: () => sessionEdges(file),
    };
  }

  /**
   * A reference to nothing. **One node per thing missing**: by kind and id when
   * the reference has an id, by kind and folded name when it has only a name —
   * so three hooks naming one deleted actor are one row with three reasons,
   * while two kinds each missing an id stay two rows.
   */
  #absent(expected: string, ref: OutboundRef['ref']): Target {
    const identity = JSON.stringify([
      expected,
      ref.id ?? null,
      ref.id === null ? (ref.name ?? '').toLowerCase() : null,
    ]);
    const key = this.#missing.get(identity) ?? `missing:${String(this.#missing.size)}`;
    this.#missing.set(identity, key);
    return {
      key,
      resolvedBy: null,
      make: (placed): MissingNode => ({
        ...placed,
        state: 'missing',
        expected,
        ref: { id: ref.id, name: ref.name },
        required: false,
      }),
      expand: null,
    };
  }

  #excluded(
    schema: string,
    id: string,
    name: string | null,
    reason: ExcludedNode['reason'],
  ): Target {
    return {
      key: `excluded:${id}`,
      resolvedBy: null,
      make: (placed): ExcludedNode => ({ ...placed, state: 'excluded', schema, id, name, reason }),
      expand: null,
    };
  }

  /**
   * ***`base` and `gates`, over the finished graph.***
   *
   * `base` is reachability from the starting points that are not sessions,
   * never passing through one; `gates` is, per session, what that session
   * reaches. Computed once at the end because a node's first discovery says
   * nothing about the rest — an actor first reached through a session's cast
   * and later through a member treatment is base, and only the whole graph
   * knows the second. Edges run only from found objects and sessions, and
   * sessions are entered only from the start, so the traversal from a
   * non-session root cannot enter one; the check is kept so a later edge that
   * could would not quietly make a transcript's cast travel unticked.
   */
  #gate(): void {
    const next = new Map<NodeKey, NodeKey[]>();
    for (const edge of this.#edges) {
      if (edge.from === null) continue;
      const list = next.get(edge.from) ?? [];
      list.push(edge.to);
      next.set(edge.from, list);
    }
    const isSession = (key: NodeKey): boolean =>
      this.#nodes[this.#at.get(key) ?? -1]?.state === 'session';
    const reach = (from: NodeKey[]): NodeKey[] => {
      const reached = new Set<NodeKey>(from);
      const order = [...from];
      for (const at of order) {
        for (const to of next.get(at) ?? []) {
          if (reached.has(to) || isSession(to)) continue;
          reached.add(to);
          order.push(to);
        }
      }
      return order;
    };

    const starts = unique(
      this.#edges
        .filter((edge) => edge.from === null && !isSession(edge.to))
        .map((edge) => edge.to),
    );
    for (const key of reach(starts)) {
      const node = this.#nodes[this.#at.get(key) ?? -1];
      if (node !== undefined) node.base = true;
    }
    for (const session of this.#nodes) {
      if (session.state !== 'session') continue;
      for (const key of reach([session.key])) {
        if (key === session.key) continue;
        const node = this.#nodes[this.#at.get(key) ?? -1];
        if (node !== undefined && !node.gates.includes(session.key)) node.gates.push(session.key);
      }
    }
  }
}

/** A World under its name or the one it had until [P16.0]. */
function isWorld(schema: string): boolean {
  return schema === WORLD_SCHEMA || schema === LEGACY_PACKAGE_SCHEMA;
}

/**
 * The start World as the closure reports it. Read through `unknown` because a
 * stored World is validated by the index but `requires` is also hand-edited,
 * and the closure is the review's whole description of what is being sent.
 */
function summaryOf(world: Resolved): NonNullable<Closure['world']> {
  const body = (typeof world.body === 'object' && world.body !== null ? world.body : {}) as Record<
    string,
    unknown
  >;
  const requires = (
    typeof body['requires'] === 'object' && body['requires'] !== null ? body['requires'] : {}
  ) as Partial<World['requires']>;
  return {
    id: world.id,
    name: world.name,
    description: textOr(body['description'], ''),
    version: textOr(body['version'], ''),
    contentHash: world.contentHash,
    requires: {
      modes: Array.isArray(requires.modes) ? requires.modes : [],
      extensions: Array.isArray(requires.extensions) ? requires.extensions : [],
      capabilities: Array.isArray(requires.capabilities) ? requires.capabilities : [],
    },
  };
}

/**
 * The mode a Setup or a session plays — `mode.id`, and only that ([04 §9.1]'s
 * *a Setup names a concrete mode*). A treatment's `modeHints` and a preset's
 * `modes` are never read: a hint is not a requirement.
 */
function modesOf(body: unknown): string[] {
  if (typeof body !== 'object' || body === null) return [];
  const mode = (body as { mode?: unknown }).mode;
  if (typeof mode !== 'object' || mode === null) return [];
  const id = (mode as { id?: unknown }).id;
  return typeof id === 'string' && id !== '' ? [id] : [];
}

function hasEntries(value: unknown): boolean {
  return typeof value === 'object' && value !== null && Object.keys(value).length > 0;
}

function textOr<T extends string | null>(value: unknown, fallback: T): string | T {
  return typeof value === 'string' ? value : fallback;
}

function unique<T>(values: readonly T[]): T[] {
  return [...new Set(values)];
}
