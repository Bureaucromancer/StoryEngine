// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import {
  CONVENTIONAL_SECTION_IDS,
  newActor,
  type Actor,
  type ImportNote,
  type Lorebook,
} from '@storyengine/shared';

import { stableId } from '../identity.js';
import { parsed, refused, type ParseOutcome } from '../parse.js';
import { convertLorebook } from './lorebook.js';

/**
 * SillyTavern V2/V3 character cards → `Actor`
 * ([P4 §1.10](../../../../../docs/design/workplan/06-p4-implementation.md),
 * rewriting [02 §2.7]'s table in the shipped schema's own terms).
 *
 * **The row that matters most is `personality`**, because it is where this
 * converter and the preset converter meet. The preset's `charPersonality`
 * marker points at `profile.traits`; if this routed `personality` anywhere else,
 * the two would each be individually correct and produce a slot that resolves
 * empty forever, hidden by `omitWhenEmpty`. That pair is what
 * [testing §5.1](../../../../../docs/design/workplan/10-testing.md) exists to
 * catch and what the fixture-pair gate asserts.
 */

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** Fields that reach `compat` by name rather than by being unrecognised. */
const COMPAT_FIELDS = [
  'system_prompt',
  'post_history_instructions',
  'depth_prompt',
  'talkativeness',
  'creator',
  'creator_notes',
  'character_version',
];

/** Fields this converter reads, and so does not also preserve as unknown. */
const CONSUMED = new Set([
  'name',
  'description',
  'personality',
  'scenario',
  'first_mes',
  'alternate_greetings',
  'mes_example',
  'tags',
  'character_book',
  'extensions',
  ...COMPAT_FIELDS,
]);

export interface ConvertedCard {
  actor: Actor;
  /** Extracted from `character_book`, already linked from the actor. */
  lorebook: Lorebook | null;
  /**
   * The card's `scenario` text, for the caller to turn into a Treatment.
   *
   * **Returned rather than created here**, because §1.10 wants *one treatment
   * per distinct scenario text within a sweep* — and a converter handed one card
   * cannot know what the others said. Deduplication is a property of the sweep,
   * so it belongs to the sweep.
   */
  scenario: string | null;
  notes: ImportNote[];
}

const note = (
  key: string,
  params: ImportNote['params'],
  level: ImportNote['level'] = 'info',
): ImportNote => ({ key, params, level });

/**
 * The V2/V3 envelope: `{ spec, spec_version, data: { … } }`, or a bare V1 object.
 *
 * A card that is already unwrapped is not an error — plenty of tools write the
 * inner object straight into the chunk, and refusing one would be refusing a
 * card over a wrapper.
 */
function unwrap(input: unknown): Record<string, unknown> | null {
  if (!isRecord(input)) return null;
  const data = input['data'];
  if (isRecord(data)) return data;
  return typeof input['name'] === 'string' ? input : null;
}

export function convertCard(input: unknown, fallbackName: string): ParseOutcome<ConvertedCard> {
  const card = unwrap(input);
  if (card === null) return refused('wrong-shape');
  if (typeof card['name'] !== 'string' || card['name'].length === 0) {
    return refused('missing-field', 'name');
  }

  const notes: ImportNote[] = [];
  const actor = newActor(card['name'] || fallbackName);

  applyProfile(card, actor, notes);
  applyOpenings(card, actor);
  applySample(card, actor);
  applyTags(card, actor);

  const lorebook = extractBook(card, actor, notes);
  const compat = buildCompat(card, notes);
  if (Object.keys(compat).length > 0) actor.compat = compat;

  const scenario = typeof card['scenario'] === 'string' ? card['scenario'].trim() : '';

  return parsed({ actor, lorebook, scenario: scenario.length > 0 ? scenario : null, notes });
}

/**
 * `description` and `personality`, which is where the only heuristic lives.
 *
 * **Only the sections the mapping fills are created** ([P4 §1.10]).
 * `se.appearance`, `se.voice` and `se.background` stay absent, so three of the
 * five actor blocks in the default Scene preset render empty — legal and quiet
 * under `omitWhenEmpty`, and said here so the gate does not discover it.
 * Splitting `description` into appearance and voice by heuristic would be
 * inventing structure the source does not have.
 */
function applyProfile(
  card: Readonly<Record<string, unknown>>,
  actor: Actor,
  notes: ImportNote[],
): void {
  const description = typeof card['description'] === 'string' ? card['description'].trim() : '';
  const personality = typeof card['personality'] === 'string' ? card['personality'].trim() : '';

  const paragraphs: string[] = [];
  if (description.length > 0) paragraphs.push(description);

  if (personality.length > 0) {
    const traits = asTraits(personality);
    if (traits === null) {
      // Prose, so it belongs in the summary as its own paragraph rather than
      // being chopped into pseudo-traits.
      paragraphs.push(personality);
      notes.push(note('import.card.personalityAsProse', { actor: actor.name }));
    } else {
      actor.profile.traits = traits;
      notes.push(
        note('import.card.personalityAsTraits', { actor: actor.name, count: traits.length }),
      );
    }
  }

  if (paragraphs.length > 0) {
    actor.profile.sections = [
      {
        id: CONVENTIONAL_SECTION_IDS.summary,
        title: 'Summary',
        body: paragraphs.join('\n\n'),
        disposition: 'always',
      },
    ];
  }
}

