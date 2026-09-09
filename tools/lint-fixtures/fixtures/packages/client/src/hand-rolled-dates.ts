// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

declare const when: Date;

/** Four ways to bake a locale in. */
export function Bad(): string[] {
  return [when.toLocaleDateString(), when.toLocaleString(), when.toDateString(), when.toUTCString()];
}

/**
 * `Intl` for display, `toISOString` for storage.
 *
 * The second is not an exception to the rule: an RFC 3339 timestamp is a
 * serialisation format, not a rendering, and the schemas require it
 * (docs/design/04-schemas.md §3).
 */
export function Good(): string[] {
  return [new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(when), when.toISOString()];
}
