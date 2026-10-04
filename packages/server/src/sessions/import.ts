// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { createHash } from 'node:crypto';

import {
  ACTOR_SCHEMA,
  LOREBOOK_SCHEMA,
  TREATMENT_SCHEMA,
  uuidv7,
  SESSION_EXPORT_SCHEMA,
  type BranchRef,
  type ChannelEffect,
  type OutputMessage,
  type PortableSchemaId,
  type Rendition,
  type SessionExport,
  type Turn,
} from '@storyengine/shared';

import { findById } from '../index-db/query.js';
import { sessionByOrigin, sessionHoldingTurns } from '../index-db/sessions.js';
import { renditionFrom, sessionAssetsRoot, writeRendition } from '../renditions/store.js';
import { writeJsonAtomic } from '../storage/atomic.js';
import { ensureDirectory, readFileBytes, writeFileBytes } from '../storage/files.js';
import { resolveWithin } from '../storage/paths.js';
import { PRESENCE_CHANNEL, SE_PRESENCE } from './cast.js';
import { channelKey } from './channels.js';
import { walkPath } from './segments.js';
import {
  appendTurnOnly,
  indexWrittenSession,
  readSession,
  readTurns,
  reconstructAlong,
  replayChannels,
  scopeOf,
  sessionFilePath,
  sessionRoot,
  withSessionLock,
  type SessionContext,
} from './store.js';
import type { SessionFile } from './types.js';

/**
 * ***The other half of [P11.10]'s format*** —
 * [19 §3](../../../../docs/design/19-session-import.md),
 * [26 B12](../../../../docs/design/26-open-questions.md),
 * [P11 §3](../../../../docs/design/workplan/28-p11-implementation.md)'s row 10.
 *
 * The gate's row 10 is *"a session exported from this install **loads on another
 * one**, siblings and all"*, and until this there was nothing to load it with —
 * the format was written, the file could be downloaded, and the sentence was
 * unwalkable. [26 E4]'s whole argument for writing the format *with import in
 * mind* was that the two are different documents; this is the reader that makes
 * that claim checkable rather than aspirational.
 *
 * ***A new session, always, and never a merge.*** [07 §3] makes a session a
 * tree of turns keyed by parent, and an import that reconciled two trees would
 * have to decide what a turn with a parent it has never seen means — which is a
 * question nobody has asked and every answer to it loses something. So an import
 * is a **new** session with new local identity, and the thing it came from
 * travels as provenance rather than as an identity claim.
 *
 * ***The turn ids are kept, and that is the decision most likely to be
 * re-argued.*** Every turn names its parent by id, so re-minting them means
 * rewriting every parent link, every `headTurnId`, every effect's turn
 * reference and every rendition's — a graph rewrite over the one structure this
 * project spends the most care on. ~~Keeping them costs a collision **only**
 * between two installs importing each other's sessions of the same session~~
 * (corrected 2026-09-27): it also costs one on **this** install whenever the
 * session is still here, which is every backup import of an account's own
 * sessions and every export loaded back where it came from. The index keeps
 * one row per turn id, so the copy took the original's. That case is refused
 * (`already-here`, below) rather than paid for with a graph rewrite. *The
 * session's own id is re-minted*, because that one is an address on this
 * install and two installs with the same session id is a real and immediate
 * confusion rather than a theoretical one.
 *
 * ***Every turn is marked foreign.*** `Turn.foreign` exists for this — [19 §3]'s
 * second consequence, *"a foreign identifier has somewhere to go"* — and marking
 * is what keeps *this install made this* answerable afterwards. A turn that
 * arrived with its own `foreign` keeps it: the first install it came from is the
 * one that matters, and overwriting it would make a session that had travelled
 * twice claim it came from the middle.
 *
 * ***And a second caller*** — [P13.10](../../../../docs/design/workplan/30-p13-aventuras-import.md),
 * [P13 §0.3](../../../../docs/design/workplan/30-p13-aventuras-import.md#03-how-this-sits-with-25-e4).
 * [26 E4]'s *one format, not N importers* is kept by making every other
 * source a **producer** of this format that hands its document here, so this
 * reader is the only thing that writes an imported session. The first
 * producer was our own backup (`backup/import.ts`); the second is Aventuras'
 * stories, and it is the first whose document this build did not write. Four
 * things a reader of our own exports could leave unchecked had to be checked
 * once somebody else's converter was writing the input:
 *
 * - **A key to be found by again** — `SessionImportOptions.originalFilename`,
 *   stamped as `origin.originalFilename` and indexed, so a re-import of the
 *   same source is refused as `already-here` naming the session it made.
 * - **A tree**, rather than a list whose order the file promised — see
 *   {@link treeOf}.
 * - **Links that resolve**, or a report of the ones that do not — see
 *   `SessionImportOptions.requireLinks`.
 * - **Turn ids a producer derives rather than mints**, which is
 *   `producer.ts`'s, and the reason the refusal above is a refusal and not a
 *   copy.
 *
 * ***And a third, which extends rather than refuses*** — the chat doors of
 * [P14](../../../../docs/design/workplan/31-p14-scene-and-session-import.md)
 * (`import/chat-sessions.ts`), whose sources go on growing, so a re-import of
 * one is a sync ([P14 §2.7]) rather than a duplicate. **The two arrived on two
 * branches at once and found the same key**: P13.10 indexed
 * `origin.originalFilename` so a producer's re-import could be *refused*, and
 * P14.10a indexed the same field, at the same schema version, so a chat's
 * could be *extended*. One column serves both (`sessionByOrigin`), and what
 * tells them apart is the caller: `extend` is asked for by the chat doors and
 * never inferred, so every other door — an export, a backup, a producer —
 * keeps the refusal, now naming the session the key found.
 *
 * ***What the trash does to both refusals***, recorded rather than solved: a
 * session in the trash has no index rows, so neither its turns nor its key
 * are *here*, and an import of the same session or source is written — and
 * restoring the trashed one afterwards gives two sessions one set of turn
 * ids. `backup/import.ts` asks the trash by session id for its own case; an
 * export or a producer's source has no id the trash could be asked by.
 */

export interface ImportContext {
  sessions: SessionContext;
}

export interface SessionImportOptions {
  /**
   * A rendition's pixels, by the record's `asset.path`, when the source has
   * them. A backup does; an export carries the records and not the pixels
   * (`SessionExport.renditions`), so a picture imported without them arrives
   * as one whose pixels were cleared, with its recipe and a retry.
   */
  pixels?: (path: string) => Promise<Uint8Array | null>;
  /**
   * ***A re-import extends the session it came from*** —
   * [P14 §2.7](../../../../docs/design/workplan/31-p14-scene-and-session-import.md),
   * [P14.10a]. Set by the chat doors (`import/chat-sessions.ts`), whose
   * documents a converter assembled from a source that goes on changing; see
   * {@link extendSession}.
   *
   * ***Asked for, never inferred from the document.*** An export from this
   * install loaded back where it came from also names turns that are here, and
   * may carry an `originalFilename` too, if the session it was exported from
   * was an imported chat. That is §2.7's *"original case"* for `already-here`:
   * there is no source to extend from, only a copy of what is here. So the
   * export and backup doors leave this unset and keep the refusal.
   */
  extend?: boolean;
  /**
   * ***What the session was made from, in its source's own terms*** — a
   * producer's idempotence key, e.g. `aventura.db/stories/<id>`
   * ([P13 §1.5](../../../../docs/design/workplan/30-p13-aventuras-import.md#15-identity-is-the-row-not-the-file)).
   *
   * Stamped as the session's `origin.originalFilename` — the field [03 §8]
   * gave `origin` from the start — and indexed (`session.origin_filename`),
   * so an import carrying a key a session of this account already carries is
   * refused `already-here`, with that session's id and name. **The library's
   * rule, applied to a session**: same owner, same source, one object
   * ([P4 §1.3]). Source-relative, never an absolute path, for the
   * foreign-path doctrine `stampImported` states ([22 §4.1.1]).
   *
   * ***An option rather than a field of the format***, and the format's
   * version does not move. The format already carries the value — `origin` is
   * part of the session document, which the exporter writes as it is on disk,
   * and a chat's converter writes its family's root there ([P14 §2.7]) — so a
   * session a producer made takes its key with it when it is exported, and
   * this reader keeps it. What was missing was a way for a producer to *say*
   * it without writing an `origin` of its own into a document whose `origin`
   * this reader owns. Given, it wins over the document's.
   */
  originalFilename?: string;
  /**
   * ***Refuse, rather than report, a link that resolves to nothing here.***
   *
   * `cast`, `lore` and `treatment` are **links** ([03 §8]) — ids resolved
   * fresh every turn — and play already survives one that names nothing
   * (`resolveCast`, `resolveLore`: *resolve what you can, show what you
   * cannot, never block*, [00 §3.3]). So an export loaded on another install,
   * whose cast lives on the install it came from, is imported and the result
   * names what did not resolve: refusing it would refuse nearly every real
   * session on row 10's *"loads on another one"*, and dropping the links would
   * lose them for the day the same objects arrive by package.
   *
   * *A producer is the other case.* It writes the objects its session links
   * to before it writes the session, so a link that resolves to nothing is its
   * own defect, and a session written around it is the half-written import
   * this reader's header exists to prevent. It passes this and is refused
   * `missing-links` instead, before anything is written.
   *
   * *Asked of a new session only.* An extending import adds turns to a
   * session whose links are already what they are, and the chat doors resolve
   * their cast onto cards before they build the document.
   */
  requireLinks?: boolean;
}

