// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import {
  CONVENTIONAL_SECTION_IDS,
  newActor,
  type Actor,
  type ImportNote,
} from '@storyengine/shared';

import { parsed, refused, type ParseOutcome } from '../parse.js';

import { isRecord, isVaultCharacter, note, strings, text } from './shapes.js';

/**
 * Aventuras `VaultCharacter` → `Actor`.
 *
 * **Its own converter rather than a redirect, and [P4 §1.5] says why**: this is
 * *"the shape [01 §4] already documented as **not** V2"*. Marinara's characters
 * redirect straight into `convertCard` because a Marinara card *is* a V2 card;
 * this one is a vault record with camelCase fields, `visualDescriptors` where a
 * card has nothing, and no `first_mes` at all — a redirect would refuse it at
 * `unwrap`.
 *
 * It is the smallest of the three Aventuras converters, and it exists here
 * rather than being deferred because `scenario.ts` had to learn to build an
 * Actor from a vault record anyway. The npc inside a scenario and the standalone
 * character file are the same shape minus two fields.
 */

export interface ConvertedCharacter {
  actor: Actor;
  notes: ImportNote[];
}

/** Read here, and so not also preserved into `compat`. */
const CONSUMED = new Set([
  'name',
  'description',
  'traits',
  'visualDescriptors',
  'portrait',
  'tags',
  'id',
  'favorite',
  'createdAt',
  'updatedAt',
]);

/**
 * **The two `VisualDescriptors` are the same seven keys, and that is not a
 * coincidence — ours was taken from theirs.**
 *
 * `face`, `hair`, `eyes`, `build`, `clothing`, `accessories`, `distinguishing`,
 * optional on both sides, and the same distinction behind them: structured
 * appearance for an image pipeline, with prose appearance living elsewhere
 * ([04 §4]'s `profile.visual` against the `se.appearance` section; Aventuras'
 * own comment says *"used for image generation"*).
 *
 * So this is a copy rather than a mapping, and the list is written out anyway
 * for the reason a copy needs one: it is what stops a *future* key on either
 * side from being carried silently into a field of a shape it does not have.
 * An unlisted key falls through to `compat` with everything else.
 *
 * *Exported at P13.3* for `vault-character.ts`, whose repair of the legacy
 * string-array form has to land on exactly these keys and no others.
 */
export const VISUAL_KEYS = [
  'face',
  'hair',
  'eyes',
  'build',
  'clothing',
  'accessories',
  'distinguishing',
] as const;

/** One of {@link VISUAL_KEYS}. */
export type VisualKey = (typeof VISUAL_KEYS)[number];

export function convertCharacter(
  input: unknown,
  fallbackName: string,
): ParseOutcome<ConvertedCharacter> {
  if (!isRecord(input) || !isVaultCharacter(input)) return refused('wrong-shape');

  const name = text(input['name']);
  if (name.length === 0) return refused('missing-field', 'name');

  const notes: ImportNote[] = [];
  const actor = newActor(name || fallbackName);

  actor.profile.traits = strings(input['traits']);
  actor.tags = strings(input['tags']);

  const description = text(input['description']);
  if (description.length > 0) {
    const summary = actor.profile.sections.find(
      (section) => section.id === CONVENTIONAL_SECTION_IDS.summary,
    );
    if (summary !== undefined) summary.body = description;
  }

  applyVisual(input['visualDescriptors'], actor, notes);
  portraitWarning(input['portrait'], notes);

  const compat = carriedCompat(input);
  if (Object.keys(compat).length > 0) actor.compat = compat;

  return parsed({ actor, notes });
}

function applyVisual(value: unknown, actor: Actor, notes: ImportNote[]): void {
  if (!isRecord(value)) return;

  const visual: Record<string, string> = {};
  for (const key of VISUAL_KEYS) {
    const descriptor = text(value[key]);
    if (descriptor.length > 0) visual[key] = descriptor;
  }
  if (Object.keys(visual).length === 0) return;

  actor.profile.visual = visual;
  notes.push(
    note('import.aventuras.visualDescriptors', {
      count: Object.keys(visual).length,
      actor: actor.name,
    }),
  );
}

/**
 * The portrait is a data URL in the file, and it does not come across.
 *
 * **Reported rather than carried, and the reason is the boundary rather than
 * the bytes.** A converter does no I/O ([`source.ts`]), and a card's pixels
 * reach the library through the asset path with the bytes sniffed rather than
 * trusted (`POST /library/:kind/:id/assets`) — decoding a base64 image inside a
 * pure function and handing the result to `store()` would route an untrusted
 * image around the one place that checks it. `import.card.portraitUnreadable`
 * is the neighbouring sentence for the same shape of loss.
 *
 * ***A file only*** — [P13 §1.6](../../../../../docs/design/workplan/30-p13-aventuras-import.md).
 * The same portrait in a `character_vault` row *is* carried: the database
 * reader decodes it, leaves it out of the payload, and hands the bytes to the
 * Writer beside the candidate (`ImportCandidate.inline`), which sniffs them as
 * it sniffs any file. So this fires for a vault JSON file and never for a row.
 */
function portraitWarning(value: unknown, notes: ImportNote[]): void {
  if (typeof value !== 'string' || value.length === 0) return;
  notes.push(note('import.aventuras.portraitNotCarried', {}, 'warn'));
}

/**
 * An Actor carries `compat`, which is the per-kind difference [P4 §1.4] draws:
 * Actors and Presets preserve unrecognised fields there, Treatments and
 * Lorebooks have `metadata` and nothing else. So a character keeps more of its
 * source than a scenario does, and that asymmetry is the schema's rather than
 * this converter's.
 */
function carriedCompat(character: Readonly<Record<string, unknown>>): Record<string, unknown> {
  const carried: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(character)) {
    if (!CONSUMED.has(key)) carried[key] = value;
  }
  return carried;
}
