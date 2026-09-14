// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import type { JSX } from 'react';

import { useSession } from '../queries.js';

/**
 * What a session's channels say, above the story —
 * [10 §8](../../../../docs/design/10-ui-surfaces.md), built at
 * [P7.1](../../../../docs/design/workplan/23-p7-implementation.md).
 *
 * **This component knows no channel**, which is the whole of what 10 §8 decides.
 * Extensions do not ship UI; they declare a widget from a versioned vocabulary
 * and the host renders it. So there is no `if (channelId === 'se.clock')` here
 * and there must never be one — the day a mode's channel needs special handling
 * in this file is the day the vocabulary was too narrow, and the answer 10 §8
 * gives is *"ask what widget would let it, and add that"*.
 *
 * **A `kind` it does not recognise is skipped, not broken.** That is what makes
 * widening the vocabulary additive: a session opened against a newer build
 * renders the widgets this one understands and silently omits the rest, which
 * is the same posture the collector takes toward a preset slot kind from the
 * future.
 *
 * **Rendered by the server, down to the string.** What crosses is a label and
 * text; the registry, the declarations and the template engine stay where they
 * are. A client that composed this would be a second implementation of the
 * mode contract living in a browser.
 *
 * *Nothing when there is nothing — a strip of empty labels above the transcript
 * would be worse than no strip, and a mode with no `surface` on any channel is
 * the ordinary case rather than a misconfiguration.*
 */
export function ChannelHud(props: { sessionId: string }): JSX.Element | null {
  const session = useSession(props.sessionId);
  const widgets = (session.data?.hud ?? []).filter((widget) => widget.kind === 'text');

  if (widgets.length === 0) return null;

  return (
    <dl
      className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-ink-muted"
      aria-label="Session state"
    >
      {widgets.map((widget) => (
        // A description list because that is what this is — a label and the
        // value it names — and it is what a screen reader can walk as pairs.
        <div key={widget.key} className="flex gap-1">
          <dt className="text-ink-faint">{widget.label}</dt>
          <dd className="text-ink">{widget.text}</dd>
        </div>
      ))}
    </dl>
  );
}
