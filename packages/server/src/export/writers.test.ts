// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { describe, expect, it } from 'vitest';

import {
  EXPORT_FORMATS,
  newActor,
  newTreatment,
  type Actor,
  type Treatment,
} from '@storyengine/shared';

import { convertAventurasLorebook } from '../import/aventuras/lorebook.js';
import { convertScenario } from '../import/aventuras/scenario.js';
import { aventurasLorebook, aventurasScenario } from '../import/fixtures/test-aventuras.js';

import { EXPORT_WRITERS, writerFor, type Resolve } from './writers.js';

/** The scenario fixture, imported, with its cast indexed for the resolver. */
function imported(): { treatment: Treatment; resolve: Resolve } {
  const converted = convertScenario(aventurasScenario(), 'fallback');
  if (!converted.ok || converted.value.treatment === null) throw new Error('fixture broke');

  const { treatment, cast } = converted.value;
  const byId = new Map<string, Actor>();
  for (const member of cast) byId.set(member.actor.id, member.actor);
  treatment.cast = cast.map((member) => ({
    ref: { id: member.actor.id, name: member.actor.name },
    billing: 'npc' as const,
    note: member.note,
  }));

  return { treatment, resolve: (id) => byId.get(id) ?? null };
}

const keys = (notes: { key: string }[]): string[] => notes.map((note) => note.key);

describe('the export registry', () => {
  it('has a writer behind every row of the shared table', () => {
    /**
     * **The shared half and the code half, checked against each other.**
     * `EXPORT_FORMATS` is what the client builds its menu from and this is what
     * the route dispatches on — a row with no writer is a menu item that 404s,
     * and it would 404 for the user rather than for us.
     */
    for (const format of EXPORT_FORMATS) {
      expect(EXPORT_WRITERS[format.id], `${format.id} has no writer`).toBeTypeOf('function');
    }
    expect(Object.keys(EXPORT_WRITERS).sort()).toEqual(
      EXPORT_FORMATS.map((format) => format.id).sort(),
    );
  });

  it('separates a format nobody has from one aimed at the wrong kind', () => {
    expect(writerFor('nope', 'storyengine.treatment/1')).toBe('unknown-format');
    // A 409 rather than a 404: the format exists, the object is not its kind.
    expect(writerFor('aventuras.scenario', 'storyengine.actor/1')).toBe('wrong-kind');
    expect(writerFor('aventuras.scenario', 'storyengine.treatment/1')).toBeTypeOf('function');
  });

  it('refuses an object that does not match its own schema', () => {
    /**
     * The folder is the object and somebody may have hand-edited it
     * ([10 §2.1] makes that a feature), so *typed* and *conformant* are
     * different claims. A writer that trusted the cast would emit a file with
     * six empty fields instead of saying the object is broken.
     */
    const broken = { ...newTreatment('Broken'), framing: 42 };
    expect(EXPORT_WRITERS['aventuras.scenario']?.(broken, () => null)).toBeNull();
    expect(EXPORT_WRITERS['aventuras.scenario']?.({ schema: 'nope' }, () => null)).toBeNull();
  });
});

describe('a treatment, written as an Aventuras scenario', () => {
  it('fills the fields the importer reads back', () => {
    const { treatment, resolve } = imported();
    const written = EXPORT_WRITERS['aventuras.scenario']?.(treatment, resolve);
    expect(written).not.toBeNull();

    const body = written?.body as Record<string, unknown>;
    expect(body['name']).toBe('Ash Harbour');
    expect(body['settingSeed']).toContain('eleven days');
    expect(body['firstMessage']).toContain('finds your collar');
    expect(body['alternateGreetings']).toHaveLength(1);
    expect(body['npcs']).toHaveLength(2);
  });

  it('closes the loop: export, re-import, and the treatment comes back', () => {
    /**
     * ***The sharpest test [00 §2.4]'s promise has ever had.***
     *
     * *"Nothing is lost and re-export is possible"* was kept by preservation
     * alone until the library grew writers — `compat`, `metadata`, the
     * unknown-field rule — and preservation is what makes a writer *possible*
     * rather than what makes one correct. This runs the pair: a treatment out
     * through the writer and back in through the converter, asserting on the
     * fields a person would notice missing.
     *
     * It is a closed loop over **our** two halves, which is what makes it a
     * test. Whether Aventuras can read the file is a fact about their importer
     * — it cannot, today — and `EXPORT_FORMATS` records that as `roundTrips:
     * false` rather than pretending otherwise here.
     */
    const { treatment, resolve } = imported();
    const written = EXPORT_WRITERS['aventuras.scenario']?.(treatment, resolve);
    const back = convertScenario(written?.body, 'fallback');

    expect(back.ok).toBe(true);
    if (!back.ok || back.value.treatment === null) return;
    const round = back.value.treatment;

    expect(round.name).toBe(treatment.name);
    expect(round.framing).toBe(treatment.framing);
    expect(round.blurb).toBe(treatment.blurb);
    expect(round.tags).toEqual(treatment.tags);
    expect(round.openings.written.map((opening) => opening.text)).toEqual(
      treatment.openings.written.map((opening) => opening.text),
    );
    expect(back.value.cast.map((member) => member.actor.name)).toEqual([
      'Ines Vaur',
      'The Dockmaster',
    ]);
    // The note a `CastEntry` carried survives the trip through `role`.
    expect(back.value.cast[1]?.note).toContain('Runs the gate');
  });

  it('reports a cast member the library no longer has', () => {
    // [00 §3.3]: a dangling ref is visible and non-blocking, never fatal — the
    // same posture `exportPackage` takes when it reports `missing`.
    const { treatment } = imported();
    const written = EXPORT_WRITERS['aventuras.scenario']?.(treatment, () => null);
    expect(keys(written?.notes ?? [])).toContain('export.cast.unresolved');
    expect((written?.body as { npcs: unknown[] }).npcs).toEqual([]);
  });

  it('names the linked lorebooks it cannot carry', () => {
    const { treatment, resolve } = imported();
    const withLore = {
      ...treatment,
      lore: [{ ref: { id: 'x', name: 'Rain City' }, required: false }],
    };
    const written = EXPORT_WRITERS['aventuras.scenario']?.(withLore, resolve);
    // Aventuras keeps a scenario's lore as a separate vault record, so there is
    // no field to put one in — its own `linkedLorebookId` is this same gap.
    expect(keys(written?.notes ?? [])).toContain('export.aventuras.loreNotCarried');
  });
});