/** The links a session names that resolve to nothing this account can read. */
export interface MissingLinks {
  cast: string[];
  lore: string[];
  treatment: string[];
}

export type SessionImport =
  | {
      ok: true;
      extended?: undefined;
      sessionId: string;
      turns: number;
      renditions: number;
      /** Reported, not refused, unless `requireLinks` — see there. */
      missing: MissingLinks;
    }
  | {
      ok: true;
      extended: true;
      sessionId: string;
      /** Turns written by this import; `0` with {@link SessionSync.unchanged} is `unchanged`. */
      appended: number;
      sync: SessionSync;
    }
  | {
      ok: false;
      reason: 'unreadable' | 'wrong-schema' | 'no-turns' | 'broken-tree' | 'already-here';
    }
  | {
      ok: false;
      reason: 'already-here';
      /**
       * The session of this account an earlier import of the same source made
       * — present only when the key found it, because a turn found by id may
       * be another account's, and naming it would say so.
       */
      prior: { sessionId: string; name: string };
    }
  | { ok: false; reason: 'missing-links'; missing: MissingLinks };

/**
 * ***The session of this account a source already became, asked before a
 * producer writes anything*** —
 * [P13.12](../../../../docs/design/workplan/30-p13-aventuras-import.md).
 *
 * {@link importSession} answers the same question, but only once it is handed
 * a document — and a producer whose session links to library objects writes
 * those objects *first*, so `requireLinks` holds. For a source already here
 * that order would rewrite the objects of a session that is not going to be
 * written again: new actors nobody's cast names, and a replaced book beside
 * turns that never saw it. So the producer asks here, and writes nothing when
 * the answer is a session. The same index row, under the same owner key, as
 * the check in {@link importSession} and the chat doors' `extend` arm — one
 * question, asked earlier, and never a second rule.
 */
export function priorSessionImport(
  context: ImportContext,
  handle: string,
  originalFilename: string,
): { sessionId: string; name: string } | null {
  return sessionByOrigin(
    context.sessions.index,
    scopeOf(context.sessions, handle),
    originalFilename,
  );
}

/**
 * ***What an extending import did, counted*** — the facts `chat-sessions.ts`
 * turns into the review row's notes, so the person is told what a sync did
 * and, more to the point, what it declined to do ([P14 §2.7]'s *"says so"*).
 */
export interface SessionSync {
  /**
   * ***Nothing was written that a person could see*** — no turn, ref, flag,
   * setting or cast member. The ledger's `unchanged`. A sync that appended
   * nothing and did carry an unhide across is not this, and says so.
   */
  unchanged: boolean;
  /** Somebody played on here since the last import — see {@link playedOnHere}. */
  playedOn: boolean;
  /** The head followed the source's head, which only an untouched session does. */
  headMoved: boolean;
  /** Chats new in the source's family, each now a ref here. */
  refsAdded: number;
  /** Refs the source already had, moved to where their chats now end. */
  refsMoved: number;
  /**
   * ***Rounds that grew in the source since the last import*** — §2.7's open
   * case, decided at [P14.10a]: the grown round is a new sibling beside the
   * round as it was imported, and this counts them so the row can say which
   * is which.
   */
  roundsGrown: number;
  /** Imported turns the source no longer has — deleted or edited there. Kept here. */
  notInSource: number;
  /** Imported turns whose hidden flags came across from the source. */
  hiddenChanged: number;
  /** Chat settings the source changed since, taken where nobody changed them here. */
  settingsChanged: number;
  /** Members whose mute the source changed since, written onto the new turns. */
  mutesChanged: number;
  /**
   * Mute changes that have not reached the source's current path — nothing new
   * came, or only a swipe or branch off it — which wait for the next graft on it.
   */
  mutesWaiting: number;
  /** Characters who spoke for the first time in the new messages, added to the cast. */
  castAdded: number;
}

/**
 * Reads a document that came from somewhere else.
 *
 * ***Defensive at every step, because the input is a file a person chose.***
 * [00 §3.3]'s posture applied to an import: a document this build cannot read is
 * a refusal with a reason, never a half-written session — and half-written is
 * the failure that is worst here, because a session is a tree and a tree missing
 * its middle is not a smaller tree.
 */
export function readSessionExport(document: unknown): SessionExport | { reason: string } {
  if (typeof document !== 'object' || document === null) return { reason: 'unreadable' };
  /**
   * ***Narrowed through `Record<string, unknown>` rather than through
   * `Partial<SessionExport>`.*** The partial would make every guard below
   * *unnecessary* to the type checker — and the lint rule that says so would be
   * right about the type and wrong about the world: what arrives here is a file
   * somebody chose, and the type is what we are trying to establish rather than
   * what we have.
   */
  const row = document as Record<string, unknown>;
  if (row['schema'] !== SESSION_EXPORT_SCHEMA) return { reason: 'wrong-schema' };
  const session = row['session'];
  if (typeof session !== 'object' || session === null) return { reason: 'unreadable' };
  if (!Array.isArray(row['turns'])) return { reason: 'unreadable' };
  return document as SessionExport;
}

export async function importSession(
  context: ImportContext,
  handle: string,
  document: unknown,
  options: SessionImportOptions = {},
): Promise<SessionImport> {
  const result = await loadSession(context, handle, document, options);
  /**
   * ***And then the chain is warmed, outside this call*** — [P14.11],
   * [19 §7.5]: *"an imported 2,000-turn chat at the default `span: 20` asks for
   * ~99 summariser calls, one after another, inside the first turn played
   * after import."* Told here rather than by each door, and after a sync as
   * well as a first import, since a sync that appended a hundred turns is the
   * same cliff a hundred turns high. A sync that changed nothing is told too:
   * a warm over a warm chain reads the link files and asks for nothing, and a
   * chain the last warm did not finish — a restart, a failed link — is
   * finished by this one.
   */
  if (result.ok) context.sessions.imported?.(handle, result.sessionId);
  return result;
}

