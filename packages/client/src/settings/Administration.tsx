// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import type { JSX } from 'react';

import { AdminAccounts } from './AdminAccounts.js';
import { AdminBackups } from './AdminBackups.js';
import { AdminConnections } from './AdminConnections.js';
import { AdminInstall } from './AdminInstall.js';
import { ADMINISTRATION_SECTIONS, SettingsAnchor, useJumpOnArrival } from './contents.js';

/**
 * ***The administration half of Settings, as one chunk*** — 2026-10-13,
 * [21 §7.5](../../../../docs/design/21-client-loading.md), named by
 * [P12A](../../../../docs/design/workplan/35-p12a-the-look.md) as the thing to
 * build before its first stage.
 *
 * **Why this half, and why now.** `tools/entry-budget.test.ts` left the entry
 * a few kilobytes under its ceiling at P16's final audit, and every stage of
 * P12A is client work; that audit measured this split and named it, and P12A's
 * opening audit decided to build it first rather than raise the ceiling at
 * each stage. It is the plainest case left on the entry after the publish
 * review: four sections — accounts, the install's connections and role table,
 * the install's settings form, the install's backups — that **only an
 * administrator is ever drawn**, on a page every account visits.
 *
 * ***Absent is still absent, and now for the code as well.***
 * [10 §15](../../../../docs/design/10-ui-surfaces.md) draws this half for an
 * administrator and nobody else, so its hooks never mount and a non-admin's
 * browser asks `/api/admin/*` for nothing. The chunk is reached only from
 * inside that same conditional in `SettingsPage.tsx`, so a non-admin's
 * browser never fetches it either.
 *
 * **What stays on the entry**: the half's heading and its anchor, so a link to
 * `#administration-section` lands at once and the page says what is coming;
 * the sentence while the chunk is on its way, and the boundary that says what
 * went wrong if it never arrives — `SettingsPage.tsx` holds both, as
 * `PublishRoute.tsx` holds the publish review's. And the modules the half
 * shares with the user half (`Backups.tsx`, `ImportBackup.tsx`, the shared
 * connections panel in `Connections.tsx`, the queries, the fields), which were
 * on the entry already and stay there for the user half's sake.
 *
 * **The anchors are drawn here, with the sections**, because a section's
 * anchor is the page's promise that the section exists. They arrive after the
 * page's own jump to the address's hash has run, so this half asks for the
 * jump again as it is drawn ({@link useJumpOnArrival}), for its own sections
 * only.
 */
export function Administration({ locale }: { locale: string | undefined }): JSX.Element {
  useJumpOnArrival(ADMINISTRATION_SECTIONS);
  return (
    <>
      <SettingsAnchor of="accounts">
        <AdminAccounts />
      </SettingsAnchor>
      {/*
        A third section under Administration rather than a tab or a route of
        its own — [P2B §6]. The admin half is a single conditional, which is
        what makes *absent is absent* a mechanism: these hooks never mount for
        a non-admin, so that browser issues no request that could be refused.
        A separate route would need the guard respelled.
      */}
      <SettingsAnchor of="connections">
        <AdminConnections />
      </SettingsAnchor>
      <SettingsAnchor of="install">
        <AdminInstall />
      </SettingsAnchor>
      {/**
        ***After the settings form rather than before it***, because the
        install's schedule *is* three config keys and the form above derives
        its controls from the schema. This panel is the list and the two
        buttons; a second copy of the schedule here would be a second thing to
        keep true.
      */}
      <SettingsAnchor of="installBackups">
        <AdminBackups locale={locale} />
      </SettingsAnchor>
    </>
  );
}
