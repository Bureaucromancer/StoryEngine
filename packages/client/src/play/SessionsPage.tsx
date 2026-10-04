// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { useState } from 'react';
import { getRouteApi, Link, useNavigate } from '@tanstack/react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import {
  ApiError,
  createSession,
  errorCode,
  listModes,
  listSessions,
  type LibraryObject,
  type PublicMode,
} from '../api.js';
import { useCreateObject, useLibrary, useSetMemoryConfig } from '../queries.js';
import { parseList } from '../search-lists.js';
import { AlertNote } from '../ui/Alert.js';
import { Button } from '../ui/Button.js';
import { SelectorBar, selectionHref } from '../ui/SelectorBar.js';
import { CheckboxField, SelectField } from '../ui/Field.js';
import { control, disclosure, link, page } from '../ui/classes.js';
import { Fine, Note, PageTitle } from '../ui/Text.js';
import { ImportSession } from './ImportSession.js';
import { RenameSession } from './RenameSession.js';
import { SetupFields } from './SetupFields.js';
import { setupFromForm } from './setup-from-form.js';
import { sessionLabel } from './session-label.js';
import { labels } from '../i18n/catalogue.js';

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
/** What the list says when it is not one — see the list's own comment. */
const LIST_WORDS = labels('play.sessions-list', {
  loading: 'Loading the sessions…',
  failed: 'The sessions could not be read. Try reloading the page.',
  none: 'No sessions yet. Start one above.',
  noneShown: 'No sessions yet. Start one above — archived sessions are hidden.',
});

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
/**
 * ***Who is in it, and how each of them opens*** — [P14 §1.8]'s *"creation
 * picks characters. The form picks a persona only today, and every session it
 * makes has an empty cast. Scene's form picks one or more characters and each
 * member's opening"*, built at [P14.5].
 *
 * **Outside the disclosure**, unlike the persona, because for a chat it is the
 * first question rather than a refinement: a Scene with nobody in it is a
 * narrator talking to an empty room. It shows for a mode that seats more than
 * one, and the openings only for a mode that writes an opening turn
 * (`PublicMode.openingTurn`) — a choice nothing reads is a control that lies.
 */
const CAST_WORDS = labels('sessions.cast', {
  legend: 'Characters',
  hint: 'Who is in the scene. In a chat they reply to you, and to each other.',
  opening: 'How {name} opens',
  primary: '{label} (their usual)',
  tooMany: 'This mode seats at most {max}.',
});

/** One written opening, as the pickers below need it. */
interface WrittenOpening {
  id: string;
  label: string;
  text: string;
}

/**
 * ***An object's written openings, shape-guarded*** — the library sends the
 * object as it is on disk, so nothing here trusts it.
 *
 * ***One reader for two objects*** (folded at the P15 merge, 2026-10-03). A
 * card and a Setup carry the same `Openings` shape ([04 §3]), and the merge
 * brought two readers of it — [P14.5]'s for a card and
 * [P15.4](../../../../docs/design/workplan/33-p15-setup-from-a-turn.md)'s for
 * a Setup, written the same week under the same name — which disagreed on
 * small things: which opening is the primary when `primaryWrittenId` names
 * none of them, what an unlabelled one is called, whether an id may be empty,
 * and (neither asked) whether a blank one counts. Two answers to one question
 * is how a picker comes to show one opening as *their usual* while the route
 * starts on another, so there is one answer, and it is the route's —
 * `writtenOf` in `sessions/opening.ts`, which the server's own merge made one
 * reader for both objects the same day.
 *
 * ***A written opening is one with words.*** The route drops an opening whose
 * text is blank before it greets with anything, checks a choice, or decides
 * whether a Setup carries one — so a blank greeting offered here was a choice
 * the route refuses as `unknown-opening`, which [P14.5]'s picker offered
 * because its reader did not ask; and a Setup whose only opening is blank is,
 * to the route, a Setup with none, whose party's greetings begin it.
 *
 * **The primary is the one `primaryWrittenId` names, else the first** — of
 * the openings that have words, as the route reads it, so a dangling id is
 * the first opening here too rather than a primary nothing matches. **An
 * empty id is skipped**: the schema's `Id` refuses one, and a choice could not
 * name it. What an opening is *called* is `openingName`'s, below, for both.
 */
