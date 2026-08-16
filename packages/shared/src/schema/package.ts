// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { type Static, Type } from '@sinclair/typebox';

import { EmbeddedMedia, Id, Metadata, Provenance } from './common.js';

/**
 * Package — docs/design/10-schemas.md §9.
 *
 * **An arbitrary bundle of portable objects, and nothing else.** With Setup
 * carrying the game definition, a Package is reduced to what it always should
 * have been.
 *
 * The container validates the envelope, never the payload kind: a reader checks
 * that each entry has a `schema` and an `id`, resolves what it recognises
 * through the registry, and carries the rest through untouched. That is what
 * keeps Package stable when a new kind appears, and it is the unknown-field
 * preservation rule applied one level up.
 */

export const PACKAGE_SCHEMA = 'storyengine.package/1';

/**
 * Open, not closed.
 *
 * An earlier draft of the design enumerated the kinds one line after saying the
 * package does not enumerate kinds — which meant an older reader would reject a
 * package containing a kind it had never heard of, exactly the stranding §2
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

export const Package = Type.Object(
  {
    schema: Type.Literal(PACKAGE_SCHEMA),
    id: Id,
    name: Type.String(),
    version: Type.String(),
    description: Type.String(),
    media: Type.Array(EmbeddedMedia),

    /**
     * Self-describing portable objects — each carries its own `schema`.
     * Embedded copies resolved on import, not links: links inside the package
     * resolve within it first, then locally, then dangle visibly.
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
    $id: `https://storyengine.dev/schemas/${PACKAGE_SCHEMA}.json`,
    title: 'Package',
    description:
      'No `entry` field. A package containing one or more Setups is startable, ' +
      'and that is the whole mechanism. A package with no Setup is a content ' +
      'drop — "here are five characters and a lorebook" — which is a perfectly ' +
      'good thing to share and had no home before.',
  },
);
export type Package = Static<typeof Package>;
