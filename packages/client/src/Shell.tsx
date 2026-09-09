// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { Link, Outlet, useRouterState } from '@tanstack/react-router';
import { useCallback, useEffect, useRef, type JSX } from 'react';

import { BuildFooter } from './about/BuildFooter.js';
import { useAuthState, useLogout, useNotices, usePatchPrefs, usePrefs } from './queries.js';
import { Button } from './ui/Button.js';
import { navLink } from './ui/classes.js';
import { useTheme } from './ui/useTheme.js';
import { workbenchOpenFromPrefs, workbenchOpenPatch } from './workbench/prefs.js';
import { useToggleChord } from './workbench/useToggleChord.js';
import { Workbench } from './workbench/Workbench.js';

/** The signed-in frame: a header with the account and sign-out, and the page. */
export function Shell(): JSX.Element {
  const auth = useAuthState();
  const logout = useLogout();
  const account = auth.data?.account ?? null;
  // Mounted here rather than in the settings page, so a choice made in one tab
  // reaches every other surface — and so signing in applies your theme before
  // you go looking for where to set it.
  useTheme();

  /**
   * The workbench's open state — a preference from this stage on ([P3.1a]),
   * and the prefs *cache* is the state: `usePatchPrefs` is optimistic, so a
   * toggle lands on screen at click speed and the server catches up, exactly
   * the case its docstring exists for. Open survives navigation because the
   * cache does, and survives a reload because the file does — gate step 2's
   * two halves. The accepted cost, from [P3 §1.2]: a reload paints closed for
   * one round-trip before an open dock reappears, which a `localStorage`
   * mirror could hide and deliberately does not — the theme's mirror stays
   * the client's only use of it.
   */
  const prefs = usePrefs();
  const patchPrefs = usePatchPrefs();
  const workbenchOpen = workbenchOpenFromPrefs(prefs.data?.prefs);
  const patchOpen = patchPrefs.mutate;
  const toggleWorkbench = useCallback(() => {
    patchOpen(workbenchOpenPatch(!workbenchOpen));
  }, [patchOpen, workbenchOpen]);
  const closeWorkbench = useCallback(() => {
    patchOpen(workbenchOpenPatch(false));
  }, [patchOpen]);
  useToggleChord(toggleWorkbench);

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
                ([10 §2.2]) — the wordmark is the arrival affordance, and
                arrival is not the library's job. */}
            <Link to="/library" search={{}} className="text-lg font-semibold">
              StoryEngine
            </Link>
            {account === null ? null : <SurfaceNav />}
          </div>
          {account === null ? null : (
            <div className="flex items-center gap-3">
              {/* The workbench's visible opener — a *button*, never a nav
                  entry: the panel is not a place ([10 §3]), and the nav's own
                  docstring below holds that line. `Shell.test.tsx` pins the
                  absence of a workbench *link*; a button keeps that test green
                  by construction, which is correct — do not "fix" the test
                  into matching buttons. The `title` and `aria-keyshortcuts`
                  are how the chord is discoverable from the UI, so the control
                  and the keystroke stay equally first-class. */}
              <Button
                type="button"
                size="compact"
                onClick={toggleWorkbench}
                aria-expanded={workbenchOpen}
                aria-controls={workbenchOpen ? 'workbench' : undefined}
                aria-keyshortcuts="Control+`"
                title="Toggle the workbench (Ctrl+`)"
              >
                Workbench
              </Button>
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
      {/* **Above the outlet, not on the settings page**, because [09 §6.3] wants
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
      {/* The dock row. The aside sits *after* main in source order, which in a
          flex row is the inline end in LTR and RTL alike — the right dock,
          spelled logically. Insetting is free: main is `flex-1`, so an open
          dock narrows it and each page's `mx-auto` column re-centres in what
          remains — [P3 §1.1]'s reading of §3's "expands over" as a claim about
          navigation, not z-order. Closed is unmounted, not hidden: no queries
          run, and the landmark is absent rather than lurking. */}
      <div className="flex min-h-0 flex-1">
        <main ref={mainRef} className="min-w-0 flex-1 overflow-y-auto">
          <Outlet />
        </main>
        {workbenchOpen ? <Workbench onClose={closeWorkbench} /> : null}
      </div>
      {/* Last in the column and outside `<main>`, for the banner's reason: a
          footer that scrolls away with the page is a footer on some pages. The
          dock row above is `min-h-0 flex-1`, so it yields the footer its
          height — and the footer must sit inside the `h-dvh` column, or the
          document would scroll again ([P3.−1]). Under the dock as a whole, so
          an open Workbench does not cover it. */}
      <BuildFooter build={auth.data?.build} />
    </div>
  );
}

/**
 * The two surfaces — [10 §2](../../../docs/design/10-ui-surfaces.md).
 *
 * **Two entries, not three.** The workbench is deliberately absent: it is a
 * panel that expands over whichever surface you are in, not a place to navigate
 * to ([10 §3]), so a nav entry for it would be the layout claim this design
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
      // `aria-current="page"` as well as the colour, because [10 §1.1] wants the
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
 * What is waiting for a restart — [09 §6.3](../../../docs/design/09-server-multiuser-deployment.md),
 * [P2A §2.6](../../../docs/design/workplan/09-p2a-configuration-surface.md).
 *
 * **Named changes rather than "restart required"**, because a bare notice
 * invites people to restart and hope — and the list is computed per request
 * from the config this process started with, so undoing a change clears it
 * rather than leaving a banner nobody can dismiss.
 *
 * **And it says the server will not restart itself.** [09 §6.4] is explicit that
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
