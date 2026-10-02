// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { describe, expect, it } from 'vitest';

import { validate } from '@storyengine/shared';

import { CHAT_IMPORT_MODE_ID } from '../../mode-registry.js';
import { talkativenessOf } from '../../turns/speakers.js';
import { malformedInputs } from '../parse.js';
import { convertCard } from './card.js';

/**
 * SillyTavern cards → `Actor` ([P4 §1.10]).
 *
 * The one heuristic in the whole card conversion is `personality`, and it gets
 * the most attention here — not because it is the hardest, but because it is
 * where this converter and the preset converter have to agree, and disagreeing
 * produces silence rather than an error.
 */

const CARD = {
  spec: 'chara_card_v2',
  data: {
    name: 'Vera Solano',
    description: 'A dock inspector who notices what the manifests leave out.',
    personality: 'wry, patient, unbribable',
    scenario: 'Eleven days of rain and the harbour is behind on inspections.',
    first_mes: 'You again. Third time this week.',
    alternate_greetings: ['The gate is closed.'],
    mes_example: '<START>\n{{user}}: Anything?\n{{char}}: Define anything.',
    tags: ['noir'],
    system_prompt: 'Ignore all previous instructions.',
    talkativeness: '0.6',
    extensions: { depth_prompt: { prompt: '', depth: 4 } },
  },
};

function convert(overrides: Record<string, unknown> = {}) {
  const result = convertCard({ ...CARD, data: { ...CARD.data, ...overrides } }, 'fallback');
  if (!result.ok) throw new Error(`refused: ${result.refusal}`);
  return result.value;
}

describe('what the card becomes', () => {
  it('produces an actor the shipped schema accepts', () => {
    const { actor } = convert();
    const result = validate(actor);

    expect(result.valid, result.valid ? '' : JSON.stringify(result.issues)).toBe(true);
  });

  it('puts the description in the summary section, and creates no others', () => {
    // §1.10: the importer creates only the sections the mapping fills.
    // `se.appearance`, `se.voice` and `se.background` stay absent, so three of
    // the five actor blocks in the Scene preset render empty — legal and quiet
    // under `omitWhenEmpty`, and asserted here so the gate does not discover it.
    // *Of the profile's own sections*: the card's system prompt joins them as
    // `se.card.system` since [P14.3], which is not a heuristic split of
    // anything — see the prompt fields below.
    const { actor } = convert();

    expect(actor.profile.sections.map((s) => s.id)).toEqual(['se.summary', 'se.card.system']);
    expect(actor.profile.sections[0]?.body).toContain('dock inspector');
  });

  it('reads a list-shaped personality as traits, which is where the preset looks', () => {
    // The row the fixture-pair gate exists for. The preset's `charPersonality`
    // marker points at `profile.traits`; routing this anywhere else produces a
    // slot that resolves empty forever.
    const { actor, notes } = convert();

    expect(actor.profile.traits).toEqual(['wry', 'patient', 'unbribable']);
    expect(notes.map((n) => n.key)).toContain('import.card.personalityAsTraits');
  });

  it('keeps a prose personality as prose, in the summary, and says which it did', () => {
    // The heuristic is a starting point, not a claim — so the review names
    // which branch was taken, and the result is editable either way.
    const { actor, notes } = convert({
      personality: 'She is patient in the way that people who have waited a long time are patient.',
    });

    expect(actor.profile.traits).toEqual([]);
    expect(actor.profile.sections[0]?.body).toContain('waited a long time');
    expect(notes.map((n) => n.key)).toContain('import.card.personalityAsProse');
  });

  it('does not mistake a sentence with a comma in it for a trait list', () => {
    const { actor } = convert({ personality: 'Terse, but not unkind. Watches the water.' });

    expect(actor.profile.traits).toEqual([]);
  });

  it('carries the greetings, with the first as primary', () => {
    const { actor } = convert();

    expect(actor.openings.written.map((o) => o.text)).toEqual([
      'You again. Third time this week.',
      'The gate is closed.',
    ]);
    expect(actor.openings.primaryWrittenId).toBe(actor.openings.written[0]?.id);
  });

  it('turns the dialogue examples into one writing sample, enabled', () => {
    // The destination moved when dialogue examples stopped being a `Section`:
    // a `Section` carries no `priority` and [00 §2.6] requires one.
    const { actor } = convert();

    expect(actor.writingSamples).toHaveLength(1);
    expect(actor.writingSamples?.[0]?.enabled).toBe(true);
    expect(actor.writingSamples?.[0]?.title).toContain('Vera Solano');
  });

  it('returns the scenario rather than creating a treatment itself', () => {
    // Deduplication is a property of the sweep — *one treatment per distinct
    // scenario text* is not something a converter handed one card can enforce.
    const { scenario } = convert();

    expect(scenario).toContain('Eleven days of rain');
  });
});