async function loadSession(
  context: ImportContext,
  handle: string,
  document: unknown,
  options: SessionImportOptions,
): Promise<SessionImport> {
  const read = readSessionExport(document);
  if ('reason' in read) {
    return { ok: false, reason: read.reason as 'unreadable' | 'wrong-schema' };
  }
  /**
   * *A session with no turns is a session with nothing in it*, and importing one
   * would produce an empty session whose only content is a claim about where it
   * came from. Refused with its own reason rather than folded into
   * `unreadable`, because the two have different remedies: one is a broken file
   * and the other is the wrong file.
   */
  if (read.turns.length === 0) return { ok: false, reason: 'no-turns' };

  // `unknown[]` rather than `Turn[]`, for `readSessionExport`'s reason: the
  // declared element type is the claim the file makes about itself, and a
  // malformed member is exactly what a hand-edited export has.
  const listed = (read.turns as unknown[]).filter(
    (candidate): candidate is Turn =>
      typeof candidate === 'object' &&
      candidate !== null &&
      typeof (candidate as { id?: unknown }).id === 'string',
  );

  /**
   * ***A tree before anything else, on every path*** ([P13.10]) — including
   * the `extend` arm below, which appends a turn only once its parent is
   * present and so leans on parents-first order as much as a new session
   * does. A chat's document is its whole family, every turn's parent in it,
   * so nothing a converter builds is refused here; what is refused is what no
   * path could write whole.
   */
  const turns = treeOf(listed, read.session.headTurnId);
  if (turns === null) return { ok: false, reason: 'broken-tree' };

  const owner = scopeOf(context.sessions, handle);
  /**
   * *The producer's word, else the document's* — a key given as an option is
   * the source speaking now; one the document carries is where the session
   * was last imported from, kept as `foreign` is ([P13.10], [P14.10a]).
   */
  const originalFilename = options.originalFilename ?? originalFilenameOf(read.session);

  /**
   * ***The `extend` arm*** — [P14 §2.7], [P14.10a]: a source this account
   * imported before is found, and the import extends that session rather
   * than refusing it.
   */
  if (options.extend === true) {
    const target = extendTarget(context, handle, originalFilename, turns);
    if (target !== null) {
      return extendSession(context, handle, target, read, turns, originalFilename);
    }
  }

  /**
   * ***A source this account has already imported is refused, naming the
   * session it made*** ([P13.10]). Asked before the turns, because it is the
   * answer a person can act on: *already here, as Rain City*. The turn check
   * below would refuse the same re-import whenever the producer's ids are
   * stable (`producer.ts`); this one holds when they are not — a producer
   * whose derivation changed between versions — and it is scoped to the
   * account, where a turn id is one row on the install.
   *
   * *Reached with a key found only when `extend` was not asked for*, since
   * {@link extendTarget} asks the same row first and extends what it finds.
   * So for a chat door this is unreachable, and for an export or a backup of
   * an imported chat's session it is §2.7's *"original case"* for
   * `already-here` — a copy of what is here — told by name ([P14 §2.7]).
   */
  if (originalFilename !== null) {
    const prior = sessionByOrigin(context.sessions.index, owner, originalFilename);
    if (prior !== null) return { ok: false, reason: 'already-here', prior };
  }

  /**
   * ***A session whose turns are already here is refused*** (2026-09-27), the
   * header's correction. The copy used to be made, and the original's search
   * hits and by-id reads then went to the copy's segments at the copy's
   * offsets; deleting the copy took the original's rows with it.
   */
  if (sessionHoldingTurns(context.sessions.index, turnIdsOf(turns)) !== null) {
    return { ok: false, reason: 'already-here' };
  }

  const missing = missingLinks(context, owner, read.session);
  if (
    options.requireLinks === true &&
    missing.cast.length + missing.lore.length + missing.treatment.length > 0
  ) {
    return { ok: false, reason: 'missing-links', missing };
  }

  const now = new Date().toISOString();
  const id = uuidv7();
  const { id: was, ...document_ } = read.session;
  const session = {
    ...document_,
    schema: 'storyengine.session/1',
    id,
    createdAt: now,
    updatedAt: now,
    /**
     * ***What it came from*** — [03 §8]'s `origin`, which that section specified
     * and nothing implemented until the format needed it.
     *
     * *The exporting install's own id for the session is not an address here*
     * once this install has minted its own; it is a fact about where the file
     * was made. It travels on every turn, as `foreign.source` (below), and this
     * record carries the rest of that fact.
     */
    origin: {
      source: 'import' as const,
      creator: null,
      version: exportedBy(read),
      license: null,
      /**
       * ***The source's own name for itself, kept*** ([P13.10], [P14.10a]).
       * Null until then, because the only documents were exports, which have
       * no source file to name. A producer gives its key as an option
       * (`aventura.db/stories/<id>`); a chat's document names its family's
       * root path (`chat/build.ts`). Either is what a later import finds the
       * session by (`sessionByOrigin`) — to refuse it, or, at a chat door, to
       * extend it ([P14 §2.7]). An export of such a session carries it too, so
       * a backup restored elsewhere is still that source's session there.
       */
      originalFilename,
      createdAt: read.session.createdAt,
      updatedAt: read.session.updatedAt,
    },
  } as unknown as SessionFile;

  const root = sessionRoot(context.sessions.layout, handle, id);
  await ensureDirectory(root);
  await context.sessions.layout.assertReal(root);
  await writeJsonAtomic(sessionFilePath(context.sessions.layout, handle, id), session);
  // Indexed as every other session write is, so the session lists, links and
  // joins its turns' search rows from the moment it exists. This wrote the
  // file and nothing else, and an imported session had no row until somebody
  // happened to save it.
  indexWrittenSession(context.sessions, handle, session);

  /**
   * ***Parents before children, which is {@link treeOf}'s order.*** The tree
   * is the parent links and the file order is not the tree — but appending a
   * child before its parent would make every reader that walks forward see a
   * turn with a dangling parent for the length of the import. ~~In the order
   * the exporter wrote them, which is creation order~~ — this used to trust
   * the file for that, and nothing checked it (corrected 2026-09-29, [P13.10]).
   *
   * ***Each turn names the session it is in now.*** It kept the exporter's id,
   * which went into the index beside a location in this session's segments.
   * The id it came from is `foreign.source`, which is where provenance lives.
   */
  for (const turn of turns) {
    await appendTurnOnly(context.sessions, handle, id, { ...foreignise(turn, was), sessionId: id });
  }

  const renditions = await importRenditions(
    context,
    handle,
    { id, was },
    read,
    new Set(turnIdsOf(turns)),
    options,
  );
  /**
   * ***What the source said as it came in, for the next import to compare
   * with*** — but only a chat door's document *is* what the source said.
   *
   * A backup or an export also carries `originalFilename` when the session it
   * was made from was an imported chat, and restoring one should leave it
   * syncable. Its document is that session as it was played, though: its head,
   * hides and settings are the person's, and a record calling them the
   * source's would make the next sync count the session as untouched — move
   * the head off their path and revert their hides wherever the chat differs,
   * §2.7's two promises broken at once. So a restored session gets
   * {@link restoredRecord}, which assumes everything here was chosen here.
   *
   * ***And a producer's session gets none*** ([P13.10]). A key given as an
   * option is a producer's, whose re-import is refused rather than synced
   * ([P13.12]'s *the world follows the session*), so no sync will ever read
   * a record beside it, and writing one would put a chat's bookkeeping in a
   * session that is not a chat's. An export of that session, loaded
   * elsewhere, carries the key in its document and gets a restored record
   * there like any other — harmless, since only a chat door extends, and no
   * chat's root path is an Aventuras key.
   */
  if (originalFilename !== null && options.originalFilename === undefined) {
    await writeSyncRecord(
      context.sessions,
      handle,
      id,
      options.extend === true
        ? { ...recordOf(read.session, turns, originalFilename), importedHead: session.headTurnId }
        : restoredRecord(read.session, turns, originalFilename),
    );
  }
  return { ok: true, sessionId: id, turns: turns.length, renditions, missing };
}

function turnIdsOf(turns: readonly Turn[]): string[] {
  return turns.map((turn) => turn.id);
}

