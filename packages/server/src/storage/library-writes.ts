// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { KeyedQueue } from './keyed-queue.js';

/**
 * ***The library's write queue, in one place*** — `library.ts`'s, moved here
 * 2026-10-10 at [P16.0](../../../../docs/design/workplan/35-p16-world.md) so that
 * the one writer outside `library.ts` that claims a folder in a kind can take
 * the same turn.
 *
 * Serialises the check-then-write sequences. The stale-hash comparison, the
 * no-op decision, slug allocation and the snapshot all read state that the
 * write then changes; without a critical section, two writers racing through
 * the same `await` points both pass the check and the loser is silently
 * overwritten — the exact failure the hash exists to refuse. Keyed by object id
 * (`obj:<id>` — updates, deletes, and since P16.0 an asset stored beside an
 * object and a version renamed or pinned, which used to need no turn because an
 * object's folder never moved) or by kind directory (`kind:<root>` — creates,
 * the first-write move of a World out of `packages/`, and a legacy trash
 * restore into `worlds/`), so unrelated objects never wait on each other.
 * Deliberately separate from the watcher's event chain — see `keyed-queue.ts`
 * for why sharing it would be wrong.
 *
 * ***Why the kind key has a second user.*** A free folder name is chosen by
 * reading the directory and claimed by the rename or write that follows, and a
 * POSIX rename onto an *empty* directory succeeds without a word — so a create
 * of a World named *Rain City*, racing a Package of the same name being
 * restored from the trash, could resolve the same `rain-city` and have one
 * replace the other's half-made folder. Taking the same key is what makes the
 * look and the claim one step for everybody who claims.
 *
 * **Nesting is one way only**: an object's turn may take its kind's (the move
 * does), and nothing takes an object's turn from inside a kind's — which is the
 * whole of why it cannot deadlock.
 */
export const libraryWrites = new KeyedQueue();
