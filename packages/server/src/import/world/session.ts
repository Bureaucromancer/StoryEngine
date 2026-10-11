// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import {
  type ImportItemReport,
  type ImportNote,
  type SessionExport,
  uuidv7Timestamp,
  WORLD_FILE_SESSION_EXPORT,
} from '@storyengine/shared';

import { sessionHolding } from '../../index-db/sessions.js';
import { storeAttachment } from '../../sessions/attachments.js';
import { importSession, landNewTurns, readSessionExport } from '../../sessions/import.js';
import { producedTurnId } from '../../sessions/producer.js';
import { readSession, readTurns, scopeOf, type SessionContext } from '../../sessions/store.js';
import type { FileSource } from '../source.js';
import { idsNamedIn, rewriteIds } from './rewrite.js';

/**
 * ***A World file's session, landed*** —
 * [16 §5.1](../../../../../docs/design/16-publish.md),
 * [16 §5.2](../../../../../docs/design/16-publish.md),
 * [P16.3f](../../../../../docs/design/workplan/35-p16-world.md).
 *
 * **What arrives**: `sessions/<id>/session-export.json` — P11.10's export,
 * unchanged but for the bindings and associations the writer took out — with
 * the pictures its renditions name under `assets/` and the pictures its moves
 * carried under `attachments/` (the owner's answer of 2026-10-10: a session's
 * pictures travel). It lands through the one session reader there is
 * (`sessions/import.ts`), as a **new session** of this account's, and the
 * World names it once it has ([16 §5.1]'s *a World lands naming what
 * landed*).
 *
 * ***Two kinds of id to follow, and they are followed differently.***
 *
 * - **The objects it links** — its cast, its lore, its treatment, its hook
 *   pool's actors, and the actor-scoped channels its state is keyed by — follow
 *   the reader's plan exactly as every object in the file does: `rewriteIds`
 *   over the document with the plan's map, in values **and in keys**
 *   (`se.status#<actor>`, `prompts.cards`), because a session landed with the
 *   old keys records, on its first open, *hand edits* deleting the re-minted
 *   actors' state (the fact check's one *false*, 2026-10-10).
 * - **Its turns** are keyed install-wide (`turn.turn_id`, the plan's fact 2),
 *   and `importSession` keeps a document's turn ids and refuses a document
 *   whose turns are held — so the turns are **re-keyed only when somebody else
 *   holds them** ({@link rekeyTurns}): another account on this install, or a
 *   turn row with no session row, which is a claim all the same
 *   (`sessionHolding`). An install that holds none keeps the file's ids,
 *   P11.10's own default, so a session sent between two installs arrives
 *   under the ids it left with.
 *
 * ***Whose it already is***, asked before anything is written, in this
 * order:
 *
 * | The turns are held by | Then |
 * |---|---|
 * | this account, under the file's ids — the sender reading their own file back | that session |
 * | this account, under the ids this account derives — an earlier arrival of the file | that session |
 * | none of this account's, but the arrival key finds a session of its own | that session |
 * | somebody else, or a row with no session | a new session, re-keyed |
 * | nobody | a new session, under the file's ids |
 *
 * *The derived ids are asked even when nobody holds the file's* (the fact
 * check's third consequence): the sender trashing or deleting their session
 * frees the file's ids, and an import that then asked only them would land a
 * second copy beside the one this account already re-keyed. And the arrival
 * is **stamped** — `originalFilename: 'seworld:session/<id in the file>'`,
 * which `importSession` finds this account's earlier arrival by
 * (`sessionByOrigin`, per owner) before it writes anything, and refuses as
 * `already-here` naming it — so a road the turns cannot answer still finds
 * the session it made.
 *
 * ***The session found is asked how it is keyed — on disk*** (2026-10-11, the
 * P16.3f review). The lookups above ask the **index**, which can disagree with
 * the session: the sender restoring a trashed session takes the index's rows
 * for its turn ids back (plan risk 10), so an earlier arrival that kept the
 * file's ids reads as unheld. ~~The arrival key's session was handed whichever
 * document the turn lookups had chosen~~ — the re-keyed one, there, and every
 * turn of it was appended beside the ones the session holds under the file's
 * ids: the whole story twice, in one session, with a row saying it grew. So
 * whichever road found the session, **its own turns decide**: the file's ids
 * where it holds any of them, else the ids this account derives where it holds
 * any of those — and holding neither, it is not this session at all
 * (`import.world.sessionUnrelated`, nothing written; `landNewTurns` refuses
 * such a document on its own as well).
 *
 * ***Already here only when every turn is***, the `turnsNotHeld` precedent
 * the chat doors set (the fact check's second consequence) — ~~asked of the
 * index, install-wide~~ *asked of that session's own turns* (the review). A
 * session the sender played on and published again arrives with turns this
 * account does not have, and those land, appended by `landNewTurns`, which
 * never rewrites a turn that is here. ***Pictures as well as turns*** (the
 * review): a sender who illustrated a turn the recipient already has, and
 * published again, sends a picture with no new turn around it — so the session
 * found is always handed to `landNewTurns`, which appends nothing when nothing
 * is new and adds the pictures it lacks. *Nothing written* is `unchanged`;
 * pictures alone are `import.world.sessionPicturesAdded`; new turns are
 * `import.world.sessionGrew`. That session is the one the World names.
 *
 * ***A session already here keeps the objects it plays*** (2026-10-11, the
 * review). Under *keep-both*, an object here that differs from the file's
 * lands as a copy, and the plan's map points the file's references at the
 * copy — right for a new session, which is the file's story, and wrong for one
 * already here, whose turns name the arrival it already plays: the appended
 * turns would name the copy, `resolveCast` unions the two, and the next turn
 * is assembled with two Veras. So for a session already here, each file id
 * goes to whichever of this account's arrivals of that object the session
 * already names ({@link asPlayed}) — the plan's own id when it names that, or
 * when it names none.
 *
 * ***Ids inside strings*** (2026-10-11, the review). `rewriteIds` renames a
 * string that *is* an id, and a key; but a mode also builds strings *out of*
 * channel keys — the Scene mode's locks and hidden fields are field paths,
 * `se.track.character#<actor>/mood` — and a draw names an actor in its purpose
 * (`talkativeness:<actor>`). Left as they were, a re-minted actor's lock stops
 * applying and a hidden field shows, with nothing to say so, since the effects
 * that set them carry the same strings and replay agrees. So the document also
 * goes through {@link followIntoStrings}: a string shaped like a channel key,
 * or a path under one, has its scope renamed; a draw has the tokens of its
 * key, site and purpose renamed. Both shapes are matched whole, so a sentence
 * that quotes an id is still left as it was written.
 *
 * ***Housekeeping stays home*** (2026-10-11, the review): `archivedAt` is
 * dropped with the bindings and associations. An archive is the sender
 * putting a session out of their own way, and one that arrived archived would
 * land hidden from the recipient's list while the review said it landed.
 *
 * ***Quietly*** — `warm: false` (see `SessionImportOptions.warm`): a session
 * somebody sent is not warmed on the recipient's connections; its summary
 * chain is derived on the first turn somebody plays.
 *
 * **One session's failure is its own row**: a document that does not read, a
 * tree with a hole in it, a picture that cannot be written. Never the sweep's,
 * and never the World's — a session that did not land is simply not named.
 */