/**
 * ***The turns as a tree, parents first — or null when they are not one***
 * ([P13.10], 2026-09-29).
 *
 * The append loop's comment has always said the file is in creation order and
 * that creation order puts a parent before its child. Nothing checked either
 * half, and a producer is a second writer that could get the first wrong in
 * a way our own exports never showed.
 *
 * ***Ordered here rather than refused for being out of order***, which is the
 * one place this departs from [P13.10]'s wording (*"parents validated to
 * precede children"*). **Our own exporter can write a child first**: it sorts
 * by id on the argument that a uuidv7 carries its mint time
 * (`sessions/export.ts`), and a session played on two installs — exported
 * from one whose clock ran ahead, imported and played on one behind — has
 * children whose ids sort before their parents'. Refusing that would refuse
 * our own file for a property no person could see or fix, and the order is
 * recoverable from the parent links, which are the tree. So the order is
 * made, stably — file order wherever file order already works — and what is
 * refused is what no order can mend:
 *
 * - **a parent that names no turn in the file** — the tree missing its middle
 *   that this reader's docstring calls worse than no session at all;
 * - **a cycle**, which is a turn that is its own ancestor and has no place in
 *   any order;
 * - **a head that names no turn in the file**, which would leave the new
 *   session pointing at nothing — a producer that took the head from the
 *   wrong branch, say — where a head that fails to resolve reads as an empty
 *   story.
 *
 * ***A repeated id is one turn, the last line of it***, which is what the
 * segment reader does (`readTurns` keeps the last) and so what the session
 * the file came from showed. A segment can legitimately hold a turn twice —
 * an append the commit protocol re-ran — and a backup carries its segments
 * as they are.
 *
 * *A tombstone is exempt from the parent check*, since it names a turn that
 * was removed rather than one that is part of the story; it is carried, as
 * the segment would carry it, and every reader skips it.
 */
function treeOf(listed: readonly Turn[], head: unknown): Turn[] | null {
  const byId = new Map<string, Turn>();
  for (const turn of listed) byId.set(turn.id, turn);

  const childrenOf = new Map<string, Turn[]>();
  const roots: Turn[] = [];
  for (const turn of byId.values()) {
    const parent: unknown = turn.parentTurnId;
    if (turn.removed === true || parent === null) {
      roots.push(turn);
      continue;
    }
    if (typeof parent !== 'string' || !byId.has(parent)) return null;
    const siblings = childrenOf.get(parent);
    if (siblings === undefined) childrenOf.set(parent, [turn]);
    else siblings.push(turn);
  }
  if (typeof head === 'string' && !byId.has(head)) return null;

  /**
   * *Depth first with an explicit stack*, because a story is a chain and a
   * long one would overflow a recursive walk. Children are pushed in reverse
   * so they come off in file order, which keeps an already-ordered file in
   * its own order.
   */
  const ordered: Turn[] = [];
  const stack = [...roots].reverse();
  while (stack.length > 0) {
    const turn = stack.pop();
    if (turn === undefined) break;
    ordered.push(turn);
    const children = childrenOf.get(turn.id);
    if (children !== undefined)
      for (let at = children.length - 1; at >= 0; at -= 1) {
        const child = children[at];
        if (child !== undefined) stack.push(child);
      }
  }
  // What no root reached is a cycle, or hangs from one.
  return ordered.length === byId.size ? ordered : null;
}

/**
 * ***The links that would resolve to nothing if this session were played
 * here*** — see `SessionImportOptions.requireLinks` for why they are
 * reported, and refused only when a producer asks.
 *
 * **The three conditions `library.read` applies, asked of the index**: a live
 * row under the id, owned by this account or the system library, of the kind
 * the link means. That is what `resolveCast` and `resolveLore` ask at every
 * turn, so a link reported here is one play would miss, and one play would
 * find is never reported. *Not by name*: a session's links are ids
 * (`lore: string[]`), and `resolveLore` passes them with an empty name, so the
 * name fallback never runs for them.
 *
 * Read from the document unknown-first, for `readSessionExport`'s reason.
 */
function missingLinks(context: ImportContext, owner: string, session: unknown): MissingLinks {
  const document = session as Record<string, unknown>;
  const cast = document['cast'];
  const castIds: unknown[] =
    typeof cast === 'object' && cast !== null
      ? [
          (cast as Record<string, unknown>)['persona'],
          ...arrayOf((cast as Record<string, unknown>)['actors']),
        ]
      : [];

  const missing = (ids: readonly unknown[], kind: PortableSchemaId): string[] => {
    const out: string[] = [];
    for (const id of ids) {
      if (typeof id !== 'string' || id === '' || out.includes(id)) continue;
      const row = findById(context.sessions.index, id);
      const readable = row !== null && (row.owner === owner || row.owner === 'system');
      if (!readable || row.schemaId !== kind) out.push(id);
    }
    return out;
  };

  return {
    cast: missing(castIds, ACTOR_SCHEMA),
    lore: missing(arrayOf(document['lore']), LOREBOOK_SCHEMA),
    treatment: missing([document['treatment']], TREATMENT_SCHEMA),
  };
}

function arrayOf(value: unknown): unknown[] {
  return Array.isArray(value) ? (value as unknown[]) : [];
}

/**
 * ***The pictures' records, which the import counted and never wrote***
 * (2026-09-27) — [06 §10.7]'s *recipes are never discarded*.
 *
 * It answered `renditions: n` for the records in the file and wrote none of
 * them, so the imported session's `se.backdrop` and `renditionSelection`
 * named records that did not exist, and the recipes were gone. Each record
 * `readRendition` would accept is written under the new session, and:
 *
 * - **A `pending` one becomes `interrupted`**, as boot recovery writes it: no
 *   job on this install will ever finish it, and `interrupted` is the state
 *   that offers a retry.
 * - **A picture keeps its pixels only if they came with it**, written where
 *   its `asset.path` says, inside this session's `assets/` and nowhere else.
 *   Without them it is a picture whose pixels were cleared: the recipe and a
 *   retry, which is `SessionExport.renditions`' own promise for an export.
 * - **A record of a turn that did not come across is left out**, because
 *   nothing could show it.
 * - **Marked foreign once**, as a turn is: `Rendition.foreign` names the
 *   session and the id it had where it was made, and a record that already
 *   carries one keeps it, for `foreignise`'s reason.
 */
async function importRenditions(
  context: ImportContext,
  handle: string,
  session: { id: string; was: string },
  read: SessionExport,
  turnIds: ReadonlySet<string>,
  options: SessionImportOptions,
): Promise<number> {
  const listed = (read as unknown as Record<string, unknown>)['renditions'];
  if (!Array.isArray(listed)) return 0;

  const { layout } = context.sessions;
  const sessionId = session.id;
  let written = 0;
  for (const candidate of listed) {
    const record = renditionFrom(candidate);
    if (record === null || !turnIds.has(record.turnId)) continue;

    let rendition: Rendition = {
      ...record,
      sessionId,
      foreign: record.foreign ?? { source: session.was, id: record.id },
    };
    if (rendition.state === 'pending') {
      rendition = { ...rendition, state: 'failed', asset: null, error: 'interrupted' };
    }
    rendition = {
      ...rendition,
      asset: await carryPixels(layout, handle, sessionId, rendition.asset, options),
    };

    try {
      await writeRendition(layout, handle, sessionId, rendition);
      written += 1;
    } catch {
      // An id that names no path, which `writeRendition` refuses. The record
      // is somebody's hand edit rather than a picture this install could show.
    }
  }
  return written;
}

/**
 * A rendition's pixels, written into the new session, or null when absent.
 *
 * The asset is read as `unknown`: `renditionFrom` checks the recipe, which is
 * what must survive, and not this, which may be anything a file says.
 */
async function carryPixels(
  layout: SessionContext['layout'],
  handle: string,
  sessionId: string,
  held: unknown,
  options: SessionImportOptions,
): Promise<Rendition['asset']> {
  if (options.pixels === undefined || typeof held !== 'object' || held === null) return null;
  const asset = held as Record<string, unknown>;
  const path = asset['path'];
  const mime = asset['mime'];
  if (typeof path !== 'string' || typeof mime !== 'string') return null;
  /**
   * ***The type is one the worker writes***, because the asset route serves the
   * record's `mime` as the response's content type: without this, a record in
   * an archive saying `text/html` over bytes that are a page would be served as
   * one, from this server's origin.
   */
  if (!IMAGE_TYPES.has(mime)) return null;

  const root = sessionAssetsRoot(layout, handle, sessionId);
  let to: string;
  try {
    to = resolveWithin(root, path);
  } catch {
    return null;
  }
  if (to === root) return null;

  const bytes = await options.pixels(path);
  if (bytes === null) return null;

  try {
    await ensureDirectory(root);
    await writeFileBytes(to, bytes);
  } catch {
    // A picture that cannot be written is one whose pixels are not here, which
    // is a state the record already has words and a retry for. It is not a
    // reason to lose the session it belongs to.
    return null;
  }
  // Described by the bytes that arrived, since `digest` is the route's etag.
  return {
    path,
    mime,
    bytes: bytes.byteLength,
    digest: `sha256:${createHash('sha256').update(bytes).digest('hex')}`,
  };
}

