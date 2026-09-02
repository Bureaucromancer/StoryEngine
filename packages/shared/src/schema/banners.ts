// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import type { TSchema } from '@sinclair/typebox';

/**
 * The comment banners in a schema file, promoted from comments to schema.
 *
 * **`LoreEntry` is written under banners** — `── Matching ──`, `── Firing ──`,
 * `── Timing ──` and the rest — and
 * [05 §11.2d](../../../../docs/design/05-ui-surfaces.md) builds the entry
 * editor's disclosures out of them, on the grounds that *the structure already
 * exists, in the schema file, and the only editorial decision left is which
 * groups start open*. [05 §5.3](../../../../docs/design/05-ui-surfaces.md) asks
 * the book page's read-only *as configured* fold to render the same groups
 * through the same component.
 *
 * That is a promise a comment cannot keep. A comment is not there at runtime, so
 * a surface reading it has to be told the grouping a second time — and a second
 * telling is the drift [polish §1](../../../../docs/design/workplan/09-polish.md)
 * exists to prevent. So the banner becomes an annotation on the field it
 * introduces, and the comment goes away rather than sitting beside it as the
 * copy that will be the one somebody updates.
 *
 * **A banner marks a boundary, not a membership list.** It names the group its
 * field *starts*; everything after it belongs to that group until the next
 * banner. That is exactly what the comment did, and it is what makes
 * §11.2d's claim true by construction rather than by remembering — a field
 * added under a banner joins that group with no second edit anywhere, because
 * there is no list of members to add it to.
 *
 * **It is an annotation, not a field**, which is the test
 * [16 §4](../../../../docs/design/16-lorebooks-as-a-format.md) sets for
 * anything new arriving in these schemas: nothing validates differently,
 * nothing round-trips that did not, and no author can write one. It reaches the
 * emitted artefact, where it is documentation a stranger gets for free —
 * JSON Schema ignores keywords it does not know, and Ajv is configured
 * non-strict for reasons that predate this.
 */

/** The keyword, in the engine's reserved namespace ([01 §2]). */
export const BANNER_KEYWORD = 'se:banner';

export interface FieldBanner {
  /** The group's name, in the schema's own words. */
  title: string;
  /**
   * The editorial subtitle, where the banner carries one — *four distinct
   * behaviours, not four takes on one*. §11.2d calls these "the section's help
   * text, written by the person who chose the fields", which is why they travel
   * with the banner rather than being written again by a surface.
   */
  note?: string;
}

/**
 * The options to hang on the field that starts a group.
 *
 * Spelled as a call rather than an object literal at each site so that the
 * keyword is written once — a string key repeated thirty times is a string key
 * that will eventually be repeated wrong.
 */
export function banner(title: string, note?: string): { [BANNER_KEYWORD]: FieldBanner } {
  return { [BANNER_KEYWORD]: note === undefined ? { title } : { title, note } };
}

/** The banner a field carries, or null when it continues the group above it. */
export function bannerOf(schema: unknown): FieldBanner | null {
  if (typeof schema !== 'object' || schema === null) return null;
  const found: unknown = (schema as Record<string, unknown>)[BANNER_KEYWORD];
  if (typeof found !== 'object' || found === null) return null;
  const title: unknown = (found as { title?: unknown }).title;
  if (typeof title !== 'string') return null;
  const note: unknown = (found as { note?: unknown }).note;
  return typeof note === 'string' ? { title, note } : { title };
}

/**
 * Every banner an object schema declares, in field order.
 *
 * For the invariant tests, and for a surface that wants to know what the groups
 * are without walking the fields itself.
 */
export function bannersOf(schema: TSchema): (FieldBanner & { from: string })[] {
  const properties: unknown = (schema as { properties?: unknown }).properties;
  if (typeof properties !== 'object' || properties === null) return [];

  return Object.entries(properties as Record<string, unknown>).flatMap(([key, field]) => {
    const found = bannerOf(field);
    return found === null ? [] : [{ ...found, from: key }];
  });
}
