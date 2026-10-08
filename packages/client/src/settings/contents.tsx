// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { useLocation } from '@tanstack/react-router';
import { useEffect, type JSX, type ReactNode } from 'react';

import type { Account } from '../api.js';

/**
 * ***The settings page's contents, in the one place both readers take them
 * from*** — 2026-10-07, [10 §3](../../../../docs/design/10-ui-surfaces.md)'s
 * subject over `/settings`.
 *
 * The page had grown to thirteen sections on one route, and §15 keeps it one
 * route on purpose: two halves of one surface, the admin half *absent* rather
 * than disabled, which a route per section would have to spell again. So the
 * answer to *unwieldy* is a way to jump rather than a way to split. The
 * workbench lists the page's sections over it, as it lists a changelog's
 * releases over home, and a row moves the page to that section.
 *
 * **Two readers, one list.** The page draws a {@link SettingsAnchor} around
 * each section, and the workbench lists {@link settingsContents}. Both take
 * the anchor from {@link SECTIONS}, and `SettingsPage.test.tsx` holds the rest
 * together: the anchors the page actually draws, in order, are the list for a
 * plain account, one with its own connections, and an administrator; and
 * every title is the words of the heading it names. A section added to the
 * page and not here fails there, and so does one shown to somebody here and
 * not there.
 */

/**
 * Every section the page can draw, by a key the page and the contents share.
 *
 * `title` is the section's own heading, word for word, so a row reads as what
 * it jumps to — except *This build*, whose heading is the build's name and so
 * cannot be a fixed string. `anchor` is the id the page puts around the section
 * and the address's hash for it; it is never the heading's own id, which the
 * section's `aria-labelledby` already uses and which does not exist until the
 * section has loaded.
 */
export const SECTIONS = {
  build: { anchor: 'build-section', title: 'This build' },
  you: { anchor: 'you-section', title: 'You' },
  roles: { anchor: 'my-roles-section', title: 'Which models your stories use' },
  preferences: { anchor: 'preferences-section', title: 'Preferences' },
  notifications: { anchor: 'notifications-section', title: 'Notifications' },
  myConnections: { anchor: 'my-connections-section', title: 'Your connections' },
  trash: { anchor: 'trash-section', title: 'Trash' },
  backups: { anchor: 'backups-section', title: 'Backups' },
  administration: { anchor: 'administration-section', title: 'Administration' },
  accounts: { anchor: 'accounts-section', title: 'Accounts' },
  connections: { anchor: 'connections-section', title: 'Connections' },
  install: { anchor: 'install-section', title: 'This install' },
  installBackups: { anchor: 'install-backups-section', title: 'Backups' },
} as const;

export type SectionKey = keyof typeof SECTIONS;

export interface ContentsEntry {
  key: SectionKey;
  anchor: string;
  title: string;
}

export interface SettingsContents {
  /** The half every account gets, in the page's order. */
  yours: readonly ContentsEntry[];
  /**
   * The administration half, or `null` for anybody who is not an
   * administrator — *absent*, as the page draws it, so the contents never
   * offer a jump to something the page does not have.
   */
  administration: { entry: ContentsEntry; sections: readonly ContentsEntry[] } | null;
}

function entry(key: SectionKey): ContentsEntry {
  return { key, ...SECTIONS[key] };
}

/**
 * What the page draws for this account, in its order. The two conditions are
 * the page's own — `privateConnections` for *Your connections*, and the role
 * for the whole administration half — and `SettingsPage.test.tsx` checks that
 * they still are.
 */
export function settingsContents(
  account: {
    role: Account['role'];
    capabilities: Pick<Account['capabilities'], 'privateConnections'>;
  } | null,
): SettingsContents {
  const yours: SectionKey[] = ['build', 'you', 'roles', 'preferences', 'notifications'];
  if (account?.capabilities.privateConnections === true) yours.push('myConnections');
  yours.push('trash', 'backups');
  return {
    yours: yours.map(entry),
    administration:
      account?.role === 'admin'
        ? {
            entry: entry('administration'),
            sections: (['accounts', 'connections', 'install', 'installBackups'] as const).map(
              entry,
            ),
          }
        : null,
  };
}

/**
 * ***Where a jump lands, drawn by the page around each section.***
 *
 * **It exists before the section does.** Several sections say *Loading…* until
 * their data arrives and draw their heading only then, so an address naming
 * one — `/settings#backups-section`, followed from somewhere else or reloaded —
 * would find nothing to scroll to if the target were the heading. The anchor is
 * the page's, drawn with the page.
 *
 * **Focusable but not in the tab order** (`tabIndex={-1}`), so a jump can hand
 * focus to the section it scrolled to. A keyboard user's next Tab then goes on
 * from there, instead of from a link in the dock that is now a screen away.
 * The ring shows only when the jump came from a keyboard, which is when it says
 * something.
 */
export function SettingsAnchor({
  of,
  children,
}: {
  of: SectionKey;
  children: ReactNode;
}): JSX.Element {
  return (
    <div
      id={SECTIONS[of].anchor}
      data-settings-anchor={of}
      tabIndex={-1}
      className="scroll-mt-4 rounded-control focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-focus"
    >
      {children}
    </div>
  );
}

/**
 * Scroll a section to the top and hand it focus. `false` when the page has no
 * such section, which an address can name and the page need not have — an
 * administrator's link followed by somebody who is not one, say.
 */
export function jumpToSection(anchor: string): boolean {
  const target = document.getElementById(anchor);
  if (target?.hasAttribute('data-settings-anchor') !== true) return false;
  target.scrollIntoView({ block: 'start' });
  target.focus({ preventScroll: true });
  return true;
}

/**
 * ***Whether the page is behind the dock*** — on a phone, where the open dock
 * *is* the view ([10 §3]) and the shell hides `<main>` beneath it
 * (`max-sm:hidden` in `Shell.tsx`). A jump made then scrolls and focuses
 * nothing, because nothing under `<main>` is drawn, so the contents close the
 * dock first. Read from the computed style, which is the one thing the shell's
 * breakpoint actually sets.
 */
export function pageIsBehindDock(): boolean {
  const main = document.getElementById('main');
  return main !== null && getComputedStyle(main).display === 'none';
}

/**
 * {@link jumpToSection}, once the page is drawn again — for a jump made from
 * the dock on a phone, which closes the dock first. Closing is a preference
 * written optimistically but not synchronously, so this waits a frame at a
 * time, and gives up after about a second rather than wait on a dock that
 * stayed open.
 */
export function jumpWhenShown(anchor: string, frames = 60): void {
  if (!pageIsBehindDock()) {
    jumpToSection(anchor);
    return;
  }
  if (frames > 0) {
    requestAnimationFrame(() => {
      jumpWhenShown(anchor, frames - 1);
    });
  }
}

/**
 * ***The page follows its address's hash*** — so a jump from the dock, a link
 * pasted from elsewhere and a reload all land in the same place, by one path.
 *
 * Re-run when the account arrives or changes role, because the administration
 * anchors exist only once the page knows it is drawing them. The router's own
 * scroll to a hash is turned off on the contents' links, so this is the one
 * owner of where the page is.
 */
export function useJumpToHash(ready: unknown): void {
  const hash = useLocation({ select: (location) => location.hash });
  useEffect(() => {
    if (hash !== '') jumpToSection(hash);
  }, [hash, ready]);
}
