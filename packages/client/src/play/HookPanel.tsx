// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { useState, type JSX } from 'react';

import type { HookRow } from '../api.js';
import { useSession, useSessionHooks, useWriteChannel } from '../queries.js';
import { Alert } from '../ui/Alert.js';
import { Badge } from '../ui/Badge.js';
import { Button } from '../ui/Button.js';
import { Field } from '../ui/Field.js';
import { Fine } from '../ui/Text.js';
import { hookState, hookWords } from './hookWords.js';
import { disclosure } from '../ui/classes.js';

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

  /**
   * ***A disclosure rather than a panel, and always present rather than hidden
   * when the pool is empty.***
   *
   * The neighbouring surfaces render nothing when they have nothing, and this
   * one cannot: **the add form is inside it**, and [03 §4.1] calls adding a hook
   * to a running session *the primary path*. A panel that appeared only once a
   * session already had hooks would make the primary path reachable exclusively
   * from the path it is primary over. *Closed, it is one line saying how many
   * are waiting — which is the one fact worth having without opening, the same
   * trade the lore panel makes beside it.*
   */
  if (session.data === undefined) return null;

  return (
    <details className="rounded-control border border-line bg-surface px-3 py-2">
      <summary className={`${disclosure.quiet} text-sm`}>{waitingLine(rows)}</summary>

      <div className="mt-3 flex flex-col gap-3">
        {rows.length === 0 ? null : (
          <Pacing sessionId={props.sessionId} level={hooks?.pacing ?? 'normal'} />
        )}
        <div className="flex flex-col gap-2">
          {rows.map((row) => (
            <Hook key={row.hookId} sessionId={props.sessionId} row={row} />
          ))}
        </div>
        <AddHook sessionId={props.sessionId} />
      </div>
    </details>
  );
}

/**
 * The summary line — *how many are waiting*, which is what a closed disclosure
 * owes a reader.
 *
 * **Eligible rather than total**, because the total is a fact about the
 * treatment and the eligible count is a fact about *now*: six hooks of which
 * none can fire is the session state worth noticing from a closed panel, and a
 * bare *six plot hooks* would hide it.
 */
function waitingLine(rows: readonly HookRow[]): string {
  if (rows.length === 0) return 'Plot hooks — none yet';
  const ready = rows.filter((row) => row.refusal === null && row.state === null).length;
  const committed = rows.filter((row) => row.state === 'committed').length;
  const said = `Plot hooks — ${String(ready)} of ${String(rows.length)} eligible`;
  return committed === 0 ? said : `${said}, ${String(committed)} committed`;
}

/**
 * ***Adding one while the game is running*** — [03 §4.1]'s *primary path*,
 * [P7.5].
 *
 * **Two fields, and it is not an editor.** A `PlotHook` has eight of them and
 * [P7 §1.5] records that *"a hook has nowhere to be authored"* — there is no
 * treatment editor and no setup editor, and building one here would be a
 * different surface smuggled into a panel. What this is instead is the sentence
 * the feature exists for — *"I want this to happen"* — with the rest taking the
 * defaults a hook typed here would want: `local` blast radius, ordinary weight,
 * woven rather than expanded, once.
 *
 * *The id is the server's*, because a session's own hook is the one source with
 * no upstream object to keep one from, and without an id it could never be
 * committed, blocked, or recorded as fired.
 */
function AddHook(props: { sessionId: string }): JSX.Element {
  const hooks = useSessionHooks(props.sessionId);
  const [title, setTitle] = useState('');
  const [premise, setPremise] = useState('');

  function add(): void {
    hooks.mutate(
      {
        add: {
          title,
          premise,
          magnitude: 'local',
          involves: [],
          weight: 1,
          delivery: 'guidance',
          once: true,
        },
      },
      {
        onSuccess: () => {
          setTitle('');
          setPremise('');
        },
      },
    );
  }

  return (
    <form
      className="flex flex-col gap-2 border-t border-line pt-2"
      onSubmit={(event) => {
        event.preventDefault();
        add();
      }}
    >
      <Field label="Something you want to happen" value={title} onChange={setTitle} />
      <Field
        label="What happens"
        value={premise}
        onChange={setPremise}
        multiline
        rows={2}
        hint="The selector decides when. It is never shown until it fires."
      />
      <div>
        {/* Disabled on an empty premise rather than refused after the fact: the
            premise **is** the hook, and one with nothing to weave would sit in
            the pool being eligible forever. */}
        <Button type="submit" disabled={premise.trim() === '' || hooks.isPending}>
          Add
        </Button>
      </div>
    </form>
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
  const hooks = useSessionHooks(props.sessionId);
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
          pending={write.isPending || hooks.isPending}
          onCommit={commit}
          onAsk={() => {
            setAsking(true);
          }}
          onRelease={() => {
            write.mutate({ key: `se.hook#${row.hookId}`, value: null });
          }}
          onRemove={() => {
            hooks.mutate({ remove: row.hookId });
          }}
        />
      )}
    </div>
  );
}

/**
 * What a row offers, which depends on what has happened to it.
 *
 * **Nothing but Remove for a hook that has gone.** Committing a fired hook is
 * *un-firing* it — the states are exclusive on one channel — which is a real
 * thing a person may want and is not something to offer by accident from a row
 * that says *Fired*.
 *
 * **Remove takes any hook, whichever source put it there**, which is
 * [00 §3.1]'s prefill-not-binding: the pool was **copied** at creation, so a
 * treatment-borne row is this session's copy and refusing to remove it would
 * make the copy a binding. It does not reach the treatment — the same asymmetry
 * running the other way.
 */
function Controls(props: {
  row: HookRow;
  pending: boolean;
  onCommit: () => void;
  onAsk: () => void;
  onRelease: () => void;
  onRemove: () => void;
}): JSX.Element {
  const { row } = props;
  const gone = row.state === 'fired' || row.state === 'provisional';

  return (
    <div className="flex gap-2">
      {gone ? null : row.state === 'committed' ? (
        <Button type="button" onClick={props.onRelease} disabled={props.pending}>
          Release
        </Button>
      ) : (
        <Button
          type="button"
          onClick={row.refusal === null ? props.onCommit : props.onAsk}
          disabled={props.pending}
        >
          Commit
        </Button>
      )}
      <Button type="button" onClick={props.onRemove} disabled={props.pending}>
        Remove
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
