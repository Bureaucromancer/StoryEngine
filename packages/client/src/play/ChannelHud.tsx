// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import type { JSX } from 'react';

import { useSession } from '../queries.js';
import { HudEntry } from './HudEntry.js';
import { ModeRegion } from './ModeRegion.js';

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
 *
 * ***Each entry opens in place, and writes*** (2026-10-13,
 * [P12A](../../../../docs/design/workplan/35-p12a-the-look.md) P12A.4, under
 * its §0.4). It was a description list of labels and strings, a strip that
 * showed and could not correct — [P12A §1.4](../../../../docs/design/workplan/35-p12a-the-look.md)'s
 * *"an uneditable HUD is not a smaller version of this stage, it is the stage
 * not done"*. Each entry is now an item of the strip (`HudEntry`) that opens to
 * the value and a way to change it, from an edit the server derived from the
 * channel's schema — so the rule above holds with the strip writing: what
 * crosses is still declared data, and the client still knows no channel.
 * *The value an edit starts from crosses beside it* (`ChannelSurface.value`),
 * since a rendered sentence is not the value it was rendered from. *And it is
 * not a description list any more*: a `<dl>` was chosen so a screen reader could
 * walk label and value as pairs, and each pair is now one button whose name is
 * the label and the value together — *Place the harbour* — which is the same
 * pair, walked as one stop.
 *
 * ***And a mode's own placements in the strip are drawn here*** (2026-10-13,
 * P12A.4). A contribution naming the `hud` region was promised *"appends to the
 * strip"* by the session route since [P7.11] and drawn nowhere. They come after
 * the channels' own entries, the order the route lists them in, and a `text`
 * placed there is the same entry as a channel's `surface` —
 * [10 §8.0](../../../../docs/design/10-ui-surfaces.md)'s *"defined in terms of
 * the first"* — so `ModeRegion` draws it with `HudEntry` too.
 */
export function ChannelHud(props: { sessionId: string }): JSX.Element | null {
  const session = useSession(props.sessionId);
  const widgets = (session.data?.hud ?? []).filter((widget) => widget.kind === 'text');
  const placed = (session.data?.surfaces ?? []).filter((surface) => surface.region === 'hud');

  if (widgets.length === 0 && placed.length === 0) return null;

  return (
    <div
      role="group"
      aria-label="Session state"
      className="flex flex-wrap items-center gap-x-3 gap-y-1"
    >
      {widgets.map((widget) => (
        <HudEntry key={widget.key} sessionId={props.sessionId} entry={widget} />
      ))}
      <ModeRegion sessionId={props.sessionId} surfaces={placed} region="hud" className="contents" />
    </div>
  );
}
