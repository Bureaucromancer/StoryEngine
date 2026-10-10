// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { Link } from '@tanstack/react-router';
import { useEffect, useRef, useState, type JSX } from 'react';

import { WORLD_SCHEMA } from '@storyengine/shared';

import type { LibraryObject } from '../api.js';
import { membersOf, SESSION_MEMBER_SCHEMA, sessionMember } from '../editor/members-form.js';
import { useAddToWorld, useLibrary } from '../queries.js';
import { AlertNote } from '../ui/Alert.js';
import { Button } from '../ui/Button.js';
import { SelectField } from '../ui/Field.js';
import { link } from '../ui/classes.js';
import { Note } from '../ui/Text.js';
import { useFocusOnReveal } from '../ui/useFocusOnReveal.js';
import { sessionLabel } from './session-label.js';

/**
 * ***A session's Worlds, from the session's side*** —
 * [P16.1](../../../../docs/design/workplan/35-p16-world.md),
 * [P16 §1.2](../../../../docs/design/workplan/35-p16-world.md),
 * [15 §3.2](../../../../docs/design/15-world.md).
 *
 * **Membership is written in one place, and it is not here.** A session
 * carries no World ([15 §3.2]: two records of one membership is a query that
 * has to agree with another query), so both halves of this file read and write
 * the World's `contents`:
 *
 * - **`AddToWorld`** posts one envelope to the World — the server's
 *   `POST /library/worlds/:id/members`, idempotent by id — rather than writing
 *   the World from here, because this page never read it and a
 *   read-modify-write from a session row would lose a second tab's save.
 * - **`InTheseWorlds`** is the reverse view, and P16 §1.2 says what it is: *a
 *   query*. The Worlds whose `contents` name this session, worked out here from
 *   the same list the control offers from — one fetch for both, and a fine cost
 *   for a panel, which is the sentence that would make it the wrong cost for a
 *   key read every turn.
 *
 * **One control rendered twice**, in the session list and beside the play
 * heading — `RenameSession`'s arrangement, for its reason: the list is where
 * somebody sorting several sessions into sets is looking, and the session's
 * page is where they are when they realise this one belongs to one.
 */

/** Whether a library row is a World — the list is fetched by kind, and a row says what it is. */
function isWorld(object: LibraryObject): boolean {
  return object.schema === WORLD_SCHEMA;
}

/**
 * Whether this World's `contents` names this session.
 *
 * ***Read defensively, for `panels.tsx`'s `membersOfWorld` reason.*** The row
 * is whatever the server read off disk, and `membersOf` only checks that
 * `contents` is a list — it trusts what is in it, which is right for the
 * editor (`contentsShape` stands in front of it there) and wrong here, where
 * nothing does. A `null` member would throw on `.schema`, and these two
 * components sit on the session list and the play page: there is no error
 * boundary in this package, so one bad World would take the whole application
 * down with it rather than simply not counting.
 */
function holds(world: LibraryObject, sessionId: string): boolean {
  return membersOf(world.object).some((member: unknown) => {
    if (typeof member !== 'object' || member === null) return false;
    const { schema, id } = member as { schema?: unknown; id?: unknown };
    return schema === SESSION_MEMBER_SCHEMA && id === sessionId;
  });
}

/**
 * The Worlds list, read once for both halves.
 *
 * *Filtered by schema even though it is fetched by kind*: the row's `schema`
 * is the object's own claim, and checking it costs nothing beside trusting
 * that a folder only ever holds its kind.
 */
function useWorlds(): { worlds: LibraryObject[] | undefined; failed: boolean } {
  const worlds = useLibrary('worlds');
  return {
    worlds: worlds.data?.objects.filter(isWorld),
    // Only a list that never arrived — the library polls, and a failed poll
    // keeps the last answer, which is still the right one to offer from.
    failed: worlds.data === undefined && worlds.isError,
  };
}

/**
 * ***Add to a world…*** — [P16.1]'s *from a session's page and from the session
 * list*.
 *
 * **Your Worlds only, and only those that do not already hold it.** A system
 * World is the install's shipped material and read-only to every account, so
 * offering it would offer a write the server refuses. A World already holding
 * the session is left out rather than shown and refused: the add is idempotent
 * and would succeed at doing nothing, which a person would read as a button
 * that does not work. A shadowed copy is left out too — writes resolve by id
 * to the winner, so offering the loser would add to a World other than the one
 * named.
 */