/**
 * The types an imported picture may keep its pixels under — PNG, JPEG and WebP,
 * the three every other picture this server stores is held to. Anything else
 * arrives as a picture that can be made again, which costs a regeneration.
 */
const IMAGE_TYPES: ReadonlySet<string> = new Set(['image/png', 'image/jpeg', 'image/webp']);

/** What wrote the file, if it said — the same unknown-first reading as above. */
function exportedBy(read: SessionExport): string | null {
  const said = (read as unknown as Record<string, unknown>)['exportedBy'];
  if (typeof said !== 'object' || said === null) return null;
  const version = (said as Record<string, unknown>)['version'];
  return typeof version === 'string' ? version : null;
}

/**
 * Marks a turn as having come from somewhere else, once.
 *
 * *A turn that already carries `foreign` keeps it*, because the first install it
 * came from is the one that matters — a session that had travelled twice and
 * claimed it came from the middle would be a provenance record that gets less
 * true the more it is used.
 */
function foreignise(turn: Turn, source: string): Turn {
  if (turn.foreign !== undefined) return turn;
  return { ...turn, foreign: { source, id: turn.id } };
}

// ---------------------------------------------------------------------------
// Sync — [P14 §2.7], [P14.10a]
// ---------------------------------------------------------------------------

/**
 * `origin.originalFilename` as the document says it, read as a file a person
 * chose: a non-empty string or nothing.
 */
function originalFilenameOf(session: SessionExport['session']): string | null {
  const origin = session['origin'];
  if (typeof origin !== 'object' || origin === null) return null;
  const named = (origin as Record<string, unknown>)['originalFilename'];
  return typeof named === 'string' && named !== '' ? named : null;
}

/**
 * ***Which session a re-import extends***, or null for a new one.
 *
 * 1. **By its source** — `(account, originalFilename)` through the index, the
 *    library's re-import rule applied to a session ([P14 §2.7]).
 * 2. **By its turns**, for a session imported before [P14.10a] stamped the
 *    source: its `originalFilename` is null, and a chat's turn ids are its
 *    account and content ([P14 §2.4]), so a session holding them is the one
 *    that chat made. It is stamped as it is extended, and found by 1 after.
 *
 * *Only a session in this account's own folder*, whichever way it was found:
 * the turn index is install-wide, and a session that another account holds —
 * or one that names a different source — is not this chat's to extend. The
 * caller then refuses `already-here`, as it always did.
 */
function extendTarget(
  context: ImportContext,
  handle: string,
  originalFilename: string | null,
  turns: readonly Turn[],
): string | null {
  const owner = scopeOf(context.sessions, handle);
  if (originalFilename !== null) {
    const found = sessionByOrigin(context.sessions.index, owner, originalFilename);
    if (found !== null) return found.sessionId;
  }
  const holding = sessionHoldingTurns(context.sessions.index, turnIdsOf(turns));
  if (holding === null) return null;
  const row = context.sessions.index
    .prepare('select owner, origin_filename from session where session_id = ?')
    .get(holding) as { owner: string; origin_filename: string | null } | undefined;
  if (row?.owner !== owner) return null;
  return row.origin_filename === null || row.origin_filename === originalFilename ? holding : null;
}

/**
 * ***What the source said at the last import*** — the third side of every
 * three-way merge {@link extendSession} makes, kept beside the session as
 * `import-sync.json`.
 *
 * **Why a third side at all.** §2.7 says *"an unhide in ST arrives and a hide
 * made here stays"*, and the head *"moves only if nobody has played on"*. Both
 * are questions about what changed **here** since the import, and the session
 * file alone cannot answer them: a flag that differs from the source's could
 * have been set here or unset there. Against what the source said last time
 * the two are told apart — the source moved if its value differs from this
 * record's, and the session moved if its value does.
 *
 * ***Beside the session file, not in it.*** `SessionFile` is the portable
 * record ([P11.10]'s freeze), and this is bookkeeping about one install's
 * relationship with a source on the same disk, which an export has no reason
 * to carry and another install no use for. A session without one — imported
 * before [P14.10a], or restored from a backup — is read by {@link recordFrom},
 * which says what it assumes.
 */
interface SyncRecord {
  schema: typeof SYNC_SCHEMA;
  originalFilename: string;
  /**
   * The head the last import left. The session has been played on here if its
   * head is anywhere else ({@link playedOnHere}).
   */
  importedHead: string | null;
  /** Every ref id the source's family has had, so a ref deleted here stays deleted. */
  refs: string[];
  /**
   * ***Every turn id the source has put here***, so a turn deleted here stays
   * deleted. The index's row for a tombstoned turn would say so too, but only
   * until a rebuild, which re-reads the segments and skips tombstones — and
   * the record is what survives one. It is also what tells the source's own
   * turns from those played here when {@link muteEffects} reads the source's
   * last word on a path.
   */
  turns: string[];
  /** The document's cast as the source had it, so a member removed here stays removed. */
  cast: string[];
  /** `session.hidden` as the source had it. */
  hidden: Record<string, true | number[]>;
  /** The Scene chat settings as the source had them — {@link SETTINGS}. */
  settings: Record<string, unknown>;
}

const SYNC_SCHEMA = 'storyengine.session-sync/1';
const SYNC_FILE = 'import-sync.json';

/**
 * ***The session fields a source's settings land in*** ([P14 §2.6]): how a chat
 * is voiced, dispatched and ordered, and its author's note. Each is merged on
 * its own, so a reply order changed here survives a note changed there.
 */
const SETTINGS = ['voice', 'dispatch', 'speakers', 'note'] as const;

/** What a document says, as a sync record's sides — everything but the head. */
function recordOf(
  session: SessionExport['session'],
  turns: readonly Turn[],
  originalFilename: string,
): SyncRecord {
  return {
    schema: SYNC_SCHEMA,
    originalFilename,
    importedHead: null,
    refs: refsIn(session).map((ref) => ref.id),
    hidden: hiddenIn(session),
    settings: Object.fromEntries(SETTINGS.map((field) => [field, session[field]])),
    turns: turnIdsOf(turns),
    cast: castIn(session),
  };
}

/**
 * ***A record for a session restored from a backup or an export*** — nothing
 * in it is taken as the source's word, because the document is the session as
 * somebody played it.
 *
 * - **No imported head**, so any head reads as played on
 *   ({@link playedOnHere}) and no sync moves the person. The root chat's ref
 *   would catch a head played past it, but not one played on and then walked
 *   back to where the chat ended — and with every restored turn marked
 *   `foreign`, nothing else would either.
 * - **No hidden flags or settings**, so every value the session has reads as
 *   changed here and is kept; a flag or setting the session never had is the
 *   source's to fill. What this costs is an unhide in the source of a line
 *   hidden before the backup, which does not arrive.
 * - **The refs, turns and cast are the document's**, which is what makes a
 *   ref, turn or member deleted here after the restore stay deleted.
 *
 * After the first sync the record is the source's own again ({@link recordOf}).
 */
function restoredRecord(
  session: SessionExport['session'],
  turns: readonly Turn[],
  originalFilename: string,
): SyncRecord {
  return {
    ...recordOf(session, turns, originalFilename),
    hidden: {},
    settings: {},
  };
}

/** The document's cast, read as a file a person chose: its actor ids that are strings. */
function castIn(session: SessionExport['session']): string[] {
  const cast = session['cast'] as { actors?: unknown } | undefined;
  const actors = Array.isArray(cast?.actors) ? (cast.actors as unknown[]) : [];
  return actors.filter((actor): actor is string => typeof actor === 'string');
}

