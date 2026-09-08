// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import type { Actor, Section, WritingSample } from '@storyengine/shared';

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

/**
 * One writing sample as the form holds it — [10 §3.1].
 *
 * `priorityText` rather than `number | undefined` because the field is an
 * input and an input's empty state is a string. Blank means *inherit the slot
 * block's priority*, which is the common case and must stay expressible; a
 * form that coerced blank to 0 would silently make every sample the first
 * thing dropped.
 */
export interface SampleForm {
  id: string;
  title: string;
  body: string;
  enabled: boolean;
  priorityText: string;
}

export interface ActorForm {
  name: string;
  pronouns: string;
  /** One entry per line in the editor; empty lines dropped on apply. */
  aliasesText: string;
  /**
   * **A list, where every other text field here is text** — [25](../../../../docs/design/25-tagging.md).
   *
   * The other three are strings because a textarea's *text is the state and the
   * array is derived*: splitting on every keystroke eats the newline somebody
   * just typed, which is the trap `EntryFields` spells out at length. A
   * tokenizer has no such buffer — the half-typed term lives inside the field
   * and the committed value is always a clean array — so keeping this as text
   * would mean round-tripping every chip through `splitLines`/`joinLines`,
   * whose trim-and-drop-empties behaviour is right for a textarea and means
   * nothing here.
   */
  tags: string[];
  traitsText: string;
  sections: SectionForm[];
  /** Unlike sections, this list can grow and shrink — see `applyForm`. */
  samples: SampleForm[];
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
    if (typeof section !== 'object' || section === null)
      return 'a profile section is not an object';
    const fields = section as Record<string, unknown>;
    if (typeof fields['id'] !== 'string') return 'a profile section has no "id" string';
    if (typeof fields['title'] !== 'string') return 'a profile section has no "title" string';
    if (typeof fields['body'] !== 'string') return 'a profile section has no "body" string';
  }
  // Absent is legal and common — every card written before the field existed
  // has none ([10 §2]). Only a present-but-wrong shape is a refusal.
  const samples: unknown = object['writingSamples'];
  if (samples !== undefined) {
    if (!Array.isArray(samples)) return 'its "writingSamples" is not a list';
    for (const sample of samples as unknown[]) {
      if (typeof sample !== 'object' || sample === null) return 'a writing sample is not an object';
      const fields = sample as Record<string, unknown>;
      if (typeof fields['id'] !== 'string') return 'a writing sample has no "id" string';
      if (typeof fields['title'] !== 'string') return 'a writing sample has no "title" string';
      if (typeof fields['body'] !== 'string') return 'a writing sample has no "body" string';
    }
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
    tags: [...actor.tags],
    traitsText: joinLines(actor.profile.traits),
    sections: actor.profile.sections.map((section) => ({
      id: section.id,
      title: section.title,
      body: section.body,
      disposition: section.disposition,
    })),
    samples: (actor.writingSamples ?? []).map((sample) => ({
      id: sample.id,
      title: sample.title,
      body: sample.body,
      // A card hand-edited to omit `enabled` reads as on, which is the
      // forgiving direction: the alternative silently stops sending prose the
      // author can see in the editor. Widened before the test because the
      // declared type says `boolean` and this whole module exists for files
      // that are not what the type says they are.
      enabled: (sample.enabled as boolean | undefined) ?? true,
      priorityText: sample.priority === undefined ? '' : String(sample.priority),
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
  actor.tags = [...form.tags];
  actor.profile.traits = splitLines(form.traitsText);
  actor.profile.sections = actor.profile.sections.map((section) => {
    const edited = form.sections.find((candidate) => candidate.id === section.id);
    return edited ? { ...section, title: edited.title, body: edited.body } : section;
  });

  /**
   * Writing samples, which are the first list in this form that can **grow and
   * shrink** — sections are a fixed set edited in place.
   *
   * Two traps, both of which this handles deliberately:
   *
   * - **Unknown fields inside a sample survive**, via `...before`. The
   *   module's first promise ([10 §2]) is per-object, and a sample is an
   *   object; rebuilding one from the form's five fields would strip anything
   *   a newer build wrote into it.
   * - **An absent list stays absent.** Assigning `[]` onto a card that never
   *   had the field is a change, which would mark a freshly-opened old actor
   *   dirty and defeat the no-op rule ([02 §11.1]) the moment anybody pressed
   *   save. So the field is written only when there is something to write or
   *   it was already there.
   */
  const before = new Map((actor.writingSamples ?? []).map((sample) => [sample.id, sample]));
  if (form.samples.length > 0 || Object.hasOwn(clone, 'writingSamples')) {
    actor.writingSamples = form.samples.map((sample) => {
      const previous = before.get(sample.id);
      const next: WritingSample = {
        ...previous,
        id: sample.id,
        title: sample.title,
        body: sample.body,
        enabled: sample.enabled,
        note: previous?.note ?? '',
      };

      // Blank means *inherit the block's priority*, so it must delete rather
      // than coerce — `Number('')` is 0, which would be the lowest priority
      // in the pack rather than no opinion at all.
      const priority = Number.parseInt(sample.priorityText.trim(), 10);
      if (Number.isFinite(priority)) next.priority = priority;
      else delete next.priority;

      return next;
    });
  }

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
  const scalar = <K extends 'name' | 'pronouns' | 'aliasesText' | 'traitsText'>(
    key: K,
  ): ActorForm[K] => (edited[key] !== pristine[key] ? edited[key] : fresh[key]);

  return {
    name: scalar('name'),
    pronouns: scalar('pronouns'),
    aliasesText: scalar('aliasesText'),
    /**
     * **The list arm, which is `samples`' below and for its reason.**
     *
     * Tags left the `scalar` union when they stopped being a string, and the
     * change is not only mechanical: a reference comparison would have been
     * unequal on every render, so the merge would have silently always taken
     * the user's side. Asking the one question a list *can* answer — did this
     * user touch tags at all — takes one side whole, which is coarse in the
     * safe direction.
     *
     * It is also strictly better than the string was. The old comparison was on
     * *spelling*, so a tag renamed underneath an open form read as an edit.
     */
    tags: JSON.stringify(edited.tags) === JSON.stringify(pristine.tags) ? fresh.tags : edited.tags,
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
    /**
     * **Coarse on purpose, and the coarseness is the safe direction.**
     *
     * Every other field here merges per-field because the set of fields is
     * fixed. Samples are a list the user can add to and delete from, so "did
     * this one change" is not answerable for a sample that exists on one side
     * only: a sample missing from `fresh` might be one the other writer
     * deleted or one this writer added, and the two want opposite outcomes.
     *
     * Rather than guess, this asks the one question that *is* answerable —
     * *did this user touch samples at all?* — and takes one side whole. Untouched
     * yields to the newer object, which is what stops a stale copy overwriting
     * a concurrent edit; touched keeps the user's list, which is what stops
     * "reapply my edits" silently discarding the sample they just wrote.
     */
    samples:
      JSON.stringify(edited.samples) === JSON.stringify(pristine.samples)
        ? fresh.samples
        : edited.samples,
  };
}
