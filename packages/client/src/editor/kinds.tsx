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
  readOnly: {
    /**
     * [P7B §1.5]: the authored pool is shown as the schema has it, and the panel
     * that makes a pool authorable is [P7.5]'s and [P11.5]'s. This editor is the
     * object beneath that panel, not a second one.
     */
    hooks: 'Hooks are authored in the session’s hook panel. Shown here as stored.',
  },
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
