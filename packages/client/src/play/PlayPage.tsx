// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { useEffect, useState } from 'react';
import { control, page } from '../ui/classes.js';
import { useMutation, useQueryClient } from '@tanstack/react-query';

import { uuidv7 } from '@storyengine/shared';

import {
  cancelTurn,
  createBranchRef,
  moveHead,
  submitTurn,
  undoTurn,
  type TurnRecord,
} from '../api.js';
import {
  liveKey,
  previewKey,
  useAuthState,
  usePreview,
  useRefreshPreview,
  useSession,
  useTranscript,
} from '../queries.js';
import { AlertNote } from '../ui/Alert.js';
import { Button } from '../ui/Button.js';
import { ContextMeter } from './ContextMeter.js';
import { GuidanceBox } from './GuidanceBox.js';
import { ChannelHealth } from './ChannelHealth.js';
import { ChannelHud } from './ChannelHud.js';
import { CastPanel } from './CastPanel.js';
import { LorePanel } from './LorePanel.js';
import { RenameSession } from './RenameSession.js';
import { sessionLabel } from './session-label.js';
import { useDebouncedInput } from './useDebouncedInput.js';
import { useTurnStream } from './useTurnStream.js';

/**
 * How long a pause has to be before the meter asks — [P3.4].
 *
 * Long enough that a burst of typing is one question and not thirty (each
 * costs the server a read of every segment in the session), short enough that
 * the answer is there by the time somebody looks up from the sentence they
 * just finished.
 */
const PREVIEW_DEBOUNCE_MS = 400;

