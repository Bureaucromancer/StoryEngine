// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { useState, type JSX } from 'react';

import {
  readTranscript,
  renditionAssetUrl,
  type RenditionRecord,
  type TurnRecord,
} from '../api.js';
import { useLibrary, useRenditions, useSession, type RenditionSet } from '../queries.js';
import { Button } from '../ui/Button.js';
import { link, page } from '../ui/classes.js';
import { Note, PageTitle } from '../ui/Text.js';
import { MovePictures } from '../play/Pictures.js';
import { anchorOffset } from '../play/Rendition.js';
import { sessionLabel } from '../play/session-label.js';
import { attribution, passages, toMarkdown, toPlainText } from './prose.js';

/**
 * ***The story, readable as a story*** —
 * [10 §12](../../../../docs/design/10-ui-surfaces.md),
 * [P11.1](../../../../docs/design/workplan/28-p11-implementation.md).
 *
 * §12.1: *"the workbench answers **why did the engine do that**; the reading
 * view answers **what happened in the story**. They read the same turn records
 * and share nothing else, and neither should drift toward the other."*
 * [`fence.test.ts`](./fence.test.ts) is that sentence as a build-time
 * assertion over this directory, because *"neither should drift"* is exactly
 * the kind of intention a helpful addition two phases later violates without
 * anybody deciding to.
 *
 * ***Any node, not just the head.*** `?from=` walks to an abandoned branch or to
 * where the story stood forty turns ago — §12.1's first bullet, and the one that
 * makes this more than a print button. The route it asks is the transcript's own,
 * with one parameter, because a second walk is a second thing to keep in step.
 *
 * ***Live, not an export step.*** The same query the play surface uses, with the
 * same cache, so opening this on a session still in progress shows what has been
 * written so far rather than a snapshot somebody had to ask for.
 */
