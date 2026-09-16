// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { useState } from 'react';
import { getRouteApi, Link, useNavigate } from '@tanstack/react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { ApiError, createSession, listModes, listSessions, type PublicMode } from '../api.js';
import { useCreateObject, useLibrary, useSetMemoryConfig } from '../queries.js';
import { parseList } from '../search-lists.js';
import { AlertNote } from '../ui/Alert.js';
import { Button } from '../ui/Button.js';
import { SelectorBar, selectionHref } from '../ui/SelectorBar.js';
import { CheckboxField, SelectField } from '../ui/Field.js';
import { link, page } from '../ui/classes.js';
import { Fine } from '../ui/Text.js';
import { RenameSession } from './RenameSession.js';
import { SetupFields } from './SetupFields.js';
import { setupFromForm } from './setup-from-form.js';
import { sessionLabel } from './session-label.js';

/**
 * The list of sessions, and the control that makes a new one.
 *
 * ~~Deliberately the smallest thing that gets somebody to the play surface: no
 * cast picker, no mode picker, no preset picker.~~ **Half of that survived
 * [P6B.0] and half of it was the reason PLAYABLE could not run.**
 *
 * The reasoning was ~~right about the cast~~ **right about half the cast** —
 * that surface is
 * [P7.2](../../../../docs/design/workplan/23-p7-implementation.md)'s and P7
 * turns `cast` into a channel — and wrong about everything a session
 * *retrieves* from.
 *
 * ***The half it was wrong about is the persona, 2026-09-11.***
 * [P7 §1.6](../../../../docs/design/workplan/23-p7-implementation.md) corrects
 * the sentence this deferral leaned on: **`cast` does not stop being a field.**
 * What moves to channel state is `cast.actors`; `cast.persona` stays, because
 * [06 §8](../../../../docs/design/06-modes-and-turn-pipeline.md) and
 * [03 §5.5](../../../../docs/design/03-data-model.md) both make it *"the one
 * part that can stay a plain session field… chosen at setup"*. So a persona
 * control is permanent surface and an actors control is not, and the blanket
 * deferral was costing the first to defer the second.
 *
 * **And the cost was the same class P6B.0 just paid for lore.** The shipped
 * preset carries an `se.persona` slot with `omitWhenEmpty: true`, and
 * `collect.ts` resolves `{{user}}` to `context.persona?.actor.name ?? 'the
 * player'`. Every session started in a browser had `persona: null` — so the
 * slot emitted nothing, the instruction addressed *the player*, and the one
 * thing the model was told about who it is narrating for was absent. `pnpm
 * seed` set one; a person could not. `POST /api/sessions` has accepted `treatment`, `lore` and
 * `preset` since P5.6; this form sent `name` alone, so no session made in the
 * browser ever resolved a lorebook, and the retrieval half of P5 was
 * unreachable from the product
 * ([P5 §0.5](../../../../docs/design/workplan/17-p5-implementation.md),
 * [P6B §0.1](../../../../docs/design/workplan/20-p6b-playable.md)).
 *
 * **The preset belongs here specifically**, because it is the one field with no
 * route to change it afterwards: a session copies its preset at creation
 * ([P4 §1.9](../../../../docs/design/workplan/16-p4-implementation.md)), so a
 * session started without one is permanently on the built-in default and an
 * imported preset is unplayable. Lore is changeable mid-session
 * (`LorePanel`); this is not.
 *
 * **Behind a disclosure**, so the fast path — a name and Start — is still one
 * line, and the summary says what the session will be given so the choice is
 * not silently skipped.
 */
/**
 * The answers this mode actually asked for.
 *
 * **A filter rather than a reset**, which is what lets the state survive a
 * person switching modes to look and switching back. The route refuses a key the
 * mode never declared — deliberately, because ignoring one would teach the next
 * version of this client that it worked — so the two honest options are to drop
 * what is not asked for or to clear on every change, and dropping is the one
 * that does not lose work.
 */
const routeApi = getRouteApi('/play');

/**
 * What the mode bar calls the sessions of each mode.
 *
 * **The client's words, keyed by the mode's id** — `InputKind`'s arrangement,
 * and for its reason: [01 §2] keeps English out of what the server sends, and
 * `ModeDefinition.displayName` says in the SDK that it is *never rendered*. A
 * plural on the mode contract would have been more English on the wire, so the
 * bar's words live here instead.
 *
 * *A mode this build has no word for falls back to its `displayName`, then its
 * id* — the fallback `InputKind` makes, because hiding a mode the install has
 * registered would hide a capability. (The Mode select below still renders
 * `displayName` directly, which is the same rule bent one step further; it
 * predates this table.)
 */