describe('a treatment, written as a character card', () => {
  it('puts the framing where convertCard reads it back', () => {
    const { treatment, resolve } = imported();
    const written = EXPORT_WRITERS['sillytavern.card']?.(treatment, resolve);
    const data = (written?.body as { data: Record<string, unknown> }).data;

    // The field this whole conversion turns on: a card's `scenario` becomes a
    // treatment's `framing` on the way in, so the pair closes.
    expect(data['scenario']).toContain('eleven days');
    expect(data['name']).toBe('Ines Vaur');
    expect(data['first_mes']).toContain('finds your collar');
    expect((written?.body as { spec: string }).spec).toBe('chara_card_v2');
  });

  it('says how many of the cast a card could not hold', () => {
    // The loss that cannot be engineered away: a card names one character and a
    // treatment names a cast. [04 §6] pays that cost at the boundary on purpose.
    const { treatment, resolve } = imported();
    const written = EXPORT_WRITERS['sillytavern.card']?.(treatment, resolve);
    const narrowed = written?.notes.find((note) => note.key === 'export.card.castNarrowed');
    expect(narrowed?.params['count']).toBe(1);
  });

  it('names the card after the treatment when no cast resolves', () => {
    // Not a refusal: a card with no character is still a readable premise.
    const { treatment } = imported();
    const written = EXPORT_WRITERS['sillytavern.card']?.(treatment, () => null);
    expect((written?.body as { data: { name: string } }).data.name).toBe('Ash Harbour');
    expect(keys(written?.notes ?? [])).toContain('export.card.noCastMember');
  });
});

describe('a lorebook, written as Aventuras entries', () => {
  it('round-trips through our own importer', () => {
    const inbound = convertAventurasLorebook(aventurasLorebook(), 'Harbour lore');
    expect(inbound.ok).toBe(true);
    if (!inbound.ok) return;

    const written = EXPORT_WRITERS['aventuras.lorebook']?.(inbound.value.lorebook, () => null);
    const back = convertAventurasLorebook(written?.body, 'Harbour lore');
    expect(back.ok).toBe(true);
    if (!back.ok) return;

    const before = inbound.value.lorebook.entries;
    const after = back.value.lorebook.entries;
    expect(after.map((entry) => entry.name)).toEqual(before.map((entry) => entry.name));
    // The two flags and the inverted order all have to survive both directions.
    expect(after.map((entry) => entry.constant)).toEqual(before.map((entry) => entry.constant));
    expect(after.map((entry) => entry.enabled)).toEqual(before.map((entry) => entry.enabled));
    expect(after.map((entry) => entry.order)).toEqual(before.map((entry) => entry.order));
    // The hidden info parked in `metadata` comes back out, which is what makes
    // that a parking space rather than a grave.
    expect(after[0]?.metadata['hiddenInfo']).toBe(before[0]?.metadata['hiddenInfo']);
  });

  it('warns that folder gates do not survive', () => {
    /**
     * [11 §2] calls a folder gate *a variant switch*, and Aventuras' `Entry` has
     * no folder at all. The quiet part is the dangerous one: a gated-off entry
     * keeps its own `enabled: true` ([04 §5] preserves rather than mutates), so
     * it exports as **on**.
     */
    const inbound = convertAventurasLorebook(aventurasLorebook(), 'Harbour lore');
    if (!inbound.ok) return;
    const book = inbound.value.lorebook;
    book.folders = [{ id: 'f1', name: 'Variant', parentFolderId: null, enabled: false, order: 0 }];
    book.entries[0]!.folderId = 'f1';

    const written = EXPORT_WRITERS['aventuras.lorebook']?.(book, () => null);
    expect(keys(written?.notes ?? [])).toContain('export.aventuras.foldersDropped');
  });
});

describe('an actor, written as an Aventuras character', () => {
  it('folds the extra sections in and says which', () => {
    const actor = newActor('Ines Vaur');
    actor.profile.sections[0]!.body = 'Notices what the manifests leave out.';
    actor.profile.sections[1]!.body = 'Short, square, permanently wet.';
    actor.profile.traits = ['patient'];

    const written = EXPORT_WRITERS['aventuras.character']?.(actor, () => null);
    const body = written?.body as Record<string, unknown>;

    // One `description` over there, a list of sections here — so the rest is
    // folded in rather than dropped, and the review names what was folded.
    expect(body['description']).toContain('Notices what the manifests');
    expect(body['description']).toContain('Short, square');
    const folded = written?.notes.find((note) => note.key === 'export.aventuras.sectionsFolded');
    expect(folded?.params['sections']).toBe('Appearance');
  });
});
