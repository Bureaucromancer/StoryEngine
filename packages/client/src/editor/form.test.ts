// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { describe, expect, it } from 'vitest';

import { newActor } from '@storyengine/shared';

import { diffObjects } from '../diff.js';
import {
  actorFormShape,
  applyForm,
  formChanges,
  formFromActor,
  priorityProblem,
  reapplyEdits,
  rowIndex,
  splitLines,
  withoutRow,
  withRow,
} from './form.js';

/**
 * The editor's two promises, tested where they live
 * ([P1 §P1.7](../../../../docs/design/workplan/07-p1-implementation.md)): unknown fields survive a
 * round trip through the form, and an unchanged form is detected as unchanged
 * — the client half of the no-op rule.
 */

function actorWithUnknowns(): Record<string, unknown> {
  const actor = newActor('Vera Solano') as unknown as Record<string, unknown>;
  actor['fromTheFuture'] = { keep: 'me' };
  actor['generated'] = {
    'profile.sections[0].body': {
      original: 'model-written summary',
      at: '2026-08-01T00:00:00Z',
      model: 'claude-opus-5',
      seed: 'a noir fixer',
    },
  };
  return actor;
}

describe('actorFormShape — the guard before the cast', () => {
  it('accepts a well-formed actor, unknown fields and all', () => {
    expect(actorFormShape(actorWithUnknowns())).toBeNull();
  });

  it('names the problem for the shapes formFromActor would crash on', () => {
    // The product invites hand edits; each of these is one keystroke away in
    // a text editor, and each was a white screen before the guard.
    const missingProfile = actorWithUnknowns();
    delete missingProfile['profile'];
    expect(actorFormShape(missingProfile)).toContain('profile');

    const badAliases = actorWithUnknowns();
    badAliases['aliases'] = 'not a list';
    expect(actorFormShape(badAliases)).toContain('aliases');

    const badSection = actorWithUnknowns();
    (badSection['profile'] as { sections: unknown[] }).sections = [{ title: 'no id' }];
    expect(actorFormShape(badSection)).toContain('section');

    const badName = actorWithUnknowns();
    badName['name'] = 7;
    expect(actorFormShape(badName)).toContain('name');
  });
});

describe('the form round trip', () => {
  it('preserves fields this build does not know', () => {
    const base = actorWithUnknowns();
    const form = formFromActor(base);
    form.sections[0]!.body = 'Edited through the form.';

    const built = applyForm(base, form);
    expect(built['fromTheFuture']).toEqual({ keep: 'me' });
  });

  it('preserves the generated provenance map — never authors it', () => {
    // [10 §11.2]: nothing writes GeneratedFieldProvenance until P2, and the
    // editor must not drop the map on save.
    const base = actorWithUnknowns();
    const form = formFromActor(base);
    form.name = 'Vera, renamed';

    const built = applyForm(base, form);
    expect(built['generated']).toEqual(base['generated']);
  });

  it('an untouched form changes nothing', () => {
    const base = actorWithUnknowns();
    expect(formChanges(base, formFromActor(base))).toBe(false);
  });

  it('an edit-and-undo changes nothing', () => {
    const base = actorWithUnknowns();
    const form = formFromActor(base);
    const original = form.name;
    form.name = 'Somebody else';
    form.name = original;
    expect(formChanges(base, form)).toBe(false);
  });

  it('detects a real edit', () => {
    const base = actorWithUnknowns();
    const form = formFromActor(base);
    form.tags = ['noir', 'fixer'];
    expect(formChanges(base, form)).toBe(true);

    const built = applyForm(base, form);
    expect(built['tags']).toEqual(['noir', 'fixer']);
  });

  it('treats a blank pronouns box as null, not an empty string', () => {
    // null means unknown, not "they" — and not "" either (13 §4).
    const base = actorWithUnknowns();
    const form = formFromActor(base);
    form.pronouns = '   ';
    expect((applyForm(base, form) as { pronouns: string | null }).pronouns).toBeNull();
  });
});

