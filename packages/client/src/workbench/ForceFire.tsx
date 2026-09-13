// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import type { JSX } from 'react';

import { useSession, useWriteChannel } from '../queries.js';
import { Button } from '../ui/Button.js';
import { hookWords } from '../play/hookWords.js';
import { Fine, SubsectionTitle } from '../ui/Text.js';

/**
 * Force-fire — [06 §6.1](../../../../docs/design/06-modes-and-turn-pipeline.md),
 * [10 §10.1](../../../../docs/design/10-ui-surfaces.md), built at
 * [P7.5](../../../../docs/design/workplan/23-p7-implementation.md).
 *
 * *"The hook is delivered on the next turn with no judgement call at all."*
 *
 * ***Here and not on the hook panel, which is a decision rather than filing.***
 * 10 §10.1: *"Commit is a move in the story and belongs where the story is
 * played; force-fire is a test of the material and belongs in the workbench,
 * beside the keyword test and the dry run it is a sibling of."* And the reason
 * it matters: *"splitting them keeps a control that skips the engine's judgement
 * out of the surface people play on."* The panel has a test asserting this
 * button is not over there.
 *
 * **The siblings are real ones.** The dry run is `PreviewSubject` above it and
 * the generalised keyword test is `LoreReportView` inside that — both in this
 * panel, both answering *what would happen if I sent this*, which is the
 * question this one asks about the other half of the material.
 *
 * *No scratch preview, and [06 §6.1] declined it explicitly*: a hook auditioned
 * without joining the tree would spare the author a rewind, *"but rewind here is
 * a pointer, the rewrite-versus-reroll distinction is already specified, and the
 * workbench already promotes a dry run. Auditioning a hook is therefore a short
 * loop, and buying a marginally shorter one with a second assembly path to keep
 * correct is a bad trade."*
 *
 * **A channel write, and the same route Commit uses** — `se.hook#<id>` set to
 * `forced`. The intent has to survive between the click and the turn, and a
 * channel is the only home that branches: force a hook, rewind past the forcing,
 * and it is not forced on the line you came back to.
 */
export function ForceFire({ sessionId }: { sessionId: string }): JSX.Element | null {
  const session = useSession(sessionId);
  const write = useWriteChannel(sessionId);
  /**
   * **Bound and then read, not `data?.hooks.rows`.** An optional chain stops at
   * the `?.` that made it one, so the second access is a plain one — a session
   * answered by a build without this field throws there rather than reading as
   * *no hooks*, which is what twenty-two dock tests said at once. Binding first
   * gives the intermediate an `undefined` of its own, which is also why the lint
   * rule accepts the second `?.` here and rejected it in the one-liner.
   */
  const hooks = session.data?.hooks;
  const rows = hooks?.rows ?? [];

  /**
   * **Only the hooks that have not gone.** A fired one has nothing left to
   * audition, and offering it would be offering to *un-fire* it by a side
   * effect of the states being exclusive — which is a real act and not one to
   * reach by pressing a button labelled *Fire next turn*.
   */
  const waiting = rows.filter((row) => row.state !== 'fired' && row.state !== 'provisional');
  if (waiting.length === 0) return null;

  return (
    <section className="flex flex-col gap-2">
      <SubsectionTitle>Audition a hook</SubsectionTitle>
      <Fine>
        Delivered on the next turn with no judgement call. Rewind afterwards to put it back.
      </Fine>
      {waiting.map((row) => (
        <div key={row.hookId} className="flex flex-wrap items-center gap-2">
          <span className="text-sm text-ink">{row.title}</span>
          {/* The clause it would skip, said before it is skipped rather than
              after — the same obligation Commit's confirmation carries, and a
              control that skips *more* owes the sentence more, not less. */}
          {row.refusal === null ? null : <Fine>{hookWords(row.refusal)}</Fine>}
          <Button
            type="button"
            disabled={write.isPending || row.state === 'forced'}
            onClick={() => {
              write.mutate({ key: `se.hook#${row.hookId}`, value: 'forced' });
            }}
          >
            {row.state === 'forced' ? 'Firing next turn' : 'Fire next turn'}
          </Button>
        </div>
      ))}
    </section>
  );
}
