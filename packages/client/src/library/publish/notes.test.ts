// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { fileSet, type ImportNote } from '@storyengine/shared';
import { describe, expect, it } from 'vitest';

import { PUBLISH_NOTE_LABELS, publishSentence } from './notes.js';
import { graph } from './test-closure.js';

/**
 * ***`fileSet`'s notes, rendered*** — [P16.3g](../../../../../docs/design/workplan/34-p16-world.md).
 *
 * `note-labels.test.ts` holds the publish vocabulary to the emitted keys by
 * reading source, and its placeholder check has to look back for params built
 * before the key — weaker than its forward check, as it says. **This is the
 * strong form for the notes `fileSet` writes**: run `fileSet` itself over
 * closures that produce every one of them, render each through the review's
 * own `publishSentence`, and require that every key in the review's table came
 * out at least once and that nothing rendered a raw key or a `{placeholder}`.
 */

/** Closures that between them produce every note `fileSet` can write. */
function everyNote(): ImportNote[] {
  const notes: ImportNote[] = [];

  // A World: a treatment with a required book and an included one, both left
  // out; a missing book; a required missing book; a nested World; a book play
  // wrote; a session with its bindings; an orphan.
  const world = graph()
    .found('rain', 'storyengine.treatment/1')
    .found('harbour', 'storyengine.lorebook/1', { required: true })
    .found('docks', 'storyengine.lorebook/1')
    .found('vera', 'storyengine.actor/1')
    .found('vera-book', 'storyengine.lorebook/1')
    .found('memories', 'storyengine.lorebook/1', { writtenByPlay: true })
    .missing('missing:1', 'storyengine.lorebook/1', 'Old Pier')
    .missing('missing:2', 'storyengine.lorebook/1', 'Lost Map', true)
    .excluded('inner', 'nested-world')
    .session('night', { leavesBehind: ['roles'] })
    .edge(null, 'rain', 'world.member')
    .edge(null, 'memories', 'world.member')
    .edge(null, 'excluded:inner', 'world.member')
    .edge(null, 'night', 'world.member')
    .edge('rain', 'harbour', 'treatment.lore', { required: true })
    .edge('rain', 'docks', 'treatment.lore')
    .edge('rain', 'missing:1', 'treatment.lore')
    .edge('rain', 'missing:2', 'treatment.lore', { required: true })
    .edge('rain', 'vera', 'treatment.cast')
    .edge('vera', 'vera-book', 'actor.lore')
    .closure('world');
  notes.push(
    ...fileSet(world, {
      ticked: { harbour: false, docks: false, night: true },
      history: false,
    }).notes,
  );
  // Vera orphaned: the treatment that cast her is unticked.
  notes.push(...fileSet(world, { ticked: { rain: false }, history: false }).notes);

  // A selection naming an id that is not there: a missing starting point.
  const selection = graph()
    .found('vera', 'storyengine.actor/1')
    .missing('missing:1', '', null)
    .edge(null, 'vera', 'selected')
    .edge(null, 'missing:1', 'selected')
    .closure('selection');
  notes.push(...fileSet(selection, { ticked: {}, history: false }).notes);

  // One object, alone: just the object.
  const one = graph()
    .found('vera', 'storyengine.actor/1', { canUncheck: false })
    .edge(null, 'vera', 'selected')
    .closure('object');
  notes.push(...fileSet(one, { ticked: {}, history: false }).notes);
  return notes;
}

describe('every note fileSet writes, said', () => {
  it('produces every key the review’s table holds for it', () => {
    const produced = new Set(everyNote().map((note) => note.key));
    const ownedByFileSet = Object.keys(PUBLISH_NOTE_LABELS).filter(
      (key) => key.startsWith('publish.closure.') || key.startsWith('publish.session.'),
    );
    expect(ownedByFileSet.length).toBeGreaterThan(8);
    expect(ownedByFileSet.filter((key) => !produced.has(key))).toEqual([]);
  });

  it('renders each as a sentence, with every placeholder filled', () => {
    for (const note of everyNote()) {
      const said = publishSentence(note);
      expect(said, note.key).not.toBe(note.key);
      expect(said, note.key).not.toMatch(/\{\w+\}/);
      expect(said, note.key).not.toContain('“”');
    }
  });

  it('says a missing reference with no name by the id it was written with', () => {
    const said = publishSentence({
      key: 'publish.closure.missingStart',
      params: { rule: 'selected', id: '0199-gone', name: '' },
    });
    expect(said).toContain('“0199-gone”');
    // Gone, and so not named by the file — never *the file says it is missing*.
    expect(said).not.toContain('the file says it is missing');
  });
});

/** The notes the confirm sends in its header: the writer's, its count, and a mode not here. */
describe('the confirm’s notes, said', () => {
  it('says a size as a size, and a mode by its id', () => {
    expect(
      publishSentence({
        key: 'publish.file.objectTooLarge',
        params: { id: 'v', name: 'Vera', schema: 'storyengine.actor/1', bytes: 70 * 1024 * 1024 },
      }),
    ).toBe(
      '“Vera” is 70.0 MB, larger than one file in a world may be, so the file does not carry it.',
    );
    expect(
      publishSentence({ key: 'publish.requires.modeNotHere', params: { mode: 'example.mode' } }),
    ).toContain('example.mode');
    expect(
      publishSentence({ key: 'publish.file.moreInManifest', params: { count: 12 } }),
    ).toContain('12');
  });

  it('says a damaged session picture, which arrives with no ref, without a placeholder', () => {
    const said = publishSentence({
      key: 'publish.file.pictureDamaged',
      params: { id: 's', name: 'Night one' },
    });
    expect(said).not.toMatch(/\{\w+\}/);
  });
});
