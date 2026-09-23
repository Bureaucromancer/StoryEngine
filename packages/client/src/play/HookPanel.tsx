// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { useState, type JSX } from 'react';

import {
  ApiError,
  PROMOTE_DIRECTORIES,
  type HookRow,
  type LibraryObject,
  type PromoteTarget,
  type PromoteTargetKind,
  type SessionSummary,
} from '../api.js';
import {
  useLibrary,
  usePromoteHook,
  useSession,
  useSessionHooks,
  useWriteChannel,
} from '../queries.js';
import { Alert, AlertNote } from '../ui/Alert.js';
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
 * **Two fields, and it is still not an editor.** A `PlotHook` has eight of
 * them; this writes two and defaults the other six to what a hook typed here
 * would want: `local` blast radius, ordinary weight, woven rather than
 * expanded, once.
 *
 * ~~*there is no treatment editor and no setup editor*~~ — **there are both,
 * since [P7B], and since [P11.2] all three of 03 §4.1's carriers edit their
 * hooks.** What [P7 §1.5] recorded — *"a hook has nowhere to be authored"* —
 * is answered, and it was never this form's job to answer it. **The argument
 * for two fields survives the editors existing**, and it is [P7.5]'s: this is
 * the sentence the feature exists for — *"I want this to happen"* — and an
 * editor built inside a play-surface panel would still be a different surface
 * smuggled into one. A person mid-scene is not filling in `notBefore`.
 *
 * **What changed is that the other six fields now have somewhere to be, and
 * this panel can say where.** They are on whichever carrier holds the hook, in
 * that kind's editor; `Save this to…` on a row is how a hook typed here reaches
 * one, and everything this form defaulted is writable once it is there.
 *
 * *The id is the server's*, because a session's own hook is the one source with
 * no upstream object to keep one from, and without an id it could never be
 * committed, blocked, or recorded as fired. **It is also the same id on the
 * other side of a promotion** — [15 §5.1]'s obligation, and the reason saving
 * the same hook twice is refused rather than renamed.
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
          sessionId={props.sessionId}
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
 * **No Commit for a hook that has gone** — and it was *nothing but Remove*
 * until the control below joined it. Committing a fired hook is *un-firing* it
 * — the states are exclusive on one channel — which is a real thing a person
 * may want and is not something to offer by accident from a row that says
 * *Fired*.
 *
 * **Remove takes any hook, whichever source put it there**, which is
 * [00 §3.1]'s prefill-not-binding: the pool was **copied** at creation, so a
 * treatment-borne row is this session's copy and refusing to remove it would
 * make the copy a binding. It does not reach the treatment — the same asymmetry
 * running the other way.
 *
 * ***`Save this to…` takes any hook too, and for a second reason on top of
 * that one.*** It is an act on the **library**, about the hook as authored
 * material rather than about what has become of it here — so it sits outside
 * the `gone` gate above, and a row that says *Fired* offers it as readily as a
 * waiting one. Often more so: the hook worth keeping is frequently the one that
 * has just gone off well.
 */
function Controls(props: {
  sessionId: string;
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
    <div className="flex flex-wrap items-start gap-2">
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
      <SaveTo sessionId={props.sessionId} row={row} pending={props.pending} />
    </div>
  );
}

