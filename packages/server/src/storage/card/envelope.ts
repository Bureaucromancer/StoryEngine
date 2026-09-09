// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

/**
 * The embedded card envelope — [03 §5.2](../../../../../docs/design/03-data-model.md).
 *
 * **Envelope, not format.** PNG `tEXt` is PNG-specific and it would be a mistake
 * to bake it in, so the thing that travels is a `{schema, version, payload}`
 * document and the container is a *codec* underneath it. PNG ships at 1.0;
 * WebP `XMP` and JPEG `APP1` are then a codec rather than a migration.
 *
 * The split this file draws, and it is the one that keeps the codecs honest:
 *
 * - **The envelope carries the object.** One self-describing portable object,
 *   exactly as it would appear on disk as JSON.
 * - **The container carries the bytes.** Media travels beside the envelope as
 *   opaque blobs keyed by id, because `EmbeddedMedia` is a *manifest* — it holds
 *   a digest, a mime type and a container-relative `ref`, never the bytes
 *   ([04 §3](../../../../../docs/design/04-schemas.md)). A PNG private chunk, a zip entry and a
 *   folder all satisfy that reference the same way.
 *
 * **A codec does not understand the payload.** It does not validate it, does not
 * read its `media` array, and does not check that every `ref` has a blob. That
 * belongs to whoever is writing the object, which has the registry
 * ([04 §9](../../../../../docs/design/04-schemas.md)) and the context to report a problem
 * usefully. A codec that started inspecting payloads would need updating every
 * time a kind gained a field.
 */

/** The envelope format itself, not the object inside it. */
export const CARD_ENVELOPE_SCHEMA = 'storyengine.card';

/** Bumped only if the envelope's own shape changes. The payload versions itself. */
export const CARD_ENVELOPE_VERSION = 1;

export interface CardEnvelope {
  schema: typeof CARD_ENVELOPE_SCHEMA;
  version: number;
  /**
   * A self-describing portable object — an Actor today, and the reason this is
   * `unknown` rather than `Actor` is that the codec has no business narrowing
   * it. The caller validates through the registry.
   */
  payload: unknown;
}

/**
 * Media bytes, keyed by the id an `EmbeddedMedia.ref` points at.
 *
 * A `Map` rather than an object so a blob id can be any string without
 * colliding with `Object.prototype`, and so size is O(1) for the cap the design
 * still owes ([03 §5.2.2](../../../../../docs/design/03-data-model.md)).
 */
export type BlobStore = Map<string, Uint8Array>;

export interface LegacyCard {
  /** `chara` is V2, `ccv3` is V3. */
  keyword: 'chara' | 'ccv3';
  /**
   * The decoded JSON, exactly as it was written.
   *
   * **Not converted.** Mapping a V2 card onto an Actor is import's job
   * ([03 §2.7](../../../../../docs/design/03-data-model.md)) and lands at P4 — routing
   * `scenario` to a Treatment draft and `personality` to traits is a set of
   * judgement calls with a review step, not a decoding concern.
   */
  data: unknown;
}

export interface CardContents {
  /** The StoryEngine envelope, or null if this file does not carry one. */
  envelope: CardEnvelope | null;
  /** Media bytes by blob id. Empty rather than absent when there are none. */
  blobs: BlobStore;
  /**
   * A V2/V3 payload, if the file has one. Present alongside `envelope` rather
   * than instead of it: a card can legitimately carry both, and which one wins
   * is the caller's decision.
   */
  legacy: LegacyCard | null;
}

export interface CardCodec {
  /** Stable identifier, used in errors and in the extension mapping. */
  readonly container: string;
  readonly mime: string;
  readonly extension: string;

  /** True if these bytes look like this container. Magic-number only. */
  sniff(bytes: Uint8Array): boolean;

  read(bytes: Uint8Array): CardContents;

  /**
   * Rewrites `bytes` to carry `envelope` and `blobs`.
   *
   * Takes the original file rather than producing one, because **the pixels are
   * the user's art and must survive untouched** — re-encoding on every save
   * quietly degrades it ([03 §5.2](../../../../../docs/design/03-data-model.md)). A codec
   * splices; it never re-compresses.
   */
  write(bytes: Uint8Array, envelope: CardEnvelope, blobs?: BlobStore): Uint8Array;
}

export class CardFormatError extends Error {
  readonly container: string;

  constructor(container: string, message: string) {
    super(`${container}: ${message}`);
    this.name = 'CardFormatError';
    this.container = container;
  }
}

/** Wraps a portable object for embedding. */
export function envelope(payload: unknown): CardEnvelope {
  return {
    schema: CARD_ENVELOPE_SCHEMA,
    version: CARD_ENVELOPE_VERSION,
    payload,
  };
}

/**
 * Recognises an envelope without trusting it.
 *
 * Deliberately tolerant of a *newer* `version`: the payload is self-describing
 * and the registry decides whether it can be read, so refusing here would
 * strand a card for a reason the envelope layer cannot actually judge
 * ([04 §2](../../../../../docs/design/04-schemas.md)).
 */
export function isCardEnvelope(value: unknown): value is CardEnvelope {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Partial<CardEnvelope>;
  return (
    candidate.schema === CARD_ENVELOPE_SCHEMA &&
    typeof candidate.version === 'number' &&
    'payload' in candidate
  );
}