describe('reapplyEdits — the reload-and-reapply merge', () => {
  // Found live, not hypothesised: the first run of the 412 dialog reapplied
  // the whole form and quietly overwrote a concurrent hand edit with a stale
  // copy — the exact data-eating the 412 exists to prevent.
  it('keeps my edit and their edit when they touch different fields', () => {
    const original = actorWithUnknowns();
    const pristine = formFromActor(original);

    // My edit: the tags. Their edit, meanwhile: the appearance section.
    const edited = structuredClone(pristine);
    edited.tags = ['noir', 'fixer'];
    const theirs = structuredClone(original);
    (theirs as unknown as { profile: { sections: { body: string }[] } }).profile.sections[1]!.body =
      'Rain-soaked coat.';
    const fresh = formFromActor(theirs);

    const merged = reapplyEdits(pristine, edited, fresh);
    expect(merged.tags).toEqual(['noir', 'fixer']);
    expect(merged.sections[1]!.body).toBe('Rain-soaked coat.');
  });

  it('my edit wins on the field both touched', () => {
    const original = actorWithUnknowns();
    const pristine = formFromActor(original);

    const edited = structuredClone(pristine);
    edited.sections[0]!.body = 'Mine.';
    const theirs = structuredClone(original);
    (theirs as unknown as { profile: { sections: { body: string }[] } }).profile.sections[0]!.body =
      'Theirs.';
    const fresh = formFromActor(theirs);

    // Reapplying is the user's explicit choice in the dialog; on a genuinely
    // contested field, their form value is the one they chose to keep.
    expect(reapplyEdits(pristine, edited, fresh).sections[0]!.body).toBe('Mine.');
  });

  it('an untouched form takes the newer state wholesale', () => {
    const original = actorWithUnknowns();
    const pristine = formFromActor(original);
    const theirs = structuredClone(original);
    (theirs as unknown as { name: string }).name = 'Vera, renamed elsewhere';
    const fresh = formFromActor(theirs);

    expect(reapplyEdits(pristine, structuredClone(pristine), fresh)).toEqual(fresh);
  });
});

describe('splitLines', () => {
  it('drops blank lines and trims', () => {
    expect(splitLines(' noir \n\n fixer\n')).toEqual(['noir', 'fixer']);
  });
});

describe('diffObjects', () => {
  it('reports the changed field, and only the changed field', () => {
    const base = actorWithUnknowns();
    const form = formFromActor(base);
    form.sections[0]!.body = 'A new summary.';
    const changes = diffObjects(base, applyForm(base, form));

    expect(changes).toEqual([
      { path: 'profile.sections[0].body', before: '', after: 'A new summary.' },
    ]);
  });

  it('reports an added and a removed field with undefined on the empty side', () => {
    expect(diffObjects({ a: 1 }, { a: 1, b: 2 })).toEqual([
      { path: 'b', before: undefined, after: 2 },
    ]);
    expect(diffObjects({ a: 1, b: 2 }, { a: 1 })).toEqual([
      { path: 'b', before: 2, after: undefined },
    ]);
  });

  it('descends arrays by index', () => {
    expect(diffObjects({ list: ['a', 'b'] }, { list: ['a', 'c'] })).toEqual([
      { path: 'list[1]', before: 'b', after: 'c' },
    ]);
  });

  it('reports nothing for identical objects', () => {
    const base = actorWithUnknowns();
    expect(diffObjects(base, structuredClone(base))).toEqual([]);
  });
});

