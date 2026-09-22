// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { useState, type JSX } from 'react';

import type { PlotHook } from '@storyengine/shared';

import { ApiError, type LibraryObject } from '../api.js';
import { blankFor, isRequiredField, type EditorKind as Kind } from '../library/fields.js';
import { useEditorBase } from '../queries.js';
import { page } from '../ui/classes.js';
import { Field } from '../ui/Field.js';
import type { Draft } from './book-form.js';
import { EditorFrame } from './EditorFrame.js';
import { hooksOf, withHooks } from './hook-form.js';
import { HookList } from './HookList.js';
import { useObjectEditor, type EditorKind } from './object-editor.js';
import { SchemaFields } from './SchemaFields.js';
import { Note } from '../ui/Text.js';

/**
 * An editor that is entirely the schema's shape — [P7B.3], [P7B.6].
 *
 * **The treatment, setup and package editors are this component three times.**
 * That is not a shortcut, it is the result the shell was built for: a preset
 * needed a hand-written block list because
 * [04 §8.1](../../../../docs/design/04-schemas.md)'s two block kinds edit
 * differently and no JSON schema says which one a block is. These three have no
 * such thing. Every field they carry is a field
 * [SchemaFields](./SchemaFields.tsx) can read out of the schema, in the
 * schema's own order and under its own group names
 * ([10 §11.2d](../../../../docs/design/10-ui-surfaces.md)).
 *
 * ***One field turned out to be such a thing after all***, and naming it here
 * is cheaper than letting the paragraph above quietly stop being true. A
 * `PlotHook`'s `magnitude` and `delivery` emit as `anyOf` of `const`s with no
 * top-level `type`, so the schema says *closed union* in a way the generic
 * renderer cannot read and it falls through to a free-text box; `introduces`
 * is a nested object with a list inside it. So `hooks` is drawn by
 * [HookList](./HookList.tsx) on the kinds that declare it, and the exception is
 * one flag on the declaration rather than a section slot — see `SimpleKind`
 * below for why that distinction is the point.
 *
 * ***The bar is [P7B §0.4]'s, and saying it plainly is part of the work:
 * usable, not complete.*** *Create, rename, delete, and the durable core …
 * with everything else visible and read-only* is [10 §11.2d]'s minimum on the
 * P1 precedent. A treatment's cast rows and a package's member list arrive here
 * **shown as stored and not writable**, which is a real limit and a stated one:
 * `SchemaFields` renders such a field with the sentence *this editor does not
 * write this field yet* rather than dropping it, because a field silently
 * absent from an editor is a field a user cannot discover is there
 * ([10 §2.1](../../../../docs/design/10-ui-surfaces.md) forbids hidden fields).
 *
 * **What this replaces is worse than an incomplete form**: before this, the
 * only way to change a treatment's framing — the sentence injected into every
 * single turn — was to write JSON by hand or to POST it with `curl`.
 */

export interface SimpleKind {
  kind: Kind;
  schemaId: string;
  /** The page's subtitle: what this kind *is*, in one line. */
  blurb: string;
  /** *Back to the treatment*. */
  backLabel: string;
  /** *This treatment has unsaved changes*. */
  unsavedHeading: string;
  /** The 412's whole sentence — see `ConflictDialog` for why not a noun. */
  conflictTitle: string;
  /** *The saved treatment, not the form's working state…* */
  storedCaption: string;
  /** *A treatment needs a name.* */
  nameRefusal: string;
  /** What this page says when the file cannot back a form. */
  unopenable: (problem: string) => string;
  notFound: string;
  untitled: { draft: string; saved: string };
  editorRoute: string;
  /** Fields this page leaves to `SchemaFields` to show read-only, with a reason. */
  readOnly?: Readonly<Record<string, string>>;
  /**
   * Whether this page authors the carrier's `hooks` itself —
   * [03 §4.1](../../../../docs/design/03-data-model.md).
   *
   * ***A named field rather than a section slot***, and that is a decision
   * about this file rather than about hooks. The thing that keeps these three
   * editors honest is that everything on the page comes out of the schema
   * except what this interface names out loud; a `sections?: ReactNode[]` would
   * let any kind mount anything here and quietly turn a declaration into a
   * component again. There is exactly one field the schema renderer cannot
   * draw — `PlotHook`'s two enums emit as `anyOf` of `const`s with no top-level
   * type, so `SchemaFields` would give a closed union a free-text box — so it
   * is spelled as the exception it is. A second one is a second field, and by
   * the third the generalisation will have been earned rather than guessed.
   *
   * **`true` is the only value, because *off* is the field's absence.** A kind
   * that wrote `hooks: false` would be making a claim about a kind that has no
   * hooks at all, which `PACKAGES` is: a package carries objects, and the hooks
   * it travels with belong to them.
   */
  hooks?: true;
  /**
   * The sentence under the hook list's heading — what *this* carrier's hooks
   * are.
   *
   * Held here rather than written into `HookList` because the three carriers
   * mean three different things by the same field, which is the whole of
   * [03 §4.1](../../../../docs/design/03-data-model.md)'s *where hooks live*: a
   * Treatment is the primary home, a Setup adds to it rather than replacing it,
   * and a Lorebook is deliberately secondary. A component that guessed which of
   * them it was mounted on would be a component that has to be told the kind,
   * which is the coupling these declarations exist to avoid.
   *
   * Separate from the flag rather than folded into it, because `HookList`'s own
   * note is optional and the flag is the thing that decides the section exists
   * at all — a carrier with nothing distinguishing to say gets the heading.
   */
  hookNote?: string;
}

