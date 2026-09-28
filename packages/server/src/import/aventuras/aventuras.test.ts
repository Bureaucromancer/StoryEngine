// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { describe, expect, it } from 'vitest';

import { stableId } from '../identity.js';
import { readUpload } from '../upload.js';
import { malformedInputs } from '../parse.js';
import {
  aventurasCharacter,
  aventurasLorebook,
  aventurasScenario,
} from '../fixtures/test-aventuras.js';

import { convertCharacter } from './character.js';
import { convertAventurasLorebook } from './lorebook.js';
import { convertScenario } from './scenario.js';

const bytes = (value: unknown): Uint8Array =>
  new TextEncoder().encode(JSON.stringify(value, null, 2));

const keys = (notes: { key: string }[]): string[] => notes.map((note) => note.key);

describe('recognising an Aventuras file', () => {
  it('reads a scenario, a character and a lorebook by their shapes', () => {
    // Structural, because the export carries no envelope and no `spec` to go on.
    expect(readUpload('Ash Harbour.json', bytes(aventurasScenario()))).toMatchObject({
      outcome: 'candidate',
      candidate: { format: 'aventuras.scenario' },
    });
    expect(readUpload('Ines Vaur.json', bytes(aventurasCharacter()))).toMatchObject({
      outcome: 'candidate',
      candidate: { format: 'aventuras.character' },
    });
    expect(readUpload('Harbour lore.json', bytes(aventurasLorebook()))).toMatchObject({
      outcome: 'candidate',
      candidate: { format: 'aventuras.lorebook' },
    });
  });

  it('still reads the SillyTavern shapes it sits above in the probe table', () => {
    /**
     * **The regression the probe order exists to prevent.** Both vault records
     * carry a `name`, which is the collision the table is ordered around, and
     * both were placed above `looksLikeCard` on purpose. A card and a world file
     * arriving after that change is the assertion that the placement cost
     * nothing.
     */
    const card = { name: 'Vera', description: 'x', first_mes: 'hello' };
    expect(readUpload('vera.json', bytes(card))).toMatchObject({
      candidate: { format: 'sillytavern.card' },
    });
    expect(readUpload('rain.json', bytes({ entries: {} }))).toMatchObject({
      candidate: { format: 'sillytavern.lorebook' },
    });
  });

  it('does not claim an array that is not an Aventuras lorebook', () => {
    // The array arm sits above the guard that used to reject every array, so it
    // has to be narrow: an empty array and a list of strings are not books.
    expect(readUpload('empty.json', bytes([]))).toMatchObject({ outcome: 'observed' });
    expect(readUpload('words.json', bytes(['a', 'b']))).toMatchObject({ outcome: 'observed' });
  });
});

