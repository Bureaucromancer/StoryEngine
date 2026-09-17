// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from '@tanstack/react-router';
import type { JSX, ReactNode } from 'react';

import { BuildFooter } from './about/BuildFooter.js';
import type { BuildInfo } from './api.js';
import { LoginForm, SetupForm } from './auth/forms.js';
import { Gallery } from './auth/Gallery.js';
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
      <Frame build={undefined}>
        <main className="mx-auto w-full max-w-sm flex-1 p-8 text-center">
          <p className="text-ink-subtle">Loading…</p>
        </main>
      </Frame>
    );
  }

  if (auth.isError) {
    return (
      <Frame build={undefined}>
        <main className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center gap-4 p-8 text-center">
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
      </Frame>
    );
  }

  // Passed rather than fetched again: `Gate` already holds the state, and a
  // prop keeps `forms.tsx` free of a query dependency.
  if (auth.data.setupRequired) {
    return (
      <Frame build={auth.data.build}>
        <SetupForm
          minPasswordLength={auth.data.minPasswordLength}
          tokenRequired={auth.data.setupTokenRequired}
        />
      </Frame>
    );
  }
  if (auth.data.account === null) {
    return (
      <Frame build={auth.data.build}>
        {/*
          ***The install's choice, made once by an admin, never the visitor's***
          — [12 §1.1], [P10.4]. An arrival screen chosen per browser would
          defeat the point of an install having chosen one at all, which is why
          this reads the server's answer rather than a preference: there is no
          session to have preferences in, and the person arriving is nobody yet.

          The gallery falls through to `LoginForm` for *sign in by name*, so the
          form is the floor under both doors rather than the other branch.
        */}
        {auth.data.loginScreen === 'gallery' ? <Gallery /> : <LoginForm />}
      </Frame>
    );
  }
  return <RouterProvider router={router} />;
}

/**
 * The frame the pages before sign-in share: the page, and the build line under
 * it — *every page* includes these two ([P6A §1.5], alpha.2). The Shell mounts
 * the same footer inside its own `h-dvh` column, which is why this is not
 * hoisted into `App`: the Shell's height is documented as its own claim
 * ([P3.−1]), and both shell test files render it without `App`. Loading and
 * unreachable pass `undefined` — nothing is known yet — and the footer renders
 * nothing; the page takes the rest of the column, so the footer rests at the
 * viewport's foot rather than under a short form.
 */
function Frame(props: { build: BuildInfo | null | undefined; children: ReactNode }): JSX.Element {
  return (
    <div className="flex min-h-dvh flex-col">
      {props.children}
      <BuildFooter build={props.build} />
    </div>
  );
}
