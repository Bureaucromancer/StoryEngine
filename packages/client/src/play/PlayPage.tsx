// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { useEffect, useState } from 'react';
import { control, page } from '../ui/classes.js';
import { useMutation, useQueryClient } from '@tanstack/react-query';

import { uuidv7 } from '@storyengine/shared';

import { cancelTurn, submitTurn, type TurnRecord } from '../api.js';
import { useSession, useTranscript } from '../queries.js';
import { Button } from '../ui/Button.js';
import { GuidanceBox } from './GuidanceBox.js';
import { useTurnStream } from './useTurnStream.js';

/**
 * The play surface — a deliberately thin chat view
 * ([P2 §3](../../../../docs/design/workplan/04-p2-implementation.md)).
 *
 * Message list, input, streaming render, reattach on reload, and the collapsed
 * guidance box. What is *not* here is the point: no impersonation, no axis
 * controls, no block table, no branching. Each has an owning phase, and a chat
 * view is exactly the surface that invites building the workbench by accident.
 * The record itself is the workbench's to show since [P3.2] — the raw
 * disclosure this page carried through P2 is gone with it.
 */
export function PlayPage({ sessionId }: { sessionId: string }): React.JSX.Element {
  const queryClient = useQueryClient();
  const { state, dispatch } = useTurnStream(sessionId);
  const [draft, setDraft] = useState('');
  const [guidance, setGuidance] = useState('');

  // Shared with the workbench through `queries.ts`, so both mounts read one
  // cache entry and the invalidate below refreshes both ([P3.1]).
  const session = useSession(sessionId);
  const transcript = useTranscript(sessionId);

  const running = state.status === 'running';

  const send = useMutation({
    mutationFn: () =>
      submitTurn({
        sessionId,
        // A key the client owns, so a retry of *this* submission is recognised
        // as the same one rather than starting a second turn ([P2 §2.10]).
        // `uuidv7` rather than `crypto.randomUUID`: the repo has one id
        // generator and the randomness rule points every other draw at the RNG
        // service, so a bare `randomUUID` here would need a fourth exemption to
        // say what `ids.ts` already says.
        idempotencyKey: uuidv7(),
        headTurnId: session.data?.session.headTurnId ?? null,
        text: draft,
        guidance,
      }),
    onSuccess: (accepted) => {
      dispatch({ kind: 'submitted', jobId: accepted.jobId });
      setDraft('');
      // One-shot: guidance applies to the turn it was written for and does not
      // persist ([03 §5.1]).
      setGuidance('');
    },
  });

  /**
   * The stream's closing frame is what says the record is durable in all three
   * places, so the transcript refetches then rather than on a timer.
   *
   * **In an effect, and keyed on the transition rather than on the state.** This
   * ran in the render body, guarded by `!transcript.isFetching` — which is not a
   * guard but a metronome. The invalidate starts a refetch, `isFetching` goes
   * true and blocks the next render, the refetch lands, `isFetching` goes false,
   * the render that delivers the new data passes the guard again, and it
   * invalidates again. Nothing ever leaves `'finished'`, so there is no exit:
   * two requests every few milliseconds for as long as the page is open,
   * measured at six in twelve milliseconds against a real server.
   *
   * It also guarded on the transcript's fetch state while invalidating the
   * session too, so half of it was unguarded even in intent.
   *
   * Keying on `state.status` is enough because the only way back to
   * `'finished'` is through `'running'` — `submitted` sets it, so a second turn
   * is a second transition and fires this again. `queryClient` is stable for the
   * provider's lifetime and is listed because the rule cannot know that.
   */
  useEffect(() => {
    if (state.status !== 'finished') return;
    void queryClient.invalidateQueries({ queryKey: ['transcript', sessionId] });
    void queryClient.invalidateQueries({ queryKey: ['session', sessionId] });
  }, [state.status, sessionId, queryClient]);

  return (
    // A `div`, not a landmark: the shell owns the routed app's one `<main>`
    // ([P3.−1]) — this page nesting a second one inside it was the audit's
    // finding, and the page's job is its content, not the document's regions.
    //
    // `h-full` resolves now, and that is the whole fix: this column is the
    // scroll container's direct child, and the shell's `<main>` has a definite
    // height for the percentage to resolve against — where the old parent had
    // none, which is why the transcript's `overflow-y-auto` had never once
    // triggered. The column is `page.reading`, not the tooling width: this is
    // the story surface, and the reading measure is the token's one designed
    // use ([05 §1.2]).
    <div className={`${page.reading} flex h-full flex-col gap-4`}>
      <h1 className="text-section text-ink">{session.data?.session.name ?? 'Session'}</h1>

      <ol className="flex flex-1 flex-col gap-4 overflow-y-auto" aria-label="Transcript">
        {(transcript.data?.turns ?? []).map((turn) => (
          <TurnView key={turn.id} turn={turn} />
        ))}

        {/* The turn being written. A live region, because its text arrives
            without the reader doing anything — the accessible-markup habit
            [01 §2.1] calls day-one, applied where it actually matters. */}
        {state.text.length > 0 && running ? (
          <li aria-live="polite" aria-busy="true">
            <p className="whitespace-pre-wrap text-story text-ink">{state.text}</p>
          </li>
        ) : null}
      </ol>

      <StreamStatus status={state.status} />

      <form
        className="flex flex-col gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          if (draft.trim().length > 0) send.mutate();
        }}
      >
        <div className="flex gap-2">
          <label className="flex-1">
            <span className="sr-only">What do you do?</span>
            <input
              className={control}
              value={draft}
              disabled={running}
              placeholder="What do you do?"
              onChange={(event) => {
                setDraft(event.target.value);
              }}
            />
          </label>
          {running && state.jobId !== null ? (
            <Button
              type="button"
              onClick={() => {
                void cancelTurn(sessionId, state.jobId ?? '');
              }}
            >
              Stop
            </Button>
          ) : (
            <Button type="submit" variant="primary">
              Send
            </Button>
          )}
        </div>
        <GuidanceBox value={guidance} onChange={setGuidance} disabled={running} />
      </form>
    </div>
  );
}

function TurnView({ turn }: { turn: TurnRecord }): React.JSX.Element {
  return (
    <li className="flex flex-col gap-1">
      {turn.input === undefined ? null : (
        <p className="text-story text-ink-subtle">{turn.input.text}</p>
      )}
      {turn.output === undefined ? null : (
        <p className="whitespace-pre-wrap text-story text-ink">{turn.output.text}</p>
      )}
      {/* A failed turn is shown rather than hidden: it is on the record with
          what it managed, and hiding it would make a re-run unexplainable. */}
      {turn.status === 'failed' ? (
        <p className="text-sm text-warn-ink">This turn did not finish.</p>
      ) : null}
    </li>
  );
}

/**
 * What the stream is doing, in words rather than only a spinner.
 *
 * `reconnecting` is a real state with its own sentence, because [07 §11] asks
 * for *a quiet reconnecting state that resumes rather than erroring out* — and
 * a client that showed an error there would be wrong, since the cursor makes
 * the resume lossless.
 */
function StreamStatus({ status }: { status: string }): React.JSX.Element | null {
  if (status === 'reconnecting') {
    return (
      <p role="status" className="text-sm text-ink-subtle">
        Reconnecting…
      </p>
    );
  }
  if (status === 'failed') {
    return (
      <p role="alert" className="text-sm text-warn-ink">
        The connection failed. Reload to try again.
      </p>
    );
  }
  return null;
}
