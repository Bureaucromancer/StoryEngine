// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { getRouteApi } from '@tanstack/react-router';
import { useState, type JSX } from 'react';

import { newPreset, PRESET_SCHEMA, uuidv7 } from '@storyengine/shared';

import { ApiError, type LibraryObject } from '../api.js';
import { isRequiredField } from '../library/fields.js';
import { useEditorBase, useLibrary } from '../queries.js';
import { Button } from '../ui/Button.js';
import { page } from '../ui/classes.js';
import { Field } from '../ui/Field.js';
import { nudge } from '../ui/reorder.js';
import { Fine, Note, SectionTitle, SubsectionTitle } from '../ui/Text.js';
import type { Draft } from './book-form.js';
import { EditorFrame } from './EditorFrame.js';
import { useObjectEditor, type EditorKind } from './object-editor.js';
import {
  blocksOf,
  moveBlockBefore,
  nameOfPreset,
  presetChanges,
  presetFormShape,
  reapplyPresetEdits,
  withBlock,
  withBlockSource,
  withoutBlock,
  type Block,
} from './preset-form.js';
import { SchemaFields } from './SchemaFields.js';

/**
 * ***The sentence that makes Scene a narrator, editable at last*** — [P7B.1].
 *
 * Six documents sent this editor to the next phase, from P2 onwards, and the
 * chain ran out of phases: [P7B §0.1](../../../../docs/design/workplan/24-p7b-presets-and-prompts.md)
 * lays out all six. The consequence is not abstract — it is that
 * `SlotSource.outlet` has been *settable by nothing* since P5, that
 * [manual testing](../../../../docs/design/workplan/05-manual-testing.md)'s C3
 * ~~still reads~~ **read, until P7B.5 struck it** (2026-09-14) *"hand-edit
 * `preset.params.maxTokens` in the session's own `session.json`"*, and that the
 * one sentence the whole product is about was a code constant. *The tense is
 * corrected rather than the sentence deleted: what this editor is for is the
 * state it was built out of, and a file that describes only the state it
 * arrived at cannot say why it exists.*
 *
 * **The shape is the schema's** ([10 §11.2d](../../../../docs/design/10-ui-surfaces.md)),
 * through [SchemaFields](./SchemaFields.tsx) — so `budget`, `params`,
 * `variables` and the rest arrive without this file naming them, and a field
 * added to `Preset` lands here with no second edit. What this file writes out is
 * **the block list**, because §8.1's two block kinds edit differently and
 * nothing in a JSON schema says which one a block is.
 */

const routeApi = getRouteApi('/library/presets/$id/edit');

/**
 * What the shell needs to know about a preset.
 *
 * The lorebook's shape — the draft is the object. `preset-form.ts` says why,
 * and it matters more here: `Preset` is at `/0` with four things unsettled, so
 * round-tripping a preset written by a later build is the common case rather
 * than the careful one.
 */
const PRESETS: EditorKind<Draft> = {
  kind: 'presets',
  formOf: (object) => structuredClone(object),
  apply: (_base, draft) => draft,
  changed: presetChanges,
  shape: presetFormShape,
  reapply: reapplyPresetEdits,
  requiredValues: (draft) => ({ name: nameOfPreset(draft) }),
  requiredLabels: { name: 'Name' },
  nameOf: nameOfPreset,
  untitled: { draft: 'New preset', saved: 'Untitled preset' },
  editorRoute: '/library/presets/$id/edit',
};

export function PresetEditorPage(): JSX.Element {
  const { id } = routeApi.useParams();
  // The page's own column ([P3.−1] — `ui/classes.ts` has the why), wrapped
  // around the loader rather than inside it so pending, error, read-only and
  // the editor all lay out alike. **Missing from this page since P7B.1 built
  // it**, corrected 2026-09-15.
  return (
    <div className={page.tooling}>
      <EditorLoader id={id} />
    </div>
  );
}

