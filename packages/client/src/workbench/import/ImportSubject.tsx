// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import type { JSX } from 'react';

import { ImportPanel } from '../../library/ImportPanel.js';
import { SubsectionTitle } from '../../ui/Text.js';

/**
 * The workbench's subject over the library **list** — import
 * ([P4 §7.12](../../../../../docs/design/workplan/06-p4-implementation.md)).
 *
 * **This is the arm that used to be the empty state**, and that is the whole
 * argument for it being here. [05 §3](../../../../../docs/design/05-ui-surfaces.md)
 * says the panel's *"subject follows the main view"*, and [P3 §1.3] scoped it to
 * a single object's route because the list has no selection concept — so over
 * `/library` the dock has always shown *nothing here has a record to show*.
 * [P3 §7.3] left what it should show there open. Import is the answer: it is the
 * one thing the library list as a whole is the subject of.
 *
 * **The tension with §3 is real and is recorded rather than argued away.** §3
 * calls the workbench a *reader*, and this mutates. What makes it admissible
 * rather than a quiet reinterpretation is the clause §3 already carries for
 * *promote a dry run* — *"a panel that changes things has to say so more loudly
 * than a read-only one would"* — which the panel's own *nothing is staged*
 * sentence does, and which the review below it does at greater length. What is
 * **not** claimed is that the review became addressable: [P4 §1.4]'s argument
 * that a report somebody pastes into an issue wants a URL stands untouched, and
 * P4's second named cut with it.
 *
 * The subject holds no state of its own, in the sense §3 means: everything the
 * panel remembers is either a preference on the server (the fold) or the result
 * of a request the person just made. Nothing here is a selection the dock
 * carries between routes.
 */
export function ImportSubject(): JSX.Element {
  return (
    <section aria-label="Import" className="flex flex-col gap-3">
      <SubsectionTitle as="h4">Import</SubsectionTitle>
      <ImportPanel />
    </section>
  );
}