const MODE_PLURALS: Record<string, string> = {
  'storyengine.scene': 'Scenes',
  'storyengine.freeform': 'Freeform',
};

export function modeLabel(mode: Pick<PublicMode, 'id' | 'displayName'>): string {
  return MODE_PLURALS[mode.id] ?? (mode.displayName === '' ? mode.id : mode.displayName);
}

/** `{}` is *no wizard ran*, and a key that says so would be a claim. */
function spreadSetup(answers: Record<string, unknown>): { modeConfig?: Record<string, unknown> } {
  return Object.keys(answers).length === 0 ? {} : { modeConfig: answers };
}

/**
 * What a refused Start says.
 *
 * **The field names travel**, which is the whole reason the route sends them: a
 * wizard is a form the engine generated from a mode's declaration, so a refusal
 * reading only *that is not what this mode asked for* leaves somebody looking at
 * controls they did not design and guessing which one it meant.
 *
 * *Ajv's paths rather than the widget labels, deliberately — this page would
 * have to map one to the other, and a mapping written here would be a third
 * description of a field beside the declaration and the derived schema. A path
 * is `/difficulty`, which names the control a person is looking at.*
 */
function refusal(error: Error): string {
  const issues = error instanceof ApiError ? (error.issues ?? []) : [];
  return issues.length === 0 ? error.message : `${error.message} ${issues.join('; ')}`;
}

function answersFor(
  mode: PublicMode | null,
  answers: Record<string, unknown>,
): Record<string, unknown> {
  if (mode?.setup.kind !== 'declared') return {};

  const asked = new Set((mode.setup as { fields?: { id: string }[] }).fields?.map((f) => f.id));
  return Object.fromEntries(Object.entries(answers).filter(([id]) => asked.has(id)));
}

