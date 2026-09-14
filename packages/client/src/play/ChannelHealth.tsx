// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { useState, type JSX } from 'react';

import type { DegradedChannel } from '../api.js';
import { useSession, useWriteChannel } from '../queries.js';
import { Alert } from '../ui/Alert.js';
import { Button } from '../ui/Button.js';
import { Fine } from '../ui/Text.js';

/**
 * The banner a degraded channel raises —
 * [06 §4.2](../../../../docs/design/06-modes-and-turn-pipeline.md), built at
 * [P7.1](../../../../docs/design/workplan/23-p7-implementation.md).
 *
 * That section calls the error surface *"the part worth building properly, and
 * the part the sources have nothing like"*, and specifies three things. The
 * health record and the recovery are the server's; this is the other one: **a
 * persistent banner on that session, not a modal and not a log line.**
 *
 * **The reassurance is load-bearing, and 4.2 says so in as many words** —
 * *"'2 channels could not be loaded. Your story is unaffected.' … without it
 * people assume the worst."* So the second sentence is not padding: the
 * calibration behind it is that channel state is *"tracked numbers and flags —
 * HP, a clock, a reputation. It is not the story."* Losing it is annoying; the
 * messages, the branches and the turn records are untouched, and somebody who
 * has just been told something failed needs telling which.
 *
 * **`tone="warning"` rather than `error`**, which is the distinction `Alert`
 * exists to make: *something is wrong and you may still proceed*. An error box
 * would say a refusal or a destruction, and neither happened — the session
 * opened, which is the rule the whole ladder serves.
 *
 * **`role="status"`, not `alert`.** This is on the page when it loads rather
 * than raised in reaction to something the person just did, and announcing it as
 * an alert would interrupt a screen reader for old news. `Alert`'s own docstring
 * draws that line; this is the case it was drawn for.
 *
 * **Recovery is offered, not automatic** — the third bullet, and the reason both
 * buttons are buttons. *Try again* re-proposes the value that was quarantined,
 * which succeeds only if the declaration has since changed; *accept the reset*
 * keeps what is standing and clears the marker. Neither can put the session back
 * in the state it was rescued from, because both go through the engine's own
 * refusal path — which is what makes offering them safe.
 */
export function ChannelHealth(props: { sessionId: string }): JSX.Element | null {
  const session = useSession(props.sessionId);
  const degraded = session.data?.health ?? [];

  if (degraded.length === 0) return null;

  return (
    <Alert tone="warning" role="status" className="flex flex-col gap-3">
      <p>
        <strong>{headline(degraded.length)}</strong> Your story is unaffected.
      </p>
      {degraded.map((channel) => (
        <DegradedRow key={channel.key} sessionId={props.sessionId} channel={channel} />
      ))}
    </Alert>
  );
}

/**
 * One line per channel, because *which* is the first thing somebody asks.
 *
 * The id rather than a display name: a channel has no localised label to render
 * ([01 §2] keeps English out of what the server sends, and a client that wants
 * one keys off the id), and the id is also what somebody would search their own
 * `session.json` for.
 */
function DegradedRow(props: { sessionId: string; channel: DegradedChannel }): JSX.Element {
  const write = useWriteChannel(props.sessionId);
  const [refused, setRefused] = useState(false);

  function recover(value: unknown): void {
    setRefused(false);
    write.mutate(
      { key: props.channel.key, value },
      {
        // A refusal arrives as a 200 with an unapplied effect — the record is
        // the point — so the component reads the effect rather than an error.
        onSuccess: (result) => {
          setRefused(!result.effect.applied);
        },
      },
    );
  }

  return (
    <div className="flex flex-col gap-1">
      <code className="text-sm">
        {props.channel.channelId}
        {props.channel.scopeKey === null ? '' : ` · ${props.channel.scopeKey}`}
      </code>
      <Fine>{props.channel.reason}</Fine>
      <div className="flex gap-2">
        <Button
          type="button"
          onClick={() => {
            recover(props.channel.raw);
          }}
          disabled={write.isPending}
        >
          Try again
        </Button>
        <Button
          type="button"
          onClick={() => {
            recover(props.channel.value);
          }}
          disabled={write.isPending}
        >
          Accept the reset
        </Button>
      </div>
      {refused ? (
        // **Said rather than swallowed.** A retry that still does not fit is the
        // expected outcome until an author ships a fix, and a button that
        // appeared to do nothing would read as broken.
        <Fine>That value still does not fit. It is kept, and you can try again later.</Fine>
      ) : null}
    </div>
  );
}

/** Singular and plural kept apart, because "1 channels" reads as a bug. */
export function headline(count: number): string {
  return count === 1
    ? '1 channel could not be loaded.'
    : `${String(count)} channels could not be loaded.`;
}
