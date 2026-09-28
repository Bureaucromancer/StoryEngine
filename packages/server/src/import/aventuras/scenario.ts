// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import {
  CONVENTIONAL_SECTION_IDS,
  newActor,
  newLoreEntry,
  newLorebook,
  newTreatment,
  type Actor,
  type ImportDestination,
  type ImportNote,
  type Lorebook,
  type Treatment,
} from '@storyengine/shared';

import { claimId, stableId } from '../identity.js';
import { parsed, refused, type ParseOutcome } from '../parse.js';

import { isRecord, isVaultScenario, note, strings, text } from './shapes.js';

/**
 * Aventuras `VaultScenario` → a Treatment, or a Lorebook if you say so.
 *
 * **This is the conflated object, and unconflating it is the whole conversion.**
 * [04 §6](../../../../../docs/design/04-schemas.md) records that `Scenario` was
 * refused as a name for this project's kind because *"both source projects use
 * it for the conflated object"* — setting prose, a cast and an opening in one
 * file. Treatment is what StoryEngine calls the unconflated version, and the
 * fields line up almost one to one:
 * [03 §4](../../../../../docs/design/03-data-model.md) aligns
 * `VaultScenario.description` with `blurb` **by name**, which is as close to a
 * mapping table written in advance as this repository has.
 *
 * **The precedent for the shape is already in the sweep.** `#rememberScenario`
 * and `flushTreatments` turn a SillyTavern card's `scenario` string into a
 * Treatment whose `framing` is that string and whose cast is billed `npc` with
 * an empty note. This is that, with the rest of the fields filled in — because
 * a `VaultScenario` says who the cast are and how a game opens, and a card's
 * loose `scenario` field does not.
 *
 * ---
 *
 * **The invariant this bends, and how far.** [04 §6] is bold about it: *a
 * Treatment contains no world facts*. `settingSeed` is world facts. Three
 * things are true at once and all three are worth saying rather than picking
 * the flattering one:
 *
 * - The card importer already bends it exactly this far, and has since P4.
 *   `framing = scenario` puts a card's premise — usually world facts — into the
 *   every-turn field. Being stricter here than there would make two importers
 *   disagree about what a premise is.
 * - **Nothing can split one prose blob into tone and facts mechanically**, and
 *   imports here are deterministic and offline by rule. The alternative that
 *   keeps the invariant is a Treatment with an empty `framing` beside a
 *   one-entry lorebook, which honours the letter and hands the person an object
 *   whose every-turn field says nothing.
 * - So the prose lands in `framing` and the review **says so**, and points at
 *   the extraction that is the real answer
 *   ([16 §3](../../../../../docs/design/16-authoring.md), 4.0). A bent
 *   invariant that reports itself is a decision; a silent one is a bug.
 *
 * **What the alternative destination is for.** A scenario whose `settingSeed`
 * is really a setting bible wants to be *read*, and
 * [11](../../../../../docs/design/11-lorebooks-as-a-format.md) is the argument
 * that reading is a first-class use of the library. That path drops the
 * openings, because a Lorebook has no field for them, and it says so at `warn`.
 */

/** One cast member, and the note that says how the scenario used them. */
export interface ConvertedScenarioMember {
  actor: Actor;
  /**
   * `CastEntry.note` — *"how this character is used in this treatment"*, which
   * is precisely what Aventuras' `role` and `relationship` are for.
   */
  note: string;
}

export interface ConvertedScenario {
  /** What this conversion was asked for, echoed so a caller need not remember. */
  destination: ImportDestination;
  /** Set under `treatment`, `null` under `lorebook`. */
  treatment: Treatment | null;
  /** Set under `lorebook`, `null` under `treatment`. */
  lorebook: Lorebook | null;
  /**
   * The Actors the `npcs` became, with their billing notes.
   *
   * **Empty under the `lorebook` destination**, where the npcs become keyed
   * entries instead: a book that also scattered actors across the library would
   * be answering a question nobody asked of it.
   *
   * Returned rather than stored, for `convertCard`'s reason one field up: a
   * converter does no I/O, and the caller has to settle each actor's id through
   * `identify()` before the cast can point at it.
   */
  cast: ConvertedScenarioMember[];
  notes: ImportNote[];
}

/** Fields this converter reads, and so does not also preserve into `metadata`. */
const CONSUMED = new Set([
  'name',
  'description',
  'settingSeed',
  'npcs',
  'primaryCharacterName',
  'firstMessage',
  'alternateGreetings',
  'tags',
  'id',
  'favorite',
  'createdAt',
  'updatedAt',
]);

