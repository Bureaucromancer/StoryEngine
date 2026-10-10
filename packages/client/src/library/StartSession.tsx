// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { Link, useNavigate } from '@tanstack/react-router';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { JSX } from 'react';

import { createSession } from '../api.js';
import { Alert } from '../ui/Alert.js';
import { Button } from '../ui/Button.js';
import { link } from '../ui/classes.js';

/**
 * ***Start a session from this Setup*** — [04 §7](../../../../docs/design/04-schemas.md),
 * [P15.4](../../../../docs/design/workplan/33-p15-setup-from-a-turn.md).
 *
 * **The browser could not do this until now.** `POST /api/sessions` has taken a
 * Setup since [P7.4], and nothing in the client sent one — so a Setup was a
 * library object you could make, open and edit, and never play. [10 §2.2] puts
 * *a Setup above all* at the head of what somebody starts from; this is the
 * button that makes a Setup's own page that place.
 *
 * **Straight into the session**, because that is the whole of the act: the
 * Setup already says everything a session needs, including the opening it
 * begins on, so a form in between would ask somebody to confirm what they had
 * just chosen. The session form on the Play page is where a Setup is started
 * *with changes*.
 *
 * *Used in two places for one reason*: a Setup's library page, and the end of
 * *make a setup from here*, where the next thing somebody does with a point
 * they just saved is start from it.
 */
export function StartSession(props: {
  setupId: string;
  label?: string;
  className?: string;
}): JSX.Element {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const start = useMutation({
    mutationFn: () => createSession({ setup: props.setupId }),
    onSuccess: async (created) => {
      void queryClient.invalidateQueries({ queryKey: ['sessions'] });
      await navigate({ to: '/play/$sessionId', params: { sessionId: created.session.id } });
    },
  });

  return (
    <>
      <Button
        type="button"
        variant="primary"
        disabled={start.isPending}
        onClick={() => {
          start.mutate();
        }}
        {...(props.className === undefined ? {} : { className: props.className })}
      >
        {props.label ?? 'Start a session'}
      </Button>
      {start.isError ? (
        <Alert tone="error" role="alert">
          {start.error.message}
        </Alert>
      ) : null}
    </>
  );
}

/**
 * ***Start a session in this world*** — [P16.2](../../../../docs/design/workplan/35-p16-world.md),
 * [P16 §1.3](../../../../docs/design/workplan/35-p16-world.md),
 * [15 §5.3](../../../../docs/design/15-world.md).
 *
 * **`StartSession`'s shape, for its reason**: straight into the session, since
 * the World already says which books and treatment it brings and a form in
 * between would ask somebody to confirm what they had just chosen. The route
 * does the contribution — the World's lorebook members copied into
 * `session.lore`, its treatment when it holds exactly one, the session added to
 * its `contents` — and every part of it lands as the session's own data, on
 * disk and editable from its lore panel ([00 §3.1]: prefill, never binding).
 *
 * ***Choose first…*** is the quieter way in, for somebody who wants to see or
 * change that before it starts — the session form with this World chosen and
 * its contribution filled in as ordinary ticks and a select. It is a link
 * because it is a navigation (`link.action`'s argument), and quiet because
 * the button is the act the page is for.
 *
 * **The library is invalidated as well as the sessions**: the World's
 * `contents` gained a member, so its own page, its row on the shelf, and the
 * *In these worlds* line of the session it made are all reading a World that
 * changed.
 */
export function StartInWorld(props: { worldId: string }): JSX.Element {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const start = useMutation({
    mutationFn: () => createSession({ world: props.worldId }),
    onSuccess: async (created) => {
      void queryClient.invalidateQueries({ queryKey: ['sessions'] });
      void queryClient.invalidateQueries({ queryKey: ['library'] });
      await navigate({ to: '/play/$sessionId', params: { sessionId: created.session.id } });
    },
  });

  return (
    <>
      <Button
        type="button"
        variant="primary"
        disabled={start.isPending}
        onClick={() => {
          start.mutate();
        }}
      >
        Start a session in this world
      </Button>
      <Link to="/play" search={{ world: props.worldId }} className={link.inline}>
        Choose first…
      </Link>
      {start.isError ? (
        <Alert tone="error" role="alert">
          {start.error.message}
        </Alert>
      ) : null}
    </>
  );
}
