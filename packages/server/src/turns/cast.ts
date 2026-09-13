// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { ACTOR_SCHEMA, type Actor, type TagList, validate } from '@storyengine/shared';

import { resolveObjectTags } from '../tags/resolve.js';

import { actorsWithState } from '../sessions/cast.js';

import { read } from '../library.js';
import type { LibraryContext } from '../library.js';

/**
 * Reads a session's cast out of the library. **Never throws.**
 *
 * [00 §3.3](../../../../docs/design/00-stance.md): resolve what you can, show what you cannot,
 * never block. A deleted actor must not make an unrelated session unplayable,
 * and a hand-edited invalid one must not stop a turn — which is the server-side
 * half of the same rule F13 fixed in the editor.
 *
 * **Actors are read fresh every turn, and that is correct rather than an
 * oversight.** A cast entry is a *link*; only the preset is a copy ([03 §8]).
 * Improving a character card should reach an ongoing game, while editing a
 * preset must not — the asymmetry is the design. It looks like a
 * prefill-not-binding violation and is exactly the opposite.
 *
 * It lives in `turns/` and not in `modes/`, because it touches the library and a
 * mode does no I/O.
 *
 * ***And it reads two sources now, not one — 2026-09-12, [P7.3].*** The
 * session's `cast.actors` is the roster: which cards this session is configured
 * to play with. Who is actually *in* the story at a node is channel state, and
 * since [P7.2] the two can differ. This resolves the union, so the prompt and
 * the cast panel answer the same question with the same set of people; the
 * `channels` parameter carries the argument.
 */
/**
 * An actor with the address of the bytes that were read — [P3.0]. The cast is
 * a link resolved fresh each turn, so the id names whatever the actor is
 * *now*; the hash is what lets a block's source resolve to the object as it
 * was **used**, which is the difference between provenance and a guess.
 */
export interface CastMember {
  actor: Actor;
  contentHash: string;
}

export function resolveCast(
  library: LibraryContext,
  handle: string,
  cast: { persona?: unknown; actors?: unknown } | null | undefined,
  /**
   * The tag registry, so an actor reaches the engine under the names its tags
   * have *now* — [05 §3](../../../../docs/design/05-tagging.md).
   *
   * Passed rather than read here, because this function is synchronous and the
   * registry is a file. `gatherAssemblyInputs` already awaits several per-turn
   * reads and one more costs nothing. It matters because activation compares
   * tag names exactly and case-sensitively: an actor arriving under a stale
   * name is a lore gate that silently stops firing.
   */
  registry: TagList,
  /**
   * **The channel map at the node being assembled**, because the roster is not
   * the only thing that decides who is in this story — [P7 §1.6], [P7.3],
   * 2026-09-12.
   *
   * `castRows` has unioned the cast field with the actors the channels name
   * since [P7.2], on the argument that *"a character written into the story and
   * given presence without being added to `cast.actors` is exactly the drift the
   * panel exists to make visible"*. This function read the field alone, so the
   * two disagreed in the one direction that matters: the panel showed the new
   * arrival a row, and the assembler sent no character card. The prompt is where
   * that is expensive — every turn after the arrival is assembled as though
   * nobody had arrived.
   *
   * `se.presence` is `model-proposed` ([06 §8.1]'s table), so this is reachable
   * without anyone hand-editing anything; the hand-edit door
   * (`PUT /sessions/:id/channels/:key`) is merely the one that is open today.
   */
  channels: Readonly<Record<string, { value: unknown }>>,
): { persona: CastMember | null; actors: CastMember[] } {
  /**
   * **Shape-guarded, because this is handed whatever is in the file.**
   * `readSession` validates nothing beyond the id being a string, and
   * hand-editing `session.json` is a supported way to get data in — so a
   * `cast` that is null, or whose `actors` is a string, reaches here. The
   * never-throws claim above is only true if that is checked.
   */
  if (cast === null || typeof cast !== 'object') return { persona: null, actors: [] };
  const actors = Array.isArray(cast.actors) ? cast.actors : [];
  const persona = typeof cast.persona === 'string' ? cast.persona : null;

  const declared = actors.filter((id): id is string => typeof id === 'string');

  /**
   * **Declared first and in declared order, then the arrivals sorted.**
   *
   * Order is not cosmetic here: `assembly/collect.ts` resolves `{{char}}` to
   * `actors[0]`, so an arrival that sorted ahead of the configured cast would
   * quietly change who that macro means part-way through a story. Appending
   * cannot do that, and the sort is only so two arrivals in one turn have a
   * stable order rather than the channel map's iteration order.
   *
   * The persona is excluded, because it comes back on the other half of the
   * return value and a player who has a presence effect is not also an NPC.
   */
  const named = new Set(declared);
  const arrived = [...actorsWithState(channels)]
    .filter((id) => !named.has(id) && id !== persona)
    .sort();

  return {
    persona: persona === null ? null : oneActor(library, handle, persona, registry),
    /**
     * **`maxActors` is not re-checked here, and the omission is deliberate.**
     * The create and cast routes cap what a *person* configures ([06 §7.2]);
     * a story that walks a fourth character into a three-seat scene has already
     * happened, and refusing to load their card would assemble the turn around
     * someone the record says is there. The budgeter drops what does not fit,
     * which is [06 §5]'s division of labour — an input bound is not a budget
     * rule.
     */
    actors: [...declared, ...arrived]
      .map((id) => oneActor(library, handle, id, registry))
      .filter((member): member is CastMember => member !== null),
  };
}

function oneActor(
  library: LibraryContext,
  handle: string,
  id: string,
  registry: TagList,
): CastMember | null {
  try {
    const row = read(library, handle, id, ACTOR_SCHEMA);
    // Validated rather than cast: a hand-edited actor that no longer matches its
    // schema is exactly the case this function exists to survive. The hash
    // rides along instead of being discarded one line from where the record
    // needs it ([P3.0]).
    return validate(row.body).valid
      ? { actor: resolveObjectTags(row.body as Actor, registry), contentHash: row.contentHash }
      : null;
  } catch {
    // Not found, or not this account's. Both mean the same thing here.
    return null;
  }
}
