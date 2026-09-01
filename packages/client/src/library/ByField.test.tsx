// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { ACTOR_SCHEMA, LOREBOOK_SCHEMA, newActor } from '@storyengine/shared';
import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { ByField } from './ByField.js';

/**
 * The rendering half of [polish §1].
 *
 * **The test the item is actually about is the first one**: a greeting with
 * paragraphs in it comes out as paragraphs. That is the whole complaint — to
 * read prose you opened the editor, because the alternative was a JSON string
 * with `\n` in it — and it is asserted twice, because the claim has two halves
 * and only one of them is visible to jsdom. That the *value* arrives rather
 * than its JSON encoding is a text assertion, which is the half a class check
 * would pass without. That the newlines *survive on screen* is a class
 * assertion, because jsdom computes no layout and `white-space` is the only
 * place that fact lives — a text node keeps its newlines whether or not
 * anything renders them.
 *
 * The queries here walk the description list rather than using `getByText`,
 * because the interesting values repeat: a section's title is both its heading
 * and its `Title` field, and `id` is a label on four different levels. A
 * document-wide text search would find whichever came first and say nothing
 * about where it was.
 */

const GREETING = 'She looks up.\n\n"You came."';

function actorWithGreeting(): Record<string, unknown> {
  const actor = newActor('Vera Kohl');
  actor.pronouns = null;
  actor.aliases = ['Kohl', 'the surveyor'];
  actor.openings = {
    written: [{ id: 'op-1', label: 'At the door', text: GREETING }],
    seeds: [],
    primaryWrittenId: 'op-1',
    primarySeedId: null,
  };
  return actor;
}

/** The value under one field, found by its label at this level and no deeper. */
function fieldValue(root: Element, label: string): Element {
  const list = root.querySelector('dl');
  if (list === null) throw new Error('nothing here rendered a field list');
  for (const row of [...list.children]) {
    const term = [...row.children].find((node) => node.tagName === 'DT');
    const value = [...row.children].find((node) => node.tagName === 'DD');
    if (term?.textContent === label && value !== undefined) return value;
  }
  throw new Error(`no field at this level is labelled ${label}`);
}

/** Every label at this level, in the order they were rendered. */
function labelsIn(root: Element): string[] {
  const list = root.querySelector('dl');
  if (list === null) return [];
  return [...list.children].flatMap((row) =>
    [...row.children].filter((node) => node.tagName === 'DT').map((node) => node.textContent),
  );
}

function renderActor(overrides: Record<string, unknown> = {}): HTMLElement {
  const { container } = render(
    <ByField schemaId={ACTOR_SCHEMA} value={{ ...actorWithGreeting(), ...overrides }} />,
  );
  return container;
}

describe('an object rendered field by field', () => {
  it('renders a greeting as the prose it is, newlines and all', () => {
    const container = renderActor();

    const shown = [...container.querySelectorAll('p')].find(
      (node) => node.textContent === GREETING,
    );

    expect(shown).toBeDefined();
    // The text node carries the newlines rather than a literal backslash-n,
    // which is the difference between reading it and reading its encoding.
    expect(shown?.textContent).toContain('\n\n');
    expect(container.textContent).not.toContain('\\n');
    // And that they survive the rendering. A class check on purpose — the
    // header says why it is the only one available.
    expect(shown?.className).toContain('whitespace-pre-wrap');
  });

  it('labels fields with the schema’s own words, in the schema’s own order', () => {
    const container = renderActor();

    expect(labelsIn(container).slice(0, 5)).toEqual([
      'Name',
      'Aliases',
      'Pronouns',
      'Roles',
      'Tags',
    ]);
    expect(fieldValue(container, 'Name').textContent).toBe('Vera Kohl');
  });

  it('renders a list of strings as a list', () => {
    const container = renderActor();

    const items = fieldValue(container, 'Aliases').querySelectorAll('li');

    expect([...items].map((node) => node.textContent)).toEqual(['Kohl', 'the surveyor']);
  });

  /**
   * Three words rather than one, because the schemas mean three different
   * things by them — `pronouns: null` is *unknown, and never inferred*, where
   * an empty list is a list somebody has not added to.
   */
  it('says which kind of empty each empty field is', () => {
    const container = renderActor();

    expect(fieldValue(container, 'Pronouns').textContent).toBe('Not set');
    expect(fieldValue(container, 'Roles').textContent).toBe('None');
    expect(fieldValue(container, 'Model hint').textContent).toBe('Not set');
  });

  it('renders a blank string as blank rather than as absent', () => {
    const container = renderActor();

    // `newActor` writes the four conventional sections with empty bodies, so
    // the distinction is on screen the first time anybody opens a new actor.
    const sections = fieldValue(fieldValue(container, 'Profile'), 'Sections');

    expect(sections.textContent).toContain('Empty');
    expect(sections.textContent).not.toContain('Not set');
  });

  it('renders a nested object through its own declared fields', () => {
    const container = renderActor();

    expect(labelsIn(fieldValue(container, 'Profile'))).toEqual(['Visual', 'Traits', 'Sections']);
  });

  /**
   * `Section.title` names a section and `Opening.label` names an opening; one
   * rule reads whichever the item has, which is why neither needs a table of
   * which kind spells it how. Asserted by position — the heading is the first
   * thing in the item — rather than by class.
   */
  it('names each item in a list of objects by whatever names it', () => {
    const container = renderActor();

    const written = fieldValue(fieldValue(container, 'Openings'), 'Written');
    const sections = fieldValue(fieldValue(container, 'Profile'), 'Sections');

    expect(written.textContent.startsWith('At the door')).toBe(true);
    expect(sections.textContent.startsWith('Summary')).toBe(true);
  });

  it('renders booleans as an answer rather than as a literal', () => {
    const { container } = render(
      <ByField
        schemaId={LOREBOOK_SCHEMA}
        value={{ schema: LOREBOOK_SCHEMA, id: 'b1', name: 'Ardent', enabled: false }}
      />,
    );

    expect(fieldValue(container, 'Enabled').textContent).toBe('No');
    expect(fieldValue(container, 'Scan depth').textContent).toBe('Not set');
  });

  /**
   * *As stored* is the view whose job is fields this build cannot render
   * ([polish §2]); taking that job here without doing it as well is how a
   * reader ends up with two half-answers.
   */
  it('leaves a key the schema does not declare to As stored', () => {
    const container = renderActor({ somethingNewer: 'only in as-stored' });

    expect(labelsIn(container)).not.toContain('Something newer');
    expect(container.textContent).not.toContain('only in as-stored');
  });

  /**
   * A record's keys *are* its content, so `compat` — where an import puts what
   * it could not name — is read from the value rather than from a declaration
   * it does not have.
   */
  it('reads a record’s keys from the file, since it declares none', () => {
    const container = renderActor({ compat: { talkativeness: '0.5' } });

    expect(labelsIn(fieldValue(container, 'Compat'))).toEqual(['Talkativeness']);
  });

  it('shows a value too deeply nested to draw rather than nothing at all', () => {
    const container = renderActor({ modeData: { one: { two: { three: { four: 'deep' } } } } });

    expect(fieldValue(container, 'Mode data').textContent).toContain('deep');
  });
});
