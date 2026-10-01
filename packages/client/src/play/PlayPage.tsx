// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { control, page, reveal } from '../ui/classes.js';
import { useMutation, useQueryClient } from '@tanstack/react-query';

import { outputMessagesOf, remedyFor, uuidv7 } from '@storyengine/shared';
import type { StepFailureReason, TextSpan } from '@storyengine/shared';

import {
  ApiError,
  cancelTurn,
  createBranchRef,
  impersonateAs,
  moveHead,
  type Abandoned,
  type CastRow,
  submitTurn,
  undoTurn,
  uploadPicture,
  type ModeSurface,
  type RenditionRecord,
  type ChatSettings,
  type LibraryObject,
  type SubmitTurn,
  type SwipeGroups,
  type TurnRecord,
} from '../api.js';
import {
  liveKey,
  previewKey,
  renditionsKey,
  useAuthState,
  usePreview,
  useRefreshPreview,
  useIllustrateTurn,
  useRenditions,
  useRetryRendition,
  useSelectRendition,
  useSession,
  type RenditionSet,
  useLibrary,
  useSetHidden,
  useTranscript,
} from '../queries.js';
import { AlertNote } from '../ui/Alert.js';
import { Button } from '../ui/Button.js';
import { ContextMeter } from './ContextMeter.js';
import { remedySentence } from '../failures.js';
import { GuidanceBox } from './GuidanceBox.js';
import { ChannelHealth } from './ChannelHealth.js';
import { ChannelHud } from './ChannelHud.js';
import { CastPanel } from './CastPanel.js';
import {
  AutoMode,
  PushStory,
  autoDelayMs,
  letThemTalkLabel,
  NobodyWouldReply,
  WhoSpeaksNext,
} from './ChatComposer.js';
import { ChatMessages, EditedOriginal, type ChatGestures } from './ChatMessages.js';
import { ChatSettingsPanel } from './ChatSettingsPanel.js';
import { anyoneWouldReply, canSpeak, hiddenEntry, hideSent, turnSiblings } from './chat.js';
import { Portrait } from './Portrait.js';
import { liveMessages } from './reducer.js';
import { AUTO_MODE_DEFAULT_SECONDS, useAutoMode } from './useAutoMode.js';
import { DialPanel } from './DialPanel.js';
import { GoalPanel } from './GoalPanel.js';
import { InputKind, promptFor } from './InputKind.js';
import {
  attachProblem,
  ComposerPictures,
  MAX_PICTURES,
  MovePictures,
  type ComposerPicture,
} from './Pictures.js';
import { preparePicture } from './preparePicture.js';
import { ModeActions, ModeRegion } from './ModeRegion.js';
import { Starters, Suggestions } from './Suggestions.js';
import { MentionOverlay } from './MentionOverlay.js';
import { HookPanel } from './HookPanel.js';
import { LorePanel } from './LorePanel.js';
import { SessionPanel } from './SessionPanel.js';
import { anchorOffset, RenditionChooser, RenditionView } from './Rendition.js';
import { RememberThis } from './RememberThis.js';
import { RenameSession } from './RenameSession.js';
import { sessionLabel } from './session-label.js';
import { Fine, SectionTitle } from '../ui/Text.js';
import { useDebouncedInput } from './useDebouncedInput.js';
import { useTurnStream } from './useTurnStream.js';

import { labels } from '../i18n/catalogue.js';

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
 * A refusal in the reader's own language — [21 §1.4]'s rule, [P9.4].
 *
 * The class is what crossed the wire and the sentence is written here, which is
 * the same split `Rendition.tsx`'s `reasonOf` makes for a failed picture: the
 * server does not know the reader's language, so what travels is something a
 * client can render.
 */