/** The arrival key a World file stamps on a session it lands — per account, per session in the file. */
export function worldSessionOrigin(fileSessionId: string): string {
  return `seworld:session/${fileSessionId}`;
}

/**
 * ***The ids this account would give a file's turns*** — one map, old id to
 * new, the same on every import of the same file by the same account.
 *
 * `producedTurnId` is the producer's derivation (`sessions/producer.ts`), for
 * its reasons: **the handle is in it**, so two accounts re-keying one file
 * get different ids and neither is refused for the other's; **the origin is
 * the session's arrival key**, so two sessions whose turns happened to share
 * an id cannot meet; and **the result is a v8 uuid whose first 48 bits are a
 * millisecond**, so the turns sort as they were played.
 *
 * *Which millisecond* — the fact check's correction: the plan took it from
 * the old id with `uuidv7Timestamp`, which answers null for anything but a
 * v7, and **every turn a chat or Aventuras import produced is a v8**, as is
 * every turn re-keyed once already. So the old id's own time when it carries
 * one, else the turn's `createdAt`, else zero — the order is cosmetic and the
 * hash is the identity, so a turn with neither still gets a stable id.
 */
export function derivedTurnIds(
  turns: readonly unknown[],
  handle: string,
  origin: string,
): Map<string, string> {
  const ids = new Map<string, string>();
  for (const turn of turns) {
    if (typeof turn !== 'object' || turn === null) continue;
    const { id, createdAt } = turn as { id?: unknown; createdAt?: unknown };
    if (typeof id !== 'string' || ids.has(id)) continue;
    const at = uuidv7Timestamp(id) ?? (typeof createdAt === 'string' ? Date.parse(createdAt) : 0);
    ids.set(id, producedTurnId({ handle, origin, sourceId: id, at: Number.isNaN(at) ? 0 : at }));
  }
  return ids;
}

