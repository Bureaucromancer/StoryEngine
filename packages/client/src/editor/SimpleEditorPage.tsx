// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { useState, type JSX } from 'react';

import { ApiError, type LibraryObject } from '../api.js';
import { blankFor, isRequiredField, type EditorKind as Kind } from '../library/fields.js';
import { useEditorBase } from '../queries.js';
import { page } from '../ui/classes.js';
import { Field } from '../ui/Field.js';
import { mergedHooks, type Draft } from './book-form.js';
import { EditorFrame } from './EditorFrame.js';
import { hooksOf, withHooks } from './hook-form.js';
import { HookList } from './HookList.js';
import { MembersField } from './MembersField.js';
import { contentsShape, membersOf, mergedMembers, withMembers } from './members-form.js';
import { useObjectEditor, type EditorKind } from './object-editor.js';
import { SchemaFields } from './SchemaFields.js';
import { Note } from '../ui/Text.js';

/**
 * An editor that is entirely the schema's shape — [P7B.3], [P7B.6].
 *
 * **The treatment, setup and World editors are this component three times** —
 * the World's was the package editor until [P16.0] renamed the kind.
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
 * P1 precedent. A treatment's cast rows ~~and a World's member list~~ arrive
 * here **shown as stored and not writable** — *the member list stopped being
 * one of them at [P16.1], drawn by [MembersField](./MembersField.tsx) under the
 * second named flag (`members`, below)* — which is a real limit and a stated one:
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
   * hooks at all, which `WORLDS` is (`PACKAGES` until [P16.0]): a World carries
   * objects, and the hooks it travels with belong to them.
   */
  hooks?: true;
  /**
   * Whether this page authors the World's `contents` itself —
   * [P16.1](../../../../docs/design/workplan/35-p16-world.md),
   * [15 §3.1](../../../../docs/design/15-world.md).
   *
   * ***The second exception, which is what `hooks` above said would come.***
   * *A second one is a second field, and by the third the generalisation will
   * have been earned rather than guessed* — so this is a second named flag
   * rather than the `sections?: ReactNode[]` that sentence declines. The
   * schema renderer cannot draw this one for a different reason than the
   * first: `contents` is a list of `{ schema, id, name }` envelopes that has to
   * be **picked** from what exists rather than typed, and whose every row has
   * to be **looked up** to say what it is now — a member's current name, or that
   * it is gone. `SchemaFields` reads a value and draws what it finds, which for
   * this field is three ids nobody can read and a form that would let somebody
   * type a fourth by hand.
   *
   * **`true` is the only value, because *off* is the field's absence** — the
   * `hooks` rule. Only `WORLDS` declares it; a kind with no `contents` has
   * nothing for the flag to turn on.
   */
  members?: true;
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
 * ~~**One check, because one field is all these editors dereference.** The actor
 * and preset guards are longer because their editors walk a list; these walk
 * nothing the schema renderer does not already survive — it reads values and
 * draws what it finds, including nothing.~~
 *
 * ***That stopped being true the moment a kind could declare `hooks`.*** The
 * reasoning above is exactly right about `SchemaFields`, which renders a value
 * of any shape opaquely and survives anything a hand edit can put in a file. It
 * does not reach [HookList](./HookList.tsx), which **walks a keyed list**: it
 * maps over `hooks`, keys each card on `hook.id`, and reads `hook.title` to name
 * every control on it. A treatment on disk whose `hooks` is `"none"` or `{}`
 * throws on the map; `[null]` throws on the key; `[{}]` throws in `nameOfHook`.
 * There is no error boundary anywhere in this package, so the throw takes the
 * **whole application** rather than the section — which is the one answer
 * `lorebookShape`'s own docstring forbids a surface to give a hand-edited file:
 * *"a hand edit is the storage thesis working, and a white screen is the one
 * answer this surface may not give it."*
 *
 * **The string ids are checked for the reason `editableBookShape` checks an
 * entry's.** `patchHook`, `removeHook` and `moveHook` all address a hook by id,
 * so two hooks whose ids are not strings collapse to one under any of them — an
 * edit to one silently editing or deleting the other, which is the failure a
 * read surface can live with and a write surface cannot.
 *
 * **Gated on the flag, because the check is about what this page *dereferences*
 * rather than about what the schema permits.** A World's `hooks`, if a hand
 * edit put one there, still goes through `SchemaFields` and still renders
 * opaquely, and refusing to open the editor over it would be this guard
 * inventing a validity rule the kind does not have.
 */
