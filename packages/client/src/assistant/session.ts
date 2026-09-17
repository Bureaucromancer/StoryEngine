// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { createSession, listSessions, type SessionSummary } from '../api.js';

/**
 * ***One assistant session, found or made*** —
 * [06 §7.4](../../../../docs/design/06-modes-and-turn-pipeline.md),
 * [10 §7](../../../../docs/design/10-ui-surfaces.md),
 * [P11.3](../../../../docs/design/workplan/28-p11-implementation.md).
 *
 * §7.4's whole design is *"a session, in a mode, with an actor card"*, so
 * summoning the assistant is **creating a session** — and everything the panel
 * then does is what a session already does. This file is the entire difference
 * between the assistant and a story: which mode id, and which card.
 *
 * ***Found before made, and the search is the mode rather than the name.*** A
 * session's name is the person's to change ([10 §2]), so matching on *Assistant*
 * would make renaming it produce a second one. The mode is a fact about what the
 * session **is**.
 *
 * ***One, not one per visit.*** [10 §7] wants the assistant *"summonable from
 * anywhere, including mid-session, without losing your place"*, and a new
 * session per summon would make the conversation you had this morning something
 * you have to go and find. **A new one is still available** — it is the *New
 * conversation* control on the panel, which archives the old one rather than
 * deleting it, because a transcript of somebody working out why their lorebook
 * never fired is worth what any other session is worth.
 */

export const ASSISTANT_MODE_ID = 'storyengine.assistant';

/** The shipped card's id — `assistant-card.ts`, and stable for the same reason. */
export const ASSISTANT_CARD_ID = '0199c000-0000-7000-8000-00000000a552';

/**
 * ***The shipped help book's id*** — `docs-lorebook.ts`,
 * [06 §7.4](../../../../docs/design/06-modes-and-turn-pipeline.md).
 *
 * §7.4: *"Ship the documentation as a built-in lorebook and attach it to the
 * assistant. Keyword activation plus the budgeter already do the work."*
 * **This is the attaching**, and it is one line of an ordinary session's
 * ordinary `lore` links — which is the whole of what *needs no new machinery*
 * turned out to mean.
 */
export const DOCS_LOREBOOK_ID = '0199c000-0000-7000-8000-00000000d0c5';

/** The live assistant session, or null when there has never been one. */
export function assistantSessionIn(sessions: readonly SessionSummary[]): SessionSummary | null {
  return (
    sessions.find(
      (session) => session.mode?.id === ASSISTANT_MODE_ID && session.archivedAt === undefined,
    ) ?? null
  );
}

export function useAssistantSession(enabled: boolean): {
  sessionId: string | null;
  pending: boolean;
  failed: boolean;
  start: () => void;
  starting: boolean;
} {
  const client = useQueryClient();
  const sessions = useQuery({
    queryKey: ['sessions'],
    queryFn: listSessions,
    enabled,
  });

  const create = useMutation({
    mutationFn: () =>
      createSession({
        name: 'Assistant',
        mode: ASSISTANT_MODE_ID,
        /**
         * ***The card is the actor, and the person is nobody.*** [06 §8]'s
         * persona is *who the player is*, and a person asking how a preset works
         * is not playing a character. So the cast is one actor and no persona,
         * which is also what `participants: { select: 'fixed', maxActors: 1 }`
         * declares the mode expects.
         */
        cast: { persona: null, actors: [ASSISTANT_CARD_ID] },
        /**
         * ***The help book, selected for this session*** — [06 §7.4].
         *
         * **Selected rather than global**, because no lorebook is active that
         * has not been selected for the session: a book's own `scope` is read by
         * nothing, and this line is the only reason the assistant can retrieve
         * anything at all.
         *
         * *Only on a session this makes.* An assistant session somebody started
         * before this shipped does not get it retroactively, and adding it to
         * one would be reaching into a session's own configuration behind their
         * back — the book is in the library, and attaching it is a control on
         * the session panel like it is for any other book.
         */
        lore: [DOCS_LOREBOOK_ID],
      }),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ['sessions'] });
    },
  });

  const found = sessions.data ? assistantSessionIn(sessions.data.sessions) : null;

  return {
    sessionId: found?.id ?? null,
    pending: sessions.isPending,
    failed: sessions.isError,
    start: () => {
      create.mutate();
    },
    starting: create.isPending,
  };
}