function nameOf(draft: Draft): string {
  return typeof draft['name'] === 'string' ? draft['name'] : '';
}

/**
 * Why this object cannot back the form, or null.
 *
 * **One check, because one field is all these editors dereference.** The actor
 * and preset guards are longer because their editors walk a list; these walk
 * nothing the schema renderer does not already survive — it reads values and
 * draws what it finds, including nothing.
 */
function shapeOf(object: Record<string, unknown>): string | null {
  return typeof object['name'] === 'string' ? null : 'its "name" is not a string';
}

export function descriptorFor(kind: SimpleKind): EditorKind<Draft> {
  return {
    kind: kind.kind,
    formOf: (object) => structuredClone(object),
    apply: (_base, draft) => draft,
    changed: (base, draft) => JSON.stringify(draft) !== JSON.stringify(base),
    shape: shapeOf,
    /**
     * The 412 merge — field by field at the top level, and hook by hook inside
     * `hooks`.
     *
     * ~~Coarser than the lorebook's entry-by-entry merge and the preset's
     * block-by-block one, and that is right rather than lazy: those two have a
     * keyed list where *which one did I edit* is answerable. These do not, so
     * the honest unit is the field — an untouched field takes the newer value,
     * which is the rule the 412's first offer means.~~
     *
     * ***The premise changed, and the reasoning is kept because it is still the
     * reasoning for every other field.*** These pages now *do* have a keyed list
     * they write: a treatment's and a setup's `hooks`, authored here rather than
     * shown as stored. So *which one did I edit* is answerable for that one
     * field, and the field stopped being the honest unit for it.
     *
     * Left as it was, the first save conflict on a treatment with hooks would
     * take one side's whole list — mine if I had touched any hook at all,
     * theirs if I had not — and drop the other's without a word, inside the
     * dialog whose entire offer is *reapply my edits*. That is the same
     * take-one-side-whole `reapplyEdits` still makes for an actor's writing
     * samples, and it is defensible *there* for the reason that function gives:
     * a sample has no id, so *did this one change* is not an answerable
     * question. A hook has one, and it is an id that must survive every copy of
     * the hook, so here the question is answerable and the coarse answer is
     * only a loss.
     *
     * Everything outside `hooks` keeps the field rule, including `hooks` itself
     * on a kind that does not author it — a package's draft has no such field,
     * and a merge that wrote one would be inventing a key from a page that
     * never showed it.
     */
    reapply: (pristine, mine, fresh) => {
      const merged = structuredClone(fresh);
      for (const key of Object.keys(mine)) {
        if (key === 'hooks' && kind.hooks !== undefined) continue;
        if (JSON.stringify(pristine[key]) !== JSON.stringify(mine[key])) merged[key] = mine[key];
      }
      if (kind.hooks === undefined) return merged;
      return withHooks(merged, mergedHooks(pristine, mine, fresh));
    },
    requiredValues: (draft) => ({ name: nameOf(draft) }),
    requiredLabels: { name: 'Name' },
    nameOf,
    untitled: kind.untitled,
    editorRoute: kind.editorRoute,
  };
}

