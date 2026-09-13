// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { useState, type JSX } from 'react';

import type { HookRow } from '../api.js';
import { useSession, useWriteChannel } from '../queries.js';
import { Alert } from '../ui/Alert.js';
import { Badge } from '../ui/Badge.js';
import { Button } from '../ui/Button.js';
import { Fine } from '../ui/Text.js';
import { hookState, hookWords } from './hookWords.js';

/**
 * The hook panel — [10 §10.1](../../../../docs/design/10-ui-surfaces.md),
 * [06 §6.1](../../../../docs/design/06-modes-and-turn-pipeline.md), built at
 * [P7.5](../../../../docs/design/workplan/23-p7-implementation.md).
 *
 * *"Authoring affordances are part of the feature, not polish. Somebody with
 * thirty hooks cannot test them by playing to turn 200."* So: which have fired
 * and when, which are eligible now, which are blocked **and by what**.
 *
 * **The dial is here because it is the control that explains an empty panel.**
 * 10 §10.1 says it plainly — *"a session at `sparse` with six eligible hooks and
 * nothing firing is working correctly, and without the dial in view that is
 * indistinguishable from broken"*.
 *
 * ***One control, not both.*** Commit is here, because it is a move in the
 * story. **Force-fire is deliberately absent**: it is a test of the material and
 * lives in the workbench beside the keyword test and the dry run, and *"splitting
 * them keeps a control that skips the engine's judgement out of the surface
 * people play on"*.
 *
 * **The content is not here**, which is the constraint the surface is built
 * around rather than an omission — see `HookRow`. A row is its title until the
 * hook has gone; an entrance is its label and never its text.
 *
 * *Nothing when there is nothing*, like the HUD and the cast panel: a session
 * with no hook pool is the ordinary case, and an empty heading over it would be
 * a surface claiming a feature is configured when it is not.
 */
export function HookPanel(props: { sessionId: string }): JSX.Element | null {
  const session = useSession(props.sessionId);
  const hooks = session.data?.hooks;
  const rows = hooks?.rows ?? [];

  if (rows.length === 0) return null;

  return (
    <section className="flex flex-col gap-3" aria-label="Plot hooks">
      <Pacing sessionId={props.sessionId} level={hooks?.pacing ?? 'normal'} />
      <div className="flex flex-col gap-2">
        {rows.map((row) => (
          <Hook key={row.hookId} sessionId={props.sessionId} row={row} />
        ))}
      </div>
    </section>
  );
}

/**
 * The pacing dial — [06 §6.1], [04 §6.1b].
 *
 * **A `user-only` channel, so this is the only thing that may write it**: a
 * model proposing a pacing change is a model turning its own volume up, and the
 * engine refuses a model, a step and itself alike.
 *
 * *The level is handed in rather than read off the HUD*, because the value is
 * [04 §6.1b]'s three rungs already resolved — a control reading the channel
 * alone would show `normal` for every session that authored a level in its
 * treatment and has not yet turned it.
 */
function Pacing(props: { sessionId: string; level: string }): JSX.Element {
  const write = useWriteChannel(props.sessionId);
  const level = props.level;

  return (
    <label className="flex items-center gap-2 text-sm text-ink-muted">
      <span>How often hooks fire</span>
      <select
        className="rounded-control border border-line bg-surface p-1 text-ink"
        value={level}
        disabled={write.isPending}
        onChange={(event) => {
          write.mutate({ key: 'se.hook.pacing', value: event.target.value });
        }}
      >
        {/* The vocabulary the channel's schema accepts. A value this list did
            not offer would be a control that produces a recorded refusal. */}
        <option value="sparse">Rarely</option>
        <option value="normal">Now and then</option>
        <option value="aggressive">Often</option>
        <option value="manual-only">Only when I say</option>
      </select>
    </label>
  );
}

