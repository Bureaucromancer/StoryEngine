// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { type Static, Type } from '@sinclair/typebox';

import { EmbeddedMedia, Id, Metadata, Provenance } from './common.js';

/**
 * World — docs/design/04-schemas.md §9, docs/design/15-world.md.
 *
 * **A durable named set of references to portable objects and sessions.** This
 * is the kind that was called Package until [P16.0], renamed rather than joined
 * by the owner's decision of 2026-10-03 ([26 B17]): the six portable kinds stay
 * six, and the fields are the Package's, unchanged. What the rename changes is
 * what the set is *for* — membership, transport through [16]'s publish flow, and
 * contribution to a new session's lore ([15 §1]) — and none of that needs a
 * field the Package did not already have, which is why this file is the old one
 * with its names changed rather than a new one.
 *
 * The container validates the envelope, never the payload kind: a reader checks
 * that each entry has a `schema` and an `id`, resolves what it recognises
 * through the registry, and carries the rest through untouched. That is what
 * keeps the kind stable when a new kind appears, and it is the unknown-field
 * preservation rule applied one level up ([15 §3.3]).
 */

export const WORLD_SCHEMA = 'storyengine.world/1';

/**
 * ***The kind's name until [P16.0], and still read*** — [P16 §1.1].
 *
 * **Read both, write the new one, and keep the old read for as long as anything
 * might hold the old shape** — which, because backups taken before the rename
 * exist and alpha 5 handed out files in it, is indefinitely. A body carrying
 * this id is a World: its fields are the World's exactly, so the reading is a
 * rename of one string and nothing else ([04 §2]'s *a /2 reader accepts /1 and
 * upgrades in memory*, applied to a rename). **No build writes it from P16.0
 * on**, and it is deliberately *not* in `PORTABLE_SCHEMAS`: that would bring the
 * old kind back as a library kind with a folder of its own, and make the six
 * portable kinds seven ([P16 §1.1] argues the alternatives and why neither was
 * taken).
 */
export const LEGACY_PACKAGE_SCHEMA = 'storyengine.package/1';

/**
 * Open, not closed.
 *
 * An earlier draft of the design enumerated the kinds one line after saying the
 * container does not enumerate kinds — which meant an older reader would reject
 * a set containing a kind it had never heard of, exactly the stranding §2
 * forbids. So the envelope is all that is checked here.
 *
 * **A session member is an envelope like any other** —
 * `{ schema: 'storyengine.session/1', id, name }` ([P16 §1.2]) — which this
 * already accepts, because `schema` is validated as a string and never as a
 * kind.
 *
 * An unrecognised entry is preserved verbatim, round-tripped intact, and shown
 * in the import review as *"1 object of an unrecognised kind
 * (storyengine.campaign/1) — kept, not usable here"*.
 */
export const PortableObjectEnvelope = Type.Object(
  {
    schema: Type.String({ minLength: 1 }),
    id: Id,
    name: Type.Optional(Type.String()),
  },
  { title: 'PortableObjectEnvelope' },
);
export type PortableObjectEnvelope = Static<typeof PortableObjectEnvelope>;

export const World = Type.Object(
  {
    schema: Type.Literal(WORLD_SCHEMA),
    id: Id,
    name: Type.String(),
    version: Type.String(),
    description: Type.String(),
    media: Type.Array(EmbeddedMedia),

    /**
     * **References, not copies** — one envelope per member, naming its
     * `schema`, `id` and `name`, resolved against the library when the World is
     * exported (`packaging/export.ts`). This comment said *"embedded copies
     * resolved on import"* until 2026-10-04, which is true of the exported file
     * and was never true of what is stored here: embedding is a fact about the
     * file, linking a fact about the store ([04 §9], [15 §3.1]). On import, links
     * inside the file resolve within it first, then locally, then dangle
     * visibly. **Kept as `contents` through the rename** ([P16 §1.1]): it
     * already meant references on the stored form and in the manifest, and
     * renaming it would double the in-memory upgrade to buy a word.
     */
    contents: Type.Array(PortableObjectEnvelope),

    requires: Type.Object({
      modes: Type.Array(Type.Object({ id: Type.String(), minVersion: Type.String() })),
      extensions: Type.Array(Type.Object({ id: Type.String(), minVersion: Type.String() })),
      capabilities: Type.Array(Type.String()),
    }),

    provenance: Provenance,
    metadata: Metadata,
  },
  {
    $id: `https://storyengine.dev/schemas/${WORLD_SCHEMA.replace('/', '.')}.json`,
    title: 'World',
    description:
      'A named set of library objects and sessions, held as references. No ' +
      '`entry` field: a World containing one or more Setups is startable, and ' +
      'that is the whole mechanism. A World with no Setup is a content drop — ' +
      '"here are five characters and a lorebook" — which is a perfectly good ' +
      'thing to share. Read from `storyengine.package/1` as well, the name the ' +
      'kind had before it was renamed.',
  },
);
export type World = Static<typeof World>;

/**
 * ***A body in the kind's old name, read as the kind*** — [P16 §1.1].
 *
 * Returns the value itself when it is not a legacy body, and a **shallow copy**
 * with `schema` replaced when it is: the caller's object is never mutated,
 * because the same parsed body is often also the thing a hash was taken of or a
 * review row shows, and an upgrade that reached back into it would make the
 * stored form and the read form one object again. Idempotent — upgrading a
 * World is the World.
 *
 * **Called at every door a stored or archived body comes in through** — the
 * index's ingest, a version's payload, the backup reader, the native import arm,
 * and a write's own body — rather than inside `validate`, because a validator
 * that renamed what it checked would leave every caller that read `schema`
 * afterwards looking at the old one.
 */
export function upgradeLegacySchema<T>(value: T): T {
  if (typeof value !== 'object' || value === null) return value;
  const schema: unknown = (value as { schema?: unknown }).schema;
  if (schema !== LEGACY_PACKAGE_SCHEMA) return value;
  return { ...(value as object), schema: WORLD_SCHEMA } as T;
}
