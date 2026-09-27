// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import {
  ACTOR_SCHEMA,
  LOREBOOK_SCHEMA,
  newTreatment,
  PRESET_SCHEMA,
  TREATMENT_SCHEMA,
  uuidv7,
  type ImportDisposition,
  type PortableSchemaId,
  type Provenance,
  type ImportDestination,
  type ImportItemReport,
  type ImportNote,
  type ImportReport,
  type Actor,
  type EmbeddedMedia,
  type Lorebook,
  type Treatment,
  isKnownSchema,
  schemaIdOf,
  validate,
} from '@storyengine/shared';

import { convertCharacter } from './aventuras/character.js';
import { convertAventurasLorebook } from './aventuras/lorebook.js';
import { convertScenario } from './aventuras/scenario.js';
import {
  identify,
  identifyNative,
  priorImportId,
  stableId,
  stampImported,
  type ConflictPolicy,
} from './identity.js';
import { blankCardPixels, create, read, update, type LibraryContext } from '../library.js';
import { contentHashOf } from '../index-db/ingest.js';
import { codecFor } from '../storage/card/index.js';
import { fileExists, writeFileBytes } from '../storage/files.js';
import { userOwner } from '../storage/layout.js';
import { resolveWithin } from '../storage/paths.js';
import type { BlobStore } from '../storage/card/envelope.js';
import { classifyRoot } from './detect.js';
import { convertLorebook as convertMarinaraLorebook } from './marinara/lorebook.js';
import { convertPreset as convertMarinaraPreset } from './marinara/preset.js';
import { BackupReader } from './storyengine/reader.js';
import { CharxReader } from './charx/reader.js';
import { MarinaraReader } from './marinara/reader.js';
import { nameOf, PRESET_CONVERTERS, type PresetConverter } from './preset-converters.js';
import { convertCard } from './sillytavern/card.js';
import { convertLorebook } from './sillytavern/lorebook.js';
import { SillyTavernReader } from './sillytavern/reader.js';
import type { FileSource, ImportCandidate, SourceReader, SourceRefusal } from './source.js';

/**
 * Reads a root, writes what it finds, and returns the review
 * ([P4 §1.3](../../../../docs/design/workplan/16-p4-implementation.md)).
 *
 * **The pre-flight survey is separate from the reading, and that ordering is the
 * whole safety property**: a refusal after the first object is written is a
 * half-import, which is worse than none. So the root is classified and surveyed
 * before anything is created, and a refusal returns with the library untouched.
 *
 * **Import commits immediately and the review reports loudly** (§1.4). There is
 * no staging area — a second library to maintain — and dangling references are
 * survivable, visible and non-blocking by stance ([00 §3.3]), so nothing has to
 * be fixed before commit for the library to be safe.
 */

export class ImportNotImplementedError extends Error {
  constructor(what: string) {
    super(`${what} is not read by this build yet.`);
    this.name = 'ImportNotImplementedError';
  }
}

export interface SweepRequest {
  library: LibraryContext;
  /** Whose library the objects land in. */
  handle: string;
  /** The root, already opened as a source. Transport is the caller's business. */
  files: FileSource;
  /** Identifies the review; the sweep job's id in a real run. */
  jobId?: string;
  /**
   * What a re-import does when the file has changed ([P4 §1.3]).
   *
   * `replace` is the default because it is the safe one: the write goes through
   * `update()` and history snapshots the state it replaced, so a person's own
   * edits become a version rather than a loss. `keep-both` doubles deliberately
   * and says so; `skip` writes nothing and reports the difference.
   */
  onConflict?: ConflictPolicy;
  /**
   * Which account's subtree a backup root is read for —
   * [P12.8](../../../../docs/design/workplan/29-p12-implementation.md).
   *
   * **Only one source reads it**, exactly as `asKind` below is read by one.
   * An install archive holds several accounts and *which of them are you
   * importing* is a fact about the request rather than about the archive, so
   * the reader is told. Absent means `handle` — a person importing their own.
   */
  fromHandle?: string;
  /**
   * Which kind a source with a genuine choice should become.
   *
   * **Optional, and only one format reads it.** Aventuras' `VaultScenario` is
   * the conflated object [04 §6] names, and unconflating it is a reading of the
   * file rather than a fact about it — so the reading is the caller's to make
   * and `treatment` is what it defaults to. Every other format ignores this:
   * a card is an Actor and a world file is a Lorebook, and a request that
   * carried an answer for them would be carrying an answer to no question.
   *
   * Absent on a folder sweep, which is the right shape rather than an omission:
   * §1.4 commits a sweep first and reports after, so there is nobody to ask, and
   * the default is the one a person would have picked.
   */
  destination?: ImportDestination;
  /**
   * ***The name the root arrived under***, when it arrived as one file: an
   * uploaded archive's filename, never a path ([21 §4.1.1]). A CHARX is
   * identified by it (see `CharxReader`); every other source ignores it.
   */
  rootName?: string;
}

export type SweepOutcome =
  | { ok: true; report: ImportReport }
  /** Refused before anything was written, which is the only safe way to refuse. */
  | { ok: false; refusal: SourceRefusal };

