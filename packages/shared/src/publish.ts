// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import type { ImportNote } from './import.js';
import type { PortableSchemaId } from './schema/registry.js';
import type { World } from './schema/world.js';

/**
 * ***What a publish would send, and the one rule for what is in the file*** —
 * [16 §4](../../../docs/design/16-publish.md),
 * [04 §9.1](../../../docs/design/04-schemas.md),
 * [P16 §1.4](../../../docs/design/workplan/35-p16-world.md), [P16.3a].
 *
 * **Two halves, and only one of them is computed here.** The *closure* — every
 * node a walk from the starting point reached, and every edge it followed — is
 * the server's: it reads the library, and `packaging/closure.ts` builds it
 * against 04 §9.1's table. What is in the *file*, given a closure and a person's
 * ticks, is this module's {@link fileSet}, and it is shared for the reason
 * `lore.ts` and `media-rows.ts` are: **the review draws with it and the confirm
 * writes with it**, and a review whose rule differed from the writer's by one
 * clause would show a ticked box for a thing that does not travel. Two copies of
 * a rule like that disagree silently and in the direction that matters — the
 * file is the thing a recipient gets, and the review is the only description of
 * it the sender ever reads.
 *
 * **Pure, and nothing here touches the library.** A closure is a value: the
 * preview hands one to the client, the confirm re-walks and gets a fresh one,
 * and `fileSet` over either is a function of the value and the ticks alone. That
 * is what lets a confirm re-apply choices made against an older preview — a
 * stale key is ignored, a new object takes its default — without either side
 * holding anything between the two requests ([16 §5]'s *the review stages
 * nothing*).
 *
 * *Internal tier*, beside `import-preview.ts` and for its reason: the closure is
 * a description of what a publish would do, never written to disk as itself.
 * What does reach a file — the manifest's `leftBehind` — is {@link LeftBehind},
 * and the manifest that carries it is P16.3c's.
 */

/**
 * ***The schema a session member is named by*** — [P16 §1.2].
 *
 * **Shared from [P16.3a]**, which is the moment `editor/members-form.ts`'s own
 * docstring asked for: *"when shared grows one, this becomes a re-export."* The
 * walker is the first server reader that has to *classify* a World member as a
 * session rather than merely write one, and a classifier spelling the literal
 * where four writers also spell it is the drift the client's constant was made
 * to prevent, one package over. The server's writers keep their literals for
 * now, and **nothing compares the two at compile time** — a classifier
 * compares strings — so the agreement is pinned by a test instead:
 * `packaging/closure.test.ts` walks a session that `POST /sessions {world}`
 * made a member under the route's own literal, and finds a session node.
 */
export const SESSION_SCHEMA = 'storyengine.session/1' as const;

/**
 * ***At most this many starting points*** — the route's bound (P16.3d), and the
 * number the selection bar's *too many to send as a selection* sentence is
 * written against (P16.3g).
 *
 * **Shared because both sides enforce it**: the server refuses a longer list at
 * the door, and the client stops offering *Publish…* before a person builds a
 * request the server would refuse. A selection larger than this is a set, and a
 * set that size wants a name — the sentence sends the person to the World
 * editor, which is where making one is a first-class act.
 */
export const PUBLISH_MAX_START = 200;

/**
 * Where the walk begins: **library objects by id, or a World.** A session is not
 * a starting point ([16 §2]: one session as itself is session export's), and a
 * World among `ids` is refused rather than walked — see `walkClosure`.
 */
export type PublishStart = { kind: 'objects'; ids: string[] } | { kind: 'world'; id: string };

/**
 * What the starting point *was*, after de-duplication: one distinct id is an
 * `object`, two or more a `selection`, and a World is a `world`. **It decides
 * what is kept**, and nothing about what is reached ([16 §2], [16 §3]): one
 * object keeps nothing, a selection keeps a World unless the snapshot choice is
 * taken, and a World start creates nothing new.
 */
export type PublishOrigin = 'object' | 'selection' | 'world';

