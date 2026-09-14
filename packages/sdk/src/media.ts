// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

/**
 * Which picture is showing — [06 §7.2](../../../docs/design/06-modes-and-turn-pipeline.md),
 * [06 §10.1a], built at
 * [P7.9](../../../docs/design/workplan/23-p7-implementation.md).
 *
 * ***The shape a backdrop channel's value has to have from its declaration
 * onward***, and the obligation is [06 §10.1a]'s in as many words: *"the
 * channel's value is a media reference able to name either an authored image or
 * a rendition's asset, because a backdrop somebody uploaded and a backdrop the
 * engine made are the same thing to everything downstream of the pointer."*
 *
 * ***The second arm is dead on arrival, and that is the entire content of the
 * obligation.*** P7 can only produce the first: nothing generates a picture
 * until [P9](../../../docs/design/workplan/25-p9-implementation.md). Declaring
 * the narrower shape now — a filename, or an authored reference alone — is the
 * tempting move, and §7.2 says what it costs: *"narrowing it to a filename now
 * means changing a channel's schema under live sessions later ([06 §4.2]) to
 * admit the generated case."* **Free here, a migration there.**
 *
 * ***No existing type could carry it, checked at [P7 §5] and confirmed
 * here.*** All three candidates are references **into an object's own
 * container** and a rendition's asset is not in one: `EmbeddedMedia` is a
 * manifest entry whose `ref` the container resolves, so a channel value holding
 * one would be a copy of a row that goes stale; `AssetRef` is a bare relative
 * path with no owner; `GeneratedMap` is per-field provenance and not a media
 * reference at all. Widening any of them would be worse, since all three are
 * portable types carried by five published schemas.
 *
 * **Internal rather than portable**, and addressed **by id rather than by
 * path**: a channel value lands in `session.json` and in the effect log, not in
 * a package, and an id survives the packaging and re-packaging a path does not.
 * It carries no `mime`, `digest` or `bytes` because those are the manifest's
 * fields — this **resolves** rather than describes, and a pointer that
 * duplicated the row it points at would be two answers to one question.
 */
export type MediaSelection =
  /**
   * A picture somebody put in the library — the media entry `mediaId` on the
   * object `objectId`, of kind `kind`.
   *
   * Two ids because media is embedded in its owner: the entry's id is unique
   * within that object and not across the library. ***And the kind, because a
   * pointer that cannot be followed is not a pointer*** — added at [P7.11],
   * when the first thing that had to turn one of these into a URL found it
   * could not. A library object is addressed by kind and id everywhere else in
   * this build; a media reference that carried only the id would make every
   * reader look the kind up, and the ones that can (`read` takes an optional
   * kind) would be doing it to rebuild a fact the writer already had.
   *
   * *Free now and a migration later*, which is the same argument [06 §10.1a]
   * makes for the union itself: nothing has written one of these yet, and the
   * day something has, adding a required field means changing a channel's
   * schema under live sessions ([06 §4.2]).
   */
  | { from: 'authored'; kind: string; objectId: string; mediaId: string }
  /**
   * A picture the engine made — [06 §10.1a]'s *"the artefact hangs off a turn;
   * the selection is channel state"*. **Nothing writes this arm until [P9]**,
   * and it is declared now so that the channel's schema does not have to change
   * under live sessions when something does.
   */
  | { from: 'rendition'; renditionId: string };

/**
 * The JSON Schema a channel holding a {@link MediaSelection} declares.
 *
 * **A constant rather than each mode writing it out**, for the reason
 * `dialChannel` exists: the second mode to stage a scene would write a schema
 * that nearly matched, and *nearly* is how a portable value acquires two
 * shapes. It is a plain object so a mode may spread it into a wider schema —
 * `null` for *nothing showing* is the mode's decision and not this one's, and
 * Scene's declaration makes it.
 */
export const MEDIA_SELECTION_SCHEMA = {
  oneOf: [
    {
      type: 'object',
      properties: {
        from: { const: 'authored' },
        kind: { type: 'string', minLength: 1 },
        objectId: { type: 'string', minLength: 1 },
        mediaId: { type: 'string', minLength: 1 },
      },
      required: ['from', 'kind', 'objectId', 'mediaId'],
      additionalProperties: false,
    },
    {
      type: 'object',
      properties: {
        from: { const: 'rendition' },
        renditionId: { type: 'string', minLength: 1 },
      },
      required: ['from', 'renditionId'],
      additionalProperties: false,
    },
  ],
} as const;