export async function sweep(request: SweepRequest): Promise<SweepOutcome> {
  const classification = await classifyRoot(request.files);
  if (!classification.ok) {
    return { ok: false, refusal: classification.refusal };
  }

  const reader = readerFor(
    classification.kind,
    request.files,
    request.fromHandle ?? request.handle,
    request.rootName,
  );
  if (reader === null) {
    throw new ImportNotImplementedError(`a ${classification.kind} root`);
  }

  const survey = await reader.survey();
  if (!survey.ok) return { ok: false, refusal: survey.refusal };

  const items: ImportItemReport[] = [];
  const writer = new Writer(request);

  for await (const item of reader.items()) {
    if (item.outcome === 'observed') {
      items.push(item.report);
      continue;
    }
    items.push(await writer.write(item.candidate));
  }

  // Treatments are created *after* the cards that named them, because
  // deduplication needs to have seen them all first (§1.10).
  items.push(...(await writer.flushTreatments()));

  return {
    ok: true,
    report: {
      jobId: request.jobId ?? 'unsaved',
      source: classification.kind,
      items,
      counts: countBy(items),
    },
  };
}

/**
 * The sweep's engine, at the scale of one file
 * ([P4 §7.1](../../../../docs/design/workplan/16-p4-implementation.md)).
 *
 * **Exported so the upload route has no converter of its own.** It had one for
 * three stages — three preset shapes and nothing else — and the cost was two
 * arms of the same feature disagreeing about what a lorebook is. Everything the
 * sweep gives an object comes with this: the note vocabulary, re-import
 * identity, the version-history `import` attribution, scenario deduplication and
 * the portrait.
 *
 * `flushTreatments` is called here rather than left to the caller, because a
 * card that names a scenario produces **two** objects and forgetting the second
 * is a silent loss rather than an error. One candidate is therefore a list of
 * reports and not a single one — the shape tells the caller that.
 */
export async function convertOne(
  request: SweepRequest,
  candidate: ImportCandidate,
): Promise<ImportItemReport[]> {
  const writer = new Writer(request);
  const first = await writer.write(candidate);
  return [first, ...(await writer.flushTreatments())];
}

function readerFor(
  kind: string,
  files: FileSource,
  forHandle: string,
  rootName?: string,
): SourceReader | null {
  // `loose-files` is swept by the same walker: a folder of cards somebody
  // assembled by hand is the ST tree with most of it missing, and the walker
  // already reports what it does not recognise.
  if (kind === 'sillytavern') return new SillyTavernReader(files);
  // Told which root it is on, so its `default:` arm can ask the file rather
  // than the folder — see the constructor ([P4 §7.8]).
  if (kind === 'loose-files') return new SillyTavernReader(files, 'loose-files');
  if (kind === 'marinara') return new MarinaraReader(files);
  // A card in a zip rather than in a PNG chunk ([P4 §7.5]). One entry, one
  // candidate, and the same converter on the other side of it.
  if (kind === 'charx') return new CharxReader(files, rootName);
  // One of ours — [P12.8]. Told whose subtree to read, because an install
  // archive holds several and the archive does not know which was asked for.
  if (kind === 'storyengine-backup') return new BackupReader(files, forHandle);
  return null;
}

/**
 * Turns candidates into library objects.
 *
 * A class rather than a function because scenario deduplication is state that
 * spans the whole sweep — *one treatment per distinct scenario text* is not a
 * property any single card can enforce.
 */
class Writer {
  readonly #request: SweepRequest;
  /** Scenario text → the treatment it produced, and the actors that named it. */
  readonly #scenarios = new Map<
    string,
    { treatment: Treatment; actorIds: string[]; lore: string[] }
  >();

  constructor(request: SweepRequest) {
    this.#request = request;
  }

  async write(candidate: ImportCandidate): Promise<ImportItemReport> {
    /**
     * The preset formats come from a table rather than from case labels, so the
     * preview can make the same three-way choice without reaching a method whose
     * every arm ends in a store (`preset-converters.ts`). Asked before the
     * switch, not inside it, because a `case` per table key would leave the
     * table and the labels as two lists to keep in step.
     */
    const preset = PRESET_CONVERTERS[candidate.format];
    if (preset !== undefined) return this.#preset(candidate, preset);

    switch (candidate.format) {
      case 'sillytavern.card':
        return this.#card(candidate);
      case 'sillytavern.persona':
        return this.#persona(candidate);
      case 'sillytavern.lorebook':
        return this.#lorebook(candidate);

      // Marinara's are redirections rather than a second conversion: a Marinara
      // card is a V2 card, and its preset is the same prompt-manager lineage
      // [04 §8.4] was written against ([P4 §1.5]).
      case 'marinara.character':
        return this.#card(candidate);
      case 'marinara.persona':
        return this.#marinaraPersona(candidate);
      case 'marinara.lorebook':
        return this.#marinaraLorebook(candidate);
      case 'marinara.preset':
        return this.#marinaraPreset(candidate);

      // Aventuras' three single-file vault exports ([P4 §1.5]). Its *fourth*
      // path — lorebooks written as SillyTavern files — needs no arm, and has
      // not since P4.2: it arrives above, as `sillytavern.lorebook`.
      case 'aventuras.scenario':
        return this.#aventurasScenario(candidate);
      case 'aventuras.character':
        return this.#aventurasCharacter(candidate);
      case 'aventuras.lorebook':
        return this.#aventurasLorebook(candidate);

      /**
       * ***One of ours, which needs no conversion and therefore needs a
       * check*** — [P12.8]. Every other arm above turns somebody else's format
       * into one of our objects; this one is handed one and has to decide
       * whether to believe it.
       */
      case 'storyengine.object':
        return this.#native(candidate);

      default:
        return { source: candidate.source, disposition: 'unrecognised', notes: [] };
    }
  }