/**
 * Is this a list of traits, or a paragraph about someone?
 *
 * **A starting point, not a claim** ([P4 §1.10]) — the result is user-editable
 * either way and the review says which happened. Short comma-separated
 * fragments with no sentence punctuation is what a trait list looks like;
 * anything with a full stop in it, or a fragment long enough to be a clause, is
 * prose that happens to contain a comma.
 */
function asTraits(personality: string): string[] | null {
  if (personality.includes('\n') || /[.!?]/.test(personality)) return null;
  const parts = personality
    .split(',')
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
  if (parts.length < 2) return null;
  return parts.every((part) => part.length <= 40) ? parts : null;
}

/** `first_mes` and `alternate_greetings`, first as primary. */
function applyOpenings(card: Readonly<Record<string, unknown>>, actor: Actor): void {
  const texts: string[] = [];
  if (typeof card['first_mes'] === 'string' && card['first_mes'].trim().length > 0) {
    texts.push(card['first_mes']);
  }
  if (Array.isArray(card['alternate_greetings'])) {
    for (const greeting of card['alternate_greetings']) {
      if (typeof greeting === 'string' && greeting.trim().length > 0) texts.push(greeting);
    }
  }
  if (texts.length === 0) return;

  // Derived rather than minted, so converting the same card twice produces the
  // same object — which is what makes re-import identity a byte comparison
  // rather than a guess ([P4 §1.3]).
  actor.openings.written = texts.map((text, index) => ({
    id: stableId('opening', actor.name, String(index), text),
    label: index === 0 ? 'Opening' : `Alternate ${String(index)}`,
    text,
  }));
  actor.openings.primaryWrittenId = actor.openings.written[0]?.id ?? null;
}

/**
 * `mes_example` → **one writing sample**, enabled, titled from the card.
 *
 * The destination moved after [02 §2.7] was written: dialogue examples stopped
 * being a `Section`, because a `Section` carries no `priority` and [00 §2.6]
 * requires one. A redirect rather than new import surface — still one row, still
 * one destination ([P4 §1.10]).
 */
function applySample(card: Readonly<Record<string, unknown>>, actor: Actor): void {
  const example = typeof card['mes_example'] === 'string' ? card['mes_example'].trim() : '';
  if (example.length === 0) return;

  actor.writingSamples = [
    {
      id: stableId('sample', actor.name),
      title: `${actor.name} — dialogue examples`,
      body: example,
      enabled: true,
      // The author's own words about the sample, and an importer has none: the
      // card said nothing about why these examples are here. Empty rather than
      // a manufactured "imported from SillyTavern", which would put our
      // sentence in a field meant for theirs.
      note: '',
    },
  ];
}

function applyTags(card: Readonly<Record<string, unknown>>, actor: Actor): void {
  if (!Array.isArray(card['tags'])) return;
  actor.tags = card['tags'].filter((tag): tag is string => typeof tag === 'string');
}

/** `character_book` → a real Lorebook, linked from the actor rather than embedded. */
function extractBook(
  card: Readonly<Record<string, unknown>>,
  actor: Actor,
  notes: ImportNote[],
): Lorebook | null {
  const book = card['character_book'];
  if (!isRecord(book)) return null;

  const converted = convertLorebook(book, `${actor.name}'s lore`);
  if (!converted.ok) {
    notes.push(
      note('import.card.bookRefused', { actor: actor.name, refusal: converted.refusal }, 'warn'),
    );
    return null;
  }

  const lorebook = converted.value.lorebook;
  // Scoped to the character it travelled with, which is what an embedded book
  // meant. `linked` rather than `global`: it was never a world book.
  lorebook.scope = { kind: 'linked', actorIds: [actor.id] };
  actor.lore = [{ id: lorebook.id, name: lorebook.name }];

  notes.push(...converted.value.notes);
  notes.push(note('import.card.bookExtracted', { actor: actor.name, book: lorebook.name }));
  return lorebook;
}

/**
 * The prompt-override fields, named rather than merely preserved.
 *
 * `system_prompt`, `post_history_instructions` and `depth_prompt` are a card
 * asking to rewrite the prompt, which cards cannot do here ([00 §2.4]) — so they
 * land in `compat` and the review surfaces *this card wants to override prompts;
 * review*. `talkativeness` joins them: it was in the deliberately-absent list
 * with no destination row until §1.10 gave it one.
 */
function buildCompat(
  card: Readonly<Record<string, unknown>>,
  notes: ImportNote[],
): Record<string, unknown> {
  const compat: Record<string, unknown> = {};
  const overrides: string[] = [];

  for (const field of COMPAT_FIELDS) {
    const value = card[field];
    if (value === undefined || value === null || value === '') continue;
    compat[field] = value;
    if (field !== 'creator' && field !== 'creator_notes' && field !== 'character_version') {
      overrides.push(field);
    }
  }

  // `extensions.*` verbatim ([00 §2.4]), including Marinara's fifteen engine
  // fields when the card came through that way.
  if (isRecord(card['extensions'])) {
    for (const [key, value] of Object.entries(card['extensions'])) {
      compat[`extensions.${key}`] = value;
    }
  }

  for (const [key, value] of Object.entries(card)) {
    if (!CONSUMED.has(key)) compat[key] = value;
  }

  if (overrides.length > 0) {
    notes.push(note('import.card.wantsPromptOverride', { fields: overrides.join(', ') }, 'warn'));
  }
  return compat;
}