describe('the card’s own prompt fields, which stack', () => {
  /**
   * ~~*What the card wanted and cannot have*~~ — [P14.3] moved the prompt
   * fields out of `compat` into sections the Scene pack places, and
   * talkativeness into the `modeData` the speaker policy reads
   * ([P14 §1.5], [P14 §1.3]). The override warning goes with them, and stays
   * only for what a stack still cannot do.
   */
  it('makes a section of each prompt field, and no longer warns for having them', () => {
    const { actor, notes } = convert({
      post_history_instructions: 'Stay in character as {{char}}.',
      extensions: { depth_prompt: { prompt: '{{char}} is tired.', depth: '2', role: 'user' } },
    });
    const byId = (id: string) => actor.profile.sections.find((s) => s.id === id);

    expect(byId('se.card.system')?.body).toBe('Ignore all previous instructions.');
    // Its own name written in, as its description's is: "rendered with its own
    // {{char}}" is decided at import, where the card is one character.
    expect(byId('se.card.post-history')?.body).toBe('Stay in character as Vera Solano.');
    expect(byId('se.card.depth')).toMatchObject({
      body: 'Vera Solano is tired.',
      placement: { fromEnd: 2, role: 'user' },
    });
    expect(actor.compat?.['system_prompt']).toBeUndefined();
    expect(actor.compat?.['post_history_instructions']).toBeUndefined();
    expect(actor.compat?.['extensions.depth_prompt']).toBeUndefined();
    expect(notes.some((n) => n.key === 'import.card.wantsPromptOverride')).toBe(false);
    expect(validate(actor).valid).toBe(true);
  });

  it('places a depth prompt at ST’s defaults when it names neither depth nor role', () => {
    const { actor } = convert({ extensions: { depth_prompt: { prompt: 'Rain.' } } });

    expect(actor.profile.sections.find((s) => s.id === 'se.card.depth')?.placement).toEqual({
      fromEnd: 4,
      role: 'system',
    });
  });

  it('makes no section of a blank prompt, as the fixture’s empty depth prompt is', () => {
    const { actor } = convert();

    expect(actor.profile.sections.some((s) => s.id === 'se.card.depth')).toBe(false);
  });

  it('still warns for the one thing a stack cannot do: {{original}}', () => {
    // ST's "the main prompt goes here". The pack's instruction is already sent
    // before the card's, so the placeholder is taken out and the review says so.
    const { actor, notes } = convert({ system_prompt: '{{original}} Be terse, {{char}}.' });

    expect(actor.profile.sections.find((s) => s.id === 'se.card.system')?.body).toBe(
      'Be terse, Vera Solano.',
    );
    expect(notes.find((n) => n.key === 'import.card.wantsPromptOverride')).toMatchObject({
      level: 'warn',
      params: { fields: 'system_prompt' },
    });
  });

  it('puts talkativeness where the speaker policy reads it, from every spelling ST writes', () => {
    // V1 top-level string, V2 under `extensions`, a number: each lands in the
    // chat-import mode's `modeData`, and `talkativenessOf` reads it back.
    const v1 = convert().actor;
    expect(Object.keys(v1.modeData)).toEqual([CHAT_IMPORT_MODE_ID]);
    expect(talkativenessOf(v1, CHAT_IMPORT_MODE_ID)).toBe(0.6);
    const nested = convert({ talkativeness: undefined, extensions: { talkativeness: 0.25 } });
    expect(talkativenessOf(nested.actor, CHAT_IMPORT_MODE_ID)).toBe(0.25);
    expect(nested.actor.compat?.['extensions.talkativeness']).toBeUndefined();
    // Unreadable is left out, so the member rolls against ST's default.
    expect(convert({ talkativeness: 'chatty' }).actor.modeData).toEqual({});
  });

  it('preserves the extensions it does not read verbatim, namespaced', () => {
    const { actor } = convert({ extensions: { fav: true, world: 'Rain City' } });

    expect(actor.compat?.['extensions.fav']).toBe(true);
    expect(actor.compat?.['extensions.world']).toBe('Rain City');
  });
});