function EditorLoader(props: { id: string }): JSX.Element {
  const base = useEditorBase('presets', props.id);

  if (base.isPending) return <p className="text-ink-subtle">Loading…</p>;
  if (base.isError) {
    const missing = base.error instanceof ApiError && base.error.status === 404;
    return (
      <p role="alert" className="text-danger-ink">
        {missing ? 'There is no such preset in your library.' : base.error.message}
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

  // The guard before the cast. This route is addressable directly, so it has to
  // refuse what the detail page's Edit link would have withheld.
  const problem = presetFormShape(base.data.object);
  if (problem !== null) {
    return (
      <p role="alert" className="text-danger-ink">
        {`This preset cannot be opened in the editor because ${problem}. Fix the file on disk, then reload this page.`}
      </p>
    );
  }
  return <Editor initial={base.data} />;
}

/**
 * ***Create is a copy, not a blank*** — [P7B §1.3].
 *
 * [10 §11.2d](../../../../docs/design/10-ui-surfaces.md)'s *the first editor
 * owes create* is honoured, but a new preset starts from a shipped pack rather
 * than from an empty block list — **because an empty block list is a session
 * that assembles nothing, and a user would learn that at their first turn.** It
 * is the rule [P4.5](../../../../docs/design/workplan/16-p4-implementation.md)
 * applied to actors (*a blank-page dead end teaches worse than no button*),
 * applied to a kind whose blank page is silent rather than empty.
 *
 * The pack comes from the library, which is where [P7B.0] put it. **When there
 * is none the button still works** and starts from the factory's blank: a
 * install with no modes loaded is not a state this page should refuse in, and
 * the factory is what the API's own create path uses.
 */
export function NewPresetPage(): JSX.Element {
  const shipped = useLibrary('presets');
  const pack = (shipped.data?.objects ?? []).find((row) => row.source === 'system');

  // The column wraps the wait as well as the form, so the page does not shift
  // sideways when the library answers — see `PresetEditorPage` above.
  return (
    <div className={page.tooling}>
      {shipped.isPending ? (
        <p className="text-ink-subtle">Loading…</p>
      ) : (
        <NewFromSeed
          seed={
            pack === undefined
              ? newPreset('')
              : { ...structuredClone(pack.object), id: uuidv7(), name: '' }
          }
        />
      )}
    </div>
  );
}

/**
 * The seed frozen on mount, which is the reason this is its own component.
 *
 * `useState`'s lazy initialiser runs once; computing the draft in the page
 * above would rebuild it on every render of a query that refetches, and the
 * editor's `base` is the thing every unsaved-changes comparison is measured
 * against. The lorebook's `NewLorebookPage` freezes its blank the same way, for
 * a draft that does not have to wait for a query first.
 */
function NewFromSeed(props: { seed: Record<string, unknown> }): JSX.Element {
  const [draft] = useState<LibraryObject>(() => ({
    id: String(props.seed['id']),
    schema: PRESET_SCHEMA,
    name: '',
    slug: '',
    source: 'user' as const,
    contentHash: '',
    shadowed: false,
    object: props.seed,
  }));

  return <Editor initial={draft} unsaved />;
}

function Editor(props: { initial: LibraryObject; unsaved?: boolean }): JSX.Element {
  const editor = useObjectEditor(PRESETS, props.initial, {
    ...(props.unsaved === undefined ? {} : { unsaved: props.unsaved }),
  });
  const { form: draft, missing } = editor;
  const blocks = blocksOf(draft);

  return (
    <EditorFrame
      editor={editor}
      descriptor={PRESETS}
      conflictTitle="The preset changed while you were editing"
      backLabel="Back to the preset"
      unsavedHeading="This preset has unsaved changes"
      listSearch={{ kind: 'presets' }}
      formClassName="flex flex-col gap-8"
      storedCaption="The saved preset, not the form's working state — what a reload would find."
      header={
        <header className="mb-6">
          <h1 className="text-title text-ink">{editor.heading}</h1>
          <p className="text-sm text-ink-subtle">
            The prompt pack a session is assembled from. A session copies it at creation.
          </p>
        </header>
      }
    >
      <Field
        label="Name"
        path="name"
        value={nameOfPreset(draft)}
        onChange={(name) => {
          editor.patch({ ...draft, name });
        }}
        required={isRequiredField('presets', 'name')}
        error={missing.includes('name') ? 'A preset needs a name.' : null}
      />

      <section>
        <SectionTitle as="h2">Blocks</SectionTitle>
        <Note>
          In order. A text block is prose you wrote; a slot positions something the engine supplies
          and says where it goes, never what it says.
        </Note>
        <div className="mt-3 flex flex-col gap-3">
          {blocks.map((block, index) => (
            <BlockRow
              key={block.id}
              block={block}
              index={index}
              count={blocks.length}
              onPatch={(patch) => {
                editor.patch(withBlock(draft, block.id, patch));
              }}
              onPatchSource={(patch) => {
                editor.patch(withBlockSource(draft, block.id, patch));
              }}
              onRemove={() => {
                editor.patch(withoutBlock(draft, block.id));
              }}
              onMove={(to) => {
                const target = blocks[to];
                editor.patch(moveBlockBefore(draft, block.id, target?.id ?? null));
              }}
            />
          ))}
          {blocks.length === 0 ? (
            <Fine>
              No blocks. A preset with none assembles an empty prompt, which is a turn that narrates
              nothing.
            </Fine>
          ) : null}
        </div>
      </section>

      {/*
       * Everything else the schema declares, in the schema's own order and
       * under its own group names — §11.2d. `blocks` is handled above and
       * `name` at the top; nothing here is a list this file maintains, so a
       * field added to `Preset` arrives with no edit to this page.
       */}
      <SchemaFields
        schemaId={PRESET_SCHEMA}
        value={draft}
        handled={['name', 'blocks']}
        onChange={(key, next) => {
          editor.patch({ ...draft, [key]: next });
        }}
      />
    </EditorFrame>
  );
}

/**
 * One block.
 *
 * **The two kinds edit differently and that is §8.1's whole point.** A text
 * block's `template` is the prose the author came to write, so it is the
 * textarea. A slot's `source` is *positional* — where the engine's content goes
 * — so it is shown and not typed: what a slot offers is priority, placement and
 * the rest, plus `source.outlet`, the field
 * [P5 §3](../../../../docs/design/workplan/17-p5-implementation.md) recorded as
 * settable by nothing and repairable only by hand.
 */
function BlockRow(props: {
  block: Block;
  index: number;
  count: number;
  onPatch: (patch: Record<string, unknown>) => void;
  onPatchSource: (patch: Record<string, unknown>) => void;
  onRemove: () => void;
  onMove: (to: number) => void;
}): JSX.Element {
  const { block } = props;
  const source = (block['source'] ?? {}) as Record<string, unknown>;

  /**
   * ***The schema's own discriminator, and [P7B.1] used the wrong one***
   * (corrected 2026-09-15, found by [P8 §0.3](../../../../docs/design/workplan/25-p8-implementation.md)'s
   * readiness audit).
   *
   * ~~`typeof source['kind'] === 'string'`~~ named a field **no preset has ever
   * carried**. [04 §8.1](../../../../docs/design/04-schemas.md)'s shape is
   * `{ kind: 'slot' | 'text', source: { of: … } }` — the discriminator is on the
   * *block* and the arm is `source.of` — so `isSlot` was false for every slot in
   * every shipped pack, every slot rendered as a text block with an empty
   * *Template* box, and the **Outlet** control this stage exists to provide
   * appeared nowhere. *The stage's headline claim — that
   * [P5 §3](../../../../docs/design/workplan/17-p5-implementation.md)'s
   * settable-by-nothing defect is retired — was false against every real file.*
   *
   * **Its test passed because the fixture was shaped like the bug.** That is the
   * failure mode worth more than the fix: a fixture invented beside the code it
   * checks agrees with the code by construction. The test now validates its own
   * fixture against `PRESET_SCHEMA` before asserting anything with it.
   *
   * *`source.of` is read openly rather than matched against a list*, for the
   * reason `workbench/address.ts` reads its own vocabulary that way: a pack
   * written by a later build carries an arm this one has never heard of — which
   * is exactly what [P8.1] adds — and the honest rendering of that is the word
   * itself, not a crash and not a text box that would overwrite the slot.
   */
  const positions = typeof source['of'] === 'string' ? source['of'] : null;
  const isSlot = block.kind === 'slot' || positions !== null;

  return (
    <div className="rounded-control border border-line p-3">
      <div className="mb-2 flex items-center gap-2">
        <SubsectionTitle as="h3" className="grow text-sm">
          {typeof block.label === 'string' && block.label !== '' ? block.label : block.id}
        </SubsectionTitle>
        <span className="text-xs text-ink-subtle">{isSlot ? 'slot' : 'text'}</span>
        {/* The keyboard half of a gesture whose other half is a pointer — a
            list only reorderable by dragging is one a keyboard cannot reorder
            at all ([ui/reorder.ts]). */}
        <button
          type="button"
          className={nudge}
          disabled={props.index === 0}
          aria-label={`Move ${block.id} up`}
          onClick={() => {
            props.onMove(props.index - 1);
          }}
        >
          ↑
        </button>
        <button
          type="button"
          className={nudge}
          disabled={props.index >= props.count - 1}
          aria-label={`Move ${block.id} down`}
          onClick={() => {
            // Past the neighbour, because removing this row first shifts it up.
            props.onMove(props.index + 2 > props.count ? props.count : props.index + 2);
          }}
        >
          ↓
        </button>
        <Button type="button" variant="quiet" onClick={props.onRemove}>
          Remove
        </Button>
      </div>

      {isSlot ? (
        <Fine>
          {positions === null
            ? 'A slot the engine fills. This build does not know what it positions.'
            : `Positions ${positions}. The engine supplies what goes here.`}
        </Fine>
      ) : (
        <Field
          label="Template"
          // The block's id, for `sections` reason one file over: block order is
          // the author's and moves, and an index-keyed provenance entry would
          // follow the position rather than the prose.
          path={`blocks.${typeof block.id === 'string' ? block.id : ''}.template`}
          value={typeof block['template'] === 'string' ? block['template'] : ''}
          onChange={(template) => {
            props.onPatch({ template });
          }}
          multiline
          rows={4}
        />
      )}

      {isSlot ? (
        <div className="mt-2">
          <Field
            label="Outlet"
            value={typeof source['outlet'] === 'string' ? source['outlet'] : ''}
            onChange={(outlet) => {
              props.onPatchSource({ outlet: outlet.trim() === '' ? undefined : outlet });
            }}
            hint="The name lore entries address to land in this slot. Blank means none."
          />
        </div>
      ) : null}
    </div>
  );
}
