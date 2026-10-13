// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { useId, useState, type JSX } from 'react';

import type { BackdropCandidate } from '../api.js';
import { labels } from '../i18n/catalogue.js';
import { useBackdrops, useChooseBackdrop } from '../queries.js';
import { AlertNote } from '../ui/Alert.js';
import { Button } from '../ui/Button.js';
import { Dialog } from '../ui/Dialog.js';
import { Note, SubsectionTitle } from '../ui/Text.js';
import { WriteFailed } from './WriteFailed.js';

/**
 * ***Choose a backdrop…*** — [10 §2.3](../../../../docs/design/10-ui-surfaces.md)'s
 * *generated or uploaded*, the half that was missing, built at
 * [P12A](../../../../docs/design/workplan/35-p12a-the-look.md) P12A.2 under
 * §0.4's decisions.
 *
 * **Why a person needs it before a model can give it.** [P12A §1.2] puts it
 * plainly: the only way to put a picture behind the story was to generate
 * one, which needs an endpoint serving the `image` role that most installs do
 * not have — so T1, *the prose over the worst backdrop you can find*, could
 * not be walked. The worst case for legibility is a bright picture somebody
 * chose, not one a model made, so this is the better test as well as the
 * reachable one.
 *
 * **What is offered is what the session already uses** — the backgrounds it
 * made, and the pictures on its treatment, its lorebooks and their entries,
 * its setup, its cast and the Worlds it is in — listed by the server
 * (`GET /sessions/:id/backdrops`, which says why there and not here). A new
 * picture goes into a library object first, through the galleries that
 * exist, and is offered from then on; there is no upload into a session,
 * which would need a new arm of the channel's value.
 *
 * ***Choosing turns *Stage a backdrop* off, in the same act, and the dialog
 * says so in the same sentence.*** With staging on, the story's next reuse or
 * new picture would overwrite a pick; with it off nothing does, so the pick
 * holds without a rule of its own in the runner, and turning staging back on
 * is how the choice goes back to the story. *No backdrop* is the same act
 * with nothing chosen: off, with no frame left (`Backdrop.tsx`). Both are a
 * person's channel writes and land on the record as turns — the transcript's
 * rows, where Undo takes one back.
 *
 * *Only for a mode that stages a backdrop*: the page draws this beside *Set
 * the scene*, under the same condition — `renditions.backdrop` on the session
 * read, absent for a mode with no such switch.
 */
const WORDS = labels('play.backdrop', {
  open: 'Choose a backdrop…',
  title: 'Choose a backdrop',
  lead: 'Choosing a picture here, or No backdrop, stops the story staging its own: “Stage a backdrop” is switched off, so what you choose stays until you change it. Switching “Stage a backdrop” back on hands the choice back to the story.',
  none: 'No backdrop',
  made: 'Made in this session',
  treatments: 'From the treatment “{name}”',
  setups: 'From the setup “{name}”',
  worlds: 'From the World “{name}”',
  lorebooks: 'From the lorebook “{name}”',
  actors: 'From {name}',
  // A kind a newer server sent that this build has no sentence for — said
  // by its name rather than dropped, as the start dialog's unknown arm is.
  other: 'From “{name}”',
  picture: 'Picture {n}',
  showing: 'Showing now',
  loading: 'Looking for pictures…',
  failed: 'The pictures could not be listed.',
  empty:
    'Nothing this session uses has a picture yet. A picture goes into the library first — on the treatment, a lorebook or one of its entries, the setup, a character, or a World the session is in — and is offered here from then on.',
  chooseFailed: 'That backdrop could not be chosen.',
  close: 'Close',
});

/** The heading a group of pictures goes under, by whose pictures they are. */
function headingOf(source: BackdropCandidate['source']): string {
  if (source === null) return WORDS.made;
  const template =
    source.kind === 'treatments' ||
    source.kind === 'setups' ||
    source.kind === 'worlds' ||
    source.kind === 'lorebooks' ||
    source.kind === 'actors'
      ? WORDS[source.kind]
      : WORDS.other;
  return template.replace('{name}', () => source.name);
}

/**
 * The rows in the server's order, grouped by whose they are — one heading per
 * object, and one for the pictures this session made. *The order is the
 * server's* (what this session made, then its treatment, setup, Worlds,
 * lorebooks and cast), because it is the order a person looks for a place in,
 * and a client re-sorting it would be a second answer to one question.
 */