/**
 * ***A session export with every turn re-keyed for this account*** — the
 * plan's contract, with the fact check's two corrections (`createdAt` when
 * the id is not v7, and keys as well as values).
 *
 * 1. **Each turn without a `foreign` gets one first** — `{ source: the
 *    file's session id, id: its id in the file }` — because `importSession`
 *    marks a turn foreign with the id it *arrives* under, which after this
 *    would be the new one, and a turn's provenance is the id it had where it
 *    was made. A turn that already carries one keeps it: the first place a
 *    story came from is the one that matters (`foreignise`'s rule).
 * 2. **Then one deep rewrite** — `rewriteIds` with the turn map, `foreign`
 *   skipped — which reaches every place a turn id is: each turn's `id` and
 *    `parentTurnId`, the head, branch refs' heads, every effect's `turnId`,
 *    renditions' `turnId`, and the **keys** of the maps keyed by turn —
 *    `hidden`, `renditionSelection`, `lastSelectedChild` (whose values are
 *    turn ids too). Exact matches only: a rendition's id is `<turnId>.<n>`
 *    and keeps the old turn id as a substring, harmlessly — it names a
 *    record, never a turn — and a rendition's own `foreign` names the
 *    sender's session and record, which is what it is for.
 *
 * Pure: the document handed in is not changed.
 */
export function rekeyTurns(doc: SessionExport, handle: string, origin: string): SessionExport {
  const turns = Array.isArray(doc.turns) ? (doc.turns as unknown[]) : [];
  const ids = derivedTurnIds(turns, handle, origin);
  const source = typeof doc.session.id === 'string' ? doc.session.id : origin;
  const marked = {
    ...doc,
    turns: turns.map((turn) => {
      if (typeof turn !== 'object' || turn === null) return turn;
      const { id, foreign } = turn as { id?: unknown; foreign?: unknown };
      if (typeof id !== 'string' || foreign !== undefined) return turn;
      return { ...turn, foreign: { source, id } };
    }),
  } as SessionExport;
  return rewriteIds(marked, ids, FOREIGN);
}

const FOREIGN: ReadonlySet<string> = new Set(['foreign']);

export interface WorldSessionContext {
  sessions: SessionContext;
  /** The file, for the export and its pictures. */
  files: FileSource;
  handle: string;
}

/** One session of the file, as the reader names it. */
export interface WorldSessionEntry {
  /** Its id in the file — the sender's session id, and its folder's name. */
  fileSessionId: string;
  /** `sessions/<id>` — a member-name prefix. */
  folder: string;
  name: string;
}

/**
 * Lands one session — see the module comment. `ids` is the reader's plan, file
 * id to landed id, every object of the file in it. `arrivals` is, per file id,
 * every object of this account's that is already an arrival of that one — its
 * own row under the file's id, and every row under its arrival key, keep-both's
 * copies included — read before the plan wrote anything ({@link asPlayed}).
 * `landed` is what the World names it by, or null when there is nothing here
 * for it to name.
 */