function openingsOf(object: Record<string, unknown> | undefined): {
  primary: string | null;
  written: WrittenOpening[];
} {
  const openings = object?.['openings'];
  if (typeof openings !== 'object' || openings === null) return { primary: null, written: [] };
  const held = openings as Record<string, unknown>;
  const written = Array.isArray(held['written'])
    ? (held['written'] as unknown[]).flatMap((one) => {
        if (typeof one !== 'object' || one === null) return [];
        const { id, label, text } = one as Record<string, unknown>;
        return typeof id === 'string' && id !== '' && typeof text === 'string' && text.trim() !== ''
          ? [{ id, label: typeof label === 'string' ? label : '', text }]
          : [];
      })
    : [];
  const primary = written.find((one) => one.id === held['primaryWrittenId']) ?? written[0];
  return { primary: primary?.id ?? null, written };
}

/**
 * ***The greeting choices worth sending*** — for the members who would greet,
 * each one somebody changed from that member's usual. One rule for both
 * paths, the form's cast and a Setup's party, because the route reads one
 * `openings` map for either.
 */
function changedGreetings(
  members: readonly string[],
  picked: Readonly<Record<string, string>>,
  actors: readonly LibraryObject[],
): Record<string, string> {
  const changed: Record<string, string> = {};
  for (const id of members) {
    const choice = picked[id];
    const usual = openingsOf(actors.find((one) => one.id === id)?.object).primary;
    if (choice !== undefined && choice !== usual) changed[id] = choice;
  }
  return changed;
}

/** What an opening is called in the picker: its label, or the start of its text. */
function openingName(opening: { label: string; text: string }): string {
  if (opening.label.trim() !== '') return opening.label;
  const text = opening.text.trim();
  return text.length > 60 ? `${text.slice(0, 60)}…` : text;
}

const MODE_PLURALS: Record<string, string> = labels('play.mode-plural', {
  'storyengine.scene': 'Scenes',
  'storyengine.freeform': 'Freeform',
});

export function modeLabel(mode: Pick<PublicMode, 'id' | 'displayName'>): string {
  return MODE_PLURALS[mode.id] ?? (mode.displayName === '' ? mode.id : mode.displayName);
}

/**
 * ***Start cold***, as the opening select spells it — [03 §6]'s third choice.
 *
 * A sentinel rather than `null` because a `<select>` holds strings; a NUL
 * cannot be an opening id somebody typed, so it cannot collide with one.
 */
const COLD = '\u0000cold';

/**
 * ***A Setup's party, as the route seats it*** — `partyDefault`'s ids, the
 * persona left out, each once, which is `POST /api/sessions`' own reading
 * ([P15.3](../../../../docs/design/workplan/33-p15-setup-from-a-turn.md)).
 * The persona is `personaOptions[0]`, for the reason the route gives: a
 * session holds one persona, and until there is a control for choosing among
 * a Setup's the first is the honest default.
 */
function partyOf(setup: Record<string, unknown> | undefined): string[] {
  const cast = setup?.['cast'];
  if (typeof cast !== 'object' || cast === null) return [];
  const { personaOptions, partyDefault } = cast as Record<string, unknown>;
  const idOf = (ref: unknown): string => {
    const id = typeof ref === 'object' && ref !== null ? (ref as { id?: unknown }).id : undefined;
    return typeof id === 'string' ? id : '';
  };
  const persona = Array.isArray(personaOptions) ? idOf(personaOptions[0]) : '';
  const ids = Array.isArray(partyDefault) ? partyDefault.map(idOf) : [];
  return [...new Set(ids.filter((id) => id !== '' && id !== persona))];
}

/** The mode a Setup names, or `null` for *the install's default* — `''` is unset, as the route reads it. */
function modeOf(setup: Record<string, unknown> | undefined): string | null {
  const mode = setup?.['mode'];
  const id = typeof mode === 'object' && mode !== null ? (mode as { id?: unknown }).id : undefined;
  return typeof id === 'string' && id !== '' ? id : null;
}