  /**
   * ***An object of ours, out of a backup*** — [P12.8].
   *
   * ***It validates rather than converts, and the difference is the whole
   * arm.*** A stored object arrives as `unknown` because the library is a
   * folder somebody may hand-edit ([10 §2.1]) and an archive is a file that
   * survived a disk that may have had a bad week — so *typed* and *conformant*
   * are different claims about it, which is the distinction
   * `export/writers.ts` makes going the other way. Below the guard, every field
   * is one the schema guarantees.
   *
   * ***It is deliberately not stamped as imported, and the first run of the
   * test is what settled that.***
   *
   * Every other arm calls `stampImported`, because a foreign file has no
   * provenance of its own and `originalFilename` is the only identity it will
   * ever have. A backup's contents already carry theirs — **this object was not
   * imported from anywhere, it is the one that was backed up** — and stamping
   * would rewrite two fields on the way in, so the re-encoded object would
   * never compare equal to the stored one.
   *
   * The consequence is the whole point: **importing a backup over a library it
   * came from reports `unchanged` and writes nothing**, where stamping made it
   * report `replaced` for every object and push a version into every history.
   * The first test written against this said `unchanged` and got `replaced`,
   * which is how the decision arrived.
   *
   * *Nothing is lost by not stamping*: the review row carries the archive path
   * as its `source`, and the import ledger records the job — so *where did this
   * come from* is answered by the things that exist to answer it.
   */
  async #native(candidate: ImportCandidate): Promise<ImportItemReport> {
    const checked = validate(candidate.payload);
    if (!checked.valid) return refusedItem(candidate, 'does-not-validate');

    const schemaId = schemaIdOf(candidate.payload);
    if (schemaId === null || !isKnownSchema(schemaId)) {
      return refusedItem(candidate, 'unknown-schema');
    }

    const object = candidate.payload as { id: string; name: string; provenance: Provenance };

    /**
     * ***An actor is created on the card it was archived as*** (2026-09-27).
     * The card is the portrait and carries the expressions and every embedded
     * picture as its own chunks, and the archive holds it whole; this passed
     * no pixels, so an actor brought back from a backup was written on the
     * blank 1×1 card with every `media` row naming bytes it did not have.
     * A `replace` keeps the portrait that is here and gains the archived
     * card's pictures, so the rows it writes resolve (see `update`'s
     * `extraBlobs` for why the portrait is not swapped).
     */
    let pixels: Uint8Array | null = null;
    if (schemaId === ACTOR_SCHEMA) {
      const card = await this.#request.files.read(candidate.source);
      pixels = card !== null && codecFor(card) !== null ? card : null;
    }

