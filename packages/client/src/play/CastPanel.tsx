// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import type { JSX } from 'react';

import type { CastRow } from '../api.js';
import { useLibrary, useSession, useWriteChannel } from '../queries.js';
import { Alert } from '../ui/Alert.js';
import { Badge } from '../ui/Badge.js';
import { Button } from '../ui/Button.js';
import { Fine } from '../ui/Text.js';
import { castBadge, isTerminalBadge } from './castBadge.js';

/**
 * The cast panel — [10 §13.2](../../../../docs/design/10-ui-surfaces.md),
 * [06 §8.1](../../../../docs/design/06-modes-and-turn-pipeline.md), built at
 * [P7.2](../../../../docs/design/workplan/23-p7-implementation.md).
 *
 * Aventuras' character panel, *"which the requirement rightly values as much for
 * confirming the software is following along as for playing"*.
 *
 * **Editable, and that is what makes it worth building.** 10 §13.2 is blunt
 * about it: *"Read-only, the panel is a complaint the user cannot act on.
 * Editable, it is the repair surface for exactly the failures §13.1 makes
 * visible."* That section lists four repairs and this offers **one** of them —
 * *correct presence and status directly*. The other three are named here rather
 * than quietly dropped: **merge** and **split** are library operations that need
 * a redirect so that turn records pointing at an actor id do not rot
 * ([00 §3.3]), and no such mechanism exists; **linking an unresolved mention**
 * waits on the spans P7.7 builds, since there is nothing yet to link from.
 *
 * **One badge from two axes**, derived in `castBadge` where it can be tested.
 * The split stays in the data.
 *
 * **Party members are not marked, and the absence is deliberate.** 10 §13.2 says
 * the panel *"marks party members distinctly and introduces no parallel
 * membership concept"* — and while `se.party` does not exist (it waits on P7.3's
 * policy, per [P7 §1.6]), honouring the second half means marking nothing rather
 * than inventing a second source of truth about who is in the story, which that
 * same paragraph calls *"exactly the class of bug this section exists to
 * surface"*.
 */
export function CastPanel(props: { sessionId: string }): JSX.Element | null {
  const session = useSession(props.sessionId);
  const rows = session.data?.cast ?? [];

  if (rows.length === 0) return null;

  return (
    <section className="flex flex-col gap-2" aria-label="Cast">
      {rows.map((row) => (
        <CastMember key={row.actorId} sessionId={props.sessionId} row={row} />
      ))}
    </section>
  );
}

function CastMember(props: { sessionId: string; row: CastRow }): JSX.Element {
  const { row } = props;
  const actors = useLibrary('actors');
  const write = useWriteChannel(props.sessionId);

  // The card's name if the library has it, the id if it does not — a cast entry
  // is a link resolved fresh every turn ([03 §8]), so an actor deleted from the
  // library is a dangling reference the panel shows rather than hides ([00 §3.3]).
  const name =
    (actors.data?.objects ?? []).find((one) => one.id === row.actorId)?.name ?? row.actorId;

  function set(channelId: string, value: unknown): void {
    write.mutate({ key: `${channelId}#${row.actorId}`, value });
  }

  return (
    <div className="flex flex-col gap-1">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-ink">{name}</span>
        <Badge tone={isTerminalBadge(row.status) ? 'danger' : 'neutral'}>{castBadge(row)}</Badge>
        {row.introduced ? null : <Fine>not yet met</Fine>}
      </div>

      {/**
       * **The prominent surface a refused death is owed** — [06 §8.1], [25 C12].
       *
       * *"Models kill characters casually and in passing. A missed death is an
       * annoyance corrected in one click; a false one silently removes someone
       * from the story."* So the engine refuses the model's proposal and this is
       * where a person rules on it — an `Alert` rather than a badge, because a
       * badge is precisely the *quiet* treatment §8.1 rules out.
       *
       * Both buttons write a status through the ordinary channel route, which is
       * what answers the proposal: confirming writes what the model wanted,
       * dismissing writes what is standing, and either way a person has ruled.
       */}
      {row.pending === null ? null : (
        <Alert tone="warning" role="status" className="flex flex-col gap-2">
          <span>{`The narrator has ${name} as ${row.pending}.`}</span>
          <div className="flex gap-2">
            <Button
              type="button"
              onClick={() => {
                set('se.status', row.pending);
              }}
              disabled={write.isPending}
            >
              Confirm
            </Button>
            <Button
              type="button"
              onClick={() => {
                set('se.status', row.status);
              }}
              disabled={write.isPending}
            >
              Not so
            </Button>
          </div>
        </Alert>
      )}

      <div className="flex flex-wrap gap-2">
        <label className="flex items-center gap-1 text-sm text-ink-muted">
          <input
            type="checkbox"
            checked={row.presence}
            disabled={write.isPending}
            onChange={(event) => {
              set('se.presence', event.target.checked);
            }}
          />
          In the scene
        </label>
        <label className="flex items-center gap-1 text-sm text-ink-muted">
          <span className="sr-only">{`Status for ${name}`}</span>
          <select
            className="rounded-control border border-line bg-surface p-1 text-ink"
            value={row.status}
            disabled={write.isPending}
            onChange={(event) => {
              set('se.status', event.target.value);
            }}
          >
            {/* The vocabulary the channel's schema accepts. A value this list
                does not offer is one the engine would refuse, so offering it
                would be a control that produces a recorded refusal. */}
            <option value="alive">Alive</option>
            <option value="dead">Dead</option>
            <option value="departed">Departed</option>
          </select>
        </label>
      </div>
    </div>
  );
}
