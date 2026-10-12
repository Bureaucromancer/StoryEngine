// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import {
  type ImportPreview,
  type ImportPreviewWorld,
  isKnownSchema,
  type LeftBehind,
  LIBRARY_DIRECTORIES,
  type PortableSchemaId,
  SESSION_SCHEMA,
  WORLD_SCHEMA,
  type WorldFileManifest,
} from '@storyengine/shared';

import { findById, findPriorImport } from '../../index-db/query.js';
import { sessionByOrigin, sessionHolding, sessionOwner } from '../../index-db/sessions.js';
import { LibraryError, read, resolveRef, type LibraryContext } from '../../library.js';
import { scopeOf, type SessionContext } from '../../sessions/store.js';
import { modeIsHere } from './landing.js';
import { arrivalKey } from './plan.js';
import { wellFormedNotes } from './reader.js';
import { worldSessionOrigin } from './session.js';

/**
 * ***The look before commit*** — [16 §5.1](../../../../../docs/design/16-publish.md),
 * [10 §5](../../../../../docs/design/10-ui-surfaces.md),
 * [P16.3f](../../../../../docs/design/workplan/34-p16-world.md).
 *
 * **A hand-picked file reports first and commits on a word** ([16 §5.1]): what
 * is inside, by kind and name, what already exists here, and what dangles. A
 * World's file says the first in its manifest, at its head, so that question
 * can be answered *before anything is written* — and this answers it from the
 * manifest alone, writing nothing and reading nothing of the file but the
 * manifest (the plan's R4: the head bytes go to the existing preview door, and
 * the server parses them with the shared `firstLocalEntry`).
 *
 * ***`here` is asked exactly as the commit asks it***, and only that — the
 * plan's identity table (`plan.ts`, `decide`), read without writing:
 *
 * | The id is | Previews as |
 * |---|---|
 * | this account's, in that kind — or an earlier arrival of the file (`seworld:<id>`) | `here` |
 * | the built-in library's, in that kind | `built-in` |
 * | **anything else — another account's included** | `new` |
 *
 * ***The anti-leak rule*** is the last row. The commit re-mints an object whose
 * id another account holds, and says nothing that differs from an id nobody
 * holds; a preview that said *already here*, or *taken*, would answer — per
 * object, for anybody who can make a file — which ids another account holds.
 * So an id this account cannot read is `new`, whoever holds it. Sessions keep
 * the same rule: *here* is this account's earlier arrival (its key) or its own
 * session (its turns), never a session somebody else's turns are in.
 *
 * ***A prediction*** ([P16.3]'s plan, risk 9): from the manifest a look can say
 * *here* or *new*; whether an object here *differs* needs its body, which the
 * head of a file does not hold. So `reimport` stays `unknown`, and the review
 * offers *replace or keep both* whenever anything is here. The commit's report
 * is the truth, as for every preview here.
 */

export interface WorldPreviewContext {
  library: LibraryContext;
  /** Null when the caller has none — every session then previews as new. */
  sessions: SessionContext | null;
  handle: string;
}

/** The preview of a World's file, from its manifest — see the module comment. */
export function previewWorld(
  context: WorldPreviewContext,
  manifest: WorldFileManifest,
  format: ImportPreviewWorld['format'],
  source: string,
): ImportPreview {
  const legacy = format === 'package-export';
  const sessionIds = new Set(manifest.sessions.map((session) => session.id));
  const world: ImportPreviewWorld = {
    kind: 'world',
    format,
    // The legacy file never said how it was started; its synthesis says `world`.
    origin: legacy ? null : manifest.origin,
    writtenBy: { version: manifest.exportedBy.version, at: manifest.exportedBy.at },
    world:
      manifest.world === null
        ? null
        : {
            id: manifest.world.id,
            name: manifest.world.name,
            description: manifest.world.description,
            here: objectHere(context, WORLD_SCHEMA, manifest.world.id) === 'here',
          },
    objects: manifest.objects.map((row) => ({
      schema: row.schema,
      id: row.id,
      name: row.name,
      member: row.member,
      kind: isKnownSchema(row.schema) ? LIBRARY_DIRECTORIES[row.schema] : null,
      here: objectHere(context, row.schema, row.id),
    })),
    sessions: manifest.sessions.map((session) => ({
      id: session.id,
      name: session.name,
      turns: countOf(session.turns),
      pictures: countOf(session.pictures),
      attachments: countOf(session.attachments),
      mode: typeof session.mode === 'string' ? session.mode : null,
      here: sessionHere(context, session.id, session.headTurnId),
    })),
    leftBehind: (manifest.leftBehind as unknown[]).filter(isLeftBehind).map((entry) => ({
      ...entry,
      resolvesHere: resolvesHere(context, entry, sessionIds),
    })),
    requires: {
      modes: manifest.requires.modes.map((mode) => ({
        id: mode.id,
        minVersion: mode.minVersion,
        here: modeIsHere(mode.id, mode.minVersion),
      })),
      extensions: manifest.requires.extensions.map((one) => ({
        id: one.id,
        minVersion: one.minVersion,
      })),
      capabilities: [...manifest.requires.capabilities],
    },
    history: manifest.history,
    omitted: wellFormedNotes(manifest.omitted, legacy),
  };
  return {
    source,
    disposition: 'converted',
    notes: [],
    advisories: [],
    object: world,
    reimport: 'unknown',
  };
}

