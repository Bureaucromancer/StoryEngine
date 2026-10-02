// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { getRouteApi, Link } from '@tanstack/react-router';
import { useState, type JSX } from 'react';

import { uuidv7 } from '@storyengine/shared';

import { api, ApiError, type LibraryObject } from '../api.js';
import { useEditorBase } from '../queries.js';
import {
  actorFormShape,
  applyForm,
  formChanges,
  formFromActor,
  priorityProblem,
  reapplyEdits,
  withoutRow,
  withRow,
  type ActorForm,
} from './form.js';
import { Alert } from '../ui/Alert.js';
import { Button } from '../ui/Button.js';
import { TwoStep } from '../ui/TwoStep.js';
import { page } from '../ui/classes.js';
import { CheckboxField, Field } from '../ui/Field.js';
import { Fine, Note, SubsectionTitle } from '../ui/Text.js';
import { TagInput } from '../tags/TagInput.js';
import { blankFor, isRequiredField } from '../library/fields.js';
import { EditorFrame } from './EditorFrame.js';
import { useObjectEditor, type EditorKind } from './object-editor.js';

/**
 * The prototype actor editor — [P1 §P1.7](../../../../docs/design/workplan/07-p1-implementation.md).
 *
 * Actor only, deliberately: the kind with the richest shape, so it is the
 * honest test rather than the easy one. Text and simple structured fields,
 * sections, the existing avatar shown but not replaced — and no assist
 * anywhere, because assist needs providers and providers are P2. The empty
 * slot in `Field` is not an invitation.
 *
 * The editor holds a *base* — the envelope it loaded or last saved over — and
 * the form edits against it. A save presents the base's hash; if the object
 * moved underneath (the likelier conflict is not two tabs but one tab and a
 * text editor), the 412 carries the current object and the dialog offers
 * reload-and-reapply or save-as-a-copy
 * ([09 §4.4](../../../../docs/design/09-server-multiuser-deployment.md)). Nothing here
 * guesses.
 */

const routeApi = getRouteApi('/library/actors/$id/edit');

export function ActorEditorPage(): JSX.Element {
  const params = routeApi.useParams();
  return (
    // The page's own column, now that the shell's `<main>` is a bare scroll
    // container ([P3.−1] — `ui/classes.ts` has the why). Wrapped here rather
    // than per branch of the loader, so pending, error and editor lay out
    // alike. Keyed by id so save-as-a-copy lands in a fresh editor rather
    // than a stale one.
    <div className={page.tooling}>
      <EditorLoader key={params.id} id={params.id} />
    </div>
  );
}