export function SessionsPage(): React.JSX.Element {
  const queryClient = useQueryClient();
  const [name, setName] = useState('');
  const [treatment, setTreatment] = useState('');
  const [preset, setPreset] = useState('');
  const [persona, setPersona] = useState('');
  const [lore, setLore] = useState<string[]>([]);
  const [mode, setMode] = useState('');
  /**
   * **Keyed by field id and not cleared when the mode changes.** Switching modes
   * to look at a wizard and switching back should not lose what was typed, and
   * the answers a mode did not ask for are refused at the route rather than
   * stored — so the only cost of keeping them is a key the next request does not
   * send, which `answersFor` drops.
   */
  const [setup, setSetup] = useState<Record<string, unknown>>({});
  /** The session just created, when its treatment has been played before — [08 §6]. */
  const [replaying, setReplaying] = useState<{
    sessionId: string;
    others: { sessionId: string; name: string }[];
  } | null>(null);

  const sessions = useQuery({ queryKey: ['sessions'], queryFn: listSessions });
  const modes = useQuery({ queryKey: ['modes'], queryFn: listModes });
  const books = useLibrary('lorebooks');
  const treatments = useLibrary('treatments');
  const presets = useLibrary('presets');
  const actors = useLibrary('actors');

  /**
   * The mode being configured, and the declaration its wizard renders from.
   *
   * Empty means *the install's default*, which is what every session before
   * [P7.4] got and what the route still does with an absent `mode` — so the
   * wizard shown is the default's, because that is the session the Start button
   * would actually create.
   */
  const chosen =
    (modes.data?.modes ?? []).find(
      (one) => one.id === (mode === '' ? modes.data?.defaultModeId : mode),
    ) ?? null;

  /**
   * The modes the list is narrowed to, and the sessions that survive it.
   *
   * **Intersected with the modes the server listed**, because the router could
   * only check that `?mode=` was a string: an id from an uninstalled mode, or a
   * typo, drops out here rather than narrowing the list to nothing. Every mode
   * named is the unfiltered list by another name, as `toggleSelection` has it.
   *
   * **A session with no mode is the default's**, which is how the server reads
   * one ([mode-registry] `DEFAULT_MODE_ID`, `gather.ts`) — a filter that left
   * every pre-P7 session out of *Scenes* would disagree with the engine that
   * runs them as scenes.
   */
  const navigate = useNavigate();
  const search = routeApi.useSearch();
  const modeList = modes.data?.modes ?? [];
  const requested = new Set(parseList(search.mode));
  const narrowed = modeList.map((one) => one.id).filter((id) => requested.has(id));
  const shownModes = narrowed.length === modeList.length ? [] : narrowed;
  const listed = (sessions.data?.sessions ?? []).filter(
    (session) =>
      shownModes.length === 0 ||
      shownModes.includes(session.mode?.id ?? modes.data?.defaultModeId ?? ''),
  );

  /**
   * Every library name this form has offered, by id — for the `Ref`s a saved
   * Setup stores. [04 §3] resolves a ref by id *and* by name, so a Setup that
   * kept bare ids would travel to another install and resolve to nothing.
   */
  const names: Record<string, string> = {};
  for (const shelf of [treatments, presets, actors, books]) {
    for (const one of shelf.data?.objects ?? []) names[one.id] = one.name;
  }

  const form = {
    name,
    mode: chosen?.id ?? '',
    modeConfig: answersFor(chosen, setup),
    treatment,
    preset,
    persona,
    lore,
    names,
  };

  /**
   * **Saving the configuration as a Setup** — [04 §7], [P7.4], and the *making*
   * surface that kind has never had.
   *
   * Not a third hand-written editor: a Setup **is** how to start playing, and
   * this form collects exactly that control for control. What gets saved is what
   * `POST /api/sessions` reads back out of one, which is the round trip
   * `setup-from-form.ts` exists to keep honest.
   */
  const saveSetup = useCreateObject();

  const create = useMutation({
    mutationFn: () =>
      createSession({
        ...(name.trim() === '' ? {} : { name }),
        ...(treatment === '' ? {} : { treatment }),
        ...(preset === '' ? {} : { preset }),
        ...(persona === '' ? {} : { persona }),
        ...(lore.length === 0 ? {} : { lore }),
        // The effective id, not the state: a form that rendered the default's
        // wizard and then sent no `mode` would be right only by coincidence.
        ...(chosen === null ? {} : { mode: chosen.id }),
        // Spread like every other field here rather than always passed: *not
        // asked* and *asked and answered with nothing* are different, and only
        // one of them belongs on the wire.
        ...spreadSetup(answersFor(chosen, setup)),
      }),
    onSuccess: (created) => {
      setName('');
      setTreatment('');
      setPreset('');
      setPersona('');
      setLore([]);
      setSetup({});
      /**
       * ***Replaying a treatment you have played*** — [08 §6], [P8.5].
       *
       * Spoiler bleed is the failure *"most likely to make someone turn the
       * whole feature off"*, and 08 §6's cheapest mitigation is this one:
       * **warn at session creation when a new session's treatment matches an
       * existing one, and offer to start isolated.**
       *
       * *Nothing has been imported yet*, which is why a notice beside the new
       * session is the same protection as a modal in front of the button: a
       * session is created with no turns, so intake has had no occasion to
       * import anything until somebody plays one.
       */
      setReplaying(
        created.sharesTreatmentWith === undefined || created.sharesTreatmentWith.length === 0
          ? null
          : { sessionId: created.session.id, others: created.sharesTreatmentWith },
      );
      void queryClient.invalidateQueries({ queryKey: ['sessions'] });
    },
  });

  /**
   * ***One obvious action, which is what [08 §4]'s `[OPEN]` asks for.***
   *
   * That paragraph leaves `share: true` by default open — *"every throwaway
   * session contributes"* — with the mitigation that **isolating a session must
   * be one obvious action rather than two toggles found in a drawer**. This is
   * the action: both switches off, in one press, at the one moment somebody
   * knows they are replaying something.
   */
  const isolate = useSetMemoryConfig(replaying?.sessionId ?? '');

  return (
    // A `div`, not a landmark — the shell owns the routed app's one `<main>`
    // ([P3.−1]); this page declared a second one inside it. The column is
    // `page.tooling`, not the reading measure it used to borrow: a
    // list-plus-form management page is tooling, and the reading measure is
    // the story column's ([10 §1.2]).
    <div className={`${page.tooling} flex flex-col gap-4`}>
      <h1 className="text-section text-ink">Sessions</h1>

      {replaying === null ? null : (
        <AlertNote>
          <div className="flex flex-col gap-2">
            <span>
              {`You have played this treatment before — ${replaying.others.map((one) => one.name).join(', ')}. Memories from ${replaying.others.length === 1 ? 'it' : 'them'} can reach this session, twists included.`}
            </span>
            <div className="flex gap-2">
              <Button
                type="button"
                disabled={isolate.isPending}
                onClick={() => {
                  isolate.mutate(
                    { share: false, intake: false, acrossPersonas: false, associations: {} },
                    {
                      onSuccess: () => {
                        setReplaying(null);
                      },
                    },
                  );
                }}
              >
                Start isolated
              </Button>
              <Button
                type="button"
                variant="quiet"
                onClick={() => {
                  setReplaying(null);
                }}
              >
                Keep memories on
              </Button>
            </div>
          </div>
        </AlertNote>
      )}

      <form
        className="flex flex-col gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          /**
           * **Start just starts.**
           *
           * This was `if (name.trim().length > 0) create.mutate()`, so pressing
           * Start with an empty box did nothing at all — not refused, not
           * prevented, just silently ignored, which is the one shape
           * [10 §11.1a](../../../../docs/design/10-ui-surfaces.md) was written against. The
           * resolution is removing the requirement rather than adding a
           * refusal: a session is id-addressed, so an unnamed one freezes
           * nothing, and the name can arrive later through `RenameSession`.
           */
          create.mutate();
        }}
      >
        <div className="flex gap-2">
          <label className="flex-1">
            <span className="sr-only">Name for the new session, if you have one</span>
            <input
              className="w-full rounded-control border border-line-strong bg-surface p-2 text-ink placeholder:text-ink-faint focus-visible:outline-2 focus-visible:outline-focus"
              value={name}
              placeholder="Name it now, or later"
              onChange={(event) => {
                setName(event.target.value);
              }}
            />
          </label>
          <Button type="submit" variant="primary" disabled={create.isPending}>
            Start
          </Button>
        </div>

        <details className="rounded-control border border-line bg-surface px-3 py-2">
          <summary className="cursor-pointer text-sm text-ink-subtle">
            {setupLine(lore.length, treatment !== '', preset !== '', persona !== '')}
          </summary>

          <div className="mt-3 flex flex-col gap-3">
            <SelectField
              label="Mode"
              // The effective id rather than the state, so the control shows the
              // mode the Start button would actually create — which is the
              // install's default until somebody picks otherwise.
              value={chosen?.id ?? ''}
              options={(modes.data?.modes ?? []).map(
                (one) => [one.id, one.displayName] as [string, string],
              )}
              onChange={setMode}
              hint="What kind of story this is. It decides what is asked below, and cannot be changed afterwards."
            />

            {/*
              **The wizard, rendered from the mode's declaration and nothing
              else** — [06 §7.3], [P7.4]. `SetupFields` has never heard of any
              mode; it knows a widget vocabulary and a loop, which is what makes
              the stage's exit line — *a wizard for a mode the engine has no
              knowledge of* — true of this page rather than only of the route.
            */}
            <SetupFields
              setup={chosen?.setup ?? { kind: 'none' }}
              answers={setup}
              onChange={setSetup}
            />

            <SelectField
              label="Treatment"
              value={treatment}
              options={[
                ['', 'None'],
                ...(treatments.data?.objects ?? []).map(
                  (one) => [one.id, one.name] as [string, string],
                ),
              ]}
              onChange={setTreatment}
              hint="A treatment brings its own lorebooks and its own framing."
            />

            {/*
             * ***The blank option acquired a visible twin at [P7B.0]***, and
             * keeping both is the decision.
             *
             * This list is the library's, so it now carries the shipped packs
             * as ordinary rows — the mode's own default appears here by its
             * name for the first time. That does **not** make the blank option
             * redundant, and the difference is worth the longer label: naming
             * *Scene* pins this session to that pack, while leaving it blank
             * says *whatever this mode ships*, which is a different answer the
             * next time the mode's default changes. Dropping it would take a
             * choice away and quietly convert every future session into a
             * pinned one.
             *
             * ***And its hint's second half stopped being true at [P7B.2]***
             * (corrected 2026-09-14). It read ~~*Copied into the session at
             * creation, and not changeable afterwards*~~; the session panel
             * switches the pack of a session already running, through
             * `PUT /api/sessions/:id/preset`. The first half did not move and
             * is the half worth keeping — it is [03 §8]'s copy, and the reason
             * editing a pack in the library cannot reach a game in progress.
             * *[P7B §1.7] named this comment and asked the stage that falsified
             * it to correct it; P7B.2 missed it and P7B.5's sweep caught it,
             * which is the order that rule is written to survive.*
             */}
            <SelectField
              label="Preset"
              value={preset}
              options={[
                ['', "The mode's own, whichever it ships"],
                ...(presets.data?.objects ?? []).map(
                  (one) => [one.id, one.name] as [string, string],
                ),
              ]}
              onChange={setPreset}
              hint="Copied into the session at creation. You can switch it later from the session's own panel, and the copy is what keeps a library edit from reaching a game in progress."
            />

            <SelectField
              label="Persona"
              value={persona}
              options={[
                ['', 'Nobody in particular'],
                ...(actors.data?.objects ?? []).map(
                  (one) => [one.id, one.name] as [string, string],
                ),
              ]}
              onChange={setPersona}
              hint="Who you are playing. The narrator is told, and addresses you by name."
            />

            <fieldset className="flex flex-col gap-2">
              <legend className="text-sm font-medium text-ink-muted">Lorebooks</legend>
              {(books.data?.objects ?? []).map((book) => (
                <CheckboxField
                  key={book.id}
                  label={book.name}
                  checked={lore.includes(book.id)}
                  onChange={(checked) => {
                    setLore(checked ? [...lore, book.id] : lore.filter((id) => id !== book.id));
                  }}
                />
              ))}
            </fieldset>

            <Fine>These can be changed from the session itself, except the preset.</Fine>

            {/*
              **Save the configuration, not the session** — [04 §7], [P7.4].
              A Setup is how to start playing, and everything above is that; so
              the making surface for the `setups/` kind is this form with a
              second verb rather than a third hand-written editor.
            */}
            <div className="flex items-center gap-2">
              <Button
                type="button"
                disabled={name.trim() === '' || saveSetup.isPending}
                onClick={() => {
                  saveSetup.mutate({ kind: 'setups', object: setupFromForm(form) });
                }}
              >
                Save as a setup
              </Button>
              <Fine>
                {name.trim() === ''
                  ? 'Name it first — a setup is a library object, and library objects have names.'
                  : 'Keeps this configuration to start from again.'}
              </Fine>
            </div>
          </div>
        </details>

        {create.isError ? <AlertNote role="alert">{refusal(create.error)}</AlertNote> : null}
        {saveSetup.isError ? <AlertNote role="alert">{refusal(saveSetup.error)}</AlertNote> : null}
        {saveSetup.isSuccess ? (
          <AlertNote role="status">{`Saved “${name.trim()}” to your setups.`}</AlertNote>
        ) : null}
      </form>

      {/*
        **The Library's kind bar, over sessions** — one `SelectorBar` for both,
        so a click means the same thing on either surface. Hidden while the
        install has one mode, because then every session is the same sort.
      */}
      <SelectorBar
        label="Filter by mode"
        allLabel="All sessions"
        options={modeList.map((one) => ({ value: one.id, label: modeLabel(one) }))}
        selected={shownModes}
        hrefFor={(next) => selectionHref('/play', 'mode', next)}
        onChange={(next) => {
          void navigate({ to: '/play', search: next.length === 0 ? {} : { mode: next.join(',') } });
        }}
      />

      {sessions.data !== undefined && sessions.data.sessions.length > 0 && listed.length === 0 ? (
        // Distinct from having no sessions, the Library's shelf-versus-filter
        // rule: the answer here is widening the bar, not starting one.
        <p className="text-ink-subtle">No sessions of this kind.</p>
      ) : null}

      <ul className="flex flex-col gap-2" aria-label="Sessions">
        {listed.map((session) => (
          <li key={session.id} className="flex items-center gap-2">
            {/*
              Through `sessionLabel`, which fixes a bug that predates unnamed
              sessions being reachable from here: a session whose name is `''`
              — one hand-edit away, since `session.json` is meant to be edited
              — rendered a link with no accessible name and nothing to click.
            */}
            <Link to="/play/$sessionId" params={{ sessionId: session.id }} className={link.object}>
              {sessionLabel(session.name)}
            </Link>
            <RenameSession sessionId={session.id} name={session.name} />
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * What the closed disclosure says the session will be given.
 *
 * One string rather than a sentence assembled around values in JSX, which is
 * the shape [19 §12.6a] forbids — and it is closed by default, so this line is
 * the only thing standing between somebody and a session that retrieves
 * nothing, which is the state every session was in before [P6B.0].
 */
export function setupLine(
  books: number,
  treatment: boolean,
  preset: boolean,
  persona: boolean,
): string {
  const parts: string[] = [];
  // **Persona first, because it is the one a reader is most likely to have
  // meant to set.** The others change what a session retrieves; this changes
  // who the story is about, and its absence is silent — the slot omits when
  // empty and the instruction falls back to "the player".
  if (persona) parts.push('a persona');
  if (treatment) parts.push('a treatment');
  if (books === 1) parts.push('one lorebook');
  if (books > 1) parts.push(`${String(books)} lorebooks`);
  if (preset) parts.push('a preset');
  if (parts.length === 0) return 'Nothing chosen yet — the mode default, and no lorebooks';
  return `With ${parts.join(', ')}`;
}