describe('writing samples, the first list the form can grow and shrink', () => {
  /** An actor whose samples carry a field this build has never heard of. */
  function actorWithSamples(): Record<string, unknown> {
    const actor = newActor('Vera Solano') as unknown as Record<string, unknown>;
    actor['writingSamples'] = [
      {
        id: 'ws-1',
        title: 'The rain never stops',
        body: 'Neon bled into the puddles.',
        enabled: true,
        note: 'the register, not the plot',
        priority: 40,
        stanceFromTheFuture: { keep: 'me' },
      },
    ];
    return actor;
  }

  it('leaves an absent list absent rather than writing an empty one', () => {
    // **The no-op rule where this field would break it** ([03 §11.1]).
    // Assigning `[]` onto a card that never had the field is a change: the
    // editor would mark a freshly-opened old actor dirty, and the first save
    // would rewrite a file nobody edited. Mutation: assign unconditionally and
    // `formChanges` turns true here.
    const base = newActor('Vera Solano') as unknown as Record<string, unknown>;
    delete base['writingSamples'];

    const form = formFromActor(base);
    expect(form.samples).toEqual([]);
    expect(formChanges(base, form)).toBe(false);
    expect(Object.hasOwn(applyForm(base, form), 'writingSamples')).toBe(false);
  });

  it('carries unknown fields inside a sample through a round trip', () => {
    // The module's first promise is per-object, and a sample is an object.
    // Mutation: build `next` without `...previous` and the future field is
    // stripped by anybody who opens the editor and saves.
    const base = actorWithSamples();
    const applied = applyForm(base, formFromActor(base));

    expect(applied['writingSamples']).toEqual(base['writingSamples']);
    expect(formChanges(base, formFromActor(base))).toBe(false);
  });

  it('treats a blank priority as no opinion, not as zero', () => {
    // `Number('')` is 0, which is the *lowest* priority in the pack rather
    // than "inherit the block's" — a coercion here would quietly make every
    // sample the first thing dropped from a full context.
    // Mutation: drop `priorityOf`'s blank arm.
    const base = actorWithSamples();
    const form = formFromActor(base);
    expect(form.samples[0]?.priorityText).toBe('40');

    form.samples[0] = { ...form.samples[0]!, priorityText: '  ' };
    const applied = applyForm(base, form) as { writingSamples: Record<string, unknown>[] };

    expect(Object.hasOwn(applied.writingSamples[0]!, 'priority')).toBe(false);
  });

  /**
   * ***A box that is not a number keeps what was stored*** (2026-10-01,
   * polish 10). `parseInt` read *12abc* as 12 and anything it could not read
   * at all as *inherit*, so a typo dropped a stored 40 on the next Save with
   * nothing said. The box now complains (`priorityProblem`), and the file keeps
   * its number until the box holds one.
   */
  it('keeps the stored priority while the box holds something that is not a number', () => {
    const base = actorWithSamples();
    for (const typed of ['12abc', '4o', '1.5', '1e3']) {
      const form = formFromActor(base);
      form.samples[0] = { ...form.samples[0]!, priorityText: typed };
      const applied = applyForm(base, form) as { writingSamples: Record<string, unknown>[] };

      expect(applied.writingSamples[0]?.['priority'], typed).toBe(40);
      expect(priorityProblem(typed), typed).toMatch(/^A whole number, or blank/);
    }
  });

  it('reads a whole number, signed and padded, and has nothing to say about it', () => {
    const base = actorWithSamples();
    for (const [typed, read] of [
      [' 55 ', 55],
      ['-3', -3],
      ['0', 0],
    ] as const) {
      const form = formFromActor(base);
      form.samples[0] = { ...form.samples[0]!, priorityText: typed };
      const applied = applyForm(base, form) as { writingSamples: Record<string, unknown>[] };

      expect(applied.writingSamples[0]?.['priority'], typed).toBe(read);
      expect(priorityProblem(typed), typed).toBeNull();
    }
    expect(priorityProblem('')).toBeNull();
  });

  it('keeps a hand-written sample missing `enabled` switched on', () => {
    // The storage thesis invites hand-edited cards, and the forgiving
    // direction is the one where prose the author can see is prose that gets
    // sent. Mutation: read `sample.enabled === true` and this flips off.
    const base = newActor('Vera') as unknown as Record<string, unknown>;
    base['writingSamples'] = [{ id: 'ws-1', title: 't', body: 'b', note: '' }];

    expect(formFromActor(base).samples[0]?.enabled).toBe(true);
  });

  it('refuses a sample list that is not a list of objects', () => {
    // The crash guard, not schema validation — `formFromActor` dereferences
    // `title` and `body`, so a hand-edited card holding strings must get a
    // sentence rather than a white screen.
    const base = newActor('Vera') as unknown as Record<string, unknown>;
    base['writingSamples'] = ['just a string'];
    expect(actorFormShape(base)).toBe('a writing sample is not an object');

    base['writingSamples'] = 'not a list';
    expect(actorFormShape(base)).toBe('its "writingSamples" is not a list');

    // Absent stays legal — every card written before the field has none.
    delete base['writingSamples'];
    expect(actorFormShape(base)).toBeNull();
  });

  it('yields to a concurrent edit when the user never touched samples', () => {
    // The 412 merge. Reapplying an untouched list would overwrite whatever
    // the other writer added — the exact data-eating `reapplyEdits` exists to
    // stop. Mutation: return `edited.samples` unconditionally.
    const pristine = formFromActor(actorWithSamples());
    const edited = { ...pristine, name: 'Vera S.' };
    const fresh = {
      ...pristine,
      samples: [
        ...pristine.samples,
        { id: 'ws-2', title: 'theirs', body: 'x', enabled: true, priorityText: '' },
      ],
    };

    expect(reapplyEdits(pristine, edited, fresh).samples).toHaveLength(2);
  });

  it('keeps the user’s list when they did touch samples', () => {
    // The other half: "reapply my edits" must not discard the sample they
    // just wrote. Mutation: return `fresh.samples` unconditionally.
    const pristine = formFromActor(actorWithSamples());
    const edited = {
      ...pristine,
      samples: [
        ...pristine.samples,
        { id: 'ws-3', title: 'mine', body: 'y', enabled: true, priorityText: '' },
      ],
    };
    const fresh = { ...pristine, samples: [] };

    const merged = reapplyEdits(pristine, edited, fresh);
    expect(merged.samples.map((sample) => sample.id)).toEqual(['ws-1', 'ws-3']);
  });
});