/**
 * ***Why an edge exists — one name per field of [04 §9.1]'s table***, not one
 * per row.
 *
 * **Per field because the review states every reason as text** (P16.3g), and a
 * row that follows two fields for opposite reasons — row 4's `involves` is the
 * eligibility test, `introduces.actor` the hook's subject, and 04 §9.1 spends a
 * paragraph on why both — has two sentences, not one. The client keys its labels
 * by this union with a `Record<ClosureRule, …>`, so a rule added here with no
 * sentence there is a compile error rather than a dotted string on screen.
 *
 * The table has **thirteen rows, one of them a query** — the World row and the
 * Session row of 2026-10-04, and the owner's two answers of 2026-10-10 at
 * [P16.3]'s plan: a World reaches the books scoped to it (row 12), and a ticked
 * session reaches the actors its hook pool names (row 13's second clause).
 * *Corrected the same day, after [P16.3b]'s review*: row 13's cast is the cast
 * the session **plays** with, so a character who arrived during play — named by
 * the session's channels, never added to `cast.actors` — is reached too, under
 * a rule of its own (`session.cast.arrived`, below).
 *
 * Three rules begin at the start rather than at a node: `selected` (a starting
 * point the person chose), `world.member` (row 11, a field — `contents[]` — of
 * the start World, which is not itself a node), and `world.scopedBook` (row 12,
 * which is **not a field of anything the World holds**: the book names the
 * World, so the walk finds it by asking rather than by reading — see
 * `packaging/closure.ts`).
 */
export type ClosureRule =
  | 'selected'
  | 'world.member'
  | 'world.scopedBook'
  | 'treatment.lore'
  | 'treatment.cast'
  | 'treatment.hooks.involves'
  | 'treatment.hooks.introduces'
  | 'actor.lore'
  | 'setup.treatment'
  | 'setup.lore'
  | 'setup.cast.personaOptions'
  | 'setup.cast.partyDefault'
  | 'setup.cast.narrator'
  | 'setup.hooks.involves'
  | 'setup.hooks.introduces'
  | 'setup.preset'
  | 'lorebook.hooks.involves'
  | 'lorebook.hooks.introduces'
  | 'session.treatment'
  | 'session.lore'
  | 'session.cast.persona'
  | 'session.cast.actors'
  /**
   * ***Row 13's played cast, the half the roster does not hold*** — added
   * 2026-10-10, the correction after [P16.3b]'s review. An actor the session's
   * channels hold state for (`se.presence`, `se.status`, `se.party`) and its
   * `cast.actors` does not name, which `resolveCast` sends a card for every
   * turn: a hook's subject the story walked in, or somebody a person gave
   * presence by hand. Never the persona.
   *
   * **The review's sentence: *arrived during play*** — and that is why it is an
   * arm rather than `session.cast.actors` again. The configured cast is a thing
   * the person chose when the session began; an arrival is a thing the story
   * did, and a review that listed both as *in the cast* would hide which one a
   * recipient is being sent. P16.3g's `Record<ClosureRule, …>` makes the label
   * a compile error to forget.
   *
   * ***Wider than an arrival, which the label has to allow for*** (2026-10-10,
   * the review of this correction). The arm is computed as *in play through
   * channel state, and not in the configured cast*, and that also holds of
   * somebody a person **removed from the roster**, or a **former persona**,
   * after the narrator or the opening (`se.party: companion`) gave them state:
   * `PUT /sessions/:id/cast` replaces `cast` and touches no channel, so
   * `resolveCast` still plays them, and the walker is right to reach them. *Never
   * the persona* is of the current one. So P16.3g's label is owed a wording
   * that is true of both — *in play, not in the configured cast*, say — rather
   * than one that promises the story walked them in.
   */
  | 'session.cast.arrived'
  | 'session.hooks.involves'
  | 'session.hooks.introduces';

/**
 * ***A node's name in the closure, and the key a tick is stored under.***
 *
 * **A found object or a session is keyed by its own id** — the *resolved* id, so
 * a `Ref` that hit by name and the same object reached directly are one node.
 * Ids are install-unique because `create` refuses any id the install already
 * holds, so a plain id needs no kind prefix to be unambiguous, and keeping it
 * plain is what lets a confirm re-apply ticks made against an earlier preview —
 * [P16.3](../../../docs/design/workplan/35-p16-world.md)'s decisions: *"review
 * choices are keyed by id and re-applied on a confirm that re-walks the
 * library."*
 *
 * **Missing and excluded nodes are prefixed**, `missing:<n>` and
 * `excluded:<id>`, which keeps them out of the id space ticks live in: neither
 * can be ticked, and a key that could not collide with a real id cannot be
 * mistaken for one. `<n>` is an ordinal in discovery order, because a missing
 * reference may have no id (a name-only `Ref`) and two kinds may each miss the
 * same id.
 */
export type NodeKey = string;