/**
 * The play surface — a deliberately thin chat view
 * ([P2 §3](../../../../docs/design/workplan/08-p2-implementation.md)).
 *
 * Message list, input, streaming render, reattach on reload, the collapsed
 * guidance box — and, since [P6.2], the two gestures on every turn. What is
 * *not* here is still the point: no impersonation, no axis controls, no block
 * table, and no sibling affordance yet — that is P6.3's, and until it lands the
 * way back to a replaced attempt is *continue from here* on the turn before it.
 * Each has an owning phase, and a chat view is exactly the surface that invites
 * building the workbench by accident.
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
  const auth = useAuthState();
  const locale = auth.data?.account?.locale ?? undefined;

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
      // persist ([06 §5.1]).
      setGuidance('');
      // **The record supersedes the preview** ([P3.4]). Cleared rather than
      // left to be refreshed, so the panel returns to the head at once
      // instead of showing a preview of a turn that is already running — and
      // when this one commits, the head *is* it, with its real block table.
      //
      // `reset`, not `remove`, and the browser walk is what found the
      // difference: removing a query that still has observers destroys the
      // entry without notifying them, so the meter and the panel went on
      // rendering the value they had last been handed. Resetting notifies.
      void queryClient.resetQueries({ queryKey: previewKey(sessionId) });
    },
  });

  /**
   * Redo — another attempt at a turn, as a sibling of it — [07 §7], [P6.2].
   *
   * The words are the turn's own rather than the composer's: this is *that turn
   * again*, and taking what is in the box would silently make it a different
   * one. `parentTurnId` is sent explicitly, and `null` for the first turn of a
   * session is a real value rather than an omission — absent would mean *the
   * head*, which is the thing this gesture is not.
   *
   * **§1.8, decided and written where a person can find it:** the view follows
   * the new sibling. When this commits the head is the new turn, so the
   * transcript below re-renders as the line it is now on, and the attempt it
   * replaced is still on disk — reachable by moving the head back to it, and by
   * P6.3's inline sibling affordance when that lands. Marinara's rule was
   * *editing does not change the reply already on screen*, and the reason to
   * depart from it is that the protection it offered — not losing the thing you
   * were reading — is what the sibling affordance provides visibly, which
   * Marinara did not have. This is a lean pending PLAYABLE, and [P6 §1.8] is
   * where it is argued.
   *
   * **A redo may carry an instruction, and then it carries the attempt too**
   * ([06 §5.1], [07 §7]). `guidance` and `redoOf` travel together or not at
   * all: an instruction with nothing to refer to and an attempt with no
   * instruction are each a different feature from *this again, but change
   * X*. With neither, the body is exactly what it was before the field
   * existed — a plain redo stays *same setup, different words* ([19 §14.6]),
   * and the model is not shown a reply it might then avoid or copy.
   */
  const redo = useMutation({
    mutationFn: ({
      turn,
      rewrite,
      guidance,
    }: {
      turn: TurnRecord;
      rewrite: boolean;
      guidance?: string;
    }) =>
      submitTurn({
        sessionId,
        idempotencyKey: uuidv7(),
        headTurnId: session.data?.session.headTurnId ?? null,
        text: turn.input?.text ?? '',
        parentTurnId: turn.parentTurnId,
        ...(rewrite ? { rewriteOf: turn.id } : {}),
        ...(guidance === undefined ? {} : { guidance, redoOf: turn.id }),
      }),
    onSuccess: (accepted) => {
      dispatch({ kind: 'submitted', jobId: accepted.jobId });
      // The composer is left alone: this gesture did not use what is in it, so
      // clearing it would throw away something somebody typed.
      void queryClient.resetQueries({ queryKey: previewKey(sessionId) });
    },
  });

  /**
   * Continue differently — a new turn *after* this one — [07 §7], [P6.2].
   *
   * Moving the head is the whole of it: the composer writes a child of
   * wherever the head is, so pointing at an old message and then typing is
   * exactly *continue from here*. Nothing is submitted, and no turn moves.
   */
  /**
   * Stepping to a sibling — [§1.2].
   *
   * `resume: true`, so coming back to a line returns to where you were on it
   * rather than to its first turn ([07 §3]).
   */
  const goToSibling = useMutation({
    mutationFn: (turnId: string) => moveHead(sessionId, turnId, true),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['session', sessionId] });
      void queryClient.invalidateQueries({ queryKey: ['transcript', sessionId] });
      void queryClient.resetQueries({ queryKey: previewKey(sessionId) });
    },
  });

  const continueFrom = useMutation({
    mutationFn: (turn: TurnRecord) => moveHead(sessionId, turn.id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['session', sessionId] });
      void queryClient.invalidateQueries({ queryKey: ['transcript', sessionId] });
      void queryClient.resetQueries({ queryKey: previewKey(sessionId) });
    },
  });

  /**
   * Undo, and naming a line — [§1.4], [§1.2], [P6.3].
   *
   * Both refresh the same two entries a head move does, because both change
   * what the session file says: undo appends a turn and advances the head, and
   * a name is a write to `branchRefs`.
   */
  const refreshSession = () => {
    void queryClient.invalidateQueries({ queryKey: ['session', sessionId] });
    void queryClient.invalidateQueries({ queryKey: ['transcript', sessionId] });
    void queryClient.resetQueries({ queryKey: previewKey(sessionId) });
  };

  const undo = useMutation({
    mutationFn: (turn: TurnRecord) => undoTurn(sessionId, turn.id),
    onSuccess: refreshSession,
  });

  const name = useMutation({
    mutationFn: (named: { turnId: string; name: string }) =>
      createBranchRef(sessionId, named.name, named.turnId),
    onSuccess: refreshSession,
  });

  /**
   * The most recent failure among this page's controls — [P6B.0].
   *
   * `submittedAt` rather than declaration order, because the one worth showing
   * is the one that just happened: an undo that failed ten minutes ago must not
   * outrank the send that failed a second ago. A mutation clears its own error
   * on its next attempt, so this empties by being used.
   */
  const failure = [send, redo, continueFrom, undo, name, goToSibling]
    .filter((one) => one.isError)
    .sort((a, b) => b.submittedAt - a.submittedAt)[0]?.error;

  /**
   * The meter's question, asked on every pause — [P3.4].
   *
   * `running` is in the dependencies rather than only in the guard, so the
   * turn *finishing* re-previews against the new head without a second effect
   * to keep in step with this one. Nothing is asked while a turn is in
   * flight: the input is disabled, the head is moving, and the entry was
   * dropped at submit.
   */
  const settled = useDebouncedInput(draft, guidance, PREVIEW_DEBOUNCE_MS);
  const refresh = useRefreshPreview(sessionId);
  const refreshPreview = refresh.mutate;
  const preview = usePreview(sessionId);

  useEffect(() => {
    if (running) return;
    /**
     * **Only ever ask about text the composer still holds.**
     *
     * The settled value lags the box by a debounce, and submitting empties
     * the box at once — so a turn that finishes inside that beat would
     * otherwise have this fire with the text just *sent*, and the panel would
     * offer "what would be sent if this turn were taken now" for a turn
     * already taken. Comparing against the live draft is the invariant that
     * says it plainly; the settled value catches up a beat later and the
     * at-rest reading is asked for then.
     */
    if (settled.text !== draft || settled.guidance !== guidance) return;
    refreshPreview(settled);
  }, [settled, draft, guidance, running, refreshPreview]);

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

  /**
   * The turn being taken, mirrored where the panel can read it — [P3.5].
   *
   * The dock is this page's sibling in the shell, so the cache is the only
   * thing they share; this is the same bridge the meter's preview uses, in the
   * same direction. **Written from the reducer rather than fetched**, because
   * the frames arrive here and nowhere else, and `useLiveTurn` is a reader
   * that provably cannot ask.
   *
   * Cleared on unmount: a turn's progress is not a fact about a session
   * somebody has stopped watching, and leaving it would have the panel
   * announce a turn as running to a reader who has navigated away from the
   * stream that would have told them it finished.
   */
  useEffect(() => {
    queryClient.setQueryData(liveKey(sessionId), { live: state.live });
  }, [state.live, sessionId, queryClient]);

  useEffect(() => {
    return () => {
      void queryClient.resetQueries({ queryKey: liveKey(sessionId) });
    };
  }, [sessionId, queryClient]);

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
    // use ([10 §1.2]).
    <div className={`${page.reading} flex h-full flex-col gap-4`}>
      <div className="flex items-center gap-2">
        {/*
          Two cases kept apart on purpose. `?? 'Session'` used to cover both and
          only caught `undefined`, so an empty name went straight through it and
          the heading rendered blank — and collapsing them the other way would
          have the not-yet-loaded frame assert the session is untitled when
          nobody yet knows whether it is.
        */}
        <h1 className="text-section text-ink">
          {session.data === undefined ? 'Session' : sessionLabel(session.data.session.name)}
        </h1>
        {session.data === undefined ? null : (
          <RenameSession sessionId={sessionId} name={session.data.session.name} />
        )}
      </div>

      {/* **Above the lore panel and above the transcript** — [06 §4.2], [P7.1].
          A persistent banner on the session, not a modal and not a log line: it
          is a fact about the whole session, it renders nothing when there is
          nothing wrong, and it must not be somewhere a person has to open a
          disclosure to find. */}
      <ChannelHealth sessionId={sessionId} />

      {/* **What the session's channels say, declared by whoever owns them** —
          [10 §8], [P7.1]. Above the transcript because it is state rather than
          narration, and below the health banner because a channel that could not
          be loaded is the more urgent sentence. Renders nothing when no declared
          channel has a surface. */}
      <ChannelHud sessionId={sessionId} />

      {/* **Who is in the story, and what the software thinks is true of them** —
          [10 §13.2], [P7.2]. Below the HUD because a cast is a list and the HUD
          is a line, and above the transcript for the reason both are: state
          rather than narration. Renders nothing for a session with no cast. */}
      <CastPanel sessionId={sessionId} />

      {/* What this session retrieves from — [P6B.0]. Above the transcript and
          closed by default: it is a fact about the session rather than about
          any turn, and the story column is the surface. */}
      <LorePanel sessionId={sessionId} />

      <ol className="flex flex-1 flex-col gap-4 overflow-y-auto" aria-label="Transcript">
        {(transcript.data?.turns ?? []).map((turn) => (
          <TurnView
            key={turn.id}
            turn={turn}
            siblings={transcript.data?.siblings?.[turn.id] ?? []}
            busy={
              running ||
              redo.isPending ||
              continueFrom.isPending ||
              undo.isPending ||
              name.isPending
            }
            onRedo={(subject, rewrite, guidance) => {
              // Spread, not passed: `exactOptionalPropertyTypes` refuses an
              // explicit `undefined` where the field may simply be absent.
              redo.mutate({
                turn: subject,
                rewrite,
                ...(guidance === undefined ? {} : { guidance }),
              });
            }}
            onContinueFrom={(subject) => {
              continueFrom.mutate(subject);
            }}
            onUndo={(subject) => {
              undo.mutate(subject);
            }}
            onGoToSibling={(turnId) => {
              goToSibling.mutate(turnId);
            }}
            onName={(turnId, given) => {
              name.mutate({ turnId, name: given });
            }}
          />
        ))}

        {/* The turn being written. A live region, because its text arrives
            without the reader doing anything — the accessible-markup habit
            [work plan §2.1] calls day-one, applied where it actually matters. */}
        {state.text.length > 0 && running ? (
          <li aria-live="polite" aria-busy="true">
            <p className="whitespace-pre-wrap text-story text-ink">{state.text}</p>
          </li>
        ) : null}
      </ol>

      <StreamStatus status={state.status} error={state.error} />

      {/* **A refused action says so** — [P6B.0].
       *
       * Every mutation on this page could fail and none of them said anything:
       * a `409 busy`, a `412 stale-head` from a second tab, an unbound role, an
       * expired session. The reducer has classified stream failures into
       * `state.error` since P2 and nothing read it, and the submit path had no
       * error branch at all — so the only feedback a person ever got was a turn
       * that did not appear.
       *
       * The most recent failure rather than all of them: these are one row of
       * controls over one session, a person takes one action at a time, and a
       * stack of stale messages from earlier attempts is its own confusion.
       * Each clears when its own control is used again. */}
      {failure === undefined ? null : <AlertNote role="alert">{failure.message}</AlertNote>}

      <form
        className="flex flex-col gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          if (draft.trim().length > 0) send.mutate();
        }}
      >
        {/* Above the input rather than beside Send: a fill reads as a fill
            only when it is wide, and the input row is already tight with its
            button at the narrowest width the phase supports. */}
        <ContextMeter
          preview={preview.data?.preview}
          busy={running || refresh.isPending}
          locale={locale}
        />
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

