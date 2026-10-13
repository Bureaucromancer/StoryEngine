// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { Link, useNavigate } from '@tanstack/react-router';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState, type JSX } from 'react';

import type { UnmetRequirement } from '@storyengine/shared';

import { createSession } from '../api.js';
import { StartAnyway, unmetOf } from '../play/StartAnyway.js';
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
 *
 * ***And a Setup for a mode this install lacks is asked about, not refused***
 * (2026-10-13, the owner's *build the promise*): the route answers
 * `unmet-requirements`, and the dialog says what it would start without —
 * **Start anyway** sends the same request with `degraded: true`, **Cancel**
 * sends nothing (`StartAnyway.tsx`). Until then this showed the server's
 * *No such mode.* raw, and there was nothing to do about it.
 */
export function StartSession(props: {
  setupId: string;
  label?: string;
  className?: string;
}): JSX.Element {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [unmet, setUnmet] = useState<UnmetRequirement[] | null>(null);
  const start = useMutation({
    mutationFn: (degraded: boolean) =>
      createSession({ setup: props.setupId, ...(degraded ? { degraded: true } : {}) }),
    onSuccess: async (created) => {
      void queryClient.invalidateQueries({ queryKey: ['sessions'] });
      await navigate({ to: '/play/$sessionId', params: { sessionId: created.session.id } });
    },
    onError: (error) => {
      setUnmet(unmetOf(error));
    },
  });

  return (
    <>
      <Button
        type="button"
        variant="primary"
        disabled={start.isPending}
        onClick={() => {
          start.mutate(false);
        }}
        {...(props.className === undefined ? {} : { className: props.className })}
      >
        {props.label ?? 'Start a session'}
      </Button>
      {start.isError && unmetOf(start.error) === null ? (
        <Alert tone="error" role="alert">
          {start.error.message}
        </Alert>
      ) : null}
      {unmet === null ? null : (
        <StartAnyway
          unmet={unmet}
          busy={start.isPending}
          onStart={() => {
            setUnmet(null);
            start.mutate(true);
          }}
          onCancel={() => {
            setUnmet(null);
            start.reset();
          }}
        />
      )}
    </>
  );
}

/**
 * ***Start a session in this world*** — [P16.2](../../../../docs/design/workplan/34-p16-world.md),
 * [P16 §1.3](../../../../docs/design/workplan/34-p16-world.md),
 * [15 §5.3](../../../../docs/design/15-world.md).
 *
 * **`StartSession`'s shape, for its reason**: straight into the session, since
 * the World already says which books and treatment it brings and a form in
 * between would ask somebody to confirm what they had just chosen. The route
 * does the contribution — the World's lorebook members copied into
 * `session.lore`, then every book whose own scope names the World (the `world`
 * arm, [26 B16]), its treatment when it holds exactly one, the session added to
 * its `contents` — and every part of it lands as the session's own data, on
 * disk and editable from its lore panel ([00 §3.1]: prefill, never binding).
 *
 * ***And its Setup, when it holds exactly one*** — **the owner's answer of
 * 2026-10-12**, *"Use the World's Setup when it holds exactly one"*
 * ([04 §9](../../../../docs/design/04-schemas.md),
 * [03 §7.2](../../../../docs/design/03-data-model.md): a World is started
 * *through* its Setup). This still sends `{ world }` and nothing else, and the
 * route supplies the Setup — its mode, opening, cast, preset, hooks and goals,
 * as if it had been named — with the World's books and treatment layered under
 * it as under any Setup. The paragraph above's reason — the World already says
 * what it brings, so a form in between asks for a confirmation — holds the
 * more for it: a World with one Setup says how to begin, too. Two or more
 * choose none, and a sole Setup the library no longer holds is started
 * without — the World's page lists it *Missing* among its members, above this
 * button, which is where that is seen.
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
 *
 * ***A World that wants what this install lacks is asked about*** (2026-10-13)
 * — its authored `requires`, or its Setup's mode — exactly as `StartSession`
 * asks, through the same dialog.
 */
export function StartInWorld(props: { worldId: string }): JSX.Element {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [unmet, setUnmet] = useState<UnmetRequirement[] | null>(null);
  const start = useMutation({
    mutationFn: (degraded: boolean) =>
      createSession({ world: props.worldId, ...(degraded ? { degraded: true } : {}) }),
    onSuccess: async (created) => {
      void queryClient.invalidateQueries({ queryKey: ['sessions'] });
      void queryClient.invalidateQueries({ queryKey: ['library'] });
      await navigate({ to: '/play/$sessionId', params: { sessionId: created.session.id } });
    },
    onError: (error) => {
      setUnmet(unmetOf(error));
    },
  });

  return (
    <>
      <Button
        type="button"
        variant="primary"
        disabled={start.isPending}
        onClick={() => {
          start.mutate(false);
        }}
      >
        Start a session in this world
      </Button>
      <Link to="/play" search={{ world: props.worldId }} className={link.inline}>
        Choose first…
      </Link>
      {start.isError && unmetOf(start.error) === null ? (
        <Alert tone="error" role="alert">
          {start.error.message}
        </Alert>
      ) : null}
      {unmet === null ? null : (
        <StartAnyway
          unmet={unmet}
          busy={start.isPending}
          onStart={() => {
            setUnmet(null);
            start.mutate(true);
          }}
          onCancel={() => {
            setUnmet(null);
            start.reset();
          }}
        />
      )}
    </>
  );
}