/** One reference the walk followed — or, from `null`, one starting point. */
export interface ClosureEdge {
  /** The node that names `to`, or `null` for the start (a selection's id or a World member). */
  from: NodeKey | null;
  to: NodeKey;
  rule: ClosureRule;
  /**
   * A JSON pointer into `from`'s body — `/hooks/2/involves/0`, `/lore/0/ref` —
   * to the reference itself, wrapper included when there was one. For a starting
   * point it points into the start: `/ids/<i>` for a selection, `/contents/<i>`
   * for a World's member.
   *
   * ***One exception, and it is the query row's.*** A `world.scopedBook` edge
   * points into **`to`** — the book — at `/scope/worldIds/<j>`, the element
   * that names the World. The reference is the book's, pointing inward; the
   * World holds no field that could be pointed at, and a pointer to nowhere
   * would leave the review unable to say *this book says it belongs here*.
   */
  field: string;
  /** The reference as written — never as resolved, which `to` already says. */
  ref: { id: string | null; name: string | null };
  /**
   * How it resolved, so the review can say *found by name*: an imported
   * treatment's links are foreign ids, and the name arm is the only reason they
   * resolve at all ([P5.6]'s `resolveRef`). `null` when it did not resolve, and
   * for an excluded member, which is never read.
   */
  resolvedBy: 'id' | 'name' | null;
  /** `LoreLink.required === true` — the author's statement that this book is the world, not an extra. */
  required: boolean;
  /**
   * 04 §9.1's *Default* column: `optional` is its *can be unchecked* (a
   * non-required lore link, a setup's preset), and a link of that kind left out
   * is not worth a note ({@link fileSet}). Every other edge is `included`.
   */
  default: 'included' | 'optional';
}

/** What every node carries, whatever it turned out to be. */
export interface NodeBase {
  key: NodeKey;
  /** 0 for a starting point, and one more than whatever first reached it — the review groups by it. */
  depth: number;
  /** The index in `Closure.edges` of the edge that first reached it — its place in the tree. */
  parent: number;
  /** Every edge that reaches it, `parent` included, in discovery order. */
  inbound: number[];
  /**
   * ***Reachable from a starting point that is not a session, without passing
   * through a session.*** The half of reachability the rule needs.
   *
   * [P16.3]'s decisions settled that unchecking a row never cascades — a book a
   * dropped treatment brought stays ticked, labelled as an orphan — **with one
   * exception**: 04 §9.1's Session row says the session is *excluded until
   * ticked*, and what only a session reaches is part of what is excluded. A
   * transcript's cast travelling while the transcript stayed home would send a
   * person's play through the side door. So a node is in the file only when it
   * is `base`, or when a session it is reachable from is ticked.
   *
   * *The owner's first answer of 2026-10-10 rides the same gate*, and needs
   * nothing of its own: the actors a session's hook pool names are reached
   * through the session, exactly as its cast is, so an actor only an unticked
   * session's pool names stays home with the transcript. *So does the played
   * cast's other half* (`session.cast.arrived`, 2026-10-10): a character who
   * arrived during play is reached through the session alone, and travels
   * only with it.
   *
   * **False for a session node**, which is a starting point that *is* a session:
   * its own carriage is its tick, and nothing about it is base.
   */
  base: boolean;
  /**
   * The sessions from which it is reachable, in discovery order; empty when none
   * is — and empty for a session node itself, whose tick is not a gate on itself.
   */
  gates: NodeKey[];
}

/**
 * ***The review's numbers for one object*** — declared at [P16.3a], **filled at
 * P16.3d** by `measureObject`, which is the same function that plans the file's
 * members, so the review's size and the file's size are one count. Absent until
 * then; {@link fileSet} reads an absent `facts` as zero.
 */
export interface NodeFacts {
  /** Zip entries this object contributes: its stored file and the assets it names. */
  entries: number;
  bytes: number;
  pictures: { count: number; bytes: number };
  /** What history would add, when the person opts into it ([03 §11.6]). */
  history: { versions: number; entries: number; bytes: number };
  /** Pictures that will not travel — over the entry limit — named so the review can say so. */
  omitted: { ref: string; bytes: number }[];
}

/** The same, for a session; filled at P16.3d by `measureSession`. */
export interface SessionFacts {
  turns: number;
  pictures: number;
  attachments: number;
  /** Renditions the session records and whose pixels are not on disk. */
  missingPixels: number;
  entries: number;
  bytes: number;
}

