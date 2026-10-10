// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { getRouteApi } from '@tanstack/react-router';
import type { JSX } from 'react';

import { SETUP_SCHEMA, TREATMENT_SCHEMA, WORLD_SCHEMA } from '@storyengine/shared';

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
  /*
   * ***"Setting", not "world"*** (2026-10-10, [P16.0]): this said *how a world
   * is handled here*, which was the material's word until the kind took it —
   * a World is now the set on its own panel, and a treatment's blurb that said
   * *world* would read as one of them.
   */
  blurb: 'How a setting is handled here. Its framing is injected into every turn.',
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

/**
 * ***The kind that was `PACKAGES` until [P16.0]***
 * ([P16 §1.1](../../../../docs/design/workplan/35-p16-world.md)): the same
 * fields, the same editor, a new name and a new folder. Every sentence below
 * said *package* until 2026-10-10.
 *
 * **The blurb says what a World is for and stops there.** A World is a named
 * set of library objects and sessions ([15 §1](../../../../docs/design/15-world.md)),
 * and the three things it is for — membership, starting new sessions from it,
 * travelling as one file — are what the line names. ~~*What it does not offer is
 * a way to pick the members*: that editor is [P16.1]'s, and until it lands the
 * `contents` list arrives here the way it always has, shown as stored and not
 * writable (`SimpleEditorPage`'s *usable, not complete*). A blurb inviting
 * somebody to add things to a set, on a page that cannot add anything, would
 * promise what the page does not do — so the line describes the set and leaves
 * the picker to the stage that builds it, which will rewrite this sentence when
 * it does.~~
 *
 * ***Rewritten at [P16.1], as the struck paragraph said it would be.*** The
 * page now picks members (`members: true` below, drawn by `MembersField`), and
 * sessions are among them — so the line says *and sessions*, which is what it
 * held back while nothing could put one there. ~~**It still does not say a new
 * session can start from it**: that is [P16.2]'s, not built yet, and the
 * struck paragraph's rule is the same rule one stage on — a blurb promising
 * what the page does not do. P16.2 rewrites this again when it lands.~~
 *
 * ***Rewritten at [P16.2], and now it names all three.*** A World's page
 * starts a session in it, and the session form offers it as a choice — its
 * books and its treatment filled in for the person to change, the session
 * added to the World ([P16 §1.3](../../../../docs/design/workplan/35-p16-world.md)).
 * The struck paragraphs' rule did not change — the line says only what a
 * World can be used for today — and today includes this.
 */
const WORLDS: SimpleKind = {
  kind: 'worlds',
  schemaId: WORLD_SCHEMA,
  blurb:
    'A named set of library objects and sessions, kept together so new sessions can start from it and it can travel as one file.',
  backLabel: 'Back to the world',
  unsavedHeading: 'This world has unsaved changes',
  conflictTitle: 'The world changed while you were editing',
  storedCaption: "The saved world, not the form's working state — what a reload would find.",
  nameRefusal: 'A world needs a name.',
  notFound: 'There is no such world in your library.',
  unopenable: (problem) =>
    `This world cannot be opened in the editor because ${problem}. Fix the file on disk, then reload this page.`,
  untitled: { draft: 'New world', saved: 'Untitled world' },
  editorRoute: '/library/worlds/$id/edit',
  /**
   * ***The member picker*** — [P16.1], [15 §3.1](../../../../docs/design/15-world.md).
   * `contents` is drawn by `MembersField` rather than shown as stored: every
   * library kind you own but this one, and your sessions, with a member that
   * has since been deleted kept in its place and marked missing.
   */
  members: true,
  /**
   * ***No `hooks` here, and the absence is the decision***
   * ([03 §4.1](../../../../docs/design/03-data-model.md)).
   *
   * A World has no hooks of its own — it carries the objects that do, and
   * §4.1 says so in as many words: *"a package carries all of them by carrying
   * the objects"* (written when the kind was Package; [P16.0] renamed the kind
   * and left the reasoning exactly where it was). A hook list on this page would
   * be a fifth source of hooks attached to the one kind whose whole job is to
   * hold other kinds, which is the *"hook pack"* the same section declines by
   * name. It is written down rather than merely omitted because an omission
   * reads the same whether it was decided or forgotten.
   *
   * ***And the World's contribution does not change it*** — [15 §5.3], whose
   * summary row in 15 §5 says a new session in a World copies its books, offers
   * its treatment, and copies *"the hooks those carry"*: the members' hooks,
   * which is the same sentence from the session's side. The hooks still live
   * on the members.
   */
};

const treatmentRoute = getRouteApi('/library/treatments/$id/edit');
const setupRoute = getRouteApi('/library/setups/$id/edit');
const worldRoute = getRouteApi('/library/worlds/$id/edit');

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

export function WorldEditorPage(): JSX.Element {
  return <SimpleEditorLoader kind={WORLDS} id={worldRoute.useParams().id} />;
}
export function NewWorldPage(): JSX.Element {
  return <NewSimplePage kind={WORLDS} />;
}