function shapeOf(object: Record<string, unknown>, kind: SimpleKind): string | null {
  if (typeof object['name'] !== 'string') return 'its "name" is not a string';
  // ***And `contents`, on the kind that walks it*** — [P16.1]. The member list
  // maps over it and keys every row on a member's id, so a hand edit that left
  // it something else fails the way a broken `hooks` does; gated on the flag
  // for the reason the hook check is.
  if (kind.members !== undefined) {
    const problem = contentsShape(object['contents']);
    if (problem !== null) return problem;
  }
  return kind.hooks === undefined ? null : hookShape(object['hooks']);
}

/**
 * Why a carrier's `hooks` cannot be drawn, or null — shared by the three
 * editors that draw it, because a hand-edited treatment and a hand-edited
 * lorebook fail in the same three ways.
 *
 * *Absent is fine and is not the same as empty*: `Lorebook.hooks` is optional,
 * and `hooksOf` reads a missing key as the empty list. What is refused is a key
 * holding something that is not a list of objects with ids.
 */
export function hookShape(hooks: unknown): string | null {
  if (hooks === undefined) return null;
  if (!Array.isArray(hooks)) return 'its "hooks" is not a list';
  for (const hook of hooks as unknown[]) {
    if (typeof hook !== 'object' || hook === null) return 'a hook is not an object';
    if (typeof (hook as Record<string, unknown>)['id'] !== 'string') {
      return 'a hook has no "id" string';
    }
    if (typeof (hook as Record<string, unknown>)['title'] !== 'string') {
      return 'a hook has no "title" string';
    }
  }
  return null;
}

export function descriptorFor(kind: SimpleKind): EditorKind<Draft> {
  return {
    kind: kind.kind,
    formOf: (object) => structuredClone(object),
    apply: (_base, draft) => draft,
    changed: (base, draft) => JSON.stringify(draft) !== JSON.stringify(base),
    shape: (object) => shapeOf(object, kind),
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
     * on a kind that does not author it — a World's draft has no such field,
     * and a merge that wrote one would be inventing a key from a page that
     * never showed it.
     *
     * ***`contents` joined it at [P16.1], member by member***, and for a
     * sharper reason than hooks had: the World's list is the one field on these
     * pages that something *other than an editor* writes. *Add to a world* on
     * a session's page posts one envelope while this editor may be open, which
     * is precisely the write that makes this page's Save come back 412 — and
     * under the field rule, *reapply my edits* would then take my whole list
     * and drop the add without a word. `mergedMembers` has the three cases.
     */
    reapply: (pristine, mine, fresh) => {
      let merged = structuredClone(fresh);
      for (const key of Object.keys(mine)) {
        if (key === 'hooks' && kind.hooks !== undefined) continue;
        if (key === 'contents' && kind.members !== undefined) continue;
        if (JSON.stringify(pristine[key]) !== JSON.stringify(mine[key])) merged[key] = mine[key];
      }
      if (kind.hooks !== undefined) merged = withHooks(merged, mergedHooks(pristine, mine, fresh));
      if (kind.members !== undefined) {
        merged = withMembers(merged, mergedMembers(pristine, mine, fresh));
      }
      return merged;
    },
    requiredValues: (draft) => ({ name: nameOf(draft) }),
    requiredLabels: { name: 'Name' },
    nameOf,
    untitled: kind.untitled,
    editorRoute: kind.editorRoute,
  };
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

  const problem = shapeOf(base.data.object, props.kind);
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
          editor.patch((current) => ({ ...current, name }));
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
        // `contents` is the same case on the World [P16.1].
        handled={[
          'name',
          ...(props.kind.hooks === undefined ? [] : ['hooks']),
          ...(props.kind.members === undefined ? [] : ['contents']),
        ]}
        {...(props.kind.readOnly === undefined ? {} : { readOnly: props.kind.readOnly })}
        // An updater, and so is every write on this page: an assist's result
        // lands tens of seconds after its click, and a whole form built from
        // this render would revert whatever was typed meanwhile. `patch` in
        // `object-editor.ts` has the argument.
        onChange={(key, next) => {
          editor.patch((current) => ({ ...current, [key]: next }));
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
          onChange={(update) => {
            editor.patch((current) => withHooks(current, update(hooksOf(current))));
          }}
          {...(props.kind.hookNote === undefined ? {} : { note: props.kind.hookNote })}
        />
      )}

      {/* A World's members, after its own fields for the hook list's reason:
          the identity of the set first, then what it holds. */}
      {props.kind.members === undefined ? null : (
        <MembersField
          members={membersOf(draft)}
          onChange={(update) => {
            editor.patch((current) => withMembers(current, update(membersOf(current))));
          }}
        />
      )}
    </EditorFrame>
  );
}
