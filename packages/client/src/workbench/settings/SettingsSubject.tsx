// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { Link, useLocation } from '@tanstack/react-router';
import type { JSX, MouseEvent } from 'react';

import { useAuthState } from '../../queries.js';
import {
  jumpToSection,
  jumpWhenShown,
  pageIsBehindDock,
  settingsContents,
  type ContentsEntry,
} from '../../settings/contents.js';
import { Note, SubsectionTitle } from '../../ui/Text.js';

/**
 * The settings page's contents — the workbench's subject over `/settings`,
 * 2026-10-07, [10 §3](../../../../../docs/design/10-ui-surfaces.md).
 *
 * **A reader, by the test `ReleaseSubject` set.** The main view's subject is
 * *the settings page*, and this panel's is *every section of the same page*:
 * the same subject at list scale, as the releases are over home. It holds no
 * state — which section is marked is the address's hash — it issues no request
 * (the account it filters by is `auth/state`, already in hand), it writes
 * nothing, and it does not survive leaving `/settings`. *What would make it
 * the second exception* is what would make the releases one: a control here
 * that changed something, or a subject that outlived its route.
 *
 * **It lists what the page draws for this account and nothing else** — the
 * administration half only for an administrator and *Your connections* only
 * with the capability, because the page leaves both out rather than disabling
 * them, and a contents row that jumped to nothing would be the disabled control
 * §15 refuses, moved into the dock.
 *
 * **Links, not buttons**, because a row is an address: `/settings#…` can be
 * opened in a new tab, copied, or reloaded, and lands in the same place each
 * time.
 */
export function SettingsSubject({ onClose }: { onClose: () => void }): JSX.Element {
  const auth = useAuthState();
  const contents = settingsContents(auth.data?.account ?? null);
  const hash = useLocation({ select: (location) => location.hash });

  return (
    <nav aria-label="Settings contents" className="flex flex-col gap-3">
      <SubsectionTitle as="h4">On this page</SubsectionTitle>
      <Note>Every section of the settings page. Choose one to go to it.</Note>
      <ul className="flex flex-col gap-0.5">
        {contents.yours.map((entry) => (
          <Row key={entry.key} entry={entry} current={hash === entry.anchor} onClose={onClose} />
        ))}
        {contents.administration === null ? null : (
          <Row
            entry={contents.administration.entry}
            current={hash === contents.administration.entry.anchor}
            onClose={onClose}
          >
            <ul className="mt-0.5 flex flex-col gap-0.5 border-s border-line ps-3">
              {contents.administration.sections.map((entry) => (
                <Row
                  key={entry.key}
                  entry={entry}
                  current={hash === entry.anchor}
                  onClose={onClose}
                />
              ))}
            </ul>
          </Row>
        )}
      </ul>
    </nav>
  );
}

function Row({
  entry,
  current,
  onClose,
  children,
}: {
  entry: ContentsEntry;
  current: boolean;
  onClose: () => void;
  children?: JSX.Element;
}): JSX.Element {
  return (
    <li>
      <Link
        to="/settings"
        hash={entry.anchor}
        /**
         * **Both of these are `ReleaseSubject`'s lesson, in the hash.** Every
         * row's `to` is `/settings`, and the router's default calls a link
         * active by its path alone — so every row would be current at once.
         * `exact` with `includeHash` makes *current* mean the section the
         * address names, and the explicit `aria-current` agrees with it, so
         * the mark a screen reader hears is the mark the row shows.
         */
        activeOptions={{ exact: true, includeHash: true }}
        aria-current={current ? 'page' : undefined}
        /**
         * **The page owns the scroll** (`useJumpToHash`, in
         * `settings/contents.tsx`), so the router's own scroll to a hash is
         * off, and there is one answer to *where does a jump land*.
         */
        hashScrollIntoView={false}
        onClick={(event: MouseEvent<HTMLAnchorElement>) => {
          // A second press of the row already in the address changes no
          // address, so the page's hash effect never hears it — and the
          // person has scrolled away and wants to go back. The jump is made
          // here as well; it is the same jump, and making it twice is harmless.
          // Not for a press that opens a new tab or window, which leaves this
          // page where it is.
          if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey) return;
          // **On a phone the dock is the view** and the page is hidden behind
          // it, so a jump there lands on nothing. Choosing a section is
          // choosing to read it, so the dock closes — the one thing this
          // panel changes, and it is the dock's own state, which every
          // subject's *Close* already changes — and the jump waits for the
          // page to be drawn again.
          if (pageIsBehindDock()) {
            onClose();
            jumpWhenShown(entry.anchor);
            return;
          }
          jumpToSection(entry.anchor);
        }}
        className={`block rounded-control px-2 py-1 text-sm ${
          current ? 'bg-surface-muted text-ink' : 'text-ink-subtle hover:text-ink'
        } focus-visible:outline-2 focus-visible:outline-focus`}
      >
        {entry.title}
      </Link>
      {children}
    </li>
  );
}