export async function landWorldSession(
  context: WorldSessionContext,
  entry: WorldSessionEntry,
  ids: ReadonlyMap<string, string>,
  arrivals: ReadonlyMap<string, readonly string[]> = new Map(),
): Promise<{ row: ImportItemReport; landed: { id: string; name: string } | null }> {
  const source = `${entry.folder}/${WORLD_FILE_SESSION_EXPORT}`;
  const name = entry.name;
  const refused = (reason: string): { row: ImportItemReport; landed: null } => ({
    row: {
      source,
      disposition: 'unrecognised',
      notes: [
        {
          key: 'import.world.sessionRefused',
          params: { session: name, reason },
          level: 'warn',
        },
      ],
    },
    landed: null,
  });

  const bytes = await context.files.read(source);
  if (bytes === null) return refused('unreadable');
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return refused('unreadable');
  }
  const read = readSessionExport(parsed);
  if ('reason' in read) return refused(read.reason);
  const base = withoutBindings(read);

  // ── Whose it already is: the turns in the index, then the arrival key ──
  const { sessions, handle } = context;
  const me = scopeOf(sessions, handle);
  const origin = worldSessionOrigin(entry.fileSessionId);
  const fileIds = turnIdsIn(base);
  const derived = [...derivedTurnIds(base.turns, handle, origin).values()];
  const holder = sessionHolding(sessions.index, fileIds);
  const mine =
    holder !== null && holder.owner === me ? null : sessionHolding(sessions.index, derived);
  let target: string | null =
    holder !== null && holder.owner === me
      ? holder.sessionId
      : mine !== null && mine.owner === me
        ? mine.sessionId
        : null;

  const pixels = async (path: string): Promise<Uint8Array | null> =>
    context.files.read(`${entry.folder}/assets/${path}`);

  if (target === null) {
    // The objects it links, followed as the plan landed them; its turns
    // re-keyed only when somebody else, or a row with no session, holds them.
    const followed = following(base, ids);
    const chosen = holder !== null ? rekeyTurns(followed, handle, origin) : followed;
    const result = await importSession({ sessions }, handle, chosen, {
      originalFilename: origin,
      pixels,
      warm: false,
    });
    if (result.ok && result.extended !== true) {
      const notes: ImportNote[] = [
        {
          key: 'import.world.sessionLanded',
          params: { session: name, turns: result.turns, pictures: result.renditions },
          level: 'info',
        },
      ];
      const missing =
        result.missing.cast.length + result.missing.lore.length + result.missing.treatment.length;
      if (missing > 0) {
        notes.push({
          key: 'import.world.sessionLinksMissing',
          params: { session: name, count: missing },
          level: 'warn',
        });
      }
      notes.push(...(await carryAttachments(context, entry, result.sessionId)));
      return {
        row: { source, disposition: 'converted', objectId: result.sessionId, notes },
        landed: { id: result.sessionId, name },
      };
    }
    if (!result.ok && result.reason === 'already-here' && 'prior' in result) {
      // The arrival key, which `importSession` asks before it writes anything:
      // this account's earlier arrival, where the turn lookups found none.
      target = result.prior.sessionId;
    } else {
      return refused(result.ok ? 'already-here' : result.reason);
    }
  }

  // ── Already here: keyed as its own turns are, playing the objects it plays ──
  const here = await readSession(sessions, handle, target);
  if (here === null) return refused('already-here');
  const held = await readTurns(sessions, handle, target);
  const keyedAsFiled = fileIds.some((id) => held.has(id));
  if (!keyedAsFiled && !derived.some((id) => held.has(id))) {
    return {
      row: {
        source,
        disposition: 'skipped',
        objectId: target,
        notes: [
          {
            key: 'import.world.sessionUnrelated',
            params: { session: name, here: here.name },
            level: 'warn',
          },
        ],
      },
      landed: null,
    };
  }
  const followed = following(base, asPlayed(ids, arrivals, [here, ...held.values()]));
  const chosen = keyedAsFiled ? followed : rekeyTurns(followed, handle, origin);
  const grown = await landNewTurns({ sessions }, handle, target, chosen, { pixels, warm: false });
  if (!grown.ok) return refused(grown.reason);
  const landed = { id: target, name: here.name };
  if (grown.appended === 0 && grown.renditions === 0) {
    return {
      row: {
        source,
        disposition: 'unchanged',
        objectId: target,
        notes: [
          { key: 'import.world.sessionAlreadyHere', params: { session: name }, level: 'info' },
        ],
      },
      landed,
    };
  }
  const notes: ImportNote[] =
    grown.appended > 0
      ? [
          {
            key: 'import.world.sessionGrew',
            params: { session: name, turns: grown.appended },
            level: 'info',
          },
          // A picture a move carried belongs to a new move: none is new without one.
          ...(await carryAttachments(context, entry, target)),
        ]
      : [
          {
            key: 'import.world.sessionPicturesAdded',
            params: { session: name, pictures: grown.renditions },
            level: 'info',
          },
        ];
  return { row: { source, disposition: 'converted', objectId: target, notes }, landed };
}

