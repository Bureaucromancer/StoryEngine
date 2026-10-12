// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { Link } from '@tanstack/react-router';
import { useEffect, useRef, type JSX, type Ref } from 'react';

import type { FileSet } from '@storyengine/shared';

import { ApiError, PublishError, type PublishedFile } from '../../api.js';
import { megabytes } from '../../format.js';
import { AlertNote } from '../../ui/Alert.js';
import { Button } from '../../ui/Button.js';
import { link, page } from '../../ui/classes.js';
import { publishSentence } from './notes.js';
import { countPhrase, REFUSAL_WORDS, WORDS } from './words.js';

/**
 * ***The strip the decision is made from, and what it said*** —
 * [P16.3g](../../../../../docs/design/workplan/34-p16-world.md),
 * [10 §11.6](../../../../../docs/design/10-ui-surfaces.md)'s held controls.
 *
 * **Sticky, in the page's own actions strip** (`page.actions`): a review of
 * forty rows is scrolled, and the button it ends in should not be at the end
 * of the scroll. ***In it, and only in it***, the decision itself:
 *
 * - **the totals, as a `status`** — what is in the file right now, re-said as
 *   ticks change, so a screen reader hears the consequence of a tick without
 *   hunting for it;
 * - **Publish, disabled while pending** — the plan's only guard against a
 *   double confirm keeping two Worlds (risk 14: no server-side idempotency) —
 *   and while a kept World's name is empty, while the file would hold nothing
 *   at all, or once this selection has been kept (below);
 * - **Look again**, which re-walks the library and keeps the ticks whose keys
 *   it still holds.
 *
 * ***Everything else is in the page, above the strip*** (2026-10-11, the
 * P16.3g review's one blocking finding). The first build put the warnings —
 * every `warn` note of the live `fileSet`, said again beside the button — and
 * the whole outcome — saved, the World kept with *Open it*, drift, what could
 * not be carried, one sentence per note the file says, up to a 3 KiB header's
 * worth — inside the sticky element too. Measured in a browser, at 280 × 640
 * the strip was 359 px of a 424 px column before a publish and **703 px**
 * after it: the review's own rows could not be scrolled into view at all, and
 * at 360 × 740 the totals were pushed above the column's top edge. A strip is
 * for the controls that must stay on screen; a list that grows with the file
 * is not one. So the strip holds three things that wrap to a few lines at
 * 280 px, and the rest is drawn in flow directly above it, where the end of
 * the scroll leaves it beside the button.
 *
 * ***What happened is said, and the keyboard is given back*** (the same
 * review). The outcome's first lines are a `status` that is on the page —
 * empty — before the press, because one inserted already holding its text is
 * one most screen readers never read (`ui/TwoStep.tsx` has the argument); a
 * refusal is an `alert`. And because Publish and Look again are disabled while
 * they run, the focus they held falls to `<body>`, where Tab starts again at
 * the top of the document — `PlayPage`'s finding, and its rule: on the
 * transition, and only when focus was dropped rather than placed, give it to
 * the control that is the next thing to do — Publish again, or *Open it* when
 * the selection was kept and Publish stays off, or Look again after a look.
 */
export function PublishActions(props: {
  set: FileSet;
  /** What is in the file once the review's own reading is applied — the totals line's numbers. */
  totals: { objects: number; sessions: number; pictures: number; bytes: number };
  publishing: boolean;
  blocked: boolean;
  looking: boolean;
  kept: { id: string; name: string } | null;
  keptHere: boolean;
  result: PublishedFile | undefined;
  failure: Error | null;
  onPublish: () => void;
  onLookAgain: () => void;
}): JSX.Element {
  const totals = props.totals;
  const warnings = props.set.notes.filter((note) => note.level === 'warn');
  const publishButton = useRef<HTMLButtonElement>(null);
  const lookButton = useRef<HTMLButtonElement>(null);
  const outcome = useRef<HTMLDivElement>(null);
  /**
   * ***What the last publish answered*** — the transition this keys on, rather
   * than `publishing` turning false: a confirm that answers inside one tick is
   * never drawn pending at all (the query client batches its notifications), so
   * a rule waiting for *pending, then not* would miss it. A new answer is a new
   * object, so this runs once per answer — and again if the kept World arrives
   * a render later and turns Publish off under the focus just given to it.
   */
  const answered = props.publishing ? null : (props.failure ?? props.result ?? null);
  const wasLooking = useRef(props.looking);

  useEffect(() => {
    if (answered === null) return;
    const publish = publishButton.current;
    giveFocus(
      publish?.disabled === false
        ? publish
        : (outcome.current?.querySelector<HTMLElement>('a') ?? lookButton.current),
      [publish, lookButton.current],
    );
  }, [answered, props.keptHere]);

  useEffect(() => {
    const looked = wasLooking.current && !props.looking;
    wasLooking.current = props.looking;
    if (looked) giveFocus(lookButton.current, [publishButton.current, lookButton.current]);
  }, [props.looking]);

  return (
    <>
      {warnings.length === 0 ? null : (
        <div className="mb-4 text-sm">
          <p className="text-warn-ink">{WORDS.beforeYouPublish}</p>
          <ul className="ms-4 list-disc text-warn-ink">
            {warnings.map((note, index) => (
              <li key={index} className="break-words">
                {publishSentence(note)}
              </li>
            ))}
          </ul>
        </div>
      )}
      <Outcome {...props} at={outcome} />
      <div className={page.actions}>
        <p role="status" className="w-full min-w-0 break-words text-sm text-ink">
          {WORDS.totals
            .replace('{objects}', countPhrase(WORDS.objectsOne, WORDS.objectsMany, totals.objects))
            .replace(
              '{sessions}',
              countPhrase(WORDS.sessionsOne, WORDS.sessionsMany, totals.sessions),
            )
            .replace(
              '{pictures}',
              countPhrase(WORDS.sessionPicturesOne, WORDS.sessionPicturesMany, totals.pictures),
            )
            .replace('{size}', megabytes(totals.bytes))}
        </p>
        <Button
          ref={publishButton}
          type="button"
          variant="primary"
          disabled={props.publishing || props.blocked || props.keptHere}
          onClick={props.onPublish}
        >
          {props.publishing ? WORDS.publishing : WORDS.publish}
        </Button>
        <Button
          ref={lookButton}
          type="button"
          disabled={props.looking || props.publishing}
          onClick={props.onLookAgain}
        >
          {props.looking ? WORDS.looking : WORDS.lookAgain}
        </Button>
      </div>
    </>
  );
}

