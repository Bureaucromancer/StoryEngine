// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

/**
 * ***The two names of publish's that the client's entry reads*** — moved out of
 * `publish.ts` at P16.3g (2026-10-11), and the move is about the client's first
 * load, not about either constant.
 *
 * The selection bar sits on the library's shelves and the World editor's member
 * picker in the editor, so both are on the client's entry; the publish review
 * is a chunk of its own ([21 §7](../../../docs/design/21-client-loading.md)).
 * While these two lived in `publish.ts`, the bundler had to put that whole
 * module — `fileSet`, `closureTree`, everything the review draws with — in a
 * file the entry preloads, as soon as the review used `fileSet`, and the entry
 * measured past its ceiling. A name the entry needs and a rule only the review
 * runs do not belong in one module when the bundler splits by module. The
 * barrel exports both, so no import elsewhere changed.
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
