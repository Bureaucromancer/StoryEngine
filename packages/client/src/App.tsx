// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from '@tanstack/react-router';
import type { JSX } from 'react';

import { LoginForm, SetupForm } from './auth/forms.js';
import { queryClient, useAuthState } from './queries.js';
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
        <p className="text-slate-600">Loading…</p>
      </main>
    );
  }

  if (auth.isError) {
    return (
      <main className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center gap-4 p-8 text-center">
        <p role="alert" className="text-red-900">
          The server could not be reached. Check that it is running, then try again.
        </p>
        <button
          type="button"
          onClick={() => {
            void auth.refetch();
          }}
          className="mx-auto rounded-md border border-slate-300 px-4 py-2 text-sm text-slate-700 hover:bg-slate-100"
        >
          Try again
        </button>
      </main>
    );
  }

  if (auth.data.setupRequired) return <SetupForm />;
  if (auth.data.account === null) return <LoginForm />;
  return <RouterProvider router={router} />;
}