    const notes: ImportNote[] = [];
    const outcome = await this.store(object, schemaId, notes, pixels, undefined, true);
    if (outcome !== 'skipped' && outcome !== 'failed') {
      await this.#carryAssets(candidate, object.id, schemaId, notes);
    }
    return {
      source: candidate.source,
      disposition: Writer.dispositionOf(outcome),
      notes,
    };
  }

  /**
   * ***The object's pictures, into its folder*** — what `candidate.assets`
   * holds for a backup's folder kinds (see `BackupReader`).
   *
   * **By the name they had**, which is their digest, so the object's `media`
   * rows resolve exactly as they did, and a file already there is the same
   * bytes and is left alone. After an `unchanged` as well as a write: the
   * object matching the archive does not mean its files survived. Never after
   * a `skip`, where the object here differs and its rows may name other
   * pictures, so these would be orphans.
   */
  async #carryAssets(
    candidate: ImportCandidate,
    id: string,
    schemaId: PortableSchemaId,
    notes: ImportNote[],
  ): Promise<void> {
    if (candidate.assets === undefined || candidate.assets.length === 0) return;
    const { library, handle } = this.#request;
    try {
      const row = read(library, handle, id, schemaId);
      const root = library.layout.assetsRoot(userOwner(handle), schemaId, row.slug);
      for (const path of candidate.assets) {
        // Within the object's own folder whatever the archive calls it: the
        // source refused `..` already, and this is the door that would not
        // need it to have.
        const to = resolveWithin(root, path.slice(path.lastIndexOf('/') + 1));
        if (to === root || (await fileExists(to))) continue;
        const bytes = await this.#request.files.read(path);
        if (bytes === null) continue;
        await writeFileBytes(to, bytes);
      }
    } catch (error) {
      notes.push({
        key: 'import.file.notStored',
        params: {
          object: candidate.source,
          reason: error instanceof Error ? error.name : 'unknown',
        },
        level: 'warn',
      });
    }
  }

  async #card(candidate: ImportCandidate): Promise<ImportItemReport> {
    const converted = convertCard(candidate.payload, nameOf(candidate.source));
    if (!converted.ok) return refusedItem(candidate, converted.refusal);

    const { actor, lorebook, scenario, notes } = converted.value;

    if (lorebook !== null) {
      /**
       * ***Both ids settled before either names the other*** (2026-09-27).
       *
       * The book is scoped to the card's actor and the actor links back to
       * the book, and the converter wrote both links with ids it had just
       * minted. `identify` re-points each object to the id its earlier import
       * has here, but only as that object is stored, so on every re-import
       * the book named an actor that did not exist and the actor linked a
       * book that was never stored. Neither could compare `unchanged`, and
       * every re-sweep added two history versions per such card.
       */
      const { library, handle } = this.#request;
      const bookSource = `${candidate.source}#character_book`;
      actor.id = priorImportId(library, handle, ACTOR_SCHEMA, candidate.source) ?? actor.id;
      lorebook.id = priorImportId(library, handle, LOREBOOK_SCHEMA, bookSource) ?? lorebook.id;
      lorebook.scope = { kind: 'linked', actorIds: [actor.id] };

      // The book travelled inside the card, so its identity is the card file.
      stampImported(lorebook, bookSource);
      const stored = await this.#store(lorebook, notes);
      if (!stored) return { source: candidate.source, disposition: 'unrecognised', notes };
      // Under the id it was stored with, which *keep both* makes a new one.
      actor.lore = [{ id: lorebook.id, name: lorebook.name }];
    }

    stampImported(actor, candidate.source);
    const outcome = await this.#createActor(candidate, actor, notes);
    if (outcome === 'failed') {
      return { source: candidate.source, disposition: 'unrecognised', notes };
    }

    if (scenario !== null) this.#rememberScenario(scenario, actor.id, lorebook?.id);

    return {
      source: candidate.source,
      disposition: Writer.dispositionOf(outcome),
      objectId: actor.id,
      // The book the card carried is a second object from one file, and its
      // notes are in this same array — so it has to be findable by its own id
      // or [P5 §1.8]'s question comes back empty for the commonest kind of
      // book there is.
      ...(lorebook === null ? {} : { alsoProduced: [lorebook.id] }),
      notes,
    };
  }

  async #persona(candidate: ImportCandidate): Promise<ImportItemReport> {
    const payload = candidate.payload as { name?: unknown; description?: unknown };
    if (typeof payload.name !== 'string') return refusedItem(candidate, 'missing-field');

    // A persona is an actor — the unified card exists because two of three
    // sources regret the split ([survey §4]).
    const converted = convertCard(
      { name: payload.name, description: payload.description ?? '' },
      payload.name,
    );
    if (!converted.ok) return refusedItem(candidate, converted.refusal);

    const actor = converted.value.actor;
    actor.roles = ['persona'];

    const notes: ImportNote[] = [];
    stampImported(actor, candidate.source);
    const outcome = await this.#createActor(candidate, actor, notes);
    return {
      source: candidate.source,
      disposition: Writer.dispositionOf(outcome),
      objectId: actor.id,
      notes,
    };
  }

  /**
   * Writes an actor, with its portrait if there is a usable one.
   *
   * **A portrait that will not read costs the portrait, not the actor.** The
   * fixture corpus caught this: an avatar file that is not an image made
   * `create()` refuse the whole card, so a character was lost over its picture.
   * That is the poisoned-file rule violated one level down — one bad asset never
   * costs the object it belongs to, exactly as one bad file never aborts a
   * sweep ([21 §4.1.1]).
   */
  async #createActor(
    candidate: ImportCandidate,
    actor: Actor,
    notes: ImportNote[],
  ): Promise<string> {
    const asset = candidate.assets?.[0];
    let pixels = asset === undefined ? null : await this.#request.files.read(asset);

    /**
     * ***A portrait that will not read costs the portrait, and only that***
     * (2026-09-27). This returned here, before the expressions were read, so a
     * CHARX whose first image is a JPEG or a WebP (common from RisuAI) lost
     * every expression with it and no note said so. The actor is now written
     * on the blank card, which is what an actor without a portrait always is,
     * and the expressions go into it as they would into any other.
     */
    let portraitless = false;
    if (pixels !== null && codecFor(pixels) === null) {
      notes.push({
        key: 'import.card.portraitUnreadable',
        params: { file: asset ?? '', actor: actor.name },
        level: 'warn',
      });
      pixels = null;
      portraitless = true;
    }

    /**
     * ***Every other asset is an expression*** — [03 §5.2.2], [06 §7.2],
     * [P7.10].
     *
     * **`assets[0]` was the portrait and the rest were dropped**, which is why
     * no actor in any install could carry a sprite: a CHARX collects every
     * non-`card.json` entry ([import/charx/reader.ts]), and it arrived here and
     * went in the bin. (Marinara's `sprites/` do not reach here at all: its
     * reader carries only the avatar, and reports the sprites as waiting.)
     * [06 §7.2] has asked for sprites since the first draft and P9 declines
     * them in as many words — *"a sprite is not a rendition at 1.0… the backdrop
     * is here because it has no source anywhere else; sprites have one"*. This
     * is that source.
     *
     * ***`role: 'expression'`, and the filename stem is the `label`.***
     * [03 §5.2.2] fixes the role vocabulary and calls the embedded set *"the
     * character's visual identity — portrait source, references, a curated
     * expression set"*, which is what a `sprites/` folder is. The **name** is
     * the part with a choice in it: `EmbeddedMedia` carries both `label` and
     * `tags`, and [04 §3] draws the line — *"role — closed union. The engine
     * reads it and acts on it. tags — open. **Nothing in the engine branches on
     * them.**"* Expression selection is the engine branching on a name, so the
     * name is a `label`.
     *
     * *Counted in the review rather than done silently.* An import that
     * quietly grew a character eight pictures is a surprise; one that says it
     * did is a feature.
     */
    const rest = (candidate.assets ?? []).slice(1);
    const expressions: EmbeddedMedia[] = [];
    const blobs: BlobStore = new Map();

    for (const path of rest) {
      const bytes = await this.#request.files.read(path);
      // Unreadable or not an image: skipped, never fatal. One bad asset must
      // not cost the character it belongs to — the same rule the portrait above
      // follows, one level down again.
      const mime = mimeOf(path);
      if (bytes === null || mime === null) continue;

      /**
       * ***Ids from the file, not from the clock*** (2026-09-27), which is
       * what `identity.ts`'s `stableId` is for. They were minted fresh on every
       * conversion, so a re-upload of the same card could never compare
       * `unchanged`, and its replace wrote rows naming blobs the card on disk
       * had never held. The id comes from the path, so what points at an
       * expression survives a changed picture; the blob key comes from the
       * path and the bytes, so a changed picture is a new blob.
       */
      const digest = contentHashOf(bytes);
      const ref = stableId('expression-ref', path, digest);
      expressions.push({
        id: stableId('expression', path),
        role: 'expression',
        mime,
        digest,
        bytes: bytes.byteLength,
        ref,
        label: stemOf(path),
        tags: [],
      });
      blobs.set(ref, bytes);
    }

    if (expressions.length > 0) {
      notes.push({
        key: 'import.card.expressions',
        params: { actor: actor.name, count: String(expressions.length) },
        level: 'info',
      });
    }

    const withMedia =
      expressions.length === 0 ? actor : { ...actor, media: [...actor.media, ...expressions] };

    // The blank card, only when there are pictures to carry on it: with none,
    // no canvas at all is the same file and the path every other actor takes.
    const canvas = portraitless && blobs.size > 0 ? blankCardPixels() : pixels;
    return this.#write(withMedia, notes, canvas, blobs.size === 0 ? undefined : blobs);
  }

  async #write(
    actor: Actor,
    notes: ImportNote[],
    pixels: Uint8Array | null,
    media?: BlobStore,
  ): Promise<string> {
    return this.store(actor, ACTOR_SCHEMA, notes, pixels, media);
  }

  /**
   * Writes one converted object, through the re-import rule
   * ([P4 §1.3](../../../../docs/design/workplan/16-p4-implementation.md)).
   *
   * **Every object goes through here**, which is the point: a rule applied at
   * some call sites is a rule that doubles the library at the others. Before
   * this, the sweep wrote through `create()` alone, so a second run over the
   * same directory either collided on the global id check or quietly produced a
   * second copy of everything.
   */
  async store(
    object: { id: string; name: string; provenance: Provenance },
    schemaId: PortableSchemaId,
    notes: ImportNote[],
    pixels: Uint8Array | null = null,
    /** Media that arrived beside the card — [P7.10]. Keyed by `EmbeddedMedia.ref`. */
    media?: BlobStore,
    /**
     * ***Identified by its own id***, for an object this project wrote
     * (2026-09-27): `#native`'s, whether it came from a backup or was
     * downloaded and uploaded again. Its id is the better answer than a
     * filename, which is `identifyNative`'s whole argument.
     */
    native = this.#request.fromHandle !== undefined,
  ): Promise<'created' | 'unchanged' | 'replaced' | 'kept-both' | 'skipped' | 'failed'> {
    const { library, handle } = this.#request;
    /**
     * ***Which identity rule applies is a property of the source.***
     * `identify` keys on `Provenance.originalFilename` *"because foreign files
     * have no id we could key on"*; a backup's contents are our own objects and
     * do have one, so keying on a filename there would be throwing away the
     * better answer and keeping the workaround — and would double a library
     * whose slugs happen to differ. [P12.8].
     */
    const identity = native
      ? await identifyNative(library, handle, schemaId, object)
      : await identify(library, handle, schemaId, object);

    if (identity.kind === 'unchanged') {
      notes.push({
        key: 'import.object.unchanged',
        params: { object: object.name },
        level: 'info',
      });
      return 'unchanged';
    }

    if (identity.kind === 'changed') {
      switch (this.#request.onConflict ?? 'replace') {
        case 'skip':
          notes.push({
            key: 'import.object.differsAndKept',
            params: { object: object.name },
            level: 'warn',
          });
          return 'skipped';
        case 'keep-both':
          // A fresh id and a slug the write path suffixes for us, both named.
          object.id = uuidv7();
          notes.push({
            key: 'import.object.keptBoth',
            params: { object: object.name },
            level: 'warn',
          });
          break;
        case 'replace': {
          try {
            await update(
              library,
              handle,
              identity.id,
              object,
              identity.contentHash,
              {
                // **The `{ kind: 'import' }` attribution's first writer**, three
                // phases after the type declared it with "no writers until their
                // phases". History snapshots the replaced state, so the person's
                // own edits survive as a version rather than being destroyed.
                source: { kind: 'import', from: object.provenance.originalFilename ?? '' },
                reason: 'Replaced by a re-import',
              },
              undefined,
              schemaId === ACTOR_SCHEMA ? blobsOf(pixels, media) : undefined,
            );
            notes.push({
              key: 'import.object.replaced',
              params: { object: object.name },
              level: 'info',
            });
            return 'replaced';
          } catch (error) {
            notes.push({
              key: 'import.file.notStored',
              params: {
                object: object.name,
                reason: error instanceof Error ? error.name : 'unknown',
              },
              level: 'warn',
            });
            return 'failed';
          }
        }
      }
    }

    try {
      await create(
        library,
        handle,
        object,
        undefined,
        pixels === null
          ? undefined
          : { cardPixels: pixels, ...(media === undefined ? {} : { media }) },
      );
      return identity.kind === 'changed' ? 'kept-both' : 'created';
    } catch (error) {
      notes.push({
        key: 'import.file.notStored',
        params: { object: object.name, reason: error instanceof Error ? error.name : 'unknown' },
        level: 'warn',
      });
      return 'failed';
    }
  }

  async #marinaraPersona(candidate: ImportCandidate): Promise<ImportItemReport> {
    const item = await this.#card(candidate);
    return item;
  }

  async #marinaraLorebook(candidate: ImportCandidate): Promise<ImportItemReport> {
    const payload = candidate.payload as {
      book: unknown;
      entries: unknown[];
      folders: unknown[];
      actorIds: string[];
    };
    const converted = convertMarinaraLorebook(payload.book, payload.entries, payload.folders);
    if (!converted.ok) return refusedItem(candidate, converted.refusal);

    const { lorebook, notes } = converted.value;
    // Links resolve or dangle like any other reference ([00 §3.3]); the ids are
    // Marinara's and ours are minted fresh, so these are expected to dangle
    // until §1.3's identity work gives them somewhere to point.
    if (payload.actorIds.length > 0) {
      notes.push({
        key: 'import.lore.characterLinksDangle',
        params: { count: payload.actorIds.length },
        level: 'info',
      });
    }

    stampImported(lorebook, candidate.source);
    const outcome = await this.store(lorebook, LOREBOOK_SCHEMA, notes);
    return {
      source: candidate.source,
      disposition: Writer.dispositionOf(outcome),
      objectId: lorebook.id,
      notes,
    };
  }

  async #marinaraPreset(candidate: ImportCandidate): Promise<ImportItemReport> {
    const payload = candidate.payload as {
      preset: unknown;
      sections: unknown[];
      choiceBlocks: unknown[];
    };
    const converted = convertMarinaraPreset(payload.preset, payload.sections, payload.choiceBlocks);
    if (!converted.ok) return refusedItem(candidate, converted.refusal);

    const { preset, notes } = converted.value;
    stampImported(preset, candidate.source);
    const outcome = await this.store(preset, PRESET_SCHEMA, notes);
    return {
      source: candidate.source,
      disposition: Writer.dispositionOf(outcome),
      objectId: preset.id,
      notes,
    };
  }

  async #lorebook(candidate: ImportCandidate): Promise<ImportItemReport> {
    const converted = convertLorebook(candidate.payload, nameOf(candidate.source));
    if (!converted.ok) return refusedItem(candidate, converted.refusal);

    const { lorebook, notes } = converted.value;
    stampImported(lorebook, candidate.source);
    const outcome = await this.store(lorebook, LOREBOOK_SCHEMA, notes);
    return {
      source: candidate.source,
      disposition: Writer.dispositionOf(outcome),
      objectId: lorebook.id,
      notes,
    };
  }

  /**
   * **One file, up to four objects, and the order is the whole of the method.**
   *
   * The cast has to be stored *before* the treatment, because `identify()`
   * re-points a re-imported object to the id it already had here — so an actor's
   * id is not settled until it has been through `store()`, and a cast built from
   * the pre-store ids would point at objects that do not exist on the second
   * import. `#card` and `flushTreatments` take the same order for the same
   * reason; this one just has both halves in one method, because a scenario
   * names its own cast and a card's loose `scenario` string does not.
   */
  async #aventurasScenario(candidate: ImportCandidate): Promise<ImportItemReport> {
    const converted = convertScenario(
      candidate.payload,
      nameOf(candidate.source),
      this.#request.destination,
    );
    if (!converted.ok) return refusedItem(candidate, converted.refusal);

    const { treatment, lorebook, cast, notes } = converted.value;

    if (lorebook !== null) {
      stampImported(lorebook, candidate.source);
      const outcome = await this.store(lorebook, LOREBOOK_SCHEMA, notes);
      return {
        source: candidate.source,
        disposition: Writer.dispositionOf(outcome),
        objectId: lorebook.id,
        notes,
      };
    }
    if (treatment === null) return refusedItem(candidate, 'wrong-shape');

    const alsoProduced: string[] = [];
    for (const member of cast) {
      /**
       * **Each actor's identity is the scenario file plus their name.**
       *
       * They have no file of their own — they were rows inside one — so
       * `originalFilename` has to be something re-import will produce again from
       * the same bytes. `flushTreatments` solves the same problem for a
       * synthesised treatment by stamping the scenario text; this is the
       * `#character_book` suffix from `#card`, which is the closer precedent
       * because the object really did travel inside the file.
       */
      stampImported(member.actor, `${candidate.source}#npc:${member.actor.name}`);
      const outcome = await this.store(member.actor, ACTOR_SCHEMA, notes);
      if (outcome !== 'failed') alsoProduced.push(member.actor.id);
    }

    treatment.cast = cast
      .filter((member) => alsoProduced.includes(member.actor.id))
      .map((member) => ({
        ref: { id: member.actor.id, name: member.actor.name },
        // `npc` and not required, on `flushTreatments`' reasoning: the file said
        // these people are in this scenario and nothing more, and billing one a
        // persona option would be inventing intent the source did not express.
        billing: 'npc' as const,
        note: member.note,
      }));

    stampImported(treatment, candidate.source);
    const outcome = await this.store(treatment, TREATMENT_SCHEMA, notes);
    return {
      source: candidate.source,
      disposition: Writer.dispositionOf(outcome),
      objectId: treatment.id,
      ...(alsoProduced.length === 0 ? {} : { alsoProduced }),
      notes,
    };
  }

  async #aventurasCharacter(candidate: ImportCandidate): Promise<ImportItemReport> {
    const converted = convertCharacter(candidate.payload, nameOf(candidate.source));
    if (!converted.ok) return refusedItem(candidate, converted.refusal);

    const { actor, notes } = converted.value;
    stampImported(actor, candidate.source);
    // Through `#createActor` rather than `store` directly, so a vault character
    // that arrived in a zip beside its portrait gets the same asset handling a
    // card does. It carries none today; the path costs nothing and diverging
    // from it would have to be undone the first time one does.
    const outcome = await this.#createActor(candidate, actor, notes);
    if (outcome === 'failed') {
      return { source: candidate.source, disposition: 'unrecognised', notes };
    }
    return {
      source: candidate.source,
      disposition: Writer.dispositionOf(outcome),
      objectId: actor.id,
      notes,
    };
  }

  async #aventurasLorebook(candidate: ImportCandidate): Promise<ImportItemReport> {
    const converted = convertAventurasLorebook(candidate.payload, nameOf(candidate.source));
    if (!converted.ok) return refusedItem(candidate, converted.refusal);

    const { lorebook, notes } = converted.value;
    stampImported(lorebook, candidate.source);
    const outcome = await this.store(lorebook, LOREBOOK_SCHEMA, notes);
    return {
      source: candidate.source,
      disposition: Writer.dispositionOf(outcome),
      objectId: lorebook.id,
      notes,
    };
  }

  async #preset(candidate: ImportCandidate, convert: PresetConverter): Promise<ImportItemReport> {
    const converted = convert(candidate.payload, nameOf(candidate.source));
    if (!converted.ok) return refusedItem(candidate, converted.refusal);

    const preset = stampImported(converted.value.preset, candidate.source);
    const outcome = await this.store(preset, PRESET_SCHEMA, converted.value.notes);
    return {
      source: candidate.source,
      disposition: Writer.dispositionOf(outcome),
      objectId: preset.id,
      notes: converted.value.notes,
    };
  }

  /**
   * **A Treatment per distinct scenario text, created eagerly** ([P4 §1.10]).
   *
   * *"Offered as a new Treatment draft"* ([03 §2.7]) becomes *created and
   * reported* under §1.4's post-hoc posture: there is no staging area to offer
   * anything into, and a three-hundred-card sweep gated per-card on a human is
   * not a review, it is a chore.
   *
   * Identical text dedupes, which is the only thing that makes this bearable —
   * a pack of twelve cards sharing one premise produces one treatment with
   * twelve actors in its cast, not twelve treatments saying the same thing.
   */
  #rememberScenario(scenario: string, actorId: string, loreId: string | undefined): void {
    const held = this.#scenarios.get(scenario);
    if (held !== undefined) {
      held.actorIds.push(actorId);
      if (loreId !== undefined) held.lore.push(loreId);
      return;
    }

    const treatment = newTreatment(`Scenario: ${scenario.slice(0, 60)}`);
    treatment.framing = scenario;
    this.#scenarios.set(scenario, {
      treatment,
      actorIds: [actorId],
      lore: loreId === undefined ? [] : [loreId],
    });
  }

  async flushTreatments(): Promise<ImportItemReport[]> {
    const reports: ImportItemReport[] = [];
    for (const [, held] of this.#scenarios) {
      const { treatment, actorIds, lore } = held;
      // `npc` and not required: the card said this character appears in this
      // scenario, and nothing more. Billing them as a persona option or making
      // the lore required would be inventing intent the source did not express.
      treatment.cast = actorIds.map((id) => ({
        ref: { id, name: '' },
        billing: 'npc' as const,
        note: '',
      }));
      treatment.lore = lore.map((id) => ({ ref: { id, name: '' }, required: false }));

      const notes: ImportNote[] = [
        {
          key: 'import.card.treatmentCreated',
          params: { treatment: treatment.name, actors: actorIds.length },
          level: 'info',
        },
      ];

      // A treatment has no source file of its own — it is synthesised from the
      // scenario text several cards shared — so its `originalFilename` is that
      // text's identity rather than a path. Which makes re-import work for it
      // too: the same scenario on a second sweep finds the treatment it made.
      stampImported(treatment, `scenario:${treatment.framing.slice(0, 120)}`);
      const outcome = await this.store(treatment, TREATMENT_SCHEMA, notes);
      reports.push({
        source: treatment.name,
        disposition: Writer.dispositionOf(outcome),
        objectId: treatment.id,
        notes,
      });
    }
    return reports;
  }

  async #store(lorebook: Lorebook, notes: ImportNote[]): Promise<boolean> {
    return (await this.store(lorebook, LOREBOOK_SCHEMA, notes)) !== 'failed';
  }

  /** `created` and `unchanged` are different rows in the review, so map them. */
  static dispositionOf(outcome: string): ImportItemReport['disposition'] {
    if (outcome === 'unchanged' || outcome === 'skipped') return 'unchanged';
    return outcome === 'failed' ? 'unrecognised' : 'converted';
  }
}