export function convertScenario(
  input: unknown,
  fallbackName: string,
  destination: ImportDestination = 'treatment',
): ParseOutcome<ConvertedScenario> {
  if (!isRecord(input) || !isVaultScenario(input)) return refused('wrong-shape');

  const settingSeed = text(input['settingSeed']);
  if (settingSeed.length === 0) return refused('missing-field', 'settingSeed');

  const name = text(input['name']) || fallbackName;
  const notes: ImportNote[] = [];
  const npcs = readNpcs(input['npcs']);
  const openings = readOpenings(input);

  linkedLorebookWarning(input, notes);

  return destination === 'lorebook'
    ? parsed(asLorebook(input, name, settingSeed, npcs, openings, notes))
    : parsed(asTreatment(input, name, settingSeed, npcs, openings, notes));
}

// ── The default: a Treatment, and the cast beside it ────────────────────────

function asTreatment(
  scenario: Readonly<Record<string, unknown>>,
  name: string,
  settingSeed: string,
  npcs: readonly Npc[],
  openings: readonly string[],
  notes: ImportNote[],
): ConvertedScenario {
  const treatment = newTreatment(name);

  // [03 §4] names this mapping: `VaultScenario.description` is library-preview
  // text, which is what `blurb` is and what `framing` is not. Both sources
  // conflate the two and Marinara had to annotate *"Not injected anywhere"* to
  // keep them apart; here they are two fields and no annotation is needed.
  treatment.blurb = text(scenario['description']);
  treatment.framing = settingSeed;
  treatment.tags = strings(scenario['tags']);

  notes.push(
    note('import.aventuras.settingAsFraming', { chars: settingSeed.length, name }, 'warn'),
  );

  if (openings.length > 0) {
    treatment.openings.written = openings.map((textBody, index) => ({
      // Derived rather than minted, so converting the same file twice produces
      // the same object — the property that makes re-import identity a byte
      // comparison rather than a guess ([P4 §1.3]). `applyOpenings` in the card
      // converter does the same for the same reason.
      id: stableId('opening', name, String(index), textBody),
      label: index === 0 ? 'Opening' : `Alternate ${String(index)}`,
      text: textBody,
    }));
    treatment.openings.primaryWrittenId = treatment.openings.written[0]?.id ?? null;
  }

  const cast = npcs.map((npc) => ({ actor: actorFor(npc), note: billingNote(npc) }));
  if (cast.length > 0) {
    notes.push(note('import.aventuras.npcsAsActors', { count: cast.length, name }));
  }

  /**
   * **`primaryCharacterName` changes a note and never a billing.**
   *
   * In Aventuras it is the card the scenario was built from — the character you
   * play *against*, not the one you play. Billing them `persona-option` would be
   * inventing intent the source never expressed, which is the mistake
   * `flushTreatments` names in its own comment when it bills every card `npc`
   * and leaves it there. So it is recorded where a person will read it, on the
   * cast entry's note, and the review says it was recorded.
   */
  const primary = text(scenario['primaryCharacterName']);
  if (primary.length > 0) {
    const member = cast.find((entry) => entry.actor.name === primary);
    if (member === undefined) {
      notes.push(note('import.aventuras.primaryNotInCast', { actor: primary }));
    } else {
      member.note = member.note.length > 0 ? `Lead. ${member.note}` : 'Lead.';
    }
  }

  treatment.metadata = carriedMetadata(scenario);

  return { destination: 'treatment', treatment, lorebook: null, cast, notes };
}

// ── The alternative: one book, read rather than played ──────────────────────

function asLorebook(
  scenario: Readonly<Record<string, unknown>>,
  name: string,
  settingSeed: string,
  npcs: readonly Npc[],
  openings: readonly string[],
  notes: ImportNote[],
): ConvertedScenario {
  const lorebook = newLorebook(name);
  lorebook.description = text(scenario['description']);
  lorebook.tags = strings(scenario['tags']);
  lorebook.metadata = carriedMetadata(scenario);

  /**
   * The setting is `constant`, and the npcs are keyed on their own names.
   *
   * **This is the one place this converter invents machinery**, and it is worth
   * naming rather than burying: `VaultScenario` expresses no activation at all,
   * so `constant`, `keys` and `order` here are a reading of the file rather than
   * a translation of it. The reading is the mild one — a setting that always
   * applies and a character who comes up when named — and it is what a person
   * would have typed. It is still the argument for Treatment being the default.
   */
  // One `taken` for the whole book, the setting first: an npc called *setting*
  // derived the setting's own id, and two npcs of one name derived each other's.
  const taken = new Set<string>();
  const setting = newLoreEntry(name);
  setting.id = claimId(
    taken,
    stableId('aventuras-entry', name, 'setting'),
    'aventuras-entry-repeat',
    name,
    'setting',
  ).id;
  setting.content = settingSeed;
  setting.description = text(scenario['description']);
  setting.constant = true;
  setting.order = 50;
  setting.tag = 'setting';

  lorebook.entries = [
    setting,
    ...npcs.map((npc) => {
      const entry = newLoreEntry(npc.name);
      entry.id = claimId(
        taken,
        stableId('aventuras-entry', name, npc.name),
        'aventuras-entry-repeat',
        name,
        npc.name,
      ).id;
      entry.content = entryBody(npc);
      entry.keys = [npc.name];
      entry.selective = false;
      entry.tag = 'character';
      return entry;
    }),
  ];

  notes.push(note('import.aventuras.scenarioAsLorebook', { entries: lorebook.entries.length }));
  if (openings.length > 0) {
    // A Lorebook has no `openings`, so this is a real loss and gets the level
    // that says so. The sentence names the count because *what did I lose* is
    // answerable and *something was lost* is not.
    notes.push(note('import.aventuras.openingsDropped', { count: openings.length }, 'warn'));
  }

  return { destination: 'lorebook', treatment: null, lorebook, cast: [], notes };
}

