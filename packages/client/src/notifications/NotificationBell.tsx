// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { useState, type JSX } from 'react';

import { formatEpochMs } from '../format.js';
import { Button } from '../ui/Button.js';
import { Dialog } from '../ui/Dialog.js';
import { askForBrowserNotifications, browserChannel, type BrowserChannelState } from './browser.js';
import { foldedSuffix, summary } from './labels.js';
import type { NotificationsState } from './useNotifications.js';

/**
 * The unread badge and the list behind it —
 * [09 §3.6](../../../../docs/design/09-server-multiuser-deployment.md)'s third
 * in-app channel, [P10.2].
 *
 * ***The durable channel, and the only one that survives a reload.*** A sound
 * happens once, a toast lasts seconds, the title clears when you look at the
 * tab. This is what a person comes back to, which is why the count comes from
 * the server's own `unread` rather than from anything this tab counted.
 *
 * **A `Dialog` rather than an anchored popover**, which is the established
 * pattern here: it owns the focus trap and the Escape arm, and
 * `ui/Dialog.tsx`'s docstring is explicit that two spellings of a trap is how
 * one of them ends up missing one. A notification list is opened on purpose, so
 * the role is `dialog` rather than `alertdialog`.
 */

export function NotificationBell(props: {
  state: NotificationsState;
  /** The reader's, for each row's date. */
  locale: string | undefined;
}): JSX.Element {
  const [open, setOpen] = useState(false);
  const { list, markRead } = props.state;

  return (
    <>
      <Button
        type="button"
        size="compact"
        onClick={() => {
          setOpen(true);
        }}
        aria-haspopup="dialog"
        /**
         * **The count is in the accessible name, not only in the pill.** A badge
         * is a colour and a numeral, which [10 §1.1] calls the channel that must
         * never be the only one — and here the other channel has to carry the
         * number itself, because *"Notifications"* alone tells a screen-reader
         * user nothing about whether to open it.
         */
        aria-label={
          list.unread > 0
            ? `Notifications, ${String(list.unread)} unread`
            : 'Notifications, none unread'
        }
      >
        {/* **The word is its own element**, which the sentence-assembly rule
            requires and is right to: a `JSXText` beside a
            `JSXExpressionContainer` is the shape of a sentence that exists only
            as a tree, and no reader can tell that one from this one. Here the
            pill is a count rather than the tail of a phrase, and wrapping says
            so. */}
        <span>Notifications</span>
        {list.unread > 0 ? (
          <span className="ms-2 rounded-control bg-danger-muted px-1.5 py-0.5 text-xs font-medium text-danger-ink">
            {list.unread}
          </span>
        ) : null}
      </Button>

      {open ? (
        <Dialog
          role="dialog"
          labelledBy="notifications-heading"
          onDismiss={() => {
            setOpen(false);
          }}
        >
          <div className="flex items-center justify-between gap-4">
            <h2 id="notifications-heading" className="text-section text-ink">
              Notifications
            </h2>
            <div className="flex items-center gap-2">
              {/* ***The mute for this sitting, where a person already is*** —
                  [10 §9]'s global mute has a stored half in Settings and a live
                  half here, because the moment somebody wants silence is the
                  moment a sound just went off, and that is not a moment to send
                  them to a settings page. It does not rewrite the preference. */}
              <Button
                type="button"
                size="compact"
                aria-pressed={props.state.muted}
                onClick={() => {
                  props.state.setMuted(!props.state.muted);
                }}
              >
                {props.state.muted ? 'Unmute sounds' : 'Mute sounds'}
              </Button>
              {list.unread > 0 ? (
                <Button
                  type="button"
                  size="compact"
                  onClick={() => {
                    markRead();
                  }}
                >
                  Mark all read
                </Button>
              ) : null}
              <Button
                type="button"
                size="compact"
                onClick={() => {
                  setOpen(false);
                }}
              >
                Close
              </Button>
            </div>
          </div>

          <BrowserChannelNote />

          {list.notifications.length === 0 ? (
            <p className="mt-4 text-sm text-ink-muted">Nothing yet.</p>
          ) : (
            <ul className="mt-4 flex flex-col gap-2">
              {list.notifications.map((one) => {
                const said = summary(one);
                return (
                  <li
                    key={one.id}
                    className={`rounded-control border border-line p-3 ${
                      one.readAt === null ? 'bg-surface' : 'bg-transparent'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-sm font-medium">
                          {said.title}
                          {/* The fold, rendered — see `foldedSuffix`. A row that
                              stood for five arrivals and said so once is the
                              whole of [09 §3.4]. */}
                          {foldedSuffix(one.folded)}
                        </p>
                        {said.body === '' ? null : (
                          <p className="text-sm text-ink-muted">{said.body}</p>
                        )}
                        <p className="text-xs text-ink-subtle">
                          {formatEpochMs(one.updatedAt, props.locale)}
                        </p>
                      </div>
                      {one.readAt === null ? (
                        <Button
                          type="button"
                          size="compact"
                          onClick={() => {
                            markRead([one.id]);
                          }}
                        >
                          Mark read
                        </Button>
                      ) : null}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </Dialog>
      ) : null}
    </>
  );
}

/**
 * Where channel 2 stands, in one sentence — [09 §3.6]'s first obligation.
 *
 * ***"Say so where the user chooses… a greyed toggle with no reason is the worst
 * version of this."*** So each state gets words rather than a disabled control:
 * an install reached over plain LAN HTTP is **not** a secure context and the
 * browser will refuse the prompt, which is a fact about how the install is
 * reached and not something a person can fix from this dialog.
 *
 * *The fuller version of this note is [P10.3]'s*, on the notification settings
 * screen where the preference rows live. This is the sentence at the point of
 * use, which is where somebody actually wonders.
 */
function BrowserChannelNote(): JSX.Element {
  const [channel, setChannel] = useState<BrowserChannelState>(() => browserChannel());

  if (channel === 'granted') {
    return (
      <p className="mt-3 text-xs text-ink-subtle">
        Browser notifications are on, and appear when this tab is in the background.
      </p>
    );
  }

  if (channel === 'insecure-context') {
    return (
      <p className="mt-3 text-xs text-ink-subtle">
        Browser notifications need a secure connection, and this install is reached over plain HTTP.
        Sound, this list and the tab title still work. Reaching StoryEngine over HTTPS — a reverse
        proxy, or Tailscale — turns them on.
      </p>
    );
  }

  if (channel === 'denied') {
    return (
      <p className="mt-3 text-xs text-ink-subtle">
        Browser notifications were refused for this site. Your browser’s site settings are the only
        place that can undo that.
      </p>
    );
  }

  if (channel === 'unsupported') {
    return (
      <p className="mt-3 text-xs text-ink-subtle">
        This browser has no notification support. Sound, this list and the tab title still work.
      </p>
    );
  }

  return (
    <div className="mt-3 flex items-center gap-3">
      <p className="text-xs text-ink-subtle">
        Browser notifications can reach you while this tab is in the background.
      </p>
      {/* **A button, because a permission prompt needs a user gesture** — and
          some browsers count an unprompted request against the origin. */}
      <Button
        type="button"
        size="compact"
        onClick={() => {
          void askForBrowserNotifications().then(setChannel);
        }}
      >
        Turn on
      </Button>
    </div>
  );
}