function Hook(props: { sessionId: string; row: HookRow }): JSX.Element {
  const { row } = props;
  const write = useWriteChannel(props.sessionId);
  /**
   * **Committing past a refusal asks first** — [06 §6.1]'s first rule for
   * keeping Commit honest: *"skipping the filter must say what it skipped. The
   * failure this section names twice is a hook firing about someone dead four
   * sessions ago; a control that permits it silently reintroduces that failure
   * by hand. The confirmation names the clause that failed and proceeds."*
   *
   * *Local state rather than a dialog*, because the sentence it has to show is
   * already on the row — the confirmation is that sentence read back with a
   * button under it, and moving it into a modal would separate the claim from
   * the thing it is about.
   */
  const [asking, setAsking] = useState(false);
  const state = hookState(row);
  const committed = row.state === 'committed';

  function commit(): void {
    write.mutate({ key: `se.hook#${row.hookId}`, value: 'committed' });
    setAsking(false);
  }

  return (
    <div className="flex flex-col gap-1">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-ink">{row.title}</span>
        {/* `provenance` for a live state and `neutral` for a spent one — the
            two tones this palette has for *this is doing something* and *this
            happened*, and nothing here is bad news worth `danger`. */}
        {state === null ? null : (
          <Badge tone={row.state === 'fired' ? 'neutral' : 'provenance'}>{state}</Badge>
        )}
        <Fine>{sourceWords(row.source)}</Fine>
      </div>

      {/* Eligible now, blocked and by what, or carried past a clause by a
          person. Three different sentences, and the third has to name the
          second or Commit is the silent override §6.1 rules out. */}
      {committed ? (
        <Fine>
          {row.committed?.overrode == null
            ? 'Committed: it will fire when there is a moment for it.'
            : `Committed past: ${hookWords(row.committed.overrode).toLowerCase()}.`}
        </Fine>
      ) : row.refusal === null ? (
        <Fine>Eligible now</Fine>
      ) : (
        <Fine>{hookWords(row.refusal)}</Fine>
      )}

      {row.premise === undefined ? null : <Fine>{row.premise}</Fine>}
      {row.entrances.length === 0 ? null : (
        <Fine>{`Arrivals: ${row.entrances.map((entrance) => entrance.label).join(', ')}`}</Fine>
      )}

      {asking ? (
        <Alert tone="warning" role="status" className="flex flex-col gap-2">
          <span>
            {row.refusal === null
              ? 'Commit this hook?'
              : `${hookWords(row.refusal)}. Commit it anyway?`}
          </span>
          <div className="flex gap-2">
            <Button type="button" onClick={commit} disabled={write.isPending}>
              Commit
            </Button>
            <Button
              type="button"
              onClick={() => {
                setAsking(false);
              }}
            >
              Cancel
            </Button>
          </div>
        </Alert>
      ) : (
        <Controls
          row={row}
          pending={write.isPending}
          onCommit={commit}
          onAsk={() => {
            setAsking(true);
          }}
          onRelease={() => {
            write.mutate({ key: `se.hook#${row.hookId}`, value: null });
          }}
        />
      )}
    </div>
  );
}

/**
 * The one control this surface offers, in its three states.
 *
 * **Nothing at all for a hook that has gone.** Committing a fired hook is
 * *un-firing* it — the states are exclusive on one channel — which is a real
 * thing a person may want and is not something to offer by accident from a row
 * that says *Fired*.
 */
function Controls(props: {
  row: HookRow;
  pending: boolean;
  onCommit: () => void;
  onAsk: () => void;
  onRelease: () => void;
}): JSX.Element | null {
  const { row } = props;
  if (row.state === 'fired' || row.state === 'provisional') return null;

  if (row.state === 'committed') {
    return (
      <div>
        <Button type="button" onClick={props.onRelease} disabled={props.pending}>
          Release
        </Button>
      </div>
    );
  }

  return (
    <div>
      <Button
        type="button"
        onClick={row.refusal === null ? props.onCommit : props.onAsk}
        disabled={props.pending}
      >
        Commit
      </Button>
    </div>
  );
}

/** Where the hook came from — [03 §4.1]'s *every hook shows its source*. */
function sourceWords(source: HookRow['source']): string {
  switch (source.kind) {
    case 'treatment':
      return 'from the treatment';
    case 'setup':
      return 'from the setup';
    case 'lore':
      return 'from a lorebook';
    default:
      return 'added to this session';
  }
}