/**
 * One turn, with the two gestures on it — [07 §7], [P6.2].
 *
 * **On the turn, not on the message.** Under `per-actor` dispatch one turn is
 * several messages, and [07 §7] resolves branching inside a multi-message turn
 * to that turn's *node* — which is C11, closed precisely to stop *message*
 * becoming the unit people reach for.
 *
 * **Two gestures, offered explicitly, because guessing is wrong half the time.**
 * *Redo* is another attempt at this turn: a sibling, same parent, same words.
 * *Continue from here* is a new turn after it: it moves the head to this node,
 * and the composer below then writes its child. Those are the two things a
 * person can mean by pointing at an old message, and the design's argument for
 * two buttons is that a server picking between them is wrong about half the
 * time.
 *
 * **Redo splits into rewrite and reroll where draws exist** ([19 §14.5]).
 * *Redo* rewrites: the draws come off this turn's tape, so the mechanical
 * outcome holds and only the prose changes. *Reroll* is the explicit second
 * action that rolls again — and it **only appears when the turn consumed
 * draws**, which is [19 §14.6]'s rule and the reason it is absent from most
 * turns: an ordinary turn against an ordinary book draws nothing, and a button
 * offering to re-roll nothing would be a button that lies.
 *
 * Rewrite is the default of the two because the other way round makes swiping
 * past a failed check save-scumming by accident.
 *
 * **Either gesture may carry an instruction** ([06 §5.1], [07 §7]). *Redo with
 * guidance* reveals a field under the turn; what is typed there rides with
 * whichever of the two buttons is pressed next, together with this turn's own
 * words as the attempt the instruction is about. It modifies the gesture
 * rather than being a third one — "not that sentence" and "not that outcome"
 * stay different requests, each now sayable with a reason — and with the
 * field empty or closed the body is exactly the plain gesture's. The field is
 * one-shot like the composer's box, and closing it forgets it, so a note typed
 * and then hidden cannot ride along with a later plain Redo.
 */