describe('a scenario, as a treatment', () => {
  const converted = convertScenario(aventurasScenario(), 'fallback');

  it('maps the fields the design notes already paired up', () => {
    expect(converted.ok).toBe(true);
    if (!converted.ok) return;
    const { treatment, cast } = converted.value;
    expect(treatment).not.toBeNull();
    if (treatment === null) return;

    expect(treatment.name).toBe('Ash Harbour');
    // [03 §4] aligns `VaultScenario.description` with `blurb` by name.
    expect(treatment.blurb).toContain('A working port under permanent rain');
    expect(treatment.framing).toContain('Ash Harbour has been wet for eleven days');
    expect(treatment.tags).toEqual(['noir', 'imported']);

    // `firstMessage` leads, alternates follow, and the primary is the first.
    expect(treatment.openings.written).toHaveLength(2);
    expect(treatment.openings.written[0]?.text).toContain('finds your collar');
    expect(treatment.openings.primaryWrittenId).toBe(treatment.openings.written[0]?.id);

    expect(cast.map((member) => member.actor.name)).toEqual(['Ines Vaur', 'The Dockmaster']);
    // `role` and `relationship` are what `CastEntry.note` is for.
    expect(cast[1]?.note).toBe('Runs the gate — Owes you a favour he has forgotten');
  });

  it('marks the lead on the note and never on the billing', () => {
    /**
     * `primaryCharacterName` is the card a scenario was built from — the
     * character you play *against*. Billing them `persona-option` would invent
     * intent the source never expressed, which is the mistake `flushTreatments`
     * names when it bills every card `npc` and stops there.
     */
    if (!converted.ok) return;
    const lead = converted.value.cast.find((member) => member.actor.name === 'Ines Vaur');
    expect(lead?.note.startsWith('Lead.')).toBe(true);
  });

  it('says the setting prose became framing, and that a lorebook is missing', () => {
    if (!converted.ok) return;
    const said = keys(converted.value.notes);
    // The bent invariant reports itself — [04 §6]'s *no world facts*, and the
    // note that keeps bending it a decision rather than a defect.
    expect(said).toContain('import.aventuras.settingAsFraming');
    expect(said).toContain('import.aventuras.npcsAsActors');
    // Half a world would otherwise go missing in silence.
    expect(said).toContain('import.aventuras.linkedLorebookMissing');
  });

  it('carries what it did not read and drops what names their database', () => {
    if (!converted.ok) return;
    const metadata = converted.value.treatment?.metadata ?? {};
    expect(metadata['source']).toBe('import');
    expect(metadata['metadata']).toMatchObject({ npcCount: 2 });
    // An id names a row in somebody else's install; `favorite` is a fact about
    // how they like the file rather than about the file ([11 §4.2]).
    expect(metadata['id']).toBeUndefined();
    expect(metadata['favorite']).toBeUndefined();
  });

  it('converts the same bytes to the same object twice', () => {
    /**
     * **What makes re-import identity a comparison rather than a guess**
     * ([P4 §1.3]). Object ids are minted and then re-pointed by `identify()`,
     * so they are blanked here; everything inside — opening ids above all — is
     * derived and has to be stable.
     */
    const once = convertScenario(aventurasScenario(), 'fallback');
    const twice = convertScenario(aventurasScenario(), 'fallback');
    expect(once.ok && twice.ok).toBe(true);
    if (!once.ok || !twice.ok) return;
    expect(once.value.treatment?.openings).toEqual(twice.value.treatment?.openings);
  });

  it('refuses the malformed inputs every parser is driven through', () => {
    for (const { label, input } of malformedInputs(aventurasScenario(), ['settingSeed', 'npcs'])) {
      const result = convertScenario(input, 'fallback');
      expect(result.ok, `${label} should not convert`).toBe(false);
    }
  });
});

describe('a scenario, as a lorebook', () => {
  const converted = convertScenario(aventurasScenario(), 'fallback', 'lorebook');

  it('makes the setting constant and keys each character on their name', () => {
    expect(converted.ok).toBe(true);
    if (!converted.ok) return;
    const book = converted.value.lorebook;
    expect(book).not.toBeNull();
    expect(converted.value.treatment).toBeNull();
    // No actors: a book that also scattered actors across the library would be
    // answering a question nobody asked of it.
    expect(converted.value.cast).toEqual([]);
    if (book === null) return;

    expect(book.entries).toHaveLength(3);
    expect(book.entries[0]?.constant).toBe(true);
    expect(book.entries[0]?.content).toContain('eleven days');
    expect(book.entries[1]?.keys).toEqual(['Ines Vaur']);
  });

  it('says out loud that the openings were dropped', () => {
    // A Lorebook has no `openings`, so this is a real loss rather than a
    // difference — and the count is what makes it answerable.
    if (!converted.ok) return;
    const dropped = converted.value.notes.find(
      (note) => note.key === 'import.aventuras.openingsDropped',
    );
    expect(dropped?.params['count']).toBe(2);
    expect(dropped?.level).toBe('warn');
  });
});

