// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import type { JSX } from 'react';

import { UNMET_REQUIREMENTS, type UnmetRequirement } from '@storyengine/shared';

import { ApiError, errorCode } from '../api.js';
import { labels } from '../i18n/catalogue.js';
import { roleLabel } from '../settings/roleWords.js';
import { Button } from '../ui/Button.js';
import { Dialog } from '../ui/Dialog.js';
import { Note, SubsectionTitle } from '../ui/Text.js';

/**
 * ***Start anyway*** — 2026-10-13, the owner's answer to *"Build the promise,
 * or narrow the notes"*: build it.
 * [03 §7.2](../../../../docs/design/03-data-model.md) promises *"this wants
 * Campaign ≥ 2 and an image connection; you have neither"* rather than a
 * broken session later, and a degraded start rather than a hard block where
 * possible. `POST /api/sessions` answers a start whose World or Setup wants
 * what this install lacks with `422 unmet-requirements` and the list; this is
 * where a person reads it and decides.
 *
 * **Every door that starts a session shows it** — the Setup's page
 * (`StartSession`), the World's (`StartInWorld`) and the session form
 * (`SessionsPage`) — because all three can reach a Setup or a World somebody
 * else made. Each sends its request again with `degraded: true` on **Start
 * anyway**, and on **Cancel** sends nothing: the refusal made nothing, so
 * there is nothing to take back.
 *
 * ***A dialog, and not `TwoStep`***: TwoStep's answer is always `danger`, and
 * it is kept for what destroys something ([polish §20](../../../../docs/design/workplan/06-polish.md)).
 * Starting a session that plays without a mode destroys nothing — it is a
 * question with two good answers, so it is asked as one, `alertdialog` because
 * it was raised by a refusal rather than opened on purpose (`Dialog`'s own
 * distinction).
 *
 * ***Each item says what is missing and what *anyway* means for it***, since
 * that is the whole decision: a missing mode the session would play means
 * another mode in its place; a model role not set means what needs it goes
 * without; an extension means nothing loads it. Whole sentences per kind,
 * in a labels table — the server sends `{ kind, id, … }` and never prose, and
 * a sentence built from fragments cannot be translated.
 *
 * **Read by the class, never by the English** (`errorCode`, polish §21): the
 * refusal's `message` is the server's own fallback and is not shown.
 */

const WORDS = labels('start.unmet', {
  title: 'This needs things this install does not have',
  lead: 'It can start anyway. This is what it would start without, and what that means for each:',
  modeSubstituted:
    'The {mode} mode, which this install does not have. Started anyway, it plays in this install’s default mode instead, without the answers its setup gave that mode.',
  modeSubstitutedAt:
    'The {mode} mode, version {minVersion} or later, which this install does not have. Started anyway, it plays in this install’s default mode instead, without the answers its setup gave that mode.',
  modeMissing:
    'The {mode} mode, which this install does not have. Started anyway, whatever needs that mode may not play.',
  modeMissingAt:
    'The {mode} mode, version {minVersion} or later, which this install does not have. Started anyway, whatever needs that mode may not play.',
  modeOlder:
    'The {mode} mode, version {minVersion} or later — this install has {installed}. Started anyway, it uses the version this install has.',
  capability:
    'A model for “{capability}”, which is not set for you. Started anyway, whatever needs it goes without until one is chosen in Settings, under Which models your stories use.',
  capabilityUnknown:
    '“{capability}”, which this build cannot check for. Started anyway, whatever needs it may not work.',
  extension:
    'The {extension} extension, version {minVersion} or later. This build loads no extensions, so it starts without it.',
  // A kind a newer server sent that this build has never heard of — said by
  // its id rather than dropped, so nothing the person was meant to see is lost.
  unknown:
    '“{id}”, which this build does not know how to check. Started anyway, it goes without it.',
  startAnyway: 'Start anyway',
  cancel: 'Cancel',
});

/**
 * The list a start was refused with, or `null` when the refusal was something
 * else — read by its class, so a reworded server message changes nothing.
 */
export function unmetOf(failure: unknown): UnmetRequirement[] | null {
  if (errorCode(failure) !== UNMET_REQUIREMENTS) return null;
  return failure instanceof ApiError ? (failure.unmet ?? []) : [];
}

/** One requirement in plain words: what is missing, and what starting anyway means for it. */
export function unmetSentence(one: UnmetRequirement): string {
  switch (one.kind) {
    case 'mode': {
      const at = one.minVersion;
      const template =
        one.installed !== null
          ? WORDS.modeOlder
          : one.substituted === true
            ? at === undefined
              ? WORDS.modeSubstituted
              : WORDS.modeSubstitutedAt
            : at === undefined
              ? WORDS.modeMissing
              : WORDS.modeMissingAt;
      return template
        .replace('{mode}', () => one.id)
        .replace('{minVersion}', () => at ?? '')
        .replaceAll('{installed}', () => one.installed ?? '');
    }
    case 'capability':
      return (one.checkable ? WORDS.capability : WORDS.capabilityUnknown).replace(
        '{capability}',
        () => roleLabel(one.id),
      );
    case 'extension':
      return WORDS.extension
        .replace('{extension}', () => one.id)
        .replace('{minVersion}', () => one.minVersion);
    default:
      return WORDS.unknown.replace('{id}', () => (one as { id: string }).id);
  }
}

/**
 * The dialog. **Start anyway** is the caller's to send — the same request with
 * `degraded: true` — and **Cancel** closes it having sent nothing. Escape and
 * a click outside are Cancel (`Dialog`'s `onDismiss`).
 */
export function StartAnyway(props: {
  unmet: readonly UnmetRequirement[];
  busy: boolean;
  onStart: () => void;
  onCancel: () => void;
}): JSX.Element {
  return (
    <Dialog role="alertdialog" labelledBy="start-anyway-title" onDismiss={props.onCancel}>
      <SubsectionTitle id="start-anyway-title" as="h2">
        {WORDS.title}
      </SubsectionTitle>
      <Note>{WORDS.lead}</Note>
      <ul className="flex list-disc flex-col gap-2 ps-5 text-sm text-ink">
        {props.unmet.map((one) => (
          <li key={`${one.kind}:${one.id}`}>{unmetSentence(one)}</li>
        ))}
      </ul>
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant="primary"
          autoFocus
          disabled={props.busy}
          onClick={props.onStart}
        >
          {WORDS.startAnyway}
        </Button>
        <Button type="button" variant="quiet" onClick={props.onCancel}>
          {WORDS.cancel}
        </Button>
      </div>
    </Dialog>
  );
}
