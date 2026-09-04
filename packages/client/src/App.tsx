// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from '@tanstack/react-router';
import type { JSX } from 'react';

import { LoginForm, SetupForm } from './auth/forms.js';
import { queryClient, useAuthState } from './queries.js';
import { Button } from './ui/Button.js';
import { router } from './router.js';

/**
 * The gate before the app: `GET /api/auth/state` decides between first-run
 * setup, login, and the library (docs/api.md). The router only mounts once
 * someone is signed in — there are no routes worth addressing before that.
 */
export function App(): JSX.Element {
  return (
    <QueryClientProvider client={queryClient}>
      <Gate />
    </QueryClientProvider>
  );
}

function Gate(): JSX.Element {
  const auth = useAuthState();

  if (auth.isPending) {
    return (
      <main className="mx-auto max-w-sm p-8 text-center">
        <p className="text-ink-subtle">Loading…</p>
      </main>
    );
  }

  if (auth.isError) {
    return (
      <main className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center gap-4 p-8 text-center">
        <p role="alert" className="text-danger-ink">
          The server could not be reached. Check that it is running, then try again.
        </p>
        <Button
          type="button"
          onClick={() => {
            void auth.refetch();
          }}
          className="mx-auto"
        >
          Try again
        </Button>
      </main>
    );
  }

  // Passed rather than fetched again: `Gate` already holds the state, and a
  // prop keeps `forms.tsx` free of a query dependency.
  if (auth.data.setupRequired) {
    return (
      <SetupForm
        minPasswordLength={auth.data.minPasswordLength}
        tokenRequired={auth.data.setupTokenRequired}
      />
    );
  }
  if (auth.data.account === null) return <LoginForm />;
  return <RouterProvider router={router} />;
}