/**
 * ***Saving a hook out of the session it was realised in*** — [03 §4.1],
 * [06 §6.1], [15 §5.1], [P11.2].
 *
 * **The valve the pool has never had.** `hook-pool.ts` fills a session from the
 * three carriers at creation and this panel adds more while playing, and until
 * this control nothing ran the other way: a hook realised mid-play — which
 * [06 §6.1] calls *most of why the feature earns its place* — died with the
 * session it was realised in.
 *
 * ***Offered, never automatic.*** [03 §2.3] wrote the rule for session-local
 * actors — *"an agent may suggest it; nothing auto-promotes"* — and this is the
 * first place in the product with something for it to govern. A hook does not
 * drift onto the treatment because it fired well, and playing on will never
 * save one by itself.
 *
 * **The targets are the objects this session already names**, which is two
 * lists joined rather than one: `session.treatment`, `session.setup` and
 * `session.lore`, plus whatever the pool's own rows say they came from. Neither
 * alone is enough — a carrier with no hooks seeds no row while being a perfectly
 * good place to put one, and the pool's rows are the only thing that names a
 * carrier the session fields do not. **Offering the whole library instead would
 * be a library browser grown inside a play panel**, and it would offer a
 * treatment this session has never heard of as readily as its own.
 *
 * ~~`SessionSummary` has never carried a `setup` field, so the Setup's id
 * reaches this client only as the `source` of a row it seeded.~~ ***That was
 * true of the interface and never of the route***, and reading it as a fact
 * about the wire cost the Setup the one case it most needed: a Setup with no
 * `hooks[]` — which is what a Setup looks like before anybody has written one —
 * could never be offered, so the first hook somebody wanted to put on one had
 * nowhere to go. `GET /api/sessions/:id` sends the whole session file and
 * `SessionFile.setup` is a copy of the Setup carrying its library id, so the
 * field is claimed in `api.ts` on the terms that interface sets and read here.
 * [10 §10.1] and [03 §4.1] both say the control offers the Setup; now it does.
 *
 * *Names rather than ids*, resolved through `useLibrary` the way `CastPanel`
 * resolves an actor — **and an object the library cannot name falls back to its
 * id rather than disappearing from the list.** A session can name something
 * deleted since, and [00 §3.3]'s dangling reference is a thing to show:
 * choosing it is answered *that one is gone*, which is a truer sentence than an
 * option that was never offered.
 *
 * ***It has to say where the hook went, because the row will not.*** Nothing
 * visible here changes after a successful save — the pool entry keeps its own
 * source, the hook goes on being eligible in this session, and that is the
 * design and not an oversight: the running game is unchanged by promotion. So
 * the confirmation naming the object is the only evidence the act happened, and
 * the refusal on a second press has to name it for the same reason.
 */
function SaveTo(props: { sessionId: string; row: HookRow; pending: boolean }): JSX.Element | null {
  const session = useSession(props.sessionId);
  const promote = usePromoteHook(props.sessionId);

  /**
   * *Three listings rather than one unfiltered `useLibrary()`.* Two of these
   * keys are already held by the play page and the lore panel, so the ordinary
   * case issues no request at all — the trade `LorePanel` makes beside it —
   * while listing everything would be a fourth poll of the whole library for
   * the sake of three names.
   */
  const treatments = useLibrary(PROMOTE_DIRECTORIES.treatment);
  const setups = useLibrary(PROMOTE_DIRECTORIES.setup);
  const books = useLibrary(PROMOTE_DIRECTORIES.lore);

  const listed: Record<PromoteTargetKind, readonly LibraryObject[]> = {
    treatment: treatments.data?.objects ?? [],
    setup: setups.data?.objects ?? [],
    lore: books.data?.objects ?? [],
  };

  const targets = targetsFor(session.data?.hooks.rows ?? [], session.data?.session);

  /**
   * **Nothing when there is nowhere**, which is the rule the neighbouring
   * panels follow and the one place this surface can keep it: a session with no
   * treatment, no Setup and no books has nowhere to save a hook to, and a
   * select offering only its own placeholder would be an affordance for an act
   * that cannot be performed.
   */
  if (targets.length === 0) return null;

  const keyOf = (target: PromoteTarget): string => `${target.kind}:${target.id}`;
  const nameOf = (target: PromoteTarget): string =>
    listed[target.kind].find((one) => one.id === target.id)?.name ?? target.id;

  /** Which one was asked for, so a refusal can name it. */
  const chosen = promote.variables?.target;

  return (
    <div className="flex flex-col gap-1">
      {/* A select written out rather than `SelectField`, for the reason
          `Pacing` above is written out: the field wrapper has no disabled
          state, and a control that cannot be pressed while the last press is
          in flight has to look like one — which is the defect `Button`'s own
          docstring exists to stop growing back. The visible affordance is the
          placeholder option, so the label is the row's, out of sight and in
          the accessibility tree: every row's control would otherwise be called
          the same thing. */}
      <label className="flex items-center gap-2 text-sm text-ink-muted">
        <span className="sr-only">{`Save ${props.row.title} to`}</span>
        <select
          className="rounded-control border border-line bg-surface p-1 text-ink"
          value=""
          disabled={props.pending || promote.isPending}
          onChange={(event) => {
            const target = targets.find((one) => keyOf(one) === event.target.value);
            if (target === undefined) return;
            // **The row's own source travels with the request**, because the
            // pool may hold two rows under one hook id with different content
            // and an id alone names the first of them rather than this one.
            // `sessions/promote.ts` argues what that costs when it is missing.
            promote.mutate({ hookId: props.row.hookId, target, from: props.row.source });
          }}
        >
          <option value="">Save this to…</option>
          {targets.map((target) => (
            <option key={keyOf(target)} value={keyOf(target)}>
              {nameOf(target)}
            </option>
          ))}
        </select>
      </label>

      {promote.isError ? (
        <AlertNote role="alert">
          {promoteWords(promote.error, chosen === undefined ? 'it' : nameOf(chosen))}
        </AlertNote>
      ) : promote.isSuccess ? (
        <Fine>{`Saved to “${promote.data.object.name}”.`}</Fine>
      ) : null}
    </div>
  );
}

