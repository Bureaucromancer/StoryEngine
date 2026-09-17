// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { useNavigate } from '@tanstack/react-router';
import { useRef, useState } from 'react';

import { uuidv7, type GeneratedFieldProvenance } from '@storyengine/shared';

import { ApiError, type LibraryKind, type LibraryObject } from '../api.js';
import { missingRequired, refusalFor } from '../library/fields.js';
import { useCreateObject, useSaveObject } from '../queries.js';

/**
 * **One editor, six kinds** — [P7B.1], and the reason it is a hook rather than
 * six copies of a component.
 *
 * Until this there were two editors and they were written out twice. That was
 * defensible at two: [polish §1](../../../../docs/design/workplan/06-polish.md)'s
 * closing note is *only what a design decision shares is lifted*, and an actor
 * and a lorebook share little at the field level. But what they share is not
 * fields — it is **a state machine**, and it is a subtle one: a base and a
 * form that move together, a pristine copy that only exists so a 412 can
 * reapply *my edits* rather than *my form*, a save that is a create the first
 * time, a refusal that focuses rather than a button that greys out, and a stamp
 * that must not fire on a no-op.
 *
 * ***The two copies had already drifted, which is the evidence rather than the
 * theory.*** `ObjectDetailPage`'s `mutable` records the same thing happening to
 * a two-line predicate: Edit and Delete grew separate spellings and disagreed on
 * `shadowed`, and the disagreement was a control that deleted the wrong folder.
 * A state machine this size, spelled four more times for presets, treatments,
 * setups and packages, is that bug with more surface and no natural place for
 * anyone to notice.
 *
 * **What is deliberately not here: the fields.** A preset's block list, a
 * lorebook's entry list and an actor's sections are genuinely different
 * surfaces, and a hook that tried to own them would have to be told about all
 * of them. Structure comes from
 * [SchemaFields](./SchemaFields.tsx) where the schema can supply it, and from a
 * hand-written component where it cannot — the same division
 * [ByField](../library/ByField.tsx) already draws on the read side.
 */

/**
 * What one kind has to say about itself for the shell to edit it.
 *
 * **Every member of this already existed** for actors in [form.ts](./form.ts)
 * and for lorebooks in [book-form.ts](./book-form.ts) — which is the argument
 * that the contract is discovered rather than invented. The four new kinds
 * implement the same eight functions.
 */
export interface EditorKind<F> {
  kind: LibraryKind;
  /** The form state this object reads as. */
  formOf: (object: Record<string, unknown>) => F;
  /**
   * The object this form writes, over the one that was loaded.
   *
   * **Over, never instead of** — [04 §2]'s rule that a reader preserves unknown
   * fields is kept by assigning only what the form owns onto a clone of what
   * was read. An implementation that built a fresh object from the form would
   * silently drop everything this build has not heard of.
   */
  apply: (base: Record<string, unknown>, form: F) => Record<string, unknown>;
  /** Whether the form differs from what was loaded. Drives Save and the guard. */
  changed: (base: Record<string, unknown>, form: F) => boolean;
  /**
   * Why this object cannot back the form, or null when it can — the crash
   * guard, not schema validation (the server owns that).
   *
   * It exists because the product *invites* the input that breaks a cast: a
   * hand-edited file is the storage thesis working, and a white screen on the
   * invited input is the one answer an editor may not give.
   */
  shape: (object: Record<string, unknown>) => string | null;
  /**
   * Only the fields actually edited, reapplied over a newer object — the 412's
   * first offer. An untouched field must take the newer value, or the reload
   * eats the very change the 412 refused to overwrite.
   */
  reapply: (pristine: F, mine: F, fresh: F) => F;
  /** The values `missingRequired` checks, by field key. */
  requiredValues: (form: F) => Record<string, string>;
  /** Human labels for those keys, for the refusal sentence. */
  requiredLabels: Record<string, string>;
  /** The name, for the heading, the *(copy)* suffix and the empty-name fallback. */
  nameOf: (form: F) => string;
  /** What to call one with no name — a draft and a saved one read differently. */
  untitled: { draft: string; saved: string };
  /** Where this kind's editor lives, for the create and copy redirects. */
  editorRoute: string;
}