const HELD_WORDS: Record<'no-binding' | 'no-moment' | 'no-place', string> = labels(
  'play.rendition.held-here',
  {
    'no-binding': 'Nothing is set up to make pictures yet.',
    'no-moment': 'There was nothing here worth a picture.',
    // 2026-09-30: a backdrop of no place would be a picture of a mood.
    'no-place': 'The story has not said where this is yet, so there is no place to draw.',
  },
);

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
export function PlayPage({
  sessionId,
  block,
  starters,
}: {
  sessionId: string;
  /** A block of this session's pack to open the settings panel on — [P7B.4]. */
  block?: string;
  /**
   * ***Labelled entry points for a session nobody has typed into yet*** —
   * [06 §7.4]'s *starter prompts*, [10 §7],
   * [P11.3](../../../../docs/design/workplan/28-p11-implementation.md).
   *
   * Marinara's suggestion chips: *"cheap, and the main thing standing between a
   * blank assistant box and people actually using it."*
   *
   * **A prop on the play surface rather than a thing the assistant panel
   * renders**, and that is [06 §7.4]'s claim applied to one more affordance: the
   * assistant is a session, so an affordance it wants belongs to *sessions* and
   * arrives here. A story mode that wanted openers on an empty session would
   * pass this and get the same control.
   *
   * *They fill the box rather than taking a turn*, which is `Suggestions`'
   * rule one component down and the same argument: a chip that submitted would
   * make the app's suggestion and the person's decision one gesture.
   */
  starters?: readonly string[];
}): React.JSX.Element {
  const queryClient = useQueryClient();
  const { state, dispatch } = useTurnStream(sessionId);
  const [draft, setDraft] = useState('');
  /**
   * ***Sticky across turns, deliberately*** — [P7.9]. A player having a
   * conversation sends several `say` turns in a row, and a selector that reset
   * to `do` after each one would make the common case the one that needs a click
   * every time. It is cleared by nothing: changing what you are doing is the
   * gesture, and it survives a reload the same way the draft does not, because
   * it is a mode of composing rather than content.
   */
  const [kind, setKind] = useState<string | undefined>(undefined);
  const [guidance, setGuidance] = useState('');
  /**
   * ***Pictures on the move being composed*** — [25 E15], R1. Uploaded as they
   * are attached, so what the move names is a digest the server already holds;
   * cleared when the move is sent, as the words are.
   */
  const [pictures, setPictures] = useState<ComposerPicture[]>([]);
  const [attaching, setAttaching] = useState(false);
  const [pictureProblem, setPictureProblem] = useState<string | null>(null);
  const pictureRefs = useMemo(
    () =>
      pictures.map((picture) => ({
        digest: picture.digest,
        ...(picture.caption.trim() === '' ? {} : { caption: picture.caption.trim() }),
      })),
    [pictures],
  );

  /**
   * Prepares and uploads each chosen picture — redrawn in the browser first, so
   * nothing a phone recorded about where a photo was taken ever leaves it
   * (`preparePicture`, which refuses rather than sending an original).
   */
  /** Whether the page is still here — read by an attach whose upload outlived it. */
  const pageOpen = useRef(true);
  const attachPictures = async (files: readonly File[]): Promise<void> => {
    setPictureProblem(null);
    setAttaching(true);
    try {
      // Counted here rather than read from `pictures`, which is the value this
      // render closed over and does not grow while the loop runs — and the same
      // for what is already held, so two files in one pick that come out as the
      // same bytes (a photo and its copy) are one picture, not two with one key.
      let room = MAX_PICTURES - pictures.length;
      const seen = new Set(pictures.map((one) => one.digest));
      for (const file of files) {
        if (room <= 0) break;
        const prepared = await preparePicture(file);
        const uploaded = await uploadPicture(sessionId, prepared);
        // A page left while the upload was out has already let go of its
        // previews, and a preview made now would be one nothing ever releases.
        if (!pageOpen.current) return;
        // The same picture attached twice is one picture: its address is its bytes.
        if (seen.has(uploaded.digest)) continue;
        seen.add(uploaded.digest);
        room -= 1;
        const preview = URL.createObjectURL(prepared);
        setPictures((held) => [...held, { digest: uploaded.digest, preview, caption: '' }]);
      }
    } catch (error) {
      setPictureProblem(attachProblem(error));
    } finally {
      setAttaching(false);
    }
  };

  /**
   * ***Clears the pictures a move carried, and only those*** — a picture whose
   * attach finished while the move was on its way was not in it, and stays for
   * the next one rather than vanishing unsent.
   */
  const clearSent = (sent: ReadonlySet<string>): void => {
    setPictures((held) => {
      for (const one of held) if (sent.has(one.digest)) URL.revokeObjectURL(one.preview);
      return held.filter((one) => !sent.has(one.digest));
    });
    setPictureProblem(null);
  };

  /**
   * ***The previews go with the page*** — each is a blob URL, which the browser
   * keeps for as long as the document lives unless it is told. Read through a
   * ref, because a cleanup keyed on `pictures` would revoke previews still on
   * screen every time one was added.
   */
  const heldPictures = useRef(pictures);
  heldPictures.current = pictures;
  useEffect(() => {
    pageOpen.current = true;
    return () => {
      pageOpen.current = false;
      for (const one of heldPictures.current) URL.revokeObjectURL(one.preview);
    };
  }, []);

  // Shared with the workbench through `queries.ts`, so both mounts read one
  // cache entry and the invalidate below refreshes both ([P3.1]).
  const session = useSession(sessionId);
  const transcript = useTranscript(sessionId);
  const auth = useAuthState();
  const locale = auth.data?.account?.locale ?? undefined;

  /**
   * ***The pictures, read once here and threaded down*** — the rule
   * `surfaces` and `cast` already follow, and the one [P8.5] paid for
   * breaking: a `useQuery` in a leaf took down forty-three `LorebookView`
   * tests, and a query per turn would be one per message here.
   *
   * **Two sources, and the live one wins.** The query is the set as it stood
   * when the page loaded; the stream's map is every record announced since
   * the stream last attached (2026-09-28: it was every record since the page
   * opened, drops and all — the reducer's `renditions` has why).
   * Overlaying rather than invalidating is what the whole-record frame bought
   * ([P9.2]) — a picture that finishes long after its turn did appears without
   * a refetch, which the `running → finished` invalidation effect below
   * structurally cannot deliver.
   */
  const renditions = useRenditions(sessionId);
  const retryRendition = useRetryRendition(sessionId);
  const selectRendition = useSelectRendition(sessionId);
  const illustrate = useIllustrateTurn(sessionId);
  /**
   * Why the last request made nothing, when it made nothing.
   *
   * ***A 200 with a reason is an answer, not an error***, which is what the
   * route's own docstring says and why this is not read off `illustrate.error`:
   * **nothing is bound to the image role** is the ordinary state of every
   * install ([19 §5.1]), and rendering it through the error path would make a
   * setting somebody has not done yet look like a fault.
   */
  const held = illustrate.data?.held;
  const picturesByTurn = renditionsByTurn(sessionId, renditions.data, state.renditions);

  const running = state.status === 'running';

  /**
   * ***The chat, when this session is one*** — [P14 §1.8], [P14.5]. `chat` is
   * the server's effective reading and is absent for a mode that does not play
   * as a chat, which is what every chat-only control below keys on: a Freeform
   * session's page is the page it was.
   */
  const chat = session.data?.chat;
  const roster = session.data?.session.cast;
  const library = useLibrary('actors');
  const actorObjects = library.data?.objects ?? [];
  /** Who speaks next — force-talk from the composer, one-shot (see `WhoSpeaksNext`). */
  const [forced, setForced] = useState('');
  /** Push story — the director armed for the next turn, one-shot (see `PushStory`). */
  const [push, setPush] = useState<'' | 'natural' | 'random'>('');
  /**
   * ***Whether the characters speak for themselves*** — the one voice under
   * which naming a speaker changes anything. A narrator speaks for nobody, so
   * *who speaks next*, the cast's *Speak* and talkativeness would each be a
   * control that changes nothing there — the settings panel's reason for
   * hiding dispatch under the narrator.
   */
  const embodied = chat?.voice === 'embodied';
  /**
   * A pick made before the chat was switched to the narrator is dropped rather
   * than sent: the control that made it is gone, and a forced list on a
   * narrated turn would be a choice nobody can see or undo.
   */
  useEffect(() => {
    if (!embodied) setForced('');
  }, [embodied]);
  /**
   * ***Edit boxes open in the transcript*** — counted, because each line has
   * its own. Opening one is taking the turn back, as typing in the composer is,
   * so it stops auto-mode; and the page is not idle while any is open.
   * `useCallback` because each line reports from an effect that depends on it.
   */
  const [editing, setEditing] = useState(0);
  const onEditing = useCallback((open: boolean) => {
    setEditing((count) => Math.max(count + (open ? 1 : -1), 0));
    if (open) setAuto(false);
  }, []);
  /** Auto-mode — on, and after how many quiet seconds (see `useAutoMode`). */
  const [auto, setAuto] = useState(false);
  const [autoSeconds, setAutoSeconds] = useState(String(AUTO_MODE_DEFAULT_SECONDS));
  /** An empty send nobody could answer was refused here, and says why. */
  const [nobody, setNobody] = useState(false);
  const speakable = (session.data?.cast ?? [])
    .filter((row) => canSpeak(row, roster))
    .map((row) => ({
      id: row.actorId,
      name: actorObjects.find((one) => one.id === row.actorId)?.name ?? row.actorId,
    }));
  /**
   * ***Whether an empty send would get a reply*** — [P14.4]'s note: under an
   * embodied voice a turn with no input and nobody named is answered by the
   * policy's pick from the eligible, and with nobody eligible it is a turn
   * with no reply at all. A narrator always answers, so the check is the
   * embodied voice's alone.
   */
  const wouldReply =
    chat?.voice !== 'embodied' || anyoneWouldReply(session.data?.cast ?? [], roster);

  /**
   * ***The composer, held so focus can be given back to it*** — see the effect
   * below. A textarea rather than the `<input>` it was for its first nine
   * phases: a turn of a story is prose, and prose in a one-line box scrolls
   * sideways past its own width with no way to hold a paragraph break. The
   * guidance box two controls down has been a textarea all along, on this same
   * `control` class; the composer is the one box that never got it.
   *
   * ***It starts at one line and grows, and that is not a refinement — it is
   * what makes the change safe.*** The first draft of this was `rows={3}`, and
   * the Playwright journey went red on a step four journeys later: the play
   * column is `h-full` and already full at a 720px viewport, the transcript is
   * the `flex-1` in it, and **a flex item that is a scroll container has an
   * automatic minimum size of zero** — `min-height: auto` only resolves to a
   * content-based minimum while `overflow` is `visible`. So the twenty-odd
   * pixels the taller box wanted came straight out of the transcript, which
   * collapsed to *height 0* with its turns overflowing behind the form. Redo
   * was still in the document and still "visible, enabled and stable"; the
   * click landed on the column lying over it.
   *
   * `field-sizing-content` with `rows={1}` costs nothing while the box is empty
   * — the same single line the `<input>` was — and spends height only once
   * there is prose to spend it on, capped at `max-h-40` so a long draft scrolls
   * inside the box rather than eating the story again. Where the property is
   * not supported the box stays one row and wraps, which is still every part of
   * this that matters: no sideways scroll, and Shift+Enter writes a paragraph.
   */
  const composer = useRef<HTMLTextAreaElement | null>(null);

  const send = useMutation({
    /**
     * `null` is *let them talk* — [P14 §1.6]: a turn with **no input**, not
     * one with empty words, so the policy answers the last message rather than
     * a blank move (ST's empty send). Pictures and a kind belong to a move, so
     * an empty send carries neither; guidance and a named speaker it may.
     */
    mutationFn: (sending: readonly { digest: string; caption?: string }[] | null) =>
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
        ...(sending === null
          ? {}
          : {
              text: draft,
              // Absent unless the player chose, so the route applies the mode's
              // default rather than the client guessing `do` for a mode without one.
              ...(kind === undefined ? {} : { kind }),
              ...(sending.length === 0 ? {} : { attachments: sending }),
            }),
        guidance,
        ...(forced === '' || !embodied ? {} : { speakers: [forced] }),
        ...(push === '' || chat === undefined ? {} : { push }),
      }),
    onSuccess: (accepted, sending) => {
      dispatch({ kind: 'submitted', jobId: accepted.jobId });
      setDraft('');
      clearSent(new Set((sending ?? []).map((one) => one.digest)));
      setForced('');
      setPush('');
      setNobody(false);
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
   * ***One gate in front of the send, rather than none*** — [polish §11].
   *
   * The form's handler used to read `if (draft.trim().length > 0) send.mutate()`
   * and nothing else, and `running` is set in `onSuccess` — so for the whole
   * duration of the POST the button stayed live, the composer had already
   * cleared, and a second press started a **second turn**. That is the half of
   * §11 the register does not describe: its symptom paragraph is about missing
   * feedback, and the missing feedback was also a missing guard.
   *
   * `send.isPending` rather than a flag of our own: the mutation already knows,
   * and a second source of truth about whether a request is out is how the two
   * come to disagree.
   */
  const submit = (): void => {
    if (send.isPending || running || attaching) return;
    // A move may be only a picture — its words are the picture's caption, and
    // the record keeps the move either way ([25 E15]).
    if (draft.trim().length === 0 && pictures.length === 0) {
      /**
       * ***An empty box is *let them talk*, in a chat*** — [P14 §1.8]. Under
       * `manual` with nobody named it still sends: the policy picks one
       * eligible member at random, which is SillyTavern's and what [P14.4]
       * kept. It is refused here only when nobody at all could answer, and
       * then it says so rather than committing a turn with no reply.
       */
      if (chat === undefined) return;
      if (forced === '' && !wouldReply) {
        setNobody(true);
        return;
      }
      send.mutate(null);
      return;
    }
    send.mutate(pictureRefs);
  };

  /**
   * ***The chat's gestures, each a turn*** — [P14 §1.6]. One mutation for every
   * gesture that submits: a swipe, a continue, an edit, a branch at a message,
   * and the cast panel's *speak*. They share the redo's posture — the composer
   * is left alone, because none of them used what is in it — and differ only
   * in the body, which `routes/gestures.ts` on the server reads.
   */
  const gesture = useMutation({
    mutationFn: (body: Omit<SubmitTurn, 'sessionId' | 'idempotencyKey' | 'headTurnId'>) =>
      submitTurn({
        sessionId,
        idempotencyKey: uuidv7(),
        headTurnId: session.data?.session.headTurnId ?? null,
        ...body,
      }),
    onSuccess: (accepted) => {
      dispatch({ kind: 'submitted', jobId: accepted.jobId });
      void queryClient.resetQueries({ queryKey: previewKey(sessionId) });
    },
  });
  const hide = useSetHidden(sessionId);

  /**
   * ***What each message's actions send*** — [P14 §1.6]'s table, row by row.
   *
   * - **Swipe** regenerates message *k* by the same speaker: `rewriteOf`, so
   *   the tape's draws hold and only the words change — the Redo button's
   *   default, for its reason (swiping past a failed check must not be
   *   save-scumming by accident).
   * - **Edit** is a sibling written by hand that names the turn it edits
   *   (`editOf`), so every line left as it was is carried whole.
   * - **Branch** at a message keeps the round up to it and stops there: an
   *   edit whose lines are that prefix, which the server carries whole. At the
   *   last message there is nothing to cut, and branching is *continue from
   *   here* — the head moves and nothing is written.
   * - **Hide** sends the turn's whole entry (`hideSent`).
   * - **Delete** moves the head to the turn's parent — `null` for the first
   *   turn, the root — and writes nothing: the turn stays as a sibling nobody
   *   is on.
   */
  const chatGestures: ChatGestures = {
    onGo: (turnId) => {
      goToSibling.mutate(turnId);
    },
    onSwipe: (turn, index) => {
      gesture.mutate({ rewriteOf: turn.id, fromMessage: index, parentTurnId: turn.parentTurnId });
    },
    onContinue: (turn) => {
      gesture.mutate({ continueOf: turn.id, parentTurnId: turn.parentTurnId });
    },
    onEditMessage: (turn, index, text) => {
      // `outputMessagesOf`, so a turn with no `messages` — pre-P14 or narrated
      // — is edited as the one narrator line it is drawn as.
      const messages = outputMessagesOf(turn.output).map((message, at) => ({
        speaker: message.speaker?.id ?? null,
        text: at === index ? text : message.text,
      }));
      gesture.mutate({
        editOf: turn.id,
        parentTurnId: turn.parentTurnId,
        authored: { messages },
      });
    },
    onEditInput: (turn, text) => {
      gesture.mutate({
        editOf: turn.id,
        parentTurnId: turn.parentTurnId,
        authored: { input: { text } },
      });
    },
    onHide: (turn, hidden, index) => {
      const count = outputMessagesOf(turn.output).length;
      hide.mutate({
        turnId: turn.id,
        hidden:
          index === null ? hidden : hideSent(hiddenEntry(chat, turn.id), index, count, hidden),
      });
    },
    onBranch: (turn, index) => {
      const messages = outputMessagesOf(turn.output);
      if (index >= messages.length - 1) {
        continueFrom.mutate(turn);
        return;
      }
      gesture.mutate({
        editOf: turn.id,
        parentTurnId: turn.parentTurnId,
        authored: {
          messages: messages
            .slice(0, index + 1)
            .map((message) => ({ speaker: message.speaker?.id ?? null, text: message.text })),
        },
      });
    },
    onDelete: (turn) => {
      remove.mutate(turn);
    },
    onEditing,
  };

  /**
   * ***Stopping is a request, and a request can be refused*** — [P6B.0].
   *
   * It was the one control on this page outside `useMutation`, spelled
   * `void cancelTurn(...)`, so it could reach neither the busy label every other
   * control has nor the `failure` fold below. A cancel the server refused — a
   * job that had already finished, an expired session — produced nothing at
   * all, on the one control a person presses *because* something already feels
   * wrong.
   */
  const stop = useMutation({
    mutationFn: (jobId: string) => cancelTurn(sessionId, jobId),
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
        // A turn that answered no move — *let them talk* — is redone as one:
        // sending `''` would turn it into a blank move by the player.
        ...(turn.input === undefined ? {} : { text: turn.input.text }),
        /**
         * **The move's kind comes with it** — a redone `think` is a thought
         * again, not a `do` that puts the player's private thought in the
         * scene, which is the failure the kind exists to prevent.
         */
        ...(turn.input?.kind === undefined ? {} : { kind: turn.input.kind }),
        /**
         * **And its pictures**, for the reason its words do: this is *that turn
         * again*. Named by the turn rather than re-sent, so the server copies
         * them as recorded — a picture whose bytes never reached this server
         * (an imported turn) included, and goes as its caption.
         */
        ...((turn.input?.attachments?.length ?? 0) === 0 ? {} : { attachmentsOf: turn.id }),
        parentTurnId: turn.parentTurnId,
        ...(rewrite ? { rewriteOf: turn.id } : {}),
        ...(guidance === undefined ? {} : { guidance, redoOf: turn.id }),
        /**
         * ***A pushed turn is redone pushed*** — [P14.5b]. A rewrite gets it
         * from the server, off the redone turn's director outcome; a plain
         * reroll names no turn the server could read it from, so it is sent.
         */
        ...(rewrite ? {} : pushOf(turn)),
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
    onSuccess: (result) => {
      setAbandoned(result.abandoned.escapedEffects > 0 ? result.abandoned : null);
      void queryClient.invalidateQueries({ queryKey: ['session', sessionId] });
      void queryClient.invalidateQueries({ queryKey: ['transcript', sessionId] });
      void queryClient.resetQueries({ queryKey: previewKey(sessionId) });
    },
  });

  /**
   * ***What the line you left still has out in the world*** — [07 §7]'s honesty
   * banner, [P6.3], surfaced at [P8.3].
   *
   * **P6.3 shipped the count and `api.ts` typed it away**, which [P8 §3.1] calls
   * the standing line's *inverse instance*: not configuration with no surface
   * but **a record with no surface**. It was harmless while nothing could write
   * an escaped effect, and it stops being harmless in the phase that produces
   * one — which is why closing it is P8's rather than P6's.
   *
   * *Shown only when the count is non-zero*, because *this line left nothing
   * behind* is the ordinary case and a banner that appears on every head move
   * would be furniture. *Dismissed by the next move*, not by a close button: the
   * statement is about the move that just happened, so the next one replaces it.
   */
  const [abandoned, setAbandoned] = useState<Abandoned | null>(null);

  const continueFrom = useMutation({
    mutationFn: (turn: TurnRecord) => moveHead(sessionId, turn.id),
    onSuccess: (result) => {
      setAbandoned(result.abandoned.escapedEffects > 0 ? result.abandoned : null);
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
   * ***Delete*** — [P14 §1.6]: *"the head moves to the parent. The turn
   * remains as a sibling nobody is on."* A head move and nothing else, so it
   * refreshes what one does; the first turn's parent is the root, `null`,
   * which [P14.4] made `PUT /head` accept for exactly this.
   */
  const remove = useMutation({
    mutationFn: (turn: TurnRecord) => moveHead(sessionId, turn.parentTurnId ?? null),
    onSuccess: (result) => {
      setAbandoned(result.abandoned.escapedEffects > 0 ? result.abandoned : null);
      refreshSession();
    },
  });

  /** Whether any of the transcript's own gestures is in flight — its controls' `busy`. */
  const transcriptBusy =
    running ||
    redo.isPending ||
    continueFrom.isPending ||
    undo.isPending ||
    name.isPending ||
    goToSibling.isPending ||
    gesture.isPending ||
    hide.isPending ||
    remove.isPending;

  /**
   * ***Auto-mode*** — [P14 §1.8]: a *let them talk* turn whenever the page has
   * been idle for the delay. Idle is the stream settled, nothing being sent or
   * moved, nothing in the box and no line being edited; the clock and its
   * re-arming are `useAutoMode`'s.
   *
   * ***`reconnecting` is not settled.*** The server is still running the round
   * the socket lost sight of, and a slow reconnect would otherwise have a new
   * turn submitted on top of it. `failed` switches auto-mode off below.
   * *The transcript's own gestures count*, the same list its `busy` reads: an
   * undo, a redo or a head move in flight is the turn being taken elsewhere.
   */
  const streamSettled = state.status === 'idle' || state.status === 'finished';
  const idle =
    streamSettled &&
    !transcriptBusy &&
    !send.isPending &&
    editing === 0 &&
    draft.length === 0 &&
    pictures.length === 0;
  useAutoMode({
    on: auto && chat !== undefined,
    idle,
    delayMs: autoDelayMs(autoSeconds, AUTO_MODE_DEFAULT_SECONDS),
    fire: () => {
      // Nobody left who could answer is a reason to stop, not to keep asking.
      if (!wouldReply) {
        setAuto(false);
        setNobody(true);
        return;
      }
      send.mutate(null);
    },
  });
  /**
   * *A failure stops it.* A model that is not answering would otherwise be
   * asked again every few seconds for as long as the tab is open — a loop the
   * person would come back to as a page of failed turns.
   */
  const failedNow = state.status === 'failed' || send.isError || gesture.isError;
  useEffect(() => {
    if (failedNow) setAuto(false);
  }, [failedNow]);

  /**
   * The most recent failure among this page's controls — [P6B.0].
   *
   * `submittedAt` rather than declaration order, because the one worth showing
   * is the one that just happened: an undo that failed ten minutes ago must not
   * outrank the send that failed a second ago. A mutation clears its own error
   * on its next attempt, so this empties by being used.
   */
  const failure = [send, redo, continueFrom, undo, name, goToSibling, stop, gesture, hide, remove]
    .filter((one) => one.isError)
    .sort((a, b) => b.submittedAt - a.submittedAt)[0]?.error;

  /**
   * ***Focus, given back when the turn ends.***
   *
   * The composer is `disabled` for the whole of a running turn, and disabling
   * the element that has focus moves focus to `<body>` — where the Tab order
   * starts again from the top of the document. So the rhythm of playing was:
   * type, send, read the reply, then reach for the mouse to get back into the
   * box you were already in. Nothing in this file called `focus()` at all.
   *
   * **On the transition rather than on the state**, which is why the previous
   * value is held rather than read off `running` alone: an effect keyed on
   * `running` also fires on mount, and a page that seizes focus on arrival is a
   * page that scrolls itself and opens a keyboard on a phone.
   *
   * **And only if focus was lost**, never if it has moved somewhere deliberate.
   * Somebody who tabbed to the guidance box while the turn ran has chosen where
   * they are, and taking that back would be a second bug wearing this one's
   * clothes. `<body>` is the signature of focus having been *dropped* rather
   * than placed.
   */
  const wasRunning = useRef(false);
  useEffect(() => {
    const justFinished = wasRunning.current && !running;
    wasRunning.current = running;
    if (!justFinished) return;
    /**
     * Three spellings of *focus was dropped rather than placed*. A browser
     * moves focus to `<body>` when the element holding it is disabled; jsdom
     * leaves it on the disabled element, and a browser may too if the disable
     * and the re-enable fall in one frame. None of the three is somebody having
     * chosen to be elsewhere, which is the only case this must not take back.
     */
    const active = document.activeElement;
    const dropped = active === null || active === document.body || active === composer.current;
    // `preventScroll`, because giving the keyboard back is a courtesy and
    // moving the page under somebody's eyes is not. The composer is at the
    // bottom of a column that scrolls; without this, the end of every turn
    // would jump the transcript down to it.
    if (dropped) composer.current?.focus({ preventScroll: true });
  }, [running]);

  /**
   * The meter's question, asked on every pause — [P3.4].
   *
   * `running` is in the dependencies rather than only in the guard, so the
   * turn *finishing* re-previews against the new head without a second effect
   * to keep in step with this one. Nothing is asked while a turn is in
   * flight: the input is disabled, the head is moving, and the entry was
   * dropped at submit.
   */
  const pictureKey = pictureRefs
    .map((picture) => `${picture.digest}\u0000${picture.caption ?? ''}`)
    .join('\u0001');
  const settled = useDebouncedInput(draft, guidance, PREVIEW_DEBOUNCE_MS, pictureKey);
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
    if (settled.pictures !== pictureKey) return;
    // The move's pictures and its kind too, so the meter and the panel measure
    // the blocks the turn will send — a pack whose input slots are per-kind
    // previews nothing of the move without the kind.
    refreshPreview({
      text: settled.text,
      guidance: settled.guidance,
      ...(kind === undefined ? {} : { kind }),
      ...(pictureRefs.length === 0 ? {} : { attachments: pictureRefs }),
    });
  }, [settled, draft, guidance, running, refreshPreview, pictureRefs, pictureKey, kind]);

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
   * ***The pictures, read again when the stream comes back*** (2026-09-28). A
   * re-attach empties the reducer's map (`PlayState.renditions` says why), so
   * the set is asked for again: a frame sent while the stream was down reached
   * nobody, and this is how what it said arrives. Not on the first attach,
   * which is the page opening with the set just read.
   */
  useEffect(() => {
    if (state.attached < 2) return;
    void queryClient.invalidateQueries({ queryKey: renditionsKey(sessionId) });
  }, [state.attached, sessionId, queryClient]);

  /**
   * ***The session, read again when a backdrop lands*** (2026-09-30) — see
   * `PlayState.backdrops`. The head and the stage are the session's, and the
   * composer, a redo and every gesture send the head this query holds.
   */
  useEffect(() => {
    if (state.backdrops === 0) return;
    void queryClient.invalidateQueries({ queryKey: ['session', sessionId] });
  }, [state.backdrops, sessionId, queryClient]);

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
        <SectionTitle as="h1">
          {session.data === undefined ? 'Session' : sessionLabel(session.data.session.name)}
        </SectionTitle>
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
      <CastPanel
        sessionId={sessionId}
        locale={locale}
        busy={running || gesture.isPending || send.isPending}
        onSpeak={(actorId) => {
          // *Speak* is force-talk with no input — let them talk, aimed.
          gesture.mutate({ speakers: [actorId] });
        }}
      />

      {/* **How this chat plays** — [P14 §1.8]'s session settings, [P14.5].
          Beside the cast because the two are the chat's configuration: who is
          in it, and how they are asked to speak. Renders nothing for a mode
          that does not play as a chat. */}
      <ChatSettingsPanel sessionId={sessionId} />

      {/* What this session retrieves from — [P6B.0]. Above the transcript and
          closed by default: it is a fact about the session rather than about
          any turn, and the story column is the surface. */}
      <LorePanel sessionId={sessionId} />

      {/* **How this session is prompted, and the two verbs it never had** —
          [P7B.2]. Beside the lore panel because both are facts about the
          session rather than about a turn, and after it because what a session
          retrieves from is the thing people reach for more often than which
          pack it runs. *The seventh disclosure in this column*, which
          `SessionPanel` says is a debt rather than a design. */}
      <SessionPanel sessionId={sessionId} {...(block === undefined ? {} : { block })} />

      {/* **What this story is trying to do** — [06 §7.3.3], [06 §7.3.4], [P7.6].
          Above the hooks because a goal is what the session is *for* and a hook
          is something that might happen along the way — and because the three
          offers at a completion are the most consequential control on the page.
          A disclosure like its neighbours, present even with no chain because
          the control that sets one is inside it. */}
      <GoalPanel sessionId={sessionId} busy={running || gesture.isPending || send.isPending} />

      {/* **The authored plot waiting to happen** — [10 §10.1], [P7.5]. Beside
          the lore panel rather than beside the cast, which 10 §10.1 chose
          deliberately: the cast panel is *"two views of one observation about
          identity resolution"* and a hook shares neither the observation nor the
          subject. A disclosure like its neighbour, and present even with an
          empty pool because the control that adds one is inside it — [03 §4.1]
          calls adding a hook to a running session *the primary path*. */}
      <HookPanel sessionId={sessionId} />

      {/* **The two dials** — [06 §7.3.1], [06 §7.3.2], [P7.8]. Not a disclosure,
          unlike its three neighbours, and the difference is deliberate: those
          hold lists that grow, and this is two selects that are always exactly
          two selects. *Below the hook panel* because the third dial is in it —
          [06 §7.3.2] calls hook pacing the honest form of directedness, so the
          reading order puts the two axes next to the control that is the third,
          where somebody wondering why the story keeps pulling can see all three
          at once. Renders nothing for a mode that declares no difficulty, which
          is [04 §7]'s explicit case. */}
      <DialPanel sessionId={sessionId} />

      {/* **Whatever else this mode's declaration asked for** — [06 §9], [P7.11].
          Last in the panel stack because the four above it are the engine's own
          and a mode's additions belong after them, and because a mode that
          declares none renders nothing here at all. */}
      {/* ***What a person may run between turns*** — [P14.5a]'s *Update
          trackers*, above the cards it updates. Renders nothing unless the
          server lists an action, which it does only while a tracker is on. */}
      <ModeActions
        sessionId={sessionId}
        actions={session.data?.actions}
        busy={running || send.isPending}
      />
      <ModeRegion
        sessionId={sessionId}
        surfaces={session.data?.surfaces}
        region="panel"
        nameOf={(actorId) => actorObjects.find((one) => one.id === actorId)?.name ?? actorId}
      />

      {/* **The stage** — [06 §7.2], [10 §2.3], [P7.11]. The picture the story is
          staged against, and it behaves like chrome: *"The prose wins,
          always… On a phone it is the first thing to go."* Renders nothing at
          all when the session has no backdrop, which 10 §2.3 requires in as
          many words — there must be no placeholder where the picture would go. */}
      <ModeRegion
        sessionId={sessionId}
        surfaces={session.data?.surfaces}
        region="stage"
        className="flex flex-col gap-2"
      />

      {/* ***Set the scene*** — [06 §10.6], [P9.4]. *"The manual counterpart is
          **Set the scene**, which regenerates the backdrop for where you are
          now."* So it hangs off the head rather than off a message, which is the
          difference between it and **Illustrate** and the reason it is here
          rather than in the transcript.

          **Only for a mode that has a stage.** `renditions.backdrop` is absent
          when the mode declares no backdrop channel, which is `dials`' rule for
          a mode with no difficulty: nothing to render rather than a control that
          does nothing. */}
      {session.data?.renditions?.backdrop === undefined ||
      session.data.session.headTurnId === null ? null : (
        <div className="flex items-center gap-2">
          <Button
            type="button"
            disabled={running || illustrate.isPending}
            onClick={() => {
              illustrate.mutate({
                turnId: session.data?.session.headTurnId ?? '',
                purpose: 'background',
              });
            }}
          >
            Set the scene
          </Button>
          {held === undefined ? null : <Fine>{HELD_WORDS[held]}</Fine>}
        </div>
      )}

      {/*
        ***The story keeps room of its own*** (2026-10-01). `flex-1` with
        `overflow-y-auto` lets a flex item shrink to nothing, and since P14 put
        the cast, five session panels and the two scene switches above it, at a
        1280×720 window — the e2e journeys' size, and a common laptop's — the
        transcript was exactly that: zero pixels tall, the story invisible
        between the controls and the composer, and every button in it covered
        by whatever sat on top. A floor of half the viewport means the page
        scrolls past the controls instead; on a tall window nothing changes,
        because `flex-1` was already giving it more.
      */}
      <ol
        className="flex min-h-[50dvh] flex-1 flex-col gap-4 overflow-y-auto"
        aria-label="Transcript"
      >
        {(transcript.data?.turns ?? []).map((turn) => (
          <TurnView
            key={turn.id}
            sessionId={sessionId}
            surfaces={session.data?.surfaces}
            cast={session.data?.cast ?? []}
            renditions={picturesByTurn.get(turn.id) ?? []}
            selectedRenditionId={renditions.data?.selection[turn.id]}
            onRetryRendition={(renditionId) => {
              retryRendition.mutate(renditionId);
            }}
            onSelectRendition={(renditionId) => {
              selectRendition.mutate({ turnId: turn.id, renditionId });
            }}
            illustrating={session.data?.renditions?.illustration !== 'off'}
            onIllustrate={(turnId) => {
              illustrate.mutate({ turnId, purpose: 'illustration' });
            }}
            turn={turn}
            siblings={transcript.data?.siblings?.[turn.id] ?? []}
            swipes={transcript.data?.swipes?.[turn.id]}
            head={turn.id === session.data?.session.headTurnId}
            chat={chat}
            actors={actorObjects}
            personaId={roster?.persona ?? null}
            gestures={chatGestures}
            busy={transcriptBusy}
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
        {running ? (
          <LiveTurn text={state.text} messages={liveMessages(state)} actors={actorObjects} />
        ) : null}
      </ol>

      <StreamStatus
        status={state.status}
        error={state.error}
        waiting={send.isPending || gesture.isPending || (running && state.text.length === 0)}
      />

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

      {/* ***The line you left still has things out in the world*** — [07 §7],
          [P6.3], surfaced at [P8.3]. Not an error: nothing went wrong, and
          07 §7 calls this *"a small honesty feature that avoids a confusing
          class of bug reports"* — the report being *I abandoned that line and
          Vera still remembers it*. Saying the number is the whole feature;
          offering to undo it would be offering to un-write a library. */}
      {abandoned === null ? null : (
        <AlertNote>
          {`${String(abandoned.turns)} ${abandoned.turns === 1 ? 'turn is' : 'turns are'} no longer on this line, and ${String(abandoned.escapedEffects)} ${abandoned.escapedEffects === 1 ? 'thing it wrote' : 'things they wrote'} outside the session ${abandoned.escapedEffects === 1 ? 'stays' : 'stay'} written — memories are kept where they were saved.`}
        </AlertNote>
      )}

      <form
        className="flex flex-col gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          submit();
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
        {/* **Above the box, and the order is the sentence.** A player picks
            what kind of thing they are about to do and then writes it; a
            selector to the right of the input would be a setting applied after
            the fact. Renders nothing for a mode with one kind — [06 §1], and
            Scene is that mode. */}
        <InputKind
          kinds={session.data?.inputs ?? []}
          value={kind}
          disabled={running}
          onChange={setKind}
        />
        {/* **Who speaks next** — [P14 §1.8], and while a round streams, who is
            speaking ([P14 §1.3a] point 8). Beside the kind selector because it
            is the same sort of choice: made before the words, about them. */}
        {!embodied ? null : (
          <WhoSpeaksNext
            members={speakable}
            value={forced}
            onChange={(actorId) => {
              setForced(actorId);
              setNobody(false);
            }}
            disabled={running || send.isPending}
            order={state.order}
            running={running}
          />
        )}
        {/* **Push story** — [P14.5b]: made before the words, like the two
            above, and a chat's alone. */}
        {chat === undefined ? null : (
          <PushStory value={push} onChange={setPush} disabled={running || send.isPending} />
        )}
        <div className="flex gap-2">
          <label className="flex-1">
            <span className="sr-only">{promptFor(kind)}</span>
            <textarea
              ref={composer}
              className={`${control} field-sizing-content max-h-40 resize-y`}
              rows={1}
              value={draft}
              disabled={running}
              placeholder={promptFor(kind)}
              onChange={(event) => {
                setDraft(event.target.value);
                setNobody(false);
                // Typing stops auto-mode — [P14 §1.8]. Somebody writing has
                // taken the turn back, and a timer firing under them would
                // send the scene on without the move they are composing.
                if (event.target.value !== '') setAuto(false);
              }}
              /**
               * **Enter still sends; Shift+Enter is the paragraph break.**
               * Changing the element must not change the habit — Enter has sent
               * a turn since P2, and a textarea's own default is to insert a
               * newline, so without this the box would have quietly stopped
               * submitting for everybody who has ever used it.
               *
               * ***`isComposing` is the arm that is not obvious.*** An input
               * method editor — every Japanese, Chinese and Korean keyboard —
               * uses Enter to **commit the candidate it is offering**, and that
               * keystroke arrives here like any other. Without the guard,
               * choosing a word would send the turn mid-sentence: not a rough
               * edge but an app those people cannot type in. It is read off
               * `nativeEvent` because React's synthetic event does not carry it.
               */
              onKeyDown={(event) => {
                if (event.key !== 'Enter' || event.shiftKey) return;
                if (event.nativeEvent.isComposing) return;
                event.preventDefault();
                submit();
              }}
            />
          </label>
          {running && state.jobId !== null ? (
            <Button
              type="button"
              disabled={stop.isPending}
              onClick={() => {
                // Stop stops auto-mode too: pressing it is somebody saying
                // *not that*, and the next tick would be more of the same.
                setAuto(false);
                stop.mutate(state.jobId ?? '');
              }}
            >
              {stop.isPending ? STOPPING : 'Stop'}
            </Button>
          ) : (
            /* **The label is the reason it is greyed**, which is what
               [10 §11.1a] asks of any control that disables: a button reading
               *Sending…* has already said why it cannot be pressed again. */
            <Button type="submit" variant="primary" disabled={send.isPending || attaching}>
              {send.isPending
                ? SENDING
                : attaching
                  ? PREPARING
                  : chat !== undefined && draft.trim() === '' && pictures.length === 0
                    ? letThemTalkLabel()
                    : 'Send'}
            </Button>
          )}
        </div>
        {/*
          ***A draft in your own character's voice*** —
          [06 §3.1](../../../../docs/design/06-modes-and-turn-pipeline.md),
          [P11.4]. *"Genuinely useful when stuck, when you want the model's read
          on how your character would answer, or as a drafting aid you then
          rewrite."*

          **Under the box rather than beside Send**, because it is not the
          primary action and never should read as one: §3.1's first detail is
          that this is *"a draft, not a commitment"*, and a control sitting where
          Send sits invites the press that skips the reading.
        */}
        <ComposerPictures
          pictures={pictures}
          previewBlocks={
            preview.data?.preview.state === 'assembled' ? preview.data.preview.blocks : undefined
          }
          busy={attaching}
          problem={pictureProblem}
          disabled={running || send.isPending}
          onAttach={(files) => {
            void attachPictures(files);
          }}
          onCaption={(digest, caption) => {
            setPictures((held) =>
              held.map((one) => (one.digest === digest ? { ...one, caption } : one)),
            );
          }}
          onRemove={(digest) => {
            setPictures((held) => {
              for (const one of held) if (one.digest === digest) URL.revokeObjectURL(one.preview);
              return held.filter((one) => one.digest !== digest);
            });
          }}
        />
        {nobody ? <NobodyWouldReply /> : null}
        <Impersonate
          sessionId={sessionId}
          disabled={running}
          onDrafted={(text) => {
            setDraft(text);
          }}
        />
        {chat === undefined ? null : (
          <AutoMode on={auto} seconds={autoSeconds} onToggle={setAuto} onSeconds={setAutoSeconds} />
        )}
        {/* **Below the composer and above the guidance box** — [R11], [P7.9].
            The offers fill the box rather than taking a turn, so they belong
            beside the thing they fill; the toggle rides with them because it is
            the control that explains an empty row, which is the argument
            [10 §10.1] makes for the pacing dial one panel over. */}
        {/* **Only while there is nothing to talk about yet.** A starter beside
            a conversation in progress is an offer to start over, which is not
            what it is for — and the session's own suggestions take the row from
            the first turn onward. */}
        {starters === undefined || (transcript.data?.turns.length ?? 0) > 0 ? null : (
          <Starters actions={starters} disabled={running} onPick={setDraft} />
        )}
        <Suggestions
          sessionId={sessionId}
          actions={transcript.data?.turns.at(-1)?.suggestions ?? []}
          disabled={running}
          onPick={setDraft}
        />
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
/**
 * A turn's prose with its pictures where they belong —
 * [06 §10.4a](../../../../docs/design/06-modes-and-turn-pipeline.md), [P9.4].
 *
 * ***Inline is meant literally*** ([10 §12.1]): *"an illustration renders at its
 * anchor, the sentence it is of, and falls to the end of the message when the
 * anchor no longer resolves."*
 *
 * **Which means the prose is split rather than the picture appended**, and the
 * spans have to be split with it: `MentionOverlay` takes offsets into the text
 * it is given, so a second half rendered with the whole turn's spans would draw
 * every mark at the wrong place. Rebasing them here is the cost of putting a
 * picture inside a paragraph, and it is why this is a component rather than two
 * lines in `TurnView`.
 *
 * ***A miss is ordinary and costs nothing*** — §10.4a. An anchor that does not
 * resolve returns no offset, the prose renders whole, and the picture goes
 * underneath, which is where it would have gone before the field existed.
 */
function IllustratedProse({
  sessionId,
  text,
  spans,
  renditions,
  selectedId,
  onRetry,
  onSelect,
  busy,
  picturesOnly = false,
}: {
  sessionId: string;
  text: string;
  spans: readonly TextSpan[];
  /**
   * ***The pictures and none of the prose*** — [P14.5]: a chat turn draws its
   * words message by message (`ChatMessages`), and its pictures fall to the
   * end of the turn, which is §10.4a's rule for an anchor that does not
   * resolve. Anchoring one inside a message is a later refinement; losing the
   * picture would not be.
   */
  picturesOnly?: boolean;
  renditions: readonly RenditionRecord[];
  /** Which sibling this turn shows, when a person has chosen one — [06 §10.7]. */
  selectedId: string | undefined;
  onRetry: (renditionId: string) => void;
  onSelect: (renditionId: string) => void;
  busy: boolean;
}): React.JSX.Element | null {
  /**
   * **Illustrations only.** A backdrop belongs behind the reading column
   * ([10 §2.3]) and reaches it through the `stage` region, not through the
   * prose — §12.1 is explicit that the reading view shows *"the illustrations,
   * and **not** the backdrop"*.
   */
  const pictures = renditions.filter((one) => one.purpose === 'illustration');
  if (pictures.length === 0) {
    if (picturesOnly) return null;
    return (
      <MentionOverlay
        text={text}
        spans={spans}
        className="whitespace-pre-wrap text-story font-story text-ink"
      />
    );
  }

  /**
   * ***One picture shows and the siblings wait behind the chooser.***
   *
   * [06 §10.7] is why there can be several — *"illustrating an old turn adds;
   * it does not overwrite"* — and [10 §12.1] is why only one renders: the
   * reading view is prose with an illustration in it, not a contact sheet.
   *
   * **The newest, absent a choice.** Somebody who presses *Illustrate* again is
   * asking to see the new one; the old one is still there under the chooser,
   * which is the non-destructive half of the same policy. A stored selection
   * always wins, including when it names an older sibling.
   */
  const chosen = pictures.find((one) => one.id === selectedId);
  const shown = chosen ?? pictures[pictures.length - 1];
  if (shown === undefined) {
    if (picturesOnly) return null;
    return (
      <MentionOverlay
        text={text}
        spans={spans}
        className="whitespace-pre-wrap text-story font-story text-ink"
      />
    );
  }

  const chooser = (
    <RenditionChooser renditions={pictures} selectedId={shown.id} onSelect={onSelect} busy={busy} />
  );
  const picture = (
    <RenditionView sessionId={sessionId} rendition={shown} onRetry={onRetry} busy={busy} />
  );

  if (picturesOnly) {
    return (
      <>
        {picture}
        {chooser}
      </>
    );
  }

  const at = anchorOffset(text, shown.scope?.anchor);
  if (at === null) {
    /**
     * ***A miss is ordinary and costs nothing*** — §10.4a. The anchor did not
     * resolve, or there never was one, so the prose renders whole and the
     * picture goes underneath, which is where it would have gone before the
     * field existed.
     */
    return (
      <>
        <MentionOverlay
          text={text}
          spans={spans}
          className="whitespace-pre-wrap text-story font-story text-ink"
        />
        {picture}
        {chooser}
      </>
    );
  }

  return (
    <>
      <MentionOverlay
        text={text.slice(0, at)}
        spans={spans.filter((span) => span.end <= at)}
        className="whitespace-pre-wrap text-story font-story text-ink"
      />
      {picture}
      {chooser}
      <MentionOverlay
        text={text.slice(at)}
        /**
         * **Rebased, because `MentionOverlay` indexes the text it is handed.** A
         * second half rendered with the whole turn's spans would draw every mark
         * at the wrong place, which is the cost of putting a picture inside a
         * paragraph and the reason this is a component rather than two lines in
         * `TurnView`. A span straddling the split is dropped rather than halved:
         * half a mark is a worse overlay than none.
         */
        spans={spans
          .filter((span) => span.start >= at)
          .map((span) => ({ ...span, start: span.start - at, end: span.end - at }))}
        className="whitespace-pre-wrap text-story font-story text-ink"
      />
    </>
  );
}

/**
 * A session's pictures, grouped by the turn they hang on — [P9.4].
 *
 * ***Two sources and the live one wins.*** The query is the set as it stood
 * when the page loaded; the reducer's map is every record the stream has
 * announced since, and a rendition frame carries the **whole** record, so the
 * overlay is an upsert rather than a merge of fields.
 *
 * *Filtered by session*, because the reducer's map outlives a change of
 * `sessionId` — `useTurnStream` reopens the socket without resetting the
 * reducer, exactly as `text` and `seen` already survive it. An id from another
 * session could never match a turn in this one, so this guard buys clarity
 * rather than correctness; it costs one comparison and removes the need to
 * reason about that every time somebody reads this. *Corrected 2026-09-28:*
 * ~~the reducer's map outlives a change of `sessionId`~~ — the page is keyed
 * by session now (`42aba38`), so a session starts with a fresh reducer; the
 * guard stays for the rest of the reason.
 *
 * *Sorted by `ordering` then id*, which is the order they were made in: the
 * chooser numbers them from this, and a set that reordered itself between
 * renders would renumber under the reader's cursor.
 */
function renditionsByTurn(
  sessionId: string,
  loaded: RenditionSet | undefined,
  live: Readonly<Record<string, RenditionRecord>>,
): Map<string, RenditionRecord[]> {
  const merged = new Map(loaded?.byId ?? []);
  for (const one of Object.values(live)) {
    if (one.sessionId === sessionId) merged.set(one.id, one);
  }

  const byTurn = new Map<string, RenditionRecord[]>();
  for (const one of merged.values()) {
    const held = byTurn.get(one.turnId);
    if (held === undefined) byTurn.set(one.turnId, [one]);
    else held.push(one);
  }
  for (const held of byTurn.values()) {
    held.sort((left, right) =>
      left.ordering === right.ordering
        ? left.id.localeCompare(right.id)
        : left.ordering - right.ordering,
    );
  }
  return byTurn;
}

function TurnView({
  turn,
  siblings,
  swipes,
  head,
  chat,
  actors,
  personaId,
  gestures,
  busy,
  onRedo,
  onContinueFrom,
  onUndo,
  onGoToSibling,
  onName,
  sessionId,
  surfaces,
  cast,
  renditions,
  selectedRenditionId,
  onRetryRendition,
  onSelectRendition,
  illustrating,
  onIllustrate,
}: {
  turn: TurnRecord;
  siblings: string[];
  /** Where this turn's siblings are drawn — [P14.5], from the transcript. */
  swipes: SwipeGroups | undefined;
  /** Whether this is the session's head turn. */
  head: boolean;
  /** The chat's effective settings, absent for a mode that is not one. */
  chat: ChatSettings | undefined;
  /** The library's actors, read once by the page — for names and portraits. */
  actors: readonly LibraryObject[];
  personaId: string | null;
  gestures: ChatGestures;
  sessionId: string;
  /** Whose memory a capture could be — read once by the page, per `surfaces`. */
  cast: readonly CastRow[];
  /** A mode's message decorations, read once by the page — see `ModeRegion`. */
  surfaces: readonly ModeSurface[] | undefined;
  busy: boolean;
  onRedo: (turn: TurnRecord, rewrite: boolean, guidance?: string) => void;
  onContinueFrom: (turn: TurnRecord) => void;
  onUndo: (turn: TurnRecord) => void;
  onGoToSibling: (turnId: string) => void;
  onName: (turnId: string, name: string) => void;
  /** This turn's pictures, read once by the page — `surfaces`' rule. */
  renditions: readonly RenditionRecord[];
  /** Which of them is showing, when a person has chosen — [06 §10.7]. */
  selectedRenditionId: string | undefined;
  onRetryRendition: (renditionId: string) => void;
  onSelectRendition: (renditionId: string) => void;
  /** Whether this session makes pictures at all — [06 §10.6]. */
  illustrating: boolean;
  onIllustrate: (turnId: string) => void;
}): React.JSX.Element {
  // A turn with no input is not one a person wrote — a divergence turn from a
  // hand edit ([03 §8.1]) is the one that exists today — so there is nothing to
  // attempt again. ***Unless it made a call*** ([P14.5]): a chat's *let them
  // talk* answers no move and is still a reply a person may want again.
  // A greeting made none, and its alternates are its siblings already.
  const rerunnable = turn.input !== undefined || turn.request !== undefined;
  /**
   * ***Every turn of a chat is drawn as one*** — [P14.5]. A turn whose output
   * names no speakers — written before P14, narrated, or embodied under
   * `fixed` — is one narrator line (`outputMessagesOf`), drawn as narration;
   * drawing it as prose instead would leave hide, edit, branch and delete
   * unreachable on every turn of a narrator-voice chat. Outside a chat a turn
   * is prose unless its record says who spoke, as before.
   */
  const named = turn.output?.messages;
  const chatShaped =
    turn.output !== undefined && (chat !== undefined || (named !== undefined && named.length > 0));
  const messages = outputMessagesOf(turn.output);
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
      {chatShaped || turn.input === undefined || turn.input.text === '' ? null : (
        <p className="text-story font-story text-ink-subtle">{turn.input.text}</p>
      )}
      {turn.input?.attachments === undefined ? null : (
        <MovePictures sessionId={sessionId} pictures={turn.input.attachments} />
      )}
      {chatShaped ? (
        <>
          <ChatMessages
            turn={turn}
            messages={messages}
            hidden={hiddenEntry(chat, turn.id)}
            actors={actors}
            personaId={personaId}
            swipes={swipes}
            voice={chat?.voice}
            head={head}
            busy={busy}
            {...gestures}
          />
          <IllustratedProse
            sessionId={sessionId}
            text=""
            spans={[]}
            renditions={renditions}
            selectedId={selectedRenditionId}
            onRetry={onRetryRendition}
            onSelect={onSelectRendition}
            busy={busy}
            picturesOnly
          />
        </>
      ) : null}
      {/* **What the engine understood, drawn over the prose** — [10 §13.1],
          [P7.7]. An overlay and never a rewrite: with no spans this renders the
          same characters the model wrote, which is what makes the marks
          subtractable rather than baked in. */}
      {chatShaped || turn.output === undefined ? null : (
        <IllustratedProse
          sessionId={sessionId}
          text={turn.output.text}
          spans={(turn.spans ?? []).filter((span) => span.field === 'output')}
          renditions={renditions}
          selectedId={selectedRenditionId}
          onRetry={onRetryRendition}
          onSelect={onSelectRendition}
          busy={busy}
        />
      )}
      {chatShaped || turn.output?.original === undefined ? null : (
        <EditedOriginal text={turn.output.original} />
      )}
      {/* **A mode's own decoration on the message** — [06 §9]'s third region,
          [P7.11]. The engine already has one of these in the overlay above; this
          is the same idea declared rather than written, and Scene's expression
          sprite is what asked for it. *Below the prose rather than beside it*:
          the message is the story and a picture is an accompaniment, which is
          the same order [10 §2.3] puts the backdrop in. */}
      <ModeRegion
        sessionId={sessionId}
        surfaces={surfaces}
        region="message"
        className="flex flex-wrap gap-2"
      />
      {/* A failed turn is shown rather than hidden: it is on the record with
          what it managed, and hiding it would make a re-run unexplainable.

          ***And since [P11.6] it says what to do about it.*** The line was
          *This turn did not finish.* and nothing else — which is the sentence
          [09 §6.5] is complaining about when it asks for *"this server appears
          to have no internet access"* instead of a raw connection error. The
          class is read off the record's own steps and turned into a remedy by
          `remedyFor`, the same function the runner uses while the failure is
          fresh; a reader has fewer inputs, so it lands on the arm that says
          less, which is the honest degrade rather than a second guess. */}
      {turn.status === 'failed' ? <FailedTurnNote turn={turn} /> : null}

      {/* Visible on hover and on focus. Focus is not decoration here: these are
          the only controls in the transcript, and a keyboard reaching them
          would otherwise tab into things it cannot see — and, since this pass,
          visible always on a device that cannot hover, which is what `reveal`
          is for and why it is spelled once. */}
      <div
        className={`flex gap-2 ${reveal} group-focus-within/turn:opacity-100 group-hover/turn:opacity-100`}
      >
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
        {/* ***Illustrate*** — [06 §10.6], [P9.4]. *"A manual **Illustrate**
            action on any message in the history, which is the same step invoked
            by hand — additive, never replacing."* Beside the other per-message
            gestures for `RememberThis`' reason: it is a thing you do to one
            message, on the message.

            **Hidden when the session makes no pictures**, rather than disabled.
            A disabled button says *this is for you and not now*; off is a
            setting somebody chose, and the place that explains it is the control
            they chose it with. */}
        {illustrating && turn.output !== undefined ? (
          <Button
            type="button"
            disabled={busy}
            onClick={() => {
              onIllustrate(turn.id);
            }}
          >
            Illustrate
          </Button>
        ) : null}
        {/* ***Remember this*** — [08 §2.1], [P8.3]'s cut form. Beside the other
            per-message gestures because that is what it is: a thing you do to
            one message, on the message. */}
        <RememberThis
          sessionId={sessionId}
          turnId={turn.id}
          cast={cast}
          prose={turn.output?.text ?? ''}
          busy={busy}
        />
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
        siblings={turnSiblings(siblings, swipes, chatShaped)}
        // Naming is about the node, so it is offered whenever there is a choice
        // at all — including a chat turn whose alternatives are all message
        // swipes, whose counters are on the messages and leave this strip
        // empty. Promoting a swipe ([07 §6]) would otherwise be unreachable on
        // most chat turns.
        nameable={siblings.length >= 2}
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
  nameable,
  busy,
  onGo,
  onName,
}: {
  turn: TurnRecord;
  siblings: string[];
  /** Whether the node has alternatives anywhere — the name control's condition. */
  nameable: boolean;
  busy: boolean;
  onGo: (turnId: string) => void;
  onName: (turnId: string, name: string) => void;
}): React.JSX.Element | null {
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState('');

  const at = siblings.indexOf(turn.id);
  const stepping = siblings.length >= 2 && at >= 0;
  if (!stepping && !nameable) return null;

  const previous = siblings[at - 1];
  const next = siblings[at + 1];

  return (
    <div className="flex items-center gap-2 text-sm text-ink-subtle">
      {stepping ? (
        <>
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
        </>
      ) : null}

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
  /**
   * ***The class stopped being the sentence at [P11.6].*** This read *The turn
   * failed (transient). Reload to try again.* — [P6B.0] added the class because
   * one sentence covered every failure, which was the right diagnosis and the
   * wrong vocabulary: `transient` describes our retry ladder and tells a reader
   * nothing. The remedy is the sentence now, and the class is still appended for
   * the bug report, in brackets, where it belongs.
   */
  if (error === null) return 'The connection failed. Reload to try again.';
  const sentence = remedySentence(remedyFor({ reason: error as StepFailureReason, online: null }));
  return sentence === null
    ? `The turn failed (${error}). Reload to try again.`
    : `${sentence} (${error})`;
}

/**
 * ***What a failed turn says in the transcript*** — [09 §6.5], [P11.6].
 *
 * The first line is the fact and the second is the remedy, and they are two
 * sentences rather than one because the fact is always true and the remedy is
 * sometimes unavailable — a turn with no recorded steps, a class this build has
 * never heard of. **A missing remedy leaves the original line exactly as it
 * was**, which is the behaviour a version skew should have.
 */
function FailedTurnNote({ turn }: { turn: TurnRecord }): React.JSX.Element {
  const sentence = recordedRemedy(turn);
  return (
    <div className="flex flex-col gap-1 text-sm text-warn-ink">
      <p>This turn did not finish.</p>
      {sentence === null ? null : <p>{sentence}</p>}
    </div>
  );
}

/**
 * The remedy for a turn on the record, or null when it cannot be told.
 *
 * ***The last failed step rather than the first***, because a turn stops at the
 * step that aborted it and that is the one whose failure ended the turn. An
 * earlier `warn` step that failed and was stepped over is on the record too, and
 * reporting its remedy would explain something that did not stop anything.
 *
 * **The record holds neither the endpoint's locality nor that day's
 * connectivity** — see `remedyFor` on why the second must not be stored — so the
 * arm this lands on is deliberately the one that says less. That is the whole
 * value of `endpoint-silent` existing as a separate arm from
 * `endpoint-silent-offline`.
 */
function recordedRemedy(turn: TurnRecord): string | null {
  const failed = (turn.steps ?? []).filter((step) => step.error !== undefined);
  const reason = failed.at(-1)?.error?.reason;
  return reason === undefined ? null : remedySentence(remedyFor({ reason, online: null }));
}

/**
 * ***The turn being written*** — a live region, because its text arrives
 * without the reader doing anything (the accessible-markup habit [work plan
 * §2.1] calls day-one, applied where it actually matters).
 *
 * ***Painted as the chat it will be*** since [P14.5]: under `per-actor`
 * dispatch each speaker's call streams into its own message, named as it
 * opens (`liveMessages`), so the round reads as bubbles while it is written
 * rather than becoming them only when it lands. When the stream cannot say
 * who — a narrator, an older server, a reattach that missed the round's
 * start — it is the joined text, as it always was.
 */
function LiveTurn(props: {
  text: string;
  messages: ReturnType<typeof liveMessages>;
  actors: readonly LibraryObject[];
}): React.JSX.Element | null {
  if (props.messages !== null) {
    return (
      <li aria-live="polite" aria-busy="true" className="flex flex-col gap-3">
        {props.messages.map((message, index) =>
          message.speaker === null ? (
            <p key={index} className="whitespace-pre-wrap text-story font-story text-ink">
              {message.text}
            </p>
          ) : (
            <div key={index} className="flex gap-2">
              <Portrait
                actor={props.actors.find((one) => one.id === message.speaker?.id)}
                name={message.speaker.name}
              />
              <div className="flex min-w-0 flex-1 flex-col gap-1">
                <span className="text-sm font-medium text-ink">{message.speaker.name}</span>
                <p className="whitespace-pre-wrap text-story font-story text-ink">{message.text}</p>
              </div>
            </div>
          ),
        )}
      </li>
    );
  }
  if (props.text.length === 0) return null;
  return (
    <li aria-live="polite" aria-busy="true">
      <p className="whitespace-pre-wrap text-story font-story text-ink">{props.text}</p>
    </li>
  );
}

/**
 * The three sentences the composer's own controls say, each a whole string for
 * the reason every other user-visible sentence here is one ([P11.8]).
 */
const SENDING = 'Sending…';
/** Send's label while a picture is being prepared — the reason it is greyed. */
const PREPARING = 'Preparing picture…';
const AWAITING = 'Waiting for the first words…';
const STOPPING = 'Stopping…';

/**
 * ***Something happens between Send and the first token*** — [polish §11],
 * [F-02], graded at [R10] — and written down before anybody hit it:
 * [P2C brief §3.4] says *"There is no progress, no step display and no
 * spinner"*, and it was accepted deliberately. What turned the acceptance into
 * a defect is that a person walked into it on every turn of four sittings and
 * called it painful.
 *
 * **What a person got until now**: the button did not change, no live region
 * fired, and the composer cleared — so the only evidence the app had received
 * anything was *your own text disappearing*, which is indistinguishable from
 * having lost it.
 *
 * **One wait, not two, because a person is only waiting once.** Internally
 * there are two — the POST, and then the gap between an accepted job and its
 * first delta — but the seam between them is not something anybody is waiting
 * *for*, and two messages a tenth of a second apart is a live region that
 * interrupts itself. The button carries the other fact, that *this control* is
 * busy; the region carries the one a person actually has, that the story has
 * not started yet.
 *
 * **Acknowledgement, not progress**, which is §11's own bar. The server emits
 * ten step events and this page subscribes to none of them; wiring those is a
 * *step display*, a bigger thing with a contract in it. Nothing here claims a
 * progress the server is not reporting.
 */
function StreamStatus({
  status,
  error,
  waiting,
}: {
  status: string;
  error: string | null;
  waiting: boolean;
}): React.JSX.Element | null {
  if (waiting) {
    return (
      <p role="status" className="text-sm text-ink-subtle">
        {AWAITING}
      </p>
    );
  }
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

/**
 * ***The model writes your next message, and you keep authorship*** —
 * [06 §3.1](../../../../docs/design/06-modes-and-turn-pipeline.md), [P11.4].
 *
 * **The text lands in the box and nothing is sent.** §3.1 puts that first and
 * argues for it rather than merely stating it — *"anything else takes authorship
 * away rather than assisting it"* — so this is a control that fills a field, and
 * the person presses Send or does not.
 *
 * ***Re-rolling is pressing it again***, which is §3.1's *"re-rollable without
 * ceremony"* read literally and is what a person dissatisfied with a draft
 * actually does. It replaces what is in the box, which is the behaviour a second
 * press means: somebody who wanted to keep the first draft would have edited it.
 *
 * *A refusal says which of the four things is wrong*, because they point at four
 * different places — the mode, the party, or the bindings.
 */
function Impersonate(props: {
  sessionId: string;
  disabled: boolean;
  onDrafted: (text: string) => void;
}): React.JSX.Element {
  const draft = useMutation({
    mutationFn: () => impersonateAs(props.sessionId),
    onSuccess: (answer) => {
      props.onDrafted(answer.text);
    },
  });

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button
        type="button"
        disabled={props.disabled || draft.isPending}
        onClick={() => {
          draft.mutate();
        }}
      >
        {draft.isPending ? 'Drafting…' : 'Draft my next message'}
      </Button>
      {draft.isError ? (
        <span role="alert" className="text-sm text-warn-ink">
          {impersonateLine(draft.error)}
        </span>
      ) : null}
    </div>
  );
}

/** Whole sentences, one per reason — the catalogue shape [P11.8] will want. */
function impersonateLine(error: unknown): string {
  const code = error instanceof ApiError ? error.code : null;
  if (code === 'not-a-player') {
    return 'You do not author that character, so there is nothing here to draft for.';
  }
  if (code === 'no-prose-step')
    return 'This mode does not write prose, so there is no voice to borrow.';
  if (code === 'role-unbound' || code === 'role-dangling') {
    return 'No connection is set up for the model this needs. Bind one in Settings.';
  }
  if (code === 'window-too-small') return remedySentence('window-too-small') ?? '';
  /**
   * ***The endpoint's failure, in the words a failed turn gets*** (2026-09-27).
   * This was a bare 500 until the route learned to answer it, so every one of
   * a wrong key, a model server that was down and a stall read *try again in a
   * moment*, which is right for one of the three.
   */
  if (code === 'provider-failed' && error instanceof ApiError) {
    return remedySentence(error.remedy ?? null) ?? 'The model endpoint could not write that draft.';
  }
  if (code === 'cancelled') return 'The server stopped before the draft was written. Try again.';
  return 'That draft could not be written. Try again in a moment.';
}

/** The push a turn's director outcome records, shape-guarded; nothing for an unpushed turn. */
function pushOf(turn: TurnRecord): { push?: 'natural' | 'random' } {
  const push: unknown = turn.steps?.find((step) => step.stepId === 'se.scene.direct')?.direction
    ?.push;
  return push === 'natural' || push === 'random' ? { push } : {};
}
