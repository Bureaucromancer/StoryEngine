// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

/**
 * Date formatting — `Intl` only, from the first component
 * ([07 §12.6](../../../docs/design/07-tech-stack.md)). No hand-rolled "2 minutes ago".
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
  return formatterFor(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(date);
}

/** Epoch milliseconds (the account's `createdAt`) as a readable date. */
export function formatEpochMs(epochMs: number, locale?: string): string {
  return formatterFor(locale, { dateStyle: 'medium' }).format(new Date(epochMs));
}

/**
 * An `Intl` formatter that falls back rather than throwing on a bad locale.
 *
 * `new Intl.DateTimeFormat('not a locale')` throws a `RangeError`, and until
 * [P2A](../../../docs/design/workplan/13-p2a-configuration-surface.md) a locale
 * could only arrive from `Accept-Language` at setup — a header a browser
 * generates. **P2A makes it something a person types into a form**, and the
 * failure mode of the version above was that one bad value took out every date
 * on every page, including the settings page holding the field that would fix
 * it.
 *
 * So it falls back to the browser's rather than refusing. A date rendered in the
 * wrong locale is legible; a page that will not render is not, and the person
 * who typed `en_GB` instead of `en-GB` deserves a way back.
 *
 * Not repaired by validating the field instead: the value also arrives from
 * `accounts.json`, which is hand-editable by design, so the check has to be
 * here where the value is used.
 */
function formatterFor(locale: string | undefined, options: Intl.DateTimeFormatOptions) {
  try {
    return new Intl.DateTimeFormat(locale, options);
  } catch {
    return new Intl.DateTimeFormat(undefined, options);
  }
}