export interface ObjectEditor<F> {
  /** What is on disk, as far as this page knows. */
  base: LibraryObject;
  form: F;
  /** Patch the form and clear the notice and refusal, which is always wanted together. */
  patch: (next: F | ((previous: F) => F)) => void;
  /** Never written, so there is nothing on disk for any of this to be about. */
  unsaved: boolean;
  changed: boolean;
  /** Whether Save has anything to do — not the same question as `changed`. */
  savable: boolean;
  /** The required fields this form is not currently answering. */
  missing: readonly string[];
  notice: string | null;
  refusal: string | null;
  conflict: LibraryObject | null;
  historyOpen: boolean;
  setHistoryOpen: (open: boolean | ((was: boolean) => boolean)) => void;
  formRef: React.RefObject<HTMLFormElement | null>;
  heading: string;
  save: () => void;
  savePending: boolean;
  /**
   * What the write said when it failed, or null — already filtered.
   *
   * **The 412 the dialog owns is removed here and no other is**, which is the
   * distinction the actor editor discovered the hard way: every 412 used to be
   * filtered out on the assumption the dialog had it, but the dialog only opens
   * when the body carried `current`, so a 412 without one vanished entirely.
   * Computed here rather than in the frame so the frame cannot get it wrong for
   * five kinds.
   */
  saveError: string | null;
  /** The 412's first offer: take theirs, reapply mine. */
  reloadAndReapply: () => void;
  /** The 412's second: mine becomes a new object, theirs keeps this one. */
  saveAsCopy: () => void;
  copyPending: boolean;
  copyError: string | null;
  dismissConflict: () => void;
  /** After a restore, so the page can re-seed without knowing how. */
  adopt: (object: Record<string, unknown>, contentHash: string, notice: string) => void;

  /**
   * ***Per-field generation provenance, the editor's copy*** —
   * [10 §11.2](../../../../docs/design/10-ui-surfaces.md),
   * [P11.2](../../../../docs/design/workplan/28-p11-implementation.md).
   *
   * **Held here rather than in each kind's form**, which is the same argument
   * this hook exists for: `generated` is keyed by dotted path and is a fact
   * about the *object*, so six form shapes would each have to carry it and each
   * would get the merge-on-save slightly differently. `apply` still owns the
   * fields; this is assigned over the top, in one place.
   *
   * *Marinara's shape, adopted as [10 §11.2] says to adopt it* — the original
   * value, the time, the model and the prompt it ran from — and the fourth
   * field is the one this build added: `unreviewed`, false the moment a person
   * edits it, which is what makes *"which of these did I actually write?"*
   * answerable later.
   */
  generatedAt: (path: string) => GeneratedFieldProvenance | null;
  /** The assist accepted: the model's words are in the field, and this is why. */
  recordGenerated: (path: string, record: GeneratedFieldProvenance) => void;
  /** A hand edit landed on a generated field, so it is no longer unreviewed. */
  markReviewed: (path: string) => void;
}

