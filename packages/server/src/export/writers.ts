// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import {
  ACTOR_SCHEMA,
  CONVENTIONAL_SECTION_IDS,
  LOREBOOK_SCHEMA,
  TREATMENT_SCHEMA,
  exportFormat,
  validate,
  type Actor,
  type ImportNote,
  type Lorebook,
  type LoreEntry,
  type Treatment,
} from '@storyengine/shared';

/**
 * ***The library's first foreign-format writers*** —
 * [00 §2.4](../../../../docs/design/00-stance.md),
 * [P4 §1.5](../../../../docs/design/workplan/16-p4-implementation.md).
 *
 * **Until now *nothing is lost and re-export is possible* had no re-export to
 * test it.** The promise was kept by *preservation* — `compat`, `metadata`, the
 * unknown-field rule [04 §2] makes load-bearing — which is what makes a writer
 * possible rather than what makes one exist. These are the first files this
 * build produces in somebody else's format, and the first time the claim is
 * checkable rather than argued.
 *
 * **Every writer here loses something, and that is the definition rather than a
 * defect.** A converter that lost nothing would be a copy. What each one is
 * obliged to do is *say* what it lost, in the same `{ key, params }` vocabulary
 * the import review uses — because the surface offering the download is the only
 * place a person will ever be told.
 *
 * **Pure and I/O-free**, on the fence `source.ts` puts around the import
 * converters: a writer takes an object and a resolver and returns a document.
 * Reading the library and writing a response are the route's.
 *
 * **Each writer validates before it trusts, and the defensive alternative is
 * worse than it looks.** A stored object arrives as `unknown` — the library is a
 * folder of JSON somebody may hand-edit, which [10 §2.1] makes a feature — so
 * *typed* and *conformant* are different claims about it. Guarding every read
 * with `?.` produces a writer that cheerfully emits a file with six empty fields
 * instead of saying the object is broken. So each one runs the object past the
 * same `validate()` the write path uses, returns `null` when it fails, and
 * everything below that guard is a field the schema guarantees.
 */

/** Dereferences a `Ref` the object carries. Anything at all, or nothing. */
export type Resolve = (id: string) => unknown;

export interface WrittenExport {
  body: unknown;
  /** What this file does not carry. Rendered beside the download, never stored. */
  notes: ImportNote[];
  /** The filename stem, before the format's extension. */
  name: string;
}

export type ExportWriter = (object: unknown, resolve: Resolve) => WrittenExport | null;

const note = (
  key: string,
  params: ImportNote['params'],
  level: ImportNote['level'] = 'info',
): ImportNote => ({ key, params, level });

/**
 * **One table, and the ids in it are the ids in `EXPORT_FORMATS`.**
 *
 * The shared table says a format exists and what it accepts; this says how to
 * write one. Split that way because the client needs the first half to build a
 * menu and must never have the second — the division `PRESET_CONVERTERS` makes
 * beside the format strings the import probe emits.
 */
export const EXPORT_WRITERS: Readonly<Record<string, ExportWriter>> = {
  'aventuras.scenario': writeAventurasScenario,
  'aventuras.character': writeAventurasCharacter,
  'aventuras.lorebook': writeAventurasLorebook,
  'sillytavern.card': writeSillyTavernCard,
};

/**
 * The writer for a format, checked against what that format accepts.
 *
 * **Both questions, because either answer alone is the wrong one.** An unknown
 * id is a 404; a known id aimed at the wrong kind is a 409. Settling it here
 * rather than inside a writer is what lets each writer assume its own shape.
 */
export function writerFor(
  formatId: string,
  schemaId: string,
): ExportWriter | 'unknown-format' | 'wrong-kind' {
  const format = exportFormat(formatId);
  if (format === null) return 'unknown-format';
  if (format.accepts !== schemaId) return 'wrong-kind';
  const writer = EXPORT_WRITERS[formatId];
  // A row in the shared table with no writer behind it is a build error rather
  // than a request error, and `writers.test.ts` fails on it before a user can.
  return writer ?? 'unknown-format';
}

// ── Treatment → Aventuras VaultScenario ─────────────────────────────────────

