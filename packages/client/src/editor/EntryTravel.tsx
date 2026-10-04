// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { useEffect, useRef, useState, type JSX } from 'react';
import { useQuery } from '@tanstack/react-query';

import type { Lorebook } from '@storyengine/shared';

import { api } from '../api.js';
import { labels } from '../i18n/catalogue.js';
import { Button } from '../ui/Button.js';
import { Fine, Note, SubsectionTitle } from '../ui/Text.js';
import {
  mergeEntries,
  readableAsEntries,
  picturesLeftBehind,
  selectionAsLorebook,
  type MergeReport,
} from './entry-travel.js';

/**
 * ***The controls §11.2c asks for, beside select, reorder and delete*** —
 * [10 §11.2c](../../../../docs/design/10-ui-surfaces.md).
 *
 * *"Exporting a selection of entries, and importing entries into an open book,
 * are ordinary actions on the entry list … reached the same way as everything
 * else there rather than as a narrow case of the library's whole-object import
 * and export."* So this sits in the entry list's own header rather than in a
 * menu, and what it produces and consumes is a lorebook — see
 * [entry-travel.ts](./entry-travel.ts) for why that one decision carries most of
 * the design.
 *
 * ***The review is rendered in the list rather than as a modal***, and it is
 * non-blocking per [00 §3.3](../../../../docs/design/00-stance.md): the merge
 * has already happened in the draft when the review appears, which is what makes
 * it *fixable before committing* rather than a dialog standing between somebody
 * and their own book. **Nothing has been written until Save**, and Save is the
 * commit §11.2c means.
 */

const WORDS: Readonly<Record<string, string>> = labels('editor.entry-travel', {
  choose: 'Select several',
  done: 'Done selecting',
  all: 'All',
  none: 'None',
  export: 'Export selected',
  import: 'Import entries…',
  reading: 'Reading…',
  unreadable: 'That file is not something this build can read.',
  'wrong-schema': 'That is a StoryEngine file of another kind, not a lorebook.',
  'no-entries': 'That lorebook has no entries in it.',
  hint: 'An export is a lorebook, so it opens anywhere a lorebook does — and anything that reads one can be imported here.',
  dismiss: 'Dismiss',
});

/**
 * ***What the export leaves behind, said beside the button*** (2026-09-27).
 *
 * A lorebook file carries a picture's row and never its bytes, so an export
 * leaves the pictures where they are rather than sending rows that name
 * nothing — and says so before the click rather than after the download.
 */
function PicturesStay(props: { count: number }): JSX.Element | null {
  if (props.count === 0) return null;
  return <Fine>{picturesStayLine(props.count)}</Fine>;
}

function picturesStayLine(count: number): string {
  return count === 1
    ? '1 picture stays behind: an export carries the entries’ text, not their pictures.'
    : `${String(count)} pictures stay behind: an export carries the entries’ text, not their pictures.`;
}

/**
 * The name the downloaded file takes.
 *
 * **Letters, numbers, spaces, hyphens and underscores, and nothing else.** A
 * file name is not a display name: a book called `Rain City: *the wet years*`
 * is a perfectly good book and a poor path on three filesystems, and a browser
 * given one quietly substitutes its own rules.
 *
 * ***The whitespace collapse is not tidiness.*** Stripping a character out of
 * the middle of a name leaves the spaces that were around it — which is how
 * `Ardent — entries` became `Ardent  entries`, with two, found by the test
 * below asserting the name it expected rather than the name it got.
 */
function fileNameFor(name: string): string {
  const stem = name
    .replace(/[^\p{L}\p{N} _-]/gu, '')
    .replace(/\s+/gu, ' ')
    .trim();
  return `${stem === '' ? 'entries' : stem}.json`;
}

/**
 * The download, built in the page.
 *
 * *Not a server route*, unlike a session export: what is being exported is a
 * selection of the **draft**, including entries edited and not yet saved, and a
 * route would only ever see what is on disk. Somebody who selected four entries,
 * fixed a typo in one and exported would otherwise get the typo.
 */
