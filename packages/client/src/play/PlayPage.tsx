// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { uuidv7 } from '@storyengine/shared';

import { cancelTurn, readSession, readTranscript, submitTurn, type TurnRecord } from '../api.js';
import { GuidanceBox } from './GuidanceBox.js';
import { TurnRecordDisclosure } from './TurnRecord.js';
import { useTurnStream } from './useTurnStream.js';

/**
 * The play surface — a deliberately thin chat view
 * ([P2 §3](../../../../docs/design/workplan/04-p2-implementation.md)).
 *
 * Message list, input, streaming render, reattach on reload, the collapsed
 * guidance box, and a raw record affordance. What is *not* here is the point:
 * no impersonation, no axis controls, no block table, no branching. Each has an
 * owning phase, and a chat view is exactly the surface that invites building the
 * workbench by accident.
 */
export function PlayPage({ sessionId }: { sessionId: string }): React.JSX.Element {
  const queryClient = useQueryClient();
  const { state, dispatch } = useTurnStream(sessionId);
  const [draft, setDraft] = useState('');
  const [guidance, setGuidance] = useState('');

  const session = useQuery({
    queryKey: ['session', sessionId],
    queryFn: () => readSession(sessionId),
  });
  const transcript = useQuery({
    queryKey: ['transcript', sessionId],
    queryFn: () => readTranscript(sessionId),
  });

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
    <main className="mx-auto flex h-full max-w-3xl flex-col gap-4 p-4">
      <h1 className="text-lg">{session.data?.session.name ?? 'Session'}</h1>

      <ol className="flex flex-1 flex-col gap-4 overflow-y-auto" aria-label="Transcript">
        {(transcript.data?.turns ?? []).map((turn) => (
          <TurnView key={turn.id} turn={turn} />
        ))}

        {/* The turn being written. A live region, because its text arrives
            without the reader doing anything — the accessible-markup habit
            [01 §2.1] calls day-one, applied where it actually matters. */}
        {state.text.length > 0 && running ? (
          <li aria-live="polite" aria-busy="true">
            <p className="whitespace-pre-wrap">{state.text}</p>
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
              className="w-full rounded border border-slate-300 bg-white p-2 text-slate-900 placeholder:text-slate-500 focus-visible:outline-2 focus-visible:outline-slate-500"
              value={draft}
              disabled={running}
              placeholder="What do you do?"
              onChange={(event) => {
                setDraft(event.target.value);
              }}
            />
          </label>
          {running && state.jobId !== null ? (
            <button
              type="button"
              className="rounded border border-neutral-700 px-3"
              onClick={() => {
                void cancelTurn(sessionId, state.jobId ?? '');
              }}
            >
              Stop
            </button>
          ) : (
            <button type="submit" className="rounded border border-neutral-700 px-3">
              Send
            </button>
          )}
        </div>
        <GuidanceBox value={guidance} onChange={setGuidance} disabled={running} />
      </form>
    </main>
  );
}

function TurnView({ turn }: { turn: TurnRecord }): React.JSX.Element {
  return (
    <li className="flex flex-col gap-1">
      {turn.input === undefined ? null : <p className="text-neutral-400">{turn.input.text}</p>}
      {turn.output === undefined ? null : <p className="whitespace-pre-wrap">{turn.output.text}</p>}
      {/* A failed turn is shown rather than hidden: it is on the record with
          what it managed, and hiding it would make a re-run unexplainable. */}
      {turn.status === 'failed' ? (
        <p className="text-sm text-amber-400">This turn did not finish.</p>
      ) : null}
      <TurnRecordDisclosure turn={turn} />
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
      <p role="status" className="text-sm text-neutral-400">
        Reconnecting…
      </p>
    );
  }
  if (status === 'failed') {
    return (
      <p role="alert" className="text-sm text-amber-400">
        The connection failed. Reload to try again.
      </p>
    );
  }
  return null;
}