export function AddToWorld(props: { sessionId: string; name: string }): JSX.Element {
  const { worlds, failed } = useWorlds();
  const add = useAddToWorld();
  const [open, setOpen] = useState(false);
  const [choice, setChoice] = useState('');
  const [done, setDone] = useState<string | null>(null);
  /**
   * ***The keyboard goes with the prompt, and comes back*** — `RenameSession`'s
   * polish-10 arrangement, for its reason: the button is replaced by the form
   * it opens and the form by the button, and each swap would otherwise drop
   * focus to the page.
   */
  const form = useFocusOnReveal<HTMLFormElement>(open);
  const button = useRef<HTMLButtonElement>(null);
  const returning = useRef(false);
  useEffect(() => {
    if (open || !returning.current) return;
    returning.current = false;
    button.current?.focus();
  }, [open]);

  const offered = (worlds ?? []).filter(
    (world) => world.source === 'user' && !world.shadowed && !holds(world, props.sessionId),
  );
  const chosen = offered.find((world) => world.id === choice) ?? offered[0];
  const label = sessionLabel(props.name);

  if (!open) {
    return (
      <div className="flex flex-wrap items-center gap-2">
        <Button
          ref={button}
          type="button"
          variant="quiet"
          size="tiny"
          // ***The visible words first, then the session*** — WCAG 2.5.3's
          // *label in name*: somebody using voice control says what they see,
          // *Add to a world*, and a name that put the session in the middle of
          // that phrase would not answer it. The session is still in the name,
          // for `renameLabel`'s reason: a column of these is otherwise a list
          // nobody can choose from by name.
          aria-label={`Add to a world: ${label}`}
          onClick={() => {
            setDone(null);
            add.reset();
            setOpen(true);
          }}
        >
          Add to a world…
        </Button>
        {/* Said, because the control closes on success and the list row has
            no *In these worlds* line to show the change in. */}
        {done === null ? null : (
          <span role="status" className="text-xs text-ink-faint">
            {`Added to ${done}.`}
          </span>
        )}
      </div>
    );
  }

  const close = (): void => {
    returning.current = true;
    setOpen(false);
    setChoice('');
  };

  return (
    // `max-w-full` here and `min-w-0 max-w-full` round the select: a select
    // is as wide as its longest option, and one World with a long name would
    // otherwise push the session row — and on a phone, the page — sideways.
    <form
      ref={form}
      className="flex max-w-full flex-wrap items-end gap-2"
      aria-label={`Add ${label} to a world`}
      onSubmit={(event) => {
        event.preventDefault();
        if (chosen === undefined) return;
        add.mutate(
          { worldId: chosen.id, members: [sessionMember(props.sessionId, props.name)] },
          {
            onSuccess: () => {
              setDone(chosen.name);
              close();
            },
          },
        );
      }}
    >
      {failed ? (
        <Note>Your worlds could not be read. Try reloading the page.</Note>
      ) : worlds === undefined ? (
        <Note>Reading your worlds…</Note>
      ) : chosen === undefined ? (
        <Note>
          {worlds.some((world) => world.source === 'user' && !world.shadowed)
            ? 'Every world of yours already holds this session.'
            : 'You have no worlds yet. Make one in the library with New world, then add this session to it.'}
        </Note>
      ) : (
        <>
          <div className="min-w-0 max-w-full">
            <SelectField
              label="World"
              value={chosen.id}
              options={offered.map((world) => [world.id, world.name] as const)}
              onChange={setChoice}
            />
          </div>
          <Button type="submit" variant="primary" size="tiny" disabled={add.isPending}>
            Add
          </Button>
        </>
      )}
      <Button type="button" variant="quiet" size="tiny" onClick={close}>
        Cancel
      </Button>
      {add.isError ? <AlertNote role="alert">{add.error.message}</AlertNote> : null}
    </form>
  );
}

/**
 * ***In these worlds*** — the session page's backlink, [10 §5.2]'s *Used by*
 * from the session's side ([P16.1]).
 *
 * **Every World that names it, yours or the system's**, because this is a fact
 * about the session rather than an offer: a World that holds it is one that
 * would carry it when published, whoever owns the World. *Nothing at all when
 * there is none*, `UsedByPanel`'s rule — the play column is long, and a
 * heading over an empty list is a line of it spent on saying nothing.
 *
 * Each name links to the World's page, which is where its members are seen
 * and changed.
 */
export function InTheseWorlds(props: { sessionId: string }): JSX.Element | null {
  const { worlds } = useWorlds();
  const holding = (worlds ?? []).filter(
    (world) => !world.shadowed && holds(world, props.sessionId),
  );
  if (holding.length === 0) return null;

  return (
    <section className="flex flex-wrap items-center gap-2" aria-label="In these worlds">
      <h2 className="text-sm font-medium text-ink-muted">In these worlds</h2>
      <ul className="flex flex-wrap gap-2">
        {holding.map((world) => (
          <li key={world.id}>
            <Link
              to="/library/$kind/$id"
              params={{ kind: 'worlds', id: world.id }}
              search={{}}
              className={link.inline}
            >
              {world.name}
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
