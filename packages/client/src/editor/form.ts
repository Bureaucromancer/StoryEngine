// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import type { Actor, Section } from '@storyengine/shared';

/**
 * The mapping between an actor object and the editor's form state — pure, and
 * where the editor's two non-negotiable promises live:
 *
 * - **Unknown fields survive** ([10 §2](../../../../docs/design/10-schemas.md)).
 *   `applyForm` clones the loaded object and assigns only the fields the form
 *   owns, so anything this build has never heard of — including the
 *   `generated` provenance map nothing writes until P2 — rides through a save
 *   untouched.
 * - **A save that changes nothing is a no-op** ([02 §11.1]). `provenance.updatedAt`
 *   is bumped only when the built object actually differs, because stamping a
 *   new timestamp *is* a change and would defeat the server's no-op rule.
 */

export interface SectionForm {
  id: string;
  title: string;
  body: string;
  disposition: Section['disposition'];
}

export interface ActorForm {
  name: string;
  pronouns: string;
  /** One entry per line in the editor; empty lines dropped on apply. */
  aliasesText: string;
  tagsText: string;
  traitsText: string;
  sections: SectionForm[];
}

export function splitLines(text: string): string[] {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

export function joinLines(values: string[]): string {
  return values.join('\n');
}

/**
 * Why this object cannot back the actor form, in one sentence — or null when
 * it can.
 *
 * Checks exactly what `formFromActor` and `applyForm` dereference, no more:
 * this is a crash guard, not schema validation (the server owns that, and
 * pulling the shared Ajv validator into the bundle for it would be paying for
 * the wrong tool). It exists because the product *invites* the input that
 * breaks the cast below — a hand-edited card is the storage thesis working —
 * and a white screen on the invited input is the one answer the editor may
 * not give.
 */
export function actorFormShape(object: Record<string, unknown>): string | null {
  // Read through `unknown`, never through `Actor` — the whole premise here is
  // that the file may not be what the type says it is.
  if (typeof object['name'] !== 'string') return 'its "name" is not a string';
  const pronouns: unknown = object['pronouns'];
  if (pronouns !== null && pronouns !== undefined && typeof pronouns !== 'string')
    return 'its "pronouns" is neither a string nor null';
  if (!Array.isArray(object['aliases'])) return 'its "aliases" is not a list';
  if (!Array.isArray(object['tags'])) return 'its "tags" is not a list';
  const profile: unknown = object['profile'];
  if (typeof profile !== 'object' || profile === null) return 'it has no "profile" object';
  const shaped = profile as Record<string, unknown>;
  if (!Array.isArray(shaped['traits'])) return 'its "profile.traits" is not a list';
  if (!Array.isArray(shaped['sections'])) return 'its "profile.sections" is not a list';
  for (const section of shaped['sections'] as unknown[]) {
    if (typeof section !== 'object' || section === null) return 'a profile section is not an object';
    const fields = section as Record<string, unknown>;
    if (typeof fields['id'] !== 'string') return 'a profile section has no "id" string';
    if (typeof fields['title'] !== 'string') return 'a profile section has no "title" string';
    if (typeof fields['body'] !== 'string') return 'a profile section has no "body" string';
  }
  return null;
}

/** The form as loaded from an actor. `actorFormShape` must have passed first. */
export function formFromActor(object: Record<string, unknown>): ActorForm {
  const actor = object as unknown as Actor;
  return {
    name: actor.name,
    pronouns: actor.pronouns ?? '',
    aliasesText: joinLines(actor.aliases),
    tagsText: joinLines(actor.tags),
    traitsText: joinLines(actor.profile.traits),
    sections: actor.profile.sections.map((section) => ({
      id: section.id,
      title: section.title,
      body: section.body,
      disposition: section.disposition,
    })),
  };
}

/**
 * The form applied onto the loaded object. A clone with the form's fields
 * assigned — everything else, known or unknown, is carried through unchanged.
 * `updatedAt` is not touched here; see `stampUpdated`.
 */
export function applyForm(base: Record<string, unknown>, form: ActorForm): Record<string, unknown> {
  const clone = structuredClone(base);
  const actor = clone as unknown as Actor;

  actor.name = form.name;
  actor.pronouns = form.pronouns.trim() === '' ? null : form.pronouns.trim();
  actor.aliases = splitLines(form.aliasesText);
  actor.tags = splitLines(form.tagsText);
  actor.profile.traits = splitLines(form.traitsText);
  actor.profile.sections = actor.profile.sections.map((section) => {
    const edited = form.sections.find((candidate) => candidate.id === section.id);
    return edited ? { ...section, title: edited.title, body: edited.body } : section;
  });

  return clone;
}

/** True when saving `form` over `base` would actually change something. */
export function formChanges(base: Record<string, unknown>, form: ActorForm): boolean {
  return JSON.stringify(applyForm(base, form)) !== JSON.stringify(base);
}

/** A copy with `provenance.updatedAt` set to now — applied only to real changes. */
export function stampUpdated(object: Record<string, unknown>): Record<string, unknown> {
  const clone = structuredClone(object);
  const provenance = clone['provenance'];
  if (typeof provenance === 'object' && provenance !== null) {
    (provenance as Record<string, unknown>)['updatedAt'] = new Date().toISOString();
  }
  return clone;
}

/**
 * The reload-and-reapply merge, for the 412 dialog
 * ([04 §4.4](../../../../docs/design/04-server-multiuser-deployment.md)).
 *
 * "Reapply my edits" means the fields the user actually *edited* — the form
 * fields that differ from `pristine`, the form as it read when the stale base
 * was loaded. A field the user never touched takes the newer base's value.
 * Reapplying the whole form would quietly overwrite every concurrent change
 * with a stale copy, which is precisely the data-eating the 412 exists to
 * prevent — the first live run of this dialog did exactly that, and this
 * function is the fix.
 */
export function reapplyEdits(pristine: ActorForm, edited: ActorForm, fresh: ActorForm): ActorForm {
  const scalar = <K extends 'name' | 'pronouns' | 'aliasesText' | 'tagsText' | 'traitsText'>(
    key: K,
  ): ActorForm[K] => (edited[key] !== pristine[key] ? edited[key] : fresh[key]);

  return {
    name: scalar('name'),
    pronouns: scalar('pronouns'),
    aliasesText: scalar('aliasesText'),
    tagsText: scalar('tagsText'),
    traitsText: scalar('traitsText'),
    sections: fresh.sections.map((section) => {
      const before = pristine.sections.find((candidate) => candidate.id === section.id);
      const after = edited.sections.find((candidate) => candidate.id === section.id);
      if (!before || !after) return section;
      return {
        ...section,
        title: after.title !== before.title ? after.title : section.title,
        body: after.body !== before.body ? after.body : section.body,
      };
    }),
  };
}
