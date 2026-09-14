// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { type Static, Type } from '@sinclair/typebox';

import { EmbeddedMedia, Id, Metadata, Provenance } from './common.js';

/**
 * World — docs/design/04-schemas.md §9, docs/design/15-world.md.
 *
 * **A named set of objects that share a canon, and the unit that travels.**
 *
 * ***Renamed from Package.*** This was `storyengine.package/1` — *"an arbitrary
 * bundle of portable objects, and nothing else"* — until the two concepts were
 * reconciled. The rename is not cosmetic and the argument is worth keeping here
 * rather than only in the design notes, because the next reader of this file
 * will wonder why a transport container has a name that sounds like content.
 *
 * A Package was specified as a pure envelope whose contents are *embedded copies
 * resolved on import*, so the container dissolved the moment it arrived. But
 * [06 §4.1] widened `ChannelDefinition.owner` to accept a package id, and had
 * packages carry a `rules` collection — which asks a dissolved container to own
 * live session state and state rules about it. **A channel owned by something
 * that no longer exists is not a container, it is a dangling reference.** What
 * that field needed was a durable, in-install, authored object the engine can
 * read at turn time, which is what [15] described and declined to build.
 *
 * So the envelope and the durable object are one thing, and it is a World.
 * The portable kind count did not rise: this kind was renamed, not joined.
 *
 * **The container still validates the envelope, never the payload kind**, which
 * is what kept Package stable when a new kind appeared and is unchanged here: a
 * reader checks that each entry has a `schema` and an `id`, resolves what it
 * recognises through the registry, and carries the rest through untouched. It is
 * the unknown-field preservation rule applied one level up.
 */

export const WORLD_SCHEMA = 'storyengine.world/1';

/**
 * Open, not closed.
 *
 * An earlier draft of the design enumerated the kinds one line after saying the
 * container does not enumerate kinds — which meant an older reader would reject
 * a file containing a kind it had never heard of, exactly the stranding §2
 * forbids. So the envelope is all that is checked here.
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
     * Self-describing portable objects — each carries its own `schema`.
     * Embedded copies resolved on import, not links: links inside the file
     * resolve within it first, then locally, then dangle visibly.
     *
     * **This is the wire form.** A stored World's members live in the library as
     * real objects and are named by reference; embedding is a fact about the
     * file rather than about the store. Which of the two shapes the stored form
     * takes — a `members` list beside this, or member folders inside the zip
     * with this field retired — is the one schema question [15] settles, and
     * nothing should grow a second representation of a member object before it
     * does.
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
      'No `entry` field. A world containing one or more Setups is startable, ' +
      'and that is the whole mechanism. A world with no Setup is a content ' +
      'drop — "here are five characters and a lorebook" — which is a perfectly ' +
      'good thing to share and had no home before.',
  },
);
export type World = Static<typeof World>;