/**
 * ***Finding a row that may have moved*** (2026-09-27) — the lookup a late write
 * uses. The editor's writes are updaters over the form as it is when they land,
 * and the row a write is about may have moved since the render that made it:
 * an earlier sample removed while an assist on a later one ran.
 */
describe('rowIndex, withRow and withoutRow', () => {
  const row = (id: string, body = ''): { id: string; body: string } => ({ id, body });

  it('finds a row where it was drawn while it is still there', () => {
    const rows = [row('a'), row('b'), row('c')];
    expect(rowIndex(rows, 'b', 1)).toBe(1);
    expect(withRow(rows, 'b', 1, { body: 'written' })[1]).toEqual(row('b', 'written'));
  });

  it('follows a row that moved, by its id', () => {
    // `a` was removed after `c` was drawn at index 2.
    const rows = [row('b'), row('c')];
    expect(rowIndex(rows, 'c', 2)).toBe(1);
    expect(withRow(rows, 'c', 2, { body: 'written' })).toEqual([row('b'), row('c', 'written')]);
    expect(withoutRow(rows, 'c', 2)).toEqual([row('b')]);
  });

  /**
   * *Twins*: ids are required and not unique, so the index is what tells two
   * rows with one id apart — the second twin removed is the second twin, where
   * an id match would take the first, and every-match would take both.
   */
  it('keeps twins apart by where they were drawn', () => {
    const rows = [row('twin', 'first'), row('twin', 'second')];
    expect(withoutRow(rows, 'twin', 1)).toEqual([row('twin', 'first')]);
    expect(withRow(rows, 'twin', 1, { body: 'edited' })).toEqual([
      row('twin', 'first'),
      row('twin', 'edited'),
    ]);
  });

  it('leaves the list alone when the row has gone', () => {
    const rows = [row('a')];
    expect(rowIndex(rows, 'gone', 0)).toBe(-1);
    expect(withRow(rows, 'gone', 0, { body: 'written' })).toBe(rows);
    expect(withoutRow(rows, 'gone', 0)).toBe(rows);
  });
});
