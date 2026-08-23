// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { useState } from 'react';
import { Link } from '@tanstack/react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { createSession, listSessions } from '../api.js';
import { Button } from '../ui/Button.js';
import { link } from '../ui/classes.js';

/**
 * The list of sessions, and the one control that makes a new one.
 *
 * Deliberately the smallest thing that gets somebody to the play surface: no
 * cast picker, no mode picker, no preset picker. A session takes its mode's
 * default and its cast is set through the API — the surfaces for choosing those
 * are P7's, and building thin versions here would be the erosion [P2 §5] warns
 * about, in the stage it warns about it in.
 */
export function SessionsPage(): React.JSX.Element {
  const queryClient = useQueryClient();
  const [name, setName] = useState('');

  const sessions = useQuery({ queryKey: ['sessions'], queryFn: listSessions });
  const create = useMutation({
    mutationFn: () => createSession(name),
    onSuccess: () => {
      setName('');
      void queryClient.invalidateQueries({ queryKey: ['sessions'] });
    },
  });

  return (
    <main className="mx-auto flex max-w-reading flex-col gap-4 p-4">
      <h1 className="text-section text-ink">Sessions</h1>

      <form
        className="flex gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          if (name.trim().length > 0) create.mutate();
        }}
      >
        <label className="flex-1">
          <span className="sr-only">Name for the new session</span>
          <input
            className="w-full rounded-control border border-line-strong bg-surface p-2 text-ink placeholder:text-ink-faint focus-visible:outline-2 focus-visible:outline-focus"
            value={name}
            placeholder="A new session"
            onChange={(event) => {
              setName(event.target.value);
            }}
          />
        </label>
        <Button type="submit" variant="primary">
          Start
        </Button>
      </form>

      <ul className="flex flex-col gap-2" aria-label="Sessions">
        {(sessions.data?.sessions ?? []).map((session) => (
          <li key={session.id}>
            <Link to="/play/$sessionId" params={{ sessionId: session.id }} className={link.object}>
              {session.name}
            </Link>
          </li>
        ))}
      </ul>
    </main>
  );
}