/**
 * Every picture an incoming card brings: the ones inside it, then the ones
 * that arrived beside it over them, the order `encodeObject` merges in.
 *
 * A card this build cannot read contributes nothing rather than failing the
 * write. It is the portrait the replace keeps from disk anyway, and the rows
 * that named its blobs are the only loss, which is the loss there was before.
 */
function blobsOf(pixels: Uint8Array | null, media: BlobStore | undefined): BlobStore | undefined {
  let inside: BlobStore | undefined;
  if (pixels !== null) {
    try {
      inside = codecFor(pixels)?.read(pixels).blobs;
    } catch {
      inside = undefined;
    }
  }
  if (inside === undefined) return media;
  if (media === undefined) return inside;
  return new Map([...inside, ...media]);
}

function refusedItem(candidate: ImportCandidate, refusal: string): ImportItemReport {
  return {
    source: candidate.source,
    disposition: 'unrecognised',
    notes: [
      {
        key: 'import.file.refused',
        params: { file: candidate.source, refusal },
        level: 'warn',
      },
    ],
  };
}

function countBy(items: readonly ImportItemReport[]): Record<ImportDisposition, number> {
  const counts: Record<ImportDisposition, number> = {
    converted: 0,
    credential: 0,
    recorded: 0,
    'by-position': 0,
    skipped: 0,
    unchanged: 0,
    unrecognised: 0,
  };
  for (const item of items) counts[item.disposition] += 1;
  return counts;
}