function groupsOf(rows: readonly BackdropCandidate[]): {
  key: string;
  heading: string;
  rows: BackdropCandidate[];
}[] {
  const groups = new Map<string, { key: string; heading: string; rows: BackdropCandidate[] }>();
  for (const row of rows) {
    const key = row.source === null ? 'this-session' : `${row.source.kind}/${row.source.id}`;
    const held = groups.get(key);
    if (held === undefined) groups.set(key, { key, heading: headingOf(row.source), rows: [row] });
    else held.rows.push(row);
  }
  return [...groups.values()];
}

/**
 * The control and its dialog. `busy` is a turn being written: the writes
 * would answer *busy*, so the control waits, as *Set the scene* beside it
 * does.
 */
export function ChooseBackdrop(props: { sessionId: string; busy: boolean }): JSX.Element {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button
        type="button"
        disabled={props.busy}
        onClick={() => {
          setOpen(true);
        }}
      >
        {WORDS.open}
      </Button>
      {open ? (
        <BackdropDialog
          sessionId={props.sessionId}
          onClose={() => {
            setOpen(false);
          }}
        />
      ) : null}
    </>
  );
}

function BackdropDialog(props: { sessionId: string; onClose: () => void }): JSX.Element {
  const titleId = useId();
  const list = useBackdrops(props.sessionId, true);
  const choose = useChooseBackdrop(props.sessionId);
  /**
   * ***A thumbnail that will not load is not offered*** — the stage's own
   * rule (`useStage`), applied a step earlier. A media row can name bytes
   * that are gone — a file deleted by hand, a container emptied — and the
   * list does not open every container to check, so the browser is the one
   * that finds out. A broken image in a list of pictures to choose from is a
   * choice that would stage nothing.
   */
  const [broken, setBroken] = useState<ReadonlySet<string>>(() => new Set());

  const pick = (selection: unknown): void => {
    choose.mutate({ selection }, { onSuccess: props.onClose });
  };

  const rows = (list.data ?? []).filter((row) => !broken.has(row.url));
  const groups = groupsOf(rows);

  return (
    <Dialog role="dialog" labelledBy={titleId} onDismiss={props.onClose} size="large">
      <SubsectionTitle id={titleId} as="h2">
        {WORDS.title}
      </SubsectionTitle>
      <Note>{WORDS.lead}</Note>
      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          disabled={choose.isPending}
          onClick={() => {
            pick(null);
          }}
        >
          {WORDS.none}
        </Button>
      </div>
      {list.isPending ? (
        <Note role="status">{WORDS.loading}</Note>
      ) : list.isError ? (
        <AlertNote role="alert">{WORDS.failed}</AlertNote>
      ) : groups.length === 0 ? (
        <Note>{WORDS.empty}</Note>
      ) : (
        groups.map((group) => (
          <section key={group.key} aria-label={group.heading} className="flex flex-col gap-2">
            <h3 className="text-sm font-medium text-ink-muted">{group.heading}</h3>
            <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {group.rows.map((row, index) => (
                <li key={row.url}>
                  <button
                    type="button"
                    aria-pressed={row.current}
                    disabled={choose.isPending}
                    onClick={() => {
                      pick(row.selection);
                    }}
                    className="flex w-full flex-col gap-1 rounded-control border border-line p-1 text-start text-sm text-ink hover:border-line-strong focus-visible:outline-2 focus-visible:outline-focus disabled:cursor-not-allowed aria-pressed:border-accent"
                  >
                    <img
                      src={row.url}
                      alt=""
                      className="aspect-video w-full rounded-media object-cover"
                      onError={() => {
                        setBroken((was) => new Set(was).add(row.url));
                      }}
                    />
                    <span className="px-1">
                      {row.label ?? WORDS.picture.replace('{n}', () => String(index + 1))}
                    </span>
                    {row.current ? (
                      <span className="px-1 text-xs text-ink-muted">{WORDS.showing}</span>
                    ) : null}
                  </button>
                </li>
              ))}
            </ul>
          </section>
        ))
      )}
      <WriteFailed error={choose.error} otherwise={WORDS.chooseFailed} />
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="quiet" onClick={props.onClose}>
          {WORDS.close}
        </Button>
      </div>
    </Dialog>
  );
}