/**
 * ***The objects a session links, followed*** — `rewriteIds` with the map, in
 * values and keys, `foreign` left as it is; then the ids inside the strings a
 * session builds out of them ({@link followIntoStrings}).
 */
function following(doc: SessionExport, ids: ReadonlyMap<string, string>): SessionExport {
  return followIntoStrings(rewriteIds(doc, ids, FOREIGN), ids);
}

/**
 * ***The map for a session already here*** — the module comment's *keeps the
 * objects it plays*. Each file id goes to the plan's id when the session
 * names that; else to whichever of this account's other arrivals of the same
 * object it names (the one an earlier import landed, which *keep-both* has
 * since copied); else, naming none of them, to the plan's id. *Names* is
 * `idsNamedIn`'s reading — a whole value, a whole key, a channel key's scope —
 * over the session file and every turn it holds.
 */
export function asPlayed(
  ids: ReadonlyMap<string, string>,
  arrivals: ReadonlyMap<string, readonly string[]>,
  held: readonly unknown[],
): Map<string, string> {
  const candidates = new Set<string>();
  for (const [fileId, landed] of ids) {
    candidates.add(landed);
    for (const one of arrivals.get(fileId) ?? []) candidates.add(one);
  }
  const named = idsNamedIn(held, candidates);
  const out = new Map<string, string>();
  for (const [fileId, landed] of ids) {
    const played = named.has(landed)
      ? landed
      : (arrivals.get(fileId) ?? []).find((one) => named.has(one));
    out.set(fileId, played ?? landed);
  }
  return out;
}

/**
 * ***Ids inside the strings a session builds out of them*** — the module
 * comment's *ids inside strings*, after `rewriteIds` has renamed every whole
 * one. Two shapes, each matched whole, so prose that quotes an id is untouched:
 *
 * - **a channel key, or a field path under one** — `<channel id>#<scope>`,
 *   then nothing or `/<pointer>` (the Scene mode's `se.track.locks` and
 *   `se.track.hidden`, `modes/scene/src/tracking.ts`'s `trackerPath`): the
 *   scope is renamed when it is a mapped id. The channel id has to be dotted,
 *   as every channel id is, which keeps a `#` in a sentence out of it.
 * - **a draw** (`Turn.tape`, `rng.ts`'s `Draw`: a `key`, a `site`, a
 *   `purpose`, an `index`) — its key, site and purpose are split at `:`, `#`
 *   and `/`, and a token that is a mapped id is renamed, so
 *   `talkativeness:<actor>` replays on the recipient's copy rather than
 *   drawing afresh.
 *
 * Applied alike to channel state and to effects' `before` and `after`, so a
 * replay of the turns agrees with the snapshot and the first open records no
 * hand edit. `foreign` is skipped, as everywhere. Iterative, for
 * `rewriteIds`' reason: the document is somebody else's file.
 */
export function followIntoStrings<T>(value: T, ids: ReadonlyMap<string, string>): T {
  const renames = new Map([...ids].filter(([from, to]) => from !== to));
  if (renames.size === 0) return value;
  let result: unknown;
  const stack: { from: unknown; into: (copy: unknown) => void }[] = [
    { from: value, into: (copy) => (result = copy) },
  ];
  for (let next = stack.pop(); next !== undefined; next = stack.pop()) {
    const { from, into } = next;
    if (typeof from === 'string') {
      into(pathRenamed(from, renames));
      continue;
    }
    if (Array.isArray(from)) {
      const out: unknown[] = new Array<unknown>(from.length);
      into(out);
      from.forEach((one, at) => stack.push({ from: one, into: (copy) => (out[at] = copy) }));
      continue;
    }
    if (typeof from !== 'object' || from === null) {
      into(from);
      continue;
    }
    const record = from as Record<string, unknown>;
    const draw = isDraw(record);
    const out: Record<string, unknown> = {};
    into(out);
    for (const [key, inner] of Object.entries(record)) {
      // Defined, never assigned — `rewrite.ts`'s reason: an own `__proto__`.
      const set = (copy: unknown): void => {
        Object.defineProperty(out, key, {
          value: copy,
          enumerable: true,
          writable: true,
          configurable: true,
        });
      };
      set(undefined);
      if (key === 'foreign') set(inner);
      else if (draw && DRAW_NAMES.has(key) && typeof inner === 'string') {
        set(tokensRenamed(inner, renames));
      } else stack.push({ from: inner, into: set });
    }
  }
  return result as T;
}