/**
 * A `Treatment` written as Aventuras' own scenario export.
 *
 * **The faithful one, and the one Aventuras cannot read back.** Its scenario
 * import routes every uploaded file through the character-card pipeline
 * (`VaultPanel.svelte` → `scenarioVault.importFromFile` → `_processFileImport`)
 * and never sniffs for a `VaultScenario`, so this is an archival and interchange
 * artifact. `EXPORT_FORMATS` carries `roundTrips: false` and the surface says
 * so; writing a worse file to make that sentence nicer would be the wrong
 * repair.
 *
 * **What it is unambiguously good for is the other direction.** We import this
 * shape, so a treatment written here comes back whole — and that closed loop is
 * the sharpest test [00 §2.4]'s promise has ever had.
 */
function writeAventurasScenario(object: unknown, resolve: Resolve): WrittenExport | null {
  const treatment = asTreatment(object);
  if (treatment === null) return null;

  const notes: ImportNote[] = [];
  const npcs: unknown[] = [];
  let dangling = 0;

  for (const member of treatment.cast) {
    const actor = asActor(resolve(member.ref.id));
    if (actor === null) {
      dangling += 1;
      continue;
    }
    npcs.push({
      name: actor.name,
      /**
       * A `CastEntry.note` is *"how this character is used in this treatment"*,
       * which is the job Aventuras splits across `role` and `relationship`.
       * Splitting it back would be guessing at a seam the note never had, so it
       * goes to `role` whole and `relationship` stays empty — and the importer
       * rejoins them with the same separator, so the round trip is clean.
       */
      role: member.note,
      description: sectionBody(actor, CONVENTIONAL_SECTION_IDS.summary),
      relationship: '',
      traits: actor.profile.traits,
    });
  }

  if (dangling > 0) notes.push(note('export.cast.unresolved', { count: dangling }, 'warn'));

  const openings = treatment.openings.written;
  const primary =
    openings.find((opening) => opening.id === treatment.openings.primaryWrittenId) ?? openings[0];
  const alternates = openings.filter((opening) => opening.id !== primary?.id);

  if (treatment.hooks.length > 0) {
    // A scenario has nowhere to put a hook pool, and a plot hook is authored
    // content rather than tuning — a real loss, so it gets a count.
    notes.push(note('export.aventuras.hooksDropped', { count: treatment.hooks.length }, 'warn'));
  }
  if (treatment.lore.length > 0) {
    // Aventuras keeps a scenario's lorebook as a *separate* vault record and
    // cross-references it by id, so there is no field here to hold one even
    // when we have one. Its `linkedLorebookId` is the mirror of this loss, and
    // the importer warns about the same gap coming the other way.
    notes.push(note('export.aventuras.loreNotCarried', { count: treatment.lore.length }, 'warn'));
  }

  const now = Date.now();
  return {
    name: treatment.name,
    notes,
    body: {
      id: treatment.id,
      name: treatment.name,
      // [03 §4] aligns these two by name in the other direction; this is that
      // mapping run backwards, and it is why the round trip closes.
      description: treatment.blurb,
      settingSeed: treatment.framing,
      npcs,
      primaryCharacterName: firstName(npcs),
      firstMessage: primary?.text ?? null,
      alternateGreetings: alternates.map((opening) => opening.text),
      tags: treatment.tags,
      favorite: false,
      source: 'import',
      originalFilename: treatment.provenance.originalFilename,
      metadata: {
        npcCount: npcs.length,
        alternateGreetingsCount: alternates.length,
        hasFirstMessage: primary !== undefined,
      },
      createdAt: epoch(treatment.provenance.createdAt, now),
      updatedAt: epoch(treatment.provenance.updatedAt, now),
    },
  };
}

// ── Treatment → SillyTavern V2 card ─────────────────────────────────────────

/**
 * A `Treatment` written as a `chara_card_v2`.
 *
 * **The lossy one, and the only one that travels.** Aventuras' scenario import
 * eats character cards, and so does everything else in this ecosystem — so this
 * is the file a person actually hands to another application. It sits beside
 * the faithful format rather than instead of it, because the trade (faithful and
 * archival, or lossy and usable) is the person's to make and not ours.
 *
 * **A card names one character and a treatment names a cast**, which is the loss
 * that cannot be engineered away: `data.name` takes the first cast member and
 * the review says how many were left behind. That asymmetry is exactly why
 * [04 §6] keeps the two kinds apart — it arrives as a cost at the boundary
 * rather than as a cost in the model, which is the trade that section makes.
 */
