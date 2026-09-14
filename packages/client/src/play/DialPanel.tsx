// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import type { JSX } from 'react';

import type { DialAxes } from '../api.js';
import { useSession, useWriteChannel } from '../queries.js';
import { Fine } from '../ui/Text.js';

/**
 * Difficulty and directedness — [06 §7.3.1](../../../../docs/design/06-modes-and-turn-pipeline.md),
 * [06 §7.3.2], built at
 * [P7.8](../../../../docs/design/workplan/23-p7-implementation.md).
 *
 * ***The surface exists because the setting does***, which is
 * [work plan §2.3](../../../../docs/design/workplan/01-work-plan.md)'s standing
 * line — *no phase exits with configuration that has no surface* — and this
 * phase's own gate calls that a checklist item rather than a formality.
 *
 * ***Mid-session is the point, not a convenience.*** [06 §7.3.1]: *"Difficulty
 * chosen at setup is chosen with the least information anyone will ever have
 * about the session. The predictable failure is picking Hard, discovering every
 * scene is a slog by turn 30, and having no recourse but to start over."* So the
 * control is beside the story rather than in the wizard, and it writes a channel
 * — which means the change is an effect on a turn and a rewind takes it back.
 *
 * ***Two selects and never one slider.*** [06 §7.3.2] is the whole reason this
 * component is shaped the way it is: *"A naive difficulty implementation raises
 * both together… The result is railroading wearing difficulty's clothes, and
 * players report it as* the AI ignoring me *rather than as* hard." A combined
 * control would be that failure built into the UI, where no amount of careful
 * prompt language downstream could undo it. The labels say what each one does in
 * the player's terms, because *resistance* and *directedness* are the design's
 * words and a person choosing between them needs the sentence rather than the
 * term.
 *
 * **The options come off the wire**, because the levels are the pack's —
 * [06 §7.3.1]: *"'Hard' meaning something different in one prompt pack than
 * another is a feature."* A hard-coded list here would produce a recorded
 * refusal the first time somebody ships four levels.
 *
 * *Nothing when the mode has no dials*, which is [04 §7]'s explicit case rather
 * than an empty state: Scene and Messages declare no difficulty, and a heading
 * over nothing would be a surface claiming a feature that is not configured.
 */
export function DialPanel(props: { sessionId: string }): JSX.Element | null {
  const session = useSession(props.sessionId);
  const dials = session.data?.dials;

  if (dials === undefined) return null;
  // Narrowed by construction rather than asserted: the pair travels so the
  // renderer below never has to ask whether the axis it is holding is there.
  const axes = (['difficulty', 'directedness'] as const).flatMap((axis) => {
    const dial = dials[axis];
    return dial === undefined ? [] : [{ axis, dial }];
  });
  if (axes.length === 0) return null;

  return (
    <div className="flex flex-col gap-2 rounded-control border border-line bg-surface px-3 py-2">
      {axes.map((one) => (
        <Dial key={one.axis} sessionId={props.sessionId} axis={one.axis} dial={one.dial} />
      ))}
      {/* The floor, said to the player as well as to the model — [06 §7.3.1]:
          "Obstruction must not reach unreachability. Difficulty modulates the
          cost and the route, never whether the goal can be attained at all."
          A player who reads it here knows that a hard session that feels
          unwinnable is a pack's failure rather than the setting working. */}
      <Fine>Harder means longer and more expensive. It never means you cannot get there.</Fine>
    </div>
  );
}

const WORDS: Record<'difficulty' | 'directedness', { label: string; hint: string }> = {
  difficulty: {
    label: 'How much the world resists you',
    hint: 'Whether what you try works, and what it costs.',
  },
  directedness: {
    label: 'How much the narrator steers',
    hint: 'Whether it has its own idea of where this is going.',
  },
};

function Dial(props: {
  sessionId: string;
  axis: 'difficulty' | 'directedness';
  dial: NonNullable<DialAxes['difficulty']>;
}): JSX.Element {
  const write = useWriteChannel(props.sessionId);
  const words = WORDS[props.axis];

  return (
    <label className="flex flex-wrap items-center gap-2 text-sm text-ink-muted">
      <span>{words.label}</span>
      <select
        className="rounded-control border border-line bg-surface p-1 text-ink"
        value={props.dial.levelId ?? ''}
        disabled={write.isPending}
        onChange={(event) => {
          write.mutate({ key: `se.${props.axis}`, value: event.target.value });
        }}
      >
        {props.dial.levels.map((level) => (
          <option key={level.id} value={level.id}>
            {level.label}
          </option>
        ))}
      </select>
      <Fine>{words.hint}</Fine>
    </label>
  );
}
