// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

/**
 * Date formatting — `Intl` only, from the first component
 * ([07 §12.6](docs/design/07-tech-stack.md)). No hand-rolled "2 minutes ago".
 *
 * `locale` is the account's, when there is one; `undefined` falls back to the
 * browser's. Passing it explicitly rather than reading a global keeps these
 * pure, which is also what makes them testable under Node.
 */

/** A portable object's `provenance` timestamps, when it has any. */
export interface Timestamps {
  createdAt: string | null;
  updatedAt: string | null;
}

export function timestampsOf(object: Record<string, unknown>): Timestamps {
  const provenance = object['provenance'];
  if (typeof provenance !== 'object' || provenance === null) {
    return { createdAt: null, updatedAt: null };
  }
  const record = provenance as Record<string, unknown>;
  return {
    createdAt: typeof record['createdAt'] === 'string' ? record['createdAt'] : null,
    updatedAt: typeof record['updatedAt'] === 'string' ? record['updatedAt'] : null,
  };
}

/**
 * An RFC 3339 timestamp as a readable date and time.
 *
 * An unparsable input comes back unchanged: the value is still information, and
 * a blank or a crash would hide it.
 */
export function formatTimestamp(iso: string, locale?: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(date);
}

/** Epoch milliseconds (the account's `createdAt`) as a readable date. */
export function formatEpochMs(epochMs: number, locale?: string): string {
  return new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }).format(new Date(epochMs));
}
