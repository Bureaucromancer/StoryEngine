// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { useState, type JSX } from 'react';

import { ApiError, type LibraryObject } from '../api.js';
import { blankFor, isRequiredField, type EditorKind as Kind } from '../library/fields.js';
import { useEditorBase } from '../queries.js';
import { page } from '../ui/classes.js';
import { Field } from '../ui/Field.js';
import type { Draft } from './book-form.js';
import { EditorFrame } from './EditorFrame.js';
import { useObjectEditor, type EditorKind } from './object-editor.js';
import { SchemaFields } from './SchemaFields.js';

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
     * The 412 merge, field by field at the top level.
     *
     * Coarser than the lorebook's entry-by-entry merge and the preset's
     * block-by-block one, and that is right rather than lazy: those two have a
     * keyed list where *which one did I edit* is answerable. These do not, so
     * the honest unit is the field — an untouched field takes the newer value,
     * which is the rule the 412's first offer means.
     */
    reapply: (pristine, mine, fresh) => {
      const merged = structuredClone(fresh);
      for (const key of Object.keys(mine)) {
        if (JSON.stringify(pristine[key]) !== JSON.stringify(mine[key])) merged[key] = mine[key];
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

  if (base.isPending) return <p className="text-ink-subtle">Loading…</p>;
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
          <p className="text-sm text-ink-subtle">{props.kind.blurb}</p>
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
        handled={['name']}
        {...(props.kind.readOnly === undefined ? {} : { readOnly: props.kind.readOnly })}
        onChange={(key, next) => {
          editor.patch({ ...draft, [key]: next });
        }}
      />
    </EditorFrame>
  );
}
