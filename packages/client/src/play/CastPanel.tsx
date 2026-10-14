// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { useState, type JSX } from 'react';

import type { CastRow, ChatSettings, LibraryObject } from '../api.js';
import { formatPercent } from '../format.js';
import { labels } from '../i18n/catalogue.js';
import { useLibrary, useSaveObject, useSession, useSetCast, useWriteChannel } from '../queries.js';
import { Alert } from '../ui/Alert.js';
import { Badge } from '../ui/Badge.js';
import { Button } from '../ui/Button.js';
import { disclosure } from '../ui/classes.js';
import { Fine } from '../ui/Text.js';
import { CardPrompts } from './CardPrompts.js';
import { castBadge, isTerminalBadge, partyBadge } from './castBadge.js';
import { canSpeak, talkativenessOf, withTalkativeness } from './chat.js';
import { Portrait } from './Portrait.js';
import { WriteFailed } from './WriteFailed.js';

/**
 * The panel's words, through the catalogue ([P11.8]). The status options below
 * predate it and stay inline, as the panel's other P7 words do.
 */
const WORDS = labels('play.cast', {
  label: 'Cast',
  inScene: 'In the scene',
  muted: 'Muted',
  speak: 'Speak',
  remove: 'Remove from the cast',
  add: 'Add to the cast',
  addLabel: 'Somebody to add',
  addNobody: 'Choose a character',
  talkativeness: 'How readily they join in',
  talkativenessHint: 'This is the character’s own, so every chat they are in changes with it.',
  // §1.3 `natural` step 3: at 0 a member still speaks when named, and is
  // the one picked when nobody else would answer — never *only* when named.
  never: 'Rarely: when named, or if nobody else can',
  always: 'Whenever they can',
  cardPrompts: 'Card prompts',
  castFailed: 'The cast could not be changed.',
  talkativenessFailed: 'The card could not be saved.',
  youPlay: 'You play',
  nobody: 'Nobody in particular',
  playAs: 'Play as them',
  personaFailed: 'Who you play could not be changed.',
});

/**
 * ***Where the player's own face sends a person*** — the id of *You play*, so
 * a line of the transcript can hand it the keyboard without the page holding a
 * ref into this panel. One control on the page has it.
 */
const YOU_PLAY = 'cast-you-play';

/**
 * Hands *You play* the keyboard, which scrolls it into view: the face on a
 * player's line, pressed. A no-op when the panel is not drawn, which
 * {@link castPanelShows} lets the page know before it offers the press.
 */
export function focusWhoYouPlay(): void {
  document.getElementById(YOU_PLAY)?.focus();
}

/**
 * ***Whether the panel is drawn***, as a question the page can ask too: the
 * player's face on a line is a way to *You play* only when there is one to go
 * to. A chat renders even with nobody in it, because the control that seats
 * somebody is inside; anything else keeps the old rule — no cast, no panel —
 * and a session with a persona has a row for them.
 *
 * *(2026-10-14, [P12A](../../../../docs/design/workplan/35-p12a-the-look.md)
 * P12A.3, after review: **and a session with a roster renders too**, even with
 * nobody seated, for the chat's reason — the control that seats somebody is
 * inside. The old rule broke the day the panel came to hold the only persona
 * control. In a session whose one row was its persona, with no presence or
 * status written for anybody else, choosing* Nobody in particular *emptied the
 * rows, the panel went with them, and* You play *with the panel: nothing in
 * the product could set a persona on that session again, and every face on a
 * line played as the old persona stopped being a way to it. A roster is
 * `session.cast`, which a session has once it was started with a cast or one
 * was written through `PUT /cast` — so it survives* Nobody *as
 * `{ persona: null, actors: [] }`. A session started with no cast at all still
 * draws no panel, as before: nothing was ever chosen there to take back.)*
 */