/** A library object the walk resolved. */
export interface FoundNode extends NodeBase {
  state: 'found';
  schema: PortableSchemaId;
  id: string;
  name: string;
  /** `system` for the system library's objects, which are off by default ([P16.3]'s decisions). */
  owner: 'user' | 'system';
  /** Portable — relative to the data root, never absolute ([22 §4.1]). */
  path: string;
  contentHash: string;
  /**
   * The modes this object *requires* — a Setup's `mode.id`, and nothing for any
   * other kind. `Treatment.modeHints` and `Preset.modes` are advisory and are
   * deliberately not read: a hint is not a requirement, and a `requires` built
   * from hints would warn a recipient about a mode the file runs without.
   */
  modes: string[];
  /** Some edge reaching it is a required lore link. */
  required: boolean;
  /** Every edge reaching it is `optional` — the review says *can be left out* without a warning. */
  optional: boolean;
  /** False only for the one root of an `object` start: a file of nothing is not a choice. */
  canUncheck: boolean;
  defaultOn: boolean;
  facts?: NodeFacts;
}

/** A session member of the start World — a starting point, never reached by an edge. */
export interface SessionNode extends NodeBase {
  state: 'session';
  id: string;
  name: string;
  updatedAt: string;
  headTurnId: string | null;
  archived: boolean;
  /** The session's own `mode.id`, which a recipient needs to play it on. */
  modes: string[];
  /**
   * Which connection bindings the session holds and the file will not
   * ([16 §2]: *a connection is never on it*) — so the review can say so per
   * session rather than leaving a recipient to find the dials unset.
   */
  leavesBehind: ('roles' | 'stepRoles')[];
  canUncheck: true;
  /** Always off: sending somebody your transcripts is a thing to choose ([16 §5]). */
  defaultOn: false;
  facts?: SessionFacts;
}

/**
 * A reference that resolved to nothing — **reported, never dropped and never
 * refused** ([16 §4], P11.10's rule for a Package held for a closure).
 */
export interface MissingNode extends NodeBase {
  state: 'missing';
  /** The kind the reference expected; empty for a selection's id, which names no kind. */
  expected: string;
  ref: { id: string | null; name: string | null };
  /** Some edge reaching it is a required lore link — the review's loud case. */
  required: boolean;
}

/**
 * A World member that is never read: **a World inside the World** (a set of
 * sets has no honest kept form — [15 §3.1]), the start World's own envelope, or
 * **a kind this build does not know** ([P16.3]: the stored World holds
 * only its envelope, so there is no body to carry).
 */
export interface ExcludedNode extends NodeBase {
  state: 'excluded';
  schema: string;
  id: string;
  name: string | null;
  reason: 'nested-world' | 'unknown-kind';
}

export type ClosureNode = FoundNode | SessionNode | MissingNode | ExcludedNode;

/**
 * ***Everything a walk reached, and how*** — deterministic: the same library and
 * the same start give a deep-equal value, because `nodes` and `edges` are in
 * breadth-first discovery order and every list inside follows the documents'
 * own array order.
 */
export interface Closure {
  start: PublishStart;
  origin: PublishOrigin;
  /**
   * The starting points, in order: the selection's distinct ids; or the World's
   * members, then the books scoped to it ([04 §9.1] row 12), by name. **A
   * scoped book is a starting point and not a node something reached**, because
   * nothing the World carries names it — so it is never an orphan, and
   * unticking it is a choice about the set, noted no more than an unticked
   * member is.
   */
  roots: NodeKey[];
  /** The start World as stored, for a `world` start; `null` otherwise. */
  world: {
    id: string;
    name: string;
    description: string;
    version: string;
    contentHash: string;
    requires: World['requires'];
  } | null;
  nodes: ClosureNode[];
  edges: ClosureEdge[];
}

/**
 * What the person decided in the review. **`ticked` overrides `defaultOn`**, one
 * map for all three defaults — user objects on, system objects off, sessions
 * off ([P16.3]'s decisions) — and a key the closure does not hold is ignored,
 * which is what makes a confirm against a re-walked library safe.
 */
export interface PublishChoices {
  ticked: Record<NodeKey, boolean>;
  history: boolean;
  /** Read only for a `selection`: keep a World of it (the default), or send a snapshot ([16 §3]). */
  keep: 'world' | 'snapshot';
  /** The kept World's name, for a `selection` kept as a World. */
  name?: string;
}

