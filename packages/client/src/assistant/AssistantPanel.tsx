// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { useEffect, useRef, type JSX } from 'react';
import { useRouterState } from '@tanstack/react-router';

import { writeSessionChannel } from '../api.js';
import { labels } from '../i18n/catalogue.js';
import { PlayPage } from '../play/PlayPage.js';
import { AlertNote } from '../ui/Alert.js';
import { Button } from '../ui/Button.js';
import { Note } from '../ui/Text.js';
import { contextFor, sameContext, type AmbientContext } from './context.js';
import { Proposal } from './Proposal.js';
import { useAssistantSession } from './session.js';

/**
 * ***The assistant surface*** —
 * [10 §7](../../../../docs/design/10-ui-surfaces.md),
 * [06 §7.4](../../../../docs/design/06-modes-and-turn-pipeline.md),
 * [P11.3](../../../../docs/design/workplan/28-p11-implementation.md).
 *
 * ***It renders `PlayPage`, and that line is the stage's proof obligation made
 * visible.*** [06 §7.4]: *"If building the assistant requires a parallel chat
 * implementation, something in the mode contract is wrong."* So the panel does
 * not have a message list, a composer, a streaming reader, a reroll or a
 * reconnect — it has **the play surface**, pointed at a session in the assistant
 * mode. Everything in §7.4's table of what applies unchanged is there because it
 * is literally the same component.
 *
 * *`tools/repo-shape.test.ts` holds the same claim from the other side*, which
 * is the version that survives somebody deciding one small copy would be
 * tidier.
 *
 * ***A panel rather than a route*** — [10 §7]: *"summonable from anywhere,
 * including mid-session, without losing your place. A panel rather than a route
 * — the same shape as the workbench (§3), and for the same reason: it acts on
 * what you are looking at, so navigating away from that to reach it is
 * backwards."* So it lives in the shell's dock row beside the workbench, and
 * the page behind it does not move.
 *
 * ***The ambient context is written as a channel effect, from here.*** §7.4:
 * *"That context is a block the client contributes, and it must be visible in
 * the turn record like any other block. An assistant that silently knows what is
 * on your screen is unsettling; one that shows you it knows is useful."* Writing
 * a channel is what *the client contributes a block* means in this build — the
 * pack positions `se.assistant.context`, the assembler renders it, and the
 * workbench shows it in the block table beside everything else. **No new
 * machinery, which is what §7.4 predicted.**
 */

const WORDS = labels('assistant.panel', {
  heading: 'Assistant',
  close: 'Close',
  start: 'Start a conversation',
  starting: 'Starting…',
  loading: 'Looking for your assistant…',
  failed: 'Your sessions could not be read, so the assistant cannot open.',
  startFailed: 'The assistant could not be started.',
  blurb:
    'Ask about the app or about your own library — what a setting does, why a lorebook entry never fires, what to put in a character.',
  seeing: 'It can see:',
  seeingNothing: 'It cannot see any particular object from here.',
});

export function AssistantPanel(props: { onClose: () => void }): JSX.Element {
  const { sessionId, pending, failed, start, starting, startError } = useAssistantSession(true);
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const seen = contextFor(pathname);
  useDisclosedContext(sessionId, seen);

  return (
    <aside
      className="flex w-full max-w-md min-w-0 flex-col border-s border-line bg-surface"
      aria-label={WORDS.heading}
    >
      <div className="flex items-center justify-between gap-2 border-b border-line px-4 py-2">
        <h2 className="text-section text-ink">{WORDS.heading}</h2>
        <Button type="button" size="compact" onClick={props.onClose}>
          {WORDS.close}
        </Button>
      </div>

      {/*
       * ***The disclosure, on screen and not only in the record*** — [10 §7]:
       * *"Show what it can see. The ambient context — which actor is open, which
       * session you came from — belongs on screen, not just in the turn
       * record."* Both, then: this line, and the block the pack positions.
       */}
      <p className="border-b border-line px-4 py-2 text-sm text-ink-subtle">
        {seen === null
          ? WORDS.seeingNothing
          : `${WORDS.seeing} ${seen.name ?? seen.id} — ${seen.where}.`}
      </p>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
        {sessionId !== null ? (
          <>
            {/* ***Above the transcript, not inside it*** — [10 §7]: a proposal
                is *"reviewed and applied explicitly"*, which is a thing to do
                rather than a thing that scrolled past. The play surface below is
                the conversation and knows nothing about this. */}
            <Proposal sessionId={sessionId} />
            <PlayPage sessionId={sessionId} starters={STARTERS} />
          </>
        ) : pending ? (
          <Note>{WORDS.loading}</Note>
        ) : failed ? (
          <p role="alert">{WORDS.failed}</p>
        ) : (
          <div className="flex flex-col gap-3">
            <Note>{WORDS.blurb}</Note>
            <Button type="button" variant="primary" disabled={starting} onClick={start}>
              {starting ? WORDS.starting : WORDS.start}
            </Button>
            {startError === null ? null : (
              <AlertNote role="alert">{`${WORDS.startFailed} ${startError.message}`}</AlertNote>
            )}
          </div>
        )}
      </div>
    </aside>
  );
}

/**
 * ***Marinara's suggestion chips*** — [06 §7.4]'s *starter prompts*, [10 §7].
 *
 * *"The gap between a blank input and knowing what to ask is most of why in-app
 * assistants go unused."* Four, and each names something this build can actually
 * answer about — a prompt that produced *I cannot do that* would be worse than
 * no prompt, because the chip is a promise the app made first.
 */
const STARTERS: readonly string[] = [
  'Why is my lorebook entry never firing?',
  'What does the context meter mean when it says nothing is bound?',
  'Help me write a summary for the character I have open.',
  'What is the difference between a treatment and a setup?',
];

/**
 * Keeps `se.assistant.context` in step with the address.
 *
 * ***Written only when it changes***, because a channel write is an effect and
 * an effect is carried by a turn: re-writing the same context on every
 * navigation within one object would put a line in the record each time somebody
 * switched tabs. `sameContext` is the whole reason that comparison is a named
 * function rather than an inline `!==`.
 *
 * *It swallows a failure.* The assistant with a stale idea of what you are
 * looking at is a worse assistant; the assistant that refused to open because a
 * disclosure did not land would be a broken one, which is [00 §3.3]'s line.
 */
function useDisclosedContext(sessionId: string | null, seen: AmbientContext | null): void {
  const last = useRef<AmbientContext | null>(null);
  const wrote = useRef<string | null>(null);

  useEffect(() => {
    if (sessionId === null) return;
    // A new session has disclosed nothing yet, whatever this hook last sent to
    // the old one.
    if (wrote.current !== sessionId) last.current = null;
    if (sameContext(last.current, seen)) return;
    last.current = seen;
    wrote.current = sessionId;
    void writeSessionChannel(sessionId, 'se.assistant.context', seen).catch(() => undefined);
  }, [sessionId, seen]);
}