function TurnView({
  turn,
  siblings,
  busy,
  onRedo,
  onContinueFrom,
  onUndo,
  onGoToSibling,
  onName,
}: {
  turn: TurnRecord;
  siblings: string[];
  busy: boolean;
  onRedo: (turn: TurnRecord, rewrite: boolean, guidance?: string) => void;
  onContinueFrom: (turn: TurnRecord) => void;
  onUndo: (turn: TurnRecord) => void;
  onGoToSibling: (turnId: string) => void;
  onName: (turnId: string, name: string) => void;
}): React.JSX.Element {
  // A turn with no input is not one a person wrote — a divergence turn from a
  // hand edit ([03 §8.1]) is the one that exists today — so there is nothing to
  // attempt again.
  const rerunnable = turn.input !== undefined;
  const rolled = turn.tape.length > 0;

  // The instruction for a guided redo, and whether its field is open. Local to
  // the turn: it is about *this* attempt, and it is forgotten the moment a
  // gesture spends it or the field closes.
  const [guiding, setGuiding] = useState(false);
  const [note, setNote] = useState('');

  const redoWith = (rewrite: boolean): void => {
    const trimmed = note.trim();
    onRedo(turn, rewrite, guiding && trimmed.length > 0 ? trimmed : undefined);
    // Optimistic, as the naming form below is: the gesture has been asked for,
    // and a field still holding the note would offer to send it twice. The
    // note goes with the field — the toggle clears it again on the way back
    // in, so this is the state staying honest rather than a second guard.
    setGuiding(false);
    setNote('');
  };

  return (
    <li className="group/turn flex flex-col gap-1">
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

      {/* Visible on hover and on focus. Focus is not decoration here: these are
          the only controls in the transcript, and a keyboard reaching them
          would otherwise tab into things it cannot see. */}
      <div className="flex gap-2 opacity-0 transition-opacity group-focus-within/turn:opacity-100 group-hover/turn:opacity-100">
        {rerunnable ? (
          <Button
            type="button"
            disabled={busy}
            onClick={() => {
              redoWith(true);
            }}
          >
            Redo
          </Button>
        ) : null}
        {rerunnable && rolled ? (
          <Button
            type="button"
            disabled={busy}
            onClick={() => {
              redoWith(false);
            }}
          >
            Reroll
          </Button>
        ) : null}
        {rerunnable ? (
          <Button
            type="button"
            disabled={busy}
            aria-expanded={guiding}
            onClick={() => {
              // Closing forgets the note. A hidden field still holding one
              // would turn the next plain Redo into a guided one nobody asked
              // for.
              setGuiding(!guiding);
              setNote('');
            }}
          >
            Redo with guidance
          </Button>
        ) : null}
        <Button
          type="button"
          disabled={busy}
          onClick={() => {
            onContinueFrom(turn);
          }}
        >
          Continue from here
        </Button>
        {/* Undo is offered on every turn and refused by the server when
            something has written the same channels since — the refusal is the
            feature ([§1.4]), and hiding the button would make the rule
            invisible instead of explaining it. */}
        <Button
          type="button"
          disabled={busy}
          onClick={() => {
            onUndo(turn);
          }}
        >
          Undo
        </Button>
      </div>

      {/* Outside the row above, which fades unless hovered or focused: a field
          that vanished when the pointer left it would be a field nobody could
          read back. The <li> is the group, so focus in here keeps the two
          buttons visible while the note is typed. Enter is the default
          gesture, rewrite, as the form's only submit — the buttons stay the
          buttons. */}
      {guiding ? (
        <form
          className="flex items-center gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            redoWith(true);
          }}
        >
          <label className="flex-1">
            <span className="sr-only">What should change?</span>
            <input
              className={control}
              value={note}
              disabled={busy}
              autoFocus
              placeholder="What should change?"
              onChange={(event) => {
                setNote(event.target.value);
              }}
            />
          </label>
        </form>
      ) : null}

      <SiblingStrip
        turn={turn}
        siblings={siblings}
        busy={busy}
        onGo={onGoToSibling}
        onName={onName}
      />
    </li>
  );
}

