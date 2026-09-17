// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import type { JSX } from 'react';

import { useNotices } from '../queries.js';
import { Note } from '../ui/Text.js';

/**
 * Whether there is a newer build, and whether this server can reach anything —
 * [09 §6.5](../../../../docs/design/09-server-multiuser-deployment.md),
 * [10 §15.5](../../../../docs/design/10-ui-surfaces.md)'s *connectivity state*,
 * [P10.3].
 *
 * ***"Surface it as a badge on the About surface, not a notification."***
 * §6.5's own instruction, and its reason is the notification system's health
 * rather than this feature's: *"a new release is not urgent, and a notification
 * class for it would train people to dismiss notifications."* So there is no
 * `update.available` class, and [P10 §1.4]'s rule about classes with producers
 * never has to be argued about for this one.
 *
 * ***Admin-only, which is [09 §6.5]'s third bullet***: *"a regular user cannot
 * fix the server's networking, and a warning they can only be alarmed by is
 * noise."* The query is disabled for everybody else, so their browser never
 * asks — the same absent-rather-than-disabled mechanism the rest of this page
 * rests on.
 *
 * ***And the connectivity line is conditional on configuration.*** A fully local
 * install — Ollama, llama.cpp, a box on the LAN — is a legitimate deployment
 * whose operator chose it, and telling them their server is broken because it
 * cannot reach a release feed *"would be both wrong and irritating"*. §6.5 also
 * offers the softer option for that case — *"optionally note it in About as a
 * fact rather than a fault"* — which is what the `unreachable` arm does when
 * nothing needs the internet.
 */
export function UpdateBadge(props: { isAdmin: boolean }): JSX.Element | null {
  const notices = useNotices(props.isAdmin);
  const updates = notices.data?.updates;
  if (!props.isAdmin || updates === undefined) return null;

  if (updates.state === 'behind' && updates.latest !== null) {
    return <Note>{behindNotice(updates.latest)}</Note>;
  }

  if (updates.state === 'unreachable') {
    return (
      <Note>
        {updates.needsInternet
          ? 'This server could not reach the internet at its last check, and at least one connection points at a remote provider — so generation is likely to fail too.'
          : 'This server could not reach the internet at its last check. Nothing here needs it: every connection points at this machine or your network.'}
      </Note>
    );
  }

  if (updates.state === 'disabled') {
    return <Note>The update check is turned off, so this build is not compared to anything.</Note>;
  }

  if (updates.state === 'current') return <Note>This is the newest build on your channel.</Note>;

  // `unknown` — never run, or the feed had nothing for this channel. Said as a
  // fact rather than as a fault, because on a private repository it is neither.
  return (
    <Note>
      No release has been published for your channel yet, so there is nothing to compare this build
      to.
    </Note>
  );
}

/** One whole sentence with the value substituted in — the assembly rule. */
function behindNotice(latest: string): string {
  return `A newer build is available: ${latest}. Updating is however you installed this — nothing here does it for you.`;
}
