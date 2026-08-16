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
  reapplyEdits,
  splitLines,
  stampUpdated,
} from './form.js';

/**
 * The editor's two promises, tested where they live
 * ([P1 §P1.7](../../../../docs/design/workplan/03-p1-implementation.md)): unknown fields survive a
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
    // [05 §11.2]: nothing writes GeneratedFieldProvenance until P2, and the
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
    form.tagsText = 'noir\nfixer';
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

  it('stamps updatedAt without touching anything else', () => {
    const base = actorWithUnknowns();
    // A fixed past value — a stamp taken in the same millisecond as newActor()
    // would be equal, and prove nothing.
    (base['provenance'] as Record<string, unknown>)['updatedAt'] = '2026-08-01T00:00:00.000Z';
    const stamped = stampUpdated(base);
    const changes = diffObjects(base, stamped);
    expect(changes).toHaveLength(1);
    expect(changes[0]!.path).toBe('provenance.updatedAt');
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
    edited.tagsText = 'noir\nfixer';
    const theirs = structuredClone(original);
    (theirs as unknown as { profile: { sections: { body: string }[] } }).profile.sections[1]!.body =
      'Rain-soaked coat.';
    const fresh = formFromActor(theirs);

    const merged = reapplyEdits(pristine, edited, fresh);
    expect(merged.tagsText).toBe('noir\nfixer');
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
