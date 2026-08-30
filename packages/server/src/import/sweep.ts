// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import {
  newTreatment,
  type ImportDisposition,
  type ImportItemReport,
  type ImportNote,
  type ImportReport,
  type Lorebook,
  type Treatment,
} from '@storyengine/shared';

import { create, type LibraryContext } from '../library.js';
import { classifyRoot } from './detect.js';
import { convertCard } from './sillytavern/card.js';
import { convertLorebook } from './sillytavern/lorebook.js';
import { convertChatCompletionPreset } from './sillytavern/preset.js';
import { SillyTavernReader } from './sillytavern/reader.js';
import { convertSyspromptPreset } from './sillytavern/sysprompt.js';
import { convertTextCompletionPreset } from './sillytavern/text-completion.js';
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

function readerFor(kind: string, files: FileSource): SourceReader | null {
  // `loose-files` is swept by the same walker: a folder of cards somebody
  // assembled by hand is the ST tree with most of it missing, and the walker
  // already reports what it does not recognise.
  if (kind === 'sillytavern' || kind === 'loose-files') return new SillyTavernReader(files);
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
    switch (candidate.format) {
      case 'sillytavern.card':
        return this.#card(candidate);
      case 'sillytavern.persona':
        return this.#persona(candidate);
      case 'sillytavern.lorebook':
        return this.#lorebook(candidate);
      case 'sillytavern.preset.chat':
        return this.#preset(candidate, convertChatCompletionPreset);
      case 'sillytavern.preset.sysprompt':
        return this.#preset(candidate, convertSyspromptPreset);
      case 'sillytavern.preset.text':
        return this.#preset(candidate, convertTextCompletionPreset);
      default:
        return { source: candidate.source, disposition: 'unrecognised', notes: [] };
    }
  }

  async #card(candidate: ImportCandidate): Promise<ImportItemReport> {
    const converted = convertCard(candidate.payload, nameOf(candidate.source));
    if (!converted.ok) return refusedItem(candidate, converted.refusal);

    const { actor, lorebook, scenario, notes } = converted.value;

    if (lorebook !== null) {
      const stored = await this.#store(lorebook, notes);
      if (!stored) return { source: candidate.source, disposition: 'unrecognised', notes };
    }

    const pixels = candidate.assets?.[0]
      ? await this.#request.files.read(candidate.assets[0])
      : null;

    try {
      await create(
        this.#request.library,
        this.#request.handle,
        actor,
        undefined,
        pixels ? { cardPixels: pixels } : undefined,
      );
    } catch {
      return { source: candidate.source, disposition: 'unrecognised', notes };
    }

    if (scenario !== null) this.#rememberScenario(scenario, actor.id, lorebook?.id);

    return { source: candidate.source, disposition: 'converted', objectId: actor.id, notes };
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

    const pixels = candidate.assets?.[0]
      ? await this.#request.files.read(candidate.assets[0])
      : null;

    try {
      await create(
        this.#request.library,
        this.#request.handle,
        actor,
        undefined,
        pixels ? { cardPixels: pixels } : undefined,
      );
    } catch {
      return { source: candidate.source, disposition: 'unrecognised', notes: [] };
    }
    return { source: candidate.source, disposition: 'converted', objectId: actor.id, notes: [] };
  }

  async #lorebook(candidate: ImportCandidate): Promise<ImportItemReport> {
    const converted = convertLorebook(candidate.payload, nameOf(candidate.source));
    if (!converted.ok) return refusedItem(candidate, converted.refusal);

    const { lorebook, notes } = converted.value;
    const stored = await this.#store(lorebook, notes);
    if (!stored) return { source: candidate.source, disposition: 'unrecognised', notes };
    return { source: candidate.source, disposition: 'converted', objectId: lorebook.id, notes };
  }

  async #preset(
    candidate: ImportCandidate,
    convert: (
      input: unknown,
      name: string,
    ) =>
      | { ok: true; value: { preset: unknown; notes: ImportNote[] } }
      | { ok: false; refusal: string },
  ): Promise<ImportItemReport> {
    const converted = convert(candidate.payload, nameOf(candidate.source));
    if (!converted.ok) return refusedItem(candidate, converted.refusal);

    const preset = converted.value.preset as { id: string };
    try {
      await create(this.#request.library, this.#request.handle, preset);
    } catch {
      return {
        source: candidate.source,
        disposition: 'unrecognised',
        notes: converted.value.notes,
      };
    }
    return {
      source: candidate.source,
      disposition: 'converted',
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

      try {
        await create(this.#request.library, this.#request.handle, treatment);
        reports.push({
          source: treatment.name,
          disposition: 'converted',
          objectId: treatment.id,
          notes,
        });
      } catch {
        reports.push({ source: treatment.name, disposition: 'unrecognised', notes });
      }
    }
    return reports;
  }

  async #store(lorebook: Lorebook, notes: ImportNote[]): Promise<boolean> {
    try {
      await create(this.#request.library, this.#request.handle, lorebook);
      return true;
    } catch {
      notes.push({
        key: 'import.file.notStored',
        params: { object: lorebook.name },
        level: 'warn',
      });
      return false;
    }
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

/** A file's own name, without directory or extension — what ST names things by. */
function nameOf(source: string): string {
  const base = source.split('/').pop() ?? source;
  return base.replace(/\.[^.]+$/, '') || 'Imported';
}

function countBy(items: readonly ImportItemReport[]): Record<ImportDisposition, number> {
  const counts: Record<ImportDisposition, number> = {
    converted: 0,
    credential: 0,
    recorded: 0,
    'by-position': 0,
    skipped: 0,
    unrecognised: 0,
  };
  for (const item of items) counts[item.disposition] += 1;
  return counts;
}