function download(book: Lorebook): void {
  const blob = new Blob([JSON.stringify(book, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileNameFor(book.name);
  anchor.click();
  // Revoked rather than left: an object URL pins the blob in memory for the
  // life of the document, and a book of two hundred entries is not nothing.
  URL.revokeObjectURL(url);
}

export function EntryTravel(props: {
  book: Lorebook;
  chosen: ReadonlySet<string>;
  choosing: boolean;
  onChoosing: (next: boolean) => void;
  onChoose: (ids: ReadonlySet<string>) => void;
  /** The ids the list is showing, so *All* means all of what can be seen. */
  visibleIds: readonly string[];
  /** Applies the merge to the draft, and remembers where it came from. */
  onMerged: (book: Lorebook, from: string) => void;
}): JSX.Element {
  const picker = useRef<HTMLInputElement | null>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [report, setReport] = useState<MergeReport | null>(null);

  /**
   * ***The book as the form last rendered it, for a merge that lands late***
   * (2026-09-27).
   *
   * The merge waits on `file.text()`, and the file input's handler closes over
   * the book as it was when the dialog closed. Merging into that one wrote back,
   * with the imported entries, a book that had lost whatever an assist or an
   * upload put in it meanwhile. Everywhere else in the editor that is solved by
   * writing an updater (`LorebookEditorPage`'s `edit` says why); this write
   * cannot be one, because `mergeEntries` mints ids for clashing entries and the
   * report it returns describes the book it merged into — an updater may run
   * twice, and a report computed outside it would describe a different book. So
   * it reads the book at the last possible moment instead. Kept in an effect
   * rather than written during render, which is React's rule for refs.
   */
  const latestBook = useRef(props.book);
  useEffect(() => {
    latestBook.current = props.book;
  });

  /**
   * **Who this install has**, which is the only way *refers to nothing* gets an
   * answer — an `actorFilter` names an actor and a file cannot know whether it
   * is here. Read once when the panel mounts; a merge is not a moment where
   * somebody is also creating actors.
   */
  const actors = useQuery({
    queryKey: ['library', 'actors'],
    queryFn: () => api.listLibrary('actors'),
  });
  const knownActors = new Set((actors.data?.objects ?? []).map((one) => one.id));

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          onClick={() => {
            props.onChoosing(!props.choosing);
            if (props.choosing) props.onChoose(new Set());
          }}
        >
          {props.choosing ? WORDS['done'] : WORDS['choose']}
        </Button>

        {props.choosing ? (
          <>
            <Button
              type="button"
              variant="quiet"
              onClick={() => {
                props.onChoose(new Set(props.visibleIds));
              }}
            >
              {WORDS['all']}
            </Button>
            <Button
              type="button"
              variant="quiet"
              onClick={() => {
                props.onChoose(new Set());
              }}
            >
              {WORDS['none']}
            </Button>
            <Button
              type="button"
              disabled={props.chosen.size === 0}
              onClick={() => {
                download(selectionAsLorebook(props.book, props.chosen));
              }}
            >
              {WORDS['export']}
            </Button>
            <PicturesStay count={picturesLeftBehind(props.book, props.chosen)} />
          </>
        ) : null}

        <input
          ref={picker}
          type="file"
          accept="application/json,.json"
          // Hidden from everyone rather than only from sight — the same rule
          // `ImportSession` learned: `sr-only` leaves a second, unlabelled
          // control in the accessibility tree for one act.
          aria-hidden="true"
          tabIndex={-1}
          className="sr-only"
          onChange={(event) => {
            const file = event.target.files?.[0];
            // The input keeps its value, so the same file twice would otherwise
            // fire nothing the second time.
            event.target.value = '';
            if (file === undefined) return;

            setBusy(true);
            setProblem(null);
            setReport(null);
            void file.text().then(
              (text) => {
                setBusy(false);
                let parsed: unknown;
                try {
                  parsed = JSON.parse(text) as unknown;
                } catch {
                  setProblem(WORDS['unreadable'] ?? '');
                  return;
                }
                const read = readableAsEntries(parsed);
                if ('problem' in read) {
                  setProblem(WORDS[read.problem] ?? WORDS['unreadable'] ?? '');
                  return;
                }
                const merged = mergeEntries(latestBook.current, read.book, knownActors);
                setReport(merged.report);
                props.onMerged(merged.book, file.name);
              },
              () => {
                setBusy(false);
                setProblem(WORDS['unreadable'] ?? '');
              },
            );
          }}
        />
        <Button
          type="button"
          disabled={busy}
          onClick={() => {
            picker.current?.click();
          }}
        >
          {busy ? WORDS['reading'] : WORDS['import']}
        </Button>
      </div>

      {problem === null ? (
        <Fine>{WORDS['hint']}</Fine>
      ) : (
        <p role="alert" className="text-sm text-danger-ink">
          {problem}
        </p>
      )}

      {report === null ? null : (
        <ImportReview
          report={report}
          onDismiss={() => {
            setReport(null);
          }}
        />
      )}
    </div>
  );
}

const REVIEW: Readonly<Record<string, string>> = labels('editor.import-review', {
  heading: 'What arrived',
  arrived: 'entries added',
  folders: 'folders added',
  renamed: 'A name was already taken, so these were renamed:',
  collided:
    'These share an id with an entry already here, which usually means one was copied from the other. Both are kept — nothing was replaced.',
  dangling: 'These name an actor this install does not have:',
  pictures: 'These arrived without their pictures, which a lorebook file names and cannot carry:',
  differences:
    'This book reads these settings differently from the one they came from, so an entry tuned there can go quiet here:',
  unsaved: 'Nothing is written until you save. Until then this is a change you can walk away from.',
  dismiss: 'Dismiss',
});

/**
 * ***§5's review step, scaled down and rendered in the entry list.***
 *
 * *"What arrived, which folder it landed in, what collided, and what now refers
 * to nothing, an `actorFilter` naming an actor this install does not have being
 * the common case."* Four claims, four sections, and each of them is omitted
 * when it has nothing to say — a review that always showed five empty headings
 * would be a form rather than a report.
 */
function ImportReview(props: { report: MergeReport; onDismiss: () => void }): JSX.Element {
  const renamed = props.report.entries.filter((one) => one.wasNamed !== undefined);
  const collided = props.report.entries.filter((one) => one.collidesWith !== undefined);

  return (
    <section
      aria-label={REVIEW['heading']}
      className="flex flex-col gap-2 rounded-control border border-line bg-surface-muted p-3 text-sm"
    >
      <div className="flex items-baseline justify-between gap-2">
        <SubsectionTitle as="h3">{REVIEW['heading']}</SubsectionTitle>
        <Button type="button" variant="quiet" onClick={props.onDismiss}>
          {REVIEW['dismiss']}
        </Button>
      </div>

      <Note>
        {`${String(props.report.entries.length)} ${REVIEW['arrived'] ?? ''}`}
        {props.report.foldersAdded.length === 0
          ? ''
          : `, ${String(props.report.foldersAdded.length)} ${REVIEW['folders'] ?? ''}`}
        {'.'}
      </Note>

      {renamed.length === 0 ? null : (
        <div>
          <Note>{REVIEW['renamed']}</Note>
          <ul className="list-inside list-disc text-ink">
            {renamed.map((one) => (
              <li key={one.entry.id}>{`${one.wasNamed ?? ''} → ${one.entry.name}`}</li>
            ))}
          </ul>
        </div>
      )}

      {collided.length === 0 ? null : (
        <div>
          <Note>{REVIEW['collided']}</Note>
          <ul className="list-inside list-disc text-ink">
            {collided.map((one) => (
              <li key={one.entry.id}>{one.entry.name}</li>
            ))}
          </ul>
        </div>
      )}

      {props.report.dangling.length === 0 ? null : (
        <div>
          <Note>{REVIEW['dangling']}</Note>
          <ul className="list-inside list-disc text-ink">
            {props.report.dangling.map((one) => (
              <li key={one.entry.id}>{`${one.entry.name} — ${one.actorIds.join(', ')}`}</li>
            ))}
          </ul>
        </div>
      )}

      {props.report.withoutPictures.length === 0 ? null : (
        <div>
          <Note>{REVIEW['pictures']}</Note>
          <ul className="list-inside list-disc text-ink">
            {props.report.withoutPictures.map((one) => (
              <li key={one.entry.id}>{one.entry.name}</li>
            ))}
          </ul>
        </div>
      )}

      {props.report.differences.length === 0 ? null : (
        <div>
          <Note>{REVIEW['differences']}</Note>
          <ul className="list-inside list-disc text-ink">
            {props.report.differences.map((one) => (
              <li key={one.field}>{`${one.field}: ${one.from} → ${one.to}`}</li>
            ))}
          </ul>
        </div>
      )}

      {/*
       * **Said here rather than only on the Save button**, because this is the
       * moment somebody is deciding whether they want what just arrived: a
       * review that reported a bad merge without saying it is still undoable
       * would be an alarm with no exit beside it.
       */}
      <Fine>{REVIEW['unsaved']}</Fine>
    </section>
  );
}