/**
 * ***A reference the file makes and does not carry*** — the manifest's record,
 * so the reader can say what dangles before anything lands ([16 §5.1]).
 *
 * **Only references *from* carried things.** Membership is not a reference: a
 * World member left out is simply not in the file's World, whose `contents` is
 * rewritten to what travels, so it names nothing the recipient would look for.
 * A treatment naming a book that stayed home is different — the treatment
 * travels saying so — and that is what this records.
 *
 * `not-portable` and `too-large` are P16.3c's reasons (a manuscript, a card over
 * the entry limit); {@link fileSet} produces `unchecked` and `missing`.
 */
export interface LeftBehind {
  schema: string | null;
  id: string | null;
  name: string;
  reason: 'unchecked' | 'missing' | 'not-portable' | 'too-large';
  required: boolean;
  /** The keys — ids — of the carried things that name it. */
  from: string[];
}

/** What {@link fileSet} answers: the file's contents, and everything the review says about them. */
export interface FileSet {
  objects: FoundNode[];
  sessions: SessionNode[];
  /**
   * Carried, and **reached by nothing kept** — no carried starting point
   * reaches it through carried nodes — with the left-out nodes it came with,
   * nearest first. ~~Named by nothing carried~~ (*2026-10-10*: one hop missed a
   * dropped treatment's actor's book, and any cycle; see {@link fileSet}).
   */
  orphans: { key: NodeKey; cameWith: NodeKey[] }[];
  /** A required lore link from something carried, to something that is not — unchecked or missing. */
  requiredLeftOut: { key: NodeKey; by: NodeKey[] }[];
  leftBehind: LeftBehind[];
  notes: ImportNote[];
  /** Mode ids from carried Setups and carried sessions; `minVersion` is the server's to fill. */
  modes: string[];
  totals: { objects: number; sessions: number; entries: number; bytes: number; pictures: number };
}

/**
 * ***The rule for what is in the file*** — [P16.3a], and the
 * function both the review and the confirm call.
 *
 * - A node is **on** when the person ticked it, or, untouched, when it is on by
 *   default. *The one root of an object start is always on*: it cannot be
 *   unchecked ({@link FoundNode.canUncheck}), and honouring a `false` for it from
 *   an API caller would write a file of nothing — so the flag is enforced here,
 *   where the writer reads it, rather than trusted to the client.
 * - **A session is carried when it is on.**
 * - **A found object is carried when it is on and** it is `base`, or a carried
 *   session is among its `gates`. That second clause is the one cascade
 *   ([NodeBase.base]); every other unchecking leaves what it brought in place.
 * - Missing and excluded nodes are never carried.
 *
 * Then what the review says about it, as notes (`{ key, params }`, never prose):
 *
 * - **A required link left out warns** (`requiredLeftOut`, or `requiredMissing`
 *   when the book does not exist) — 04 §9.1's *cannot be silently dropped*, and
 *   [16 §5]'s *permitted and warned about*. A Setup's own required link warns
 *   too: `required` is a property of the `LoreLink`, and one author statement
 *   should not mean two things on two carriers.
 * - **An `included` link left out is noted** (`leftOut`, `missing`), with its
 *   rule, because the review states every reason.
 * - **An `optional` one is silent** — leaving out a preset is what *can be
 *   unchecked* means.
 * - A starting point that does not resolve is noted `missing` as well: a World
 *   that outlived a member says so, as P11.10's export did. One the person
 *   unticked is not noted at all — the person chose, and membership dangles for
 *   nobody.
 * - Excluded members, orphans, a session's bindings staying behind, and an
 *   object that turns out to be only itself (*just the object* — [16 §2]'s case
 *   for offering Download instead).
 *
 * ***An orphan is what nothing kept still reaches*** — carried, but not
 * reachable from any carried starting point through carried nodes. *Settled
 * 2026-10-10 at the P16.3a review, where the plan disagreed with itself*: its
 * R1 says reachability computes *which rows are orphans*, and its rule list
 * says *no inbound edge from a carried node*. The two differ exactly where it
 * matters. Drop a treatment that cast Vera, whose own book's hook involves her:
 * Vera and the book each have a carried node naming them — each other — so the
 * one-hop reading labels neither, and the pair travels ticked with no *came
 * with Rain* and no place in the review's *leave these out too*. The same
 * reading labels the actor and not the actor's book two steps out. [P16.3]'s
 * decisions word it *nothing-left-names-it*; a cycle that names only itself is
 * not named by anything the person left in, so reachability is that sentence
 * read whole.
 */
