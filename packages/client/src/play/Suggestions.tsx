// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import type { JSX } from 'react';

import { useSession, useWriteChannel } from '../queries.js';
import { Button } from '../ui/Button.js';
import { Fine } from '../ui/Text.js';

/**
 * What the player could do next —
 * [06 §7.3](../../../../docs/design/06-modes-and-turn-pipeline.md),
 * [R11](../../../../docs/design/workplan/22-walkthrough-refinements.md), built
 * at [P7.9](../../../../docs/design/workplan/23-p7-implementation.md).
 *
 * ***An offer that fills the box rather than a button that takes a turn***, and
 * the difference is the whole of what makes this safe to ship. A suggestion is
 * text the player submits **as their own input** — so pressing one puts it in
 * the composer, where it can be edited, extended or deleted. A control that
 * submitted directly would make the model's suggestion and the player's decision
 * the same gesture, which is the thing [00 §3.3]'s posture is against everywhere
 * else in this app.
 *
 * ***The toggle is here even when it is off***, which is what allowed the
 * feature to be off by default. [work plan §2.3]'s standing line — *no phase
 * exits with configuration that has no surface* — is usually a rule about
 * finishing a feature; here it is the reason a default could be chosen on the
 * merits. R11 asks for a **per-session** toggle and this is it: a channel write,
 * so it branches and a rewind takes it back like everything else.
 *
 * *The offers come off the turn rather than from a query of their own*, because
 * that is where they live: a suggestion is a reading of one turn's ending, so
 * it is on that turn's record, and a rewind shows the suggestions that belonged
 * to the turn you rewound to without anything having to refetch.
 */
export function Suggestions(props: {
  sessionId: string;
  /** The head turn's offers, in the order the model made them. */
  actions: readonly string[];
  disabled: boolean;
  onPick: (action: string) => void;
}): JSX.Element | null {
  const session = useSession(props.sessionId);
  const write = useWriteChannel(props.sessionId);
  const on = session.data?.suggesting;

  // Undefined is a build that does not send it, which is not the same as off —
  // and rendering a control for a server that has no such channel would be a
  // toggle that writes into a 404.
  if (on === undefined) return null;

  return (
    <div className="flex flex-col gap-1">
      {on && props.actions.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          {props.actions.map((action) => (
            <Button
              key={action}
              type="button"
              disabled={props.disabled}
              onClick={() => {
                props.onPick(action);
              }}
            >
              {action}
            </Button>
          ))}
        </div>
      ) : null}

      <label className="flex items-center gap-2 text-sm text-ink-muted">
        <input
          type="checkbox"
          checked={on}
          disabled={write.isPending}
          onChange={(event) => {
            write.mutate({ key: 'se.suggest', value: event.target.checked });
          }}
        />
        <span>Suggest what I could do</span>
        {/* The cost, said plainly. It is the player's own machine on a
            self-hosted build, and a feature that quietly doubles the wait
            between Send and the next paragraph should say so where it is
            switched on rather than in a release note. */}
        <Fine>one extra model call per turn</Fine>
      </label>
    </div>
  );
}

/**
 * ***Starter prompts, for a session with no turns in it*** — [06 §7.4],
 * [10 §7](../../../../docs/design/10-ui-surfaces.md),
 * [P11.3](../../../../docs/design/workplan/28-p11-implementation.md).
 *
 * *"Marinara ships suggestion chips — labelled entry points that expand into a
 * pre-written prompt… Cheap, and the main thing standing between a blank
 * assistant box and people actually using it."*
 *
 * ***The same component shape as the offers above, deliberately, and a
 * different source.*** An offer is the *model's* reading of the last turn and
 * arrives on that turn's record; a starter is the *surface's* and is passed in,
 * because there is no turn yet to have read. What they share is the rule that
 * matters: **it fills the box**. A chip that submitted would make the app's
 * suggestion and the person's decision one gesture, which is what the file above
 * this line spends a paragraph refusing.
 *
 * *No toggle, where the offers have one.* A per-session switch exists up there
 * because offers cost a model call on every turn; these are four strings in a
 * component and cost nothing, and a control for turning off four strings that
 * vanish after the first message would be configuration with no question behind
 * it.
 */
export function Starters(props: {
  actions: readonly string[];
  disabled: boolean;
  onPick: (action: string) => void;
}): JSX.Element | null {
  if (props.actions.length === 0) return null;

  return (
    <div className="flex flex-col gap-1">
      <Fine>Or start with one of these.</Fine>
      <div className="flex flex-wrap gap-2">
        {props.actions.map((action) => (
          <Button
            key={action}
            type="button"
            size="compact"
            disabled={props.disabled}
            onClick={() => {
              props.onPick(action);
            }}
          >
            {action}
          </Button>
        ))}
      </div>
    </div>
  );
}