export function ReadingPage(props: { sessionId: string; from?: string }): JSX.Element {
  const session = useSession(props.sessionId);
  const actors = useLibrary('actors');
  const renditions = useRenditions(props.sessionId);
  const transcript = useQuery({
    queryKey: ['reading', props.sessionId, props.from ?? 'head'],
    queryFn: () =>
      readTranscript(props.sessionId, {
        limit: 1000,
        ...(props.from === undefined ? {} : { from: props.from }),
      }),
  });

  /**
   * ***The app's own name for an unnamed session*** (2026-09-27). An empty name
   * is a stored, ordinary state, and `?? 'Untitled'` only caught a missing one:
   * a session never named read as a blank heading, and *Copy as Markdown*
   * began with an empty title. `sessionLabel` is the one answer the play page
   * and the list already give; the loading placeholder is the play page's too.
   */
  const title = session.data === undefined ? 'Session' : sessionLabel(session.data.session.name);
  const nameOf = (actorId: string): string | null =>
    (actors.data?.objects ?? []).find((one) => one.id === actorId)?.name ?? null;
  const turns: TurnRecord[] = transcript.data?.turns ?? [];
  const read = passages(turns, nameOf);

  if (transcript.isError) {
    return (
      <main className={page.reading}>
        <p role="alert" className="text-danger-ink">
          That part of the story could not be read. The link may name a turn that is not there.
        </p>
        <BackToSession sessionId={props.sessionId} />
      </main>
    );
  }

  return (
    <main className={page.reading}>
      {/* ***One heading, for the screen and the page.*** It used to be two — a
          `SectionTitle` inside the controls row, and a second `<h1>` spelled
          `hidden text-title print:block` underneath it, because the row it sat
          in is `print:hidden` and took the title with it. Two elements holding
          one string is how they come to disagree; lifting the title out of the
          row is all it took to need only one, and it moves to the page-title
          step at the same time — this is the name of the surface, and every
          other top-level page in the client says its own name at `text-title`. */}
      <PageTitle id="reading">{title}</PageTitle>

      {/* **Hidden when printing**, which is most of what a print stylesheet is
          for: a page of controls is not part of the story, and the browser's
          own print-to-PDF is the whole of §12.2's PDF story. */}
      <div className="flex flex-wrap items-center gap-2 print:hidden">
        <BackToSession sessionId={props.sessionId} />
        <div className="ms-auto flex flex-wrap gap-2">
          <CopyButton label="Copy as Markdown" text={() => toMarkdown(read, { title })} />
          <CopyButton label="Copy as text" text={() => toPlainText(read, { title })} />
          <Button
            type="button"
            onClick={() => {
              globalThis.print();
            }}
          >
            Print
          </Button>
        </div>
      </div>

      {props.from === undefined ? null : (
        <Note>
          This is the story as it stood at one point in it, rather than the line you are on now.
        </Note>
      )}

      {transcript.isPending ? <Note>Loading…</Note> : null}

      {!transcript.isPending && read.length === 0 ? (
        <Note>Nothing has been written in this session yet.</Note>
      ) : null}

      <article className="flex flex-col gap-6 text-story font-story text-ink">
        {read.map((passage) => (
          <section key={passage.turnId} className="flex flex-col gap-2">
            {passage.said === null ? null : (
              <blockquote className="border-s-2 border-line ps-3 text-ink-muted">
                <p className="text-sm uppercase tracking-wide">{attribution(passage.said)}</p>
                {passage.said.text === '' ? null : (
                  <p className="whitespace-pre-wrap">{passage.said.text}</p>
                )}
                <MovePictures sessionId={props.sessionId} pictures={passage.said.pictures} />
              </blockquote>
            )}
            {/* ***Named lines, when the record names them*** — [P14.5]. The
                speaker's name above each message, as a script sets it; the
                pictures then fall to the end of the turn, §10.4a's rule for an
                anchor that does not resolve. */}
            {passage.lines === null
              ? null
              : passage.lines.map((line, index) => (
                  <div key={index} className="flex flex-col gap-1">
                    {line.who === null ? null : (
                      <p className="text-sm uppercase tracking-wide text-ink-muted">{line.who}</p>
                    )}
                    <p className="whitespace-pre-wrap">{line.text}</p>
                  </div>
                ))}
            {passage.lines !== null ? (
              <Illustrated
                sessionId={props.sessionId}
                turnId={passage.turnId}
                text=""
                renditions={renditions.data}
              />
            ) : passage.prose === null ? null : (
              <Illustrated
                sessionId={props.sessionId}
                turnId={passage.turnId}
                text={passage.prose}
                renditions={renditions.data}
              />
            )}
            {passage.unfinished ? <p className="text-sm text-warn-ink">{UNFINISHED}</p> : null}
          </section>
        ))}
      </article>
    </main>
  );
}

/** A whole sentence in one string, so a catalogue can hold it ([P11.8]). */
const UNFINISHED = 'This turn did not finish.';

/**
 * ***Renditions inline, where P9 produced them*** — §12.1, [06 §10.4a].
 *
 * *Inline is meant literally*: the picture renders at its anchor, the sentence
 * it is of, and falls to the end of the message when the anchor no longer
 * resolves. `anchorOffset` is the play surface's, imported rather than copied —
 * **where an anchor lands is one question and it must have one answer**, and a
 * second implementation here would be the two surfaces disagreeing about the
 * same record, which is the defect §12.1's *share nothing else* is not about.
 * That sentence is about the *machinery*, and a text offset is not machinery.
 *
 * **Illustrations only, and never the backdrop.** §12.1 is explicit, and §2.3
 * says why: this view strips chrome and a backdrop is chrome. *One picture
 * shows*, the newest or the chosen one — the reading view is prose with an
 * illustration in it, not a contact sheet, and the chooser that lets somebody
 * pick between siblings is a control and stays on the play surface.
 */