/**
 * ***A record for a session that has none***, read off the session itself.
 *
 * - **The imported head** is where the root chat's ref points — the ref the
 *   import named for the chat the session opened on, which no gesture here
 *   moves (a ref is renamed or deleted, never re-pointed). A session whose
 *   root ref is gone reads as played on, which is the side that moves nobody.
 * - **Hidden flags and settings** read as the session's own, which makes the
 *   source's latest win — the same as a first import would have given, and a
 *   hide made here on a line the source shows is undone, once, on this first
 *   sync (a departure from §2.7 the P14.10a entry records).
 * - **The turns** are the imported ones it holds (`foreign`), and the index
 *   answers for any deleted before this sync, while it still has their rows.
 * - **The cast** is the session's own, so only a member new to both is added.
 */
function recordFrom(
  session: SessionFile,
  held: ReadonlyMap<string, Turn>,
  read: SessionExport,
  originalFilename: string,
): SyncRecord {
  const rootRef = refsIn(read.session)[0];
  const kept = (session.branchRefs ?? []).find((ref) => ref.id === rootRef?.id);
  return {
    schema: SYNC_SCHEMA,
    originalFilename,
    importedHead: kept?.headTurnId ?? null,
    refs: (session.branchRefs ?? []).map((ref) => ref.id),
    hidden: { ...(session.hidden ?? {}) },
    settings: Object.fromEntries(
      SETTINGS.map((field) => [field, (session as unknown as Record<string, unknown>)[field]]),
    ),
    turns: [...held.values()].filter((turn) => turn.foreign !== undefined).map((turn) => turn.id),
    cast: [...(session.cast?.actors ?? [])],
  };
}

async function readSyncRecord(
  context: SessionContext,
  handle: string,
  sessionId: string,
): Promise<SyncRecord | null> {
  const bytes = await readFileBytes(syncPath(context, handle, sessionId));
  if (bytes === null) return null;
  try {
    const value: unknown = JSON.parse(new TextDecoder().decode(bytes));
    if (typeof value !== 'object' || value === null) return null;
    const record = value as Record<string, unknown>;
    const isMap = (field: unknown): boolean => typeof field === 'object' && field !== null;
    // A record somebody mangled is no record, and {@link recordFrom} reads one
    // off the session instead: the fallback that assumes least.
    if (
      record['schema'] !== SYNC_SCHEMA ||
      !Array.isArray(record['refs']) ||
      !Array.isArray(record['turns']) ||
      !Array.isArray(record['cast']) ||
      !isMap(record['hidden']) ||
      !isMap(record['settings'])
    ) {
      return null;
    }
    return value as SyncRecord;
  } catch {
    return null;
  }
}

async function writeSyncRecord(
  context: SessionContext,
  handle: string,
  sessionId: string,
  record: SyncRecord,
): Promise<void> {
  await writeJsonAtomic(syncPath(context, handle, sessionId), record);
}

function syncPath(context: SessionContext, handle: string, sessionId: string): string {
  return resolveWithin(sessionRoot(context.layout, handle, sessionId), SYNC_FILE);
}

/** The document's refs, read defensively: an entry without an id and a head is none. */
function refsIn(session: SessionExport['session']): BranchRef[] {
  const listed = session['branchRefs'];
  if (!Array.isArray(listed)) return [];
  return listed.filter(
    (ref): ref is BranchRef =>
      typeof ref === 'object' &&
      ref !== null &&
      typeof (ref as { id?: unknown }).id === 'string' &&
      typeof (ref as { headTurnId?: unknown }).headTurnId === 'string',
  );
}

function hiddenIn(session: SessionExport['session']): Record<string, true | number[]> {
  const hidden = session['hidden'];
  return typeof hidden === 'object' && hidden !== null
    ? { ...(hidden as Record<string, true | number[]>) }
    : {};
}

/**
 * ***Who the source has muted now***, as the document's opening turns say it:
 * the builder writes a group's muted members as `se.presence: false` on every opening turn
 * (`chat/build.ts`'s `mutedEffects`), and nothing else writes an effect on a
 * turn that has no parent.
 */
function mutedIn(turns: readonly Turn[]): Set<string> {
  const muted = new Set<string>();
  for (const turn of turns) {
    if (turn.parentTurnId !== null) continue;
    for (const effect of turn.effects) {
      if (effect.channelId === SE_PRESENCE && effect.after === false && effect.scopeKey) {
        muted.add(effect.scopeKey);
      }
    }
  }
  return muted;
}

/**
 * ***Played on here since the import*** — the test [P14 §2.7]'s *"it does not
 * move the person"* turns on, defined at [P14.10a]:
 *
 * - **a turn this install minted** — every imported turn carries `foreign`
 *   (`foreignise`) and nothing else writes it, so a turn without one was
 *   played, swiped, edited or reconciled here;
 * - **or the head is not where the last import left it** — the person
 *   navigated to another sibling or branch, which is a choice about where they
 *   are even though no turn records it;
 * - **or a turn is in flight**, whose commit is about to do one of the above.
 *
 * Any of the three, and the head, `lastSelectedChild` and the refs made here
 * stay as they are. None of them, and the session follows the source's head,
 * *"which is the case where following is plainly what was meant"*.
 */
function playedOnHere(
  context: SessionContext,
  session: SessionFile,
  held: ReadonlyMap<string, Turn>,
  record: SyncRecord,
): boolean {
  if (context.busy?.(session.id) === true) return true;
  if ((session.headTurnId ?? null) !== record.importedHead) return true;
  for (const turn of held.values()) if (turn.foreign === undefined) return true;
  return false;
}

/**
 * ***A re-import, extending the session it came from*** —
 * [P14 §2.7](../../../../docs/design/workplan/31-p14-scene-and-session-import.md),
 * [P14.10a].
 *
 * **Append-only, and [P14 §2.4]'s identity is why that is enough.** A chat's
 * turn id is its account, family, parent and content, so every message the
 * chat already had is a turn already here and is skipped; every new one is a
 * turn whose parent is here, and is appended; an edited message is a new node
 * beside the old one, and a new branch chat a new ref. Nothing already in the
 * session is rewritten — the tree only grows, which is the only way
 * [07](../../../../docs/design/07-branching.md) lets it change.
 *
 * Under the session's lock, in the document's order (parents first: it is id
 * order, and a chat's ids put every parent before its children), and then the
 * merges, each by §2.7's own rule:
 *
 * 1. **Turns** — appended; a turn the source put here before
 *    ({@link SyncRecord.turns}) that the disk does not show is one deleted
 *    here, and so are its descendants, since a turn whose parent is not here
 *    is not appended. *A deletion here stays.* (The index's row for the
 *    tombstone says the same, and is asked too, for a session whose record
 *    predates the list — but only until a rebuild drops that row.)
 * 2. **Mutes** — {@link muteEffects}: a mute the source changed, onto each
 *    new turn whose path has not had it from the source yet.
 * 3. **Refs** — a ref the source had is moved to where its chat now ends; a
 *    new chat's is added; one deleted here stays deleted; refs made here are
 *    not the source's and are not touched.
 * 4. **Hidden flags, settings** — three-way against {@link SyncRecord}: taken
 *    from the source where the source changed and this session did not. For
 *    imported turns only; a turn played here has no flag in the source.
 * 5. **The cast** — three-way too: a member new to the document's cast since
 *    the last import is added, as the first import would have added them; one
 *    removed here is not the source's to put back.
 * 6. **The head** — follows the source only if nobody played on here
 *    ({@link playedOnHere}); the state at it is then derived again through
 *    the snapshot cache, so the head cache agrees with the replay by the same
 *    construction `moveHead` uses, and `reconcileHandEdits` finds nothing to
 *    record.
 *
 * ***What it does not do.*** Deletions in the source are counted and not
 * applied (`notInSource`). Turns played here are never compared with the
 * source: their ids come from the runner, not the trie, so they cannot collide
 * and are not candidates. Nothing is written back.
 */