/** `<dotted channel id>#<scope>`, then nothing or a `/` pointer — a channel key, or a field path under one. */
const CHANNEL_PATH = /^([A-Za-z][\w-]*(?:\.[\w-]+)+)#([^#/\s]+)(\/[^]*)?$/;

function pathRenamed(value: string, ids: ReadonlyMap<string, string>): string {
  const match = CHANNEL_PATH.exec(value);
  if (match === null) return value;
  const scope = ids.get(match[2] ?? '');
  return scope === undefined ? value : `${match[1] ?? ''}#${scope}${match[3] ?? ''}`;
}

/** A draw's three names — the strings it was asked for by. */
const DRAW_NAMES: ReadonlySet<string> = new Set(['key', 'site', 'purpose']);

function isDraw(record: Record<string, unknown>): boolean {
  return (
    typeof record['key'] === 'string' &&
    typeof record['site'] === 'string' &&
    typeof record['purpose'] === 'string' &&
    typeof record['index'] === 'number'
  );
}

function tokensRenamed(value: string, ids: ReadonlyMap<string, string>): string {
  return value
    .split(/([:#/])/)
    .map((token) => ids.get(token) ?? token)
    .join('');
}

/**
 * ***The bindings and associations, gone whatever the file says*** — the
 * writer strips them (`packaging/world-file.ts`), and this does not trust that
 * it did: `roles` and `stepRoles` name connections on the sender's install,
 * and `memory.associations` is keyed by the sender's other sessions' ids. And
 * `archivedAt` (2026-10-11, the P16.3f review): the sender's housekeeping,
 * which would land the session hidden from the recipient's list.
 */
function withoutBindings(read: SessionExport): SessionExport {
  const session = { ...(read.session as Record<string, unknown>) };
  delete session['roles'];
  delete session['stepRoles'];
  delete session['archivedAt'];
  const memory = session['memory'];
  if (typeof memory === 'object' && memory !== null && !Array.isArray(memory)) {
    const kept = { ...(memory as Record<string, unknown>) };
    delete kept['associations'];
    session['memory'] = kept;
  }
  return { ...read, session: session as SessionExport['session'] };
}

function turnIdsIn(doc: SessionExport): string[] {
  const turns = Array.isArray(doc.turns) ? (doc.turns as unknown[]) : [];
  return turns.flatMap((turn) => {
    const id = (turn as { id?: unknown } | null)?.id;
    return typeof id === 'string' ? [id] : [];
  });
}

/**
 * ***The pictures its moves carried*** — every file under the session's
 * `attachments/`, stored through the attachment store rather than copied by
 * name (`backup/import.ts`'s reason: each is re-addressed by its own bytes, so
 * one altered on the way lands under the digest it actually has, where no
 * turn names it, and the move that named the original sends its words). One
 * that is not a picture this build keeps, or cannot be written, costs that
 * picture — said once for the session, never the session itself.
 */
async function carryAttachments(
  context: WorldSessionContext,
  entry: WorldSessionEntry,
  sessionId: string,
): Promise<ImportNote[]> {
  const prefix = `${entry.folder}/attachments/`;
  let lost = 0;
  for await (const path of context.files.list()) {
    if (!path.startsWith(prefix) || path.length === prefix.length) continue;
    try {
      const bytes = await context.files.read(path);
      const stored =
        bytes === null
          ? null
          : await storeAttachment(context.sessions.layout, context.handle, sessionId, bytes);
      if (stored === null) lost += 1;
    } catch {
      lost += 1;
    }
  }
  return lost === 0
    ? []
    : [
        {
          key: 'import.world.sessionPicturesLost',
          params: { session: entry.name, count: lost },
          level: 'warn',
        },
      ];
}