function Illustrated(props: {
  sessionId: string;
  turnId: string;
  text: string;
  renditions: RenditionSet | undefined;
}): JSX.Element {
  const all: RenditionRecord[] = [...(props.renditions?.byId.values() ?? [])].filter(
    (one) =>
      one.turnId === props.turnId &&
      one.purpose === 'illustration' &&
      (one.asset?.digest ?? '') !== '',
  );
  const chosenId = props.renditions?.selection[props.turnId];
  const shown = all.find((one) => one.id === chosenId) ?? all[all.length - 1];

  // No words is a named chat turn's pictures alone ([P14.5]): nothing to set
  // an empty paragraph for.
  if (shown === undefined) {
    return props.text === '' ? <></> : <p className="whitespace-pre-wrap">{props.text}</p>;
  }

  const picture = (
    <img
      src={renditionAssetUrl(props.sessionId, shown.id, shown.asset?.digest ?? '')}
      alt={shown.scope?.anchor ?? ''}
      /**
       * **Bounded by the measure, not stretched to it.** `w-full` set every
       * illustration to the reading column's 48rem whatever its own size, so a
       * small rendition was upscaled into a soft rectangle and a large one was
       * the only case the class was right for. `max-w-full` keeps the ceiling
       * and drops the floor; `mx-auto` centres what comes in narrower.
       */
      className="mx-auto h-auto max-w-full rounded-panel"
    />
  );

  if (props.text === '') return picture;
  const at = anchorOffset(props.text, shown.scope?.anchor);
  if (at === null) {
    return (
      <>
        <p className="whitespace-pre-wrap">{props.text}</p>
        {picture}
      </>
    );
  }
  return (
    <>
      <p className="whitespace-pre-wrap">{props.text.slice(0, at)}</p>
      {picture}
      <p className="whitespace-pre-wrap">{props.text.slice(at)}</p>
    </>
  );
}

/**
 * ***Copy, with the failure said out loud.***
 *
 * `navigator.clipboard` needs a secure context, which a LAN install served over
 * plain HTTP does not have — the caveat `docs/deploy.md` already carries a table
 * about. So this reports rather than silently doing nothing, which is what an
 * unchecked `void writeText()` would do on exactly the deployment this project
 * is for.
 */
/**
 * ***The way back*** (2026-10-01). The reading view is opened from a story's
 * session panel, and offered no way back to it: the header's Play goes to the
 * list of sessions, so returning to *this* story meant the browser's Back, or
 * finding it again in the list — and a reading view opened from a pasted link
 * had no Back at all. Compare had the same need and already answers it this
 * way, so this is that link, in the same words.
 *
 * In the controls row, so printing drops it with them; and under the failure
 * too, where a link naming a turn that is not there leaves a person most in
 * need of somewhere to go.
 */
function BackToSession(props: { sessionId: string }): JSX.Element {
  return (
    <Link to="/play/$sessionId" params={{ sessionId: props.sessionId }} className={link.back}>
      Back to the session
    </Link>
  );
}

function CopyButton(props: { label: string; text: () => string }): JSX.Element {
  const [said, setSaid] = useState<string | null>(null);
  return (
    <span className="flex items-center gap-2">
      <Button
        type="button"
        onClick={() => {
          /**
           * **Read off `navigator` rather than assumed**, because the types say
           * it is always there and a browser on a plain-HTTP LAN install says
           * otherwise: `clipboard` is a secure-context API, and this project's
           * own `docs/deploy.md` carries a table about exactly that deployment.
           * An optional chain would typecheck and still throw.
           */
          const clipboard = navigator.clipboard as Clipboard | undefined;
          if (clipboard === undefined) {
            setSaid(NO_CLIPBOARD);
            return;
          }
          void clipboard
            .writeText(props.text())
            .then(() => {
              setSaid('Copied.');
            })
            .catch(() => {
              setSaid(NO_CLIPBOARD);
            });
        }}
      >
        {props.label}
      </Button>
      {said === null ? null : (
        <span role="status" className="text-sm text-ink-subtle">
          {said}
        </span>
      )}
    </span>
  );
}

const NO_CLIPBOARD = 'This browser would not copy. Select the text and copy it yourself.';
