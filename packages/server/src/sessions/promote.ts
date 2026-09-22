// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import {
  LOREBOOK_SCHEMA,
  SETUP_SCHEMA,
  TREATMENT_SCHEMA,
  type Lorebook,
  type PortableSchemaId,
  type Setup,
  type Treatment,
} from '@storyengine/shared';

import { LibraryError, read, update, type LibraryContext } from '../library.js';

import { readSession, type SessionContext } from './store.js';

/**
 * ***A hook realised mid-play, saved back out of the session*** —
 * [03 §4.1](../../../../docs/design/03-data-model.md),
 * [06 §6.1](../../../../docs/design/06-modes-and-turn-pipeline.md),
 * [15 §5.1](../../../../docs/design/15-world.md).
 *
 * **The valve that was never built.** `hook-pool.ts` beside this file copies
 * hooks *into* a session from all four of 03 §4.1's sources, and until this
 * there was no way back out of one: a hook somebody wrote in the panel — which
 * 06 §6.1 calls *most of why the feature earns its place* — died with the
 * session it was realised in. This is the other direction, and it is deliberately
 * an **offered** act rather than an automatic one: nothing here runs unless a
 * person pressed something.
 *
 * ---
 *
 * ***Why this is on the server, which is not a preference.***
 *
 * `hookRows` (`hooks.ts`) is the panel's whole view of the pool, and it is a
 * redaction. It sends a hook's `premise` **only once the hook is spent**, sends
 * `entrances` **by label and never by text**, and never sends `involves`,
 * `weight`, `delivery`, `once`, `notBefore` or `blockedBy` at all. So a
 * client-side read-modify-write would be promoting a hook it has never been
 * shown — and the only way to make it possible would be to hand the client an
 * unfired premise, which [08 §6](../../../../docs/design/08-cross-session-memory.md)
 * and [10 §10.1](../../../../docs/design/10-ui-surfaces.md) forbid by name: *an
 * unfired entrance is hidden content*, and a surface that spoils the arrival to
 * the person about to read it defeats the feature.
 *
 * Promotion is therefore keyed by **hook id** and nothing else travels up the
 * wire. The client names which hook and which object; the server is the only
 * party that ever holds the hook itself.
 *
 * ---
 *
 * ***The target's history is the record of the promotion.***
 *
 * [10 §11.2c] settled the same question one kind over, for entry imports:
 * *the book's history is the record of the import*. Nothing new is stored
 * anywhere to say a hook came from a session — the version the write leaves
 * behind says it, in the place somebody looking at the object will actually
 * look.
 *
 * **Through the existing `{ kind: 'manual' }` `VersionSource` with a reason
 * naming the session, rather than an eighth arm.** The arm it would sit next to
 * is `memory` (`storage/history.ts`), which was named separately because *"who
 * changed my character"* has different answers — *an extension did* versus *a
 * session did* — with different repairs. That argument does not reach here: a
 * memory is written **by the engine**, on its own initiative, at a moment nobody
 * chose, and `sessionId` is what makes it act-on-able. A promotion is a person
 * pressing a button, deliberately, on an object they are looking at. `manual` is
 * the honest answer to what changed it; the reason says where they were standing
 * when they did.
 */

/** Which of the three carriers is being written to — [03 §4.1]'s own three. */
export type PromoteTargetKind = 'treatment' | 'setup' | 'lore';

export interface PromoteTarget {
  kind: PromoteTargetKind;
  id: string;
}

/**
 * The four refusals, each a different claim.
 *
 * *Separate arms rather than one `not-found`*, because a caller has to be able
 * to say which of them happened: *your session is gone*, *that hook is not in
 * this pool* and *the object you picked has been deleted* send a person to three
 * different places, and a surface that merged them could only offer the useless
 * union of the three.
 */
export type PromoteOutcome =
  | { kind: 'promoted'; object: { id: string; name: string; kind: PromoteTargetKind } }
  | { kind: 'no-session' }
  | { kind: 'no-such-hook' }
  | { kind: 'no-such-object' }
  | { kind: 'already-there' };

/**
 * 'lore' is a **Lorebook**, spelled the way the pool spells it.
 *
 * `HookSource` already calls the lorebook arm `lore` (`types.ts`), and the
 * session's own field is `lore` too, so a promote target that said `lorebook`
 * would be a third name for the same thing in a feature that has to line its
 * targets up against the pool's sources by eye.
 */
const SCHEMA_FOR: Record<PromoteTargetKind, PortableSchemaId> = {
  treatment: TREATMENT_SCHEMA,
  setup: SETUP_SCHEMA,
  lore: LOREBOOK_SCHEMA,
};

/**
 * The three carriers, and the one thing this module needs of them.
 *
 * `Treatment.hooks` and `Setup.hooks` are required; `Lorebook.hooks` is
 * optional, which is the whole of the difference and is handled where it
 * matters below.
 */
