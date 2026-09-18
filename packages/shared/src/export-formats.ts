// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { ACTOR_SCHEMA } from './schema/actor.js';
import { LOREBOOK_SCHEMA } from './schema/lorebook.js';
import { TREATMENT_SCHEMA } from './schema/treatment.js';

/**
 * **The formats a library object can leave in, other than its own.**
 *
 * *Nothing in this build downloaded a library object except a `.sepack`*, which
 * `ObjectDetailPage` said in a comment for two phases. A library you can put
 * things into and not get them out of is a claim about ownership that the
 * surface does not keep, and
 * [10 §2.1](../../../docs/design/10-ui-surfaces.md)'s *the library is the model*
 * is the strongest version of that claim in the design: the objects are yours,
 * in folders you may hand-edit. Two ways out follow from it, and they are
 * different things.
 *
 * **The object's own JSON is the primitive** and needs no entry here — it is
 * the stored file, served verbatim, and a format table describing it would be
 * describing the absence of a conversion. Everything in this table is the
 * second thing: a *writer*, which loses something by definition, and which is
 * therefore the first exercise
 * [00 §2.4](../../../docs/design/00-stance.md)'s *nothing is lost and re-export
 * is possible* has ever had. Preservation — `compat`, `metadata`, unknown-field
 * retention — was the whole of that promise until now, and preservation is what
 * makes a writer possible rather than what makes it exist.
 *
 * **One table, two consumers.** The server dispatches on it and the client
 * filters it by the object's `schema` to decide which menu items exist. A second
 * copy on the client is the drift
 * [polish §1](../../../docs/design/workplan/06-polish.md) spends its argument on,
 * and it would drift in the place where a person is told a file will work
 * somewhere it will not.
 */
export interface ExportFormat {
  /** Stable; it is in the route, so changing one breaks a bookmark. */
  id: string;
  /** What the menu item says. English here, rendered through the catalogue. */
  label: string;
  /** The portable schema id this writer accepts, and only this one. */
  accepts: string;
  /** Including the dot. */
  extension: string;
  contentType: string;
  /**
   * **Whether the application this format belongs to can read it back.**
   *
   * The field exists because the honest answer for the first format added is
   * *no*, and a table without somewhere to say so would have produced a menu
   * item that implies a round trip nobody tested. Aventuras exports a
   * `VaultScenario` and its scenario import does not sniff for one — every file
   * it accepts goes through the character-card pipeline
   * (`VaultPanel.svelte` → `scenarioVault.importFromFile`). So the faithful
   * format is archival and the card is the one that travels, and the surface
   * has to say which is which rather than let a person find out by losing an
   * afternoon.
   *
   * `false` is not a defect to be fixed by writing a worse file. It is a fact
   * about the other application, recorded where the menu can render it.
   */
  roundTrips: boolean;
}

export const EXPORT_FORMATS: readonly ExportFormat[] = [
  {
    id: 'aventuras.scenario',
    label: 'Aventuras scenario',
    accepts: TREATMENT_SCHEMA,
    extension: '.json',
    contentType: 'application/json; charset=utf-8',
    roundTrips: false,
  },
  {
    id: 'aventuras.character',
    label: 'Aventuras character',
    accepts: ACTOR_SCHEMA,
    extension: '.json',
    contentType: 'application/json; charset=utf-8',
    roundTrips: false,
  },
  {
    id: 'aventuras.lorebook',
    label: 'Aventuras lorebook',
    accepts: LOREBOOK_SCHEMA,
    extension: '.json',
    contentType: 'application/json; charset=utf-8',
    roundTrips: true,
  },
  {
    /**
     * **The one that actually travels**, and it is not an Aventuras format.
     *
     * A V2 card is what Aventuras' scenario import eats, and SillyTavern's, and
     * every other consumer of the format this project already reads. It is
     * lossy in a way the `VaultScenario` above is not — a treatment has a cast
     * and a card has one character — which is the trade being offered rather
     * than a bug: faithful and archival, or lossy and usable.
     */
    id: 'sillytavern.card',
    label: 'SillyTavern character card',
    accepts: TREATMENT_SCHEMA,
    extension: '.json',
    contentType: 'application/json; charset=utf-8',
    roundTrips: true,
  },
];

/** The formats that accept one schema, in table order. */
export function exportFormatsFor(schema: string): readonly ExportFormat[] {
  return EXPORT_FORMATS.filter((format) => format.accepts === schema);
}

/** One format by id, or `null` — the route's 404 arm. */
export function exportFormat(id: string): ExportFormat | null {
  return EXPORT_FORMATS.find((format) => format.id === id) ?? null;
}