export function fileSet(c: Closure, choices: Pick<PublishChoices, 'ticked' | 'history'>): FileSet {
  const ticked = choices.ticked;
  const byKey = new Map<NodeKey, ClosureNode>(c.nodes.map((node) => [node.key, node]));
  const tick = (key: NodeKey): boolean | undefined => {
    // `Object.hasOwn`, because an id is any string and `constructor` is one.
    if (!Object.hasOwn(ticked, key)) return undefined;
    const value = ticked[key];
    return typeof value === 'boolean' ? value : undefined;
  };

  const sessions = c.nodes.filter(
    (node): node is SessionNode => node.state === 'session' && (tick(node.key) ?? node.defaultOn),
  );
  const carriedSessions = new Set(sessions.map((one) => one.key));
  const objects = c.nodes.filter(
    (node): node is FoundNode =>
      node.state === 'found' &&
      (!node.canUncheck || (tick(node.key) ?? node.defaultOn)) &&
      (node.base || node.gates.some((gate) => carriedSessions.has(gate))),
  );
  const carried = new Set<NodeKey>([...objects, ...sessions].map((one) => one.key));

  const notes: ImportNote[] = [];
  const said = new Set<string>();
  const note = (key: string, level: ImportNote['level'], params: ImportNote['params']): void => {
    // The same note twice says nothing more: two hooks of one treatment naming
    // one deleted actor are one sentence in the review, not two identical ones.
    const identity = JSON.stringify([key, params]);
    if (said.has(identity)) return;
    said.add(identity);
    notes.push({ key, level, params });
  };

  for (const node of c.nodes) {
    if (node.state !== 'excluded') continue;
    note('publish.closure.excluded', 'info', {
      id: node.id,
      schema: node.schema,
      name: node.name ?? '',
      reason: node.reason,
    });
  }

  const requiredLeftOut = new Map<NodeKey, NodeKey[]>();
  const leftBehind = new Map<NodeKey, LeftBehind>();
  for (const edge of c.edges) {
    const target = byKey.get(edge.to);
    if (target === undefined) continue;

    if (edge.from === null) {
      if (target.state === 'missing') {
        note('publish.closure.missing', 'info', {
          rule: edge.rule,
          id: target.ref.id ?? '',
          name: target.ref.name ?? '',
        });
      }
      continue;
    }
    if (!carried.has(edge.from) || carried.has(edge.to)) continue;
    // Only a found object or a missing reference can be the far end of an edge
    // from a node: sessions and excluded members are reached by membership alone.
    if (target.state !== 'found' && target.state !== 'missing') continue;

    const from = byKey.get(edge.from);
    const fromName = from !== undefined && 'name' in from ? (from.name ?? '') : '';
    const missing = target.state === 'missing';
    const params = {
      rule: edge.rule,
      id: missing ? (target.ref.id ?? '') : target.id,
      name: missing ? (target.ref.name ?? '') : target.name,
      from: edge.from,
      fromName,
    };

    const held = leftBehind.get(edge.to);
    if (held === undefined) {
      leftBehind.set(edge.to, {
        schema: missing ? (target.expected === '' ? null : target.expected) : target.schema,
        id: missing ? target.ref.id : target.id,
        name: missing ? (target.ref.name ?? target.ref.id ?? '') : target.name,
        reason: missing ? 'missing' : 'unchecked',
        required: edge.required,
        from: [edge.from],
      });
    } else {
      held.required ||= edge.required;
      if (!held.from.includes(edge.from)) held.from.push(edge.from);
    }

    if (edge.required) {
      const by = requiredLeftOut.get(edge.to) ?? [];
      if (!by.includes(edge.from)) by.push(edge.from);
      requiredLeftOut.set(edge.to, by);
      note(
        missing ? 'publish.closure.requiredMissing' : 'publish.closure.requiredLeftOut',
        'warn',
        params,
      );
    } else if (edge.default === 'included') {
      note(missing ? 'publish.closure.missing' : 'publish.closure.leftOut', 'info', params);
    }
  }

  // ***Orphans by reachability over what is carried*** (2026-10-10, the
  // P16.3a review). What the carried starting points — carried sessions among
  // them, which are starting points too — still reach through carried nodes is
  // named by something kept; every other carried object is an orphan. The
  // first draft asked only whether *some* inbound edge came from a carried
  // node, and that misses both what sits two steps out (a dropped treatment's
  // actor's book is named by the actor, who is carried) and every cycle (an
  // actor and her own book, each naming the other, keep each other "named"
  // after the treatment that brought them is unticked) — so the pair travelled
  // ticked with nothing saying it came with what was dropped.
  const reached = new Set<NodeKey>(c.roots.filter((key) => carried.has(key)));
  const outbound = new Map<NodeKey, NodeKey[]>();
  for (const edge of c.edges) {
    if (edge.from === null) continue;
    const list = outbound.get(edge.from) ?? [];
    list.push(edge.to);
    outbound.set(edge.from, list);
  }
  // `for…of` over a Set visits what is added during the loop: the queue.
  for (const at of reached) {
    for (const to of outbound.get(at) ?? []) {
      if (carried.has(to)) reached.add(to);
    }
  }

  const orphans: FileSet['orphans'] = [];
  for (const object of objects) {
    if (reached.has(object.key)) continue;
    const cameWith = cameWithOf(c, byKey, object.key, carried);
    orphans.push({ key: object.key, cameWith });
    const first = cameWith[0] === undefined ? undefined : byKey.get(cameWith[0]);
    note('publish.closure.orphan', 'info', {
      id: object.id,
      name: object.name,
      cameWith: first !== undefined && 'name' in first ? (first.name ?? '') : '',
    });
  }

  for (const session of sessions) {
    if (session.leavesBehind.length === 0) continue;
    note('publish.session.bindingsStayBehind', 'info', {
      id: session.id,
      name: session.name,
      fields: session.leavesBehind.join(','),
    });
  }

  const [only] = objects;
  if (c.origin === 'object' && objects.length === 1 && sessions.length === 0 && only) {
    note('publish.closure.justTheObject', 'info', { id: only.id, name: only.name });
  }

  let entries = 0;
  let bytes = 0;
  let pictures = 0;
  for (const object of objects) {
    const facts = object.facts;
    if (facts === undefined) continue;
    entries += facts.entries + (choices.history ? facts.history.entries : 0);
    bytes += facts.bytes + (choices.history ? facts.history.bytes : 0);
    pictures += facts.pictures.count;
  }
  for (const session of sessions) {
    const facts = session.facts;
    if (facts === undefined) continue;
    entries += facts.entries;
    bytes += facts.bytes;
    pictures += facts.pictures;
  }

  return {
    objects,
    sessions,
    orphans,
    requiredLeftOut: [...requiredLeftOut].map(([key, by]) => ({ key, by })),
    leftBehind: [...leftBehind.values()],
    notes,
    modes: unique([...objects, ...sessions].flatMap((one) => one.modes)),
    totals: {
      objects: objects.length,
      sessions: sessions.length,
      entries,
      bytes,
      pictures,
    },
  };
}