/**
 * ***What the form says about a Setup's opening and its characters'
 * greetings*** — the owner's decision, [25 B18](../../../../docs/design/25-open-questions.md) (2026-10-03), recorded in
 * [P15](../../../../docs/design/workplan/33-p15-setup-from-a-turn.md).
 *
 * `greetingsSetAside` is the decision itself: a Setup that carries an opening
 * begins on it, always, and its characters' greetings are not written — not
 * even when *start cold* is chosen, because the Setup is what decides how its
 * story begins and *cold* is one of its answers. `greetingsBegin` is the other
 * side of the same rule: a Setup with no opening of its own, in a mode that
 * writes greetings, begins on its party's, and somebody may choose which.
 * `legend` names the pickers that side offers. `staleOpening` and
 * `openedSince` are what a Start refused with `unknown-setup-opening` or
 * `conflicting-openings` says — see {@link refusal}.
 */
const SETUP_WORDS = labels('sessions.setup', {
  greetingsSetAside:
    'This setup begins on its own opening, so its characters’ greetings are not used — not even if you start cold.',
  greetingsBegin: 'This setup has no opening of its own, so its characters’ greetings begin it.',
  legend: 'How they open',
  staleOpening:
    'That opening is no longer in the setup — it was changed after this page read it. Choose again.',
  openedSince:
    'This setup has an opening of its own now — it was changed after this page read it — so its characters’ greetings are not used. Start again to begin on its opening.',
});

/** The route's class for an `opening` the Setup does not hold — `docs/api.md`, `POST /api/sessions`. */
const SETUP_OPENING_REFUSED = 'unknown-setup-opening';
/** The route's class for a greeting chosen beside a Setup that carries an opening — the same route. */
const GREETING_SET_ASIDE = 'conflicting-openings';

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
 *
 * ***A Setup's opening that is gone is said by its class*** (2026-10-03, at
 * the P15 merge). The form only offers openings the Setup listed when the
 * page read it, so `unknown-setup-opening` reaches it one way: the Setup was
 * edited — in another tab, say — between that read and the Start. The route's
 * own sentence (*no such opening*) is true and unhelpful, since the select the
 * person used is the thing that offered it; this one says what happened and
 * what to do, and the Start's `onError` clears the stale choice so the next
 * Start is not the same refusal again. Read by the class rather than the
 * English, `errorCode`'s rule. *The code is the route's own since the merge*:
 * P15 and [P14.4] had both answered a missing opening with `unknown-opening`,
 * for causes in two different objects — a Setup's opening here, a
 * character's greeting there.
 *
 * ***And a greeting chosen for a Setup that has since gained an opening***,
 * `conflicting-openings` — the route refuses a greeting beside a Setup that
 * carries an opening, because under 25 B18 none will be written. This
 * form sends one only for a Setup it read as having none, so that refusal too
 * means the Setup changed underneath it; the choices are let go so the next
 * Start begins on the Setup's opening, which is what the route will do.
 */