/**
 * Their hooks with mine put back — per hook, keyed on id, resolved against the
 * draft as it read when I opened it.
 *
 * **What makes the finer unit available is a fact about hooks rather than a
 * better idea**, which is the same sentence [book-form.ts](./book-form.ts)
 * writes about entries: a hook's `id` is a uuid that must survive every copy of
 * the hook ([15 §5.1](../../../../docs/design/15-world.md) — a hook fired in
 * one session must not fire again in the next of the same continuity), so *was
 * this here when I opened it* is answerable, and the three cases can each be
 * given the answer they actually want.
 *
 * - **In both** — whichever of us changed it from `pristine` wins; if neither
 *   did, it stays theirs, which is what an untouched field means everywhere
 *   else in this merge.
 * - **In theirs and not in mine** — I removed it *if it was in `pristine`*, and
 *   otherwise they added it while I was editing. Those want opposite outcomes
 *   and `pristine` is the only thing that tells them apart: without it a merge
 *   either resurrects every deletion or discards every concurrent addition.
 * - **In mine and not in theirs** — I added it, and it stays; or they removed
 *   it, and it stays only if I had edited it, because keeping an untouched copy
 *   of something somebody deleted is undoing their delete rather than saving
 *   any work of mine.
 *
 * ***The whole hook rather than field by field, which is where this is coarser
 * than the entry merge it is modelled on.*** An entry is forty fields and a
 * book is usually opened to change one of them, so taking a whole entry from
 * one side would discard the other's edit to a field neither of us contested.
 * A hook is eight fields on one card, written and read as a unit, and the case
 * a per-field merge would improve is two people editing *different fields of
 * the same hook* at the same time — one conflict finer than the one this change
 * exists to stop. The finer version already exists as `withMyFields` in
 * `book-form.ts`; the way to have it here is to export that, not to keep a
 * second copy of it, which is the duplication that module's own docstring
 * argues against.
 *
 * Order follows theirs with anything of mine they do not have appended, so a
 * concurrent addition is not shuffled to the end of somebody else's list. The
 * loss that takes is my *reorder*, and it is a cheap one here in a way it would
 * not be for a lorebook: a hook list's order is for the person reading it and
 * nothing downstream depends on it, which `poolFor`
 * (`packages/server/src/sessions/hook-pool.ts`) states from the other side —
 * *"nothing downstream depends on it — selection is weighted"*.
 */
function mergedHooks(pristine: Draft, draft: Draft, fresh: Draft): PlotHook[] {
  const was = new Map(hooksOf(pristine).map((hook) => [hook.id, JSON.stringify(hook)]));
  const mine = new Map(hooksOf(draft).map((hook) => [hook.id, hook]));

  const kept = hooksOf(fresh).flatMap((hook) => {
    const held = mine.get(hook.id);
    if (held === undefined) return was.has(hook.id) ? [] : [hook];
    return [was.get(hook.id) === JSON.stringify(held) ? hook : held];
  });

  const theirs = new Set(hooksOf(fresh).map((hook) => hook.id));
  const rescued = hooksOf(draft).filter((hook) => {
    if (theirs.has(hook.id)) return false;
    const before = was.get(hook.id);
    // Not theirs any more, which is two situations. I made it, and it stays; or
    // they deleted it, and it stays only if I had changed it. Two statements
    // rather than one disjunction, because as one the first arm is silently
    // unfalsifiable — `was.get` of a hook I created is `undefined`, so the
    // comparison below is already true for it.
    if (before === undefined) return true;
    return JSON.stringify(hook) !== before;
  });

  return [...kept, ...rescued];
}

/**
 * ***The column belongs here, and it is six routes at once***
 * ([`kinds.tsx`](./kinds.tsx) delegates all three editors to this component and
 * all three create routes to the one below).
 *
 * `page.tooling` is [P3.−1]'s settlement — the shell's `<main>` is a bare
 * scroll container and **pages own their column**, which
 * [`ui/classes.ts`](../ui/classes.ts) states and gives the mechanical reason
 * for. *These six never had one*, corrected 2026-09-15: without it the form ran
 * edge to edge with no gutter, and the only left padding on screen came from
 * the nested disclosures `SchemaFields` draws — so the sections read as
 * indented when in fact everything else was flush against the window.
 *
 * Wrapped around the whole loader rather than around the editor, so pending,
 * error, read-only and the form all lay out alike; `ActorEditorPage` gives the
 * same reason for the same placement.
 */
