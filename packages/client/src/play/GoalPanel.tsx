// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { useState, type JSX } from 'react';

import type { GoalRow } from '../api.js';
import { useAddGoal, useSession, useWriteChannel } from '../queries.js';
import { Alert } from '../ui/Alert.js';
import { Badge } from '../ui/Badge.js';
import { Button } from '../ui/Button.js';
import { Field } from '../ui/Field.js';
import { Fine } from '../ui/Text.js';

/**
 * What this session is trying to do, and what happens when it gets there —
 * [06 §7.3.3](../../../../docs/design/06-modes-and-turn-pipeline.md),
 * [06 §7.3.4], [10 §12](../../../../docs/design/10-ui-surfaces.md), built at
 * [P7.6](../../../../docs/design/workplan/23-p7-implementation.md).
 *
 * ***The three offers, and the whole point is that they are offered.***
 * [06 §7.3.4]: *"The choice is made at completion, not only at setup.
 * `thenDefault` seeds the offer; it does not decide it. A player who did not
 * know at setup whether they wanted an ending is the normal case, and the moment
 * of completion is when they finally have the information."* So a completed goal
 * raises **Continue open**, **Advance** and **End**, with the authored default
 * marked — and nothing happens until one is pressed.
 *
 * **Manual completion is always available**, which is the other half of
 * [06 §7.3.3]'s bias: the judge errs toward *not met* on purpose, and a player
 * whose goal it missed says so here rather than being stuck.
 *
 * *Ended is a state and not a deletion*, so the panel still renders after End —
 * it says the story is over and keeps the chain readable, because *"what if I
 * had done it differently"* is a reasonable thing to want at exactly that
 * moment and the transcript is still branchable.
 *
 * **A disclosure, like the hook panel beside it**, and always present once the
 * session loads: the control that writes a goal at Advance is inside it.
 */
export function GoalPanel(props: { sessionId: string }): JSX.Element | null {
  const session = useSession(props.sessionId);
  const goals = session.data?.goals;
  const rows = goals?.rows ?? [];

  if (session.data === undefined) return null;

  const current = rows.find((row) => row.current) ?? null;
  const concluded = goals?.concluded ?? false;

  return (
    <details className="rounded-control border border-line bg-surface px-3 py-2">
      <summary className="cursor-pointer text-sm text-ink-subtle">
        {summaryLine(rows, current, concluded)}
      </summary>

      <div className="mt-3 flex flex-col gap-3">
        {rows.length === 0 ? (
          <Fine>
            This story has no objective. That is a choice an author makes, not a gap — but you can
            set one now.
          </Fine>
        ) : (
          <div className="flex flex-col gap-2">
            {rows.map((row) => (
              <Goal key={row.goalId} sessionId={props.sessionId} row={row} rows={rows} />
            ))}
          </div>
        )}
        {concluded ? (
          <Alert tone="neutral" role="status">
            This story has ended. It stays readable, and rewinding puts you back before it.
          </Alert>
        ) : (
          <SetGoal sessionId={props.sessionId} />
        )}
      </div>
    </details>
  );
}

/**
 * The line a closed disclosure owes a reader — the sentence being played toward,
 * rather than a count.
 *
 * *A goal is one thing at a time*, which is what the chain being a cursor means,
 * so unlike the hook panel there is a single fact worth showing and it is the
 * statement itself.
 */
function summaryLine(
  rows: readonly GoalRow[],
  current: GoalRow | null,
  concluded: boolean,
): string {
  if (concluded) return 'The story has ended';
  if (current !== null) return `Working toward: ${current.statement}`;
  if (rows.some((row) => row.achieved)) return 'Playing on, with no objective';
  return rows.length === 0 ? 'No objective' : 'No objective set';
}

