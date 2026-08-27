// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { Link, Outlet, useRouterState } from '@tanstack/react-router';
import { useEffect, useRef, type JSX } from 'react';

import { useAuthState, useLogout, useNotices } from './queries.js';
import { Button } from './ui/Button.js';
import { navLink } from './ui/classes.js';
import { useTheme } from './ui/useTheme.js';

/** The signed-in frame: a header with the account and sign-out, and the page. */
export function Shell(): JSX.Element {
  const auth = useAuthState();
  const logout = useLogout();
  const account = auth.data?.account ?? null;
  // Mounted here rather than in the settings page, so a choice made in one tab
  // reaches every other surface — and so signing in applies your theme before
  // you go looking for where to set it.
  useTheme();

  const mainRef = useRef<HTMLElement | null>(null);
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  /**
   * Every page starts at its top, by hand.
   *
   * Two native mechanisms stopped applying when the shell became
   * height-managed ([P3.−1]): the browser restored the *document*'s scroll
   * position, and the router's default reset targets the window — and the
   * window no longer scrolls, `<main>` does. This is the minimal honest
   * replacement. Keyed on the pathname rather than the whole location, so the
   * library's kind-filter clicks — a search param — keep their place. What is
   * lost, on purpose: Back no longer returns you to an old list position. The
   * upgrade when a surface earns it is the router's element scroll
   * restoration; until a list outgrows a couple of screens, that is machinery
   * for a problem this app does not have.
   */
  useEffect(() => {
    if (mainRef.current !== null) mainRef.current.scrollTop = 0;
  }, [pathname]);

  return (
    // `h-dvh`, not `min-h-dvh`: the shell claims the viewport, which is what
    // lets `flex-1` below mean "the rest of it" and makes `<main>` the scroll
    // container instead of the document ([P3.−1]).
    <div className="flex h-dvh flex-col">
      <header className="border-b border-line bg-surface">
        <div className="mx-auto flex max-w-4xl items-center justify-between gap-4 px-6 py-3">
          <div className="flex items-center gap-4">
            {/* Goes to the library for now. It becomes home once home exists
                ([05 §2.2]) — the wordmark is the arrival affordance, and
                arrival is not the library's job. */}
            <Link to="/library" search={{}} className="text-lg font-semibold">
              StoryEngine
            </Link>
            {account === null ? null : <SurfaceNav />}
          </div>
          {account === null ? null : (
            <div className="flex items-center gap-3">
              {/* One entry, which is all [P2A §3] asks for. */}
              <Link to="/settings" className="text-sm text-ink-muted hover:underline">
                Settings
              </Link>
              <span className="text-sm text-ink-subtle">{account.displayName}</span>
              <Button
                type="button"
                size="compact"
                onClick={() => {
                  logout.mutate();
                }}
                disabled={logout.isPending}
              >
                Sign out
              </Button>
            </div>
          )}
        </div>
      </header>
      {/* **Above the outlet, not on the settings page**, because [04 §6.3] wants
          this on every page: the person who needs to know a restart is
          outstanding is often not the person who is looking at the form. And
          outside the scroll container, for the same reason — a banner that
          scrolls away with the page is a banner on some pages. */}
      <RestartBanner isAdmin={account?.role === 'admin'} />
      {/* The scroll container, and deliberately bare: no width, no padding, no
          wrapper. Each page owns its column through the `page` recipes in
          `ui/classes.ts` — one spelling per width — because the column must be
          this element's *direct child* for Play's `h-full` to resolve: a
          percentage needs a definite height, and an auto-height centering
          wrapper in between is exactly how the transcript never scrolled
          ([P3.−1]). This stage's first draft had such a wrapper hold
          `min-h-full` with Play's column as `flex-1` on a zero basis,
          expecting a zero intrinsic contribution; measured in a real browser,
          a `flex: 1 1 0` item contributes its full content height to an
          auto-height container — the spec unclamps the contribution when an
          item is both growable and shrinkable — so the wrapper grew with the
          column and main scrolled anyway. */}
      <main ref={mainRef} className="min-h-0 flex-1 overflow-y-auto">
        <Outlet />
      </main>
    </div>
  );
}

/**
 * The two surfaces — [05 §2](../../../docs/design/05-ui-surfaces.md).
 *
 * **Two entries, not three.** The workbench is deliberately absent: it is a
 * panel that expands over whichever surface you are in, not a place to navigate
 * to ([05 §3]), so a nav entry for it would be the layout claim this design
 * dropped. Settings stays on the right with the account, where a preference
 * surface belongs rather than beside the things you work in.
 *
 * `activeProps` rather than a `useMatchRoute` comparison: the router already
 * knows, and `activeOptions.exact` is off so `/play/$sessionId` keeps Play lit
 * while you are in a session.
 */
function SurfaceNav(): JSX.Element {
  return (
    <nav aria-label="Surfaces" className="flex items-center gap-1">
      <SurfaceLink to="/play" label="Play" />
      <SurfaceLink to="/library" label="Library" />
    </nav>
  );
}

function SurfaceLink(props: { to: '/play' | '/library'; label: string }): JSX.Element {
  return (
    <Link
      to={props.to}
      search={{}}
      // `aria-current="page"` as well as the colour, because [05 §1.1] wants the
      // second channel to never be the only one — and here the first channel is
      // colour, which a screen reader does not have.
      //
      // The classes travel through `activeProps` rather than `className`, which
      // is why they went unchecked by the physical-utility rule until it stopped
      // being anchored on the attribute name.
      activeProps={{
        className: `${navLink.base} ${navLink.active} font-medium`,
        'aria-current': 'page',
      }}
      inactiveProps={{ className: `${navLink.base} ${navLink.idle}` }}
      activeOptions={{ exact: false }}
    >
      {props.label}
    </Link>
  );
}
/**
 * What is waiting for a restart — [04 §6.3](../../../docs/design/04-server-multiuser-deployment.md),
 * [P2A §2.6](../../../docs/design/workplan/13-p2a-configuration-surface.md).
 *
 * **Named changes rather than "restart required"**, because a bare notice
 * invites people to restart and hope — and the list is computed per request
 * from the config this process started with, so undoing a change clears it
 * rather than leaving a banner nobody can dismiss.
 *
 * **And it says the server will not restart itself.** [04 §6.4] is explicit that
 * under no supervisor a restart control leaves the administrator with no server
 * and possibly no shell, so it needs supervisor detection and a drain, neither
 * of which exists. A notice that invites *"so how do I restart it?"* is a worse
 * answer than one that says.
 *
 * The query is disabled for a non-admin, so their browser never asks — the same
 * absent-rather-than-disabled mechanism the settings page uses.
 */
function RestartBanner({ isAdmin }: { isAdmin: boolean }): JSX.Element | null {
  const notices = useNotices(isAdmin);
  const pending = notices.data?.pendingRestart ?? [];
  if (!isAdmin || pending.length === 0) return null;

  return (
    <div role="status" className="border-b border-warn-line bg-warn-surface px-6 py-2 text-sm">
      <p className="mx-auto max-w-4xl text-warn-ink">
        Waiting for a restart: <strong>{pending.join(', ')}</strong>. StoryEngine does not restart
        itself — stop and start the server however you run it, and these will take effect.
      </p>
    </div>
  );
}
