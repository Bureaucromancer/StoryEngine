// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { NOTIFICATION_LABELS, foldedSuffix, summary } from './labels.js';

/**
 * Every notification class the server ships has a sentence here — [P10.2].
 *
 * ***This is `library/note-labels.test.ts` on a second subject, and it exists
 * because that one found twenty-four missing keys.*** The shape of the defect is
 * identical: the server sends `{ key, params }` and never prose ([19 §12.5]),
 * the client turns classes into words, and {@link summary}'s fallback renders an
 * unlabelled class **as itself**. That fallback is correct for a version skew —
 * a newer server's class appears rather than vanishing — and is a silent defect
 * for a build shipped against itself, and the two are indistinguishable at
 * runtime. So it is checked at build time.
 *
 * ***A grep over the server's union rather than a shared constant***, which is
 * the same trade that file names: a constant in `@storyengine/shared` would be
 * compiler-checked and stronger, and it would also put a client concern — words
 * — into the package that owns portable objects. Here the union is a closed,
 * four-line type in one file, so the grep is narrow and its failure is loud.
 *
 * **The orphan check is the half that catches the other direction**: a label for
 * a class that was never shipped, or was renamed, is a line nobody re-reads —
 * [manual testing §10.1]'s whole subject.
 */

const HERE = import.meta.dirname;
/**
 * The server's own union, which is the authority.
 *
 * This constant is the coupling the check has to keep honest: it is a fact about
 * a path, so moving `NotificationClass` without repointing it reports every
 * class as missing — loudly, which is the good failure.
 */
const CLASS_UNION = join(HERE, '..', '..', '..', 'server', 'src', 'state', 'notifications.ts');

/** The classes `NotificationClass` actually declares. */
function shippedClasses(): string[] {
  const source = readFileSync(CLASS_UNION, 'utf8');
  const at = source.indexOf('export type NotificationClass');
  expect(at, 'NotificationClass moved — repoint CLASS_UNION').toBeGreaterThan(-1);
  const declaration = source.slice(at, source.indexOf(';', at));
  return [...declaration.matchAll(/'([a-z]+\.[a-z-]+)'/g)].map((match) => match[1] ?? '');
}

describe('the notification vocabulary', () => {
  it('finds the server’s classes, so an empty match cannot pass', () => {
    // The floor every grep-based check here carries: a scan that stops finding
    // anything makes every assertion below vacuously true.
    expect(shippedClasses().length).toBeGreaterThanOrEqual(4);
  });

  it('has a sentence for every class the server ships', () => {
    const missing = shippedClasses().filter((one) => NOTIFICATION_LABELS[one] === undefined);

    expect(
      missing,
      `${String(missing.length)} class(es) would render as a dotted machine string. Add a row to NOTIFICATION_LABELS.`,
    ).toEqual([]);
  });

  /**
   * A variant key is `<class>:<param>` — the mechanism that lets one class have
   * two sets of words without becoming two classes. Its base class still has to
   * exist, or the variant is words for something nothing emits.
   */
  it('has no label for a class the server does not ship', () => {
    const shipped = new Set(shippedClasses());
    const orphans = Object.keys(NOTIFICATION_LABELS).filter(
      (key) => !shipped.has(key.split(':')[0] ?? key),
    );

    expect(orphans, 'label(s) for classes that are gone').toEqual([]);
  });
});

describe('composing a sentence', () => {
  it('fills the params into the template', () => {
    const said = summary({ class: 'turn.complete', params: { sessionName: 'The harbour' } });
    expect(said.title).toBe('Your turn is ready');
    expect(said.body).toBe('The harbour');
  });

  /**
   * ***The variant lookup, which is the reason there is no fifth class.***
   * [09 §3.5] named `artifact.ready` so its second instance would not require
   * renaming it; the second instance is a picture that failed, and it needs
   * different words rather than a different class.
   */
  it('gives a failed picture its own words', () => {
    const ready = summary({ class: 'artifact.ready', params: { outcome: 'ready', purpose: 'x' } });
    const failed = summary({
      class: 'artifact.ready',
      params: { outcome: 'failed', purpose: 'x' },
    });

    expect(ready.title).toBe('A picture is ready');
    expect(failed.title).toBe('A picture could not be made');
  });

  it('falls back to the base class when the variant is unknown', () => {
    const said = summary({
      class: 'artifact.ready',
      params: { outcome: 'something-new', purpose: 'x' },
    });
    // A newer server's outcome renders as the generic sentence rather than as
    // the raw class, which is the whole point of resolving most-specific-first.
    expect(said.title).toBe('A picture is ready');
  });

  it('renders an unknown class as itself rather than as a blank', () => {
    const said = summary({ class: 'message.received', params: {} });
    expect(said.title).toBe('message.received');
    expect(said.body).toBe('');
  });

  /**
   * *A param the template does not mention is not an error, and a template
   * field the params do not carry is left as written* — `sentence()`'s rule,
   * and the one that keeps a version skew legible rather than blank.
   */
  it('leaves an unfilled field as written', () => {
    expect(summary({ class: 'turn.complete', params: {} }).body).toBe('{sessionName}');
  });

  /**
   * ***A failed turn says what to do, not what class it was*** — [P11.6].
   *
   * This body was `{sessionName} — {error}` and `{error}` is
   * `transient | retryable | terminal | …`, so a person whose wifi was off got a
   * toast reading *Vera's story — transient*. The three cases below are the
   * three a stored notification can actually be in, and none of them may put a
   * machine word or a bare placeholder in front of a reader.
   */
  it('turns a failed turn into a sentence rather than a class', () => {
    const said = summary({
      class: 'turn.failed',
      params: { sessionName: 'The harbour', error: 'transient', remedy: 'endpoint-silent-offline' },
    });
    expect(said.body).toContain('The harbour');
    expect(said.body).toContain('no internet access');
    expect(said.body).not.toContain('transient');
  });

  /**
   * A row stored by a build older than [P11.6] carries the class and no remedy.
   * It still gets words, derived from the class alone, which lands on the arm
   * that says less — the same degrade the transcript makes.
   */
  it('derives one from the class alone for a row an older build wrote', () => {
    const said = summary({
      class: 'turn.failed',
      params: { sessionName: 'The harbour', error: 'unbound' },
    });
    expect(said.body).toContain('No connection is set up');
  });

  /**
   * ***And never a literal `{remedy}`***, which is the failure mode `fill`
   * has by design — an unmatched field is rendered as itself, which is right for
   * a missing name and useless for a missing sentence.
   */
  it('shows no placeholder when there is nothing to say', () => {
    const said = summary({ class: 'turn.failed', params: { sessionName: 'The harbour' } });
    expect(said.body).not.toContain('{remedy}');
  });
});

describe('a folded row says so', () => {
  it('is silent for one and counts from two', () => {
    // [09 §3.4]: *not five* is only true of the badge if the row says it stands
    // for five. A suffix on every row would be noise; none on any row would
    // make the fold invisible, which is the replace implementation with extra
    // steps.
    expect(foldedSuffix(1)).toBe('');
    expect(foldedSuffix(5)).toBe(' (5)');
  });
});
