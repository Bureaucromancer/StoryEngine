// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import type { LibraryObject } from '../api.js';

/**
 * Whether a surface may offer to *change* what it is showing — the one gate
 * behind Edit and Delete on the read page, and behind Delete on the shelf.
 *
 * One predicate rather than two spellings, which is
 * [polish §1](../../../../docs/design/workplan/06-polish.md)'s closing note taken at its
 * word: the Edit condition was written out inline, Delete grew a second and
 * shorter hand-written copy of it, and the two had already drifted by the time
 * they were put side by side.
 *
 * **They had drifted on `shadowed`, and that was the bug.** Delete asked only
 * about `source`. But two files can hold one id, the read page can be addressed
 * at either through `?source=&slug=`, and every *write* route resolves an id to
 * the winner regardless — so Delete on the losing copy moved a folder other
 * than the one on screen. That is F19 with the stakes raised from *shows the
 * wrong object* to *removes the wrong object*, and no server-side check can
 * catch it, because from the server's side the request is perfectly
 * well-formed. The affordance is withheld rather than made to lie; resolving a
 * duplicate stays a file-system job until there is a surface for it
 * ([03 §5.1](../../../../docs/design/03-data-model.md)).
 *
 * ***Its own file since the shelf learned to delete*** (2026-10-06,
 * [polish §27](../../../../docs/design/workplan/06-polish.md)). A shelf row is
 * the same write by the same id, and a shadowed row is the losing copy there
 * too — so the shelf asks this rather than a third spelling, which is the
 * second reader arriving and the decision lifted at it, not at the third.
 */
export function mutable(object: LibraryObject): boolean {
  return object.source === 'user' && !object.shadowed;
}
