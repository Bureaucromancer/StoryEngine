// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { useQueryClient } from '@tanstack/react-query';
import { Link, Outlet, useRouterState } from '@tanstack/react-router';
import { useCallback, useEffect, useRef, useState, type JSX } from 'react';

import { BuildFooter } from './about/BuildFooter.js';
import { useSessionEnded } from './auth/session-ended.js';
import { NotificationBell } from './notifications/NotificationBell.js';
import { NotificationToast } from './notifications/NotificationToast.js';
import { useNotifications } from './notifications/useNotifications.js';
import {
  useAuthState,
  useLogout,
  useNotices,
  usePatchPrefs,
  usePrefs,
  useRestart,
} from './queries.js';
import { Button } from './ui/Button.js';
import { navLink } from './ui/classes.js';
import { Dialog } from './ui/Dialog.js';
import { useTheme } from './ui/useTheme.js';
import { useLocale } from './i18n/useLocale.js';
import { workbenchOpenFromPrefs, workbenchOpenPatch } from './workbench/prefs.js';
import { useToggleChord } from './workbench/useToggleChord.js';
import { AssistantPanel } from './assistant/AssistantPanel.js';
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
  // The same argument, for the same reason, one field along: the account's
  // locale decides which catalogue the label tables read through, and the
  // shell is the only component that is always present and present once.
  useLocale(account?.locale);

  /**
   * ***The assistant's open state, and it is `useState` where the workbench's is
   * a preference*** — [10 §7], [P11.3].
   *
   * The workbench is a **mode of working**: somebody debugging their preset
   * wants it open on the next page and after a reload, which is what [P3 §1.2]
   * spends a preference on. The assistant is something you **summon** — §7's own
   * word — for a question, and a panel that reopened itself every morning would
   * be an assistant that had decided it lived there. *A smaller mechanism for a
   * smaller claim, rather than the same one for symmetry.*
   */
  const [assistantOpen, setAssistantOpen] = useState(false);
  const closeAssistant = useCallback(() => {
    setAssistantOpen(false);
  }, []);

  /**
   * ***Mounted once, here, and that is the whole reason it is a shell
   * concern*** — [09 §3.6], [P10.2]. Four surfaces render one fact (a sound, a
   * toast, the unread badge, the tab title), and a second mount would open a
   * second stream and chime twice. The shell is the only component that is
   * always present and present only once.
   *
   * *Disabled when signed out*, which is the same absent-rather-than-disabled
   * mechanism `RestartBanner` uses for a non-admin: a signed-out browser never
   * opens the stream, rather than opening one that answers 401 and retries.
   */
  const notifications = useNotifications(account?.handle ?? null);

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
  const hash = useRouterState({ select: (state) => state.location.hash });
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
   *
   * ***Except an address that names a place in the page*** (2026-10-07). A
   * hash — `/settings#trash-section` — is the page saying where to be, and the
   * page goes there in an effect of its own (`settings/contents.tsx`). React
   * runs a child's effects before its parent's, so this reset ran *after* the
   * jump and undid it whenever the path changed with the hash: a link from
   * another page, a reload, a pasted address. Same-page jumps never change the
   * path, which is how they hid it. So the top is for addresses with no hash;
   * keyed on the hash as well, so leaving one on the same page (`/settings`
   * again from the header) comes back to the top.
   */
  useEffect(() => {
    if (hash === '' && mainRef.current !== null) mainRef.current.scrollTop = 0;
  }, [pathname, hash]);

  return (
    // `h-dvh`, not `min-h-dvh`: the shell claims the viewport, which is what
    // lets `flex-1` below mean "the rest of it" and makes `<main>` the scroll
    // container instead of the document ([P3.−1]).
    <div className="flex h-dvh flex-col print:block print:h-auto">
      {/* ***A way past the header*** (2026-10-01, polish 11). Nine controls
          sit above every page once somebody is signed in — the wordmark, the
          three surfaces, the two panels, the bell, Settings and Sign out — so
          a keyboard reached the page's own first control on the tenth press
          of Tab, on every page, every time. The first stop is now this,
          hidden until it has the keyboard; it hands the keyboard to `<main>`,
          from where Tab goes on into the page.

          *Focused by hand rather than followed as a fragment*: `#main` is
          what it says with scripts off, but a fragment navigation is the
          router's to see, and whether a browser moves focus to the target of
          one has varied — the scroll moved and the keyboard stayed behind.
          `main` takes `tabIndex={-1}` so it can be focused without becoming
          a Tab stop of its own. */}
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:start-3 focus:top-3 focus:z-50 focus:rounded-control focus:bg-surface focus:px-3 focus:py-2 focus:text-sm focus:text-ink focus:outline-2 focus:outline-focus print:hidden"
        onClick={(event) => {
          event.preventDefault();
          mainRef.current?.focus();
        }}
      >
        Skip to the page
      </a>
      <header className="border-b border-line bg-surface">
        {/* **It folds.** Eight controls in one row on every page of the app,
            and nothing let them wrap — so a narrow window pushed Sign out past
            the edge, and a long display name did it on a wide one. [10 §1]
            asks for responsive down to a phone; this is the row that is on
            every screen, so it is the one that pays first. */}
        <div className="mx-auto flex max-w-4xl flex-wrap items-center justify-between gap-4 px-6 py-3">
          <div className="flex items-center gap-4">
            {/* ~~Goes to the library for now. It becomes home once home exists
                ([10 §2.2]) — the wordmark is the arrival affordance, and
                arrival is not the library's job.~~ ***It does*** — [P7B.9].
                The page behind it is a prototype and the sentence above is why
                it is the wordmark's destination anyway: arrival being the
                library's job was the thing to stop, and a home with one section
                on it stops that as completely as a home with four. */}
            <Link to="/" className="text-lg font-semibold">
              StoryEngine
            </Link>
            {account === null ? null : <SurfaceNav />}
          </div>
          {account === null ? null : (
            <div className="flex flex-wrap items-center gap-3">
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
              {/* ***Summonable from anywhere*** — [10 §7], [P11.3]. A button
                  beside the workbench's and for the same reason its own comment
                  gives: the panel is not a place, so it is not a nav entry. */}
              <Button
                type="button"
                size="compact"
                onClick={() => {
                  setAssistantOpen((was) => !was);
                }}
                aria-expanded={assistantOpen}
                title="Ask the assistant"
              >
                Assistant
              </Button>
              <NotificationBell state={notifications} locale={account.locale ?? undefined} />
              {/* One entry, which is all [P2A §3] asks for — **drawn as the
                  surfaces' entries are** (2026-10-01). It was a bare link with
                  no current state, so Settings was the one place in the app
                  where nothing in the header said where you were, and the only
                  link in it with no focus ring. Its place stays with the
                  account; its look is `navLink`'s. */}
              <Link
                to="/settings"
                activeProps={{
                  className: `${navLink.base} ${navLink.active} font-medium`,
                  'aria-current': 'page',
                }}
                inactiveProps={{ className: `${navLink.base} ${navLink.idle}` }}
              >
                Settings
              </Link>
              {/* Bounded and titled: a display name is somebody's to choose,
                  and the header is not the place to let that choice decide
                  whether Sign out is reachable. */}
              <span
                className="max-w-32 truncate text-sm text-ink-subtle"
                title={account.displayName}
              >
                {account.displayName}
              </span>
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
      <SessionEndedBanner />
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
      <div className="flex min-h-0 flex-1 print:block">
        {/* **Below `sm` an open dock is the view, not a neighbour of it** —
            [10 §3]. Two panels sharing 375px is two unusable panels, and the
            design already settled this: on a phone the workbench is the main
            view. The outlet is hidden rather than unmounted, so nothing
            refetches when the dock closes again.

            ***`relative`, so the page's absolutely positioned descendants are
            this box's*** (2026-10-07). Without a positioned ancestor between
            them and here, every `sr-only` label on a long page — a dozen on
            Settings — was positioned against the document instead, escaped
            this element's clipping, and made the *window* scrollable by the
            page's whole height: 2,512px of it in a 455px window. Nothing showed
            it until something scrolled the window — a jump to a section did,
            and took the header off the screen with it. The comment on the
            scroll reset above says the window no longer scrolls; this is what
            makes that true. */}
        <main
          ref={mainRef}
          id="main"
          tabIndex={-1}
          className={
            workbenchOpen || assistantOpen
              ? 'relative min-w-0 flex-1 overflow-y-auto focus:outline-none max-sm:hidden print:overflow-visible'
              : 'relative min-w-0 flex-1 overflow-y-auto focus:outline-none print:overflow-visible'
          }
        >
          <Outlet />
        </main>
        {workbenchOpen ? <Workbench onClose={closeWorkbench} /> : null}
        {/* After the workbench in source order, so with both open the assistant
            is the outermost panel — it is the thing you summoned last and the
            thing you dismiss first. Closed is unmounted for the dock's reason:
            no queries run and the landmark is absent rather than lurking. */}
        {account === null || !assistantOpen ? null : <AssistantPanel onClose={closeAssistant} />}
      </div>
      {/* Last in the column and outside `<main>`, for the banner's reason: a
          footer that scrolls away with the page is a footer on some pages. The
          dock row above is `min-h-0 flex-1`, so it yields the footer its
          height — and the footer must sit inside the `h-dvh` column, or the
          document would scroll again ([P3.−1]). Under the dock as a whole, so
          an open Workbench does not cover it. */}
      <BuildFooter build={auth.data?.build} />
      {/* Fixed-position and last in the tree, so it sits over the dock rather
          than under it, and takes no part in the height-managed column. */}
      {account === null ? null : <NotificationToast state={notifications} />}
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
      {/*
        ***Search is a surface, not a box in a corner*** —
        [10 §14.5](../../../docs/design/10-ui-surfaces.md), [P11.1]. §14.1 gives
        it two scopes — within a session and across all of them — and a box
        pinned to one screen can only ever mean the first. §5's named failure is
        *a search box per kind*, and the way to avoid it is one surface with a
        scope rather than a prohibition on searching from where you stand.
      */}
      <SurfaceLink to="/search" label="Search" />
    </nav>
  );
}

function SurfaceLink(props: { to: '/play' | '/library' | '/search'; label: string }): JSX.Element {
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
 * [09 §6.4](../../../docs/design/09-server-multiuser-deployment.md),
 * [P2A §2.6](../../../docs/design/workplan/09-p2a-configuration-surface.md),
 * [P10.3].
 *
 * **Named changes rather than "restart required"**, because a bare notice
 * invites people to restart and hope — and the list is computed per request
 * from the config this process started with, so undoing a change clears it
 * rather than leaving a banner nobody can dismiss.
 *
 * ***And since [P10.3] it offers to do it, where something would bring the
 * process back.*** ~~It says the server will not restart itself.~~ [09 §6.4]'s
 * two preconditions are built — supervisor detection and a drain — so the
 * sentence that stood here is now the **unsupervised** arm rather than the only
 * arm. A bare `node server.js` still reads exactly as it did, which is the
 * point: what §6.4 forbids is offering the control where it is a trap, not
 * offering it at all.
 *
 * **In the banner rather than on the settings page**, because the banner is
 * where a person *learns* a restart is pending — [09 §6.3] puts it on every page
 * precisely because the person who needs to know is often not the one looking at
 * the form, and sending them to a form to act on it would undo that.
 *
 * The query is disabled for a non-admin, so their browser never asks — the same
 * absent-rather-than-disabled mechanism the settings page uses.
 */
/**
 * ***The sign-in has ended; the page has not*** (2026-09-27) — see
 * `auth/session-ended.ts`.
 *
 * Above the outlet with the restart notice, and for its reason: the person who
 * needs to know is on whatever page they are on. *The button asks, it does not
 * sign out*: it has the auth state read again, and the server's answer — no
 * account — is what takes the page to the sign-in form. The sentence before it
 * is the point of not doing that on the 401 itself: whatever is unsaved on this
 * page is still here, and this is the moment to copy it.
 */
function SessionEndedBanner(): JSX.Element | null {
  const ended = useSessionEnded();
  const client = useQueryClient();
  if (!ended) return null;

  return (
    <div
      role="alert"
      className="border-b border-danger-line bg-danger-surface px-6 py-2 text-sm print:hidden"
    >
      <div className="mx-auto flex max-w-4xl flex-wrap items-center justify-between gap-3">
        <p className="text-danger-ink">
          Your sign-in has ended. Copy anything unsaved on this page, then sign in again.
        </p>
        <Button
          type="button"
          size="compact"
          onClick={() => {
            void client.invalidateQueries({ queryKey: ['auth', 'state'] });
          }}
        >
          Sign in again
        </Button>
      </div>
    </div>
  );
}

function RestartBanner({ isAdmin }: { isAdmin: boolean }): JSX.Element | null {
  const notices = useNotices(isAdmin);
  const restart = useRestart();
  const [confirming, setConfirming] = useState(false);

  const pending = notices.data?.pendingRestart ?? [];
  if (!isAdmin || pending.length === 0) return null;

  /**
   * ***A 202 says a drain has begun only until the server has answered since***
   * (2026-09-28). `restart.isSuccess` outlived the restart it reported — the
   * mutation's result belongs to the page, and the page was never reloaded —
   * so a restart key saved later brought the banner back as *Restarting…*
   * with no button, until a reload. After the first answer the server has
   * given since the press, its own `draining` is the truth.
   */
  const accepted = restart.isSuccess && notices.dataUpdatedAt <= restart.submittedAt;
  const draining = notices.data?.draining === true || accepted;
  const canRestart = notices.data?.canRestart === true;
  const interrupts = notices.data?.interrupts ?? { mine: 0, others: 0 };

  return (
    <div
      role="status"
      className="border-b border-warn-line bg-warn-surface px-6 py-2 text-sm print:hidden"
    >
      <div className="mx-auto flex max-w-4xl flex-wrap items-center justify-between gap-3">
        <p className="text-warn-ink">
          {draining
            ? drainingNotice(pending.join(', '))
            : canRestart
              ? supervisedNotice(pending.join(', '))
              : unsupervisedNotice(pending.join(', '))}
        </p>
        {canRestart && !draining ? (
          <Button
            type="button"
            size="compact"
            onClick={() => {
              setConfirming(true);
            }}
          >
            Restart now
          </Button>
        ) : null}
      </div>

      {confirming ? (
        <Dialog
          role="alertdialog"
          labelledBy="confirm-restart"
          onDismiss={() => {
            setConfirming(false);
          }}
        >
          <h2 id="confirm-restart" className="text-subsection text-ink">
            Restart this server?
          </h2>
          {/* ***[09 §6.4]'s own sentence***: *"because this is multi-user, the
              confirmation must say what it is about to interrupt"*. Counts,
              never contents — who is mid-turn is a different feature. */}
          <p className="text-sm text-ink-muted">{interruptNotice(interrupts.others)}</p>
          {interrupts.mine > 0 ? (
            <p className="text-sm text-ink-muted">{ownTurnNotice(interrupts.mine)}</p>
          ) : null}
          <p className="text-sm text-ink-muted">
            Turns already running are given up to thirty seconds to finish. Anything still going
            after that is recorded as a failed turn rather than lost.
          </p>
          {restart.isError ? (
            <p role="alert" className="text-sm text-danger-ink">
              {restart.error.message}
            </p>
          ) : null}
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              size="compact"
              onClick={() => {
                setConfirming(false);
              }}
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="primary"
              size="compact"
              disabled={restart.isPending}
              onClick={() => {
                restart.mutate(undefined, {
                  onSuccess: () => {
                    setConfirming(false);
                  },
                });
              }}
            >
              Restart now
            </Button>
          </div>
        </Dialog>
      ) : null}
    </div>
  );
}

/**
 * The four sentences, whole.
 *
 * *One string each with the values substituted in* — the rule
 * `AdminConnections` states and the lint rule enforces: a sentence assembled
 * from fragments cannot be translated at all, and these are exactly the shapes
 * that invite it (a list with a clause after it, a count with a noun).
 */
function supervisedNotice(keys: string): string {
  return `Waiting for a restart: ${keys}. Restarting now will apply them.`;
}

function unsupervisedNotice(keys: string): string {
  return `Waiting for a restart: ${keys}. StoryEngine does not restart itself — stop and start the server however you run it, and these will take effect.`;
}

function drainingNotice(keys: string): string {
  return `Restarting to apply: ${keys}. Waiting for turns in flight to finish; this page will reconnect on its own.`;
}

function interruptNotice(others: number): string {
  if (others === 0) return 'Nobody else has a turn running.';
  if (others === 1) return '1 other person has a turn running, and it may be interrupted.';
  return `${String(others)} other people have turns running, and they may be interrupted.`;
}

function ownTurnNotice(mine: number): string {
  return mine === 1
    ? 'One of your own turns is running.'
    : `${String(mine)} of your own turns are running.`;
}
