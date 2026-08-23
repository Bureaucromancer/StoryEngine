// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { ACTOR_SCHEMA, type Actor, validate } from '@storyengine/shared';

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
 * oversight.** A cast entry is a *link*; only the preset is a copy ([02 §8]).
 * Improving a character card should reach an ongoing game, while editing a
 * preset must not — the asymmetry is the design. It looks like a
 * prefill-not-binding violation and is exactly the opposite.
 *
 * It lives in `turns/` and not in `modes/`, because it touches the library and a
 * mode does no I/O.
 */
export function resolveCast(
  library: LibraryContext,
  handle: string,
  cast: { persona?: unknown; actors?: unknown } | null | undefined,
): { persona: Actor | null; actors: Actor[] } {
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

  return {
    persona: persona === null ? null : oneActor(library, handle, persona),
    actors: actors
      .filter((id): id is string => typeof id === 'string')
      .map((id) => oneActor(library, handle, id))
      .filter((actor): actor is Actor => actor !== null),
  };
}

function oneActor(library: LibraryContext, handle: string, id: string): Actor | null {
  try {
    const row = read(library, handle, id, ACTOR_SCHEMA);
    // Validated rather than cast: a hand-edited actor that no longer matches its
    // schema is exactly the case this function exists to survive.
    return validate(row.body).valid ? (row.body as Actor) : null;
  } catch {
    // Not found, or not this account's. Both mean the same thing here.
    return null;
  }
}