/**
 * What the last confirm said — a file and its lines, or the refusal.
 *
 * **The `status` is always mounted**, empty while nothing has happened and
 * while a publish runs, and filled when it answers — so the change is what a
 * screen reader hears. It holds what a person needs to know at once: saved,
 * kept, drift, how many references could not be carried. The notes the file
 * says follow it as plain text, because a live region reads whole, and a
 * header's worth of picture names read aloud on every publish would bury the
 * line that matters.
 */
function Outcome(props: {
  kept: { id: string; name: string } | null;
  keptHere: boolean;
  result: PublishedFile | undefined;
  failure: Error | null;
  publishing: boolean;
  at: Ref<HTMLDivElement>;
}): JSX.Element {
  const failure = props.publishing ? null : props.failure;
  const file = props.publishing || failure !== null ? undefined : props.result;
  return (
    <div ref={props.at} className="mb-4 flex flex-col gap-1 text-sm text-ink-subtle">
      <div role="status" className="flex flex-col gap-1">
        {file === undefined ? null : (
          <>
            <p className="break-words">
              {file.fileName === null
                ? WORDS.savedNoName
                : WORDS.saved.replace('{file}', () => file.fileName ?? '')}
            </p>
            {props.kept === null ? null : <KeptLine kept={props.kept} words={WORDS.kept} />}
            {props.keptHere && props.kept !== null ? (
              <p className="break-words">
                {WORDS.keptAlready.replace('{name}', () => props.kept?.name ?? '')}
              </p>
            ) : null}
            {file.drift ? <p>{WORDS.drift}</p> : null}
            {file.missing === 0 ? null : (
              <p>{countPhrase(WORDS.missingOne, WORDS.missingMany, file.missing)}</p>
            )}
          </>
        )}
      </div>
      {failure === null ? null : (
        <div role="alert" className="flex flex-col gap-1">
          <AlertNote>{refusalLine(failure)}</AlertNote>
          {props.kept === null ? null : (
            <KeptLine kept={props.kept} words={REFUSAL_WORDS.changedKept} />
          )}
        </div>
      )}
      {file === undefined || file.notes.length === 0 ? null : (
        <ul className="flex flex-col gap-1">
          {file.notes.map((note, index) => (
            <li key={index} className="break-words">
              {publishSentence(note)}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** *Kept as the world “Rain City”* — and the way to it. */
function KeptLine(props: { kept: { id: string; name: string }; words: string }): JSX.Element {
  return (
    <span className="flex flex-wrap items-baseline gap-x-2 text-sm">
      <span className="break-words">{props.words.replace('{name}', () => props.kept.name)}</span>
      <Link
        to="/library/$kind/$id"
        params={{ kind: 'worlds', id: props.kept.id }}
        search={{}}
        className={link.inline}
      >
        {WORDS.openIt}
      </Link>
    </span>
  );
}

/** By the class the server sends, never its English (`errorCode`'s rule). */
function refusalLine(failure: Error): string {
  if (!(failure instanceof ApiError)) return REFUSAL_WORDS.unreachable;
  switch (failure.code) {
    case 'not-found':
      return REFUSAL_WORDS.notFound;
    case 'world-in-selection':
      return REFUSAL_WORDS.worldInSelection;
    case 'invalid-name':
      return REFUSAL_WORDS.invalidName;
    case 'publish.tooLarge':
      return REFUSAL_WORDS.tooLarge;
    case 'publish.changed':
      return REFUSAL_WORDS.changed;
    case 'no-space':
      return REFUSAL_WORDS.noSpace;
    case 'publish.interrupted':
      return REFUSAL_WORDS.interrupted;
    default:
      return REFUSAL_WORDS.failed;
  }
}

/**
 * The kept World a refusal names — a `409` after the keep, or a file that did
 * not arrive after the server had kept one (`publish.interrupted`, whose
 * header carries the id and not the name: the page has the name it sent).
 */
export function keptByRefusal(failure: unknown): { id: string; name: string | null } | null {
  return failure instanceof PublishError ? failure.world : null;
}

/**
 * ***Give the keyboard to `to` — only if it was dropped rather than placed.***
 * Three spellings of *dropped*, `PlayPage`'s: a browser moves focus to `<body>`
 * when the element holding it is disabled; jsdom leaves it on the disabled
 * element (`held`), and a browser may too when the disable and the re-enable
 * fall in one frame. Anywhere else is somewhere the person chose to be, which
 * this does not take back.
 */
function giveFocus(to: HTMLElement | null, held: readonly (HTMLElement | null)[]): void {
  const active = document.activeElement;
  const dropped = active === null || active === document.body || held.some((one) => one === active);
  if (dropped) to?.focus();
}