describe('a vault character', () => {
  const converted = convertCharacter(aventurasCharacter(), 'fallback');

  it('carries the seven appearance keys across unchanged', () => {
    expect(converted.ok).toBe(true);
    if (!converted.ok) return;
    const { actor } = converted.value;
    // Ours was taken from theirs, so this is a copy rather than a mapping —
    // and the assertion is what would catch either side adding a key.
    expect(actor.profile.visual).toEqual(aventurasCharacter()['visualDescriptors']);
    expect(actor.profile.traits).toEqual(['patient', 'unbribable', 'tired']);
    expect(actor.profile.sections[0]?.body).toContain('notices what the manifests leave out');
  });

  it('reports the portrait rather than carrying it', () => {
    if (!converted.ok) return;
    // A converter does no I/O, and a card's pixels reach the library through the
    // asset path with the bytes sniffed rather than trusted.
    expect(keys(converted.value.notes)).toContain('import.aventuras.portraitNotCarried');
    expect(converted.value.actor.media).toEqual([]);
  });

  it('preserves what it did not read in compat', () => {
    if (!converted.ok) return;
    // An Actor has `compat` where a Treatment has only `metadata` — [P4 §1.4]'s
    // per-kind honesty, and the asymmetry is the schema's rather than ours.
    expect(converted.value.actor.compat).toMatchObject({ originalStoryId: expect.any(String) });
  });

  it('refuses the malformed inputs', () => {
    for (const { label, input } of malformedInputs(aventurasCharacter(), [
      'name',
      'traits',
      'visualDescriptors',
    ])) {
      expect(convertCharacter(input, 'fallback').ok, `${label} should not convert`).toBe(false);
    }
  });
});

describe('an Aventuras lorebook', () => {
  const converted = convertAventurasLorebook(aventurasLorebook(), 'Harbour lore');

  it('expands the three injection modes back into our flags', () => {
    expect(converted.ok).toBe(true);
    if (!converted.ok) return;
    const [harbour, ines, night] = converted.value.lorebook.entries;

    expect(harbour?.constant).toBe(true);
    expect(ines?.constant).toBe(false);
    expect(ines?.enabled).toBe(true);
    expect(night?.enabled).toBe(false);
  });

  it('inverts priority into order, because the two run opposite ways', () => {
    /**
     * Theirs is *"Higher = inject first"*; ours is *lower = earlier*. A straight
     * copy imports cleanly and orders the context backwards — nothing to see
     * until somebody wonders why the least important entry leads.
     */
    if (!converted.ok) return;
    const [harbour, ines] = converted.value.lorebook.entries;
    expect(harbour?.order).toBe(100);
    expect(ines?.order).toBe(500);
    expect(harbour?.order).toBeLessThan(ines?.order ?? 0);
  });

  it('merges aliases into the second keys rather than dropping them', () => {
    // [11 §2]: `keys` is activation to the engine and index terms to a reader,
    // which is the one field their two have to share.
    if (!converted.ok) return;
    expect(converted.value.lorebook.entries[0]?.secondaryKeys).toEqual(['the harbour', 'the port']);
  });

  it('parks hidden info in metadata and records the tracked state', () => {
    if (!converted.ok) return;
    const [harbour] = converted.value.lorebook.entries;
    // Not `content` — that is injected, and a secret there leaks. Not
    // `description` — a router reads that and nobody looks at it.
    expect(harbour?.metadata['hiddenInfo']).toContain('insolvent');
    expect(keys(converted.value.notes)).toContain('import.aventuras.entryStateRecorded');
  });

  it('keeps the entry name as a key when the source gave none', () => {
    if (!converted.ok) return;
    // An entry with no keywords would otherwise be findable by nothing at all.
    expect(converted.value.lorebook.entries[0]?.keys).toEqual(['Ash Harbour']);
  });

  it('refuses anything that is not an array of entries', () => {
    for (const input of [null, undefined, 'a string', 7, {}, [], [{ name: 'x' }]]) {
      expect(convertAventurasLorebook(input, 'book').ok).toBe(false);
    }
  });
});