function Goal(props: { sessionId: string; row: GoalRow; rows: readonly GoalRow[] }): JSX.Element {
  const { row } = props;
  const write = useWriteChannel(props.sessionId);
  const next = props.rows.find((one) => one.goalId === row.next) ?? null;

  function set(key: string, value: unknown): void {
    write.mutate({ key, value });
  }

  return (
    <div className="flex flex-col gap-1">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-ink">{row.statement}</span>
        {row.achieved ? <Badge tone="neutral">Done</Badge> : null}
        {row.current && !row.achieved ? <Badge tone="provenance">Now</Badge> : null}
        {/* [04 §7.1]: hidden is *the GM's arc*. Saying so is the reveal
            affordance in its smallest honest form — the player is told there is
            one, not what it is. A hidden goal the player has now met is no
            longer hidden from them by anything. */}
        {row.visibility === 'hidden' && !row.achieved ? <Fine>the narrator’s arc</Fine> : null}
      </div>

      {/**
       * ***Manual completion, always available*** — [06 §7.3.3]'s other half.
       * The judge is biased toward *not met* on purpose, so the escape hatch is
       * not a convenience: it is what makes the bias affordable.
       */}
      {row.current && !row.achieved ? (
        <div className="flex gap-2">
          <Button
            type="button"
            disabled={write.isPending}
            onClick={() => {
              set(`se.goal#${row.goalId}`, 'achieved');
            }}
          >
            {row.completion === 'manual' ? 'Done' : 'Mark it done'}
          </Button>
        </div>
      ) : null}

      {/**
       * **The three offers.** Raised on the goal that was just achieved and is
       * still the cursor — once one is pressed the cursor moves and they go.
       *
       * *`neutral` rather than a warning tone*: a completed goal is the best
       * thing that happens in a session, and the palette's other two arms both
       * read as something having gone wrong.
       */}
      {row.current && row.achieved ? (
        <Alert tone="neutral" role="status" className="flex flex-col gap-2">
          <span>Done. What now?</span>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              disabled={write.isPending}
              onClick={() => {
                // The achievement is retained; the cursor goes to nothing.
                set('se.goal.current', null);
              }}
            >
              {mark('Carry on', row.thenDefault === 'continue-open')}
            </Button>
            {next === null ? null : (
              <Button
                type="button"
                disabled={write.isPending}
                onClick={() => {
                  set('se.goal.current', next.goalId);
                }}
              >
                {mark(`Next: ${next.statement}`, row.thenDefault === 'advance')}
              </Button>
            )}
            <Button
              type="button"
              disabled={write.isPending}
              onClick={() => {
                set('se.concluded', true);
              }}
            >
              {mark('End the story', row.thenDefault === 'end')}
            </Button>
          </div>
          {next === null && row.thenDefault === 'advance' ? (
            <Fine>Set the next objective below, then it will be offered here.</Fine>
          ) : null}
        </Alert>
      ) : null}
    </div>
  );
}

/**
 * The authored default, marked rather than applied — [06 §7.3.4]: *"seeds the
 * offer; it does not decide it."* A pre-pressed button would have decided it.
 */
function mark(label: string, seeded: boolean): string {
  return seeded ? `${label} (suggested)` : label;
}

/**
 * ***Advance's second arm*** — [06 §7.3.4]'s *"either the authored `next` or one
 * written now"*, which is the clause that makes the chain a session field rather
 * than a link into the Setup.
 *
 * **One field, and it is not an editor.** A `Goal` has seven, and the one a
 * person writes mid-story is the sentence; the rest take what a goal written
 * here would want — judged by the narrator, visible, and asking again when it is
 * met rather than assuming an ending.
 */
function SetGoal(props: { sessionId: string }): JSX.Element {
  const add = useAddGoal(props.sessionId);
  const write = useWriteChannel(props.sessionId);
  const [statement, setStatement] = useState('');

  function submit(): void {
    add.mutate(
      {
        statement,
        detail: null,
        visibility: 'player',
        completion: { kind: 'narrative' },
        thenDefault: 'continue-open',
        next: null,
      },
      {
        onSuccess: (answer) => {
          setStatement('');
          /**
           * **Two writes, because they are two acts** — adding the goal is
           * authoring and moving play onto it is a move in the story. The
           * session comes back carrying the chain, so the id to point at is the
           * one the server minted rather than one guessed here.
           */
          const chain = answer.session.goals ?? [];
          const made = chain.at(-1);
          if (made !== undefined) write.mutate({ key: 'se.goal.current', value: made.id });
        },
      },
    );
  }

  return (
    <form
      className="flex flex-col gap-2 border-t border-line pt-2"
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      <Field
        label="Set an objective"
        value={statement}
        onChange={setStatement}
        hint="Short. The narrator sees it every turn and works toward it."
      />
      <div>
        <Button type="submit" disabled={statement.trim() === '' || add.isPending}>
          Set
        </Button>
      </div>
    </form>
  );
}
