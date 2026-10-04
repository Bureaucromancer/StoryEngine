// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import type { Rendition } from './rendition.js';
import type { Turn } from './turn.js';

/**
 * ***A session, whole, for another install*** —
 * [26 B12](../../../docs/design/26-open-questions.md),
 * [10 §12.3](../../../docs/design/10-ui-surfaces.md),
 * [19 §3](../../../docs/design/19-session-import.md),
 * [P11 §1.8](../../../docs/design/workplan/28-p11-implementation.md),
 * [P11.10](../../../docs/design/workplan/28-p11-implementation.md).
 *
 * **Lossless, where the reading view is lossy by design** — [10 §12.3]'s table,
 * which exists so the two are not conflated: *for a person to read* against
 * *for another install to load*. An export that dropped the turn records would
 * be broken; a reading view that included them would be unreadable.
 *
 * ***This is the event that ends the turn record's freedom to move.***
 * `turn.ts`'s own header says so, and [04 §1] puts `Turn` in the *free to move*
 * tier **because nothing exports it**. From here a change to that record is a
 * change to a format somebody else's install reads.
 * [P9 §1.1](../../../docs/design/workplan/26-p9-implementation.md) decided
 * `Rendition` graduates on the same event, so this envelope freezes **two**
 * records and the consequences below apply to both.
 *
 * ***Written with import in mind***, which [26 E4] says is the whole difference
 * between two documents only one of which could be written here: *"a format
 * designed with import in mind and a format designed without it are different
 * documents."* [19 §3]'s four consequences are each free now and expensive
 * afterwards, and each is visible in the shape below:
 *
 * 1. **Nothing is made mandatory that is optional on the record.** `input`,
 *    `output`, `request`, `cost` and `steps` stay optional, which is what lets
 *    a turn that never ran a model exist — *"a serialiser written against our
 *    own records would tighten this without anyone deciding to"*, because ours
 *    always have them.
 * 2. **A foreign identifier has somewhere to go**, on the turn itself, and
 *    tolerates being absent: the three surveyed sources supply a message id, a
 *    message id, and nothing at all, and *the one with nothing is the most
 *    widely deployed*.
 * 3. ***`turns` is every turn, not the path.*** This is the one that costs
 *    data. Every read surface walks `walkPath(head)`; serialising that drops
 *    every swipe, which [07 §3] makes the same thing as dropping every unnamed
 *    branch — **lossy against our own data before any import touched it**.
 * 4. **The session carries `origin`**, which [03 §8] specified and nothing
 *    implemented.
 */

/** The current format. Bumped when a reader would need to behave differently. */
export const SESSION_EXPORT_SCHEMA = 'storyengine.session-export/1';

export interface SessionExport {
  schema: typeof SESSION_EXPORT_SCHEMA;
  /**
   * What wrote it, for a reader deciding whether to trust a field it does not
   * know — **not** for deciding whether to load: a newer file is read by an
   * older build on the strength of `schema`, and anything unrecognised is
   * carried rather than refused.
   */
  exportedBy: { version: string | null; at: string };
  /**
   * The session document, minus the things that are facts about **this
   * install** rather than about the story.
   *
   * ***`channels` is kept and is derived*** — [03 §8.1] calls the head snapshot
   * a cache — and it is exported anyway, because a reader that had to replay
   * every effect to show a session's clock would have to implement the whole
   * engine before it could show anything. *It is a cache with a source in the
   * same file*, which is the safe kind.
   */
  session: SessionDocument;
  /**
   * ***Every turn, in no particular order, each naming its parent.*** The tree
   * is the parent links and nothing else — [07 §3] — so a reader reconstructs
   * it rather than being handed a walk, and **no sibling can be lost by the
   * serialiser choosing a path**.
   */
  turns: Turn[];
  /**
   * The pictures, and this is the second record the freeze covers —
   * [P9 §1.1](../../../docs/design/workplan/26-p9-implementation.md),
   * [22 §7](../../../docs/design/22-internal-contracts.md).
   *
   * **The records, not the pixels.** An asset is content-addressed bytes on
   * disk, and an export that inlined them would be a hundred megabytes of
   * base64 for a feature whose value is the story. A reader that has neither
   * the bytes nor a way to fetch them shows the record and says the picture is
   * missing, which is exactly what this build already does for a rendition
   * whose asset failed.
   */
  renditions: Rendition[];
}

/**
 * The session as it travels.
 *
 * ***Open rather than closed, and that is a decision about who reads this.***
 * A `SessionFile` is this build's internal shape and grows a field per phase; a
 * reader on another install needs the ones below to show anything and must not
 * be broken by the ones it has never heard of. So the named fields are the
 * contract and the rest ride along — the same posture `metadata` has on every
 * portable object, applied to a record that never had one.
 */
export interface SessionDocument {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  headTurnId: string | null;
  [key: string]: unknown;
}

/**
 * ***One envelope, two payloads*** —
 * [P11 §1.9](../../../docs/design/workplan/28-p11-implementation.md),
 * [04 §9](../../../docs/design/04-schemas.md),
 * [P4](../../../docs/design/workplan/16-p4-implementation.md)'s *"P11-ish"*.
 *
 * §1.9 decided `.sepack` is this stage's rather than a stage of its own, and the
 * deciding consideration was **not** scheduling: an envelope is one of [19 §3]'s
 * four consequences — *free while the format is being written and expensive
 * afterwards* — and a second one written later is two formats forever.
 *
 * ***What it carries that a session does not, and what it does not carry that a
 * session does.*** A package is an arbitrary bundle of **portable** objects,
 * every one of which already has a schema, a `Provenance` and an id
 * `stampImported` can key. So none of the three hard questions a session asks —
 * siblings, absent instrumentation, foreign identifiers — is asked by a bag of
 * actors, and this half needs no format decision of its own. *That asymmetry is
 * the argument for the two sharing an envelope rather than a serialiser.*
 */
export const PACKAGE_EXPORT_SCHEMA = 'storyengine.package-export/1';

export interface PackageExport {
  schema: typeof PACKAGE_EXPORT_SCHEMA;
  exportedBy: { version: string | null; at: string };
  /**
   * The manifest: what is inside, named, so a reader can say what it is about
   * to import before importing it.
   *
   * ***Names and kinds rather than a count***, because the decision a person is
   * about to make is *do I want these in my library* and a number cannot answer
   * it. This is the same reason [10 §5.2]'s *Used by* lists names beside its
   * count.
   */
  manifest: { id: string; name: string; version: string; contents: ManifestEntry[] };
  /**
   * The objects themselves, exactly as they are on disk.
   *
   * **Not re-serialised through a narrowing type**, on [19 §3]'s first
   * consequence generalised: every one of these is already a portable object
   * with a published schema, and a writer that restated their shapes would be a
   * second definition of six records that can then disagree with the first.
   */
  objects: unknown[];
}

export interface ManifestEntry {
  id: string;
  schema: string;
  name: string;
}