function writeSillyTavernCard(object: unknown, resolve: Resolve): WrittenExport | null {
  const treatment = asTreatment(object);
  if (treatment === null) return null;

  const notes: ImportNote[] = [];
  const cast = treatment.cast
    .map((member) => asActor(resolve(member.ref.id)))
    .filter((actor): actor is Actor => actor !== null);

  const lead = cast[0];
  if (lead === undefined) {
    // Not a refusal: a card with no character is still a readable premise, and
    // refusing here would make a treatment with an unresolved cast unexportable.
    notes.push(note('export.card.noCastMember', { treatment: treatment.name }, 'warn'));
  }
  if (cast.length > 1) {
    notes.push(note('export.card.castNarrowed', { count: cast.length - 1 }, 'warn'));
  }

  const openings = treatment.openings.written;
  const primary =
    openings.find((opening) => opening.id === treatment.openings.primaryWrittenId) ?? openings[0];

  return {
    name: treatment.name,
    notes,
    body: {
      spec: 'chara_card_v2',
      spec_version: '2.0',
      data: {
        name: lead?.name ?? treatment.name,
        description: lead === undefined ? '' : sectionBody(lead, CONVENTIONAL_SECTION_IDS.summary),
        personality: lead === undefined ? '' : lead.profile.traits.join(', '),
        // The field this whole conversion turns on: a card's `scenario` is read
        // back into a treatment's `framing` by `convertCard`, so the pair closes
        // on the one thing that matters.
        scenario: treatment.framing,
        first_mes: primary?.text ?? '',
        mes_example: '',
        alternate_greetings: openings
          .filter((opening) => opening.id !== primary?.id)
          .map((opening) => opening.text),
        creator_notes: treatment.blurb,
        tags: treatment.tags,
        creator: treatment.provenance.creator,
        character_version: '',
      },
    },
  };
}

// ── Actor → Aventuras VaultCharacter ────────────────────────────────────────

function writeAventurasCharacter(object: unknown): WrittenExport | null {
  const actor = asActor(object);
  if (actor === null) return null;

  const notes: ImportNote[] = [];
  const extra = actor.profile.sections.filter(
    (section) => section.id !== CONVENTIONAL_SECTION_IDS.summary && section.body.trim().length > 0,
  );

  if (extra.length > 0) {
    /**
     * A `VaultCharacter` has one `description` where an Actor has a list of
     * sections, so everything past the summary is folded in rather than dropped
     * — and the review names the sections, because *your appearance and your
     * voice are now one paragraph* is something to know **before** sending the
     * file rather than after.
     */
    notes.push(
      note('export.aventuras.sectionsFolded', {
        sections: extra.map((section) => section.title).join(', '),
        count: extra.length,
      }),
    );
  }

  const description = [
    sectionBody(actor, CONVENTIONAL_SECTION_IDS.summary),
    ...extra.map((section) => `${section.title}\n${section.body}`),
  ]
    .filter((part) => part.trim().length > 0)
    .join('\n\n');

  const now = Date.now();
  return {
    name: actor.name,
    notes,
    body: {
      id: actor.id,
      name: actor.name,
      description,
      traits: actor.profile.traits,
      // The same seven optional keys on both sides — ours was taken from theirs
      // — so this is a copy, and `aventuras/character.ts` reads it back unchanged.
      visualDescriptors: actor.profile.visual ?? {},
      portrait: null,
      tags: actor.tags,
      favorite: false,
      source: 'import',
      originalStoryId: null,
      metadata: {},
      createdAt: epoch(actor.provenance.createdAt, now),
      updatedAt: epoch(actor.provenance.updatedAt, now),
    },
  };
}

// ── Lorebook → Aventuras Entry[] ────────────────────────────────────────────

/**
 * A `Lorebook` written as Aventuras' native `Entry[]`.
 *
 * **The one format here that genuinely round-trips into Aventuras**, and the
 * only reason it does is that their lorebook importer sniffs for this shape
 * (`isAventuraFormat`, `import/parse.ts`) where their scenario importer sniffs
 * for nothing. `roundTrips: true` in the shared table is a fact read off their
 * source rather than a hope about it.
 */