function refusal(error: Error): string {
  if (errorCode(error) === SETUP_OPENING_REFUSED) return SETUP_WORDS.staleOpening;
  if (errorCode(error) === GREETING_SET_ASIDE) return SETUP_WORDS.openedSince;
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
  /** The characters, in the order picked — which is the cast's order, and a `list` round's. */
  const [members, setMembers] = useState<string[]>([]);
  /**
   * Actor id to the opening chosen for them; absent is their primary.
   *
   * *One map for both paths* — the form's cast and a Setup's party — because
   * the route reads one `openings` map for either, and a character is the
   * same card in both: a choice made for them in one is the choice the other
   * shows, rather than a second answer kept out of sight.
   */
  const [openings, setOpenings] = useState<Record<string, string>>({});
  /**
   * ***The Setup to start from, and which of its openings*** — [P15.4].
   *
   * `''` is *no Setup*, the form as it was. `opening` is `''` for the Setup's
   * primary, {@link COLD} for none, or an opening's id.
   */
  const [fromSetup, setFromSetup] = useState('');
  const [opening, setOpening] = useState('');
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

  /**
   * ***The archived ones, when asked for*** (2026-09-27). Archiving is
   * restorable by design ([03 §10.3]), and un-archiving is a control on the
   * session's own page — which nothing linked to once the session had left this
   * list, so the one way back was its address. Off by default, because an
   * archive is what a person put out of the way; its own key, so the default
   * list is never the one that grew.
   */
  const [showArchived, setShowArchived] = useState(false);
  const sessions = useQuery({
    queryKey: showArchived ? ['sessions', 'with-archived'] : ['sessions'],
    queryFn: () => listSessions(showArchived ? { archived: true } : undefined),
  });
  const modes = useQuery({ queryKey: ['modes'], queryFn: listModes });
  const books = useLibrary('lorebooks');
  const treatments = useLibrary('treatments');
  const presets = useLibrary('presets');
  const actors = useLibrary('actors');
  const setups = useLibrary('setups');
  const startingFrom = (setups.data?.objects ?? []).find((one) => one.id === fromSetup);
  const setupOpenings = openingsOf(startingFrom?.object);

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

  /**
   * The cast the Start button would seat: the picked characters the chosen
   * mode can seat, the persona left out of the list (they are sent as the
   * persona), and each member's opening only where it is not their usual.
   */
  const seats = chosen?.participants.maxActors ?? 1;
  /**
   * ***The characters picker is the form path's alone*** (2026-10-03, at the
   * P15 merge). The Setup path sends no `cast` — its party is the Setup's,
   * seated by the route — so a picker left showing above a chosen Setup would
   * be a control whose every tick is dropped on the way to the wire, which is
   * the control that lies [P14.5]'s comment on `CAST_WORDS` rules out. The
   * Setup's own characters get their pickers beside its opening instead.
   */
  const casting = seats > 1 && startingFrom === undefined;
  const seating = casting ? members.filter((id) => id !== persona).slice(0, seats) : [];
  const library = actors.data?.objects ?? [];
  const chosenOpenings = changedGreetings(seating, openings, library);

  /**
   * ***A Setup's characters, and whether they greet*** — the route's rule,
   * read off the same objects (`POST /api/sessions`, `sessions/opening.ts`).
   *
   * Greetings are written for a mode that declares `openingTurn`, by the
   * members of the Setup's party who have something written — and, under
   * 25 B18, **only when the Setup carries no opening of its own**. The
   * mode is the Setup's (or the install's default, for a Setup that names
   * none), not whatever this form's Mode select holds, because the Setup path
   * sends no `mode` and the route plays the Setup's.
   */
  const setupMode = (modes.data?.modes ?? []).find(
    (one) => one.id === (modeOf(startingFrom?.object) ?? modes.data?.defaultModeId),
  );
  const greeters =
    setupMode?.openingTurn === true
      ? partyOf(startingFrom?.object).flatMap((id) => {
          const actor = library.find((one) => one.id === id);
          return actor !== undefined && openingsOf(actor.object).written.length > 0 ? [actor] : [];
        })
      : [];
  const carriesOpening = setupOpenings.written.length > 0;
  const greetingsBegin = greeters.length > 0 && !carriesOpening;

  const create = useMutation({
    mutationFn: () =>
      /**
       * ***From a Setup, the Setup and nothing the form defaulted*** —
       * [P15.4]. The route layers a parameter over the Setup's value, so
       * sending this form's own defaults beside it would quietly replace what
       * the person chose with what the form happened to hold.
       *
       * ***And its characters' greetings only when they will be written***
       * (2026-10-03, at the P15 merge). The two paths stay apart — the Setup
       * path sends no `cast`, so [P14.5]'s characters picker is the form
       * path's — but they meet at `openings`, which the route reads for
       * whoever it seats: a Setup's party, when the Setup has no opening of
       * its own and its mode writes greetings. Under the owner's decision (25 B18) a
       * Setup that carries an opening starts on it and the greetings are not
       * written at all, so a choice among them is not sent; the form says so
       * beside the Opening select rather than leaving the pickers to vanish
       * unexplained.
       */
      startingFrom !== undefined
        ? createSession({
            ...(name.trim() === '' ? {} : { name }),
            setup: startingFrom.id,
            ...(opening === '' ? {} : { opening: opening === COLD ? null : opening }),
            ...(greetingsBegin
              ? {
                  openings: changedGreetings(
                    greeters.map((one) => one.id),
                    openings,
                    library,
                  ),
                }
              : {}),
          })
        : createSession({
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
            // The whole cast, persona included, when anybody was picked — the
            // route's `CastBody` takes both members. Nobody picked sends what it
            // always did: the persona alone, or nothing.
            ...(seating.length === 0
              ? {}
              : { cast: { persona: persona === '' ? null : persona, actors: seating } }),
            ...(chosen?.openingTurn === true ? { openings: chosenOpenings } : {}),
          }),
    onSuccess: (created) => {
      setName('');
      setTreatment('');
      setPreset('');
      setPersona('');
      setLore([]);
      setSetup({});
      setFromSetup('');
      setOpening('');
      setMembers([]);
      setOpenings({});
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
    onError: (error) => {
      // The opening chosen is not in the Setup any more (see `refusal`), so
      // the choice is cleared. Kept, the select would go on holding an id that
      // none of its options carries — the browser shows the first option and
      // the next Start sends the stale id again, to the same refusal. Cleared,
      // the next Start is the Setup's own opening, which is what the select
      // then shows. What it offers catches up by itself: `useLibrary` polls.
      if (errorCode(error) === SETUP_OPENING_REFUSED) setOpening('');
      // The Setup gained an opening since it was read, so the greetings chosen
      // for its party will not be written: the choices are let go, and the
      // next Start sends none, which the route takes as the Setup's opening.
      if (errorCode(error) === GREETING_SET_ASIDE) setOpenings({});
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
      <PageTitle>Sessions</PageTitle>

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
              className={control}
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

        {casting ? (
          <fieldset className="flex flex-col gap-2">
            <legend className="text-sm font-medium text-ink-muted">{CAST_WORDS.legend}</legend>
            <Fine>{CAST_WORDS.hint}</Fine>
            {(actors.data?.objects ?? [])
              .filter((one) => one.id !== persona)
              .map((actor) => {
                const picked = members.includes(actor.id);
                return (
                  <div key={actor.id} className="flex flex-wrap items-center gap-3">
                    <CheckboxField
                      label={actor.name}
                      checked={picked}
                      onChange={(checked) => {
                        setMembers(
                          checked
                            ? [...members, actor.id]
                            : members.filter((id) => id !== actor.id),
                        );
                      }}
                    />
                    {picked && chosen?.openingTurn === true ? (
                      <GreetingPicker
                        actor={actor}
                        value={openings[actor.id]}
                        onChange={(next) => {
                          setOpenings({ ...openings, [actor.id]: next });
                        }}
                      />
                    ) : null}
                  </div>
                );
              })}
            {members.filter((id) => id !== persona).length > seats ? (
              <Fine>{CAST_WORDS.tooMany.replace('{max}', () => String(seats))}</Fine>
            ) : null}
          </fieldset>
        ) : null}

        {/* ***Beside Start, because it makes the same thing*** — [P11 §3]'s row
            10. A session export loads as a new session with every branch, which
            is a different act from the library's object import and belongs
            where sessions are made rather than where objects are merged. */}
        <ImportSession />

        <details className="rounded-control border border-line bg-surface px-3 py-2">
          <summary className={`${disclosure.quiet} text-sm`}>
            {startingFrom !== undefined
              ? `From the setup “${startingFrom.name}”`
              : setupLine(lore.length, treatment !== '', preset !== '', persona !== '')}
          </summary>

          <div className="mt-3 flex flex-col gap-3">
            {/*
              ***A Setup is how to start playing*** — [04 §7], [P15.4]. The
              route has accepted one since [P7.4], and until this select the
              browser had no way to send it. Choosing one replaces the controls
              below rather than prefilling them: the Setup says everything they
              would, and a prefilled form would be a second copy of it that
              could drift from the object the person picked.
            */}
            <SelectField
              label="Start from a setup"
              value={fromSetup}
              options={[
                ['', 'None — choose everything below'],
                ...(setups.data?.objects ?? []).map(
                  (one) => [one.id, one.name] as [string, string],
                ),
              ]}
              onChange={(next) => {
                setFromSetup(next);
                setOpening('');
              }}
              hint="A saved way to begin — including one made from a point in another session."
            />

            {startingFrom !== undefined ? (
              <>
                {carriesOpening ? (
                  <SelectField
                    label="Opening"
                    value={opening}
                    options={[
                      [
                        '',
                        `Its own — ${openingName(setupOpenings.written.find((one) => one.id === setupOpenings.primary) ?? { label: '', text: '' })}`,
                      ],
                      ...setupOpenings.written.map(
                        (one) => [one.id, openingName(one)] as [string, string],
                      ),
                      [COLD, 'None — start cold'],
                    ]}
                    onChange={setOpening}
                    hint="The first thing the story says. Written, not generated, so it is the same every time."
                  />
                ) : null}
                {/* ***The owner's decision (25 B18), said where it applies***
                    (2026-10-03). Only when there are greetings to set aside — the Setup's mode
                    writes them and somebody in its party has one — because a
                    sentence about greetings nobody would have given is noise
                    beside the one choice that is real. */}
                {carriesOpening && greeters.length > 0 ? (
                  <Fine>{SETUP_WORDS.greetingsSetAside}</Fine>
                ) : null}
                {greetingsBegin ? (
                  <fieldset className="flex flex-col gap-2">
                    <legend className="text-sm font-medium text-ink-muted">
                      {SETUP_WORDS.legend}
                    </legend>
                    <Fine>{SETUP_WORDS.greetingsBegin}</Fine>
                    {greeters.map((actor) => (
                      <GreetingPicker
                        key={actor.id}
                        actor={actor}
                        value={openings[actor.id]}
                        onChange={(next) => {
                          setOpenings({ ...openings, [actor.id]: next });
                        }}
                      />
                    ))}
                  </fieldset>
                ) : null}
                <Fine>
                  The mode, treatment, preset, persona, lorebooks, party, goals and hooks all come
                  from the setup. Open it in the library to change them.
                </Fine>
              </>
            ) : (
              <>
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
              </>
            )}
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
        <Note>No sessions of this kind.</Note>
      ) : null}

      {/* ***The list says what it is when it is not a list*** (2026-10-01,
          polish 9). Loading, unreadable and empty all rendered the same
          nothing: an install with no sessions yet looked exactly like a server
          that had not answered, and a person could not tell whether to start
          one or wait. Empty says which way the archive toggle stands, because
          an install whose every session is archived is empty only on one side
          of it. */}
      {sessions.isPending ? <Note>{LIST_WORDS.loading}</Note> : null}
      {sessions.isError ? <AlertNote role="alert">{LIST_WORDS.failed}</AlertNote> : null}
      {sessions.data?.sessions.length === 0 ? (
        <Note>{showArchived ? LIST_WORDS.none : LIST_WORDS.noneShown}</Note>
      ) : null}

      <CheckboxField
        label="Show archived sessions"
        checked={showArchived}
        onChange={setShowArchived}
      />

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
            {session.archivedAt === undefined ? null : <Fine>Archived</Fine>}
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * ***Which greeting one character opens on*** — [P14.5]'s select, lifted out
 * at the P15 merge (2026-10-03) when a Setup's party needed the same control.
 *
 * **Nothing at all for a character with one greeting or none**: there is no
 * choice to offer, and [P14 §1.7]'s alternates only exist where there are
 * several. `value` absent is their usual, which is what the route starts on
 * when nothing is sent.
 */
function GreetingPicker(props: {
  actor: LibraryObject;
  value: string | undefined;
  onChange: (next: string) => void;
}): React.JSX.Element | null {
  const own = openingsOf(props.actor.object);
  if (own.written.length < 2) return null;
  return (
    <label className="flex items-center gap-2 text-sm text-ink-muted">
      {CAST_WORDS.opening.replace('{name}', () => props.actor.name)}
      <select
        className="rounded-control border border-line bg-surface p-1 text-ink"
        value={props.value ?? own.primary ?? ''}
        onChange={(event) => {
          props.onChange(event.target.value);
        }}
      >
        {own.written.map((opening) => (
          <option key={opening.id} value={opening.id}>
            {opening.id === own.primary
              ? CAST_WORDS.primary.replace('{label}', () => openingName(opening))
              : openingName(opening)}
          </option>
        ))}
      </select>
    </label>
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