/**
 * ***How many of the file's `leftBehind` resolve to nothing here*** — the
 * review's *what dangles* ([16 §5.1]), counted the way the preview marks each
 * one, so the after-commit line and the look before it agree. The reader
 * counts it before the first write and hands it to the World's row.
 */
export function danglingHere(
  context: Omit<WorldPreviewContext, 'sessions'> & { sessions?: SessionContext | null },
  manifest: WorldFileManifest,
): number {
  const sessionIds = new Set(manifest.sessions.map((session) => session.id));
  const full: WorldPreviewContext = { ...context, sessions: context.sessions ?? null };
  return (manifest.leftBehind as unknown[])
    .filter(isLeftBehind)
    .filter((entry) => !resolvesHere(full, entry, sessionIds)).length;
}

/** The commit's own lookups, written nothing — see the module comment's table. */
function objectHere(
  context: WorldPreviewContext,
  schema: string,
  id: string,
): 'new' | 'here' | 'built-in' {
  if (!isKnownSchema(schema)) return 'new';
  const owner = `user:${context.handle}`;
  const row = findById(context.library.db, id);
  if (row !== null && row.owner === owner && row.schemaId === schema) return 'here';
  if (findPriorImport(context.library.db, owner, schema, arrivalKey(id)) !== null) return 'here';
  if (row !== null && row.owner === 'system' && row.schemaId === schema) return 'built-in';
  // Nobody's — or somebody else's, which must read the same (the anti-leak rule).
  return 'new';
}

/**
 * ***This account has the session already*** — an earlier arrival of the file
 * (the key `session.ts` stamps), or its own session read back (its head turn,
 * held by a session of this account's). *Never* because another account's
 * session holds the turn: that reads as new, as an object's id does.
 */
function sessionHere(
  context: WorldPreviewContext,
  fileSessionId: string,
  headTurnId: string | null,
): boolean {
  const { sessions } = context;
  if (sessions === null) return false;
  const owner = scopeOf(sessions, context.handle);
  if (sessionByOrigin(sessions.index, owner, worldSessionOrigin(fileSessionId)) !== null) {
    return true;
  }
  if (typeof headTurnId !== 'string') return false;
  return sessionHolding(sessions.index, [headTurnId])?.owner === owner;
}

/**
 * ***Whether a left-behind reference resolves here*** — by id, among what this
 * account can read (its own, and the built-in library); then, for a reference
 * an object makes, by name, as a `Ref` resolves at play (`resolveRef`). A
 * session names its links by id alone and has no name to fall back on, so a
 * reference only sessions make resolves by id or not at all; and a left-behind
 * session resolves only when it is this account's own.
 */
function resolvesHere(
  context: WorldPreviewContext,
  entry: LeftBehind,
  sessionIds: ReadonlySet<string>,
): boolean {
  if (entry.schema === SESSION_SCHEMA) {
    if (entry.id === null || context.sessions === null) return false;
    return sessionOwner(context.sessions.index, entry.id) === `user:${context.handle}`;
  }
  if (entry.schema === null || !isKnownSchema(entry.schema)) return false;
  const schema: PortableSchemaId = entry.schema;
  if (entry.id !== null) {
    try {
      read(context.library, context.handle, entry.id, schema);
      return true;
    } catch (error) {
      if (!(error instanceof LibraryError) || error.code !== 'not-found') throw error;
    }
  }
  const byName = entry.from.some((from) => !sessionIds.has(from));
  if (!byName || entry.name === '') return false;
  return resolveRef(context.library, context.handle, { name: entry.name }, schema) !== null;
}

/** A `leftBehind` row a reader can act on — the manifest reader checks the list, not its rows. */
function isLeftBehind(value: unknown): value is LeftBehind {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const row = value as Record<string, unknown>;
  return (
    (row['schema'] === null || typeof row['schema'] === 'string') &&
    (row['id'] === null || typeof row['id'] === 'string') &&
    typeof row['name'] === 'string' &&
    typeof row['reason'] === 'string' &&
    typeof row['required'] === 'boolean' &&
    Array.isArray(row['from']) &&
    (row['from'] as unknown[]).every((one) => typeof one === 'string')
  );
}

/** A count a file says, kept to a count: anything else is none. */
function countOf(value: unknown): number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : 0;
}