/**
 * ***How the walk got to a node*** — the chain of first-discovery edges from a
 * starting point, outermost first. *"Why is this in the file"* answered as a
 * path, which is what the review shows beside a row two steps out. Empty for a
 * key the closure does not hold.
 */
export function pathTo(c: Closure, key: NodeKey): ClosureEdge[] {
  const byKey = new Map<NodeKey, ClosureNode>(c.nodes.map((node) => [node.key, node]));
  const path: ClosureEdge[] = [];
  let at = byKey.get(key);
  // Bounded by the edge count: a parent is always discovered strictly earlier,
  // so the chain cannot loop — and a hand-built closure that broke that must
  // not hang the review.
  for (let guard = 0; at !== undefined && guard <= c.edges.length; guard += 1) {
    const edge = c.edges[at.parent];
    if (edge === undefined) break;
    path.unshift(edge);
    if (edge.from === null) break;
    at = byKey.get(edge.from);
  }
  return path;
}

/** One row of {@link closureTree}: a node under whatever first reached it. */
export interface ClosureTreeNode {
  key: NodeKey;
  /** The edge that first reached it. */
  via: ClosureEdge;
  children: ClosureTreeNode[];
  /** Every other edge that reaches it — *also named by* — so a second reason is never hidden. */
  alsoFrom: ClosureEdge[];
}

/**
 * ***The closure as a tree, every level*** — [04 §9.1]'s *every level is
 * shown, not just the first*: *"the actor two steps out whose lorebook came
 * along is named in the review, because 'why is this package 40 MB' should be
 * answerable before the file exists rather than after."*
 *
 * Each node sits under the node that first reached it; every other edge that
 * reaches it is in `alsoFrom`, so a book two treatments link appears once and
 * says both. Roots are the starting points, in order.
 */