/**
 * The inline affordance on a node that has siblings — [§1.2], [07 §6], [P6.3].
 *
 * **History shows the selected path only**, so this is the whole of how an
 * alternative is reachable: a count, a way to step between them, and a way to
 * give one a name. The full tree visualiser is post-1.0 ([24 §1]) and this is
 * deliberately not a small version of it — it answers *there are others* and
 * *take me to one*, which is what a person swiping needs.
 *
 * **Stepping resumes rather than lands.** Moving to a sibling follows what was
 * last selected below it, so coming back to a line you explored returns to
 * where you were on it instead of to its first turn.
 */
function SiblingStrip({
  turn,
  siblings,
  busy,
  onGo,
  onName,
}: {
  turn: TurnRecord;
  siblings: string[];
  busy: boolean;
  onGo: (turnId: string) => void;
  onName: (turnId: string, name: string) => void;
}): React.JSX.Element | null {
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState('');

  const at = siblings.indexOf(turn.id);
  if (siblings.length < 2 || at < 0) return null;

  const previous = siblings[at - 1];
  const next = siblings[at + 1];

  return (
    <div className="flex items-center gap-2 text-sm text-ink-subtle">
      <Button
        type="button"
        disabled={busy || previous === undefined}
        onClick={() => {
          if (previous !== undefined) onGo(previous);
        }}
        aria-label="Previous version"
      >
        ‹
      </Button>
      {/* A count, not a list: which of these you are on is the fact, and the
          others are addressed by stepping rather than by being enumerated. */}
      <span aria-live="polite">{`${String(at + 1)} of ${String(siblings.length)}`}</span>
      <Button
        type="button"
        disabled={busy || next === undefined}
        onClick={() => {
          if (next !== undefined) onGo(next);
        }}
        aria-label="Next version"
      >
        ›
      </Button>

      {naming ? (
        <form
          className="flex items-center gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            if (name.trim().length === 0) return;
            onName(turn.id, name.trim());
            setNaming(false);
            setName('');
          }}
        >
          <label>
            <span className="sr-only">Name for this line</span>
            <input
              className={control}
              value={name}
              placeholder="Name this line"
              onChange={(event) => {
                setName(event.target.value);
              }}
            />
          </label>
          <Button type="submit" variant="primary">
            Save
          </Button>
        </form>
      ) : (
        // Promoting a swipe writes a name and moves no data ([07 §6]), which is
        // why this sits beside the count rather than behind a confirmation.
        <Button
          type="button"
          disabled={busy}
          onClick={() => {
            setNaming(true);
          }}
        >
          Name this line
        </Button>
      )}
    </div>
  );
}

/**
 * What the stream is doing, in words rather than only a spinner.
 *
 * `reconnecting` is a real state with its own sentence, because [19 §11] asks
 * for *a quiet reconnecting state that resumes rather than erroring out* — and
 * a client that showed an error there would be wrong, since the cursor makes
 * the resume lossless.
 */
/**
 * What a failed stream says — and since [P6B.0], *which* failure.
 *
 * The reducer classifies every error frame (`classOf`) and the class was going
 * nowhere: a turn that failed because a role was unbound and one that failed
 * because the server restarted produced the same sentence. The class is the
 * first thing a bug report needs and the first thing a person can act on.
 */
function streamFailureLine(error: string | null): string {
  if (error === null) return 'The connection failed. Reload to try again.';
  return `The turn failed (${error}). Reload to try again.`;
}

function StreamStatus({
  status,
  error,
}: {
  status: string;
  error: string | null;
}): React.JSX.Element | null {
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
        {streamFailureLine(error)}
      </p>
    );
  }
  return null;
}