type HookCarrier = Treatment | Setup | Lorebook;

/**
 * Saves one of a session's pooled hooks onto a library object.
 *
 * ***The id survives the copy, and that is the one irreversible thing here*** —
 * [15 §5.1], the obligation `hook-pool.ts` keeps in the other direction. Within
 * a continuity, a hook that fired in session one must not fire again in session
 * two, and cross-session de-duplication is only possible if every copy of a hook
 * carries the same `id`. That section calls a re-minted id *unrecoverable
 * later*: a corpus of sessions whose hooks have unrelated ids cannot be
 * retro-fitted into a continuity, because the linking information was never
 * written. So a collision is **refused** rather than renamed — which is the one
 * place hooks are not like lorebook entries, whose ids are book-local and
 * re-mint on collision by design.
 *
 * ***The session is not touched, and that is the load-bearing omission.***
 *
 * The pool entry keeps `source: { kind: 'session' }`. Re-attributing it to the
 * target would claim the target owns the copy this session is playing with,
 * which is [06 §6.1]'s *pulled, never pushed* read in the direction that
 * actually bites — and for a **lorebook** target it would do something worse
 * than claim: `refuse` in `hooks.ts` retires a hook whose source is `lore` while
 * that book is not active in the session, so a re-attributed hook would silently
 * acquire a `book-inactive` clause it did not have, and a hook somebody wrote in
 * the panel and then saved would stop being eligible in the very session they
 * wrote it in. Promotion adds a copy somewhere else. It changes nothing about
 * the game in progress.
 *
 * *A malformed pooled hook is refused by the library's own validator*, not here.
 * The add route is deliberately open — *a hook the schema would refuse is an
 * authoring mistake to show rather than a request to reject* — so a hook can sit
 * in a pool that `Treatment` would not accept. `update` runs the real validator
 * and raises `LibraryError('invalid')`, which is the honest place for it: the
 * refusal is about the object being written, and the pool is unharmed.
 *
 * Throws `LibraryError` for everything the write path refuses — a system-library
 * target (`read-only`), a target edited underneath us (`stale`), a file the
 * index has lost track of (`diverged`). The route maps those; this function has
 * no opinion about statuses.
 */
export async function promoteSessionHook(
  sessions: SessionContext,
  library: LibraryContext,
  handle: string,
  sessionId: string,
  hookId: string,
  target: PromoteTarget,
): Promise<PromoteOutcome> {
  const session = await readSession(sessions, handle, sessionId);
  if (session === null) return { kind: 'no-session' };

  const pooled = (session.hooks ?? []).find((entry) => entry.hook.id === hookId);
  if (pooled === undefined) return { kind: 'no-such-hook' };

  const inKind = SCHEMA_FOR[target.kind];

  let current;
  try {
    current = read(library, handle, target.id, inKind);
  } catch (error) {
    /**
     * **Not-found covers *wrong kind* too**, because `read` is built that way on
     * purpose: asking for a lorebook id under `treatments` is answered *that
     * collection does not contain that id*, so that a refusal cannot confirm an
     * object exists somewhere else. A promote body naming the wrong kind for an
     * id is that same request, and gets that same answer.
     */
    if (error instanceof LibraryError && error.code === 'not-found') {
      return { kind: 'no-such-object' };
    }
    throw error;
  }

  const held = current.body as HookCarrier;
  const hooks = held.hooks ?? [];

  /**
   * **Refused rather than duplicated, and never re-minted** — see the header.
   * Promoting twice is a thing people do: the control is on a panel row and the
   * first press has no visible effect on the row itself. So the second press
   * has to say *that one is already there* rather than leave the object with two
   * copies of one hook, which would fire, block and de-duplicate as one hook
   * while reading as two in every editor.
   */
  if (hooks.some((one) => one.id === hookId)) return { kind: 'already-there' };

  /**
   * ***`hooks` is created here when the carrier is a lorebook that had none.***
   * `Lorebook.hooks` is optional, and the distinction the whole feature keeps —
   * in `setSessionHooks`, in `poolFor`, and here — is that **absent is not an
   * emptied list**. Appending always produces at least one element, so this path
   * cannot write `hooks: []`; the key appears on the first promotion and means
   * what it says.
   */
  const next = { ...held, hooks: [...hooks, structuredClone(pooled.hook)] };

  const written = await update(library, handle, target.id, next, current.contentHash, {
    source: { kind: 'manual' },
    reason: `Plot hook saved from "${session.name}"`,
  });

  /**
   * The name off the object that was just written rather than off the index row
   * read before it: the row is the state this promotion replaced, and a caller
   * naming what it saved should name the thing on disk.
   */
  const name = (written.object as HookCarrier).name;
  return { kind: 'promoted', object: { id: target.id, name, kind: target.kind } };
}
