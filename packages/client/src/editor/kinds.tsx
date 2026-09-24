// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { getRouteApi } from '@tanstack/react-router';
import type { JSX } from 'react';

import { PACKAGE_SCHEMA, SETUP_SCHEMA, TREATMENT_SCHEMA } from '@storyengine/shared';

import { NewSimplePage, SimpleEditorLoader, type SimpleKind } from './SimpleEditorPage.js';

/**
 * The three kinds whose editor is entirely the schema's shape — [P7B.3],
 * [P7B.6].
 *
 * **Declarations, not components.** Each is what
 * [SimpleEditorPage](./SimpleEditorPage.tsx) needs said in the reader's words:
 * the sentences, which have to be whole rather than assembled
 * ([work plan §2](../../../../docs/design/workplan/01-work-plan.md)), and
 * nothing about layout, which the schema supplies.
 *
 * *All six kinds have an editor from here*, which is the claim
 * `fields.test.ts` now makes over the whole key set instead of the absence it
 * used to assert about four of them.
 */

const TREATMENTS: SimpleKind = {
  kind: 'treatments',
  schemaId: TREATMENT_SCHEMA,
  blurb: 'How a world is handled here. Its framing is injected into every turn.',
  backLabel: 'Back to the treatment',
  unsavedHeading: 'This treatment has unsaved changes',
  conflictTitle: 'The treatment changed while you were editing',
  storedCaption: "The saved treatment, not the form's working state — what a reload would find.",
  nameRefusal: 'A treatment needs a name.',
  notFound: 'There is no such treatment in your library.',
  unopenable: (problem) =>
    `This treatment cannot be opened in the editor because ${problem}. Fix the file on disk, then reload this page.`,
  untitled: { draft: 'New treatment', saved: 'Untitled treatment' },
  editorRoute: '/library/treatments/$id/edit',
  /**
   * ***The primary home, finally writable here*** —
   * [03 §4.1](../../../../docs/design/03-data-model.md),
   * [P11.2](../../../../docs/design/workplan/28-p11-implementation.md).
   *
   * What stood here was a `readOnly` note reading *"Hooks are authored in the
   * session's hook panel. Shown here as stored."* — true when it was written
   * and the exact thing this change ends. It made the panel the only surface
   * in the application that could write a hook, which left a hook realised
   * mid-play dying with the session it was realised in, since there was no way
   * back out of one either. [P7 §1.5]'s *"a hook has nowhere to be authored"*
   * is the record of it being noticed and deferred to this sweep.
   *
   * The panel keeps its two-field form and its job. [P7.5]'s argument survives
   * the editors existing: it is the sentence the feature exists for, not an
   * editor.
   */
  hooks: true,
  hookNote:
    'Hooks live here first: a session started from this treatment begins with a copy of every one of them.',
};

const SETUPS: SimpleKind = {
  kind: 'setups',
  schemaId: SETUP_SCHEMA,
  blurb: 'How to start playing — a mode, a preset, a treatment and a cast, kept together.',
  backLabel: 'Back to the setup',
  unsavedHeading: 'This setup has unsaved changes',
  conflictTitle: 'The setup changed while you were editing',
  storedCaption: "The saved setup, not the form's working state — what a reload would find.",
  nameRefusal: 'A setup needs a name.',
  notFound: 'There is no such setup in your library.',
  unopenable: (problem) =>
    `This setup cannot be opened in the editor because ${problem}. Fix the file on disk, then reload this page.`,
  untitled: { draft: 'New setup', saved: 'Untitled setup' },
  editorRoute: '/library/setups/$id/edit',
  /**
   * ***Additional to the treatment's, not a replacement*** — which is the
   * schema's own sentence about this field
   * (`packages/shared/src/schema/setup.ts`) and the one thing the note has to
   * say out loud.
   *
   * A Setup overrides its treatment's `openings` and *adds to* its `hooks`, and
   * the two sit four lines apart in the same object. An author who read the
   * first rule and assumed the second would write a setup's hooks expecting the
   * treatment's to go away, and would find out only in a session that they had
   * not — so the difference is stated where the list is, rather than left to
   * whoever reads the schema.
   */
  hooks: true,
  hookNote:
    'Added to whatever the treatment already carries, not instead of them — a session started from this setup gets both.',
};

const PACKAGES: SimpleKind = {
  kind: 'packages',
  schemaId: PACKAGE_SCHEMA,
  blurb: 'A bundle of library objects, kept together so they can travel as one.',
  backLabel: 'Back to the package',
  unsavedHeading: 'This package has unsaved changes',
  conflictTitle: 'The package changed while you were editing',
  storedCaption: "The saved package, not the form's working state — what a reload would find.",
  nameRefusal: 'A package needs a name.',
  notFound: 'There is no such package in your library.',
  unopenable: (problem) =>
    `This package cannot be opened in the editor because ${problem}. Fix the file on disk, then reload this page.`,
  untitled: { draft: 'New package', saved: 'Untitled package' },
  editorRoute: '/library/packages/$id/edit',
  /**
   * ***No `hooks` here, and the absence is the decision***
   * ([03 §4.1](../../../../docs/design/03-data-model.md)).
   *
   * A Package has no hooks of its own — it carries the objects that do, and
   * §4.1 says so in as many words: *"a package carries all of them by carrying
   * the objects."* A hook list on this page would be a fifth source of hooks
   * attached to the one kind whose whole job is to hold other kinds, which is
   * the *"hook pack"* the same section declines by name. It is written down
   * rather than merely omitted because an omission reads the same whether it
   * was decided or forgotten.
   */
};

const treatmentRoute = getRouteApi('/library/treatments/$id/edit');
const setupRoute = getRouteApi('/library/setups/$id/edit');
const packageRoute = getRouteApi('/library/packages/$id/edit');

export function TreatmentEditorPage(): JSX.Element {
  return <SimpleEditorLoader kind={TREATMENTS} id={treatmentRoute.useParams().id} />;
}
export function NewTreatmentPage(): JSX.Element {
  return <NewSimplePage kind={TREATMENTS} />;
}

export function SetupEditorPage(): JSX.Element {
  return <SimpleEditorLoader kind={SETUPS} id={setupRoute.useParams().id} />;
}
export function NewSetupPage(): JSX.Element {
  return <NewSimplePage kind={SETUPS} />;
}

export function PackageEditorPage(): JSX.Element {
  return <SimpleEditorLoader kind={PACKAGES} id={packageRoute.useParams().id} />;
}
export function NewPackagePage(): JSX.Element {
  return <NewSimplePage kind={PACKAGES} />;
}