export function SimpleEditorLoader(props: { kind: SimpleKind; id: string }): JSX.Element {
  return (
    <div className={page.tooling}>
      <SimpleEditorBody kind={props.kind} id={props.id} />
    </div>
  );
}

function SimpleEditorBody(props: { kind: SimpleKind; id: string }): JSX.Element {
  const base = useEditorBase(props.kind.kind, props.id);

  if (base.isPending) return <Note>Loading…</Note>;
  if (base.isError) {
    const missing = base.error instanceof ApiError && base.error.status === 404;
    return (
      <p role="alert" className="text-danger-ink">
        {missing ? props.kind.notFound : base.error.message}
      </p>
    );
  }
  if (base.data.source === 'system') {
    return (
      <p role="alert" className="text-ink-muted">
        System library objects are read-only. Copy it to your library to edit it.
      </p>
    );
  }

  const problem = shapeOf(base.data.object);
  if (problem !== null) {
    return (
      <p role="alert" className="text-danger-ink">
        {props.kind.unopenable(problem)}
      </p>
    );
  }
  return <SimpleEditor kind={props.kind} initial={base.data} />;
}

/** A new one, from the shared factory — the blank the API's own create path makes. */
export function NewSimplePage(props: { kind: SimpleKind }): JSX.Element {
  const [draft] = useState<LibraryObject>(() => {
    const object = blankFor(props.kind.kind);
    return {
      id: object['id'] as string,
      schema: object['schema'] as string,
      name: '',
      slug: '',
      contentHash: '',
      source: 'user' as const,
      shadowed: false,
      object,
    };
  });

  return (
    <div className={page.tooling}>
      <SimpleEditor kind={props.kind} initial={draft} unsaved />
    </div>
  );
}

function SimpleEditor(props: {
  kind: SimpleKind;
  initial: LibraryObject;
  unsaved?: boolean;
}): JSX.Element {
  const descriptor = descriptorFor(props.kind);
  const editor = useObjectEditor(descriptor, props.initial, {
    ...(props.unsaved === undefined ? {} : { unsaved: props.unsaved }),
  });
  const { form: draft, missing } = editor;

  return (
    <EditorFrame
      editor={editor}
      descriptor={descriptor}
      conflictTitle={props.kind.conflictTitle}
      backLabel={props.kind.backLabel}
      unsavedHeading={props.kind.unsavedHeading}
      listSearch={{ kind: props.kind.kind }}
      formClassName="flex flex-col gap-6"
      storedCaption={props.kind.storedCaption}
      header={
        <header className="mb-6">
          <h1 className="text-title text-ink">{editor.heading}</h1>
          <Note>{props.kind.blurb}</Note>
        </header>
      }
    >
      <Field
        label="Name"
        value={nameOf(draft)}
        onChange={(name) => {
          editor.patch({ ...draft, name });
        }}
        required={isRequiredField(props.kind.kind, 'name')}
        error={missing.includes('name') ? props.kind.nameRefusal : null}
      />

      <SchemaFields
        schemaId={props.kind.schemaId}
        value={draft}
        // `hooks` joins `name` as a field this page draws itself. Without it
        // the array is rendered twice — once by the generic renderer, which
        // reads an array of objects as a structure it will not invent a form
        // for and prints it as JSON, and once by the list below that does.
        handled={props.kind.hooks === undefined ? ['name'] : ['name', 'hooks']}
        {...(props.kind.readOnly === undefined ? {} : { readOnly: props.kind.readOnly })}
        onChange={(key, next) => {
          editor.patch({ ...draft, [key]: next });
        }}
      />

      {/*
       * **After the schema's fields rather than lifted above them**, which is
       * the order the rest of this page already reads in: the identity of the
       * thing first, then the structures that hang off it. A hook list put
       * above `framing` would stand a treatment's plot pool in front of the
       * sentence that is injected into every single turn.
       */}
      {props.kind.hooks === undefined ? null : (
        <HookList
          hooks={hooksOf(draft)}
          onChange={(next) => {
            editor.patch(withHooks(draft, next));
          }}
          {...(props.kind.hookNote === undefined ? {} : { note: props.kind.hookNote })}
        />
      )}
    </EditorFrame>
  );
}
