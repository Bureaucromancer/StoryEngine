// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { useNavigate } from '@tanstack/react-router';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { JSX } from 'react';

import { createSession } from '../api.js';
import { Alert } from '../ui/Alert.js';
import { Button } from '../ui/Button.js';

/**
 * ***Start a session from this Setup*** — [04 §7](../../../../docs/design/04-schemas.md),
 * [P13.4](../../../../docs/design/workplan/30-p13-implementation.md).
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