export function closureTree(c: Closure): ClosureTreeNode[] {
  const under = new Map<NodeKey | null, ClosureNode[]>();
  for (const node of c.nodes) {
    const via = c.edges[node.parent];
    if (via === undefined) continue;
    const list = under.get(via.from) ?? [];
    list.push(node);
    under.set(via.from, list);
  }
  const grow = (node: ClosureNode, depth: number): ClosureTreeNode[] => {
    const via = c.edges[node.parent];
    if (via === undefined) return [];
    return [
      {
        key: node.key,
        via,
        // The depth bound is belt and braces for a hand-built closure: a parent
        // is discovered strictly before its child, so a real one cannot cycle.
        children:
          depth > c.nodes.length
            ? []
            : (under.get(node.key) ?? []).flatMap((child) => grow(child, depth + 1)),
        alsoFrom: node.inbound
          .filter((index) => index !== node.parent)
          .map((index) => c.edges[index])
          .filter((edge): edge is ClosureEdge => edge !== undefined),
      },
    ];
  };
  return (under.get(null) ?? []).flatMap((root) => grow(root, 0));
}

/**
 * ***`requires`, derived and authored, with the author winning by id*** —
 * [04 §9.1]'s *derived where it can be … an author can add to the list and
 * should rarely need to.*
 *
 * **Authored first, then whatever the derivation found that the author did not
 * name.** An author who wrote `scene ≥ 1.2` knows something the derivation
 * cannot — that 1.1 had the bug — so their entry stands; one who wrote nothing
 * gets the derived list. The derived half is never persisted as the World's
 * ([P16.3]'s decisions, [00 §2.8]): it goes in the manifest, for the reader's
 * warning, and the stored World keeps what its author wrote.
 */
export function mergeRequires(
  derived: World['requires'],
  authored: World['requires'] | null,
): World['requires'] {
  const byId = <T extends { id: string }>(first: readonly T[], second: readonly T[]): T[] => {
    const seen = new Set<string>();
    const out: T[] = [];
    for (const entry of [...first, ...second]) {
      if (seen.has(entry.id)) continue;
      seen.add(entry.id);
      out.push(entry);
    }
    return out;
  };
  const mine = authored ?? { modes: [], extensions: [], capabilities: [] };
  return {
    modes: byId(listOf(mine.modes), listOf(derived.modes)),
    extensions: byId(listOf(mine.extensions), listOf(derived.extensions)),
    capabilities: unique([...listOf(mine.capabilities), ...listOf(derived.capabilities)]),
  };
}

/** A stored World is validated, but `requires` is also read from hand-edited files: arrays or nothing. */
function listOf<T>(value: readonly T[] | undefined): readonly T[] {
  return Array.isArray(value) ? (value as readonly T[]) : [];
}

function unique<T>(values: readonly T[]): T[] {
  return [...new Set(values)];
}

/**
 * ***What an orphan came with*** — the nodes left out of the file whose
 * dropping stranded it, nearest first, in inbound order.
 *
 * Walked backwards from the orphan: an inbound node that is not carried is
 * collected — it is what brought this in and is now gone; one that *is*
 * carried is another orphan (it reaches this one, so had it been reached, this
 * one would have been too), and the walk carries on behind it. So an actor's
 * book two steps out of a dropped treatment *came with the treatment*, as its
 * actor did, and the review can put both under one *leave these out too*;
 * a cycle among orphans ends at the first node seen twice.
 */
function cameWithOf(
  c: Closure,
  byKey: ReadonlyMap<NodeKey, ClosureNode>,
  orphan: NodeKey,
  carried: ReadonlySet<NodeKey>,
): NodeKey[] {
  const out: NodeKey[] = [];
  const seen = new Set<NodeKey>([orphan]);
  const queue: NodeKey[] = [orphan];
  // `for…of` over an array that grows while it is read is the queue.
  for (const at of queue) {
    for (const index of byKey.get(at)?.inbound ?? []) {
      const from = c.edges[index]?.from ?? null;
      if (from === null || seen.has(from)) continue;
      seen.add(from);
      // A dropped node is collected and not walked behind: what brought *it*
      // in is not what this one came with.
      if (carried.has(from)) queue.push(from);
      else out.push(from);
    }
  }
  return out;
}