/** [03 §4.1]'s own order: treatment primary, Setup override, lorebook secondary. */
const TARGET_ORDER: Record<PromoteTargetKind, number> = { treatment: 0, setup: 1, lore: 2 };

/**
 * The objects a hook can be saved onto, in the order 03 §4.1 ranks them.
 *
 * **Deduplicated by kind *and* id rather than by id alone**, because the two
 * halves of the key are independent: nothing stops a treatment and a lorebook
 * carrying the same id, and a list that collapsed them would silently drop a
 * real target — quietly, and only for the people whose libraries happen to
 * collide.
 *
 * *The pool contributes its sources rather than its own hooks' ids*: a row
 * whose source is the session names nothing, which is right. Promoting a hook
 * onto the session it is already in is not an act.
 *
 * ***All three of the session's own carriers are pushed before the rows are
 * walked***, so a carrier that seeded no pool row — a Setup or a lorebook
 * carrying no hooks of its own, which is the ordinary state of both — is offered
 * anyway. The rows then add whatever the session fields do not name, and the
 * dedupe collapses the overlap. Leaving any of the three to the rows alone makes
 * *can I save a hook here* depend on whether a hook was already here, which is
 * backwards.
 */
function targetsFor(
  rows: readonly HookRow[],
  session: SessionSummary | undefined,
): PromoteTarget[] {
  const named: PromoteTarget[] = [];
  if (session?.treatment != null) named.push({ kind: 'treatment', id: session.treatment });
  if (session?.setup?.id != null) named.push({ kind: 'setup', id: session.setup.id });
  for (const row of rows) {
    if (row.source.kind === 'session' || row.source.id === undefined) continue;
    named.push({ kind: row.source.kind, id: row.source.id });
  }
  for (const id of session?.lore ?? []) named.push({ kind: 'lore', id });

  const seen = new Set<string>();
  return named
    .filter((target) => {
      const key = `${target.kind}:${target.id}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => TARGET_ORDER[a.kind] - TARGET_ORDER[b.kind]);
}

/**
 * What a refused save says — **where the hook already is, rather than that
 * something went wrong**.
 *
 * ***A 409 here is the ordinary second press, not a failure.*** The row looks
 * exactly as it did after a successful save, so pressing again is a thing
 * people will do; what answers it is the fact that makes it a non-event. The
 * server's own *that object already carries this hook* is true and leaves
 * somebody hunting for which object, which is the same defect `hookWords`
 * exists to prevent one panel over: the class crosses the wire and the
 * sentence is the panel's.
 *
 * *`no-such-object` names it for the same reason.* The list is built from what
 * the session names and a session can name something deleted since ([00 §3.3]),
 * so *that object is gone* is a sentence about an option still on the screen.
 *
 * **Everything else is the server's sentence, unedited** — a `read-only` system
 * library, a target edited underneath this one, a hook the carrier's schema
 * refuses. Those are claims about the write, and a paraphrase here could only
 * blur them.
 */
function promoteWords(error: Error, where: string): string {
  if (!(error instanceof ApiError)) return error.message;
  switch (error.code) {
    case 'already-there':
      return `This hook is already on “${where}”.`;
    case 'no-such-object':
      return `“${where}” is gone.`;
    default:
      return error.message;
  }
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