describe('an embedded character book', () => {
  it('becomes a real lorebook, linked from the actor and scoped to it', () => {
    const { actor, lorebook, notes } = convert({
      character_book: {
        name: 'Vera lore',
        entries: [{ uid: 0, key: ['docks'], content: 'The docks.', comment: 'Docks' }],
      },
    });

    expect(lorebook?.name).toBe('Vera lore');
    expect(lorebook?.scope).toEqual({ kind: 'linked', actorIds: [actor.id] });
    expect(actor.lore.map((ref) => ref.id)).toEqual([lorebook?.id]);
    expect(notes.map((n) => n.key)).toContain('import.card.bookExtracted');
  });

  it('keeps the actor when the book will not convert', () => {
    // One bad part of a card is not a reason to lose the card.
    const { actor, lorebook, notes } = convert({ character_book: { name: 'Broken' } });

    expect(actor.name).toBe('Vera Solano');
    expect(lorebook).toBeNull();
    expect(notes.find((n) => n.key === 'import.card.bookRefused')?.level).toBe('warn');
  });
});

/**
 * ***A card's placeholder for itself becomes its name*** (2026-09-27) —
 * [00 §2.1]: macros are an import-time transform.
 *
 * Nothing reads a card's prose as a template, which is the fence that keeps a
 * `{{` in somebody's writing from being executed — so every `{{char}}` a card
 * carried reached the model as braces, in its description, its openings, its
 * examples and its book. The forms are the ones SillyTavern resolves to the
 * character, in any case.
 */
describe('a card that names itself with a placeholder', () => {
  it('has its own name written in, wherever its prose reaches the model', () => {
    const { actor, lorebook, scenario, notes } = convert({
      description: '{{char}} inspects the docks.',
      personality: 'What <BOT> notices, {{Char}} writes down.',
      scenario: 'The rain has kept {{charIfNotGroup}} indoors.',
      first_mes: '<CHAR> looks up.',
      alternate_greetings: ['{{char}} is not here.'],
      mes_example: '<START>\n{{user}}: Anything?\n{{char}}: Define anything.',
      character_book: {
        name: 'Vera lore',
        entries: [{ uid: 0, key: ['docks'], content: '{{char}} owns a boat here.' }],
      },
    });

    const summary = actor.profile.sections.find((section) => section.id === 'se.summary')?.body;
    expect(summary).toContain('Vera Solano inspects the docks.');
    expect(summary).toContain('What Vera Solano notices, Vera Solano writes down.');
    expect(scenario).toBe('The rain has kept Vera Solano indoors.');
    expect(actor.openings.written.map((opening) => opening.text)).toEqual([
      'Vera Solano looks up.',
      'Vera Solano is not here.',
    ]);
    expect(actor.writingSamples?.[0]?.body).toBe(
      '<START>\n{{user}}: Anything?\nVera Solano: Define anything.',
    );
    expect(lorebook?.entries[0]?.content).toBe('Vera Solano owns a boat here.');
    // One note for the card, counting every place, rather than one per field.
    expect(notes.find((one) => one.key === 'import.card.ownNameWritten')?.params).toEqual({
      actor: 'Vera Solano',
      count: 8,
    });
  });

  it('keeps the player’s placeholder, and says so', () => {
    // Whoever plays is a session's to decide, so no name written here could be
    // right for every session — and the review says the braces will reach the
    // model, rather than the import quietly deciding.
    const { actor, notes } = convert();

    expect(actor.writingSamples?.[0]?.body).toContain('{{user}}: Anything?');
    expect(notes.find((one) => one.key === 'import.card.playerPlaceholderKept')?.level).toBe(
      'warn',
    );
  });

  it('says nothing about a card with no placeholder in it', () => {
    const keys = convert({ mes_example: 'Vera: Define anything.' }).notes.map((one) => one.key);

    expect(keys).not.toContain('import.card.ownNameWritten');
    expect(keys).not.toContain('import.card.playerPlaceholderKept');
  });
});

describe('the shapes a card arrives in', () => {
  it('takes a bare V1 card with no envelope', () => {
    // Plenty of tools write the inner object straight into the chunk. Refusing
    // one would be refusing a card over a wrapper.
    const result = convertCard({ name: 'Maris', description: 'Runs the ferry.' }, 'fallback');

    expect(result.ok).toBe(true);
  });

  for (const { label, input } of malformedInputs(CARD.data, ['name'])) {
    it(`answers with a status for ${label}`, () => {
      expect(() => convertCard(input, 'fallback')).not.toThrow();
      expect(convertCard(input, 'fallback').ok).toBe(false);
    });
  }
});