export function useObjectEditor<F>(
  descriptor: EditorKind<F>,
  initial: LibraryObject,
  options: { unsaved?: boolean } = {},
): ObjectEditor<F> {
  const [base, setBase] = useState(initial);
  const [form, setForm] = useState<F>(() => descriptor.formOf(initial.object));
  /**
   * The form as it read when `base` was loaded — what *my edits* is measured
   * against. Moves in step with `base`: after a save the two agree again, and
   * after reload-and-reapply it re-reads from the newer object.
   */
  const [pristineForm, setPristineForm] = useState<F>(() => descriptor.formOf(initial.object));
  const [conflict, setConflict] = useState<LibraryObject | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  /**
   * Why the last Save did not write — [10 §11.1a].
   *
   * Separate from `notice`, which is `role="status"`: a refusal is not a
   * progress report and has to interrupt.
   */
  const [refusal, setRefusal] = useState<string | null>(null);
  /**
   * The provenance map as the form has it — seeded from the loaded object and
   * re-seeded wherever `base` is, so a restore and a reload-and-reapply both
   * carry the right one rather than the one from before.
   */
  const [generated, setGenerated] = useState<Record<string, GeneratedFieldProvenance>>(() =>
    generatedOf(initial.object),
  );
  const formRef = useRef<HTMLFormElement | null>(null);

  const saveMutation = useSaveObject();
  const create = useCreateObject();
  const navigate = useNavigate();

  const unsaved = options.unsaved === true;
  const changed = descriptor.changed(base.object, form);
  /**
   * A draft nobody has typed into has no changes and still has a create to
   * make, so Save stays live and refuses with the reason ([10 §11.1a]) rather
   * than greying out and saying *No changes to save* about a thing that does
   * not exist.
   */
  const savable = unsaved || changed;
  const missing = missingRequired(descriptor.kind, descriptor.requiredValues(form));

  function patch(next: F | ((previous: F) => F)): void {
    setForm((previous) => (typeof next === 'function' ? (next as (was: F) => F)(previous) : next));
    setNotice(null);
    setRefusal(null);
  }

  function adopt(object: Record<string, unknown>, contentHash: string, message: string): void {
    setBase((previous) => ({ ...previous, object, contentHash }));
    setForm(descriptor.formOf(object));
    setPristineForm(descriptor.formOf(object));
    // A restored version carries its own provenance, and keeping the current
    // map would attribute this form's fields to generations that produced
    // different words.
    setGenerated(generatedOf(object));
    setNotice(message);
  }

  function save(): void {
    if (!savable) return;
    /**
     * **Refused here rather than prevented by a disabled button** — [10 §11.1a]
     * and [work plan §2.2]. The button that cannot be pressed is the one that
     * teaches nothing about why, so Save stays live and this says what is
     * wrong, beside the Save that caused it ([10 §11.6]), with the cursor moved
     * to the field that has to answer.
     */
    if (missing.length > 0) {
      setNotice(null);
      setRefusal(refusalFor(missing, descriptor.requiredLabels));
      formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
      return;
    }
    setRefusal(null);

    if (unsaved) {
      create.mutate(
        { kind: descriptor.kind, object: withGenerated(descriptor.apply(base.object, form)) },
        {
          onSuccess: (result) => {
            // `ignoreBlocker`: the edits have just been written, and the guard
            // is measuring them against a base this route never had.
            void navigate({
              to: descriptor.editorRoute,
              params: { id: result.id },
              ignoreBlocker: true,
            });
          },
        },
      );
      return;
    }

    /**
     * ***Sent unstamped, and settling a disagreement the two editors had.***
     *
     * The actor editor stamped `provenance.updatedAt` here; the lorebook editor
     * did not, and said at length why not. **The lorebook was right**, and the
     * server is the evidence: `library.ts` stamps `updatedAt` itself on any
     * real change, and decides the no-op rule on the object *as sent, before
     * any stamping* — so a client stamp never reaches disk and its only effect
     * is to make the sent bytes differ from the file, which disables the
     * server's byte comparison as an independent second opinion exactly when it
     * would be most useful.
     *
     * One shell cannot hold both, which is the point of having one. Settled the
     * way the argument went rather than the way the older code went.
     */
    const object = withGenerated(descriptor.apply(base.object, form));
    saveMutation.mutate(
      { kind: descriptor.kind, id: base.id, object, contentHash: base.contentHash },
      {
        onSuccess: (result) => {
          setBase((previous) => ({
            ...previous,
            object: result.object,
            contentHash: result.contentHash,
          }));
          setPristineForm(descriptor.formOf(result.object));
          setNotice('Saved.');
        },
        onError: (failure) => {
          if (failure instanceof ApiError && failure.status === 412 && failure.current) {
            // `ApiError.current` is `unknown`: three routes speak the 412 idiom
            // and carry three different shapes, so the narrowing happens where
            // the caller knows which one it asked for.
            setConflict(failure.current as LibraryObject);
          }
        },
      },
    );
  }

  function reloadAndReapply(): void {
    if (conflict === null) return;
    // The 412 body is parsed without validation, so guard before the cast —
    // the same rule as the loader, for the same hand-edited input.
    const problem = descriptor.shape(conflict.object);
    if (problem !== null) {
      setConflict(null);
      setNotice(
        `The newer version could not be loaded into the form: ${problem}. Fix the file on disk, then reload this page.`,
      );
      return;
    }
    const fresh = descriptor.formOf(conflict.object);
    setForm(descriptor.reapply(pristineForm, form, fresh));
    setPristineForm(fresh);
    setBase(conflict);
    setConflict(null);
    setNotice(
      'The newer version was loaded and your edits were reapplied over it. Review, then save again.',
    );
  }

  function saveAsCopy(): void {
    if (conflict === null) return;
    /**
     * Unstamped, like the save above — and a copy inherits the original's
     * `createdAt` and `updatedAt`, which is what `structuredClone` has always
     * done on the lorebook side. **Left rather than fixed here**: what a fork's
     * provenance should say is a question about provenance, and [P7B §1.2]
     * parks the same question for *Copy to my library*. Fixing it in the stage
     * that unified two editors would be deciding it by accident.
     */
    const object = withGenerated(descriptor.apply(base.object, form));
    object['id'] = uuidv7();
    object['name'] = `${descriptor.nameOf(form)} (copy)`;
    create.mutate(
      { kind: descriptor.kind, object },
      {
        onSuccess: (result) => {
          setConflict(null);
          void navigate({
            to: descriptor.editorRoute,
            params: { id: result.id },
            ignoreBlocker: true,
          });
        },
      },
    );
  }

  /**
   * A name for the page before there is one for the object.
   *
   * The entry list has said *Untitled entry* since P5.1 for the same reason: a
   * heading that renders an empty string is a heading somebody reads as a
   * broken page rather than as an unanswered field.
   */
  const named = descriptor.nameOf(form).trim();
  const heading =
    named === '' ? (unsaved ? descriptor.untitled.draft : descriptor.untitled.saved) : named;

  /**
   * The object with this editor's provenance assigned over it.
   *
   * **`null` rather than `{}` for an empty map**, because that is what the
   * schema says an object with no generated fields has
   * (`GeneratedMap` is `Record | null`) and an empty object would be a second
   * spelling of the same fact — which is the kind of difference that makes a
   * no-op save look like a change.
   */
  function withGenerated(object: Record<string, unknown>): Record<string, unknown> {
    const entries = Object.entries(generated);
    return { ...object, generated: entries.length === 0 ? null : Object.fromEntries(entries) };
  }

  return {
    base,
    form,
    patch,
    unsaved,
    changed,
    savable,
    missing,
    notice,
    refusal,
    conflict,
    historyOpen,
    setHistoryOpen,
    formRef,
    heading,
    save,
    generatedAt: (path) => generated[path] ?? null,
    recordGenerated: (path, record) => {
      setGenerated((was) => ({ ...was, [path]: record }));
      setNotice(null);
      setRefusal(null);
    },
    /**
     * ***Reviewed, not removed.*** A hand edit does not make the field
     * un-generated — [10 §11.2] wants the original kept so *revert to what the
     * model wrote* still works after the edit — it makes it **reviewed**, which
     * is the flag a library-wide *what did I actually write* view reads.
     */
    markReviewed: (path) => {
      setGenerated((was) => {
        const held = was[path];
        if (held?.unreviewed !== true) return was;
        return { ...was, [path]: { ...held, unreviewed: false } };
      });
    },
    savePending: saveMutation.isPending,
    saveError:
      saveMutation.isError &&
      !(
        saveMutation.error instanceof ApiError &&
        saveMutation.error.status === 412 &&
        saveMutation.error.current
      )
        ? saveMutation.error.message
        : null,
    reloadAndReapply,
    saveAsCopy,
    copyPending: create.isPending,
    copyError: create.isError ? create.error.message : null,
    dismissConflict: () => {
      setConflict(null);
    },
    adopt,
  };
}

/**
 * The provenance map an object carries, or an empty one.
 *
 * *Read defensively* for the reason every reader in this codebase is: the file
 * is hand-editable ([10 §4]), so `generated` can be a string, a number or an
 * array of nothing in particular, and a form that threw on one would make a
 * typo in a file somebody else edited into a page that will not open.
 */
function generatedOf(object: Record<string, unknown>): Record<string, GeneratedFieldProvenance> {
  const held = object['generated'];
  if (typeof held !== 'object' || held === null || Array.isArray(held)) return {};
  const out: Record<string, GeneratedFieldProvenance> = {};
  for (const [path, value] of Object.entries(held as Record<string, unknown>)) {
    if (typeof value !== 'object' || value === null) continue;
    const row = value as Partial<GeneratedFieldProvenance>;
    if (typeof row.original !== 'string') continue;
    out[path] = {
      original: row.original,
      at: typeof row.at === 'string' ? row.at : new Date(0).toISOString(),
      model: typeof row.model === 'string' ? row.model : null,
      seed: typeof row.seed === 'string' ? row.seed : null,
      unreviewed: row.unreviewed === true,
    };
  }
  return out;
}
