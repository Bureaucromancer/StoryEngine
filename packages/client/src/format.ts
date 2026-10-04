// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

/**
 * Formatting — `Intl` only, from the first component
 * ([19 §12.6](../../../docs/design/19-tech-stack.md)). No hand-rolled "2 minutes ago",
 * and since [P3.2] no hand-rolled `${ms}ms` either: the workbench renders
 * token counts and wall times, and 07 §12.6a classes a hand-rolled duration
 * as a rewrite if deferred.
 *
 * `locale` is the account's, when there is one; `undefined` falls back to the
 * browser's. Passing it explicitly rather than reading a global keeps these
 * pure, which is also what makes them testable under Node.
 *
 * ***Required, and allowed to be `undefined`*** (2026-09-28) — the
 * *required and nullable rather than optional* rule `LorebookView` states. It
 * was optional, so a caller that forgot it compiled and wrote the browser's
 * dates and numbers under an account set to another language's: about
 * twenty-five did, the backup and trash lists, the notification list, the lore
 * report's token counts and the book page among them. Required, the compiler
 * names each one, and `undefined` is still there to say *the browser's* on
 * purpose.
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
export function formatTimestamp(iso: string, locale: string | undefined): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return formatterFor(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(date);
}

/** Epoch milliseconds (the account's `createdAt`) as a readable date. */
export function formatEpochMs(epochMs: number, locale: string | undefined): string {
  return formatterFor(locale, { dateStyle: 'medium' }).format(new Date(epochMs));
}

/**
 * An `Intl` formatter that falls back rather than throwing on a bad locale.
 *
 * `new Intl.DateTimeFormat('not a locale')` throws a `RangeError`, and until
 * [P2A](../../../docs/design/workplan/09-p2a-configuration-surface.md) a locale
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

/**
 * A bare `YYYY-MM-DD` — a CHANGELOG release heading's third field.
 *
 * **Not `formatTimestamp`, and the difference is not pedantry.** A release
 * heading carries a *calendar date*: no time, no zone, nothing that fixes an
 * instant. `new Date('2026-09-09')` is specified to parse as **UTC midnight**,
 * so handing it to a formatter in the reader's own zone renders it as the
 * eighth for everybody west of Greenwich — and the workbench's list would then
 * disagree, in a way nobody could reproduce, with the file it is reading and
 * with the tag the release actually carries.
 *
 * `timeZone: 'UTC'` pins the render to the zone the parse used, which is the
 * only way a date with no instant behind it comes out as the same day
 * everywhere. The date is built from its own fields rather than from the string
 * so that the parse is not a second thing to trust.
 *
 * An unparsable input comes back unchanged, which is `formatTimestamp`'s
 * posture for `formatTimestamp`'s reason: the value is still information, and a
 * blank would hide it. `Temporal.PlainDate` is what this eventually becomes —
 * it is exactly this type — but it is not in the client's baseline yet.
 */
export function formatCalendarDate(date: string, locale: string | undefined): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (match === null) return date;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const value = new Date(Date.UTC(year, month - 1, day));
  // **`Date.UTC` rolls over rather than refusing**, so a thirteenth month is a
  // date in the following year and a fortieth day is a date in the following
  // month — silently, and well-formed enough to render. `2026-13-40` came back
  // as *Feb 9, 2027* before this check existed. Reading the fields back is the
  // cheap way to tell a date that was written from one that was computed out of
  // nonsense, and a heading nobody can parse is shown as typed for the same
  // reason the malformed case above is.
  if (
    value.getUTCFullYear() !== year ||
    value.getUTCMonth() !== month - 1 ||
    value.getUTCDate() !== day
  ) {
    return date;
  }
  return formatterFor(locale, { dateStyle: 'medium', timeZone: 'UTC' }).format(value);
}

/**
 * A count — tokens, rows — with the locale's grouping. `1234` unformatted
 * reads fine; `128000` does not, and the context windows this app renders are
 * the second kind.
 */
export function formatCount(count: number, locale: string | undefined): string {
  return numberFormatterFor(locale, {}).format(count);
}

/**
 * An amount of money, as a provider reported it.
 *
 * ***Fractions of a cent are the ordinary case***, which is why the precision
 * runs to six places: one model call is routinely `$0.0021`, and rounding it to
 * the currency's two digits would print `$0.00` — *free*, which is exactly the
 * claim `TurnCost` exists not to make.
 *
 * *A currency that is not an ISO code is shown as its own word.* A provider may
 * price in its own unit (OpenRouter's credits are one), and `Intl` refuses a
 * code it does not know; the number still reads, followed by what it is in.
 */
export function formatMoney(amount: number, currency: string, locale: string | undefined): string {
  if (/^[A-Z]{3}$/.test(currency)) {
    try {
      return new Intl.NumberFormat(locale, {
        style: 'currency',
        currency,
        minimumFractionDigits: 2,
        maximumFractionDigits: 6,
      }).format(amount);
    } catch {
      // An unrecognised three-letter code falls through to the plain form.
    }
  }
  return `${numberFormatterFor(locale, { maximumFractionDigits: 6 }).format(amount)} ${currency}`;
}

/**
 * A wall time in milliseconds, at the precision the magnitude deserves:
 * milliseconds below a second, seconds to one decimal below a minute,
 * minutes to one decimal above — a 59-second model call reads as `59 s`,
 * not `59029`.
 */
export function formatDuration(ms: number, locale: string | undefined): string {
  if (ms < 1000) {
    return numberFormatterFor(locale, {
      style: 'unit',
      unit: 'millisecond',
      maximumFractionDigits: 0,
    }).format(ms);
  }
  if (ms < 60_000) {
    return numberFormatterFor(locale, {
      style: 'unit',
      unit: 'second',
      maximumFractionDigits: 1,
    }).format(ms / 1000);
  }
  return numberFormatterFor(locale, {
    style: 'unit',
    unit: 'minute',
    maximumFractionDigits: 1,
  }).format(ms / 60_000);
}

/**
 * A fraction as a percentage in the reader's format — *40 %* in French, *40%*
 * in English. Here since 2026-09-28: the cast panel built its own formatter
 * with `undefined` for a locale, the one number in the client that took the
 * browser's format whatever the account said, and one no required parameter
 * could catch, since it never called this file.
 */
export function formatPercent(fraction: number, locale: string | undefined): string {
  return numberFormatterFor(locale, { style: 'percent' }).format(fraction);
}

/** The same fallback-not-throw stance as `formatterFor`, for the same P2A reason. */
function numberFormatterFor(locale: string | undefined, options: Intl.NumberFormatOptions) {
  try {
    return new Intl.NumberFormat(locale, options);
  } catch {
    return new Intl.NumberFormat(undefined, options);
  }
}