/**
 * An image's media type from its extension — [P7.10].
 *
 * **Extension and not magic**, which is the opposite of `codecFor` above it and
 * is right for this: the portrait has to be a *card*, so what it really is
 * decides; an expression is just a picture the browser will render, and what it
 * is called is what the `content-type` header has to say. **A file this list
 * does not know is skipped** rather than guessed at — an unnamed type in a
 * `content-type` is a download prompt where a face should be.
 */
function mimeOf(path: string): string | null {
  const dot = path.lastIndexOf('.');
  const extension = dot === -1 ? '' : path.slice(dot + 1).toLowerCase();
  switch (extension) {
    case 'png':
      return 'image/png';
    case 'jpg':
    case 'jpeg':
      return 'image/jpeg';
    case 'webp':
      return 'image/webp';
    case 'gif':
      return 'image/gif';
    default:
      return null;
  }
}

/**
 * The filename without its directory or extension — `sprites/neutral.png` reads
 * as `neutral`.
 *
 * *This is the expression's name*, and it comes from the filename because that
 * is where both source programs put it: [03 §5.2]'s own layout sketch is
 * `sprites/{neutral,angry,…}.png`. A person who wants a different word renames
 * the file, which is the affordance the format already has.
 */
function stemOf(path: string): string {
  const name = path.split('/').at(-1) ?? path;
  const dot = name.lastIndexOf('.');
  return dot === -1 ? name : name.slice(0, dot);
}