/**
 * ***A name said twice*** —
 * [P13.0](../../../../docs/design/workplan/30-p13-aventuras-import.md).
 *
 * Aventuras keys an entry by its uuid and never by its name, so a book can hold
 * two entries called *The Harbour* — and an id derived from the book and the
 * name alone gave both the same one. Nothing downstream catches it: validation
 * does not walk the array, the index keys entries by position, and the editor
 * resolves an id to its first match — so the second could not be opened, and
 * deleting or dragging either one deleted the other.
 */
describe('an Aventuras lorebook that repeats a name', () => {
  const harbour = (description: string): Record<string, unknown> => ({
    name: 'The Harbour',
    type: 'location',
    description,
    injection: { mode: 'keyword', keywords: ['harbour'], priority: 500 },
  });
  const repeats = (): Record<string, unknown>[] => [
    harbour('The old quay.'),
    harbour('The new quay.'),
    // Named the way a careless suffix would name the second, so the fix has to
    // be a claim on what is taken rather than a string appended.
    { ...harbour('A different place.'), name: 'The Harbour 2' },
    harbour('The quay nobody admits to.'),
  ];
  const idsOf = (input: unknown): string[] => {
    const converted = convertAventurasLorebook(input, 'Harbour lore');
    expect(converted.ok).toBe(true);
    return converted.ok ? converted.value.lorebook.entries.map((entry) => entry.id) : [];
  };

  it('gives every entry an id of its own', () => {
    expect(new Set(idsOf(repeats())).size).toBe(4);
  });

  it('leaves a book with no repeats exactly the ids it had', () => {
    // Re-import identity is a byte comparison ([P4 §1.3]): moving an id a
    // repeat-free book already had would replace every earlier import for nothing.
    expect(idsOf(aventurasLorebook())).toEqual(
      ['Ash Harbour', 'Ines Vaur', 'The Night Shift'].map((name) =>
        stableId('aventuras-entry', 'Harbour lore', name),
      ),
    );
  });

  it('lets the first of a repeated name, and a lookalike, keep the ids they always had', () => {
    // So a link or a timing counter that resolved to the first match still lands
    // on the same entry after the re-import that fixes the book.
    const [first, , lookalike] = idsOf(repeats());
    expect(first).toBe(stableId('aventuras-entry', 'Harbour lore', 'The Harbour'));
    expect(lookalike).toBe(stableId('aventuras-entry', 'Harbour lore', 'The Harbour 2'));
  });

  it('converts the same bytes to the same ids twice', () => {
    expect(idsOf(repeats())).toEqual(idsOf(repeats()));
  });

  it('says in the review that names repeated', () => {
    const converted = convertAventurasLorebook(repeats(), 'Harbour lore');
    expect(converted.ok).toBe(true);
    if (!converted.ok) return;
    const repeated = converted.value.notes.find(
      (note) => note.key === 'import.aventuras.repeatedEntryNames',
    );
    expect(repeated?.params['count']).toBe(2);
  });

  it('keeps a scenario’s setting apart from a character named for it, and twins apart', () => {
    const npc = (name: string): Record<string, unknown> => ({
      name,
      role: '',
      description: '',
      relationship: '',
      traits: [],
    });
    const scenario = {
      ...aventurasScenario(),
      npcs: [npc('setting'), npc('Ines Vaur'), npc('Ines Vaur')],
    };
    const converted = convertScenario(scenario, 'fallback', 'lorebook');
    expect(converted.ok).toBe(true);
    if (!converted.ok || converted.value.lorebook === null) return;
    const ids = converted.value.lorebook.entries.map((entry) => entry.id);
    expect(ids).toHaveLength(4);
    expect(new Set(ids).size).toBe(4);
  });
});