async function extendSession(
  context: ImportContext,
  handle: string,
  sessionId: string,
  read: SessionExport,
  turns: readonly Turn[],
  originalFilename: string | null,
): Promise<SessionImport> {
  const { sessions } = context;
  return withSessionLock(sessionId, async () => {
    const session = await readSession(sessions, handle, sessionId);
    if (session === null) return { ok: false, reason: 'already-here' };
    const source = originalFilename ?? session.origin?.originalFilename ?? null;
    const held = await readTurns(sessions, handle, sessionId);
    const record =
      (await readSyncRecord(sessions, handle, sessionId)) ??
      recordFrom(session, held, read, source ?? '');
    const playedOn = playedOnHere(sessions, session, held, record);
    const was = read.session.id;

    // -- 1. Turns ------------------------------------------------------------

    const holderOf = (turnId: string): string | null =>
      sessionHoldingTurns(sessions.index, [turnId]);
    const hadBefore = new Set(record.turns);
    const fresh: Turn[] = [];
    for (const turn of turns) {
      if (held.has(turn.id)) continue;
      // Put here by the source and not on disk: deleted here, and deleted it stays.
      if (hadBefore.has(turn.id)) continue;
      const holder = holderOf(turn.id);
      // Held by another session: this is a copy of something else, which is
      // what `already-here` refuses, and nothing is written.
      if (holder !== null && holder !== sessionId) return { ok: false, reason: 'already-here' };
      // Held here and not on disk, for a record that predates its turn list.
      if (holder === sessionId) continue;
      fresh.push(turn);
    }

    const mutedNow = mutedIn(turns);
    const appendedIds = new Set<string>();
    const fromSource = (turnId: string): boolean =>
      hadBefore.has(turnId) || appendedIds.has(turnId);

    const all = new Map(held);
    const appended: Turn[] = [];
    let mutesWritten = 0;
    for (const turn of fresh) {
      const parent = turn.parentTurnId;
      if (parent !== null && !all.has(parent)) continue;
      let effects = turn.effects;
      /**
       * ***A graft*** — a new turn hanging off one already here, which is
       * where the source's new state begins on this path. Each mute the
       * source's word on this path has not caught up with goes on it
       * ({@link pendingMutes}), measured against the state at its parent, so a
       * member already as the source wants them gets no effect.
       */
      if (parent !== null && held.has(parent)) {
        const path = walkPath(all, parent);
        const changes = pendingMutes(path, mutedNow, fromSource);
        if (changes.length > 0) {
          const extra = muteEffects(turn.id, replayChannels(path), changes);
          mutesWritten += extra.length;
          effects = [...effects, ...extra];
        }
      }
      const written: Turn = { ...foreignise(turn, was), sessionId, effects };
      await appendTurnOnly(sessions, handle, sessionId, written);
      all.set(written.id, written);
      appended.push(written);
      appendedIds.add(written.id);
    }

    // -- What grew, and what the source no longer has -------------------------

    /**
     * ***Every round of the document's that grew out of one held here***, not
     * only this sync's: an old round whose grown sibling arrived at an earlier
     * sync is still that, and calling it *not in the source* at every later
     * sync would say something different each time about a turn that has not
     * changed. `roundsGrown` still counts only the ones this sync appended.
     */
    const heldByParent = new Map<string | null, Turn[]>();
    for (const turn of held.values()) {
      const siblings = heldByParent.get(turn.parentTurnId) ?? [];
      siblings.push(turn);
      heldByParent.set(turn.parentTurnId, siblings);
    }
    const grown = new Set<string>();
    const grownNow = new Set<string>();
    for (const turn of turns) {
      const here = all.get(turn.id);
      if (here === undefined) continue;
      for (const other of heldByParent.get(here.parentTurnId) ?? []) {
        if (!grewInto(other, here)) continue;
        grown.add(other.id);
        if (appendedIds.has(here.id)) grownNow.add(other.id);
      }
    }
    const inDocument = new Set(turnIdsOf(turns));
    let notInSource = 0;
    for (const turn of held.values()) {
      if (turn.foreign !== undefined && !inDocument.has(turn.id) && !grown.has(turn.id)) {
        notInSource += 1;
      }
    }

    // -- 3. Refs -------------------------------------------------------------

    const known = new Set(record.refs);
    let refsAdded = 0;
    let refsMoved = 0;
    let branchRefs = [...(session.branchRefs ?? [])];
    for (const ref of refsIn(read.session)) {
      if (!all.has(ref.headTurnId)) continue;
      const here = branchRefs.find((one) => one.id === ref.id);
      if (here !== undefined) {
        if (here.headTurnId !== ref.headTurnId) {
          refsMoved += 1;
          branchRefs = branchRefs.map((one) =>
            one.id === ref.id ? { ...one, headTurnId: ref.headTurnId } : one,
          );
        }
      } else if (!known.has(ref.id)) {
        refsAdded += 1;
        branchRefs.push({ id: ref.id, name: ref.name, headTurnId: ref.headTurnId });
      }
    }

    // -- 4. Hidden flags and settings -----------------------------------------

    const sourceHidden = hiddenIn(read.session);
    const flags = new Map(Object.entries(session.hidden ?? {}));
    let hiddenChanged = 0;
    for (const turnId of inDocument) {
      if (!all.has(turnId)) continue;
      const now = sourceHidden[turnId];
      const then = record.hidden[turnId];
      const here = flags.get(turnId);
      if (!same(here, then) || same(here, now)) continue;
      hiddenChanged += 1;
      if (now === undefined) flags.delete(turnId);
      else flags.set(turnId, now);
    }
    const hidden = Object.fromEntries(flags);

    const settings: Record<string, unknown> = {};
    let settingsChanged = 0;
    const current = session as unknown as Record<string, unknown>;
    for (const field of SETTINGS) {
      const now = read.session[field];
      const here = current[field];
      if (!same(here, record.settings[field]) || same(here, now)) continue;
      settingsChanged += 1;
      settings[field] = now;
    }

    // -- 5. The cast -----------------------------------------------------------

    const cast = session.cast ?? { persona: null, actors: [] };
    const actors = [...cast.actors];
    const castBefore = new Set(record.cast);
    let castAdded = 0;
    for (const actor of castIn(read.session)) {
      if (castBefore.has(actor) || actors.includes(actor) || actors.length >= CAST_CEILING) {
        continue;
      }
      actors.push(actor);
      castAdded += 1;
    }

    // -- 6. The head -------------------------------------------------------------

    const sourceHead =
      typeof read.session.headTurnId === 'string' && all.has(read.session.headTurnId)
        ? read.session.headTurnId
        : null;
    /**
     * ***A mute waits until it reaches where the source now is*** — a graft on
     * a swipe or a branch the head never walks carries the change there, and
     * the source's current path still lacks it. Counted here, off that path,
     * so the row says so; the next graft onto the path is where it lands,
     * since {@link pendingMutes} reads each path's own history.
     */
    let mutesWaiting = 0;
    if (sourceHead !== null) {
      const path = walkPath(all, sourceHead);
      const atHead = replayChannels(path);
      for (const change of pendingMutes(path, mutedNow, fromSource)) {
        const mutedHere = atHead[channelKey(SE_PRESENCE, change.actor)]?.value === false;
        if (mutedHere !== change.muted) mutesWaiting += 1;
      }
    }
    const remembered = rememberedFrom(read.session);
    let headTurnId = session.headTurnId;
    let channels = session.channels;
    let lastSelectedChild = { ...(session.lastSelectedChild ?? {}) };
    if (!playedOn && sourceHead !== null) {
      headTurnId = sourceHead;
      for (const [parent, child] of Object.entries(remembered)) {
        if (all.has(parent) && all.has(child)) lastSelectedChild[parent] = child;
      }
      if (headTurnId !== session.headTurnId) {
        channels = await reconstructAlong(sessions, handle, sessionId, walkPath(all, headTurnId));
      }
    } else {
      lastSelectedChild = keepThePerson(lastSelectedChild, remembered, all, session.headTurnId);
    }

    // -- Written, if anything changed ---------------------------------------------

    const next: SessionFile = {
      ...session,
      ...(settings as Partial<SessionFile>),
      headTurnId,
      channels,
      lastSelectedChild,
      branchRefs,
      cast: { ...cast, actors },
      ...(Object.keys(hidden).length === 0 ? {} : { hidden }),
    };
    if (Object.keys(hidden).length === 0) delete next.hidden;
    const unchanged = appended.length === 0 && same(visible(next), visible(session));
    /**
     * *The source is stamped as well*, for a session imported before
     * [P14.10a] and found by its turns: from now on the index finds it by its
     * source. That alone is not a change a person can see, so it moves neither
     * the session's clock nor the ledger's `unchanged`.
     */
    const origin = {
      ...(session.origin ?? {
        source: 'import' as const,
        creator: null,
        version: null,
        license: null,
        createdAt: session.createdAt,
        updatedAt: session.updatedAt,
      }),
      originalFilename: source,
    };
    if (!unchanged || !same(origin, session.origin)) {
      const at = new Date().toISOString();
      const written: SessionFile = {
        ...next,
        updatedAt: unchanged ? session.updatedAt : at,
        origin: unchanged ? origin : { ...origin, updatedAt: at },
      };
      await writeJsonAtomic(sessionFilePath(sessions.layout, handle, sessionId), written);
      indexWrittenSession(sessions, handle, written);
    }

    if (source !== null) {
      await writeSyncRecord(sessions, handle, sessionId, {
        ...recordOf(read.session, turns, source),
        // Kept where it was when the person has played on: the session stays
        // theirs until they are back where the source left it.
        importedHead: playedOn ? record.importedHead : headTurnId,
        refs: [...new Set([...record.refs, ...refsIn(read.session).map((ref) => ref.id)])],
        turns: [...new Set([...record.turns, ...appendedIds])],
      });
    }

    return {
      ok: true,
      extended: true,
      sessionId,
      appended: appended.length,
      sync: {
        unchanged,
        playedOn,
        headMoved: headTurnId !== session.headTurnId,
        refsAdded,
        refsMoved,
        roundsGrown: grownNow.size,
        notInSource,
        hiddenChanged,
        settingsChanged,
        mutesChanged: mutesWritten,
        mutesWaiting,
        castAdded,
      },
    };
  });
}

