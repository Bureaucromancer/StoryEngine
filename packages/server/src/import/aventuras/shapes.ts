// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import type { ImportNote } from '@storyengine/shared';

/**
 * What an Aventuras file looks like, and the guards that recognise one.
 *
 * **Structural, because there is nothing else to go on.** Aventuras' vault
 * export is `JSON.stringify(entity, null, 2)` and nothing more
 * (`lorebookImportExport/export/vault.ts`) — no envelope, no `spec`, no version
 * field, not even a wrapper object. SillyTavern hands us `spec:
 * "chara_card_v2"` and Marinara hands us a typed envelope; this hands us the
 * record, so the shape *is* the identification.
 *
 * **The guards live here rather than in `upload.ts` because two callers need
 * them and they must not drift.** The probe decides what a file is and the
 * converter decides what it becomes, and a probe that recognised a shape the
 * converter then refused would be a file reported as Aventuras and imported as
 * nothing. One definition, two readers — the rule `polish §1` states for the
 * kind tables and the same failure it prevents.
 *
 * **The two record guards return `boolean` rather than narrowing**, and the
 * array one narrows. That asymmetry is not an oversight: `probe()` reads a
 * dozen more fields off the same `Record<string, unknown>` after asking these
 * questions, and a type predicate there narrows the *negative* branch too —
 * quietly taking the index signature off the object every later probe row
 * depends on. The converters pair these with `isRecord` and get their narrowing
 * from that instead, which is where it belongs: `isRecord` is the claim about
 * the shape of the value, and these are claims about its contents.
 *
 * Shapes surveyed from `src/lib/types/index.ts` at `master`, against the
 * v0.7.8 survey [01 §2](../../../../../docs/design/01-source-survey.md) and
 * [P4 §1.5](../../../../../docs/design/workplan/16-p4-implementation.md) already
 * pinned. Those two named this work and did not do it; this is it.
 */

export const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * `VaultScenario` — setting prose, a cast and an opening, in one file.
 *
 * `settingSeed` and `npcs` together, because either alone is too weak:
 * `npcs` is a plausible key on anything, and a lone `settingSeed` is the kind
 * of near-match that would catch some future tool's unrelated field. Both are
 * required fields of the real shape, so requiring both costs nothing.
 *
 * **Note what is deliberately not tested: `name`.** A `VaultScenario` has one,
 * and so does a character card — testing it here and ordering this probe after
 * `looksLikeCard` would make the order load-bearing for no gain.
 */
export function isVaultScenario(value: unknown): boolean {
  return (
    isRecord(value) && typeof value['settingSeed'] === 'string' && Array.isArray(value['npcs'])
  );
}

/**
 * `VaultCharacter` — the shape [P4 §1.5] records as *not* V2, which is the
 * whole reason it needs a converter of its own rather than a redirect to
 * `convertCard` the way Marinara's characters get one.
 *
 * `visualDescriptors` is the distinctive field: an object of structured
 * appearance strings that no SillyTavern or Marinara shape carries. `traits` as
 * an array is the second half, and it separates this from a future Aventuras
 * record that happens to carry appearance.
 */
export function isVaultCharacter(value: unknown): boolean {
  return isRecord(value) && isRecord(value['visualDescriptors']) && Array.isArray(value['traits']);
}

/**
 * The `aventura` lorebook format: a bare `Entry[]` array.
 *
 * **This is the one Aventuras export path that looked closed and is not.**
 * [P4 §1.5] found that Aventuras exports lorebooks *as SillyTavern files* and
 * concluded — correctly, and incompletely — that its lore needs no
 * Aventuras-specific code. `export/formats.ts` offers three formats, and
 * `exportToAventura` is `JSON.stringify(entries, null, 2)`: a top-level array
 * of `Entry`, which `readUpload` could not even parse as far as a probe,
 * because its shape guard rejects arrays before the probe table is reached.
 *
 * The test is Aventuras' own `isAventuraFormat` (`import/parse.ts`), narrowed
 * to the first element: `name`, `type`, `description` and an `injection` object
 * with a `mode`. An empty array is not one — there would be nothing to import
 * and nothing to identify it by.
 */
export function isAventurasLorebook(value: unknown): value is Record<string, unknown>[] {
  if (!Array.isArray(value) || value.length === 0) return false;
  const first: unknown = value[0];
  if (!isRecord(first)) return false;
  const injection = first['injection'];
  return (
    typeof first['name'] === 'string' &&
    typeof first['type'] === 'string' &&
    'description' in first &&
    isRecord(injection) &&
    typeof injection['mode'] === 'string'
  );
}

export const note = (
  key: string,
  params: ImportNote['params'],
  level: ImportNote['level'] = 'info',
): ImportNote => ({ key, params, level });

/** A trimmed string, or `''` — the shape every field read here wants. */
export function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

/** The non-empty trimmed strings of an array, or `[]` for anything else. */
export function strings(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}