// ── Reading the source ──────────────────────────────────────────────────────

interface Npc {
  name: string;
  role: string;
  description: string;
  relationship: string;
  traits: string[];
}

function readNpcs(value: unknown): Npc[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter(isRecord)
    .map((row) => ({
      name: text(row['name']),
      role: text(row['role']),
      description: text(row['description']),
      relationship: text(row['relationship']),
      traits: strings(row['traits']),
    }))
    .filter((npc) => npc.name.length > 0);
}

/** `firstMessage` first, then the alternates — the order the source implies. */
function readOpenings(scenario: Readonly<Record<string, unknown>>): string[] {
  const first = text(scenario['firstMessage']);
  const alternates = strings(scenario['alternateGreetings']);
  return first.length > 0 ? [first, ...alternates] : alternates;
}

function actorFor(npc: Npc): Actor {
  const actor = newActor(npc.name);
  actor.profile.traits = npc.traits;
  // `npc` as a tag rather than a role: [04 §4] is explicit that personas and
  // NPCs are flags and tags and not separate types, and that the engine has no
  // built-in meaning for any tag.
  actor.tags = ['npc'];

  const summary = actor.profile.sections.find(
    (section) => section.id === CONVENTIONAL_SECTION_IDS.summary,
  );
  if (summary !== undefined) summary.body = npc.description;

  return actor;
}

/** `role` and `relationship`, which is exactly what `CastEntry.note` is for. */
function billingNote(npc: Npc): string {
  return [npc.role, npc.relationship].filter((part) => part.length > 0).join(' — ');
}

function entryBody(npc: Npc): string {
  const parts = [npc.description];
  if (npc.role.length > 0) parts.push(`Role: ${npc.role}`);
  if (npc.relationship.length > 0) parts.push(`Relationship: ${npc.relationship}`);
  if (npc.traits.length > 0) parts.push(`Traits: ${npc.traits.join(', ')}`);
  return parts.filter((part) => part.length > 0).join('\n\n');
}

/**
 * A scenario can name a lorebook that is not in the file, and losing that
 * silently is losing half a world.
 *
 * Aventuras splits a card's embedded `character_book` into a *separate* vault
 * lorebook and cross-references it by id (`scenarioVault.svelte.ts`). The id is
 * meaningless here — it names a row in their install — but its presence is a
 * fact worth reporting, because the remedy is a second export they have to go
 * and do.
 */
function linkedLorebookWarning(
  scenario: Readonly<Record<string, unknown>>,
  notes: ImportNote[],
): void {
  const metadata = scenario['metadata'];
  if (!isRecord(metadata)) return;
  if (typeof metadata['linkedLorebookId'] !== 'string') return;
  notes.push(note('import.aventuras.linkedLorebookMissing', {}, 'warn'));
}

/**
 * What travels into `metadata`, and what does not.
 *
 * Treatments and Lorebooks carry `metadata` and no `compat` ([P4 §1.4]'s
 * per-kind honesty), so this is the only escape hatch either kind has, and
 * everything this converter did not read goes into it verbatim — `source`,
 * `originalFilename`, and the source's own `metadata` object whole.
 *
 * **`id` and `favorite` are dropped and the list above says so.** An id names a
 * row in somebody else's database and carrying it would invite something to
 * dereference it; `favorite` is a fact about how they like the file rather than
 * about the file, which is [11 §4.2]'s portability rule and the same reason a
 * saved toggle-set was refused there.
 *
 * The derived counters inside their `metadata` — `npcCount`,
 * `alternateGreetingsCount` — ride along rather than being stripped, and that
 * is deliberate: [04 §2] forbids dropping unknown fields, and a counter inside
 * a preserved blob is inert where the same counter promoted to a field of ours
 * would be a second source of truth ([00 §2.8]).
 */
function carriedMetadata(scenario: Readonly<Record<string, unknown>>): Record<string, unknown> {
  const carried: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(scenario)) {
    if (!CONSUMED.has(key)) carried[key] = value;
  }
  return carried;
}