function EditorLoader(props: { id: string }): JSX.Element {
  const base = useEditorBase('actors', props.id);

  if (base.isPending) {
    return <Note>Loading the actor…</Note>;
  }
  if (base.isError) {
    const missing = base.error instanceof ApiError && base.error.status === 404;
    return (
      <p role="alert" className="text-danger-ink">
        {missing ? 'There is no such actor in your library.' : base.error.message}
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
  // The guard before the cast: a hand-edited card is the storage thesis
  // working, and the one answer the editor may not give it is a white screen.
  const problem = actorFormShape(base.data.object);
  if (problem !== null) {
    return (
      <Alert tone="error" role="alert">
        <p className="mb-2 font-medium">This actor cannot be opened in the editor.</p>
        <p className="mb-2">
          {`The file on disk does not have the shape the form needs: ${problem}. This usually means a hand edit went wrong. The file itself is untouched — fix it on disk and it will load.`}
        </p>
        <p>
          <Link
            to="/library/$kind/$id"
            params={{ kind: 'actors', id: props.id }}
            className="underline"
          >
            Back to the actor
          </Link>
        </p>
      </Alert>
    );
  }
  return <Editor initial={base.data} />;
}

/**
 * A new actor, which does not exist yet — [polish §10].
 *
 * **Nothing is written until the first Save**, and that is the whole point of
 * the route. The obvious cheaper version — create it under a placeholder name
 * and let the editor rename it — is wrong here because the folder is slugged
 * from the name once, at creation, and then frozen ([03 §5.2]): an object made
 * before it was named keeps `untitled-3` on disk for the rest of its life, in
 * the part of this design meant to be legible to somebody with a file browser.
 *
 * The envelope is synthetic and the `contentHash` is empty, which is what
 * `unsaved` tells the editor rather than something it sniffs — a hash that
 * happened to be empty for another reason should not silently mean *this has
 * never been written*.
 *
 * `useState` with an initialiser rather than a plain call, so the id is minted
 * once. Re-minting it on every render would be invisible right up until a save
 * raced a re-render.
 */
export function NewActorPage(): JSX.Element {
  const [draft] = useState<LibraryObject>(() => {
    const object = blankFor('actors');
    return {
      id: object['id'] as string,
      schema: object['schema'] as string,
      name: '',
      slug: '',
      contentHash: '',
      source: 'user',
      shadowed: false,
      object,
    };
  });

  // The page's own column, for the reason `ActorEditorPage` above states and
  // **which this page has never had** — corrected 2026-09-15. A create route is
  // a page like any other; without this the form ran edge to edge with no
  // gutter, and the only left padding on screen came from the nested section
  // fieldsets, which read as though the sections were indented rather than as
  // though the page had none.
  return (
    <div className={page.tooling}>
      <Editor initial={draft} unsaved />
    </div>
  );
}

/**
 * What the shell needs to know about an actor — [P7B.1].
 *
 * Every member was already a function in [form.ts](./form.ts); none of them is
 * new and none of them moved. That is the evidence for the contract being
 * discovered rather than designed: the actor editor had all eight of these and
 * so did the lorebook editor, spelled out inline in two places.
 */
const ACTORS: EditorKind<ActorForm> = {
  kind: 'actors',
  formOf: formFromActor,
  apply: applyForm,
  changed: formChanges,
  shape: actorFormShape,
  reapply: reapplyEdits,
  requiredValues: (form) => ({ name: form.name }),
  requiredLabels: { name: 'Name' },
  nameOf: (form) => form.name,
  untitled: { draft: 'New actor', saved: 'Untitled actor' },
  editorRoute: '/library/actors/$id/edit',
};

function Editor(props: { initial: LibraryObject; unsaved?: boolean }): JSX.Element {
  const editor = useObjectEditor(ACTORS, props.initial, {
    ...(props.unsaved === undefined ? {} : { unsaved: props.unsaved }),
  });
  const { base, form, missing, unsaved } = editor;

  /**
   * The actor form's patch, over the shell's.
   *
   * The shell takes a whole form or an updater because it knows nothing about
   * `F`; every field here wants to set one key. One line, and it keeps the
   * hundred-odd call sites below reading exactly as they did.
   */
  function patchForm(patch: Partial<ActorForm>): void {
    editor.patch((previous) => ({ ...previous, ...patch }));
  }

  /**
   * ***One section or sample, changed in the form as it is when the change
   * lands*** (2026-09-27).
   *
   * These used to map `form.sections` — the list as this render had it — and
   * hand the whole list to `patchForm`, so an assist on one section's body
   * resolving thirty seconds later put back every other section as it was at
   * the click, and the title somebody had just rewritten with it. What a row
   * captures now is only where it is: its id and the index it was drawn at,
   * which `withRow` reads the way its docstring says.
   */
  function patchSection(
    id: string,
    at: number,
    over: Partial<ActorForm['sections'][number]>,
  ): void {
    editor.patch((previous) => ({
      ...previous,
      sections: withRow(previous.sections, id, at, over),
    }));
  }

  function patchSample(id: string, at: number, over: Partial<ActorForm['samples'][number]>): void {
    editor.patch((previous) => ({
      ...previous,
      samples: withRow(previous.samples, id, at, over),
    }));
  }

  return (
    <EditorFrame
      editor={editor}
      descriptor={ACTORS}
      conflictTitle="The actor changed while you were editing"
      backLabel="Back to the actor"
      unsavedHeading="This actor has unsaved changes"
      listSearch={{ kind: 'actors' }}
      header={
        <>
          <header className="mb-6 flex items-center gap-4">
            {/* Shown, never replaced here — the card's pixels are the portrait as
              intended, and replacing them is not this stage's business. A draft
              has no card to show, and asking for one by an id the server has
              never heard of would be a 404 rendered as a broken image. */}
            {unsaved ? (
              <div className="h-20 w-20 rounded-md border border-line bg-surface-muted" />
            ) : (
              <img
                src={api.avatarUrl(base.id, base.contentHash)}
                alt=""
                className="h-20 w-20 rounded-md border border-line bg-surface-muted object-cover"
              />
            )}
            <div>
              <h1 className="text-title text-ink">{editor.heading}</h1>
              <Note>
                The card image travels with the file; this editor shows it and does not replace it.
              </Note>
            </div>
          </header>
        </>
      }
    >
      <Field
        label="Name"
        path="name"
        value={form.name}
        onChange={(name) => {
          patchForm({ name });
        }}
        required={isRequiredField('actors', 'name')}
        error={missing.includes('name') ? 'An actor needs a name.' : null}
      />
      <Field
        label="Pronouns"
        path="pronouns"
        value={form.pronouns}
        onChange={(pronouns) => {
          patchForm({ pronouns });
        }}
        hint="Leave blank for unknown. Never inferred from the name."
      />
      <Field
        label="Aliases"
        path="aliases"
        value={form.aliasesText}
        onChange={(aliasesText) => {
          patchForm({ aliasesText });
        }}
        multiline
        rows={3}
        hint="One per line. Also the default keyword set for lore matching."
      />
      <TagInput
        label="Tags"
        values={form.tags}
        onChange={(tags) => {
          patchForm({ tags });
        }}
        hint="Type to search what the library already uses, or to make a new one. Never sent to the model."
      />
      <Field
        label="Traits"
        path="traits"
        value={form.traitsText}
        onChange={(traitsText) => {
          patchForm({ traitsText });
        }}
        multiline
        rows={3}
        hint="One per line."
      />

      {form.sections.map((section, index) => (
        <fieldset key={section.id} className="rounded-md border border-line p-4">
          <legend className="px-1 text-sm font-medium text-ink-muted">
            {section.title === '' ? 'Untitled section' : section.title}
            <span className="ms-2 text-xs font-normal text-ink-faint">{section.disposition}</span>
          </legend>
          <div className="flex flex-col gap-3">
            <Field
              label="Title"
              path={`sections.${section.id}.title`}
              value={section.title}
              onChange={(title) => {
                patchSection(section.id, index, { title });
              }}
            />
            {/*
             * ***The path is the section's id, not its index*** — [10 §11.2],
             * [P11.2]. The provenance map outlives the form, and an index-keyed
             * entry would follow whichever section happened to be third after a
             * reorder — attributing one section's words to another, which is
             * worse than having no provenance at all.
             */}
            <Field
              label="Body"
              path={`sections.${section.id}.body`}
              value={section.body}
              onChange={(body) => {
                patchSection(section.id, index, { body });
              }}
              multiline
              rows={5}
            />
          </div>
        </fieldset>
      ))}

      {/*
          Writing samples — [04 §3.1]. **The first list in this editor that can
          grow and shrink**; sections are a fixed set edited in place, which is
          why they need no add or remove control and this does.

          Rendered after the sections because it is the least-used field on the
          card and the longest: putting a page of pasted prose above the
          one-line identity fields would bury them.
        */}
      <section className="flex flex-col gap-3">
        <SubsectionTitle as="h2">Writing samples</SubsectionTitle>
        <Fine>
          Prose in this character&rsquo;s voice, offered to the model as an example to write like —
          not a description of how they sound. Each one is budgeted like any other block, and the
          lowest priority is dropped first when a prompt runs long.
        </Fine>

        {form.samples.length === 0 ? (
          <p className="text-sm text-ink-muted">None yet.</p>
        ) : (
          form.samples.map((sample, index) => {
            const patchThis = (over: Partial<(typeof form.samples)[number]>): void => {
              patchSample(sample.id, index, over);
            };

            return (
              <fieldset key={sample.id} className="rounded-md border border-line p-4">
                <legend className="px-1 text-sm font-medium text-ink-muted">
                  {sample.title === '' ? 'Untitled sample' : sample.title}
                  {sample.enabled ? null : (
                    <span className="ms-2 text-xs font-normal text-ink-faint">off</span>
                  )}
                </legend>
                <div className="flex flex-col gap-3">
                  <Field
                    label="Title"
                    path={`writingSamples.${sample.id}.title`}
                    value={sample.title}
                    onChange={(title) => {
                      patchThis({ title });
                    }}
                    hint="For you, in the editor and the block table. Never sent."
                  />
                  <Field
                    label="Sample"
                    path={`writingSamples.${sample.id}.body`}
                    value={sample.body}
                    onChange={(body) => {
                      patchThis({ body });
                    }}
                    multiline
                    rows={10}
                    hint="Paste a passage. This is the only part the model sees."
                  />
                  <Field
                    label="Priority"
                    value={sample.priorityText}
                    onChange={(priorityText) => {
                      patchThis({ priorityText });
                    }}
                    error={priorityProblem(sample.priorityText)}
                    hint="Blank inherits the preset's. Higher survives longer under a full context."
                  />
                  <CheckboxField
                    label="Send this sample"
                    checked={sample.enabled}
                    onChange={(enabled) => {
                      patchThis({ enabled });
                    }}
                    hint="Off keeps it on the card without spending a turn on it."
                  />
                  <div>
                    {/* ***Says which sample*** (2026-10-01, polish 11): two
                        samples were two buttons called *Remove this sample*,
                        which is no name at all in a list of buttons. Its
                        title, or its place while it has none. */}
                    <TwoStep
                      label="Remove this sample"
                      name={
                        sample.title.trim() === ''
                          ? `Remove sample ${String(index + 1)}`
                          : `Remove ${sample.title.trim()}`
                      }
                      question="Remove this sample from the card? Nothing is written until you save."
                      confirm="Remove"
                      onConfirm={() => {
                        editor.patch((previous) => ({
                          ...previous,
                          samples: withoutRow(previous.samples, sample.id, index),
                        }));
                      }}
                    />
                  </div>
                </div>
              </fieldset>
            );
          })
        )}

        <div>
          <Button
            type="button"
            onClick={() => {
              // A fresh id rather than an index: `applyForm` matches on it to
              // carry unknown fields through, and a reorder must not repoint one
              // sample's data at another. Minted out here, where it runs once —
              // React runs an updater twice under StrictMode.
              const made = { id: uuidv7(), title: '', body: '', enabled: true, priorityText: '' };
              editor.patch((previous) => ({ ...previous, samples: [...previous.samples, made] }));
            }}
          >
            Add a writing sample
          </Button>
        </div>
      </section>
    </EditorFrame>
  );
}
