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
  type ImportItemReport,
  type ImportNote,
  type ImportReport,
  type Actor,
  type Lorebook,
  type Treatment,
} from '@storyengine/shared';

import { identify, stampImported, type ConflictPolicy } from './identity.js';
import { create, update, type LibraryContext } from '../library.js';
import { codecFor } from '../storage/card/index.js';
import { classifyRoot } from './detect.js';
import { convertLorebook as convertMarinaraLorebook } from './marinara/lorebook.js';
import { convertPreset as convertMarinaraPreset } from './marinara/preset.js';
import { CharxReader } from './charx/reader.js';
import { MarinaraReader } from './marinara/reader.js';
import { nameOf, PRESET_CONVERTERS, type PresetConverter } from './preset-converters.js';
import { convertCard } from './sillytavern/card.js';
import { convertLorebook } from './sillytavern/lorebook.js';
import { SillyTavernReader } from './sillytavern/reader.js';
import type { FileSource, ImportCandidate, SourceReader, SourceRefusal } from './source.js';

/**
 * Reads a root, writes what it finds, and returns the review
 * ([P4 §1.3](../../../../docs/design/workplan/06-p4-implementation.md)).
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

  const reader = readerFor(classification.kind, request.files);
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
 * ([P4 §7.1](../../../docs/design/workplan/06-p4-implementation.md)).
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

function readerFor(kind: string, files: FileSource): SourceReader | null {
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
  if (kind === 'charx') return new CharxReader(files);
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
      // [10 §8.4] was written against ([P4 §1.5]).
      case 'marinara.character':
        return this.#card(candidate);
      case 'marinara.persona':
        return this.#marinaraPersona(candidate);
      case 'marinara.lorebook':
        return this.#marinaraLorebook(candidate);
      case 'marinara.preset':
        return this.#marinaraPreset(candidate);
      default:
        return { source: candidate.source, disposition: 'unrecognised', notes: [] };
    }
  }

  async #card(candidate: ImportCandidate): Promise<ImportItemReport> {
    const converted = convertCard(candidate.payload, nameOf(candidate.source));
    if (!converted.ok) return refusedItem(candidate, converted.refusal);

    const { actor, lorebook, scenario, notes } = converted.value;

    if (lorebook !== null) {
      // The book travelled inside the card, so its identity is the card file.
      stampImported(lorebook, `${candidate.source}#character_book`);
      const stored = await this.#store(lorebook, notes);
      if (!stored) return { source: candidate.source, disposition: 'unrecognised', notes };
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
   * sweep ([13 §4.1.1]).
   */
  async #createActor(
    candidate: ImportCandidate,
    actor: Actor,
    notes: ImportNote[],
  ): Promise<string> {
    const asset = candidate.assets?.[0];
    const pixels = asset === undefined ? null : await this.#request.files.read(asset);

    if (pixels !== null && codecFor(pixels) === null) {
      notes.push({
        key: 'import.card.portraitUnreadable',
        params: { file: asset ?? '', actor: actor.name },
        level: 'warn',
      });
      return this.#write(actor, notes, null);
    }
    return this.#write(actor, notes, pixels);
  }

  async #write(actor: Actor, notes: ImportNote[], pixels: Uint8Array | null): Promise<string> {
    return this.store(actor, ACTOR_SCHEMA, notes, pixels);
  }

  /**
   * Writes one converted object, through the re-import rule
   * ([P4 §1.3](../../../../docs/design/workplan/06-p4-implementation.md)).
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
  ): Promise<'created' | 'unchanged' | 'replaced' | 'kept-both' | 'skipped' | 'failed'> {
    const { library, handle } = this.#request;
    const identity = await identify(library, handle, schemaId, object);

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
            await update(library, handle, identity.id, object, identity.contentHash, {
              // **The `{ kind: 'import' }` attribution's first writer**, three
              // phases after the type declared it with "no writers until their
              // phases". History snapshots the replaced state, so the person's
              // own edits survive as a version rather than being destroyed.
              source: { kind: 'import', from: object.provenance.originalFilename ?? '' },
              reason: 'Replaced by a re-import',
            });
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
        pixels === null ? undefined : { cardPixels: pixels },
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
   * *"Offered as a new Treatment draft"* ([02 §2.7]) becomes *created and
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