function writeAventurasLorebook(object: unknown): WrittenExport | null {
  const lorebook = asLorebook(object);
  if (lorebook === null) return null;

  const notes: ImportNote[] = [];
  const gated = lorebook.entries.filter((entry) => entry.folderId !== null).length;

  if (gated > 0) {
    /**
     * **Folders do not survive, and this is the loss worth naming loudest.**
     *
     * [11 §2] calls a folder gate *a variant switch* — the mechanism that lets
     * one book hold *does this timeline contain X* without forking a copy — and
     * Aventuras' `Entry` has no folder at all. The entries come across; the
     * structure over them does not. Worse in the quiet way: an entry inside a
     * shut folder carries its own `enabled`, which [04 §5] preserves rather than
     * mutates, so **a gated-off entry exports as on**.
     */
    notes.push(note('export.aventuras.foldersDropped', { count: gated }, 'warn'));
  }

  return { name: lorebook.name, notes, body: lorebook.entries.map(entryOf) };
}

const AVENTURAS_TYPES = new Set(['character', 'location', 'item', 'faction', 'concept', 'event']);

function entryOf(entry: LoreEntry): unknown {
  return {
    id: entry.id,
    storyId: '',
    name: entry.name,
    // Their `EntryType` is a closed union of six and our `tag` is an open string
    // — [03 §3.4] chose the open one naming theirs as the counter-example — so
    // an unrecognised tag becomes `concept`, their widest arm and the fallback
    // their own importer uses.
    type: AVENTURAS_TYPES.has(entry.tag ?? '') ? entry.tag : 'concept',
    description: entry.content,
    hiddenInfo: hiddenInfoOf(entry),
    aliases: entry.secondaryKeys,
    injection: {
      mode: entry.constant ? 'always' : entry.enabled ? 'keyword' : 'never',
      keywords: entry.keys,
      // Inverted back, the way `aventuras/lorebook.ts` inverts it on the way in:
      // theirs is *higher = inject first*, ours is *lower = earlier*.
      priority: 1000 - entry.order,
    },
  };
}

/**
 * Round-trips the `hiddenInfo` the importer parked in `metadata`.
 *
 * It has no field of ours because `content` is injected — a secret there leaks
 * into the prompt — and `description` is read by a router step and never shown,
 * which would hide a secret somewhere nobody looks for one. Reading it back out
 * here is what makes that a parking space rather than a grave.
 */
function hiddenInfoOf(entry: LoreEntry): string | null {
  const held = entry.metadata['hiddenInfo'];
  return typeof held === 'string' && held.length > 0 ? held : null;
}

// ── Shared ──────────────────────────────────────────────────────────────────

/**
 * Is this stored object the kind it is about to be read as?
 *
 * Both halves matter. The `schema` has to be the one expected — a cast ref
 * pointing at a lorebook id would otherwise be read as an `Actor` — and it has
 * to *validate*, because the folder is the object and somebody may have edited
 * it by hand ([10 §2.1] makes that a feature rather than a hazard to design
 * away, which puts the checking here).
 */
function conformant(value: unknown, schemaId: string): boolean {
  if (typeof value !== 'object' || value === null) return false;
  if ((value as { schema?: unknown }).schema !== schemaId) return false;
  return validate(value).valid;
}

const asActor = (value: unknown): Actor | null =>
  conformant(value, ACTOR_SCHEMA) ? (value as Actor) : null;

const asTreatment = (value: unknown): Treatment | null =>
  conformant(value, TREATMENT_SCHEMA) ? (value as Treatment) : null;

const asLorebook = (value: unknown): Lorebook | null =>
  conformant(value, LOREBOOK_SCHEMA) ? (value as Lorebook) : null;

function sectionBody(actor: Actor, id: string): string {
  return actor.profile.sections.find((section) => section.id === id)?.body ?? '';
}

function firstName(npcs: readonly unknown[]): string {
  const first = npcs[0];
  return typeof first === 'object' && first !== null ? (first as { name: string }).name : '';
}

/** An ISO `Provenance` timestamp as Aventuras' epoch milliseconds. */
function epoch(iso: string, fallback: number): number {
  const parsed = Date.parse(iso);
  return Number.isNaN(parsed) ? fallback : parsed;
}