export function castPanelShows(
  rows: readonly CastRow[],
  chat: ChatSettings | undefined,
  roster: { persona: string | null; actors: string[] } | undefined,
): boolean {
  return rows.length > 0 || chat !== undefined || roster !== undefined;
}

/** The steps a talkativeness select offers: SillyTavern's slider, in tenths. */
const TENTHS = Array.from({ length: 11 }, (_, at) => at / 10);

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
 * *correct presence and status directly*. *(2026-10-13,
 * [P12A](../../../../docs/design/workplan/35-p12a-the-look.md) P12A.3: and who
 * you play, which is not one of the four but is the correction a face on the
 * player's own line leads to — `WhoYouPlay`.)* The other three are named here rather
 * than quietly dropped: **merge** and **split** are library operations that need
 * a redirect so that turn records pointing at an actor id do not rot
 * ([00 §3.3]), and no such mechanism exists; **linking an unresolved mention**
 * waits on the spans P7.7 builds, since there is nothing yet to link from.
 *
 * **One badge from two axes**, derived in `castBadge` where it can be tested.
 * The split stays in the data.
 *
 * ~~**Party members are not marked, and the absence is deliberate.**~~ **They
 * are marked since [P7.3]**, when `se.party` landed with the widened `select` it
 * was waiting on. 10 §13.2 asks the panel to *"mark party members distinctly and
 * introduce no parallel membership concept"*, and both halves hold: the mark is
 * a second badge on a row that already exists, read from a channel keyed the
 * same way as presence — so there is no second list of who is in the story to
 * disagree with the first, which is the thing that paragraph calls *"exactly the
 * class of bug this section exists to surface"*.
 *
 * *Two badges rather than one, because* here *and* with you *are different
 * questions and a cast member can be either without the other — `castBadge`
 * derives the first from presence and status, `partyBadge` says the second.*
 *
 * ***And since [P14.5], the chat's own four*** —
 * [P14 §1.8](../../../../docs/design/workplan/31-p14-scene-and-session-import.md):
 * *"the cast panel gains add and remove, over `PUT /sessions/:id/cast`, which
 * exists and has no client; mute (presence); talkativeness; speak."* Plus the
 * card's prompt switches, which §1.5 puts here *"because that is where a
 * person looks when one character misbehaves"*.
 *
 * - **Mute is presence**, relabelled rather than re-plumbed. Under a chat's
 *   `castIsPresent` a member nobody touched is present and `false` is
 *   muted ([P14 §1.3]) — so in an embodied chat the one checkbox reads
 *   *Muted* and writes the same channel *In the scene* always did.
 * - **Talkativeness is the card's, not the session's**, and the control says
 *   so. [P14 §1.3] puts it at `actor.modeData[mode].talkativeness` —
 *   *"participation, not prompt"* — which is where SillyTavern keeps it too
 *   and where an import writes it. A per-session value would be a second
 *   answer the runner does not read. So changing it here edits the card in
 *   the library, through the ordinary save, and every chat that card is in
 *   hears it.
 * - **Speak is force-talk with no input** — *let them talk*, aimed. It
 *   reaches a muted member, as SillyTavern's does, and never the dead or the
 *   persona (`canSpeak`).
 * - **Add and remove send the roster whole**, persona included, which is the
 *   route's shape.
 */
export function CastPanel(props: {
  sessionId: string;
  /** The reader's, for the talkativeness percentages. */
  locale: string | undefined;
  /** Force-talk with no input — the page's, because a turn is the page's to start. */
  onSpeak?: (actorId: string) => void;
  /** Whether a turn is running, so *speak* waits for it. */
  busy?: boolean;
}): JSX.Element | null {
  const session = useSession(props.sessionId);
  const rows = session.data?.cast ?? [];
  const chat = session.data?.chat;
  const roster = session.data?.session.cast;
  const modeId = session.data?.session.mode?.id;

  if (!castPanelShows(rows, chat, roster)) return null;

  return (
    <section className="flex flex-col gap-2" aria-label={WORDS.label}>
      {roster === undefined ? null : <WhoYouPlay sessionId={props.sessionId} roster={roster} />}
      {rows.map((row) => (
        <CastMember
          key={row.actorId}
          sessionId={props.sessionId}
          locale={props.locale}
          row={row}
          chat={chat}
          roster={roster}
          modeId={modeId}
          busy={props.busy ?? false}
          {...(props.onSpeak === undefined ? {} : { onSpeak: props.onSpeak })}
        />
      ))}
      {chat === undefined ? null : <AddMember sessionId={props.sessionId} roster={roster} />}
    </section>
  );
}

/**
 * ***Who you play*** (2026-10-13,
 * [P12A](../../../../docs/design/workplan/35-p12a-the-look.md) P12A.3) — the
 * correction a face on the player's own line leads to.
 *
 * Since P12A.3 a move is sent with the persona it is played as, and its line
 * draws that face, which makes the persona a claim the transcript shows. A
 * shown claim needs the place it is corrected ([00 §3.6]), and there was none:
 * `PUT /cast` has always taken a persona, and `LorePanel`'s note said *nothing
 * in the product offers one yet, and that is a deliberate absence*, on
 * [06 §8](../../../../docs/design/06-modes-and-turn-pipeline.md)'s reading that
 * a persona is *"chosen at setup, and changing it mid-session is an explicit
 * act rather than an outcome of play"*. **This is that explicit act**, and the
 * least of it: a choice and a button, the choice doing nothing until the button
 * is pressed, so a persona never changes because a select was scrolled past.
 * It writes the roster whole, actors as they are, which is the route's shape.
 *
 * **It changes who plays the next move, and nothing already played.** A line
 * says who it was played as, from its own record; choosing someone else here
 * moves no face on any line before it, which is the point of the face being
 * the record's.
 *
 * *A persona the library no longer has* is offered under its id, as the row
 * below names it, so the select shows what the session says rather than
 * quietly reading *Nobody in particular*.
 */
function WhoYouPlay(props: {
  sessionId: string;
  roster: { persona: string | null; actors: string[] };
}): JSX.Element {
  const actors = useLibrary('actors');
  const cast = useSetCast(props.sessionId);
  const current = props.roster.persona ?? '';
  const [chosen, setChosen] = useState<string | null>(null);
  const value = chosen ?? current;
  const offered = actors.data?.objects ?? [];

  return (
    <div className="flex flex-col gap-1">
      <div className="flex flex-wrap items-center gap-2">
        <label className="flex items-center gap-1 text-sm text-ink-muted">
          {WORDS.youPlay}
          <select
            id={YOU_PLAY}
            className="rounded-control border border-line bg-surface p-1 text-ink"
            value={value}
            onChange={(event) => {
              setChosen(event.target.value);
            }}
          >
            <option value="">{WORDS.nobody}</option>
            {current === '' || offered.some((one) => one.id === current) ? null : (
              <option value={current}>{current}</option>
            )}
            {offered.map((one) => (
              <option key={one.id} value={one.id}>
                {one.name}
              </option>
            ))}
          </select>
        </label>
        <Button
          type="button"
          size="compact"
          disabled={value === current || cast.isPending}
          onClick={() => {
            cast.mutate(
              { persona: value === '' ? null : value, actors: props.roster.actors },
              {
                onSuccess: () => {
                  setChosen(null);
                },
              },
            );
          }}
        >
          {WORDS.playAs}
        </Button>
      </div>
      <WriteFailed error={cast.error} otherwise={WORDS.personaFailed} />
    </div>
  );
}

/**
 * ***Seating somebody*** — a library card, not yet in the roster. The persona
 * is offered too: somebody who wants to play alongside their own character is
 * making a choice this panel has no business refusing, and the route takes it.
 */
function AddMember(props: {
  sessionId: string;
  roster: { persona: string | null; actors: string[] } | undefined;
}): JSX.Element {
  const actors = useLibrary('actors');
  const cast = useSetCast(props.sessionId);
  const [chosen, setChosen] = useState('');
  const seated = new Set(props.roster?.actors ?? []);
  const offered = (actors.data?.objects ?? []).filter((one) => !seated.has(one.id));

  return (
    <div className="flex flex-col gap-1">
      <div className="flex flex-wrap items-center gap-2">
        <label className="flex items-center gap-1 text-sm text-ink-muted">
          <span className="sr-only">{WORDS.addLabel}</span>
          <select
            className="rounded-control border border-line bg-surface p-1 text-ink"
            value={chosen}
            onChange={(event) => {
              setChosen(event.target.value);
            }}
          >
            <option value="">{WORDS.addNobody}</option>
            {offered.map((one) => (
              <option key={one.id} value={one.id}>
                {one.name}
              </option>
            ))}
          </select>
        </label>
        <Button
          type="button"
          size="compact"
          disabled={chosen === '' || cast.isPending}
          onClick={() => {
            cast.mutate(
              {
                persona: props.roster?.persona ?? null,
                actors: [...(props.roster?.actors ?? []), chosen],
              },
              {
                onSuccess: () => {
                  setChosen('');
                },
              },
            );
          }}
        >
          {WORDS.add}
        </Button>
      </div>
      <WriteFailed error={cast.error} otherwise={WORDS.castFailed} />
    </div>
  );
}

function CastMember(props: {
  sessionId: string;
  locale: string | undefined;
  row: CastRow;
  chat?: ChatSettings | undefined;
  roster?: { persona: string | null; actors: string[] } | undefined;
  modeId?: string | undefined;
  busy?: boolean;
  onSpeak?: (actorId: string) => void;
}): JSX.Element {
  const { row, chat } = props;
  const actors = useLibrary('actors');
  const write = useWriteChannel(props.sessionId);
  const cast = useSetCast(props.sessionId);

  // The card's name if the library has it, the id if it does not — a cast entry
  // is a link resolved fresh every turn ([03 §8]), so an actor deleted from the
  // library is a dangling reference the panel shows rather than hides ([00 §3.3]).
  const card = (actors.data?.objects ?? []).find((one) => one.id === row.actorId);
  const name = card?.name ?? row.actorId;
  const party = partyBadge(row.party);
  const embodied = chat?.voice === 'embodied';
  const seated =
    props.roster !== undefined &&
    props.roster.actors.includes(row.actorId) &&
    row.actorId !== props.roster.persona;

  function set(channelId: string, value: unknown): void {
    write.mutate({ key: `${channelId}#${row.actorId}`, value });
  }

  return (
    <div className="flex flex-col gap-1">
      <div className="flex flex-wrap items-center gap-2">
        {/* ***A face on every row*** (2026-10-13, P12A.3) — it was a chat's
            alone. Every row is a claim that this person is in this story, which
            is [10 §1.3]'s test for a face, and the row is where that claim is
            corrected. The picture is found by the library's content hash, as
            every face is: a row carries the actor's id and nothing else. */}
        <Portrait actorId={row.actorId} actor={card} name={name} />
        <span className="text-ink">{name}</span>
        <Badge tone={isTerminalBadge(row.status) ? 'danger' : 'neutral'}>{castBadge(row)}</Badge>
        {party === null ? null : <Badge tone="neutral">{party}</Badge>}
        {row.introduced ? null : <Fine>not yet met</Fine>}
      </div>

      {/**
       * **The prominent surface a refused death is owed** — [06 §8.1], [26 C12].
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
          {/* In a chat, presence `false` is a mute ([P14 §1.3]), and the box
              says so the right way up: ticked means *muted*. */}
          <input
            type="checkbox"
            checked={embodied ? !row.presence : row.presence}
            disabled={write.isPending}
            onChange={(event) => {
              set('se.presence', embodied ? !event.target.checked : event.target.checked);
            }}
          />
          {embodied ? WORDS.muted : WORDS.inScene}
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
        {/* Embodied only, as the card prompts are: a narrator speaks for
            nobody, so aiming a turn at one member would change nothing. */}
        {props.onSpeak !== undefined && embodied && canSpeak(row, props.roster) ? (
          <Button
            type="button"
            size="compact"
            disabled={props.busy === true}
            onClick={() => {
              props.onSpeak?.(row.actorId);
            }}
          >
            {WORDS.speak}
          </Button>
        ) : null}
        {seated && chat !== undefined ? (
          <Button
            type="button"
            size="compact"
            variant="quiet"
            disabled={cast.isPending}
            onClick={() => {
              cast.mutate({
                persona: props.roster?.persona ?? null,
                actors: (props.roster?.actors ?? []).filter((id) => id !== row.actorId),
              });
            }}
          >
            {WORDS.remove}
          </Button>
        ) : null}
      </div>

      {seated &&
      chat !== undefined &&
      embodied &&
      card !== undefined &&
      props.modeId !== undefined ? (
        <Talkativeness card={card} modeId={props.modeId} locale={props.locale} />
      ) : null}

      {seated && chat !== undefined && embodied ? (
        <details>
          <summary className={`${disclosure.quiet} text-sm`}>{WORDS.cardPrompts}</summary>
          <div className="mt-1">
            <CardPrompts
              sessionId={props.sessionId}
              actorId={row.actorId}
              name={name}
              chat={chat}
            />
          </div>
        </details>
      ) : null}
      <WriteFailed error={cast.error} otherwise={WORDS.castFailed} />
      {/* The row's own writes — the mute, the status, a ruling on a refused
          death — said nothing when refused (2026-10-01, polish 9). */}
      <WriteFailed error={write.error} />
    </div>
  );
}

/**
 * ***How readily a member joins a `natural` round*** — SillyTavern's slider, in
 * tenths, written to the card ([P14 §1.3]; see the panel's docstring on why the
 * card and not the session). A percentage in the reader's own number format,
 * with the two ends named, since *0%* and *100%* are the two values whose
 * meaning is not a chance.
 */
function Talkativeness(props: {
  card: LibraryObject;
  modeId: string;
  locale: string | undefined;
}): JSX.Element {
  const save = useSaveObject();
  const value = talkativenessOf(props.card.object, props.modeId);
  const labelOf = (tenth: number): string =>
    tenth === 0 ? WORDS.never : tenth === 1 ? WORDS.always : formatPercent(tenth, props.locale);

  /**
   * ***The hint is visible text, not a tooltip.*** That changing it here
   * changes it in every chat the card is in is the one thing a person must know
   * before touching it, and a `title` reaches neither a touch screen nor a
   * keyboard.
   */
  return (
    <div className="flex flex-col gap-1">
      <label className="flex flex-wrap items-center gap-2 text-sm text-ink-muted">
        {WORDS.talkativeness}
        <select
          className="rounded-control border border-line bg-surface p-1 text-ink"
          value={String(Math.round(value * 10) / 10)}
          disabled={save.isPending}
          onChange={(event) => {
            save.mutate({
              kind: 'actors',
              id: props.card.id,
              object: withTalkativeness(
                props.card.object,
                props.modeId,
                Number(event.target.value),
              ),
              contentHash: props.card.contentHash,
            });
          }}
        >
          {TENTHS.map((tenth) => (
            <option key={tenth} value={String(tenth)}>
              {labelOf(tenth)}
            </option>
          ))}
        </select>
      </label>
      <Fine>{WORDS.talkativenessHint}</Fine>
      <WriteFailed error={save.error} otherwise={WORDS.talkativenessFailed} />
    </div>
  );
}