/**
 * The most actors a cast may name — `chat/build.ts`'s `CAST_CEILING`, the cast
 * route's own bound, which a sync adding speakers must not exceed either.
 */
const CAST_CEILING = 32;

/** What a person sees of a session, for *did anything change*: not its clock or its origin. */
function visible(session: SessionFile): unknown {
  const { updatedAt, origin, ...rest } = session;
  void updatedAt;
  void origin;
  return rest;
}

/** JSON equality, for values that are JSON: absent and `undefined` alike. */
function same(one: unknown, two: unknown): boolean {
  return JSON.stringify(one) === JSON.stringify(two);
}

function rememberedFrom(session: SessionExport['session']): Record<string, string> {
  const map = session['lastSelectedChild'];
  if (typeof map !== 'object' || map === null) return {};
  return Object.fromEntries(
    Object.entries(map as Record<string, unknown>).filter(
      (entry): entry is [string, string] => typeof entry[1] === 'string',
    ),
  );
}

/**
 * ***`lastSelectedChild` for a session somebody played on*** — the source's
 * choices where this session has made none, and never on the person's own
 * path.
 *
 * The map answers *forward* at a fork (`resumeFrom`, in the store), so
 * an entry for a node nobody here chose at is the source's fork, remembered
 * as the source showed it. On the head's path it is different: a node there
 * that just gained a sibling from the source would stop *forward* short of
 * where the person is, so it is pinned to the path they are on.
 */
function keepThePerson(
  mine: Record<string, string>,
  theirs: Readonly<Record<string, string>>,
  all: Map<string, Turn>,
  head: string | null,
): Record<string, string> {
  const next = { ...mine };
  const path = walkPath(all, head);
  const onPath = new Set(path.map((turn) => turn.id));
  for (const [parent, child] of Object.entries(theirs)) {
    if (Object.hasOwn(next, parent) || onPath.has(parent)) continue;
    if (all.has(parent) && all.has(child)) next[parent] = child;
  }
  const children = new Map<string, number>();
  for (const turn of all.values()) {
    if (turn.parentTurnId !== null) {
      children.set(turn.parentTurnId, (children.get(turn.parentTurnId) ?? 0) + 1);
    }
  }
  for (const [at, turn] of path.entries()) {
    const parent = path[at - 1];
    if (parent === undefined || Object.hasOwn(next, parent.id)) continue;
    if ((children.get(parent.id) ?? 0) > 1) next[parent.id] = turn.id;
  }
  return next;
}

/**
 * ***A round that grew*** — [P14 §2.7]'s open case, decided at [P14.10a]: the
 * old round is `before` and `after` is the round as it now stands, when the two
 * share a parent and a player's line and `before`'s messages are a strict
 * prefix of `after`'s. Only imported turns are candidates; a turn played here
 * is never compared with the source.
 */
function grewInto(before: Turn, after: Turn): boolean {
  if (before.foreign === undefined || before.id === after.id) return false;
  if ((before.input?.text ?? null) !== (after.input?.text ?? null)) return false;
  const was = before.output?.messages ?? [];
  const is = after.output?.messages ?? [];
  if (was.length >= is.length) return false;
  return was.every((message, at) => {
    const now: OutputMessage | undefined = is[at];
    return (
      now?.text === message.text && (now.speaker?.id ?? null) === (message.speaker?.id ?? null)
    );
  });
}

interface MuteChange {
  actor: string;
  /** The source's new word: muted, or back in the room. */
  muted: boolean;
}

/**
 * ***The mutes the source's word on a path has not caught up with*** — each
 * actor whose presence the source now gives ({@link mutedIn}, over the
 * document) differs from the last presence effect on this path that a turn
 * *from the source* carries: the opening turn's, as the first import wrote it,
 * or a graft's, as a sync did.
 *
 * *Per path, not per family*, because a group's mutes are group-wide and its
 * chats are branches: a change carried by one graft is not on a sibling
 * branch, and a family-wide *delivered* would leave that branch on the old
 * state when it grows. And *only the source's own turns*, so a mute made here
 * — a hand edit, a turn played — is not read as the source's word, and a
 * change the source has not made since does not undo it.
 */
function pendingMutes(
  path: readonly Turn[],
  mutedNow: ReadonlySet<string>,
  fromSource: (turnId: string) => boolean,
): MuteChange[] {
  const said = new Map<string, boolean>();
  for (const turn of path) {
    if (!fromSource(turn.id)) continue;
    for (const effect of turn.effects) {
      if (effect.channelId !== SE_PRESENCE || !effect.scopeKey || !effect.applied) continue;
      said.set(effect.scopeKey, effect.after === false);
    }
  }
  const actors = new Set([...mutedNow, ...said.keys()]);
  const changes: MuteChange[] = [];
  for (const actor of actors) {
    const muted = mutedNow.has(actor);
    if ((said.get(actor) ?? false) !== muted) changes.push({ actor, muted });
  }
  return changes;
}

/**
 * ***A mute the source changed, as effects on a graft*** — [P14 §2.6]'s
 * presence, carried by a sync the way the first import carried it
 * (`chat/build.ts`'s `mutedEffects`, whose reasons hold here unchanged:
 * `proposedBy: engine`, applied, built rather than accepted).
 *
 * *Only where the state at the graft's parent differs from what the source
 * now says*, so a member muted here already, or unmuted here already, gets no
 * effect restating it. And only a change the source has not yet said on this
 * path ({@link pendingMutes}): a mute made here on the person's own path is
 * not the source's to undo, and a sync that wrote every difference would undo
 * it on every new line.
 */
function muteEffects(
  turnId: string,
  atParent: Readonly<Record<string, { value: unknown }>>,
  changes: readonly MuteChange[],
): ChannelEffect[] {
  const effects: ChannelEffect[] = [];
  for (const change of changes) {
    const held = atParent[channelKey(SE_PRESENCE, change.actor)]?.value;
    const mutedHere = held === false;
    if (mutedHere === change.muted) continue;
    effects.push({
      id: uuidv7(),
      turnId,
      channelId: SE_PRESENCE,
      scopeKey: change.actor,
      op: { type: 'set', path: '/' },
      before: held ?? null,
      after: !change.muted,
      proposedBy: { kind: 'engine' },
      applied: true,
      rejectedReason: null,
      supersedes: null,
      channelVersion: PRESENCE_CHANNEL.version,
      scope: 'session',
    });
  }
  return effects;
}
